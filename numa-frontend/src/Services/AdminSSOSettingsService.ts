type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaDelete = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;

export type IdpType = 'azure-ad' | 'okta' | 'google-workspace' | 'other';
export type EmailSource = 'email-claim' | 'upn';

export interface SSOConfig {
  configured: boolean;
  enabled: boolean;
  idpType?: IdpType;
  providerProtocol?: 'SAML' | 'OIDC';
  providerName?: string;
  metadataUrl?: string | null;
  hasMetadataXml?: boolean;
  oidcIssuer?: string | null;
  hasOidcClientSecret?: boolean;
  attributeMapping?: Record<string, string>;
  emailSource?: EmailSource;
  ssoOnlyMode?: boolean;
  updatedAt?: string;
}

export interface SSOSaveConfig {
  idpType: IdpType;
  providerProtocol?: 'SAML' | 'OIDC';
  metadataUrl?: string;
  metadataXml?: string;
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcScopes?: string;
  attributeMapping?: Record<string, string>;
  emailSource?: EmailSource;
  ssoOnlyMode?: boolean;
}

export interface GroupMappingConfig {
  enabled: boolean;
  groupClaimName: string;
  mappings: Array<{ idpGroup: string; cognitoGroup: string }>;
}

export interface SSOUser {
  sub: string;
  email: string;
  authMethod: 'password' | 'sso' | 'both';
  providerName?: string;
  created: string;
  status: string;
}

export interface SPMetadata {
  entityId: string;
  acsUrl: string;
  callbackUrl: string;
  signOnUrl: string;
  logoutUrl: string;
}

export interface SSOLoginConfig {
  enabled: boolean;
  providerName?: string;
  idpType?: IdpType;
  ssoOnlyMode?: boolean;
}

export const AdminSSOSettingsService = {
  async get(numaGet: NumaGet): Promise<SSOConfig> {
    return (await numaGet('/api/settings/sso')) as SSOConfig;
  },

  async save(config: SSOSaveConfig, numaPut: NumaPut): Promise<{ success: boolean; providerName: string }> {
    return (await numaPut('/api/settings/sso', config)) as { success: boolean; providerName: string };
  },

  async enable(numaPost: NumaPost): Promise<{ success: boolean; providerName: string }> {
    return (await numaPost('/api/settings/sso/enable')) as { success: boolean; providerName: string };
  },

  async disable(numaPost: NumaPost): Promise<{ success: boolean }> {
    return (await numaPost('/api/settings/sso/disable')) as { success: boolean };
  },

  async remove(numaDelete: NumaDelete): Promise<{ success: boolean }> {
    return (await numaDelete('/api/settings/sso')) as { success: boolean };
  },

  async getSPMetadata(numaGet: NumaGet): Promise<SPMetadata> {
    return (await numaGet('/api/settings/sso/metadata')) as SPMetadata;
  },

  /** Public endpoint — no auth required. Used by login page. */
  async getLoginConfig(): Promise<SSOLoginConfig> {
    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const resp = await fetch(`${API_ENDPOINT}/settings/sso/login-config`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!resp.ok) return { enabled: false };
    return (await resp.json()) as SSOLoginConfig;
  },

  // --- Group Mapping ---

  async getGroupMapping(numaGet: NumaGet): Promise<GroupMappingConfig> {
    return (await numaGet('/api/settings/sso/group-mapping')) as GroupMappingConfig;
  },

  async saveGroupMapping(config: GroupMappingConfig, numaPut: NumaPut): Promise<{ success: boolean }> {
    return (await numaPut('/api/settings/sso/group-mapping', config)) as { success: boolean };
  },

  // --- SSO User Management ---

  async listUsers(numaGet: NumaGet): Promise<{ users: SSOUser[] }> {
    return (await numaGet('/api/settings/sso/users')) as { users: SSOUser[] };
  },

  async unlinkUser(sub: string, numaPost: NumaPost): Promise<{ success: boolean }> {
    return (await numaPost(`/api/settings/sso/users/${sub}/unlink`)) as { success: boolean };
  },

  // --- SCIM ---

  async getScimConfig(numaGet: NumaGet): Promise<{
    configured: boolean;
    scimEndpoint: string;
    clientName: string;
    tokenCreatedAt: string | null;
    tokenRevoked: boolean;
  }> {
    return (await numaGet('/api/settings/sso/scim/config')) as {
      configured: boolean;
      scimEndpoint: string;
      clientName: string;
      tokenCreatedAt: string | null;
      tokenRevoked: boolean;
    };
  },

  async generateScimToken(numaPost: NumaPost): Promise<{ success: boolean; token: string; warning: string }> {
    return (await numaPost('/api/settings/sso/scim/generate-token')) as {
      success: boolean;
      token: string;
      warning: string;
    };
  },

  async revokeScimToken(numaDelete: NumaDelete): Promise<{ success: boolean }> {
    return (await numaDelete('/api/settings/sso/scim/token')) as { success: boolean };
  },

  /** Exchange SSO authorization code for tokens via server-side proxy. */
  async exchangeToken(
    code: string,
    redirectUri: string
  ): Promise<{
    access_token: string;
    id_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
  }> {
    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const resp = await fetch(`${API_ENDPOINT}/auth/sso/token-exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri }),
    });
    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      throw new Error((errorData as { error?: string }).error || 'Token exchange failed');
    }
    return resp.json();
  },
};
