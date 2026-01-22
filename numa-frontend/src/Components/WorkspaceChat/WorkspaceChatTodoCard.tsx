/**
 * WorkspaceChatTodoCard - Checklist UI for TodoWrite tool
 *
 * Displays a nice checklist with status indicators showing task progress.
 * Uses activeForm for in-progress items to show human-readable status.
 */
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

  if (items.length === 0) return null;

  // Count stats
  const completed = items.filter((i) => i.status === 'completed').length;
  const total = items.length;

  return (
    <div className="workspace-chat-todo-card">
      {/* Progress header */}
      <div className="todo-header">
        <span className="todo-title">
          <i className="bi bi-list-check me-2" />
          {t('workspace.todo.title')}
        </span>
        <span className="todo-progress">
          {completed}/{total}
        </span>
      </div>

      {/* Checklist */}
      <div className="todo-list">
        {items.map((item, index) => (
          <div key={index} className={`todo-item status-${item.status}`}>
            <span className={`todo-icon ${item.status === 'in_progress' ? 'spinning' : ''}`}>
              <i className={getStatusIcon(item.status)} />
            </span>
            <span className="todo-text">{getDisplayText(item)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default WorkspaceChatTodoCard;
