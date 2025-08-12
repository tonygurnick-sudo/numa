import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  ListUsersCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  DescribeUserPoolCommand,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DeleteUserCommand, GetUserCommand } from '@aws-sdk/client-qbusiness';

// This is not secure, but will do fine for a temporary password.
function genPassword(length = 16) {
  const classes = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789', '!@#$%'];
  let password = '';

  // Use browser's Web Crypto API instead of Node.js crypto
  const randomValues = new Uint8Array(32);
  window.crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    const chars = classes[i % classes.length];
    password += chars.charAt(randomValues[i] % chars.length);
  }
  return password;
}

export class UserManagementUtils {
  constructor(region, credentials) {
    this.cognitoClient = new CognitoIdentityProviderClient({
      region,
      credentials,
    });

    this.credentials = credentials;
  }

  /**
   * Creates a new user in Cognito with a permanent password
   * @param {string} email - Email address of the new user
   * @param {string} userPoolId - Cognito User Pool ID
   * @returns {Promise<Object>} - Object containing the user's details and password
   */
  async createUser(email, userPoolId) {
    try {
      const lowercaseEmail = email.toLowerCase();

      const command = new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: lowercaseEmail,
        TemporaryPassword: genPassword(),
        UserAttributes: [
          {
            Name: 'email',
            Value: lowercaseEmail,
          },
          {
            Name: 'email_verified',
            Value: 'true',
          },
        ],
        MessageAction: 'SUPPRESS', // New users will be notifed by the user who created them
      });

      const response = await this.cognitoClient.send(command);

