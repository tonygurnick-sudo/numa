import React, { useState, useEffect, useCallback } from 'react';
import { Badge, Button, Collapse, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../Providers/AuthProvider';
import { V2RunResultContent } from '../V2RunResultContent';
import { FilePreviewPanel } from '../../FilePreviewPanel';
import { FollowUpModal } from '../../FollowUpModal';
import { getSignedUrlForS3Object, downloadFileWithSignedUrl } from '../../../utils/s3Utils';
import { getFileIconClass } from '../../../utils/fileUtils';
import * as v2AppsService from '../../../Services/v2AppsService';
import type { RunRecord } from '../../../Services/v2AppsService';
import type { V2AppAgent } from '../../../types/apps';

type NumaGet = (url: string, params?: Record<string, unknown>) => Promise<unknown>;

interface RunsTabProps {
  runHistory: RunRecord[];
  currentRun: RunRecord | null;
  viewRun: (runId: string) => Promise<void>;
  removeRun: (runId: string) => Promise<void>;
  onRefresh: () => void;
  isRefreshing?: boolean;
  /** App agents — used to resolve agent names and result config per run */
  agents: V2AppAgent[];
  /** Start a follow-up run on a completed run */
  startFollowUp: (parentRunId: string, prompt: string, files?: File[]) => Promise<RunRecord | undefined>;
  /** numaGet for loading conversation thread */
  numaGet: NumaGet;
}

const STATUS_VARIANTS: Record<string, string> = {
  PENDING: 'secondary',
  PROCESSING: 'primary',
  COMPLETED: 'success',
  FAILED: 'danger',
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
};

export const RunsTab: React.FC<RunsTabProps> = ({
  runHistory,
  currentRun,
  viewRun,
  removeRun,
  onRefresh,
  isRefreshing,
  agents,
  startFollowUp,
  numaGet,
}) => {
  const { t } = useTranslation('apps');
  const { getCredentials } = useAuth();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [resultOpen, setResultOpen] = useState(true);
  const [artifactsOpen, setArtifactsOpen] = useState(true);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [conversationRuns, setConversationRuns] = useState<RunRecord[]>([]);

  const bucket = sessionStorage.getItem('OUTPUTS_BUCKET_NAME') || '';
  const region = sessionStorage.getItem('REGION') || '';

  // Open an S3 file in a new browser tab via presigned URL
  const handleOpenInNewTab = useCallback(
    async (s3Key: string) => {
      const url = await getSignedUrlForS3Object(s3Key, bucket, region, getCredentials);
      window.open(url, '_blank');
    },
    [bucket, region, getCredentials]
  );

  // Download an S3 file via presigned URL (triggers browser download)
  const handleDownloadFile = useCallback(
    async (s3Key: string) => {
      await downloadFileWithSignedUrl(s3Key, bucket, region, getCredentials);
    },
    [bucket, region, getCredentials]
  );

  // Background polling is handled by the useV2AppRun hook — no need to
  // duplicate it here. The hook refreshes runHistory automatically when
  // any run is PROCESSING and merges updates into currentRun.

  // Auto-select latest run on first load
  useEffect(() => {
    if (runHistory.length > 0 && !selectedRunId) {
      const latest = runHistory[0]; // sorted newest-first from API
      setSelectedRunId(latest.runId);
      viewRun(latest.runId);
    }
  }, [runHistory.length]);

  // Auto-select follow-up run when created from the currently selected run
  useEffect(() => {
    if (currentRun && selectedRunId && currentRun.runId !== selectedRunId && currentRun.parentRunId === selectedRunId) {
      setSelectedRunId(currentRun.runId);
    }
  }, [currentRun, selectedRunId]);

  const handleRunClick = useCallback(
    async (runId: string) => {
      if (selectedRunId === runId) return; // already selected
      setSelectedRunId(runId);
      setResultOpen(true);
      await viewRun(runId);
    },
    [selectedRunId, viewRun]
  );

  // Load conversation thread when a run with parentRunId or conversationId is selected.
  // Merges currentRun into the thread to handle optimistic updates (e.g. a new follow-up
  // that hasn't been returned by the API yet).
  useEffect(() => {
    if (!selectedRunId) {
      setConversationRuns([]);
      return;
    }
    const run = currentRun?.runId === selectedRunId ? currentRun : runHistory.find((r) => r.runId === selectedRunId);
    const convId = run?.conversationId;
    if (!convId) {
      setConversationRuns([]);
      return;
    }

    // Ensure currentRun is included in the thread even if the API/history hasn't caught up yet
    const ensureCurrentRun = (runs: RunRecord[]): RunRecord[] => {
      if (currentRun && currentRun.conversationId === convId && !runs.some((r) => r.runId === currentRun.runId)) {
        return [...runs, currentRun].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      }
      // Also update currentRun's status in the thread if polling has progressed
      return runs.map((r) => (currentRun && r.runId === currentRun.runId ? currentRun : r));
    };

    if (convId === run?.runId) {
      // Original run — check if any other run in history shares this conversationId
      const thread = runHistory.filter((r) => r.conversationId === convId);
      const merged = ensureCurrentRun(thread);
      if (merged.length > 1) {
        setConversationRuns(merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      } else {
        setConversationRuns([]);
      }
      return;
    }
    // Follow-up run — load full thread
    (async () => {
      try {
        const resp = await v2AppsService.getConversationRuns(numaGet, convId);
        setConversationRuns(ensureCurrentRun(resp.runs).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      } catch {
        const thread = runHistory.filter((r) => r.conversationId === convId);
        setConversationRuns(ensureCurrentRun(thread).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      }
    })();
  }, [selectedRunId, currentRun, runHistory, numaGet]);

  const handleFollowUpSubmit = useCallback(
    async (prompt: string, files: File[]) => {
      if (!selectedRunId) return;
      setFollowUpLoading(true);
      setFollowUpOpen(false);
      try {
        const newRun = await startFollowUp(selectedRunId, prompt, files);
        if (newRun) {
          setSelectedRunId(newRun.runId);
        }
      } finally {
        setFollowUpLoading(false);
      }
    },
    [selectedRunId, startFollowUp]
  );

  // Resolve agent info from the run's options
  const getAgentForRun = (run: RunRecord): V2AppAgent | undefined => {
    const agentId = (run.inputs?.options as Record<string, unknown>)?.agentId as string | undefined;
    if (agentId) return agents.find((a) => a.id === agentId);
    // Fallback: if only one agent, use it
    if (agents.length === 1) return agents[0];
    return undefined;
  };

  // Get the result config for the selected run's agent
  const selectedRun = selectedRunId
    ? currentRun?.runId === selectedRunId
      ? currentRun
      : runHistory.find((r) => r.runId === selectedRunId) || null
    : null;

  const selectedAgent = selectedRun ? getAgentForRun(selectedRun) : undefined;
  const resultConfig = selectedAgent?.resultConfig ?? { type: 'agent-response' as const };

  const renderMetaBar = (run: RunRecord) => (
    <div className="v2-runs-tab__detail-meta">
      <Badge bg={STATUS_VARIANTS[run.status] || 'secondary'}>
        {t(`v2DataAnalysis.status.${run.status.toLowerCase()}`)}
      </Badge>
      <span className="v2-runs-tab__detail-meta-item">
        <i className="bi bi-calendar3" /> {formatDate(run.createdAt)}
      </span>
      {run.result?.usage?.duration_ms && (
        <span className="v2-runs-tab__detail-meta-item">
          <i className="bi bi-stopwatch" /> {formatDuration(run.result.usage.duration_ms as number)}
        </span>
      )}
      {run.result?.usage?.num_turns && (
        <span className="v2-runs-tab__detail-meta-item">
          <i className="bi bi-arrow-repeat" /> {run.result.usage.num_turns as number} {t('v2Apps.runs.turns')}
        </span>
      )}
      {run.result?.usage?.total_cost_usd != null && (
        <span className="v2-runs-tab__detail-meta-item">
          <i className="bi bi-currency-dollar" /> {`$${(run.result.usage.total_cost_usd as number).toFixed(4)}`}
        </span>
      )}
      {run.result?.usage?.input_tokens != null && (
        <span
          className="v2-runs-tab__detail-meta-item"
          title={
            `Input: ${(run.result.usage.input_tokens as number).toLocaleString()}` +
            `\nOutput: ${((run.result.usage.output_tokens as number) || 0).toLocaleString()}` +
            (run.result.usage.cache_read_tokens
              ? `\nCache read: ${(run.result.usage.cache_read_tokens as number).toLocaleString()}`
              : '') +
            (run.result.usage.cache_creation_tokens
              ? `\nCache creation: ${(run.result.usage.cache_creation_tokens as number).toLocaleString()}`
              : '')
          }
        >
          <i className="bi bi-braces" />{' '}
          {(
            (run.result.usage.input_tokens as number) + ((run.result.usage.output_tokens as number) || 0)
          ).toLocaleString()}{' '}
          {t('v2Apps.runs.tokens')}
        </span>
      )}
    </div>
  );

  if (runHistory.length === 0) {
    return (
      <div className="v2-runs-tab__empty">
        <i className="bi bi-clock-history" />
        <p>{t('v2Apps.runs.empty')}</p>
      </div>
    );
  }

  return (
    <div className="v2-runs-tab">
      <div className="v2-runs-tab__layout">
        {/* Left: Run list (collapsible) */}
        <div className={`v2-runs-tab__sidebar ${listCollapsed ? 'v2-runs-tab__sidebar--collapsed' : ''}`}>
          <div className="v2-runs-tab__sidebar-header">
            {!listCollapsed && (
              <>
                <span className="v2-runs-tab__sidebar-title">{t('v2Apps.runs.title')}</span>
                <Button
                  variant="link"
                  size="sm"
                  onClick={onRefresh}
                  disabled={isRefreshing}
                  title={t('v2Apps.runs.refresh')}
                >
                  {isRefreshing ? <Spinner animation="border" size="sm" /> : <i className="bi bi-arrow-clockwise" />}
                </Button>
              </>
            )}
            <Button
              variant="link"
              size="sm"
              onClick={() => setListCollapsed(!listCollapsed)}
              title={listCollapsed ? t('v2Apps.runs.expandList') : t('v2Apps.runs.collapseList')}
            >
              <i className={`bi ${listCollapsed ? 'bi-chevron-right' : 'bi-chevron-left'}`} />
            </Button>
          </div>

          {!listCollapsed && (
            <div className="v2-runs-tab__list">
              {runHistory.map((run) => {
                const isSelected = selectedRunId === run.runId;
                const agent = getAgentForRun(run);
                const usage = run.result?.usage;
                const durationMs = (usage?.duration_ms as number) || null;

                return (
                  <div
                    key={run.runId}
                    className={`v2-runs-tab__item ${isSelected ? 'v2-runs-tab__item--active' : ''}`}
                    onClick={() => handleRunClick(run.runId)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && handleRunClick(run.runId)}
                  >
                    <div className="v2-runs-tab__item-info">
                      <div className="v2-runs-tab__item-name">
                        {run.name || run.inputs?.prompt?.slice(0, 60) || run.runId.slice(0, 8)}
                      </div>
                      <div className="v2-runs-tab__item-meta">
                        <span className="v2-runs-tab__item-date">{formatDate(run.createdAt)}</span>
                        {durationMs && (
                          <span className="v2-runs-tab__item-duration">
                            <i className="bi bi-stopwatch" /> {formatDuration(durationMs)}
                          </span>
                        )}
                      </div>
                      {agent && (
                        <div className="v2-runs-tab__item-agent">
                          <i className={agent.icon} style={{ color: agent.color }} /> {t(agent.nameKey)}
                        </div>
                      )}
                    </div>
                    <div className="v2-runs-tab__item-actions">
                      {run.status === 'PROCESSING' && <Spinner animation="border" size="sm" className="me-2" />}
                      <div className="v2-runs-tab__item-status">
                        <Badge bg={STATUS_VARIANTS[run.status] || 'secondary'}>
                          {t(`v2DataAnalysis.status.${run.status.toLowerCase()}`)}
                        </Badge>
                        {run.status === 'COMPLETED' && (
                          <button
                            className="v2-runs-tab__item-continue"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedRunId(run.runId);
                              viewRun(run.runId).then(() => setFollowUpOpen(true));
                            }}
                          >
                            {t('v2Apps.runs.continue')} <i className="bi bi-arrow-right" />
                          </button>
                        )}
                      </div>
                      <Button
                        variant="link"
                        size="sm"
                        className="text-danger p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRun(run.runId);
                        }}
                        title={t('v2Apps.runs.deleteConfirm')}
                      >
                        <i className="bi bi-trash" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Result detail panel */}
        <div className="v2-runs-tab__detail">
          {!selectedRun && (
            <div className="v2-runs-tab__detail-empty">
              <i className="bi bi-arrow-left-circle" />
              <p>{t('v2Apps.runs.empty')}</p>
            </div>
          )}

          {selectedRun && (
            <>
              {/* Header */}
              <div className="v2-runs-tab__detail-header">
                <div>
                  <h5 className="mb-0">{selectedRun.name || selectedRun.runId.slice(0, 12)}</h5>
                  {selectedAgent && (
                    <span className="v2-runs-tab__detail-agent">
                      <i className={selectedAgent.icon} style={{ color: selectedAgent.color }} />{' '}
                      {t(selectedAgent.nameKey)}
                    </span>
                  )}
                </div>
              </div>

              {/* Conversation thread or single run */}
              {(() => {
                // Determine which runs to render — conversation thread or just the selected run
                const threadRuns = conversationRuns.length > 1 ? conversationRuns : [selectedRun];
                const latestRun = threadRuns[threadRuns.length - 1];

                return (
                  <>
                    {threadRuns.map((threadRun, threadIdx) => {
                      const isLatest = threadIdx === threadRuns.length - 1;
                      const runOutputsPrefix = `v2-apps/${threadRun.appId}/${threadRun.userId}/${threadRun.conversationId || threadRun.runId}/outputs`;

                      return (
                        <div key={threadRun.runId} className="v2-runs-tab__thread-entry">
                          {/* Prompt */}
                          {threadRun.inputs?.prompt && (
                            <div className="v2-runs-tab__detail-prompt">
                              <div className="v2-runs-tab__detail-section-label mb-1">
                                <i className="bi bi-person me-1" />
                                {threadIdx === 0 ? t('v2Apps.runs.prompt') : t('v2Apps.runs.followUpLabel')}
                              </div>
                              <p className="mb-0">{threadRun.inputs.prompt}</p>
                            </div>
                          )}

                          {/* Metadata bar per entry */}
                          {renderMetaBar(threadRun)}

                          {/* Result */}
                          <div className="v2-runs-tab__detail-result">
                            {threadRun.status === 'PROCESSING' && (
                              <div className="text-center py-4">
                                <Spinner animation="border" className="mb-2" />
                                <p className="text-muted">{t('v2DataAnalysis.status.processing')}</p>
                              </div>
                            )}

                            {threadRun.status === 'FAILED' && (
                              <div className="alert alert-danger">
                                <strong>{t('v2DataAnalysis.errors.runFailed')}</strong>
                                {threadRun.error && <p className="mb-0 mt-1">{threadRun.error}</p>}
                              </div>
                            )}

                            {threadRun.status === 'COMPLETED' && threadRun.result && (
                              <>
                                {isLatest ? (
                                  <>
                                    <div
                                      className="v2-runs-tab__detail-section-toggle"
                                      onClick={() => setResultOpen(!resultOpen)}
                                      role="button"
                                      tabIndex={0}
                                      onKeyDown={(e) => e.key === 'Enter' && setResultOpen(!resultOpen)}
                                    >
                                      <i className={`bi ${resultOpen ? 'bi-chevron-down' : 'bi-chevron-right'}`} />
                                      <span className="v2-runs-tab__detail-section-label mb-0">
                                        {t('v2Apps.runs.response')}
                                      </span>
                                    </div>
                                    <Collapse in={resultOpen}>
                                      <div>
                                        {resultConfig.type === 'agent-response' && threadRun.result.text && (
                                          <div className="v2-runs-tab__detail-markdown mt-2">
                                            <V2RunResultContent
                                              content={threadRun.result.text}
                                              s3OutputsPrefix={runOutputsPrefix}
                                              bucket={bucket}
                                              region={region}
                                              onOpenFilePreview={(ref) => handleOpenInNewTab(ref.fullPath)}
                                              onOpenFolderPreview={(ref) => handleOpenInNewTab(ref.fullPath)}
                                            />
                                          </div>
                                        )}

                                        {resultConfig.type === 'file' && (
                                          <div className="v2-runs-tab__detail-file mt-2">
                                            <FilePreviewPanel
                                              preview={{
                                                type: 'file',
                                                filename: resultConfig.fileName,
                                                fullPath: `${runOutputsPrefix}/${resultConfig.fileName}`,
                                                relativePath: resultConfig.fileName,
                                                extension: resultConfig.fileName.split('.').pop()?.toLowerCase() || '',
                                              }}
                                              onClose={() => {}}
                                              bucket={bucket}
                                              region={region}
                                              getCredentials={getCredentials}
                                              embedded
                                            />
                                          </div>
                                        )}
                                      </div>
                                    </Collapse>
                                  </>
                                ) : (
                                  /* Earlier thread entries are always expanded and not collapsible */
                                  <div>
                                    <div className="v2-runs-tab__detail-section-label mb-1">
                                      <i className="bi bi-robot me-1" />
                                      {t('v2Apps.runs.response')}
                                    </div>
                                    {threadRun.result.text && (
                                      <div className="v2-runs-tab__detail-markdown">
                                        <V2RunResultContent
                                          content={threadRun.result.text}
                                          s3OutputsPrefix={runOutputsPrefix}
                                          bucket={bucket}
                                          region={region}
                                          onOpenFilePreview={(ref) => handleOpenInNewTab(ref.fullPath)}
                                          onOpenFolderPreview={(ref) => handleOpenInNewTab(ref.fullPath)}
                                        />
                                      </div>
                                    )}
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          {/* Separator between thread entries */}
                          {!isLatest && <hr className="v2-runs-tab__thread-divider" />}
                        </div>
                      );
                    })}

                    {/* Artifacts section (for the latest/selected run) */}
                    {latestRun.status === 'COMPLETED' &&
                      latestRun.result?.artifacts &&
                      latestRun.result.artifacts.length > 0 && (
                        <div className="v2-runs-tab__detail-artifacts">
                          <div
                            className="v2-runs-tab__detail-section-toggle"
                            onClick={() => setArtifactsOpen(!artifactsOpen)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === 'Enter' && setArtifactsOpen(!artifactsOpen)}
                          >
                            <i className={`bi ${artifactsOpen ? 'bi-chevron-down' : 'bi-chevron-right'}`} />
                            <span className="v2-runs-tab__detail-section-label mb-0">
                              {t('v2Apps.runs.artifacts', { count: latestRun.result.artifacts.length })}
                            </span>
                          </div>
                          <Collapse in={artifactsOpen}>
                            <div className="v2-runs-tab__artifact-list mt-2">
                              {latestRun.result.artifacts.map((artifact, idx) => {
                                const filename = artifact.path.split('/').pop() || artifact.path;
                                const iconClass = getFileIconClass(filename);
                                const convId = latestRun.conversationId || latestRun.runId;
                                const fullS3Key = `v2-apps/${latestRun.appId}/${latestRun.userId}/${convId}/${artifact.path}`;

                                return (
                                  <div key={idx} className="v2-runs-tab__artifact-item">
                                    <i className={iconClass} />
                                    <span className="v2-runs-tab__artifact-name">{filename}</span>
                                    <Button
                                      variant="link"
                                      size="sm"
                                      className="p-0"
                                      onClick={() => handleOpenInNewTab(fullS3Key)}
                                      title={t('v2Apps.runs.previewArtifact')}
                                    >
                                      <i className="bi bi-box-arrow-up-right" />
                                    </Button>
                                    <Button
                                      variant="link"
                                      size="sm"
                                      className="p-0"
                                      onClick={() => handleDownloadFile(fullS3Key)}
                                      title={t('v2Apps.runs.downloadArtifact')}
                                    >
                                      <i className="bi bi-download" />
                                    </Button>
                                  </div>
                                );
                              })}
                            </div>
                          </Collapse>
                        </div>
                      )}

                    {/* Follow-up button */}
                    {latestRun.status === 'COMPLETED' && (
                      <div className="v2-runs-tab__follow-up">
                        <Button
                          variant="outline-primary"
                          onClick={() => setFollowUpOpen(true)}
                          disabled={followUpLoading}
                        >
                          {followUpLoading ? (
                            <Spinner animation="border" size="sm" />
                          ) : (
                            <i className="bi bi-chat-dots" />
                          )}
                          {t('v2Apps.runs.followUp')}
                        </Button>
                      </div>
                    )}

                    {/* Follow-up modal */}
                    <FollowUpModal
                      show={followUpOpen}
                      onHide={() => setFollowUpOpen(false)}
                      onSubmit={handleFollowUpSubmit}
                      isLoading={followUpLoading}
                    />
                  </>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
