/**
 * OAuth Provider types for Remote Files integration
 *
 * Provider-agnostic: OAuthProviderType is a plain string, not a union.
 * Providers are configured dynamically via COMPANY vault secrets.
 */

export type OAuthProviderType = string;

export type OAuthProvider = {
  id: OAuthProviderType;
  name: string;
  icon: string;
  description: string;
  available: boolean;
};

/** Provider info returned by GET /oauth/providers */
export interface OAuthProviderInfo {
  id: string;
  display_name: string;
  icon: string;
  description: string;
  configured: boolean;
}

export type OAuthFile = {
  file_id: string;
  name: string;
  size?: number;
  content_type?: string;
  modified_at?: string;
  is_folder: boolean;
  parent_id?: string;
  path?: string;
};

export type OAuthFolder = {
  folder_id: string;
  name: string;
  parent_id?: string;
  path?: string;
  has_subfolders?: boolean;
  no_of_subfolders?: number;
};

export type OAuthConnectionStatus = {
  status: 'connected' | 'disconnected' | 'error';
  user_email?: string;
  connected_at?: string;
  error_message?: string;
};

export type OAuthBreadcrumb = {
  label: string;
  type: 'root' | 'folder';
  id?: string;
  provider?: OAuthProviderType;
};

export type OAuthFolderContents = {
  folders: OAuthFolder[];
  files: OAuthFile[];
  total_count?: number;
  next_page_token?: string;
};
