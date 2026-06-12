/**
 * Auto-delivery of files carried in integration results — the CLI port of the
 * deleted MCP layer's `save_result` download handling (dev ac568750b).
 *
 * Pipedream actions and proxy requests can return file payloads in four
 * shapes. The model shouldn't have to fish presigned URLs out of JSON and
 * hand-roll downloads (in the workspace it often *can't* — curl is blocked);
 * the CLI delivers the bytes as real files and reports the paths:
 *
 *   1. Inline binary        — `{binary: true, base64_body, content_type}`
 *   2. Staged binary        — `{binary: true, binary_storage: "s3_presigned",
 *                              presigned_url, filename_hint?, size?,
 *                              download_sha256?}` (proxy stages >6MB bodies)
 *   3. File-stash uploads   — `exports.$filestash_uploads[]` with
 *                              `get_url`/`downloadUrl` + `path`/`fileName`
 *   4. Zoom transcripts     — `download_access_token` + `recording_files[]`
 *                              TRANSCRIPT entries (URL needs the token query)
 *
 * Split into a pure scanner (`collectIntegrationFileRefs`) and an effectful
 * deliverer so the shape detection is unit-testable without network.
 * Downloads are atomic (temp + rename) and sha256-verified when the producer
 * stamped a hash; a failed download warns and continues — the bytes are
 * still retrievable upstream, and the JSON result must not be lost over a
 * side-file hiccup.
 */

import { join } from 'node:path';
import { atomicDownload, atomicWriteFile, verifyBufferSha256 } from '../../api/integrity.js';

/** One planned file delivery, produced by the pure scanner. */
export interface IntegrationFileRef {
  /** Sanitised filename (no path separators) relative to the results dir. */
  filename: string;
  /** Where the bytes come from. */
  source: { kind: 'url'; url: string } | { kind: 'base64'; data: string };
  expectedSha256?: string;
  expectedSize?: number;
}

/** Dev's MCP layer wrote here; keep the path so skills/prompts stay valid. */
const WORKSPACE_RESULTS_DIR = '/workdir/tmp/integrations-results';

export const integrationResultsDir = (): string =>
  process.env['NUMA_CONVERSATION_ID'] ? WORKSPACE_RESULTS_DIR : './integrations-results';

/** Never trust an upstream-derived filename: strip separators, leading dots, cap length. */
const sanitiseName = (raw: string, fallback: string): string => {
  const safe = raw.replace(/[/\\]/g, '_').replace(/^\.+/, '').slice(0, 120).trim();
  return safe || fallback;
};

/** Pipedream returns literal "undefined"/"null" strings when its own filename derivation fails. */
const isSentinel = (v: unknown): boolean =>
  typeof v !== 'string' || ['', 'undefined', 'null'].includes(v.trim().toLowerCase());

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

const extFromContentType = (contentType: unknown): string => {
  const base = typeof contentType === 'string' ? contentType.split(';')[0]?.trim() : '';
  // Minimal map — covers what integrations actually return; unknown types
  // just get no extension (the content_type rides in the JSON result anyway).
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/zip': '.zip',
    'application/json': '.json',
    'text/csv': '.csv',
    'text/plain': '.txt',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  };
  return (base && map[base]) || '';
};

/**
 * Pure scan of an integration result for deliverable file payloads.
 * Tolerant of nesting: inspects both the value itself and its `result` child
 * (handlers differ on how much wrapper survives the trip).
 */
