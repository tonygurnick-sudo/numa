import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button, Form, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import {
  getConnectionIcon,
  getConnectionDisplayName,
  getConnectionFallbackIcon,
} from '../../../config/integrationsConfig';
import * as v2AppsService from '../../../Services/v2AppsService';
import type { UseV2AppWorkspaceSettingsReturn } from '../../../hooks/useV2AppWorkspaceSettings';
import { IntegrationAccountSubmenu } from '../../Integrations/IntegrationAccountSubmenu';

type KnowledgeBase = {
  kb_id: string;
  kb_name: string;
};

type ConnectionOption = {
  id: string;
  name: string;
  isConnected: boolean;
  // FEAT-019: optional multi-account metadata.
  allowMultipleAccounts?: boolean;
  accounts?: Array<{ account_id: string; name?: string | null; healthy?: boolean | null; dead?: boolean | null }>;
};

interface DataFile {
  key: string;
  name: string;
  size: number;
  lastModified: Date;
}

type NumaGet = (url: string, params?: Record<string, unknown>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown) => Promise<unknown>;
type NumaDelete = (url: string) => Promise<unknown>;

interface WorkspaceTabProps {
  appId: string;
  numaGet: NumaGet;
  numaPost: NumaPost;
  numaDelete: NumaDelete;
  getUserSub: () => string | undefined;
  workspaceSettings: UseV2AppWorkspaceSettingsReturn;
  availableKBs: KnowledgeBase[];
  isLoadingKBs: boolean;
  availableConnections: ConnectionOption[];
  connectionsLoading: boolean;
  hasPipedreamFeature: boolean;
}

const AVAILABLE_TOOLS = [{ id: 'web_search', labelKey: 'v2Apps.workspace.tools.webSearch' }];

type SectionId = 'company-files' | 'my-files' | 'settings' | 'context';

// Collapsible section wrapper (reused in Settings panel)
const WorkspaceSection: React.FC<{
  title: string;
  icon?: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, summary, defaultOpen = false, children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="v2-workspace-section">
      <button className="v2-workspace-section__header" onClick={() => setIsOpen(!isOpen)} type="button">
        <i className={`bi ${isOpen ? 'bi-chevron-down' : 'bi-chevron-right'}`} />
        {icon && (
          <span className="v2-workspace-section__icon">
            <i className={icon} />
          </span>
        )}
        <span className="v2-workspace-section__title">{title}</span>
        {!isOpen && summary && <span className="v2-workspace-section__summary">{summary}</span>}
      </button>
      {isOpen && <div className="v2-workspace-section__body">{children}</div>}
    </div>
  );
};

