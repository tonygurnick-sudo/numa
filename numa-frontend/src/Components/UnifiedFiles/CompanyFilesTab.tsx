import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Spinner, Alert, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import {
  buildFileTree,
  buildRowsForTree,
  unwrapSingleRootFolders,
  flattenRows,
  sortTree,
  formatDateSafe,
  formatSizeSafe,
  filterTree,
  filterTreeByPredicate,
  collectFoldersToExpand,
} from './KBFileExplorer';
import type { S3Object, TableRow, SortColumn, SortDirection } from './KBFileExplorer';
import { FileUploader } from '../FileUploader';
import { NotificationModal } from '../NotificationModal';
import FolderSelector from './FolderSelector';
import { shouldShowLargeDataFileWarning, formatFileSize, getFileTypeCategory } from '../../utils/fileUtils';
import type { FileTypeCategory } from '../../utils/fileUtils';
import { listFoldersInKB, downloadFileFromS3 } from '../../utils/s3Utils';
import { useAuth } from '../../Providers/AuthProvider';
import { useToast } from '../../Providers/ToastContext';
import { useFilePreviewProcessor } from '../../hooks/useFilePreviewProcessor';
import type { FileReference } from '../../hooks/useFilePreviewProcessor';
import ResizableSplitView from '../ResizableSplitView';
import { FilePreviewPanel } from '../FilePreviewPanel';
import { knowledgeBaseService } from '../../Services/knowledgeBaseService';
import type { S3FileInfo } from '../../Services/knowledgeBaseService';
import { CreateSubfolderModal } from './CreateSubfolderModal';
import { FolderContextMenu, type FolderContextAction, type FolderContextTarget } from './FolderContextMenu';
import { extractDroppedUploadBatch, isExternalFileDrag, type DroppedUploadBatch } from './dropUploadUtils';

const COMPANY_KB_PREFIX = 'documents/company/';

interface CompanyFilesTabProps {
  onActionChange?: (actions: React.ReactNode) => void;
}

interface FileState {
  files: S3Object[];
  isLoading: boolean;
  expandedFolders: Set<string>;
  loadedFolders: Set<string>;
  loadingFolders: Set<string>;
  /** True once a recursive listing has been merged in for this KB. */
  deepLoaded: boolean;
  /** True if the last recursive fetch hit the backend's 50k cap. */
  truncated: boolean;
}

function apiToS3Objects(fileInfos: S3FileInfo[], folderNames: string[], parentPrefix: string): S3Object[] {
  const s3Files: S3Object[] = fileInfos.map((f) => ({
    Key: f.key,
    LastModified: f.lastModified ? new Date(f.lastModified) : new Date(),
    Size: f.size,
    urlTag: f.urlTag,
    uploadedBy: f.uploadedBy,
    uploadedAt: f.uploadedAt,
  }));
  for (const folder of folderNames) {
    s3Files.push({ Key: `${parentPrefix}${folder}/`, LastModified: new Date(), Size: 0 });
  }
  return s3Files;
}

