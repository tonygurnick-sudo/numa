import React, { useState, useCallback, useRef, useEffect } from 'react';
import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';
import Spinner from 'react-bootstrap/Spinner';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useAuth } from '../../../Providers/AuthProvider';
import * as OpsService from '../../../Services/OpsService';
import { FilePreviewPanel } from '../../FilePreviewPanel';
import type { FilePreview } from '../../../hooks/useFilePreviewProcessor';
import type { CommentAttachment } from '../../../types/ops';

interface AttachmentsSectionProps {
  ticketId: string;
}

interface DisplayAttachment extends CommentAttachment {
  downloadUrl?: string;
  uploadedAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mimeType: string | undefined): string {
  if (!mimeType) return 'bi-file-earmark';
  if (mimeType.startsWith('image/')) return 'bi-file-image';
  if (mimeType === 'application/pdf') return 'bi-file-pdf';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'bi-file-word';
  if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv'))
    return 'bi-file-spreadsheet';
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('gz')) return 'bi-file-zip';
  if (mimeType.startsWith('text/')) return 'bi-file-text';
  return 'bi-file-earmark';
}

function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

function isPreviewable(filename: string): boolean {
  const ext = getExtension(filename);
  return [
    'pdf',
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'xlsx',
    'xls',
    'docx',
    'csv',
    'json',
    'md',
    'markdown',
    'html',
    'htm',
    'vtt',
    'txt',
  ].includes(ext);
}

/**
 * AttachmentsSection — full file management for a ticket.
 *
 * Upload: drag-drop or browse → presigned PUT to S3 → attachment recorded on a comment.
 * View: opens FilePreviewPanel (same viewer as workspace chat / KB) in a fullscreen modal.
 *       Requires Cognito role to have s3:GetObject on ops/* in the outputs bucket
 *       (configured in infra/constructs/cognito-groups-construct.ts).
 * Download: presigned GET URL.
 */
