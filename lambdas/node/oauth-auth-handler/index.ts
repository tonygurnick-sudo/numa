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
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
const ddbDoc = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}), {
  marshallOptions: { removeUndefinedValues: true },
});

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const CLIENT_NAME = process.env.CLIENT_NAME || 'demo';
const VAULT_SECRETS_PREFIX = process.env.VAULT_SECRETS_PREFIX || `${CLIENT_NAME}/vault`;
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'https://localhost:3000';
const DATA_CONNECTORS_TABLE_NAME = process.env.DATA_CONNECTORS_TABLE_NAME || '';
const DATA_CONNECTORS_SETTINGS_TABLE_NAME = process.env.DATA_CONNECTORS_SETTINGS_TABLE_NAME || '';

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

    // OAuth connectors need client_id; legacy token connectors need instance_url.
    // PAT connectors (connector-config-*) are handled by the separate PAT route
    // block (handlePatRequest) and never hit this code path.
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
 * Store a per-user connector credential (PAT, API key, username/password) in
 * the user's consolidated vault under `connector-{provider}`. Accepts arbitrary
 * fields — shape is driven by the connector's `credentialFields` in the frontend
 * registry, not this Lambda.
 */
const putUserConnectorSecret = async (
  userSub: string,
  provider: string,
  fields: Record<string, string>,
  userEmail?: string
): Promise<boolean> => {
  const friendlyName = getUserFriendlySecretName(provider);
  const secretKey = `connector-${provider}`;

  try {
    const vault = await getUserConsolidatedVault(userSub);
    const secrets = (vault.secrets || {}) as VaultSecrets;
    const now = new Date().toISOString();
    const existing = secrets[secretKey];

    secrets[secretKey] = {
      id: existing?.id || randomBytes(16).toString('hex'),
      name: friendlyName,
      fields: {
        ...fields,
        user_email: fields.user_email || userEmail || '',
        connected_at: now,
      },
      metadata: {
        category: 'Connector Credentials',
        type: 'connector_credentials',
        description: `Personal credential for ${friendlyName}`,
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

    return await putUserConsolidatedVault(userSub, vault);
  } catch (error) {
    console.error(`Failed to store connector credential for ${userSub}/${provider}:`, error);
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

/**
 * Look up the per-user PAT/API-key/username-password credential for a non-OAuth
 * connector (e.g. fergus, synergy, simpro). These live under `connector-{provider}`
 * in the consolidated user vault, written by putUserConnectorSecret.
 * Returns the stored fields object, or null if none exists / no non-empty value.
 */
const getUserConnectorSecret = async (userSub: string, provider: string): Promise<Record<string, string> | null> => {
  const secretKey = `connector-${provider}`;
  try {
    const vault = await getUserConsolidatedVault(userSub);
    const secrets = (vault.secrets || {}) as VaultSecrets;
    const entry = secrets[secretKey];
    const fields = entry?.fields;
    if (!fields || typeof fields !== 'object') return null;
    // Ignore bookkeeping fields — require at least one real credential value.
    const meta = new Set(['user_email', 'connected_at']);
    const hasRealValue = Object.entries(fields).some(
      ([k, v]) => !meta.has(k) && typeof v === 'string' && v.trim().length > 0
    );
    if (!hasRealValue) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch (error) {
    console.error(`Failed to get connector secret for user ${userSub}, provider ${provider}:`, error);
    return null;
  }
};

/**
 * Delete a per-user PAT connector credential from the consolidated vault.
 * No-op (returns true) if no such entry exists — idempotent.
 */
const deleteUserConnectorSecret = async (userSub: string, provider: string): Promise<boolean> => {
  const secretKey = `connector-${provider}`;
  try {
    const vault = await getUserConsolidatedVault(userSub);
    const secrets = (vault.secrets || {}) as VaultSecrets;
    if (!secrets[secretKey]) return true;
    delete secrets[secretKey];
    vault.secrets = secrets;
    vault.metadata = {
      ...vault.metadata,
      updated_at: new Date().toISOString(),
      secret_count: Object.keys(secrets).length,
    };
    return await putUserConsolidatedVault(userSub, vault);
  } catch (error) {
    console.error(`Failed to delete connector credential for ${userSub}/${provider}:`, error);
    return false;
  }
};

// ---------------------------------------------------------------------------
// PAT connector metadata (company vault) — admin-registered non-OAuth
// connectors live under `connector-config-{id}`.
// ---------------------------------------------------------------------------

interface PatConnectorSummary {
  id: string;
  display_name: string;
  icon?: string;
  credential_fields: unknown;
}

/**
 * Read the admin-registered PAT connector metadata from the company vault.
 * Accepts both the new `connector-config-{id}` shape and legacy `connector-{id}`
 * admin entries (Synergy etc.), provided the legacy entry doesn't look like
 * an OAuth client (no `client_id`). Returns null if neither exists.
 */
const getPatConnectorConfig = async (connectorId: string): Promise<VaultEntry | null> => {
  try {
    const secrets = await getConsolidatedVault();
    if (!secrets) return null;
    const configEntry = secrets[`connector-config-${connectorId}`];
    if (configEntry) return configEntry;
    const legacyEntry = secrets[`connector-${connectorId}`];
    if (legacyEntry) {
      const fields = (legacyEntry.fields || legacyEntry) as Record<string, unknown>;
      if (!fields.client_id) return legacyEntry;
    }
    return null;
  } catch (error) {
    console.error(`Failed to read PAT connector config for ${connectorId}:`, error);
    return null;
  }
};

/**
 * Enumerate all admin-registered PAT connectors.
 *
 * Reads both the current-format `connector-config-{id}` entries (written by
 * the ApiKeyWizard) and legacy `connector-{id}` entries (pre-split admin
 * setups for Synergy etc.). Legacy entries without an explicit
 * `connector_type` field are only included when their shape matches a PAT
 * connector (has `instance_url` or similar admin metadata — not OAuth
 * client_id/client_secret).
 */
const listPatConnectors = async (): Promise<PatConnectorSummary[]> => {
  try {
    const secrets = await getConsolidatedVault();
    if (!secrets) return [];
    const seen = new Map<string, PatConnectorSummary>();

    const addEntry = (id: string, entry: VaultEntry) => {
      if (seen.has(id)) return;
      const fields = (entry.fields || entry) as Record<string, unknown>;
      let credentialFields: unknown = fields.credential_fields;
      if (typeof credentialFields === 'string') {
        try {
          credentialFields = JSON.parse(credentialFields);
        } catch {
          credentialFields = [];
        }
      }
      seen.set(id, {
        id,
        display_name: String(fields.display_name || fields.name || id),
        icon: fields.icon ? String(fields.icon) : undefined,
        credential_fields: credentialFields ?? [],
      });
    };

    // Preferred: connector-config-* (new PAT admin format).
    for (const [name, entry] of Object.entries(secrets)) {
      if (!name.startsWith('connector-config-')) continue;
      addEntry(name.replace('connector-config-', ''), entry);
    }

    // Legacy: connector-{id} admin entries. Skip platform-OAuth shapes so we
    // don't accidentally list a half-configured oauth secret as a PAT.
    for (const [name, entry] of Object.entries(secrets)) {
      if (!name.startsWith('connector-') || name.startsWith('connector-config-')) continue;
      const id = name.replace('connector-', '');
      if (seen.has(id)) continue;
      const fields = (entry.fields || entry) as Record<string, unknown>;
      // OAuth-looking entries have client_id; PAT-style entries don't.
      if (fields.client_id) continue;
      addEntry(id, entry);
    }

    return Array.from(seen.values());
  } catch (error) {
    console.error('Failed to list PAT connectors:', error);
    return [];
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
// Gmail Watch Registration (post-connect)
// ---------------------------------------------------------------------------

/**
 * Register Gmail push notifications after a user connects Gmail OAuth.
 * Calls users.watch() and stores the connected email + watch expiry on the
 * data-connectors DynamoDB record. Failures are logged but never block the
 * OAuth flow.
 */
/**
 * Returns true when the user has a connected Gmail row in the data-connectors
 * table. This is the email→user_sub mapping the trigger dispatcher requires;
 * the status endpoint uses it so a Gmail connection is only reported
 * "connected" when it is actually triggerable. Fails OPEN (returns true) on a
 * lookup error so a transient DynamoDB blip never flips a working connection to
 * "disconnected" and nags the user to reconnect.
 */
const gmailConnectorRowExists = async (safeSub: string): Promise<boolean> => {
  try {
    const result = await ddbDoc.send(
      new GetCommand({
        TableName: DATA_CONNECTORS_TABLE_NAME,
        Key: { user_id: safeSub, connector_id: 'gmail' },
      })
    );
    return result.Item?.status === 'connected';
  } catch (error) {
    console.warn(`gmailConnectorRowExists lookup failed for ${safeSub} (failing open):`, error);
    return true;
  }
};

const registerGmailWatch = async (accessToken: string, userSub: string): Promise<void> => {
  if (!DATA_CONNECTORS_TABLE_NAME) {
    console.warn('Gmail watch skipped: DATA_CONNECTORS_TABLE_NAME not configured');
    return;
  }

  const safeSub = userSub.replace(/[^a-zA-Z0-9_-]/g, '');

  try {
    // 1. Fetch the user's email from the Gmail profile. This is the key the
    //    trigger dispatcher uses to map an inbound Pub/Sub event
    //    (which only carries `emailAddress`) back to a user — so we need it on
    //    the connector row regardless of whether push-watch registration works.
    let userEmail = '';
    try {
      const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (profileRes.ok) {
        const profile = (await profileRes.json()) as { emailAddress?: string };
        userEmail = profile.emailAddress || '';
      } else {
        console.warn('Failed to fetch Gmail profile:', profileRes.status);
      }
    } catch (err) {
      console.warn('Gmail profile fetch error (non-fatal):', err);
    }

    // 2. ALWAYS write the data-connectors row first. This row is the
    //    email→user_sub mapping the connector-event-dispatcher REQUIRES to
    //    process Gmail triggers (the vault stores the OAuth token but not the
    //    email). It must exist whenever the user has a vault token, so that
    //    "connected" (which the status endpoint derives from the vault) also
    //    means "triggerable". Decoupling it from the watch call below is the
    //    fix for the silent-failure mode where a transient watch error left a
    //    user connected-in-vault but with no connector row → triggers dead.
    //    `connected_at` is set once; `last_history_id` is intentionally left
    //    untouched so we don't reset an existing watermark on reconnect.
    await ddbDoc.send(
      new UpdateCommand({
        TableName: DATA_CONNECTORS_TABLE_NAME,
        Key: { user_id: safeSub, connector_id: 'gmail' },
        UpdateExpression:
          'SET #s = :status, connected_email = :email, connected_at = if_not_exists(connected_at, :now), updated_at = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':status': 'connected',
          ':email': userEmail,
          ':now': new Date().toISOString(),
        },
      })
    );
    console.log(`Gmail connector row written for user ${safeSub} (${userEmail})`);

    // 3. Attempt push-watch registration. A failure here (missing Pub/Sub
    //    topic, Gmail API error, non-Workspace account, etc.) does NOT undo the
    //    connection — the row above stands, and the gmail-watch-manager renewal
    //    job will keep retrying the watch on its schedule because the row is
    //    `status = connected`. We just log loudly so the gap is visible.
    if (!DATA_CONNECTORS_SETTINGS_TABLE_NAME) {
      console.warn('Gmail watch skipped: DATA_CONNECTORS_SETTINGS_TABLE_NAME not configured (connection still saved)');
      return;
    }
    const settingsResult = await ddbDoc.send(
      new GetCommand({
        TableName: DATA_CONNECTORS_SETTINGS_TABLE_NAME,
        Key: { connector: 'google-cloud' },
      })
    );
    const pubsubTopic = settingsResult.Item?.pubsubTopic as string | undefined;
    if (!pubsubTopic) {
      console.warn(
        'Gmail watch skipped: no pubsubTopic in connector settings (run GCP setup wizard) — connection still saved'
      );
      return;
    }

    const watchRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/watch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topicName: pubsubTopic,
        labelIds: ['INBOX'],
      }),
    });

    if (!watchRes.ok) {
      const errorText = await watchRes.text();
      console.error(
        `Gmail watch registration failed (${watchRes.status}) — connection saved, renewal job will retry:`,
        errorText
      );
      return;
    }

    const watchData = (await watchRes.json()) as { historyId?: string; expiration?: string };
    console.log('Gmail watch registered', { historyId: watchData.historyId, expiration: watchData.expiration });

    // 4. Stamp the watch lifetime onto the row now that the watch is live.
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    await ddbDoc.send(
      new UpdateCommand({
        TableName: DATA_CONNECTORS_TABLE_NAME,
        Key: { user_id: safeSub, connector_id: 'gmail' },
        UpdateExpression: 'SET watch_expiry = :expiry, watch_registered_at = :now',
        ExpressionAttributeValues: {
          ':expiry': Date.now() + sevenDaysMs,
          ':now': new Date().toISOString(),
        },
      })
    );
    console.log(`Gmail watch registered for user ${safeSub} (${userEmail})`);
  } catch (error) {
    console.error('Gmail watch registration error (non-fatal):', error);
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
      const isOAuth = secretName.startsWith('oauth-client-');
      // `connector-config-*` is the PAT admin format — NEVER return it here.
      // PAT connectors live on a separate contract under `/api/pat/*`. Returning
      // them via `/oauth/providers` routed PAT traffic into the OAuth status
      // handler (which only knows how to look up `oauth-{provider}` user
      // secrets), causing every PAT connector to render as "Token expired".
      // The frontend now fetches PAT connectors via `/pat/connectors`, so this
      // route is OAuth-only.
      if (secretName.startsWith('connector-config-')) continue;
      const isLegacyConnector = secretName.startsWith('connector-');
      if (!isOAuth && !isLegacyConnector) continue;

      let providerId: string;
      if (isOAuth) providerId = secretName.replace('oauth-client-', '');
      else providerId = secretName.replace('connector-', '');

      const fields = secretEntry.fields || secretEntry;
      const fallback = FALLBACK_OAUTH_CONFIGS[providerId];

      // OAuth connectors need client_id + client_secret, except NetSuite which
      // uses PKCE (public client — no client_secret ever issued).
      // Non-OAuth: metadata-only `connector-config-*` is valid with no creds
      // (per-user PAT/api-key captured in chat). Legacy `connector-{id}` that
      // predates the split still requires `instance_url` (Synergy, Workbench).
      if (isOAuth) {
        if (!fields.client_id) continue;
        if (!fields.client_secret && providerId !== 'netsuite') continue;
      }
      if (isLegacyConnector && !fields.instance_url) continue;

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
  const finalScopes = scopeOverride || effectiveScopes;
  console.log('OAuth authorize', { provider, scopeOverride, effectiveScopes, finalScopes, connector });
  authUrl.searchParams.set('scope', finalScopes);
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

  console.log('OAuth callback tokens', {
    provider,
    scope: tokens.scope,
    hasAccessToken: !!tokens.access_token,
    hasRefreshToken: !!tokens.refresh_token,
  });

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

  // Register Gmail push notifications after successful OAuth connect
  if (tokenProvider === 'gmail') {
    await registerGmailWatch(tokens.access_token, session.user_sub);
  }

  // Fetch user email if we have the right scope
  let userEmail: string | undefined;
  if (tokens.scope?.includes('userinfo.email') || tokens.scope?.includes('cloud-platform')) {
    try {
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (profileRes.ok) {
        const profile = (await profileRes.json()) as { email?: string };
        userEmail = profile.email;
      }
    } catch {
      // Non-critical
    }
  }

  return jsonResponse(200, {
    success: true,
    message: `Successfully connected ${provider}`,
    provider,
    connected_at: vaultSecret.connected_at,
    // Return access token and granted scopes so callers (e.g. GCP setup wizard) can use them
    access_token: tokens.access_token,
    scope: tokens.scope,
    email: userEmail,
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
// PAT Connector Handler
//
// Routes:
//   GET    /api/pat/connectors            — list admin-registered PAT connectors
//   GET    /api/pat/{id}/status           — per-user connection status
//   POST   /api/pat/{id}/credentials      — save per-user PAT credentials
//   DELETE /api/pat/{id}/credentials      — revoke (delete) per-user credentials
//
// No overlap with OAuth. Validator only checks for `connector-config-{id}` in
// the company vault (admin-registered PAT connector). Per-user credentials
// live under `connector-{id}` in the user vault — same key the workspace
// agent (`oauth-workspace-tools/tools/connect_tools.py:_user_connector_token`)
// already reads, so no downstream contract changes.
// ---------------------------------------------------------------------------

const handlePatRequest = async (event: APIGatewayProxyEventV2, pathParts: string[]) => {
  if (pathParts.length < 2) {
    return errorResponse(404, 'Invalid PAT path');
  }

  // GET /api/pat/connectors — list
  if (pathParts[1] === 'connectors' && pathParts.length === 2) {
    if (event.requestContext.http.method !== 'GET') {
      return errorResponse(405, 'Method not allowed');
    }
    const auth = resolveAuthContext(event);
    if (!auth) return errorResponse(401, 'Authentication required');
    const connectors = await listPatConnectors();
    return jsonResponse(200, { connectors });
  }

  if (pathParts.length < 3) {
    return errorResponse(404, 'Invalid PAT path');
  }

  const connectorId = pathParts[1];
  const action = pathParts[2];

  const auth = resolveAuthContext(event);
  if (!auth) return errorResponse(401, 'Authentication required');

  // Validate connector exists (admin-registered) — PAT-only check, no OAuth lookup.
  const config = await getPatConnectorConfig(connectorId);
  if (!config) {
    // Defense in depth: if this id IS a registered OAuth provider, refuse
    // with a clear redirect rather than the generic "not configured" 400.
    // Catches frontend callers that route OAuth traffic through the PAT
    // handler.
    const oauthConfig = await getProviderConfig(connectorId as OAuthProvider);
    if (oauthConfig) {
      return errorResponse(
        404,
        `"${connectorId}" is an OAuth connector. Use /api/oauth/${connectorId}/${action} instead of /api/pat/${connectorId}/${action}.`
      );
    }
    return errorResponse(400, `PAT connector "${connectorId}" is not configured`);
  }

  const safeSub = auth.sub.replace(/[^a-zA-Z0-9_-]/g, '');

  switch (action) {
    case 'status': {
      if (event.requestContext.http.method !== 'GET') {
        return errorResponse(405, 'Method not allowed');
      }
      const fields = await getUserConnectorSecret(safeSub, connectorId);
      if (fields) {
        return jsonResponse(200, {
          status: 'connected',
          connected_at: fields.connected_at || '',
          user_email: fields.user_email || '',
        });
      }
      return jsonResponse(200, { status: 'disconnected' });
    }

    case 'credentials': {
      if (event.requestContext.http.method === 'POST') {
        const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '{}';
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return errorResponse(400, 'Invalid JSON body');
        }
        const fieldsIn = body.fields;
        if (!fieldsIn || typeof fieldsIn !== 'object' || Array.isArray(fieldsIn)) {
          return errorResponse(400, 'Body must include `fields` object');
        }
        const fields: Record<string, string> = {};
        for (const [k, v] of Object.entries(fieldsIn as Record<string, unknown>)) {
          if (typeof v === 'string') fields[k] = v;
        }
        const hasValue = Object.values(fields).some((v) => v.trim().length > 0);
        if (!hasValue) {
          return errorResponse(400, 'At least one credential field is required');
        }
        const stored = await putUserConnectorSecret(safeSub, connectorId, fields, auth.email);
        if (!stored) return errorResponse(500, 'Failed to store credential');
        return jsonResponse(200, { success: true });
      }
      if (event.requestContext.http.method === 'DELETE') {
        const deleted = await deleteUserConnectorSecret(safeSub, connectorId);
        if (!deleted) return errorResponse(500, 'Failed to delete credential');
        return jsonResponse(200, { success: true });
      }
      return errorResponse(405, 'Method not allowed');
    }

    default:
      return errorResponse(404, `Unknown PAT action "${action}"`);
  }
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

    // PAT connector routes: /api/pat/*. Completely separate from OAuth —
    // no shared validator, different vault keys, different actions. See the
    // dedicated handler below.
    const patIndex = allParts.indexOf('pat');
    if (patIndex !== -1) {
      return await handlePatRequest(event, allParts.slice(patIndex));
    }

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
      // Defense in depth: if this id IS a registered PAT connector
      // (`connector-config-{id}`), refuse with a clear redirect rather than
      // the generic "not configured" 400. Catches frontend callers that route
      // PAT traffic through this OAuth handler — the bug class that previously
      // surfaced as "Token expired" for Synergy/Fergus.
      const patConfig = await getPatConnectorConfig(provider);
      if (patConfig) {
        return errorResponse(
          404,
          `"${provider}" is a PAT connector. Use /api/pat/${provider}/${action} instead of /api/oauth/${provider}/${action}.`
        );
      }
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
          // Gmail is special: a valid vault token is necessary but NOT
          // sufficient. Event triggers also need the data-connectors row (the
          // email→user_sub map the dispatcher resolves inbound Pub/Sub events
          // against). If the token exists but the row doesn't — e.g. a
          // disconnect deleted the row while orphaning the vault token — report
          // `disconnected` so the UI prompts a reconnect (which `registerGmailWatch`
          // turns back into a complete, triggerable connection) rather than
          // claiming "connected" for a connection that can't actually fire.
          if (provider === 'gmail' && DATA_CONNECTORS_TABLE_NAME) {
            const hasRow = await gmailConnectorRowExists(safeSub);
            if (!hasRow) {
              console.warn(
                `Gmail status: vault token present but no connector row for ${safeSub} — reporting disconnected`
              );
              return jsonResponse(200, { status: 'disconnected', reason: 'missing_connector_row' });
            }
          }
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

      // connect-token removed — PAT flows moved to /api/pat/{id}/credentials
      // (see handlePatRequest). OAuth uses authorize+callback, never this path.

      default:
        return errorResponse(404, 'OAuth action not found');
    }
  } catch (error) {
    console.error('OAuth handler error:', error);
    return errorResponse(500, 'Internal server error');
  }
};
