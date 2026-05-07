import React, { useState, useMemo, useCallback } from 'react';
import { Form, Badge, Dropdown, Collapse } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { TicketType, FieldDefinition, FieldOverride } from '../../../../types/ops';
import { getTicketTypeIconClass } from '../../../../constants/opsConstants';

interface TicketsFieldsTabProps {
  ticketTypes: TicketType[];
  fields: FieldDefinition[];
  allowedTicketTypes: string[];
  onToggleTicketType: (typeId: string) => void;
  fieldOverrides: Record<string, FieldOverride>;
  addedFields: Record<string, string[]>;
  onFieldVisibleToggle: (fieldId: string) => void;
  /** @deprecated Required toggle is now inside the Customise panel via onFieldOverrideChange */
  onFieldRequiredToggle?: (fieldId: string) => void;
  onFieldOverrideChange: (fieldId: string, changes: Partial<FieldOverride>) => void;
  onAddField: (ticketTypeId: string, fieldId: string) => void;
  onRemoveAddedField: (ticketTypeId: string, fieldId: string) => void;
  onReorderField: (ticketTypeId: string, fieldId: string, direction: 'up' | 'down') => void;
}

// ─── Field Row ───────────────────────────────────────────────────────────────

interface FieldRowProps {
  field: FieldDefinition;
  override: FieldOverride;
  ticketTypeId: string;
  index: number;
  isAdded: boolean;
  onVisibleToggle: (fieldId: string) => void;
  onOverrideChange: (fieldId: string, changes: Partial<FieldOverride>) => void;
  onReorder: (ticketTypeId: string, fieldId: string, direction: 'up' | 'down') => void;
  onRemove: (ticketTypeId: string, fieldId: string) => void;
}

