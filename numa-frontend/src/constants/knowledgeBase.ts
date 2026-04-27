export const COMPANY_KB_ID = 'company';
export const NUMA_SUPPORT_KB_ID = 'numa-support';
export const SYSTEM_KB_IDS = new Set<string>([COMPANY_KB_ID, NUMA_SUPPORT_KB_ID]);

/** Sort KBs: company first, support second, user KBs after. */
export function sortKnowledgeBases<T extends { kb_id: string }>(kbs: T[]): T[] {
  const order: Record<string, number> = { [COMPANY_KB_ID]: 0, [NUMA_SUPPORT_KB_ID]: 1 };
  return [...kbs].sort((a, b) => (order[a.kb_id] ?? 2) - (order[b.kb_id] ?? 2));
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
