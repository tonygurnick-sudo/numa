import { useState, useRef, useEffect, useMemo, useCallback, type ReactNode, type SetStateAction } from 'react';
import { Button, Alert, Modal, Collapse } from 'react-bootstrap';
import { Bot, Clock, Plus, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../Providers/AuthProvider';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { getFlag } from '../utils/featureFlags';
import { PageHeader } from '../Components/PageHeader';
import { ChatHistorySidebar, type ChatHistorySidebarRef } from '../Components/Chat/ChatHistorySidebar';
import { AgentAvatar } from '../Components/Agents/AgentAvatar';
import { ChatInput } from '../Components/Chat/ChatInput';
import { ExportConversationButton } from '../Components/Chat/ExportConversationButton';
import { ChatMessages } from '../Components/Chat/ChatMessages';
import { useShowChatCost } from '../hooks/useShowChatCost';
import { NewChat } from '../Components/Chat/NewChat';
import { MarkdownContent } from '../Components/Renderers/MarkdownContent';
import ResizableSplitView from '../Components/ResizableSplitView';
import { generateSystemPrompt, getEnabledTools } from '../utils/chatSystemPromptUtils';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { ConnectorsService } from '../Services/ConnectorsService';
import { DataConnectorsService } from '../Services/DataConnectorsService';
import { AdminIntegrationsService } from '../Services/AdminIntegrationsService';
import {
  connectorSlugForPipedream,
  pipedreamSlugForConnector,
} from '../Components/Integrations/integrationCatalogHelpers';
import { getConnectorById, surfacesInFiles } from '../Components/DataConnectors/connectorRegistry';
import { getModelId, MODEL_TYPES, isInFallbackMode } from '../utils/bedrockModelConfig';
// Note: streamingProcessors imports moved to useWorkspaceStreaming hook
import { loadConversation } from '../utils/conversationLoader';
import { useConversationManager } from '../hooks/useConversationManager';
import { useStreamingHandler } from '../hooks/useStreamingHandler';
import { useDocumentProcessor } from '../hooks/useDocumentProcessor';
import { useFilePreviewProcessor } from '../hooks/useFilePreviewProcessor';
import { FilePreviewPanel } from '../Components/FilePreviewPanel';
import { autoNameConversation } from '../utils/autoChatTitle';
import { useChatInactivity } from '../hooks/useChatInactivity';
import { getChatDraft, setChatDraft, subscribeChatDraft, useChatDraftValue } from '../hooks/useChatDraft';
import { useWorkspaceChatStreaming } from '../hooks/useWorkspaceChatStreaming';
import { markProcessingStart, notifyCompletion } from '../hooks/useBrowserNotification';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useDrawerBackClose } from '../hooks/useDrawerBackClose';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import { useConfirm, usePrompt } from '../Providers/ConfirmContext';
import type { AgentSummary } from '../types/agents';
import { getAgent, listAgents } from '../Services/AgentsService';
import { getConnectionConfig } from '../config/integrationsConfig';
import type { QuickActionConfig } from '../config/quickActionsConfig';
import { sortAgentsByPriority } from '../utils/agentSortingUtils';
import { AdminAgentsService, type AgentsMode } from '../Services/AdminAgentsService';
import {
  ChatSettingsService,
  type ChatSettings,
  type ChatScrollMode,
  DEFAULT_CHAT_SETTINGS,
} from '../Services/ChatSettingsService';
import { JumpToLatestButton } from '../Components/WorkspaceChat/JumpToLatestButton';
// Workspace chat mode imports
import {
  getWorkspaceChatRawTrace,
  checkConversationStatus,
  pollConversationUntilComplete,
} from '../Services/workspaceChatAgentService';
import { parseRawTraceToMessages } from '../utils/workspaceChatEventHandlers';
// Note: SDK event handling moved to useWorkspaceChatStreaming hook
import { WorkspaceChatFileUpload } from '../Components/WorkspaceChat/WorkspaceChatFileUpload';
import {
  WorkspaceChatHistoryPanel,
  type WorkspaceChatHistoryPanelRef,
} from '../Components/WorkspaceChat/WorkspaceChatHistoryPanel';
import { WorkspaceChatSettingsPanel } from '../Components/WorkspaceChat/WorkspaceChatSettingsPanel';
import { WorkspaceChatAgentsPanel } from '../Components/WorkspaceChat/WorkspaceChatAgentsPanel';
import { ChatHealthIndicators } from '../Components/WorkspaceChat/ChatHealth/ChatHealthIndicators';
import { ChatValueIndicator } from '../Components/WorkspaceChat/ChatValue/ChatValueIndicator';
import { ChatHealthBanner } from '../Components/WorkspaceChat/ChatHealth/ChatHealthBanner';
import { ChatHealthTopBar } from '../Components/WorkspaceChat/ChatHealth/ChatHealthTopBar';
import { useChatHealth } from '../Components/WorkspaceChat/ChatHealth/useChatHealth';
import { useWorkspaceChatSettingsPanel } from '../hooks/useWorkspaceChatSettingsPanel';
import { PendingFilesBar } from '../Components/Chat/PendingFilesBar';
import { QueuedSubmitBanner } from '../Components/Chat/QueuedSubmitBanner';
import { ChatSuggestionPills } from '../Components/Chat/ChatSuggestionPills';
import { useChatSuggestions } from '../hooks/useChatSuggestions';
import { deleteWorkspaceChatUploads, uploadWorkspaceChatFileDirect } from '../Services/workspaceChatAgentService';
import {
  ASK_NUMA_PRESELECT_TOKEN,
  CONVERSATION_AGENT_TYPE_KEY_PREFIX,
  hydrateAskNumaNewTabHandoff,
} from '../Components/AskNuma/askNumaHandoff';
import { SUPPORT_AGENT_TYPE, SUPPORT_KB_ID } from '../Components/Support/SupportNumaPopup';
import { SUPPORT_EMAIL_INTEGRATION_SLUGS } from '../Components/Support/supportIntegrations';
import {
  loadStagedItems,
  saveStagedItems,
  clearStagedItems,
  groupFilesIntoFolders,
  flattenStagedItems,
  getPathsFromStagedItem,
  cleanupOldStagedUploads,
  extractFolderMetadata,
} from '../utils/workspaceChatStagedUploads';
import type {
  IntegrationListItem,
  StagedItem,
  StagedFile,
  UploadingFile,
  WorkspaceChatUploadResponse,
  WorkspaceChatModelId,
  WorkspaceChatMessage,
} from '../types/workspaceChatTypes';
import { DEFAULT_WORKSPACE_MODEL } from '../types/workspaceChatTypes';
import { expandMyFilesSentinel } from '../constants/knowledgeBase';
import { downloadFileFromS3 } from '../utils/s3Utils';

type ConversationChatConfig = {
  autoToolsEnabled?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
  memoriesEnabled?: boolean;
  numaOpsEnabled?: boolean;
  /** Legacy whole-feature toggle for native data connectors. Replaced by
   *  per-row enable list (`enabledNativeConnectorIds`); kept on the type
   *  so we can read old persisted configs without TS errors. */
  dataConnectorsEnabled?: boolean;
  enabledKBIds?: string[];
  enabledConnectionIds?: string[];
  /** Per-chat enable list for native connectors (mirror of
   *  enabledConnectionIds for Pipedream). */
  enabledNativeConnectorIds?: string[];
};

// Hoisted so the prop is referentially stable (BUG-194: an inline `{{}}` defeated
// React.memo on ChatMessages on every keystroke)
const EMPTY_LOADING_INDICATOR_STYLE = {};

// Draft-connected input components (BUG-194). The input draft lives in an
// external store (useChatDraft.ts) so only these small wrappers re-render on
// keystrokes instead of the entire page component. All other props pass
// through from the page unchanged.
const NewChatWithDraft = (props: Omit<React.ComponentProps<typeof NewChat>, 'inputMessage' | 'setInputMessage'>) => {
  const draft = useChatDraftValue();
  return <NewChat {...props} inputMessage={draft} setInputMessage={setChatDraft} />;
};

const ChatInputWithDraft = (
  props: Omit<React.ComponentProps<typeof ChatInput>, 'inputMessage' | 'setInputMessage'>
) => {
  const draft = useChatDraftValue();
  return <ChatInput {...props} inputMessage={draft} setInputMessage={setChatDraft} />;
};

const resolveErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return fallback;
};

// Support conversations always need the KB and web-search toggles on so the
// support agent can query the Numa Support knowledge base regardless of the
// user's chat-settings defaults (the backend restricts WHICH KBs it sees;
// these toggles control WHETHER KB/search operations are allowed at all).
const ensureToolsForAgentType = (enabledTools: string[], agentType?: string | null): string[] =>
  agentType === SUPPORT_AGENT_TYPE
    ? Array.from(new Set([...enabledTools, 'knowledge_base', 'web_search']))
    : enabledTools;

// Resolve the workspace agent type pinned to a conversation (set when the
// conversation is started from the Support popup). Null = default numa-chat.
const getConversationAgentType = (conversationId?: string | null): string | undefined => {
  if (!conversationId) return undefined;
  try {
    return sessionStorage.getItem(`${CONVERSATION_AGENT_TYPE_KEY_PREFIX}${conversationId}`) || undefined;
  } catch {
    return undefined;
  }
};

