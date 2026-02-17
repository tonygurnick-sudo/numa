import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button, Form, Badge, Spinner } from 'react-bootstrap';
import { DndContext, closestCenter, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import type { Customer, CrmConfig, CrmLifecycleStage } from '../../../types/ops';
import { getColorForPosition, getContrastTextColor } from '../Shared/colorUtils';
import { CustomerCard } from './CustomerCard';
import { CustomerDetailModal } from '../Modals/CustomerDetailModal';

// ─── Filter Types ───────────────────────────────────────────────────────────

type FilterType = 'all' | 'active_tickets' | 'at_risk' | 'prospects';

// ─── Health Category Helpers ────────────────────────────────────────────────

type HealthCategory = 'healthy' | 'watch' | 'atRisk' | 'critical';

/**
 * Categorizes a customer's health based on their lifecycle stage's colorPosition.
 * Positions 1-3 = healthy, 4-5 = watch, 6-7 = at risk, 8-10 = critical.
 */
function getHealthCategory(customer: Customer, stages: CrmLifecycleStage[]): HealthCategory {
  const stage = stages.find((s) => s.id === customer.lifecycleStage);
  const position = stage?.colorPosition ?? 1;

  if (position <= 3) return 'healthy';
  if (position <= 5) return 'watch';
  if (position <= 7) return 'atRisk';
  return 'critical';
}

// ─── Droppable Column ───────────────────────────────────────────────────────

interface DroppableColumnProps {
  stage: CrmLifecycleStage;
  customers: Customer[];
  crmConfig: CrmConfig;
  onCustomerClick: (customer: Customer) => void;
}

/**
 * DroppableColumn renders a single kanban column for a lifecycle stage.
 * It acts as a drop target for drag-and-drop customer movement.
 */
function DroppableColumn({ stage, customers, crmConfig, onCustomerClick }: DroppableColumnProps): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `stage-${stage.id}`,
  });

  const headerColor = getColorForPosition(stage.colorPosition);
  const headerTextColor = getContrastTextColor(headerColor);

  return (
    <div
      ref={setNodeRef}
      className="d-flex flex-column"
      style={{
        minWidth: 240,
        maxWidth: 260,
        flexShrink: 0,
        height: '100%',
      }}
    >
      {/* Column header */}
      <div
        className="rounded-top px-2 py-1 d-flex justify-content-between align-items-center"
        style={{
          backgroundColor: headerColor,
          color: headerTextColor,
          fontSize: '0.85rem',
          fontWeight: 600,
        }}
      >
        <span>{stage.name}</span>
        <Badge bg="light" text="dark" pill style={{ fontSize: '0.7rem' }}>
          {customers.length}
        </Badge>
      </div>

      {/* Column body */}
      <div
        className="flex-grow-1 p-2 rounded-bottom"
        style={{
          backgroundColor: isOver ? '#e8f4fd' : '#f8f9fa',
          border: isOver ? '2px dashed #0d6efd' : '1px solid #dee2e6',
          borderTop: 'none',
          overflowY: 'auto',
          minHeight: 120,
          transition: 'background-color 0.15s ease',
        }}
      >
        {customers.map((customer) => (
          <CustomerCard key={customer.id} customer={customer} crmConfig={crmConfig} onClick={onCustomerClick} />
        ))}
      </div>
    </div>
  );
}

// ─── CrmMirrorView ──────────────────────────────────────────────────────────

/**
 * CrmMirrorView renders a lifecycle-stage kanban board for CRM customers.
 *
 * Features:
 * - Filter pills: All, With Active Tickets, At Risk, Prospects
 * - Health overview line with counts
 * - Search input for client-side company name filtering
 * - "+ New Customer" button with inline creation
 * - Kanban columns: one per lifecycle stage from crmConfig
 * - Drag-and-drop between columns to update lifecycle stage
 * - Click a customer card to open the detail modal
 */
