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
    send: vi.fn().mockResolvedValue({}),
  })),
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
