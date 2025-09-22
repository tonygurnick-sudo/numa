import { TOOL_CONFIG } from './ToolConfig';
import type { AgentEventFrame, ToolResult, ContentBlockStartEvent } from '@/types/chat';

/**
 * Utility functions for handling tool events during streaming
 * Extracted from NumaChat.jsx to improve maintainability
 */

/**
 * Extract a unique event key for deduplication
 */
export function extractEventKey(eventMsg: AgentEventFrame): string | null {
  const hasToolUseId = (obj: unknown): obj is { toolUseId?: string } =>
    typeof obj === 'object' && obj !== null && 'toolUseId' in obj;

  const nestedStart =
    eventMsg.event && 'contentBlockStart' in eventMsg.event
      ? (eventMsg.event.contentBlockStart as ContentBlockStartEvent | undefined)
      : undefined;

  const topLevelToolResult = (eventMsg as Record<string, unknown>)['toolResult'];
  const nestedToolResult = eventMsg.event && (eventMsg.event as Record<string, unknown>)['toolResult'];

  const maybeIdFromIdField = ((): string | null => {
    const v = (eventMsg as Record<string, unknown>)['id'];
    return typeof v === 'string' ? v : null;
  })();

  return (
    eventMsg?.contentBlockStart?.start?.toolUse?.toolUseId ||
    (hasToolUseId(topLevelToolResult) && topLevelToolResult.toolUseId) ||
    nestedStart?.start?.toolUse?.toolUseId ||
    (hasToolUseId(nestedToolResult) && nestedToolResult.toolUseId) ||
    eventMsg?.message?.toolResult?.toolUseId ||
    eventMsg?.messageStop?.toolUseId ||
    eventMsg?.event?.messageStop?.toolUseId ||
    maybeIdFromIdField
  );
}

/**
 * Check if event has already been processed
 */
export function isEventProcessed(eventKey: string | null, processedEventIds: Set<string>): boolean {
  if (!eventKey) return false;
  return processedEventIds.has(eventKey);
}

/**
 * Mark event as processed
 */
export function markEventProcessed(eventKey: string | null, processedEventIds: Set<string>): void {
  if (eventKey) {
    processedEventIds.add(eventKey);
  }
}

/**
 * Create helper functions for updating message segments
 */
// Minimal UI segment/message shapes used for local state updates in this module
type UiTextSegment = { kind: 'text'; text: string; finalized?: boolean };
type UiToolSegment = { kind: 'tool'; label: string; isLoading: boolean; toolUseId: string | null };
type UiResultSegment = { kind: 'result'; toolName: string | null; payload: ToolResult | unknown };
type UiSegment = UiTextSegment | UiToolSegment | UiResultSegment;
type UiMessage = {
  segments?: UiSegment[];
  status?: string | null;
  role?: string;
  content?: unknown;
  [key: string]: unknown;
};

export function createMessageHelpers(setMessages) {
  const appendToolEvent = (label: string, toolUseId: string | null = null, isLoading = false) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      const lastMsg: UiMessage = { ...updated[lastIdx] };
      const segs: UiSegment[] = [...(lastMsg.segments || [])];
      segs.push({
        kind: 'tool',
        label,
        isLoading,
        toolUseId,
      });
      lastMsg.segments = segs;
      updated[lastIdx] = lastMsg;
      return updated;
    });
  };

  const updateToolLoadingState = (toolUseId: string, isLoading: boolean) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      const lastMsg: UiMessage = { ...updated[lastIdx] };
      const segs: UiSegment[] = [...(lastMsg.segments || [])];

      // Find the tool segment with matching toolUseId
      const toolSegIndex = segs.findIndex(
        (seg) => seg.kind === 'tool' && (seg as UiToolSegment).toolUseId === toolUseId,
      );

      if (toolSegIndex >= 0) {
        const seg = segs[toolSegIndex] as UiToolSegment;
        segs[toolSegIndex] = { ...seg, isLoading };
        lastMsg.segments = segs;
        updated[lastIdx] = lastMsg;
        console.log('[ToolEventHandlers] Updated tool loading state for', toolUseId, 'to', isLoading);
      }

      return updated;
    });
  };

  const addToolResult = (toolName: string | null, toolResult: ToolResult | unknown) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      const lastMsg: UiMessage = { ...updated[lastIdx] };
      const segs: UiSegment[] = [...(lastMsg.segments || [])];
      segs.push({ kind: 'result', toolName, payload: toolResult });
      lastMsg.segments = segs;
      updated[lastIdx] = lastMsg;
      return updated;
    });
  };

  return {
    appendToolEvent,
    updateToolLoadingState,
    addToolResult,
  };
}

