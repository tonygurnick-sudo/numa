import React, { useState, useEffect, useCallback } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { getFileIconClass } from '../utils/fileUtils';
import { downloadFileFromS3, downloadFolderAsZip, listObjectsInFolder } from '../utils/s3Utils';
import { convertDocxPreview } from '../Services/workspaceChatAgentService';
import { FilePreviewActions } from './FilePreviewActions';
import {
  PdfPreview,
  XlsxPreview,
  DocxPreview,
  CsvPreview,
  ImagePreview,
  HtmlPreview,
  MarkdownPreview,
  FolderTreePreview,
  JsonPreview,
  VttPreview,
  PptxPreview,
  CodePreview,
  getLanguageFromExtension,
  CODE_EXTENSIONS,
} from './FilePreview';
import type { FilePreview as FilePreviewType, FolderPreview } from '../hooks/useFilePreviewProcessor';

interface FilePreviewPanelProps {
  preview: FilePreviewType | FolderPreview | null;
  onClose: () => void;
  bucket: string;
  region: string;
  getCredentials: () => Promise<unknown>;
  /** When true, hides the header (for use in modal containers) */
  embedded?: boolean;
  /** Pre-loaded content — skips S3 fetch when provided (used for inline documents) */
  initialContent?: string;
  /** Optional override for DOCX->PDF conversion (e.g. public demo uses its own proxy) */
  convertDocxFn?: (
    bucket: string,
    key: string,
    format?: string
  ) => Promise<{ url: string; filename: string; size: number }>;
  /** Base path for the full-screen preview route (default: '/file-preview') */
  fullScreenBasePath?: string;
}

// File size limits for preview (in bytes)
const FILE_SIZE_LIMITS: Record<string, number> = {
  pdf: 5 * 1024 * 1024,
  xlsx: 2 * 1024 * 1024,
  xls: 2 * 1024 * 1024,
  docx: 3 * 1024 * 1024,
  csv: 5 * 1024 * 1024,
  html: 2 * 1024 * 1024,
  json: 2 * 1024 * 1024,
  md: 1 * 1024 * 1024,
  markdown: 1 * 1024 * 1024,
  png: 10 * 1024 * 1024,
  jpg: 10 * 1024 * 1024,
  jpeg: 10 * 1024 * 1024,
  gif: 10 * 1024 * 1024,
  pptx: 10 * 1024 * 1024,
  ppt: 10 * 1024 * 1024,
  svg: 5 * 1024 * 1024,
  webp: 10 * 1024 * 1024,
};

const DEFAULT_SIZE_LIMIT = 5 * 1024 * 1024;

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * FilePreviewPanel - Right-side panel for previewing files and folders in split view
 * Supports: PDF, XLSX, DOCX, CSV, Markdown, HTML, Images, and Folder trees
 */
