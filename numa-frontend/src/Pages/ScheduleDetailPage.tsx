import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Container, Row, Col, Card, Alert, Badge, Button, Spinner, Table, Modal } from 'react-bootstrap';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../Components/PageHeader';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { ScheduleService } from '../Services/ScheduleService';
import type { AgentSchedule } from '../types/agentSchedules';
import type { RunHistoryItem, ScheduledRunLog } from '../types/scheduledRuns';
import { AgentScheduleModal } from '../Components/Agents/AgentScheduleModal';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useAuth } from '../Providers/AuthProvider';
import { getNextRunTimes, describeCronExpression } from '../utils/cronUtils';
import { listObjectsInFolder, fetchFileFromS3, downloadFileFromS3 } from '../utils/s3Utils';
import { jwtDecode } from 'jwt-decode';
import { RunHistoryExpandedRow } from '../Components/Scheduling/RunHistoryExpandedRow';
import { useTranslation } from 'react-i18next';

type LocationState = {
  schedule?: AgentSchedule;
};

const getStatusBadgeVariant = (status: string) => {
  switch (status) {
    case 'active':
      return 'success';
    case 'paused':
      return 'warning';
    case 'deleted':
      return 'danger';
    default:
      return 'secondary';
  }
};

const formatDate = (date: Date | null | undefined, labels: { notAvailable: string }, timezone?: string): string => {
  if (!date) return labels.notAvailable;
  try {
    return date.toLocaleString(undefined, timezone ? { timeZone: timezone } : undefined);
  } catch {
    return date.toLocaleString();
  }
};

const formatTimestamp = (
  timestamp: number | undefined,
  labels: { never: string; invalid: string },
  timezone?: string
): string => {
  if (!timestamp) return labels.never;
  try {
    return new Date(timestamp).toLocaleString(undefined, timezone ? { timeZone: timezone } : undefined);
  } catch {
    return labels.invalid;
  }
};

/** Format the difference between two ISO timestamps as a human-readable duration. */
const formatDuration = (startedAt?: string, completedAt?: string): string | null => {
  if (!startedAt || !completedAt) return null;
  const ms = Date.parse(completedAt) - Date.parse(startedAt);
  if (Number.isNaN(ms) || ms < 0) return null;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
};

