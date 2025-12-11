import type React from 'react'; // for React.DragEvent types
import { Button, Spinner, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { Dispatch, SetStateAction, RefObject, useEffect, useRef, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import { ChatInput } from './ChatInput';
import type { ConversationMeta } from '../../hooks/useChatInactivity';
import numaIcon from '/numa-logo.svg?url';
import { useBranding } from '../../Providers/BrandingContext';
import { useBrandingAsset } from '../../hooks/useBrandingAsset';
import AgentAvatar from '../Agents/AgentAvatar';
import { useAgentById } from '../../hooks/useAgentById';

declare global {
  interface Window {
    /** Set by ChatFileUpload while open — ingest & auto-start (no staging). */
    __ingestAndStart?: (files: File[]) => void;
    /** Fallback cache when modal bridge isn’t ready yet. */
    __pendingFiles?: File[];
  }
}

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
  handleSubmit: (event: FormEvent<unknown> | MouseEvent<HTMLElement>) => void;
  setShowUploadModal: Dispatch<SetStateAction<boolean>>;
  buttonStatus: string;
  webSearchEnabled: boolean;
  setWebSearchEnabled: Dispatch<SetStateAction<boolean>>;
  createAgentEnabled: boolean;
  setCreateAgentEnabled: Dispatch<SetStateAction<boolean>>;
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
  onFilesDropped?: (files: File[]) => void;
  // Multi‑KB selection (optional; when provided, ChatInput will control selection)
  enabledKBIds?: string[];
  setEnabledKBIds?: Dispatch<SetStateAction<string[]>>;
};

// Avatar for recent conversations
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
  return <i className="bi bi-clock-history" style={{ fontSize: '1rem', color: '#6c757d' }} />;
};

const getTimeBasedGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

const formatRelativeTime = (timestamp: number) => {
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

const formatUserName = (name?: string) => {
  if (!name) return '';
  const parts = name.split(/[.\s]+/);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
};

// Helper function to convert hex color to RGB
const hexToRgb = (hex: string): string => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '75, 0, 125';
};

