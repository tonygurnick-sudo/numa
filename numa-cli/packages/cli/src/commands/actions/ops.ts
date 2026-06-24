/**
 * `numa ops <operation> [--params '<json>']` — Numa Ops surface.
 *
 * Generic pass-through for the ~50 operations on the Ops module (tickets,
 * boards, customers, suppliers, projects, work units, custom fields,
 * statuses, CRM config, audit, metrics). Mirrors how the MCP tool
 * `mcp__numa__numa_ops_tool` works today — one tool name per operation
 * on the wire, single handler server-side, params passed through.
 *
 * Wire shape:
 *   - CLI sends `{tool: "ops_<operation>", params: {operation, params,
 *     description, auto_approved, request_id}}`
 *   - `numa-cli-api` doesn't recognise `ops_*` so falls back to
 *     `workspace_chat_tools` (default route)
 *   - `workspace-chat-tools/lambda_function.py` sees `ops_*` and routes
 *     to `handle_ops_operation`, injecting user_sub/email/groups
 *
 * Why generic instead of per-op subcommands:
 *   - 50+ operations would mean 50+ hand-written wrappers — high
 *     maintenance, no LLM ergonomic win (the LLM is shaping JSON either
 *     way). Per-op subcommands can be added later as syntactic sugar for
 *     the operations humans use most.
 *
 * Approval model (matches MCP today):
 *   - Safe ops (list_*, get_*, search_*, get_config, get_metrics):
 *     auto-approved server-side, no prompt
 *   - Unsafe ops (create_*, update_*, delete_*, add_comment,
 *     upload_attachment, bulk_*): require approval. Local terminal
 *     prompts per the user's chat-settings policy (`ops` category);
 *     server-side gate enforces independently.
 */

import { Command } from 'commander';

import { getValidTokens } from '../../auth/tokens.js';
import { activeProfile } from '../../context/store.js';
import { resolveScopingContext } from '../../context/resolve.js';
import { invokeTool, type ToolInvokeRequest } from '../../api/tools.js';
import type { OpsOperationParams } from '../../metadata/tool-types.js';
import { fail, info } from '../../output/pretty.js';
import { prettyOrSpill } from '../../output/emit.js';
import { type OutputModeFlags } from '../../output/mode.js';
import { splitExtraArgs, parseJsonBlob, requireUserMessage } from '../../output/cli-args.js';
import { requiresLocalApproval } from '../../context/approval.js';
import { gateWriteOp } from './_hitl.js';
import { runUploadAttachment, type OpsInvoke, type UploadAttachmentResult } from './_ops-attachment.js';

/**
 * Canonical list of valid operations. Mirrors VALID_OPERATIONS in
 * `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/numa_ops.py`.
 * Used for early validation (catches typos before a Lambda round-trip) and
 * for `--help` discovery.
 *
 * Keep in sync when ops adds new operations — the server-side handler is
 * the source of truth (`lambdas/python/workspace-chat-tools/tools/ops.py`).
 */
const VALID_OPS = [
  // Read-only (auto-approved server-side)
  'get_config',
  'list_projects',
  'get_project',
  'list_boards',
  'get_board',
  'list_tickets',
  'get_ticket',
  'search_tickets',
  'list_comments',
  'get_audit',
  'list_work_units',
  'list_customers',
  'get_customer',
  'search_customers',
  'list_suppliers',
  'get_supplier',
  'search_suppliers',
  'get_metrics',
  // Tickets (write)
  'create_ticket',
  'update_ticket',
  'delete_ticket',
  'restore_ticket',
  'bulk_update_tickets',
  'add_comment',
  'upload_attachment',
  // Boards / work units / links
  'create_board',
  'update_board',
  'update_zones',
  'update_stages',
  'create_work_unit',
  'update_work_unit',
  'delete_work_unit',
  'create_link',
  'delete_link',
  // Projects
  'create_project',
  'update_project',
  'delete_project',
  // Customers + activities
  'create_customer',
  'update_customer',
  'delete_customer',
  'create_customer_activity',
  'update_customer_activity',
  'delete_customer_activity',
  // Suppliers + activities
  'create_supplier',
  'update_supplier',
  'delete_supplier',
  'create_supplier_activity',
  'update_supplier_activity',
  'delete_supplier_activity',
  // CRM / supplier config (admin)
  'update_crm_config',
  'update_supplier_config',
  // Config (admin)
  'create_field',
  'update_field',
  'delete_field',
  'create_ticket_type',
  'update_ticket_type',
  'delete_ticket_type',
  'create_status',
  'update_status',
] as const;

