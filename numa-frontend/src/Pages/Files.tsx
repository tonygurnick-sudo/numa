import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { getFlag } from '../utils/featureFlags';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { useAuth } from '../Providers/AuthProvider';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useToast } from '../Providers/ToastContext';
import { withPRM } from '../utils/prmUtils';
import {
  listFolder,
  createFolder,
  getDownloadUrl,
  renameFile as apiRenameFile,
  moveFile as apiMoveFile,
  moveFolder as apiMoveFolder,
  deleteFile as apiDeleteFile,
  deleteFolder as apiDeleteFolder,
  copyFile as apiCopyFile,
  buildS3Key,
  getFileIcon,
  formatFileSize,
  filePath as buildFilePath,
  listProjects,
} from '../Services/filesService';
import type { FileItem } from '../Services/filesService';
import { listMyShares, deleteShare } from '../Services/sharedChatService';
import type { ShareListItem } from '../Services/sharedChatService';
import { useShareAnalytics } from '../hooks/useShareAnalytics';
import { calculateShareMetrics, exportShareAnalyticsAsCSV } from '../utils/messageAnalyticsUtils';
import type { FileScope, FolderContents, ProjectSummary } from '../Services/filesService';
import { CreateShareModal } from '../Components/Files/CreateShareModal';
import { FilesUploadModal } from '../Components/Files/FilesUploadModal';
import FileContextMenu from '../Components/Files/FileContextMenu';
import type { FileContextAction, FileOrFolder, RemoteFileItem } from '../Components/Files/FileContextMenu';
import FileSelectionToolbar from '../Components/Files/FileSelectionToolbar';
import FileRowActions from '../Components/Files/FileRowActions';
import MoveFileModal from '../Components/Files/MoveFileModal';
import AddToKBModal from '../Components/Files/AddToKBModal';
import FileInfoPanel from '../Components/Files/FileInfoPanel';
import type { InfoTarget } from '../Components/Files/FileInfoPanel';
import FileSummarizePanel from '../Components/Files/FileSummarizePanel';
import { useFileSelection } from '../hooks/useFileSelection';
import { listObjectsInFolder } from '../utils/s3Utils';
import { useFilesCache } from './useFilesCache';
import { DataConnectorsService } from '../Services/DataConnectorsService';
import { SynergyDataConnectorService } from '../Services/SynergyDataConnectorService';
import { OAuthProvidersService } from '../Services/OAuthProvidersService';
import type { DataConnectorStatus } from '../types/dataConnectors';
import type { SynergyJob, SynergyFolder, SynergyFile } from '../types/synergySync';
import type {
  OAuthProviderType,
  OAuthProviderInfo,
  OAuthFile,
  OAuthFolder,
  OAuthConnectionStatus,
  OAuthBreadcrumb,
} from '../types/oauthProviders';
import { SynergyIcon } from '../Components/DataConnectors/SynergyConnectorCard';
import { VaultSecretForm } from '../Components/Vault/VaultSecretForm';
import type { VaultSecretMetadata, CreateSecretPayload } from '../Services/VaultService';
import { listSecrets, getSecret, createSecret, listCategories } from '../Services/VaultService';
import './Files.scss';

type TabType = 'projects' | 'company' | 'my' | 'shared' | 'remote';
type ViewMode = 'list' | 'grid' | 'gallery';

interface RemoteTransfer {
  id: string;
  name: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
}

const getScope = (tab: TabType | null, projectId?: string): FileScope => {
  switch (tab) {
    case 'my':
      return { type: 'my' };
    case 'company':
      return { type: 'company' };
    case 'projects':
      return projectId ? { type: 'project', projectId } : { type: 'my' };
    case 'shared':
      return { type: 'my' }; // Not used for shared tab, but satisfies type
    case 'remote':
      return { type: 'my' }; // Not used for remote tab, but satisfies type
    default:
      return { type: 'my' }; // Root level — not used for API calls
  }
};

// ---------------------------------------------------------------------------
// DnD wrapper components
// ---------------------------------------------------------------------------

/** Draggable wrapper — replaces the outer <div> of a file row/card. */
const DraggableItem = ({
  id,
  className,
  onClick,
  children,
}: {
  id: string;
  className: string;
  onClick?: () => void;
  children: React.ReactNode;
}) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`${className}${isDragging ? ' is-dragging' : ''}`}
      onClick={onClick}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
};

