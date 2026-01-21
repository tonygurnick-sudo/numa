import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface ChipsInputProps {
  id: string;
  label: string;
  placeholder?: string;
  helperText?: string;
  chips: string[];
  onChange: (chips: string[]) => void;
  disabled?: boolean;
  addButtonLabel?: string;
}

/**
 * ChipsInput
 * Lightweight "add item" input with pill display and remove controls.
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
}: ChipsInputProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const resolvedAddLabel = addButtonLabel ?? t('chipsInput.add');
  const [inputValue, setInputValue] = useState('');

  // Keep a case-insensitive set for de-duping
  const lowerSet = useMemo(() => new Set(chips.map((c) => c.toLowerCase())), [chips]);

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

      {chips.length > 0 && (
        <div className="d-flex flex-wrap gap-2 mt-2">
          {chips.map((chip, idx) => (
            <Badge key={`${chip}-${idx}`} bg="" className="text-bg-light border px-3 py-2">
              <span className="me-2">{chip}</span>
              <Button
                variant="link"
                size="sm"
                className="p-0 align-baseline text-muted"
                onClick={() => removeChip(idx)}
                disabled={disabled}
                aria-label={t('chipsInput.remove', { value: chip })}
              >
                <i className="bi bi-x" />
              </Button>
            </Badge>
          ))}
        </div>
      )}
    </Form.Group>
  );
}
