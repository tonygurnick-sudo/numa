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

function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']);

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filename));
}

function thumbIcon(mimeType: string | undefined, _filename: string): { icon: string; color: string } {
  if (!mimeType) return { icon: 'bi-file-earmark', color: '#6b7280' };
  if (mimeType === 'application/pdf') return { icon: 'bi-file-pdf', color: '#ef4444' };
  if (mimeType.includes('word') || mimeType.includes('document')) return { icon: 'bi-file-word', color: '#2563eb' };
  if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv'))
    return { icon: 'bi-file-spreadsheet', color: '#16a34a' };
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('gz'))
    return { icon: 'bi-file-zip', color: '#d97706' };
  if (mimeType.startsWith('text/')) return { icon: 'bi-file-text', color: '#6b7280' };
  return { icon: 'bi-file-earmark', color: '#6b7280' };
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
          contentType: file.type || 'application/octet-stream',
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

  const renderThumbPreview = (f: DisplayAttachment) => {
    if (isImageFile(f.name) && f.downloadUrl) {
      return <img src={f.downloadUrl} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
    }
    const { icon, color } = thumbIcon(f.mimeType, f.name);
    const ext = getExtension(f.name);
    return (
      <div className="d-flex flex-column align-items-center justify-content-center">
        <i className={`bi ${icon}`} style={{ fontSize: '1.5rem', color }} />
        {ext && (
          <span style={{ fontSize: '0.6rem', color: '#9ca3af', marginTop: 2, textTransform: 'uppercase' }}>{ext}</span>
        )}
      </div>
    );
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {uploading && (
        <div className="d-flex align-items-center justify-content-center gap-2 text-muted mb-2">
          <Spinner animation="border" size="sm" />
          <span style={{ fontSize: '0.875rem' }}>{t('tickets.uploading', 'Uploading…')}</span>
        </div>
      )}

      {error && (
        <div className="alert alert-danger py-2 px-3 mb-2" style={{ fontSize: '0.875rem' }}>
          {error}
          <Button variant="link" size="sm" className="p-0 ms-2" onClick={() => setError(null)}>
            {t('common.dismiss', 'Dismiss')}
          </Button>
        </div>
      )}

      {/* Thumbnail gallery */}
      {loadingFiles ? (
        <div className="d-flex align-items-center gap-2 text-muted" style={{ fontSize: '0.875rem' }}>
          <Spinner animation="border" size="sm" />
          <span>{t('common.loading')}</span>
        </div>
      ) : files.length === 0 ? (
        <div
          className="ops-attachment-empty-zone"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          style={dragOver ? { borderColor: '#6366f1', background: '#eef2ff' } : undefined}
        >
          <i
            className="bi bi-paperclip"
            style={{ fontSize: '1.25rem', color: '#9ca3af', display: 'block', marginBottom: 4 }}
          />
          <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
            {t('tickets.dropOrAttach', 'Drop files here or click to attach')}
          </span>
        </div>
      ) : (
        <div
          className="d-flex flex-row gap-2 overflow-x-auto pb-2"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={dragOver ? { outline: '2px dashed #6366f1', borderRadius: 8, outlineOffset: 2 } : undefined}
        >
          {files.map((f, i) => (
            <div
              key={`${f.s3Key}-${i}`}
              className="ops-attachment-thumb"
              onClick={() => {
                if (isPreviewable(f.name)) {
                  openPreview(f);
                } else if (f.downloadUrl) {
                  window.open(f.downloadUrl, '_blank');
                }
              }}
              title={f.name}
            >
              <div className="ops-attachment-thumb-preview">{renderThumbPreview(f)}</div>
              {f.downloadUrl && (
                <a
                  href={f.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={f.name}
                  className="ops-attachment-thumb-delete"
                  style={{ background: '#6366f1' }}
                  title={t('common.download', 'Download')}
                  onClick={(e) => e.stopPropagation()}
                >
                  <i className="bi bi-download" />
                </a>
              )}
              <div className="ops-attachment-thumb-name">{f.name}</div>
              <div className="ops-attachment-thumb-size">{formatBytes(f.size)}</div>
            </div>
          ))}
          {/* Add-more button at the end of the gallery */}
          <div
            className="ops-attachment-thumb"
            onClick={() => !uploading && fileInputRef.current?.click()}
            title={t('tickets.addAttachment', 'Add attachment')}
          >
            <div className="ops-attachment-thumb-preview" style={{ border: '2px dashed var(--ops-border)' }}>
              <i className="bi bi-plus-lg" style={{ fontSize: '1.25rem', color: '#9ca3af' }} />
            </div>
          </div>
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
