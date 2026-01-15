export type DataConnectorStatus = 'enabled' | 'disabled';

export interface GlobalDataConnectorSetting {
  connector: string;
  status: DataConnectorStatus;
}

export type GlobalDataConnectorSettingsMap = Record<string, { status: DataConnectorStatus }>;

function toMap(items: GlobalDataConnectorSetting[]): GlobalDataConnectorSettingsMap {
  const map: GlobalDataConnectorSettingsMap = {
    synergy: { status: 'disabled' },
  };
  for (const item of items) {
    map[item.connector] = { status: item.status };
  }
  return map;
}

export const AdminDataConnectorsService = {
  async listWithNuma(
    numaGet: (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>,
  ): Promise<GlobalDataConnectorSettingsMap> {
    const items = (await numaGet('/api/settings/data-connectors')) as GlobalDataConnectorSetting[];
    return toMap(items || []);
  },

  async updateWithNuma(
    connector: string,
    payload: { status: DataConnectorStatus },
    numaPut: (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>,
  ): Promise<void> {
    await numaPut(`/api/settings/data-connectors/${encodeURIComponent(connector)}`, payload);
  },
};
