/**
 * Shape detection for integration file auto-delivery
 * (commands/actions/_integration-files.ts — the pure scanner half).
 * Covers the four payload shapes dev's MCP save_result handled, plus the
 * filename-sentinel and sanitisation edge cases verified live on dev.
 */
import { test } from 'node:test';
import assert from 'node:assert';

const { collectIntegrationFileRefs } = await import('../dist/commands/actions/_integration-files.js');

test('inline base64 binary is collected with content-type extension', () => {
  const refs = collectIntegrationFileRefs(
    { binary: true, base64_body: 'aGk=', content_type: 'application/pdf', download_sha256: 'a'.repeat(64) },
    'gmail-get-attachment'
  );
  assert.equal(refs.length, 1);
  assert.equal(refs[0].filename, 'gmail-get-attachment-binary.pdf');
  assert.equal(refs[0].source.kind, 'base64');
  assert.equal(refs[0].expectedSha256, 'a'.repeat(64));
});

test('inline base64 binary prefers filename_hint over the synthetic name', () => {
  // A Slack `request` GET on url_private_download returns inline base64 with a
  // filename_hint. The actionKey is the generic `proxy-slack`, so without the
  // hint every download collapses onto `proxy-slack-binary.png` and overwrites
  // the last. The real name must win.
  const refs = collectIntegrationFileRefs(
    { binary: true, base64_body: 'aGk=', content_type: 'image/png', filename_hint: 'image.png' },
    'proxy-slack'
  );
  assert.equal(refs.length, 1);
  assert.equal(refs[0].filename, 'image.png');
  assert.equal(refs[0].source.kind, 'base64');
});

test('inline base64 binary appends the content-type ext when the hint lacks one', () => {
  const refs = collectIntegrationFileRefs(
    { binary: true, base64_body: 'aGk=', content_type: 'application/pdf', filename_hint: 'invoice' },
    'proxy-xero_accounting_api'
  );
  assert.equal(refs[0].filename, 'invoice.pdf');
});

test('inline base64 binary falls back to synthetic name when hint is a sentinel', () => {
  const refs = collectIntegrationFileRefs(
    { binary: true, base64_body: 'aGk=', content_type: 'text/csv', filename_hint: 'undefined' },
    'act'
  );
  assert.equal(refs[0].filename, 'act-binary.csv');
});

test('staged presigned binary uses filename_hint with sha + size', () => {
  const refs = collectIntegrationFileRefs(
    {
      binary: true,
      binary_storage: 's3_presigned',
      presigned_url: 'https://signed.example/get?sig=x',
      filename_hint: 'Q4 report.pdf',
      content_type: 'application/pdf',
      size: 123456,
      download_sha256: 'b'.repeat(64),
    },
    'proxy-google_drive'
  );
  assert.equal(refs.length, 1);
  assert.equal(refs[0].filename, 'Q4 report.pdf');
  assert.equal(refs[0].source.url, 'https://signed.example/get?sig=x');
  assert.equal(refs[0].expectedSize, 123456);
  assert.equal(refs[0].expectedSha256, 'b'.repeat(64));
});

test('filename_hint is sanitised — separators stripped, no traversal', () => {
  const refs = collectIntegrationFileRefs(
    {
      binary: true,
      binary_storage: 's3_presigned',
      presigned_url: 'https://signed.example/x',
      filename_hint: '../../etc/passwd',
    },
    'act'
  );
  assert.equal(refs[0].filename.includes('/'), false);
  assert.equal(refs[0].filename.includes('\\'), false);
  assert.equal(refs[0].filename.startsWith('.'), false);
});

test('filestash uploads are collected; sentinel filenames get a fallback', () => {
  const refs = collectIntegrationFileRefs(
    {
      exports: {
        $filestash_uploads: [
          { get_url: 'https://stash.example/a', path: 'report.docx' },
          { downloadUrl: 'https://stash.example/b', path: 'undefined' }, // pipedream sentinel
          { path: 'no-url-entry.txt' }, // no URL → skipped
        ],
      },
    },
    'outlook-download-attachment'
  );
  assert.equal(refs.length, 2);
  assert.equal(refs[0].filename, 'report.docx');
  assert.ok(refs[1].filename.startsWith('download-'), `fallback name, got ${refs[1].filename}`);
});

test('zoom transcript entries get the access token appended', () => {
  const refs = collectIntegrationFileRefs(
    {
      id: 12345,
      download_access_token: 'tok',
      recording_files: [
        { file_type: 'TRANSCRIPT', download_url: 'https://zoom.example/rec?x=1', file_extension: 'VTT' },
        { file_type: 'MP4', download_url: 'https://zoom.example/video' }, // not a transcript → skipped
      ],
    },
    'zoom-get-recording'
  );
  assert.equal(refs.length, 1);
  assert.equal(refs[0].filename, 'transcript-12345.vtt');
  assert.equal(refs[0].source.url, 'https://zoom.example/rec?x=1&access_token=tok');
});

test('shapes nested under .result are found (wrapper tolerance)', () => {
  const refs = collectIntegrationFileRefs(
    { status: 'success', result: { binary: true, base64_body: 'aGk=', content_type: 'text/csv' } },
    'act'
  );
  assert.equal(refs.length, 1);
  assert.equal(refs[0].filename, 'act-binary.csv');
});

test('plain JSON results produce no refs', () => {
  assert.equal(collectIntegrationFileRefs({ result: { ret: [1, 2, 3] } }, 'act').length, 0);
  assert.equal(collectIntegrationFileRefs(null, 'act').length, 0);
  assert.equal(collectIntegrationFileRefs('text', 'act').length, 0);
});
