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
  handleSDKStreamComplete,
  handleSDKStreamError,
  createStreamEventHandler,
  getToolSegmentKind,
} from '../utils/workspaceChatEventHandlers';
import { extractSingleDocBlock } from '../utils/streamingProcessors';
import { parseRawTraceToMessages } from '../utils/workspaceChatEventHandlers';
import type { IntegrationListItem, SDKEventContext, WorkspaceChatModelId } from '../types/workspaceChatTypes';
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
  /** Integrations ENABLED for this chat — the agent can call these. Each
   *  row carries a method tag so the agent knows which MCP family (Pipedream
   *  vs native) to route to. */
  enabledIntegrations: IntegrationListItem[];
  /** Integrations AVAILABLE (connected but not necessarily enabled). Lets
   *  the agent suggest flipping something on rather than claim nothing is
   *  connected. */
  availableIntegrations: IntegrationListItem[];
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
  const pollingAbortRef = useRef<AbortController | null>(null);
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

    // Cancel any in-flight polling from the interrupted-state handler so it
    // doesn't overwrite messages after we've moved on.
    if (pollingAbortRef.current) {
      pollingAbortRef.current.abort();
      pollingAbortRef.current = null;

      // Clean up the interrupted banner and unlock the input since polling
      // is no longer running.
      setMessages((prev) => [
        ...prev.filter((m) => m.status !== 'agentFinishing'),
        { role: 'system' as const, content: t('chat:systemMessages.stoppedByUser') },
      ]);
      isProcessingRef.current = false;
      setButtonStatus('idle');
    }

    try {
      await stopWorkspaceChatAgent(conversationId, requestId, getIdToken);
    } catch (err) {
      console.error('[WorkspaceChat] Stop request failed:', err);
      setIsStopping(false);
      isStoppingRef.current = false;
    }
  }, [getIdToken, setMessages, setButtonStatus, t]);

  const streamChat = useCallback(
    async (config: StreamConfig) => {
      const {
        prompt,
        conversationId,
        enabledTools,
        enabledIntegrations,
        availableIntegrations,
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

      // Cancel any in-flight polling from a previous interrupted-state so it
      // doesn't overwrite messages after the new stream starts.
      if (pollingAbortRef.current) {
        pollingAbortRef.current.abort();
        pollingAbortRef.current = null;
      }

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
      // Send the full set of folders the user can toggle so the agent is aware
      // of folders the user has access to but hasn't enabled for this chat.
      const workspaceChatAccessibleKBs = availableKBs.map((kb) => ({
        id: kb.kb_id,
        name: kb.kb_name,
      }));

      const { abort: abortWorkspaceChat } = await streamWorkspaceChatAgent(
        {
          prompt,
          conversationId,
          timezone,
          availableKBs: workspaceChatKBs,
          accessibleKBs: workspaceChatAccessibleKBs,
          enabledTools,
          enabledIntegrations,
          availableIntegrations,
          modelId,
          attachments,
          hasUploads: !!attachments?.files && attachments.files.length > 0,
          expectedUploadPaths: attachments?.files?.map((a) => a.path),
          voiceRecordings,
          migrateFromV1: migrateFromV1 || false,
          agentId,
          requestId, // Pass pre-generated requestId so stop works during streaming
        },
        // onEvent - delegate to shared stream event handler
        createStreamEventHandler({
          setMessages,
          setButtonStatus,
          eventContextRef: workspaceChatEventContextRef,
          streamingToolsRef,
          rawTextRef: workspaceChatRawTextRef,
          isStoppingRef,
          activeStreamingTasksRef,
        }),
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

              const pollingAbort = new AbortController();
              pollingAbortRef.current = pollingAbort;

              checkConversationStatus(disconnectedConvId, getIdToken)
                .then(async (statusData) => {
                  if (statusData.status === 'running' && statusData.active) {
                    // Agent is still running — poll until it finishes, then reload trace
                    await pollConversationUntilComplete(
                      disconnectedConvId,
                      { intervalMs: 3000, timeoutMs: 3_600_000, signal: pollingAbort.signal },
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
                .catch((err) => {
                  // If polling was intentionally aborted (user clicked Stop or sent
                  // a new message), the UI is already handled — just bail out.
                  if (err?.name === 'AbortError' || pollingAbort.signal.aborted) {
                    return;
                  }
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
                  pollingAbortRef.current = null;
                  // Only reset processing state if polling wasn't intentionally
                  // aborted -- stopStream/streamChat already handled the UI.
                  if (!pollingAbort.signal.aborted) {
                    isProcessingRef.current = false;
                    setButtonStatus('idle');
                  }
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
                saveInlineDocumentToS3(docBlock.docTitle, docBlock.docContent, conversationId, getCredentials).then(
                  () => refreshSessionFiles?.()
                );
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
