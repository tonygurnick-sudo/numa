import { getAllConnections } from '../config/integrationsConfig';
import i18n from '../i18n';
import { getSwrCache, setSwrCache } from '../utils/swrCache';

export type IntegrationStatus = 'enabled' | 'disabled';
export type IntegrationMethod = 'native' | 'pipedream';

export interface GlobalIntegrationSetting {
  integration: string;
  status: IntegrationStatus;
  denyTools: string[];
  preferred_method?: IntegrationMethod | null;
}

export type GlobalIntegrationSettingValue = {
  status: IntegrationStatus;
  denyTools: string[];
  preferred_method: IntegrationMethod | null;
};

export type GlobalIntegrationSettingsMap = Record<string, GlobalIntegrationSettingValue>;

/** A canonical service entry returned by the catalog endpoint. */
export interface CatalogEntry {
  slug: string;
  pipedreamSlug: string | null;
  connectorSlug: string | null;
  methods: IntegrationMethod[];
  preferred_method: IntegrationMethod | null;
  pipedreamEnabled: boolean | null;
  connectorEnabled: boolean | null;
}

export interface CatalogResponse {
  services: CatalogEntry[];
}

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
  getAllConnections().forEach((c) => (map[c.id] = { status: 'disabled', denyTools: [], preferred_method: null }));
  for (const item of items) {
    map[item.integration] = {
      status: item.status,
      denyTools: item.denyTools || [],
      preferred_method: item.preferred_method ?? null,
    };
  }
  return map;
}

const ADMIN_INTEGRATIONS_SWR_KEY = 'adminIntegrations';
const INTEGRATIONS_CATALOG_SWR_KEY = 'integrationsCatalog';

export const AdminIntegrationsService = {
  /** Read cached admin integration settings from localStorage (instant, synchronous). */
  getCached(): GlobalIntegrationSettingsMap | null {
    return getSwrCache<GlobalIntegrationSettingsMap>(ADMIN_INTEGRATIONS_SWR_KEY);
  },

  /** Read cached unified catalog from localStorage. */
  getCachedCatalog(): CatalogEntry[] | null {
    return getSwrCache<CatalogEntry[]>(INTEGRATIONS_CATALOG_SWR_KEY);
  },

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
      const result = toMap(items || []);
      setSwrCache(ADMIN_INTEGRATIONS_SWR_KEY, result);
      return result;
    } catch {
      return toMap([]);
    }
  },

  async listWithNuma(
    numaGet: (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>
  ): Promise<GlobalIntegrationSettingsMap> {
    const items = (await numaGet('/api/settings/integrations')) as GlobalIntegrationSetting[];
    const result = toMap(items || []);
    setSwrCache(ADMIN_INTEGRATIONS_SWR_KEY, result);
    return result;
  },

  /** Fetch the unified Pipedream + native catalog. Throws on network/auth errors. */
  async catalogWithNuma(
    numaGet: (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>
  ): Promise<CatalogEntry[]> {
    const res = (await numaGet('/api/settings/integrations/catalog')) as CatalogResponse;
    const services = res?.services ?? [];
    setSwrCache(INTEGRATIONS_CATALOG_SWR_KEY, services);
    return services;
  },

  async update(
    integration: string,
    payload: { status: IntegrationStatus; denyTools: string[]; preferred_method?: IntegrationMethod | null },
    getAccessToken?: () => Promise<string | null>
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

  async updateWithNuma(
    integration: string,
    payload: { status: IntegrationStatus; denyTools: string[]; preferred_method?: IntegrationMethod | null },
    numaPut: (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>
  ): Promise<void> {
    await numaPut(`/api/settings/integrations/${encodeURIComponent(integration)}`, payload);
  },
};
