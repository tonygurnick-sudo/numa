import React from 'react';
import Form from 'react-bootstrap/Form';
import Badge from 'react-bootstrap/Badge';
import { useTranslation } from 'react-i18next';
import type { FieldDefinition, FieldOverride, StaffProfile } from '../../../types/ops';

interface DynamicFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly?: boolean;
  compact?: boolean;
  fieldOverride?: FieldOverride;
  staff?: StaffProfile[];
}

/**
 * Formats a number as a currency string with $ prefix and comma separators.
 */
function formatCurrency(value: unknown): string {
  const num = Number(value);
  if (isNaN(num)) return String(value ?? '');
  return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Formats a date string as a locale date.
 */
function formatDate(value: unknown): string {
  if (!value) return '';
  const date = new Date(String(value));
  if (isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

/**
 * Renders any field type based on a FieldDefinition.
 * Supports both read-only display and editable form controls.
 * Respects field overrides for visibility and required status.
 */
export function DynamicField({
  field,
  value,
  onChange,
  readOnly = false,
  compact = false,
  fieldOverride,
  staff,
}: DynamicFieldProps): React.JSX.Element | null {
  const { t } = useTranslation('ops');

  // If the field override says not visible, render nothing
  if (fieldOverride?.visible === false) {
    return null;
  }

  const isRequired = fieldOverride?.required === true;
  const compactStyle: React.CSSProperties = compact ? { fontSize: '0.85rem', padding: '0.2rem 0.4rem' } : {};

  const label = (
    <Form.Label className="mb-1" style={compact ? { fontSize: '0.85rem' } : {}}>
      {field.name}
      {isRequired && <span className="text-danger ms-1">*</span>}
    </Form.Label>
  );

  // ─── Read-only mode ───────────────────────────────────────────────────────
  if (readOnly) {
    const displayValue = renderReadOnlyValue(field, value, staff, t);
    return (
      <Form.Group className="mb-2">
        {label}
        <div style={compact ? { fontSize: '0.85rem' } : {}}>{displayValue}</div>
      </Form.Group>
    );
  }

  // ─── Edit mode ────────────────────────────────────────────────────────────
  return (
    <Form.Group className="mb-2">
      {label}
      {renderEditControl(field, value, onChange, isRequired, compactStyle, staff, t)}
    </Form.Group>
  );
}

/**
 * Renders the read-only display for a field value based on its type.
 */
function renderReadOnlyValue(
  field: FieldDefinition,
  value: unknown,
  staff: StaffProfile[] | undefined,
  t: (key: string) => string,
): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted">{t('common.none')}</span>;
  }

  switch (field.fieldType) {
    case 'date':
      return <span>{formatDate(value)}</span>;

    case 'user': {
      const staffMember = staff?.find((s) => s.id === String(value));
      return <span>{staffMember?.name ?? t('fields.unassigned')}</span>;
    }

    case 'currency':
      return <span>{formatCurrency(value)}</span>;

    case 'url':
      return (
        <a href={String(value)} target="_blank" rel="noopener noreferrer">
          {String(value)}
        </a>
      );

    case 'email':
      return <a href={`mailto:${String(value)}`}>{String(value)}</a>;

    case 'boolean':
      return <span>{value ? t('common.yes') : t('common.no')}</span>;

    case 'multi_select': {
      const items = Array.isArray(value) ? value : [value];
      return (
        <span className="d-flex flex-wrap gap-1">
          {items.map((item) => (
            <Badge key={String(item)} bg="secondary">
              {String(item)}
            </Badge>
          ))}
        </span>
      );
    }

    default:
      return <span>{String(value)}</span>;
  }
}

/**
 * Renders the appropriate react-bootstrap form control for editing a field.
 */
function renderEditControl(
  field: FieldDefinition,
  value: unknown,
  onChange: (value: unknown) => void,
  isRequired: boolean,
  style: React.CSSProperties,
  staff: StaffProfile[] | undefined,
  t: (key: string) => string,
): React.ReactNode {
  switch (field.fieldType) {
    case 'text':
    case 'phone':
      return (
        <Form.Control
          type={field.fieldType === 'phone' ? 'tel' : 'text'}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          required={isRequired}
          style={style}
        />
      );

    case 'url':
      return (
        <Form.Control
          type="url"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          required={isRequired}
          style={style}
        />
      );

    case 'email':
      return (
        <Form.Control
          type="email"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          required={isRequired}
          style={style}
        />
      );

    case 'textarea':
    case 'richtext':
      return (
        <Form.Control
          as="textarea"
          rows={3}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          required={isRequired}
          style={style}
        />
      );

    case 'number':
      return (
        <Form.Control
          type="number"
          value={value !== null && value !== undefined ? String(value) : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          required={isRequired}
          style={style}
        />
      );

    case 'currency':
      return (
        <Form.Control
          type="number"
          value={value !== null && value !== undefined ? String(value) : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          required={isRequired}
          step="0.01"
          min="0"
          style={style}
        />
      );

    case 'date':
      return (
        <Form.Control
          type="date"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value || null)}
          required={isRequired}
          style={style}
        />
      );

    case 'select':
      return (
        <Form.Select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value || null)}
          required={isRequired}
          style={style}
        >
          <option value="">{t('common.selectOption')}</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </Form.Select>
      );

    case 'multi_select': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div>
          {field.options?.map((opt) => (
            <Form.Check
              key={opt}
              type="checkbox"
              label={opt}
              checked={selected.includes(opt)}
              onChange={(e) => {
                if (e.target.checked) {
                  onChange([...selected, opt]);
                } else {
                  onChange(selected.filter((v) => v !== opt));
                }
              }}
              style={style}
            />
          ))}
        </div>
      );
    }

    case 'user':
      return (
        <Form.Select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value || null)}
          required={isRequired}
          style={style}
        >
          <option value="">{t('fields.selectUser')}</option>
          {staff
            ?.filter((s) => s.isActive)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </Form.Select>
      );

    case 'boolean':
      return (
        <Form.Check type="switch" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} style={style} />
      );

    default:
      return (
        <Form.Control
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          required={isRequired}
          style={style}
        />
      );
  }
}
