import { describe, it, expect } from 'vitest';
import {
  isNoSuchKey,
  normalizePhone,
  normalizeTodayCalls,
  sanitizeProspect,
  TODAY_CALLS_KEY,
  MASTER_PROSPECTS_KEY,
  PLAYBOOK_KEY,
} from '../../Services/voiceData';

/**
 * These keys are the producer/consumer contract shared across Numa Voice:
 * numa-voice-processor / numa-voice-intake / the seeded scheduled agents all
 * read+write the same `documents/company/` (company KB root) paths via numa_files.
 * A drift here is a silent no-op in production, so pin them.
 */
describe('voiceData S3 key contract', () => {
  it('reads voice working files from the company KB root', () => {
    expect(TODAY_CALLS_KEY).toBe('documents/company/today_calls.json');
    expect(MASTER_PROSPECTS_KEY).toBe('documents/company/master_prospects.json');
    expect(PLAYBOOK_KEY).toBe('documents/company/sdr_playbook.json');
  });
});

describe('isNoSuchKey', () => {
  it('treats NoSuchKey / NotFound as missing (so reads degrade to empty)', () => {
    expect(isNoSuchKey({ name: 'NoSuchKey' })).toBe(true);
    expect(isNoSuchKey({ name: 'NotFound' })).toBe(true);
    expect(isNoSuchKey({ Code: 'NoSuchKey' })).toBe(true);
  });

  it('treats a 404 $metadata status as missing (SDK v3 error-shape variance)', () => {
    expect(isNoSuchKey({ $metadata: { httpStatusCode: 404 } })).toBe(true);
  });

  it('does NOT treat AccessDenied as missing — a permission failure must surface', () => {
    expect(isNoSuchKey({ name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })).toBe(false);
    expect(isNoSuchKey({ Code: 'AccessDenied' })).toBe(false);
  });

  it('is false for non-error / non-object inputs', () => {
    expect(isNoSuchKey(null)).toBe(false);
    expect(isNoSuchKey(undefined)).toBe(false);
    expect(isNoSuchKey('NoSuchKey')).toBe(false);
    expect(isNoSuchKey({})).toBe(false);
  });
});

describe('normalizePhone', () => {
  it('strips spacing and punctuation from an already-international number', () => {
    expect(normalizePhone('+64 21 677 460')).toBe('+6421677460');
    expect(normalizePhone('+1 (415) 555-0123')).toBe('+14155550123');
  });

  it('converts a leading 00 international prefix to +', () => {
    expect(normalizePhone('0064 21 677 460')).toBe('+6421677460');
  });

  it('does NOT guess a country code for a bare local number (stays non-E.164)', () => {
    // We must not invent a country — a local number stays local and is surfaced
    // as not-diallable in the UI rather than dialled under an assumed country.
    expect(normalizePhone('021677460')).toBe('021677460');
  });

  it('returns empty string for empty / non-string input', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('   ')).toBe('');
    expect(normalizePhone(undefined)).toBe('');
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(42)).toBe('');
  });
});