export const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({
  preview,
  onClose,
  bucket,
  region,
  getCredentials,
  embedded = false,
  initialContent,
  convertDocxFn,
  fullScreenBasePath = '/file-preview',
}) => {
  const { t } = useTranslation('chat');
  // Content state
  const [textContent, setTextContent] = useState<string | null>(null);
  const [binaryContent, setBinaryContent] = useState<ArrayBuffer | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [_fileSize, setFileSize] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks when a DOCX was converted to PDF for preview (renders as PdfPreview)
  const [convertedFormat, setConvertedFormat] = useState<string | null>(null);
  // True while the server-side DOCX→PDF conversion is in progress
  const [convertingDocx, setConvertingDocx] = useState(false);

  // Folder state
  const [folderContents, setFolderContents] = useState<string[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);

  // Fetch text content from S3
  const fetchTextContent = useCallback(
    async (s3Key: string): Promise<string> => {
      const credentials = await getCredentials();
      if (!credentials) throw new Error('Failed to get credentials');

      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const s3Client = new S3Client({ region, credentials });
      const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
      return (await response.Body?.transformToString()) || '';
    },
    [bucket, region, getCredentials]
  );

  // Fetch binary content from S3
  const fetchBinaryContent = useCallback(
    async (s3Key: string): Promise<ArrayBuffer> => {
      const credentials = await getCredentials();
      if (!credentials) throw new Error('Failed to get credentials');

      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const s3Client = new S3Client({ region, credentials });
      const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
      return (await response.Body?.transformToByteArray())?.buffer || new ArrayBuffer(0);
    },
    [bucket, region, getCredentials]
  );

  // Check file size
  const checkFileSize = useCallback(
    async (s3Key: string): Promise<number> => {
      const credentials = await getCredentials();
      if (!credentials) throw new Error('Failed to get credentials');

      const { S3Client, HeadObjectCommand } = await import('@aws-sdk/client-s3');
      const s3Client = new S3Client({ region, credentials });
      const response = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: s3Key }));
      return response.ContentLength || 0;
    },
    [bucket, region, getCredentials]
  );

  // Fetch image as data URL
  const fetchImageAsDataUrl = useCallback(
    async (s3Key: string, extension: string): Promise<string> => {
      const mimeTypes: Record<string, string> = {
        png: 'image/png',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        webp: 'image/webp',
      };
      const binary = await fetchBinaryContent(s3Key);
      const blob = new Blob([binary], { type: mimeTypes[extension] || 'image/jpeg' });
      return URL.createObjectURL(blob);
    },
    [fetchBinaryContent]
  );

  // Load file content when preview changes
  useEffect(() => {
    if (!preview) return;

    // Reset state
    setTextContent(null);
    setBinaryContent(null);
    setImageUrl(null);
    setFileSize(null);
    setError(null);
    setConvertedFormat(null);
    setConvertingDocx(false);
    setFolderContents([]);
    setFolderError(null);

    // If initial content is provided, use it directly (e.g. inline documents)
    if (initialContent != null) {
      setTextContent(initialContent);
      return;
    }

    if (preview.type === 'folder') {
      // Load folder contents
      const loadFolderContents = async () => {
        setFolderLoading(true);
        try {
          const credentials = await getCredentials();
          // Normalize path to ensure single trailing slash (avoid double slashes like uploads//)
          const normalizedPath = preview.fullPath.replace(/\/+$/, '') + '/';
          const keys = await listObjectsInFolder(normalizedPath, bucket, region, () => Promise.resolve(credentials));
          // Convert to relative paths
          const relativeKeys = keys.map((k) => k.replace(normalizedPath, ''));
          setFolderContents(relativeKeys);
        } catch (err) {
          console.error('Error loading folder:', err);
          setFolderError('Failed to load folder contents');
        } finally {
          setFolderLoading(false);
        }
      };
      loadFolderContents();
    } else {
      // Load file content
      const loadFileContent = async () => {
        setLoading(true);
        try {
          const ext = preview.extension.toLowerCase();
          const s3Key = preview.fullPath;

          // Check file size first
          const size = await checkFileSize(s3Key);
          setFileSize(size);

          const sizeLimit = FILE_SIZE_LIMITS[ext] || DEFAULT_SIZE_LIMIT;
          if (size > sizeLimit) {
            setError(t('filePreview.fileTooLarge', { size: formatBytes(size) }));
            setLoading(false);
            return;
          }

          // Load based on file type
          if (['md', 'markdown', 'csv', 'html', 'json', 'txt', 'vtt', ...CODE_EXTENSIONS].includes(ext)) {
            const content = await fetchTextContent(s3Key);
            setTextContent(content);
          } else if (ext === 'docx') {
            // DOCX: try server-side conversion to PDF for faithful rendering,
            // fall back to client-side docx-preview library if conversion fails
            try {
              setConvertingDocx(true);
              const result = await (convertDocxFn || convertDocxPreview)(bucket, s3Key);
              const pdfResponse = await fetch(result.url);
              if (!pdfResponse.ok) throw new Error('Failed to fetch converted PDF');
              const pdfBuffer = await pdfResponse.arrayBuffer();
              setBinaryContent(pdfBuffer);
              setConvertedFormat('pdf');
            } catch (conversionErr) {
              console.warn('DOCX server-side conversion failed, falling back to client-side:', conversionErr);
              const binary = await fetchBinaryContent(s3Key);
              setBinaryContent(binary);
            } finally {
              setConvertingDocx(false);
            }
          } else if (['pdf', 'xlsx', 'xls', 'pptx', 'ppt'].includes(ext)) {
            const binary = await fetchBinaryContent(s3Key);
            setBinaryContent(binary);
          } else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
            const url = await fetchImageAsDataUrl(s3Key, ext);
            setImageUrl(url);
          }
        } catch (err) {
          console.error('Error loading file:', err);
          setError('Failed to load file. Please try downloading instead.');
        } finally {
          setLoading(false);
        }
      };
      loadFileContent();
    }

    // Cleanup image URL on unmount
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [
    preview,
    bucket,
    region,
    getCredentials,
    fetchTextContent,
    fetchBinaryContent,
    checkFileSize,
    fetchImageAsDataUrl,
    initialContent,
  ]);

  // Download handlers
  const handleDownloadFile = useCallback(async () => {
    if (!preview || preview.type !== 'file') return;
    try {
      if (initialContent != null) {
        // Inline document — download from in-memory content
        const blob = new Blob([initialContent], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = preview.filename;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        await downloadFileFromS3(preview.fullPath, bucket, region, getCredentials, preview.filename);
      }
    } catch (err) {
      console.error('Error downloading file:', err);
    }
  }, [preview, bucket, region, getCredentials, initialContent]);

  const handleDownloadFolder = useCallback(async () => {
    if (!preview || preview.type !== 'folder') return;
    try {
      await downloadFolderAsZip(preview.fullPath, bucket, region, getCredentials, preview.name);
    } catch (err) {
      console.error('Error downloading folder:', err);
    }
  }, [preview, bucket, region, getCredentials]);

  const openFullScreenPreview = useCallback(() => {
    if (!preview || preview.type !== 'file') return;

    if (initialContent != null && !preview.fullPath) {
      // Inline document: pass content via localStorage (sessionStorage is per-tab)
      const contentKey = `inline-doc-${Date.now()}`;
      localStorage.setItem(contentKey, initialContent);
      const params = new URLSearchParams({
        contentKey,
        name: preview.filename,
        ext: preview.extension,
      });
      window.open(`${fullScreenBasePath}?${params.toString()}`, '_blank');
      return;
    }

    const params = new URLSearchParams({
      key: preview.fullPath,
      name: preview.filename,
      ext: preview.extension,
      bucket,
    });
    window.open(`${fullScreenBasePath}?${params.toString()}`, '_blank');
  }, [preview, initialContent, fullScreenBasePath, bucket]);

  if (!preview) {
    return (
      <div className="file-preview-panel-container">
        <div className="file-preview-panel-header">
          <div className="file-preview-panel-title">{t('filePreview.noFileSelected')}</div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('filePreview.actions.close')}
          </Button>
        </div>
        <div className="file-preview-panel-body text-center text-muted py-5">
          <i className="bi bi-file-earmark" style={{ fontSize: '3rem' }}></i>
          <p className="mt-3">{t('filePreview.selectFile')}</p>
        </div>
      </div>
    );
  }

  const isFile = preview.type === 'file';
  const title = isFile ? preview.filename : `${preview.name}/`;
  const iconClass = isFile ? getFileIconClass(preview.filename) : 'bi bi-folder-fill';
  const iconColor = isFile ? 'var(--color-primary)' : 'var(--bs-warning)';
  const shouldShowRelativePath = preview.relativePath !== title && preview.relativePath !== preview.fullPath;

  // Render file content based on type
  const renderContent = () => {
    if (loading || folderLoading) {
      return (
        <div className="text-center py-5">
          <Spinner animation="border" />
          <p className="mt-3 text-muted">{t('filePreview.loadingPreview')}</p>
          {convertingDocx && <p className="text-muted small">{t('filePreview.docx.converting')}</p>}
        </div>
      );
    }

    if (error) {
      return (
        <div className="text-center py-5">
          <i className="bi bi-exclamation-triangle text-warning" style={{ fontSize: '3rem' }}></i>
          <p className="mt-3">{error}</p>
          <Button
            onClick={isFile ? handleDownloadFile : handleDownloadFolder}
            style={{
              backgroundColor: 'var(--color-primary)',
              borderColor: 'var(--color-primary)',
            }}
          >
            <i className="bi bi-download me-2"></i>
            {t('filePreview.actions.downloadToView')}
          </Button>
        </div>
      );
    }

    if (folderError) {
      return (
        <div className="p-3">
          <div className="alert alert-warning">{folderError}</div>
        </div>
      );
    }

    // Folder preview
    if (preview.type === 'folder') {
      return (
        <FolderTreePreview
          s3Keys={folderContents}
          loading={folderLoading}
          error={folderError}
          bucket={bucket}
          region={region}
          basePath={preview.fullPath}
          getCredentials={getCredentials}
        />
      );
    }

    // File previews
    const ext = preview.extension.toLowerCase();

    if (['md', 'markdown'].includes(ext) && textContent) {
      return <MarkdownPreview content={textContent} />;
    }

    if (ext === 'csv' && textContent) {
      return (
        <div className="p-3 h-100">
          <CsvPreview csvContent={textContent} />
        </div>
      );
    }

    if (ext === 'html' && textContent) {
      return <HtmlPreview htmlContent={textContent} filename={preview.filename} />;
    }

    if (ext === 'json' && textContent) {
      return (
        <div className="p-3 h-100">
          <JsonPreview jsonContent={textContent} filename={preview.filename} />
        </div>
      );
    }

    if (ext === 'pdf' && binaryContent) {
      return (
        <div className="p-3 h-100">
          <PdfPreview data={binaryContent} filename={preview.filename} />
        </div>
      );
    }

    if (['xlsx', 'xls'].includes(ext) && binaryContent) {
      return (
        <div className="p-3 h-100">
          <XlsxPreview data={binaryContent} filename={preview.filename} />
        </div>
      );
    }

    if (ext === 'docx' && binaryContent) {
      // If server-side conversion succeeded, render as PDF for faithful font rendering
      if (convertedFormat === 'pdf') {
        return (
          <div className="p-3 h-100">
            <PdfPreview data={binaryContent} filename={preview.filename} />
          </div>
        );
      }
      // Fallback: client-side rendering with docx-preview library
      return (
        <div className="p-3 h-100">
          <DocxPreview data={binaryContent} filename={preview.filename} />
        </div>
      );
    }

    if (['pptx', 'ppt'].includes(ext) && binaryContent) {
      return (
        <div className="p-3 h-100">
          <PptxPreview data={binaryContent} filename={preview.filename} />
        </div>
      );
    }

    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext) && imageUrl) {
      return <ImagePreview src={imageUrl} filename={preview.filename} />;
    }

    if (ext === 'vtt' && textContent) {
      return (
        <div className="p-3 h-100">
          <VttPreview content={textContent} />
        </div>
      );
    }

    // Code files with syntax highlighting
    if (CODE_EXTENSIONS.includes(ext) && textContent) {
      return (
        <div className="h-100">
          <CodePreview content={textContent} language={getLanguageFromExtension(ext)} filename={preview.filename} />
        </div>
      );
    }

    // Plain text fallback
    if (textContent) {
      return (
        <div className="p-3 h-100">
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {textContent}
          </pre>
        </div>
      );
    }

    // No preview available
    return (
      <div className="text-center py-5 text-muted">
        <i className="bi bi-file-earmark" style={{ fontSize: '3rem' }}></i>
        <p className="mt-3">{t('filePreview.previewNotAvailable')}</p>
        <Button
          onClick={handleDownloadFile}
          style={{
            backgroundColor: 'var(--color-primary)',
            borderColor: 'var(--color-primary)',
          }}
        >
          <i className="bi bi-download me-2"></i>
          {t('filePreview.actions.downloadFile')}
        </Button>
      </div>
    );
  };

  return (
    <div className={`file-preview-panel-container${embedded ? ' embedded' : ''}`}>
      {/* Header - hidden when embedded in modal */}
      {!embedded && (
        <div className="file-preview-panel-header">
          <div className="file-preview-panel-title">
            <i className={iconClass} style={{ color: iconColor, marginRight: '0.5rem' }}></i>
            <span className="fw-semibold">{title}</span>
            {shouldShowRelativePath && <span className="text-muted ms-2 small">{preview.relativePath}</span>}
          </div>
          <button type="button" className="file-preview-close-btn" onClick={onClose}>
            <i className="bi bi-x-lg" />
          </button>
        </div>
      )}

      {/* Body */}
      <div className="file-preview-panel-body">{renderContent()}</div>

      {/* Actions */}
      {!loading && !error && (
        <FilePreviewActions
          preview={preview}
          content={textContent || undefined}
          onDownloadFile={handleDownloadFile}
          onDownloadFolder={handleDownloadFolder}
          onOpenInNewTab={
            preview.type === 'file' && preview.extension.toLowerCase() === 'html' ? openFullScreenPreview : undefined
          }
          onOpenFullScreen={preview.type === 'file' ? openFullScreenPreview : undefined}
        />
      )}
    </div>
  );
};
