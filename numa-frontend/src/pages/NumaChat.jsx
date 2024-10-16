import { useState, useRef, useEffect } from 'react';
import { LayoutForm } from '../layouts/LayoutForm';
import { Button, Form, Alert } from 'react-bootstrap';
import {
  QBusinessClient,
  ChatCommand,
  ChatSyncCommand,
} from '@aws-sdk/client-qbusiness';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { useAuth } from '../providers/AuthProvider';

const NumaChat = () => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [client, setClient] = useState(null);
  const messageEndRef = useRef(null);
  const { user, getIdToken } = useAuth();

  useEffect(() => {
    const initializeClient = async () => {
      try {
        console.log('user', user);
        const credentials = fromCognitoIdentityPool({
          clientConfig: { region: 'us-east-1' },
          identityPoolId: 'us-east-1:facf1439-ef67-48f9-ada4-debb294db187',
          logins: {
            'cognito-idp.us-east-1.amazonaws.com/us-east-1_kVPZjTM6a':
              await getIdToken(),
          },
        });

        const newClient = new QBusinessClient({
          region: 'us-east-1',
          credentials: credentials,
        });

        setClient(newClient);
      } catch (error) {
        console.error('Error initializing QBusinessClient:', error);
        setError('Failed to initialize chat. Please try again.');
      }
    };

    initializeClient();
  }, [getIdToken]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingMessage]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!inputMessage.trim() || !client) return;

    const newMessage = { role: 'user', content: inputMessage };
    setMessages((prevMessages) => [...prevMessages, newMessage]);
    setInputMessage('');
    setIsLoading(true);
    setStreamingMessage('');

    try {
      const input = {
        applicationId: '2594236d-712a-4355-8b0e-6a4cef023f75', // required
        userId: user.id,
        userGroups: user.groups,
        conversationId: conversationId,
        inputStream: [
          {
            textEvent: {
              userMessage: inputMessage,
            },
          },
          {
            endOfInputEvent: {},
          },
        ],
      };

      const command = new ChatSyncCommand(input);
      const response = await client.send(command);

      let botResponse = '';
      for await (const chunk of response.outputStream) {
        if (chunk.textEvent) {
          botResponse += chunk.textEvent.systemMessage;
          setStreamingMessage(botResponse);
          if (!conversationId && chunk.textEvent.conversationId) {
            setConversationId(chunk.textEvent.conversationId);
          }
        }
      }

      setMessages((prevMessages) => [
        ...prevMessages,
        {
          role: 'assistant',
          content: botResponse,
          id: response.systemMessageId,
        },
      ]);
      setStreamingMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
      setError('Failed to send message. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LayoutForm
      FormName={'llmchat'}
      Content={
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
                  backgroundColor:
                    message.role === 'user' ? '#e9ecef' : '#f8f9fa',
                }}
              >
                <strong>{message.role === 'user' ? 'You:' : 'AI:'}</strong>{' '}
                {message.content}
              </div>
            ))}
            {streamingMessage && (
              <div
                className="message assistant"
                style={{
                  marginBottom: '10px',
                  padding: '8px',
                  borderRadius: '5px',
                  backgroundColor: '#f8f9fa',
                }}
              >
                <strong>AI:</strong> {streamingMessage}
              </div>
            )}
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
              disabled={isLoading || !client}
            >
              {isLoading ? 'Sending...' : 'Send Message'}
            </Button>
          </Form>
        </>
      }
    />
  );
};

export { NumaChat };
