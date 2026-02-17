import React, { useState, useCallback } from 'react';
import Dropdown from 'react-bootstrap/Dropdown';
import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import { useTranslation } from 'react-i18next';

// ─── Types ──────────────────────────────────────────────────────────────────

type FilterValue = { operator: string; value: unknown };

interface FilterDropdownProps {
  column: string;
  columnType: 'text' | 'enum' | 'date' | 'number';
  options?: { value: string; label: string }[];
  currentFilter?: FilterValue;
  onApply: (filter: FilterValue) => void;
  onClear: () => void;
  children: React.ReactNode;
}

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

  const handleApply = useCallback(() => {
    if (value.trim()) {
      onApply({ operator, value: value.trim() });
    }
  }, [operator, value, onApply]);

  return (
    <div className="p-2" style={{ minWidth: 240 }}>
      <Form.Select size="sm" className="mb-2" value={operator} onChange={(e) => setOperator(e.target.value)}>
        <option value="contains">{t('filters.contains')}</option>
        <option value="notContains">{t('filters.notContains')}</option>
        <option value="equals">{t('filters.equals')}</option>
        <option value="notEquals">{t('filters.notEquals')}</option>
      </Form.Select>
      <Form.Control
        size="sm"
        className="mb-2"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleApply();
        }}
      />
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
}: {
  options: { value: string; label: string }[];
  currentFilter?: FilterValue;
  onApply: (f: FilterValue) => void;
}) {
  const currentSelected = Array.isArray(currentFilter?.value) ? (currentFilter.value as string[]) : [];

  const handleToggle = useCallback(
    (optionValue: string) => {
      const next = currentSelected.includes(optionValue)
        ? currentSelected.filter((v) => v !== optionValue)
        : [...currentSelected, optionValue];
      onApply({ operator: 'in', value: next });
    },
    [currentSelected, onApply],
  );

  return (
    <div className="p-2" style={{ minWidth: 200, maxHeight: 280, overflowY: 'auto' }}>
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
    typeof currentFilter?.value === 'string' ? currentFilter.value : '',
  );
  const [dateEnd, setDateEnd] = useState<string>('');

  const handlePreset = useCallback(
    (preset: string) => {
      onApply({ operator: preset, value: preset });
    },
    [onApply],
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

// ─── Main Component ─────────────────────────────────────────────────────────

export function FilterDropdown({
  columnType,
  options = [],
  currentFilter,
  onApply,
  onClear,
  children,
}: FilterDropdownProps): React.JSX.Element {
  const { t } = useTranslation('ops');

  return (
    <Dropdown>
      <Dropdown.Toggle as="span" bsPrefix="filter-toggle" style={{ cursor: 'pointer' }}>
        {children}
      </Dropdown.Toggle>

      <Dropdown.Menu className="shadow-sm border" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        {columnType === 'text' && <TextFilter currentFilter={currentFilter} onApply={onApply} t={t} />}
        {columnType === 'enum' && <EnumFilter options={options} currentFilter={currentFilter} onApply={onApply} />}
        {columnType === 'date' && <DateFilter currentFilter={currentFilter} onApply={onApply} t={t} />}
        {columnType === 'number' && <NumberFilter currentFilter={currentFilter} onApply={onApply} t={t} />}
        <Dropdown.Divider />
        <div className="px-2 pb-1">
          <Button size="sm" variant="outline-danger" className="w-100" onClick={onClear}>
            {t('filters.clearAll')}
          </Button>
        </div>
      </Dropdown.Menu>
    </Dropdown>
  );
}
