import React, { useState, useCallback, useRef, useEffect } from 'react';
import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import { useTranslation } from 'react-i18next';

// ─── Types ──────────────────────────────────────────────────────────────────

export type FilterValue = { operator: string; value: unknown };

type SortDirection = 'asc' | 'desc';

interface FilterDropdownProps {
  column: string;
  columnLabel: string;
  columnType: 'text' | 'enum' | 'date' | 'number';
  options?: { value: string; label: string }[];
  currentFilter?: FilterValue;
  onApply: (filter: FilterValue) => void;
  onClear: () => void;
  sortable: boolean;
  currentSortColumn: string;
  currentSortDirection: SortDirection;
  onSort: (column: string, direction: SortDirection) => void;
}

// ─── Sentinel for "empty / null" enum filtering ─────────────────────────────
export const EMPTY_SENTINEL = '__EMPTY__';

// ─── Text Filter ────────────────────────────────────────────────────────────

function TextFilter({
  currentFilter,
  onApply,
  t,
}: {
  currentFilter?: FilterValue;
  onApply: (f: FilterValue) => void;
  t: (key: string) => string;
}) {
  const [operator, setOperator] = useState<string>((currentFilter?.operator as string) || 'contains');
  const [value, setValue] = useState<string>((currentFilter?.value as string) || '');

  const needsValue = operator !== 'empty' && operator !== 'notEmpty';

  const handleApply = useCallback(() => {
    if (!needsValue || value.trim()) {
      onApply({ operator, value: needsValue ? value.trim() : '' });
    }
  }, [operator, value, onApply, needsValue]);

  return (
    <div className="p-2" style={{ minWidth: 240 }}>
      <Form.Select size="sm" className="mb-2" value={operator} onChange={(e) => setOperator(e.target.value)}>
        <option value="contains">{t('filters.contains')}</option>
        <option value="notContains">{t('filters.notContains')}</option>
        <option value="equals">{t('filters.equals')}</option>
        <option value="notEquals">{t('filters.notEquals')}</option>
        <option value="startsWith">{t('filters.startsWith')}</option>
        <option value="endsWith">{t('filters.endsWith')}</option>
        <option value="empty">{t('filters.isEmpty')}</option>
        <option value="notEmpty">{t('filters.isNotEmpty')}</option>
      </Form.Select>
      {needsValue && (
        <Form.Control
          size="sm"
          className="mb-2"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleApply();
          }}
        />
      )}
      <Button size="sm" variant="primary" className="w-100" onClick={handleApply}>
        {t('filters.apply')}
      </Button>
    </div>
  );
}

// ─── Enum Filter ────────────────────────────────────────────────────────────

function EnumFilter({
  options,
  currentFilter,
  onApply,
  t,
}: {
  options: { value: string; label: string }[];
  currentFilter?: FilterValue;
  onApply: (f: FilterValue) => void;
  t: (key: string) => string;
}) {
  const currentSelected = Array.isArray(currentFilter?.value) ? (currentFilter.value as string[]) : [];

  const handleToggle = useCallback(
    (optionValue: string) => {
      const next = currentSelected.includes(optionValue)
        ? currentSelected.filter((v) => v !== optionValue)
        : [...currentSelected, optionValue];
      onApply({ operator: 'in', value: next });
    },
    [currentSelected, onApply]
  );

  return (
    <div className="p-2" style={{ minWidth: 200, maxHeight: 280, overflowY: 'auto' }}>
      {/* (EMPTY) option */}
      <Form.Check
        type="checkbox"
        id={`filter-enum-${EMPTY_SENTINEL}`}
        label={<span className="fst-italic text-muted">{t('filters.empty')}</span>}
        checked={currentSelected.includes(EMPTY_SENTINEL)}
        onChange={() => handleToggle(EMPTY_SENTINEL)}
        className="mb-1"
      />
      {options.map((opt) => (
        <Form.Check
          key={opt.value}
          type="checkbox"
          id={`filter-enum-${opt.value}`}
          label={opt.label}
          checked={currentSelected.includes(opt.value)}
          onChange={() => handleToggle(opt.value)}
          className="mb-1"
        />
      ))}
    </div>
  );
}

// ─── Date Filter ────────────────────────────────────────────────────────────

function DateFilter({
  currentFilter,
  onApply,
  t,
}: {
  currentFilter?: FilterValue;
  onApply: (f: FilterValue) => void;
  t: (key: string) => string;
}) {
  const [operator, setOperator] = useState<string>((currentFilter?.operator as string) || 'after');
  const [dateValue, setDateValue] = useState<string>(
    typeof currentFilter?.value === 'string' ? currentFilter.value : ''
  );
  const [dateEnd, setDateEnd] = useState<string>('');

  const handlePreset = useCallback(
    (preset: string) => {
      onApply({ operator: preset, value: preset });
    },
    [onApply]
  );

  const handleApply = useCallback(() => {
    if (operator === 'between') {
      onApply({ operator, value: { start: dateValue, end: dateEnd } });
    } else if (dateValue) {
      onApply({ operator, value: dateValue });
    }
  }, [operator, dateValue, dateEnd, onApply]);

  return (
    <div className="p-2" style={{ minWidth: 240 }}>
      <div className="d-flex flex-wrap gap-1 mb-2">
        <Button size="sm" variant="outline-secondary" onClick={() => handlePreset('today')}>
          {t('filters.today')}
        </Button>
        <Button size="sm" variant="outline-secondary" onClick={() => handlePreset('thisWeek')}>
          {t('filters.thisWeek')}
        </Button>
        <Button size="sm" variant="outline-secondary" onClick={() => handlePreset('thisMonth')}>
          {t('filters.thisMonth')}
        </Button>
        <Button size="sm" variant="outline-secondary" onClick={() => handlePreset('thisQuarter')}>
          {t('filters.thisQuarter')}
        </Button>
      </div>
      <hr className="my-2" />
      <Form.Select size="sm" className="mb-2" value={operator} onChange={(e) => setOperator(e.target.value)}>
        <option value="before">{t('filters.before')}</option>
        <option value="after">{t('filters.after')}</option>
        <option value="between">{t('filters.between')}</option>
      </Form.Select>
      <Form.Control
        type="date"
        size="sm"
        className="mb-2"
        value={dateValue}
        onChange={(e) => setDateValue(e.target.value)}
      />
      {operator === 'between' && (
        <Form.Control
          type="date"
          size="sm"
          className="mb-2"
          value={dateEnd}
          onChange={(e) => setDateEnd(e.target.value)}
        />
      )}
      <Button size="sm" variant="primary" className="w-100" onClick={handleApply}>
        {t('filters.apply')}
      </Button>
    </div>
  );
}

