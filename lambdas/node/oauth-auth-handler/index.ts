/**
 * OAuth Authorization Handler — Secure OAuth flows for cloud storage providers
 *
 * Provider-agnostic: OAuth configuration is read dynamically from COMPANY vault
 * secrets (category: "OAuth Clients"). Adding a new provider requires zero code
 * changes — just create a COMPANY vault secret with the required fields.
 *
 * Routes:
 *   GET /oauth/providers               - List all configured OAuth providers
 *   GET /oauth/{provider}/authorize    - Initiate OAuth flow with PKCE
 *   GET /oauth/{provider}/callback     - Handle provider callback and token exchange
 *   POST /oauth/{provider}/refresh     - Refresh expired access tokens
 *   POST /oauth/{provider}/revoke      - Revoke tokens and cleanup
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  CreateSecretCommand,
  DeleteSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import { randomBytes, createHash } from 'crypto';
import { withPRM } from '../../../lib/prm-node/prm';

// ---------------------------------------------------------------------------
// Types and Configuration
// ---------------------------------------------------------------------------

type OAuthProvider = string;
type AuthContext = { sub: string; email?: string; name?: string; groups: string[] };
type VaultEntry = Record<string, any>;
type VaultSecrets = Record<string, VaultEntry>;
interface VaultData {
  secrets: VaultSecrets;
  metadata: Record<string, unknown>;
  _compressed?: boolean;
  _data?: string;
}

interface FullProviderConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string;
  extraAuthParams?: Record<string, string>;
  displayName?: string;
  icon?: string;
  description?: string;
  rawFields?: Record<string, unknown>;
}

interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

interface VaultOAuthSecret {
  provider: string;
  access_token: string;
  refresh_token?: string;
  expires_at: string;
  user_email?: string;
  scope: string;
  connected_at: string;
}

interface PKCESession {
  code_verifier: string;
  code_challenge: string;
  state: string;
  provider: OAuthProvider;
  connector?: string; // Original connector ID for per-connector token storage
  user_sub: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const secretsManager = withPRM(SecretsManagerClient, {});
// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const CLIENT_NAME = process.env.CLIENT_NAME || 'demo';
const VAULT_SECRETS_PREFIX = process.env.VAULT_SECRETS_PREFIX || `${CLIENT_NAME}/vault`;
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'https://localhost:3000';

// ---------------------------------------------------------------------------
// OAuth platform mapping — connectors sharing a single OAuth client
// ---------------------------------------------------------------------------

const OAUTH_PLATFORM_MAP: Record<string, string> = {
  gmail: 'google',
  googledrive: 'google',
  onedrive: 'microsoft',
};

// ---------------------------------------------------------------------------
// Hardcoded fallbacks for backward compatibility during migration
// ---------------------------------------------------------------------------

const FALLBACK_OAUTH_CONFIGS: Record<string, Omit<FullProviderConfig, 'clientId' | 'clientSecret'>> = {
  googledrive: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: 'https://www.googleapis.com/auth/drive.readonly',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    displayName: 'Google Drive',
    icon: 'bi-google',
    description: 'Access and browse Google Drive files',
  },
  onedrive: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: 'https://graph.microsoft.com/Files.Read.All offline_access',
    extraAuthParams: { response_mode: 'query' },
    displayName: 'OneDrive',
    icon: 'bi-microsoft',
    description: 'Access and browse Microsoft OneDrive files',
  },
  dropbox: {
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scopes: 'files.metadata.read files.content.read',
    extraAuthParams: { token_access_type: 'offline' },
    displayName: 'Dropbox',
    icon: 'bi-dropbox',
    description: 'Access and browse Dropbox files',
  },
};

// ---------------------------------------------------------------------------
// COMPANY Vault Provider Config Cache (5 min TTL)
// ---------------------------------------------------------------------------

interface CachedProviderConfig {
  config: FullProviderConfig;
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const providerConfigCache = new Map<string, CachedProviderConfig>();

// Cache for the full consolidated vault (avoids re-fetching for every provider)
interface CachedConsolidatedVault {
  secrets: VaultSecrets;
  fetchedAt: number;
}

let consolidatedVaultCache: CachedConsolidatedVault | null = null;

/**
 * Read the consolidated COMPANY vault from Secrets Manager.
 * The vault stores all company secrets in a single SM secret at {CLIENT_NAME}/vault/company.
 * Handles optional gzip compression for large vaults.
 */
