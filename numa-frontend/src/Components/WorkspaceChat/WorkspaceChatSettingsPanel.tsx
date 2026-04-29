import React, { useMemo, useState, useCallback, Dispatch, SetStateAction } from 'react';
import { Button, Form, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Building2,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Cpu,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Globe,
  Info,
  Kanban,
  LifeBuoy,
  Lightbulb,
  Link,
  Plug,
  RefreshCw,
  Upload,
  User as UserIcon,
  Wrench,
} from 'lucide-react';
import {
  getConnectionIcon,
  getConnectionDisplayName,
  getConnectionFallbackIcon,
} from '../../config/integrationsConfig';
import { getConnectorById } from '../DataConnectors/connectorRegistry';
import { ConnectorsService } from '../../Services/ConnectorsService';
import { ConnectCredentialsModal } from './ConnectCredentialsModal';
import { getFileIconClass, formatFileSize } from '../../utils/fileUtils';
import { WORKSPACE_MODEL_OPTIONS } from '../../types/workspaceChatTypes';
import type { WorkspaceChatFileInfo, WorkspaceChatModelId } from '../../types/workspaceChatTypes';
import { getFlag } from '../../utils/featureFlags';
import { useShowChatCost } from '../../hooks/useShowChatCost';

type KnowledgeBase = {
  kb_id: string;
  kb_name: string;
  role?: string;
};

type ConnectionOption = {
  id: string;
  name: string;
  isConnected: boolean;
};

export interface WorkspaceChatSettingsPanelProps {
  /** Whether the panel is visible */
  isOpen: boolean;
  /** Whether this is a new chat (no conversation started yet) - hides file sections */
  isNewChat?: boolean;

  // Files
  /** Files in the uploads folder */
  uploadsFiles: WorkspaceChatFileInfo[];
  /** Files in the outputs folder */
  outputFiles: WorkspaceChatFileInfo[];
  /** Whether files are loading */
  filesLoading: boolean;
  /** Error loading files */
  filesError?: string | null;
  /** Refresh file list */
  onRefreshFiles: () => void;
  /** Open a file preview */
  onOpenFile?: (file: WorkspaceChatFileInfo) => void;
  /** Download a file */
  onDownloadFile?: (file: WorkspaceChatFileInfo) => void;

  // Tools
  autoToolsEnabled: boolean;
  setAutoToolsEnabled: Dispatch<SetStateAction<boolean>>;
  webSearchEnabled: boolean;
  setWebSearchEnabled: Dispatch<SetStateAction<boolean>>;
  createAgentEnabled: boolean;
  setCreateAgentEnabled: Dispatch<SetStateAction<boolean>>;
  memoriesEnabled: boolean;
  setMemoriesEnabled: Dispatch<SetStateAction<boolean>>;
  numaOpsEnabled: boolean;
  setNumaOpsEnabled: Dispatch<SetStateAction<boolean>>;
  numaOpsFeatureEnabled: boolean;
  dataConnectorsEnabled: boolean;
  setDataConnectorsEnabled: Dispatch<SetStateAction<boolean>>;
  dataConnectorsFeatureEnabled: boolean;
  agentsFeatureEnabled: boolean;

  // Numa Files folders (legacy var names retained)
  enabledKBIds: string[];
  setEnabledKBIds: Dispatch<SetStateAction<string[]>>;
  availableKBs: KnowledgeBase[];
  isLoadingKBs: boolean;

  // Integrations
  enabledConnections: string[];
  setEnabledConnections: Dispatch<SetStateAction<string[]>>;
  availableConnections: ConnectionOption[];
  connectionsLoading: boolean;
  hasPipedreamFeature: boolean;

  // Data Connectors (OAuth + PAT/token — admin-configured per-workspace,
  // per-user connection state captured here via OAuth redirect or PAT modal).
  /** Every admin-configured data connector for this workspace. */
  adminConfiguredConnectors: Array<{ id: string; name: string }>;
  /** IDs of connectors the CURRENT user has personal credentials for. */
  userConnectedConnectorIds: string[];
  /** Called after a successful connect (OAuth callback or PAT save) so the
   *  parent can re-fetch per-user status. */
  onConnectorConnected: () => void | Promise<void>;

  // Control disabled state (during streaming)
  isDisabled: boolean;

