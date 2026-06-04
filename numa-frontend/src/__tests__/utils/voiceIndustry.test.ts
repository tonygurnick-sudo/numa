import { describe, it, expect } from 'vitest';
import { inferIndustry, normalizeIndustry, DEFAULT_INDUSTRY, INDUSTRY_KEYWORDS } from '../../utils/voiceIndustry';

describe('normalizeIndustry', () => {
  it('passes through a known slug (case/space-insensitive)', () => {
    expect(normalizeIndustry('Construction')).toBe('construction');
    expect(normalizeIndustry('  healthcare ')).toBe('healthcare');
    expect(normalizeIndustry('general')).toBe('general');
  });

  it('collapses a synonym keyword onto its canonical slug', () => {
    expect(normalizeIndustry('builder')).toBe('construction');
    expect(normalizeIndustry('lawyer')).toBe('professional');
  });

  it('returns empty string for unknown / blank values', () => {
    expect(normalizeIndustry('')).toBe('');
    expect(normalizeIndustry('   ')).toBe('');
    expect(normalizeIndustry('underwater basket weaving')).toBe('');
    expect(normalizeIndustry(undefined)).toBe('');
  });
});

describe('inferIndustry', () => {
  it('prefers an explicit known industry over the description', () => {
    expect(inferIndustry('a software company', 'construction')).toBe('construction');
  });

  it('infers from the description via keyword hits when no explicit industry', () => {
    expect(inferIndustry('Commercial building and civil construction contractor')).toBe('construction');
    expect(inferIndustry('Boutique law firm and legal advisory')).toBe('professional');
    expect(inferIndustry('SaaS platform for data teams')).toBe('technology');
  });

  it('picks the industry with the MOST keyword hits', () => {
    // "engineering" + "mechanical" + "fabrication" (3) beats a single "building" (construction).
    expect(inferIndustry('Mechanical engineering and fabrication for building sites')).toBe('engineering');
  });

  it('is deterministic — same input always yields the same slug', () => {
    const text = 'Dental clinic and medical pharmacy group';
    expect(inferIndustry(text)).toBe(inferIndustry(text));
    expect(inferIndustry(text)).toBe('healthcare');
  });

  it('falls back to the default industry when nothing matches or input is blank', () => {
    expect(inferIndustry('')).toBe(DEFAULT_INDUSTRY);
    expect(inferIndustry('a quiet little business')).toBe(DEFAULT_INDUSTRY);
    expect(inferIndustry(undefined, undefined)).toBe(DEFAULT_INDUSTRY);
  });

  it('keeps the keyword map non-empty for every slug (guards accidental deletion)', () => {
    for (const [slug, kws] of Object.entries(INDUSTRY_KEYWORDS)) {
      expect(kws.length, `${slug} must have keywords`).toBeGreaterThan(0);
    }
  });
});
