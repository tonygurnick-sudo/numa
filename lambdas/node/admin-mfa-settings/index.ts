import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminSetUserMFAPreferenceCommand,
  AdminUserGlobalSignOutCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { withPRM } from '../../../lib/prm-node/prm';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

const TABLE_NAME = process.env.MFA_SETTINGS_TABLE_NAME as string;
const USER_POOL_ID = process.env.USER_POOL_ID as string;
const EMAIL_SENDER_LAMBDA_ARN = process.env.EMAIL_SENDER_LAMBDA_ARN as string | undefined;
const CLIENT_NAME = process.env.CLIENT_NAME as string | undefined;

const ddb = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}));

// Lazy-init Cognito client — only created when MFA reset operations are needed
let cognitoClient: CognitoIdentityProviderClient | null = null;
const getCognito = (): CognitoIdentityProviderClient => {
  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityProviderClient({});
  }
  return cognitoClient;
};

// SECURITY NOTE: Access-Control-Allow-Origin is '*' because CloudFront/API Gateway
// handles origin restriction upstream. Some routes (GET /settings/mfa, validate-device)
// are public (no authorizer) and called pre-login, so a restrictive origin here would
// break the auth flow. All sensitive operations require a valid JWT via API Gateway authorizer.
const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT,POST,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

// Grace period for admin-initiated MFA reset (24 hours).
// User may not log in immediately after an admin reset, so give them a full day.
const ADMIN_RESET_GRACE_PERIOD_SECONDS = 24 * 60 * 60;

// Grace period for recovery code usage (1 hour).
// User is actively on the login page — only needs time to retry if browser crashes.
// Shorter window = less time MFA is disabled = lower risk.
const RECOVERY_GRACE_PERIOD_SECONDS = 1 * 60 * 60;

// Rate limit: max resets per user in a rolling window
const MAX_RESETS_PER_WINDOW = 3;
const RATE_LIMIT_WINDOW_DAYS = 7;

// Recovery codes constants
const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_LENGTH = 8;
const RECOVERY_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid ambiguity
const RECOVERY_MAX_FAILED_ATTEMPTS = 5;
const RECOVERY_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/** Generate a random recovery code using rejection sampling to avoid modulo bias. */
function generateRecoveryCode(): string {
  const chars = RECOVERY_CODE_CHARS;
  const limit = 256 - (256 % chars.length); // 240 — discard bytes >= limit
  let code = '';
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) {
    let byte: number;
    do {
      byte = randomBytes(1)[0];
    } while (byte >= limit);
    code += chars[byte % chars.length];
  }
  return code;
}

const BCRYPT_ROUNDS = 10;

/** Bcrypt-hash a recovery code (uppercased for case-insensitive matching). */
async function hashRecoveryCode(code: string): Promise<string> {
  return bcrypt.hash(code.toUpperCase(), BCRYPT_ROUNDS);
}

/** Verify a code against a stored bcrypt hash (constant-time comparison). */
async function verifyRecoveryCode(code: string, storedHash: string): Promise<boolean> {
  return bcrypt.compare(code.toUpperCase(), storedHash);
}

// ── Email OTP constants ──────────────────────────────────────────────────────
const OTP_LENGTH = 6;
const OTP_EXPIRY_SECONDS = 15 * 60; // 15 minutes
const OTP_MAX_SENDS_PER_RESET = 5;
const OTP_MAX_FAILED_ATTEMPTS = 5;
const OTP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/** Generate a cryptographically random numeric OTP. */
function generateOtp(): string {
  // Use rejection sampling to avoid modulo bias for digits 0-9
  const limit = 256 - (256 % 10); // 250
  let otp = '';
  for (let i = 0; i < OTP_LENGTH; i++) {
    let byte: number;
    do {
      byte = randomBytes(1)[0];
    } while (byte >= limit);
    otp += (byte % 10).toString();
  }
  return otp;
}

// ── Email sender infrastructure ──────────────────────────────────────────────
// Reuses the cross-account STS proof pattern from agent-schedule-runner.

let emailLambdaClient: LambdaClient | null = null;
const getEmailLambdaClient = (): LambdaClient => {
  if (!emailLambdaClient) emailLambdaClient = withPRM(LambdaClient, { region: 'us-east-1' });
  return emailLambdaClient;
};

/**
 * Generate an STS presigned GetCallerIdentity URL for cross-account identity proof.
 * The email sender Lambda validates this to confirm the caller is a known Numa service.
 */
