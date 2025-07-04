import { useState, useRef, useEffect, useMemo } from 'react';
import { Button, Container, Row, Col } from 'react-bootstrap';
import { ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { useAuth } from '../Providers/AuthProvider';
import { queryKnowledgeBase, formatKnowledgeBaseResults, preWarmAuroraDatabase } from '../utils/knowledgeBaseUtils';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { ChatHistorySidebar } from '../Components/ChatHistorySidebar';
import { DataSourcesList } from '../Components/DataSourcesList';
import { ChatFileUpload } from '../Components/ChatFileUpload';
import { prepareConversationHistoryForBedrock, MAX_DYNAMO_MESSAGES } from '../utils/bedrockMessageHistoryUtils';
import { ChatInput } from '../Components/ChatInput';
import { DocumentPanel } from '../Components/DocumentPanel';
import { ChatMessages } from '../Components/ChatMessages';
import ResizableSplitView from '../Components/ResizableSplitView';
import { loadCompanyProfile, enhanceSystemPromptWithCompanyInfo } from '../utils/chatSystemPromptUtils';
import {
  getModelId,
  MODEL_TYPES,
  isInFallbackMode,
  setFallbackMode,
  isQuotaLimitError,
} from '../utils/bedrockModelConfig';

const NumaChat = () => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [conversationId, setConversationId] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [queryDataSources, setQueryDataSources] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [buttonStatus, setButtonStatus] = useState('idle');
  const [isFileProcessing, setIsFileProcessing] = useState(false);
  const [inlineDocument, setInlineDocument] = useState(null);
  const [showSplitView, setShowSplitView] = useState(false);
  const [companyProfile, setCompanyProfile] = useState('');
  const [isCompanyProfileLoaded, setIsCompanyProfileLoaded] = useState(false);
  const [isConversationLoading, setIsConversationLoading] = useState(true);
  const stopGenerationRef = useRef(false);
  const messageEndRef = useRef(null);
  const chatHistoryRef = useRef(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const {
    user,
    qBusinessClient,
    bedrockRuntimeClient,
    bedrockAgentRuntimeClient,
    numaChatDynamoUtils,
    getAccessToken,
    getCredentials,
    createSubscription,
  } = useAuth();

  // Extract user info from token
  const idToken = user?.decoded_tokens?.idToken ?? {};
  const sub = idToken.sub;
  const email = idToken.email;

  // Memoize constants to prevent unnecessary rerenders
  const REGION = useMemo(() => window.sessionStorage.getItem('REGION'), []);
  const CLIENT_NAME = useMemo(() => window.sessionStorage.getItem('CLIENT_NAME'), []);
  const companyBucket = useMemo(() => `numa-${CLIENT_NAME}-company`, [CLIENT_NAME]);

  // Get the appropriate model ID based on fallback status
  const getAppropriateModelId = () => {
    if (isInFallbackMode(CLIENT_NAME)) {
      console.log('Client is in fallback mode, using fallback model');
      return getModelId(REGION, MODEL_TYPES.FALLBACK);
    }
    return getModelId(REGION, MODEL_TYPES.DEFAULT);
  };

  const Q_APPLICATION_ID = window.sessionStorage.getItem('Q_APPLICATION_ID');
  const Q_RETRIEVER_ID = window.sessionStorage.getItem('Q_RETRIEVER_ID');
  const PREFERRED_KNOWLEDGE_BASE = window.sessionStorage.getItem('PREFERRED_KNOWLEDGE_BASE') || 'q';
  const BEDROCK_KNOWLEDGE_BASE_ID = window.sessionStorage.getItem('BEDROCK_KNOWLEDGE_BASE_ID');
  const MAX_DATA_SOURCE_ITEMS = 6;
  const MAX_WEB_SEARCH_RESULTS = 2;
  const TODAY = new Date();
  const SYSTEM_MESSAGE = `You are Numa, an AI assistant created by Arcanum AI who specialises in helping small to medium businesses get their work done and save time on everyday tasks.

**Document Generation:**
For any document, report, email, analysis or anything that may be considered exportable content, wrap it with:
'<!--BEGIN_DOC title="Document Title"-->' and end with '<!--END_DOC-->' (where you infer the title when writing the document)

**Response Guidelines:**
- Use Markdown formatting appropriately
- Ask follow-up questions if requests are ambiguous. If you are unsure of an answer, say so.
- Maintain a professional yet conversational tone
- When provided with knowledge base or web content, use it to answer queries. If the answer isn't in the provided content, state this before using your own knowledge.
- Personalise your responses using user or company context information if available.

User Email: ${email}
Today's Date: ${TODAY}`;

  // Ref for input textarea
  const inputRef = useRef(null);

  /**
   * parseChunkWithoutDocComments(chunk, docStripState)
   * - This function is used to strip comments from the assistant response.
   * - Removes everything from <!-- ... --> while preserving newlines/other text.
   * - Replace the comment with '---' for nicer display of the document.
   * - Returns the stripped text.
   * - If a comment tag is split across chunk boundaries, it uses docStripState.leftover
   *   to handle partial tags in the next chunk.
   */
  function parseChunkWithoutDocComments(chunk, docStripState) {
    // Combine leftover from previous chunk with the current chunk
    let text = docStripState.leftover + chunk;
    let output = '';
    let i = 0;

    while (i < text.length) {
      // Find the start of a comment
      const startIndex = text.indexOf('<!--', i);
      if (startIndex === -1) {
        // No more comments in this chunk
        output += text.slice(i);
        i = text.length;
      } else {
        // Add text before the comment to output
        output += text.slice(i, startIndex);

        // Find the end of the comment
        const closeIndex = text.indexOf('-->', startIndex);
        if (closeIndex === -1) {
          // Comment is incomplete in this chunk, save it for the next chunk
          docStripState.leftover = text.slice(startIndex);
          return output;
        } else {
          // Replace the comment with '---'
          output += '---';
          // Skip past the end of the comment
          i = closeIndex + 3; // jump past -->
        }
      }
    }

    // Clear leftover since all comments are processed
    docStripState.leftover = '';
    return output;
  }

  /**
   * Extract doc info from raw text. If a doc block is found, returns an object:
   * { docTitle, docContent }, else null.
   */
  function extractSingleDocBlock(rawText) {
    const docRegex = /<!--BEGIN_DOC title="(.*?)"-->([\s\S]*?)<!--END_DOC-->/;
    const match = rawText.match(docRegex);
    if (match) {
      return {
        docTitle: match[1],
        docContent: match[2].trim(),
      };
    }
    return null;
  }

  /**
   * Format web search results into a readable string
   * @param {Array} results - Array of search result objects
   * @param {string} query - The original user query
   * @returns {string} Formatted results string
   */
  function formatWebSearchResults(results, query) {
    let formattedResults = `\n\n**Web Search Results:**\n`;
    formattedResults += `Search query: "${query}"\n\n`;

    results.forEach((result, index) => {
      formattedResults += `[${index + 1}] ${result.title}\n`;
      formattedResults += `URL: ${result.url}\n`;
      formattedResults += `${result.snippet}\n\n`;
    });

    formattedResults += `**End of Web Search Results**`;

    return formattedResults;
  }

  // Function to load company profile from S3
  const fetchCompanyProfile = async () => {
    if (!REGION || !companyBucket || !getCredentials) {
      console.log('Missing required parameters for loading company profile');
      setIsCompanyProfileLoaded(true); // Mark as loaded even if failed to prevent repeated attempts
      return;
    }

    try {
      const profileText = await loadCompanyProfile(companyBucket, REGION, getCredentials);
      setCompanyProfile(profileText);
      console.log('Company profile loaded successfully');
    } catch (error) {
      console.error('Error loading company profile:', error);
    } finally {
      setIsCompanyProfileLoaded(true);
    }
  };

  // Auto-scroll to bottom on messages or ephemeral changes
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load company profile when component mounts
  useEffect(() => {
    if (!isCompanyProfileLoaded && REGION && companyBucket) {
      fetchCompanyProfile();
    }
  }, [REGION, companyBucket, isCompanyProfileLoaded]);

  // Track window width
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Attempt to restore last conversation from localStorage
  useEffect(() => {
    async function initializeConversation() {
      if (numaChatDynamoUtils && sub) {
        try {
          // Fetch the conversation meta items for this user
          const metaItems = await numaChatDynamoUtils.getUserConversationsMeta(sub);
          if (metaItems.length === 0) {
            // No conversation exists, so simulate "New Chat"
            console.log('No conversation history found; initializing new conversation...');
            handleNewChat();
          } else {
            // If there is a saved conversation and it exists in the meta, load it.
            const savedConvoId = localStorage.getItem('currentConversationId');
            if (savedConvoId && metaItems.some((item) => item.conversation_id === savedConvoId)) {
              handleLoadConversation(savedConvoId);
            } else {
              // Otherwise, load the most recent conversation (or choose one as needed)
              console.log('Loading the most recent conversation from history.');
              handleLoadConversation(metaItems[0].conversation_id);
            }
          }
        } catch (err) {
          console.error('Error initializing conversation:', err);
        }
      }
    }
    initializeConversation();
  }, [numaChatDynamoUtils, sub]);

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

  // Helper to refresh sidebar
  const refreshSidebar = () => {
    chatHistoryRef.current?.refreshConversations();
  };

  // Create a new conversation
  const handleNewChat = async () => {
    // Stop any ongoing streaming response
    stopGenerationRef.current = true;
    setButtonStatus('idle');
    setIsConversationLoading(false);

    // Clear all states
    setMessages([]);
    setUploadedFiles([]);
    setInputMessage('');
    setConversationId(null);
    setInlineDocument(null);

    // Reset the stop generation flag after a short delay
    setTimeout(() => {
      stopGenerationRef.current = false;
    }, 200);

    // Add an initial greeting from the assistant
    const greeting = { role: 'assistant', content: 'How can I help you today?' };
    setMessages([greeting]);
  };

  // A function that ensures we have a conversation (creates one if needed).
  const createNewConversationIfNeeded = async (initialText = '') => {
    if (conversationId) return conversationId; // Already have one

    const newId = `${sub || 'anonymous'}_${Date.now()}`;
    setConversationId(newId);
    localStorage.setItem('currentConversationId', newId);

    // Create a meta item in Dynamo
    if (numaChatDynamoUtils) {
      const defaultName = initialText.length > 60 ? initialText.slice(0, 57) + '...' : initialText || 'Untitled Chat';
      await numaChatDynamoUtils.addMessage({
        conversationId: newId,
        userId: sub,
        messageType: 'meta',
        role: 'user',
        conversationName: defaultName,
        content: 'New conversation started',
      });

      await numaChatDynamoUtils.addMessage({
        conversationId: newId,
        userId: sub,
        messageType: 'text',
        role: 'assistant',
        content: 'How can I help you today?',
      });
    }

    return newId;
  };

  // Submit user input
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() && uploadedFiles.length === 0) return;
    setInputMessage('');
    if (inputRef.current) {
      inputRef.current.style.height = '40px';
    }
    setButtonStatus('loading');

    try {
      const cid = await createNewConversationIfNeeded(inputMessage);

      // Original user message to store
      const userMsg = inputMessage;
      // Message to display to Claude (may include search results)
      let webSearchEnhancedUserMessage = userMsg;

      // We'll store references from data source queries
      let dsReferences = [];

      // Add user message to local state
      const userMsgObject = { role: 'user', content: userMsg };
      setMessages((prev) => [...prev, userMsgObject]);

      // If web search is enabled, perform search first and enhance user message
      if (webSearchEnabled) {
        // Show searching indicator after user message is rendered
        setTimeout(() => {
          setMessages((prev) => [...prev, { role: 'assistant', content: '', status: 'searching' }]);
        }, 0);

        try {
          const userId = user?.decoded_tokens?.idToken?.sub;
          const API_GATEWAY_URL = window.sessionStorage.getItem('API_ENDPOINT') || '/api';
          const basePath = API_GATEWAY_URL.endsWith('/api') ? API_GATEWAY_URL : `${API_GATEWAY_URL}/api`;
          const client = window.sessionStorage.getItem('CLIENT_NAME');
          const tableName = `numa-${client}-chat-history`;
          const searchUrl = `${basePath}/web-search?query=${encodeURIComponent(userMsg)}&max_results=${MAX_WEB_SEARCH_RESULTS}&conversation_id=${encodeURIComponent(conversationId)}&user_id=${encodeURIComponent(userId)}&table_name=${encodeURIComponent(tableName)}`;
          const searchResponse = await fetch(searchUrl, {
            method: 'GET',
            cache: 'no-cache',
          });

          if (!searchResponse.ok) {
            console.error('Search failed:', searchResponse.status);
            const errorMsg = {
              role: 'system',
              content: `Error: Web search failed (status: ${searchResponse.status}). Please try again or refresh page.`,
            };
            setMessages((prev) => [...prev, errorMsg]);
            return;
          }

          const searchData = await searchResponse.json();
          console.log('Search results:', searchData);

          if (searchData.results && searchData.results.length > 0) {
            // Format search results using the helper function
            const formattedResults = formatWebSearchResults(searchData.results, userMsg);

            // Add URLs to references for display
            searchData.results.forEach((result) => {
              if (result.url) {
                dsReferences.push(result.url);
              }
            });

            // Enhance the user message with search results
            webSearchEnhancedUserMessage = `${userMsg}${formattedResults}`;

            // Log the enhanced message
            console.log('Enhanced user message with search results');
          }
        } catch (error) {
          console.error('Error performing web search:', error);
          const errorMsg = {
            role: 'system',
            content: `Error: Web search failed. Please try again or refresh page. Contact support if the error persists.`,
          };
          setMessages((prev) => [...prev, errorMsg]);
        } finally {
          // Remove searching indicator
          setMessages((prev) => {
            const updated = [...prev];
            const idx = updated.findIndex((msg) => msg.status === 'searching');
            if (idx >= 0) updated.splice(idx, 1);
            return updated;
          });
        }
      }

      // 2) Store original user message in DynamoDB as structured
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

      // 3) Potentially retrieve data from knowledge base if queryDataSources
      stopGenerationRef.current = false;
      if (queryDataSources && qBusinessClient) {
        // Insert ephemeral bubble for 'querying'
        setMessages((prev) => [...prev, { role: 'assistant', content: '', status: 'querying' }]);

        // Configure the unified knowledge base query
        const knowledgeBaseConfig = {
          preferredKnowledgeBase: PREFERRED_KNOWLEDGE_BASE,
          qBusinessClient,
          bedrockAgentClient: bedrockAgentRuntimeClient,
          qApplicationId: Q_APPLICATION_ID,
          qRetrieverId: Q_RETRIEVER_ID,
          bedrockKnowledgeBaseId: BEDROCK_KNOWLEDGE_BASE_ID,
        };
        console.log('Knowledge base configuration:', {
          preferredKnowledgeBase: PREFERRED_KNOWLEDGE_BASE,
          hasQBusinessClient: !!qBusinessClient,
          hasBedrockAgentClient: !!bedrockAgentRuntimeClient,
          qApplicationId: Q_APPLICATION_ID,
          qRetrieverId: Q_RETRIEVER_ID,
          bedrockKnowledgeBaseId: BEDROCK_KNOWLEDGE_BASE_ID,
        });

        try {
          // Use the unified knowledge base query function
          const knowledgeResult = await queryKnowledgeBase(knowledgeBaseConfig, inputMessage, MAX_DATA_SOURCE_ITEMS);

          console.log('Unified knowledge base response:', knowledgeResult);

          // Format the results for display
          const finalInputText = formatKnowledgeBaseResults(knowledgeResult);

          // Store references from the result
          dsReferences = knowledgeResult.references || [];

          // Also store a 'knowledge' message
          if (numaChatDynamoUtils) {
            await numaChatDynamoUtils
              .addMessage({
                conversationId: cid,
                userId: sub,
                messageType: 'knowledge',
                role: 'assistant',
                content: finalInputText,
                metadata: knowledgeResult.metadata,
              })
              .catch((err) => console.error('Error storing knowledge message:', err));
          }
        } catch (err) {
          console.error('Error querying knowledge base:', err);
          const errorMessage = 'Error querying knowledge base. Please try again later.';

          // Store error message
          if (numaChatDynamoUtils) {
            await numaChatDynamoUtils
              .addMessage({
                conversationId: cid,
                userId: sub,
                messageType: 'knowledge',
                role: 'assistant',
                content: errorMessage,
                metadata: { error: err.message, preferredKnowledgeBase: PREFERRED_KNOWLEDGE_BASE },
              })
              .catch((err) => console.error('Error storing error message:', err));
          }

          if (err.message == 'aws:PrincipalTag/Email tag is missing from the ID token claims') {
            try {
              const createSubscriptionResponse = await createSubscription();
              console.log('Create subscription response', createSubscriptionResponse);
            } catch (e) {
              console.log('Failed to create subscription', e);
              return;
            }

            // Try again
            const knowledgeResult = await queryKnowledgeBase(knowledgeBaseConfig, inputMessage, MAX_DATA_SOURCE_ITEMS);
            console.log('Unified knowledge base response after subscription:', knowledgeResult);
          }
        }

        // Remove ephemeral 'querying' bubble
        setMessages((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex((msg) => msg.status === 'querying');
          if (idx >= 0) updated.splice(idx, 1);
          return updated;
        });
      }

      // Insert ephemeral bubble for 'thinking'
      setMessages((prev) => [...prev, { role: 'assistant', content: '', status: 'thinking' }]);

      // Wait for the UI to update
      await new Promise((resolve) => setTimeout(resolve, 0));

      // 4) Retrieve conversation history
      const conversationHistory = await numaChatDynamoUtils.queryConversations(cid, MAX_DYNAMO_MESSAGES, sub);

      // Modify the last user message in the history (which is our message) to include search results if available
      if (webSearchEnabled && webSearchEnhancedUserMessage !== userMsg) {
        // Find and replace the last user message with the enhanced version
        for (let i = conversationHistory.length - 1; i >= 0; i--) {
          if (conversationHistory[i].role === 'user' && conversationHistory[i].content === userMsg) {
            console.log('Replacing user message with enhanced version containing search results');
            conversationHistory[i].content = webSearchEnhancedUserMessage;
            break;
          }
        }
      }

      const bedrockMessages = await prepareConversationHistoryForBedrock(conversationHistory, getCredentials);

      // Validate message format
      const validatedMessages = bedrockMessages.map((msg) => {
        if (!Array.isArray(msg.content)) {
          return {
            ...msg,
            content: [{ type: 'text', text: msg.content }],
          };
        }
        return msg;
      });

      const validateMessage = (message) => {
        if (!message.role || !Array.isArray(message.content) || message.content.length === 0) {
          console.error('Invalid message format:', message);
          return false;
        }
        return true;
      };
      if (!validatedMessages.every(validateMessage)) {
        throw new Error('Invalid message format detected');
      }

      // 5) Send to Bedrock
      const currentModelId = getAppropriateModelId();

      const converseInput = {
        modelId: currentModelId,
        messages: validatedMessages,
        system: [
          {
            text: isCompanyProfileLoaded
              ? enhanceSystemPromptWithCompanyInfo(SYSTEM_MESSAGE, companyProfile)
              : SYSTEM_MESSAGE,
          },
        ],
        inferenceConfig: { maxTokens: 4000, temperature: 0.1 },
      };

      if (webSearchEnabled) {
        console.log('Web search results injected directly into prompt, not using Claude tools');
      }
      console.log('Converse Input:', JSON.stringify(converseInput, null, 2));
      console.log('System Message:', converseInput.system[0].text);

      const converseCommand = new ConverseStreamCommand(converseInput);
      let response;
      let retryCount = 0;
      const MAX_RETRIES = 3;
      const RETRY_DELAY = 1000; // 1 second

      while (retryCount < MAX_RETRIES) {
        try {
          response = await bedrockRuntimeClient.send(converseCommand);
          break;
        } catch (err) {
          console.log('Bedrock error:', err);

          // Check for quota/throttling errors
          if (isQuotaLimitError(err)) {
            console.log(`Quota limit exceeded for model ${converseInput.modelId}, switching to fallback model`);

            // Set fallback mode for this client (1 hour by default)
            setFallbackMode(CLIENT_NAME);

            // Switch to fallback model
            converseInput.modelId = getModelId(REGION, MODEL_TYPES.FALLBACK);
            console.log(`Retrying with fallback model ${converseInput.modelId}`);

            // Create new command with updated model
            const newCommand = new ConverseStreamCommand(converseInput);

            try {
              // Try with fallback model directly
              response = await bedrockRuntimeClient.send(newCommand);
              break;
            } catch (fallbackErr) {
              console.error('Error with fallback model:', fallbackErr);
              // If fallback also fails, throw the original error
              throw err;
            }
          }

          if (err.name === 'TypeError' && retryCount < MAX_RETRIES - 1) {
            console.log(`Retry attempt ${retryCount + 1} after error:`, err);
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
            retryCount++;
            continue;
          }
          throw err;
        }
      }

      // 6) Accumulate the raw text and a "display text" that strips comment tags
      // This let's us retrieve doc references and display the message without tags
      // e.g. <!--BEGIN_DOC title="Some Title"-->...<!--END_DOC-->
      let rawAssistantText = '';
      let displayAssistantText = '';
      let firstChunk = true;
      const docStripState = { leftover: '' };
      let tokenUsage = null;

      for await (const event of response.stream) {
        if (stopGenerationRef.current) {
          console.log('Generation stopped by user.');

          setMessages((prev) => {
            const updated = [...prev];
            const lastMsgIndex = updated.length - 1;
            if (lastMsgIndex >= 0 && updated[lastMsgIndex].role === 'assistant') {
              updated[lastMsgIndex].interrupted = true;
            }
            return updated;
          });

          // Save message to DynamoDB immediately
          if (numaChatDynamoUtils) {
            try {
              const interruptedMessagePayload = {
                conversationId: cid,
                userId: sub,
                messageType: 'text',
                role: 'assistant',
                content: rawAssistantText,
                interrupted: true,
                references: dsReferences.length > 0 ? dsReferences : undefined,
              };

              numaChatDynamoUtils
                .addMessage(interruptedMessagePayload)
                .catch((err) => console.error('Error storing interrupted message:', err));

              numaChatDynamoUtils
                .updateMetaItem(cid, sub, {
                  latestTimestamp: Date.now(),
                  latestMessage: inputMessage,
                })
                .catch((err) => console.error('Error updating meta item:', err));

              console.log('Interrupted message saved to database');
            } catch (err) {
              console.error('Failed to save interrupted message:', err);
            }
          }

          break;
        }

        // Look for token usage metadata
        if (event.metadata?.usage) {
          tokenUsage = event.metadata.usage;
        }

        if (firstChunk) {
          // Remove 'thinking', set 'streaming' status
          setMessages((prev) => {
            const updated = [...prev];
            const idx = updated.findIndex((m) => m.status === 'thinking');
            if (idx >= 0) updated[idx].status = null;
            return updated;
          });
          setButtonStatus('streaming');
          firstChunk = false;
        }

        const chunk = event.contentBlockDelta?.delta?.text || '';
        if (!chunk) continue;

        // Keep raw text with doc tags
        rawAssistantText += chunk;
        // Remove doc comment tags from chunk
        // e.g. <!--BEGIN_DOC title="Some Title"-->...<!--END_DOC-->
        const sanitized = parseChunkWithoutDocComments(chunk, docStripState);

        // Update the display text with sanitized content (no doc tags)
        if (sanitized) {
          displayAssistantText += sanitized;
          // Update the last assistant message
          setMessages((prev) => {
            const updated = [...prev];
            if (updated.length > 0) {
              updated[updated.length - 1].content = displayAssistantText;
            }
            return updated;
          });
        }
      }
      // Log the raw assistant text
      console.log('Bedrock Response:', rawAssistantText);

      // Log token usage
      if (tokenUsage) {
        console.log('Token Usage:', tokenUsage);
      }

      // Remove 'streaming' status
      setButtonStatus('idle');

      // 7) Store the final assistant response WITH references in Dynamo
      const assistantMessagePayload = {
        conversationId: cid,
        userId: sub,
        messageType: 'text',
        role: 'assistant',
        content: rawAssistantText,
      };

      // 8) If we have references, attach them before storing in Dynamo
      if (dsReferences.length > 0) {
        assistantMessagePayload.references = dsReferences;
      }

      if (numaChatDynamoUtils && !stopGenerationRef.current) {
        // Asynchronous store
        numaChatDynamoUtils
          .addMessage(assistantMessagePayload)
          .catch((err) => console.error('Error storing assistant message:', err));

        // Update the conversation meta item
        numaChatDynamoUtils
          .updateMetaItem(cid, sub, {
            latestTimestamp: Date.now(),
            latestMessage: inputMessage,
          })
          .catch((err) => console.error('Error updating meta item:', err));
      }

      // After streaming, attach references to local state for immediate display
      if (dsReferences.length > 0) {
        setMessages((prev) => {
          const updated = [...prev];
          const lastMsgIndex = updated.length - 1;
          if (lastMsgIndex >= 0 && updated[lastMsgIndex].role === 'assistant') {
            updated[lastMsgIndex].references = dsReferences;
          }
          return updated;
        });
      }

      // 9) Extract doc from raw text
      const docBlock = extractSingleDocBlock(rawAssistantText);
      if (docBlock) {
        // Always update the inlineDocument so it displays the latest generated doc if opened
        setInlineDocument({ title: docBlock.docTitle, content: docBlock.docContent });

        // attach doc to the last assistant message
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            updated[lastIdx].docTitle = docBlock.docTitle;
            updated[lastIdx].docContent = docBlock.docContent;
          }
          return updated;
        });
      }

      // Refresh the sidebar
      refreshSidebar();
      setButtonStatus('idle');

      // Clear user input
      setUploadedFiles([]);
      setInputMessage('');
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    } catch (err) {
      console.error('Error invoking Bedrock:', err);
      console.error('Full error details:', JSON.stringify(err, null, 2));

      // Check for quota errors in the main catch block
      if (isQuotaLimitError(err)) {
        setFallbackMode(CLIENT_NAME);

        const errorMsg = {
          role: 'system',
          content: `There was a temporary issue. Please try again in one minute.`,
        };
        setMessages((prev) => [...prev, errorMsg]);
      } else {
        const errorMsg = {
          role: 'system',
          content: `Error: ${err.message || 'Failed to send message'}. Please try again or refresh page.`,
        };
        setMessages((prev) => [...prev, errorMsg]);
      }

      setButtonStatus('idle');
    }
  };

  // Load single conversation from DB
  const handleLoadConversation = async (selectedConversationId) => {
    if (!numaChatDynamoUtils) return;

    setIsConversationLoading(true);
    setMessages([]); // Clear current messages immediately

    try {
      let retryCount = 0;
      let conversationHistory = [];
      while (retryCount < 2) {
        try {
          conversationHistory = await numaChatDynamoUtils.queryConversations(
            selectedConversationId,
            MAX_DYNAMO_MESSAGES,
            sub,
          );
          break;
        } catch (error) {
          if (error.message.includes('ExpiredTokenException') && retryCount === 0) {
            await getAccessToken(true);
            retryCount++;
          } else {
            throw error;
          }
        }
      }

      // Sort by timestamp
      conversationHistory.sort((a, b) => a.timestamp - b.timestamp);

      // Convert to chat messages (now we also attach .references if present)
      const chatMessages = conversationHistory.map((item) => {
        const baseMsg = {
          role: item.role,
          content: item.content || '',
          references: item.references || [],
          interrupted: item.interrupted || false,
        };

        // Replace doc tags when loading conversation history
        if (baseMsg.content) {
          baseMsg.content = baseMsg.content.replace(/<!--[\s\S]*?-->/g, '---');
        }
        // If there's a doc block, parse it
        const docBlock = extractSingleDocBlock(item.content || '');
        if (docBlock && baseMsg.role === 'assistant') {
          baseMsg.docTitle = docBlock.docTitle;
          baseMsg.docContent = docBlock.docContent;
        }

        if (item.message_type === 'file') {
          baseMsg.content = `File '${item.fileInfo.fileName}' uploaded and processed successfully.`;
          baseMsg.role = 'assistant';
        } else if (item.message_type === 'image_description') {
          baseMsg.content = `File '${item.fileInfo.fileName}' uploaded and processed successfully.`;
          baseMsg.role = 'assistant';
        } else if (item.message_type === 'knowledge') {
          baseMsg.content = `Retrieving data source knowledge...`;
          baseMsg.role = 'assistant';
        } else if (item.message_type === 'meta') {
          // system-level info
          baseMsg.role = 'system';
        }
        return baseMsg;
      });

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

  // Handler for the Stop button during streaming
  const handleStopGeneration = () => {
    stopGenerationRef.current = true;
  };

  // Add a CSS class for the loading indicator
  const loadingIndicatorStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    height: '24px', // Set a fixed height to prevent layout shifts
  };

  // Split view state
  const [leftFraction, setLeftFraction] = useState(0.99);
  function handleDocClose() {
    setShowSplitView(false); // Hide the document panel
    setLeftFraction(0.99); // Reset the split view to fully collapsed
    setInlineDocument(null); // Clear the document content
  }

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
              {/* Header with chat instructions and New Chat button on the right */}
              <div className="chat-header d-flex justify-content-between align-items-center mb-3">
                <p className="mb-0 small text-muted">Chat with your documents using Numa.</p>
                <Button
                  className="btn btn-primary new-chat-btn"
                  onClick={handleNewChat}
                  style={{ marginRight: '15px' }}
                >
                  New Chat
                </Button>
              </div>

              <div className="chat-container position-relative" style={{ flex: '1 1 auto' }}>
                <ResizableSplitView
                  left={
                    /* LEFT PANE: chat messages + input */
                    <div className="chat-left-pane d-flex flex-column h-100">
                      <div className="chat-messages flex-grow-1 overflow-auto" style={{ overflowY: 'auto' }}>
                        <ChatMessages
                          messages={messages}
                          messageEndRef={messageEndRef}
                          loadingIndicatorStyle={loadingIndicatorStyle}
                          onOpenDocument={(docTitle, docContent) => {
                            setLeftFraction(0.45);
                            setInlineDocument({ title: docTitle, content: docContent });
                            setShowSplitView(true);
                          }}
                          isConversationLoading={isConversationLoading}
                        />
                      </div>

                      {/* pinned input at bottom */}
                      <div style={{ flexShrink: 0, padding: '0.5rem' }}>
                        <ChatInput
                          inputMessage={inputMessage}
                          setInputMessage={setInputMessage}
                          handleSubmit={handleSubmit}
                          setShowUploadModal={setShowUploadModal}
                          buttonStatus={buttonStatus}
                          handleStopGeneration={handleStopGeneration}
                          isMobile={isMobile}
                          queryDataSources={queryDataSources}
                          setQueryDataSources={setQueryDataSources}
                          webSearchEnabled={webSearchEnabled}
                          setWebSearchEnabled={setWebSearchEnabled}
                          disabled={isFileProcessing}
                        />
                      </div>
                    </div>
                  }
                  right={
                    /* RIGHT PANE: document panel */
                    showSplitView && inlineDocument ? (
                      <DocumentPanel documentContent={inlineDocument} onClose={handleDocClose} />
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

export { NumaChat };
