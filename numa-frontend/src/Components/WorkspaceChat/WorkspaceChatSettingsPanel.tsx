import React, { useMemo, Dispatch, SetStateAction } from 'react';
import { Button, Form, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Building2,
  Bot,
  Check,
  Cpu,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Globe,
  Info,
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
import { getFileIconClass, formatFileSize } from '../../utils/fileUtils';
import { WORKSPACE_MODEL_OPTIONS } from '../../types/workspaceChatTypes';
import type { WorkspaceChatFileInfo, WorkspaceChatModelId } from '../../types/workspaceChatTypes';

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
  /** Files in the session folder */
  sessionFiles: WorkspaceChatFileInfo[];
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
  agentsFeatureEnabled: boolean;

  // Knowledge Bases
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
 * - Session Files (Claude-generated files)
 * - Settings (KB, tools, integrations toggles)
 */
export const WorkspaceChatSettingsPanel: React.FC<WorkspaceChatSettingsPanelProps> = ({
  isOpen,
  isNewChat = false,
  uploadsFiles,
  sessionFiles,
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
  isDisabled,
  showModelSelector = false,
  selectedModelId,
  setSelectedModelId,
}) => {
  const { t } = useTranslation('chat');

  // Connected integrations only
  const connectedIntegrations = availableConnections.filter((conn) => conn.isConnected);

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
      if (agentsFeatureEnabled) {
        setCreateAgentEnabled(true);
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
          <div className="workspace-settings-card-header">
            <div className="workspace-settings-card-title">
              <FolderOpen size={16} />
              <span>{t('workspaceSettings.knowledgeBases')}</span>
            </div>
          </div>
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
              <div className="workspace-settings-list">
                {availableKBs.map((kb) => (
                  <Form.Check
                    type="checkbox"
                    key={kb.kb_id}
                    id={`panel-kb-${kb.kb_id}`}
                    className="workspace-settings-list-item workspace-settings-kb-list-item"
                    label={
                      <span className="workspace-settings-kb-label">
                        {kb.kb_id === 'company' ? <Building2 size={14} /> : <UserIcon size={14} />}
                        <span className="workspace-settings-kb-name">{kb.kb_name}</span>
                      </span>
                    }
                    checked={enabledKBIds.includes(kb.kb_id)}
                    onChange={(e) => handleKBToggle(kb.kb_id, e.target.checked)}
                    disabled={isDisabled}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="workspace-settings-card">
          <div className="workspace-settings-card-header">
            <div className="workspace-settings-card-title">
              <Wrench size={16} />
              <span>{t('workspaceSettings.tools')}</span>
            </div>
            <div className="workspace-settings-tools-master">
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
          </div>
          <div className="workspace-settings-card-body">
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
            </div>
          </div>
        </div>

        {/* Integrations */}
        {hasPipedreamFeature && (
          <div className="workspace-settings-card workspace-settings-integrations-card">
            <div className="workspace-settings-card-header">
              <div className="workspace-settings-card-title">
                <Plug size={16} />
                <span>{t('workspaceSettings.integrations')}</span>
              </div>
            </div>
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
          </div>
        )}

        {showModelSelector && selectedModelId && setSelectedModelId && (
          <div className="workspace-settings-card workspace-settings-model-card">
            <div className="workspace-settings-card-header">
              <div className="workspace-settings-card-title">
                <Cpu size={16} />
                <span>{t('workspaceSettings.model')}</span>
              </div>
            </div>
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
          </div>
        )}

        {/* Chat files - shown below integrations */}
        {!isNewChat && (
          <div className="workspace-settings-card">
            <div className="workspace-settings-card-header">
              <div className="workspace-settings-card-title">
                <Upload size={16} />
                <span>{t('workspaceSettings.chatUploads')}</span>
                {uploadsFiles.length > 0 && (
                  <span className="workspace-settings-count-badge">{uploadsFiles.length}</span>
                )}
              </div>
              <div className="workspace-settings-card-actions">
                <Button
                  variant="link"
                  size="sm"
                  className="workspace-settings-icon-btn"
                  onClick={onRefreshFiles}
                  disabled={filesLoading}
                  title={t('workspaceSettings.refreshFiles')}
                >
                  <RefreshCw size={14} className={filesLoading ? 'spinning' : ''} />
                </Button>
              </div>
            </div>
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
          </div>
        )}

        {!isNewChat && (
          <div className="workspace-settings-card">
            <div className="workspace-settings-card-header">
              <div className="workspace-settings-card-title">
                <FileText size={16} />
                <span>{t('workspaceSettings.sessionFiles')}</span>
                {sessionFiles.length > 0 && (
                  <span className="workspace-settings-count-badge">{sessionFiles.length}</span>
                )}
              </div>
              <div className="workspace-settings-card-actions">
                <Button
                  variant="link"
                  size="sm"
                  className="workspace-settings-icon-btn"
                  onClick={onRefreshFiles}
                  disabled={filesLoading}
                  title={t('workspaceSettings.refreshFiles')}
                >
                  <RefreshCw size={14} className={filesLoading ? 'spinning' : ''} />
                </Button>
              </div>
            </div>
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
              ) : sessionFiles.length === 0 ? (
                <div className="text-muted small fst-italic py-2">{t('workspaceSettings.noSessionFiles')}</div>
              ) : (
                <WorkspaceSettingsFileList
                  files={sessionFiles}
                  rootPrefix="session/"
                  onOpen={onOpenFile}
                  onDownload={onDownloadFile}
                />
              )}
            </div>
          </div>
        )}
      </div>
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
            <div className="workspace-settings-file-main" title={file.relativePath}>
              <i className={`${iconClass} workspace-settings-file-icon`} />
              <span className="workspace-settings-file-name">{file.displayName}</span>
              <span className="workspace-settings-file-meta">
                <span className="workspace-settings-file-size">{formatFileSize(file.size)}</span>
                {modifiedLabel && <span className="workspace-settings-file-modified">{modifiedLabel}</span>}
              </span>
            </div>
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
        );
      })}
    </div>
  );
};

export default WorkspaceChatSettingsPanel;
