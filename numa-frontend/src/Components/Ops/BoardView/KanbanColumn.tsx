import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { WorkStage, Ticket, TicketType } from '../../../types/ops';
import { TicketCard } from './TicketCard';
import { getStatusTypeColor } from '../Shared/colorUtils';
import { getTicketTypeIconClass } from '../../../constants/opsConstants';

// ─── KanbanColumn ─────────────────────────────────────────────────────────

type QuickAddPosition = 'top' | 'bottom' | null;

type KanbanColumnProps = {
  stage: WorkStage;
  tickets: Ticket[];
  ticketTypes: TicketType[];
  onTicketClick: (ticket: Ticket) => void;
  onTicketContextMenu: (e: React.MouseEvent, ticket: Ticket) => void;
  onTicketAssign?: (ticketId: string, assigneeId: string | null, version: number) => void;
  onQuickAdd: (title: string, ticketTypeId?: string) => void;
};

const KanbanColumn: React.FC<KanbanColumnProps> = ({
  stage,
  tickets,
  ticketTypes,
  onTicketClick,
  onTicketContextMenu,
  onTicketAssign,
  onQuickAdd,
}) => {
  const { t } = useTranslation('ops');
  const [quickAddPos, setQuickAddPos] = useState<QuickAddPosition>(null);
  const [quickAddValue, setQuickAddValue] = useState('');
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const quickAddInputRef = useRef<HTMLInputElement>(null);
  const quickAddRowRef = useRef<HTMLDivElement>(null);
  const typeDropdownRef = useRef<HTMLDivElement>(null);

  const { setNodeRef, isOver } = useDroppable({
    id: `stage-${stage.id}`,
  });

  const ticketIds = useMemo(() => tickets.map((tk) => tk.id), [tickets]);

  const selectedType = useMemo(
    () => ticketTypes.find((tt) => tt.id === selectedTypeId) ?? ticketTypes[0] ?? null,
    [ticketTypes, selectedTypeId],
  );

  useEffect(() => {
    if (quickAddPos && quickAddInputRef.current) {
      quickAddInputRef.current.focus();
    }
  }, [quickAddPos]);

  // Close type dropdown on click outside
  useEffect(() => {
    if (!showTypeDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target as Node)) {
        setShowTypeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTypeDropdown]);

  const handleQuickAddSubmit = () => {
    const trimmed = quickAddValue.trim();
    if (trimmed) {
      onQuickAdd(trimmed, selectedType?.id);
    }
    setQuickAddValue('');
    setQuickAddPos(null);
    setShowTypeDropdown(false);
  };

  const handleQuickAddKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleQuickAddSubmit();
    } else if (e.key === 'Escape') {
      setQuickAddValue('');
      setQuickAddPos(null);
      setShowTypeDropdown(false);
    }
  };

  const handleQuickAddBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // Don't close if focus moved within the quick-add row (e.g. type dropdown)
    if (quickAddRowRef.current?.contains(e.relatedTarget as Node)) return;
    handleQuickAddSubmit();
  };

  const dragOverStyle = isOver ? { borderTop: `3px solid ${getStatusTypeColor(stage.statusType)}` } : undefined;

  // ── Shared quick-add row (rendered at top or bottom depending on trigger) ──
  const quickAddRow = (
    <div className="kanban-quick-add-row" ref={quickAddRowRef}>
      {ticketTypes.length > 0 && selectedType && (
        <div className="kanban-quick-add-type" ref={typeDropdownRef}>
          <button
            type="button"
            className="kanban-quick-add-type-btn"
            onClick={() => setShowTypeDropdown((prev) => !prev)}
            title={selectedType.name}
          >
            <i className={getTicketTypeIconClass(selectedType.icon)} style={{ color: selectedType.color }} />
            <i className="bi bi-chevron-down kanban-quick-add-type-caret" />
          </button>
          {showTypeDropdown && (
            <div className="kanban-quick-add-type-dropdown">
              {ticketTypes.map((tt) => (
                <button
                  key={tt.id}
                  type="button"
                  className={`kanban-quick-add-type-option${tt.id === selectedType.id ? ' active' : ''}`}
                  onClick={() => {
                    setSelectedTypeId(tt.id);
                    setShowTypeDropdown(false);
                    quickAddInputRef.current?.focus();
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
        ref={quickAddInputRef}
        type="text"
        className="kanban-quick-add-input"
        placeholder={t('board.quickAddPlaceholder')}
        value={quickAddValue}
        onChange={(e) => setQuickAddValue(e.target.value)}
        onKeyDown={handleQuickAddKeyDown}
        onBlur={handleQuickAddBlur}
      />
    </div>
  );

  return (
    <div ref={setNodeRef} className={`kanban-column${isOver ? ' kanban-column--drag-over' : ''}`} style={dragOverStyle}>
      {/* Header: Name + Count | + button */}
      <div className="kanban-column-header">
        <div className="kanban-column-header-left">
          <span className="kanban-column-name">{stage.name}</span>
          <span className="kanban-column-count">{tickets.length}</span>
        </div>
        <button
          type="button"
          className="kanban-column-add-btn"
          onClick={() => setQuickAddPos('top')}
          title={t('board.create')}
        >
          <i className="bi bi-plus" />
          <span>{t('board.quickAdd')}</span>
        </button>
      </div>

      {/* Quick-add at top (triggered from header +) */}
      {quickAddPos === 'top' && <div className="kanban-quick-add-top">{quickAddRow}</div>}

      {/* Body: sortable ticket list */}
      <div className="kanban-column-body">
        <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
          {tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              onClick={onTicketClick}
              onContextMenu={onTicketContextMenu}
              onAssign={onTicketAssign}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
};

export default KanbanColumn;
