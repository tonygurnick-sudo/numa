import { Button, Spinner, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { Dispatch, SetStateAction, RefObject } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import { ChatInput } from './ChatInput';
import type { ConversationMeta } from '../hooks/useChatInactivity';
import numaIcon from '../../public/numa-logo.svg';
import AgentAvatar from './AgentAvatar';
import { useAgentById } from '../hooks/useAgentById';

type ConnectionOption = {
  id: string;
  name: string;
  isConnected: boolean;
  mcpServerUrl?: string;
};

type AgentSummary = {
  agentId: string;
  title: string;
  icon?: string;
  iconImage?: { s3Bucket: string; s3Key: string };
  agentType?: string;
  visibility?: string;
};

type NewChatProps = {
  inputMessage: string;
  setInputMessage: Dispatch<SetStateAction<string>>;
  handleSubmit: (event: FormEvent<unknown> | MouseEvent<unknown>) => void;
  setShowUploadModal: Dispatch<SetStateAction<boolean>>;
  buttonStatus: string;
  queryDataSources: boolean;
  setQueryDataSources: Dispatch<SetStateAction<boolean>>;
  webSearchEnabled: boolean;
  setWebSearchEnabled: Dispatch<SetStateAction<boolean>>;
  autoToolsEnabled: boolean;
  setAutoToolsEnabled: Dispatch<SetStateAction<boolean>>;
  availableConnections: ConnectionOption[];
  enabledConnections: string[];
  setEnabledConnections: Dispatch<SetStateAction<string[]>>;
  connectionsLoading: boolean;
  hasPipedreamFeature: boolean;
  uploadsInProgress: boolean;
  noToolsActive: boolean;
  inputRef: RefObject<HTMLTextAreaElement>;
  recentConversations: ConversationMeta[];
  hideSuggestions: () => void;
  onContinueConversation: (conversationId: string) => void;
  suggestionsLoading: boolean;
  userName?: string;
  onRenameConversation?: (conversationId: string, currentName: string) => Promise<void>;
  onDeleteConversation?: (conversationId: string) => Promise<void>;
  personalAgents?: AgentSummary[];
  onSelectAgent?: (agent: AgentSummary) => void;
  agentsLoading?: boolean;
};

// Renders an avatar for a recent conversation using latest agent data when available.
const ConversationAvatar = ({
  convo,
}: {
  convo: {
    isAgentConversation?: boolean;
    agentId?: string | null;
    agentIcon?: string | null;
    agentTitle?: string | null;
  };
}) => {
  const { agent } = useAgentById(convo.agentId || undefined);

  if (convo.isAgentConversation) {
    return (
      <AgentAvatar
        agent={agent}
        icon={convo.agentIcon || undefined}
        size={32}
        rounded={true}
        alt={convo.agentTitle || 'Agent'}
      />
    );
  }

  return <i className="bi bi-clock-history" style={{ fontSize: '1rem', color: '#6c757d' }}></i>;
};

// Helper function to get time-based greeting
const getTimeBasedGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

// Helper function to format timestamp as relative time
const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
};

// Helper function to format user name properly
const formatUserName = (name: string | undefined): string => {
  if (!name) return '';

  // Split by dots and spaces
  const parts = name.split(/[.\s]+/);

  // Capitalize each part
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' ');
};

