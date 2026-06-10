/**
 * KB State Provider
 * Centralized caching for Knowledge Base state to prevent 429 errors
 * and improve performance by eliminating duplicate API calls
 *
 * Now uses backend API (GET /api/kb/{kb_id}/state) instead of direct AWS SDK calls
 */

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { knowledgeBaseService, KBState } from '../Services/knowledgeBaseService';
import i18n from '../i18n';

// Cache TTL: 30 minutes (aligns with AWS sync schedule)
const CACHE_TTL = 30 * 60 * 1000;

interface KBStateCache {
  data: KBState | null;
  timestamp: number;
  isLoading: boolean;
  error: string | null;
  kbId: string | null;
}

interface KBStateContextType {
  kbState: KBState | null;
  isLoading: boolean;
  error: string | null;
  refreshKBState: (options?: { force?: boolean }) => Promise<void>;
  invalidateCache: () => void;
}

const KBStateContext = createContext<KBStateContextType | undefined>(undefined);

interface KBStateProviderProps {
  kbId: string;
  kbType: 'user' | 'company';
  /** 'data-sources' fetches the lightweight state view (no document list). */
  view?: 'data-sources';
  children: ReactNode;
}

/**
 * KBStateProvider
 * Provides cached KB state to child components
 */
export function KBStateProvider({ kbId, kbType: _kbType, view, children }: KBStateProviderProps): React.JSX.Element {
  const [cache, setCache] = useState<KBStateCache>({
    data: null,
    timestamp: 0,
    isLoading: false,
    error: null,
    kbId: kbId,
  });

  // Track in-flight requests to prevent duplicate calls
  const inflightRequestRef = useRef<Promise<void> | null>(null);

  /**
   * Check if cache is valid
   */
  function isCacheValid(): boolean {
    if (!cache.data || !cache.timestamp) return false;
    if (cache.kbId !== kbId) return false;
    const now = Date.now();
    const age = now - cache.timestamp;
    return age < CACHE_TTL;
  }

  /**
   * Fetch KB state from backend API
   */
  async function fetchKBState(options?: { force?: boolean }): Promise<void> {
    // If cache is valid and not forcing, return cached data
    if (!options?.force && isCacheValid() && !cache.error) {
      return;
    }

    // If already loading (deduplication), wait for existing request
    if (inflightRequestRef.current) {
      return inflightRequestRef.current;
    }

    // Prevent overlapping fetches
    if (cache.isLoading) {
      return;
    }

    // Create and store the fetch promise
    const fetchPromise = (async () => {
      try {
        setCache((prev) => ({ ...prev, isLoading: true, error: null }));

        // Use backend API for KB state
        const state = await knowledgeBaseService.getKBState(kbId, view ? { view } : undefined);

        // Check for error response from backend
        if (state.error && !state.dataSourceId) {
          throw new Error(state.error);
        }

        setCache({
          data: state,
          timestamp: Date.now(),
          isLoading: false,
          error: null,
          kbId,
        });
      } catch (err: unknown) {
        console.error('KB State fetch error:', err);
        setCache((prev) => ({
          ...prev,
          isLoading: false,
          error: (err as Error).message || i18n.t('errors:knowledgeBase.stateFailed'),
        }));
      } finally {
        inflightRequestRef.current = null;
      }
    })();

    inflightRequestRef.current = fetchPromise;
    return fetchPromise;
  }

  /**
   * Invalidate cache (mark as stale)
   */
  function invalidateCache(): void {
    setCache((prev) => ({
      ...prev,
      timestamp: 0, // Mark as expired
    }));
    // Immediately fetch fresh data
    fetchKBState({ force: true });
  }

  /**
   * Manual refresh function exposed to components
   */
  async function refreshKBState(options?: { force?: boolean }): Promise<void> {
    await fetchKBState(options);
  }

  /**
   * Reset cache when kbId changes
   */
  useEffect(() => {
    setCache({
      data: null,
      timestamp: 0,
      isLoading: false,
      error: null,
      kbId,
    });
    inflightRequestRef.current = null;
  }, [kbId]);

  /**
   * Initial fetch on mount or when kbId changes
   */
  useEffect(() => {
    // Only fetch if cache is invalid
    if (!isCacheValid() || cache.error) {
      fetchKBState();
    }
  }, [kbId]);

  const contextValue: KBStateContextType = {
    kbState: cache.data,
    isLoading: cache.isLoading,
    error: cache.error,
    refreshKBState,
    invalidateCache,
  };

  return <KBStateContext.Provider value={contextValue}>{children}</KBStateContext.Provider>;
}

/**
 * Hook to use KB state in components
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useKBState(): KBStateContextType {
  const context = useContext(KBStateContext);
  if (context === undefined) {
    throw new Error('useKBState must be used within a KBStateProvider');
  }
  return context;
}
