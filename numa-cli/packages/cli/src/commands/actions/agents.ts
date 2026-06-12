/**
 * `numa agents <action>` — agent CRUD + prompt editing. Wraps the seven
 * agent handlers in `workspace-chat-tools` 1:1:
 *
 *   list   → list_agents
 *   show   → get_agent
 *   create → create_agent
 *   update → update_agent
 *   patch-prompt → patch_agent_prompt  (cheap diff edits on long prompts)
 *   duplicate    → duplicate_agent      (always lands in personal scope)
 *   delete       → delete_agent          (new in this session)
 *
 * Tool gating: server requires `event.allowed_tools` to include
 * `"create_agent_tool"`. Same model as memory's `memories_tool`: workspace
 * context inherits NUMA_ENABLED_TOOLS (respects frontend toggle), local
 * CLI auto-injects (the human typing IS the policy).
 *
 * Permission model (server-side):
 *   - Personal agents (scope='user'): only the owner can read/edit/delete.
 *   - Workspace agents (scope='workspace'): anyone can read; only the
 *     creator OR an admin can edit/delete. Admin = "admin" in cognito:groups.
 *
 * The CLI plumbs user_email + user_groups from the auth context so these
 * checks work.
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { getValidTokens } from '../../auth/tokens.js';
import { activeProfile } from '../../context/store.js';
import { resolveScopingContext, type ScopingContext } from '../../context/resolve.js';
import { invokeTool, type ToolInvokeRequest } from '../../api/tools.js';
import type { Agent, ParamsForTool, ToolName } from '../../metadata/tool-types.js';
import { fail } from '../../output/pretty.js';
import { emitResult } from '../../output/emit.js';
import { requireUserMessage, type StandardOptions } from '../../output/cli-args.js';
import { requiresLocalApproval } from '../../context/approval.js';
import { gateWriteOp } from './_hitl.js';

const CREATE_AGENT_TOOL = 'create_agent_tool';

/** Workspace narrows to frontend-set toggles; locally auto-merge so commands work without dev-context setup. */
function resolveEnabledTools(scope: ScopingContext): string[] {
  const base = scope.enabled_tools ?? [];
  if (scope.source === 'workspace-env') return base;
  return base.includes(CREATE_AGENT_TOOL) ? base : [...base, CREATE_AGENT_TOOL];
}

