/**
 * OAuth Providers Service - Provider-agnostic OAuth for cloud storage
 *
 * Architecture:
 * 1. OAuth tokens stored securely in Vault (access_token, refresh_token, expires_at)
 * 2. Automatic token refresh using refresh_token when access_token expires
 * 3. Transparent reauthentication without user intervention
 * 4. Provider list loaded dynamically from GET /oauth/providers
 */

import type {
  OAuthProviderType,
  OAuthProviderInfo,
  OAuthConnectionStatus,
  OAuthFile,
  OAuthFolderContents,
} from '../types/oauthProviders';

// Cache for connection statuses to avoid repeated vault calls
const statusCache: Record<string, { status: OAuthConnectionStatus; lastChecked: number }> = {};

// Cache for providers list
let providersCache: { providers: OAuthProviderInfo[]; lastChecked: number } | null = null;
const PROVIDERS_CACHE_TTL = 60_000; // 1 minute

// API helper functions
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

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed with status ${response.status}`);
  }
  return response.json();
}

export class OAuthProvidersService {
  /**
   * List all configured OAuth providers from the backend.
   * Returns provider info (id, display_name, icon, description, configured).
   */
  static async listProviders(): Promise<OAuthProviderInfo[]> {
    // Check cache
    if (providersCache && Date.now() - providersCache.lastChecked < PROVIDERS_CACHE_TTL) {
      return providersCache.providers;
    }

    try {
      const endpoint = getApiEndpoint();
      const response = await fetch(`${endpoint}/oauth/providers`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      const data = await handleResponse<{ providers: OAuthProviderInfo[] }>(response);
      const providers = data.providers || [];

      // Cache the result
      providersCache = { providers, lastChecked: Date.now() };
      return providers;
    } catch (error) {
      console.warn('[OAuth] Failed to list providers:', error);
      return [];
    }
  }

  /** Clear the providers list cache (e.g. after saving new credentials). */
  static clearProvidersCache(): void {
    providersCache = null;
  }

  /**
   * Get connection status for an OAuth provider via backend status endpoint.
   */
  static async getConnectionStatus(provider: OAuthProviderType): Promise<OAuthConnectionStatus> {
    // Check cache first (valid for 30 seconds)
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
      console.warn(`[OAuth] Error checking ${provider} status:`, error);
      const status: OAuthConnectionStatus = {
        status: 'error',
        error_message: 'Failed to check connection status',
      };
      statusCache[provider] = { status, lastChecked: Date.now() };
      return status;
    }
  }

  /**
   * Initiate OAuth connection flow for a provider.
   * Auth URLs come from admin-configured vault secrets — no client-side domain validation.
   */
  static async connect(provider: OAuthProviderType): Promise<{ success: boolean; authUrl?: string; error?: string }> {
    try {
      const endpoint = getApiEndpoint();
      const response = await fetch(`${endpoint}/oauth/${provider}/authorize`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      const data = await handleResponse<{
        success: boolean;
        auth_url?: string;
        session_id?: string;
        error?: string;
      }>(response);

      if (data.success && data.auth_url) {
        // Clear status cache to force refresh after connection
        delete statusCache[provider];

        console.log(`[OAuth] Initiating ${provider} OAuth flow`);

        // Redirect to OAuth provider — CSRF state is validated server-side via PKCE session
        window.location.href = data.auth_url;

        return {
          success: true,
          authUrl: data.auth_url,
        };
      }

      return {
        success: false,
        error: data.error || 'Failed to initiate OAuth flow',
      };
    } catch (error) {
      console.error(`[OAuth] Failed to connect ${provider}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Disconnect OAuth provider (revokes tokens and removes from vault)
   */
  static async disconnect(provider: OAuthProviderType): Promise<{ success: boolean; error?: string }> {
    try {
      const endpoint = getApiEndpoint();
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
        // Clear status cache
        delete statusCache[provider];

        console.log(`[OAuth] Successfully disconnected ${provider}`);
        return { success: true };
      }

      return {
        success: false,
        error: data.error || 'Failed to disconnect',
      };
    } catch (error) {
      console.error(`[OAuth] Failed to disconnect ${provider}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Disconnect failed',
      };
    }
  }

  /**
   * List files and folders for an OAuth provider using vault-stored tokens
   */
  static async listContents(
    provider: OAuthProviderType,
    folderId?: string,
    pageSize?: number,
    pageToken?: string
  ): Promise<OAuthFolderContents> {
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
      throw new Error(`Failed to list contents: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Download file from OAuth provider (for transfer functionality)
   * Uses automatic token refresh to ensure valid authentication
   */
  static async downloadFile(provider: OAuthProviderType, fileId: string): Promise<Blob> {
    try {
      const endpoint = getApiEndpoint();
      const encodedFileId = encodeURIComponent(fileId);

      const response = await fetch(`${endpoint}/oauth-files/${provider}/download/${encodedFileId}`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Download failed with status ${response.status}`);
      }

      // Return the blob from the response
      return await response.blob();
    } catch (error) {
      console.error(`[OAuth] Failed to download file from ${provider}:`, error);
      throw new Error(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Search files in OAuth provider
   */
  static async searchFiles(
    provider: OAuthProviderType,
    query: string,
    folderId?: string,
    pageSize?: number,
    pageToken?: string
  ): Promise<OAuthFolderContents> {
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
