/**
 * INTERNAL — do not import outside `Services/ConnectorsService.ts` (or, for
 * OAuth-only file-browsing operations, through the facade's `files` sub-API).
 *
 * OAuth provider auth flow + file-browsing operations. Every auth-lifecycle
 * method requires a branded `OAuthConnectorId`. The only way to obtain one is
 * via `classifyConnector` in `connectorIds.ts`. Runtime
 * `assertOAuthAtRuntime` is belt-and-braces behind the type-level brand.
 *
 * Architecture:
 * 1. OAuth tokens stored securely in Vault (access_token, refresh_token, expires_at).
 * 2. Automatic token refresh using refresh_token when access_token expires.
 * 3. Transparent reauthentication without user intervention.
 * 4. Provider list loaded dynamically from GET /oauth/providers.
 */

import type {
  OAuthProviderInfo,
  OAuthConnectionStatus,
  OAuthFile,
  OAuthFolderContents,
} from '../../types/oauthProviders';
import { getConnectorById } from '../../Components/DataConnectors/connectorRegistry';
import type { OAuthConnectorId, FileBrowseConnectorId } from './connectorIds';
import { assertOAuthAtRuntime, assertFileBrowseAtRuntime } from './connectorIds';

const statusCache: Record<string, { status: OAuthConnectionStatus; lastChecked: number }> = {};

let providersCache: { providers: OAuthProviderInfo[]; lastChecked: number } | null = null;
const PROVIDERS_CACHE_TTL = 60_000;

