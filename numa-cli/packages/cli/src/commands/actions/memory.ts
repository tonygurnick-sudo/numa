/**
 * `numa memory <action>` — long-term memory the assistant carries between
 * conversations. Wraps the `user_profile_*_memory` tools in
 * `workspace-chat-tools` 1:1 (the same surface the chat UI's "Update
 * Memory" tool exposes).
 *
 * Storage: chat-settings DynamoDB table, `userProfile.memories` attribute
 * (per `tools/user_profile.py`). Server enforces a 300-char/entry limit
 * and a 50-entry total cap.
 *
 * Tool gating: `workspace-chat-tools` requires `event.allowed_tools` to
 * include `"memories_tool"`. We forward what's in the resolved
 * `enabled_tools` scope (workspace inherits `NUMA_ENABLED_TOOLS`); for
 * local CLI invocations we auto-inject `memories_tool` because the
 * human typing `numa memory ...` *is* the policy. This mirrors
 * `--conversation-id` handling in docs.ts — workspace context narrows,
 * local context grants per-command.
 *
 * HITL: delete + (in numa-dev) update prompt for confirmation following
 * the same pattern as `numa files delete`. `--yes` short-circuits.
 */

import { Command } from 'commander';
import { getValidTokens } from '../../auth/tokens.js';
import { activeProfile } from '../../context/store.js';
import { resolveScopingContext, type ScopingContext } from '../../context/resolve.js';
import { invokeTool, type ToolInvokeRequest } from '../../api/tools.js';
import type { ParamsForTool, ToolName } from '../../metadata/tool-types.js';
import { fail } from '../../output/pretty.js';
import { emitResult } from '../../output/emit.js';
import { requireUserMessage, type StandardOptions } from '../../output/cli-args.js';
import { requiresLocalApproval } from '../../context/approval.js';
import { gateWriteOp } from './_hitl.js';

const MEMORIES_TOOL = 'memories_tool';
const VALID_SCOPE_PATTERN = /^(general|integration:.+|agent:.+)$/;

/**
 * Build the enabled_tools list to forward. In a workspace, respect the
 * frontend toggle list (don't grant tools the user didn't enable). Local
 * CLI users get `memories_tool` auto-merged so they don't have to
 * remember to seed it via `numa-dev context set`.
 */
function resolveEnabledTools(scope: ScopingContext): string[] {
  const base = scope.enabled_tools ?? [];
  if (scope.source === 'workspace-env') return base;
  return base.includes(MEMORIES_TOOL) ? base : [...base, MEMORIES_TOOL];
}

/**
 * Shared request builder. Mirrors files/docs but always includes
 * enabled_tools (memories handlers gate on it server-side).
 */
async function buildMemoryRequest<T extends ToolName>(
  account: string,
  tool: T,
  params: ParamsForTool<T>,
  userMessage: string | undefined
): Promise<{ accessToken: string; request: ToolInvokeRequest<T>; scope: ScopingContext }> {
  requireUserMessage({ userMessage: userMessage });
  const tokens = await getValidTokens(account);
  const scope = resolveScopingContext(account);
  const request: ToolInvokeRequest<T> = {
    tool,
    params,
    context: {
      allowed_kbs: scope.allowed_kbs,
      allowed_kb_operations: scope.allowed_kb_operations,
      enabled_tools: resolveEnabledTools(scope),
      conversation_id: scope.conversation_id || undefined,
    },
    id_token: tokens.idToken,
    user_message: userMessage,
  };
  return { accessToken: tokens.accessToken, request, scope };
}

function validateScopeFlag(scope: string | undefined): void {
  if (!scope) return;
  if (!VALID_SCOPE_PATTERN.test(scope)) {
    fail(`invalid --scope '${scope}'. Must be 'general', 'integration:<slug>', or 'agent:<id>'`);
  }
}

/**
 * `numa memory list [--scope X]` — show stored memories.
 */
