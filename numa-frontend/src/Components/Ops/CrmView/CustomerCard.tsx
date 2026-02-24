import React, { useMemo } from 'react';
import { Card } from 'react-bootstrap';
import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import type { Customer, CrmConfig, CrmLifecycleStage } from '../../../types/ops';

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

/**
 * Formats an ISO date string into a human-friendly relative label.
 */
function formatLastContactLabel(
  dateStr: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!dateStr) return t('crm.noLastContact');

  const timestamp = new Date(dateStr).getTime();
  if (Number.isNaN(timestamp)) return t('crm.noLastContact');

  const diffMs = Date.now() - timestamp;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return t('crm.lastContactToday');
  if (diffDays === 1) return t('crm.lastContactYesterday');
  if (diffDays < 7) return t('crm.lastContactDaysAgo', { count: diffDays });
  if (diffDays < 30) return t('crm.lastContactWeeksAgo', { count: Math.floor(diffDays / 7) });
  if (diffDays < 365) return t('crm.lastContactMonthsAgo', { count: Math.floor(diffDays / 30) });
  return t('crm.lastContactYearsAgo', { count: Math.floor(diffDays / 365) });
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
  const lastContactLabel = useMemo(
    () => formatLastContactLabel(customer.lastContactDate, t),
    [customer.lastContactDate, t],
  );

  // Evaluate flags to display the orange dot
  const hasUpdatesOrRisk = customer.flags && customer.flags.length > 0;

  // Let's create a progress percentage for the bottom bar based on stage.
  // We'll mock it based on position (e.g. 1 out of 5 = 20%).
  const stagePosition = stage?.colorPosition ?? 1;
  const totalStages = Math.max(5, crmConfig.lifecycleStages.length);
  const progressPercent = Math.min(100, Math.max(10, (stagePosition / totalStages) * 100));

  return (
    <div ref={setNodeRef} style={dragStyle} className="mb-3">
      <Card
        {...attributes}
        {...listeners}
        style={{
          width: 280,
          border: isDragging ? '2px solid #fbbf24' : '2px solid transparent',
          borderRadius: 12,
          backgroundColor: '#ffffff',
          cursor: isDragging ? 'grabbing' : 'grab',
          transition: isDragging ? 'none' : 'all 0.15s ease',
          opacity: isDragging ? 0.9 : 1,
          boxShadow: isDragging ? '0 8px 24px rgba(251, 191, 36, 0.25)' : '0 2px 8px rgba(15, 23, 42, 0.04)',
          outline: '1px solid #e2e8f0',
          position: 'relative',
        }}
        onClick={() => onClick(customer)}
        onMouseEnter={(e) => {
          if (!isDragging) {
            (e.currentTarget as HTMLElement).style.outline = '1px solid #fbbf24';
            (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 2px #fef3c7, 0 4px 12px rgba(251, 191, 36, 0.15)';
          }
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.outline = '1px solid #e2e8f0';
          (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(15, 23, 42, 0.04)';
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
        <Card.Body className="p-3">
          <div className="d-flex align-items-start gap-3 mb-3">
            {/* Icon Box */}
            <div
              className="position-relative d-flex align-items-center justify-content-center flex-shrink-0"
              style={{
                width: 42,
                height: 42,
                backgroundColor: '#f3e8ff',
                color: '#8b5cf6',
                borderRadius: 10,
                fontSize: '1.2rem',
              }}
            >
              <i className="bi bi-building"></i>
              {hasUpdatesOrRisk && (
                <span
                  className="position-absolute translate-middle rounded-circle"
                  style={{
                    top: 0,
                    left: 0,
                    width: 10,
                    height: 10,
                    backgroundColor: '#f97316',
                    border: '2px solid #fff',
                  }}
                ></span>
              )}
            </div>

            {/* Title & Subtitle */}
            <div className="flex-grow-1 min-w-0">
              <div className="d-flex align-items-start justify-content-between gap-2">
                <div
                  className="fw-bold text-truncate"
                  title={customer.companyName}
                  style={{ color: '#1e293b', fontSize: '0.95rem', lineHeight: 1.2 }}
                >
                  {customer.companyName}
                </div>
                {/* Tickets badge like mockup */}
                {customer.openTicketCount > 0 && (
                  <div
                    className="flex-shrink-0 d-inline-flex align-items-center justify-content-center fw-bold"
                    style={{
                      backgroundColor: '#fef3c7',
                      color: '#d97706',
                      borderRadius: 6,
                      padding: '2px 6px',
                      fontSize: '0.7rem',
                    }}
                  >
                    <i className="bi bi-file-earmark-text me-1"></i>
                    {customer.openTicketCount}
                  </div>
                )}
              </div>
              <div className="text-muted small text-truncate mt-1" style={{ fontSize: '0.8rem' }}>
                {customer.industry || customer.companySize || 'Business'}
              </div>
            </div>
          </div>

          {/* Footer stats: Contract Value & Last Contact */}
          <div
            className="d-flex align-items-center justify-content-between mb-3 text-muted"
            style={{ minHeight: '1.2rem' }}
          >
            <div className="fw-bold" style={{ color: '#10b981', fontSize: '0.9rem' }}>
              {customer.contractValue != null && customer.contractValue > 0
                ? formatCurrency(customer.contractValue)
                : ''}
            </div>
            {customer.lastContactDate ? (
              <div style={{ fontSize: '0.75rem' }}>
                <i className="bi bi-clock me-1"></i>
                {lastContactLabel}
              </div>
            ) : (
              <div style={{ fontSize: '0.75rem' }}>{lastContactLabel}</div>
            )}
          </div>

          {/* Progress Line */}
          <div
            style={{
              height: 4,
              backgroundColor: '#f1f5f9',
              borderRadius: 2,
              width: '100%',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                backgroundColor: '#f59e0b',
                width: `${progressPercent}%`,
                borderRadius: 2,
              }}
            />
          </div>
        </Card.Body>
      </Card>
    </div>
  );
}
