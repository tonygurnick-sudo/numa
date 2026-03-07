import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'crypto';
import { validateUsageEvent } from '../../../lib/usage-analytics-schemas';
import { ZodError } from 'zod';

const REGION = process.env.REGION ?? 'us-east-1';
const CLIENT_NAME = process.env.CLIENT_NAME ?? '';
const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME ?? '';
const KEYS_TABLE = process.env.KEYS_TABLE_NAME ?? '';
const COUNTERS_TABLE = process.env.COUNTERS_TABLE_NAME ?? '';

const ddbClient = new DynamoDBClient({ region: REGION });
const dynamo = DynamoDBDocumentClient.from(ddbClient);

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,POST',
  'Access-Control-Allow-Headers': 'Content-Type,X-Analytics-API-Key',
  'Content-Type': 'application/json',
};

const respond = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body),
});

/**
 * Hash an API key with SHA-256 for secure comparison
 */
const hashKey = (key: string): string => {
  return createHash('sha256').update(key).digest('hex');
};

/**
 * Validate API key against stored hash and return retention setting
 */
const validateApiKey = async (key: string | undefined): Promise<{ valid: boolean; retentionMonths?: number }> => {
  if (!key) return { valid: false };

  const keyHash = hashKey(key);

  try {
    const result = await dynamo.send(
      new GetCommand({
        TableName: KEYS_TABLE,
        Key: {
          PK: `CLIENT#${CLIENT_NAME}`,
          SK: 'KEY#active',
        },
      })
    );

    const item = result.Item;
    if (!item || item.keyHash !== keyHash) {
      return { valid: false };
    }

    // Check expiry
    const expiresAt = new Date(item.expiresAt as string);
    if (expiresAt < new Date()) {
      return { valid: false };
    }

    // Update lastUsedAt (fire-and-forget)
    dynamo
      .send(
        new UpdateCommand({
          TableName: KEYS_TABLE,
          Key: {
            PK: `CLIENT#${CLIENT_NAME}`,
            SK: 'KEY#active',
          },
          UpdateExpression: 'SET lastUsedAt = :now',
          ExpressionAttributeValues: {
            ':now': new Date().toISOString(),
          },
        })
      )
      .catch((error) => console.error('Failed to update lastUsedAt:', error));

    return {
      valid: true,
      retentionMonths: (item.retentionMonths as number) ?? 6, // Default to 6 months
    };
  } catch (error) {
    console.error('API key validation error:', error);
    return { valid: false };
  }
};

/**
 * Calculate TTL timestamp (epoch seconds) based on retention months
 */
const calculateTTL = (eventTimestampMs: number, retentionMonths: number): number => {
  // Convert event timestamp from milliseconds to seconds
  const eventTimestampSec = Math.floor(eventTimestampMs / 1000);
  // Add retention period (approximate: 30 days per month)
  const retentionSeconds = retentionMonths * 30 * 24 * 60 * 60;
  return eventTimestampSec + retentionSeconds;
};

/**
 * Lambda handler for usage analytics event ingestion.
 * Validates API key and event schema before storing in DynamoDB.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return respond(200, null);
  }

  try {
    // 1. Validate API key and get retention setting
    const apiKey = event.headers?.['x-analytics-api-key'] || event.headers?.['X-Analytics-API-Key'];
    const validation = await validateApiKey(apiKey);

    if (!validation.valid) {
      return respond(401, { error: 'Invalid or expired API key' });
    }

    // 2. Parse and validate event
    const body = JSON.parse(event.body || '{}');
    const validatedEvent = validateUsageEvent(body);

    // 3. Calculate TTL based on retention setting
    const ttl = calculateTTL(validatedEvent.timestamp, validation.retentionMonths ?? 6);

    // 4. Store in DynamoDB
    const now = new Date().toISOString();
    await dynamo.send(
      new PutCommand({
        TableName: EVENTS_TABLE,
        Item: {
          // Partition key: user-based for performance and privacy
          PK: `USER#${validatedEvent.userId}`,

          // Sort key: chronological with unique ID
          SK: `EVENT#${validatedEvent.timestamp}#${validatedEvent.eventId}`,

          // Event fields
          eventType: validatedEvent.eventType,
          eventId: validatedEvent.eventId,
          timestamp: validatedEvent.timestamp,
          isTest: validatedEvent.isTest ? 'true' : 'false', // DynamoDB doesn't support bool in GSI
          eventData: validatedEvent.eventData,

          // TTL for automatic expiration
          ttl,

          // Audit fields
          createdAt: now,
          source: validatedEvent.source || 'test-api',

          // Display name — stored for UI rendering only, never used as a key
          ...(validatedEvent.userName ? { userName: validatedEvent.userName } : {}),
        },
      })
    );

    // 5. If this is a login event, atomically increment the counters table (fire-and-forget)
    if (validatedEvent.eventType === 'login') {
      const date = new Date(validatedEvent.timestamp).toISOString().slice(0, 10); // YYYY-MM-DD
      const counterField = validatedEvent.isTest ? 'testCount' : 'realCount';
      const hasName = !!validatedEvent.userName;
      dynamo
        .send(
          new UpdateCommand({
            TableName: COUNTERS_TABLE,
            Key: {
              PK: `USER#${validatedEvent.userId}`,
              SK: `EVENT#login#DATE#${date}`,
            },
            UpdateExpression: hasName
              ? 'ADD #count :one SET eventType = :type, #date = :date, userName = :uname'
              : 'ADD #count :one SET eventType = :type, #date = :date',
            ExpressionAttributeNames: { '#count': counterField, '#date': 'date' },
            ExpressionAttributeValues: {
              ':one': 1,
              ':type': 'login',
              ':date': date,
              ...(hasName ? { ':uname': validatedEvent.userName } : {}),
            },
          })
        )
        .catch((error) => console.error('Failed to increment login counter:', error));
    }

    return respond(200, {
      success: true,
      eventId: validatedEvent.eventId,
    });
  } catch (error) {
    console.error('Ingest error:', error);

    // Handle Zod validation errors
    if (error instanceof ZodError) {
      return respond(400, {
        error: 'Invalid event schema',
        details: error.format(),
      });
    }

    // Handle JSON parse errors
    if (error instanceof SyntaxError) {
      return respond(400, {
        error: 'Invalid JSON',
        message: error.message,
      });
    }

    return respond(500, {
      error: 'Internal server error',
    });
  }
};
