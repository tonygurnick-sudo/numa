/**
 * admin-connector-access — Connector Access Review (FEAT-129).
 *
 * Admin-only surface that lists every NATIVE connector authorization in the
 * tenant (which user authorised which connector, with what method/scopes, when)
 * and lets an admin revoke a single authorization.
 *
 * SCOPE OF THIS MVP
 * -----------------
 * The source of truth here is the per-user consolidated Secrets Manager vault
 * (`{CLIENT_NAME}/vault/users/{user_sub}`). Every OAuth / PAT / API-key
 * connector a user authorises is stored there under an `oauth-{provider}` or
 * `connector-{provider}` secret entry (see
 * `lambdas/python/oauth-files-api/vault_integration.py`). We enumerate Cognito
 * users, read each user's vault, and project the connector entries into rows.
 *
 * Revoke for NATIVE connectors clears the vault entry in place — the exact same
 * mutation `vault_integration.revoke_oauth_token` performs, re-implemented in
 * Node so we don't cross a Lambda boundary for a single-secret write. It is
 * idempotent: revoking an already-empty entry is a no-op success.
 *
 * DEFERRED (see documentation/security/connector-access-review.md):
 *   - Pipedream-backed authorizations. The SPIKE confirmed the Pipedream proxy
 *     CAN list a user's connected accounts (`/connect/{project}/accounts`) but
 *     only WITHOUT scopes (include_credentials=false), and there is no
 *     tenant-wide "list every user's connections" call — you must fan out per
 *     external_user_id. Revoke would route through the relay's existing
 *     `disconnect_integration` operation. Both are intentionally out of this
 *     MVP; the GET only reports native rows today.
 *   - Bulk / select-all revoke (perf: one SM write per row).
 *   - CSV export.
 *   - last_used_at is best-effort: the vault does not record per-connector
 *     usage, so it is null until a usage signal is wired in.
 */

import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { gunzipSync } from 'node:zlib';
import { withPRM } from '../../../lib/prm-node/prm';

const CLIENT_NAME = process.env.CLIENT_NAME as string;
const USER_POOL_ID = process.env.USER_POOL_ID as string | undefined;

const sm = withPRM(SecretsManagerClient, {});
let cognitoClient: CognitoIdentityProviderClient | null = null;
const getCognito = (): CognitoIdentityProviderClient => {
  if (!cognitoClient) cognitoClient = withPRM(CognitoIdentityProviderClient, {});
  return cognitoClient;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConnectorMethod = 'oauth' | 'pat' | 'apikey' | 'unknown';

type AuthorizationRow = {
  /** Stable per-row id: `{userSub}::{secretKey}`. Used as the revoke target. */
  id: string;
  userSub: string;
  userEmail: string;
  /** Connector provider slug, e.g. "googledrive", "synergy". */
  connector: string;
  /** native today; pipedream rows are deferred. */
  source: 'native';
  method: ConnectorMethod;
  scopes: string[];
  connectedAt: string | null;
  /** Deferred — vault has no per-connector usage signal yet. */
  lastUsedAt: string | null;
  status: 'active' | 'revoked';
};

type JwtClaims = { [key: string]: unknown; 'cognito:groups'?: string[]; sub?: string };

type CognitoUser = { sub: string; email: string };

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function parseJwt(token: string): JwtClaims {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as JwtClaims;
  } catch {
    return {} as JwtClaims;
  }
}

function getClaims(event: Pick<APIGatewayProxyEventV2, 'headers'>): JwtClaims {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return {} as JwtClaims;
  const token = String(auth).replace(/^Bearer\s+/i, '');
  return parseJwt(token) || ({} as JwtClaims);
}

function isAdmin(claims: JwtClaims): boolean {
  const groups: string[] = (claims['cognito:groups'] as string[]) || [];
  return groups.includes('admin');
}

// ---------------------------------------------------------------------------
// Vault helpers (mirror vault_integration.py shape)
// ---------------------------------------------------------------------------

/** Read + parse a Secrets Manager secret, handling the gzip-compressed shape. */
async function readVaultSecret(secretId: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!res.SecretString) return null;
    let data = JSON.parse(res.SecretString) as Record<string, unknown>;
    if (data._compressed && typeof data._data === 'string') {
      const decompressed = gunzipSync(Buffer.from(data._data, 'base64')).toString('utf8');
      data = JSON.parse(decompressed) as Record<string, unknown>;
    }
    return data;
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return null;
    console.warn('Failed to read vault secret', secretId, err);
    return null;
  }
}