async function generateStsProofUrl(expiresIn = 60): Promise<string> {
  const { SignatureV4 } = await import('@smithy/signature-v4');
  const { Sha256 } = await import('@aws-crypto/sha256-js');
  const { defaultProvider } = await import('@aws-sdk/credential-provider-node');
  const { HttpRequest } = await import('@smithy/protocol-http');

  const signer = new SignatureV4({
    service: 'sts',
    region: 'us-east-1',
    credentials: defaultProvider(),
    sha256: Sha256,
  });

  const request = new HttpRequest({
    method: 'GET',
    protocol: 'https:',
    hostname: 'sts.us-east-1.amazonaws.com',
    path: '/',
    query: { Action: 'GetCallerIdentity', Version: '2011-06-15' },
    headers: { host: 'sts.us-east-1.amazonaws.com' },
  });

  const signed = await signer.presign(request, { expiresIn });
  const qs = Object.entries(signed.query ?? {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `https://${signed.hostname}${signed.path}?${qs}`;
}

/**
 * Send an email via the centralized email sender (fire-and-forget).
 * Uses the `generic` template to avoid requiring deployer-stack changes.
 */
async function sendEmail(params: {
  to: string;
  subject: string;
  title: string;
  bodyHtml: string;
  bodyText: string;
}): Promise<void> {
  if (!EMAIL_SENDER_LAMBDA_ARN || !CLIENT_NAME) {
    console.warn('Email sender not configured (EMAIL_SENDER_LAMBDA_ARN or CLIENT_NAME missing), skipping email');
    return;
  }

  try {
    const stsProofUrl = await generateStsProofUrl();
    await getEmailLambdaClient().send(
      new InvokeCommand({
        FunctionName: EMAIL_SENDER_LAMBDA_ARN,
        InvocationType: 'Event', // Async — never block the MFA operation
        Payload: new TextEncoder().encode(
          JSON.stringify({
            sts_proof_url: stsProofUrl,
            client_name: CLIENT_NAME,
            to: [params.to],
            template: 'generic',
            template_data: {
              subject: params.subject,
              title: params.title,
              body_html: params.bodyHtml,
              body_text: params.bodyText,
              logo_url: `https://${CLIENT_NAME}.numa.arcanum.ai/numa-logo-email.png`,
            },
          })
        ),
      })
    );
    console.info('[EMAIL_DISPATCH] MFA email dispatched', { to: params.to, subject: params.subject });
  } catch (err) {
    // Non-blocking — email failure must never break MFA operations
    console.error('Email dispatch failed (non-blocking):', err);
  }
}

/** Look up a user's email address from Cognito. Returns undefined if not found. */
async function getUserEmail(userSub: string): Promise<string | undefined> {
  try {
    const res = await getCognito().send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userSub }));
    return res.UserAttributes?.find((a) => a.Name === 'email')?.Value;
  } catch (err) {
    console.warn('Failed to resolve user email from Cognito', { userSub, error: err });
    return undefined;
  }
}

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
      // Fetch device-remember, session-config, and recovery-codes-config in parallel
      const [deviceRes, sessionRes, recoveryRes] = await Promise.all([
        ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'device-remember' } })),
        ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'session-config' } })),
        ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'recovery-codes-config' } })),
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
          // Default to false when no record exists — admins must explicitly opt in
          // to recovery codes. Existing deployments with the record set keep their value.
          recoveryCodesEnabled: recoveryRes.Item ? recoveryRes.Item.enabled === true : false,
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
      // Incoming (8e1a6ca9, 0139d1c5) converged on same logic. Trailing comma diffs resolved with HEAD formatting.
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
          })
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
            })
          )
        );
      }

      // Write recovery codes config if provided
      if (body.recoveryCodesEnabled !== undefined) {
        writes.push(
          ddb.send(
            new PutCommand({
              TableName: TABLE_NAME,
              Item: {
                setting: 'recovery-codes-config',
                enabled: body.recoveryCodesEnabled === true,
                updatedAt: new Date().toISOString(),
              },
            })
          )
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
      if (!deviceKey || typeof deviceKey !== 'string' || deviceKey.length > 256) {
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
      if (!deviceKey || typeof deviceKey !== 'string' || deviceKey.length > 256) {
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

    // Batch validate device trust (authenticated — called from Security tab to filter device list).
    // Accepts an array of device keys, returns which ones have valid (non-expired) trust records.
    // Only returns devices owned by the authenticated caller (prevents enumeration of other users' devices).
    if (method === 'POST' && /\/settings\/mfa\/validate-devices\/?$/.test(path)) {
      const userSub = getSubFromAuth(event);
      if (!userSub) {
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const body = JSON.parse(event.body || '{}');
      const deviceKeys = body.deviceKeys;
      if (!Array.isArray(deviceKeys) || deviceKeys.length === 0) {
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ validDevices: [] }) };
      }
      // Cap at 60 to match Cognito's ListDevices limit; enforce max key length to prevent abuse
      const keys = deviceKeys
        .slice(0, 60)
        .filter((k: unknown) => typeof k === 'string' && k.length > 0 && k.length <= 256) as string[];
      if (keys.length === 0) {
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ validDevices: [] }) };
      }
      // Read admin duration setting once
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
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ validDevices: [] }) };
      }
      const maxMs = durationHours * 60 * 60 * 1000;
      const now = Date.now();
      // Fetch all trust records in parallel
      const results = await Promise.all(
        keys.map(async (deviceKey) => {
          try {
            const trustRes = await ddb.send(
              new GetCommand({ TableName: TABLE_NAME, Key: { setting: `device-trust#${deviceKey}` } })
            );
            if (!trustRes.Item?.rememberedAt) return null;
            // Only return devices owned by the caller
            if (trustRes.Item.userSub !== userSub) return null;
            const rememberedAt = new Date(trustRes.Item.rememberedAt as string).getTime();
            const elapsed = now - rememberedAt;
            return elapsed <= maxMs ? deviceKey : null;
          } catch {
            return null;
          }
        })
      );
      const validDevices = results.filter((k): k is string => k !== null);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ validDevices }) };
    }

    // Revoke device trust (authenticated) — deletes the server-side trust record
    if (method === 'DELETE' && /\/settings\/mfa\/device-trust\/?$/.test(path)) {
      const userSub = getSubFromAuth(event);
      if (!userSub) {
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const deviceKey = event.queryStringParameters?.deviceKey;
      if (!deviceKey || typeof deviceKey !== 'string' || deviceKey.length > 256) {
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

    // Admin MFA Reset — disables a user's MFA preference, revokes sessions, and creates
    // a time-limited grace period so they can log in and re-enrol.
    if (method === 'POST' && /\/settings\/mfa\/reset-user\/?$/.test(path)) {
      if (!isAdmin(event)) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
      }
      if (!USER_POOL_ID) {
        return {
          statusCode: 500,
          headers: HEADERS,
          body: JSON.stringify({ error: 'User pool not configured' }),
        };
      }

      const adminSub = getSubFromAuth(event);
      const body = JSON.parse(event.body || '{}');
      const targetUserId = body.targetUserId as string | undefined;

      if (!targetUserId || typeof targetUserId !== 'string' || targetUserId.length > 128) {
        return {
          statusCode: 400,
          headers: HEADERS,
          body: JSON.stringify({ error: 'targetUserId is required and must be a string (max 128 chars)' }),
        };
      }

      // Prevent admins from resetting their own MFA — a compromised admin account
      // could use self-reset to re-enrol MFA under attacker control.
      if (targetUserId === adminSub) {
        return {
          statusCode: 400,
          headers: HEADERS,
          body: JSON.stringify({ error: 'Cannot reset your own MFA. Ask another administrator.' }),
        };
      }

      // Rate limit check — prevent excessive resets (max 3 per user per 7 days).
      // Read first to give a clear error message; the actual enforcement is atomic
      // via a ConditionExpression on the UpdateCommand below.
      const existingReset = await ddb.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { setting: `mfa-reset#${targetUserId}` } })
      );
      const resetHistory = (existingReset.Item?.resetHistory as { at: string }[] | undefined) ?? [];
      const windowStart = Date.now() - RATE_LIMIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      const recentResets = resetHistory.filter((r) => new Date(r.at).getTime() > windowStart);
      if (recentResets.length >= MAX_RESETS_PER_WINDOW) {
        console.warn(
          `MFA reset rate limit exceeded for user ${targetUserId}: ${recentResets.length} resets in ${RATE_LIMIT_WINDOW_DAYS} days`
        );
        return {
          statusCode: 429,
          headers: HEADERS,
          body: JSON.stringify({
            error: `Rate limit exceeded. This user has been reset ${recentResets.length} times in the last ${RATE_LIMIT_WINDOW_DAYS} days. Contact security if this is intentional.`,
          }),
        };
      }

      // Verify the target user exists and has MFA configured
      let targetUserEmail: string | undefined;
      try {
        const userRes = await getCognito().send(
          new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: targetUserId })
        );
        targetUserEmail = userRes.UserAttributes?.find((a) => a.Name === 'email')?.Value;
        const mfaOptions = userRes.UserMFASettingList ?? [];
        if (mfaOptions.length === 0) {
          return {
            statusCode: 400,
            headers: HEADERS,
            body: JSON.stringify({ error: 'User does not have MFA configured. Nothing to reset.' }),
          };
        }
      } catch (err: any) {
        if (err.name === 'UserNotFoundException') {
          return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'User not found' }) };
        }
        throw err;
      }

      // 1. Disable TOTP MFA preference so Cognito won't challenge during grace period
      await getCognito().send(
        new AdminSetUserMFAPreferenceCommand({
          UserPoolId: USER_POOL_ID,
          Username: targetUserId,
          SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false },
        })
      );

      // 2. Revoke all existing sessions — prevents use of stolen tokens during grace period
      try {
        await getCognito().send(
          new AdminUserGlobalSignOutCommand({ UserPoolId: USER_POOL_ID, Username: targetUserId })
        );
      } catch (err: any) {
        // Non-fatal — user may not have active sessions
        console.warn('AdminUserGlobalSignOut non-fatal error:', err.message);
      }

      // 2b. Delete existing recovery codes — old codes were tied to the old TOTP
      // secret and must be invalidated. The user will get fresh codes when they
      // re-enrol MFA after the reset.
      try {
        await ddb.send(
          new DeleteCommand({ TableName: TABLE_NAME, Key: { setting: `recovery-codes#${targetUserId}` } })
        );
      } catch (err: any) {
        // Non-fatal — user may not have recovery codes
        console.warn('Recovery codes deletion non-fatal error:', err.message);
      }

      // 3. Write grace period record to DynamoDB (24hr TTL).
      // We prune expired entries from resetHistory (outside the rolling window) and
      // write the pruned list + the new entry as a complete replacement. This prevents
      // the array from growing unboundedly and ensures the ConditionExpression check
      // on size() accurately reflects the rolling window count.
      const nowSec = Math.floor(Date.now() / 1000);
      const expiresAt = nowSec + ADMIN_RESET_GRACE_PERIOD_SECONDS;
      const resetAt = new Date().toISOString();
      const prunedHistory = [...recentResets, { at: resetAt, by: adminSub }];

      try {
        await ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { setting: `mfa-reset#${targetUserId}` },
            UpdateExpression:
              'SET targetUserId = :tid, resetByAdminId = :admin, resetAt = :rat, ' +
              'expiresAt = :exp, #s = :pending, ' +
              'resetHistory = :history, ' +
              '#ttl = :ttlVal',
            // Atomic rate limit: reject if the pruned history (which we're about to write)
            // already hit the max. This catches concurrent requests that passed the read check.
            ConditionExpression: 'attribute_not_exists(resetHistory) OR size(resetHistory) <= :maxResets',
            ExpressionAttributeNames: { '#s': 'status', '#ttl': 'ttl' },
            ExpressionAttributeValues: {
              ':tid': targetUserId,
              ':admin': adminSub,
              ':rat': resetAt,
              ':exp': expiresAt,
              ':pending': 'pending',
              ':history': prunedHistory,
              ':ttlVal': expiresAt + 86400, // TTL 24h after grace expiry for cleanup
              ':maxResets': MAX_RESETS_PER_WINDOW,
            },
          })
        );
      } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') {
          return {
            statusCode: 429,
            headers: HEADERS,
            body: JSON.stringify({ error: 'Rate limit exceeded (concurrent request). Try again.' }),
          };
        }
        throw err;
      }

      // 4. Audit log entry
      console.log(
        JSON.stringify({
          event: 'MFA_RESET',
          adminUserId: adminSub,
          targetUserId,
          timestamp: resetAt,
          graceExpiresAt: new Date(expiresAt * 1000).toISOString(),
          sourceIp: event.requestContext.http.sourceIp,
          userAgent: event.headers?.['user-agent'] ?? 'unknown',
        })
      );

      // 5. Send notification email — alerts the user their MFA was reset (Gap 2 detective control)
      if (targetUserEmail) {
        await sendEmail({
          to: targetUserEmail,
          subject: 'Your Numa MFA has been reset',
          title: 'MFA Reset',
          bodyHtml:
            '<p>Your multi-factor authentication (MFA) has been reset by an administrator.</p>' +
            '<p>On your next login you will need to:</p>' +
            '<div class="summary">' +
            '<p style="margin:0 0 8px;font-weight:600;color:#333;">What to expect</p>' +
            '<ol style="margin:0;padding-left:20px;color:#555;">' +
            '<li>Sign in with your username and password</li>' +
            '<li>Verify your identity with a code sent to your email</li>' +
            '<li>Set up a new authenticator app</li>' +
            '</ol>' +
            '</div>' +
            '<p style="color:#dc3545;font-weight:600;">If you did not expect this change, contact your administrator immediately.</p>',
          bodyText:
            'Your multi-factor authentication (MFA) has been reset by an administrator.\n\n' +
            'On your next login you will need to:\n' +
            '1. Sign in with your username and password\n' +
            '2. Verify your identity with a code sent to your email\n' +
            '3. Set up a new authenticator app\n\n' +
            'If you did not expect this change, contact your administrator immediately.',
        });
      }

      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({
          status: 'reset_initiated',
          graceExpiresAt: new Date(expiresAt * 1000).toISOString(),
        }),
      };
    }

    // Complete MFA reset — called by the user after successful re-enrollment to clear the grace period.
    // For admin-initiated resets, requires email OTP verification (otpVerified=true) to ensure
    // the user proved identity via email before enrolling a new authenticator.
    // For recovery-code resets, OTP is not required (the recovery code IS the second factor).
    if (method === 'POST' && /\/settings\/mfa\/complete-reset\/?$/.test(path)) {
      const userSub = getSubFromAuth(event);
      if (!userSub) {
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
      }

      // Non-fatal MFA check: log a warning if MFA doesn't appear configured yet.
      // This is NOT a blocker because:
      // 1. There can be a propagation delay between SetUserMFAPreference (user-level)
      //    and AdminGetUser (admin-level) reflecting the change.
      // 2. MFA enforcement on every token refresh (the primary security control) will
      //    catch any cases where MFA isn't actually configured.
      // 3. Blocking here causes the grace period record to stay "pending" forever,
      //    which force-logs the user out on every token refresh.
      try {
        const userRes = await getCognito().send(
          new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userSub })
        );
        const mfaOptions = userRes.UserMFASettingList ?? [];
        if (mfaOptions.length === 0) {
          console.warn(
            `complete-reset: user ${userSub} MFA not yet visible in AdminGetUser ` +
              `(possible propagation delay). Proceeding anyway — MFA enforcement on ` +
              `token refresh will catch if MFA is truly not configured.`
          );
        }
      } catch (err) {
        console.warn('complete-reset: non-fatal error checking MFA status via Cognito', err);
      }

      // Read the reset record to determine if this is an admin reset (requires OTP) or
      // recovery-code reset (no OTP needed — the recovery code was the second factor).
      const resetRes = await ddb.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { setting: `mfa-reset#${userSub}` } })
      );
      const isAdminReset = resetRes.Item?.status === 'pending' && resetRes.Item?.resetByAdminId !== 'recovery-code';

      // For admin resets, verify that email OTP was completed before allowing enrollment
      if (isAdminReset && resetRes.Item?.otpVerified !== true) {
        return {
          statusCode: 403,
          headers: HEADERS,
          body: JSON.stringify({ error: 'Email verification required before completing MFA enrollment' }),
        };
      }

      try {
        await ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { setting: `mfa-reset#${userSub}` },
            UpdateExpression: 'SET #s = :completed, completedAt = :now',
            // Only update if the record exists, belongs to this user, and is still pending
            ConditionExpression: 'attribute_exists(setting) AND targetUserId = :sub AND #s = :pending',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':completed': 'completed',
              ':pending': 'pending',
              ':now': new Date().toISOString(),
              ':sub': userSub,
            },
          })
        );

        console.log(
          JSON.stringify({
            event: 'MFA_RESET_COMPLETED',
            userId: userSub,
            timestamp: new Date().toISOString(),
          })
        );

        // Send "MFA changed" notification email (both admin reset and recovery code paths)
        const email = await getUserEmail(userSub);
        if (email) {
          const changeDate = new Date()
            .toISOString()
            .replace('T', ' ')
            .replace(/\.\d+Z$/, ' UTC');
          await sendEmail({
            to: email,
            subject: 'Your Numa MFA authenticator was changed',
            title: 'MFA Authenticator Changed',
            bodyHtml:
              '<p>A new authenticator app has been configured for your account.</p>' +
              '<div class="summary">' +
              `<p style="margin:0;color:#555;"><strong style="color:#333;">Date:</strong> ${changeDate}</p>` +
              '</div>' +
              '<p style="color:#dc3545;font-weight:600;">If you did not make this change, contact your administrator immediately.</p>',
            bodyText:
              'A new authenticator app has been configured for your account.\n\n' +
              `Date: ${changeDate}\n\n` +
              'If you did not make this change, contact your administrator immediately.',
          });
        }
      } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') {
          // No pending reset for this user, or record doesn't belong to them — not an error
          console.debug(`complete-reset: no pending reset found for user ${userSub}`);
        } else {
          throw err;
        }
      }

      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    // ── Send email OTP for admin MFA reset verification ────────────────────
    // Called by the frontend after password login when mfa_reset_pending is detected.
    // Generates a 6-digit OTP, hashes it, stores in the grace period record, and
    // emails it to the user. Acts as a temporary second factor so the account is
    // never protected by password alone during the reset window.
    if (method === 'POST' && /\/settings\/mfa\/send-reset-otp\/?$/.test(path)) {
      const userSub = getSubFromAuth(event);
      if (!userSub) {
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
      }

      // Verify there's a pending admin reset for this user (not recovery-code)
      const resetRes = await ddb.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { setting: `mfa-reset#${userSub}` } })
      );
      if (!resetRes.Item || resetRes.Item.status !== 'pending' || resetRes.Item.resetByAdminId === 'recovery-code') {
        return {
          statusCode: 400,
          headers: HEADERS,
          body: JSON.stringify({ error: 'No pending admin MFA reset found' }),
        };
      }

      // Check grace period hasn't expired
      const expiresAt = resetRes.Item.expiresAt as number;
      if (Math.floor(Date.now() / 1000) > expiresAt) {
        return {
          statusCode: 410,
          headers: HEADERS,
          body: JSON.stringify({ error: 'MFA reset has expired. Contact your administrator for a new reset.' }),
        };
      }

      // Rate limit OTP sends
      const otpSendCount = (resetRes.Item.otpSendCount as number | undefined) ?? 0;
      if (otpSendCount >= OTP_MAX_SENDS_PER_RESET) {
        return {
          statusCode: 429,
          headers: HEADERS,
          body: JSON.stringify({ error: 'Maximum verification emails sent. Contact your administrator.' }),
        };
      }

      // Generate and hash OTP
      const otp = generateOtp();
      const otpHash = await bcrypt.hash(otp, BCRYPT_ROUNDS);
      const otpExpiresAt = Math.floor(Date.now() / 1000) + OTP_EXPIRY_SECONDS;

      // Store OTP hash in the grace period record
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { setting: `mfa-reset#${userSub}` },
          UpdateExpression:
            'SET otpHash = :hash, otpExpiresAt = :exp, otpVerified = :false, ' +
            'otpAttempts = :zero, otpLastAttemptAt = :null, ' +
            'otpSendCount = if_not_exists(otpSendCount, :zero) + :one',
          ConditionExpression: '#s = :pending AND targetUserId = :sub',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':hash': otpHash,
            ':exp': otpExpiresAt,
            ':false': false,
            ':zero': 0,
            ':null': null,
            ':one': 1,
            ':pending': 'pending',
            ':sub': userSub,
          },
        })
      );

      // Send OTP via email
      const email = await getUserEmail(userSub);
      if (email) {
        await sendEmail({
          to: email,
          subject: 'Your Numa verification code',
          title: 'Verify Your Identity',
          bodyHtml:
            '<p>Enter the following code to verify your identity and set up your new authenticator.</p>' +
            '<p style="margin:4px 0 4px;color:#999;font-size:13px;">Your verification code:</p>' +
            `<p style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;margin:8px 0 24px;padding:16px;background:#f8f9fa;border-radius:8px;color:#333;">${otp}</p>` +
            `<p>This code expires in ${Math.round(OTP_EXPIRY_SECONDS / 60)} minutes.</p>` +
            '<div class="summary">' +
            '<p style="margin:0;color:#555;">If you did not request this code, contact your administrator immediately.</p>' +
            '</div>',
          bodyText:
            'Enter the following code to verify your identity and set up your new authenticator.\n\n' +
            `Your verification code: ${otp}\n\n` +
            `This code expires in ${Math.round(OTP_EXPIRY_SECONDS / 60)} minutes.\n\n` +
            'If you did not request this code, contact your administrator immediately.',
        });
      } else {
        console.error(`send-reset-otp: could not resolve email for user ${userSub}`);
        return {
          statusCode: 500,
          headers: HEADERS,
          body: JSON.stringify({ error: 'Could not resolve your email address. Contact your administrator.' }),
        };
      }

      console.log(
        JSON.stringify({
          event: 'MFA_OTP_SENT',
          userId: userSub,
          otpSendCount: otpSendCount + 1,
          timestamp: new Date().toISOString(),
        })
      );

      // Return masked email for UI display (e.g. "t***@example.com")
      const [localPart, domain] = email.split('@');
      const maskedEmail = localPart[0] + '***@' + domain;

      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ sent: true, maskedEmail }),
      };
    }

    // ── Verify email OTP for admin MFA reset ──────────────────────────────
    // Validates the OTP the user received via email. On success, sets otpVerified=true
    // in the grace period record, which is required before complete-reset will accept
    // the MFA enrollment for admin-initiated resets.
    if (method === 'POST' && /\/settings\/mfa\/verify-reset-otp\/?$/.test(path)) {
      const userSub = getSubFromAuth(event);
      if (!userSub) {
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
      }

      const body = JSON.parse(event.body || '{}');
      const code = body.code as string | undefined;

      if (!code || typeof code !== 'string' || code.length !== OTP_LENGTH || !/^\d+$/.test(code)) {
        return {
          statusCode: 400,
          headers: HEADERS,
          body: JSON.stringify({ success: false, error: 'Invalid verification code format' }),
        };
      }

      // Fetch grace period record
      const resetRes = await ddb.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { setting: `mfa-reset#${userSub}` } })
      );
      if (
        !resetRes.Item ||
        resetRes.Item.status !== 'pending' ||
        resetRes.Item.resetByAdminId === 'recovery-code' ||
        !resetRes.Item.otpHash
      ) {
        return {
          statusCode: 400,
          headers: HEADERS,
          body: JSON.stringify({ success: false, error: 'No pending OTP verification found' }),
        };
      }

      // Already verified — idempotent success
      if (resetRes.Item.otpVerified === true) {
        return {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify({ success: true }),
        };
      }

      // Check OTP expiry
      const otpExpiresAt = resetRes.Item.otpExpiresAt as number;
      if (Math.floor(Date.now() / 1000) > otpExpiresAt) {
        return {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify({ success: false, error: 'Verification code has expired. Please request a new one.' }),
        };
      }

      // Rate limit failed attempts
      const otpAttempts = (resetRes.Item.otpAttempts as number | undefined) ?? 0;
      const otpLastAttemptAt = resetRes.Item.otpLastAttemptAt
        ? new Date(resetRes.Item.otpLastAttemptAt as string).getTime()
        : 0;
      const windowExpired = Date.now() - otpLastAttemptAt > OTP_RATE_LIMIT_WINDOW_MS;

      if (otpAttempts >= OTP_MAX_FAILED_ATTEMPTS && !windowExpired) {
        const retryAfter = Math.ceil((otpLastAttemptAt + OTP_RATE_LIMIT_WINDOW_MS - Date.now()) / 60000);
        return {
          statusCode: 429,
          headers: HEADERS,
          body: JSON.stringify({
            success: false,
            error: `Too many failed attempts. Try again in ${retryAfter} minutes.`,
          }),
        };
      }

      // Verify OTP against bcrypt hash
      const matches = await bcrypt.compare(code, resetRes.Item.otpHash as string);

      if (!matches) {
        const newAttempts = windowExpired ? 1 : otpAttempts + 1;
        await ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { setting: `mfa-reset#${userSub}` },
            UpdateExpression: 'SET otpAttempts = :attempts, otpLastAttemptAt = :now',
            ExpressionAttributeValues: {
              ':attempts': newAttempts,
              ':now': new Date().toISOString(),
            },
          })
        );
        console.warn(
          JSON.stringify({
            event: 'MFA_OTP_FAILED',
            userId: userSub,
            failedAttempts: newAttempts,
            sourceIp: event.requestContext.http.sourceIp,
          })
        );
        return {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify({ success: false, error: 'Invalid verification code' }),
        };
      }

      // Mark OTP as verified atomically
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { setting: `mfa-reset#${userSub}` },
            UpdateExpression: 'SET otpVerified = :true, otpVerifiedAt = :now, otpAttempts = :zero',
            ConditionExpression: 'targetUserId = :sub AND #s = :pending AND otpVerified <> :true',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':true': true,
              ':now': new Date().toISOString(),
              ':zero': 0,
              ':pending': 'pending',
              ':sub': userSub,
            },
          })
        );
      } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') {
          // Already verified (race condition) — treat as success
          return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true }) };
        }
        throw err;
      }

      console.log(
        JSON.stringify({
          event: 'MFA_OTP_VERIFIED',
          userId: userSub,
          timestamp: new Date().toISOString(),
        })
      );

      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true }) };
    }

    // Get MFA reset status for a user (admin only) — used by frontend to show reset state
    if (method === 'GET' && /\/settings\/mfa\/reset-status\/?$/.test(path)) {
      if (!isAdmin(event)) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
      }
      const targetUserId = event.queryStringParameters?.userId;
      if (!targetUserId || targetUserId.length > 128) {
        return {
          statusCode: 400,
          headers: HEADERS,
          body: JSON.stringify({ error: 'userId query param is required (max 128 chars)' }),
        };
      }

      const res = await ddb.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { setting: `mfa-reset#${targetUserId}` } })
      );

      if (!res.Item) {
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ status: 'none' }) };
      }

      const status = res.Item.status as string;
      const expiresAt = res.Item.expiresAt as number | undefined;
      const nowSec = Math.floor(Date.now() / 1000);

      // Check if expired
      if (status === 'pending' && expiresAt && nowSec > expiresAt) {
        return {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify({ status: 'expired', expiresAt: new Date(expiresAt * 1000).toISOString() }),
        };
      }

      // Note: resetByAdminId is intentionally omitted from the response (audit log only)
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({
          status,
          expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
          resetAt: res.Item.resetAt,
        }),
      };
    }

    // ── Recovery Codes: Generate (authenticated) ──────────────────────
    // Generates 8 random recovery codes, stores hashed versions, returns plaintext (one-time only).
    if (method === 'POST' && /\/settings\/mfa\/recovery-codes\/generate\/?$/.test(path)) {
      const userSub = getSubFromAuth(event);
      if (!userSub) {
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      // Check recovery codes feature is enabled
      const configRes = await ddb.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'recovery-codes-config' } })
      );
      if (configRes.Item && !configRes.Item.enabled) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Recovery codes are not enabled' }) };
      }
      // Verify the user actually has MFA enabled — codes are meaningless without a TOTP secret
      try {
        const userRes = await getCognito().send(
          new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userSub })
        );
        const mfaOptions = userRes.UserMFASettingList ?? [];
        if (mfaOptions.length === 0) {
          return {
            statusCode: 400,
            headers: HEADERS,
            body: JSON.stringify({ error: 'MFA is not enabled — set up MFA before generating recovery codes' }),
          };
        }
      } catch (err: any) {
        console.error('generate recovery codes: failed to check MFA status', err);
        return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Failed to verify MFA status' }) };
      }
      // Generate codes and hash them in parallel (bcrypt is async)
      const plaintextCodes: string[] = [];
      for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
        plaintextCodes.push(generateRecoveryCode());
      }
      const hashedCodes = await Promise.all(
        plaintextCodes.map(async (code) => ({ hash: await hashRecoveryCode(code), used: false }))
      );
      // Store hashed codes (replaces any existing codes for this user)
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            setting: `recovery-codes#${userSub}`,
            codes: hashedCodes,
            failedAttempts: 0,
            lastFailedAt: null,
            createdAt: new Date().toISOString(),
          },
        })
      );
      console.log(
        JSON.stringify({
          event: 'RECOVERY_CODES_GENERATED',
          userId: userSub,
          count: RECOVERY_CODE_COUNT,
          timestamp: new Date().toISOString(),
        })
      );
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ codes: plaintextCodes }),
      };
    }

    // ── Recovery Codes: Verify (PUBLIC — called mid-login) ──────────────
    // Validates a recovery code, disables MFA temporarily, creates safety record.
    if (method === 'POST' && /\/settings\/mfa\/recovery-codes\/verify\/?$/.test(path)) {
      const body = JSON.parse(event.body || '{}');
      const code = body.code as string | undefined;
      const username = body.username as string | undefined;

      if (
        !code ||
        typeof code !== 'string' ||
        code.length !== RECOVERY_CODE_LENGTH ||
        !username ||
        typeof username !== 'string' ||
        username.length > 256
      ) {
        return {
          statusCode: 400,
          headers: HEADERS,
          body: JSON.stringify({ success: false, error: 'Invalid recovery code' }),
        };
      }

      // Check recovery codes feature is enabled (default to enabled when no record exists,
      // consistent with the GET /settings/mfa and generate endpoints)
      const configRes = await ddb.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'recovery-codes-config' } })
      );
      if (configRes.Item && !configRes.Item.enabled) {
        return {
          statusCode: 403,
          headers: HEADERS,
          body: JSON.stringify({ success: false, error: 'Recovery codes are not enabled' }),
        };
      }

      // Resolve the username to a Cognito sub — codes are stored under sub,
      // but this endpoint receives a login username (which may be an email alias).
      let userSub: string;
      try {
        const userRes = await getCognito().send(
          new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
        );
        const subAttr = userRes.UserAttributes?.find((a) => a.Name === 'sub');
        if (!subAttr?.Value) {
          return {
            statusCode: 200,
            headers: HEADERS,
            body: JSON.stringify({ success: false, error: 'Invalid recovery code' }),
          };
        }
        userSub = subAttr.Value;
      } catch (err: any) {
        if (err.name === 'UserNotFoundException') {
          // Don't reveal whether the user exists — same generic error
          return {
            statusCode: 200,
            headers: HEADERS,
            body: JSON.stringify({ success: false, error: 'Invalid recovery code' }),
          };
        }
        throw err;
      }

      // Fetch the user's recovery codes
      const codesRes = await ddb.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { setting: `recovery-codes#${userSub}` } })
      );
      if (!codesRes.Item?.codes) {
        return {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify({ success: false, error: 'Invalid recovery code' }),
        };
      }

      const record = codesRes.Item as {
        codes: { hash: string; used: boolean }[];
        failedAttempts?: number;
        lastFailedAt?: string | null;
      };

      // Rate limit check: 5 failed attempts per 15 minutes.
      // NOTE: This is keyed by username, so an attacker who knows a username can lock
      // them out of recovery codes. This is an acceptable tradeoff — the admin MFA reset
      // path is the fallback. Consider adding AWS WAF IP-based rate limiting upstream
      // for defence-in-depth.
      const failedAttempts = record.failedAttempts ?? 0;
      const lastFailedAt = record.lastFailedAt ? new Date(record.lastFailedAt).getTime() : 0;
      const windowExpired = Date.now() - lastFailedAt > RECOVERY_RATE_LIMIT_WINDOW_MS;

      if (failedAttempts >= RECOVERY_MAX_FAILED_ATTEMPTS && !windowExpired) {
        const retryAfter = Math.ceil((lastFailedAt + RECOVERY_RATE_LIMIT_WINDOW_MS - Date.now()) / 60000);
        return {
          statusCode: 429,
          headers: HEADERS,
          body: JSON.stringify({
            success: false,
            error: `Too many failed attempts. Try again in ${retryAfter} minutes.`,
          }),
        };
      }

      // Compare against ALL codes to prevent timing oracle — always run bcrypt
      // for every code regardless of used status or prior match. This ensures
      // response time is constant regardless of which code matches or how many are used.
      let matchIndex = -1;
      for (let i = 0; i < record.codes.length; i++) {
        const matches = await verifyRecoveryCode(code, record.codes[i].hash);
        if (!record.codes[i].used && matches) {
          matchIndex = i;
        }
      }

      if (matchIndex === -1) {
        // Increment failed attempts (reset counter if window expired)
        const newFailedAttempts = windowExpired ? 1 : failedAttempts + 1;
        await ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { setting: `recovery-codes#${userSub}` },
            UpdateExpression: 'SET failedAttempts = :fa, lastFailedAt = :lfa',
            ExpressionAttributeValues: {
              ':fa': newFailedAttempts,
              ':lfa': new Date().toISOString(),
            },
          })
        );
        console.warn(
          JSON.stringify({
            event: 'RECOVERY_CODE_FAILED',
            username,
            failedAttempts: newFailedAttempts,
            sourceIp: event.requestContext.http.sourceIp,
          })
        );
        return {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify({ success: false, error: 'Invalid recovery code' }),
        };
      }

      // Mark code as used atomically with a condition to prevent race conditions —
      // two simultaneous requests with the same code must not both succeed.
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { setting: `recovery-codes#${userSub}` },
            UpdateExpression: `SET codes[${matchIndex}].used = :used, failedAttempts = :zero`,
            ConditionExpression: `codes[${matchIndex}].used = :notUsed`,
            ExpressionAttributeValues: { ':used': true, ':zero': 0, ':notUsed': false },
          })
        );
      } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') {
          // Another request already used this code — treat as invalid
          return {
            statusCode: 200,
            headers: HEADERS,
            body: JSON.stringify({ success: false, error: 'Invalid recovery code' }),
          };
        }
        throw err;
      }

      // Disable MFA so Cognito will issue tokens on re-login, then write a
      // grace period record (same mechanism as admin MFA reset). On re-login,
      // token-adjuster detects the grace period and injects mfa_reset_pending
      // into the token claims, which triggers the MFA enrollment screen on the
      // frontend. MFA is re-enabled when the user completes enrollment.
      // This is safer than the old approach (disable + hope restore-mfa is called)
      // because the grace period record guarantees re-enrollment is enforced.
      // NOTE: USER_POOL_ID is validated at module load and already used earlier in
      // this handler (AdminGetUserCommand), so no need to check it again here.
      await getCognito().send(
        new AdminSetUserMFAPreferenceCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
          SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false },
        })
      );

      // Revoke ALL existing sessions — prevents an attacker who has the password
      // from starting a new login during the grace period window. Only the
      // immediate re-login from this same browser tab will succeed.
      try {
        await getCognito().send(new AdminUserGlobalSignOutCommand({ UserPoolId: USER_POOL_ID, Username: username }));
      } catch (err: any) {
        // Non-fatal — user may not have active sessions
        console.warn('AdminUserGlobalSignOut non-fatal error:', err.message);
      }

      // Write grace period record — same mechanism as admin reset. Token-adjuster
      // checks this and injects mfa_reset_pending claim, forcing re-enrollment.
      // Uses shorter grace period (1hr vs 24hr) since user is actively logging in.
      const nowSec = Math.floor(Date.now() / 1000);
      const expiresAt = nowSec + RECOVERY_GRACE_PERIOD_SECONDS;
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            setting: `mfa-reset#${userSub}`,
            targetUserId: userSub,
            resetByAdminId: 'recovery-code',
            resetAt: new Date().toISOString(),
            expiresAt,
            status: 'pending',
            resetHistory: [{ at: new Date().toISOString(), by: 'recovery-code' }],
            ttl: expiresAt + 86400,
          },
        })
      );

      // Delete all recovery codes — old codes are tied to the old TOTP secret.
      // User will get fresh codes when they re-enrol MFA.
      await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { setting: `recovery-codes#${userSub}` } }));

      console.log(
        JSON.stringify({
          event: 'RECOVERY_CODE_USED',
          username,
          userSub,
          message: 'All recovery codes invalidated — user must re-enrol MFA',
          sourceIp: event.requestContext.http.sourceIp,
          timestamp: new Date().toISOString(),
        })
      );

      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ success: true }),
      };
    }

    // ── Recovery Codes: Status (authenticated) ──────────────────────────
    // Returns count of remaining unused recovery codes.
    if (method === 'GET' && /\/settings\/mfa\/recovery-codes\/status\/?$/.test(path)) {
      const userSub = getSubFromAuth(event);
      if (!userSub) {
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
      }

      // Check if feature is enabled
      const configRes = await ddb.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'recovery-codes-config' } })
      );
      if (configRes.Item && !configRes.Item.enabled) {
        return {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify({ hasRecoveryCodes: false, remainingCodes: 0, totalCodes: 0, enabled: false }),
        };
      }

      const codesRes = await ddb.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { setting: `recovery-codes#${userSub}` } })
      );
      if (!codesRes.Item?.codes) {
        return {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify({ hasRecoveryCodes: false, remainingCodes: 0, totalCodes: 0, enabled: true }),
        };
      }

      const codes = codesRes.Item.codes as { hash: string; used: boolean }[];
      const remaining = codes.filter((c) => !c.used).length;

      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({
          hasRecoveryCodes: true,
          remainingCodes: remaining,
          totalCodes: codes.length,
          enabled: true,
        }),
      };
    }

    return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error('admin-mfa-settings error', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
