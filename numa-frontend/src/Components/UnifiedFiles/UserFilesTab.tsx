import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Table, Badge, Button, Spinner, Alert, OverlayTrigger, Tooltip, Modal, Form } from 'react-bootstrap';
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
  safeDecodeURIComponent,
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
import { SYSTEM_KB_IDS } from '../../constants/knowledgeBase';
import type { UserKB } from '../../Services/knowledgeBaseService';
import { knowledgeBaseService } from '../../Services/knowledgeBaseService';
import type { S3FileInfo } from '../../Services/knowledgeBaseService';
import { CreateFolderModal } from './CreateFolderModal';
import { FolderSettingsDrawer } from './FolderSettingsDrawer';
import i18n from '../../i18n';

interface UserFilesTabProps {
  onActionChange?: (actions: React.ReactNode) => void;
}

/** Per-KB file data state */
interface KBFileState {
  files: S3Object[];
  isLoading: boolean;
  expandedFolders: Set<string>;
  loadedFolders: Set<string>;
  loadingFolders: Set<string>;
}

/** Convert API response to S3Objects, matching KBFileExplorer's pattern */
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
    const markerKey = `${parentPrefix}${folder}/`;
    s3Files.push({ Key: markerKey, LastModified: new Date(), Size: 0 });
  }

  return s3Files;
}

