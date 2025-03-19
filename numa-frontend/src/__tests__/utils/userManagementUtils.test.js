/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserManagementUtils } from '../../utils/userManagementUtils';

// Create mock functions
const mockSend = vi.fn();

// Mock the AWS SDK module
vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
  return {
    CognitoIdentityProviderClient: vi.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    AdminCreateUserCommand: vi.fn(),
    ListUsersCommand: vi.fn(),
  };
});

// Mock Math.random for consistent temporary password generation
vi.spyOn(Math, 'random').mockReturnValue(0.5);

describe('UserManagementUtils', () => {
  let userManagementUtils;
  const mockRegion = 'us-east-1';
  const mockCredentials = { accessKeyId: 'test', secretAccessKey: 'test' };
  const mockUserPoolId = 'us-east-1_testpool';
  const mockEmail = 'test@example.com';

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    // Create a new instance for each test
    userManagementUtils = new UserManagementUtils(mockRegion, mockCredentials);
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
      mockSend.mockResolvedValueOnce(mockResponse);

      // Execute
      const result = await userManagementUtils.createUser(mockEmail, mockUserPoolId);

      // Assert
      // Verify that send was called
      expect(mockSend).toHaveBeenCalled();

      expect(result).toHaveProperty('user', mockResponse.User);
      expect(result).toHaveProperty('temporaryPassword');
      expect(result.temporaryPassword).toBe('Welcomei!');
    });

    it('should handle user already exists error', async () => {
      // Setup
      const mockError = new Error('User already exists');
      mockError.name = 'UsernameExistsException';
      mockSend.mockRejectedValueOnce(mockError);

      // Execute & Assert
      await expect(userManagementUtils.createUser(mockEmail, mockUserPoolId)).rejects.toThrow(
        'A user with this email already exists',
      );
    });

    it('should propagate other errors', async () => {
      // Setup
      const mockError = new Error('Some other error');
      mockSend.mockRejectedValueOnce(mockError);

      // Execute & Assert
      await expect(userManagementUtils.createUser(mockEmail, mockUserPoolId)).rejects.toThrow('Some other error');
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

      mockSend.mockResolvedValueOnce(mockResponse);

      // Execute
      const result = await userManagementUtils.listUsers(mockUserPoolId);

      // Assert
      // Verify that send was called
      expect(mockSend).toHaveBeenCalled();

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
  });
});
