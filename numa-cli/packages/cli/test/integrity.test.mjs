/**
 * Functional tests for the CLI integrity layer (api/integrity.ts):
 * atomic verified downloads + oversized-result spillover resolution.
 *
 * Runs against the BUILT output (dist/) with a local HTTP server standing in
 * for the presigned S3 URLs — `yarn build` first. No network, no AWS.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { atomicDownload, resolveOversizedResult, isOversizedEnvelope, verifyBufferSha256, atomicWriteFile, IntegrityError } =
  await import('../dist/api/integrity.js');

const payload = Buffer.from(JSON.stringify({ listings: { kb1: { total_count: 3 } }, big: 'x'.repeat(50000) }));
const sha = createHash('sha256').update(payload).digest('hex');
const binary = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100000, 7)]);
const binSha = createHash('sha256').update(binary).digest('hex');

let server;
let base;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/result.json') { res.writeHead(200); res.end(payload); }
    else if (req.url === '/binary.pdf') { res.writeHead(200); res.end(binary); }
    else if (req.url === '/truncated.json') { res.writeHead(200); res.end(payload.subarray(0, 100)); }
    else if (req.url === '/404') { res.writeHead(404); res.end('nope'); }
    else { res.writeHead(500); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('isOversizedEnvelope detects the spillover envelope', () => {
  assert.ok(isOversizedEnvelope({ oversized: true, result_url: 'x' }));
});

test('isOversizedEnvelope rejects normal results', () => {
  assert.ok(!isOversizedEnvelope({ listings: {} }));
  assert.ok(!isOversizedEnvelope(null));
  assert.ok(!isOversizedEnvelope('s'));
  assert.ok(!isOversizedEnvelope({ oversized: true })); // no result_url
});

test('resolveOversizedResult round-trips the spilled payload losslessly', async () => {
  const out = await resolveOversizedResult({
    oversized: true,
    result_url: `${base}/result.json`,
    result_sha256: sha,
    result_size: payload.length,
  });
  assert.equal(out.listings.kb1.total_count, 3);
  assert.equal(out.big.length, 50000);
});

test('resolveOversizedResult passes non-envelopes through unchanged', async () => {
  const inp = { a: 1 };
  assert.equal(await resolveOversizedResult(inp), inp);
});

test('resolveOversizedResult hard-fails on sha mismatch', async () => {
  await assert.rejects(
    resolveOversizedResult({ oversized: true, result_url: `${base}/result.json`, result_sha256: 'b'.repeat(64) }),
    (e) => e instanceof IntegrityError && /sha256 mismatch/.test(e.message)
  );
});

test('resolveOversizedResult hard-fails on a truncated payload', async () => {
  await assert.rejects(
    resolveOversizedResult({
      oversized: true,
      result_url: `${base}/truncated.json`,
      result_sha256: sha,
      result_size: payload.length,
    }),
    (e) => e instanceof IntegrityError
  );
});

test('envelope without result_sha256 is rejected (fail-closed)', async () => {
  await assert.rejects(
    resolveOversizedResult({ oversized: true, result_url: `${base}/result.json` }),
    (e) => e instanceof IntegrityError && /missing result_sha256/.test(e.message)
  );
});

test('atomicDownload verifies sha256 + size and writes the destination', async () => {
  const dest = join(tmpdir(), `it-${Date.now()}.pdf`);
  const n = await atomicDownload(`${base}/binary.pdf`, dest, { expectedSha256: binSha, expectedSize: binary.length });
  assert.equal(n, binary.length);
  assert.ok(readFileSync(dest).equals(binary));
});

test('atomicDownload leaves nothing behind on sha mismatch', async () => {
  const dir = join(tmpdir(), `it-dir-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, 'f.bin');
  await assert.rejects(
    atomicDownload(`${base}/binary.pdf`, dest, { expectedSha256: 'c'.repeat(64) }),
    (e) => e instanceof IntegrityError
  );
  assert.ok(!existsSync(dest), 'destination must not exist after a failed download');
  assert.equal(readdirSync(dir).length, 0, 'no partial temp files may remain');
});

test('atomicDownload surfaces HTTP errors', async () => {
  await assert.rejects(atomicDownload(`${base}/404`, join(tmpdir(), `it-${Date.now()}.x`)), /HTTP 404/);
});

test('verifyBufferSha256 + atomicWriteFile handle inline payloads', async () => {
  verifyBufferSha256(binary, binSha, 'test');
  assert.throws(() => verifyBufferSha256(binary, 'd'.repeat(64), 'test'), IntegrityError);
  const dest = join(tmpdir(), `it-w-${Date.now()}.bin`);
  await atomicWriteFile(dest, binary);
  assert.ok(readFileSync(dest).equals(binary));
});
