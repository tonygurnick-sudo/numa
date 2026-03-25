import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.SCHEDULING_SETTINGS_TABLE_NAME as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;
const PER_CLIENT_MIN = process.env.SCHEDULING_MIN_INTERVAL_MINUTES
  ? parseInt(process.env.SCHEDULING_MIN_INTERVAL_MINUTES, 10)
  : undefined;
const GLOBAL_MIN = process.env.GLOBAL_SCHEDULING_MIN_INTERVAL_MINUTES
  ? parseInt(process.env.GLOBAL_SCHEDULING_MIN_INTERVAL_MINUTES, 10)
  : undefined;

const PLATFORM_DEFAULT = 5;
const ARCANUM_FLOOR = PER_CLIENT_MIN ?? GLOBAL_MIN ?? PLATFORM_DEFAULT;

const ddb = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}));

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

function parseJwt(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isAdmin(event: any): boolean {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return false;
  const token = String(auth).replace(/^Bearer\s+/i, '');
  const claims = parseJwt(token) || {};
  const groups: string[] = (claims['cognito:groups'] as string[]) || [];
  return groups.includes('admin');
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path || '';
  if (method === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  try {
    if (!TABLE_NAME || !CLIENT_NAME) {
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    // GET /settings/scheduling — return current admin override + the Arcanum floor
    if (method === 'GET' && /\/settings\/scheduling\/?$/.test(path)) {
      const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'scheduling' } }));
      const item = res.Item as { minIntervalMinutes?: number } | undefined;
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({
          minIntervalMinutes: item?.minIntervalMinutes ?? null,
          arcanumFloor: ARCANUM_FLOOR,
        }),
      };
    }

    // PUT /settings/scheduling — admin-only, set the client-admin minimum
    if (method === 'PUT' && /\/settings\/scheduling\/?$/.test(path)) {
      if (!isAdmin(event)) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
      }

      const body = JSON.parse(event.body || '{}');
      const minIntervalMinutes = body.minIntervalMinutes;

      // Allow null to clear the admin override
      if (minIntervalMinutes === null) {
        await ddb.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: { setting: 'scheduling', minIntervalMinutes: null, updatedAt: new Date().toISOString() },
          })
        );
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
      }

      if (
        typeof minIntervalMinutes !== 'number' ||
        !Number.isInteger(minIntervalMinutes) ||
        minIntervalMinutes < ARCANUM_FLOOR
      ) {
        return {
          statusCode: 400,
          headers: HEADERS,
          body: JSON.stringify({
            error: `minIntervalMinutes must be an integer >= ${ARCANUM_FLOOR}`,
            arcanumFloor: ARCANUM_FLOOR,
          }),
        };
      }

      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: { setting: 'scheduling', minIntervalMinutes, updatedAt: new Date().toISOString() },
        })
      );
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error('admin-scheduling-settings error', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
