export const COMPANY_KB_ID = 'company';
export const NUMA_SUPPORT_KB_ID = 'numa-support';
export const SHAREPOINT_KB_ID = 'sharepoint';
// Cross-job Synergy (12d) corpus — system-managed, auto-populated by the Synergy
// KB crawler. Selectable in the chat KB picker but hidden from the Files/Folders
// management page (it has no per-file management surface).
export const SYNERGY_KB_ID = 'synergy';
export const SYSTEM_KB_IDS = new Set<string>([COMPANY_KB_ID, NUMA_SUPPORT_KB_ID, SHAREPOINT_KB_ID, SYNERGY_KB_ID]);

/**
 * Sentinel value used in persisted chat-settings `defaultKBIds` to mean
 * "this user's My Files KB". The actual kb_id (the user's Cognito sub) is
 * unknown at module-load time, so the sentinel is expanded against the
 * current user when defaults are applied.
 */
export const MY_FILES_SENTINEL = '__my_files__';

/** Sort KBs: My Files first, then company, then sharepoint, then support, then user KBs. */
export function sortKnowledgeBases<T extends { kb_id: string; is_root?: boolean }>(kbs: T[]): T[] {
  const order: Record<string, number> = {
    [COMPANY_KB_ID]: 1,
    [SHAREPOINT_KB_ID]: 2,
    [SYNERGY_KB_ID]: 3,
    [NUMA_SUPPORT_KB_ID]: 4,
  };
  return [...kbs].sort((a, b) => {
    const aRank = a.is_root ? 0 : (order[a.kb_id] ?? 5);
    const bRank = b.is_root ? 0 : (order[b.kb_id] ?? 5);
    return aRank - bRank;
  });
}

export function isSystemKnowledgeBase(kbId: string | null | undefined): boolean {
  if (typeof kbId !== 'string') {
    return false;
  }
  const normalized = kbId.trim();
  return normalized.length > 0 && SYSTEM_KB_IDS.has(normalized);
}

/**
 * Check if a KB represents the user's root files.
 * Root KBs use the user's Cognito sub as the kb_id.
 */
export function isRootKB(kbId: string, userSub: string): boolean {
  return Boolean(kbId && userSub && kbId === userSub);
}

/** Get the root KB ID for a user (same as their Cognito sub). */
export function getRootKBId(userSub: string): string {
  return userSub;
}

/**
 * Expand the My Files sentinel in a list of KB ids to the user's actual
 * Cognito sub. Pass-through for any other id. Returns a new array.
 */
export function expandMyFilesSentinel(ids: string[], userSub: string | null | undefined): string[] {
  if (!userSub) return ids.filter((id) => id !== MY_FILES_SENTINEL);
  return ids.map((id) => (id === MY_FILES_SENTINEL ? userSub : id));
}
