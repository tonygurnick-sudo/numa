import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export class UserManagementUtils {
  constructor(region, credentials) {
    this.cognitoClient = new CognitoIdentityProviderClient({
      region,
      credentials,
    });
  }

  /**
   * Creates a new user in Cognito with a temporary password
   * @param {string} email - Email address of the new user
   * @param {string} userPoolId - Cognito User Pool ID
   * @returns {Promise<Object>} - Object containing the user's details and temporary password
   */
  async createUser(email, userPoolId) {
    try {
      const lowercaseEmail = email.toLowerCase();
      console.log('Creating user with:', { email: lowercaseEmail, userPoolId });

      // Generate a secure temporary password
      const tempPassword = `Welcome${Math.random().toString(36).slice(2, 8)}!`;

      const command = new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: lowercaseEmail,
        TemporaryPassword: tempPassword,
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
        MessageAction: 'SUPPRESS', // We'll handle sending credentials ourselves
      });

      console.log('Sending create user command:', JSON.stringify(command, null, 2));
      const response = await this.cognitoClient.send(command);
      console.log('Cognito create user response:', JSON.stringify(response, null, 2));
      console.log('User sub:', response.User.Username);
      console.log('Login username should be:', lowercaseEmail);

      return {
        user: response.User,
        temporaryPassword: tempPassword,
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
}
