/* eslint-disable i18next/no-literal-string */
import React, { useMemo, useState } from 'react';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Dropdown from 'react-bootstrap/Dropdown';
import type { TFunction } from 'i18next';
import type { CustomerRecordConfig, CustomerRecordSection, FieldDefinition, FieldType } from '../../../types/ops';
import { BUILTIN_CUSTOMER_FIELDS, isBuiltinField, resolveBuiltinFieldLabel } from '../Shared/customerRecordFields';

interface CreateFieldInput {
  name: string;
  fieldType: FieldType;
  options?: string[];
}

interface UpdateFieldInput {
  name: string;
  fieldType: FieldType;
  options?: string[];
}

interface CustomerRecordConfigBlockProps {
  value: CustomerRecordConfig;
  onChange: (next: CustomerRecordConfig) => void;
  allFields: FieldDefinition[];
  t: TFunction<'ops'>;
  /**
   * Create a brand-new CRM custom field. The parent persists it server-side
   * and appends it to its local fields state, then returns the new field id.
   * If undefined, the inline "Create new" affordance is hidden.
   */
  onCreateField?: (input: CreateFieldInput) => Promise<string | null>;
  /**
   * Update an existing custom CRM field (rename, retype, change options).
   * Called with the field id and the new values. If undefined, edit buttons are hidden.
   */
  onUpdateField?: (fieldId: string, input: UpdateFieldInput) => Promise<boolean>;
  /**
   * Current per-client label overrides for built-in fields, keyed by
   * built-in field id (e.g. "companyName"). When unset, labels fall back
   * to the i18n default for the field.
   */
  builtinFieldLabels?: Record<string, string>;
  /**
   * Set or clear the label override for a built-in field. Pass null to
   * remove the override and fall back to the i18n default. If undefined,
   * the pencil/edit affordance is hidden for built-ins.
   */
  onBuiltinLabelChange?: (fieldId: string, newLabel: string | null) => void;
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

const newSectionId = () => `section-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Admin-facing CRM Customer Record configurator.
 * Lets admins add/remove/reorder sections, and add/remove/reorder fields
 * within each section. Fields are either built-ins (from BUILTIN_CUSTOMER_FIELDS)
 * or custom FieldDefinitions tagged with category='crm'.
 */
export function CustomerRecordConfigBlock({
  value,
  onChange,
  allFields,
  t,
  onCreateField,
  onUpdateField,
  builtinFieldLabels,
  onBuiltinLabelChange,
}: CustomerRecordConfigBlockProps): React.JSX.Element {
  const [newSectionName, setNewSectionName] = useState('');
  // Inline "Create new custom field" form state. Only one form is open at a
  // time; keyed by section id so the form lives under the target section.
  const [createForSectionId, setCreateForSectionId] = useState<string | null>(null);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [creatingField, setCreatingField] = useState(false);
  const [createFieldError, setCreateFieldError] = useState<string | null>(null);

  // Inline edit form state — keyed by field id
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editFieldName, setEditFieldName] = useState('');
  const [editFieldType, setEditFieldType] = useState<FieldType>('text');
  const [editFieldOptions, setEditFieldOptions] = useState('');
  const [savingField, setSavingField] = useState(false);
  const [editFieldError, setEditFieldError] = useState<string | null>(null);

  const crmFields = useMemo(() => allFields.filter((f) => f.category === 'crm'), [allFields]);

  const fieldDefById = useMemo(() => {
    const m = new Map<string, FieldDefinition>();
    for (const f of crmFields) m.set(f.id, f);
    return m;
  }, [crmFields]);

  // All field ids currently used anywhere in the record config (across sections).
  const usedFieldIds = useMemo(() => {
    const s = new Set<string>();
    for (const section of value.sections) {
      for (const id of section.fieldIds) s.add(id);
    }
    return s;
  }, [value]);

  // Options an admin can ADD — built-ins + crm custom fields not yet in the record.
  const addableForSection = (section: CustomerRecordSection) => {
    const already = new Set(section.fieldIds);
    const opts: { id: string; label: string }[] = [];

    for (const id of Object.keys(BUILTIN_CUSTOMER_FIELDS)) {
      if (already.has(id) || usedFieldIds.has(id)) continue;
      opts.push({ id, label: resolveBuiltinFieldLabel(builtinFieldLabels, id, t) });
    }
    for (const f of crmFields) {
      if (already.has(f.id) || usedFieldIds.has(f.id)) continue;
      opts.push({ id: f.id, label: f.name });
    }
    opts.sort((a, b) => a.label.localeCompare(b.label));
    return opts;
  };

  const labelFor = (fieldId: string): string => {
    if (isBuiltinField(fieldId)) return resolveBuiltinFieldLabel(builtinFieldLabels, fieldId, t);
    return fieldDefById.get(fieldId)?.name ?? fieldId;
  };

  const updateSections = (updater: (sections: CustomerRecordSection[]) => CustomerRecordSection[]) => {
    onChange({ ...value, sections: updater(value.sections.map((s) => ({ ...s, fieldIds: [...s.fieldIds] }))) });
  };

  const moveSection = (idx: number, dir: -1 | 1) => {
    updateSections((sections) => {
      const target = idx + dir;
      if (target < 0 || target >= sections.length) return sections;
      [sections[idx], sections[target]] = [sections[target], sections[idx]];
      return sections;
    });
  };

  const removeSection = (idx: number) => {
    updateSections((sections) => sections.filter((_, i) => i !== idx));
  };

  const renameSection = (idx: number, name: string) => {
    updateSections((sections) => {
      sections[idx] = { ...sections[idx], name };
      return sections;
    });
  };

  const addSection = () => {
    const name = newSectionName.trim();
    if (!name) return;
    updateSections((sections) => [...sections, { id: newSectionId(), name, fieldIds: [] }]);
    setNewSectionName('');
  };

  const moveField = (sectionIdx: number, fieldIdx: number, dir: -1 | 1) => {
    updateSections((sections) => {
      const ids = [...sections[sectionIdx].fieldIds];
      const target = fieldIdx + dir;
      if (target < 0 || target >= ids.length) return sections;
      [ids[fieldIdx], ids[target]] = [ids[target], ids[fieldIdx]];
      sections[sectionIdx] = { ...sections[sectionIdx], fieldIds: ids };
      return sections;
    });
  };

  const removeField = (sectionIdx: number, fieldIdx: number) => {
    updateSections((sections) => {
      const section = sections[sectionIdx];
      const removedId = section.fieldIds[fieldIdx];
      const ids = section.fieldIds.filter((_, i) => i !== fieldIdx);
      const requiredIds = section.requiredFieldIds?.filter((id) => id !== removedId);
      sections[sectionIdx] = { ...section, fieldIds: ids, requiredFieldIds: requiredIds };
      return sections;
    });
  };

  const addField = (sectionIdx: number, fieldId: string, required = false) => {
    updateSections((sections) => {
      const section = sections[sectionIdx];
      const ids = [...section.fieldIds, fieldId];
      const requiredIds = required ? [...(section.requiredFieldIds ?? []), fieldId] : section.requiredFieldIds;
      sections[sectionIdx] = { ...section, fieldIds: ids, requiredFieldIds: requiredIds };
      return sections;
    });
  };

  const toggleFieldRequired = (sectionIdx: number, fieldId: string) => {
    updateSections((sections) => {
      const section = sections[sectionIdx];
      const current = new Set(section.requiredFieldIds ?? []);
      if (current.has(fieldId)) current.delete(fieldId);
      else current.add(fieldId);
      sections[sectionIdx] = { ...section, requiredFieldIds: Array.from(current) };
      return sections;
    });
  };

  const resetCreateForm = () => {
    setNewFieldName('');
    setNewFieldType('text');
    setNewFieldOptions('');
    setNewFieldRequired(false);
    setCreateFieldError(null);
  };

  const openEditField = (fieldId: string) => {
    if (isBuiltinField(fieldId)) {
      setEditingFieldId(fieldId);
      setEditFieldName(resolveBuiltinFieldLabel(builtinFieldLabels, fieldId, t));
      setEditFieldType('text');
      setEditFieldOptions('');
      setEditFieldError(null);
      setCreateForSectionId(null);
      resetCreateForm();
      return;
    }
    const field = fieldDefById.get(fieldId);
    if (!field) return;
    setEditingFieldId(fieldId);
    setEditFieldName(field.name);
    setEditFieldType(field.fieldType);
    setEditFieldOptions((field.options ?? []).join(', '));
    setEditFieldError(null);
    // Close create form if open
    setCreateForSectionId(null);
    resetCreateForm();
  };

  const cancelEditField = () => {
    setEditingFieldId(null);
    setEditFieldError(null);
  };

  const handleUpdateField = async () => {
    if (!editingFieldId) return;
    const name = editFieldName.trim();

    // Built-in field rename: just update the label override (local state).
    // Empty input clears the override and falls back to the i18n default.
    if (isBuiltinField(editingFieldId)) {
      if (!onBuiltinLabelChange) return;
      const defaultLabel = t(BUILTIN_CUSTOMER_FIELDS[editingFieldId].labelKey);
      const nextOverride = !name || name === defaultLabel ? null : name;
      onBuiltinLabelChange(editingFieldId, nextOverride);
      setEditingFieldId(null);
      return;
    }

    if (!onUpdateField || !name) return;

    const requiresOptions = editFieldType === 'select' || editFieldType === 'multi_select';
    const parsedOptions = requiresOptions
      ? editFieldOptions
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    if (requiresOptions && (!parsedOptions || parsedOptions.length === 0)) {
      setEditFieldError(t('crm.addCustomField.optionsRequired', 'Add at least one option'));
      return;
    }

    setSavingField(true);
    setEditFieldError(null);
    try {
      const ok = await onUpdateField(editingFieldId, { name, fieldType: editFieldType, options: parsedOptions });
      if (ok) {
        setEditingFieldId(null);
      } else {
        setEditFieldError(t('crm.addCustomField.error', 'Could not update field. Please try again.'));
      }
    } catch {
      setEditFieldError(t('crm.addCustomField.error', 'Could not update field. Please try again.'));
    } finally {
      setSavingField(false);
    }
  };

  const openCreateFor = (sectionId: string) => {
    resetCreateForm();
    setCreateForSectionId(sectionId);
  };

  const cancelCreate = () => {
    setCreateForSectionId(null);
    resetCreateForm();
  };

  const handleCreateCustomField = async (sectionIdx: number) => {
    if (!onCreateField) return;
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
      const newId = await onCreateField({
        name,
        fieldType: newFieldType,
        options: parsedOptions,
      });
      if (!newId) {
        setCreateFieldError(t('crm.addCustomField.error', 'Could not create field. Please try again.'));
        return;
      }
      addField(sectionIdx, newId, newFieldRequired);
      setCreateForSectionId(null);
      resetCreateForm();
    } catch (err) {
      console.error('[CustomerRecordConfigBlock] Failed to create custom field', err);
      setCreateFieldError(t('crm.addCustomField.error', 'Could not create field. Please try again.'));
    } finally {
      setCreatingField(false);
    }
  };

  return (
    <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <div>
          <h6 className="fw-bold text-dark mb-1">Customer Record Layout</h6>
          <div className="text-muted small">
            Controls which sections and fields appear on the customer detail view. Built-in fields map to standard
            customer properties; custom fields (category &quot;crm&quot;) can also be added.
          </div>
        </div>
      </div>

      <div className="d-flex flex-column gap-3">
        {value.sections.map((section, sectionIdx) => (
          <div key={section.id} className="border rounded p-3 bg-light">
            <div className="d-flex align-items-center gap-2 mb-2">
              <Form.Control
                size="sm"
                value={section.name}
                onChange={(e) => renameSection(sectionIdx, e.target.value)}
                placeholder="Section name"
                style={{ maxWidth: 320, fontWeight: 600 }}
              />
              <div className="d-flex align-items-center gap-1 ms-auto">
                <Button
                  variant="link"
                  className="text-muted p-1"
                  disabled={sectionIdx === 0}
                  onClick={() => moveSection(sectionIdx, -1)}
                  title="Move up"
                >
                  <i className="bi bi-arrow-up" />
                </Button>
                <Button
                  variant="link"
                  className="text-muted p-1"
                  disabled={sectionIdx === value.sections.length - 1}
                  onClick={() => moveSection(sectionIdx, 1)}
                  title="Move down"
                >
                  <i className="bi bi-arrow-down" />
                </Button>
                <Button
                  variant="link"
                  className="text-danger p-1"
                  onClick={() => removeSection(sectionIdx)}
                  title="Remove section"
                >
                  <i className="bi bi-trash" />
                </Button>
              </div>
            </div>

            <div className="d-flex flex-column gap-1">
              {section.fieldIds.length === 0 && (
                <div className="text-muted small fst-italic">No fields in this section yet.</div>
              )}
              {section.fieldIds.map((fieldId, fieldIdx) => {
                const builtin = isBuiltinField(fieldId);
                const label = labelFor(fieldId);
                const isRequired = (section.requiredFieldIds ?? []).includes(fieldId);
                const isEditing = editingFieldId === fieldId;
                return (
                  <div key={fieldId}>
                    <div
                      className="d-flex align-items-center gap-2 bg-white rounded border px-2 py-1"
                      style={{ fontSize: '0.85rem' }}
                    >
                      <span className="text-muted" style={{ width: 18 }}>
                        <i
                          className={`bi bi-${builtin ? 'lock' : 'wrench-adjustable'}`}
                          title={builtin ? 'Built-in' : 'Custom'}
                        />
                      </span>
                      <span className="flex-grow-1">{label}</span>
                      <label
                        htmlFor={`req-${section.id}-${fieldId}`}
                        className="d-flex align-items-center gap-1 small text-muted mb-0"
                        style={{ cursor: 'pointer' }}
                      >
                        <input
                          id={`req-${section.id}-${fieldId}`}
                          type="checkbox"
                          className="form-check-input m-0"
                          checked={isRequired}
                          onChange={() => toggleFieldRequired(sectionIdx, fieldId)}
                        />
                        {t('globalSettings.required', 'Required')}
                      </label>
                      <span className="text-muted small">{builtin ? 'built-in' : 'custom'}</span>
                      {((builtin && onBuiltinLabelChange) || (!builtin && onUpdateField)) && (
                        <Button
                          variant="link"
                          className="text-muted p-1"
                          onClick={() => (isEditing ? cancelEditField() : openEditField(fieldId))}
                          title={isEditing ? 'Cancel edit' : builtin ? 'Rename label' : 'Edit field'}
                        >
                          <i className={`bi bi-${isEditing ? 'x' : 'pencil'}`} />
                        </Button>
                      )}
                      <Button
                        variant="link"
                        className="text-muted p-1"
                        disabled={fieldIdx === 0}
                        onClick={() => moveField(sectionIdx, fieldIdx, -1)}
                        title="Move up"
                      >
                        <i className="bi bi-arrow-up" />
                      </Button>
                      <Button
                        variant="link"
                        className="text-muted p-1"
                        disabled={fieldIdx === section.fieldIds.length - 1}
                        onClick={() => moveField(sectionIdx, fieldIdx, 1)}
                        title="Move down"
                      >
                        <i className="bi bi-arrow-down" />
                      </Button>
                      <Button
                        variant="link"
                        className="text-danger p-1"
                        onClick={() => removeField(sectionIdx, fieldIdx)}
                        title="Remove field"
                      >
                        <i className="bi bi-x-lg" />
                      </Button>
                    </div>
                    {isEditing && (
                      <div className="border rounded p-3 bg-white mt-1">
                        <div className="row g-2 align-items-end">
                          <div className="col-12 col-md-5">
                            <Form.Label className="small text-muted mb-1">{t('common.name')}</Form.Label>
                            <Form.Control
                              size="sm"
                              autoFocus
                              value={editFieldName}
                              onChange={(e) => setEditFieldName(e.target.value)}
                              disabled={savingField}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleUpdateField();
                                }
                                if (e.key === 'Escape') cancelEditField();
                              }}
                            />
                          </div>
                          {!builtin && (
                            <>
                              <div className="col-6 col-md-3">
                                <Form.Label className="small text-muted mb-1">
                                  {t('globalSettings.fieldType', 'Type')}
                                </Form.Label>
                                <Form.Select
                                  size="sm"
                                  value={editFieldType}
                                  onChange={(e) => setEditFieldType(e.target.value as FieldType)}
                                  disabled={savingField}
                                >
                                  {ADDABLE_FIELD_TYPES.map((ft) => (
                                    <option key={ft} value={ft}>
                                      {ft}
                                    </option>
                                  ))}
                                </Form.Select>
                              </div>
                              {(editFieldType === 'select' || editFieldType === 'multi_select') && (
                                <div className="col-12 col-md-4">
                                  <Form.Label className="small text-muted mb-1">
                                    {t('globalSettings.options', 'Options')}
                                  </Form.Label>
                                  <Form.Control
                                    size="sm"
                                    value={editFieldOptions}
                                    placeholder="Red, Blue, Green"
                                    onChange={(e) => setEditFieldOptions(e.target.value)}
                                    disabled={savingField}
                                  />
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        {builtin && (
                          <div className="text-muted small mt-2">
                            {t(
                              'globalSettings.builtinFieldEditHint',
                              'Built-in fields keep their underlying type; you can only rename the label. Clear the name to restore the default.'
                            )}
                          </div>
                        )}
                        {editFieldError && <div className="text-danger small mt-2">{editFieldError}</div>}
                        <div className="d-flex justify-content-end gap-2 mt-2">
                          <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={cancelEditField}
                            disabled={savingField}
                          >
                            {t('common.cancel')}
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={handleUpdateField}
                            disabled={savingField || (!builtin && !editFieldName.trim())}
                          >
                            {savingField ? t('common.saving') : t('common.save')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-2 d-flex flex-wrap align-items-center gap-2">
              <AddFieldDropdown options={addableForSection(section)} onPick={(id) => addField(sectionIdx, id)} />
              {onCreateField && createForSectionId !== section.id && (
                <Button size="sm" variant="outline-secondary" onClick={() => openCreateFor(section.id)}>
                  <i className="bi bi-plus-circle me-1" /> Create new custom field
                </Button>
              )}
            </div>

            {onCreateField && createForSectionId === section.id && (
              <div className="mt-2 border rounded p-3 bg-white">
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <div className="fw-medium small">
                    {t('crm.addCustomField.title', 'Add custom field')} — {section.name}
                  </div>
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
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleCreateCustomField(sectionIdx);
                        }
                      }}
                    />
                  </div>
                  <div className="col-6 col-md-3">
                    <Form.Label className="small text-muted mb-1">{t('globalSettings.fieldType', 'Type')}</Form.Label>
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
                    id={`crm-create-field-required-${section.id}`}
                    label={t('globalSettings.required', 'Required')}
                    checked={newFieldRequired}
                    onChange={(e) => setNewFieldRequired(e.target.checked)}
                    disabled={creatingField}
                  />
                </div>
                {createFieldError && <div className="text-danger small mt-2">{createFieldError}</div>}
                <div className="d-flex justify-content-end gap-2 mt-2">
                  <Button variant="outline-secondary" size="sm" onClick={cancelCreate} disabled={creatingField}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleCreateCustomField(sectionIdx)}
                    disabled={creatingField || !newFieldName.trim()}
                  >
                    {creatingField ? t('common.saving') : t('common.add')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Add new section */}
        <div className="d-flex align-items-center gap-2">
          <Form.Control
            size="sm"
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            placeholder="New section name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addSection();
              }
            }}
            style={{ maxWidth: 320 }}
          />
          <Button size="sm" variant="primary" onClick={addSection} disabled={!newSectionName.trim()}>
            <i className="bi bi-plus" /> Add section
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Field dropdown ─────────────────────────────────────────────────────

function AddFieldDropdown({
  options,
  onPick,
}: {
  options: { id: string; label: string }[];
  onPick: (id: string) => void;
}): React.JSX.Element {
  if (options.length === 0) {
    return <span className="text-muted small fst-italic">No more fields available to add.</span>;
  }
  return (
    <Dropdown>
      <Dropdown.Toggle size="sm" variant="outline-primary">
        <i className="bi bi-plus" /> Add field
      </Dropdown.Toggle>
      <Dropdown.Menu style={{ maxHeight: 320, overflowY: 'auto' }}>
        {options.map((opt) => (
          <Dropdown.Item key={opt.id} onClick={() => onPick(opt.id)}>
            {opt.label}
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
}
