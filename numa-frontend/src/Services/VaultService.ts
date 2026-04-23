/**
 * VaultService — API client for the vault-secrets Lambda.
 *
 * Handles CRUD operations for user secrets, categories, and audit log.
 */

export const STANDARD_SECRET_TYPES = ['login', 'api_key', 'bearer_token', 'secure_note', 'custom'] as const;
export type StandardSecretType = (typeof STANDARD_SECRET_TYPES)[number];

export interface VaultSecretMetadata {
  id: string;
  name: string;
  display_name: string;
  type: StandardSecretType | null;
  template: string | null;
  category: string;
  description: string;
  danger_mode: boolean;
  favorite: boolean;
  help_url?: string;
  created_at: string;
  updated_at: string;
  last_accessed_at: string;
  // Explicit provenance marker — set to 'system' by backend flows (OAuth, etc)
  // that produce machine-managed secrets. Preferred over the null-type heuristic.
  source?: 'user' | 'system';
}

export function isGeneratedSecret(secret: VaultSecretMetadata | VaultSecretWithFields): boolean {
  if (secret.source === 'system') return true;
  if (secret.source === 'user') return false;
  return !secret.type || !(STANDARD_SECRET_TYPES as readonly string[]).includes(secret.type);
}

export interface VaultSecretWithFields extends VaultSecretMetadata {
  fields: Record<string, string>;
}

export interface VaultAuditLogEntry {
  user_id: string;
  timestamp_audit_id: string;
  secret_id: string;
  secret_name: string;
  action: string;
  accessor: string;
  purpose: string;
  conversation_id: string;
  approved_by: string;
  created_at: string;
}

export interface CreateSecretPayload {
  name: string;
  type: StandardSecretType;
  fields: Record<string, string>;
  category?: string;
  description?: string;
  danger_mode?: boolean;
  favorite?: boolean;
  help_url?: string;
}

export interface UpdateSecretPayload {
  name?: string;
  type?: string;
  fields?: Record<string, string>;
  category?: string;
  description?: string;
  danger_mode?: boolean;
  favorite?: boolean;
  help_url?: string;
}

function getApiEndpoint(): string {
  return sessionStorage.getItem('API_ENDPOINT') || '/api';
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('accessToken') || '';
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

export async function listSecrets(): Promise<VaultSecretMetadata[]> {
  const endpoint = getApiEndpoint();
  const response = await fetch(`${endpoint}/vault/secrets`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await handleResponse<{ secrets: VaultSecretMetadata[] }>(response);
  return data.secrets;
}

export async function getSecret(secretName: string): Promise<VaultSecretWithFields> {
  const endpoint = getApiEndpoint();
  const response = await fetch(`${endpoint}/vault/secrets/${secretName}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await handleResponse<{ secret: VaultSecretWithFields }>(response);
  return data.secret;
}

export async function createSecret(payload: CreateSecretPayload): Promise<VaultSecretMetadata> {
  const endpoint = getApiEndpoint();
  const response = await fetch(`${endpoint}/vault/secrets`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await handleResponse<{ secret: VaultSecretMetadata }>(response);
  return data.secret;
}

export async function updateSecret(secretName: string, payload: UpdateSecretPayload): Promise<VaultSecretMetadata> {
  const endpoint = getApiEndpoint();
  const response = await fetch(`${endpoint}/vault/secrets/${secretName}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await handleResponse<{ secret: VaultSecretMetadata }>(response);
  return data.secret;
}

export async function deleteSecret(secretName: string): Promise<void> {
  const endpoint = getApiEndpoint();
  const response = await fetch(`${endpoint}/vault/secrets/${secretName}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  await handleResponse<{ success: boolean }>(response);
}

export async function listCategories(): Promise<string[]> {
  const endpoint = getApiEndpoint();
  const response = await fetch(`${endpoint}/vault/categories`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await handleResponse<{ categories: string[] }>(response);
  return data.categories;
}

export async function listAuditLog(): Promise<VaultAuditLogEntry[]> {
  const endpoint = getApiEndpoint();
  const response = await fetch(`${endpoint}/vault/audit-log`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await handleResponse<{ items: VaultAuditLogEntry[]; entries: VaultAuditLogEntry[] }>(response);
  return data.items || data.entries;
}

// ---------------------------------------------------------------------------
// Company secrets (shared application-level secrets, user_id = COMPANY)
// ---------------------------------------------------------------------------

export async function listCompanySecrets(): Promise<VaultSecretMetadata[]> {
  const endpoint = getApiEndpoint();
  const response = await fetch(`${endpoint}/vault/company-secrets`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await handleResponse<{ secrets: VaultSecretMetadata[] }>(response);
  return data.secrets;
}

export async function getCompanySecret(secretName: string): Promise<VaultSecretWithFields> {
  const endpoint = getApiEndpoint();
  const response = await fetch(`${endpoint}/vault/company-secrets/${secretName}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await handleResponse<{ secret: VaultSecretWithFields }>(response);
  return data.secret;
}

export async function createCompanySecret(payload: CreateSecretPayload): Promise<VaultSecretMetadata> {
  const endpoint = getApiEndpoint();
  const response = await fetch(`${endpoint}/vault/company-secrets`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await handleResponse<{ secret: VaultSecretMetadata }>(response);
  return data.secret;
}

export async function updateCompanySecret(
  secretName: string,
  payload: UpdateSecretPayload
): Promise<VaultSecretMetadata> {
  const endpoint = getApiEndpoint();
  const response = await fetch(`${endpoint}/vault/company-secrets/${secretName}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await handleResponse<{ secret: VaultSecretMetadata }>(response);
  return data.secret;
}

export async function deleteCompanySecret(secretName: string): Promise<void> {
  const endpoint = getApiEndpoint();
  const response = await fetch(`${endpoint}/vault/company-secrets/${secretName}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  await handleResponse<{ success: boolean }>(response);
}

export async function recordCompanySecretStepUp(): Promise<void> {
  const endpoint = getApiEndpoint();
  const response = await fetch(`${endpoint}/vault/company-secrets/step-up`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  await handleResponse<{ ok: boolean }>(response);
}

export async function recordCompanySecretStepUpFailure(): Promise<void> {
  const endpoint = getApiEndpoint();
  try {
    await fetch(`${endpoint}/vault/company-secrets/step-up-failed`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  } catch {
    // Best-effort: never let audit-recording failures mask the original error
  }
}
