import { useState, useRef, useEffect, useMemo, useCallback, type ReactNode, type SetStateAction } from 'react';
import { Button, Alert, Modal, Collapse } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { fromWebToken } from '@aws-sdk/credential-providers';
import { useAuth } from '../Providers/AuthProvider';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { ChatHistorySidebar, type ChatHistorySidebarRef } from '../Components/Chat/ChatHistorySidebar';
import { AgentsSidebar, AgentsSidebarHandle } from '../Components/Agents/AgentsSidebar';
import { PageHeader } from '../Components/PageHeader';
import { ChatInput } from '../Components/Chat/ChatInput';
import { DocumentPanel } from '../Components/DocumentPanel';
import { ChatMessages } from '../Components/Chat/ChatMessages';
import { NewChat } from '../Components/Chat/NewChat';
import { MarkdownContent } from '../Components/Renderers/MarkdownContent';
import { ResultActions } from '../Components/ResultActions';
import ResizableSplitView from '../Components/ResizableSplitView';
import { generateSystemPrompt, getEnabledTools } from '../utils/chatSystemPromptUtils';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { getModelId, MODEL_TYPES, isInFallbackMode } from '../utils/bedrockModelConfig';
// Note: streamingProcessors imports moved to useWorkspaceStreaming hook
import { loadConversation } from '../utils/conversationLoader';
import { useConversationManager } from '../hooks/useConversationManager';
import { useStreamingHandler } from '../hooks/useStreamingHandler';
import { useDocumentProcessor } from '../hooks/useDocumentProcessor';
import { useFilePreviewProcessor } from '../hooks/useFilePreviewProcessor';
import { FilePreviewPanel } from '../Components/FilePreviewPanel';
import { useCompanyProfile } from '../hooks/useCompanyProfile';
import { autoNameConversation } from '../utils/autoChatTitle';
import { useChatInactivity } from '../hooks/useChatInactivity';
import { useWorkspaceChatStreaming } from '../hooks/useWorkspaceChatStreaming';
import { useDrawerBackClose } from '../hooks/useDrawerBackClose';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import type { AgentSummary } from '../types/agents';
import { getAgent, listAgents } from '../Services/AgentsService';
import { getConnectionConfig } from '../config/integrationsConfig';
import type { QuickActionConfig } from '../config/quickActionsConfig';
import { sortAgentsByPriority } from '../utils/agentSortingUtils';
import { formatAgentDisplayName } from '../utils/agentUtils';
import { AdminAgentsService, type AgentsMode } from '../Services/AdminAgentsService';
import { ChatSettingsService, type ChatSettings, DEFAULT_CHAT_SETTINGS } from '../Services/ChatSettingsService';
import { AgentAvatar } from '../Components/Agents/AgentAvatar';
import { withPRM } from '../utils/prmUtils';
// Workspace chat mode imports
import { getWorkspaceChatRawTrace } from '../Services/workspaceChatAgentService';
import { parseRawTraceToMessages } from '../utils/workspaceChatEventHandlers';
// Note: SDK event handling moved to useWorkspaceChatStreaming hook
import { WorkspaceChatFileUpload } from '../Components/WorkspaceChat/WorkspaceChatFileUpload';
import { WorkspaceChatSettingsPanel } from '../Components/WorkspaceChat/WorkspaceChatSettingsPanel';
import { useWorkspaceChatSettingsPanel } from '../hooks/useWorkspaceChatSettingsPanel';
import { PendingFilesBar } from '../Components/Chat/PendingFilesBar';
import { OpenTraceButton } from '../Components/Chat/OpenTraceButton';
import { deleteWorkspaceChatUploads } from '../Services/workspaceChatAgentService';
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
  StagedItem,
  StagedFile,
  WorkspaceChatUploadResponse,
  WorkspaceChatModelId,
} from '../types/workspaceChatTypes';
import { DEFAULT_WORKSPACE_MODEL } from '../types/workspaceChatTypes';

