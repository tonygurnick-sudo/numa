import { getConnectionIcon, getConnectionFallbackIcon } from '../../config/integrationsConfig';
import { getConnectorById, type ConnectorTemplate } from '../DataConnectors/connectorRegistry';

/**
 * Native connector slug -> Pipedream slug, when both back the same service.
 *
 * ⚠️ DUPLICATED from the canonical source at `infra/config/connectors.ts`
 * (`CONNECTOR_TO_PIPEDREAM`). Frontend bundles can't import infra config; this
 * mirror is small enough to be safe but MUST stay in sync — when you add or
 * rename an entry in the TS infra config or the Python copy at
 * `services/numa-workspace-agent/.../integration_preferences.py`, mirror it
 * here in the same commit.
 *
 * Used in places where the catalog isn't fetched (e.g. chat sidebar) so we
 * can still surface the Pipedream icon for native dual-method services.
 */
export const CONNECTOR_TO_PIPEDREAM: Record<string, string> = {
  gmail: 'gmail',
  googledrive: 'google_drive',
  dropbox: 'dropbox',
  xero: 'xero_accounting_api',
  quickbooks: 'quickbooks',
  podio: 'podio',
  getjobber: 'jobber',
  'zoho-crm': 'zoho_crm',
  rentman: 'rentman',
};

/** Return the Pipedream slug paired with a native connector, or null. */
export function pipedreamSlugForConnector(connectorSlug: string): string | null {
  return CONNECTOR_TO_PIPEDREAM[connectorSlug] ?? null;
}

// Reverse view of CONNECTOR_TO_PIPEDREAM: Pipedream slug -> native connector
// slug. Materialised once at module load.
const _PIPEDREAM_TO_CONNECTOR: Record<string, string> = Object.fromEntries(
  Object.entries(CONNECTOR_TO_PIPEDREAM).map(([conn, pd]) => [pd, conn])
);

/** Return the native connector slug paired with a Pipedream slug, or null. */
export function connectorSlugForPipedream(pipedreamSlug: string): string | null {
  return _PIPEDREAM_TO_CONNECTOR[pipedreamSlug] ?? null;
}

/** Resolve a service's preferred icon, picking the Pipedream image when possible. */
export function resolveServiceIcon(
  pipedreamSlug?: string | null,
  connectorSlug?: string | null
): { iconUrl?: string; iconClass?: string } {
  if (pipedreamSlug) {
    return {
      iconUrl: getConnectionIcon(pipedreamSlug),
      iconClass: getConnectionFallbackIcon(pipedreamSlug),
    };
  }
  if (connectorSlug) {
    const tmpl = getConnectorById(connectorSlug);
    return { iconClass: tmpl?.icon ?? 'bi bi-plug' };
  }
  return {};
}

export type IntegrationPickerEntry = {
  /** Stable key — Pipedream slug if available, else connector slug. */
  key: string;
  name: string;
  description?: string;
  /** Either an image URL (preferred) or a Bootstrap icon class. */
  iconUrl?: string;
  iconClass?: string;
  pipedreamSlug?: string;
  connectorSlug?: string;
  /** Already added — disabled in the picker. */
  alreadyAdded: boolean;
  /** Native connector auth type, when a native connector is available. Surfaced
   *  as an AuthTypeBadge in the picker (OAUTH2 / PAT TOKEN / API KEY / …) so
   *  admins see at a glance what setup the native path requires. */
  nativeAuthType?: ConnectorTemplate['authType'];
};