function createMemoryListCommand(): Command {
  return new Command('list')
    .description("List your memories (the assistant's long-term notes about you)")
    .option('--scope <scope>', "Filter to a scope ('general' | 'integration:<slug>' | 'agent:<id>')")
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (options: { scope?: string } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      validateScopeFlag(options.scope);

      const params: ParamsForTool<'user_profile_list_memories'> = {
        ...(options.scope ? { scope: options.scope } : {}),
      };
      const { accessToken, request } = await buildMemoryRequest(
        account,
        'user_profile_list_memories',
        params,
        options.userMessage
      );

      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(`memory list failed: ${res.error ?? '<no message>'}`);

      emitResult({
        tool: 'user_profile_list_memories',
        result: res.result,
        options,
        pretty: (r) => {
          const memories = r?.memories ?? [];
          if (memories.length === 0) {
            process.stdout.write('(no memories)\n');
            return;
          }
          // Compact table: id | scope | content (truncated)
          const idWidth = Math.max(...memories.map((m) => m.id.length), 2);
          const scopeWidth = Math.max(...memories.map((m) => m.scope.length), 5);
          process.stdout.write(`${'id'.padEnd(idWidth)}  ${'scope'.padEnd(scopeWidth)}  content\n`);
          process.stdout.write(`${'-'.repeat(idWidth)}  ${'-'.repeat(scopeWidth)}  -------\n`);
          for (const m of memories) {
            const content = m.content.length > 80 ? m.content.slice(0, 79) + '…' : m.content;
            process.stdout.write(`${m.id.padEnd(idWidth)}  ${m.scope.padEnd(scopeWidth)}  ${content}\n`);
          }
          if (r && r.filtered_count !== r.total_count) {
            process.stderr.write(`numa: showing ${r.filtered_count} of ${r.total_count} memories\n`);
          }
        },
      });
    });
}

/**
 * `numa memory show <id>` — convenience: local filter to one memory.
 * No round-trip cost since list already returned everything we need;
 * we still hit the server to ensure freshness.
 */
function createMemoryShowCommand(): Command {
  return new Command('show')
    .description('Show full content of a single memory by id')
    .argument('<id>', 'Memory id (e.g. mem_abc123)')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (id: string, options: StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      const { accessToken, request } = await buildMemoryRequest(
        account,
        'user_profile_list_memories',
        {},
        options.userMessage
      );
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(`memory show failed: ${res.error ?? '<no message>'}`);

      const memory = (res.result?.memories ?? []).find((m) => m.id === id);
      if (!memory) fail(`memory '${id}' not found`);

      // `show` is a local filter on the list result; we emit the single
      // memory object. The envelope's `tool` mirrors that — using
      // list_memories so the LLM knows what shape it's seeing.
      emitResult({
        tool: 'user_profile_list_memories',
        result: memory,
        options,
        pretty: (m) => {
          process.stdout.write(`id:        ${m.id}\n`);
          process.stdout.write(`scope:     ${m.scope}\n`);
          process.stdout.write(`source:    ${m.source}\n`);
          process.stdout.write(`createdAt: ${m.createdAt}\n`);
          process.stdout.write(`content:\n${m.content}\n`);
        },
      });
    });
}

/**
 * `numa memory add <content> [--scope X]` — append a new memory.
 * Server-side: enforces 300-char limit and 50-entry cap.
 */
function createMemoryAddCommand(): Command {
  return new Command('add')
    .description('Add a new memory (long-term note the assistant will remember)')
    .argument('<content>', 'Memory content (max 300 chars, server-enforced)')
    .option('--scope <scope>', "Scope tag (default 'general'; also 'integration:<slug>' | 'agent:<id>')")
    .option('-y, --yes', 'Skip the local confirmation prompt for non-destructive writes')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (content: string, options: { scope?: string; yes?: boolean } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      validateScopeFlag(options.scope);

      const { requestId, autoApproved } = await gateWriteOp({
        requiresApproval: requiresLocalApproval('memories', 'add', account),
        yes: !!options.yes,
        confirmOpts: {
          title: `add memory: "${content.length > 80 ? content.slice(0, 79) + '…' : content}"`,
        },
        emit: {
          actionKey: 'numa_memories_add',
          toolName: 'memories_tool',
          description: options.userMessage!,
          propsPreview: { memory: (content as string).slice(0, 200) },
          approvalCategory: 'numa_tool',
        },
      });

      const params: ParamsForTool<'user_profile_add_memory'> = {
        content,
        ...(options.scope ? { scope: options.scope } : {}),
        auto_approved: autoApproved,
      };

      const { accessToken, request } = await buildMemoryRequest(
        account,
        'user_profile_add_memory',
        params,
        options.userMessage
      );
      if (requestId) request.request_id = requestId;
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(`memory add failed: ${res.error ?? '<no message>'}`);

      emitResult({
        tool: 'user_profile_add_memory',
        result: res.result,
        options,
        pretty: (r) => {
          const m = r?.memory;
          if (m) {
            process.stderr.write(`numa: added ${m.id} (${r?.total_count ?? '?'} total)\n`);
            process.stdout.write(`${m.id}\n`);
          }
        },
      });
    });
}