/**
 * Handle tool use start event
 */
export function handleToolUseStart(
  eventMsg: AgentEventFrame,
  toolUseMap: Map<string, string>,
  messageHelpers: ReturnType<typeof createMessageHelpers>,
  flushPendingText,
  conversationId: string | null,
  saveToolCall?,
) {
  const nestedStart =
    eventMsg.event && 'contentBlockStart' in eventMsg.event
      ? (eventMsg.event.contentBlockStart as ContentBlockStartEvent | undefined)
      : undefined;
  const toolInfo = eventMsg.contentBlockStart?.start?.toolUse || nestedStart?.start?.toolUse;
  if (!toolInfo) return;
  const toolName = toolInfo.name || 'tool';
  const toolLabel = TOOL_CONFIG[toolName]?.label || toolName;
  const useIdVal = toolInfo.toolUseId ?? (toolInfo as unknown as Record<string, unknown>)['id'];
  const useId = typeof useIdVal === 'string' ? useIdVal : null;

  console.log('[ToolEventHandlers] Tool use started:', toolName, toolLabel, 'useId:', useId);

  flushPendingText(conversationId); // Don't preserve content for mid-stream flushes
  messageHelpers.appendToolEvent(`Calling ${toolLabel} tool`, useId, true); // Set loading=true

  // Record mapping from toolUseId → toolName for later lookup
  if (useId) {
    toolUseMap.set(useId, toolName);
  }

  // Save tool call to DynamoDB (non-blocking)
  if (saveToolCall) {
    saveToolCall({
      toolName,
      toolUseId: useId,
      toolPayload: toolInfo,
      content: `Tool call: ${toolName}`,
    });
  }
}

// Payload shape used when persisting tool calls/results via callbacks
export type ToolPersistencePayload = {
  toolName: string | null;
  toolUseId: string | null | undefined;
  toolPayload: unknown;
  content: string;
};

/**
 * Extract tool results from event message
 */
const isToolResult = (obj: unknown): obj is ToolResult => typeof obj === 'object' && obj !== null && 'toolUseId' in obj;

const hasToolResultField = (obj: unknown): obj is { toolResult?: unknown } =>
  typeof obj === 'object' && obj !== null && 'toolResult' in obj;

export function extractToolResults(eventMsg: AgentEventFrame): ToolResult[] {
  const results: ToolResult[] = [];
  const topLevelCamel = (eventMsg as Record<string, unknown>)['toolResult'];
  const topLevelSnake = eventMsg.tool_result;
  if (isToolResult(topLevelCamel)) results.push(topLevelCamel);
  if (isToolResult(topLevelSnake)) results.push(topLevelSnake);
  if (isToolResult(eventMsg?.message?.toolResult)) results.push(eventMsg.message!.toolResult as ToolResult);
  const nestedToolResult = eventMsg?.event && (eventMsg.event as Record<string, unknown>)['toolResult'];
  if (isToolResult(nestedToolResult)) results.push(nestedToolResult);

  const contentArr =
    eventMsg?.message?.content ||
    (eventMsg?.event as { message?: { content?: unknown[] } } | undefined)?.message?.content;
  if (Array.isArray(contentArr)) {
    for (const c of contentArr) {
      if (hasToolResultField(c) && isToolResult(c.toolResult)) results.push(c.toolResult);
    }
  }

  if (isToolResult(eventMsg?.delta?.toolResult)) results.push(eventMsg.delta!.toolResult as ToolResult);
  return results;
}

/**
 * Handle tool results
 */