const getConsolidatedVault = async (): Promise<VaultSecrets | null> => {
  // Check cache
  if (consolidatedVaultCache && Date.now() - consolidatedVaultCache.fetchedAt < CACHE_TTL_MS) {
    return consolidatedVaultCache.secrets;
  }

  const vaultSecretName = `${CLIENT_NAME}/vault/company`;

  try {
    const smResult = await secretsManager.send(new GetSecretValueCommand({ SecretId: vaultSecretName }));
    if (!smResult.SecretString) {
      console.warn(`Consolidated vault at ${vaultSecretName} has no content`);
      return null;
    }

    // Parse and handle potential gzip compression
    let vaultData = JSON.parse(smResult.SecretString) as VaultData;

    if (vaultData._compressed && vaultData._data) {
      // Decompress: base64 decode → gzip decompress → JSON parse
      const compressedBytes = Buffer.from(vaultData._data, 'base64');
      const { gunzipSync } = await import('zlib');
      const decompressed = gunzipSync(compressedBytes).toString('utf-8');
      vaultData = JSON.parse(decompressed) as VaultData;
    }

    const secrets = (vaultData.secrets || {}) as VaultSecrets;
    consolidatedVaultCache = { secrets, fetchedAt: Date.now() };
    return secrets;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ResourceNotFoundException') {
      console.warn(`Consolidated vault not found at ${vaultSecretName}`);
    } else {
      console.error(`Failed to read consolidated vault at ${vaultSecretName}:`, error);
    }
    return null;
  }
};

/**
 * Read the full OAuth provider configuration from COMPANY vault.
 * Reads from consolidated Secrets Manager vault at {CLIENT_NAME}/vault/company,
 * then looks up secrets["oauth-client-{provider}"].fields for credentials.
 * Falls back to hardcoded configs if vault secret lacks auth_url/token_url.
 */
const getProviderConfig = async (provider: OAuthProvider): Promise<FullProviderConfig | null> => {
  // 1. Check in-memory cache
  const cached = providerConfigCache.get(provider);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.config;
  }

  try {
    // 2. Read from consolidated vault in Secrets Manager
    const secrets = await getConsolidatedVault();
    if (!secrets) {
      console.warn('Could not read consolidated vault — cannot resolve COMPANY credentials');
      return null;
    }

    const platform = OAUTH_PLATFORM_MAP[provider] ?? provider;
    const oauthSecretName = `oauth-client-${platform}`;
    const connectorSecretName = `connector-${provider}`;
    let secretEntry: VaultEntry | undefined = secrets[oauthSecretName] || secrets[connectorSecretName];

    // If not found in cached vault, bust cache and retry (secret may have just been created)
    if (!secretEntry && consolidatedVaultCache) {
      consolidatedVaultCache = null;
      const freshSecrets = await getConsolidatedVault();
      secretEntry = freshSecrets?.[oauthSecretName] || freshSecrets?.[connectorSecretName];
    }

    if (!secretEntry) {
      console.warn(
        `No COMPANY vault secret found for ${provider} (looked for "${oauthSecretName}" and "${connectorSecretName}")`
      );
      return null;
    }

    // 3. Extract credentials from the secret entry's fields
    const fields = secretEntry.fields || secretEntry;
    const clientId = fields.client_id || '';
    const clientSecret = fields.client_secret || '';
    const instanceUrl = fields.instance_url || '';

    // OAuth connectors need client_id; token connectors need instance_url
    if (!clientId && !instanceUrl) {
      console.warn(`COMPANY vault secret for ${provider} missing both client_id and instance_url`);
      return null;
    }

    // 4. Build config: prefer vault fields, fall back to hardcoded for backward compat
    const fallback = FALLBACK_OAUTH_CONFIGS[provider];
    const authUrl = fields.auth_url || fallback?.authUrl;
    const tokenUrl = fields.token_url || fallback?.tokenUrl;
    const scopes = fields.scopes || fallback?.scopes || '';

    // OAuth connectors need auth_url + token_url; token connectors (with instance_url) don't
    if (!instanceUrl && (!authUrl || !tokenUrl)) {
      console.warn(`COMPANY vault secret for ${provider} missing auth_url or token_url and no fallback available`);
      return null;
    }

    let extraAuthParams: Record<string, string> | undefined;
    if (fields.extra_auth_params) {
      try {
        extraAuthParams =
          typeof fields.extra_auth_params === 'string'
            ? (JSON.parse(fields.extra_auth_params) as Record<string, string>)
            : (fields.extra_auth_params as Record<string, string>);
      } catch {
        console.warn(`Invalid extra_auth_params JSON for ${provider}`);
      }
    } else if (fallback?.extraAuthParams) {
      extraAuthParams = fallback.extraAuthParams;
    }

    const config: FullProviderConfig = {
      clientId,
      clientSecret,
      authUrl,
      tokenUrl,
      scopes,
      extraAuthParams,
      displayName: fields.display_name || fallback?.displayName,
      icon: fields.icon || fallback?.icon,
      description: fields.description || fallback?.description,
      rawFields: fields,
    };

    providerConfigCache.set(provider, { config, fetchedAt: Date.now() });
    return config;
  } catch (error) {
    console.error(`Failed to read COMPANY config for ${provider}:`, error);
    return null;
  }
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEADERS = {
  'Access-Control-Allow-Origin': FRONTEND_BASE_URL,
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const jsonResponse = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(payload),
});

