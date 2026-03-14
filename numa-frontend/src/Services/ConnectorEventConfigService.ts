export interface ConnectorEventConfig {
  connector_id: string;
  event_type: string;
  enabled: boolean;
  tags: string[];
  updated_at?: string;
}

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data: unknown, headers?: Record<string, string>) => Promise<unknown>;

export const ConnectorEventConfigService = {
  async listConfigs(numaGet: NumaGet, connectorId: string): Promise<ConnectorEventConfig[]> {
    const response = (await numaGet(`/api/data-connectors/${connectorId}/event-configs`)) as {
      items?: ConnectorEventConfig[];
    };
    return response?.items || [];
  },

  async updateConfig(
    numaPut: NumaPut,
    connectorId: string,
    eventType: string,
    config: { enabled?: boolean; tags?: string[] }
  ): Promise<ConnectorEventConfig> {
    const response = (await numaPut(`/api/data-connectors/${connectorId}/event-configs/${eventType}`, config)) as {
      item: ConnectorEventConfig;
    };
    return response.item;
  },
};