export function handleToolResults(
  toolResults: ToolResult[],
  toolUseMap: Map<string, string>,
  messageHelpers: ReturnType<typeof createMessageHelpers>,
  flushPendingText,
  conversationId: string | null,
  saveToolResult?,
) {
  console.log('[ToolEventHandlers] Tool results received:', toolResults.length, 'results');
  flushPendingText(conversationId); // Don't preserve content for mid-stream flushes

  toolResults.forEach((toolResult) => {
    let tName = toolResult.name || null;
    if (!tName && toolResult.toolUseId) {
      tName = toolUseMap.get(toolResult.toolUseId) || 'unknown';
    }
    console.log('[ToolEventHandlers] Processing tool result for:', tName, 'toolUseId:', toolResult.toolUseId);

    // Stop loading indicator for this tool
    if (toolResult.toolUseId) {
      messageHelpers.updateToolLoadingState(toolResult.toolUseId, false);
    }

    // Persist name onto payload for renderer selection
    toolResult.name = tName;

    // Save tool result to DynamoDB (non-blocking)
    if (saveToolResult) {
      saveToolResult({
        toolName: tName,
        toolUseId: toolResult.toolUseId,
        toolPayload: toolResult,
        content: `Tool result: ${tName}`,
      });
    }

    // Once consumed, remove from map to avoid leaks
    if (toolResult.toolUseId) {
      toolUseMap.delete(toolResult.toolUseId);
    }

    messageHelpers.addToolResult(tName, toolResult);
  });
}

/**
 * Main tool event processor
 */
export interface ProcessToolEventContext {
  processedEventIds: Set<string>;
  toolUseMap: Map<string, string>;
  hasStreamingStarted: boolean;
  setHasStreamingStarted;
}

export interface ProcessToolEventCallbacks {
  setMessages;
  setButtonStatus;
  flushPendingText;
  saveToolCall?;
  saveToolResult?;
  conversationId: string | null;
}

export function processToolEvent(
  eventMsg: AgentEventFrame,
  context: ProcessToolEventContext,
  callbacks: ProcessToolEventCallbacks,
) {
  const { processedEventIds, toolUseMap, hasStreamingStarted, setHasStreamingStarted } = context;

  const { setMessages, setButtonStatus, flushPendingText, saveToolCall, saveToolResult, conversationId } = callbacks;

  // ----- Deduplicate tool events (StrictMode-safe) -----
  const eventKey = extractEventKey(eventMsg);
  if (isEventProcessed(eventKey, processedEventIds)) {
    return; // already handled
  }
  markEventProcessed(eventKey, processedEventIds);

  console.log('[ToolEventHandlers] onEvent called:', eventMsg.type || 'unknown', eventMsg);

  // Initialize streaming mode on first event (handles tool-first scenarios)
  if (!hasStreamingStarted) {
    console.log('[ToolEventHandlers] First event received, initializing streaming mode');
    setMessages((prev) => {
      const updated = [...prev];
      const idx = updated.findIndex((m) => m.status === 'thinking');
      if (idx >= 0) updated[idx].status = null;
      return updated;
    });
    setButtonStatus('streaming');
    setHasStreamingStarted(true);
  }

  const messageHelpers = createMessageHelpers(setMessages);

  // Detect tool use start and add a single bubble
  const hasToolUseStart =
    Boolean(eventMsg.contentBlockStart?.start?.toolUse) ||
    Boolean(
      eventMsg.event &&
        'contentBlockStart' in eventMsg.event &&
        (eventMsg.event.contentBlockStart as ContentBlockStartEvent | undefined)?.start?.toolUse,
    );
  if (hasToolUseStart) {
    handleToolUseStart(eventMsg, toolUseMap, messageHelpers, flushPendingText, conversationId, saveToolCall);
    return;
  }

  // Handle tool results
  const toolResults = extractToolResults(eventMsg);
  if (toolResults.length > 0) {
    handleToolResults(toolResults, toolUseMap, messageHelpers, flushPendingText, conversationId, saveToolResult);
    return;
  }

  if (eventMsg?.type === 'tool_use_complete') {
    console.log('[ToolEventHandlers] Tool use complete, ready for follow-up content...');
  }
}
