import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Ticket } from '../../../types/ops';
import { useOps } from '../OpsContext';
import { getTicketTypeIconClass } from '../../../constants/opsConstants';
import { PriorityIndicator } from '../Shared/PriorityIndicator';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Smart due-date formatter. Returns a label string and a CSS class name for
 * color coding, or null when there is no due date.
 */
function formatDueDate(dueDate: string | null | undefined): { text: string; className: string } | null {
  if (!dueDate) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(dueDate);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());

  const diffMs = dueDay.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { text: `${Math.abs(diffDays)}d overdue`, className: 'text-danger' };
  }
  if (diffDays === 0) {
    return { text: 'Today', className: 'text-success' };
  }
  if (diffDays === 1) {
    return { text: 'Tomorrow', className: 'text-warning' };
  }
  if (diffDays <= 7) {
    return { text: `${diffDays}d`, className: 'text-secondary' };
  }

  // Beyond 7 days — show a compact date
  const month = dueDay.toLocaleString('default', { month: 'short' });
  const day = dueDay.getDate();
  return { text: `${month} ${day}`, className: 'text-secondary' };
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface TicketCardProps {
  ticket: Ticket;
  onClick: (ticket: Ticket) => void;
  onContextMenu: (e: React.MouseEvent, ticket: Ticket) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TicketCard({ ticket, onClick, onContextMenu }: TicketCardProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { config, workUnits } = useOps();

  // ── Sortable hook ──────────────────────────────────────────────────────
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ticket.id });

  const style: React.CSSProperties = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition: transition ?? undefined,
      opacity: isDragging ? 0.5 : 1,
    }),
    [transform, transition, isDragging],
  );

  // ── Derived data ───────────────────────────────────────────────────────
  const ticketType = config?.ticketTypes.find((tt) => tt.id === ticket.ticketTypeId);
  const workUnit = ticket.workUnitId ? workUnits.find((wu) => wu.id === ticket.workUnitId) : null;

  const dueDateInfo = useMemo(() => formatDueDate(ticket.dueDate), [ticket.dueDate]);

  // ── Event handlers ─────────────────────────────────────────────────────
  const handleClick = useCallback(() => {
    if (!isDragging) {
      onClick(ticket);
    }
  }, [isDragging, onClick, ticket]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      onContextMenu(e, ticket);
    },
    [onContextMenu, ticket],
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        borderTop: `3px solid ${ticketType?.color ?? '#6c757d'}`,
      }}
      className="kanban-ticket-card"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      {...attributes}
      {...listeners}
    >
      {/* ── Header: ticket type icon + Display ID ──────────────────────── */}
      <div className="d-flex align-items-center gap-1 mb-1">
        {ticketType && (
          <i
            className={getTicketTypeIconClass(ticketType.icon)}
            style={{ fontSize: '0.85rem', color: ticketType.color ?? '#6c757d' }}
            title={ticketType.name}
          />
        )}
        <span className="text-muted" style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
          {ticket.displayId}
        </span>
      </div>

      {/* ── Title ─────────────────────────────────────────────────────── */}
      <div
        className="fw-semibold mb-2"
        style={{
          fontSize: '0.9rem',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          lineHeight: '1.35',
          color: '#1a1a1a',
        }}
        title={ticket.title}
      >
        {ticket.title}
      </div>

      {/* ── Badges row (customer + sprint) ──────────────────────────────── */}
      {(ticket.customerName || workUnit) && (
        <div className="d-flex flex-wrap gap-1 mb-2">
          {ticket.customerName && (
            <span
              className="badge bg-primary bg-opacity-10 text-primary"
              style={{ fontSize: '0.7rem', fontWeight: 500 }}
            >
              <i className="bi bi-building me-1" />
              {ticket.customerName}
            </span>
          )}
          {workUnit && (
            <span
              className="badge bg-success bg-opacity-10 text-success"
              style={{ fontSize: '0.7rem', fontWeight: 500 }}
            >
              <i className="bi bi-circle-fill me-1" style={{ fontSize: '0.35rem', verticalAlign: 'middle' }} />
              {workUnit.name}
            </span>
          )}
        </div>
      )}

      {/* ── Bottom row: Assignee | Due date + Priority ────────────────── */}
      <div className="d-flex justify-content-between align-items-center">
        {/* Assignee: icon + name */}
        <div className="d-flex align-items-center gap-1" style={{ minWidth: 0 }}>
          <i className="bi bi-person text-muted" style={{ fontSize: '0.8rem' }} />
          <span className="text-muted text-truncate" style={{ fontSize: '0.75rem' }}>
            {ticket.assigneeName ?? t('card.unassigned')}
          </span>
        </div>

        {/* Due date + Priority */}
        <div className="d-flex align-items-center gap-2 flex-shrink-0">
          {dueDateInfo && (
            <span
              className={`d-flex align-items-center gap-1 ${dueDateInfo.className}`}
              style={{ fontSize: '0.75rem', fontWeight: 500 }}
            >
              <i className="bi bi-calendar3" style={{ fontSize: '0.65rem' }} />
              {dueDateInfo.text}
            </span>
          )}
          <PriorityIndicator priority={ticket.priority} />
        </div>
      </div>

      {/* ── Metadata indicators (links, comments) ──────────────────────── */}
      {(ticket.linkCount > 0 || ticket.commentCount > 0) && (
        <div className="d-flex align-items-center gap-2 mt-1 text-muted" style={{ fontSize: '0.7rem' }}>
          {ticket.linkCount > 0 && (
            <span
              className="d-inline-flex align-items-center gap-1"
              title={
                ticket.linkCount === 1
                  ? t('card.link', { count: ticket.linkCount })
                  : t('card.links', { count: ticket.linkCount })
              }
            >
              <i className="bi bi-link-45deg" style={{ fontSize: '0.75rem' }} />
              {ticket.linkCount}
            </span>
          )}
          {ticket.commentCount > 0 && (
            <span className="d-inline-flex align-items-center gap-1">
              <i className="bi bi-chat" style={{ fontSize: '0.7rem' }} />
              {ticket.commentCount}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
