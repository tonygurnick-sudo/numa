import { getAllConnections } from '../config/integrationsConfig';
import i18n from '../i18n';

export type IntegrationStatus = 'enabled' | 'disabled';

export interface GlobalIntegrationSetting {
  integration: string;
  status: IntegrationStatus;
  denyTools: string[];
}

export type GlobalIntegrationSettingsMap = Record<string, { status: IntegrationStatus; denyTools: string[] }>;

async function getAuthHeader(getAccessToken?: () => Promise<string | null>): Promise<Record<string, string>> {
  try {
    const token = (await getAccessToken?.()) || '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function toMap(items: GlobalIntegrationSetting[]): GlobalIntegrationSettingsMap {
  const map: GlobalIntegrationSettingsMap = {};
  getAllConnections().forEach((c) => (map[c.id] = { status: 'disabled', denyTools: [] }));
  for (const item of items) {
    map[item.integration] = { status: item.status, denyTools: item.denyTools || [] };
  }
  return map;
}

export const AdminIntegrationsService = {
  async list(getAccessToken?: () => Promise<string | null>): Promise<GlobalIntegrationSettingsMap> {
    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(await getAuthHeader(getAccessToken)),
      };
      const res = await fetch(`${API_ENDPOINT}/settings/integrations`, { method: 'GET', headers });
      if (!res.ok) throw new Error(`${res.status}`);
      const items = (await res.json()) as GlobalIntegrationSetting[];
      return toMap(items || []);
    } catch {
      // Fallback: default everything to disabled
      return toMap([]);
    }
  },

  // Preferred: use shared RequestProvider helpers so auth header matches our authorizer
  async listWithNuma(
    numaGet: (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>,
  ): Promise<GlobalIntegrationSettingsMap> {
    const items = (await numaGet('/api/settings/integrations')) as GlobalIntegrationSetting[];
    return toMap(items || []);
  },

  async update(
    integration: string,
    payload: { status: IntegrationStatus; denyTools: string[] },
    getAccessToken?: () => Promise<string | null>,
  ): Promise<void> {
    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const headers = {
      'Content-Type': 'application/json',
      ...(await getAuthHeader(getAccessToken)),
    };
    const res = await fetch(`${API_ENDPOINT}/settings/integrations/${encodeURIComponent(integration)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || i18n.t('errors:adminIntegrations.updateFailed', { integration }));
    }
  },

  // Preferred: use shared RequestProvider helpers so auth header matches our authorizer
  async updateWithNuma(
    integration: string,
    payload: { status: IntegrationStatus; denyTools: string[] },
    numaPut: (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>,
  ): Promise<void> {
    await numaPut(`/api/settings/integrations/${encodeURIComponent(integration)}`, payload);
  },
};
