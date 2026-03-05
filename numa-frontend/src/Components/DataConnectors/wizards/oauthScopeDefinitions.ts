export interface ScopeOption {
  id: string;
  label: string;
  scope: string;
  description: string;
  default: boolean;
}

export const PROVIDER_SCOPES: Record<string, ScopeOption[]> = {
  googledrive: [
    {
      id: 'read',
      label: 'Read files',
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      description: 'View and download all Drive files',
      default: true,
    },
    {
      id: 'write',
      label: 'Full access',
      scope: 'https://www.googleapis.com/auth/drive',
      description: 'View, edit, create and delete Drive files',
      default: false,
    },
    {
      id: 'metadata',
      label: 'Metadata only',
      scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
      description: 'View file names, sizes and dates without downloading',
      default: false,
    },
    {
      id: 'apponly',
      label: 'App-created files only',
      scope: 'https://www.googleapis.com/auth/drive.file',
      description: 'Access only files created by or opened with this app',
      default: false,
    },
  ],
  onedrive: [
    {
      id: 'read',
      label: 'Read user files',
      scope: 'Files.Read',
      description: "Read the user's own files",
      default: true,
    },
    {
      id: 'readall',
      label: 'Read all files',
      scope: 'Files.Read.All',
      description: 'Read all files the user can access',
      default: false,
    },
    {
      id: 'readwrite',
      label: 'Read & write files',
      scope: 'Files.ReadWrite',
      description: "Create, read, update, delete user's files",
      default: false,
    },
    {
      id: 'rwall',
      label: 'Read & write all files',
      scope: 'Files.ReadWrite.All',
      description: 'Full CRUD on all accessible files',
      default: false,
    },
    {
      id: 'sites',
      label: 'SharePoint sites',
      scope: 'Sites.Read.All',
      description: 'Read documents from SharePoint sites',
      default: false,
    },
    {
      id: 'offline',
      label: 'Offline access',
      scope: 'offline_access',
      description: 'Maintain access when user is not active',
      default: true,
    },
  ],
  dropbox: [
    {
      id: 'metaread',
      label: 'Read file info',
      scope: 'files.metadata.read',
      description: 'View names, sizes, dates',
      default: true,
    },
    {
      id: 'metawrite',
      label: 'Manage files',
      scope: 'files.metadata.write',
      description: 'Move, rename, delete files',
      default: false,
    },
    {
      id: 'read',
      label: 'Read file content',
      scope: 'files.content.read',
      description: 'Download and read files',
      default: true,
    },
    {
      id: 'write',
      label: 'Write file content',
      scope: 'files.content.write',
      description: 'Upload and edit files',
      default: false,
    },
    {
      id: 'sharing',
      label: 'View sharing',
      scope: 'sharing.read',
      description: 'View shared folders and links',
      default: false,
    },
    {
      id: 'account',
      label: 'Account info',
      scope: 'account_info.read',
      description: 'View name, email, quota',
      default: true,
    },
  ],
};

/** Build space-separated scope string from selected scope IDs for a given provider */
export const buildScopeString = (providerId: string, selectedIds: string[]): string => {
  const defs = PROVIDER_SCOPES[providerId];
  if (!defs) return selectedIds.join(' ');
  return defs
    .filter((s) => selectedIds.includes(s.id))
    .map((s) => s.scope)
    .join(' ');
};

/** Parse a scope string back into selected scope IDs for a given provider */
export const parseScopeString = (providerId: string, scopeString: string): string[] => {
  const defs = PROVIDER_SCOPES[providerId];
  if (!defs) return [];
  const scopes = scopeString.split(/\s+/).filter(Boolean);
  return defs.filter((s) => scopes.includes(s.scope)).map((s) => s.id);
};

/** Get default scope IDs for a provider */
export const getDefaultScopeIds = (providerId: string): string[] => {
  const defs = PROVIDER_SCOPES[providerId];
  if (!defs) return [];
  return defs.filter((s) => s.default).map((s) => s.id);
};
