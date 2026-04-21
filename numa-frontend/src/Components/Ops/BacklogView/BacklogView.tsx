import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  DragOverlay,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
  PointerSensor,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useAuth } from '../../../Providers/AuthProvider';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import { TicketDetailModal } from '../Modals/TicketDetailModal';
import { CreateTicketModal } from '../Modals/CreateTicketModal';
import { CreateWorkUnitModal, StartWorkUnitModal, WorkUnitSuccessModal } from '../Modals/WorkUnitModals';
import { PriorityIndicator } from '../Shared/PriorityIndicator';
import { StaffAvatar } from '../Shared/StaffAvatar';
import type {
  WorkUnit,
  Ticket,
  WorkStage,
  TicketType,
  TicketPriority,
  StatusType,
  StaffProfile,
} from '../../../types/ops';
import { getTicketTypeIconClass } from '../../../constants/opsConstants';

// ─── Types ───────────────────────────────────────────────────────────────────

type BacklogViewMode = 'list' | 'kanban';

type TicketGroup = {
  id: string;
  label: string;
  sublabel?: string;
  tickets: Ticket[];
  workUnit?: WorkUnit;
  zoneId: string;
  /** For stage-based groups: the stageId to assign when dropping here */
  stageId?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ORDER_GAP = 1000;

function calculateNewOrder(tickets: Ticket[], insertIndex: number): number {
  if (tickets.length === 0) return ORDER_GAP;
  if (insertIndex <= 0) return tickets[0].order - ORDER_GAP;
  if (insertIndex >= tickets.length) return tickets[tickets.length - 1].order + ORDER_GAP;
  const before = tickets[insertIndex - 1].order;
  const after = tickets[insertIndex].order;
  return Math.round((before + after) / 2);
}

function statusSummary(tickets: Ticket[]): { backlog: number; active: number; done: number } {
  let backlog = 0;
  let active = 0;
  let done = 0;
  for (const t of tickets) {
    const st = t.statusType as StatusType;
    if (st === 'active') active++;
    else if (st === 'completed' || st === 'ended') done++;
    else backlog++;
  }
  return { backlog, active, done };
}

function shortDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
}

// ─── Draggable Ticket Row (list mode) ────────────────────────────────────────

type StageGroup = { zoneName: string; stages: WorkStage[] };

interface DraggableRowProps {
  ticket: Ticket;
  typeInfo: { name: string; color: string } | undefined;
  stageInfo: { name: string; statusType: StatusType } | undefined;
  stageGroups: StageGroup[];
  assigneeStaff?: StaffProfile;
  projectName?: string | null;
  selected?: boolean;
  onClick: () => void;
  onStageChange: (ticketId: string, stageId: string) => void;
  onSelect?: (ticketId: string) => void;
}

