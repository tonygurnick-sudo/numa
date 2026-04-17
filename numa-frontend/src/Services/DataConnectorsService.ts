import type { DataConnectorStatus, PatStatus } from '../types/dataConnectors';

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

export const DataConnectorsService = {
  async listStatus(numaGet: NumaGet): Promise<DataConnectorStatus[]> {
    const response = (await numaGet('/api/data-connectors/status')) as { items?: DataConnectorStatus[] };
    return response?.items || [];
  },

  async connect(
    numaPost: NumaPost,
    payload: { connector_id: string; config: Record<string, unknown> }
  ): Promise<unknown> {
    return numaPost('/api/data-connectors/connect', payload);
  },

  async getSynergyPatStatus(numaGet: NumaGet): Promise<PatStatus> {
    return (await numaGet('/api/data-connectors/synergy/pat-status')) as PatStatus;
  },

  async rotateSynergyPat(numaPost: NumaPost): Promise<unknown> {
    return numaPost('/api/data-connectors/synergy/rotate-pat');
  },
};
