import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface PdfPreviewProps {
  data: ArrayBuffer;
  filename?: string;
}

// Thumbnail render width (strip is 120px with 8px padding = ~104px usable)
const THUMB_WIDTH = 104;

type ReactPdfModule = typeof import('react-pdf');

/**
 * PDF Preview with thumbnail strip + page navigation (like PPTX preview).
 * Uses react-pdf (pdfjs-dist) with canvas rendering for each page.
 */
export const PdfPreview: React.FC<PdfPreviewProps> = ({ data }) => {
  const { t } = useTranslation('chat');
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfModule, setPdfModule] = useState<ReactPdfModule | null>(null);
  const thumbnailStripRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [mainPageWidth, setMainPageWidth] = useState(800);

  // Convert to a Blob URL so react-pdf receives a string instead of an ArrayBuffer.
  // react-pdf uses dequal to deep-compare the file prop between renders. When its
  // web worker processes a PDF it transfers (detaches) the underlying ArrayBuffer,
  // so dequal's `new Uint8Array(detachedBuffer)` comparison throws on re-render.
  // A Blob URL is a plain string — trivially comparable and immune to this issue.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    const blob = new Blob([data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [data]);

  // Dynamically import react-pdf to avoid SSR issues
  useEffect(() => {
    let cancelled = false;
    import('react-pdf').then((mod) => {
      if (cancelled) return;
      mod.pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${mod.pdfjs.version}/build/pdf.worker.min.mjs`;
      setPdfModule(mod);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Measure viewport and set main page width to fit
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const measure = () => {
      const padding = 32;
      const availW = el.clientWidth - padding;
      if (availW > 0) {
        setMainPageWidth(Math.min(960, availW));
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [numPages]);

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setCurrentPage(1);
    setLoading(false);
  }, []);

  const onLoadError = useCallback(
    (err: Error) => {
      console.error('Error loading PDF:', err);
      setError(t('filePreview.pdf.parseError'));
      setLoading(false);
    },
    [t]
  );

  // Navigate pages
  const goToPage = useCallback(
    (page: number) => {
      if (page >= 1 && page <= numPages) {
        setCurrentPage(page);
      }
    },
    [numPages]
  );

  const goPrev = useCallback(() => goToPage(currentPage - 1), [currentPage, goToPage]);
  const goNext = useCallback(() => goToPage(currentPage + 1), [currentPage, goToPage]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goPrev, goNext]);

  // Scroll active thumbnail into view
  useEffect(() => {
    const strip = thumbnailStripRef.current;
    if (!strip) return;
    const activeThumb = strip.children[currentPage - 1] as HTMLElement | undefined;
    activeThumb?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [currentPage]);

  if (!pdfModule || !pdfUrl) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" size="sm" />
        <span className="ms-2">{t('filePreview.loadingPreview')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3">
        <div className="alert alert-info mb-0">{error}</div>
      </div>
    );
  }

  const { Document, Page } = pdfModule;

  return (
    <Document
      file={pdfUrl}
      onLoadSuccess={onLoadSuccess}
      onLoadError={onLoadError}
      loading={
        <div className="text-center py-5">
          <Spinner animation="border" size="sm" />
          <span className="ms-2">{t('filePreview.loadingPreview')}</span>
        </div>
      }
    >
      {loading ? null : (
        <div className="pdf-preview-container">
          {/* Thumbnail strip */}
          <div className="pdf-thumbnail-strip" ref={thumbnailStripRef}>
            {Array.from({ length: numPages }, (_, i) => (
              <button
                key={i}
                type="button"
                className={`pdf-thumbnail${i + 1 === currentPage ? ' active' : ''}`}
                onClick={() => goToPage(i + 1)}
                title={`Page ${i + 1}`}
              >
                <div className="pdf-thumbnail-content">
                  <Page pageNumber={i + 1} width={THUMB_WIDTH} renderTextLayer={false} renderAnnotationLayer={false} />
                </div>
                <span className="pdf-thumbnail-number">{i + 1}</span>
              </button>
            ))}
          </div>

          {/* Main page area */}
          <div className="pdf-page-main">
            <div className="pdf-page-viewport" ref={viewportRef}>
              <Page
                key={currentPage}
                pageNumber={currentPage}
                width={mainPageWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
            </div>

            {/* Navigation bar */}
            <div className="pdf-page-nav">
              <Button variant="outline-secondary" size="sm" onClick={goPrev} disabled={currentPage === 1}>
                <i className="bi bi-chevron-left" />
              </Button>
              <span className="pdf-page-nav-label">
                {t('filePreview.pdf.pageOf', { current: currentPage, total: numPages })}
              </span>
              <Button variant="outline-secondary" size="sm" onClick={goNext} disabled={currentPage === numPages}>
                <i className="bi bi-chevron-right" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </Document>
  );
};