type ConversationChatConfig = {
  autoToolsEnabled?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
  enabledKBIds?: string[];
  enabledConnectionIds?: string[];
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

const NumaWorkspaceChatAgents = () => {
  const { t } = useTranslation('chat');
  // Basic UI state
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [stagedItems, setStagedItems] = useState<StagedItem[]>([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [createAgentEnabled, setCreateAgentEnabled] = useState(false);
  const [availableConnections, setAvailableConnections] = useState<
    Array<{ id: string; name: string; isConnected: boolean; mcpServerUrl?: string }>
  >([]);
  const [enabledConnections, setEnabledConnections] = useState<string[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState<boolean>(false);
  const [autoToolsEnabled, setAutoToolsEnabled] = useState(true); // Default to auto mode
  const [buttonStatus, setButtonStatus] = useState('idle');
  const [isFileProcessing, _setIsFileProcessing] = useState(false);
  const [lambdaClient, setLambdaClient] = useState<LambdaClient | null>(null);
  const [isManuallyLoading, setIsManuallyLoading] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<AgentSummary | null>(null);
  const [pendingAgent, setPendingAgent] = useState<AgentSummary | null>(null);
  const [queuedPreselectedAgent, setQueuedPreselectedAgent] = useState<AgentSummary | null>(null);
  const [agentError, setAgentError] = useState<ReactNode | null>(null);
  const [personalAgents, setPersonalAgents] = useState<AgentSummary[]>([]);
  const [personalAgentsLoading, setPersonalAgentsLoading] = useState(false);
  const [agentsMode, setAgentsMode] = useState<AgentsMode>('full');
  const [agentsFeatureEnabled] = useState(() =>
    typeof window !== 'undefined' ? window.sessionStorage.getItem('AGENTS') === 'true' : false,
  );
  const [missingConfirm, setMissingConfirm] = useState<{ agent: AgentSummary; missing: string[] } | null>(null);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [showFilePreviewModal, setShowFilePreviewModal] = useState(false);
  const [userChatSettings, setUserChatSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [chatSettingsLoaded, setChatSettingsLoaded] = useState(false);
  const [userSettingsModified, setUserSettingsModified] = useState(false);
  const [pendingConversationChatConfig, setPendingConversationChatConfig] = useState<ConversationChatConfig | null>(
    null,
  );
  /** Initialization state - true when workspace is syncing files */
  const [isInitializing, setIsInitializing] = useState(false);
  /** Selected model for workspace chat (global cross-region inference profile) */
  const [selectedModelId, setSelectedModelId] = useState<WorkspaceChatModelId>(DEFAULT_WORKSPACE_MODEL);
  /** Tracks when a conversation was pre-minted via file upload but user hasn't sent a message yet */
  const [isPreMintedConversation, setIsPreMintedConversation] = useState(false);
  /** Tracks when a V1 conversation needs to be migrated to V2 on first message */
  const [needsV1Migration, setNeedsV1Migration] = useState(false);

  // Refs
  const messageEndRef = useRef(null);
  const chatHistoryRef = useRef<ChatHistorySidebarRef | null>(null);
  const agentsSidebarRef = useRef<AgentsSidebarHandle | null>(null);
  const preselectHandledRef = useRef(false);
  const preselectActivatedRef = useRef(false);
  const preselectTimerRef = useRef<number | null>(null);
  const autoNamingAttemptedRef = useRef<Set<string>>(new Set());
  const lastLoadedConversationRef = useRef<string | null>(null); // Prevents infinite reload loop
  const conversationChatConfigSaveTimeoutRef = useRef<number | null>(null);
  const isApplyingConversationChatConfigRef = useRef(false);
  // Note: Workspace streaming refs moved to useWorkspaceStreaming hook

  // Custom hooks
  // Use -v2 suffix to keep conversation state separate from V1 chat page
  // V2 chat: mark conversations as workspace conversations so they're properly categorized
  const conversationManager = useConversationManager({ storageKeySuffix: '-v2', isWorkspaceMode: true });
  const streamingHandler = useStreamingHandler();
  const documentProcessor = useDocumentProcessor();
  const filePreviewProcessor = useFilePreviewProcessor();
  const { companyProfile } = useCompanyProfile();

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
  const { setCurrentAbort, resetStreamingState } = streamingHandler;

  const { user, bedrockRuntimeClient, numaChatDynamoUtils, getAccessToken, getCredentials } = useAuth();
  // Extract user info from token early (used by hooks/deps below)
  const idToken = user?.decoded_tokens?.idToken ?? {};
  const sub = idToken.sub;
  const userEmail = idToken.email || '';
  const userName = userEmail.split('@')[0] || undefined; // Extract first part of email as name
  const { numaGet } = useNumaRequest();
  const { selectedKB: _selectedKB, selectedKbId: _selectedKbId, availableKBs, isLoadingKBs } = useKnowledgeBase();
  const [enabledKBIds, setEnabledKBIds] = useState<string[]>([]);

  // Settings panel hook (V2 right-side panel)
  const settingsPanel = useWorkspaceChatSettingsPanel(conversationId, {
    defaultOpenOnNewChat: true, // Panel opens automatically for new chats
  });

  // Toggle settings panel with mutual exclusivity
  // Opening settings closes any file preview or document panel
  const handleToggleSettings = useCallback(() => {
    if (settingsPanel.isPanelOpen) {
      settingsPanel.closePanel();
    } else {
      // Close any open panels first
      closeFilePreview();
      closeDocument();
      setShowSplitView(false);
      settingsPanel.openPanel();
    }
  }, [settingsPanel, closeFilePreview, closeDocument, setShowSplitView]);

  const markUserSettingsModified = useCallback(() => {
    setUserSettingsModified(true);
  }, []);

  // Memoized callbacks for file preview (to avoid re-renders on every keystroke)
  const handleOpenFilePreviewForChat = useCallback(
    (ref: { filename: string; fullPath: string; relativePath: string; extension: string }) => {
      // Close settings panel for mutual exclusivity
      settingsPanel.closePanel();
      openFilePreview(ref);
      // Collapse main nav sidebar to give more room for preview
      window.dispatchEvent(new CustomEvent('numa-collapse-sidebar'));
      if (isMobile) {
        setShowFilePreviewModal(true);
      }
    },
    [openFilePreview, isMobile, settingsPanel],
  );

  const handleOpenFolderPreviewForChat = useCallback(
    (ref: { name: string; fullPath: string; relativePath: string }) => {
      // Close settings panel for mutual exclusivity
      settingsPanel.closePanel();
      openFolderPreview(ref);
      // Collapse main nav sidebar to give more room for preview
      window.dispatchEvent(new CustomEvent('numa-collapse-sidebar'));
      if (isMobile) {
        setShowFilePreviewModal(true);
      }
    },
    [openFolderPreview, isMobile, settingsPanel],
  );

  const connectedSet = useMemo(
    () => new Set(availableConnections.filter((conn) => conn.isConnected).map((conn) => conn.id)),
    [availableConnections],
  );

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

      window.setTimeout(() => {
        isApplyingConversationChatConfigRef.current = false;
      }, 0);
    },
    [agentsFeatureEnabled, availableConnections, availableKBs],
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
    [markUserSettingsModified],
  );

  const handleUserSetCreateAgentEnabled = useCallback(
    (value: SetStateAction<boolean>) => {
      markUserSettingsModified();
      setCreateAgentEnabled(value);
    },
    [markUserSettingsModified],
  );

  const handleUserSetAutoToolsEnabled = useCallback(
    (value: SetStateAction<boolean>) => {
      markUserSettingsModified();
      setAutoToolsEnabled(value);
    },
    [markUserSettingsModified],
  );

  const handleUserSetEnabledConnections = useCallback(
    (value: SetStateAction<string[]>) => {
      markUserSettingsModified();
      setEnabledConnections(value);
    },
    [markUserSettingsModified],
  );

  const handleUserSetEnabledKBIds = useCallback(
    (value: SetStateAction<string[]>) => {
      markUserSettingsModified();
      setEnabledKBIds(value);
    },
    [markUserSettingsModified],
  );

  // Persist current chat controls to the conversation meta item so resuming a chat restores its last state.
  useEffect(() => {
    if (!conversationId || !numaChatDynamoUtils || !sub) return;
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
        enabledKBIds,
        enabledConnectionIds: enabledConnections,
      };

      numaChatDynamoUtils
        .updateMetaItem(conversationId, sub, { chatConfig: payload })
        .catch((err) => console.debug('[NumaChat] Unable to persist chat config to conversation meta', err));
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
    enabledConnections,
    enabledKBIds,
    agentsFeatureEnabled,
    numaChatDynamoUtils,
    sub,
    webSearchEnabled,
  ]);

  const defaultKBIdsFromSettings = useMemo(() => {
    if (!Array.isArray(userChatSettings.defaultKBIds) || userChatSettings.defaultKBIds.length === 0) {
      return [];
    }

    const defaultKBSet = new Set(userChatSettings.defaultKBIds);
    const availableDefaultKBs = availableKBs.filter((kb) => defaultKBSet.has(kb.kb_id));
    return availableDefaultKBs.map((kb) => kb.kb_id);
  }, [availableKBs, userChatSettings.defaultKBIds]);

  const defaultConnectionIdsFromSettings = useMemo(
    () => userChatSettings.defaultConnectionIds.filter((id) => connectedSet.has(id)),
    [connectedSet, userChatSettings.defaultConnectionIds],
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
        setEnabledConnections(defaultConnectionIdsFromSettings);
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
      setEnabledConnections(config.enabledConnections ?? []);

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
    [availableKBs, defaultConnectionIdsFromSettings, defaultKBIdsFromSettings, userChatSettings],
  );

  const resetAgentState = useCallback(() => {
    setCurrentAgent(null);
    setPendingAgent(null);
    applyAgentConfiguration(null);
    setAgentError(null);
  }, [applyAgentConfiguration]);

  // Simple direct access - no need for useMemo for primitive values
  const userId = user?.attributes?.sub;
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
      setIsMobile((prev) => {
        if (prev === mobile) return prev; // Prevent unnecessary updates
        if (!mobile) {
          setShowMobileActions(false);
        }
        return mobile;
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Allow mobile back button to close the document modal instead of leaving the page
  useDrawerBackClose({
    isOpen: showDocumentModal,
    onClose: () => {
      setShowDocumentModal(false);
      closeDocument();
    },
    enabled: isMobile,
    stateKey: 'document-modal',
  });

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
      // Apply defaults only if user hasn't manually changed settings yet
      applyAgentConfiguration(null);
    }
  }, [
    chatSettingsLoaded,
    availableKBs,
    currentAgent,
    applyAgentConfiguration,
    userSettingsModified,
    isConversationLoading,
    pendingConversationChatConfig,
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

      // Fetch fresh data
      setPersonalAgentsLoading(true);
      try {
        const ownedAgents = await listAgents(numaGet, { scope: 'owned' });

        // Deduplicate: prefer user-scoped agents over workspace-scoped when both exist with same agentId
        // This happens when a personal agent is made public (creates both user and workspace copies)
        const agentMap = new Map<string, (typeof ownedAgents)[0]>();

        for (const agent of ownedAgents) {
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
            }),
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
    const connectedIds = new Set(availableConnections.map((conn) => conn.id));
    return required.filter((integration) => !connectedIds.has(integration));
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
    console.log('[NumaDebug] startAgentSession', {
      agentId: agent.agentId,
      title: agent.title,
      requires: agent.requiredIntegrations || [],
    });
    const missing = getMissingIntegrations(agent);
    console.log('[NumaDebug] startAgentSession.missingIntegrations', missing);
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
  const hasPipedreamFeature = window.sessionStorage.getItem('PIPEDREAM_INTEGRATIONS') === 'true';
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

  // Initialize AWS Lambda client (cross-account) if feature enabled
  useEffect(() => {
    const init = async () => {
      if (!user) return;
      if (!hasPipedreamFeature) {
        setConnectionsLoading(false);
        setAvailableConnections([]);
        return;
      }
      if (!relayLambdaArn) {
        console.error('Pipedream feature enabled but Lambda ARN not configured');
        setConnectionsLoading(false);
        setAvailableConnections([]);
        return;
      }
      try {
        const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS') || '{}');
        const userGroup = user.decoded_tokens?.idToken?.['cognito:groups']?.[0] || 'standard';
        const roleArn = GROUPS[userGroup]?.roleArn;
        const cognitoUserId = user.decoded_tokens?.idToken?.sub;
        if (!roleArn) {
          console.error('No role ARN found for user group:', userGroup);
          setConnectionsLoading(false);
          setAvailableConnections([]);
          return;
        }
        const credentials = fromWebToken({
          webIdentityToken: user.tokens.idToken,
          roleArn,
          roleSessionName: cognitoUserId,
        });
        const client = withPRM(LambdaClient, { region: REGION, credentials });
        setLambdaClient(client);
        console.log('Lambda client initialized successfully for Pipedream relay');
      } catch (e) {
        console.error('Error initializing Lambda client:', e);
        setConnectionsLoading(false);
        setAvailableConnections([]);
      }
    };
    init();
  }, [user, REGION, hasPipedreamFeature, relayLambdaArn]);

  // When a preselected agent is queued, start the session once connections have loaded
  useEffect(() => {
    if (!queuedPreselectedAgent) return;
    // If Pipedream feature is disabled, connectionsLoading should already be false
    if (connectionsLoading) {
      console.log('[NumaDebug] preselect:waiting for connections');
      return;
    }
    if (preselectActivatedRef.current) return;
    preselectActivatedRef.current = true;
    if (preselectTimerRef.current) {
      clearTimeout(preselectTimerRef.current);
      preselectTimerRef.current = null;
    }
    console.log('[NumaDebug] preselect:activate', {
      agentId: queuedPreselectedAgent.agentId,
      title: queuedPreselectedAgent.title,
    });
    Promise.resolve(startAgentSession(queuedPreselectedAgent))
      .catch((err) => {
        console.error('Failed to activate queued preselected agent', err);
        setAgentError((err as Error)?.message ?? 'Unable to activate selected agent');
      })
      .finally(() => setQueuedPreselectedAgent(null));
  }, [queuedPreselectedAgent, connectionsLoading]);

  // Load global admin integration settings once
  useEffect(() => {
    (async () => {
      try {
        if (!user) return;
        const items = (await numaGet('/api/settings/integrations')) as Array<{
          integration: string;
          status: 'enabled' | 'disabled';
          denyTools: string[];
        }>;
        const map: Record<string, { status: 'enabled' | 'disabled'; denyTools: string[] }> = {};
        for (const item of items || []) {
          map[item.integration] = { status: item.status, denyTools: item.denyTools || [] };
        }
        setGlobalIntegrationSettings(map);
      } catch {
        /* ignore: default is empty */
      }
    })();
  }, [user, numaGet]);

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
      if (agentsMode === 'off' || !stored) return;
      const parsed = JSON.parse(stored) as AgentSummary;
      setQueuedPreselectedAgent(parsed);
    } catch (error) {
      console.error('Failed to load preselected agent', error);
    }
  }, [agentsMode]);

  // Load connections via proxy
  const loadConnectionStatus = async () => {
    if (!lambdaClient || !user) return;
    try {
      setConnectionsLoading(true);
      const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
      const response = await PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId, {
        ttlMs: 30 * 60 * 1000, // 30 minutes cache for chat page
      });

      // Transform the connection objects to the format expected by the UI
      const allConnections = (response.connections || []).map((conn) => ({
        id: conn.app_name,
        name: conn.app_name,
        isConnected: conn.status === 'connected',
        mcpServerUrl: undefined,
      }));

      // Only show connected integrations as available for selection, and enabled by admin
      const connected = allConnections
        .filter((conn) => conn.isConnected)
        .filter((conn) => globalIntegrationSettings[conn.id]?.status !== 'disabled');

      setAvailableConnections(connected);
    } catch (e) {
      console.error('Failed to load connection status via proxy:', e);
      setAvailableConnections([]);
    } finally {
      setConnectionsLoading(false);
    }
  };

  useEffect(() => {
    if (lambdaClient) loadConnectionStatus();
  }, [lambdaClient]);

  // Ref for input textarea
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const isProcessingRef = useRef(false);

  // Auto-scroll to bottom on messages or ephemeral changes
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Inactivity: when expired, start a new chat and show suggestions (hook will fetch suggestions)
  async function handleNewChatOnExpired() {
    // Stop any ongoing streaming response
    setButtonStatus('idle');
    resetStreamingState();
    resetAgentState();
    setPendingConversationChatConfig(null);

    // Clear all UI states
    setMessages([]);
    setUploadedFiles([]);
    setInputMessage('');
    closeDocument();

    // Reset split view state - hide document panel
    setShowSplitView(false);
    setLeftFraction(0.99);

    // Clear manual loading state to prevent conflicts
    setIsManuallyLoading(false);

    // Clear V1 migration flag
    setNeedsV1Migration(false);

    // Clear auto-naming tracking for new conversation
    autoNamingAttemptedRef.current.clear();

    // Use the hook's new chat handler
    await handleNewChat();
  }

  // Inactivity: centralized in hook
  const {
    showContinueSuggestions,
    recentConversations,
    resetInactivityTimer,
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
  });

  // Sort agents by favorites first, then most recently used, then updatedAt
  const sortedPersonalAgents = useMemo(() => {
    if (!agentsFeatureEnabled) return [];
    return sortAgentsByPriority(personalAgents, recentConversations);
  }, [personalAgents, recentConversations, agentsFeatureEnabled]);

  // Show new chat view if:
  // 1. Normal new chat flow (showContinueSuggestions && no messages), OR
  // 2. Conversation was pre-minted via upload but user hasn't sent a message yet
  const shouldShowNewChatView = (showContinueSuggestions && messages.length === 0) || isPreMintedConversation;

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
      // Read isWorkspaceConversation from localStorage for auto-load
      const storedIsWorkspace = localStorage.getItem('isWorkspaceConversation-v2') === 'true';
      console.log('[NumaChat] Auto-loading conversation:', conversationId, 'isWorkspace:', storedIsWorkspace);
      handleLoadConversation(conversationId, storedIsWorkspace);
    } else if (conversationId && hasUserStartedNewChat) {
      console.log('[NumaChat] Skipping auto-load for just-created conversation:', conversationId);
    } else if (conversationId && messages.length > 0) {
      console.log('[NumaChat] Skipping auto-load because messages already exist:', messages.length);
    } else if (conversationId && isManuallyLoading) {
      console.log('[NumaChat] Skipping auto-load because manual loading is in progress:', conversationId);
    }
  }, [conversationId, numaChatDynamoUtils, sub, hasUserStartedNewChat, messages.length, isManuallyLoading]);

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
  };

  // Auto-naming handler called after stream completes
  // Receives conversationId as parameter from hook to avoid stale closure issues
  const handleAutoNaming = useCallback(
    async (streamConversationId: string) => {
      console.log('[WorkspaceChat] handleAutoNaming called with:', streamConversationId);
      const cid = streamConversationId;
      console.log('[WorkspaceChat] Auto-naming check:', {
        cid,
        hasBedrock: !!bedrockRuntimeClient,
        hasDynamo: !!numaChatDynamoUtils,
        sub,
      });
      if (!bedrockRuntimeClient || !numaChatDynamoUtils || !sub || !cid) {
        console.log('[WorkspaceChat] Auto-naming skipped - missing dependencies');
        return;
      }

      // Prevent duplicate auto-naming for same conversation
      if (autoNamingAttemptedRef.current.has(cid)) {
        console.log('[WorkspaceChat] Auto-naming already attempted for this conversation, skipping');
        return;
      }

      autoNamingAttemptedRef.current.add(cid);
      try {
        const renamed = await autoNameConversation({
          conversationId: cid,
          userId: sub,
          bedrockRuntimeClient,
          numaChatDynamoUtils,
          region: REGION,
        });
        if (renamed) {
          // Refresh sidebar to reflect new title
          refreshSidebar();
        }
      } catch (e) {
        console.error('[WorkspaceChat] Auto-naming failed:', e);
      }
    },
    [bedrockRuntimeClient, numaChatDynamoUtils, sub, REGION],
  );

  // Workspace chat streaming hook - handles SDK events, tool tracking, document extraction
  const { streamChat, stopStream, isStopping } = useWorkspaceChatStreaming({
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
    onStreamComplete: handleAutoNaming,
  });

  // Toggle chat history sidebar
  const toggleChatHistory = () => {
    chatHistoryRef.current?.toggleSidebar();
  };

  // Handle renaming a conversation from NewChat view
  const handleRenameConversation = async (conversationId: string, currentName: string) => {
    const newName = prompt(t('history.renamePrompt'), currentName);
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
    // Confirm deletion with the user
    if (!window.confirm(t('history.deleteConfirm'))) {
      return;
    }
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

  // (Helper functions moved into hook)

  // New chat handler that clears UI state
  const handleNewChatClick = async () => {
    // Stop any ongoing streaming response
    setButtonStatus('idle');
    resetStreamingState();
    resetAgentState();
    setPendingConversationChatConfig(null);

    // Clear all UI states
    setMessages([]);
    setUploadedFiles([]);
    setInputMessage('');
    closeDocument();

    // Clear pre-minted state
    setIsPreMintedConversation(false);

    // Clear V1 migration flag
    setNeedsV1Migration(false);

    // Reset split view state - hide document panel
    setShowSplitView(false);
    setLeftFraction(0.99); // Reset to full chat view

    // Clear manual loading state to prevent conflicts
    setIsManuallyLoading(false);

    // Clear auto-naming tracking for new conversation
    autoNamingAttemptedRef.current.clear();

    // Reset last loaded conversation to allow loading new conversations
    lastLoadedConversationRef.current = null;

    // Surface the enhanced new chat view immediately (with or without history)
    forceShowNewChatView();

    // Use the hook's new chat handler
    await handleNewChat();
  };

  // Handle upload button click that silently mints a conversation for new chats
  // This allows file uploads before the user sends a message
  const handleUploadWithConversationMint = async () => {
    // If we're on new chat view and don't have a conversation yet (or it was pre-minted), mint one
    if (shouldShowNewChatView && !conversationId) {
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
          : undefined,
      );
      setIsPreMintedConversation(true);
    }
    setShowUploadModal(true);
  };

  // Configure model, tools, and system prompt for agent call
  const configureAgentCall = (
    autoToolsEnabled,
    webSearchEnabled,
    createAgentEnabled,
    idToken,
    companyProfile,
    user,
    sub,
  ) => {
    // Determine which model to use based on fallback status
    const clientName = window.sessionStorage.getItem('CLIENT_NAME');
    const modelType = isInFallbackMode(clientName) ? MODEL_TYPES.FALLBACK : MODEL_TYPES.DEFAULT;
    const modelId = getModelId(REGION, modelType);
    console.log('[NumaChat] Using model:', modelId, 'fallback mode:', isInFallbackMode(clientName));

    // Determine which tools to enable based on auto mode or manual selection
    const enabledTools = getEnabledTools(
      autoToolsEnabled,
      webSearchEnabled,
      agentsFeatureEnabled ? createAgentEnabled : false,
      enabledKBIds,
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
      companyProfile,
      enabledConnections,
      agentsFeatureEnabled ? createAgentEnabled : false,
      enabledKBMeta,
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
      idToken: user?.tokens?.idToken || localStorage.getItem('idToken'),
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

  // Submit user input
  // Optional overrideMessage parameter allows quick actions to pass message directly
  // without waiting for React state update
  const handleSubmit = async (e, overrideMessage?: string) => {
    e.preventDefault();

    // Prevent duplicate submissions (React StrictMode protection) - check FIRST
    if (isProcessingRef.current) {
      console.log('[NumaChat] Ignoring duplicate handleSubmit call');
      return;
    }
    isProcessingRef.current = true;

    // Use override message if provided, otherwise use state
    const messageToSend = overrideMessage ?? inputMessage;

    // Validate input - allow submission if there's text OR staged files (V2) OR uploaded files (V1)
    if (!messageToSend.trim() && uploadedFiles.length === 0 && stagedItems.length === 0) {
      isProcessingRef.current = false; // Reset flag on early return
      return;
    }

    // This is a user interaction
    resetInactivityTimer();
    // Hide suggestions on first interaction
    hideSuggestions();
    // Clear pre-minted state - user is now sending a message, transition to active chat
    if (isPreMintedConversation) {
      setIsPreMintedConversation(false);
    }

    // Prepare UI
    setInputMessage('');
    if (inputRef.current) {
      inputRef.current.style.height = '40px';
    }
    setButtonStatus('loading');

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
          : undefined,
      );
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
      const userMsgObject = { role: 'user', content: userMsg };
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

      console.log('[NumaChat] Sending minimal payload - backend will load conversation history');

      const { enabledTools } = configureAgentCall(
        autoToolsEnabled,
        webSearchEnabled,
        createAgentEnabled,
        idToken,
        companyProfile,
        user,
        sub,
      );

      // Show "processing…" spinner while waiting for any response from backend
      const processingMessage = { role: 'assistant', segments: [], status: 'processing' };
      setMessages((prev) => [...prev, processingMessage]);

      // Reset streaming helpers for this turn
      resetStreamingState();

      // Diagnostics: log prompt length and preview before calling the agent
      console.log('[Diag] ChatAgent prompt length:', userMsg?.length ?? 0);
      console.log('[Diag] ChatAgent prompt preview:', (userMsg || '').slice(0, 200));

      // Call workspace streaming hook
      await streamChat({
        prompt: userMsg,
        conversationId: cid,
        enabledTools,
        enabledConnections,
        enabledKBIds,
        availableKBs,
        attachments,
        modelId: selectedModelId,
        migrateFromV1: needsV1Migration,
        agentId: activeAgent?.agentId,
      });
      // Clear the V1 migration flag after first message (migration happens on first request)
      if (needsV1Migration) {
        console.log('[NumaChat] V1 migration completed, clearing flag and updating localStorage');
        setNeedsV1Migration(false);
        localStorage.setItem('isWorkspaceConversation-v2', 'true'); // Now it's V2
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

  // Handle quick action button clicks
  // Quick actions either prefill the input for user completion or send immediately
  const handleQuickAction = useCallback(
    (action: QuickActionConfig) => {
      if (action.behavior === 'prefill') {
        // Set the prompt text and focus the input so user can complete it
        setInputMessage(action.prompt);
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
    [handleSubmit],
  );

  // Load single conversation from DB using extracted utility
  const handleLoadConversation = async (selectedConversationId: string, isWorkspaceConversation = false) => {
    if (!numaChatDynamoUtils) return;

    console.log('[NumaChat] handleLoadConversation called:', {
      selectedConversationId,
      isWorkspaceConversation,
      typeofIsWorkspace: typeof isWorkspaceConversation,
      willUseV2Path: isWorkspaceConversation !== false,
    });

    setIsManuallyLoading(true);
    setIsConversationLoading(true);
    setMessages([]); // Clear current messages immediately
    resetUserNewChatFlag(); // Reset the flag since user is explicitly loading a conversation
    setIsPreMintedConversation(false); // Clear pre-minted state - user is loading a different conversation

    // This is a user interaction
    resetInactivityTimer();
    // Hide suggestions when loading a conversation
    hideSuggestions();

    try {
      // V2 workspace conversations: load from trace file
      if (isWorkspaceConversation) {
        console.log('[NumaChat] Loading V2 workspace conversation from trace');
        try {
          const rawTrace = await getWorkspaceChatRawTrace(selectedConversationId);
          console.log('[NumaChat] Raw trace length:', rawTrace?.length, 'lines:', rawTrace?.split('\n').length);

          // Parse raw trace using same logic as live streaming
          const chatMessages = parseRawTraceToMessages(rawTrace);
          console.log('[NumaChat] Parsed messages:', chatMessages.length, chatMessages);

          setMessages(chatMessages);
          setConversationId(selectedConversationId);
          localStorage.setItem('currentConversationId-v2', selectedConversationId);
          localStorage.setItem('isWorkspaceConversation-v2', 'true'); // Mark as V2 for auto-load
          autoNamingAttemptedRef.current.add(selectedConversationId);
          // This is a V2 conversation, clear any migration flag
          setNeedsV1Migration(false);

          // Fetch conversation metadata from DynamoDB to restore agent state
          try {
            const conversationHistory = await numaChatDynamoUtils.queryConversations(
              selectedConversationId,
              10, // Only need a few records to find meta
              sub,
            );
            const metaItem = conversationHistory.find(
              (item: { message_type?: string }) => item.message_type === 'meta',
            );

            if (metaItem?.isAgentConversation && metaItem?.agentId) {
              console.log('[NumaChat] V2 conversation has agent, restoring:', metaItem.agentId);
              try {
                const agent = await getAgent(numaGet, metaItem.agentId);
                setCurrentAgent(agent);
                setPendingAgent(null);
                applyAgentConfiguration(agent);
              } catch (agentErr) {
                console.error('Failed to hydrate agent for V2 conversation', agentErr);
                resetAgentState();
              }
            } else {
              resetAgentState();
            }
          } catch (metaErr) {
            console.error('Failed to fetch V2 conversation metadata:', metaErr);
            resetAgentState();
          }
        } catch (wsError) {
          console.error('Error loading V2 trace, falling back to V1 loader:', wsError);
          // Trace fetch failed - fall through to V1 loading
          await loadV1Conversation(selectedConversationId);
        }
      } else {
        // V1 conversation: load directly from DynamoDB (skip trace fetch entirely)
        console.log('[NumaChat] Loading V1 conversation from DynamoDB');
        await loadV1Conversation(selectedConversationId);
      }
    } catch (error) {
      console.error('Error loading conversation:', error);
      // Show error message to user
      setMessages([
        {
          role: 'system',
          content: 'Error loading conversation. Please try again or select a different conversation.',
        },
      ]);
      resetAgentState();
    } finally {
      setIsConversationLoading(false);
      setIsManuallyLoading(false);
      // Mark this conversation as loaded to prevent infinite reload loop
      lastLoadedConversationRef.current = selectedConversationId;
    }
  };

  // Helper function to load V1 conversations from DynamoDB
  const loadV1Conversation = async (selectedConversationId: string) => {
    console.log('[NumaChat] V1 conversation detected, will migrate on first message');
    const {
      messages: chatMessages,
      agentMeta,
      chatConfig,
    } = await loadConversation(selectedConversationId, numaChatDynamoUtils, sub, getAccessToken);
    setMessages(chatMessages);
    setConversationId(selectedConversationId);
    localStorage.setItem('currentConversationId-v2', selectedConversationId);
    localStorage.setItem('isWorkspaceConversation-v2', 'false'); // V1 until migrated
    setPendingConversationChatConfig((chatConfig as ConversationChatConfig) || null);
    autoNamingAttemptedRef.current.add(selectedConversationId);
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
    !currentAgent && !autoToolsEnabled && enabledKBIds.length === 0 && !webSearchEnabled && !createAgentEnabled;

  // Legacy helper: push buffered text as its own segment then clear buffer, and save to DynamoDB
  // Kept for V1 compatibility but unused in workspace mode (handled by useWorkspaceStreaming hook)
  const _flushPendingText = (currentConversationId = null, preserveContent = false) => {
    if (!streamingHandler.textBufferRef.current.trim()) {
      console.log('[NumaChat] No text to flush (buffer empty)');
      return; // Only flush if there's actual content
    }

    const textToSave = streamingHandler.textBufferRef.current;
    console.log(
      '[NumaChat] Flushing pending text (preserveContent=' + preserveContent + ', length=' + textToSave.length + '):',
      textToSave.slice(0, 50) + '...',
    );

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
      console.log('[NumaChat] Saved text segment to DynamoDB');
    }

    // Prevent double-flushing UI updates in final completion phase
    if (preserveContent && streamingHandler.finalFlushPerformedRef.current) {
      console.log('[NumaChat] Skipping duplicate final flush UI update (already saved to DB)');
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
        console.log('[NumaChat] Finalized text segment with content length:', finalText.length);
      }

      return updated;
    });

    // Clear the text buffer only if not preserving content
    if (!preserveContent) {
      streamingHandler.textBufferRef.current = '';
      console.log('[NumaChat] Cleared text buffer');
    }
  };

  const renderActionButtons = () => (
    <>
      {/* Dev tool: Download trace as HTML */}
      {conversationId && <OpenTraceButton conversationId={conversationId} />}
      {agentsFeatureEnabled && agentsMode !== 'off' && (
        <AgentsSidebar
          ref={agentsSidebarRef}
          onSelectAgent={handleAgentSelect}
          currentAgentId={currentAgent?.agentId ?? null}
          recentConversations={recentConversations}
        />
      )}
      <Button variant="secondary" onClick={toggleChatHistory} title={t('page.chatHistory')}>
        <i className="bi bi-clock-history me-1"></i>
        {t('page.historyButton')}
      </Button>
      <Button variant="primary" onClick={handleNewChatClick}>
        {t('page.newChat')}
      </Button>
    </>
  );

  const mobileActionsPanelId = 'mobile-chat-actions-panel';
  const handleMobileActionClick = () => setShowMobileActions(false);

  // Ensure mobile actions start collapsed on mount/navigation
  useEffect(() => {
    setShowMobileActions(false);
  }, []);

  // Auto-collapse sidebar when entering Chat V2 for more workspace
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('numa-collapse-sidebar'));
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
    <div className="dashboard">
      {/* Desktop header */}
      {!isMobile && (
        <PageHeader
          title="Numa Chat V2"
          actions={renderActionButtons()}
          className={shouldShowNewChatView ? 'new-chat-page-header' : ''}
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
            aria-label={showMobileActions ? 'Hide chat actions' : 'Show chat actions'}
          >
            <span className="toggle-icon">
              <i className="bi bi-plus"></i>
            </span>
          </button>
          <Collapse in={showMobileActions}>
            <div id={mobileActionsPanelId} className="mobile-actions-panel">
              <div className="d-flex flex-wrap gap-2" onClick={handleMobileActionClick}>
                {renderActionButtons()}
              </div>
            </div>
          </Collapse>
        </div>
      )}

      {/* Main content */}
      <LayoutDashboard>
        {/* Chat layout */}
        <div className="chat-layout d-flex">
          {/* Chat history sidebar */}
          <ChatHistorySidebar
            ref={chatHistoryRef}
            onSelectConversation={handleLoadConversation}
            currentConversationId={conversationId}
            setError={(error) => console.error('Chat history error:', error)}
          />

          {/* Main chat content */}
          <div className="flex-grow-1 d-flex contain-width">
            {/* White container wrapper */}
            <div className="chat-white-container">
              <div className="chat-content flex-grow-1 d-flex flex-column">
                {/* Agent info section (if agent is selected) */}
                {currentAgent && (
                  <div className="chat-agent-info d-flex align-items-center gap-2 p-3 border-bottom">
                    <AgentAvatar agent={currentAgent} size={32} />
                    <div className="chat-agent-meta">
                      <div
                        className="fw-semibold"
                        style={{ fontSize: '1.1rem', color: 'var(--brand-primary, var(--color-primary))' }}
                      >
                        {formatAgentDisplayName(currentAgent.title)}
                      </div>
                      <div className="small text-muted">{t('page.agentAssistant')}</div>
                    </div>
                  </div>
                )}

                {/* Missing integrations confirmation modal */}
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

                <div className="chat-container position-relative" style={{ flex: '1 1 auto' }}>
                  <ResizableSplitView
                    left={
                      /* LEFT PANE: chat messages + input */
                      <div className="chat-left-pane d-flex flex-column h-100">
                        {/* Initialization indicator - shown when workspace is syncing */}
                        {isInitializing && (
                          <div className="workspace-chat-initializing">
                            <div className="spinner-border spinner-border-sm" role="status">
                              <span className="visually-hidden">Initializing...</span>
                            </div>
                            <span>Initializing workspace...</span>
                          </div>
                        )}
                        <div className="chat-messages flex-grow-1 overflow-auto">
                          {isConversationLoading ? (
                            <div className="d-flex justify-content-center align-items-center h-100">
                              <div className="text-center">
                                <div className="spinner-border text-primary" role="status">
                                  <span className="visually-hidden">Loading...</span>
                                </div>
                                <p className="mt-2 text-muted">Loading conversation...</p>
                              </div>
                            </div>
                          ) : shouldShowNewChatView ? (
                            <NewChat
                              inputMessage={inputMessage}
                              setInputMessage={setInputMessage}
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
                              connectionsLoading={connectionsLoading}
                              hasPipedreamFeature={hasPipedreamFeature}
                              uploadsInProgress={isFileProcessing}
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
                                // Get paths to delete from this item
                                const pathsToDelete = getPathsFromStagedItem(item);
                                // Delete from backend (local + S3)
                                if (conversationId && pathsToDelete.length > 0) {
                                  try {
                                    await deleteWorkspaceChatUploads(conversationId, pathsToDelete);
                                  } catch (err) {
                                    console.error('Error deleting uploads:', err);
                                  }
                                }
                                // Update staged items
                                setStagedItems((prev) => {
                                  const filtered = prev.filter((i) => {
                                    if (item.kind === 'file' && i.kind === 'file') return i.path !== item.path;
                                    if (item.kind === 'folder' && i.kind === 'folder')
                                      return i.folderPath !== item.folderPath;
                                    return true;
                                  });
                                  if (conversationId) saveStagedItems(conversationId, filtered);
                                  return filtered;
                                });
                              }}
                              onStop={stopStream}
                              isStopping={isStopping}
                              // V2 variant props
                              variant="v2"
                              onSettingsClick={handleToggleSettings}
                              isSettingsPanelOpen={settingsPanel.isPanelOpen}
                              hasActiveSettings={
                                enabledKBIds.length > 0 ||
                                webSearchEnabled ||
                                createAgentEnabled ||
                                enabledConnections.length > 0
                              }
                              // Model selector props
                              selectedModelId={selectedModelId}
                              setSelectedModelId={setSelectedModelId}
                              showModelSelector={true}
                              // Quick actions props
                              onQuickAction={handleQuickAction}
                              connectedIntegrations={connectedSet}
                            />
                          ) : (
                            <>
                              {/* V1 to V2 Migration Banner */}
                              {needsV1Migration && (
                                <div
                                  className="alert alert-info d-flex align-items-start gap-2 mx-3 mt-3 mb-0"
                                  role="alert"
                                  style={{ borderRadius: '8px' }}
                                >
                                  <i className="bi bi-info-circle-fill flex-shrink-0 mt-1" />
                                  <div>
                                    <strong>{t('page.legacyMigration.title')}</strong>
                                    <p className="mb-0 small">{t('page.legacyMigration.description')}</p>
                                  </div>
                                </div>
                              )}
                              <ChatMessages
                                messages={messages}
                                messageEndRef={messageEndRef}
                                loadingIndicatorStyle={{}}
                                onOpenDocument={(title, content) => {
                                  // Close settings panel for mutual exclusivity
                                  settingsPanel.closePanel();
                                  setInlineDocument({ title, content });
                                  if (isMobile) {
                                    setShowSplitView(false);
                                    setLeftFraction(0.99);
                                    setShowDocumentModal(true);
                                  } else {
                                    openDocument(title, content);
                                  }
                                }}
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
                              />
                            </>
                          )}
                        </div>

                        {/* pinned input at bottom (hide during initial new chat flow) */}
                        {!shouldShowNewChatView && (
                          <div className="chat-input-wrapper">
                            {/* Show pending files indicator */}
                            {stagedItems.length > 0 && (
                              <PendingFilesBar
                                items={stagedItems}
                                onRemove={async (item: StagedItem) => {
                                  // Get paths to delete from this item
                                  const pathsToDelete = getPathsFromStagedItem(item);

                                  // Delete from backend (local + S3)
                                  if (conversationId && pathsToDelete.length > 0) {
                                    try {
                                      await deleteWorkspaceChatUploads(conversationId, pathsToDelete);
                                    } catch (e) {
                                      console.error('Failed to delete uploads:', e);
                                      // Continue with UI removal even if backend fails
                                    }
                                  }

                                  // Remove from state
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

                                    // Persist to localStorage
                                    if (conversationId) {
                                      saveStagedItems(conversationId, filtered);
                                    }

                                    return filtered;
                                  });
                                }}
                              />
                            )}
                            <ChatInput
                              inputMessage={inputMessage}
                              setInputMessage={setInputMessage}
                              handleSubmit={handleSubmit}
                              setShowUploadModal={setShowUploadModal}
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
                              connectionsLoading={connectionsLoading}
                              hasPipedreamFeature={hasPipedreamFeature}
                              uploadsInProgress={isFileProcessing}
                              noToolsActive={noToolsActive}
                              externalInputRef={inputRef}
                              autoFocus={true}
                              enabledKBIds={enabledKBIds}
                              setEnabledKBIds={handleUserSetEnabledKBIds}
                              selectedModelId={selectedModelId}
                              setSelectedModelId={setSelectedModelId}
                              showModelSelector={true}
                              onStop={stopStream}
                              isStopping={isStopping}
                              // V2 variant props
                              variant="v2"
                              onSettingsClick={handleToggleSettings}
                              isSettingsPanelOpen={settingsPanel.isPanelOpen}
                              hasActiveSettings={
                                enabledKBIds.length > 0 ||
                                webSearchEnabled ||
                                createAgentEnabled ||
                                enabledConnections.length > 0
                              }
                            />
                          </div>
                        )}
                      </div>
                    }
                    right={
                      /* RIGHT PANE: settings panel, file preview, or document panel */
                      settingsPanel.isPanelOpen ? (
                        <WorkspaceChatSettingsPanel
                          isOpen={settingsPanel.isPanelOpen}
                          isNewChat={shouldShowNewChatView}
                          uploadsFiles={settingsPanel.uploadsFiles}
                          sessionFiles={settingsPanel.sessionFiles}
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
                          }}
                          onDownloadFile={(file) => {
                            // Download will be handled by opening preview with download action
                            // Build full S3 key from relative path
                            const fullS3Key = `numa-chat/workspace/${sub}/conversations/${conversationId}/${file.path}`;
                            openFilePreview({
                              filename: file.name,
                              fullPath: fullS3Key,
                              relativePath: file.path,
                              extension: file.name.split('.').pop() || '',
                            });
                            settingsPanel.closePanel();
                          }}
                          autoToolsEnabled={autoToolsEnabled}
                          setAutoToolsEnabled={handleUserSetAutoToolsEnabled}
                          webSearchEnabled={webSearchEnabled}
                          setWebSearchEnabled={handleUserSetWebSearchEnabled}
                          createAgentEnabled={agentsFeatureEnabled ? createAgentEnabled : false}
                          setCreateAgentEnabled={handleUserSetCreateAgentEnabled}
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
                          isDisabled={buttonStatus === 'streaming' || isFileProcessing}
                        />
                      ) : showFilePreview && filePreview ? (
                        <FilePreviewPanel
                          preview={filePreview}
                          onClose={closeFilePreview}
                          bucket={OUTPUTS_BUCKET || ''}
                          region={REGION || ''}
                          getCredentials={getCredentials}
                        />
                      ) : showSplitView && inlineDocument ? (
                        <DocumentPanel documentContent={inlineDocument} onClose={closeDocument} />
                      ) : null
                    }
                    showRight={
                      settingsPanel.isPanelOpen ||
                      (showFilePreview && !!filePreview) ||
                      (inlineDocument && showSplitView)
                    }
                    leftFraction={
                      settingsPanel.isPanelOpen
                        ? 0.7
                        : showFilePreview && filePreview
                          ? filePreviewLeftFraction
                          : leftFraction
                    }
                    onLeftFractionChange={
                      settingsPanel.isPanelOpen
                        ? () => {}
                        : showFilePreview && filePreview
                          ? setFilePreviewLeftFraction
                          : setLeftFraction
                    }
                    minLeft={200}
                    minRight={settingsPanel.isPanelOpen ? 280 : 200}
                    showDivider={!settingsPanel.isPanelOpen}
                    rightPadding={settingsPanel.isPanelOpen ? '0.5rem' : '1rem'}
                  />
                </div>
              </div>
              {/* End white container */}
            </div>
          </div>
        </div>
      </LayoutDashboard>

      {/* Mobile document viewer */}
      <Modal
        show={isMobile && showDocumentModal && !!inlineDocument}
        onHide={() => {
          setShowDocumentModal(false);
          closeDocument();
        }}
        fullscreen
        centered
        scrollable
        dialogClassName="document-modal"
      >
        <Modal.Header closeButton>
          <Modal.Title>{inlineDocument?.title || 'Document'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="message-content markdown-content">
            <MarkdownContent content={inlineDocument?.content || ''} />
          </div>
        </Modal.Body>
        {inlineDocument?.content ? (
          <Modal.Footer>
            <div className="flex-grow-1">
              <ResultActions content={inlineDocument.content} title={inlineDocument.title || 'Document'} />
            </div>
          </Modal.Footer>
        ) : null}
      </Modal>

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
              }}
              bucket={OUTPUTS_BUCKET || ''}
              region={REGION || ''}
              getCredentials={getCredentials}
              embedded={true}
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
