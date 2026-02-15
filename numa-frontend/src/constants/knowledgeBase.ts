export const COMPANY_KB_ID = 'company';
export const NUMA_SUPPORT_KB_ID = 'numa-support';
export const SYSTEM_KB_IDS = new Set<string>([COMPANY_KB_ID, NUMA_SUPPORT_KB_ID]);

export function isSystemKnowledgeBase(kbId: string | null | undefined): boolean {
  if (typeof kbId !== 'string') {
    return false;
  }
  const normalized = kbId.trim();
  return normalized.length > 0 && SYSTEM_KB_IDS.has(normalized);
}
