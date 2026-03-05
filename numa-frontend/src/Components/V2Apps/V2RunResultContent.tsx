import React, { useState, useEffect, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { Button, Spinner } from 'react-bootstrap';
import * as Papa from 'papaparse';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../Providers/AuthProvider';
import { fetchFileFromS3, getSignedUrlForS3Object, downloadFileWithSignedUrl } from '../../utils/s3Utils';
import { getFileIconClass } from '../../utils/fileUtils';
import {
  WorkspaceChatInlineFileReference,
  type FileReference,
} from '../WorkspaceChat/WorkspaceChatInlineFileReference';
import {
  WorkspaceChatInlineFolderReference,
  type FolderReference,
} from '../WorkspaceChat/WorkspaceChatInlineFolderReference';

// Hoisted outside component to prevent ReactMarkdown re-parsing on every render
const REMARK_PLUGINS = [remarkBreaks, remarkGfm];

// ─── Types ──────────────────────────────────────────────────────────────────

interface V2RunResultContentProps {
  content: string;
  s3OutputsPrefix: string; // e.g. "v2-apps/{appId}/{userId}/{runId}/outputs"
  bucket: string;
  region: string;
  onOpenFilePreview?: (ref: FileReference) => void;
  onOpenFolderPreview?: (ref: FolderReference) => void;
}

interface TextPart {
  type: 'text';
  content: string;
}

interface FileRefPart {
  type: 'file';
  ref: FileReference;
}

interface FolderRefPart {
  type: 'folder';
  ref: FolderReference;
}

type ContentPart = TextPart | FileRefPart | FolderRefPart;

// Extensions that get auto-loaded for inline preview
const INLINE_PREVIEW_EXTENSIONS = new Set([
  'html',
  'csv',
  'md',
  'markdown',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
]);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']);

// ─── Path helpers ───────────────────────────────────────────────────────────

const normalizeRelativePath = (raw: string): string => {
  let p = raw.trim();
  if (p.toLowerCase().startsWith('file:')) p = p.slice(5);
  if (p.toLowerCase().startsWith('folder:')) p = p.slice(7);
  p = p.replace(/^\.\//, '');
  p = p.replace(/^\/+/, '');
  // Strip workdir/outputs/ or outputs/ prefix (agent paths)
  p = p.replace(/^workdir\//, '');
  if (p.startsWith('outputs/')) p = p.slice('outputs/'.length);
  return p;
};

// ─── Content parsing ────────────────────────────────────────────────────────

// Pattern: <file:path>, <folder:path>, file:/path, folder:/path
const FILE_FOLDER_PATTERN = /(?:<file:([^>]+)>|<folder:([^>]+)>|file:\/([^\s\])<>]+)|folder:\/([^\s\])<>]+))/g;

const parseContentParts = (text: string, s3OutputsPrefix: string): ContentPart[] => {
  const parts: ContentPart[] = [];
  let lastIndex = 0;

  FILE_FOLDER_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FILE_FOLDER_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.substring(lastIndex, match.index) });
    }

    const filePathRaw = match[1] || match[3];
    const folderPathRaw = match[2] || match[4];

    if (folderPathRaw) {
      let rel = normalizeRelativePath(folderPathRaw).replace(/\/+$/, '');
      const fullPath = `${s3OutputsPrefix}/${rel}`;
      const name = rel.split('/').pop() || rel;
      parts.push({ type: 'folder', ref: { name, fullPath, relativePath: rel } });
    } else if (filePathRaw) {
      const rel = normalizeRelativePath(filePathRaw);
      const fullPath = `${s3OutputsPrefix}/${rel}`;
      const filename = rel.split('/').pop() || rel;
      const extension = filename.split('.').pop()?.toLowerCase() || '';
      parts.push({ type: 'file', ref: { filename, fullPath, relativePath: rel, extension } });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.substring(lastIndex) });
  }

  return parts;
};

// ─── CSV Preview Table ──────────────────────────────────────────────────────

