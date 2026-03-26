import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const REGION = process.env.REGION ?? 'us-east-1';
const USER_MANAGEMENT_TABLE = process.env.USER_MANAGEMENT_TABLE ?? '';

const ddbClient = new DynamoDBClient({ region: REGION });
const dynamo = DynamoDBDocumentClient.from(ddbClient);

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,POST',
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
 * Check if user is in admin group and return claims.
 */
const getAdminClaims = (event: APIGatewayProxyEventV2): { isAdmin: boolean; email: string } => {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return { isAdmin: false, email: '' };

  const token = String(auth).replace(/^Bearer\s+/i, '');
  const claims = parseJwt(token);
  const groups = (claims['cognito:groups'] as string[]) || [];
  const email = (claims['email'] as string) || '';

  return { isAdmin: groups.includes('admin'), email };
};

/**
 * POST /api/audit-user-management
 * Write a user management audit log entry to DynamoDB.
 *
 * Body: { action: string, createdUserEmail: string, details?: Record<string, unknown> }
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return respond(200, null);
  }

  // Require admin
  const { isAdmin, email: adminEmail } = getAdminClaims(event);
  if (!isAdmin) {
    return respond(403, { error: 'Forbidden: Admin access required' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { action, createdUserEmail, details } = body;

    if (!action || !createdUserEmail) {
      return respond(400, {
        error: 'Missing required fields: action, createdUserEmail',
      });
    }

    // Prefer adminEmail from the JWT, but fall back to the body value.
    // Access tokens don't carry the email claim, so the frontend sends it.
    const resolvedAdminEmail = adminEmail || (body.adminEmail as string) || '';

    const item = {
      logId: randomUUID(),
      timestamp: Date.now(),
      action,
      status: 'success',
      adminEmail: resolvedAdminEmail,
      createdUserEmail,
      details: details || {},
    };

    await dynamo.send(
      new PutCommand({
        TableName: USER_MANAGEMENT_TABLE,
        Item: item,
      })
    );

    return respond(200, { message: 'Audit log written', logId: item.logId });
  } catch (error) {
    console.error('Audit user management write error:', error);
    return respond(500, { error: 'Failed to write audit log' });
  }
};
