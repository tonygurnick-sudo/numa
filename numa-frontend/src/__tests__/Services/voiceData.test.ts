import { describe, it, expect } from 'vitest';
import { isNoSuchKey, TODAY_CALLS_KEY, MASTER_PROSPECTS_KEY, PLAYBOOK_KEY } from '../../Services/voiceData';

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
