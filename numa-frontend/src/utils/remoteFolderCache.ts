/**
 * LRU cache for remote folder contents (OAuth + Synergy providers).
 *
 * Two-tier store: fast in-memory Map + durable sessionStorage backup.
 * Survives re-renders AND page reloads within the same browser tab.
 * Pure functions, no React dependency, following project conventions.
 *
 * Key format: `{source}:{folderId}`
 *   OAuth:   `oauth:{provider}:{folderId}` e.g. `oauth:google_drive:root`
 *   Synergy: `synergy:jobs`, `synergy:job:{jobId}`, `synergy:folder:{folderId}`
 */

import type { OAuthFolder, OAuthFile } from '../types/oauthProviders';
import type { SynergyFolder, SynergyFile, SynergyJob } from '../types/synergySync';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RemoteFolderData {
  folders: OAuthFolder[] | SynergyFolder[];
  files: OAuthFile[] | SynergyFile[];
}

export interface RemoteJobsData {
  jobs: SynergyJob[];
}

type CachePayload = RemoteFolderData | RemoteJobsData;

interface CacheEntry {
  data: CachePayload;
  timestamp: number;
  lastAccessed: number;
}

export interface CacheResult<T = CachePayload> {
  data: T;
  stale: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const STALE_RATIO = 0.8; // stale after 80% of TTL (8 minutes)
const MAX_ENTRIES = 200;
const STORAGE_PREFIX = 'remoteBrowse:';

// ---------------------------------------------------------------------------
// Store (two-tier: memory + sessionStorage)
// ---------------------------------------------------------------------------

const memStore = new Map<string, CacheEntry>();

// Stats (for debugging)
let hits = 0;
let misses = 0;

// ---------------------------------------------------------------------------
// sessionStorage helpers
// ---------------------------------------------------------------------------

const storageKey = (key: string): string => `${STORAGE_PREFIX}${key}`;

const writeToStorage = (key: string, entry: CacheEntry): void => {
  try {
    sessionStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    // Storage full or unavailable — memory-only is fine
  }
};

const readFromStorage = (key: string): CacheEntry | null => {
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
};

const removeFromStorage = (key: string): void => {
  try {
    sessionStorage.removeItem(storageKey(key));
  } catch {
    // Ignore
  }
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const isExpired = (entry: CacheEntry, ttlMs = CACHE_TTL): boolean => Date.now() - entry.timestamp > ttlMs;

const isStale = (entry: CacheEntry, ttlMs = CACHE_TTL): boolean => Date.now() - entry.timestamp > ttlMs * STALE_RATIO;

/** Evict the least-recently-accessed entry from both tiers. */
const evictLRU = (): void => {
  let oldestKey: string | null = null;
  let oldestTime = Infinity;

  for (const [key, entry] of memStore) {
    if (entry.lastAccessed < oldestTime) {
      oldestTime = entry.lastAccessed;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    memStore.delete(oldestKey);
    removeFromStorage(oldestKey);
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve cached folder contents. Returns null on miss.
 * Checks memory first, then falls back to sessionStorage.
 * Bumps `lastAccessed` for LRU tracking.
 */
export const getRemoteFolder = <T extends CachePayload = RemoteFolderData>(
  key: string,
  ttlMs?: number
): CacheResult<T> | null => {
  let entry = memStore.get(key) ?? null;

  // Memory miss — try sessionStorage
  if (!entry) {
    entry = readFromStorage(key);
    if (entry) {
      // Re-populate memory tier
      memStore.set(key, entry);
    }
  }

  if (!entry) {
    misses++;
    return null;
  }

  // Hard-expired entries are evicted from both tiers
  if (isExpired(entry, ttlMs)) {
    memStore.delete(key);
    removeFromStorage(key);
    misses++;
    return null;
  }

  // Bump LRU
  entry.lastAccessed = Date.now();
  hits++;

  return {
    data: entry.data as T,
    stale: isStale(entry, ttlMs),
  };
};

/**
 * Store folder contents in both memory and sessionStorage.
 * Evicts LRU when over capacity.
 */
export const setRemoteFolder = (key: string, data: CachePayload): void => {
  const now = Date.now();
  const entry: CacheEntry = { data, timestamp: now, lastAccessed: now };

  // If already exists, just update
  if (memStore.has(key)) {
    memStore.set(key, entry);
    writeToStorage(key, entry);
    return;
  }

  // Evict if at capacity
  while (memStore.size >= MAX_ENTRIES) {
    evictLRU();
  }

  memStore.set(key, entry);
  writeToStorage(key, entry);
};

/**
 * Remove all entries whose key starts with the given prefix.
 * Useful when disconnecting a provider or refreshing connection.
 */
export const invalidateProvider = (sourcePrefix: string): void => {
  for (const key of Array.from(memStore.keys())) {
    if (key.startsWith(sourcePrefix)) {
      memStore.delete(key);
      removeFromStorage(key);
    }
  }
};

/** Clear the entire cache (both tiers). */
export const invalidateAll = (): void => {
  memStore.clear();
  hits = 0;
  misses = 0;

  // Clear all remoteBrowse: keys from sessionStorage
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(STORAGE_PREFIX)) keysToRemove.push(k);
    }
    for (const k of keysToRemove) sessionStorage.removeItem(k);
  } catch {
    // Ignore
  }
};

/** Debug helper — returns cache size and hit rate. */
export const getCacheStats = (): { size: number; hitRate: number } => {
  const total = hits + misses;
  return {
    size: memStore.size,
    hitRate: total === 0 ? 0 : hits / total,
  };
};

// ---------------------------------------------------------------------------
// Cache key builders (keep key format consistent)
// ---------------------------------------------------------------------------

export const oauthCacheKey = (provider: string, folderId?: string): string => `oauth:${provider}:${folderId ?? 'root'}`;

export const synergyCacheKey = {
  jobs: (): string => 'synergy:jobs',
  jobFolders: (jobId: string): string => `synergy:job:${jobId}`,
  folder: (folderId: string): string => `synergy:folder:${folderId}`,
};