// ─── Number Filter ──────────────────────────────────────────────────────────

function NumberFilter({
  currentFilter,
  onApply,
  t,
}: {
  currentFilter?: FilterValue;
  onApply: (f: FilterValue) => void;
  t: (key: string) => string;
}) {
  const current = (currentFilter?.value ?? {}) as { min?: string; max?: string };
  const [min, setMin] = useState<string>(current.min ?? '');
  const [max, setMax] = useState<string>(current.max ?? '');

  const handleApply = useCallback(() => {
    onApply({ operator: 'range', value: { min, max } });
  }, [min, max, onApply]);

  return (
    <div className="p-2" style={{ minWidth: 200 }}>
      <Form.Control
        type="number"
        size="sm"
        className="mb-2"
        placeholder="Min"
        value={min}
        onChange={(e) => setMin(e.target.value)}
      />
      <Form.Control
        type="number"
        size="sm"
        className="mb-2"
        placeholder="Max"
        value={max}
        onChange={(e) => setMax(e.target.value)}
      />
      <Button size="sm" variant="primary" className="w-100" onClick={handleApply}>
        {t('filters.apply')}
      </Button>
    </div>
  );
}

// ─── Main Component — Unified Column Header Dropdown ────────────────────────

export function FilterDropdown({
  column,
  columnLabel,
  columnType,
  options = [],
  currentFilter,
  onApply,
  onClear,
  sortable,
  currentSortColumn,
  currentSortDirection,
  onSort,
}: FilterDropdownProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const isSorted = currentSortColumn === column;
  const hasFilter = !!currentFilter;

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

  const handleSort = useCallback(
    (dir: SortDirection) => {
      onSort(column, dir);
      setIsOpen(false);
    },
    [column, onSort]
  );

  const handleClear = useCallback(() => {
    onClear();
  }, [onClear]);

  return (
    <div ref={wrapperRef} className="position-relative d-inline-block">
      {/* ── Column Header Toggle ──────────────────────────────────────── */}
      <div
        className="d-flex align-items-center gap-1 user-select-none"
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
        style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        <span>{columnLabel}</span>
        {isSorted && (
          <i
            className={`bi bi-chevron-${currentSortDirection === 'asc' ? 'up' : 'down'}`}
            style={{ fontSize: '0.7rem' }}
          />
        )}
        {hasFilter && <i className="bi bi-funnel-fill text-primary" style={{ fontSize: '0.65rem' }} />}
        <i className="bi bi-chevron-down text-muted" style={{ fontSize: '0.6rem' }} />
      </div>

      {/* ── Dropdown Menu ─────────────────────────────────────────────── */}
      {isOpen && (
        <div
          className="position-absolute bg-white border rounded shadow-sm"
          style={{ top: '100%', left: 0, zIndex: 1050, minWidth: 220, marginTop: 4 }}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          {/* Sort options */}
          {sortable && (
            <>
              <div
                className={`d-flex align-items-center gap-2 px-3 py-2 ${isSorted && currentSortDirection === 'asc' ? 'bg-light fw-semibold' : ''}`}
                role="button"
                onClick={() => handleSort('asc')}
                style={{ cursor: 'pointer' }}
              >
                <i className="bi bi-sort-alpha-down" />
                <span className="small">{t('filters.sortAZ')}</span>
                {isSorted && currentSortDirection === 'asc' && <i className="bi bi-check ms-auto" />}
              </div>
              <div
                className={`d-flex align-items-center gap-2 px-3 py-2 ${isSorted && currentSortDirection === 'desc' ? 'bg-light fw-semibold' : ''}`}
                role="button"
                onClick={() => handleSort('desc')}
                style={{ cursor: 'pointer' }}
              >
                <i className="bi bi-sort-alpha-up" />
                <span className="small">{t('filters.sortZA')}</span>
                {isSorted && currentSortDirection === 'desc' && <i className="bi bi-check ms-auto" />}
              </div>
              <hr className="my-1" />
            </>
          )}

          {/* Filter content */}
          {columnType === 'text' && <TextFilter currentFilter={currentFilter} onApply={onApply} t={t} />}
          {columnType === 'enum' && (
            <EnumFilter options={options} currentFilter={currentFilter} onApply={onApply} t={t} />
          )}
          {columnType === 'date' && <DateFilter currentFilter={currentFilter} onApply={onApply} t={t} />}
          {columnType === 'number' && <NumberFilter currentFilter={currentFilter} onApply={onApply} t={t} />}

          {/* Clear filter button */}
          {hasFilter && (
            <>
              <hr className="my-1" />
              <div className="px-2 pb-2">
                <Button size="sm" variant="outline-danger" className="w-100" onClick={handleClear}>
                  {t('filters.clearAll')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
