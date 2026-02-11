import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import './DocumentViewer.scss';

interface DocumentViewerProps {
  url: string;
  allowDownload?: boolean;
}

/**
 * Document viewer for shared documents.
 * - PDF: Uses react-pdf for native rendering (white background, no browser toolbar)
 * - HTML: Direct display in iframe
 * - Other: Browser native iframe handling
 */
export const DocumentViewer = ({ url, allowDownload = true }: DocumentViewerProps) => {
  const { t } = useTranslation('shared');
  const [hasError, setHasError] = useState(false);
  const fileType = getFileType(url);

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

  if (fileType === 'pdf') {
    return (
      <div className="document-viewer">
        <PdfDocumentViewer url={url} onError={() => setHasError(true)} />
      </div>
    );
  }

  return (
    <div className="document-viewer">
      <iframe
        src={url}
        title="Shared Document"
        className={`document-frame ${fileType}-frame`}
        onError={() => setHasError(true)}
      />
    </div>
  );
};

/**
 * PDF viewer using react-pdf for white background rendering.
 * Dynamically imports react-pdf following the established PdfPreview pattern.
 */
const PdfDocumentViewer = ({ url, onError }: { url: string; onError: () => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [containerWidth, setContainerWidth] = useState(800);

  // Dynamic import of react-pdf (same pattern as FilePreview/PdfPreview)
  const [pdfComponents, setPdfComponents] = useState<{
    Document: React.ComponentType<{
      file: string;
      onLoadSuccess: (pdf: { numPages: number }) => void;
      onLoadError: (err: Error) => void;
      loading: React.ReactNode;
      children: React.ReactNode;
    }>;
    Page: React.ComponentType<{
      pageNumber: number;
      width: number;
      renderTextLayer: boolean;
      renderAnnotationLayer: boolean;
    }>;
  } | null>(null);

  useEffect(() => {
    import('react-pdf').then((module) => {
      module.pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${module.pdfjs.version}/build/pdf.worker.min.mjs`;
      setPdfComponents({
        Document: module.Document as unknown as typeof pdfComponents.Document,
        Page: module.Page as unknown as typeof pdfComponents.Page,
      });
    });
  }, []);

  // Measure container width for responsive page sizing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!pdfComponents) {
    return (
      <div className="pdf-loading">
        <div className="spinner-border text-primary spinner-border-sm" role="status" aria-hidden="true" />
      </div>
    );
  }

  const { Document, Page } = pdfComponents;

  return (
    <div className="pdf-container" ref={containerRef}>
      <Document
        file={url}
        onLoadSuccess={({ numPages: n }: { numPages: number }) => setNumPages(n)}
        onLoadError={() => onError()}
        loading={
          <div className="pdf-loading">
            <div className="spinner-border text-primary spinner-border-sm" role="status" aria-hidden="true" />
          </div>
        }
      >
        {Array.from({ length: numPages }, (_, i) => (
          <div key={`page_${i + 1}`} className="pdf-page">
            <Page pageNumber={i + 1} width={containerWidth} renderTextLayer={false} renderAnnotationLayer={false} />
          </div>
        ))}
      </Document>
    </div>
  );
};

/**
 * Determine file type from URL path.
 */
function getFileType(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith('.pdf')) return 'pdf';
    if (path.endsWith('.html') || path.endsWith('.htm')) return 'html';
    if (path.endsWith('.docx') || path.endsWith('.doc')) return 'docx';
    if (path.endsWith('.xlsx') || path.endsWith('.xls')) return 'xlsx';
    if (path.endsWith('.pptx') || path.endsWith('.ppt')) return 'pptx';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
