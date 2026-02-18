/**
 * WorkspaceChatFileUpload - Modal for uploading files to workspace.
 *
 * Uploads files directly to S3 using presigned URLs, bypassing CloudFront's 10MB limit.
 * Supports files up to 200MB with real progress tracking.
 * Supports drag-and-drop, multi-file selection, and folder uploads.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { Modal, Button, ProgressBar, Alert } from 'react-bootstrap';
import { useTranslation, Trans } from 'react-i18next';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import { uploadWorkspaceChatFileDirect } from '../../Services/workspaceChatAgentService';
import type { WorkspaceChatUploadResponse } from '../../types/workspaceChatTypes';

// ============================================================
// Types
// ============================================================

export interface WorkspaceChatFileUploadProps {
  show: boolean;
  onHide: () => void;
  conversationId: string;
  onUploadComplete?: (responses: WorkspaceChatUploadResponse[]) => void;
  /** Function to get AWS credentials for direct S3 uploads */
  getCredentials: () => Promise<AwsCredentialIdentity>;
}

interface FileUploadItem {
  file: File;
  relativePath?: string; // For folder uploads, preserves structure
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
  response?: WorkspaceChatUploadResponse;
}

type OverallStatus = 'idle' | 'uploading' | 'success' | 'error' | 'partial';

// ============================================================
// Helper Functions
// ============================================================