      const passwordCommand = new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: lowercaseEmail,
        Password: genPassword(), // This cannot be the same as the previous password, so gen a new one.
        Permanent: true,
      });

      await this.cognitoClient.send(passwordCommand);

      return {
        user: response.User,
      };
    } catch (error) {
      if (error.name === 'UsernameExistsException') {
        throw new Error('A user with this email already exists');
      }
      throw error;
    }
  }

  /**
   * Gets all users in a specific Cognito group
   * @param {string} userPoolId - Cognito User Pool ID
   * @param {string} groupName - Name of the group to get users from
   * @returns {Promise<Array>} - Array of usernames in the group
   */
  async getUsersInGroup(userPoolId, groupName) {
    try {
      const command = new ListUsersInGroupCommand({
        UserPoolId: userPoolId,
        GroupName: groupName,
      });

      const response = await this.cognitoClient.send(command);

      // Return array of usernames
      return response.Users.map((user) => user.Username);
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        // Group doesn't exist, return empty array
        console.warn(`Group ${groupName} not found`);
        return [];
      }
      console.error(`Error fetching users in group ${groupName}:`, error);
      throw error;
    }
  }

  /**
   * Lists users in the Cognito User Pool with their groups
   * @param {string} userPoolId - Cognito User Pool ID
   * @param {number} limit - Maximum number of users to return per page (default 20, max 60)
   * @param {string} paginationToken - Token for pagination (optional)
   * @returns {Promise<Object>} - Object with users array, pagination info, and metadata
   */
  async listUsers(userPoolId, limit = 20, paginationToken = null) {
    try {
      const command = new ListUsersCommand({
        UserPoolId: userPoolId,
        Limit: Math.min(Math.max(limit, 1), 60), // Cognito limit is 1-60
        ...(paginationToken && { PaginationToken: paginationToken }),
      });

      const response = await this.cognitoClient.send(command);

      // Get all users in the admin group
      const adminUsers = await this.getUsersInGroup(userPoolId, 'admin');
      const adminUserSet = new Set(adminUsers);

      // Format users with group information
      const users = response.Users.map((user) => ({
        username: user.Username,
        email: user.Attributes.find((attr) => attr.Name === 'email')?.Value,
        enabled: user.Enabled,
        status: user.UserStatus,
        created: user.UserCreateDate,
        groups: adminUserSet.has(user.Username) ? ['admin'] : [],
      }));

      return {
        users: users,
        nextToken: response.PaginationToken,
        hasMore: !!response.PaginationToken,
        total: users.length,
      };
    } catch (error) {
      console.error('Error fetching users:', error);
      throw error;
    }
  }

  /**
   * Adds a user to a Cognito group
   * @param {string} username - Username/email of the user
   * @param {string} groupName - Name of the group to add user to
   * @param {string} userPoolId - Cognito User Pool ID
   * @returns {Promise<void>}
   */
  async addUserToGroup(username, groupName, userPoolId) {
    try {
      const command = new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: username,
        GroupName: groupName,
      });

      await this.cognitoClient.send(command);
    } catch (error) {
      console.error(`Error adding user ${username} to group ${groupName}:`, error);
      throw error;
    }
  }

  /**
   * Removes a user from a Cognito group
   * @param {string} username - Username/email of the user
   * @param {string} groupName - Name of the group to remove user from
   * @param {string} userPoolId - Cognito User Pool ID
   * @returns {Promise<void>}
   */
  async removeUserFromGroup(username, groupName, userPoolId) {
    try {
      const command = new AdminRemoveUserFromGroupCommand({
        UserPoolId: userPoolId,
        Username: username,
        GroupName: groupName,
      });

      await this.cognitoClient.send(command);
    } catch (error) {
      console.error(`Error removing user ${username} from group ${groupName}:`, error);
      throw error;
    }
  }

  /**
   * Describes a Cognito User Pool to get metadata including estimated user count
   * @param {string} userPoolId - Cognito User Pool ID
   * @returns {Promise<Object>} - Object containing user pool metadata
   */
  async describeUserPool(userPoolId) {
    try {
      const command = new DescribeUserPoolCommand({
        UserPoolId: userPoolId,
      });

      const response = await this.cognitoClient.send(command);
      return {
        estimatedNumberOfUsers: response.UserPool.EstimatedNumberOfUsers,
        userPoolId: response.UserPool.Id,
        name: response.UserPool.Name,
        creationDate: response.UserPool.CreationDate,
        lastModifiedDate: response.UserPool.LastModifiedDate,
      };
    } catch (error) {
      console.error('Error describing user pool:', error);
      throw error;
    }
  }

  async deleteUser(username, fetchUsers, setUsersError, setDeletingUser, qClient) {
    try {
      const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');
      const applicationId = window.sessionStorage.getItem('Q_APPLICATION_ID');
      const provisionQResources = window.sessionStorage.getItem('PROVISION_Q_RESOURCES') === 'true';

      // Only attempt Q user deletion if Q resources are provisioned and we have a Q application ID
      if (provisionQResources && applicationId && qClient) {
        try {
          const getQCommand = new GetUserCommand({
            applicationId,
            userId: username,
          });
          await qClient.send(getQCommand);

          const deleteQCommand = new DeleteUserCommand({
            applicationId,
            userId: username,
          });
          await qClient.send(deleteQCommand);
        } catch (err) {
          if (err.name === 'ResourceNotFoundException' || err.$metadata?.httpStatusCode === 404) {
            console.warn(`Q user ${username} not found, skipping Q get/delete`);
          } else {
            throw err;
          }
        }
      } else {
        console.log('Q resources not provisioned or Q client not available, skipping Q user deletion');
      }

      // Get and delete Cognito user, skipping if not found
      try {
        const getCognitoCommand = new AdminGetUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
        });
        await this.cognitoClient.send(getCognitoCommand);

        const deleteCognitoCommand = new AdminDeleteUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
        });
        await this.cognitoClient.send(deleteCognitoCommand);
      } catch (err) {
        if (err.name === 'UserNotFoundException') {
          console.warn(`Cognito user ${username} not found, skipping Cognito get/delete`);
        } else {
          throw err;
        }
      }

      await fetchUsers();
    } catch (err) {
      console.error('Error deleting user:', err);
      setUsersError(err.message || 'Failed to delete user');
    } finally {
      setDeletingUser(null);
    }
  }
}