export function CompanyFilesTab({ onActionChange }: CompanyFilesTabProps): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const { t: tKb } = useTranslation('knowledgeBase');
  const { user, getCredentials, region: authRegion } = useAuth();
  const { showToast } = useToast();

  const [fileState, setFileState] = useState<FileState>(() => {
    // Hydrate from both deep and shallow caches. Shallow entries overwrite
    // matching deep entries so enrichment wins when both are cached.
    let files: S3Object[] = [];
    let deepLoaded = false;
    let truncated = false;
    const deepCache = knowledgeBaseService.getCachedKBFilesRecursive('company');
    if (deepCache?.files?.length) {
      files = apiToS3Objects(deepCache.files, [], 'documents/company/');
      deepLoaded = true;
      truncated = deepCache.truncated;
    }
    const shallowCache = knowledgeBaseService.getCachedKBFiles('company');
    if (shallowCache?.files?.length) {
      const shallowFiles = apiToS3Objects(shallowCache.files, shallowCache.folders ?? [], 'documents/company/');
      const shallowKeys = new Set(shallowFiles.map((f) => f.Key));
      files = [...shallowFiles, ...files.filter((f) => !shallowKeys.has(f.Key))];
    }
    return {
      files,
      isLoading: true,
      expandedFolders: new Set(),
      loadedFolders: new Set(),
      loadingFolders: new Set(),
      deepLoaded,
      truncated,
    };
  });

  /** Current folder navigation. null = root view, string = navigated into a subfolder by its row id */
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [currentFolderName, setCurrentFolderName] = useState<string>('');

  const [searchValue, setSearchValue] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Drag-and-drop + multi-select for file moves within the company KB
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  // Filters
  const [typeFilter, setTypeFilter] = useState<FileTypeCategory | 'all'>('all');
  const [uploaderFilter, setUploaderFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7d' | '30d'>('all');

  // Upload
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [pendingLargeFiles, setPendingLargeFiles] = useState<File[]>([]);
  const [clearFileUploader, setClearFileUploader] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [uploadInitialFolder, setUploadInitialFolder] = useState('');
  const [droppedUploadBatch, setDroppedUploadBatch] = useState<DroppedUploadBatch | null>(null);
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const [folderOptions, setFolderOptions] = useState<string[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);

  // Delete
  type DeleteConfirmState =
    | { kind: 'files'; keys: string[]; label: string }
    | { kind: 'subfolder'; path: string; label: string };
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);

  // Subfolder creation
  const [subfolderTarget, setSubfolderTarget] = useState<{
    parentPath: string;
    parentDisplayName: string;
  } | null>(null);

  // Folder right-click context menu
  const [folderContextMenu, setFolderContextMenu] = useState<{
    show: boolean;
    position: { x: number; y: number };
    target: FolderContextTarget;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Rename
  const [renameTarget, setRenameTarget] = useState<{ key: string; currentName: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  // File preview
  const {
    filePreview,
    showFilePreview,
    leftFraction: filePreviewLeftFraction,
    setLeftFraction: setFilePreviewLeftFraction,
    openFilePreview,
    closeFilePreview,
  } = useFilePreviewProcessor();
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
  const [showFilePreviewModal, setShowFilePreviewModal] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const region = authRegion || window.sessionStorage.getItem('REGION') || 'ap-southeast-2';
  const CLIENT_NAME = window.sessionStorage.getItem('CLIENT_NAME');
  const dataBucket = `numa-${CLIENT_NAME}-data`;
  const emptyValue = tKb('fileExplorer.emptyValue');
  const formatDate = useCallback((date: Date | undefined) => formatDateSafe(date, emptyValue), [emptyValue]);
  const formatSize = useCallback((size: number | undefined) => formatSizeSafe(size, emptyValue), [emptyValue]);

  const canView = Boolean(user?.features?.includes('useCompanyData'));
  const canAdd = Boolean(user?.features?.includes('addToCompanyData'));
  const canDelete = Boolean(user?.features?.includes('deleteFromCompanyData'));

  // Hide parent page actions -- we handle them in the toolbar
  useEffect(() => {
    onActionChange?.(null);
  }, [onActionChange]);

  // ── Data fetching ──────────────────────────────────────────

  const fetchFiles = useCallback(async () => {
    setFileState((prev) => ({ ...prev, isLoading: true }));
    try {
      const { files: fileInfos, folders: folderNames = [] } = await knowledgeBaseService.listKBFiles('company');
      const s3Files = apiToS3Objects(fileInfos, folderNames, 'documents/company/');
      setFileState((prev) => {
        // Preserve deep-only entries (keys not in the shallow refresh).
        const shallowKeys = new Set(s3Files.map((f) => f.Key));
        const preserved = prev.files.filter((f) => !shallowKeys.has(f.Key));
        return {
          ...prev,
          files: [...s3Files, ...preserved],
          isLoading: false,
          loadedFolders: new Set(),
          loadingFolders: new Set(),
        };
      });
    } catch (err) {
      console.error('Failed to fetch company files:', err);
      setFileState((prev) => ({
        ...prev,
        isLoading: false,
      }));
    }
  }, []);

  const [isDeepLoading, setIsDeepLoading] = useState(false);

  const fetchDeepFiles = useCallback(async (force = false) => {
    setFileState((prev) => {
      if (!force && prev.deepLoaded) return prev;
      return prev;
    });
    setIsDeepLoading(true);
    try {
      const result = await knowledgeBaseService.listKBFilesRecursive('company');
      setFileState((prev) => {
        const existingKeys = new Set(prev.files.map((f) => f.Key));
        const additions: S3Object[] = [];
        for (const f of result.files) {
          if (existingKeys.has(f.key)) continue;
          additions.push({
            Key: f.key,
            LastModified: f.lastModified ? new Date(f.lastModified) : new Date(),
            Size: f.size,
          });
        }
        return {
          ...prev,
          files: [...prev.files, ...additions],
          deepLoaded: true,
          truncated: result.truncated,
        };
      });
    } catch (err) {
      console.error('Failed to deep-fetch company KB', err);
    } finally {
      setIsDeepLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canView) fetchFiles();
  }, [canView, fetchFiles]);

  // Fire the recursive listing the first time the user starts searching or
  // filtering. Guarded by fileState.deepLoaded so it only runs once per session.
  const isFilterOrSearchActive =
    searchValue.trim().length > 0 || typeFilter !== 'all' || uploaderFilter !== 'all' || dateFilter !== 'all';
  useEffect(() => {
    if (!canView || !isFilterOrSearchActive || fileState.deepLoaded) return;
    fetchDeepFiles();
  }, [canView, isFilterOrSearchActive, fileState.deepLoaded, fetchDeepFiles]);

  // ── Subfolder expansion ───────────────────────────────────

  const toggleSubfolder = useCallback(
    (folderId: string) => {
      const isExpanding = !fileState.expandedFolders.has(folderId);

      setFileState((prev) => {
        const newExpanded = new Set(prev.expandedFolders);
        isExpanding ? newExpanded.add(folderId) : newExpanded.delete(folderId);
        return { ...prev, expandedFolders: newExpanded };
      });

      if (!isExpanding || fileState.loadedFolders.has(folderId)) return;

      const basePrefix = 'documents/company/';
      const basePrefixNoSlash = basePrefix.replace(/\/$/, '');
      const subpath = folderId.startsWith(basePrefixNoSlash) ? folderId.slice(basePrefixNoSlash.length + 1) : folderId;

      setFileState((prev) => ({
        ...prev,
        loadingFolders: new Set(prev.loadingFolders).add(folderId),
      }));

      knowledgeBaseService
        .listKBFiles('company', subpath)
        .then(({ files: fileInfos, folders: folderNames = [] }) => {
          const folderPrefix = `${basePrefix}${subpath}/`.replace(/\/{2,}/g, '/');
          const s3Files = apiToS3Objects(fileInfos, folderNames, folderPrefix);

          setFileState((prev) => {
            // Shallow entries carry uploader + urlTag enrichment; overwrite
            // any thin deep-only entries for the same keys so enrichment wins.
            const shallowKeys = new Set(s3Files.map((f) => f.Key));
            const merged = [...s3Files, ...prev.files.filter((f) => !shallowKeys.has(f.Key))];
            const newLoading = new Set(prev.loadingFolders);
            newLoading.delete(folderId);
            return {
              ...prev,
              files: merged,
              loadedFolders: new Set(prev.loadedFolders).add(folderId),
              loadingFolders: newLoading,
            };
          });
        })
        .catch((err) => {
          console.error('Failed to load subfolder', folderId, err);
          setFileState((prev) => {
            const newLoading = new Set(prev.loadingFolders);
            newLoading.delete(folderId);
            return { ...prev, loadingFolders: newLoading };
          });
        });
    },
    [fileState.expandedFolders, fileState.loadedFolders]
  );

  // ── Folder navigation ──────────────────────────────────────

  const navigateIntoFolder = useCallback(
    (folderId: string, folderName: string) => {
      // Ensure the folder's children are loaded
      if (!fileState.loadedFolders.has(folderId)) {
        // Trigger expansion to load children, then navigate
        toggleSubfolder(folderId);
      }
      // Also expand the folder so its children are visible in the tree
      setFileState((prev) => {
        const newExpanded = new Set(prev.expandedFolders);
        newExpanded.add(folderId);
        return { ...prev, expandedFolders: newExpanded };
      });
      setCurrentFolderId(folderId);
      setCurrentFolderName(folderName);
      setSearchValue('');
    },
    [fileState.loadedFolders, toggleSubfolder]
  );

  const navigateBack = useCallback(() => {
    setCurrentFolderId(null);
    setCurrentFolderName('');
    setSearchValue('');
    setSelectedKeys(new Set());
    closeFilePreview();
  }, [closeFilePreview]);

  // ── Drag-and-drop move ─────────────────────────────────────

  const parseDragPayload = (e: React.DragEvent): { keys: string[] } | null => {
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (Array.isArray(p.keys) && p.keys.length > 0) return p;
    } catch {
      /* noop */
    }
    return null;
  };

  const handleFileClick = useCallback((originalKey: string, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(originalKey)) next.delete(originalKey);
        else next.add(originalKey);
        return next;
      });
    } else {
      setSelectedKeys((prev) => (prev.size === 1 && prev.has(originalKey) ? new Set() : new Set([originalKey])));
    }
  }, []);

  const onFileDragStart = useCallback(
    (e: React.DragEvent, originalKey: string) => {
      if (!canAdd) {
        // Editors are required to move files.
        e.preventDefault();
        return;
      }
      const keys = selectedKeys.has(originalKey) && selectedKeys.size > 1 ? Array.from(selectedKeys) : [originalKey];
      e.dataTransfer.setData('application/json', JSON.stringify({ sourceKbId: 'company', keys }));
      e.dataTransfer.effectAllowed = 'move';
    },
    [canAdd, selectedKeys]
  );

  const onFolderDragStart = useCallback(
    (e: React.DragEvent, folderId: string) => {
      if (!canAdd) {
        e.preventDefault();
        return;
      }
      const folderKey = folderId.endsWith('/') ? folderId : `${folderId}/`;
      e.dataTransfer.setData('application/json', JSON.stringify({ sourceKbId: 'company', keys: [folderKey] }));
      e.dataTransfer.effectAllowed = 'move';
    },
    [canAdd]
  );

  const executeMove = useCallback(
    async (keys: string[], destPath: string) => {
      const destFolderPrefix = destPath
        ? `documents/company/${destPath}/`.replace(/\/{2,}/g, '/')
        : 'documents/company/';
      const toMove = keys.filter((k) => {
        const parent = k.substring(0, k.lastIndexOf('/') + 1);
        return parent !== destFolderPrefix;
      });
      if (toMove.length === 0) return;

      setIsMoving(true);
      try {
        const result = await knowledgeBaseService.moveKBFiles('company', toMove, 'company', destPath);
        // Optimistically rewrite source -> dest keys so the moved entries
        // jump folders immediately. Without this, the old keys linger until
        // the refetch completes and `fetchFiles` doesn't drop them — they
        // sit in `prev.files` and get kept by the preserve-deep-entries
        // branch since they're absent from the new shallow listing.
        const mapping = new Map(result.successful.map((s) => [s.sourceKey, s.destKey]));
        const movedFolderPrefixes = toMove.filter((k) => k.endsWith('/'));
        const isMovedFolderMarker = (key: string) =>
          key.endsWith('/') && movedFolderPrefixes.some((prefix) => key === prefix || key.startsWith(prefix));
        const keepFolderState = (id: string) =>
          !movedFolderPrefixes.some((prefix) => id === prefix || id.startsWith(prefix));
        if (mapping.size > 0) {
          setFileState((prev) => ({
            ...prev,
            files: prev.files.flatMap((f) => {
              const dest = mapping.get(f.Key);
              if (dest) return [{ ...f, Key: dest }];
              return isMovedFolderMarker(f.Key) ? [] : [f];
            }),
            expandedFolders: new Set([...prev.expandedFolders].filter(keepFolderState)),
            loadedFolders: new Set([...prev.loadedFolders].filter(keepFolderState)),
          }));
        }
        if (result.failed.length > 0) {
          showToast({
            message: t('move.partial', { succeeded: result.successful.length, failed: result.failed.length }),
            variant: 'warning',
          });
        } else {
          showToast({
            message: t('move.success', { count: result.successful.length }),
            variant: 'success',
          });
        }
        setSelectedKeys(new Set());
        fetchFiles();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/collision|409/i.test(msg)) {
          showToast({ message: t('move.collision'), variant: 'error' });
        } else {
          showToast({ message: t('move.error', { error: msg }), variant: 'error' });
        }
      } finally {
        setIsMoving(false);
      }
    },
    [showToast, t, fetchFiles]
  );

  const onDropOnSubfolder = useCallback(
    (e: React.DragEvent, folderId: string) => {
      e.preventDefault();
      setDragOverTarget(null);
      const payload = parseDragPayload(e);
      if (!payload) return;
      const basePrefix = 'documents/company/';
      const destPath = folderId.startsWith(basePrefix) ? folderId.slice(basePrefix.length) : folderId;
      executeMove(payload.keys, destPath);
    },
    [executeMove]
  );

  const onDropOnBack = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverTarget(null);
      const payload = parseDragPayload(e);
      if (!payload) return;
      // Back from a subfolder: move files to company KB root.
      executeMove(payload.keys, '');
    },
    [executeMove]
  );

  const onTargetDragOver = useCallback((e: React.DragEvent, targetId: string, enabled: boolean) => {
    if (!enabled) return;
    const types = e.dataTransfer.types;
    if (!types || !Array.from(types).includes('application/json')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTarget(targetId);
  }, []);

  const onTargetDragLeave = useCallback((targetId: string) => {
    setDragOverTarget((prev) => (prev === targetId ? null : prev));
  }, []);

  // ── Build rows ─────────────────────────────────────────────

  const filterPredicate = useMemo(() => {
    const dateCutoff = (() => {
      const now = Date.now();
      if (dateFilter === 'today') return now - 24 * 60 * 60 * 1000;
      if (dateFilter === '7d') return now - 7 * 24 * 60 * 60 * 1000;
      if (dateFilter === '30d') return now - 30 * 24 * 60 * 60 * 1000;
      return 0;
    })();
    const isActive = typeFilter !== 'all' || uploaderFilter !== 'all' || dateFilter !== 'all';
    return {
      isActive,
      predicate: (f: S3Object): boolean => {
        if (typeFilter !== 'all') {
          const filename = f.Key.split('/').pop() ?? '';
          if (getFileTypeCategory(filename) !== typeFilter) return false;
        }
        if (uploaderFilter !== 'all' && (f.uploadedBy ?? '') !== uploaderFilter) return false;
        if (dateCutoff > 0) {
          const ts = f.LastModified ? f.LastModified.getTime() : 0;
          if (ts < dateCutoff) return false;
        }
        return true;
      },
    };
  }, [typeFilter, uploaderFilter, dateFilter]);

  const uploaderOptions = useMemo(() => {
    const set = new Set<string>();
    fileState.files.forEach((f) => f.uploadedBy && set.add(f.uploadedBy));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [fileState.files]);

  const buildRows = useCallback((): TableRow[] => {
    if (fileState.files.length === 0) return [];
    const trimmedSearch = searchValue.trim();
    let tree = buildFileTree(fileState.files);
    if (filterPredicate.isActive) {
      tree = filterTreeByPredicate(tree, filterPredicate.predicate);
    }
    if (trimmedSearch) {
      tree = filterTree(tree, trimmedSearch);
    }
    sortTree(tree, sortColumn, sortDirection);
    const allRows = unwrapSingleRootFolders(buildRowsForTree(tree, 0, '', formatDate, formatSize));
    const effectiveExpanded =
      trimmedSearch || filterPredicate.isActive
        ? new Set([...fileState.expandedFolders, ...collectFoldersToExpand(tree)])
        : fileState.expandedFolders;

    if (currentFolderId) {
      // Find the target folder's children and present them at depth 0
      const flatAll = flattenRows(allRows, effectiveExpanded);
      const folderIdx = flatAll.findIndex((r) => r.id === currentFolderId);
      if (folderIdx === -1) return flattenRows(allRows, effectiveExpanded);
      const folderDepth = flatAll[folderIdx].depth;
      const children: TableRow[] = [];
      for (let i = folderIdx + 1; i < flatAll.length; i++) {
        if (flatAll[i].depth <= folderDepth) break;
        children.push({ ...flatAll[i], depth: flatAll[i].depth - folderDepth - 1 });
      }
      return children;
    }

    return flattenRows(allRows, effectiveExpanded);
  }, [
    fileState.files,
    fileState.expandedFolders,
    sortColumn,
    sortDirection,
    formatDate,
    formatSize,
    currentFolderId,
    searchValue,
    filterPredicate,
  ]);

  // ── File preview / download ────────────────────────────────

  const handleOpenFilePreview = useCallback(
    (ref: FileReference) => {
      openFilePreview(ref);
      if (isMobile) setShowFilePreviewModal(true);
    },
    [openFilePreview, isMobile]
  );

  const handleDownloadFile = useCallback(
    async (s3Key: string, filename: string) => {
      try {
        await downloadFileFromS3(s3Key, dataBucket, region, getCredentials, filename);
      } catch (err) {
        console.error('Error downloading file:', err);
      }
    },
    [dataBucket, region, getCredentials]
  );

  // ── Upload handlers ────────────────────────────────────────

  useEffect(() => {
    if (showUploadModal) {
      const fetchFoldersForUpload = async () => {
        try {
          setLoadingFolders(true);
          const folders = await listFoldersInKB('company', dataBucket, region, getCredentials);
          setFolderOptions(folders);
        } catch {
          setFolderOptions([]);
        } finally {
          setLoadingFolders(false);
        }
      };
      fetchFoldersForUpload();
      setSelectedFolder(uploadInitialFolder);
    }
  }, [showUploadModal, uploadInitialFolder, dataBucket, region, getCredentials]);

  useEffect(() => {
    if (clearFileUploader) {
      const timer = setTimeout(() => setClearFileUploader(false), 100);
      return () => clearTimeout(timer);
    }
  }, [clearFileUploader]);

  function handleFileSelect(selectedFiles: File[]): void {
    const largeDataFiles = selectedFiles.filter((file) => shouldShowLargeDataFileWarning(file));
    if (largeDataFiles.length > 0) {
      setPendingLargeFiles(largeDataFiles);
      setShowNotificationModal(true);
    }
  }

  function handleUploadSuccess(): void {
    setShowNotificationModal(false);
    setPendingLargeFiles([]);
    setShowUploadModal(false);
    setUploadSuccess(true);
    setTimeout(() => setUploadSuccess(false), 3000);
    fetchFiles();
  }

  // ── Delete handlers ─────────────────────────────────────────

  const confirmDeleteFiles = useCallback(
    (keys: string[], label?: string) => {
      // Include .metadata.json sidecars in the delete set.
      const withMeta = keys.flatMap((k) => [k, `${k}.metadata.json`]);
      setDeleteConfirm({
        kind: 'files',
        keys: withMeta,
        label: label ?? t('delete.confirm', { count: keys.length }),
      });
    },
    [t]
  );

  const confirmDeleteSubfolder = useCallback(
    (folderId: string, folderName: string) => {
      const folderPrefix = folderId.endsWith('/') ? folderId : `${folderId}/`;
      if (!folderPrefix.startsWith(COMPANY_KB_PREFIX)) return;
      const path = folderPrefix.slice(COMPANY_KB_PREFIX.length).replace(/\/$/, '');
      if (!path) return;
      const childCount = fileState.files.filter((f) => f.Key.startsWith(folderPrefix) && !f.Key.endsWith('/')).length;
      setDeleteConfirm({
        kind: 'subfolder',
        path,
        label:
          childCount > 0
            ? t('delete.confirmFolder', { name: folderName, count: childCount })
            : t('delete.confirmEmptyFolder', {
                name: folderName,
                defaultValue: `Delete empty folder "${folderName}"?`,
              }),
      });
    },
    [fileState.files, t]
  );

  const executeDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    setIsDeleting(true);
    try {
      if (deleteConfirm.kind === 'subfolder') {
        await knowledgeBaseService.deleteSubfolder('company', deleteConfirm.path, true);
        const folderPrefix = `${COMPANY_KB_PREFIX}${deleteConfirm.path}/`;
        setFileState((prev) => ({
          ...prev,
          files: prev.files.filter((f) => !f.Key.startsWith(folderPrefix)),
          expandedFolders: new Set([...prev.expandedFolders].filter((id) => !id.startsWith(folderPrefix))),
          loadedFolders: new Set([...prev.loadedFolders].filter((id) => !id.startsWith(folderPrefix))),
        }));
        showToast({
          message: t('delete.folderSuccess', { defaultValue: 'Folder deleted' }),
          variant: 'success',
        });
        setSelectedKeys(new Set());
        fetchFiles();
      } else {
        const result = await knowledgeBaseService.deleteKBFiles('company', deleteConfirm.keys);
        const realSucceeded = result.successful.filter((k) => !k.endsWith('.metadata.json')).length;
        const realFailed = result.failed.filter((f) => !f.key.endsWith('.metadata.json')).length;
        // Optimistically remove deleted files from state immediately.
        const deletedSet = new Set(result.successful);
        setFileState((prev) => ({
          ...prev,
          files: prev.files.filter((f) => !deletedSet.has(f.Key)),
        }));
        if (realFailed > 0) {
          showToast({
            message: t('delete.partial', { succeeded: realSucceeded, failed: realFailed }),
            variant: 'warning',
          });
        } else {
          showToast({ message: t('delete.success', { count: realSucceeded }), variant: 'success' });
        }
        setSelectedKeys(new Set());
        fetchFiles();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast({ message: t('delete.error', { error: msg }), variant: 'error' });
    } finally {
      setIsDeleting(false);
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, showToast, t, fetchFiles]);

  // ── Subfolder + context menu ─────────────────────────────────

  const subfolderRelativePath = useCallback((folderId: string): string => {
    if (!folderId.startsWith(COMPANY_KB_PREFIX)) return '';
    return folderId.slice(COMPANY_KB_PREFIX.length).replace(/\/$/, '');
  }, []);

  const currentUploadFolderPath = useMemo(
    () => (currentFolderId ? subfolderRelativePath(currentFolderId) : ''),
    [currentFolderId, subfolderRelativePath]
  );

  const handleExternalUploadDrop = useCallback(
    async (e: React.DragEvent, folderPath: string) => {
      if (!canAdd || !isExternalFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setIsExternalDragOver(false);

      const batch = await extractDroppedUploadBatch(e.dataTransfer, false);
      if (!batch.files.length && !batch.folderRejection) return;

      setUploadInitialFolder(folderPath);
      setSelectedFolder(folderPath);
      setDroppedUploadBatch({ id: Date.now(), ...batch });
      setShowUploadModal(true);
    },
    [canAdd]
  );

  const handleFinderExternalDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!canAdd || !isExternalFileDrag(e)) return;
      e.preventDefault();
      setIsExternalDragOver(true);
    },
    [canAdd]
  );

  const handleFinderExternalDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!canAdd || !isExternalFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsExternalDragOver(true);
    },
    [canAdd]
  );

  const handleFinderExternalDragLeave = useCallback((e: React.DragEvent) => {
    if (!isExternalFileDrag(e)) return;
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsExternalDragOver(false);
    }
  }, []);

  const handleFinderExternalDrop = useCallback(
    (e: React.DragEvent) => {
      if (!canAdd || !isExternalFileDrag(e)) return;
      void handleExternalUploadDrop(e, currentUploadFolderPath);
    },
    [canAdd, currentUploadFolderPath, handleExternalUploadDrop]
  );

  const openAddSubfolder = useCallback((parentPath: string, parentDisplayName: string) => {
    setSubfolderTarget({ parentPath, parentDisplayName });
  }, []);

  const handleSubfolderCreated = useCallback(
    (newPath: string) => {
      setSubfolderTarget(null);
      const newFolderKey = `${COMPANY_KB_PREFIX}${newPath}/`;
      setFileState((prev) => {
        if (prev.files.some((f) => f.Key === newFolderKey)) return prev;
        return {
          ...prev,
          files: [...prev.files, { Key: newFolderKey, LastModified: new Date(), Size: 0 }],
        };
      });
      fetchFiles();
      fetchDeepFiles(true);
      showToast({
        message: t('createSubfolder.success', { defaultValue: 'Folder created' }),
        variant: 'success',
      });
    },
    [fetchFiles, fetchDeepFiles, showToast, t]
  );

  const openFolderContextMenu = useCallback((e: React.MouseEvent, target: FolderContextTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setFolderContextMenu({
      show: true,
      position: { x: e.clientX, y: e.clientY },
      target,
    });
  }, []);

  const closeFolderContextMenu = useCallback(() => {
    setFolderContextMenu(null);
  }, []);

  const handleContextMenuAction = useCallback(
    (action: FolderContextAction) => {
      const ctx = folderContextMenu;
      if (!ctx || ctx.target.kind !== 'subfolder') return;
      const { folderId, folderName } = ctx.target;
      if (action === 'addSubfolder') {
        openAddSubfolder(subfolderRelativePath(folderId), folderName);
      } else if (action === 'delete') {
        confirmDeleteSubfolder(folderId, folderName);
      }
    },
    [folderContextMenu, openAddSubfolder, subfolderRelativePath, confirmDeleteSubfolder]
  );

  // ── Rename handlers ────────────────────────────────────────

  const openRename = useCallback((key: string, currentName: string) => {
    setRenameTarget({ key, currentName });
    setRenameValue(currentName);
  }, []);

  const executeRename = useCallback(async () => {
    if (!renameTarget || !renameValue.trim()) return;
    const trimmed = renameValue.trim();
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      showToast({ message: t('rename.invalidName'), variant: 'error' });
      return;
    }
    setIsRenaming(true);
    try {
      const result = await knowledgeBaseService.renameKBFile('company', renameTarget.key, trimmed);
      // Optimistically swap old key for new key in state.
      setFileState((prev) => ({
        ...prev,
        files: prev.files.map((f) => (f.Key === result.sourceKey ? { ...f, Key: result.destKey } : f)),
      }));
      showToast({ message: t('rename.success', { name: trimmed }), variant: 'success' });
      fetchFiles();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/409|collision/i.test(msg)) {
        showToast({ message: t('rename.collision'), variant: 'error' });
      } else {
        showToast({ message: t('rename.error', { error: msg }), variant: 'error' });
      }
    } finally {
      setIsRenaming(false);
      setRenameTarget(null);
    }
  }, [renameTarget, renameValue, showToast, t, fetchFiles]);

  function handleSortToggle(column: SortColumn): void {
    if (column === sortColumn) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }

  // ── Loading / permission states ────────────────────────────

  if (!canView) {
    return (
      <div className="finder-files">
        <div className="finder-empty">
          <i className="bi bi-lock" />
          <span>{t('remote.comingSoon')}</span>
        </div>
      </div>
    );
  }

  const isInitialLoad = fileState.isLoading && fileState.files.length === 0;

  const rows = isInitialLoad ? [] : buildRows();

  // ── Render ─────────────────────────────────────────────────

  const mainContent = (
    <div
      className={`finder-files ${isExternalDragOver ? 'finder-files--external-drop-over' : ''}`}
      onDragEnter={handleFinderExternalDragEnter}
      onDragOver={handleFinderExternalDragOver}
      onDragLeave={handleFinderExternalDragLeave}
      onDrop={handleFinderExternalDrop}
    >
      {uploadSuccess && (
        <Alert variant="success" dismissible onClose={() => setUploadSuccess(false)} className="mx-3 mt-2 mb-0">
          <i className="bi bi-check-circle me-2" />
          {t('upload.success')}
        </Alert>
      )}

      {/* Toolbar */}
      <div className="finder-toolbar">
        <div className="finder-toolbar__location">
          {currentFolderId ? (
            <>
              <button
                className={`finder-toolbar__back ${dragOverTarget === 'back' ? 'finder-toolbar__back--drop-over' : ''}`}
                onClick={navigateBack}
                onDragOver={(e) => onTargetDragOver(e, 'back', canAdd)}
                onDragLeave={() => onTargetDragLeave('back')}
                onDrop={onDropOnBack}
              >
                <i className="bi bi-chevron-left" />
                {t('tabs.companyFiles')}
              </button>
              <span className="finder-toolbar__title">
                {currentFolderName}
                {isMoving && (
                  <Spinner
                    animation="border"
                    size="sm"
                    variant="secondary"
                    className="ms-2"
                    title={t('move.inProgress')}
                    style={{ width: '0.75rem', height: '0.75rem', verticalAlign: 'middle' }}
                  />
                )}
              </span>
            </>
          ) : (
            <span className="finder-toolbar__title">
              {t('tabs.companyFiles')}
              {(fileState.isLoading || isMoving) && (
                <Spinner
                  animation="border"
                  size="sm"
                  variant="secondary"
                  className="ms-2"
                  title={isMoving ? t('move.inProgress') : undefined}
                  style={{ width: '0.75rem', height: '0.75rem', verticalAlign: 'middle' }}
                />
              )}
              {fileState.truncated && (
                <i
                  className="bi bi-exclamation-triangle-fill ms-2"
                  style={{ fontSize: '0.75rem', color: '#eab308' }}
                  title={t('search.truncatedTooltip')}
                />
              )}
            </span>
          )}
        </div>
        <div className="finder-toolbar__actions">
          <div className="finder-search">
            <i className="bi bi-search finder-search__icon" />
            <input
              type="text"
              placeholder={tKb('fileExplorer.searchPlaceholder')}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
            />
          </div>
          <select
            className="finder-filter-select"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as FileTypeCategory | 'all')}
            title={t('filters.type')}
          >
            <option value="all">
              {t('filters.type')}: {t('filters.all')}
            </option>
            <option value="pdf">{t('filters.types.pdf')}</option>
            <option value="document">{t('filters.types.document')}</option>
            <option value="spreadsheet">{t('filters.types.spreadsheet')}</option>
            <option value="presentation">{t('filters.types.presentation')}</option>
            <option value="text">{t('filters.types.text')}</option>
            <option value="image">{t('filters.types.image')}</option>
            <option value="other">{t('filters.types.other')}</option>
          </select>
          {uploaderOptions.length > 0 && (
            <select
              className="finder-filter-select"
              value={uploaderFilter}
              onChange={(e) => setUploaderFilter(e.target.value)}
              title={t('filters.uploadedBy')}
            >
              <option value="all">
                {t('filters.uploadedBy')}: {t('filters.all')}
              </option>
              {uploaderOptions.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          )}
          <select
            className="finder-filter-select"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as 'all' | 'today' | '7d' | '30d')}
          >
            <option value="all">
              {t('filters.date')}: {t('filters.all')}
            </option>
            <option value="today">{t('filters.dateOptions.today')}</option>
            <option value="7d">{t('filters.dateOptions.last7')}</option>
            <option value="30d">{t('filters.dateOptions.last30')}</option>
          </select>
          {canDelete && selectedKeys.size > 0 && (
            <button
              className="finder-btn finder-btn--danger"
              onClick={() => confirmDeleteFiles(Array.from(selectedKeys))}
              title={t('delete.confirm', { count: selectedKeys.size })}
            >
              <i className="bi bi-trash" />
              <span className="d-none d-sm-inline ms-1">{selectedKeys.size}</span>
            </button>
          )}
          {canAdd && (
            <button
              className="finder-btn finder-btn--primary finder-btn--labelled"
              onClick={() => {
                const parentPath = currentFolderId ? subfolderRelativePath(currentFolderId) : '';
                const parentDisplayName = currentFolderId ? currentFolderName : t('tabs.companyFiles');
                openAddSubfolder(parentPath, parentDisplayName);
              }}
              title={currentFolderId ? t('actions.newSubfolder') : t('actions.newFolder')}
            >
              <i className="bi bi-folder-plus" />
              <span className="finder-btn__label">
                {currentFolderId ? t('actions.newSubfolder') : t('actions.newFolder')}
              </span>
            </button>
          )}
          {canAdd && (
            <button
              className="finder-btn finder-btn--labelled"
              onClick={() => {
                setUploadInitialFolder(currentUploadFolderPath);
                setDroppedUploadBatch(null);
                setShowUploadModal(true);
              }}
              title={t('actions.upload')}
            >
              <i className="bi bi-upload" />
              <span className="finder-btn__label">{t('actions.upload')}</span>
            </button>
          )}
          <button
            className="finder-btn"
            onClick={() => {
              fetchFiles();
              fetchDeepFiles(true);
            }}
          >
            <i className="bi bi-arrow-clockwise" />
          </button>
        </div>
      </div>

      {/* Column headers */}
      <div className="finder-columns finder-grid-6">
        <div
          className={`finder-col ${sortColumn === 'name' ? 'finder-col--active' : ''}`}
          onClick={() => handleSortToggle('name')}
        >
          {tKb('fileExplorer.table.name')}
          {sortColumn === 'name' && <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'}`} />}
        </div>
        <div
          className={`finder-col ${sortColumn === 'type' ? 'finder-col--active' : ''}`}
          onClick={() => handleSortToggle('type')}
        >
          {tKb('fileExplorer.table.type')}
          {sortColumn === 'type' && <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'}`} />}
        </div>
        <div className="finder-col d-none d-lg-flex">{tKb('fileExplorer.table.addedBy')}</div>
        <div
          className={`finder-col d-none d-md-flex ${sortColumn === 'date' ? 'finder-col--active' : ''}`}
          onClick={() => handleSortToggle('date')}
        >
          {tKb('fileExplorer.table.modified')}
          {sortColumn === 'date' && <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'}`} />}
        </div>
        <div
          className={`finder-col d-none d-sm-flex ${sortColumn === 'size' ? 'finder-col--active' : ''}`}
          onClick={() => handleSortToggle('size')}
        >
          {tKb('fileExplorer.table.size')}
          {sortColumn === 'size' && <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'}`} />}
        </div>
        <div className="finder-col"></div>
      </div>

      {/* Search status hints */}
      {isFilterOrSearchActive && isDeepLoading && (
        <div className="finder-search-hint">
          <Spinner animation="border" size="sm" variant="secondary" style={{ width: '0.65rem', height: '0.65rem' }} />
          <span className="text-muted small">{t('search.loadingDeep')}</span>
        </div>
      )}
      {isFilterOrSearchActive && !isDeepLoading && fileState.deepLoaded && (
        <div className="finder-search-hint">
          <i className="bi bi-info-circle text-muted" style={{ fontSize: '0.75rem' }} />
          <span className="text-muted small">{t('search.cachedHint')}</span>
        </div>
      )}

      {/* File list */}
      <div className="finder-list">
        {rows.length === 0 && currentFolderId && fileState.loadingFolders.has(currentFolderId) ? (
          <div className="finder-loading">
            <Spinner animation="border" size="sm" variant="secondary" />
            <span>{tKb('fileExplorer.loadingFiles')}</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="finder-empty">
            <i className="bi bi-folder" />
            <span>{tKb('fileExplorer.empty')}</span>
          </div>
        ) : (
          rows.map((row) => {
            const isFolder = row.type === 'folder';
            const isExpanded = isFolder && fileState.expandedFolders.has(row.id);
            const isLoading = isFolder && fileState.loadingFolders.has(row.id);
            const isFileSelected = !isFolder && !!row.originalKey && selectedKeys.has(row.originalKey);
            const isRowDropTarget = isFolder && dragOverTarget === row.id;

            return (
              <div
                key={row.id}
                className={[
                  'finder-row',
                  'finder-grid-6',
                  isFolder ? 'finder-row--folder' : '',
                  isExpanded ? 'finder-row--expanded' : '',
                  `finder-row--depth-${row.depth}`,
                  isFileSelected ? 'finder-row--selected' : '',
                  isRowDropTarget ? 'finder-row--drop-over' : '',
                  !isFolder ? 'finder-row--file-selectable' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                draggable={(isFolder || !!row.originalKey) && canAdd}
                onDragStart={(e) => {
                  if (isFolder) {
                    onFolderDragStart(e, row.id);
                  } else if (row.originalKey) {
                    onFileDragStart(e, row.originalKey);
                  }
                }}
                onDragOver={(e) => {
                  if (isFolder) onTargetDragOver(e, row.id, canAdd);
                }}
                onDragLeave={() => {
                  if (isFolder) onTargetDragLeave(row.id);
                }}
                onDrop={(e) => {
                  if (!isFolder || !canAdd) return;
                  if (isExternalFileDrag(e)) {
                    void handleExternalUploadDrop(e, subfolderRelativePath(row.id));
                  } else {
                    onDropOnSubfolder(e, row.id);
                  }
                }}
                onContextMenu={(e) => {
                  if (isFolder) {
                    openFolderContextMenu(e, {
                      kind: 'subfolder',
                      kbId: 'company',
                      folderId: row.id,
                      folderName: row.displayName || row.name,
                    });
                  }
                }}
                onClick={(e) => {
                  if (!isFolder && row.originalKey) handleFileClick(row.originalKey, e);
                }}
                onDoubleClick={() => {
                  if (isFolder) {
                    navigateIntoFolder(row.id, row.displayName || row.name);
                  } else if (row.originalKey) {
                    const filename = row.name;
                    const isWc =
                      row.originalKey?.includes('web-crawler/') || row.originalKey?.includes('scraped-content/');
                    const ext = isWc ? 'md' : filename.includes('.') ? filename.split('.').pop() || '' : '';
                    handleOpenFilePreview({
                      filename,
                      fullPath: row.originalKey!,
                      relativePath: row.originalKey!,
                      extension: ext,
                    });
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                <div className="finder-row__name-content">
                  {isFolder ? (
                    isLoading ? (
                      <Spinner
                        animation="border"
                        size="sm"
                        variant="secondary"
                        style={{ width: '0.6rem', height: '0.6rem', flexShrink: 0 }}
                      />
                    ) : (
                      <span className="finder-chevron" onClick={() => toggleSubfolder(row.id)}>
                        <i className={`bi bi-chevron-${isExpanded ? 'down' : 'right'}`} />
                      </span>
                    )
                  ) : (
                    <span className="finder-chevron-spacer" />
                  )}
                  <i
                    className={`bi ${isFolder ? 'bi-folder-fill finder-icon--folder' : 'bi-file-earmark finder-icon--file'} finder-icon`}
                  />
                  <span className="finder-name">{row.displayName || row.name}</span>
                </div>
                <div className="finder-row__meta finder-row__meta--type">
                  {isFolder
                    ? tKb('fileExplorer.table.typeFolder')
                    : row.name.includes('.')
                      ? (row.name.split('.').pop()?.toUpperCase() ?? '')
                      : ''}
                </div>
                <div className="finder-row__meta d-none d-lg-block">{!isFolder ? row.uploadedBy || '' : ''}</div>
                <div className="finder-row__meta d-none d-md-block">{!isFolder ? row.uploadDate : ''}</div>
                <div className="finder-row__meta d-none d-sm-block">
                  {isFolder
                    ? (() => {
                        const prefix = row.id.endsWith('/') ? row.id : `${row.id}/`;
                        const count = fileState.files.filter(
                          (f) => f.Key.startsWith(prefix) && !f.Key.endsWith('/')
                        ).length;
                        return count > 0 ? tKb('fileExplorer.table.items', { count }) : '';
                      })()
                    : row.size}
                </div>
                <div className="finder-row__actions">
                  {!isFolder && row.originalKey && (
                    <>
                      <button
                        onClick={() => {
                          const filename = row.name;
                          const isWc =
                            row.originalKey?.includes('web-crawler/') || row.originalKey?.includes('scraped-content/');
                          const ext = isWc ? 'md' : filename.includes('.') ? filename.split('.').pop() || '' : '';
                          handleOpenFilePreview({
                            filename,
                            fullPath: row.originalKey!,
                            relativePath: row.originalKey!,
                            extension: ext,
                          });
                        }}
                        title={tKb('fileExplorer.actions.previewInPanel')}
                      >
                        <i className="bi bi-eye" />
                      </button>
                      <button
                        onClick={() => handleDownloadFile(row.originalKey!, row.name)}
                        title={tKb('fileExplorer.actions.downloadFile')}
                      >
                        <i className="bi bi-download" />
                      </button>
                      {canAdd && (
                        <button onClick={() => openRename(row.originalKey!, row.name)} title={t('rename.title')}>
                          <i className="bi bi-pencil" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => confirmDeleteFiles([row.originalKey!])}
                          title={t('delete.confirm', { count: 1 })}
                        >
                          <i className="bi bi-trash" />
                        </button>
                      )}
                    </>
                  )}
                  {isFolder && canDelete && (
                    <button
                      onClick={() => confirmDeleteSubfolder(row.id, row.displayName || row.name)}
                      title={t('delete.confirm', { count: 1 })}
                    >
                      <i className="bi bi-trash" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="modal show d-block kb-upload-modal-backdrop" onClick={() => setShowUploadModal(false)}>
          <div
            className="modal-dialog modal-dialog-centered modal-lg kb-upload-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-upload me-2" />
                  {t('upload.title', { name: t('tabs.companyFiles') })}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowUploadModal(false)}
                  aria-label="Close"
                />
              </div>
              <div className="modal-body">
                <p className="text-muted small mb-3">
                  {t('upload.body')}
                  <br />
                  <strong>{t('upload.noteLabel')}</strong> {t('upload.note')}
                </p>
                <FolderSelector
                  selectedFolder={selectedFolder}
                  onFolderChange={setSelectedFolder}
                  folderOptions={folderOptions}
                  disabled={loadingFolders}
                  label={t('upload.folderLabel')}
                />
                <FileUploader
                  onUploadSuccess={handleUploadSuccess}
                  onFileSelect={handleFileSelect}
                  clearFiles={clearFileUploader}
                  kb_id="company"
                  selectedFolder={selectedFolder}
                  enableFolderUpload
                  preloadedFiles={droppedUploadBatch}
                  autoUploadPreloaded
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Large Data File Warning */}
      {showNotificationModal && (
        <NotificationModal
          type="warning"
          title={t('largeFile.title')}
          message={
            <div>
              <p>{t('largeFile.description')}</p>
              <ul className="mb-3">
                {pendingLargeFiles.map((file, i) => (
                  <li key={i}>
                    <strong>{file.name}</strong> ({formatFileSize(file.size)})
                  </li>
                ))}
              </ul>
              <p className="mb-0">{t('largeFile.warning')}</p>
            </div>
          }
          show={showNotificationModal}
          onHide={() => {
            setShowNotificationModal(false);
            setPendingLargeFiles([]);
            setClearFileUploader(true);
          }}
          onConfirm={() => {
            setShowNotificationModal(false);
            setPendingLargeFiles([]);
          }}
          confirmText={t('largeFile.confirmButton')}
          cancelText={t('largeFile.cancelButton')}
          showCancelButton
          size="lg"
        />
      )}

      {/* Delete confirmation modal */}
      <Modal show={!!deleteConfirm} onHide={() => setDeleteConfirm(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{deleteConfirm?.label}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted mb-0">{t('delete.confirmMessage')}</p>
        </Modal.Body>
        <Modal.Footer>
          <button className="btn btn-secondary btn-sm" onClick={() => setDeleteConfirm(null)} disabled={isDeleting}>
            {t('rename.cancel')}
          </button>
          <button className="btn btn-danger btn-sm" onClick={executeDelete} disabled={isDeleting}>
            {isDeleting ? (
              <>
                <Spinner animation="border" size="sm" className="me-1" />
                {t('delete.inProgress')}
              </>
            ) : (
              <>
                <i className="bi bi-trash me-1" />
                {deleteConfirm?.kind === 'subfolder'
                  ? t('delete.deleteFolderButton', { defaultValue: 'Delete folder' })
                  : t('delete.confirm', {
                      count:
                        deleteConfirm?.kind === 'files'
                          ? deleteConfirm.keys.filter((k) => !k.endsWith('.metadata.json')).length
                          : 0,
                    })}
              </>
            )}
          </button>
        </Modal.Footer>
      </Modal>

      {/* Subfolder creation modal */}
      {subfolderTarget && (
        <CreateSubfolderModal
          show
          kbId="company"
          parentPath={subfolderTarget.parentPath}
          parentDisplayName={subfolderTarget.parentDisplayName}
          onHide={() => setSubfolderTarget(null)}
          onSuccess={handleSubfolderCreated}
        />
      )}

      {/* Folder right-click context menu */}
      {folderContextMenu && (
        <FolderContextMenu
          show={folderContextMenu.show}
          position={folderContextMenu.position}
          target={folderContextMenu.target}
          canEdit={canAdd}
          canDeleteTopLevel={false}
          onClose={closeFolderContextMenu}
          onAction={handleContextMenuAction}
        />
      )}

      {/* Rename modal */}
      <Modal show={!!renameTarget} onHide={() => setRenameTarget(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{t('rename.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <label className="form-label small">{t('rename.label')}</label>
          <input
            type="text"
            className="form-control form-control-sm"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') executeRename();
            }}
            placeholder={t('rename.placeholder')}
            autoFocus
          />
        </Modal.Body>
        <Modal.Footer>
          <button className="btn btn-secondary btn-sm" onClick={() => setRenameTarget(null)} disabled={isRenaming}>
            {t('rename.cancel')}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={executeRename}
            disabled={isRenaming || !renameValue.trim() || renameValue.trim() === renameTarget?.currentName}
          >
            {isRenaming ? <Spinner animation="border" size="sm" /> : t('rename.confirm')}
          </button>
        </Modal.Footer>
      </Modal>

      {/* Mobile file preview modal */}
      <Modal
        show={isMobile && showFilePreviewModal && !!filePreview}
        onHide={() => {
          setShowFilePreviewModal(false);
          closeFilePreview();
        }}
        fullscreen
        centered
        scrollable
      >
        <Modal.Header closeButton>
          <Modal.Title>{filePreview?.type === 'file' ? filePreview.filename : ''}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-0">
          {filePreview && (
            <FilePreviewPanel
              preview={filePreview}
              onClose={() => {
                setShowFilePreviewModal(false);
                closeFilePreview();
              }}
              bucket={dataBucket}
              region={region}
              getCredentials={getCredentials}
              embedded
            />
          )}
        </Modal.Body>
      </Modal>
    </div>
  );

  return (
    <ResizableSplitView
      left={mainContent}
      right={
        showFilePreview && filePreview ? (
          <FilePreviewPanel
            preview={filePreview}
            onClose={closeFilePreview}
            bucket={dataBucket}
            region={region}
            getCredentials={getCredentials}
          />
        ) : (
          <div />
        )
      }
      showRight={showFilePreview && !!filePreview && !isMobile}
      leftFraction={filePreviewLeftFraction}
      onLeftFractionChange={setFilePreviewLeftFraction}
      minLeft={300}
      minRight={300}
      rightPadding="0"
    />
  );
}
