/**
 * Service for interacting with the User Files API.
 *
 * Handles CRUD operations for the per-user virtual file system with
 * three scopes: My Files, Company, and Projects.
 */

const API_BASE = '/api/files';

type Scope = { type: 'my' } | { type: 'company' } | { type: 'project'; projectId: string };

const scopePath = (scope: Scope): string => {
  switch (scope.type) {
    case 'my':
      return `${API_BASE}/my`;
    case 'company':
      return `${API_BASE}/company`;
    case 'project':
      return `${API_BASE}/project/${scope.projectId}`;
  }
};

const getAuthHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const accessToken = localStorage.getItem('accessToken');
  if (accessToken) {
    headers.authorization = accessToken;
  } else {
    console.warn('[filesService] No accessToken in localStorage');
  }
  return headers;
};

const handleResponse = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`API error (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileScope = Scope;

export interface FolderItem {
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  item_type: 'folder';
}

export interface FileItem {
  file_id: string;
  name: string;
  parent_path: string;
  size_bytes: number;
  content_type: string;
  source_type: string;
  extraction_status: 'queued' | 'processing' | 'ready' | 'error' | 'not_applicable';
  extracted_words?: number;
  extracted_pages?: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  item_type: 'file';
}

export interface FolderContents {
  path: string;
  folders: FolderItem[];
  files: FileItem[];
}

export interface ProjectSummary {
  project_id: string;
  project_name: string;
  role: string;
  joined_at: string;
}

export interface ProjectDetail {
  project_id: string;
  name: string;
  created_at: string;
  created_by: string;
  members: string[];
}

// ---------------------------------------------------------------------------
// File / folder operations
// ---------------------------------------------------------------------------

export const listFolder = async (scope: Scope, path = '/'): Promise<FolderContents> => {
  const res = await fetch(`${scopePath(scope)}?path=${encodeURIComponent(path)}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<FolderContents>(res);
};

export const createFolder = async (scope: Scope, parentPath: string, name: string): Promise<FolderItem> => {
  const res = await fetch(scopePath(scope), {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ action: 'create_folder', path: parentPath, name }),
  });
  return handleResponse<FolderItem>(res);
};

export const registerFile = async (
  scope: Scope,
  fileId: string,
  name: string,
  parentPath: string,
  contentType: string,
  sizeBytes: number,
): Promise<FileItem> => {
  const res = await fetch(scopePath(scope), {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      action: 'register',
      file_id: fileId,
      name,
      parent_path: parentPath,
      content_type: contentType,
      size_bytes: sizeBytes,
    }),
  });
  return handleResponse<FileItem>(res);
};

export const getFile = async (scope: Scope, fileId: string): Promise<FileItem> => {
  const res = await fetch(`${scopePath(scope)}/${fileId}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<FileItem>(res);
};

export const getDownloadUrl = async (scope: Scope, fileId: string): Promise<{ url: string; key: string }> => {
  const res = await fetch(`${scopePath(scope)}/${fileId}/download`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<{ url: string; key: string }>(res);
};

export const renameFile = async (scope: Scope, fileId: string, newName: string): Promise<FileItem> => {
  const res = await fetch(`${scopePath(scope)}/${fileId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ name: newName }),
  });
  return handleResponse<FileItem>(res);
};

