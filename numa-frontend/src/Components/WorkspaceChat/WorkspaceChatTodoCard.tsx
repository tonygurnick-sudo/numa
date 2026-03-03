/**
 * WorkspaceChatTodoCard - Checklist UI for TodoWrite tool
 *
 * Displays a nice checklist with status indicators showing task progress.
 * Uses activeForm for in-progress items to show human-readable status.
 * Auto-collapses completed lists so only the latest active list is prominent.
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkspaceChatTodoSegment } from '@/types/workspaceChatTypes';

interface Props {
  segment: WorkspaceChatTodoSegment;
}

/**
 * Get the icon for a todo item status.
 */
function getStatusIcon(status: 'pending' | 'in_progress' | 'completed'): string {
  switch (status) {
    case 'completed':
      return 'bi-check-circle-fill';
    case 'in_progress':
      return 'bi-arrow-repeat';
    case 'pending':
    default:
      return 'bi-circle';
  }
}

/**
 * Get the display text for a todo item.
 * Uses activeForm for in-progress items, content otherwise.
 */
function getDisplayText(item: { content: string; status: string; activeForm: string }): string {
  if (item.status === 'in_progress' && item.activeForm) {
    return item.activeForm;
  }
  return item.content;
}

export function WorkspaceChatTodoCard({ segment }: Props) {
  const { t } = useTranslation('chat');
  const { items } = segment;

  // Track whether the user has explicitly expanded a completed card.
  // Reset when isComplete changes (e.g. a new todo supersedes this one).
  const [userExpanded, setUserExpanded] = useState(false);
  useEffect(() => {
    setUserExpanded(false);
  }, [segment.isComplete]);

  if (items.length === 0) return null;

  // Completed segments collapse automatically; active ones stay expanded.
  // User can click to override and expand a completed card.
  const isCollapsed = segment.isComplete && !userExpanded;

  // Count stats
  const completed = items.filter((i) => i.status === 'completed').length;
  const total = items.length;
  const isSpinning = (status: string) => status === 'in_progress' && !segment.isComplete;

  const handleToggle = () => {
    if (segment.isComplete) {
      // For completed cards, toggle the user override
      setUserExpanded(!userExpanded);
    }
    // Active cards stay expanded — no toggle
  };

  return (
    <div className={`workspace-chat-todo-card ${isCollapsed ? 'todo-card-collapsed' : ''}`}>
      {/* Progress header — clickable to toggle collapse on completed cards */}
      <div className="todo-header" onClick={handleToggle}>
        <span className="todo-title">
          <i className="bi bi-list-check me-2" />
          {t('workspace.todo.title')}
          {isCollapsed && (
            <span className="todo-summary-text">
              &mdash; {completed}/{total} {t('workspace.todo.completed').toLowerCase()}
            </span>
          )}
        </span>
        {!isCollapsed && (
          <span className="todo-progress">
            {completed}/{total}
          </span>
        )}
        {segment.isComplete && <i className={`bi bi-chevron-${isCollapsed ? 'down' : 'up'} todo-collapse-icon`} />}
      </div>

      {/* Checklist — hidden when collapsed */}
      {!isCollapsed && (
        <div className="todo-list">
          {items.map((item, index) => (
            <div key={index} className={`todo-item status-${item.status}`}>
              <span className={`todo-icon ${isSpinning(item.status) ? 'spinning' : ''}`}>
                <i className={getStatusIcon(item.status)} />
              </span>
              <span className="todo-text">{getDisplayText(item)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default WorkspaceChatTodoCard;