const errorResponse = (statusCode: number, message: string) => jsonResponse(statusCode, { error: message });

const parseJwt = (token: string): Record<string, unknown> => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const resolveAuthContext = (event: APIGatewayProxyEventV2): AuthContext | null => {
  // Prefer API Gateway authorizer claims (verified by the authorizer) over self-decoded JWT
  const authorizerClaims = (event.requestContext as unknown as Record<string, unknown>)?.authorizer as
    | { jwt?: { claims?: Record<string, unknown> } }
    | undefined;
  const claims = authorizerClaims?.jwt?.claims;

  if (claims && typeof claims.sub === 'string') {
    const sub = claims.sub;
    const groups = Array.isArray(claims['cognito:groups'])
      ? (claims['cognito:groups'] as unknown[]).filter((g): g is string => typeof g === 'string')
      : typeof claims['cognito:groups'] === 'string'
        ? (claims['cognito:groups'] as string)
            .split(',')
            .map((g: string) => g.trim())
            .filter(Boolean)
        : [];
    return {
      sub,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      name: typeof claims.name === 'string' ? claims.name : undefined,
      groups,
    };
  }

  // Fallback: self-decode the JWT (not verified — use only when authorizer claims are unavailable)
  console.warn(
    'WARNING: API Gateway authorizer claims not found, falling back to self-decoded JWT. This path does not verify the token signature.'
  );
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader) return null;
  const token = String(authHeader).replace(/^Bearer\s+/i, '');
  const payload = parseJwt(token);
  const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
  if (!sub) return null;
  const groups = Array.isArray(payload['cognito:groups'])
    ? (payload['cognito:groups'] as unknown[]).filter((g): g is string => typeof g === 'string')
    : [];
  return {
    sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    groups,
  };
};

// ---------------------------------------------------------------------------
// PKCE Helpers
// ---------------------------------------------------------------------------

const generatePKCE = () => {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
};

const generateState = () => randomBytes(16).toString('base64url');

// ---------------------------------------------------------------------------
// User Consolidated Vault — one SM secret per user at {CLIENT_NAME}/vault/users/{sub}
// ---------------------------------------------------------------------------

/**
 * Get user-friendly secret name for OAuth provider.
 * Maps provider IDs to clean, consistent names visible to users.
 */
const getUserFriendlySecretName = (provider: string): string => {
  const mapping: Record<string, string> = {
    googledrive: 'GoogleDrive',
    onedrive: 'OneDrive',
    dropbox: 'Dropbox',
  };
  return mapping[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
};

/**
 * Read a user's consolidated vault from Secrets Manager.
 * Each user has one secret at {CLIENT_NAME}/vault/users/{userSub}.
 * Handles gzip compression for large vaults.
 */
const getUserConsolidatedVault = async (userSub: string): Promise<VaultData> => {
  const vaultSecretName = `${CLIENT_NAME}/vault/users/${userSub}`;

  try {
    const smResult = await secretsManager.send(new GetSecretValueCommand({ SecretId: vaultSecretName }));
    if (!smResult.SecretString) return createEmptyVault();

    let vaultData = JSON.parse(smResult.SecretString) as VaultData;

    // Handle gzip compression
    if (vaultData._compressed && vaultData._data) {
      const compressedBytes = Buffer.from(vaultData._data, 'base64');
      const { gunzipSync } = await import('zlib');
      const decompressed = gunzipSync(compressedBytes).toString('utf-8');
      vaultData = JSON.parse(decompressed) as VaultData;
    }

    return vaultData;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ResourceNotFoundException') {
      return createEmptyVault();
    }
    console.error(`Failed to read user vault for ${userSub}:`, error);
    return createEmptyVault();
  }
};

