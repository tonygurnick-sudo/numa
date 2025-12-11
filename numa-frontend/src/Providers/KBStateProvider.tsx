/**
 * KB State Provider
 * Centralized caching for Knowledge Base state to prevent 429 errors
 * and improve performance by eliminating duplicate API calls
 */

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { kbRequestManager } from '../Services/kbRequestManager';
import { useNumaRequest } from './NumaRequestContext';

// Cache TTL: 30 minutes (aligns with AWS sync schedule)
const CACHE_TTL = 30 * 60 * 1000;

interface KBDocument {
  documentId: string;
  status: string;
  updatedAt: string;
  error?: Record<string, unknown>;
  fileName?: string;
  isInferred?: boolean;
  statusReason?: string;
}

interface DataSource {
  dataSourceId: string;
  name: string;
  displayName?: string;
  type: string;
  status: string;
  source: string;
  isWebCrawler?: boolean;
  url?: string;
  pageCount?: number;
  lastCrawled?: string;
  lastSynced?: string;
  lastUpdated?: string;
}

interface KBState {
  dataSourceId: string;
  syncStatus: string;
  syncJobStatus: string;
  lastSuccessfulSync: string;
  lastUpdated: string;
  syncMetrics: Record<string, number>;
  documents: KBDocument[];
  dataSources: DataSource[];
  failedDocuments: KBDocument[];
  source: 'q-business' | 'bedrock';
}

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
  children: ReactNode;
}

/**
 * KBStateProvider
 * Provides cached KB state to child components
 */
export function KBStateProvider({ kbId, kbType, children }: KBStateProviderProps): React.JSX.Element {
  const [cache, setCache] = useState<KBStateCache>({
    data: null,
    timestamp: 0,
    isLoading: false,
    error: null,
    kbId: kbId,
  });

  // Track in-flight requests to prevent duplicate calls
  const inflightRequestRef = useRef<Promise<void> | null>(null);

  const { qBusinessClient, bedrockAgentClient, getCredentials: _getCredentials, region: authRegion } = useAuth();
  const { numaGet } = useNumaRequest();
  const region = authRegion || window.sessionStorage.getItem('REGION') || 'ap-southeast-2';
  const CLIENT_NAME = window.sessionStorage.getItem('CLIENT_NAME');
  const PREFERRED_KNOWLEDGE_BASE = window.sessionStorage.getItem('PREFERRED_KNOWLEDGE_BASE') || 'bedrock';
  const Q_APPLICATION_ID = window.sessionStorage.getItem('Q_APPLICATION_ID');
  const Q_INDEX_ID = window.sessionStorage.getItem('Q_INDEX_ID');
  const BEDROCK_KNOWLEDGE_BASE_ID = window.sessionStorage.getItem('BEDROCK_KNOWLEDGE_BASE_ID');

  // Calculate S3 prefix filter based on KB type (matching actual S3 bucket structure)
  const s3PrefixFilter = kbType === 'user' ? `documents/kb-${kbId}/` : 'documents/company/';

  /**
   * Fetch web crawler stats from the API
   */
  const fetchCrawlerStats = async (kbIdToQuery: string) => {
    try {
      console.log(`[KBStateProvider] Fetching crawler stats for KB: ${kbIdToQuery}`);
      const response = await numaGet(`/api/web-crawler-stats?kb_id=${kbIdToQuery}`);
      console.log(`[KBStateProvider] Crawler stats response:`, response);
      return response;
    } catch (error) {
      console.warn(`[KBStateProvider] Failed to fetch crawler stats for ${kbIdToQuery}:`, error);
      throw error;
    }
  };

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
   * Fetch KB state from API using request manager for deduplication
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

    // Create and store the fetch promise using request manager
    const fetchPromise = (async () => {
      try {
        setCache((prev) => ({ ...prev, isLoading: true, error: null }));

        // Create config object for request manager
        const config = {
          preferredKnowledgeBase: PREFERRED_KNOWLEDGE_BASE,
          qBusinessClient,
          qApplicationId: Q_APPLICATION_ID,
          qIndexId: Q_INDEX_ID,
          bedrockAgentClient,
          bedrockKnowledgeBaseId: BEDROCK_KNOWLEDGE_BASE_ID,
          clientDisplayName: `numa-${CLIENT_NAME}`,
          region,
          s3PrefixFilter,
          kbType,
          kbId,
          fetchCrawlerStats, // Web crawler stats integration
        };

        // Use request manager for deduplication and throttling protection
        const state = await kbRequestManager.getKBState(
          kbId,
          bedrockAgentClient,
          qBusinessClient,
          PREFERRED_KNOWLEDGE_BASE,
          {
            force: options?.force,
            timeout: 30000,
            config,
          },
        );

        setCache({
          data: state as KBState,
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
          error: (err as Error).message || 'Failed to fetch KB state',
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
    // Invalidate both local cache and request manager cache
    kbRequestManager.invalidateCache(kbId, PREFERRED_KNOWLEDGE_BASE);
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
   * Initial fetch on mount or when dependencies change
   */
  useEffect(() => {
    // Reset cache when kbId changes to avoid showing stale state
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
   * Initial fetch on mount or when dependencies change
   */
  useEffect(() => {
    if (
      (PREFERRED_KNOWLEDGE_BASE === 'q' && qBusinessClient) ||
      (PREFERRED_KNOWLEDGE_BASE === 'bedrock' && bedrockAgentClient)
    ) {
      // Only fetch if cache is invalid
      if (!isCacheValid() || cache.error) {
        fetchKBState();
      }
    }
  }, [qBusinessClient, bedrockAgentClient, PREFERRED_KNOWLEDGE_BASE, kbId]);

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