type ValidOp = (typeof VALID_OPS)[number];

const VALID_OPS_SET = new Set<string>(VALID_OPS);

/** Extract the verb prefix from an operation name (e.g. `list` from `list_tickets`). */
const opVerb = (operation: string): string => operation.split('_')[0] ?? operation;

// splitExtraArgs / coerceValue / camelize live in `output/cli-args.ts` —
// shared with integrations (pipedream-call / props-options / request) so
// every consumer uses the same parsing semantics.

export function createOpsCommand(): Command {
  return (
    new Command('ops')
      .description('Numa Ops — tickets, boards, customers, suppliers, projects, work units, custom fields, statuses')
      .argument(
        '<operation>',
        `Operation to run. Common ones: list_tickets, get_ticket, create_ticket, update_ticket, list_boards, list_customers, get_metrics. See --help for the full list.`
      )
      .argument(
        '[args...]',
        'Op-specific args. Two forms supported:\n' +
          '  - Positional shortcut for search_* ops: `numa ops search_customers acme` → search="acme"\n' +
          '  - Ad-hoc flags: `numa ops create_ticket --board-id <id> --title "..." --ticket-type-id tt-bug`'
      )
      // Allow unknown flags so `--board-id`, `--title`, etc. fall through to
      // the variadic [args...] bucket instead of erroring. Reserved flags
      // (--params, -m/--user-message, --yes, output modes) are still parsed
      // normally because commander matches them first.
      .allowUnknownOption(true)
      .option(
        '--params <json>',
        'JSON params for the operation (alternative / extension to ad-hoc flags). ' +
          'e.g. \'{"boardId":"..."}\' for list_tickets. Merged with ad-hoc flags — --params wins on conflict.'
      )
      .option(
        '-m, --user-message <text>',
        'Short caption shown to the user in chat ("Numa Ops: <msg>"); also the approval card text on HITL writes. ' +
          'REQUIRED on every CLI call — the only window the user has into what the agent is doing.'
      )
      .option('-y, --yes', 'Skip the local confirmation prompt')
      .option('--pretty', 'Force human-readable output')
      .option('--standard', 'Force standard envelope output (LLM-friendly)')
      .option('--json', 'Force raw JSON output')
      .addHelpText(
        'after',
        `\nAvailable operations:\n  ${VALID_OPS.join('\n  ')}\n\n` +
          `Approval model:\n  - Safe ops (list_*, get_*, search_*, get_metrics): auto-approved\n` +
          `  - Unsafe ops (create_*, update_*, delete_*, add_comment, upload_attachment, bulk_*): require approval\n\n` +
          `Display IDs vs UUIDs:\n` +
          `  Tickets have a human-readable displayId (e.g. BUG-001, TASK-042) AND a UUID.\n` +
          `  For get_ticket, update_ticket, delete_ticket, add_comment, list_comments,\n` +
          `  get_audit, upload_attachment — always pass {"displayId":"BUG-001"} rather than\n` +
          `  {"ticketId":"BUG-001"}. The Python bridge auto-resolves displayId to UUID +\n` +
          `  boardId for you. Only use ticketId when you already have the UUID.\n\n` +
          `Passing op-specific args — 3 forms (mix freely):\n` +
          `  1. Positional shortcut (search_* ops only):\n` +
          `       numa ops search_customers acme\n` +
          `       numa ops search_tickets timeout --board-id <uuid>\n` +
          `  2. Ad-hoc --kebab-case flags (auto-camelized + coerced to JSON-friendly values):\n` +
          `       numa ops list_tickets --board-id <uuid>\n` +
          `       numa ops create_ticket --board-id <id> --title "Fix login" --ticket-type-id tt-bug --stage-id <id>\n` +
          `       numa ops update_ticket --display-id BUG-001 --priority high\n` +
          `  3. JSON blob (best for nested params, e.g. arrays/objects):\n` +
          `       numa ops list_tickets --params '{"boardId":"<uuid>","stageId":"<id>"}'\n` +
          `\n` +
          `On conflicts: --params wins over ad-hoc flags wins over positional shortcut.\n` +
          `\n` +
          `Common examples:\n` +
          `  numa ops list_boards\n` +
          `  numa ops list_tickets --board-id <uuid>\n` +
          `  numa ops search_tickets timeout --board-id <uuid>\n` +
          `  numa ops create_ticket --board-id <id> --title "Fix login bug" --ticket-type-id tt-bug --stage-id <id> \\\n` +
          `      -m "log bug for broken login flow"\n` +
          `  numa ops add_comment --display-id BUG-001 --content "Investigation note" \\\n` +
          `      -m "add investigation note"\n` +
          `  numa ops search_customers acme\n` +
          `  numa ops get_project --project-id proj-abc12345\n` +
          `  numa ops get_metrics --board-id <uuid>\n` +
          `\n` +
          `For full param schemas per operation, see the Numa Ops skill\n` +
          `(plugins/numa/skills/ops/SKILL.md) or the server-side handler:\n` +
          `lambdas/python/workspace-chat-tools/tools/ops.py (_resolve_lambda_and_request)\n`
      )
      .action(
        async (
          operation: string,
          extra: string[],
          options: { params?: string; userMessage: string; yes?: boolean } & OutputModeFlags
        ) => {
          const account = activeProfile();
          if (!account) fail('no active profile — run `numa login` first');
          requireUserMessage(options);

          if (!VALID_OPS_SET.has(operation)) {
            const suggestions = VALID_OPS.filter((o) => o.includes(operation.split('_')[0] ?? operation)).slice(0, 5);
            fail(
              `Unknown operation '${operation}'. ` +
                (suggestions.length > 0
                  ? `Did you mean: ${suggestions.join(', ')}?`
                  : `Run \`numa ops --help\` for the full list.`)
            );
          }

          // Parse extras into positionals + ad-hoc flags. Then merge into
          // opParams in priority order: ad-hoc flags first, --params on top
          // (latter wins on key conflict — most explicit).
          const { positionals, adHoc } = splitExtraArgs(extra ?? []);

          let opParams: Record<string, unknown> = { ...adHoc };

          // Positional shortcut for search_* ops: first positional → search term.
          // Only applies to search_customers / search_suppliers / search_tickets
          // since they're the ones with an obvious single-arg input.
          if (operation.startsWith('search_') && positionals.length > 0 && opParams['search'] === undefined) {
            opParams['search'] = positionals[0];
          } else if (positionals.length > 0) {
            // For non-search ops, positionals are unexpected — warn the user
            // but don't fail (they might be a typo we shouldn't block on).
            process.stderr.write(
              `numa: warning — ignored ${positionals.length} positional arg(s) (${positionals.join(', ')}). ` +
                `Use --key value flags or --params '{...}' for op-specific args.\n`
            );
          }

          if (options.params !== undefined) {
            try {
              const fromJson = parseJsonBlob<Record<string, unknown>>(options.params, 'params');
              opParams = { ...opParams, ...fromJson };
            } catch (err) {
              fail(err instanceof Error ? err.message : String(err));
            }
          }

          const verb = opVerb(operation);

          const { requestId, autoApproved } = await gateWriteOp({
            requiresApproval: requiresLocalApproval('ops', verb, account),
            yes: !!options.yes,
            confirmOpts: { title: `Run ops/${operation} — ${options.userMessage}`, requireWord: 'yes' },
            emit: {
              actionKey: `ops-${operation.replaceAll('_', '-')}`,
              toolName: 'numa_ops_tool',
              description: options.userMessage,
              propsPreview: opParams,
              approvalCategory: 'numa_tool',
            },
          });

          const tokens = await getValidTokens(account);
          const scope = resolveScopingContext(account);

          // upload_attachment is not a simple pass-through: the bytes have to
          // move from the workspace to S3, and the model can't do that itself
          // (curl/wget are blocked). The CLI orchestrates read → presign → PUT
          // → register-as-comment as one logical command. The single approval
          // above gates the presign step; the follow-on comment is its
          // mechanical completion (auto-approved). See _ops-attachment.ts.
          if (operation === 'upload_attachment') {
            const invoke: OpsInvoke = (op, p, g) => {
              const callParams: OpsOperationParams & { operation: string } = {
                operation: op,
                params: p,
                auto_approved: g.autoApproved,
              };
              return invokeTool(account, tokens.accessToken, {
                tool: `ops_${op}` as `ops_${string}`,
                params: callParams,
                context: {
                  allowed_kbs: scope.allowed_kbs,
                  allowed_kb_operations: scope.allowed_kb_operations,
                  conversation_id: scope.conversation_id || undefined,
                },
                id_token: tokens.idToken,
                user_message: options.userMessage,
                ...(g.requestId ? { request_id: g.requestId } : {}),
              });
            };

            let uploaded: UploadAttachmentResult;
            try {
              uploaded = await runUploadAttachment({
                invoke,
                opParams,
                gate: { autoApproved, ...(requestId ? { requestId } : {}) },
              });
            } catch (err) {
              fail(`ops upload_attachment failed: ${err instanceof Error ? err.message : String(err)}`);
            }

            prettyOrSpill({
              tool: 'ops_upload_attachment',
              result: uploaded,
              options,
              render: (r) => process.stdout.write(JSON.stringify(r, null, 2) + '\n'),
            });
            if (process.env['NUMA_DEBUG']) info('ops upload_attachment done');
            return;
          }

          const params: OpsOperationParams & { operation: string } = {
            operation,
            params: opParams,
            auto_approved: autoApproved,
          };

          // Tool name is `ops_<operation>` — server-side router catches the
          // `ops_*` prefix and dispatches to the generic handler. Cast to
          // satisfy the template literal type. `user_message` rides at the
          // top of the request (not inside params) — the dispatcher copies
          // it into the event so the workspace-chat-tools handler sees it
          // both as event.user_message and (for back-compat) as the
          // approval card text.
          const toolName = `ops_${operation}` as `ops_${string}`;
          const request: ToolInvokeRequest<typeof toolName> = {
            tool: toolName,
            params,
            context: {
              allowed_kbs: scope.allowed_kbs,
              allowed_kb_operations: scope.allowed_kb_operations,
              conversation_id: scope.conversation_id || undefined,
            },
            id_token: tokens.idToken,
            user_message: options.userMessage,
            ...(requestId ? { request_id: requestId } : {}),
          };

          const res = await invokeTool<typeof toolName>(account, tokens.accessToken, request);
          if (res.status === 'error') fail(`ops ${operation} failed: ${res.error ?? '<no message>'}`);

          prettyOrSpill({
            tool: `ops_${operation}`,
            result: res.result,
            options,
            render: (r) => {
              if (!r) {
                process.stdout.write('(no result)\n');
                return;
              }
              // Server-side handler wraps responses with an approval-status
              // envelope when approval was involved. Surface those first.
              if (r.status === 'denied') {
                process.stderr.write(`numa: action denied${r.deny_reason ? ` — "${r.deny_reason}"` : ''}\n`);
                return;
              }
              if (r.status === 'timeout') {
                process.stderr.write(`numa: approval timed out\n`);
                return;
              }
              if (r.status && r.status !== 'success') {
                process.stderr.write(`numa: ${r.status} — ${r.message ?? 'no message'}\n`);
                return;
              }
              // Domain payload — shape varies by operation. Dump as JSON.
              const payload = r.result !== undefined ? r.result : r;
              process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
            },
            headline: (_r, size, count) =>
              `ops/${operation} returned (${size}${count > 0 ? `, ${count} entries` : ''})`,
          });

          if (process.env['NUMA_DEBUG']) info(`ops ${operation} done`);
        }
      )
  );
}

// Re-export the canonical op list so cli-dev tests (and other callers) can
// avoid duplicating it.
export { VALID_OPS };
export type { ValidOp };
