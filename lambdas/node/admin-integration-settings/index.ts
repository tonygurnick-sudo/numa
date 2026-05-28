import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SUPPORTED_INTEGRATIONS } from '../../../infra/config/integrations';
import { NATIVE_CONNECTORS, PIPEDREAM_TO_CONNECTOR, CONNECTOR_TO_PIPEDREAM } from '../../../infra/config/connectors';

const TABLE_NAME = process.env.GLOBAL_TABLE_NAME as string;
const CONNECTOR_TABLE_NAME = process.env.CONNECTOR_SETTINGS_TABLE_NAME as string | undefined;
const CLIENT_NAME = process.env.CLIENT_NAME as string;
// Admin-side gate. When false, the unified catalog skips every native row
// so admins can't manage them and users never see them. When true, both
// Pipedream and native services surface in the catalog. There is no
// per-chat user-facing toggle anymore — per-integration enable replaces it.
const DATA_CONNECTORS_ENABLED = (process.env.DATA_CONNECTORS_ENABLED || '').toLowerCase() === 'true';

const ddbDoc = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}));

type Method = 'native' | 'pipedream';

type IntegrationItem = {
  integration: string;
  status: 'enabled' | 'disabled';
  denyTools: string[];
  preferred_method?: Method | null;
  // FEAT-019: when true, users may connect more than one account for this
  // integration. Defaults to false so behaviour is unchanged for existing
  // tenants until an admin opts in per integration.
  allowMultipleAccounts?: boolean;
  updatedAt?: string;
  updatedBy?: string;
};

type ConnectorSettingsRow = {
  connector: string;
  status?: 'enabled' | 'disabled';
};