describe('sanitizeProspect', () => {
  it('maps the canonical Prospect contract straight through (trimming strings)', () => {
    const p = sanitizeProspect({
      company_name: ' Acme Ltd ',
      contact_name: 'Jane Doe',
      phone: '+6421000000',
    });
    expect(p.company_name).toBe('Acme Ltd');
    expect(p.contact_name).toBe('Jane Doe');
    expect(p.phone).toBe('+6421000000');
  });

  it('tolerates common producer field-name drift (prospect_name/prospect_phone/company)', () => {
    // Exactly the shape the chat agent wrote that rendered blank before hardening.
    const p = sanitizeProspect({
      prospect_name: 'Tony Test',
      prospect_phone: '+64 21 677 460',
      company: 'Test Co',
    });
    expect(p.contact_name).toBe('Tony Test');
    expect(p.phone).toBe('+6421677460');
    expect(p.company_name).toBe('Test Co');
  });

  it('prefers the canonical field over an alias when both are present', () => {
    const p = sanitizeProspect({ contact_name: 'Canonical', prospect_name: 'Alias' });
    expect(p.contact_name).toBe('Canonical');
  });

  it('preserves passthrough optional fields and defaults missing required strings to ""', () => {
    const p = sanitizeProspect({ contact_name: 'Solo', status: 'pending', qualified: true });
    expect(p.company_name).toBe('');
    expect(p.industry).toBe('');
    expect(p.status).toBe('pending');
    expect(p.qualified).toBe(true);
  });

  // FEAT-165: the post-call processor writes structured outcome fields rather
  // than folding everything into call_summary. Validate they survive sanitise.
  it('keeps the structured post-call fields (objections/next_steps/rating/justification/talking-points)', () => {
    const p = sanitizeProspect({
      contact_name: 'Lead',
      objections: ['  too expensive ', 'no budget'],
      next_steps: ['send pricing'],
      call_quality_rating: 4,
      call_quality_justification: '  good rapport, clear next step ',
      follow_up_talking_points: ['ROI case study', 'integration timeline'],
    });
    expect(p.objections).toEqual(['too expensive', 'no budget']);
    expect(p.next_steps).toEqual(['send pricing']);
    expect(p.call_quality_rating).toBe(4);
    expect(p.call_quality_justification).toBe('good rapport, clear next step');
    expect(p.follow_up_talking_points).toEqual(['ROI case study', 'integration timeline']);
  });

  it('drops a malformed call_quality_rating (out of 1-5 range, or non-number)', () => {
    expect(sanitizeProspect({ contact_name: 'A', call_quality_rating: 0 }).call_quality_rating).toBeUndefined();
    expect(sanitizeProspect({ contact_name: 'A', call_quality_rating: 6 }).call_quality_rating).toBeUndefined();
    expect(sanitizeProspect({ contact_name: 'A', call_quality_rating: '4' }).call_quality_rating).toBeUndefined();
  });

  it('drops empty / non-array structured fields rather than emitting [] or junk', () => {
    const p = sanitizeProspect({
      contact_name: 'A',
      objections: [],
      next_steps: 'not an array',
      follow_up_talking_points: ['  ', ''],
    });
    expect(p.objections).toBeUndefined();
    expect(p.next_steps).toBeUndefined();
    expect(p.follow_up_talking_points).toBeUndefined();
  });
});

describe('normalizeTodayCalls', () => {
  it('reads the canonical wrapper { calls: [...] }', () => {
    const out = normalizeTodayCalls({
      generated_at: '2026-06-02T00:00:00Z',
      calls: [{ company_name: 'Arcanum', contact_name: 'Nathan', phone: '+61422946076' }],
    });
    expect(out.calls).toHaveLength(1);
    expect(out.calls[0].contact_name).toBe('Nathan');
  });

  it('reads a BARE top-level array — the shape that previously blanked the whole list', () => {
    const out = normalizeTodayCalls([{ company_name: 'Arcanum', contact_name: 'Nathan', phone: '+61422946076' }]);
    expect(out.calls).toHaveLength(1);
    expect(out.calls[0].phone).toBe('+61422946076');
  });

  it('recovers the EXACT broken today_calls.json from production (bare array: orphan voicemail + Nathan)', () => {
    // Verbatim shape that was live on the stack: a bare array whose first record
    // is an identity-less "voicemail" row with drifted field names, second is Nathan.
    const broken = [
      {
        contact_id: 'ec8e36f8-7bce-4c14-9867-fc9b0ae2f6f4',
        prospect_phone: '',
        status: 'voicemail',
        sdr_outcome: '',
        call_summary: 'reached voicemail',
      },
      {
        company_name: 'Arcanum',
        contact_name: 'Nathan',
        phone: '+61422946076',
        status: 'pending',
      },
    ];
    const out = normalizeTodayCalls(broken);
    // Orphan (no company/contact/phone) dropped; Nathan rendered + diallable.
    expect(out.calls).toHaveLength(1);
    expect(out.calls[0].company_name).toBe('Arcanum');
    expect(out.calls[0].contact_name).toBe('Nathan');
    expect(out.calls[0].phone).toBe('+61422946076');
  });

  it('also salvages a bare array written with drifted field names (prospect_name/prospect_phone)', () => {
    const out = normalizeTodayCalls([
      { prospect_name: 'Nathan', prospect_phone: '+61 422 946 076', company: 'Arcanum' },
    ]);
    expect(out.calls).toHaveLength(1);
    expect(out.calls[0].contact_name).toBe('Nathan');
    expect(out.calls[0].phone).toBe('+61422946076');
  });

  it('returns an empty list for null / garbage / { calls: <not-an-array> }', () => {
    expect(normalizeTodayCalls(null).calls).toEqual([]);
    expect(normalizeTodayCalls('nope').calls).toEqual([]);
    expect(normalizeTodayCalls({ calls: 'oops' }).calls).toEqual([]);
  });
});
