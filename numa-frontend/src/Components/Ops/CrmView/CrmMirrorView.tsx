import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button, Form, Spinner, Badge } from 'react-bootstrap';
import {
  DndContext,
  closestCenter,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import type { Customer, CrmConfig, CrmLifecycleStage } from '../../../types/ops';
import { getCached, setCache } from '../../../utils/opsCache';
import { getColorForPosition, getContrastTextColor } from '../Shared/colorUtils';
import { CustomerCard } from './CustomerCard';
import { CustomerDetailModal } from '../Modals/CustomerDetailModal';

// ─── Types ───────────────────────────────────────────────────────────────────

type FilterType = 'all' | 'active_tickets' | 'at_risk' | 'prospects';
type ViewMode = 'board' | 'list';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Droppable Column ────────────────────────────────────────────────────────

interface DroppableColumnProps {
  stage: CrmLifecycleStage;
  customers: Customer[];
  crmConfig: CrmConfig;
  onCustomerClick: (customer: Customer) => void;
}

function DroppableColumn({ stage, customers, crmConfig, onCustomerClick }: DroppableColumnProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}` });

  const stageColor = getColorForPosition(stage.colorPosition);
  const textColor = getContrastTextColor(stageColor);

  return (
    <div className="d-flex flex-column" style={{ minWidth: 140, flex: '1 1 0', height: '100%' }}>
      {/* Colored column header */}
      <div
        style={{
          backgroundColor: stageColor,
          color: textColor,
          borderRadius: '10px 10px 0 0',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '0.82rem' }}>{stage.name}</span>
        <span
          style={{
            backgroundColor: 'rgba(255,255,255,0.25)',
            borderRadius: 10,
            padding: '1px 8px',
            fontSize: '0.7rem',
            fontWeight: 700,
            color: textColor,
          }}
        >
          {customers.length}
        </span>
      </div>

      {/* Column body */}
      <div
        ref={setNodeRef}
        style={{
          flex: 1,
          borderRadius: '0 0 10px 10px',
          padding: '8px',
          backgroundColor: isOver ? '#f5f3ff' : '#f9fafb',
          borderLeft: '1px solid #e5e7eb',
          borderRight: '1px solid #e5e7eb',
          borderBottom: isOver ? `2px dashed ${stageColor}` : '1px solid #e5e7eb',
          transition: 'background-color 0.15s',
          overflowY: 'auto',
          minHeight: 100,
        }}
      >
        {customers.length === 0 && (
          <div className="text-center py-4">
            <i className="bi bi-people" style={{ fontSize: '1.4rem', color: '#d1d5db' }} />
            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 4 }}>{t('empty.noCustomers')}</div>
          </div>
        )}
        {customers.map((customer) => (
          <CustomerCard key={customer.id} customer={customer} crmConfig={crmConfig} onClick={onCustomerClick} />
        ))}
      </div>
    </div>
  );
}

// ─── List View ───────────────────────────────────────────────────────────────

interface CustomerListViewProps {
  customers: Customer[];
  crmConfig: CrmConfig;
  onCustomerClick: (customer: Customer) => void;
}

function CustomerListView({ customers, crmConfig, onCustomerClick }: CustomerListViewProps): React.JSX.Element {
  const { t } = useTranslation('ops');

  if (customers.length === 0) {
    return (
      <div className="text-center py-5">
        <i className="bi bi-people fs-1 d-block mb-2" style={{ color: '#d1d5db' }} />
        <span style={{ color: '#9ca3af', fontSize: '0.9rem' }}>{t('empty.noCustomers')}</span>
      </div>
    );
  }

  return (
    <div style={{ borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden', backgroundColor: '#fff' }}>
      {/* Header row */}
      <div
        className="d-flex align-items-center px-3 py-2"
        style={{
          backgroundColor: '#f9fafb',
          borderBottom: '1px solid #e5e7eb',
          fontSize: '0.7rem',
          fontWeight: 700,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        <span style={{ flex: '0 0 28%' }}>{t('common.name')}</span>
        <span style={{ flex: '0 0 16%' }}>{t('crm.lifecycleStage')}</span>
        <span style={{ flex: '0 0 22%' }}>{t('crm.primaryContact')}</span>
        <span style={{ flex: '0 0 16%' }}>{t('crm.industry')}</span>
        <span style={{ flex: '0 0 12%' }}>{t('crm.lastContact')}</span>
        <span style={{ flex: '0 0 6%', textAlign: 'right' }}>{t('tickets.links')}</span>
      </div>

      {/* Data rows */}
      {customers.map((customer) => {
        const stage = crmConfig.lifecycleStages.find((s) => s.id === customer.lifecycleStage);
        const stageColor = stage ? getColorForPosition(stage.colorPosition) : '#6c757d';
        const stageTextColor = getContrastTextColor(stageColor);
        const primaryContact = customer.contacts.find((c) => c.isPrimary);
        const lastContact = formatLastContact(customer.lastContactDate);

        return (
          <div
            key={customer.id}
            className="d-flex align-items-center px-3 py-2"
            style={{
              borderBottom: '1px solid #f3f4f6',
              cursor: 'pointer',
              transition: 'background-color 0.1s',
            }}
            onClick={() => onCustomerClick(customer)}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = '#f9fafb';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onCustomerClick(customer);
            }}
          >
            {/* Company name */}
            <div style={{ flex: '0 0 28%', minWidth: 0, paddingRight: 12 }}>
              <span
                className="fw-semibold d-block text-truncate"
                style={{ fontSize: '0.85rem', color: '#111827' }}
                title={customer.companyName}
              >
                {customer.companyName}
              </span>
              {customer.contractValue != null && customer.contractValue > 0 && (
                <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 600 }}>
                  {formatCurrency(customer.contractValue)}
                </span>
              )}
            </div>

            {/* Stage badge */}
            <div style={{ flex: '0 0 16%', paddingRight: 12 }}>
              <Badge pill bg="" style={{ backgroundColor: stageColor, color: stageTextColor, fontSize: '0.72rem' }}>
                {stage?.name ?? '—'}
              </Badge>
            </div>

            {/* Primary contact */}
            <div style={{ flex: '0 0 22%', minWidth: 0, paddingRight: 12 }}>
              {primaryContact ? (
                <div className="d-flex align-items-center gap-1">
                  <i className="bi bi-star-fill" style={{ color: '#f59e0b', fontSize: '0.6rem', flexShrink: 0 }} />
                  <span className="text-truncate" style={{ fontSize: '0.82rem', color: '#374151' }}>
                    {primaryContact.name}
                    {primaryContact.role && (
                      <span style={{ color: '#9ca3af', marginLeft: 3 }}>({primaryContact.role})</span>
                    )}
                  </span>
                </div>
              ) : (
                <span style={{ color: '#d1d5db', fontStyle: 'italic', fontSize: '0.8rem' }}>—</span>
              )}
            </div>

            {/* Industry · Size */}
            <div style={{ flex: '0 0 16%', minWidth: 0, paddingRight: 12 }}>
              <span
                className="text-truncate d-block"
                style={{ fontSize: '0.8rem', color: '#6b7280' }}
                title={[customer.industry, customer.companySize].filter(Boolean).join(' · ')}
              >
                {[customer.industry, customer.companySize].filter(Boolean).join(' · ') || '—'}
              </span>
            </div>

            {/* Last contact */}
            <div style={{ flex: '0 0 12%' }}>
              <span style={{ fontSize: '0.78rem', color: lastContact === 'No contact' ? '#d1d5db' : '#6b7280' }}>
                {lastContact}
              </span>
            </div>

            {/* Open tickets */}
            <div style={{ flex: '0 0 6%', textAlign: 'right' }}>
              {customer.openTicketCount > 0 ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    backgroundColor: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: 6,
                    padding: '1px 6px',
                    fontSize: '0.7rem',
                    color: '#2563eb',
                    fontWeight: 600,
                  }}
                >
                  {customer.openTicketCount}
                </span>
              ) : (
                <span style={{ color: '#d1d5db', fontSize: '0.78rem' }}>—</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── CrmMirrorView ────────────────────────────────────────────────────────────

const CrmMirrorView = (): React.JSX.Element => {
  const { t } = useTranslation('ops');
  const { numaGet, numaPost, numaPut } = useNumaRequest();
  const { config } = useOps();

  // ── DnD: 8px movement before drag activates (so clicks work cleanly) ──────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // ── State ─────────────────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<Customer[]>(() => getCached<Customer[]>('customers') ?? []);
  const [loading, setLoading] = useState(() => !getCached('customers'));
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem('numa_ops_customers_view_mode');
      return saved === 'board' ? 'board' : 'list';
    } catch {
      return 'list';
    }
  });

  const handleSetViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('numa_ops_customers_view_mode', mode);
    } catch {
      /* quota exceeded */
    }
  }, []);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [activeCustomer, setActiveCustomer] = useState<Customer | null>(null);
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const crmConfig: CrmConfig | null = config?.crmConfig ?? null;
  const stages = crmConfig?.lifecycleStages ?? [];

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadCustomers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await OpsService.listCustomers(numaGet);
      setCustomers(data);
      setCache('customers', data);
    } catch (err) {
      console.error('[CrmMirrorView] Failed to load customers:', err);
    } finally {
      setLoading(false);
    }
  }, [numaGet]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filteredCustomers = useMemo(() => {
    let result = customers;
    switch (activeFilter) {
      case 'active_tickets':
        result = result.filter((c) => c.openTicketCount > 0);
        break;
      case 'at_risk':
        result = result.filter((c) =>
          c.flags.some((f) => f.toLowerCase().includes('at_risk') || f.toLowerCase().includes('at-risk')),
        );
        break;
      case 'prospects':
        if (stages.length > 0) result = result.filter((c) => c.lifecycleStage === stages[0].id);
        break;
      default:
        break;
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((c) => c.companyName.toLowerCase().includes(q));
    }
    return result;
  }, [customers, activeFilter, search, stages]);

  const filterCounts = useMemo(
    () => ({
      all: customers.length,
      active_tickets: customers.filter((c) => c.openTicketCount > 0).length,
      at_risk: customers.filter((c) =>
        c.flags.some((f) => f.toLowerCase().includes('at_risk') || f.toLowerCase().includes('at-risk')),
      ).length,
      prospects: stages.length > 0 ? customers.filter((c) => c.lifecycleStage === stages[0].id).length : 0,
    }),
    [customers, stages],
  );

  // ── Create customer ───────────────────────────────────────────────────────
  const handleCreateCustomer = useCallback(async () => {
    const name = newCompanyName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await OpsService.createCustomer(numaPost, { companyName: name });
      setNewCompanyName('');
      setShowNewForm(false);
      await loadCustomers();
    } catch (err) {
      console.error('[CrmMirrorView] Failed to create customer:', err);
    } finally {
      setCreating(false);
    }
  }, [newCompanyName, numaPost, loadCustomers]);

  // ── Click handler ─────────────────────────────────────────────────────────
  const handleCustomerClick = useCallback((customer: Customer) => {
    setDetailCustomerId(customer.id);
    setShowDetail(true);
  }, []);

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setActiveCustomer(filteredCustomers.find((c) => c.id === event.active.id) ?? null);
    },
    [filteredCustomers],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveCustomer(null);
      const { active, over } = event;
      if (!over) return;
      const overId = over.id as string;
      if (!overId.startsWith('stage-')) return;
      const newStageId = overId.replace('stage-', '');
      const customer = customers.find((c) => c.id === active.id);
      if (!customer || customer.lifecycleStage === newStageId) return;
      setCustomers((prev) => prev.map((c) => (c.id === customer.id ? { ...c, lifecycleStage: newStageId } : c)));
      try {
        await OpsService.updateCustomer(numaPut, customer.id, { lifecycleStage: newStageId });
      } catch (err) {
        console.error('[CrmMirrorView] Failed to update customer stage:', err);
        await loadCustomers();
      }
    },
    [customers, numaPut, loadCustomers],
  );

  // ── Grouped by stage ──────────────────────────────────────────────────────
  const customersByStage = useMemo(() => {
    const map = new Map<string, Customer[]>();
    for (const stage of stages) {
      map.set(
        stage.id,
        filteredCustomers.filter((c) => c.lifecycleStage === stage.id),
      );
    }
    return map;
  }, [filteredCustomers, stages]);

  // ── Guards ────────────────────────────────────────────────────────────────
  if (loading && customers.length === 0) {
    return (
      <div className="d-flex justify-content-center align-items-center py-5">
        <Spinner animation="border" />
      </div>
    );
  }
  if (!crmConfig || stages.length === 0) {
    return <div className="text-center text-muted py-5">{t('empty.noCustomers')}</div>;
  }

  const filters: { key: FilterType; label: string; count: number }[] = [
    { key: 'all', label: t('crm.allCustomers'), count: filterCounts.all },
    { key: 'active_tickets', label: t('crm.withActiveTickets'), count: filterCounts.active_tickets },
    { key: 'at_risk', label: t('crm.atRisk'), count: filterCounts.at_risk },
    { key: 'prospects', label: t('crm.prospects'), count: filterCounts.prospects },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="d-flex flex-column h-100">
        {/* ── Toolbar ────────────────────────────────────────────────────── */}
        <div className="d-flex flex-wrap align-items-center gap-2 px-3 pt-3 pb-2">
          <Form.Control
            type="text"
            size="sm"
            placeholder={t('crm.searchCustomers')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 210, borderRadius: 8 }}
          />

          <div className="d-flex flex-wrap gap-1">
            {filters.map(({ key, label, count }) => {
              const isActive = activeFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveFilter(key)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '4px 12px',
                    borderRadius: 100,
                    border: isActive ? 'none' : '1px solid #e5e7eb',
                    background: isActive ? '#4f46e5' : '#fff',
                    color: isActive ? '#fff' : '#6b7280',
                    fontSize: '0.8rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                  <span
                    style={{
                      backgroundColor: isActive ? 'rgba(255,255,255,0.25)' : '#f3f4f6',
                      color: isActive ? '#fff' : '#6b7280',
                      borderRadius: 10,
                      padding: '0 6px',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex-grow-1" />

          {/* Board / List toggle */}
          <div
            style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}
          >
            <button
              type="button"
              title={t('common.boardView')}
              onClick={() => handleSetViewMode('board')}
              style={{
                padding: '5px 10px',
                border: 'none',
                background: viewMode === 'board' ? '#4f46e5' : '#fff',
                color: viewMode === 'board' ? '#fff' : '#6b7280',
                cursor: 'pointer',
                fontSize: '0.85rem',
                transition: 'all 0.12s',
              }}
            >
              <i className="bi bi-kanban" />
            </button>
            <button
              type="button"
              title={t('common.listView')}
              onClick={() => handleSetViewMode('list')}
              style={{
                padding: '5px 10px',
                border: 'none',
                borderLeft: '1px solid #e5e7eb',
                background: viewMode === 'list' ? '#4f46e5' : '#fff',
                color: viewMode === 'list' ? '#fff' : '#6b7280',
                cursor: 'pointer',
                fontSize: '0.85rem',
                transition: 'all 0.12s',
              }}
            >
              <i className="bi bi-list-ul" />
            </button>
          </div>

          {!showNewForm && (
            <Button
              size="sm"
              onClick={() => setShowNewForm(true)}
              style={{ borderRadius: 8, backgroundColor: '#4f46e5', borderColor: '#4f46e5', flexShrink: 0 }}
            >
              <i className="bi bi-plus me-1" />
              {t('crm.newCustomer')}
            </Button>
          )}
        </div>

        {/* ── New customer form ─────────────────────────────────────────── */}
        {showNewForm && (
          <div className="d-flex align-items-center gap-2 px-3 pb-2">
            <Form.Control
              type="text"
              size="sm"
              placeholder={t('common.name')}
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateCustomer();
                if (e.key === 'Escape') {
                  setShowNewForm(false);
                  setNewCompanyName('');
                }
              }}
              style={{ maxWidth: 280, borderRadius: 8 }}
              autoFocus
              disabled={creating}
            />
            <Button
              size="sm"
              onClick={() => void handleCreateCustomer()}
              disabled={creating || !newCompanyName.trim()}
              style={{ backgroundColor: '#4f46e5', borderColor: '#4f46e5', borderRadius: 8 }}
            >
              {creating ? t('common.loading') : t('common.save')}
            </Button>
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => {
                setShowNewForm(false);
                setNewCompanyName('');
              }}
              style={{ borderRadius: 8 }}
              disabled={creating}
            >
              {t('common.cancel')}
            </Button>
          </div>
        )}

        {/* ── Board or List content ─────────────────────────────────────── */}
        <div className="flex-grow-1 overflow-auto px-3 pb-3 pt-1">
          {viewMode === 'list' ? (
            <CustomerListView
              customers={filteredCustomers}
              crmConfig={crmConfig}
              onCustomerClick={handleCustomerClick}
            />
          ) : filteredCustomers.length === 0 ? (
            <div className="text-center py-5">
              <i className="bi bi-people fs-1 mb-2 d-block" style={{ color: '#d1d5db' }} />
              <span style={{ color: '#9ca3af', fontSize: '0.9rem' }}>{t('empty.noCustomers')}</span>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={(e) => void handleDragEnd(e)}
            >
              <div className="d-flex gap-3 h-100 overflow-auto" style={{ minHeight: 300 }}>
                {stages.map((stage) => (
                  <DroppableColumn
                    key={stage.id}
                    stage={stage}
                    customers={customersByStage.get(stage.id) ?? []}
                    crmConfig={crmConfig}
                    onCustomerClick={handleCustomerClick}
                  />
                ))}
              </div>

              <DragOverlay>
                {activeCustomer ? (
                  <div
                    style={{
                      background: '#fff',
                      borderRadius: 10,
                      border: '1px solid #e5e7eb',
                      padding: '12px 14px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                      width: 255,
                      opacity: 0.95,
                    }}
                  >
                    <div className="fw-bold" style={{ fontSize: '0.9rem', color: '#111827' }}>
                      {activeCustomer.companyName}
                    </div>
                    {activeCustomer.industry && (
                      <div style={{ fontSize: '0.76rem', color: '#9ca3af', marginTop: 3 }}>
                        {activeCustomer.industry}
                      </div>
                    )}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </div>

      <CustomerDetailModal
        show={showDetail}
        customerId={detailCustomerId}
        onHide={() => {
          setShowDetail(false);
          setDetailCustomerId(null);
        }}
        onUpdated={() => void loadCustomers()}
      />
    </>
  );
};

export default CrmMirrorView;
