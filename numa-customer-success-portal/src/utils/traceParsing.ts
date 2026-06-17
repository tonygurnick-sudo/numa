/**
 * Shared parsing for workspace-chat `trace.jsonl` streams.
 *
 * A conversation trace is an append-only NDJSON event log written by the
 * workspace agent. Two consumers live in the portal:
 *
 *   1. The public-demo conversation browser (`publicDemoConversationsService`)
 *      — surfaces a compact user/assistant/tool view for live inspection.
 *   2. The CS dashboard conversation export (`conversationExportService`)
 *      — produces a full readable transcript for cost/quality analysis.
 *
 * The low-level line parser + tool-param summariser are shared here so the two
 * don't drift. The export renderer (`renderTraceText`) is intentionally richer
 * than the demo view — it keeps tool results and an end summary.
 */

import type { ParsedTraceEvent } from '@/types/publicDemoConversation';

// ─── shared low-level helpers ─────────────────────────────────────────────

/**
 * Shorten a tool-call parameter object into a single-line summary suitable for
 * inline display. Strips long fields and collapses to "k1=v1, k2=v2" form.
 */
export function summariseToolParams(input: unknown): string {
  if (input == null) return '';
  if (typeof input !== 'object') return String(input).slice(0, 120);
  const entries = Object.entries(input as Record<string, unknown>);
  const parts: string[] = [];
  for (const [k, v] of entries) {
    let val: string;
    if (v == null) {
      val = 'null';
    } else if (typeof v === 'string') {
      val = v.length > 60 ? `${v.slice(0, 57)}…` : v;
      val = `"${val}"`;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      val = String(v);
    } else {
      val = Array.isArray(v) ? `[${v.length}]` : '{…}';
    }
    parts.push(`${k}=${val}`);
    if (parts.join(', ').length > 200) break;
  }
  return parts.join(', ');
}

/**
 * Parse a single trace.jsonl line into one of three surfaced event kinds.
 * Returns null for events we intentionally drop (thinking, stream deltas,
 * system init, tool results).
 */
export function parseTraceLine(line: string): ParsedTraceEvent | null {
  let ev: unknown;
  try {
    ev = JSON.parse(line);
  } catch {
    return null;
  }
  if (!ev || typeof ev !== 'object') return null;
  const event = ev as Record<string, unknown>;
  const type = event.type;
  const timestamp = typeof event.timestamp === 'string' ? event.timestamp : '';

  // User turns: {type: "user", message: {role: "user", content: [{type:"text"|"tool_result", ...}]}}
  if (type === 'user') {
    const message = event.message as { role?: string; content?: unknown } | undefined;
    if (message?.role !== 'user' || !Array.isArray(message.content)) return null;
    const textParts: string[] = [];
    for (const part of message.content) {
      if (part && typeof part === 'object' && (part as Record<string, unknown>).type === 'text') {
        const t = (part as Record<string, unknown>).text;
        if (typeof t === 'string') textParts.push(t);
      }
    }
    if (textParts.length === 0) return null; // tool_result — skip
    return { kind: 'user', timestamp, text: textParts.join('\n') };
  }

  // Assistant turns: {type: "assistant", message: {role: "assistant", content: [{type:"text"|"tool_use"|"thinking", ...}]}}
  if (type === 'assistant') {
    const message = event.message as { role?: string; content?: unknown } | undefined;
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) return null;
    // Assistant events may contain multiple content blocks — emit the first
    // surfaced one per line (callers compact adjacent text events downstream).
    for (const part of message.content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      if (p.type === 'text' && typeof p.text === 'string' && p.text.trim().length > 0) {
        return { kind: 'assistant', timestamp, text: p.text };
      }
      if (p.type === 'tool_use') {
        const toolName = typeof p.name === 'string' ? p.name : 'tool';
        const paramsSummary = summariseToolParams(p.input);
        return { kind: 'tool_call', timestamp, toolName, paramsSummary };
      }
      // thinking / other — drop
    }
    return null;
  }

  return null;
}

/** Compact adjacent assistant text events into a single message per turn. */
export function compactAssistantRuns(events: ParsedTraceEvent[]): ParsedTraceEvent[] {
  const out: ParsedTraceEvent[] = [];
  for (const ev of events) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === 'assistant' && ev.kind === 'assistant') {
      out[out.length - 1] = { ...prev, text: `${prev.text}\n${ev.text}` };
      continue;
    }
    out.push(ev);
  }
  return out;
}

// ─── export renderer ──────────────────────────────────────────────────────

/**
 * Metadata block prepended to a rendered transcript. All fields come from the
 * dashboard's `TopConversation` snapshot row + the resolved user email, so the
 * header agrees with what's shown on screen (authoritative cost/turns) without
 * re-deriving them from the trace.
 */
export interface ConversationTraceMeta {
  clientName: string;
  conversationId: string;
  userId?: string;
  userEmail?: string;
  agentTitle?: string | null;
  agentId?: string | null;
  model?: string;
  isScheduled?: boolean;
  startedAt?: string;
  lastRequestAt?: string;
  totalCostUsd?: number;
  totalTurns?: number;
  requestCount?: number;
  toolCallCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  exportedAt?: string;
}