function userVaultId(userSub: string): string {
  return `${CLIENT_NAME}/vault/users/${userSub}`;
}

/**
 * Map a vault secret key to (connector slug, method).
 *   oauth-{provider}      → OAuth tokens, OR legacy single-token PAT
 *   connector-{provider}  → non-OAuth connector (PAT / API key)
 * Anything else is ignored — it isn't a connector authorization.
 */
function classifySecretKey(key: string): { connector: string; method: ConnectorMethod } | null {
  if (key.startsWith('oauth-client-')) return null; // company OAuth client creds, not a user auth
  if (key.startsWith('oauth-')) return { connector: key.slice('oauth-'.length), method: 'oauth' };
  if (key.startsWith('connector-config-')) {
    return { connector: key.slice('connector-config-'.length), method: 'apikey' };
  }
  if (key.startsWith('connector-')) {
    return { connector: key.slice('connector-'.length), method: 'pat' };
  }
  return null;
}

/** Extract the fields object from a secret entry (entry.fields ?? entry). */
function entryFields(entry: unknown): Record<string, unknown> {
  if (entry && typeof entry === 'object') {
    const e = entry as Record<string, unknown>;
    if (e.fields && typeof e.fields === 'object') return e.fields as Record<string, unknown>;
    return e;
  }
  return {};
}

/** True when an entry still holds a usable credential (i.e. not revoked/cleared). */
function isActive(fields: Record<string, unknown>): boolean {
  const token = fields.access_token || fields.api_key || fields.bearer_token || fields.token || fields.refresh_token;
  return typeof token === 'string' && token.length > 0;
}

function parseScopes(fields: Record<string, unknown>): string[] {
  const raw = fields.scope ?? fields.scopes;
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string');
  if (typeof raw === 'string' && raw.trim()) {
    // OAuth scopes are space- or comma-delimited depending on the provider.
    return raw.split(/[\s,]+/).filter(Boolean);
  }
  return [];
}

function buildRow(user: CognitoUser, secretKey: string, entry: unknown): AuthorizationRow | null {
  const classified = classifySecretKey(secretKey);
  if (!classified) return null;
  const fields = entryFields(entry);
  return {
    id: `${user.sub}::${secretKey}`,
    userSub: user.sub,
    userEmail: user.email,
    connector: classified.connector,
    source: 'native',
    method: classified.method,
    scopes: parseScopes(fields),
    connectedAt: typeof fields.connected_at === 'string' ? fields.connected_at : null,
    lastUsedAt: null, // Deferred — no per-connector usage signal in the vault.
    status: isActive(fields) ? 'active' : 'revoked',
  };
}

// ---------------------------------------------------------------------------
// Cognito enumeration
// ---------------------------------------------------------------------------

function getAttr(attrs: { Name?: string; Value?: string }[] | undefined, name: string): string | undefined {
  return attrs?.find((a) => a.Name === name)?.Value;
}

async function listAllUsers(): Promise<CognitoUser[]> {
  if (!USER_POOL_ID) return [];
  const users: CognitoUser[] = [];
  let paginationToken: string | undefined;
  do {
    const res = await getCognito().send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Limit: 60,
        PaginationToken: paginationToken,
      })
    );
    for (const u of res.Users || []) {
      const sub = getAttr(u.Attributes, 'sub');
      const email = getAttr(u.Attributes, 'email');
      if (!sub) continue;
      users.push({ sub, email: email || sub });
    }
    paginationToken = res.PaginationToken;
  } while (paginationToken);
  return users;
}

// ---------------------------------------------------------------------------
// List + revoke
// ---------------------------------------------------------------------------

async function listAuthorizations(): Promise<AuthorizationRow[]> {
  const users = await listAllUsers();
  const rows: AuthorizationRow[] = [];
  // Sequential reads keep us well under SM rate limits for the MVP; the row
  // count is bounded by (users × connectors). Bulk/parallel fan-out is a
  // deferred perf item.
  for (const user of users) {
    const vault = await readVaultSecret(userVaultId(user.sub));
    if (!vault) continue;
    const secrets = (vault.secrets as Record<string, unknown> | undefined) || {};
    for (const [secretKey, entry] of Object.entries(secrets)) {
      const row = buildRow(user, secretKey, entry);
      if (row && row.status === 'active') rows.push(row);
    }
  }
  return rows;
}