export function AttachmentsSection({ ticketId }: AttachmentsSectionProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaPost, numaGet } = useNumaRequest();
  const { getCredentials, region: authRegion } = useAuth();

  // S3 config — same pattern as KB and workspace chat
  const bucket = window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME') ?? '';
  const region = authRegion || window.sessionStorage.getItem('REGION') || 'ap-southeast-2';

  const [uploading, setUploading] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [files, setFiles] = useState<DisplayAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // FilePreviewPanel modal state
  const [previewFile, setPreviewFile] = useState<FilePreview | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load existing attachments from comments ───────────────────────────────

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingFiles(true);
      try {
        const { comments } = await OpsService.listComments(numaGet, ticketId);
        const allAttachments: DisplayAttachment[] = [];
        for (const comment of comments) {
          for (const att of comment.attachments ?? []) {
            allAttachments.push({ ...att, uploadedAt: comment.createdAt });
          }
        }
        if (cancelled) return;

        // Generate presigned download URLs for the download button
        const withUrls = await Promise.all(
          allAttachments.map(async (att) => {
            try {
              const downloadUrl = await OpsService.getPresignedDownloadUrl(numaGet, att.s3Key);
              return { ...att, downloadUrl };
            } catch {
              return att;
            }
          })
        );
        if (!cancelled) setFiles(withUrls);
      } catch {
        // Non-fatal
      } finally {
        if (!cancelled) setLoadingFiles(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [numaGet, ticketId]);

  // ── Upload ────────────────────────────────────────────────────────────────

  const uploadFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      try {
        const { uploadUrl, s3Key } = await OpsService.getPresignedUrl(numaPost, {
          context: 'ticket',
          contextId: ticketId,
          fileName: file.name,
        });

        const uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
        if (!uploadResponse.ok) throw new Error(`Upload failed: ${uploadResponse.status}`);

        await OpsService.createComment(numaPost, ticketId, {
          content: `📎 Attached: ${file.name}`,
          attachments: [{ name: file.name, s3Key, size: file.size, mimeType: file.type || 'application/octet-stream' }],
        });

        let downloadUrl: string | undefined;
        try {
          downloadUrl = await OpsService.getPresignedDownloadUrl(numaGet, s3Key);
        } catch {
          /* non-fatal */
        }

        setFiles((prev) => [
          {
            name: file.name,
            s3Key,
            size: file.size,
            mimeType: file.type,
            uploadedAt: new Date().toISOString(),
            downloadUrl,
          },
          ...prev,
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errors.uploadFailed', 'Upload failed'));
      } finally {
        setUploading(false);
      }
    },
    [numaPost, numaGet, ticketId, t]
  );

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      for (const file of Array.from(fileList)) void uploadFile(file);
    },
    [uploadFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  // ── Open viewer ───────────────────────────────────────────────────────────

  const openPreview = useCallback((att: DisplayAttachment) => {
    setPreviewFile({
      type: 'file',
      filename: att.name,
      fullPath: att.s3Key,
      relativePath: att.name,
      extension: getExtension(att.name),
    });
    setShowPreview(true);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#6366f1' : '#e5e7eb'}`,
          borderRadius: 8,
          padding: '24px 20px',
          textAlign: 'center',
          cursor: uploading ? 'default' : 'pointer',
          backgroundColor: dragOver ? '#eef2ff' : '#f9fafb',
          transition: 'all 0.15s',
          marginBottom: 16,
        }}
      >
        {uploading ? (
          <div className="d-flex align-items-center justify-content-center gap-2 text-muted">
            <Spinner animation="border" size="sm" />
            <span style={{ fontSize: '0.875rem' }}>{t('tickets.uploading', 'Uploading…')}</span>
          </div>
        ) : (
          <>
            <i
              className="bi bi-cloud-upload"
              style={{ fontSize: '1.5rem', color: '#9ca3af', display: 'block', marginBottom: 6 }}
            />
            <p className="mb-1" style={{ fontSize: '0.875rem', color: '#374151', fontWeight: 500 }}>
              {t('tickets.dropFilesHere', 'Drop files here')}
            </p>
            <p className="mb-0" style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
              {t('tickets.orBrowse', 'or click to browse')}
            </p>
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {error && (
        <div className="alert alert-danger py-2 px-3 mb-3" style={{ fontSize: '0.875rem' }}>
          {error}
          <Button variant="link" size="sm" className="p-0 ms-2" onClick={() => setError(null)}>
            {t('common.dismiss', 'Dismiss')}
          </Button>
        </div>
      )}

      {/* File list */}
      {loadingFiles ? (
        <div className="d-flex align-items-center gap-2 text-muted" style={{ fontSize: '0.875rem' }}>
          <Spinner animation="border" size="sm" />
          <span>{t('common.loading')}</span>
        </div>
      ) : files.length === 0 ? (
        <p className="text-muted small mb-0">
          <i className="bi bi-paperclip me-1" />
          {t('tickets.noAttachments', 'No files attached yet')}
        </p>
      ) : (
        <div className="d-flex flex-column gap-1">
          {files.map((f, i) => (
            <div
              key={`${f.s3Key}-${i}`}
              className="d-flex align-items-center gap-2 p-2 rounded"
              style={{ backgroundColor: '#f3f4f6', fontSize: '0.85rem' }}
            >
              <i
                className={`bi ${fileIcon(f.mimeType)}`}
                style={{ color: '#6b7280', fontSize: '1rem', flexShrink: 0 }}
              />
              <span className="text-truncate flex-grow-1" title={f.name}>
                {f.name}
              </span>
              <span className="text-muted flex-shrink-0" style={{ fontSize: '0.75rem' }}>
                {formatBytes(f.size)}
              </span>

              {/* View button — uses FilePreviewPanel (requires infra IAM grant on ops/*) */}
              {isPreviewable(f.name) && (
                <Button
                  variant="outline-secondary"
                  size="sm"
                  className="py-0 px-2 flex-shrink-0"
                  style={{ fontSize: '0.75rem' }}
                  title={t('common.view', 'View')}
                  onClick={(e) => {
                    e.stopPropagation();
                    openPreview(f);
                  }}
                >
                  <i className="bi bi-eye me-1" />
                  {t('common.view', 'View')}
                </Button>
              )}

              {/* Download button */}
              {f.downloadUrl && (
                <a
                  href={f.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={f.name}
                  className="btn btn-sm btn-outline-secondary py-0 px-2 flex-shrink-0"
                  style={{ fontSize: '0.75rem' }}
                  title={t('common.download', 'Download')}
                  onClick={(e) => e.stopPropagation()}
                >
                  <i className="bi bi-download" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* File viewer modal — same pattern as KB mobile view */}
      <Modal show={showPreview} onHide={() => setShowPreview(false)} fullscreen centered>
        <Modal.Header closeButton style={{ backgroundColor: '#f9fafb' }}>
          <Modal.Title style={{ fontSize: '1rem', fontWeight: 600 }}>
            <i className="bi bi-paperclip me-2" style={{ color: '#6b7280' }} />
            {previewFile?.filename}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-0" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {previewFile && (
            <FilePreviewPanel
              preview={previewFile}
              onClose={() => setShowPreview(false)}
              bucket={bucket}
              region={region}
              getCredentials={getCredentials}
              embedded
            />
          )}
        </Modal.Body>
      </Modal>
    </>
  );
}