/** Create empty vault structure matching consolidated_storage.py format. */
const createEmptyVault = (): VaultData => {
  const now = new Date().toISOString();
  return {
    secrets: {},
    metadata: {
      version: '2.0',
      created_at: now,
      updated_at: now,
      secret_count: 0,
    },
  };
};

/**
 * Write a user's consolidated vault back to Secrets Manager.
 * Creates the secret if it doesn't exist yet.
 */
const putUserConsolidatedVault = async (userSub: string, vaultData: VaultData): Promise<boolean> => {
  const vaultSecretName = `${CLIENT_NAME}/vault/users/${userSub}`;
  const jsonStr = JSON.stringify(vaultData);

  try {
    try {
      await secretsManager.send(new PutSecretValueCommand({ SecretId: vaultSecretName, SecretString: jsonStr }));
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ResourceNotFoundException') {
        await secretsManager.send(
          new CreateSecretCommand({
            Name: vaultSecretName,
            SecretString: jsonStr,
            Description: `Consolidated vault for user ${userSub}`,
          })
        );
      } else {
        throw error;
      }
    }
    return true;
  } catch (error) {
    console.error(`Failed to write user vault for ${userSub}:`, error);
    return false;
  }
};

/**
 * Store OAuth tokens in user's consolidated vault.
 * Adds/updates an entry under secrets["oauth-{provider}"] in the user's single SM secret.
 */
const putUserOAuthSecret = async (userSub: string, provider: string, secret: VaultOAuthSecret): Promise<boolean> => {
  const friendlyName = getUserFriendlySecretName(provider);
  const secretKey = `oauth-${provider}`;

  try {
    const vault = await getUserConsolidatedVault(userSub);
    const secrets = (vault.secrets || {}) as VaultSecrets;

    const now = new Date().toISOString();
    const existing = secrets[secretKey];

    secrets[secretKey] = {
      id: existing?.id || randomBytes(16).toString('hex'),
      name: friendlyName,
      fields: {
        provider: secret.provider,
        access_token: secret.access_token,
        refresh_token: secret.refresh_token || '',
        expires_at: secret.expires_at,
        user_email: secret.user_email || '',
        scope: secret.scope,
        connected_at: secret.connected_at,
      },
      metadata: {
        category: 'OAuth Tokens',
        type: 'oauth_tokens',
        description: `Connected ${friendlyName} account`,
        created_at: existing?.metadata?.created_at || now,
        updated_at: now,
      },
    };

    vault.secrets = secrets;
    vault.metadata = {
      ...vault.metadata,
      updated_at: now,
      secret_count: Object.keys(secrets).length,
    };

    const stored = await putUserConsolidatedVault(userSub, vault);
    if (stored) {
      console.log(
        `Stored OAuth tokens for user ${userSub}, provider ${provider} as "${friendlyName}" in consolidated vault`
      );
    }
    return stored;
  } catch (error) {
    console.error(`Failed to store OAuth tokens for user ${userSub}, provider ${provider}:`, error);
    return false;
  }
};

/**
 * Get OAuth secret from user's consolidated vault.
 */
const getUserOAuthSecret = async (userSub: string, provider: string): Promise<VaultOAuthSecret | null> => {
  const secretKey = `oauth-${provider}`;

  try {
    const vault = await getUserConsolidatedVault(userSub);
    const secrets = (vault.secrets || {}) as VaultSecrets;
    const entry = secrets[secretKey];

    if (!entry?.fields?.access_token) {
      console.warn(`No OAuth token found for user ${userSub}, provider ${provider}`);
      return null;
    }

    return {
      provider: entry.fields.provider || provider,
      access_token: entry.fields.access_token,
      refresh_token: entry.fields.refresh_token,
      expires_at: entry.fields.expires_at,
      user_email: entry.fields.user_email,
      scope: entry.fields.scope,
      connected_at: entry.fields.connected_at,
    };
  } catch (error) {
    console.error(`Failed to get OAuth secret for user ${userSub}, provider ${provider}:`, error);
    return null;
  }
};

// ---------------------------------------------------------------------------
// PKCE Session Management (temporary storage)
// ---------------------------------------------------------------------------

const storePKCESession = async (sessionId: string, session: PKCESession): Promise<boolean> => {
  try {
    const command = new CreateSecretCommand({
      Name: `${VAULT_SECRETS_PREFIX}/pkce/${sessionId}`,
      SecretString: JSON.stringify(session),
    });
    await secretsManager.send(command);
    return true;
  } catch (error) {
    console.error(`Failed to store PKCE session ${sessionId}:`, error);
    return false;
  }
};