  // Model selector (optional; controlled by config)
  showModelSelector?: boolean;
  selectedModelId?: WorkspaceChatModelId;
  setSelectedModelId?: Dispatch<SetStateAction<WorkspaceChatModelId>>;
}

/**
 * Right-side settings panel for Workspace Chat V2.
 *
 * Consolidates:
 * - Chat Uploads (user uploaded files)
 * - Output Files (Claude-generated files)
 * - Settings (KB, tools, integrations toggles)
 */
export const WorkspaceChatSettingsPanel: React.FC<WorkspaceChatSettingsPanelProps> = ({
  isOpen,
  isNewChat = false,
  uploadsFiles,
  outputFiles,
  filesLoading,
  filesError,
  onRefreshFiles,
  onOpenFile,
  onDownloadFile,
  autoToolsEnabled,
  setAutoToolsEnabled,
  webSearchEnabled,
  setWebSearchEnabled,
  createAgentEnabled,
  setCreateAgentEnabled,
  memoriesEnabled,
  setMemoriesEnabled,
  numaOpsEnabled,
  setNumaOpsEnabled,
  numaOpsFeatureEnabled,
  dataConnectorsEnabled,
  setDataConnectorsEnabled,
  dataConnectorsFeatureEnabled,
  agentsFeatureEnabled,
  enabledKBIds,
  setEnabledKBIds,
  availableKBs,
  isLoadingKBs,
  enabledConnections,
  setEnabledConnections,
  availableConnections,
  connectionsLoading,
  hasPipedreamFeature,
  adminConfiguredConnectors,
  userConnectedConnectorIds,
  onConnectorConnected,
  isDisabled,
  showModelSelector = false,
  selectedModelId,
  setSelectedModelId,
}) => {
  const { t } = useTranslation('chat');

  // Collapsible section state — persisted to localStorage
  const STORAGE_KEY = 'workspace-chat-settings-collapsed';
  const DEFAULTS: Record<string, boolean> = {
    knowledgeBases: true,
    tools: true,
    integrations: true,
    connectors: true,
    model: true,
    developer: true,
    chatUploads: true,
    outputFiles: true,
  };
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...DEFAULTS, ...JSON.parse(saved) };
    } catch {
      /* ignore */
    }
    return DEFAULTS;
  });

  const toggleSection = useCallback((section: string) => {
    setCollapsedSections((prev) => {
      const updated = { ...prev, [section]: !prev[section] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        /* ignore */
      }
      return updated;
    });
  }, []);

  // Connected integrations only
  const connectedIntegrations = availableConnections.filter((conn) => conn.isConnected);

  // Data connectors — per-user connection state + Connect click handling.
  // OAuth connectors route through ConnectorsService.connect (browser redirect
  // back via PKCE callback). PAT/token connectors open an inline modal.
  const connectedConnectorIdSet = useMemo(() => new Set(userConnectedConnectorIds), [userConnectedConnectorIds]);
  const [credentialModal, setCredentialModal] = useState<{ show: boolean; connectorId: string }>({
    show: false,
    connectorId: '',
  });
  const sortedConnectors = useMemo(
    () => [...adminConfiguredConnectors].sort((a, b) => a.name.localeCompare(b.name)),
    [adminConfiguredConnectors]
  );

  const handleConnectorConnectClick = useCallback(async (connectorId: string) => {
    // ConnectorsService.connect returns a discriminated union — TS exhaustiveness
    // ensures every kind is handled. Throws on OAuth authorize failure; wrap
    // in try/catch so the error surfaces in the console rather than an
    // unhandled promise rejection.
    try {
      const action = await ConnectorsService.connect(connectorId);
      switch (action.kind) {
        case 'redirecting':
          // OAuth — browser is navigating to the provider. Nothing to do.
          return;
        case 'needs_credentials':
          setCredentialModal({ show: true, connectorId });
          return;
        case 'unsupported':
          console.warn('Connector connect unsupported:', action.reason);
          return;
      }
    } catch (err) {
      console.error(`Connect failed for "${connectorId}":`, err);
    }
  }, []);

  // Developer-only chat cost toggle. Section only renders when the
  // DEVELOPER_MODE client config flag is on.
  const developerModeEnabled = getFlag('DEVELOPER_MODE');
  const [showChatCost, setShowChatCost] = useShowChatCost();

  // Handlers
  const handleKBToggle = (kbId: string, checked: boolean) => {
    if (checked) {
      setEnabledKBIds((prev) => [...prev, kbId]);
    } else {
      setEnabledKBIds((prev) => prev.filter((id) => id !== kbId));
    }
  };

  const handleIntegrationToggle = (connectionId: string, checked: boolean) => {
    if (checked) {
      setEnabledConnections((prev) => [...prev, connectionId]);
    } else {
      setEnabledConnections((prev) => prev.filter((id) => id !== connectionId));
    }
  };

  const handleAutoToolsToggle = (checked: boolean) => {
    setAutoToolsEnabled(checked);
    if (checked) {
      setWebSearchEnabled(true);
      setMemoriesEnabled(true);
      if (agentsFeatureEnabled) {
        setCreateAgentEnabled(true);
      }
      if (numaOpsFeatureEnabled) {
        setNumaOpsEnabled(true);
      }
      if (dataConnectorsFeatureEnabled) {
        setDataConnectorsEnabled(true);
      }
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="workspace-chat-settings-panel workspace-settings-modern-panel">
      <div className="workspace-chat-settings-panel-body workspace-settings-modern-body">
        <div className="workspace-settings-card">
          <button
            type="button"
            className="workspace-settings-card-header workspace-settings-card-header--collapsible"
            onClick={() => toggleSection('knowledgeBases')}
            aria-expanded={!collapsedSections.knowledgeBases}
          >
            <div className="workspace-settings-card-title">
              <FolderOpen size={16} />
              <span>{t('workspaceSettings.knowledgeBases')}</span>
            </div>
            <div className="workspace-settings-card-header-right">
              {collapsedSections.knowledgeBases && (
                <span className="workspace-settings-collapsed-summary">
                  {enabledKBIds.length > 0
                    ? t('workspaceSettings.kbSelected', { count: enabledKBIds.length })
                    : t('workspaceSettings.noneSelected')}
                </span>
              )}
              {collapsedSections.knowledgeBases ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </div>
          </button>
          {!collapsedSections.knowledgeBases && (
            <div className="workspace-settings-card-body">
              <div className="workspace-settings-helper-text">{t('workspaceSettings.selectKBs')}</div>
              {isLoadingKBs ? (
                <div className="text-muted small d-flex align-items-center gap-2">
                  <Spinner animation="border" size="sm" />
                  {t('workspaceSettings.loading')}
                </div>
              ) : availableKBs.length === 0 ? (
                <div className="text-muted small fst-italic">{t('workspaceSettings.noKBs')}</div>
              ) : (
                <>
                  {availableKBs.length > 1 && (
                    <div className="workspace-settings-kb-actions">
                      <button
                        type="button"
                        className="workspace-settings-kb-action-link"
                        onClick={() => setEnabledKBIds(availableKBs.map((kb) => kb.kb_id))}
                        disabled={isDisabled || availableKBs.every((kb) => enabledKBIds.includes(kb.kb_id))}
                      >
                        {t('workspaceSettings.selectAll')}
                      </button>
                      {enabledKBIds.length > 0 && (
                        <button
                          type="button"
                          className="workspace-settings-kb-action-link"
                          onClick={() => setEnabledKBIds([])}
                          disabled={isDisabled}
                        >
                          {t('workspaceSettings.clear')}
                        </button>
                      )}
                    </div>
                  )}
                  <div className="workspace-settings-list">
                    {availableKBs.map((kb) => (
                      <Form.Check
                        type="checkbox"
                        key={kb.kb_id}
                        id={`panel-kb-${kb.kb_id}`}
                        className="workspace-settings-list-item workspace-settings-kb-list-item"
                        label={
                          <span className="workspace-settings-kb-label">
                            {kb.kb_id === 'company' ? (
                              <Building2 size={14} />
                            ) : kb.kb_id === 'numa-support' ? (
                              <LifeBuoy size={14} />
                            ) : (
                              <UserIcon size={14} />
                            )}
                            <span className="workspace-settings-kb-name">{kb.kb_name}</span>
                          </span>
                        }
                        checked={enabledKBIds.includes(kb.kb_id)}
                        onChange={(e) => handleKBToggle(kb.kb_id, e.target.checked)}
                        disabled={isDisabled}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="workspace-settings-card">
          <button
            type="button"
            className="workspace-settings-card-header workspace-settings-card-header--collapsible"
            onClick={() => toggleSection('tools')}
            aria-expanded={!collapsedSections.tools}
          >
            <div className="workspace-settings-card-title">
              <Wrench size={16} />
              <span>{t('workspaceSettings.tools')}</span>
            </div>
            <div className="workspace-settings-card-header-right">
              {collapsedSections.tools && (
                <span className="workspace-settings-collapsed-summary">
                  {autoToolsEnabled
                    ? t('workspaceSettings.allToolsEnabledSummary')
                    : [
                          webSearchEnabled,
                          createAgentEnabled,
                          memoriesEnabled,
                          numaOpsEnabled,
                          dataConnectorsEnabled,
                        ].filter(Boolean).length > 0
                      ? t('workspaceSettings.toolsPartialSummary', {
                          count: [
                            webSearchEnabled,
                            createAgentEnabled,
                            memoriesEnabled,
                            numaOpsEnabled,
                            dataConnectorsEnabled,
                          ].filter(Boolean).length,
                        })
                      : t('workspaceSettings.noneEnabled')}
                </span>
              )}
              {collapsedSections.tools ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </div>
          </button>
          {!collapsedSections.tools && (
            <div className="workspace-settings-card-body">
              <div className="workspace-settings-tools-master" style={{ marginBottom: '0.5rem' }}>
                <span className="workspace-settings-tools-master-label">{t('workspaceSettings.all')}</span>
                <Form.Check
                  type="switch"
                  id="panel-auto-tools"
                  className="workspace-settings-master-switch"
                  label=""
                  checked={autoToolsEnabled}
                  onChange={(e) => handleAutoToolsToggle(e.target.checked)}
                  disabled={isDisabled}
                />
              </div>
              <div className="workspace-settings-list workspace-settings-tools-list">
                <Form.Check
                  type="checkbox"
                  id="panel-web-search"
                  className="workspace-settings-list-item"
                  checked={webSearchEnabled}
                  onChange={(e) => setWebSearchEnabled(e.target.checked)}
                  disabled={isDisabled || autoToolsEnabled}
                  label={
                    <span className={`d-flex align-items-center gap-2 ${autoToolsEnabled ? 'text-muted' : ''}`}>
                      <Globe size={14} />
                      {t('workspaceSettings.webSearch')}
                    </span>
                  }
                />

                {agentsFeatureEnabled && (
                  <Form.Check
                    type="checkbox"
                    id="panel-create-agent"
                    className="workspace-settings-list-item"
                    checked={createAgentEnabled}
                    onChange={(e) => setCreateAgentEnabled(e.target.checked)}
                    disabled={isDisabled || autoToolsEnabled}
                    label={
                      <span className={`d-flex align-items-center gap-2 ${autoToolsEnabled ? 'text-muted' : ''}`}>
                        <Bot size={14} />
                        {t('workspaceSettings.agentCreation')}
                      </span>
                    }
                  />
                )}

                <Form.Check
                  type="checkbox"
                  id="panel-memories"
                  className="workspace-settings-list-item"
                  checked={memoriesEnabled}
                  onChange={(e) => setMemoriesEnabled(e.target.checked)}
                  disabled={isDisabled || autoToolsEnabled}
                  label={
                    <span className={`d-flex align-items-center gap-2 ${autoToolsEnabled ? 'text-muted' : ''}`}>
                      <Lightbulb size={14} />
                      {t('workspaceSettings.memoryManagement')}
                    </span>
                  }
                />

                {numaOpsFeatureEnabled && (
                  <Form.Check
                    type="checkbox"
                    id="panel-numa-ops"
                    className="workspace-settings-list-item"
                    checked={numaOpsEnabled}
                    onChange={(e) => setNumaOpsEnabled(e.target.checked)}
                    disabled={isDisabled || autoToolsEnabled}
                    label={
                      <span className={`d-flex align-items-center gap-2 ${autoToolsEnabled ? 'text-muted' : ''}`}>
                        <Kanban size={14} />
                        {t('workspaceSettings.numaOps')}
                      </span>
                    }
                  />
                )}

                {dataConnectorsFeatureEnabled && (
                  <Form.Check
                    type="checkbox"
                    id="panel-data-connectors"
                    className="workspace-settings-list-item"
                    checked={dataConnectorsEnabled}
                    onChange={(e) => setDataConnectorsEnabled(e.target.checked)}
                    disabled={isDisabled || autoToolsEnabled}
                    label={
                      <span className={`d-flex align-items-center gap-2 ${autoToolsEnabled ? 'text-muted' : ''}`}>
                        <Link size={14} />
                        {t('workspaceSettings.dataConnectors')}
                      </span>
                    }
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Integrations */}
        {hasPipedreamFeature && (
          <div className="workspace-settings-card workspace-settings-integrations-card">
            <button
              type="button"
              className="workspace-settings-card-header workspace-settings-card-header--collapsible"
              onClick={() => toggleSection('integrations')}
              aria-expanded={!collapsedSections.integrations}
            >
              <div className="workspace-settings-card-title">
                <Plug size={16} />
                <span>{t('workspaceSettings.integrations')}</span>
              </div>
              <div className="workspace-settings-card-header-right">
                {collapsedSections.integrations && (
                  <span className="workspace-settings-collapsed-summary workspace-settings-collapsed-integrations">
                    {enabledConnections.length > 0 ? (
                      <>
                        {enabledConnections.slice(0, 3).map((id) => {
                          const iconSrc = getConnectionIcon(id);
                          const displayName = getConnectionDisplayName(id);
                          return iconSrc ? (
                            <img
                              key={id}
                              src={iconSrc}
                              alt={displayName}
                              className="workspace-settings-collapsed-icon"
                            />
                          ) : null;
                        })}
                        {enabledConnections.length > 3 && (
                          <span className="workspace-settings-collapsed-more">+{enabledConnections.length - 3}</span>
                        )}
                      </>
                    ) : (
                      t('workspaceSettings.noneEnabled')
                    )}
                  </span>
                )}
                {collapsedSections.integrations ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </div>
            </button>
            {!collapsedSections.integrations && (
              <div className="workspace-settings-card-body">
                {connectionsLoading ? (
                  <div className="text-muted small d-flex align-items-center gap-2">
                    <Spinner animation="border" size="sm" />
                    {t('workspaceSettings.loading')}
                  </div>
                ) : connectedIntegrations.length === 0 ? (
                  <div className="text-muted small fst-italic">
                    <Info size={12} className="me-1" />
                    {t('workspaceSettings.noIntegrations')}
                  </div>
                ) : (
                  <div className="workspace-settings-list workspace-settings-integrations-list">
                    {connectedIntegrations
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((conn) => {
                        const iconSrc = getConnectionIcon(conn.id);
                        const fallbackIcon = getConnectionFallbackIcon(conn.id);
                        const displayName = getConnectionDisplayName(conn.id);
                        const isEnabled = enabledConnections.includes(conn.id);

                        return (
                          <div key={conn.id} className="workspace-settings-integration-item">
                            <div className="workspace-settings-integration-main">
                              <span className="workspace-settings-integration-label">
                                {iconSrc ? (
                                  <img
                                    src={iconSrc}
                                    alt={displayName}
                                    style={{ width: 18, height: 18, objectFit: 'contain' }}
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                    }}
                                  />
                                ) : (
                                  <i className={fallbackIcon} />
                                )}
                                {displayName}
                              </span>
                            </div>
                            <button
                              type="button"
                              className={`workspace-settings-integration-state ${isEnabled ? 'is-connected' : 'is-connect'}`}
                              onClick={() => handleIntegrationToggle(conn.id, !isEnabled)}
                              disabled={isDisabled}
                            >
                              {isEnabled ? (
                                <>
                                  <Check size={12} />
                                  {t('workspaceSettings.connected')}
                                </>
                              ) : (
                                t('workspaceSettings.connect')
                              )}
                            </button>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Data Connectors — admin-configured, per-user Connect action.
            Parallel to Integrations but backed by the data-connectors stack
            (OAuth redirect flow or PAT modal). Always rendered if ANY admin
            connectors are configured; per-user connection state is displayed
            per row. */}
        {adminConfiguredConnectors.length > 0 && (
          <div className="workspace-settings-card workspace-settings-integrations-card">
            <button
              type="button"
              className="workspace-settings-card-header workspace-settings-card-header--collapsible"
              onClick={() => toggleSection('connectors')}
              aria-expanded={!collapsedSections.connectors}
            >
              <div className="workspace-settings-card-title">
                <Link size={16} />
                <span>{t('workspaceSettings.connectors', { defaultValue: 'Connectors' })}</span>
              </div>
              <div className="workspace-settings-card-header-right">
                {collapsedSections.connectors && (
                  <span className="workspace-settings-collapsed-summary">
                    {userConnectedConnectorIds.length > 0
                      ? t('workspaceSettings.connectorsConnectedCount', {
                          count: userConnectedConnectorIds.length,
                          total: adminConfiguredConnectors.length,
                          defaultValue: `${userConnectedConnectorIds.length}/${adminConfiguredConnectors.length} connected`,
                        })
                      : t('workspaceSettings.noneConnected', { defaultValue: 'None connected' })}
                  </span>
                )}
                {collapsedSections.connectors ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </div>
            </button>
            {!collapsedSections.connectors && (
              <div className="workspace-settings-card-body">
                <div className="workspace-settings-list workspace-settings-integrations-list">
                  {sortedConnectors.map((conn) => {
                    const tmpl = getConnectorById(conn.id);
                    const iconClass = tmpl?.icon ?? 'bi-plug';
                    const isConnected = connectedConnectorIdSet.has(conn.id);
                    return (
                      <div key={conn.id} className="workspace-settings-integration-item">
                        <div className="workspace-settings-integration-main">
                          <span className="workspace-settings-integration-label">
                            <i className={iconClass} style={{ fontSize: 16 }} />
                            {conn.name}
                          </span>
                        </div>
                        <button
                          type="button"
                          className={`workspace-settings-integration-state ${isConnected ? 'is-connected' : 'is-connect'}`}
                          onClick={() => handleConnectorConnectClick(conn.id)}
                          disabled={isDisabled || isConnected}
                          title={
                            isConnected
                              ? t('workspaceSettings.connectorAlreadyConnected', {
                                  defaultValue: 'Already connected',
                                })
                              : undefined
                          }
                        >
                          {isConnected ? (
                            <>
                              <Check size={12} />
                              {t('workspaceSettings.connected')}
                            </>
                          ) : (
                            t('workspaceSettings.connect')
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {showModelSelector && selectedModelId && setSelectedModelId && (
          <div className="workspace-settings-card workspace-settings-model-card">
            <button
              type="button"
              className="workspace-settings-card-header workspace-settings-card-header--collapsible"
              onClick={() => toggleSection('model')}
              aria-expanded={!collapsedSections.model}
            >
              <div className="workspace-settings-card-title">
                <Cpu size={16} />
                <span>{t('workspaceSettings.model')}</span>
              </div>
              <div className="workspace-settings-card-header-right">
                {collapsedSections.model && (
                  <span className="workspace-settings-collapsed-summary">
                    {WORKSPACE_MODEL_OPTIONS.find((m) => m.id === selectedModelId)?.label ?? selectedModelId}
                  </span>
                )}
                {collapsedSections.model ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </div>
            </button>
            {!collapsedSections.model && (
              <div className="workspace-settings-card-body">
                <div className="workspace-settings-list workspace-settings-model-list">
                  {WORKSPACE_MODEL_OPTIONS.map((model) => {
                    const isActive = selectedModelId === model.id;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        className={`workspace-settings-model-item ${isActive ? 'is-active' : ''}`}
                        onClick={() => setSelectedModelId(model.id)}
                        disabled={isDisabled}
                        aria-pressed={isActive}
                      >
                        <span className="workspace-settings-model-main">
                          <span className="workspace-settings-model-name">{model.label}</span>
                          <span className="workspace-settings-model-description">{model.description}</span>
                        </span>
                        {isActive && <Check size={14} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Developer card — only with DEVELOPER_MODE client flag */}
        {developerModeEnabled && (
          <div className="workspace-settings-card">
            <button
              type="button"
              className="workspace-settings-card-header workspace-settings-card-header--collapsible"
              onClick={() => toggleSection('developer')}
              aria-expanded={!collapsedSections.developer}
            >
              <div className="workspace-settings-card-title">
                <Code2 size={16} />
                <span>{t('workspaceSettings.developer')}</span>
              </div>
              <div className="workspace-settings-card-header-right">
                {collapsedSections.developer && (
                  <span className="workspace-settings-collapsed-summary">
                    {showChatCost ? t('workspaceSettings.showCostOn') : t('workspaceSettings.showCostOff')}
                  </span>
                )}
                {collapsedSections.developer ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </div>
            </button>
            {!collapsedSections.developer && (
              <div className="workspace-settings-card-body">
                <Form.Check
                  type="switch"
                  id="workspace-settings-show-chat-cost"
                  checked={showChatCost}
                  onChange={(e) => setShowChatCost(e.target.checked)}
                  label={
                    <span>
                      <span className="d-block">{t('workspaceSettings.showChatCost')}</span>
                      <span className="text-muted small">{t('workspaceSettings.showChatCostDescription')}</span>
                    </span>
                  }
                />
              </div>
            )}
          </div>
        )}

        {/* Chat files - shown below integrations */}
        {!isNewChat && (
          <div className="workspace-settings-card">
            <button
              type="button"
              className="workspace-settings-card-header workspace-settings-card-header--collapsible"
              onClick={() => toggleSection('chatUploads')}
              aria-expanded={!collapsedSections.chatUploads}
            >
              <div className="workspace-settings-card-title">
                <Upload size={16} />
                <span>{t('workspaceSettings.chatUploads')}</span>
                {uploadsFiles.length > 0 && (
                  <span className="workspace-settings-count-badge">{uploadsFiles.length}</span>
                )}
              </div>
              <div className="workspace-settings-card-header-right">
                {collapsedSections.chatUploads && (
                  <span className="workspace-settings-collapsed-summary">
                    {uploadsFiles.length > 0 ? `${uploadsFiles.length}` : t('workspaceSettings.noneSelected')}
                  </span>
                )}
                <span
                  role="button"
                  tabIndex={0}
                  className="workspace-settings-icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefreshFiles();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      onRefreshFiles();
                    }
                  }}
                  title={t('workspaceSettings.refreshFiles')}
                >
                  <RefreshCw size={14} className={filesLoading ? 'spinning' : ''} />
                </span>
                {collapsedSections.chatUploads ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </div>
            </button>
            {!collapsedSections.chatUploads && (
              <div className="workspace-settings-card-body">
                {filesLoading ? (
                  <div className="text-muted small d-flex align-items-center gap-2 py-2">
                    <Spinner animation="border" size="sm" />
                    {t('workspaceSettings.loadingFiles')}
                  </div>
                ) : filesError ? (
                  <div className="text-danger small py-2">
                    <AlertTriangle size={14} className="me-1" />
                    {filesError}
                    <Button variant="link" size="sm" onClick={onRefreshFiles} className="ms-2 p-0">
                      {t('workspaceSettings.retry')}
                    </Button>
                  </div>
                ) : uploadsFiles.length === 0 ? (
                  <div className="text-muted small fst-italic py-2">{t('workspaceSettings.noUploads')}</div>
                ) : (
                  <WorkspaceSettingsFileList
                    files={uploadsFiles}
                    rootPrefix="uploads/"
                    onOpen={onOpenFile}
                    onDownload={onDownloadFile}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {!isNewChat && (
          <div className="workspace-settings-card">
            <button
              type="button"
              className="workspace-settings-card-header workspace-settings-card-header--collapsible"
              onClick={() => toggleSection('outputFiles')}
              aria-expanded={!collapsedSections.outputFiles}
            >
              <div className="workspace-settings-card-title">
                <FileText size={16} />
                <span>{t('workspaceSettings.outputFiles')}</span>
                {outputFiles.length > 0 && <span className="workspace-settings-count-badge">{outputFiles.length}</span>}
              </div>
              <div className="workspace-settings-card-header-right">
                {collapsedSections.outputFiles && (
                  <span className="workspace-settings-collapsed-summary">
                    {outputFiles.length > 0 ? `${outputFiles.length}` : t('workspaceSettings.noneSelected')}
                  </span>
                )}
                <span
                  role="button"
                  tabIndex={0}
                  className="workspace-settings-icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefreshFiles();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      onRefreshFiles();
                    }
                  }}
                  title={t('workspaceSettings.refreshFiles')}
                >
                  <RefreshCw size={14} className={filesLoading ? 'spinning' : ''} />
                </span>
                {collapsedSections.outputFiles ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </div>
            </button>
            {!collapsedSections.outputFiles && (
              <div className="workspace-settings-card-body">
                {filesLoading ? (
                  <div className="text-muted small d-flex align-items-center gap-2 py-2">
                    <Spinner animation="border" size="sm" />
                    {t('workspaceSettings.loadingFiles')}
                  </div>
                ) : filesError ? (
                  <div className="text-danger small py-2">
                    <AlertTriangle size={14} className="me-1" />
                    {filesError}
                  </div>
                ) : outputFiles.length === 0 ? (
                  <div className="text-muted small fst-italic py-2">{t('workspaceSettings.noOutputFiles')}</div>
                ) : (
                  <WorkspaceSettingsFileList
                    files={outputFiles}
                    rootPrefix="outputs/"
                    onOpen={onOpenFile}
                    onDownload={onDownloadFile}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <ConnectCredentialsModal
        show={credentialModal.show}
        onHide={() => setCredentialModal({ show: false, connectorId: '' })}
        connectorId={credentialModal.connectorId}
        onConnected={onConnectorConnected}
      />
    </div>
  );
};

const formatFileModifiedDate = (modifiedAt: string): string => {
  const parsed = new Date(modifiedAt);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

interface WorkspaceSettingsFileListProps {
  files: WorkspaceChatFileInfo[];
  rootPrefix: string;
  onOpen?: (file: WorkspaceChatFileInfo) => void;
  onDownload?: (file: WorkspaceChatFileInfo) => void;
}

const WorkspaceSettingsFileList: React.FC<WorkspaceSettingsFileListProps> = ({
  files,
  rootPrefix,
  onOpen,
  onDownload,
}) => {
  const { t } = useTranslation('chat');

  const sortedFiles = useMemo(() => {
    return files
      .filter((file) => !file.isDirectory)
      .map((file) => {
        const relativePath = file.path.startsWith(rootPrefix) ? file.path.slice(rootPrefix.length) : file.path;
        const fallbackName = relativePath.split('/').filter(Boolean).pop() || relativePath;
        return {
          ...file,
          displayName: file.name || fallbackName,
          relativePath,
        };
      })
      .sort((a, b) => {
        const timestampDiff = new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
        if (!Number.isNaN(timestampDiff) && timestampDiff !== 0) {
          return timestampDiff;
        }
        return a.displayName.localeCompare(b.displayName);
      });
  }, [files, rootPrefix]);

  if (sortedFiles.length === 0) {
    return null;
  }

  return (
    <div className="workspace-settings-file-list">
      {sortedFiles.map((file) => {
        const iconClass = getFileIconClass(file.displayName);
        const modifiedLabel = formatFileModifiedDate(file.modifiedAt);

        return (
          <div key={file.path} className="workspace-settings-file-row">
            <i className={`${iconClass} workspace-settings-file-icon`} />
            <div className="workspace-settings-file-main" title={file.relativePath}>
              <div className="workspace-settings-file-top-row">
                <span className="workspace-settings-file-name">{file.displayName}</span>
                <div className="workspace-settings-file-actions">
                  {onOpen && (
                    <Button
                      variant="link"
                      size="sm"
                      className="workspace-settings-file-action-btn"
                      onClick={() => onOpen(file)}
                      title={t('workspaceSettings.preview')}
                    >
                      <Eye size={14} />
                    </Button>
                  )}
                  {onDownload && (
                    <Button
                      variant="link"
                      size="sm"
                      className="workspace-settings-file-action-btn"
                      onClick={() => onDownload(file)}
                      title={t('workspaceSettings.download')}
                    >
                      <Download size={14} />
                    </Button>
                  )}
                </div>
              </div>
              <span className="workspace-settings-file-meta">
                <span className="workspace-settings-file-size">{formatFileSize(file.size)}</span>
                {modifiedLabel && <span className="workspace-settings-file-modified">{modifiedLabel}</span>}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default WorkspaceChatSettingsPanel;
