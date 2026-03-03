import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button, Form, Badge, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import type { Supplier, SupplierConfig } from '../../../types/ops';
import { getCached, setCache } from '../../../utils/opsCache';
import { getColorForPosition, getContrastTextColor } from '../Shared/colorUtils';
import { SupplierCard } from './SupplierCard';
import { SupplierDetailModal } from '../Modals/SupplierDetailModal';

// ─── Constants ──────────────────────────────────────────────────────────────

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

const TEAL_ACCENT = '#0d9488';

type FilterMode = 'all' | 'with-tickets';
type ViewMode = 'board' | 'list';

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

// ─── Supplier List View ─────────────────────────────────────────────────────

interface SupplierListViewProps {
  suppliers: Supplier[];
  supplierConfig: SupplierConfig;
  onSupplierClick: (supplier: Supplier) => void;
}

function SupplierListView({ suppliers, supplierConfig, onSupplierClick }: SupplierListViewProps): React.JSX.Element {
  const { t } = useTranslation('ops');

  if (suppliers.length === 0) {
    return (
      <div className="text-center py-5">
        <i className="bi bi-truck fs-1 d-block mb-2" style={{ color: '#d1d5db' }} />
        <span style={{ color: '#9ca3af', fontSize: '0.9rem' }}>{t('empty.noSuppliers')}</span>
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
        <span style={{ flex: '0 0 26%' }}>{t('common.name')}</span>
        <span style={{ flex: '0 0 16%' }}>{t('crm.lifecycleStage')}</span>
        <span style={{ flex: '0 0 20%' }}>{t('crm.primaryContact')}</span>
        <span style={{ flex: '0 0 14%' }}>{t('crm.industry')}</span>
        <span style={{ flex: '0 0 12%' }}>{t('crm.lastContact')}</span>
        <span style={{ flex: '0 0 6%', textAlign: 'right' }}>{t('suppliers.annualSpend')}</span>
        <span style={{ flex: '0 0 6%', textAlign: 'right' }}>{t('tickets.links')}</span>
      </div>

      {/* Data rows */}
      {suppliers.map((supplier) => {
        const stage = supplierConfig.lifecycleStages.find((s) => s.id === supplier.lifecycleStage);
        const stageColor = stage ? getColorForPosition(stage.colorPosition) : '#6c757d';
        const stageTextColor = getContrastTextColor(stageColor);
        const primaryContact = supplier.contacts.find((c) => c.isPrimary);
        const lastContact = formatLastContact(supplier.lastContactDate);

        return (
          <div
            key={supplier.id}
            className="ops-list-row px-3 py-2"
            style={{
              borderBottom: '1px solid #f3f4f6',
              cursor: 'pointer',
              transition: 'background-color 0.1s',
            }}
            onClick={() => onSupplierClick(supplier)}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = '#f9fafb';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onSupplierClick(supplier);
            }}
          >
            {/* Company name */}
            <div className="ops-list-col is-title" style={{ flex: '0 0 26%', minWidth: 0, paddingRight: 12 }}>
              <span
                className="fw-semibold d-block text-truncate"
                style={{ fontSize: '0.85rem', color: '#111827' }}
                title={supplier.companyName}
              >
                {supplier.companyName}
              </span>
            </div>

            {/* Stage badge */}
            <div
              className="ops-list-col"
              data-label={t('crm.lifecycleStage')}
              style={{ flex: '0 0 16%', paddingRight: 12 }}
            >
              <Badge pill bg="" style={{ backgroundColor: stageColor, color: stageTextColor, fontSize: '0.72rem' }}>
                {stage?.name ?? '\u2014'}
              </Badge>
            </div>

            {/* Primary contact */}
            <div
              className="ops-list-col"
              data-label={t('crm.primaryContact')}
              style={{ flex: '0 0 20%', minWidth: 0, paddingRight: 12 }}
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
                <span style={{ color: '#d1d5db', fontStyle: 'italic', fontSize: '0.8rem' }}>{'\u2014'}</span>
              )}
            </div>

            {/* Industry */}
            <div
              className="ops-list-col"
              data-label={t('crm.industry')}
              style={{ flex: '0 0 14%', minWidth: 0, paddingRight: 12 }}
            >
              <span
                className="text-truncate d-block"
                style={{ fontSize: '0.8rem', color: '#6b7280' }}
                title={[supplier.industry, supplier.companySize].filter(Boolean).join(' \u00B7 ')}
              >
                {[supplier.industry, supplier.companySize].filter(Boolean).join(' \u00B7 ') || '\u2014'}
              </span>
            </div>

            {/* Last contact */}
            <div className="ops-list-col" data-label={t('crm.lastContact')} style={{ flex: '0 0 12%' }}>
              <span style={{ fontSize: '0.78rem', color: lastContact === 'No contact' ? '#d1d5db' : '#6b7280' }}>
                {lastContact}
              </span>
            </div>

            {/* Annual spend */}
            <div
              className="ops-list-col"
              data-label={t('suppliers.annualSpend')}
              style={{ flex: '0 0 6%', textAlign: 'right' }}
            >
              {supplier.annualSpend != null && supplier.annualSpend > 0 ? (
                <span style={{ fontSize: '0.75rem', color: '#0d9488', fontWeight: 600 }}>
                  {formatCurrency(supplier.annualSpend)}
                </span>
              ) : (
                <span style={{ color: '#d1d5db', fontSize: '0.78rem' }}>{'\u2014'}</span>
              )}
            </div>

            {/* Open tickets */}
            <div
              className="ops-list-col"
              data-label={t('tickets.links')}
              style={{ flex: '0 0 6%', textAlign: 'right' }}
            >
              {supplier.openTicketCount > 0 ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    backgroundColor: '#f0fdfa',
                    border: '1px solid #99f6e4',
                    borderRadius: 6,
                    padding: '1px 6px',
                    fontSize: '0.7rem',
                    color: '#0f766e',
                    fontWeight: 600,
                  }}
                >
                  {supplier.openTicketCount}
                </span>
              ) : (
                <span style={{ color: '#d1d5db', fontSize: '0.78rem' }}>{'\u2014'}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Droppable Supplier Column ──────────────────────────────────────────────

interface DroppableSupplierColumnProps {
  stage: { id: string; name: string; colorPosition?: number };
  suppliers: Supplier[];
  supplierConfig: SupplierConfig;
  onSupplierClick: (s: Supplier) => void;
}

function DroppableSupplierColumn({
  stage,
  suppliers,
  supplierConfig,
  onSupplierClick,
}: DroppableSupplierColumnProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}` });
  const supplierIds = suppliers.map((s) => s.id);

  return (
    <div
      ref={setNodeRef}
      className={`kanban-column rounded-3 p-2 h-100 ${isOver ? 'bg-light bg-opacity-75' : 'bg-transparent'}`}
      style={{
        backgroundColor: '#f9fafb',
        border: '1px solid #e5e7eb',
        transition: 'background-color 0.2s ease',
      }}
    >
      <div className="d-flex align-items-center justify-content-between mb-2 px-1">
        <span
          style={{
            fontWeight: 700,
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#374151',
          }}
        >
          {stage.name}
        </span>
        <span
          style={{
            backgroundColor: '#f3f4f6',
            color: '#6b7280',
            fontSize: '0.7rem',
            fontWeight: 600,
            borderRadius: 10,
            padding: '1px 8px',
            minWidth: 22,
            textAlign: 'center',
          }}
        >
          {suppliers.length}
        </span>
      </div>

      <div className="flex-grow-1 overflow-auto" style={{ borderRadius: 10, minHeight: 100 }}>
        {suppliers.length === 0 && (
          <div className="text-center py-4">
            <i className="bi bi-truck" style={{ fontSize: '1.5rem', color: '#d1d5db' }} />
            <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 4 }}>{t('empty.noSuppliers')}</div>
          </div>
        )}
        <SortableContext items={supplierIds} strategy={verticalListSortingStrategy}>
          {suppliers.map((supplier) => (
            <SupplierCard
              key={supplier.id}
              supplier={supplier}
              supplierConfig={supplierConfig}
              onClick={onSupplierClick}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * SupplierMirrorView renders suppliers grouped by lifecycle stage.
 * Supports both a Kanban board view and a tabular list view, with the
 * user's preference persisted to localStorage.
 */
export function SupplierMirrorView(): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaGet, numaPost } = useNumaRequest();
  const { config, crmRefreshVersion } = useOps();

  const supplierConfig = config?.supplierConfig ?? null;

  // ── State ──────────────────────────────────────────────────────────────

  const [suppliers, setSuppliers] = useState<Supplier[]>(() => getCached<Supplier[]>('suppliers') ?? []);
  const [loading, setLoading] = useState(() => !getCached('suppliers'));
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  // View mode with localStorage persistence (default: list)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem('numa_ops_suppliers_view_mode');
      return saved === 'board' ? 'board' : 'list';
    } catch {
      return 'list';
    }
  });

  const handleSetViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('numa_ops_suppliers_view_mode', mode);
    } catch {
      /* quota exceeded */
    }
  }, []);

  // ── DnD Settings ─────────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeSupplier, setActiveSupplier] = useState<Supplier | null>(null);

  // New supplier creation
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Detail modal
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // ── Data Loading ───────────────────────────────────────────────────────

  const loadSuppliers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await OpsService.listSuppliers(numaGet);
      setSuppliers(data);
      setCache('suppliers', data);
    } catch (err) {
      console.error('[SupplierMirrorView] Failed to load suppliers', err);
    } finally {
      setLoading(false);
    }
  }, [numaGet]);

  useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers, crmRefreshVersion]);

  // ── Filtering ──────────────────────────────────────────────────────────

  const filteredSuppliers = useMemo(() => {
    let result = suppliers;

    // Text search on company name
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((s) => s.companyName.toLowerCase().includes(q));
    }

    // Filter by active tickets
    if (filterMode === 'with-tickets') {
      result = result.filter((s) => s.openTicketCount > 0);
    }

    return result;
  }, [suppliers, searchQuery, filterMode]);

  // Counts for filter badges
  const totalCount = suppliers.length;
  const withTicketsCount = useMemo(() => suppliers.filter((s) => s.openTicketCount > 0).length, [suppliers]);

  // ── Lifecycle Stages ───────────────────────────────────────────────────

  const stages = supplierConfig?.lifecycleStages ?? [];

  // ── Create Supplier ────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    setCreating(true);
    try {
      const defaultStageId = stages.length > 0 ? stages[0].id : undefined;

      await OpsService.createSupplier(numaPost, {
        companyName: trimmed,
        lifecycleStage: defaultStageId,
      });
      setNewName('');
      setShowNewInput(false);
      await loadSuppliers();
    } catch (err) {
      console.error('[SupplierMirrorView] Failed to create supplier', err);
    } finally {
      setCreating(false);
    }
  }, [newName, numaPost, loadSuppliers, stages]);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const supplier = filteredSuppliers.find((s) => s.id === active.id);
      if (supplier) setActiveSupplier(supplier);
    },
    [filteredSuppliers],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      const overId = over?.id;

      if (!overId || active.id === overId) return;

      const activeSupplier = suppliers.find((s) => s.id === active.id);
      const overSupplier = suppliers.find((s) => s.id === overId);

      const isOverColumn = String(overId).startsWith('stage-');
      if (!activeSupplier) return;

      const activeStageId = activeSupplier.lifecycleStage;
      const overStageId = isOverColumn ? String(overId).replace('stage-', '') : overSupplier?.lifecycleStage;

      if (!overStageId || activeStageId === overStageId) return;

      setSuppliers((prev) => {
        const overItems = prev
          .filter((s) => s.lifecycleStage === overStageId)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        let overIndex = overItems.length;

        if (!isOverColumn && overSupplier) {
          overIndex = overItems.findIndex((s) => s.id === overId);
          const isBelow =
            over.rect &&
            active.rect.current.translated &&
            active.rect.current.translated.top > over.rect.top + over.rect.height / 2;
          overIndex += isBelow ? 1 : 0;
        }

        return prev.map((s) => {
          if (s.id === active.id) {
            return { ...s, lifecycleStage: overStageId, order: calculateNewOrder(overItems, overIndex) };
          }
          return s;
        });
      });
    },
    [suppliers],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveSupplier(null);
      const { active, over } = event;
      if (!over) return;

      const overId = over.id as string;
      let newStageId: string | null = null;

      if (overId.startsWith('stage-')) {
        newStageId = overId.replace('stage-', '');
      } else {
        const overSupplier = suppliers.find((s) => s.id === overId);
        if (overSupplier) {
          newStageId = overSupplier.lifecycleStage;
        }
      }

      if (!newStageId) return;

      const supplier = suppliers.find((s) => s.id === active.id);
      if (!supplier) return;

      const destSuppliers = filteredSuppliers
        .filter((s) => {
          if (s.id === supplier.id) return false;
          return s.lifecycleStage === newStageId;
        })
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      let insertIndex = destSuppliers.length;
      if (!overId.startsWith('stage-') && overId !== active.id) {
        const overIndex = destSuppliers.findIndex((s) => s.id === overId);
        if (overIndex >= 0) {
          const isBelow =
            over.rect &&
            active.rect.current.translated &&
            active.rect.current.translated.top > over.rect.top + over.rect.height / 2;
          insertIndex = overIndex + (isBelow ? 1 : 0);
        }
      }

      const newOrder = calculateNewOrder(destSuppliers, insertIndex);

      if (supplier.lifecycleStage === newStageId && supplier.order === newOrder) return;

      // Optimistic update
      setSuppliers((prev) =>
        prev.map((s) => (s.id === supplier.id ? { ...s, lifecycleStage: newStageId!, order: newOrder } : s)),
      );

      try {
        await OpsService.updateSupplier(numaPost, supplier.id, { lifecycleStage: newStageId, order: newOrder });
      } catch (err) {
        console.error('[SupplierMirrorView] Failed to update supplier stage:', err);
        await loadSuppliers();
      }
    },
    [suppliers, filteredSuppliers, numaPost, loadSuppliers],
  );

  // ── Detail Modal ───────────────────────────────────────────────────────

  const openDetail = useCallback((supplier: Supplier) => {
    setSelectedSupplierId(supplier.id);
    setShowDetail(true);
  }, []);

  const handleDetailHide = useCallback(() => {
    setShowDetail(false);
    setSelectedSupplierId(null);
  }, []);

  const handleDetailUpdated = useCallback(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading && suppliers.length === 0) {
    return (
      <div className="d-flex justify-content-center align-items-center p-5">
        <Spinner animation="border" style={{ color: TEAL_ACCENT }} />
      </div>
    );
  }

  return (
    <div className="d-flex flex-column h-100">
      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div
        className="d-flex flex-wrap align-items-center gap-2 px-3 border-bottom bg-white"
        style={{ minHeight: 68, paddingTop: 14, paddingBottom: 14 }}
      >
        {/* Filter toggles */}
        <div className="d-flex gap-1">
          <Button
            size="sm"
            variant={filterMode === 'all' ? '' : 'outline-secondary'}
            style={
              filterMode === 'all'
                ? { backgroundColor: TEAL_ACCENT, borderColor: TEAL_ACCENT, color: '#fff' }
                : undefined
            }
            onClick={() => setFilterMode('all')}
          >
            {t('suppliers.allSuppliers')}{' '}
            <Badge bg="light" text="dark" className="ms-1">
              {totalCount}
            </Badge>
          </Button>
          <Button
            size="sm"
            variant={filterMode === 'with-tickets' ? '' : 'outline-secondary'}
            style={
              filterMode === 'with-tickets'
                ? { backgroundColor: TEAL_ACCENT, borderColor: TEAL_ACCENT, color: '#fff' }
                : undefined
            }
            onClick={() => setFilterMode('with-tickets')}
          >
            {t('crm.withActiveTickets')}{' '}
            <Badge bg="light" text="dark" className="ms-1">
              {withTicketsCount}
            </Badge>
          </Button>
        </div>

        {/* Search */}
        <Form.Control
          size="sm"
          type="text"
          placeholder={t('common.search')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ maxWidth: 220 }}
        />

        {/* Spacer */}
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
              background: viewMode === 'board' ? TEAL_ACCENT : '#fff',
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
              background: viewMode === 'list' ? TEAL_ACCENT : '#fff',
              color: viewMode === 'list' ? '#fff' : '#6b7280',
              cursor: 'pointer',
              fontSize: '0.85rem',
              transition: 'all 0.12s',
            }}
          >
            <i className="bi bi-list-ul" />
          </button>
        </div>
        <div className="flex-grow-1" />
        {/* New supplier */}
        {showNewInput ? (
          <div className="d-flex gap-1 align-items-center">
            <Form.Control
              size="sm"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('common.name')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') {
                  setShowNewInput(false);
                  setNewName('');
                }
              }}
              style={{ width: 200 }}
              disabled={creating}
            />
            <Button
              size="sm"
              style={{ backgroundColor: TEAL_ACCENT, borderColor: TEAL_ACCENT, color: '#fff' }}
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? t('common.loading') : t('common.save')}
            </Button>
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() => {
                setShowNewInput(false);
                setNewName('');
              }}
              disabled={creating}
            >
              {t('common.cancel')}
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            style={{ backgroundColor: TEAL_ACCENT, borderColor: TEAL_ACCENT, color: '#fff' }}
            onClick={() => setShowNewInput(true)}
          >
            <i className="bi bi-plus me-1" />
            {t('suppliers.newSupplier')}
          </Button>
        )}
      </div>

      {/* ── Filtered count ─────────────────────────────────────────────────── */}
      {filteredSuppliers.length !== totalCount && totalCount > 0 && (
        <div className="px-3 py-1 text-muted small">
          {filteredSuppliers.length}{' '}
          {t('crm.customersOf', {
            shown: String(filteredSuppliers.length),
            total: String(totalCount),
          }).replace(/customers/i, '')}
        </div>
      )}

      {/* ── Board or List content ─────────────────────────────────────────── */}
      <div className="flex-grow-1 overflow-auto px-3 pb-3 pt-1">
        {viewMode === 'list' ? (
          <SupplierListView
            suppliers={filteredSuppliers}
            supplierConfig={supplierConfig!}
            onSupplierClick={openDetail}
          />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={(e) => void handleDragEnd(e)}
          >
            <div className="d-flex overflow-auto h-100" style={{ gap: 16 }}>
              {stages.map((stage) => {
                const stageSuppliers = filteredSuppliers
                  .filter((s) => s.lifecycleStage === stage.id)
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                return (
                  <DroppableSupplierColumn
                    key={stage.id}
                    stage={stage}
                    suppliers={stageSuppliers}
                    supplierConfig={supplierConfig!}
                    onSupplierClick={openDetail}
                  />
                );
              })}
            </div>
            <DragOverlay>
              {activeSupplier ? (
                <div style={{ transform: 'scale(1.02)', opacity: 0.9 }}>
                  <SupplierCard supplier={activeSupplier} supplierConfig={supplierConfig!} onClick={() => {}} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {/* ── Detail Modal ───────────────────────────────────────────────────── */}
      <SupplierDetailModal
        show={showDetail}
        supplierId={selectedSupplierId}
        onHide={handleDetailHide}
        onUpdated={handleDetailUpdated}
      />
    </div>
  );
}
