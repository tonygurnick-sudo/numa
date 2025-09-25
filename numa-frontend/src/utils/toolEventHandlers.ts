import { TOOL_CONFIG } from './ToolConfig';
import type {
  AgentEventFrame,
  ToolResult,
  ContentBlockStartEvent,
  ContentBlockDeltaEvent,
  ContentBlockDeltaToolUse,
} from '@/types/chat';

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
type UiToolSegment = {
  kind: 'tool';
  label: string;
  isLoading: boolean;
  toolUseId: string | null;
  // inputPayload intentionally omitted from UI; we do not display tool input
};
type UiResultSegment = { kind: 'result'; toolName: string | null; payload: ToolResult | unknown };
type UiSegment = UiTextSegment | UiToolSegment | UiResultSegment;
type UiMessage = {
  segments?: UiSegment[];
  status?: string | null;
  role?: string;
  content?: unknown;
  [key: string]: unknown;
};

export function createMessageHelpers(setMessages: (updater: (prev: UiMessage[]) => UiMessage[]) => void) {
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
        // minimal logging: omit per-segment updates
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
  flushPendingText: (conversationId?: string | null, preserveContent?: boolean) => void,
  conversationId: string | null,
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

  // minimal logging: omit tool start

  flushPendingText(conversationId); // Don't preserve content for mid-stream flushes
  messageHelpers.appendToolEvent(`Calling ${toolLabel} tool`, useId, true); // Set loading=true

  // Record mapping from toolUseId → toolName for later lookup
  if (useId) {
    toolUseMap.set(useId, toolName);
  }

  // Do not persist tool call yet; we will save when final input is available
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
  saveToolResult?: (payload: ToolPersistencePayload) => void,
  processedEventIds?: Set<string>,
) {
  // minimal logging: omit result batch counts
  flushPendingText(conversationId); // Don't preserve content for mid-stream flushes

  toolResults.forEach((toolResult) => {
    const tId = toolResult.toolUseId || 'unknown';
    const resultKey = `result:${tId}`;
    if (processedEventIds && processedEventIds.has(resultKey)) {
      return; // already handled
    }
    if (processedEventIds) processedEventIds.add(resultKey);
    let tName = toolResult.name || null;
    if (!tName && toolResult.toolUseId) {
      tName = toolUseMap.get(toolResult.toolUseId) || 'unknown';
    }
    // minimal logging: omit per-result processing logs

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
  setMessages: (updater: (prev: UiMessage[]) => UiMessage[]) => void;
  setButtonStatus: (status: string) => void;
  flushPendingText: (conversationId?: string | null, preserveContent?: boolean) => void;
  saveToolCall?: (payload: ToolPersistencePayload) => void;
  saveToolResult?: (payload: ToolPersistencePayload) => void;
  conversationId: string | null;
}

export function processToolEvent(
  eventMsg: AgentEventFrame,
  context: ProcessToolEventContext,
  callbacks: ProcessToolEventCallbacks,
) {
  const { processedEventIds, toolUseMap, hasStreamingStarted, setHasStreamingStarted } = context;

  const { setMessages, setButtonStatus, flushPendingText, saveToolCall, saveToolResult, conversationId } = callbacks;

  // minimal logging: omit raw event frame logs

  // Initialize streaming mode on first event (handles tool-first scenarios)
  if (!hasStreamingStarted) {
    // minimal logging: omit init logs
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
    const startKey = `start:${extractEventKey(eventMsg) || 'unknown'}`;
    if (!processedEventIds.has(startKey)) {
      processedEventIds.add(startKey);
      handleToolUseStart(eventMsg, toolUseMap, messageHelpers, flushPendingText, conversationId);
    }
    return;
  }

  // Handle streamed tool input (arguments) deltas - ignore for UI, only log
  const flatDeltaToolUse: ContentBlockDeltaToolUse | undefined = eventMsg.contentBlockDelta?.delta?.toolUse as
    | ContentBlockDeltaToolUse
    | undefined;
  const getNestedDelta = (f: AgentEventFrame): ContentBlockDeltaEvent | undefined => {
    const e = f.event as { contentBlockDelta?: ContentBlockDeltaEvent } | undefined;
    return e?.contentBlockDelta;
  };
  const nestedDeltaToolUse: ContentBlockDeltaToolUse | undefined = getNestedDelta(eventMsg)?.delta?.toolUse;
  const toolUseDelta = flatDeltaToolUse || nestedDeltaToolUse;
  if (toolUseDelta && typeof toolUseDelta === 'object') {
    // minimal logging: ignore incremental deltas
    return;
  }

  // Handle Strands-style tool_stream_event frames carrying tool args
  const toolStreamEvt = eventMsg.tool_stream_event;
  if (toolStreamEvt && typeof toolStreamEvt === 'object') {
    // minimal logging: ignore tool_stream events
    return;
  }

  // Handle final tool input from message.content[].toolUse
  const getNestedMessageContent = (f: AgentEventFrame): unknown[] | undefined => {
    const e = f.event as { message?: { content?: unknown[] } } | undefined;
    return e?.message?.content as unknown[] | undefined;
  };
  const msgContent = eventMsg?.message?.content || getNestedMessageContent(eventMsg);
  if (Array.isArray(msgContent)) {
    const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
    for (const c of msgContent) {
      if (!isRecord(c)) continue;
      const toolUseRaw = (c as Record<string, unknown>)['toolUse'];
      if (isRecord(toolUseRaw) && 'input' in toolUseRaw) {
        const tu = toolUseRaw as Record<string, unknown>;
        let payload = tu['input'];
        if (typeof payload === 'string') {
          try {
            payload = JSON.parse(payload);
          } catch {
            // leave as string
          }
        }
        const tId = typeof tu['toolUseId'] === 'string' ? (tu['toolUseId'] as string) : 'unknown';
        const inputKey = `input:${tId}`;
        if (!processedEventIds.has(inputKey)) {
          processedEventIds.add(inputKey);
          // Debug log of final tool input
          const tName = typeof tu['name'] === 'string' ? (tu['name'] as string) : toolUseMap.get(tId) || 'unknown';
          console.log('[ToolEventHandlers] Final tool call input:', { toolUseId: tId, name: tName, input: payload });
          // Persist tool call now that input is finalized
          if (saveToolCall) {
            // Compose a normalized payload including parsed input
            const fullPayload: Record<string, unknown> = { toolUseId: tId, name: tName, input: payload };
            saveToolCall({
              toolName: tName,
              toolUseId: tId,
              toolPayload: fullPayload,
              content: `Tool call: ${tName}`,
            });
          }
        }
        // Only add one input per frame
        return;
      }
    }
  }

  // Handle tool results
  const toolResults = extractToolResults(eventMsg);
  if (toolResults.length > 0) {
    handleToolResults(
      toolResults,
      toolUseMap,
      messageHelpers,
      flushPendingText,
      conversationId,
      saveToolResult,
      processedEventIds,
    );
    return;
  }

  if (eventMsg?.type === 'tool_use_complete') {
    // minimal logging: omit completion chatter
  }
}
