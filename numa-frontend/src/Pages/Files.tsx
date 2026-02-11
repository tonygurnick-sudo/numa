import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
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
import { withPRM } from '../utils/prmUtils';
import {
  listFolder,
  createFolder,
  registerFile,
  getDownloadUrl,
  renameFile as apiRenameFile,
  moveFile as apiMoveFile,
  moveFolder as apiMoveFolder,
  deleteFile as apiDeleteFile,
  deleteFolder as apiDeleteFolder,
  buildS3Key,
  getFileIcon,
  formatFileSize,
  listProjects,
  listOrphans,
  getOrphanDownloadUrl,
  adoptOrphan,
  listCompanyOrphans,
  getCompanyOrphanDownloadUrl,
  adoptCompanyOrphan,
} from '../Services/filesService';
import { listMyShares } from '../Services/sharedChatService';
import type { ShareListItem } from '../Services/sharedChatService';
import type { FileScope, FolderContents, ProjectSummary, OrphanItem } from '../Services/filesService';
import { CreateShareModal } from '../Components/Files/CreateShareModal';
import { useFilesCache } from './useFilesCache';
import './Files.scss';

type TabType = 'projects' | 'company' | 'my' | 'shared';
type ViewMode = 'list' | 'grid';

interface UploadingFile {
  id: string;
  name: string;
  progress: number;
  status: 'uploading' | 'registering' | 'done' | 'error';
}

