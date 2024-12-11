import React, { useState, useEffect } from 'react';
import { Button } from 'react-bootstrap';
import { ListConversationsCommand } from '@aws-sdk/client-qbusiness';

export const ChatHistorySidebar = ({
  qBusinessClient,
  APPLICATION_ID,
  onSelectConversation,
  setError,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [conversations, setConversations] = useState([]);

  const handleShow = () => setShow(!show);

  const fetchConversationHistory = async (conversationId) => {
    setIsLoading(true);
    try {
      const input = {
        applicationId: APPLICATION_ID,
        conversationId: conversationId,
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

      onSelectConversation(formattedMessages);

      // Return the last message ID for the parent component
      if (formattedMessages.length > 0) {
        const lastMessage = formattedMessages[formattedMessages.length - 1];
        return lastMessage.id;
      }
    } catch (error) {
      console.error('Error fetching conversation history:', error);
      setError('Failed to load conversation history');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const fetchConversations = async () => {
      if (!qBusinessClient) return;

      setIsLoading(true);
      try {
        const input = {
          applicationId: APPLICATION_ID,
          maxResults: 10,
        };

        const command = new ListConversationsCommand(input);
        const response = await qBusinessClient.send(command);
        setConversations(response.conversations || []);
      } catch (error) {
        console.error('Error fetching conversations:', error);
        setError('Failed to load conversations');
      } finally {
        setIsLoading(false);
      }
    };

    fetchConversations();
  }, [qBusinessClient, APPLICATION_ID, setError]);

  return (
    <>
      <Button
        onClick={handleShow}
        className="chat-history-toggle"
        variant="primary"
        size="sm"
        style={{
          position: 'fixed',
          right: '0',
          top: '50%',
          transform: 'translateY(-50%) rotate(-90deg)',
          transformOrigin: 'right bottom',
          borderRadius: '4px 4px 0 0',
          zIndex: 1000,
        }}
      >
        Chat History
      </Button>

      <div
        className={`chat-history-sidebar ${show ? 'show' : ''}`}
        style={{
          position: 'fixed',
          right: show ? '0' : '-300px',
          top: '0',
          width: '300px',
          height: '100vh',
          backgroundColor: 'white',
          boxShadow: '-2px 0 5px rgba(0,0,0,0.1)',
          transition: 'right 0.3s ease',
          zIndex: 999,
          padding: '1rem',
          overflowY: 'auto',
        }}
      >
        <h5 className="mb-3">Chat History</h5>
        {isLoading ? (
          <div>Loading conversations...</div>
        ) : (
          <div className="d-flex flex-column gap-2">
            {conversations.map((conv) => (
              <Button
                key={conv.conversationId}
                variant="outline-primary"
                onClick={() => fetchConversationHistory(conv.conversationId)}
                className="text-start"
              >
                <div className="text-truncate">
                  {conv.title || 'Untitled Chat'}
                </div>
                <small className="text-muted d-block">
                  {new Date(conv.startTime).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </small>
              </Button>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
