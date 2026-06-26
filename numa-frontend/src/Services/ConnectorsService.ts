/**
 * ConnectorsService — THE single public entry point for all per-connector,
 * per-user operations across both auth streams (OAuth and PAT).
 *
 * Consumers pass raw string ids. This file is the ONLY place in the app that
 * imports the underlying OAuth and PAT services; every consumer site uses
 * ConnectorsService. That makes it structurally impossible to call the wrong
 * service for a given connector — the bug class that produced the Fergus/
 * Synergy regressions cannot be written at a call site anymore.
 *
 * Enforcement layers (defence-in-depth):
 *   1. Type brand: underlying services accept only `OAuthConnectorId` /
 *      `PATConnectorId` branded types. Raw strings are rejected by the type
 *      checker at compile time.
 *   2. Visibility: underlying services live in `Services/internal/` and are
 *      only imported from this file. ESLint `no-restricted-imports` forbids
 *      direct import anywhere else.
 *   3. Runtime guards: every underlying-service method calls `assertOAuth…` /
 *      `assertPAT…` which re-validates against the registry, catching any
 *      force-cast or registry-drift.
 *   4. Discriminated return types: `connect()` returns a union the caller
 *      must switch on — TS exhaustiveness prevents forgetting a case.
 *   5. Pre-split `listConfigured()`: admin UI gets `{ oauth, pat }`, never a
 *      mixed list that has to be re-filtered at the callsite.
 *   6. Structured logging: every public method logs {op, connectorId,
 *      authType} so CloudWatch Logs Insights has the full call trail.
 */

import { classifyConnector, asFileBrowseId } from './internal/connectorIds';
import type { ClassifiedConnector } from './internal/connectorIds';
import { OAuthProvidersService, OAuthApiError } from './internal/OAuthProvidersService';
import type { OAuthProviderInfo, OAuthConnectionStatus, OAuthFolderContents, OAuthFile } from '../types/oauthProviders';
import { PATConnectorService, PATApiError } from './internal/PATConnectorService';
import type { PATConnectorInfo, PATConnectionStatus, PATCredentialField } from './internal/PATConnectorService';
import { getConnectorById } from '../Components/DataConnectors/connectorRegistry';

// ---------------------------------------------------------------------------
// Re-exported types for consumers (kept stable as surface changes behind them)
// ---------------------------------------------------------------------------
export type { OAuthProviderInfo, OAuthConnectionStatus, OAuthFolderContents, OAuthFile };
export type { PATConnectorInfo, PATConnectionStatus, PATCredentialField };
export { OAuthApiError, PATApiError };

// ---------------------------------------------------------------------------
// Public result shapes
// ---------------------------------------------------------------------------

/** Minimal info per connector for listConfigured. Consumer only needs id + name
 *  + icon + (for PAT) credential-field schema to drive a Connect modal. */
export interface ConnectorSummary {
  id: string;
  displayName: string;
  icon?: string;
  /** Only populated for PAT connectors; fields drive the ConnectCredentialsModal. */
  credentialFields?: PATCredentialField[];
}

export interface ConfiguredConnectors {
  oauth: ConnectorSummary[];
  pat: ConnectorSummary[];
}

export interface ConnectionStatus {
  /** `error` = backend confirmed the token is bad (expired / revoked).
   *  `check_failed` = the status fetch itself failed (network, classify miss,
   *  5xx). These render with different remediation prompts — reconnect vs
   *  retry — so they must stay distinct in the data layer. */
  status: 'connected' | 'disconnected' | 'error' | 'check_failed';
  user_email?: string;
  connected_at?: string;
  error_message?: string;
}

/** Discriminated result of calling `connect(id)`. Consumers MUST switch on
 *  `kind`; TS exhaustiveness ensures no case is forgotten. */
export type ConnectAction =
  | { kind: 'redirecting' }
  | {
      kind: 'needs_credentials';
      connectorId: string;
      displayName: string;
      fields: PATCredentialField[];
    }
  // Client-credentials connectors (e.g. isolved) connect server-side with no
  // redirect — the connection is established immediately, nothing to navigate to.
  | { kind: 'connected' }
  | { kind: 'unsupported'; reason: string };

// ---------------------------------------------------------------------------
// Structured logging
// ---------------------------------------------------------------------------