const getScope = (tab: TabType, projectId?: string): FileScope => {
  switch (tab) {
    case 'my':
      return { type: 'my' };
    case 'company':
      return { type: 'company' };
    case 'projects':
      return projectId ? { type: 'project', projectId } : { type: 'my' };
    case 'shared':
      return { type: 'my' }; // Not used for shared tab, but satisfies type
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
  children,
}: {
  dragId: string;
  dropId: string;
  className: string;
  onClick?: () => void;
  children: React.ReactNode;
}) => {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: dragId });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: dropId });
  const ref = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );
  return (
    <div
      ref={ref}
      className={`${className}${isDragging ? ' is-dragging' : ''}${isOver ? ' drop-target-active' : ''}`}
      onClick={onClick}
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
  const { getCredentials, user } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<TabType>('my');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [currentPath, setCurrentPath] = useState('/');
  const [contents, setContents] = useState<FolderContents | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadingFile[]>([]);
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [shares, setShares] = useState<ShareListItem[]>([]);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareModalFile, setShareModalFile] = useState<{ fileId: string; name: string; scope: FileScope } | undefined>(
    undefined,
  );
  const [isOrphansView, setIsOrphansView] = useState(false);
  const [orphans, setOrphans] = useState<OrphanItem[]>([]);
  const [orphanCursor, setOrphanCursor] = useState<string | undefined>();
  const [orphanLoading, setOrphanLoading] = useState(false);
  const [adoptingKey, setAdoptingKey] = useState<string | null>(null);

  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isSharedTab = activeTab === 'shared';
  const scope = useMemo(() => getScope(activeTab, selectedProjectId ?? undefined), [activeTab, selectedProjectId]);
  const filesCache = useFilesCache();

  // Build a cache key for the current folder view
  const cacheKey = useMemo(() => {
    const scopeId = scope.type === 'project' ? scope.projectId : '';
    return `folder:${scope.type}:${scopeId}:${currentPath}`;
  }, [scope, currentPath]);

  const loadContents = useCallback(async () => {
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
            (f, i) =>
              f.file_id === cached.files[i]?.file_id &&
              f.name === cached.files[i]?.name &&
              f.extraction_status === cached.files[i]?.extraction_status,
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

  // Poll for extraction status updates
  useEffect(() => {
    if (isSharedTab) return;
    const hasProcessing = contents?.files.some(
      (f) => f.extraction_status === 'processing' || f.extraction_status === 'queued',
    );

    if (hasProcessing) {
      pollIntervalRef.current = setInterval(loadContents, 5000);
    }

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [contents, loadContents, isSharedTab]);

  const navigateToFolder = useCallback((path: string) => {
    setCurrentPath(path);
  }, []);

  const navigateUp = useCallback(() => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.length === 0 ? '/' : `/${parts.join('/')}/`);
  }, [currentPath]);

  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
    setCurrentPath('/');
    setContents(null);
    setError(null);
    setSelectedProjectId(null);
    setShares([]);
    setIsOrphansView(false);
    setOrphans([]);
    setOrphanCursor(undefined);
  }, []);

  const handleProjectSelect = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setCurrentPath('/');
  }, []);

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
    async (fileId: string) => {
      if (!renameValue.trim()) {
        setRenamingId(null);
        return;
      }
      try {
        await apiRenameFile(scope, fileId, renameValue.trim());
        setRenamingId(null);
        filesCache.invalidate(`folder:${scope.type}:`);
        loadContents();
      } catch {
        setError(t('errors.renameFailed'));
      }
    },
    [scope, renameValue, loadContents, t, filesCache],
  );

  const handleDelete = useCallback(
    async (fileId: string) => {
      if (!window.confirm(t('confirm.deleteFile'))) return;
      try {
        await apiDeleteFile(scope, fileId);
        filesCache.invalidate(`folder:${scope.type}:`);
        loadContents();
      } catch {
        setError(t('errors.deleteFailed'));
      }
    },
    [scope, loadContents, t, filesCache],
  );

  const handleDeleteFolder = useCallback(
    async (path: string) => {
      if (!window.confirm(t('confirm.deleteFolder'))) return;
      try {
        await apiDeleteFolder(scope, path);
        filesCache.invalidate(`folder:${scope.type}:`);
        loadContents();
      } catch {
        setError(t('errors.deleteFailed'));
      }
    },
    [scope, loadContents, t, filesCache],
  );

  const handleDownload = useCallback(
    async (fileId: string) => {
      try {
        const { url } = await getDownloadUrl(scope, fileId);
        window.open(url, '_blank');
      } catch {
        // Silent fail for download
      }
    },
    [scope],
  );

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      const region = sessionStorage.getItem('REGION') || 'us-east-1';
      const bucket = sessionStorage.getItem('OUTPUTS_BUCKET_NAME');
      const userSub = user?.decoded_tokens?.idToken?.sub as string | undefined;

      if (!bucket || !userSub) {
        console.error('Upload failed: missing bucket or userSub', { bucket, userSub });
        setError('Upload configuration not available. Please refresh the page.');
        return;
      }

      let credentials;
      try {
        credentials = await getCredentials();
      } catch (err) {
        console.error('Failed to get upload credentials:', err);
        setError('Failed to get upload credentials. Please refresh the page.');
        return;
      }
      if (!credentials) {
        console.error('Upload credentials are null');
        setError('Upload credentials not available. Please refresh the page.');
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s3Client = withPRM(S3Client as any, { region, credentials });

      // Process files with concurrency limit of 3
      const concurrencyLimit = 3;
      const queue = [...files];
      const active: Promise<void>[] = [];

      const processFile = async (file: File) => {
        const fileId = crypto.randomUUID();
        const uploadEntry: UploadingFile = {
          id: fileId,
          name: file.name,
          progress: 0,
          status: 'uploading',
        };
        setUploads((prev) => [...prev, uploadEntry]);

        try {
          // Upload to S3
          const s3Key = buildS3Key(scope, fileId, file.name, userSub);
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
                setUploads((prev) => prev.map((u) => (u.id === fileId ? { ...u, progress: pct } : u)));
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

          // Register with backend
          setUploads((prev) => prev.map((u) => (u.id === fileId ? { ...u, status: 'registering' } : u)));
          await registerFile(scope, fileId, file.name, currentPath, file.type || 'application/octet-stream', file.size);

          setUploads((prev) => prev.map((u) => (u.id === fileId ? { ...u, status: 'done', progress: 100 } : u)));

          // Remove completed upload after a short delay
          setTimeout(() => {
            setUploads((prev) => prev.filter((u) => u.id !== fileId));
          }, 2000);
        } catch (err) {
          console.error(`Upload failed for ${file.name}:`, err);
          setUploads((prev) => prev.map((u) => (u.id === fileId ? { ...u, status: 'error' } : u)));
        }
      };

      const runQueue = async () => {
        while (queue.length > 0) {
          while (active.length >= concurrencyLimit) {
            await Promise.race(active);
          }
          const file = queue.shift();
          if (!file) break;
          const promise = processFile(file).finally(() => {
            const idx = active.indexOf(promise);
            if (idx >= 0) active.splice(idx, 1);
          });
          active.push(promise);
        }
        await Promise.all(active);
        filesCache.invalidate(`folder:${scope.type}:`);
        loadContents();
      };

      await runQueue();
    },
    [scope, currentPath, user, getCredentials, loadContents, filesCache],
  );

  const openShareModal = useCallback(
    (fileId?: string, name?: string) => {
      if (fileId && name) {
        setShareModalFile({ fileId, name, scope });
      } else {
        setShareModalFile(undefined);
      }
      setShowShareModal(true);
    },
    [scope],
  );

  // --- Orphan callbacks ---
  const loadOrphans = useCallback(
    async (append = false) => {
      setOrphanLoading(true);
      setError(null);
      try {
        const fetcher = activeTab === 'company' ? listCompanyOrphans : listOrphans;
        const result = await fetcher(append ? orphanCursor : undefined);
        setOrphans((prev) => (append ? [...prev, ...result.orphans] : result.orphans));
        setOrphanCursor(result.next_cursor);
      } catch {
        setError(t('errors.orphansFailed'));
      } finally {
        setOrphanLoading(false);
      }
    },
    [orphanCursor, activeTab, t],
  );

  const handleOrphanDownload = useCallback(
    async (key: string) => {
      try {
        const fetcher = activeTab === 'company' ? getCompanyOrphanDownloadUrl : getOrphanDownloadUrl;
        const { url } = await fetcher(key);
        window.open(url, '_blank');
      } catch {
        // Silent fail
      }
    },
    [activeTab],
  );

  const handleAdoptOrphan = useCallback(
    async (key: string, name: string) => {
      setAdoptingKey(key);
      try {
        const adopter = activeTab === 'company' ? adoptCompanyOrphan : adoptOrphan;
        await adopter(key, name);
        setOrphans((prev) => prev.filter((o) => o.key !== key));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(t('errors.adoptFailed', { error: message }));
      } finally {
        setAdoptingKey(null);
      }
    },
    [activeTab, t],
  );

  const enterOrphansView = useCallback(() => {
    setIsOrphansView(true);
    setOrphans([]);
    setOrphanCursor(undefined);
  }, []);

  useEffect(() => {
    if (isOrphansView) {
      loadOrphans(false);
    }
  }, [isOrphansView]);

  // --- @dnd-kit: internal file/folder move DnD ---
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const [activeDrag, setActiveDrag] = useState<{ id: string; name: string; type: 'file' | 'folder' } | null>(null);

  const handleDndDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      if (id.startsWith('file:')) {
        const fileId = id.slice(5);
        const file = contents?.files.find((f) => f.file_id === fileId);
        if (file) setActiveDrag({ id, name: file.name, type: 'file' });
      } else if (id.startsWith('folder:')) {
        const path = id.slice(7);
        const folder = contents?.folders.find((f) => f.path === path);
        if (folder) setActiveDrag({ id, name: folder.name, type: 'folder' });
      }
    },
    [contents],
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
        const fileId = activeId.slice(5);
        // Optimistic removal — remove file from list immediately
        const removedFile = contents?.files.find((f) => f.file_id === fileId);
        if (removedFile) {
          setContents((prev) => (prev ? { ...prev, files: prev.files.filter((f) => f.file_id !== fileId) } : prev));
        }
        apiCall = apiMoveFile(scope, fileId, targetPath).catch((err) => {
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
            prev ? { ...prev, folders: prev.folders.filter((f) => f.path !== folderPath) } : prev,
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
    [scope, contents, loadContents, t, filesCache],
  );

  // Whether DnD should be enabled (not in orphans, shared, or project-list views)
  const dndEnabled = useMemo(
    () => !isOrphansView && !isSharedTab && !(activeTab === 'projects' && !selectedProjectId),
    [isOrphansView, isSharedTab, activeTab, selectedProjectId],
  );

  // --- @dnd-kit: orphan drag-to-adopt ---
  const handleOrphanDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      if (id.startsWith('orphan:')) {
        const key = id.slice(7);
        const orphan = orphans.find((o) => o.key === key);
        if (orphan) setActiveDrag({ id, name: orphan.name, type: 'file' });
      }
    },
    [orphans],
  );

  const handleOrphanDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDrag(null);
      const { active, over } = event;
      if (!over) return;

      const activeId = String(active.id);
      const overId = String(over.id);

      if (!activeId.startsWith('orphan:')) return;
      // Only allow dropping on breadcrumb targets
      if (!overId.startsWith('breadcrumb:')) return;
      const targetPath = overId.slice(11);

      const key = activeId.slice(7);
      const orphan = orphans.find((o) => o.key === key);
      if (!orphan) return;

      // Optimistic removal
      setOrphans((prev) => prev.filter((o) => o.key !== key));

      const adopter = activeTab === 'company' ? adoptCompanyOrphan : adoptOrphan;
      adopter(key, orphan.name, targetPath)
        .then(() => {
          filesCache.invalidate(`folder:${activeTab}:`);
          return loadContents();
        })
        .catch((err) => {
          // Rollback: restore the orphan on failure
          setOrphans((prev) => [...prev, orphan]);
          const message = err instanceof Error ? err.message : String(err);
          setError(t('errors.adoptFailed', { error: message }));
        });
    },
    [orphans, activeTab, loadContents, t, filesCache],
  );

  // Drag-and-drop handlers for file UPLOAD (disabled for shared tab)
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (isSharedTab) return;
      e.preventDefault();
      dragCounter.current++;
      if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
    },
    [isSharedTab],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (isSharedTab) return;
      e.preventDefault();
      dragCounter.current--;
      if (dragCounter.current === 0) setIsDragging(false);
    },
    [isSharedTab],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (isSharedTab) return;
      e.preventDefault();
    },
    [isSharedTab],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (isSharedTab) return;
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        uploadFiles(e.dataTransfer.files);
      }
    },
    [uploadFiles, isSharedTab],
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

  const getRootLabel = () => {
    switch (activeTab) {
      case 'projects':
        return 'Project';
      case 'company':
        return 'Company';
      case 'shared':
        return t('shared.rootLabel');
      default:
        return 'My Files';
    }
  };

  const tabsBar = (
    <div className="files-tabs">
      <ul className="nav nav-tabs border-0">
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'projects' ? 'active' : ''}`}
            onClick={() => handleTabChange('projects')}
          >
            <i className="bi bi-layers" /> {t('tabs.projects')}
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'company' ? 'active' : ''}`}
            onClick={() => handleTabChange('company')}
          >
            <i className="bi bi-building" /> {t('tabs.company')}
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link ${activeTab === 'my' ? 'active' : ''}`} onClick={() => handleTabChange('my')}>
            <i className="bi bi-person" /> {t('tabs.myFiles')}
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'shared' ? 'active' : ''}`}
            onClick={() => handleTabChange('shared')}
          >
            <i className="bi bi-share" /> {t('tabs.shared')}
          </button>
        </li>
      </ul>
    </div>
  );

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
    </div>
  );

  // Project list view
  if (activeTab === 'projects' && !selectedProjectId) {
    return (
      <div className="files-page">
        <div className="files-header">
          <h2>{t('title')}</h2>
          <p>{t('subtitle')}</p>
        </div>
        {tabsBar}
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
        <div className="files-header">
          <h2>{t('title')}</h2>
          <p>{t('subtitle')}</p>
        </div>
        {tabsBar}

        <div className="files-toolbar">
          <div className="breadcrumb-path">
            <span className="breadcrumb-segment">{t('shared.rootLabel')}</span>
          </div>
          {viewToggle}
          <button className="btn btn-sm btn-outline-primary" onClick={() => openShareModal()}>
            <i className="bi bi-plus-lg" /> {t('shared.createShare')}
          </button>
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
                <span>{t('shared.description')}</span>
                <span>{t('headers.status')}</span>
                <span />
              </div>
              {shares.map((share) => (
                <div key={share.uuid} className="file-row" onClick={() => navigate(`/analyze/shared/${share.uuid}`)}>
                  <div className="file-name">
                    <i className="bi bi-file-earmark-text file-icon" />
                    <span>{share.name}</span>
                  </div>
                  <div className="file-size share-description">
                    <span>{share.description || formatShareDate(share.created_at)}</span>
                    {share.call_count > 0 && (
                      <span className="badge bg-info-subtle text-info ms-2">
                        {t('shared.conversations', { count: share.call_count })}
                      </span>
                    )}
                  </div>
                  <div className="file-status">
                    <ShareStatusBadge status={share.status} expiresAt={share.expires_at} t={t} />
                    {!share.enable_chat && (
                      <span className="badge bg-secondary-subtle text-secondary ms-1" title={t('shared.chatEnabled')}>
                        <i className="bi bi-chat-left-dots-fill" style={{ textDecoration: 'line-through' }} />
                      </span>
                    )}
                    {!share.allow_download && (
                      <span
                        className="badge bg-secondary-subtle text-secondary ms-1"
                        title={t('shared.downloadEnabled')}
                      >
                        <i className="bi bi-download" style={{ textDecoration: 'line-through' }} />
                      </span>
                    )}
                  </div>
                  <div className="file-actions">
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
                        window.open(`/shared/${share.uuid}`, '_blank');
                      }}
                    >
                      <i className="bi bi-box-arrow-up-right" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="file-grid">
              {shares.map((share) => (
                <div key={share.uuid} className="file-card" onClick={() => navigate(`/analyze/shared/${share.uuid}`)}>
                  <i className="bi bi-file-earmark-text file-card-icon" />
                  <div className="file-card-name" title={share.name}>
                    {share.name}
                  </div>
                  {share.description && <div className="file-card-meta">{share.description}</div>}
                  <div className="file-card-meta">{formatShareDate(share.created_at)}</div>
                  <div className="file-card-footer">
                    <ShareStatusBadge status={share.status} expiresAt={share.expires_at} t={t} />
                    {share.call_count > 0 && (
                      <span className="badge bg-info-subtle text-info ms-1">
                        {t('shared.conversations', { count: share.call_count })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <CreateShareModal
          show={showShareModal}
          onHide={() => setShowShareModal(false)}
          onCreated={loadContents}
          preSelectedFile={shareModalFile}
        />
      </div>
    );
  }

  // Orphans view — virtual folder showing unregistered S3 artifacts
  if (isOrphansView) {
    return (
      <div className="files-page">
        <div className="files-header">
          <h2>{t('title')}</h2>
          <p>{t('subtitle')}</p>
        </div>

        {tabsBar}

        <DndContext sensors={sensors} onDragStart={handleOrphanDragStart} onDragEnd={handleOrphanDragEnd}>
          <div className="files-toolbar">
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={() => {
                setIsOrphansView(false);
                setOrphans([]);
                setOrphanCursor(undefined);
                setError(null);
              }}
              title={t('toolbar.up')}
            >
              <i className="bi bi-arrow-up" /> {t('toolbar.up')}
            </button>

            <div className="breadcrumb-path">
              <DroppableBreadcrumb
                path="/"
                className="breadcrumb-segment"
                onClick={() => {
                  setIsOrphansView(false);
                  setOrphans([]);
                  setOrphanCursor(undefined);
                  setError(null);
                }}
              >
                {getRootLabel()}
              </DroppableBreadcrumb>
              <span className="breadcrumb-separator">/</span>
              <span className="breadcrumb-segment breadcrumb-segment--active">{t('orphans.folderName')}</span>
            </div>
          </div>

          <div className="files-content">
            {error && (
              <div className="alert alert-danger m-3 mb-0" role="alert">
                {error}
                <button type="button" className="btn-close float-end" onClick={() => setError(null)} />
              </div>
            )}

            {orphanLoading && orphans.length === 0 ? (
              <div className="files-empty">
                <div className="spinner-border text-secondary" />
                <p className="mt-2 text-muted">{t('orphans.scanning')}</p>
              </div>
            ) : orphans.length === 0 && !orphanLoading && !error ? (
              <div className="files-empty">
                <i className="bi bi-box-seam" />
                <h5>{t('orphans.empty')}</h5>
                <p>{t('orphans.emptyMessage')}</p>
              </div>
            ) : orphans.length === 0 && error ? null : (
              <div className="file-list">
                <div className="file-list-header file-list-header--orphans">
                  <span>{t('headers.name')}</span>
                  <span>{t('headers.size')}</span>
                  <span>{t('orphans.lastModified')}</span>
                  <span />
                </div>
                {orphans.map((orphan) => (
                  <DraggableItem
                    key={orphan.key}
                    id={`orphan:${orphan.key}`}
                    className="file-row"
                    onClick={() => handleOrphanDownload(orphan.key)}
                  >
                    <div className="file-name">
                      <i className={`${getFileIcon(inferSourceType(orphan.name))} file-icon`} />
                      <span>{orphan.name}</span>
                      <span className={`source-badge source-badge--${orphan.source}`}>
                        {t(`orphans.source.${orphan.source}`, { defaultValue: orphan.source })}
                      </span>
                    </div>
                    <div className="file-size">{formatFileSize(orphan.size)}</div>
                    <div className="file-status">
                      {orphan.last_modified && (
                        <span className="text-muted">{new Date(orphan.last_modified).toLocaleDateString()}</span>
                      )}
                    </div>
                    <div className="file-actions">
                      <button
                        className="btn-icon btn-icon--adopt"
                        title={t('orphans.actions.adopt')}
                        disabled={adoptingKey === orphan.key}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAdoptOrphan(orphan.key, orphan.name);
                        }}
                      >
                        {adoptingKey === orphan.key ? (
                          <span className="spinner-border spinner-border-sm" />
                        ) : (
                          <i className="bi bi-folder-plus" />
                        )}
                      </button>
                      <button
                        className="btn-icon"
                        title={t('orphans.actions.download')}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOrphanDownload(orphan.key);
                        }}
                      >
                        <i className="bi bi-download" />
                      </button>
                    </div>
                  </DraggableItem>
                ))}

                {orphanCursor && (
                  <div className="text-center py-3">
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => loadOrphans(true)}
                      disabled={orphanLoading}
                    >
                      {orphanLoading ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                      {t('orphans.loadMore')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeDrag && <DragPreview name={activeDrag.name} type={activeDrag.type} />}
          </DragOverlay>
        </DndContext>
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
      <div className="files-header">
        <h2>{t('title')}</h2>
        <p>{t('subtitle')}</p>
      </div>

      {tabsBar}

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
                    setSelectedProjectId(null);
                    setContents(null);
                  }
                : navigateUp
            }
            disabled={currentPath === '/' && !(activeTab === 'projects' && selectedProjectId)}
            title={t('toolbar.up')}
          >
            <i className="bi bi-arrow-up" /> {t('toolbar.up')}
          </button>

          <div className="breadcrumb-path">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.path}>
                {i > 0 && <span className="breadcrumb-separator">/</span>}
                {dndEnabled ? (
                  <DroppableBreadcrumb
                    path={crumb.path}
                    className="breadcrumb-segment"
                    onClick={() => navigateToFolder(crumb.path)}
                  >
                    {crumb.label === '/' ? getRootLabel() : crumb.label}
                  </DroppableBreadcrumb>
                ) : (
                  <span className="breadcrumb-segment" onClick={() => navigateToFolder(crumb.path)}>
                    {crumb.label === '/' ? getRootLabel() : crumb.label}
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
            onClick={() => fileInputRef.current?.click()}
            title={t('toolbar.upload')}
          >
            <i className="bi bi-cloud-upload" /> {t('toolbar.upload')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="d-none"
            onChange={(e) => {
              if (e.target.files) {
                uploadFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />
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
          ) : viewMode === 'grid' ? (
            <div className="file-grid">
              {/* Orphans virtual folder card — at root of My Files or Company */}
              {(activeTab === 'my' || activeTab === 'company') && currentPath === '/' && (
                <div className="file-card file-card--orphans" onClick={enterOrphansView}>
                  <i className="bi bi-box-seam file-card-icon orphans-icon" />
                  <div className="file-card-name">{t('orphans.folderName')}</div>
                </div>
              )}

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
                    <i className="bi bi-folder-fill file-card-icon folder-icon" />
                    <div className="file-card-name" title={folder.name}>
                      {folder.name}
                    </div>
                  </DroppableFolder>
                ) : (
                  <div key={folder.path} className="file-card" onClick={() => navigateToFolder(folder.path)}>
                    <i className="bi bi-folder-fill file-card-icon folder-icon" />
                    <div className="file-card-name" title={folder.name}>
                      {folder.name}
                    </div>
                  </div>
                ),
              )}

              {/* Files as cards (draggable) */}
              {contents?.files.map((file) =>
                dndEnabled ? (
                  <DraggableItem
                    key={file.file_id}
                    id={`file:${file.file_id}`}
                    className="file-card"
                    onClick={() => handleDownload(file.file_id)}
                  >
                    <i className={`${getFileIcon(file.source_type)} file-card-icon`} />
                    <div className="file-card-name" title={file.name}>
                      {file.name}
                    </div>
                    <div className="file-card-meta">{formatFileSize(file.size_bytes)}</div>
                    <div className="file-card-footer">
                      <ExtractionBadge status={file.extraction_status} t={t} />
                    </div>
                  </DraggableItem>
                ) : (
                  <div key={file.file_id} className="file-card" onClick={() => handleDownload(file.file_id)}>
                    <i className={`${getFileIcon(file.source_type)} file-card-icon`} />
                    <div className="file-card-name" title={file.name}>
                      {file.name}
                    </div>
                    <div className="file-card-meta">{formatFileSize(file.size_bytes)}</div>
                    <div className="file-card-footer">
                      <ExtractionBadge status={file.extraction_status} t={t} />
                    </div>
                  </div>
                ),
              )}

              {/* Empty state */}
              {!loading &&
                contents &&
                contents.folders.length === 0 &&
                contents.files.length === 0 &&
                uploads.length === 0 && (
                  <div className="files-empty files-empty-grid">
                    <i className="bi bi-folder2-open" />
                    <h5>{t('empty.title')}</h5>
                    <p>{t('empty.message')}</p>
                  </div>
                )}
            </div>
          ) : (
            <div className="file-list">
              <div className="file-list-header">
                <span>{t('headers.name')}</span>
                <span>{t('headers.size')}</span>
                <span>{t('headers.status')}</span>
                <span />
              </div>

              {/* Upload progress rows */}
              {uploads.map((upload) => (
                <div key={upload.id} className="upload-progress-row">
                  <div className="upload-info">
                    <div className="spinner-border spinner-border-sm text-primary" />
                    <span>{upload.name}</span>
                  </div>
                  <div />
                  <div>
                    {upload.status === 'uploading' && (
                      <div className="progress">
                        <div className="progress-bar" style={{ width: `${upload.progress}%` }} />
                      </div>
                    )}
                    {upload.status === 'registering' && <span className="text-muted">{t('status.uploading')}</span>}
                    {upload.status === 'done' && <i className="bi bi-check-circle text-success" />}
                    {upload.status === 'error' && <i className="bi bi-x-circle text-danger" />}
                  </div>
                  <div />
                </div>
              ))}

              {/* Orphans virtual folder — at root of My Files or Company */}
              {(activeTab === 'my' || activeTab === 'company') && currentPath === '/' && (
                <div className="file-row file-row--orphans-folder" onClick={enterOrphansView}>
                  <div className="file-name">
                    <i className="bi bi-box-seam file-icon orphans-icon" />
                    <span>{t('orphans.folderName')}</span>
                  </div>
                  <div className="file-size" />
                  <div className="file-status">
                    <span className="text-muted small">{t('orphans.folderDescription')}</span>
                  </div>
                  <div className="file-actions" />
                </div>
              )}

              {/* Folders (droppable + draggable) */}
              {contents?.folders.map((folder) => {
                const folderContent = (
                  <>
                    <div className="file-name">
                      <i className="bi bi-folder-fill file-icon folder-icon" />
                      <span>{folder.name}</span>
                    </div>
                    <div className="file-size" />
                    <div className="file-status" />
                    <div className="file-actions">
                      <button
                        className="btn-icon"
                        title={t('actions.delete')}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFolder(folder.path);
                        }}
                      >
                        <i className="bi bi-trash" />
                      </button>
                    </div>
                  </>
                );
                return dndEnabled ? (
                  <DroppableFolder
                    key={folder.path}
                    dragId={`folder:${folder.path}`}
                    dropId={`drop:${folder.path}`}
                    className="file-row"
                    onClick={() => navigateToFolder(folder.path)}
                  >
                    {folderContent}
                  </DroppableFolder>
                ) : (
                  <div key={folder.path} className="file-row" onClick={() => navigateToFolder(folder.path)}>
                    {folderContent}
                  </div>
                );
              })}

              {/* Files (draggable) */}
              {contents?.files.map((file) => {
                const fileContent = (
                  <>
                    <div className="file-name">
                      {renamingId === file.file_id ? (
                        <div className="rename-input" onClick={(e) => e.stopPropagation()}>
                          <i className={`${getFileIcon(file.source_type)} file-icon`} />
                          <input
                            type="text"
                            className="form-control form-control-sm"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename(file.file_id);
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            autoFocus
                          />
                          <button className="btn btn-sm btn-primary" onClick={() => handleRename(file.file_id)}>
                            <i className="bi bi-check" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <i className={`${getFileIcon(file.source_type)} file-icon`} />
                          <span>{file.name}</span>
                        </>
                      )}
                    </div>
                    <div className="file-size">{formatFileSize(file.size_bytes)}</div>
                    <div className="file-status">
                      <ExtractionBadge status={file.extraction_status} t={t} />
                    </div>
                    <div className="file-actions">
                      <button
                        className="btn-icon"
                        title={t('actions.rename')}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(file.file_id);
                          setRenameValue(file.name);
                        }}
                      >
                        <i className="bi bi-pencil" />
                      </button>
                      <button
                        className="btn-icon btn-icon--share"
                        title={t('actions.share')}
                        onClick={(e) => {
                          e.stopPropagation();
                          openShareModal(file.file_id, file.name);
                        }}
                      >
                        <i className="bi bi-share" />
                      </button>
                      <button
                        className="btn-icon"
                        title={t('actions.download')}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(file.file_id);
                        }}
                      >
                        <i className="bi bi-download" />
                      </button>
                      <button
                        className="btn-icon"
                        title={t('actions.delete')}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(file.file_id);
                        }}
                      >
                        <i className="bi bi-trash" />
                      </button>
                    </div>
                  </>
                );
                return dndEnabled ? (
                  <DraggableItem
                    key={file.file_id}
                    id={`file:${file.file_id}`}
                    className="file-row"
                    onClick={() => handleDownload(file.file_id)}
                  >
                    {fileContent}
                  </DraggableItem>
                ) : (
                  <div key={file.file_id} className="file-row" onClick={() => handleDownload(file.file_id)}>
                    {fileContent}
                  </div>
                );
              })}

              {/* Empty state */}
              {!loading &&
                contents &&
                contents.folders.length === 0 &&
                contents.files.length === 0 &&
                uploads.length === 0 && (
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
      />
    </div>
  );
};

const ExtractionBadge = ({ status, t }: { status: string; t: (key: string) => string }) => {
  switch (status) {
    case 'ready':
      return <span className="badge bg-success-subtle text-success">{t('status.ready')}</span>;
    case 'processing':
      return <span className="badge bg-primary-subtle text-primary">{t('status.processing')}</span>;
    case 'queued':
      return <span className="badge bg-secondary-subtle text-secondary">{t('status.queued')}</span>;
    case 'error':
      return <span className="badge bg-danger-subtle text-danger">{t('status.error')}</span>;
    default:
      return null;
  }
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

/** Infer source type from filename extension (for icon display). */
function inferSourceType(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'unknown';
  const ext = name.slice(dot).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'pdf',
    '.docx': 'docx',
    '.xlsx': 'xlsx',
    '.png': 'image',
    '.jpg': 'image',
    '.jpeg': 'image',
    '.mp3': 'audio',
    '.mp4': 'audio',
    '.wav': 'audio',
  };
  return map[ext] || 'text';
}

export default { FilesPage };