type CatalogEntry = {
  slug: string; // canonical slug — Pipedream slug if available, else connector slug
  pipedreamSlug: string | null;
  connectorSlug: string | null;
  methods: Method[]; // which methods exist for this service in the registries
  preferred_method: Method | null; // admin's chosen method when both exist
  pipedreamEnabled: boolean | null; // null when no Pipedream registry entry
  connectorEnabled: boolean | null; // null when no native connector registry entry
  // FEAT-019: false (or absent) means single-account; users only see the
  // legacy single-account UI. True unlocks the "Manage connected accounts"
  // section in the user-facing manage modal.
  allowMultipleAccounts: boolean;
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

function normalizePreferredMethod(value: unknown): Method | null {
  if (value === 'native' || value === 'pipedream') return value;
  return null;
}

async function scanIntegrationSettings(): Promise<Map<string, IntegrationItem>> {
  const out = new Map<string, IntegrationItem>();
  const scan = await ddbDoc.send(new ScanCommand({ TableName: TABLE_NAME }));
  for (const i of scan.Items || []) {
    const item: IntegrationItem = {
      integration: i.integration as string,
      status: ((i.status as string) === 'enabled' ? 'enabled' : 'disabled') as 'enabled' | 'disabled',
      denyTools: (i.denyTools as string[]) || [],
      preferred_method: normalizePreferredMethod(i.preferred_method),
      allowMultipleAccounts: i.allowMultipleAccounts === true,
    };
    out.set(item.integration, item);
  }
  return out;
}

async function scanConnectorSettings(): Promise<Map<string, ConnectorSettingsRow>> {
  const out = new Map<string, ConnectorSettingsRow>();
  if (!CONNECTOR_TABLE_NAME) return out;
  const scan = await ddbDoc.send(new ScanCommand({ TableName: CONNECTOR_TABLE_NAME }));
  for (const i of scan.Items || []) {
    out.set(i.connector as string, {
      connector: i.connector as string,
      status: (i.status as string) === 'enabled' ? 'enabled' : 'disabled',
    });
  }
  return out;
}

async function buildCatalog(): Promise<CatalogEntry[]> {
  const [integrationSettings, connectorSettings] = await Promise.all([
    scanIntegrationSettings(),
    DATA_CONNECTORS_ENABLED ? scanConnectorSettings() : Promise.resolve(new Map<string, ConnectorSettingsRow>()),
  ]);

  const entries: CatalogEntry[] = [];
  const seenConnectors = new Set<string>();

  // Pipedream-first: every supported integration becomes a catalog entry.
  // When natives are admin-disabled, pair `connectorSlug` is forced to null
  // so the resulting catalog entry never advertises a native method.
  for (const pdSlug of SUPPORTED_INTEGRATIONS) {
    const connectorSlug = DATA_CONNECTORS_ENABLED ? (PIPEDREAM_TO_CONNECTOR[pdSlug] ?? null) : null;
    if (connectorSlug) seenConnectors.add(connectorSlug);

    const integrationRow = integrationSettings.get(pdSlug);
    const connectorRow = connectorSlug ? connectorSettings.get(connectorSlug) : undefined;

    const methods: Method[] = ['pipedream'];
    if (connectorSlug) methods.push('native');

    // Tri-state for {pipedream,connector}Enabled:
    //   true  → row exists in the corresponding settings table, status='enabled'
    //   false → row exists, status='disabled' (admin explicitly paused)
    //   null  → no row at all (admin never touched this service via the
    //           new flag layout — frontend should fall back to vault
    //           presence for backwards compatibility with legacy setups).
    // The previous shape coerced "no row" into false, which made legacy
    // native connections (Gmail/Drive set up via the vault path) look
    // explicitly disabled on the user-facing /integrations page.
    entries.push({
      slug: pdSlug,
      pipedreamSlug: pdSlug,
      connectorSlug,
      methods,
      preferred_method: integrationRow?.preferred_method ?? null,
      pipedreamEnabled: integrationRow ? integrationRow.status === 'enabled' : null,
      connectorEnabled: connectorRow ? connectorRow.status === 'enabled' : null,
      allowMultipleAccounts: integrationRow?.allowMultipleAccounts === true,
    });
  }

  // Native-only: any connector that didn't appear via a Pipedream overlap.
  // Skip entirely when the admin gate is off so users never see natives.
  if (!DATA_CONNECTORS_ENABLED) {
    return entries;
  }
  for (const connectorSlug of NATIVE_CONNECTORS) {
    if (seenConnectors.has(connectorSlug)) continue;
    if (CONNECTOR_TO_PIPEDREAM[connectorSlug]) continue; // safety: already covered

    const connectorRow = connectorSettings.get(connectorSlug);
    entries.push({
      slug: connectorSlug,
      pipedreamSlug: null,
      connectorSlug,
      methods: ['native'],
      preferred_method: null,
      pipedreamEnabled: null,
      connectorEnabled: connectorRow ? connectorRow.status === 'enabled' : null,
      // Native-only entries cannot opt in; FEAT-019 is Pipedream-scope only.
      allowMultipleAccounts: false,
    });
  }

  return entries;
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

    // Unified catalog — must match before the generic settings GET because the path
    // suffix `/catalog` would otherwise be parsed as an integration name.
    if (method === 'GET' && /\/settings\/integrations\/catalog\/?$/.test(path)) {
      const services = await buildCatalog();
      return { statusCode: 200, headers, body: JSON.stringify({ services }) };
    }

    // Allow any authenticated user to READ global settings
    if (method === 'GET' && /\/settings\/integrations\/?$/.test(path)) {
      const scan = await ddbDoc.send(new ScanCommand({ TableName: TABLE_NAME }));
      const items = (scan.Items || []).map((i) => ({
        integration: i.integration,
        status: (i.status as string) || 'disabled',
        denyTools: (i.denyTools as string[]) || [],
        preferred_method: normalizePreferredMethod(i.preferred_method),
        allowMultipleAccounts: i.allowMultipleAccounts === true,
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
      const preferred_method = normalizePreferredMethod(body.preferred_method);

      // Partial-update semantics for allowMultipleAccounts: when the field is
      // omitted from the body, keep whatever's already stored. This means the
      // status/denyTools/preferred_method toggles don't accidentally wipe the
      // multi-account opt-in every time they save. Only the dedicated toggle
      // sends this field explicitly.
      let allowMultipleAccounts: boolean;
      if (typeof body.allowMultipleAccounts === 'boolean') {
        allowMultipleAccounts = body.allowMultipleAccounts;
      } else {
        const existing = await ddbDoc.send(new GetCommand({ TableName: TABLE_NAME, Key: { integration } }));
        allowMultipleAccounts = existing.Item?.allowMultipleAccounts === true;
      }

      const updated: IntegrationItem = {
        integration,
        status,
        denyTools,
        preferred_method,
        allowMultipleAccounts,
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
