import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

describe('placeholder', () => {
  it('passes', () => {
    assert.ok(true);
  });
});

/**
 * Pins the index's nonFilterableMetadataKeys.
 *
 * S3 Vectors caps FILTERABLE metadata at 2 KB/vector and allows at most 10 NON-filterable
 * keys per index, and nonFilterableMetadataKeys is IMMUTABLE after index creation. The 5
 * synergy display-only keys (job_name/job_path/file_name/file_path/source_weblink) MUST
 * stay off the 2 KB filterable budget so the per-doc allowed_users ACL holds more users.
 * The Python crawler's _NONFILTERABLE_DISPLAY_KEYS must match those 5 keys exactly.
 *
 * We assert against the SOURCE of index.ts rather than importing the handler: the handler
 * imports the shared lib/prm-node/prm helper, which the bare `node --test` runner can't
 * ESM-resolve (extensionless .ts) and tsx loads as CJS (named-export interop) — neither
 * lets us safely construct the real AWS clients in a unit test. A static source assertion
 * pins the exact list under both runners with zero AWS surface.
 */
describe('CreateIndex nonFilterableMetadataKeys', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, 'index.ts'), 'utf8');

  // Extract the nonFilterableMetadataKeys array literal from the source.
  const match = source.match(/nonFilterableMetadataKeys:\s*\[([\s\S]*?)\]/);

  const keys: string[] = match ? Array.from(match[1].matchAll(/'([^']+)'/g)).map((m) => m[1]) : [];

  // The 5 synergy display-only keys + the 2 Bedrock internal keys = 7 (under the 10 cap).
  const EXPECTED_NON_FILTERABLE = [
    'AMAZON_BEDROCK_TEXT',
    'AMAZON_BEDROCK_METADATA',
    'job_name',
    'job_path',
    'file_name',
    'file_path',
    'source_weblink',
  ];

  it('declares a nonFilterableMetadataKeys array', () => {
    assert.ok(match, 'nonFilterableMetadataKeys literal should exist in index.ts');
  });

  it('marks synergy display-only keys + Bedrock internal keys non-filterable', () => {
    assert.deepStrictEqual(keys, EXPECTED_NON_FILTERABLE);
  });

  it('stays under the S3 Vectors 10 non-filterable key cap', () => {
    assert.ok(keys.length <= 10, `expected <= 10 non-filterable keys, got ${keys.length}`);
  });

  it('keeps short query-filter keys filterable', () => {
    // These are used in query filters, so they must NOT be in the non-filterable list.
    for (const filterKey of ['tenant_id', 'kb_id', 'doc_type', 'allowed_users']) {
      assert.ok(!keys.includes(filterKey), `${filterKey} must stay filterable`);
    }
  });
});
