/**
 * Numa Voice — deterministic industry inference (FEAT-167).
 *
 * The prospect-ingest agent infers a missing `industry` from the company
 * description using keyword matching. That inference is LLM-driven and therefore
 * non-reproducible; this module is the deterministic, auditable mirror of the same
 * rule. The frontend uses it to resolve the SDR-assist playbook panel when a
 * prospect record has no (or an unrecognised) industry, and the ingest agent's
 * prompt documents the SAME keyword map so its output matches this.
 *
 * Keep `INDUSTRY_KEYWORDS` in lockstep with:
 *   - the playbook industry slugs in sdr_playbook.json, and
 *   - the keyword rule embedded in INGEST_PROMPT (lambdas/node/seed-voice-agents/seed-data.ts).
 */

/** The industry slug used when nothing matches — must exist in the playbook. */
export const DEFAULT_INDUSTRY = 'general';

/**
 * Industry slug → lower-case keyword fragments that imply it. Order matters only
 * for documentation; matching counts hits across all industries and picks the
 * highest (ties broken by the order of this object's keys, i.e. first wins).
 */
export const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  construction: ['construction', 'builder', 'building', 'contractor', 'civil', 'infrastructure', 'roading', 'concrete'],
  engineering: ['engineering', 'engineer', 'mechanical', 'electrical', 'fabrication', 'manufacturing', 'industrial'],
  consulting: ['consulting', 'consultant', 'advisory', 'advisor', 'strategy'],
  professional: ['accounting', 'accountant', 'law', 'legal', 'lawyer', 'solicitor', 'architect', 'surveyor', 'finance'],
  healthcare: ['health', 'healthcare', 'medical', 'clinic', 'dental', 'pharmacy', 'aged care', 'hospital'],
  technology: ['software', 'saas', 'technology', 'it services', 'tech', 'platform', 'data', 'cyber'],
  property: ['property', 'real estate', 'realty', 'realtor', 'leasing', 'facilities'],
  retail: ['retail', 'ecommerce', 'e-commerce', 'store', 'shop', 'wholesale', 'distribution'],
  hospitality: ['hospitality', 'hotel', 'restaurant', 'cafe', 'catering', 'tourism', 'accommodation'],
};

/** Normalise a free-text industry value to a known playbook slug, or '' if none. */
export function normalizeIndustry(industry: string | undefined | null): string {
  const slug = (industry ?? '').trim().toLowerCase();
  if (!slug) return '';
  if (slug in INDUSTRY_KEYWORDS || slug === DEFAULT_INDUSTRY) return slug;
  // Allow common synonyms to collapse onto a canonical slug via the keyword map.
  for (const [canonical, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (keywords.some((kw) => slug === kw.trim())) return canonical;
  }
  return '';
}

/**
 * Deterministically infer an industry slug from a company description (and an
 * optional explicit industry, which always wins when it's a known slug). Returns
 * `DEFAULT_INDUSTRY` when nothing matches — never throws, never guesses a country.
 */
export function inferIndustry(companyDescription: string | undefined | null, explicitIndustry?: string | null): string {
  const explicit = normalizeIndustry(explicitIndustry);
  if (explicit) return explicit;

  const text = (companyDescription ?? '').toLowerCase();
  if (!text.trim()) return DEFAULT_INDUSTRY;

  let best = DEFAULT_INDUSTRY;
  let bestHits = 0;
  for (const [slug, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    // Whole-word matching so an overlapping keyword (e.g. "advisor" inside
    // "advisory") isn't double-counted and doesn't skew the winner.
    const hits = keywords.reduce((n, kw) => (matchesWholeWord(text, kw) ? n + 1 : n), 0);
    if (hits > bestHits) {
      bestHits = hits;
      best = slug;
    }
  }
  return best;
}

/** Escape a keyword for safe use in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `keyword` appears as a whole word/phrase in (already-lowercased) `text`. */
function matchesWholeWord(text: string, keyword: string): boolean {
  return new RegExp(`\\b${escapeRegExp(keyword)}\\b`).test(text);
}
