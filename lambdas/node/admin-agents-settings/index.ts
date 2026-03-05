import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.AGENTS_SETTINGS_TABLE_NAME as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;

const ddb = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}));

type AgentsMode = 'off' | 'personal_only' | 'full';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

function parseJwt(token: string): any {
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

    if (method === 'GET' && /\/settings\/agents\/?$/.test(path)) {
      const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'policy' } }));
      // Item may not exist on first read; default to 'full'
      const item = res.Item as { mode?: AgentsMode } | undefined;
      const mode: AgentsMode =
        item?.mode === 'off' || item?.mode === 'personal_only' || item?.mode === 'full' ? item.mode : 'full';
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ mode }) };
    }

    if (method === 'PUT' && /\/settings\/agents\/?$/.test(path)) {
      if (!isAdmin(event)) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
      }
      const body = JSON.parse(event.body || '{}');
      const mode: AgentsMode = body.mode;
      if (!['off', 'personal_only', 'full'].includes(mode)) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid mode' }) };
      }
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: { setting: 'policy', mode, updatedAt: new Date().toISOString() },
        })
      );
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error('admin-agents-settings error', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
