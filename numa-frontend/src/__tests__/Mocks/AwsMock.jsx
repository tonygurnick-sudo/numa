import { vi } from 'vitest';

// Mock STS Client
export const mockSTSClient = {
  STSClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      Credentials: {
        AccessKeyId: 'mock-access-key',
        SecretAccessKey: 'mock-secret-key',
        SessionToken: 'mock-session-token',
        Expiration: new Date(Date.now() + 3600 * 1000),
      },
    }),
  })),
  AssumeRoleWithWebIdentityCommand: vi.fn(),
};

// Mock Cognito Identity Client
export const mockCognitoIdentityClient = {
  CognitoIdentityClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      IdentityId: 'mock-identity-id',
      Credentials: {
        AccessKeyId: 'mock-access-key',
        SecretAccessKey: 'mock-secret-key',
        SessionToken: 'mock-session-token',
        Expiration: new Date(Date.now() + 3600 * 1000),
      },
    }),
  })),
  GetIdCommand: vi.fn(),
  GetCredentialsForIdentityCommand: vi.fn(),
};

// Mock QBusiness Client
export const mockQBusinessClient = {
  QBusinessClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockImplementation((command) => {
      if (command.constructor.name === 'ListDataSourcesCommand') {
        return Promise.resolve({
          dataSources: [
            {
              dataSourceId: 'b5a0cf1e-99a8-4a74-b92c-3b0103a3b5b0',
              status: 'ACTIVE',
              updatedAt: new Date(),
            },
          ],
        });
      }
      if (command.constructor.name === 'ListDataSourceSyncJobsCommand') {
        return Promise.resolve({
          history: [
            {
              status: 'SUCCEEDED',
              endTime: new Date(),
              startTime: new Date(),
              metrics: {},
            },
          ],
        });
      }
      return Promise.resolve({});
    }),
  })),
  ListDataSourcesCommand: vi.fn(),
  StartDataSourceSyncJobCommand: vi.fn(),
  ListDataSourceSyncJobsCommand: vi.fn(),
};

// Mock QApps Client
export const mockQAppsClient = {
  QAppsClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
};

// Mock Credential Providers
export const mockCredentialProviders = {
  fromWebToken: vi.fn().mockImplementation(() => async () => ({
    accessKeyId: 'mock-access-key',
    secretAccessKey: 'mock-secret-key',
    sessionToken: 'mock-session-token',
  })),
};

// Mock Cognito Identity Provider Client
export const mockCognitoIdentityProviderClient = {
  CognitoIdentityProviderClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      Session: 'mock-session',
    }),
  })),
  RespondToAuthChallengeCommand: vi.fn(),
  InitiateAuthCommand: vi.fn(),
  ForgotPasswordCommand: vi.fn(),
  ConfirmForgotPasswordCommand: vi.fn(),
};

// Setup all mocks
export const setupAwsMocks = () => {
  vi.mock('@aws-sdk/client-sts', () => mockSTSClient);
  vi.mock('@aws-sdk/client-cognito-identity', () => mockCognitoIdentityClient);
  vi.mock('@aws-sdk/client-qbusiness', () => mockQBusinessClient);
  vi.mock('@aws-sdk/client-qapps', () => mockQAppsClient);
  vi.mock('@aws-sdk/credential-providers', () => mockCredentialProviders);
  vi.mock(
    '@aws-sdk/client-cognito-identity-provider',
    () => mockCognitoIdentityProviderClient,
  );
};
