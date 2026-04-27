import React, { useMemo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import type { Customer, CrmConfig, CrmLifecycleStage, StaffProfile } from '../../../types/ops';
import { getColorForPosition } from '../Shared/colorUtils';
import { StaffAvatar } from '../Shared/StaffAvatar';

// ─── Props ──────────────────────────────────────────────────────────────────

interface CustomerCardProps {
  customer: Customer;
  crmConfig: CrmConfig;
  staff?: StaffProfile[];
  onClick: (customer: Customer) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatLastContactLabel(
  dateStr: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
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
 * kanban column -- styled to match the board TicketCard density.
 */
export const CustomerCard = React.memo(function CustomerCard({
  customer,
  crmConfig,
  staff,
  onClick,
}: CustomerCardProps): React.JSX.Element {
  const { t } = useTranslation('ops');

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

  const stage: CrmLifecycleStage | undefined = crmConfig.lifecycleStages.find((s) => s.id === customer.lifecycleStage);
  const stageColor = stage?.colorPosition ? getColorForPosition(stage.colorPosition) : '#8b5cf6';

  const lastContactLabel = useMemo(
    () => formatLastContactLabel(customer.lastContactDate, t),
    [customer.lastContactDate, t]
  );

  const ownerStaff = useMemo(
    () => (customer.ownerId ? staff?.find((s) => s.id === customer.ownerId) : undefined),
    [customer.ownerId, staff]
  );

  const hasFlags = customer.flags && customer.flags.length > 0;
  const contractStr =
    customer.contractValue != null && customer.contractValue > 0 ? formatCurrency(customer.contractValue) : '';

  return (
    <div ref={setNodeRef} style={dragStyle} {...attributes} {...listeners}>
      <div
        className={`ticket-card${isDragging ? ' ticket-card--dragging' : ''}`}
        style={{ borderLeft: `3px solid ${stageColor}` }}
        onClick={() => onClick(customer)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(customer);
          }
        }}
      >
        {/* Title row */}
        <div className="d-flex align-items-start gap-2" style={{ marginBottom: 6 }}>
          {customer.logoPresignedUrl && (
            <img
              src={customer.logoPresignedUrl}
              alt=""
              className="flex-shrink-0"
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                objectFit: 'cover',
                border: '1px solid #e5e7eb',
              }}
            />
          )}
          <div className="ticket-title flex-grow-1" style={{ margin: 0, minWidth: 0 }} title={customer.companyName}>
            {customer.companyName}
          </div>
          {customer.openTicketCount > 0 && (
            <span className="ticket-badge flex-shrink-0" style={{ fontSize: '0.67rem' }}>
              <i className="bi bi-file-earmark-text me-1"></i>
              {customer.openTicketCount}
            </span>
          )}
        </div>

        {/* Context badges: industry + contract value + flags */}
        {(customer.industry || contractStr || hasFlags) && (
          <div className="d-flex flex-wrap align-items-center gap-1 mb-1">
            {customer.industry && (
              <span className="ticket-badge">
                <i className="bi bi-briefcase me-1" />
                {customer.industry}
              </span>
            )}
            {contractStr && (
              <span className="ticket-badge" style={{ color: '#059669' }}>
                {contractStr}
              </span>
            )}
            {hasFlags && (
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: '#fbbf24',
                  flexShrink: 0,
                }}
              />
            )}
          </div>
        )}

        {/* Footer: last contact | owner avatar -- matches TicketCard footer */}
        <div className="ticket-card-footer">
          <div className="d-flex align-items-center gap-2">
            <span className="ticket-id" style={{ fontFamily: 'inherit' }}>
              {customer.lastContactDate ? (
                <>
                  <i className="bi bi-clock me-1" />
                  {lastContactLabel}
                </>
              ) : (
                <span style={{ color: '#94a3b8' }}>{lastContactLabel}</span>
              )}
            </span>
          </div>

          <div className="d-flex align-items-center gap-1">
            <span title={ownerStaff?.name || ownerStaff?.email || customer.ownerName || t('fields.unassigned')}>
              {ownerStaff || customer.ownerName ? (
                <StaffAvatar
                  staff={ownerStaff}
                  name={!ownerStaff ? (customer.ownerName ?? undefined) : undefined}
                  size={24}
                />
              ) : (
                <div className="ticket-avatar ticket-avatar-empty">
                  <i className="bi bi-person" style={{ fontSize: '0.72rem' }} />
                </div>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});
