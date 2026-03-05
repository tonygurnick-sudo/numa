/**
 * Utility functions for shared link analytics.
 * Calculates metrics from share activity data fetched from the backend API.
 */

import type { ShareListItem, ShareAnalytics } from '../Services/sharedChatService';

export interface ShareMetrics {
  /** Total messages across all shares */
  totalMessages: number;
  /** Total views across all shares */
  totalViews: number;
  /** Total uploads across all dropzones */
  totalUploads: number;
  /** Total unique visitors across all shares */
  totalUniqueVisitors: number;
  /** Number of active (non-expired) shares */
  activeShares: number;
  /** Total number of shares */
  totalShares: number;
  /** Average messages per share */
  avgMessagesPerShare: number;
  /** Top share by message count */
  topShare: { name: string; uuid: string; messages: number } | null;
  /** Per-share breakdown */
  shareBreakdown: ShareBreakdownItem[];
}

export interface ShareBreakdownItem {
  uuid: string;
  name: string;
  description: string;
  shareType: string;
  callCount: number;
  uploadCount: number;
  viewCount: number;
  maxCalls?: number;
  isExpired: boolean;
  createdAt: number | null;
  enableChat: boolean;
  allowDownload: boolean;
}

/**
 * Calculate aggregate metrics from shares list.
 */
export function calculateShareMetrics(shares: ShareListItem[]): ShareMetrics {
  const totalMessages = shares.reduce((sum, s) => sum + (s.call_count || 0), 0);
  const totalViews = shares.reduce((sum, s) => sum + (s.view_count || 0), 0);
  const totalUploads = shares.reduce((sum, s) => sum + (s.upload_count || 0), 0);

  const now = new Date();
  const activeShares = shares.filter((s) => {
    if (s.status === 'expired') return false;
    if (s.expires_at) return new Date(s.expires_at) > now;
    return true;
  }).length;

  const avgMessagesPerShare = shares.length > 0 ? Math.round((totalMessages / shares.length) * 10) / 10 : 0;

  const sorted = [...shares].sort((a, b) => (b.call_count || 0) - (a.call_count || 0));
  const topShare =
    sorted.length > 0 && sorted[0].call_count > 0
      ? { name: sorted[0].name, uuid: sorted[0].uuid, messages: sorted[0].call_count }
      : null;

  const shareBreakdown: ShareBreakdownItem[] = shares.map((s) => ({
    uuid: s.uuid,
    name: s.name,
    description: s.description,
    shareType: s.share_type || (s.folder_path ? 'dropzone' : 'document'),
    callCount: s.call_count || 0,
    uploadCount: s.upload_count || 0,
    viewCount: s.view_count || 0,
    isExpired: s.status === 'expired' || (s.expires_at ? new Date(s.expires_at) <= now : false),
    createdAt: s.created_at,
    enableChat: s.enable_chat,
    allowDownload: s.allow_download,
  }));

  return {
    totalMessages,
    totalViews,
    totalUploads,
    totalUniqueVisitors: 0,
    activeShares,
    totalShares: shares.length,
    avgMessagesPerShare,
    topShare,
    shareBreakdown,
  };
}

/**
 * Build hourly activity data from share analytics sessions.
 * Returns a 24-element array of message counts per hour.
 */
export function buildHourlyActivity(analytics: ShareAnalytics): number[] {
  const hours = new Array(24).fill(0);

  for (const session of analytics.sessions) {
    if (session.first_message_at) {
      const hour = new Date(session.first_message_at * 1000).getHours();
      hours[hour] += session.message_count;
    }
  }

  return hours;
}

/**
 * Build daily activity data from share analytics sessions.
 * Returns array of { date, count } for the last N days.
 */
export function buildDailyActivity(
  analytics: ShareAnalytics,
  days: number = 7
): Array<{ date: string; count: number }> {
  const dailyMap = new Map<string, number>();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dailyMap.set(d.toISOString().split('T')[0], 0);
  }

  for (const session of analytics.sessions) {
    const ts = session.first_message_at || session.last_message_at;
    if (ts) {
      const dateStr = new Date(ts * 1000).toISOString().split('T')[0];
      if (dailyMap.has(dateStr)) {
        dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + session.message_count);
      }
    }
  }

  return Array.from(dailyMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Format hour as 12-hour time (e.g., "2 PM")
 */
export function formatHour(hour: number): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', hour12: true, minute: undefined }).replace(' ', '');
}

/**
 * Format date as short string (e.g., "Jan 15")
 */
export function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format a unix timestamp as a readable date/time string.
 */
export function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Export share analytics data as CSV.
 */
export function exportShareAnalyticsAsCSV(shares: ShareListItem[]): string {
  const lines: string[] = [];
  lines.push('Name,UUID,Type,Messages,Uploads,Views,Status,Created,Expires');

  for (const share of shares) {
    const created = share.created_at ? new Date(share.created_at * 1000).toISOString().split('T')[0] : '';
    const expires = share.expires_at || 'Never';
    const type = share.share_type || 'document';
    const uploads = share.upload_count || 0;
    lines.push(
      `"${share.name}",${share.uuid},${type},${share.call_count},${uploads},${share.view_count},${share.status},${created},${expires}`
    );
  }

  return lines.join('\n');
}

/**
 * Get sentiment color for a sentiment string.
 */
export function getSentimentColor(sentiment: string): string {
  switch (sentiment?.toLowerCase()) {
    case 'positive':
      return 'success';
    case 'negative':
      return 'danger';
    case 'neutral':
      return 'secondary';
    default:
      return 'info';
  }
}
