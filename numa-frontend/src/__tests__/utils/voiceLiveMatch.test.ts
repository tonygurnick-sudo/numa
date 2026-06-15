import { describe, it, expect } from 'vitest';
import { matchObjection } from '../../utils/voiceLiveMatch';
import type { PlaybookObjection } from '../../types/voice';

const OBJECTIONS: PlaybookObjection[] = [
  { label: 'Too expensive', response: 'Value framing…', keywords: ['expensive', 'cost', 'budget'] },
  { label: 'Already have a tool', response: 'Differentiate…', keywords: ['already use', 'existing tool'] },
  { label: 'No time', response: 'Time framing…', keywords: ['busy', 'no time'] },
];

const seg = (participant: string, text: string) => ({ participant, text });

describe('matchObjection (FEAT-168 live keyword matching)', () => {
  it('returns null with no segments, no objections, or no keyword hits', () => {
    expect(matchObjection([], OBJECTIONS)).toBeNull();
    expect(matchObjection([seg('CUSTOMER', 'hello there')], [])).toBeNull();
    expect(matchObjection([seg('CUSTOMER', 'nice weather today')], OBJECTIONS)).toBeNull();
  });

  it('matches a keyword in customer speech, case-insensitively', () => {
    expect(matchObjection([seg('CUSTOMER', 'Honestly this sounds EXPENSIVE to me')], OBJECTIONS)).toBe(0);
  });

  it('prefers the most RECENTLY heard objection over an earlier one', () => {
    const segments = [
      seg('CUSTOMER', 'the cost worries me'), // objection 0
      seg('AGENT', 'totally understand'),
      seg('CUSTOMER', 'and we are really busy right now'), // objection 2, later
    ];
    expect(matchObjection(segments, OBJECTIONS)).toBe(2);
  });

  it('ignores the agent quoting an objection when customer speech exists', () => {
    const segments = [
      seg('AGENT', 'most people say it is too expensive at first'),
      seg('CUSTOMER', 'we already use an existing tool for this'),
    ];
    expect(matchObjection(segments, OBJECTIONS)).toBe(1);
  });

  it('falls back to all speech when no segment has a CUSTOMER role', () => {
    expect(matchObjection([seg('UNKNOWN', 'budget is tight this quarter')], OBJECTIONS)).toBe(0);
  });

  it('handles empty/whitespace keywords without matching everything', () => {
    const withBlank: PlaybookObjection[] = [{ label: 'x', response: 'y', keywords: ['', '  '] }];
    expect(matchObjection([seg('CUSTOMER', 'anything at all')], withBlank)).toBeNull();
  });
});
