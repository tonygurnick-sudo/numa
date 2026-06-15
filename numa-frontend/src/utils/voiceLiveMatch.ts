/**
 * Numa Voice — FEAT-168 live transcript keyword matching (sidebar Stage 1).
 *
 * Pure matcher: given realtime Contact Lens transcript segments and the active
 * playbook panel's objections, pick the objection whose keyword was heard most
 * RECENTLY (the SDR needs help with what the prospect just said, not what came
 * up five minutes ago). Ties on position break by total hit count.
 */

import type { PlaybookObjection } from '../types/voice';

export interface LiveTranscriptSegment {
  /** Contact Lens participant role (AGENT / CUSTOMER / UNKNOWN). */
  participant: string;
  text: string;
}

/**
 * Index of the best-matching objection, or null when nothing matches.
 *
 * Only CUSTOMER utterances are searched — objections come from the prospect;
 * matching the SDR's own scripted lines (which quote objections back) would
 * self-trigger suggestions. Falls back to ALL text when no segment carries a
 * CUSTOMER role (e.g. diarisation-less transcripts) so the feature still works.
 */
export function matchObjection(segments: LiveTranscriptSegment[], objections: PlaybookObjection[]): number | null {
  if (segments.length === 0 || objections.length === 0) return null;
  const customerSegments = segments.filter((s) => s.participant?.toUpperCase() === 'CUSTOMER');
  const searched = (customerSegments.length > 0 ? customerSegments : segments)
    .map((s) => s.text)
    .join('\n')
    .toLowerCase();
  if (!searched.trim()) return null;

  let best: { index: number; lastPosition: number; hits: number } | null = null;
  for (let i = 0; i < objections.length; i += 1) {
    const keywords = objections[i].keywords ?? [];
    let lastPosition = -1;
    let hits = 0;
    for (const raw of keywords) {
      const keyword = raw.trim().toLowerCase();
      if (!keyword) continue;
      let from = 0;
      for (;;) {
        const at = searched.indexOf(keyword, from);
        if (at === -1) break;
        hits += 1;
        if (at > lastPosition) lastPosition = at;
        from = at + keyword.length;
      }
    }
    if (hits === 0) continue;
    if (!best || lastPosition > best.lastPosition || (lastPosition === best.lastPosition && hits > best.hits)) {
      best = { index: i, lastPosition, hits };
    }
  }
  return best ? best.index : null;
}
