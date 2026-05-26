import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ImageLightboxProps {
  src: string | null;
  alt?: string;
  onClose: () => void;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;

const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps): React.JSX.Element | null {
  const { t } = useTranslation('common');

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Reset zoom + pan whenever a new image opens (or on close)
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [src]);

  useEffect(() => {
    if (!src) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') setZoom((z) => clampZoom(z * ZOOM_STEP));
      else if (e.key === '-' || e.key === '_') setZoom((z) => clampZoom(z / ZOOM_STEP));
      else if (e.key === '0') {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    document.addEventListener('keydown', handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [src, onClose]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    setZoom((z) => clampZoom(z * factor));
  }, []);

  const zoomIn = useCallback(() => setZoom((z) => clampZoom(z * ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(z / ZOOM_STEP)), []);
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Drag-to-pan when zoomed in
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (zoom <= 1) return;
      e.preventDefault();
      e.stopPropagation();
      dragStateRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
      setIsDragging(true);
    },
    [zoom, pan]
  );

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state) return;
      setPan({
        x: state.panX + (e.clientX - state.startX),
        y: state.panY + (e.clientY - state.startY),
      });
    };
    const handleUp = () => {
      dragStateRef.current = null;
      setIsDragging(false);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging]);

  if (!src) return null;

  const zoomPercentLabel = `${Math.round(zoom * 100)}%`;
  const imageCursor = zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default';

  const controlButtonStyle: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: 'none',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    color: '#fff',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.95rem',
    lineHeight: 1,
    padding: 0,
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      onClick={onClose}
      onWheel={handleWheel}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4vh 4vw',
        cursor: 'zoom-out',
        overflow: 'hidden',
      }}
    >
      {/* Close button — top-right */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={t('common.close')}
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: 'none',
          backgroundColor: 'rgba(255, 255, 255, 0.15)',
          color: '#fff',
          fontSize: '1.1rem',
          lineHeight: 1,
          padding: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <i className="bi bi-x-lg" style={{ lineHeight: 1, display: 'block' }} />
      </button>

      {/* Zoom controls — bottom-center */}
      <div
        onClick={stop}
        onMouseDown={stop}
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          borderRadius: 999,
          backgroundColor: 'rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(6px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <button
          type="button"
          onClick={zoomOut}
          aria-label={t('imageLightbox.zoomOut')}
          title={t('imageLightbox.zoomOut')}
          disabled={zoom <= MIN_ZOOM}
          style={{ ...controlButtonStyle, opacity: zoom <= MIN_ZOOM ? 0.4 : 1 }}
        >
          <i className="bi bi-dash-lg" style={{ lineHeight: 1, display: 'block' }} />
        </button>
        <button
          type="button"
          onClick={resetView}
          aria-label={t('imageLightbox.resetZoom')}
          title={t('imageLightbox.resetZoom')}
          style={{
            ...controlButtonStyle,
            width: 'auto',
            padding: '0 12px',
            borderRadius: 999,
            fontSize: '0.8rem',
            fontVariantNumeric: 'tabular-nums',
            minWidth: 64,
          }}
        >
          {zoomPercentLabel}
        </button>
        <button
          type="button"
          onClick={zoomIn}
          aria-label={t('imageLightbox.zoomIn')}
          title={t('imageLightbox.zoomIn')}
          disabled={zoom >= MAX_ZOOM}
          style={{ ...controlButtonStyle, opacity: zoom >= MAX_ZOOM ? 0.4 : 1 }}
        >
          <i className="bi bi-plus-lg" style={{ lineHeight: 1, display: 'block' }} />
        </button>
      </div>

      <img
        src={src}
        alt={alt ?? ''}
        draggable={false}
        onClick={stop}
        onMouseDown={handleMouseDown}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
          transition: isDragging ? 'none' : 'transform 0.12s ease-out',
          cursor: imageCursor,
          userSelect: 'none',
        }}
      />
    </div>
  );
}