function DraggableRow({
  ticket,
  typeInfo,
  stageInfo,
  stageGroups,
  assigneeStaff,
  projectName,
  selected,
  onClick,
  onStageChange,
  onSelect,
}: DraggableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
  });
  const [showStagePicker, setShowStagePicker] = useState(false);
  const stagePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showStagePicker) return;
    const handler = (e: MouseEvent) => {
      if (stagePickerRef.current && !stagePickerRef.current.contains(e.target as Node)) {
        setShowStagePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showStagePicker]);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
    position: isDragging ? ('relative' as const) : undefined,
  };

  const statusCls = `backlog-status-pill--${stageInfo?.statusType ?? 'backlog'}`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`backlog-ticket-row${selected ? ' backlog-ticket-row--selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick();
      }}
      {...attributes}
      {...listeners}
    >
      {onSelect && (
        <input
          type="checkbox"
          className="backlog-row-checkbox flex-shrink-0"
          checked={selected ?? false}
          onChange={() => onSelect(ticket.id)}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      {typeInfo && (
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: typeInfo.color,
            flexShrink: 0,
          }}
          title={typeInfo.name}
        />
      )}
      <span className="ticket-id flex-shrink-0">{ticket.displayId}</span>
      <span className="text-truncate flex-grow-1">{ticket.title}</span>
      {projectName && (
        <span className="backlog-row-tag backlog-row-tag--project flex-shrink-0" title={projectName}>
          <i className="bi bi-folder" />
          {projectName}
        </span>
      )}
      {ticket.customerName && (
        <span className="backlog-row-tag backlog-row-tag--customer flex-shrink-0" title={ticket.customerName}>
          <i className="bi bi-people" />
          {ticket.customerName}
        </span>
      )}
      {stageInfo && (
        <div ref={stagePickerRef} style={{ position: 'relative', flexShrink: 0 }}>
          <span
            className={`backlog-status-pill backlog-status-pill--clickable ${statusCls}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowStagePicker((prev) => !prev);
            }}
            role="button"
            tabIndex={0}
          >
            {stageInfo.name}
            <i className="bi bi-chevron-down" style={{ fontSize: '0.55rem', marginLeft: 3 }} />
          </span>
          {showStagePicker && (
            <div className="backlog-stage-picker">
              {stageGroups.map((group) => (
                <div key={group.zoneName}>
                  {stageGroups.length > 1 && <div className="backlog-stage-picker-zone">{group.zoneName}</div>}
                  {group.stages.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`backlog-stage-picker-item${s.id === ticket.stageId ? ' active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (s.id !== ticket.stageId) onStageChange(ticket.id, s.id);
                        setShowStagePicker(false);
                      }}
                    >
                      <span className={`backlog-status-dot backlog-status-dot--${s.statusType}`} />
                      {s.name}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {ticket.effortPoints != null && ticket.effortPoints > 0 && (
        <span className="backlog-effort flex-shrink-0">{ticket.effortPoints}</span>
      )}
      {ticket.priority && (
        <span className="flex-shrink-0">
          <PriorityIndicator priority={ticket.priority as TicketPriority} />
        </span>
      )}
      {assigneeStaff || ticket.assigneeName ? (
        <span
          className="flex-shrink-0"
          title={assigneeStaff ? assigneeStaff.name || assigneeStaff.email : (ticket.assigneeName ?? '')}
        >
          <StaffAvatar staff={assigneeStaff} name={!assigneeStaff ? ticket.assigneeName : undefined} size={24} />
        </span>
      ) : (
        <span className="backlog-row-avatar backlog-row-avatar--empty flex-shrink-0">
          <i className="bi bi-person" />
        </span>
      )}
    </div>
  );
}

// ─── Droppable Group Body (list mode) ────────────────────────────────────────

interface DroppableGroupBodyProps {
  groupId: string;
  ticketIds: string[];
  children: React.ReactNode;
}

function DroppableGroupBody({ groupId, ticketIds, children }: DroppableGroupBodyProps) {
  const { setNodeRef, isOver } = useDroppable({ id: groupId });

  return (
    <div
      ref={setNodeRef}
      className="backlog-group-body"
      style={{ backgroundColor: isOver ? '#f0f4ff' : undefined, minHeight: 32 }}
    >
      <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </div>
  );
}

// ─── Backlog Group Footer (quick-add + create ticket) ────────────────────────

interface BacklogGroupFooterProps {
  zoneId: string;
  stageId?: string;
  workUnitId?: string;
  ticketTypes: TicketType[];
  onQuickAdd: (title: string, zoneId: string, stageId?: string, ticketTypeId?: string, workUnitId?: string) => void;
  onCreateTicket: (zoneId: string) => void;
}

function BacklogGroupFooter({
  zoneId,
  stageId,
  workUnitId,
  ticketTypes,
  onQuickAdd,
  onCreateTicket,
}: BacklogGroupFooterProps) {
  const { t } = useTranslation('ops');
  const [active, setActive] = useState(false);
  const [value, setValue] = useState('');
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const typeDropdownRef = useRef<HTMLDivElement>(null);

  const selectedType = useMemo(
    () => ticketTypes.find((tt) => tt.id === selectedTypeId) ?? ticketTypes[0] ?? null,
    [ticketTypes, selectedTypeId]
  );

  useEffect(() => {
    if (active && inputRef.current) inputRef.current.focus();
  }, [active]);

  useEffect(() => {
    if (!showTypeDropdown) return;
    const handler = (e: MouseEvent) => {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target as Node)) {
        setShowTypeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTypeDropdown]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed) onQuickAdd(trimmed, zoneId, stageId, selectedType?.id, workUnitId);
    setValue('');
    setActive(false);
    setShowTypeDropdown(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setValue('');
      setActive(false);
      setShowTypeDropdown(false);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (rowRef.current?.contains(e.relatedTarget as Node)) return;
    handleSubmit();
  };

  return (
    <div className="backlog-group-footer">
      {!active ? (
        <div className="backlog-footer-actions">
          <button type="button" className="backlog-footer-btn" onClick={() => setActive(true)}>
            <i className="bi bi-plus" />
            {t('board.quickTicket')}
          </button>
          <span className="backlog-footer-divider" />
          <button type="button" className="backlog-footer-btn" onClick={() => onCreateTicket(zoneId)}>
            <i className="bi bi-plus-square" />
            {t('board.createTicket')}
          </button>
        </div>
      ) : (
        <div className="backlog-quick-add-row" ref={rowRef}>
          {ticketTypes.length > 0 && selectedType && (
            <div className="backlog-quick-add-type" ref={typeDropdownRef}>
              <button
                type="button"
                className="backlog-quick-add-type-btn"
                onClick={() => setShowTypeDropdown((prev) => !prev)}
                title={selectedType.name}
              >
                <i className={getTicketTypeIconClass(selectedType.icon)} style={{ color: selectedType.color }} />
                <i className="bi bi-chevron-down backlog-quick-add-type-caret" />
              </button>
              {showTypeDropdown && (
                <div className="backlog-quick-add-type-dropdown">
                  {ticketTypes.map((tt) => (
                    <button
                      key={tt.id}
                      type="button"
                      className={`backlog-quick-add-type-option${tt.id === selectedType.id ? ' active' : ''}`}
                      onClick={() => {
                        setSelectedTypeId(tt.id);
                        setShowTypeDropdown(false);
                        inputRef.current?.focus();
                      }}
                    >
                      <i className={getTicketTypeIconClass(tt.icon)} style={{ color: tt.color }} />
                      <span>{tt.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <input
            ref={inputRef}
            type="text"
            className="backlog-quick-add-input"
            placeholder={t('board.quickAddPlaceholder')}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
          />
        </div>
      )}
    </div>
  );
}

// ─── Backlog Kanban Sub-View (with droppable columns) ────────────────────────

interface BacklogKanbanViewProps {
  tickets: Ticket[];
  stages: WorkStage[];
  filter: string | null;
  groups: TicketGroup[];
  onTicketClick: (ticketId: string) => void;
}

function DroppableKanbanColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div ref={setNodeRef} className={`kanban-column${isOver ? ' kanban-column--drag-over' : ''}`}>
      {children}
    </div>
  );
}

function DraggableKanbanCard({ ticket, onClick }: { ticket: Ticket; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: ticket.id,
  });

  const style: React.CSSProperties = {
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
    position: isDragging ? ('relative' as const) : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="ticket-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick();
      }}
      {...attributes}
      {...listeners}
    >
      <p className="ticket-title mb-1">{ticket.title}</p>
      <div className="ticket-card-footer">
        <span className="ticket-id">{ticket.displayId}</span>
        {ticket.priority && <PriorityIndicator priority={ticket.priority as TicketPriority} />}
      </div>
    </div>
  );
}

function BacklogKanbanView({ tickets, stages, filter, groups, onTicketClick }: BacklogKanbanViewProps) {
  const { t } = useTranslation('ops');

  const visibleTickets = useMemo(() => {
    if (filter === null) return tickets;
    const group = groups.find((g) => g.id === filter);
    return group ? group.tickets : tickets;
  }, [tickets, filter, groups]);

  if (stages.length <= 1) {
    const visibleGroups = filter === null ? groups : groups.filter((g) => g.id === filter);
    return (
      <div className="kanban-columns" style={{ padding: '0 4px' }}>
        {visibleGroups.map((group) => (
          <DroppableKanbanColumn key={group.id} id={group.id}>
            <div className="kanban-column-header">
              <div className="kanban-column-header-left">
                <span className="kanban-column-name">{group.label}</span>
                <span className="kanban-column-count">{group.tickets.length}</span>
              </div>
            </div>
            <div className="kanban-column-body">
              {group.tickets
                .sort((a, b) => a.order - b.order)
                .map((ticket) => (
                  <DraggableKanbanCard key={ticket.id} ticket={ticket} onClick={() => onTicketClick(ticket.id)} />
                ))}
              {group.tickets.length === 0 && (
                <div className="kanban-empty-dropzone">
                  <i className="bi bi-inbox mb-1" style={{ fontSize: '1.4rem' }} />
                  <span>{t('board.emptyDropzone', 'Drop tickets here')}</span>
                </div>
              )}
            </div>
          </DroppableKanbanColumn>
        ))}
      </div>
    );
  }

  return (
    <div className="kanban-columns" style={{ padding: '0 4px' }}>
      {stages.map((stage) => {
        const stageTickets = visibleTickets.filter((tk) => tk.stageId === stage.id).sort((a, b) => a.order - b.order);
        return (
          <DroppableKanbanColumn key={stage.id} id={`bk-stage-${stage.id}`}>
            <div className="kanban-column-header">
              <div className="kanban-column-header-left">
                <span className="kanban-column-name">{stage.name}</span>
                <span className="kanban-column-count">{stageTickets.length}</span>
              </div>
            </div>
            <div className="kanban-column-body">
              {stageTickets.map((ticket) => (
                <DraggableKanbanCard key={ticket.id} ticket={ticket} onClick={() => onTicketClick(ticket.id)} />
              ))}
              {stageTickets.length === 0 && (
                <div className="kanban-empty-dropzone">
                  <i className="bi bi-inbox mb-1" style={{ fontSize: '1.4rem' }} />
                  <span>{t('board.emptyDropzone', 'Drop tickets here')}</span>
                </div>
              )}
            </div>
          </DroppableKanbanColumn>
        );
      })}
    </div>
  );
}

// ─── Filter Dropdown ─────────────────────────────────────────────────────────

interface FilterDropdownProps {
  label: string;
  value: string | null;
  options: { id: string; label: string; color?: string }[];
  onChange: (value: string | null) => void;
  allLabel: string;
}

function FilterDropdown({ label, value, options, onChange, allLabel }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className={`backlog-filter-btn ${value ? 'active' : ''}`} onClick={() => setOpen(!open)}>
        {label}
        <i className="bi bi-chevron-down" />
      </button>
      {open && (
        <div className="backlog-filter-dropdown">
          <button
            type="button"
            className={`backlog-filter-dropdown-item ${value === null ? 'active' : ''}`}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            {allLabel}
          </button>
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`backlog-filter-dropdown-item ${value === opt.id ? 'active' : ''}`}
              onClick={() => {
                onChange(opt.id);
                setOpen(false);
              }}
            >
              {opt.color && (
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: opt.color,
                    flexShrink: 0,
                  }}
                />
              )}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

const BacklogView = () => {
  const { t } = useTranslation('ops');
  const { numaPost, numaPut, numaDelete } = useNumaRequest();
  const { user } = useAuth();
  const {
    teamData,
    workUnits,
    tickets,
    config,
    refreshTickets,
    refreshWorkUnits,
    refreshTeam,
    setActiveZone,
    setTickets,
    myWorkFilter,
  } = useOps();

  // ── Staff lookup map for avatars ────────────────────────────────
  const staffMap = useMemo(() => {
    const map = new Map<string, StaffProfile>();
    if (config?.staff) {
      for (const s of config.staff) map.set(s.id, s);
    }
    return map;
  }, [config?.staff]);

  // ── Sprint modal state ──────────────────────────────────────────
  const [showCreateSprint, setShowCreateSprint] = useState(false);
  const [showStartSprint, setShowStartSprint] = useState(false);
  const [startSprintId, setStartSprintId] = useState<string | null>(null);
  const [showSprintSuccess, setShowSprintSuccess] = useState(false);
  const [successWorkUnit, setSuccessWorkUnit] = useState<WorkUnit | null>(null);

  const hasActiveWu = useMemo(() => workUnits.some((wu) => wu.status === 'active'), [workUnits]);
  const teamId = teamData?.team?.id ?? '';
  const workUnitsEnabled = Boolean(teamData?.team?.workUnitSeries);
  const defaultSprintName = useMemo(() => {
    const label = teamData?.team?.workUnitSeries?.label ?? 'Sprint';
    return `${label} ${workUnits.length + 1}`;
  }, [teamData?.team?.workUnitSeries?.label, workUnits.length]);

  // ── Delete Sprint handler ────────────────────────────────────
  const [deletingSprint, setDeletingSprint] = useState(false);
  const handleDeleteSprint = useCallback(
    async (wu: WorkUnit) => {
      if (!teamId || deletingSprint) return;
      if (!window.confirm(t('sprints.deleteSprintConfirm', { name: wu.name }))) return;
      setDeletingSprint(true);
      try {
        await OpsService.deleteWorkUnit(numaDelete, teamId, wu.id);
        await Promise.all([refreshWorkUnits(), refreshTickets()]);
      } catch (err) {
        console.error('[BacklogView] Failed to delete work unit:', err);
      } finally {
        setDeletingSprint(false);
      }
    },
    [teamId, deletingSprint, numaDelete, refreshWorkUnits, refreshTickets, t]
  );

  // ── Filters ────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [customerFilter, setCustomerFilter] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(`numa_ops_collapsed_groups_${teamId}`);
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [groupOrder, setGroupOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`numa_ops_group_order_${teamId}`);
      return saved ? (JSON.parse(saved) as string[]) : [];
    } catch {
      return [];
    }
  });

  // ── View mode with localStorage persistence ────────────────────
  const [viewMode, setViewMode] = useState<BacklogViewMode>(() => {
    try {
      const saved = localStorage.getItem('numa_ops_backlog_view_mode');
      return saved === 'kanban' ? 'kanban' : 'list';
    } catch {
      return 'list';
    }
  });

  const handleSetViewMode = useCallback((mode: BacklogViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('numa_ops_backlog_view_mode', mode);
    } catch {
      /* quota exceeded */
    }
  }, []);

  // ── Modal state ──────────────────────────────────────────────
  const [detailTicketId, setDetailTicketId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createZoneId, setCreateZoneId] = useState<string | undefined>();

  // ── DnD state ────────────────────────────────────────────────
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const zones = teamData?.zones ?? [];

  // ── Lookup maps ────────────────────────────────────────────────
  const stageMap = useMemo(() => {
    const map = new Map<string, { name: string; statusType: StatusType; zoneId: string }>();
    if (teamData) {
      for (const s of teamData.stages) {
        map.set(s.id, { name: s.name, statusType: s.statusType as StatusType, zoneId: s.zoneId });
      }
    }
    return map;
  }, [teamData]);

  const typeMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    if (config) {
      for (const tt of config.ticketTypes) {
        map.set(tt.id, { name: tt.name, color: tt.color });
      }
    }
    return map;
  }, [config]);

  // ── Backlog zone IDs ─────────────────────────────────────────
  const backlogZoneIds = useMemo(
    () => new Set(zones.filter((z) => z.zoneType === 'backlog').map((z) => z.id)),
    [zones]
  );

  const firstBacklogZoneId = useMemo(() => zones.find((z) => z.zoneType === 'backlog')?.id ?? '', [zones]);

  // ── All tickets in backlog zones (exclude archived, apply my-work filter) ────────
  const backlogTickets = useMemo(() => {
    let result = tickets.filter((tk) => backlogZoneIds.has(tk.zoneId) && !tk.archived);
    const userSub = user?.decoded_tokens?.idToken?.sub;
    if (myWorkFilter && userSub) {
      result = result.filter((tk) => tk.assigneeId && tk.assigneeId === userSub);
    }
    return result;
  }, [tickets, backlogZoneIds, myWorkFilter, user?.decoded_tokens?.idToken?.sub]);

  // ── Filtered tickets (search + assignee + type + priority) ────
  const filteredTickets = useMemo(() => {
    let result = backlogTickets;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((tk) => tk.title.toLowerCase().includes(q) || tk.displayId.toLowerCase().includes(q));
    }
    if (assigneeFilter.size > 0) {
      result = result.filter((tk) => tk.assigneeId && assigneeFilter.has(tk.assigneeId));
    }
    if (typeFilter) {
      result = result.filter((tk) => tk.ticketTypeId === typeFilter);
    }
    if (priorityFilter) {
      result = result.filter((tk) => tk.priority === priorityFilter);
    }
    if (projectFilter) {
      result = result.filter((tk) => tk.projectId === projectFilter);
    }
    if (customerFilter) {
      result = result.filter((tk) => tk.customerId === customerFilter);
    }
    return result;
  }, [backlogTickets, searchQuery, assigneeFilter, typeFilter, priorityFilter, projectFilter, customerFilter]);

  // ── Assignees in backlog (for avatar filters) ──────────────────
  const backlogAssignees = useMemo(() => {
    const seen = new Map<string, string>();
    for (const tk of backlogTickets) {
      if (tk.assigneeId && tk.assigneeName && !seen.has(tk.assigneeId)) {
        seen.set(tk.assigneeId, tk.assigneeName);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name, staff: staffMap.get(id) }));
  }, [backlogTickets, staffMap]);

  // ── Type options for filter ────────────────────────────────────
  const typeOptions = useMemo(() => {
    if (!config) return [];
    const usedTypes = new Set(backlogTickets.map((t) => t.ticketTypeId));
    return config.ticketTypes
      .filter((tt) => usedTypes.has(tt.id))
      .map((tt) => ({ id: tt.id, label: tt.name, color: tt.color }));
  }, [config, backlogTickets]);

  // ── Priority options for filter ────────────────────────────────
  const priorityOptions = useMemo(() => {
    const priorities: TicketPriority[] = ['highest', 'high', 'medium', 'low', 'lowest'];
    return priorities.map((p) => ({ id: p, label: t(`priority.${p}`) }));
  }, [t]);

  // ── Project options for filter ──────────────────────────────────
  const projectOptions = useMemo(() => {
    if (!config?.projects) return [];
    const usedIds = new Set(backlogTickets.map((tk) => tk.projectId).filter(Boolean));
    return config.projects
      .filter((p) => usedIds.has(p.id) && (!p.boardIds?.length || p.boardIds.includes(teamId)))
      .map((p) => ({ id: p.id, label: p.name, color: p.color }));
  }, [config?.projects, backlogTickets, teamId]);

  // ── Customer options for filter ────────────────────────────────
  const customerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const tk of backlogTickets) {
      if (tk.customerId && tk.customerName && !seen.has(tk.customerId)) {
        seen.set(tk.customerId, tk.customerName);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, label: name }));
  }, [backlogTickets]);

  // ── Planning work units ────────────────────────────────────────
  const planningUnits = useMemo(
    () => workUnits.filter((wu) => wu.status === 'planning').sort((a, b) => a.order - b.order),
    [workUnits]
  );

  // ── Backlog stages (ordered) ──────────────────────────────────
  const backlogStages = useMemo(() => {
    if (!teamData) return [];
    return teamData.stages.filter((s) => backlogZoneIds.has(s.zoneId)).sort((a, b) => a.order - b.order);
  }, [teamData, backlogZoneIds]);

  // ── Build groups (using filteredTickets) ───────────────────────
  const groups = useMemo<TicketGroup[]>(() => {
    const result: TicketGroup[] = [];

    const unassigned = filteredTickets.filter((tk) => !tk.workUnitId);
    if (backlogStages.length > 1) {
      for (const stage of backlogStages) {
        const stageTickets = unassigned.filter((tk) => tk.stageId === stage.id);
        result.push({
          id: `stage-${stage.id}`,
          label: stage.name,
          tickets: stageTickets,
          zoneId: stage.zoneId,
          stageId: stage.id,
        });
      }
      const stageIds = new Set(backlogStages.map((s) => s.id));
      const orphans = unassigned.filter((tk) => !stageIds.has(tk.stageId));
      if (orphans.length > 0) {
        result.push({
          id: 'backlog-other',
          label: t('sprints.backlog'),
          tickets: orphans,
          zoneId: firstBacklogZoneId,
        });
      }
    } else {
      result.push({
        id: 'backlog',
        label: t('sprints.backlog'),
        tickets: unassigned,
        zoneId: firstBacklogZoneId,
        stageId: backlogStages[0]?.id,
      });
    }

    for (const wu of planningUnits) {
      const wuTickets = filteredTickets.filter((tk) => tk.workUnitId === wu.id);
      const wuZoneId = (teamData?.team?.workUnitSeries?.backlogZoneId as string | undefined) ?? firstBacklogZoneId;
      result.push({
        id: wu.id,
        label: wu.name,
        sublabel: t('sprints.planning'),
        tickets: wuTickets,
        workUnit: wu,
        zoneId: wuZoneId,
        stageId: backlogStages.find((s) => s.zoneId === wuZoneId)?.id,
      });
    }

    return result;
  }, [filteredTickets, backlogStages, planningUnits, t, firstBacklogZoneId, teamData]);

  // ── Group lookup maps (for DnD) ────────────────────────────────
  const groupMap = useMemo(() => {
    const map = new Map<string, TicketGroup>();
    for (const g of groups) map.set(g.id, g);
    return map;
  }, [groups]);

  // Reverse lookup: ticket ID -> group
  const ticketGroupMap = useMemo(() => {
    const map = new Map<string, TicketGroup>();
    for (const g of groups) {
      for (const tk of g.tickets) map.set(tk.id, g);
    }
    return map;
  }, [groups]);

  // ── Visible groups (group filter + custom ordering) ─────────────
  const orderedGroups = useMemo(() => {
    if (groupOrder.length === 0) return groups;
    const orderMap = new Map(groupOrder.map((id, idx) => [id, idx]));
    return [...groups].sort((a, b) => {
      const aIdx = orderMap.get(a.id) ?? Infinity;
      const bIdx = orderMap.get(b.id) ?? Infinity;
      if (aIdx === Infinity && bIdx === Infinity) return 0;
      return aIdx - bIdx;
    });
  }, [groups, groupOrder]);

  const visibleGroups = useMemo(() => {
    if (groupFilter === null) return orderedGroups;
    return orderedGroups.filter((g) => g.id === groupFilter);
  }, [orderedGroups, groupFilter]);

  const moveGroup = useCallback(
    (groupId: string, direction: 'up' | 'down') => {
      const currentOrder = orderedGroups.map((g) => g.id);
      const idx = currentOrder.indexOf(groupId);
      if (idx < 0) return;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= currentOrder.length) return;
      const newOrder = [...currentOrder];
      [newOrder[idx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[idx]];
      setGroupOrder(newOrder);
      if (teamId) {
        try {
          localStorage.setItem(`numa_ops_group_order_${teamId}`, JSON.stringify(newOrder));
        } catch {
          /* noop */
        }
      }
    },
    [orderedGroups, teamId]
  );

  // ── Toggle collapse ────────────────────────────────────────────
  const toggleGroup = useCallback(
    (groupId: string) => {
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(groupId)) next.delete(groupId);
        else next.add(groupId);
        if (teamId) {
          try {
            localStorage.setItem(`numa_ops_collapsed_groups_${teamId}`, JSON.stringify([...next]));
          } catch {
            /* noop */
          }
        }
        return next;
      });
    },
    [teamId]
  );

  // Reload collapsed/order state when team changes
  useEffect(() => {
    if (!teamId) return;
    try {
      const savedCollapsed = localStorage.getItem(`numa_ops_collapsed_groups_${teamId}`);
      setCollapsedGroups(savedCollapsed ? new Set(JSON.parse(savedCollapsed) as string[]) : new Set());
      const savedOrder = localStorage.getItem(`numa_ops_group_order_${teamId}`);
      setGroupOrder(savedOrder ? (JSON.parse(savedOrder) as string[]) : []);
    } catch {
      setCollapsedGroups(new Set());
      setGroupOrder([]);
    }
  }, [teamId]);

  // ── Project name lookup ─────────────────────────────────────────
  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (config?.projects) {
      for (const p of config.projects) map.set(p.id, p.name);
    }
    return map;
  }, [config?.projects]);

  // ── All stages for inline picker ──────────────────────────────
  const allStages = useMemo(() => (teamData?.stages ?? []).sort((a, b) => a.order - b.order), [teamData?.stages]);

  // Stages grouped by zone (for pickers with zone headers)
  const stageGroups = useMemo<StageGroup[]>(() => {
    const zoneNameMap = new Map<string, string>();
    for (const z of zones) zoneNameMap.set(z.id, z.name);
    const grouped = new Map<string, WorkStage[]>();
    for (const s of allStages) {
      const list = grouped.get(s.zoneId) ?? [];
      list.push(s);
      grouped.set(s.zoneId, list);
    }
    return Array.from(grouped.entries()).map(([zoneId, stages]) => ({
      zoneName: zoneNameMap.get(zoneId) ?? '',
      stages,
    }));
  }, [allStages, zones]);

  // ── Selection state ────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedTickets = useMemo(
    () => filteredTickets.filter((tk) => selectedIds.has(tk.id)),
    [filteredTickets, selectedIds]
  );
  const handleToggleSelect = useCallback((ticketId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });
  }, []);
  const handleDeselectAll = useCallback(() => setSelectedIds(new Set()), []);

  // ── Handlers ───────────────────────────────────────────────────
  const handleInlineStageChange = useCallback(
    async (ticketId: string, newStageId: string) => {
      const ticket = filteredTickets.find((tk) => tk.id === ticketId);
      if (!ticket) return;
      const stage = allStages.find((s) => s.id === newStageId);
      if (!stage) return;

      // Optimistic update
      setTickets((prev) =>
        prev.map((tk) => (tk.id === ticketId ? { ...tk, stageId: newStageId, zoneId: stage.zoneId } : tk))
      );

      try {
        await OpsService.updateTicket(numaPut, ticketId, {
          teamId: ticket.teamId,
          stageId: newStageId,
          zoneId: stage.zoneId,
          version: ticket.version,
        });
        await refreshTickets();
      } catch (err) {
        console.error('[BacklogView] Failed to change stage:', err);
        await refreshTickets();
      }
    },
    [filteredTickets, allStages, numaPut, refreshTickets, setTickets]
  );

  // ── Bulk action handlers ────────────────────────────────────────
  const [bulkActing, setBulkActing] = useState(false);
  const [showBulkMove, setShowBulkMove] = useState(false);
  const bulkMoveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showBulkMove) return;
    const handler = (e: MouseEvent) => {
      if (bulkMoveRef.current && !bulkMoveRef.current.contains(e.target as Node)) {
        setShowBulkMove(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showBulkMove]);

  const handleBulkMove = useCallback(
    async (stageId: string) => {
      if (selectedTickets.length === 0 || bulkActing) return;
      const stage = allStages.find((s) => s.id === stageId);
      if (!stage) return;
      setBulkActing(true);
      setShowBulkMove(false);
      try {
        await OpsService.bulkUpdateTickets(numaPost, {
          ticketIds: selectedTickets.map((tk) => tk.id),
          changes: { stageId, zoneId: stage.zoneId, teamId },
        });
        setSelectedIds(new Set());
        await refreshTickets();
      } catch (err) {
        console.error('[BacklogView] Bulk move failed:', err);
      } finally {
        setBulkActing(false);
      }
    },
    [selectedTickets, bulkActing, allStages, numaPost, refreshTickets]
  );

  const handleBulkArchive = useCallback(async () => {
    if (selectedTickets.length === 0 || bulkActing) return;
    setBulkActing(true);
    try {
      await Promise.all(selectedTickets.map((tk) => OpsService.archiveTicket(numaPut, tk.id, tk.version, tk.teamId)));
      setSelectedIds(new Set());
      await refreshTickets();
    } catch (err) {
      console.error('[BacklogView] Bulk archive failed:', err);
    } finally {
      setBulkActing(false);
    }
  }, [selectedTickets, bulkActing, numaPut, refreshTickets]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedTickets.length === 0 || bulkActing) return;
    if (!window.confirm(t('tickets.deleteConfirm'))) return;
    setBulkActing(true);
    try {
      await Promise.all(selectedTickets.map((tk) => OpsService.deleteTicket(numaDelete, tk.id, tk.teamId)));
      setSelectedIds(new Set());
      await refreshTickets();
    } catch (err) {
      console.error('[BacklogView] Bulk delete failed:', err);
    } finally {
      setBulkActing(false);
    }
  }, [selectedTickets, bulkActing, numaDelete, refreshTickets, t]);

  const handleTicketClick = useCallback((ticketId: string) => {
    setDetailTicketId(ticketId);
    setShowDetail(true);
  }, []);

  const handleAddTicket = useCallback((zoneId: string) => {
    setCreateZoneId(zoneId);
    setShowCreate(true);
  }, []);

  const handleBacklogQuickAdd = useCallback(
    async (title: string, zoneId: string, stageId?: string, ticketTypeId?: string, workUnitId?: string) => {
      if (!teamId || !config?.ticketTypes?.[0]) return;
      const resolvedStageId = stageId ?? teamData?.stages?.find((s) => s.zoneId === zoneId)?.id;
      if (!resolvedStageId) return;
      const resolvedTypeId = ticketTypeId ?? config.ticketTypes[0].id;
      try {
        await OpsService.createTicket(numaPost, {
          teamId,
          ticketTypeId: resolvedTypeId,
          title,
          stageId: resolvedStageId,
          zoneId,
          priority: 'medium',
          workUnitId,
        });
        await refreshTickets();
      } catch (err) {
        console.error('[BacklogView] Quick add failed:', err);
      }
    },
    [teamId, config?.ticketTypes, teamData?.stages, numaPost, refreshTickets]
  );

  const toggleAssignee = useCallback((assigneeId: string) => {
    setAssigneeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(assigneeId)) next.delete(assigneeId);
      else next.add(assigneeId);
      return next;
    });
  }, []);

  // ── DnD Handlers ───────────────────────────────────────────────
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const ticketId = event.active.id as string;
      const ticket = filteredTickets.find((tk) => tk.id === ticketId) ?? null;
      setActiveTicket(ticket);
    },
    [filteredTickets]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveTicket(null);

      const { active, over } = event;
      if (!over) return;

      const ticketId = active.id as string;
      const overId = over.id as string;

      const ticket = filteredTickets.find((tk) => tk.id === ticketId);
      if (!ticket) return;

      // Determine target based on droppable ID
      let newZoneId = ticket.zoneId;
      let newStageId = ticket.stageId;
      let newWorkUnitId: string | null | undefined = ticket.workUnitId;
      let insertIndex: number | null = null;

      if (overId.startsWith('bk-stage-')) {
        // Kanban mode: dropped on a stage column
        const stageId = overId.replace('bk-stage-', '');
        const stageInfo = stageMap.get(stageId);
        if (!stageInfo) return;
        newStageId = stageId;
        newZoneId = stageInfo.zoneId;
      } else {
        // Check if dropped on another ticket (within-group reorder or cross-group)
        const overTicket = filteredTickets.find((tk) => tk.id === overId);
        if (overTicket) {
          const sourceGroup = ticketGroupMap.get(ticketId);
          const targetGroup = ticketGroupMap.get(overId);

          if (targetGroup) {
            newZoneId = targetGroup.zoneId;
            if (targetGroup.stageId) newStageId = targetGroup.stageId;
            newWorkUnitId = targetGroup.workUnit?.id ?? null;

            // Calculate insertion index based on the over ticket's position
            const sortedGroupTickets = targetGroup.tickets
              .filter((tk) => tk.id !== ticketId)
              .sort((a, b) => a.order - b.order);
            const overIndex = sortedGroupTickets.findIndex((tk) => tk.id === overId);

            if (sourceGroup?.id === targetGroup.id) {
              // Same group: determine direction
              const allSorted = targetGroup.tickets.sort((a, b) => a.order - b.order);
              const origDragIdx = allSorted.findIndex((tk) => tk.id === ticketId);
              const origOverIdx = allSorted.findIndex((tk) => tk.id === overId);
              insertIndex = origDragIdx < origOverIdx ? overIndex + 1 : overIndex;
            } else {
              insertIndex = overIndex >= 0 ? overIndex : sortedGroupTickets.length;
            }
          }
        } else {
          // Dropped on a group droppable
          const targetGroup = groupMap.get(overId);
          if (!targetGroup) return;

          newZoneId = targetGroup.zoneId;
          if (targetGroup.stageId) newStageId = targetGroup.stageId;
          newWorkUnitId = targetGroup.workUnit?.id ?? null;
        }
      }

      // Build destination ticket list for order calculation
      const destTickets = filteredTickets
        .filter((tk) => {
          if (tk.id === ticketId) return false;
          if (overId.startsWith('bk-stage-')) return tk.stageId === newStageId;
          // For ticket-on-ticket drops, use the target group's tickets
          const overTicket = filteredTickets.find((t) => t.id === overId);
          if (overTicket) {
            const tg = ticketGroupMap.get(overId);
            return tg ? tg.tickets.some((gt) => gt.id === tk.id) : false;
          }
          const g = groupMap.get(overId);
          return g ? g.tickets.some((gt) => gt.id === tk.id) : false;
        })
        .sort((a, b) => a.order - b.order);

      const effectiveIndex = insertIndex ?? destTickets.length;

      // No-op if same group, same position
      if (newStageId === ticket.stageId && newWorkUnitId === ticket.workUnitId) {
        const currentSorted = destTickets;
        const currentIdx = [...currentSorted, ticket]
          .sort((a, b) => a.order - b.order)
          .findIndex((tk) => tk.id === ticketId);
        if (currentIdx === effectiveIndex || currentIdx === effectiveIndex - 1) return;
      }

      const newOrder = calculateNewOrder(destTickets, effectiveIndex);

      // Optimistic update
      setTickets((prev) =>
        prev.map((tk) =>
          tk.id === ticketId
            ? { ...tk, stageId: newStageId, zoneId: newZoneId, workUnitId: newWorkUnitId, order: newOrder }
            : tk
        )
      );

      try {
        await OpsService.updateTicket(numaPut, ticketId, {
          teamId: ticket.teamId,
          stageId: newStageId,
          zoneId: newZoneId,
          workUnitId: newWorkUnitId,
          order: newOrder,
          version: ticket.version,
        });
        await refreshTickets();
      } catch (err) {
        console.error('[BacklogView] Failed to move ticket:', err);
        await refreshTickets();
      }
    },
    [filteredTickets, groupMap, ticketGroupMap, stageMap, numaPut, refreshTickets, setTickets]
  );

  return (
    <>
      <div className="p-3">
        {/* ── Filter Bar ─────────────────────────────────────────── */}
        <div className="backlog-filter-bar">
          <div className="backlog-search-wrapper">
            <i className="bi bi-search" />
            <input
              type="text"
              className="backlog-search-input"
              placeholder={t('backlogView.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {backlogAssignees.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`backlog-assignee-filter ${assigneeFilter.has(a.id) ? 'active' : ''}`}
              title={a.name}
              onClick={() => toggleAssignee(a.id)}
            >
              <StaffAvatar staff={a.staff} name={!a.staff ? a.name : undefined} size={28} />
            </button>
          ))}

          {(backlogAssignees.length > 0 || typeOptions.length > 0) && <div className="backlog-filter-divider" />}

          {typeOptions.length > 0 && (
            <FilterDropdown
              label={t('backlogView.type')}
              value={typeFilter}
              options={typeOptions}
              onChange={setTypeFilter}
              allLabel={t('backlogView.allTypes')}
            />
          )}

          <FilterDropdown
            label={t('backlogView.priority')}
            value={priorityFilter}
            options={priorityOptions}
            onChange={setPriorityFilter}
            allLabel={t('backlogView.allPriorities')}
          />

          {projectOptions.length > 0 && (
            <FilterDropdown
              label={t('tickets.project')}
              value={projectFilter}
              options={projectOptions}
              onChange={setProjectFilter}
              allLabel={t('backlogView.allProjects')}
            />
          )}

          {customerOptions.length > 0 && (
            <FilterDropdown
              label={t('tickets.customer')}
              value={customerFilter}
              options={customerOptions}
              onChange={setCustomerFilter}
              allLabel={t('backlogView.allCustomers')}
            />
          )}

          <div className="flex-grow-1" />

          <button
            type="button"
            className={`ops-pill ${groupFilter === null ? 'active' : ''}`}
            onClick={() => setGroupFilter(null)}
          >
            {t('sprints.all')}
            <span className="ops-pill-count">{filteredTickets.length}</span>
          </button>
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              className={`ops-pill ${groupFilter === group.id ? 'active' : ''}`}
              onClick={() => setGroupFilter(group.id)}
            >
              {group.label}
              <span className="ops-pill-count">{group.tickets.length}</span>
            </button>
          ))}

          {workUnitsEnabled && (
            <button type="button" className="ops-pill" style={{ gap: 4 }} onClick={() => setShowCreateSprint(true)}>
              <i className="bi bi-plus" />
              {t('sprints.new')}
            </button>
          )}

          <div className="backlog-filter-divider" />

          <div
            style={{
              display: 'flex',
              border: '1px solid var(--ops-border, #e4e4e7)',
              borderRadius: 8,
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              title={t('backlogView.listView')}
              onClick={() => handleSetViewMode('list')}
              style={{
                padding: '5px 10px',
                border: 'none',
                background: viewMode === 'list' ? 'var(--brand-primary, #8e50a7)' : '#fff',
                color: viewMode === 'list' ? '#fff' : '#6b7280',
                cursor: 'pointer',
                fontSize: '0.85rem',
                transition: 'all 0.15s',
              }}
            >
              <i className="bi bi-list-task" />
            </button>
            <button
              type="button"
              title={t('backlogView.kanbanView')}
              onClick={() => handleSetViewMode('kanban')}
              style={{
                padding: '5px 10px',
                border: 'none',
                borderLeft: '1px solid var(--ops-border, #e4e4e7)',
                background: viewMode === 'kanban' ? 'var(--brand-primary, #8e50a7)' : '#fff',
                color: viewMode === 'kanban' ? '#fff' : '#6b7280',
                cursor: 'pointer',
                fontSize: '0.85rem',
                transition: 'all 0.15s',
              }}
            >
              <i className="bi bi-kanban" />
            </button>
          </div>
        </div>

        {/* ── Content (wrapped in DndContext) ──────────────────────── */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {viewMode === 'kanban' ? (
            <BacklogKanbanView
              tickets={filteredTickets}
              stages={backlogStages}
              filter={groupFilter}
              groups={groups}
              onTicketClick={handleTicketClick}
            />
          ) : (
            <>
              {visibleGroups.map((group) => {
                const isCollapsed = collapsedGroups.has(group.id);
                const summary = statusSummary(group.tickets);
                const wu = group.workUnit;

                const groupAssignees = new Map<string, string>();
                for (const tk of group.tickets) {
                  if (tk.assigneeId && tk.assigneeName) {
                    groupAssignees.set(tk.assigneeId, tk.assigneeName);
                  }
                }

                return (
                  <div key={group.id} className="backlog-group-card">
                    <div
                      className="backlog-group-header"
                      onClick={() => toggleGroup(group.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleGroup(group.id);
                        }
                      }}
                    >
                      {visibleGroups.length > 1 && (
                        <div className="backlog-group-reorder" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="backlog-reorder-btn"
                            disabled={visibleGroups.indexOf(group) === 0}
                            onClick={() => moveGroup(group.id, 'up')}
                            title={t('backlogView.moveUp')}
                          >
                            <i className="bi bi-arrow-up-short" />
                          </button>
                          <button
                            type="button"
                            className="backlog-reorder-btn"
                            disabled={visibleGroups.indexOf(group) === visibleGroups.length - 1}
                            onClick={() => moveGroup(group.id, 'down')}
                            title={t('backlogView.moveDown')}
                          >
                            <i className="bi bi-arrow-down-short" />
                          </button>
                        </div>
                      )}
                      <i
                        className={`bi bi-chevron-${isCollapsed ? 'right' : 'down'}`}
                        style={{ fontSize: 12, color: '#6b7280', flexShrink: 0 }}
                      />
                      <span className="backlog-group-name">{group.label}</span>

                      {wu && (wu.startDate || wu.endDate) && (
                        <span className="backlog-group-meta">
                          {shortDate(wu.startDate)}
                          {wu.startDate && wu.endDate ? ' \u2013 ' : ''}
                          {shortDate(wu.endDate)}
                        </span>
                      )}

                      {group.sublabel && (
                        <span className="badge bg-info bg-opacity-25 text-info" style={{ fontSize: '0.68rem' }}>
                          {group.sublabel}
                        </span>
                      )}

                      <span className="backlog-group-meta">
                        {t('backlogView.workItems', { count: group.tickets.length })}
                      </span>

                      <div className="backlog-status-summary">
                        <span className="backlog-status-badge backlog-status-badge--backlog">{summary.backlog}</span>
                        <span className="backlog-status-badge backlog-status-badge--active">{summary.active}</span>
                        <span className="backlog-status-badge backlog-status-badge--done">{summary.done}</span>
                      </div>

                      <button
                        type="button"
                        className="backlog-add-btn"
                        title={t('backlogView.addTicket')}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddTicket(group.zoneId);
                        }}
                      >
                        <i className="bi bi-plus-lg" />
                      </button>

                      {wu && wu.status === 'planning' && (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-success ms-1"
                            style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                            disabled={hasActiveWu}
                            title={hasActiveWu ? t('sprints.completeCurrentFirst') : t('sprints.start')}
                            onClick={(e) => {
                              e.stopPropagation();
                              setStartSprintId(wu.id);
                              setShowStartSprint(true);
                            }}
                          >
                            <i className="bi bi-play-fill me-1" />
                            {t('sprints.start')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger ms-1"
                            style={{ fontSize: '0.72rem', padding: '2px 6px' }}
                            disabled={deletingSprint}
                            title={t('sprints.deleteSprint')}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSprint(wu);
                            }}
                          >
                            <i className="bi bi-trash" />
                          </button>
                        </>
                      )}
                    </div>

                    {wu?.goal && !isCollapsed && (
                      <div className="backlog-group-subheader">
                        <span className="backlog-group-goal">{wu.goal}</span>
                        {groupAssignees.size > 0 && (
                          <div className="backlog-group-avatars">
                            {Array.from(groupAssignees.entries())
                              .slice(0, 5)
                              .map(([id, name]) => (
                                <span key={id} title={name}>
                                  <StaffAvatar
                                    staff={staffMap.get(id)}
                                    name={!staffMap.has(id) ? name : undefined}
                                    size={22}
                                  />
                                </span>
                              ))}
                            {groupAssignees.size > 5 && (
                              <span className="ticket-avatar" style={{ backgroundColor: '#9ca3af' }}>
                                {`+${groupAssignees.size - 5}`}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {!isCollapsed && (
                      <>
                        <DroppableGroupBody
                          groupId={group.id}
                          ticketIds={group.tickets.sort((a, b) => a.order - b.order).map((tk) => tk.id)}
                        >
                          {group.tickets.length === 0 ? (
                            <div className="kanban-empty-dropzone my-2 mx-3 text-center" style={{ minHeight: '80px' }}>
                              <i className="bi bi-inbox mb-1" style={{ fontSize: '1.4rem', color: '#9ca3af' }} />
                              <span>{t('backlogView.noTickets')}</span>
                            </div>
                          ) : (
                            group.tickets
                              .sort((a, b) => a.order - b.order)
                              .map((ticket) => (
                                <DraggableRow
                                  key={ticket.id}
                                  ticket={ticket}
                                  typeInfo={typeMap.get(ticket.ticketTypeId)}
                                  stageInfo={stageMap.get(ticket.stageId)}
                                  stageGroups={stageGroups}
                                  assigneeStaff={ticket.assigneeId ? staffMap.get(ticket.assigneeId) : undefined}
                                  projectName={ticket.projectId ? projectNameMap.get(ticket.projectId) : null}
                                  selected={selectedIds.has(ticket.id)}
                                  onClick={() => handleTicketClick(ticket.id)}
                                  onStageChange={handleInlineStageChange}
                                  onSelect={handleToggleSelect}
                                />
                              ))
                          )}
                        </DroppableGroupBody>
                        <BacklogGroupFooter
                          zoneId={group.zoneId}
                          stageId={group.stageId}
                          workUnitId={group.workUnit?.id}
                          ticketTypes={config?.ticketTypes ?? []}
                          onQuickAdd={handleBacklogQuickAdd}
                          onCreateTicket={handleAddTicket}
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* Drag overlay preview */}
          <DragOverlay>
            {activeTicket ? (
              <div
                className="ticket-card"
                style={{
                  width: 320,
                  opacity: 0.96,
                  boxShadow: '0 12px 28px rgba(0,0,0,0.18)',
                  rotate: '2deg',
                }}
              >
                <p className="ticket-title mb-1">{activeTicket.title}</p>
                <div className="ticket-card-footer">
                  <span className="ticket-id">{activeTicket.displayId}</span>
                  {activeTicket.priority && <PriorityIndicator priority={activeTicket.priority as TicketPriority} />}
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Bulk action bar */}
        {selectedTickets.length > 0 && (
          <div className="backlog-bulk-bar">
            <span className="bulk-count">{t('bulk.selected', { count: selectedTickets.length })}</span>

            <div ref={bulkMoveRef} style={{ position: 'relative' }}>
              <button
                type="button"
                className="bulk-action"
                disabled={bulkActing}
                onClick={() => setShowBulkMove((prev) => !prev)}
              >
                <i className="bi bi-arrow-right-circle" />
                {t('tickets.status')}
              </button>
              {showBulkMove && (
                <div className="backlog-stage-picker" style={{ bottom: '100%', top: 'auto', marginBottom: 4 }}>
                  {stageGroups.map((group) => (
                    <div key={group.zoneName}>
                      {stageGroups.length > 1 && <div className="backlog-stage-picker-zone">{group.zoneName}</div>}
                      {group.stages.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="backlog-stage-picker-item"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => handleBulkMove(s.id)}
                        >
                          <span className={`backlog-status-dot backlog-status-dot--${s.statusType}`} />
                          {s.name}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button type="button" className="bulk-action" disabled={bulkActing} onClick={handleBulkArchive}>
              <i className="bi bi-archive" />
              {t('archive.archive')}
            </button>

            <button
              type="button"
              className="bulk-action bulk-action--danger"
              disabled={bulkActing}
              onClick={handleBulkDelete}
            >
              <i className="bi bi-trash" />
              {t('bulk.bulkDelete')}
            </button>

            <button type="button" className="bulk-dismiss" onClick={handleDeselectAll} title={t('bulk.deselectAll')}>
              <i className="bi bi-x-lg" />
            </button>
          </div>
        )}

        {/* Empty state */}
        {backlogTickets.length === 0 && (
          <div className="d-flex flex-column align-items-center justify-content-center py-5">
            <div
              className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3"
              style={{ width: 56, height: 56, backgroundColor: '#f3f4f6' }}
            >
              <i className="bi bi-inbox" style={{ fontSize: '1.5rem', color: '#9ca3af' }} />
            </div>
            <span style={{ color: '#9ca3af', fontSize: '0.9rem' }}>{t('backlogView.empty')}</span>
            <span style={{ color: '#d1d5db', fontSize: '0.8rem', marginTop: 4 }}>{t('backlogView.emptyHint')}</span>
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────── */}
      {workUnitsEnabled && (
        <CreateWorkUnitModal
          show={showCreateSprint}
          teamId={teamId}
          defaultName={defaultSprintName}
          onHide={() => setShowCreateSprint(false)}
          onCreated={async () => {
            setShowCreateSprint(false);
            await refreshWorkUnits();
          }}
        />
      )}
      <TicketDetailModal
        show={showDetail}
        ticketId={detailTicketId}
        onHide={() => {
          setShowDetail(false);
          setDetailTicketId(null);
        }}
      />
      <CreateTicketModal
        show={showCreate}
        onHide={() => {
          setShowCreate(false);
          setCreateZoneId(undefined);
        }}
        onSuccess={() => {
          setShowCreate(false);
          setCreateZoneId(undefined);
          refreshTickets();
        }}
        prefilledZoneId={createZoneId}
      />
      <StartWorkUnitModal
        show={showStartSprint}
        workUnits={workUnits}
        teamId={teamId}
        tickets={tickets}
        zones={zones}
        preselectedId={startSprintId}
        onHide={() => setShowStartSprint(false)}
        onStarted={async () => {
          setShowStartSprint(false);
          const started = workUnits.find((wu) => wu.status === 'planning');
          if (started) {
            setSuccessWorkUnit(started);
            setShowSprintSuccess(true);
          }
          const beforeZoneIds = new Set(zones.map((z) => z.id));
          const updated = await refreshTeam();
          if (updated) {
            const newZone = updated.zones.find((z) => !beforeZoneIds.has(z.id));
            if (newZone) setActiveZone(newZone.id);
          }
          await Promise.all([refreshTickets(), refreshWorkUnits()]);
        }}
      />
      <WorkUnitSuccessModal
        show={showSprintSuccess}
        workUnit={successWorkUnit}
        action="started"
        onHide={() => {
          setShowSprintSuccess(false);
          setSuccessWorkUnit(null);
        }}
      />
    </>
  );
};

export default BacklogView;