const getRunSortTime = (run: RunHistoryItem): number => {
  const completedAt = run.log?.completedAt;
  const startedAt = run.log?.startedAt;
  const fromLog = completedAt || startedAt;
  if (fromLog) {
    const parsed = Date.parse(fromLog);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return run.timestamp?.getTime?.() ?? 0;
};

export const ScheduleDetailPage: React.FC = () => {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { numaGet, numaPut, numaDelete, numaPost } = useNumaRequest();
  const { getCredentials, region: authRegion, getAccessToken } = useAuth();
  const { t } = useTranslation('agents');

  // If a ?run=<runId> query param is present (e.g. from a notification deeplink),
  // auto-expand that run once the history loads.
  const deeplinkRunId = searchParams.get('run');

  // Get schedule from navigation state if available
  const locationState = location.state as LocationState | null;
  const initialSchedule = locationState?.schedule ?? null;

  const [schedule, setSchedule] = useState<AgentSchedule | null>(initialSchedule);
  const [loading, setLoading] = useState(!initialSchedule);
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<RunHistoryItem[]>([]);
  const [runHistoryLoading, setRunHistoryLoading] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(deeplinkRunId);
  const [showDebugIds, setShowDebugIds] = useState(false);

  const outputsBucket = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME');
  }, []);

  const region = authRegion || (typeof window !== 'undefined' ? window.sessionStorage.getItem('REGION') : null);

  /** Download an artifact from the agent's workspace in S3. */
  const handleDownloadArtifact = useCallback(
    async (conversationId: string, userId: string, filename: string) => {
      if (!outputsBucket || !region || !getCredentials) return;
      const s3Key = `numa-chat/workspace/${userId}/conversations/${conversationId}/outputs/${filename}`;
      try {
        await downloadFileFromS3(s3Key, outputsBucket, region, getCredentials, filename);
      } catch (err) {
        console.error('Failed to download artifact:', err);
      }
    },
    [outputsBucket, region, getCredentials]
  );

  const loadSchedule = useCallback(async () => {
    if (!scheduleId) return;
    // If we already have the schedule from navigation state, don't reload
    if (schedule) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      // Fetch all schedules and find the one we need (no single-get endpoint exists)
      const allSchedules = await ScheduleService.getActiveSchedules(numaGet);
      const found = allSchedules.find((s) => s.scheduleId === scheduleId);
      if (found) {
        setSchedule(found);
      } else {
        setError(t('scheduling.errors.notFound'));
      }
    } catch (err) {
      console.error('Failed to load schedule:', err);
      setError((err as Error)?.message ?? t('scheduling.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [numaGet, scheduleId, schedule, t]);

  // Force reload schedule from API (used after updates)
  const reloadSchedule = useCallback(async () => {
    if (!scheduleId) return;
    try {
      const allSchedules = await ScheduleService.getActiveSchedules(numaGet);
      const found = allSchedules.find((s) => s.scheduleId === scheduleId);
      if (found) {
        setSchedule(found);
      }
    } catch (err) {
      console.error('Failed to reload schedule:', err);
    }
  }, [numaGet, scheduleId]);

  // Extract userId from lastRunS3Key path: numa-chat/scheduled-runs/{userId}/{scheduleId}/{runId}.json
  const extractUserIdFromS3Key = useCallback((s3Key: string | undefined): string | null => {
    if (!s3Key) return null;
    const parts = s3Key.split('/');
    // Expected format: numa-chat/scheduled-runs/{userId}/{scheduleId}/{runId}.json
    if (parts.length >= 4 && parts[0] === 'numa-chat' && parts[1] === 'scheduled-runs') {
      return parts[2];
    }
    return null;
  }, []);

  const getUserIdFromToken = useCallback(async (): Promise<string | null> => {
    // Try access token first, then fall back to ID token from localStorage
    try {
      const accessToken = await getAccessToken();
      if (accessToken) {
        const decoded = jwtDecode<{ sub?: string }>(accessToken);
        if (decoded.sub) return decoded.sub;
      }
    } catch {
      // Fall through to ID token
    }
    try {
      const idToken = localStorage.getItem('idToken');
      if (idToken) {
        const decoded = jwtDecode<{ sub?: string }>(idToken);
        return decoded.sub ?? null;
      }
    } catch {
      // Give up
    }
    return null;
  }, [getAccessToken]);

  const sortRunHistory = useCallback((items: RunHistoryItem[]) => {
    return [...items].sort((a, b) => getRunSortTime(b) - getRunSortTime(a));
  }, []);

  const fetchRunLog = useCallback(
    async (run: RunHistoryItem): Promise<{ log?: ScheduledRunLog; error?: string }> => {
      if (!outputsBucket || !region || !getCredentials) {
        return { error: t('scheduling.details.runHistory.status.error') };
      }
      try {
        const blob = await fetchFileFromS3(run.s3Key, outputsBucket, region, getCredentials);
        const text = await blob.text();
        const log = JSON.parse(text) as ScheduledRunLog;
        return { log };
      } catch (err) {
        console.error('Failed to load run log:', err);
        return { error: t('scheduling.details.runHistory.status.error') };
      }
    },
    [outputsBucket, region, getCredentials, t]
  );

  const loadRunLogsForRuns = useCallback(
    async (runs: RunHistoryItem[]) => {
      if (!runs.length || !outputsBucket || !region || !getCredentials) return;

      const pending = runs.filter((run) => !run.log && !run.loading && !run.error);
      if (!pending.length) return;

      const batchSize = 5;
      for (let i = 0; i < pending.length; i += batchSize) {
        const batch = pending.slice(i, i + batchSize);

        setRunHistory((prev) =>
          prev.map((item) => (batch.some((run) => run.runId === item.runId) ? { ...item, loading: true } : item))
        );

        const results = await Promise.all(
          batch.map(async (run) => {
            const result = await fetchRunLog(run);
            return { runId: run.runId, ...result };
          })
        );

        setRunHistory((prev) =>
          sortRunHistory(
            prev.map((item) => {
              const result = results.find((entry) => entry.runId === item.runId);
              if (!result) return item;
              if (result.log) {
                return {
                  ...item,
                  log: result.log,
                  loading: false,
                  timestamp: result.log.startedAt ? new Date(result.log.startedAt) : item.timestamp,
                  error: undefined,
                };
              }
              return {
                ...item,
                loading: false,
                error: result.error ?? t('scheduling.details.runHistory.status.error'),
              };
            })
          )
        );
      }
    },
    [fetchRunLog, outputsBucket, region, getCredentials, sortRunHistory, t]
  );

  const loadRunHistory = useCallback(async () => {
    if (!schedule || !scheduleId || !outputsBucket || !region || !getCredentials) {
      return;
    }

    try {
      setRunHistoryLoading(true);

      // Try to get userId from the lastRunS3Key first (most reliable)
      let userId = extractUserIdFromS3Key(schedule.lastRunS3Key);

      // Fall back to getting from JWT token
      if (!userId) {
        userId = await getUserIdFromToken();
      }

      if (!userId) {
        console.error('Could not determine user ID for run history');
        setRunHistoryLoading(false);
        return;
      }

      const prefix = `numa-chat/scheduled-runs/${userId}/${scheduleId}/`;

      const keys = await listObjectsInFolder(prefix, outputsBucket, region, getCredentials);

      // Parse run IDs from keys and sort by timestamp (newest first)
      const runs: RunHistoryItem[] = keys
        .filter((key) => key && key.endsWith('.json'))
        .map((key) => {
          const runId = key.split('/').pop()?.replace('.json', '') ?? '';
          return {
            runId,
            s3Key: key,
            timestamp: new Date(0),
          };
        });

      setRunHistory((prev) => {
        // Keep inProgress runs that aren't yet in the fetched run logs
        const inProgressRuns = prev.filter((r) => r.inProgress && !runs.some((newRun) => newRun.runId === r.runId));
        // We know sortRunHistory gets the newest items to the top
        return [...inProgressRuns, ...runs].sort((a, b) => getRunSortTime(b) - getRunSortTime(a));
      });
      void loadRunLogsForRuns(runs);
    } catch (err) {
      console.error('Failed to load run history:', err);
    } finally {
      setRunHistoryLoading(false);
    }
  }, [
    schedule,
    scheduleId,
    outputsBucket,
    region,
    getCredentials,
    extractUserIdFromS3Key,
    getUserIdFromToken,
    loadRunLogsForRuns,
    sortRunHistory,
  ]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    if (schedule) {
      loadRunHistory();
    }
  }, [schedule, loadRunHistory]);

  // When a deeplink run is present and loaded, scroll it into view.
  useEffect(() => {
    if (!deeplinkRunId || !runHistory.length) return;
    const match = runHistory.find((r) => r.runId === deeplinkRunId);
    if (match?.log) {
      const el = document.getElementById(`run-${deeplinkRunId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [deeplinkRunId, runHistory]);

  const loadRunLog = useCallback(
    async (run: RunHistoryItem) => {
      if (!outputsBucket || !region || !getCredentials || run.log || run.loading) return;

      setRunHistory((prev) => prev.map((r) => (r.runId === run.runId ? { ...r, loading: true } : r)));

      const result = await fetchRunLog(run);
      setRunHistory((prev) =>
        sortRunHistory(
          prev.map((r) => {
            if (r.runId !== run.runId) return r;
            if (result.log) {
              return {
                ...r,
                log: result.log,
                loading: false,
                timestamp: result.log.startedAt ? new Date(result.log.startedAt) : r.timestamp,
                error: undefined,
              };
            }
            return {
              ...r,
              loading: false,
              error: result.error ?? t('scheduling.details.runHistory.status.error'),
            };
          })
        )
      );
    },
    [outputsBucket, region, getCredentials, fetchRunLog, sortRunHistory, t]
  );

  const handleToggleExpand = useCallback(
    (run: RunHistoryItem) => {
      if (expandedRun === run.runId) {
        setExpandedRun(null);
      } else {
        setExpandedRun(run.runId);
        if (!run.log && !run.loading) {
          loadRunLog(run);
        }
      }
    },
    [expandedRun, loadRunLog]
  );

  const handleTogglePause = useCallback(async () => {
    if (!schedule) return;
    const newStatus = schedule.status === 'active' ? 'paused' : 'active';
    setActionLoading('pause');
    try {
      await ScheduleService.update(numaPut, schedule.scheduleId, { status: newStatus });
      await reloadSchedule();
    } catch (err) {
      console.error('Failed to update schedule status:', err);
      setError((err as Error)?.message ?? 'Failed to update schedule status');
    } finally {
      setActionLoading(null);
    }
  }, [schedule, numaPut, reloadSchedule]);

  const handleConfirmDelete = useCallback(async () => {
    if (!schedule) return;
    setActionLoading('delete');
    try {
      await ScheduleService.delete(numaDelete, schedule.scheduleId);
      setShowDeleteConfirm(false);
      navigate('/scheduling');
    } catch (err) {
      console.error('Failed to delete schedule:', err);
      setError((err as Error)?.message ?? 'Failed to delete schedule');
    } finally {
      setActionLoading(null);
    }
  }, [schedule, numaDelete, navigate]);

  // Ref to track the polling interval so we can clean it up on unmount
  const pollIntervalRef = React.useRef<number | null>(null);
  const pollAttemptsRef = React.useRef(0);

  // Clean up polling interval on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current !== null) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  const handleRunNow = useCallback(async () => {
    if (!schedule) return;
    setActionLoading('run');
    try {
      const response = await ScheduleService.run(numaPost, schedule.scheduleId);

      // Immediately inject placeholder run history item so the user sees feedback
      if (response.runId) {
        setRunHistory((prev) => {
          if (prev.some((r) => r.runId === response.runId)) return prev;

          const newRun: RunHistoryItem = {
            runId: response.runId,
            s3Key: response.runLogS3Key || '',
            timestamp: new Date(),
            inProgress: true,
          };

          return [newRun, ...prev].sort((a, b) => getRunSortTime(b) - getRunSortTime(a));
        });
      }

      // Clear any existing poll before starting a new one
      if (pollIntervalRef.current !== null) {
        window.clearInterval(pollIntervalRef.current);
      }

      // Poll run history every 3 seconds (up to ~30 seconds) to pick up the
      // completed S3 log. loadRunHistory will merge the fetched entries with the
      // in-progress placeholder; once the real log file appears the placeholder
      // is replaced automatically because its runId matches the S3 key.
      pollAttemptsRef.current = 0;
      pollIntervalRef.current = window.setInterval(() => {
        pollAttemptsRef.current++;
        if (pollAttemptsRef.current >= 10) {
          if (pollIntervalRef.current !== null) {
            window.clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          return;
        }
        void loadRunHistory();
      }, 3000);
    } catch (err) {
      console.error('Failed to run schedule:', err);
      setError((err as Error)?.message ?? t('scheduling.errors.run'));
    } finally {
      setActionLoading(null);
    }
  }, [schedule, numaPost, loadRunHistory, t]);

  const handleUpdateSchedule = useCallback(
    async (payload: { promptText: string; cronExpression: string; timezone: string; label?: string }) => {
      if (!schedule) return;
      await ScheduleService.update(numaPut, schedule.scheduleId, {
        promptText: payload.promptText,
        cronExpression: payload.cronExpression,
        timezone: payload.timezone,
        label: payload.label,
      });
      await reloadSchedule();
    },
    [schedule, numaPut, reloadSchedule]
  );

  const nextRun = useMemo(() => {
    if (!schedule) return null;
    // Paused or deleted schedules have no next run
    if (schedule.status !== 'active') return null;
    const runs = getNextRunTimes(schedule.cronExpression, schedule.timezone ?? 'UTC', 1);
    return runs[0] ?? null;
  }, [schedule]);

  const editingAgent = useMemo(() => {
    if (!schedule) return null;
    return {
      agentId: schedule.agentId,
      title: schedule.agentTitle || schedule.agentId,
    };
  }, [schedule]);

  /** Aggregate run stats from loaded run history for a quick trend overview. */
  const runStats = useMemo(() => {
    const loaded = runHistory.filter((r) => r.log && !r.loading);
    if (loaded.length === 0) return null;
    let success = 0;
    let partial = 0;
    let failed = 0;
    for (const r of loaded) {
      const s = r.log?.agentStatus?.status;
      if (s === 'failed' || r.log?.error) failed++;
      else if (s === 'partial') partial++;
      else success++;
    }
    return { total: loaded.length, success, partial, failed };
  }, [runHistory]);

  if (loading) {
    return (
      <Container fluid>
        <div className="text-center py-5">
          <Spinner animation="border" />
          <p className="mt-3 text-muted">{t('scheduling.details.loading')}</p>
        </div>
      </Container>
    );
  }

  if (error && !schedule) {
    return (
      <Container fluid>
        <Alert variant="danger">
          {error}
          <Button variant="link" onClick={() => navigate('/scheduling')}>
            {t('scheduling.details.backToScheduling')}
          </Button>
        </Alert>
      </Container>
    );
  }

  if (!schedule) {
    return (
      <Container fluid>
        <Alert variant="warning">
          {t('scheduling.errors.notFound')}
          <Button variant="link" onClick={() => navigate('/scheduling')}>
            {t('scheduling.details.backToScheduling')}
          </Button>
        </Alert>
      </Container>
    );
  }

  return (
    <div className="dashboard schedule-detail-page">
      <PageHeader
        title={schedule.label || t('scheduling.labels.unnamed')}
        subtitle={
          <span className="schedule-detail-header-subtitle">
            <Badge bg={getStatusBadgeVariant(schedule.status)} className="me-2 schedule-detail-header-status-badge">
              {t(`scheduling.status.${schedule.status}`, schedule.status)}
            </Badge>
            {schedule.agentTitle || schedule.agentId}
          </span>
        }
        actions={
          <Button variant="secondary" onClick={() => navigate('/scheduling')}>
            <i className="bi bi-arrow-left me-2" aria-hidden="true"></i>
            {t('scheduling.details.backToSchedules')}
          </Button>
        }
      />
      <LayoutDashboard>
        <Container fluid className="schedule-detail-content">
          {error && (
            <Alert variant="danger" onClose={() => setError(null)} dismissible className="mb-4">
              {error}
            </Alert>
          )}

          {/* Action Buttons */}
          <Row className="mb-4">
            <Col>
              <div className="d-flex gap-2 flex-wrap schedule-detail-actions">
                <Button
                  variant="primary"
                  onClick={handleRunNow}
                  disabled={schedule.status === 'deleted' || actionLoading !== null}
                >
                  {actionLoading === 'run' ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      {t('scheduling.actions.running')}
                    </>
                  ) : (
                    <>
                      <i className="bi bi-play-fill me-2"></i>
                      {t('scheduling.actions.runNow')}
                    </>
                  )}
                </Button>
                <Button
                  variant="outline-primary"
                  onClick={() => setShowEditModal(true)}
                  disabled={schedule.status === 'deleted' || actionLoading !== null}
                >
                  <i className="bi bi-pencil me-2"></i>
                  {t('scheduling.actions.edit')}
                </Button>
                <Button
                  variant={schedule.status === 'active' ? 'outline-warning' : 'outline-success'}
                  onClick={handleTogglePause}
                  disabled={schedule.status === 'deleted' || actionLoading !== null}
                >
                  {actionLoading === 'pause' ? (
                    <Spinner animation="border" size="sm" />
                  ) : (
                    <>
                      <i
                        className={schedule.status === 'active' ? 'bi bi-pause-fill me-2' : 'bi bi-play-fill me-2'}
                      ></i>
                      {schedule.status === 'active' ? t('scheduling.actions.pause') : t('scheduling.actions.resume')}
                    </>
                  )}
                </Button>
                <Button
                  variant="outline-danger"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={schedule.status === 'deleted' || actionLoading !== null}
                >
                  <i className="bi bi-trash me-2"></i>
                  {t('scheduling.actions.delete')}
                </Button>
              </div>
            </Col>
          </Row>

          {/* Schedule Details */}
          <Row className="mb-4">
            <Col lg={6}>
              <Card className="h-100 schedule-detail-card">
                <Card.Header className="d-flex justify-content-between align-items-center schedule-detail-card-header">
                  <span>{t('scheduling.details.cardTitle')}</span>
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={() => setShowDebugIds((current) => !current)}
                    aria-pressed={showDebugIds}
                  >
                    <i className="bi bi-bug me-2"></i>
                    {showDebugIds ? t('scheduling.debug.hideIds') : t('scheduling.debug.showIds')}
                  </Button>
                </Card.Header>
                <Card.Body className="schedule-detail-card-body">
                  <dl className="row mb-0 schedule-detail-definition-list">
                    {showDebugIds && (
                      <>
                        <dt className="col-sm-4">{t('scheduling.details.fields.scheduleId')}</dt>
                        <dd className="col-sm-8 text-muted font-monospace small">{schedule.scheduleId}</dd>
                      </>
                    )}

                    <dt className="col-sm-4">{t('scheduling.details.fields.agent')}</dt>
                    <dd className="col-sm-8">{schedule.agentTitle || schedule.agentId}</dd>

                    <dt className="col-sm-4">{t('scheduling.details.fields.frequency')}</dt>
                    <dd className="col-sm-8">
                      {describeCronExpression(schedule.cronExpression)}
                      {showDebugIds && (
                        <>
                          <br />
                          <small className="text-muted font-monospace">{schedule.cronExpression}</small>
                        </>
                      )}
                    </dd>

                    <dt className="col-sm-4">{t('scheduling.details.fields.timezone')}</dt>
                    <dd className="col-sm-8">{schedule.timezone}</dd>

                    <dt className="col-sm-4">{t('scheduling.details.fields.nextRun')}</dt>
                    <dd className="col-sm-8">
                      {formatDate(nextRun, { notAvailable: t('scheduling.labels.notAvailable') }, schedule.timezone)}
                    </dd>

                    <dt className="col-sm-4">{t('scheduling.details.fields.lastRun')}</dt>
                    <dd className="col-sm-8">
                      {formatTimestamp(
                        schedule.lastRunEpoch,
                        { never: t('scheduling.labels.never'), invalid: t('scheduling.labels.invalidDate') },
                        schedule.timezone
                      )}
                      {schedule.lastStatus && <span className="ms-2 text-muted">({schedule.lastStatus})</span>}
                    </dd>

                    <dt className="col-sm-4">{t('scheduling.details.fields.created')}</dt>
                    <dd className="col-sm-8">
                      {formatTimestamp(
                        schedule.createdAt,
                        { never: t('scheduling.labels.never'), invalid: t('scheduling.labels.invalidDate') },
                        schedule.timezone
                      )}
                    </dd>
                  </dl>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={6}>
              <Card className="h-100 schedule-detail-card">
                <Card.Header className="schedule-detail-card-header">
                  {t('scheduling.details.instructionsTitle')}
                </Card.Header>
                <Card.Body className="schedule-detail-card-body">
                  <p className="mb-0 schedule-detail-instructions-text">
                    {schedule.promptText || t('scheduling.details.instructionsEmpty')}
                  </p>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          {/* Run History */}
          <Row>
            <Col>
              <Card className="schedule-detail-card">
                <Card.Header className="d-flex justify-content-between align-items-center schedule-detail-card-header">
                  <span>{t('scheduling.details.runHistory.title')}</span>
                  <Button variant="outline-primary" size="sm" onClick={loadRunHistory} disabled={runHistoryLoading}>
                    {runHistoryLoading ? (
                      <Spinner animation="border" size="sm" />
                    ) : (
                      <i className="bi bi-arrow-clockwise"></i>
                    )}
                    <span className="ms-2">{t('scheduling.actions.refresh')}</span>
                  </Button>
                </Card.Header>
                {/* Run success rate summary */}
                {runStats && (
                  <div className="d-flex align-items-center gap-3 px-3 py-2 border-bottom bg-light small">
                    <span className="fw-bold">
                      {t('scheduling.details.runHistory.stats.total', { count: runStats.total })}
                    </span>
                    <span className="text-success">
                      <i className="bi bi-check-circle me-1" aria-hidden="true"></i>
                      {t('scheduling.details.runHistory.stats.success', { count: runStats.success })}
                    </span>
                    {runStats.partial > 0 && (
                      <span className="text-warning">
                        <i className="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>
                        {t('scheduling.details.runHistory.stats.partial', { count: runStats.partial })}
                      </span>
                    )}
                    {runStats.failed > 0 && (
                      <span className="text-danger">
                        <i className="bi bi-x-circle me-1" aria-hidden="true"></i>
                        {t('scheduling.details.runHistory.stats.failed', { count: runStats.failed })}
                      </span>
                    )}
                    <span className="text-muted ms-auto">
                      {Math.round((runStats.success / runStats.total) * 100)}
                      {'% '}
                      {t('scheduling.details.runHistory.stats.successRate')}
                    </span>
                  </div>
                )}
                <Card.Body className="p-0">
                  {runHistoryLoading && runHistory.length === 0 ? (
                    <div className="text-center py-5">
                      <Spinner animation="border" />
                      <p className="mt-3 text-muted">{t('scheduling.details.runHistory.loading')}</p>
                    </div>
                  ) : runHistory.length === 0 ? (
                    <div className="text-center py-5">
                      <i className="bi bi-clock-history fs-1 text-muted"></i>
                      <p className="mt-3 text-muted">{t('scheduling.details.runHistory.empty')}</p>
                    </div>
                  ) : (
                    <Table hover responsive className="mb-0 schedule-detail-history-table">
                      <thead>
                        <tr>
                          <th style={{ width: '40px' }}></th>
                          {showDebugIds && <th>{t('scheduling.details.runHistory.columns.runId')}</th>}
                          <th>{t('scheduling.details.runHistory.columns.started')}</th>
                          <th>{t('scheduling.details.runHistory.columns.completed')}</th>
                          <th>{t('scheduling.details.runHistory.columns.duration')}</th>
                          <th>{t('scheduling.details.runHistory.columns.status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runHistory.map((run) => (
                          <React.Fragment key={run.runId}>
                            <tr
                              id={`run-${run.runId}`}
                              onClick={() => handleToggleExpand(run)}
                              className={
                                expandedRun === run.runId
                                  ? 'table-active schedule-detail-history-row'
                                  : 'schedule-detail-history-row'
                              }
                            >
                              <td>
                                <i
                                  className={`bi ${expandedRun === run.runId ? 'bi-chevron-down' : 'bi-chevron-right'}`}
                                ></i>
                              </td>
                              {showDebugIds && (
                                <td>
                                  <code className="small">{run.runId}</code>
                                </td>
                              )}
                              <td>
                                {run.log?.startedAt
                                  ? new Date(run.log.startedAt).toLocaleString(
                                      undefined,
                                      schedule.timezone ? { timeZone: schedule.timezone } : undefined
                                    )
                                  : t('scheduling.details.runHistory.placeholder')}
                              </td>
                              <td>
                                {run.log?.completedAt
                                  ? new Date(run.log.completedAt).toLocaleString(
                                      undefined,
                                      schedule.timezone ? { timeZone: schedule.timezone } : undefined
                                    )
                                  : t('scheduling.details.runHistory.placeholder')}
                              </td>
                              <td className="text-muted small">
                                {formatDuration(run.log?.startedAt, run.log?.completedAt) ??
                                  t('scheduling.details.runHistory.placeholder')}
                              </td>
                              <td>
                                {run.loading ? (
                                  <Spinner animation="border" size="sm" />
                                ) : run.error ? (
                                  <Badge bg="danger">{t('scheduling.details.runHistory.status.error')}</Badge>
                                ) : run.inProgress ? (
                                  <Badge bg="primary">{t('scheduling.details.runHistory.status.inProgress')}</Badge>
                                ) : run.log?.error ? (
                                  <Badge bg="danger">{t('scheduling.details.runHistory.status.failed')}</Badge>
                                ) : run.log?.agentStatus ? (
                                  <Badge
                                    bg={
                                      run.log.agentStatus.status === 'success'
                                        ? 'success'
                                        : run.log.agentStatus.status === 'partial'
                                          ? 'warning'
                                          : 'danger'
                                    }
                                  >
                                    {t(
                                      `scheduling.details.runHistory.status.${run.log.agentStatus.status}`,
                                      run.log.agentStatus.status
                                    )}
                                  </Badge>
                                ) : run.log ? (
                                  <Badge bg="success">{t('scheduling.details.runHistory.status.completed')}</Badge>
                                ) : (
                                  <Badge bg="secondary">{t('scheduling.details.runHistory.placeholder')}</Badge>
                                )}
                              </td>
                            </tr>
                            {expandedRun === run.runId && (
                              <tr>
                                <td
                                  colSpan={showDebugIds ? 6 : 5}
                                  className="p-0 border-0"
                                  style={
                                    {
                                      backgroundColor: '#f8f9fa',
                                      '--bs-table-hover-bg': '#f8f9fa',
                                    } as React.CSSProperties
                                  }
                                >
                                  <div className="p-3">
                                    <RunHistoryExpandedRow
                                      run={run}
                                      onDownloadArtifact={handleDownloadArtifact}
                                      defaultMessagesOpen
                                    />
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>

          {/* Edit Modal */}
          {editingAgent && (
            <AgentScheduleModal
              show={showEditModal}
              onHide={() => setShowEditModal(false)}
              agent={editingAgent}
              editingSchedule={schedule}
              onCreate={handleUpdateSchedule}
            />
          )}

          {/* Delete Confirmation Modal */}
          <Modal show={showDeleteConfirm} onHide={() => setShowDeleteConfirm(false)} centered>
            <Modal.Header closeButton>
              <Modal.Title className="text-danger">
                <i className="bi bi-exclamation-triangle-fill me-2"></i>
                {t('scheduling.delete.title')}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <p>
                {t('scheduling.delete.confirmPrefix')}{' '}
                <strong>{schedule.label || t('scheduling.labels.unnamed')}</strong>
                {t('scheduling.delete.confirmSuffix')}
              </p>
              <Alert variant="warning" className="mb-0">
                <i className="bi bi-exclamation-triangle me-2"></i>
                <strong>{t('scheduling.delete.warningTitle')}</strong> {t('scheduling.delete.warningBody')}
              </Alert>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)} disabled={actionLoading !== null}>
                {t('scheduling.actions.cancel')}
              </Button>
              <Button variant="danger" onClick={handleConfirmDelete} disabled={actionLoading !== null}>
                {actionLoading === 'delete' ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" />
                    {t('scheduling.delete.deleting')}
                  </>
                ) : (
                  <>
                    <i className="bi bi-trash me-2"></i>
                    {t('scheduling.delete.confirmButton')}
                  </>
                )}
              </Button>
            </Modal.Footer>
          </Modal>
        </Container>
      </LayoutDashboard>
    </div>
  );
};

export default ScheduleDetailPage;
