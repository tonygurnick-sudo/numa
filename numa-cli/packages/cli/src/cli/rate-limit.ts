/**
 * Friendly per-command `numa` call cap — a cost guard, not a wall.
 *
 * A single Bash command can spawn an unbounded number of `numa` processes (a
 * loop, `xargs`, `bash script.sh`, a python `subprocess`). The turn limit caps
 * turns, not `numa` calls, so one runaway loop in a single command can run up
 * cost. This caps the calls per command and tells the model how to continue:
 * start a new command (each gets a fresh budget).
 *
 * How it works (no command rewriting — that broke the Bash(numa:*) allowlist):
 *   - The workspace agent's `numa_call_counter_reset_hook` (PreToolUse, Bash)
 *     truncates `<tmp>/.numa-call-count` at the START of every Bash command —
 *     a side effect on the container side, invisible to the sandbox.
 *   - Here, each `numa` invocation appends ONE byte to that file and reads its
 *     SIZE as the count (atomic appends, lock-free). Past the limit we exit
 *     non-zero WITHOUT doing the work — so even if a `for` loop keeps spinning,
 *     the cost stops dead. The next Bash command's hook resets the file → the
 *     model resumes with a fresh budget.
 *
 * Workspace-only (NUMA_CONVERSATION_ID set); laptop/dev runs are never capped.
 * Soft guard by design — correct for an *honest* runaway loop, not an
 * adversarial one (the model could overwrite the counter, but has no reason
 * to). Best-effort throughout: any fs failure fails open rather than breaking a
 * real call.
 */

import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_LIMIT = 500;
/** Flag file the agent's PostToolUse hook reads to tell the model the cap was
 * hit — so the signal reaches the model even if the command redirected
 * stdout/stderr (`numa … >/dev/null 2>&1`). The reset hook clears it. */
const LIMIT_FLAG = '.numa-call-limited';

/** Mirror of standard.ts's resolveTmpDir for the workspace path. */
function resolveTmpDir(): string {
  const fromEnv = process.env['NUMA_CLI_TMP_DIR'];
  if (fromEnv) return fromEnv;
  if (process.env['NUMA_CONVERSATION_ID']) return '/workdir/tmp/numa-cli';
  return './tmp/numa-cli';
}

function resolveLimit(): number {
  const raw = Number.parseInt(process.env['NUMA_CALL_LIMIT'] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LIMIT;
}

/**
 * Count this `numa` invocation against the current command's budget and exit(1)
 * with a friendly, actionable message once it exceeds the limit. No-op outside
 * a workspace MicroVM. Called from the CLI's `preAction` so BOTH reads and
 * writes count (a runaway read loop costs just as much as a write loop).
 */
export function enforceNumaCallLimit(): void {
  // Workspace-only. Laptop/dev runs have no conversation id and are never capped.
  if (!process.env['NUMA_CONVERSATION_ID']) return;

  const tmpDir = resolveTmpDir();
  const counterFile = join(tmpDir, '.numa-call-count');
  const limit = resolveLimit();

  try {
    mkdirSync(tmpDir, { recursive: true });
    appendFileSync(counterFile, '\0');
    const count = statSync(counterFile).size;
    if (count > limit) {
      // Drop a flag the PostToolUse hook turns into model context, so the cap
      // is visible even when this command swallowed stdout/stderr.
      try {
        writeFileSync(join(tmpDir, LIMIT_FLAG), '1');
      } catch {
        /* best-effort */
      }
      process.stderr.write(
        `numa: this command reached the limit of ${limit} numa calls. ` +
          `Start a NEW command to continue, skipping work already done — ` +
          `big jobs should be split into separate commands of a few hundred calls each.\n`
      );
      process.exit(1);
    }
  } catch {
    // Never let the limiter break a real call.
  }
}
