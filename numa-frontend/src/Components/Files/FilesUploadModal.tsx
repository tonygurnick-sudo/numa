/**
 * FilesUploadModal - Modal for uploading files to Files section.
 *
 * Features:
 * - Drag-and-drop or file picker (files + folders)
 * - Per-file progress bars via XMLHttpRequest
 * - Upload cancellation (individual or all) via xhr.abort()
 * - Navigation guard (beforeunload) while uploading
 * - Modal close protection during active uploads
 * - Pre-loaded files via initialFiles prop (for page-level drag-drop)
 * - 3-file concurrency limit
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { Modal, Button, ProgressBar, Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { useAuth } from '../../Providers/AuthProvider';
import { useToast } from '../../Providers/ToastContext';
import { withPRM } from '../../utils/prmUtils';
import { buildS3Key, formatFileSize, getFileIcon } from '../../Services/filesService';
import type { FileScope } from '../../Services/filesService';

// ============================================================
// Types
// ============================================================

export interface FilesUploadModalProps {
  show: boolean;
  onHide: () => void;
  scope: FileScope;
  currentPath: string;
  onUploadComplete: () => void;
  initialFiles?: File[];
}

interface FileUploadItem {
  file: File;
  relativePath?: string;
  status: 'pending' | 'uploading' | 'success' | 'error' | 'cancelled';
  progress: number;
  error?: string;
  id: string; // unique id for tracking (not stored in backend)
}

type OverallStatus = 'idle' | 'uploading' | 'success' | 'error' | 'partial' | 'cancelled';

// ============================================================
// Helper Functions
// ============================================================

const isFolderEntry = (file: File): boolean => {
  if (file.type !== '') return false;
  if (file.size > 512) return false;
  const hasExtension = file.name.includes('.') && !file.name.startsWith('.');
  return !hasExtension;
};

// ============================================================
// Main Component
// ============================================================

export function FilesUploadModal({
  show,
  onHide,
  scope,
  currentPath,
  onUploadComplete,
  initialFiles,
}: FilesUploadModalProps) {
  const { t } = useTranslation('files');
  const { showToast } = useToast();
  const { user, getCredentials } = useAuth();
  const [files, setFiles] = useState<FileUploadItem[]>([]);
  const [overallStatus, setOverallStatus] = useState<OverallStatus>('idle');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [activeUploads, setActiveUploads] = useState(0);
  const xhrRefs = useRef<Map<string, XMLHttpRequest>>(new Map());
  const cancelledRef = useRef(false);

  const resetState = useCallback(() => {
    // Abort any in-progress uploads
    xhrRefs.current.forEach((xhr) => xhr.abort());
    xhrRefs.current.clear();
    cancelledRef.current = false;
    setFiles([]);
    setOverallStatus('idle');
    setActiveUploads(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  }, []);

  const addFiles = useCallback((newFiles: File[], relativePaths?: string[]) => {
    const items: FileUploadItem[] = [];
    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      if (isFolderEntry(file)) continue;
      items.push({
        file,
        relativePath: relativePaths?.[i],
        status: 'pending',
        progress: 0,
        id: crypto.randomUUID(),
      });
    }

    if (items.length > 0) {
      setFiles((prev) => [...prev, ...items]);
    }
  }, []);

  // Reset and load initial files when modal opens
  useEffect(() => {
    if (show) {
      resetState();
      if (initialFiles?.length) {
        // Use setTimeout to ensure resetState completes first
        setTimeout(() => addFiles(initialFiles), 0);
      }
    }
  }, [show]);

  // Navigation guard: warn before leaving page during upload
  useEffect(() => {
    const isActive = overallStatus === 'uploading' || activeUploads > 0;
    if (!isActive) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [overallStatus, activeUploads]);

  // Cancel a single file upload
  const cancelUpload = useCallback((id: string) => {
    const xhr = xhrRefs.current.get(id);
    if (xhr) {
      xhr.abort();
      xhrRefs.current.delete(id);
    }
    setFiles((prev) =>
      prev.map((f) =>
        f.id === id && (f.status === 'uploading' || f.status === 'pending')
          ? { ...f, status: 'cancelled' as const, progress: 0 }
          : f
      )
    );
  }, []);

  // Cancel all uploads
  const cancelAll = useCallback(() => {
    cancelledRef.current = true;
    xhrRefs.current.forEach((xhr) => xhr.abort());
    xhrRefs.current.clear();
    setFiles((prev) =>
      prev.map((f) =>
        f.status === 'uploading' || f.status === 'pending' ? { ...f, status: 'cancelled' as const, progress: 0 } : f
      )
    );
    setOverallStatus('cancelled');
  }, []);

  const uploadFiles = useCallback(async () => {
    const pendingFiles = files.filter((f) => f.status === 'pending');
    if (pendingFiles.length === 0) return;

    cancelledRef.current = false;
    setOverallStatus('uploading');

    const region = sessionStorage.getItem('REGION') || 'us-east-1';
    const bucket = sessionStorage.getItem('DATA_BUCKET');
    const userSub = user?.decoded_tokens?.idToken?.sub as string | undefined;

    if (!bucket || !userSub) {
      showToast({ message: t('upload.configError'), variant: 'error' });
      setOverallStatus('error');
      return;
    }

    let credentials;
    try {
      credentials = await getCredentials();
    } catch (err) {
      console.error('Failed to get upload credentials:', err);
      showToast({ message: t('upload.credentialsError'), variant: 'error' });
      setOverallStatus('error');
      return;
    }

    if (!credentials) {
      showToast({ message: t('upload.credentialsError'), variant: 'error' });
      setOverallStatus('error');
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s3Client = withPRM(S3Client as any, { region, credentials });

    const processFile = async (fileItem: FileUploadItem, index: number) => {
      // Skip if globally cancelled or individually cancelled
      if (cancelledRef.current) return;

      setActiveUploads((prev) => prev + 1);

      try {
        // Check if file was cancelled before starting
        const currentFile = files[index];
        if (currentFile?.status === 'cancelled') return;

        setFiles((prev) =>
          prev.map((f, idx) => (idx === index ? { ...f, status: 'uploading' as const, progress: 0 } : f))
        );

        // Build the upload path — for folder uploads, include relative path
        const uploadPath = fileItem.relativePath
          ? `${currentPath}${fileItem.relativePath}`.replace(/\/+/g, '/')
          : currentPath;

        // For folder uploads, use the directory part; for single files, use currentPath
        const uploadDir = fileItem.relativePath
          ? uploadPath.substring(0, uploadPath.lastIndexOf('/') + 1) || currentPath
          : currentPath;

        const s3Key = buildS3Key(scope, fileItem.file.name, uploadDir, userSub);
        const command = new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          ContentType: fileItem.file.type || 'application/octet-stream',
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const presignedUrl = await getSignedUrl(s3Client as any, command, { expiresIn: 3600 });

        // Upload to S3 with progress tracking and abort support
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrRefs.current.set(fileItem.id, xhr);

          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              setFiles((prev) =>
                prev.map((f, idx) => (idx === index && f.status === 'uploading' ? { ...f, progress: pct } : f))
              );
            }
          });
          xhr.addEventListener('load', () => {
            xhrRefs.current.delete(fileItem.id);
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Upload failed: ${xhr.status}`));
          });
          xhr.addEventListener('error', () => {
            xhrRefs.current.delete(fileItem.id);
            reject(new Error('Upload failed'));
          });
          xhr.addEventListener('abort', () => {
            xhrRefs.current.delete(fileItem.id);
            reject(new Error('Upload cancelled'));
          });
          xhr.open('PUT', presignedUrl);
          xhr.setRequestHeader('Content-Type', fileItem.file.type || 'application/octet-stream');
          xhr.send(fileItem.file);
        });

        // No registerFile needed — S3 is the source of truth
        setFiles((prev) =>
          prev.map((f, idx) => (idx === index ? { ...f, status: 'success' as const, progress: 100 } : f))
        );
      } catch (error) {
        const msg = (error as Error).message || 'Upload failed';
        if (msg === 'Upload cancelled' || cancelledRef.current) {
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === index && f.status !== 'cancelled' ? { ...f, status: 'cancelled' as const, progress: 0 } : f
            )
          );
        } else {
          console.error(`Upload failed for ${fileItem.file.name}:`, error);
          setFiles((prev) =>
            prev.map((f, idx) => (idx === index ? { ...f, status: 'error' as const, progress: 0, error: msg } : f))
          );
        }
      } finally {
        setActiveUploads((prev) => prev - 1);
      }
    };

    // Process files with concurrency limit of 3
    const fileIndices = pendingFiles.map((_, i) => files.findIndex((f) => f.id === pendingFiles[i].id));

    for (let i = 0; i < fileIndices.length; i += 3) {
      if (cancelledRef.current) break;
      const batch = fileIndices.slice(i, i + 3);
      const promises = batch.map((index) => processFile(files[index], index));
      await Promise.all(promises);
    }

    // Determine overall status (read latest state via callback)
    setFiles((currentFiles) => {
      const hasSuccess = currentFiles.some((f) => f.status === 'success');
      const hasError = currentFiles.some((f) => f.status === 'error');
      const hasCancelled = currentFiles.some((f) => f.status === 'cancelled');
      const allSuccess = currentFiles.every((f) => f.status === 'success');

      if (cancelledRef.current || (hasCancelled && !hasSuccess && !hasError)) {
        setOverallStatus('cancelled');
      } else if (allSuccess) {
        setOverallStatus('success');
      } else if (hasSuccess && (hasError || hasCancelled)) {
        setOverallStatus('partial');
      } else {
        setOverallStatus('error');
      }
      return currentFiles;
    });

    onUploadComplete();
  }, [files, scope, currentPath, user, getCredentials, showToast, t, onUploadComplete]);

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length > 0) addFiles(selectedFiles);
  };

  const handleFolderInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length > 0) {
      const relativePaths = selectedFiles.map(
        (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
      );
      addFiles(selectedFiles, relativePaths);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const readDirectoryRecursively = async (
    dirEntry: FileSystemDirectoryEntry,
    basePath: string
  ): Promise<Array<{ file: File; relativePath: string }>> => {
    const results: Array<{ file: File; relativePath: string }> = [];
    const readEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
      new Promise((resolve, reject) => reader.readEntries(resolve, reject));

    const reader = dirEntry.createReader();
    let entries: FileSystemEntry[] = [];
    let batch: FileSystemEntry[];
    do {
      batch = await readEntries(reader);
      entries = entries.concat(batch);
    } while (batch.length > 0);

    for (const entry of entries) {
      const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
        results.push({ file, relativePath: entryPath });
      } else if (entry.isDirectory) {
        const subResults = await readDirectoryRecursively(entry as FileSystemDirectoryEntry, entryPath);
        results.push(...subResults);
      }
    }
    return results;
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const items = e.dataTransfer.items;
    const allFiles: Array<{ file: File; relativePath: string }> = [];

    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }

    for (const entry of entries) {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
        allFiles.push({ file, relativePath: file.name });
      } else if (entry.isDirectory) {
        const dirFiles = await readDirectoryRecursively(entry as FileSystemDirectoryEntry, entry.name);
        allFiles.push(...dirFiles);
      }
    }

    if (allFiles.length > 0) {
      addFiles(
        allFiles.map((f) => f.file),
        allFiles.map((f) => f.relativePath)
      );
    } else {
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0) addFiles(droppedFiles);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClose = () => {
    if (overallStatus === 'uploading' || activeUploads > 0) {
      if (!window.confirm(t('upload.cancelConfirm'))) return;
      cancelAll();
    }
    resetState();
    onHide();
  };

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const successCount = files.filter((f) => f.status === 'success').length;
  const errorCount = files.filter((f) => f.status === 'error').length;
  const isUploading = overallStatus === 'uploading' || activeUploads > 0;
  const isFinished =
    overallStatus === 'success' ||
    overallStatus === 'partial' ||
    overallStatus === 'error' ||
    overallStatus === 'cancelled';

  return (
    <Modal
      show={show}
      onHide={handleClose}
      centered
      dialogClassName="files-upload-modal"
      backdrop={isUploading ? 'static' : true}
      keyboard={!isUploading}
    >
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-cloud-upload me-2" />
          {t('upload.title')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {/* Drop Zone */}
        <div
          className={`drop-zone p-4 text-center rounded border ${isDragging ? 'border-primary bg-light' : 'border-dashed'}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isUploading && fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !isUploading) {
              fileInputRef.current?.click();
            }
          }}
          style={{
            cursor: isUploading ? 'default' : 'pointer',
            minHeight: '120px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            borderStyle: 'dashed',
            borderWidth: '2px',
            transition: 'all 0.2s ease-in-out',
          }}
        >
          <i className="bi bi-cloud-arrow-up fs-1 text-muted mb-2" />
          <p className="mb-1">{t('upload.dropzone')}</p>
          <p className="text-muted small mb-2">{t('upload.clickToBrowse')}</p>
          <div className="d-flex gap-2">
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              disabled={isUploading}
            >
              <i className="bi bi-file-earmark-plus me-1" />
              {t('upload.uploadFiles')}
            </Button>
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                folderInputRef.current?.click();
              }}
              disabled={isUploading}
            >
              <i className="bi bi-folder-plus me-1" />
              {t('upload.uploadFolder')}
            </Button>
          </div>
        </div>

        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          className="d-none"
          onChange={handleFileInputChange}
          accept="*/*"
          multiple
        />
        <input
          ref={folderInputRef}
          type="file"
          className="d-none"
          onChange={handleFolderInputChange}
          // @ts-expect-error webkitdirectory is a non-standard attribute
          webkitdirectory=""
          // eslint-disable-next-line react/no-unknown-property
          directory=""
          multiple
        />

        {/* File List */}
        {files.length > 0 && (
          <div className="file-upload-list mt-3" style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {files.map((item, index) => (
              <div
                key={item.id}
                className="d-flex align-items-center py-2 px-2 border-bottom"
                style={{ gap: '0.5rem' }}
              >
                <i className={`${getFileIcon(item.file.name)} text-muted`} />
                <div className="flex-grow-1 overflow-hidden">
                  <div
                    className="text-truncate small"
                    title={item.relativePath || item.file.name}
                    style={{ maxWidth: '250px' }}
                  >
                    {item.relativePath || item.file.name}
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                    {formatFileSize(item.file.size)}
                  </div>
                </div>
                {/* Pending: remove button */}
                {item.status === 'pending' && (
                  <button
                    className="btn btn-sm btn-link text-danger p-0"
                    onClick={() => removeFile(index)}
                    title={t('upload.remove')}
                    disabled={isUploading}
                  >
                    <i className="bi bi-x-lg" />
                  </button>
                )}
                {/* Uploading: progress bar + cancel */}
                {item.status === 'uploading' && (
                  <>
                    <div style={{ width: '60px' }}>
                      <ProgressBar now={item.progress} striped style={{ height: '6px' }} />
                    </div>
                    <button
                      className="btn btn-sm btn-link text-danger p-0"
                      onClick={() => cancelUpload(item.id)}
                      title={t('upload.cancelUpload')}
                    >
                      <i className="bi bi-x-lg" />
                    </button>
                  </>
                )}
                {item.status === 'success' && <i className="bi bi-check-circle-fill text-success" />}
                {item.status === 'error' && (
                  <i className="bi bi-exclamation-circle-fill text-danger" title={item.error} />
                )}
                {item.status === 'cancelled' && (
                  <i className="bi bi-dash-circle text-muted" title={t('upload.cancelled')} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Status Summary */}
        {isFinished && (
          <Alert
            variant={
              overallStatus === 'success'
                ? 'success'
                : overallStatus === 'cancelled'
                  ? 'secondary'
                  : overallStatus === 'error'
                    ? 'danger'
                    : 'warning'
            }
            className="mt-3 mb-0 small"
          >
            {overallStatus === 'success' && (
              <>
                <i className="bi bi-check-circle me-1" />
                {t('upload.success', { count: successCount })}
              </>
            )}
            {overallStatus === 'error' && (
              <>
                <i className="bi bi-exclamation-circle me-1" />
                {t('upload.allFailed')}
              </>
            )}
            {overallStatus === 'partial' && (
              <>
                <i className="bi bi-exclamation-triangle me-1" />
                {t('upload.partialSuccess', { success: successCount, failed: errorCount })}
              </>
            )}
            {overallStatus === 'cancelled' && (
              <>
                <i className="bi bi-dash-circle me-1" />
                {t('upload.cancelled')}
              </>
            )}
          </Alert>
        )}

        {/* Info */}
        <Alert variant="info" className="mt-3 mb-0 small">
          <i className="bi bi-info-circle me-1" />
          {t('upload.infoMessage')}
        </Alert>
      </Modal.Body>
      <Modal.Footer>
        {overallStatus === 'idle' && files.length > 0 && (
          <>
            <Button variant="secondary" onClick={resetState}>
              {t('upload.clear')}
            </Button>
            <Button variant="primary" onClick={uploadFiles} disabled={pendingCount === 0}>
              <i className="bi bi-upload me-1" />
              {t('upload.uploadCount', { count: pendingCount })}
            </Button>
          </>
        )}
        {isUploading && (
          <Button variant="danger" onClick={cancelAll}>
            <i className="bi bi-x-circle me-1" />
            {t('upload.cancelUpload')}
          </Button>
        )}
        {isFinished && (
          <>
            <Button variant="secondary" onClick={resetState}>
              {t('upload.uploadMore')}
            </Button>
            <Button variant="primary" onClick={handleClose}>
              {t('upload.done')}
            </Button>
          </>
        )}
        {overallStatus === 'idle' && files.length === 0 && (
          <Button variant="secondary" onClick={handleClose}>
            {t('upload.cancel')}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}

export default FilesUploadModal;
