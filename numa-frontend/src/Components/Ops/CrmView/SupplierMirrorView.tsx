import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import type { Supplier, SupplierConfig, StaffProfile, SavedFilter } from '../../../types/ops';
import { getCached, setCache } from '../../../utils/opsCache';
import { getColorForPosition, getContrastTextColor } from '../Shared/colorUtils';
import { formatRelativeDate } from '../Shared/ticketUtils';
import { SupplierCard } from './SupplierCard';
import { SupplierDetailModal } from '../Modals/SupplierDetailModal';
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

// ─── Constants ──────────────────────────────────────────────────────────────

const ORDER_GAP = 1000;
const TEAL_ACCENT = '#0d9488';

function calculateNewOrder(items: { order?: number }[], insertIndex: number): number {
  const defaultItems = items.map((item) => ({ ...item, order: item.order ?? 0 }));

  if (defaultItems.length === 0) return ORDER_GAP;
  if (insertIndex <= 0) return defaultItems[0].order - ORDER_GAP;
  if (insertIndex >= defaultItems.length) return defaultItems[defaultItems.length - 1].order + ORDER_GAP;
  const before = defaultItems[insertIndex - 1].order;
  const after = defaultItems[insertIndex].order;
  return Math.round((before + after) / 2);
}

type FilterMode = 'all' | 'with-tickets';
type ViewMode = 'board' | 'list';

// ─── Types ──────────────────────────────────────────────────────────────────

type SupplierColumnDef = {
  key: string;
  label: string;
  sortable: boolean;
  filterType: 'text' | 'enum' | 'date' | 'number';
  filterOptions?: () => { value: string; label: string }[];
  accessor: (s: Supplier) => unknown;
  render?: (s: Supplier) => React.ReactNode;
  defaultVisible?: boolean;
  category?: string;
  flex?: string;
};

