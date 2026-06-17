/**
 * End-to-end integrity for bytes the CLI pulls off the platform.
 *
 * Two concerns live here, ported from the deleted MCP layer's
 * `lambda_client.py` / `numa_tool.py` (the workdir-boundary hardening that
 * landed on dev in ac568750b — the CLI is the consumer side now):
 *
 * 1. **Atomic, verified downloads.** Streaming straight to the final path
 *    means a crash / OOM / container kill mid-transfer leaves a truncated
 *    file that a later read treats as complete. Every download goes to a
 *    temp file in the SAME directory (so `rename` stays on one filesystem
 *    and is atomic on POSIX), is sha256-hashed as it streams, and only
 *    swaps into place once the hash/size checks pass. On any failure the
 *    partial temp file is removed — nothing unverified ever sits at the
 *    destination path.
 *
 * 2. **Oversized-result spillover envelopes.** workspace-chat-tools and
 *    pipedream-proxy cap synchronous Lambda responses ~5 MiB (AWS hard
 *    limit is 6 MB). Larger structured results are written to S3 in full
 *    and the Lambda returns `{oversized: true, result_url, result_sha256,
 *    result_size}` instead. `resolveOversizedResult` turns that envelope
 *    back into the COMPLETE, sha256-verified result — losslessly, or not
 *    at all.
 */

import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { readFile, rename, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** A download or spilled result failed sha256/size verification. */
export class IntegrityError extends Error {}

export const sha256Hex = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

/**
 * Verify a buffer against an expected sha256, throwing IntegrityError with a
 * caller-supplied label on mismatch. Used for inline (base64/hex) payloads
 * where the bytes are already in memory.
 */
export function verifyBufferSha256(buf: Buffer, expectedSha256: string, label: string): void {
  const actual = sha256Hex(buf);
  if (actual !== expectedSha256.toLowerCase()) {
    throw new IntegrityError(
      `${label}: sha256 mismatch (expected ${expectedSha256}, got ${actual}) — refusing to use unverified bytes`
    );
  }
}

/**
 * Write `buf` to `destPath` atomically: temp file in the same directory,
 * then rename into place. Cleans up the temp file on failure.
 */
export async function atomicWriteFile(destPath: string, buf: Buffer): Promise<void> {
  mkdirSync(dirname(destPath), { recursive: true });
  const tmpPath = join(dirname(destPath), `.${Date.now()}-${process.pid}.partial`);
  try {
    const stream = createWriteStream(tmpPath, { flags: 'wx' });
    await pipeline(Readable.from(buf), stream);
    await rename(tmpPath, destPath);
  } catch (e) {
    await unlink(tmpPath).catch(() => {});
    throw e;
  }
}

export interface AtomicDownloadOptions {
  /** Hard-fail (and delete the temp file) unless the streamed bytes hash to this. */
  expectedSha256?: string;
  /** Hard-fail unless exactly this many bytes arrive. Ignored when undefined. */
  expectedSize?: number;
}

/**
 * Download `url` to `destPath` atomically, hashing as the bytes stream.
 * Returns the byte count written. Throws IntegrityError on sha256/size
 * mismatch (temp file already discarded), plain Error on HTTP failures.
 *
 * The whole file is never held in RAM — it streams disk-ward through the
 * hash, so multi-hundred-MB transfers are safe in the MicroVM.
 */
export async function atomicDownload(url: string, destPath: string, opts: AtomicDownloadOptions = {}): Promise<number> {
  mkdirSync(dirname(destPath), { recursive: true });
  const tmpPath = join(dirname(destPath), `.${Date.now()}-${process.pid}.partial`);

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status}`);
  }

  const hash = createHash('sha256');
  let total = 0;
  try {
    const counter = async function* (source: AsyncIterable<Uint8Array>) {
      for await (const chunk of source) {
        hash.update(chunk);
        total += chunk.length;
        yield chunk;
      }
    };
    await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(tmpPath, { flags: 'wx' }));

    if (opts.expectedSize !== undefined && total !== opts.expectedSize) {
      throw new IntegrityError(
        `download size mismatch (expected ${opts.expectedSize} bytes, got ${total}) — refusing to keep a possibly-truncated file`
      );
    }
    if (opts.expectedSha256) {
      const actual = hash.digest('hex');
      if (actual !== opts.expectedSha256.toLowerCase()) {
        throw new IntegrityError(
          `download sha256 mismatch (expected ${opts.expectedSha256}, got ${actual}) — refusing to keep unverified bytes`
        );
      }
    }
    await rename(tmpPath, destPath);
    return total;
  } catch (e) {
    await unlink(tmpPath).catch(() => {});
    throw e;
  }
}

/**
 * The fixed spillover envelope emitted by workspace-chat-tools'
 * `response_size.inline_or_spill` and pipedream-proxy's
 * `offload_oversized_result`.
 */
export interface OversizedEnvelope {
  oversized: true;
  result_url: string;
  result_sha256?: string;
  result_size?: number;
  status?: string;
  note?: string;
}

export function isOversizedEnvelope(v: unknown): v is OversizedEnvelope {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Record<string, unknown>)['oversized'] === true &&
    typeof (v as Record<string, unknown>)['result_url'] === 'string'
  );
}

/**
 * Return `result` unchanged unless it is an oversized spillover envelope, in
 * which case fetch + verify + parse the complete result. Backward-compatible:
 * handlers that never spill pass through untouched.
 *
 * Throws IntegrityError on a malformed envelope, hash/size mismatch, or
 * unparseable payload — callers must surface that as a tool error rather
 * than hand the model partial data.
 */
export async function resolveOversizedResult(result: unknown): Promise<unknown> {
  if (!isOversizedEnvelope(result)) return result;

  if (!result.result_sha256) {
    throw new IntegrityError('oversized result envelope missing result_sha256 — cannot verify the spilled payload');
  }

  // Scratch download: parsed and deleted immediately; must not appear in the
  // user's workspace, so it goes to the system temp dir. Do NOT log
  // result_url — it is a presigned bearer token.
  const tmpPath = join(tmpdir(), `numa-oversized-${Date.now()}-${process.pid}.json`);
  const expectedSize =
    typeof result.result_size === 'number' && result.result_size >= 0 ? result.result_size : undefined;
  try {
    await atomicDownload(result.result_url, tmpPath, {
      expectedSha256: result.result_sha256,
      expectedSize,
    });
    const body = await readFile(tmpPath);
    try {
      return JSON.parse(body.toString('utf-8'));
    } catch (e) {
      throw new IntegrityError(`oversized result passed sha256 but is not valid JSON: ${e}`);
    }
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}