async function buildAgentsRequest<T extends ToolName>(
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

/** Read --prompt or --prompt-file into a single string. Errors if both are set. */
function readPromptInput(
  inline: string | undefined,
  promptFile: string | undefined,
  required: boolean
): string | undefined {
  if (inline && promptFile) fail('--prompt and --prompt-file are mutually exclusive');
  if (inline) return inline;
  if (promptFile) {
    try {
      return readFileSync(promptFile, 'utf-8');
    } catch (err) {
      fail(`could not read --prompt-file '${promptFile}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (required) fail('one of --prompt or --prompt-file is required');
  return undefined;
}

// ── list ────────────────────────────────────────────────────────────────────

function createAgentsListCommand(): Command {
  return new Command('list')
    .description('List agents you own or have access to')
    .option('--scope <scope>', "'owned' (default), 'public', or 'all'", 'owned')
    .option('--type <agentType>', 'Filter by agent type')
    .option('--search <query>', 'Substring match across title/description/tags')
    .option('--title <query>', 'Substring match against title only')
    .option('--limit <n>', 'Max results (server caps at 200)', (v) => parseInt(v, 10))
    .option('--offset <n>', 'Pagination offset', (v) => parseInt(v, 10))
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: {
          scope?: 'owned' | 'public' | 'all';
          type?: string;
          search?: string;
          title?: string;
          limit?: number;
          offset?: number;
        } & StandardOptions
      ) => {
        const account = activeProfile();
        if (!account) fail('no active profile — run `numa login` first');

        const params: ParamsForTool<'list_agents'> = {
          scope: options.scope ?? 'owned',
          ...(options.type ? { agent_type: options.type } : {}),
          ...(options.search ? { search: options.search } : {}),
          ...(options.title ? { title: options.title } : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
          ...(options.offset !== undefined ? { offset: options.offset } : {}),
        };
        const { accessToken, request } = await buildAgentsRequest(account, 'list_agents', params, options.userMessage);
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(`agents list failed: ${res.error ?? '<no message>'}`);

        emitResult({
          tool: 'list_agents',
          result: res.result,
          options,
          pretty: (r) => {
            const agents = r?.agents ?? [];
            if (agents.length === 0) {
              process.stdout.write('(no agents)\n');
              return;
            }
            // Compact table: id | scope | visibility | title
            const idWidth = Math.max(...agents.map((a) => a.agentId.length), 2);
            const scopeWidth = Math.max(...agents.map((a) => a.scope.length), 5);
            const visWidth = Math.max(...agents.map((a) => String(a.visibility).length), 10);
            process.stdout.write(
              `${'id'.padEnd(idWidth)}  ${'scope'.padEnd(scopeWidth)}  ${'visibility'.padEnd(visWidth)}  title\n`
            );
            process.stdout.write(`${'-'.repeat(idWidth)}  ${'-'.repeat(scopeWidth)}  ${'-'.repeat(visWidth)}  -----\n`);
            for (const a of agents) {
              const title = a.title.length > 60 ? a.title.slice(0, 59) + '…' : a.title;
              process.stdout.write(
                `${a.agentId.padEnd(idWidth)}  ${a.scope.padEnd(scopeWidth)}  ${String(a.visibility).padEnd(visWidth)}  ${title}\n`
              );
            }
            if (r?.pagination) {
              process.stderr.write(
                `numa: ${r.pagination.offset + agents.length} of ${r.pagination.total}${r.pagination.hasMore ? ' (more available — use --offset)' : ''}\n`
              );
            }
          },
        });
      }
    );
}

// ── show ────────────────────────────────────────────────────────────────────

function printAgentDetail(a: Agent): void {
  process.stdout.write(`id:              ${a.agentId}\n`);
  process.stdout.write(`scope:           ${a.scope}\n`);
  process.stdout.write(`visibility:      ${a.visibility}\n`);
  process.stdout.write(`agentType:       ${a.agentType}\n`);
  process.stdout.write(`title:           ${a.title}\n`);
  if (a.description) process.stdout.write(`description:     ${a.description}\n`);
  if (a.createdBy?.name) process.stdout.write(`createdBy:       ${a.createdBy.name} (${a.createdBy.userId ?? '?'})\n`);
  if (a.updatedAt) process.stdout.write(`updatedAt:       ${new Date(a.updatedAt).toISOString()}\n`);
  if (a.requiredIntegrations?.length) {
    process.stdout.write(`requiredIntegrations: ${a.requiredIntegrations.join(', ')}\n`);
  }
  if (a.referenceFiles?.length) {
    process.stdout.write(`referenceFiles:  ${a.referenceFiles.length}\n`);
    for (const f of a.referenceFiles) {
      process.stdout.write(`  - ${f.fileName}${f.fileSize ? ` (${f.fileSize} bytes)` : ''}\n`);
    }
  }
  if (a.sourceAgentId) process.stdout.write(`sourceAgentId:   ${a.sourceAgentId}\n`);
  if (a.systemPrompt) {
    process.stdout.write(`systemPrompt:\n${a.systemPrompt}\n`);
  }
}

function createAgentsShowCommand(): Command {
  return new Command('show')
    .description('Show full details of a single agent (includes systemPrompt)')
    .argument('<id>', 'Agent id (e.g. agt_abc123)')
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

      const { accessToken, request } = await buildAgentsRequest(
        account,
        'get_agent',
        { agent_id: id },
        options.userMessage
      );
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(`agents show failed: ${res.error ?? '<no message>'}`);

      emitResult({
        tool: 'get_agent',
        result: res.result,
        options,
        pretty: (r) => {
          if (r?.agent) printAgentDetail(r.agent);
        },
      });
    });
}

// ── create ──────────────────────────────────────────────────────────────────

function createAgentsCreateCommand(): Command {
  return new Command('create')
    .description('Create a new agent')
    .argument('<title>', 'Agent title')
    .option('--prompt <text>', 'System prompt (inline). Use --prompt-file for longer prompts.')
    .option('--prompt-file <path>', 'Read system prompt from a local file')
    .option('--visibility <v>', "'personal' (default) or 'public' (workspace-shared)", 'personal')
    .option('--type <agentType>', "Agent type (default: 'task')", 'task')
    .option('--description <text>', 'Optional description')
    .option('--welcome <text>', 'User-facing welcome message shown when the agent opens')
    .option('--time-saved <minutes>', 'Estimated minutes saved per use', (v) => parseInt(v, 10))
    .option('--icon <name>', 'Icon class name (e.g. Lucide icon)')
    .option(
      '--integration <slug>',
      'Required integration slug (repeatable)',
      (val, prev: string[]) => [...(prev ?? []), val],
      []
    )
    .option(
      '--attach <path>',
      'Workspace file to attach as a reference (repeatable, max 5)',
      (val, prev: string[]) => [...(prev ?? []), val],
      []
    )
    .option('-y, --yes', 'Skip the local confirmation prompt')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        title: string,
        options: {
          prompt?: string;
          promptFile?: string;
          visibility?: 'personal' | 'public';
          type?: string;
          description?: string;
          welcome?: string;
          timeSaved?: number;
          icon?: string;
          integration?: string[];
          attach?: string[];
          yes?: boolean;
        } & StandardOptions
      ) => {
        const account = activeProfile();
        if (!account) fail('no active profile — run `numa login` first');

        const visibility = options.visibility ?? 'personal';
        if (visibility !== 'personal' && visibility !== 'public') {
          fail(`--visibility must be 'personal' or 'public', got '${visibility}'`);
        }

        const systemPrompt = readPromptInput(options.prompt, options.promptFile, true)!;

        const { requestId, autoApproved } = await gateWriteOp({
          requiresApproval: requiresLocalApproval('agents', 'create', account),
          yes: !!options.yes,
          confirmOpts: {
            title: `Create agent "${title}" (${visibility})`,
            detail: [
              `Type: ${options.type ?? 'task'}`,
              `Prompt: ${systemPrompt.length} chars`,
              ...(options.attach?.length ? [`Attaching: ${options.attach.length} file(s)`] : []),
            ],
          },
          emit: {
            actionKey: 'numa_agents_create',
            toolName: 'create_agent_tool',
            description: options.userMessage!,
            propsPreview: { title, visibility },
            approvalCategory: 'numa_tool',
          },
        });

        const params: ParamsForTool<'create_agent'> = {
          title,
          systemPrompt,
          visibility,
          ...(options.type ? { agentType: options.type } : {}),
          ...(options.description ? { description: options.description } : {}),
          ...(options.welcome ? { userWelcomeMessage: options.welcome } : {}),
          ...(options.timeSaved !== undefined ? { estimatedTimeSavedMinutes: options.timeSaved } : {}),
          ...(options.icon ? { icon: options.icon } : {}),
          ...(options.integration?.length ? { requiredIntegrations: options.integration } : {}),
          ...(options.attach?.length ? { attachFiles: options.attach } : {}),
          auto_approved: autoApproved,
        };

        const { accessToken, request, scope } = await buildAgentsRequest(
          account,
          'create_agent',
          params,
          options.userMessage
        );
        if (requestId) request.request_id = requestId;
        if (options.attach?.length && !scope.conversation_id) {
          fail(
            '--attach requires a conversation context (in-workspace or `numa-dev context set --conversation-id`). ' +
              'The server resolves the workspace path against the conversation to copy the file.'
          );
        }

        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(`agents create failed: ${res.error ?? '<no message>'}`);

        emitResult({
          tool: 'create_agent',
          result: res.result,
          options,
          pretty: (r) => {
            if (r?.agent) {
              process.stderr.write(`numa: created ${r.agent.title} (${r.agent.agentId})\n`);
              process.stdout.write(`${r.agent.agentId}\n`);
            }
            if (r?.fileWarnings?.length) {
              for (const w of r.fileWarnings) {
                process.stderr.write(`numa: warning — ${w}\n`);
              }
            }
          },
        });
      }
    );
}

// ── update ──────────────────────────────────────────────────────────────────

function createAgentsUpdateCommand(): Command {
  return new Command('update')
    .description('Update fields on an existing agent (use patch-prompt for prompt diffs)')
    .argument('<id>', 'Agent id')
    .option('--title <text>', 'New title')
    .option('--prompt <text>', 'New system prompt (inline). Use --prompt-file for longer prompts.')
    .option('--prompt-file <path>', 'Read system prompt from a local file')
    .option('--visibility <v>', "'personal' or 'public'")
    .option('--type <agentType>', 'New agent type')
    .option('--description <text>', 'New description')
    .option('--welcome <text>', 'New user welcome message')
    .option('--time-saved <minutes>', 'Estimated minutes saved per use', (v) => parseInt(v, 10))
    .option('--icon <name>', 'New icon class name')
    .option(
      '--integration <slug>',
      'Required integration slug (repeatable; replaces existing)',
      (val, prev: string[]) => [...(prev ?? []), val],
      []
    )
    .option(
      '--attach <path>',
      'Workspace file to attach (repeatable; appends to existing)',
      (val, prev: string[]) => [...(prev ?? []), val],
      []
    )
    .option('--favorite', 'Mark as favorite')
    .option('--no-favorite', 'Clear favorite')
    .option('-y, --yes', 'Skip the local confirmation prompt')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        id: string,
        options: {
          title?: string;
          prompt?: string;
          promptFile?: string;
          visibility?: 'personal' | 'public';
          type?: string;
          description?: string;
          welcome?: string;
          timeSaved?: number;
          icon?: string;
          integration?: string[];
          attach?: string[];
          favorite?: boolean;
          yes?: boolean;
        } & StandardOptions
      ) => {
        const account = activeProfile();
        if (!account) fail('no active profile — run `numa login` first');

        const systemPrompt = readPromptInput(options.prompt, options.promptFile, false);

        const { requestId, autoApproved } = await gateWriteOp({
          requiresApproval: requiresLocalApproval('agents', 'update', account),
          yes: !!options.yes,
          confirmOpts: {
            title: `Update agent ${id}`,
            detail: [
              ...(options.title ? [`title → "${options.title}"`] : []),
              ...(systemPrompt !== undefined ? [`prompt → ${systemPrompt.length} chars`] : []),
              ...(options.visibility ? [`visibility → ${options.visibility}`] : []),
            ],
          },
          emit: {
            actionKey: 'numa_agents_update',
            toolName: 'create_agent_tool',
            description: options.userMessage!,
            propsPreview: { agent_id: id },
            approvalCategory: 'numa_tool',
          },
        });

        const params: ParamsForTool<'update_agent'> = {
          agent_id: id,
          ...(options.title ? { title: options.title } : {}),
          ...(systemPrompt !== undefined ? { systemPrompt } : {}),
          ...(options.visibility ? { visibility: options.visibility } : {}),
          ...(options.type ? { agentType: options.type } : {}),
          ...(options.description ? { description: options.description } : {}),
          ...(options.welcome ? { userWelcomeMessage: options.welcome } : {}),
          ...(options.timeSaved !== undefined ? { estimatedTimeSavedMinutes: options.timeSaved } : {}),
          ...(options.icon ? { icon: options.icon } : {}),
          ...(options.integration?.length ? { requiredIntegrations: options.integration } : {}),
          ...(options.attach?.length ? { attachFiles: options.attach } : {}),
          ...(options.favorite !== undefined ? { isFavorite: options.favorite } : {}),
          auto_approved: autoApproved,
        };

        const { accessToken, request } = await buildAgentsRequest(account, 'update_agent', params, options.userMessage);
        if (requestId) request.request_id = requestId;
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(`agents update failed: ${res.error ?? '<no message>'}`);

        emitResult({
          tool: 'update_agent',
          result: res.result,
          options,
          pretty: (r) => {
            if (r?.agent) process.stderr.write(`numa: updated ${r.agent.title} (${r.agent.agentId})\n`);
            if (r?.fileWarnings?.length) {
              for (const w of r.fileWarnings) {
                process.stderr.write(`numa: warning — ${w}\n`);
              }
            }
          },
        });
      }
    );
}

// ── patch-prompt ────────────────────────────────────────────────────────────

function createAgentsPatchPromptCommand(): Command {
  return new Command('patch-prompt')
    .description("Find/replace in an agent's system prompt (cheap diff edits)")
    .argument('<id>', 'Agent id')
    .argument('<old-text>', 'Exact substring to find (whitespace + case sensitive)')
    .argument('<new-text>', "Replacement text (use '' to delete the match)")
    .option('--replace-all', 'Replace every occurrence (default requires unique match)')
    .option('-y, --yes', 'Skip the local confirmation prompt')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        id: string,
        oldText: string,
        newText: string,
        options: { replaceAll?: boolean; yes?: boolean } & StandardOptions
      ) => {
        const account = activeProfile();
        if (!account) fail('no active profile — run `numa login` first');

        if (oldText === newText) fail('old-text and new-text are identical — nothing to patch');

        const delta = newText.length - oldText.length;
        const { requestId, autoApproved } = await gateWriteOp({
          requiresApproval: requiresLocalApproval('agents', 'patch_prompt', account),
          yes: !!options.yes,
          confirmOpts: {
            title: `Edit ${id} system prompt`,
            detail: [
              `delta: ${delta > 0 ? '+' : ''}${delta} chars`,
              ...(options.replaceAll ? ['scope: every match'] : ['scope: unique match (or fail)']),
            ],
          },
          emit: {
            actionKey: 'numa_agents_patch_prompt',
            toolName: 'create_agent_tool',
            description: options.userMessage!,
            propsPreview: { agent_id: id },
            approvalCategory: 'numa_tool',
          },
        });

        const params: ParamsForTool<'patch_agent_prompt'> = {
          agent_id: id,
          old_text: oldText,
          new_text: newText,
          ...(options.replaceAll ? { replace_all: true } : {}),
          auto_approved: autoApproved,
        };
        const { accessToken, request } = await buildAgentsRequest(
          account,
          'patch_agent_prompt',
          params,
          options.userMessage
        );
        if (requestId) request.request_id = requestId;
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(`agents patch-prompt failed: ${res.error ?? '<no message>'}`);

        emitResult({
          tool: 'patch_agent_prompt',
          result: res.result,
          options,
          pretty: (r) => {
            if (r?.agent) {
              const len = r.agent.systemPrompt?.length ?? 0;
              process.stderr.write(`numa: patched ${r.agent.title} (prompt now ${len} chars)\n`);
            }
          },
        });
      }
    );
}

// ── duplicate ───────────────────────────────────────────────────────────────

function createAgentsDuplicateCommand(): Command {
  return new Command('duplicate')
    .description('Duplicate an agent into your personal library')
    .argument('<id>', 'Source agent id (personal or workspace)')
    .option('-y, --yes', 'Skip the local confirmation prompt')
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
        requiresApproval: requiresLocalApproval('agents', 'duplicate', account),
        yes: !!options.yes,
        confirmOpts: { title: `Duplicate agent ${id} into your personal library` },
        emit: {
          actionKey: 'numa_agents_duplicate',
          toolName: 'create_agent_tool',
          description: options.userMessage!,
          propsPreview: { agent_id: id },
          approvalCategory: 'numa_tool',
        },
      });

      const params: ParamsForTool<'duplicate_agent'> = { agent_id: id, auto_approved: autoApproved };
      const { accessToken, request } = await buildAgentsRequest(
        account,
        'duplicate_agent',
        params,
        options.userMessage
      );
      if (requestId) request.request_id = requestId;
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(`agents duplicate failed: ${res.error ?? '<no message>'}`);

      emitResult({
        tool: 'duplicate_agent',
        result: res.result,
        options,
        pretty: (r) => {
          if (r?.agent) {
            process.stderr.write(`numa: duplicated → ${r.agent.title} (${r.agent.agentId})\n`);
            process.stdout.write(`${r.agent.agentId}\n`);
          }
        },
      });
    });
}

// ── delete ──────────────────────────────────────────────────────────────────

function createAgentsDeleteCommand(): Command {
  return new Command('delete')
    .description('Delete an agent (destructive)')
    .argument('<id>', 'Agent id')
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
        requiresApproval: requiresLocalApproval('agents', 'delete', account),
        yes: !!options.yes,
        confirmOpts: {
          title: `permanently delete agent ${id}`,
          detail: ['This cannot be undone. Personal agents are gone; workspace agents are removed for everyone.'],
          requireWord: 'yes',
        },
        emit: {
          actionKey: 'numa_agents_delete',
          toolName: 'create_agent_tool',
          description: options.userMessage!,
          propsPreview: { agent_id: id },
          approvalCategory: 'numa_tool',
        },
      });

      const params: ParamsForTool<'delete_agent'> = { agent_id: id, auto_approved: autoApproved };
      const { accessToken, request } = await buildAgentsRequest(account, 'delete_agent', params, options.userMessage);
      if (requestId) request.request_id = requestId;
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(`agents delete failed: ${res.error ?? '<no message>'}`);

      emitResult({
        tool: 'delete_agent',
        result: res.result,
        options,
        pretty: (r) => {
          if (r?.agent) process.stderr.write(`numa: deleted ${r.agent.title} (${r.agent.agentId})\n`);
        },
      });
    });
}

/** Build the `numa agents` command tree. */
export function createAgentsCommand(): Command {
  return new Command('agents')
    .description('Agent CRUD + prompt editing (list / show / create / update / patch-prompt / duplicate / delete)')
    .addCommand(createAgentsListCommand())
    .addCommand(createAgentsShowCommand())
    .addCommand(createAgentsCreateCommand())
    .addCommand(createAgentsUpdateCommand())
    .addCommand(createAgentsPatchPromptCommand())
    .addCommand(createAgentsDuplicateCommand())
    .addCommand(createAgentsDeleteCommand());
}
