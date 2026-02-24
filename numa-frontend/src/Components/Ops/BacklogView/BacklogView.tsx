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
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import { TicketDetailModal } from '../Modals/TicketDetailModal';
import { CreateTicketModal } from '../Modals/CreateTicketModal';
import { PriorityIndicator } from '../Shared/PriorityIndicator';
import type { WorkUnit, Ticket, WorkStage, TicketPriority, StatusType } from '../../../types/ops';

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

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 55%, 50%)`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
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

interface DraggableRowProps {
  ticket: Ticket;
  typeInfo: { name: string; color: string } | undefined;
  stageInfo: { name: string; statusType: StatusType } | undefined;
  onClick: () => void;
}

function DraggableRow({ ticket, typeInfo, stageInfo, onClick }: DraggableRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: ticket.id,
  });

  const style: React.CSSProperties = {
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
    position: isDragging ? ('relative' as const) : undefined,
  };

  const statusCls = `backlog-status-pill--${stageInfo?.statusType ?? 'backlog'}`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="backlog-ticket-row"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick();
      }}
      {...attributes}
      {...listeners}
    >
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
      {stageInfo && <span className={`backlog-status-pill ${statusCls} flex-shrink-0`}>{stageInfo.name}</span>}
      {ticket.effortPoints != null && ticket.effortPoints > 0 && (
        <span className="backlog-effort flex-shrink-0">{ticket.effortPoints}</span>
      )}
      {ticket.priority && (
        <span className="flex-shrink-0">
          <PriorityIndicator priority={ticket.priority as TicketPriority} />
        </span>
      )}
      {ticket.assigneeName ? (
        <span
          className="backlog-row-avatar flex-shrink-0"
          style={{ backgroundColor: avatarColor(ticket.assigneeName) }}
          title={ticket.assigneeName}
        >
          {initials(ticket.assigneeName)}
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
  children: React.ReactNode;
}

function DroppableGroupBody({ groupId, children }: DroppableGroupBodyProps) {
  const { setNodeRef, isOver } = useDroppable({ id: groupId });

  return (
    <div
      ref={setNodeRef}
      className="backlog-group-body"
      style={{ backgroundColor: isOver ? '#f0f4ff' : undefined, minHeight: 32 }}
    >
      {children}
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
                <div className="text-center py-3">
                  <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{t('board.emptyColumn')}</span>
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
                <div className="text-center py-3">
                  <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{t('board.emptyColumn')}</span>
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
  const { numaPut } = useNumaRequest();
  const { teamData, workUnits, tickets, config, refreshTickets, setTickets } = useOps();

  // ── Filters ────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

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
    [zones],
  );

  const firstBacklogZoneId = useMemo(() => zones.find((z) => z.zoneType === 'backlog')?.id ?? '', [zones]);

  // ── All tickets in backlog zones (exclude archived) ────────
  const backlogTickets = useMemo(
    () => tickets.filter((tk) => backlogZoneIds.has(tk.zoneId) && !tk.archived),
    [tickets, backlogZoneIds],
  );

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
    return result;
  }, [backlogTickets, searchQuery, assigneeFilter, typeFilter, priorityFilter]);

  // ── Assignees in backlog (for avatar filters) ──────────────────
  const backlogAssignees = useMemo(() => {
    const seen = new Map<string, string>();
    for (const tk of backlogTickets) {
      if (tk.assigneeId && tk.assigneeName && !seen.has(tk.assigneeId)) {
        seen.set(tk.assigneeId, tk.assigneeName);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [backlogTickets]);

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

  // ── Planning work units ────────────────────────────────────────
  const planningUnits = useMemo(
    () => workUnits.filter((wu) => wu.status === 'planning').sort((a, b) => a.order - b.order),
    [workUnits],
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
      result.push({
        id: wu.id,
        label: wu.name,
        sublabel: t('sprints.planning'),
        tickets: wuTickets,
        workUnit: wu,
        zoneId: (teamData?.team?.workUnitSeries?.backlogZoneId as string | undefined) ?? firstBacklogZoneId,
      });
    }

    return result;
  }, [filteredTickets, backlogStages, planningUnits, t, firstBacklogZoneId, teamData]);

  // ── Group lookup map (for DnD) ─────────────────────────────────
  const groupMap = useMemo(() => {
    const map = new Map<string, TicketGroup>();
    for (const g of groups) map.set(g.id, g);
    return map;
  }, [groups]);

  // ── Visible groups (group filter) ──────────────────────────────
  const visibleGroups = useMemo(() => {
    if (groupFilter === null) return groups;
    return groups.filter((g) => g.id === groupFilter);
  }, [groups, groupFilter]);

  // ── Toggle collapse ────────────────────────────────────────────
  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  // ── Handlers ───────────────────────────────────────────────────
  const handleTicketClick = useCallback((ticketId: string) => {
    setDetailTicketId(ticketId);
    setShowDetail(true);
  }, []);

  const handleAddTicket = useCallback((zoneId: string) => {
    setCreateZoneId(zoneId);
    setShowCreate(true);
  }, []);

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
    [filteredTickets],
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

      if (overId.startsWith('bk-stage-')) {
        // Kanban mode: dropped on a stage column
        const stageId = overId.replace('bk-stage-', '');
        const stageInfo = stageMap.get(stageId);
        if (!stageInfo) return;
        newStageId = stageId;
        newZoneId = stageInfo.zoneId;
      } else {
        // List mode or kanban-group mode: dropped on a group
        const targetGroup = groupMap.get(overId);
        if (!targetGroup) return;

        newZoneId = targetGroup.zoneId;
        if (targetGroup.stageId) newStageId = targetGroup.stageId;
        newWorkUnitId = targetGroup.workUnit?.id ?? null;
      }

      // No-op if nothing changed
      if (newStageId === ticket.stageId && newWorkUnitId === ticket.workUnitId) return;

      // Calculate order at end of destination
      const destTickets = filteredTickets
        .filter((tk) => {
          if (tk.id === ticketId) return false;
          if (overId.startsWith('bk-stage-')) return tk.stageId === newStageId;
          const g = groupMap.get(overId);
          return g ? g.tickets.some((gt) => gt.id === tk.id) : false;
        })
        .sort((a, b) => a.order - b.order);

      const newOrder = calculateNewOrder(destTickets, destTickets.length);

      // Optimistic update
      setTickets((prev) =>
        prev.map((tk) =>
          tk.id === ticketId
            ? { ...tk, stageId: newStageId, zoneId: newZoneId, workUnitId: newWorkUnitId, order: newOrder }
            : tk,
        ),
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
    [filteredTickets, groupMap, stageMap, numaPut, refreshTickets, setTickets],
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
              style={{ backgroundColor: avatarColor(a.name) }}
              title={a.name}
              onClick={() => toggleAssignee(a.id)}
            >
              {initials(a.name)}
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
                    </div>

                    {wu?.goal && !isCollapsed && (
                      <div className="backlog-group-subheader">
                        <span className="backlog-group-goal">{wu.goal}</span>
                        {groupAssignees.size > 0 && (
                          <div className="backlog-group-avatars">
                            {Array.from(groupAssignees.entries())
                              .slice(0, 5)
                              .map(([id, name]) => (
                                <span
                                  key={id}
                                  className="ticket-avatar"
                                  style={{ backgroundColor: avatarColor(name) }}
                                  title={name}
                                >
                                  {initials(name)}
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
                      <DroppableGroupBody groupId={group.id}>
                        {group.tickets.length === 0 ? (
                          <div className="text-muted small py-3 px-4">{t('backlogView.noTickets')}</div>
                        ) : (
                          group.tickets
                            .sort((a, b) => a.order - b.order)
                            .map((ticket) => (
                              <DraggableRow
                                key={ticket.id}
                                ticket={ticket}
                                typeInfo={typeMap.get(ticket.ticketTypeId)}
                                stageInfo={stageMap.get(ticket.stageId)}
                                onClick={() => handleTicketClick(ticket.id)}
                              />
                            ))
                        )}
                      </DroppableGroupBody>
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
    </>
  );
};

export default BacklogView;
