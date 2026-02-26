import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { pptxToHtml } from '@jvmr/pptx-to-html';

// ============================================================
// Types
// ============================================================

interface PptxPreviewProps {
  data: ArrayBuffer;
  filename?: string;
}

// Native render size from the library (default)
const SLIDE_W = 960;
const SLIDE_H = 540;

// ============================================================
// Main Component
// ============================================================

export const PptxPreview: React.FC<PptxPreviewProps> = ({ data }) => {
  const { t } = useTranslation('chat');
  const [slideHtmls, setSlideHtmls] = useState<string[]>([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const thumbnailStripRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Parse PPTX on mount
  useEffect(() => {
    let cancelled = false;

    const parse = async () => {
      setLoading(true);
      setError(null);
      try {
        // Render at native slide dimensions (960x540 default).
        // CSS transform handles responsive scaling to fit the viewport.
        const htmlSlides = await pptxToHtml(data);
        if (cancelled) return;
        if (htmlSlides.length === 0) {
          setError(t('filePreview.pptx.noSlides'));
          setLoading(false);
          return;
        }
        setSlideHtmls(htmlSlides);
        setCurrentSlide(0);
      } catch (err) {
        console.error('Error parsing PPTX:', err);
        if (!cancelled) {
          setError(t('filePreview.pptx.parseError'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    parse();

    return () => {
      cancelled = true;
    };
  }, [data, t]);

  // Measure viewport and compute scale so the slide fits without scrollbars
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const computeScale = () => {
      const padding = 32; // 16px padding on each side
      const availW = el.clientWidth - padding;
      const availH = el.clientHeight - padding;
      if (availW <= 0 || availH <= 0) return;

      const s = Math.min(availW / SLIDE_W, availH / SLIDE_H, 1);
      setScale(s);
    };

    computeScale();

    const observer = new ResizeObserver(computeScale);
    observer.observe(el);
    return () => observer.disconnect();
  }, [slideHtmls.length]);

  // Navigate slides
  const goToSlide = useCallback(
    (index: number) => {
      if (index >= 0 && index < slideHtmls.length) {
        setCurrentSlide(index);
      }
    },
    [slideHtmls.length],
  );

  const goPrev = useCallback(() => goToSlide(currentSlide - 1), [currentSlide, goToSlide]);
  const goNext = useCallback(() => goToSlide(currentSlide + 1), [currentSlide, goToSlide]);

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
    const activeThumb = strip.children[currentSlide] as HTMLElement | undefined;
    activeThumb?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [currentSlide]);

  const activeSlideHtml = useMemo(() => slideHtmls[currentSlide], [slideHtmls, currentSlide]);

  if (loading) {
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

  return (
    <div className="pptx-preview-container">
      {/* Thumbnail strip */}
      <div className="pptx-thumbnail-strip" ref={thumbnailStripRef}>
        {slideHtmls.map((html, idx) => (
          <button
            key={idx}
            type="button"
            className={`pptx-thumbnail${idx === currentSlide ? ' active' : ''}`}
            onClick={() => goToSlide(idx)}
            title={`Slide ${idx + 1}`}
          >
            <div className="pptx-thumbnail-content" dangerouslySetInnerHTML={{ __html: html }} />
            <span className="pptx-thumbnail-number">{idx + 1}</span>
          </button>
        ))}
      </div>

      {/* Main slide area */}
      <div className="pptx-slide-main">
        <div className="pptx-slide-viewport" ref={viewportRef}>
          {activeSlideHtml && (
            <div
              className="pptx-slide-sizer"
              style={{
                width: SLIDE_W * scale,
                height: SLIDE_H * scale,
              }}
            >
              <div
                className="pptx-slide-scaler"
                style={{
                  width: SLIDE_W,
                  height: SLIDE_H,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
                dangerouslySetInnerHTML={{ __html: activeSlideHtml }}
              />
            </div>
          )}
        </div>

        {/* Navigation bar */}
        <div className="pptx-slide-nav">
          <Button variant="outline-secondary" size="sm" onClick={goPrev} disabled={currentSlide === 0}>
            <i className="bi bi-chevron-left" />
          </Button>
          <span className="pptx-slide-nav-label">
            {t('filePreview.pptx.slideOf', { current: currentSlide + 1, total: slideHtmls.length })}
          </span>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={goNext}
            disabled={currentSlide === slideHtmls.length - 1}
          >
            <i className="bi bi-chevron-right" />
          </Button>
        </div>
      </div>
    </div>
  );
};
