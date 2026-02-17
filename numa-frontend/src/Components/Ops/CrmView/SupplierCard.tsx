import React, { useMemo } from 'react';
import { Badge } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { Supplier, SupplierConfig } from '../../../types/ops';
import { getColorForPosition } from '../Shared/colorUtils';

// ─── Props ──────────────────────────────────────────────────────────────────

interface SupplierCardProps {
  supplier: Supplier;
  supplierConfig: SupplierConfig;
  onClick: (supplier: Supplier) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const TEAL_ACCENT = '#0d9488';

/**
 * Formats a number as a compact currency string (e.g. "$12,500").
 * Returns null when the value is absent.
 */
function formatCurrency(value: number | null | undefined): string | null {
  if (value == null) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * SupplierCard renders a compact card for use inside the Kanban columns of
 * the SupplierMirrorView. It shows the company name, flag icons, annual spend,
 * industry, payment terms, and an open-ticket count badge.
 *
 * The bottom border is tinted using the supplier's lifecycle stage color
 * derived from `getColorForPosition`.
 */
export function SupplierCard({ supplier, supplierConfig, onClick }: SupplierCardProps): React.JSX.Element {
  const { t } = useTranslation('ops');

  // Derive the bottom border color from the lifecycle stage's colorPosition.
  const borderColor = useMemo(() => {
    const stage = supplierConfig.lifecycleStages.find((s) => s.id === supplier.lifecycleStage);
    return stage ? getColorForPosition(stage.colorPosition) : TEAL_ACCENT;
  }, [supplier.lifecycleStage, supplierConfig.lifecycleStages]);

  // Resolve active flags.
  const activeFlags = useMemo(
    () => supplierConfig.supplierFlags.filter((f) => supplier.flags.includes(f.id)),
    [supplier.flags, supplierConfig.supplierFlags],
  );

  const formattedSpend = useMemo(() => formatCurrency(supplier.annualSpend), [supplier.annualSpend]);

  return (
    <div
      className="supplier-card"
      style={{ borderBottom: `3px solid ${borderColor}` }}
      onClick={() => onClick(supplier)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(supplier);
        }
      }}
    >
      {/* ── Company Name ───────────────────────────────────────────────────── */}
      <div
        className="fw-bold text-truncate mb-1"
        style={{ fontSize: '0.85rem', lineHeight: '1.3' }}
        title={supplier.companyName}
      >
        {supplier.companyName}
      </div>

      {/* ── Flag Icons ─────────────────────────────────────────────────────── */}
      {activeFlags.length > 0 && (
        <div className="d-flex flex-wrap gap-1 mb-1">
          {activeFlags.map((flag) => (
            <span key={flag.id} title={flag.name} style={{ color: flag.color, fontSize: '0.8rem' }}>
              {flag.icon ? <i className={`bi bi-${flag.icon}`} /> : <i className="bi bi-flag-fill" />}
            </span>
          ))}
        </div>
      )}

      {/* ── Annual Spend ───────────────────────────────────────────────────── */}
      {formattedSpend && (
        <div className="small fw-semibold" style={{ color: TEAL_ACCENT }}>
          {formattedSpend}
        </div>
      )}

      {/* ── Industry + Payment Terms ───────────────────────────────────────── */}
      <div className="d-flex flex-wrap gap-2 text-muted" style={{ fontSize: '0.75rem' }}>
        {supplier.industry && <span>{supplier.industry}</span>}
        {supplier.paymentTerms && <span>{supplier.paymentTerms}</span>}
      </div>

      {/* ── Open Ticket Count ──────────────────────────────────────────────── */}
      {supplier.openTicketCount > 0 && (
        <div className="mt-1">
          <Badge bg="" style={{ backgroundColor: TEAL_ACCENT, fontSize: '0.7rem' }}>
            {supplier.openTicketCount} {t('crm.linkedWork')}
          </Badge>
        </div>
      )}

      {/* ── Scoped inline styles ───────────────────────────────────────────── */}
      <style>{`
        .supplier-card {
          background: #fff;
          border-radius: 6px;
          padding: 10px 12px;
          cursor: pointer;
          transition: box-shadow 0.15s ease;
          position: relative;
        }
        .supplier-card:hover {
          box-shadow: 0 2px 8px rgba(13, 148, 136, 0.18);
        }
      `}</style>
    </div>
  );
}
