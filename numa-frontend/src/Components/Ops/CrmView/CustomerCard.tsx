import React from 'react';
import { Card, Badge } from 'react-bootstrap';
import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import type { Customer, CrmConfig, CrmLifecycleStage } from '../../../types/ops';
import { getColorForPosition, getContrastTextColor } from '../Shared/colorUtils';

// ─── Props ──────────────────────────────────────────────────────────────────

interface CustomerCardProps {
  customer: Customer;
  crmConfig: CrmConfig;
  onClick: (customer: Customer) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Formats a number as currency (USD). Returns an empty string for null/undefined.
 */
function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * CustomerCard renders a compact draggable card for a customer within a
 * kanban column.
 *
 * Shows the company name (bold, truncated), flag icons, industry, contract
 * value, open ticket badge, and primary contact name/role. The bottom border
 * is colored according to the customer's lifecycle stage position.
 *
 * The card is a DnD-kit draggable using the customer's ID as the drag
 * identifier. Clicking (without dragging) opens the detail modal.
 */
export function CustomerCard({ customer, crmConfig, onClick }: CustomerCardProps): React.JSX.Element {
  const { t } = useTranslation('ops');

  // ── DnD-kit draggable ────────────────────────────────────────────────
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: customer.id,
  });

  const dragStyle: React.CSSProperties = transform
    ? { transform: `translate3d(${String(transform.x)}px, ${String(transform.y)}px, 0)` }
    : {};

  // Resolve the lifecycle stage for the bottom border color.
  const stage: CrmLifecycleStage | undefined = crmConfig.lifecycleStages.find((s) => s.id === customer.lifecycleStage);
  const stageColor = stage ? getColorForPosition(stage.colorPosition) : '#6c757d';

  // Find the primary contact (first one flagged as primary).
  const primaryContact = customer.contacts.find((c) => c.isPrimary) ?? null;

  // Resolve flags from config.
  const resolvedFlags = customer.flags
    .map((flagId) => crmConfig.customerFlags.find((f) => f.id === flagId))
    .filter((f): f is NonNullable<typeof f> => f != null);

  return (
    <div ref={setNodeRef} style={dragStyle} {...attributes} {...listeners}>
      <Card
        className="mb-2 border"
        style={{
          width: 220,
          cursor: isDragging ? 'grabbing' : 'grab',
          borderBottom: `3px solid ${stageColor}`,
          transition: isDragging ? 'none' : 'box-shadow 0.15s ease',
          opacity: isDragging ? 0.5 : 1,
        }}
        onClick={() => {
          if (!isDragging) onClick(customer);
        }}
        onMouseEnter={(e) => {
          if (!isDragging) {
            (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
          }
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.boxShadow = 'none';
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(customer);
          }
        }}
      >
        <Card.Body className="p-2">
          {/* Company name */}
          <div className="fw-bold small text-truncate mb-1" title={customer.companyName}>
            {customer.companyName}
          </div>

          {/* Flag icons */}
          {resolvedFlags.length > 0 && (
            <div className="d-flex flex-wrap gap-1 mb-1">
              {resolvedFlags.map((flag) => (
                <span
                  key={flag.id}
                  title={flag.name}
                  className="d-inline-flex align-items-center justify-content-center rounded-1"
                  style={{
                    backgroundColor: flag.color,
                    color: getContrastTextColor(flag.color),
                    width: 20,
                    height: 20,
                    fontSize: '0.7rem',
                  }}
                >
                  {flag.icon ? <i className={`bi bi-${flag.icon}`} /> : flag.name.charAt(0).toUpperCase()}
                </span>
              ))}
            </div>
          )}

          {/* Industry */}
          {customer.industry && <div className="text-muted small text-truncate mb-1">{customer.industry}</div>}

          {/* Contract value */}
          {customer.contractValue != null && customer.contractValue > 0 && (
            <div className="small fw-semibold mb-1">{formatCurrency(customer.contractValue)}</div>
          )}

          {/* Open ticket count */}
          {customer.openTicketCount > 0 && (
            <Badge bg="warning" text="dark" className="me-1 mb-1" style={{ fontSize: '0.7rem' }}>
              {customer.openTicketCount} {t('tickets.count', { count: customer.openTicketCount })}
            </Badge>
          )}

          {/* Primary contact */}
          {primaryContact && (
            <div className="small text-muted text-truncate">
              <i className="bi bi-person me-1" />
              {primaryContact.name}
              {primaryContact.role && <span className="ms-1">({primaryContact.role})</span>}
            </div>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}
