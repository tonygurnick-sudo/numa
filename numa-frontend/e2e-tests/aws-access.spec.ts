import { test, expect } from '@playwright/test';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  AdminListGroupsForUserCommand,
  AuthFlowType,
  ChallengeNameType,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import {
  QBusinessClient,
  SearchRelevantContentCommand,
  ListDataSourcesCommand,
  ListDataSourceSyncJobsCommand,
} from '@aws-sdk/client-qbusiness';
import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { DynamoDBClient, PutItemCommand, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { fromWebToken } from '@aws-sdk/credential-providers';
import { withPRM } from '../src/utils/prmUtils';
import { createSrpSession, signSrpSession } from 'cognito-srp-helper';
import { jwtDecode } from 'jwt-decode';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables from .env file
dotenv.config();

// Load configuration from config.json
const configPath = path.resolve(process.cwd(), 'public/config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Derive missing config values from existing ones
const derivedConfig = {
  ...config,
  // Company bucket is the same as data bucket for company context data
  COMPANY_BUCKET: config.COMPANY_BUCKET || `numa-${config.CLIENT_NAME}-company`,
  // Chat history table name can be derived from client name
  CHAT_HISTORY_TABLE_NAME: config.CHAT_HISTORY_TABLE_NAME || `numa-${config.CLIENT_NAME}-chat-history`,
};

/**
 * @typedef {Object} TestUser
 * @property {string} username
 * @property {string} password
 * @property {string[]} expectedGroups
 */

/**
 * @typedef {Object} AuthTokens
 * @property {string} [accessToken]
 * @property {string} [idToken]
 * @property {string} [refreshToken]
 */

// TypeScript interfaces for better type safety
interface DecodedJWTToken {
  sub: string;
  'cognito:groups'?: string[];
  'https://aws.amazon.com/tags'?: {
    principal_tags?: {
      username?: string[];
      Groups?: string[];
    };
  };
  [key: string]: unknown;
}

interface AWSOperationResult<T = unknown> {
  success: boolean;
  result?: T;
  error?: unknown;
}

// Test user configurations - these should match your actual test users
const TEST_USERS = {
  standard: {
    username: process.env.TEST_STANDARD_USERNAME || '',
    password: process.env.TEST_STANDARD_PASSWORD || '',
    expectedGroups: ['standard'],
  },
  admin: {
    username: process.env.TEST_ADMIN_USERNAME || '',
    password: process.env.TEST_ADMIN_PASSWORD || '',
    expectedGroups: ['admin'],
  },
};

// AWS clients
const cognitoClient = withPRM(CognitoIdentityProviderClient, { region: derivedConfig.REGION });

// Cache for authentication tokens to avoid re-authenticating for each test
const authCache = new Map();

// Cache for AWS credentials to avoid repeated STS calls
const credentialsCache = new Map();

// Function to fetch secret hash from API (same as AuthProvider)
async function fetchSecretHash(identifier: string): Promise<string> {
  const API_ENDPOINT = `https://${derivedConfig.CLIENT_NAME}.numa.arcanum.ai`;

  if (identifier !== identifier.toLowerCase()) {
    console.error('Uppercase email detected:', {
      original: identifier,
      lowercase: identifier.toLowerCase(),
    });
  }

  try {
    if (!identifier) {
      throw new Error('No identifier provided');
    }

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    const payload = isEmail ? { email: identifier } : { userSub: identifier };

    const secretHashResponse = await fetch(`${API_ENDPOINT}/api/srp-hasher`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!secretHashResponse.ok) {
      throw new Error(`HTTP error! status: ${secretHashResponse.status}`);
    }

    const data = await secretHashResponse.json();

    if (!data.hash) {
      throw new Error('Secret hash not received from server');
    }

    return data.hash;
  } catch (error) {
    console.error('Failed to fetch secret hash:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      identifierType: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier) ? 'email' : 'userSub',
      endpoint: `${API_ENDPOINT}/api/srp-hasher`,
    });
    throw new Error(`Failed to fetch secret hash: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// SRP Authentication function (same pattern as AuthProvider)
async function performSrpAuthentication(username: string, password: string) {
  const lowercaseUsername = username.toLowerCase();
  const SECRET_HASH = await fetchSecretHash(lowercaseUsername);

  const srpSession = createSrpSession(lowercaseUsername, password, derivedConfig.USER_POOL_ID, false);

  const initiateAuthParams = {
    AuthFlow: AuthFlowType.USER_SRP_AUTH,
    ClientId: derivedConfig.CLIENT_ID,
    AuthParameters: {
      USERNAME: lowercaseUsername,
      SRP_A: srpSession.largeA,
      SECRET_HASH: SECRET_HASH,
    },
  };

  const initiateAuthCommand = new InitiateAuthCommand(initiateAuthParams);
  const initiateAuthResponse = await cognitoClient.send(initiateAuthCommand);

  if (!initiateAuthResponse.ChallengeParameters) {
    throw new Error('Missing ChallengeParameters in InitiateAuthResponse');
  }

  const signedSrpSession = signSrpSession(srpSession, initiateAuthResponse);

  const respondToAuthChallengeParams = {
    ChallengeName: ChallengeNameType.PASSWORD_VERIFIER,
    ClientId: derivedConfig.CLIENT_ID,
    ChallengeResponses: {
      USERNAME: lowercaseUsername,
      PASSWORD_CLAIM_SECRET_BLOCK: signedSrpSession.secret,
      PASSWORD_CLAIM_SIGNATURE: signedSrpSession.passwordSignature,
      SECRET_HASH: SECRET_HASH,
      TIMESTAMP: signedSrpSession.timestamp,
    },
  };

  const respondToAuthChallengeCommand = new RespondToAuthChallengeCommand(respondToAuthChallengeParams);
  const respondToAuthChallengeResponse = await cognitoClient.send(respondToAuthChallengeCommand);

  if (respondToAuthChallengeResponse.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
    throw new Error('User requires new password - please set up test users with permanent passwords');
  }

  if (!respondToAuthChallengeResponse.AuthenticationResult) {
    throw new Error('Authentication failed - no AuthenticationResult received');
  }

  return {
    accessToken: respondToAuthChallengeResponse.AuthenticationResult.AccessToken,
    idToken: respondToAuthChallengeResponse.AuthenticationResult.IdToken,
    refreshToken: respondToAuthChallengeResponse.AuthenticationResult.RefreshToken,
  };
}

async function authenticateUser(userType: 'standard' | 'admin') {
  if (authCache.has(userType)) {
    const cached = authCache.get(userType);
    if (cached.accessToken && cached.idToken) {
      return cached;
    }
  }

  const user = TEST_USERS[userType];

  try {
    const tokens = await performSrpAuthentication(user.username, user.password);
    authCache.set(userType, tokens);
    return tokens;
  } catch (error) {
    console.error(`Failed to authenticate ${userType} user:`, error);
    throw new Error(
      `Authentication failed for ${userType} user: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// Extract groups and features from decoded token (same as AuthProvider)
function extractGroupsAndFeatures(decodedIdToken: DecodedJWTToken) {
  let groups = [...(decodedIdToken['cognito:groups'] || [])];

  if (!groups || groups.length === 0) {
    groups = ['standard'];
  }

  const features = groups.reduce((acc, group) => {
    const groupFeatures = derivedConfig.GROUPS[group]?.features || [];
    return [...acc, ...groupFeatures];
  }, []);

  return { groups, features };
}

async function getAWSCredentials(idToken: string, userGroups: string[] = ['standard']) {
  try {
    const userGroup = userGroups[0] || 'standard';
    const roleArn = derivedConfig.GROUPS[userGroup]?.roleArn;

    if (!roleArn) {
      throw new Error(`No role ARN found for user group: ${userGroup}`);
    }

    // Create cache key based on token and user group
    const cacheKey = `${userGroup}-${idToken.substring(0, 50)}`;

    // Check if credentials are cached and still valid
    if (credentialsCache.has(cacheKey)) {
      const cached = credentialsCache.get(cacheKey);
      // Simple expiration check - AWS credentials typically last 1 hour
      if (cached.expiration > Date.now()) {
        return cached;
      } else {
        credentialsCache.delete(cacheKey);
      }
    }

    // Decode the JWT token to get user information
    const decodedToken = jwtDecode<DecodedJWTToken>(idToken);

    // Extract username from the AWS tags claim that the token-adjuster sets
    const awsTags = decodedToken['https://aws.amazon.com/tags'];
    const principalTags = awsTags?.principal_tags;

    // The token-adjuster sets username to sub in the principal_tags
    const username = principalTags?.username?.[0] || decodedToken.sub;
    const decodedUserGroups = principalTags?.Groups || decodedToken['cognito:groups'] || [];

    if (!username) {
      throw new Error('No username found in JWT token');
    }

    const credentials = await fromWebToken({
      roleSessionName: 'numa-e2e-test',
      roleArn: roleArn,
      webIdentityToken: idToken,
      durationSeconds: 3600,
    })();

    const result = { credentials, username, userGroups: decodedUserGroups, expiration: Date.now() + 50 * 60 * 1000 }; // Cache for 50 minutes
    credentialsCache.set(cacheKey, result);

    return result;
  } catch (error) {
    console.error('Failed to get AWS credentials:', error);
    throw new Error(`AWS credentials failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Check environment variables
function checkEnvVariables() {
  const requiredVars = [
    'TEST_STANDARD_USERNAME',
    'TEST_STANDARD_PASSWORD',
    'TEST_ADMIN_USERNAME',
    'TEST_ADMIN_PASSWORD',
  ];

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  return missingVars.length === 0;
}

// Helper function to safely test AWS operations
async function testAWSOperation<T = unknown>(
  operation: () => Promise<T>,
  operationName: string,
  shouldSucceed: boolean = true
): Promise<AWSOperationResult<T>> {
  try {
    const result = await operation();
    if (!shouldSucceed) {
      console.warn(`Expected ${operationName} to fail, but it succeeded`);
    }
    return { success: true, result };
  } catch (error) {
    if (shouldSucceed) {
      console.error(`Expected ${operationName} to succeed, but it failed:`, error);
      return { success: false, error };
    } else {
      return { success: false, error };
    }
  }
}

// Skip entire test suite if environment variables are missing
const shouldSkipTests = !checkEnvVariables();

test.describe('AWS Access Permission Tests', () => {
  test.beforeAll(() => {
    if (shouldSkipTests) {
      console.log('Skipping AWS Access tests - required environment variables not found');
      return;
    }
  });

  test.describe('Cognito Authentication Tests', () => {
    test('standard user can authenticate and has correct group membership', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.idToken).toBeDefined();

      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups, features } = extractGroupsAndFeatures(decodedIdToken);

      expect(groups).toContain('standard');
      expect(features).toContain('chat');
      expect(features).toContain('useCompanyData');
    });

    test('admin user can authenticate and has correct group membership', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('admin');
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.idToken).toBeDefined();

      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups, features } = extractGroupsAndFeatures(decodedIdToken);

      expect(groups).toContain('admin');
      expect(features).toContain('chat');
      expect(features).toContain('useCompanyData');
      expect(features).toContain('deleteFromCompanyData');
      expect(features).toContain('addToCompanyData');
      expect(features).toContain('manageUsers');
    });
  });

  test.describe('Chat Feature Set Tests', () => {
    test('standard user can access outputs bucket with user-specific prefix', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials, username } = await getAWSCredentials(tokens.idToken, groups);

      const s3Client = withPRM(S3Client, {
        region: derivedConfig.REGION,
        credentials,
      });

      const result = await testAWSOperation(async () => {
        const putCommand = new PutObjectCommand({
          Bucket: derivedConfig.OUTPUTS_BUCKET_NAME,
          Key: `outputs/${username}/test-chat-output-${Date.now()}.txt`,
          Body: 'Test chat output',
        });
        return await s3Client.send(putCommand);
      }, 'outputs bucket access for standard user');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result?.$metadata.httpStatusCode).toBe(200);
      }
    });

    test('standard user cannot access outputs bucket outside their prefix', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const s3Client = withPRM(S3Client, {
        region: derivedConfig.REGION,
        credentials,
      });

      const result = await testAWSOperation(
        async () => {
          const putCommand = new PutObjectCommand({
            Bucket: derivedConfig.OUTPUTS_BUCKET_NAME,
            Key: `outputs/other-user/test-file.txt`,
            Body: 'Test content',
          });
          return await s3Client.send(putCommand);
        },
        'access to other user outputs path',
        false
      );

      expect(result.success).toBe(false);
    });

    test('standard user can access company context data', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const s3Client = withPRM(S3Client, {
        region: derivedConfig.REGION,
        credentials,
      });

      const result = await testAWSOperation(async () => {
        const getCommand = new GetObjectCommand({
          Bucket: derivedConfig.COMPANY_BUCKET,
          Key: 'company-data.json',
        });
        return await s3Client.send(getCommand);
      }, 'company context access for standard user');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result?.$metadata.httpStatusCode).toBe(200);
      }
    });

    test('standard user can access chat history with row-level security', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials, username } = await getAWSCredentials(tokens.idToken, groups);

      const dynamoClient = new DynamoDBClient({
        region: derivedConfig.REGION,
        credentials,
      });

      const result = await testAWSOperation(async () => {
        const conversationId = `test-conversation-${Date.now()}`;
        const timestamp = Date.now();
        const sk = `${conversationId}#${timestamp}`;

        const putCommand = new PutItemCommand({
          TableName: derivedConfig.CHAT_HISTORY_TABLE_NAME,
          Item: {
            user_id: { S: username },
            sk: { S: sk },
            conversation_id: { S: conversationId },
            timestamp: { N: timestamp.toString() },
            message_type: { S: 'text' },
            role: { S: 'user' },
            content: { S: 'Test message' },
          },
        });
        return await dynamoClient.send(putCommand);
      }, 'chat history access for standard user');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result?.$metadata.httpStatusCode).toBe(200);
      }
    });
  });

  test.describe('Use Company Data Feature Set Tests', () => {
    test('standard user can list and read from data bucket', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const s3Client = withPRM(S3Client, {
        region: derivedConfig.REGION,
        credentials,
      });

      const listResult = await testAWSOperation(async () => {
        const listCommand = new ListObjectsV2Command({
          Bucket: derivedConfig.DATA_BUCKET,
          MaxKeys: 1,
        });
        return await s3Client.send(listCommand);
      }, 'data bucket list for standard user');

      expect(listResult.success).toBe(true);
      if (listResult.success) {
        expect(listResult.result?.$metadata.httpStatusCode).toBe(200);

        if (listResult.result?.Contents && listResult.result.Contents.length > 0) {
          const getResult = await testAWSOperation(async () => {
            const getCommand = new GetObjectCommand({
              Bucket: derivedConfig.DATA_BUCKET,
              Key: listResult.result.Contents[0].Key,
            });
            return await s3Client.send(getCommand);
          }, 'data bucket get object for standard user');

          expect(getResult.success).toBe(true);
          if (getResult.success) {
            expect(getResult.result?.$metadata.httpStatusCode).toBe(200);
          }
        }
      }
    });

    test('standard user can search company data via Q Business', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');
      test.setTimeout(30000);

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const qClient = new QBusinessClient({
        region: derivedConfig.REGION,
        credentials,
      });

      const result = await testAWSOperation(async () => {
        const searchCommand = new SearchRelevantContentCommand({
          applicationId: derivedConfig.Q_APPLICATION_ID,
          queryText: 'test query',
          maxResults: 1,
          contentSource: {
            retriever: {
              retrieverId: derivedConfig.Q_RETRIEVER_ID,
            },
          },
        });
        return await qClient.send(searchCommand);
      }, 'Q Business search for standard user');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result?.$metadata.httpStatusCode).toBe(200);
      }
    });

    test('standard user can list Q Business data sources and sync jobs', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const qClient = new QBusinessClient({
        region: derivedConfig.REGION,
        credentials,
      });

      const dataSourcesResult = await testAWSOperation(async () => {
        const listDataSourcesCommand = new ListDataSourcesCommand({
          applicationId: derivedConfig.Q_APPLICATION_ID,
          indexId: derivedConfig.Q_INDEX_ID,
          maxResults: 10,
        });
        return await qClient.send(listDataSourcesCommand);
      }, 'Q Business data sources list for standard user');

      expect(dataSourcesResult.success).toBe(true);
      if (dataSourcesResult.success) {
        expect(dataSourcesResult.result?.$metadata.httpStatusCode).toBe(200);

        if (dataSourcesResult.result?.dataSources && dataSourcesResult.result.dataSources.length > 0) {
          const syncJobsResult = await testAWSOperation(async () => {
            const listSyncJobsCommand = new ListDataSourceSyncJobsCommand({
              applicationId: derivedConfig.Q_APPLICATION_ID,
              indexId: derivedConfig.Q_INDEX_ID,
              dataSourceId: dataSourcesResult.result.dataSources[0].dataSourceId,
              maxResults: 10,
            });
            return await qClient.send(listSyncJobsCommand);
          }, 'Q Business sync jobs list for standard user');

          expect(syncJobsResult.success).toBe(true);
          if (syncJobsResult.success) {
            expect(syncJobsResult.result?.$metadata.httpStatusCode).toBe(200);
          }
        }
      }
    });

    test('standard user can access Bedrock knowledge base read operations', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const bedrockClient = new BedrockAgentRuntimeClient({
        region: derivedConfig.REGION,
        credentials,
      });

      const result = await testAWSOperation(async () => {
        const retrieveCommand = new RetrieveCommand({
          knowledgeBaseId: derivedConfig.BEDROCK_KNOWLEDGE_BASE_ID,
          retrievalQuery: {
            text: 'test query',
          },
          retrievalConfiguration: {
            vectorSearchConfiguration: {
              numberOfResults: 1,
            },
          },
        });
        return await bedrockClient.send(retrieveCommand);
      }, 'Bedrock knowledge base retrieve for standard user');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result?.$metadata.httpStatusCode).toBe(200);
      }
    });
  });

  test.describe('Delete from Company Data Feature Set Tests', () => {
    test('standard user cannot delete from data bucket', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const s3Client = withPRM(S3Client, {
        region: derivedConfig.REGION,
        credentials,
      });

      const result = await testAWSOperation(
        async () => {
          const deleteCommand = new DeleteObjectCommand({
            Bucket: derivedConfig.DATA_BUCKET,
            Key: 'test-file-that-may-not-exist.txt',
          });
          return await s3Client.send(deleteCommand);
        },
        'data bucket delete for standard user',
        false
      );

      expect(result.success).toBe(false);
    });

    test('admin user can delete from data bucket', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('admin');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const s3Client = withPRM(S3Client, {
        region: derivedConfig.REGION,
        credentials,
      });

      const testKey = `test-files/delete-test-${Date.now()}.txt`;
      const putResult = await testAWSOperation(async () => {
        const putCommand = new PutObjectCommand({
          Bucket: derivedConfig.DATA_BUCKET,
          Key: testKey,
          Body: 'This file will be deleted',
        });
        return await s3Client.send(putCommand);
      }, 'data bucket put for admin user');

      expect(putResult.success).toBe(true);
      if (putResult.success) {
        expect(putResult.result?.$metadata.httpStatusCode).toBe(200);

        const deleteResult = await testAWSOperation(async () => {
          const deleteCommand = new DeleteObjectCommand({
            Bucket: derivedConfig.DATA_BUCKET,
            Key: testKey,
          });
          return await s3Client.send(deleteCommand);
        }, 'data bucket delete for admin user');

        expect(deleteResult.success).toBe(true);
        if (deleteResult.success) {
          expect(deleteResult.result?.$metadata.httpStatusCode).toBe(204);
        }
      }
    });
  });

  test.describe('Add to Company Data Feature Set Tests', () => {
    test('standard user cannot add to data bucket', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const s3Client = withPRM(S3Client, {
        region: derivedConfig.REGION,
        credentials,
      });

      const result = await testAWSOperation(
        async () => {
          const putCommand = new PutObjectCommand({
            Bucket: derivedConfig.DATA_BUCKET,
            Key: `test-files/standard-user-upload-${Date.now()}.txt`,
            Body: 'This should fail for standard users',
          });
          return await s3Client.send(putCommand);
        },
        'data bucket put for standard user',
        false
      );

      expect(result.success).toBe(false);
    });

    test('admin user can add to data bucket', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('admin');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const s3Client = withPRM(S3Client, {
        region: derivedConfig.REGION,
        credentials,
      });

      const result = await testAWSOperation(async () => {
        const putCommand = new PutObjectCommand({
          Bucket: derivedConfig.DATA_BUCKET,
          Key: `test-files/admin-upload-${Date.now()}.txt`,
          Body: 'This is a test file uploaded by admin user',
        });
        return await s3Client.send(putCommand);
      }, 'data bucket put for admin user');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result?.$metadata.httpStatusCode).toBe(200);
      }
    });
  });

  test.describe('Manage Users Feature Set Tests', () => {
    test('standard user cannot manage other users', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const cognitoClient = new CognitoIdentityProviderClient({
        region: derivedConfig.REGION,
        credentials,
      });

      const result = await testAWSOperation(
        async () => {
          const listUsersCommand = new AdminListGroupsForUserCommand({
            UserPoolId: derivedConfig.USER_POOL_ID,
            Username: TEST_USERS.admin.username,
          });
          return await cognitoClient.send(listUsersCommand);
        },
        'user management for standard user',
        false
      );

      expect(result.success).toBe(false);
    });

    test('admin user can manage users', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('admin');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const cognitoClient = new CognitoIdentityProviderClient({
        region: derivedConfig.REGION,
        credentials,
      });

      const result = await testAWSOperation(async () => {
        const getUserCommand = new AdminListGroupsForUserCommand({
          UserPoolId: derivedConfig.USER_POOL_ID,
          Username: TEST_USERS.standard.username,
        });
        return await cognitoClient.send(getUserCommand);
      }, 'user management for admin user');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result?.$metadata.httpStatusCode).toBe(200);
      }
    });
  });

  test.describe('Bedrock Knowledge Base Access Tests', () => {
    test('standard user can access Bedrock knowledge base read operations', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const bedrockClient = new BedrockAgentRuntimeClient({
        region: derivedConfig.REGION,
        credentials,
      });

      const result = await testAWSOperation(async () => {
        const retrieveCommand = new RetrieveCommand({
          knowledgeBaseId: derivedConfig.BEDROCK_KNOWLEDGE_BASE_ID,
          retrievalQuery: {
            text: 'test query',
          },
          retrievalConfiguration: {
            vectorSearchConfiguration: {
              numberOfResults: 1,
            },
          },
        });
        return await bedrockClient.send(retrieveCommand);
      }, 'Bedrock knowledge base retrieve for standard user');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result?.$metadata.httpStatusCode).toBe(200);
      }
    });
  });

  test.describe('Negative Access Tests - Cross-User Data Access', () => {
    test('standard user cannot access admin users outputs directory', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');
      test.setTimeout(15000);

      // First, have admin user create a file in their outputs directory
      const adminTokens = await authenticateUser('admin');
      const adminDecoded = jwtDecode(adminTokens.idToken);
      const { groups: adminGroups } = extractGroupsAndFeatures(adminDecoded);
      const { credentials: adminCredentials, username: adminUsername } = await getAWSCredentials(
        adminTokens.idToken,
        adminGroups
      );

      const adminS3Client = withPRM(S3Client, {
        region: derivedConfig.REGION,
        credentials: adminCredentials,
      });

      const adminTestKey = `outputs/${adminUsername}/admin-secret-${Date.now()}.txt`;
      await adminS3Client.send(
        new PutObjectCommand({
          Bucket: derivedConfig.OUTPUTS_BUCKET_NAME,
          Key: adminTestKey,
          Body: 'Admin secret output data',
        })
      );

      // Now try to access it as standard user - this should fail due to IAM path restriction
      const standardTokens = await authenticateUser('standard');
      const standardDecoded = jwtDecode(standardTokens.idToken);
      const { groups: standardGroups } = extractGroupsAndFeatures(standardDecoded);
      const { credentials: standardCredentials } = await getAWSCredentials(standardTokens.idToken, standardGroups);

      const standardS3Client = withPRM(S3Client, {
        region: derivedConfig.REGION,
        credentials: standardCredentials,
      });

      const result = await testAWSOperation(
        async () => {
          const getCommand = new GetObjectCommand({
            Bucket: derivedConfig.OUTPUTS_BUCKET_NAME,
            Key: adminTestKey, // Trying to access admin's file
          });
          return await standardS3Client.send(getCommand);
        },
        'standard user accessing admin outputs',
        false
      );

      expect(result.success).toBe(false);
    });

    test('standard user cannot access admin users chat history', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      // First, have admin user create some chat history
      const adminTokens = await authenticateUser('admin');
      const adminDecoded = jwtDecode(adminTokens.idToken);
      const { groups: adminGroups } = extractGroupsAndFeatures(adminDecoded);
      const { credentials: adminCredentials, username: adminUsername } = await getAWSCredentials(
        adminTokens.idToken,
        adminGroups
      );

      const adminDynamoClient = new DynamoDBClient({
        region: derivedConfig.REGION,
        credentials: adminCredentials,
      });

      const adminConversationId = `admin-conversation-${Date.now()}`;
      const adminTimestamp = Date.now();
      const adminSk = `${adminConversationId}#${adminTimestamp}`;

      await adminDynamoClient.send(
        new PutItemCommand({
          TableName: derivedConfig.CHAT_HISTORY_TABLE_NAME,
          Item: {
            user_id: { S: adminUsername },
            sk: { S: adminSk },
            conversation_id: { S: adminConversationId },
            timestamp: { N: adminTimestamp.toString() },
            message_type: { S: 'text' },
            role: { S: 'user' },
            content: { S: 'Admin secret message' },
          },
        })
      );

      // Now try to access it as standard user - this should fail due to row-level security
      const standardTokens = await authenticateUser('standard');
      const standardDecoded = jwtDecode(standardTokens.idToken);
      const { groups: standardGroups } = extractGroupsAndFeatures(standardDecoded);
      const { credentials: standardCredentials } = await getAWSCredentials(standardTokens.idToken, standardGroups);

      const standardDynamoClient = new DynamoDBClient({
        region: derivedConfig.REGION,
        credentials: standardCredentials,
      });

      // Try to read admin's chat history - this should fail
      const result = await testAWSOperation(
        async () => {
          const queryCommand = new QueryCommand({
            TableName: derivedConfig.CHAT_HISTORY_TABLE_NAME,
            KeyConditionExpression: 'user_id = :user_id',
            ExpressionAttributeValues: {
              ':user_id': { S: adminUsername }, // Trying to access admin's data
            },
            Limit: 1,
          });
          return await standardDynamoClient.send(queryCommand);
        },
        'standard user accessing admin chat history',
        false
      );

      expect(result.success).toBe(false);
    });

    test('standard user can only list their own outputs directory prefix', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const s3Client = withPRM(S3Client, {
        region: derivedConfig.REGION,
        credentials,
      });

      // Try to list all outputs (without user prefix) - should fail
      const listAllResult = await testAWSOperation(
        async () => {
          const listCommand = new ListObjectsV2Command({
            Bucket: derivedConfig.OUTPUTS_BUCKET_NAME,
            Prefix: 'outputs/', // Trying to list all users' outputs
            MaxKeys: 100,
          });
          return await s3Client.send(listCommand);
        },
        'standard user listing all outputs directory',
        false
      );

      expect(listAllResult.success).toBe(false);
    });

    test('standard user cannot write to company bucket', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const s3Client = withPRM(S3Client, {
        region: derivedConfig.REGION,
        credentials,
      });

      // Try to write to company bucket - should fail as only GetObject allowed
      const result = await testAWSOperation(
        async () => {
          const putCommand = new PutObjectCommand({
            Bucket: derivedConfig.COMPANY_BUCKET,
            Key: `unauthorized-file-${Date.now()}.txt`,
            Body: 'Attempting to write to company bucket',
          });
          return await s3Client.send(putCommand);
        },
        'standard user writing to company bucket',
        false
      );

      expect(result.success).toBe(false);
    });

    test('standard user cannot scan entire chat history table', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const dynamoClient = new DynamoDBClient({
        region: derivedConfig.REGION,
        credentials,
      });

      // Try to scan entire table - should fail due to row-level security conditions
      const result = await testAWSOperation(
        async () => {
          const scanCommand = new ScanCommand({
            TableName: derivedConfig.CHAT_HISTORY_TABLE_NAME,
            Limit: 10,
          });
          return await dynamoClient.send(scanCommand);
        },
        'standard user scanning entire chat history table',
        false
      );

      expect(result.success).toBe(false);
    });

    test('standard user cannot perform Cognito user management operations', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const cognitoClient = new CognitoIdentityProviderClient({
        region: derivedConfig.REGION,
        credentials,
      });

      // Try to list users - should fail as manageUsers feature not available to standard users
      const result = await testAWSOperation(
        async () => {
          const listCommand = new ListUsersCommand({
            UserPoolId: derivedConfig.USER_POOL_ID,
            Limit: 1,
          });
          return await cognitoClient.send(listCommand);
        },
        'standard user listing Cognito users',
        false
      );

      expect(result.success).toBe(false);
    });

    test('standard user cannot access company bucket unauthorized paths', async () => {
      test.skip(shouldSkipTests, 'Required environment variables not found');

      const tokens = await authenticateUser('standard');
      const decodedIdToken = jwtDecode(tokens.idToken);
      const { groups } = extractGroupsAndFeatures(decodedIdToken);
      const { credentials } = await getAWSCredentials(tokens.idToken, groups);

      const s3Client = withPRM(S3Client, {
        region: derivedConfig.REGION,
        credentials,
      });

      // First, create test files as admin to ensure they exist
      const adminTokens = await authenticateUser('admin');
      const adminDecoded = jwtDecode(adminTokens.idToken);
      const { groups: adminGroups } = extractGroupsAndFeatures(adminDecoded);
      const { credentials: adminCredentials } = await getAWSCredentials(adminTokens.idToken, adminGroups);

      const adminS3Client = withPRM(S3Client, {
        region: derivedConfig.REGION,
        credentials: adminCredentials,
      });

      const testFiles = ['test-config.json', 'admin/test-settings.json'];

      // Create test files (if admin has write access to company bucket)
      for (const fileName of testFiles) {
        try {
          await adminS3Client.send(
            new PutObjectCommand({
              Bucket: derivedConfig.COMPANY_BUCKET,
              Key: fileName,
              Body: 'Test content for unauthorized access test',
            })
          );
        } catch {
          console.log(`Could not create test file ${fileName} for unauthorized access test`);
        }
      }

      // Now test that standard user cannot access these files
      for (const fileName of testFiles) {
        const result = await testAWSOperation(
          async () => {
            const getCommand = new GetObjectCommand({
              Bucket: derivedConfig.COMPANY_BUCKET,
              Key: fileName,
            });
            return await s3Client.send(getCommand);
          },
          `standard user accessing unauthorized company file: ${fileName}`,
          false
        );

        expect(result.success).toBe(false);
      }
    });
  });
});
