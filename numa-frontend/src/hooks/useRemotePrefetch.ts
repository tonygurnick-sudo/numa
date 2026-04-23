/**
 * Smart prefetch engine for remote file browsing.
 *
 * After a folder loads, this hook prefetches the next level of visible
 * subfolders in the background using requestIdleCallback so the UI is
 * never blocked. Uses IntersectionObserver to prioritise on-screen folders.
 *
 * Concurrency-limited, abort-safe, and adaptive to slow networks.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { OAuthFolder } from '../types/oauthProviders';
import type { SynergyFolder } from '../types/synergySync';
import { ConnectorsService } from '../Services/ConnectorsService';
import { SynergyDataConnectorService } from '../Services/SynergyDataConnectorService';
import { getRemoteFolder, setRemoteFolder, oauthCacheKey, synergyCacheKey } from '../utils/remoteFolderCache';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;

interface PrefetchTask {
  key: string;
  folderId: string;
  priority: number; // lower = higher priority
  abort: AbortController;
}

type ProviderConfig = { type: 'oauth'; oauthProvider: string } | { type: 'synergy'; numaGet: NumaGet };

export interface UseRemotePrefetchOpts {
  provider: ProviderConfig;
  enabled: boolean;
}

export interface UseRemotePrefetchReturn {
  /** Queue prefetches for child folders after a folder load. */
  triggerPrefetch: (folders: (OAuthFolder | SynergyFolder)[], parentKey: string) => void;
  /** Abort all in-flight and queued prefetches. */
  cancelAll: () => void;
  /** Register/unregister a folder element for viewport priority. */
  observeFolder: (folderId: string, element: HTMLElement | null) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const scheduleIdle =
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? window.requestIdleCallback
    : (cb: () => void) => window.setTimeout(cb, 50);

const cancelIdle =
  typeof window !== 'undefined' && 'cancelIdleCallback' in window
    ? window.cancelIdleCallback
    : (id: number) => window.clearTimeout(id);

const isSlowNetwork = (): boolean => {
  const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  return conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g';
};

