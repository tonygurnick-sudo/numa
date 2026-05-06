import { useMemo, useState } from 'react';
import { Badge, Form, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

export type SearchableMultiSelectOption = {
  label: string;
  value: string;
  /**
   * Optional small icon URL rendered to the left of the label (and on the
   * selected pill). Used by the trigger configurator to show real Slack
   * workspace emoji icons next to shortcodes.
   */
  imageUrl?: string;
};

type Props = {
  id: string;
  options: SearchableMultiSelectOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  loading?: boolean;
  /** Max height of the scrollable option list, in px. Default 220. */
  maxListHeight?: number;
  /** Disables all interaction. */
  disabled?: boolean;
};

/**
 * Generic searchable multi-select. Search input on top, scrollable checkbox
 * list, selected pills below with click-to-remove. Designed to replace the
 * native `<select multiple>` whenever options come from an async source or
 * the user benefits from search.
 */
export const SearchableMultiSelect = ({
  id,
  options,
  selectedValues,
  onChange,
  placeholder,
  emptyText,
  loading = false,
  maxListHeight = 220,
  disabled = false,
}: Props) => {
  const { t } = useTranslation('common');
  const [query, setQuery] = useState('');

  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (value: string) => {
    if (disabled) return;
    if (selectedSet.has(value)) {
      onChange(selectedValues.filter((v) => v !== value));
    } else {
      onChange([...selectedValues, value]);
    }
  };

  const clearAll = () => {
    if (disabled) return;
    onChange([]);
  };

  // Map values to labels for the selected pills (so we show "codespace" not "C0AG75CUDRR").
  const labelByValue = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) m.set(o.value, o.label);
    return m;
  }, [options]);
  const imageByValue = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) if (o.imageUrl) m.set(o.value, o.imageUrl);
    return m;
  }, [options]);

  const resolvedPlaceholder = placeholder ?? t('searchableMultiSelect.placeholder', { defaultValue: 'Search…' });
  const resolvedEmpty = emptyText ?? t('searchableMultiSelect.empty', { defaultValue: 'No matches.' });

  return (
    <div className="searchable-multi-select">
      <Form.Control
        id={id}
        type="text"
        size="sm"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={resolvedPlaceholder}
        disabled={disabled}
      />

      <div
        className="border rounded mt-2 bg-white"
        style={{ maxHeight: maxListHeight, overflowY: 'auto' }}
        role="listbox"
        aria-multiselectable="true"
        aria-labelledby={id}
      >
        {loading ? (
          <div className="d-flex align-items-center gap-2 small text-muted px-3 py-3">
            <Spinner animation="border" size="sm" />
            {t('searchableMultiSelect.loading', { defaultValue: 'Loading…' })}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-muted small px-3 py-3">{resolvedEmpty}</div>
        ) : (
          filtered.map((opt) => {
            const checked = selectedSet.has(opt.value);
            return (
              <label
                key={opt.value}
                className={`d-flex align-items-center gap-2 px-3 py-2 ${checked ? 'bg-light' : ''}`}
                style={{ cursor: disabled ? 'not-allowed' : 'pointer', userSelect: 'none' }}
              >
                <Form.Check
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt.value)}
                  disabled={disabled}
                  className="m-0"
                  aria-label={opt.label}
                />
                {opt.imageUrl && (
                  <img
                    src={opt.imageUrl}
                    alt=""
                    width={18}
                    height={18}
                    style={{ objectFit: 'contain', flexShrink: 0 }}
                  />
                )}
                <span className="small flex-grow-1">{opt.label}</span>
              </label>
            );
          })
        )}
      </div>

      {selectedValues.length > 0 && (
        <div className="mt-2">
          <div className="d-flex justify-content-between align-items-center mb-1">
            <Form.Text className="text-muted small">
              {t('searchableMultiSelect.selectedCount', {
                count: selectedValues.length,
                defaultValue: '{{count}} selected',
              })}
            </Form.Text>
            {!disabled && (
              <button
                type="button"
                className="btn btn-link btn-sm p-0 small text-muted text-decoration-none"
                onClick={clearAll}
              >
                {t('searchableMultiSelect.clearAll', { defaultValue: 'Clear all' })}
              </button>
            )}
          </div>
          <div className="d-flex flex-wrap gap-1">
            {selectedValues.map((value) => {
              const imageUrl = imageByValue.get(value);
              return (
                <Badge
                  key={value}
                  bg=""
                  className="d-inline-flex align-items-center gap-1"
                  style={{
                    backgroundColor: 'var(--brand-primary-light, #e8f0fe)',
                    color: 'var(--brand-primary, var(--bs-primary))',
                    fontSize: '0.8rem',
                    padding: '0.3em 0.6em',
                    lineHeight: 1,
                  }}
                >
                  {imageUrl && (
                    <img src={imageUrl} alt="" width={14} height={14} style={{ objectFit: 'contain', flexShrink: 0 }} />
                  )}
                  {labelByValue.get(value) ?? value}
                  {!disabled && (
                    <i
                      className="bi bi-x ms-1"
                      role="button"
                      style={{ cursor: 'pointer', opacity: 0.7, fontSize: '0.85rem' }}
                      onClick={() => toggle(value)}
                      aria-label={t('searchableMultiSelect.remove', {
                        label: labelByValue.get(value) ?? value,
                        defaultValue: 'Remove {{label}}',
                      })}
                    />
                  )}
                </Badge>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
