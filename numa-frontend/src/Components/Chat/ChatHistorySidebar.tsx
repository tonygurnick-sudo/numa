import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Button, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { useAuth } from '../../Providers/AuthProvider';
import AgentAvatar from '../Agents/AgentAvatar';
import { useAgentById } from '../../hooks/useAgentById';
import { useDrawerBackClose } from '../../hooks/useDrawerBackClose';

type ChatHistorySidebarProps = {
  onSelectConversation: (conversationId: string) => void;
  setError: (message: string | null) => void;
  currentConversationId?: string | null;
};

type ChatHistorySidebarRef = {
  refreshConversations: () => void;
  toggleSidebar: () => void;
};

type ConversationMeta = {
  conversation_id: string;
  conversationName?: string | null;
  latestTimestamp: number;
  timestamp: number;
  content: string;
  agentId?: string | null;
  agentTitle?: string | null;
  agentIcon?: string | null;
  agentType?: string | null;
  agentVisibility?: string | null;
  isAgentConversation?: boolean;
};

const HistoryAvatar = ({ convo }: { convo: ConversationMeta }) => {
  const { agent } = useAgentById(convo.agentId || undefined);
  if (!convo.isAgentConversation) return null;
  return (
    <AgentAvatar
      agent={agent}
      icon={convo.agentIcon || undefined}
      size={18}
      rounded={true}
      alt={convo.agentTitle || 'Agent'}
    />
  );
};

export const ChatHistorySidebar = forwardRef<ChatHistorySidebarRef, ChatHistorySidebarProps>(
  function ChatHistorySidebar({ onSelectConversation, setError, currentConversationId }, ref) {
    const [isLoading, setIsLoading] = useState(false);
    const [show, setShow] = useState(false);
    const [conversations, setConversations] = useState<ConversationMeta[]>([]);
    const [localError, setLocalError] = useState(null); // local error state
    const sidebarRef = useRef<HTMLDivElement | null>(null);
    const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
    const { user, numaChatDynamoUtils } = useAuth();

    // Grab user info from token
    const idToken = user?.decoded_tokens?.idToken ?? {};
    const sub = idToken.sub;

    const handleClose = useCallback(() => setShow(false), []);

    useEffect(() => {
      if (typeof window === 'undefined') return;
      const onResize = () => setIsMobile(window.innerWidth <= 768);
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }, []);

    useDrawerBackClose({
      isOpen: show,
      onClose: handleClose,
      enabled: isMobile,
      stateKey: 'chat-history',
    });

    // Toggle the sidebar open/closed
    const handleShow = () => setShow(!show);

    /**
     * Fetch conversation metadata. Just metadata, not the full conversation.
     * Now guaranteed to be sorted by latestTimestamp descending from DynamoDBUtils.
     */
    const fetchConversations = async () => {
      if (!numaChatDynamoUtils || !user) return;
      setIsLoading(true);
      try {
        const userId = sub || 'anonymous';
        const metaItems = await numaChatDynamoUtils.getUserConversationsMeta(userId);
        // No need to sort here anymore - DynamoDBUtils now returns conversations
        // sorted by latestTimestamp descending (newest first)
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

    // Expose refreshConversations() and toggleSidebar() via ref for parent components
    useImperativeHandle(ref, () => ({
      refreshConversations: () => {
        fetchConversations();
      },
      toggleSidebar: () => {
        setShow((prevShow) => !prevShow);
      },
    }));

    // Fetch conversations on mount and when dynamic client is available or tokens refresh
    useEffect(() => {
      if (numaChatDynamoUtils) {
        fetchConversations();
      }
    }, [numaChatDynamoUtils, idToken.jti]);

    // Hide sidebar if user clicks outside (but not on the history button)
    useEffect(() => {
      if (!show) return;

      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (!target?.closest('.chat-history-btn') && !sidebarRef.current?.contains(target)) {
          setShow(false);
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
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
        await numaChatDynamoUtils.updateConversationName(conversationId, sub, newName, 'manual');
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

    const topOffsetPx = isMobile ? 60 : 0;
    const topOffset = `calc(${topOffsetPx}px + env(safe-area-inset-top, 0px))`;
    const sidebarHeight = `calc(100dvh - ${topOffsetPx}px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))`;

    return (
      <div className="chat-history-sidebar">
        <div
          ref={sidebarRef}
          className={`chat-history-content ${show ? 'show' : ''}`}
          style={{
            position: 'fixed',
            right: show ? '0' : '-320px',
            top: topOffset,
            width: '320px',
            height: sidebarHeight,
            backgroundColor: 'white',
            boxShadow: '-2px 0 5px rgba(0,0,0,0.1)',
            transition: 'right 0.3s ease-in-out',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div className="sidebar-header d-flex justify-content-between align-items-center">
            <h6 className="mb-0">Chat History</h6>
            <Button
              variant="link"
              className="close-button p-0 text-muted"
              aria-label="Close chat history"
              onClick={handleShow}
            >
              <i className="bi bi-x-lg"></i>
            </Button>
          </div>

          <div
            className="chat-history-list"
            style={{
              maxHeight: `calc(${sidebarHeight} - 90px)`,
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
                    className={`conversation-item mb-2 p-2 rounded ${convo.conversation_id === currentConversationId ? 'active' : ''}`}
                    onClick={() => onSelectConversation(convo.conversation_id)}
                    role="button"
                  >
                    <div className="d-flex align-items-center justify-content-between">
                      <OverlayTrigger
                        placement="left"
                        overlay={
                          <Tooltip id={`tooltip-${convo.conversation_id}`}>
                            {new Date(convo.latestTimestamp).toLocaleString()}
                          </Tooltip>
                        }
                      >
                        <div
                          className="conversation-details flex-grow-1 me-2"
                          style={{ minWidth: 0 }}
                          role="presentation"
                        >
                          <div className="d-flex align-items-center gap-2">
                            <HistoryAvatar convo={convo} />
                            <div className="conversation-title fw-bold text-wrap text-break">
                              {convo.conversationName || 'Untitled Chat'}
                            </div>
                          </div>
                          {convo.isAgentConversation && convo.agentTitle && (
                            <div className="text-muted small mt-1">Agent: {convo.agentTitle}</div>
                          )}
                        </div>
                      </OverlayTrigger>
                      <div className="conversation-actions d-flex flex-column align-items-center flex-shrink-0 ms-2">
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0 text-secondary"
                          aria-label="Rename conversation"
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
                          aria-label="Delete conversation"
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
  },
);
