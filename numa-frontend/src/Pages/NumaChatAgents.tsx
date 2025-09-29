import { useState, useRef, useEffect, useMemo } from 'react';
import { Button, Container, Row, Col } from 'react-bootstrap';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { fromWebToken } from '@aws-sdk/credential-providers';
import { useAuth } from '../Providers/AuthProvider';
import { preWarmAuroraDatabase } from '../utils/knowledgeBaseUtils';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { ChatHistorySidebar } from '../Components/ChatHistorySidebar';
import { ChatFileUpload } from '../Components/ChatFileUpload';
import { callChatAgentStreaming, connectChatAgent, isChatAgentAvailable } from '../Services/chatAgentService';
import { ChatInput } from '../Components/ChatInput';
import { DocumentPanel } from '../Components/DocumentPanel';
import { ChatMessages } from '../Components/ChatMessages';
import ResizableSplitView from '../Components/ResizableSplitView';
import { generateSystemPrompt, getEnabledTools } from '../utils/chatSystemPromptUtils';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import {
  getModelId,
  MODEL_TYPES,
  isInFallbackMode,
  setFallbackMode,
  isQuotaLimitError,
} from '../utils/bedrockModelConfig';
import { parseChunkWithoutDocComments, extractSingleDocBlock, createDocStripState } from '../utils/streamingProcessors';
import { loadConversation } from '../utils/conversationLoader';
import { processToolEvent } from '../utils/toolEventHandlers';
import { useConversationManager } from '../hooks/useConversationManager';
import { useStreamingHandler } from '../hooks/useStreamingHandler';
import { useDocumentProcessor } from '../hooks/useDocumentProcessor';
import { useCompanyProfile } from '../hooks/useCompanyProfile';
import { autoNameConversation } from '../utils/autoChatTitle';
import { useChatInactivity } from '../hooks/useChatInactivity';

