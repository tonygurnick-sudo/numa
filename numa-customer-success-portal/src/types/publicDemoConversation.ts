/**
 * Types for the public-demo conversations browser.
 *
 * The trace.jsonl format (per-conversation) is an append-only stream of events.
 * We only surface user messages, assistant text, and tool calls -- thinking and
 * streaming deltas are dropped.
 */

export interface ConversationSummary {
  conversationId: string;
  /** ISO timestamp of the most recent trace write (S3 LastModified). */
  lastModified: string;
  /** Size of trace.jsonl in bytes -- cheap proxy for "how much happened". */
  traceBytes: number;
  /** IPv4/IPv6 of the visitor, correlated from proxy-lambda logs (best effort). */
  sourceIp?: string;
}

export interface ProxyRequestEvent {
  /** ISO timestamp. */
  timestamp: string;
  /** Source IP (from the lambda adapter log line). */
  ip: string;
}

export type ParsedTraceEvent =
  | { kind: 'user'; timestamp: string; text: string }
  | { kind: 'assistant'; timestamp: string; text: string }
  | { kind: 'tool_call'; timestamp: string; toolName: string; paramsSummary: string };

export interface ConversationDetail {
  conversationId: string;
  events: ParsedTraceEvent[];
  /** The first user message — handy for preview rows. */
  firstUserMessage?: string;
}
