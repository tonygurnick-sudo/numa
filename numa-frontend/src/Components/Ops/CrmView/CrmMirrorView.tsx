import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button, Form, Spinner, Badge, Alert } from 'react-bootstrap';
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
  type DragOverEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
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

// ─── Constants & Helpers ─────────────────────────────────────────────────────

const ORDER_GAP = 1000;

function calculateNewOrder(items: { order?: number }[], insertIndex: number): number {
  const defaultItems = items.map((item) => ({ ...item, order: item.order ?? 0 }));

  if (defaultItems.length === 0) {
    return ORDER_GAP;
  }
  if (insertIndex <= 0) {
    return defaultItems[0].order - ORDER_GAP;
  }
  if (insertIndex >= defaultItems.length) {
    return defaultItems[defaultItems.length - 1].order + ORDER_GAP;
  }
  const before = defaultItems[insertIndex - 1].order;
  const after = defaultItems[insertIndex].order;
  return Math.round((before + after) / 2);
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
    <div className="kanban-column d-flex flex-column" style={{ height: '100%' }}>
      {/* Colored column header */}
      <div
        className="shadow-sm"
        style={{
          backgroundColor: stageColor,
          color: textColor,
          borderRadius: '10px 10px 0 0',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          border: `1px solid ${stageColor}`,
          borderBottom: 'none',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.025)',
          zIndex: 10,
          position: 'relative',
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
          padding: '12px 8px',
          backgroundColor: isOver ? '#f5f3ff' : '#f8fafc',
          borderLeft: '1px solid #e2e8f0',
          borderRight: '1px solid #e2e8f0',
          borderBottom: isOver ? `2px dashed ${stageColor}` : '1px solid #e2e8f0',
          transition: 'background-color 0.2s ease, border-color 0.2s',
          overflowY: 'auto',
          minHeight: 100,
        }}
      >
        <SortableContext items={customers.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {customers.length === 0 && (
            <div className="text-center py-4">
              <i className="bi bi-people" style={{ fontSize: '1.4rem', color: '#d1d5db' }} />
              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 4 }}>{t('empty.noCustomers')}</div>
            </div>
          )}
          {customers.map((customer) => (
            <CustomerCard key={customer.id} customer={customer} crmConfig={crmConfig} onClick={onCustomerClick} />
          ))}
        </SortableContext>
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
        className="ops-list-header px-3 py-2"
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
            className="ops-list-row px-3 py-2"
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
            <div className="ops-list-col is-title" style={{ flex: '0 0 28%', minWidth: 0, paddingRight: 12 }}>
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
            <div
              className="ops-list-col"
              data-label={t('crm.lifecycleStage')}
              style={{ flex: '0 0 16%', paddingRight: 12 }}
            >
              <Badge pill bg="" style={{ backgroundColor: stageColor, color: stageTextColor, fontSize: '0.72rem' }}>
                {stage?.name ?? '—'}
              </Badge>
            </div>

            {/* Primary contact */}
            <div
              className="ops-list-col"
              data-label={t('crm.primaryContact')}
              style={{ flex: '0 0 22%', minWidth: 0, paddingRight: 12 }}
            >
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
            <div
              className="ops-list-col"
              data-label={t('crm.industry')}
              style={{ flex: '0 0 16%', minWidth: 0, paddingRight: 12 }}
            >
              <span
                className="text-truncate d-block"
                style={{ fontSize: '0.8rem', color: '#6b7280' }}
                title={[customer.industry, customer.companySize].filter(Boolean).join(' · ')}
              >
                {[customer.industry, customer.companySize].filter(Boolean).join(' · ') || '—'}
              </span>
            </div>

            {/* Last contact */}
            <div className="ops-list-col" data-label={t('crm.lastContact')} style={{ flex: '0 0 12%' }}>
              <span style={{ fontSize: '0.78rem', color: lastContact === 'No contact' ? '#d1d5db' : '#6b7280' }}>
                {lastContact}
              </span>
            </div>

            {/* Open tickets */}
            <div
              className="ops-list-col"
              data-label={t('tickets.links')}
              style={{ flex: '0 0 6%', textAlign: 'right' }}
            >
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