const getPKCESession = async (sessionId: string): Promise<PKCESession | null> => {
  try {
    const command = new GetSecretValueCommand({
      SecretId: `${VAULT_SECRETS_PREFIX}/pkce/${sessionId}`,
    });
    const response = await secretsManager.send(command);
    if (response.SecretString) {
      return JSON.parse(response.SecretString) as PKCESession;
    }
    return null;
  } catch (error) {
    console.warn(`Failed to get PKCE session ${sessionId}:`, error);
    return null;
  }
};

const PKCE_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

const deletePKCESession = async (sessionId: string): Promise<void> => {
  try {
    const command = new DeleteSecretCommand({
      SecretId: `${VAULT_SECRETS_PREFIX}/pkce/${sessionId}`,
      ForceDeleteWithoutRecovery: true,
    });
    await secretsManager.send(command);
  } catch (error) {
    console.warn(`Failed to delete PKCE session ${sessionId}:`, error);
  }
};

// ---------------------------------------------------------------------------
// OAuth Provider API Calls
// ---------------------------------------------------------------------------

const exchangeCodeForTokens = async (
  provider: OAuthProvider,
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<OAuthTokens | null> => {
  const config = await getProviderConfig(provider);
  if (!config) {
    console.error(`Missing configuration for ${provider}`);
    return null;
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  // Some providers (e.g. Dropbox) require client_secret in the token exchange
  if (config.clientSecret) {
    params.set('client_secret', config.clientSecret);
  }

  try {
    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Token exchange failed for ${provider}:`, response.status, errorText);
      return null;
    }

    const tokens = (await response.json()) as OAuthTokens;
    return tokens;
  } catch (error) {
    console.error(`Token exchange request failed for ${provider}:`, error);
    return null;
  }
};

const refreshTokens = async (provider: OAuthProvider, refreshToken: string): Promise<OAuthTokens | null> => {
  const config = await getProviderConfig(provider);
  if (!config) {
    console.error(`Missing configuration for ${provider}`);
    return null;
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: refreshToken,
  });

  try {
    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Token refresh failed for ${provider}:`, response.status, errorText);
      return null;
    }

    const tokens = (await response.json()) as OAuthTokens;
    return tokens;
  } catch (error) {
    console.error(`Token refresh request failed for ${provider}:`, error);
    return null;
  }
};

// ---------------------------------------------------------------------------
// List Providers Handler
// ---------------------------------------------------------------------------

interface ProvidersListCache {
  providers: Array<{ id: string; display_name: string; icon: string; description: string; configured: boolean }>;
  fetchedAt: number;
}

let providersListCache: ProvidersListCache | null = null;

const handleListProviders = async (bustCache = false) => {
  // Check cache (skip if bust requested)
  if (!bustCache && providersListCache && Date.now() - providersListCache.fetchedAt < CACHE_TTL_MS) {
    return jsonResponse(200, { providers: providersListCache.providers });
  }

  try {
    // Bust vault cache too when refreshing providers
    if (bustCache) {
      consolidatedVaultCache = null;
      providersListCache = null;
    }
    // Read all secrets from consolidated vault and filter for oauth-client-* entries
    const secrets = await getConsolidatedVault();
    if (!secrets) {
      return jsonResponse(200, { providers: [] });
    }

    const providers: Array<{
      id: string;
      display_name: string;
      icon: string;
      description: string;
      configured: boolean;
    }> = [];

    for (const [secretName, secretEntry] of Object.entries(secrets)) {
      if (!secretName.startsWith('oauth-client-') && !secretName.startsWith('connector-')) continue;

      const isOAuth = secretName.startsWith('oauth-client-');
      const providerId = isOAuth ? secretName.replace('oauth-client-', '') : secretName.replace('connector-', '');
      const fields = secretEntry.fields || secretEntry;
      const fallback = FALLBACK_OAUTH_CONFIGS[providerId];

      // OAuth connectors need client_id + client_secret; token connectors need instance_url
      if (isOAuth && (!fields.client_id || !fields.client_secret)) continue;
      if (!isOAuth && !fields.instance_url) continue;

      if (fields.enabled_connectors) {
        // Platform secret with per-connector tracking — expand into individual providers
        const connectorIds = (fields.enabled_connectors as string).split(',').filter(Boolean);
        for (const cid of connectorIds) {
          let meta = { display_name: cid, icon: 'bi-cloud', description: '' };
          try {
            const raw = fields[`connector_${cid}`];
            if (raw) meta = { ...meta, ...(JSON.parse(raw as string) as Record<string, string>) };
          } catch {
            /* use defaults */
          }
          providers.push({
            id: cid,
            display_name: meta.display_name,
            icon: meta.icon,
            description: meta.description,
            configured: true,
          });
        }
      } else {
        // Regular single-connector secret
        providers.push({
          id: providerId,
          display_name: fields.display_name || fallback?.displayName || providerId,
          icon: fields.icon || fallback?.icon || 'bi-cloud',
          description: fields.description || fallback?.description || '',
          configured: true,
        });
      }
    }

    // Cache the result
    providersListCache = { providers, fetchedAt: Date.now() };

    return jsonResponse(200, { providers });
  } catch (error) {
    console.error('Failed to list OAuth providers:', error);
    return errorResponse(500, 'Failed to list OAuth providers');
  }
};

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

