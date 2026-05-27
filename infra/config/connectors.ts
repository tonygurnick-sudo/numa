/**
 * Native (non-Pipedream) data connectors that participate in the unified
 * Integrations catalog. Mirrors the user-facing entries in
 * `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` —
 * limited to self-service auth methods (OAuth, API key, PAT token). Tier 3
 * contact-required and username/password entries are excluded — neither has
 * a viable admin self-service flow.
 *
 * Used by the catalog endpoint in `admin-integration-settings` so the backend
 * can reason about native connectors without depending on the frontend bundle.
 */
export const NATIVE_CONNECTORS = [
  // OAuth2
  'googledrive',
  'gmail',
  'onedrive',
  'dropbox',
  'workflowmax',
  'podio',
  'simpro',
  'getjobber',
  'wrike',
  'connecteam-oauth',
  'totalsynergy-oauth',
  'xero',
  'myob-account-right',
  'myob-acumatica',
  'netsuite',
  'zoho-crm',
  'quickbooks',
  'actionstep',

  // API key
  'hirehop',
  'connecteam-api',
  'totalsynergy-api',

  // Token
  'synergy',
  'workbench',
  'fergus',
] as const;

export type NativeConnector = (typeof NATIVE_CONNECTORS)[number];

/**
 * Maps a Pipedream app slug to its native connector counterpart when both
 * point at the same external service. Used to detect overlaps so admins can
 * pick a `preferred_method` per service in the unified Integrations UI.
 *
 * Add an entry here only when both methods truly back the same SaaS — not
 * for similarly-named-but-different services (e.g. `microsoft_teams` is not
 * the same as a OneDrive/SharePoint file connector).
 *
 * ⚠️ DUPLICATED in `services/numa-workspace-agent/numa_workspace_agent/
 * mcp_tools/integration_preferences.py` (`_PIPEDREAM_TO_CONNECTOR`). When you
 * add or rename an entry here, MIRROR THE CHANGE there in the same commit —
 * the agent container can't import TS, and a missing entry silently disables
 * `preferred_method` enforcement for that service.
 */
export const PIPEDREAM_TO_CONNECTOR: Record<string, NativeConnector> = {
  gmail: 'gmail',
  google_drive: 'googledrive',
  dropbox: 'dropbox',
  xero_accounting_api: 'xero',
  quickbooks: 'quickbooks',
  podio: 'podio',
  jobber: 'getjobber',
  zoho_crm: 'zoho-crm',
};

/** Reverse lookup: native connector slug -> Pipedream slug, when overlapping. */
export const CONNECTOR_TO_PIPEDREAM: Record<string, string> = Object.fromEntries(
  Object.entries(PIPEDREAM_TO_CONNECTOR).map(([pd, conn]) => [conn, pd])
);