/**
 * Format file size for display.
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get file icon based on extension.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const iconMap: Record<string, string> = {
    pdf: 'bi-file-earmark-pdf',
    doc: 'bi-file-earmark-word',
    docx: 'bi-file-earmark-word',
    xls: 'bi-file-earmark-excel',
    xlsx: 'bi-file-earmark-excel',
    csv: 'bi-file-earmark-spreadsheet',
    txt: 'bi-file-earmark-text',
    md: 'bi-file-earmark-text',
    json: 'bi-file-earmark-code',
    js: 'bi-file-earmark-code',
    ts: 'bi-file-earmark-code',
    tsx: 'bi-file-earmark-code',
    jsx: 'bi-file-earmark-code',
    py: 'bi-file-earmark-code',
    html: 'bi-file-earmark-code',
    css: 'bi-file-earmark-code',
    jpg: 'bi-file-earmark-image',
    jpeg: 'bi-file-earmark-image',
    png: 'bi-file-earmark-image',
    gif: 'bi-file-earmark-image',
    svg: 'bi-file-earmark-image',
    zip: 'bi-file-earmark-zip',
    tar: 'bi-file-earmark-zip',
    gz: 'bi-file-earmark-zip',
  };
  return iconMap[ext] || 'bi-file-earmark';
}

// ============================================================
// Main Component
// ============================================================

export function WorkspaceChatFileUpload({
  show,
  onHide,
  conversationId,
  onUploadComplete,
  getCredentials,
}: WorkspaceChatFileUploadProps) {
  const { t } = useTranslation('chat');
  const [files, setFiles] = useState<FileUploadItem[]>([]);
  const [overallStatus, setOverallStatus] = useState<OverallStatus>('idle');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  /**
   * Reset upload state.
   */
  const resetState = useCallback(() => {
    setFiles([]);
    setOverallStatus('idle');
    // Reset file inputs
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  }, []);

  /**
   * Reset state when modal opens.
   */
  useEffect(() => {
    if (show) {
      resetState();
    }
  }, [show, resetState]);

  /**
   * Check if a File entry is actually a folder (not a real file).
   * On macOS, folder entries have empty type and small size (metadata only).
   */
  const isFolderEntry = useCallback((file: File): boolean => {
    // Folder entries typically have:
    // - Empty type (no MIME type)
    // - Small size (64, 128, etc - just metadata)
    // - No file extension
    if (file.type !== '') return false;
    if (file.size > 512) return false; // Real files are usually larger
    // Check if it has no extension (folders don't have extensions)
    const hasExtension = file.name.includes('.') && !file.name.startsWith('.');
    return !hasExtension;
  }, []);

  /**
   * Add files to the upload queue.
   */
  const addFiles = useCallback(
    (newFiles: File[], relativePaths?: string[]) => {
      const maxSize = 500 * 1024 * 1024; // 500MB (direct S3 upload bypasses CloudFront 10MB limit)

      // Filter out folder entries that browsers sometimes include
      const filteredFiles: Array<{ file: File; relativePath?: string }> = [];
      for (let i = 0; i < newFiles.length; i++) {
        const file = newFiles[i];
        if (isFolderEntry(file)) {
          console.log(`[WorkspaceChatFileUpload] Skipping folder entry: ${file.name} (${file.size} bytes)`);
          continue;
        }
        filteredFiles.push({ file, relativePath: relativePaths?.[i] });
      }

      if (filteredFiles.length === 0) {
        console.warn('[WorkspaceChatFileUpload] No valid files found in selection');
        return;
      }

      const items: FileUploadItem[] = filteredFiles.map(({ file, relativePath }) => {
        if (file.size > maxSize) {
          return {
            file,
            relativePath,
            status: 'error' as const,
            progress: 0,
            error: t('workspace.fileUpload.fileTooLarge'),
          };
        }
        return {
          file,
          relativePath,
          status: 'pending' as const,
          progress: 0,
        };
      });

      setFiles((prev) => [...prev, ...items]);
    },
    [isFolderEntry],
  );

  /**
   * Upload all pending files.
   *
   * Uses direct S3 upload with presigned URLs to bypass CloudFront's 10MB limit.
   * Real progress tracking via axios onUploadProgress.
   */
  const uploadFiles = useCallback(async () => {
    const pendingFiles = files.filter((f) => f.status === 'pending');
    if (pendingFiles.length === 0) return;

    setOverallStatus('uploading');
    const responses: WorkspaceChatUploadResponse[] = [];

    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      if (item.status !== 'pending') continue;

      // Mark as uploading with 0 progress
      setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, status: 'uploading' as const, progress: 0 } : f)));

      try {
        // Create progress callback for this file index
        const onProgress = (progress: number) => {
          setFiles((prev) => prev.map((f, idx) => (idx === i && f.status === 'uploading' ? { ...f, progress } : f)));
        };

        // Use direct S3 upload with real progress tracking
        const response = await uploadWorkspaceChatFileDirect(
          item.file,
          conversationId,
          item.relativePath,
          onProgress,
          getCredentials,
        );

        setFiles((prev) =>
          prev.map((f, idx) => (idx === i ? { ...f, status: 'success' as const, progress: 100, response } : f)),
        );

        responses.push(response);
      } catch (error) {
        console.error('[WorkspaceChatFileUpload] Upload failed:', error);
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? {
                  ...f,
                  status: 'error' as const,
                  progress: 0,
                  error: (error as Error).message || 'Upload failed',
                }
              : f,
          ),
        );
      }
    }

    // Determine overall status
    const finalFiles = await new Promise<FileUploadItem[]>((resolve) => {
      setFiles((prev) => {
        resolve(prev);
        return prev;
      });
    });

    const allSuccess = finalFiles.every((f) => f.status === 'success');
    const allError = finalFiles.every((f) => f.status === 'error');

    if (allSuccess) {
      setOverallStatus('success');
    } else if (allError) {
      setOverallStatus('error');
    } else {
      setOverallStatus('partial');
    }

    if (responses.length > 0 && onUploadComplete) {
      onUploadComplete(responses);
    }
  }, [files, conversationId, onUploadComplete, getCredentials]);

  /**
   * Handle file input change (multi-file).
   */
  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length > 0) {
      addFiles(selectedFiles);
    }
  };

  /**
   * Handle folder input change.
   */
  const handleFolderInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length > 0) {
      // Extract relative paths from webkitRelativePath
      const relativePaths = selectedFiles.map((f) => {
        // webkitRelativePath is like "folderName/subdir/file.txt"
        // We want to preserve the structure under uploads/
        return (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      });
      addFiles(selectedFiles, relativePaths);
    }
  };

  /**
   * Handle drag events.
   */
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

  /**
   * Recursively read all files from a FileSystemDirectoryEntry.
   */
  const readDirectoryRecursively = async (
    dirEntry: FileSystemDirectoryEntry,
    basePath: string,
  ): Promise<Array<{ file: File; relativePath: string }>> => {
    const results: Array<{ file: File; relativePath: string }> = [];

    const readEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> => {
      return new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
    };

    const reader = dirEntry.createReader();
    let entries: FileSystemEntry[] = [];

    // readEntries may not return all entries at once, need to call repeatedly
    let batch: FileSystemEntry[];
    do {
      batch = await readEntries(reader);
      entries = entries.concat(batch);
    } while (batch.length > 0);

    for (const entry of entries) {
      const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        const file = await new Promise<File>((resolve, reject) => {
          fileEntry.file(resolve, reject);
        });
        results.push({ file, relativePath: entryPath });
      } else if (entry.isDirectory) {
        const subResults = await readDirectoryRecursively(entry as FileSystemDirectoryEntry, entryPath);
        results.push(...subResults);
      }
    }

    return results;
  };

  /**
   * Get file from a FileSystemFileEntry.
   */
  const getFileFromEntry = (entry: FileSystemFileEntry): Promise<File> => {
    return new Promise((resolve, reject) => {
      entry.file(resolve, reject);
    });
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const items = e.dataTransfer.items;
    const allFiles: Array<{ file: File; relativePath: string }> = [];

    // Use webkitGetAsEntry to properly handle folders
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) {
        entries.push(entry);
      }
    }

    // Process each entry (file or directory)
    for (const entry of entries) {
      if (entry.isFile) {
        const file = await getFileFromEntry(entry as FileSystemFileEntry);
        allFiles.push({ file, relativePath: file.name });
      } else if (entry.isDirectory) {
        // Recursively read directory contents
        const dirFiles = await readDirectoryRecursively(entry as FileSystemDirectoryEntry, entry.name);
        allFiles.push(...dirFiles);
      }
    }

    if (allFiles.length > 0) {
      const files = allFiles.map((f) => f.file);
      const paths = allFiles.map((f) => f.relativePath);
      addFiles(files, paths);
    } else {
      // Fallback to simple file list if webkitGetAsEntry not supported
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0) {
        addFiles(droppedFiles);
      }
    }
  };

  /**
   * Remove a file from the queue.
   */
  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  /**
   * Handle close.
   */
  const handleClose = () => {
    resetState();
    onHide();
  };

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const successCount = files.filter((f) => f.status === 'success').length;
  const errorCount = files.filter((f) => f.status === 'error').length;
  const isUploading = overallStatus === 'uploading';

  return (
    <Modal show={show} onHide={handleClose} centered dialogClassName="workspace-chat-upload-modal">
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-cloud-upload me-2" />
          {t('workspace.fileUpload.title')}
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
          <p className="mb-1">{t('workspace.fileUpload.dropzone')}</p>
          <p className="text-muted small mb-2">{t('workspace.fileUpload.clickToBrowse')}</p>
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
              {t('workspace.fileUpload.uploadFiles')}
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
              {t('workspace.fileUpload.uploadFolder')}
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
          <div className="file-upload-list mt-3" style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {files.map((item, index) => (
              <div key={index} className="d-flex align-items-center py-2 px-2 border-bottom" style={{ gap: '0.5rem' }}>
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
                {item.status === 'pending' && (
                  <button
                    className="btn btn-sm btn-link text-danger p-0"
                    onClick={() => removeFile(index)}
                    title={t('workspace.fileUpload.remove')}
                    disabled={isUploading}
                  >
                    <i className="bi bi-x-lg" />
                  </button>
                )}
                {item.status === 'uploading' && (
                  <div style={{ width: '60px' }}>
                    <ProgressBar now={item.progress} size="sm" animated striped style={{ height: '6px' }} />
                  </div>
                )}
                {item.status === 'success' && <i className="bi bi-check-circle-fill text-success" />}
                {item.status === 'error' && (
                  <i className="bi bi-exclamation-circle-fill text-danger" title={item.error} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Status Summary */}
        {overallStatus !== 'idle' && overallStatus !== 'uploading' && (
          <Alert
            variant={overallStatus === 'success' ? 'success' : overallStatus === 'error' ? 'danger' : 'warning'}
            className="mt-3 mb-0 small"
          >
            {overallStatus === 'success' && (
              <>
                <i className="bi bi-check-circle me-1" />
                {t('workspace.fileUpload.success', { count: successCount })}
              </>
            )}
            {overallStatus === 'error' && (
              <>
                <i className="bi bi-exclamation-circle me-1" />
                {t('workspace.fileUpload.allFailed')}
              </>
            )}
            {overallStatus === 'partial' && (
              <>
                <i className="bi bi-exclamation-triangle me-1" />
                {t('workspace.fileUpload.partialSuccess', { success: successCount, failed: errorCount })}
              </>
            )}
          </Alert>
        )}

        {/* Info */}
        <Alert variant="info" className="mt-3 mb-0 small">
          <i className="bi bi-info-circle me-1" />
          <Trans
            i18nKey="workspace.fileUpload.infoMessage"
            ns="chat"
            values={{ directory: 'uploads/' }}
            components={{ code: <code /> }}
          />
        </Alert>
      </Modal.Body>
      <Modal.Footer>
        {overallStatus === 'idle' && files.length > 0 && (
          <>
            <Button variant="secondary" onClick={resetState}>
              {t('workspace.fileUpload.clear')}
            </Button>
            <Button variant="primary" onClick={uploadFiles} disabled={pendingCount === 0}>
              <i className="bi bi-upload me-1" />
              {t('workspace.fileUpload.uploadCount', { count: pendingCount })}
            </Button>
          </>
        )}
        {overallStatus === 'uploading' && (
          <Button variant="secondary" disabled>
            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
            {t('workspace.fileUpload.uploading')}
          </Button>
        )}
        {(overallStatus === 'success' || overallStatus === 'partial' || overallStatus === 'error') && (
          <>
            <Button variant="secondary" onClick={resetState}>
              {t('workspace.fileUpload.uploadMore')}
            </Button>
            <Button variant="primary" onClick={handleClose}>
              {t('workspace.fileUpload.done')}
            </Button>
          </>
        )}
        {overallStatus === 'idle' && files.length === 0 && (
          <Button variant="secondary" onClick={handleClose}>
            {t('workspace.fileUpload.cancel')}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}

export default WorkspaceChatFileUpload;
