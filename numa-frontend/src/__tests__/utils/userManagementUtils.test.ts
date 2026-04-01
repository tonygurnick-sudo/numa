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

  const mockAdminSetUserPasswordCommand = function (params) {
    this.params = params;
    return this;
  };

  const mockListUsersCommand = function (params) {
    this.params = params;
    return this;
  };

  const mockListUsersInGroupCommand = function (params) {
    this.params = params;
    return this;
  };

  const mockDescribeUserPoolCommand = function (params) {
    this.params = params;
    return this;
  };

  return {
    CognitoIdentityProviderClient: vi.fn().mockImplementation(() => ({
      send: mockSend(),
    })),
    AdminCreateUserCommand: mockAdminCreateUserCommand,
    AdminSetUserPasswordCommand: mockAdminSetUserPasswordCommand,
    ListUsersCommand: mockListUsersCommand,
    ListUsersInGroupCommand: mockListUsersInGroupCommand,
    DescribeUserPoolCommand: mockDescribeUserPoolCommand,
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
      // Mock the send method for AdminSetUserPasswordCommand
      mockCognitoClient.send.mockResolvedValueOnce({});

      // Execute
      const result = await userManagementUtils.createUser(mockEmail, mockUserPoolId);

      // Debug
      console.log('mockCognitoClient.send calls:', mockCognitoClient.send.mock.calls);

      // Assert
      // Verify that send was called with correct parameters for user creation
      expect(mockCognitoClient.send).toHaveBeenNthCalledWith(
        1,
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
        })
      );

      // Verify that send was called with correct parameters for setting password
      expect(mockCognitoClient.send).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          params: expect.objectContaining({
            UserPoolId: mockUserPoolId,
            Username: mockEmail,
            Password: expect.any(String),
            Permanent: true,
          }),
        })
      );

      expect(result).toEqual({
        user: mockResponse.User,
      });
    });

    it('should handle user already exists error', async () => {
      // Setup
      const mockError = new Error('User already exists');
      mockError.name = 'UsernameExistsException';
      mockCognitoClient.send.mockRejectedValueOnce(mockError);

      // Execute & Assert
      await expect(userManagementUtils.createUser(mockEmail, mockUserPoolId)).rejects.toThrow(
        'A user with this email already exists'
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

      mockCognitoClient.send.mockResolvedValueOnce(mockResponse);
      mockCognitoClient.send.mockResolvedValueOnce({});

      const result = await userManagementUtils.createUser(email, userPoolId);

      // Verify the command was created with lowercase email for user creation
      expect(mockCognitoClient.send).toHaveBeenNthCalledWith(
        1,
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
        })
      );

      // Verify the command was created with lowercase email for password setting
      expect(mockCognitoClient.send).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          params: expect.objectContaining({
            UserPoolId: userPoolId,
            Username: email.toLowerCase(),
            Password: expect.any(String),
            Permanent: true,
          }),
        })
      );

      // Verify the response
      expect(result).toEqual({
        user: mockResponse.User,
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
        'A user with this email already exists'
      );
    });
  });

  describe('listUsers', () => {
    it('should list users with the correct format and pagination structure', async () => {
      // Setup
      const mockDate1 = new Date('2023-01-01');
      const mockDate2 = new Date('2023-01-02');

      // Mock response for ListUsersCommand
      const mockUsersResponse = {
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
        PaginationToken: 'next-token-123',
      };

      // Mock response for ListUsersInGroupCommand (admin group)
      const mockAdminUsersResponse = {
        Users: [
          {
            Username: 'user1', // user1 is an admin
          },
        ],
      };

      // Mock both API calls
      mockCognitoClient.send
        .mockResolvedValueOnce(mockUsersResponse) // ListUsersCommand
        .mockResolvedValueOnce(mockAdminUsersResponse); // ListUsersInGroupCommand

      // Execute
      const result = await userManagementUtils.listUsers(mockUserPoolId);

      // Assert
      expect(mockCognitoClient.send).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        users: [
          {
            username: 'user1',
            email: 'user1@example.com',
            enabled: true,
            groups: ['admin'], // user1 is admin
            status: 'CONFIRMED',
            created: mockDate1,
          },
          {
            username: 'user2',
            email: 'user2@example.com',
            enabled: false,
            groups: [], // user2 is not admin
            status: 'FORCE_CHANGE_PASSWORD',
            created: mockDate2,
          },
        ],
        nextToken: 'next-token-123',
        hasMore: true,
        total: 2,
      });
    });

    it('should list users with their attributes and pagination support', async () => {
      const userPoolId = 'us-east-1_testpool';

      // Mock response for ListUsersCommand
      const mockUsersResponse = {
        Users: [
          {
            Username: 'testuser@example.com',
            Enabled: true,
            UserStatus: 'CONFIRMED',
            UserCreateDate: new Date(),
            Attributes: [{ Name: 'email', Value: 'testuser@example.com' }],
          },
        ],
        PaginationToken: undefined, // No more pages
      };

      // Mock response for ListUsersInGroupCommand (no admin users)
      const mockAdminUsersResponse = {
        Users: [],
      };

      // Mock both API calls
      mockCognitoClient.send
        .mockResolvedValueOnce(mockUsersResponse) // ListUsersCommand
        .mockResolvedValueOnce(mockAdminUsersResponse); // ListUsersInGroupCommand

      const result = await userManagementUtils.listUsers(userPoolId);

      expect(mockCognitoClient.send).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        users: [
          {
            username: 'testuser@example.com',
            email: 'testuser@example.com',
            enabled: true,
            groups: [], // No admin users
            status: 'CONFIRMED',
            created: expect.any(Date),
          },
        ],
        nextToken: undefined,
        hasMore: false,
        total: 1,
      });
    });

    it('should handle pagination parameters correctly', async () => {
      const userPoolId = 'us-east-1_testpool';
      const limit = 10;
      const paginationToken = 'test-token';

      const mockUsersResponse = {
        Users: [],
        PaginationToken: undefined,
      };

      const mockAdminUsersResponse = {
        Users: [],
      };

      // Mock both API calls
      mockCognitoClient.send
        .mockResolvedValueOnce(mockUsersResponse) // ListUsersCommand
        .mockResolvedValueOnce(mockAdminUsersResponse); // ListUsersInGroupCommand

      await userManagementUtils.listUsers(userPoolId, limit, paginationToken);

      // Verify that the ListUsersCommand was called with correct parameters
      expect(mockCognitoClient.send).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          params: expect.objectContaining({
            UserPoolId: userPoolId,
            Limit: limit,
            PaginationToken: paginationToken,
          }),
        })
      );

      // Verify that the ListUsersInGroupCommand was called with correct parameters
      expect(mockCognitoClient.send).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          params: expect.objectContaining({
            UserPoolId: userPoolId,
            GroupName: 'admin',
          }),
        })
      );
    });
  });

  describe('getUsersInGroup', () => {
    it('should return users in a specific group', async () => {
      const userPoolId = 'us-east-1_testpool';
      const groupName = 'admin';

      const mockResponse = {
        Users: [{ Username: 'admin1@example.com' }, { Username: 'admin2@example.com' }],
      };

      mockCognitoClient.send.mockResolvedValueOnce(mockResponse);

      const result = await userManagementUtils.getUsersInGroup(userPoolId, groupName);

      expect(mockCognitoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            UserPoolId: userPoolId,
            GroupName: groupName,
          }),
        })
      );

      expect(result).toEqual(['admin1@example.com', 'admin2@example.com']);
    });

    it('should return empty array when group does not exist', async () => {
      const userPoolId = 'us-east-1_testpool';
      const groupName = 'nonexistent';

      const mockError = new Error('Group not found');
      mockError.name = 'ResourceNotFoundException';

      mockCognitoClient.send.mockRejectedValueOnce(mockError);

      const result = await userManagementUtils.getUsersInGroup(userPoolId, groupName);

      expect(result).toEqual([]);
    });

    it('should return empty array when group has no users', async () => {
      const userPoolId = 'us-east-1_testpool';
      const groupName = 'admin';

      const mockResponse = {
        Users: [],
      };

      mockCognitoClient.send.mockResolvedValueOnce(mockResponse);

      const result = await userManagementUtils.getUsersInGroup(userPoolId, groupName);

      expect(result).toEqual([]);
    });

    it('should propagate non-ResourceNotFoundException errors', async () => {
      const userPoolId = 'us-east-1_testpool';
      const groupName = 'admin';

      const mockError = new Error('Access denied');
      mockError.name = 'AccessDeniedException';

      mockCognitoClient.send.mockRejectedValueOnce(mockError);

      await expect(userManagementUtils.getUsersInGroup(userPoolId, groupName)).rejects.toThrow('Access denied');
    });
  });

  describe('listAllUsers', () => {
    it('should fetch all users across multiple Cognito pages', async () => {
      const userPoolId = 'us-east-1_testpool';
      const mockDate = new Date('2023-01-01');

      // Page 1 — has a pagination token
      const page1Response = {
        Users: [
          {
            Username: 'user1',
            Attributes: [{ Name: 'email', Value: 'user1@example.com' }],
            Enabled: true,
            UserStatus: 'CONFIRMED',
            UserCreateDate: mockDate,
          },
        ],
        PaginationToken: 'token-page-2',
      };

      // Page 2 — no more pages
      const page2Response = {
        Users: [
          {
            Username: 'user2',
            Attributes: [{ Name: 'email', Value: 'user2@example.com' }],
            Enabled: true,
            UserStatus: 'CONFIRMED',
            UserCreateDate: mockDate,
          },
        ],
        PaginationToken: undefined,
      };

      // Admin group response
      const adminGroupResponse = {
        Users: [{ Username: 'user1' }],
      };

      mockCognitoClient.send
        .mockResolvedValueOnce(adminGroupResponse) // getUsersInGroup
        .mockResolvedValueOnce(page1Response) // listAllUsers page 1
        .mockResolvedValueOnce(page2Response); // listAllUsers page 2

      const result = await userManagementUtils.listAllUsers(userPoolId);

      expect(result).toEqual([
        {
          username: 'user1',
          email: 'user1@example.com',
          enabled: true,
          groups: ['admin'],
          status: 'CONFIRMED',
          created: mockDate,
        },
        {
          username: 'user2',
          email: 'user2@example.com',
          enabled: true,
          groups: [],
          status: 'CONFIRMED',
          created: mockDate,
        },
      ]);

      // 1 call for admin group + 2 calls for user pages
      expect(mockCognitoClient.send).toHaveBeenCalledTimes(3);
    });

    it('should handle a single page of users', async () => {
      const userPoolId = 'us-east-1_testpool';

      const usersResponse = {
        Users: [
          {
            Username: 'solo-user',
            Attributes: [{ Name: 'email', Value: 'solo@example.com' }],
            Enabled: true,
            UserStatus: 'CONFIRMED',
            UserCreateDate: new Date(),
          },
        ],
        PaginationToken: undefined,
      };

      mockCognitoClient.send
        .mockResolvedValueOnce({ Users: [] }) // admin group (empty)
        .mockResolvedValueOnce(usersResponse); // single page

      const result = await userManagementUtils.listAllUsers(userPoolId);

      expect(result).toHaveLength(1);
      expect(result[0].username).toBe('solo-user');
      expect(result[0].groups).toEqual([]);
      expect(mockCognitoClient.send).toHaveBeenCalledTimes(2);
    });
  });
});
