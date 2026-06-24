import i18n from '../i18n';

/**
 * Shared date-grouping + relative-time helpers for conversation history lists.
 * Used by both the in-chat History panel (WorkspaceChatHistoryPanel) and the
 * standalone Recent Chats page (ChatHistoryPage) so they render identically.
 */

export type ConversationLike = {
  latestTimestamp: number;
};

const MS_PER_DAY = 86400000;

export const formatRelativeTime = (
  timestamp: number,
  t: (key: string, options?: Record<string, unknown>) => string
): string => {
  if (!timestamp || timestamp < MS_PER_DAY) return '';

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

export type DateGroupKey = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'older' | string;

export const getDateGroupKey = (timestamp: number): DateGroupKey => {
  if (!timestamp || timestamp < MS_PER_DAY) return 'older';

  const now = new Date();
  const date = new Date(timestamp);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - MS_PER_DAY);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  if (date >= startOfToday) return 'today';
  if (date >= startOfYesterday) return 'yesterday';
  if (date >= startOfWeek) return 'thisWeek';
  if (date >= startOfMonth) return 'thisMonth';

  return `month-${date.getFullYear()}-${date.getMonth()}`;
};

export const getMonthYearLabel = (timestamp: number): string => {
  return new Date(timestamp).toLocaleDateString(i18n.language || undefined, {
    month: 'long',
    year: 'numeric',
  });
};

/**
 * Group conversations (already sorted newest-first) into labelled date buckets:
 * Today / Yesterday / This Week / This Month / <Month Year> / Older.
 */
export const groupConversationsByDate = <T extends ConversationLike>(
  conversations: T[],
  t: (key: string, options?: Record<string, unknown>) => string
): { key: string; label: string; conversations: T[] }[] => {
  const groups: { key: string; label: string; conversations: T[] }[] = [];
  const groupMap = new Map<string, T[]>();
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
};