/**
 * Revoke a single NATIVE connector authorization by clearing its vault entry.
 * Mirrors vault_integration.revoke_oauth_token: we keep the entry shell but
 * blank the credential fields, so the user can re-authorise cleanly. Idempotent.
 */
async function revokeNativeAuthorization(
  userSub: string,
  secretKey: string
): Promise<{ revoked: boolean; reason?: string }> {
  const secretId = userVaultId(userSub);
  const vault = await readVaultSecret(secretId);
  if (!vault) return { revoked: false, reason: 'vault_not_found' };

  const secrets = (vault.secrets as Record<string, unknown> | undefined) || {};
  const entry = secrets[secretKey] as Record<string, unknown> | undefined;
  if (!entry) return { revoked: false, reason: 'not_connected' };

  const now = new Date().toISOString();
  const classified = classifySecretKey(secretKey);
  const provider = classified?.connector ?? secretKey;

  // Clear credential fields in place. Same cleared shape as the Python path
  // for oauth-* entries; for connector-* we blank the common token fields too.
  entry.fields = {
    provider,
    access_token: '',
    refresh_token: '',
    api_key: '',
    bearer_token: '',
    token: '',
    expires_at: '1970-01-01T00:00:00Z',
    user_email: '',
    scope: '',
    connected_at: '',
  };
  const meta = entry.metadata as Record<string, unknown> | undefined;
  if (meta) meta.updated_at = now;

  secrets[secretKey] = entry;
  vault.secrets = secrets;
  const vaultMeta = vault.metadata as Record<string, unknown> | undefined;
  if (vaultMeta) vaultMeta.updated_at = now;

  await sm.send(
    new PutSecretValueCommand({
      SecretId: secretId,
      // Always write the uncompressed shape — readVaultSecret handles both, and
      // the Python writers also write uncompressed on update.
      SecretString: JSON.stringify(vault),
    })
  );
  return { revoked: true };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path || '';

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,POST',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'application/json',
  };

  if (method === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (!CLIENT_NAME) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  const claims = getClaims(event);
  if (!isAdmin(claims)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  try {
    // GET /settings/connector-access — list all native authorizations.
    if (method === 'GET' && /\/settings\/connector-access\/?$/.test(path)) {
      const authorizations = await listAuthorizations();
      console.log(
        JSON.stringify({
          _name: 'CONNECTOR_ACCESS_LISTED',
          client: CLIENT_NAME,
          count: authorizations.length,
          admin: claims.sub,
        })
      );
      // pipedreamDeferred lets the FE show an honest "Pipedream not covered yet"
      // note instead of implying the list is exhaustive.
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ authorizations, pipedreamDeferred: true }),
      };
    }

    // POST /settings/connector-access/revoke — revoke one row.
    if (method === 'POST' && /\/settings\/connector-access\/revoke\/?$/.test(path)) {
      const body = JSON.parse(event.body || '{}') as {
        userSub?: string;
        secretKey?: string;
        source?: string;
      };

      // Pipedream revoke is deferred (see file header + the security doc).
      if (body.source && body.source !== 'native') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Only native connector revocation is supported in this release' }),
        };
      }

      const userSub = (body.userSub || '').trim();
      const secretKey = (body.secretKey || '').trim();
      if (!userSub || !secretKey) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'userSub and secretKey are required' }),
        };
      }
      if (!classifySecretKey(secretKey)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'secretKey is not a connector authorization' }),
        };
      }

      const result = await revokeNativeAuthorization(userSub, secretKey);
      console.log(
        JSON.stringify({
          _name: 'CONNECTOR_ACCESS_REVOKED',
          client: CLIENT_NAME,
          admin: claims.sub,
          targetUserSub: userSub,
          secretKey,
          connector: classifySecretKey(secretKey)?.connector,
          revoked: result.revoked,
          reason: result.reason,
        })
      );
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...result }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error('admin-connector-access error', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
