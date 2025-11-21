/**
 * User KB Detail Page
 * Shows detailed view of a single user knowledge base with tabs
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Alert, Spinner } from 'react-bootstrap';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { PageHeader } from '../Components/PageHeader';
import { KBTabLayout } from '../Components/KnowledgeBase/KBTabLayout';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import { FileUploader } from '../Components/FileUploader';
import { NotificationModal } from '../Components/NotificationModal';
import { isFileTypeValidForBedrockKB, shouldShowLargeDataFileWarning, formatFileSize } from '../utils/fileUtils';

export function UserKBDetailPage(): React.JSX.Element {
  const { kbId } = useParams<{ kbId: string }>();
  const navigate = useNavigate();
  const { availableKBs } = useKnowledgeBase();

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [fileValidationError, setFileValidationError] = useState<string | null>(null);
  const [showNotificationModal, setShowNotificationModal] = useState<boolean>(false);
  const [pendingLargeFiles, setPendingLargeFiles] = useState<File[]>([]);
  const [clearFileUploader, setClearFileUploader] = useState<boolean>(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Find the current KB
  const currentKB = availableKBs.find((kb) => kb.kb_id === kbId);

  // Redirect if KB not found
  useEffect(() => {
    if (!currentKB && availableKBs.length > 0 && kbId) {
      console.error('KB not found:', kbId);
      navigate('/user-knowledge-bases');
    }
  }, [currentKB, availableKBs, kbId, navigate]);

  // Reset clearFileUploader after it's been used
  useEffect(() => {
    if (clearFileUploader) {
      const timer = setTimeout(() => {
        setClearFileUploader(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [clearFileUploader]);

  /**
   * Validates files before upload
   */
  function validateFiles(files: File[]): boolean {
    const invalidFiles = files.filter((file) => !isFileTypeValidForBedrockKB(file));

    if (invalidFiles.length > 0) {
      const invalidFileNames = invalidFiles.map((file) => file.name).join(', ');
      setFileValidationError(
        `The following files are not supported: ${invalidFileNames}. Please upload supported file types.`,
      );
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
  }

  if (!currentKB) {
    return (
      <div className="user-kb-detail-page">
        <PageHeader title="Loading..." subtitle="Please wait" />
        <LayoutDashboard>
          <div className="text-center p-5">
            <Spinner animation="border" variant="primary" />
            <p className="mt-3 text-muted">Loading knowledge base...</p>
          </div>
        </LayoutDashboard>
      </div>
    );
  }

  const canEdit = currentKB.role === 'EDITOR' || currentKB.role === 'OWNER';
  const isShared = currentKB.role === 'VIEWER';

  return (
    <div className="user-kb-detail-page">
      <PageHeader
        title={
          <>
            <Button variant="link" className="kb-back-button" onClick={() => navigate('/user-knowledge-bases')}>
              <i className="bi bi-arrow-left" style={{ fontSize: '1.5rem' }}></i>
            </Button>
            {currentKB.kb_name}
          </>
        }
        subtitle={isShared ? 'Shared with you' : 'Personal Knowledge Base'}
        actions={
          canEdit ? (
            <Button variant="primary" onClick={() => setShowUploadModal(true)}>
              <i className="bi bi-upload me-2"></i>
              Upload Files
            </Button>
          ) : null
        }
      />

      <LayoutDashboard>
        {uploadSuccess && (
          <Alert variant="success" dismissible onClose={() => setUploadSuccess(false)} className="mb-4">
            <i className="bi bi-check-circle me-2"></i>
            Files uploaded successfully!
          </Alert>
        )}

        <KBTabLayout kbId={kbId!} kbType="user" role={currentKB.role} onUploadSuccess={handleUploadSuccess} />
      </LayoutDashboard>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="modal show d-block kb-upload-modal-backdrop" onClick={() => setShowUploadModal(false)}>
          <div className="modal-dialog modal-dialog-centered kb-upload-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-upload me-2"></i>
                  Upload Files to {currentKB.kb_name}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowUploadModal(false)}
                  aria-label="Close"
                ></button>
              </div>
              <div className="modal-body">
                <p className="text-muted small mb-3">
                  Files will be automatically indexed every 30 minutes and made available for querying in Numa Chat.
                </p>

                {fileValidationError && (
                  <Alert variant="danger" className="mb-3">
                    <strong>File Validation Error:</strong>
                    <p className="mb-0 mt-1">{fileValidationError}</p>
                  </Alert>
                )}

                <FileUploader
                  onUploadSuccess={handleUploadSuccess}
                  onFileSelect={handleFileSelect}
                  validateFile={isFileTypeValidForBedrockKB}
                  clearFiles={clearFileUploader}
                  kb_id={kbId!}
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
          title="Large Raw Data File Detected"
          message={
            <div>
              <p>You are about to upload large raw data files that may not be optimal for knowledge base indexing:</p>
              <ul className="mb-3">
                {pendingLargeFiles.map((file, index) => (
                  <li key={index}>
                    <strong>{file.name}</strong> ({formatFileSize(file.size)})
                  </li>
                ))}
              </ul>
              <p className="mb-0">
                This can incur higher than expected cost, or may fail to index successfully into the knowledge base.
              </p>
              <div className="alert alert-info mb-3 mt-3">
                <i className="bi bi-info-circle me-2"></i>
                <strong>Recommendation:</strong> For better knowledge base performance, consider breaking large raw data
                files into smaller chunks.
              </div>
              <p className="mb-0">Do you want to proceed with uploading these files anyway?</p>
            </div>
          }
          show={showNotificationModal}
          onHide={handleCancelUpload}
          onConfirm={handleProceedWithUpload}
          confirmText="Proceed Anyway"
          cancelText="Cancel Upload"
          showCancelButton={true}
          size="lg"
        />
      )}
    </div>
  );
}
