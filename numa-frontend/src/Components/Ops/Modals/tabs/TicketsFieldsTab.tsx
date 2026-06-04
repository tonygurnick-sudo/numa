import React, { useMemo, useState } from 'react';
import { Badge, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { FieldCategory, FieldDefinition, FieldOverride, FieldType, TicketType } from '../../../../types/ops';
import { getTicketTypeIconClass } from '../../../../constants/opsConstants';
import { resolveBoardFieldList } from '../../Shared/fieldResolution';
import { TicketTypeFieldsEditor } from '../TicketTypeFieldsEditor';

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
  /**
   * Reorder a single field to a new index within the merged
   * [defaultFields, ...addedFields] list. Cross-group moves (core/CRM/custom)
   * are intentionally allowed — the group is metadata only, not a movement
   * boundary (FEAT-171).
   */
  onMoveField: (ticketTypeId: string, fromIdx: number, toIdx: number) => void;
  /**
   * Persist a brand-new global field. Wired by the parent so the field is
   * saved to /config/fields with duplicate-name detection, then surfaces in
   * config.fields on the next refresh. Returning the id lets the editor
   * attach it to addedFields immediately.
   */
  onCreateField?: (payload: {
    name: string;
    fieldType: FieldType;
    category: FieldCategory;
    options?: string[];
  }) => Promise<string>;
  /**
   * Replace this board's snapshot for a ticket type with the template's
   * current defaultFields. Manual opt-in to template changes.
   */
  onSyncToTemplate?: (ticketTypeId: string) => void;
}

/**
 * Board Settings → Tickets & Fields tab. Wraps the per-type editor with the
 * board-level "enable on board" toggle. The per-type editor itself lives in
 * TicketTypeFieldsEditor so the same UI can be reused from Global Settings.
 */
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
  onMoveField,
  onCreateField,
  onSyncToTemplate,
}: TicketsFieldsTabProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [expandedTypeId, setExpandedTypeId] = useState<string | null>(null);

  const sortedTypes = useMemo(() => [...ticketTypes].sort((a, b) => a.order - b.order), [ticketTypes]);

  return (
    <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
      <h6 className="fw-bold text-dark mb-1">{t('fieldsTab.title')}</h6>
      <p className="text-muted small mb-3">{t('settings.ticketsAndFieldsHelp')}</p>

      {sortedTypes.map((tt) => {
        const isEnabled = allowedTicketTypes.includes(tt.id);
        const isExpanded = expandedTypeId === tt.id;
        // The visible count must match what the editor actually renders, so
        // we read the same effective list via resolveBoardFieldList (handles
        // complete-snapshot vs legacy "extras only" shapes vs no entry),
        // then drop ids hidden from the editor surface (title / description /
        // watchers render elsewhere), ids the board has hidden via
        // override.visible=false, and any stale ids whose FieldDefinition no
        // longer exists in config.fields.
        const list = resolveBoardFieldList(tt, addedFields);
        const HIDDEN_IDS = new Set(['field-name', 'field-description', 'field-watchers']);
        const fieldIds = new Set(fields.map((f) => f.id));
        const totalFields = list.filter(
          (id) => !HIDDEN_IDS.has(id) && fieldOverrides[id]?.visible !== false && fieldIds.has(id)
        ).length;

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
                <span className="text-muted small">{t('fieldsTab.fieldCount', { count: totalFields })}</span>
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
                <TicketTypeFieldsEditor
                  mode="board"
                  ticketType={tt}
                  fields={fields}
                  fieldOverrides={fieldOverrides}
                  addedFields={addedFields}
                  onFieldVisibleToggle={onFieldVisibleToggle}
                  onFieldOverrideChange={onFieldOverrideChange}
                  onAddField={onAddField}
                  onRemoveAddedField={onRemoveAddedField}
                  onMoveField={onMoveField}
                  onCreateField={onCreateField}
                  onSyncToTemplate={onSyncToTemplate}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