function FieldRow({
  field,
  override,
  ticketTypeId,
  index,
  isAdded,
  onVisibleToggle,
  onOverrideChange,
  onReorder,
  onRemove,
}: FieldRowProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [showCustomise, setShowCustomise] = useState(false);
  const [customLabel, setCustomLabel] = useState(override.label ?? '');
  const [customOptions, setCustomOptions] = useState((override.options ?? field.options ?? []).join(', '));

  const isSelectType =
    field.fieldType === 'select' || field.fieldType === 'multiselect' || field.fieldType === 'multi_select';
  const displayName = override.label || field.name;

  const handleSaveCustomise = useCallback(() => {
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

  return (
    <div style={{ borderBottom: '1px solid #f3f4f6' }}>
      <div
        className="d-flex align-items-center py-2 px-2 rounded"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', `${field.id}::${String(index)}`);
          e.dataTransfer.effectAllowed = 'move';
          (e.currentTarget as HTMLElement).style.opacity = '0.4';
        }}
        onDragEnd={(e) => {
          (e.currentTarget as HTMLElement).style.opacity = '1';
        }}
        onDragOver={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).style.backgroundColor = '#eef2ff';
          (e.currentTarget as HTMLElement).style.borderLeft = '3px solid #6366f1';
        }}
        onDragLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = '';
          (e.currentTarget as HTMLElement).style.borderLeft = '';
        }}
        onDrop={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).style.backgroundColor = '';
          (e.currentTarget as HTMLElement).style.borderLeft = '';
          const data = e.dataTransfer.getData('text/plain');
          const [draggedId, draggedIdxStr] = data.split('::');
          const draggedIdx = parseInt(draggedIdxStr, 10);
          if (draggedId && draggedId !== field.id && !isNaN(draggedIdx)) {
            // Move the dragged field step by step to the target position
            const steps = Math.abs(draggedIdx - index);
            const dir = draggedIdx < index ? 'down' : 'up';
            for (let i = 0; i < steps; i++) {
              onReorder(ticketTypeId, draggedId, dir);
            }
          }
        }}
        style={{ cursor: 'grab', backgroundColor: 'white' }}
      >
        {/* Drag handle */}
        <i className="bi bi-grip-vertical text-muted me-2" style={{ fontSize: '0.85rem', opacity: 0.5 }} />

        {/* Field name */}
        <span className="flex-grow-1 small fw-medium" style={{ color: '#1f2937' }}>
          {displayName}
          {override.label && (
            <span className="text-muted ms-1" style={{ fontSize: '0.7rem' }}>
              ({field.name})
            </span>
          )}
          {isAdded && (
            <Badge bg="info" text="white" className="ms-2 fw-normal" style={{ fontSize: '0.6rem' }}>
              {t('fieldsTab.added')}
            </Badge>
          )}
        </span>

        {/* Action buttons */}
        <div className="d-flex align-items-center gap-2">
          {/* Visible toggle */}
          <div style={{ width: 50, display: 'flex', justifyContent: 'center' }}>
            <Form.Check
              type="switch"
              id={`field-visible-${ticketTypeId}-${field.id}`}
              checked={override.visible}
              onChange={() => onVisibleToggle(field.id)}
            />
          </div>

          {/* Customise button */}
          <button
            type="button"
            className={`btn btn-sm py-0 px-2 ${showCustomise ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowCustomise(!showCustomise);
            }}
            style={{ fontSize: '0.7rem' }}
            title={t('fieldsTab.customise')}
          >
            <i className="bi bi-gear me-1" />
            {t('fieldsTab.customise')}
          </button>

          {/* Remove button for added fields */}
          {isAdded && (
            <button
              type="button"
              className="btn btn-sm btn-outline-danger py-0 px-2"
              onClick={() => onRemove(ticketTypeId, field.id)}
              style={{ fontSize: '0.7rem' }}
              title={t('common.remove')}
            >
              <i className="bi bi-x-lg" />
            </button>
          )}
        </div>
      </div>

      {/* Customise panel */}
      <Collapse in={showCustomise}>
        <div>
          <div className="bg-light rounded-2 p-3 mb-2 ms-4">
            <div className="row g-3">
              {/* Custom label */}
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

              {/* Required toggle */}
              <div className="col-sm-6 d-flex align-items-center pt-sm-4">
                <Form.Check
                  type="switch"
                  id={`field-required-${ticketTypeId}-${field.id}`}
                  label={<span className="small fw-medium">{t('common.required')}</span>}
                  checked={override.required}
                  onChange={() => onOverrideChange(field.id, { required: !override.required })}
                />
              </div>

              {/* Options for select fields */}
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

            <div className="d-flex justify-content-end gap-2 mt-3">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => {
                  setCustomLabel(override.label ?? '');
                  setCustomOptions((override.options ?? field.options ?? []).join(', '));
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
    </div>
  );
}

// ─── Add Field Dropdown ──────────────────────────────────────────────────────

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
    const filtered = allFields.filter((f) => !existingSet.has(f.id));
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
    return <></>;
  }

  return (
    <Dropdown>
      <Dropdown.Toggle variant="outline-secondary" size="sm" className="mt-2">
        <i className="bi bi-plus-lg me-1" />
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

// ─── Main Tab ────────────────────────────────────────────────────────────────

export function TicketsFieldsTab({
  ticketTypes,
  fields,
  allowedTicketTypes,
  onToggleTicketType,
  fieldOverrides,
  addedFields,
  onFieldVisibleToggle,
  onFieldOverrideChange,
  onAddField,
  onRemoveAddedField,
  onReorderField,
}: TicketsFieldsTabProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [expandedTypeId, setExpandedTypeId] = useState<string | null>(null);

  const sortedTypes = useMemo(() => [...ticketTypes].sort((a, b) => a.order - b.order), [ticketTypes]);

  // Build the ordered field list for a ticket type, respecting order overrides
  const getOrderedFields = useCallback(
    (tt: TicketType): { field: FieldDefinition; isAdded: boolean }[] => {
      const added = addedFields[tt.id] ?? [];
      const allFieldIds = [...(tt.defaultFields ?? []), ...added];

      const items = allFieldIds
        .map((fId) => {
          const field = fields.find((f) => f.id === fId);
          if (!field) return null;
          return { field, isAdded: added.includes(fId) };
        })
        .filter(Boolean) as { field: FieldDefinition; isAdded: boolean }[];

      // Sort by order override if present
      items.sort((a, b) => {
        const orderA = fieldOverrides[a.field.id]?.order;
        const orderB = fieldOverrides[b.field.id]?.order;
        if (orderA != null && orderB != null) return orderA - orderB;
        if (orderA != null) return -1;
        if (orderB != null) return 1;
        return 0;
      });

      return items;
    },
    [fields, addedFields, fieldOverrides]
  );

  return (
    <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
      <h6 className="fw-bold text-dark mb-1">{t('fieldsTab.title')}</h6>
      <p className="text-muted small mb-3">{t('settings.ticketsAndFieldsHelp')}</p>

      {sortedTypes.map((tt) => {
        const isEnabled = allowedTicketTypes.includes(tt.id);
        const isExpanded = expandedTypeId === tt.id;
        const orderedFields = getOrderedFields(tt);
        const added = addedFields[tt.id] ?? [];
        const existingFieldIds = [...(tt.defaultFields ?? []), ...added];

        return (
          <div
            key={tt.id}
            className="card mb-3"
            style={{ border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
          >
            <div
              className="card-body py-3 px-4 d-flex flex-column"
              role="button"
              style={{
                cursor: 'pointer',
                backgroundColor: '#f9fafb',
                borderBottom: isExpanded ? '1px solid #e5e7eb' : 'none',
              }}
              onClick={() => setExpandedTypeId(isExpanded ? null : tt.id)}
            >
              <div className="d-flex align-items-center">
                <i
                  className={`${isExpanded ? 'bi bi-chevron-down' : 'bi bi-chevron-right'} text-muted`}
                  style={{ width: 20, flexShrink: 0 }}
                />
                {tt.icon && (
                  <i
                    className={`${getTicketTypeIconClass(tt.icon)} fs-5 me-2`}
                    style={{ color: tt.color || '#6366f1', width: 24, flexShrink: 0, textAlign: 'center' }}
                  />
                )}
                <span className="fw-bold text-dark me-3">{tt.name}</span>
                <Badge
                  bg="secondary"
                  text="white"
                  className="fw-normal bg-opacity-75 me-2"
                  style={{ fontSize: '0.7rem' }}
                >
                  {tt.prefix}
                </Badge>
                <span className="text-muted small">{t('fieldsTab.fieldCount', { count: orderedFields.length })}</span>
                <div className="ms-auto ps-3 d-flex align-items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <Form.Check
                    type="switch"
                    id={`tt-enable-${tt.id}`}
                    checked={isEnabled}
                    onChange={() => onToggleTicketType(tt.id)}
                    className="me-1"
                  />
                  <span className="fw-medium text-dark small" style={{ whiteSpace: 'nowrap' }}>
                    {t('settings.enabledOnBoard')}
                  </span>
                </div>
              </div>
            </div>

            {isExpanded && (
              <div className="card-body pt-3 px-4 pb-3 bg-white">
                {/* Column headers */}
                <div className="d-flex align-items-center justify-content-between border-bottom pb-2 mb-2">
                  <small
                    className="fw-bold text-muted text-uppercase ms-3"
                    style={{ fontSize: '0.7rem', letterSpacing: '0.5px' }}
                  >
                    {t('fieldsTab.fieldName')}
                  </small>
                  <div className="d-flex gap-2 align-items-center">
                    <small
                      className="fw-bold text-muted text-uppercase"
                      style={{ fontSize: '0.7rem', letterSpacing: '0.5px', width: 50, textAlign: 'center' }}
                    >
                      {t('boardSettings.visible')}
                    </small>
                    <small
                      className="fw-bold text-muted text-uppercase"
                      style={{ fontSize: '0.7rem', letterSpacing: '0.5px', width: 80, textAlign: 'center' }}
                    >
                      {t('fieldsTab.actions')}
                    </small>
                  </div>
                </div>

                {orderedFields.length === 0 && (
                  <div className="text-muted small py-2 d-flex align-items-center gap-2">
                    <i className="bi bi-info-circle" />
                    <span>{t('fieldsTab.noFields')}</span>
                  </div>
                )}

                {orderedFields.map(({ field, isAdded }, idx) => {
                  const override = fieldOverrides[field.id] ?? { visible: true, required: false };
                  return (
                    <FieldRow
                      key={field.id}
                      field={field}
                      override={override}
                      ticketTypeId={tt.id}
                      index={idx}
                      isAdded={isAdded}
                      onVisibleToggle={onFieldVisibleToggle}
                      onOverrideChange={onFieldOverrideChange}
                      onReorder={onReorderField}
                      onRemove={onRemoveAddedField}
                    />
                  );
                })}

                {/* Add Field dropdown */}
                <AddFieldDropdown
                  ticketTypeId={tt.id}
                  allFields={fields}
                  existingFieldIds={existingFieldIds}
                  onAddField={onAddField}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
