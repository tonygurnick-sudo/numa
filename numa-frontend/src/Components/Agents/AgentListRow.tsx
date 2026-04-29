import { Badge } from 'react-bootstrap';
import { Copy, Eye, EyeOff, Heart, MessageSquare, Share2, Trash2 } from 'lucide-react';
import { AgentAvatar } from './AgentAvatar';
import type { AgentSummary } from '../../types/agents';
import { useTranslation } from 'react-i18next';

type Props = {
  agent: AgentSummary;
  isFavorite?: boolean;
  isHidden?: boolean;
  roleBadge?: string;
  onChat?: (agent: AgentSummary) => void;
  onEdit?: (agent: AgentSummary) => void;
  onDuplicate?: (agent: AgentSummary) => void;
  onDelete?: (agent: AgentSummary) => void;
  onToggleFavorite?: (agent: AgentSummary, next: boolean) => void;
  onToggleHidden?: (agent: AgentSummary, next: boolean) => void;
  onShare?: (agent: AgentSummary) => void;
  searchHighlight?: string;
};

const highlight = (text: string, query: string) => {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
};

export const AgentListRow = ({
  agent,
  isFavorite,
  isHidden,
  roleBadge,
  onChat,
  onEdit,
  onDuplicate,
  onDelete,
  onToggleFavorite,
  onToggleHidden,
  onShare,
  searchHighlight,
}: Props) => {
  const { t } = useTranslation('agents');

  return (
    <div
      className={`d-flex align-items-center gap-3 p-2 px-3 border rounded-3 bg-white ${isHidden ? 'opacity-50' : ''}`}
      style={{ cursor: 'pointer', transition: 'all 0.15s' }}
      onClick={() => onEdit?.(agent)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onEdit?.(agent);
      }}
    >
      <AgentAvatar agent={agent} size={34} />

      <div className="flex-grow-1 min-w-0">
        <div className="d-flex align-items-center gap-2">
          <span className="fw-bold text-truncate" style={{ fontSize: '0.9rem' }}>
            {searchHighlight ? highlight(agent.title, searchHighlight) : agent.title}
          </span>
          {isHidden && (
            <Badge bg="secondary" className="text-uppercase" style={{ fontSize: '0.65rem' }}>
              {t('management.hidden')}
            </Badge>
          )}
          {roleBadge && (
            <Badge
              bg=""
              style={{
                fontSize: '0.65rem',
                backgroundColor: roleBadge === 'owner' ? '#fef3c7' : roleBadge === 'editor' ? '#dbeafe' : '#f3f4f6',
                color: roleBadge === 'owner' ? '#92400e' : roleBadge === 'editor' ? '#1d4ed8' : '#6b7280',
              }}
            >
              {roleBadge.toUpperCase()}
            </Badge>
          )}
        </div>
        <div className="text-muted text-truncate" style={{ fontSize: '0.8rem', maxWidth: 400 }}>
          {searchHighlight ? highlight(agent.description || '', searchHighlight) : agent.description}
        </div>
      </div>

      <div className="d-flex gap-1 flex-shrink-0">
        {(agent.tags || []).slice(0, 3).map((tag) => (
          <Badge key={tag} bg="light" text="dark" style={{ fontSize: '0.7rem' }}>
            {tag}
          </Badge>
        ))}
      </div>

      <div className="d-flex align-items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        {onToggleFavorite && (
          <button
            className={`btn btn-sm btn-outline-light border ${isFavorite ? 'text-warning' : 'text-muted'}`}
            onClick={() => onToggleFavorite(agent, !isFavorite)}
            title={t('management.actions.favorite')}
            style={{ padding: '4px 6px' }}
          >
            <Heart size={14} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>
        )}
        {onShare && (
          <button
            className="btn btn-sm btn-outline-light border text-muted"
            onClick={() => onShare(agent)}
            title={t('management.actions.share')}
            style={{ padding: '4px 6px' }}
          >
            <Share2 size={14} />
          </button>
        )}
        {onDuplicate && (
          <button
            className="btn btn-sm btn-outline-light border text-muted"
            onClick={() => onDuplicate(agent)}
            title={t('management.actions.duplicate')}
            style={{ padding: '4px 6px' }}
          >
            <Copy size={14} />
          </button>
        )}
        {onToggleHidden && agent.scope === 'workspace' && (
          <button
            className="btn btn-sm btn-outline-light border text-muted"
            onClick={() => onToggleHidden(agent, !isHidden)}
            title={isHidden ? t('management.actions.unhide') : t('management.actions.hide')}
            style={{ padding: '4px 6px' }}
          >
            {isHidden ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        )}
        {onDelete && (
          <button
            className="btn btn-sm btn-outline-light border text-danger"
            onClick={() => onDelete(agent)}
            title={t('management.actions.delete')}
            style={{ padding: '4px 6px' }}
          >
            <Trash2 size={14} />
          </button>
        )}
        {onChat && (
          <button
            className="btn btn-sm btn-primary"
            onClick={() => onChat(agent)}
            style={{ padding: '4px 10px', fontSize: '0.8rem' }}
          >
            <MessageSquare size={13} className="me-1" />
            {t('management.actions.chat')}
          </button>
        )}
      </div>
    </div>
  );
};
