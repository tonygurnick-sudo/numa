import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import Table from 'react-bootstrap/Table';
import Form from 'react-bootstrap/Form';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../Providers/AuthProvider';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import { StageBadge } from '../Shared/StageBadge';
import { PriorityIndicator } from '../Shared/PriorityIndicator';
import { SprintBadge } from '../Shared/SprintBadge';
import { DueDateBadge } from '../Shared/DueDateBadge';
import { formatRelativeDate } from '../Shared/ticketUtils';
import { FilterDropdown, EMPTY_SENTINEL } from './FilterDropdown';
import { QuickFilterDropdown } from './QuickFilterDropdown';
import { CustomerFiltersDropdown } from './CustomerFiltersDropdown';
import { EMPTY_CUSTOMER_FILTERS, hasActiveCustomerFilters, type CustomerFilterState } from './customerFilterTypes';
import { ColumnPicker, type ColumnDef as PickerColumnDef } from './ColumnPicker';
import { BulkEditPanel } from './BulkEditPanel';
import { TicketDetailModal } from '../Modals/TicketDetailModal';
import ContextMenu from '../ContextMenu';
import { StaffAvatar } from '../Shared/StaffAvatar';
import type { Ticket, SavedFilter, Customer } from '../../../types/ops';
import { getTicketTypeIconClass } from '../../../constants/opsConstants';

// ─── Types ──────────────────────────────────────────────────────────────────

type SortDirection = 'asc' | 'desc';
type FilterEntry = { operator: string; value: unknown };
type ActiveFilters = Record<string, FilterEntry>;

type ColumnDef = {
  key: string;
  label: string;
  sortable: boolean;
  filterType: 'text' | 'enum' | 'date' | 'number';
  filterOptions?: () => { value: string; label: string }[];
  accessor: (t: Ticket) => unknown;
  render?: (t: Ticket) => React.ReactNode;
};

// Saved view config — persisted to backend via UserPreference API
type SavedViewConfig = {
  filters: ActiveFilters;
  visibleColumnKeys: string[];
  sortColumn: string;
  sortDirection: SortDirection;
  quickStatusFilter: string[];
  quickSprintFilter: string[];
  customerFilters: CustomerFilterState;
};

// Default visible columns — matches CEO's design (9 columns)
const DEFAULT_VISIBLE_KEYS = [
  'displayId',
  'title',
  'ticketTypeId',
  'stageId',
  'workUnit',
  'priority',
  'dueDate',
  'assigneeName',
  'customerName',
];

const MOBILE_KEEP_KEYS = ['displayId', 'title', 'stageId', 'dueDate'];

// ─── Helpers ────────────────────────────────────────────────────────────────

function getDatePresetRange(preset: string): { start: Date; end: Date } {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case 'today':
      return { start: startOfDay, end: new Date(startOfDay.getTime() + 86400000 - 1) };
    case 'thisWeek': {
      const day = now.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const monday = new Date(startOfDay);
      monday.setDate(monday.getDate() + mondayOffset);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);
      return { start: monday, end: sunday };
    }
    case 'thisMonth':
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
      };
    case 'thisQuarter': {
      const q = Math.floor(now.getMonth() / 3);
      return {
        start: new Date(now.getFullYear(), q * 3, 1),
        end: new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999),
      };
    }
    default:
      return { start: startOfDay, end: new Date(startOfDay.getTime() + 86400000 - 1) };
  }
}

function matchesTextFilter(value: unknown, filter: FilterEntry): boolean {
  const str = String(value ?? '').toLowerCase();
  const target = String(filter.value ?? '').toLowerCase();
  switch (filter.operator) {
    case 'contains':
      return str.includes(target);
    case 'notContains':
      return !str.includes(target);
    case 'equals':
      return str === target;
    case 'notEquals':
      return str !== target;
    default:
      return true;
  }
}

function matchesEnumFilter(value: unknown, filter: FilterEntry): boolean {
  const selected = Array.isArray(filter.value) ? (filter.value as string[]) : [];
  if (selected.length === 0) return true;

  const hasEmpty = selected.includes(EMPTY_SENTINEL);
  const realSelected = selected.filter((v) => v !== EMPTY_SENTINEL);
  const strValue = String(value ?? '');

  // Match empty / null values
  if (hasEmpty && (!value || strValue === '')) return true;
  // Match against selected real values
  if (realSelected.length === 0) return hasEmpty ? !value || strValue === '' : true;
  return realSelected.includes(strValue);
}

function matchesDateFilter(value: unknown, filter: FilterEntry): boolean {
  if (!value) return filter.operator === 'empty';
  const date = new Date(String(value));
  if (isNaN(date.getTime())) return false;

  if (['today', 'thisWeek', 'thisMonth', 'thisQuarter'].includes(filter.operator)) {
    const range = getDatePresetRange(filter.operator);
    return date >= range.start && date <= range.end;
  }

  switch (filter.operator) {
    case 'before':
      return date < new Date(String(filter.value));
    case 'after':
      return date > new Date(String(filter.value));
    case 'between': {
      const range = filter.value as { start: string; end: string };
      return date >= new Date(range.start) && date <= new Date(range.end);
    }
    default:
      return true;
  }
}

