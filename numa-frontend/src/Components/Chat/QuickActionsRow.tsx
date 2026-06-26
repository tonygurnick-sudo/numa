import React, { useMemo, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import {
  BarChart2,
  Bot,
  Calendar,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  FileText,
  Inbox,
  Lightbulb,
  Mail,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { getVisibleQuickActions, type QuickActionConfig } from '../../config/quickActionsConfig';

interface QuickActionsRowProps {
  /** Callback when a quick action is clicked */
  onQuickAction: (action: QuickActionConfig) => void;
  /** Whether web search is enabled (auto tools or explicit) */
  webSearchEnabled?: boolean;
  /** Whether knowledge base is enabled (has at least one KB) */
  kbEnabled?: boolean;
  /** Whether agents feature is enabled */
  agentsEnabled?: boolean;
  /** Set of connected integration IDs */
  connectedIntegrations?: Set<string>;
  /** Whether buttons should be disabled (e.g., during streaming) */
  disabled?: boolean;
  /** Maximum number of actions to show (the caller caps this per breakpoint) */
  maxVisible?: number;
  /**
   * When true, show the actions a page at a time (default 4) with prev/next
   * arrows instead of all at once. Used on mobile so the new-chat screen isn't
   * dominated by a tall grid. Desktop passes this false/undefined and is
   * unaffected (all actions render exactly as before).
   */
  paged?: boolean;
  /** Actions per page when `paged` is true. */
  pageSize?: number;
}

/**
 * QuickActionsRow displays a grid of quick action buttons on the new chat page.
 * Desktop: 3 columns. Mobile: a 2-column grid that scrolls vertically (the
 * caller passes all actions through; none are dropped).
 * Layout (grid columns) is handled in CSS.
 */
const QuickActionsRow: React.FC<QuickActionsRowProps> = ({
  onQuickAction,
  webSearchEnabled = false,
  kbEnabled = false,
  agentsEnabled = false,
  connectedIntegrations = new Set<string>(),
  disabled = false,
  maxVisible = 6,
  paged = false,
  pageSize = 4,
}) => {
  const { t } = useTranslation('chat');
  const [page, setPage] = useState(0);

  const iconMap: Record<string, LucideIcon> = {
    'file-text': FileText,
    'bar-chart-2': BarChart2,
    search: Search,
    calendar: Calendar,
    mail: Mail,
    lightbulb: Lightbulb,
    bot: Bot,
    inbox: Inbox,
    'calendar-check': CalendarCheck,
  };

  // Get visible actions based on enabled features
  const visibleActions = useMemo(() => {
    return getVisibleQuickActions({
      webSearchEnabled,
      kbEnabled,
      agentsEnabled,
      connectedIntegrations,
      maxVisible,
    });
  }, [webSearchEnabled, kbEnabled, agentsEnabled, connectedIntegrations, maxVisible]);

  // Don't render if no actions are visible
  if (visibleActions.length === 0) {
    return null;
  }

  // Mobile pager: show `pageSize` actions at a time with prev/next arrows.
  // When not paged (desktop), every action renders exactly as before.
  const pageCount = paged ? Math.ceil(visibleActions.length / pageSize) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const shownActions =
    paged && pageCount > 1 ? visibleActions.slice(safePage * pageSize, safePage * pageSize + pageSize) : visibleActions;
  const showPager = paged && pageCount > 1;

  const handleClick = (action: QuickActionConfig) => {
    if (!disabled) {
      onQuickAction(action);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: QuickActionConfig) => {
    if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
      e.preventDefault();
      onQuickAction(action);
    }
  };

  return (
    <div className="quick-actions-row" role="group" aria-label="Quick actions">
      <div className="quick-actions-scroll">
        {shownActions.map((action) => {
          const ActionIcon = iconMap[action.icon];
          return (
            <OverlayTrigger
              key={action.id}
              placement="top"
              overlay={<Tooltip id={`quick-action-${action.id}`}>{action.description}</Tooltip>}
            >
              <button
                type="button"
                className={`quick-action-btn ${disabled ? 'disabled' : ''}`}
                onClick={() => handleClick(action)}
                onKeyDown={(e) => handleKeyDown(e, action)}
                disabled={disabled}
                aria-label={action.label}
              >
                <span className="quick-action-icon-shell">
                  {ActionIcon ? (
                    <ActionIcon size={16} strokeWidth={1.9} aria-hidden="true" />
                  ) : (
                    <i className={`bi ${action.icon}`} aria-hidden="true" />
                  )}
                </span>
                <span className="quick-action-label">{action.label}</span>
              </button>
            </OverlayTrigger>
          );
        })}
      </div>
      {showPager && (
        <div className="quick-actions-pager">
          <button
            type="button"
            className="quick-actions-pager-btn"
            onClick={() => setPage((p) => Math.max(0, Math.min(p, pageCount - 1) - 1))}
            disabled={safePage === 0}
            aria-label={t('newChat.quickActionsPrev')}
          >
            <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <div className="quick-actions-pager-dots" aria-hidden="true">
            {Array.from({ length: pageCount }).map((_, i) => (
              <span key={i} className={`quick-actions-pager-dot ${i === safePage ? 'is-active' : ''}`} />
            ))}
          </div>
          <button
            type="button"
            className="quick-actions-pager-btn"
            onClick={() => setPage((p) => Math.min(pageCount - 1, Math.min(p, pageCount - 1) + 1))}
            disabled={safePage === pageCount - 1}
            aria-label={t('newChat.quickActionsNext')}
          >
            <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
const MemoizedQuickActionsRow = memo(QuickActionsRow);
MemoizedQuickActionsRow.displayName = 'QuickActionsRow';

export { MemoizedQuickActionsRow as QuickActionsRow };
export default MemoizedQuickActionsRow;
