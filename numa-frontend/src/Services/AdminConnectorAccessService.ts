/**
 * AdminConnectorAccessService — client for the admin-connector-access Lambda
 * (FEAT-129 Connector Access Review). Always pass the auth helpers from
 * useNumaRequest(); without them the calls fall back to unauthenticated fetch
 * and 401 (see numa-frontend/CLAUDE.md → API Requests).
 */

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

/** Where the authorization originates — native vault or Pipedream proxy. */
export type ConnectorAuthorizationSource = 'native' | 'pipedream';

/** One connector authorization row, as returned by the GET endpoint. */
export type ConnectorAuthorization = {
  id: string;
  userSub: string;
  userEmail: string;
  /** Connector provider slug, e.g. "googledrive", "synergy", "slack". */
  connector: string;
  /**
   * Display-friendly provider name from the backend (e.g. "Google", "Slack").
   * Null when the backend cannot resolve a provider for the row.
   */
  provider: string | null;
  source: ConnectorAuthorizationSource;
  method: 'oauth' | 'pat' | 'apikey' | 'unknown';
  /** Granted scopes; empty when the source exposes none (rendered as "—"). */
  scopes: string[];
  connectedAt: string | null;
  /**
   * ISO8601 timestamp of the last recorded tool use, sourced from the
   * CONNECTOR_USAGE_TABLE. Null when the connector has never been used.
   */
  lastUsedAt: string | null;
  status: 'active' | 'revoked';
};

export type ConnectorAccessListResult = {
  authorizations: ConnectorAuthorization[];
  /**
   * True while Pipedream-backed connections are out of scope. Once the backend
   * renders Pipedream rows it returns `false`, and the FE drops the deferral
   * notice. Defaults to `false` so a backend that omits the flag is treated as
   * Pipedream-capable.
   */
  pipedreamDeferred: boolean;
};

/** Outcome of one row inside a bulk revoke, keyed by the row id. */
export type ConnectorRevokeResult = {
  id: string;
  revoked: boolean;
  /** Backend reason string when `revoked` is false (e.g. "not_connected"). */
  reason?: string;
};

export type ConnectorBulkRevokeResult = {
  results: ConnectorRevokeResult[];
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const isSource = (v: unknown): v is ConnectorAuthorizationSource => v === 'native' || v === 'pipedream';

function parseAuthorization(raw: unknown): ConnectorAuthorization | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const userSub = typeof raw.userSub === 'string' ? raw.userSub : '';
  const connector = typeof raw.connector === 'string' ? raw.connector : '';
  if (!id || !userSub || !connector) return null;
  const methodRaw = raw.method;
  const method = methodRaw === 'oauth' || methodRaw === 'pat' || methodRaw === 'apikey' ? methodRaw : 'unknown';
  return {
    id,
    userSub,
    userEmail: typeof raw.userEmail === 'string' ? raw.userEmail : userSub,
    connector,
    provider: typeof raw.provider === 'string' && raw.provider.length > 0 ? raw.provider : null,
    source: isSource(raw.source) ? raw.source : 'native',
    method,
    scopes: Array.isArray(raw.scopes) ? raw.scopes.filter((s): s is string => typeof s === 'string') : [],
    connectedAt: typeof raw.connectedAt === 'string' ? raw.connectedAt : null,
    lastUsedAt: typeof raw.lastUsedAt === 'string' ? raw.lastUsedAt : null,
    status: raw.status === 'revoked' ? 'revoked' : 'active',
  };
}

/**
 * Split a row id (`{userSub}::{secretKey}`) into its parts. Throws when the id
 * is malformed so callers fail loudly rather than POSTing a bad target.
 */
function splitRowId(id: string): { userSub: string; secretKey: string } {
  const sep = id.indexOf('::');
  if (sep < 0) throw new Error('Invalid authorization id');
  return { userSub: id.slice(0, sep), secretKey: id.slice(sep + 2) };
}

function parseRevokeResult(raw: unknown): ConnectorRevokeResult | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!id) return null;
  return {
    id,
    revoked: raw.revoked === true,
    reason: typeof raw.reason === 'string' ? raw.reason : undefined,
  };
}

export const AdminConnectorAccessService = {
  /** List every connector authorization (native + Pipedream) in the tenant. */
  async list(numaGet: NumaGet): Promise<ConnectorAccessListResult> {
    const data = await numaGet('/api/settings/connector-access');
    const obj = isRecord(data) ? data : {};
    const rawList = Array.isArray(obj.authorizations) ? obj.authorizations : [];
    const authorizations = rawList.map(parseAuthorization).filter((a): a is ConnectorAuthorization => a !== null);
    return { authorizations, pipedreamDeferred: obj.pipedreamDeferred === true };
  },

  /**
   * Revoke a single authorization. Deriving userSub + secretKey from the row id
   * (`{userSub}::{secretKey}`) keeps the request stable even if the row's
   * derived fields drift.
   */
  async revoke(numaPost: NumaPost, row: Pick<ConnectorAuthorization, 'id' | 'source'>): Promise<void> {
    const { userSub, secretKey } = splitRowId(row.id);
    await numaPost('/api/settings/connector-access/revoke', {
      userSub,
      secretKey,
      source: row.source ?? 'native',
    });
  },

  /**
   * Revoke many authorizations in one request. Posts the full set of targets to
   * the revoke-bulk endpoint and returns a per-row result so the caller can
   * drop the rows that succeeded and surface the rest. Falls back to a synthetic
   * failure result for every target if the response omits results entirely.
   */
  async revokeBulk(
    numaPost: NumaPost,
    rows: Pick<ConnectorAuthorization, 'id' | 'source'>[]
  ): Promise<ConnectorBulkRevokeResult> {
    const targets = rows.map((row) => {
      const { userSub, secretKey } = splitRowId(row.id);
      return { id: row.id, userSub, secretKey, source: row.source ?? 'native' };
    });
    const data = await numaPost('/api/settings/connector-access/revoke-bulk', { targets });
    const obj = isRecord(data) ? data : {};
    const rawResults = Array.isArray(obj.results) ? obj.results : [];
    const results = rawResults.map(parseRevokeResult).filter((r): r is ConnectorRevokeResult => r !== null);
    if (results.length === 0) {
      // Backend returned nothing parseable — treat all as failed so the UI keeps
      // the rows visible rather than silently dropping them.
      return { results: targets.map((tgt) => ({ id: tgt.id, revoked: false, reason: 'no_result' })) };
    }
    return { results };
  },
};
