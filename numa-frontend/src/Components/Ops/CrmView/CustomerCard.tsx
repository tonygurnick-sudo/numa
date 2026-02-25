import React, { useMemo } from 'react';
import { Card } from 'react-bootstrap';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import type { Customer, CrmConfig, CrmLifecycleStage } from '../../../types/ops';
import { getColorForPosition } from '../Shared/colorUtils';

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

  // ── DnD-kit sortable ────────────────────────────────────────────────
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: customer.id,
    data: { customer },
  });

  const dragStyle: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : 'auto',
  };

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
    <div ref={setNodeRef} style={dragStyle} className="mb-3" {...attributes} {...listeners}>
      <Card
        style={{
          width: '100%',
          border: isDragging ? '2px solid rgba(139, 92, 246, 0.8)' : '1px solid rgba(226, 232, 240, 0.8)',
          borderRadius: 16,
          backgroundColor: '#ffffff',
          cursor: isDragging ? 'grabbing' : 'pointer',
          transition: isDragging
            ? 'none'
            : 'box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s',
          opacity: isDragging ? 0.9 : 1,
          boxShadow: isDragging
            ? '0 20px 25px -5px rgba(139, 92, 246, 0.15), 0 8px 10px -6px rgba(139, 92, 246, 0.1)'
            : '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.025)',
          position: 'relative',
          overflow: 'hidden',
        }}
        onClick={() => onClick(customer)}
        onMouseEnter={(e) => {
          if (!isDragging) {
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(139, 92, 246, 0.5)';
            (e.currentTarget as HTMLElement).style.boxShadow =
              '0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.04), 0 0 0 3px rgba(139, 92, 246, 0.1)';
            (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isDragging) {
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(226, 232, 240, 0.8)';
            (e.currentTarget as HTMLElement).style.boxShadow =
              '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.025)';
            (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
          }
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
        <Card.Body className="p-3 d-flex flex-column h-100">
          <div className="d-flex align-items-start gap-3 mb-3 flex-grow-1">
            {/* Icon Box */}
            <div
              className="position-relative d-flex align-items-center justify-content-center flex-shrink-0 shadow-sm"
              style={{
                width: 46,
                height: 46,
                backgroundColor: 'rgba(249, 250, 251, 0.8)',
                color: '#64748b',
                borderRadius: 14,
                fontSize: '1.25rem',
                border: '1px solid rgba(226, 232, 240, 0.8)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <i className="bi bi-building"></i>
              {hasUpdatesOrRisk && (
                <span
                  className="position-absolute translate-middle rounded-circle shadow-sm"
                  style={{
                    top: 2,
                    left: 2,
                    width: 12,
                    height: 12,
                    backgroundColor: '#fbbf24',
                    border: '2px solid #fff',
                  }}
                ></span>
              )}
            </div>

            {/* Title & Subtitle */}
            <div className="flex-grow-1 min-w-0">
              <div className="d-flex align-items-start justify-content-between gap-2">
                <div
                  className="fw-bolder text-truncate"
                  title={customer.companyName}
                  style={{ color: '#0f172a', fontSize: '1rem', lineHeight: 1.2, letterSpacing: '-0.01em' }}
                >
                  {customer.companyName}
                </div>
                {/* Tickets badge like mockup */}
                {customer.openTicketCount > 0 && (
                  <div
                    className="flex-shrink-0 d-inline-flex align-items-center justify-content-center fw-bold shadow-sm"
                    style={{
                      backgroundColor: '#fffbeb',
                      color: '#d97706',
                      borderRadius: 8,
                      padding: '3px 8px',
                      fontSize: '0.75rem',
                      border: '1px solid #fde68a',
                    }}
                  >
                    <i className="bi bi-file-earmark-text me-1"></i>
                    {customer.openTicketCount}
                  </div>
                )}
              </div>
              <div
                className="text-muted small text-truncate mt-1 fw-medium"
                style={{ fontSize: '0.82rem', color: '#64748b' }}
              >
                {customer.industry || customer.companySize || 'Business'}
              </div>
            </div>
          </div>

          {/* Footer stats: Contract Value & Last Contact */}
          <div
            className="d-flex align-items-center justify-content-between mb-3 text-muted mt-auto"
            style={{ minHeight: '1.2rem' }}
          >
            <div className="fw-bolder" style={{ color: '#059669', fontSize: '0.95rem' }}>
              {customer.contractValue != null && customer.contractValue > 0
                ? formatCurrency(customer.contractValue)
                : ''}
            </div>
            {customer.lastContactDate ? (
              <div className="fw-medium" style={{ fontSize: '0.78rem', color: '#64748b' }}>
                <i className="bi bi-clock me-1 opacity-75"></i>
                {lastContactLabel}
              </div>
            ) : (
              <div className="fw-medium" style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                {lastContactLabel}
              </div>
            )}
          </div>

          {/* Progress Line */}
          <div
            className="shadow-inner"
            style={{
              height: 5,
              backgroundColor: '#f1f5f9',
              borderRadius: 3,
              width: '100%',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                backgroundColor: stage?.colorPosition ? getColorForPosition(stage.colorPosition) : '#8b5cf6',
                width: `${String(progressPercent)}%`,
                borderRadius: 3,
                transition: 'width 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            />
          </div>
        </Card.Body>
      </Card>
    </div>
  );
}
