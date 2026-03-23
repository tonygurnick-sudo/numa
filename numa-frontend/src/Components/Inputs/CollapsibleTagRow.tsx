import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface CollapsibleTagRowProps {
  tags: string[];
  /** Render function for each tag badge. Receives the tag string and returns a ReactNode. */
  renderTag: (tag: string) => React.ReactNode;
  /** Class name applied to the outer container */
  className?: string;
  /** Gap between items (CSS gap value). Default "0.25rem" */
  gap?: string;
  /** Optional element rendered inline before the tags (e.g. a label). Stays on the first row. */
  prefix?: React.ReactNode;
}

/**
 * Renders tags in a single line by default with a "+N more" toggle
 * that expands to show all tags. Measures which tags fit on the first row.
 */
export function CollapsibleTagRow({
  tags,
  renderTag,
  className = '',
  gap = '0.25rem',
  prefix,
}: CollapsibleTagRowProps): React.JSX.Element | null {
  const { t } = useTranslation('common');
  const containerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState<number | null>(null);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container || expanded) return;

    const children = Array.from(container.children) as HTMLElement[];
    // Find all tag elements (skip prefix and toggle)
    const tagElements = children.filter((el) => el.dataset.tag === 'true');
    if (tagElements.length === 0) {
      setVisibleCount(0);
      return;
    }

    // The first row top is determined by the first tag element
    const firstTop = tagElements[0].offsetTop;
    let count = 0;
    for (const el of tagElements) {
      if (el.offsetTop <= firstTop + 2) {
        // 2px tolerance for sub-pixel differences
        count++;
      } else {
        break;
      }
    }

    // Ensure at least 1 tag is shown if there are any
    setVisibleCount(Math.max(1, count));
  }, [expanded]);

  // Re-measure when tags change
  useEffect(() => {
    setExpanded(false);
    setVisibleCount(null);
  }, [tags]);

  // Measure after render — run twice to handle layout settling
  useEffect(() => {
    if (visibleCount === null && !expanded) {
      const id1 = requestAnimationFrame(() => {
        measure();
        // Second measurement in case layout shifted after first
        requestAnimationFrame(measure);
      });
      return () => cancelAnimationFrame(id1);
    }
  }, [visibleCount, expanded, measure]);

  if (tags.length === 0) return null;

  const measured = visibleCount !== null;
  const showAll = expanded || !measured;
  const displayTags = showAll ? tags : tags.slice(0, visibleCount);
  const hiddenCount = measured ? tags.length - (visibleCount ?? 0) : 0;
  const showToggle = measured && hiddenCount > 0;

  return (
    <div ref={containerRef} className={`d-flex flex-wrap align-items-center ${className}`} style={{ gap }}>
      {prefix && (
        <span data-prefix="true" style={{ flexShrink: 0 }}>
          {prefix}
        </span>
      )}
      {displayTags.map((tag) => (
        <span key={tag} data-tag="true">
          {renderTag(tag)}
        </span>
      ))}
      {showToggle && !expanded && (
        <Badge
          data-toggle="true"
          bg=""
          role="button"
          className="text-muted border-0"
          style={{
            cursor: 'pointer',
            fontSize: '0.7rem',
            padding: '0.25em 0.4em',
            backgroundColor: 'transparent',
          }}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
        >
          +{hiddenCount} {t('collapsibleTagRow.more', { defaultValue: 'more' })}
        </Badge>
      )}
      {expanded && hiddenCount > 0 && (
        <Badge
          data-toggle="true"
          bg=""
          role="button"
          className="text-muted border-0"
          style={{
            cursor: 'pointer',
            fontSize: '0.7rem',
            padding: '0.25em 0.4em',
            backgroundColor: 'transparent',
          }}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(false);
          }}
        >
          {t('collapsibleTagRow.less', { defaultValue: 'show less' })}
        </Badge>
      )}
    </div>
  );
}
