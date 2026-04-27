import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import type { Customer, CrmConfig, CrmLifecycleStage, StaffProfile, SavedFilter } from '../../../types/ops';
import { getCached, setCache } from '../../../utils/opsCache';
import { getColorForPosition, getContrastTextColor } from '../Shared/colorUtils';
import { formatRelativeDate } from '../Shared/ticketUtils';
import { CustomerCard } from './CustomerCard';
import { CustomerDetailModal } from '../Modals/CustomerDetailModal';
import { CreateCustomerModal } from '../Modals/CreateCustomerModal';
import { FilterDropdown } from '../AllTicketsView/FilterDropdown';
import { QuickFilterDropdown } from '../AllTicketsView/QuickFilterDropdown';
import { ColumnPicker, type ColumnDef as PickerColumnDef } from '../AllTicketsView/ColumnPicker';
import { SaveViewModal, LoadViewDropdown } from '../AllTicketsView/SavedViewsDropdown';
import { StaffAvatar } from '../Shared/StaffAvatar';
import {
  type SortDirection,
  type FilterEntry,
  type ActiveFilters,
  matchesFilter,
  compareValues,
} from '../Shared/filterUtils';

// ─── Types ───────────────────────────────────────────────────────────────────

type FilterType = 'all' | 'active_tickets' | 'at_risk' | 'prospects';
type ViewMode = 'board' | 'list';

type CrmColumnDef = {
  key: string;
  label: string;
  sortable: boolean;
  filterType: 'text' | 'enum' | 'date' | 'number';
  filterOptions?: () => { value: string; label: string }[];
  accessor: (c: Customer) => unknown;
  render?: (c: Customer) => React.ReactNode;
  defaultVisible?: boolean;
  category?: string;
  flex?: string;
};

