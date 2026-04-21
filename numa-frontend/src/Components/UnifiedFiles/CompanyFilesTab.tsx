import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Button, Alert, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
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

interface CompanyFilesTabProps {
  onActionChange?: (actions: React.ReactNode) => void;
}

export function CompanyFilesTab({ onActionChange }: CompanyFilesTabProps): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const { user, getCredentials, region: authRegion } = useAuth();

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [fileValidationError, setFileValidationError] = useState<string | null>(null);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [pendingLargeFiles, setPendingLargeFiles] = useState<File[]>([]);
  const [clearFileUploader, setClearFileUploader] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [folderOptions, setFolderOptions] = useState<string[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);

  const fileExplorerRef = useRef<KBFileExplorerHandle>(null);
  const region = authRegion || window.sessionStorage.getItem('REGION') || 'ap-southeast-2';
  const CLIENT_NAME = window.sessionStorage.getItem('CLIENT_NAME');
  const dataBucket = `numa-${CLIENT_NAME}-data`;

  const canView = Boolean(user?.features?.includes('useCompanyData'));
  const canAdd = Boolean(user?.features?.includes('addToCompanyData'));
  const canDelete = Boolean(user?.features?.includes('deleteFromCompanyData'));
  const role: 'VIEWER' | 'EDITOR' = canAdd || canDelete ? 'EDITOR' : 'VIEWER';

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

  // Update parent action buttons
  useEffect(() => {
    if (!onActionChange) return;
    onActionChange(
      canAdd ? (
        <div className="d-flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => fileExplorerRef.current?.openCreateFolder()}>
            <i className="bi bi-folder-plus me-2" />
            <span className="d-none d-sm-inline">{t('actions.newFolder')}</span>
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowUploadModal(true)}>
            <i className="bi bi-upload me-2" />
            <span className="d-none d-sm-inline">{t('actions.uploadFiles')}</span>
          </Button>
        </div>
      ) : null
    );
  }, [canAdd, onActionChange, t]);

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
    if (showUploadModal) {
      const fetchFolders = async () => {
        try {
          setLoadingFolders(true);
          const bucket = `numa-${CLIENT_NAME}-data`;
          const folders = await listFoldersInKB('company', bucket, region, getCredentials);
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
  }, [showUploadModal, CLIENT_NAME, region, getCredentials]);

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
    fileExplorerRef.current?.refreshFiles();
  }

  if (!canView) {
    return (
      <div className="py-4">
        <Alert variant="warning">
          <i className="bi bi-exclamation-triangle me-2" />
          {t('remote.comingSoon')}
        </Alert>
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

      <KBStateProvider kbId="company" kbType="company">
        <ResizableSplitView
          left={
            <KBFileExplorer
              ref={fileExplorerRef}
              kbId="company"
              role={role}
              hideStatusColumn
              onOpenFilePreview={handleOpenFilePreview}
              onDownloadFile={handleDownloadFile}
            />
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
      </KBStateProvider>

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
    </div>
  );
}
