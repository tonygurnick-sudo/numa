// Chat Agent and streaming types

// ---------------------------------------------------------------------------
// Core chat message structures used across the app
// ---------------------------------------------------------------------------

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ContentBlock {
  text?: string;
  // Tool use/result are loosely typed to avoid over-constraining Bedrock/Agent frames
  toolUse?: unknown;
  toolResult?: unknown;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: ChatRole;
  content: ContentBlock[];
  // Legacy message structures sometimes use `segments` or other fields
  segments?: unknown[];
  status?: string;
  [key: string]: unknown;
}

// Known Bedrock stop reasons plus a catch-all
export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'content_filtered'
  | string
  | undefined;

// ---------------------------------------------------------------------------
// Strands Agents (modeled on Bedrock) streaming event types (v1.0)
// These mirror https://github.com/strands-agents/sdk-python (streaming.py/_events.py)
// and help make UI event handling and debugging easier.
// ---------------------------------------------------------------------------

// Tool-related
export type ToolResultStatus = 'success' | 'error';

export interface ToolUse {
  toolUseId: string;
  name: string;
  input: unknown;
}

export interface ToolResultContent {
  // Align to Strands shapes; we keep these permissive
  text?: string;
  json?: unknown;
  image?: unknown;
  document?: unknown;
}

export interface ToolResult {
  content: ToolResultContent[];
  status: ToolResultStatus;
  toolUseId: string;
  // Optional convenience for renderer selection (sometimes injected client-side)
  name?: string | null;
  [key: string]: unknown;
}

// Streaming events (Bedrock-like)
export interface ContentBlockStartEvent {
  contentBlockIndex?: number;
  start?: {
    toolUse?: ToolUse;
    [key: string]: unknown;
  };
}

export interface ReasoningContentBlockDelta {
  redactedContent?: unknown;
  signature?: string | null;
  text?: string | null;
}

export interface ContentBlockDeltaToolUse {
  input: string; // streamed JSON string; SDK later parses to object
}

export interface CitationsDelta {
  // Keep permissive; detailed typing not necessary for now
  location?: unknown;
  sourceContent?: Array<{ text?: string }>;
  title?: string;
}

export interface ContentBlockDelta {
  text?: string;
  toolUse?: ContentBlockDeltaToolUse;
  reasoningContent?: ReasoningContentBlockDelta;
  citation?: CitationsDelta;
}

export interface ContentBlockDeltaEvent {
  contentBlockIndex?: number;
  delta: ContentBlockDelta;
}

export interface ContentBlockStopEvent {
  contentBlockIndex?: number;
}

export interface MessageStartEvent {
  role: ChatRole;
}

export interface StreamMessageStopEvent {
  additionalModelResponseFields?: unknown;
  stopReason?: StopReason;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  [key: string]: unknown;
}

export interface Metrics {
  latencyMs?: number;
  [key: string]: unknown;
}

export interface MetadataEvent {
  usage?: Usage;
  metrics?: Metrics;
  trace?: unknown;
}

export interface RedactContentEvent {
  redactUserContentMessage?: string;
  redactAssistantContentMessage?: string;
}

export interface StreamEvent {
  contentBlockDelta?: ContentBlockDeltaEvent;
  contentBlockStart?: ContentBlockStartEvent;
  contentBlockStop?: ContentBlockStopEvent;
  messageStart?: MessageStartEvent;
  messageStop?: StreamMessageStopEvent;
  metadata?: MetadataEvent;
  redactContent?: RedactContentEvent;
  // Error events omitted for brevity; add as needed
  [key: string]: unknown;
}

export interface StreamStartMsg {
  type: 'start';
}
export interface StreamChunkMsg {
  type: 'chunk';
  data: string;
}
export interface StreamCompleteMsg {
  type: 'complete';
  stop_reason?: StopReason;
}
export interface StreamErrorMsg {
  type: 'error';
  error: string;
}

export type StreamCallbackMessage = StreamStartMsg | StreamChunkMsg | StreamCompleteMsg | StreamErrorMsg;

// Generic agent event frame forwarded to onEvent hooks
export interface AgentEventFrame {
  // Wrapper
  type?: string; // 'start' | 'event' | 'error' | custom

  // Flat (preferred) Bedrock/Agent event keys forwarded by our lambda
  contentBlockStart?: ContentBlockStartEvent;
  contentBlockDelta?: ContentBlockDeltaEvent;
  contentBlockStop?: ContentBlockStopEvent | unknown;
  messageStart?: MessageStartEvent | unknown;
  messageStop?: StreamMessageStopEvent & { toolUseId?: string };
  responseStart?: unknown;
  responseStop?: unknown;
  metadata?: Record<string, unknown> & { usage?: Usage };
  complete?: boolean;

  // Other channels that sometimes carry tool results
  message?: { content?: unknown[]; toolResult?: unknown };
  delta?: { toolResult?: unknown };

  // Backwards/nested compatibility
  event?: Record<string, unknown> & {
    contentBlockStart?: ContentBlockStartEvent;
    contentBlockDelta?: ContentBlockDeltaEvent;
    messageStop?: { stopReason?: StopReason; toolUseId?: string };
    stop_reason?: StopReason;
    stopReason?: StopReason;
    complete?: boolean;
    toolResult?: unknown;
  };

