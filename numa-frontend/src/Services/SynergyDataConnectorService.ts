import type { SynergyFolderItemsResponse, SynergyJobsResponse, SynergyFolder, SyncConfig } from '../types/synergySync';

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaDelete = (url: string, headers?: Record<string, string>) => Promise<unknown>;

export const SynergyDataConnectorService = {
  async listJobs(
    numaGet: NumaGet,
    params?: { name?: string; page?: number; page_size?: number }
  ): Promise<SynergyJobsResponse> {
    return (await numaGet('/api/data-connectors/synergy/jobs', params)) as SynergyJobsResponse;
  },

  async listJobFolders(numaGet: NumaGet, jobId: string): Promise<SynergyFolder[]> {
    const response = (await numaGet(`/api/data-connectors/synergy/jobs/${jobId}/folders`)) as {
      items?: SynergyFolder[];
    };
    return response?.items || [];
  },

  async listFolderItems(numaGet: NumaGet, folderId: string): Promise<SynergyFolderItemsResponse> {
    return (await numaGet(`/api/data-connectors/synergy/folders/${folderId}/items`)) as SynergyFolderItemsResponse;
  },

  async listSyncConfigs(numaGet: NumaGet): Promise<SyncConfig[]> {
    const response = (await numaGet('/api/data-connectors/sync-configs')) as { items?: SyncConfig[] };
    return response?.items || [];
  },

  async createSyncConfig(
    numaPost: NumaPost,
    payload: Omit<SyncConfig, 'user_id' | 'sync_config_id'>
  ): Promise<SyncConfig> {
    const response = (await numaPost('/api/data-connectors/sync-configs', payload)) as { item?: SyncConfig };
    if (!response?.item) {
      throw new Error('Failed to create sync selection.');
    }
    return response.item;
  },

  async updateSyncConfig(
    numaPut: NumaPut,
    syncConfigId: string,
    payload: Omit<SyncConfig, 'user_id' | 'sync_config_id'>
  ): Promise<SyncConfig> {
    const response = (await numaPut(`/api/data-connectors/sync-configs/${syncConfigId}`, payload)) as {
      item?: SyncConfig;
    };
    if (!response?.item) {
      throw new Error('Failed to update sync selection.');
    }
    return response.item;
  },

  async deleteSyncConfig(numaDelete: NumaDelete, syncConfigId: string): Promise<void> {
    await numaDelete(`/api/data-connectors/sync-configs/${syncConfigId}`);
  },
};
