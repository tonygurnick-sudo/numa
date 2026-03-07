import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createHash, randomBytes } from 'crypto';

const CLIENT_NAME = process.env.CLIENT_NAME!;
const KEYS_TABLE = process.env.KEYS_TABLE_NAME!;
const REGION = process.env.REGION ?? 'us-east-1';

const ddbClient = new DynamoDBClient({ region: REGION });
const dynamo = DynamoDBDocumentClient.from(ddbClient);

/**
 * Generate a new API key with format: numa_{64 hex characters}
 */
const generateApiKey = (): string => {
  return `numa_${randomBytes(32).toString('hex')}`;
};

/**
 * Hash an API key with SHA-256 for secure storage
 */
const hashKey = (key: string): string => {
  return createHash('sha256').update(key).digest('hex');
};

/**
 * Lambda handler for seeding initial API key.
 * Invoked once during stack creation via Terraform LambdaInvocation.
 *
 * IMPORTANT: This logs the plaintext API key to CloudWatch.
 * Admins must retrieve it from logs on first deployment.
 */
export const handler = async () => {
  try {
    console.log(`Seeding API key for client: ${CLIENT_NAME}`);

    // Check if key already exists (idempotency)
    const existing = await dynamo.send(
      new GetCommand({
        TableName: KEYS_TABLE,
        Key: {
          PK: `CLIENT#${CLIENT_NAME}`,
          SK: 'KEY#active',
        },
      })
    );

    if (existing.Item) {
      console.log('API key already exists, skipping seed');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Already seeded' }),
      };
    }

    // Generate initial key
    const apiKey = generateApiKey();
    const keyHash = hashKey(apiKey);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days

    // Store hashed key
    await dynamo.send(
      new PutCommand({
        TableName: KEYS_TABLE,
        Item: {
          PK: `CLIENT#${CLIENT_NAME}`,
          SK: 'KEY#active',
          keyHash,
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          rotationCount: 0,
          createdBy: 'system',
          retentionMonths: 6, // Default retention: 6 months
        },
      })
    );

    console.log('Initial API key created successfully');

    // IMPORTANT: Log plaintext key for admin retrieval
    // This is the ONLY time the key is accessible
    console.log(`INITIAL_API_KEY=${apiKey}`);
    console.log(`KEY_EXPIRES_AT=${expiresAt.toISOString()}`);
    console.log('Retrieve this key from CloudWatch Logs and store it securely.');

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'API key seeded successfully',
        expiresAt: expiresAt.toISOString(),
      }),
    };
  } catch (error) {
    console.error('Failed to seed API key:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to seed API key',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
