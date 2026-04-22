import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Spinner, Alert, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useKnowledgeBase } from '../../Providers/KnowledgeBaseProvider';
import {
  buildFileTree,
  buildRowsForTree,
  unwrapSingleRootFolders,
  flattenRows,
  sortTree,
  formatDateSafe,
  formatSizeSafe,
} from '../KnowledgeBase/KBFileExplorer';
import type { S3Object, TableRow, SortColumn, SortDirection } from '../KnowledgeBase/KBFileExplorer';
import { FileUploader } from '../FileUploader';
import { NotificationModal } from '../NotificationModal';
import FolderSelector from '../KnowledgeBase/FolderSelector';
import { isFileTypeValidForBedrockKB, shouldShowLargeDataFileWarning, formatFileSize } from '../../utils/fileUtils';
import { listFoldersInKB, downloadFileFromS3 } from '../../utils/s3Utils';
import { useAuth } from '../../Providers/AuthProvider';
import { useFilePreviewProcessor } from '../../hooks/useFilePreviewProcessor';
import type { FileReference } from '../../hooks/useFilePreviewProcessor';
import ResizableSplitView from '../ResizableSplitView';
import { FilePreviewPanel } from '../FilePreviewPanel';
import { SYSTEM_KB_IDS, isRootKB } from '../../constants/knowledgeBase';
import type { UserKB } from '../../Services/knowledgeBaseService';
import { knowledgeBaseService } from '../../Services/knowledgeBaseService';
import type { S3FileInfo } from '../../Services/knowledgeBaseService';
import { CreateFolderModal } from './CreateFolderModal';
import { FolderSettingsDrawer } from './FolderSettingsDrawer';

interface UserFilesTabProps {
  onActionChange?: (actions: React.ReactNode) => void;
}

interface KBFileState {
  files: S3Object[];
  isLoading: boolean;
  expandedFolders: Set<string>;
  loadedFolders: Set<string>;
  loadingFolders: Set<string>;
}

/** Where we are navigated to. null = root (all KBs). Set = inside a specific KB. */
interface NavigationState {
  kbId: string;
  kbName: string;
  role: 'VIEWER' | 'EDITOR' | 'OWNER';
  /** Stack of subfolder IDs we've navigated into within this KB */
  subfolderPath: { id: string; name: string }[];
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

export function UserFilesTab({ onActionChange }: UserFilesTabProps): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const { t: tKb } = useTranslation('knowledgeBase');
  const { availableKBs, isLoadingKBs, refreshKBs, fetchKBDetails } = useKnowledgeBase();
  const { getCredentials, region: authRegion, user } = useAuth();

  // Navigation: null = root, set = inside a KB
  const [currentFolder, setCurrentFolder] = useState<NavigationState | null>(null);

  // Inline expansion at root level
  const [expandedKbs, setExpandedKbs] = useState<Set<string>>(new Set());
  // Per-KB file state
  const [kbFileStates, setKbFileStates] = useState<Map<string, KBFileState>>(new Map());

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [settingsKb, setSettingsKb] = useState<UserKB | null>(null);

  const [searchValue, setSearchValue] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Upload
  const [uploadTargetKb, setUploadTargetKb] = useState<UserKB | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [fileValidationError, setFileValidationError] = useState<string | null>(null);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [pendingLargeFiles, setPendingLargeFiles] = useState<File[]>([]);
  const [clearFileUploader, setClearFileUploader] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [folderOptions, setFolderOptions] = useState<string[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);

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

  const userSub = user?.decoded_tokens?.idToken?.sub ?? '';

  // Separate root KB from regular folder KBs
  const rootKB = useMemo(
    () => availableKBs.find((kb) => kb.is_root || (userSub && isRootKB(kb.kb_id, userSub))),
    [availableKBs, userSub]
  );
  const allUserKBs = useMemo(
    () =>
      availableKBs.filter(
        (kb) => !SYSTEM_KB_IDS.has(kb.kb_id) && !(kb.is_root || (userSub && isRootKB(kb.kb_id, userSub)))
      ),
    [availableKBs, userSub]
  );

  // Hide parent page actions -- we handle them in the toolbar
  useEffect(() => {
    onActionChange?.(null);
  }, [onActionChange]);

  // ── Data fetching ──────────────────────────────────────────

