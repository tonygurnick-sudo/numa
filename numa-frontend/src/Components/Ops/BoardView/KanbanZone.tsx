import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkZone, WorkStage, Ticket, TicketType } from '../../../types/ops';
import KanbanColumn from './KanbanColumn';

type KanbanZoneProps = {
  zone: WorkZone;
  stages: WorkStage[];
  tickets: Ticket[];
  ticketTypes: TicketType[];
  onTicketClick: (ticket: Ticket) => void;
  onTicketContextMenu: (e: React.MouseEvent, ticket: Ticket) => void;
  onTicketAssign?: (ticketId: string, assigneeId: string | null, version: number) => void;
  onQuickAdd: (stageId: string, title: string, ticketTypeId?: string) => void;
  dropIndicator?: { stageId: string; index: number } | null;
  activeTicketId?: string | null;
};

const KanbanZone: React.FC<KanbanZoneProps> = ({
  zone,
  stages,
  tickets,
  ticketTypes,
  onTicketClick,
  onTicketContextMenu,
  onTicketAssign,
  onQuickAdd,
  dropIndicator,
  activeTicketId,
}) => {
  const { t } = useTranslation('ops');
  const [collapsed, setCollapsed] = useState(zone.zoneType === 'backlog');

  const sortedStages = useMemo(() => [...stages].sort((a, b) => a.order - b.order), [stages]);

  const isCollapsible = zone.zoneType === 'backlog';

  const renderColumns = () => (
    <div className="kanban-columns flex-grow-1">
      {sortedStages.map((stage) => {
        const stageTickets = tickets.filter((tk) => tk.stageId === stage.id).sort((a, b) => a.order - b.order);

        return (
          <KanbanColumn
            key={stage.id}
            stage={stage}
            tickets={stageTickets}
            ticketTypes={ticketTypes}
            onTicketClick={onTicketClick}
            onTicketContextMenu={onTicketContextMenu}
            onTicketAssign={onTicketAssign}
            onQuickAdd={(title, ticketTypeId) => onQuickAdd(stage.id, title, ticketTypeId)}
            dropIndicator={dropIndicator?.stageId === stage.id ? dropIndicator.index : null}
            activeTicketId={activeTicketId}
          />
        );
      })}
    </div>
  );

  // ── Backlog / Completed zone: collapsible section ──
  if (isCollapsible) {
    return (
      <div className="kanban-zone-collapsible">
        <button type="button" className="kanban-zone-toggle" onClick={() => setCollapsed((prev) => !prev)}>
          <span className="d-flex align-items-center gap-2">
            <i className={`bi bi-chevron-${collapsed ? 'right' : 'down'}`} style={{ fontSize: 12 }} />
            <span className="fw-semibold" style={{ fontSize: 13 }}>
              {zone.name || t('board.backlog')}
            </span>
          </span>
          <span style={{ fontSize: 12, color: '#868e96' }}>{tickets.length}</span>
        </button>
        {!collapsed && <div className="px-3 pb-3">{renderColumns()}</div>}
      </div>
    );
  }

  // ── WIP zone: full-width columns ──
  return renderColumns();
};

export default KanbanZone;
