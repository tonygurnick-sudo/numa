import React from 'react';
import Form from 'react-bootstrap/Form';
import Badge from 'react-bootstrap/Badge';
import { useTranslation } from 'react-i18next';
import type {
  FieldDefinition,
  FieldOverride,
  StaffProfile,
  Customer,
  Supplier,
  WorkUnit,
  Project,
} from '../../../types/ops';
import { SidebarDropdown, type DropdownOption } from './SidebarDropdown';

interface DynamicFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly?: boolean;
  compact?: boolean;
  fieldOverride?: FieldOverride;
  staff?: StaffProfile[];
  customers?: Customer[];
  suppliers?: Supplier[];
  workUnits?: WorkUnit[];
  projects?: Project[];
  /** Suppress the built-in label — useful when the caller renders its own. */
  hideLabel?: boolean;
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
  customers,
  suppliers,
  workUnits,
  projects,
  hideLabel = false,
}: DynamicFieldProps): React.JSX.Element | null {
  const { t } = useTranslation('ops');

  const [localValue, setLocalValue] = React.useState(value);

  React.useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleBlur = () => {
    if (localValue !== value) {
      onChange(localValue);
    }
  };

  if (fieldOverride?.visible === false) {
    return null;
  }

  const isRequired = fieldOverride?.required === true;
  const compactStyle: React.CSSProperties = compact ? { fontSize: '0.85rem', padding: '0.2rem 0.4rem' } : {};

  const label = hideLabel ? null : (
    <Form.Label className="mb-1" style={compact ? { fontSize: '0.85rem' } : {}}>
      {field.name}
      {isRequired && <span className="text-danger ms-1">*</span>}
    </Form.Label>
  );

  if (readOnly) {
    const displayValue = renderReadOnlyValue(field, value, staff, t);
    return (
      <Form.Group className="mb-2">
        {label}
        <div style={compact ? { fontSize: '0.85rem' } : {}}>{displayValue}</div>
      </Form.Group>
    );
  }

  return (
    <Form.Group className="mb-2">
      {label}
      {renderEditControl(
        field,
        value,
        localValue,
        onChange,
        setLocalValue,
        handleBlur,
        isRequired,
        compactStyle,
        staff,
        customers,
        suppliers,
        workUnits,
        projects,
        t
      )}
    </Form.Group>
  );
}

function renderReadOnlyValue(
  field: FieldDefinition,
  value: unknown,
  staff: StaffProfile[] | undefined,
  t: (key: string) => string
): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted">{t('common.none')}</span>;
  }

  switch (field.fieldType) {
    case 'date':
      return <span>{formatDate(value)}</span>;

    case 'user': {
      const staffMember = staff?.find((s) => s.id === String(value));
      return <span>{staffMember ? staffMember.name || staffMember.email : t('fields.unassigned')}</span>;
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

function renderEditControl(
  field: FieldDefinition,
  value: unknown,
  localValue: unknown,
  onChange: (value: unknown) => void,
  setLocalValue: (value: unknown) => void,
  onBlur: () => void,
  isRequired: boolean,
  style: React.CSSProperties,
  staff: StaffProfile[] | undefined,
  customers: Customer[] | undefined,
  suppliers: Supplier[] | undefined,
  workUnits: WorkUnit[] | undefined,
  projects: Project[] | undefined,
  t: (key: string) => string
): React.ReactNode {
  switch (field.fieldType) {
    case 'text':
    case 'phone':
      return (
        <Form.Control
          type={field.fieldType === 'phone' ? 'tel' : 'text'}
          value={String(localValue ?? '')}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={onBlur}
          required={isRequired}
          placeholder={t('common.none')}
          style={style}
        />
      );

    case 'url':
      return (
        <Form.Control
          type="url"
          value={String(localValue ?? '')}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={onBlur}
          required={isRequired}
          style={style}
        />
      );

    case 'email':
      return (
        <Form.Control
          type="email"
          value={String(localValue ?? '')}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={onBlur}
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
          value={String(localValue ?? '')}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={onBlur}
          required={isRequired}
          style={style}
        />
      );

    case 'number':
      return (
        <Form.Control
          type="number"
          value={localValue !== null && localValue !== undefined ? String(localValue) : ''}
          onChange={(e) => setLocalValue(e.target.value === '' ? null : Number(e.target.value))}
          onBlur={onBlur}
          required={isRequired}
          placeholder={t('common.none')}
          style={style}
        />
      );

    case 'currency':
      return (
        <Form.Control
          type="number"
          value={localValue !== null && localValue !== undefined ? String(localValue) : ''}
          onChange={(e) => setLocalValue(e.target.value === '' ? null : Number(e.target.value))}
          onBlur={onBlur}
          required={isRequired}
          placeholder={t('common.none')}
          step="0.01"
          min="0"
          style={style}
        />
      );

    case 'date':
      return (
        <Form.Control
          type="date"
          value={String(localValue ?? '')}
          onChange={(e) => setLocalValue(e.target.value || null)}
          onBlur={onBlur}
          required={isRequired}
          style={style}
        />
      );

    case 'percentage':
      return (
        <Form.Control
          type="number"
          value={localValue !== null && localValue !== undefined ? String(localValue) : ''}
          onChange={(e) =>
            setLocalValue(e.target.value === '' ? null : Math.min(100, Math.max(0, Number(e.target.value))))
          }
          onBlur={onBlur}
          required={isRequired}
          placeholder={t('common.none')}
          min="0"
          max="100"
          style={style}
        />
      );

    // Instant/Selection fields below: use onChange directly
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
                {s.name || s.email}
              </option>
            ))}
        </Form.Select>
      );

    case 'boolean':
      return (
        <Form.Check type="switch" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} style={style} />
      );

    case 'customer': {
      const customerOptions: DropdownOption[] = [
        { value: '', label: t('tickets.selectCustomer') },
        ...(customers?.map((c) => ({ value: c.id, label: c.companyName })) ?? []),
      ];
      return (
        <div style={style}>
          <SidebarDropdown
            value={String(value ?? '')}
            onChange={(v) => onChange(v || null)}
            options={customerOptions}
            placeholder={t('tickets.selectCustomer')}
          />
        </div>
      );
    }

    case 'supplier': {
      const supplierOptions: DropdownOption[] = [
        { value: '', label: t('tickets.selectSupplier') },
        ...(suppliers?.map((s) => ({ value: s.id, label: s.companyName })) ?? []),
      ];
      return (
        <div style={style}>
          <SidebarDropdown
            value={String(value ?? '')}
            onChange={(v) => onChange(v || null)}
            options={supplierOptions}
            placeholder={t('tickets.selectSupplier')}
          />
        </div>
      );
    }

    case 'workunit':
      return (
        <Form.Select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value || null)}
          required={isRequired}
          style={style}
        >
          <option value="">{t('tickets.selectWorkUnit')}</option>
          {workUnits?.map((wu) => (
            <option key={wu.id} value={wu.id}>
              {wu.name}
            </option>
          ))}
        </Form.Select>
      );

    case 'project':
      return (
        <Form.Select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value || null)}
          required={isRequired}
          style={style}
        >
          <option value="">{t('tickets.selectProject')}</option>
          {projects
            ?.filter((p) => p.isActive)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Form.Select>
      );

    default:
      return (
        <Form.Control
          type="text"
          value={String(localValue ?? '')}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={onBlur}
          required={isRequired}
          style={style}
        />
      );
  }
}