  const fetchKbFiles = useCallback(async (kbId: string) => {
    setKbFileStates((prev) => {
      const next = new Map(prev);
      next.set(kbId, {
        files: prev.get(kbId)?.files ?? [],
        isLoading: true,
        expandedFolders: prev.get(kbId)?.expandedFolders ?? new Set(),
        loadedFolders: new Set(),
        loadingFolders: new Set(),
      });
      return next;
    });

    try {
      const { files: fileInfos, folders: folderNames = [] } = await knowledgeBaseService.listKBFiles(kbId);
      const s3Files = apiToS3Objects(fileInfos, folderNames, `documents/kb-${kbId}/`);
      setKbFileStates((prev) => {
        const next = new Map(prev);
        next.set(kbId, {
          files: s3Files,
          isLoading: false,
          expandedFolders: prev.get(kbId)?.expandedFolders ?? new Set(),
          loadedFolders: new Set(),
          loadingFolders: new Set(),
        });
        return next;
      });
    } catch (err) {
      console.error('Failed to fetch KB files:', kbId, err);
      setKbFileStates((prev) => {
        const next = new Map(prev);
        next.set(kbId, {
          files: [],
          isLoading: false,
          expandedFolders: new Set(),
          loadedFolders: new Set(),
          loadingFolders: new Set(),
        });
        return next;
      });
    }
  }, []);

  const ensureKbLoaded = useCallback(
    (kbId: string) => {
      if (!kbFileStates.has(kbId)) {
        fetchKbFiles(kbId);
        fetchKBDetails(kbId);
      }
    },
    [kbFileStates, fetchKbFiles, fetchKBDetails]
  );

  // Auto-load root KB files when at root level
  useEffect(() => {
    if (rootKB && !kbFileStates.has(rootKB.kb_id)) {
      fetchKbFiles(rootKB.kb_id);
    }
  }, [rootKB?.kb_id]);

  // ── Interactions ───────────────────────────────────────────

  /** Chevron click: expand/collapse inline */
  const toggleKbExpansion = useCallback(
    (kbId: string) => {
      setExpandedKbs((prev) => {
        const next = new Set(prev);
        if (next.has(kbId)) {
          next.delete(kbId);
        } else {
          next.add(kbId);
          ensureKbLoaded(kbId);
        }
        return next;
      });
    },
    [ensureKbLoaded]
  );

  /** Double-click: navigate into KB folder */
  const navigateIntoKb = useCallback(
    (kb: UserKB) => {
      setCurrentFolder({ kbId: kb.kb_id, kbName: kb.kb_name, role: kb.role, subfolderPath: [] });
      setSearchValue('');
      ensureKbLoaded(kb.kb_id);
    },
    [ensureKbLoaded]
  );

  const navigateBack = useCallback(() => {
    setCurrentFolder((prev) => {
      if (!prev) return null;
      if (prev.subfolderPath.length > 0) {
        // Go up one subfolder level
        return { ...prev, subfolderPath: prev.subfolderPath.slice(0, -1) };
      }
      // Back to root
      return null;
    });
    setSearchValue('');
    closeFilePreview();
  }, [closeFilePreview]);

