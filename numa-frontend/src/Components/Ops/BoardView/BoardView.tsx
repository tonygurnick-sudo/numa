import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  pointerWithin,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  type CollisionDetection,
  useSensor,
  useSensors,
  PointerSensor,
} from '@dnd-kit/core';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useAuth } from '../../../Providers/AuthProvider';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import type { Ticket, WorkStage, StaffProfile } from '../../../types/ops';
import KanbanZone from './KanbanZone';
import SprintBoardBar from './SprintBoardBar';
import BoardToolbar from './BoardToolbar';
import { TicketDetailModal } from '../Modals/TicketDetailModal';
import { CreateTicketModal } from '../Modals/CreateTicketModal';
import ContextMenu from '../ContextMenu';
import './kanban.css';

// ─── Helpers ────────────────────────────────────────────────────────────────

const ORDER_GAP = 1000;

/**
 * Custom collision detection that prioritises the column (stage droppable) the
 * pointer is physically inside, then finds the closest sortable item within
 * that column.  Plain `closestCenter` measures center-to-center distance across
 * ALL droppables, so a ticket in the *original* column at a similar vertical
 * position can beat every target in the adjacent column — making it impossible
 * to drag one column to the right.
 */
const kanbanCollisionDetection: CollisionDetection = (args) => {
  // 1. Find column droppables the pointer is inside (ids start with "stage-")
  const pointerCollisions = pointerWithin(args);
  const overColumn = pointerCollisions.find((c) => String(c.id).startsWith('stage-'));

  if (overColumn) {
    // 2. Narrow candidates to items belonging to that column + the column itself.
    // Use the column droppable's rect to geometrically filter ticket droppables
    // that are physically inside the column.
    const columnId = overColumn.id as string;
    const columnContainer = args.droppableContainers.find((c) => c.id === columnId);
    const columnRect = columnContainer?.rect.current;

    const filtered = args.droppableContainers.filter((container) => {
      const id = String(container.id);
      // Always keep the target column droppable itself
      if (id === columnId) return true;
      // Exclude other column droppables
      if (id.startsWith('stage-')) return false;
      // Keep ticket droppables whose horizontal center falls within the column
      if (!columnRect) return false;
      const rect = container.rect.current;
      if (!rect) return false;
      const itemCenterX = rect.left + rect.width / 2;
      return itemCenterX >= columnRect.left && itemCenterX <= columnRect.left + columnRect.width;
    });

    const result = closestCenter({ ...args, droppableContainers: filtered });
    return result.length > 0 ? result : [overColumn];
  }

  // 3. Pointer isn't inside any column — fall back to closestCenter globally
  return closestCenter(args);
};

/**
 * Calculates the order value for a ticket being inserted at `insertIndex`
 * within an already-sorted list of tickets. Uses gap-based ordering: tickets
 * are spaced by ORDER_GAP (1000). When inserting between two existing
 * tickets, the midpoint is used. When inserting at the start or end, the
 * order shifts by ORDER_GAP from the nearest ticket.
 */
function calculateNewOrder(tickets: Ticket[], insertIndex: number): number {
  if (tickets.length === 0) {
    return ORDER_GAP;
  }

  // Insert at the beginning
  if (insertIndex <= 0) {
    return tickets[0].order - ORDER_GAP;
  }

  // Insert at the end
  if (insertIndex >= tickets.length) {
    return tickets[tickets.length - 1].order + ORDER_GAP;
  }

  // Insert between two tickets — use midpoint
  const before = tickets[insertIndex - 1].order;
  const after = tickets[insertIndex].order;
  return Math.round((before + after) / 2);
}

// ─── BoardView Component ────────────────────────────────────────────────────

