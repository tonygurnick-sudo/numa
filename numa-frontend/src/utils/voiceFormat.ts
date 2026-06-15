/**
 * Numa Voice — shared formatting helpers.
 *
 * Small, dependency-free formatters used across the Voice cockpit (the focus
 * call card's live timer and the post-call wrap-up duration display). Kept here
 * so both components share one implementation rather than each carrying a copy.
 */

/** Format a duration in seconds as mm:ss (e.g. 95 → "1:35"). */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** True when the timestamp parses and falls before the start of the local
 *  calendar day — i.e. the morning Call List Preparer has not run today
 *  (FEAT-164 freshness chip in VoiceProgressHeader). */
export function isListStale(generatedAt: string | undefined, now: Date): boolean {
  if (!generatedAt) return false;
  const generated = new Date(generatedAt);
  if (Number.isNaN(generated.getTime())) return false;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return generated < startOfToday;
}
