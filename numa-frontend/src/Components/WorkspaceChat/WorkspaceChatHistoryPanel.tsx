import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Bot, History, Pencil, Trash2 } from 'lucide-react';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import i18n from '../../i18n';
import { useAuth } from '../../Providers/AuthProvider';
import { useConfirm, usePrompt } from '../../Providers/ConfirmContext';

const PAGE_SIZE = 50;

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
  updateConversationName: (conversationId: string, name: string) => void;
}

export interface WorkspaceChatHistoryPanelProps {
  isOpen: boolean;
  currentConversationId?: string | null;
  onSelectConversation: (conversationId: string, isWorkspaceConversation?: boolean) => void;
}

const formatRelativeTime = (
  timestamp: number,
  t: (key: string, options?: Record<string, unknown>) => string
): string => {
  if (!timestamp || timestamp < 86400000) return '';

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

  const date = new Date(timestamp);
  const currentYear = new Date().getFullYear();
  if (date.getFullYear() !== currentYear) {
    return date.toLocaleDateString(i18n.language || undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  return date.toLocaleDateString(i18n.language || undefined, {
    month: 'short',
    day: 'numeric',
  });
};

type DateGroupKey = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | string;

const getDateGroupKey = (timestamp: number): DateGroupKey => {
  if (!timestamp || timestamp < 86400000) return 'older';

  const now = new Date();
  const date = new Date(timestamp);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  if (date >= startOfToday) return 'today';
  if (date >= startOfYesterday) return 'yesterday';
  if (date >= startOfWeek) return 'thisWeek';
  if (date >= startOfMonth) return 'thisMonth';

  return `month-${date.getFullYear()}-${date.getMonth()}`;
};

const getMonthYearLabel = (timestamp: number): string => {
  return new Date(timestamp).toLocaleDateString(i18n.language || undefined, {
    month: 'long',
    year: 'numeric',
  });
};

export const WorkspaceChatHistoryPanel = forwardRef<WorkspaceChatHistoryPanelRef, WorkspaceChatHistoryPanelProps>(
  function WorkspaceChatHistoryPanel({ isOpen, currentConversationId, onSelectConversation }, ref) {
    const { t } = useTranslation('chat');
    const { t: tCommon } = useTranslation('common');
    const { user, numaChatDynamoUtils } = useAuth();
    const confirm = useConfirm();
    const prompt = usePrompt();
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const [conversations, setConversations] = useState<ConversationMeta[]>([]);
    const [hasMore, setHasMore] = useState(true);
    const [cursor, setCursor] = useState<Record<string, AttributeValue> | null>(null);
    const loaderRef = useRef<HTMLDivElement | null>(null);

    const idToken = user?.decoded_tokens?.idToken ?? {};
    const sub = idToken.sub;

    const fetchConversations = useCallback(async () => {
      if (!numaChatDynamoUtils || !user) return;
      // Only show spinner on initial load when there's nothing to display
      if (conversations.length === 0) {
        setIsLoading(true);
      }
      setHasMore(true);
      setCursor(null);
      try {
        const userId = sub || 'anonymous';
        const result = await numaChatDynamoUtils.getUserConversationsMetaPaginated(userId, PAGE_SIZE, null);
        const sorted = [...result.conversations].sort(
          (a, b) => (b.latestTimestamp as number) - (a.latestTimestamp as number)
        ) as ConversationMeta[];
        setConversations(sorted);
        setCursor(result.lastEvaluatedKey);
        setHasMore(result.hasMore);
        setLocalError(null);
      } catch (firstError) {
        console.warn('First attempt to fetch history failed, retrying in 1.5s...', firstError);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
          const userId = sub || 'anonymous';
          const result = await numaChatDynamoUtils.getUserConversationsMetaPaginated(userId, PAGE_SIZE, null);
          const sorted = [...result.conversations].sort(
            (a, b) => (b.latestTimestamp as number) - (a.latestTimestamp as number)
          ) as ConversationMeta[];
          setConversations(sorted);
          setCursor(result.lastEvaluatedKey);
          setHasMore(result.hasMore);
          setLocalError(null);
        } catch (retryError) {
          console.error('Retry also failed for workspace history panel:', retryError);
          setLocalError(t('history.loadFailed'));
        }
      } finally {
        setIsLoading(false);
      }
    }, [numaChatDynamoUtils, user, sub, t]);

    const loadMoreConversations = useCallback(async () => {
      if (!numaChatDynamoUtils || !user || isLoadingMore || !hasMore || !cursor) return;
      setIsLoadingMore(true);
      try {
        const userId = sub || 'anonymous';
        const result = await numaChatDynamoUtils.getUserConversationsMetaPaginated(userId, PAGE_SIZE, cursor);
        const newItems = [...result.conversations].sort(
          (a, b) => (b.latestTimestamp as number) - (a.latestTimestamp as number)
        ) as ConversationMeta[];
        setConversations((prev) => [...prev, ...newItems]);
        setCursor(result.lastEvaluatedKey);
        setHasMore(result.hasMore);
      } catch (error) {
        console.error('Error loading more conversations:', error);
        setHasMore(false);
      } finally {
        setIsLoadingMore(false);
      }
    }, [numaChatDynamoUtils, user, sub, cursor, isLoadingMore, hasMore]);

    const handleRename = async (conversationId: string, currentName?: string | null) => {
      const newName = await prompt({
        title: tCommon('prompt.rename'),
        message: t('history.renamePrompt'),
        defaultValue: currentName || '',
        confirmLabel: tCommon('confirm.save'),
        required: true,
      });
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
      const ok = await confirm({
        message: t('history.deleteConfirm'),
        confirmLabel: tCommon('confirm.delete'),
        variant: 'danger',
      });
      if (!ok) return;
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
      updateConversationName: (conversationId: string, name: string) => {
        setConversations((prev) =>
          prev.map((c) => (c.conversation_id === conversationId ? { ...c, conversationName: name } : c))
        );
      },
    }));

    useEffect(() => {
      if (isOpen) {
        fetchConversations();
      }
    }, [isOpen, fetchConversations, idToken.jti]);

    // IntersectionObserver for infinite scroll
    useEffect(() => {
      if (!loaderRef.current || !isOpen) return;
      const currentLoader = loaderRef.current;
      let observer: IntersectionObserver;

      const timeoutId = setTimeout(() => {
        observer = new IntersectionObserver(
          (entries) => {
            if (entries[0]?.isIntersecting && hasMore && !isLoadingMore) {
              loadMoreConversations();
            }
          },
          { threshold: 0.1, rootMargin: '100px' }
        );
        observer.observe(currentLoader);
      }, 100);

      return () => {
        clearTimeout(timeoutId);
        if (observer) observer.unobserve(currentLoader);
      };
    }, [loadMoreConversations, hasMore, isLoadingMore, isOpen]);

    const groupedConversations = useMemo(() => {
      const groups: { key: string; label: string; conversations: ConversationMeta[] }[] = [];
      const groupMap = new Map<string, ConversationMeta[]>();
      const groupOrder: string[] = [];

      const groupLabelMap: Record<string, string> = {
        today: t('history.dateGroups.today'),
        yesterday: t('history.dateGroups.yesterday'),
        thisWeek: t('history.dateGroups.thisWeek'),
        thisMonth: t('history.dateGroups.thisMonth'),
        older: t('history.dateGroups.older'),
      };

      for (const convo of conversations) {
        const key = getDateGroupKey(convo.latestTimestamp);
        if (!groupMap.has(key)) {
          groupMap.set(key, []);
          groupOrder.push(key);
        }
        groupMap.get(key)!.push(convo);
      }

      for (const key of groupOrder) {
        const items = groupMap.get(key)!;
        const label = groupLabelMap[key] ?? getMonthYearLabel(items[0].latestTimestamp);
        groups.push({ key, label, conversations: items });
      }

      return groups;
    }, [conversations, t]);

    if (!isOpen) {
      return null;
    }

    return (
      <div className="workspace-chat-history-panel workspace-settings-modern-panel">
        <div className="workspace-chat-history-panel-body workspace-settings-modern-body">
          <button type="button" className="workspace-history-view-all-btn" onClick={() => navigate('/chat-history')}>
            <History size={14} />
            <span>{t('history.viewAll')}</span>
          </button>
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
              {groupedConversations.map((group) => (
                <div key={group.key} className="workspace-history-group">
                  <div className="workspace-history-group-header">{group.label}</div>
                  {group.conversations.map((convo) => (
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
              ))}
              {hasMore && (
                <div ref={loaderRef} className="workspace-history-loader">
                  {isLoadingMore && (
                    <div className="text-muted small d-flex align-items-center justify-content-center gap-2 py-2">
                      <Spinner animation="border" size="sm" />
                      {t('history.loadingMore')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);

export default WorkspaceChatHistoryPanel;
