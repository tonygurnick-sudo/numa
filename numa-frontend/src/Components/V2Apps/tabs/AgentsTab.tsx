import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Button, Form, Spinner, ProgressBar } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { AgentCard } from '../AgentCard';
import {
  getConnectionIcon,
  getConnectionDisplayName,
  getConnectionFallbackIcon,
} from '../../../config/integrationsConfig';
import CustomFieldRenderer from '../CustomFieldRenderer';
import type {
  V2AppConfig,
  V2AppAgent,
  V2AppWorkspaceSettings,
  RunConfiguration,
  V2AppCustomField,
} from '../../../types/apps';
import type { V2AppRunState } from '../../../hooks/useV2AppRun';
import type { RunRecord, ProgressEvent } from '../../../Services/v2AppsService';

type KnowledgeBase = {
  kb_id: string;
  kb_name: string;
};

type ConnectionOption = {
  id: string;
  name: string;
  isConnected: boolean;
};

interface AgentsTabProps {
  appId: string;
  app: V2AppConfig;
  state: V2AppRunState;
  currentRun: RunRecord | null;
  error: string | null;
  uploadProgress: number;
  startAnalysis: (
    prompt: string,
    files: File[],
    config?: RunConfiguration,
    runName?: string
  ) => Promise<boolean | void>;
  reset: () => void;
  workspaceSettings: V2AppWorkspaceSettings;
  availableKBs: KnowledgeBase[];
  isLoadingKBs: boolean;
  availableConnections: ConnectionOption[];
  connectionsLoading: boolean;
  hasPipedreamFeature: boolean;
  progressEvents?: ProgressEvent[];
}

const AVAILABLE_TOOLS = [{ id: 'web_search', labelKey: 'v2Apps.workspace.tools.webSearch' }];

