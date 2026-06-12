/**
 * Terminal HITL helper. `numa-dev` uses this for write-op confirmation
 * before sending to the Lambda; the prod `numa` binary doesn't import it.
 *
 * Behaviour matrix:
 *   - Non-TTY (script / pipe / workspace-bound)  → no prompt, returns true.
 *     The user is running this non-interactively and consented by writing
 *     the command. Workspace-bound HITL is a separate flow (Phase 3+; see
 *     planning doc) — when NUMA_CONVERSATION_ID is set we'll emit SSE
 *     approval events instead of terminal prompts. Today we treat
 *     in-workspace the same as "no prompt".
 *   - `--yes` (NUMA_DEV_AUTO_YES=1)              → no prompt, returns true.
 *     Explicit caller opt-out for scripted dev usage.
 *   - TTY with no auto-yes                       → [y/N] prompt, default N.
 *
 * Output goes to stderr so JSON consumers piping stdout still get clean
 * JSON.
 */

import { prompt } from '../commands/prompt.js';

export interface ConfirmOptions {
  /** Summary line printed before the prompt. e.g. "Delete Personal/notes.md" */
  title: string;
  /** Optional extra detail lines printed below the title. */
  detail?: string[];
  /**
   * Word the user has to type to confirm. Use 'yes' for destructive ops
   * where a casual `y` shouldn't suffice. Defaults to 'y/yes'.
   */
  requireWord?: 'y' | 'yes';
}

const writeLine = (s: string): void => {
  process.stderr.write(s + '\n');
};

export const confirm = async (opts: ConfirmOptions): Promise<boolean> => {
  // Non-TTY → no prompt. Matches the planning-doc rule: HITL on dev binary
  // is for interactive humans only. Scripts / workspace-bound usage pass
  // through.
  if (!process.stdin.isTTY || !process.stdout.isTTY) return true;
  // --yes / NUMA_DEV_AUTO_YES → no prompt. Wired in `numa-dev.ts`'s root
  // preAction hook.
  if (process.env['NUMA_DEV_AUTO_YES'] === '1') return true;

  writeLine('');
  writeLine(`⚠  ${opts.title}`);
  for (const line of opts.detail ?? []) writeLine(`   ${line}`);

  const required = opts.requireWord ?? 'y';
  const promptLabel = required === 'yes' ? "  Type 'yes' to confirm: " : '  Proceed? [y/N]: ';
  const answer = (await prompt(promptLabel)).trim().toLowerCase();

  if (required === 'yes') return answer === 'yes';
  return answer === 'y' || answer === 'yes';
};
