/**
 * Shared CLI argument helpers — used by commands that accept ad-hoc
 * `--<key> <value>` flags as syntactic sugar for a JSON-blob parameter.
 *
 * Adopted by: `numa ops` (params), `numa integrations pipedream-call`
 * (props), `numa integrations pipedream-props-options` (configured),
 * `numa integrations request` (body).
 *
 * Convention shared by all consumers:
 *   1. Reserved per-command flags (--params / --props / --body /
 *      -m/--user-message / -y / output modes) get parsed by commander first.
 *   2. Anything left over (unknown flags + positionals) lands in a
 *      variadic `[args...]` bucket declared on the command.
 *   3. The consumer calls `splitExtraArgs(bucket)` to partition the
 *      bucket into typed positionals + ad-hoc flag pairs.
 *   4. Ad-hoc pairs get merged into the command's primary JSON param
 *      (priority: --json-blob > ad-hoc flags > positional shortcut).
 *
 * Commander needs `.allowUnknownOption(true)` on the command for unknown
 * flags to fall through to the bucket instead of erroring.
 */

import type { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';

/**
 * Resolve a JSON-blob option value to a parsed object. Supports two forms:
 *
 *   '{"key":"val"}'              → JSON.parse(literal)
 *   '@/path/to/file.json'        → read file → JSON.parse
 *   '@./relative/path.json'      → same, relative to cwd
 *
 * The `@` prefix is the curl convention — well-known to humans + LLMs and
 * dodges shell-escaping pain for big payloads (ticket bodies, integration
 * props with embedded HTML, etc.). Applies uniformly across every CLI
 * option that accepts a JSON blob: --params (ops), --props /
 * --configured / --body / --headers (integrations), and any future
 * additions.
 *
 * `optionName` is purely for error messages — pass the flag name without
 * the leading dashes (e.g. `'params'`, `'props'`).
 */
export const parseJsonBlob = <T = unknown>(raw: string, optionName = 'option'): T => {
  if (raw.startsWith('@')) {
    const path = raw.slice(1);
    if (!existsSync(path)) {
      throw new Error(`--${optionName} @${path}: file not found`);
    }
    let text: string;
    try {
      text = readFileSync(path, 'utf-8');
    } catch (err) {
      throw new Error(`--${optionName} @${path}: read failed — ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new Error(`--${optionName} @${path}: invalid JSON — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(
      `--${optionName}: must be valid JSON (or @path to a JSON file) — ${err instanceof Error ? err.message : String(err)}`
    );
  }
};

/** kebab-case → camelCase (`--ticket-type-id` → `ticketTypeId`). */
export const camelize = (s: string): string => s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

/**
 * Add the standard cross-command options to a Commander command:
 *
 *   -m, --user-message <text>     REQUIRED (by default) — human-readable
 *                                 caption shown to the user in chat as
 *                                 "(tool icon) Numa <Category>: <user-message>".
 *                                 Also used as the approval card text for
 *                                 HITL-gated write ops. The LLM should
 *                                 always supply this — it's the user's
 *                                 only window into what a tool is doing.
 *   --pretty / --standard / --json  Output mode (mutually exclusive).
 *
 * Pass `{ userMessageRequired: false }` for purely-local commands that
 * never hit the dispatcher (auth state mutations, dev-context tools).
 * Everything that produces a network call should keep the default.
 */
export interface StandardOptionsConfig {
  /** Default `true` — required on every API-hitting command. */
  userMessageRequired?: boolean;
}

/** Add only the three output-mode flags. Used by purely-local commands
 *  (auth/login, profile, dev-context) that don't hit the dispatcher. */
export function addOutputModeOptions(cmd: Command): Command {
  cmd.option('--pretty', 'Force human-readable output');
  cmd.option('--standard', 'Force standard envelope output (LLM-friendly)');
  cmd.option('--json', 'Force raw JSON output');
  return cmd;
}

export function addStandardOptions(cmd: Command, cfg: StandardOptionsConfig = {}): Command {
  // We declare --user-message as a regular `.option` (NOT requiredOption)
  // even when required, then enforce in the action handler. Reason:
  // commander's `.requiredOption` on a parent command propagates to
  // subcommand parsing too — e.g. `numa-dev ops test` would trip the
  // requirement even though the test runner doesn't make a real tool call.
  // Declaring as optional + manual check sidesteps that.
  //
  // `requireUserMessage(options)` should be called at the top of every
  // action handler that needs it.
  const required = cfg.userMessageRequired ?? true;
  const userMessageDesc =
    'Short human-readable caption shown to the user in chat ("Numa <category>: <msg>"). ' +
    'For HITL-gated write ops, also rendered as the approval card text. ' +
    (required ? 'REQUIRED — the LLM must always supply this.' : 'Optional.');
  cmd.option('-m, --user-message <text>', userMessageDesc);
  return addOutputModeOptions(cmd);
}

/**
 * Throw a clear error when --user-message is missing. Call at the top of
 * every action handler that needs it (i.e. anything that hits the
 * dispatcher). Mirrors commander's own required-option error message so
 * the UX is identical to a `.requiredOption` failure.
 */
export function requireUserMessage(options: {
  userMessage?: string;
}): asserts options is { userMessage: string } & typeof options {
  if (!options.userMessage) {
    // Match commander's own error format for consistency.
    process.stderr.write("error: required option '-m, --user-message <text>' not specified\n");
    process.exit(1);
  }
}

/** OutputModeFlags + the user-message field, as parsed by commander. */
export interface StandardOptions {
  userMessage?: string;
  pretty?: boolean;
  standard?: boolean;
  json?: boolean;
}

/**
 * Best-effort JS-value coercion for ad-hoc CLI flag values. Tries
 * booleans, integers, floats, JSON objects/arrays — falls back to string.
 *
 *   "true"      → true
 *   "42"        → 42
 *   '{"x":1}'   → { x: 1 }
 *   "[1,2,3]"   → [1, 2, 3]
 *   "TST-001"   → "TST-001"  (stringy ID, left as-is)
 *
 * Note: only coerces the RHS of an ad-hoc flag. Reserved JSON-blob
 * options (--params, --props, etc.) bypass this and use raw JSON.parse.
 */
export const coerceValue = (s: string): unknown => {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  if (s.startsWith('[') || s.startsWith('{')) {
    try {
      return JSON.parse(s);
    } catch {
      /* fall through to string */
    }
  }
  return s;
};

export interface SplitExtraArgs {
  /** Non-flag positional tokens (e.g. the search term in `ops search_customers acme`). */
  positionals: string[];
  /** Parsed `--key value` pairs, keys camelized + values coerced. */
  adHoc: Record<string, unknown>;
}

/**
 * Parse the variadic `[args...]` bucket into typed positionals + ad-hoc
 * flag pairs.
 *
 *   ["test", "--limit", "10", "--flag", "--key", "val"]
 *     → { positionals: ["test"], adHoc: { limit: 10, flag: true, key: "val" } }
 *
 * "Bare" flags (a `--key` with no following value, or followed by another
 * `--key`) become `true`. Reserved flag names declared on the command
 * (`--params`, `-m`/`--user-message`, `--yes`, output modes) are stripped
 * by commander before we see them, so we never need to filter them out here.
 */
export const splitExtraArgs = (extra: string[]): SplitExtraArgs => {
  const positionals: string[] = [];
  const adHoc: Record<string, unknown> = {};
  for (let i = 0; i < extra.length; i++) {
    const tok = extra[i]!;
    if (tok.startsWith('--')) {
      const key = camelize(tok.slice(2));
      const next = extra[i + 1];
      if (next === undefined || next.startsWith('--')) {
        adHoc[key] = true;
      } else {
        adHoc[key] = coerceValue(next);
        i += 1; // consume value
      }
    } else {
      positionals.push(tok);
    }
  }
  return { positionals, adHoc };
};