  /** Toggle subfolder within a KB */
  const toggleSubfolder = useCallback(
    (kbId: string, folderId: string) => {
      const state = kbFileStates.get(kbId);
      if (!state) return;

      const isExpanding = !state.expandedFolders.has(folderId);

      setKbFileStates((prev) => {
        const next = new Map(prev);
        const s = { ...prev.get(kbId)! };
        const newExpanded = new Set(s.expandedFolders);
        isExpanding ? newExpanded.add(folderId) : newExpanded.delete(folderId);
        next.set(kbId, { ...s, expandedFolders: newExpanded });
        return next;
      });

      if (!isExpanding || state.loadedFolders.has(folderId)) return;

      const basePrefix = `documents/kb-${kbId}/`;
      const basePrefixNoSlash = basePrefix.replace(/\/$/, '');
      const subpath = folderId.startsWith(basePrefixNoSlash) ? folderId.slice(basePrefixNoSlash.length + 1) : folderId;

      setKbFileStates((prev) => {
        const next = new Map(prev);
        const s = { ...prev.get(kbId)! };
        s.loadingFolders = new Set(s.loadingFolders).add(folderId);
        next.set(kbId, s);
        return next;
      });

      knowledgeBaseService
        .listKBFiles(kbId, subpath)
        .then(({ files: fileInfos, folders: folderNames = [] }) => {
          const folderPrefix = `${basePrefix}${subpath}/`.replace(/\/{2,}/g, '/');
          const s3Files = apiToS3Objects(fileInfos, folderNames, folderPrefix);

          setKbFileStates((prev) => {
            const next = new Map(prev);
            const s = { ...prev.get(kbId)! };
            const existingKeys = new Set(s.files.map((f) => f.Key));
            const merged = [...s.files, ...s3Files.filter((f) => !existingKeys.has(f.Key))];
            const newLoading = new Set(s.loadingFolders);
            newLoading.delete(folderId);
            next.set(kbId, {
              ...s,
              files: merged,
              loadedFolders: new Set(s.loadedFolders).add(folderId),
              loadingFolders: newLoading,
            });
            return next;
          });
        })
        .catch((err) => {
          console.error('Failed to load subfolder', folderId, err);
          setKbFileStates((prev) => {
            const next = new Map(prev);
            const s = { ...prev.get(kbId)! };
            const newLoading = new Set(s.loadingFolders);
            newLoading.delete(folderId);
            next.set(kbId, { ...s, loadingFolders: newLoading });
            return next;
          });
        });
    },
    [kbFileStates]
  );

  /** Double-click: navigate into a subfolder within a KB */
  const navigateIntoSubfolder = useCallback(
    (kbId: string, folderId: string, folderName: string) => {
      // Ensure the folder is expanded and loaded
      const state = kbFileStates.get(kbId);
      if (state && !state.expandedFolders.has(folderId)) {
        toggleSubfolder(kbId, folderId);
      }
      setCurrentFolder((prev) => {
        if (!prev) return prev;
        return { ...prev, subfolderPath: [...prev.subfolderPath, { id: folderId, name: folderName }] };
      });
      setSearchValue('');
    },
    [kbFileStates, toggleSubfolder]
  );

