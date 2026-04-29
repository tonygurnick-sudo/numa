import { GetIdToken } from './workspaceChatAgentService';
import { getSwrCache, setSwrCache, clearSwrCache } from '@/utils/swrCache';

const API_BASE = '/api/workspace-chat-agent';

// v2 prefix — invalidates older single-shape caches that lack `conversations`/`cachedAt`.
const CACHE_KEY_PREFIX = 'chatArtifactsV2_';
const CACHE_MAX_BYTES = 1_000_000;
/** Cache is considered fresh for 5 minutes — within that window we skip the network entirely. */
export const CHAT_ARTIFACTS_CACHE_TTL_MS = 5 * 60 * 1000;

export interface ChatArtifact {
  conversationId: string;
  key: string;
  relPath: string;
  name: string;
  size: number;
  /** ISO 8601 timestamp from S3 LastModified, or null if unavailable. */
  lastModified: string | null;
}

export interface ListChatArtifactsResponse {
  artifacts: ChatArtifact[];
  truncated: boolean;
}

/** Lite snapshot of a conversation — title + last-updated, enough to render rows from cache. */
export interface CachedConversationMeta {
  title: string | null;
  latestTimestamp: number;
}

export interface CachedChatArtifactsPayload {
  artifacts: ChatArtifact[];
  truncated: boolean;
  /** Map of conversationId → meta. Cached alongside artifacts so titles/order render instantly. */
  conversations: Record<string, CachedConversationMeta>;
  /** Epoch ms when this snapshot was written. Used for TTL freshness check. */
  cachedAt: number;
}

async function getAuthHeaders(getIdToken?: GetIdToken): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const idToken = getIdToken ? await getIdToken() : localStorage.getItem('idToken');
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }
  return headers;
}

function cacheKey(userSub: string): string {
  return `${CACHE_KEY_PREFIX}${userSub}`;
}

export function getCachedChatArtifacts(userSub: string): CachedChatArtifactsPayload | null {
  const raw = getSwrCache<unknown>(cacheKey(userSub));
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<CachedChatArtifactsPayload>;
  if (
    !Array.isArray(c.artifacts) ||
    !c.conversations ||
    typeof c.conversations !== 'object' ||
    typeof c.cachedAt !== 'number'
  ) {
    // Wrong-shape cache (likely a stale build) — drop it and bail.
    clearSwrCache(cacheKey(userSub));
    return null;
  }
  return c as CachedChatArtifactsPayload;
}

export function setCachedChatArtifacts(userSub: string, payload: CachedChatArtifactsPayload): void {
  setSwrCache(cacheKey(userSub), payload, CACHE_MAX_BYTES);
}

export function clearCachedChatArtifacts(userSub: string): void {
  clearSwrCache(cacheKey(userSub));
}

/**
 * Returns true when the cached payload is younger than the TTL window.
 * Used to decide whether to skip the network revalidation on mount.
 */
export function isCacheFresh(
  cached: CachedChatArtifactsPayload | null,
  ttlMs: number = CHAT_ARTIFACTS_CACHE_TTL_MS
): boolean {
  if (!cached || typeof cached.cachedAt !== 'number') return false;
  return Date.now() - cached.cachedAt < ttlMs;
}

export async function listChatArtifacts(getIdToken?: GetIdToken): Promise<ListChatArtifactsResponse> {
  const res = await fetch(`${API_BASE}/artifacts`, {
    headers: await getAuthHeaders(getIdToken),
  });

  if (!res.ok) {
    throw new Error(`Failed to list chat artifacts: ${res.status}`);
  }

  return (await res.json()) as ListChatArtifactsResponse;
}
