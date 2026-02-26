/* eslint-disable i18next/no-literal-string */
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
    <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
      <h6 className="fw-bold text-dark mb-1">Ticket Types & Fields</h6>
      <p className="text-muted small mb-3">{t('settings.ticketsAndFieldsHelp')}</p>

      {sortedTypes.map((tt) => {
        const isEnabled = allowedTicketTypes.includes(tt.id);
        const isExpanded = expandedTypeId === tt.id;

        return (
          <div key={tt.id} className="card shadow-sm mb-3 border-0" style={{ border: '1px solid #e5e7eb' }}>
            <div
              className="card-body py-3 px-3 d-flex flex-column gap-2"
              role="button"
              style={{
                cursor: 'pointer',
                backgroundColor: '#f9fafb',
                borderBottom: isExpanded ? '1px solid #e5e7eb' : 'none',
              }}
              onClick={() => setExpandedTypeId(isExpanded ? null : tt.id)}
            >
              <div className="d-flex align-items-center gap-2">
                <i className={`${isExpanded ? 'bi bi-chevron-down' : 'bi bi-chevron-right'} text-muted`} />
                {tt.icon && <i className={`${getTicketTypeIconClass(tt.icon)} fs-5 text-primary`} />}
                <span className="fw-bold text-dark">{tt.name}</span>
                <Badge bg="secondary" text="white" className="fw-normal bg-opacity-75" style={{ fontSize: '0.7rem' }}>
                  {tt.prefix}
                </Badge>
                <div className="ms-auto" onClick={(e) => e.stopPropagation()}>
                  <Form.Check
                    type="switch"
                    id={`tt-enable-${tt.id}`}
                    label={<span className="fw-medium text-dark small">{t('settings.enabledOnBoard')}</span>}
                    checked={isEnabled}
                    onChange={() => onToggleTicketType(tt.id)}
                  />
                </div>
              </div>
            </div>

            {isExpanded && (
              <div className="card-body pt-3 px-4 pb-3 bg-white">
                <div className="d-flex align-items-center justify-content-between border-bottom pb-2 mb-2">
                  <small
                    className="fw-bold text-muted text-uppercase"
                    style={{ fontSize: '0.7rem', letterSpacing: '0.5px' }}
                  >
                    Field Name
                  </small>
                  <div className="d-flex gap-4">
                    <small
                      className="fw-bold text-muted text-uppercase"
                      style={{ fontSize: '0.7rem', letterSpacing: '0.5px', width: 60, textAlign: 'center' }}
                    >
                      {t('boardSettings.visible')}
                    </small>
                    <small
                      className="fw-bold text-muted text-uppercase"
                      style={{ fontSize: '0.7rem', letterSpacing: '0.5px', width: 60, textAlign: 'center' }}
                    >
                      {t('common.required')}
                    </small>
                  </div>
                </div>
                {fields.map((field) => {
                  const override = fieldOverrides[field.id] ?? { visible: true, required: false };
                  return (
                    <div key={field.id} className="d-flex align-items-center mb-1 py-2 border-bottom border-light">
                      <span className="flex-grow-1 small fw-medium text-dark">{field.name}</span>
                      <div className="d-flex gap-4">
                        <div style={{ width: 60, display: 'flex', justifyContent: 'center' }}>
                          <Form.Check
                            type="switch"
                            id={`field-visible-${tt.id}-${field.id}`}
                            checked={override.visible}
                            onChange={() => onFieldVisibleToggle(field.id)}
                          />
                        </div>
                        <div style={{ width: 60, display: 'flex', justifyContent: 'center' }}>
                          <Form.Check
                            type="switch"
                            id={`field-required-${tt.id}-${field.id}`}
                            checked={override.required}
                            onChange={() => onFieldRequiredToggle(field.id)}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
