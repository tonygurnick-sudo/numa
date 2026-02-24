import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
  PointerSensor,
} from '@dnd-kit/core';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useAuth } from '../../../Providers/AuthProvider';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import type { Ticket, WorkStage } from '../../../types/ops';
import KanbanZone from './KanbanZone';
import { TicketDetailModal } from '../Modals/TicketDetailModal';
import ContextMenu from '../ContextMenu';
import './kanban.css';

// ─── Helpers ────────────────────────────────────────────────────────────────

const ORDER_GAP = 1000;

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
  const { numaPost, numaPut } = useNumaRequest();
  const { user } = useAuth();
  const {
    teamData,
    tickets,
    setTickets,
    ticketsLoading,
    workUnits,
    selectedWorkUnitId,
    activeZoneId,
    refreshTickets,
    config,
  } = useOps();

  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);

  // ── TicketDetailModal state ──────────────────────────────────────
  const [detailTicketId, setDetailTicketId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // ── ContextMenu state ────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{
    show: boolean;
    position: { x: number; y: number };
    ticket: Ticket | null;
  }>({ show: false, position: { x: 0, y: 0 }, ticket: null });

  const team = teamData?.team ?? null;
  const zones = teamData?.zones ?? [];
  const stages = teamData?.stages ?? [];
  const hasWorkUnitSeries = Boolean(team?.workUnitSeries?.enabled);

  // ── Active zone: the board-type zone selected via OpsHeader zone tabs ──

  const activeZone = useMemo(
    () => zones.find((z) => z.id === activeZoneId && z.zoneType === 'board') ?? null,
    [zones, activeZoneId],
  );

  /** The active work unit (for auto-scoping in Board view when sprints are enabled) */
  const activeWorkUnit = useMemo(
    () => (hasWorkUnitSeries ? (workUnits.find((wu) => wu.status === 'active') ?? null) : null),
    [hasWorkUnitSeries, workUnits],
  );

  /** Filter tickets: only active zone, exclude archived, apply work unit scope */
  const filteredTickets = useMemo(() => {
    let result = tickets.filter((tk) => !tk.archived);
    // Scope to active zone
    if (activeZone) {
      result = result.filter((tk) => tk.zoneId === activeZone.id);
    }
    // When work units are enabled, auto-scope to the active sprint
    if (hasWorkUnitSeries && activeWorkUnit) {
      result = result.filter((tk) => tk.workUnitId === activeWorkUnit.id);
    } else if (selectedWorkUnitId !== null) {
      result = result.filter((tk) => tk.workUnitId === selectedWorkUnitId);
    }
    return result;
  }, [tickets, activeZone, hasWorkUnitSeries, activeWorkUnit, selectedWorkUnitId]);

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
        stages.filter((s) => s.zoneId === zone.id),
      );
    }
    return map;
  }, [zones, stages]);

  // ── DnD sensors: PointerSensor with distance:8 so short taps register as
  //    clicks and only deliberate movement begins a drag ──────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  // ── DnD Handlers ───────────────────────────────────────────────────

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

      // Droppable IDs are formatted as "stage-{stageId}"
      if (!overId.startsWith('stage-')) return;

      const newStageId = overId.replace('stage-', '');
      const newZoneId = stageZoneMap.get(newStageId);
      if (!newZoneId) return;

      const ticket = filteredTickets.find((tk) => tk.id === ticketId);
      if (!ticket) return;

      // No-op if already in the same stage
      if (ticket.stageId === newStageId) return;

      // Get the tickets currently in the destination stage (sorted by order)
      const destStageTickets = filteredTickets
        .filter((tk) => tk.stageId === newStageId)
        .sort((a, b) => a.order - b.order);

      // Insert at the end of the destination column
      const newOrder = calculateNewOrder(destStageTickets, destStageTickets.length);

      // Optimistic update: move ticket in local state immediately
      setTickets((prev) =>
        prev.map((tk) =>
          tk.id === ticketId ? { ...tk, stageId: newStageId, zoneId: newZoneId, order: newOrder } : tk,
        ),
      );

      try {
        await OpsService.updateTicket(numaPut, ticketId, {
          teamId: ticket.teamId,
          stageId: newStageId,
          zoneId: newZoneId,
          order: newOrder,
          version: ticket.version,
        });
        // Sync version numbers and server-derived fields (e.g. statusType)
        await refreshTickets();
      } catch (err) {
        console.error('[BoardView] Failed to move ticket:', err);
        // Revert to server state on failure
        await refreshTickets();
      }
    },
    [filteredTickets, stageZoneMap, numaPut, refreshTickets, setTickets],
  );

  // ── Ticket interaction callbacks ──────────────────────────────────

  const handleTicketClick = useCallback((ticket: Ticket) => {
    setDetailTicketId(ticket.id);
    setShowDetail(true);
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
          teamId: ticket.teamId,
          assigneeId,
          version,
        });
        await refreshTickets();
      } catch (err) {
        console.error('[BoardView] Failed to assign ticket:', err);
      }
    },
    [tickets, numaPut, refreshTickets],
  );

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
            const targetStage = stages.find((s) => s.id === newStageId);
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
              teamId: ticket.teamId,
              order: newOrder,
              version: ticket.version,
            });
            await refreshTickets();
            break;
          }
          case 'archive':
            await OpsService.archiveTicket(numaPut, ticket.id, ticket.version);
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
        console.error('[BoardView] Context menu action failed:', err);
      }
    },
    [ctxMenu.ticket, numaPut, refreshTickets, user, filteredTickets],
  );

  const handleQuickAdd = useCallback(
    async (stageId: string, title: string) => {
      if (!team || !config?.ticketTypes?.[0]) return;
      const stage = stages.find((s) => s.id === stageId);
      if (!stage) return;

      const destTickets = filteredTickets.filter((tk) => tk.stageId === stageId).sort((a, b) => a.order - b.order);
      const _order = calculateNewOrder(destTickets, destTickets.length);

      try {
        await OpsService.createTicket(numaPost, {
          teamId: team.id,
          ticketTypeId: config.ticketTypes[0].id,
          title,
          stageId,
          zoneId: stage.zoneId,
          priority: 'medium',
          workUnitId: selectedWorkUnitId ?? undefined,
        });
        await refreshTickets();
      } catch (err) {
        console.error('[BoardView] Quick add failed:', err);
      }
    },
    [team, config?.ticketTypes, stages, filteredTickets, numaPost, refreshTickets, selectedWorkUnitId],
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
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="p-3">
          <KanbanZone
            zone={activeZone}
            stages={zoneStagesMap.get(activeZone.id) ?? []}
            tickets={filteredTickets}
            onTicketClick={handleTicketClick}
            onTicketContextMenu={handleTicketContextMenu}
            onTicketAssign={handleTicketAssign}
            onQuickAdd={handleQuickAdd}
          />
        </div>
        {dragOverlay}
      </DndContext>
      {overlays}
    </>
  );
};

export default BoardView;
