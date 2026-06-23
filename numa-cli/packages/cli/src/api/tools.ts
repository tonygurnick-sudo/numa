/**
 * /api/cli/tools/invoke — the dispatcher that drives all `numa <category>
 * <action>` calls. The Lambda translates our request into a `workspace-chat-
 * tools` event (or a kb_manager REST call, depending on the tool) and
 * invokes it. Same auth path, same handlers, same enforcement the workspace
 * agent's MCP layer goes through.
 *
 * Discriminated-union typing: pass `tool: 'foo'` and TypeScript knows the
 * matching `params` shape (and the response's `result` shape) from
 * `@numa/cli/metadata` (the shared types module). Adding a new tool ⇒
 * extend `ToolCall` in `tool-types.ts` and the rest threads through.
 */

import type { ParamsForTool, ToolName, ToolResult } from '../metadata/tool-types.js';
import { apiCall } from './client.js';
import { isOversizedEnvelope, resolveOversizedResult } from './integrity.js';
import { flushWorkspacePathsForTool } from './workspace-flush.js';

export interface ToolInvokeContext {
  /**
   * Per-conversation KB scoping hint — `[{id, name}]`. CAN'T grant access
   * (server-side workspace-chat-tools / kb_manager enforce ownership);
   * CAN narrow scope to mirror the conversation's enabled list.
   */
  allowed_kbs?: Array<{ id: string; name?: string }>;
  /** KB sub-op whitelist (read-only mode etc.). */
  allowed_kb_operations?: string[];
  /** Optional conversation id for S3 path construction server-side. */
  conversation_id?: string;
  /**
   * Agent type id (Phase 5). Forwarded so numa-cli-api can enforce the
   * per-type CLI-category allow-list (e.g. Nolia phases → `docs` only).
   * Empty/absent on the laptop path (unrestricted). Trusted-env channel.
   */
  agent_type?: string;
  /**
   * Frontend-set tool toggles for THIS conversation. Forwarded as
   * `allowed_tools` in the workspace-chat-tools event — the dispatcher
   * gates certain categories on entries here (e.g. `memories_tool` for
   * user_profile_*, `create_agent_tool` for agent ops).
   *
   * In-workspace executions inherit `NUMA_ENABLED_TOOLS`. Local-CLI
   * executions per-command can opt themselves in (e.g. `numa memory add`
   * always includes `"memories_tool"`).
   */
  enabled_tools?: string[];
}

/**
 * Typed tool-invoke request. `T` narrows `params` to the right per-tool
 * shape — try `request.params.kb_id` after `tool: 'add_to_kb'` and TS
 * knows it exists; misspelling fails compile.
 */
export interface ToolInvokeRequest<T extends ToolName = ToolName> {
  tool: T;
  params: ParamsForTool<T>;
  context?: ToolInvokeContext;
  /** Raw Cognito ID token — needed by some tools for AssumeRoleWithWebIdentity. */
  id_token?: string;
  /**
   * Human-readable caption supplied via `--user-message` (required on every
   * API-hitting command). Forwarded to workspace-chat-tools so the chat UI
   * can render `(tool icon) Numa <category>: <user_message>` for every tool
   * call, and so HITL-gated write ops use it as the approval card text.
   * Server-side handlers should prefer `user_message` over the legacy
   * `description` field on params when both are present.
   */
  user_message?: string;
  /**
   * Approval request ID (UUID). Sent by the CLI for write ops in
   * workspace-IAM mode. The Lambda creates a DDB approval record +
   * polls until the user approves/denies/times out; only dispatches
   * downstream on approval.
   */
  request_id?: string;
}

/**
 * workspace-chat-tools / kb_manager response shape. `T` ties `result` to
 * the originating tool name so callers don't need their own type casts.
 */
