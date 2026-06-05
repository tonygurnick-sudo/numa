import React, { useCallback, useState, useRef, useEffect } from 'react';
import Form from 'react-bootstrap/Form';
import { useTranslation } from 'react-i18next';

// ─── Types ──────────────────────────────────────────────────────────────────

interface QuickFilterDropdownProps {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * A compact toolbar dropdown with multi-select checkboxes.
 * Shows "All Status" when nothing is selected, or "All Status (2)" when items are checked.
 */
export function QuickFilterDropdown({
  label,
  options,
  selected,
  onChange,
}: QuickFilterDropdownProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const displayLabel = selected.length === 0 ? label : `${label} (${String(selected.length)})`;

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const handleToggle = useCallback(
    (value: string) => {
      const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
      onChange(next);
    },
    [selected, onChange]
  );

  return (
    <div ref={wrapperRef} className="position-relative d-inline-block">
      <button
        type="button"
        className={`ops-filter-btn${selected.length > 0 ? ' ops-filter-btn--active' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {displayLabel}
        <i className="bi bi-chevron-down" />
      </button>

      {isOpen && (
        <div
          className="position-absolute ops-filter-menu"
          style={{ top: '100%', left: 0, zIndex: 1050, minWidth: 210, maxHeight: 300, overflowY: 'auto', marginTop: 6 }}
        >
          {options.map((opt) => (
            <div key={opt.value} className="ops-filter-option">
              <Form.Check
                type="checkbox"
                id={`quick-filter-${opt.value}`}
                label={opt.label}
                checked={selected.includes(opt.value)}
                onChange={() => handleToggle(opt.value)}
                className="m-0"
              />
            </div>
          ))}
          {options.length === 0 && <div className="px-3 py-2 text-muted small">{t('common.noResults')}</div>}
        </div>
      )}
    </div>
  );
}
