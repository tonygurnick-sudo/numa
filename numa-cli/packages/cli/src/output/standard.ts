/**
 * `--standard` envelope builder. Wraps a tool result in:
 *
 *   {
 *     "_summary": {
 *       "tool":    "user_profile_list_memories",
 *       "count":   47,                     // largest array in the result
 *       "size":    "12.3 KB",              // serialized size, human-formatted
 *       "schema":  {...},                  // structural shape, leaves are type names
 *       "sample":  {...},                  // full result with arrays truncated
 *       "path":    "/workdir/tmp/numa-cli/numa-…-…json" | null,
 *       "inlined": true | false
 *     },
 *     "result": {...} | null               // populated iff inlined; null if dumped to file
 *   }
 *
 * Goal: keep the LLM's context lean — for a 47-memory list, the LLM gets
 * 2 sample entries + a path it can `cat`/`jq`, not the full 47. For small
 * results (≤ INLINE_THRESHOLD_BYTES), the full data is inline and `path`
 * is null — same envelope shape so consumers don't have to branch.
 *
 * File path strategy:
 *   - In-workspace (NUMA_CONVERSATION_ID set):
 *       /workdir/tmp/numa-cli/numa-<tool>-<timestamp>.json
 *     The MicroVM's S3 sync handles persistence; LLM Read tool can open it.
 *   - Outside workspace:
 *       ./tmp/numa-cli/numa-<tool>-<timestamp>.json   (cwd-relative)
 *     Visible to the developer; easy to clear with `rm -rf tmp/numa-cli/`.
 *   - Override:
 *       NUMA_CLI_TMP_DIR=/some/dir   (env var)
 *
 * Write failures fall back to inline (never crash a tool call just
 * because the workdir isn't writable).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Result is dumped to file when its serialized size exceeds this. ~4KB ≈
 * ~1K tokens — small enough to keep inline without bloating context.
 */
export const INLINE_THRESHOLD_BYTES = 4 * 1024;

/**
 * How many array entries to keep in the sample (per array, at every
 * nesting level). 2 is enough to show variation between entries without
 * being noisy.
 */
export const SAMPLE_ARRAY_LIMIT = 2;

/**
 * Cap individual string values in the sample. Gmail message payloads
 * embed base64 bodies that can be hundreds of KB on their own — without
 * this cap, a 3-message sample blows the envelope past 80 KB. Schema is
 * unaffected (it only shows type names).
 */
export const SAMPLE_STRING_LIMIT = 200;

/**
 * Cap recursion depth in the sample. Stops `{a:{b:{c:{...}}}}` payloads
 * from blowing up. Beyond this depth, values become "[depth limit]".
 * Schema is unaffected.
 */
export const SAMPLE_DEPTH_LIMIT = 8;

export interface StandardEnvelope {
  _summary: {
    tool: string;
    count: number;
    size: string;
    schema: unknown;
    sample: unknown;
    path: string | null;
    inlined: boolean;
  };
  result: unknown;
}

/** Infer a JSON-Schema-ish shape from a sample value. Leaves are type names. */
export const inferSchema = (value: unknown): unknown => {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    // Use the first element as the template — same caveat as JSON Schema's
    // "items": doesn't capture per-element variation. Good enough for v1.
    return [inferSchema(value[0])];
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = inferSchema(v);
    }
    return out;
  }
  return typeof value;
};

interface SampleLimits {
  arrayLimit: number;
  stringLimit: number;
  depthLimit: number;
}

const DEFAULT_LIMITS: SampleLimits = {
  arrayLimit: SAMPLE_ARRAY_LIMIT,
  stringLimit: SAMPLE_STRING_LIMIT,
  depthLimit: SAMPLE_DEPTH_LIMIT,
};