export const AgentsTab: React.FC<AgentsTabProps> = ({
  app,
  state,
  error,
  uploadProgress,
  startAnalysis,
  reset,
  workspaceSettings,
  availableKBs,
  isLoadingKBs,
  availableConnections,
  connectionsLoading,
  hasPipedreamFeature,
  progressEvents,
}) => {
  const { t } = useTranslation('apps');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Agent selection — auto-select if only one agent
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    app.agents.length === 1 ? app.agents[0].id : null
  );
  const selectedAgent = app.agents.find((a) => a.id === selectedAgentId) ?? null;

  // Form state
  const [prompt, setPrompt] = useState('');
  const [runName, setRunName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Custom field values (initialized from field defaults when agent changes)
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    selectedAgent?.customFields?.forEach((field: V2AppCustomField) => {
      if (field.defaultValue) defaults[field.id] = field.defaultValue;
      else if (field.options?.length) defaults[field.id] = field.required ? field.options[0].value : '';
      else defaults[field.id] = '';
    });
    return defaults;
  });

  // Re-initialize custom fields when agent changes
  useEffect(() => {
    const defaults: Record<string, string> = {};
    selectedAgent?.customFields?.forEach((field: V2AppCustomField) => {
      if (field.defaultValue) defaults[field.id] = field.defaultValue;
      else if (field.options?.length) defaults[field.id] = field.required ? field.options[0].value : '';
      else defaults[field.id] = '';
    });
    setCustomFieldValues(defaults);
  }, [selectedAgent]);

  const handleCustomFieldChange = useCallback((fieldId: string, value: string) => {
    setCustomFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  // Local overrides initialized from workspace defaults
  const [enabledKBIds, setEnabledKBIds] = useState<string[]>(workspaceSettings.enabledKBIds);
  const [enabledTools, setEnabledTools] = useState<string[]>(workspaceSettings.enabledTools);
  const [enabledConnections, setEnabledConnections] = useState<string[]>(workspaceSettings.enabledConnections);
  const [workspaceAccess, setWorkspaceAccess] = useState(workspaceSettings.workspaceAccess);

  // Re-sync when workspace settings change
  useEffect(() => {
    setEnabledKBIds(workspaceSettings.enabledKBIds);
    setEnabledTools(workspaceSettings.enabledTools);
    setEnabledConnections(workspaceSettings.enabledConnections);
    setWorkspaceAccess(workspaceSettings.workspaceAccess);
  }, [workspaceSettings]);

  const handleAgentClick = useCallback(
    (agentId: string) => {
      setSelectedAgentId(selectedAgentId === agentId ? null : agentId);
    },
    [selectedAgentId]
  );

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    setFiles((prev) => [...prev, ...Array.from(newFiles)]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if ((!prompt.trim() && files.length === 0) || !selectedAgent) return;
      const resolvedKBs = enabledKBIds.map((id) => {
        const kb = availableKBs.find((k) => k.kb_id === id);
        return { id, name: kb?.kb_name || id };
      });
      const config: RunConfiguration = {
        agentId: selectedAgent.id,
        enabledKBIds,
        enabledKBs: resolvedKBs,
        enabledTools,
        enabledConnections,
        workspaceAccess,
        contextInstructions: workspaceSettings.contextInstructions,
        // Custom metadata from agent-specific fields (e.g., assessment_type, output_language)
        ...(selectedAgent.customFields?.length ? { metadata: customFieldValues } : {}),
        // Explicit agent type override (maps to workspace agent type_id)
        ...(selectedAgent.agentType ? { agentType: selectedAgent.agentType } : {}),
      };
      await startAnalysis(prompt.trim(), files, config, runName.trim() || undefined);
    },
    [
      prompt,
      runName,
      files,
      selectedAgent,
      enabledKBIds,
      availableKBs,
      enabledTools,
      enabledConnections,
      workspaceAccess,
      workspaceSettings.contextInstructions,
      customFieldValues,
      startAnalysis,
    ]
  );

  const handleNewAnalysis = useCallback(() => {
    reset();
    setPrompt('');
    setRunName('');
    setFiles([]);
  }, [reset]);

  const toggleKB = useCallback((kbId: string) => {
    setEnabledKBIds((prev) => (prev.includes(kbId) ? prev.filter((id) => id !== kbId) : [...prev, kbId]));
  }, []);

  const toggleTool = useCallback((toolId: string) => {
    setEnabledTools((prev) => (prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId]));
  }, []);

  const toggleConnection = useCallback((connId: string) => {
    setEnabledConnections((prev) => (prev.includes(connId) ? prev.filter((id) => id !== connId) : [...prev, connId]));
  }, []);

  const isUploading = state === 'uploading';
  const isProcessing = state === 'processing';
  const showError = state === 'error' && error;
  const showForm = !isUploading && !isProcessing && !showError;

  const renderFormPanel = (agent: V2AppAgent) => (
    <>
      {/* Header */}
      <div className="v2-agents-tab__form-header">
        <h4 className="v2-agents-tab__form-title">
          {t('v2Apps.agentRunPanel.title', { agentName: t(agent.nameKey) })}
        </h4>
      </div>

      {/* Form content */}
      <div className="v2-agents-tab__form-content">
        {/* Input form */}
        {showForm && (
          <Form onSubmit={handleSubmit}>
            {/* File dropzone */}
            <div
              className={`v2-agents-tab__dropzone ${isDragOver ? 'v2-agents-tab__dropzone--active' : ''}`}
              onDrop={handleDrop}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="d-none"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
              <i className="bi bi-cloud-upload" />
              <p className="mb-0 mt-1 small">{t('v2Apps.agentRunPanel.dropzone')}</p>
            </div>

            {/* File list */}
            {files.length > 0 && (
              <ul className="v2-agents-tab__file-list">
                {files.map((file, i) => (
                  <li key={`${file.name}-${i}`} className="v2-agents-tab__file-item">
                    <i className="bi bi-file-earmark" />
                    <span className="v2-agents-tab__file-name">{file.name}</span>
                    <span className="v2-agents-tab__file-size">{`(${(file.size / 1024).toFixed(0)} KB)`}</span>
                    <Button variant="link" size="sm" className="text-danger p-0 ms-auto" onClick={() => removeFile(i)}>
                      <i className="bi bi-x-lg" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {/* Custom fields (agent-specific, e.g., KB selection, assessment type) */}
            {selectedAgent?.customFields && selectedAgent.customFields.length > 0 && (
              <div className="mt-3">
                {selectedAgent.customFields.map((field) => (
                  <CustomFieldRenderer
                    key={field.id}
                    field={field}
                    value={customFieldValues[field.id] ?? ''}
                    onChange={handleCustomFieldChange}
                    availableKBs={availableKBs}
                  />
                ))}
              </div>
            )}

            {/* Run name (optional) */}
            <div className="mt-3">
              <Form.Control
                type="text"
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
                placeholder={t('v2Apps.agentRunPanel.namePlaceholder')}
                className="mb-2"
              />
            </div>

            {/* Prompt */}
            <div>
              <Form.Control
                as="textarea"
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t(
                  selectedAgent?.promptPlaceholderKey ||
                    app.promptPlaceholderKey ||
                    'v2Apps.agentRunPanel.promptPlaceholder'
                )}
              />
              {workspaceAccess && (
                <p className="text-muted small mt-1 mb-0">
                  <i className="bi bi-info-circle me-1" />
                  {t('v2Apps.agentRunPanel.workspaceFilesHint')}
                </p>
              )}
            </div>

            {/* Settings overrides */}
            <div className="v2-agents-tab__settings mt-3">
              <button
                type="button"
                className="v2-agents-tab__settings-toggle"
                onClick={() => setSettingsOpen(!settingsOpen)}
              >
                <i className={`bi ${settingsOpen ? 'bi-chevron-down' : 'bi-chevron-right'}`} />
                <span>{t('v2Apps.agentRunPanel.settings')}</span>
                <span className="v2-agents-tab__settings-note">{t('v2Apps.agentRunPanel.settingsNote')}</span>
              </button>

              {settingsOpen && (
                <div className="v2-agents-tab__settings-body">
                  {/* Knowledge Bases */}
                  <div className="v2-agents-tab__settings-section">
                    <div className="v2-agents-tab__settings-section-title">
                      {t('v2Apps.workspace.knowledgeBases.title')}
                    </div>
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
                          checked={enabledKBIds.includes(kb.kb_id)}
                          onChange={() => toggleKB(kb.kb_id)}
                          className="mb-1"
                        />
                      ))
                    )}
                  </div>

                  {/* Tools */}
                  <div className="v2-agents-tab__settings-section">
                    <div className="v2-agents-tab__settings-section-title">{t('v2Apps.workspace.tools.title')}</div>
                    {AVAILABLE_TOOLS.map((tool) => (
                      <Form.Check
                        key={tool.id}
                        type="checkbox"
                        label={t(tool.labelKey)}
                        checked={enabledTools.includes(tool.id)}
                        onChange={() => toggleTool(tool.id)}
                        className="mb-1"
                      />
                    ))}
                  </div>

                  {/* Integrations */}
                  {hasPipedreamFeature && (
                    <div className="v2-agents-tab__settings-section">
                      <div className="v2-agents-tab__settings-section-title">
                        {t('v2Apps.workspace.integrations.title')}
                      </div>
                      {connectionsLoading ? (
                        <Spinner animation="border" size="sm" />
                      ) : availableConnections.length === 0 ? (
                        <p className="text-muted small mb-0">{t('v2Apps.workspace.integrations.noneEnabled')}</p>
                      ) : (
                        availableConnections.map((conn) => {
                          const icon = getConnectionIcon(conn.id);
                          const fallbackIcon = getConnectionFallbackIcon(conn.id);
                          const displayName = getConnectionDisplayName(conn.id);
                          return (
                            <Form.Check key={conn.id} type="checkbox" className="mb-1">
                              <Form.Check.Input
                                checked={enabledConnections.includes(conn.id)}
                                onChange={() => toggleConnection(conn.id)}
                              />
                              <Form.Check.Label className="d-flex align-items-center gap-2">
                                {icon ? (
                                  <img src={icon} alt="" style={{ width: 16, height: 16 }} />
                                ) : (
                                  <i className={fallbackIcon} />
                                )}
                                {displayName}
                              </Form.Check.Label>
                            </Form.Check>
                          );
                        })
                      )}
                    </div>
                  )}

                  {/* Workspace Access */}
                  <div className="v2-agents-tab__settings-section">
                    <Form.Check
                      type="switch"
                      label={t('v2Apps.agentRunPanel.workspaceAccess')}
                      checked={workspaceAccess}
                      onChange={() => setWorkspaceAccess(!workspaceAccess)}
                    />
                    <p className="text-muted small mb-0 mt-1">{t('v2Apps.agentRunPanel.workspaceAccessHelp')}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Submit */}
            <Button
              type="submit"
              variant="primary"
              disabled={!prompt.trim() && files.length === 0}
              className="mt-3 w-100"
            >
              <i className="bi bi-play-fill me-1" />
              {t('v2Apps.agentRunPanel.run')}
            </Button>
          </Form>
        )}

        {/* Upload progress */}
        {isUploading && (
          <div className="v2-agents-tab__processing">
            <Spinner animation="border" size="sm" className="me-2" />
            <p>{t('v2DataAnalysis.status.uploading')}</p>
            <ProgressBar now={uploadProgress} label={`${uploadProgress}%`} animated />
          </div>
        )}

        {/* Processing with progress events */}
        {isProcessing && (
          <div className="v2-agents-tab__processing">
            <Spinner animation="border" className="mb-3" />
            {progressEvents && progressEvents.length > 0 ? (
              <div className="v2-agents-tab__progress-events">
                {progressEvents.map((event, i) => {
                  const isLatest = i === progressEvents.length - 1;
                  const elapsed = !isLatest
                    ? Math.round(
                        (new Date(progressEvents[i + 1].timestamp).getTime() - new Date(event.timestamp).getTime()) /
                          1000
                      )
                    : 0;
                  return (
                    <div
                      key={`${event.phase}-${i}`}
                      className={`v2-agents-tab__progress-event ${isLatest ? 'v2-agents-tab__progress-event--active' : ''}`}
                    >
                      <i className={`bi ${isLatest ? 'bi-arrow-right-circle-fill' : 'bi-check-circle-fill'} me-2`} />
                      <span>{event.message}</span>
                      {!isLatest && elapsed > 0 && (
                        <span className="text-muted ms-auto small">
                          {elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p>{t('v2DataAnalysis.status.processing')}</p>
            )}
          </div>
        )}

        {/* Error */}
        {showError && (
          <div>
            <div className="alert alert-danger">
              <strong>{t('v2DataAnalysis.errors.runFailed')}</strong>
              <p className="mb-2">{error}</p>
              <Button variant="outline-danger" size="sm" onClick={handleNewAnalysis}>
                {t('v2DataAnalysis.actions.tryAgain')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="v2-agents-tab">
      <div className="v2-agents-tab__layout">
        {/* Left sidebar — agent list */}
        <div className="v2-agents-tab__sidebar">
          <div className="v2-agents-tab__sidebar-header">
            <span className="v2-agents-tab__sidebar-title">
              {t('v2Apps.agents.title', { appName: t(app.nameKey) })}
            </span>
          </div>
          <div className="v2-agents-tab__agent-list">
            {app.agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                isSelected={selectedAgentId === agent.id}
                onClick={() => handleAgentClick(agent.id)}
              />
            ))}
          </div>
        </div>

        {/* Right panel — run form or empty state */}
        <div className="v2-agents-tab__form-panel">
          {selectedAgent ? (
            renderFormPanel(selectedAgent)
          ) : (
            <div className="v2-agents-tab__form-empty">
              <i className="bi bi-robot" />
              <p>{t('v2Apps.agents.selectAgent')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
