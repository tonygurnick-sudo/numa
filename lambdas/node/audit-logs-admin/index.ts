import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.REGION ?? 'us-east-1';

/** Map logType path param → env var holding the DynamoDB table name. */
const TABLE_MAP: Record<string, string> = {
  'web-crawler': process.env.WEB_CRAWLER_TABLE ?? '',
  transcripts: process.env.TRANSCRIPTS_TABLE ?? '',
  automation: process.env.AUTOMATION_TABLE ?? '',
  'search-index': process.env.SEARCH_INDEX_TABLE ?? '',
  'kb-index': process.env.KB_INDEX_TABLE ?? '',
};

const ddbClient = new DynamoDBClient({ region: REGION });
const dynamo = DynamoDBDocumentClient.from(ddbClient);

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
};

const respond = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body),
});

/**
 * Parse JWT token without verification (Cognito already verified it via the authorizer).
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
 * Check if user is in admin group.
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
 * GET /api/audit-logs/{logType}
 * List audit log entries from the corresponding DynamoDB table.
 * Supports optional status filter and pagination via nextToken.
 */
const listLogs = async (tableName: string, event: APIGatewayProxyEventV2) => {
  const params = event.queryStringParameters || {};
  const limit = Math.min(parseInt(params.limit || '50'), 100);
  const statusFilter = params.status;
  const exclusiveStartKey = params.nextToken
    ? JSON.parse(Buffer.from(params.nextToken, 'base64').toString())
    : undefined;

  try {
    // If filtering by status, use the StatusIndex GSI for efficiency
    if (statusFilter) {
      const result = await dynamo.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'StatusIndex',
          KeyConditionExpression: '#s = :status',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':status': statusFilter },
          ScanIndexForward: false,
          Limit: limit,
          ExclusiveStartKey: exclusiveStartKey,
        })
      );

      const nextToken = result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : undefined;

      return respond(200, {
        logs: result.Items || [],
        nextToken,
        count: (result.Items || []).length,
      });
    }

    // No filter — scan the full table, newest first
    const result = await dynamo.send(
      new ScanCommand({
        TableName: tableName,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    const nextToken = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined;

    // Sort by timestamp descending (scan doesn't guarantee order)
    const logs = (result.Items || []).sort((a, b) => ((b.timestamp as number) || 0) - ((a.timestamp as number) || 0));

    return respond(200, {
      logs,
      nextToken,
      count: logs.length,
    });
  } catch (error) {
    console.error('List audit logs error:', error);
    return respond(500, { error: 'Failed to list audit logs' });
  }
};

/**
 * Lambda handler for audit log admin endpoints.
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

    // Route: GET /api/audit-logs/{logType}
    if (method === 'GET') {
      // Extract logType from path: /api/audit-logs/web-crawler → web-crawler
      const match = path.match(/\/audit-logs\/([a-z-]+)\/?$/);
      if (!match) {
        return respond(404, { error: 'Not found' });
      }

      const logType = match[1];
      const tableName = TABLE_MAP[logType];

      if (!tableName) {
        return respond(400, { error: `Unknown log type: ${logType}` });
      }

      return await listLogs(tableName, event);
    }

    return respond(404, { error: 'Not found' });
  } catch (error) {
    console.error('Audit logs admin API error:', error);
    return respond(500, { error: 'Internal server error' });
  }
};