const handleAuthorize = async (provider: OAuthProvider, auth: AuthContext, queryParams?: Record<string, string>) => {
  const config = await getProviderConfig(provider);

  if (!config) {
    return errorResponse(500, `OAuth not configured for ${provider}`);
  }

  // Platform connectors pass the original connector ID and connector-specific scopes
  const connector = queryParams?.connector;
  const scopeOverride = queryParams?.scopes;

  // Generate PKCE parameters and state
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = generateState();

  // Sanitize sub for use in Secrets Manager paths
  const safeSub = auth.sub.replace(/[^a-zA-Z0-9_-]/g, '');

  // Store PKCE session temporarily
  const sessionId = `${safeSub}_${provider}_${Date.now()}`;
  const session: PKCESession = {
    code_verifier: codeVerifier,
    code_challenge: codeChallenge,
    state,
    provider,
    connector,
    user_sub: safeSub,
    created_at: new Date().toISOString(),
  };

  const stored = await storePKCESession(sessionId, session);
  if (!stored) {
    return errorResponse(500, 'Failed to initialize OAuth session');
  }

  // Build authorization URL
  const redirectUri = `${FRONTEND_BASE_URL}/oauth/callback/${provider}`;
  const authUrl = new URL(config.authUrl);

  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', config.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  // Use per-connector scopes from vault if available, fall back to top-level
  let effectiveScopes = config.scopes;
  if (connector && config.rawFields) {
    const connectorField = config.rawFields[`connector_${connector}`];
    if (typeof connectorField === 'string') {
      try {
        const connectorMeta = JSON.parse(connectorField);
        if (connectorMeta.scopes) effectiveScopes = connectorMeta.scopes;
      } catch {
        /* use top-level */
      }
    }
  }
  authUrl.searchParams.set('scope', scopeOverride || effectiveScopes);
  authUrl.searchParams.set('state', `${state}:${sessionId}`);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  // Apply dynamic extra auth parameters from vault config
  if (config.extraAuthParams) {
    for (const [key, value] of Object.entries(config.extraAuthParams)) {
      authUrl.searchParams.set(key, value);
    }
  }

  return jsonResponse(200, {
    success: true,
    auth_url: authUrl.toString(),
    session_id: sessionId,
  });
};

const handleCallback = async (provider: OAuthProvider, code: string, state: string) => {
  if (!code || !state) {
    return errorResponse(400, 'Missing authorization code or state');
  }

  // Parse state to get sessionId — split only on the first colon so session IDs
  // containing colons are preserved intact
  const colonIndex = state.indexOf(':');
  if (colonIndex === -1) {
    return errorResponse(400, 'Invalid state parameter');
  }
  const stateValue = state.substring(0, colonIndex);
  const sessionId = state.substring(colonIndex + 1);
  if (!sessionId) {
    return errorResponse(400, 'Invalid state parameter');
  }

  // Retrieve PKCE session
  const session = await getPKCESession(sessionId);
  if (!session) {
    return errorResponse(400, 'OAuth session not found or expired');
  }

  // Check PKCE session TTL — reject sessions older than 10 minutes
  const sessionAge = Date.now() - new Date(session.created_at).getTime();
  if (sessionAge > PKCE_SESSION_TTL_MS) {
    console.warn(
      `PKCE session ${sessionId} expired: age ${Math.round(sessionAge / 1000)}s exceeds ${PKCE_SESSION_TTL_MS / 1000}s limit`
    );
    await deletePKCESession(sessionId);
    return errorResponse(400, 'OAuth session has expired — please start the authorization flow again');
  }

  // Validate state matches
  if (session.state !== stateValue || session.provider !== provider) {
    return errorResponse(400, 'State mismatch or provider mismatch');
  }

  // Exchange code for tokens
  const redirectUri = `${FRONTEND_BASE_URL}/oauth/callback/${provider}`;
  const tokens = await exchangeCodeForTokens(provider, code, session.code_verifier, redirectUri);

  if (!tokens) {
    return errorResponse(500, 'Failed to exchange authorization code for tokens');
  }

  // Delete the PKCE session now that we have exchanged the code — single use only
  await deletePKCESession(sessionId);

  // Get scopes from config for fallback
  const config = await getProviderConfig(provider);

  // Store tokens under the original connector ID (e.g. 'gmail') not the platform ('google')
  const tokenProvider = session.connector || provider;
  const safeSub = session.user_sub.replace(/[^a-zA-Z0-9_-]/g, '');
  const vaultSecret: VaultOAuthSecret = {
    provider: tokenProvider,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    scope: tokens.scope || config?.scopes || '',
    connected_at: new Date().toISOString(),
  };

  const stored = await putUserOAuthSecret(safeSub, tokenProvider, vaultSecret);

  if (!stored) {
    return errorResponse(500, 'Failed to store OAuth tokens');
  }

  return jsonResponse(200, {
    success: true,
    message: `Successfully connected ${provider}`,
    provider,
    connected_at: vaultSecret.connected_at,
  });
};

