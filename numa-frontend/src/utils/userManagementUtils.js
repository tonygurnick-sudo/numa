import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  ListUsersCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DeleteUserCommand, GetUserCommand } from '@aws-sdk/client-qbusiness';

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
      console.log('Creating user with:', { email: lowercaseEmail, userPoolId });

      // Fully random password with all character types
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
      let password = '';

      // Use browser's Web Crypto API instead of Node.js crypto
      const randomValues = new Uint8Array(16);
      window.crypto.getRandomValues(randomValues);
      for (let i = 0; i < 16; i++) {
        password += chars.charAt(randomValues[i] % chars.length);
      }

      // Create the user with email verified and a specified password
      const command = new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: lowercaseEmail,
        TemporaryPassword: password,
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

      console.log('Sending create user command:', JSON.stringify(command, null, 2));
      const response = await this.cognitoClient.send(command);
      console.log('Cognito create user response:', JSON.stringify(response, null, 2));
      console.log('User sub:', response.User.Username);
      console.log('Login username should be:', lowercaseEmail);

      // Set the password as permanent immediately
      const passwordCommand = new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: lowercaseEmail,
        Password: password,
        Permanent: true,
      });

      console.log('Setting permanent password for user:', lowercaseEmail);
      await this.cognitoClient.send(passwordCommand);

      return {
        user: response.User,
      };
    } catch (error) {
      // Handle specific Cognito errors
      if (error.name === 'UsernameExistsException') {
        throw new Error('A user with this email already exists');
      }
      throw error;
    }
  }

  /**
   * Lists all users in the Cognito User Pool
   * @param {string} userPoolId - Cognito User Pool ID
   * @returns {Promise<Array>} - Array of user objects with basic information
   */
  async listUsers(userPoolId) {
    const command = new ListUsersCommand({
      UserPoolId: userPoolId,
    });

    const response = await this.cognitoClient.send(command);
    return response.Users.map((user) => ({
      username: user.Username,
      email: user.Attributes.find((attr) => attr.Name === 'email')?.Value,
      enabled: user.Enabled,
      status: user.UserStatus,
      created: user.UserCreateDate,
    }));
  }

  async deleteUser(username, fetchUsers, setUsersError, setDeletingUser, qClient) {
    if (
      !window.confirm(
        `Are you sure you want to delete user ${username}? This will delete all data associated with this user.`,
      )
    ) {
      return;
    }
    try {
      const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');
      const applicationId = window.sessionStorage.getItem('Q_APPLICATION_ID');

      if (!applicationId) {
        throw new Error('Q application ID not found');
      }

      // Get and delete Q user, skipping if not found
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

      // Refresh the user list
      await fetchUsers();
    } catch (err) {
      console.error('Error deleting user:', err);
      setUsersError(err.message || 'Failed to delete user');
    } finally {
      setDeletingUser(null);
    }
  }
}