/**
 * `numa memory update <id> <content>` — replace an existing memory's
 * content.
 */
function createMemoryUpdateCommand(): Command {
  return new Command('update')
    .description('Replace the content of an existing memory')
    .argument('<id>', 'Memory id (e.g. mem_abc123)')
    .argument('<content>', 'New content (max 300 chars)')
    .option('-y, --yes', 'Skip the local confirmation prompt')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (id: string, content: string, options: { yes?: boolean } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      const { requestId, autoApproved } = await gateWriteOp({
        requiresApproval: requiresLocalApproval('memories', 'update', account),
        yes: !!options.yes,
        confirmOpts: {
          title: `update ${id} → "${content.length > 80 ? content.slice(0, 79) + '…' : content}"`,
        },
        emit: {
          actionKey: 'numa_memories_update',
          toolName: 'memories_tool',
          description: options.userMessage!,
          propsPreview: { id },
          approvalCategory: 'numa_tool',
        },
      });

      const params: ParamsForTool<'user_profile_update_memory'> = {
        memory_id: id,
        content,
        auto_approved: autoApproved,
      };
      const { accessToken, request } = await buildMemoryRequest(
        account,
        'user_profile_update_memory',
        params,
        options.userMessage
      );
      if (requestId) request.request_id = requestId;
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(`memory update failed: ${res.error ?? '<no message>'}`);

      emitResult({
        tool: 'user_profile_update_memory',
        result: res.result,
        options,
        pretty: (r) => {
          const m = r?.memory;
          if (m) process.stderr.write(`numa: updated ${m.id}\n`);
        },
      });
    });
}

/**
 * `numa memory delete <id>` — remove a memory. Always prompts in pretty
 * mode (destructive); `--yes` short-circuits.
 */
function createMemoryDeleteCommand(): Command {
  return new Command('delete')
    .description('Delete a memory by id (destructive)')
    .argument('<id>', 'Memory id (e.g. mem_abc123)')
    .option('-y, --yes', 'Skip the destructive-op confirmation prompt')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (id: string, options: { yes?: boolean } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      const { requestId, autoApproved } = await gateWriteOp({
        requiresApproval: requiresLocalApproval('memories', 'delete', account),
        yes: !!options.yes,
        confirmOpts: {
          title: `permanently delete memory ${id}`,
          requireWord: 'yes',
        },
        emit: {
          actionKey: 'numa_memories_delete',
          toolName: 'memories_tool',
          description: options.userMessage!,
          propsPreview: { id },
          approvalCategory: 'numa_tool',
        },
      });

      const params: ParamsForTool<'user_profile_delete_memory'> = {
        memory_id: id,
        auto_approved: autoApproved,
      };
      const { accessToken, request } = await buildMemoryRequest(
        account,
        'user_profile_delete_memory',
        params,
        options.userMessage
      );
      if (requestId) request.request_id = requestId;
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(`memory delete failed: ${res.error ?? '<no message>'}`);

      emitResult({
        tool: 'user_profile_delete_memory',
        result: res.result,
        options,
        pretty: (r) => {
          const m = r?.memory;
          if (m) {
            process.stderr.write(`numa: deleted ${m.id} (${r?.total_count ?? '?'} remaining)\n`);
          }
        },
      });
    });
}

/**
 * Build the `numa memory` command tree.
 *
 * `memories` is an accepted alias: the user-facing feature and its skill are
 * both named "Memories", so the model reliably produces the plural — it
 * should work rather than be a teachable moment (live finding: Numa followed
 * a prompt example saying `numa memories add` and got "unknown command").
 * `memory` stays canonical to match the Phase-5 policy vocabulary and docs.
 */
export function createMemoryCommand(): Command {
  return new Command('memory')
    .alias('memories')
    .description('Long-term memory — list / add / update / delete entries the assistant remembers about you')
    .addCommand(createMemoryListCommand())
    .addCommand(createMemoryShowCommand())
    .addCommand(createMemoryAddCommand())
    .addCommand(createMemoryUpdateCommand())
    .addCommand(createMemoryDeleteCommand());
}