type SupplierSavedViewConfig = {
  filters: ActiveFilters;
  visibleColumnKeys: string[];
  sortColumn: string;
  sortDirection: SortDirection;
  quickFilter: FilterMode;
  quickStageFilter: string[];
  quickOwnerFilter: string[];
  quickIndustryFilter: string[];
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatLastContact(
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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

const DEFAULT_VISIBLE_KEYS = [
  'companyName',
  'lifecycleStage',
  'primaryContact',
  'industry',
  'lastContactDate',
  'annualSpend',
  'openTicketCount',
];

// ─── Droppable Supplier Column ──────────────────────────────────────────────

interface DroppableSupplierColumnProps {
  stage: { id: string; name: string; colorPosition?: number };
  suppliers: Supplier[];
  supplierConfig: SupplierConfig;
  staff?: StaffProfile[];
  onSupplierClick: (s: Supplier) => void;
}

function DroppableSupplierColumn({
  stage,
  suppliers,
  supplierConfig,
  staff,
  onSupplierClick,
}: DroppableSupplierColumnProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}` });

  const stageColor = stage.colorPosition ? getColorForPosition(stage.colorPosition) : TEAL_ACCENT;
  const textColor = getContrastTextColor(stageColor);

  return (
    <div className="kanban-column" style={{ background: isOver ? '#f0fdfa' : undefined }}>
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
          {suppliers.length}
        </span>
      </div>

      <div ref={setNodeRef}>
        {suppliers.length === 0 && (
          <div className="text-center py-4">
            <i className="bi bi-truck" style={{ fontSize: '1.2rem', color: '#d1d5db' }} />
            <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 4 }}>{t('empty.noSuppliers')}</div>
          </div>
        )}
        <SortableContext items={suppliers.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {suppliers.map((supplier) => (
            <SupplierCard
              key={supplier.id}
              supplier={supplier}
              supplierConfig={supplierConfig}
              staff={staff}
              onClick={onSupplierClick}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SupplierMirrorView(): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaGet, numaPost } = useNumaRequest();
  const { config, crmRefreshVersion } = useOps();

  const supplierConfig = config?.supplierConfig ?? null;
  const stages = supplierConfig?.lifecycleStages ?? [];
  const staff = config?.staff ?? [];

  // ── State ────────────────────────────────────────────────────────────────
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => getCached<Supplier[]>('suppliers') ?? []);
  const [loading, setLoading] = useState(() => !getCached('suppliers'));
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem('numa_ops_suppliers_view_mode');
      return saved === 'board' ? 'board' : 'list';
    } catch {
      return 'list';
    }
  });

  // List view state
  const [sortColumn, setSortColumn] = useState<string>('companyName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({});
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(DEFAULT_VISIBLE_KEYS);
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  // Quick filter dropdowns
  const [quickStageFilter, setQuickStageFilter] = useState<string[]>([]);
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
      localStorage.setItem('numa_ops_suppliers_view_mode', mode);
    } catch {
      /* quota exceeded */
    }
  }, []);

  // DnD
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeSupplier, setActiveSupplier] = useState<Supplier | null>(null);
  const [creatingSupplier, setCreatingSupplier] = useState(false);

  // Detail modal
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // ── Debounced search ──────────────────────────────────────────────────────
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchQuery]);

  // ── Saved view helpers ────────────────────────────────────────────────────
  const buildCurrentViewConfig = useCallback(
    (): SupplierSavedViewConfig => ({
      filters: activeFilters,
      visibleColumnKeys,
      sortColumn,
      sortDirection,
      quickFilter: filterMode,
      quickStageFilter,
      quickOwnerFilter,
      quickIndustryFilter,
    }),
    [
      activeFilters,
      visibleColumnKeys,
      sortColumn,
      sortDirection,
      filterMode,
      quickStageFilter,
      quickOwnerFilter,
      quickIndustryFilter,
    ]
  );

  const isViewModified = useMemo(() => {
    if (!viewSnapshot) return false;
    return JSON.stringify(buildCurrentViewConfig()) !== viewSnapshot;
  }, [buildCurrentViewConfig, viewSnapshot]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('numa_ops_supplier_saved_views');
      if (raw) setSavedViews(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const persistSavedViews = useCallback((views: SavedFilter[]) => {
    setSavedViews(views);
    try {
      localStorage.setItem('numa_ops_supplier_saved_views', JSON.stringify(views));
    } catch {
      /* quota exceeded */
    }
  }, []);

  const handleSaveView = useCallback(
    (name: string) => {
      const cfg = buildCurrentViewConfig();
      const view: SavedFilter = { name, config: cfg as unknown as Record<string, unknown> };
      const updated = [...savedViews.filter((v) => v.name !== name), view];
      persistSavedViews(updated);
      setCurrentViewName(name);
      setViewSnapshot(JSON.stringify(cfg));
    },
    [buildCurrentViewConfig, savedViews, persistSavedViews]
  );

  const handleUpdateView = useCallback(() => {
    if (!currentViewName) return;
    handleSaveView(currentViewName);
  }, [currentViewName, handleSaveView]);

  const handleLoadView = useCallback((view: SavedFilter) => {
    const cfg = view.config as unknown as SupplierSavedViewConfig;
    if (cfg.filters) setActiveFilters(cfg.filters);
    if (cfg.visibleColumnKeys) setVisibleColumnKeys(cfg.visibleColumnKeys);
    if (cfg.sortColumn) setSortColumn(cfg.sortColumn);
    if (cfg.sortDirection) setSortDirection(cfg.sortDirection);
    if (cfg.quickFilter) setFilterMode(cfg.quickFilter);
    if (cfg.quickStageFilter) setQuickStageFilter(cfg.quickStageFilter);
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
  const columns: SupplierColumnDef[] = useMemo(
    () => [
      {
        key: 'companyName',
        label: t('common.name'),
        sortable: true,
        filterType: 'text' as const,
        accessor: (s: Supplier) => s.companyName,
        defaultVisible: true,
        category: 'system',
        flex: '1 1 0',
        render: (s: Supplier) => (
          <span
            className="fw-semibold d-block text-truncate"
            style={{ fontSize: '0.85rem', color: '#111827' }}
            title={s.companyName}
          >
            {s.companyName}
          </span>
        ),
      },
      {
        key: 'lifecycleStage',
        label: t('crm.lifecycleStage'),
        sortable: true,
        filterType: 'enum' as const,
        filterOptions: () => stages.map((s) => ({ value: s.id, label: s.name })),
        accessor: (s: Supplier) => s.lifecycleStage,
        defaultVisible: true,
        category: 'crm',
        flex: '0 0 130px',
        render: (s: Supplier) => {
          const stage = stages.find((st) => st.id === s.lifecycleStage);
          const stageColor = stage ? getColorForPosition(stage.colorPosition) : '#6c757d';
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
        accessor: (s: Supplier) => {
          const pc = s.contacts?.find((ct) => ct.isPrimary);
          return pc?.name ?? '';
        },
        defaultVisible: true,
        category: 'crm',
        flex: '0 0 180px',
        render: (s: Supplier) => {
          const pc = s.contacts?.find((ct) => ct.isPrimary);
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
          const industries = new Set(suppliers.map((s) => s.industry).filter(Boolean) as string[]);
          return Array.from(industries)
            .sort()
            .map((i) => ({ value: i, label: i }));
        },
        accessor: (s: Supplier) => s.industry ?? '',
        defaultVisible: true,
        category: 'crm',
        flex: '0 0 130px',
      },
      {
        key: 'ownerName',
        label: t('crm.owner'),
        sortable: true,
        filterType: 'enum' as const,
        filterOptions: () => staff.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name || s.email })),
        accessor: (s: Supplier) => s.ownerName ?? '',
        category: 'crm',
        flex: '0 0 140px',
        render: (s: Supplier) => {
          const st = s.ownerId ? staff.find((stf) => stf.id === s.ownerId) : undefined;
          return st || s.ownerName ? (
            <span className="d-inline-flex align-items-center gap-2">
              <StaffAvatar staff={st} name={!st ? (s.ownerName ?? undefined) : undefined} size={22} />
              <span className="text-truncate" style={{ fontSize: '0.82rem' }}>
                {st ? st.name || st.email : s.ownerName}
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
        key: 'annualSpend',
        label: t('suppliers.annualSpend'),
        sortable: true,
        filterType: 'number' as const,
        accessor: (s: Supplier) => s.annualSpend ?? 0,
        defaultVisible: true,
        category: 'crm',
        flex: '0 0 120px',
        render: (s: Supplier) =>
          s.annualSpend != null && s.annualSpend > 0 ? (
            <span style={{ color: TEAL_ACCENT, fontWeight: 600, fontSize: '0.82rem' }}>
              {formatCurrency(s.annualSpend)}
            </span>
          ) : (
            <span className="text-muted">-</span>
          ),
      },
      {
        key: 'paymentTerms',
        label: t('suppliers.paymentTerms'),
        sortable: true,
        filterType: 'enum' as const,
        filterOptions: () => {
          const terms = new Set(suppliers.map((s) => s.paymentTerms).filter(Boolean) as string[]);
          return Array.from(terms)
            .sort()
            .map((t) => ({ value: t, label: t }));
        },
        accessor: (s: Supplier) => s.paymentTerms ?? '',
        category: 'crm',
        flex: '0 0 110px',
      },
      {
        key: 'lastContactDate',
        label: t('crm.lastContact'),
        sortable: true,
        filterType: 'date' as const,
        accessor: (s: Supplier) => s.lastContactDate ?? '',
        defaultVisible: true,
        category: 'crm',
        flex: '0 0 120px',
        render: (s: Supplier) => {
          const label = formatLastContact(s.lastContactDate, t);
          return (
            <span style={{ fontSize: '0.78rem', color: !s.lastContactDate ? '#d1d5db' : '#6b7280' }}>{label}</span>
          );
        },
      },
      {
        key: 'openTicketCount',
        label: t('crm.openTickets'),
        sortable: true,
        filterType: 'number' as const,
        accessor: (s: Supplier) => s.openTicketCount ?? 0,
        defaultVisible: true,
        category: 'system',
        flex: '0 0 80px',
        render: (s: Supplier) =>
          s.openTicketCount > 0 ? (
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
              {s.openTicketCount}
            </span>
          ) : (
            <span style={{ color: '#d1d5db', fontSize: '0.78rem' }}>-</span>
          ),
      },
      {
        key: 'createdAt',
        label: t('crm.created'),
        sortable: true,
        filterType: 'date' as const,
        accessor: (s: Supplier) => s.createdAt,
        category: 'system',
        flex: '0 0 110px',
        render: (s: Supplier) => (
          <span className="text-muted" style={{ fontSize: '0.8rem' }}>
            {formatRelativeDate(s.createdAt)}
          </span>
        ),
      },
      {
        key: 'flags',
        label: t('crm.flags'),
        sortable: false,
        filterType: 'text' as const,
        accessor: (s: Supplier) => (s.flags ?? []).join(', '),
        category: 'crm',
        flex: '0 0 100px',
        render: (s: Supplier) =>
          (s.flags ?? []).length > 0 ? (
            <span className="d-flex flex-wrap gap-1">
              {s.flags.map((f) => (
                <Badge key={f} bg="warning" text="dark" style={{ fontSize: '0.68rem' }}>
                  {f}
                </Badge>
              ))}
            </span>
          ) : null,
      },
      {
        key: 'website',
        label: t('crm.website'),
        sortable: true,
        filterType: 'text' as const,
        accessor: (s: Supplier) => s.website ?? '',
        category: 'crm',
        flex: '0 0 140px',
      },
    ],
    [t, stages, staff, suppliers]
  );

  const columnMap = useMemo(() => {
    const map = new Map<string, SupplierColumnDef>();
    for (const col of columns) map.set(col.key, col);
    return map;
  }, [columns]);

  const visibleColumns = useMemo(
    () => visibleColumnKeys.map((key) => columns.find((c) => c.key === key)).filter(Boolean) as SupplierColumnDef[],
    [columns, visibleColumnKeys]
  );

  // ── Quick filter options ──────────────────────────────────────────────────
  const stageOptions = useMemo(() => stages.map((s) => ({ value: s.id, label: s.name })), [stages]);
  const ownerOptions = useMemo(
    () => staff.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name || s.email })),
    [staff]
  );
  const industryOptions = useMemo(() => {
    const set = new Set(suppliers.map((s) => s.industry).filter(Boolean) as string[]);
    return Array.from(set)
      .sort()
      .map((i) => ({ value: i, label: i }));
  }, [suppliers]);

  // ── Sort / filter handlers ────────────────────────────────────────────────
  const handleSort = useCallback((column: string, direction: SortDirection) => {
    setSortColumn(column);
    setSortDirection(direction);
  }, []);

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

  // ── View summary ──────────────────────────────────────────────────────────
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
      scope: t('suppliers.allSuppliers'),
      columnCount: visibleColumnKeys.length,
      sortColumn: columnMap.get(sortColumn)?.label ?? sortColumn,
      sortDirection,
      filterCount,
      filterDetails,
    };
  }, [activeFilters, visibleColumnKeys, sortColumn, sortDirection, columnMap, t]);

  // ── Data Loading ──────────────────────────────────────────────────────────
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

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filteredSuppliers = useMemo(() => {
    let result = suppliers;

    // Quick filter pill
    if (filterMode === 'with-tickets') {
      result = result.filter((s) => s.openTicketCount > 0);
    }

    // Quick dropdown filters
    if (quickStageFilter.length > 0) {
      result = result.filter((s) => quickStageFilter.includes(s.lifecycleStage));
    }
    if (quickOwnerFilter.length > 0) {
      result = result.filter((s) => s.ownerId && quickOwnerFilter.includes(s.ownerId));
    }
    if (quickIndustryFilter.length > 0) {
      result = result.filter((s) => s.industry && quickIndustryFilter.includes(s.industry));
    }

    // Text search
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      result = result.filter(
        (s) =>
          s.companyName.toLowerCase().includes(q) ||
          (s.industry && s.industry.toLowerCase().includes(q)) ||
          (s.ownerName && s.ownerName.toLowerCase().includes(q))
      );
    }

    // Per-column filters
    if (Object.keys(activeFilters).length > 0) {
      result = result.filter((s) => {
        for (const [colKey, filter] of Object.entries(activeFilters)) {
          const colDef = columnMap.get(colKey);
          if (!colDef) continue;
          if (!matchesFilter(colDef.accessor(s), filter, colDef.filterType)) return false;
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
    suppliers,
    filterMode,
    debouncedSearch,
    quickStageFilter,
    quickOwnerFilter,
    quickIndustryFilter,
    activeFilters,
    columnMap,
    sortColumn,
    sortDirection,
    viewMode,
  ]);

  const totalCount = suppliers.length;
  const withTicketsCount = useMemo(() => suppliers.filter((s) => s.openTicketCount > 0).length, [suppliers]);
  const totalActiveFilterCount =
    Object.keys(activeFilters).length + quickStageFilter.length + quickOwnerFilter.length + quickIndustryFilter.length;

  // ── Create Supplier ───────────────────────────────────────────────────────
  const handleCreateSupplier = useCallback(async () => {
    try {
      setCreatingSupplier(true);
      const defaultStageId = stages.length > 0 ? stages[0].id : undefined;
      const newSupplier = await OpsService.createSupplier(numaPost, {
        companyName: t('suppliers.newSupplierDefaultName', 'New Supplier'),
        lifecycleStage: defaultStageId,
      });
      if (defaultStageId && !newSupplier.lifecycleStage) {
        newSupplier.lifecycleStage = defaultStageId;
      }
      setSuppliers((prev) => [newSupplier, ...prev]);
      setSelectedSupplierId(newSupplier.id);
      setShowDetail(true);
    } catch (err) {
      console.error('[SupplierMirrorView] Create supplier failed', err);
    } finally {
      setCreatingSupplier(false);
    }
  }, [numaPost, t, stages]);

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const supplier = filteredSuppliers.find((s) => s.id === event.active.id);
      if (supplier) setActiveSupplier(supplier);
    },
    [filteredSuppliers]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      const overId = over?.id;
      if (!overId || active.id === overId) return;

      const activeSup = suppliers.find((s) => s.id === active.id);
      const overSup = suppliers.find((s) => s.id === overId);
      const isOverColumn = String(overId).startsWith('stage-');
      if (!activeSup) return;

      const activeStageId = activeSup.lifecycleStage;
      const overStageId = isOverColumn ? String(overId).replace('stage-', '') : overSup?.lifecycleStage;
      if (!overStageId || activeStageId === overStageId) return;

      setSuppliers((prev) => {
        const overItems = prev
          .filter((s) => s.lifecycleStage === overStageId)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        let overIndex = overItems.length;
        if (!isOverColumn && overSup) {
          overIndex = overItems.findIndex((s) => s.id === overId);
          const isBelow =
            over.rect &&
            active.rect.current.translated &&
            active.rect.current.translated.top > over.rect.top + over.rect.height / 2;
          overIndex += isBelow ? 1 : 0;
        }
        return prev.map((s) =>
          s.id === active.id ? { ...s, lifecycleStage: overStageId, order: calculateNewOrder(overItems, overIndex) } : s
        );
      });
    },
    [suppliers]
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
        const overSup = suppliers.find((s) => s.id === overId);
        if (overSup) newStageId = overSup.lifecycleStage;
      }
      if (!newStageId) return;

      const supplier = suppliers.find((s) => s.id === active.id);
      if (!supplier) return;

      const destSuppliers = filteredSuppliers
        .filter((s) => s.id !== supplier.id && s.lifecycleStage === newStageId)
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

      setSuppliers((prev) =>
        prev.map((s) => (s.id === supplier.id ? { ...s, lifecycleStage: newStageId!, order: newOrder } : s))
      );

      try {
        await OpsService.updateSupplier(numaPost, supplier.id, { lifecycleStage: newStageId, order: newOrder });
      } catch (err) {
        console.error('[SupplierMirrorView] Failed to update supplier stage:', err);
        await loadSuppliers();
      }
    },
    [suppliers, filteredSuppliers, numaPost, loadSuppliers]
  );

  const openDetail = useCallback((supplier: Supplier) => {
    setSelectedSupplierId(supplier.id);
    setShowDetail(true);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading && suppliers.length === 0) {
    return (
      <div className="d-flex justify-content-center align-items-center p-5">
        <Spinner animation="border" style={{ color: TEAL_ACCENT }} />
      </div>
    );
  }

  return (
    <div className="d-flex flex-column h-100">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div
        className="d-flex flex-wrap align-items-center gap-2 px-3 py-2 border-bottom bg-white"
        style={{ minHeight: 48 }}
      >
        <Form.Control
          size="sm"
          type="text"
          placeholder={t('crm.searchSuppliers')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ maxWidth: 210, borderRadius: 8 }}
        />

        {/* Quick filter pills */}
        <div className="d-flex gap-1">
          {[
            { key: 'all' as FilterMode, label: t('suppliers.allSuppliers'), count: totalCount },
            { key: 'with-tickets' as FilterMode, label: t('crm.withTickets'), count: withTicketsCount },
          ].map(({ key, label, count }) => {
            const isActive = filterMode === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilterMode(key)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '4px 12px',
                  borderRadius: 100,
                  border: isActive ? 'none' : '1px solid #e5e7eb',
                  background: isActive ? TEAL_ACCENT : '#fff',
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
          {viewMode === 'list' && (
            <>
              <LoadViewDropdown
                savedViews={savedViews}
                currentViewName={currentViewName}
                isModified={isViewModified}
                onLoad={handleLoadView}
                onDelete={handleDeleteView}
                onClear={handleClearView}
              />

              <button
                type="button"
                className="btn btn-sm d-inline-flex align-items-center gap-1"
                style={{ backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: 8, color: '#495057' }}
                onClick={() => setShowColumnPicker(true)}
              >
                <i className="bi bi-layout-three-columns" />
                {t('columns.manage')}
              </button>

              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => setShowSaveViewModal(true)}
                className="d-inline-flex align-items-center gap-1"
              >
                <i className="bi bi-bookmark" />
                {t('filters.saveView')}
              </Button>
            </>
          )}

          <span className="text-muted" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
            {filteredSuppliers.length} {filteredSuppliers.length === 1 ? 'supplier' : 'suppliers'}
          </span>

          <Button variant="primary" size="sm" onClick={handleCreateSupplier} disabled={creatingSupplier}>
            {creatingSupplier ? (
              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
            ) : (
              <i className="bi bi-plus me-1" />
            )}
            {t('suppliers.newSupplier')}
          </Button>

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
        </div>
      </div>

      {/* ── Filter bar (shared across board + list) ───────────────────── */}
      {(stageOptions.length > 0 || ownerOptions.length > 0 || industryOptions.length > 0) && (
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

      {/* ── Board or List content ──────────────────────────────────────── */}
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
            {filteredSuppliers.length === 0 ? (
              <div className="text-center py-5">
                <i className="bi bi-truck fs-1 d-block mb-2" style={{ color: '#d1d5db' }} />
                <span style={{ color: '#9ca3af', fontSize: '0.9rem' }}>{t('empty.noSuppliers')}</span>
              </div>
            ) : (
              filteredSuppliers.map((supplier) => (
                <div
                  key={supplier.id}
                  className="d-flex align-items-center px-3 py-2"
                  style={{
                    borderBottom: '1px solid #f3f4f6',
                    cursor: 'pointer',
                    transition: 'background-color 0.1s',
                    gap: 8,
                  }}
                  onClick={() => openDetail(supplier)}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#f9fafb';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') openDetail(supplier);
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
                        col.render(supplier)
                      ) : (
                        <span className="text-truncate d-block" title={String(col.accessor(supplier) ?? '')}>
                          {String(col.accessor(supplier) ?? '') || <span className="text-muted">-</span>}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
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
                    staff={config?.staff}
                    onSupplierClick={openDetail}
                  />
                );
              })}
            </div>
            <DragOverlay>
              {activeSupplier ? (
                <div style={{ transform: 'scale(1.02)', opacity: 0.9 }}>
                  <SupplierCard
                    supplier={activeSupplier}
                    supplierConfig={supplierConfig!}
                    staff={config?.staff}
                    onClick={() => {}}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <SupplierDetailModal
        show={showDetail}
        supplierId={selectedSupplierId}
        onHide={() => {
          setShowDetail(false);
          setSelectedSupplierId(null);
        }}
        onUpdated={() => loadSuppliers()}
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
    </div>
  );
}
