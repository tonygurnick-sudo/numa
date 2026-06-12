/**
 * Output-mode resolution. Three mutually exclusive modes:
 *
 *   pretty    Per-command human renderer (tables, colored summaries,
 *             truncated content). What you see when you run a command in
 *             a terminal.
 *   standard  `_summary` envelope with schema + sample + file path (or
 *             inlined data for small results). Designed for LLM
 *             consumers — keeps context lean and lets the LLM use code
 *             (cat / jq / python) to query large results from disk.
 *   json      Raw passthrough — exactly what the tool returned. For
 *             scripts that want clean data to pipe through jq etc.
 *
 * Resolution priority (highest wins):
 *   1. Per-command flag (`--pretty`, `--standard`, `--json`)
 *   2. Root-level flag (`numa --json memory list`) — root preAction
 *      stashes the choice in NUMA_OUTPUT_MODE so this layer can read it.
 *   3. NUMA_OUTPUT_MODE env var (for scripting)
 *   4. Context default:
 *        - TTY                            → pretty (humans)
 *        - NUMA_CONVERSATION_ID present   → standard (LLM in workspace)
 *        - otherwise (non-TTY scripts)    → json (clean pipe data)
 */

export type OutputMode = 'pretty' | 'standard' | 'json';

export interface OutputModeFlags {
  pretty?: boolean;
  standard?: boolean;
  json?: boolean;
}

const isValidMode = (v: unknown): v is OutputMode => v === 'pretty' || v === 'standard' || v === 'json';

const pickFromFlags = (flags: OutputModeFlags | undefined): OutputMode | undefined => {
  if (!flags) return undefined;
  if (flags.json) return 'json';
  if (flags.standard) return 'standard';
  if (flags.pretty) return 'pretty';
  return undefined;
};

/**
 * Resolve the active output mode. Root-level flags are stashed in
 * NUMA_OUTPUT_MODE by the binary's preAction hook, so this layer only
 * needs to inspect per-command flags + env + context.
 */
export const resolveOutputMode = (localFlags?: OutputModeFlags): OutputMode => {
  const fromLocal = pickFromFlags(localFlags);
  if (fromLocal) return fromLocal;

  const fromEnv = process.env['NUMA_OUTPUT_MODE'];
  if (isValidMode(fromEnv)) return fromEnv;

  if (process.stdout.isTTY) return 'pretty';
  if (process.env['NUMA_CONVERSATION_ID']) return 'standard';
  return 'json';
};
