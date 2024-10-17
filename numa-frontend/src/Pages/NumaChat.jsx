import { useState, useRef, useEffect } from 'react';
import { LayoutForm } from '../Layouts/LayoutForm';
import { Button, Form, Alert } from 'react-bootstrap';

const NumaChat = () => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const messageEndRef = useRef(null);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!inputMessage.trim()) return;

    const newMessage = { role: 'user', content: inputMessage };
    setMessages((prevMessages) => [...prevMessages, newMessage]);
    setInputMessage('');
    setIsLoading(true);

    try {
      // TODO: Wire up Q Chat API here
      // We'll simulate a response in the meantime
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const botResponse = {
        role: 'assistant',
        content: `Echo: ${inputMessage}`,
      };
      setMessages((prevMessages) => [...prevMessages, botResponse]);
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
            Chat with your documents. Ask anything!
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
              disabled={isLoading}
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
