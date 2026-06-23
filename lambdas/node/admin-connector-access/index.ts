/**
 * admin-connector-access — Connector Access Review (FEAT-129).
 *
 * Admin-only surface that lists every connector authorization in the tenant
 * (which user authorised which connector, with what method/scopes, when, and
 * when it was last used) and lets an admin revoke a single authorization or a
 * batch of them.
 *
 * TWO SOURCES OF TRUTH
 * --------------------
 *  1. NATIVE connectors live in the per-user consolidated Secrets Manager vault
 *     (`{CLIENT_NAME}/vault/users/{user_sub}`). Every OAuth / PAT / API-key
 *     connector a user authorises is stored there under an `oauth-{provider}`
 *     or `connector-{provider}` secret entry (see
 *     `lambdas/python/oauth-files-api/vault_integration.py`). We enumerate
 *     Cognito users, read each user's vault, and project the connector entries
 *     into rows. Revoke clears the credential fields in place — the exact same
 *     mutation `vault_integration.revoke_oauth_token` performs, re-implemented
 *     in Node so we don't cross a Lambda boundary for a single-secret write. It
 *     is idempotent: revoking an already-empty entry is a no-op success.
 *
 *  2. PIPEDREAM connectors live entirely in Pipedream (managed auth — we never
 *     see the OAuth tokens). There is no tenant-wide "list every user's
 *     connections" call, so we fan out per `external_user_id` to the relay's
 *     `get_integration_status` operation (relay → cross-account proxy →
 *     Pipedream `/connect/{project}/accounts`). Each connected app yields one
 *     row per Pipedream account. A single user's relay failure is isolated so a
 *     dead/unhealthy user never blanks the whole list. Revoke routes through
 *     the relay's `disconnect_integration` op (deletes the `apn_xxx` account).
 *     Scopes are unavailable on this surface (the proxy lists accounts with
 *     `include_credentials=false`) so `scopes` is null with an explanatory note.
 *
 * LAST-USED HYDRATION
 * -------------------
 * Each row's `lastUsedAt` is hydrated best-effort from the connector-usage
 * table (`CONNECTOR_USAGE_TABLE`, keyed PK=`USER#{sub}`, SK=`CONN#{provider}#{
 * connector}`, attribute `lastUsedAt` ISO8601). The workspace-chat-tools Lambda
 * writes these rows when a connector is actually used in chat. A missing row,
 * an unset env var, or a DynamoDB error never throws — the field is simply null.
 */

import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { gunzipSync } from 'node:zlib';
import { withPRM } from '../../../lib/prm-node/prm';

const CLIENT_NAME = process.env.CLIENT_NAME as string;
const USER_POOL_ID = process.env.USER_POOL_ID as string | undefined;
const PIPEDREAM_RELAY_LAMBDA_ARN = process.env.PIPEDREAM_RELAY_LAMBDA_ARN as string | undefined;
const CONNECTOR_USAGE_TABLE = process.env.CONNECTOR_USAGE_TABLE as string | undefined;

const sm = withPRM(SecretsManagerClient, {});
let cognitoClient: CognitoIdentityProviderClient | null = null;
const getCognito = (): CognitoIdentityProviderClient => {
  if (!cognitoClient) cognitoClient = withPRM(CognitoIdentityProviderClient, {});
  return cognitoClient;
};
let lambdaClient: LambdaClient | null = null;
const getLambda = (): LambdaClient => {
  if (!lambdaClient) lambdaClient = withPRM(LambdaClient, {});
  return lambdaClient;
};
let ddbDoc: DynamoDBDocumentClient | null = null;
const getDdb = (): DynamoDBDocumentClient => {
  if (!ddbDoc) ddbDoc = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}));
  return ddbDoc;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConnectorMethod = 'oauth' | 'pat' | 'apikey' | 'unknown';

type ConnectorSource = 'native' | 'pipedream';

type AuthorizationRow = {
  /**
   * Stable per-row id. Native: `{userSub}::{secretKey}`. Pipedream:
   * `{userSub}::pd::{accountId}`. Used as a UI key and the revoke target.
   */
  id: string;
  userSub: string;
  userEmail: string;
  /** Connector provider/app slug, e.g. "googledrive", "synergy", "slack". */
  connector: string;
  source: ConnectorSource;
  method: ConnectorMethod;
  /** OAuth scopes when known. null for pipedream (unavailable on this surface). */
  scopes: string[] | null;
  /** Explanatory note when a field is intentionally unavailable. */
  note?: string;
  connectedAt: string | null;
  /** Best-effort from CONNECTOR_USAGE_TABLE; null when no usage signal exists. */
  lastUsedAt: string | null;
  status: 'active' | 'revoked';
  /** Pipedream-only: the `apn_xxx` account id used as the revoke target. */
  accountId?: string;
};

