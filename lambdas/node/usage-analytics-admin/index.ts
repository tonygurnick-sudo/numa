import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  BatchWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { createHash, randomBytes } from 'crypto';

const REGION = process.env.REGION ?? 'us-east-1';
const CLIENT_NAME = process.env.CLIENT_NAME ?? '';
const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME ?? '';
const KEYS_TABLE = process.env.KEYS_TABLE_NAME ?? '';
const COUNTERS_TABLE = process.env.COUNTERS_TABLE_NAME ?? '';

const ddbClient = new DynamoDBClient({ region: REGION });
const dynamo = DynamoDBDocumentClient.from(ddbClient);

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
};

const respond = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body),
});

/**
 * Parse JWT token without verification (Cognito already verified it)
 */
const parseJwt = (token: string): Record<string, unknown> => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return {};
  }
};

/**
 * Check if user is in admin group
 */
const isAdmin = (event: APIGatewayProxyEventV2): boolean => {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return false;

  const token = String(auth).replace(/^Bearer\s+/i, '');
  const claims = parseJwt(token);
  const groups = (claims['cognito:groups'] as string[]) || [];

  return groups.includes('admin');
};

/**
 * Generate a new API key with format: numa_{64 hex characters}
 */
const generateApiKey = (): string => {
  return `numa_${randomBytes(32).toString('hex')}`;
};

/**
 * Hash an API key with SHA-256
 */
const hashKey = (key: string): string => {
  return createHash('sha256').update(key).digest('hex');
};

/**
 * GET /api/usage-analytics/events
 * List events with filters and pagination
 */
