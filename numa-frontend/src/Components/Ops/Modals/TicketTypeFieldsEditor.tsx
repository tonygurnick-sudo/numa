import React, { useCallback, useMemo, useState } from 'react';
import { Badge, Button, Collapse, Dropdown, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type {
  FieldCategory,
  FieldConditionRule,
  FieldDefinition,
  FieldOverride,
  FieldType,
  TicketType,
} from '../../../types/ops';
import { resolveBoardFieldList } from '../Shared/fieldResolution';

// ─── Shared types ────────────────────────────────────────────────────────────

/**
 * Operating mode:
 * - `board`: the editor mutates board-scoped state — fields can be added on
 *   top of the ticket type's defaultFields and individually customised
 *   (label/options/required) via fieldOverrides. This matches the
 *   BoardSettingsModal flow.
 * - `global`: the editor mutates the ticket type's own defaultFields list.
 *   No per-field overrides exist at this level; the customise pane is hidden.
 *   Used inside GlobalSettingsModal so the template editor reuses the same UI.
 */
export type TicketTypeFieldsEditorMode = 'board' | 'global';

export interface TicketTypeFieldsEditorProps {
  mode: TicketTypeFieldsEditorMode;
  ticketType: TicketType;
  /** All globally defined fields, including system fields. */
  fields: FieldDefinition[];
  /**
   * Board-only: visibility / label / options / order overrides keyed by
   * field id. Ignored in `global` mode.
   */
  fieldOverrides?: Record<string, FieldOverride>;
  /**
   * Board-only: extra fields layered on top of the ticket type's
   * defaultFields, keyed by ticket type id. Ignored in `global` mode.
   */
  addedFields?: Record<string, string[]>;
  /** Board mode: toggle field visibility (visible default = true). */
  onFieldVisibleToggle?: (fieldId: string) => void;
  /** Board mode: write label/options/required/order to a field override. */
  onFieldOverrideChange?: (fieldId: string, changes: Partial<FieldOverride>) => void;
  /** Board mode: include an extra field on top of the type's defaults. */
  onAddField?: (ticketTypeId: string, fieldId: string) => void;
  /** Board mode: drop an added field (system defaults are not removable). */
  onRemoveAddedField?: (ticketTypeId: string, fieldId: string) => void;
  /**
   * Both modes: reorder fields by moving one to a new index. The implementor
   * is responsible for assigning a dense `order` value to every field on the
   * type so re-renders are stable.
   */
  onMoveField: (ticketTypeId: string, fromIdx: number, toIdx: number) => void;
  /**
   * Global mode: mutate the ticket type's defaultFields list. Receives the
   * full new list. The editor assigns order densely via the reorder path.
   */
  onDefaultFieldsChange?: (ticketTypeId: string, defaultFields: string[]) => void;
  /**
   * Persist a brand-new global field and attach it to this ticket type.
   * Receives the form values; should resolve to the created field's id (so
   * the editor can immediately add it to defaultFields / addedFields).
   * Required for the "Create new custom field" button to be shown.
   */
  onCreateField?: (payload: {
    name: string;
    fieldType: FieldType;
    category: FieldCategory;
    options?: string[];
  }) => Promise<string>;
  /**
   * Board mode only: replace this board's snapshot for the ticket type with
   * the template's current defaultFields. When provided, renders a "Sync to
   * template" button so the user can manually pull template changes.
   */
  onSyncToTemplate?: (ticketTypeId: string) => void;
  /** When false (default), the editor doesn't render its top heading. */
  hideHeading?: boolean;
}

// ─── Field row ───────────────────────────────────────────────────────────────

interface FieldRowProps {
  field: FieldDefinition;
  override?: FieldOverride;
  ticketTypeId: string;
  index: number;
  totalCount: number;
  isAdded: boolean;
  mode: TicketTypeFieldsEditorMode;
  /**
   * All fields available on this ticket type (defaults + added). Used by the
   * conditions editor so users can pick which field a rule depends on.
   */
  availableConditionFields: FieldDefinition[];
  onVisibleToggle?: (fieldId: string) => void;
  onOverrideChange?: (fieldId: string, changes: Partial<FieldOverride>) => void;
  onMove: (ticketTypeId: string, fromIdx: number, toIdx: number) => void;
  onRemove?: (ticketTypeId: string, fieldId: string) => void;
}

function FieldRow({
  field,
  override,
  ticketTypeId,
  index,
  totalCount,
  isAdded,
  mode,
  availableConditionFields,
  onOverrideChange,
  onMove,
  onRemove,
}: FieldRowProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [showCustomise, setShowCustomise] = useState(false);
  const [customLabel, setCustomLabel] = useState(override?.label ?? '');
  const [customOptions, setCustomOptions] = useState((override?.options ?? field.options ?? []).join(', '));

  const isSelectType =
    field.fieldType === 'select' || field.fieldType === 'multiselect' || field.fieldType === 'multi_select';
  const effectiveOverride = override ?? { visible: true, required: false };
  const displayName = effectiveOverride.label || field.name;

  const handleSaveCustomise = useCallback(() => {
    if (!onOverrideChange) return;
    const changes: Partial<FieldOverride> = {};
    const trimmedLabel = customLabel.trim();
    if (trimmedLabel && trimmedLabel !== field.name) {
      changes.label = trimmedLabel;
    } else {
      changes.label = undefined;
    }
    if (isSelectType) {
      const opts = customOptions
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      if (opts.length > 0) {
        changes.options = opts;
      } else {
        changes.options = undefined;
      }
    }
    onOverrideChange(field.id, changes);
    setShowCustomise(false);
  }, [customLabel, customOptions, field.id, field.name, isSelectType, onOverrideChange]);

  const canCustomise = mode === 'board' && onOverrideChange != null;

  const isFirst = index === 0;
  const isLast = index === totalCount - 1;
  const isSystem = field.isSystem === true;
  // "built-in" badge tag in this UI marks system fields; "custom" marks
  // anything user-created. Matches the CRM Customer Record Layout language.
  const tagText = isSystem ? t('fieldsTab.builtin', 'built-in') : t('fieldsTab.custom', 'custom');

  return (
    <div>
      <div
        className="d-flex align-items-center gap-2 bg-white rounded border px-2 py-1 mb-1"
        style={{ fontSize: '0.85rem' }}
      >
        {/* Built-in / custom indicator */}
        <span className="text-muted" style={{ width: 18 }}>
          <i
            className={`bi bi-${isSystem ? 'lock' : 'wrench-adjustable'}`}
            title={isSystem ? t('fieldsTab.builtin', 'built-in') : t('fieldsTab.custom', 'custom')}
          />
        </span>

        {/* Name (renamed shows original in muted parens) */}
        <span className="flex-grow-1">
          {displayName}
          {effectiveOverride.label && (
            <span className="text-muted ms-1" style={{ fontSize: '0.75rem' }}>
              ({field.name})
            </span>
          )}
          {mode === 'board' && isAdded && (
            <Badge bg="info" text="white" className="ms-2 fw-normal" style={{ fontSize: '0.6rem' }}>
              {t('fieldsTab.added')}
            </Badge>
          )}
        </span>

        {/* Required checkbox (board mode only — global mode template has no notion of required) */}
        {mode === 'board' && onOverrideChange && (
          <label
            htmlFor={`field-required-${ticketTypeId}-${field.id}`}
            className="d-flex align-items-center gap-1 small text-muted mb-0"
            style={{ cursor: 'pointer' }}
          >
            <input
              id={`field-required-${ticketTypeId}-${field.id}`}
              type="checkbox"
              className="form-check-input m-0"
              checked={effectiveOverride.required}
              onChange={() => onOverrideChange(field.id, { required: !effectiveOverride.required })}
            />
            {t('common.required')}
          </label>
        )}

        {/* built-in / custom tag */}
        <span className="text-muted small">{tagText}</span>

        {/* Pencil → opens customise pane (board mode only). */}
        {canCustomise && (
          <Button
            variant="link"
            className="text-muted p-1"
            onClick={(e) => {
              e.stopPropagation();
              setShowCustomise(!showCustomise);
            }}
            title={showCustomise ? t('common.cancel') : t('fieldsTab.customise')}
          >
            <i className={`bi bi-${showCustomise ? 'x' : 'pencil'}`} />
          </Button>
        )}

        {/* Up / Down arrows */}
        <Button
          variant="link"
          className="text-muted p-1"
          disabled={isFirst}
          onClick={() => onMove(ticketTypeId, index, index - 1)}
          title={t('fieldsTab.moveUp')}
        >
          <i className="bi bi-arrow-up" />
        </Button>
        <Button
          variant="link"
          className="text-muted p-1"
          disabled={isLast}
          onClick={() => onMove(ticketTypeId, index, index + 1)}
          title={t('fieldsTab.moveDown')}
        >
          <i className="bi bi-arrow-down" />
        </Button>

        {/* Single remove affordance — matches the templates editor. In board
            mode, X removes added fields outright and hides default fields
            (since template-owned fields can't be deleted from a board). The
            "+ Add field" picker re-surfaces hidden defaults. */}
        {onRemove && (
          <Button
            variant="link"
            className="text-danger p-1"
            onClick={() => onRemove(ticketTypeId, field.id)}
            title={t('common.remove')}
          >
            <i className="bi bi-x-lg" />
          </Button>
        )}
      </div>

      {canCustomise && (
        <Collapse in={showCustomise}>
          <div>
            <div className="bg-light rounded-2 p-3 mb-2 ms-4">
              <div className="row g-3">
                <div className="col-sm-6">
                  <Form.Label className="small fw-medium mb-1">{t('fieldsTab.customLabel')}</Form.Label>
                  <Form.Control
                    size="sm"
                    type="text"
                    placeholder={field.name}
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                  />
                  <Form.Text className="text-muted" style={{ fontSize: '0.7rem' }}>
                    {t('fieldsTab.customLabelHelp')}
                  </Form.Text>
                </div>

                {isSelectType && (
                  <div className="col-12">
                    <Form.Label className="small fw-medium mb-1">{t('fieldsTab.customOptions')}</Form.Label>
                    <Form.Control
                      size="sm"
                      type="text"
                      placeholder={t('fieldsTab.customOptionsPlaceholder')}
                      value={customOptions}
                      onChange={(e) => setCustomOptions(e.target.value)}
                    />
                    <Form.Text className="text-muted" style={{ fontSize: '0.7rem' }}>
                      {t('fieldsTab.customOptionsHelp')}
                    </Form.Text>
                  </div>
                )}
              </div>

              <FieldConditionsEditor
                fieldId={field.id}
                conditions={effectiveOverride.conditions ?? field.conditions ?? []}
                availableFields={availableConditionFields}
                onChange={(conditions) =>
                  onOverrideChange?.(field.id, { conditions: conditions.length > 0 ? conditions : undefined })
                }
              />

              <div className="d-flex justify-content-end gap-2 mt-3">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => {
                    setCustomLabel(effectiveOverride.label ?? '');
                    setCustomOptions((effectiveOverride.options ?? field.options ?? []).join(', '));
                    setShowCustomise(false);
                  }}
                >
                  {t('common.cancel')}
                </button>
                <button type="button" className="btn btn-sm btn-primary" onClick={handleSaveCustomise}>
                  {t('fieldsTab.applyChanges')}
                </button>
              </div>
            </div>
          </div>
        </Collapse>
      )}
    </div>
  );
}