// File list sub-component
const WorkspaceFileList: React.FC<{
  prefix: string;
  numaGet: NumaGet;
  numaPost: NumaPost;
  numaDelete: NumaDelete;
}> = ({ prefix, numaGet, numaPost, numaDelete }) => {
  const { t } = useTranslation('apps');
  const [files, setFiles] = useState<DataFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      const response = await v2AppsService.listFiles(numaGet, prefix);
      const dataFiles: DataFile[] = response.files.map((f) => ({
        key: f.key,
        name: f.name,
        size: f.size,
        lastModified: new Date(f.lastModified),
      }));
      setFiles(dataFiles);
    } catch (err) {
      console.error('[WorkspaceFileList] Failed to load files:', err);
    } finally {
      setLoading(false);
    }
  }, [prefix, numaGet]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleUpload = useCallback(
    async (fileList: FileList) => {
      setUploading(true);
      try {
        for (const file of Array.from(fileList)) {
          const key = `${prefix}${file.name}`;
          const contentType = file.type || 'application/octet-stream';
          const { url } = await v2AppsService.getUploadUrl(numaPost, key, contentType);
          const { default: axios } = await import('axios');
          await axios.put(url, file, { headers: { 'Content-Type': contentType } });
        }
        await loadFiles();
      } catch (err) {
        console.error('[WorkspaceFileList] Upload failed:', err);
      } finally {
        setUploading(false);
      }
    },
    [prefix, numaPost, loadFiles]
  );

  const handleDelete = useCallback(
    async (key: string) => {
      try {
        await v2AppsService.deleteFile(numaDelete, key);
        setFiles((prev) => prev.filter((f) => f.key !== key));
      } catch (err) {
        console.error('[WorkspaceFileList] Delete failed:', err);
      }
    },
    [numaDelete]
  );

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div className="text-center py-3">
        <Spinner animation="border" size="sm" />
      </div>
    );
  }

  return (
    <div>
      {/* Upload zone */}
      <div className="v2-workspace-tab__upload-zone" onClick={() => fileInputRef.current?.click()}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="d-none"
          onChange={(e) => e.target.files && handleUpload(e.target.files)}
        />
        {uploading ? (
          <Spinner animation="border" size="sm" />
        ) : (
          <>
            <i className="bi bi-cloud-upload fs-5 text-muted" />
            <p className="mb-0 mt-1 text-muted small">{t('v2Apps.workspace.files.upload')}</p>
          </>
        )}
      </div>

      {/* File list */}
      {files.length === 0 ? (
        <div className="text-center py-3 text-muted">
          <i className="bi bi-folder d-block fs-4 mb-1" />
          <p className="small mb-0">{t('v2Apps.workspace.files.empty')}</p>
        </div>
      ) : (
        <div className="v2-data-tab__list">
          {files.map((file) => (
            <div key={file.key} className="v2-data-tab__item">
              <i className="bi bi-file-earmark" />
              <div className="v2-data-tab__item-info">
                <div className="v2-data-tab__item-name">{file.name}</div>
                <div className="v2-data-tab__item-meta">{formatSize(file.size)}</div>
              </div>
              <Button
                variant="link"
                size="sm"
                className="text-danger p-0"
                onClick={() => handleDelete(file.key)}
                title={t('v2Apps.workspace.files.deleteConfirm')}
              >
                <i className="bi bi-trash" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const WorkspaceTab: React.FC<WorkspaceTabProps> = ({
  appId,
  numaGet,
  numaPost,
  numaDelete,
  getUserSub,
  workspaceSettings,
  availableKBs,
  isLoadingKBs,
  availableConnections,
  connectionsLoading,
  hasPipedreamFeature,
}) => {
  const { t } = useTranslation('apps');
  const [selectedSection, setSelectedSection] = useState<SectionId>('company-files');
  const {
    settings,
    setEnabledKBIds,
    setEnabledTools,
    setEnabledConnections,
    setWorkspaceAccess,
    setContextInstructions,
    setSelectedAccountsByApp,
  } = workspaceSettings;

  const companyPrefix = `v2-apps/${appId}/data/`;
  const userSub = getUserSub();
  const userPrefix = userSub ? `v2-apps/${appId}/user/${userSub}/data/` : null;

  // Summaries for sidebar items
  const kbSummary =
    settings.enabledKBIds.length > 0
      ? t('v2Apps.workspace.knowledgeBases.selected', { count: settings.enabledKBIds.length })
      : t('v2Apps.workspace.knowledgeBases.noneSelected');

  const toolSummary = `${settings.enabledTools.length} / ${AVAILABLE_TOOLS.length}`;

  const settingsSummary = [kbSummary, `${t('v2Apps.workspace.tools.title')}: ${toolSummary}`].join(' · ');

  const contextSummary = settings.contextInstructions
    ? settings.contextInstructions.slice(0, 40) + (settings.contextInstructions.length > 40 ? '...' : '')
    : t('v2Apps.workspace.context.placeholder').split(' ').slice(0, 3).join(' ') + '...';

  const integrationSummary =
    settings.enabledConnections.length > 0
      ? t('v2Apps.workspace.integrations.enabled', { count: settings.enabledConnections.length })
      : t('v2Apps.workspace.integrations.noneEnabled');

  const toggleKB = useCallback(
    (kbId: string) => {
      const newIds = settings.enabledKBIds.includes(kbId)
        ? settings.enabledKBIds.filter((id) => id !== kbId)
        : [...settings.enabledKBIds, kbId];
      setEnabledKBIds(newIds);
    },
    [settings.enabledKBIds, setEnabledKBIds]
  );

  const toggleTool = useCallback(
    (toolId: string) => {
      const newTools = settings.enabledTools.includes(toolId)
        ? settings.enabledTools.filter((id) => id !== toolId)
        : [...settings.enabledTools, toolId];
      setEnabledTools(newTools);
    },
    [settings.enabledTools, setEnabledTools]
  );

  const toggleConnection = useCallback(
    (connId: string) => {
      const newConns = settings.enabledConnections.includes(connId)
        ? settings.enabledConnections.filter((id) => id !== connId)
        : [...settings.enabledConnections, connId];
      setEnabledConnections(newConns);
    },
    [settings.enabledConnections, setEnabledConnections]
  );

  const sidebarItems: { id: SectionId; icon: string; titleKey: string; summary: string }[] = [
    {
      id: 'company-files',
      icon: 'bi-building',
      titleKey: 'v2Apps.workspace.files.company',
      summary: t('v2Apps.workspace.files.companyDescription'),
    },
    {
      id: 'my-files',
      icon: 'bi-person',
      titleKey: 'v2Apps.workspace.files.user',
      summary: t('v2Apps.workspace.files.userDescription'),
    },
    { id: 'settings', icon: 'bi-gear', titleKey: 'v2Apps.workspace.settingsTitle', summary: settingsSummary },
    {
      id: 'context',
      icon: 'bi-chat-square-text',
      titleKey: 'v2Apps.workspace.context.title',
      summary: contextSummary,
    },
  ];

  return (
    <div className="v2-workspace-tab">
      <p className="v2-workspace-tab__description">{t('v2Apps.workspace.description')}</p>

      <div className="v2-workspace-tab__layout">
        {/* ─── Left Sidebar ─────────────────────────────────────────── */}
        <div className="v2-workspace-tab__sidebar">
          <div className="v2-workspace-tab__sidebar-header">
            <span className="v2-workspace-tab__sidebar-title">{t('v2Apps.tabs.workspace')}</span>
          </div>
          <div className="v2-workspace-tab__sidebar-list">
            {sidebarItems.map((item) => (
              <div
                key={item.id}
                className={`v2-workspace-tab__sidebar-item${selectedSection === item.id ? ' v2-workspace-tab__sidebar-item--active' : ''}`}
                onClick={() => setSelectedSection(item.id)}
              >
                <div className="v2-workspace-tab__sidebar-item-icon">
                  <i className={`bi ${item.icon}`} />
                </div>
                <div className="v2-workspace-tab__sidebar-item-content">
                  <div className="v2-workspace-tab__sidebar-item-title">{t(item.titleKey)}</div>
                  {item.summary && <div className="v2-workspace-tab__sidebar-item-summary">{item.summary}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Right Panel ──────────────────────────────────────────── */}
        <div className="v2-workspace-tab__panel">
          {/* Company Files Panel */}
          {selectedSection === 'company-files' && (
            <>
              <div className="v2-workspace-tab__panel-header">
                <span className="v2-workspace-tab__panel-title">{t('v2Apps.workspace.files.company')}</span>
              </div>
              <div className="v2-workspace-tab__panel-content">
                <p className="text-muted small mb-3">{t('v2Apps.workspace.files.companyDescription')}</p>
                <WorkspaceFileList
                  prefix={companyPrefix}
                  numaGet={numaGet}
                  numaPost={numaPost}
                  numaDelete={numaDelete}
                />
              </div>
            </>
          )}

          {/* My Files Panel */}
          {selectedSection === 'my-files' && (
            <>
              <div className="v2-workspace-tab__panel-header">
                <span className="v2-workspace-tab__panel-title">{t('v2Apps.workspace.files.user')}</span>
              </div>
              <div className="v2-workspace-tab__panel-content">
                <p className="text-muted small mb-3">{t('v2Apps.workspace.files.userDescription')}</p>
                {userPrefix ? (
                  <WorkspaceFileList
                    prefix={userPrefix}
                    numaGet={numaGet}
                    numaPost={numaPost}
                    numaDelete={numaDelete}
                  />
                ) : (
                  <p className="text-muted small">{t('v2Apps.workspace.files.empty')}</p>
                )}
              </div>
            </>
          )}

          {/* Settings Panel */}
          {selectedSection === 'settings' && (
            <>
              <div className="v2-workspace-tab__panel-header">
                <span className="v2-workspace-tab__panel-title">{t('v2Apps.workspace.settingsTitle')}</span>
              </div>
              <div className="v2-workspace-tab__panel-content" style={{ padding: 0 }}>
                <div className="v2-workspace-tab__settings-sections">
                  {/* Knowledge Bases */}
                  <WorkspaceSection
                    title={t('v2Apps.workspace.knowledgeBases.title')}
                    icon="bi bi-database"
                    summary={kbSummary}
                  >
                    <p className="text-muted small mb-2">{t('v2Apps.workspace.knowledgeBases.description')}</p>
                    {isLoadingKBs ? (
                      <Spinner animation="border" size="sm" />
                    ) : availableKBs.length === 0 ? (
                      <p className="text-muted small mb-0">{t('v2Apps.workspace.knowledgeBases.noneSelected')}</p>
                    ) : (
                      availableKBs.map((kb) => (
                        <Form.Check
                          key={kb.kb_id}
                          type="checkbox"
                          label={kb.kb_name}
                          checked={settings.enabledKBIds.includes(kb.kb_id)}
                          onChange={() => toggleKB(kb.kb_id)}
                          className="mb-1"
                        />
                      ))
                    )}
                  </WorkspaceSection>

                  {/* Tools */}
                  <WorkspaceSection title={t('v2Apps.workspace.tools.title')} icon="bi bi-wrench" summary={toolSummary}>
                    <p className="text-muted small mb-2">{t('v2Apps.workspace.tools.description')}</p>
                    {AVAILABLE_TOOLS.map((tool) => (
                      <Form.Check
                        key={tool.id}
                        type="checkbox"
                        label={t(tool.labelKey)}
                        checked={settings.enabledTools.includes(tool.id)}
                        onChange={() => toggleTool(tool.id)}
                        className="mb-1"
                      />
                    ))}
                  </WorkspaceSection>

                  {/* Integrations */}
                  {hasPipedreamFeature && (
                    <WorkspaceSection
                      title={t('v2Apps.workspace.integrations.title')}
                      icon="bi bi-plug"
                      summary={integrationSummary}
                    >
                      <p className="text-muted small mb-2">{t('v2Apps.workspace.integrations.description')}</p>
                      {connectionsLoading ? (
                        <Spinner animation="border" size="sm" />
                      ) : availableConnections.length === 0 ? (
                        <p className="text-muted small mb-0">{t('v2Apps.workspace.integrations.noneEnabled')}</p>
                      ) : (
                        availableConnections.map((conn) => {
                          const connIcon = getConnectionIcon(conn.id);
                          const fallbackIcon = getConnectionFallbackIcon(conn.id);
                          const displayName = getConnectionDisplayName(conn.id);
                          const isEnabled = settings.enabledConnections.includes(conn.id);
                          return (
                            <div key={conn.id}>
                              <Form.Check type="checkbox" className="mb-1">
                                <Form.Check.Input checked={isEnabled} onChange={() => toggleConnection(conn.id)} />
                                <Form.Check.Label className="d-flex align-items-center gap-2">
                                  {connIcon ? (
                                    <img src={connIcon} alt="" style={{ width: 16, height: 16 }} />
                                  ) : (
                                    <i className={fallbackIcon} />
                                  )}
                                  {displayName}
                                </Form.Check.Label>
                              </Form.Check>
                              <IntegrationAccountSubmenu
                                connectionId={conn.id}
                                accounts={conn.accounts ?? []}
                                allowMultipleAccounts={conn.allowMultipleAccounts === true}
                                isEnabled={isEnabled}
                                selectedAccountIds={settings.selectedAccountsByApp?.[conn.id]}
                                onChange={(next) =>
                                  setSelectedAccountsByApp({
                                    ...(settings.selectedAccountsByApp ?? {}),
                                    [conn.id]: next,
                                  })
                                }
                              />
                            </div>
                          );
                        })
                      )}
                    </WorkspaceSection>
                  )}

                  {/* Workspace Access */}
                  <WorkspaceSection title={t('v2Apps.agentRunPanel.workspaceAccess')} icon="bi bi-shield-check">
                    <Form.Check
                      type="switch"
                      label={t('v2Apps.agentRunPanel.workspaceAccessHelp')}
                      checked={settings.workspaceAccess}
                      onChange={() => setWorkspaceAccess(!settings.workspaceAccess)}
                    />
                  </WorkspaceSection>
                </div>
              </div>
            </>
          )}

          {/* Context & Instructions Panel */}
          {selectedSection === 'context' && (
            <>
              <div className="v2-workspace-tab__panel-header">
                <span className="v2-workspace-tab__panel-title">{t('v2Apps.workspace.context.title')}</span>
              </div>
              <div className="v2-workspace-tab__panel-content">
                <p className="text-muted small mb-3">{t('v2Apps.workspace.context.description')}</p>
                <Form.Control
                  as="textarea"
                  className="v2-workspace-tab__context-textarea"
                  value={settings.contextInstructions}
                  onChange={(e) => setContextInstructions(e.target.value)}
                  placeholder={t('v2Apps.workspace.context.placeholder')}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
