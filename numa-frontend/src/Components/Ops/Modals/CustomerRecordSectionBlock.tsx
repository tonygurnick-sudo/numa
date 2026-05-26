/* eslint-disable react-refresh/only-export-components */
import React, { useMemo, useState } from 'react';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Dropdown from 'react-bootstrap/Dropdown';
import Form from 'react-bootstrap/Form';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  CrmConfig,
  Customer,
  CustomerRecordSection,
  FieldDefinition,
  FieldType,
  StaffProfile,
  UpdateCustomerPayload,
} from '../../../types/ops';
import { DynamicField } from '../Shared/DynamicField';
import { getColorForPosition } from '../Shared/colorUtils';
import {
  BUILTIN_CUSTOMER_FIELDS,
  buildSectionUpdatePayload,
  getCustomerFieldValue,
  isBuiltinField,
  resolveBuiltinFieldLabel,
  resolveCustomerRecordLayout,
} from '../Shared/customerRecordFields';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import { useAuth } from '../../../Providers/AuthProvider';
import * as OpsService from '../../../Services/OpsService';

interface CustomerRecordSectionBlockProps {
  section: CustomerRecordSection;
  customer: Customer;
  crmConfig: CrmConfig;
  allFields: FieldDefinition[];
  staff: StaffProfile[];
  saving: boolean;
  onSave: (payload: UpdateCustomerPayload) => void | Promise<void>;
  expanded: boolean;
  onToggleExpanded: () => void;
}

const ADDABLE_FIELD_TYPES: FieldType[] = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'multi_select',
  'currency',
  'url',
  'email',
  'phone',
  'boolean',
];

