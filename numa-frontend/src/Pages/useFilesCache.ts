/**
 * In-memory stale-while-revalidate cache for Files page.
 *
 * Module-level Map persists across re-renders. Entries expire after CACHE_TTL.
 * On cache hit the caller gets data immediately and should still revalidate
 * in the background.
 */

import { useMemo } from 'react';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Module-level singleton — survives re-renders, cleared on full page reload
const store = new Map<string, CacheEntry<unknown>>();

export function useFilesCache() {
  return useMemo(
    () => ({
      /** Return cached data if present and not expired, else null. */
      get<T>(key: string): T | null {
        const entry = store.get(key);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > CACHE_TTL) {
          store.delete(key);
          return null;
        }
        return entry.data as T;
      },

      /** Store data with current timestamp. */
      set<T>(key: string, data: T): void {
        store.set(key, { data, timestamp: Date.now() });
      },

      /** Delete all entries whose key starts with the given prefix. */
      invalidate(keyPrefix: string): void {
        for (const k of Array.from(store.keys())) {
          if (k.startsWith(keyPrefix)) store.delete(k);
        }
      },
    }),
    [],
  );
}
