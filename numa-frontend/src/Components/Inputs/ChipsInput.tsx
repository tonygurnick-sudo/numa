import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { CollapsibleTagRow } from './CollapsibleTagRow';

interface ChipsInputProps {
  id: string;
  label: string;
  placeholder?: string;
  helperText?: string;
  chips: string[];
  onChange: (chips: string[]) => void;
  disabled?: boolean;
  addButtonLabel?: string;
  /** Optional list of suggested values. Popular/matching suggestions are shown below the input. */
  suggestions?: string[];
  /** Label shown above the suggestions list (e.g. "Suggested tags") */
  suggestionsLabel?: string;
}

/**
 * ChipsInput
 * Lightweight "add item" input with pill display, remove controls, and optional typeahead suggestions.
 */
export function ChipsInput({
  id,
  label,
  placeholder,
  helperText,
  chips,
  onChange,
  disabled = false,
  addButtonLabel,
  suggestions = [],
  suggestionsLabel,
}: ChipsInputProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const resolvedAddLabel = addButtonLabel ?? t('chipsInput.add');
  const [inputValue, setInputValue] = useState('');

  // Keep a case-insensitive set for de-duping
  const lowerSet = useMemo(() => new Set(chips.map((c) => c.toLowerCase())), [chips]);

  // Filter suggestions: exclude already-added chips, then filter by typeahead input
  const filteredSuggestions = useMemo(() => {
    const available = suggestions.filter((s) => !lowerSet.has(s.toLowerCase()));
    const query = inputValue.trim().toLowerCase();
    if (!query) return available;
    return available.filter((s) => s.toLowerCase().includes(query));
  }, [suggestions, lowerSet, inputValue]);

  function addChip(value?: string): void {
    const val = (value ?? inputValue).trim();
    if (!val) return;
    const lower = val.toLowerCase();
    if (lowerSet.has(lower)) {
      setInputValue('');
      return;
    }
    onChange([...chips, val]);
    setInputValue('');
  }

  function removeChip(idx: number): void {
    const next = chips.filter((_, i) => i !== idx);
    onChange(next);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      addChip();
    }
  }

  // Clear input when disabled toggles on
  useEffect(() => {
    if (disabled) {
      setInputValue('');
    }
  }, [disabled]);

  return (
    <Form.Group className="mb-3" controlId={id}>
      <Form.Label>{label}</Form.Label>
      <div className="d-flex gap-2">
        <Form.Control
          type="text"
          value={inputValue}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
        />
        <Button variant="outline-primary" onClick={() => addChip()} disabled={disabled}>
          <i className="bi bi-plus-lg me-1" />
          {resolvedAddLabel}
        </Button>
      </div>
      {helperText && <Form.Text className="text-muted">{helperText}</Form.Text>}

      {/* Suggestions / typeahead */}
      {filteredSuggestions.length > 0 && !disabled && (
        <div className="mt-2">
          {suggestionsLabel && <Form.Text className="text-muted small d-block mb-1">{suggestionsLabel}</Form.Text>}
          <CollapsibleTagRow
            tags={filteredSuggestions}
            gap="0.25rem"
            renderTag={(suggestion) => (
              <Badge
                bg=""
                role="button"
                className="text-bg-light border"
                style={{ cursor: 'pointer', fontSize: '0.8rem', padding: '0.3em 0.6em' }}
                onClick={() => addChip(suggestion)}
              >
                <i className="bi bi-plus me-1" style={{ fontSize: '0.7rem' }} />
                {suggestion}
              </Badge>
            )}
          />
        </div>
      )}

      {chips.length > 0 && (
        <div className="mt-2">
          <Form.Text className="text-muted small d-block mb-1">
            {t('chipsInput.selected', { defaultValue: 'Selected' })}
          </Form.Text>
          <div className="d-flex flex-wrap gap-1">
            {chips.map((chip, idx) => (
              <Badge
                key={`${chip}-${idx}`}
                bg=""
                className="d-inline-flex align-items-center"
                style={{
                  backgroundColor: 'var(--brand-primary-light, #e8f0fe)',
                  color: 'var(--brand-primary, var(--bs-primary))',
                  fontSize: '0.8rem',
                  padding: '0.3em 0.6em',
                  lineHeight: 1,
                }}
              >
                {chip}
                {!disabled && (
                  <i
                    className="bi bi-x ms-1"
                    role="button"
                    style={{ cursor: 'pointer', opacity: 0.7, fontSize: '0.85rem' }}
                    onClick={() => removeChip(idx)}
                    aria-label={t('chipsInput.remove', { value: chip })}
                  />
                )}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Form.Group>
  );
}
