import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.GLOBAL_TABLE_NAME as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;

const ddbDoc = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}));

type ConnectorItem = {
  connector: string;
  status: 'enabled' | 'disabled';
  devOnly?: boolean;
  requiresDeploy?: boolean;
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

    if (method === 'GET' && /\/settings\/data-connectors\/?$/.test(path)) {
      const scan = await ddbDoc.send(new ScanCommand({ TableName: TABLE_NAME }));
      const items = (scan.Items || []).map((i) => ({
        connector: i.connector,
        status: (i.status as string) || 'disabled',
        ...(i.devOnly !== undefined && { devOnly: i.devOnly }),
        ...(i.requiresDeploy !== undefined && { requiresDeploy: i.requiresDeploy }),
      }));
      return { statusCode: 200, headers, body: JSON.stringify(items) };
    }

    if (method === 'PUT' && /\/settings\/data-connectors\//.test(path)) {
      if (!isAdminFromAuth(event)) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
      }
      const connector = decodeURIComponent(path.split('/').pop() || '');
      if (!connector) return { statusCode: 400, headers, body: JSON.stringify({ error: 'connector required' }) };

      const body = JSON.parse(event.body || '{}');
      const status = body.status === 'enabled' ? 'enabled' : 'disabled';

      const updated: ConnectorItem = {
        connector,
        status,
        ...(typeof body.devOnly === 'boolean' && { devOnly: body.devOnly }),
        ...(typeof body.requiresDeploy === 'boolean' && { requiresDeploy: body.requiresDeploy }),
        updatedAt: new Date().toISOString(),
        updatedBy: 'admin',
      };
      await ddbDoc.send(new PutCommand({ TableName: TABLE_NAME, Item: updated }));
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error('admin-data-connector-settings error', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
