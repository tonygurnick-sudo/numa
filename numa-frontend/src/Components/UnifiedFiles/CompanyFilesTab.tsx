import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
import { knowledgeBaseService } from '../../Services/knowledgeBaseService';
import type { S3FileInfo, ListKBFilesResponse } from '../../Services/knowledgeBaseService';

interface CompanyFilesTabProps {
  onActionChange?: (actions: React.ReactNode) => void;
}

interface FileState {
  files: S3Object[];
  isLoading: boolean;
  expandedFolders: Set<string>;
  loadedFolders: Set<string>;
  loadingFolders: Set<string>;
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

  const [fileState, setFileState] = useState<FileState>(() => {
    const cached = knowledgeBaseService.getCachedKBFiles('company');
    if (cached?.files?.length) {
      const s3Files = apiToS3Objects(cached.files, cached.folders ?? [], 'documents/company/');
      return {
        files: s3Files,
        isLoading: true,
        expandedFolders: new Set(),
        loadedFolders: new Set(),
        loadingFolders: new Set(),
      };
    }
    return {
      files: [],
      isLoading: true,
      expandedFolders: new Set(),
      loadedFolders: new Set(),
      loadingFolders: new Set(),
    };
  });

  /** Current folder navigation. null = root view, string = navigated into a subfolder by its row id */
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [currentFolderName, setCurrentFolderName] = useState<string>('');

  const [searchValue, setSearchValue] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Upload
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

  const canView = Boolean(user?.features?.includes('useCompanyData'));
  const canAdd = Boolean(user?.features?.includes('addToCompanyData'));
  const canDelete = Boolean(user?.features?.includes('deleteFromCompanyData'));
  const role: 'VIEWER' | 'EDITOR' = canAdd || canDelete ? 'EDITOR' : 'VIEWER';

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
      setFileState((prev) => ({
        ...prev,
        files: s3Files,
        isLoading: false,
        loadedFolders: new Set(),
        loadingFolders: new Set(),
      }));
    } catch (err) {
      console.error('Failed to fetch company files:', err);
      setFileState((prev) => ({
        ...prev,
        files: [],
        isLoading: false,
      }));
    }
  }, []);

  useEffect(() => {
    if (canView) fetchFiles();
  }, [canView, fetchFiles]);

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
            const existingKeys = new Set(prev.files.map((f) => f.Key));
            const merged = [...prev.files, ...s3Files.filter((f) => !existingKeys.has(f.Key))];
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
    closeFilePreview();
  }, [closeFilePreview]);

  // ── Build rows ─────────────────────────────────────────────

  const buildRows = useCallback((): TableRow[] => {
    if (fileState.files.length === 0) return [];
    const tree = buildFileTree(fileState.files);
    sortTree(tree, sortColumn, sortDirection);
    const allRows = unwrapSingleRootFolders(buildRowsForTree(tree, 0, '', formatDate, formatSize));

    if (currentFolderId) {
      // Find the target folder's children and present them at depth 0
      const flatAll = flattenRows(allRows, fileState.expandedFolders);
      const folderIdx = flatAll.findIndex((r) => r.id === currentFolderId);
      if (folderIdx === -1) return flattenRows(allRows, fileState.expandedFolders);
      const folderDepth = flatAll[folderIdx].depth;
      const children: TableRow[] = [];
      for (let i = folderIdx + 1; i < flatAll.length; i++) {
        if (flatAll[i].depth <= folderDepth) break;
        children.push({ ...flatAll[i], depth: flatAll[i].depth - folderDepth - 1 });
      }
      return children;
    }

    return flattenRows(allRows, fileState.expandedFolders);
  }, [fileState.files, fileState.expandedFolders, sortColumn, sortDirection, formatDate, formatSize, currentFolderId]);

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
      setSelectedFolder('');
    }
  }, [showUploadModal, dataBucket, region, getCredentials]);

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
    fetchFiles();
  }

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
          {currentFolderId ? (
            <>
              <button className="finder-toolbar__back" onClick={navigateBack}>
                <i className="bi bi-chevron-left" />
                {t('tabs.companyFiles')}
              </button>
              <span className="finder-toolbar__title">{currentFolderName}</span>
            </>
          ) : (
            <span className="finder-toolbar__title">
              {t('tabs.companyFiles')}
              {fileState.isLoading && (
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
          {canAdd && (
            <button className="finder-btn" onClick={() => setShowUploadModal(true)}>
              <i className="bi bi-upload" />
            </button>
          )}
          <button className="finder-btn" onClick={fetchFiles}>
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
        {rows.length === 0 ? (
          <div className="finder-empty">
            <i className="bi bi-folder" />
            <span>{tKb('fileExplorer.empty')}</span>
          </div>
        ) : (
          rows.map((row) => {
            const isFolder = row.type === 'folder';
            const isExpanded = isFolder && fileState.expandedFolders.has(row.id);
            const isLoading = isFolder && fileState.loadingFolders.has(row.id);

            return (
              <div
                key={row.id}
                className={`finder-row finder-grid-5 ${isFolder ? 'finder-row--folder' : ''} ${isExpanded ? 'finder-row--expanded' : ''} finder-row--depth-${row.depth}`}
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
                <div className="finder-row__meta d-none d-lg-block">{!isFolder ? row.uploadedBy || '' : ''}</div>
                <div className="finder-row__meta d-none d-md-block">{!isFolder ? row.uploadDate : ''}</div>
                <div className="finder-row__meta d-none d-sm-block">{!isFolder ? row.size : ''}</div>
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
                    </>
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
                  kb_id="company"
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
