/**
 * INTERNAL — do not import outside `Services/ConnectorsService.ts`.
 *
 * Per-user auth flow for PAT / API-key / username-password data connectors.
 * Every public method requires a branded `PATConnectorId`. The only way to
 * obtain one is via `classifyConnector` in `connectorIds.ts`, which consults
 * the registry. Runtime `assertPATAtRuntime` is belt-and-braces behind the
 * type-level brand.
 *
 * Routes: /api/pat/*
 * Per-user vault key: connector-{id}   (same key the workspace agent reads)
 * Company vault key:  connector-config-{id}
 */

import type { PATConnectorId } from './connectorIds';
import { assertPATAtRuntime } from './connectorIds';

export interface PATCredentialField {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'url';
  placeholder?: string;
  required?: boolean;
  helpText?: string;
}

export interface PATConnectorInfo {
  id: string;
  display_name: string;
  icon?: string;
  credential_fields: PATCredentialField[];
}

export interface PATConnectionStatus {
  status: 'connected' | 'disconnected';
  connected_at?: string;
  user_email?: string;
}

export class PATApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'PATApiError';
    this.status = status;
  }
}

const LIST_CACHE_TTL_MS = 60_000;
let listCache: { connectors: PATConnectorInfo[]; fetchedAt: number } | null = null;
const statusCache: Record<string, { status: PATConnectionStatus; fetchedAt: number }> = {};
const STATUS_CACHE_TTL_MS = 30_000;

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
    throw new PATApiError(body.error || `Request failed with status ${response.status}`, response.status);
  }
  return response.json();
}

export const PATConnectorService = {
  async listConnectors(refresh = false): Promise<PATConnectorInfo[]> {
    if (!refresh && listCache && Date.now() - listCache.fetchedAt < LIST_CACHE_TTL_MS) {
      return listCache.connectors;
    }
    const response = await fetch(`${getApiEndpoint()}/pat/connectors`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ connectors: PATConnectorInfo[] }>(response);
    const connectors = data.connectors || [];
    listCache = { connectors, fetchedAt: Date.now() };
    return connectors;
  },

  clearListCache(): void {
    listCache = null;
  },

  async getStatus(connectorId: PATConnectorId, refresh = false): Promise<PATConnectionStatus> {
    assertPATAtRuntime(connectorId, 'getStatus');
    if (!refresh) {
      const cached = statusCache[connectorId];
      if (cached && Date.now() - cached.fetchedAt < STATUS_CACHE_TTL_MS) {
        return cached.status;
      }
    }
    const response = await fetch(`${getApiEndpoint()}/pat/${encodeURIComponent(connectorId)}/status`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    const status = await handleResponse<PATConnectionStatus>(response);
    statusCache[connectorId] = { status, fetchedAt: Date.now() };
    return status;
  },

  async saveCredentials(connectorId: PATConnectorId, fields: Record<string, string>): Promise<void> {
    assertPATAtRuntime(connectorId, 'saveCredentials');
    const response = await fetch(`${getApiEndpoint()}/pat/${encodeURIComponent(connectorId)}/credentials`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ fields }),
    });
    await handleResponse<{ success: boolean }>(response);
    delete statusCache[connectorId];
  },

  async revoke(connectorId: PATConnectorId): Promise<void> {
    assertPATAtRuntime(connectorId, 'revoke');
    const response = await fetch(`${getApiEndpoint()}/pat/${encodeURIComponent(connectorId)}/credentials`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    await handleResponse<{ success: boolean }>(response);
    delete statusCache[connectorId];
  },
};
