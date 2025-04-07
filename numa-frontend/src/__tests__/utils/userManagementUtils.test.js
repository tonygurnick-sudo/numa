/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserManagementUtils } from '../../utils/userManagementUtils';

const mockSend = vi.hoisted(() => vi.fn());

// Mock the AWS SDK module
vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
  const mockAdminCreateUserCommand = function (params) {
    this.params = params;
    return this;
  };

  return {
    CognitoIdentityProviderClient: vi.fn().mockImplementation(() => ({
      send: mockSend(),
    })),
    AdminCreateUserCommand: mockAdminCreateUserCommand,
    ListUsersCommand: vi.fn(),
  };
});

// Mock Math.random for consistent temporary password generation
vi.spyOn(Math, 'random').mockReturnValue(0.5);

describe('UserManagementUtils', () => {
  let userManagementUtils;
  let mockCognitoClient;
  const mockRegion = 'us-east-1';
  const mockCredentials = { accessKeyId: 'test', secretAccessKey: 'test' };
  const mockUserPoolId = 'us-east-1_testpool';
  const mockEmail = 'test@example.com';

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    // Create a new instance for each test
    mockCognitoClient = {
      send: vi.fn(),
    };
    userManagementUtils = new UserManagementUtils(mockRegion, mockCredentials);
    userManagementUtils.cognitoClient = mockCognitoClient;
  });

  describe('createUser', () => {
    it('should create a user with the correct parameters', async () => {
      // Setup
      const mockResponse = {
        User: {
          Username: 'user-uuid',
          Attributes: [
            { Name: 'email', Value: mockEmail },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'sub', Value: 'user-uuid' },
          ],
          UserStatus: 'FORCE_CHANGE_PASSWORD',
        },
      };

      // Mock the send method to return our mock response
      mockCognitoClient.send.mockResolvedValueOnce(mockResponse);

      // Execute
      const result = await userManagementUtils.createUser(mockEmail, mockUserPoolId);

      // Debug
      console.log('mockCognitoClient.send calls:', mockCognitoClient.send.mock.calls);

      // Assert
      // Verify that send was called with correct parameters
      expect(mockCognitoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            UserPoolId: mockUserPoolId,
            Username: mockEmail,
            UserAttributes: expect.arrayContaining([
              {
                Name: 'email',
                Value: mockEmail,
              },
              {
                Name: 'email_verified',
                Value: 'true',
              },
            ]),
          }),
        }),
      );

      expect(result).toHaveProperty('user', mockResponse.User);
      expect(result).toHaveProperty('temporaryPassword');
      expect(result.temporaryPassword).toBe('Welcomei!');
    });

    it('should handle user already exists error', async () => {
      // Setup
      const mockError = new Error('User already exists');
      mockError.name = 'UsernameExistsException';
      mockCognitoClient.send.mockRejectedValueOnce(mockError);

      // Execute & Assert
      await expect(userManagementUtils.createUser(mockEmail, mockUserPoolId)).rejects.toThrow(
        'A user with this email already exists',
      );
    });

    it('should propagate other errors', async () => {
      // Setup
      const mockError = new Error('Some other error');
      mockCognitoClient.send.mockRejectedValueOnce(mockError);

      // Execute & Assert
      await expect(userManagementUtils.createUser(mockEmail, mockUserPoolId)).rejects.toThrow('Some other error');
    });

    it('should convert email to lowercase when creating a user', async () => {
      const email = 'TestUser@Example.com';
      const userPoolId = 'us-east-1_testpool';
      const mockResponse = {
        User: {
          Username: email.toLowerCase(),
          Attributes: [
            { Name: 'email', Value: email.toLowerCase() },
            { Name: 'email_verified', Value: 'true' },
          ],
        },
      };

      mockCognitoClient.send.mockResolvedValue(mockResponse);

      const result = await userManagementUtils.createUser(email, userPoolId);

      // Verify the command was created with lowercase email
      expect(mockCognitoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Username: email.toLowerCase(),
            UserAttributes: expect.arrayContaining([
              {
                Name: 'email',
                Value: email.toLowerCase(),
              },
            ]),
          }),
        }),
      );

      // Verify the response
      expect(result).toEqual({
        user: mockResponse.User,
        temporaryPassword: expect.any(String),
      });
    });

    it('should handle username exists error', async () => {
      const email = 'TestUser@Example.com';
      const userPoolId = 'us-east-1_testpool';

      mockCognitoClient.send.mockRejectedValue({
        name: 'UsernameExistsException',
        message: 'User already exists',
      });

      await expect(userManagementUtils.createUser(email, userPoolId)).rejects.toThrow(
        'A user with this email already exists',
      );
    });
  });

  describe('listUsers', () => {
    it('should list users with the correct format', async () => {
      // Setup
      const mockDate1 = new Date('2023-01-01');
      const mockDate2 = new Date('2023-01-02');

      const mockResponse = {
        Users: [
          {
            Username: 'user1',
            Attributes: [
              { Name: 'email', Value: 'user1@example.com' },
              { Name: 'sub', Value: 'user1-uuid' },
            ],
            Enabled: true,
            UserStatus: 'CONFIRMED',
            UserCreateDate: mockDate1,
          },
          {
            Username: 'user2',
            Attributes: [
              { Name: 'email', Value: 'user2@example.com' },
              { Name: 'sub', Value: 'user2-uuid' },
            ],
            Enabled: false,
            UserStatus: 'FORCE_CHANGE_PASSWORD',
            UserCreateDate: mockDate2,
          },
        ],
      };

      mockCognitoClient.send.mockResolvedValueOnce(mockResponse);

      // Execute
      const result = await userManagementUtils.listUsers(mockUserPoolId);

      // Assert
      // Verify that send was called
      expect(mockCognitoClient.send).toHaveBeenCalled();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        username: 'user1',
        email: 'user1@example.com',
        enabled: true,
        status: 'CONFIRMED',
        created: mockDate1,
      });
      expect(result[1]).toEqual({
        username: 'user2',
        email: 'user2@example.com',
        enabled: false,
        status: 'FORCE_CHANGE_PASSWORD',
        created: mockDate2,
      });
    });

    it('should list users with their attributes', async () => {
      const userPoolId = 'us-east-1_testpool';
      const mockResponse = {
        Users: [
          {
            Username: 'testuser@example.com',
            Enabled: true,
            UserStatus: 'CONFIRMED',
            UserCreateDate: new Date(),
            Attributes: [{ Name: 'email', Value: 'testuser@example.com' }],
          },
        ],
      };

      mockCognitoClient.send.mockResolvedValue(mockResponse);

      const result = await userManagementUtils.listUsers(userPoolId);

      expect(result).toEqual([
        {
          username: 'testuser@example.com',
          email: 'testuser@example.com',
          enabled: true,
          status: 'CONFIRMED',
          created: expect.any(Date),
        },
      ]);
    });
  });
});