  /** Build child rows for a KB */
  const buildKbChildRows = useCallback(
    (kbId: string, startDepth: number): TableRow[] => {
      const state = kbFileStates.get(kbId);
      if (!state || state.files.length === 0) return [];
      const tree = buildFileTree(state.files);
      sortTree(tree, sortColumn, sortDirection);
      const nested = unwrapSingleRootFolders(buildRowsForTree(tree, startDepth, '', formatDate, formatSize));
      return flattenRows(nested, state.expandedFolders);
    },
    [kbFileStates, sortColumn, sortDirection, formatDate, formatSize]
  );

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
    if (showUploadModal && uploadTargetKb) {
      const fetchFoldersForUpload = async () => {
        try {
          setLoadingFolders(true);
          const folders = await listFoldersInKB(
            uploadTargetKb.kb_id,
            `numa-${CLIENT_NAME}-data`,
            region,
            getCredentials
          );
          setFolderOptions(folders);
        } catch {
          setFolderOptions([]);
        } finally {
          setLoadingFolders(false);
        }
      };
      fetchFoldersForUpload();
      setSelectedFolder('');
    }
  }, [showUploadModal, uploadTargetKb, CLIENT_NAME, region, getCredentials]);

  useEffect(() => {
    if (clearFileUploader) {
      const timer = setTimeout(() => setClearFileUploader(false), 100);
      return () => clearTimeout(timer);
    }
  }, [clearFileUploader]);

  function validateFiles(files: File[]): boolean {
    const invalidFiles = files.filter((file) => !isFileTypeValidForBedrockKB(file));
    if (invalidFiles.length > 0) {
      setFileValidationError(t('validation.unsupportedFiles', { files: invalidFiles.map((f) => f.name).join(', ') }));
      return false;
    }
    setFileValidationError(null);
    return true;
  }

  function handleFileSelect(selectedFiles: File[]): void {
    if (!validateFiles(selectedFiles)) return;
    const largeDataFiles = selectedFiles.filter((file) => shouldShowLargeDataFileWarning(file));
    if (largeDataFiles.length > 0) {
      setPendingLargeFiles(largeDataFiles);
      setShowNotificationModal(true);
    }
  }

  function handleUploadSuccess(): void {
    setFileValidationError(null);
    setShowNotificationModal(false);
    setPendingLargeFiles([]);
    setShowUploadModal(false);
    setUploadSuccess(true);
    setTimeout(() => setUploadSuccess(false), 3000);
    if (uploadTargetKb) fetchKbFiles(uploadTargetKb.kb_id);
  }

  const handleFolderCreated = useCallback(() => refreshKBs(), [refreshKBs]);
  const handleFolderDeleted = useCallback(() => {
    if (settingsKb) {
      setExpandedKbs((prev) => {
        const n = new Set(prev);
        n.delete(settingsKb.kb_id);
        return n;
      });
      if (currentFolder?.kbId === settingsKb.kb_id) setCurrentFolder(null);
    }
    refreshKBs();
  }, [refreshKBs, settingsKb, currentFolder]);

  const openSettings = useCallback((kb: UserKB, e: React.MouseEvent) => {
    e.stopPropagation();
    setSettingsKb(kb);
    setShowSettingsDrawer(true);
  }, []);

  const openUploadForKb = useCallback((kb: UserKB, e: React.MouseEvent) => {
    e.stopPropagation();
    setUploadTargetKb(kb);
    setShowUploadModal(true);
  }, []);

  function handleSortToggle(column: SortColumn): void {
    if (column === sortColumn) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }

  // ── Loading / empty states ─────────────────────────────────

  const isInitialLoad = isLoadingKBs;
  const isRootKbLoading = rootKB ? (kbFileStates.get(rootKB.kb_id)?.isLoading ?? false) : false;

  // Only show empty state if there are no folders AND no root files
  const rootState = rootKB ? kbFileStates.get(rootKB.kb_id) : undefined;
  const hasRootFiles = rootState && rootState.files.length > 0;
  if (allUserKBs.length === 0 && !hasRootFiles && !rootState?.isLoading) {
    return (
      <div className="finder-files">
        <div className="finder-empty">
          <i className="bi bi-folder" />
          <span>{t('folderList.empty.title')}</span>
          <div className="d-flex gap-2 mt-2">
            <button className="finder-btn finder-btn--primary" onClick={() => setShowCreateModal(true)}>
              <i className="bi bi-folder-plus" /> {t('actions.newFolder')}
            </button>
            {rootKB && (
              <button className="finder-btn finder-btn--primary" onClick={(e) => openUploadForKb(rootKB, e)}>
                <i className="bi bi-upload" /> {t('rootFiles.upload')}
              </button>
            )}
          </div>
        </div>
        <CreateFolderModal
          show={showCreateModal}
          onHide={() => setShowCreateModal(false)}
          onSuccess={handleFolderCreated}
        />
      </div>
    );
  }

  // ── Build rows ─────────────────────────────────────────────

  const isInsideFolder = currentFolder !== null;
  const currentKb = isInsideFolder
    ? (allUserKBs.find((kb) => kb.kb_id === currentFolder.kbId) ??
      (rootKB && currentFolder.kbId === rootKB.kb_id ? rootKB : null))
    : null;
  const canEditCurrent = currentKb && (currentKb.role === 'OWNER' || currentKb.role === 'EDITOR');

  type RowEntry = {
    row: TableRow;
    kbId: string;
    isKbFolder: boolean;
    kb?: UserKB;
    special?: 'loading' | 'empty';
  };

  const rows: RowEntry[] = [];

  if (isInsideFolder) {
    // Inside a specific KB -- show its contents at depth 0
    const kbState = kbFileStates.get(currentFolder.kbId);
    if (kbState?.isLoading) {
      rows.push({
        row: { id: 'loading', type: 'file', name: '', depth: 0, uploadDate: '', size: '', status: 'pending' },
        kbId: currentFolder.kbId,
        isKbFolder: false,
        special: 'loading',
      });
    } else {
      let childRows = buildKbChildRows(currentFolder.kbId, 0);

      // If we've navigated into subfolders, drill down to the target
      if (currentFolder.subfolderPath.length > 0) {
        const allFlat = childRows;
        const targetFolderId = currentFolder.subfolderPath[currentFolder.subfolderPath.length - 1].id;
        const folderIdx = allFlat.findIndex((r) => r.id === targetFolderId);
        if (folderIdx !== -1) {
          const folderDepth = allFlat[folderIdx].depth;
          const children: TableRow[] = [];
          for (let i = folderIdx + 1; i < allFlat.length; i++) {
            if (allFlat[i].depth <= folderDepth) break;
            children.push({ ...allFlat[i], depth: allFlat[i].depth - folderDepth - 1 });
          }
          childRows = children;
        }
      }

      if (childRows.length === 0 && kbState) {
        rows.push({
          row: { id: 'empty', type: 'file', name: '', depth: 0, uploadDate: '', size: '', status: 'indexed' },
          kbId: currentFolder.kbId,
          isKbFolder: false,
          special: 'empty',
        });
      } else {
        for (const r of childRows) rows.push({ row: r, kbId: currentFolder.kbId, isKbFolder: false });
      }
    }
  } else {
    // Root view -- root files at depth 0, then KB folders at depth 0

    // Show root files (loose files not in any folder) at the top
    if (rootKB) {
      const rootState = kbFileStates.get(rootKB.kb_id);
      if (rootState && !rootState.isLoading) {
        const rootChildRows = buildKbChildRows(rootKB.kb_id, 0);
        // Only show file rows (not folders) as root-level loose files
        for (const r of rootChildRows) {
          if (r.type === 'file') {
            rows.push({ row: r, kbId: rootKB.kb_id, isKbFolder: false });
          }
        }
      }
    }

    // Then show KB folders
    for (const kb of allUserKBs) {
      const isExpanded = expandedKbs.has(kb.kb_id);
      rows.push({
        row: {
          id: `kb-${kb.kb_id}`,
          type: 'folder',
          name: kb.kb_name,
          depth: 0,
          uploadDate: '\u2014',
          size: '\u2014',
          status: 'indexed',
        },
        kbId: kb.kb_id,
        isKbFolder: true,
        kb,
      });

      if (isExpanded) {
        const kbState = kbFileStates.get(kb.kb_id);
        if (kbState?.isLoading) {
          rows.push({
            row: {
              id: `kb-${kb.kb_id}-loading`,
              type: 'file',
              name: '',
              depth: 1,
              uploadDate: '',
              size: '',
              status: 'pending',
            },
            kbId: kb.kb_id,
            isKbFolder: false,
            special: 'loading',
          });
        } else {
          const childRows = buildKbChildRows(kb.kb_id, 1);
          if (childRows.length === 0 && kbState) {
            rows.push({
              row: {
                id: `kb-${kb.kb_id}-empty`,
                type: 'file',
                name: '',
                depth: 1,
                uploadDate: '',
                size: '',
                status: 'indexed',
              },
              kbId: kb.kb_id,
              isKbFolder: false,
              special: 'empty',
            });
          } else {
            for (const r of childRows) rows.push({ row: r, kbId: kb.kb_id, isKbFolder: false });
          }
        }
      }
    }
  }

  // ── Render ─────────────────────────────────────────────────

  const mainContent = (
    <div className="finder-files">
      {uploadSuccess && (
        <Alert variant="success" dismissible onClose={() => setUploadSuccess(false)} className="mx-3 mt-2 mb-0">
          <i className="bi bi-check-circle me-2" />
          {t('upload.success')}
        </Alert>
      )}

      {/* Toolbar */}
      <div className="finder-toolbar">
        <div className="finder-toolbar__location">
          {isInsideFolder ? (
            <>
              <button className="finder-toolbar__back" onClick={navigateBack}>
                <i className="bi bi-chevron-left" />
                {currentFolder.subfolderPath.length > 0
                  ? currentFolder.subfolderPath.length === 1
                    ? currentFolder.kbName
                    : currentFolder.subfolderPath[currentFolder.subfolderPath.length - 2].name
                  : t('breadcrumb.userFiles')}
              </button>
              <span className="finder-toolbar__title">
                {currentFolder.subfolderPath.length > 0
                  ? currentFolder.subfolderPath[currentFolder.subfolderPath.length - 1].name
                  : currentFolder.kbName}
              </span>
            </>
          ) : (
            <span className="finder-toolbar__title">
              {t('tabs.userFiles')}
              {(isInitialLoad || isRootKbLoading) && (
                <Spinner
                  animation="border"
                  size="sm"
                  variant="secondary"
                  className="ms-2"
                  style={{ width: '0.75rem', height: '0.75rem', verticalAlign: 'middle' }}
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
          {(!isInsideFolder || canEditCurrent) && (
            <button className="finder-btn" onClick={() => setShowCreateModal(true)}>
              <i className="bi bi-folder-plus" />
            </button>
          )}
          {/* Upload button: at root level (uploads to root KB) or inside a folder */}
          {!isInsideFolder && rootKB ? (
            <button className="finder-btn" onClick={(e) => openUploadForKb(rootKB, e)} title={t('rootFiles.upload')}>
              <i className="bi bi-upload" />
            </button>
          ) : isInsideFolder && canEditCurrent && currentKb ? (
            <button className="finder-btn" onClick={(e) => openUploadForKb(currentKb, e)}>
              <i className="bi bi-upload" />
            </button>
          ) : null}
          <button
            className="finder-btn"
            onClick={() => {
              if (isInsideFolder) {
                fetchKbFiles(currentFolder!.kbId);
              } else {
                if (rootKB) fetchKbFiles(rootKB.kb_id);
                expandedKbs.forEach((kbId) => fetchKbFiles(kbId));
              }
            }}
          >
            <i className="bi bi-arrow-clockwise" />
          </button>
        </div>
      </div>

      {/* Column headers */}
      <div className="finder-columns finder-grid-5">
        <div
          className={`finder-col ${sortColumn === 'name' ? 'finder-col--active' : ''}`}
          onClick={() => handleSortToggle('name')}
        >
          {tKb('fileExplorer.table.name')}
          {sortColumn === 'name' && <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'}`} />}
        </div>
        <div className="finder-col d-none d-lg-flex">{tKb('fileExplorer.table.addedBy')}</div>
        <div
          className={`finder-col d-none d-md-flex ${sortColumn === 'date' ? 'finder-col--active' : ''}`}
          onClick={() => handleSortToggle('date')}
        >
          {tKb('fileExplorer.table.uploadDate')}
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

      {/* File list */}
      <div className="finder-list">
        {rows.map(({ row, kbId, isKbFolder, kb, special }) => {
          if (special === 'loading') {
            return (
              <div key={row.id} className="finder-loading">
                <Spinner animation="border" size="sm" variant="secondary" />
                <span>{tKb('fileExplorer.loadingFiles')}</span>
              </div>
            );
          }
          if (special === 'empty') {
            return (
              <div key={row.id} className="finder-empty" style={{ padding: '1.5rem' }}>
                <i className="bi bi-inbox" style={{ fontSize: '1.5rem' }} />
                <span>{tKb('fileExplorer.empty')}</span>
              </div>
            );
          }

          const isFolder = row.type === 'folder';
          const kbState = kbFileStates.get(kbId);

          // KB folder row at root level
          if (isKbFolder && kb) {
            const isExpanded = expandedKbs.has(kb.kb_id);
            const isShared = kb.is_shared || kb.role === 'VIEWER';
            const isOwner = kb.role === 'OWNER';
            const isEditor = kb.role === 'EDITOR';
            const canEdit = isOwner || isEditor;

            return (
              <div
                key={row.id}
                className={`finder-row finder-row--folder finder-grid-5 ${isExpanded ? 'finder-row--expanded' : ''}`}
                onDoubleClick={() => navigateIntoKb(kb)}
              >
                <div className="finder-row__name-content">
                  <span
                    className="finder-chevron"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleKbExpansion(kb.kb_id);
                    }}
                  >
                    <i className={`bi bi-chevron-${isExpanded ? 'down' : 'right'}`} />
                  </span>
                  <i className="bi bi-folder-fill finder-icon finder-icon--folder" />
                  <span className="finder-name">{kb.kb_name}</span>
                  {isShared ? (
                    <i
                      className="bi bi-people-fill"
                      style={{ fontSize: '0.7rem', color: '#86868b' }}
                      title={isOwner ? t('folderList.sharing') : t('folderList.sharedWithYou')}
                    />
                  ) : (
                    <i
                      className="bi bi-person-fill"
                      style={{ fontSize: '0.7rem', color: '#86868b' }}
                      title={t('folderList.private')}
                    />
                  )}
                  {!isOwner && (
                    <span className="finder-row__badge">{isEditor ? t('badges.editor') : t('badges.viewer')}</span>
                  )}
                </div>
                <div className="finder-row__meta d-none d-lg-block"></div>
                <div className="finder-row__meta d-none d-md-block"></div>
                <div className="finder-row__meta d-none d-sm-block">
                  {kb.document_count != null && kb.document_count > 0
                    ? `${kb.document_count} ${kb.document_count === 1 ? 'item' : 'items'}`
                    : ''}
                </div>
                <div className="finder-row__actions">
                  {canEdit && (
                    <>
                      <button onClick={(e) => openUploadForKb(kb, e)} title={t('actions.uploadFiles')}>
                        <i className="bi bi-upload" />
                      </button>
                      <button onClick={(e) => openSettings(kb, e)} title={t('folderList.settings')}>
                        <i className="bi bi-gear" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          }

          // Child rows (files and subfolders)
          const isSubfolder = isFolder;
          const isSubfolderExpanded = isSubfolder && (kbState?.expandedFolders.has(row.id) ?? false);
          const isSubfolderLoading = isSubfolder && (kbState?.loadingFolders.has(row.id) ?? false);

          return (
            <div
              key={row.id}
              className={`finder-row finder-grid-5 ${isSubfolder ? 'finder-row--folder' : ''} finder-row--depth-${row.depth}`}
              onDoubleClick={() => {
                if (isSubfolder) {
                  navigateIntoSubfolder(kbId, row.id, row.displayName || row.name);
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
                {isSubfolder ? (
                  isSubfolderLoading ? (
                    <Spinner
                      animation="border"
                      size="sm"
                      variant="secondary"
                      style={{ width: '0.6rem', height: '0.6rem', flexShrink: 0 }}
                    />
                  ) : (
                    <span className="finder-chevron" onClick={() => toggleSubfolder(kbId, row.id)}>
                      <i className={`bi bi-chevron-${isSubfolderExpanded ? 'down' : 'right'}`} />
                    </span>
                  )
                ) : (
                  <span className="finder-chevron-spacer" />
                )}
                <i
                  className={`bi ${isSubfolder ? 'bi-folder-fill finder-icon--folder' : 'bi-file-earmark finder-icon--file'} finder-icon`}
                />
                <span className="finder-name">{row.displayName || row.name}</span>
              </div>
              <div className="finder-row__meta d-none d-lg-block">{!isSubfolder ? row.uploadedBy || '' : ''}</div>
              <div className="finder-row__meta d-none d-md-block">{!isSubfolder ? row.uploadDate : ''}</div>
              <div className="finder-row__meta d-none d-sm-block">{!isSubfolder ? row.size : ''}</div>
              <div className="finder-row__actions">
                {!isSubfolder && row.originalKey && (
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
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modals */}

      <CreateFolderModal
        show={showCreateModal}
        onHide={() => setShowCreateModal(false)}
        onSuccess={handleFolderCreated}
      />

      {settingsKb && (
        <FolderSettingsDrawer
          show={showSettingsDrawer}
          onHide={() => setShowSettingsDrawer(false)}
          kbId={settingsKb.kb_id}
          kbName={settingsKb.kb_name}
          onDeleted={handleFolderDeleted}
        />
      )}

      {showUploadModal && uploadTargetKb && (
        <div className="modal show d-block kb-upload-modal-backdrop" onClick={() => setShowUploadModal(false)}>
          <div
            className="modal-dialog modal-dialog-centered modal-lg kb-upload-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-upload me-2" />
                  {t('upload.title', { name: uploadTargetKb.kb_name })}
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
                {fileValidationError && (
                  <Alert variant="danger" className="mb-3">
                    <strong>{t('upload.validationTitle')}</strong>
                    <p className="mb-0 mt-1">{fileValidationError}</p>
                  </Alert>
                )}
                <FileUploader
                  onUploadSuccess={handleUploadSuccess}
                  onFileSelect={handleFileSelect}
                  validateFile={isFileTypeValidForBedrockKB}
                  clearFiles={clearFileUploader}
                  kb_id={uploadTargetKb.kb_id}
                  selectedFolder={selectedFolder}
                  enableFolderUpload
                />
              </div>
            </div>
          </div>
        </div>
      )}

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
