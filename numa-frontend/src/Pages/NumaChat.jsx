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

  const handleConversationSelect = (conversation) => {
    setConversationId(conversation.conversationId);
    // Clear current messages when switching conversations
    setMessages([]);
    // TODO: Fetch messages for selected conversation
  };

  return (
    <div className="dashboard">
      <Nav />
      <header className="mb-4">
        <Container fluid>
          <Row>
            <Col lg={12} className="px-5">
              <Breadcrumbs label={'Chat'} clearStack={true} />
              <h1>Numa Chat</h1>
            </Col>
          </Row>
        </Container>
      </header>

      <LayoutDashboard>
        <div className="chat-layout">
          <div
            className={`sidebar-wrapper ${showConversations ? 'open' : 'closed'}`}
          >
            <button
              className="chevron-button sidebar-toggle"
              onClick={() => setShowConversations(!showConversations)}
              aria-label="Show conversations"
            >
              {showConversations ? (
                <ChevronLeft size={20} />
              ) : (
                <ChevronRight size={20} />
              )}
            </button>

            <div className="sidebar-content border-end bg-white">
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

          <div
            className={`main-content ${showConversations ? 'with-sidebar' : 'full-width'}`}
          >
            <div className="chat-container">
              <p>
                Chat with your documents using Amazon Q Business. Ask anything!
              </p>
              {error && <Alert variant="danger">{error}</Alert>}
              <div
                className="chat-messages bg-light p-4 rounded mb-4"
                style={{
                  height: 'calc(100vh - 400px)',
                  overflowY: 'auto',
                }}
              >
                {messages.map((message, index) => (
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
                    <strong>{message.role === 'user' ? 'You:' : 'AI:'}</strong>{' '}
                    {message.content}
                    {message.role === 'assistant' &&
                      renderSourceAttributions(message.sources)}
                  </div>
                ))}
                <div ref={messageEndRef} />
              </div>
              <Form onSubmit={handleSubmit}>
                <Form.Group className="mb-3">
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="Type your message here..."
                  />
                </Form.Group>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={isLoading || !qBusinessClient}
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
                  className="ms-2"
                  onClick={() => logout()}
                >
                  Logout
                </Button>
              </Form>
            </div>
          </div>
        </div>
      </LayoutDashboard>
    </div>
  );
};

export { NumaChat };
