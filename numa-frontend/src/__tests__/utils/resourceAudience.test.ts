import { describe, it, expect } from 'vitest';
import { audienceMatches, isAudienceActive, type ResourceAudience } from '../../utils/resourceAudience';

const audience = (personas: string[] = [], industries: string[] = []): ResourceAudience => ({ personas, industries });

describe('audienceMatches', () => {
  it('shows everything when the user has no selection', () => {
    const a = audience();
    expect(audienceMatches({ personas: ['Finance'], industries: ['Manufacturing'] }, a)).toBe(true);
    expect(audienceMatches({ personas: [], industries: [] }, a)).toBe(true);
  });

  it('keeps untagged resources visible to all', () => {
    const a = audience(['Finance'], ['Manufacturing']);
    expect(audienceMatches({}, a)).toBe(true);
    expect(audienceMatches({ personas: [], industries: [] }, a)).toBe(true);
  });

  it('matches when persona intersects (no industry tags)', () => {
    const a = audience(['Finance']);
    expect(audienceMatches({ personas: ['Finance', 'HR'] }, a)).toBe(true);
    expect(audienceMatches({ personas: ['HR'] }, a)).toBe(false);
  });

  it('matches when industry intersects (no persona tags)', () => {
    const a = audience([], ['Manufacturing']);
    expect(audienceMatches({ industries: ['Manufacturing'] }, a)).toBe(true);
    expect(audienceMatches({ industries: ['Construction'] }, a)).toBe(false);
  });

  it('treats persona and industry as independent AND-ed gates', () => {
    const a = audience(['Finance'], ['Manufacturing']);
    // matches both
    expect(audienceMatches({ personas: ['Finance'], industries: ['Manufacturing'] }, a)).toBe(true);
    // persona matches, industry does not → hidden
    expect(audienceMatches({ personas: ['Finance'], industries: ['Construction'] }, a)).toBe(false);
    // industry matches, persona does not → hidden
    expect(audienceMatches({ personas: ['HR'], industries: ['Manufacturing'] }, a)).toBe(false);
    // persona tagged + matches, industry untagged → visible (industry axis passes)
    expect(audienceMatches({ personas: ['Finance'] }, a)).toBe(true);
  });

  it('matches on any overlap for multi-value selections', () => {
    const a = audience(['Finance', 'Operations'], ['Manufacturing', 'Franchise']);
    expect(audienceMatches({ personas: ['Operations'], industries: ['Franchise'] }, a)).toBe(true);
    expect(audienceMatches({ personas: ['CEO'], industries: ['Construction'] }, a)).toBe(false);
  });
});

describe('isAudienceActive', () => {
  it('is false only when both axes are empty', () => {
    expect(isAudienceActive(audience())).toBe(false);
    expect(isAudienceActive(audience(['Finance']))).toBe(true);
    expect(isAudienceActive(audience([], ['Manufacturing']))).toBe(true);
  });
});
