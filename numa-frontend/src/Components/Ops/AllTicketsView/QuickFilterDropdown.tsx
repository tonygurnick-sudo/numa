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
    [selected, onChange],
  );

  return (
    <div ref={wrapperRef} className="position-relative d-inline-block">
      <button
        type="button"
        className="btn btn-sm d-inline-flex align-items-center gap-1"
        style={{
          backgroundColor: selected.length > 0 ? '#eef2ff' : '#f8f9fa',
          border: `1px solid ${selected.length > 0 ? '#818cf8' : '#dee2e6'}`,
          color: selected.length > 0 ? '#4f46e5' : '#495057',
          borderRadius: 8,
        }}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {displayLabel}
        <i className="bi bi-chevron-down" style={{ fontSize: '0.55rem' }} />
      </button>

      {isOpen && (
        <div
          className="position-absolute bg-white border rounded shadow-sm"
          style={{ top: '100%', left: 0, zIndex: 1050, minWidth: 200, maxHeight: 300, overflowY: 'auto', marginTop: 4 }}
        >
          {options.map((opt) => (
            <div key={opt.value} className="px-3 py-1">
              <Form.Check
                type="checkbox"
                id={`quick-filter-${opt.value}`}
                label={opt.label}
                checked={selected.includes(opt.value)}
                onChange={() => handleToggle(opt.value)}
              />
            </div>
          ))}
          {options.length === 0 && <div className="px-3 py-2 text-muted small">{t('common.noResults')}</div>}
        </div>
      )}
    </div>
  );
}
