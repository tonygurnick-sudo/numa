import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CognitoIdentityProvider } from '@aws-sdk/client-cognito-identity-provider';
import { AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { temporaryCredentials } from '../utils';

// Mock AWS SDK
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProvider: vi.fn(),
  ListUserPoolsCommand: vi.fn().mockImplementation((input) => ({ input })),
  ListUsersCommand: vi.fn().mockImplementation((input) => ({ input })),
  AdminUpdateUserAttributesCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

// Mock temporaryCredentials
vi.mock('../utils', () => ({
  temporaryCredentials: vi.fn(),
}));

const mockClientConfigProd = {
  'arcanum-dave': { clientAccountId: '905418183804', devInstance: false },
  'arcanum-demo': { clientAccountId: '123456789012', devInstance: true },
  'arcanum-demo-nick': { clientAccountId: '345678901234', devInstance: true },
  'arcanum-demo-sam': { clientAccountId: '456789012345', devInstance: true },
  'arcanum-hams': { clientAccountId: '678901234567', devInstance: false },
  'arcanum-prod-trial': { clientAccountId: '789012345678', devInstance: true },
  'arcanum-enterprise': { clientAccountId: '890123456789', devInstance: false },
  'arcanum-staging': { clientAccountId: '901234567890', devInstance: true },
};

vi.mock('../../clientConfigProd.json', () => ({
  default: mockClientConfigProd,
}));

vi.mock('node:process', () => ({
  argv: ['node', 'script.js'],
  slice: (start: number): string[] => ['node', 'script.js'].slice(start),
}));

interface MockCognitoClient {
  send: ReturnType<typeof vi.fn>;
}

function createMockUser(
  username: string,
  email: string,
): { Username: string; Attributes: { Name: string; Value: string }[] } {
  return {
    Username: username,
    Attributes: [{ Name: 'email', Value: email }],
  };
}

function createMockUserPool(clientName: string, accountId: string): { Id: string; Name: string } {
  return {
    Id: `pool-${accountId}`,
    Name: `numa-${clientName}`,
  };
}

function createMockUserPoolResponse(
  clientName: string,
  accountId: string,
): { UserPools: { Id: string; Name: string }[] } {
  return {
    UserPools: [createMockUserPool(clientName, accountId)],
  };
}

function createMockUsersResponse(users: { username: string; email: string }[]): {
  Users: ReturnType<typeof createMockUser>[];
} {
  return {
    Users: users.map((user) => createMockUser(user.username, user.email)),
  };
}

function setupMockResponsesForClient(
  mockCognitoClient: MockCognitoClient,
  clientName: string,
  config: { clientAccountId: string; devInstance: boolean },
  users: { username: string; email: string }[] = [],
): void {
  mockCognitoClient.send
    .mockResolvedValueOnce(createMockUserPoolResponse(clientName, config.clientAccountId))
    .mockResolvedValueOnce(createMockUsersResponse(users));
}

function setupMockResponsesForAllClients(
  mockCognitoClient: MockCognitoClient,
  clientConfig: typeof mockClientConfigProd,
  userData: Record<string, { username: string; email: string }[]> = {},
): void {
  Object.entries(clientConfig).forEach(([clientName, config]) => {
    setupMockResponsesForClient(mockCognitoClient, clientName, config, userData[clientName] || []);
  });
}

function setupMockCognitoClient(): MockCognitoClient {
  const mockCognitoClient = { send: vi.fn() };
  (CognitoIdentityProvider as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockCognitoClient);
  return mockCognitoClient;
}

function setupMockCredentials(): AwsCredentialIdentityProvider {
  const mockCredentials = {
    getCredentials: vi.fn().mockResolvedValue({
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
    }),
  } as unknown as AwsCredentialIdentityProvider;
  (temporaryCredentials as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockCredentials);
  return mockCredentials;
}

describe('check-email-cases', () => {
  let mockCognitoClient: MockCognitoClient;
  let mockCredentials: AwsCredentialIdentityProvider;
  let originalArgv: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    originalArgv = [...process.argv];
    mockCredentials = setupMockCredentials();
    mockCognitoClient = setupMockCognitoClient();
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  describe('findUserPoolId', () => {
    it('should find user pool ID for a valid client', async () => {
      const mockUserPools = [createMockUserPool('testClient', '123'), createMockUserPool('otherClient', '456')];

      mockCognitoClient.send.mockResolvedValueOnce({ UserPools: mockUserPools });

      const { findUserPoolId } = await import('../check-email-cases');
      const userPoolId = await findUserPoolId(mockCredentials, 'testClient');

      expect(userPoolId).toBe('pool-123');
      expect(mockCognitoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { MaxResults: 60 },
        }),
      );
    });

    it('should throw error when user pool not found', async () => {
      mockCognitoClient.send.mockResolvedValueOnce({ UserPools: [] });

      const { findUserPoolId } = await import('../check-email-cases');
      await expect(findUserPoolId(mockCredentials, 'nonexistent')).rejects.toThrow(
        'User pool numa-nonexistent not found',
      );
    });
  });

  describe('findUsersWithCapital', () => {
    it('should find users with capital letters in email', async () => {
      const mockUsers = [createMockUser('user1', 'User1@Example.com'), createMockUser('user2', 'user2@example.com')];

      mockCognitoClient.send.mockResolvedValueOnce({
        Users: mockUsers,
        PaginationToken: undefined,
      });

      const { findUsersWithCapital } = await import('../check-email-cases');
      const usersWithCapital = await findUsersWithCapital(mockCredentials, 'pool-123');

      expect(usersWithCapital).toHaveLength(1);
      expect(usersWithCapital[0]).toEqual({
        username: 'user1',
        userPoolId: 'pool-123',
      });
    });

    it('should handle pagination correctly', async () => {
      const mockUsers1 = [createMockUser('user1', 'User1@Example.com')];
      const mockUsers2 = [createMockUser('user2', 'User2@Example.com')];

      mockCognitoClient.send
        .mockResolvedValueOnce({ Users: mockUsers1, PaginationToken: 'token-123' })
        .mockResolvedValueOnce({ Users: mockUsers2, PaginationToken: undefined });

      const { findUsersWithCapital } = await import('../check-email-cases');
      const usersWithCapital = await findUsersWithCapital(mockCredentials, 'pool-123');

      expect(usersWithCapital).toHaveLength(2);
      expect(mockCognitoClient.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('fixUserEmail', () => {
    it('should convert email to lowercase', async () => {
      const { fixUserEmail } = await import('../check-email-cases');
      await fixUserEmail(mockCredentials, 'pool-123', 'user1', 'User1@Example.com');

      expect(mockCognitoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            UserPoolId: 'pool-123',
            Username: 'user1',
            UserAttributes: [{ Name: 'email', Value: 'user1@example.com' }],
          },
        }),
      );
    });
  });

  describe('processClients', () => {
    it('should process all clients and generate report', async () => {
      // Define user data for clients that should have capital emails
      const userData: Record<string, { username: string; email: string }[]> = {
        'arcanum-demo': [
          { username: 'user1', email: 'User1@Example.com' },
          { username: 'user2', email: 'User2@Example.com' },
        ],
        'arcanum-demo-sam': [{ username: 'user3', email: 'User3@Example.com' }],
        'arcanum-enterprise': [
          { username: 'user4', email: 'User4@Example.com' },
          { username: 'user5', email: 'User5@Example.com' },
        ],
      };

      // Setup mock responses dynamically
      setupMockResponsesForAllClients(mockCognitoClient, mockClientConfigProd, userData);

      const { processClients } = await import('../check-email-cases');
      const report = await processClients();

      expect(report.summary.totalClients).toBe(8);
      expect(report.summary.processedClients).toBe(8);
      expect(report.summary.errorClients).toBe(0);
      expect(report.summary.clientsWithCapitalEmails).toBe(3);
      expect(report.summary.totalUsersWithCapital).toBe(5);
      expect(report.results).toHaveLength(8);
    });

    it('should process only dev clients when --dev flag is used', async () => {
      const { processClients } = await import('../check-email-cases');
      const report = await processClients(undefined, { isDevOnly: true });

      expect(report.summary.totalClients).toBe(5);
      expect(report.summary.processedClients).toBe(5);
      expect(report.results.map((r) => r.clientName)).toEqual([
        'arcanum-demo',
        'arcanum-demo-nick',
        'arcanum-demo-sam',
        'arcanum-prod-trial',
        'arcanum-staging',
      ]);
    });

    it('should process a specific client', async () => {
      const targetClient = 'arcanum-dave';
      const mockUserPools = [createMockUserPool(targetClient, mockClientConfigProd[targetClient].clientAccountId)];

      mockCognitoClient.send.mockResolvedValueOnce({ UserPools: mockUserPools }).mockResolvedValueOnce({ Users: [] });

      const { processClients } = await import('../check-email-cases');
      const report = await processClients(targetClient);

      expect(report.summary.totalClients).toBe(1);
      expect(report.summary.processedClients).toBe(1);
      expect(report.results[0].clientName).toBe(targetClient);
    });

    it('should handle errors gracefully', async () => {
      const targetClient = 'arcanum-dave';
      const mockUserPools = [createMockUserPool(targetClient, mockClientConfigProd[targetClient].clientAccountId)];

      mockCognitoClient.send
        .mockResolvedValueOnce({ UserPools: mockUserPools })
        .mockRejectedValueOnce(new Error('Test error'));

      const { processClients } = await import('../check-email-cases');
      const report = await processClients(targetClient);

      expect(report.summary.errorClients).toBe(1);
      expect(report.results[0].error).toContain('Test error');
    });

    it('should fix capital letters in emails when --fix flag is used', async () => {
      const targetClient = 'arcanum-demo';
      const mockUserPools = [createMockUserPool(targetClient, mockClientConfigProd[targetClient].clientAccountId)];
      const mockUser = createMockUser('user1', 'User1@Example.com');

      mockCognitoClient.send
        .mockResolvedValueOnce({ UserPools: mockUserPools })
        .mockResolvedValueOnce({ Users: [mockUser] })
        .mockResolvedValueOnce({}); // fixUserEmail response

      const { processClients } = await import('../check-email-cases');
      const report = await processClients(targetClient, { shouldFix: true });

      expect(report.summary.totalClients).toBe(1);
      expect(report.summary.processedClients).toBe(1);
      expect(report.results[0].usersWithCapital).toHaveLength(1);
      expect(mockCognitoClient.send).toHaveBeenCalledTimes(3);
      expect(mockCognitoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            UserPoolId: `pool-${mockClientConfigProd[targetClient].clientAccountId}`,
            Username: 'user1',
            UserAttributes: [{ Name: 'email', Value: 'user1@example.com' }],
          },
        }),
      );
    });
  });
});
