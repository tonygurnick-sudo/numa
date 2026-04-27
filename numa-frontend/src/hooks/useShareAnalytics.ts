import { useState, useEffect, useCallback } from 'react';
import { listMyShares, getShareAnalytics } from '../Services/sharedChatService';
import type { ShareListItem, ShareAnalytics } from '../Services/sharedChatService';
import { getSwrCache, setSwrCache } from '../utils/swrCache';

export interface ShareAnalyticsSummary {
  /** All shares owned by the user */
  shares: ShareListItem[];
  /** Total messages across all shares */
  totalMessages: number;
  /** Total views across all shares */
  totalViews: number;
  /** Total number of active (non-expired) shares */
  activeShareCount: number;
  /** Per-share detailed analytics (loaded on demand) */
  shareDetails: Record<string, ShareAnalytics>;
}

export interface UseShareAnalyticsReturn {
  summary: ShareAnalyticsSummary | null;
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  /** Refresh the shares list */
  refresh: () => Promise<void>;
  /** Load detailed analytics for a specific share */
  loadShareDetail: (uuid: string) => Promise<ShareAnalytics | null>;
}

/**
 * Hook for loading shared link analytics from the backend API.
 * Fetches data from listMyShares and getShareAnalytics endpoints.
 */
const SWR_CACHE_KEY = 'shareAnalytics';

export function useShareAnalytics(): UseShareAnalyticsReturn {
  const [summary, setSummary] = useState<ShareAnalyticsSummary | null>(() =>
    getSwrCache<ShareAnalyticsSummary>(SWR_CACHE_KEY)
  );
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchShares = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const shares = await listMyShares();

      const totalMessages = shares.reduce((sum, s) => sum + (s.call_count || 0), 0);
      const totalViews = shares.reduce((sum, s) => sum + (s.view_count || 0), 0);

      const now = new Date();
      const activeShareCount = shares.filter((s) => {
        if (s.status === 'expired') return false;
        if (s.expires_at) {
          return new Date(s.expires_at) > now;
        }
        return true;
      }).length;

      const newSummary: ShareAnalyticsSummary = {
        shares,
        totalMessages,
        totalViews,
        activeShareCount,
        shareDetails: summary?.shareDetails ?? {},
      };
      setSummary(newSummary);
      setSwrCache(SWR_CACHE_KEY, newSummary, 500_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shares');
    } finally {
      setIsLoading(false);
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchShares();
  }, [fetchShares]);

  const loadShareDetail = useCallback(async (uuid: string): Promise<ShareAnalytics | null> => {
    try {
      const analytics = await getShareAnalytics(uuid);
      setSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          shareDetails: { ...prev.shareDetails, [uuid]: analytics },
        };
      });
      return analytics;
    } catch (err) {
      console.error('Failed to load share analytics:', err);
      return null;
    }
  }, []);

  return {
    summary,
    isLoaded,
    isLoading,
    error,
    refresh: fetchShares,
    loadShareDetail,
  };
}
