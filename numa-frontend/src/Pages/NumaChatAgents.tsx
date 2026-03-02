import { useState, useRef, useEffect, useMemo, useCallback, type ReactNode, type SetStateAction } from 'react';
import { Button, Alert, Modal, Collapse } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../Providers/AuthProvider';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { ChatHistorySidebar } from '../Components/Chat/ChatHistorySidebar';
import { ChatFileUpload } from '../Components/Chat/ChatFileUpload';
import { AgentsSidebar, AgentsSidebarHandle } from '../Components/Agents/AgentsSidebar';
import { PageHeader } from '../Components/PageHeader';
import { callChatAgentStreaming } from '../Services/chatAgentService';
import { ChatInput } from '../Components/Chat/ChatInput';
import { DocumentPanel } from '../Components/DocumentPanel';
import { ChatMessages } from '../Components/Chat/ChatMessages';
import { NewChat } from '../Components/Chat/NewChat';
import { MarkdownContent } from '../Components/Renderers/MarkdownContent';
import { ResultActions } from '../Components/ResultActions';
import ResizableSplitView from '../Components/ResizableSplitView';
import { generateSystemPrompt, getEnabledTools } from '../utils/chatSystemPromptUtils';
import { manifestService } from '../Services/manifestService';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import {
  getModelId,
  MODEL_TYPES,
  isInFallbackMode,
  setFallbackMode,
  isQuotaLimitError,
} from '../utils/bedrockModelConfig';
import { parseChunkWithoutDocComments, extractSingleDocBlock, createDocStripState } from '../utils/streamingProcessors';
import { loadConversation } from '../utils/conversationLoader';
import { processToolEvent } from '../utils/toolEventHandlers';
import { useConversationManager } from '../hooks/useConversationManager';
import { useStreamingHandler } from '../hooks/useStreamingHandler';
import { useDocumentProcessor } from '../hooks/useDocumentProcessor';
import { useCompanyProfile } from '../hooks/useCompanyProfile';
import { autoNameConversation } from '../utils/autoChatTitle';
import { useChatInactivity } from '../hooks/useChatInactivity';
import { useDrawerBackClose } from '../hooks/useDrawerBackClose';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import type { AgentSummary } from '../types/agents';
import { getAgent, listAgents } from '../Services/AgentsService';
import { getConnectionConfig } from '../config/integrationsConfig';
import { sortAgentsByPriority } from '../utils/agentSortingUtils';
import { formatAgentDisplayName } from '../utils/agentUtils';
import { AdminAgentsService, type AgentsMode } from '../Services/AdminAgentsService';
import { ChatSettingsService, type ChatSettings, DEFAULT_CHAT_SETTINGS } from '../Services/ChatSettingsService';
import { applyLanguagePreference } from '../utils/languagePreference';
import { AgentAvatar } from '../Components/Agents/AgentAvatar';
import { AgentScheduleModal } from '../Components/Agents/AgentScheduleModal';
import { ScheduleService } from '../Services/ScheduleService';
import type { AgentScheduleSnapshot, ScheduledRunConfig } from '../types/agentSchedules';

type ConversationChatConfig = {
  autoToolsEnabled?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
  dataAnalysisEnabled?: boolean;
  enabledKBIds?: string[];
  enabledConnectionIds?: string[];
};

type DataAnalysisFile = {
  fileName: string;
  fileType?: string;
  s3Key?: string;
};

