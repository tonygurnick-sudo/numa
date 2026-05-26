import React from 'react';
import { Badge, Form } from 'react-bootstrap';

interface TaxonomyMultiSelectProps {
  id: string;
  label?: string;
  helperText?: string;
  options: readonly string[];
  selected: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
}

/**
 * TaxonomyMultiSelect
 * Pill-style multi-select bound to a fixed taxonomy. Each option is a togglable
 * badge — click to add, click to remove. Closed list, no free-form input.
 */
export function TaxonomyMultiSelect({
  id,
  label,
  helperText,
  options,
  selected,
  onChange,
  disabled = false,
}: TaxonomyMultiSelectProps): React.JSX.Element {
  const selectedSet = new Set(selected);

  function toggle(value: string): void {
    if (disabled) return;
    if (selectedSet.has(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  return (
    <Form.Group className="mb-3" controlId={id}>
      {label && <Form.Label>{label}</Form.Label>}
      <div className="d-flex flex-wrap gap-1">
        {options.map((option) => {
          const active = selectedSet.has(option);
          return (
            <Badge
              key={option}
              bg=""
              role="button"
              className={
                active ? 'd-inline-flex align-items-center' : 'd-inline-flex align-items-center text-bg-light border'
              }
              style={{
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: '0.8rem',
                padding: '0.3em 0.6em',
                lineHeight: 1,
                opacity: disabled ? 0.6 : 1,
                ...(active
                  ? {
                      backgroundColor: 'var(--brand-primary-light, #e8f0fe)',
                      color: 'var(--brand-primary, var(--bs-primary))',
                    }
                  : {}),
              }}
              onClick={() => toggle(option)}
              aria-pressed={active}
            >
              {active && <i className="bi bi-check2 me-1" style={{ fontSize: '0.85rem' }} />}
              {option}
            </Badge>
          );
        })}
      </div>
      {helperText && <Form.Text className="text-muted small d-block mt-1">{helperText}</Form.Text>}
    </Form.Group>
  );
}
