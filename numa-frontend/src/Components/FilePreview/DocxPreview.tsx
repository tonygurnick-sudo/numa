import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface DocxPreviewProps {
  data: ArrayBuffer;
  filename?: string;
}

interface DocxPage {
  html: string;
  width: string;
  minHeight: string;
}

/**
 * DOCX Preview with thumbnail strip + page navigation (matches PDF/PPTX pattern).
 * Renders into the visible DOM so the browser computes page breaks,
 * then extracts per-page sections for paged viewing.
 */
export const DocxPreview: React.FC<DocxPreviewProps> = ({ data, filename: _filename }) => {
  const { t } = useTranslation('chat');
  const [pages, setPages] = useState<DocxPage[]>([]);
  const [docStyles, setDocStyles] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const renderContainerRef = useRef<HTMLDivElement>(null);
  const thumbnailStripRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Phase 1: Render into the visible container so the browser computes layout/page breaks
  useEffect(() => {
    let cancelled = false;
    const container = renderContainerRef.current;
    if (!container) return;

    const renderDocx = async () => {
      try {
        const docxPreview = await import('docx-preview');

        await docxPreview.renderAsync(data, container, undefined, {
          className: 'docx-wrapper',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          experimental: false,
          trimXmlDeclaration: true,
          useBase64URL: true,
        });

        if (cancelled) return;

        // Extract the generated <style> from docx-preview (class-agnostic)
        const styleEl = container.querySelector('style');
        const styles = styleEl?.innerHTML || '';

        // Extract each page section (docx-preview creates <section> elements for each page)
        const sections = container.querySelectorAll('section') || [];
        const extractedPages: DocxPage[] = Array.from(sections).map((section) => {
          const el = section as HTMLElement;
          return {
            html: el.innerHTML,
            width: el.style.width || '8.5in',
            minHeight: el.style.minHeight || '11in',
          };
        });

        // Fallback: if no sections found, use whole container content as one page
        if (extractedPages.length === 0 && container.innerHTML) {
          extractedPages.push({
            html: container.innerHTML,
            width: '8.5in',
            minHeight: '11in',
          });
        }

        // Clear the render container — we now have the extracted page data
        container.innerHTML = '';

        setDocStyles(styles);
        setPages(extractedPages);
        setCurrentPage(0);
        setLoading(false);
      } catch (err) {
        console.error('Error rendering DOCX:', err);
        if (!cancelled) {
          setError(
            'This document contains formatting that cannot be previewed in the browser. Please use the Download button to view it in Microsoft Word or another compatible application.',
          );
          setLoading(false);
        }
      }
    };

    renderDocx();
    return () => {
      cancelled = true;
    };
  }, [data]);

  // Measure viewport and compute scale for the main page
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || pages.length === 0) return;

    const measure = () => {
      const padding = 32;
      const availW = el.clientWidth - padding;
      const availH = el.clientHeight - padding;
      // US Letter: 8.5in x 11in = 816px x 1056px at 96dpi
      const pageW = 816;
      const pageH = 1056;
      const scaleW = availW / pageW;
      const scaleH = availH / pageH;
      setScale(Math.min(scaleW, scaleH, 1));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pages]);

  const goToPage = useCallback(
    (page: number) => {
      if (page >= 0 && page < pages.length) {
        setCurrentPage(page);
      }
    },
    [pages.length],
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
    const activeThumb = strip.children[currentPage] as HTMLElement | undefined;
    activeThumb?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [currentPage]);

  if (error) {
    return (
      <div className="p-3">
        <div className="alert alert-info mb-0">{error}</div>
      </div>
    );
  }

  // While loading: show spinner + the render container (must be visible in DOM for layout)
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="text-center py-4">
          <Spinner animation="border" size="sm" />
          <span className="ms-2">{t('filePreview.loadingPreview')}</span>
        </div>
        <div ref={renderContainerRef} style={{ flex: 1, overflow: 'hidden' }} />
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div className="text-center py-5 text-muted">
        <i className="bi bi-file-earmark" style={{ fontSize: '3rem' }}></i>
        <p className="mt-3">{t('filePreview.docx.noPages')}</p>
      </div>
    );
  }

  const thumbScale = 100 / 816;

  return (
    <div className="docx-preview-container">
      {docStyles && <style dangerouslySetInnerHTML={{ __html: docStyles }} />}

      {/* Thumbnail strip */}
      <div className="docx-thumbnail-strip" ref={thumbnailStripRef}>
        {pages.map((page, i) => (
          <button
            key={i}
            type="button"
            className={`docx-thumbnail${i === currentPage ? ' active' : ''}`}
            onClick={() => goToPage(i)}
          >
            <div className="docx-thumbnail-content">
              <div
                className="docx-wrapper"
                style={{
                  width: '816px',
                  transform: `scale(${thumbScale})`,
                  transformOrigin: 'top left',
                  overflow: 'hidden',
                  pointerEvents: 'none',
                }}
              >
                <section
                  className="docx"
                  style={{
                    width: page.width,
                    minHeight: page.minHeight,
                    padding: '1in',
                    background: 'white',
                  }}
                  dangerouslySetInnerHTML={{ __html: page.html }}
                />
              </div>
            </div>
            <span className="docx-thumbnail-number">{i + 1}</span>
          </button>
        ))}
      </div>

      {/* Main page area */}
      <div className="docx-page-main">
        <div className="docx-page-viewport" ref={viewportRef}>
          <div
            className="docx-wrapper"
            style={{
              width: '816px',
              transform: `scale(${scale})`,
              transformOrigin: 'top center',
            }}
          >
            <section
              className="docx"
              style={{
                width: pages[currentPage].width,
                minHeight: pages[currentPage].minHeight,
                padding: '1in',
                background: 'white',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
              }}
              dangerouslySetInnerHTML={{ __html: pages[currentPage].html }}
            />
          </div>
        </div>

        {/* Navigation bar */}
        {pages.length > 1 && (
          <div className="docx-page-nav">
            <Button variant="outline-secondary" size="sm" onClick={goPrev} disabled={currentPage === 0}>
              <i className="bi bi-chevron-left" />
            </Button>
            <span className="docx-page-nav-label">
              {t('filePreview.docx.pageOf', { current: currentPage + 1, total: pages.length })}
            </span>
            <Button variant="outline-secondary" size="sm" onClick={goNext} disabled={currentPage === pages.length - 1}>
              <i className="bi bi-chevron-right" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
