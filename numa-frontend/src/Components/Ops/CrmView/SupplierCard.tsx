import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Supplier, SupplierConfig, Contact } from '../../../types/ops';
import { getColorForPosition } from '../Shared/colorUtils';

// ─── Props ──────────────────────────────────────────────────────────────────

interface SupplierCardProps {
  supplier: Supplier;
  supplierConfig: SupplierConfig;
  onClick: (supplier: Supplier) => void;
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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SupplierCard({ supplier, supplierConfig, onClick }: SupplierCardProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const stageColor = useMemo(() => {
    const stage = supplierConfig.lifecycleStages.find((s) => s.id === supplier.lifecycleStage);
    return stage ? getColorForPosition(stage.colorPosition) : '#0d9488';
  }, [supplier.lifecycleStage, supplierConfig.lifecycleStages]);

  const primaryContact: Contact | undefined = supplier.contacts.find((c) => c.isPrimary);
  const lastContact = formatLastContact(supplier.lastContactDate);

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 10,
        border: '1px solid #e5e7eb',
        padding: '12px 14px',
        cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        transition: 'box-shadow 0.15s',
        marginBottom: 8,
        userSelect: 'none',
      }}
      onClick={() => onClick(supplier)}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(13,148,136,0.12)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(supplier);
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
          title={supplier.companyName}
        >
          {supplier.companyName}
        </span>
        {supplier.openTicketCount > 0 && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              flexShrink: 0,
              backgroundColor: '#f0fdfa',
              border: '1px solid #99f6e4',
              borderRadius: 6,
              padding: '2px 7px',
              fontSize: '0.72rem',
              color: '#0f766e',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {t('tickets.open', { count: supplier.openTicketCount })}
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

      {/* Row 3: Industry · Size + annual spend */}
      {(supplier.industry || supplier.companySize) && (
        <div style={{ fontSize: '0.76rem', color: '#9ca3af', marginBottom: 4 }}>
          {[supplier.industry, supplier.companySize].filter(Boolean).join(' · ')}
          {supplier.annualSpend != null && supplier.annualSpend > 0 && (
            <span style={{ color: '#0d9488', fontWeight: 600, marginLeft: 6 }}>
              {formatCurrency(supplier.annualSpend)}
            </span>
          )}
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
  );
}
