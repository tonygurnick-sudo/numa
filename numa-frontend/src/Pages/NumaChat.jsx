import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button, Form, Container, Row, Col, Spinner, Collapse } from 'react-bootstrap';
import { ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { SearchRelevantContentCommand } from '@aws-sdk/client-qbusiness';
import { useAuth } from '../Providers/AuthProvider';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { ChatHistorySidebar } from '../Components/ChatHistorySidebar';
import { DataSourcesList } from '../Components/DataSourcesList';
import { ChatFileUpload } from '../Components/ChatFileUpload';
import { MarkdownContent } from '../Components/MarkdownContent';
import { prepareConversationHistoryForBedrock, MAX_DYNAMO_MESSAGES } from '../utils/bedrockMessageHistoryUtils';
import { ChatInput } from '../Components/ChatInput';
import numaIcon from '../assets/images/numa-logo.svg';
import { basePlacements } from '@popperjs/core';

/** Helper component to display a collapsible references panel */
function ReferencesDropdown({ references }) {
  const [open, setOpen] = useState(false);
  if (!references || references.length === 0) return null;

  return (
    <div className='references-dropdown mt-2'>
      <Button
        variant='link'
        size='sm'
        onClick={() => setOpen(!open)}
        aria-controls='references-collapse'
        aria-expanded={open}
        style={{ color: '#4b007d' }}
      >
        {open ? 'Hide References' : 'Show References'}
      </Button>
      <Collapse in={open}>
        <div id='references-collapse' className='ms-3'>
          <ul className='list-unstyled'>
            {references.map((ref, idx) => (
              <li key={idx}>
                <a href={ref} target='_blank' rel='noopener noreferrer'>
                  {ref}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </Collapse>
    </div>
  );
}

const NumaChat = () => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationStartTime, setConversationStartTime] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [queryDataSources, setQueryDataSources] = useState(false);
  const [buttonStatus, setButtonStatus] = useState('idle');
  const [isFileProcessing, setIsFileProcessing] = useState(false);

  // Refs & contexts
  const stopGenerationRef = useRef(false);
  const messageEndRef = useRef(null);
  const { user, qBusinessClient, bedrockRuntimeClient, numaChatDynamoUtils, getAccessToken, getIdentityPoolCredentials } =
    useAuth();
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
  const Q_RETREIVER_ID = window.sessionStorage.getItem('Q_RETREIVER_ID');
  const MAX_DATA_SOURCE_ITEMS = 6;
  const TODAY = new Date();
  const SYSTEM_MESSAGE = `You are an artifical intelligence called Numa created by Arcanum AI, a helpful AI assistant who can answer user queries and help with everyday tasks. You may be asked general question, be asked questions about a file, or be given data source content to help answer questions. **General Instructions**\n- If provided with data source content from the users data soures, please use it to help answer the user question.\n- If you cannot find the answer in the data source content, please explicitly state so before using your knowledge to answer the question the best you can. If you can answer the users question using the data source(s), Let them know where you found the answer to the question.\n-Formatting: Always respond using valid Markdown syntax, using styling emphasises and headings appropriately. Incorate other bold and italic styling within your outputs when approprate to emphasise certain details.\n- When generating artefacts like documents, email, etc, please never use markdown blocks like '''markdown etc, but instead return as usual with makdown formatting.\n- If the users request is ambiguous or lacks details, ask follow-up questions to gather more information before answering.\n- Maintain a Friendly and Professional Tone: Ensure your responses are clear, respectful, and professional while still being conversational.\n- Request Additional Information: If necessary, prompt the user with questions like “Could you provide more details?” or “What specific aspect would you like to focus on?”\n- Be Context Aware: Leverage any provided context (like user details or previous conversation history) to tailor your response appropriately.\n\nHere is some information about the user that you can use to personalise your response:\n\nUser Email: ${email}\nToday's Date: ${TODAY}`;

  // Ref for input textarea
  const inputRef = useRef(null);
  const handleInputChange = useCallback(() => {
    setInputMessage(inputRef.current.value);
  }, []);

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
    const savedConvoId = localStorage.getItem('currentConversationId');
    if (savedConvoId && numaChatDynamoUtils) {
      handleLoadConversation(savedConvoId);
    }
  }, [numaChatDynamoUtils]); // eslint-disable-line

  // Helper to refresh sidebar
  const refreshSidebar = () => {
    chatHistoryRef.current?.refreshConversations();
  };

  // Create a new conversation
  const handleNewChat = async () => {
    setMessages([]);
    setUploadedFiles([]);
    setInputMessage('');
    setError(null);
    setConversationId(null);
    setConversationStartTime(null);

    // Add an initial greeting from the assistant
    const greeting = { role: 'assistant', content: 'How can I help you today?' };
    setMessages([greeting]);
  };

  // 1) A function that ensures we have a conversation (creates one if needed).
  const createNewConversationIfNeeded = async (initialText = '') => {
    if (conversationId) return conversationId; // Already have one

    const newId = `${sub || 'anonymous'}_${Date.now()}`;
    setConversationId(newId);
    setConversationStartTime(Date.now().toString());
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

      // Optionally store an “assistant greeting”
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
    setError(null);

    try {
      const cid = await createNewConversationIfNeeded(inputMessage);

      // 1) Add user message to local state
      const userMsg = { role: 'user', content: inputMessage };
      setMessages((prev) => [...prev, userMsg]);

      // 2) Store user message in DynamoDB as structured
      if (numaChatDynamoUtils) {
        await numaChatDynamoUtils
          .addMessage({
            conversationId: cid,
            userId: sub,
            messageType: 'text',
            role: 'user',
            content: inputMessage,
          })
          .catch((err) => console.error('Error storing user message:', err));
      }

      // We'll store references from data source queries
      let dsReferences = [];

      // 3) Potentially retrieve data from Q if queryDataSources is on
      stopGenerationRef.current = false;
      if (queryDataSources && qBusinessClient) {
        // Insert ephemeral bubble for 'querying'
        setMessages(prev => [...prev, { role: 'assistant', content: '', status: 'querying' }]);

        const dsInput = {
          applicationId: Q_APPLICATION_ID,
          queryText: inputMessage,
          contentSource: {
            retriever: { retrieverId: Q_RETREIVER_ID },
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
            dsReferences = dsResponse.relevantContent
              .filter((ds) => ds.documentUri)
              .map((ds) => ds.documentUri);

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
          const idx = updated.findIndex(msg => msg.status === 'querying');
          if (idx >= 0) updated.splice(idx, 1);
          return updated;
        });
      }

      // Insert ephemeral bubble for 'thinking'
      setMessages(prev => [...prev, { role: 'assistant', content: '', status: 'thinking' }]);

      // Wait for the UI to update
      await new Promise((resolve) => setTimeout(resolve, 0));

      // 4) Retrieve conversation history
      const conversationHistory = await numaChatDynamoUtils.queryConversations(cid, MAX_DYNAMO_MESSAGES, sub);
      const bedrockMessages = await prepareConversationHistoryForBedrock(conversationHistory, getIdentityPoolCredentials);
      console.log('bedrockMessages:', JSON.stringify(bedrockMessages, null, 2));

      // Validate message format
      const validatedMessages = bedrockMessages.map(msg => {
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

      // 6) Stream assistant's response
      let agentResponseText = '';
      let firstChunk = true;

      for await (const event of response.stream) {
        if (stopGenerationRef.current) {
          console.log('Generation stopped by user.');
          break;
        }
        if (firstChunk) {
          // Remove 'thinking'
          setMessages((prev) => {
            const updated = [...prev];
            const idx = updated.findIndex(m => m.status === 'thinking');
            if (idx >= 0) updated[idx].status = null;
            return updated;
          });
          setButtonStatus('streaming');
          firstChunk = false;
        }
        if (event.contentBlockDelta) {
          const delta = event.contentBlockDelta.delta;
          if (delta.text) {
            agentResponseText += delta.text;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1].content = agentResponseText;
              return updated;
            });
          }
        }
      }

      console.log('Bedrock response:', agentResponseText);
      setButtonStatus('idle');

      // 7) Store the final assistant response WITH references in Dynamo
      const assistantMessagePayload = {
        conversationId: cid,
        userId: sub,
        messageType: 'text',
        role: 'assistant',
        content: agentResponseText,
      };

      // If we found references, attach them (assuming your DynamoDB schema supports an extra field 'references')
      if (dsReferences.length > 0) {
        assistantMessagePayload.references = dsReferences;
      }

      if (numaChatDynamoUtils) {
        // Asynchronous store
        numaChatDynamoUtils.addMessage(assistantMessagePayload)
          .catch(err => console.error('Error storing assistant message:', err));

        // Update the conversation meta item
        numaChatDynamoUtils.updateMetaItem(cid, sub, {
          latestTimestamp: Date.now(),
          latestMessage: inputMessage,
        }).catch(err => console.error('Error updating meta item:', err));
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

      // Refresh the sidebar
      refreshSidebar();

      // Clear user input
      setUploadedFiles([]);
      setInputMessage('');
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);

    } catch (err) {
      console.error('Error invoking Bedrock:', err);
      console.error('Full error details:', JSON.stringify(err, null, 2));
      setError('Failed to send message. Please try again or refresh the page.');
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
      let conversationHistory;

      while (retryCount < 2) {
        try {
          conversationHistory = await numaChatDynamoUtils.queryConversations(selectedConversationId, MAX_DYNAMO_MESSAGES, sub);
          break;
        } catch (error) {
          if (error.message.includes('ExpiredTokenException') && retryCount === 0) {
            console.log('Token expired while loading conversation. Refreshing credentials...');
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
      const chatMessages = conversationHistory.map(item => {
        const baseMsg = {
          role: item.role,
          content: item.content,
          // If your DB item has a 'references' field, pull it in
          references: item.references || [],
        };

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

      const parsed = selectedConversationId.split('_');
      if (parsed.length > 1) {
        setConversationStartTime(parsed[1]);
      }
    } catch (error) {
      console.error('Error loading conversation:', error);
      setError('Failed to load conversation');
    }
  };

  // Press Enter to send
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
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

  return (
    <div className='dashboard'>
      <Nav />
      <header className='mb-1'>
        <Container fluid>
          <Row>
            <Col lg={12}>
              <Breadcrumbs label={'Chat'} clearStack={true} />
              <h1 className='mb-0 fs-3'>Numa Chat</h1>
            </Col>
          </Row>
        </Container>
      </header>

      {/* Main content */}
      <LayoutDashboard className='flex-grow-1'>
        {/* Chat layout */}
        <div className='chat-layout d-flex'>
          {/* Chat history sidebar */}
          <ChatHistorySidebar
            ref={chatHistoryRef}
            onSelectConversation={handleLoadConversation}
            setError={setError}
            currentConversationId={conversationId}
          />
          {/* Data sources list */}
          <DataSourcesList />
          <div className='flex-grow-1 d-flex'>
            <div className='chat-content flex-grow-1 d-flex flex-column'>
              {/* Header with chat instructions and New Chat button on the right */}
              <div className='chat-header d-flex justify-content-between align-items-center mb-3'>
                <p className='mb-0 small text-muted'>
                  Chat with your documents using Numa.
                </p>
                <Button
                  className='btn btn-primary'
                  onClick={handleNewChat}
                  style={{ color: '#4b007d', marginRight: '15px' }}
                >
                  New Chat
                </Button>
              </div>

              {/* Chat messages */}
              <div className='chat-container'>
                <div
                  className='chat-messages'
                  style={{ maxWidth: '100%', overflowX: 'hidden', wordWrap: 'break-word' }}
                >
                  {messages.map((message, index) => {
                    // If assistant with ephemeral status
                    if (message.role === 'assistant' && message.status) {
                      if (message.status === 'initializing') {
                        return (
                          <div key={index} className='message assistant ephemeral'>
                            <strong className='message-role' style={{ display: 'inline-flex', alignItems: 'center' }}>
                              <img
                                src={numaIcon}
                                alt='Numa'
                                style={{ width: '20px', height: '20px', marginRight: '7px' }}
                              />
                              Numa:
                            </strong>
                            <div className='message-content d-flex align-items-center'>
                              <Spinner animation='border' size='sm' className='me-2' />
                              Initializing chat...
                            </div>
                          </div>
                        );
                      } else if (message.status === 'processingFile') {
                        return (
                          <div key={index} className='message assistant ephemeral'>
                            <strong
                              className='message-role'
                              style={{ display: 'inline-flex', alignItems: 'center' }}
                            >
                              <img
                                src={numaIcon}
                                alt='Numa'
                                style={{ width: '20px', height: '20px', marginRight: '7px' }}
                              />
                              Numa:
                            </strong>
                            <div className='message-content d-flex align-items-center'>
                              <Spinner animation='border' size='sm' className='me-2' />
                              Processing Upload...
                            </div>
                          </div>
                        );
                      } else if (message.status === 'querying') {
                        return (
                          <div key={index} className='message assistant ephemeral'>
                            <strong
                              className='message-role'
                              style={{ display: 'inline-flex', alignItems: 'center' }}
                            >
                              <img
                                src={numaIcon}
                                alt='Numa'
                                style={{ width: '20px', height: '20px', marginRight: '7px' }}
                              />
                              Numa:
                            </strong>
                            <div className='message-content d-flex align-items-center'>
                              <Spinner animation='border' size='sm' className='me-2' />
                              Querying data sources...
                            </div>
                          </div>
                        );
                      } else if (message.status === 'thinking') {
                        return (
                          <div key={index} className='message assistant ephemeral'>
                            <strong
                              className='message-role'
                              style={{ display: 'inline-flex', alignItems: 'center' }}
                            >
                              <img
                                src={numaIcon}
                                alt='Numa'
                                style={{ width: '20px', height: '20px', marginRight: '7px' }}
                              />
                              Numa:
                            </strong>
                            <div className='message-content d-flex align-items-center'>
                              <Spinner animation='border' size='sm' className='me-2' />
                              Thinking...
                            </div>
                          </div>
                        );
                      }
                    }

                    // Otherwise, normal message
                    return (
                      <div key={index} className={`message ${message.role}`}>
                        <strong
                          className='message-role'
                          style={{ display: 'inline-flex', alignItems: 'center' }}
                        >
                          {message.role === 'assistant' ? (
                            <>
                              <img
                                src={numaIcon}
                                alt='Numa'
                                style={{
                                  width: '20px',
                                  height: '20px',
                                  marginRight: '7px',
                                  marginBottom: '2px',
                                  verticalAlign: 'middle',
                                }}
                              />
                              Numa:
                            </>
                          ) : message.role === 'user' ? (
                            'You:'
                          ) : (
                            'System:'
                          )}
                        </strong>
                        <div className='message-content markdown-content'>
                          <MarkdownContent content={message.content} />
                          {/* If there are references, show a dropdown */}
                          {message.role === 'assistant' && message.references?.length > 0 && (
                            <ReferencesDropdown references={message.references} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messageEndRef} />
                </div>

                {/* Chat input */}
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
                  disabled={isFileProcessing}
                />
                {/* Datasource Tip Message */}
                <p className='datasource-tip text-center small text-muted'>
                  Click the <i className='bi bi-database'></i> to chat against your data sources.
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