const handleRefresh = async (provider: OAuthProvider, auth: AuthContext) => {
  // Sanitize sub for use in Secrets Manager paths
  const safeSub = auth.sub.replace(/[^a-zA-Z0-9_-]/g, '');

  // Get current tokens from user's vault
  const currentSecret = await getUserOAuthSecret(safeSub, provider);

  if (!currentSecret || !currentSecret.refresh_token) {
    return errorResponse(404, `No refresh token found for ${provider}`);
  }

  // Refresh tokens
  const newTokens = await refreshTokens(provider, currentSecret.refresh_token);
  if (!newTokens) {
    return errorResponse(500, 'Failed to refresh tokens');
  }

  // Update vault with new tokens
  const updatedSecret: VaultOAuthSecret = {
    ...currentSecret,
    access_token: newTokens.access_token,
    refresh_token: newTokens.refresh_token || currentSecret.refresh_token,
    expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
  };

  const stored = await putUserOAuthSecret(safeSub, provider, updatedSecret);
  if (!stored) {
    return errorResponse(500, 'Failed to update OAuth tokens');
  }

  return jsonResponse(200, {
    success: true,
    message: 'Tokens refreshed successfully',
    expires_at: updatedSecret.expires_at,
  });
};

/**
 * Delete OAuth tokens from user's consolidated vault.
 * Removes the oauth-{provider} entry from the user's single SM secret.
 */
const deleteUserOAuthSecret = async (userSub: string, provider: string): Promise<boolean> => {
  const secretKey = `oauth-${provider}`;

  try {
    const vault = await getUserConsolidatedVault(userSub);
    const secrets = (vault.secrets || {}) as VaultSecrets;

    if (!secrets[secretKey]) {
      console.warn(`No OAuth entry to delete for user ${userSub}, provider ${provider}`);
      return true; // Nothing to delete is still success
    }

    delete secrets[secretKey];
    vault.secrets = secrets;
    vault.metadata = {
      ...vault.metadata,
      updated_at: new Date().toISOString(),
      secret_count: Object.keys(secrets).length,
    };

    const stored = await putUserConsolidatedVault(userSub, vault);
    if (stored) {
      console.log(`Deleted OAuth tokens for user ${userSub}, provider ${provider} from consolidated vault`);
    }
    return stored;
  } catch (error) {
    console.error(`Failed to delete OAuth tokens for user ${userSub}, provider ${provider}:`, error);
    return false;
  }
};

