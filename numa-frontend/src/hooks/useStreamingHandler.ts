import { useRef, useCallback } from 'react';
import { parseChunkWithoutDocComments, createDocStripState } from '../utils/streamingProcessors';

/**
 * Hook for managing streaming chat responses, text buffering, and tool events
 * Extracted from NumaChat.jsx to improve maintainability
 */
export const useStreamingHandler = () => {
  // Streaming state refs
  const textBufferRef = useRef('');
  const processedEventIdsRef = useRef(new Set());
  const toolUseMapRef = useRef(new Map());
  const finalFlushPerformedRef = useRef(false);

  /**
   * Reset streaming state for a new conversation turn
   */
  const resetStreamingState = useCallback(() => {
    textBufferRef.current = '';
    processedEventIdsRef.current.clear();
    toolUseMapRef.current.clear();
    finalFlushPerformedRef.current = false;
  }, []);

  /**
   * Create streaming callbacks for chat agent
   * @param {Object} params - Configuration object
   * @param {Function} params.setMessages - State setter for messages
   * @param {Function} params.setButtonStatus - State setter for button status
   * @param {Function} params.flushPendingText - Function to flush buffered text
   * @param {string} params.conversationId - Current conversation ID
   * @param {Function} params.onStreamComplete - Callback when streaming completes
   * @param {Function} params.onStreamError - Callback when streaming errors
   * @returns {Object} Streaming callback functions
   */
  const createStreamingCallbacks = useCallback(
    ({ setMessages, setButtonStatus, flushPendingText, conversationId, onStreamComplete, onStreamError }) => {
      let hasStreamingStarted = false;
      let hasReceivedTextChunk = false;
      let accumulatedResponse = '';
      const docStripState = createDocStripState();

      const onChunk = (chunk) => {
        if (!hasStreamingStarted) {
          // Remove 'thinking' status, set 'streaming' status
          setMessages((prev) => {
            const updated = [...prev];
            const idx = updated.findIndex((m) => m.status === 'thinking');
            if (idx >= 0) updated[idx].status = null;
            return updated;
          });
          setButtonStatus('streaming');
          hasStreamingStarted = true;
        }
        hasReceivedTextChunk = true;

        // Accumulate the response
        accumulatedResponse += chunk;

        // Parse chunk to remove doc comments for display
        const sanitizedChunk = parseChunkWithoutDocComments(chunk, docStripState);

        // Add to streaming content buffer (will be flushed when tools are called or at end)
        textBufferRef.current += sanitizedChunk;

        // Create a snapshot of the current buffer content for UI updates (race condition protection)
        const bufferSnapshot = textBufferRef.current;

        // Update the last assistant message with live streaming content using buffer snapshot
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          const lastMsg = { ...updated[lastIdx] };
          const segs = [...(lastMsg.segments || [])];

          // Update the last text segment if it exists and is "live", otherwise create new one
          if (segs.length && segs[segs.length - 1].kind === 'text' && !segs[segs.length - 1].finalized) {
            segs[segs.length - 1] = { ...segs[segs.length - 1], text: bufferSnapshot };
          } else {
            segs.push({ kind: 'text', text: bufferSnapshot, finalized: false });
          }

          lastMsg.segments = segs;
          lastMsg.content = bufferSnapshot; // legacy path
          updated[lastIdx] = lastMsg;
          return updated;
        });
      };

      const onComplete = () => {
        console.log('[StreamingHandler] Chat agent completion callback triggered');
        console.log(
          '[StreamingHandler] Final streaming state - hasStreamingStarted:',
          hasStreamingStarted,
          'hasReceivedTextChunk:',
          hasReceivedTextChunk,
        );

        // Clean up abort function reference

        setButtonStatus('idle');
        // Flush any remaining text to save the final segment with content preservation
        console.log('[StreamingHandler] Stream completion - flushing final text buffer');
        flushPendingText(conversationId, true); // preserveContent=true to prevent race condition

        // Call completion callback with accumulated response
        if (onStreamComplete) {
          onStreamComplete(accumulatedResponse, false);
        }
      };

      const onError = (error) => {
        console.error('Error in streaming handler:', error);

        // Call error callback
        if (onStreamError) {
          onStreamError(error);
        }

        setButtonStatus('idle');
      };

      return {
        onChunk,
        onComplete,
        onError,
        accumulatedResponse: () => accumulatedResponse,
      };
    },
    [],
  );

  /**
   * Set the current abort function
   */
  const setCurrentAbort = useCallback((abortFn) => {
    // This is used for cleanup purposes, not user-initiated stopping
    console.log('[StreamingHandler] Setting abort function:', !!abortFn);
  }, []);

  return {
    // State refs (for external access if needed)
    textBufferRef,
    processedEventIdsRef,
    toolUseMapRef,
    finalFlushPerformedRef,

    // Functions
    resetStreamingState,
    createStreamingCallbacks,
    setCurrentAbort,
  };
};
