import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import Table from 'react-bootstrap/Table';
import Form from 'react-bootstrap/Form';
import Dropdown from 'react-bootstrap/Dropdown';
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
import { FilterDropdown } from './FilterDropdown';
import { SavedViewsDropdown } from './SavedViewsDropdown';
import { ColumnPicker, type ColumnDef as PickerColumnDef } from './ColumnPicker';
import { BulkEditPanel } from './BulkEditPanel';
import { TicketDetailModal } from '../Modals/TicketDetailModal';
import ContextMenu from '../ContextMenu';
import type { Ticket, SavedFilter } from '../../../types/ops';
import { getTicketTypeIconClass } from '../../../constants/opsConstants';

// ─── Types ──────────────────────────────────────────────────────────────────

type SortDirection = 'asc' | 'desc';
type Scope = 'thisTeam' | 'allTeams';
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
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
  return selected.includes(String(value ?? ''));
}

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

function matchesDateFilter(value: unknown, filter: FilterEntry): boolean {
  if (!value) return filter.operator === 'empty';
  const date = new Date(String(value));
  if (isNaN(date.getTime())) return false;

  // Presets
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
  const { numaPut } = useNumaRequest();
  const { config, tickets, ticketsLoading, refreshTickets, teamData } = useOps();

  // ── State ───────────────────────────────────────────────────────────────
  const [scope, setScope] = useState<Scope>('thisTeam');
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortColumn, setSortColumn] = useState<string>('updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);

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

  const isViewModified = useMemo(() => {
    if (!viewSnapshot) return false;
    return JSON.stringify(activeFilters) !== viewSnapshot;
  }, [activeFilters, viewSnapshot]);

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

  // ── Column definitions ──────────────────────────────────────────────────
  const columns: ColumnDef[] = useMemo(
    () => [
      {
        key: 'displayId',
        label: 'ID',
        sortable: true,
        filterType: 'text',
        accessor: (tk) => tk.displayId,
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
        key: 'assigneeName',
        label: t('tickets.assignee'),
        sortable: true,
        filterType: 'enum',
        filterOptions: () => staff.map((s) => ({ value: s.id, label: s.name })),
        accessor: (tk) => tk.assigneeName ?? '',
        render: (tk) => tk.assigneeName || <span className="text-muted">{t('fields.unassigned')}</span>,
      },
      {
        key: 'dueDate',
        label: t('tickets.dueDate'),
        sortable: true,
        filterType: 'date',
        accessor: (tk) => tk.dueDate ?? '',
        render: (tk) => formatDate(tk.dueDate),
      },
      {
        key: 'customerName',
        label: t('tickets.customer'),
        sortable: true,
        filterType: 'text',
        accessor: (tk) => tk.customerName ?? '',
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
        render: (tk) => formatDate(tk.createdAt),
      },
      {
        key: 'updatedAt',
        label: t('tickets.updated'),
        sortable: true,
        filterType: 'date',
        accessor: (tk) => tk.updatedAt,
        render: (tk) => formatDate(tk.updatedAt),
      },
    ],
    [t, ticketTypes, teamData?.stages, staff],
  );

  // ── Build column lookup for filter type ─────────────────────────────────
  const columnMap = useMemo(() => {
    const map = new Map<string, ColumnDef>();
    for (const col of columns) {
      map.set(col.key, col);
    }
    return map;
  }, [columns]);

  // ── Source tickets (scope) ──────────────────────────────────────────────
  // NOTE: For now, all scopes use the context tickets. Cross-board queries
  // may need backend support in the future.
  const sourceTickets: Ticket[] = useMemo(() => {
    void scope; // acknowledge scope to avoid lint warning; used for future expansion
    const base = showArchived ? tickets : tickets.filter((tk) => !tk.archived);
    return base;
  }, [tickets, scope, showArchived]);

  // ── Search filter ───────────────────────────────────────────────────────
  const searchedTickets = useMemo(() => {
    if (!debouncedSearch) return sourceTickets;
    const lower = debouncedSearch.toLowerCase();
    return sourceTickets.filter(
      (tk) => tk.title.toLowerCase().includes(lower) || tk.displayId.toLowerCase().includes(lower),
    );
  }, [sourceTickets, debouncedSearch]);

  // ── Active filters ──────────────────────────────────────────────────────
  const filteredTickets = useMemo(() => {
    const filterKeys = Object.keys(activeFilters);
    if (filterKeys.length === 0) return searchedTickets;
    return searchedTickets.filter((tk) =>
      filterKeys.every((key) => {
        const col = columnMap.get(key);
        if (!col) return true;
        const value = col.accessor(tk);
        return matchesFilter(value, activeFilters[key], col.filterType);
      }),
    );
  }, [searchedTickets, activeFilters, columnMap]);

  // ── Sorting ─────────────────────────────────────────────────────────────
  const sortedTickets = useMemo(() => {
    const col = columnMap.get(sortColumn);
    if (!col || !col.sortable) return filteredTickets;
    return [...filteredTickets].sort((a, b) => compareValues(col.accessor(a), col.accessor(b), sortDirection));
  }, [filteredTickets, sortColumn, sortDirection, columnMap]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSort = useCallback(
    (colKey: string) => {
      if (colKey === sortColumn) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortColumn(colKey);
        setSortDirection('asc');
      }
    },
    [sortColumn],
  );

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
          // Range select
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

  const handleSaveView = useCallback(
    (name: string) => {
      const newFilter: SavedFilter = { name, config: { ...activeFilters } };
      setSavedViews((prev) => [...prev.filter((v) => v.name !== name), newFilter]);
      setCurrentViewName(name);
      setViewSnapshot(JSON.stringify(activeFilters));
    },
    [activeFilters],
  );

  const handleLoadView = useCallback((filter: SavedFilter) => {
    setActiveFilters(filter.config as ActiveFilters);
    setCurrentViewName(filter.name);
    setViewSnapshot(JSON.stringify(filter.config));
  }, []);

  const handleUpdateView = useCallback(() => {
    if (!currentViewName) return;
    setSavedViews((prev) => prev.map((v) => (v.name === currentViewName ? { ...v, config: { ...activeFilters } } : v)));
    setViewSnapshot(JSON.stringify(activeFilters));
  }, [currentViewName, activeFilters]);

  const handleClearView = useCallback(() => {
    setActiveFilters({});
    setCurrentViewName(undefined);
    setViewSnapshot(null);
  }, []);

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
        visible: true,
      })),
    [columns],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="d-flex flex-column h-100">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="d-flex align-items-center gap-2 px-3 py-2 border-bottom bg-white flex-wrap">
        {/* Scope selector */}
        <Dropdown>
          <Dropdown.Toggle variant="outline-secondary" size="sm" id="scope-dropdown">
            {scope === 'thisTeam' && t('filters.thisTeam')}
            {scope === 'allTeams' && t('filters.allTeams')}
          </Dropdown.Toggle>
          <Dropdown.Menu>
            <Dropdown.Item active={scope === 'thisTeam'} onClick={() => setScope('thisTeam')}>
              {t('filters.thisTeam')}
            </Dropdown.Item>
            <Dropdown.Item active={scope === 'allTeams'} onClick={() => setScope('allTeams')}>
              {t('filters.allTeams')}
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>

        {/* Search input */}
        <div className="position-relative" style={{ minWidth: 200 }}>
          <i className="bi bi-search position-absolute top-50 translate-middle-y text-muted" style={{ left: 10 }} />
          <Form.Control
            size="sm"
            type="text"
            placeholder={t('tickets.search')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ paddingLeft: 32 }}
          />
        </div>

        {/* Saved Views */}
        <SavedViewsDropdown
          currentViewName={currentViewName}
          isModified={isViewModified}
          onSave={handleSaveView}
          onLoad={handleLoadView}
          onUpdate={handleUpdateView}
          onClear={handleClearView}
          savedViews={savedViews}
        />

        {/* Columns button */}
        <Button variant="outline-secondary" size="sm" onClick={() => setShowColumnPicker(true)}>
          <i className="bi bi-layout-three-columns me-1" />
          {t('columns.manage')}
        </Button>

        {/* Spacer */}
        <div className="flex-grow-1" />

        {/* Show Archived toggle */}
        <Form.Check
          type="switch"
          id="show-archived-toggle"
          label={t('archive.showArchived')}
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
          className="small"
        />

        {/* Selection count */}
        {selectionCount > 0 && (
          <Badge bg="primary" pill>
            {t('bulk.selected', { count: selectionCount })}
          </Badge>
        )}

        {/* Ticket count */}
        <span className="text-muted small">{t('tickets.count', { count: sortedTickets.length })}</span>
      </div>

      {/* ── Active Filters Bar ───────────────────────────────────────────── */}
      {hasActiveFilters && (
        <div className="d-flex align-items-center gap-2 px-3 py-2 border-bottom bg-light flex-wrap">
          <small className="text-muted fw-semibold me-1">{t('filters.activeFilters')}:</small>
          {activeFilterKeys.map((key) => {
            const col = columnMap.get(key);
            const filter = activeFilters[key];
            const displayValue = Array.isArray(filter.value)
              ? `${(filter.value as string[]).length}`
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
            <thead className="sticky-top bg-white border-bottom">
              <tr>
                {/* Select-all checkbox */}
                <th style={{ width: 40 }}>
                  <Form.Check
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    aria-label="select-all"
                  />
                </th>

                {columns.map((col) => {
                  const isSorted = sortColumn === col.key;
                  return (
                    <th key={col.key} style={{ cursor: col.sortable ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
                      <div className="d-flex align-items-center gap-1">
                        {/* Column header text (sortable click) */}
                        <span
                          onClick={() => col.sortable && handleSort(col.key)}
                          role={col.sortable ? 'button' : undefined}
                        >
                          {col.label}
                          {isSorted && (
                            <i className={`bi bi-chevron-${sortDirection === 'asc' ? 'up' : 'down'} ms-1`} />
                          )}
                        </span>

                        {/* Filter icon */}
                        <FilterDropdown
                          column={col.key}
                          columnType={col.filterType}
                          options={col.filterOptions?.()}
                          currentFilter={activeFilters[col.key]}
                          onApply={(f) => handleFilterApply(col.key, f)}
                          onClear={() => handleFilterClear(col.key)}
                        >
                          <i
                            className={`bi bi-funnel${activeFilters[col.key] ? '-fill' : ''} text-muted`}
                            style={{ fontSize: '0.75rem', cursor: 'pointer' }}
                          />
                        </FilterDropdown>
                      </div>
                    </th>
                  );
                })}
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
                    <td onClick={(e) => e.stopPropagation()}>
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
                    {columns.map((col) => (
                      <td key={col.key}>{col.render ? col.render(ticket) : String(col.accessor(ticket) ?? '')}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>

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
        onColumnsChange={() => setShowColumnPicker(false)}
      />
    </div>
  );
}