const MAX_CONCURRENT_DEFAULT = 3;
const MAX_PREFETCH_FOLDERS = 10;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRemotePrefetch({ provider, enabled }: UseRemotePrefetchOpts): UseRemotePrefetchReturn {
  const queueRef = useRef<PrefetchTask[]>([]);
  const activeCount = useRef(0);
  const maxConcurrent = useRef(MAX_CONCURRENT_DEFAULT);
  const idleHandleRef = useRef<number | null>(null);
  const visibleFoldersRef = useRef(new Set<string>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementMapRef = useRef(new Map<string, HTMLElement>());
  const providerRef = useRef(provider);
  providerRef.current = provider;

  // --- IntersectionObserver for viewport priority -------------------------

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const folderId = (entry.target as HTMLElement).dataset.prefetchFolderId;
          if (!folderId) continue;
          if (entry.isIntersecting) {
            visibleFoldersRef.current.add(folderId);
          } else {
            visibleFoldersRef.current.delete(folderId);
          }
        }
      },
      { threshold: 0 }
    );
    observerRef.current = observer;

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  const observeFolder = useCallback((folderId: string, element: HTMLElement | null) => {
    const observer = observerRef.current;
    if (!observer) return;

    // Unobserve previous element for this folderId
    const prev = elementMapRef.current.get(folderId);
    if (prev) observer.unobserve(prev);

    if (element) {
      element.dataset.prefetchFolderId = folderId;
      observer.observe(element);
      elementMapRef.current.set(folderId, element);
    } else {
      elementMapRef.current.delete(folderId);
    }
  }, []);

  // --- Fetch a single folder and store in cache ---------------------------

  const fetchAndCache = useCallback(async (task: PrefetchTask): Promise<void> => {
    const prov = providerRef.current;
    try {
      if (prov.type === 'oauth') {
        const contents = await ConnectorsService.files.list(prov.oauthProvider, task.folderId);
        if (!task.abort.signal.aborted) {
          setRemoteFolder(task.key, {
            folders: contents.folders,
            files: contents.files,
          });
        }
      } else {
        const response = await SynergyDataConnectorService.listFolderItems(prov.numaGet, task.folderId);
        if (!task.abort.signal.aborted) {
          setRemoteFolder(task.key, {
            folders: response.subfolders ?? [],
            files: response.files ?? [],
          });
        }
      }
    } catch {
      // Prefetch failure is silent — user hasn't requested this data
    }
  }, []);

  // --- Process the queue via requestIdleCallback --------------------------

  const processQueue = useCallback(() => {
    if (queueRef.current.length === 0 || activeCount.current >= maxConcurrent.current) return;

    // Sort: visible folders first (priority 0), then rest (priority 1)
    queueRef.current.sort((a, b) => a.priority - b.priority);

    while (queueRef.current.length > 0 && activeCount.current < maxConcurrent.current) {
      const task = queueRef.current.shift();
      if (!task || task.abort.signal.aborted) continue;

      activeCount.current++;

      const startTime = Date.now();
      fetchAndCache(task).finally(() => {
        activeCount.current--;

        // Adaptive backoff: if a prefetch took >5s, reduce concurrency
        const elapsed = Date.now() - startTime;
        if (elapsed > 5000 && maxConcurrent.current > 1) {
          maxConcurrent.current = 1;
        }

        // Schedule more work if queue isn't empty
        if (queueRef.current.length > 0) {
          idleHandleRef.current = scheduleIdle(() => processQueue());
        }
      });
    }
  }, [fetchAndCache]);

  // --- Public: trigger prefetch after a folder loads ----------------------

  const triggerPrefetch = useCallback(
    (folders: (OAuthFolder | SynergyFolder)[], _parentKey: string) => {
      if (!enabled || isSlowNetwork()) return;

      // Cancel any pending prefetches from the previous level
      for (const task of queueRef.current) {
        task.abort.abort();
      }
      queueRef.current = [];

      // Reset concurrency after navigation (user moved on, fresh start)
      maxConcurrent.current = MAX_CONCURRENT_DEFAULT;

      const prov = providerRef.current;

      // Build tasks for subfolders
      const candidates = folders.slice(0, MAX_PREFETCH_FOLDERS);

      for (const folder of candidates) {
        const folderId = 'folder_id' in folder ? folder.folder_id : '';
        if (!folderId) continue;

        // Skip folders known to have no subfolders (only for OAuth which has this metadata)
        if (
          'has_subfolders' in folder &&
          folder.has_subfolders === false &&
          ('no_of_subfolders' in folder ? (folder.no_of_subfolders ?? 0) : 0) === 0
        ) {
          // Still prefetch — we want the file listing too for instant navigation
        }

        // Build cache key
        const key =
          prov.type === 'oauth' ? oauthCacheKey(prov.oauthProvider, folderId) : synergyCacheKey.folder(folderId);

        // Skip if already cached and fresh
        const cached = getRemoteFolder(key);
        if (cached && !cached.stale) continue;

        const isVisible = visibleFoldersRef.current.has(folderId);

        queueRef.current.push({
          key,
          folderId,
          priority: isVisible ? 0 : 1,
          abort: new AbortController(),
        });
      }

      if (queueRef.current.length > 0) {
        idleHandleRef.current = scheduleIdle(() => processQueue());
      }
    },
    [enabled, processQueue]
  );

  // --- Public: cancel all -------------------------------------------------

  const cancelAll = useCallback(() => {
    for (const task of queueRef.current) {
      task.abort.abort();
    }
    queueRef.current = [];

    if (idleHandleRef.current !== null) {
      cancelIdle(idleHandleRef.current);
      idleHandleRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => cancelAll, [cancelAll]);

  return { triggerPrefetch, cancelAll, observeFolder };
}