type ScheduleDefaults = {
  agentId: string;
  agentTitle?: string;
  conversationId: string;
  agentSnapshot?: AgentScheduleSnapshot;
  runConfig: ScheduledRunConfig;
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

const NumaChatAgents = () => {
  const { t } = useTranslation(['chat', 'errors']);
  // Basic UI state
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [createAgentEnabled, setCreateAgentEnabled] = useState(false);
  const [dataAnalysisEnabled, setDataAnalysisEnabled] = useState(false);
  const [dataAnalysisAvailable, setDataAnalysisAvailable] = useState(true);
  const [availableConnections, setAvailableConnections] = useState<
    Array<{ id: string; name: string; isConnected: boolean; mcpServerUrl?: string }>
  >([]);
  const [enabledConnections, setEnabledConnections] = useState<string[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState<boolean>(false);
  const [autoToolsEnabled, setAutoToolsEnabled] = useState(true); // Default to auto mode
  const [buttonStatus, setButtonStatus] = useState('idle');
  const [isFileProcessing, setIsFileProcessing] = useState(false);
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
  const [schedulingEnabled] = useState(() =>
    typeof window !== 'undefined' ? window.sessionStorage.getItem('SCHEDULING') === 'true' : false,
  );
  const [missingConfirm, setMissingConfirm] = useState<{ agent: AgentSummary; missing: string[] } | null>(null);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  // SWR: initialize from localStorage cache so chat settings are available instantly
  const [userChatSettings, setUserChatSettings] = useState<ChatSettings>(
    () => ChatSettingsService.getCached() ?? DEFAULT_CHAT_SETTINGS,
  );
  const [chatSettingsLoaded, setChatSettingsLoaded] = useState(() => !!ChatSettingsService.getCached());
  const [userSettingsModified, setUserSettingsModified] = useState(false);
  const [pendingConversationChatConfig, setPendingConversationChatConfig] = useState<ConversationChatConfig | null>(
    null,
  );
  const [dataAnalysisBannerFiles, setDataAnalysisBannerFiles] = useState<DataAnalysisFile[] | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDefaults, setScheduleDefaults] = useState<ScheduleDefaults | null>(null);
  const [scheduleSuccess, setScheduleSuccess] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Refs
  const messageEndRef = useRef(null);
  const chatHistoryRef = useRef(null);
  const agentsSidebarRef = useRef<AgentsSidebarHandle | null>(null);
  const preselectHandledRef = useRef(false);
  const preselectActivatedRef = useRef(false);
  const preselectTimerRef = useRef<number | null>(null);
  const autoNamingAttemptedRef = useRef<Set<string>>(new Set());
  const conversationChatConfigSaveTimeoutRef = useRef<number | null>(null);
  const isApplyingConversationChatConfigRef = useRef(false);
  const dataAnalysisPollersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const dataAnalysisEventIndexRef = useRef<Map<string, number>>(new Map());

  // Custom hooks
  // V1 chat: explicitly set isWorkspaceMode to false so chats aren't marked as workspace conversations
  const conversationManager = useConversationManager({ isWorkspaceMode: false });
  const streamingHandler = useStreamingHandler();
  const documentProcessor = useDocumentProcessor();
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
  const { setCurrentAbort, resetStreamingState } = streamingHandler;

  const { user, bedrockRuntimeClient, numaChatDynamoUtils, getAccessToken, lambdaClient } = useAuth();
  // Extract user info from token early (used by hooks/deps below)
  const idToken = user?.decoded_tokens?.idToken ?? {};
  const sub = idToken.sub;
  const userEmail = idToken.email || '';
  const userName = userEmail.split('@')[0] || undefined; // Extract first part of email as name
  const { numaGet } = useNumaRequest();
  const { selectedKB: _selectedKB, selectedKbId: _selectedKbId, availableKBs, isLoadingKBs } = useKnowledgeBase();
  const [enabledKBIds, setEnabledKBIds] = useState<string[]>([]);
  const markUserSettingsModified = useCallback(() => {
    setUserSettingsModified(true);
  }, []);

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
      if (typeof parsed.dataAnalysisEnabled === 'boolean') {
        setDataAnalysisEnabled(dataAnalysisAvailable ? parsed.dataAnalysisEnabled : false);
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
    [agentsFeatureEnabled, availableConnections, availableKBs, dataAnalysisAvailable],
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

  const handleUserSetDataAnalysisEnabled = useCallback(
    (value: SetStateAction<boolean>) => {
      if (!dataAnalysisAvailable) return;
      markUserSettingsModified();
      setDataAnalysisEnabled(value);
    },
    [dataAnalysisAvailable, markUserSettingsModified],
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

  const isDataAnalysisFile = useCallback((file: { fileName?: string; fileType?: string }) => {
    const name = (file.fileName || '').toLowerCase();
    const type = (file.fileType || '').toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.json')) {
      return true;
    }
    return (
      type === 'text/csv' ||
      type === 'application/csv' ||
      type === 'application/json' ||
      type === 'application/vnd.ms-excel' ||
      type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  }, []);

  const handleFilesUploadedForDataAnalysis = useCallback(
    (files: Array<{ fileName?: string; fileType?: string; filePath?: string }>) => {
      const toolEnabled = dataAnalysisAvailable && (autoToolsEnabled || dataAnalysisEnabled);
      if (!toolEnabled) return;
      const dataFiles = (files || [])
        .filter((file) => isDataAnalysisFile(file))
        .map((file) => ({
          fileName: file.fileName || t('dataAnalysis.fileFallback'),
          fileType: file.fileType,
          s3Key: file.filePath,
        }));
      if (dataFiles.length > 0) {
        setDataAnalysisBannerFiles(dataFiles);
      }
    },
    [autoToolsEnabled, dataAnalysisAvailable, dataAnalysisEnabled, isDataAnalysisFile],
  );

  const addToolCardSteps = useCallback((toolUseId: string, steps: string[]) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      const lastMsg = { ...updated[lastIdx] } as { segments?: unknown[] };
      const segs = [...(lastMsg.segments || [])];
      const idx = segs.findIndex(
        (seg) =>
          typeof seg === 'object' &&
          seg !== null &&
          'kind' in seg &&
          (seg as { kind: string }).kind === 'tool_card' &&
          (seg as { toolUseId?: string | null }).toolUseId === toolUseId,
      );
      if (idx >= 0) {
        const seg = segs[idx] as { steps?: string[] };
        segs[idx] = { ...seg, steps: [...(seg.steps || []), ...steps] };
        lastMsg.segments = segs;
        updated[lastIdx] = lastMsg as (typeof updated)[number];
      }
      return updated;
    });
  }, []);

  const stopDataAnalysisPolling = useCallback((toolUseId: string) => {
    const timer = dataAnalysisPollersRef.current.get(toolUseId);
    if (timer) {
      clearInterval(timer);
      dataAnalysisPollersRef.current.delete(toolUseId);
    }
    dataAnalysisEventIndexRef.current.delete(toolUseId);
  }, []);

  const startDataAnalysisPolling = useCallback(
    (toolUseId: string, jobId: string) => {
      if (!jobId || dataAnalysisPollersRef.current.has(toolUseId)) return;

      const poll = async () => {
        try {
          const response = await numaGet(`/api/data-analysis/jobs/${jobId}`);
          const events = Array.isArray(response?.events) ? response.events : [];
          const lastIndex = dataAnalysisEventIndexRef.current.get(toolUseId) ?? 0;
          if (events.length > lastIndex) {
            const next = events
              .slice(lastIndex)
              .map((evt) => (evt && typeof evt.message === 'string' ? evt.message : null))
              .filter((msg): msg is string => !!msg);
            if (next.length > 0) {
              addToolCardSteps(toolUseId, next);
            }
            dataAnalysisEventIndexRef.current.set(toolUseId, events.length);
          }
          const status = String(response?.status || '').toLowerCase();
          const terminalStatuses = new Set([
            'success',
            'failure',
            'completed',
            'complete',
            'succeeded',
            'done',
            'cancelled',
            'canceled',
          ]);
          if (terminalStatuses.has(status)) {
            stopDataAnalysisPolling(toolUseId);
          }
        } catch (error) {
          console.warn('[DataAnalysisPolling] Failed to fetch job status', error);
        }
      };

      poll();
      const timer = setInterval(poll, 5000);
      dataAnalysisPollersRef.current.set(toolUseId, timer);
    },
    [addToolCardSteps, numaGet, stopDataAnalysisPolling],
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
        dataAnalysisEnabled,
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
    dataAnalysisEnabled,
    enabledConnections,
    enabledKBIds,
    agentsFeatureEnabled,
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
        setDataAnalysisEnabled(dataAnalysisAvailable ? autoTools || userChatSettings.dataAnalysisEnabled : false);
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
      setDataAnalysisEnabled(dataAnalysisAvailable ? autoTools || (config.dataAnalysisEnabled ?? false) : false);
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
    [availableKBs, defaultConnectionIdsFromSettings, defaultKBIdsFromSettings, userChatSettings, dataAnalysisAvailable],
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
        await applyLanguagePreference(settings.language);
      } catch (err) {
        console.warn('Failed to load user chat settings, using defaults', err);
        setUserChatSettings(DEFAULT_CHAT_SETTINGS);
        await applyLanguagePreference(DEFAULT_CHAT_SETTINGS.language);
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

  // Read region once on mount, not in useMemo
  const [REGION] = useState(() => window.sessionStorage.getItem('REGION'));

  const getMissingIntegrations = (agent: AgentSummary): string[] => {
    const required = agent.requiredIntegrations ?? [];
    if (required.length === 0) return [];
    const connectedIds = new Set(availableConnections.map((conn) => conn.id));
    return required.filter((integration) => !connectedIds.has(integration));
  };

  const handleRunDataAnalysisFromBanner = () => {
    if (!dataAnalysisBannerFiles || dataAnalysisBannerFiles.length === 0) return;
    const names = dataAnalysisBannerFiles.map((f) => f.fileName).filter(Boolean);
    const preview = names.slice(0, 3).join(', ');
    const suffix = names.length > 3 ? ` and ${names.length - 3} more` : '';
    const prompt = `Run data analysis on the uploaded file(s): ${preview}${suffix}. Summarize key insights and highlight any notable trends or outliers.`;
    setDataAnalysisBannerFiles(null);
    handleSubmit({ preventDefault: () => {} }, prompt);
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
      setAgentError((error as Error)?.message ?? t('errors.activateAgentFailed'));
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
        setAgentError((err as Error)?.message ?? t('errors.activateSelectedAgentFailed'));
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
    if (lambdaClient && hasPipedreamFeature && relayLambdaArn) loadConnectionStatus();
  }, [lambdaClient]);

  // Ref for input textarea
  const inputRef = useRef(null);
  const isProcessingRef = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);

  const handleChatScroll = useCallback(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    const threshold = 80;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= threshold;
  }, []);

  // Auto-scroll to bottom on messages or ephemeral changes
  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
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
    setDataAnalysisBannerFiles(null);
    setDataAnalysisBannerFiles(null);

    // Reset split view state - hide document panel
    setShowSplitView(false);
    setLeftFraction(0.99);

    // Clear manual loading state to prevent conflicts
    setIsManuallyLoading(false);

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
    excludeWorkspaceConversations: false,
    // DO NOT pass inputMessage: keep suggestions visible while typing; hide on submit instead
  });

  // Sort agents by favorites first, then most recently used, then updatedAt
  const sortedPersonalAgents = useMemo(() => {
    if (!agentsFeatureEnabled) return [];
    return sortAgentsByPriority(personalAgents, recentConversations);
  }, [personalAgents, recentConversations, agentsFeatureEnabled]);

  const shouldShowNewChatView = showContinueSuggestions && messages.length === 0;

  // Auto-load conversation when conversationId is set by useConversationManager
  // But skip auto-load if this conversation was just created in this session, messages already exist, or manual loading is in progress
  useEffect(() => {
    if (
      conversationId &&
      numaChatDynamoUtils &&
      sub &&
      !hasUserStartedNewChat &&
      messages.length === 0 &&
      !isManuallyLoading
    ) {
      console.log('[NumaChat] Auto-loading conversation:', conversationId);
      handleLoadConversation(conversationId);
    } else if (conversationId && hasUserStartedNewChat) {
      console.log('[NumaChat] Skipping auto-load for just-created conversation:', conversationId);
    } else if (conversationId && messages.length > 0) {
      console.log('[NumaChat] Skipping auto-load because messages already exist:', messages.length);
    } else if (conversationId && isManuallyLoading) {
      console.log('[NumaChat] Skipping auto-load because manual loading is in progress:', conversationId);
    }
  }, [conversationId, numaChatDynamoUtils, sub, hasUserStartedNewChat, messages.length, isManuallyLoading]);

  // (Typing hide handled in hook)

  // Helper to refresh sidebar
  const refreshSidebar = () => {
    chatHistoryRef.current?.refreshConversations();
  };

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
    setUserSettingsModified(false);

    // Clear all UI states
    setMessages([]);
    setUploadedFiles([]);
    setInputMessage('');
    closeDocument();

    // Reset split view state - hide document panel
    setShowSplitView(false);
    setLeftFraction(0.99); // Reset to full chat view

    // Clear manual loading state to prevent conflicts
    setIsManuallyLoading(false);

    // Clear auto-naming tracking for new conversation
    autoNamingAttemptedRef.current.clear();

    // Surface the enhanced new chat view immediately (with or without history)
    forceShowNewChatView();

    // Use the hook's new chat handler
    await handleNewChat();
  };

  // Configure model, tools, and system prompt for agent call
  const configureAgentCall = (
    autoToolsEnabled,
    webSearchEnabled,
    dataAnalysisEnabled,
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
      dataAnalysisEnabled,
      agentsFeatureEnabled ? createAgentEnabled : false,
      enabledKBIds,
      dataAnalysisAvailable,
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

  const _handleOpenScheduleModal = () => {
    if (!currentAgent) {
      setScheduleError(t('schedule.errors.noAgent'));
      return;
    }
    if (!conversationId) {
      setScheduleError(t('schedule.errors.noConversation'));
      return;
    }
    setScheduleError(null);
    const scheduleConfig = configureAgentCall(
      autoToolsEnabled,
      webSearchEnabled,
      createAgentEnabled,
      idToken,
      companyProfile,
      user,
      sub,
    );
    const runConfig: ScheduledRunConfig = {
      systemPrompt: scheduleConfig.systemPrompt,
      modelId: scheduleConfig.modelId,
      enabledTools: scheduleConfig.enabledTools,
      enabledConnections,
      enabledKBIds,
      autoToolsEnabled,
      webSearchEnabled,
      createAgentEnabled,
    };
    const snapshot: AgentScheduleSnapshot | undefined = currentAgent
      ? {
          agentId: currentAgent.agentId,
          title: currentAgent.title,
          icon: currentAgent.icon,
          iconImage: currentAgent.iconImage,
          version: currentAgent.version,
          visibility: currentAgent.visibility,
          systemPrompt: currentAgent.systemPrompt,
          userWelcomeMessage: currentAgent.userWelcomeMessage,
          requiredIntegrations: currentAgent.requiredIntegrations,
          toolsConfig: currentAgent.toolsConfig,
        }
      : undefined;
    setScheduleDefaults({
      agentId: currentAgent.agentId,
      agentTitle: currentAgent.title,
      conversationId,
      agentSnapshot: snapshot,
      runConfig,
    });
    setShowScheduleModal(true);
  };

  const handleScheduleModalClose = () => {
    setShowScheduleModal(false);
    setScheduleDefaults(null);
  };

  const handleCreateSchedule = async ({
    promptText,
    cronExpression,
    timezone,
    label,
  }: {
    promptText: string;
    cronExpression: string;
    timezone: string;
    label?: string;
  }) => {
    if (!scheduleDefaults) {
      throw new Error(t('schedule.errors.missingContext'));
    }
    const payload = {
      agentId: scheduleDefaults.agentId,
      agentTitle: scheduleDefaults.agentTitle,
      conversationId: scheduleDefaults.conversationId,
      promptText,
      cronExpression,
      timezone,
      label,
      runConfig: scheduleDefaults.runConfig,
      agentSnapshot: scheduleDefaults.agentSnapshot,
    };
    await ScheduleService.create(numaPost, payload);
    setScheduleSuccess(t('schedule.success.created'));
  };

  // Handle streaming chunk data
  const createStreamChunkHandler = (streamingHandler, setMessages, setButtonStatus) => {
    let hasStreamingStarted = false;
    let hasReceivedTextChunk = false;
    let accumulatedResponse = '';
    const docStripState = createDocStripState();

    return {
      onChunk: (chunk) => {
        if (!hasStreamingStarted) {
          // Remove 'thinking' status, set 'streaming' status
          setMessages((prev) => {
            const updated = [...prev];
            const idx = updated.findIndex((m) => m.status === 'thinking');
            if (idx >= 0) updated[idx].status = null;
            return updated;
          });
          setButtonStatus('streaming');
          hasStreamingStarted = true;
        }
        hasReceivedTextChunk = true;

        // Accumulate the response
        accumulatedResponse += chunk;

        // Parse chunk to remove doc comments for display
        const sanitizedChunk = parseChunkWithoutDocComments(chunk, docStripState);

        // Add to streaming content buffer (will be flushed when tools are called or at end)
        streamingHandler.textBufferRef.current += sanitizedChunk;

        // Create a snapshot of the current buffer content for UI updates (race condition protection)
        const bufferSnapshot = streamingHandler.textBufferRef.current;

        // Update the last assistant message with live streaming content using buffer snapshot
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          const lastMsg = { ...updated[lastIdx] };
          const segs = [...(lastMsg.segments || [])];

          // Update the last text segment if it exists and is "live", otherwise create new one
          if (segs.length && segs[segs.length - 1].kind === 'text' && !segs[segs.length - 1].finalized) {
            segs[segs.length - 1] = { ...segs[segs.length - 1], text: bufferSnapshot };
          } else {
            segs.push({ kind: 'text', text: bufferSnapshot, finalized: false });
          }

          lastMsg.segments = segs;
          lastMsg.content = bufferSnapshot; // legacy path
          updated[lastIdx] = lastMsg;
          return updated;
        });
      },
      getStreamingState: () => ({ hasStreamingStarted, hasReceivedTextChunk, accumulatedResponse }),
      getHasStreamingStarted: () => hasStreamingStarted,
      setHasStreamingStarted: (value) => {
        hasStreamingStarted = value;
      },
    };
  };

  // Handle stream completion
  const createStreamCompleteHandler = (
    setCurrentAbort,
    setMessages,
    setButtonStatus,
    isProcessingRef,
    flushPendingText,
    documentProcessor,
    numaChatDynamoUtils,
    refreshSidebar,
    setUploadedFiles,
    setInputMessage,
    inputRef,
  ) => {
    return async (cid, userMsg, sub, chunkHandler) => {
      console.log('[NumaChat] Chat agent completion callback triggered');
      const { hasStreamingStarted, hasReceivedTextChunk, accumulatedResponse } = chunkHandler.getStreamingState();
      console.log(
        '[NumaChat] Final streaming state - hasStreamingStarted:',
        hasStreamingStarted,
        'hasReceivedTextChunk:',
        hasReceivedTextChunk,
      );

      // Clean up abort function reference
      setCurrentAbort(null);

      setButtonStatus('idle');
      isProcessingRef.current = false; // Reset processing flag

      // Flush any remaining text to save the final segment with content preservation
      console.log('[NumaChat] Stream completion - flushing final text buffer');
      flushPendingText(cid, true); // preserveContent=true to prevent race condition

      // Extract doc from raw text
      const docBlock = extractSingleDocBlock(accumulatedResponse);
      if (docBlock) {
        documentProcessor.setInlineDocument({ title: docBlock.docTitle, content: docBlock.docContent });

        // Attach doc to the last assistant message
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            updated[lastIdx].docTitle = docBlock.docTitle;
            updated[lastIdx].docContent = docBlock.docContent;
          }
          return updated;
        });

        // Save document metadata to DynamoDB for history reconstruction
        console.log('[NumaChat] Saving document metadata to DynamoDB');
        console.log('[NumaChat] Document metadata:', {
          docTitle: docBlock.docTitle,
          docContent: docBlock.docContent,
        });
        if (numaChatDynamoUtils && cid && sub) {
          numaChatDynamoUtils
            .addMessage({
              conversationId: cid,
              userId: sub,
              messageType: 'document_metadata',
              role: 'assistant',
              content: JSON.stringify({
                docTitle: docBlock.docTitle,
                docContent: docBlock.docContent,
              }),
            })
            .catch((err) => console.error('Error saving document metadata:', err));
        }
      }

      // Update the conversation meta item (no need to save full response as we're saving segments)
      if (numaChatDynamoUtils) {
        numaChatDynamoUtils
          .updateMetaItem(cid, sub, {
            latestTimestamp: Date.now(),
            latestMessage: userMsg,
          })
          .catch((err) => console.error('Error updating meta item:', err));
      }

      // Attempt auto-naming after first assistant response (only once per conversation per session)
      try {
        if (bedrockRuntimeClient && numaChatDynamoUtils && sub && cid) {
          // Prevent duplicate auto-naming for same conversation
          if (autoNamingAttemptedRef.current.has(cid)) {
            console.log('[NumaChat] Auto-naming already attempted for this conversation, skipping');
          } else {
            autoNamingAttemptedRef.current.add(cid);
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
          }
        }
      } catch (e) {
        console.error('Auto-naming failed:', e);
      }

      // Refresh the sidebar
      refreshSidebar();
      setUploadedFiles([]);

      // Reset the hasUserStartedNewChat flag after first successful submit
      if (hasUserStartedNewChat) {
        resetUserNewChatFlag();
        // Cleanup preselect session keys after first interaction
        try {
          sessionStorage.removeItem('numa_preselected_agent');
          sessionStorage.removeItem('numa_preselected_agent_token');
          sessionStorage.removeItem('numa_preselected_agent_consumed');
        } catch {
          /* ignore */
        }
      }

      setTimeout(() => inputRef.current?.focus(), 0);
    };
  };

  // Submit user input
  const handleSubmit = async (e, overrideMessage?: string) => {
    e.preventDefault();

    // Prevent duplicate submissions (React StrictMode protection) - check FIRST
    if (isProcessingRef.current) {
      console.log('[NumaChat] Ignoring duplicate handleSubmit call');
      return;
    }
    isProcessingRef.current = true;

    // Validate input
    const userMsg = (overrideMessage ?? inputMessage).trim();
    if (!userMsg && uploadedFiles.length === 0) {
      isProcessingRef.current = false; // Reset flag on early return
      return;
    }

    // This is a user interaction
    resetInactivityTimer();
    // Hide suggestions on first interaction
    hideSuggestions();
    // Dismiss data analysis banner on any message send
    if (dataAnalysisBannerFiles) {
      setDataAnalysisBannerFiles(null);
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
        userMsg,
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
      // Add user message to local UI state
      const userMsgObject = { role: 'user', content: userMsg };
      setMessages((prev) => [...prev, userMsgObject]);

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

      const { modelId, enabledTools, systemPrompt, userAuth, clientName } = configureAgentCall(
        autoToolsEnabled,
        webSearchEnabled,
        dataAnalysisEnabled,
        createAgentEnabled,
        idToken,
        companyProfile,
        user,
        sub,
      );

      // Show "thinking…" bubble for streaming response
      const thinkingMessage = { role: 'assistant', segments: [], status: 'thinking' };
      setMessages((prev) => [...prev, thinkingMessage]);

      // Reset streaming helpers for this turn
      resetStreamingState();

      // Create streaming handlers
      const chunkHandler = createStreamChunkHandler(streamingHandler, setMessages, setButtonStatus);
      const completeHandler = createStreamCompleteHandler(
        setCurrentAbort,
        setMessages,
        setButtonStatus,
        isProcessingRef,
        flushPendingText,
        documentProcessor,
        numaChatDynamoUtils,
        refreshSidebar,
        setUploadedFiles,
        setInputMessage,
        inputRef,
      );

      try {
        // Diagnostics: log prompt length and preview before calling the agent
        try {
          console.log('[Diag] ChatAgent prompt length:', userMsg?.length ?? 0);
          console.log('[Diag] ChatAgent prompt preview:', (userMsg || '').slice(0, 200));
        } catch {
          // Ignore logging errors
        }

        const abortStream = await callChatAgentStreaming(
          userMsg,
          cid, // Pass conversationId - backend will load history from DynamoDB
          enabledTools, // Pass enabled tools configuration
          systemPrompt, // Pass the enhanced system prompt
          modelId, // Pass the selected model ID
          // onChunk - handle each piece of streaming data
          chunkHandler.onChunk,
          // onComplete - streaming finished
          () => completeHandler(cid, userMsg, sub, chunkHandler),
          // onError - handle streaming errors
          (error) => {
            console.error('Error calling Chat Agent (streaming):', error);

            // Clean up abort function reference
            setCurrentAbort(null);

            isProcessingRef.current = false; // Reset processing flag on error

            // Check for quota/throttling errors and set fallback mode
            if (isQuotaLimitError(error)) {
              console.log('[NumaChat] Quota limit exceeded, setting fallback mode for client:', clientName);
              setFallbackMode(clientName);

              setMessages((prev) => {
                const updated = [...prev];
                const thinkingIndex = updated.findIndex((m) => m.status === 'thinking');
                if (thinkingIndex >= 0) {
                  updated.splice(thinkingIndex, 1);
                }
                return [
                  ...updated,
                  {
                    role: 'system',
                    content: t('systemMessages.backupModel'),
                  },
                ];
              });
            } else {
              // Handle other errors normally
              const message = resolveErrorMessage(error, t('errors:unknown'));
              setMessages((prev) => {
                const updated = [...prev];
                const thinkingIndex = updated.findIndex((m) => m.status === 'thinking');
                if (thinkingIndex >= 0) {
                  updated.splice(thinkingIndex, 1);
                }
                return [...updated, { role: 'system', content: t('systemMessages.agentError', { message }) }];
              });
            }

            setButtonStatus('idle');
            setUploadedFiles([]);
            setTimeout(() => {
              inputRef.current?.focus();
            }, 0);
          },
          // onEvent – handle raw event frames (e.g., tool usage)
          (eventMsg) => {
            processToolEvent(
              eventMsg,
              {
                processedEventIds: streamingHandler.processedEventIdsRef.current,
                toolUseMap: streamingHandler.toolUseMapRef.current,
                hasStreamingStarted: chunkHandler.getHasStreamingStarted(),
                setHasStreamingStarted: chunkHandler.setHasStreamingStarted,
              },
              {
                setMessages,
                setButtonStatus,
                flushPendingText,
                saveToolCall:
                  numaChatDynamoUtils && cid && sub
                    ? (toolData) => {
                        numaChatDynamoUtils
                          .addToolMessage({
                            conversationId: cid,
                            userId: sub,
                            messageType: 'tool_call',
                            role: 'assistant',
                            ...toolData,
                          })
                          .catch((err) => console.error('Error saving tool call:', err));
                      }
                    : null,
                saveToolResult:
                  numaChatDynamoUtils && cid && sub
                    ? (toolData) => {
                        numaChatDynamoUtils
                          .addToolMessage({
                            conversationId: cid,
                            userId: sub,
                            messageType: 'tool_result',
                            role: 'user',
                            ...toolData,
                          })
                          .catch((err) => console.error('Error saving tool result:', err));
                      }
                    : null,
                conversationId: cid,
                startDataAnalysisPolling,
                stopDataAnalysisPolling,
              },
            );
          },
          userAuth, // Pass user authentication context
          enabledConnections, // Pass enabled connections
          enabledKBIds, // Multi‑KB enabled IDs for this turn
        );

        // Store the abort function for the stop button
        setCurrentAbort(abortStream);
      } catch (agentErr) {
        console.error('Error initiating Chat Agent stream:', agentErr);
        isProcessingRef.current = false; // Reset processing flag on error
        setCurrentAbort(null); // Clear abort reference
        setMessages((prev) => {
          const updated = [...prev];
          const thinkingIndex = updated.findIndex((m) => m.status === 'thinking');
          if (thinkingIndex >= 0) {
            updated.splice(thinkingIndex, 1);
          }
          const message = resolveErrorMessage(agentErr, t('errors:unknown'));
          return [...updated, { role: 'system', content: t('systemMessages.agentError', { message }) }];
        });

        setButtonStatus('idle');
        setUploadedFiles([]);
        setTimeout(() => {
          inputRef.current?.focus();
        }, 0);
      }
    } catch (err) {
      console.error('Error invoking Chat Agent:', err);
      console.error('Full error details:', JSON.stringify(err, null, 2));
      isProcessingRef.current = false; // Reset processing flag on error
      setCurrentAbort(null); // Clear abort reference
      const message = resolveErrorMessage(err, t('errors.sendFailed'));
      const errorMsg = {
        role: 'system',
        content: `Error: ${message}. Please try again or refresh page.`,
      };
      setMessages((prev) => [...prev, errorMsg]);
      setButtonStatus('idle');
    }
  };

  // Load single conversation from DB using extracted utility
  const handleLoadConversation = async (selectedConversationId) => {
    if (!numaChatDynamoUtils) return;

    setIsManuallyLoading(true);
    setIsConversationLoading(true);
    setUserSettingsModified(false); // Reset so save effect doesn't fire with stale state from previous conversation
    setMessages([]); // Clear current messages immediately
    setDataAnalysisBannerFiles(null);
    resetUserNewChatFlag(); // Reset the flag since user is explicitly loading a conversation

    // This is a user interaction
    resetInactivityTimer();
    // Hide suggestions when loading a conversation
    hideSuggestions();

    try {
      const {
        messages: chatMessages,
        agentMeta,
        chatConfig,
      } = await loadConversation(selectedConversationId, numaChatDynamoUtils, sub, getAccessToken);
      setMessages(chatMessages);
      setConversationId(selectedConversationId);
      sessionStorage.setItem('currentConversationId', selectedConversationId);
      setPendingConversationChatConfig((chatConfig as ConversationChatConfig) || null);

      // Mark this conversation as already having been through auto-naming consideration
      // This prevents re-triggering auto-naming when resuming an existing conversation
      autoNamingAttemptedRef.current.add(selectedConversationId);

      if (agentMeta?.agentId) {
        try {
          const agent = await getAgent(numaGet, agentMeta.agentId);
          setCurrentAgent(agent);
          setPendingAgent(null);
          applyAgentConfiguration(agent);
        } catch (err) {
          console.error('Failed to hydrate agent for conversation', err);
          setAgentError(t('errors.loadAgentConfigFailed'));
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
    } catch (error) {
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
      setIsConversationLoading(false);
      setIsManuallyLoading(false);
    }
  };

  // Derived flag to show warning when no tools active in manual mode
  const noToolsActive =
    !currentAgent &&
    !autoToolsEnabled &&
    enabledKBIds.length === 0 &&
    !webSearchEnabled &&
    !dataAnalysisEnabled &&
    !createAgentEnabled;

  const dataAnalysisToolEnabled = dataAnalysisAvailable && (autoToolsEnabled || dataAnalysisEnabled);

  useEffect(() => {
    if (!autoToolsEnabled && !dataAnalysisEnabled) {
      setDataAnalysisBannerFiles(null);
    }
  }, [autoToolsEnabled, dataAnalysisEnabled]);

  useEffect(() => {
    return () => {
      dataAnalysisPollersRef.current.forEach((timer) => clearInterval(timer));
      dataAnalysisPollersRef.current.clear();
      dataAnalysisEventIndexRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadAvailability = async () => {
      try {
        const apps = await manifestService.fetchAppsFromManifest();
        const dataAnalysisApp = apps?.find((app: { id?: string }) => app?.id === 'data-analysis');
        const status = String(dataAnalysisApp?.status || '').toLowerCase();
        const isActive = status === 'active';
        if (isMounted) {
          setDataAnalysisAvailable(isActive);
          if (!isActive) {
            setDataAnalysisEnabled(false);
            setDataAnalysisBannerFiles(null);
          }
        }
      } catch (error) {
        console.warn('[NumaChat] Unable to determine data analysis availability', error);
        if (isMounted) {
          setDataAnalysisAvailable(false);
          setDataAnalysisEnabled(false);
          setDataAnalysisBannerFiles(null);
        }
      }
    };
    loadAvailability();
    return () => {
      isMounted = false;
    };
  }, []);

  const dataAnalysisBanner =
    dataAnalysisAvailable && dataAnalysisBannerFiles && dataAnalysisBannerFiles.length > 0 ? (
      <div className="alert alert-info d-flex align-items-center justify-content-between gap-3 mx-3 mt-3">
        <div>
          <div className="fw-semibold">{t('dataAnalysisBanner.title')}</div>
          <div className="small text-muted">
            {t('dataAnalysisBanner.description', { files: dataAnalysisBannerFiles.map((f) => f.fileName).join(', ') })}
          </div>
          <div className="small text-muted">{t('dataAnalysisBanner.note')}</div>
        </div>
        <div className="d-flex gap-2">
          <Button size="sm" variant="primary" onClick={handleRunDataAnalysisFromBanner}>
            {t('dataAnalysisBanner.actions.run')}
          </Button>
          <Button size="sm" variant="outline-secondary" onClick={() => setDataAnalysisBannerFiles(null)}>
            {t('dataAnalysisBanner.actions.notNow')}
          </Button>
        </div>
      </div>
    ) : null;

  // Helper: push buffered text as its own segment then clear buffer, and save to DynamoDB
  const flushPendingText = (currentConversationId = null, preserveContent = false) => {
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
      {agentsFeatureEnabled && agentsMode !== 'off' && (
        <AgentsSidebar
          ref={agentsSidebarRef}
          onSelectAgent={handleAgentSelect}
          currentAgentId={currentAgent?.agentId ?? null}
          recentConversations={recentConversations}
        />
      )}
      <Button variant="secondary" onClick={toggleChatHistory} title={t('history.title')}>
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
          title={t('page.title')}
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
            aria-label={showMobileActions ? t('page.mobileActions.hide') : t('page.mobileActions.show')}
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

      {schedulingEnabled && scheduleSuccess && (
        <div className="mt-3">
          <Alert variant="success" dismissible onClose={() => setScheduleSuccess(null)}>
            {scheduleSuccess}
          </Alert>
        </div>
      )}
      {schedulingEnabled && scheduleError && (
        <div className="mt-3">
          <Alert variant="warning" dismissible onClose={() => setScheduleError(null)}>
            {scheduleError}
          </Alert>
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
            excludeWorkspaceConversations={false}
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
                        <div
                          className="chat-messages flex-grow-1 overflow-auto"
                          ref={chatScrollRef}
                          onScroll={handleChatScroll}
                        >
                          {isConversationLoading ? (
                            <div className="d-flex justify-content-center align-items-center h-100">
                              <div className="text-center">
                                <div className="spinner-border text-primary" role="status">
                                  <span className="visually-hidden">{t('page.loading')}</span>
                                </div>
                                <p className="mt-2 text-muted">{t('page.loadingConversation')}</p>
                              </div>
                            </div>
                          ) : shouldShowNewChatView ? (
                            <NewChat
                              inputMessage={inputMessage}
                              setInputMessage={setInputMessage}
                              handleSubmit={handleSubmit}
                              setShowUploadModal={setShowUploadModal}
                              buttonStatus={buttonStatus}
                              webSearchEnabled={webSearchEnabled}
                              setWebSearchEnabled={handleUserSetWebSearchEnabled}
                              createAgentEnabled={agentsFeatureEnabled ? createAgentEnabled : false}
                              setCreateAgentEnabled={handleUserSetCreateAgentEnabled}
                              dataAnalysisEnabled={dataAnalysisEnabled}
                              setDataAnalysisEnabled={handleUserSetDataAnalysisEnabled}
                              dataAnalysisAvailable={dataAnalysisAvailable}
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
                              dataAnalysisBanner={dataAnalysisBanner}
                            />
                          ) : (
                            <ChatMessages
                              messages={messages}
                              messageEndRef={messageEndRef}
                              loadingIndicatorStyle={{}}
                              onOpenDocument={(title, content) => {
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
                            />
                          )}
                        </div>

                        {/* pinned input at bottom (hide during initial new chat flow) */}
                        {!shouldShowNewChatView && (
                          <div className="chat-input-wrapper">
                            {dataAnalysisBanner}
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
                              dataAnalysisEnabled={dataAnalysisEnabled}
                              setDataAnalysisEnabled={handleUserSetDataAnalysisEnabled}
                              dataAnalysisAvailable={dataAnalysisAvailable}
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
                            />
                          </div>
                        )}
                      </div>
                    }
                    right={
                      /* RIGHT PANE: document panel */
                      showSplitView && inlineDocument ? (
                        <DocumentPanel documentContent={inlineDocument} onClose={closeDocument} />
                      ) : null
                    }
                    showRight={inlineDocument && showSplitView}
                    leftFraction={leftFraction}
                    onLeftFractionChange={setLeftFraction}
                    minLeft={200}
                    minRight={200}
                  />
                </div>
              </div>
              {/* End white container */}
            </div>
          </div>
        </div>
      </LayoutDashboard>
      {schedulingEnabled && scheduleDefaults && (
        <AgentScheduleModal
          show={showScheduleModal}
          onHide={handleScheduleModalClose}
          agent={currentAgent}
          defaultPrompt={inputMessage}
          onCreate={handleCreateSchedule}
        />
      )}

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
          <Modal.Title>{inlineDocument?.title || t('page.documentTitle')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="message-content markdown-content">
            <MarkdownContent content={inlineDocument?.content || ''} />
          </div>
        </Modal.Body>
        {inlineDocument?.content ? (
          <Modal.Footer>
            <div className="flex-grow-1">
              <ResultActions content={inlineDocument.content} title={inlineDocument.title || t('page.documentTitle')} />
            </div>
          </Modal.Footer>
        ) : null}
      </Modal>

      {/* File upload */}
      <ChatFileUpload
        show={showUploadModal}
        onHide={() => setShowUploadModal(false)}
        getAccessToken={getAccessToken}
        setMessages={setMessages}
        conversationId={conversationId}
        sub={sub}
        refreshSidebar={refreshSidebar}
        setIsFileProcessing={setIsFileProcessing}
        ensureConversationReady={ensureConversationReady}
        resetUserNewChatFlag={resetUserNewChatFlag}
        pendingAgent={pendingAgent}
        currentAgent={currentAgent}
        setPendingAgent={setPendingAgent}
        resetInactivityTimer={resetInactivityTimer}
        dataAnalysisAvailable={dataAnalysisAvailable}
        dataAnalysisToolEnabled={dataAnalysisToolEnabled}
        onFilesUploaded={handleFilesUploadedForDataAnalysis}
      />
    </div>
  );
};

export { NumaChatAgents };