export interface ToolInvokeResponse<T extends ToolName = ToolName> {
  status?: 'success' | 'error' | string;
  result?: ToolResult<T>;
  error?: string;
  /**
   * Machine-readable error tag from the native-connector backend
   * (`oauth_workspace_tools`) — e.g. `needs_credential` (connector not
   * connected) or `auth_error` (token expired). Lets commands give the model
   * a connect/reconnect hint instead of a bare error string. Absent for tools
   * routed through workspace-chat-tools / kb_manager.
   */
  error_code?: string;
  /**
   * Server-side gate denials (the Ops entitlement gate and the Phase-5
   * per-agent CLI allow-list) return `{status:'error', message}` rather than
   * `error`. `invokeTool` normalises `message` → `error` so every command's
   * `res.error` surfaces the reason to the model (don't let a gate denial read
   * as "<no message>" — the model needs to know WHY so it stops retrying).
   */
  message?: string;
}

/**
 * Normalise server-side gate responses onto the error channel, in place.
 *
 * - Gate denials (ops entitlement, Phase-5 allow-list) carry their reason in
 *   `message`, not `error` — copy it over so every caller's `res.error`
 *   surfaces the reason to the model (don't let a gate denial read as
 *   "<no message>" — the model needs to know WHY so it stops retrying).
 * - HITL outcomes (`denied` / `timeout`) arrive as their own statuses with
 *   the reason in `message` and NO `result`. Without this they fall through
 *   every command's `status === 'error'` check and print as a bare
 *   `result: null` — silently dropping the user's deny reason.
 */
export function normalizeGateResponse(resp: ToolInvokeResponse): void {
  if (resp.status === 'error' && !resp.error && resp.message) {
    resp.error = resp.message;
  }
  if (resp.status === 'denied' || resp.status === 'timeout') {
    const fallback = resp.status === 'denied' ? 'The user denied this action.' : 'Approval timed out.';
    resp.status = 'error';
    if (!resp.error) resp.error = resp.message ?? fallback;
  }
}

export async function invokeTool<T extends ToolName>(
  account: string,
  accessToken: string,
  request: ToolInvokeRequest<T>
): Promise<ToolInvokeResponse<T>> {
  // Stamp the agent type onto every tool invoke from a single chokepoint so
  // numa-cli-api can enforce the per-type CLI-category allow-list (Phase 5).
  // It's an ambient workspace property (same for every command this turn), not
  // a per-command choice — reading NUMA_AGENT_TYPE here avoids threading it
  // through ~7 command-site context blocks (and the drift that invites).
  // Empty outside the workspace (laptop path stays unrestricted).
  const agentType = request.context?.agent_type ?? process.env['NUMA_AGENT_TYPE'];
  const body: ToolInvokeRequest<T> = agentType
    ? { ...request, context: { ...request.context, agent_type: agentType } }
    : request;
  // Flush this command's file-path arguments to S3 before invoking. The Lambda
  // reads target files from the conversation S3 prefix; agent-generated files
  // created in the SAME Bash command aren't on disk when the PreToolUse
  // workspace_sync hook fires, so the CLI (which runs after they land) flushes
  // them here. Best-effort and conversation-scoped — see workspace-flush.ts.
  await flushWorkspacePathsForTool(request.tool, request.params, request.context?.conversation_id);
  const resp = await apiCall<ToolInvokeResponse<T>>({
    account,
    accessToken,
    method: 'POST',
    path: '/cli/tools/invoke',
    body,
  });
  normalizeGateResponse(resp);
  // Oversized-result spillover: when a handler's result wouldn't fit the
  // 6 MB synchronous Lambda payload, it arrives as a small
  // `{oversized: true, result_url, result_sha256, ...}` envelope. Resolve it
  // here (download + sha256-verify + parse) so every command sees the
  // COMPLETE result — the standard envelope's own /workdir spill then deals
  // with presenting it. Fail closed: an unverifiable spill becomes a tool
  // error, never partial data.
  if (isOversizedEnvelope(resp.result)) {
    try {
      resp.result = (await resolveOversizedResult(resp.result)) as ToolResult<T>;
    } catch (e) {
      return {
        status: 'error',
        error: `oversized tool result could not be resolved: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
  return resp;
}
