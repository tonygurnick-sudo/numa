import { vi } from 'vitest';

// Mock S3 Client
export const sendMock = vi.fn().mockResolvedValue({});

export const mockS3Client = {
  S3Client: vi.fn(() => ({
    send: sendMock,
  })),
  GetObjectCommand: vi.fn(),
};

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
              dataSourceId: 'mock-data-source-id',
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

// Mock JWT Decode
export const mockJwtDecode = vi.fn().mockImplementation((token) => {
  // Check if this is an expired token (based on the token content)
  const isExpiredToken = token && token.includes('eyJleHAiOjE2NDA5OTUyMDB9');

  const baseToken = {
    exp: isExpiredToken ? 1640995200 : 9999999999, // Use expired timestamp for expired tokens
    sub: 'test-user',
  };

  // If it's an ID token (contains more claims), add AWS tags structure
  if (token && token.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')) {
    return {
      ...baseToken,
      'https://aws.amazon.com/tags': {
        principal_tags: {
          Groups: ['admin'],
        },
      },
    };
  }

  return baseToken;
});

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
  vi.mock('@aws-sdk/client-s3', () => mockS3Client);
  vi.mock('@aws-sdk/client-sts', () => mockSTSClient);
  vi.mock('@aws-sdk/client-cognito-identity', () => mockCognitoIdentityClient);
  vi.mock('@aws-sdk/client-qbusiness', () => mockQBusinessClient);
  vi.mock('@aws-sdk/client-qapps', () => mockQAppsClient);
  vi.mock('@aws-sdk/credential-providers', () => mockCredentialProviders);
  vi.mock('@aws-sdk/client-cognito-identity-provider', () => mockCognitoIdentityProviderClient);
  vi.mock('jwt-decode', () => ({ jwtDecode: mockJwtDecode }));
};
