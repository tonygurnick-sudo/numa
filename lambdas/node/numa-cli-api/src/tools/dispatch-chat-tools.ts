/**
 * Dispatch a tool call to `workspace-chat-tools`. The event shape matches
 * what the workspace agent's MCP layer sends:
 *
 *   { tool, params, user_sub, allowed_kbs, allowed_kbs_with_names,
 *     conversation_id, id_token }
 *
 * Response shape: `{ status, result, error }`. We relay verbatim.
 */

import { InvokeCommand } from '@aws-sdk/client-lambda';

import { lambdaClient } from '../shared/aws.js';

export interface ChatToolsDispatchInput {
  clientName: string;
  tool: string;
  params: Record<string, unknown>;
  userSub: string;
  /**
   * User's email — workspace-chat-tools' agent handlers use it for the
   * `createdByName` fallback when the creator's display name isn't passed
   * explicitly. Safe to send for all tools; only the agent handlers read it.
   */
  userEmail: string;
  /**
   * User's Cognito groups. The agent handlers use this for admin checks
   * (workspace-agent updates / deletes by anyone OTHER than the creator
   * require `admin` membership). Safe to send for all tools.
   */
  userGroups: string[];
  allowedKbs: Array<{ id: string; name?: string }>;
  /**
   * Frontend-set tool toggles for this conversation. Forwarded as
   * `allowed_tools` in the event — workspace-chat-tools gates several
   * categories on it (e.g. `memories_tool` is required for user_profile_*
   * tools; missing → 403 from the handler).
   */
  enabledTools: string[];
  conversationId: string;
  idToken: string;
  /**
   * Required user-facing caption — what the chat UI renders as
   * `(tool icon) Numa <category>: <user_message>` for every tool call.
   * Also used as the approval card text when the handler is HITL-gated.
   *
   * Forwarded to the chat-tools event at two levels for back-compat:
   *   - event.user_message              (top-level — preferred)
   *   - event.params.description        (where existing approval handlers
   *                                      currently read the approval text)
   * Eventually the handlers should read `event.user_message`; until then
   * we double-send so neither side regresses.
   */
  userMessage?: string;
  /**
   * Approval request_id (UUID). Threaded into the event at both top-level
   * (`event.request_id`) and inside params (`params.request_id`) so the
   * handler can log the approval trail regardless of which field it reads.
   */
  requestId?: string;
}

export interface ChatToolsDispatchOutput {
  status?: string;
  result?: unknown;
  error?: string;
}

export const invokeChatTools = async (input: ChatToolsDispatchInput): Promise<ChatToolsDispatchOutput> => {
  // Pipedream tools (list_actions, run_action, configure_props, proxy_request)
  // require Pipedream Connect's `external_user_id`. The workspace agent
  // builds it as `f"{CLIENT_NAME}_{user_sub}"` (see services/numa-workspace-
  // agent/numa_workspace_agent/main.py:1722); we mirror that here so the CLI
  // doesn't have to know about Pipedream's user-namespacing scheme. The
  // chat-tools dispatcher promotes event.external_user_id into params
  // when params doesn't already carry it.
  const externalUserId = `${input.clientName}_${input.userSub}`;

  // Back-compat + forward-compat: lambda_function.py calls handler_fn(params)
  // — so handlers only see what's inside `params`, not the top-level event.
  // Copy userMessage into params under BOTH names:
  //   - `user_message` (canonical, what new handlers should read)
  //   - `description`  (legacy, what existing approval handlers read)
  // Each is set ONLY when not already present so explicit per-call values
  // win. Lets us roll the CLI flag rename independently of the handler-side
  // migration; future handlers prefer params.user_message, drop the
  // description copy.
  const paramsWithUserMessage = ((): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...input.params };
    if (input.userMessage) {
      if (out['user_message'] === undefined) out['user_message'] = input.userMessage;
      if (out['description'] === undefined) out['description'] = input.userMessage;
    }
    if (input.requestId && out['request_id'] === undefined) {
      out['request_id'] = input.requestId;
    }
    return out;
  })();

  const event = {
    tool: input.tool,
    params: paramsWithUserMessage,
    user_sub: input.userSub,
    user_email: input.userEmail,
    user_groups: input.userGroups,
    allowed_kbs: input.allowedKbs.map((kb) => kb.id).filter(Boolean),
    allowed_kbs_with_names: input.allowedKbs,
    // Python dispatcher reads this as `allowed_tools` (legacy naming);
    // we forward `enabled_tools` from the CLI under that key.
    allowed_tools: input.enabledTools,
    external_user_id: externalUserId,
    conversation_id: input.conversationId,
    id_token: input.idToken,
    user_message: input.userMessage,
    ...(input.requestId ? { request_id: input.requestId } : {}),
  };

  // workspace-chat-tools uses all-underscore naming (direct NumaLambda
  // construct, not the API-Gateway collection).
  const functionName = `${input.clientName}_workspace_chat_tools`;

  const res = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      Payload: Buffer.from(JSON.stringify(event)),
      InvocationType: 'RequestResponse',
    })
  );

  if (res.FunctionError) {
    const payload = res.Payload ? Buffer.from(res.Payload).toString('utf-8') : '<empty>';
    throw new Error(`${functionName}: ${res.FunctionError} — ${payload.slice(0, 500)}`);
  }
  if (!res.Payload) throw new Error(`${functionName}: empty payload`);

  const raw = Buffer.from(res.Payload).toString('utf-8');
  return JSON.parse(raw) as ChatToolsDispatchOutput;
};
