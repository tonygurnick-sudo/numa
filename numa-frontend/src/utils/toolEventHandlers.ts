import { TOOL_CONFIG } from './ToolConfig';

/**
 * Utility functions for handling tool events during streaming
 * Extracted from NumaChat.jsx to improve maintainability
 */

/**
 * Extract a unique event key for deduplication
 */
export function extractEventKey(eventMsg) {
  return (
    eventMsg?.event?.contentBlockStart?.start?.toolUse?.toolUseId ||
    eventMsg?.event?.toolResult?.toolUseId ||
    eventMsg?.message?.toolResult?.toolUseId ||
    eventMsg?.event?.messageStop?.toolUseId ||
    eventMsg?.id ||
    null
  );
}

/**
 * Check if event has already been processed
 */
export function isEventProcessed(eventKey, processedEventIds) {
  if (!eventKey) return false;
  return processedEventIds.has(eventKey);
}

/**
 * Mark event as processed
 */
export function markEventProcessed(eventKey, processedEventIds) {
  if (eventKey) {
    processedEventIds.add(eventKey);
  }
}

/**
 * Create helper functions for updating message segments
 */
export function createMessageHelpers(setMessages) {
  const appendToolEvent = (label, toolUseId = null, isLoading = false) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      const lastMsg = { ...updated[lastIdx] };
      const segs = [...(lastMsg.segments || [])];
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

  const updateToolLoadingState = (toolUseId, isLoading) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      const lastMsg = { ...updated[lastIdx] };
      const segs = [...(lastMsg.segments || [])];

      // Find the tool segment with matching toolUseId
      const toolSegIndex = segs.findIndex((seg) => seg.kind === 'tool' && seg.toolUseId === toolUseId);

      if (toolSegIndex >= 0) {
        segs[toolSegIndex] = { ...segs[toolSegIndex], isLoading };
        lastMsg.segments = segs;
        updated[lastIdx] = lastMsg;
        console.log('[ToolEventHandlers] Updated tool loading state for', toolUseId, 'to', isLoading);
      }

      return updated;
    });
  };

  const addToolResult = (toolName, toolResult) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      const lastMsg = { ...updated[lastIdx] };
      const segs = [...(lastMsg.segments || [])];
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
  eventMsg,
  toolUseMap,
  messageHelpers,
  flushPendingText,
  conversationId,
  saveToolCall,
) {
  const toolInfo = eventMsg.event.contentBlockStart.start.toolUse;
  const toolName = toolInfo.name || 'tool';
  const toolLabel = TOOL_CONFIG[toolName]?.label || toolName;
  const useId = toolInfo.toolUseId || toolInfo.id;

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

/**
 * Extract tool results from event message
 */
export function extractToolResults(eventMsg) {
  const results = [];
  if (eventMsg?.message?.toolResult) results.push(eventMsg.message.toolResult);
  if (eventMsg?.event?.toolResult) results.push(eventMsg.event.toolResult);

  const contentArr = eventMsg?.message?.content || eventMsg?.event?.message?.content;
  if (Array.isArray(contentArr)) {
    contentArr.forEach((c) => {
      if (c.toolResult) results.push(c.toolResult);
    });
  }

  if (eventMsg?.delta?.toolResult) results.push(eventMsg.delta.toolResult);
  return results;
}

/**
 * Handle tool results
 */
export function handleToolResults(
  toolResults,
  toolUseMap,
  messageHelpers,
  flushPendingText,
  conversationId,
  saveToolResult,
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
export function processToolEvent(eventMsg, context, callbacks) {
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
  if (eventMsg?.event?.contentBlockStart?.start?.toolUse) {
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
