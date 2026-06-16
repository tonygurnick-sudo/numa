/**
 * Conversation export for the CS dashboard.
 *
 * Given a `TopConversation` row (which carries the conversation id + the user
 * sub, both derived from the S3 trace key during the rollup), this fetches the
 * raw `trace.jsonl` from the client's outputs bucket — assuming the
 * `ArcanumAIAccess` role into the client account, exactly like the public-demo
 * conversation browser — and packages it as either:
 *
 *   - `.jsonl` — the raw, lossless trace exactly as stored (includes thinking,
 *     result/cost events, stream deltas). The "give me everything" option.
 *   - `.txt`   — a readable transcript rendered via `renderTraceText`.
 *
 * Because the rollup derives `user_id` + `conversation_id` from the trace key,
 * recombining them here is guaranteed to address the same object.
 */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { awsCredentialsService } from '@/services/awsCredentialsService';
import { withPRM } from '@/utils/prmUtils';
import { renderTraceText, type ConversationTraceMeta } from '@/utils/traceParsing';
import type { ClientAccountRef } from '@/types/clientAccount';
import type { TopConversation } from '@/types/fleetAnalytics';
import type { ToolResultFile } from '@/types/tools';

export type ConversationExportFormat = 'jsonl' | 'txt';

function outputsBucket(clientName: string): string {
  return `numa-${clientName}-outputs`;
}

function traceKey(userSub: string, conversationId: string): string {
  return `numa-chat/workspace/${userSub}/conversations/${conversationId}/_system/trace.jsonl`;
}

/** Fetch the raw trace.jsonl text for a conversation from the client account. */
export async function fetchRawTrace(ref: ClientAccountRef, userSub: string, conversationId: string): Promise<string> {
  const awsConfig = await awsCredentialsService.getClientConfig(ref.accountId, ref.region);
  const s3 = withPRM(S3Client, awsConfig);
  let response;
  try {
    response = await s3.send(
      new GetObjectCommand({ Bucket: outputsBucket(ref.clientName), Key: traceKey(userSub, conversationId) })
    );
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'NoSuchKey' || name === 'NotFound') {
      throw new Error('No trace found for this conversation (it may have been purged or never written).');
    }
    throw e;
  }
  if (!response.Body) throw new Error('Trace object has no body.');
  return await response.Body.transformToString();
}

/** Short, filesystem-safe slice of a conversation id for filenames. */
function shortConvId(conversationId: string): string {
  return (conversationId || 'conversation').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'conversation';
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

/**
 * Fetch + package a conversation as a downloadable file. Returns a
 * `ToolResultFile` ready for `FileExportService.downloadFile`.
 */
export async function fetchConversationExport(
  ref: ClientAccountRef,
  conv: TopConversation,
  format: ConversationExportFormat,
  opts?: { userEmail?: string }
): Promise<ToolResultFile> {
  if (!conv.user_id) {
    throw new Error('Conversation is missing a user id — cannot locate its trace.');
  }
  const raw = await fetchRawTrace(ref, conv.user_id, conv.conversation_id);
  const base = `${ref.clientName}-conv-${shortConvId(conv.conversation_id)}-${stamp()}`;

  if (format === 'jsonl') {
    return {
      name: `${base}.jsonl`,
      content: raw,
      mimeType: 'application/x-ndjson',
      size: new Blob([raw]).size,
    };
  }

  const meta: ConversationTraceMeta = {
    clientName: ref.clientName,
    conversationId: conv.conversation_id,
    userId: conv.user_id,
    userEmail: opts?.userEmail,
    agentTitle: conv.agent_title,
    agentId: conv.agent_id,
    model: conv.model,
    isScheduled: conv.is_scheduled,
    startedAt: conv.started_at,
    lastRequestAt: conv.last_request_at,
    totalCostUsd: conv.total_cost_usd,
    totalTurns: conv.total_turns,
    requestCount: conv.request_count,
    toolCallCount: conv.tool_call_count,
    inputTokens: conv.input_tokens,
    outputTokens: conv.output_tokens,
    exportedAt: new Date().toISOString(),
  };
  const text = renderTraceText(raw, meta);
  return {
    name: `${base}.txt`,
    content: text,
    mimeType: 'text/plain',
    size: new Blob([text]).size,
  };
}
