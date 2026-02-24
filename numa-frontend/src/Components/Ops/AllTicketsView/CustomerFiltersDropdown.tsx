import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import Form from 'react-bootstrap/Form';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import { useTranslation } from 'react-i18next';
import type { Customer, CrmConfig, StaffProfile } from '../../../types/ops';
import { EMPTY_CUSTOMER_FILTERS, countActiveCustomerFilters, type CustomerFilterState } from './customerFilterTypes';

interface CustomerFiltersDropdownProps {
  /** All customers loaded from the CRM. */
  customers: Customer[];
  /** CRM config with lifecycle stages, territories, industries. */
  crmConfig: CrmConfig | null;
  /** Staff list for account owner filter. */
  staff: StaffProfile[];
  /** Current filter state. */
  filters: CustomerFilterState;
  /** Called when any filter changes. */
  onChange: (filters: CustomerFilterState) => void;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function CustomerFiltersDropdown({
  customers,
  crmConfig,
  staff,
  filters,
  onChange,
}: CustomerFiltersDropdownProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const activeCount = countActiveCustomerFilters(filters);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // ── Derive filter options ─────────────────────────────────────────────

  const customerOptions = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.companyName })).sort((a, b) => a.label.localeCompare(b.label)),
    [customers],
  );

  const stageOptions = useMemo(
    () =>
      (crmConfig?.lifecycleStages ?? []).map((s) => ({
        value: s.id,
        label: s.name,
      })),
    [crmConfig],
  );

  const territoryOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const terr of crmConfig?.territories ?? []) {
      if (terr) unique.add(terr);
    }
    for (const c of customers) {
      if (c.territory) unique.add(c.territory);
    }
    return Array.from(unique)
      .sort()
      .map((v) => ({ value: v, label: v }));
  }, [crmConfig, customers]);

  const accountOwnerOptions = useMemo(
    () => staff.map((s) => ({ value: s.id, label: s.name || s.email })).sort((a, b) => a.label.localeCompare(b.label)),
    [staff],
  );

  const industryOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const ind of crmConfig?.industries ?? []) {
      if (ind) unique.add(ind);
    }
    for (const c of customers) {
      if (c.industry) unique.add(c.industry);
    }
    return Array.from(unique)
      .sort()
      .map((v) => ({ value: v, label: v }));
  }, [crmConfig, customers]);

  const companySizeOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const c of customers) {
      if (c.companySize) unique.add(c.companySize);
    }
    return Array.from(unique)
      .sort()
      .map((v) => ({ value: v, label: v }));
  }, [customers]);

  // ── Toggle helpers ────────────────────────────────────────────────────

  const toggle = useCallback(
    (field: keyof CustomerFilterState, value: string) => {
      const current = filters[field] as string[];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      onChange({ ...filters, [field]: next });
    },
    [filters, onChange],
  );

  const clearAll = useCallback(() => {
    onChange(EMPTY_CUSTOMER_FILTERS);
  }, [onChange]);

  // ── Render a single filter column ─────────────────────────────────────

  const renderColumn = (
    label: string,
    options: { value: string; label: string }[],
    selected: string[],
    fieldKey: keyof CustomerFilterState,
  ) => (
    <div className="d-flex flex-column" style={{ minWidth: 0, flex: '1 1 0', minHeight: 0 }}>
      <div className="px-3 py-2 fw-semibold small text-muted border-bottom flex-shrink-0">{label}</div>
      <div className="overflow-auto flex-grow-1 px-3 py-2" style={{ minHeight: 0 }}>
        {options.map((opt) => (
          <Form.Check
            key={opt.value}
            type="checkbox"
            id={`cust-filter-${fieldKey}-${opt.value}`}
            label={<span className="small text-uppercase">{opt.label}</span>}
            checked={selected.includes(opt.value)}
            onChange={() => toggle(fieldKey, opt.value)}
            className="py-1"
          />
        ))}
        {options.length === 0 && <div className="text-muted small py-1">-</div>}
      </div>
    </div>
  );

  return (
    <div ref={wrapperRef} className="position-relative d-inline-block">
      <button
        type="button"
        className="btn btn-sm d-inline-flex align-items-center gap-1"
        style={{
          backgroundColor: activeCount > 0 ? '#eef2ff' : '#f8f9fa',
          border: `1px solid ${activeCount > 0 ? '#818cf8' : '#dee2e6'}`,
          color: activeCount > 0 ? '#4f46e5' : '#495057',
          borderRadius: 8,
        }}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <i className="bi bi-people" />
        {t('allTicketsView.customerFilters')}
        {activeCount > 0 && (
          <Badge bg="primary" pill className="ms-1">
            {activeCount}
          </Badge>
        )}
        <i className="bi bi-chevron-down" style={{ fontSize: '0.6rem' }} />
      </button>

      {isOpen && (
        <div
          className="position-absolute bg-white border rounded shadow-sm"
          style={{ top: '100%', left: 0, zIndex: 1050, marginTop: 4, width: 780 }}
        >
          {/* 4-column grid — all same height, each column scrollable independently */}
          <div className="d-flex" style={{ height: 360 }}>
            {/* Column 1: Customer */}
            <div className="d-flex flex-column border-end" style={{ flex: '1 1 0', minWidth: 0 }}>
              <div className="px-3 py-2 fw-semibold small text-muted border-bottom flex-shrink-0">
                {t('tickets.customer')}
              </div>
              <div className="overflow-auto flex-grow-1 px-3 py-2" style={{ minHeight: 0 }}>
                {/* (EMPTY) option */}
                <Form.Check
                  type="checkbox"
                  id="cust-filter-no-customer"
                  label={<span className="small text-uppercase text-muted fst-italic">{t('filters.empty')}</span>}
                  checked={filters.includeNoCustomer}
                  onChange={() => onChange({ ...filters, includeNoCustomer: !filters.includeNoCustomer })}
                  className="py-1"
                />
                <hr className="my-1" />
                {customerOptions.map((opt) => (
                  <Form.Check
                    key={opt.value}
                    type="checkbox"
                    id={`cust-filter-name-${opt.value}`}
                    label={<span className="small text-uppercase">{opt.label}</span>}
                    checked={filters.customerIds.includes(opt.value)}
                    onChange={() => toggle('customerIds', opt.value)}
                    className="py-1"
                  />
                ))}
              </div>
            </div>

            {/* Column 2: Lifecycle Stage */}
            <div
              className="border-end"
              style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}
            >
              {renderColumn(t('crm.lifecycleStage'), stageOptions, filters.stages, 'stages')}
            </div>

            {/* Column 3: Territory */}
            <div
              className="border-end"
              style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}
            >
              {renderColumn(t('crm.territory'), territoryOptions, filters.territories, 'territories')}
            </div>

            {/* Column 4: Account Owner — takes remaining space, scrollable */}
            <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div className="px-3 py-2 fw-semibold small text-muted border-bottom flex-shrink-0">{t('crm.owner')}</div>
              <div className="overflow-auto flex-grow-1 px-3 py-2" style={{ minHeight: 0 }}>
                {accountOwnerOptions.length === 0 && <div className="text-muted small py-1">-</div>}
                {accountOwnerOptions.map((opt) => (
                  <Form.Check
                    key={opt.value}
                    type="checkbox"
                    id={`cust-filter-owner-${opt.value}`}
                    label={<span className="small text-uppercase">{opt.label}</span>}
                    checked={filters.accountOwnerIds.includes(opt.value)}
                    onChange={() => toggle('accountOwnerIds', opt.value)}
                    className="py-1"
                  />
                ))}

                {/* Industry sub-section */}
                <div className="fw-semibold small text-muted mt-3 mb-1 border-top pt-2">{t('crm.industry')}</div>
                {industryOptions.map((opt) => (
                  <Form.Check
                    key={opt.value}
                    type="checkbox"
                    id={`cust-filter-industry-${opt.value}`}
                    label={<span className="small text-uppercase">{opt.label}</span>}
                    checked={filters.industries.includes(opt.value)}
                    onChange={() => toggle('industries', opt.value)}
                    className="py-1"
                  />
                ))}

                {/* Company Size sub-section */}
                {companySizeOptions.length > 0 && (
                  <>
                    <div className="fw-semibold small text-muted mt-3 mb-1 border-top pt-2">{t('crm.companySize')}</div>
                    {companySizeOptions.map((opt) => (
                      <Form.Check
                        key={opt.value}
                        type="checkbox"
                        id={`cust-filter-size-${opt.value}`}
                        label={<span className="small text-uppercase">{opt.label}</span>}
                        checked={filters.companySizes.includes(opt.value)}
                        onChange={() => toggle('companySizes', opt.value)}
                        className="py-1"
                      />
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Footer: clear all */}
          {activeCount > 0 && (
            <div className="px-3 py-2 border-top">
              <Button size="sm" variant="outline-danger" className="w-100" onClick={clearAll}>
                {t('filters.clearAll')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