export const NewChat = ({
  inputMessage,
  setInputMessage,
  handleSubmit,
  setShowUploadModal,
  buttonStatus,
  webSearchEnabled,
  setWebSearchEnabled,
  createAgentEnabled,
  setCreateAgentEnabled,
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
  onFilesDropped,
  enabledKBIds,
  setEnabledKBIds,
}: NewChatProps) => {
  // ------- Drag & Drop (no visual change to the page itself) -------
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  // Keep stable function references for add/removeEventListener
  const hasFiles = (e: DragEvent): boolean => {
    const dt = e.dataTransfer;
    return (
      !!dt &&
      (Array.from(dt.types || []).includes('Files') ||
        (dt.items && Array.from(dt.items).some((i) => i.kind === 'file')))
    );
  };

  const blockDefault = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    // Prevent default (so browser doesn’t navigate),
    // but DO NOT stop propagation, so our React handlers still fire.
    e.preventDefault();
  };

  useEffect(() => {
    window.addEventListener('dragenter', blockDefault, { capture: true, passive: false });
    window.addEventListener('dragover', blockDefault, { capture: true, passive: false });
    window.addEventListener('drop', blockDefault, { capture: true, passive: false });

    return () => {
      window.removeEventListener(
        'dragenter',
        blockDefault as EventListener,
        { capture: true } as AddEventListenerOptions,
      );
      window.removeEventListener(
        'dragover',
        blockDefault as EventListener,
        { capture: true } as AddEventListenerOptions,
      );
      window.removeEventListener('drop', blockDefault as EventListener, { capture: true } as AddEventListenerOptions);
    };
  }, []);

  // Optional soft block — only prevent when outside our wrapper
  useEffect(() => {
    const stopIfFilesOutsideWrapper = (e: DragEvent) => {
      const dt = e.dataTransfer;
      const containsFiles =
        !!dt &&
        (Array.from(dt.types || []).includes('Files') ||
          (dt.items && Array.from(dt.items).some((i) => i.kind === 'file')));
      if (!containsFiles) return;

      const path = (e.composedPath?.() || []) as EventTarget[];
      const insideWrapper = wrapperRef.current ? path.includes(wrapperRef.current) : false;

      if (!insideWrapper) {
        e.preventDefault();
        // No stopPropagation — we only care about default nav behavior here
      }
    };

    window.addEventListener('dragover', stopIfFilesOutsideWrapper as EventListener, { passive: false });
    window.addEventListener('drop', stopIfFilesOutsideWrapper as EventListener, { passive: false });

    return () => {
      window.removeEventListener('dragover', stopIfFilesOutsideWrapper as EventListener);
      window.removeEventListener('drop', stopIfFilesOutsideWrapper as EventListener);
    };
  }, []);

  const extractFiles = (dt: DataTransfer | null): File[] => {
    if (!dt) return [];
    if (dt.items && dt.items.length) {
      const out: File[] = [];
      for (const item of Array.from(dt.items)) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f && f.size > 0) out.push(f);
        }
      }
      if (out.length) return out;
    }
    return Array.from(dt.files || []).filter((f) => f.size > 0);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const includesFiles =
      Array.from(e.dataTransfer?.types || []).includes('Files') ||
      (e.dataTransfer?.items && Array.from(e.dataTransfer.items).some((i) => i.kind === 'file'));
    if (!includesFiles) return;
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  };

  // DnD => open modal => inject & auto-start upload
  const routeFiles = (files: File[]) => {
    if (!files.length) return;
    setShowUploadModal(true);

    let tries = 0;
    const maxTries = 300; // ~5s @ 60fps
    const pump = () => {
      const ingest = window.__ingestAndStart;
      if (typeof ingest === 'function') {
        try {
          ingest(files);
          onFilesDropped?.(files);
        } catch {
          // noop
        }
        return;
      }
      if (++tries < maxTries) {
        requestAnimationFrame(pump);
      } else {
        // Fallback cache: modal will flush these once the bridge is ready
        window.__pendingFiles = files;
      }
    };

    // Give the modal a tick to mount before polling
    setTimeout(() => requestAnimationFrame(pump), 0);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    const files = extractFiles(e.dataTransfer);
    routeFiles(files);
  };
  // ------- End DnD -------

  const { branding } = useBranding();
  const rawLogoSrc = branding.resolvedAssets?.logoNav || branding.assets?.logoNav || branding.logo || numaIcon;
  const logoSrc = useBrandingAsset(rawLogoSrc, numaIcon);
  const logoAlt = branding.name || 'Logo';
  const handleContinueClick = (conversationId: string) => {
    hideSuggestions();
    onContinueConversation(conversationId);
  };

  const handleRename = async (e: React.MouseEvent, conversationId: string, currentName: string) => {
    e.stopPropagation();
    if (onRenameConversation) await onRenameConversation(conversationId, currentName);
  };

  const handleDelete = async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    if (onDeleteConversation) await onDeleteConversation(conversationId);
  };

  const formattedName = formatUserName(userName);
  const greeting = formattedName ? `${getTimeBasedGreeting()}, ${formattedName}` : getTimeBasedGreeting();

  return (
    <div
      ref={wrapperRef}
      className="d-flex flex-column h-100 new-chat-wrapper"
      onDragEnterCapture={handleDragEnter}
      onDragOverCapture={handleDragOver}
      onDragLeaveCapture={handleDragLeave}
      onDropCapture={handleDrop}
      data-dragging={isDragging ? 'true' : 'false'}
    >
      {/* Greeting */}
      <div className="new-chat-hero">
        <img src={logoSrc} alt={logoAlt} className="new-chat-logo" />
        <span className="new-chat-greeting-text">{greeting}</span>
      </div>

      <div className="chat-input-wrapper new-chat-input-wrapper" style={{ animation: 'fadeIn 0.8s ease-in-out' }}>
        <ChatInput
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          handleSubmit={handleSubmit}
          setShowUploadModal={setShowUploadModal}
          buttonStatus={buttonStatus}
          webSearchEnabled={webSearchEnabled}
          setWebSearchEnabled={setWebSearchEnabled}
          createAgentEnabled={createAgentEnabled}
          setCreateAgentEnabled={setCreateAgentEnabled}
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
          // Multi‑KB selection forwarded from parent when provided
          enabledKBIds={enabledKBIds || []}
          setEnabledKBIds={setEnabledKBIds}
          dropdownDirection="down" // New chat hero sits higher; open menus downward to avoid clipping
        />
      </div>

      {/* Personal Agents Row */}
      {personalAgents.length > 0 && (
        <div
          className="agents-row-container"
          style={{
            width: '100%',
            maxWidth: '1200px',
            marginLeft: 'auto',
            marginRight: 'auto',
            marginBottom: '1rem',
            animation: 'fadeIn 0.6s ease-in-out',
          }}
        >
          {_agentsLoading ? (
            <div className="d-flex justify-content-center align-items-center" style={{ minHeight: 80 }}>
              <Spinner animation="border" role="status" size="sm" style={{ color: 'var(--brand-primary, #4b007d)' }}>
                <span className="visually-hidden">Loading agents...</span>
              </Spinner>
            </div>
          ) : (
            <div className="agents-horizontal-scroll">
              <div
                className="d-flex align-items-center"
                style={{ gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}
              >
                {personalAgents.map((agent) => (
                  <OverlayTrigger
                    key={agent.agentId}
                    placement="top"
                    overlay={<Tooltip id={`agent-${agent.agentId}`}>{agent.title}</Tooltip>}
                  >
                    <div
                      className="agent-icon-wrapper"
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectAgent?.(agent)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectAgent?.(agent);
                        }
                      }}
                      style={{
                        cursor: 'pointer',
                        transition: 'all 0.2s ease-in-out',
                        transform: 'scale(1)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'scale(1.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'scale(1)';
                      }}
                    >
                      <AgentAvatar agent={agent} size={48} rounded={true} alt={agent.title} />
                    </div>
                  </OverlayTrigger>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Conversation History */}
      {suggestionsLoading || recentConversations.length > 0 ? (
        <div
          className="history-panel-fullwidth"
          style={{
            width: '100%',
            position: 'relative',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div className="history-inner">
            <div className="suggestions-header static-header">Continue where you left off</div>
          </div>
          {suggestionsLoading ? (
            <div
              className="d-flex justify-content-center align-items-center history-scroll"
              style={{ minHeight: 100, animation: 'fadeIn 0.3s ease-in-out' }}
            >
              <Spinner animation="border" role="status" size="sm" style={{ color: 'var(--brand-primary, #4b007d)' }}>
                <span className="visually-hidden">Loading recent conversations...</span>
              </Spinner>
            </div>
          ) : recentConversations.length > 0 ? (
            <div className="conversation-suggestions history-scroll">
              <div className="history-inner">
                <div className="d-flex flex-column" style={{ gap: '0.75rem', paddingBottom: '0.75rem' }}>
                  {recentConversations.map((convo) => (
                    <div
                      key={convo.conversation_id}
                      className="text-start conversation-suggestion-btn"
                      role="button"
                      tabIndex={0}
                      onClick={() => handleContinueClick(convo.conversation_id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleContinueClick(convo.conversation_id);
                        }
                      }}
                      onMouseEnter={(e) => {
                        const primaryColor =
                          getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim() ||
                          '75, 0, 125';
                        const rgb = primaryColor.startsWith('#') ? hexToRgb(primaryColor) : primaryColor;
                        e.currentTarget.style.backgroundColor = `rgba(${rgb}, 0.05)`;
                        e.currentTarget.style.borderColor = `rgba(${rgb}, 0.3)`;
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.8)';
                        e.currentTarget.style.borderColor = 'rgba(0,0,0,0.1)';
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <ConversationAvatar convo={convo} />
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {convo.conversationName || 'Untitled Chat'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#6c757d', marginTop: '0.2rem' }}>
                          {convo.isAgentConversation && convo.agentTitle
                            ? `${convo.agentTitle} • ${formatRelativeTime(convo.latestTimestamp)}`
                            : formatRelativeTime(convo.latestTimestamp)}
                        </div>
                      </div>
                      {(onRenameConversation || onDeleteConversation) && (
                        <div
                          className="conversation-actions d-flex flex-column align-items-center"
                          style={{ gap: '0.25rem' }}
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
                                <i className="bi bi-pencil" />
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
                                <i className="bi bi-trash" />
                              </Button>
                            </OverlayTrigger>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default NewChat;
