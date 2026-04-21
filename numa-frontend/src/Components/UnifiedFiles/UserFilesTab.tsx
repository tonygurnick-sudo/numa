import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Badge, Button, Spinner, Alert, OverlayTrigger, Tooltip, Modal, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useKnowledgeBase } from '../../Providers/KnowledgeBaseProvider';
import { KBStateProvider } from '../../Providers/KBStateProvider';
import { KBFileExplorer } from '../KnowledgeBase/KBFileExplorer';
import type { KBFileExplorerHandle } from '../KnowledgeBase/KBFileExplorer';
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
import { CreateFolderModal } from './CreateFolderModal';
import { FolderSettingsDrawer } from './FolderSettingsDrawer';

interface UserFilesTabProps {
  onActionChange?: (actions: React.ReactNode) => void;
}

export function UserFilesTab({ onActionChange }: UserFilesTabProps): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const { t: tKB } = useTranslation('knowledgeBase');
  const { availableKBs, isLoadingKBs, refreshKBs, fetchKBDetails } = useKnowledgeBase();
  const { getCredentials, region: authRegion } = useAuth();

  const [expandedKbId, setExpandedKbId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [settingsKb, setSettingsKb] = useState<UserKB | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Upload state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadKb, setUploadKb] = useState<UserKB | null>(null);
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

  const fileExplorerRefs = useRef<Record<string, KBFileExplorerHandle | null>>({});

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const region = authRegion || window.sessionStorage.getItem('REGION') || 'ap-southeast-2';
  const CLIENT_NAME = window.sessionStorage.getItem('CLIENT_NAME');
  const dataBucket = `numa-${CLIENT_NAME}-data`;

  const allUserKBs = useMemo(() => availableKBs.filter((kb) => !SYSTEM_KB_IDS.has(kb.kb_id)), [availableKBs]);

  const filteredKBs = useMemo(() => {
    if (!searchQuery.trim()) return allUserKBs;
    const query = searchQuery.toLowerCase();
    return allUserKBs.filter((kb) => kb.kb_name.toLowerCase().includes(query));
  }, [allUserKBs, searchQuery]);

  // Update parent action buttons
  useEffect(() => {
    if (!onActionChange) return;
    onActionChange(
      <div className="d-flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => setShowCreateModal(true)}>
          <i className="bi bi-folder-plus me-2" />
          {t('actions.newFolder')}
        </Button>
        <Button variant="primary" size="sm" disabled>
          <i className="bi bi-upload me-2" />
          {t('actions.uploadFiles')}
        </Button>
      </div>
    );
  }, [onActionChange, t]);

  const toggleFolder = useCallback(
    (kb: UserKB) => {
      setExpandedKbId((prev) => {
        if (prev === kb.kb_id) return null;
        fetchKBDetails(kb.kb_id);
        return kb.kb_id;
      });
    },
    [fetchKBDetails]
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
  const openUploadModal = useCallback((kb: UserKB) => {
    setUploadKb(kb);
    setShowUploadModal(true);
  }, []);

  useEffect(() => {
    if (showUploadModal && uploadKb) {
      const fetchFolders = async () => {
        try {
          setLoadingFolders(true);
          const bucket = `numa-${CLIENT_NAME}-data`;
          const folders = await listFoldersInKB(uploadKb.kb_id, bucket, region, getCredentials);
          setFolderOptions(folders);
        } catch {
          setFolderOptions([]);
        } finally {
          setLoadingFolders(false);
        }
      };
      fetchFolders();
      setSelectedFolder('');
    }
  }, [showUploadModal, uploadKb, CLIENT_NAME, region, getCredentials]);

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
    if (uploadKb) {
      fileExplorerRefs.current[uploadKb.kb_id]?.refreshFiles();
    }
  }

  const handleFolderCreated = useCallback(() => {
    refreshKBs();
  }, [refreshKBs]);

  const handleFolderDeleted = useCallback(() => {
    setExpandedKbId(null);
    refreshKBs();
  }, [refreshKBs]);

  const openSettings = useCallback((kb: UserKB, e: React.MouseEvent) => {
    e.stopPropagation();
    setSettingsKb(kb);
    setShowSettingsDrawer(true);
  }, []);

  if (isLoadingKBs) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" variant="primary" />
        <p className="mt-3 text-muted">{t('folderList.loading')}</p>
      </div>
    );
  }

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

  return (
    <div className="py-3">
      {uploadSuccess && (
        <Alert variant="success" dismissible onClose={() => setUploadSuccess(false)} className="mb-3">
          <i className="bi bi-check-circle me-2" />
          {t('upload.success')}
        </Alert>
      )}

      {/* Toolbar matching KBFileExplorer style */}
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div className="d-flex align-items-center gap-2">
          <Form.Control
            type="text"
            placeholder={tKB('fileExplorer.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-shrink-0"
            style={{ width: '250px', minWidth: '150px' }}
          />
        </div>
        <div className="d-flex align-items-center gap-2">
          <Button variant="outline-secondary" size="sm" onClick={() => setShowCreateModal(true)}>
            <i className="bi bi-folder-plus me-2" />
            {tKB('fileExplorer.actions.newFolder')}
          </Button>
          <Button variant="outline-primary" size="sm" onClick={() => refreshKBs()}>
            <i className="bi bi-arrow-clockwise me-2" />
            {tKB('fileExplorer.actions.refresh')}
          </Button>
        </div>
      </div>

      <ResizableSplitView
        left={
          <div className="table-responsive">
            <table className="table table-hover align-middle kb-file-explorer-table">
              <thead>
                <tr>
                  <th>
                    <span>{tKB('fileExplorer.table.name')}</span>
                  </th>
                  <th className="d-none d-lg-table-cell" style={{ width: '150px' }}>
                    {tKB('fileExplorer.table.addedBy')}
                  </th>
                  <th className="d-none d-md-table-cell" style={{ width: '140px' }}>
                    {tKB('fileExplorer.table.uploadDate')}
                  </th>
                  <th className="d-none d-sm-table-cell" style={{ width: '80px' }}>
                    {tKB('fileExplorer.table.size')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredKBs.map((kb) => {
                  const isExpanded = expandedKbId === kb.kb_id;
                  const isShared = kb.is_shared || kb.role === 'VIEWER';
                  const isOwner = kb.role === 'OWNER';
                  const isEditor = kb.role === 'EDITOR';
                  const canEdit = isOwner || isEditor;

                  return (
                    <React.Fragment key={kb.kb_id}>
                      {/* Folder row -- styled like KBFileExplorer folder rows */}
                      <tr onClick={() => toggleFolder(kb)} style={{ cursor: 'pointer' }}>
                        <td
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
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
                                <i
                                  className="bi bi-people-fill text-muted ms-2 flex-shrink-0"
                                  style={{ fontSize: '0.85rem' }}
                                />
                              </OverlayTrigger>
                            )}
                            {!isOwner && (
                              <Badge
                                bg="none"
                                className="border text-muted ms-2 flex-shrink-0"
                                style={{ fontSize: '0.65rem', fontWeight: 500 }}
                              >
                                {isEditor ? t('badges.editor') : t('badges.viewer')}
                              </Badge>
                            )}
                            {canEdit && (
                              <Button
                                variant="link"
                                size="sm"
                                className="p-0 text-muted ms-2 flex-shrink-0"
                                onClick={(e) => openSettings(kb, e)}
                                title={t('actions.settings')}
                              >
                                <i className="bi bi-gear" style={{ fontSize: '0.8rem' }} />
                              </Button>
                            )}
                            {canEdit && isExpanded && (
                              <Button
                                variant="link"
                                size="sm"
                                className="p-0 text-muted ms-1 flex-shrink-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openUploadModal(kb);
                                }}
                                title={t('actions.uploadFiles')}
                              >
                                <i className="bi bi-upload" style={{ fontSize: '0.8rem' }} />
                              </Button>
                            )}
                          </div>
                        </td>
                        <td className="d-none d-lg-table-cell text-muted" />
                        <td className="d-none d-md-table-cell text-muted">
                          {kb.document_count != null && kb.document_count > 0 ? `${kb.document_count} files` : '\u2014'}
                        </td>
                        <td className="d-none d-sm-table-cell text-muted">{'\u2014'}</td>
                      </tr>

                      {/* Expanded: render KBFileExplorer inside the table */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={4} className="p-0 border-0">
                            <div className="ps-4 border-start border-2 ms-3">
                              <KBStateProvider kbId={kb.kb_id} kbType="user">
                                <KBFileExplorer
                                  ref={(el) => {
                                    fileExplorerRefs.current[kb.kb_id] = el;
                                  }}
                                  kbId={kb.kb_id}
                                  role={kb.role}
                                  hideStatusColumn
                                  onOpenFilePreview={handleOpenFilePreview}
                                  onDownloadFile={handleDownloadFile}
                                />
                              </KBStateProvider>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {filteredKBs.length === 0 && searchQuery && (
                  <tr>
                    <td colSpan={4} className="text-center text-muted py-4">
                      {tKB('selector.noResultsTitle')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        }
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

      {/* Upload Modal */}
      {showUploadModal && uploadKb && (
        <div className="modal show d-block kb-upload-modal-backdrop" onClick={() => setShowUploadModal(false)}>
          <div
            className="modal-dialog modal-dialog-centered modal-lg kb-upload-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-upload me-2" />
                  {t('upload.title', { name: uploadKb.kb_name })}
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
                  kb_id={uploadKb.kb_id}
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
    </div>
  );
}