const CrmMirrorView = (): React.JSX.Element => {
  const { t } = useTranslation('ops');
  const { numaGet, numaPost, numaPut } = useNumaRequest();
  const { config, crmRefreshVersion } = useOps();

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
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [activeCustomer, setActiveCustomer] = useState<Customer | null>(null);
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, [loadCustomers, crmRefreshVersion]);

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
    try {
      setCreatingCustomer(true);
      setError(null);

      const defaultStageId = stages.length > 0 ? stages[0].id : undefined;

      const newCustomer = await OpsService.createCustomer(numaPost, {
        companyName: t('crm.newCustomerDefaultName', 'New Customer'),
        lifecycleStage: defaultStageId,
      });

      if (defaultStageId && !newCustomer.lifecycleStage) {
        newCustomer.lifecycleStage = defaultStageId;
      }

      setCustomers((prev) => [newCustomer, ...prev]);
      setDetailCustomerId(newCustomer.id);
      setShowDetail(true);
    } catch (err) {
      console.error('[CrmMirrorView] Create customer failed', err);
      setError(String(err));
    } finally {
      setCreatingCustomer(false);
    }
  }, [numaPost, t, stages]);

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

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      const overId = over?.id;

      if (!overId || active.id === overId) return;

      const activeCustomer = customers.find((c) => c.id === active.id);
      const overCustomer = customers.find((c) => c.id === overId);

      const isOverColumn = String(overId).startsWith('stage-');
      if (!activeCustomer) return;

      const activeStageId = activeCustomer.lifecycleStage;
      const overStageId = isOverColumn ? String(overId).replace('stage-', '') : overCustomer?.lifecycleStage;

      if (!overStageId || activeStageId === overStageId) return;

      setCustomers((prev) => {
        const overItems = prev
          .filter((c) => c.lifecycleStage === overStageId)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        let overIndex = overItems.length;

        if (!isOverColumn && overCustomer) {
          overIndex = overItems.findIndex((c) => c.id === overId);
          const isBelow =
            over.rect &&
            active.rect.current.translated &&
            active.rect.current.translated.top > over.rect.top + over.rect.height / 2;
          overIndex += isBelow ? 1 : 0;
        }

        return prev.map((c) => {
          if (c.id === active.id) {
            return { ...c, lifecycleStage: overStageId, order: calculateNewOrder(overItems, overIndex) };
          }
          return c;
        });
      });
    },
    [customers],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveCustomer(null);
      const { active, over } = event;
      if (!over) return;
      const overId = over.id as string;
      let newStageId: string | null = null;

      if (overId.startsWith('stage-')) {
        newStageId = overId.replace('stage-', '');
      } else {
        // Dropped over another customer card
        const overCustomer = customers.find((c) => c.id === overId);
        if (overCustomer) {
          newStageId = overCustomer.lifecycleStage;
        }
      }

      if (!newStageId) return;

      const customer = customers.find((c) => c.id === active.id);
      if (!customer) return;

      const destCustomers = filteredCustomers
        .filter((c) => {
          if (c.id === customer.id) return false;
          return c.lifecycleStage === newStageId;
        })
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      let insertIndex = destCustomers.length;
      if (!overId.startsWith('stage-') && overId !== active.id) {
        const overIndex = destCustomers.findIndex((c) => c.id === overId);
        if (overIndex >= 0) {
          const isBelow =
            over.rect &&
            active.rect.current.translated &&
            active.rect.current.translated.top > over.rect.top + over.rect.height / 2;
          insertIndex = overIndex + (isBelow ? 1 : 0);
        }
      }

      const newOrder = calculateNewOrder(destCustomers, insertIndex);

      // If nothing changed in position or stage, skip
      if (customer.lifecycleStage === newStageId && customer.order === newOrder) return;

      setCustomers((prev) =>
        prev.map((c) => (c.id === customer.id ? { ...c, lifecycleStage: newStageId!, order: newOrder } : c)),
      );

      try {
        await OpsService.updateCustomer(numaPut, customer.id, { lifecycleStage: newStageId, order: newOrder });
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
        filteredCustomers.filter((c) => c.lifecycleStage === stage.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
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

          {/* Header controls (View toggles, Create button) */}
          <div className="d-flex align-items-center gap-2">
            <Button variant="primary" size="sm" onClick={handleCreateCustomer} disabled={creatingCustomer}>
              {creatingCustomer ? (
                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
              ) : (
                <i className="bi bi-plus me-1" />
              )}
              {t('crm.newCustomer')}
            </Button>

            {/* Board / List toggle */}
            <div
              style={{
                display: 'flex',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                overflow: 'hidden',
                flexShrink: 0,
              }}
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
          </div>
        </div>

        {/* ── Board or List content ─────────────────────────────────────── */}
        {error && (
          <div className="px-3">
            <Alert variant="danger" onClose={() => setError(null)} dismissible className="py-2 mb-0">
              {error}
            </Alert>
          </div>
        )}
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
              onDragOver={handleDragOver}
              onDragEnd={(e) => void handleDragEnd(e)}
            >
              <div className="kanban-columns flex-grow-1" style={{ minHeight: 300 }}>
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
                  <div style={{ transform: 'scale(1.02)', opacity: 0.9 }}>
                    <CustomerCard
                      customer={activeCustomer}
                      crmConfig={crmConfig}
                      onClick={() => {}} // No-op during drag
                    />
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
