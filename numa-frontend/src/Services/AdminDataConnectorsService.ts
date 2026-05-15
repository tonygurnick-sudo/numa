export type DataConnectorStatus = 'enabled' | 'disabled';

export interface GlobalDataConnectorSetting {
  connector: string;
  status: DataConnectorStatus;
  devOnly?: boolean;
  requiresDeploy?: boolean;
}

export type GlobalDataConnectorSettingsMap = Record<
  string,
  {
    status: DataConnectorStatus;
    devOnly?: boolean;
    requiresDeploy?: boolean;
  }
>;

export interface DataConnectorAdminSettings {
  /** Per-slug admin toggles (status / devOnly / requiresDeploy). */
  settings: GlobalDataConnectorSettingsMap;
  /** Set of connector slugs whose per-slug API docs are present in the client's
   *  ext-api-doc S3 bucket. A connector with `requiresApiDocs: true` in the
   *  registry should be rendered as unavailable if its slug is not in this set. */
  apiDocsAvailableSlugs: Set<string>;
}

function toMap(items: GlobalDataConnectorSetting[]): GlobalDataConnectorSettingsMap {
  // Default all capabilities to enabled — the deployment flag is the primary gate.
  // If a capability has never been toggled by an admin, it's treated as enabled.
  const map: GlobalDataConnectorSettingsMap = {};
  for (const item of items) {
    map[item.connector] = {
      status: item.status,
      ...(item.devOnly !== undefined && { devOnly: item.devOnly }),
      ...(item.requiresDeploy !== undefined && { requiresDeploy: item.requiresDeploy }),
    };
  }
  return map;
}

// The GET endpoint returns `{ items, apiDocsAvailableSlugs }`. Older
// deployments may still return a bare array — accept both shapes so a
// frontend deploy that lands before the backend update doesn't crash.
function parseResponse(raw: unknown): DataConnectorAdminSettings {
  if (Array.isArray(raw)) {
    return { settings: toMap(raw as GlobalDataConnectorSetting[]), apiDocsAvailableSlugs: new Set() };
  }
  const obj = (raw || {}) as { items?: GlobalDataConnectorSetting[]; apiDocsAvailableSlugs?: string[] };
  return {
    settings: toMap(obj.items || []),
    apiDocsAvailableSlugs: new Set(obj.apiDocsAvailableSlugs || []),
  };
}

export const AdminDataConnectorsService = {
  async listWithNuma(
    numaGet: (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>
  ): Promise<DataConnectorAdminSettings> {
    const raw = await numaGet('/api/settings/data-connectors');
    return parseResponse(raw);
  },

  async updateWithNuma(
    connector: string,
    payload: { status: DataConnectorStatus; devOnly?: boolean; requiresDeploy?: boolean },
    numaPut: (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>
  ): Promise<void> {
    await numaPut(`/api/settings/data-connectors/${encodeURIComponent(connector)}`, payload);
  },
};