const handleRevoke = async (provider: OAuthProvider, auth: AuthContext) => {
  // Sanitize sub for use in Secrets Manager paths
  const safeSub = auth.sub.replace(/[^a-zA-Z0-9_-]/g, '');

  // Delete OAuth tokens from user's vault
  // In production, should also revoke with the OAuth provider
  const deleted = await deleteUserOAuthSecret(safeSub, provider);
  if (!deleted) {
    return errorResponse(500, 'Failed to revoke OAuth tokens');
  }

  return jsonResponse(200, {
    success: true,
    message: `Successfully revoked ${provider} access`,
  });
};

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  console.log(
    'OAuth Auth Handler:',
    JSON.stringify({
      httpMethod: event.requestContext.http.method,
      path: event.rawPath,
      pathParameters: event.pathParameters,
    })
  );

  // CORS preflight
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  try {
    // Extract provider and action from path
    // rawPath includes /api prefix from API Gateway route key (e.g. /api/oauth/providers)
    const allParts = event.rawPath.split('/').filter(Boolean);
    const oauthIndex = allParts.indexOf('oauth');
    if (oauthIndex === -1) {
      return errorResponse(404, 'Invalid OAuth path');
    }
    const pathParts = allParts.slice(oauthIndex);
    if (pathParts.length < 2) {
      return errorResponse(404, 'Invalid OAuth path');
    }

    // Handle /oauth/providers — list all configured providers
    if (pathParts[1] === 'providers' && event.requestContext.http.method === 'GET') {
      const bustCache = event.queryStringParameters?.refresh === '1';
      return await handleListProviders(bustCache);
    }

    if (pathParts.length < 3) {
      return errorResponse(404, 'Invalid OAuth path');
    }

    const provider = pathParts[1] as OAuthProvider;
    const action = pathParts[2];

    // Validate provider dynamically — check if vault config exists
    const providerConfig = await getProviderConfig(provider);
    if (!providerConfig) {
      return errorResponse(400, `OAuth provider "${provider}" is not configured`);
    }

    // Handle callback without authentication (no JWT token available in redirect)
    if (action === 'callback') {
      let code: string;
      let state: string;

      if (event.requestContext.http.method === 'POST' && event.body) {
        // Frontend OAuthCallback page POSTs code/state in JSON body
        const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
        const body = JSON.parse(raw) as Record<string, string>;
        code = body.code || '';
        state = body.state || '';
      } else {
        // Direct OAuth provider redirect — code/state in query params
        code = event.queryStringParameters?.code || '';
        state = event.queryStringParameters?.state || '';
      }

      return await handleCallback(provider, code, state);
    }

    // All other actions require authentication
    const auth = resolveAuthContext(event);
    if (!auth) {
      return errorResponse(401, 'Authentication required');
    }

    switch (action) {
      case 'authorize':
        if (event.requestContext.http.method !== 'GET') {
          return errorResponse(405, 'Method not allowed');
        }
        return await handleAuthorize(
          provider,
          auth,
          (event.queryStringParameters ?? undefined) as Record<string, string> | undefined
        );

      case 'status': {
        if (event.requestContext.http.method !== 'GET') {
          return errorResponse(405, 'Method not allowed');
        }
        const safeSub = auth.sub.replace(/[^a-zA-Z0-9_-]/g, '');
        const secret = await getUserOAuthSecret(safeSub, provider);
        if (secret && secret.access_token) {
          const expiresAt = new Date(secret.expires_at).getTime();
          const isExpired = Date.now() >= expiresAt - 5 * 60 * 1000;
          return jsonResponse(200, {
            status: 'connected',
            user_email: secret.user_email || '',
            connected_at: secret.connected_at || '',
            expires_at: secret.expires_at || '',
            is_expired: isExpired,
          });
        }
        return jsonResponse(200, { status: 'disconnected' });
      }

      case 'refresh':
        if (event.requestContext.http.method !== 'POST') {
          return errorResponse(405, 'Method not allowed');
        }
        return await handleRefresh(provider, auth);

      case 'revoke':
        if (event.requestContext.http.method !== 'POST') {
          return errorResponse(405, 'Method not allowed');
        }
        return await handleRevoke(provider, auth);

      case 'connect-token': {
        if (event.requestContext.http.method !== 'POST') {
          return errorResponse(405, 'Method not allowed');
        }
        // Store a PAT/token directly in the user's consolidated vault
        const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '{}';
        const body = JSON.parse(raw) as Record<string, string>;
        const token = body.token || body.access_token || '';
        if (!token) {
          return errorResponse(400, 'Token is required');
        }
        const safeSub = auth.sub.replace(/[^a-zA-Z0-9_-]/g, '');
        const vaultSecret: VaultOAuthSecret = {
          provider,
          access_token: token,
          expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // PATs don't expire via OAuth
          scope: '',
          connected_at: new Date().toISOString(),
        };
        const stored = await putUserOAuthSecret(safeSub, provider, vaultSecret);
        if (!stored) {
          return errorResponse(500, 'Failed to store token');
        }
        return jsonResponse(200, { success: true, message: `Connected to ${provider}` });
      }

      default:
        return errorResponse(404, 'OAuth action not found');
    }
  } catch (error) {
    console.error('OAuth handler error:', error);
    return errorResponse(500, 'Internal server error');
  }
};
