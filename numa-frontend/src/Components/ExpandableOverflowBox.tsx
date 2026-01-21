import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type ExpandableOverflowBoxProps = {
  children: ReactNode;
  className?: string;
  maxHeight?: number;
  style?: CSSProperties;
  expandLabel?: string;
  collapseLabel?: string;
};

export default function ExpandableOverflowBox({
  children,
  className,
  maxHeight = 240,
  style,
  expandLabel,
  collapseLabel,
}: ExpandableOverflowBoxProps) {
  const { t } = useTranslation('common');
  const expandText = expandLabel ?? t('expandable.showAll');
  const collapseText = collapseLabel ?? t('expandable.showLess');
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [canExpand, setCanExpand] = useState<boolean>(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = el.scrollHeight > maxHeight + 1;
    setCanExpand((prev) => (prev === next ? prev : next));
  }, [maxHeight]);

  const boxStyle = useMemo((): CSSProperties => {
    if (expanded) {
      return { ...style, overflowY: 'visible', maxHeight: undefined };
    }
    return { maxHeight, overflowY: 'auto', ...style };
  }, [expanded, maxHeight, style]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    const scheduledMeasure = () => {
      raf = 0;
      measure();
    };
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(scheduledMeasure);
    };

    schedule();

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    resizeObserver?.observe(el);
    const mutationObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null;
    mutationObserver?.observe(el, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', schedule);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [measure]);

  useEffect(() => {
    measure();
  }, [expanded, maxHeight, measure, children]);

  return (
    <div className="expandable-overflow-box">
      <div ref={ref} className={['expandable-overflow-box__box', className].filter(Boolean).join(' ')} style={boxStyle}>
        {children}
      </div>
      {canExpand ? (
        <div className="d-flex justify-content-end mt-1">
          <button
            type="button"
            className="btn btn-sm btn-link text-decoration-none px-0"
            aria-expanded={expanded}
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? (
              <>
                <i className="bi bi-chevron-up me-1"></i>
                {collapseText}
              </>
            ) : (
              <>
                <i className="bi bi-chevron-down me-1"></i>
                {expandText}
              </>
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}
