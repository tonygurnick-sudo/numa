import { useState, useRef, useEffect, useMemo } from 'react';
import { Button, Alert, Modal } from 'react-bootstrap';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { fromWebToken } from '@aws-sdk/credential-providers';
import { useAuth } from '../Providers/AuthProvider';
import { preWarmAuroraDatabase } from '../utils/knowledgeBaseUtils';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { ChatHistorySidebar } from '../Components/Chat/ChatHistorySidebar';
import { ChatFileUpload } from '../Components/Chat/ChatFileUpload';
import { AgentsSidebar, AgentsSidebarHandle } from '../Components/Agents/AgentsSidebar';
import { PageHeader } from '../Components/PageHeader';
import AgentAvatar from '../Components/Agents/AgentAvatar';
import { callChatAgentStreaming } from '../Services/chatAgentService';
import { ChatInput } from '../Components/Chat/ChatInput';
import { DocumentPanel } from '../Components/DocumentPanel';
import { ChatMessages } from '../Components/Chat/ChatMessages';
import { NewChat } from '../Components/Chat/NewChat';
import ResizableSplitView from '../Components/ResizableSplitView';
import { generateSystemPrompt, getEnabledTools } from '../utils/chatSystemPromptUtils';
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
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import type { AgentSummary } from '../types/agents';
import { getAgent, listAgents } from '../Services/AgentsService';
import { getConnectionConfig } from '../config/integrationsConfig';
import { formatAgentDisplayName } from '../utils/agentUtils';
import { sortAgentsByPriority } from '../utils/agentSortingUtils';
import { AdminAgentsService, type AgentsMode } from '../Services/AdminAgentsService';

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
  // Basic UI state
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [createAgentEnabled, setCreateAgentEnabled] = useState(false);
  const [availableConnections, setAvailableConnections] = useState<
    Array<{ id: string; name: string; isConnected: boolean; mcpServerUrl?: string }>
  >([]);
  const [enabledConnections, setEnabledConnections] = useState<string[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState<boolean>(false);
  const [autoToolsEnabled, setAutoToolsEnabled] = useState(true); // Default to auto mode
  const [buttonStatus, setButtonStatus] = useState('idle');
  const [isFileProcessing, setIsFileProcessing] = useState(false);
  const [lambdaClient, setLambdaClient] = useState<LambdaClient | null>(null);
  const [isManuallyLoading, setIsManuallyLoading] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<AgentSummary | null>(null);
  const [pendingAgent, setPendingAgent] = useState<AgentSummary | null>(null);
  const [queuedPreselectedAgent, setQueuedPreselectedAgent] = useState<AgentSummary | null>(null);
  const [agentError, setAgentError] = useState<React.ReactNode | null>(null);
  const [personalAgents, setPersonalAgents] = useState<AgentSummary[]>([]);
  const [personalAgentsLoading, setPersonalAgentsLoading] = useState(false);
  const [agentsMode, setAgentsMode] = useState<AgentsMode>('full');
  const [missingConfirm, setMissingConfirm] = useState<{ agent: AgentSummary; missing: string[] } | null>(null);

  // Refs
  const messageEndRef = useRef(null);
  const chatHistoryRef = useRef(null);
  const agentsSidebarRef = useRef<AgentsSidebarHandle | null>(null);
  const preselectHandledRef = useRef(false);
  const preselectActivatedRef = useRef(false);
  const preselectTimerRef = useRef<number | null>(null);

  // Custom hooks
  const conversationManager = useConversationManager();
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
    openDocument,
    closeDocument,
  } = documentProcessor;
  const { setCurrentAbort, resetStreamingState } = streamingHandler;

  const { user, bedrockAgentRuntimeClient, bedrockRuntimeClient, numaChatDynamoUtils, getAccessToken } = useAuth();
  const { numaGet } = useNumaRequest();
  const { selectedKB: _selectedKB, selectedKbId: _selectedKbId, availableKBs } = useKnowledgeBase();
  const [enabledKBIds, setEnabledKBIds] = useState<string[]>([]);

  // Extract user info from token
  const idToken = user?.decoded_tokens?.idToken ?? {};
  const sub = idToken.sub;
  const userEmail = idToken.email || '';
  const userName = userEmail.split('@')[0] || undefined; // Extract first part of email as name

  // Feature flag: agents enabled?
  const agentsFeatureEnabled = useMemo(
    () => (typeof window !== 'undefined' ? window.sessionStorage.getItem('AGENTS') === 'true' : false),
    [],
  );

  // If feature disabled, ensure no agent is selected and agent-specific flags are off
  useEffect(() => {
    if (!agentsFeatureEnabled) {
      resetAgentState();
    }
  }, [agentsFeatureEnabled]);

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

  // Load personal agents once on mount (only when feature enabled)
  useEffect(() => {
    if (!agentsFeatureEnabled) {
      setPersonalAgents([]);
      return;
    }
    const loadPersonalAgents = async () => {
      if (!user) return;

      // Cache configuration
      const CACHE_KEY = `numa_personal_agents_${user.attributes?.sub || 'unknown'}`;
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
  }, [user, numaGet, agentsFeatureEnabled]);

  // Cleanup preselect timer on unmount
  useEffect(() => {
    return () => {
      if (preselectTimerRef.current) {
        clearTimeout(preselectTimerRef.current);
        preselectTimerRef.current = null;
      }
    };
  }, []);

  // Memoize constants to prevent unnecessary rerenders
  const REGION = useMemo(() => window.sessionStorage.getItem('REGION'), []);

  const applyAgentConfiguration = (agent: AgentSummary | null) => {
    if (!agent) {
      setAutoToolsEnabled(true);
      setWebSearchEnabled(false);
      setCreateAgentEnabled(false);
      setEnabledConnections([]);
      return;
    }

    const config = agent.toolsConfig ?? {};
    setAutoToolsEnabled(config.autoToolsEnabled ?? true);
    setWebSearchEnabled(config.webSearchEnabled ?? false);
    setCreateAgentEnabled(config.createAgentEnabled ?? false);
    setEnabledConnections(config.enabledConnections ?? []);
  };

  const resetAgentState = () => {
    setCurrentAgent(null);
    setPendingAgent(null);
    applyAgentConfiguration(null);
    setAgentError(null);
  };

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
        const client = new LambdaClient({ region: REGION, credentials });
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

  // Constants
  const PREFERRED_KNOWLEDGE_BASE = window.sessionStorage.getItem('PREFERRED_KNOWLEDGE_BASE') || 'bedrock';
  const BEDROCK_KNOWLEDGE_BASE_ID = window.sessionStorage.getItem('BEDROCK_KNOWLEDGE_BASE_ID');

  // Ref for input textarea
  const inputRef = useRef(null);
  const isProcessingRef = useRef(false);

  // Auto-scroll to bottom on messages or ephemeral changes
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Pre-warm Aurora database when component mounts (only for Bedrock knowledge base)
  useEffect(() => {
    const initializeServices = async () => {
      const warmUpDatabase = async () => {
        if (PREFERRED_KNOWLEDGE_BASE === 'bedrock' && bedrockAgentRuntimeClient && BEDROCK_KNOWLEDGE_BASE_ID) {
          console.log('Pre-warming Aurora database on page load...');
          await preWarmAuroraDatabase(bedrockAgentRuntimeClient, BEDROCK_KNOWLEDGE_BASE_ID);
        }
      };

      // Run any initializations that are still applicable
      Promise.resolve()
        .then(() => warmUpDatabase())
        .catch((error) => {
          console.warn('Service initialization error:', error);
        });
    };

    initializeServices();
  }, [PREFERRED_KNOWLEDGE_BASE, bedrockAgentRuntimeClient, BEDROCK_KNOWLEDGE_BASE_ID]);

  // Inactivity: when expired, start a new chat and show suggestions (hook will fetch suggestions)
  async function handleNewChatOnExpired() {
    // Stop any ongoing streaming response
    setButtonStatus('idle');
    resetStreamingState();
    resetAgentState();

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
    const newName = prompt('Enter new name for this conversation:', currentName);
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
    if (!window.confirm('Are you sure you want to delete this conversation?')) {
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

    // Surface the enhanced new chat view immediately (with or without history)
    forceShowNewChatView();

    // Use the hook's new chat handler
    await handleNewChat();
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

      // Attempt auto-naming after first assistant response/meta update
      try {
        if (bedrockRuntimeClient && numaChatDynamoUtils && sub && cid) {
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
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent duplicate submissions (React StrictMode protection) - check FIRST
    if (isProcessingRef.current) {
      console.log('[NumaChat] Ignoring duplicate handleSubmit call');
      return;
    }
    isProcessingRef.current = true;

    // Validate input
    if (!inputMessage.trim() && uploadedFiles.length === 0) {
      isProcessingRef.current = false; // Reset flag on early return
      return;
    }

    // This is a user interaction
    resetInactivityTimer();
    // Hide suggestions on first interaction
    hideSuggestions();

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
        inputMessage,
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
      const userMsg = inputMessage;

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
                    content: 'Switching to backup model due to high demand. Please try your request again.',
                  },
                ];
              });
            } else {
              // Handle other errors normally
              const message = resolveErrorMessage(error, 'Unknown error');
              setMessages((prev) => {
                const updated = [...prev];
                const thinkingIndex = updated.findIndex((m) => m.status === 'thinking');
                if (thinkingIndex >= 0) {
                  updated.splice(thinkingIndex, 1);
                }
                return [...updated, { role: 'system', content: `Agent error: ${message}` }];
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
          const message = resolveErrorMessage(agentErr, 'Unknown error');
          return [...updated, { role: 'system', content: `Agent error: ${message}` }];
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
      const message = resolveErrorMessage(err, 'Failed to send message');
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
    setMessages([]); // Clear current messages immediately
    resetUserNewChatFlag(); // Reset the flag since user is explicitly loading a conversation

    // This is a user interaction
    resetInactivityTimer();
    // Hide suggestions when loading a conversation
    hideSuggestions();

    try {
      const { messages: chatMessages, agentMeta } = await loadConversation(
        selectedConversationId,
        numaChatDynamoUtils,
        sub,
        getAccessToken,
      );
      setMessages(chatMessages);
      setConversationId(selectedConversationId);
      localStorage.setItem('currentConversationId', selectedConversationId);

      if (agentMeta?.agentId) {
        try {
          const agent = await getAgent(numaGet, agentMeta.agentId);
          setCurrentAgent(agent);
          setPendingAgent(null);
          applyAgentConfiguration(agent);
        } catch (err) {
          console.error('Failed to hydrate agent for conversation', err);
          setAgentError('Unable to load agent configuration for this conversation.');
          resetAgentState();
        }
      } else {
        resetAgentState();
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
    }
  };

  // Derived flag to show warning when no tools active in manual mode
  const noToolsActive =
    !currentAgent && !autoToolsEnabled && enabledKBIds.length === 0 && !webSearchEnabled && !createAgentEnabled;

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

  return (
    <div className="dashboard">
      {/* Page header with title and action buttons */}
      <PageHeader
        title="Numa Chat"
        actions={
          <>
            {agentsFeatureEnabled && agentsMode !== 'off' && (
              <AgentsSidebar
                ref={agentsSidebarRef}
                onSelectAgent={handleAgentSelect}
                currentAgentId={currentAgent?.agentId ?? null}
                recentConversations={recentConversations}
              />
            )}
            <Button variant="secondary" onClick={toggleChatHistory} title="Chat History">
              <i className="bi bi-clock-history me-1"></i>
              History
            </Button>
            <Button variant="primary" onClick={handleNewChatClick}>
              New Chat
            </Button>
          </>
        }
      />

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
                    <div>
                      <div
                        className="fw-semibold"
                        style={{ fontSize: '1.1rem', color: 'var(--brand-primary, var(--color-primary))' }}
                      >
                        {formatAgentDisplayName(currentAgent.title)}
                      </div>
                      <div className="small text-muted">AI Agent Assistant</div>
                    </div>
                  </div>
                )}

                {/* Missing integrations confirmation modal */}
                <Modal show={!!missingConfirm} onHide={() => setMissingConfirm(null)} centered>
                  <Modal.Header closeButton>
                    <Modal.Title>Missing integrations</Modal.Title>
                  </Modal.Header>
                  <Modal.Body>
                    <p className="mb-3">
                      This agent requests access to the following integrations which are not connected for your account:
                    </p>
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
                    <p className="mb-0 text-muted small">
                      Continuing may result in limited or unintended behavior. You can connect integrations now from the
                      Integrations page and try again.
                    </p>
                  </Modal.Body>
                  <Modal.Footer>
                    <Button variant="outline-secondary" onClick={() => setMissingConfirm(null)} className="me-auto">
                      <i className="bi bi-arrow-left me-2"></i>
                      Back
                    </Button>
                    <a className="btn btn-outline-primary" href="/integrations">
                      <i className="bi bi-link-45deg me-2"></i>
                      Go to Integrations
                    </a>
                    <Button
                      variant="primary"
                      onClick={async () => {
                        const info = missingConfirm;
                        setMissingConfirm(null);
                        if (info) await doStartAgentSession(info.agent, info.missing);
                      }}
                    >
                      Continue without
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
                              setShowUploadModal={setShowUploadModal}
                              buttonStatus={buttonStatus}
                              webSearchEnabled={webSearchEnabled}
                              setWebSearchEnabled={setWebSearchEnabled}
                              createAgentEnabled={agentsFeatureEnabled ? createAgentEnabled : false}
                              setCreateAgentEnabled={setCreateAgentEnabled}
                              autoToolsEnabled={autoToolsEnabled}
                              setAutoToolsEnabled={setAutoToolsEnabled}
                              availableConnections={availableConnections}
                              enabledConnections={enabledConnections}
                              setEnabledConnections={setEnabledConnections}
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
                              setEnabledKBIds={setEnabledKBIds}
                            />
                          ) : (
                            <ChatMessages
                              messages={messages}
                              messageEndRef={messageEndRef}
                              loadingIndicatorStyle={{}}
                              onOpenDocument={openDocument}
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
                            <ChatInput
                              inputMessage={inputMessage}
                              setInputMessage={setInputMessage}
                              handleSubmit={handleSubmit}
                              setShowUploadModal={setShowUploadModal}
                              buttonStatus={buttonStatus}
                              webSearchEnabled={webSearchEnabled}
                              setWebSearchEnabled={setWebSearchEnabled}
                              createAgentEnabled={agentsFeatureEnabled ? createAgentEnabled : false}
                              setCreateAgentEnabled={setCreateAgentEnabled}
                              autoToolsEnabled={autoToolsEnabled}
                              setAutoToolsEnabled={setAutoToolsEnabled}
                              availableConnections={availableConnections}
                              enabledConnections={enabledConnections}
                              setEnabledConnections={setEnabledConnections}
                              connectionsLoading={connectionsLoading}
                              hasPipedreamFeature={hasPipedreamFeature}
                              uploadsInProgress={isFileProcessing}
                              noToolsActive={noToolsActive}
                              externalInputRef={inputRef}
                              autoFocus={true}
                              enabledKBIds={enabledKBIds}
                              setEnabledKBIds={setEnabledKBIds}
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
      />
    </div>
  );
};

export { NumaChatAgents };