function matchesNumberFilter(value: unknown, filter: FilterEntry): boolean {
  const num = Number(value);
  if (isNaN(num)) return false;
  const range = filter.value as { min?: string; max?: string };
  if (range.min && num < Number(range.min)) return false;
  if (range.max && num > Number(range.max)) return false;
  return true;
}

function matchesFilter(value: unknown, filter: FilterEntry, filterType: string): boolean {
  switch (filterType) {
    case 'text':
      return matchesTextFilter(value, filter);
    case 'enum':
      return matchesEnumFilter(value, filter);
    case 'date':
      return matchesDateFilter(value, filter);
    case 'number':
      return matchesNumberFilter(value, filter);
    default:
      return true;
  }
}

function compareValues(a: unknown, b: unknown, direction: SortDirection): number {
  const aVal = a ?? '';
  const bVal = b ?? '';
  const mul = direction === 'asc' ? 1 : -1;

  if (typeof aVal === 'number' && typeof bVal === 'number') {
    return (aVal - bVal) * mul;
  }
  return String(aVal).localeCompare(String(bVal)) * mul;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AllTicketsView(): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { user } = useAuth();
  const { numaGet, numaPut } = useNumaRequest();
  const { config, tickets, ticketsLoading, refreshTickets, teamData, workUnits, selectedTeamId } = useOps();

  // ── State ───────────────────────────────────────────────────────────────
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortColumn, setSortColumn] = useState<string>('updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // ── Column visibility ──────────────────────────────────────────────────
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(DEFAULT_VISIBLE_KEYS);

  // ── Quick-filters (toolbar) ────────────────────────────────────────────
  const [quickStatusFilter, setQuickStatusFilter] = useState<string[]>([]);
  const [quickSprintFilter, setQuickSprintFilter] = useState<string[]>([]);
  const [customerFilters, setCustomerFilters] = useState<CustomerFilterState>(EMPTY_CUSTOMER_FILTERS);

  // ── Customers (for CRM filter panel) ───────────────────────────────────
  const [customers, setCustomers] = useState<Customer[]>([]);

  useEffect(() => {
    let cancelled = false;
    OpsService.listCustomers(numaGet)
      .then((list) => {
        if (!cancelled) setCustomers(list);
      })
      .catch(() => {
        /* non-critical */
      });
    return () => {
      cancelled = true;
    };
  }, [numaGet]);

  // ── Modal / overlay state ─────────────────────────────────────────────────
  const [detailTicketId, setDetailTicketId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{
    show: boolean;
    position: { x: number; y: number };
    ticket: Ticket | null;
  }>({ show: false, position: { x: 0, y: 0 }, ticket: null });

  // ── Saved Views ─────────────────────────────────────────────────────────
  const [savedViews, setSavedViews] = useState<SavedFilter[]>([]);
  const [currentViewName, setCurrentViewName] = useState<string | undefined>();
  const [viewSnapshot, setViewSnapshot] = useState<string | null>(null);
  const [showSaveViewInput, setShowSaveViewInput] = useState(false);
  const [newViewName, setNewViewName] = useState('');

  const buildCurrentViewConfig = useCallback(
    (): SavedViewConfig => ({
      filters: activeFilters,
      visibleColumnKeys,
      sortColumn,
      sortDirection,
      quickStatusFilter,
      quickSprintFilter,
      customerFilters,
    }),
    [
      activeFilters,
      visibleColumnKeys,
      sortColumn,
      sortDirection,
      quickStatusFilter,
      quickSprintFilter,
      customerFilters,
    ],
  );

  const isViewModified = useMemo(() => {
    if (!viewSnapshot) return false;
    return JSON.stringify(buildCurrentViewConfig()) !== viewSnapshot;
  }, [buildCurrentViewConfig, viewSnapshot]);

  // ── Load saved views from backend ─────────────────────────────────────
  // Runs whenever selectedTeamId changes. Uses a ref to track the last team
  // we fetched for so we don't refetch on every render.
  const lastFetchedTeamRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedTeamId) return;
    // Skip if we already loaded prefs for this exact team
    if (lastFetchedTeamRef.current === selectedTeamId) return;

    let cancelled = false;

    OpsService.getUserPreferences(numaGet, selectedTeamId)
      .then((prefs) => {
        if (cancelled) return;
        lastFetchedTeamRef.current = selectedTeamId;
        if (prefs.savedFilters) {
          setSavedViews(prefs.savedFilters);
        } else {
          setSavedViews([]);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        lastFetchedTeamRef.current = selectedTeamId;
        console.warn('[AllTicketsView] Could not load user preferences:', err);
        setSavedViews([]);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTeamId, numaGet]);

  // ── Debounced search ────────────────────────────────────────────────────
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(searchText);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchText]);

  // ── Config lookups ──────────────────────────────────────────────────────
  const ticketTypes = config?.ticketTypes ?? [];
  const staff = config?.staff ?? [];
  const projects = config?.projects ?? [];

  // ── Column definitions ──────────────────────────────────────────────────
  const columns: ColumnDef[] = useMemo(
    () => [
      {
        key: 'displayId',
        label: 'ID',
        sortable: true,
        filterType: 'text',
        accessor: (tk) => tk.displayId,
        render: (tk) => <span style={{ fontFamily: 'monospace', color: '#6c757d' }}>{tk.displayId}</span>,
      },
      {
        key: 'title',
        label: t('tickets.title'),
        sortable: true,
        filterType: 'text',
        accessor: (tk) => tk.title,
      },
      {
        key: 'ticketTypeId',
        label: t('tickets.type'),
        sortable: true,
        filterType: 'enum',
        filterOptions: () => ticketTypes.map((tt) => ({ value: tt.id, label: tt.name })),
        accessor: (tk) => tk.ticketTypeId,
        render: (tk) => {
          const tt = ticketTypes.find((x) => x.id === tk.ticketTypeId);
          return tt ? (
            <span>
              {tt.icon && <i className={`${getTicketTypeIconClass(tt.icon)} me-1`} style={{ color: tt.color }} />}
              {tt.name}
            </span>
          ) : (
            tk.ticketTypeId
          );
        },
      },
      {
        key: 'stageId',
        label: t('tickets.status'),
        sortable: true,
        filterType: 'enum',
        filterOptions: () => (teamData?.stages ?? []).map((s) => ({ value: s.id, label: s.name })),
        accessor: (tk) => tk.stageId,
        render: (tk) => <StageBadge stageId={tk.stageId} stages={teamData?.stages ?? []} />,
      },
      {
        key: 'workUnit',
        label: t('tickets.sprint'),
        sortable: true,
        filterType: 'enum',
        filterOptions: () => workUnits.map((wu) => ({ value: wu.id, label: wu.name })),
        accessor: (tk) => {
          const wu = workUnits.find((w) => w.id === tk.workUnitId);
          return wu?.name ?? '';
        },
        render: (tk) => {
          const wu = workUnits.find((w) => w.id === tk.workUnitId);
          return <SprintBadge workUnit={wu} />;
        },
      },
      {
        key: 'priority',
        label: t('tickets.priority'),
        sortable: true,
        filterType: 'enum',
        filterOptions: () => [
          { value: 'highest', label: t('priority.highest') },
          { value: 'high', label: t('priority.high') },
          { value: 'medium', label: t('priority.medium') },
          { value: 'low', label: t('priority.low') },
          { value: 'lowest', label: t('priority.lowest') },
        ],
        accessor: (tk) => tk.priority,
        render: (tk) => <PriorityIndicator priority={tk.priority} showLabel />,
      },
      {
        key: 'dueDate',
        label: t('tickets.dueDate'),
        sortable: true,
        filterType: 'date',
        accessor: (tk) => tk.dueDate ?? '',
        render: (tk) => <DueDateBadge dueDate={tk.dueDate} />,
      },
      {
        key: 'assigneeName',
        label: t('tickets.assignee'),
        sortable: true,
        filterType: 'enum',
        filterOptions: () => staff.map((s) => ({ value: s.id, label: s.name || s.email })),
        accessor: (tk) => tk.assigneeName ?? '',
        render: (tk) => {
          const s = tk.assigneeId ? staff.find((st) => st.id === tk.assigneeId) : undefined;
          return s || tk.assigneeName ? (
            <span className="d-inline-flex align-items-center gap-2">
              <StaffAvatar staff={s} name={!s ? tk.assigneeName : undefined} size={24} />
              <span>{s ? s.name || s.email : tk.assigneeName}</span>
            </span>
          ) : (
            <span className="text-muted">-</span>
          );
        },
      },
      {
        key: 'customerName',
        label: t('tickets.customer'),
        sortable: true,
        filterType: 'text',
        accessor: (tk) => tk.customerName ?? '',
        render: (tk) => (tk.customerName ? <span>{tk.customerName}</span> : <span className="text-muted">-</span>),
      },
      {
        key: 'tags',
        label: t('tickets.tags'),
        sortable: false,
        filterType: 'text',
        accessor: (tk) => (tk.tags ?? []).join(', '),
        render: (tk) =>
          (tk.tags ?? []).length > 0 ? (
            <span className="d-flex flex-wrap gap-1">
              {tk.tags.map((tag) => (
                <Badge key={tag} bg="light" text="dark" className="border">
                  {tag}
                </Badge>
              ))}
            </span>
          ) : null,
      },
      {
        key: 'createdAt',
        label: t('tickets.created'),
        sortable: true,
        filterType: 'date',
        accessor: (tk) => tk.createdAt,
        render: (tk) => <span className="text-muted">{formatRelativeDate(tk.createdAt)}</span>,
      },
      {
        key: 'updatedAt',
        label: t('tickets.updated'),
        sortable: true,
        filterType: 'date',
        accessor: (tk) => tk.updatedAt,
        render: (tk) => <span className="text-muted">{formatRelativeDate(tk.updatedAt)}</span>,
      },
      {
        key: 'supplierName',
        label: t('tickets.supplier'),
        sortable: true,
        filterType: 'text',
        accessor: (tk) => tk.supplierName ?? '',
      },
      {
        key: 'project',
        label: t('tickets.project'),
        sortable: true,
        filterType: 'text',
        accessor: (tk) => {
          const proj = projects.find((p) => p.id === tk.projectId);
          return proj?.name ?? '';
        },
        render: (tk) => {
          const proj = projects.find((p) => p.id === tk.projectId);
          return proj ? <span>{proj.name}</span> : null;
        },
      },
      {
        key: 'reporterName',
        label: t('tickets.reporter'),
        sortable: true,
        filterType: 'enum',
        filterOptions: () => staff.map((s) => ({ value: s.id, label: s.name || s.email })),
        accessor: (tk) => tk.reporterName ?? '',
        render: (tk) => tk.reporterName || <span className="text-muted">{t('fields.unknown')}</span>,
      },
    ],
    [t, ticketTypes, teamData?.stages, staff, workUnits, projects],
  );

  // ── Visible columns (ordered) ─────────────────────────────────────────
  const visibleColumns = useMemo(
    () => visibleColumnKeys.map((key) => columns.find((c) => c.key === key)).filter(Boolean) as ColumnDef[],
    [columns, visibleColumnKeys],
  );

  // ── Build column lookup for filter type ─────────────────────────────────
  const columnMap = useMemo(() => {
    const map = new Map<string, ColumnDef>();
    for (const col of columns) {
      map.set(col.key, col);
    }
    return map;
  }, [columns]);

  // ── Source tickets (archived filter) ──────────────────────────────────
  const sourceTickets: Ticket[] = useMemo(() => {
    return showArchived ? tickets : tickets.filter((tk) => !tk.archived);
  }, [tickets, showArchived]);

  // ── Search filter ───────────────────────────────────────────────────────
  const searchedTickets = useMemo(() => {
    if (!debouncedSearch) return sourceTickets;
    const lower = debouncedSearch.toLowerCase();
    return sourceTickets.filter(
      (tk) => tk.title.toLowerCase().includes(lower) || tk.displayId.toLowerCase().includes(lower),
    );
  }, [sourceTickets, debouncedSearch]);

  // ── Quick-filters (toolbar) ────────────────────────────────────────────
  const quickFilteredTickets = useMemo(() => {
    let result = searchedTickets;

    if (quickStatusFilter.length > 0) {
      result = result.filter((tk) => quickStatusFilter.includes(tk.stageId));
    }
    if (quickSprintFilter.length > 0) {
      result = result.filter((tk) => tk.workUnitId != null && quickSprintFilter.includes(tk.workUnitId));
    }

    // Customer filters (multi-field, AND between fields, OR within field)
    if (hasActiveCustomerFilters(customerFilters)) {
      // Build a customer lookup by ID for CRM field matching
      const customerMap = new Map(customers.map((c) => [c.id, c]));

      result = result.filter((tk) => {
        // "No Customer" check
        if (customerFilters.includeNoCustomer && !tk.customerId) return true;
        // If only "No Customer" is active and this ticket has a customer, check other filters
        if (!tk.customerId) return false;

        const customer = customerMap.get(tk.customerId);

        // Customer name filter
        if (customerFilters.customerIds.length > 0) {
          if (!tk.customerId || !customerFilters.customerIds.includes(tk.customerId)) return false;
        }
        // Lifecycle stage filter
        if (customerFilters.stages.length > 0) {
          if (!customer || !customerFilters.stages.includes(customer.lifecycleStage)) return false;
        }
        // Territory filter
        if (customerFilters.territories.length > 0) {
          if (!customer?.territory || !customerFilters.territories.includes(customer.territory)) return false;
        }
        // Account owner filter
        if (customerFilters.accountOwnerIds.length > 0) {
          if (!customer?.ownerId || !customerFilters.accountOwnerIds.includes(customer.ownerId)) return false;
        }
        // Industry filter
        if (customerFilters.industries.length > 0) {
          if (!customer?.industry || !customerFilters.industries.includes(customer.industry)) return false;
        }
        // Company size filter
        if (customerFilters.companySizes.length > 0) {
          if (!customer?.companySize || !customerFilters.companySizes.includes(customer.companySize)) return false;
        }
        return true;
      });
    }

    return result;
  }, [searchedTickets, quickStatusFilter, quickSprintFilter, customerFilters, customers]);

  // ── Per-column filters ────────────────────────────────────────────────
  const filteredTickets = useMemo(() => {
    const filterKeys = Object.keys(activeFilters);
    if (filterKeys.length === 0) return quickFilteredTickets;
    return quickFilteredTickets.filter((tk) =>
      filterKeys.every((key) => {
        const col = columnMap.get(key);
        if (!col) return true;
        const value = col.accessor(tk);
        return matchesFilter(value, activeFilters[key], col.filterType);
      }),
    );
  }, [quickFilteredTickets, activeFilters, columnMap]);

  // ── Sorting ─────────────────────────────────────────────────────────────
  const sortedTickets = useMemo(() => {
    const col = columnMap.get(sortColumn);
    if (!col || !col.sortable) return filteredTickets;
    return [...filteredTickets].sort((a, b) => compareValues(col.accessor(a), col.accessor(b), sortDirection));
  }, [filteredTickets, sortColumn, sortDirection, columnMap]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSort = useCallback((colKey: string, dir: SortDirection) => {
    setSortColumn(colKey);
    setSortDirection(dir);
  }, []);

  const handleFilterApply = useCallback((colKey: string, filter: FilterEntry) => {
    setActiveFilters((prev) => ({ ...prev, [colKey]: filter }));
  }, []);

  const handleFilterClear = useCallback((colKey: string) => {
    setActiveFilters((prev) => {
      const next = { ...prev };
      delete next[colKey];
      return next;
    });
  }, []);

  const handleClearAllFilters = useCallback(() => {
    setActiveFilters({});
  }, []);

  // ── Selection ───────────────────────────────────────────────────────────

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedIds(new Set(sortedTickets.map((tk) => tk.id)));
      } else {
        setSelectedIds(new Set());
      }
      setLastClickedIndex(null);
    },
    [sortedTickets],
  );

  const handleSelectRow = useCallback(
    (ticketId: string, index: number, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);

        if (shiftKey && lastClickedIndex !== null) {
          const start = Math.min(lastClickedIndex, index);
          const end = Math.max(lastClickedIndex, index);
          for (let i = start; i <= end; i++) {
            next.add(sortedTickets[i].id);
          }
        } else {
          if (next.has(ticketId)) {
            next.delete(ticketId);
          } else {
            next.add(ticketId);
          }
        }

        return next;
      });
      setLastClickedIndex(index);
    },
    [lastClickedIndex, sortedTickets],
  );

  // ── Saved Views callbacks ───────────────────────────────────────────────

  const persistViews = useCallback(
    async (views: SavedFilter[]) => {
      if (!selectedTeamId) return;
      try {
        await OpsService.saveUserPreferences(numaPut, selectedTeamId, {
          savedFilters: views,
        });
      } catch (err) {
        console.error('[AllTicketsView] Failed to persist saved views:', err);
      }
    },
    [selectedTeamId, numaPut],
  );

  const handleSaveView = useCallback(
    async (name: string) => {
      const viewConfig = buildCurrentViewConfig();
      const newFilter: SavedFilter = { name, config: viewConfig as unknown as Record<string, unknown> };
      const updatedViews = [...savedViews.filter((v) => v.name !== name), newFilter];
      setSavedViews(updatedViews);
      setCurrentViewName(name);
      setViewSnapshot(JSON.stringify(viewConfig));
      await persistViews(updatedViews);
    },
    [buildCurrentViewConfig, savedViews, persistViews],
  );

  const handleLoadView = useCallback((filter: SavedFilter) => {
    const raw = filter.config;
    // Backward compat: old format stored just ActiveFilters, new format has `filters` key
    const config =
      'filters' in raw
        ? (raw as unknown as SavedViewConfig)
        : ({ filters: raw as unknown as ActiveFilters } as SavedViewConfig);

    if (config.filters) setActiveFilters(config.filters);
    if (config.visibleColumnKeys) setVisibleColumnKeys(config.visibleColumnKeys);
    if (config.sortColumn) setSortColumn(config.sortColumn);
    if (config.sortDirection) setSortDirection(config.sortDirection);
    if (config.quickStatusFilter) setQuickStatusFilter(config.quickStatusFilter);
    if (config.quickSprintFilter) setQuickSprintFilter(config.quickSprintFilter);
    if (config.customerFilters) setCustomerFilters(config.customerFilters);
    setCurrentViewName(filter.name);
    setViewSnapshot(JSON.stringify(config));
  }, []);

  const handleUpdateView = useCallback(async () => {
    if (!currentViewName) return;
    const viewConfig = buildCurrentViewConfig();
    const updatedViews = savedViews.map((v) =>
      v.name === currentViewName ? { ...v, config: viewConfig as unknown as Record<string, unknown> } : v,
    );
    setSavedViews(updatedViews);
    setViewSnapshot(JSON.stringify(viewConfig));
    await persistViews(updatedViews);
  }, [currentViewName, buildCurrentViewConfig, savedViews, persistViews]);

  const handleDeleteView = useCallback(
    async (name: string) => {
      const updatedViews = savedViews.filter((v) => v.name !== name);
      setSavedViews(updatedViews);
      if (currentViewName === name) {
        setCurrentViewName(undefined);
        setViewSnapshot(null);
      }
      await persistViews(updatedViews);
    },
    [savedViews, currentViewName, persistViews],
  );

  const handleClearView = useCallback(() => {
    setActiveFilters({});
    setQuickStatusFilter([]);
    setQuickSprintFilter([]);
    setCustomerFilters(EMPTY_CUSTOMER_FILTERS);
    setCurrentViewName(undefined);
    setViewSnapshot(null);
  }, []);

  const handleSaveNewView = useCallback(() => {
    const trimmed = newViewName.trim();
    if (trimmed) {
      void handleSaveView(trimmed);
      setNewViewName('');
      setShowSaveViewInput(false);
    }
  }, [newViewName, handleSaveView]);

  // ── Row click / right-click ─────────────────────────────────────────────

  const handleRowClick = useCallback((ticket: Ticket) => {
    setDetailTicketId(ticket.id);
    setShowDetail(true);
  }, []);

  const handleRowContextMenu = useCallback((e: React.MouseEvent, ticket: Ticket) => {
    e.preventDefault();
    setCtxMenu({ show: true, position: { x: e.clientX, y: e.clientY }, ticket });
  }, []);

  const handleContextMenuAction = useCallback(
    async (action: string, payload?: unknown) => {
      const ticket = ctxMenu.ticket;
      if (!ticket) return;
      setCtxMenu((prev) => ({ ...prev, show: false }));

      try {
        switch (action) {
          case 'assignToMe':
            if (user?.username) {
              await OpsService.updateTicket(numaPut, ticket.id, {
                teamId: ticket.teamId,
                assigneeId: user.username,
                version: ticket.version,
              });
              await refreshTickets();
            }
            break;
          case 'assignTo':
            await OpsService.updateTicket(numaPut, ticket.id, {
              teamId: ticket.teamId,
              assigneeId: payload as string,
              version: ticket.version,
            });
            await refreshTickets();
            break;
          case 'changeStage': {
            const newStageId = payload as string;
            const targetStage = (teamData?.stages ?? []).find((s) => s.id === newStageId);
            await OpsService.updateTicket(numaPut, ticket.id, {
              teamId: ticket.teamId,
              stageId: newStageId,
              zoneId: targetStage?.zoneId,
              version: ticket.version,
            });
            await refreshTickets();
            break;
          }
          case 'openDetail':
            setDetailTicketId(ticket.id);
            setShowDetail(true);
            break;
          case 'copyLink':
            await navigator.clipboard.writeText(`${window.location.origin}/ops?ticket=${ticket.displayId}`);
            break;
          case 'archive':
            await OpsService.archiveTicket(numaPut, ticket.id, ticket.version);
            await refreshTickets();
            break;
          case 'unarchive':
            await OpsService.unarchiveTicket(numaPut, ticket.id, ticket.version);
            await refreshTickets();
            break;
          case 'delete':
            await OpsService.updateTicket(numaPut, ticket.id, {
              teamId: ticket.teamId,
              statusType: 'deleted',
              version: ticket.version,
            });
            await refreshTickets();
            break;
        }
      } catch (err) {
        console.error('[AllTicketsView] Context menu action failed:', err);
      }
    },
    [ctxMenu.ticket, numaPut, refreshTickets, user],
  );

  // ── Active filter keys for display ──────────────────────────────────────
  const activeFilterKeys = Object.keys(activeFilters);
  const hasActiveFilters = activeFilterKeys.length > 0;

  // ── Selection info ──────────────────────────────────────────────────────
  const selectionCount = selectedIds.size;
  const allSelected = sortedTickets.length > 0 && selectionCount === sortedTickets.length;

  const selectedTicketsList = useMemo(
    () => sortedTickets.filter((tk) => selectedIds.has(tk.id)),
    [sortedTickets, selectedIds],
  );

  // ── Column picker data ──────────────────────────────────────────────────
  const pickerColumns: PickerColumnDef[] = useMemo(
    () =>
      columns.map((col) => ({
        id: col.key,
        label: col.label,
        category: 'system',
        visible: visibleColumnKeys.includes(col.key),
      })),
    [columns, visibleColumnKeys],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="d-flex flex-column h-100 p-3" style={{ backgroundColor: '#f0f0f0' }}>
      {/* Card container for the entire table view */}
      <div
        className="d-flex flex-column flex-grow-1 bg-white overflow-hidden"
        style={{ border: '1px solid #e0e0e0', borderRadius: 12, minHeight: 0 }}
      >
        {/* ── Toolbar ────────────────────────────────────────────────────── */}
        <div className="d-flex align-items-center flex-wrap gap-2 gap-md-3 px-3 py-2 border-bottom bg-white">
          {/* Search input */}
          <div className="position-relative" style={{ width: 280 }}>
            <i
              className="bi bi-search position-absolute top-50 translate-middle-y"
              style={{ left: 12, fontSize: '0.8rem', color: '#aaa' }}
            />
            <Form.Control
              size="sm"
              type="text"
              placeholder={t('tickets.search')}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{
                paddingLeft: 34,
                borderRadius: 8,
                border: '1px solid #e0e0e0',
                backgroundColor: '#f8f9fa',
              }}
            />
          </div>

          {/* Quick-filter: All Status */}
          <QuickFilterDropdown
            label={t('allTicketsView.allStatus')}
            options={(teamData?.stages ?? []).map((s) => ({ value: s.id, label: s.name }))}
            selected={quickStatusFilter}
            onChange={setQuickStatusFilter}
          />

          {/* Quick-filter: All Sprints */}
          <QuickFilterDropdown
            label={t('allTicketsView.allSprints')}
            options={workUnits.map((wu) => ({ value: wu.id, label: wu.name }))}
            selected={quickSprintFilter}
            onChange={setQuickSprintFilter}
          />

          {/* Customer Filters */}
          <CustomerFiltersDropdown
            customers={customers}
            crmConfig={config?.crmConfig ?? null}
            staff={staff}
            filters={customerFilters}
            onChange={setCustomerFilters}
          />

          {/* Columns button */}
          <button
            type="button"
            className="btn btn-sm d-inline-flex align-items-center gap-1"
            style={{
              backgroundColor: '#f8f9fa',
              border: '1px solid #dee2e6',
              color: '#495057',
              borderRadius: 8,
            }}
            onClick={() => setShowColumnPicker(true)}
          >
            <i className="bi bi-layout-three-columns" />
            {t('columns.manage')}
          </button>

          {/* Ticket count — sits right after Columns */}
          <span className="text-muted">{t('tickets.count', { count: sortedTickets.length })}</span>

          {/* Spacer */}
          <div className="flex-grow-1" />

          {/* Show Archived toggle (subtle) */}
          <Form.Check
            type="switch"
            id="show-archived-toggle"
            label={<span className="text-muted small">{t('archive.showArchived')}</span>}
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />

          {/* Selection count */}
          {selectionCount > 0 && (
            <Badge bg="primary" pill>
              {t('bulk.selected', { count: selectionCount })}
            </Badge>
          )}
        </div>

        {/* ── Saved Views Pills Row (Row 3 — always visible) ─────────────── */}
        <div
          className="d-flex align-items-center gap-2 px-3 py-1 border-bottom flex-wrap"
          style={{ minHeight: 36, backgroundColor: '#f8f9fa' }}
        >
          <small className="text-muted fw-semibold">{t('filters.savedViews')}:</small>

          {savedViews.map((view) => (
            <div key={view.name} className="d-inline-flex align-items-center">
              <Badge
                bg={view.name === currentViewName ? 'primary' : 'light'}
                text={view.name === currentViewName ? 'light' : 'dark'}
                className={`border ${view.name === currentViewName ? '' : 'border-secondary-subtle'}`}
                role="button"
                onClick={() => handleLoadView(view)}
                style={{ cursor: 'pointer' }}
              >
                {view.name}
                {view.name === currentViewName && isViewModified && (
                  <span className="ms-1 opacity-75 fst-italic">{t('filters.modified')}</span>
                )}
              </Badge>
              {/* Delete button (small x) */}
              <i
                className="bi bi-x text-muted ms-0"
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDeleteView(view.name);
                }}
                style={{ cursor: 'pointer', fontSize: '0.85rem' }}
              />
            </div>
          ))}

          {/* Save View — inline input or button */}
          {showSaveViewInput ? (
            <div className="d-inline-flex align-items-center gap-1">
              <Form.Control
                size="sm"
                type="text"
                placeholder={t('allTicketsView.saveViewPrompt')}
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveNewView();
                  if (e.key === 'Escape') {
                    setShowSaveViewInput(false);
                    setNewViewName('');
                  }
                }}
                autoFocus
                style={{ width: 140 }}
              />
              <Button size="sm" variant="primary" onClick={handleSaveNewView}>
                {t('common.save')}
              </Button>
            </div>
          ) : (
            <Badge
              bg="light"
              text="dark"
              className="border border-secondary-subtle"
              role="button"
              onClick={() => setShowSaveViewInput(true)}
              style={{ cursor: 'pointer' }}
            >
              <i className="bi bi-plus me-1" />
              {t('filters.saveView')}
            </Badge>
          )}

          {/* Update View (when active + modified) */}
          {currentViewName && isViewModified && (
            <Badge
              bg="warning"
              text="dark"
              className="border"
              role="button"
              onClick={() => void handleUpdateView()}
              style={{ cursor: 'pointer' }}
            >
              <i className="bi bi-arrow-repeat me-1" />
              {t('filters.updateView')}
            </Badge>
          )}

          {/* Clear View */}
          {currentViewName && (
            <Badge
              bg="light"
              text="muted"
              className="border border-secondary-subtle"
              role="button"
              onClick={handleClearView}
              style={{ cursor: 'pointer' }}
            >
              <i className="bi bi-x me-1" />
              {t('filters.clearView')}
            </Badge>
          )}
        </div>

        {/* ── Active Filters Bar ───────────────────────────────────────────── */}
        {hasActiveFilters && (
          <div className="d-flex align-items-center gap-2 px-3 py-2 border-bottom bg-light flex-wrap">
            <small className="text-muted fw-semibold me-1">{t('filters.activeFilters')}:</small>
            {activeFilterKeys.map((key) => {
              const col = columnMap.get(key);
              const filter = activeFilters[key];
              const displayValue = Array.isArray(filter.value)
                ? `${String((filter.value as string[]).length)}`
                : typeof filter.value === 'object'
                  ? filter.operator
                  : String(filter.value);
              return (
                <Badge key={key} bg="secondary" className="d-inline-flex align-items-center gap-1">
                  <span>
                    {col?.label ?? key} {filter.operator} {displayValue}
                  </span>
                  <i
                    className="bi bi-x-circle-fill ms-1"
                    role="button"
                    onClick={() => handleFilterClear(key)}
                    style={{ cursor: 'pointer' }}
                  />
                </Badge>
              );
            })}
            <Button variant="link" size="sm" className="p-0" onClick={handleClearAllFilters}>
              {t('filters.clearAll')}
            </Button>
          </div>
        )}

        {/* ── Table ────────────────────────────────────────────────────────── */}
        <div className="flex-grow-1 overflow-auto">
          {ticketsLoading ? (
            <div className="d-flex justify-content-center align-items-center py-5">
              <Spinner animation="border" size="sm" className="me-2" />
              <span>{t('common.loading')}</span>
            </div>
          ) : sortedTickets.length === 0 ? (
            <div className="text-center text-muted py-5">{t('tickets.noTickets')}</div>
          ) : (
            <Table hover size="sm" className="mb-0 align-middle">
              <thead className="sticky-top" style={{ backgroundColor: '#f5f5f5' }}>
                <tr>
                  {/* Select-all checkbox */}
                  <th style={{ width: 40, padding: '0.6rem 0.5rem', borderBottom: '1px solid #e0e0e0' }}>
                    <Form.Check
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      aria-label="select-all"
                    />
                  </th>

                  {visibleColumns.map((col) => (
                    <th
                      key={col.key}
                      className={MOBILE_KEEP_KEYS.includes(col.key) ? '' : 'd-none d-lg-table-cell'}
                      style={{
                        whiteSpace: 'nowrap',
                        padding: '0.6rem 0.75rem',
                        color: '#888',
                        fontWeight: 400,
                        fontSize: '0.875rem',
                        borderBottom: '1px solid #e0e0e0',
                      }}
                    >
                      <FilterDropdown
                        column={col.key}
                        columnLabel={col.label}
                        columnType={col.filterType}
                        options={col.filterOptions?.()}
                        currentFilter={activeFilters[col.key]}
                        onApply={(f) => handleFilterApply(col.key, f)}
                        onClear={() => handleFilterClear(col.key)}
                        sortable={col.sortable}
                        currentSortColumn={sortColumn}
                        currentSortDirection={sortDirection}
                        onSort={handleSort}
                      />
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {sortedTickets.map((ticket, idx) => {
                  const isSelected = selectedIds.has(ticket.id);
                  return (
                    <tr
                      key={ticket.id}
                      className={isSelected ? 'table-active' : ''}
                      onClick={() => handleRowClick(ticket)}
                      onContextMenu={(e) => handleRowContextMenu(e, ticket)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td style={{ padding: '0.75rem 0.5rem' }} onClick={(e) => e.stopPropagation()}>
                        <Form.Check
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectRow(ticket.id, idx, e.shiftKey);
                          }}
                          aria-label={`select-${ticket.displayId}`}
                        />
                      </td>
                      {visibleColumns.map((col) => (
                        <td
                          key={col.key}
                          className={MOBILE_KEEP_KEYS.includes(col.key) ? '' : 'd-none d-lg-table-cell'}
                          style={{ padding: '0.75rem 0.75rem' }}
                        >
                          {col.render ? col.render(ticket) : String(col.accessor(ticket) ?? '-')}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </div>
      </div>
      {/* end card container */}

      {/* ── Bulk Edit Panel ─────────────────────────────────────────────── */}
      {selectionCount > 0 && (
        <BulkEditPanel
          selectedTickets={selectedTicketsList}
          onDeselect={() => {
            setSelectedIds(new Set());
            setLastClickedIndex(null);
          }}
          onApplied={() => {
            setSelectedIds(new Set());
            setLastClickedIndex(null);
            refreshTickets();
          }}
        />
      )}

      {/* ── Overlays ─────────────────────────────────────────────────────── */}
      <TicketDetailModal
        show={showDetail}
        ticketId={detailTicketId}
        onHide={() => {
          setShowDetail(false);
          setDetailTicketId(null);
        }}
        onDeleted={() => {
          setShowDetail(false);
          setDetailTicketId(null);
          refreshTickets();
        }}
      />
      <ContextMenu
        show={ctxMenu.show}
        position={ctxMenu.position}
        ticket={ctxMenu.ticket}
        context="table"
        stages={teamData?.stages ?? []}
        zones={teamData?.zones ?? []}
        staff={config?.staff ?? []}
        onClose={() => setCtxMenu((prev) => ({ ...prev, show: false }))}
        onAction={handleContextMenuAction}
      />
      <ColumnPicker
        show={showColumnPicker}
        onHide={() => setShowColumnPicker(false)}
        columns={pickerColumns}
        onColumnsChange={(updated) => {
          const newVisible = updated.filter((c) => c.visible).map((c) => c.id);
          setVisibleColumnKeys(newVisible.length > 0 ? newVisible : DEFAULT_VISIBLE_KEYS);
          setShowColumnPicker(false);
        }}
      />
    </div>
  );
}
