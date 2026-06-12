/**
 * Unified result emitter. Every CLI command that returns a tool result
 * should go through this — keeps the three output modes (`pretty` /
 * `standard` / `json`) consistent without per-command branching.
 *
 * Usage:
 *
 *   emitResult({
 *     tool: 'user_profile_list_memories',
 *     result: res.result,
 *     options,                       // commander action options object
 *     pretty: (r) => {               // your existing human renderer
 *       for (const m of r.memories) process.stdout.write(...);
 *     },
 *   });
 *
 * Mode selection:
 *   - pretty  → calls `pretty(result)` if provided; otherwise falls back
 *               to JSON (so commands without a renderer still produce
 *               something usable).
 *   - standard → wraps in `_summary` envelope (see `standard.ts`).
 *   - json    → printJson(result) — raw passthrough.
 *
 * `info()` / `success()` / `warn()` (the `numa: ...` stderr messages) are
 * separate from output mode — they're status, not data. Keep using them
 * directly; the emitter doesn't touch stderr.
 */

import { printJson } from './json.js';
import { resolveOutputMode, type OutputModeFlags } from './mode.js';
import { buildEnvelope, INLINE_THRESHOLD_BYTES, spillResultToFile, formatSize, inferSchema } from './standard.js';

export interface EmitOptions<T> {
  /** Tool name. Used as the file basename and the `_summary.tool` field. */
  tool: string;
  /** Result to emit — whatever the underlying tool returned. */
  result: T;
  /** Per-command flags from commander. */
  options?: OutputModeFlags;
  /** Per-command pretty renderer. Falls back to JSON if omitted. */
  pretty?: (result: T) => void;
}

export const emitResult = <T>(opts: EmitOptions<T>): void => {
  const mode = resolveOutputMode(opts.options);

  if (mode === 'json') {
    printJson(opts.result);
    return;
  }

  if (mode === 'standard') {
    printJson(buildEnvelope(opts.tool, opts.result));
    return;
  }

  // pretty
  if (opts.pretty) {
    opts.pretty(opts.result);
  } else {
    printJson(opts.result);
  }
};

export interface PrettyOrSpillOptions<T> {
  /** Tool name — used as the spill-file basename. */
  tool: string;
  /** Result to render or spill. */
  result: T;
  /** Per-command flags from commander — same mode-resolution as `emitResult`. */
  options?: OutputModeFlags;
  /**
   * Pretty renderer used when the result fits inline (under
   * INLINE_THRESHOLD_BYTES). For wildcard commands like
   * `pipedream-call` / `request` where response shape is unknown, this
   * is typically `JSON.stringify(result, null, 2)`.
   */
  render: (result: T) => void;
  /**
   * Optional one-line headline printed before the spill summary. Lets
   * callers add command-specific context (e.g. status code, action name).
   * Default headline is `"<tool> returned (<size>, <count> entries)"`.
   */
  headline?: (result: T, size: string, count: number) => string;
}

/**
 * Pretty-mode emitter for commands whose result shape is unpredictable —
 * `pipedream-call`, `request`, anything where a per-shape renderer isn't
 * worth writing. Size-checks the result:
 *
 * - Under INLINE_THRESHOLD_BYTES: renders normally via `render`.
 * - Over threshold: spills the full result to the same `tmp/numa-cli/`
 *   dir the standard envelope uses, then prints a short human summary
 *   (size, count, path, inferred schema, hint).
 *
 * Honours `--standard` / `--json` overrides — flags still win, so a user
 * can force the envelope form even on wildcard commands. The "spill"
 * branch only fires when mode resolves to `pretty` AND the result is big.
 */
export const prettyOrSpill = <T>(opts: PrettyOrSpillOptions<T>): void => {
  const mode = resolveOutputMode(opts.options);
  if (mode === 'json') {
    printJson(opts.result);
    return;
  }
  if (mode === 'standard') {
    printJson(buildEnvelope(opts.tool, opts.result));
    return;
  }

  const serialized = JSON.stringify(opts.result ?? null);
  if (serialized.length <= INLINE_THRESHOLD_BYTES) {
    opts.render(opts.result);
    return;
  }

  // Big result: spill, print human summary.
  const path = spillResultToFile(opts.tool, serialized);
  const size = formatSize(serialized.length);
  const count = deepArrayCountForCli(opts.result);
  const headline = opts.headline
    ? opts.headline(opts.result, size, count)
    : `${opts.tool} returned (${size}${count > 0 ? `, ${count} entries` : ''})`;

  process.stderr.write(`${headline}\n`);
  if (path) {
    process.stderr.write(`Saved to: ${path}\n`);
  } else {
    process.stderr.write(`(could not write spill file — falling back to inline)\n`);
    process.stdout.write(serialized + '\n');
    return;
  }
  // Stdout gets the compact schema so callers piping into other tools
  // still have a usable handle on the shape.
  process.stdout.write(JSON.stringify({ schema: inferSchema(opts.result), path, size, count }, null, 2) + '\n');
  process.stderr.write(`Re-run with --standard for a full structured envelope, --json for raw output.\n`);
};

// Local re-export so we don't have to import `deepArrayCount` from
// standard.ts directly in callers — keeps emit.ts as the one-stop shop.
import { deepArrayCount as deepArrayCountForCli } from './standard.js';