const listEvents = async (event: APIGatewayProxyEventV2) => {
  const params = event.queryStringParameters || {};
  const limit = Math.min(parseInt(params.limit || '50'), 100);
  const eventTypeFilter = params.eventType;
  const isTestFilter = params.isTest === 'true' ? 'true' : params.isTest === 'false' ? 'false' : undefined;
  const exclusiveStartKey = params.nextToken
    ? JSON.parse(Buffer.from(params.nextToken, 'base64').toString())
    : undefined;

  try {
    // Build filter expression
    const filterExpressions: string[] = [];
    const expressionAttributeValues: Record<string, string> = {};

    if (eventTypeFilter) {
      filterExpressions.push('eventType = :eventType');
      expressionAttributeValues[':eventType'] = eventTypeFilter;
    }

    if (isTestFilter !== undefined) {
      filterExpressions.push('isTest = :isTest');
      expressionAttributeValues[':isTest'] = isTestFilter;
    }

    // Use Scan for now (Stage 1 - limited test data)
    // Stage 2 will optimize with GSI queries
    const result = await dynamo.send(
      new ScanCommand({
        TableName: EVENTS_TABLE,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
        FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
        ExpressionAttributeValues:
          Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
      })
    );

    const nextToken = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined;

    // Transform DynamoDB items to expected format (extract userId from PK)
    const events = (result.Items || []).map((item) => {
      // Extract userId from PK: "USER#12345-uuid" -> "12345-uuid"
      const userId = item.PK?.replace(/^USER#/, '') || 'unknown';

      return {
        eventType: item.eventType,
        eventId: item.eventId,
        timestamp: item.timestamp,
        isTest: item.isTest === 'true', // Convert string back to boolean
        userId,
        userName: item.userName as string | undefined,
        source: item.source || 'unknown',
        eventData: item.eventData,
      };
    });

    return respond(200, {
      events,
      nextToken,
      count: events.length,
    });
  } catch (error) {
    console.error('List events error:', error);
    return respond(500, { error: 'Failed to list events' });
  }
};

/**
 * DELETE /api/usage-analytics/test-data
 * Bulk delete all test events
 */
const deleteTestData = async () => {
  try {
    let deletedCount = 0;
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    // Query TestDataIndex GSI for all isTest=true events
    do {
      const result = await dynamo.send(
        new QueryCommand({
          TableName: EVENTS_TABLE,
          IndexName: 'TestDataIndex',
          KeyConditionExpression: 'isTest = :isTest',
          ExpressionAttributeValues: {
            ':isTest': 'true',
          },
          ExclusiveStartKey: lastEvaluatedKey,
          Limit: 25, // DynamoDB BatchWriteItem max
        })
      );

      const items = result.Items || [];
      if (items.length > 0) {
        // BatchWrite delete
        await dynamo.send(
          new BatchWriteCommand({
            RequestItems: {
              [EVENTS_TABLE]: items.map((item) => ({
                DeleteRequest: {
                  Key: {
                    PK: item.PK,
                    SK: item.SK,
                  },
                },
              })),
            },
          })
        );

        deletedCount += items.length;
      }

      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    // Zero out testCount on all counter records
    let counterLastKey: Record<string, unknown> | undefined;
    do {
      const counterScan = await dynamo.send(
        new ScanCommand({
          TableName: COUNTERS_TABLE,
          FilterExpression: 'testCount > :zero',
          ExpressionAttributeValues: { ':zero': 0 },
          ExclusiveStartKey: counterLastKey,
        })
      );
      await Promise.all(
        (counterScan.Items ?? []).map((item) =>
          dynamo.send(
            new UpdateCommand({
              TableName: COUNTERS_TABLE,
              Key: { PK: item.PK, SK: item.SK },
              UpdateExpression: 'SET testCount = :zero',
              ExpressionAttributeValues: { ':zero': 0 },
            })
          )
        )
      );
      counterLastKey = counterScan.LastEvaluatedKey;
    } while (counterLastKey);

    return respond(200, { deletedCount });
  } catch (error) {
    console.error('Delete test data error:', error);
    return respond(500, { error: 'Failed to delete test data' });
  }
};

/**
 * GET /api/usage-analytics/heatmap
 * Return pre-aggregated login counts per user per day
 */
const getHeatmap = async () => {
  try {
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await dynamo.send(
        new ScanCommand({
          TableName: COUNTERS_TABLE,
          FilterExpression: 'eventType = :type',
          ExpressionAttributeValues: { ':type': 'login' },
          ExclusiveStartKey: lastKey,
        })
      );
      items.push(...(result.Items ?? []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    const heatmap = items.map((item) => {
      const userId = String(item.PK).replace(/^USER#/, '');
      const real = (item.realCount as number) ?? 0;
      const test = (item.testCount as number) ?? 0;
      return {
        userId,
        userName: item.userName as string | undefined,
        date: item.date as string,
        real,
        test,
        total: real + test,
      };
    });

    return respond(200, { heatmap });
  } catch (error) {
    console.error('Get heatmap error:', error);
    return respond(500, { error: 'Failed to get heatmap data' });
  }
};

/**
 * GET /api/usage-analytics/key
 * Get API key metadata (never returns plaintext key)
 */
const getApiKey = async () => {
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
    if (!item) {
      return respond(404, { error: 'No API key found' });
    }

    // Never return the hash, only metadata
    return respond(200, {
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      rotatedAt: item.rotatedAt,
      rotationCount: item.rotationCount,
      lastUsedAt: item.lastUsedAt,
      retentionMonths: item.retentionMonths ?? 6,
    });
  } catch (error) {
    console.error('Get API key error:', error);
    return respond(500, { error: 'Failed to get API key' });
  }
};

/**
 * POST /api/usage-analytics/key/regenerate
 * Generate new API key
 */
const regenerateApiKey = async (event: APIGatewayProxyEventV2) => {
  try {
    // Extract user ID from JWT for audit
    const auth = event.headers?.authorization || event.headers?.Authorization;
    const token = String(auth).replace(/^Bearer\s+/i, '');
    const claims = parseJwt(token);
    const userId = (claims.sub as string) || 'unknown';

    // Generate new key
    const newKey = generateApiKey();
    const keyHash = hashKey(newKey);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days

    // Get current rotation count and retention setting
    const current = await dynamo.send(
      new GetCommand({
        TableName: KEYS_TABLE,
        Key: {
          PK: `CLIENT#${CLIENT_NAME}`,
          SK: 'KEY#active',
        },
      })
    );

    const rotationCount = ((current.Item?.rotationCount as number) || 0) + 1;
    const retentionMonths = (current.Item?.retentionMonths as number) ?? 6;

    // Store new key (overwrites old one, preserves retention setting)
    await dynamo.send(
      new PutCommand({
        TableName: KEYS_TABLE,
        Item: {
          PK: `CLIENT#${CLIENT_NAME}`,
          SK: 'KEY#active',
          keyHash,
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          rotatedAt: now.toISOString(),
          rotationCount,
          createdBy: userId,
          retentionMonths,
        },
      })
    );

    console.log(`API key regenerated by user: ${userId}, rotation count: ${rotationCount}`);

    // Return plaintext key (only time it's accessible)
    return respond(200, {
      apiKey: newKey,
      expiresAt: expiresAt.toISOString(),
      message: 'Store this key securely. It will not be shown again.',
    });
  } catch (error) {
    console.error('Regenerate API key error:', error);
    return respond(500, { error: 'Failed to regenerate API key' });
  }
};

/**
 * GET /api/usage-analytics/retention
 * Get data retention setting
 */
const getRetention = async () => {
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
    if (!item) {
      return respond(404, { error: 'No configuration found' });
    }

    return respond(200, {
      retentionMonths: item.retentionMonths ?? 6,
    });
  } catch (error) {
    console.error('Get retention error:', error);
    return respond(500, { error: 'Failed to get retention setting' });
  }
};

/**
 * PUT /api/usage-analytics/retention
 * Update data retention setting
 */
const setRetention = async (event: APIGatewayProxyEventV2) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const retentionMonths = parseInt(body.retentionMonths);

    // Validate: must be one of the allowed values
    const allowedValues = [1, 3, 6, 12, 15];
    if (!allowedValues.includes(retentionMonths)) {
      return respond(400, {
        error: 'Invalid retention months',
        message: 'Must be one of: 1, 3, 6, 12, 15',
      });
    }

    // Update retention setting
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
    if (!item) {
      return respond(404, { error: 'No configuration found' });
    }

    // Update with all existing fields
    await dynamo.send(
      new PutCommand({
        TableName: KEYS_TABLE,
        Item: {
          ...item,
          retentionMonths,
          retentionUpdatedAt: new Date().toISOString(),
        },
      })
    );

    console.log(`Retention updated to ${retentionMonths} months for client: ${CLIENT_NAME}`);

    return respond(200, {
      retentionMonths,
      message: 'Retention setting updated successfully',
    });
  } catch (error) {
    console.error('Set retention error:', error);
    return respond(500, { error: 'Failed to update retention setting' });
  }
};

/**
 * Lambda handler for usage analytics admin endpoints.
 * All routes require admin authentication.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return respond(200, null);
  }

  // All routes require admin
  if (!isAdmin(event)) {
    return respond(403, { error: 'Forbidden: Admin access required' });
  }

  try {
    const method = event.requestContext?.http?.method ?? 'GET';
    const path = event.requestContext?.http?.path ?? '';

    // Route: GET /api/usage-analytics/events
    if (method === 'GET' && /\/events\/?$/.test(path)) {
      return await listEvents(event);
    }

    // Route: DELETE /api/usage-analytics/test-data
    if (method === 'DELETE' && /\/test-data\/?$/.test(path)) {
      return await deleteTestData();
    }

    // Route: GET /api/usage-analytics/key
    if (method === 'GET' && /\/key\/?$/.test(path)) {
      return await getApiKey();
    }

    // Route: POST /api/usage-analytics/key/regenerate
    if (method === 'POST' && /\/key\/regenerate\/?$/.test(path)) {
      return await regenerateApiKey(event);
    }

    // Route: GET /api/usage-analytics/retention
    if (method === 'GET' && /\/retention\/?$/.test(path)) {
      return await getRetention();
    }

    // Route: PUT /api/usage-analytics/retention
    if (method === 'PUT' && /\/retention\/?$/.test(path)) {
      return await setRetention(event);
    }

    // Route: GET /api/usage-analytics/heatmap
    if (method === 'GET' && /\/heatmap\/?$/.test(path)) {
      return await getHeatmap();
    }

    return respond(404, { error: 'Not found' });
  } catch (error) {
    console.error('Admin API error:', error);
    return respond(500, { error: 'Internal server error' });
  }
};
