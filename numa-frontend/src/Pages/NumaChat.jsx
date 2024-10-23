import { useState, useRef, useEffect } from 'react';
import { Button, Form, Alert } from 'react-bootstrap';
import { ChatSyncCommand } from '@aws-sdk/client-qbusiness';
import { useAuth } from '../Providers/AuthProvider';

const NumaChat = () => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const messageEndRef = useRef(null);
  const { user, logout, qBusinessClient } = useAuth();

  const APPLICATION_ID = '2594236d-712a-4355-8b0e-6a4cef023f75';

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || !qBusinessClient) return;

    setError(null);
    setIsLoading(true);

    try {
      // Store user message immediately
      const newUserMessage = { role: 'user', content: inputMessage };
      setMessages((prev) => [...prev, newUserMessage]);
      setInputMessage('');

      const input = {
        applicationId: APPLICATION_ID,
        userId: user.decoded_tokens.idToken.sub, // Use the sub from the ID token
        userGroups: user.decoded_tokens.idToken['cognito:groups'] || [], // Use groups from the ID token
        conversationId: conversationId,
        userMessage: inputMessage,
        chatMode: 'RETRIEVAL_MODE',
        clientToken: Date.now().toString(),
      };

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
    <>
      <h1 className="mb-2">Numa Chat</h1>
      <p className="mb-4 fs-lg-1">
        Chat with your documents using Amazon Q Business. Ask anything!
      </p>
      <br />
      {error && <Alert variant="danger">{error}</Alert>}
      <div
        className="chat-messages"
        style={{
          height: '400px',
          overflowY: 'auto',
          marginBottom: '20px',
          border: '1px solid #ced4da',
          borderRadius: '5px',
          padding: '10px',
        }}
      >
        {messages.map((message, index) => (
          <div
            key={index}
            className={`message ${message.role}`}
            style={{
              marginBottom: '10px',
              padding: '8px',
              borderRadius: '5px',
              backgroundColor: message.role === 'user' ? '#e9ecef' : '#f8f9fa',
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
          className="mb-3"
          disabled={isLoading || !qBusinessClient}
        >
          {isLoading ? 'Sending...' : 'Send Message'}
        </Button>
        <Button
          variant="secondary"
          className="mb-3 ms-2"
          onClick={() => logout()}
        >
          Logout
        </Button>
      </Form>
    </>
  );
};

export { NumaChat };
