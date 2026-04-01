import React, { Dispatch, SetStateAction, RefObject, useEffect, useRef, useState, memo } from 'react';
import { Button, Spinner, OverlayTrigger, Tooltip, Nav } from 'react-bootstrap';
import type { FormEvent, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { ChatInput, ChatInputVariant } from './ChatInput';
import { ChatSettingsPanel } from './ChatSettingsPanel';
import { PendingFilesBar } from './PendingFilesBar';
import { QuickActionsRow } from './QuickActionsRow';
import type { ConversationMeta } from '../../hooks/useChatInactivity';
import type { WorkspaceChatModelId, StagedItem, UploadingFile } from '../../types/workspaceChatTypes';
import type { QuickActionConfig } from '../../config/quickActionsConfig';
import numaIcon from '/numa-logo.svg?url';
import { useBranding } from '../../Providers/BrandingContext';
import { useBrandingAsset } from '../../hooks/useBrandingAsset';
import AgentAvatar from '../Agents/AgentAvatar';
import { useAgentById } from '../../hooks/useAgentById';

/** NewChat variant - 'v1' shows inline settings, 'v2' relies on external settings panel */
export type NewChatVariant = 'v1' | 'v2';

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

type KnowledgeBase = {
  kb_id: string;
  kb_name: string;
  role?: string;
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
  dataAnalysisEnabled: boolean;
  setDataAnalysisEnabled: Dispatch<SetStateAction<boolean>>;
  dataAnalysisAvailable?: boolean;
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
  onContinueConversation: (conversationId: string, isWorkspaceConversation?: boolean) => void;
  suggestionsLoading: boolean;
  userName?: string;
  onRenameConversation?: (conversationId: string, currentName: string) => Promise<void>;
  onDeleteConversation?: (conversationId: string) => Promise<void>;
  personalAgents?: AgentSummary[];
  onSelectAgent?: (agent: AgentSummary) => void;
  agentsLoading?: boolean;
  uploadDisabledReason?: string;
  onFilesDropped?: (files: File[]) => void;
  // Multi‑KB selection (optional; when provided, ChatInput will control selection)
  enabledKBIds?: string[];
  setEnabledKBIds?: Dispatch<SetStateAction<string[]>>;
  // For ChatSettingsPanel
  availableKBs?: KnowledgeBase[];
  isLoadingKBs?: boolean;
  agentsFeatureEnabled?: boolean;
  dataAnalysisBanner?: React.ReactNode;
  onStop?: () => void;
  isStopping?: boolean;
  // V2 variant props (for workspace chat)
  /** Layout variant: 'v1' (default) shows inline settings, 'v2' relies on external settings panel */
  variant?: NewChatVariant;
  /** Callback when settings button is clicked (V2 only) */
  onSettingsClick?: () => void;
  /** Whether settings panel is currently open (V2 only) */
  isSettingsPanelOpen?: boolean;
  /** Whether settings panel has active selections (V2 only) */
  hasActiveSettings?: boolean;
  // Model selector props (V2 only)
  /** Currently selected model ID for workspace chat */
  selectedModelId?: WorkspaceChatModelId;
  /** Callback to change the selected model */
  setSelectedModelId?: (id: WorkspaceChatModelId) => void;
  /** Whether to show the model selector (V2 only) */
  showModelSelector?: boolean;
  // Staged files display props (V2 only - for pre-minted conversations)
  /** Files staged for upload before first message is sent */
  stagedItems?: StagedItem[];
  /** Callback to remove a staged item */
  onRemoveStagedItem?: (item: StagedItem) => Promise<void>;
  // Quick actions props (V2 only)
  /** Callback when a quick action button is clicked */
  onQuickAction?: (action: QuickActionConfig) => void;
  /** Set of connected integration IDs for conditional quick actions */
  connectedIntegrations?: Set<string>;
  /** Callback to open the full history sidebar (V2 only) */
  onOpenHistory?: () => void;
  /** Callback to open the agents sidebar (V2 only) */
  onOpenAgents?: () => void;
  /** Files currently being uploaded via drag-and-drop (V2 only) */
  uploadingFiles?: UploadingFile[];
  /** Cancel an in-progress upload (V2 only) */
  onCancelUpload?: (id: string) => void;
};

// Avatar for recent conversations
const ConversationAvatar = ({
  convo,
  variant = 'v1',
}: {
  convo: {
    isAgentConversation?: boolean;
    agentId?: string | null;
    agentIcon?: string | null;
    agentTitle?: string | null;
  };
  variant?: 'v1' | 'v2';
}) => {
  const { t } = useTranslation('chat');
  const { agent } = useAgentById(convo.agentId || undefined);

  if (variant === 'v2') {
    return <i className="bi bi-chat-square-text" aria-hidden="true" />;
  }

  if (convo.isAgentConversation) {
    return (
      <AgentAvatar
        agent={agent}
        icon={convo.agentIcon || undefined}
        size={32}
        rounded={true}
        alt={convo.agentTitle || t('newChat.agentFallback')}
      />
    );
  }
  return <i className="bi bi-clock-history" style={{ fontSize: '1rem', color: '#6c757d' }} />;
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

const NewChat = ({
  inputMessage,
  setInputMessage,
  handleSubmit,
  setShowUploadModal,
  buttonStatus,
  webSearchEnabled,
  setWebSearchEnabled,
  createAgentEnabled,
  setCreateAgentEnabled,
  dataAnalysisEnabled,
  setDataAnalysisEnabled,
  dataAnalysisAvailable = true,
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
  onSelectAgent: _onSelectAgent,
  agentsLoading: _agentsLoading = false,
  uploadDisabledReason = '',
  onFilesDropped,
  enabledKBIds,
  setEnabledKBIds,
  availableKBs = [],
  isLoadingKBs = false,
  agentsFeatureEnabled = false,
  dataAnalysisBanner,
  onStop,
  isStopping = false,
  // V2 variant props
  variant = 'v1',
  onSettingsClick,
  isSettingsPanelOpen = false,
  hasActiveSettings = false,
  // Model selector props
  selectedModelId,
  setSelectedModelId,
  showModelSelector = false,
  // Staged files props
  stagedItems = [],
  onRemoveStagedItem,
  // Quick actions props
  onQuickAction,
  connectedIntegrations = new Set<string>(),
  onOpenHistory,
  onOpenAgents,
  uploadingFiles = [],
  onCancelUpload,
}: NewChatProps) => {
  const { t } = useTranslation('chat');
  // ------- Mobile detection and tab state -------
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
  const [activeTab, setActiveTab] = useState<'settings' | 'history'>('settings');

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
        { capture: true } as AddEventListenerOptions
      );
      window.removeEventListener(
        'dragover',
        blockDefault as EventListener,
        { capture: true } as AddEventListenerOptions
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
  const logoAlt = branding.name || t('newChat.logoAltFallback');
  const handleContinueClick = (conversationId: string, isWorkspaceConversation?: boolean) => {
    hideSuggestions();
    onContinueConversation(conversationId, isWorkspaceConversation);
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
  const getTimeBasedGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('newChat.greeting.morning');
    if (hour < 18) return t('newChat.greeting.afternoon');
    return t('newChat.greeting.evening');
  };
  const greetingBase = getTimeBasedGreeting();
  const greeting =
    variant === 'v2'
      ? t('newChat.greeting.hiThere')
      : formattedName
        ? t('newChat.greeting.withName', { greeting: greetingBase, name: formattedName })
        : greetingBase;
  const formatRelativeTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return t('newChat.relativeTime.justNow');
    if (minutes < 60) return t('newChat.relativeTime.minutesAgo', { count: minutes });
    if (hours < 24) return t('newChat.relativeTime.hoursAgo', { count: hours });
    if (days === 1) return t('newChat.relativeTime.yesterday');
    if (days < 7) return t('newChat.relativeTime.daysAgo', { count: days });
    return new Date(timestamp).toLocaleDateString(i18n.language);
  };

  const inputComposer = (
    <div className="chat-input-wrapper new-chat-input-wrapper" style={{ animation: 'fadeIn 0.8s ease-in-out' }}>
      {dataAnalysisBanner}
      {/* Show pending/uploading files indicator for pre-minted conversations (V2) */}
      {variant === 'v2' && (stagedItems.length > 0 || uploadingFiles.length > 0) && onRemoveStagedItem && (
        <PendingFilesBar
          items={stagedItems}
          onRemove={onRemoveStagedItem}
          uploadingFiles={uploadingFiles}
          onCancelUpload={onCancelUpload}
        />
      )}
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
        dataAnalysisEnabled={dataAnalysisEnabled}
        setDataAnalysisEnabled={setDataAnalysisEnabled}
        dataAnalysisAvailable={dataAnalysisAvailable}
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
        placeholderOverride={variant === 'v2' ? t('input.placeholderV2') : t('newChat.placeholder')}
        // Multi‑KB selection forwarded from parent when provided
        enabledKBIds={enabledKBIds || []}
        setEnabledKBIds={setEnabledKBIds}
        dropdownDirection="down" // New chat hero sits higher; open menus downward to avoid clipping
        uploadDisabledReason={uploadDisabledReason}
        onStop={onStop}
        isStopping={isStopping}
        // V2 variant props
        variant={variant as ChatInputVariant}
        onSettingsClick={onSettingsClick}
        isSettingsPanelOpen={isSettingsPanelOpen}
        hasActiveSettings={hasActiveSettings}
        // Model selector props
        selectedModelId={selectedModelId}
        setSelectedModelId={setSelectedModelId}
        showModelSelector={showModelSelector}
        onPasteFiles={onFilesDropped}
      />
    </div>
  );

  // For v2 (workspace chat), drag-and-drop is handled at the page level (chat-left-pane).
  // Only v1 needs NewChat-level drag handlers.
  const dragHandlers =
    variant === 'v2'
      ? {}
      : {
          onDragEnterCapture: handleDragEnter,
          onDragOverCapture: handleDragOver,
          onDragLeaveCapture: handleDragLeave,
          onDropCapture: handleDrop,
        };

  return (
    <div
      ref={wrapperRef}
      className={`d-flex flex-column h-100 new-chat-wrapper ${variant === 'v2' ? 'new-chat-wrapper-v2' : ''}`}
      {...dragHandlers}
      data-dragging={isDragging ? 'true' : 'false'}
    >
      {/* Greeting */}
      <div className="new-chat-hero">
        <div className="new-chat-logo-shell">
          <img src={logoSrc} alt={logoAlt} className="new-chat-logo" />
        </div>
        <span className="new-chat-greeting-text">{greeting}</span>
      </div>

      {/* Quick Actions Row - V2 only */}
      {variant === 'v2' && onQuickAction && (
        <QuickActionsRow
          onQuickAction={onQuickAction}
          webSearchEnabled={webSearchEnabled || autoToolsEnabled}
          kbEnabled={(enabledKBIds?.length ?? 0) > 0}
          agentsEnabled={agentsFeatureEnabled}
          connectedIntegrations={connectedIntegrations}
          disabled={buttonStatus === 'streaming' || uploadsInProgress}
          maxVisible={isMobile ? 4 : 9}
        />
      )}

      {variant !== 'v2' && inputComposer}

      {/* Settings Panel and Conversation History */}
      {(() => {
        const isDisabled = buttonStatus === 'streaming' || uploadsInProgress;

        // Settings Panel Content (V1 only - V2 uses right side panel)
        const settingsPanelContent =
          variant === 'v1' ? (
            <ChatSettingsPanel
              autoToolsEnabled={autoToolsEnabled}
              setAutoToolsEnabled={setAutoToolsEnabled}
              webSearchEnabled={webSearchEnabled}
              setWebSearchEnabled={setWebSearchEnabled}
              createAgentEnabled={createAgentEnabled}
              setCreateAgentEnabled={setCreateAgentEnabled}
              dataAnalysisEnabled={dataAnalysisEnabled}
              setDataAnalysisEnabled={setDataAnalysisEnabled}
              dataAnalysisAvailable={dataAnalysisAvailable}
              agentsFeatureEnabled={agentsFeatureEnabled}
              enabledKBIds={enabledKBIds || []}
              setEnabledKBIds={setEnabledKBIds || (() => {})}
              availableKBs={availableKBs}
              isLoadingKBs={isLoadingKBs}
              enabledConnections={enabledConnections}
              setEnabledConnections={setEnabledConnections}
              availableConnections={availableConnections}
              connectionsLoading={connectionsLoading}
              hasPipedreamFeature={hasPipedreamFeature}
              isDisabled={isDisabled}
            />
          ) : null;

        // History Panel Content
        const historyPanelContent = (
          <div
            className="history-panel-content"
            style={{
              width: '100%',
              position: 'relative',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            {/* Only show internal header for non-V2 (mobile/V1) - V2 has its own external header */}
            {variant !== 'v2' && (
              <div className="history-inner">
                <div className="suggestions-header static-header">{t('newChat.continue')}</div>
              </div>
            )}
            {suggestionsLoading ? (
              <div
                className="d-flex justify-content-center align-items-center history-scroll"
                style={{ minHeight: 100, animation: 'fadeIn 0.3s ease-in-out' }}
              >
                <Spinner animation="border" role="status" size="sm" style={{ color: 'var(--brand-primary, #4b007d)' }}>
                  <span className="visually-hidden">{t('newChat.loadingRecent')}</span>
                </Spinner>
              </div>
            ) : recentConversations.length > 0 ? (
              <div className="conversation-suggestions" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                <div className="d-flex flex-column" style={{ gap: '0.75rem', paddingBottom: '0.75rem' }}>
                  {(variant === 'v2' ? recentConversations.slice(0, 3) : recentConversations).map((convo) => (
                    <div
                      key={convo.conversation_id}
                      className="text-start conversation-suggestion-btn"
                      role="button"
                      tabIndex={0}
                      onClick={() => handleContinueClick(convo.conversation_id, convo.isWorkspaceConversation)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleContinueClick(convo.conversation_id, convo.isWorkspaceConversation);
                        }
                      }}
                      onMouseEnter={(e) => {
                        if (variant === 'v2') return;
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
                        if (variant === 'v2') return;
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.8)';
                        e.currentTarget.style.borderColor = 'rgba(0,0,0,0.1)';
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <div className="conversation-suggestion-icon-shell">
                        <ConversationAvatar convo={convo} variant={variant} />
                      </div>
                      <div className="conversation-suggestion-meta" style={{ flex: 1, overflow: 'hidden' }}>
                        <div className="conversation-suggestion-title">
                          {convo.conversationName || t('newChat.untitled')}
                        </div>
                        <div className="conversation-suggestion-subtitle">
                          {convo.isAgentConversation && convo.agentTitle
                            ? `${convo.agentTitle} • ${formatRelativeTime(convo.latestTimestamp)}`
                            : formatRelativeTime(convo.latestTimestamp)}
                        </div>
                      </div>
                      {variant === 'v2' ? (
                        <i className="bi bi-chevron-right conversation-suggestion-arrow" aria-hidden="true" />
                      ) : (
                        (onRenameConversation || onDeleteConversation) && (
                          <div
                            className="conversation-actions d-flex flex-column align-items-center"
                            style={{ gap: '0.25rem' }}
                          >
                            {onRenameConversation && (
                              <OverlayTrigger
                                placement="left"
                                overlay={
                                  <Tooltip id={`rename-${convo.conversation_id}`}>{t('newChat.renameTooltip')}</Tooltip>
                                }
                              >
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="p-0 text-secondary"
                                  aria-label={t('newChat.renameAria')}
                                  onClick={(e) =>
                                    handleRename(
                                      e,
                                      convo.conversation_id,
                                      convo.conversationName || t('newChat.untitled')
                                    )
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
                                overlay={
                                  <Tooltip id={`delete-${convo.conversation_id}`}>{t('newChat.deleteTooltip')}</Tooltip>
                                }
                              >
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="p-0 text-danger"
                                  aria-label={t('newChat.deleteAria')}
                                  onClick={(e) => handleDelete(e, convo.conversation_id)}
                                  style={{ lineHeight: 1 }}
                                >
                                  <i className="bi bi-trash" />
                                </Button>
                              </OverlayTrigger>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  ))}
                  {variant === 'v2' &&
                    (recentConversations.length > 3 || (personalAgents.length > 0 && onOpenAgents)) && (
                      <div className="open-panel-buttons">
                        {recentConversations.length > 3 && onOpenHistory && (
                          <button type="button" className="open-history-btn" onClick={onOpenHistory}>
                            <i className="bi bi-clock-history" aria-hidden="true" />
                            {t('newChat.openHistory')}
                          </button>
                        )}
                        {personalAgents.length > 0 && onOpenAgents && (
                          <button type="button" className="open-history-btn" onClick={onOpenAgents}>
                            <i className="bi bi-robot" aria-hidden="true" />
                            {t('newChat.openAgents')}
                          </button>
                        )}
                      </div>
                    )}
                </div>
              </div>
            ) : (
              <div className="d-flex align-items-center justify-content-center history-scroll">
                <div className="text-muted text-center py-3">{t('newChat.noRecent')}</div>
              </div>
            )}
          </div>
        );

        // Mobile Layout: Tabs (V1 only shows both tabs, V2 only shows history)
        if (isMobile) {
          // V2: Just show history content directly (settings in right panel)
          if (variant === 'v2') {
            return (
              <div
                className="new-chat-content-area"
                style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              >
                {historyPanelContent}
              </div>
            );
          }

          // V1: Show tabs for settings and history
          return (
            <div
              className="new-chat-content-area"
              style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            >
              <Nav variant="pills" className="new-chat-tabs justify-content-center mb-3">
                <Nav.Item>
                  <Nav.Link
                    active={activeTab === 'settings'}
                    onClick={() => setActiveTab('settings')}
                    className="new-chat-tab-link"
                  >
                    <i className="bi bi-sliders me-1" /> {t('newChat.tabs.settings')}
                  </Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link
                    active={activeTab === 'history'}
                    onClick={() => setActiveTab('history')}
                    className="new-chat-tab-link"
                  >
                    <i className="bi bi-clock-history me-1" /> {t('newChat.tabs.history')}
                    {recentConversations.length > 0 && (
                      <span className="badge bg-secondary ms-1">{recentConversations.length}</span>
                    )}
                  </Nav.Link>
                </Nav.Item>
              </Nav>
              <div
                className="new-chat-tab-content"
                style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
              >
                {activeTab === 'settings' && (
                  <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>{settingsPanelContent}</div>
                )}
                {activeTab === 'history' && (
                  <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    {historyPanelContent}
                  </div>
                )}
              </div>
            </div>
          );
        }

        // Desktop Layout: Two Columns (V1) or Single Column (V2)
        // V2: Just show history centered (settings in right panel)
        if (variant === 'v2') {
          return (
            <div className="new-chat-desktop-layout new-chat-desktop-layout-v2">
              <div className="new-chat-desktop-column history-column history-column-v2">
                <div className="suggestions-header-v2">
                  <i className="bi bi-clock-history" aria-hidden="true" />
                  <span>{t('newChat.continue')}</span>
                </div>
                <div className="new-chat-desktop-scroll conversation-suggestions">{historyPanelContent}</div>
              </div>
            </div>
          );
        }

        // V1: Two column layout
        return (
          <div className="new-chat-desktop-layout">
            <div className="new-chat-desktop-column settings-column">
              <div className="suggestions-header static-header mb-2">{t('newChat.chatSettings')}</div>
              <div className="new-chat-desktop-scroll">{settingsPanelContent}</div>
            </div>
            <div className="new-chat-desktop-column history-column">
              <div className="suggestions-header static-header mb-2">{t('newChat.continue')}</div>
              <div className="new-chat-desktop-scroll conversation-suggestions">
                {suggestionsLoading ? (
                  <div
                    className="d-flex justify-content-center align-items-center"
                    style={{ minHeight: 100, animation: 'fadeIn 0.3s ease-in-out' }}
                  >
                    <Spinner
                      animation="border"
                      role="status"
                      size="sm"
                      style={{ color: 'var(--brand-primary, #4b007d)' }}
                    >
                      <span className="visually-hidden">{t('newChat.loadingRecent')}</span>
                    </Spinner>
                  </div>
                ) : recentConversations.length > 0 ? (
                  <div className="d-flex flex-column" style={{ gap: '0.75rem' }}>
                    {recentConversations.map((convo) => (
                      <div
                        key={convo.conversation_id}
                        className="text-start conversation-suggestion-btn"
                        role="button"
                        tabIndex={0}
                        onClick={() => handleContinueClick(convo.conversation_id, convo.isWorkspaceConversation)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleContinueClick(convo.conversation_id, convo.isWorkspaceConversation);
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
                          <div className="conversation-suggestion-title">
                            {convo.conversationName || t('newChat.untitled')}
                          </div>
                          <div className="conversation-suggestion-subtitle">
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
                                overlay={
                                  <Tooltip id={`rename-${convo.conversation_id}`}>{t('newChat.renameTooltip')}</Tooltip>
                                }
                              >
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="p-0 text-secondary"
                                  aria-label={t('newChat.renameAria')}
                                  onClick={(e) =>
                                    handleRename(
                                      e,
                                      convo.conversation_id,
                                      convo.conversationName || t('newChat.untitled')
                                    )
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
                                overlay={
                                  <Tooltip id={`delete-${convo.conversation_id}`}>{t('newChat.deleteTooltip')}</Tooltip>
                                }
                              >
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="p-0 text-danger"
                                  aria-label={t('newChat.deleteAria')}
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
                ) : (
                  <div className="text-muted text-center py-3">{t('newChat.noRecent')}</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {variant === 'v2' && inputComposer}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

// Memoize to prevent re-renders when parent state changes but NewChat props haven't
const MemoizedNewChat = memo(NewChat);
MemoizedNewChat.displayName = 'NewChat';

export { MemoizedNewChat as NewChat };
export default MemoizedNewChat;
