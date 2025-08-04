import { useState, useRef, useEffect, useMemo } from 'react';
import { Button, Container, Row, Col } from 'react-bootstrap';
import { useAuth } from '../Providers/AuthProvider';
import { preWarmAuroraDatabase } from '../utils/knowledgeBaseUtils';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { ChatHistorySidebar } from '../Components/ChatHistorySidebar';
import { DataSourcesList } from '../Components/DataSourcesList';
import { ChatFileUpload } from '../Components/ChatFileUpload';
import { MAX_DYNAMO_MESSAGES, prepareConversationHistoryForChat } from '../utils/bedrockMessageHistoryUtils';
import { callChatAgentStreaming } from '../Services/chatAgentService';
import { ChatInput } from '../Components/ChatInput';
import { DocumentPanel } from '../Components/DocumentPanel';
import { ChatMessages } from '../Components/ChatMessages';
import ResizableSplitView from '../Components/ResizableSplitView';
import { generateSystemPrompt, getEnabledTools } from '../utils/chatSystemPromptUtils';
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

const NumaChatAgents = () => {
  // Basic UI state
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [queryDataSources, setQueryDataSources] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [autoToolsEnabled, setAutoToolsEnabled] = useState(true); // Default to auto mode
  const [buttonStatus, setButtonStatus] = useState('idle');
  const [isFileProcessing, setIsFileProcessing] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

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
  const { handleStopGeneration, setCurrentAbort, resetStreamingState } = streamingHandler;

  const { user, bedrockAgentRuntimeClient, numaChatDynamoUtils, getCredentials, getAccessToken } = useAuth();

  // Extract user info from token
  const idToken = user?.decoded_tokens?.idToken ?? {};
  const sub = idToken.sub;

  // Memoize constants to prevent unnecessary rerenders
  const REGION = useMemo(() => window.sessionStorage.getItem('REGION'), []);

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

  // Track window width
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Pre-warm Aurora database when component mounts (only for Bedrock knowledge base)
  useEffect(() => {
    const warmUpDatabase = async () => {
      if (PREFERRED_KNOWLEDGE_BASE === 'bedrock' && bedrockAgentRuntimeClient && BEDROCK_KNOWLEDGE_BASE_ID) {
        console.log('Pre-warming Aurora database on page load...');
        await preWarmAuroraDatabase(bedrockAgentRuntimeClient, BEDROCK_KNOWLEDGE_BASE_ID);
      }
    };

    warmUpDatabase();
  }, [PREFERRED_KNOWLEDGE_BASE, bedrockAgentRuntimeClient, BEDROCK_KNOWLEDGE_BASE_ID]);

  // Auto-load conversation when conversationId is set by useConversationManager
  // But skip auto-load if this conversation was just created in this session or if messages already exist
  useEffect(() => {
    if (conversationId && numaChatDynamoUtils && sub && !hasUserStartedNewChat && messages.length === 0) {
      console.log('[NumaChat] Auto-loading conversation:', conversationId);
      handleLoadConversation(conversationId);
    } else if (conversationId && hasUserStartedNewChat) {
      console.log('[NumaChat] Skipping auto-load for just-created conversation:', conversationId);
    } else if (conversationId && messages.length > 0) {
      console.log('[NumaChat] Skipping auto-load because messages already exist:', messages.length);
    }
  }, [conversationId, numaChatDynamoUtils, sub, hasUserStartedNewChat, messages.length]);

  // Helper to refresh sidebar
  const refreshSidebar = () => {
    chatHistoryRef.current?.refreshConversations();
  };

  // Toggle chat history sidebar
  const toggleChatHistory = () => {
    chatHistoryRef.current?.toggleSidebar();
  };

  // New chat handler that clears UI state
  const handleNewChatClick = async () => {
    // Stop any ongoing streaming response
    streamingHandler.stopGenerationRef.current = true;
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

    // Use the hook's new chat handler
    await handleNewChat();

    // Add an initial greeting from the assistant
    const greeting = { role: 'assistant', content: 'How can I help you today?' };
    setMessages([greeting]);
  };

  // Prepare conversation context and add user message
  const prepareConversationContext = async (
    inputMessage,
    createNewConversationIfNeeded,
    setMessages,
    numaChatDynamoUtils,
    sub,
  ) => {
    const cid = await createNewConversationIfNeeded(inputMessage);

    // Original user message to store
    const userMsg = inputMessage;

    // Add user message to local state
    const userMsgObject = { role: 'user', content: userMsg };
    setMessages((prev) => [...prev, userMsgObject]);

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

    // Retrieve conversation history for the agent
    const conversationHistory = await numaChatDynamoUtils.queryConversations(cid, MAX_DYNAMO_MESSAGES, sub);

    // Prepare conversation history using the proper formatting (handles tools correctly)
    const agentMessages = await prepareConversationHistoryForChat(conversationHistory, getCredentials);

    // Add the current user message to agent messages
    agentMessages.push({
      role: 'user',
      content: [{ text: userMsg }],
    });

    return { cid, userMsg, agentMessages };
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
    const systemPrompt = generateSystemPrompt(enabledTools, email, companyProfile);

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
        // Check if stream was stopped by user
        if (streamingHandler.stopGenerationRef.current) {
          console.log('[NumaChat] Stream stopped by user in onChunk');
          return;
        }
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
    streamingHandler,
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
    return (cid, userMsg, sub, chunkHandler) => {
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

      // Check if this was a user-initiated stop
      const wasInterrupted = streamingHandler.stopGenerationRef.current;
      if (wasInterrupted) {
        console.log('[NumaChat] Stream was interrupted by user');
        // Mark the last message as interrupted
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            updated[lastIdx].interrupted = true;
          }
          return updated;
        });
      }

      setButtonStatus('idle');
      isProcessingRef.current = false; // Reset processing flag
      streamingHandler.stopGenerationRef.current = false; // Reset stop flag

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

    // Prepare UI
    setInputMessage('');
    if (inputRef.current) {
      inputRef.current.style.height = '40px';
    }
    setButtonStatus('loading');

    try {
      /* ────────────────────────────────
         Chat Agent Primary Interface
         Using chat agent as the main and only chat interface
      ──────────────────────────────── */

      const { cid, userMsg, agentMessages } = await prepareConversationContext(
        inputMessage,
        createNewConversationIfNeeded,
        setMessages,
        numaChatDynamoUtils,
        sub,
      );

      // Log the history being sent to the agent
      console.log('[NumaChat] Calling Chat agent with messages:', JSON.stringify(agentMessages, null, 2));

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
        streamingHandler,
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
          agentMessages, // Pass conversation history to the agent
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

            // Check if this was a user-initiated stop (which might trigger an "error")
            const wasInterrupted = streamingHandler.stopGenerationRef.current;
            if (wasInterrupted) {
              console.log('[NumaChat] Stream was stopped by user (via error callback)');
              // Don't show error message for user-initiated stops
              setButtonStatus('idle');
              isProcessingRef.current = false;
              streamingHandler.stopGenerationRef.current = false;
              return;
            }

            isProcessingRef.current = false; // Reset processing flag on error
            streamingHandler.stopGenerationRef.current = false; // Reset stop flag

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
                stopGenerationRef: streamingHandler.stopGenerationRef,
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
        );

        // Store the abort function for the stop button
        setCurrentAbort(abortStream);
      } catch (agentErr) {
        console.error('Error initiating Chat Agent stream:', agentErr);
        isProcessingRef.current = false; // Reset processing flag on error
        streamingHandler.stopGenerationRef.current = false; // Reset stop flag
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
      streamingHandler.stopGenerationRef.current = false; // Reset stop flag
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

    setIsConversationLoading(true);
    setMessages([]); // Clear current messages immediately
    resetUserNewChatFlag(); // Reset the flag since user is explicitly loading a conversation

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

  // Enhanced stop generation handler that clears tool states
  const handleStopGenerationClick = () => {
    handleStopGeneration();

    // Clear any loading tool states
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
        const lastMsg = { ...updated[lastIdx] };
        const segs = [...(lastMsg.segments || [])];

        // Set all tool segments to not loading
        const updatedSegs = segs.map((seg) => (seg.kind === 'tool' ? { ...seg, isLoading: false } : seg));

        lastMsg.segments = updatedSegs;
        lastMsg.interrupted = true;
        updated[lastIdx] = lastMsg;
      }
      return updated;
    });

    // Update UI state
    setButtonStatus('idle');
    isProcessingRef.current = false;
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
      <LayoutDashboard className="flex-grow-1">
        {/* Chat layout */}
        <div className="chat-layout d-flex">
          {/* Chat history sidebar */}
          <ChatHistorySidebar
            ref={chatHistoryRef}
            onSelectConversation={handleLoadConversation}
            currentConversationId={conversationId}
          />
          {/* Data sources list */}
          <DataSourcesList />

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
                        ) : (
                          <ChatMessages
                            messages={messages}
                            messageEndRef={messageEndRef}
                            onOpenDocument={openDocument}
                          />
                        )}
                      </div>

                      {/* pinned input at bottom */}
                      <div className="chat-input-wrapper">
                        <ChatInput
                          inputMessage={inputMessage}
                          setInputMessage={setInputMessage}
                          handleSubmit={handleSubmit}
                          setShowUploadModal={setShowUploadModal}
                          buttonStatus={buttonStatus}
                          handleStopGeneration={handleStopGenerationClick}
                          isMobile={isMobile}
                          queryDataSources={queryDataSources}
                          setQueryDataSources={setQueryDataSources}
                          webSearchEnabled={webSearchEnabled}
                          setWebSearchEnabled={setWebSearchEnabled}
                          autoToolsEnabled={autoToolsEnabled}
                          setAutoToolsEnabled={setAutoToolsEnabled}
                          disabled={isFileProcessing}
                          noToolsActive={noToolsActive}
                        />
                      </div>
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
      />
    </div>
  );
};

export { NumaChatAgents };
