/**
 * Dispatch a tool call to the `oauth_workspace_tools` Lambda — the backend
 * for the native-connector path (`mcp__connectors__*` in the LLM's MCP
 * layer).
 *
 * Event shape (simpler than workspace-chat-tools):
 *
 *   { tool: "connect_status" | "connect_request" | ...,
 *     user_sub: string,
 *     conversation_id: string,
 *     params: { ... } }
 *
 * Response shape: `{ status, result, error }` — same envelope as
 * workspace-chat-tools, so the dispatcher relays verbatim.
 *
 * Why a separate Lambda: the native-connector tools predate the unified
 * dispatcher and are still being incubated separately. Same payload
 * conventions as workspace-chat-tools so a future merge is mechanical.
 */

import { InvokeCommand } from '@aws-sdk/client-lambda';

import { lambdaClient } from '../shared/aws.js';

export interface OauthToolsDispatchInput {
  clientName: string;
  tool: string;
  params: Record<string, unknown>;
  userSub: string;
  conversationId: string;
}

export interface OauthToolsDispatchOutput {
  status?: string;
  result?: unknown;
  error?: string;
}

export const invokeOauthTools = async (input: OauthToolsDispatchInput): Promise<OauthToolsDispatchOutput> => {
  const event = {
    tool: input.tool,
    user_sub: input.userSub,
    conversation_id: input.conversationId,
    params: input.params,
  };

  // oauth_workspace_tools uses underscore separators between the client
  // name and Lambda name (it's a direct NumaLambda, not registered via
  // the API-Gateway collection).
  const functionName = `${input.clientName}_oauth_workspace_tools`;

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
  return JSON.parse(raw) as OauthToolsDispatchOutput;
};
