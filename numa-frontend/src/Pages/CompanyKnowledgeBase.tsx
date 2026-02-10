/**
 * Company Knowledge Base Page
 * Shows the company-wide knowledge base with tabs
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Alert, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { PageHeader } from '../Components/PageHeader';
import { KBTabLayout } from '../Components/KnowledgeBase/KBTabLayout';
import type { KBFileExplorerHandle } from '../Components/KnowledgeBase/KBFileExplorer';
import { useAuth } from '../Providers/AuthProvider';
import { FileUploader } from '../Components/FileUploader';
import { NotificationModal } from '../Components/NotificationModal';
import { isFileTypeValidForBedrockKB, shouldShowLargeDataFileWarning, formatFileSize } from '../utils/fileUtils';
import { listFoldersInKB, downloadFileFromS3 } from '../utils/s3Utils';
import FolderSelector from '../Components/KnowledgeBase/FolderSelector';
import { useFilePreviewProcessor } from '../hooks/useFilePreviewProcessor';
import type { FileReference } from '../hooks/useFilePreviewProcessor';
import ResizableSplitView from '../Components/ResizableSplitView';
import { FilePreviewPanel } from '../Components/FilePreviewPanel';

export function CompanyKnowledgeBase(): React.JSX.Element {
  const { t } = useTranslation('knowledgeBase');
  const { user, getCredentials, region: authRegion } = useAuth();
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [fileValidationError, setFileValidationError] = useState<string | null>(null);
  const [showNotificationModal, setShowNotificationModal] = useState<boolean>(false);
  const [pendingLargeFiles, setPendingLargeFiles] = useState<File[]>([]);
  const [clearFileUploader, setClearFileUploader] = useState<boolean>(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileExplorerRef = React.useRef<KBFileExplorerHandle>(null);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [folderOptions, setFolderOptions] = useState<string[]>([]);
  const [loadingFolders, setLoadingFolders] = useState<boolean>(false);

  // File preview state
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

  const region = authRegion || window.sessionStorage.getItem('REGION') || 'ap-southeast-2';
  const CLIENT_NAME = window.sessionStorage.getItem('CLIENT_NAME');
  const dataBucket = `numa-${CLIENT_NAME}-data`;

  // Track window resize for mobile detection
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleOpenFilePreview = useCallback(
    (ref: FileReference) => {
      openFilePreview(ref);
      if (isMobile) {
        setShowFilePreviewModal(true);
      }
    },
    [openFilePreview, isMobile],
  );

  const handleDownloadFile = useCallback(
    async (s3Key: string, filename: string) => {
      try {
        await downloadFileFromS3(s3Key, dataBucket, region, getCredentials, filename);
      } catch (err) {
        console.error('Error downloading file:', err);
      }
    },
    [dataBucket, region, getCredentials],
  );

  const canView = Boolean(user?.features?.includes('useCompanyData'));
  const canAdd = Boolean(user?.features?.includes('addToCompanyData'));
  const canDelete = Boolean(user?.features?.includes('deleteFromCompanyData'));

  // Determine role based on permissions
  // useCompanyData = VIEW, addToCompanyData = ADD/EDIT, deleteFromCompanyData = DELETE
  const role: 'VIEWER' | 'EDITOR' = canAdd || canDelete ? 'EDITOR' : 'VIEWER';

  // Reset clearFileUploader after it's been used
  useEffect(() => {
    if (clearFileUploader) {
      const timer = setTimeout(() => {
        setClearFileUploader(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [clearFileUploader]);

  // Fetch folder options when upload modal is opened
  useEffect(() => {
    if (showUploadModal) {
      const fetchFolders = async () => {
        try {
          setLoadingFolders(true);
          const CLIENT_NAME = window.sessionStorage.getItem('CLIENT_NAME');
          const region = authRegion || window.sessionStorage.getItem('REGION') || 'ap-southeast-2';
          const bucket = `numa-${CLIENT_NAME}-data`;

          const folders = await listFoldersInKB('company', bucket, region, getCredentials);
          setFolderOptions(folders);
        } catch (error) {
          console.error('Error fetching folders:', error);
          setFolderOptions([]);
        } finally {
          setLoadingFolders(false);
        }
      };

      fetchFolders();
      setSelectedFolder(''); // Reset to root when opening modal
    }
  }, [showUploadModal, getCredentials, authRegion]);

  /**
   * Validates files before upload
   */
  function validateFiles(files: File[]): boolean {
    const invalidFiles = files.filter((file) => !isFileTypeValidForBedrockKB(file));

    if (invalidFiles.length > 0) {
      const invalidFileNames = invalidFiles.map((file) => file.name).join(', ');
      setFileValidationError(t('companyKnowledgeBase.validation.unsupportedFiles', { files: invalidFileNames }));
      return false;
    }

    setFileValidationError(null);
    return true;
  }

  /**
   * Handles file selection before upload
   */
  function handleFileSelect(selectedFiles: File[]): void {
    if (!validateFiles(selectedFiles)) {
      return;
    }

    const largeDataFiles = selectedFiles.filter((file) => shouldShowLargeDataFileWarning(file));

    if (largeDataFiles.length > 0) {
      setPendingLargeFiles(largeDataFiles);
      setShowNotificationModal(true);
    }
  }

  /**
   * Handle proceeding with upload despite large file warning
   */
  function handleProceedWithUpload(): void {
    setShowNotificationModal(false);
    setPendingLargeFiles([]);
  }

  /**
   * Handle canceling the upload
   */
  function handleCancelUpload(): void {
    setShowNotificationModal(false);
    setPendingLargeFiles([]);
    setClearFileUploader(true);
  }

  /**
   * On successful file upload
   */
  function handleUploadSuccess(): void {
    setFileValidationError(null);
    setShowNotificationModal(false);
    setPendingLargeFiles([]);
    setShowUploadModal(false);
    setUploadSuccess(true);
    setTimeout(() => setUploadSuccess(false), 3000);

    // Refresh the file explorer to show newly uploaded files
    if (fileExplorerRef.current) {
      fileExplorerRef.current.refreshFiles();
    }
  }

  return (
    <div className="company-knowledge-base">
      <PageHeader
        title={t('companyKnowledgeBase.title')}
        subtitle={t('companyKnowledgeBase.subtitle')}
        actions={
          canAdd ? (
            <div className="d-flex gap-2 flex-wrap">
              <Button
                variant="secondary"
                onClick={() => fileExplorerRef.current?.openCreateFolder()}
                className="text-nowrap"
              >
                <i className="bi bi-folder-plus me-2 d-none d-sm-inline"></i>
                <i className="bi bi-folder-plus me-2 d-inline d-sm-none"></i>
                <span className="d-none d-sm-inline">{t('companyKnowledgeBase.actions.newFolder')}</span>
              </Button>
              <Button variant="primary" onClick={() => setShowUploadModal(true)} className="text-nowrap">
                <i className="bi bi-upload me-2 d-none d-sm-inline"></i>
                <i className="bi bi-upload me-2 d-inline d-sm-none"></i>
                <span className="d-none d-sm-inline">{t('companyKnowledgeBase.actions.uploadFiles')}</span>
              </Button>
            </div>
          ) : null
        }
      />

      <LayoutDashboard>
        {!canView && (
          <Alert variant="warning" className="mb-4">
            <i className="bi bi-exclamation-triangle me-2"></i>
            {t('companyKnowledgeBase.permissionWarning')}
          </Alert>
        )}

        {uploadSuccess && (
          <Alert variant="success" dismissible onClose={() => setUploadSuccess(false)} className="mb-4">
            <i className="bi bi-check-circle me-2"></i>
            {t('companyKnowledgeBase.uploadSuccess')}
          </Alert>
        )}

        {canView && (
          <ResizableSplitView
            left={
              <KBTabLayout
                kbId="company"
                kbType="company"
                role={role}
                onUploadSuccess={handleUploadSuccess}
                fileExplorerRef={fileExplorerRef}
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
        )}
      </LayoutDashboard>

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
                  <i className="bi bi-upload me-2"></i>
                  {t('companyKnowledgeBase.uploadModal.title')}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowUploadModal(false)}
                  aria-label={t('companyKnowledgeBase.uploadModal.close')}
                ></button>
              </div>
              <div className="modal-body">
                <p className="text-muted small mb-3">
                  {t('companyKnowledgeBase.uploadModal.body')}
                  <br />
                  <strong>{t('companyKnowledgeBase.uploadModal.noteLabel')}</strong>{' '}
                  {t('companyKnowledgeBase.uploadModal.note')}
                </p>

                <FolderSelector
                  selectedFolder={selectedFolder}
                  onFolderChange={setSelectedFolder}
                  folderOptions={folderOptions}
                  disabled={loadingFolders}
                  label={t('companyKnowledgeBase.uploadModal.folderLabel')}
                />

                {fileValidationError && (
                  <Alert variant="danger" className="mb-3">
                    <strong>{t('companyKnowledgeBase.uploadModal.validationTitle')}</strong>
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
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Large Data File Warning Modal */}
      {showNotificationModal && (
        <NotificationModal
          type="warning"
          title={t('companyKnowledgeBase.largeFile.title')}
          message={
            <div>
              <p>{t('companyKnowledgeBase.largeFile.description')}</p>
              <ul className="mb-3">
                {pendingLargeFiles.map((file, index) => (
                  <li key={index}>
                    <strong>{file.name}</strong> ({formatFileSize(file.size)})
                  </li>
                ))}
              </ul>
              <p className="mb-0">{t('companyKnowledgeBase.largeFile.warning')}</p>
              <div className="alert alert-info mb-3 mt-3">
                <i className="bi bi-info-circle me-2"></i>
                <strong>{t('companyKnowledgeBase.largeFile.recommendationLabel')}</strong>{' '}
                {t('companyKnowledgeBase.largeFile.recommendation')}
              </div>
              <p className="mb-0">{t('companyKnowledgeBase.largeFile.confirm')}</p>
            </div>
          }
          show={showNotificationModal}
          onHide={handleCancelUpload}
          onConfirm={handleProceedWithUpload}
          confirmText={t('companyKnowledgeBase.largeFile.confirmButton')}
          cancelText={t('companyKnowledgeBase.largeFile.cancelButton')}
          showCancelButton={true}
          size="lg"
        />
      )}
    </div>
  );
}
