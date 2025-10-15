import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.BRANDING_TABLE_NAME as string | undefined;
const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CLIENT_NAME = process.env.CLIENT_NAME as string | undefined;
const BRANDING_PROVIDER_ENABLED = (process.env.BRANDING_PROVIDER_ENABLED ?? 'false') === 'true';

const CURRENT_CONFIG_ID = 'branding#current';

type JwtClaims = { [key: string]: unknown; 'cognito:groups'?: string[]; username?: string };

type BrandingPayload = Record<string, unknown>; // Pass-through document

function parseJwt(token: string): JwtClaims {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as JwtClaims;
  } catch {
    return {} as JwtClaims;
  }
}

function isAdminFromAuth(event: Pick<APIGatewayProxyEventV2, 'headers'>): { admin: boolean; username?: string } {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return { admin: false };
  const token = String(auth).replace(/^Bearer\s+/i, '');
  const claims = parseJwt(token) || ({} as JwtClaims);
  const groups: string[] = (claims['cognito:groups'] as string[]) || [];
  const username = (claims.username as string) || undefined;
  return { admin: groups.includes('admin'), username };
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'application/json',
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const rawPath = event.requestContext.http.path || '';
  const headers = corsHeaders();

  if (method === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    if (!TABLE_NAME || !CLIENT_NAME) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error (table missing)' }),
      };
    }

    // Expect /api/branding/{clientId}
    const pathParts = rawPath.split('/').filter(Boolean);
    const clientId = decodeURIComponent(pathParts[pathParts.length - 1] || '');
    if (!clientId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'clientId required' }) };

    if (method === 'GET') {
      // Global owner switch must allow branding for this client
      if (!BRANDING_PROVIDER_ENABLED) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'not_found' }) };
      }
      const getRes = await ddbDoc.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { client_id: clientId, config_id: CURRENT_CONFIG_ID },
        }),
      );
      if (!getRes.Item) {
        // No record → return 404 with minimal default indicator
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'not_found' }) };
      }
      const itemRecord = getRes.Item as Record<string, unknown>;
      // Return the stored blob as-is for the FE
      const blob = (itemRecord.config as Record<string, unknown> | undefined) ?? itemRecord;
      return { statusCode: 200, headers, body: JSON.stringify(blob) };
    }

    if (method === 'PUT') {
      const { admin, username } = isAdminFromAuth(event);
      if (!admin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };

      // Owner switch must allow writes too; otherwise block
      if (!BRANDING_PROVIDER_ENABLED) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
      }

      const payload = (event.body ? JSON.parse(event.body) : {}) as BrandingPayload;
      // Minimal validation
      if (payload && typeof payload !== 'object') {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_payload' }) };
      }

      const enabledEntry =
        typeof payload === 'object' &&
        payload !== null &&
        'enabled' in payload &&
        typeof (payload as { enabled: unknown }).enabled === 'boolean'
          ? { enabled: (payload as { enabled: boolean }).enabled }
          : {};

      // Persist minimal metadata + full document under `config`
      const item: Record<string, unknown> = {
        client_id: clientId,
        config_id: CURRENT_CONFIG_ID,
        clientId,
        provider: 'branding',
        updatedAt: new Date().toISOString(),
        updatedBy: username || 'admin',
        // Optional runtime flag: if callers include `enabled`, store it alongside
        ...enabledEntry,
        config: payload,
      };

      await ddbDoc.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error('branding-config error', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