/**
 * Build a sample preserving the full structure but bounded by:
 * - `arrayLimit` entries per array
 * - `stringLimit` chars per string (longer strings get truncated suffix)
 * - `depthLimit` nesting levels (deeper values become "[depth limit]")
 *
 * Recurses into nested objects/arrays so e.g. `list_kb_files`'s nested
 * `{listings: {kb: {files: [...]}}}` shape stays meaningful, while
 * pathological payloads like Gmail messages (deeply-nested parts with
 * base64 body data) don't blow the envelope to hundreds of KB.
 */
export const buildSample = (value: unknown, limits: Partial<SampleLimits> = {}, depth = 0): unknown => {
  const cfg: SampleLimits = { ...DEFAULT_LIMITS, ...limits };
  if (depth >= cfg.depthLimit) return '[depth limit]';
  if (value === null) return null;
  if (typeof value === 'string') {
    return value.length > cfg.stringLimit
      ? value.slice(0, cfg.stringLimit) + `...[truncated, ${value.length - cfg.stringLimit} more chars]`
      : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, cfg.arrayLimit).map((v) => buildSample(v, cfg, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = buildSample(v, cfg, depth + 1);
    }
    return out;
  }
  return value;
};

/**
 * Largest single array length anywhere in the structure. Useful as a "how
 * much stuff is in here" hint — for `{memories: [47]}` returns 47; for
 * `{listings: {kbA: {files: [10]}, kbB: {files: [3]}}}` returns 10.
 *
 * Returns 0 when there are no arrays at all (single-object responses).
 */
export const deepArrayCount = (value: unknown): number => {
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === 'object') {
    let max = 0;
    for (const v of Object.values(value as Record<string, unknown>)) {
      max = Math.max(max, deepArrayCount(v));
    }
    return max;
  }
  return 0;
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const resolveTmpDir = (): string => {
  const fromEnv = process.env['NUMA_CLI_TMP_DIR'];
  if (fromEnv) return fromEnv;
  if (process.env['NUMA_CONVERSATION_ID']) return '/workdir/tmp/numa-cli';
  return './tmp/numa-cli';
};

const safeTimestamp = (): string => new Date().toISOString().replace(/[:.]/g, '-');

/**
 * Write a result to the workspace-aware tmp dir. Best-effort — returns
 * null on any write failure (caller decides what to do with that).
 *
 * Shared between `buildEnvelope` (standard mode) and `prettyOrSpill`
 * (pretty mode for wildcard commands), so spilled files always land in
 * the same place regardless of which mode triggered it.
 */
export const spillResultToFile = (tool: string, serialized: string): string | null => {
  const tmpDir = resolveTmpDir();
  const fullPath = resolve(tmpDir, `numa-${tool}-${safeTimestamp()}.json`);
  try {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(fullPath, serialized);
    return fullPath;
  } catch {
    return null;
  }
};

export const formatSize = (bytes: number): string => formatBytes(bytes);

/**
 * Wrap a tool result in the standard envelope. Always returns the same
 * shape — fields `path` / `inlined` / `result` indicate whether the data
 * lives on disk or inline.
 */
export const buildEnvelope = (tool: string, result: unknown): StandardEnvelope => {
  const serialized = JSON.stringify(result ?? null);
  const sizeBytes = serialized.length;
  const schema = inferSchema(result);
  const sample = buildSample(result);
  const count = deepArrayCount(result);
  const size = formatBytes(sizeBytes);

  // Small result: inline. Same envelope shape so consumers don't branch.
  if (sizeBytes <= INLINE_THRESHOLD_BYTES) {
    return {
      _summary: { tool, count, size, schema, sample, path: null, inlined: true },
      result: result ?? null,
    };
  }

  const fullPath = spillResultToFile(tool, serialized);
  if (fullPath) {
    return {
      _summary: { tool, count, size, schema, sample, path: fullPath, inlined: false },
      result: null,
    };
  }
  // Write failed — inline anyway. Caller still gets the data, just
  // takes the context hit.
  return {
    _summary: { tool, count, size, schema, sample, path: null, inlined: true },
    result: result ?? null,
  };
};
