import { useState, useRef, useEffect } from 'react';
import { Button, Container, Row, Col } from 'react-bootstrap';
import { ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { SearchRelevantContentCommand } from '@aws-sdk/client-qbusiness';
import { useAuth } from '../Providers/AuthProvider';
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

  const stopGenerationRef = useRef(false);
  const messageEndRef = useRef(null);
  const {
    user,
    qBusinessClient,
    bedrockRuntimeClient,
    numaChatDynamoUtils,
    getAccessToken,
    getIdentityPoolCredentials,
  } = useAuth();
  const chatHistoryRef = useRef(null);

  // For responsiveness
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // Extract user info from token
  const idToken = user?.decoded_tokens?.idToken ?? {};
  const sub = idToken.sub;
  const email = idToken.email;

  // Constants
  const MODEL_ID = 'anthropic.claude-3-5-sonnet-20240620-v1:0';
  const Q_APPLICATION_ID = window.sessionStorage.getItem('Q_APPLICATION_ID');
  const Q_RETRIEVER_ID = window.sessionStorage.getItem('Q_RETRIEVER_ID');
  const MAX_DATA_SOURCE_ITEMS = 6;
  const MAX_WEB_SEARCH_RESULTS = 5;
  const TODAY = new Date();
  const SYSTEM_MESSAGE = `You are an artificial intelligence called Numa created by Arcanum AI, a helpful AI assistant who can answer user queries and help with everyday tasks. You may be asked general question, be asked questions about a file, or be given data source content to help answer questions. **General Instructions**\n- If provided with data source content from the users data sources, please use it to help answer the user question.\n- If you cannot find the answer in the data source content, please explicitly state so before using your knowledge to answer the question the best you can. If you can answer the users question using the data source(s), Let them know where you found the answer to the question.\n-Formatting: Always respond using valid Markdown syntax, using styling emphasises and headings appropriately. Incorporate other bold and italic styling within your outputs when appropriate to emphasise certain details.\n- When generating artefacts like documents, email, etc, please never use markdown blocks like '''markdown etc, but instead return as usual with markdown formatting.\n- Similarly, For any document, report, email, analysis, or other exportable content you generate that a user may want to download or copy (except code), please start it with the following '<!--BEGIN_DOC title="SOME TITLE HERE"-->' (where you infer the title when writing the document), and end it with '<!--END_DOC-->'. This will help me identify documents in post processing using regex looking for the opening '<--' and closing '-->'\n- If the users request is ambiguous or lacks details, ask follow-up questions to gather more information before answering.\n- Maintain a Friendly and Professional Tone: Ensure your responses are clear, respectful, and professional while still being conversational.\n- Request Additional Information: If necessary, prompt the user with questions like "Could you provide more details?" or "What specific aspect would you like to focus on?"\n- Be Context Aware: Leverage any provided context (like user details or previous conversation history) to tailor your response appropriately.\n\nHere is some information about the user that you can use to personalise your response:\n\nUser Email: ${email}\nToday's Date: ${TODAY}`;

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
  // Ref for input textarea
  const inputRef = useRef(null);

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

  // Helper to refresh sidebar
  const refreshSidebar = () => {
    chatHistoryRef.current?.refreshConversations();
  };

  // Create a new conversation
  const handleNewChat = async () => {
    setMessages([]);
    setUploadedFiles([]);
    setInputMessage('');
    setConversationId(null);
    setInlineDocument(null);

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

      // If web search is enabled, perform search first and enhance user message
      if (webSearchEnabled) {
        // Show searching indicator
        setMessages((prev) => [...prev, { role: 'assistant', content: '', status: 'searching' }]);

        try {
          // Get recent conversation context
          const recentMessages = messages.slice(-6); // Get last 6 messages
          const contextString = recentMessages.map((msg) => `${msg.role}: ${msg.content}`).join('\n');

          // Call web search Lambda with context
          const API_GATEWAY_URL = window.sessionStorage.getItem('API_ENDPOINT') || '/api';
          const basePath = API_GATEWAY_URL.endsWith('/api') ? API_GATEWAY_URL : `${API_GATEWAY_URL}/api`;
          const searchUrl = `${basePath}/web-search?query=${encodeURIComponent(userMsg)}&max_results=${MAX_WEB_SEARCH_RESULTS}&context=${encodeURIComponent(contextString)}`;

          console.log('Automatically searching for:', userMsg, 'with context');
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

            // Store search results in DynamoDB for reference
            if (numaChatDynamoUtils) {
              await numaChatDynamoUtils
                .addMessage({
                  conversationId: cid,
                  userId: sub,
                  messageType: 'knowledge',
                  role: 'assistant',
                  content: formattedResults,
                })
                .catch((err) => console.error('Error storing web search knowledge:', err));
            }
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

      // 1) Add user message to local state (original message, not enhanced)
      const userMsgObject = { role: 'user', content: userMsg };
      setMessages((prev) => [...prev, userMsgObject]);

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

      // 3) Potentially retrieve data from Q if queryDataSources is on
      stopGenerationRef.current = false;
      if (queryDataSources && qBusinessClient) {
        // Insert ephemeral bubble for 'querying'
        setMessages((prev) => [...prev, { role: 'assistant', content: '', status: 'querying' }]);

        const dsInput = {
          applicationId: Q_APPLICATION_ID,
          queryText: inputMessage,
          contentSource: {
            retriever: { retrieverId: Q_RETRIEVER_ID },
          },
          maxResults: MAX_DATA_SOURCE_ITEMS,
        };
        const dsCommand = new SearchRelevantContentCommand(dsInput);

        let finalInputText = 'Retrieving knowledge from the users data source...\n';

        try {
          const dsResponse = await qBusinessClient.send(dsCommand);
          console.log('Q data sources response:', dsResponse);

          if (dsResponse.relevantContent && dsResponse.relevantContent.length > 0) {
            // Build knowledge text
            const knowledgeText = dsResponse.relevantContent
              .map((ds) => {
                const docUri = ds.documentUri || 'N/A';
                const snippet = ds.content || '';
                return `${snippet}\nDocument URI: ${docUri}`;
              })
              .join('\n\n');

            // Store references in an array
            dsReferences = dsResponse.relevantContent.filter((ds) => ds.documentUri).map((ds) => ds.documentUri);

            finalInputText += '**Relevant Data Source Content:**\n';
            finalInputText += knowledgeText;
            finalInputText += '\n**End of Relevant Data Source Content**';
          } else {
            finalInputText += 'No relevant content found in data sources.';
          }
        } catch (err) {
          console.error('Error querying data sources:', err);
          finalInputText += 'Error querying data sources. Please try again later.';
        }

        // Also store a 'knowledge' message
        if (numaChatDynamoUtils) {
          await numaChatDynamoUtils
            .addMessage({
              conversationId: cid,
              userId: sub,
              messageType: 'knowledge',
              role: 'assistant',
              content: finalInputText,
            })
            .catch((err) => console.error('Error storing knowledge message:', err));
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

      const bedrockMessages = await prepareConversationHistoryForBedrock(
        conversationHistory,
        getIdentityPoolCredentials,
      );

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
      const converseInput = {
        modelId: MODEL_ID,
        messages: validatedMessages,
        system: [{ text: SYSTEM_MESSAGE }],
        inferenceConfig: { maxTokens: 4000, temperature: 0.1 },
      };

      if (webSearchEnabled) {
        console.log('Web search results injected directly into prompt, not using Claude tools');
      }
      console.log('Converse Input:', JSON.stringify(converseInput, null, 2));

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
          if (err.name === 'TypeError' && retryCount < MAX_RETRIES - 1) {
            console.log(`Retry attempt ${retryCount + 1} after error:`, err);
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
            retryCount++;
            continue;
          }
          throw err;
        }
      }

      // 6) Accumulate the raw text and a “display text” that strips comment tags
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

      if (numaChatDynamoUtils) {
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
      const errorMsg = {
        role: 'system',
        content: `Error: ${err.message || 'Failed to send message'}. Please try again or refresh page.`,
      };
      setMessages((prev) => [...prev, errorMsg]);
      setButtonStatus('idle');
    }
  };

  // Load single conversation from DB
  const handleLoadConversation = async (selectedConversationId) => {
    if (!numaChatDynamoUtils) return;
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
    }
  };

  // Handler for the Stop button during streaming
  const handleStopGeneration = () => {
    stopGenerationRef.current = true;
  };

  // File upload success callback
  const handleFileUploadSuccess = async () => {
    setShowUploadModal(false);
    refreshSidebar();
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
          <div className="flex-grow-1 d-flex">
            <div className="chat-content flex-grow-1 d-flex flex-column">
              {/* Header with chat instructions and New Chat button on the right */}
              <div className="chat-header d-flex justify-content-between align-items-center mb-3">
                <p className="mb-0 small text-muted">Chat with your documents using Numa.</p>
                <Button
                  className="btn btn-primary"
                  onClick={handleNewChat}
                  style={{ color: '#4b007d', marginRight: '15px' }}
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
        onUploadSuccess={handleFileUploadSuccess}
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
