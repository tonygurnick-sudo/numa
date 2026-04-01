import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useOps } from './OpsContext';
import type { Ticket, AuditAction } from '../../types/ops';

// ── Audit icon/color map (mirrors TicketDetailModal) ────────────────────────

const AUDIT_ICON_MAP: Record<AuditAction | 'default', { icon: string; color: string }> = {
  created: { icon: 'bi-plus-circle', color: '#198754' },
  updated: { icon: 'bi-pencil', color: '#0d6efd' },
  moved: { icon: 'bi-arrows-move', color: '#6f42c1' },
  commented: { icon: 'bi-chat', color: '#6c757d' },
  linked: { icon: 'bi-link-45deg', color: '#6610f2' },
  deleted: { icon: 'bi-trash', color: '#dc3545' },
  restored: { icon: 'bi-arrow-counterclockwise', color: '#198754' },
  default: { icon: 'bi-clock-history', color: '#6c757d' },
};

// ── Activity item derived from ticket data ──────────────────────────────────

type ActivityItem = {
  id: string;
  ticketId: string;
  displayId: string;
  title: string;
  action: AuditAction;
  userName: string;
  timestamp: string;
};

const _LS_KEY = 'numa_ops_activity_sidebar';

// ── Relative time helper ────────────────────────────────────────────────────

function relativeTime(timestamp: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  const diffWeek = Math.floor(diffDay / 7);

  if (diffMin < 1) return t('comments.timeAgo.justNow');
  if (diffMin < 60) return t('comments.timeAgo.minutesAgo', { count: diffMin });
  if (diffHr < 24) return t('comments.timeAgo.hoursAgo', { count: diffHr });
  if (diffDay < 7) return t('comments.timeAgo.daysAgo', { count: diffDay });
  return t('comments.timeAgo.weeksAgo', { count: diffWeek });
}

// ── Derive action from ticket timestamps ────────────────────────────────────

function inferAction(ticket: Ticket): AuditAction {
  // If completedAt or endedAt is close to updatedAt, treat as moved/completed
  if (ticket.completedAt && ticket.completedAt === ticket.updatedAt) return 'moved';
  if (ticket.endedAt && ticket.endedAt === ticket.updatedAt) return 'moved';
  // If createdAt === updatedAt, it was just created
  if (ticket.createdAt === ticket.updatedAt) return 'created';
  return 'updated';
}

// ── Component ───────────────────────────────────────────────────────────────

type ActivityFeedSidebarProps = {
  open: boolean;
  onClose: () => void;
  onOpenTicket: (ticketId: string) => void;
};

const MAX_ITEMS = 50;

export const ActivityFeedSidebar: React.FC<ActivityFeedSidebarProps> = ({ open, onClose, onOpenTicket }) => {
  const { t } = useTranslation('ops');
  const { tickets, config } = useOps();

  // Build staff lookup map for resolving IDs to names
  const staffMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of config?.staff ?? []) {
      map.set(s.id, s.name || s.email);
    }
    return map;
  }, [config?.staff]);

  // Derive activity items from tickets sorted by updatedAt
  const activityItems = useMemo<ActivityItem[]>(() => {
    if (!tickets || tickets.length === 0) return [];

    const sorted = [...tickets].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return sorted.slice(0, MAX_ITEMS).map((ticket) => {
      const action = inferAction(ticket);
      // Resolve names: try name fields first, then look up IDs in staff map
      const resolvedCreator = ticket.createdByName || (ticket.createdBy ? staffMap.get(ticket.createdBy) : undefined);
      const resolvedAssignee = ticket.assigneeName || (ticket.assigneeId ? staffMap.get(ticket.assigneeId) : undefined);
      // For "created" events, prefer the creator name; for updates, prefer assignee
      const userName =
        action === 'created'
          ? resolvedCreator || resolvedAssignee || t('fields.unknown')
          : resolvedAssignee || resolvedCreator || t('fields.unknown');
      return {
        id: `${ticket.id}-${ticket.updatedAt}`,
        ticketId: ticket.id,
        displayId: ticket.displayId,
        title: ticket.title,
        action,
        userName,
        timestamp: ticket.updatedAt,
      };
    });
  }, [tickets, t, staffMap]);

  // Count items from last hour for badge
  const _recentCount = useMemo(() => {
    const oneHourAgo = Date.now() - 3600000;
    return activityItems.filter((item) => new Date(item.timestamp).getTime() > oneHourAgo).length;
  }, [activityItems]);

  return (
    <>
      {/* Backdrop overlay when sidebar is open */}
      {open && <div className="ops-activity-backdrop" onClick={onClose} />}

      <div className={`ops-activity-sidebar ${open ? 'ops-activity-sidebar--open' : ''}`}>
        {/* Header */}
        <div className="ops-activity-sidebar-header">
          <h6 className="mb-0 fw-semibold">{t('activity.title')}</h6>
          <button type="button" className="btn-close" onClick={onClose} aria-label={t('common.close')} />
        </div>

        {/* Body */}
        <div className="ops-activity-sidebar-body">
          {activityItems.length === 0 ? (
            <div className="ops-activity-empty">
              <i className="bi bi-clock-history d-block mb-2" style={{ fontSize: '1.5rem', opacity: 0.4 }} />
              <span>{t('activity.empty')}</span>
            </div>
          ) : (
            activityItems.map((item) => {
              const { icon, color } = AUDIT_ICON_MAP[item.action] ?? AUDIT_ICON_MAP.default;
              return (
                <div
                  key={item.id}
                  className="ops-activity-item"
                  onClick={() => onOpenTicket(item.ticketId)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenTicket(item.ticketId);
                    }
                  }}
                >
                  <div className="ops-activity-icon" style={{ backgroundColor: `${color}14`, color }}>
                    <i className={`bi ${icon}`} />
                  </div>
                  <div className="ops-activity-content">
                    <div className="ops-activity-text">
                      {item.action === 'created'
                        ? t('activity.ticketCreated', { user: item.userName, ticket: item.displayId })
                        : t('activity.ticketUpdated', { user: item.userName, ticket: item.displayId })}
                    </div>
                    <div className="ops-activity-title">{item.title}</div>
                    <div className="ops-activity-time">{relativeTime(item.timestamp, t)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
};

export default ActivityFeedSidebar;
