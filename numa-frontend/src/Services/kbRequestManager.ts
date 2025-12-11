/**
 * KB Request Manager - Deduplicates and caches Knowledge Base API requests
 * Prevents throttling by ensuring only one request per KB per time window
 */

import { getKnowledgeBaseState, KBState } from '../utils/knowledgeBaseUtils';
import type { BedrockAgentClient } from '@aws-sdk/client-bedrock-agent';
import type { QBusinessClient } from '@aws-sdk/client-qbusiness';

interface RequestCacheEntry {
  promise: Promise<KBState>;
  timestamp: number;
  kbId: string;
}

interface KBConfig {
  preferredKnowledgeBase: string;
  qBusinessClient: QBusinessClient | null;
  bedrockAgentClient: BedrockAgentClient | null;
  qApplicationId: string | null;
  qIndexId: string | null;
  bedrockKnowledgeBaseId: string | null;
  clientDisplayName: string;
  s3PrefixFilter: string | null;
  kbType: string | null;
  kbId: string;
  fetchCrawlerStats: (() => Promise<unknown>) | null;
}

interface KBRequestOptions {
  force?: boolean;
  timeout?: number;
  config?: KBConfig;
}

class KBRequestManager {
  private activeRequests = new Map<string, RequestCacheEntry>();
  private cache = new Map<string, { data: KBState; timestamp: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly DEDUP_WINDOW = 1000; // 1 second deduplication window

  /**
   * Get KB state with automatic deduplication and caching
   */
  async getKBState(
    kbId: string,
    bedrockAgentClient: BedrockAgentClient | null,
    qBusinessClient: QBusinessClient | null,
    preferredKnowledgeBase: string,
    options: KBRequestOptions = {},
  ): Promise<KBState> {
    const { force = false, timeout = 30000 } = options;
    const cacheKey = `${kbId}-${preferredKnowledgeBase}`;
    const now = Date.now();

    // Check if we should use cached data
    if (!force) {
      const cached = this.cache.get(cacheKey);
      if (cached && now - cached.timestamp < this.CACHE_TTL) {
        console.log(`[KBRequestManager] Using cached data for ${kbId}`);
        return cached.data;
      }
    }

    // Check for active request to deduplicate
    const activeRequest = this.activeRequests.get(cacheKey);
    if (activeRequest && now - activeRequest.timestamp < this.DEDUP_WINDOW) {
      console.log(`[KBRequestManager] Deduplicating request for ${kbId}`);
      return activeRequest.promise;
    }

    // Create new request with retry logic
    console.log(`[KBRequestManager] Creating new request for ${kbId}`);
    const promise = this.createRequestWithRetry(
      kbId,
      bedrockAgentClient,
      qBusinessClient,
      preferredKnowledgeBase,
      timeout,
      options.config,
    );

    // Store active request
    this.activeRequests.set(cacheKey, {
      promise,
      timestamp: now,
      kbId,
    });

    try {
      const result = await promise;

      // Cache successful result
      this.cache.set(cacheKey, {
        data: result,
        timestamp: now,
      });

      return result;
    } finally {
      // Clean up active request
      this.activeRequests.delete(cacheKey);
    }
  }

  /**
   * Create request with exponential backoff retry for 429 errors
   */
  private async createRequestWithRetry(
    kbId: string,
    bedrockAgentClient: BedrockAgentClient | null,
    qBusinessClient: QBusinessClient | null,
    preferredKnowledgeBase: string,
    timeout: number,
    config?: KBConfig,
  ): Promise<KBState> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Add timeout wrapper
        // Use config if provided, otherwise create one from session storage
        const finalConfig = config || {
          preferredKnowledgeBase,
          qBusinessClient,
          bedrockAgentClient,
          qApplicationId: preferredKnowledgeBase === 'q' ? window.sessionStorage.getItem('Q_APPLICATION_ID') : null,
          qIndexId: preferredKnowledgeBase === 'q' ? window.sessionStorage.getItem('Q_INDEX_ID') : null,
          bedrockKnowledgeBaseId:
            preferredKnowledgeBase === 'bedrock' ? window.sessionStorage.getItem('BEDROCK_KNOWLEDGE_BASE_ID') : null,
          clientDisplayName: `numa-${window.sessionStorage.getItem('CLIENT_NAME')}`,
          s3PrefixFilter: null,
          kbType: null,
          kbId,
          fetchCrawlerStats: null,
        };

        return await Promise.race([
          getKnowledgeBaseState(finalConfig),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Request timeout')), timeout)),
        ]);
      } catch (error) {
        lastError = error as Error;

        // Check if it's a throttling error
        const isThrottling =
          error instanceof Error &&
          (error.message.includes('ThrottlingException') ||
            error.message.includes('Too Many Requests') ||
            error.message.includes('Rate limit exceeded'));

        if (isThrottling && attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(
            `[KBRequestManager] Throttling detected for ${kbId}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // Re-throw non-throttling errors or max retries exceeded
        throw error;
      }
    }

    throw lastError || new Error('Unknown error during KB request');
  }

  /**
   * Invalidate cache for a specific KB
   */
  invalidateCache(kbId: string, preferredKnowledgeBase?: string): void {
    if (preferredKnowledgeBase) {
      const cacheKey = `${kbId}-${preferredKnowledgeBase}`;
      this.cache.delete(cacheKey);
      this.activeRequests.delete(cacheKey);
    } else {
      // Invalidate all entries for this KB
      const keysToDelete: string[] = [];
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${kbId}-`)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach((key) => {
        this.cache.delete(key);
        this.activeRequests.delete(key);
      });
    }
    console.log(`[KBRequestManager] Invalidated cache for ${kbId}`);
  }

  /**
   * Clear all caches and active requests
   */
  clearAll(): void {
    this.cache.clear();
    this.activeRequests.clear();
    console.log('[KBRequestManager] Cleared all caches and active requests');
  }

  /**
   * Get cache stats for debugging
   */
  getStats() {
    return {
      activeRequests: this.activeRequests.size,
      cachedEntries: this.cache.size,
      cacheKeys: Array.from(this.cache.keys()),
      activeKeys: Array.from(this.activeRequests.keys()),
    };
  }
}

// Singleton instance
export const kbRequestManager = new KBRequestManager();
export default kbRequestManager;
