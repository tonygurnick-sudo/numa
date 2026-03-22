import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Button, Form, Spinner, ProgressBar } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { MarkdownContent } from '../Renderers/MarkdownContent';
import { FilePreviewPanel } from '../FilePreviewPanel';
import {
  getConnectionIcon,
  getConnectionDisplayName,
  getConnectionFallbackIcon,
} from '../../config/integrationsConfig';
import { useAuth } from '../../Providers/AuthProvider';
import type { V2AppAgent, V2AppWorkspaceSettings, RunConfiguration } from '../../types/apps';
import type { V2AppRunState } from '../../hooks/useV2AppRun';
import type { RunRecord, ProgressEvent } from '../../Services/v2AppsService';

type KnowledgeBase = {
  kb_id: string;
  kb_name: string;
};

type ConnectionOption = {
  id: string;
  name: string;
  isConnected: boolean;
};

interface AgentRunPanelProps {
  agent: V2AppAgent;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (prompt: string, files: File[], config: RunConfiguration, runName?: string) => Promise<void>;
  onReset: () => void;
  runState: V2AppRunState;
  currentRun: RunRecord | null;
  error: string | null;
  uploadProgress: number;
  workspaceSettings: V2AppWorkspaceSettings;
  availableKBs: KnowledgeBase[];
  isLoadingKBs: boolean;
  availableConnections: ConnectionOption[];
  connectionsLoading: boolean;
  hasPipedreamFeature: boolean;
  promptPlaceholderKey?: string;
  progressEvents?: ProgressEvent[];
}

const AVAILABLE_TOOLS = [{ id: 'web_search', labelKey: 'v2Apps.workspace.tools.webSearch' }];

/**
 * Renders the first artifact file if resultConfig is 'first-artifact',
 * otherwise falls back to rendering result.text as markdown.
 */
const ArtifactOrTextResult: React.FC<{ run: RunRecord; agent: V2AppAgent }> = ({ run, agent }) => {
  const { getCredentials } = useAuth();
  const resultConfig = agent.resultConfig ?? { type: 'agent-response' as const };
  const bucket = sessionStorage.getItem('OUTPUTS_BUCKET_NAME') || '';
  const region = sessionStorage.getItem('REGION') || '';

  if (resultConfig.type === 'first-artifact' && run.result?.artifacts?.[0]) {
    const artifact = run.result.artifacts[0];
    const artifactFileName = artifact.path.split('/').pop() || artifact.path;
    const artifactPath = artifact.path.startsWith('outputs/') ? artifact.path.slice('outputs/'.length) : artifact.path;
    const convId = run.conversationId || run.runId;
    const s3OutputsPrefix = `v2-apps/${run.appId}/${run.userId}/${convId}/outputs`;

    return (
      <FilePreviewPanel
        preview={{
          type: 'file',
          filename: artifactFileName,
          fullPath: `${s3OutputsPrefix}/${artifactPath}`,
          relativePath: artifactPath,
          extension: artifactFileName.split('.').pop()?.toLowerCase() || '',
        }}
        onClose={() => {}}
        bucket={bucket}
        region={region}
        getCredentials={getCredentials}
        embedded
      />
    );
  }

  return run.result?.text ? <MarkdownContent content={run.result.text} /> : null;
};

