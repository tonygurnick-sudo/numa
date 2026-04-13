import { useRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  stopWorkspaceChatAgent,
  streamWorkspaceChatAgent,
  saveInlineDocumentToS3,
  isRetryableError,
  getWorkspaceChatRawTrace,
  checkConversationStatus,
  pollConversationUntilComplete,
} from '../Services/workspaceChatAgentService';
import type { StreamRetryConfig } from '../Services/workspaceChatAgentService';
import {
  createSDKEventContext,
  resetSDKEventContext,
  createWorkspaceChatMessageHelpers,
  processSDKEvent,
  handleSDKStreamComplete,
  handleSDKStreamError,
  createInitialToolSegment,
  updateSegmentWithInput,
  getToolSegmentKind,
} from '../utils/workspaceChatEventHandlers';
import { parseChunkWithoutDocComments, extractSingleDocBlock } from '../utils/streamingProcessors';
import { parseRawTraceToMessages } from '../utils/workspaceChatEventHandlers';
import type { SDKEventContext, SDKEvent, SDKStreamEvent, WorkspaceChatModelId } from '../types/workspaceChatTypes';
import type { AwsCredentialIdentity } from '@aws-sdk/types';

type Message = {
  role: string;
  content?: string;
  segments?: Array<{
    kind: string;
    text?: string;
    finalized?: boolean;
    collapsed?: boolean;
    toolUseId?: string;
    parentToolUseId?: string;
    events?: unknown[];
    _blockIndex?: number;
    [key: string]: unknown;
  }>;
  status?: string | null;
  docTitle?: string;
  docContent?: string;
};

type DocumentProcessor = {
  setInlineDocument: (doc: { title: string; content: string }) => void;
  setShowSplitView: (show: boolean) => void;
  setLeftFraction: (fraction: number) => void;
};

type StreamConfig = {
  prompt: string;
  conversationId: string;
  enabledTools: string[];
  enabledConnections: string[];
  availableIntegrations: Array<{ id: string; name: string }>;
  connectedDataConnectors?: Array<{ id: string; name: string }>;
  dataConnectorsEnabled?: boolean;
  enabledKBIds: string[];
  availableKBs: Array<{ kb_id: string; kb_name: string }>;
  /** File and folder attachments */
  attachments?: {
    files: Array<{ path: string; filename: string; size: number }>;
    folders?: Array<{ name: string; path: string; fileCount: number; totalSize: number }>;
  };
  /** Model ID for cross-region inference profile selection */
  modelId?: WorkspaceChatModelId;
  /** V1 to V2 migration flag - set when continuing a V1 conversation in V2 */
  migrateFromV1?: boolean;
  /** Agent ID for custom agent prompts and restrictions */
  agentId?: string;
  /** Paths to voice recordings that should be auto-transcribed into the user message */
  voiceRecordings?: string[];
};

type UseWorkspaceChatStreamingOptions = {
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setButtonStatus: (status: string) => void;
  documentProcessor: DocumentProcessor;
  isProcessingRef: React.MutableRefObject<boolean>;
  setCurrentAbort: (abort: (() => void) | null) => void;
  refreshSidebar: () => void;
  setUploadedFiles: (files: never[]) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  hasUserStartedNewChat: boolean;
  resetUserNewChatFlag: () => void;
  /** Optional callback to set initialization state (workspace sync in progress) */
  setIsInitializing?: (isInitializing: boolean) => void;
  /** Optional callback invoked after stream completes successfully (for auto-naming, etc.) */
  onStreamComplete?: (conversationId: string) => void;
  /** AWS credentials getter for saving inline documents to S3 */
  getCredentials?: () => Promise<AwsCredentialIdentity>;
  /** Callback to refresh the session files panel after saving inline docs */
  refreshSessionFiles?: () => void;
  /** Authenticated POST helper for API calls (transcription submit, etc.) */
  numaPost?: (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
  /** Optional callback to send a browser notification when chat completes while user is away */
  onNotifyCompletion?: (conversationName?: string) => void;
  /** Async ID token getter from AuthProvider -- ensures fresh tokens for API calls */
  getIdToken?: () => Promise<string | null>;
};

const resolveErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return fallback;
};

