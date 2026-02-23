/**
 * Generic localStorage stale-while-revalidate (SWR) cache.
 *
 * Pattern: show cached data instantly on page load, then background-fetch
 * from the API and update only if the response differs.  Eliminates loading
 * spinners and fallback flashes for data that rarely changes.
 *
 * Each cache entry is stored under a unique localStorage key with an optional
 * max-size guard (to avoid bloating storage for large payloads like KB file lists).
 */

const KEY_PREFIX = 'numa_swr_';

/** All known SWR cache keys — used by clearAllSwrCaches(). */
const REGISTERED_KEYS: string[] = [];

function fullKey(name: string): string {
  return `${KEY_PREFIX}${name}`;
}

function register(name: string): string {
  const key = fullKey(name);
  if (!REGISTERED_KEYS.includes(key)) {
    REGISTERED_KEYS.push(key);
  }
  return key;
}

/**
 * Read a cached value from localStorage.
 * Returns null if absent, corrupt, or localStorage is unavailable.
 */
export function getSwrCache<T>(name: string): T | null {
  try {
    const raw = localStorage.getItem(fullKey(name));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Write a value to the localStorage SWR cache.
 *
 * @param name   - Cache key name (without prefix)
 * @param data   - The value to cache (must be JSON-serializable)
 * @param maxBytes - Optional max size in bytes. If the serialized JSON exceeds
 *                   this limit the write is skipped (protects against very large
 *                   KB file lists etc. filling localStorage).
 */
export function setSwrCache<T>(name: string, data: T, maxBytes?: number): void {
  try {
    const key = register(name);
    const json = JSON.stringify(data);
    if (maxBytes && json.length > maxBytes) {
      return; // Too large — skip caching silently.
    }
    localStorage.setItem(key, json);
  } catch {
    // Storage full or unavailable — non-critical.
  }
}

/** Remove a single SWR cache entry. */
export function clearSwrCache(name: string): void {
  try {
    localStorage.removeItem(fullKey(name));
  } catch {
    // Non-critical.
  }
}

/**
 * Clear ALL SWR caches. Call this on logout to prevent stale data
 * from leaking across user sessions.
 */
export function clearAllSwrCaches(): void {
  try {
    // Clear registered keys
    for (const key of REGISTERED_KEYS) {
      localStorage.removeItem(key);
    }
    // Also sweep any keys matching the prefix (covers keys registered
    // in previous page loads that aren't in the current REGISTERED_KEYS).
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(KEY_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Non-critical.
  }
}
