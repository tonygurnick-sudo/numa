import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Bot, Pencil, Trash2 } from 'lucide-react';
import i18n from '../../i18n';
import { useAuth } from '../../Providers/AuthProvider';

type ConversationMeta = {
  conversation_id: string;
  conversationName?: string | null;
  latestTimestamp: number;
  agentId?: string | null;
  agentTitle?: string | null;
  isAgentConversation?: boolean;
  isWorkspaceConversation?: boolean;
};

export interface WorkspaceChatHistoryPanelRef {
  refreshConversations: () => void;
}

export interface WorkspaceChatHistoryPanelProps {
  isOpen: boolean;
  currentConversationId?: string | null;
  onSelectConversation: (conversationId: string, isWorkspaceConversation?: boolean) => void;
}

const formatRelativeTime = (
  timestamp: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return t('newChat.relativeTime.justNow');
  if (minutes < 60) return t('newChat.relativeTime.minutesAgo', { count: minutes });
  if (hours < 24) return t('newChat.relativeTime.hoursAgo', { count: hours });
  if (days === 1) return t('newChat.relativeTime.yesterday');
  if (days < 7) return t('newChat.relativeTime.daysAgo', { count: days });

  return new Date(timestamp).toLocaleDateString(i18n.language || undefined, {
    month: 'short',
    day: 'numeric',
  });
};

export const WorkspaceChatHistoryPanel = forwardRef<WorkspaceChatHistoryPanelRef, WorkspaceChatHistoryPanelProps>(
  function WorkspaceChatHistoryPanel({ isOpen, currentConversationId, onSelectConversation }, ref) {
    const { t } = useTranslation('chat');
    const { user, numaChatDynamoUtils } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const [conversations, setConversations] = useState<ConversationMeta[]>([]);

    const idToken = user?.decoded_tokens?.idToken ?? {};
    const sub = idToken.sub;

    const fetchConversations = useCallback(async () => {
      if (!numaChatDynamoUtils || !user) return;
      setIsLoading(true);
      try {
        const userId = sub || 'anonymous';
        const metaItems = (await numaChatDynamoUtils.getUserConversationsMeta(userId)) as ConversationMeta[];
        const sorted = [...metaItems].sort((a, b) => b.latestTimestamp - a.latestTimestamp);
        setConversations(sorted);
        setLocalError(null);
      } catch (error) {
        console.error('Error fetching conversations for workspace history panel:', error);
        setLocalError(t('history.loadFailed'));
      } finally {
        setIsLoading(false);
      }
    }, [numaChatDynamoUtils, user, sub, t]);

    const handleRename = async (conversationId: string, currentName?: string | null) => {
      const newName = prompt(t('history.renamePrompt'), currentName || '');
      if (newName === null) return;
      if (!numaChatDynamoUtils) return;
      try {
        await numaChatDynamoUtils.updateConversationName(conversationId, sub, newName, 'manual');
        fetchConversations();
      } catch (error) {
        console.error('Error renaming conversation:', error);
        setLocalError(t('history.renameFailed'));
      }
    };

    const handleDelete = async (conversationId: string) => {
      if (!numaChatDynamoUtils) return;
      if (!window.confirm(t('history.deleteConfirm'))) return;
      try {
        await numaChatDynamoUtils.deleteConversation(conversationId, sub);
        fetchConversations();
      } catch (error) {
        console.error('Error deleting conversation:', error);
        setLocalError(t('history.deleteFailed'));
      }
    };

    useImperativeHandle(ref, () => ({
      refreshConversations: () => {
        fetchConversations();
      },
    }));

    useEffect(() => {
      if (isOpen) {
        fetchConversations();
      }
    }, [isOpen, fetchConversations, idToken.jti]);

    if (!isOpen) {
      return null;
    }

    return (
      <div className="workspace-chat-history-panel workspace-settings-modern-panel">
        <div className="workspace-chat-history-panel-body workspace-settings-modern-body">
          {isLoading ? (
            <div className="text-muted small d-flex align-items-center gap-2 py-2">
              <Spinner animation="border" size="sm" />
              {t('history.loading')}
            </div>
          ) : localError ? (
            <div className="text-danger small py-2">
              {localError}
              <Button variant="link" size="sm" className="ms-2 p-0" onClick={fetchConversations}>
                {t('history.retry')}
              </Button>
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-muted small fst-italic py-2">{t('history.empty')}</div>
          ) : (
            <div className="workspace-history-list">
              {conversations.map((convo) => (
                <div
                  key={convo.conversation_id}
                  className={`workspace-history-item ${convo.conversation_id === currentConversationId ? 'is-active' : ''} ${convo.isAgentConversation ? 'is-agent' : ''}`}
                >
                  <button
                    type="button"
                    className="workspace-history-item-content"
                    onClick={() => onSelectConversation(convo.conversation_id, convo.isWorkspaceConversation)}
                  >
                    <div className="workspace-history-item-title">
                      {convo.conversationName || t('history.untitled')}
                    </div>
                    {convo.isAgentConversation && convo.agentTitle && (
                      <div className="workspace-history-item-agent">
                        <Bot size={13} />
                        {t('history.agentPrefix', { name: convo.agentTitle })}
                      </div>
                    )}
                    <div className="workspace-history-item-meta">
                      <span className="workspace-history-item-time">
                        {formatRelativeTime(convo.latestTimestamp, t as (key: string) => string)}
                      </span>
                      {!convo.isWorkspaceConversation && (
                        <span className="workspace-history-item-legacy">{t('history.legacyBadge')}</span>
                      )}
                    </div>
                  </button>
                  <div className="workspace-history-item-actions">
                    <button
                      type="button"
                      className="workspace-history-action-btn"
                      aria-label={t('history.renameAria')}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRename(convo.conversation_id, convo.conversationName);
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      className="workspace-history-action-btn workspace-history-action-btn--danger"
                      aria-label={t('history.deleteAria')}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(convo.conversation_id);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  },
);

export default WorkspaceChatHistoryPanel;
