import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.GLOBAL_TABLE_NAME as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

type IntegrationItem = {
  integration: string;
  status: 'enabled' | 'disabled';
  denyTools: string[];
  updatedAt?: string;
  updatedBy?: string;
};

type JwtClaims = { [key: string]: unknown; 'cognito:groups'?: string[] };

function parseJwt(token: string): JwtClaims {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as JwtClaims;
  } catch {
    return {} as JwtClaims;
  }
}

function isAdminFromAuth(event: Pick<APIGatewayProxyEventV2, 'headers'>): boolean {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return false;
  const token = String(auth).replace(/^Bearer\s+/i, '');
  const claims = parseJwt(token) || ({} as JwtClaims);
  const groups: string[] = (claims['cognito:groups'] as string[]) || [];
  return groups.includes('admin');
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path || '';

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'application/json',
  };

  if (method === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    if (!TABLE_NAME || !CLIENT_NAME) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    // Allow any authenticated user to READ global settings
    if (method === 'GET' && /\/settings\/integrations\/?$/.test(path)) {
      const scan = await ddbDoc.send(new ScanCommand({ TableName: TABLE_NAME }));
      const items = (scan.Items || []).map((i) => ({
        integration: i.integration,
        status: (i.status as string) || 'disabled',
        denyTools: (i.denyTools as string[]) || [],
      }));
      return { statusCode: 200, headers, body: JSON.stringify(items) };
    }

    // Restrict WRITE to admins only
    if (method === 'PUT' && /\/settings\/integrations\//.test(path)) {
      if (!isAdminFromAuth(event)) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
      }
      const integration = decodeURIComponent(path.split('/').pop() || '');
      if (!integration) return { statusCode: 400, headers, body: JSON.stringify({ error: 'integration required' }) };

      const body = JSON.parse(event.body || '{}');
      const status = body.status === 'enabled' ? 'enabled' : 'disabled';
      const denyTools = Array.isArray(body.denyTools) ? (body.denyTools as string[]) : [];

      const updated: IntegrationItem = {
        integration,
        status,
        denyTools,
        updatedAt: new Date().toISOString(),
        updatedBy: 'admin',
      };
      await ddbDoc.send(new PutCommand({ TableName: TABLE_NAME, Item: updated }));
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error('admin-integration-settings error', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
