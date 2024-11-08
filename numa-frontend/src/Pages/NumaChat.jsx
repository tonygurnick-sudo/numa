import { useState, useRef, useEffect } from 'react';
import {
  Button,
  Form,
  Alert,
  Container,
  Row,
  Col,
  Collapse,
} from 'react-bootstrap';
import { ChevronDown, ChevronRight, ChevronLeft } from 'react-bootstrap-icons';
import {
  ChatSyncCommand,
  ListConversationsCommand,
} from '@aws-sdk/client-qbusiness';
import { useAuth } from '../Providers/AuthProvider';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';

const NumaChat = () => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [previousMessageId, setPreviousMessageId] = useState(null);
  const messageEndRef = useRef(null);
  const { user, logout, qBusinessClient } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [showConversations, setShowConversations] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // TODO: Make this dynamic
  const APPLICATION_ID = '2594236d-712a-4355-8b0e-6a4cef023f75';

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const fetchConversations = async () => {
      if (!qBusinessClient) return;

      setIsLoadingConversations(true);
      try {
        const input = {
          applicationId: APPLICATION_ID,
          maxResults: 10, // Adjust as needed
        };

        const command = new ListConversationsCommand(input);
        const response = await qBusinessClient.send(command);
        setConversations(response.conversations || []);
      } catch (error) {
        console.error('Error fetching conversations:', error);
        setError('Failed to load conversations');
      } finally {
        setIsLoadingConversations(false);
      }
    };

    fetchConversations();
  }, [qBusinessClient]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setShowConversations(!isMobile);
  }, [isMobile]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || !qBusinessClient) return;

    setError(null);
    setIsLoading(true);

    try {
      console.log('Current state:', { conversationId, previousMessageId });

      const newUserMessage = { role: 'user', content: inputMessage };
      setMessages((prev) => [...prev, newUserMessage]);
      setInputMessage('');

      // Prepare base input
      const input = {
        applicationId: APPLICATION_ID,
        userGroups: user.decoded_tokens.idToken['cognito:groups'] || [],
        userMessage: inputMessage,
        chatMode: 'RETRIEVAL_MODE',
        clientToken: Date.now().toString(),
      };

      // Add conversation details only if both conversationId and previousMessageId exist
      if (conversationId && previousMessageId) {
        input.conversationId = conversationId;
        input.parentMessageId = previousMessageId;
      }

      console.log('Sending request with:', input);
      const command = new ChatSyncCommand(input);
      const response = await qBusinessClient.send(command);

      // Update conversation ID if this is a new conversation
      if (!conversationId && response.conversationId) {
        setConversationId(response.conversationId);
      }

      // Add AI response to messages
      if (response.systemMessage) {
        const newAIMessage = {
          role: 'assistant',
          content: response.systemMessage,
          id: response.systemMessageId,
          sources: response.sourceAttributions,
        };
        setMessages((prev) => [...prev, newAIMessage]);
        setPreviousMessageId(response.systemMessageId);
      }

      // Handle any failed attachments
      if (response.failedAttachments?.length > 0) {
        console.warn('Some attachments failed:', response.failedAttachments);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setError('Failed to send message. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const renderSourceAttributions = (sources) => {
    if (!sources || sources.length === 0) return null;

    return (
      <div className="source-attributions mt-2 text-muted">
        <small>
          Sources:
          {sources.map((source, index) => (
            <div key={index} className="ms-2">
              {index + 1}. {source.title}
              {source.url && (
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {' '}
                  (link)
                </a>
              )}
            </div>
          ))}
        </small>
      </div>
    );
  };

  const fetchConversationHistory = async (conversationId) => {
    setIsLoading(true);
    try {
      const input = {
        applicationId: APPLICATION_ID,
        conversationId: conversationId,
        // You might need to adjust these parameters based on your API
        maxResults: 50,
      };

      const command = new ListConversationsCommand(input);
      const response = await qBusinessClient.send(command);

      // Transform the messages into the format your chat expects
      const formattedMessages =
        response.messages?.map((message) => ({
          role: message.role === 'USER' ? 'user' : 'assistant',
          content: message.content,
          id: message.messageId,
          sources: message.sourceAttributions,
        })) || [];

      setMessages(formattedMessages);

      // Set the last message ID as the previous message ID for continuation
      if (formattedMessages.length > 0) {
        const lastMessage = formattedMessages[formattedMessages.length - 1];
        setPreviousMessageId(lastMessage.id);
      }
    } catch (error) {
      console.error('Error fetching conversation history:', error);
      setError('Failed to load conversation history');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConversationSelect = async (conversation) => {
    setConversationId(conversation.conversationId);
    if (isMobile) {
      setShowConversations(false);
    }
    await fetchConversationHistory(conversation.conversationId);
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
          <div
            className={`sidebar-wrapper ${showConversations ? 'open' : 'closed'}`}
            style={{
              position: isMobile ? 'absolute' : 'relative',
              height: '100%',
              zIndex: 1000,
              backgroundColor: 'white',
              width: showConversations ? '300px' : '0',
              transition: 'width 0.3s ease',
              ...(isMobile && {
                width: '300px',
                transform: showConversations
                  ? 'translateX(0)'
                  : 'translateX(-100%)',
                transition: 'transform 0.3s ease',
              }),
            }}
          >
            <div className="sidebar-content border-end bg-white h-100">
              <div className="p-3">
                <Button
                  variant="primary"
                  className="w-100 mb-3"
                  onClick={() => {
                    setConversationId(null);
                    setPreviousMessageId(null);
                    setMessages([]);
                  }}
                >
                  New Chat
                </Button>

                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h5 className="mb-0">Previous Conversations</h5>
                </div>

                <hr className="my-3" />

                <div className="conversation-list">
                  {isLoadingConversations ? (
                    <div>Loading conversations...</div>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {conversations.map((conv) => (
                        <Button
                          key={conv.conversationId}
                          variant={
                            conversationId === conv.conversationId
                              ? 'primary'
                              : 'outline-primary'
                          }
                          onClick={() => handleConversationSelect(conv)}
                          className="text-start w-100"
                        >
                          <div className="text-truncate">
                            {conv.title || 'Untitled Chat'}
                          </div>
                          <small className="text-muted d-block">
                            {new Date(conv.startTime).toLocaleDateString(
                              'en-US',
                              {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              },
                            )}
                          </small>
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <button
            className={`chevron-button ${showConversations ? 'open' : 'closed'}`}
            onClick={() => setShowConversations(!showConversations)}
            aria-label="Show conversations"
          >
            {showConversations ? (
              <ChevronLeft size={20} />
            ) : (
              <ChevronRight size={20} />
            )}
          </button>

          <div className="main-content flex-grow-1">
            <div className="chat-container d-flex flex-column h-100 p-2 p-lg-3">
              <p className="mb-1 small text-muted">
                Chat with your documents using Amazon Q Business. Ask anything!
              </p>
              {error && (
                <Alert variant="danger" className="py-1 mb-1">
                  {error}
                </Alert>
              )}
              <div
                className="chat-messages bg-light p-3 rounded mb-3 flex-grow-1"
                style={{
                  overflowY: 'auto',
                  minHeight: 0,
                  height: '100%',
                }}
              >
                {isLoading && messages.length === 0 ? (
                  <div className="text-center">
                    <span className="spinner-border spinner-border-sm me-2" />
                    Loading conversation...
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <div
                      key={index}
                      className={`message ${message.role} mb-3`}
                      style={{
                        padding: '8px',
                        borderRadius: '5px',
                        backgroundColor:
                          message.role === 'user' ? '#e9ecef' : '#ffffff',
                      }}
                    >
                      <strong>
                        {message.role === 'user' ? 'You:' : 'AI:'}
                      </strong>{' '}
                      {message.content}
                      {message.role === 'assistant' &&
                        renderSourceAttributions(message.sources)}
                    </div>
                  ))
                )}
                <div ref={messageEndRef} />
              </div>
              <Form onSubmit={handleSubmit} className="mt-auto">
                <Form.Group className="mb-2">
                  <Form.Control
                    as="textarea"
                    rows={isMobile ? 2 : 3}
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="Type your message here..."
                  />
                </Form.Group>
                <div
                  className={`d-flex ${isMobile ? 'flex-column' : 'flex-row'} gap-2`}
                >
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={isLoading || !qBusinessClient}
                    className={isMobile ? 'w-100' : ''}
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
                  <Button
                    variant="outline-secondary"
                    onClick={() => logout()}
                    className={isMobile ? 'w-100' : ''}
                  >
                    Logout
                  </Button>
                </div>
              </Form>
            </div>
          </div>
        </div>
      </LayoutDashboard>
    </div>
  );
};

export { NumaChat };