/** Combined draggable + droppable wrapper for folder rows/cards. */
const DroppableFolder = ({
  dragId,
  dropId,
  className,
  onClick,
  onContextMenu,
  children,
}: {
  dragId: string;
  dropId: string;
  className: string;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) => {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: dragId });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: dropId });
  const ref = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef]
  );
  return (
    <div
      ref={ref}
      className={`${className}${isDragging ? ' is-dragging' : ''}${isOver ? ' drop-target-active' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
};

/** Droppable breadcrumb segment — accepts drops to move items to a folder. */
const DroppableBreadcrumb = ({
  path,
  className,
  onClick,
  children,
}: {
  path: string;
  className: string;
  onClick?: () => void;
  children: React.ReactNode;
}) => {
  const { setNodeRef, isOver } = useDroppable({ id: `breadcrumb:${path}` });
  return (
    <span ref={setNodeRef} className={`${className}${isOver ? ' drop-target-active' : ''}`} onClick={onClick}>
      {children}
    </span>
  );
};

/** Lightweight drag preview shown in the DragOverlay portal. */
const DragPreview = ({ name, type }: { name: string; type: 'file' | 'folder' }) => (
  <div className="drag-overlay">
    <i className={type === 'folder' ? 'bi bi-folder-fill' : 'bi bi-file-earmark'} />
    <span>{name}</span>
  </div>
);

export const FilesPage = () => {
  const { t } = useTranslation('files');
  const { t: tShared } = useTranslation('shared');
  const { getCredentials, user } = useAuth();
  const { numaGet, numaPost } = useNumaRequest();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // ---------------------------------------------------------------------------
  // URL-derived navigation state
  // ---------------------------------------------------------------------------
  const VALID_TABS: TabType[] = ['my', 'company', 'shared', 'projects', 'remote'];
  const pathSegments = useMemo(
    () =>
      location.pathname
        .replace(/^\/files\/?/, '')
        .split('/')
        .filter(Boolean),
    [location.pathname]
  );

  const activeTab: TabType | null = VALID_TABS.includes(pathSegments[0] as TabType)
    ? (pathSegments[0] as TabType)
    : null;

  const viewMode: ViewMode = (searchParams.get('view') as ViewMode) || 'list';

  const { currentPath, selectedProjectId } = useMemo(() => {
    let _currentPath = '/';
    let _selectedProjectId: string | null = null;

    if (activeTab === 'projects') {
      _selectedProjectId = pathSegments[1] || null;
      const folderSegments = pathSegments.slice(2);
      if (folderSegments.length > 0) {
        _currentPath = '/' + folderSegments.join('/') + '/';
      }
    } else {
      const folderSegments = pathSegments.slice(1);
      if (folderSegments.length > 0) {
        _currentPath = '/' + folderSegments.join('/') + '/';
      }
    }
    return { currentPath: _currentPath, selectedProjectId: _selectedProjectId };
  }, [activeTab, pathSegments]);

  // No redirect — bare /files shows root scope folders

  // View mode setter (updates URL query param)
  const setViewMode = useCallback(
    (mode: ViewMode) => {
      const params = new URLSearchParams(searchParams);
      if (mode === 'list') params.delete('view');
      else params.set('view', mode);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  // ---------------------------------------------------------------------------
  // Regular (non-URL) state
  // ---------------------------------------------------------------------------
  const [contents, setContents] = useState<FolderContents | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [shares, setShares] = useState<ShareListItem[]>([]);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showDropZoneModal, setShowDropZoneModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ShareListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [_remoteTransfers, setRemoteTransfers] = useState<RemoteTransfer[]>([]);
  const [shareModalFile, setShareModalFile] = useState<FileItem | undefined>(undefined);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    show: boolean;
    position: { x: number; y: number };
    target: FileOrFolder | null;
  }>({ show: false, position: { x: 0, y: 0 }, target: null });

  // Selection state
  const fileSelection = useFileSelection();
  const remoteSelection = useFileSelection();

  // Panels & modals
  const [infoTarget, setInfoTarget] = useState<InfoTarget>(null);
  const [summarizeFile, setSummarizeFile] = useState<FileItem | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ paths: string[]; kind: 'file' | 'folder' } | null>(null);
  const [addToKBTarget, setAddToKBTarget] = useState<{ sourceKeys: string[]; sourceLabel: string } | null>(null);

  // Analytics dashboard state (gallery view on shared tab)
  const { summary: analyticsSummary, isLoading: analyticsLoading } = useShareAnalytics();
  const [analyticsExporting, setAnalyticsExporting] = useState(false);

  // ---------------------------------------------------------------------------
  // Remote tab state — Synergy browsing
  // ---------------------------------------------------------------------------
  const dataConnectorsEnabled = getFlag('DATA_CONNECTORS_ENABLED');
  const vaultEnabled = getFlag('SECRETS_VAULT_ENABLED');
  const oauthEnabled = getFlag('OAUTH_AVAILABLE');

  // Dynamic OAuth providers loaded from backend
  const [enabledOAuthProviders, setEnabledOAuthProviders] = useState<OAuthProviderInfo[]>([]);
  const dropZonesEnabled = getFlag('NUMA_DROP_ZONES');
  const sharingEnabled = getFlag('NUMA_SHARING');

  // Synergy state
  const [synergyStatus, setSynergyStatus] = useState<DataConnectorStatus | null>(null);
  const [synergyStatusLoading, setSynergyStatusLoading] = useState(false);
  const [synergyJobs, setSynergyJobs] = useState<SynergyJob[]>([]);
  const [synergyJobsLoading, setSynergyJobsLoading] = useState(false);
  const [synergyFolders, setSynergyFolders] = useState<SynergyFolder[]>([]);
  const [synergyFiles, setSynergyFiles] = useState<SynergyFile[]>([]);
  const [synergyFoldersLoading, setSynergyFoldersLoading] = useState(false);
  type SynergyBreadcrumb = { label: string; type: 'root' | 'job' | 'folder'; id?: string };
  const [synergyBreadcrumbs, setSynergyBreadcrumbs] = useState<SynergyBreadcrumb[]>([
    { label: t('remote.rootLabel'), type: 'root' },
  ]);
  // Connect modal state for Remote tab
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectServer, setConnectServer] = useState('');

  // OAuth providers state — dynamically keyed
  const [oauthProviderStatuses, setOauthProviderStatuses] = useState<Record<string, OAuthConnectionStatus>>({});
  const [oauthStatusLoading, setOauthStatusLoading] = useState<Record<string, boolean>>({});
  const [selectedOauthProvider, setSelectedOauthProvider] = useState<OAuthProviderType | null>(null);
  const [oauthFiles, setOauthFiles] = useState<OAuthFile[]>([]);
  const [oauthFolders, setOauthFolders] = useState<OAuthFolder[]>([]);
  const [oauthContentLoading, setOauthContentLoading] = useState(false);
  const [oauthBreadcrumbs, setOauthBreadcrumbs] = useState<OAuthBreadcrumb[]>([]);
  const [connectingOauthProvider, setConnectingOauthProvider] = useState<OAuthProviderType | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [vaultSecrets, setVaultSecrets] = useState<VaultSecretMetadata[]>([]);
  const [selectedSecretId, setSelectedSecretId] = useState('');
  const [loadingSecrets, setLoadingSecrets] = useState(false);
  const [showVaultForm, setShowVaultForm] = useState(false);
  const [vaultCategories, setVaultCategories] = useState<string[]>([]);

  const dragCounter = useRef(0);

  const isSharedTab = activeTab === 'shared';
  const scope = useMemo(() => getScope(activeTab, selectedProjectId ?? undefined), [activeTab, selectedProjectId]);
  const filesCache = useFilesCache();

  // Build a cache key for the current folder view
  const cacheKey = useMemo(() => {
    const scopeId = scope.type === 'project' ? scope.projectId : '';
    return `folder:${scope.type}:${scopeId}:${currentPath}`;
  }, [scope, currentPath]);

  const loadContents = useCallback(async () => {
    // Root level shows scope folders — no API call needed
    if (activeTab === null) return;
    // Remote tab has its own loading logic
    if (activeTab === 'remote') return;

    if (activeTab === 'shared') {
      setLoading(true);
      setError(null);
      try {
        const sharesResult = await listMyShares();
        setShares(sharesResult ?? []);
      } catch {
        setError(t('errors.loadFailed'));
      } finally {
        setLoading(false);
      }
      return;
    }

    if (activeTab === 'projects' && !selectedProjectId) {
      try {
        const result = await listProjects();
        setProjects(result.projects);
      } catch {
        setError(t('errors.loadFailed'));
      }
      return;
    }

    // Stale-while-revalidate: show cached data instantly, refresh in background
    const cached = filesCache.get<FolderContents>(cacheKey);
    if (cached) {
      setContents(cached);
      // Background refresh — no loading spinner
      setError(null);
      try {
        const result = await listFolder(scope, currentPath);
        filesCache.set(cacheKey, result);
        // Only update state if data actually changed to avoid flicker
        const same =
          result.folders.length === cached.folders.length &&
          result.files.length === cached.files.length &&
          result.files.every(
            (f, i) => f.name === cached.files[i]?.name && f.size_bytes === cached.files[i]?.size_bytes
          ) &&
          result.folders.every((f, i) => f.path === cached.folders[i]?.path && f.name === cached.folders[i]?.name);
        if (!same) setContents(result);
      } catch {
        // Silently keep cached data on background refresh failure
      }
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await listFolder(scope, currentPath);
      setContents(result);
      filesCache.set(cacheKey, result);
    } catch {
      setError(t('errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [scope, currentPath, activeTab, selectedProjectId, t, filesCache, cacheKey]);

  useEffect(() => {
    loadContents();
  }, [loadContents]);

  // Build a URL path for the current scope and given folder path
  const buildFileUrl = useCallback(
    (path: string) => {
      if (activeTab === null) return '/files';
      const cleanPath = path.replace(/^\/|\/$/g, '');
      const base =
        activeTab === 'projects' && selectedProjectId ? `/files/projects/${selectedProjectId}` : `/files/${activeTab}`;
      return cleanPath ? `${base}/${cleanPath}` : base;
    },
    [activeTab, selectedProjectId]
  );

  const navigateToFolder = useCallback(
    (path: string) => {
      navigate(buildFileUrl(path));
    },
    [navigate, buildFileUrl]
  );

  const navigateUp = useCallback(() => {
    // At root of a scope — go back to root scope view
    if (currentPath === '/' && activeTab !== null) {
      setContents(null);
      navigate('/files');
      return;
    }
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parentPath = parts.length === 0 ? '/' : `/${parts.join('/')}/`;
    navigate(buildFileUrl(parentPath));
  }, [currentPath, activeTab, navigate, buildFileUrl]);

  const handleTabChange = useCallback(
    (tab: TabType) => {
      setContents(null);
      setError(null);
      setShares([]);

      // Reset remote tab state to always show top level
      if (tab === 'remote') {
        setSelectedOauthProvider(null);
        setSynergyBreadcrumbs([{ label: t('remote.rootLabel'), type: 'root' }]);
        setOauthBreadcrumbs([]);
        setSynergyFolders([]);
        setSynergyFiles([]);
        setOauthFolders([]);
        setOauthFiles([]);
        // Clear any loading states
        setSynergyJobsLoading(false);
        setSynergyFoldersLoading(false);
        setOauthContentLoading(false);
        remoteSelection.clearSelection();
      }

      navigate(`/files/${tab}`);
    },
    [navigate, t]
  );

  const handleProjectSelect = useCallback(
    (projectId: string) => {
      navigate(`/files/projects/${projectId}`);
    },
    [navigate]
  );

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName?.trim()) {
      setNewFolderName(null);
      return;
    }
    try {
      await createFolder(scope, currentPath, newFolderName.trim());
      setNewFolderName(null);
      filesCache.invalidate(`folder:${scope.type}:`);
      loadContents();
    } catch {
      setError(t('errors.folderExists'));
    }
  }, [scope, currentPath, newFolderName, loadContents, t, filesCache]);

  const handleRename = useCallback(
    async (filePath: string) => {
      if (!renameValue.trim()) {
        setRenamingId(null);
        return;
      }
      try {
        await apiRenameFile(scope, filePath, renameValue.trim());
        setRenamingId(null);
        filesCache.invalidate(`folder:${scope.type}:`);
        loadContents();
      } catch {
        setError(t('errors.renameFailed'));
      }
    },
    [scope, renameValue, loadContents, t, filesCache]
  );

  const handleDelete = useCallback(
    async (filePath: string) => {
      if (!window.confirm(t('confirm.deleteFile'))) return;
      try {
        await apiDeleteFile(scope, filePath);
        filesCache.invalidate(`folder:${scope.type}:`);
        loadContents();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errors.deleteFailed'));
      }
    },
    [scope, loadContents, t, filesCache]
  );

  const handleDeleteFolder = useCallback(
    async (path: string) => {
      if (!window.confirm(t('confirm.deleteFolder'))) return;
      try {
        await apiDeleteFolder(scope, path);
        filesCache.invalidate(`folder:${scope.type}:`);
        loadContents();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errors.deleteFailed'));
      }
    },
    [scope, loadContents, t, filesCache]
  );

  const handleDownload = useCallback(
    async (filePath: string) => {
      try {
        const { url } = await getDownloadUrl(scope, filePath);
        window.open(url, '_blank');
      } catch {
        // Silent fail for download
      }
    },
    [scope]
  );

  const handleFileClick = useCallback(
    (file: FileItem) => {
      handleDownload(buildFilePath(file));
    },
    [handleDownload]
  );

  /**
   * Handle transferring remote files/folders to My Files or Company Files.
   * Downloads from remote source and uploads directly to S3.
   */
  const _handleRemoteTransfer = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (item: any, destination: 'my' | 'company') => {
      try {
        showToast({
          message: `Starting transfer of "${item.name}" to ${destination === 'my' ? 'My Files' : 'Company Files'}...`,
          variant: 'info',
        });

        const isFile = 'file_id' in item;
        const targetScope = { type: destination } as const;

        if (isFile) {
          // Download file content — OAuth providers use the oauth-files-api, Synergy uses its own endpoint
          let blob: Blob;
          if (selectedOauthProvider) {
            blob = await OAuthProvidersService.downloadFile(selectedOauthProvider, item.file_id);
          } else {
            const downloadResponse = await fetch(`/api/data-connectors/synergy/${item.file_id}/download`, {
              headers: {
                Authorization: `Bearer ${user?.tokens?.idToken || ''}`,
                'Content-Type': 'application/json',
              },
            });
            if (!downloadResponse.ok) {
              throw new Error('Failed to download remote file');
            }
            blob = await downloadResponse.blob();
          }

          // Sanitize filename — replace slashes with dashes so they don't create fake S3 folder hierarchy
          const safeName = item.name.replace(/\//g, '-');
          const file = new File([blob], safeName, {
            type: item.content_type || 'application/octet-stream',
          });

          const transferId = crypto.randomUUID();
          setRemoteTransfers((prev) => [
            ...prev,
            {
              id: transferId,
              name: `${item.name} (from Remote)`,
              progress: 0,
              status: 'uploading',
            },
          ]);

          const credentials = await getCredentials();
          const region = sessionStorage.getItem('REGION') || 'us-east-1';
          const bucket = sessionStorage.getItem('DATA_BUCKET');
          const userSub = user?.decoded_tokens?.idToken?.sub as string | undefined;

          if (!credentials || !region || !bucket || !userSub) {
            throw new Error('Upload credentials not available. Please refresh the page.');
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const s3Client = withPRM(S3Client as any, { region, credentials });

          // Upload to S3 — file stored directly at path
          const s3Key = buildS3Key(targetScope, file.name, '/', userSub);
          const command = new PutObjectCommand({
            Bucket: bucket,
            Key: s3Key,
            ContentType: file.type || 'application/octet-stream',
          });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const presignedUrl = await getSignedUrl(s3Client as any, command, { expiresIn: 3600 });

          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.upload.addEventListener('progress', (e) => {
              if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100);
                setRemoteTransfers((prev) => prev.map((u) => (u.id === transferId ? { ...u, progress: pct } : u)));
              }
            });
            xhr.addEventListener('load', () => {
              if (xhr.status >= 200 && xhr.status < 300) resolve();
              else reject(new Error(`Upload failed: ${xhr.status}`));
            });
            xhr.addEventListener('error', () => reject(new Error('Upload failed')));
            xhr.open('PUT', presignedUrl);
            xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
            xhr.send(file);
          });

          // No registerFile needed — S3 is the source of truth
          setRemoteTransfers((prev) =>
            prev.map((u) => (u.id === transferId ? { ...u, status: 'done', progress: 100 } : u))
          );

          setTimeout(() => {
            setRemoteTransfers((prev) => prev.filter((u) => u.id !== transferId));
          }, 2000);
        } else {
          // **FOLDER TRANSFER PIPELINE**
          const folderId = crypto.randomUUID();
          setRemoteTransfers((prev) => [
            ...prev,
            {
              id: folderId,
              name: `${item.name}/ (folder from Remote)`,
              progress: 50,
              status: 'uploading',
            },
          ]);

          // Create folder in destination
          await createFolder(targetScope, '/', item.name);

          setRemoteTransfers((prev) =>
            prev.map((u) => (u.id === folderId ? { ...u, progress: 100, status: 'done' } : u))
          );

          // Remove from upload list after delay
          setTimeout(() => {
            setRemoteTransfers((prev) => prev.filter((u) => u.id !== folderId));
          }, 2000);
        }

        // Step 9: Refresh destination folder contents if currently viewing
        if ((destination === 'my' && activeTab === 'my') || (destination === 'company' && activeTab === 'company')) {
          loadContents();
        }

        showToast({
          message: `Successfully transferred "${item.name}" to ${destination === 'my' ? 'My Files' : 'Company Files'}!`,
          variant: 'success',
        });
      } catch (error) {
        console.error('Transfer failed:', error);
        showToast({ message: `Failed to transfer "${item.name}": ${String(error)}`, variant: 'error' });

        // Update upload status to error
        setRemoteTransfers((prev) => prev.map((u) => (u.name.includes(item.name) ? { ...u, status: 'error' } : u)));
      }
    },
    [showToast, user?.tokens?.idToken, loadContents, activeTab, user, selectedOauthProvider]
  );

  // Analytics drill-down: navigate to standalone analytics page
  const handleViewShareDetail = useCallback(
    (uuid: string) => {
      navigate(`/analyze/shared/${uuid}`);
    },
    [navigate]
  );

  const handleExportAnalytics = useCallback(() => {
    if (!analyticsSummary?.shares) return;
    setAnalyticsExporting(true);
    try {
      const csv = exportShareAnalyticsAsCSV(analyticsSummary.shares);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `share-analytics-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } finally {
      setAnalyticsExporting(false);
    }
  }, [analyticsSummary]);

  const handleDeleteShare = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteShare(deleteTarget.uuid);
      setShares((prev) => prev.filter((s) => s.uuid !== deleteTarget.uuid));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('shared.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, t]);

  const openShareModal = useCallback((file?: FileItem) => {
    setShareModalFile(file ?? undefined);
    setShowShareModal(true);
  }, []);

  // ---------------------------------------------------------------------------
  // Context menu & new action handlers
  // ---------------------------------------------------------------------------

  const openContextMenu = useCallback((e: React.MouseEvent, target: FileOrFolder) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ show: true, position: { x: e.clientX, y: e.clientY }, target });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, show: false }));
  }, []);

  // Close context menu when navigating (tab change, folder change, etc.)
  useEffect(() => {
    closeContextMenu();
  }, [activeTab, currentPath, closeContextMenu]);

  const handleCopy = useCallback(
    async (filePath: string) => {
      try {
        await apiCopyFile(scope, filePath);
        filesCache.invalidate(`folder:${scope.type}:`);
        loadContents();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [scope, loadContents, filesCache]
  );

  /** Resolve Files paths to S3 keys for the Add to KB feature. */
  const resolveSourceKeys = useCallback(
    async (ids: string[]): Promise<string[]> => {
      const bucket = sessionStorage.getItem('DATA_BUCKET') ?? '';
      const region = sessionStorage.getItem('REGION') ?? 'us-east-1';
      const userSub = user?.decoded_tokens?.idToken?.sub ?? '';
      const allKeys: string[] = [];

      for (const id of ids) {
        const isFolder = contents?.folders.some((f) => f.path === id);
        if (isFolder) {
          const cleanPath = id.replace(/^\//, '');
          let s3Prefix: string;
          if (scope.type === 'my') {
            s3Prefix = `files/user/${userSub}/${cleanPath}`;
          } else if (scope.type === 'company') {
            s3Prefix = `files/company/${cleanPath}`;
          } else {
            s3Prefix = `files/project/${(scope as { type: 'project'; projectId: string }).projectId}/${cleanPath}`;
          }
          const keys = await listObjectsInFolder(s3Prefix, bucket, region, getCredentials);
          allKeys.push(...keys.filter((k) => !k.endsWith('/')));
        } else {
          try {
            const { key } = await getDownloadUrl(scope, id);
            allKeys.push(key);
          } catch {
            // skip failed
          }
        }
      }
      return allKeys;
    },
    [scope, contents, user, getCredentials]
  );

  const handleAddToKB = useCallback(
    async (target: FileOrFolder) => {
      if (target.kind === 'remoteFile') return; // Not supported for remote files
      const id = target.kind === 'file' ? buildFilePath(target.item) : target.item.path;
      const label = target.item.name;
      const keys = await resolveSourceKeys([id]);
      if (keys.length > 0) {
        setAddToKBTarget({ sourceKeys: keys, sourceLabel: label });
      }
    },
    [resolveSourceKeys]
  );

  const handleBulkAddToKB = useCallback(async () => {
    const ids = Array.from(fileSelection.selectedIds);
    if (ids.length === 0) return;
    const keys = await resolveSourceKeys(ids);
    if (keys.length > 0) {
      const label =
        ids.length === 1
          ? (contents?.files.find((f) => buildFilePath(f) === ids[0])?.name ?? ids[0])
          : t('addToKBModal.multipleItems', { count: ids.length });
      setAddToKBTarget({ sourceKeys: keys, sourceLabel: label });
    }
  }, [fileSelection.selectedIds, resolveSourceKeys, contents, t]);

  /** Download a remote file (OAuth or Synergy) by triggering a browser download. */
  const downloadRemoteFile = useCallback(
    async (remoteItem: RemoteFileItem) => {
      try {
        let blob: Blob;
        if (remoteItem.provider === 'oauth' && remoteItem.oauthProvider) {
          blob = await OAuthProvidersService.downloadFile(remoteItem.oauthProvider, remoteItem.file_id);
        } else {
          const resp = await fetch(`/api/data-connectors/synergy/${remoteItem.file_id}/download`, {
            headers: {
              Authorization: `Bearer ${user?.tokens?.idToken || ''}`,
              'Content-Type': 'application/json',
            },
          });
          if (!resp.ok) throw new Error('Download failed');
          blob = await resp.blob();
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = remoteItem.name;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        showToast({ message: String(err), variant: 'error' });
      }
    },
    [user?.tokens?.idToken, showToast]
  );

  /** Bulk download all selected remote files. */
  const handleRemoteBulkDownload = useCallback(async () => {
    const ids = Array.from(remoteSelection.selectedIds);
    for (const id of ids) {
      // ids are prefixed with 'oauth:' or 'synergy:'
      const [provider, fileId] = id.split(':', 2);
      let file: { name: string; file_id: string } | undefined;
      if (provider === 'oauth') {
        file = oauthFiles.find((f) => f.file_id === fileId);
      } else {
        file = synergyFiles.find((f) => f.file_id === fileId);
      }
      if (!file) continue;
      await downloadRemoteFile({
        name: file.name,
        file_id: file.file_id,
        provider: provider as 'oauth' | 'synergy',
        oauthProvider: provider === 'oauth' ? (selectedOauthProvider ?? undefined) : undefined,
      });
    }
  }, [remoteSelection.selectedIds, oauthFiles, synergyFiles, selectedOauthProvider, downloadRemoteFile]);

  /** Actions disabled for remote files (read-only backends). */
  const remoteDisabledActions: FileContextAction[] = [
    'rename',
    'makeCopy',
    'summarize',
    'share',
    'moveTo',
    'addToKB',
    'delete',
  ];
  const remoteDisabledActionsSet = useMemo(() => new Set<string>(remoteDisabledActions), []);

  const handleContextAction = useCallback(
    (action: FileContextAction) => {
      const target = contextMenu.target;
      if (!target) return;

      if (target.kind === 'file') {
        const fp = buildFilePath(target.item);
        switch (action) {
          case 'download':
            handleDownload(fp);
            break;
          case 'rename':
            setRenamingId(target.item.name);
            setRenameValue(target.item.name);
            break;
          case 'makeCopy':
            handleCopy(fp);
            break;
          case 'summarize':
            setSummarizeFile(target.item);
            break;
          case 'share':
            openShareModal(target.item);
            break;
          case 'moveTo':
            setMoveTarget({ paths: [fp], kind: 'file' });
            break;
          case 'fileInfo':
            setInfoTarget({ kind: 'file', item: target.item });
            break;
          case 'addToKB':
            handleAddToKB(target);
            break;
          case 'delete':
            handleDelete(fp);
            break;
        }
      } else if (target.kind === 'remoteFile') {
        switch (action) {
          case 'download':
            downloadRemoteFile(target.item);
            break;
          case 'fileInfo':
            setInfoTarget({
              kind: 'remoteFile',
              item: {
                name: target.item.name,
                size: target.item.size,
                modified_at: target.item.modified_at,
                content_type: target.item.content_type,
                provider:
                  target.item.oauthProvider ??
                  (target.item.provider === 'synergy' ? 'Synergy 12d' : target.item.provider),
              },
            });
            break;
          default:
            break;
        }
      } else {
        switch (action) {
          case 'download':
            // Folders don't support direct download
            break;
          case 'rename':
            // Folder rename not yet implemented inline
            break;
          case 'moveTo':
            setMoveTarget({ paths: [target.item.path], kind: 'folder' });
            break;
          case 'fileInfo':
            setInfoTarget({ kind: 'folder', item: target.item });
            break;
          case 'addToKB':
            handleAddToKB(target);
            break;
          case 'delete':
            handleDeleteFolder(target.item.path);
            break;
          default:
            break;
        }
      }
    },
    [
      contextMenu.target,
      handleDownload,
      handleDelete,
      handleDeleteFolder,
      handleCopy,
      openShareModal,
      handleAddToKB,
      downloadRemoteFile,
    ]
  );

  const handleMoveConfirm = useCallback(
    async (destinationPath: string) => {
      if (!moveTarget) return;
      try {
        for (const path of moveTarget.paths) {
          if (moveTarget.kind === 'file') {
            await apiMoveFile(scope, path, destinationPath);
          } else {
            await apiMoveFolder(scope, path, destinationPath);
          }
        }
        filesCache.invalidate(`folder:${scope.type}:`);
        loadContents();
        fileSelection.clearSelection();
        showToast({ message: t('moveModal.success'), variant: 'success' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showToast({ message: t('moveModal.error', { error: message }), variant: 'error' });
      } finally {
        setMoveTarget(null);
      }
    },
    [moveTarget, scope, loadContents, filesCache, fileSelection, showToast, t]
  );

  // Bulk actions from selection toolbar
  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(fileSelection.selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(t('confirm.deleteFile'))) return;
    try {
      for (const id of ids) {
        // IDs are file paths (parent_path + name) or folder paths
        const isFolder = contents?.folders.some((f) => f.path === id);
        if (isFolder) {
          await apiDeleteFolder(scope, id);
        } else {
          await apiDeleteFile(scope, id);
        }
      }
      filesCache.invalidate(`folder:${scope.type}:`);
      fileSelection.clearSelection();
      loadContents();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.deleteFailed'));
    }
  }, [fileSelection, contents, scope, loadContents, filesCache, t]);

  const handleBulkDownload = useCallback(async () => {
    const ids = Array.from(fileSelection.selectedIds);
    for (const id of ids) {
      const isFolder = contents?.folders.some((f) => f.path === id);
      if (!isFolder) {
        try {
          const { url } = await getDownloadUrl(scope, id);
          window.open(url, '_blank');
        } catch {
          // Silent fail per file
        }
      }
    }
  }, [fileSelection, contents, scope]);

  const handleBulkMove = useCallback(() => {
    const ids = Array.from(fileSelection.selectedIds);
    if (ids.length === 0) return;
    // Determine if selection is files or mixed
    const hasFolder = ids.some((id) => contents?.folders.some((f) => f.path === id));
    setMoveTarget({ paths: ids, kind: hasFolder ? 'folder' : 'file' });
  }, [fileSelection, contents]);

  // Update ordered IDs for shift-click when contents change
  useEffect(() => {
    if (!contents) return;
    const allIds = [...contents.folders.map((f) => f.path), ...contents.files.map((f) => buildFilePath(f))];
    fileSelection.setOrderedIds(allIds);
  }, [contents]);

  // Clear selection when navigating to a different folder
  useEffect(() => {
    fileSelection.clearSelection();
  }, [currentPath, activeTab]);

  // ---------------------------------------------------------------------------
  // Remote tab — Synergy connection + browsing logic
  // ---------------------------------------------------------------------------
  const loadSynergyStatus = useCallback(async () => {
    if (!dataConnectorsEnabled) return;
    setSynergyStatusLoading(true);
    try {
      const items = await DataConnectorsService.listStatus(numaGet);
      const synergy = items.find((i) => i.connector_id === 'synergy') ?? null;
      setSynergyStatus(synergy);
      if (synergy?.config?.server) setConnectServer(synergy.config.server);
    } catch {
      setSynergyStatus(null);
    } finally {
      setSynergyStatusLoading(false);
    }
  }, [dataConnectorsEnabled, numaGet]);

  const synergyConnected = synergyStatus?.status === 'connected';

  // Load dynamic OAuth providers list on mount (or when remote tab activates)
  const loadDynamicOAuthProviders = useCallback(async () => {
    if (!oauthEnabled) return;
    try {
      const providers = await OAuthProvidersService.listProviders();
      setEnabledOAuthProviders(providers);
    } catch {
      setEnabledOAuthProviders([]);
    }
  }, [oauthEnabled]);

  // OAuth providers status loading
  const loadOAuthProviderStatuses = useCallback(async () => {
    if (!oauthEnabled) return;

    const providers = enabledOAuthProviders.map((p) => p.id);

    // Load all provider statuses in parallel - service handles caching internally
    const loadPromises = providers.map(async (provider) => {
      setOauthStatusLoading((prev) => ({ ...prev, [provider]: true }));
      try {
        const status = await OAuthProvidersService.getConnectionStatus(provider);
        setOauthProviderStatuses((prev) => ({ ...prev, [provider]: status }));
      } catch (error) {
        console.warn(`Failed to load ${provider} status:`, error);
        setOauthProviderStatuses((prev) => ({
          ...prev,
          [provider]: { status: 'error', error_message: 'Failed to load status' },
        }));
      } finally {
        setOauthStatusLoading((prev) => ({ ...prev, [provider]: false }));
      }
    });

    await Promise.all(loadPromises);
  }, [oauthEnabled, enabledOAuthProviders]);

  useEffect(() => {
    if (activeTab === 'remote') {
      loadSynergyStatus();
      if (oauthEnabled) {
        loadDynamicOAuthProviders();
        loadOAuthProviderStatuses();
      }
    }
  }, [activeTab, loadSynergyStatus, loadDynamicOAuthProviders, loadOAuthProviderStatuses, oauthEnabled]);

  // Re-check statuses once the provider list arrives (loaded async)
  useEffect(() => {
    if (enabledOAuthProviders.length > 0) {
      loadOAuthProviderStatuses();
    }
  }, [enabledOAuthProviders, loadOAuthProviderStatuses]);

  // OAuth connection handlers
  const handleOAuthConnect = useCallback(
    async (provider: OAuthProviderType) => {
      setConnectingOauthProvider(provider);
      try {
        const result = await OAuthProvidersService.connect(provider);
        if (result.success) {
          // Reload provider status to show connected state
          await loadOAuthProviderStatuses();
          showToast({ message: `Successfully connected to ${provider}`, variant: 'success' });
        } else {
          showToast({ message: result.error || 'Connection failed', variant: 'error' });
        }
      } catch (error) {
        console.error(`OAuth connect error for ${provider}:`, error);
        showToast({ message: `Failed to connect to ${provider}`, variant: 'error' });
      } finally {
        setConnectingOauthProvider(null);
      }
    },
    [loadOAuthProviderStatuses, showToast]
  );

  const handleOAuthProviderClick = useCallback(
    async (provider: OAuthProviderType) => {
      if (oauthProviderStatuses[provider]?.status !== 'connected') {
        return;
      }

      setSelectedOauthProvider(provider);
      setOauthContentLoading(true);
      setOauthBreadcrumbs([{ label: `${provider} Files`, type: 'root', provider }]);

      try {
        const contents = await OAuthProvidersService.listContents(provider);
        setOauthFolders(contents.folders);
        setOauthFiles(contents.files);
      } catch (error) {
        console.error(`Failed to load ${provider} contents:`, error);
        showToast({ message: `Failed to load ${provider} files`, variant: 'error' });
        setOauthFolders([]);
        setOauthFiles([]);
      } finally {
        setOauthContentLoading(false);
      }
    },
    [oauthProviderStatuses, showToast]
  );

  const handleOAuthFolderClick = useCallback(
    async (folder: OAuthFolder) => {
      if (!selectedOauthProvider) return;

      remoteSelection.clearSelection();
      setOauthContentLoading(true);
      setOauthBreadcrumbs((prev) => [
        ...prev,
        { label: folder.name, type: 'folder', id: folder.folder_id, provider: selectedOauthProvider },
      ]);

      try {
        const contents = await OAuthProvidersService.listContents(selectedOauthProvider, folder.folder_id);
        setOauthFolders(contents.folders);
        setOauthFiles(contents.files);
      } catch (error) {
        console.error(`Failed to load folder contents:`, error);
        showToast({ message: 'Failed to load folder contents', variant: 'error' });
      } finally {
        setOauthContentLoading(false);
      }
    },
    [selectedOauthProvider, showToast]
  );

  const handleOAuthBreadcrumbClick = useCallback(
    async (index: number) => {
      if (!selectedOauthProvider) return;

      const newBreadcrumbs = oauthBreadcrumbs.slice(0, index + 1);
      setOauthBreadcrumbs(newBreadcrumbs);

      const targetCrumb = newBreadcrumbs[index];
      const folderId = targetCrumb.type === 'root' ? undefined : targetCrumb.id;

      setOauthContentLoading(true);
      try {
        const contents = await OAuthProvidersService.listContents(selectedOauthProvider, folderId);
        setOauthFolders(contents.folders);
        setOauthFiles(contents.files);
      } catch (error) {
        console.error(`Failed to navigate to breadcrumb:`, error);
        showToast({ message: 'Failed to navigate', variant: 'error' });
      } finally {
        setOauthContentLoading(false);
      }
    },
    [selectedOauthProvider, oauthBreadcrumbs, showToast]
  );

  const loadSynergyJobs = useCallback(async () => {
    setSynergyJobsLoading(true);
    try {
      const response = await SynergyDataConnectorService.listJobs(numaGet);
      setSynergyJobs(response.items ?? []);
    } catch {
      setSynergyJobs([]);
    } finally {
      setSynergyJobsLoading(false);
    }
  }, [numaGet]);

  useEffect(() => {
    if (activeTab === 'remote' && synergyConnected) {
      loadSynergyJobs();
    }
  }, [activeTab, synergyConnected, loadSynergyJobs]);

  const handleSynergyJobClick = useCallback(
    async (job: SynergyJob) => {
      remoteSelection.clearSelection();
      setSynergyFoldersLoading(true);
      setSynergyFolders([]);
      setSynergyFiles([]);
      setSynergyBreadcrumbs((prev) => [
        ...prev.filter((b) => b.type === 'root'),
        { label: job.name, type: 'job', id: job.job_id },
      ]);
      try {
        const folders = await SynergyDataConnectorService.listJobFolders(numaGet, job.job_id);
        setSynergyFolders(folders);
      } catch {
        setSynergyFolders([]);
      } finally {
        setSynergyFoldersLoading(false);
      }
    },
    [numaGet]
  );

  const handleSynergyFolderClick = useCallback(
    async (folder: SynergyFolder) => {
      remoteSelection.clearSelection();
      setSynergyFoldersLoading(true);
      setSynergyBreadcrumbs((prev) => [...prev, { label: folder.name, type: 'folder', id: folder.folder_id }]);
      try {
        const response = await SynergyDataConnectorService.listFolderItems(numaGet, folder.folder_id);
        setSynergyFolders(response.subfolders ?? []);
        setSynergyFiles(response.files ?? []);
      } catch {
        setSynergyFolders([]);
        setSynergyFiles([]);
      } finally {
        setSynergyFoldersLoading(false);
      }
    },
    [numaGet]
  );

  const handleSynergyBreadcrumbClick = useCallback(
    async (index: number) => {
      const crumb = synergyBreadcrumbs[index];
      if (!crumb) return;

      // Trim breadcrumbs to the clicked level
      setSynergyBreadcrumbs((prev) => prev.slice(0, index + 1));

      if (crumb.type === 'root') {
        // Back to jobs list
        setSynergyFolders([]);
        setSynergyFiles([]);
        loadSynergyJobs();
      } else if (crumb.type === 'job' && crumb.id) {
        setSynergyFoldersLoading(true);
        setSynergyFiles([]);
        try {
          const folders = await SynergyDataConnectorService.listJobFolders(numaGet, crumb.id);
          setSynergyFolders(folders);
        } catch {
          setSynergyFolders([]);
        } finally {
          setSynergyFoldersLoading(false);
        }
      } else if (crumb.type === 'folder' && crumb.id) {
        setSynergyFoldersLoading(true);
        try {
          const response = await SynergyDataConnectorService.listFolderItems(numaGet, crumb.id);
          setSynergyFolders(response.subfolders ?? []);
          setSynergyFiles(response.files ?? []);
        } catch {
          setSynergyFolders([]);
          setSynergyFiles([]);
        } finally {
          setSynergyFoldersLoading(false);
        }
      }
    },
    [synergyBreadcrumbs, numaGet, loadSynergyJobs]
  );

  // Remote tab connect modal helpers
  const loadVaultSecretsForConnect = useCallback(async () => {
    if (!vaultEnabled) return;
    setLoadingSecrets(true);
    try {
      const [secrets, cats] = await Promise.all([listSecrets(), listCategories()]);
      setVaultSecrets(secrets.filter((s) => s.type === 'bearer_token'));
      setVaultCategories(cats);
    } catch {
      setVaultSecrets([]);
    } finally {
      setLoadingSecrets(false);
    }
  }, [vaultEnabled]);

  const openConnectModal = useCallback(() => {
    setConnectError(null);
    setShowConnectModal(true);
    loadVaultSecretsForConnect();
  }, [loadVaultSecretsForConnect]);

  const handleConnectSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedSecretId) {
        setConnectError(t('remote.noCredential'));
        return;
      }
      setConnecting(true);
      setConnectError(null);
      try {
        const secretData = await getSecret(selectedSecretId);
        const token = secretData.fields?.token || '';
        if (!token) {
          setConnectError(t('remote.noCredential'));
          setConnecting(false);
          return;
        }
        const server = connectServer.trim() || secretData.fields?.endpoint?.trim() || '';
        if (!server) {
          setConnectError(t('remote.noServer'));
          setConnecting(false);
          return;
        }
        await DataConnectorsService.connect(numaPost, {
          connector_id: 'synergy',
          config: { server, access_token: token },
        });
        setShowConnectModal(false);
        setSelectedSecretId('');
        await loadSynergyStatus();
      } catch (err) {
        setConnectError(err instanceof Error ? err.message : String(err));
      } finally {
        setConnecting(false);
      }
    },
    [selectedSecretId, connectServer, numaPost, loadSynergyStatus, t]
  );

  // Auto-populate server from credential endpoint when selection changes
  useEffect(() => {
    if (!selectedSecretId) return;
    getSecret(selectedSecretId)
      .then((secret) => {
        if (secret.fields?.endpoint) {
          setConnectServer(secret.fields.endpoint);
        }
      })
      .catch(() => {});
  }, [selectedSecretId]);

  const handleVaultSecretCreatedForConnect = useCallback(
    async (payload: CreateSecretPayload) => {
      const created = await createSecret(payload);
      await loadVaultSecretsForConnect();
      setSelectedSecretId(created.name);
    },
    [loadVaultSecretsForConnect]
  );

  // --- @dnd-kit: internal file/folder move DnD ---
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const [activeDrag, setActiveDrag] = useState<{ id: string; name: string; type: 'file' | 'folder' } | null>(null);

  const handleDndDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      if (id.startsWith('file:')) {
        const fileName = id.slice(5);
        const file = contents?.files.find((f) => f.name === fileName);
        if (file) setActiveDrag({ id, name: file.name, type: 'file' });
      } else if (id.startsWith('folder:')) {
        const path = id.slice(7);
        const folder = contents?.folders.find((f) => f.path === path);
        if (folder) setActiveDrag({ id, name: folder.name, type: 'folder' });
      }
    },
    [contents]
  );

  const handleDndDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDrag(null);
      const { active, over } = event;
      if (!over) return;

      const activeId = String(active.id);
      const overId = String(over.id);

      // Parse target folder path from drop target ID
      let targetPath: string | null = null;
      if (overId.startsWith('drop:')) targetPath = overId.slice(5);
      else if (overId.startsWith('breadcrumb:')) targetPath = overId.slice(11);
      if (!targetPath) return;

      let apiCall: Promise<unknown> | null = null;

      if (activeId.startsWith('file:')) {
        const fileName = activeId.slice(5);
        // Optimistic removal — remove file from list immediately
        const removedFile = contents?.files.find((f) => f.name === fileName);
        if (removedFile) {
          setContents((prev) => (prev ? { ...prev, files: prev.files.filter((f) => f.name !== fileName) } : prev));
        }
        const fp = removedFile ? buildFilePath(removedFile) : `${currentPath}${fileName}`;
        apiCall = apiMoveFile(scope, fp, targetPath).catch((err) => {
          // Rollback: restore the file on failure
          if (removedFile) {
            setContents((prev) => (prev ? { ...prev, files: [...prev.files, removedFile] } : prev));
          }
          throw err;
        });
      } else if (activeId.startsWith('folder:')) {
        const folderPath = activeId.slice(7);
        // Prevent circular move
        if (targetPath.startsWith(folderPath)) return;
        // Prevent no-op (moving to same parent)
        const folderParent = folderPath.split('/').filter(Boolean).slice(0, -1);
        const parentPath = folderParent.length === 0 ? '/' : `/${folderParent.join('/')}/`;
        if (targetPath === parentPath) return;
        // Optimistic removal — remove folder from list immediately
        const removedFolder = contents?.folders.find((f) => f.path === folderPath);
        if (removedFolder) {
          setContents((prev) =>
            prev ? { ...prev, folders: prev.folders.filter((f) => f.path !== folderPath) } : prev
          );
        }
        apiCall = apiMoveFolder(scope, folderPath, targetPath).catch((err) => {
          // Rollback: restore the folder on failure
          if (removedFolder) {
            setContents((prev) => (prev ? { ...prev, folders: [...prev.folders, removedFolder] } : prev));
          }
          throw err;
        });
      }

      if (apiCall) {
        apiCall
          .then(() => {
            // Invalidate all cached folders for this scope so navigating to the
            // target folder shows the moved item immediately.
            filesCache.invalidate(`folder:${scope.type}:`);
            return loadContents();
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            setError(t('errors.moveFailed', { error: message }));
          });
      }
    },
    [scope, contents, loadContents, t, filesCache]
  );

  // Whether DnD should be enabled (not in shared or project-list views)
  const dndEnabled = useMemo(
    () => !isSharedTab && !(activeTab === 'projects' && !selectedProjectId),
    [isSharedTab, activeTab, selectedProjectId]
  );

  // Drag-and-drop handlers for file UPLOAD (disabled for shared tab)
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (isSharedTab) return;
      e.preventDefault();
      dragCounter.current++;
      if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
    },
    [isSharedTab]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (isSharedTab) return;
      e.preventDefault();
      dragCounter.current--;
      if (dragCounter.current === 0) setIsDragging(false);
    },
    [isSharedTab]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (isSharedTab) return;
      e.preventDefault();
    },
    [isSharedTab]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (isSharedTab) return;
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        setDroppedFiles(Array.from(e.dataTransfer.files));
        setShowUploadModal(true);
      }
    },
    [isSharedTab]
  );

  const breadcrumbs =
    currentPath === '/'
      ? [{ label: '/', path: '/' }]
      : [
          { label: '/', path: '/' },
          ...currentPath
            .split('/')
            .filter(Boolean)
            .map((segment, i, arr) => ({
              label: segment,
              path: `/${arr.slice(0, i + 1).join('/')}/`,
            })),
        ];

  const getScopeLabel = (tab: TabType | null) => {
    switch (tab) {
      case 'projects':
        return t('tabs.projects');
      case 'company':
        return t('tabs.company');
      case 'shared':
        return t('shared.rootLabel');
      case 'remote':
        return t('remote.rootLabel');
      case 'my':
        return t('tabs.myFiles');
      default:
        return t('title');
    }
  };

  // Root-level scope folders shown when no scope is selected (/files)
  const ROOT_SCOPES: { key: TabType; icon: string; labelKey: string }[] = [
    { key: 'projects', icon: 'bi bi-layers', labelKey: 'tabs.projects' },
    { key: 'company', icon: 'bi bi-building', labelKey: 'tabs.company' },
    { key: 'my', icon: 'bi bi-person', labelKey: 'tabs.myFiles' },
    ...(sharingEnabled || dropZonesEnabled
      ? [{ key: 'shared' as TabType, icon: 'bi bi-share', labelKey: 'tabs.shared' }]
      : []),
    ...(dataConnectorsEnabled ? [{ key: 'remote' as TabType, icon: 'bi bi-cloud', labelKey: 'tabs.remote' }] : []),
  ];

  const viewToggle = (
    <div className="btn-group btn-group-sm view-toggle">
      <button
        className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-outline-secondary'}`}
        onClick={() => setViewMode('list')}
        title={t('toolbar.listView')}
      >
        <i className="bi bi-list-ul" />
      </button>
      <button
        className={`btn ${viewMode === 'grid' ? 'btn-primary' : 'btn-outline-secondary'}`}
        onClick={() => setViewMode('grid')}
        title={t('toolbar.gridView')}
      >
        <i className="bi bi-grid-3x3-gap" />
      </button>
      <button
        className={`btn ${viewMode === 'gallery' ? 'btn-primary' : 'btn-outline-secondary'}`}
        onClick={() => setViewMode('gallery')}
        title={t('toolbar.galleryView')}
      >
        <i className="bi bi-card-image" />
      </button>
    </div>
  );

  // Root scope view — show scope folders
  if (activeTab === null) {
    return (
      <div className="files-page">
        <div className="files-toolbar">
          <div className="breadcrumb-path">
            <span className="breadcrumb-segment">{t('title')}</span>
          </div>
          {viewToggle}
        </div>
        <div className="files-content">
          {viewMode === 'grid' ? (
            <div className="file-grid">
              {ROOT_SCOPES.map((s) => (
                <div key={s.key} className="file-card" onClick={() => handleTabChange(s.key)}>
                  <i className={`${s.icon} file-card-icon folder-icon`} />
                  <div className="file-card-name">{t(s.labelKey)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="file-list">
              <div className="file-list-header">
                <span>{t('headers.name')}</span>
                <span />
                <span />
                <span />
              </div>
              {ROOT_SCOPES.map((s) => (
                <div key={s.key} className="file-row" onClick={() => handleTabChange(s.key)}>
                  <div className="file-name">
                    <i className={`${s.icon} file-icon folder-icon`} />
                    <span>{t(s.labelKey)}</span>
                  </div>
                  <div className="file-size" />
                  <div className="file-status" />
                  <div className="file-actions" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Project list view
  if (activeTab === 'projects' && !selectedProjectId) {
    return (
      <div className="files-page">
        <div className="files-toolbar">
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={() => navigate('/files')}
            title={t('toolbar.up')}
          >
            <i className="bi bi-arrow-up" /> {t('toolbar.up')}
          </button>
          <div className="breadcrumb-path">
            <span className="breadcrumb-segment" onClick={() => navigate('/files')}>
              {t('title')}
            </span>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-segment">{t('tabs.projects')}</span>
          </div>
        </div>
        <div className="files-content p-4">
          {projects.length === 0 ? (
            <div className="files-empty">
              <i className="bi bi-layers" />
              <h5>{t('projects.empty')}</h5>
              <p>{t('projects.createFirst')}</p>
            </div>
          ) : (
            <div className="file-list">
              {projects.map((project) => (
                <div
                  key={project.project_id}
                  className="file-row"
                  onClick={() => handleProjectSelect(project.project_id)}
                >
                  <div className="file-name">
                    <i className="bi bi-layers file-icon folder-icon" />
                    <span>{project.project_name}</span>
                  </div>
                  <div className="file-size" />
                  <div className="file-status">
                    <span className="badge bg-secondary-subtle text-secondary">{project.role}</span>
                  </div>
                  <div className="file-actions" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Shared tab view
  if (isSharedTab) {
    return (
      <div className="files-page">
        <div className="files-toolbar">
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={() => navigate('/files')}
            title={t('toolbar.up')}
          >
            <i className="bi bi-arrow-up" /> {t('toolbar.up')}
          </button>
          <div className="breadcrumb-path">
            <span className="breadcrumb-segment" onClick={() => navigate('/files')}>
              {t('title')}
            </span>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-segment">{t('shared.rootLabel')}</span>
          </div>
          {viewToggle}
          <div className="d-flex gap-2">
            {sharingEnabled && (
              <button className="btn btn-sm btn-outline-primary" onClick={() => openShareModal()}>
                <i className="bi bi-plus-lg" /> {t('shared.createShare')}
              </button>
            )}
            {dropZonesEnabled && (
              <button className="btn btn-sm btn-outline-success" onClick={() => setShowDropZoneModal(true)}>
                <i className="bi bi-cloud-upload" /> {t('dropzones.create')}
              </button>
            )}
          </div>
        </div>

        <div className="files-content">
          {error && (
            <div className="alert alert-danger m-3 mb-0" role="alert">
              {error}
              <button type="button" className="btn-close float-end" onClick={() => setError(null)} />
            </div>
          )}

          {loading ? (
            <div className="files-empty">
              <div className="spinner-border text-secondary" />
            </div>
          ) : shares.length === 0 ? (
            <div className="files-empty">
              <i className="bi bi-share" />
              <h5>{t('shared.empty')}</h5>
              <p>{t('shared.emptyMessage')}</p>
            </div>
          ) : viewMode === 'list' ? (
            <div className="file-list file-list--shared">
              <div className="file-list-header">
                <span>{t('headers.name')}</span>
                <span>{t('headers.type')}</span>
                <span>{t('shared.created')}</span>
                <span>{t('headers.status')}</span>
                <span />
              </div>
              {shares.map((share) => {
                const isDropzone = share.share_type === 'dropzone' || !!share.folder_path;
                return (
                  <div key={share.uuid} className="file-row" onClick={() => navigate(`/analyze/shared/${share.uuid}`)}>
                    <div className="file-name">
                      <i className={`bi ${isDropzone ? 'bi-cloud-upload' : 'bi-file-earmark-text'} file-icon`} />
                      <div className="d-flex flex-column">
                        <span>{share.name}</span>
                        {share.description && (
                          <small className="text-muted text-truncate" style={{ maxWidth: '300px' }}>
                            {share.description}
                          </small>
                        )}
                      </div>
                    </div>
                    <div className="file-type">
                      <span
                        className={`badge ${isDropzone ? 'bg-success-subtle text-success' : 'bg-primary-subtle text-primary'}`}
                      >
                        {isDropzone ? t('dropzones.title') : t('shared.shareFile')}
                      </span>
                    </div>
                    <div className="file-created">
                      <span className="text-muted small">{formatShareDate(share.created_at)}</span>
                    </div>
                    <div className="file-status">
                      <ShareStatusBadge status={share.status} expiresAt={share.expires_at} t={t} />
                    </div>
                    <div className="file-actions">
                      {isDropzone && share.passcode && (
                        <button
                          className="btn-icon"
                          title={t('dropzones.copyPasscode')}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(share.passcode!);
                          }}
                        >
                          <i className="bi bi-key" />
                        </button>
                      )}
                      <button
                        className="btn-icon"
                        title={t('shared.viewAnalytics')}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/analyze/shared/${share.uuid}`);
                        }}
                      >
                        <i className="bi bi-bar-chart" />
                      </button>
                      <button
                        className="btn-icon"
                        title={t('shared.viewShare')}
                        onClick={(e) => {
                          e.stopPropagation();
                          const path = isDropzone ? 'dropzone' : 'shared';
                          window.open(`/${path}/${share.uuid}`, '_blank');
                        }}
                      >
                        <i className="bi bi-box-arrow-up-right" />
                      </button>
                      <button
                        className="btn-icon text-danger"
                        title={t('shared.delete')}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(share);
                        }}
                      >
                        <i className="bi bi-trash" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : viewMode === 'gallery' ? (
            <ShareAnalyticsDashboard
              analyticsSummary={analyticsSummary}
              analyticsLoading={analyticsLoading}
              analyticsExporting={analyticsExporting}
              onViewDetail={handleViewShareDetail}
              onExport={handleExportAnalytics}
              t={tShared}
            />
          ) : (
            <div className="file-grid">
              {shares.map((share) => {
                const isDropzone = share.share_type === 'dropzone' || !!share.folder_path;
                return (
                  <div key={share.uuid} className="file-card" onClick={() => navigate(`/analyze/shared/${share.uuid}`)}>
                    <i className={`bi ${isDropzone ? 'bi-cloud-upload' : 'bi-file-earmark-text'} file-card-icon`} />
                    <div className="file-card-name" title={share.name}>
                      {share.name}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <CreateShareModal
          show={showShareModal}
          onHide={() => setShowShareModal(false)}
          onCreated={loadContents}
          preSelectedFile={shareModalFile}
          scope={scope}
          currentPath={currentPath}
        />

        <CreateShareModal
          show={showDropZoneModal}
          onHide={() => setShowDropZoneModal(false)}
          onCreated={loadContents}
          mode="dropzone"
        />

        {/* Delete confirmation dialog */}
        {deleteTarget && (
          <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">
                    {deleteTarget.share_type === 'dropzone'
                      ? t('shared.deleteDropzoneConfirmTitle')
                      : t('shared.deleteConfirmTitle')}
                  </h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => setDeleteTarget(null)}
                    disabled={deleting}
                  />
                </div>
                <div className="modal-body">
                  <p>
                    {deleteTarget.share_type === 'dropzone'
                      ? t('shared.deleteDropzoneConfirmMessage', { name: deleteTarget.name })
                      : t('shared.deleteConfirmMessage', { name: deleteTarget.name })}
                  </p>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                    {t('upload.cancel')}
                  </button>
                  <button className="btn btn-danger" onClick={handleDeleteShare} disabled={deleting}>
                    {deleting ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
                        {t('shared.deleting')}
                      </>
                    ) : (
                      <>
                        <i className="bi bi-trash me-1" />
                        {t('shared.delete')}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Remote tab view — Multiple providers (Synergy + OAuth)
  if (activeTab === 'remote') {
    const isAtRootLevel = !selectedOauthProvider && synergyBreadcrumbs.length === 1;
    const isAtJobsLevel = synergyBreadcrumbs.length === 2 && synergyBreadcrumbs[1]?.type === 'job';
    const isInOAuthProvider = selectedOauthProvider !== null;
    return (
      <div className="files-page">
        <div className="files-toolbar">
          {/* Up button */}
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={() => {
              if (isInOAuthProvider && oauthBreadcrumbs.length > 1) {
                handleOAuthBreadcrumbClick(oauthBreadcrumbs.length - 2);
              } else if (synergyConnected && synergyBreadcrumbs.length > 2) {
                handleSynergyBreadcrumbClick(synergyBreadcrumbs.length - 2);
              } else if (isInOAuthProvider || (!isAtRootLevel && synergyConnected)) {
                setSelectedOauthProvider(null);
                setSynergyBreadcrumbs([{ label: t('remote.rootLabel'), type: 'root' }]);
                setOauthBreadcrumbs([]);
              } else {
                navigate('/files');
              }
            }}
            title={t('toolbar.up')}
          >
            <i className="bi bi-arrow-up" /> {t('toolbar.up')}
          </button>

          <div className="breadcrumb-path">
            <span className="breadcrumb-segment" onClick={() => navigate('/files')}>
              {t('title')}
            </span>
            <span className="breadcrumb-separator">/</span>
            {isAtRootLevel ? (
              <span className="breadcrumb-segment">{t('remote.rootLabel')}</span>
            ) : isInOAuthProvider ? (
              oauthBreadcrumbs.map((crumb, i) => (
                <span key={i}>
                  {i > 0 && <span className="breadcrumb-separator">/</span>}
                  <span
                    className={`breadcrumb-segment${i === oauthBreadcrumbs.length - 1 ? ' breadcrumb-segment--active' : ''}`}
                    onClick={i < oauthBreadcrumbs.length - 1 ? () => handleOAuthBreadcrumbClick(i) : undefined}
                    style={i < oauthBreadcrumbs.length - 1 ? { cursor: 'pointer' } : undefined}
                  >
                    {crumb.label}
                  </span>
                </span>
              ))
            ) : synergyConnected ? (
              synergyBreadcrumbs.map((crumb, i) => (
                <span key={i}>
                  {i > 0 && <span className="breadcrumb-separator">/</span>}
                  <span
                    className={`breadcrumb-segment${i === synergyBreadcrumbs.length - 1 ? ' breadcrumb-segment--active' : ''}`}
                    onClick={i < synergyBreadcrumbs.length - 1 ? () => handleSynergyBreadcrumbClick(i) : undefined}
                    style={i < synergyBreadcrumbs.length - 1 ? { cursor: 'pointer' } : undefined}
                  >
                    {crumb.label}
                  </span>
                </span>
              ))
            ) : (
              <span className="breadcrumb-segment breadcrumb-segment--active">{t('remote.rootLabel')}</span>
            )}
          </div>
          {viewToggle}
        </div>

        <div className="files-content p-4">
          {isAtRootLevel ? (
            /* Root level: Show all providers — respects list/grid view mode */
            viewMode === 'grid' || viewMode === 'gallery' ? (
              /* Grid/Gallery: Show providers as cards */
              <div className="file-grid">
                {/* Synergy Provider Card */}
                <div
                  className="file-card"
                  style={{ cursor: synergyConnected ? 'pointer' : 'default' }}
                  onClick={
                    synergyConnected
                      ? () => {
                          setSelectedOauthProvider(null);
                          setSynergyBreadcrumbs([
                            { label: t('remote.rootLabel'), type: 'root' },
                            { label: 'Synergy Jobs', type: 'job' },
                          ]);
                          loadSynergyJobs();
                        }
                      : undefined
                  }
                >
                  <SynergyIcon />
                  <div className="file-card-name" title={t('remote.synergyName')}>
                    {t('remote.synergyName')}
                  </div>
                  <div className="file-card-meta">
                    {synergyStatusLoading ? (
                      <span className="spinner-border spinner-border-sm text-secondary" />
                    ) : synergyConnected ? (
                      <span className="text-success small">
                        <i className="bi bi-check-circle me-1" />
                        {t('remote.connected')}
                      </span>
                    ) : (
                      <button
                        className="btn btn-sm btn-primary text-nowrap"
                        onClick={(e) => {
                          e.stopPropagation();
                          openConnectModal();
                        }}
                      >
                        <i className="bi bi-plug me-1" />
                        {t('remote.connectSynergy')}
                      </button>
                    )}
                  </div>
                </div>

                {/* OAuth Provider Cards */}
                {oauthEnabled &&
                  enabledOAuthProviders.map((provider) => {
                    const status = oauthProviderStatuses[provider.id] ?? { status: 'disconnected' as const };
                    const loading = oauthStatusLoading[provider.id];
                    const connecting = connectingOauthProvider === provider.id;
                    const connected = status.status === 'connected';

                    return (
                      <div
                        key={provider.id}
                        className="file-card"
                        style={{ cursor: connected ? 'pointer' : 'default' }}
                        onClick={connected ? () => handleOAuthProviderClick(provider.id) : undefined}
                      >
                        <i className={`${provider.icon} file-card-icon`} style={{ color: '#0d6efd' }} />
                        <div className="file-card-name" title={provider.display_name}>
                          {provider.display_name}
                        </div>
                        <div className="file-card-meta">
                          {loading ? (
                            <span className="spinner-border spinner-border-sm text-secondary" />
                          ) : connected ? (
                            <span className="text-success small">
                              <i className="bi bi-check-circle me-1" />
                              {t('remote.connected')}
                            </span>
                          ) : (
                            <button
                              className="btn btn-sm btn-primary text-nowrap"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOAuthConnect(provider.id);
                              }}
                              disabled={connecting}
                            >
                              {connecting ? (
                                <>
                                  <span className="spinner-border spinner-border-sm me-1" />
                                  {t('remote.connecting')}
                                </>
                              ) : (
                                <>
                                  <i className="bi bi-plug me-1" />
                                  {t('remote.connect')}
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              /* List view: Show providers as rows */
              <div className="file-list">
                <div className="file-list-header">
                  <span>{t('headers.name')}</span>
                  <span>{t('headers.status')}</span>
                  <span />
                  <span />
                </div>

                {/* Synergy Provider */}
                <div
                  className="file-row"
                  style={{ cursor: synergyConnected ? 'pointer' : 'default' }}
                  onClick={
                    synergyConnected
                      ? () => {
                          setSelectedOauthProvider(null);
                          setSynergyBreadcrumbs([
                            { label: t('remote.rootLabel'), type: 'root' },
                            { label: 'Synergy Jobs', type: 'job' },
                          ]);
                          loadSynergyJobs();
                        }
                      : undefined
                  }
                >
                  <div className="file-name d-flex align-items-center gap-2">
                    <SynergyIcon />
                    <span className="fw-semibold">{t('remote.synergyName')}</span>
                    {synergyStatusLoading ? (
                      <span className="spinner-border spinner-border-sm text-secondary ms-2" />
                    ) : !synergyConnected ? (
                      <button
                        className="btn btn-sm btn-primary ms-2 text-nowrap"
                        onClick={(e) => {
                          e.stopPropagation();
                          openConnectModal();
                        }}
                      >
                        <i className="bi bi-plug me-1" />
                        {t('remote.connectSynergy')}
                      </button>
                    ) : null}
                  </div>
                  <div className="file-status">
                    {synergyConnected && (
                      <span className="text-success small">
                        <i className="bi bi-check-circle me-1" />
                        {t('remote.connected')}
                      </span>
                    )}
                  </div>
                  <div className="file-size" />
                  <div className="file-actions" />
                </div>

                {/* OAuth Providers */}
                {oauthEnabled &&
                  enabledOAuthProviders.map((provider) => {
                    const status = oauthProviderStatuses[provider.id] ?? { status: 'disconnected' as const };
                    const loading = oauthStatusLoading[provider.id];
                    const connecting = connectingOauthProvider === provider.id;
                    const connected = status.status === 'connected';

                    return (
                      <div
                        key={provider.id}
                        className="file-row"
                        style={{ cursor: connected ? 'pointer' : 'default' }}
                        onClick={connected ? () => handleOAuthProviderClick(provider.id) : undefined}
                      >
                        <div className="file-name d-flex align-items-center gap-2">
                          <i className={`${provider.icon} file-icon`} style={{ fontSize: '20px', color: '#0d6efd' }} />
                          <span className="fw-semibold">{provider.display_name}</span>
                          {loading ? (
                            <span className="spinner-border spinner-border-sm text-secondary ms-2" />
                          ) : !connected ? (
                            <button
                              className="btn btn-sm btn-primary ms-2 text-nowrap"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOAuthConnect(provider.id);
                              }}
                              disabled={connecting}
                            >
                              {connecting ? (
                                <>
                                  <span className="spinner-border spinner-border-sm me-1" />
                                  {t('remote.connecting')}
                                </>
                              ) : (
                                <>
                                  <i className="bi bi-plug me-1" />
                                  {t('remote.connect')}
                                </>
                              )}
                            </button>
                          ) : null}
                        </div>
                        <div className="file-status">
                          {connected && (
                            <span className="text-success small">
                              <i className="bi bi-check-circle me-1" />
                              {t('remote.connected')}
                              {status.user_email && <div className="text-muted">{status.user_email}</div>}
                            </span>
                          )}
                          {status.status === 'error' && (
                            <span className="text-danger small">
                              <i className="bi bi-exclamation-circle me-1" />
                              {t('remote.connectionError')}
                            </span>
                          )}
                        </div>
                        <div className="file-size" />
                        <div className="file-actions" />
                      </div>
                    );
                  })}
              </div>
            )
          ) : isInOAuthProvider ? (
            /* OAuth Provider File Browser */
            oauthContentLoading ? (
              <div className="files-empty">
                <div className="spinner-border text-secondary" />
                <p className="mt-2 text-muted">
                  {t('remote.loadingProviderFiles', { provider: selectedOauthProvider })}
                </p>
              </div>
            ) : oauthFolders.length === 0 && oauthFiles.length === 0 ? (
              <div className="files-empty">
                <i className="bi bi-folder2-open" />
                <h5>{t('remote.noFilesFound')}</h5>
                <p>{t('remote.folderEmpty')}</p>
              </div>
            ) : viewMode === 'list' ? (
              <div className="file-list">
                <FileSelectionToolbar
                  count={remoteSelection.selectedIds.size}
                  hasFileSelected={true}
                  sharingEnabled={sharingEnabled}
                  disabledActions={remoteDisabledActionsSet}
                  disabledTooltip={t('actions.remoteNotAvailable')}
                  onSummarize={() => {
                    /* no-op for remote */
                  }}
                  onShare={() => {
                    /* no-op for remote */
                  }}
                  onDownload={handleRemoteBulkDownload}
                  onMove={() => {
                    /* no-op for remote */
                  }}
                  onAddToKB={() => {
                    /* no-op for remote */
                  }}
                  onDelete={() => {
                    /* no-op for remote */
                  }}
                  onClear={() => remoteSelection.clearSelection()}
                />
                <div className="file-list-header">
                  <span>
                    <input
                      type="checkbox"
                      className="form-check-input me-2"
                      checked={oauthFiles.length > 0 && remoteSelection.selectedIds.size === oauthFiles.length}
                      onChange={() => {
                        const allIds = oauthFiles.map((f) => `oauth:${f.file_id}`);
                        if (remoteSelection.selectedIds.size === allIds.length) {
                          remoteSelection.clearSelection();
                        } else {
                          remoteSelection.selectAll(allIds);
                        }
                      }}
                    />
                    {t('headers.name')}
                  </span>
                  <span>{t('headers.size')}</span>
                  <span>{t('headers.modified')}</span>
                  <span />
                </div>
                {oauthFolders.map((folder) => {
                  const remoteFolderItem: RemoteFileItem = {
                    name: folder.name,
                    file_id: folder.folder_id,
                    provider: 'oauth',
                    oauthProvider: selectedOauthProvider ?? undefined,
                  };
                  return (
                    <div
                      key={folder.folder_id}
                      className="file-row"
                      onClick={() => handleOAuthFolderClick(folder)}
                      onContextMenu={(e) => openContextMenu(e, { kind: 'remoteFile', item: remoteFolderItem })}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="file-name">
                        <i className="bi bi-folder file-icon folder-icon" />
                        <span>{folder.name}</span>
                      </div>
                      <div className="file-size" />
                      <div className="file-status" />
                      <FileRowActions
                        kind="folder"
                        sharingEnabled={sharingEnabled}
                        disabledActions={remoteDisabledActionsSet}
                        disabledTooltip={t('actions.remoteNotAvailable')}
                        onKebab={(e) => openContextMenu(e, { kind: 'remoteFile', item: remoteFolderItem })}
                      />
                    </div>
                  );
                })}
                {oauthFiles.map((file) => {
                  const remoteId = `oauth:${file.file_id}`;
                  const isSelected = remoteSelection.isSelected(remoteId);
                  const remoteItem: RemoteFileItem = {
                    name: file.name,
                    file_id: file.file_id,
                    size: file.size,
                    modified_at: file.modified_at,
                    content_type: file.content_type,
                    provider: 'oauth',
                    oauthProvider: selectedOauthProvider ?? undefined,
                  };
                  return (
                    <div
                      key={file.file_id}
                      className={`file-row${isSelected ? ' file-row--selected' : ''}`}
                      style={{ cursor: 'default' }}
                      onContextMenu={(e) => openContextMenu(e, { kind: 'remoteFile', item: remoteItem })}
                    >
                      <div className="file-name">
                        <input
                          type="checkbox"
                          className="form-check-input me-2"
                          checked={isSelected}
                          onChange={() => {}}
                          onClick={(e) => {
                            e.stopPropagation();
                            remoteSelection.toggleSelect(remoteId, e.shiftKey);
                          }}
                        />
                        <i className={`${getFileIcon(file.name)} file-icon`} />
                        <span>{file.name}</span>
                      </div>
                      <div className="file-size">{file.size ? formatFileSize(file.size) : ''}</div>
                      <div className="file-status">
                        {file.modified_at && (
                          <span className="text-muted small">{new Date(file.modified_at).toLocaleDateString()}</span>
                        )}
                      </div>
                      <FileRowActions
                        kind="file"
                        sharingEnabled={sharingEnabled}
                        disabledActions={remoteDisabledActionsSet}
                        disabledTooltip={t('actions.remoteNotAvailable')}
                        onDownload={() => downloadRemoteFile(remoteItem)}
                        onKebab={(e) => openContextMenu(e, { kind: 'remoteFile', item: remoteItem })}
                      />
                    </div>
                  );
                })}
              </div>
            ) : viewMode === 'grid' ? (
              <div className="file-grid">
                {oauthFolders.map((folder) => (
                  <div key={folder.folder_id} className="file-card" onClick={() => handleOAuthFolderClick(folder)}>
                    <i className="bi bi-folder file-card-icon folder-icon" />
                    <div className="file-card-name" title={folder.name}>
                      {folder.name}
                    </div>
                  </div>
                ))}
                {oauthFiles.map((file) => {
                  const remoteItem: RemoteFileItem = {
                    name: file.name,
                    file_id: file.file_id,
                    size: file.size,
                    modified_at: file.modified_at,
                    content_type: file.content_type,
                    provider: 'oauth',
                    oauthProvider: selectedOauthProvider ?? undefined,
                  };
                  return (
                    <div
                      key={file.file_id}
                      className="file-card"
                      onContextMenu={(e) => openContextMenu(e, { kind: 'remoteFile', item: remoteItem })}
                    >
                      <i className={`${getFileIcon(file.name)} file-card-icon`} />
                      <div className="file-card-name" title={file.name}>
                        {file.name}
                      </div>
                      <div className="file-card-meta">{file.size ? formatFileSize(file.size) : ''}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Gallery view for OAuth files — basic previews by type */
              <div className="file-grid">
                {oauthFolders.map((folder) => (
                  <div
                    key={folder.folder_id}
                    className="file-card"
                    onClick={() => handleOAuthFolderClick(folder)}
                    style={{ cursor: 'pointer' }}
                  >
                    <i className="bi bi-folder file-card-icon folder-icon" />
                    <div className="file-card-name" title={folder.name}>
                      {folder.name}
                    </div>
                  </div>
                ))}
                {oauthFiles.map((file) => {
                  const ext = file.name?.split('.').pop()?.toLowerCase() || '';
                  const isImage =
                    file.content_type?.startsWith('image/') ||
                    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
                  const isText =
                    file.content_type?.startsWith('text/') ||
                    ['txt', 'md', 'log', 'csv', 'json', 'xml', 'yaml', 'yml'].includes(ext);
                  const remoteItem: RemoteFileItem = {
                    name: file.name,
                    file_id: file.file_id,
                    size: file.size,
                    modified_at: file.modified_at,
                    content_type: file.content_type,
                    provider: 'oauth',
                    oauthProvider: selectedOauthProvider ?? undefined,
                  };

                  return (
                    <div
                      key={file.file_id}
                      className="file-card"
                      onContextMenu={(e) => openContextMenu(e, { kind: 'remoteFile', item: remoteItem })}
                    >
                      {isImage ? (
                        <i className="bi bi-image file-card-icon" style={{ color: '#198754', fontSize: '2.5rem' }} />
                      ) : isText ? (
                        <i
                          className="bi bi-file-earmark-text file-card-icon"
                          style={{ color: '#0d6efd', fontSize: '2.5rem' }}
                        />
                      ) : (
                        <i className={`${getFileIcon(file.name)} file-card-icon`} />
                      )}
                      <div className="file-card-name" title={file.name}>
                        {file.name}
                      </div>
                      <div className="file-card-meta">{file.size ? formatFileSize(file.size) : ''}</div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            /* Connected — show jobs or folder browser */
            <>
              {isAtJobsLevel ? (
                /* Jobs listing */
                synergyJobsLoading ? (
                  <div className="files-empty">
                    <div className="spinner-border text-secondary" />
                    <p className="mt-2 text-muted">{t('remote.loadingJobs')}</p>
                  </div>
                ) : synergyJobs.length === 0 ? (
                  <div className="files-empty">
                    <i className="bi bi-folder2-open" />
                    <h5>{t('remote.noJobs')}</h5>
                  </div>
                ) : viewMode === 'list' ? (
                  <div className="file-list">
                    <div className="file-list-header">
                      <span>{t('headers.name')}</span>
                      <span>{t('headers.status')}</span>
                      <span />
                      <span />
                    </div>
                    {synergyJobs.map((job) => {
                      const remoteJobItem: RemoteFileItem = {
                        name: job.name,
                        file_id: job.job_id,
                        provider: 'synergy',
                      };
                      return (
                        <div
                          key={job.job_id}
                          className="file-row"
                          onClick={() => handleSynergyJobClick(job)}
                          onContextMenu={(e) => openContextMenu(e, { kind: 'remoteFile', item: remoteJobItem })}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="file-name">
                            <i className="bi bi-layers file-icon folder-icon" />
                            <span>{job.name}</span>
                          </div>
                          <div className="file-status">
                            {job.no_of_folders != null && (
                              <span className="text-muted small">
                                {t('remote.subfolders', { count: job.no_of_folders })}
                              </span>
                            )}
                          </div>
                          <div className="file-size" />
                          <FileRowActions
                            kind="folder"
                            sharingEnabled={sharingEnabled}
                            disabledActions={remoteDisabledActionsSet}
                            disabledTooltip={t('actions.remoteNotAvailable')}
                            onKebab={(e) => openContextMenu(e, { kind: 'remoteFile', item: remoteJobItem })}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : viewMode === 'grid' ? (
                  <div className="file-grid">
                    {synergyJobs.map((job) => (
                      <div key={job.job_id} className="file-card" onClick={() => handleSynergyJobClick(job)}>
                        <i className="bi bi-layers file-card-icon folder-icon" />
                        <div className="file-card-name" title={job.name}>
                          {job.name}
                        </div>
                        <div className="file-card-meta">
                          {job.no_of_folders != null && (
                            <span className="text-muted small">
                              {t('remote.subfolders', { count: job.no_of_folders })}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Gallery view for remote jobs — show as cards (jobs are containers) */
                  <div className="file-grid">
                    {synergyJobs.map((job) => (
                      <div
                        key={job.job_id}
                        className="file-card"
                        onClick={() => handleSynergyJobClick(job)}
                        style={{ cursor: 'pointer' }}
                      >
                        <i className="bi bi-layers file-card-icon folder-icon" />
                        <div className="file-card-name" title={job.name}>
                          {job.name}
                        </div>
                        <div className="file-card-meta">
                          {job.no_of_folders != null && (
                            <span className="text-muted small">
                              {t('remote.subfolders', { count: job.no_of_folders })}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : /* Folder browser inside a job */
              synergyFoldersLoading ? (
                <div className="files-empty">
                  <div className="spinner-border text-secondary" />
                  <p className="mt-2 text-muted">{t('remote.loadingFolders')}</p>
                </div>
              ) : synergyFolders.length === 0 && synergyFiles.length === 0 ? (
                <div className="files-empty">
                  <i className="bi bi-folder2-open" />
                  <h5>{t('remote.noItems')}</h5>
                </div>
              ) : viewMode === 'list' ? (
                <div className="file-list">
                  <FileSelectionToolbar
                    count={remoteSelection.selectedIds.size}
                    hasFileSelected={true}
                    sharingEnabled={sharingEnabled}
                    disabledActions={remoteDisabledActionsSet}
                    disabledTooltip={t('actions.remoteNotAvailable')}
                    onSummarize={() => {
                      /* no-op for remote */
                    }}
                    onShare={() => {
                      /* no-op for remote */
                    }}
                    onDownload={handleRemoteBulkDownload}
                    onMove={() => {
                      /* no-op for remote */
                    }}
                    onAddToKB={() => {
                      /* no-op for remote */
                    }}
                    onDelete={() => {
                      /* no-op for remote */
                    }}
                    onClear={() => remoteSelection.clearSelection()}
                  />
                  <div className="file-list-header">
                    <span>
                      <input
                        type="checkbox"
                        className="form-check-input me-2"
                        checked={synergyFiles.length > 0 && remoteSelection.selectedIds.size === synergyFiles.length}
                        onChange={() => {
                          const allIds = synergyFiles.map((f) => `synergy:${f.file_id}`);
                          if (remoteSelection.selectedIds.size === allIds.length) {
                            remoteSelection.clearSelection();
                          } else {
                            remoteSelection.selectAll(allIds);
                          }
                        }}
                      />
                      {t('headers.name')}
                    </span>
                    <span>{t('headers.size')}</span>
                    <span>{t('headers.status')}</span>
                    <span />
                  </div>
                  {synergyFolders.map((folder) => {
                    const remoteFolderItem: RemoteFileItem = {
                      name: folder.name,
                      file_id: folder.folder_id,
                      provider: 'synergy',
                    };
                    return (
                      <div
                        key={folder.folder_id}
                        className="file-row"
                        onClick={() => handleSynergyFolderClick(folder)}
                        onContextMenu={(e) => openContextMenu(e, { kind: 'remoteFile', item: remoteFolderItem })}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="file-name">
                          <i className="bi bi-folder file-icon folder-icon" />
                          <span>{folder.name}</span>
                        </div>
                        <div className="file-size" />
                        <div className="file-status">
                          {folder.has_subfolders && folder.no_of_subfolders != null && (
                            <span className="text-muted small">
                              {t('remote.subfolders', { count: folder.no_of_subfolders })}
                            </span>
                          )}
                        </div>
                        <FileRowActions
                          kind="folder"
                          sharingEnabled={sharingEnabled}
                          disabledActions={remoteDisabledActionsSet}
                          disabledTooltip={t('actions.remoteNotAvailable')}
                          onKebab={(e) => openContextMenu(e, { kind: 'remoteFile', item: remoteFolderItem })}
                        />
                      </div>
                    );
                  })}
                  {synergyFiles.map((file) => {
                    const remoteId = `synergy:${file.file_id}`;
                    const isSelected = remoteSelection.isSelected(remoteId);
                    const remoteItem: RemoteFileItem = {
                      name: file.name,
                      file_id: file.file_id,
                      size: file.size ?? undefined,
                      modified_at: file.modified_at,
                      content_type: file.content_type,
                      provider: 'synergy',
                    };
                    return (
                      <div
                        key={file.file_id}
                        className={`file-row${isSelected ? ' file-row--selected' : ''}`}
                        onContextMenu={(e) => openContextMenu(e, { kind: 'remoteFile', item: remoteItem })}
                      >
                        <div className="file-name">
                          <input
                            type="checkbox"
                            className="form-check-input me-2"
                            checked={isSelected}
                            onChange={() => {}}
                            onClick={(e) => {
                              e.stopPropagation();
                              remoteSelection.toggleSelect(remoteId, e.shiftKey);
                            }}
                          />
                          <i className={`${getFileIcon(file.name)} file-icon`} />
                          <span>{file.name}</span>
                        </div>
                        <div className="file-size">{file.size != null ? formatFileSize(file.size) : ''}</div>
                        <div className="file-status">
                          {file.modified_at && (
                            <span className="text-muted small">{new Date(file.modified_at).toLocaleDateString()}</span>
                          )}
                        </div>
                        <FileRowActions
                          kind="file"
                          sharingEnabled={sharingEnabled}
                          disabledActions={remoteDisabledActionsSet}
                          disabledTooltip={t('actions.remoteNotAvailable')}
                          onDownload={() => downloadRemoteFile(remoteItem)}
                          onKebab={(e) => openContextMenu(e, { kind: 'remoteFile', item: remoteItem })}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : viewMode === 'grid' ? (
                <div className="file-grid">
                  {synergyFolders.map((folder) => (
                    <div key={folder.folder_id} className="file-card" onClick={() => handleSynergyFolderClick(folder)}>
                      <i className="bi bi-folder file-card-icon folder-icon" />
                      <div className="file-card-name" title={folder.name}>
                        {folder.name}
                      </div>
                      <div className="file-card-meta">
                        {folder.has_subfolders && folder.no_of_subfolders != null && (
                          <span className="text-muted small">
                            {t('remote.subfolders', { count: folder.no_of_subfolders })}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {synergyFiles.map((file) => {
                    const remoteItem: RemoteFileItem = {
                      name: file.name,
                      file_id: file.file_id,
                      size: file.size ?? undefined,
                      modified_at: file.modified_at,
                      content_type: file.content_type,
                      provider: 'synergy',
                    };
                    return (
                      <div
                        key={file.file_id}
                        className="file-card"
                        onContextMenu={(e) => openContextMenu(e, { kind: 'remoteFile', item: remoteItem })}
                      >
                        <i className={`${getFileIcon(file.name)} file-card-icon`} />
                        <div className="file-card-name" title={file.name}>
                          {file.name}
                        </div>
                        <div className="file-card-meta">{file.size != null ? formatFileSize(file.size) : ''}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Gallery view for Synergy files — basic previews by type */
                <div className="file-grid">
                  {synergyFolders.map((folder) => (
                    <div
                      key={folder.folder_id}
                      className="file-card"
                      onClick={() => handleSynergyFolderClick(folder)}
                      style={{ cursor: 'pointer' }}
                    >
                      <i className="bi bi-folder file-card-icon folder-icon" />
                      <div className="file-card-name" title={folder.name}>
                        {folder.name}
                      </div>
                    </div>
                  ))}
                  {synergyFiles.map((file) => {
                    const ext = file.name?.split('.').pop()?.toLowerCase() || '';
                    const isImage =
                      file.content_type?.startsWith('image/') ||
                      ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
                    const isText =
                      file.content_type?.startsWith('text/') ||
                      ['txt', 'md', 'log', 'csv', 'json', 'xml', 'yaml', 'yml'].includes(ext);
                    const remoteItem: RemoteFileItem = {
                      name: file.name,
                      file_id: file.file_id,
                      size: file.size ?? undefined,
                      modified_at: file.modified_at,
                      content_type: file.content_type,
                      provider: 'synergy',
                    };

                    return (
                      <div
                        key={file.file_id}
                        className="file-card"
                        onContextMenu={(e) => openContextMenu(e, { kind: 'remoteFile', item: remoteItem })}
                      >
                        {isImage ? (
                          <i className="bi bi-image file-card-icon" style={{ color: '#198754', fontSize: '2.5rem' }} />
                        ) : isText ? (
                          <i
                            className="bi bi-file-earmark-text file-card-icon"
                            style={{ color: '#0d6efd', fontSize: '2.5rem' }}
                          />
                        ) : (
                          <i className={`${getFileIcon(file.name)} file-card-icon`} />
                        )}
                        <div className="file-card-name" title={file.name}>
                          {file.name}
                        </div>
                        <div className="file-card-meta">{file.size != null ? formatFileSize(file.size) : ''}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Synergy connect modal */}
        {showConnectModal && (
          <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{t('remote.connectSynergy')}</h5>
                  <button type="button" className="btn-close" onClick={() => setShowConnectModal(false)} />
                </div>
                <form onSubmit={handleConnectSubmit}>
                  <div className="modal-body">
                    {connectError && <div className="alert alert-danger py-2">{connectError}</div>}
                    <div className="mb-3">
                      <label className="form-label small fw-semibold">{t('remote.serverLabel')}</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="https://synergy.myserver.com:8080"
                        value={connectServer}
                        onChange={(e) => setConnectServer(e.target.value)}
                        required
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label small fw-semibold">
                        <i className="bi bi-shield-lock-fill me-1 text-primary" />
                        {t('remote.credentialLabel')}
                      </label>
                      {loadingSecrets ? (
                        <div className="text-muted small py-2">
                          <span className="spinner-border spinner-border-sm me-2" />
                          {t('remote.loadingCredentials')}
                        </div>
                      ) : (
                        <>
                          <div className="d-flex gap-2">
                            <select
                              className="form-select flex-grow-1"
                              value={selectedSecretId}
                              onChange={(e) => setSelectedSecretId(e.target.value)}
                              required
                            >
                              <option value="">{t('remote.credentialPlaceholder')}</option>
                              {vaultSecrets.map((secret) => (
                                <option key={secret.name} value={secret.name}>
                                  {secret.name}
                                  {secret.description ? ` \u2014 ${secret.description}` : ''}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="btn btn-outline-primary btn-sm text-nowrap"
                              onClick={() => setShowVaultForm(true)}
                            >
                              <i className="bi bi-shield-plus me-1" />
                              {t('remote.createCredential')}
                            </button>
                          </div>
                          <div className="form-text text-muted">{t('remote.credentialHint')}</div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowConnectModal(false)}>
                      {t('remote.cancel')}
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={connecting || !selectedSecretId}>
                      {connecting ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" /> {t('remote.connecting')}
                        </>
                      ) : (
                        <>
                          <i className="bi bi-plug me-2" />
                          {t('remote.connectSynergy')}
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        <VaultSecretForm
          show={showVaultForm}
          onHide={() => setShowVaultForm(false)}
          onSubmit={handleVaultSecretCreatedForConnect}
          categories={vaultCategories}
          defaultType="bearer_token"
        />
      </div>
    );
  }

  return (
    <div
      className="files-page"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <DndContext
        sensors={dndEnabled ? sensors : undefined}
        onDragStart={handleDndDragStart}
        onDragEnd={handleDndDragEnd}
      >
        <div className="files-toolbar">
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={
              activeTab === 'projects' && selectedProjectId && currentPath === '/'
                ? () => {
                    setContents(null);
                    navigate('/files/projects');
                  }
                : navigateUp
            }
            title={t('toolbar.up')}
          >
            <i className="bi bi-arrow-up" /> {t('toolbar.up')}
          </button>

          <div className="breadcrumb-path">
            <span className="breadcrumb-segment" onClick={() => navigate('/files')}>
              {t('title')}
            </span>
            <span className="breadcrumb-separator">/</span>
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.path}>
                {i > 0 && <span className="breadcrumb-separator">/</span>}
                {dndEnabled ? (
                  <DroppableBreadcrumb
                    path={crumb.path}
                    className="breadcrumb-segment"
                    onClick={() => navigateToFolder(crumb.path)}
                  >
                    {crumb.label === '/' ? getScopeLabel(activeTab) : crumb.label}
                  </DroppableBreadcrumb>
                ) : (
                  <span className="breadcrumb-segment" onClick={() => navigateToFolder(crumb.path)}>
                    {crumb.label === '/' ? getScopeLabel(activeTab) : crumb.label}
                  </span>
                )}
              </span>
            ))}
          </div>

          {viewToggle}

          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={() => setNewFolderName('')}
            title={t('toolbar.newFolder')}
          >
            <i className="bi bi-folder-plus" /> {t('toolbar.newFolder')}
          </button>

          <button
            className="btn btn-sm btn-outline-primary"
            onClick={() => setShowUploadModal(true)}
            title={t('toolbar.upload')}
          >
            <i className="bi bi-cloud-upload" /> {t('toolbar.upload')}
          </button>
        </div>

        <div className="files-content">
          {isDragging && (
            <div className="drop-overlay">
              <div className="drop-message">
                <i className="bi bi-cloud-upload" />
                <span>{t('dropZone.message')}</span>
              </div>
            </div>
          )}

          {error && (
            <div className="alert alert-danger m-3 mb-0" role="alert">
              {error}
              <button type="button" className="btn-close float-end" onClick={() => setError(null)} />
            </div>
          )}

          {newFolderName !== null && (
            <div className="new-folder-input">
              <i className="bi bi-folder-plus" />
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder={t('toolbar.newFolder')}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') setNewFolderName(null);
                }}
                autoFocus
              />
              <button className="btn btn-sm btn-primary" onClick={handleCreateFolder}>
                <i className="bi bi-check" />
              </button>
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setNewFolderName(null)}>
                <i className="bi bi-x" />
              </button>
            </div>
          )}

          {loading && !contents ? (
            <div className="files-empty">
              <div className="spinner-border text-secondary" />
            </div>
          ) : viewMode === 'grid' || viewMode === 'gallery' ? (
            <div className="file-grid">
              {/* Folders as cards (droppable + draggable) */}
              {contents?.folders.map((folder) =>
                dndEnabled ? (
                  <DroppableFolder
                    key={folder.path}
                    dragId={`folder:${folder.path}`}
                    dropId={`drop:${folder.path}`}
                    className="file-card"
                    onClick={() => navigateToFolder(folder.path)}
                  >
                    <i className={`bi bi-folder-fill file-card-icon folder-icon`} />
                    <div className="file-card-name" title={folder.name}>
                      {folder.name}
                    </div>
                  </DroppableFolder>
                ) : (
                  <div key={folder.path} className="file-card" onClick={() => navigateToFolder(folder.path)}>
                    <i className={`bi bi-folder-fill file-card-icon folder-icon`} />
                    <div className="file-card-name" title={folder.name}>
                      {folder.name}
                    </div>
                  </div>
                )
              )}

              {/* Files as cards (draggable) */}
              {contents?.files.map((file) =>
                dndEnabled ? (
                  <DraggableItem
                    key={file.name}
                    id={`file:${file.name}`}
                    className="file-card"
                    onClick={() => handleFileClick(file)}
                  >
                    <i className={`${getFileIcon(file.name)} file-card-icon`} />
                    <div className="file-card-name" title={file.name}>
                      {file.name}
                    </div>
                    <div className="file-card-meta">{formatFileSize(file.size_bytes)}</div>
                  </DraggableItem>
                ) : (
                  <div key={file.name} className="file-card" onClick={() => handleFileClick(file)}>
                    <i className={`${getFileIcon(file.name)} file-card-icon`} />
                    <div className="file-card-name" title={file.name}>
                      {file.name}
                    </div>
                    <div className="file-card-meta">{formatFileSize(file.size_bytes)}</div>
                  </div>
                )
              )}

              {/* Empty state for regular folders */}
              {!loading && contents && contents.folders.length === 0 && contents.files.length === 0 && (
                <div className="files-empty files-empty-grid">
                  <i className="bi bi-folder2-open" />
                  <h5>{t('empty.title')}</h5>
                  <p>{t('empty.message')}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="file-list">
              <FileSelectionToolbar
                count={fileSelection.selectedIds.size}
                hasFileSelected={Array.from(fileSelection.selectedIds).some(
                  (id) => !contents?.folders.some((f) => f.path === id)
                )}
                sharingEnabled={sharingEnabled}
                onSummarize={() => {
                  const id = Array.from(fileSelection.selectedIds)[0];
                  const file = contents?.files.find((f) => buildFilePath(f) === id);
                  if (file) setSummarizeFile(file);
                }}
                onShare={() => {
                  const id = Array.from(fileSelection.selectedIds)[0];
                  const file = contents?.files.find((f) => buildFilePath(f) === id);
                  if (file) openShareModal(file);
                }}
                onDownload={handleBulkDownload}
                onMove={handleBulkMove}
                onAddToKB={handleBulkAddToKB}
                onDelete={handleBulkDelete}
                onClear={() => fileSelection.clearSelection()}
              />
              <div className="file-list-header">
                <span>
                  <input
                    type="checkbox"
                    className="form-check-input me-2"
                    checked={
                      contents !== null &&
                      contents.folders.length + contents.files.length > 0 &&
                      fileSelection.selectedIds.size === contents.folders.length + contents.files.length
                    }
                    onChange={() => {
                      if (!contents) return;
                      const allIds = [
                        ...contents.folders.map((f) => f.path),
                        ...contents.files.map((f) => buildFilePath(f)),
                      ];
                      if (fileSelection.selectedIds.size === allIds.length) {
                        fileSelection.clearSelection();
                      } else {
                        fileSelection.selectAll(allIds);
                      }
                    }}
                  />
                  {t('headers.name')}
                </span>
                <span>{t('headers.size')}</span>
                <span>{t('headers.status')}</span>
                <span />
              </div>

              {/* Folders (droppable + draggable) */}
              {contents?.folders.map((folder) => {
                const isSelected = fileSelection.isSelected(folder.path);
                const folderContent = (
                  <>
                    <div className="file-name">
                      <input
                        type="checkbox"
                        className="form-check-input me-2"
                        checked={isSelected}
                        onChange={() => {}}
                        onClick={(e) => {
                          e.stopPropagation();
                          fileSelection.toggleSelect(folder.path, e.shiftKey);
                        }}
                      />
                      <i className={`bi bi-folder-fill file-icon folder-icon`} />
                      <span>{folder.name}</span>
                    </div>
                    <div className="file-size" />
                    <div className="file-status" />
                    <FileRowActions
                      kind="folder"
                      sharingEnabled={sharingEnabled}
                      onRename={() => {
                        /* folder rename via context menu */
                      }}
                      onMove={() => setMoveTarget({ paths: [folder.path], kind: 'folder' })}
                      onAddToKB={() => handleAddToKB({ kind: 'folder', item: folder })}
                      onDelete={() => handleDeleteFolder(folder.path)}
                      onKebab={(e) => openContextMenu(e, { kind: 'folder', item: folder })}
                    />
                  </>
                );
                return dndEnabled ? (
                  <DroppableFolder
                    key={folder.path}
                    dragId={`folder:${folder.path}`}
                    dropId={`drop:${folder.path}`}
                    className={`file-row${isSelected ? ' file-row--selected' : ''}`}
                    onClick={() => navigateToFolder(folder.path)}
                    onContextMenu={(e: React.MouseEvent) => openContextMenu(e, { kind: 'folder', item: folder })}
                  >
                    {folderContent}
                  </DroppableFolder>
                ) : (
                  <div
                    key={folder.path}
                    className={`file-row${isSelected ? ' file-row--selected' : ''}`}
                    onClick={() => navigateToFolder(folder.path)}
                    onContextMenu={(e) => openContextMenu(e, { kind: 'folder', item: folder })}
                  >
                    {folderContent}
                  </div>
                );
              })}

              {/* Files (draggable) */}
              {contents?.files.map((file) => {
                const fp = buildFilePath(file);
                const isSelected = fileSelection.isSelected(fp);
                const fileContent = (
                  <>
                    <div className="file-name">
                      <input
                        type="checkbox"
                        className="form-check-input me-2"
                        checked={isSelected}
                        onChange={() => {}}
                        onClick={(e) => {
                          e.stopPropagation();
                          fileSelection.toggleSelect(fp, e.shiftKey);
                        }}
                      />
                      {renamingId === file.name ? (
                        <div className="rename-input" onClick={(e) => e.stopPropagation()}>
                          <i className={`${getFileIcon(file.name)} file-icon`} />
                          <input
                            type="text"
                            className="form-control form-control-sm"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename(fp);
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            autoFocus
                          />
                          <button className="btn btn-sm btn-primary" onClick={() => handleRename(fp)}>
                            <i className="bi bi-check" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <i className={`${getFileIcon(file.name)} file-icon`} />
                          <span>{file.name}</span>
                        </>
                      )}
                    </div>
                    <div className="file-size">{formatFileSize(file.size_bytes)}</div>
                    <div className="file-status">
                      <span className="text-muted">{new Date(file.last_modified).toLocaleDateString()}</span>
                    </div>
                    <FileRowActions
                      kind="file"
                      sharingEnabled={sharingEnabled}
                      onSummarize={() => setSummarizeFile(file)}
                      onShare={() => openShareModal(file)}
                      onDownload={() => handleDownload(fp)}
                      onMove={() => setMoveTarget({ paths: [fp], kind: 'file' })}
                      onAddToKB={() => handleAddToKB({ kind: 'file', item: file })}
                      onDelete={() => handleDelete(fp)}
                      onKebab={(e) => openContextMenu(e, { kind: 'file', item: file })}
                    />
                  </>
                );
                return dndEnabled ? (
                  <DraggableItem
                    key={file.name}
                    id={`file:${file.name}`}
                    className={`file-row${isSelected ? ' file-row--selected' : ''}`}
                    onClick={() => handleFileClick(file)}
                  >
                    {fileContent}
                  </DraggableItem>
                ) : (
                  <div
                    key={file.name}
                    className={`file-row${isSelected ? ' file-row--selected' : ''}`}
                    onClick={() => handleFileClick(file)}
                    onContextMenu={(e) => openContextMenu(e, { kind: 'file', item: file })}
                  >
                    {fileContent}
                  </div>
                );
              })}

              {/* Empty state */}
              {!loading && contents && contents.folders.length === 0 && contents.files.length === 0 && (
                <div className="files-empty">
                  <i className="bi bi-folder2-open" />
                  <h5>{t('empty.title')}</h5>
                  <p>{t('empty.message')}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDrag && <DragPreview name={activeDrag.name} type={activeDrag.type} />}
        </DragOverlay>
      </DndContext>

      <CreateShareModal
        show={showShareModal}
        onHide={() => setShowShareModal(false)}
        onCreated={loadContents}
        preSelectedFile={shareModalFile}
        scope={scope}
        currentPath={currentPath}
      />

      <CreateShareModal
        show={showDropZoneModal}
        onHide={() => setShowDropZoneModal(false)}
        onCreated={loadContents}
        mode="dropzone"
      />

      <FilesUploadModal
        show={showUploadModal}
        onHide={() => {
          setShowUploadModal(false);
          setDroppedFiles([]);
        }}
        scope={scope}
        currentPath={currentPath}
        onUploadComplete={() => {
          loadContents();
          filesCache.invalidate(`folder:${scope.type}:`);
        }}
        initialFiles={droppedFiles.length > 0 ? droppedFiles : undefined}
      />

      <FileContextMenu
        show={contextMenu.show}
        position={contextMenu.position}
        target={contextMenu.target}
        sharingEnabled={sharingEnabled}
        disabledActions={contextMenu.target?.kind === 'remoteFile' ? remoteDisabledActions : undefined}
        disabledTooltip={contextMenu.target?.kind === 'remoteFile' ? t('actions.remoteNotAvailable') : undefined}
        onClose={closeContextMenu}
        onAction={handleContextAction}
      />

      <MoveFileModal
        show={moveTarget !== null}
        scope={scope}
        onClose={() => setMoveTarget(null)}
        onMove={handleMoveConfirm}
      />

      <AddToKBModal
        show={addToKBTarget !== null}
        sourceKeys={addToKBTarget?.sourceKeys ?? []}
        sourceLabel={addToKBTarget?.sourceLabel ?? ''}
        onClose={() => setAddToKBTarget(null)}
        onSuccess={() => {
          setAddToKBTarget(null);
          fileSelection.clearSelection();
          showToast({ message: t('addToKBModal.success'), variant: 'success' });
        }}
      />

      <FileInfoPanel target={infoTarget} onClose={() => setInfoTarget(null)} />

      <FileSummarizePanel
        file={summarizeFile}
        scope={scope}
        currentPath={currentPath}
        onClose={() => setSummarizeFile(null)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Analytics dashboard (rendered inline in shared tab gallery view)
// ---------------------------------------------------------------------------

const ShareAnalyticsDashboard = ({
  analyticsSummary,
  analyticsLoading,
  analyticsExporting,
  onViewDetail,
  onExport,
  t,
}: {
  analyticsSummary: import('../hooks/useShareAnalytics').ShareAnalyticsSummary | null;
  analyticsLoading: boolean;
  analyticsExporting: boolean;
  onViewDetail: (uuid: string) => void;
  onExport: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) => {
  // Loading state
  if (analyticsLoading || !analyticsSummary) {
    return (
      <div className="files-empty">
        <div className="spinner-border text-secondary" />
      </div>
    );
  }

  // No shares
  if (analyticsSummary.shares.length === 0) {
    return (
      <div className="files-empty">
        <i className="bi bi-bar-chart" />
        <h5>{t('analytics.noShares')}</h5>
      </div>
    );
  }

  // Overview: all shares
  const metrics = calculateShareMetrics(analyticsSummary.shares);

  return (
    <div className="p-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h5 className="mb-0">{t('analytics.title')}</h5>
        <button className="btn btn-sm btn-outline-primary" onClick={onExport} disabled={analyticsExporting}>
          <i className="bi bi-download me-1" />
          {t('analytics.exportButton')}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="row g-3 mb-4">
        <div className="col">
          <div className="card h-100">
            <div className="card-body text-center">
              <div className="text-muted small mb-1">{t('analytics.totalMessages')}</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{metrics.totalMessages}</div>
              <small className="text-muted">{t('analytics.messages')}</small>
            </div>
          </div>
        </div>
        <div className="col">
          <div className="card h-100">
            <div className="card-body text-center">
              <div className="text-muted small mb-1">{t('analytics.totalUploads')}</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{metrics.totalUploads}</div>
              <small className="text-muted">{t('analytics.uploads')}</small>
            </div>
          </div>
        </div>
        <div className="col">
          <div className="card h-100">
            <div className="card-body text-center">
              <div className="text-muted small mb-1">{t('analytics.totalViews')}</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{metrics.totalViews}</div>
              <small className="text-muted">{t('analytics.views')}</small>
            </div>
          </div>
        </div>
        <div className="col">
          <div className="card h-100">
            <div className="card-body text-center">
              <div className="text-muted small mb-1">{t('analytics.activeShares')}</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{metrics.activeShares}</div>
              <small className="text-muted">/ {metrics.totalShares}</small>
            </div>
          </div>
        </div>
        <div className="col">
          <div className="card h-100">
            <div className="card-body text-center">
              <div className="text-muted small mb-1">{t('analytics.avgPerShare')}</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{metrics.avgMessagesPerShare}</div>
              <small className="text-muted">{t('analytics.messages')}</small>
            </div>
          </div>
        </div>
      </div>

      {/* Top Share */}
      {metrics.topShare && (
        <div className="card mb-4">
          <div className="card-header">
            <h6 className="mb-0">{t('analytics.topShare')}</h6>
          </div>
          <div className="card-body">
            <div className="d-flex align-items-center gap-3">
              <i className="bi bi-trophy text-warning" style={{ fontSize: '2rem' }} />
              <div>
                <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{metrics.topShare.name}</div>
                <small className="text-muted">
                  {t('analytics.topShareMessages', { count: metrics.topShare.messages })}
                </small>
              </div>
              <button
                className="btn btn-outline-primary btn-sm ms-auto"
                onClick={() => onViewDetail(metrics.topShare!.uuid)}
              >
                {t('analytics.viewDetail')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Breakdown Table */}
      <div className="card">
        <div className="card-header">
          <h6 className="mb-0">{t('analytics.shareBreakdown')}</h6>
        </div>
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>{t('analytics.name')}</th>
                  <th>{t('analytics.type')}</th>
                  <th>{t('analytics.messages')}</th>
                  <th>{t('analytics.uploads')}</th>
                  <th>{t('analytics.totalViews')}</th>
                  <th>{t('analytics.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {metrics.shareBreakdown.map((share) => (
                  <tr key={share.uuid}>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <i
                          className={`bi ${share.shareType === 'dropzone' ? 'bi-cloud-upload' : 'bi-file-earmark-text'}`}
                        />
                        <div>
                          <div className="fw-semibold">{share.name}</div>
                          {share.description && <small className="text-muted">{share.description}</small>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`badge ${share.shareType === 'dropzone' ? 'bg-success-subtle text-success' : 'bg-primary-subtle text-primary'}`}
                      >
                        {share.shareType === 'dropzone' ? t('analytics.dropzoneType') : t('analytics.shareType')}
                      </span>
                    </td>
                    <td>
                      <span className="fw-semibold">{share.callCount}</span>
                    </td>
                    <td>
                      {share.shareType === 'dropzone' ? share.uploadCount : <span className="text-muted">&mdash;</span>}
                    </td>
                    <td>{share.viewCount}</td>
                    <td>
                      <span className={`badge bg-${share.isExpired ? 'secondary' : 'success'}`}>
                        {share.isExpired ? t('analytics.expired') : t('analytics.active')}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-outline-primary btn-sm" onClick={() => onViewDetail(share.uuid)}>
                        {t('analytics.viewDetail')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small className="text-muted">{t('analytics.shareBreakdownDescription')}</small>
        </div>
      </div>
    </div>
  );
};

const ShareStatusBadge = ({
  status,
  expiresAt,
  t,
}: {
  status: string;
  expiresAt?: string | null;
  t: (key: string) => string;
}) => {
  const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;
  if (isExpired) {
    return <span className="badge bg-warning-subtle text-warning">{t('shared.expired')}</span>;
  }
  switch (status) {
    case 'ready':
      return <span className="badge bg-success-subtle text-success">{t('status.ready')}</span>;
    case 'processing':
      return <span className="badge bg-primary-subtle text-primary">{t('status.processing')}</span>;
    case 'error':
      return <span className="badge bg-danger-subtle text-danger">{t('status.error')}</span>;
    default:
      return <span className="badge bg-success-subtle text-success">{t('status.ready')}</span>;
  }
};

function formatShareDate(timestamp: number | null): string {
  if (!timestamp) return '';
  const ts = timestamp > 9999999999 ? timestamp : timestamp * 1000;
  return new Date(ts).toLocaleDateString();
}

export default { FilesPage };