const generateCrmFieldId = (): string => `crm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const CONTRACT_TERM_OPTIONS = ['Monthly', 'Quarterly', 'Annual', '2 Year', '3 Year', 'Custom'];

function formatCurrency(value: unknown): string {
  const num = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!Number.isFinite(num)) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

function toDateInput(value: unknown): string {
  if (!value) return '';
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

function formatDateDisplay(value: unknown): string {
  if (!value) return '';
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString();
}

/**
 * Renders one customer-record section with a Display / Edit toggle.
 * Read mode: compact 3-column grid of label/value pairs.
 * Edit mode: full form with Save / Cancel buttons; individual fields
 * no longer have inline click-to-edit.
 */
export function CustomerRecordSectionBlock({
  section,
  customer,
  crmConfig,
  allFields,
  staff,
  saving,
  onSave,
  expanded,
  onToggleExpanded,
}: CustomerRecordSectionBlockProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaPost, numaPut } = useNumaRequest();
  const { refreshConfig } = useOps();
  const { user } = useAuth();
  const isAdmin = Boolean(user?.groups?.includes('admin'));
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [missingRequired, setMissingRequired] = useState<Set<string>>(new Set());

  // ── Add field state ────────────────────────────────────────────────────
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [creatingField, setCreatingField] = useState(false);
  const [createFieldError, setCreateFieldError] = useState<string | null>(null);
  const [addingFromLibrary, setAddingFromLibrary] = useState(false);

  const fieldDefById = useMemo(() => {
    const map = new Map<string, FieldDefinition>();
    for (const f of allFields) map.set(f.id, f);
    return map;
  }, [allFields]);

  const activeStaff = useMemo(() => staff.filter((s) => s.isActive), [staff]);

  const requiredFieldIdSet = useMemo(() => new Set(section.requiredFieldIds ?? []), [section.requiredFieldIds]);

  // Field ids already used somewhere in the customerRecord (across all sections).
  const usedFieldIds = useMemo(() => {
    const s = new Set<string>();
    const record = crmConfig.customerRecord;
    if (record) {
      for (const sec of record.sections) {
        for (const id of sec.fieldIds) s.add(id);
      }
    }
    return s;
  }, [crmConfig.customerRecord]);

  // Library of fields that could be added to THIS section: built-ins + crm
  // custom fields, filtered to those not already in the record anywhere.
  const addableOptions = useMemo(() => {
    const inSection = new Set(section.fieldIds);
    const opts: { id: string; label: string }[] = [];
    for (const id of Object.keys(BUILTIN_CUSTOMER_FIELDS)) {
      if (inSection.has(id) || usedFieldIds.has(id)) continue;
      opts.push({ id, label: resolveBuiltinFieldLabel(crmConfig?.builtinFieldLabels, id, t) });
    }
    for (const f of allFields) {
      if (f.category !== 'crm') continue;
      if (inSection.has(f.id) || usedFieldIds.has(f.id)) continue;
      opts.push({ id: f.id, label: f.name });
    }
    opts.sort((a, b) => a.label.localeCompare(b.label));
    return opts;
  }, [allFields, section.fieldIds, usedFieldIds, crmConfig, t]);

  const layout = useMemo(() => resolveCustomerRecordLayout(crmConfig), [crmConfig]);
  const editColClass = `col-md-6 col-lg-${12 / layout.columnsPerSection}`;
  const readColClass =
    layout.columnsPerSection === 2
      ? 'col-12 col-md-6'
      : layout.columnsPerSection === 4
        ? 'col-6 col-md-3'
        : 'col-6 col-md-4';
  const sectionBodyClass = [
    'crm-section-body',
    layout.density === 'comfortable' ? 'crm-section-body-comfortable' : '',
    layout.labelPosition === 'inline' ? 'crm-section-body-inline-labels' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const startEdit = () => {
    const initial: Record<string, unknown> = {};
    for (const fieldId of section.fieldIds) {
      initial[fieldId] = getCustomerFieldValue(customer, fieldId);
    }
    setDraft(initial);
    setMissingRequired(new Set());
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setDraft({});
    setMissingRequired(new Set());
    setIsEditing(false);
  };

  const setDraftField = (fieldId: string, value: unknown) => {
    setDraft((prev) => ({ ...prev, [fieldId]: value }));
    if (missingRequired.has(fieldId) && !isEmptyValue(value)) {
      setMissingRequired((prev) => {
        const next = new Set(prev);
        next.delete(fieldId);
        return next;
      });
    }
  };

  const handleSave = async () => {
    const missing = new Set<string>();
    for (const fieldId of section.fieldIds) {
      if (!requiredFieldIdSet.has(fieldId)) continue;
      if (isEmptyValue(draft[fieldId])) missing.add(fieldId);
    }
    if (missing.size > 0) {
      setMissingRequired(missing);
      return;
    }

    const updates: Record<string, unknown> = {};
    for (const fieldId of section.fieldIds) {
      const originalValue = getCustomerFieldValue(customer, fieldId);
      const newValue = draft[fieldId];
      if (!valuesEqual(originalValue, newValue)) {
        updates[fieldId] = newValue;
      }
    }
    if (Object.keys(updates).length === 0) {
      setIsEditing(false);
      return;
    }
    await onSave(buildSectionUpdatePayload(customer, updates));
    setMissingRequired(new Set());
    setIsEditing(false);
    setDraft({});
  };

  const resetAddFieldForm = () => {
    setNewFieldName('');
    setNewFieldType('text');
    setNewFieldOptions('');
    setNewFieldRequired(false);
    setCreateFieldError(null);
  };

  const cancelAddField = () => {
    setShowAddField(false);
    resetAddFieldForm();
  };

  const persistSectionWithField = async (fieldId: string, required = false) => {
    const currentRecord =
      crmConfig.customerRecord && crmConfig.customerRecord.sections.length > 0
        ? crmConfig.customerRecord
        : {
            sections: [
              {
                id: section.id,
                name: section.name,
                fieldIds: [...section.fieldIds],
                requiredFieldIds: section.requiredFieldIds ? [...section.requiredFieldIds] : undefined,
              },
            ],
          };
    const nextRecord = {
      sections: currentRecord.sections.map((s) =>
        s.id === section.id
          ? {
              ...s,
              fieldIds: [...s.fieldIds, fieldId],
              requiredFieldIds: required ? [...(s.requiredFieldIds ?? []), fieldId] : s.requiredFieldIds,
            }
          : s
      ),
    };
    const nextCrmConfig: CrmConfig = { ...crmConfig, customerRecord: nextRecord };
    await OpsService.updateCrmConfig(numaPut, nextCrmConfig);
    await refreshConfig();
  };

  const handleAddFromLibrary = async (fieldId: string) => {
    setAddingFromLibrary(true);
    try {
      await persistSectionWithField(fieldId);
      setDraft((prev) => ({ ...prev, [fieldId]: null }));
    } catch (err) {
      console.error('[CustomerRecordSectionBlock] Failed to add field from library', err);
    } finally {
      setAddingFromLibrary(false);
    }
  };

  const handleCreateCustomField = async () => {
    const name = newFieldName.trim();
    if (!name) return;

    const requiresOptions = newFieldType === 'select' || newFieldType === 'multi_select';
    const parsedOptions = requiresOptions
      ? newFieldOptions
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    if (requiresOptions && (!parsedOptions || parsedOptions.length === 0)) {
      setCreateFieldError(t('crm.addCustomField.optionsRequired', 'Add at least one option'));
      return;
    }

    setCreatingField(true);
    setCreateFieldError(null);
    try {
      const fieldId = generateCrmFieldId();
      const created = await OpsService.createField(numaPost, {
        id: fieldId,
        name,
        category: 'crm',
        fieldType: newFieldType,
        options: parsedOptions,
        isSystem: false,
        order: allFields.length,
      });

      const newFieldId = created.id ?? fieldId;
      await persistSectionWithField(newFieldId, newFieldRequired);

      // Surface the new field in the open edit session.
      setDraft((prev) => ({ ...prev, [newFieldId]: null }));
      setShowAddField(false);
      resetAddFieldForm();
    } catch (err) {
      console.error('[CustomerRecordSectionBlock] Failed to create custom field', err);
      setCreateFieldError(t('crm.addCustomField.error', 'Could not create field. Please try again.'));
    } finally {
      setCreatingField(false);
    }
  };

  const renderHeader = () => (
    <div
      className="crm-section-header"
      onClick={onToggleExpanded}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleExpanded();
        }
      }}
    >
      <i className={`bi bi-chevron-${expanded ? 'down' : 'right'}`} />
      <span className="crm-section-header-title">{section.name}</span>
      {expanded && !isEditing && (
        <span className="ms-auto" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="link"
            size="sm"
            className="p-0 text-decoration-none"
            style={{ fontSize: '0.75rem' }}
            onClick={startEdit}
          >
            <i className="bi bi-pencil-square me-1" />
            {t('common.edit')}
          </Button>
        </span>
      )}
    </div>
  );

  if (!expanded) return <div>{renderHeader()}</div>;

  return (
    <div>
      {renderHeader()}
      <div className={sectionBodyClass}>
        {isEditing ? (
          <>
            {missingRequired.size > 0 && (
              <div className="alert alert-danger py-2 px-3 small mb-3">
                {t('crm.requiredFieldsMissing', 'Please fill out all required fields before saving.')}
              </div>
            )}
            <div className="row g-3">
              {section.fieldIds.map((fieldId) => (
                <div key={fieldId} className={editColClass}>
                  {renderEditControl(fieldId, draft[fieldId], (next) => setDraftField(fieldId, next), {
                    customer,
                    crmConfig,
                    staff: activeStaff,
                    fieldDefById,
                    saving,
                    t,
                    requiredFieldIds: requiredFieldIdSet,
                    missingRequired,
                  })}
                </div>
              ))}
            </div>

            {isAdmin && (
              <div className="mt-3">
                {showAddField ? (
                  <div className="border rounded p-3 bg-light">
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <div className="fw-medium small">{t('crm.addCustomField.title', 'Add custom field')}</div>
                      <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                        {t('crm.addCustomField.scopeWarning', {
                          section: section.name,
                          defaultValue: 'Will appear on every customer in "{{section}}"',
                        })}
                      </span>
                    </div>
                    <div className="row g-2 align-items-end">
                      <div className="col-12 col-md-5">
                        <Form.Label className="small text-muted mb-1">{t('common.name')}</Form.Label>
                        <Form.Control
                          size="sm"
                          autoFocus
                          value={newFieldName}
                          placeholder={t('crm.addCustomField.namePlaceholder', 'e.g. Renewal Notes')}
                          onChange={(e) => setNewFieldName(e.target.value)}
                          disabled={creatingField}
                        />
                      </div>
                      <div className="col-6 col-md-3">
                        <Form.Label className="small text-muted mb-1">
                          {t('globalSettings.fieldType', 'Type')}
                        </Form.Label>
                        <Form.Select
                          size="sm"
                          value={newFieldType}
                          onChange={(e) => setNewFieldType(e.target.value as FieldType)}
                          disabled={creatingField}
                        >
                          {ADDABLE_FIELD_TYPES.map((ft) => (
                            <option key={ft} value={ft}>
                              {ft}
                            </option>
                          ))}
                        </Form.Select>
                      </div>
                      {(newFieldType === 'select' || newFieldType === 'multi_select') && (
                        <div className="col-12 col-md-4">
                          <Form.Label className="small text-muted mb-1">
                            {t('globalSettings.options', 'Options')}
                          </Form.Label>
                          <Form.Control
                            size="sm"
                            value={newFieldOptions}
                            placeholder="Red, Blue, Green"
                            onChange={(e) => setNewFieldOptions(e.target.value)}
                            disabled={creatingField}
                          />
                        </div>
                      )}
                    </div>
                    <div className="mt-2">
                      <Form.Check
                        type="checkbox"
                        id={`crm-section-create-field-required-${section.id}`}
                        label={t('globalSettings.required', 'Required')}
                        checked={newFieldRequired}
                        onChange={(e) => setNewFieldRequired(e.target.checked)}
                        disabled={creatingField}
                      />
                    </div>
                    {createFieldError && <div className="text-danger small mt-2">{createFieldError}</div>}
                    <div className="d-flex justify-content-end gap-2 mt-2">
                      <Button variant="outline-secondary" size="sm" onClick={cancelAddField} disabled={creatingField}>
                        {t('common.cancel')}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleCreateCustomField}
                        disabled={creatingField || !newFieldName.trim()}
                      >
                        {creatingField ? t('common.saving') : t('common.add')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <Dropdown>
                      <Dropdown.Toggle
                        size="sm"
                        variant="outline-primary"
                        disabled={saving || addingFromLibrary || addableOptions.length === 0}
                      >
                        <i className="bi bi-plus-circle me-1" />
                        {t('crm.addCustomField.addFromLibrary', 'Add from field library')}
                      </Dropdown.Toggle>
                      <Dropdown.Menu style={{ maxHeight: 320, overflowY: 'auto' }}>
                        {addableOptions.map((opt) => (
                          <Dropdown.Item key={opt.id} onClick={() => handleAddFromLibrary(opt.id)}>
                            {opt.label}
                          </Dropdown.Item>
                        ))}
                      </Dropdown.Menu>
                    </Dropdown>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => setShowAddField(true)}
                      disabled={saving || addingFromLibrary}
                    >
                      <i className="bi bi-plus-circle me-1" />
                      {t('crm.addCustomField.createNew', 'Create new field')}
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="d-flex justify-content-end gap-2 mt-3">
              <Button variant="outline-secondary" size="sm" onClick={cancelEdit} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </>
        ) : (
          <div className="row g-2 g-md-3">
            {section.fieldIds.map((fieldId) => (
              <div key={fieldId} className={readColClass}>
                {renderReadRow(fieldId, customer, { crmConfig, staff, fieldDefById, t })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Edit control rendering ──────────────────────────────────────────────────

export interface FieldContext {
  /**
   * The customer being edited. In create mode, pass a placeholder customer
   * with any pre-filled defaults — it is only used by built-in field
   * renderers that fall back to existing customer state for display.
   */
  customer: Customer;
  crmConfig: CrmConfig;
  staff: StaffProfile[];
  fieldDefById: Map<string, FieldDefinition>;
  saving: boolean;
  t: TFunction<'ops'>;
  requiredFieldIds: Set<string>;
  missingRequired: Set<string>;
}

export function renderEditControl(
  fieldId: string,
  value: unknown,
  onChange: (next: unknown) => void,
  ctx: FieldContext
): React.ReactNode {
  const isRequired = ctx.requiredFieldIds.has(fieldId);
  const hasError = ctx.missingRequired.has(fieldId);
  const errorNode = hasError ? (
    <div className="text-danger small mt-1">{ctx.t('crm.requiredFieldMessage', 'This field is required.')}</div>
  ) : null;
  const labelNode = (
    <Form.Label className="small text-muted mb-1">
      {labelFor(fieldId, ctx)}
      {isRequired && <span className="text-danger ms-1">*</span>}
    </Form.Label>
  );

  if (!isBuiltinField(fieldId)) {
    const field = ctx.fieldDefById.get(fieldId);
    if (!field) {
      // Unknown field id (orphan in config — render minimal input)
      return (
        <div>
          {labelNode}
          <Form.Control
            size="sm"
            isInvalid={hasError}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
          />
          {errorNode}
        </div>
      );
    }
    return (
      <div>
        {labelNode}
        {hasError ? (
          <div className="border border-danger rounded p-1">
            <DynamicField field={field} value={value} onChange={onChange} staff={ctx.staff} hideLabel />
          </div>
        ) : (
          <DynamicField field={field} value={value} onChange={onChange} staff={ctx.staff} hideLabel />
        )}
        {errorNode}
      </div>
    );
  }

  const meta = BUILTIN_CUSTOMER_FIELDS[fieldId];
  const strVal = value == null ? '' : String(value);

  switch (meta.kind) {
    case 'text':
      return (
        <div>
          {labelNode}
          <Form.Control
            size="sm"
            isInvalid={hasError}
            value={strVal}
            onChange={(e) => onChange(e.target.value || null)}
          />
          {errorNode}
        </div>
      );
    case 'textarea':
      return (
        <div>
          {labelNode}
          <Form.Control
            as="textarea"
            rows={3}
            size="sm"
            isInvalid={hasError}
            value={strVal}
            onChange={(e) => onChange(e.target.value || null)}
          />
          {errorNode}
        </div>
      );
    case 'url':
      return (
        <div>
          {labelNode}
          <Form.Control
            type="url"
            size="sm"
            isInvalid={hasError}
            value={strVal}
            onChange={(e) => onChange(e.target.value || null)}
            placeholder="https://example.com"
          />
          {errorNode}
        </div>
      );
    case 'date':
      return (
        <div>
          {labelNode}
          <Form.Control
            type="date"
            size="sm"
            isInvalid={hasError}
            value={toDateInput(value)}
            onChange={(e) => onChange(e.target.value || null)}
          />
          {errorNode}
        </div>
      );
    case 'currency':
      return (
        <div>
          {labelNode}
          <Form.Control
            type="number"
            size="sm"
            isInvalid={hasError}
            value={strVal}
            onChange={(e) => {
              const next = e.target.value;
              onChange(next ? parseFloat(next) : null);
            }}
          />
          {errorNode}
        </div>
      );
    case 'select-industry':
      return selectControl(labelNode, strVal, onChange, ctx.crmConfig.industries ?? [], hasError, errorNode);
    case 'select-territory':
      return selectControl(labelNode, strVal, onChange, ctx.crmConfig.territories ?? [], hasError, errorNode);
    case 'select-owner':
      return (
        <div>
          {labelNode}
          <Form.Select size="sm" isInvalid={hasError} value={strVal} onChange={(e) => onChange(e.target.value || null)}>
            <option value="">{ctx.t('common.selectOption')}</option>
            {ctx.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.email}
              </option>
            ))}
          </Form.Select>
          {errorNode}
        </div>
      );
    case 'select-lifecycle':
      return (
        <div>
          {labelNode}
          <Form.Select size="sm" isInvalid={hasError} value={strVal} onChange={(e) => onChange(e.target.value || null)}>
            <option value="">{ctx.t('common.selectOption')}</option>
            {(ctx.crmConfig.lifecycleStages ?? []).map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </Form.Select>
          {errorNode}
        </div>
      );
    case 'select-contract-term': {
      const options =
        CONTRACT_TERM_OPTIONS.includes(strVal) || !strVal ? CONTRACT_TERM_OPTIONS : [strVal, ...CONTRACT_TERM_OPTIONS];
      return selectControl(labelNode, strVal, onChange, options, hasError, errorNode);
    }
    case 'product-list': {
      const asArray = Array.isArray(value) ? (value as string[]) : [];
      const displayVal = asArray.join(', ');
      return (
        <div>
          {labelNode}
          <Form.Control
            size="sm"
            isInvalid={hasError}
            value={displayVal}
            placeholder="Product A, Product B"
            onChange={(e) => {
              const list = e.target.value
                .split(',')
                .map((p) => p.trim())
                .filter(Boolean);
              onChange(list.length > 0 ? list : null);
            }}
          />
          {errorNode}
        </div>
      );
    }
  }
}

function selectControl(
  labelNode: React.ReactNode,
  value: string,
  onChange: (next: unknown) => void,
  options: string[],
  hasError: boolean,
  errorNode: React.ReactNode
): React.ReactNode {
  return (
    <div>
      {labelNode}
      <Form.Select size="sm" isInvalid={hasError} value={value} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </Form.Select>
      {errorNode}
    </div>
  );
}

// ─── Read-mode rendering ─────────────────────────────────────────────────────

interface ReadContext {
  crmConfig: CrmConfig;
  staff: StaffProfile[];
  fieldDefById: Map<string, FieldDefinition>;
  t: FieldContext['t'];
}

function renderReadRow(fieldId: string, customer: Customer, ctx: ReadContext): React.ReactNode {
  const label = labelFor(fieldId, ctx);
  const rawValue = getCustomerFieldValue(customer, fieldId);
  const valueNode = renderReadValue(fieldId, rawValue, customer, ctx);
  return (
    <div className="crm-compact-field">
      <div className="crm-compact-label">{label}</div>
      <div className="crm-compact-value">{valueNode}</div>
    </div>
  );
}

function renderReadValue(fieldId: string, value: unknown, customer: Customer, ctx: ReadContext): React.ReactNode {
  const empty = <span className="text-muted">—</span>;

  if (!isBuiltinField(fieldId)) {
    const field = ctx.fieldDefById.get(fieldId);
    if (!field) return empty;
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return empty;
    return <DynamicField field={field} value={value} onChange={() => {}} readOnly staff={ctx.staff} hideLabel />;
  }

  const meta = BUILTIN_CUSTOMER_FIELDS[fieldId];

  switch (meta.kind) {
    case 'text':
    case 'textarea':
      return value ? <span>{String(value)}</span> : empty;
    case 'url':
      return value ? (
        <a
          href={String(value).startsWith('http') ? String(value) : `https://${String(value)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {String(value)}
        </a>
      ) : (
        empty
      );
    case 'date':
      return value ? <span>{formatDateDisplay(value)}</span> : empty;
    case 'currency':
      return value != null ? <span>{formatCurrency(value)}</span> : empty;
    case 'select-industry':
    case 'select-territory':
    case 'select-contract-term':
      return value ? <span>{String(value)}</span> : empty;
    case 'select-owner': {
      const match = ctx.staff.find((s) => s.id === value);
      return match ? (
        <span>{match.name || match.email}</span>
      ) : customer.ownerName ? (
        <span>{customer.ownerName}</span>
      ) : (
        empty
      );
    }
    case 'select-lifecycle': {
      const stage = (ctx.crmConfig.lifecycleStages ?? []).find((s) => s.id === value);
      if (!stage) return empty;
      const color = getColorForPosition(stage.colorPosition);
      return (
        <span
          className="ticket-badge"
          style={{
            background: `${color}18`,
            color,
            border: `1px solid ${color}40`,
            fontWeight: 600,
            maxWidth: 'none',
          }}
        >
          {stage.name}
        </span>
      );
    }
    case 'product-list':
      return Array.isArray(value) && value.length > 0 ? (
        <div className="d-flex flex-wrap gap-1">
          {value.map((p) => (
            <Badge key={String(p)} bg="light" text="dark" className="border" style={{ fontSize: '0.7rem' }}>
              {String(p)}
            </Badge>
          ))}
        </div>
      ) : (
        empty
      );
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function labelFor(
  fieldId: string,
  ctx: { fieldDefById: Map<string, FieldDefinition>; t: FieldContext['t']; crmConfig: CrmConfig }
): string {
  if (isBuiltinField(fieldId)) {
    return resolveBuiltinFieldLabel(ctx.crmConfig.builtinFieldLabels, fieldId, ctx.t);
  }
  const field = ctx.fieldDefById.get(fieldId);
  return field?.name ?? fieldId;
}

export function isEmptyValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && (b === '' || b == null)) return true;
  if (b == null && (a === '' || a == null)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  return false;
}