const NewChat = ({
  inputMessage,
  setInputMessage,
  handleSubmit,
  setShowUploadModal,
  buttonStatus,
  queryDataSources,
  setQueryDataSources,
  webSearchEnabled,
  setWebSearchEnabled,
  autoToolsEnabled,
  setAutoToolsEnabled,
  availableConnections,
  enabledConnections,
  setEnabledConnections,
  connectionsLoading,
  hasPipedreamFeature,
  uploadsInProgress,
  noToolsActive,
  inputRef,
  recentConversations,
  hideSuggestions,
  onContinueConversation,
  suggestionsLoading,
  userName,
  onRenameConversation,
  onDeleteConversation,
  personalAgents = [],
  onSelectAgent,
  agentsLoading: _agentsLoading = false,
}: NewChatProps) => {
  const handleContinueClick = (conversationId: string) => {
    hideSuggestions();
    onContinueConversation(conversationId);
  };

  const handleRename = async (e: React.MouseEvent, conversationId: string, currentName: string) => {
    e.stopPropagation();
    if (onRenameConversation) {
      await onRenameConversation(conversationId, currentName);
    }
  };

  const handleDelete = async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    if (onDeleteConversation) {
      await onDeleteConversation(conversationId);
    }
  };

  const formattedName = formatUserName(userName);
  const greeting = formattedName ? `${getTimeBasedGreeting()}, ${formattedName}` : getTimeBasedGreeting();

  return (
    <div
      className="d-flex flex-column align-items-center h-100"
      style={{
        paddingTop: 'max(8vh, 2rem)',
        paddingBottom: '0rem',
        paddingLeft: '1rem',
        paddingRight: '1rem',
        overflow: 'hidden',
      }}
    >
      <div style={{ maxWidth: 680, width: '100%', display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Greeting with Numa Logo */}
        <div
          style={{
            marginBottom: '2rem',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            animation: 'fadeIn 0.6s ease-in-out',
          }}
        >
          <img
            src={numaIcon}
            alt="Numa"
            style={{
              width: '32px',
              height: '32px',
              opacity: 0.9,
            }}
          />
          <span
            style={{
              fontSize: '1.75rem',
              fontWeight: 600,
              color: '#212529',
            }}
          >
            {greeting}
          </span>
        </div>

        <div
          className="chat-input-wrapper"
          style={{
            width: '100%',
            marginBottom: '0.75rem',
            animation: 'fadeIn 0.8s ease-in-out',
          }}
        >
          <ChatInput
            inputMessage={inputMessage}
            setInputMessage={setInputMessage}
            handleSubmit={handleSubmit}
            setShowUploadModal={setShowUploadModal}
            buttonStatus={buttonStatus}
            queryDataSources={queryDataSources}
            setQueryDataSources={setQueryDataSources}
            webSearchEnabled={webSearchEnabled}
            setWebSearchEnabled={setWebSearchEnabled}
            autoToolsEnabled={autoToolsEnabled}
            setAutoToolsEnabled={setAutoToolsEnabled}
            availableConnections={availableConnections}
            enabledConnections={enabledConnections}
            setEnabledConnections={setEnabledConnections}
            connectionsLoading={connectionsLoading}
            hasPipedreamFeature={hasPipedreamFeature}
            uploadsInProgress={uploadsInProgress}
            noToolsActive={noToolsActive}
            externalInputRef={inputRef}
            autoFocus={true}
            placeholderOverride={'How can I help you today?'}
          />
        </div>

        {/* Personal Agents List */}
        {personalAgents.length > 0 && (
          <div style={{ maxWidth: 680, width: '100%', marginBottom: '1rem', animation: 'fadeIn 0.6s ease-in-out' }}>
            <div
              className="d-flex align-items-center"
              style={{ gap: '0.5rem', overflowX: 'auto', overflowY: 'hidden', paddingBottom: '0.5rem' }}
            >
              {/* Robot icon as visual indicator */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '40px',
                  height: '40px',
                  color: '#4b007d',
                  flexShrink: 0,
                }}
              >
                <i className="bi bi-robot" style={{ fontSize: '1.5rem' }}></i>
              </div>
              {/* Agent avatars */}
              {personalAgents.map((agent) => (
                <OverlayTrigger
                  key={agent.agentId}
                  placement="top"
                  overlay={<Tooltip id={`agent-${agent.agentId}`}>{agent.title}</Tooltip>}
                >
                  <Button
                    variant="outline-secondary"
                    className="agent-quick-select-btn"
                    style={{
                      padding: '0.25rem',
                      borderRadius: '8px',
                      border: '1px solid rgba(0, 0, 0, 0.1)',
                      backgroundColor: 'rgba(255, 255, 255, 0.8)',
                      transition: 'all 0.2s ease-in-out',
                      flexShrink: 0,
                    }}
                    onClick={() => onSelectAgent?.(agent)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(75, 0, 125, 0.05)';
                      e.currentTarget.style.borderColor = 'rgba(75, 0, 125, 0.3)';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.08)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
                      e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.1)';
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <AgentAvatar agent={agent} size={36} rounded={true} alt={agent.title} style={{ margin: 0 }} />
                  </Button>
                </OverlayTrigger>
              ))}
            </div>
          </div>
        )}

        {/* Conversation suggestions area - scrollable */}
        <div style={{ maxWidth: 680, width: '100%', flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {suggestionsLoading ? (
            <div
              className="d-flex justify-content-center align-items-center"
              style={{ minHeight: '100px', animation: 'fadeIn 0.3s ease-in-out' }}
            >
              <Spinner animation="border" role="status" size="sm" style={{ color: '#4b007d' }}>
                <span className="visually-hidden">Loading recent conversations...</span>
              </Spinner>
            </div>
          ) : recentConversations.length > 0 ? (
            <div className="conversation-suggestions" style={{ animation: 'fadeIn 0.6s ease-in-out' }}>
              <div
                className="mb-3"
                style={{
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  letterSpacing: '0.025em',
                  textTransform: 'uppercase',
                  color: '#4b007d',
                }}
              >
                Continue where you left off
              </div>
              <div className="d-flex flex-column" style={{ gap: '0.75rem', paddingBottom: '1rem' }}>
                {recentConversations.map((convo) => (
                  <div
                    key={convo.conversation_id}
                    className="text-start conversation-suggestion-btn"
                    role="button"
                    tabIndex={0}
                    style={{
                      padding: '0.75rem 1rem',
                      borderRadius: '10px',
                      border: '1px solid rgba(0, 0, 0, 0.1)',
                      backgroundColor: 'rgba(255, 255, 255, 0.8)',
                      transition: 'all 0.2s ease-in-out',
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      color: '#212529',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.65rem',
                      position: 'relative',
                      cursor: 'pointer',
                    }}
                    onClick={() => handleContinueClick(convo.conversation_id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleContinueClick(convo.conversation_id);
                      }
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(75, 0, 125, 0.05)';
                      e.currentTarget.style.borderColor = 'rgba(75, 0, 125, 0.3)';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.08)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
                      e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.1)';
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <ConversationAvatar convo={convo} />
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {convo.conversationName || 'Untitled Chat'}
                      </div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: '#6c757d',
                          marginTop: '0.2rem',
                        }}
                      >
                        {convo.isAgentConversation && convo.agentTitle
                          ? `${convo.agentTitle} • ${formatRelativeTime(convo.latestTimestamp)}`
                          : formatRelativeTime(convo.latestTimestamp)}
                      </div>
                    </div>
                    {(onRenameConversation || onDeleteConversation) && (
                      <div
                        className="conversation-actions d-flex flex-column align-items-center"
                        style={{
                          gap: '0.25rem',
                        }}
                      >
                        {onRenameConversation && (
                          <OverlayTrigger
                            placement="left"
                            overlay={<Tooltip id={`rename-${convo.conversation_id}`}>Rename</Tooltip>}
                          >
                            <Button
                              variant="link"
                              size="sm"
                              className="p-0 text-secondary"
                              aria-label="Rename conversation"
                              onClick={(e) =>
                                handleRename(e, convo.conversation_id, convo.conversationName || 'Untitled Chat')
                              }
                              style={{ lineHeight: 1 }}
                            >
                              <i className="bi bi-pencil"></i>
                            </Button>
                          </OverlayTrigger>
                        )}
                        {onDeleteConversation && (
                          <OverlayTrigger
                            placement="left"
                            overlay={<Tooltip id={`delete-${convo.conversation_id}`}>Delete</Tooltip>}
                          >
                            <Button
                              variant="link"
                              size="sm"
                              className="p-0 text-danger"
                              aria-label="Delete conversation"
                              onClick={(e) => handleDelete(e, convo.conversation_id)}
                              style={{ lineHeight: 1 }}
                            >
                              <i className="bi bi-trash"></i>
                            </Button>
                          </OverlayTrigger>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

export { NewChat };
