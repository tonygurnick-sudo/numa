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

export const AdminDataConnectorsService = {
  async listWithNuma(
    numaGet: (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>
  ): Promise<GlobalDataConnectorSettingsMap> {
    const items = (await numaGet('/api/settings/data-connectors')) as GlobalDataConnectorSetting[];
    return toMap(items || []);
  },

  async updateWithNuma(
    connector: string,
    payload: { status: DataConnectorStatus; devOnly?: boolean; requiresDeploy?: boolean },
    numaPut: (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>
  ): Promise<void> {
    await numaPut(`/api/settings/data-connectors/${encodeURIComponent(connector)}`, payload);
  },
};
