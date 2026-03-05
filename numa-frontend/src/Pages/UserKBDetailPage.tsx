/**
 * User KB Detail Page
 * Shows detailed view of a single user knowledge base with tabs
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Alert, Spinner, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { PageHeader } from '../Components/PageHeader';
import { KBTabLayout } from '../Components/KnowledgeBase/KBTabLayout';
import type { KBFileExplorerHandle } from '../Components/KnowledgeBase/KBFileExplorer';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import { FileUploader } from '../Components/FileUploader';
import { NotificationModal } from '../Components/NotificationModal';
import { isFileTypeValidForBedrockKB, shouldShowLargeDataFileWarning, formatFileSize } from '../utils/fileUtils';
import { listFoldersInKB, downloadFileFromS3 } from '../utils/s3Utils';
import FolderSelector from '../Components/KnowledgeBase/FolderSelector';
import { useAuth } from '../Providers/AuthProvider';
import { useFilePreviewProcessor } from '../hooks/useFilePreviewProcessor';
import type { FileReference } from '../hooks/useFilePreviewProcessor';
import ResizableSplitView from '../Components/ResizableSplitView';
import { FilePreviewPanel } from '../Components/FilePreviewPanel';
import { SYSTEM_KB_IDS } from '../constants/knowledgeBase';

export function UserKBDetailPage(): React.JSX.Element {
  const { t } = useTranslation('knowledgeBase');
  const { kbId } = useParams<{ kbId: string }>();
  const navigate = useNavigate();
  const { availableKBs, fetchKBDetails } = useKnowledgeBase();
  const { getCredentials, region: authRegion } = useAuth();

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

  // Find the current KB
  const currentKB = availableKBs.find((kb) => kb.kb_id === kbId);

  // Redirect if KB not found
  useEffect(() => {
    if (kbId && SYSTEM_KB_IDS.has(kbId)) {
      navigate('/user-knowledge-bases');
      return;
    }
    if (!currentKB && availableKBs.length > 0 && kbId) {
      console.error('KB not found:', kbId);
      navigate('/user-knowledge-bases');
    }
  }, [currentKB, availableKBs, kbId, navigate]);

  // Fetch KB details to update document count in the cache
  useEffect(() => {
    if (kbId) {
      fetchKBDetails(kbId);
    }
  }, [kbId, fetchKBDetails]);

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
    if (showUploadModal && kbId) {
      const fetchFolders = async () => {
        try {
          setLoadingFolders(true);
          const CLIENT_NAME = window.sessionStorage.getItem('CLIENT_NAME');
          const region = authRegion || window.sessionStorage.getItem('REGION') || 'ap-southeast-2';
          const bucket = `numa-${CLIENT_NAME}-data`;

          const folders = await listFoldersInKB(kbId, bucket, region, getCredentials);
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
  }, [showUploadModal, kbId, getCredentials, authRegion]);

  /**
   * Validates files before upload
   */
  function validateFiles(files: File[]): boolean {
    const invalidFiles = files.filter((file) => !isFileTypeValidForBedrockKB(file));

    if (invalidFiles.length > 0) {
      const invalidFileNames = invalidFiles.map((file) => file.name).join(', ');
      setFileValidationError(t('userKnowledgeBase.validation.unsupportedFiles', { files: invalidFileNames }));
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

  if (!currentKB) {
    return (
      <div className="dashboard user-kb-detail-page">
        <PageHeader title={t('userKnowledgeBase.loading.title')} subtitle={t('userKnowledgeBase.loading.subtitle')} />
        <LayoutDashboard>
          <div className="text-center p-5">
            <Spinner animation="border" variant="primary" />
            <p className="mt-3 text-muted">{t('userKnowledgeBase.loading.body')}</p>
          </div>
        </LayoutDashboard>
      </div>
    );
  }

  const canEdit = currentKB.role === 'EDITOR' || currentKB.role === 'OWNER';
  const isShared = currentKB.role === 'VIEWER';

  return (
    <div className="dashboard user-kb-detail-page">
      <PageHeader
        title={
          <>
            <Button variant="link" className="kb-back-button" onClick={() => navigate('/user-knowledge-bases')}>
              <i className="bi bi-arrow-left" style={{ fontSize: '1.5rem' }}></i>
            </Button>
            {currentKB.kb_name}
          </>
        }
        subtitle={isShared ? t('userKnowledgeBase.shared') : t('userKnowledgeBase.personal')}
        actions={
          canEdit ? (
            <div className="d-flex gap-2">
              <Button variant="secondary" onClick={() => fileExplorerRef.current?.openCreateFolder()}>
                <i className="bi bi-folder-plus me-2"></i>
                {t('userKnowledgeBase.actions.newFolder')}
              </Button>
              <Button variant="primary" onClick={() => setShowUploadModal(true)}>
                <i className="bi bi-upload me-2"></i>
                {t('userKnowledgeBase.actions.uploadFiles')}
              </Button>
            </div>
          ) : null
        }
      />

      <LayoutDashboard>
        {uploadSuccess && (
          <Alert variant="success" dismissible onClose={() => setUploadSuccess(false)} className="mb-4">
            <i className="bi bi-check-circle me-2"></i>
            {t('userKnowledgeBase.uploadSuccess')}
          </Alert>
        )}

        <ResizableSplitView
          left={
            <KBTabLayout
              kbId={kbId!}
              kbType="user"
              role={currentKB.role}
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
                  {t('userKnowledgeBase.uploadModal.title', { name: currentKB.kb_name })}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowUploadModal(false)}
                  aria-label={t('userKnowledgeBase.uploadModal.close')}
                ></button>
              </div>
              <div className="modal-body">
                <p className="text-muted small mb-3">
                  {t('userKnowledgeBase.uploadModal.body')}
                  <br />
                  <strong>{t('userKnowledgeBase.uploadModal.noteLabel')}</strong>{' '}
                  {t('userKnowledgeBase.uploadModal.note')}
                </p>

                <FolderSelector
                  selectedFolder={selectedFolder}
                  onFolderChange={setSelectedFolder}
                  folderOptions={folderOptions}
                  disabled={loadingFolders}
                  label={t('userKnowledgeBase.uploadModal.folderLabel')}
                />

                {fileValidationError && (
                  <Alert variant="danger" className="mb-3">
                    <strong>{t('userKnowledgeBase.uploadModal.validationTitle')}</strong>
                    <p className="mb-0 mt-1">{fileValidationError}</p>
                  </Alert>
                )}

                <FileUploader
                  onUploadSuccess={handleUploadSuccess}
                  onFileSelect={handleFileSelect}
                  validateFile={isFileTypeValidForBedrockKB}
                  clearFiles={clearFileUploader}
                  kb_id={kbId!}
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
          title={t('userKnowledgeBase.largeFile.title')}
          message={
            <div>
              <p>{t('userKnowledgeBase.largeFile.description')}</p>
              <ul className="mb-3">
                {pendingLargeFiles.map((file, index) => (
                  <li key={index}>
                    <strong>{file.name}</strong> ({formatFileSize(file.size)})
                  </li>
                ))}
              </ul>
              <p className="mb-0">{t('userKnowledgeBase.largeFile.warning')}</p>
              <div className="alert alert-info mb-3 mt-3">
                <i className="bi bi-info-circle me-2"></i>
                <strong>{t('userKnowledgeBase.largeFile.recommendationLabel')}</strong>{' '}
                {t('userKnowledgeBase.largeFile.recommendation')}
              </div>
              <p className="mb-0">{t('userKnowledgeBase.largeFile.confirm')}</p>
            </div>
          }
          show={showNotificationModal}
          onHide={handleCancelUpload}
          onConfirm={handleProceedWithUpload}
          confirmText={t('userKnowledgeBase.largeFile.confirmButton')}
          cancelText={t('userKnowledgeBase.largeFile.cancelButton')}
          showCancelButton={true}
          size="lg"
        />
      )}
    </div>
  );
}
