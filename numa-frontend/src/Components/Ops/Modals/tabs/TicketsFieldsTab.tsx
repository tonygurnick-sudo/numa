import React, { useState, useMemo } from 'react';
import { Form, Badge } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { TicketType, FieldDefinition, FieldOverride } from '../../../../types/ops';
import { getTicketTypeIconClass } from '../../../../constants/opsConstants';

interface TicketsFieldsTabProps {
  ticketTypes: TicketType[];
  fields: FieldDefinition[];
  allowedTicketTypes: string[];
  onToggleTicketType: (typeId: string) => void;
  fieldOverrides: Record<string, FieldOverride>;
  onFieldVisibleToggle: (fieldId: string) => void;
  onFieldRequiredToggle: (fieldId: string) => void;
}

export function TicketsFieldsTab({
  ticketTypes,
  fields,
  allowedTicketTypes,
  onToggleTicketType,
  fieldOverrides,
  onFieldVisibleToggle,
  onFieldRequiredToggle,
}: TicketsFieldsTabProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [expandedTypeId, setExpandedTypeId] = useState<string | null>(null);

  const sortedTypes = useMemo(() => [...ticketTypes].sort((a, b) => a.order - b.order), [ticketTypes]);

  return (
    <>
      <p className="text-muted small mb-3">{t('settings.ticketsAndFieldsHelp')}</p>

      {sortedTypes.map((tt) => {
        const isEnabled = allowedTicketTypes.includes(tt.id);
        const isExpanded = expandedTypeId === tt.id;

        return (
          <div key={tt.id} className="card mb-2">
            <div
              className="card-body py-2 px-3"
              role="button"
              style={{ cursor: 'pointer' }}
              onClick={() => setExpandedTypeId(isExpanded ? null : tt.id)}
            >
              <div className="d-flex align-items-center gap-2">
                <i className={isExpanded ? 'bi bi-chevron-down' : 'bi bi-chevron-right'} />
                {tt.icon && <i className={getTicketTypeIconClass(tt.icon)} />}
                <span className="fw-semibold">{tt.name}</span>
                <Badge bg="light" text="dark" className="fw-normal" style={{ fontSize: '0.7rem' }}>
                  {tt.prefix}
                </Badge>
                <div className="ms-auto" onClick={(e) => e.stopPropagation()}>
                  <Form.Check
                    type="switch"
                    id={`tt-enable-${tt.id}`}
                    label={t('settings.enabledOnBoard')}
                    checked={isEnabled}
                    onChange={() => onToggleTicketType(tt.id)}
                    className="small"
                  />
                </div>
              </div>
            </div>

            {isExpanded && (
              <div className="card-body border-top pt-2 px-3 pb-2">
                <small className="text-muted d-block mb-2">{t('settings.fieldVisibility')}</small>
                {fields.map((field) => {
                  const override = fieldOverrides[field.id] ?? { visible: true, required: false };
                  return (
                    <div key={field.id} className="d-flex align-items-center gap-3 mb-1 py-1 border-bottom">
                      <span className="flex-grow-1 small">{field.name}</span>
                      <Form.Check
                        type="switch"
                        id={`field-visible-${tt.id}-${field.id}`}
                        label={t('boardSettings.visible')}
                        checked={override.visible}
                        onChange={() => onFieldVisibleToggle(field.id)}
                        className="small"
                      />
                      <Form.Check
                        type="switch"
                        id={`field-required-${tt.id}-${field.id}`}
                        label={t('common.required')}
                        checked={override.required}
                        onChange={() => onFieldRequiredToggle(field.id)}
                        className="small"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
