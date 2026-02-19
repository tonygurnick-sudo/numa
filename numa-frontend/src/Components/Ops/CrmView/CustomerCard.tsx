import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import type { Customer, CrmConfig, CrmLifecycleStage, Contact } from '../../../types/ops';
import { getColorForPosition } from '../Shared/colorUtils';

// ─── Props ──────────────────────────────────────────────────────────────────

interface CustomerCardProps {
  customer: Customer;
  crmConfig: CrmConfig;
  onClick: (customer: Customer) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatLastContact(dateStr: string | null | undefined): string {
  if (!dateStr) return 'No contact';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${String(days)} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${String(months)} months ago`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CustomerCard({ customer, crmConfig, onClick }: CustomerCardProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: customer.id,
  });

  const stage: CrmLifecycleStage | undefined = crmConfig.lifecycleStages.find((s) => s.id === customer.lifecycleStage);
  const stageColor = stage ? getColorForPosition(stage.colorPosition) : '#6c757d';

  const primaryContact: Contact | undefined = customer.contacts.find((c) => c.isPrimary);

  const dragStyle: React.CSSProperties = transform
    ? { transform: `translate3d(${String(transform.x)}px, ${String(transform.y)}px, 0)` }
    : {};

  const lastContact = formatLastContact(customer.lastContactDate);

  return (
    <div ref={setNodeRef} style={{ ...dragStyle, marginBottom: 8 }} {...attributes} {...listeners}>
      <div
        style={{
          background: '#fff',
          borderRadius: 10,
          border: '1px solid #e5e7eb',
          padding: '12px 14px',
          cursor: isDragging ? 'grabbing' : 'pointer',
          opacity: isDragging ? 0.5 : 1,
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          transition: 'box-shadow 0.15s',
          userSelect: 'none',
        }}
        onClick={() => {
          if (!isDragging) onClick(customer);
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
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
        {/* Row 1: Company name + open ticket count */}
        <div className="d-flex align-items-start justify-content-between gap-2 mb-1">
          <span
            className="fw-bold"
            style={{
              fontSize: '0.9rem',
              color: '#111827',
              lineHeight: '1.3',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
            title={customer.companyName}
          >
            {customer.companyName}
          </span>
          {customer.openTicketCount > 0 && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                flexShrink: 0,
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: 6,
                padding: '2px 7px',
                fontSize: '0.72rem',
                color: '#2563eb',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              {t('tickets.open', { count: customer.openTicketCount })}
            </span>
          )}
        </div>

        {/* Row 2: Primary contact with star */}
        {primaryContact ? (
          <div
            className="d-flex align-items-center gap-1"
            style={{ fontSize: '0.8rem', color: '#374151', marginBottom: 4 }}
          >
            <i className="bi bi-star-fill" style={{ color: '#f59e0b', fontSize: '0.65rem', flexShrink: 0 }} />
            <span className="text-truncate">
              {primaryContact.name}
              {primaryContact.role && <span style={{ color: '#9ca3af', marginLeft: 3 }}>({primaryContact.role})</span>}
            </span>
          </div>
        ) : (
          <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4, fontStyle: 'italic' }}>
            {t('crm.noContactAdded')}
          </div>
        )}

        {/* Row 3: Industry · Size */}
        {(customer.industry || customer.companySize) && (
          <div style={{ fontSize: '0.76rem', color: '#9ca3af', marginBottom: 4 }}>
            {[customer.industry, customer.companySize].filter(Boolean).join(' · ')}
          </div>
        )}

        {/* Row 4: Last contact */}
        <div
          style={{
            fontSize: '0.74rem',
            color: lastContact === 'No contact' ? '#d1d5db' : '#9ca3af',
          }}
        >
          {lastContact}
        </div>

        {/* Bottom stage color bar */}
        <div style={{ height: 3, borderRadius: 2, backgroundColor: stageColor, marginTop: 10 }} />
      </div>
    </div>
  );
}