export function useWorkspaceChatStreaming({
  setMessages,
  setButtonStatus,
  documentProcessor,
  isProcessingRef,
  setCurrentAbort,
  refreshSidebar,
  setUploadedFiles,
  inputRef,
  hasUserStartedNewChat,
  resetUserNewChatFlag,
  setIsInitializing,
  onStreamComplete,
  getCredentials,
  refreshSessionFiles,
  numaPost,
  onNotifyCompletion,
  getIdToken,
}: UseWorkspaceChatStreamingOptions) {
  const { t } = useTranslation('chat');

  // Workspace chat-specific refs
  const workspaceChatEventContextRef = useRef<SDKEventContext>(createSDKEventContext());
  const workspaceChatAbortRef = useRef<(() => void) | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const currentConversationIdRef = useRef<string | null>(null);
  const streamingToolsRef = useRef<
    Map<number, { id: string; name: string; inputBuffer: string; parentToolUseId?: string | null }>
  >(new Map());
  const activeStreamingTasksRef = useRef<Set<string>>(new Set());
  const workspaceChatRawTextRef = useRef<string>('');
  const [isStopping, setIsStopping] = useState(false);
  const isStoppingRef = useRef(false);

  // Network resilience state
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [maxRetryAttempts] = useState(3);
  const [canRetry, setCanRetry] = useState(false);
  const lastStreamConfigRef = useRef<StreamConfig | null>(null);

  const abortStream = useCallback(() => {
    if (workspaceChatAbortRef.current) {
      workspaceChatAbortRef.current();
      workspaceChatAbortRef.current = null;
    }
    setIsStopping(false);
    isStoppingRef.current = false;
    setIsReconnecting(false);
    setRetryAttempt(0);
    setCanRetry(false);
    currentRequestIdRef.current = null;
  }, []);

  const stopStream = useCallback(async () => {
    const conversationId = currentConversationIdRef.current;
    const requestId = currentRequestIdRef.current;
    if (!conversationId || !requestId) {
      console.warn('[WorkspaceChat] Stop requested but no active conversation/request ID found');
      return;
    }

    setIsStopping(true);
    isStoppingRef.current = true;
    try {
      await stopWorkspaceChatAgent(conversationId, requestId, getIdToken);
    } catch (err) {
      console.error('[WorkspaceChat] Stop request failed:', err);
      setIsStopping(false);
      isStoppingRef.current = false;
    }
  }, [getIdToken]);

  const streamChat = useCallback(
    async (config: StreamConfig) => {
      const {
        prompt,
        conversationId,
        enabledTools,
        enabledConnections,
        availableIntegrations,
        connectedDataConnectors,
        dataConnectorsEnabled,
        enabledKBIds,
        availableKBs,
        attachments,
        modelId,
        migrateFromV1,
        agentId,
        voiceRecordings,
      } = config;

      // Store config for retry capability
      lastStreamConfigRef.current = config;

      // Reset workspace chat event context for new turn
      resetSDKEventContext(workspaceChatEventContextRef.current);
      workspaceChatRawTextRef.current = '';
      streamingToolsRef.current.clear();
      activeStreamingTasksRef.current.clear();
      currentConversationIdRef.current = conversationId;
      setIsStopping(false);
      setIsReconnecting(false);
      setRetryAttempt(0);
      setCanRetry(false);

      // Generate requestId immediately so stop can use it during streaming
      const requestId = crypto.randomUUID();
      currentRequestIdRef.current = requestId;

      // Create workspace chat message helpers
      const workspaceChatHelpers = createWorkspaceChatMessageHelpers(setMessages, setButtonStatus);

      // Get timezone for the request
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // Build KB metadata from enabled IDs
      const kbNameById = new Map<string, string>();
      availableKBs.forEach((kb) => kbNameById.set(kb.kb_id, kb.kb_name));
      const workspaceChatKBs = enabledKBIds.map((id) => ({ id, name: kbNameById.get(id) || id }));

      const { abort: abortWorkspaceChat } = await streamWorkspaceChatAgent(
        {
          prompt,
          conversationId,
          timezone,
          availableKBs: workspaceChatKBs,
          enabledTools,
          enabledConnections,
          availableIntegrations,
          connectedDataConnectors,
          dataConnectorsEnabled,
          modelId,
          attachments,
          hasUploads: !!attachments?.files && attachments.files.length > 0,
          expectedUploadPaths: attachments?.files?.map((a) => a.path),
          voiceRecordings,
          migrateFromV1: migrateFromV1 || false,
          agentId,
          requestId, // Pass pre-generated requestId so stop works during streaming
        },
        // onEvent - handle SDK events and StreamEvents for real-time streaming
        (event: SDKEvent) => {
          // Handle StreamEvent type for real-time streaming
          if (event.type === 'StreamEvent') {
            workspaceChatEventContextRef.current.skipTextFromAssistant = true;

            const streamEvent = (event as SDKStreamEvent).event;
            const blockIndex = streamEvent?.index ?? -1;

            // === TEXT DELTAS ===
            if (
              streamEvent?.type === 'content_block_delta' &&
              streamEvent.delta?.type === 'text_delta' &&
              streamEvent.delta?.text
            ) {
              const rawTextDelta = streamEvent.delta.text;
              workspaceChatRawTextRef.current += rawTextDelta;

              const textDelta = parseChunkWithoutDocComments(
                rawTextDelta,
                workspaceChatEventContextRef.current.docStripState
              );

              if (!textDelta) return;

              setButtonStatus('streaming');

              setMessages((prev) => {
                const updated = [...prev];
                let lastMsg = updated[updated.length - 1];

                if (!lastMsg || lastMsg.role !== 'assistant') {
                  lastMsg = { role: 'assistant', content: '', segments: [], status: null };
                  updated.push(lastMsg);
                } else {
                  lastMsg = { ...lastMsg };
                  updated[updated.length - 1] = lastMsg;
                }

                // Clear processing/thinking/transcribing status when text starts arriving
                if (
                  lastMsg.status === 'thinking' ||
                  lastMsg.status === 'processing' ||
                  lastMsg.status === 'transcribing'
                ) {
                  lastMsg.status = 'streaming';
                }

                const segments = [...(lastMsg.segments || [])];

                // Remove inline_thinking spinner when text starts (thinking is done)
                const inlineThinkingIdx = segments.findIndex((s) => s.kind === 'inline_thinking');
                if (inlineThinkingIdx >= 0) {
                  segments.splice(inlineThinkingIdx, 1);
                }

                // Mark any pending tool_cards as complete when text starts streaming.
                // The model can only generate text after tool results are available,
                // so arriving text is a reliable signal that preceding tools have finished.
                // The tool_result user event may not arrive during streaming, leaving
                // tool_cards in isLoading state — this ensures the spinner stops.
                for (let i = 0; i < segments.length; i++) {
                  const seg = segments[i];
                  if (seg.kind === 'tool_card' && seg.isLoading) {
                    segments[i] = { ...seg, isLoading: false };
                  }
                }

                const lastSeg = segments[segments.length - 1];

                if (lastSeg?.kind === 'text' && !lastSeg.finalized) {
                  segments[segments.length - 1] = { ...lastSeg, text: (lastSeg.text || '') + textDelta };
                } else {
                  segments.push({ kind: 'text', text: textDelta, finalized: false });
                }

                lastMsg.segments = segments;
                lastMsg.content = segments
                  .filter((s): s is { kind: 'text'; text: string } => s.kind === 'text')
                  .map((s) => s.text)
                  .join('');

                return updated;
              });
            }

            // === THINKING BLOCK START (spinner only, text is filtered by proxy) ===
            if (streamEvent?.type === 'content_block_start' && streamEvent.content_block?.type === 'thinking') {
              setMessages((prev) => {
                const updated = [...prev];
                let lastMsg = updated[updated.length - 1];

                if (!lastMsg || lastMsg.role !== 'assistant') {
                  lastMsg = { role: 'assistant', content: '', segments: [] };
                  updated.push(lastMsg);
                } else {
                  lastMsg = { ...lastMsg };
                  updated[updated.length - 1] = lastMsg;
                }

                if (lastMsg.status === 'processing' || lastMsg.status === 'transcribing') {
                  lastMsg.status = 'thinking';
                }

                const segments = [...(lastMsg.segments || [])];
                const hasInlineThinking = segments.some((s) => s.kind === 'inline_thinking');
                if (!hasInlineThinking) {
                  segments.push({ kind: 'inline_thinking', isStreaming: true });
                }

                lastMsg.segments = segments;
                return updated;
              });
            }

            // === TOOL BLOCK START ===
            if (
              streamEvent?.type === 'content_block_start' &&
              streamEvent.content_block?.type === 'tool_use' &&
              streamEvent.content_block.id &&
              streamEvent.content_block.name
            ) {
              const { id, name } = streamEvent.content_block;
              const parentToolUseId = (event as SDKStreamEvent).parent_tool_use_id;

              const activeTaskId =
                activeStreamingTasksRef.current.size > 0
                  ? Array.from(activeStreamingTasksRef.current)[activeStreamingTasksRef.current.size - 1]
                  : null;
              const effectiveParentId = parentToolUseId || (name !== 'Task' ? activeTaskId : null);

              streamingToolsRef.current.set(blockIndex, {
                id,
                name,
                inputBuffer: '',
                parentToolUseId: effectiveParentId,
              });

              workspaceChatEventContextRef.current.toolUseMap.set(id, {
                name,
                input: {},
                parentToolUseId: effectiveParentId,
              });

              if (name === 'Task') {
                activeStreamingTasksRef.current.add(id);
              }

              if (effectiveParentId) {
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  if (lastIdx < 0) return prev;

                  const lastMsg = { ...updated[lastIdx] };
                  const segments = [...(lastMsg.segments || [])];

                  const parentIdx = segments.findIndex(
                    (s) => s.kind === 'subagent' && s.parentToolUseId === effectiveParentId
                  );

                  if (parentIdx >= 0) {
                    const parentSeg = segments[parentIdx] as { kind: 'subagent'; events: unknown[] };
                    segments[parentIdx] = {
                      ...parentSeg,
                      events: [
                        ...parentSeg.events,
                        {
                          type: 'assistant',
                          message: { content: [{ type: 'tool_use', id, name, input: {} }] },
                        },
                      ],
                    };
                    lastMsg.segments = segments;
                    updated[lastIdx] = lastMsg;
                  }

                  return updated;
                });
              } else {
                const initialSegment = createInitialToolSegment(name, id);

                if (initialSegment) {
                  setMessages((prev) => {
                    const updated = [...prev];
                    let lastMsg = updated[updated.length - 1];

                    if (!lastMsg || lastMsg.role !== 'assistant') {
                      lastMsg = { role: 'assistant', content: '', segments: [] };
                      updated.push(lastMsg);
                    } else {
                      lastMsg = { ...lastMsg };
                      updated[updated.length - 1] = lastMsg;
                    }

                    // Clear processing/thinking/transcribing status when tool starts
                    if (
                      lastMsg.status === 'processing' ||
                      lastMsg.status === 'thinking' ||
                      lastMsg.status === 'transcribing'
                    ) {
                      lastMsg.status = 'streaming';
                    }

                    const segments = [...(lastMsg.segments || [])];

                    // Remove inline_thinking spinner when tool starts
                    const inlineThinkingIdx = segments.findIndex((s) => s.kind === 'inline_thinking');
                    if (inlineThinkingIdx >= 0) {
                      segments.splice(inlineThinkingIdx, 1);
                    }

                    segments.push(initialSegment);

                    lastMsg.segments = segments;
                    updated[updated.length - 1] = lastMsg;
                    return updated;
                  });
                }
              }
            }

            // === TOOL INPUT DELTA ===
            if (
              streamEvent?.type === 'content_block_delta' &&
              streamEvent.delta?.type === 'input_json_delta' &&
              blockIndex >= 0
            ) {
              const toolInfo = streamingToolsRef.current.get(blockIndex);
              if (toolInfo) {
                toolInfo.inputBuffer += streamEvent.delta.partial_json || '';
              }
            }

            // === CONTENT BLOCK STOP ===
            if (streamEvent?.type === 'content_block_stop' && blockIndex >= 0) {
              const toolInfo = streamingToolsRef.current.get(blockIndex);
              if (toolInfo) {
                let input: Record<string, unknown> = {};
                try {
                  input = JSON.parse(toolInfo.inputBuffer);
                } catch {
                  /* ignore parse errors */
                }

                if (toolInfo.parentToolUseId) {
                  setMessages((prev) => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    if (lastIdx < 0) return prev;

                    const lastMsg = { ...updated[lastIdx] };
                    const segments = [...(lastMsg.segments || [])];

                    const parentIdx = segments.findIndex(
                      (s) => s.kind === 'subagent' && s.parentToolUseId === toolInfo.parentToolUseId
                    );

                    if (parentIdx >= 0) {
                      const parentSeg = segments[parentIdx] as {
                        kind: 'subagent';
                        events: Array<{
                          type: string;
                          message?: { content?: Array<{ type: string; id?: string; input?: unknown }> };
                        }>;
                      };
                      const updatedEvents = parentSeg.events.map((evt) => {
                        if (evt.type === 'assistant' && evt.message?.content) {
                          const updatedContent = evt.message.content.map((block) => {
                            if (block.type === 'tool_use' && block.id === toolInfo.id) {
                              return { ...block, input };
                            }
                            return block;
                          });
                          return { ...evt, message: { ...evt.message, content: updatedContent } };
                        }
                        return evt;
                      });
                      segments[parentIdx] = { ...parentSeg, events: updatedEvents };
                      lastMsg.segments = segments;
                      updated[lastIdx] = lastMsg;
                    }

                    return updated;
                  });
                } else {
                  setMessages((prev) => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    if (lastIdx < 0) return prev;

                    const lastMsg = { ...updated[lastIdx] };
                    const segments = [...(lastMsg.segments || [])];

                    const segIdx = segments.findIndex((s) => {
                      return s.toolUseId === toolInfo.id || s.parentToolUseId === toolInfo.id;
                    });

                    if (segIdx >= 0) {
                      segments[segIdx] = updateSegmentWithInput(segments[segIdx], toolInfo.name, input);
                      lastMsg.segments = segments;
                      updated[lastIdx] = lastMsg;
                    }

                    return updated;
                  });
                }

                streamingToolsRef.current.delete(blockIndex);
              }
            }

            return;
          }

          // Handle Task tool_use in assistant events
          if (event.type === 'assistant') {
            const assistantEvent = event as { message?: { content?: unknown[] } };
            const content = assistantEvent.message?.content ?? [];
            for (const block of content) {
              if (typeof block === 'object' && block !== null) {
                const toolBlock = block as { type?: string; name?: string; id?: string };
                if (toolBlock.type === 'tool_use' && toolBlock.name === 'Task' && toolBlock.id) {
                  activeStreamingTasksRef.current.add(toolBlock.id);
                }
              }
            }
          }

          // Handle tool results - mark tools complete when we receive their result
          if (event.type === 'user') {
            const userEvent = event as { message?: { content?: unknown[] }; content?: unknown[] };
            const content = userEvent.message?.content ?? userEvent.content ?? [];
            for (const block of content) {
              if (typeof block === 'object' && block !== null && (block as { type?: string }).type === 'tool_result') {
                const resultBlock = block as { tool_use_id?: string; is_error?: boolean };
                const toolUseId = resultBlock.tool_use_id;
                const isError = resultBlock.is_error ?? false;

                // Mark Task tool results
                if (toolUseId && activeStreamingTasksRef.current.has(toolUseId)) {
                  activeStreamingTasksRef.current.delete(toolUseId);
                }

                // Mark tool as complete (inline_tool or tool_card)
                if (toolUseId) {
                  const resultContent = (block as { content?: unknown }).content;

                  setMessages((prev) => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    if (lastIdx < 0) return prev;

                    const lastMsg = { ...updated[lastIdx] };
                    let segments = [...(lastMsg.segments || [])];

                    // Find tool_card with matching toolUseId first (e.g. Numa Ops).
                    // tool_card is checked before inline_tool because during streaming,
                    // the assistant SDK event can arrive before its StreamEvents, causing
                    // handleToolUseBlock to create a duplicate inline_tool segment with
                    // the same toolUseId. The tool_card (from StreamEvent handler) is the
                    // primary segment that needs the result data.
                    const cardIdx = segments.findIndex(
                      (seg) => seg.kind === 'tool_card' && seg.toolUseId === toolUseId
                    );

                    if (cardIdx >= 0) {
                      segments[cardIdx] = {
                        ...segments[cardIdx],
                        result: resultContent,
                        isLoading: false,
                        isError,
                      };
                      lastMsg.segments = segments;
                      updated[lastIdx] = lastMsg;
                      return updated;
                    }

                    // Find inline_tool with matching toolUseId
                    const toolIdx = segments.findIndex(
                      (seg) => seg.kind === 'inline_tool' && seg.toolUseId === toolUseId && !seg.isComplete
                    );

                    if (toolIdx >= 0) {
                      const tool = segments[toolIdx];

                      // If transient tool, remove it entirely; otherwise mark complete
                      if (tool.category === 'transient') {
                        // Finalize the preceding text segment so that subsequent
                        // text starts a new segment instead of concatenating directly
                        if (toolIdx > 0) {
                          const prevSeg = segments[toolIdx - 1];
                          if (prevSeg.kind === 'text') {
                            segments[toolIdx - 1] = { ...prevSeg, finalized: true };
                          }
                        }
                        segments = segments.filter((_, idx) => idx !== toolIdx);
                      } else {
                        segments[toolIdx] = { ...tool, isComplete: true, isError };
                      }

                      lastMsg.segments = segments;
                      updated[lastIdx] = lastMsg;
                      return updated;
                    }

                    return prev;
                  });
                }
              }
            }
          }

          // Route subagent events
          const activeTaskId =
            activeStreamingTasksRef.current.size > 0
              ? Array.from(activeStreamingTasksRef.current)[activeStreamingTasksRef.current.size - 1]
              : null;

          if (activeTaskId && event.type === 'assistant') {
            const assistantEvent = event as { message?: { content?: unknown[] } };
            const content = assistantEvent.message?.content ?? [];
            const hasTaskTool = content.some(
              (b) =>
                typeof b === 'object' &&
                b !== null &&
                (b as { type?: string; name?: string }).type === 'tool_use' &&
                (b as { name?: string }).name === 'Task'
            );

            if (!hasTaskTool) {
              setMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx < 0) return prev;

                const lastMsg = { ...updated[lastIdx] };
                const segments = [...(lastMsg.segments || [])];

                const parentIdx = segments.findIndex(
                  (s) => s.kind === 'subagent' && s.parentToolUseId === activeTaskId
                );

                if (parentIdx >= 0) {
                  const parentSeg = segments[parentIdx] as { kind: 'subagent'; events: unknown[] };
                  segments[parentIdx] = {
                    ...parentSeg,
                    events: [...parentSeg.events, event],
                  };
                  lastMsg.segments = segments;
                  updated[lastIdx] = lastMsg;
                }

                return updated;
              });
              return;
            }
          }

          // Handle transcribing events (voice input pre-processing)
          if (event.type === 'transcribing') {
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
                updated[lastIdx] = { ...updated[lastIdx], status: 'transcribing' };
              }
              return updated;
            });
            return;
          }

          // Process non-StreamEvent events
          processSDKEvent(event, workspaceChatEventContextRef.current, workspaceChatHelpers);
        },
        // onComplete
        ({ receivedCompletion }) => {
          handleSDKStreamComplete(workspaceChatEventContextRef.current, workspaceChatHelpers);

          // If the stream closed without a proper completion marker
          // (ResultMessage / completion / error from the agent), the
          // connection was likely dropped mid-stream (e.g. timeout).
          // Show a system message so the user knows the response may
          // be incomplete and they can retry.
          if (!receivedCompletion && isStoppingRef.current) {
            // User clicked Stop — show a clean "stopped" message, skip reconnection logic
            console.info('[WorkspaceChat] Stream ended by user stop action');
            isStoppingRef.current = false;
            setIsStopping(false);
            isProcessingRef.current = false;
            setButtonStatus('idle');
            setMessages((prev) => [
              ...prev,
              { role: 'system' as const, content: t('chat:systemMessages.stoppedByUser') },
            ]);
          } else if (!receivedCompletion) {
            console.warn('[WorkspaceChat] Stream closed without completion marker — possible timeout');
            const disconnectedConvId = currentConversationIdRef.current;

            // Check if the agent is still running server-side before deciding what to show.
            // The proxy Lambda may have timed out but the agent keeps running on AgentCore.
            if (disconnectedConvId) {
              // Keep the UI in a loading state (disables send button + input controls)
              isProcessingRef.current = true;
              setButtonStatus('loading');
              setMessages((prev) => [
                ...prev,
                { role: 'system', content: t('chat:systemMessages.agentFinishing'), status: 'agentFinishing' },
              ]);

              checkConversationStatus(disconnectedConvId, getIdToken)
                .then(async (statusData) => {
                  if (statusData.status === 'running' && statusData.active) {
                    // Agent is still running — poll until it finishes, then reload trace
                    await pollConversationUntilComplete(
                      disconnectedConvId,
                      { intervalMs: 3000, timeoutMs: 600_000 },
                      getIdToken
                    );
                    // Agent done — reload trace from S3
                    const updatedTrace = await getWorkspaceChatRawTrace(disconnectedConvId, getIdToken);
                    const updatedMessages = parseRawTraceToMessages(updatedTrace);
                    setMessages(updatedMessages as Message[]);
                    refreshSidebar();
                    onNotifyCompletion?.();
                  } else {
                    // Agent already finished — reload trace (full response should be in S3)
                    try {
                      const updatedTrace = await getWorkspaceChatRawTrace(disconnectedConvId, getIdToken);
                      const updatedMessages = parseRawTraceToMessages(updatedTrace);
                      setMessages(updatedMessages as Message[]);
                      refreshSidebar();
                      onNotifyCompletion?.();
                    } catch {
                      // Trace not available — show Continue button as fallback
                      setMessages((prev) => [
                        ...prev.filter((m) => m.content !== t('chat:systemMessages.agentFinishing')),
                        {
                          role: 'system',
                          content: t('chat:systemMessages.streamTimedOut'),
                          action: { type: 'continue', label: t('chat:systemMessages.continueButton') },
                        },
                      ]);
                    }
                  }
                })
                .catch(() => {
                  // Status check failed — fall back to Continue button
                  setMessages((prev) => [
                    ...prev.filter((m) => m.content !== t('chat:systemMessages.agentFinishing')),
                    {
                      role: 'system',
                      content: t('chat:systemMessages.streamTimedOut'),
                      action: { type: 'continue', label: t('chat:systemMessages.continueButton') },
                    },
                  ]);
                })
                .finally(() => {
                  isProcessingRef.current = false;
                  setButtonStatus('idle');
                });
            } else {
              // No conversation ID — just show Continue button
              setMessages((prev) => [
                ...prev,
                {
                  role: 'system',
                  content: t('chat:systemMessages.streamTimedOut'),
                  action: { type: 'continue', label: t('chat:systemMessages.continueButton') },
                },
              ]);
            }
          }

          if (receivedCompletion) {
            isProcessingRef.current = false;
          }
          workspaceChatAbortRef.current = null;
          activeStreamingTasksRef.current.clear();
          isStoppingRef.current = false;
          setIsStopping(false);
          setIsReconnecting(false);
          setRetryAttempt(0);
          setCanRetry(false);

          // Extract document from accumulated raw text
          const rawText = workspaceChatRawTextRef.current;
          if (rawText) {
            const docBlock = extractSingleDocBlock(rawText);
            if (docBlock) {
              documentProcessor.setInlineDocument({
                title: docBlock.docTitle,
                content: docBlock.docContent,
              });
              documentProcessor.setShowSplitView(true);
              documentProcessor.setLeftFraction(0.45);

              setMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
                  updated[lastIdx] = {
                    ...updated[lastIdx],
                    docTitle: docBlock.docTitle,
                    docContent: docBlock.docContent,
                  };
                }
                return updated;
              });

              // Auto-save inline document to S3 outputs (fire-and-forget)
              if (getCredentials && conversationId) {
                saveInlineDocumentToS3(
                  docBlock.docTitle,
                  docBlock.docContent,
                  conversationId,
                  getCredentials,
                  numaPost
                ).then(() => refreshSessionFiles?.());
              }
            }
          }

          // Populate missing tool_card results from trace.
          // During streaming, tool_result user events may not arrive, so tool_card
          // segments end up with isLoading: false (fixed above) but no result data.
          // Fetch the trace to extract results for any tool_cards that need them
          // (e.g. Numa Ops board cards rendered by OpsToolRenderer).
          if (conversationId) {
            // Check if any tools in this turn would produce tool_card segments
            // (toolUseMap is preserved after resetSDKEventContext)
            let hasToolCards = false;
            for (const [, info] of workspaceChatEventContextRef.current.toolUseMap) {
              if (getToolSegmentKind(info.name) === 'tool_card') {
                hasToolCards = true;
                break;
              }
            }

            if (hasToolCards) {
              getWorkspaceChatRawTrace(conversationId, getIdToken)
                .then((traceContent) => {
                  // Extract tool results from user events in the trace
                  const toolResults = new Map<string, { content: unknown; isError: boolean }>();
                  for (const line of traceContent.split('\n')) {
                    if (!line.trim()) continue;
                    try {
                      const evt = JSON.parse(line);
                      if (evt.type === 'user') {
                        const content = evt.message?.content ?? evt.content ?? [];
                        if (!Array.isArray(content)) continue;
                        for (const block of content) {
                          if (block?.type === 'tool_result' && block.tool_use_id) {
                            toolResults.set(block.tool_use_id, {
                              content: block.content,
                              isError: block.is_error || false,
                            });
                          }
                        }
                      }
                    } catch {
                      /* skip invalid lines */
                    }
                  }

                  if (toolResults.size === 0) return;

                  // Surgically update only tool_card segments with missing results
                  setMessages((prev) => {
                    let changed = false;
                    const updated = prev.map((msg) => {
                      if (msg.role !== 'assistant' || !msg.segments) return msg;
                      let segChanged = false;
                      const newSegments = msg.segments.map((seg) => {
                        if (seg.kind === 'tool_card' && !seg.result && seg.toolUseId) {
                          const result = toolResults.get(seg.toolUseId);
                          if (result) {
                            segChanged = true;
                            return { ...seg, result: result.content, isLoading: false, isError: result.isError };
                          }
                        }
                        return seg;
                      });
                      if (segChanged) {
                        changed = true;
                        return { ...msg, segments: newSegments };
                      }
                      return msg;
                    });
                    return changed ? updated : prev;
                  });
                })
                .catch((err) => {
                  // Non-critical: tool results just won't render until history reload
                  console.warn('[WorkspaceChat] Failed to populate tool results from trace:', err);
                });
            }
          }

          refreshSidebar();
          refreshSessionFiles?.();
          setUploadedFiles([]);
          if (hasUserStartedNewChat) {
            resetUserNewChatFlag();
          }
          setIsStopping(false);
          currentRequestIdRef.current = null;
          // Call optional onStreamComplete callback (for auto-naming, etc.)
          // Pass conversationId from the stream config so callback has the correct value
          if (onStreamComplete) {
            onStreamComplete(conversationId);
          }
          onNotifyCompletion?.();
          setTimeout(() => inputRef.current?.focus(), 0);
        },
        // onError — called after all automatic retries are exhausted
        (err: Error) => {
          console.error('[WorkspaceChat SDK] Stream error:', err);
          handleSDKStreamError(err, workspaceChatEventContextRef.current, workspaceChatHelpers);

          // Determine if this was a network error (retries were attempted)
          const wasNetworkError = isRetryableError(err);
          const message = wasNetworkError
            ? t('chat:connection.retryFailed', { maxAttempts: 3 })
            : resolveErrorMessage(err, 'Unknown error');

          setMessages((prev) => {
            const updated = [...prev];
            // Remove any processing/thinking/transcribing status messages
            const statusIndex = updated.findIndex(
              (m) => m.status === 'thinking' || m.status === 'processing' || m.status === 'transcribing'
            );
            if (statusIndex >= 0) {
              updated.splice(statusIndex, 1);
            }
            return [
              ...updated,
              {
                role: 'system',
                content: wasNetworkError ? message : `Workspace chat agent error: ${message}`,
              },
            ];
          });
          isProcessingRef.current = false;
          workspaceChatAbortRef.current = null;
          activeStreamingTasksRef.current.clear();
          setButtonStatus('idle');
          setUploadedFiles([]);
          setIsStopping(false);
          setIsReconnecting(false);
          setRetryAttempt(0);
          // Allow manual retry for network errors
          if (wasNetworkError) {
            setCanRetry(true);
          }
          currentRequestIdRef.current = null;
          // Clear initialization state on error
          if (setIsInitializing) {
            setIsInitializing(false);
          }
          setTimeout(() => inputRef.current?.focus(), 0);
        },
        // onSessionEvent
        (event) => {
          // Handle session_init events for initialization state
          if (event.type === 'session_init') {
            const initEvent = event as { type: 'session_init'; status: 'syncing_workspace' | 'ready' };
            if (setIsInitializing) {
              setIsInitializing(initEvent.status === 'syncing_workspace');
            }
          }

          // Handle conversation_switch events
          if (event.type === 'conversation_switch') {
            const switchEvent = event as { type: 'conversation_switch'; status: 'switching' | 'ready' };
            if (setIsInitializing) {
              setIsInitializing(switchEvent.status === 'switching');
            }
          }
        },
        // retryConfig — automatic retry with exponential backoff for network errors
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          onRetry: (attempt, maxAttempts) => {
            setIsReconnecting(true);
            setRetryAttempt(attempt);
            console.warn(`[WorkspaceChat] Retry attempt ${attempt}/${maxAttempts}`);
          },
        } satisfies StreamRetryConfig,
        getIdToken
      );

      workspaceChatAbortRef.current = abortWorkspaceChat;
      setCurrentAbort(() => abortWorkspaceChat);
    },
    [
      setMessages,
      setButtonStatus,
      documentProcessor,
      isProcessingRef,
      setCurrentAbort,
      refreshSidebar,
      setUploadedFiles,
      inputRef,
      hasUserStartedNewChat,
      resetUserNewChatFlag,
      setIsInitializing,
      onStreamComplete,
      getCredentials,
      refreshSessionFiles,
      numaPost,
      getIdToken,
      t,
    ]
  );

  /**
   * Retry the last failed message.
   * Removes the error system message and replays the last streamChat() call.
   */
  const retryLastMessage = useCallback(() => {
    const lastConfig = lastStreamConfigRef.current;
    if (!lastConfig || isProcessingRef.current) return;

    // Remove the last system error message before retrying
    setMessages((prev) => {
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      if (lastIdx >= 0 && updated[lastIdx].role === 'system') {
        updated.pop();
      }
      return updated;
    });

    setCanRetry(false);
    setIsReconnecting(false);
    setRetryAttempt(0);

    // Set processing state before calling streamChat
    isProcessingRef.current = true;
    setButtonStatus('processing');

    // Re-add the processing status to the last user message
    setMessages((prev) => {
      const updated = [...prev];
      updated.push({ role: 'assistant', content: '', segments: [], status: 'processing' });
      return updated;
    });

    streamChat(lastConfig);
  }, [streamChat, isProcessingRef, setMessages, setButtonStatus]);

  return {
    streamChat,
    abortStream,
    stopStream,
    retryLastMessage,
    isStopping,
    isReconnecting,
    retryAttempt,
    maxRetryAttempts,
    canRetry,
    workspaceChatRawText: workspaceChatRawTextRef.current,
  };
}
