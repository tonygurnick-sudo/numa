import { useState, useRef, useCallback } from 'react';
import { Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { requestUploadUrl, confirmUpload } from '../../Services/sharedChatService';
import type { DropZoneFile } from '../../Services/sharedChatService';
import { sanitizeS3Filename } from '../../utils/sanitizeFilename';

interface DropZoneUploadAreaProps {
  uuid: string;
  token?: string;
  maxFileSizeMb: number | null;
  allowedExtensions: string[] | null;
  disabled?: boolean;
  onUploadComplete: (file: DropZoneFile) => void;
  onQuotaUpdate: (usedMb: number) => void;
}

export const DropZoneUploadArea: React.FC<DropZoneUploadAreaProps> = ({
  uuid,
  token,
  maxFileSizeMb,
  allowedExtensions,
  disabled,
  onUploadComplete,
  onQuotaUpdate,
}) => {
  const { t } = useTranslation('files');
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const validateFile = useCallback(
    (file: File): string | null => {
      // Check file size
      if (maxFileSizeMb !== null && maxFileSizeMb !== undefined) {
        const maxBytes = maxFileSizeMb * 1024 * 1024;
        if (file.size > maxBytes) {
          return t('dropzones.fileTooLarge', { max: maxFileSizeMb });
        }
      }

      // Check file extension
      if (allowedExtensions && allowedExtensions.length > 0) {
        const ext = file.name.includes('.') ? '.' + file.name.split('.').pop()!.toLowerCase() : '';
        const allowed = allowedExtensions.map((e) => e.toLowerCase().trim());
        if (ext && !allowed.includes(ext)) {
          return t('dropzones.typeNotAllowed', { types: allowedExtensions.join(', ') });
        }
      }

      return null;
    },
    [maxFileSizeMb, allowedExtensions, t]
  );

  const uploadFile = useCallback(
    async (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      setUploading(true);
      setError(null);
      setUploadProgress(file.name);

      const safeName = sanitizeS3Filename(file.name);

      try {
        // 1. Get presigned URL
        const { upload_url, file_id } = await requestUploadUrl(
          uuid,
          safeName,
          file.type || 'application/octet-stream',
          file.size,
          token
        );

        // 2. Upload file to S3
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Upload failed: ${xhr.status}`));
          });
          xhr.addEventListener('error', () => reject(new Error('Upload failed')));
          xhr.open('PUT', upload_url);
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
          xhr.send(file);
        });

        // 3. Confirm upload
        const result = await confirmUpload(uuid, file_id, safeName, file.size, token);

        onQuotaUpdate(result.used_quota_mb);
        onUploadComplete({
          file_id,
          name: safeName,
          size_bytes: file.size,
          uploaded_at: Math.floor(Date.now() / 1000),
        });

        setUploadProgress(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('dropzones.uploadFailed'));
        setUploadProgress(null);
      } finally {
        setUploading(false);
      }
    },
    [uuid, token, validateFile, onUploadComplete, onQuotaUpdate, t]
  );

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList?.length) return;
      // Upload files sequentially
      Array.from(fileList).reduce((chain, file) => chain.then(() => uploadFile(file)), Promise.resolve());
    },
    [uploadFile]
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  return (
    <div>
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)} className="py-2 mb-3">
          {error}
        </Alert>
      )}

      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => !uploading && !disabled && fileInputRef.current?.click()}
        className={`text-center p-4 border border-2 rounded ${
          isDragging ? 'border-primary bg-primary bg-opacity-10' : 'border-dashed'
        }`}
        style={{
          cursor: disabled || uploading ? 'default' : 'pointer',
          borderColor: isDragging ? undefined : 'var(--bs-border-color)',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {uploading ? (
          <>
            <span className="spinner-border spinner-border-sm me-2" />
            <span>{t('dropzones.uploading')}</span>
            {uploadProgress && <div className="small text-muted mt-1">{uploadProgress}</div>}
          </>
        ) : (
          <>
            <i className="bi bi-cloud-arrow-up" style={{ fontSize: '2.5rem', color: 'var(--bs-primary)' }} />
            <p className="mb-1 mt-2 fw-semibold">{t('dropzones.uploadArea')}</p>
            <p className="mb-0 small text-muted">{t('dropzones.uploadAreaSubtext')}</p>
            {maxFileSizeMb && (
              <p className="mb-0 small text-muted">
                {t('dropzones.maxFileSize')}: {maxFileSizeMb} MB
              </p>
            )}
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          className="d-none"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          disabled={uploading || disabled}
        />
      </div>
    </div>
  );
};