const RULE = '='.repeat(76);
const THIN = '-'.repeat(76);

function indentBlock(text: string, prefix = '  '): string {
  return text
    .split('\n')
    .map((l) => `${prefix}${l}`)
    .join('\n');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n  … [truncated — ${text.length.toLocaleString()} chars total; use the .jsonl export for the full content]`;
}

/** Flatten a tool_result `content` field (string | block[] | object) to text. */
function toolResultText(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object' && (c as Record<string, unknown>).type === 'text') {
          return String((c as Record<string, unknown>).text ?? '');
        }
        return JSON.stringify(c);
      })
      .join('\n');
  }
  return JSON.stringify(content);
}

function metaHeader(meta: ConversationTraceMeta): string[] {
  const lines: string[] = [RULE, 'NUMA CONVERSATION TRANSCRIPT', RULE];
  const row = (label: string, value: string | undefined | null) => {
    if (value !== undefined && value !== null && value !== '') lines.push(`${label.padEnd(15)}${value}`);
  };
  row('Client:', meta.clientName);
  row('Conversation:', meta.conversationId);
  const user = meta.userEmail ? `${meta.userEmail}${meta.userId ? ` (${meta.userId})` : ''}` : meta.userId;
  row('User:', user);
  const agent = meta.agentTitle ? `${meta.agentTitle}${meta.agentId ? ` (${meta.agentId})` : ''}` : meta.agentId;
  row('Agent:', agent ?? '— (plain chat)');
  row('Model:', meta.model);
  if (meta.isScheduled) row('Scheduled:', 'yes (scheduled / event-triggered run)');
  row('Started:', meta.startedAt);
  row('Last request:', meta.lastRequestAt);

  const costBits: string[] = [];
  if (typeof meta.totalCostUsd === 'number') costBits.push(`$${meta.totalCostUsd.toFixed(4)}`);
  if (typeof meta.totalTurns === 'number') costBits.push(`${meta.totalTurns} turns`);
  if (typeof meta.requestCount === 'number') costBits.push(`${meta.requestCount} reqs`);
  if (typeof meta.toolCallCount === 'number') costBits.push(`${meta.toolCallCount} tool calls`);
  if (costBits.length) row('Snapshot:', costBits.join(' · '));
  if (typeof meta.inputTokens === 'number' || typeof meta.outputTokens === 'number') {
    row('Tokens:', `${(meta.inputTokens ?? 0).toLocaleString()} in / ${(meta.outputTokens ?? 0).toLocaleString()} out`);
  }
  row('Exported:', meta.exportedAt ?? new Date().toISOString());
  lines.push('', THIN, '');
  return lines;
}

/**
 * Render a full, human-readable transcript from a raw trace.jsonl string.
 * Keeps user messages, assistant text, tool calls, and (truncated) tool
 * results. Drops thinking and stream deltas. The `.jsonl` export is the
 * lossless companion when the full content is needed.
 */
export function renderTraceText(rawJsonl: string, meta: ConversationTraceMeta): string {
  const out: string[] = metaHeader(meta);

  let userTurns = 0;
  let assistantTurns = 0;
  let toolCalls = 0;
  let toolResults = 0;
  let resultEvents = 0;

  for (const line of rawJsonl.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let ev: Record<string, unknown>;
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object') continue;
      ev = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = ev.type;
    const message = ev.message as { content?: unknown } | undefined;
    const content = message?.content;

    if (type === 'user' && Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        const p = part as Record<string, unknown>;
        if (p.type === 'text' && typeof p.text === 'string' && p.text.trim()) {
          userTurns += 1;
          out.push('USER:', indentBlock(p.text.trim()), '');
        } else if (p.type === 'tool_result') {
          toolResults += 1;
          const body = toolResultText(p.content);
          const flag = p.is_error ? ' (ERROR)' : '';
          out.push(`  └─ tool result${flag}:`, body ? indentBlock(truncate(body, 1800), '     ') : '     (empty)', '');
        }
      }
    } else if (type === 'assistant' && Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        const p = part as Record<string, unknown>;
        if (p.type === 'text' && typeof p.text === 'string' && p.text.trim()) {
          assistantTurns += 1;
          out.push('ASSISTANT:', indentBlock(p.text.trim()), '');
        } else if (p.type === 'tool_use') {
          toolCalls += 1;
          const name = typeof p.name === 'string' ? p.name : 'tool';
          out.push(`  → tool call: ${name}(${summariseToolParams(p.input)})`, '');
        }
        // thinking / signature / other — dropped
      }
    } else if (type === 'result') {
      resultEvents += 1;
    }
  }

  out.push(
    THIN,
    `Rendered from trace: ${userTurns} user turns · ${assistantTurns} assistant messages · ` +
      `${toolCalls} tool calls · ${toolResults} tool results · ${resultEvents} result events.`,
    'Thinking blocks and stream deltas are omitted here — export as .jsonl for the raw, lossless trace.'
  );
  return out.join('\n');
}