export const moveFile = async (scope: Scope, fileId: string, newParentPath: string): Promise<FileItem> => {
  const res = await fetch(`${scopePath(scope)}/${fileId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ parent_path: newParentPath }),
  });
  return handleResponse<FileItem>(res);
};

export const copyFile = async (
  scope: Scope,
  fileId: string,
  targetParentPath?: string,
  targetName?: string,
): Promise<FileItem> => {
  const res = await fetch(`${scopePath(scope)}/${fileId}/copy`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ parent_path: targetParentPath, name: targetName }),
  });
  return handleResponse<FileItem>(res);
};

export const deleteFile = async (scope: Scope, fileId: string): Promise<void> => {
  const res = await fetch(`${scopePath(scope)}/${fileId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  await handleResponse<unknown>(res);
};

export const deleteFolder = async (scope: Scope, path: string): Promise<void> => {
  const res = await fetch(`${scopePath(scope)}/folder?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  await handleResponse<unknown>(res);
};

export const renameFolder = async (scope: Scope, path: string, newName: string): Promise<unknown> => {
  const res = await fetch(`${scopePath(scope)}/folder`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ path, name: newName }),
  });
  return handleResponse<unknown>(res);
};

export const moveFolder = async (scope: Scope, path: string, newParent: string): Promise<unknown> => {
  const res = await fetch(`${scopePath(scope)}/folder`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ path, new_parent: newParent }),
  });
  return handleResponse<unknown>(res);
};

// ---------------------------------------------------------------------------
// Project operations
// ---------------------------------------------------------------------------

export const listProjects = async (): Promise<{ projects: ProjectSummary[] }> => {
  const res = await fetch(`${API_BASE}/projects`, { headers: getAuthHeaders() });
  return handleResponse<{ projects: ProjectSummary[] }>(res);
};

export const createProject = async (name: string): Promise<ProjectSummary> => {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ name }),
  });
  return handleResponse<ProjectSummary>(res);
};

export const getProject = async (projectId: string): Promise<ProjectDetail> => {
  const res = await fetch(`${API_BASE}/projects/${projectId}`, { headers: getAuthHeaders() });
  return handleResponse<ProjectDetail>(res);
};

export const deleteProject = async (projectId: string): Promise<void> => {
  const res = await fetch(`${API_BASE}/projects/${projectId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  await handleResponse<unknown>(res);
};

export const addProjectMember = async (
  projectId: string,
  userId: string,
  role: 'owner' | 'editor' | 'viewer',
): Promise<unknown> => {
  const res = await fetch(`${API_BASE}/projects/${projectId}/members`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ user_id: userId, role }),
  });
  return handleResponse<unknown>(res);
};

export const removeProjectMember = async (projectId: string, userId: string): Promise<void> => {
  const res = await fetch(`${API_BASE}/projects/${projectId}/members/${userId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  await handleResponse<unknown>(res);
};

// ---------------------------------------------------------------------------
// Upload helpers
// ---------------------------------------------------------------------------

/**
 * Build the S3 key for a file upload based on scope.
 */
export const buildS3Key = (scope: Scope, fileId: string, fileName: string, userSub: string): string => {
  switch (scope.type) {
    case 'my':
      return `files/user/${userSub}/${fileId}/original/${fileName}`;
    case 'company':
      return `files/company/${fileId}/original/${fileName}`;
    case 'project':
      return `files/project/${scope.projectId}/${fileId}/original/${fileName}`;
  }
};

/**
 * Get the icon class for a source type.
 */
export const getFileIcon = (sourceType: string): string => {
  switch (sourceType) {
    case 'pdf':
      return 'bi bi-file-earmark-pdf';
    case 'docx':
      return 'bi bi-file-earmark-word';
    case 'xlsx':
      return 'bi bi-file-earmark-spreadsheet';
    case 'image':
      return 'bi bi-file-earmark-image';
    case 'audio':
      return 'bi bi-file-earmark-music';
    case 'text':
      return 'bi bi-file-earmark-text';
    default:
      return 'bi bi-file-earmark';
  }
};

/**
 * Format file size for display.
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
};

// ---------------------------------------------------------------------------
// Orphan operations — unregistered S3 files
// ---------------------------------------------------------------------------

export interface OrphanItem {
  key: string;
  name: string;
  size: number;
  last_modified: string;
  source: string;
}

export interface OrphanListResponse {
  orphans: OrphanItem[];
  next_cursor?: string;
  total_scanned: number;
}

export const listOrphans = async (cursor?: string, limit = 50): Promise<OrphanListResponse> => {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit !== 50) params.set('limit', String(limit));
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/my/orphans${qs ? `?${qs}` : ''}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<OrphanListResponse>(res);
};

export const getOrphanDownloadUrl = async (key: string): Promise<{ url: string; key: string; name: string }> => {
  const encodedKey = btoa(key).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch(`${API_BASE}/my/orphans/${encodedKey}/download`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<{ url: string; key: string; name: string }>(res);
};

export const adoptOrphan = async (key: string, name?: string, parentPath?: string): Promise<FileItem> => {
  const res = await fetch(`${API_BASE}/my/orphans/adopt`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ key, name, parent_path: parentPath }),
  });
  return handleResponse<FileItem>(res);
};

// ---------------------------------------------------------------------------
// Company orphan operations — unregistered company-level S3 files
// ---------------------------------------------------------------------------

export const listCompanyOrphans = async (cursor?: string, limit = 50): Promise<OrphanListResponse> => {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit !== 50) params.set('limit', String(limit));
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/company/orphans${qs ? `?${qs}` : ''}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<OrphanListResponse>(res);
};

export const getCompanyOrphanDownloadUrl = async (key: string): Promise<{ url: string; key: string; name: string }> => {
  const encodedKey = btoa(key).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch(`${API_BASE}/company/orphans/${encodedKey}/download`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<{ url: string; key: string; name: string }>(res);
};

export const adoptCompanyOrphan = async (key: string, name?: string, parentPath?: string): Promise<FileItem> => {
  const res = await fetch(`${API_BASE}/company/orphans/adopt`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ key, name, parent_path: parentPath }),
  });
  return handleResponse<FileItem>(res);
};
