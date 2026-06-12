/**
 * `numa-dev context <show|set|clear>` — manage the mock frontend payload.
 *
 * The dev binary lets us simulate "as if the frontend sent this exact enabled
 * list" without spinning a real chat conversation. Useful for testing the
 * scoping/filtering behaviour that Numa-the-LLM sees in production.
 *
 * Persists to ~/.config/numa/dev-context-<account>.json. `resolveScopingContext`
 * picks it up automatically when the file exists (and NUMA_CONVERSATION_ID
 * isn't set, which would mean we're in-workspace and should use those env vars
 * instead). Not in the prod binary — `numa` (prod) doesn't import this file.
 *
 * Subcommands:
 *   numa-dev context show               — print the current override
 *   numa-dev context set [options]      — merge into current override
 *   numa-dev context clear              — delete the override file
 */

import { Command } from 'commander';
import { activeProfile } from '@numa/cli/context';
import { clearDevContext, loadDevContext, saveDevContext, type DevContext } from '@numa/cli/context';
import { fail, info, isJsonMode, success } from '@numa/cli/output';
import { printJson } from '@numa/cli/output';
import { loadContext } from '@numa/cli/context';

/**
 * Bootstrap-shaped context — we only read what we need to resolve KB names
 * passed via `--allowed-kbs`.
 */
interface BootstrapContextSlice {
  knowledge_bases?: {
    kbs?: Array<{ kb_id: string; kb_name?: string }>;
  };
}

const parseCsv = (raw: string | undefined): string[] | undefined =>
  raw === undefined
    ? undefined
    : raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

/**
 * Resolve a CSV of folder names or ids into the [{id, name}] shape the
 * resolver expects. Looks up names against the bootstrap context's full KB
 * list so users can write `--allowed-kbs general,personal` instead of UUIDs.
 */
function resolveKbList(account: string, raw: string | undefined): Array<{ id: string; name?: string }> | undefined {
  const names = parseCsv(raw);
  if (names === undefined) return undefined;
  if (names.length === 0) return []; // explicit empty
  const bootstrap = loadContext<BootstrapContextSlice>(account);
  const allKbs = bootstrap?.knowledge_bases?.kbs ?? [];
  return names.map((needle) => {
    const lower = needle.toLowerCase();
    const match = allKbs.find((kb) => kb.kb_id === needle || (kb.kb_name ?? '').toLowerCase() === lower);
    if (match) return { id: match.kb_id, name: match.kb_name };
    // Pass-through: user might have intentionally typed a KB id we don't see
    // in bootstrap (e.g. testing access-denial paths). Resolver will forward
    // it; the server enforces actual access.
    return { id: needle };
  });
}

function createContextShowCommand(): Command {
  return new Command('show')
    .description('Print the current dev-context override (if any)')
    .option('--json', 'Force JSON output (default when piped)')
    .action((options: { json?: boolean }) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      const ctx = loadDevContext(account);
      if (!ctx) {
        if (isJsonMode(options)) {
          printJson(null);
        } else {
          process.stdout.write('(no dev-context override set — using bootstrap default)\n');
        }
        return;
      }
      if (isJsonMode(options)) {
        printJson(ctx);
        return;
      }
      process.stdout.write(JSON.stringify(ctx, null, 2) + '\n');
    });
}

function createContextSetCommand(): Command {
  return new Command('set')
    .description('Merge into (or create) the dev-context override file')
    .option(
      '--allowed-kbs <names-or-ids>',
      'Comma-separated folder names or IDs to enable. Pass an empty string to set the empty list explicitly'
    )
    .option('--allowed-kb-operations <ops>', 'Comma-separated KB sub-op whitelist (e.g. "query,kb_list" for read-only)')
    .option('--enabled-integrations <slugs>', 'Comma-separated Pipedream integration slugs (e.g. "gmail,slack")')
    .option('--enabled-native-connectors <slugs>', 'Comma-separated native connector slugs (e.g. "sharepoint")')
    .option('--enabled-tools <names>', 'Comma-separated functional tool toggles (e.g. "web_search")')
    .option(
      '--allowed-operations <ops>',
      'Comma-separated numa-tool operation whitelist (agent-type style restriction)'
    )
    .option(
      '--conversation-id <id>',
      'Simulate a specific conversation id (rarely needed locally; affects S3 path construction server-side)'
    )
    .option('--reset', 'Start from an empty override instead of merging with the existing one')
    .action((opts: Record<string, string | boolean | undefined>) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      const base: DevContext = opts['reset'] === true ? {} : (loadDevContext(account) ?? {});
      const next: DevContext = { ...base };

      const allowedKbs = resolveKbList(account, opts['allowedKbs'] as string | undefined);
      if (allowedKbs !== undefined) next.allowed_kbs = allowedKbs;

      const allowedKbOps = parseCsv(opts['allowedKbOperations'] as string | undefined);
      if (allowedKbOps !== undefined) next.allowed_kb_operations = allowedKbOps;

      const enabledInteg = parseCsv(opts['enabledIntegrations'] as string | undefined);
      if (enabledInteg !== undefined) next.enabled_integrations = enabledInteg;

      const enabledNative = parseCsv(opts['enabledNativeConnectors'] as string | undefined);
      if (enabledNative !== undefined) next.enabled_native_connectors = enabledNative;

      const enabledTools = parseCsv(opts['enabledTools'] as string | undefined);
      if (enabledTools !== undefined) next.enabled_tools = enabledTools;

      const allowedOps = parseCsv(opts['allowedOperations'] as string | undefined);
      if (allowedOps !== undefined) next.allowed_operations = allowedOps;

      const convId = opts['conversationId'];
      if (typeof convId === 'string') next.conversation_id = convId;

      saveDevContext(account, next);
      success(`dev-context saved for '${account}'`);
      info(JSON.stringify(next, null, 2));
    });
}

function createContextClearCommand(): Command {
  return new Command('clear')
    .description('Delete the dev-context override file (revert to bootstrap default)')
    .action(() => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      const removed = clearDevContext(account);
      if (removed) {
        success(`dev-context cleared for '${account}'`);
      } else {
        info(`no dev-context to clear for '${account}'`);
      }
    });
}

export function createDevContextCommand(): Command {
  return new Command('context')
    .description("Manage the dev-only mock frontend payload (simulates a conversation's enabled list)")
    .addCommand(createContextShowCommand())
    .addCommand(createContextSetCommand())
    .addCommand(createContextClearCommand());
}
