import { useState, useRef, useEffect } from 'react';
import { Button, Form, Container, Row, Col, Spinner } from 'react-bootstrap';
import {
  ChatSyncCommand,
} from '@aws-sdk/client-qbusiness';
import { useAuth } from '../Providers/AuthProvider';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { ChatHistorySidebar } from '../Components/ChatHistorySidebar';
import { DataSourcesList } from '../Components/DataSourcesList';
import { ChatFileUpload } from '../Components/ChatFileUpload';

const NumaChat = () => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [previousMessageId, setPreviousMessageId] = useState(null);
  const [chatMode, setChatMode] = useState('RETRIEVAL_MODE');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const messageEndRef = useRef(null);
  const { qBusinessClient, getAccessToken } = useAuth();

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const chatModes = [
    { value: 'RETRIEVAL_MODE', label: 'Retrieval Mode - Use indexed data sources' },
    { value: 'CREATOR_MODE', label: 'Creator Mode - Use LLM knowledge' },
    { value: 'PLUGIN_MODE', label: 'Plugin Mode - Use plugins' }
  ];

  const Q_APPLICATION_ID = window.sessionStorage.getItem('Q_APPLICATION_ID');

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);


  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);


  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    try {
      setIsLoading(true);
      setError(null);

      // Only include attachments if there are files
      const input = {
        applicationId: Q_APPLICATION_ID,
        userMessage: inputMessage,
        chatMode: chatMode,
        clientToken: Date.now().toString()
      };

      // Add attachments only if there are files
      if (uploadedFiles.length > 0) {
        const attachments = uploadedFiles.map(file => ({
          name: file.name,
          data: file.data
        }));

        input.attachments = attachments;
      }

      // Add conversation details only if both conversationId and previousMessageId exist
      if (conversationId && previousMessageId) {
        input.conversationId = conversationId;
        input.parentMessageId = previousMessageId;
      }

      // Add user message to chat immediately
      const userMessage = { role: 'user', content: inputMessage };
      setMessages(prevMessages => [...prevMessages, userMessage]);
      setInputMessage('');

      // Send message to API
      const command = new ChatSyncCommand(input);
      try {
        const response = await qBusinessClient.send(command);

        // Handle failed attachments
        if (response.failedAttachments && response.failedAttachments.length > 0) {
          const failedFiles = response.failedAttachments.map(failure => ({
            name: failure.name,
            reason: failure.failureReason || 'Unknown error'
          }));
          console.error('Failed attachments details:', {
            failedFiles,
            fullResponse: response,
            sentInput: {
              ...input,
              attachments: input.attachments.map(a => ({
                name: a.name,
                dataPreview: a.data?.substring(0, 100) + '...',
                dataLength: a.data?.length
              }))
            }
          });

          // Remove failed files from uploadedFiles
          const failedFileNames = new Set(failedFiles.map(f => f.name));
          setUploadedFiles(prevFiles =>
            prevFiles.filter(f => !failedFileNames.has(f.name))
          );

          // Add error message to chat
          const errorMessage = {
            role: 'system',
            content: `Failed to process files: ${failedFiles.map(f =>
              `${f.name} (${f.reason})`
            ).join(', ')}. Please try uploading the files again.`
          };
          setMessages(prevMessages => [...prevMessages, errorMessage]);
          return; // Don't proceed with the conversation if files failed
        }

        if (response.conversationId) {
          setConversationId(response.conversationId);
        }

        if (response.messageId) {
          setPreviousMessageId(response.messageId);
        }

        // Add assistant's response to messages
        // Check for both content and systemMessage
        const responseContent = response.content || response.systemMessage;
        if (responseContent) {
          const assistantMessage = {
            role: 'assistant',
            content: responseContent,
            sourceAttributions: response.sourceAttributions
          };
          setMessages(prevMessages => [...prevMessages, assistantMessage]);
        }

        setIsLoading(false);
      } catch (error) {
        console.error('API Error:', {
          error,
          input,
          attachments: input.attachments.map(a => ({
            name: a.name,
            dataLength: a.data?.length
          }))
        });
        throw error;
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setError('Failed to send message. Please try again.');
      setIsLoading(false);

      // Add error message to chat
      const errorMessage = {
        role: 'system',
        content: `Error: ${error.message || 'Failed to send message'}. Please try again.`
      };
      setMessages(prevMessages => [...prevMessages, errorMessage]);
    }
  };

  const handleFileUploadSuccess = (processedFiles) => {
    setUploadedFiles(processedFiles);
    // Automatically switch to CREATOR_MODE when files are uploaded
    if (processedFiles.length > 0) {
      setChatMode('CREATOR_MODE');
      // Add system message about uploaded files
      const fileNames = processedFiles.map(file => file.name).join(', ');
      const systemMessage = {
        role: 'system',
        content: `Files uploaded successfully: ${fileNames}\n\nYou can now ask questions about the content of these files. For example:\n- "What is this document about?"\n- "Can you summarize the main points?"\n- "What are the key findings?"`
      };
      setMessages(prevMessages => [...prevMessages, systemMessage]);
    }
    setShowUploadModal(false);
  };

  const removeFile = (index) => {
    const newFiles = [...uploadedFiles];
    newFiles.splice(index, 1);
    setUploadedFiles(newFiles);

    // If no more files, revert to default mode and add system message
    if (newFiles.length === 0) {
      setChatMode('RETRIEVAL_MODE');
      const systemMessage = {
        role: 'system',
        content: 'All files have been removed. Switched back to retrieval mode.'
      };
      setMessages(prevMessages => [...prevMessages, systemMessage]);
    }
  };

  const renderSourceAttributions = (attributions) => {
    if (!attributions || attributions.length === 0) return null;

    return (
        <small>
          Sources:
          {attributions.map((source, index) => (
            <div key={index} className="ms-2">
              {source.citationNumber}. {source.title}
              {source.url && (
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {' '}
                  (link)
                </a>
              )}
            </div>
          ))}
        </small>
    );
  };

  const handleNewChat = () => {
    setMessages([{
      role: 'system',
      content: 'How can I help you today?'
    }]);
    setUploadedFiles([]);
    setConversationId(null);
    setPreviousMessageId(null);
    setInputMessage('');
    setChatMode('RETRIEVAL_MODE');
  };

  const handleLoadConversation = (loadedMessages, selectedConversationId) => {

    if (!loadedMessages || loadedMessages.length === 0) {
      setError('No messages found in this conversation');
      return;
    }

    // Update conversation ID
    setConversationId(selectedConversationId);

    // Update the messages state with the loaded conversation
    setMessages(loadedMessages);

    // Get the last message ID for future messages in this conversation
    const lastMessage = loadedMessages[loadedMessages.length - 1];
    if (lastMessage) {
      setPreviousMessageId(lastMessage.id);
    }

    // Set the conversation mode based on the loaded conversation
    // Default to RETRIEVAL_MODE if no mode is found
    const systemMessage = loadedMessages.find(msg => msg.role === 'system');
    if (systemMessage && systemMessage.content.includes('CREATOR_MODE')) {
      setChatMode('CREATOR_MODE');
    } else if (systemMessage && systemMessage.content.includes('PLUGIN_MODE')) {
      setChatMode('PLUGIN_MODE');
    } else {
      setChatMode('RETRIEVAL_MODE');
    }
  };

  return (
    <div className="dashboard d-flex flex-column vh-100">
      <Nav />
      <header className="mb-1">
        <Container fluid>
          <Row>
            <Col lg={12} className="px-3 px-lg-5">
              <Breadcrumbs label={'Chat'} clearStack={true} />
              <h1 className="mb-0 fs-3">Numa Chat</h1>
            </Col>
          </Row>
        </Container>
      </header>

      <LayoutDashboard className="flex-grow-1">
        <div className="chat-layout d-flex">
          <ChatHistorySidebar
            qBusinessClient={qBusinessClient}
            APPLICATION_ID={Q_APPLICATION_ID}
            onSelectConversation={handleLoadConversation}
            setError={setError}
          />

          <div className="flex-grow-1 d-flex">
            <DataSourcesList />
            <div className="chat-content flex-grow-1 d-flex flex-column">
              <div className="chat-header d-flex align-items-center">
                <Button
                  className="btn btn-primary mb-3"
                  onClick={handleNewChat}
                >
                  New Chat
                </Button>

                <div className="chat-mode-selector ms-auto" >
                  <Form.Select
                    value={chatMode}
                    onChange={(e) => setChatMode(e.target.value)}
                    className="mb-3"
                  >
                    {chatModes.map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </Form.Select>
                </div>
              </div>



              <div className="chat-container flex-grow-1 d-flex flex-column">
                <p className="mb-1 small text-muted">
                  Chat with your documents using Amazon Q Business. Ask anything!
                </p>

                <div
                  className="chat-messages bg-light mb-3 flex-grow-1"
                >
                  {isLoading && messages.length === 0 ? (
                    <div className="text-center">
                      <Spinner animation="border" size="sm" className="me-2" />
                      Loading conversation...
                    </div>
                  ) : (
                    messages.map((message, index) => (
                      <div
                        key={index}
                        className={`message ${message.role}`}
                      >
                        {message.role === 'system' ? (
                          <div className="system-message">
                            <i className="bi bi-info-circle me-2"></i>
                            <div className="message-content">
                              {message.content.split('\n').map((line, i) => (
                                <div key={i}>
                                  {line.startsWith('- ') ? (
                                    <div className="message-bullet">{line}</div>
                                  ) : (
                                    line
                                  )}
                                  {i < message.content.split('\n').length - 1 && <br />}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <>
                            <strong className="message-role">
                              {message.role === 'user' ? 'You:' : 'Numa:'}
                            </strong>
                            <div className="message-content">
                              {message.content.split('\n').map((line, i) => (
                                <div key={i}>
                                  {line}
                                  {i < message.content.split('\n').length - 1 && <br />}
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                        {message.role === 'assistant' && message.sourceAttributions && (
                          <div className="source-attributions">
                            {renderSourceAttributions(message.sourceAttributions)}
                          </div>
                        )}
                      </div>
                    ))
                  )}

                  {isLoading && (
                    <div className="message assistant">
                      <strong className="message-role">Numa:</strong>
                      <Spinner animation="border" size="sm" />
                    </div>
                  )}

                  <div ref={messageEndRef} />
                </div>


              </div>

              <Form
                  onSubmit={handleSubmit}
                  className="mt-auto"
                  data-testid="chat-form"
                >
                  <Form.Group className="mb-2 position-relative">
                    <Form.Control
                      as="textarea"
                      rows={isMobile ? 3 : 5}
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      placeholder="Type your message here..."
                      disabled={isLoading || !qBusinessClient}
                    />

                    <Button
                      variant="primary"
                      type="submit"
                      id="send-message-button"
                      disabled={isLoading || !qBusinessClient}
                      className={isMobile ? 'w-100' : 'send-message'}
                    >
                      {isLoading ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" />
                          Sending...
                        </>
                      ) : (
                        'Send Message'
                      )}
                    </Button>
                  </Form.Group>
                </Form>
            </div>
          </div>
        </div>
      </LayoutDashboard>
      <ChatFileUpload
        show={showUploadModal}
        onHide={() => setShowUploadModal(false)}
        onUploadSuccess={handleFileUploadSuccess}
        getAccessToken={getAccessToken}
      />
    </div>
  );
};

export { NumaChat };
