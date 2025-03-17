import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Button } from 'react-bootstrap';
import { useAuth } from '../Providers/AuthProvider';

export const ChatHistorySidebar = forwardRef(function ChatHistorySidebar(
  { onSelectConversation, setError, currentConversationId },
  ref,
) {
  const [isLoading, setIsLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [localError, setLocalError] = useState(null); // local error state
  const sidebarRef = useRef(null);
  const { user, numaChatDynamoUtils } = useAuth();

  // Grab user info from token
  const idToken = user?.decoded_tokens?.idToken ?? {};
  const sub = idToken.sub;

  // Toggle the sidebar open/closed
  const handleShow = () => setShow(!show);

  /**
   * Fetch conversation metadata. Just metadata, not the full conversation.
   * Sort them by latestTimestamp descending.
   */
  const fetchConversations = async () => {
    if (!numaChatDynamoUtils || !user) return;
    setIsLoading(true);
    try {
      const userId = sub || 'anonymous';
      const metaItems = await numaChatDynamoUtils.getUserConversationsMeta(userId);
      metaItems.sort((a, b) => b.latestTimestamp - a.latestTimestamp);
      setConversations(metaItems);
      setLocalError(null);
    } catch (error) {
      console.error('Error fetching conversations:', error);
      setLocalError('Failed to load conversation history');
      // Optionally pass error to parent:
      setError('Failed to load conversation history');
    } finally {
      setIsLoading(false);
    }
  };

  // Expose refreshConversations() via ref for parent components
  useImperativeHandle(ref, () => ({
    refreshConversations: () => {
      fetchConversations();
    },
  }));

  // Fetch conversations on mount or when currentConversationId changes
  useEffect(() => {
    fetchConversations();
  }, [numaChatDynamoUtils, currentConversationId]);

  // Hide sidebar if user clicks outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target)) {
        setShow(false);
      }
    };
    if (show) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [show]);

  /**
   * Handle renaming a conversation.
   * Prompts for a new name, calls the DynamoDB client, and refreshes the list.
   */
  const handleRename = async (conversationId, currentName) => {
    const newName = prompt('Enter new name for this conversation:', currentName);
    if (newName === null) return; // user cancelled
    if (!numaChatDynamoUtils) {
      console.error('DynamoDB client not initialized');
      return;
    }
    try {
      await numaChatDynamoUtils.updateConversationName(conversationId, sub, newName);
      fetchConversations();
    } catch (error) {
      console.error('Error renaming conversation:', error);
      setLocalError('Failed to rename conversation');
      setError('Failed to rename conversation');
    }
  };

  /**
   * Handle deleting a conversation.
   * Prompts for confirmation, calls the DynamoDB client, and refreshes the list.
   */
  const handleDelete = async (conversationIdToDelete) => {
    if (!numaChatDynamoUtils) return;
    // Confirm deletion with the user
    if (!window.confirm('Are you sure you want to delete this conversation?')) {
      return;
    }
    try {
      // Assuming your DynamoDB client has a deleteConversation or similar method.
      await numaChatDynamoUtils.deleteConversation(conversationIdToDelete, sub);
      // Refresh the conversation list after deletion.
      fetchConversations();
    } catch (error) {
      console.error('Error deleting conversation:', error);
      setLocalError('Failed to delete conversation');
      setError('Failed to delete conversation');
    }
  };

  return (
    <div className="chat-history-sidebar">
      <Button
        variant="outline-secondary"
        className="chat-history-toggle"
        onClick={handleShow}
        aria-controls="chat-history-content"
      >
        <i className="bi bi-clock-history"></i>
      </Button>

      <div
        ref={sidebarRef}
        className={`chat-history-content ${show ? 'show' : ''}`}
        style={{
          position: 'fixed',
          right: show ? '0' : '-320px',
          top: '0',
          width: '320px',
          height: '100vh',
          backgroundColor: 'white',
          boxShadow: '-2px 0 5px rgba(0,0,0,0.1)',
          transition: 'right 0.3s ease-in-out',
          zIndex: 1000,
          padding: '1rem',
        }}
      >
        <div className="sidebar-header d-flex justify-content-between align-items-center">
          <h6 className="mb-0">Chat History</h6>
          <Button variant="link" className="close-button p-0 text-muted" onClick={handleShow}>
            <i className="bi bi-x-lg"></i>
          </Button>
        </div>

        <div
          className="chat-history-list"
          style={{
            maxHeight: 'calc(100vh - 100px)',
            overflowY: 'auto',
          }}
        >
          {isLoading ? (
            <div className="text-muted small">Loading conversations...</div>
          ) : localError ? (
            <div className="error-message text-muted small">
              {localError}
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  setLocalError(null);
                  fetchConversations();
                }}
              >
                Retry
              </Button>
            </div>
          ) : conversations.length === 0 ? (
            <p className="small text-muted">No conversations available</p>
          ) : (
            <div className="conversations-container small">
              {conversations.map((convo) => (
                <div
                  key={convo.conversation_id}
                  className={`conversation-item mb-2 p-2 rounded ${
                    convo.conversation_id === currentConversationId ? 'active' : ''
                  }`}
                  onClick={() => onSelectConversation(convo.conversation_id)}
                  role="button"
                >
                  {/* Left: Title + Timestamp | Right: Actions */}
                  <div className="d-flex align-items-center justify-content-between">
                    {/* Left: Conversation details */}
                    <div className="conversation-details">
                      <div className="conversation-title fw-bold">{convo.conversationName || 'Untitled Chat'}</div>
                      <div className="conversation-time text-muted mt-1">
                        {new Date(convo.latestTimestamp).toLocaleString()}
                      </div>
                    </div>
                    {/* Right: Edit & Delete stacked */}
                    <div className="conversation-actions d-flex flex-column align-items-center">
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 text-secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRename(convo.conversation_id, convo.conversationName);
                        }}
                      >
                        <i className="bi bi-pencil"></i>
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 text-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(convo.conversation_id);
                        }}
                      >
                        <i className="bi bi-trash"></i>
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