/** Revoke descriptor shared by the single + bulk revoke paths. */
type RevokeTarget = {
  source?: string;
  userSub?: string;
  /** Native target. */
  secretKey?: string;
  /** Pipedream target. */
  accountId?: string;
  connector?: string;
};

type RevokeOutcome = { revoked: boolean; reason?: string };

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
    lastUsedAt: null, // hydrated later from CONNECTOR_USAGE_TABLE
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
// Pipedream relay client
// ---------------------------------------------------------------------------

/**
 * Build the external_user_id Pipedream knows this user by. Mirrors
 * `PipedreamProxyService.deriveExternalUserId` and
 * `pipedream-trigger-lifecycle.buildExternalUserId`: `{clientName}_{userSub}`.
 */
function buildExternalUserId(userSub: string): string {
  return `${CLIENT_NAME}_${userSub}`;
}

/**
 * Invoke the per-client Pipedream relay Lambda for one operation. The relay
 * re-wraps the proxy response as `{ statusCode, body: { success, data, error } }`
 * (body may itself be a JSON string). Mirrors the unwrap in
 * agent-schedules/pipedream-trigger-lifecycle.ts. Throws on any failure so the
 * caller can decide whether to isolate it.
 */
async function invokeRelay<T>(
  operation: string,
  externalUserId: string,
  parameters: Record<string, unknown>
): Promise<T> {
  if (!PIPEDREAM_RELAY_LAMBDA_ARN) {
    throw new Error('Pipedream relay is not configured for this client');
  }
  const result = await getLambda().send(
    new InvokeCommand({
      FunctionName: PIPEDREAM_RELAY_LAMBDA_ARN,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({ operation, external_user_id: externalUserId, parameters })),
    })
  );

  if (result.FunctionError) {
    throw new Error(`Relay invocation failed: ${result.FunctionError}`);
  }
  const responseText = result.Payload ? Buffer.from(result.Payload).toString('utf-8') : '';
  if (!responseText) throw new Error('Empty response from relay');

  let parsed: { statusCode?: number; body?: unknown };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error('Relay response was not valid JSON');
  }

  let body: { success?: boolean; data?: T; error?: string };
  try {
    body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : (parsed.body as never);
  } catch {
    throw new Error('Relay response body was not valid JSON');
  }

  if (parsed.statusCode !== 200 || !body?.success) {
    throw new Error(body?.error ?? `Relay returned status ${parsed.statusCode}`);
  }
  return body.data as T;
}

// Shape of one account inside a `get_integration_status` connection row.
type PdAccount = {
  account_id?: string | null;
  name?: string | null;
  healthy?: boolean | null;
  dead?: boolean | null;
  connected_at?: string | null;
};

// Shape of one connection row from `get_integration_status`.
type PdConnection = {
  app_name: string;
  status: 'connected' | 'not_connected';
  pipedream_account_id?: string | null;
  connected_at?: string | null;
  healthy?: boolean | null;
  dead?: boolean | null;
  accounts?: PdAccount[];
};

const PIPEDREAM_NO_SCOPES_NOTE = 'Pipedream-managed auth — scopes are not exposed by the Connect API.';

/**
 * Fan out to the relay for one user and project their connected Pipedream
 * accounts into rows. One row per `apn_xxx` account. Throws on relay failure so
 * the caller can isolate it per-user (a dead user must not blank the list).
 */