const CrmMirrorView = (): React.JSX.Element => {
  const { t } = useTranslation('ops');
  const { numaGet, numaPost, numaPut } = useNumaRequest();
  const { config } = useOps();

  // ── State ───────────────────────────────────────────────────────────────

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [activeCustomer, setActiveCustomer] = useState<Customer | null>(null);

  // Modal state
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const crmConfig: CrmConfig | null = config?.crmConfig ?? null;
  const stages = crmConfig?.lifecycleStages ?? [];

  // ── Load customers ──────────────────────────────────────────────────────

  const loadCustomers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await OpsService.listCustomers(numaGet);
      setCustomers(data);
    } catch (err) {
      console.error('[CrmMirrorView] Failed to load customers:', err);
    } finally {
      setLoading(false);
    }
  }, [numaGet]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  // ── Filter logic ────────────────────────────────────────────────────────

  const filteredCustomers = useMemo(() => {
    let result = customers;

    // Apply category filter
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
        if (stages.length > 0) {
          const firstStageId = stages[0].id;
          result = result.filter((c) => c.lifecycleStage === firstStageId);
        }
        break;
      default:
        break;
    }

    // Apply search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((c) => c.companyName.toLowerCase().includes(q));
    }

    return result;
  }, [customers, activeFilter, search, stages]);

  // ── Filter counts (always computed on full set) ─────────────────────────

  const filterCounts = useMemo(() => {
    const allCount = customers.length;
    const activeTicketCount = customers.filter((c) => c.openTicketCount > 0).length;
    const atRiskCount = customers.filter((c) =>
      c.flags.some((f) => f.toLowerCase().includes('at_risk') || f.toLowerCase().includes('at-risk')),
    ).length;
    const prospectsCount = stages.length > 0 ? customers.filter((c) => c.lifecycleStage === stages[0].id).length : 0;

    return { all: allCount, active_tickets: activeTicketCount, at_risk: atRiskCount, prospects: prospectsCount };
  }, [customers, stages]);

  // ── Health overview ─────────────────────────────────────────────────────

  const healthCounts = useMemo(() => {
    const counts = { healthy: 0, watch: 0, atRisk: 0, critical: 0 };
    for (const customer of customers) {
      const cat = getHealthCategory(customer, stages);
      counts[cat]++;
    }
    return counts;
  }, [customers, stages]);

  // ── New customer creation ───────────────────────────────────────────────

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

  // ── Customer click ──────────────────────────────────────────────────────

  const handleCustomerClick = useCallback((customer: Customer) => {
    setDetailCustomerId(customer.id);
    setShowDetail(true);
  }, []);

  const handleDetailHide = useCallback(() => {
    setShowDetail(false);
    setDetailCustomerId(null);
  }, []);

  const handleDetailUpdated = useCallback(() => {
    void loadCustomers();
  }, [loadCustomers]);

  // ── Drag-and-drop ───────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const customerId = event.active.id as string;
      const customer = filteredCustomers.find((c) => c.id === customerId) ?? null;
      setActiveCustomer(customer);
    },
    [filteredCustomers],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveCustomer(null);

      const { active, over } = event;
      if (!over) return;

      const customerId = active.id as string;
      const overId = over.id as string;

      // Droppable IDs are formatted as "stage-{stageId}"
      if (!overId.startsWith('stage-')) return;

      const newStageId = overId.replace('stage-', '');
      const customer = customers.find((c) => c.id === customerId);
      if (!customer) return;

      // No-op if already in the same stage
      if (customer.lifecycleStage === newStageId) return;

      try {
        await OpsService.updateCustomer(numaPut, customerId, {
          lifecycleStage: newStageId,
        });
        // Optimistically update local state
        setCustomers((prev) => prev.map((c) => (c.id === customerId ? { ...c, lifecycleStage: newStageId } : c)));
      } catch (err) {
        console.error('[CrmMirrorView] Failed to update customer stage:', err);
      }
    },
    [customers, numaPut],
  );

  // ── Customers grouped by stage ──────────────────────────────────────────

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

  // ── Loading state ───────────────────────────────────────────────────────

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

  // ── Render ──────────────────────────────────────────────────────────────

  const isFiltered = activeFilter !== 'all' || search.trim().length > 0;

  return (
    <>
      <div className="p-3">
        {/* ── Filter pills ──────────────────────────────────────────────── */}
        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          {/* Filter buttons */}
          {[
            { key: 'all' as FilterType, label: t('crm.allCustomers'), count: filterCounts.all },
            {
              key: 'active_tickets' as FilterType,
              label: t('crm.withActiveTickets'),
              count: filterCounts.active_tickets,
            },
            { key: 'at_risk' as FilterType, label: t('crm.atRisk'), count: filterCounts.at_risk },
            { key: 'prospects' as FilterType, label: t('crm.prospects'), count: filterCounts.prospects },
          ].map(({ key, label, count }) => (
            <Button
              key={key}
              variant={activeFilter === key ? 'primary' : 'outline-secondary'}
              size="sm"
              onClick={() => setActiveFilter(key)}
            >
              {label}
              <Badge
                bg={activeFilter === key ? 'light' : 'secondary'}
                text={activeFilter === key ? 'dark' : 'light'}
                pill
                className="ms-1"
              >
                {count}
              </Badge>
            </Button>
          ))}

          {/* Spacer */}
          <div className="flex-grow-1" />

          {/* Search */}
          <Form.Control
            type="text"
            size="sm"
            placeholder={t('common.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 220 }}
          />

          {/* New Customer button */}
          {!showNewForm && (
            <Button variant="primary" size="sm" onClick={() => setShowNewForm(true)}>
              <i className="bi bi-plus me-1" />
              {t('crm.newCustomer')}
            </Button>
          )}
        </div>

        {/* ── Inline new customer form ──────────────────────────────────── */}
        {showNewForm && (
          <div className="d-flex align-items-center gap-2 mb-3">
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
              style={{ maxWidth: 280 }}
              autoFocus
              disabled={creating}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleCreateCustomer()}
              disabled={creating || !newCompanyName.trim()}
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
              disabled={creating}
            >
              {t('common.cancel')}
            </Button>
          </div>
        )}

        {/* ── Health overview ───────────────────────────────────────────── */}
        <div className="d-flex flex-wrap gap-3 mb-3 small">
          <span className="text-success fw-semibold">
            {healthCounts.healthy} {t('crm.healthy')}
          </span>
          <span className="text-warning fw-semibold">
            {healthCounts.watch} {t('crm.watch')}
          </span>
          <span className="text-danger fw-semibold">
            {healthCounts.atRisk} {t('crm.atRisk')}
          </span>
          <span style={{ color: '#dc3545', fontWeight: 700 }}>
            {healthCounts.critical} {t('crm.critical')}
          </span>

          {/* Filtered count */}
          {isFiltered && (
            <span className="text-muted ms-auto">
              {t('crm.customersOf', {
                shown: filteredCustomers.length,
                total: customers.length,
              })}
            </span>
          )}
        </div>

        {/* ── Kanban columns ─────────────────────────────────────────── */}
        {filteredCustomers.length === 0 ? (
          <div className="text-center text-muted py-5">
            <i className="bi bi-people fs-1 mb-2 d-block" />
            <span>{t('empty.noCustomers')}</span>
          </div>
        ) : (
          <DndContext
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={(e) => void handleDragEnd(e)}
          >
            <div
              className="d-flex gap-3"
              style={{
                overflowX: 'auto',
                paddingBottom: 8,
                minHeight: 300,
              }}
            >
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
                <div className="card p-2 shadow" style={{ width: 220, opacity: 0.9 }}>
                  <div className="fw-bold small">{activeCustomer.companyName}</div>
                  {activeCustomer.industry && <div className="text-muted small">{activeCustomer.industry}</div>}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {/* ── Customer Detail Modal ──────────────────────────────────────── */}
      <CustomerDetailModal
        show={showDetail}
        customerId={detailCustomerId}
        onHide={handleDetailHide}
        onUpdated={handleDetailUpdated}
      />
    </>
  );
};

export default CrmMirrorView;