function log(op: string, connectorId: string, extra: Record<string, unknown> = {}): void {
  const reg = getConnectorById(connectorId);
  // eslint-disable-next-line no-console
  console.info('[ConnectorsService]', {
    op,
    connectorId,
    authType: reg?.authType ?? 'unknown',
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const ConnectorsService = {
  /**
   * Admin-registered connectors for this workspace, pre-split by auth type.
   * Backend endpoints are mixed for back-compat; classification happens here
   * once, then consumers render each stream into its own loop.
   *
   * Unknown connectors (not in the registry) are dropped — the admin wizards
   * are the only route to register one, and they always hydrate the registry
   * first, so "unknown" means bad/stale vault state.
   */
  async listConfigured(): Promise<ConfiguredConnectors> {
    const [oauthProviders, patConnectors] = await Promise.all([
      OAuthProvidersService.listProviders().catch(() => []),
      PATConnectorService.listConnectors().catch(() => []),
    ]);

    const oauth: ConnectorSummary[] = [];
    const pat: ConnectorSummary[] = [];
    const seen = new Set<string>();

    for (const p of oauthProviders) {
      const c = classifyConnector(p.id);
      if (!c || c.kind !== 'oauth') continue;
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const reg = getConnectorById(p.id);
      oauth.push({
        id: p.id,
        displayName: reg?.displayName ?? p.display_name ?? p.id,
        icon: reg?.icon ?? p.icon,
      });
    }

    for (const p of patConnectors) {
      const c = classifyConnector(p.id);
      if (!c || c.kind !== 'pat') continue;
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const reg = getConnectorById(p.id);
      pat.push({
        id: p.id,
        displayName: reg?.displayName ?? p.display_name ?? p.id,
        icon: reg?.icon ?? p.icon,
        credentialFields: reg?.credentialFields ?? p.credential_fields ?? [],
      });
    }

    log('listConfigured', '-', { oauthCount: oauth.length, patCount: pat.length });
    return { oauth, pat };
  },

  /** Per-user connection status for a single connector.
   *
   *  Both the "unknown connector" guard and the catch branch return
   *  `check_failed` (not `error`) — neither is a token-validity signal, so
   *  prompting the user to reconnect would be misleading. `check_failed`
   *  surfaces in the UI as "Couldn't verify connection — try again". */
  async getStatus(connectorId: string): Promise<ConnectionStatus> {
    const c = classifyConnector(connectorId);
    if (!c) {
      log('getStatus', connectorId, { result: 'unknown_connector' });
      return { status: 'check_failed', error_message: `Unknown connector "${connectorId}"` };
    }
    try {
      if (c.kind === 'oauth') {
        const s = await OAuthProvidersService.getConnectionStatus(c.id);
        log('getStatus', connectorId, { result: s.status });
        return s;
      }
      const s = await PATConnectorService.getStatus(c.id);
      log('getStatus', connectorId, { result: s.status });
      return {
        status: s.status,
        user_email: s.user_email,
        connected_at: s.connected_at,
      };
    } catch (err) {
      log('getStatus', connectorId, { error: String(err) });
      return {
        status: 'check_failed',
        error_message: err instanceof Error ? err.message : 'Status request failed',
      };
    }
  },

  /**
   * Initiate connection. Returns a discriminated action the caller must
   * handle exhaustively — either the browser is being redirected (OAuth)
   * or the caller needs to collect credentials from the user and submit
   * them via `saveCredentials`.
   */
  async connect(connectorId: string): Promise<ConnectAction> {
    const c = classifyConnector(connectorId);
    if (!c) {
      log('connect', connectorId, { result: 'unsupported' });
      return { kind: 'unsupported', reason: `Unknown connector "${connectorId}"` };
    }

    if (c.kind === 'oauth') {
      // OAuthProvidersService.connect navigates the window on success. If
      // the authorize call fails (bad vault config, server 500, etc.) it
      // returns { success: false, error }. We propagate that as a thrown
      // error so consumers' existing try/catch surfaces the failure to
      // the user instead of a silent "redirecting" that never happens.
      const result = await OAuthProvidersService.connect(c.id);
      if (!result.success) {
        log('connect', connectorId, { result: 'oauth_failed', error: result.error });
        throw new Error(result.error || 'OAuth authorize failed');
      }
      // Client-credentials connectors (isolved) connect server-side with no
      // redirect — OAuthProvidersService returns { connected: true } and does
      // not navigate the window.
      if (result.connected) {
        log('connect', connectorId, { result: 'connected' });
        return { kind: 'connected' };
      }
      log('connect', connectorId, { result: 'redirecting' });
      return { kind: 'redirecting' };
    }

    // PAT: surface the credential-field schema so the caller renders a modal.
    const reg = getConnectorById(c.id);
    const fields = reg?.credentialFields ?? [];
    log('connect', connectorId, { result: 'needs_credentials', fieldCount: fields.length });
    return {
      kind: 'needs_credentials',
      connectorId: c.id,
      displayName: reg?.displayName ?? c.id,
      fields: fields as PATCredentialField[],
    };
  },

  /** Save per-user PAT credentials. Only valid for PAT connectors; throws
   *  (via the runtime guard) if called with an OAuth id. */
  async saveCredentials(connectorId: string, fields: Record<string, string>): Promise<void> {
    const c = classifyConnector(connectorId);
    if (!c) throw new Error(`Unknown connector "${connectorId}"`);
    if (c.kind !== 'pat') {
      throw new Error(`saveCredentials is only valid for PAT connectors; "${connectorId}" is authType=${c.authType}`);
    }
    await PATConnectorService.saveCredentials(c.id, fields);
    log('saveCredentials', connectorId, { result: 'ok' });
  },

  /** Disconnect / revoke per-user credentials. Routes OAuth -> revoke
   *  endpoint, PAT -> delete credentials endpoint. Throws if the underlying
   *  call fails so callers can surface the error to the user — silently
   *  swallowing here would leave stale UI state. */
  async disconnect(connectorId: string): Promise<void> {
    const c = classifyConnector(connectorId);
    if (!c) {
      log('disconnect', connectorId, { result: 'unknown_connector' });
      return;
    }
    if (c.kind === 'oauth') {
      const result = await OAuthProvidersService.disconnect(c.id);
      if (!result.success) {
        log('disconnect', connectorId, { result: 'oauth_failed', error: result.error });
        throw new Error(result.error || 'Disconnect failed');
      }
    } else {
      await PATConnectorService.revoke(c.id);
    }
    log('disconnect', connectorId, { result: 'ok' });
  },

  /** Force the admin-connector list cache to refresh on next listConfigured. */
  clearListCache(): void {
    OAuthProvidersService.clearProvidersCache();
    PATConnectorService.clearListCache();
  },

  /**
   * File-browsing operations. Exposed as a sub-namespace because the
   * `/oauth-files/{id}/*` endpoints on the backend are mixed-stream by
   * design — OAuth providers (Google Drive, Gmail, OneDrive, Dropbox) and
   * Synergy (PAT) all register via `create_provider` and share the same
   * Lambda. The facade accepts any connector whose registry entry opts
   * into `surfaces: ['files']`; others throw via `asFileBrowseId`.
   */
  files: {
    async list(
      connectorId: string,
      folderId?: string,
      pageSize?: number,
      pageToken?: string
    ): Promise<OAuthFolderContents> {
      const id = ConnectorsService._mustFileBrowse(connectorId, 'files.list');
      return OAuthProvidersService.listContents(id, folderId, pageSize, pageToken);
    },

    async search(
      connectorId: string,
      query: string,
      folderId?: string,
      pageSize?: number,
      pageToken?: string
    ): Promise<OAuthFolderContents> {
      const id = ConnectorsService._mustFileBrowse(connectorId, 'files.search');
      return OAuthProvidersService.searchFiles(id, query, folderId, pageSize, pageToken);
    },

    async download(connectorId: string, fileId: string, version?: number): Promise<Blob> {
      const id = ConnectorsService._mustFileBrowse(connectorId, 'files.download');
      return OAuthProvidersService.downloadFile(id, fileId, version);
    },

    async sendEmail(
      connectorId: string,
      to: string,
      subject: string,
      body: string,
      html = false
    ): Promise<{ success: boolean; message_id?: string }> {
      const id = ConnectorsService._mustFileBrowse(connectorId, 'files.sendEmail');
      return OAuthProvidersService.sendEmail(id, to, subject, body, html);
    },

    async getEmailContent(
      connectorId: string,
      fileId: string
    ): Promise<{ subject: string; from: string; date: string; body_text: string; size: number }> {
      const id = ConnectorsService._mustFileBrowse(connectorId, 'files.getEmailContent');
      return OAuthProvidersService.getEmailContent(id, fileId);
    },
  },

  /** Internal helper: classify for file browsing. Accepts any connector whose
   *  registry entry declares `surfaces: ['files']` (OAuth *or* Synergy/PAT).
   *  Throws otherwise. */
  _mustFileBrowse(connectorId: string, op: string) {
    const id = asFileBrowseId(connectorId);
    if (!id) {
      throw new Error(
        `[ConnectorsService] ${op}: "${connectorId}" does not surface in files (check registry surfaces)`
      );
    }
    return id;
  },
};

export type { ClassifiedConnector };
