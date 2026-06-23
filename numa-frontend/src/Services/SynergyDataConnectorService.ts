import type {
  SynergyFolderItemsResponse,
  SynergyJobsResponse,
  SynergyJobFoldersResponse,
  SynergyFileSearchResponse,
  SynergyFileHistoryResponse,
  SynergyFile,
  SyncConfig,
  SynergyKbSyncConfig,
  SynergyKbSyncStatus,
  SynergyIndexOverview,
} from '../types/synergySync';

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

  async listJobFolders(
    numaGet: NumaGet,
    jobId: string,
    params?: { page?: number; page_size?: number }
  ): Promise<SynergyJobFoldersResponse> {
    return (await numaGet(`/api/data-connectors/synergy/jobs/${jobId}/folders`, params)) as SynergyJobFoldersResponse;
  },

  async listFolderItems(
    numaGet: NumaGet,
    folderId: string,
    params?: { page?: number; page_size?: number }
  ): Promise<SynergyFolderItemsResponse> {
    return (await numaGet(
      `/api/data-connectors/synergy/folders/${folderId}/items`,
      params
    )) as SynergyFolderItemsResponse;
  },

  /**
   * Search files within a job by name AND contents (merged).
   *
   * Synergy file search is job-scoped — there is no global/all-jobs search, so
   * a `jobId` (the bare `N_N` IDString of the job you're inside) is required.
   * The backend searches filename and document contents and merges the results.
   */
  async searchFiles(
    numaGet: NumaGet,
    jobId: string,
    query: string,
    opts?: { page_size?: number }
  ): Promise<SynergyFileSearchResponse> {
    return (await numaGet('/api/data-connectors/synergy/files/search', {
      q: query,
      job_id: jobId,
      page_size: opts?.page_size,
    })) as SynergyFileSearchResponse;
  },

  async getFileHistory(
    numaGet: NumaGet,
    fileId: string,
    params?: { page?: number; page_size?: number }
  ): Promise<SynergyFileHistoryResponse> {
    return (await numaGet(
      `/api/data-connectors/synergy/files/${fileId}/history`,
      params
    )) as SynergyFileHistoryResponse;
  },

  async getFileDetails(numaGet: NumaGet, fileId: string): Promise<SynergyFile> {
    return (await numaGet(`/api/data-connectors/synergy/files/${fileId}`)) as SynergyFile;
  },

  async getFileWeblink(numaGet: NumaGet, fileId: string): Promise<{ weblink?: string }> {
    return (await numaGet(`/api/data-connectors/synergy/files/${fileId}/weblink`)) as { weblink?: string };
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

  // ---------------------------------------------------------------------------
  // Cross-job KB crawler admin (sync-config / sync-status / sync-now). All
  // admin-gated server-side; the panel additionally gates on the admin group +
  // DEPLOY_SYNERGY flag.
  // ---------------------------------------------------------------------------
  async getKbSyncConfig(numaGet: NumaGet): Promise<SynergyKbSyncConfig> {
    return (await numaGet('/api/data-connectors/synergy/sync-config')) as SynergyKbSyncConfig;
  },

  async updateKbSyncConfig(
    numaPut: NumaPut,
    payload: { enabled: boolean; frequency_hours: number; use_my_credential?: boolean }
  ): Promise<SynergyKbSyncConfig> {
    return (await numaPut('/api/data-connectors/synergy/sync-config', payload)) as SynergyKbSyncConfig;
  },

  async getKbSyncStatus(numaGet: NumaGet): Promise<SynergyKbSyncStatus> {
    return (await numaGet('/api/data-connectors/synergy/sync-status')) as SynergyKbSyncStatus;
  },

  async getIndexOverview(numaGet: NumaGet): Promise<SynergyIndexOverview> {
    return (await numaGet('/api/data-connectors/synergy/index-overview')) as SynergyIndexOverview;
  },

  async kbSyncNow(
    numaPost: NumaPost,
    scope?: { max_jobs?: number; job_ids?: string[] }
  ): Promise<{ status?: string; run_id?: string }> {
    return (await numaPost('/api/data-connectors/synergy/sync-now', scope ? { scope } : {})) as {
      status?: string;
      run_id?: string;
    };
  },

  /**
   * Manually queue a sync scoped to specific 12d job ids. Posts `job_ids` at the
   * top level of the sync-now body — the data-connectors lambda forwards it as
   * the coordinator's `scope.job_ids` (see synergy-overview-v2 contract).
   */
  async indexJob(numaPost: NumaPost, jobIds: string[]): Promise<{ status?: string; run_id?: string }> {
    return (await numaPost('/api/data-connectors/synergy/sync-now', { job_ids: jobIds })) as {
      status?: string;
      run_id?: string;
    };
  },
};