type CrmSavedViewConfig = {
  filters: ActiveFilters;
  visibleColumnKeys: string[];
  sortColumn: string;
  sortDirection: SortDirection;
  quickFilter: FilterType;
  quickStageFilter: string[];
  quickTerritoryFilter: string[];
  quickOwnerFilter: string[];
  quickIndustryFilter: string[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

const DEFAULT_VISIBLE_KEYS = [
  'companyName',
  'lifecycleStage',
  'primaryContact',
  'industry',
  'territory',
  'lastContactDate',
  'openTicketCount',
];

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
  staff?: StaffProfile[];
  onCustomerClick: (customer: Customer) => void;
}

function DroppableColumn({
  stage,
  customers,
  crmConfig,
  staff,
  onCustomerClick,
}: DroppableColumnProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}` });

  const stageColor = stage.color || getColorForPosition(stage.colorPosition);
  const textColor = getContrastTextColor(stageColor);

  return (
    <div className="kanban-column" style={{ background: isOver ? '#faf5ff' : undefined }}>
      <div
        style={{
          backgroundColor: stageColor,
          color: textColor,
          borderRadius: 8,
          padding: '7px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '0.78rem' }}>{stage.name}</span>
        <span
          style={{
            backgroundColor: 'rgba(255,255,255,0.25)',
            borderRadius: 10,
            padding: '1px 7px',
            fontSize: '0.68rem',
            fontWeight: 700,
            color: textColor,
          }}
        >
          {customers.length}
        </span>
      </div>

      <div ref={setNodeRef}>
        <SortableContext items={customers.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {customers.length === 0 && (
            <div className="text-center py-4">
              <i className="bi bi-people" style={{ fontSize: '1.2rem', color: '#d1d5db' }} />
              <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 4 }}>{t('empty.noCustomers')}</div>
            </div>
          )}
          {customers.map((customer) => (
            <CustomerCard
              key={customer.id}
              customer={customer}
              crmConfig={crmConfig}
              staff={staff}
              onClick={onCustomerClick}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

const CrmMirrorView = (): React.JSX.Element => {
  const { t } = useTranslation('ops');
  const { numaGet, numaPut } = useNumaRequest();
  const { config, crmRefreshVersion } = useOps();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // ── State ──────────────────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<Customer[]>(() => getCached<Customer[]>('customers') ?? []);
  const [loading, setLoading] = useState(() => !getCached('customers'));
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem('numa_ops_customers_view_mode');
      return saved === 'board' ? 'board' : 'list';
    } catch {
      return 'list';
    }
  });

  // ── List view state ────────────────────────────────────────────────────────
  const [sortColumn, setSortColumn] = useState<string>('companyName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({});
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(DEFAULT_VISIBLE_KEYS);
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  // Quick filter dropdowns
  const [quickStageFilter, setQuickStageFilter] = useState<string[]>([]);
  const [quickTerritoryFilter, setQuickTerritoryFilter] = useState<string[]>([]);
  const [quickOwnerFilter, setQuickOwnerFilter] = useState<string[]>([]);
  const [quickIndustryFilter, setQuickIndustryFilter] = useState<string[]>([]);

  // Saved views
  const [savedViews, setSavedViews] = useState<SavedFilter[]>([]);
  const [currentViewName, setCurrentViewName] = useState<string | undefined>();
  const [viewSnapshot, setViewSnapshot] = useState<string | null>(null);
  const [showSaveViewModal, setShowSaveViewModal] = useState(false);

  const handleSetViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('numa_ops_customers_view_mode', mode);
    } catch {
      /* quota exceeded */
    }
  }, []);
  const [showCreate, setShowCreate] = useState(false);
  const [activeCustomer, setActiveCustomer] = useState<Customer | null>(null);
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crmConfig: CrmConfig | null = config?.crmConfig ?? null;
  const stages = crmConfig?.lifecycleStages ?? [];
  const staff = config?.staff ?? [];

  // ── Debounced search ─────────────────────────────────────────────────────
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [search]);

  // ── Saved view helpers ────────────────────────────────────────────────────
  const buildCurrentViewConfig = useCallback(
    (): CrmSavedViewConfig => ({
      filters: activeFilters,
      visibleColumnKeys,
      sortColumn,
      sortDirection,
      quickFilter: activeFilter,
      quickStageFilter,
      quickTerritoryFilter,
      quickOwnerFilter,
      quickIndustryFilter,
    }),
    [
      activeFilters,
      visibleColumnKeys,
      sortColumn,
      sortDirection,
      activeFilter,
      quickStageFilter,
      quickTerritoryFilter,
      quickOwnerFilter,
      quickIndustryFilter,
    ]
  );

  const isViewModified = useMemo(() => {
    if (!viewSnapshot) return false;
    return JSON.stringify(buildCurrentViewConfig()) !== viewSnapshot;
  }, [buildCurrentViewConfig, viewSnapshot]);

  // Load saved views from localStorage (CRM views are lightweight, no backend persistence needed yet)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('numa_ops_crm_saved_views');
      if (raw) setSavedViews(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const persistSavedViews = useCallback((views: SavedFilter[]) => {
    setSavedViews(views);
    try {
      localStorage.setItem('numa_ops_crm_saved_views', JSON.stringify(views));
    } catch {
      /* quota exceeded */
    }
  }, []);

  const handleSaveView = useCallback(
    (name: string) => {
      const config = buildCurrentViewConfig();
      const view: SavedFilter = { name, config: config as unknown as Record<string, unknown> };
      const updated = [...savedViews.filter((v) => v.name !== name), view];
      persistSavedViews(updated);
      setCurrentViewName(name);
      setViewSnapshot(JSON.stringify(config));
    },
    [buildCurrentViewConfig, savedViews, persistSavedViews]
  );

  const handleUpdateView = useCallback(() => {
    if (!currentViewName) return;
    handleSaveView(currentViewName);
  }, [currentViewName, handleSaveView]);

  const handleLoadView = useCallback((view: SavedFilter) => {
    const cfg = view.config as unknown as CrmSavedViewConfig;
    if (cfg.filters) setActiveFilters(cfg.filters);
    if (cfg.visibleColumnKeys) setVisibleColumnKeys(cfg.visibleColumnKeys);
    if (cfg.sortColumn) setSortColumn(cfg.sortColumn);
    if (cfg.sortDirection) setSortDirection(cfg.sortDirection);
    if (cfg.quickFilter) setActiveFilter(cfg.quickFilter);
    if (cfg.quickStageFilter) setQuickStageFilter(cfg.quickStageFilter);
    if (cfg.quickTerritoryFilter) setQuickTerritoryFilter(cfg.quickTerritoryFilter);
    if (cfg.quickOwnerFilter) setQuickOwnerFilter(cfg.quickOwnerFilter);
    if (cfg.quickIndustryFilter) setQuickIndustryFilter(cfg.quickIndustryFilter);
    setCurrentViewName(view.name);
    setViewSnapshot(JSON.stringify(cfg));
  }, []);

  const handleDeleteView = useCallback(
    (name: string) => {
      const updated = savedViews.filter((v) => v.name !== name);
      persistSavedViews(updated);
      if (currentViewName === name) {
        setCurrentViewName(undefined);
        setViewSnapshot(null);
      }
    },
    [savedViews, persistSavedViews, currentViewName]
  );

  const handleClearView = useCallback(() => {
    setCurrentViewName(undefined);
    setViewSnapshot(null);
  }, []);

  // ── Column definitions ─────────────────────────────────────────────────────
  const columns: CrmColumnDef[] = useMemo(
    () => [
      {
        key: 'companyName',
        label: t('common.name'),
        sortable: true,
        filterType: 'text' as const,
        accessor: (c: Customer) => c.companyName,
        defaultVisible: true,
        category: 'system',
        flex: '1 1 0',
        render: (c: Customer) => (
          <div style={{ minWidth: 0 }}>
            <span
              className="fw-semibold d-block text-truncate"
              style={{ fontSize: '0.85rem', color: '#111827' }}
              title={c.companyName}
            >
              {c.companyName}
            </span>
            {c.contractValue != null && c.contractValue > 0 && (
              <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 600 }}>
                {formatCurrency(c.contractValue)}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'lifecycleStage',
        label: t('crm.lifecycleStage'),
        sortable: true,
        filterType: 'enum' as const,
        filterOptions: () => stages.map((s) => ({ value: s.id, label: s.name })),
        accessor: (c: Customer) => c.lifecycleStage,
        defaultVisible: true,
        category: 'crm',
        flex: '0 0 130px',
        render: (c: Customer) => {
          const stage = stages.find((s) => s.id === c.lifecycleStage);
          const stageColor = stage ? stage.color || getColorForPosition(stage.colorPosition) : '#6c757d';
          const stageTextColor = getContrastTextColor(stageColor);
          return (
            <Badge pill bg="" style={{ backgroundColor: stageColor, color: stageTextColor, fontSize: '0.72rem' }}>
              {stage?.name ?? '-'}
            </Badge>
          );
        },
      },
      {
        key: 'primaryContact',
        label: t('crm.primaryContact'),
        sortable: true,
        filterType: 'text' as const,
        accessor: (c: Customer) => {
          const pc = c.contacts?.find((ct) => ct.isPrimary);
          return pc?.name ?? '';
        },
        defaultVisible: true,
        category: 'crm',
        flex: '0 0 180px',
        render: (c: Customer) => {
          const pc = c.contacts?.find((ct) => ct.isPrimary);
          return pc ? (
            <div className="d-flex align-items-center gap-1">
              <i className="bi bi-star-fill" style={{ color: '#f59e0b', fontSize: '0.6rem', flexShrink: 0 }} />
              <span className="text-truncate" style={{ fontSize: '0.82rem', color: '#374151' }}>
                {pc.name}
                {pc.role && <span style={{ color: '#9ca3af', marginLeft: 3 }}>({pc.role})</span>}
              </span>
            </div>
          ) : (
            <span style={{ color: '#d1d5db', fontStyle: 'italic', fontSize: '0.8rem' }}>-</span>
          );
        },
      },
      {
        key: 'industry',
        label: t('crm.industry'),
        sortable: true,
        filterType: 'enum' as const,
        filterOptions: () => {
          const industries = new Set(customers.map((c) => c.industry).filter(Boolean) as string[]);
          return Array.from(industries)
            .sort()
            .map((i) => ({ value: i, label: i }));
        },
        accessor: (c: Customer) => c.industry ?? '',
        defaultVisible: true,
        category: 'crm',
        flex: '0 0 130px',
      },
      {
        key: 'territory',
        label: t('crm.territory'),
        sortable: true,
        filterType: 'enum' as const,
        filterOptions: () => {
          const territories = new Set(customers.map((c) => c.territory).filter(Boolean) as string[]);
          return Array.from(territories)
            .sort()
            .map((t) => ({ value: t, label: t }));
        },
        accessor: (c: Customer) => c.territory ?? '',
        defaultVisible: true,
        category: 'crm',
        flex: '0 0 120px',
      },
      {
        key: 'ownerName',
        label: t('crm.owner'),
        sortable: true,
        filterType: 'enum' as const,
        filterOptions: () => staff.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name || s.email })),
        accessor: (c: Customer) => c.ownerName ?? '',
        category: 'crm',
        flex: '0 0 140px',
        render: (c: Customer) => {
          const s = c.ownerId ? staff.find((st) => st.id === c.ownerId) : undefined;
          return s || c.ownerName ? (
            <span className="d-inline-flex align-items-center gap-2">
              <StaffAvatar staff={s} name={!s ? (c.ownerName ?? undefined) : undefined} size={22} />
              <span className="text-truncate" style={{ fontSize: '0.82rem' }}>
                {s ? s.name || s.email : c.ownerName}
              </span>
            </span>
          ) : (
            <span className="text-muted" style={{ fontSize: '0.8rem' }}>
              -
            </span>
          );
        },
      },
      {
        key: 'companySize',
        label: t('crm.companySize'),
        sortable: true,
        filterType: 'enum' as const,
        filterOptions: () => {
          const sizes = new Set(customers.map((c) => c.companySize).filter(Boolean) as string[]);
          return Array.from(sizes)
            .sort()
            .map((s) => ({ value: s, label: s }));
        },
        accessor: (c: Customer) => c.companySize ?? '',
        category: 'crm',
        flex: '0 0 100px',
      },
      {
        key: 'source',
        label: t('crm.source'),
        sortable: true,
        filterType: 'text' as const,
        accessor: (c: Customer) => c.source ?? '',
        category: 'crm',
        flex: '0 0 110px',
      },
      {
        key: 'contractValue',
        label: t('crm.contractValue'),
        sortable: true,
        filterType: 'number' as const,
        accessor: (c: Customer) => c.contractValue ?? 0,
        category: 'crm',
        flex: '0 0 120px',
        render: (c: Customer) =>
          c.contractValue != null && c.contractValue > 0 ? (
            <span style={{ color: '#16a34a', fontWeight: 600, fontSize: '0.82rem' }}>
              {formatCurrency(c.contractValue)}
            </span>
          ) : (
            <span className="text-muted">-</span>
          ),
      },
      {
        key: 'lastContactDate',
        label: t('crm.lastContact'),
        sortable: true,
        filterType: 'date' as const,
        accessor: (c: Customer) => c.lastContactDate ?? '',
        defaultVisible: true,
        category: 'crm',
        flex: '0 0 120px',
      },
      {
        key: 'openTicketCount',
        label: t('crm.openTickets'),
        sortable: true,
        filterType: 'number' as const,
        accessor: (c: Customer) => c.openTicketCount ?? 0,
        defaultVisible: true,
        category: 'system',
        flex: '0 0 80px',
        render: (c: Customer) =>
          c.openTicketCount > 0 ? (
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
              {c.openTicketCount}
            </span>
          ) : (
            <span style={{ color: '#d1d5db', fontSize: '0.78rem' }}>-</span>
          ),
      },
      {
        key: 'flags',
        label: t('crm.flags'),
        sortable: false,
        filterType: 'text' as const,
        accessor: (c: Customer) => (c.flags ?? []).join(', '),
        category: 'crm',
        flex: '0 0 100px',
        render: (c: Customer) =>
          (c.flags ?? []).length > 0 ? (
            <span className="d-flex flex-wrap gap-1">
              {c.flags.map((f) => (
                <Badge key={f} bg="warning" text="dark" style={{ fontSize: '0.68rem' }}>
                  {f}
                </Badge>
              ))}
            </span>
          ) : null,
      },
      {
        key: 'createdAt',
        label: t('crm.created'),
        sortable: true,
        filterType: 'date' as const,
        accessor: (c: Customer) => c.createdAt,
        category: 'system',
        flex: '0 0 110px',
        render: (c: Customer) => (
          <span className="text-muted" style={{ fontSize: '0.8rem' }}>
            {formatRelativeDate(c.createdAt)}
          </span>
        ),
      },
      {
        key: 'website',
        label: t('crm.website'),
        sortable: true,
        filterType: 'text' as const,
        accessor: (c: Customer) => c.website ?? '',
        category: 'crm',
        flex: '0 0 140px',
      },
    ],
    [t, stages, staff, customers]
  );

  const columnMap = useMemo(() => {
    const map = new Map<string, CrmColumnDef>();
    for (const col of columns) map.set(col.key, col);
    return map;
  }, [columns]);

  const visibleColumns = useMemo(
    () => visibleColumnKeys.map((key) => columns.find((c) => c.key === key)).filter(Boolean) as CrmColumnDef[],
    [columns, visibleColumnKeys]
  );

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

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filteredCustomers = useMemo(() => {
    let result = customers;

    // Quick filter (pills)
    switch (activeFilter) {
      case 'active_tickets':
        result = result.filter((c) => c.openTicketCount > 0);
        break;
      case 'at_risk':
        result = result.filter((c) =>
          c.flags.some((f) => f.toLowerCase().includes('at_risk') || f.toLowerCase().includes('at-risk'))
        );
        break;
      case 'prospects':
        if (stages.length > 0) result = result.filter((c) => c.lifecycleStage === stages[0].id);
        break;
      default:
        break;
    }

    // Quick dropdown filters
    if (quickStageFilter.length > 0) {
      result = result.filter((c) => quickStageFilter.includes(c.lifecycleStage));
    }
    if (quickTerritoryFilter.length > 0) {
      result = result.filter((c) => c.territory && quickTerritoryFilter.includes(c.territory));
    }
    if (quickOwnerFilter.length > 0) {
      result = result.filter((c) => c.ownerId && quickOwnerFilter.includes(c.ownerId));
    }
    if (quickIndustryFilter.length > 0) {
      result = result.filter((c) => c.industry && quickIndustryFilter.includes(c.industry));
    }

    // Text search
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      result = result.filter(
        (c) =>
          c.companyName.toLowerCase().includes(q) ||
          (c.industry && c.industry.toLowerCase().includes(q)) ||
          (c.territory && c.territory.toLowerCase().includes(q)) ||
          (c.ownerName && c.ownerName.toLowerCase().includes(q))
      );
    }

    // Per-column filters
    if (Object.keys(activeFilters).length > 0) {
      result = result.filter((c) => {
        for (const [colKey, filter] of Object.entries(activeFilters)) {
          const colDef = columnMap.get(colKey);
          if (!colDef) continue;
          const value = colDef.accessor(c);
          if (!matchesFilter(value, filter, colDef.filterType)) return false;
        }
        return true;
      });
    }

    // Sorting (list view only)
    if (viewMode === 'list') {
      const sortCol = columnMap.get(sortColumn);
      if (sortCol) {
        result = [...result].sort((a, b) => compareValues(sortCol.accessor(a), sortCol.accessor(b), sortDirection));
      }
    }

    return result;
  }, [
    customers,
    activeFilter,
    debouncedSearch,
    stages,
    quickStageFilter,
    quickTerritoryFilter,
    quickOwnerFilter,
    quickIndustryFilter,
    activeFilters,
    columnMap,
    sortColumn,
    sortDirection,
    viewMode,
  ]);

  const filterCounts = useMemo(
    () => ({
      all: customers.length,
      active_tickets: customers.filter((c) => c.openTicketCount > 0).length,
      at_risk: customers.filter((c) =>
        c.flags.some((f) => f.toLowerCase().includes('at_risk') || f.toLowerCase().includes('at-risk'))
      ).length,
      prospects: stages.length > 0 ? customers.filter((c) => c.lifecycleStage === stages[0].id).length : 0,
    }),
    [customers, stages]
  );

  // ── Quick filter options ──────────────────────────────────────────────────
  const stageOptions = useMemo(() => stages.map((s) => ({ value: s.id, label: s.name })), [stages]);
  const territoryOptions = useMemo(() => {
    const set = new Set(customers.map((c) => c.territory).filter(Boolean) as string[]);
    return Array.from(set)
      .sort()
      .map((t) => ({ value: t, label: t }));
  }, [customers]);
  const ownerOptions = useMemo(
    () => staff.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name || s.email })),
    [staff]
  );
  const industryOptions = useMemo(() => {
    const set = new Set(customers.map((c) => c.industry).filter(Boolean) as string[]);
    return Array.from(set)
      .sort()
      .map((i) => ({ value: i, label: i }));
  }, [customers]);

  // ── Sort handler ──────────────────────────────────────────────────────────
  const handleSort = useCallback((column: string, direction: SortDirection) => {
    setSortColumn(column);
    setSortDirection(direction);
  }, []);

  // ── Column filter handlers ────────────────────────────────────────────────
  const handleApplyFilter = useCallback((colKey: string, filter: FilterEntry) => {
    setActiveFilters((prev) => ({ ...prev, [colKey]: filter }));
  }, []);

  const handleClearFilter = useCallback((colKey: string) => {
    setActiveFilters((prev) => {
      const next = { ...prev };
      delete next[colKey];
      return next;
    });
  }, []);

  // ── Column picker ─────────────────────────────────────────────────────────
  const pickerColumns: PickerColumnDef[] = useMemo(
    () =>
      columns.map((col) => ({
        id: col.key,
        label: col.label,
        category: col.category ?? 'crm',
        visible: visibleColumnKeys.includes(col.key),
      })),
    [columns, visibleColumnKeys]
  );

  const handleColumnsChange = useCallback((updated: PickerColumnDef[]) => {
    setVisibleColumnKeys(updated.filter((c) => c.visible).map((c) => c.id));
  }, []);

  // ── View summary (for save modal) ────────────────────────────────────────
  const viewSummary = useMemo(() => {
    const filterCount = Object.keys(activeFilters).length;
    const filterDetails = Object.entries(activeFilters).map(([key, filter]) => {
      const col = columnMap.get(key);
      return {
        label: col?.label ?? key,
        value:
          filter.operator === 'in' && Array.isArray(filter.value)
            ? `${(filter.value as string[]).length} selected`
            : `${filter.operator}: ${String(filter.value)}`,
      };
    });
    return {
      scope: t('crm.allCustomers'),
      columnCount: visibleColumnKeys.length,
      sortColumn: columnMap.get(sortColumn)?.label ?? sortColumn,
      sortDirection,
      filterCount,
      filterDetails,
    };
  }, [activeFilters, visibleColumnKeys, sortColumn, sortDirection, columnMap, t]);

  // ── Create customer ──────────────────────────────────────────────────────
  const defaultCreateStageId = stages.length > 0 ? stages[0].id : undefined;

  const handleOpenCreateCustomer = useCallback(() => {
    setError(null);
    setShowCreate(true);
  }, []);

  const handleCustomerCreated = useCallback((newCustomer: Customer) => {
    setCustomers((prev) => [newCustomer, ...prev]);
    setShowCreate(false);
    setDetailCustomerId(newCustomer.id);
    setShowDetail(true);
  }, []);

  // ── Click handler ────────────────────────────────────────────────────────
  const handleCustomerClick = useCallback((customer: Customer) => {
    setDetailCustomerId(customer.id);
    setShowDetail(true);
  }, []);

  // ── Drag handlers ────────────────────────────────────────────────────────
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setActiveCustomer(filteredCustomers.find((c) => c.id === event.active.id) ?? null);
    },
    [filteredCustomers]
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
    [customers]
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

      if (customer.lifecycleStage === newStageId && customer.order === newOrder) return;

      setCustomers((prev) =>
        prev.map((c) => (c.id === customer.id ? { ...c, lifecycleStage: newStageId!, order: newOrder } : c))
      );

      try {
        await OpsService.updateCustomer(numaPut, customer.id, { lifecycleStage: newStageId, order: newOrder });
      } catch (err) {
        console.error('[CrmMirrorView] Failed to update customer stage:', err);
        await loadCustomers();
      }
    },
    [customers, filteredCustomers, numaPut, loadCustomers]
  );

  // ── Grouped by stage ──────────────────────────────────────────────────────
  const customersByStage = useMemo(() => {
    const map = new Map<string, Customer[]>();
    for (const stage of stages) {
      map.set(
        stage.id,
        filteredCustomers.filter((c) => c.lifecycleStage === stage.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      );
    }
    return map;
  }, [filteredCustomers, stages]);

  // ── Active filter count (for toolbar badge) ──────────────────────────────
  const totalActiveFilterCount =
    Object.keys(activeFilters).length +
    quickStageFilter.length +
    quickTerritoryFilter.length +
    quickOwnerFilter.length +
    quickIndustryFilter.length;

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
        {/* ── Toolbar ──────────────────────────────────────────────────── */}
        <div
          className="d-flex flex-wrap align-items-center gap-2 px-3 py-2 border-bottom bg-white"
          style={{ minHeight: 48 }}
        >
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

          {/* Controls */}
          <div className="d-flex align-items-center gap-2">
            <LoadViewDropdown
              savedViews={savedViews}
              currentViewName={currentViewName}
              isModified={isViewModified}
              onLoad={handleLoadView}
              onDelete={handleDeleteView}
              onClear={handleClearView}
            />

            {viewMode === 'list' && (
              <button
                type="button"
                className="btn btn-sm d-inline-flex align-items-center gap-1"
                style={{
                  backgroundColor: '#f8f9fa',
                  border: '1px solid #dee2e6',
                  borderRadius: 8,
                  color: '#495057',
                }}
                onClick={() => setShowColumnPicker(true)}
              >
                <i className="bi bi-layout-three-columns" />
                {t('columns.manage')}
              </button>
            )}

            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => setShowSaveViewModal(true)}
              className="d-inline-flex align-items-center gap-1"
            >
              <i className="bi bi-bookmark" />
              {t('filters.saveView')}
            </Button>

            <span className="text-muted" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
              {filteredCustomers.length} {filteredCustomers.length === 1 ? 'customer' : 'customers'}
            </span>

            <Button variant="primary" size="sm" onClick={handleOpenCreateCustomer}>
              <i className="bi bi-plus me-1" />
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

        {/* ── Filter bar (shared across board + list) ─────────────────── */}
        {(stageOptions.length > 0 ||
          territoryOptions.length > 0 ||
          ownerOptions.length > 0 ||
          industryOptions.length > 0) && (
          <div
            className="d-flex flex-wrap align-items-center gap-2 px-3 py-2 border-bottom"
            style={{ backgroundColor: '#fafbfc' }}
          >
            <QuickFilterDropdown
              label={t('crm.allStages')}
              options={stageOptions}
              selected={quickStageFilter}
              onChange={setQuickStageFilter}
            />
            <QuickFilterDropdown
              label={t('crm.allTerritories')}
              options={territoryOptions}
              selected={quickTerritoryFilter}
              onChange={setQuickTerritoryFilter}
            />
            <QuickFilterDropdown
              label={t('crm.allOwners')}
              options={ownerOptions}
              selected={quickOwnerFilter}
              onChange={setQuickOwnerFilter}
            />
            <QuickFilterDropdown
              label={t('crm.allIndustries')}
              options={industryOptions}
              selected={quickIndustryFilter}
              onChange={setQuickIndustryFilter}
            />

            {totalActiveFilterCount > 0 && (
              <button
                type="button"
                className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
                onClick={() => {
                  setActiveFilters({});
                  setQuickStageFilter([]);
                  setQuickTerritoryFilter([]);
                  setQuickOwnerFilter([]);
                  setQuickIndustryFilter([]);
                }}
              >
                <i className="bi bi-x-circle" />
                {t('filters.clearAll')}
              </button>
            )}
          </div>
        )}

        {/* ── Board or List content ────────────────────────────────────── */}
        {error && (
          <div className="px-3">
            <Alert variant="danger" onClose={() => setError(null)} dismissible className="py-2 mb-0">
              {error}
            </Alert>
          </div>
        )}
        <div className="flex-grow-1 overflow-auto px-3 pb-3 pt-3">
          {viewMode === 'list' ? (
            <div style={{ borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden', backgroundColor: '#fff' }}>
              {/* Header row with FilterDropdown per column */}
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
                  gap: 8,
                }}
              >
                {visibleColumns.map((col) => (
                  <div key={col.key} style={{ flex: col.flex ?? '1 1 0', minWidth: 0, paddingRight: 4 }}>
                    <FilterDropdown
                      column={col.key}
                      columnLabel={col.label}
                      columnType={col.filterType}
                      options={col.filterOptions?.()}
                      currentFilter={activeFilters[col.key]}
                      onApply={(filter) => handleApplyFilter(col.key, filter)}
                      onClear={() => handleClearFilter(col.key)}
                      sortable={col.sortable}
                      currentSortColumn={sortColumn}
                      currentSortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  </div>
                ))}
              </div>

              {/* Data rows */}
              {filteredCustomers.length === 0 ? (
                <div className="text-center py-5">
                  <i className="bi bi-people fs-1 d-block mb-2" style={{ color: '#d1d5db' }} />
                  <span style={{ color: '#9ca3af', fontSize: '0.9rem' }}>{t('empty.noCustomers')}</span>
                </div>
              ) : (
                filteredCustomers.map((customer) => (
                  <div
                    key={customer.id}
                    className="d-flex align-items-center px-3 py-2"
                    style={{
                      borderBottom: '1px solid #f3f4f6',
                      cursor: 'pointer',
                      transition: 'background-color 0.1s',
                      gap: 8,
                    }}
                    onClick={() => handleCustomerClick(customer)}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = '#f9fafb';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleCustomerClick(customer);
                    }}
                  >
                    {visibleColumns.map((col) => (
                      <div
                        key={col.key}
                        style={{
                          flex: col.flex ?? '1 1 0',
                          minWidth: 0,
                          paddingRight: 4,
                          fontSize: '0.82rem',
                          color: '#374151',
                        }}
                      >
                        {col.render ? (
                          col.render(customer)
                        ) : (
                          <span className="text-truncate d-block" title={String(col.accessor(customer) ?? '')}>
                            {String(col.accessor(customer) ?? '') || <span className="text-muted">-</span>}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
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
                    staff={config?.staff}
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
                      staff={config?.staff}
                      onClick={() => {}}
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

      <CreateCustomerModal
        show={showCreate}
        onHide={() => setShowCreate(false)}
        onCreated={handleCustomerCreated}
        defaultLifecycleStage={defaultCreateStageId}
      />

      <ColumnPicker
        show={showColumnPicker}
        onHide={() => setShowColumnPicker(false)}
        columns={pickerColumns}
        onColumnsChange={handleColumnsChange}
      />

      <SaveViewModal
        show={showSaveViewModal}
        onHide={() => setShowSaveViewModal(false)}
        onSave={handleSaveView}
        currentViewName={currentViewName}
        onUpdate={handleUpdateView}
        viewSummary={viewSummary}
      />
    </>
  );
};

export default CrmMirrorView;