function getApiEndpoint(): string {
  return sessionStorage.getItem('API_ENDPOINT') || '/api';
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('accessToken');
  if (!token) {
    throw new Error('No access token available. Please sign in again.');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export class OAuthApiError extends Error {
  status: number;
  errorCode?: string;
  constructor(message: string, status: number, errorCode?: string) {
    super(message);
    this.name = 'OAuthApiError';
    this.status = status;
    this.errorCode = errorCode;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new OAuthApiError(
      body.error || `Request failed with status ${response.status}`,
      response.status,
      body.error_code
    );
  }
  return response.json();
}

export class OAuthProvidersService {
  /**
   * List all configured providers from the backend. Backend returns a mixed
   * list (OAuth + PAT) for back-compat; the facade classifies it into clean
   * streams before handing anything back to consumers.
   */
  static async listProviders(refresh = false): Promise<OAuthProviderInfo[]> {
    if (!refresh && providersCache && Date.now() - providersCache.lastChecked < PROVIDERS_CACHE_TTL) {
      return providersCache.providers;
    }

    try {
      const endpoint = getApiEndpoint();
      const qs = refresh ? '?refresh=1' : '';
      const response = await fetch(`${endpoint}/oauth/providers${qs}`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      const data = await handleResponse<{ providers: OAuthProviderInfo[] }>(response);
      const providers = data.providers || [];
      providersCache = { providers, lastChecked: Date.now() };
      return providers;
    } catch (error) {
      console.warn('[OAuth] Failed to list providers:', error);
      return [];
    }
  }

  static clearProvidersCache(): void {
    providersCache = null;
  }

  static async getConnectionStatus(provider: OAuthConnectorId): Promise<OAuthConnectionStatus> {
    assertOAuthAtRuntime(provider, 'getConnectionStatus');
    const cached = statusCache[provider];
    if (cached && Date.now() - cached.lastChecked < 30000) {
      return cached.status;
    }

    try {
      const endpoint = getApiEndpoint();
      const response = await fetch(`${endpoint}/oauth/${provider}/status`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      const data = await handleResponse<{
        status: 'connected' | 'disconnected';
        user_email?: string;
        connected_at?: string;
      }>(response);

      const status: OAuthConnectionStatus = {
        status: data.status,
        user_email: data.user_email,
        connected_at: data.connected_at,
      };

      statusCache[provider] = { status, lastChecked: Date.now() };
      return status;
    } catch (error) {
      // Status fetch itself failed (network/5xx/malformed) — distinct from
      // the backend reporting an actual auth problem. Return `check_failed`
      // so the UI can offer "Try again" instead of misleading the user into
      // a reconnect. Crucially, do NOT cache: caching the fake error would
      // suppress retries for 30s and lock in the wrong remediation prompt.
      console.warn(`[OAuth] Error checking ${provider} status:`, error);
      delete statusCache[provider];
      return {
        status: 'check_failed',
        error_message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  static async connect(
    provider: OAuthConnectorId
  ): Promise<{ success: boolean; authUrl?: string; connected?: boolean; error?: string }> {
    assertOAuthAtRuntime(provider, 'connect');
    try {
      const endpoint = getApiEndpoint();
      const connector = getConnectorById(provider);
      const platform = connector?.oauthPlatform ?? provider;
      const params = new URLSearchParams();
      if (connector?.oauthPlatform) {
        params.set('connector', provider);
      }
      const qs = params.toString() ? `?${params.toString()}` : '';

      const response = await fetch(`${endpoint}/oauth/${platform}/authorize${qs}`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      const data = await handleResponse<{
        success: boolean;
        auth_url?: string;
        session_id?: string;
        connected?: boolean;
        status?: string;
        error?: string;
      }>(response);

      // Client-credentials connectors (e.g. isolved) mint the token server-side
      // from the company credentials and report an IMMEDIATE connection with NO
      // auth_url — there is no per-user redirect/consent. Treat that as connected,
      // not as a failed OAuth start.
      if (data.success && !data.auth_url && (data.connected || data.status === 'connected')) {
        delete statusCache[provider];
        return { success: true, connected: true };
      }

      if (data.success && data.auth_url) {
        delete statusCache[provider];
        window.location.href = data.auth_url;
        return { success: true, authUrl: data.auth_url };
      }

      return { success: false, error: data.error || 'Failed to initiate OAuth flow' };
    } catch (error) {
      console.error(`[OAuth] Failed to connect ${provider}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  static async disconnect(provider: OAuthConnectorId): Promise<{ success: boolean; error?: string }> {
    assertOAuthAtRuntime(provider, 'disconnect');
    try {
      const endpoint = getApiEndpoint();
      // Per-connector revoke URL: user tokens are stored under
      // `oauth-{connectorId}` in the consolidated vault (connect-time uses
      // `session.connector || provider` when writing), so we need the
      // connector slug in the URL, NOT the OAuth platform. Sharing a platform
      // (e.g. google -> gmail + googledrive) only affects the *client*
      // credentials, not the per-user token storage.
      const response = await fetch(`${endpoint}/oauth/${provider}/revoke`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });

      const data = await handleResponse<{
        success: boolean;
        message?: string;
        error?: string;
      }>(response);

      if (data.success) {
        delete statusCache[provider];
        return { success: true };
      }

      return { success: false, error: data.error || 'Failed to disconnect' };
    } catch (error) {
      console.error(`[OAuth] Failed to disconnect ${provider}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Disconnect failed',
      };
    }
  }

  static async listContents(
    provider: FileBrowseConnectorId,
    folderId?: string,
    pageSize?: number,
    pageToken?: string
  ): Promise<OAuthFolderContents> {
    assertFileBrowseAtRuntime(provider, 'listContents');
    try {
      const endpoint = getApiEndpoint();
      const params = new URLSearchParams();

      if (folderId) params.append('folder_id', folderId);
      if (pageSize) params.append('page_size', pageSize.toString());
      if (pageToken) params.append('page_token', pageToken);

      const queryString = params.toString();
      const url = `${endpoint}/oauth-files/${provider}/list${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      const data = await handleResponse<{
        folders: Array<{
          folder_id: string;
          name: string;
          parent_id?: string;
          path: string;
          has_subfolders: boolean;
          no_of_subfolders: number;
        }>;
        files: OAuthFile[];
        total_count: number;
        next_page_token?: string;
      }>(response);

      return {
        folders: data.folders,
        files: data.files,
        total_count: data.total_count,
        next_page_token: data.next_page_token,
      };
    } catch (error) {
      console.error(`[OAuth] Failed to list contents for ${provider}:`, error);
      throw error;
    }
  }

  static async sendEmail(
    provider: FileBrowseConnectorId,
    to: string,
    subject: string,
    body: string,
    html = false
  ): Promise<{ success: boolean; message_id?: string }> {
    assertFileBrowseAtRuntime(provider, 'sendEmail');
    const endpoint = getApiEndpoint();
    const response = await fetch(`${endpoint}/oauth-files/${provider}/send`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, body, html }),
    });
    return handleResponse<{ success: boolean; message_id?: string }>(response);
  }

  static async downloadFile(provider: FileBrowseConnectorId, fileId: string, version?: number): Promise<Blob> {
    assertFileBrowseAtRuntime(provider, 'downloadFile');
    try {
      const endpoint = getApiEndpoint();
      const encodedFileId = encodeURIComponent(fileId);
      // Synergy supports downloading a specific version (from version history).
      const versionQs = version != null ? `?version=${encodeURIComponent(String(version))}` : '';

      const response = await fetch(`${endpoint}/oauth-files/${provider}/download/${encodedFileId}${versionQs}`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Download failed with status ${response.status}`);
      }

      return await response.blob();
    } catch (error) {
      console.error(`[OAuth] Failed to download file from ${provider}:`, error);
      throw new Error(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static async getEmailContent(
    provider: FileBrowseConnectorId,
    fileId: string
  ): Promise<{ subject: string; from: string; date: string; body_text: string; size: number }> {
    assertFileBrowseAtRuntime(provider, 'getEmailContent');
    const endpoint = getApiEndpoint();
    const encodedFileId = encodeURIComponent(fileId);
    const response = await fetch(`${endpoint}/oauth-files/${provider}/message/${encodedFileId}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    return handleResponse(response);
  }

  static async searchFiles(
    provider: FileBrowseConnectorId,
    query: string,
    folderId?: string,
    pageSize?: number,
    pageToken?: string
  ): Promise<OAuthFolderContents> {
    assertFileBrowseAtRuntime(provider, 'searchFiles');
    try {
      const endpoint = getApiEndpoint();
      const params = new URLSearchParams();

      params.append('q', query);
      if (folderId) params.append('folder_id', folderId);
      if (pageSize) params.append('page_size', pageSize.toString());
      if (pageToken) params.append('page_token', pageToken);

      const response = await fetch(`${endpoint}/oauth-files/${provider}/search?${params.toString()}`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      const data = await handleResponse<{
        folders: Array<{
          folder_id: string;
          name: string;
          parent_id?: string;
          path: string;
          has_subfolders: boolean;
          no_of_subfolders: number;
        }>;
        files: OAuthFile[];
        total_count: number;
        next_page_token?: string;
        query: string;
      }>(response);

      return {
        folders: data.folders,
        files: data.files,
        total_count: data.total_count,
        next_page_token: data.next_page_token,
      };
    } catch (error) {
      console.error(`[OAuth] Failed to search files in ${provider}:`, error);
      throw new Error(`Failed to search files: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
