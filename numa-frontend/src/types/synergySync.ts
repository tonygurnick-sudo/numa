export type SynergyJob = {
  job_id: string;
  name: string;
  description?: string;
  path?: string;
  no_of_folders?: number;
  no_of_children?: number;
};

export type SynergyFolder = {
  folder_id: string;
  name: string;
  has_subfolders?: boolean;
  no_of_subfolders?: number;
  folder_type?: number;
};

export type SynergyJobsResponse = {
  page?: number;
  page_size?: number;
  total_rows?: number;
  total_pages?: number;
  items: SynergyJob[];
};

export type SynergyJobFoldersResponse = {
  items: SynergyFolder[];
  page?: number;
  page_size?: number;
  total_rows?: number;
  total_pages?: number;
};

export type SynergyFile = {
  file_id: string;
  name: string;
  size?: number;
  size_readable?: string;
  content_type?: string;
  modified_at?: string;
  created_on?: string;
  /** Latest 12d version number. */
  version?: number;
  /** 12d workflow state (e.g. "None", "Issued"). */
  state?: string;
  /** Custom "Revision" attribute value (e.g. "D"). */
  revision?: string;
  /** Custom "Document Status" attribute value (e.g. "Issued for Approval"). */
  document_status?: string;
  last_changed_by?: string;
  file_type?: string;
  path?: string;
  is_checked_out?: boolean;
  checked_out_by?: string;
};

export type SynergyFolderItemsResponse = {
  folder_id: string;
  subfolders: SynergyFolder[];
  files: SynergyFile[];
  files_total?: number;
  page?: number;
  page_size?: number;
  total_rows?: number;
  total_pages?: number;
};

export type SynergyFileSearchResponse = {
  items: SynergyFile[];
  /** Echoed back: the job the search was scoped to and the query run. */
  job_id?: string;
  query?: string;
  total_rows?: number;
};

export type SynergyHistoryEntry = {
  version?: number;
  changed_by?: string;
  changed_at?: string;
  change_type?: number;
};

export type SynergyFileHistoryResponse = {
  items: SynergyHistoryEntry[];
  page?: number;
  page_size?: number;
  total_rows?: number;
  total_pages?: number;
};

export type SyncConfig = {
  user_id: string;
  sync_config_id: string;
  synergy_job_id: string;
  synergy_job_name: string;
  target_kb_id: string;
  selected_folders: string[];
  skip_unsupported_files: boolean;
  include_all_folders?: boolean;
  status?: string;
  created_at?: string;
  updated_at?: string;
};

/** Admin config for the cross-job Synergy → knowledge-base crawler. */
export type SynergyKbSyncConfig = {
  enabled: boolean;
  frequency_hours: number;
  credential_user_sub: string;
  updated_at?: string;
  updated_by?: string;
};

/** Latest crawl-run status (null until a run has started). */
export type SynergyKbSyncStatus = {
  last_run: {
    run_id: string;
    status: string;
    trigger: string;
    started_at: string;
    job_count: number;
    jobs_pending: number;
    jobs_done: number;
  } | null;
};

/** One job's row in the index-overview view (see GET …/synergy/index-overview). */
export type SynergyIndexJob = {
  job_id: string;
  name: string;
  path: string;
  status: 'done' | 'pending' | string;
  indexed_files: number;
  /** Count of text-bearing files enumerated for the job (coverage denominator). 0 when unknown. */
  files_total: number;
  /** ISO timestamp of the newest FILE# row seen for the job, or '' if none. */
  last_indexed_at: string;
  /** ISO timestamp the job's files were last enumerated, or '' if never. */
  last_enumerated_at: string;
  /** ISO timestamp the job's crawl completed, or '' if never. */
  completed_at: string;
  /** Number of distinct users with retrieval access to the job. */
  allowed_users: number;
};

/** Admin index-overview of the cross-job Synergy crawl (GET …/synergy/index-overview). */
export type SynergyIndexOverview = {
  summary: {
    /** Live count of ALL jobs in Synergy (incl sub-jobs) — the true "jobs to index"
     *  denominator. null when the live count is unavailable. */
    total_synergy_jobs: number | null;
    /** Jobs the crawl has enumerated into the index so far (JOB# rows). */
    total_jobs: number;
    indexed_jobs: number;
    pending_jobs: number;
    total_indexed_files: number;
    /** Sum of per-job files_total (0s included). Coverage denominator across all jobs. */
    files_total: number;
    sync_enabled: boolean;
    frequency_hours: number;
    last_run: {
      run_id: string;
      status: string;
      trigger: string;
      started_at: string;
      completed_at: string;
      job_count: number;
      jobs_done: number;
      jobs_pending: number;
    } | null;
  };
  jobs: SynergyIndexJob[];
  /** true when the bounded FILE# scan hit its cap (so counts are a partial view). */
  truncated: boolean;
};
