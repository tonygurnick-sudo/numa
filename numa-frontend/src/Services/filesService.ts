/**
 * Service for interacting with the User Files API.
 *
 * Handles CRUD operations for the per-user virtual file system with
 * three scopes: My Files, Company, and Projects.
 */

import { sanitizeS3Filename } from '../utils/sanitizeFilename';

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
  name: string;
  parent_path: string;
  size_bytes: number;
  last_modified: string;
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

export const getDownloadUrl = async (scope: Scope, filePath: string): Promise<{ url: string; key: string }> => {
  const res = await fetch(`${scopePath(scope)}/download?path=${encodeURIComponent(filePath)}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<{ url: string; key: string }>(res);
};

export const renameFile = async (scope: Scope, filePath: string, newName: string): Promise<unknown> => {
  const res = await fetch(`${scopePath(scope)}/file`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ path: filePath, name: newName }),
  });
  return handleResponse<unknown>(res);
};

export const moveFile = async (scope: Scope, filePath: string, newParentPath: string): Promise<unknown> => {
  const res = await fetch(`${scopePath(scope)}/file`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ path: filePath, parent_path: newParentPath }),
  });
  return handleResponse<unknown>(res);
};

export const copyFile = async (
  scope: Scope,
  filePath: string,
  targetParentPath?: string,
  targetName?: string
): Promise<unknown> => {
  const res = await fetch(`${scopePath(scope)}/copy`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ path: filePath, parent_path: targetParentPath, name: targetName }),
  });
  return handleResponse<unknown>(res);
};

export const deleteFile = async (scope: Scope, filePath: string): Promise<void> => {
  const res = await fetch(`${scopePath(scope)}/file?path=${encodeURIComponent(filePath)}`, {
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
  role: 'owner' | 'editor' | 'viewer'
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
 * Build the virtual path for a file from its parent_path + name.
 */
export const filePath = (file: FileItem): string => `${file.parent_path}${file.name}`;

/**
 * Build the S3 key for a file upload based on scope and path.
 * Files are stored directly at {prefix}{path}{fileName} — no UUIDs.
 */
export const buildS3Key = (scope: Scope, fileName: string, currentPath: string, userSub: string): string => {
  const safeName = sanitizeS3Filename(fileName);
  // Strip leading slash so the key doesn't start with double slashes
  const pathSegment = (currentPath || '/').replace(/^\//, '');
  switch (scope.type) {
    case 'my':
      return `files/user/${userSub}/${pathSegment}${safeName}`;
    case 'company':
      return `files/company/${pathSegment}${safeName}`;
    case 'project':
      return `files/project/${scope.projectId}/${pathSegment}${safeName}`;
  }
};

/**
 * Get the icon class for a file based on its name/extension.
 */
export const getFileIcon = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return 'bi bi-file-earmark';

  const ext = fileName.slice(dot).toLowerCase();

  if (ext === '.pdf') return 'bi bi-file-earmark-pdf';
  if (['.doc', '.docx', '.odt', '.rtf'].includes(ext)) return 'bi bi-file-earmark-word';
  if (['.xls', '.xlsx', '.ods', '.csv', '.tsv'].includes(ext)) return 'bi bi-file-earmark-spreadsheet';
  if (['.ppt', '.pptx', '.odp'].includes(ext)) return 'bi bi-file-earmark-slides';
  if (['.db', '.sqlite', '.sqlite3', '.mdb', '.accdb', '.dbf', '.sql'].includes(ext)) return 'bi bi-database-add';
  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff'].includes(ext))
    return 'bi bi-file-earmark-image';
  if (['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma'].includes(ext)) return 'bi bi-file-earmark-music';
  if (['.mp4', '.avi', '.mov', '.mkv', '.webm', '.wmv', '.flv'].includes(ext)) return 'bi bi-file-earmark-play';
  if (['.zip', '.tar', '.gz', '.rar', '.7z', '.bz2'].includes(ext)) return 'bi bi-file-earmark-zip';
  if (
    [
      '.js',
      '.ts',
      '.py',
      '.java',
      '.c',
      '.cpp',
      '.go',
      '.rs',
      '.rb',
      '.php',
      '.html',
      '.css',
      '.json',
      '.xml',
      '.yaml',
      '.yml',
      '.sh',
      '.bat',
    ].includes(ext)
  )
    return 'bi bi-file-earmark-code';
  if (['.txt', '.md', '.log', '.ini', '.cfg', '.conf'].includes(ext)) return 'bi bi-file-earmark-text';

  return 'bi bi-file-earmark';
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
