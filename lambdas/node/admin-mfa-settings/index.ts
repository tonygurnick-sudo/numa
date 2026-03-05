import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.MFA_SETTINGS_TABLE_NAME as string;

const ddb = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}));

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT,POST,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

// SECURITY NOTE: This function extracts claims from a JWT without verifying the signature.
// This is safe because all routes using parseJwt have addAuthorizer: true — the API Gateway
// REQUEST authorizer (api-gateway-authorizer Lambda) cryptographically validates the JWT
// against Cognito's JWKS *before* this Lambda is invoked. The authorizer uses
// enableSimpleResponses: true, so validated claims are not injected into the event context,
// requiring us to decode the token here for claim extraction only.
// Direct Lambda invocation (bypassing API Gateway) requires IAM credentials, which is a
// separate security boundary.
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

function getSubFromAuth(event: any): string | null {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return null;
  const token = String(auth).replace(/^Bearer\s+/i, '');
  const claims = parseJwt(token);
  return (claims?.sub as string) || null;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path || '';
  if (method === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  try {
    if (!TABLE_NAME) {
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    if (method === 'GET' && /\/settings\/mfa\/?$/.test(path)) {
      // Fetch device-remember and session-config in parallel
      const [deviceRes, sessionRes] = await Promise.all([
        ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'device-remember' } })),
        ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'session-config' } })),
      ]);
      const item = deviceRes.Item as { rememberDurationHours?: number; rememberDurationDays?: number } | undefined;
      // Read rememberDurationHours first; fall back to legacy rememberDurationDays (converted to hours)
      let rememberDurationHours = 0;
      if (typeof item?.rememberDurationHours === 'number') {
        rememberDurationHours = item.rememberDurationHours;
      } else if (typeof item?.rememberDurationDays === 'number') {
        rememberDurationHours = item.rememberDurationDays * 24;
      }
      const sessionItem = sessionRes.Item as
        | {
            sessionIdleTimeoutMinutes?: number;
            maxSessionDurationHours?: number;
          }
        | undefined;
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({
          rememberDurationHours,
          sessionIdleTimeoutMinutes: sessionItem?.sessionIdleTimeoutMinutes ?? 0,
          maxSessionDurationHours: sessionItem?.maxSessionDurationHours ?? 0,
        }),
      };
    }

    if (method === 'PUT' && /\/settings\/mfa\/?$/.test(path)) {
      if (!isAdmin(event)) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
      }
      const body = JSON.parse(event.body || '{}');
      const rememberDurationHours = Number(body.rememberDurationHours);
      // Max 2160 hours = 90 days (or 24 hours when set in hours mode)
      if (!Number.isInteger(rememberDurationHours) || rememberDurationHours < 0 || rememberDurationHours > 2160) {
        return {
          statusCode: 400,
          headers: HEADERS,
          body: JSON.stringify({ error: 'rememberDurationHours must be an integer between 0 and 2160 (90 days)' }),
        };
      }

      // REBASE RESOLUTION: Kept HEAD (session settings support).
      // Incoming (8e1a6ca9) had only the single device-remember PutCommand.
      // To rollback: remove session validation + writes below, keep only the device-remember PutCommand.

      // Session settings (optional — only written when provided)
      const sessionIdleTimeoutMinutes =
        body.sessionIdleTimeoutMinutes !== undefined ? Number(body.sessionIdleTimeoutMinutes) : undefined;
      const maxSessionDurationHours =
        body.maxSessionDurationHours !== undefined ? Number(body.maxSessionDurationHours) : undefined;

      if (sessionIdleTimeoutMinutes !== undefined) {
        if (
          !Number.isInteger(sessionIdleTimeoutMinutes) ||
          sessionIdleTimeoutMinutes < 0 ||
          sessionIdleTimeoutMinutes > 480
        ) {
          return {
            statusCode: 400,
            headers: HEADERS,
            body: JSON.stringify({ error: 'sessionIdleTimeoutMinutes must be an integer between 0 and 480' }),
          };
        }
      }
      if (maxSessionDurationHours !== undefined) {
        if (
          !Number.isInteger(maxSessionDurationHours) ||
          maxSessionDurationHours < 0 ||
          maxSessionDurationHours > 8760
        ) {
          return {
            statusCode: 400,
            headers: HEADERS,
            body: JSON.stringify({ error: 'maxSessionDurationHours must be an integer between 0 and 8760' }),
          };
        }
      }

      const writes: Promise<unknown>[] = [
        ddb.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: { setting: 'device-remember', rememberDurationHours, updatedAt: new Date().toISOString() },
          }),
        ),
      ];

      // Write session config as a separate DynamoDB item (also read by token-adjuster Lambda)
      if (sessionIdleTimeoutMinutes !== undefined || maxSessionDurationHours !== undefined) {
        // Read existing session config to preserve fields not being updated
        const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'session-config' } }));
        const prev = existing.Item ?? {};
        writes.push(
          ddb.send(
            new PutCommand({
              TableName: TABLE_NAME,
              Item: {
                setting: 'session-config',
                sessionIdleTimeoutMinutes: sessionIdleTimeoutMinutes ?? prev.sessionIdleTimeoutMinutes ?? 0,
                maxSessionDurationHours: maxSessionDurationHours ?? prev.maxSessionDurationHours ?? 0,
                updatedAt: new Date().toISOString(),
              },
            }),
          ),
        );
      }

      await Promise.all(writes);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    // Record device trust (authenticated) — stores a server-side timestamp so the client cannot tamper with expiry.
    // Also writes a DynamoDB TTL so orphaned records are automatically cleaned up.
    if (method === 'POST' && /\/settings\/mfa\/device-trust\/?$/.test(path)) {
      const userSub = getSubFromAuth(event);
      if (!userSub) {
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const body = JSON.parse(event.body || '{}');
      const deviceKey = body.deviceKey;
      if (!deviceKey || typeof deviceKey !== 'string') {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'deviceKey is required' }) };
      }
      // Read admin duration to compute TTL for automatic DynamoDB cleanup
      const configRes = await ddb.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { setting: 'device-remember' },
        })
      );
      const cfgItem = configRes.Item as { rememberDurationHours?: number; rememberDurationDays?: number } | undefined;
      let durationHours = 0;
      if (typeof cfgItem?.rememberDurationHours === 'number') {
        durationHours = cfgItem.rememberDurationHours;
      } else if (typeof cfgItem?.rememberDurationDays === 'number') {
        durationHours = cfgItem.rememberDurationDays * 24;
      }
      // Default to max allowed (8760h = 1 year) if not configured, so records always expire
      if (durationHours <= 0) durationHours = 8760;
      const nowSec = Math.floor(Date.now() / 1000);
      const ttl = nowSec + durationHours * 3600;
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            setting: `device-trust#${deviceKey}`,
            deviceKey,
            userSub,
            rememberedAt: new Date().toISOString(),
            ttl,
          },
        })
      );
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    // Validate device trust (public — called mid-login before tokens are available).
    // Reads the trust record and admin duration, returns { valid: true/false }. No sensitive data is leaked.
    if (method === 'POST' && /\/settings\/mfa\/validate-device\/?$/.test(path)) {
      const body = JSON.parse(event.body || '{}');
      const deviceKey = body.deviceKey;
      if (!deviceKey || typeof deviceKey !== 'string') {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ valid: false }) };
      }
      // Read trust record
      const trustRes = await ddb.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { setting: `device-trust#${deviceKey}` } })
      );
      if (!trustRes.Item?.rememberedAt) {
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ valid: false }) };
      }
      // Read admin duration setting
      const configRes = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'device-remember' } }));
      const configItem = configRes.Item as
        | { rememberDurationHours?: number; rememberDurationDays?: number }
        | undefined;
      let durationHours = 0;
      if (typeof configItem?.rememberDurationHours === 'number') {
        durationHours = configItem.rememberDurationHours;
      } else if (typeof configItem?.rememberDurationDays === 'number') {
        durationHours = configItem.rememberDurationDays * 24;
      }
      if (durationHours <= 0) {
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ valid: false }) };
      }
      // Check expiry
      const rememberedAt = new Date(trustRes.Item.rememberedAt as string).getTime();
      const elapsed = Date.now() - rememberedAt;
      const maxMs = durationHours * 60 * 60 * 1000;
      const valid = elapsed <= maxMs;
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ valid }) };
    }

    // Revoke device trust (authenticated) — deletes the server-side trust record
    if (method === 'DELETE' && /\/settings\/mfa\/device-trust\/?$/.test(path)) {
      const userSub = getSubFromAuth(event);
      if (!userSub) {
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const deviceKey = event.queryStringParameters?.deviceKey;
      if (!deviceKey || typeof deviceKey !== 'string') {
        return {
          statusCode: 400,
          headers: HEADERS,
          body: JSON.stringify({ error: 'deviceKey query param is required' }),
        };
      }
      // Verify the trust record belongs to the caller before deleting
      const existing = await ddb.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { setting: `device-trust#${deviceKey}` } })
      );
      if (existing.Item && existing.Item.userSub !== userSub) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
      }
      await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { setting: `device-trust#${deviceKey}` } }));
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error('admin-mfa-settings error', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