const NumaWorkspaceChatAgents = () => {
  // New-tab handoff (Support popup "open in new tab"): when this page is opened
  // in a fresh tab via /chat?askNuma=<cid>, the originating tab's sessionStorage
  // isn't available. Rehydrate the sessionStorage handoff from the URL +
  // localStorage NOW — synchronously, before useConversationManager reads it in
  // its state initialiser below. Guarded to run once. No-op for normal loads.
  const newTabHandoffRef = useRef(false);
  if (!newTabHandoffRef.current) {
    newTabHandoffRef.current = true;
    hydrateAskNumaNewTabHandoff();
  }

  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const { t: tSupport } = useTranslation('support');
  const confirm = useConfirm();
  const prompt = usePrompt();
  // Basic UI state
  const [messages, setMessages] = useState([]);

  // Dev-only running cost total for the current chat. Gated by the
  // DEVELOPER_MODE client flag AND the user toggle. Never displayed otherwise.
  const [showChatCost] = useShowChatCost();
  const showCostTotal = getFlag('DEVELOPER_MODE') && showChatCost;
  // In-chat credit-tier indicator (Numa Credit System). Same visibility gate as the in-app Credits
  // view; shown to all users (not just admins) so everyone sees their chat's credit tier.
  const creditsIndicatorEnabled = getFlag('SHOW_CREDITS');
  const chatCostTotal = useMemo(
    () =>
      (messages as Array<{ costUsd?: number }>).reduce(
        (sum, m) => sum + (typeof m.costUsd === 'number' ? m.costUsd : 0),
        0
      ),
    [messages]
  );
  // Input draft lives in an external store (see useChatDraft.ts) so keystrokes
  // don't re-render this whole page component (BUG-194). Read imperatively via
  // getChatDraft(); the input components subscribe through ChatDraftConsumer.
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [stagedItems, setStagedItems] = useState<StagedItem[]>([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [createAgentEnabled, setCreateAgentEnabled] = useState(false);
  const [memoriesEnabled, setMemoriesEnabled] = useState(true);
  const [numaOpsEnabled, setNumaOpsEnabled] = useState(false);
  const [numaOpsFeatureEnabled] = useState(() => getFlag('NUMA_OPS'));
  const [availableConnections, setAvailableConnections] = useState<
    Array<{
      id: string;
      name: string;
      isConnected: boolean;
      mcpServerUrl?: string;
      // FEAT-019: per-app multi-account metadata. allowMultipleAccounts mirrors
      // the admin global setting; accounts is the full list from the proxy
      // (empty for not-connected apps, length 1 for single-account apps,
      // length >1 only when admin opted in AND user added a second account).
      allowMultipleAccounts: boolean;
      accounts: Array<{ account_id: string; name?: string | null; healthy?: boolean | null; dead?: boolean | null }>;
    }>
  >([]);
  const [enabledConnections, setEnabledConnections] = useState<string[]>([]);
  // FEAT-019: per-conversation account scope. Map slug → ordered list of
  // accountIds the user has selected for this chat. Absence means "all of the
  // user's connected accounts are eligible" (legacy behaviour). Reset on
  // conversation switch; not persisted across chats.
  const [selectedAccountsByApp, setSelectedAccountsByApp] = useState<Record<string, string[]>>({});
  const [connectionsLoading, setConnectionsLoading] = useState<boolean>(false);
  const [connectedDataConnectors, setConnectedDataConnectors] = useState<Array<{ id: string; name: string }>>([]);
  // IDs of data connectors the CURRENT user has personal credentials for.
  // Populated by loadUserConnectorStatus (hits /api/oauth/{id}/status per provider).
  const [userConnectedConnectorIds, setUserConnectedConnectorIds] = useState<string[]>([]);
  // Per-chat enable list for native connectors — mirrors `enabledConnections`
  // for Pipedream. Defaults to "all user-connected connectors enabled" so
  // users don't have to toggle every native connector individually after
  // setting them up.
  const [enabledNativeConnectorIds, setEnabledNativeConnectorIds] = useState<string[]>([]);
  // Admin-side gate. When false, the catalog surfaces no native rows to the
  // user — there's no per-chat dataConnectorsEnabled toggle anymore (it was
  // replaced by per-integration enable/disable in the integrations list).
  const [dataConnectorsFeatureEnabled] = useState(() => getFlag('DATA_CONNECTORS_ENABLED'));
  const [autoToolsEnabled, setAutoToolsEnabled] = useState(true); // Default to auto mode
  const [buttonStatus, setButtonStatus] = useState('idle');
  // Voice recording state
  const [voiceRecordingState, setVoiceRecordingState] = useState<'idle' | 'recording' | 'uploading' | 'error'>('idle');
  const pendingVoiceRecordingsRef = useRef<string[]>([]);
  const voiceInputEnabled = true;
  const [isFileProcessing, _setIsFileProcessing] = useState(false);
  const [isManuallyLoading, setIsManuallyLoading] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<AgentSummary | null>(null);
  const [pendingAgent, setPendingAgent] = useState<AgentSummary | null>(null);
  const [queuedPreselectedAgent, setQueuedPreselectedAgent] = useState<AgentSummary | null>(null);
  const [agentError, setAgentError] = useState<ReactNode | null>(null);
  const [personalAgents, setPersonalAgents] = useState<AgentSummary[]>([]);
  const [personalAgentsLoading, setPersonalAgentsLoading] = useState(false);
  const [agentsMode, setAgentsMode] = useState<AgentsMode>('full');
  const [agentsFeatureEnabled] = useState(() => getFlag('AGENTS'));
  const [missingConfirm, setMissingConfirm] = useState<{ agent: AgentSummary; missing: string[] } | null>(null);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(
    () => localStorage.getItem('numa-sidebar-active') === 'history'
  );
  const [isAgentsPanelOpen, setIsAgentsPanelOpen] = useState(
    () => localStorage.getItem('numa-sidebar-active') === 'agents'
  );
  const [showFilePreviewModal, setShowFilePreviewModal] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  // SWR: initialize from localStorage cache so chat settings are available instantly
  const [userChatSettings, setUserChatSettings] = useState<ChatSettings>(
    () => ChatSettingsService.getCached() ?? DEFAULT_CHAT_SETTINGS
  );
  const [chatSettingsLoaded, setChatSettingsLoaded] = useState(() => !!ChatSettingsService.getCached());
  const [userSettingsModified, setUserSettingsModified] = useState(false);
  const [pendingConversationChatConfig, setPendingConversationChatConfig] = useState<ConversationChatConfig | null>(
    null
  );
  /** Initialization state - true when workspace is syncing files */
  const [isInitializing, setIsInitializing] = useState(false);
  /** True from when user sends first message in new conversation until first assistant content arrives */
  const [isFirstMessagePending, setIsFirstMessagePending] = useState(false);
  /** Selected model for workspace chat (global cross-region inference profile) */
  const [selectedModelId, setSelectedModelId] = useState<WorkspaceChatModelId>(DEFAULT_WORKSPACE_MODEL);
  /** Whether model selection is enabled for workspace chat (from runtime config) */
  const [workspaceModelSelectionEnabled] = useState(() => getFlag('WORKSPACE_CHAT_MODEL_SELECTION'));
  /** In-session dismissal of the red chat-health banner. Resets on conversation
   *  change so users see the warning again when they re-open the conversation. */
  const [chatHealthBannerDismissed, setChatHealthBannerDismissed] = useState(false);
  /** Tracks when a conversation was pre-minted via file upload but user hasn't sent a message yet */
  const [isPreMintedConversation, setIsPreMintedConversation] = useState(false);
  /** Tracks when a V1 conversation needs to be migrated to V2 on first message */
  const [needsV1Migration, setNeedsV1Migration] = useState(false);
  /** Allows users to hide the legacy migration notice for the current conversation */
  const [dismissedLegacyMigrationNotice, setDismissedLegacyMigrationNotice] = useState(false);
  /** Drag-and-drop state */
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const dragDepthRef = useRef(0);
  /**
   * Counts in-flight upload "intents" — incremented synchronously when paste/drop
   * starts, before any async work (conversation mint, ArrayBuffer read, S3 upload).
   * Closes the race where the user types + sends in the gap between "file dropped"
   * and "uploadingFiles state actually contains the entry".
   */
  const [pendingUploadIntents, setPendingUploadIntents] = useState(0);
  /**
   * If the user submits a message while uploads are in flight, we hold the message
   * here and auto-fire it once uploads + staging complete. Stored in a ref so the
   * useEffect that fires it doesn't loop on its own writes.
   */
  const pendingSubmitRef = useRef<string | null>(null);
  const [pendingSubmitDisplay, setPendingSubmitDisplay] = useState<string | null>(null);

  // Refs
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const initialScrollMode = ChatSettingsService.getCached()?.chatScrollMode ?? DEFAULT_CHAT_SETTINGS.chatScrollMode;
  const shouldAutoScrollRef = useRef(initialScrollMode === 'auto');
  const [showJumpButton, setShowJumpButton] = useState(false);
  const chatHistoryRef = useRef<ChatHistorySidebarRef | null>(null);
  const historyPanelRef = useRef<WorkspaceChatHistoryPanelRef | null>(null);
  const preselectHandledRef = useRef(false);
  const preselectActivatedRef = useRef(false);
  const preselectTimerRef = useRef<number | null>(null);
  const autoNamingAttemptedRef = useRef<Map<string, number>>(new Map());
  const lastLoadedConversationRef = useRef<string | null>(null); // Prevents infinite reload loop
  const loadGenerationRef = useRef(0); // Incremented on new chat to cancel in-flight loads
  const conversationChatConfigSaveTimeoutRef = useRef<number | null>(null);
  const isApplyingConversationChatConfigRef = useRef(false);
  // Note: Workspace streaming refs moved to useWorkspaceStreaming hook
  // Draft persistence to sessionStorage now lives in the chat draft store
  // (useChatDraft.ts); typing side effects (suggestion dismiss, inactivity
  // touch) are handled via subscribeChatDraft below the inactivity hook.

  // Clear first-message banner once the assistant starts streaming any content (text, thinking, tool calls, etc.)
  // Also clear when transcribing -- the workspace is ready, transcription has its own indicator.
  useEffect(() => {
    if (
      isFirstMessagePending &&
      messages.some(
        (m) => m.role === 'assistant' && ((m.segments && m.segments.length > 0) || m.status === 'transcribing')
      )
    ) {
      setIsFirstMessagePending(false);
    }
  }, [messages, isFirstMessagePending]);

  // Custom hooks
  // Use -v2 suffix to keep conversation state separate from V1 chat page
  // V2 chat: mark conversations as workspace conversations so they're properly categorized
  const conversationManager = useConversationManager({ storageKeySuffix: '-v2', isWorkspaceMode: true });
  const streamingHandler = useStreamingHandler();
  const documentProcessor = useDocumentProcessor();
  const filePreviewProcessor = useFilePreviewProcessor();

  const {
    conversationId,
    setConversationId,
    isConversationLoading,
    setIsConversationLoading,
    ensureConversationReady,
    handleNewChat,
    resetUserNewChatFlag,
    hasUserStartedNewChat,
  } = conversationManager;
  const {
    inlineDocument,
    showSplitView,
    leftFraction,
    setLeftFraction,
    setShowSplitView,
    setInlineDocument,
    openDocument,
    closeDocument,
  } = documentProcessor;
  const {
    filePreview,
    showFilePreview,
    leftFraction: filePreviewLeftFraction,
    setLeftFraction: setFilePreviewLeftFraction,
    openFilePreview,
    openFolderPreview,
    closeFilePreview,
  } = filePreviewProcessor;

  // Inline document content for FilePreviewPanel (when opening inline docs as file previews)
  const [inlinePreviewContent, setInlinePreviewContent] = useState<string | null>(null);

  // NUMA-1105: Intercept mobile back-button immediately when opening the preview modal
  useEffect(() => {
    if (!isMobile || !showFilePreviewModal) return;
    window.history.pushState({ filePreviewOpen: true }, '');
    const close = () => {
      setShowFilePreviewModal(false);
      closeFilePreview();
    };
    window.addEventListener('popstate', close);
    return () => window.removeEventListener('popstate', close);
  }, [isMobile, showFilePreviewModal, closeFilePreview]);

  const { setCurrentAbort, resetStreamingState } = streamingHandler;

  const { user, bedrockRuntimeClient, numaChatDynamoUtils, getAccessToken, getIdToken, getCredentials, lambdaClient } =
    useAuth();
  // Extract user info from token early (used by hooks/deps below)
  const idToken = user?.decoded_tokens?.idToken ?? {};
  const sub = idToken.sub;
  const userEmail = idToken.email || '';
  const userName = userEmail.split('@')[0] || undefined; // Extract first part of email as name
  const { numaGet, numaPost } = useNumaRequest();
  const { selectedKB: _selectedKB, selectedKbId: _selectedKbId, availableKBs, isLoadingKBs } = useKnowledgeBase();
  const [enabledKBIds, setEnabledKBIds] = useState<string[]>([]);

  // Settings panel hook (V2 right-side panel)
  const settingsPanel = useWorkspaceChatSettingsPanel(conversationId);

  // Toggle settings panel with mutual exclusivity
  // Opening settings closes any file preview or document panel
  const handleToggleSettings = useCallback(() => {
    if (settingsPanel.isPanelOpen) {
      settingsPanel.closePanel();
    } else {
      setIsHistoryPanelOpen(false);
      setIsAgentsPanelOpen(false);
      // Close any open panels first
      closeFilePreview();
      closeDocument();
      setShowSplitView(false);
      settingsPanel.openPanel();
      localStorage.setItem('numa-sidebar-active', 'settings');
    }
  }, [settingsPanel, closeFilePreview, closeDocument, setShowSplitView]);

  const handleToggleHistory = useCallback(() => {
    if (isMobile) {
      chatHistoryRef.current?.toggleSidebar();
      return;
    }

    if (isHistoryPanelOpen) {
      setIsHistoryPanelOpen(false);
      localStorage.removeItem('numa-sidebar-active');
    } else {
      settingsPanel.closePanel();
      setIsAgentsPanelOpen(false);
      setIsHistoryPanelOpen(true);
      localStorage.setItem('numa-sidebar-active', 'history');
    }
  }, [isMobile, isHistoryPanelOpen, settingsPanel]);

  const handleToggleAgents = useCallback(() => {
    if (isAgentsPanelOpen) {
      setIsAgentsPanelOpen(false);
      localStorage.removeItem('numa-sidebar-active');
    } else {
      settingsPanel.closePanel();
      setIsHistoryPanelOpen(false);
      setIsAgentsPanelOpen(true);
      localStorage.setItem('numa-sidebar-active', 'agents');
    }
  }, [isAgentsPanelOpen, settingsPanel]);

  const handleCloseDocument = useCallback(() => {
    closeDocument();
  }, [closeDocument]);

  const handleCloseFilePreview = useCallback(() => {
    closeFilePreview();
    setInlinePreviewContent(null);
  }, [closeFilePreview]);

  const markUserSettingsModified = useCallback(() => {
    setUserSettingsModified(true);
  }, []);

  // Memoized callbacks for file preview (to avoid re-renders on every keystroke)
  const handleOpenFilePreviewForChat = useCallback(
    (ref: { filename: string; fullPath: string; relativePath: string; extension: string }) => {
      // Close other panels for mutual exclusivity
      settingsPanel.closePanel();
      setIsHistoryPanelOpen(false);
      setIsAgentsPanelOpen(false);
      closeDocument();
      setInlinePreviewContent(null);
      openFilePreview(ref);
      if (isMobile) {
        setShowFilePreviewModal(true);
      }
    },
    [openFilePreview, isMobile, settingsPanel, closeDocument]
  );

  const handleOpenFolderPreviewForChat = useCallback(
    (ref: { name: string; fullPath: string; relativePath: string }) => {
      // Close settings panel for mutual exclusivity
      settingsPanel.closePanel();
      setIsHistoryPanelOpen(false);
      setIsAgentsPanelOpen(false);
      openFolderPreview(ref);
      if (isMobile) {
        setShowFilePreviewModal(true);
      }
    },
    [openFolderPreview, isMobile, settingsPanel]
  );

  // Stable handler for opening inline documents from the message list (BUG-194:
  // an inline arrow here defeated React.memo on ChatMessages on every keystroke)
  const handleOpenInlineDocumentFromChat = useCallback(
    (title: string, content: string) => {
      settingsPanel.closePanel();
      setInlineDocument({ title, content });
      // Store inline content and open via FilePreviewPanel
      setInlinePreviewContent(content);
      openFilePreview({
        filename: title,
        fullPath: '',
        relativePath: title,
        extension: 'md',
      });
      if (isMobile) {
        setShowFilePreviewModal(true);
      }
    },
    [settingsPanel, setInlineDocument, openFilePreview, isMobile]
  );

  const connectedSet = useMemo(
    () => new Set(availableConnections.filter((conn) => conn.isConnected).map((conn) => conn.id)),
    [availableConnections]
  );

  // ── Unified integrations payload ──────────────────────────────────────
  //
  // Single labeled list combining Pipedream + native, used for the chat
  // payload and (eventually) the chat settings panel. Each row carries a
  // `method` tag so the agent knows which MCP family to use. Source state
  // (availableConnections, connectedDataConnectors, userConnectedConnectorIds,
  // enabledConnections, enabledNativeConnectorIds, dataConnectorsEnabled)
  // still drives the existing sidebars — this memo is the wire shape.
  // isFileStore resolution: native rows look up the slug directly in the
  // registry. Pipedream rows are always false — we keep the flag consistent
  // with the Files page, which only renders native OAuth/PAT connections in
  // Remote Files. A user with only the Pipedream Google Drive connection
  // can still ask the agent to find files (it uses mcp__integrations__* for
  // that), but the integration isn't a "folder" in our UX yet.
  //
  // FUTURE: if we make Remote Files Pipedream-capable (Tony's "isFileStore
  // type object" idea), revisit this — Pipedream rows with file capability
  // would resolve via connectorSlugForPipedream → surfacesInFiles. Until
  // then, native-only keeps the flag's meaning unambiguous.
  const availableIntegrationsUnified = useMemo<IntegrationListItem[]>(() => {
    const rows: IntegrationListItem[] = [];
    for (const conn of availableConnections) {
      if (!conn.isConnected) continue;
      rows.push({
        slug: conn.id,
        method: 'pipedream',
        name: conn.name || conn.id,
        isFileStore: false,
      });
    }
    if (dataConnectorsFeatureEnabled) {
      for (const c of connectedDataConnectors) {
        if (!userConnectedConnectorIds.includes(c.id)) continue;
        rows.push({
          slug: c.id,
          method: 'native',
          name: c.name || c.id,
          isFileStore: surfacesInFiles(c.id),
        });
      }
    }
    return rows;
  }, [availableConnections, connectedDataConnectors, userConnectedConnectorIds, dataConnectorsFeatureEnabled]);

  const enabledIntegrationsUnified = useMemo<IntegrationListItem[]>(() => {
    const rows: IntegrationListItem[] = [];
    const pipedreamByName = new Map(availableConnections.map((c) => [c.id, c.name || c.id]));
    const connectionsById = new Map(availableConnections.map((c) => [c.id, c]));
    for (const slug of enabledConnections) {
      const conn = connectionsById.get(slug);
      // FEAT-019: only attach accountIds when the admin has opted this
      // integration in AND the user has narrowed the selection (i.e. it
      // does not cover every connected account). The "all connected" case
      // is conveyed by omitting accountIds, which keeps payloads small and
      // preserves legacy behaviour at the proxy layer.
      let accountIds: string[] | undefined;
      let accountNames: Record<string, string> | undefined;
      // FEAT-019: informational full list — sent ALWAYS for multi-account
      // integrations so the agent prompt can list them with their apn_xxx
      // ids, enabling explicit per-account run_action calls (the proxy's
      // `auto` resolution only picks one account at a time).
      let availableAccounts: Array<{ account_id: string; name?: string | null }> | undefined;
      if (conn?.allowMultipleAccounts && conn.accounts.length > 1) {
        availableAccounts = conn.accounts.map((a) => ({
          account_id: a.account_id,
          name: a.name ?? null,
        }));
        const selected = selectedAccountsByApp[slug];
        const allIds = conn.accounts.map((a) => a.account_id);
        const isSubset = Array.isArray(selected) && selected.length > 0 && selected.length < allIds.length;
        if (isSubset) {
          accountIds = selected.filter((id) => allIds.includes(id));
          accountNames = {};
          for (const acc of conn.accounts) {
            if (accountIds.includes(acc.account_id) && acc.name) {
              accountNames[acc.account_id] = acc.name;
            }
          }
        }
      }
      rows.push({
        slug,
        method: 'pipedream',
        name: pipedreamByName.get(slug) || slug,
        isFileStore: false,
        ...(accountIds ? { accountIds } : {}),
        ...(accountNames && Object.keys(accountNames).length > 0 ? { accountNames } : {}),
        ...(availableAccounts ? { availableAccounts } : {}),
      });
    }
    if (dataConnectorsFeatureEnabled) {
      const nativeByName = new Map(connectedDataConnectors.map((c) => [c.id, c.name || c.id]));
      for (const slug of enabledNativeConnectorIds) {
        rows.push({
          slug,
          method: 'native',
          name: nativeByName.get(slug) || slug,
          isFileStore: surfacesInFiles(slug),
        });
      }
    }
    return rows;
  }, [
    enabledConnections,
    enabledNativeConnectorIds,
    availableConnections,
    connectedDataConnectors,
    dataConnectorsFeatureEnabled,
    selectedAccountsByApp,
  ]);

  const applyConversationChatConfig = useCallback(
    (config: unknown) => {
      if (!config || typeof config !== 'object') return;

      const parsed = config as ConversationChatConfig;
      isApplyingConversationChatConfigRef.current = true;

      if (typeof parsed.autoToolsEnabled === 'boolean') {
        setAutoToolsEnabled(parsed.autoToolsEnabled);
      }
      if (typeof parsed.webSearchEnabled === 'boolean') {
        setWebSearchEnabled(parsed.webSearchEnabled);
      }
      if (typeof parsed.createAgentEnabled === 'boolean') {
        setCreateAgentEnabled(agentsFeatureEnabled ? parsed.createAgentEnabled : false);
      }
      if (typeof parsed.memoriesEnabled === 'boolean') {
        setMemoriesEnabled(parsed.memoriesEnabled);
      }
      if (typeof parsed.numaOpsEnabled === 'boolean') {
        setNumaOpsEnabled(numaOpsFeatureEnabled ? parsed.numaOpsEnabled : false);
      }
      // `dataConnectorsEnabled` on stored configs is silently ignored — the
      // unified per-integration enable list replaces the whole-feature toggle.

      if (Array.isArray(parsed.enabledKBIds)) {
        if (availableKBs.length > 0) {
          const availableSet = new Set(availableKBs.map((kb) => kb.kb_id));
          setEnabledKBIds(parsed.enabledKBIds.filter((id) => availableSet.has(id)));
        }
      }

      if (Array.isArray(parsed.enabledConnectionIds)) {
        if (availableConnections.length > 0) {
          const connected = new Set(availableConnections.filter((conn) => conn.isConnected).map((conn) => conn.id));
          setEnabledConnections(parsed.enabledConnectionIds.filter((id) => connected.has(id)));
        }
      }

      if (Array.isArray(parsed.enabledNativeConnectorIds)) {
        // Filter to currently-connected native connectors so a stale saved
        // list (e.g. a connector the user has since disconnected) doesn't
        // resurrect.
        const connectedNativeSet = new Set(userConnectedConnectorIds);
        setEnabledNativeConnectorIds(parsed.enabledNativeConnectorIds.filter((id) => connectedNativeSet.has(id)));
      }

      window.setTimeout(() => {
        isApplyingConversationChatConfigRef.current = false;
      }, 0);
    },
    [agentsFeatureEnabled, numaOpsFeatureEnabled, availableConnections, availableKBs, userConnectedConnectorIds]
  );

  useEffect(() => {
    if (!pendingConversationChatConfig) return;
    applyConversationChatConfig(pendingConversationChatConfig);
  }, [applyConversationChatConfig, pendingConversationChatConfig]);

  const handleUserSetWebSearchEnabled = useCallback(
    (value: SetStateAction<boolean>) => {
      markUserSettingsModified();
      setWebSearchEnabled(value);
    },
    [markUserSettingsModified]
  );

  const handleUserSetCreateAgentEnabled = useCallback(
    (value: SetStateAction<boolean>) => {
      markUserSettingsModified();
      setCreateAgentEnabled(value);
    },
    [markUserSettingsModified]
  );

  const handleUserSetMemoriesEnabled = useCallback(
    (value: SetStateAction<boolean>) => {
      markUserSettingsModified();
      setMemoriesEnabled(value);
    },
    [markUserSettingsModified]
  );

  const handleUserSetNumaOpsEnabled = useCallback(
    (value: SetStateAction<boolean>) => {
      markUserSettingsModified();
      setNumaOpsEnabled(value);
    },
    [markUserSettingsModified]
  );

  const handleUserSetAutoToolsEnabled = useCallback(
    (value: SetStateAction<boolean>) => {
      markUserSettingsModified();
      setAutoToolsEnabled(value);
    },
    [markUserSettingsModified]
  );

  const handleUserSetEnabledConnections = useCallback(
    (value: SetStateAction<string[]>) => {
      markUserSettingsModified();
      setEnabledConnections(value);
    },
    [markUserSettingsModified]
  );

  // Mirror handleUserSetEnabledConnections for native connectors. Without
  // marking-modified, the per-chat persistence effect won't fire (it gates
  // on `userSettingsModified`), so a user-side toggle would never save and
  // the next applyAgentConfiguration / page refresh would snap the state
  // back to defaults — which is exactly what was happening before this fix.
  const handleUserSetEnabledNativeConnectorIds = useCallback(
    (value: SetStateAction<string[]>) => {
      markUserSettingsModified();
      setEnabledNativeConnectorIds(value);
    },
    [markUserSettingsModified]
  );

  const handleUserSetEnabledKBIds = useCallback(
    (value: SetStateAction<string[]>) => {
      markUserSettingsModified();
      setEnabledKBIds(value);
    },
    [markUserSettingsModified]
  );

  // Persist current chat controls to the conversation meta item so resuming a chat restores its last state.
  // Only save when the user has explicitly modified settings (via toggle handlers) to avoid
  // overwriting saved config with defaults during loading, system config application, or async dependency resolution.
  useEffect(() => {
    if (!conversationId || !numaChatDynamoUtils || !sub) return;
    if (!userSettingsModified) return;
    if (isConversationLoading) return;
    if (isApplyingConversationChatConfigRef.current) return;

    if (conversationChatConfigSaveTimeoutRef.current) {
      window.clearTimeout(conversationChatConfigSaveTimeoutRef.current);
      conversationChatConfigSaveTimeoutRef.current = null;
    }

    conversationChatConfigSaveTimeoutRef.current = window.setTimeout(() => {
      const payload: ConversationChatConfig = {
        autoToolsEnabled,
        webSearchEnabled,
        createAgentEnabled: agentsFeatureEnabled ? createAgentEnabled : false,
        memoriesEnabled,
        numaOpsEnabled: numaOpsFeatureEnabled ? numaOpsEnabled : false,
        enabledKBIds,
        enabledConnectionIds: enabledConnections,
        enabledNativeConnectorIds,
      };

      numaChatDynamoUtils
        .updateMetaItem(conversationId, sub, { chatConfig: payload })
        .catch((err) => console.warn('[NumaChat] Unable to persist chat config to conversation meta', err));
    }, 600);

    return () => {
      if (conversationChatConfigSaveTimeoutRef.current) {
        window.clearTimeout(conversationChatConfigSaveTimeoutRef.current);
        conversationChatConfigSaveTimeoutRef.current = null;
      }
    };
  }, [
    autoToolsEnabled,
    conversationId,
    createAgentEnabled,
    memoriesEnabled,
    numaOpsEnabled,
    enabledConnections,
    enabledNativeConnectorIds,
    enabledKBIds,
    agentsFeatureEnabled,
    numaOpsFeatureEnabled,
    isConversationLoading,
    numaChatDynamoUtils,
    sub,
    userSettingsModified,
    webSearchEnabled,
  ]);

  const defaultKBIdsFromSettings = useMemo(() => {
    if (!Array.isArray(userChatSettings.defaultKBIds) || userChatSettings.defaultKBIds.length === 0) {
      return [];
    }

    // Expand the My Files sentinel to the user's actual sub before matching.
    const expanded = expandMyFilesSentinel(userChatSettings.defaultKBIds, sub);
    const defaultKBSet = new Set(expanded);
    const availableDefaultKBs = availableKBs.filter((kb) => defaultKBSet.has(kb.kb_id));
    return availableDefaultKBs.map((kb) => kb.kb_id);
  }, [availableKBs, userChatSettings.defaultKBIds, sub]);

  const defaultConnectionIdsFromSettings = useMemo(
    () => userChatSettings.defaultConnectionIds.filter((id) => connectedSet.has(id)),
    [connectedSet, userChatSettings.defaultConnectionIds]
  );

  // Mirror of defaultConnectionIdsFromSettings for native connectors: take
  // the admin/user-configured default list and intersect with the user's
  // currently-connected set so we never enable a connector that isn't
  // actually wired up.
  const defaultNativeConnectorIdsFromSettings = useMemo(
    () => (userChatSettings.defaultNativeConnectorIds ?? []).filter((id) => userConnectedConnectorIds.includes(id)),
    [userChatSettings.defaultNativeConnectorIds, userConnectedConnectorIds]
  );

  const applyAgentConfiguration = useCallback(
    (agent: AgentSummary | null) => {
      if (!agent) {
        // Apply user's default chat settings when no agent is selected
        const autoTools = userChatSettings.autoToolsEnabled;
        setAutoToolsEnabled(autoTools);
        // When autoTools is enabled, individual tools should also be enabled
        setWebSearchEnabled(autoTools || userChatSettings.webSearchEnabled);
        setCreateAgentEnabled(autoTools || userChatSettings.createAgentEnabled);
        setMemoriesEnabled(autoTools || userChatSettings.memoriesEnabled);
        setNumaOpsEnabled(autoTools || (userChatSettings.numaOpsEnabled ?? false));

        // Integrations: re-resolve method per slug against the user's CURRENT
        // auth state. Same walk as the agent path below — handles the case
        // where the user originally saved Gmail as a default when it was
        // native, then switched to Pipedream. The profile UI keeps Gmail
        // checked as a "service-level" default; this loop routes it to
        // whichever method the user has authed now.
        const pdAuthedDef = new Set(availableConnections.filter((c) => c.isConnected).map((c) => c.id));
        const nativeAuthedDef = new Set(userConnectedConnectorIds);
        const defaultSlugSet = new Set<string>([
          ...userChatSettings.defaultConnectionIds,
          ...(userChatSettings.defaultNativeConnectorIds ?? []),
        ]);
        const defaultPdSlugs: string[] = [];
        const defaultNativeSlugs: string[] = [];
        for (const slug of defaultSlugSet) {
          const pdSlug = pipedreamSlugForConnector(slug) ?? slug;
          const nativeSlug = connectorSlugForPipedream(slug) ?? slug;
          if (pdAuthedDef.has(pdSlug)) {
            defaultPdSlugs.push(pdSlug);
          } else if (nativeAuthedDef.has(nativeSlug)) {
            defaultNativeSlugs.push(nativeSlug);
          }
          // Neither authed → silently drop (consistent with agent path).
        }
        setEnabledConnections(defaultPdSlugs);
        setEnabledNativeConnectorIds(defaultNativeSlugs);

        // FEAT-019: seed the per-account scope from the user's saved chat
        // defaults, narrowed to the Pipedream integrations actually enabled
        // above. Absent/empty entries mean "all accounts" (the proxy's legacy
        // default), so we only carry slugs the user explicitly narrowed.
        const defaultAccounts = userChatSettings.defaultAccountsByApp ?? {};
        const enabledPdSet = new Set(defaultPdSlugs);
        const seededAccounts: Record<string, string[]> = {};
        for (const [slug, accountIds] of Object.entries(defaultAccounts)) {
          if (enabledPdSet.has(slug) && Array.isArray(accountIds) && accountIds.length > 0) {
            seededAccounts[slug] = accountIds;
          }
        }
        setSelectedAccountsByApp(seededAccounts);

        // Apply user's default KB selection, filtered by what's available
        setEnabledKBIds(defaultKBIdsFromSettings);
        return;
      }

      const config = agent.toolsConfig ?? {};
      const autoTools = config.autoToolsEnabled ?? true;
      setAutoToolsEnabled(autoTools);
      // When autoTools is enabled, individual tools should also be enabled
      setWebSearchEnabled(autoTools || (config.webSearchEnabled ?? false));
      setCreateAgentEnabled(autoTools || (config.createAgentEnabled ?? false));
      setMemoriesEnabled(autoTools || (config.memoriesEnabled ?? true));
      setNumaOpsEnabled(autoTools || (config.numaOpsEnabled ?? false));

      // Integrations: the agent's selection is the SOLE source of truth for
      // WHAT services are enabled. The METHOD per service (Pipedream vs
      // native) is re-resolved here against the user's current auth state
      // — so an agent saved with `{gmail, native}` automatically routes to
      // Pipedream if the user has since unhooked native gmail and connected
      // Pipedream gmail (and vice versa). Mirrors the schedule runner's
      // `decideMethod` walk in `lambdas/node/agent-schedule-runner/
      // integrations-payload.ts`.
      //
      // Note: admin `preferred_method` is NOT consulted here yet — the
      // workspace-agent's connect tool refuses native calls when admin
      // prefers Pipedream, so the worst case today is a graceful "not
      // available" error. Adding the admin-pref hop client-side is a
      // follow-up.
      const pdAuthed = new Set(availableConnections.filter((c) => c.isConnected).map((c) => c.id));
      const nativeAuthed = new Set(userConnectedConnectorIds);

      type InputRow = { slug: string; method?: 'native' | 'pipedream' };
      const inputRows: InputRow[] = [];
      const tagged = config.enabledIntegrations;
      if (Array.isArray(tagged) && tagged.length > 0) {
        for (const row of tagged) inputRows.push({ slug: row.slug, method: row.method });
      } else {
        // Legacy: flat slug list, no method tags.
        for (const slug of config.enabledConnections ?? []) inputRows.push({ slug });
      }

      const pdSlugs: string[] = [];
      const nativeSlugs: string[] = [];
      const droppedSlugs: string[] = [];
      for (const row of inputRows) {
        // Canonicalise: figure out which Pipedream slug and which native
        // slug this row could route through.
        const pdSlug = row.method === 'pipedream' ? row.slug : (pipedreamSlugForConnector(row.slug) ?? row.slug);
        const nativeSlug = row.method === 'native' ? row.slug : (connectorSlugForPipedream(row.slug) ?? row.slug);

        const pdOk = pdAuthed.has(pdSlug);
        const nativeOk = nativeAuthed.has(nativeSlug);

        // 1. Honour explicit method when user has that method authed.
        if (row.method === 'pipedream' && pdOk) {
          pdSlugs.push(pdSlug);
          continue;
        }
        if (row.method === 'native' && nativeOk) {
          nativeSlugs.push(nativeSlug);
          continue;
        }
        // 2. Fallback — Pipedream preferred (richer tool surface), then native.
        if (pdOk) {
          pdSlugs.push(pdSlug);
          continue;
        }
        if (nativeOk) {
          nativeSlugs.push(nativeSlug);
          continue;
        }
        // 3. Neither authed — drop.
        droppedSlugs.push(row.slug);
      }
      if (droppedSlugs.length > 0) {
        console.warn('[CHAT] dropping integrations the user has not authed', droppedSlugs);
      }
      setEnabledConnections(pdSlugs);
      setEnabledNativeConnectorIds(nativeSlugs);

      // Apply KB constraints from agent
      const allowedKBs = config.allowedKnowledgeBases;
      if (allowedKBs === null) {
        // Explicitly set to "all KBs" - enable all available
        setEnabledKBIds(availableKBs.map((kb) => kb.kb_id));
      } else if (allowedKBs === undefined) {
        // Not set - use backwards compat check for legacy agents
        if (config.queryDataSources === false) {
          // No KB access
          setEnabledKBIds([]);
        } else {
          // All KBs allowed - enable all available
          setEnabledKBIds(availableKBs.map((kb) => kb.kb_id));
        }
      } else if (allowedKBs.length === 0) {
        // Explicit no KB access
        setEnabledKBIds([]);
      } else {
        // Specific KBs allowed - enable only those that are both allowed and available
        const allowedSet = new Set(allowedKBs);
        setEnabledKBIds(availableKBs.filter((kb) => allowedSet.has(kb.kb_id)).map((kb) => kb.kb_id));
      }
    },
    [
      availableKBs,
      availableConnections,
      connectedDataConnectors,
      userConnectedConnectorIds,
      defaultConnectionIdsFromSettings,
      defaultNativeConnectorIdsFromSettings,
      defaultKBIdsFromSettings,
      userChatSettings,
    ]
  );

  // Chat-settings panel state for Support popup conversations (FEAT-204).
  // Mirrors what the numa-chat-support agent type ENFORCES on the backend
  // (KB locked to the Numa Support system KB, no integrations, KB search +
  // web search only) so the panel shows what is actually in effect instead
  // of the user's defaults.
  const applySupportConfiguration = useCallback(() => {
    setAutoToolsEnabled(false);
    setWebSearchEnabled(true);
    setCreateAgentEnabled(false);
    setMemoriesEnabled(false);
    setNumaOpsEnabled(false);
    // Email-only integrations: enable ONLY the user's connected Gmail/Outlook
    // so the support agent can send an escalation email on their behalf. Other
    // integrations stay off, and nothing is enabled if email isn't connected
    // (so the agent only offers to send when it actually can).
    const connectedEmailSlugs = availableConnections
      .filter((c) => c.isConnected && SUPPORT_EMAIL_INTEGRATION_SLUGS.has(c.id))
      .map((c) => c.id);
    setEnabledConnections(connectedEmailSlugs);
    setEnabledNativeConnectorIds([]);
    setSelectedAccountsByApp({});
    setEnabledKBIds([SUPPORT_KB_ID]);
  }, [availableConnections]);

  // Connections load asynchronously, often after a Support conversation has
  // already been pinned (e.g. a new tab opened by the Support popup). Re-apply
  // the support config when they land so the user's connected email
  // integration(s) become available to the agent on the next turn.
  useEffect(() => {
    if (!conversationId) return;
    if (getConversationAgentType(conversationId) !== SUPPORT_AGENT_TYPE) return;
    applySupportConfiguration();
  }, [availableConnections, conversationId, applySupportConfiguration]);

  const resetAgentState = useCallback(() => {
    setCurrentAgent(null);
    setPendingAgent(null);
    applyAgentConfiguration(null);
    setAgentError(null);
  }, [applyAgentConfiguration]);

  // Simple direct access - no need for useMemo for primitive values
  const userId = sub;
  const userExists = !!user;

  // If feature disabled, ensure no agent is selected and agent-specific flags are off
  useEffect(() => {
    if (!agentsFeatureEnabled) {
      resetAgentState();
    }
  }, [agentsFeatureEnabled]);

  // Track viewport to render mobile-only UI without touching desktop layout
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Set initial mobile state
    const initial = window.innerWidth <= 768;
    setIsMobile(initial);

    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile((prev) => (prev === mobile ? prev : mobile));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Network status detection for offline banner
  const { isOnline } = useNetworkStatus();

  // Load global Agents policy once (only when feature enabled)
  useEffect(() => {
    if (!agentsFeatureEnabled) {
      setAgentsMode('off');
      return;
    }
    (async () => {
      try {
        const res = await AdminAgentsService.get(numaGet);
        setAgentsMode(res.mode);
      } catch {
        setAgentsMode('full');
      } finally {
        /* no-op */
      }
    })();
  }, [numaGet, agentsFeatureEnabled]);

  // Load user chat settings once on mount
  useEffect(() => {
    (async () => {
      try {
        const settings = await ChatSettingsService.get(numaGet);
        setUserChatSettings(settings);
      } catch (err) {
        console.warn('Failed to load user chat settings, using defaults', err);
        setUserChatSettings(DEFAULT_CHAT_SETTINGS);
      } finally {
        setChatSettingsLoaded(true);
      }
    })();
  }, [numaGet]);

  // Apply user chat settings defaults on initial load (when no agent is selected)
  useEffect(() => {
    if (
      chatSettingsLoaded &&
      !currentAgent &&
      availableKBs.length > 0 &&
      !userSettingsModified &&
      !isConversationLoading &&
      !pendingConversationChatConfig
    ) {
      // Support conversations pin their own settings (applySupportConfiguration)
      // — never overwrite them with the user's defaults. sessionStorage is read
      // directly so the freshest pin is seen regardless of effect ordering.
      const activeCid = sessionStorage.getItem('currentConversationId-v2');
      if (activeCid && getConversationAgentType(activeCid) === SUPPORT_AGENT_TYPE) {
        return;
      }

      applyAgentConfiguration(null);

      const forceKbId = searchParams.get('kb');
      if (forceKbId && availableKBs.some((k) => k.kb_id === forceKbId)) {
        setEnabledKBIds([forceKbId]);
        searchParams.delete('kb');
        setSearchParams(searchParams, { replace: true });
      }
    }
  }, [
    chatSettingsLoaded,
    availableKBs,
    currentAgent,
    applyAgentConfiguration,
    userSettingsModified,
    isConversationLoading,
    pendingConversationChatConfig,
    searchParams,
    setSearchParams,
  ]);

  // Load personal agents once on mount (only when feature enabled)
  useEffect(() => {
    if (!agentsFeatureEnabled) {
      setPersonalAgents([]);
      return;
    }
    const loadPersonalAgents = async () => {
      if (!userExists || !userId) return;

      // Cache configuration
      const CACHE_KEY = `numa_personal_agents_${userId}`;
      const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

      // Check cache first
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          const age = Date.now() - timestamp;
          if (age < CACHE_DURATION_MS) {
            // Use cached data
            setPersonalAgents(data);
            return;
          }
        }
      } catch (err) {
        console.warn('Failed to read agents cache:', err);
      }

      // Fetch fresh data — load both owned and public (company) agents
      setPersonalAgentsLoading(true);
      try {
        const [ownedAgents, publicAgents] = await Promise.all([
          listAgents(numaGet, { scope: 'owned' }),
          listAgents(numaGet, { scope: 'public' }),
        ]);

        // Deduplicate: prefer user-scoped agents over workspace-scoped when both exist with same agentId
        // This happens when a personal agent is made public (creates both user and workspace copies)
        const agentMap = new Map<string, (typeof ownedAgents)[0]>();

        for (const agent of [...ownedAgents, ...publicAgents]) {
          const existing = agentMap.get(agent.agentId);
          // Prefer user scope over workspace scope to avoid duplicates
          if (!existing || (agent.scope === 'user' && existing.scope === 'workspace')) {
            agentMap.set(agent.agentId, agent);
          }
        }

        const deduplicatedAgents = Array.from(agentMap.values());
        setPersonalAgents(deduplicatedAgents);

        // Cache the results
        try {
          sessionStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
              data: deduplicatedAgents,
              timestamp: Date.now(),
            })
          );
        } catch (err) {
          console.warn('Failed to cache agents:', err);
        }
      } catch (err) {
        console.error('Failed to load personal agents', err);
      } finally {
        setPersonalAgentsLoading(false);
      }
    };
    loadPersonalAgents();
  }, [userExists, userId, numaGet, agentsFeatureEnabled]);

  // Cleanup preselect timer on unmount
  useEffect(() => {
    return () => {
      if (preselectTimerRef.current) {
        clearTimeout(preselectTimerRef.current);
        preselectTimerRef.current = null;
      }
    };
  }, []);

  // Read region and bucket once on mount
  const [REGION] = useState(() => window.sessionStorage.getItem('REGION'));
  const [OUTPUTS_BUCKET] = useState(() => window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME'));

  const getMissingIntegrations = (agent: AgentSummary): string[] => {
    const required = agent.requiredIntegrations ?? [];
    if (required.length === 0) return [];

    // A required slug is satisfied if the user has EITHER method connected:
    //   - Pipedream connection for that slug, OR the paired Pipedream slug
    //     of a native connector they've authed (e.g. required="google_drive"
    //     satisfied by native "googledrive").
    //   - Native connector for that slug, OR the paired native of a
    //     Pipedream connection (e.g. required="googledrive" satisfied by
    //     Pipedream "google_drive").
    // Legacy agents store Pipedream slugs in `requiredIntegrations`; new
    // dual-method awareness means a user who only authed the native variant
    // is no longer falsely blocked from launching the agent.
    const pipedreamConnected = new Set(availableConnections.map((c) => c.id));
    const nativeConnected = new Set(userConnectedConnectorIds);

    return required.filter((slug) => {
      if (pipedreamConnected.has(slug)) return false;
      if (nativeConnected.has(slug)) return false;
      const pairedPd = pipedreamSlugForConnector(slug);
      if (pairedPd && pipedreamConnected.has(pairedPd)) return false;
      const pairedNative = connectorSlugForPipedream(slug);
      if (pairedNative && nativeConnected.has(pairedNative)) return false;
      return true;
    });
  };

  const resolveUserWelcomeMessage = (agent: AgentSummary): string | undefined =>
    agent.userWelcomeMessage?.trim() || undefined;

  const createAgentWelcomeMessage = (agent: AgentSummary): string => {
    const authorMessage = resolveUserWelcomeMessage(agent);
    let message = authorMessage || `Hello! I'm **${agent.title}**.`;
    if (agent.referenceFiles && agent.referenceFiles.length > 0) {
      message += '\n\n**📎 Reference Files:**';
      agent.referenceFiles.forEach((file) => {
        message += `\n- ${file.fileName}`;
      });
    }
    return message;
  };

  const doStartAgentSession = async (agent: AgentSummary, _missing: string[] = []) => {
    // Mark preselect as consumed and clear preselect markers before starting
    try {
      const tok = sessionStorage.getItem('numa_preselected_agent_token');
      if (tok) sessionStorage.setItem('numa_preselected_agent_consumed', tok);
      sessionStorage.removeItem('numa_preselected_agent');
      sessionStorage.removeItem('numa_preselected_agent_token');
      // keep consumed marker optional
    } catch {
      /* ignore */
    }

    // Do not show a banner for missing integrations; the pre-chat modal handles warnings
    setAgentError(null);

    // Close any open split-screen previews from previous conversation
    closeDocument();
    setShowSplitView(false);
    closeFilePreview();
    settingsPanel.clearFiles();

    setIsManuallyLoading(true);
    await handleNewChat();
    applyAgentConfiguration(agent);
    setCurrentAgent(agent);
    setPendingAgent(agent);
    setMessages([{ role: 'assistant', content: createAgentWelcomeMessage(agent) }]);
    setUploadedFiles([]);
    setIsManuallyLoading(false);
  };

  const startAgentSession = async (agent: AgentSummary) => {
    const missing = getMissingIntegrations(agent);
    // Only suppress the modal when arriving from Agents page (payload present at navigation time)
    const isPreselected = Boolean(sessionStorage.getItem('numa_preselected_agent'));
    if (missing.length > 0 && !isPreselected) {
      setMissingConfirm({ agent, missing });
      return;
    }

    await doStartAgentSession(agent, missing);
  };

  const handleAgentSelect = async (agent: AgentSummary) => {
    try {
      await startAgentSession(agent);
    } catch (error) {
      console.error('Failed to activate agent', error);
      setAgentError((error as Error)?.message ?? 'Unable to activate agent');
    }
  };

  // Pipedream integration feature flags - check config instead of Cognito groups
  const hasPipedreamFeature = getFlag('PIPEDREAM_INTEGRATIONS');
  const relayLambdaArn = window.sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN');
  const [globalIntegrationSettings, setGlobalIntegrationSettings] = useState<
    Record<string, { status: 'enabled' | 'disabled'; denyTools: string[] }>
  >({});

  useEffect(() => {
    if (!user) return;
    if (hasPipedreamFeature && !relayLambdaArn) {
      console.error('Pipedream feature enabled but Lambda ARN not configured');
    }
  }, [user, hasPipedreamFeature, relayLambdaArn]);

  // Clear connections state when Pipedream feature is not enabled
  useEffect(() => {
    if (!user || !hasPipedreamFeature || !relayLambdaArn) {
      setConnectionsLoading(false);
      setAvailableConnections([]);
    }
  }, [user, hasPipedreamFeature, relayLambdaArn]);

  // When a preselected agent is queued, start the session once connections have loaded
  useEffect(() => {
    if (!queuedPreselectedAgent) return;
    // If Pipedream feature is disabled, connectionsLoading should already be false
    if (connectionsLoading) {
      return;
    }
    if (preselectActivatedRef.current) return;
    preselectActivatedRef.current = true;
    if (preselectTimerRef.current) {
      clearTimeout(preselectTimerRef.current);
      preselectTimerRef.current = null;
    }
    Promise.resolve(startAgentSession(queuedPreselectedAgent))
      .catch((err) => {
        console.error('Failed to activate queued preselected agent', err);
        setAgentError((err as Error)?.message ?? 'Unable to activate selected agent');
      })
      .finally(() => setQueuedPreselectedAgent(null));
  }, [queuedPreselectedAgent, connectionsLoading]);

  // Apply preselected agent from Agents page - start a fresh chat
  useEffect(() => {
    if (preselectHandledRef.current) return;
    const stored = sessionStorage.getItem('numa_preselected_agent');
    const token = sessionStorage.getItem('numa_preselected_agent_token');
    const consumed = sessionStorage.getItem('numa_preselected_agent_consumed');
    const shouldStart = (token || stored) && !consumed;
    if (!shouldStart) return;

    preselectHandledRef.current = true;
    setIsConversationLoading(false);
    try {
      // The Ask Numa / Support popup token is a draft-handoff marker, not an
      // Agents-page launch — never queue an agent for it, even if a stale
      // numa_preselected_agent payload is still lying around (it would be
      // applied over the popup's fresh conversation).
      if (token === ASK_NUMA_PRESELECT_TOKEN) return;
      if (agentsMode === 'off' || !stored) return;
      const parsed = JSON.parse(stored) as AgentSummary;
      setQueuedPreselectedAgent(parsed);
    } catch (error) {
      console.error('Failed to load preselected agent', error);
    }
  }, [agentsMode]);

  // Auto-submit from Ask Numa popup.
  // The popup creates a conversation, uploads context files to S3, saves staged
  // items to localStorage, then navigates here. This effect is SELF-CONTAINED:
  // it reads staged items from localStorage directly (bypassing React state
  // closure issues), builds attachments, writes the user message to DynamoDB,
  // and calls streamChat directly -- avoiding handleSubmit entirely.
  const askNumaDraftHandledRef = useRef(false);
  useEffect(() => {
    if (askNumaDraftHandledRef.current) return;
    const draft = sessionStorage.getItem('numa_ask_numa_draft');
    if (!draft) return;
    askNumaDraftHandledRef.current = true;
    sessionStorage.removeItem('numa_ask_numa_draft');
    sessionStorage.removeItem('numa_preselected_agent_token');

    try {
      const {
        message,
        conversationId: draftCid,
        agentType: draftAgentType,
      } = JSON.parse(draft) as { message: string; conversationId: string; agentType?: string };
      if (!message || !draftCid) return;

      // Pin the workspace agent type (e.g. numa-chat-support) to this
      // conversation so every subsequent turn sends it too (see handleSubmit).
      if (draftAgentType) {
        sessionStorage.setItem(`${CONVERSATION_AGENT_TYPE_KEY_PREFIX}${draftCid}`, draftAgentType);
      }
      // Reflect the support agent's enforced settings in the panel (Numa
      // Support KB only, no integrations) instead of the user's defaults.
      if (draftAgentType === SUPPORT_AGENT_TYPE) {
        applySupportConfiguration();
      }

      // 1. Load staged items from localStorage (files already uploaded to S3 by popup)
      const draftStagedItems = loadStagedItems(draftCid);
      console.log('[AskNuma] Auto-submit:', {
        cid: draftCid,
        files: draftStagedItems.map((i) => (i.kind === 'file' ? i.filename : i.folderName)),
      });

      // 2. Build attachments from staged items (same logic as handleSubmit)
      const attachmentFiles = flattenStagedItems(draftStagedItems);
      const attachmentFolders = extractFolderMetadata(draftStagedItems);
      const attachments =
        attachmentFiles.length > 0
          ? {
              files: attachmentFiles.map((f) => ({ path: f.path, filename: f.filename, size: f.size })),
              folders: attachmentFolders.length > 0 ? attachmentFolders : undefined,
            }
          : undefined;

      // 3. Clear staged items from localStorage SYNCHRONOUSLY before setting conversationId.
      // This prevents the loadStagedItems useEffect (triggered by conversationId change)
      // from re-populating stagedItems state with files we've already consumed.
      clearStagedItems(draftCid);

      // 4. Set conversation and UI state
      setConversationId(draftCid);
      setIsConversationLoading(false);
      setMessages([{ role: 'user', content: message }]);
      setButtonStatus('loading');

      // 5. Write user message to DynamoDB, configure tools, and stream (async)
      (async () => {
        try {
          if (numaChatDynamoUtils) {
            await numaChatDynamoUtils
              .addMessage({
                conversationId: draftCid,
                userId: sub,
                messageType: 'text',
                role: 'user',
                content: message,
              })
              .catch((err) => console.error('[AskNuma] Error storing user message:', err));
          }

          const { enabledTools } = configureAgentCall(
            autoToolsEnabled,
            webSearchEnabled,
            createAgentEnabled,
            idToken,
            user,
            sub
          );
          setMessages((prev) => [...prev, { role: 'assistant', segments: [], status: 'processing' }]);
          resetStreamingState();

          // Support conversations are scoped to email-only integrations, which
          // are enabled per-turn from the user's connected accounts once they
          // load (applySupportConfiguration). On this first auto-submitted turn
          // those may not have landed yet, and enabledIntegrationsUnified can
          // still hold the user's defaults from before the support pin — so send
          // none here rather than leaking non-email integrations into support.
          const isSupportDraft = draftAgentType === SUPPORT_AGENT_TYPE;
          await streamChat({
            prompt: message,
            conversationId: draftCid,
            enabledTools: ensureToolsForAgentType(enabledTools, draftAgentType),
            enabledIntegrations: isSupportDraft ? [] : enabledIntegrationsUnified,
            availableIntegrations: isSupportDraft ? [] : availableIntegrationsUnified,
            enabledKBIds,
            availableKBs,
            attachments,
            modelId: selectedModelId,
            type: draftAgentType,
          });
        } catch (err) {
          console.error('[AskNuma] Auto-submit failed:', err);
          setButtonStatus('idle');
        }
      })();
    } catch {
      /* ignore malformed draft */
    }
  }, []);

  // ── Atomic connector + integrations loader ────────────────────────────
  //
  // Everything the sidebar "Integrations" section needs (Pipedream
  // connections, admin-configured natives, and per-user native status)
  // resolves through ONE flag — `connectionsLoading` — so the panel
  // renders both kinds together. Three independent effects previously
  // staggered: Pipedream landed first, the sidebar showed only that, then
  // natives popped in a moment later. Now `Promise.all` runs every fetch
  // in parallel and only flips loading=false after all signals + per-user
  // statuses have landed.
  //
  // The reusable `loadAll` / `loadUserStatusesOnly` helpers cover the
  // refocus path (tab regains focus → re-check user state) and the
  // post-connect path (a connect modal completes → re-check everything).
  const loadAllConnectorStatuses = useCallback(async () => {
    if (!user) return;
    setConnectionsLoading(true);
    try {
      const wantsPipedream = !!lambdaClient && hasPipedreamFeature && !!relayLambdaArn;
      const externalUserId = wantsPipedream ? PipedreamProxyService.deriveExternalUserId(user) : null;

      // Four parallel fetches — Pipedream proxy, catalog + DDB rows,
      // admin-configured connector list, admin integration settings.
      // Each path silently returns its empty shape on failure so a single
      // misbehaving service doesn't empty the whole sidebar.
      //
      // Admin settings are fetched here (not in a separate effect) so that
      // the disabled-filter is applied on the FIRST render. Splitting them
      // out caused a visible double-load: the sidebar rendered once with
      // an empty filter, then re-rendered after settings landed.
      const [pipedreamStatus, catalog, nativeRows, configured, adminSettings] = await Promise.all([
        wantsPipedream && lambdaClient && externalUserId
          ? PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId, {
              ttlMs: 30 * 60 * 1000,
            }).catch(() => null)
          : Promise.resolve(null),
        AdminIntegrationsService.catalogWithNuma(numaGet).catch(() => []),
        DataConnectorsService.listStatus(numaGet).catch(() => [] as Array<{ connector_id: string; status?: string }>),
        ConnectorsService.listConfigured().catch(
          () =>
            ({
              oauth: [] as Array<{ id: string; displayName: string }>,
              pat: [] as Array<{ id: string; displayName: string }>,
            }) as {
              oauth: Array<{ id: string; displayName: string }>;
              pat: Array<{ id: string; displayName: string }>;
            }
        ),
        numaGet('/api/settings/integrations').catch(
          () =>
            [] as Array<{
              integration: string;
              status: 'enabled' | 'disabled';
              denyTools: string[];
              allowMultipleAccounts?: boolean;
            }>
        ) as Promise<
          Array<{
            integration: string;
            status: 'enabled' | 'disabled';
            denyTools: string[];
            allowMultipleAccounts?: boolean;
          }>
        >,
      ]);

      const adminSettingsMap: Record<
        string,
        { status: 'enabled' | 'disabled'; denyTools: string[]; allowMultipleAccounts: boolean }
      > = {};
      for (const item of adminSettings || []) {
        adminSettingsMap[item.integration] = {
          status: item.status,
          denyTools: item.denyTools || [],
          allowMultipleAccounts: item.allowMultipleAccounts === true,
        };
      }

      // Build Pipedream "available connections" — only ones the user
      // actually connected AND that admin hasn't disabled.
      const pipedreamConnections = pipedreamStatus
        ? (pipedreamStatus.connections || [])
            .map((conn) => ({
              id: conn.app_name,
              name: conn.app_name,
              isConnected: conn.status === 'connected',
              mcpServerUrl: undefined as string | undefined,
              allowMultipleAccounts: adminSettingsMap[conn.app_name]?.allowMultipleAccounts === true,
              // Falls back to the legacy single-account fields when an older
              // cached proxy response lacks the `accounts` array.
              accounts:
                conn.accounts ??
                (conn.pipedream_account_id
                  ? [
                      {
                        account_id: conn.pipedream_account_id,
                        name: conn.connection_name ?? null,
                        healthy: conn.healthy ?? null,
                        dead: conn.dead ?? null,
                      },
                    ]
                  : []),
            }))
            .filter((c) => c.isConnected)
            .filter((c) => adminSettingsMap[c.id]?.status !== 'disabled')
        : [];

      // Build the native candidate set — every connector the workspace
      // has, via either admin listConfigured OR a DDB row. Catches legacy-
      // vault PAT connectors (Synergy etc.) that listConfigured misses.
      const candidates = new Map<string, string>();
      for (const c of configured.oauth) candidates.set(c.id, c.displayName);
      for (const c of configured.pat) candidates.set(c.id, c.displayName);
      for (const row of nativeRows) {
        if (!candidates.has(row.connector_id)) {
          const entry = catalog.find((e) => e.connectorSlug === row.connector_id);
          const tmpl = getConnectorById(row.connector_id);
          candidates.set(row.connector_id, tmpl?.displayName ?? entry?.connectorSlug ?? row.connector_id);
        }
      }
      const nativeList = [...candidates.entries()].map(([id, name]) => ({ id, name }));

      // Per-user status for each native candidate — one request per
      // connector, all in parallel. We do this here (still inside the
      // single loading window) so user-connected state is known by the
      // time the sidebar renders, instead of trickling in after.
      const userStatusResults = await Promise.all(
        nativeList.map(async (c) => {
          try {
            const st = await ConnectorsService.getStatus(c.id);
            return st.status === 'connected' ? c.id : null;
          } catch {
            return null;
          }
        })
      );
      const userConnected = userStatusResults.filter((x): x is string => Boolean(x));

      // Single state commit — sidebar renders ONCE with the complete,
      // correct picture for both Pipedream and native.
      setGlobalIntegrationSettings(adminSettingsMap);
      // FEAT-019 defensive: if the proxy returned 0 connected Pipedream apps
      // but we previously had some, keep the previous state. Transient empty
      // responses (proxy cold-start timeout, Pipedream API blip) shouldn't
      // wipe the visible list — the user keeps seeing their integrations and
      // the next reload corrects any drift. `pipedreamStatus === null` means
      // the call hard-failed (the `.catch(() => null)` upstream); in that
      // case we also keep prev rather than clearing.
      setAvailableConnections((prev) => {
        if (pipedreamStatus === null && prev.length > 0) {
          console.warn(
            '[loadAllConnectorStatuses] getIntegrationStatus returned null; keeping previous Pipedream connections to avoid wiping the sidebar'
          );
          return prev;
        }
        if (pipedreamConnections.length === 0 && prev.length > 0) {
          console.warn(
            '[loadAllConnectorStatuses] proxy returned 0 connected Pipedream apps but had',
            prev.length,
            'cached — keeping previous to avoid flicker'
          );
          return prev;
        }
        return pipedreamConnections;
      });
      setConnectedDataConnectors(nativeList);
      setUserConnectedConnectorIds(userConnected);
      // Drop stale enabled-native ids the user has since disconnected.
      // Adding new ones is owned by the defaults flow.
      setEnabledNativeConnectorIds((prev) => prev.filter((id) => userConnected.includes(id)));
    } catch (e) {
      console.error('Failed to load connector statuses:', e);
      setAvailableConnections([]);
      setConnectedDataConnectors([]);
      setUserConnectedConnectorIds([]);
    } finally {
      setConnectionsLoading(false);
    }
  }, [lambdaClient, user, hasPipedreamFeature, relayLambdaArn, numaGet]);

  // Lighter refresh — just re-check per-user statuses for the connectors
  // we've already discovered. Used on tab refocus + after a connect modal
  // completes; no need to re-fetch the catalog or admin-config lists.
  const loadUserConnectorStatus = useCallback(async () => {
    if (connectedDataConnectors.length === 0) {
      setUserConnectedConnectorIds([]);
      setEnabledNativeConnectorIds([]);
      return;
    }
    try {
      const results = await Promise.all(
        connectedDataConnectors.map(async (c) => {
          const st = await ConnectorsService.getStatus(c.id);
          return st.status === 'connected' ? c.id : null;
        })
      );
      const connected = results.filter((x): x is string => Boolean(x));
      setUserConnectedConnectorIds(connected);
      setEnabledNativeConnectorIds((prev) => prev.filter((id) => connected.includes(id)));
    } catch (e) {
      console.error('Failed to load per-user connector status:', e);
      setUserConnectedConnectorIds([]);
    }
  }, [connectedDataConnectors]);

  useEffect(() => {
    loadAllConnectorStatuses();
  }, [loadAllConnectorStatuses]);

  // Re-check user status when the tab regains focus — catches OAuth
  // redirects returning in the same tab and PAT saves from the modal.
  useEffect(() => {
    const onFocus = () => loadUserConnectorStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadUserConnectorStatus]);

  // Ref for input textarea
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const isProcessingRef = useRef(false);

  // Scroll mode: read from user settings, with localStorage as fallback
  // (localStorage ensures the setting works even before the backend Lambda is redeployed)
  const scrollMode: ChatScrollMode =
    userChatSettings.chatScrollMode ?? ((localStorage.getItem('numa-chat-scroll-mode') as ChatScrollMode) || 'auto');

  // When scroll mode changes, reset auto-scroll accordingly
  useEffect(() => {
    shouldAutoScrollRef.current = scrollMode === 'auto';
    if (scrollMode === 'auto') setShowJumpButton(false);
  }, [scrollMode]);

  // Find the scrollable ancestor of messageEndRef and attach a scroll listener.
  // This detects when the user manually scrolls up (to pause auto-scroll and show the button).
  useEffect(() => {
    const sentinel = messageEndRef.current;
    if (!sentinel) return;

    // Walk up the DOM to find the first ancestor that actually scrolls
    let scrollContainer: HTMLElement | null = sentinel.parentElement;
    while (scrollContainer) {
      const { overflowY } = getComputedStyle(scrollContainer);
      if (overflowY === 'auto' || overflowY === 'scroll') {
        if (scrollContainer.scrollHeight > scrollContainer.clientHeight) break;
      }
      scrollContainer = scrollContainer.parentElement;
    }
    if (!scrollContainer) return;

    const onScroll = () => {
      const threshold = 80;
      const distanceFromBottom =
        scrollContainer!.scrollHeight - scrollContainer!.scrollTop - scrollContainer!.clientHeight;
      const atBottom = distanceFromBottom <= threshold;

      setShowJumpButton(!atBottom);

      if (scrollMode === 'auto') {
        // In auto mode: pause auto-scroll when user scrolls up, re-enable near bottom
        shouldAutoScrollRef.current = atBottom;
      }
      // In manual mode: shouldAutoScrollRef stays false (only Jump button re-enables it)
    };

    scrollContainer.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollContainer!.removeEventListener('scroll', onScroll);
  }, [scrollMode, messages, isConversationLoading]);

  // Jump to bottom handler (used by JumpToLatestButton)
  const handleJumpToLatest = useCallback(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    // In auto mode, re-enable auto-scroll. In manual mode, just do the one-time jump.
    if (scrollMode === 'auto') {
      shouldAutoScrollRef.current = true;
    }
    setShowJumpButton(false);
  }, [scrollMode]);

  // Auto-scroll to bottom on new messages (streaming) or after conversation finishes loading.
  // In manual mode, never auto-scroll — the direct scrollMode check is the final guard
  // regardless of shouldAutoScrollRef state, which can have race conditions during init.
  useEffect(() => {
    if (scrollMode === 'manual') return;
    if (!isConversationLoading && shouldAutoScrollRef.current) {
      messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isConversationLoading, scrollMode]);

  // Inactivity: when expired, start a new chat and show suggestions (hook will fetch suggestions)
  async function handleNewChatOnExpired() {
    // Stop any ongoing streaming response
    abortStream();
    isProcessingRef.current = false;
    setButtonStatus('idle');
    resetStreamingState();
    resetAgentState();
    setPendingConversationChatConfig(null);

    // Reset scroll state
    shouldAutoScrollRef.current = scrollMode === 'auto';
    setShowJumpButton(false);

    // Clear all UI states
    setMessages([]);
    setUploadedFiles([]);
    setChatDraft('');
    closeDocument();
    closeFilePreview();
    settingsPanel.clearFiles();

    // Reset split view state - hide document panel
    setShowSplitView(false);
    setLeftFraction(0.99);

    // Clear manual loading state to prevent conflicts
    setIsManuallyLoading(false);

    // Clear V1 migration flag
    setNeedsV1Migration(false);

    // Clear auto-naming tracking for new conversation
    autoNamingAttemptedRef.current.clear();

    // Cancel any in-flight conversation loads so they don't overwrite new chat state
    loadGenerationRef.current += 1;

    // Reset userSettingsModified so the defaults-application useEffect can fire
    // after connection status refreshes (matches behaviour of loading a conversation)
    setUserSettingsModified(false);

    // Use the hook's new chat handler
    await handleNewChat();

    // Refresh ALL connector status (Pipedream + native + per-user) so the
    // defaults-application useEffect re-applies user defaults against the
    // fresh connected set. Single atomic load so the sidebar doesn't flash
    // a stale state between conversations.
    loadAllConnectorStatuses();
  }

  const handleHeaderNewChat = async () => {
    await handleNewChatOnExpired();
    forceShowNewChatView();
  };

  // Inactivity: centralized in hook
  const {
    showContinueSuggestions,
    recentConversations,
    resetInactivityTimer,
    touchInactivityTimer,
    hideSuggestions,
    forceShowNewChatView,
    suggestionsLoading,
  } = useChatInactivity({
    numaChatDynamoUtils,
    sub,
    buttonStatus,
    isProcessingRef,
    onExpired: handleNewChatOnExpired,
    // DO NOT pass inputMessage: keep suggestions visible while typing; hide on submit instead
    storageKeySuffix: '-v2', // Isolate inactivity timer from V1 chat
    hasUserStartedNewChat,
  });

  // Sort agents by favorites first, then most recently used, then updatedAt
  const sortedPersonalAgents = useMemo(() => {
    if (!agentsFeatureEnabled) return [];
    return sortAgentsByPriority(personalAgents, recentConversations);
  }, [personalAgents, recentConversations, agentsFeatureEnabled]);

  // Show new chat view if:
  // 1. We're in a new-chat state with no messages (either suggestions loaded or handleNewChat was called), OR
  // 2. Conversation was pre-minted via upload but user hasn't sent a message yet AND no agent is active
  //    (agent sessions have a welcome message, so pre-mint shouldn't override the agent view)
  // Note: hasUserStartedNewChat covers the gap where handleNewChat() fired but
  // useChatInactivity hasn't yet activated suggestions (prevents blank screen).
  const shouldShowNewChatView =
    ((showContinueSuggestions || hasUserStartedNewChat) && messages.length === 0) ||
    (isPreMintedConversation && !pendingAgent && !currentAgent);
  const showLegacyMigrationNotice = !shouldShowNewChatView && needsV1Migration && !dismissedLegacyMigrationNotice;

  // Reset notice dismissal on conversation/migration state changes.
  useEffect(() => {
    setDismissedLegacyMigrationNotice(false);
  }, [conversationId, needsV1Migration]);

  // Auto-load conversation when conversationId is set by useConversationManager
  // But skip auto-load if this conversation was just created in this session, messages already exist, or manual loading is in progress
  useEffect(() => {
    // Skip if we already loaded this conversation (prevents infinite loop when trace returns empty)
    if (conversationId && lastLoadedConversationRef.current === conversationId) {
      return;
    }

    if (
      conversationId &&
      numaChatDynamoUtils &&
      sub &&
      !hasUserStartedNewChat &&
      messages.length === 0 &&
      !isManuallyLoading
    ) {
      // Read isWorkspaceConversation from sessionStorage for auto-load (per-tab)
      const storedIsWorkspace = sessionStorage.getItem('isWorkspaceConversation-v2') !== 'false';
      handleLoadConversation(conversationId, storedIsWorkspace);
    }
  }, [conversationId, numaChatDynamoUtils, sub, hasUserStartedNewChat, messages.length, isManuallyLoading]);

  // Defensive: close all split-screen previews and clear stale files whenever conversation changes.
  // Individual handlers already do this, but this effect acts as a safety net for any future code paths.
  const prevConversationIdRef = useRef<string | null>(conversationId);
  useEffect(() => {
    if (conversationId !== prevConversationIdRef.current) {
      prevConversationIdRef.current = conversationId;
      closeDocument();
      closeFilePreview();
      settingsPanel.clearFiles();
    }
  }, [conversationId, closeDocument, closeFilePreview, settingsPanel]);

  // Load staged items from localStorage when conversation changes
  useEffect(() => {
    if (conversationId) {
      const items = loadStagedItems(conversationId);
      setStagedItems(items);
    } else {
      setStagedItems([]);
    }
  }, [conversationId]);

  // Cleanup old staged uploads on mount
  useEffect(() => {
    cleanupOldStagedUploads();
  }, []);

  // (Typing hide handled in hook)

  // Helper to refresh sidebar
  const refreshSidebar = () => {
    chatHistoryRef.current?.refreshConversations();
    historyPanelRef.current?.refreshConversations();
  };

  // Auto-naming handler called after stream completes
  // Receives conversationId as parameter from hook to avoid stale closure issues
  const handleAutoNaming = useCallback(
    async (streamConversationId: string) => {
      const cid = streamConversationId;
      if (!bedrockRuntimeClient || !numaChatDynamoUtils || !sub || !cid) {
        return;
      }

      // Track completion count per conversation; trigger auto-naming on 1st and 3rd completions
      const AUTO_RENAME_ON = new Set([1, 3]);
      const count = (autoNamingAttemptedRef.current.get(cid) ?? 0) + 1;
      autoNamingAttemptedRef.current.set(cid, count);

      if (!AUTO_RENAME_ON.has(count)) {
        return;
      }

      try {
        const newTitle = await autoNameConversation({
          conversationId: cid,
          userId: sub,
          bedrockRuntimeClient,
          numaChatDynamoUtils,
          region: REGION,
          force: count > 1,
        });
        if (newTitle) {
          // Surgically update just this conversation's name in the sidebar (no full reload flicker)
          chatHistoryRef.current?.updateConversationName(cid, newTitle);
          historyPanelRef.current?.updateConversationName(cid, newTitle);
        }
      } catch (e) {
        console.error('[WorkspaceChat] Auto-naming failed:', e);
      }
    },
    [bedrockRuntimeClient, numaChatDynamoUtils, sub, REGION]
  );

  // Memoised enabled-tools list for chat suggestions (mirrors configureAgentCall logic)
  const suggestionEnabledTools = useMemo(
    () =>
      getEnabledTools(
        autoToolsEnabled,
        webSearchEnabled,
        false,
        agentsFeatureEnabled ? createAgentEnabled : false,
        enabledKBIds,
        true,
        memoriesEnabled,
        numaOpsFeatureEnabled ? numaOpsEnabled : false
      ),
    [
      autoToolsEnabled,
      webSearchEnabled,
      createAgentEnabled,
      agentsFeatureEnabled,
      enabledKBIds,
      memoriesEnabled,
      numaOpsFeatureEnabled,
      numaOpsEnabled,
    ]
  );

  const connectedDataConnectorIdsForSuggestions = useMemo(
    () => connectedDataConnectors.map((c) => c.id),
    [connectedDataConnectors]
  );

  const chatSuggestions = useChatSuggestions({
    enabled: getFlag('CHAT_SUGGESTIONS') && (userChatSettings.chatSuggestionsEnabled ?? true),
    bedrockClient: bedrockRuntimeClient,
    region: REGION,
    messages: messages as unknown as WorkspaceChatMessage[],
    enabledTools: suggestionEnabledTools,
    enabledConnections: enabledConnections,
    connectedDataConnectorIds: connectedDataConnectorIdsForSuggestions,
    language: userChatSettings.language,
    debugMode: showCostTotal,
  });

  // Typing side effects, subscribed outside the render cycle so keystrokes don't
  // re-render the page (BUG-194): dismiss suggestion pills once the user types
  // past a few characters, and treat typing as user activity so the inactivity
  // handler doesn't wipe the input while the user is composing a message.
  useEffect(
    () =>
      subscribeChatDraft(() => {
        const draft = getChatDraft();
        if (draft.length > 3) {
          chatSuggestions.dismiss();
        }
        if (draft) {
          touchInactivityTimer();
        }
      }),
    [chatSuggestions, touchInactivityTimer]
  );

  // Combined stream-complete handler: auto-naming + suggestion arming
  const handleStreamComplete = useCallback(
    (streamConversationId: string) => {
      handleAutoNaming(streamConversationId);
      chatSuggestions.arm(streamConversationId);
    },
    [handleAutoNaming, chatSuggestions]
  );

  // Workspace chat streaming hook - handles SDK events, tool tracking, document extraction
  const {
    streamChat,
    abortStream,
    stopStream,
    retryLastMessage,
    isStopping,
    isReconnecting,
    retryAttempt,
    maxRetryAttempts,
    canRetry,
  } = useWorkspaceChatStreaming({
    setMessages,
    setButtonStatus,
    documentProcessor,
    isProcessingRef,
    setCurrentAbort,
    refreshSidebar,
    setUploadedFiles,
    inputRef,
    hasUserStartedNewChat,
    resetUserNewChatFlag,
    setIsInitializing,
    onStreamComplete: handleStreamComplete,
    getCredentials,
    refreshSessionFiles: settingsPanel.refreshFiles,
    onNotifyCompletion: notifyCompletion,
    getIdToken,
  });

  // Handle renaming a conversation from NewChat view
  const handleRenameConversation = async (conversationId: string, currentName: string) => {
    const newName = await prompt({
      title: tCommon('prompt.rename'),
      message: t('history.renamePrompt'),
      defaultValue: currentName,
      confirmLabel: tCommon('confirm.save'),
      required: true,
    });
    if (newName === null) return; // user cancelled
    if (!numaChatDynamoUtils) {
      console.error('DynamoDB client not initialized');
      return;
    }
    try {
      await numaChatDynamoUtils.updateConversationName(conversationId, sub, newName, 'manual');
      refreshSidebar();
      // Refresh the suggestions by forcing a re-fetch
      if (showContinueSuggestions) {
        forceShowNewChatView();
      }
    } catch (error) {
      console.error('Error renaming conversation:', error);
    }
  };

  // Handle deleting a conversation from NewChat view
  const handleDeleteConversation = async (conversationId: string) => {
    if (!numaChatDynamoUtils) return;
    const ok = await confirm({
      message: t('history.deleteConfirm'),
      confirmLabel: tCommon('confirm.delete'),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await numaChatDynamoUtils.deleteConversation(conversationId, sub);
      refreshSidebar();
      // Refresh the suggestions by forcing a re-fetch
      if (showContinueSuggestions) {
        forceShowNewChatView();
      }
    } catch (error) {
      console.error('Error deleting conversation:', error);
    }
  };

  // Handle upload button click that silently mints a conversation for new chats
  // This allows file uploads before the user sends a message
  const handleUploadWithConversationMint = async () => {
    // If we don't have a conversation yet, mint one before uploading
    if (!conversationId) {
      const activeAgent = pendingAgent || currentAgent;
      // Mint conversation with placeholder name (will be updated to first filename after upload)
      await ensureConversationReady(
        'File Upload',
        activeAgent
          ? {
              agentId: activeAgent.agentId,
              title: activeAgent.title,
              version: activeAgent.version,
              icon: activeAgent.icon,
              agentType: activeAgent.agentType,
              visibility: activeAgent.visibility,
            }
          : undefined
      );
      setIsPreMintedConversation(true);
    }
    setShowUploadModal(true);
  };

  // ---- Drag-and-drop file upload ----

  // Prevent browser from opening files when dragged/dropped outside our target
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const hasUploadsInProgress = uploadingFiles.some((f) => f.status === 'uploading') || pendingUploadIntents > 0;

  /**
   * Recursively read all files from a dropped FileSystemDirectoryEntry.
   * Preserves relative paths so folder structure is maintained in S3.
   */
  const readDirectoryRecursively = useCallback(
    async (
      dirEntry: FileSystemDirectoryEntry,
      basePath: string
    ): Promise<Array<{ file: File; relativePath: string }>> => {
      const results: Array<{ file: File; relativePath: string }> = [];
      const readEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
        new Promise((resolve, reject) => reader.readEntries(resolve, reject));

      const reader = dirEntry.createReader();
      let entries: FileSystemEntry[] = [];
      let batch: FileSystemEntry[];
      do {
        batch = await readEntries(reader);
        entries = entries.concat(batch);
      } while (batch.length > 0);

      for (const entry of entries) {
        const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
        if (entry.isFile) {
          const file = await new Promise<File>((resolve, reject) =>
            (entry as FileSystemFileEntry).file(resolve, reject)
          );
          results.push({ file, relativePath: entryPath });
        } else if (entry.isDirectory) {
          const subResults = await readDirectoryRecursively(entry as FileSystemDirectoryEntry, entryPath);
          results.push(...subResults);
        }
      }
      return results;
    },
    []
  );

  /**
   * Extract files from a drop event's DataTransfer.
   * Uses webkitGetAsEntry to properly handle folders (recursively reads contents).
   */
  const extractDroppedEntries = useCallback(
    async (dt: DataTransfer | null): Promise<Array<{ file: File; relativePath?: string }>> => {
      if (!dt) return [];

      // Try webkitGetAsEntry first — needed for proper folder handling
      if (dt.items && dt.items.length) {
        const entries: FileSystemEntry[] = [];
        for (let i = 0; i < dt.items.length; i++) {
          const entry = dt.items[i].webkitGetAsEntry?.();
          if (entry) entries.push(entry);
        }

        if (entries.length > 0) {
          const allFiles: Array<{ file: File; relativePath?: string }> = [];
          for (const entry of entries) {
            if (entry.isFile) {
              const file = await new Promise<File>((resolve, reject) =>
                (entry as FileSystemFileEntry).file(resolve, reject)
              );
              if (file.size > 0) allFiles.push({ file });
            } else if (entry.isDirectory) {
              const dirFiles = await readDirectoryRecursively(entry as FileSystemDirectoryEntry, entry.name);
              allFiles.push(...dirFiles.filter((f) => f.file.size > 0));
            }
          }
          if (allFiles.length > 0) return allFiles;
        }
      }

      // Fallback: simple file list (no folder support)
      return Array.from(dt.files || [])
        .filter((f) => f.size > 0)
        .map((file) => ({ file }));
    },
    [readDirectoryRecursively]
  );

  const handleChatDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const hasFiles =
      Array.from(e.dataTransfer?.types || []).includes('Files') ||
      (e.dataTransfer?.items && Array.from(e.dataTransfer.items).some((i) => i.kind === 'file'));
    if (!hasFiles) return;
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }, []);

  const handleChatDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleChatDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  }, []);

  /**
   * Upload dropped files directly to S3 (no modal).
   * Shows progress in PendingFilesBar and stages files on completion.
   * Accepts entries with optional relativePath for folder uploads.
   */
  const handleDroppedFiles = useCallback(
    async (entries: Array<{ file: File; relativePath?: string }>) => {
      if (entries.length === 0) return;

      // Bump the intent counter SYNCHRONOUSLY (before any await) so the send button
      // is correctly disabled / submission is queued during the conversation-mint
      // and S3-upload windows. Decremented in `finally` once staging is committed.
      setPendingUploadIntents((n) => n + 1);
      try {
        // Mint a conversation if needed (same as clicking the paperclip).
        // ensureConversationReady returns the conversationId.
        let targetConversationId = conversationId;
        if (!targetConversationId) {
          const activeAgent = pendingAgent || currentAgent;
          targetConversationId = await ensureConversationReady(
            'File Upload',
            activeAgent
              ? {
                  agentId: activeAgent.agentId,
                  title: activeAgent.title,
                  version: activeAgent.version,
                  icon: activeAgent.icon,
                  agentType: activeAgent.agentType,
                  visibility: activeAgent.visibility,
                }
              : undefined
          );
          setIsPreMintedConversation(true);
        }

        if (!targetConversationId) return;

        // Create uploading entries for each file
        const newUploading: (UploadingFile & { relativePath?: string })[] = entries.map((entry) => ({
          id: crypto.randomUUID(),
          file: entry.file,
          filename: entry.relativePath || entry.file.name,
          progress: 0,
          status: 'uploading' as const,
          relativePath: entry.relativePath,
        }));
        setUploadingFiles((prev) => [...prev, ...newUploading]);

        // Upload each file concurrently. Each successful upload stages itself
        // immediately so stagedItems and uploadingFiles transition atomically —
        // closes the post-upload / pre-staging race for multi-file drops.
        const convId = targetConversationId;
        const uploadPromises = newUploading.map(async (entry) => {
          try {
            const response = await uploadWorkspaceChatFileDirect(
              entry.file,
              convId,
              entry.relativePath,
              (progress) => {
                setUploadingFiles((prev) => prev.map((f) => (f.id === entry.id ? { ...f, progress } : f)));
              },
              getCredentials
            );

            // Stage this file BEFORE removing it from the uploading list — guarantees
            // there's never a moment where neither list contains it.
            const newFile: StagedFile = {
              kind: 'file' as const,
              filename: response.filename,
              path: response.path,
              size: response.size,
              uploadedAt: Date.now(),
            };
            setStagedItems((prev) => {
              const existingFiles = flattenStagedItems(prev);
              const allFiles = [...existingFiles, newFile];
              const grouped = groupFilesIntoFolders(allFiles);
              if (convId) saveStagedItems(convId, grouped);
              return grouped;
            });
            setUploadingFiles((prev) => prev.filter((f) => f.id !== entry.id));
            return response;
          } catch (error) {
            console.error('[DragDrop] Upload failed:', error);
            setUploadingFiles((prev) =>
              prev.map((f) =>
                f.id === entry.id
                  ? { ...f, status: 'error' as const, error: (error as Error).message || 'Upload failed' }
                  : f
              )
            );
            return null;
          }
        });

        const results = await Promise.all(uploadPromises);
        const successfulResponses = results.filter((r): r is WorkspaceChatUploadResponse => r !== null);

        if (successfulResponses.length > 0) {
          // Auto-name pre-minted conversations
          if (isPreMintedConversation && numaChatDynamoUtils && convId) {
            const firstName = successfulResponses[0].filename;
            try {
              await numaChatDynamoUtils.updateConversationName(convId, sub, firstName, 'auto');
            } catch (err) {
              console.error('Error renaming pre-minted conversation:', err);
            }
          }

          refreshSidebar();
          settingsPanel.refreshFiles();
        }
      } finally {
        setPendingUploadIntents((n) => Math.max(0, n - 1));
      }
    },
    [
      conversationId,
      pendingAgent,
      currentAgent,
      ensureConversationReady,
      getCredentials,
      isPreMintedConversation,
      numaChatDynamoUtils,
      numaPost,
      sub,
      refreshSidebar,
      settingsPanel,
    ]
  );

  const handleChatDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);
      const entries = await extractDroppedEntries(e.dataTransfer);
      handleDroppedFiles(entries);
    },
    [extractDroppedEntries, handleDroppedFiles]
  );

  const handleCancelUpload = useCallback((id: string) => {
    setUploadingFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  // ---- End drag-and-drop ----

  // Configure model, tools, and system prompt for agent call
  const configureAgentCall = (autoToolsEnabled, webSearchEnabled, createAgentEnabled, idToken, user, sub) => {
    // Determine which model to use based on fallback status
    const clientName = window.sessionStorage.getItem('CLIENT_NAME');
    const modelType = isInFallbackMode(clientName) ? MODEL_TYPES.FALLBACK : MODEL_TYPES.DEFAULT;
    const modelId = getModelId(REGION, modelType);
    // Determine which tools to enable based on auto mode or manual selection
    const enabledTools = getEnabledTools(
      autoToolsEnabled,
      webSearchEnabled,
      false, // dataAnalysisEnabled — not used in V2
      agentsFeatureEnabled ? createAgentEnabled : false,
      enabledKBIds,
      true, // dataAnalysisAvailable
      memoriesEnabled,
      numaOpsFeatureEnabled ? numaOpsEnabled : false
    );

    // Create the system prompt based on tool availability
    const email = idToken.email || 'Unknown';
    const kbNameById = new Map<string, string>();
    try {
      (availableKBs || []).forEach((kb) => kbNameById.set(kb.kb_id, kb.kb_name));
    } catch {
      // Ignore errors when building KB name map - will use IDs as fallback
    }
    const enabledKBMeta = (enabledKBIds || []).map((id) => ({ id, name: kbNameById.get(id) || id }));

    let systemPrompt = generateSystemPrompt(
      enabledTools,
      email,
      null,
      enabledConnections,
      agentsFeatureEnabled ? createAgentEnabled : false,
      enabledKBMeta
    );

    if (currentAgent) {
      const agentPrompt = currentAgent.systemPrompt?.trim();
      if (agentPrompt) {
        systemPrompt += `\n\n**Agent Instructions (${currentAgent.title}):**\n${agentPrompt}`;
      }
      const userGuidance = resolveUserWelcomeMessage(currentAgent);
      if (userGuidance) {
        systemPrompt += `\n\n**Agent Notes:**\n${userGuidance}`;
      }
      if (currentAgent.referenceFiles?.length) {
        systemPrompt += '\n\n**Reference Materials (preloaded):**';
        currentAgent.referenceFiles.forEach((file) => {
          systemPrompt += `\n- ${file.fileName}`;
        });
      }
    }

    // Prepare user authentication context for the Lambda
    const userAuth = {
      idToken: localStorage.getItem('idToken'),
      email: idToken.email,
      sub: sub,
      groups: user?.decoded_tokens?.idToken?.['cognito:groups'] || [],
      region: REGION,
      userPoolId: window.sessionStorage.getItem('USER_POOL_ID'),
      groups_config: JSON.parse(window.sessionStorage.getItem('GROUPS') || '{}'),
      agentId: currentAgent?.agentId,
    };

    return { modelId, enabledTools, systemPrompt, userAuth, clientName };
  };

  // Note: Streaming handlers moved to useWorkspaceStreaming hook

  // Voice recording handler - uploads audio blob to S3, tracks as voice recording, triggers send
  const handleVoiceRecordingComplete = useCallback(
    async (blob: Blob, filename: string) => {
      try {
        setVoiceRecordingState('uploading');

        // Ensure conversation exists
        const cid = await ensureConversationReady('');
        if (!cid) {
          setVoiceRecordingState('error');
          return;
        }

        // Upload the audio blob as a File to S3
        const file = new File([blob], filename, { type: blob.type });
        await uploadWorkspaceChatFileDirect(file, cid, undefined, () => {}, getCredentials);

        // Track as a voice recording path (consumed by next handleSubmit)
        const uploadPath = `uploads/${filename}`;
        pendingVoiceRecordingsRef.current = [uploadPath];

        // Auto-submit the voice message (empty prompt -- transcription will fill it)
        setChatDraft('');
        // Trigger submit by dispatching a form submit on the chat form
        const form = document.querySelector('.chat-input-container form') as HTMLFormElement | null;
        if (form) {
          form.requestSubmit();
        }
        // Close modal after submit is triggered
        setVoiceRecordingState('idle');
      } catch (err) {
        console.error('[Voice] Upload failed:', err);
        setVoiceRecordingState('error');
        setTimeout(() => setVoiceRecordingState('idle'), 3000);
      }
    },
    [getCredentials, ensureConversationReady]
  );

  // Submit user input
  // Optional overrideMessage parameter allows quick actions to pass message directly
  // without waiting for React state update
  const handleSubmit = async (e, overrideMessage?: string) => {
    e.preventDefault();

    // Prevent duplicate submissions (React StrictMode protection) - check FIRST
    if (isProcessingRef.current) {
      return;
    }

    // Use override message if provided, otherwise the live input draft
    const messageToSend = overrideMessage ?? getChatDraft();

    // If uploads are still in flight (active uploads OR pre-state-update intents),
    // queue this submission. The watcher useEffect will fire it once uploads + staging
    // finish, so the model receives the message + attachments together rather than
    // racing the upload.
    const activeUploads = uploadingFiles.filter((f) => f.status === 'uploading').length + pendingUploadIntents;
    if (activeUploads > 0) {
      // Validate before queuing — same rules as a real send
      const hasVoice = pendingVoiceRecordingsRef.current.length > 0;
      if (!messageToSend.trim() && uploadedFiles.length === 0 && stagedItems.length === 0 && !hasVoice) {
        return;
      }
      pendingSubmitRef.current = messageToSend;
      setPendingSubmitDisplay(messageToSend);
      setChatDraft('');
      if (inputRef.current) {
        inputRef.current.style.height = '40px';
      }
      return;
    }

    isProcessingRef.current = true;
    markProcessingStart();

    // Consume any pending voice recordings
    const voiceRecordings =
      pendingVoiceRecordingsRef.current.length > 0 ? [...pendingVoiceRecordingsRef.current] : undefined;
    pendingVoiceRecordingsRef.current = [];

    // Validate input - allow submission if there's text, staged files, uploaded files, or voice recordings
    if (!messageToSend.trim() && uploadedFiles.length === 0 && stagedItems.length === 0 && !voiceRecordings) {
      isProcessingRef.current = false; // Reset flag on early return
      return;
    }

    // This is a user interaction
    resetInactivityTimer();
    // Hide suggestions on first interaction
    hideSuggestions();
    chatSuggestions.dismiss();
    // Clear pre-minted state - user is now sending a message, transition to active chat
    if (isPreMintedConversation) {
      setIsPreMintedConversation(false);
    }

    // Prepare UI
    setChatDraft('');
    if (inputRef.current) {
      inputRef.current.style.height = '40px';
    }
    setButtonStatus('loading');

    // Show workspace init notice on the very first message in a new conversation
    if (messages.length === 0) {
      setIsFirstMessagePending(true);
    }

    try {
      /* ────────────────────────────────
         Chat Agent Primary Interface - Stateful Backend Design
         Backend loads conversation history from DynamoDB
      ──────────────────────────────── */

      const activeAgent = pendingAgent || currentAgent;

      const cid = await ensureConversationReady(
        messageToSend,
        activeAgent
          ? {
              agentId: activeAgent.agentId,
              title: activeAgent.title,
              version: activeAgent.version,
              icon: activeAgent.icon,
              agentType: activeAgent.agentType,
              visibility: activeAgent.visibility,
            }
          : undefined
      );

      // Refresh sidebar immediately so the new conversation appears in history
      // before the agent responds (don't wait until stream completes)
      refreshSidebar();
      const userMsg = messageToSend;

      // Build attachments from staged items
      // Attachments are sent to backend and stored in trace as structured events
      const attachmentFiles = stagedItems.length > 0 ? flattenStagedItems(stagedItems) : [];
      const attachmentFolders = stagedItems.length > 0 ? extractFolderMetadata(stagedItems) : [];
      const attachments =
        attachmentFiles.length > 0
          ? {
              files: attachmentFiles.map((f) => ({
                path: f.path,
                filename: f.filename,
                size: f.size,
              })),
              // Include folder metadata so the backend can inform the AI about folder structure
              folders: attachmentFolders.length > 0 ? attachmentFolders : undefined,
            }
          : undefined;

      // Add user message to local UI state
      // For attachments, we show attachment count in the UI
      // The actual file references are stored in trace as attachment events
      let displayContent = userMsg;
      if (voiceRecordings && !userMsg.trim()) {
        displayContent = t('chat:input.voiceMessage', '🎤 Voice message');
      }
      const userMsgObject = { role: 'user', content: displayContent, isVoiceMessage: !!voiceRecordings };
      setMessages((prev) => [...prev, userMsgObject]);

      // Clear staged items after attaching to message
      if (stagedItems.length > 0) {
        setStagedItems([]);
        if (cid) {
          clearStagedItems(cid);
        }
      }

      // Store user message in DynamoDB
      if (numaChatDynamoUtils) {
        // If this is the first message in an agent conversation, save the agent's welcome message first
        if (pendingAgent && messages.length === 1 && messages[0].role === 'assistant') {
          try {
            await numaChatDynamoUtils.addMessage({
              conversationId: cid,
              userId: sub,
              messageType: 'text',
              role: 'assistant',
              content: messages[0].content,
            });
          } catch (err) {
            console.error('Error storing agent welcome message:', err);
          }
        }

        await numaChatDynamoUtils
          .addMessage({
            conversationId: cid,
            userId: sub,
            messageType: 'text',
            role: 'user',
            content: userMsg,
          })
          .catch((err) => console.error('Error storing user message:', err));

        if (pendingAgent?.referenceFiles?.length) {
          for (const file of pendingAgent.referenceFiles) {
            try {
              await numaChatDynamoUtils.addFileMessage({
                conversationId: cid,
                userId: sub,
                fileName: file.fileName,
                fileType: file.fileType,
                s3Key: file.s3Key,
                s3Bucket: file.s3Bucket,
                extractedContentS3Key: file.extractedContentS3Key,
                messageContext: 'agent_reference',
              });
            } catch (fileErr) {
              console.error('Failed to attach agent reference file to conversation', fileErr);
            }
          }
          setPendingAgent(null);
        }
      }

      const { enabledTools } = configureAgentCall(
        autoToolsEnabled,
        webSearchEnabled,
        createAgentEnabled,
        idToken,
        user,
        sub
      );

      // Show "processing…" spinner while waiting for any response from backend.
      // The chat-health donut keeps showing the previous turn's authoritative
      // value until message_start arrives with real usage data.
      const processingMessage = { role: 'assistant', segments: [], status: 'processing' };
      setMessages((prev) => [...prev, processingMessage]);

      // Reset streaming helpers for this turn
      resetStreamingState();

      // Workspace agent type pinned to this conversation (e.g. Support popup
      // conversations run on numa-chat-support). Undefined = default numa-chat.
      const conversationAgentType = getConversationAgentType(cid);

      // Support conversations are email-only: never advertise or enable
      // non-email integrations even if the user has others connected, so the
      // agent only ever offers to send the escalation email (not, say, Slack).
      const isSupport = conversationAgentType === SUPPORT_AGENT_TYPE;
      const turnEnabledIntegrations = isSupport
        ? enabledIntegrationsUnified.filter((it) => SUPPORT_EMAIL_INTEGRATION_SLUGS.has(it.slug))
        : enabledIntegrationsUnified;
      const turnAvailableIntegrations = isSupport
        ? availableIntegrationsUnified.filter((it) => SUPPORT_EMAIL_INTEGRATION_SLUGS.has(it.slug))
        : availableIntegrationsUnified;

      // Call workspace streaming hook
      await streamChat({
        prompt: userMsg,
        conversationId: cid,
        enabledTools: ensureToolsForAgentType(enabledTools, conversationAgentType),
        enabledIntegrations: turnEnabledIntegrations,
        availableIntegrations: turnAvailableIntegrations,
        enabledKBIds,
        availableKBs,
        attachments,
        modelId: selectedModelId,
        migrateFromV1: needsV1Migration,
        agentId: activeAgent?.agentId,
        type: conversationAgentType,
        voiceRecordings,
      });
      // Clear the V1 migration flag after first message (migration happens on first request)
      if (needsV1Migration) {
        setNeedsV1Migration(false);
        sessionStorage.setItem('isWorkspaceConversation-v2', 'true'); // Now it's V2
      }
    } catch (err) {
      console.error('Error invoking Chat Agent:', err);
      console.error('Full error details:', JSON.stringify(err, null, 2));
      isProcessingRef.current = false; // Reset processing flag on error
      setCurrentAbort(null); // Clear abort reference
      const message = resolveErrorMessage(err, 'Failed to send message');
      const errorMsg = {
        role: 'system',
        content: `Error: ${message}. Please try again or refresh page.`,
      };
      setMessages((prev) => [...prev, errorMsg]);
      setButtonStatus('idle');
    }
  };

  // Chat-health derivation at page level so we can drive the red-state banner
  // (the indicators next to the input get their own copy via the slot prop).
  const chatHealthForBanner = useChatHealth(messages, selectedModelId);

  // Reset the banner dismissal whenever the user opens a different conversation
  // so the warning re-surfaces on revisit (per spec: "if a user opens the
  // conversation again in future").
  useEffect(() => {
    setChatHealthBannerDismissed(false);
  }, [conversationId]);

  // Stable ref to the latest handleSubmit so the queued-submit watcher doesn't need
  // it as a dependency (handleSubmit is recreated on every render and would loop).
  const handleSubmitRef = useRef(handleSubmit);
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  });

  // Stable prompt-send handler for the message list (BUG-194: an inline arrow here
  // defeated React.memo on ChatMessages on every keystroke). Reads handleSubmit via
  // ref so it never needs to be recreated.
  const handleSendPromptFromChat = useCallback((text: string) => {
    handleSubmitRef.current({ preventDefault: () => {} } as React.FormEvent, text);
  }, []);

  // Auto-fire any queued submit once uploads + staging finish.
  useEffect(() => {
    const activeUploads = uploadingFiles.filter((f) => f.status === 'uploading').length + pendingUploadIntents;
    if (activeUploads === 0 && pendingSubmitRef.current !== null && !isProcessingRef.current) {
      const queued = pendingSubmitRef.current;
      pendingSubmitRef.current = null;
      setPendingSubmitDisplay(null);
      handleSubmitRef.current({ preventDefault: () => {} } as React.FormEvent, queued);
    }
  }, [uploadingFiles, pendingUploadIntents]);

  // Handle quick action button clicks
  // Quick actions either prefill the input for user completion or send immediately
  const handleQuickAction = useCallback(
    (action: QuickActionConfig) => {
      if (action.behavior === 'prefill') {
        // Set the prompt text and focus the input so user can complete it
        setChatDraft(action.prompt);
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            // Move cursor to end of text
            const len = action.prompt.length;
            inputRef.current.setSelectionRange(len, len);
          }
        }, 0);
      } else {
        // Send behavior - pass message directly to handleSubmit to avoid state timing issues
        const syntheticEvent = { preventDefault: () => {} };
        handleSubmit(syntheticEvent, action.prompt);
      }
    },
    [handleSubmit]
  );

  // Load single conversation from DB using extracted utility
  const handleLoadConversation = async (selectedConversationId: string, isWorkspaceConversation = true) => {
    if (!numaChatDynamoUtils) return;

    // Abort any ongoing stream before switching conversations
    abortStream();
    isProcessingRef.current = false;
    resetStreamingState();
    setButtonStatus('idle');

    // Capture generation so we can detect if new chat was clicked during this load
    const generation = loadGenerationRef.current;
    const isCancelled = () => loadGenerationRef.current !== generation;

    setIsManuallyLoading(true);
    setIsConversationLoading(true);
    setUserSettingsModified(false); // Reset so save effect doesn't fire with stale state from previous conversation
    setMessages([]); // Clear current messages immediately
    resetUserNewChatFlag(); // Reset the flag since user is explicitly loading a conversation
    setIsPreMintedConversation(false); // Clear pre-minted state - user is loading a different conversation

    // This is a user interaction
    resetInactivityTimer();
    // Hide suggestions when loading a conversation
    hideSuggestions();
    // Close any open split-screen previews (document or file) from the previous conversation
    closeDocument();
    setShowSplitView(false);
    closeFilePreview();
    // Clear output panel files immediately so stale files from previous conversation aren't visible during trace load
    settingsPanel.clearFiles();

    try {
      // V2 workspace conversations: load from trace file
      if (isWorkspaceConversation) {
        try {
          const rawTrace = await getWorkspaceChatRawTrace(selectedConversationId, getIdToken);
          if (isCancelled()) return;
          // Parse raw trace using same logic as live streaming
          const chatMessages = parseRawTraceToMessages(rawTrace);

          setMessages(chatMessages);
          setConversationId(selectedConversationId);
          sessionStorage.setItem('currentConversationId-v2', selectedConversationId);
          sessionStorage.setItem('isWorkspaceConversation-v2', 'true'); // Mark as V2 for auto-load
          autoNamingAttemptedRef.current.set(selectedConversationId, Infinity);
          // This is a V2 conversation, clear any migration flag
          setNeedsV1Migration(false);

          // Check if the agent is still actively running for this conversation.
          // This handles the case where the user refreshed or navigated away mid-stream.
          try {
            const statusData = await checkConversationStatus(selectedConversationId, getIdToken);
            if (isCancelled()) return;

            if (statusData.status === 'running' && statusData.active) {
              // Agent is still processing -- block input (loading disables send button)
              isProcessingRef.current = true;
              setButtonStatus('loading');
              setMessages((prev) => [
                ...prev,
                {
                  role: 'system',
                  content: t('systemMessages.agentFinishing'),
                  status: 'agentFinishing',
                },
              ]);

              // Poll in the background until the agent finishes
              pollConversationUntilComplete(
                selectedConversationId,
                {
                  intervalMs: 3000,
                  timeoutMs: 3_600_000,
                },
                getIdToken
              )
                .then(async () => {
                  if (isCancelled()) return;
                  // Agent finished -- reload the full trace
                  try {
                    const updatedTrace = await getWorkspaceChatRawTrace(selectedConversationId, getIdToken);
                    if (isCancelled()) return;
                    const updatedMessages = parseRawTraceToMessages(updatedTrace);
                    setMessages(updatedMessages);
                    refreshSidebar();
                    notifyCompletion();
                  } catch (reloadErr) {
                    console.error('[WorkspaceChat] Failed to reload trace after agent completed:', reloadErr);
                  }
                })
                .catch((err) => {
                  if (err instanceof DOMException && err.name === 'AbortError') return;
                  console.error('[WorkspaceChat] Status polling error:', err);
                })
                .finally(() => {
                  if (!isCancelled()) {
                    isProcessingRef.current = false;
                    setButtonStatus('idle');
                  }
                });
            }
          } catch (statusErr) {
            // Non-critical: status check failure shouldn't block conversation loading
            console.warn('[WorkspaceChat] Status check failed, proceeding normally:', statusErr);
          }

          // Fetch conversation metadata from DynamoDB to restore agent state
          try {
            const conversationHistory = await numaChatDynamoUtils.queryConversations(
              selectedConversationId,
              1000, // Must be large enough to include the meta record (oldest item, query is newest-first)
              sub
            );
            if (isCancelled()) return;
            const metaItem = conversationHistory.find(
              (item: { message_type?: string }) => item.message_type === 'meta'
            );

            // Restore the workspace agent type pin (e.g. Support conversations
            // run on numa-chat-support) so subsequent turns keep using the
            // right backend agent type even in a fresh session where the
            // sessionStorage pin from the popup no longer exists.
            if (metaItem?.workspaceAgentType && typeof metaItem.workspaceAgentType === 'string') {
              sessionStorage.setItem(
                `${CONVERSATION_AGENT_TYPE_KEY_PREFIX}${selectedConversationId}`,
                metaItem.workspaceAgentType
              );
            }

            if (metaItem?.isAgentConversation && metaItem?.agentId) {
              try {
                const agent = await getAgent(numaGet, metaItem.agentId);
                if (isCancelled()) return;
                setCurrentAgent(agent);
                setPendingAgent(null);
                applyAgentConfiguration(agent);
              } catch (agentErr) {
                console.error('Failed to hydrate agent for V2 conversation', agentErr);
                if (!isCancelled()) resetAgentState();
              }
            } else {
              // Clear agent state without applying defaults — let chatConfig handle it
              setCurrentAgent(null);
              setPendingAgent(null);
              setAgentError(null);
            }

            // Restore per-conversation chat settings (integrations, KBs, tools).
            // Support conversations are settings-pinned by their agent type —
            // ignore any saved chatConfig and apply the support configuration
            // (the backend enforces it regardless of what the panel says).
            const isSupportConversationMeta = metaItem?.workspaceAgentType === SUPPORT_AGENT_TYPE;
            const v2ChatConfig = isSupportConversationMeta ? null : (metaItem?.chatConfig ?? null);
            setPendingConversationChatConfig((v2ChatConfig as ConversationChatConfig) || null);

            if (isSupportConversationMeta) {
              applySupportConfiguration();
            } else if (!v2ChatConfig && !(metaItem?.isAgentConversation && metaItem?.agentId)) {
              // If no saved chatConfig and no agent, apply user defaults
              applyAgentConfiguration(null);
            }
          } catch (metaErr) {
            console.error('Failed to fetch V2 conversation metadata:', metaErr);
            if (!isCancelled()) resetAgentState();
          }
        } catch (wsError) {
          if (isCancelled()) return;
          console.error('Error loading V2 workspace conversation trace:', wsError);
          // This is a known V2 workspace conversation — do NOT fall back to V1.
          // Network errors (e.g. interrupted requests, HTTP/2 errors after stop+refresh)
          // should not reclassify a workspace conversation as V1.
          setConversationId(selectedConversationId);
          sessionStorage.setItem('currentConversationId-v2', selectedConversationId);
          sessionStorage.setItem('isWorkspaceConversation-v2', 'true');
          setNeedsV1Migration(false);
          setMessages([
            {
              role: 'system',
              content: t('systemMessages.loadTraceFailed'),
            },
          ]);
          resetAgentState();
        }
      } else {
        // V1 conversation: load directly from DynamoDB (skip trace fetch entirely)
        if (!isCancelled()) {
          await loadV1Conversation(selectedConversationId);
        }
      }
    } catch (error) {
      if (isCancelled()) return;
      console.error('Error loading conversation:', error);
      // Show error message to user
      setMessages([
        {
          role: 'system',
          content: t('systemMessages.loadConversationFailed'),
        },
      ]);
      resetAgentState();
    } finally {
      if (!isCancelled()) {
        setIsConversationLoading(false);
        setIsManuallyLoading(false);
        // Mark this conversation as loaded to prevent infinite reload loop
        lastLoadedConversationRef.current = selectedConversationId;
      }
    }
  };

  // Helper function to load V1 conversations from DynamoDB
  const loadV1Conversation = async (selectedConversationId: string) => {
    const {
      messages: chatMessages,
      agentMeta,
      chatConfig,
    } = await loadConversation(selectedConversationId, numaChatDynamoUtils, sub, getAccessToken);
    setMessages(chatMessages);
    setConversationId(selectedConversationId);
    sessionStorage.setItem('currentConversationId-v2', selectedConversationId);
    sessionStorage.setItem('isWorkspaceConversation-v2', 'false'); // V1 until migrated
    setPendingConversationChatConfig((chatConfig as ConversationChatConfig) || null);
    autoNamingAttemptedRef.current.set(selectedConversationId, Infinity);
    // Mark this conversation as needing V1 to V2 migration on first message
    setNeedsV1Migration(true);

    if (agentMeta?.agentId) {
      try {
        const agent = await getAgent(numaGet, agentMeta.agentId);
        setCurrentAgent(agent);
        setPendingAgent(null);
        applyAgentConfiguration(agent);
      } catch (err) {
        console.error('Failed to hydrate agent for conversation', err);
        resetAgentState();
      }
    } else {
      setCurrentAgent(null);
      setPendingAgent(null);
      setAgentError(null);
      if (!chatConfig) {
        applyAgentConfiguration(null);
      }
    }
  };

  // Derived flag to show warning when no tools active in manual mode
  const noToolsActive =
    !currentAgent &&
    !autoToolsEnabled &&
    enabledKBIds.length === 0 &&
    !webSearchEnabled &&
    !createAgentEnabled &&
    !memoriesEnabled &&
    !numaOpsEnabled &&
    enabledNativeConnectorIds.length === 0;

  // Derived active agent for header display (pending takes priority during transitions)
  const activeAgent = pendingAgent || currentAgent;

  // Typed conversations (Support popup) show the type's title in the header
  // like a saved agent would. Driven by the per-conversation type pin, which
  // is set by the popup/draft handoff and restored from the conversation meta
  // record on load — so it survives refreshes and new sessions.
  const isSupportConversation = getConversationAgentType(conversationId) === SUPPORT_AGENT_TYPE;
  const headerTitle = activeAgent?.title || (isSupportConversation ? tSupport('popup.title') : t('page.title'));
  const headerSubtitle =
    activeAgent?.description ||
    (isSupportConversation
      ? tSupport('subtitle')
      : t('page.subtitle', { defaultValue: 'Your AI workspace assistant' }));

  // Legacy helper: push buffered text as its own segment then clear buffer, and save to DynamoDB
  // Kept for V1 compatibility but unused in workspace mode (handled by useWorkspaceStreaming hook)
  const _flushPendingText = (currentConversationId = null, preserveContent = false) => {
    if (!streamingHandler.textBufferRef.current.trim()) {
      return; // Only flush if there's actual content
    }

    const textToSave = streamingHandler.textBufferRef.current;

    // ALWAYS save to DynamoDB first, regardless of preserve/duplicate logic
    const cidToUse = currentConversationId || conversationId;
    if (numaChatDynamoUtils && cidToUse && sub && textToSave.trim()) {
      numaChatDynamoUtils
        .addMessage({
          conversationId: cidToUse,
          userId: sub,
          messageType: 'text',
          role: 'assistant',
          content: textToSave,
        })
        .catch((err) => console.error('Error saving text segment:', err));
    }

    // Prevent double-flushing UI updates in final completion phase
    if (preserveContent && streamingHandler.finalFlushPerformedRef.current) {
      return;
    }

    if (preserveContent) {
      streamingHandler.finalFlushPerformedRef.current = true;
    }

    // Finalize the current live text segment (mark it as saved and finalized)
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      const lastMsg = { ...updated[lastIdx] };
      const segs = [...(lastMsg.segments || [])];

      // Find and finalize the last text segment if it exists
      if (segs.length && segs[segs.length - 1].kind === 'text' && !segs[segs.length - 1].finalized) {
        // Preserve the final text content when finalizing at stream end
        const finalText = preserveContent ? textToSave : segs[segs.length - 1].text;
        segs[segs.length - 1] = {
          ...segs[segs.length - 1],
          text: finalText,
          finalized: true,
        };
        lastMsg.segments = segs;
        lastMsg.content = finalText; // Update legacy content field too
        updated[lastIdx] = lastMsg;
      }

      return updated;
    });

    // Clear the text buffer only if not preserving content
    if (!preserveContent) {
      streamingHandler.textBufferRef.current = '';
    }
  };

  const renderActionButtons = () => (
    <>
      <button
        type="button"
        className="workspace-chat-history-btn"
        onClick={() => void handleHeaderNewChat()}
        title={t('page.newChat')}
        aria-label={t('page.newChat')}
      >
        <Plus size={14} className="workspace-chat-header-btn-icon" />
        <span>{t('page.newChat')}</span>
      </button>

      <button
        type="button"
        className={`workspace-chat-history-btn chat-history-btn ${isHistoryPanelOpen ? 'is-open' : ''}`}
        onClick={handleToggleHistory}
        title={t('page.chatHistory')}
        aria-label={t('page.chatHistory')}
      >
        <Clock size={14} className="workspace-chat-header-btn-icon" />
        <span>{t('page.historyButton')}</span>
      </button>

      {agentsFeatureEnabled && (
        <button
          type="button"
          className={`workspace-chat-history-btn ${isAgentsPanelOpen ? 'is-open' : ''}`}
          onClick={handleToggleAgents}
          title={t('page.agentsButton')}
          aria-label={t('page.agentsButton')}
        >
          <Bot size={14} className="workspace-chat-header-btn-icon" />
          <span>{t('page.agentsButton')}</span>
        </button>
      )}

      {conversationId && (
        <ExportConversationButton
          messages={messages}
          conversationId={conversationId}
          agentName={currentAgent?.title}
          agentId={currentAgent?.agentId}
          userId={sub}
          userEmail={userEmail}
          environment={window.location.hostname}
          getCredentials={getCredentials}
        />
      )}

      {!isMobile && (
        <button
          type="button"
          className={`workspace-chat-settings-btn ${settingsPanel.isPanelOpen ? 'is-open' : ''}`}
          onClick={handleToggleSettings}
          title={t('input.tooltips.settings')}
          aria-label={t('input.tooltips.settings')}
          aria-pressed={settingsPanel.isPanelOpen}
        >
          <Settings size={18} />
        </button>
      )}
    </>
  );

  const mobileActionsPanelId = 'mobile-chat-actions-panel';
  const handleMobileActionClick = () => setShowMobileActions(false);

  // Ensure mobile actions start collapsed on mount/navigation
  useEffect(() => {
    setShowMobileActions(false);
  }, []);

  // Close mobile actions when clicking/tapping outside
  useEffect(() => {
    if (!isMobile || !showMobileActions) return;

    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.mobile-chat-actions')) return;
      setShowMobileActions(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [isMobile, showMobileActions]);

  return (
    <div
      className={`dashboard workspace-chat-v2 ${!isMobile && (settingsPanel.isPanelOpen || isHistoryPanelOpen || isAgentsPanelOpen) ? 'settings-drawer-open' : ''}`}
    >
      <LayoutDashboard>
        {isMobile && (
          <ChatHistorySidebar
            ref={chatHistoryRef}
            onSelectConversation={handleLoadConversation}
            currentConversationId={conversationId}
            setError={(error) => console.error('Chat history error:', error)}
          />
        )}

        <div className="chat-layout d-flex">
          <div className="flex-grow-1 d-flex flex-column min-h-0">
            {/* Desktop header */}
            {!isMobile && (
              <PageHeader
                title={headerTitle}
                subtitle={
                  showCostTotal
                    ? `${headerSubtitle} · ${t('cost.runningTotal', { cost: chatCostTotal.toFixed(4) })}`
                    : headerSubtitle
                }
                icon={
                  activeAgent
                    ? {
                        element: <AgentAvatar agent={activeAgent} size={36} />,
                      }
                    : undefined
                }
                actionsClassName="workspace-chat-header-actions"
                actions={<>{renderActionButtons()}</>}
              />
            )}

            {/* Mobile action toggle lives just below the nav bar */}
            {isMobile && !shouldShowNewChatView && (
              <div className="mobile-chat-actions">
                <button
                  type="button"
                  className={`mobile-actions-toggle ${showMobileActions ? 'open' : ''}`}
                  onClick={() => setShowMobileActions((open) => !open)}
                  aria-expanded={showMobileActions}
                  aria-controls={mobileActionsPanelId}
                  aria-label={showMobileActions ? t('page.mobileActions.hide') : t('page.mobileActions.show')}
                >
                  <span className="toggle-icon">
                    <i className="bi bi-plus"></i>
                  </span>
                </button>
                <Collapse in={showMobileActions}>
                  <div id={mobileActionsPanelId} className="mobile-actions-panel">
                    <div
                      className="d-flex flex-wrap gap-2 workspace-chat-header-actions"
                      onClick={handleMobileActionClick}
                    >
                      {renderActionButtons()}
                    </div>
                  </div>
                </Collapse>
              </div>
            )}

            <Modal show={!!missingConfirm} onHide={() => setMissingConfirm(null)} centered>
              <Modal.Header closeButton>
                <Modal.Title>{t('page.missingIntegrations.title')}</Modal.Title>
              </Modal.Header>
              <Modal.Body>
                <p className="mb-3">{t('page.missingIntegrations.body')}</p>
                <div className="d-flex flex-column gap-2 mb-3">
                  {missingConfirm?.missing.map((id) => {
                    const config = getConnectionConfig(id);
                    return (
                      <div
                        key={id}
                        className="d-flex align-items-center gap-3 p-3 border rounded-2 bg-light"
                        style={{ transition: 'all 0.2s ease' }}
                      >
                        {config?.img_src ? (
                          <img
                            src={config.img_src}
                            alt={config.name}
                            style={{ width: 32, height: 32, objectFit: 'contain', flexShrink: 0 }}
                          />
                        ) : (
                          <div
                            className="rounded-2 bg-secondary bg-opacity-10 d-flex align-items-center justify-content-center"
                            style={{ width: 32, height: 32, flexShrink: 0 }}
                          >
                            <i className="bi bi-link text-secondary"></i>
                          </div>
                        )}
                        <span className="fw-medium">{config?.name || id}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mb-0 text-muted small">{t('page.missingIntegrations.note')}</p>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="outline-secondary" onClick={() => setMissingConfirm(null)} className="me-auto">
                  <i className="bi bi-arrow-left me-2"></i>
                  {t('page.missingIntegrations.back')}
                </Button>
                <a className="btn btn-outline-primary" href="/integrations">
                  <i className="bi bi-link-45deg me-2"></i>
                  {t('page.missingIntegrations.goToIntegrations')}
                </a>
                <Button
                  variant="primary"
                  onClick={async () => {
                    const info = missingConfirm;
                    setMissingConfirm(null);
                    if (info) await doStartAgentSession(info.agent, info.missing);
                  }}
                >
                  {t('page.missingIntegrations.continueWithout')}
                </Button>
              </Modal.Footer>
            </Modal>

            {agentError && (
              <Alert variant="warning" className="py-2" onClose={() => setAgentError(null)} dismissible>
                {agentError}
              </Alert>
            )}

            <div className="chat-container position-relative flex-grow-1">
              <ResizableSplitView
                left={
                  <div
                    className="chat-left-pane d-flex flex-column h-100"
                    style={{ position: 'relative' }}
                    onDragEnter={handleChatDragEnter}
                    onDragOver={handleChatDragOver}
                    onDragLeave={handleChatDragLeave}
                    onDrop={handleChatDrop}
                  >
                    {/* Drag-and-drop overlay */}
                    {isDraggingFiles && (
                      <div className="chat-drag-overlay">
                        <div className="chat-drag-overlay-content">
                          <i className="bi bi-cloud-arrow-up chat-drag-overlay-icon" />
                          <span className="chat-drag-overlay-text">{t('workspace.fileUpload.dropOverlay')}</span>
                        </div>
                      </div>
                    )}

                    {isInitializing && (
                      <div className="workspace-chat-initializing">
                        <div className="spinner-border spinner-border-sm" role="status">
                          <span className="visually-hidden">
                            {t('page.initializing', { defaultValue: 'Initializing' })}
                          </span>
                        </div>
                        <span>{t('page.initializingWorkspace')}</span>
                      </div>
                    )}

                    {!isOnline && (
                      <div
                        className="workspace-chat-network-banner workspace-chat-network-banner--offline"
                        role="alert"
                      >
                        <i className="bi bi-wifi-off" />
                        <span>{t('chat:connection.offline')}</span>
                      </div>
                    )}

                    {isReconnecting && (
                      <div
                        className="workspace-chat-network-banner workspace-chat-network-banner--reconnecting"
                        role="status"
                      >
                        <div className="spinner-border spinner-border-sm" role="status">
                          <span className="visually-hidden">{t('chat:connection.reconnecting')}</span>
                        </div>
                        <span>
                          {t('chat:connection.reconnectingAttempt', {
                            attempt: retryAttempt + 1,
                            maxAttempts: maxRetryAttempts,
                          })}
                        </span>
                      </div>
                    )}

                    {canRetry && !isReconnecting && (
                      <div className="workspace-chat-network-banner workspace-chat-network-banner--retry" role="alert">
                        <i className="bi bi-exclamation-triangle" />
                        <span>{t('chat:connection.retryFailed', { maxAttempts: maxRetryAttempts })}</span>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary ms-2"
                          onClick={retryLastMessage}
                          disabled={!isOnline}
                        >
                          {t('chat:connection.retry')}
                        </button>
                      </div>
                    )}

                    {!shouldShowNewChatView && <ChatHealthTopBar state={chatHealthForBanner} />}

                    {isFirstMessagePending && (
                      <div className="workspace-chat-first-message-banner" role="status">
                        <div className="spinner-border spinner-border-sm" role="status">
                          <span className="visually-hidden">{t('page.loading')}</span>
                        </div>
                        <span>{t('page.firstMessageInitializing')}</span>
                      </div>
                    )}

                    <div
                      className={`chat-messages flex-grow-1 overflow-auto ${shouldShowNewChatView ? 'chat-messages--new-chat' : ''} ${
                        showLegacyMigrationNotice ? 'chat-messages--with-legacy-migration-notice' : ''
                      }`}
                    >
                      {isConversationLoading ? (
                        <div className="d-flex justify-content-center align-items-center h-100">
                          <div className="text-center">
                            <div className="spinner-border text-primary" role="status">
                              <span className="visually-hidden">{t('page.loading', { defaultValue: 'Loading' })}</span>
                            </div>
                            <p className="mt-2 text-muted">
                              {t('page.loadingConversation', { defaultValue: 'Loading conversation...' })}
                            </p>
                          </div>
                        </div>
                      ) : shouldShowNewChatView ? (
                        <NewChatWithDraft
                          handleSubmit={handleSubmit}
                          setShowUploadModal={() => handleUploadWithConversationMint()}
                          buttonStatus={buttonStatus}
                          webSearchEnabled={webSearchEnabled}
                          setWebSearchEnabled={handleUserSetWebSearchEnabled}
                          createAgentEnabled={agentsFeatureEnabled ? createAgentEnabled : false}
                          setCreateAgentEnabled={handleUserSetCreateAgentEnabled}
                          autoToolsEnabled={autoToolsEnabled}
                          setAutoToolsEnabled={handleUserSetAutoToolsEnabled}
                          availableConnections={availableConnections}
                          enabledConnections={enabledConnections}
                          setEnabledConnections={handleUserSetEnabledConnections}
                          selectedAccountsByApp={selectedAccountsByApp}
                          setSelectedAccountsByApp={setSelectedAccountsByApp}
                          connectionsLoading={connectionsLoading}
                          hasPipedreamFeature={hasPipedreamFeature}
                          uploadsInProgress={isFileProcessing || hasUploadsInProgress}
                          noToolsActive={noToolsActive}
                          inputRef={inputRef}
                          recentConversations={recentConversations}
                          hideSuggestions={hideSuggestions}
                          onContinueConversation={handleLoadConversation}
                          suggestionsLoading={suggestionsLoading}
                          userName={userName}
                          onRenameConversation={handleRenameConversation}
                          onDeleteConversation={handleDeleteConversation}
                          personalAgents={agentsFeatureEnabled ? sortedPersonalAgents : []}
                          onSelectAgent={handleAgentSelect}
                          agentsLoading={agentsFeatureEnabled ? personalAgentsLoading : false}
                          enabledKBIds={enabledKBIds}
                          setEnabledKBIds={handleUserSetEnabledKBIds}
                          availableKBs={availableKBs}
                          isLoadingKBs={isLoadingKBs}
                          agentsFeatureEnabled={agentsFeatureEnabled}
                          stagedItems={stagedItems}
                          onRemoveStagedItem={async (item: StagedItem) => {
                            const pathsToDelete = getPathsFromStagedItem(item);
                            if (conversationId && pathsToDelete.length > 0) {
                              try {
                                await deleteWorkspaceChatUploads(conversationId, pathsToDelete);
                              } catch (err) {
                                console.error('Error deleting uploads:', err);
                              }
                            }
                            setStagedItems((prev) => {
                              const filtered = prev.filter((i) => {
                                if (item.kind === 'file' && i.kind === 'file') return i.path !== item.path;
                                if (item.kind === 'folder' && i.kind === 'folder') {
                                  return i.folderPath !== item.folderPath;
                                }
                                return true;
                              });
                              if (conversationId) saveStagedItems(conversationId, filtered);
                              return filtered;
                            });
                          }}
                          onStop={stopStream}
                          isStopping={isStopping}
                          variant="v2"
                          selectedModelId={selectedModelId}
                          setSelectedModelId={setSelectedModelId}
                          showModelSelector={false}
                          onQuickAction={handleQuickAction}
                          connectedIntegrations={connectedSet}
                          onOpenHistory={() => {
                            settingsPanel.closePanel();
                            setIsAgentsPanelOpen(false);
                            setIsHistoryPanelOpen(true);
                            localStorage.setItem('numa-sidebar-active', 'history');
                          }}
                          onOpenAgents={() => {
                            settingsPanel.closePanel();
                            setIsHistoryPanelOpen(false);
                            setIsAgentsPanelOpen(true);
                            localStorage.setItem('numa-sidebar-active', 'agents');
                          }}
                          onFilesDropped={(files) => handleDroppedFiles(files.map((f) => ({ file: f })))}
                          uploadingFiles={uploadingFiles}
                          onCancelUpload={handleCancelUpload}
                          queuedSubmitMessage={pendingSubmitDisplay}
                          onCancelQueuedSubmit={() => {
                            const queued = pendingSubmitRef.current ?? '';
                            pendingSubmitRef.current = null;
                            setPendingSubmitDisplay(null);
                            if (queued && !getChatDraft()) setChatDraft(queued);
                          }}
                          voiceInputEnabled={voiceInputEnabled}
                          voiceRecordingState={voiceRecordingState}
                          onVoiceRecordingComplete={handleVoiceRecordingComplete}
                        />
                      ) : (
                        <>
                          {showLegacyMigrationNotice && (
                            <div className="workspace-chat-legacy-migration-overlay" role="alert">
                              <div className="workspace-chat-legacy-migration-card">
                                <div className="workspace-chat-legacy-migration-main">
                                  <i className="bi bi-info-circle-fill workspace-chat-legacy-migration-icon" />
                                  <div className="workspace-chat-legacy-migration-text">
                                    <strong>{t('page.legacyMigration.title')}</strong>
                                    <p>{t('page.legacyMigration.description')}</p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="workspace-chat-legacy-migration-close"
                                  onClick={() => setDismissedLegacyMigrationNotice(true)}
                                  aria-label={t('input.aria.close')}
                                >
                                  <i className="bi bi-x-lg" />
                                </button>
                              </div>
                            </div>
                          )}
                          <ChatMessages
                            messages={messages}
                            messageEndRef={messageEndRef}
                            loadingIndicatorStyle={EMPTY_LOADING_INDICATOR_STYLE}
                            onOpenDocument={handleOpenInlineDocumentFromChat}
                            isConversationLoading={false}
                            currentAgent={currentAgent}
                            conversationId={conversationId}
                            sub={sub}
                            numaChatDynamoUtils={numaChatDynamoUtils}
                            setMessages={setMessages}
                            isWorkspaceMode={true}
                            outputsBucket={OUTPUTS_BUCKET || undefined}
                            region={REGION || undefined}
                            onOpenFilePreview={handleOpenFilePreviewForChat}
                            onOpenFolderPreview={handleOpenFolderPreviewForChat}
                            onSendPrompt={handleSendPromptFromChat}
                          />
                        </>
                      )}
                    </div>

                    {showJumpButton && !shouldShowNewChatView && <JumpToLatestButton onClick={handleJumpToLatest} />}

                    {!shouldShowNewChatView && (
                      <ChatHealthBanner
                        show={chatHealthForBanner.alarmBand === 'red' && !chatHealthBannerDismissed}
                        onDismiss={() => setChatHealthBannerDismissed(true)}
                      />
                    )}

                    {!shouldShowNewChatView && (
                      <div className="chat-input-wrapper">
                        {pendingSubmitDisplay !== null && (
                          <QueuedSubmitBanner
                            message={pendingSubmitDisplay}
                            onCancel={() => {
                              const queued = pendingSubmitRef.current ?? '';
                              pendingSubmitRef.current = null;
                              setPendingSubmitDisplay(null);
                              if (queued && !getChatDraft()) setChatDraft(queued);
                            }}
                          />
                        )}
                        {(stagedItems.length > 0 || uploadingFiles.length > 0) && (
                          <PendingFilesBar
                            items={stagedItems}
                            onRemove={async (item: StagedItem) => {
                              const pathsToDelete = getPathsFromStagedItem(item);
                              if (conversationId && pathsToDelete.length > 0) {
                                try {
                                  await deleteWorkspaceChatUploads(conversationId, pathsToDelete);
                                } catch (e) {
                                  console.error('Failed to delete uploads:', e);
                                }
                              }
                              setStagedItems((prev) => {
                                const filtered = prev.filter((i) => {
                                  if (i.kind === 'folder' && item.kind === 'folder') {
                                    return i.folderPath !== item.folderPath;
                                  }
                                  if (i.kind === 'file' && item.kind === 'file') {
                                    return i.path !== item.path;
                                  }
                                  return true;
                                });
                                if (conversationId) {
                                  saveStagedItems(conversationId, filtered);
                                }
                                return filtered;
                              });
                            }}
                            uploadingFiles={uploadingFiles}
                            onCancelUpload={handleCancelUpload}
                          />
                        )}
                        <ChatSuggestionPills
                          suggestions={chatSuggestions.suggestions}
                          onPick={(text) => {
                            const syntheticEvent = { preventDefault: () => {} };
                            handleSubmit(syntheticEvent, text);
                          }}
                          debugInfo={
                            showCostTotal
                              ? {
                                  lastUsage: chatSuggestions.lastUsage,
                                  sessionCostUsd: chatSuggestions.sessionCostUsd,
                                }
                              : null
                          }
                        />
                        <ChatInputWithDraft
                          handleSubmit={handleSubmit}
                          setShowUploadModal={() => handleUploadWithConversationMint()}
                          buttonStatus={buttonStatus}
                          webSearchEnabled={webSearchEnabled}
                          setWebSearchEnabled={handleUserSetWebSearchEnabled}
                          createAgentEnabled={agentsFeatureEnabled ? createAgentEnabled : false}
                          setCreateAgentEnabled={handleUserSetCreateAgentEnabled}
                          autoToolsEnabled={autoToolsEnabled}
                          setAutoToolsEnabled={handleUserSetAutoToolsEnabled}
                          availableConnections={availableConnections}
                          enabledConnections={enabledConnections}
                          setEnabledConnections={handleUserSetEnabledConnections}
                          selectedAccountsByApp={selectedAccountsByApp}
                          setSelectedAccountsByApp={setSelectedAccountsByApp}
                          connectionsLoading={connectionsLoading}
                          hasPipedreamFeature={hasPipedreamFeature}
                          uploadsInProgress={isFileProcessing || hasUploadsInProgress}
                          noToolsActive={noToolsActive}
                          externalInputRef={inputRef}
                          autoFocus={true}
                          enabledKBIds={enabledKBIds}
                          setEnabledKBIds={handleUserSetEnabledKBIds}
                          selectedModelId={selectedModelId}
                          setSelectedModelId={setSelectedModelId}
                          showModelSelector={false}
                          onStop={stopStream}
                          isStopping={isStopping}
                          variant="v2"
                          onPasteFiles={(files) => handleDroppedFiles(files.map((f) => ({ file: f })))}
                          hasStagedAttachments={uploadedFiles.length > 0 || stagedItems.length > 0}
                          voiceInputEnabled={voiceInputEnabled}
                          voiceRecordingState={voiceRecordingState}
                          onVoiceRecordingComplete={handleVoiceRecordingComplete}
                          chatHealthSlot={
                            <>
                              <ChatHealthIndicators
                                messages={messages}
                                modelId={selectedModelId}
                                debugMode={showCostTotal}
                              />
                              {creditsIndicatorEnabled && (
                                <ChatValueIndicator
                                  conversationId={conversationId}
                                  streaming={buttonStatus === 'streaming'}
                                  numaGet={numaGet}
                                />
                              )}
                            </>
                          }
                        />
                      </div>
                    )}
                  </div>
                }
                right={
                  showFilePreview && filePreview ? (
                    <FilePreviewPanel
                      preview={filePreview}
                      onClose={handleCloseFilePreview}
                      bucket={OUTPUTS_BUCKET || ''}
                      region={REGION || ''}
                      getCredentials={getCredentials}
                      initialContent={inlinePreviewContent ?? undefined}
                    />
                  ) : null
                }
                showRight={showFilePreview && !!filePreview}
                leftFraction={showFilePreview && filePreview ? filePreviewLeftFraction : leftFraction}
                onLeftFractionChange={showFilePreview && filePreview ? setFilePreviewLeftFraction : setLeftFraction}
                minLeft={200}
                minRight={200}
                rightPadding="0"
              />
            </div>
          </div>
        </div>
      </LayoutDashboard>

      {!isMobile && (
        <aside
          className={`workspace-chat-settings-drawer ${settingsPanel.isPanelOpen || isHistoryPanelOpen || isAgentsPanelOpen ? 'is-open' : ''}`}
          aria-label={
            isHistoryPanelOpen
              ? t('history.title')
              : isAgentsPanelOpen
                ? t('agentsPanel.title')
                : t('newChat.tabs.settings')
          }
          aria-hidden={!(settingsPanel.isPanelOpen || isHistoryPanelOpen || isAgentsPanelOpen)}
        >
          <WorkspaceChatHistoryPanel
            ref={historyPanelRef}
            isOpen={isHistoryPanelOpen}
            currentConversationId={conversationId}
            onSelectConversation={handleLoadConversation}
          />
          <WorkspaceChatAgentsPanel
            isOpen={isAgentsPanelOpen}
            agents={personalAgents}
            agentsLoading={personalAgentsLoading}
            onSelectAgent={(agent) => {
              handleAgentSelect(agent);
            }}
          />
          <WorkspaceChatSettingsPanel
            isOpen={settingsPanel.isPanelOpen}
            isNewChat={shouldShowNewChatView}
            uploadsFiles={settingsPanel.uploadsFiles}
            outputFiles={settingsPanel.outputFiles}
            outputFileGroups={settingsPanel.outputFileGroups}
            filesLoading={settingsPanel.filesLoading}
            filesError={settingsPanel.filesError}
            onRefreshFiles={settingsPanel.refreshFiles}
            onOpenFile={(file) => {
              // Build full S3 key from relative path
              // S3 structure: numa-chat/workspace/{user_sub}/conversations/{conversation_id}/{relative_path}
              const fullS3Key = `numa-chat/workspace/${sub}/conversations/${conversationId}/${file.path}`;
              openFilePreview({
                filename: file.name,
                fullPath: fullS3Key,
                relativePath: file.path,
                extension: file.name.split('.').pop() || '',
              });
              settingsPanel.closePanel();
              setIsHistoryPanelOpen(false);
              setIsAgentsPanelOpen(false);
            }}
            onDownloadFile={async (file) => {
              const fullS3Key = `numa-chat/workspace/${sub}/conversations/${conversationId}/${file.path}`;
              try {
                await downloadFileFromS3(fullS3Key, OUTPUTS_BUCKET || '', REGION || '', getCredentials, file.name);
              } catch (err) {
                console.error('[NumaWorkspaceChatAgents] Failed to download output file:', err);
              }
            }}
            autoToolsEnabled={autoToolsEnabled}
            setAutoToolsEnabled={handleUserSetAutoToolsEnabled}
            webSearchEnabled={webSearchEnabled}
            setWebSearchEnabled={handleUserSetWebSearchEnabled}
            createAgentEnabled={agentsFeatureEnabled ? createAgentEnabled : false}
            setCreateAgentEnabled={handleUserSetCreateAgentEnabled}
            memoriesEnabled={memoriesEnabled}
            setMemoriesEnabled={handleUserSetMemoriesEnabled}
            numaOpsEnabled={numaOpsFeatureEnabled ? numaOpsEnabled : false}
            setNumaOpsEnabled={handleUserSetNumaOpsEnabled}
            numaOpsFeatureEnabled={numaOpsFeatureEnabled}
            dataConnectorsFeatureEnabled={dataConnectorsFeatureEnabled}
            agentsFeatureEnabled={agentsFeatureEnabled}
            enabledKBIds={enabledKBIds}
            setEnabledKBIds={handleUserSetEnabledKBIds}
            availableKBs={availableKBs}
            isLoadingKBs={isLoadingKBs}
            enabledConnections={enabledConnections}
            setEnabledConnections={handleUserSetEnabledConnections}
            availableConnections={availableConnections}
            connectionsLoading={connectionsLoading}
            hasPipedreamFeature={hasPipedreamFeature}
            adminConfiguredConnectors={connectedDataConnectors}
            userConnectedConnectorIds={userConnectedConnectorIds}
            enabledNativeConnectorIds={enabledNativeConnectorIds}
            setEnabledNativeConnectorIds={handleUserSetEnabledNativeConnectorIds}
            selectedAccountsByApp={selectedAccountsByApp}
            setSelectedAccountsByApp={setSelectedAccountsByApp}
            isDisabled={buttonStatus === 'streaming' || isFileProcessing || hasUploadsInProgress}
            showModelSelector={workspaceModelSelectionEnabled}
            selectedModelId={selectedModelId}
            setSelectedModelId={setSelectedModelId}
          />
        </aside>
      )}

      {/* Mobile file preview modal */}
      <Modal
        show={isMobile && showFilePreviewModal && !!filePreview}
        onHide={() => {
          setShowFilePreviewModal(false);
          closeFilePreview();
        }}
        fullscreen
        centered
        scrollable
        dialogClassName="file-preview-modal"
      >
        <Modal.Header closeButton>
          <Modal.Title>
            {filePreview?.type === 'folder'
              ? filePreview.name
              : filePreview?.type === 'file'
                ? filePreview.filename
                : 'File Preview'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-0">
          {filePreview && (
            <FilePreviewPanel
              preview={filePreview}
              onClose={() => {
                setShowFilePreviewModal(false);
                closeFilePreview();
                setInlinePreviewContent(null);
              }}
              bucket={OUTPUTS_BUCKET || ''}
              region={REGION || ''}
              getCredentials={getCredentials}
              embedded={true}
              initialContent={inlinePreviewContent ?? undefined}
            />
          )}
        </Modal.Body>
      </Modal>

      {/* File upload (workspace chat mode) */}
      <WorkspaceChatFileUpload
        show={showUploadModal}
        onHide={() => setShowUploadModal(false)}
        conversationId={conversationId || ''}
        getCredentials={getCredentials}
        onUploadComplete={async (responses: WorkspaceChatUploadResponse[]) => {
          // Convert responses to StagedFile format
          const newFiles: StagedFile[] = responses.map((r) => ({
            kind: 'file' as const,
            filename: r.filename,
            path: r.path,
            size: r.size,
            uploadedAt: Date.now(),
          }));

          // Combine with existing files and re-group into folders
          const existingFiles = flattenStagedItems(stagedItems);
          const allFiles = [...existingFiles, ...newFiles];
          const grouped = groupFilesIntoFolders(allFiles);

          // Update state and persist to localStorage
          setStagedItems(grouped);
          if (conversationId) {
            saveStagedItems(conversationId, grouped);
          }

          // If this is a pre-minted conversation, rename it to the first uploaded filename
          // Use 'auto' source so manual renames take precedence
          if (isPreMintedConversation && responses.length > 0 && conversationId && numaChatDynamoUtils) {
            const firstName = responses[0].filename;
            try {
              await numaChatDynamoUtils.updateConversationName(conversationId, sub, firstName, 'auto');
            } catch (err) {
              console.error('Error renaming pre-minted conversation:', err);
            }
          }

          refreshSidebar();
          setShowUploadModal(false);

          // Refresh the settings panel file list to show new uploads
          settingsPanel.refreshFiles();
        }}
      />
    </div>
  );
};

export { NumaWorkspaceChatAgents };