export function UserFilesTab({ onActionChange }: UserFilesTabProps): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const { t: tKb } = useTranslation('knowledgeBase');
  const { availableKBs, isLoadingKBs, refreshKBs, fetchKBDetails } = useKnowledgeBase();
  const { getCredentials, region: authRegion } = useAuth();

  // Which KBs are expanded (top-level folders)
  const [expandedKbs, setExpandedKbs] = useState<Set<string>>(new Set());
  // Per-KB file data
  const [kbFileStates, setKbFileStates] = useState<Map<string, KBFileState>>(new Map());

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [settingsKb, setSettingsKb] = useState<UserKB | null>(null);

  // Search and sort
  const [searchValue, setSearchValue] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Upload state
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

  const allUserKBs = useMemo(() => availableKBs.filter((kb) => !SYSTEM_KB_IDS.has(kb.kb_id)), [availableKBs]);

  // Update parent action buttons
  useEffect(() => {
    if (!onActionChange) return;
    onActionChange(
      <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
        <i className="bi bi-folder-plus me-2" />
        {t('actions.newFolder')}
      </Button>
    );
  }, [onActionChange, t]);

  /** Fetch files for a KB */
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
      const basePrefix = `documents/kb-${kbId}/`;
      const s3Files = apiToS3Objects(fileInfos, folderNames, basePrefix);

      setKbFileStates((prev) => {
        const next = new Map(prev);
        const existing = prev.get(kbId);
        next.set(kbId, {
          files: s3Files,
          isLoading: false,
          expandedFolders: existing?.expandedFolders ?? new Set(),
          loadedFolders: new Set(),
          loadingFolders: new Set(),
        });
        return next;
      });
    } catch (err) {
      console.error('Failed to fetch KB files:', kbId, err);
      setKbFileStates((prev) => {
        const next = new Map(prev);
        const existing = prev.get(kbId);
        next.set(kbId, {
          ...(existing ?? {
            files: [],
            expandedFolders: new Set(),
            loadedFolders: new Set(),
            loadingFolders: new Set(),
          }),
          isLoading: false,
        });
        return next;
      });
    }
  }, []);

  /** Toggle a top-level KB folder */
  const toggleKbExpansion = useCallback(
    (kb: UserKB) => {
      const kbId = kb.kb_id;
      setExpandedKbs((prev) => {
        const next = new Set(prev);
        if (next.has(kbId)) {
          next.delete(kbId);
        } else {
          next.add(kbId);
          fetchKBDetails(kbId);
          // Fetch files if not already loaded
          if (!kbFileStates.has(kbId)) {
            fetchKbFiles(kbId);
          }
        }
        return next;
      });
    },
    [fetchKBDetails, kbFileStates, fetchKbFiles]
  );

  /** Toggle a subfolder within a KB */
  const toggleSubfolder = useCallback(
    (kbId: string, folderId: string) => {
      const state = kbFileStates.get(kbId);
      if (!state) return;

      const isExpanding = !state.expandedFolders.has(folderId);

      // Toggle visual expand/collapse
      setKbFileStates((prev) => {
        const next = new Map(prev);
        const s = { ...prev.get(kbId)! };
        const newExpanded = new Set(s.expandedFolders);
        if (isExpanding) {
          newExpanded.add(folderId);
        } else {
          newExpanded.delete(folderId);
        }
        next.set(kbId, { ...s, expandedFolders: newExpanded });
        return next;
      });

      // Lazy load if expanding and not yet loaded
      if (!isExpanding || state.loadedFolders.has(folderId)) return;

      const basePrefix = `documents/kb-${kbId}/`;
      const basePrefixNoSlash = basePrefix.replace(/\/$/, '');
      const subpath = folderId.startsWith(basePrefixNoSlash) ? folderId.slice(basePrefixNoSlash.length + 1) : folderId;

      // Mark as loading
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
            const merged = [...s.files];
            for (const f of s3Files) {
              if (!existingKeys.has(f.Key)) merged.push(f);
            }
            s.files = merged;
            s.loadedFolders = new Set(s.loadedFolders).add(folderId);
            const newLoading = new Set(s.loadingFolders);
            newLoading.delete(folderId);
            s.loadingFolders = newLoading;
            next.set(kbId, s);
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
            s.loadingFolders = newLoading;
            next.set(kbId, s);
            return next;
          });
        });
    },
    [kbFileStates]
  );

  /** Build flattened rows for an expanded KB (child rows at depth 1+) */
  const buildKbChildRows = useCallback(
    (kbId: string): TableRow[] => {
      const state = kbFileStates.get(kbId);
      if (!state || state.files.length === 0) return [];

      const tree = buildFileTree(state.files);
      sortTree(tree, sortColumn, sortDirection);
      // Build rows starting at depth 1 (since depth 0 is the KB folder itself)
      const nested = unwrapSingleRootFolders(buildRowsForTree(tree, 1, '', formatDate, formatSize));
      return flattenRows(nested, state.expandedFolders);
    },
    [kbFileStates, sortColumn, sortDirection, formatDate, formatSize]
  );

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

  // Upload handlers
  useEffect(() => {
    if (showUploadModal && uploadTargetKb) {
      const fetchFoldersForUpload = async () => {
        try {
          setLoadingFolders(true);
          const bucket = `numa-${CLIENT_NAME}-data`;
          const folders = await listFoldersInKB(uploadTargetKb.kb_id, bucket, region, getCredentials);
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
    if (uploadTargetKb) {
      fetchKbFiles(uploadTargetKb.kb_id);
    }
  }

  const handleFolderCreated = useCallback(() => {
    refreshKBs();
  }, [refreshKBs]);

  const handleFolderDeleted = useCallback(() => {
    if (settingsKb) {
      setExpandedKbs((prev) => {
        const next = new Set(prev);
        next.delete(settingsKb.kb_id);
        return next;
      });
    }
    refreshKBs();
  }, [refreshKBs, settingsKb]);

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

  // Loading state
  if (isLoadingKBs) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" variant="primary" />
        <p className="mt-3 text-muted">{t('folderList.loading')}</p>
      </div>
    );
  }

  // Empty state
  if (allUserKBs.length === 0) {
    return (
      <div className="text-center py-5">
        <i className="bi bi-folder display-1 text-muted" />
        <h5 className="mt-3 text-muted">{t('folderList.empty.title')}</h5>
        <p className="text-muted">{t('folderList.empty.message')}</p>
        <Button variant="primary" onClick={() => setShowCreateModal(true)}>
          <i className="bi bi-folder-plus me-2" />
          {t('actions.newFolder')}
        </Button>
        <CreateFolderModal
          show={showCreateModal}
          onHide={() => setShowCreateModal(false)}
          onSuccess={handleFolderCreated}
        />
      </div>
    );
  }

  // Build all rows: KB folders at depth 0 + their children at depth 1+
  const allRows: { row: TableRow; kbId: string; isKbFolder: boolean; kb?: UserKB }[] = [];
  for (const kb of allUserKBs) {
    const isExpanded = expandedKbs.has(kb.kb_id);
    const kbState = kbFileStates.get(kb.kb_id);

    // KB folder row at depth 0
    allRows.push({
      row: {
        id: `kb-${kb.kb_id}`,
        type: 'folder',
        name: kb.kb_name,
        depth: 0,
        uploadDate: '\u2014',
        size: '\u2014',
        status: 'indexed',
        children: [],
      },
      kbId: kb.kb_id,
      isKbFolder: true,
      kb,
    });

    // If expanded, add loading row or child rows
    if (isExpanded) {
      if (kbState?.isLoading) {
        allRows.push({
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
        });
      } else {
        const childRows = buildKbChildRows(kb.kb_id);
        for (const childRow of childRows) {
          allRows.push({
            row: childRow,
            kbId: kb.kb_id,
            isKbFolder: false,
          });
        }
        // Empty folder state
        if (childRows.length === 0 && kbState && !kbState.isLoading) {
          allRows.push({
            row: {
              id: `kb-${kb.kb_id}-empty`,
              type: 'file',
              name: tKb('fileExplorer.empty'),
              depth: 1,
              uploadDate: '',
              size: '',
              status: 'indexed',
            },
            kbId: kb.kb_id,
            isKbFolder: false,
          });
        }
      }
    }
  }

  // Main content
  const mainContent = (
    <div className="py-3 kb-file-explorer">
      {uploadSuccess && (
        <Alert variant="success" dismissible onClose={() => setUploadSuccess(false)} className="mb-3">
          <i className="bi bi-check-circle me-2" />
          {t('upload.success')}
        </Alert>
      )}

      {/* Action Bar - matching KBFileExplorer's layout */}
      <div className="mb-3 p-3 bg-light rounded">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-3">
          <div className="d-flex align-items-center gap-3 flex-wrap">
            <Form.Control
              type="text"
              placeholder={tKb('fileExplorer.searchPlaceholder')}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className="flex-shrink-0"
              style={{ width: '250px', minWidth: '150px' }}
            />
          </div>
          <div className="d-flex flex-wrap align-items-center gap-2">
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => setShowCreateModal(true)}
              className="text-nowrap"
            >
              <i className="bi bi-folder-plus me-1" />
              <span className="d-none d-sm-inline">{tKb('fileExplorer.actions.newFolder')}</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                // Refresh all expanded KBs
                expandedKbs.forEach((kbId) => fetchKbFiles(kbId));
              }}
              className="text-nowrap"
            >
              <i className="bi bi-arrow-clockwise me-1" />
              <span className="d-none d-sm-inline">{tKb('fileExplorer.actions.refresh')}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* File Table */}
      <div className="file-table-container">
        <Table hover size="sm" className="mb-0 file-table">
          <thead className="sticky-table-header numa-table-header">
            <tr>
              <th
                className="sortable-header"
                onClick={() => handleSortToggle('name')}
                style={{
                  width: '40%',
                  minWidth: '150px',
                  maxWidth: '300px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <div className="d-flex align-items-center justify-content-between">
                  <span className="text-truncate">{tKb('fileExplorer.table.name')}</span>
                  {sortColumn === 'name' && (
                    <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'} ms-1 flex-shrink-0`} />
                  )}
                </div>
              </th>
              <th className="d-none d-lg-table-cell" style={{ width: '150px', minWidth: '100px', maxWidth: '200px' }}>
                <span>{tKb('fileExplorer.table.addedBy')}</span>
              </th>
              <th
                className="sortable-header d-none d-md-table-cell"
                onClick={() => handleSortToggle('date')}
                style={{ width: '140px', minWidth: '120px', maxWidth: '160px' }}
              >
                <div className="d-flex align-items-center justify-content-between">
                  <span className="text-nowrap">{tKb('fileExplorer.table.uploadDate')}</span>
                  {sortColumn === 'date' && (
                    <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'} ms-1 flex-shrink-0`} />
                  )}
                </div>
              </th>
              <th
                className="sortable-header d-none d-sm-table-cell"
                onClick={() => handleSortToggle('size')}
                style={{ width: '80px', minWidth: '70px', maxWidth: '90px' }}
              >
                <div className="d-flex align-items-center justify-content-between">
                  <span>{tKb('fileExplorer.table.size')}</span>
                  {sortColumn === 'size' && (
                    <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'} ms-1 flex-shrink-0`} />
                  )}
                </div>
              </th>
              <th style={{ width: '70px', minWidth: '60px' }}></th>
            </tr>
          </thead>
          <tbody>
            {allRows.map(({ row, kbId, isKbFolder, kb }) => {
              const isFolder = row.type === 'folder';
              const kbState = kbFileStates.get(kbId);

              // Loading placeholder row
              if (row.id.endsWith('-loading')) {
                return (
                  <tr key={row.id}>
                    <td colSpan={5} className="text-center py-3">
                      <Spinner animation="border" size="sm" variant="secondary" className="me-2" />
                      <span className="text-muted">{tKb('fileExplorer.loadingFiles')}</span>
                    </td>
                  </tr>
                );
              }

              // Empty folder placeholder row
              if (row.id.endsWith('-empty')) {
                return (
                  <tr key={row.id}>
                    <td colSpan={5} className="text-center py-3 text-muted">
                      <i className="bi bi-inbox me-2" />
                      {tKb('fileExplorer.empty')}
                    </td>
                  </tr>
                );
              }

              // KB folder row (depth 0)
              if (isKbFolder && kb) {
                const isExpanded = expandedKbs.has(kb.kb_id);
                const isShared = kb.is_shared || kb.role === 'VIEWER';
                const isOwner = kb.role === 'OWNER';
                const isEditor = kb.role === 'EDITOR';
                const canEdit = isOwner || isEditor;

                return (
                  <tr
                    key={row.id}
                    onClick={() => toggleKbExpansion(kb)}
                    style={{ cursor: 'pointer' }}
                    className={isExpanded ? 'table-active' : ''}
                  >
                    <td
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}
                    >
                      <div className="file-tree-item depth-0" title={kb.kb_name}>
                        <i
                          className={`bi bi-chevron-${isExpanded ? 'down' : 'right'} me-1 folder-toggle flex-shrink-0`}
                        />
                        <i className="bi bi-folder me-2 folder-icon flex-shrink-0" />
                        <strong className="text-truncate">{kb.kb_name}</strong>
                        {isShared && (
                          <OverlayTrigger
                            placement="top"
                            overlay={
                              <Tooltip>
                                {kb.role === 'VIEWER' ? t('folderList.sharedWithYou') : t('badges.shared')}
                              </Tooltip>
                            }
                          >
                            <i className="bi bi-people-fill text-muted ms-2" style={{ fontSize: '0.85rem' }} />
                          </OverlayTrigger>
                        )}
                        {!isOwner && (
                          <Badge
                            bg="none"
                            className="border text-muted ms-2"
                            style={{ fontSize: '0.65rem', fontWeight: 500 }}
                          >
                            {isEditor ? t('badges.editor') : t('badges.viewer')}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="d-none d-lg-table-cell"></td>
                    <td className="d-none d-md-table-cell"></td>
                    <td className="d-none d-sm-table-cell"></td>
                    <td>
                      <div className="d-flex align-items-center justify-content-end gap-1">
                        {canEdit && (
                          <>
                            <OverlayTrigger placement="top" overlay={<Tooltip>{t('actions.uploadFiles')}</Tooltip>}>
                              <Button
                                variant="link"
                                size="sm"
                                className="p-1 text-muted"
                                onClick={(e) => openUploadForKb(kb, e)}
                              >
                                <i className="bi bi-upload" />
                              </Button>
                            </OverlayTrigger>
                            <OverlayTrigger placement="top" overlay={<Tooltip>{t('folderList.settings')}</Tooltip>}>
                              <Button
                                variant="link"
                                size="sm"
                                className="p-1 text-muted"
                                onClick={(e) => openSettings(kb, e)}
                              >
                                <i className="bi bi-gear" />
                              </Button>
                            </OverlayTrigger>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              }

              // Child rows (files and subfolders within a KB)
              const isSubfolder = isFolder;
              const isSubfolderExpanded = isSubfolder && (kbState?.expandedFolders.has(row.id) ?? false);
              const isSubfolderLoading = isSubfolder && (kbState?.loadingFolders.has(row.id) ?? false);
              const isSubfolderLoaded = isSubfolder && (kbState?.loadedFolders.has(row.id) ?? false);
              const isEmptySubfolder =
                isSubfolder && !isSubfolderLoading && isSubfolderLoaded && (row.children?.length ?? 0) === 0;

              return (
                <tr key={row.id}>
                  <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
                    <div className={`file-tree-item depth-${row.depth}`} title={row.displayName || row.name}>
                      {isSubfolder ? (
                        isSubfolderLoading ? (
                          <Spinner
                            animation="border"
                            size="sm"
                            variant="secondary"
                            className="me-1 flex-shrink-0"
                            style={{ width: '0.75rem', height: '0.75rem' }}
                          />
                        ) : (
                          <i
                            className={`bi bi-chevron-${isSubfolderExpanded ? 'down' : 'right'} me-1 folder-toggle flex-shrink-0`}
                            onClick={() => toggleSubfolder(kbId, row.id)}
                            style={{ cursor: 'pointer' }}
                          />
                        )
                      ) : (
                        <span className="file-icon-spacer flex-shrink-0" />
                      )}
                      {isSubfolder ? (
                        <>
                          <i
                            className={`bi ${row.urlTag === 'web-crawler-folder' ? 'bi-globe2' : 'bi-folder'} me-2 folder-icon flex-shrink-0`}
                          />
                          <strong className="text-truncate">{row.name}</strong>
                          {row.urlTag === 'web-crawler-folder' && (
                            <Badge bg="info" className="ms-2 flex-shrink-0 small">
                              {tKb('fileExplorer.webCrawlerBadge')}
                            </Badge>
                          )}
                          {isEmptySubfolder && (
                            <Badge bg="secondary" className="ms-2 flex-shrink-0 small">
                              {tKb('fileExplorer.badges.empty')}
                            </Badge>
                          )}
                        </>
                      ) : (
                        <>
                          <i className="bi bi-file-earmark me-2 file-icon flex-shrink-0" />
                          <span className="text-truncate" style={{ minWidth: 0 }}>
                            {row.displayName || row.name}
                          </span>
                        </>
                      )}
                    </div>
                  </td>
                  <td
                    className="d-none d-lg-table-cell text-truncate"
                    style={{ maxWidth: '200px' }}
                    title={row.uploadedBy || undefined}
                  >
                    {!isSubfolder && (row.uploadedBy || '')}
                  </td>
                  <td className="d-none d-md-table-cell">{!isSubfolder ? row.uploadDate : ''}</td>
                  <td className="d-none d-sm-table-cell">{!isSubfolder ? row.size : ''}</td>
                  <td>
                    {!isSubfolder && row.originalKey && (
                      <div className="d-flex align-items-center gap-1">
                        <OverlayTrigger
                          placement="top"
                          overlay={<Tooltip>{tKb('fileExplorer.actions.previewInPanel')}</Tooltip>}
                        >
                          <button
                            className="btn btn-sm btn-link p-0 kb-file-action-btn"
                            onClick={() => {
                              const filename = row.name;
                              const isWebCrawlerFile =
                                row.originalKey?.includes('web-crawler/') ||
                                row.originalKey?.includes('scraped-content/');
                              const extension = isWebCrawlerFile
                                ? 'md'
                                : filename.includes('.')
                                  ? filename.split('.').pop() || ''
                                  : '';
                              handleOpenFilePreview({
                                filename,
                                fullPath: row.originalKey!,
                                relativePath: row.originalKey!,
                                extension,
                              });
                            }}
                          >
                            <i className="bi bi-eye" />
                          </button>
                        </OverlayTrigger>
                        <OverlayTrigger
                          placement="top"
                          overlay={<Tooltip>{tKb('fileExplorer.actions.downloadFile')}</Tooltip>}
                        >
                          <button
                            className="btn btn-sm btn-link p-0 kb-file-action-btn"
                            onClick={() => handleDownloadFile(row.originalKey!, row.name)}
                          >
                            <i className="bi bi-download" />
                          </button>
                        </OverlayTrigger>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      {/* Create Folder Modal */}
      <CreateFolderModal
        show={showCreateModal}
        onHide={() => setShowCreateModal(false)}
        onSuccess={handleFolderCreated}
      />

      {/* Folder Settings Drawer */}
      {settingsKb && (
        <FolderSettingsDrawer
          show={showSettingsDrawer}
          onHide={() => setShowSettingsDrawer(false)}
          kbId={settingsKb.kb_id}
          kbName={settingsKb.kb_name}
          onDeleted={handleFolderDeleted}
        />
      )}

      {/* Upload Modal */}
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

      {/* Large Data File Warning */}
      {showNotificationModal && (
        <NotificationModal
          type="warning"
          title={t('largeFile.title')}
          message={
            <div>
              <p>{t('largeFile.description')}</p>
              <ul className="mb-3">
                {pendingLargeFiles.map((file, index) => (
                  <li key={index}>
                    <strong>{file.name}</strong> ({formatFileSize(file.size)})
                  </li>
                ))}
              </ul>
              <p className="mb-0">{t('largeFile.warning')}</p>
              <div className="alert alert-info mb-3 mt-3">
                <i className="bi bi-info-circle me-2" />
                <strong>{t('largeFile.recommendationLabel')}</strong> {t('largeFile.recommendation')}
              </div>
              <p className="mb-0">{t('largeFile.confirm')}</p>
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