const CsvPreviewTable: React.FC<{ csvContent: string }> = ({ csvContent }) => {
  const { t } = useTranslation('apps');
  const { headers, rows, totalRows } = useMemo(() => {
    const result = Papa.parse(csvContent, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });
    const h = result.meta.fields || [];
    const total = result.data.length;
    const r = result.data.slice(0, 100).map((row: Record<string, string>) => h.map((header) => row[header] || ''));
    return { headers: h, rows: r, totalRows: total };
  }, [csvContent]);

  if (headers.length === 0) {
    return <div className="text-muted">{t('v2Apps.runs.filePreview.noCsvData')}</div>;
  }

  return (
    <>
      <div className="table-responsive" style={{ maxHeight: '500px', overflowY: 'auto' }}>
        <table className="table table-sm table-bordered table-hover">
          <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
            <tr>
              {headers.map((header, idx) => (
                <th key={idx}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {row.map((cell, cellIdx) => (
                  <td
                    key={cellIdx}
                    style={{
                      whiteSpace: 'pre-wrap',
                      maxWidth: '300px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalRows > 100 && (
        <div className="text-muted small mt-2">
          <i className="bi bi-info-circle me-1"></i>
          {t('v2Apps.runs.filePreview.csvRowLimit', { total: totalRows })}
        </div>
      )}
    </>
  );
};

// ─── Main Component ─────────────────────────────────────────────────────────

export const V2RunResultContent: React.FC<V2RunResultContentProps> = ({
  content,
  s3OutputsPrefix,
  bucket,
  region,
  onOpenFilePreview,
  onOpenFolderPreview,
}) => {
  const { t } = useTranslation('apps');
  const { getCredentials } = useAuth();

  // File content state
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loadingFiles, setLoadingFiles] = useState<Record<string, boolean>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  // Parse content into parts
  const contentParts = useMemo(() => parseContentParts(content, s3OutputsPrefix), [content, s3OutputsPrefix]);

  // Extract unique file references for auto-loading
  const fileReferences = useMemo(() => {
    const refs: FileReference[] = [];
    const seen = new Set<string>();
    for (const part of contentParts) {
      if (part.type === 'file' && !seen.has(part.ref.fullPath)) {
        seen.add(part.ref.fullPath);
        refs.push(part.ref);
      }
    }
    return refs;
  }, [contentParts]);

  // Load a file's content from S3
  const loadFileContent = useCallback(
    async (ref: FileReference) => {
      if (fileContents[ref.fullPath] || loadingFiles[ref.fullPath] || imageUrls[ref.fullPath]) return;

      setLoadingFiles((prev) => ({ ...prev, [ref.fullPath]: true }));
      setFileErrors((prev) => ({ ...prev, [ref.fullPath]: '' }));

      try {
        const blob = await fetchFileFromS3(ref.fullPath, bucket, region, getCredentials);

        if (IMAGE_EXTENSIONS.has(ref.extension)) {
          const url = URL.createObjectURL(blob);
          setImageUrls((prev) => ({ ...prev, [ref.fullPath]: url }));
        } else {
          const text = await blob.text();
          setFileContents((prev) => ({ ...prev, [ref.fullPath]: text }));
        }
      } catch (err) {
        console.error(`Error loading file ${ref.filename}:`, err);
        setFileErrors((prev) => ({
          ...prev,
          [ref.fullPath]: err instanceof Error ? err.message : 'Failed to load',
        }));
      } finally {
        setLoadingFiles((prev) => ({ ...prev, [ref.fullPath]: false }));
      }
    },
    [fileContents, loadingFiles, imageUrls, bucket, region, getCredentials]
  );

  // Auto-load previewable files
  useEffect(() => {
    for (const ref of fileReferences) {
      if (INLINE_PREVIEW_EXTENSIONS.has(ref.extension)) {
        loadFileContent(ref);
      }
    }
  }, [fileReferences]);

  // Clean up image object URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(imageUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // ─── Inline preview handlers ──────────────────────────────────────────────

  const handleDownload = useCallback(
    async (ref: FileReference) => {
      await downloadFileWithSignedUrl(ref.fullPath, bucket, region, getCredentials, ref.filename);
    },
    [bucket, region, getCredentials]
  );

  const handleOpenInNewTab = useCallback(
    async (s3Key: string) => {
      const url = await getSignedUrlForS3Object(s3Key, bucket, region, getCredentials);
      window.open(url, '_blank');
    },
    [bucket, region, getCredentials]
  );

  const handleOpenFile = useCallback(
    (ref: FileReference) => {
      onOpenFilePreview?.(ref);
    },
    [onOpenFilePreview]
  );

  const handleOpenFolder = useCallback(
    (ref: FolderReference) => {
      onOpenFolderPreview?.(ref);
    },
    [onOpenFolderPreview]
  );

  // ─── Render a file reference card with inline preview ─────────────────────

  const renderFilePreviewCard = (ref: FileReference) => {
    const iconClass = getFileIconClass(ref.filename);
    const isLoading = loadingFiles[ref.fullPath];
    const error = fileErrors[ref.fullPath];
    const textContent = fileContents[ref.fullPath];
    const imgUrl = imageUrls[ref.fullPath];
    const isMarkdown = ref.extension === 'md' || ref.extension === 'markdown';
    const isExpanded = expandedFiles[ref.fullPath] ?? false;

    return (
      <div key={ref.fullPath} className="v2-run-result__file-card">
        {/* Header */}
        <div className="v2-run-result__file-header">
          <div className="d-flex align-items-center">
            <i className={`${iconClass} me-3`} style={{ fontSize: '1.5rem', color: 'var(--color-primary)' }} />
            <span className="fw-semibold" style={{ fontSize: '1.05rem' }}>
              {ref.filename}
            </span>
          </div>
          <div className="d-flex gap-2">
            {onOpenFilePreview && (
              <Button
                size="sm"
                variant="outline-secondary"
                onClick={() => handleOpenFile(ref)}
                title={t('v2Apps.runs.filePreview.openInPanel')}
              >
                <i className="bi bi-arrows-angle-expand" />
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => handleDownload(ref)}
              style={{
                backgroundColor: 'var(--color-primary)',
                borderColor: 'var(--color-primary)',
                color: 'white',
              }}
            >
              <i className="bi bi-download me-1" />
              {t('v2Apps.runs.filePreview.download')}
            </Button>
          </div>
        </div>

        {/* Content preview */}
        <div className="v2-run-result__file-content">
          {isLoading && (
            <div className="text-center py-4">
              <Spinner animation="border" size="sm" />
              <span className="ms-2">{t('v2Apps.runs.filePreview.loading')}</span>
            </div>
          )}

          {error && (
            <div className="p-3">
              <div className="alert alert-warning mb-0">{error}</div>
            </div>
          )}

          {/* HTML preview */}
          {!isLoading && !error && textContent && ref.extension === 'html' && (
            <div className="v2-run-result__html-preview">
              <iframe
                srcDoc={textContent}
                title={ref.filename}
                sandbox="allow-same-origin allow-scripts"
                style={{ width: '100%', height: '500px', border: 'none' }}
              />
              <div className="text-center border-top py-2">
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => handleOpenInNewTab(ref.fullPath)}
                  className="text-decoration-none"
                  style={{ color: 'var(--color-primary)', fontWeight: 500 }}
                >
                  <i className="bi bi-arrows-fullscreen me-1" />
                  {t('v2Apps.runs.filePreview.openFullScreen')}
                </Button>
              </div>
            </div>
          )}

          {/* CSV preview */}
          {!isLoading && !error && textContent && ref.extension === 'csv' && (
            <div className="v2-run-result__csv-preview p-3">
              <CsvPreviewTable csvContent={textContent} />
            </div>
          )}

          {/* Markdown preview */}
          {!isLoading && !error && textContent && isMarkdown && (
            <div className="v2-run-result__markdown-preview">
              <div
                className="p-3"
                style={{
                  maxHeight: isExpanded ? 'none' : '300px',
                  overflow: 'hidden',
                  transition: 'max-height 0.3s ease',
                  position: 'relative',
                }}
              >
                <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{textContent}</ReactMarkdown>
                {!isExpanded && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: '60px',
                      background: 'linear-gradient(to bottom, transparent, white)',
                    }}
                  />
                )}
              </div>
              <div className="text-center border-top">
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setExpandedFiles((prev) => ({ ...prev, [ref.fullPath]: !prev[ref.fullPath] }))}
                  className="text-decoration-none py-2"
                  style={{ color: 'var(--color-primary)', fontWeight: 500 }}
                >
                  <i className={`bi ${isExpanded ? 'bi-chevron-up' : 'bi-chevron-down'} me-1`} />
                  {isExpanded ? t('v2Apps.runs.filePreview.showLess') : t('v2Apps.runs.filePreview.showMore')}
                </Button>
              </div>
            </div>
          )}

          {/* Image preview */}
          {!isLoading && !error && imgUrl && IMAGE_EXTENSIONS.has(ref.extension) && (
            <div className="v2-run-result__image-preview p-3 text-center">
              <img
                src={imgUrl}
                alt={ref.filename}
                style={{ maxWidth: '100%', maxHeight: '600px', objectFit: 'contain' }}
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  // ─── TextWithReferences for inline chips in markdown ──────────────────────

  const TextWithReferences = useCallback(
    ({ children }: { children: React.ReactNode }) => {
      if (typeof children !== 'string') return <>{children}</>;

      const hasRef =
        children.includes('<file:') ||
        children.includes('<folder:') ||
        children.includes('file:/') ||
        children.includes('folder:/');
      if (!hasRef) return <>{children}</>;

      const parts = parseContentParts(children, s3OutputsPrefix);

      return (
        <>
          {parts.map((part, idx) => {
            if (part.type === 'text') {
              return <React.Fragment key={idx}>{part.content}</React.Fragment>;
            } else if (part.type === 'file') {
              return <WorkspaceChatInlineFileReference key={idx} fileRef={part.ref} onOpenPreview={handleOpenFile} />;
            } else if (part.type === 'folder') {
              return (
                <WorkspaceChatInlineFolderReference key={idx} folderRef={part.ref} onOpenPreview={handleOpenFolder} />
              );
            }
            return null;
          })}
        </>
      );
    },
    [s3OutputsPrefix, handleOpenFile, handleOpenFolder]
  );

  // Custom ReactMarkdown components to handle inline references in text
  const markdownComponents = useMemo(
    () => ({
      p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement> & { children?: React.ReactNode }) => (
        <p {...props}>
          {React.Children.map(children, (child) =>
            typeof child === 'string' ? <TextWithReferences>{child}</TextWithReferences> : child
          )}
        </p>
      ),
      li: ({ children, ...props }: React.HTMLAttributes<HTMLLIElement> & { children?: React.ReactNode }) => (
        <li {...props}>
          {React.Children.map(children, (child) =>
            typeof child === 'string' ? <TextWithReferences>{child}</TextWithReferences> : child
          )}
        </li>
      ),
      td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement> & { children?: React.ReactNode }) => (
        <td {...props}>
          {React.Children.map(children, (child) =>
            typeof child === 'string' ? <TextWithReferences>{child}</TextWithReferences> : child
          )}
        </td>
      ),
      strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => (
        <strong {...props}>
          {React.Children.map(children, (child) =>
            typeof child === 'string' ? <TextWithReferences>{child}</TextWithReferences> : child
          )}
        </strong>
      ),
    }),
    [TextWithReferences]
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="v2-run-result-content">
      {contentParts.map((part, idx) => {
        if (part.type === 'text') {
          return (
            <div key={idx} className="v2-run-result__markdown-section">
              <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
                {part.content}
              </ReactMarkdown>
            </div>
          );
        } else if (part.type === 'file') {
          return renderFilePreviewCard(part.ref);
        } else if (part.type === 'folder') {
          return (
            <div key={idx} className="v2-run-result__folder-ref">
              <WorkspaceChatInlineFolderReference folderRef={part.ref} onOpenPreview={handleOpenFolder} />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
};