const NumaChatAgents = () => {
  // Basic UI state
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [queryDataSources, setQueryDataSources] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [availableConnections, setAvailableConnections] = useState<
    Array<{ id: string; name: string; isConnected: boolean; mcpServerUrl?: string }>
  >([]);
  const [enabledConnections, setEnabledConnections] = useState<string[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState<boolean>(false);
  const [autoToolsEnabled, setAutoToolsEnabled] = useState(true); // Default to auto mode
  const [buttonStatus, setButtonStatus] = useState('idle');
  const [isFileProcessing, setIsFileProcessing] = useState(false);
  const [lambdaClient, setLambdaClient] = useState<LambdaClient | null>(null);
  const [isManuallyLoading, setIsManuallyLoading] = useState(false);

  // Refs
  const messageEndRef = useRef(null);
  const chatHistoryRef = useRef(null);

  // Custom hooks
  const conversationManager = useConversationManager();
  const streamingHandler = useStreamingHandler();
  const documentProcessor = useDocumentProcessor();
  const { companyProfile } = useCompanyProfile();

  const {
    conversationId,
    setConversationId,
    isConversationLoading,
    setIsConversationLoading,
    createNewConversationIfNeeded,
    handleNewChat,
    resetUserNewChatFlag,
    hasUserStartedNewChat,
  } = conversationManager;
  const {
    inlineDocument,
    showSplitView,
    leftFraction,
    setLeftFraction,
    setShowSplitView,
    openDocument,
    closeDocument,
  } = documentProcessor;
  const { setCurrentAbort, resetStreamingState } = streamingHandler;

  const { user, bedrockAgentRuntimeClient, numaChatDynamoUtils, getAccessToken } = useAuth();

  // Extract user info from token
  const idToken = user?.decoded_tokens?.idToken ?? {};
  const sub = idToken.sub;

  // Memoize constants to prevent unnecessary rerenders
  const REGION = useMemo(() => window.sessionStorage.getItem('REGION'), []);

  // Pipedream integration feature flags - check config instead of Cognito groups
  const hasPipedreamFeature = window.sessionStorage.getItem('PIPEDREAM_INTEGRATIONS') === 'true';
  const relayLambdaArn = window.sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN');

  useEffect(() => {
    if (!user) return;
    if (hasPipedreamFeature && !relayLambdaArn) {
      console.error('Pipedream feature enabled but Lambda ARN not configured');
    }
  }, [user, hasPipedreamFeature, relayLambdaArn]);

  // Initialize AWS Lambda client (cross-account) if feature enabled
  useEffect(() => {
    const init = async () => {
      if (!user) return;
      if (!hasPipedreamFeature) {
        setConnectionsLoading(false);
        setAvailableConnections([]);
        return;
      }
      if (!relayLambdaArn) {
        console.error('Pipedream feature enabled but Lambda ARN not configured');
        setConnectionsLoading(false);
        setAvailableConnections([]);
        return;
      }
      try {
        const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS') || '{}');
        const userGroup = user.decoded_tokens?.idToken?.['cognito:groups']?.[0] || 'standard';
        const roleArn = GROUPS[userGroup]?.roleArn;
        const cognitoUserId = user.decoded_tokens?.idToken?.sub;
        if (!roleArn) {
          console.error('No role ARN found for user group:', userGroup);
          setConnectionsLoading(false);
          setAvailableConnections([]);
          return;
        }
        const credentials = fromWebToken({
          webIdentityToken: user.tokens.idToken,
          roleArn,
          roleSessionName: cognitoUserId,
        });
        const client = new LambdaClient({ region: REGION, credentials });
        setLambdaClient(client);
        console.log('Lambda client initialized successfully for Pipedream relay');
      } catch (e) {
        console.error('Error initializing Lambda client:', e);
        setConnectionsLoading(false);
        setAvailableConnections([]);
      }
    };
    init();
  }, [user, REGION, hasPipedreamFeature, relayLambdaArn]);

  // Load connections via proxy
  const loadConnectionStatus = async () => {
    if (!lambdaClient || !user) return;
    try {
      setConnectionsLoading(true);
      const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
      const response = await PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId);

      // Transform the connection objects to the format expected by the UI
      const allConnections = (response.connections || []).map((conn) => ({
        id: conn.app_name,
        name: conn.app_name,
        isConnected: conn.status === 'connected',
        mcpServerUrl: undefined,
      }));

      // Only show connected integrations as available for selection
      const connected = allConnections.filter((conn) => conn.isConnected);

      setAvailableConnections(connected);
    } catch (e) {
      console.error('Failed to load connection status via proxy:', e);
      setAvailableConnections([]);
    } finally {
      setConnectionsLoading(false);
    }
  };

  useEffect(() => {
    if (lambdaClient) loadConnectionStatus();
  }, [lambdaClient]);

  // Constants
  const PREFERRED_KNOWLEDGE_BASE = window.sessionStorage.getItem('PREFERRED_KNOWLEDGE_BASE') || 'q';
  const BEDROCK_KNOWLEDGE_BASE_ID = window.sessionStorage.getItem('BEDROCK_KNOWLEDGE_BASE_ID');

  // Ref for input textarea
  const inputRef = useRef(null);
  const isProcessingRef = useRef(false);

  // Auto-scroll to bottom on messages or ephemeral changes
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Pre-warm Aurora database when component mounts (only for Bedrock knowledge base)
  useEffect(() => {
    const initializeServices = async () => {
      const warmUpDatabase = async () => {
        if (PREFERRED_KNOWLEDGE_BASE === 'bedrock' && bedrockAgentRuntimeClient && BEDROCK_KNOWLEDGE_BASE_ID) {
          console.log('Pre-warming Aurora database on page load...');
          await preWarmAuroraDatabase(bedrockAgentRuntimeClient, BEDROCK_KNOWLEDGE_BASE_ID);
        }
      };

      // Start WebSocket pre-connection
      const preConnectWebSocket = async () => {
        if (isChatAgentAvailable()) {
          try {
            console.log('Pre-connecting to Chat Agent WebSocket...');
            await connectChatAgent();
            console.log('WebSocket pre-connection successful');
          } catch (error) {
            console.warn('WebSocket pre-connection failed:', error);
          }
        }
      };

      // Run both
      Promise.all([warmUpDatabase(), preConnectWebSocket()]).catch((error) => {
        console.warn('Service initialization error:', error);
      });
    };

    initializeServices();
  }, [PREFERRED_KNOWLEDGE_BASE, bedrockAgentRuntimeClient, BEDROCK_KNOWLEDGE_BASE_ID]);

  // Inactivity: when expired, start a new chat and show suggestions (hook will fetch suggestions)
  async function handleNewChatOnExpired() {
    // Stop any ongoing streaming response
    setButtonStatus('idle');
    resetStreamingState();

    // Clear all UI states
    setMessages([]);
    setUploadedFiles([]);
    setInputMessage('');
    closeDocument();

    // Reset split view state - hide document panel
    setShowSplitView(false);
    setLeftFraction(0.99);

    // Clear manual loading state to prevent conflicts
    setIsManuallyLoading(false);

    // Use the hook's new chat handler
    await handleNewChat();
  }

  // Inactivity: centralized in hook
  const { showContinueSuggestions, recentConversations, resetInactivityTimer, hideSuggestions } = useChatInactivity({
    numaChatDynamoUtils,
    sub,
    buttonStatus,
    isProcessingRef,
    onExpired: handleNewChatOnExpired,
    // Do NOT pass inputMessage: keep suggestions visible while typing; hide on submit instead
  });

  // Auto-load conversation when conversationId is set by useConversationManager
  // But skip auto-load if this conversation was just created in this session, messages already exist, or manual loading is in progress
  useEffect(() => {
    if (
      conversationId &&
      numaChatDynamoUtils &&
      sub &&
      !hasUserStartedNewChat &&
      messages.length === 0 &&
      !isManuallyLoading
    ) {
      console.log('[NumaChat] Auto-loading conversation:', conversationId);
      handleLoadConversation(conversationId);
    } else if (conversationId && hasUserStartedNewChat) {
      console.log('[NumaChat] Skipping auto-load for just-created conversation:', conversationId);
    } else if (conversationId && messages.length > 0) {
      console.log('[NumaChat] Skipping auto-load because messages already exist:', messages.length);
    } else if (conversationId && isManuallyLoading) {
      console.log('[NumaChat] Skipping auto-load because manual loading is in progress:', conversationId);
    }
  }, [conversationId, numaChatDynamoUtils, sub, hasUserStartedNewChat, messages.length, isManuallyLoading]);

  // (Typing hide handled in hook)

  // Helper to refresh sidebar
  const refreshSidebar = () => {
    chatHistoryRef.current?.refreshConversations();
  };

  // Toggle chat history sidebar
  const toggleChatHistory = () => {
    chatHistoryRef.current?.toggleSidebar();
  };

  // (Helper functions moved into hook)

  // New chat handler that clears UI state
  const handleNewChatClick = async () => {
    // Stop any ongoing streaming response
    setButtonStatus('idle');
    resetStreamingState();

    // Clear all UI states
    setMessages([]);
    setUploadedFiles([]);
    setInputMessage('');
    closeDocument();

    // Reset split view state - hide document panel
    setShowSplitView(false);
    setLeftFraction(0.99); // Reset to full chat view

    // Clear manual loading state to prevent conflicts
    setIsManuallyLoading(false);

    // Use the hook's new chat handler
    await handleNewChat();

    // Add an initial greeting from the assistant
    const greeting = { role: 'assistant', content: 'How can I help you today?' };
    setMessages([greeting]);

    // This is a user interaction
    resetInactivityTimer();
    // Hide suggestions when explicitly starting a new chat
    hideSuggestions();
  };

  // Configure model, tools, and system prompt for agent call
  const configureAgentCall = (
    autoToolsEnabled,
    queryDataSources,
    webSearchEnabled,
    idToken,
    companyProfile,
    user,
    sub,
  ) => {
    // Determine which model to use based on fallback status
    const clientName = window.sessionStorage.getItem('CLIENT_NAME');
    const modelType = isInFallbackMode(clientName) ? MODEL_TYPES.FALLBACK : MODEL_TYPES.DEFAULT;
    const modelId = getModelId(REGION, modelType);
    console.log('[NumaChat] Using model:', modelId, 'fallback mode:', isInFallbackMode(clientName));

    // Determine which tools to enable based on auto mode or manual selection
    const enabledTools = getEnabledTools(autoToolsEnabled, queryDataSources, webSearchEnabled);

    // Create the system prompt based on tool availability
    const email = idToken.email || 'Unknown';
    const systemPrompt = generateSystemPrompt(enabledTools, email, companyProfile, enabledConnections);

    // Prepare user authentication context for the Lambda
    const userAuth = {
      idToken: user?.tokens?.idToken || localStorage.getItem('idToken'),
      email: idToken.email,
      sub: sub,
      groups: user?.decoded_tokens?.idToken?.['cognito:groups'] || [],
      region: REGION,
      userPoolId: window.sessionStorage.getItem('USER_POOL_ID'),
      groups_config: JSON.parse(window.sessionStorage.getItem('GROUPS') || '{}'),
    };

    return { modelId, enabledTools, systemPrompt, userAuth, clientName };
  };

  // Handle streaming chunk data
  const createStreamChunkHandler = (streamingHandler, setMessages, setButtonStatus) => {
    let hasStreamingStarted = false;
    let hasReceivedTextChunk = false;
    let accumulatedResponse = '';
    const docStripState = createDocStripState();

    return {
      onChunk: (chunk) => {
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
        streamingHandler.textBufferRef.current += sanitizedChunk;

        // Create a snapshot of the current buffer content for UI updates (race condition protection)
        const bufferSnapshot = streamingHandler.textBufferRef.current;

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
      },
      getStreamingState: () => ({ hasStreamingStarted, hasReceivedTextChunk, accumulatedResponse }),
      getHasStreamingStarted: () => hasStreamingStarted,
      setHasStreamingStarted: (value) => {
        hasStreamingStarted = value;
      },
    };
  };

  // Handle stream completion
  const createStreamCompleteHandler = (
    setCurrentAbort,
    setMessages,
    setButtonStatus,
    isProcessingRef,
    flushPendingText,
    documentProcessor,
    numaChatDynamoUtils,
    refreshSidebar,
    setUploadedFiles,
    setInputMessage,
    inputRef,
  ) => {
    return async (cid, userMsg, sub, chunkHandler) => {
      console.log('[NumaChat] Chat agent completion callback triggered');
      const { hasStreamingStarted, hasReceivedTextChunk, accumulatedResponse } = chunkHandler.getStreamingState();
      console.log(
        '[NumaChat] Final streaming state - hasStreamingStarted:',
        hasStreamingStarted,
        'hasReceivedTextChunk:',
        hasReceivedTextChunk,
      );

      // Clean up abort function reference
      setCurrentAbort(null);

      setButtonStatus('idle');
      isProcessingRef.current = false; // Reset processing flag

      // Flush any remaining text to save the final segment with content preservation
      console.log('[NumaChat] Stream completion - flushing final text buffer');
      flushPendingText(cid, true); // preserveContent=true to prevent race condition

      // Extract doc from raw text
      const docBlock = extractSingleDocBlock(accumulatedResponse);
      if (docBlock) {
        documentProcessor.setInlineDocument({ title: docBlock.docTitle, content: docBlock.docContent });

        // Attach doc to the last assistant message
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            updated[lastIdx].docTitle = docBlock.docTitle;
            updated[lastIdx].docContent = docBlock.docContent;
          }
          return updated;
        });

        // Save document metadata to DynamoDB for history reconstruction
        console.log('[NumaChat] Saving document metadata to DynamoDB');
        console.log('[NumaChat] Document metadata:', {
          docTitle: docBlock.docTitle,
          docContent: docBlock.docContent,
        });
        if (numaChatDynamoUtils && cid && sub) {
          numaChatDynamoUtils
            .addMessage({
              conversationId: cid,
              userId: sub,
              messageType: 'document_metadata',
              role: 'assistant',
              content: JSON.stringify({
                docTitle: docBlock.docTitle,
                docContent: docBlock.docContent,
              }),
            })
            .catch((err) => console.error('Error saving document metadata:', err));
        }
      }

      // Update the conversation meta item (no need to save full response as we're saving segments)
      if (numaChatDynamoUtils) {
        numaChatDynamoUtils
          .updateMetaItem(cid, sub, {
            latestTimestamp: Date.now(),
            latestMessage: userMsg,
          })
          .catch((err) => console.error('Error updating meta item:', err));
      }

      // Attempt auto-naming after first assistant response/meta update
      try {
        if (bedrockRuntimeClient && numaChatDynamoUtils && sub && cid) {
          const renamed = await autoNameConversation({
            conversationId: cid,
            userId: sub,
            bedrockRuntimeClient,
            numaChatDynamoUtils,
            region: REGION,
          });
          if (renamed) {
            // Refresh sidebar to reflect new title
            refreshSidebar();
          }
        }
      } catch (e) {
        console.error('Auto-naming failed:', e);
      }

      // Refresh the sidebar
      refreshSidebar();
      setUploadedFiles([]);
      setInputMessage('');

      // Reset the hasUserStartedNewChat flag after first successful submit
      if (hasUserStartedNewChat) {
        resetUserNewChatFlag();
      }

      setTimeout(() => inputRef.current?.focus(), 0);
    };
  };

  // Submit user input
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent duplicate submissions (React StrictMode protection) - check FIRST
    if (isProcessingRef.current) {
      console.log('[NumaChat] Ignoring duplicate handleSubmit call');
      return;
    }
    isProcessingRef.current = true;

    // Validate input
    if (!inputMessage.trim() && uploadedFiles.length === 0) {
      isProcessingRef.current = false; // Reset flag on early return
      return;
    }

    // This is a user interaction
    resetInactivityTimer();
    // Hide suggestions on first interaction
    hideSuggestions();

    // Prepare UI
    setInputMessage('');
    if (inputRef.current) {
      inputRef.current.style.height = '40px';
    }
    setButtonStatus('loading');

    try {
      /* ────────────────────────────────
         Chat Agent Primary Interface - Stateful Backend Design
         Backend loads conversation history from DynamoDB
      ──────────────────────────────── */

      // Create conversation and store new message locally
      const cid = await createNewConversationIfNeeded(inputMessage);
      const userMsg = inputMessage;

      // Add user message to local UI state
      const userMsgObject = { role: 'user', content: userMsg };
      setMessages((prev) => [...prev, userMsgObject]);

      // Store user message in DynamoDB
      if (numaChatDynamoUtils) {
        await numaChatDynamoUtils
          .addMessage({
            conversationId: cid,
            userId: sub,
            messageType: 'text',
            role: 'user',
            content: userMsg,
          })
          .catch((err) => console.error('Error storing user message:', err));
      }

      console.log('[NumaChat] Sending minimal payload - backend will load conversation history');

      const { modelId, enabledTools, systemPrompt, userAuth, clientName } = configureAgentCall(
        autoToolsEnabled,
        queryDataSources,
        webSearchEnabled,
        idToken,
        companyProfile,
        user,
        sub,
      );

      // Show "thinking…" bubble for streaming response
      const thinkingMessage = { role: 'assistant', segments: [], status: 'thinking' };
      setMessages((prev) => [...prev, thinkingMessage]);

      // Reset streaming helpers for this turn
      resetStreamingState();

      // Create streaming handlers
      const chunkHandler = createStreamChunkHandler(streamingHandler, setMessages, setButtonStatus);
      const completeHandler = createStreamCompleteHandler(
        setCurrentAbort,
        setMessages,
        setButtonStatus,
        isProcessingRef,
        flushPendingText,
        documentProcessor,
        numaChatDynamoUtils,
        refreshSidebar,
        setUploadedFiles,
        setInputMessage,
        inputRef,
      );

      try {
        const abortStream = await callChatAgentStreaming(
          userMsg,
          cid, // Pass conversationId - backend will load history from DynamoDB
          enabledTools, // Pass enabled tools configuration
          systemPrompt, // Pass the enhanced system prompt
          modelId, // Pass the selected model ID
          // onChunk - handle each piece of streaming data
          chunkHandler.onChunk,
          // onComplete - streaming finished
          () => completeHandler(cid, userMsg, sub, chunkHandler),
          // onError - handle streaming errors
          (error) => {
            console.error('Error calling Chat Agent (streaming):', error);

            // Clean up abort function reference
            setCurrentAbort(null);

            isProcessingRef.current = false; // Reset processing flag on error

            // Check for quota/throttling errors and set fallback mode
            if (isQuotaLimitError(error)) {
              console.log('[NumaChat] Quota limit exceeded, setting fallback mode for client:', clientName);
              setFallbackMode(clientName);

              setMessages((prev) => {
                const updated = [...prev];
                const thinkingIndex = updated.findIndex((m) => m.status === 'thinking');
                if (thinkingIndex >= 0) {
                  updated.splice(thinkingIndex, 1);
                }
                return [
                  ...updated,
                  {
                    role: 'system',
                    content: 'Switching to backup model due to high demand. Please try your request again.',
                  },
                ];
              });
            } else {
              // Handle other errors normally
              setMessages((prev) => {
                const updated = [...prev];
                const thinkingIndex = updated.findIndex((m) => m.status === 'thinking');
                if (thinkingIndex >= 0) {
                  updated.splice(thinkingIndex, 1);
                }
                return [...updated, { role: 'system', content: `Agent error: ${error.message || 'Unknown error'}` }];
              });
            }

            setButtonStatus('idle');
            setUploadedFiles([]);
            setInputMessage('');
            setTimeout(() => {
              inputRef.current?.focus();
            }, 0);
          },
          // onEvent – handle raw event frames (e.g., tool usage)
          (eventMsg) => {
            processToolEvent(
              eventMsg,
              {
                processedEventIds: streamingHandler.processedEventIdsRef.current,
                toolUseMap: streamingHandler.toolUseMapRef.current,
                hasStreamingStarted: chunkHandler.getHasStreamingStarted(),
                setHasStreamingStarted: chunkHandler.setHasStreamingStarted,
              },
              {
                setMessages,
                setButtonStatus,
                flushPendingText,
                saveToolCall:
                  numaChatDynamoUtils && cid && sub
                    ? (toolData) => {
                        numaChatDynamoUtils
                          .addToolMessage({
                            conversationId: cid,
                            userId: sub,
                            messageType: 'tool_call',
                            role: 'assistant',
                            ...toolData,
                          })
                          .catch((err) => console.error('Error saving tool call:', err));
                      }
                    : null,
                saveToolResult:
                  numaChatDynamoUtils && cid && sub
                    ? (toolData) => {
                        numaChatDynamoUtils
                          .addToolMessage({
                            conversationId: cid,
                            userId: sub,
                            messageType: 'tool_result',
                            role: 'user',
                            ...toolData,
                          })
                          .catch((err) => console.error('Error saving tool result:', err));
                      }
                    : null,
                conversationId: cid,
              },
            );
          },
          userAuth, // Pass user authentication context
          enabledConnections, // Pass enabled connections
        );

        // Store the abort function for the stop button
        setCurrentAbort(abortStream);
      } catch (agentErr) {
        console.error('Error initiating Chat Agent stream:', agentErr);
        isProcessingRef.current = false; // Reset processing flag on error
        setCurrentAbort(null); // Clear abort reference
        setMessages((prev) => {
          const updated = [...prev];
          const thinkingIndex = updated.findIndex((m) => m.status === 'thinking');
          if (thinkingIndex >= 0) {
            updated.splice(thinkingIndex, 1);
          }
          return [...updated, { role: 'system', content: `Agent error: ${agentErr.message || 'Unknown error'}` }];
        });

        setButtonStatus('idle');
        setUploadedFiles([]);
        setInputMessage('');
        setTimeout(() => {
          inputRef.current?.focus();
        }, 0);
      }
    } catch (err) {
      console.error('Error invoking Chat Agent:', err);
      console.error('Full error details:', JSON.stringify(err, null, 2));
      isProcessingRef.current = false; // Reset processing flag on error
      setCurrentAbort(null); // Clear abort reference
      const errorMsg = {
        role: 'system',
        content: `Error: ${err.message || 'Failed to send message'}. Please try again or refresh page.`,
      };
      setMessages((prev) => [...prev, errorMsg]);
      setButtonStatus('idle');
    }
  };

  // Load single conversation from DB using extracted utility
  const handleLoadConversation = async (selectedConversationId) => {
    if (!numaChatDynamoUtils) return;

    setIsManuallyLoading(true);
    setIsConversationLoading(true);
    setMessages([]); // Clear current messages immediately
    resetUserNewChatFlag(); // Reset the flag since user is explicitly loading a conversation

    // This is a user interaction
    resetInactivityTimer();
    // Hide suggestions when loading a conversation
    hideSuggestions();

    try {
      const chatMessages = await loadConversation(selectedConversationId, numaChatDynamoUtils, sub, getAccessToken);
      setMessages(chatMessages);
      setConversationId(selectedConversationId);
      localStorage.setItem('currentConversationId', selectedConversationId);
    } catch (error) {
      console.error('Error loading conversation:', error);
      // Show error message to user
      setMessages([
        {
          role: 'system',
          content: 'Error loading conversation. Please try again or select a different conversation.',
        },
      ]);
    } finally {
      setIsConversationLoading(false);
      setIsManuallyLoading(false);
    }
  };

  // Derived flag to show warning when no tools active in manual mode
  const noToolsActive = !autoToolsEnabled && !queryDataSources && !webSearchEnabled;

  // Helper: push buffered text as its own segment then clear buffer, and save to DynamoDB
  const flushPendingText = (currentConversationId = null, preserveContent = false) => {
    if (!streamingHandler.textBufferRef.current.trim()) {
      console.log('[NumaChat] No text to flush (buffer empty)');
      return; // Only flush if there's actual content
    }

    const textToSave = streamingHandler.textBufferRef.current;
    console.log(
      '[NumaChat] Flushing pending text (preserveContent=' + preserveContent + ', length=' + textToSave.length + '):',
      textToSave.slice(0, 50) + '...',
    );

    // ALWAYS save to DynamoDB first, regardless of preserve/duplicate logic
    const cidToUse = currentConversationId || conversationId;
    if (numaChatDynamoUtils && cidToUse && sub && textToSave.trim()) {
      numaChatDynamoUtils
        .addMessage({
          conversationId: cidToUse,
          userId: sub,
          messageType: 'text',
          role: 'assistant',
          content: textToSave,
        })
        .catch((err) => console.error('Error saving text segment:', err));
      console.log('[NumaChat] Saved text segment to DynamoDB');
    }

    // Prevent double-flushing UI updates in final completion phase
    if (preserveContent && streamingHandler.finalFlushPerformedRef.current) {
      console.log('[NumaChat] Skipping duplicate final flush UI update (already saved to DB)');
      return;
    }

    if (preserveContent) {
      streamingHandler.finalFlushPerformedRef.current = true;
    }

    // Finalize the current live text segment (mark it as saved and finalized)
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      const lastMsg = { ...updated[lastIdx] };
      const segs = [...(lastMsg.segments || [])];

      // Find and finalize the last text segment if it exists
      if (segs.length && segs[segs.length - 1].kind === 'text' && !segs[segs.length - 1].finalized) {
        // Preserve the final text content when finalizing at stream end
        const finalText = preserveContent ? textToSave : segs[segs.length - 1].text;
        segs[segs.length - 1] = {
          ...segs[segs.length - 1],
          text: finalText,
          finalized: true,
        };
        lastMsg.segments = segs;
        lastMsg.content = finalText; // Update legacy content field too
        updated[lastIdx] = lastMsg;
        console.log('[NumaChat] Finalized text segment with content length:', finalText.length);
      }

      return updated;
    });

    // Clear the text buffer only if not preserving content
    if (!preserveContent) {
      streamingHandler.textBufferRef.current = '';
      console.log('[NumaChat] Cleared text buffer');
    }
  };

  return (
    <div className="dashboard">
      <Nav />
      <header className="mb-1">
        <Container fluid>
          <Row>
            <Col lg={12}>
              <Breadcrumbs label={'Chat'} clearStack={true} />
              <h1 className="mb-0 fs-3">Numa Chat</h1>
            </Col>
          </Row>
        </Container>
      </header>

      {/* Main content */}
      <LayoutDashboard>
        {/* Chat layout */}
        <div className="chat-layout d-flex">
          {/* Chat history sidebar */}
          <ChatHistorySidebar
            ref={chatHistoryRef}
            onSelectConversation={handleLoadConversation}
            currentConversationId={conversationId}
            setError={(error) => console.error('Chat history error:', error)}
          />

          {/* Main chat content */}
          <div className="flex-grow-1 d-flex contain-width">
            <div className="chat-content flex-grow-1 d-flex flex-column">
              {/* Header with chat instructions and buttons on the right */}
              <div className="chat-header d-flex justify-content-between align-items-center mb-3">
                <p className="mb-0 small text-muted">Chat with your documents using Numa.</p>
                <div className="chat-header-buttons d-flex align-items-center gap-2">
                  <Button
                    variant="outline-secondary"
                    className="chat-history-btn"
                    onClick={toggleChatHistory}
                    title="Chat History"
                  >
                    <i className="bi bi-clock-history"></i>
                  </Button>
                  <Button
                    className="btn btn-primary new-chat-btn"
                    onClick={handleNewChatClick}
                    style={{ marginRight: '15px' }}
                  >
                    New Chat
                  </Button>
                </div>
              </div>

              <div className="chat-container position-relative" style={{ flex: '1 1 auto' }}>
                <ResizableSplitView
                  left={
                    /* LEFT PANE: chat messages + input */
                    <div className="chat-left-pane d-flex flex-column h-100">
                      <div className="chat-messages flex-grow-1 overflow-auto">
                        {isConversationLoading ? (
                          <div className="d-flex justify-content-center align-items-center h-100">
                            <div className="text-center">
                              <div className="spinner-border text-primary" role="status">
                                <span className="visually-hidden">Loading...</span>
                              </div>
                              <p className="mt-2 text-muted">Loading conversation...</p>
                            </div>
                          </div>
                        ) : showContinueSuggestions && recentConversations.length > 0 && messages.length === 0 ? (
                          <div className="d-flex flex-column align-items-center justify-content-center h-100">
                            <div style={{ maxWidth: 640, width: '100%' }}>
                              {/* No initial assistant bubble; keep area clean */}
                              {/* During initial new chat flow, show the input directly under the first message */}
                              <div className="d-flex justify-content-center">
                                <div
                                  className="chat-input-wrapper"
                                  style={{ maxWidth: 640, width: '100%', marginBottom: '24px' }}
                                >
                                  <ChatInput
                                    inputMessage={inputMessage}
                                    setInputMessage={setInputMessage}
                                    handleSubmit={handleSubmit}
                                    setShowUploadModal={setShowUploadModal}
                                    buttonStatus={buttonStatus}
                                    queryDataSources={queryDataSources}
                                    setQueryDataSources={setQueryDataSources}
                                    webSearchEnabled={webSearchEnabled}
                                    setWebSearchEnabled={setWebSearchEnabled}
                                    autoToolsEnabled={autoToolsEnabled}
                                    setAutoToolsEnabled={setAutoToolsEnabled}
                                    availableConnections={availableConnections}
                                    enabledConnections={enabledConnections}
                                    setEnabledConnections={setEnabledConnections}
                                    connectionsLoading={connectionsLoading}
                                    hasPipedreamFeature={hasPipedreamFeature}
                                    disabled={isFileProcessing}
                                    noToolsActive={noToolsActive}
                                    externalInputRef={inputRef}
                                    autoFocus={true}
                                    placeholderOverride={'How can I help you today?'}
                                  />
                                </div>
                              </div>
                              <div className="d-flex justify-content-center">
                                <div
                                  className="continue-suggestions p-3 mt-2 mb-2"
                                  style={{ maxWidth: 640, width: '100%' }}
                                >
                                  <div className="text-muted small mb-2">Continue where you left off</div>
                                  <div className="d-flex flex-column gap-2">
                                    {recentConversations.map((convo) => (
                                      <Button
                                        key={convo.conversation_id}
                                        variant="outline-secondary"
                                        size="lg"
                                        className="text-start"
                                        style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem' }}
                                        onClick={() => {
                                          hideSuggestions();
                                          handleLoadConversation(convo.conversation_id);
                                        }}
                                      >
                                        {convo.conversationName || 'Untitled Chat'}
                                      </Button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <ChatMessages
                            messages={messages}
                            messageEndRef={messageEndRef}
                            loadingIndicatorStyle={{}}
                            onOpenDocument={openDocument}
                            isConversationLoading={false}
                          />
                        )}
                      </div>

                      {/* pinned input at bottom (hide during initial new chat flow) */}
                      {!(showContinueSuggestions && recentConversations.length > 0 && messages.length === 0) && (
                        <div className="chat-input-wrapper">
                          <ChatInput
                            inputMessage={inputMessage}
                            setInputMessage={setInputMessage}
                            handleSubmit={handleSubmit}
                            setShowUploadModal={setShowUploadModal}
                            buttonStatus={buttonStatus}
                            queryDataSources={queryDataSources}
                            setQueryDataSources={setQueryDataSources}
                            webSearchEnabled={webSearchEnabled}
                            setWebSearchEnabled={setWebSearchEnabled}
                            autoToolsEnabled={autoToolsEnabled}
                            setAutoToolsEnabled={setAutoToolsEnabled}
                            availableConnections={availableConnections}
                            enabledConnections={enabledConnections}
                            setEnabledConnections={setEnabledConnections}
                            connectionsLoading={connectionsLoading}
                            hasPipedreamFeature={hasPipedreamFeature}
                            disabled={isFileProcessing}
                            noToolsActive={noToolsActive}
                            externalInputRef={inputRef}
                            autoFocus={true}
                          />
                        </div>
                      )}
                    </div>
                  }
                  right={
                    /* RIGHT PANE: document panel */
                    showSplitView && inlineDocument ? (
                      <DocumentPanel documentContent={inlineDocument} onClose={closeDocument} />
                    ) : null
                  }
                  showRight={inlineDocument && showSplitView}
                  leftFraction={leftFraction}
                  onLeftFractionChange={setLeftFraction}
                  minLeft={200}
                  minRight={200}
                />
              </div>
              {/* Tips Messages */}
              <div className="tips-container">
                <p className="datasource-tip text-center small text-muted">
                  Click the <i className="bi bi-database"></i> to chat against your data sources.
                </p>
                <p className="websearch-tip text-center small text-muted">
                  Click the <i className="bi bi-search"></i> to search the web.
                </p>
              </div>
            </div>
          </div>
        </div>
      </LayoutDashboard>

      {/* File upload */}
      <ChatFileUpload
        show={showUploadModal}
        onHide={() => setShowUploadModal(false)}
        getAccessToken={getAccessToken}
        setMessages={setMessages}
        conversationId={conversationId}
        sub={sub}
        refreshSidebar={refreshSidebar}
        setIsFileProcessing={setIsFileProcessing}
        createNewConversationIfNeeded={createNewConversationIfNeeded}
        resetUserNewChatFlag={resetUserNewChatFlag}
      />
    </div>
  );
};

export { NumaChatAgents };
