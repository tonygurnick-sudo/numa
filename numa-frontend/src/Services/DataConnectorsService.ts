import type { DataConnectorStatus, PatStatus } from '../types/dataConnectors';

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

export const DataConnectorsService = {
  async listStatus(numaGet: NumaGet): Promise<DataConnectorStatus[]> {
    const response = (await numaGet('/api/data-connectors/status')) as { items?: DataConnectorStatus[] };
    return response?.items || [];
  },

  // `.connect` removed — the legacy Synergy "Connect" modal in Files.tsx that
  // posted { connector_id, config } to /api/data-connectors/connect has been
  // deleted. Per-user credentials are now captured in the chat sidebar or the
  // ConnectTokenModal and routed through PATConnectorService.

  async getSynergyPatStatus(numaGet: NumaGet): Promise<PatStatus> {
    return (await numaGet('/api/data-connectors/synergy/pat-status')) as PatStatus;
  },

  async rotateSynergyPat(numaPost: NumaPost): Promise<unknown> {
    return numaPost('/api/data-connectors/synergy/rotate-pat');
  },
};

// saveUserConnectorCredential removed — PAT credential writes now go through
// PATConnectorService.saveCredentials (POST /api/pat/{id}/credentials).
