import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { WorkStage, Ticket } from '../../../types/ops';
import { TicketCard } from './TicketCard';
import { getStatusTypeColor } from '../Shared/colorUtils';

// ─── KanbanColumn ─────────────────────────────────────────────────────────

type KanbanColumnProps = {
  stage: WorkStage;
  tickets: Ticket[];
  onTicketClick: (ticket: Ticket) => void;
  onTicketContextMenu: (e: React.MouseEvent, ticket: Ticket) => void;
  onQuickAdd: (title: string) => void;
};

const KanbanColumn: React.FC<KanbanColumnProps> = ({
  stage,
  tickets,
  onTicketClick,
  onTicketContextMenu,
  onQuickAdd,
}) => {
  const { t } = useTranslation('ops');
  const [quickAddActive, setQuickAddActive] = useState(false);
  const [quickAddValue, setQuickAddValue] = useState('');
  const quickAddInputRef = useRef<HTMLInputElement>(null);

  const { setNodeRef, isOver } = useDroppable({
    id: `stage-${stage.id}`,
  });

  const ticketIds = useMemo(() => tickets.map((tk) => tk.id), [tickets]);

  useEffect(() => {
    if (quickAddActive && quickAddInputRef.current) {
      quickAddInputRef.current.focus();
    }
  }, [quickAddActive]);

  const handleQuickAddSubmit = () => {
    const trimmed = quickAddValue.trim();
    if (trimmed) {
      onQuickAdd(trimmed);
    }
    setQuickAddValue('');
    setQuickAddActive(false);
  };

  const handleQuickAddKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleQuickAddSubmit();
    } else if (e.key === 'Escape') {
      setQuickAddValue('');
      setQuickAddActive(false);
    }
  };

  // Use stage's statusType to derive accent color for drop zone
  const statusColor = getStatusTypeColor(stage.statusType ?? 'backlog');

  return (
    <div
      ref={setNodeRef}
      className="kanban-column"
      style={{
        backgroundColor: isOver ? '#eef2ff' : undefined,
        boxShadow: isOver ? 'inset 0 0 0 2px #6366f1' : undefined,
        borderTop: isOver ? `3px solid ${statusColor}` : undefined,
      }}
    >
      {/* Header: Name + Count | + button */}
      <div className="kanban-column-header">
        <div className="kanban-column-header-left">
          <span className="kanban-column-name">{stage.name}</span>
          <span className="kanban-column-count">{tickets.length}</span>
        </div>
        <button
          type="button"
          className="kanban-column-add-btn"
          onClick={() => setQuickAddActive(true)}
          title={t('board.create')}
        >
          <i className="bi bi-plus" />
        </button>
      </div>

      {/* Body: sortable ticket list */}
      <div className="kanban-column-body">
        <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
          {tickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} onClick={onTicketClick} onContextMenu={onTicketContextMenu} />
          ))}
        </SortableContext>
      </div>

      {/* Quick-add input (shown when activated from header +) */}
      {quickAddActive && (
        <div className="kanban-column-footer">
          <input
            ref={quickAddInputRef}
            type="text"
            className="form-control form-control-sm"
            style={{ fontSize: 13 }}
            placeholder={t('board.quickAddPlaceholder')}
            value={quickAddValue}
            onChange={(e) => setQuickAddValue(e.target.value)}
            onKeyDown={handleQuickAddKeyDown}
            onBlur={handleQuickAddSubmit}
          />
        </div>
      )}
    </div>
  );
};

export default KanbanColumn;
