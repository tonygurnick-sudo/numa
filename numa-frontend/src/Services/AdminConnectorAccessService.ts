/**
 * AdminConnectorAccessService — client for the admin-connector-access Lambda
 * (FEAT-129 Connector Access Review). Always pass the auth helpers from
 * useNumaRequest(); without them the calls fall back to unauthenticated fetch
 * and 401 (see numa-frontend/CLAUDE.md → API Requests).
 */

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

/** One connector authorization row, as returned by the GET endpoint. */
export type ConnectorAuthorization = {
  id: string;
  userSub: string;
  userEmail: string;
  connector: string;
  source: 'native';
  method: 'oauth' | 'pat' | 'apikey' | 'unknown';
  scopes: string[];
  connectedAt: string | null;
  lastUsedAt: string | null;
  status: 'active' | 'revoked';
};

export type ConnectorAccessListResult = {
  authorizations: ConnectorAuthorization[];
  /** True while Pipedream-backed connections are out of scope (MVP). */
  pipedreamDeferred: boolean;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

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
    source: 'native',
    method,
    scopes: Array.isArray(raw.scopes) ? raw.scopes.filter((s): s is string => typeof s === 'string') : [],
    connectedAt: typeof raw.connectedAt === 'string' ? raw.connectedAt : null,
    lastUsedAt: typeof raw.lastUsedAt === 'string' ? raw.lastUsedAt : null,
    status: raw.status === 'revoked' ? 'revoked' : 'active',
  };
}

export const AdminConnectorAccessService = {
  /** List every native connector authorization in the tenant. */
  async list(numaGet: NumaGet): Promise<ConnectorAccessListResult> {
    const data = await numaGet('/api/settings/connector-access');
    const obj = isRecord(data) ? data : {};
    const rawList = Array.isArray(obj.authorizations) ? obj.authorizations : [];
    const authorizations = rawList.map(parseAuthorization).filter((a): a is ConnectorAuthorization => a !== null);
    return { authorizations, pipedreamDeferred: obj.pipedreamDeferred !== false };
  },

  /**
   * Revoke a single native authorization. Deriving userSub + secretKey from the
   * row id (`{userSub}::{secretKey}`) keeps the request stable even if the row's
   * derived fields drift.
   */
  async revoke(numaPost: NumaPost, row: Pick<ConnectorAuthorization, 'id'>): Promise<void> {
    const sep = row.id.indexOf('::');
    if (sep < 0) throw new Error('Invalid authorization id');
    const userSub = row.id.slice(0, sep);
    const secretKey = row.id.slice(sep + 2);
    await numaPost('/api/settings/connector-access/revoke', { userSub, secretKey, source: 'native' });
  },
};
