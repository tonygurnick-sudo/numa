import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Ticket } from '../../../types/ops';
import { useOps } from '../OpsContext';
import { getTicketTypeIconClass } from '../../../constants/opsConstants';
import { PriorityIndicator } from '../Shared/PriorityIndicator';
import { formatDueDate } from '../Shared/ticketUtils';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Deterministic avatar background colors keyed by first char of name */
const AVATAR_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#f97316'];

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

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ticket.id });

  const style: React.CSSProperties = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition: transition ?? undefined,
      opacity: isDragging ? 0.4 : 1,
    }),
    [transform, transition, isDragging],
  );

  const ticketType = config?.ticketTypes.find((tt) => tt.id === ticket.ticketTypeId);
  const workUnit = ticket.workUnitId ? workUnits.find((wu) => wu.id === ticket.workUnitId) : null;
  const dueDateInfo = useMemo(() => formatDueDate(ticket.dueDate), [ticket.dueDate]);

  const typeColor = ticketType?.color ?? '#6c757d';

  // Assignee initials avatar
  const assigneeInitials = ticket.assigneeName
    ? ticket.assigneeName
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : null;
  const assigneeColor = ticket.assigneeName
    ? AVATAR_COLORS[ticket.assigneeName.charCodeAt(0) % AVATAR_COLORS.length]
    : undefined;

  const handleClick = useCallback(() => {
    onClick(ticket);
  }, [onClick, ticket]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      onContextMenu(e, ticket);
    },
    [onContextMenu, ticket],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="ticket-card"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      {...attributes}
      {...listeners}
    >
      {/* ── Top: type badge + meta counts ──────────────────────────── */}
      <div className="ticket-card-top">
        <span
          className="ticket-type-badge"
          style={{
            backgroundColor: `${typeColor}18`,
            color: typeColor,
            border: `1px solid ${typeColor}35`,
          }}
        >
          {ticketType?.icon && (
            <i className={`${getTicketTypeIconClass(ticketType.icon)} me-1`} style={{ fontSize: '0.65rem' }} />
          )}
          {ticketType?.name ?? '—'}
        </span>

        {(ticket.linkCount > 0 || ticket.commentCount > 0) && (
          <div className="d-flex align-items-center gap-2 ms-auto">
            {ticket.linkCount > 0 && (
              <span className="ticket-meta-chip" title={`${ticket.linkCount} link${ticket.linkCount !== 1 ? 's' : ''}`}>
                <i className="bi bi-link-45deg" /> {ticket.linkCount}
              </span>
            )}
            {ticket.commentCount > 0 && (
              <span className="ticket-meta-chip">
                <i className="bi bi-chat" /> {ticket.commentCount}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Context badges (customer / supplier / sprint) ───────────── */}
      {(ticket.customerName || ticket.supplierName || workUnit) && (
        <div className="d-flex flex-wrap gap-1 mb-2">
          {ticket.customerName && (
            <span className="ticket-badge ticket-badge-customer">
              <i className="bi bi-building me-1" />
              {ticket.customerName}
            </span>
          )}
          {ticket.supplierName && (
            <span className="ticket-badge ticket-badge-supplier">
              <i className="bi bi-truck me-1" />
              {ticket.supplierName}
            </span>
          )}
          {workUnit && (
            <span className="ticket-badge ticket-badge-sprint">
              <i className="bi bi-circle-fill me-1" style={{ fontSize: '0.28rem', verticalAlign: 'middle' }} />
              {workUnit.name}
            </span>
          )}
        </div>
      )}

      {/* ── Title ──────────────────────────────────────────────────── */}
      <p className="ticket-title" title={ticket.title}>
        {ticket.title}
      </p>

      {/* ── Tags (max 2 + overflow count) ──────────────────────────── */}
      {ticket.tags && ticket.tags.length > 0 && (
        <div className="d-flex flex-wrap gap-1 mb-2">
          {ticket.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="ticket-tag">
              {tag}
            </span>
          ))}
          {ticket.tags.length > 2 && <span className="ticket-tag">+{ticket.tags.length - 2}</span>}
        </div>
      )}

      {/* ── Footer: ID · effort · due date | priority · avatar ─────── */}
      <div className="ticket-card-footer">
        <div className="d-flex align-items-center gap-2">
          <span className="ticket-id">{ticket.displayId}</span>

          {ticket.effortPoints != null && (
            <span className="ticket-effort-pill">
              <i className="bi bi-bar-chart-fill" style={{ fontSize: '0.58rem' }} /> {ticket.effortPoints}
            </span>
          )}

          {dueDateInfo && (
            <span className={`ticket-due-date ${dueDateInfo.className}`}>
              <i className="bi bi-calendar3 me-1" style={{ fontSize: '0.58rem' }} />
              {dueDateInfo.text}
            </span>
          )}
        </div>

        <div className="d-flex align-items-center gap-1">
          <PriorityIndicator priority={ticket.priority} />

          {assigneeInitials ? (
            <div
              className="ticket-avatar"
              style={{ backgroundColor: assigneeColor }}
              title={ticket.assigneeName ?? undefined}
            >
              {assigneeInitials}
            </div>
          ) : (
            <div className="ticket-avatar ticket-avatar-empty" title={t('card.unassigned')}>
              <i className="bi bi-person" style={{ fontSize: '0.72rem' }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