const BoardView = () => {
  const { t } = useTranslation('ops');
  const { numaPost, numaPut, numaDelete } = useNumaRequest();
  const { user } = useAuth();
  const {
    boardData,
    tickets,
    setTickets,
    ticketsLoading,
    workUnits,
    selectedWorkUnitId,
    activeZoneId,
    refreshTickets,
    config,
    myWorkFilter,
  } = useOps();

  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // ── Drop indicator state: tracks where the dragged card would be inserted ──
  const [dropIndicator, setDropIndicator] = useState<{
    stageId: string;
    index: number;
  } | null>(null);

  // ── TicketDetailModal state ──────────────────────────────────────
  const [detailTicketId, setDetailTicketId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // ── ContextMenu state ────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{
    show: boolean;
    position: { x: number; y: number };
    ticket: Ticket | null;
  }>({ show: false, position: { x: 0, y: 0 }, ticket: null });

  // ── CreateTicketModal state ────────────────────────────────────
  const [createModal, setCreateModal] = useState<{ show: boolean; zoneId?: string }>({ show: false });

  const team = boardData?.board ?? null;
  const zones = boardData?.zones ?? [];
  const stages = boardData?.stages ?? [];
  const hasWorkUnitSeries = Boolean(team?.workUnitSeries?.enabled);

  // ── Board members for toolbar avatar filter ──
  const boardMembers = useMemo(() => {
    if (!config?.staff || !team) return [];
    const isAll = team.accessControl?.mode !== 'specific';
    const memberIdSet = new Set(
      isAll ? config.staff.filter((s) => s.isActive).map((s) => s.id) : (team.accessControl?.users ?? [])
    );
    if (team.createdBy) memberIdSet.add(team.createdBy);
    return [...memberIdSet].map((id) => config.staff.find((s) => s.id === id)).filter(Boolean) as StaffProfile[];
  }, [config?.staff, team]);

  const toggleAssignee = useCallback((id: string) => {
    setAssigneeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Reset filters on zone/team change
  useEffect(() => {
    setAssigneeFilter(new Set());
    setSearchQuery('');
  }, [activeZoneId, team?.id]);

  // ── Active zone: the board-type zone selected via OpsHeader zone tabs ──

  const activeZone = useMemo(
    () => zones.find((z) => z.id === activeZoneId && z.zoneType === 'board') ?? null,
    [zones, activeZoneId]
  );

  /** Filter tickets: only active zone, exclude archived, apply opt-in sprint filter, apply my-work filter */
  const filteredTickets = useMemo(() => {
    let result = tickets.filter((tk) => !tk.archived);
    // Scope to active zone
    if (activeZone) {
      result = result.filter((tk) => tk.zoneId === activeZone.id);
    }
    // Sprint filter: only when user explicitly selects a sprint pill
    if (selectedWorkUnitId !== null) {
      result = result.filter((tk) => tk.workUnitId === selectedWorkUnitId);
    }
    // My Work filter: only show tickets assigned to the current user
    const userSub = user?.decoded_tokens?.idToken?.sub;
    if (myWorkFilter && userSub) {
      result = result.filter((tk) => tk.assigneeId && tk.assigneeId === userSub);
    }
    // Assignee filter (toolbar avatars)
    if (assigneeFilter.size > 0) {
      result = result.filter((tk) => tk.assigneeId && assigneeFilter.has(tk.assigneeId));
    }
    // Search filter (toolbar search input)
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((tk) => tk.title.toLowerCase().includes(q) || tk.displayId?.toLowerCase().includes(q));
    }
    return result;
  }, [
    tickets,
    activeZone,
    selectedWorkUnitId,
    myWorkFilter,
    user?.decoded_tokens?.idToken?.sub,
    assigneeFilter,
    searchQuery,
  ]);

  // ── Zone progress for toolbar ──────────────────
  const progressPercent = useMemo(() => {
    const total = filteredTickets.length;
    if (total === 0) return 0;
    const done = filteredTickets.filter((tk) => tk.statusType === 'completed' || tk.statusType === 'ended').length;
    return Math.round((done / total) * 100);
  }, [filteredTickets]);

  // ── Sprint progress label for the zone progress bar ──────────────────
  const sprintLabel = useMemo(() => {
    if (!hasWorkUnitSeries || !selectedWorkUnitId) return null;
    const wu = workUnits.find((w) => w.id === selectedWorkUnitId);
    if (!wu) return null;
    const done = filteredTickets.filter((tk) => tk.statusType === 'completed' || tk.statusType === 'ended').length;
    const total = filteredTickets.length;
    if (total === 0) return null;
    const pct = Math.round((done / total) * 100);
    return `${wu.name}: ${t('sprints.sprintProgress', { done, total })} (${pct}%)`;
  }, [hasWorkUnitSeries, selectedWorkUnitId, workUnits, filteredTickets, t]);

  // ── Announcement dismiss state (per-session via sessionStorage) ──
  const announcementDismissKey = team ? `ops-announcement-dismissed-${team.id}` : '';
  const [announcementDismissed, setAnnouncementDismissed] = useState(() => {
    if (!announcementDismissKey) return false;
    return sessionStorage.getItem(announcementDismissKey) === '1';
  });

  /** Map: stageId -> zoneId (for resolving zone when dropping into a stage) */
  const stageZoneMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const stage of stages) {
      map.set(stage.id, stage.zoneId);
    }
    return map;
  }, [stages]);

  /** Map: zoneId -> stages[] */
  const zoneStagesMap = useMemo(() => {
    const map = new Map<string, WorkStage[]>();
    for (const zone of zones) {
      map.set(
        zone.id,
        stages.filter((s) => s.zoneId === zone.id)
      );
    }
    return map;
  }, [zones, stages]);

  // ── DnD sensors: PointerSensor with distance:8 so short taps register as
  //    clicks and only deliberate movement begins a drag ──────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  // ── DnD Handlers ───────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const ticketId = event.active.id as string;
      const ticket = filteredTickets.find((tk) => tk.id === ticketId) ?? null;
      setActiveTicket(ticket);
    },
    [filteredTickets]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) {
        setDropIndicator(null);
        return;
      }

      const overId = over.id as string;
      const activeId = active.id as string;

      // Determine which stage is being hovered over
      if (overId.startsWith('stage-')) {
        // Hovering over empty column droppable — show indicator at end
        const stageId = overId.replace('stage-', '');
        const stageTickets = filteredTickets
          .filter((tk) => tk.stageId === stageId && tk.id !== activeId)
          .sort((a, b) => a.order - b.order);
        setDropIndicator({ stageId, index: stageTickets.length });
      } else {
        // Hovering over a ticket — find which stage it belongs to and the insertion index
        const overTicket = filteredTickets.find((tk) => tk.id === overId);
        if (!overTicket) {
          setDropIndicator(null);
          return;
        }
        const stageId = overTicket.stageId;
        const dragTicket = filteredTickets.find((tk) => tk.id === activeId);
        const isSameColumn = dragTicket?.stageId === stageId;

        // Visible tickets = stage tickets excluding the dragged one
        const visibleTickets = filteredTickets
          .filter((tk) => tk.stageId === stageId && tk.id !== activeId)
          .sort((a, b) => a.order - b.order);
        const overIndex = visibleTickets.findIndex((tk) => tk.id === overId);

        if (isSameColumn) {
          // For same-column drags, find original position of the dragged ticket
          // relative to all stage tickets to determine if dragging down or up
          const allStageTickets = filteredTickets
            .filter((tk) => tk.stageId === stageId)
            .sort((a, b) => a.order - b.order);
          const origDragIdx = allStageTickets.findIndex((tk) => tk.id === activeId);
          const origOverIdx = allStageTickets.findIndex((tk) => tk.id === overId);
          // Dragging downward: place after the hovered card
          const insertIndex = origDragIdx < origOverIdx ? overIndex + 1 : overIndex;
          setDropIndicator({ stageId, index: insertIndex });
        } else {
          // Cross-column: insert before the hovered card
          setDropIndicator({ stageId, index: overIndex >= 0 ? overIndex : visibleTickets.length });
        }
      }
    },
    [filteredTickets]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveTicket(null);
      setDropIndicator(null);

      const { active, over } = event;
      if (!over) return;

      const ticketId = active.id as string;
      const overId = over.id as string;

      const ticket = filteredTickets.find((tk) => tk.id === ticketId);
      if (!ticket) return;

      let newStageId: string;
      let insertIndex: number;

      if (overId.startsWith('stage-')) {
        // Dropped on a column droppable
        newStageId = overId.replace('stage-', '');
        const destStageTickets = filteredTickets
          .filter((tk) => tk.stageId === newStageId && tk.id !== ticketId)
          .sort((a, b) => a.order - b.order);
        insertIndex = destStageTickets.length; // append to end
      } else {
        // Dropped on another ticket — find which column and position
        const overTicket = filteredTickets.find((tk) => tk.id === overId);
        if (!overTicket) return;
        newStageId = overTicket.stageId;
        const isSameColumn = ticket.stageId === newStageId;

        // Visible tickets in destination (excluding dragged ticket)
        const visibleDestTickets = filteredTickets
          .filter((tk) => tk.stageId === newStageId && tk.id !== ticketId)
          .sort((a, b) => a.order - b.order);
        const overIndex = visibleDestTickets.findIndex((tk) => tk.id === overId);

        if (isSameColumn) {
          // Use full stage list to determine drag direction
          const allStageTickets = filteredTickets
            .filter((tk) => tk.stageId === newStageId)
            .sort((a, b) => a.order - b.order);
          const origDragIdx = allStageTickets.findIndex((tk) => tk.id === ticketId);
          const origOverIdx = allStageTickets.findIndex((tk) => tk.id === overId);
          insertIndex = origDragIdx < origOverIdx ? overIndex + 1 : overIndex;
        } else {
          insertIndex = overIndex >= 0 ? overIndex : visibleDestTickets.length;
        }
      }

      const newZoneId = stageZoneMap.get(newStageId);
      if (!newZoneId) return;

      // Get destination tickets excluding the dragged ticket
      const destStageTickets = filteredTickets
        .filter((tk) => tk.stageId === newStageId && tk.id !== ticketId)
        .sort((a, b) => a.order - b.order);

      // No-op if same column, same position
      if (ticket.stageId === newStageId) {
        const currentTickets = filteredTickets
          .filter((tk) => tk.stageId === newStageId)
          .sort((a, b) => a.order - b.order);
        const currentIdx = currentTickets.findIndex((tk) => tk.id === ticketId);
        if (currentIdx === insertIndex || currentIdx === insertIndex - 1) return;
      }

      const newOrder = calculateNewOrder(destStageTickets, insertIndex);

      // Resolve the destination stage's statusType for optimistic sprint stats
      const destStage = stages.find((s) => s.id === newStageId);
      const newStatusType = destStage?.statusType ?? ticket.statusType;

      // Optimistic update: move ticket in local state immediately (including statusType
      // so sprint progress bars update without waiting for the server round-trip)
      setTickets((prev) =>
        prev.map((tk) =>
          tk.id === ticketId
            ? { ...tk, stageId: newStageId, zoneId: newZoneId, order: newOrder, statusType: newStatusType }
            : tk
        )
      );

      try {
        const updated = await OpsService.updateTicket(numaPut, ticketId, {
          boardId: ticket.boardId,
          stageId: newStageId,
          zoneId: newZoneId,
          order: newOrder,
          version: ticket.version,
        });
        // Merge server response (updated version + server-derived fields) into
        // local state instead of a full refresh to avoid DynamoDB eventual-consistency
        // causing a brief yoyo back to the old position.
        setTickets((prev) => prev.map((tk) => (tk.id === ticketId ? updated : tk)));
      } catch (err) {
        console.error('[BoardView] Failed to move ticket:', err);
        // Revert to server state on failure
        await refreshTickets();
      }
    },
    [filteredTickets, stageZoneMap, stages, numaPut, refreshTickets, setTickets]
  );

  // ── Ticket interaction callbacks ──────────────────────────────────

  const handleTicketClick = useCallback((ticket: Ticket) => {
    setDetailTicketId(ticket.id);
    setShowDetail(true);
  }, []);

  // Listen for linked-ticket navigation events dispatched by TicketDetailModal
  useEffect(() => {
    const handler = (e: Event) => {
      const ticketId = (e as CustomEvent<{ ticketId: string }>).detail.ticketId;
      setDetailTicketId(ticketId);
      setShowDetail(true);
    };
    window.addEventListener('ops:open-ticket', handler);
    return () => window.removeEventListener('ops:open-ticket', handler);
  }, []);

  const handleTicketContextMenu = useCallback((e: React.MouseEvent, ticket: Ticket) => {
    e.preventDefault();
    setCtxMenu({ show: true, position: { x: e.clientX, y: e.clientY }, ticket });
  }, []);

  const handleTicketAssign = useCallback(
    async (ticketId: string, assigneeId: string | null, version: number) => {
      const ticket = tickets.find((tk) => tk.id === ticketId);
      if (!ticket) return;
      try {
        await OpsService.updateTicket(numaPut, ticketId, {
          boardId: ticket.boardId,
          assigneeId,
          version,
        });
        await refreshTickets();
      } catch (err) {
        console.error('[BoardView] Failed to assign ticket:', err);
      }
    },
    [tickets, numaPut, refreshTickets]
  );

  const handleContextMenuAction = useCallback(
    async (action: string, payload?: unknown) => {
      const ticket = ctxMenu.ticket;
      if (!ticket) return;
      setCtxMenu((prev) => ({ ...prev, show: false }));

      try {
        switch (action) {
          case 'assignToMe':
            if (user?.decoded_tokens?.idToken?.sub) {
              await OpsService.updateTicket(numaPut, ticket.id, {
                boardId: ticket.boardId,
                assigneeId: user.decoded_tokens.idToken.sub,
                version: ticket.version,
              });
              await refreshTickets();
            }
            break;
          case 'assignTo':
            await OpsService.updateTicket(numaPut, ticket.id, {
              boardId: ticket.boardId,
              assigneeId: payload as string,
              version: ticket.version,
            });
            await refreshTickets();
            break;
          case 'changeStage': {
            const newStageId = payload as string;
            const targetStage = stages.find((s) => s.id === newStageId);
            await OpsService.updateTicket(numaPut, ticket.id, {
              boardId: ticket.boardId,
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
          case 'moveTop':
          case 'moveUp':
          case 'moveDown':
          case 'moveBottom': {
            const columnTickets = filteredTickets
              .filter((tk) => tk.stageId === ticket.stageId)
              .sort((a, b) => a.order - b.order);
            const currentIdx = columnTickets.findIndex((tk) => tk.id === ticket.id);
            if (currentIdx < 0) break;
            let targetIdx = currentIdx;
            if (action === 'moveTop') targetIdx = 0;
            else if (action === 'moveUp') targetIdx = Math.max(0, currentIdx - 1);
            else if (action === 'moveDown') targetIdx = Math.min(columnTickets.length - 1, currentIdx + 1);
            else if (action === 'moveBottom') targetIdx = columnTickets.length;
            if (targetIdx === currentIdx) break;
            const withoutCurrent = columnTickets.filter((tk) => tk.id !== ticket.id);
            const newOrder = calculateNewOrder(withoutCurrent, targetIdx);
            await OpsService.updateTicket(numaPut, ticket.id, {
              boardId: ticket.boardId,
              order: newOrder,
              version: ticket.version,
            });
            await refreshTickets();
            break;
          }
          case 'archive':
            await OpsService.archiveTicket(numaPut, ticket.id, ticket.version, ticket.boardId);
            await refreshTickets();
            break;
          case 'delete':
            await OpsService.deleteTicket(numaDelete, ticket.id, ticket.boardId);
            await refreshTickets();
            break;
        }
      } catch (err) {
        console.error('[BoardView] Context menu action failed:', err);
      }
    },
    [ctxMenu.ticket, numaPut, numaDelete, refreshTickets, user, filteredTickets]
  );

  const handleQuickAdd = useCallback(
    async (stageId: string, title: string, ticketTypeId?: string) => {
      if (!team || !config?.ticketTypes?.[0]) return;
      const stage = stages.find((s) => s.id === stageId);
      if (!stage) return;

      const destTickets = filteredTickets.filter((tk) => tk.stageId === stageId).sort((a, b) => a.order - b.order);
      const _order = calculateNewOrder(destTickets, destTickets.length);

      const resolvedTypeId = ticketTypeId ?? config.ticketTypes[0].id;

      const activeWorkUnit = workUnits.find((wu) => wu.status === 'active') ?? null;
      const targetWorkUnitId = selectedWorkUnitId ?? activeWorkUnit?.id ?? undefined;

      try {
        await OpsService.createTicket(numaPost, {
          boardId: team.id,
          ticketTypeId: resolvedTypeId,
          title,
          stageId,
          zoneId: stage.zoneId,
          priority: 'medium',
          workUnitId: targetWorkUnitId,
        });
        await refreshTickets();
      } catch (err) {
        console.error('[BoardView] Quick add failed:', err);
      }
    },
    [team, config?.ticketTypes, stages, filteredTickets, numaPost, refreshTickets, selectedWorkUnitId, workUnits]
  );

  // ── Shared overlays (rendered regardless of board state) ─────────

  const overlays = (
    <>
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
      <CreateTicketModal
        show={createModal.show}
        onHide={() => setCreateModal({ show: false })}
        onSuccess={(_ticket) => {
          setCreateModal({ show: false });
          refreshTickets();
        }}
        prefilledZoneId={createModal.zoneId}
      />
      <ContextMenu
        show={ctxMenu.show}
        position={ctxMenu.position}
        ticket={ctxMenu.ticket}
        context="board"
        stages={stages}
        zones={zones}
        staff={config?.staff ?? []}
        onClose={() => setCtxMenu((prev) => ({ ...prev, show: false }))}
        onAction={handleContextMenuAction}
      />
    </>
  );

  // ── Loading / empty states ────────────────────────────────────────

  if (!team || zones.length === 0) {
    return (
      <>
        <div className="d-flex align-items-center justify-content-center text-muted py-5">
          {ticketsLoading ? t('common.loading') : t('board.noZones')}
        </div>
        {overlays}
      </>
    );
  }

  if (!activeZone) {
    return (
      <>
        <div className="d-flex align-items-center justify-content-center text-muted py-5">{t('board.noZones')}</div>
        {overlays}
      </>
    );
  }

  // ── Empty state: sprint-enabled team, no sprints, no tickets ──────
  if (hasWorkUnitSeries && workUnits.length === 0 && filteredTickets.length === 0) {
    return (
      <>
        <div className="text-center text-muted py-5">
          <i className="bi bi-lightning-charge d-block mb-3" style={{ fontSize: '2.5rem' }} />
          <h5 className="fw-semibold">{t('sprints.noSprintsYet')}</h5>
          <p className="mb-3">{t('sprints.noSprintsYetHelp')}</p>
        </div>
        {overlays}
      </>
    );
  }

  // ── Render: active board zone as kanban columns ────────────────────

  const dragOverlay = (
    <DragOverlay>
      {activeTicket ? (
        <div
          className="ticket-card"
          style={{ width: 272, opacity: 0.96, boxShadow: '0 12px 28px rgba(0,0,0,0.18)', rotate: '2deg' }}
        >
          <p className="ticket-title mb-1">{activeTicket.title}</p>
          <span className="ticket-id">{activeTicket.displayId}</span>
        </div>
      ) : null}
    </DragOverlay>
  );

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={kanbanCollisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="p-3 d-flex flex-column" style={{ minHeight: '100%' }}>
          {/* Note: the legacy "Assign to sprint" banner was removed when sprints
              became zone-bound -- workUnitId is now auto-derived from the active
              zone, so tickets in a sprint zone never lack a workUnitId. */}
          <BoardToolbar
            members={boardMembers}
            assigneeFilter={assigneeFilter}
            onToggleAssignee={toggleAssignee}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            progressPercent={progressPercent}
            progressLabel={sprintLabel}
          >
            {hasWorkUnitSeries && <SprintBoardBar inline />}
          </BoardToolbar>
          {/* Board announcement banner */}
          {team.announcement && !announcementDismissed && (
            <div className="ops-announcement">
              <i className="bi bi-megaphone-fill ops-announcement-icon" />
              <span className="ops-announcement-text">{team.announcement}</span>
              <button
                type="button"
                className="ops-announcement-dismiss"
                onClick={() => {
                  setAnnouncementDismissed(true);
                  if (announcementDismissKey) sessionStorage.setItem(announcementDismissKey, '1');
                }}
                aria-label={t('sprints.dismiss')}
              >
                <i className="bi bi-x-lg" />
              </button>
            </div>
          )}
          <KanbanZone
            zone={activeZone}
            stages={zoneStagesMap.get(activeZone.id) ?? []}
            tickets={filteredTickets}
            ticketTypes={config?.ticketTypes ?? []}
            onTicketClick={handleTicketClick}
            onTicketContextMenu={handleTicketContextMenu}
            onTicketAssign={handleTicketAssign}
            onQuickAdd={handleQuickAdd}
            dropIndicator={dropIndicator}
            activeTicketId={activeTicket?.id ?? null}
          />
        </div>
        {dragOverlay}
      </DndContext>
      {overlays}
    </>
  );
};

export default BoardView;
