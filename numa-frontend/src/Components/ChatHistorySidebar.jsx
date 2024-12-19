import { useState, useEffect } from 'react';
import { Button } from 'react-bootstrap';
import { ListConversationsCommand, ListMessagesCommand } from '@aws-sdk/client-qbusiness';

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
        maxResults: 50
      };

      const command = new ListMessagesCommand(input);
      const response = await qBusinessClient.send(command);

      if (!response.messages || response.messages.length === 0) {
        setError('No messages found in this conversation');
        return;
      }

      const sortedMessages = [...response.messages].sort((a, b) => new Date(a.time) - new Date(b.time));
      const formattedMessages = sortedMessages.map((message) => ({
        role: message.type === 'USER' ? 'user' : 'assistant',
        content: message.body,
        id: message.messageId,
        sources: message.sourceAttributions || [],
      }));

      onSelectConversation(formattedMessages, conversationId);
      setShow(false);
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
      >
        Chat History
      </Button>

      <div className={`chat-history-sidebar ${show ? 'show' : ''}`}>
        <div className="sidebar-header d-flex justify-content-between align-items-center">
          <h6 className="mb-0">Chat History</h6>
          <Button
            variant="link"
            className="close-button p-0 text-muted"
            onClick={handleShow}
          >
            <i className="bi bi-x-lg"></i>
          </Button>
        </div>

        <div className="chat-history-list">
          {isLoading ? (
            <div className="text-muted small">Loading conversations...</div>
          ) : conversations.length === 0 ? (
            <p className="small text-muted">No conversations available</p>
          ) : (
            <div className="conversations-container small">
              {conversations.map((conversation) => (
                <div
                  key={conversation.conversationId}
                  className="conversation-item mb-2 p-2 rounded"
                  onClick={() => fetchConversationHistory(conversation.conversationId)}
                  role="button"
                >
                  <div className="conversation-title fw-bold">
                    {conversation.title || 'Untitled Chat'}
                  </div>
                  <div className="conversation-time text-muted mt-1" style={{ fontSize: '0.75rem' }}>
                    {new Date(conversation.startTime || conversation.creationTime).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