// ─── Conditions editor ──────────────────────────────────────────────────────

interface FieldConditionsEditorProps {
  fieldId: string;
  conditions: FieldConditionRule[];
  availableFields: FieldDefinition[];
  onChange: (conditions: FieldConditionRule[]) => void;
}

/**
 * Minimal conditional-rules editor. Each rule says "when {field} {op} {value},
 * make this field {visible/required}". Today evaluation is client-side only —
 * write-time server enforcement is a follow-up to FEAT-171.
 */
function FieldConditionsEditor({
  fieldId,
  conditions,
  availableFields,
  onChange,
}: FieldConditionsEditorProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  // Self-referential rules would loop on evaluation; exclude this field from the
  // "when" picker.
  const candidates = useMemo(() => availableFields.filter((f) => f.id !== fieldId), [availableFields, fieldId]);

  const updateRule = (idx: number, next: FieldConditionRule) => {
    const copy = [...conditions];
    copy[idx] = next;
    onChange(copy);
  };

  const addRule = () => {
    const firstOther = candidates[0];
    if (!firstOther) return;
    onChange([...conditions, { when: { fieldId: firstOther.id, op: 'present' }, then: { visible: true } }]);
  };

  const removeRule = (idx: number) => {
    onChange(conditions.filter((_, i) => i !== idx));
  };

  return (
    <div className="mt-3 pt-3 border-top">
      <div className="d-flex align-items-center justify-content-between mb-2">
        <Form.Label className="small fw-medium mb-0">{t('fieldsTab.conditionsTitle', 'Conditions')}</Form.Label>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary py-0 px-2"
          onClick={addRule}
          disabled={candidates.length === 0}
        >
          <i className="bi bi-plus" />
          {t('fieldsTab.conditionsAdd', 'Add condition')}
        </button>
      </div>
      {conditions.length === 0 && (
        <Form.Text className="text-muted d-block" style={{ fontSize: '0.7rem' }}>
          {t(
            'fieldsTab.conditionsHelp',
            'Conditional rules let this field show or become required only when another field has a particular value.'
          )}
        </Form.Text>
      )}
      {conditions.map((rule, idx) => {
        const whenField = availableFields.find((f) => f.id === rule.when.fieldId);
        const isSelectWhen =
          whenField?.fieldType === 'select' ||
          whenField?.fieldType === 'multiselect' ||
          whenField?.fieldType === 'multi_select';
        const valueOptions = whenField?.options ?? [];
        return (
          <div key={idx} className="d-flex flex-wrap gap-2 align-items-center small mb-2">
            <span className="text-muted">{t('fieldsTab.conditionsWhen', 'When')}</span>
            <Form.Select
              size="sm"
              style={{ maxWidth: 180 }}
              value={rule.when.fieldId}
              onChange={(e) =>
                updateRule(idx, {
                  ...rule,
                  when: { ...rule.when, fieldId: e.target.value, value: undefined },
                })
              }
            >
              {candidates.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Form.Select>
            <Form.Select
              size="sm"
              style={{ maxWidth: 100 }}
              value={rule.when.op}
              onChange={(e) =>
                updateRule(idx, {
                  ...rule,
                  when: { ...rule.when, op: e.target.value as FieldConditionRule['when']['op'] },
                })
              }
            >
              <option value="present">{t('fieldsTab.conditionsOpPresent', 'is set')}</option>
              <option value="eq">{t('fieldsTab.conditionsOpEq', 'equals')}</option>
              <option value="in">{t('fieldsTab.conditionsOpIn', 'is any of')}</option>
            </Form.Select>
            {rule.when.op !== 'present' &&
              (isSelectWhen && valueOptions.length > 0 ? (
                <Form.Select
                  size="sm"
                  style={{ maxWidth: 160 }}
                  value={String(rule.when.value ?? '')}
                  onChange={(e) => updateRule(idx, { ...rule, when: { ...rule.when, value: e.target.value } })}
                >
                  {valueOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </Form.Select>
              ) : (
                <Form.Control
                  size="sm"
                  style={{ maxWidth: 160 }}
                  type="text"
                  placeholder={t('fieldsTab.conditionsValuePlaceholder', 'value')}
                  value={String(rule.when.value ?? '')}
                  onChange={(e) => updateRule(idx, { ...rule, when: { ...rule.when, value: e.target.value } })}
                />
              ))}
            <span className="text-muted">{t('fieldsTab.conditionsThen', 'then')}</span>
            <Form.Check
              type="checkbox"
              id={`cond-visible-${fieldId}-${String(idx)}`}
              label={<span className="small">{t('fieldsTab.conditionsShow', 'show field')}</span>}
              checked={rule.then.visible === true}
              onChange={(e) =>
                updateRule(idx, {
                  ...rule,
                  then: { ...rule.then, visible: e.target.checked ? true : undefined },
                })
              }
            />
            <Form.Check
              type="checkbox"
              id={`cond-required-${fieldId}-${String(idx)}`}
              label={<span className="small">{t('fieldsTab.conditionsRequire', 'require')}</span>}
              checked={rule.then.required === true}
              onChange={(e) =>
                updateRule(idx, {
                  ...rule,
                  then: { ...rule.then, required: e.target.checked ? true : undefined },
                })
              }
            />
            <button
              type="button"
              className="btn btn-sm btn-link text-danger p-0"
              onClick={() => removeRule(idx)}
              title={t('common.remove')}
            >
              <i className="bi bi-x" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Add field dropdown ──────────────────────────────────────────────────────

interface AddFieldDropdownProps {
  ticketTypeId: string;
  allFields: FieldDefinition[];
  existingFieldIds: string[];
  onAddField: (ticketTypeId: string, fieldId: string) => void;
}

function AddFieldDropdown({
  ticketTypeId,
  allFields,
  existingFieldIds,
  onAddField,
}: AddFieldDropdownProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [search, setSearch] = useState('');

  const existingSet = useMemo(() => new Set(existingFieldIds), [existingFieldIds]);

  const availableFields = useMemo(() => {
    // Title / Description / Watchers render outside the sidebar — hide them
    // from the picker so users can't add them via this surface.
    const hidden = new Set(['field-name', 'field-description', 'field-watchers']);
    const filtered = allFields.filter((f) => !existingSet.has(f.id) && !hidden.has(f.id));
    if (search.trim()) {
      const q = search.toLowerCase();
      return filtered.filter((f) => f.name.toLowerCase().includes(q) || f.category.toLowerCase().includes(q));
    }
    return filtered;
  }, [allFields, existingSet, search]);

  const groupedFields = useMemo(() => {
    const groups: Record<string, FieldDefinition[]> = {};
    for (const f of availableFields) {
      const cat = f.category || 'general';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(f);
    }
    return groups;
  }, [availableFields]);

  if (allFields.length === existingFieldIds.length) {
    return (
      <span className="text-muted small fst-italic">
        {t('fieldsTab.noMoreFields', 'No more fields available to add.')}
      </span>
    );
  }

  return (
    <Dropdown>
      <Dropdown.Toggle size="sm" variant="outline-primary">
        <i className="bi bi-plus me-1" />
        {t('fieldsTab.addField')}
      </Dropdown.Toggle>
      <Dropdown.Menu style={{ maxHeight: 320, overflowY: 'auto', minWidth: 280 }}>
        <div className="px-3 py-2">
          <Form.Control
            size="sm"
            type="text"
            placeholder={t('fieldsTab.searchFields')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        {Object.keys(groupedFields).length === 0 && (
          <Dropdown.ItemText className="text-muted small">{t('common.noResults')}</Dropdown.ItemText>
        )}
        {Object.entries(groupedFields).map(([category, catFields]) => (
          <React.Fragment key={category}>
            <Dropdown.Header className="text-uppercase" style={{ fontSize: '0.65rem', letterSpacing: '0.5px' }}>
              {t(`globalSettings.fieldCategories.${category}`, { defaultValue: category })}
            </Dropdown.Header>
            {catFields.map((f) => (
              <Dropdown.Item key={f.id} onClick={() => onAddField(ticketTypeId, f.id)} className="small">
                <span className="me-2">{f.name}</span>
                <Badge bg="light" text="muted" style={{ fontSize: '0.6rem' }}>
                  {f.fieldType}
                </Badge>
              </Dropdown.Item>
            ))}
          </React.Fragment>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
}

// ─── Create new custom field (inline form) ──────────────────────────────────

const CREATABLE_FIELD_TYPES: FieldType[] = [
  'text',
  'textarea',
  'number',
  'currency',
  'date',
  'select',
  'multi_select',
  'url',
  'boolean',
];

interface CreateCustomFieldFormProps {
  defaultCategory: FieldCategory;
  onCancel: () => void;
  onCreate: (payload: {
    name: string;
    fieldType: FieldType;
    category: FieldCategory;
    options?: string[];
  }) => Promise<void>;
}

function CreateCustomFieldForm({ defaultCategory, onCancel, onCreate }: CreateCustomFieldFormProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [name, setName] = useState('');
  const [fieldType, setFieldType] = useState<FieldType>('text');
  const [optionsInput, setOptionsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsOptions = fieldType === 'select' || fieldType === 'multi_select';

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const parsedOptions = needsOptions
        ? optionsInput
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined;
      await onCreate({ name: name.trim(), fieldType, category: defaultCategory, options: parsedOptions });
    } catch (err) {
      setError(String(err));
      setSaving(false);
    }
  };

  return (
    <div className="border rounded p-3 bg-white mt-2">
      <div className="row g-2 align-items-end">
        <div className="col-12 col-md-5">
          <Form.Label className="small text-muted mb-1">{t('common.name')}</Form.Label>
          <Form.Control
            size="sm"
            autoFocus
            value={name}
            placeholder={t('fieldsTab.newFieldNamePlaceholder', 'e.g. Severity')}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleSubmit();
              }
              if (e.key === 'Escape') onCancel();
            }}
          />
        </div>
        <div className="col-6 col-md-3">
          <Form.Label className="small text-muted mb-1">{t('globalSettings.fieldType', 'Type')}</Form.Label>
          <Form.Select
            size="sm"
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as FieldType)}
            disabled={saving}
          >
            {CREATABLE_FIELD_TYPES.map((ft) => (
              <option key={ft} value={ft}>
                {ft}
              </option>
            ))}
          </Form.Select>
        </div>
        {needsOptions && (
          <div className="col-12 col-md-4">
            <Form.Label className="small text-muted mb-1">{t('globalSettings.options', 'Options')}</Form.Label>
            <Form.Control
              size="sm"
              value={optionsInput}
              placeholder="Red, Blue, Green"
              onChange={(e) => setOptionsInput(e.target.value)}
              disabled={saving}
            />
          </div>
        )}
      </div>
      {error && <div className="text-danger small mt-2">{error}</div>}
      <div className="d-flex justify-content-end gap-2 mt-2">
        <Button variant="outline-secondary" size="sm" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleSubmit()}
          disabled={saving || !name.trim() || (needsOptions && !optionsInput.trim())}
        >
          {saving ? t('common.saving', 'Saving…') : t('common.add')}
        </Button>
      </div>
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

/**
 * Per-ticket-type fields editor — used inside BoardSettingsModal (where it
 * drives per-board overrides + added fields) and inside GlobalSettingsModal
 * (where it drives the ticket type template's defaultFields list).
 *
 * The editor is mode-aware: `board` mode shows the visibility toggle and
 * customise pane; `global` mode is a simpler "what fields ship by default
 * with this template" picker.
 */
export function TicketTypeFieldsEditor({
  mode,
  ticketType,
  fields,
  fieldOverrides,
  addedFields,
  onFieldVisibleToggle,
  onFieldOverrideChange,
  onAddField,
  onRemoveAddedField,
  onMoveField,
  onDefaultFieldsChange,
  onCreateField,
  onSyncToTemplate,
}: TicketTypeFieldsEditorProps): React.JSX.Element {
  const { t } = useTranslation('ops');

  const added = mode === 'board' ? (addedFields?.[ticketType.id] ?? []) : [];

  /**
   * Compose the ordered list of fields shown for this ticket type. In board
   * mode we merge the type's defaultFields with this board's addedFields,
   * then sort by the override's `order` value when present. Reordering
   * assigns a dense `order` to every field so the next render is stable.
   */
  // Fields rendered outside the right sidebar (title input, description body,
  // unimplemented). Hide them from the editor entirely — they aren't
  // orderable from this surface.
  const HIDDEN_FROM_EDITOR = new Set(['field-name', 'field-description', 'field-watchers']);

  const orderedItems = useMemo(() => {
    // Board mode: resolveBoardFieldList returns the board's effective list
    //   — complete snapshot when populated, falls back to template defaults
    //   when the board hasn't customised the type, and merges legacy
    //   "extras on top" data transparently. The list itself IS the order.
    // Global mode: read from the template's defaultFields directly.
    const ids =
      mode === 'board'
        ? resolveBoardFieldList(ticketType, { [ticketType.id]: added })
        : [...(ticketType.defaultFields ?? [])];
    const items = ids
      .map((fId, originalIdx) => {
        if (HIDDEN_FROM_EDITOR.has(fId)) return null;
        // In board mode, fields that have been "removed" (visible=false)
        // disappear from the list. They reappear in the "+ Add field" picker.
        if (mode === 'board' && fieldOverrides?.[fId]?.visible === false) return null;
        const field = fields.find((f) => f.id === fId);
        if (!field) return null;
        return { field, isAdded: false, originalIdx };
      })
      .filter(Boolean) as { field: FieldDefinition; isAdded: boolean; originalIdx: number }[];
    return items;
  }, [ticketType, added, fields, fieldOverrides, mode]);

  const handleAdd = useCallback(
    (ticketTypeId: string, fieldId: string) => {
      if (mode === 'board') {
        // If the picked field is a hidden default, just unhide it — don't
        // create a duplicate entry in addedFields.
        const isDefault = (ticketType.defaultFields ?? []).includes(fieldId);
        const isHidden = fieldOverrides?.[fieldId]?.visible === false;
        if (isDefault && isHidden) {
          onFieldVisibleToggle?.(fieldId);
        } else {
          onAddField?.(ticketTypeId, fieldId);
        }
      } else {
        const next = [...(ticketType.defaultFields ?? []), fieldId];
        onDefaultFieldsChange?.(ticketTypeId, next);
      }
    },
    [mode, fieldOverrides, onAddField, onFieldVisibleToggle, onDefaultFieldsChange, ticketType.defaultFields]
  );

  const handleRemove = useCallback(
    (ticketTypeId: string, fieldId: string) => {
      if (mode === 'board') {
        // Added fields can be deleted outright. Default fields belong to the
        // template — we can't remove them from a single board, so X hides
        // them (visible=false). They reappear in the "+ Add field" picker.
        if (added.includes(fieldId)) {
          onRemoveAddedField?.(ticketTypeId, fieldId);
        } else {
          onFieldVisibleToggle?.(fieldId);
        }
      } else {
        const next = (ticketType.defaultFields ?? []).filter((id) => id !== fieldId);
        onDefaultFieldsChange?.(ticketTypeId, next);
      }
    },
    [mode, added, onRemoveAddedField, onFieldVisibleToggle, onDefaultFieldsChange, ticketType.defaultFields]
  );

  const existingFieldIds = useMemo(() => orderedItems.map((i) => i.field.id), [orderedItems]);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const handleCreate = useCallback(
    async (payload: { name: string; fieldType: FieldType; category: FieldCategory; options?: string[] }) => {
      if (!onCreateField) return;
      const newId = await onCreateField(payload);
      // Attach the freshly created field to this ticket type immediately so
      // the user sees it land in the editor without a second click.
      if (mode === 'board') {
        onAddField?.(ticketType.id, newId);
      } else {
        const next = [...(ticketType.defaultFields ?? []), newId];
        onDefaultFieldsChange?.(ticketType.id, next);
      }
      setShowCreateForm(false);
    },
    [mode, onAddField, onCreateField, onDefaultFieldsChange, ticketType.defaultFields, ticketType.id]
  );

  return (
    <div>
      {orderedItems.length === 0 && (
        <div className="text-muted small py-2 d-flex align-items-center gap-2">
          <i className="bi bi-info-circle" />
          <span>{t('fieldsTab.noFields')}</span>
        </div>
      )}

      {orderedItems.map(({ field, isAdded }, idx) => {
        const override = mode === 'board' ? fieldOverrides?.[field.id] : undefined;
        return (
          <FieldRow
            key={field.id}
            field={field}
            override={override}
            ticketTypeId={ticketType.id}
            index={idx}
            totalCount={orderedItems.length}
            isAdded={isAdded}
            mode={mode}
            availableConditionFields={orderedItems.map((i) => i.field)}
            onVisibleToggle={onFieldVisibleToggle}
            onOverrideChange={onFieldOverrideChange}
            onMove={(ttId, fromIdx, toIdx) => {
              if (mode === 'global') {
                // `fromIdx` / `toIdx` are indices in the *visible* list (i.e.
                // ticketType.defaultFields with HIDDEN_FROM_EDITOR filtered
                // out). Splice on the visible ids only, then stitch the
                // hidden ids back into their original positions so the data
                // shape is preserved.
                const original = ticketType.defaultFields ?? [];
                const visibleIds = original.filter((id) => !HIDDEN_FROM_EDITOR.has(id));
                if (fromIdx < 0 || fromIdx >= visibleIds.length) return;
                const [moved] = visibleIds.splice(fromIdx, 1);
                visibleIds.splice(Math.max(0, Math.min(toIdx, visibleIds.length)), 0, moved);
                let cursor = 0;
                const next = original.map((id) => (HIDDEN_FROM_EDITOR.has(id) ? id : (visibleIds[cursor++] ?? id)));
                onDefaultFieldsChange?.(ttId, next);
              } else {
                onMoveField(ttId, fromIdx, toIdx);
              }
            }}
            onRemove={handleRemove}
          />
        );
      })}

      <div className="mt-2 d-flex flex-wrap align-items-center gap-2">
        <AddFieldDropdown
          ticketTypeId={ticketType.id}
          allFields={fields}
          existingFieldIds={existingFieldIds}
          onAddField={handleAdd}
        />
        {onCreateField && !showCreateForm && (
          <Button size="sm" variant="outline-secondary" onClick={() => setShowCreateForm(true)}>
            <i className="bi bi-plus-circle me-1" />
            {t('fieldsTab.createNewCustomField', 'Create new custom field')}
          </Button>
        )}
        {mode === 'board' && onSyncToTemplate && (
          <Button
            size="sm"
            variant="outline-secondary"
            className="ms-auto"
            onClick={() => onSyncToTemplate(ticketType.id)}
            title={t(
              'fieldsTab.syncToTemplateHelp',
              "Replace this board's field list with the template's current defaults. Board-level overrides (label, options, etc.) are kept."
            )}
          >
            <i className="bi bi-arrow-clockwise me-1" />
            {t('fieldsTab.syncToTemplate', 'Sync to template')}
          </Button>
        )}
      </div>

      {onCreateField && showCreateForm && (
        <CreateCustomFieldForm
          defaultCategory={(ticketType.prefix?.toLowerCase() as FieldCategory) || ('common' as FieldCategory)}
          onCancel={() => setShowCreateForm(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
