/**
 * `numa bootstrap`
 *
 * Calls /api/cli/bootstrap on the active Numa instance and writes the response
 * to ~/.config/numa/context-<account>.json. Run automatically as the last step
 * of `numa login`; can also be invoked manually to refresh after the user's
 * groups, integrations, or settings change server-side.
 *
 * Failure here is non-fatal — the CLI's other commands work fine without a
 * context file (it's just a local cache for richer --help and pre-flight
 * validation later). The error gets reported but the parent flow continues.
 */

import { Command } from 'commander';
import { fetchBootstrap } from '../api/bootstrap.js';
import { getValidTokens } from '../auth/tokens.js';
import { activeProfile, saveContext } from '../context/store.js';
import { fail, info, success, warn } from '../output/pretty.js';
import { emitResult } from '../output/emit.js';
import { type OutputModeFlags } from '../output/mode.js';

export async function runBootstrap(account: string): Promise<void> {
  const tokens = await getValidTokens(account);
  const ctx = await fetchBootstrap(account, tokens.accessToken);
  saveContext(account, ctx);
}

export function createBootstrapCommand(): Command {
  return new Command('bootstrap')
    .description('Refresh ~/.config/numa/context-<account>.json from /api/cli/bootstrap')
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (options: OutputModeFlags) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      try {
        const tokens = await getValidTokens(account);
        const ctx = await fetchBootstrap(account, tokens.accessToken);
        saveContext(account, ctx);
        emitResult({
          tool: 'bootstrap',
          result: ctx,
          options,
          pretty: (c) => success(`bootstrap saved for '${account}' (client_name=${c.client_name})`),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        fail(`bootstrap failed: ${msg}`);
      }
    });
}

/** Best-effort post-login bootstrap. Does not throw — failure is just a warn. */
export async function tryBootstrapAfterLogin(account: string): Promise<void> {
  try {
    await runBootstrap(account);
    info(`bootstrap saved (~/.config/numa/context-${account}.json)`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    warn(
      `post-login bootstrap failed (${msg}). This is non-fatal — login succeeded. ` +
        `Run \`numa bootstrap\` later or check that numa-cli-api is enabled on this client.`
    );
  }
}
