import React, { useState, useEffect, useMemo } from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface PdfPreviewProps {
  data: ArrayBuffer;
  filename?: string;
}

/**
 * PDF Preview Component using react-pdf
 * Dynamically imports react-pdf to avoid SSR issues
 */
export const PdfPreview: React.FC<PdfPreviewProps> = ({ data, filename: _filename }) => {
  const { t } = useTranslation('chat');
  const [numPages, setNumPages] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // Create a stable copy of the ArrayBuffer as a Blob URL
  // react-pdf transfers ArrayBuffers to a web worker which "detaches" them,
  // making them unusable on re-renders. Using a Blob URL avoids this issue.
  const fileUrl = useMemo(() => {
    const blob = new Blob([data], { type: 'application/pdf' });
    return URL.createObjectURL(blob);
  }, [data]);

  // Clean up the Blob URL when component unmounts or data changes
  useEffect(() => {
    return () => {
      URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  // Dynamically import react-pdf to avoid SSR issues
  const [pdfComponents, setPdfComponents] = useState<{
    Document: React.ComponentType<{
      file: string | { data: ArrayBuffer };
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
      // Set up the worker
      module.pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${module.pdfjs.version}/build/pdf.worker.min.mjs`;
      setPdfComponents({
        Document: module.Document as unknown as typeof pdfComponents.Document,
        Page: module.Page as unknown as typeof pdfComponents.Page,
      });
    });
  }, []);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const onDocumentLoadError = (err: Error) => {
    console.error('Error loading PDF:', err);
    setError('Failed to load PDF. The file may be corrupted or password-protected.');
  };

  if (!pdfComponents) {
    return (
      <div className="text-center py-4">
        <Spinner animation="border" size="sm" />
        <span className="ms-2">{t('page.loading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3">
        <div className="alert alert-warning mb-0">{error}</div>
      </div>
    );
  }

  const { Document, Page } = pdfComponents;

  return (
    <div className="workspace-pdf-preview" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Document
        file={fileUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        onLoadError={onDocumentLoadError}
        loading={
          <div className="text-center py-4">
            <Spinner animation="border" size="sm" />
            <span className="ms-2">{t('page.loading')}</span>
          </div>
        }
      >
        <div className="pdf-pages-container" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {Array.from(new Array(numPages), (_, index) => (
            <div key={`page_${index + 1}`} className="pdf-page-wrapper mb-3">
              <Page
                pageNumber={index + 1}
                width={Math.min(800, window.innerWidth - 100)}
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
            </div>
          ))}
        </div>
      </Document>
      {numPages > 0 && (
        <div className="text-muted small text-center py-2 border-top" style={{ flexShrink: 0 }}>
          {t('filePreview.pdf.pages', { count: numPages })}
        </div>
      )}
    </div>
  );
};
