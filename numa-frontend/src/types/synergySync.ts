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
  content_type?: string;
  modified_at?: string;
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