export function collectIntegrationFileRefs(result: unknown, actionKey: string): IntegrationFileRef[] {
  const refs: IntegrationFileRef[] = [];
  const seen = new Set<string>();
  const push = (ref: IntegrationFileRef): void => {
    if (seen.has(ref.filename)) return;
    seen.add(ref.filename);
    refs.push(ref);
  };

  const outer = asRecord(result);
  const candidates = [outer, asRecord(outer?.['result'])].filter(Boolean) as Record<string, unknown>[];

  for (const r of candidates) {
    const sha = typeof r['download_sha256'] === 'string' ? r['download_sha256'] : undefined;
    const ext = extFromContentType(r['content_type']);

    // 1. Inline binary (base64)
    if (r['binary'] && typeof r['base64_body'] === 'string') {
      push({
        filename: `${actionKey}-binary${ext}`,
        source: { kind: 'base64', data: r['base64_body'] },
        ...(sha ? { expectedSha256: sha } : {}),
      });
    }

    // 2. Staged binary (proxy spilled >6MB bodies to S3, presigned GET)
    if (r['binary'] && r['binary_storage'] === 's3_presigned' && typeof r['presigned_url'] === 'string') {
      const hint = r['filename_hint'];
      let filename = `${actionKey}-binary${ext}`;
      if (!isSentinel(hint)) {
        filename = sanitiseName(hint as string, filename);
        if (!filename.includes('.') && ext) filename = `${filename}${ext}`;
      }
      push({
        filename,
        source: { kind: 'url', url: r['presigned_url'] },
        ...(sha ? { expectedSha256: sha } : {}),
        ...(typeof r['size'] === 'number' && r['size'] > 0 ? { expectedSize: r['size'] } : {}),
      });
    }

    // 3. File-stash uploads
    const exports = asRecord(r['exports']);
    const stash = exports?.['$filestash_uploads'];
    if (Array.isArray(stash)) {
      for (const entry of stash) {
        const u = asRecord(entry);
        if (!u) continue;
        const url = [u['get_url'], u['downloadUrl'], u['downloadURL']].find(
          (v): v is string => typeof v === 'string' && v.length > 0
        );
        if (!url) continue;
        const rawName = [u['path'], u['fileName']].find((v) => !isSentinel(v)) as string | undefined;
        const filename = sanitiseName(rawName ?? '', `download-${Math.abs(hashCode(url)).toString(16)}`);
        push({ filename, source: { kind: 'url', url } });
      }
    }

    // 4. Zoom recording transcripts (download_url needs the access token appended)
    const accessToken = r['download_access_token'];
    const recFiles = r['recording_files'];
    if (typeof accessToken === 'string' && Array.isArray(recFiles)) {
      for (const entry of recFiles) {
        const f = asRecord(entry);
        if (!f || f['file_type'] !== 'TRANSCRIPT') continue;
        const url = f['download_url'];
        if (typeof url !== 'string' || !url) continue;
        const sep = url.includes('?') ? '&' : '?';
        const meetingId = r['id'] ?? f['meeting_id'] ?? 'unknown';
        const fileExt = typeof f['file_extension'] === 'string' ? f['file_extension'].toLowerCase() : 'vtt';
        push({
          filename: sanitiseName(`transcript-${meetingId}.${fileExt}`, 'transcript.vtt'),
          source: { kind: 'url', url: `${url}${sep}access_token=${accessToken}` },
        });
      }
    }
  }

  return refs;
}

/** Deterministic name fallback for stash entries with no usable filename. */
const hashCode = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
};

/**
 * Deliver every file payload found in `result` into the integrations results
 * dir. Returns the list of written paths. Individual failures warn on stderr
 * and are skipped — never throws (the JSON result must still be emitted).
 */
export async function deliverIntegrationFiles(result: unknown, actionKey: string): Promise<string[]> {
  const refs = collectIntegrationFileRefs(result, actionKey);
  if (refs.length === 0) return [];

  const dir = integrationResultsDir();
  const delivered: string[] = [];
  for (const ref of refs) {
    const dest = join(dir, ref.filename);
    try {
      if (ref.source.kind === 'base64') {
        const buf = Buffer.from(ref.source.data, 'base64');
        if (ref.expectedSha256) verifyBufferSha256(buf, ref.expectedSha256, `integration file ${ref.filename}`);
        await atomicWriteFile(dest, buf);
      } else {
        await atomicDownload(ref.source.url, dest, {
          ...(ref.expectedSha256 ? { expectedSha256: ref.expectedSha256 } : {}),
          ...(ref.expectedSize !== undefined ? { expectedSize: ref.expectedSize } : {}),
        });
      }
      delivered.push(dest);
    } catch (e) {
      // Do NOT log the URL — presigned bearer token.
      process.stderr.write(
        `numa: warning — failed to deliver integration file '${ref.filename}': ` +
          `${e instanceof Error ? e.message : String(e)}\n`
      );
    }
  }
  if (delivered.length > 0) {
    process.stderr.write(
      `numa: downloaded ${delivered.length} file(s):\n${delivered.map((p) => `  - ${p}`).join('\n')}\n`
    );
  }
  return delivered;
}
