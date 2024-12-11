import { useState, useRef, useEffect } from 'react';
import { Button, Form, Alert, Container, Row, Col } from 'react-bootstrap';
import { ChevronRight, ChevronLeft } from 'react-bootstrap-icons';
import {
  ChatSyncCommand,
  ListConversationsCommand,
} from '@aws-sdk/client-qbusiness';
import { useAuth } from '../Providers/AuthProvider';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { ChatHistorySidebar } from '../Components/ChatHistorySidebar';

const NumaChat = () => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [previousMessageId, setPreviousMessageId] = useState(null);
  const messageEndRef = useRef(null);
  const { user, qBusinessClient } = useAuth();
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
            APPLICATION_ID={APPLICATION_ID}
            onSelectConversation={(messages) => {
              setMessages(messages);
              if (messages.length > 0) {
                setPreviousMessageId(messages[messages.length - 1].id);
              }
            }}
            setError={setError}
          />

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
                className="chat-messages bg-light p-3 mb-3 flex-grow-1"
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
                      className={`message rounded ${message.role} mb-3 p-4`}
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
    </div>
  );
};

export { NumaChat };