async function listPipedreamRowsForUser(user: CognitoUser): Promise<AuthorizationRow[]> {
  const externalUserId = buildExternalUserId(user.sub);
  const data = await invokeRelay<{ connections?: PdConnection[] }>('get_integration_status', externalUserId, {});
  const connections: PdConnection[] = Array.isArray(data) ? (data as PdConnection[]) : (data?.connections ?? []);

  const rows: AuthorizationRow[] = [];
  for (const conn of connections) {
    if (conn.status !== 'connected') continue;
    // Prefer the per-account list (FEAT-019 multi-account); fall back to the
    // legacy single-account top-level fields for older proxy responses.
    const accounts: PdAccount[] =
      conn.accounts && conn.accounts.length > 0
        ? conn.accounts
        : [
            {
              account_id: conn.pipedream_account_id ?? null,
              healthy: conn.healthy ?? null,
              dead: conn.dead ?? null,
              connected_at: conn.connected_at ?? null,
            },
          ];
    for (const acc of accounts) {
      const accountId = acc.account_id ?? undefined;
      if (!accountId) continue; // can't render or revoke without an apn_xxx
      rows.push({
        id: `${user.sub}::pd::${accountId}`,
        userSub: user.sub,
        userEmail: user.email,
        connector: conn.app_name,
        source: 'pipedream',
        method: 'oauth',
        scopes: null,
        note: PIPEDREAM_NO_SCOPES_NOTE,
        connectedAt: acc.connected_at ?? null,
        lastUsedAt: null, // hydrated later from CONNECTOR_USAGE_TABLE
        status: 'active',
        accountId,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Last-used hydration (CONNECTOR_USAGE_TABLE)
// ---------------------------------------------------------------------------

/**
 * Hydrate `lastUsedAt` on each row from the connector-usage table, best-effort.
 * Keyed PK=`USER#{sub}`, SK=`CONN#{source-or-provider}#{connector}` with an
 * ISO8601 `lastUsedAt` attribute. Never throws: an unset env var, a missing
 * row, or a DynamoDB error leaves the field null. Reads are de-duplicated by
 * key so multiple rows for the same (user, connector) cost a single GetItem.
 */
async function hydrateLastUsed(rows: AuthorizationRow[]): Promise<void> {
  if (!CONNECTOR_USAGE_TABLE || rows.length === 0) return;

  // The usage key is keyed by provider+connector. Native and pipedream rows for
  // the same provider should resolve independently, so we include the source in
  // the SK provider segment for pipedream and use the bare provider for native
  // (the python writer mirrors this — see SHARED CONTRACT).
  const usageKey = (row: AuthorizationRow): { pk: string; sk: string } => ({
    pk: `USER#${row.userSub}`,
    sk: `CONN#${row.source === 'pipedream' ? 'pipedream' : row.method}#${row.connector}`,
  });

  const ddb = getDdb();
  const cache = new Map<string, string | null>();

  await Promise.all(
    rows.map(async (row) => {
      const { pk, sk } = usageKey(row);
      const cacheKey = `${pk}|${sk}`;
      if (cache.has(cacheKey)) {
        row.lastUsedAt = cache.get(cacheKey) ?? null;
        return;
      }
      try {
        const res = await ddb.send(new GetCommand({ TableName: CONNECTOR_USAGE_TABLE, Key: { pk, sk } }));
        const lastUsedAt = res.Item && typeof res.Item.lastUsedAt === 'string' ? (res.Item.lastUsedAt as string) : null;
        cache.set(cacheKey, lastUsedAt);
        row.lastUsedAt = lastUsedAt;
      } catch (err) {
        // Best-effort only — never block the listing on a usage read.
        console.warn('CONNECTOR_USAGE lookup failed', pk, sk, err);
        cache.set(cacheKey, null);
        row.lastUsedAt = null;
      }
    })
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

async function listAuthorizations(): Promise<{ authorizations: AuthorizationRow[]; pipedreamErrors: number }> {
  const users = await listAllUsers();
  const rows: AuthorizationRow[] = [];
  let pipedreamErrors = 0;

  // Native rows: sequential SM reads keep us under rate limits for the MVP; the
  // row count is bounded by (users × connectors).
  for (const user of users) {
    const vault = await readVaultSecret(userVaultId(user.sub));
    if (!vault) continue;
    const secrets = (vault.secrets as Record<string, unknown> | undefined) || {};
    for (const [secretKey, entry] of Object.entries(secrets)) {
      const row = buildRow(user, secretKey, entry);
      if (row && row.status === 'active') rows.push(row);
    }
  }

  // Pipedream rows: fan out per user, isolating each user's relay failure so one
  // dead/unhealthy user can't blank the whole tenant view.
  if (PIPEDREAM_RELAY_LAMBDA_ARN) {
    const settled = await Promise.allSettled(users.map((user) => listPipedreamRowsForUser(user)));
    settled.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        rows.push(...result.value);
      } else {
        pipedreamErrors += 1;
        console.warn('Pipedream connection list failed for user', users[idx]?.sub, result.reason);
      }
    });
  }

  await hydrateLastUsed(rows);
  return { authorizations: rows, pipedreamErrors };
}

// ---------------------------------------------------------------------------
// Revoke (native + pipedream)
// ---------------------------------------------------------------------------

/**
 * Revoke a single NATIVE connector authorization by clearing its vault entry.
 * Mirrors vault_integration.revoke_oauth_token: we keep the entry shell but
 * blank the credential fields, so the user can re-authorise cleanly. Idempotent.
 */
async function revokeNativeAuthorization(userSub: string, secretKey: string): Promise<RevokeOutcome> {
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

/**
 * Revoke a single PIPEDREAM connector authorization via the relay's
 * `disconnect_integration` op, targeting the specific `apn_xxx` account. The
 * proxy treats a Pipedream-side 404 as success (already gone is the desired end
 * state), so this is idempotent. Throws if the relay isn't configured.
 */
async function revokePipedreamAuthorization(userSub: string, accountId: string): Promise<RevokeOutcome> {
  const externalUserId = buildExternalUserId(userSub);
  const data = await invokeRelay<{ disconnected?: boolean; deleted_account_ids?: string[] }>(
    'disconnect_integration',
    externalUserId,
    { account_id: accountId }
  );
  const revoked = data?.disconnected === true || (data?.deleted_account_ids?.length ?? 0) > 0;
  return { revoked, reason: revoked ? undefined : 'not_connected' };
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
    // GET /settings/connector-access — list all authorizations (native + pipedream).
    if (method === 'GET' && /\/settings\/connector-access\/?$/.test(path)) {
      const { authorizations, pipedreamErrors } = await listAuthorizations();
      console.log(
        JSON.stringify({
          _name: 'CONNECTOR_ACCESS_LISTED',
          client: CLIENT_NAME,
          count: authorizations.length,
          nativeCount: authorizations.filter((r) => r.source === 'native').length,
          pipedreamCount: authorizations.filter((r) => r.source === 'pipedream').length,
          pipedreamErrors,
          admin: claims.sub,
        })
      );
      return {
        statusCode: 200,
        headers,
        // `pipedreamErrors` lets the FE surface an honest "N users couldn't be
        // checked" banner; pipedream rows are now first-class, so the list is
        // exhaustive modulo those isolated failures.
        body: JSON.stringify({ authorizations, pipedreamErrors }),
      };
    }

    // POST /settings/connector-access/revoke-bulk — revoke many rows at once.
    if (method === 'POST' && /\/settings\/connector-access\/revoke-bulk\/?$/.test(path)) {
      const body = JSON.parse(event.body || '{}') as { rows?: RevokeTarget[] };
      const targets = Array.isArray(body.rows) ? body.rows : [];
      if (targets.length === 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'rows[] is required' }) };
      }

      // Group native targets by user so we touch each vault secret once (one
      // batched read-modify-write per user instead of one per row), and fan the
      // pipedream disconnects out concurrently.
      const nativeByUser = new Map<string, RevokeTarget[]>();
      const pipedreamTargets: RevokeTarget[] = [];
      const invalid: { target: RevokeTarget; reason: string }[] = [];

      for (const t of targets) {
        const source = (t.source || 'native').trim();
        const userSub = (t.userSub || '').trim();
        if (!userSub) {
          invalid.push({ target: t, reason: 'userSub_required' });
          continue;
        }
        if (source === 'pipedream') {
          if (!(t.accountId || '').trim()) {
            invalid.push({ target: t, reason: 'accountId_required' });
            continue;
          }
          pipedreamTargets.push(t);
        } else {
          const secretKey = (t.secretKey || '').trim();
          if (!secretKey || !classifySecretKey(secretKey)) {
            invalid.push({ target: t, reason: 'not_a_connector' });
            continue;
          }
          const list = nativeByUser.get(userSub) ?? [];
          list.push(t);
          nativeByUser.set(userSub, list);
        }
      }

      const revoked: Array<RevokeTarget & RevokeOutcome> = [];
      const failed: Array<RevokeTarget & { reason: string }> = [];

      for (const inv of invalid) {
        failed.push({ ...inv.target, reason: inv.reason });
      }

      // Native: one batched mutation per user.
      for (const [userSub, userTargets] of nativeByUser.entries()) {
        const secretId = userVaultId(userSub);
        const vault = await readVaultSecret(secretId);
        if (!vault) {
          for (const t of userTargets) failed.push({ ...t, reason: 'vault_not_found' });
          continue;
        }
        const secrets = (vault.secrets as Record<string, unknown> | undefined) || {};
        const now = new Date().toISOString();
        let mutated = false;
        const perTargetOutcome: Array<{ target: RevokeTarget; outcome: RevokeOutcome }> = [];

        for (const t of userTargets) {
          const secretKey = (t.secretKey as string).trim();
          const entry = secrets[secretKey] as Record<string, unknown> | undefined;
          if (!entry) {
            perTargetOutcome.push({ target: t, outcome: { revoked: false, reason: 'not_connected' } });
            continue;
          }
          const provider = classifySecretKey(secretKey)?.connector ?? secretKey;
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
          mutated = true;
          perTargetOutcome.push({ target: t, outcome: { revoked: true } });
        }

        if (mutated) {
          vault.secrets = secrets;
          const vaultMeta = vault.metadata as Record<string, unknown> | undefined;
          if (vaultMeta) vaultMeta.updated_at = now;
          try {
            await sm.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: JSON.stringify(vault) }));
          } catch (err) {
            console.error('Bulk native revoke write failed', userSub, err);
            for (const t of userTargets) failed.push({ ...t, reason: 'write_failed' });
            continue;
          }
        }

        for (const { target, outcome } of perTargetOutcome) {
          if (outcome.revoked) {
            revoked.push({ ...target, ...outcome });
            console.log(
              JSON.stringify({
                _name: 'CONNECTOR_ACCESS_REVOKED',
                client: CLIENT_NAME,
                admin: claims.sub,
                bulk: true,
                source: 'native',
                targetUserSub: target.userSub,
                secretKey: target.secretKey,
                connector: classifySecretKey((target.secretKey as string).trim())?.connector,
                revoked: true,
              })
            );
          } else {
            failed.push({ ...target, reason: outcome.reason ?? 'unknown' });
          }
        }
      }

      // Pipedream: fan out concurrently, one disconnect per target.
      const pdResults = await Promise.allSettled(
        pipedreamTargets.map((t) =>
          revokePipedreamAuthorization((t.userSub as string).trim(), (t.accountId as string).trim())
        )
      );
      pdResults.forEach((res, idx) => {
        const target = pipedreamTargets[idx];
        if (res.status === 'fulfilled' && res.value.revoked) {
          revoked.push({ ...target, ...res.value });
          console.log(
            JSON.stringify({
              _name: 'CONNECTOR_ACCESS_REVOKED',
              client: CLIENT_NAME,
              admin: claims.sub,
              bulk: true,
              source: 'pipedream',
              targetUserSub: target.userSub,
              accountId: target.accountId,
              connector: target.connector,
              revoked: true,
            })
          );
        } else {
          const reason =
            res.status === 'rejected'
              ? res.reason instanceof Error
                ? res.reason.message
                : String(res.reason)
              : (res.value.reason ?? 'not_connected');
          failed.push({ ...target, reason });
        }
      });

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, revoked, failed }) };
    }

    // POST /settings/connector-access/revoke — revoke one row (native or pipedream).
    if (method === 'POST' && /\/settings\/connector-access\/revoke\/?$/.test(path)) {
      const body = JSON.parse(event.body || '{}') as RevokeTarget;
      const source = (body.source || 'native').trim();

      if (source === 'pipedream') {
        const userSub = (body.userSub || '').trim();
        const accountId = (body.accountId || '').trim();
        if (!userSub || !accountId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'userSub and accountId are required for pipedream revoke' }),
          };
        }
        if (!PIPEDREAM_RELAY_LAMBDA_ARN) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Pipedream integrations are not enabled for this client' }),
          };
        }
        const result = await revokePipedreamAuthorization(userSub, accountId);
        console.log(
          JSON.stringify({
            _name: 'CONNECTOR_ACCESS_REVOKED',
            client: CLIENT_NAME,
            admin: claims.sub,
            source: 'pipedream',
            targetUserSub: userSub,
            accountId,
            connector: body.connector,
            revoked: result.revoked,
            reason: result.reason,
          })
        );
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...result }) };
      }

      // Native revoke.
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
          source: 'native',
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
