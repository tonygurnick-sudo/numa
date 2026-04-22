import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PdfPreview, XlsxPreview, DocxPreview, CsvPreview, MarkdownPreview, PptxPreview } from '../FilePreview';
import './DocumentViewer.scss';

interface DocumentViewerProps {
  url: string;
  allowDownload?: boolean;
}

/**
 * Document viewer for shared documents.
 * Uses the same preview renderers as FilePreviewPanel for consistent rendering
 * across the app. Works with presigned URLs (no S3 credentials needed).
 */
export const DocumentViewer = ({ url, allowDownload = true }: DocumentViewerProps) => {
  const { t } = useTranslation('shared');
  const [hasError, setHasError] = useState(false);
  const [binaryContent, setBinaryContent] = useState<ArrayBuffer | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fileType = getFileType(url);

  // Fetch content from presigned URL
  useEffect(() => {
    const needsBinary = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'].includes(fileType);
    const needsText = ['csv', 'md', 'markdown', 'txt'].includes(fileType);

    // Images and HTML are handled directly via URL -- no fetch needed
    if (!needsBinary && !needsText) {
      setLoading(false);
      return;
    }

    const fetchContent = async () => {
      setLoading(true);
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);

        if (needsBinary) {
          const buffer = await response.arrayBuffer();
          setBinaryContent(buffer);
        } else {
          const text = await response.text();
          setTextContent(text);
        }
      } catch (err) {
        console.error('Failed to fetch document content:', err);
        setHasError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [url, fileType]);

  if (hasError) {
    return (
      <div className="document-viewer">
        <div className="document-error">
          <i className="bi bi-file-earmark-x" />
          <h3>{t('document.errorTitle')}</h3>
          <p>{t('document.errorMessage')}</p>
          {allowDownload && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-outline-primary btn-sm">
              <i className="bi bi-download me-2" />
              {t('document.tryDownload')}
            </a>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="document-viewer">
        <div className="pdf-loading">
          <div className="spinner-border text-primary spinner-border-sm" role="status" aria-hidden="true" />
        </div>
      </div>
    );
  }

  // PDF
  if (fileType === 'pdf' && binaryContent) {
    return (
      <div className="document-viewer">
        <PdfPreview data={binaryContent} />
      </div>
    );
  }

  // Images
  if (fileType === 'image') {
    return (
      <div className="document-viewer">
        <div className="image-container">
          <img src={url} alt="Shared document" className="image-preview" onError={() => setHasError(true)} />
        </div>
      </div>
    );
  }

  // DOCX
  if ((fileType === 'docx' || fileType === 'doc') && binaryContent) {
    return (
      <div className="document-viewer">
        <DocxPreview data={binaryContent} />
      </div>
    );
  }

  // XLSX/XLS
  if ((fileType === 'xlsx' || fileType === 'xls') && binaryContent) {
    return (
      <div className="document-viewer">
        <XlsxPreview data={binaryContent} />
      </div>
    );
  }

  // PPTX/PPT
  if ((fileType === 'pptx' || fileType === 'ppt') && binaryContent) {
    return (
      <div className="document-viewer">
        <PptxPreview data={binaryContent} />
      </div>
    );
  }

  // CSV
  if (fileType === 'csv' && textContent != null) {
    return (
      <div className="document-viewer">
        <CsvPreview csvContent={textContent} />
      </div>
    );
  }

  // Markdown
  if ((fileType === 'md' || fileType === 'markdown') && textContent != null) {
    return (
      <div className="document-viewer">
        <MarkdownPreview content={textContent} />
      </div>
    );
  }

  // Plain text
  if (fileType === 'txt' && textContent != null) {
    return (
      <div className="document-viewer">
        <div style={{ padding: '1.5rem', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.9rem' }}>
          {textContent}
        </div>
      </div>
    );
  }

  // HTML
  if (fileType === 'html') {
    return (
      <div className="document-viewer">
        <iframe
          src={url}
          title="Shared Document"
          className="document-frame html-frame"
          onError={() => setHasError(true)}
        />
      </div>
    );
  }

  // Unknown type -- show message instead of triggering auto-download via iframe
  return (
    <div className="document-viewer">
      <div className="document-error">
        <i className="bi bi-file-earmark" />
        <h3>{t('document.previewUnavailable', 'Preview not available')}</h3>
        <p>{t('document.previewUnavailableMessage', 'This file type cannot be previewed in the browser.')}</p>
        {allowDownload && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-outline-primary btn-sm">
            <i className="bi bi-download me-2" />
            {t('document.tryDownload')}
          </a>
        )}
      </div>
    </div>
  );
};

/**
 * Determine file type from URL path (strips query params from presigned URLs).
 */
function getFileType(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith('.pdf')) return 'pdf';
    if (path.endsWith('.html') || path.endsWith('.htm')) return 'html';
    if (path.endsWith('.docx')) return 'docx';
    if (path.endsWith('.doc')) return 'doc';
    if (path.endsWith('.xlsx')) return 'xlsx';
    if (path.endsWith('.xls')) return 'xls';
    if (path.endsWith('.pptx')) return 'pptx';
    if (path.endsWith('.ppt')) return 'ppt';
    if (path.endsWith('.csv')) return 'csv';
    if (path.endsWith('.md')) return 'md';
    if (path.endsWith('.markdown')) return 'markdown';
    if (path.endsWith('.txt')) return 'txt';
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(path)) return 'image';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