export const AgentRunPanel: React.FC<AgentRunPanelProps> = ({
  agent,
  isOpen,
  onClose,
  onSubmit,
  onReset,
  runState,
  currentRun,
  error,
  uploadProgress,
  workspaceSettings,
  availableKBs,
  isLoadingKBs,
  availableConnections,
  connectionsLoading,
  hasPipedreamFeature,
  promptPlaceholderKey,
  progressEvents,
}) => {
  const { t } = useTranslation('apps');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [prompt, setPrompt] = useState('');
  const [runName, setRunName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
      if (!prompt.trim() && files.length === 0) return;
      // Resolve KB IDs to {id, name} objects for the workspace agent
      const resolvedKBs = enabledKBIds.map((id) => {
        const kb = availableKBs.find((k) => k.kb_id === id);
        return { id, name: kb?.kb_name || id };
      });
      const config: RunConfiguration = {
        agentId: agent.id,
        enabledKBIds,
        enabledKBs: resolvedKBs,
        enabledTools,
        enabledConnections,
        workspaceAccess,
        contextInstructions: workspaceSettings.contextInstructions,
      };
      await onSubmit(prompt.trim(), files, config, runName.trim() || undefined);
    },
    [
      prompt,
      runName,
      files,
      agent.id,
      enabledKBIds,
      availableKBs,
      enabledTools,
      enabledConnections,
      workspaceAccess,
      workspaceSettings.contextInstructions,
      onSubmit,
    ]
  );

  const handleNewAnalysis = useCallback(() => {
    onReset();
    setPrompt('');
    setRunName('');
    setFiles([]);
  }, [onReset]);

  const toggleKB = useCallback((kbId: string) => {
    setEnabledKBIds((prev) => (prev.includes(kbId) ? prev.filter((id) => id !== kbId) : [...prev, kbId]));
  }, []);

  const toggleTool = useCallback((toolId: string) => {
    setEnabledTools((prev) => (prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId]));
  }, []);

  const toggleConnection = useCallback((connId: string) => {
    setEnabledConnections((prev) => (prev.includes(connId) ? prev.filter((id) => id !== connId) : [...prev, connId]));
  }, []);

  const isWorking = runState === 'uploading' || runState === 'processing';
  const showResults = runState === 'completed' && currentRun?.result;
  const showError = runState === 'error' && error;
  const showForm = !showResults && !isWorking && !showError;

  return (
    <>
      {isOpen && <div className="v2-agent-run-panel__backdrop" onClick={onClose} />}
      <div className={`v2-agent-run-panel ${isOpen ? 'v2-agent-run-panel--open' : ''}`}>
        {/* Header */}
        <div className="v2-agent-run-panel__header">
          <h4 className="v2-agent-run-panel__title">
            {t('v2Apps.agentRunPanel.title', { agentName: t(agent.nameKey) })}
          </h4>
          <button className="v2-agent-run-panel__close" onClick={onClose} title={t('v2Apps.agentRunPanel.close')}>
            <i className="bi bi-x-lg" />
          </button>
        </div>

        {/* Body */}
        <div className="v2-agent-run-panel__body">
          {/* Input form */}
          {showForm && (
            <Form onSubmit={handleSubmit}>
              {/* File dropzone */}
              <div
                className={`v2-agent-run-panel__dropzone ${isDragOver ? 'v2-agent-run-panel__dropzone--active' : ''}`}
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
                <ul className="v2-agent-run-panel__file-list">
                  {files.map((file, i) => (
                    <li key={`${file.name}-${i}`} className="v2-agent-run-panel__file-item">
                      <i className="bi bi-file-earmark" />
                      <span className="v2-agent-run-panel__file-name">{file.name}</span>
                      <span className="v2-agent-run-panel__file-size">{`(${(file.size / 1024).toFixed(0)} KB)`}</span>
                      <Button
                        variant="link"
                        size="sm"
                        className="text-danger p-0 ms-auto"
                        onClick={() => removeFile(i)}
                      >
                        <i className="bi bi-x-lg" />
                      </Button>
                    </li>
                  ))}
                </ul>
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
                  placeholder={t(promptPlaceholderKey ?? 'v2Apps.agentRunPanel.promptPlaceholder')}
                />
                {workspaceAccess && (
                  <p className="text-muted small mt-1 mb-0">
                    <i className="bi bi-info-circle me-1" />
                    {t('v2Apps.agentRunPanel.workspaceFilesHint')}
                  </p>
                )}
              </div>

              {/* Settings overrides */}
              <div className="v2-agent-run-panel__settings mt-3">
                <button
                  type="button"
                  className="v2-agent-run-panel__settings-toggle"
                  onClick={() => setSettingsOpen(!settingsOpen)}
                >
                  <i className={`bi ${settingsOpen ? 'bi-chevron-down' : 'bi-chevron-right'}`} />
                  <span>{t('v2Apps.agentRunPanel.settings')}</span>
                  <span className="v2-agent-run-panel__settings-note">{t('v2Apps.agentRunPanel.settingsNote')}</span>
                </button>

                {settingsOpen && (
                  <div className="v2-agent-run-panel__settings-body">
                    {/* Knowledge Bases */}
                    <div className="v2-agent-run-panel__settings-section">
                      <div className="v2-agent-run-panel__settings-section-title">
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
                    <div className="v2-agent-run-panel__settings-section">
                      <div className="v2-agent-run-panel__settings-section-title">
                        {t('v2Apps.workspace.tools.title')}
                      </div>
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
                      <div className="v2-agent-run-panel__settings-section">
                        <div className="v2-agent-run-panel__settings-section-title">
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
                    <div className="v2-agent-run-panel__settings-section">
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
          {runState === 'uploading' && (
            <div className="v2-agent-run-panel__processing">
              <Spinner animation="border" size="sm" className="me-2" />
              <p>{t('v2DataAnalysis.status.uploading')}</p>
              <ProgressBar now={uploadProgress} label={`${uploadProgress}%`} animated />
            </div>
          )}

          {/* Processing */}
          {runState === 'processing' && (
            <div className="v2-agent-run-panel__processing">
              <Spinner animation="border" className="mb-3" />
              {progressEvents && progressEvents.length > 0 ? (
                <div className="v2-agent-run-panel__progress-events">
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
                        className={`v2-agent-run-panel__progress-event ${isLatest ? 'v2-agent-run-panel__progress-event--active' : ''}`}
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
            <div className="v2-agent-run-panel__error">
              <div className="alert alert-danger">
                <strong>{t('v2DataAnalysis.errors.runFailed')}</strong>
                <p className="mb-2">{error}</p>
                <Button variant="outline-danger" size="sm" onClick={handleNewAnalysis}>
                  {t('v2DataAnalysis.actions.tryAgain')}
                </Button>
              </div>
            </div>
          )}

          {/* Results */}
          {showResults && currentRun?.result && (
            <div className="v2-agent-run-panel__results">
              <div className="d-flex align-items-center justify-content-between mb-3">
                <h5 className="mb-0">{t('v2DataAnalysis.results.title')}</h5>
                <Button variant="outline-primary" size="sm" onClick={handleNewAnalysis}>
                  <i className="bi bi-plus-lg me-1" />
                  {t('v2DataAnalysis.actions.newAnalysis')}
                </Button>
              </div>
              <div className="v2-agent-run-panel__results-content">
                <ArtifactOrTextResult run={currentRun} agent={agent} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