  // Misc
  current_tool_use?: unknown;
  // Strands-specific additional fields we may see directly
  tool_result?: ToolResult; // from ToolResultEvent
  tool_stream_event?: { tool_use: ToolUse; data: unknown };
  result?: unknown; // final AgentResult
  stop?: [StopReason, unknown, unknown, unknown]; // stop tuple from ModelStopReason/EventLoopStopEvent
  error?: string;
  [key: string]: unknown;
}

export interface StreamOptions {
  enabledTools?: string[];
  enabledConnections?: string[];
  systemPrompt?: string;
  modelId?: string | null;
  userAuth?: Record<string, unknown> | null;
}

export type OnChunk = (_chunk: string) => void;
export type OnComplete = (_stopReason?: StopReason) => void;
export type OnError = (_error: Error) => void;
export type OnEvent = (_frame: AgentEventFrame) => void;

// Known Bedrock/Agent event shapes (best-effort)
export interface ContentBlockDeltaFrame extends AgentEventFrame {}

export interface MessageStopFrame extends AgentEventFrame {
  event?: {
    messageStop?: {
      stopReason?: string;
    };
    stopReason?: string; // sometimes present directly
    stop_reason?: string; // sometimes snake case
    complete?: boolean;
  };
}

export interface ToolUseRelatedFrame extends AgentEventFrame {
  event?: {
    contentBlockStart?: {
      start?: { toolUse?: unknown };
    };
    current_tool_use?: unknown;
    toolResult?: unknown;
  };
  message?: {
    toolResult?: unknown;
    content?: unknown[];
  };
  delta?: {
    toolResult?: unknown;
  };
}

// Type guards and helpers
export const isContentDeltaFrame = (f: AgentEventFrame): f is ContentBlockDeltaFrame => {
  const flat = f?.contentBlockDelta?.delta;
  if (flat && typeof flat === 'object' && 'text' in flat) return true;
  const nested = f?.event && (f.event as Record<string, unknown>).contentBlockDelta?.delta;
  return Boolean(nested && typeof nested === 'object' && 'text' in nested);
};

export const tryGetDeltaText = (f: AgentEventFrame): string | undefined => {
  const flat = f?.contentBlockDelta?.delta?.text;
  if (typeof flat === 'string') return flat;
  const nested = (f as Record<string, unknown>)?.event?.contentBlockDelta?.delta?.text;
  if (typeof nested === 'string') return nested;
  return undefined;
};

export const isMessageStopFrame = (f: AgentEventFrame): f is MessageStopFrame => {
  if ((f as Record<string, unknown>).messageStop || (f as Record<string, unknown>).complete) return true;
  const e: Record<string, unknown> = f.event || {};
  return Boolean(e.messageStop || e.stopReason || e.stop_reason || e.complete);
};

export const getStopReason = (f: AgentEventFrame): StopReason => {
  // Prefer explicit tuple stop reason if present
  const tuple = (f as Record<string, unknown>)?.stop;
  if (Array.isArray(tuple) && typeof tuple[0] === 'string') return tuple[0] as StopReason;

  const flat: Record<string, unknown> = f;
  if (flat?.messageStop?.stopReason) return flat.messageStop.stopReason as StopReason;
  const e: Record<string, unknown> = f.event || {};
  if (e?.messageStop?.stopReason) return e.messageStop.stopReason as StopReason;
  if (typeof e?.stop_reason === 'string') return e.stop_reason as StopReason;
  if (typeof e?.stopReason === 'string') return e.stopReason as StopReason;
  if (flat?.complete || e?.complete) return 'complete';
  return undefined;
};

export const isToolEventFrame = (f: AgentEventFrame): f is ToolUseRelatedFrame => {
  const flatStart = (f as Record<string, unknown>)?.contentBlockStart?.start?.toolUse;
  const e: Record<string, unknown> = f.event || {};
  const m: Record<string, unknown> = f.message || {};
  const d: Record<string, unknown> = f.delta || {};
  const hasStart = flatStart || e?.contentBlockStart?.start?.toolUse;
  const hasCurrent = f.current_tool_use || e?.current_tool_use;
  const hasDirectResult =
    (m && m.toolResult) ||
    (e && (e as Record<string, unknown>).toolResult) ||
    (d && d.toolResult) ||
    (f as Record<string, unknown>).toolResult ||
    (f as Record<string, unknown>).tool_result; // Strands ToolResultEvent
  const hasToolStream = Boolean((f as Record<string, unknown>).tool_stream_event);
  const arrayTool =
    Array.isArray(m?.content) &&
    (m.content as unknown[]).some((i: Record<string, unknown>) => i?.toolUse || i?.toolResult);
  return Boolean(
    hasStart || hasCurrent || hasDirectResult || arrayTool || hasToolStream || f.type === 'tool_use_complete',
  );
};

// ---------------------------------------------------------------------------
// HTTP Streaming API (request/response) types
// ---------------------------------------------------------------------------

// Body sent to the HTTP streaming endpoint
export interface ChatAgentRequest {
  prompt: string;
  conversationId?: string;
  enabledTools?: string[];
  enabledConnections?: string[];
  systemPrompt?: string;
  modelId?: string | null;
  userAuth?: Record<string, unknown> | null;
}

// NDJSON frames coming back from the HTTP stream
export type ChatAgentNdjsonFrame =
  | { type: 'start' }
  | ({ type: 'event' } & AgentEventFrame)
  | { type: 'error'; error: string }
  | { type: 'completion'; status: 'completed' | 'failed' }
  | { type: 'ping'; ts?: number };
