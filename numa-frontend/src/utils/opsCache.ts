/**
 * Stale-while-revalidate localStorage cache for Ops data.
 *
 * Components initialize state from the cache (instant render), then fetch
 * fresh data in the background. No TTL — every page load revalidates.
 */

const PREFIX = 'ops_cache_';

/** Return cached data for `key`, or null if not present / corrupt. */
export function getCached<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Persist `data` under `key`. Silently fails on quota / private mode. */
export function setCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(data));
  } catch {
    /* quota exceeded or private mode */
  }
}

/**
 * Remove cache entries. If `keyPrefix` is provided, only entries whose key
 * starts with that prefix are removed. Otherwise all ops cache entries are cleared.
 */
export function clearCache(keyPrefix?: string): void {
  const fullPrefix = PREFIX + (keyPrefix ?? '');
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k?.startsWith(fullPrefix)) {
      localStorage.removeItem(k);
    }
  }
}
