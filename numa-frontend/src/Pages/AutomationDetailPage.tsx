import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Container, Row, Col, Card, Alert, Badge, Button, Spinner, Table, Modal } from 'react-bootstrap';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Clock,
  Play,
  Pause,
  Pencil,
  Trash2,
  Zap,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Bot,
  CheckCircle2,
  XCircle,
  CircleDot,
  FileText,
  Mail,
} from 'lucide-react';
import { PageHeader } from '../Components/PageHeader';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { ScheduleService } from '../Services/ScheduleService';
import { getAgent } from '../Services/AgentsService';
import { RunHistoryExpandedRow } from '../Components/Scheduling/RunHistoryExpandedRow';
import { OpenInChatButton } from '../Components/Scheduling/OpenInChatButton';
import { AgentAvatar } from '../Components/Agents/AgentAvatar';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useAuth } from '../Providers/AuthProvider';
import { useBranding } from '../Providers/BrandingContext';
import { getNextRunTimes, describeCronExpression } from '../utils/cronUtils';
import { getDerivedAutomationStatus, automationStatusBadgeVariant, formatRelativeTime } from '../utils/automationUtils';
import { listObjectsInFolder, fetchFileFromS3, downloadFileFromS3 } from '../utils/s3Utils';
import { jwtDecode } from 'jwt-decode';
import type { AgentSchedule } from '../types/agentSchedules';
import type { AgentSummary } from '../types/agents';
import {
  summarizePipedreamConfiguredProps,
  summarizePipedreamTrigger,
} from '../Components/PipedreamTriggers/pipedreamTriggerLabels';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import type { RunHistoryItem, ScheduledRunLog } from '../types/scheduledRuns';

const toMillis = (ts: number): number => (ts > 1e12 ? ts : ts * 1000);

const formatTimestamp = (ts?: number, timezone?: string): string => {
  if (!ts) return '\u2014';
  try {
    return new Date(toMillis(ts)).toLocaleString(undefined, timezone ? { timeZone: timezone } : undefined);
  } catch {
    return new Date(toMillis(ts)).toLocaleString();
  }
};

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

const extractUserIdFromS3Key = (s3Key?: string): string | null => {
  if (!s3Key) return null;
  const match = s3Key.match(/numa-chat\/scheduled-runs\/([^/]+)\//);
  return match?.[1] ?? null;
};

/**
 * Renders the configured props of a Pipedream trigger as definition-list rows
 * inside the existing trigger-details Card. Skips the auth prop (auto-injected
 * server-side) and any forced_props (Numa-controlled, not user-visible).
 *
 * Uses i18n-driven prop labels (see `pipedreamTriggers.triggers.<id>.props.<name>.label`)
 * and the trigger's `configured_prop_labels` snapshot to render channel/user
 * names instead of raw IDs.
 */
const PipedreamPropsDetail: React.FC<{
  trigger: {
    component_id: string;
    configured_props: Record<string, unknown>;
    configured_prop_labels?: Record<string, Record<string, string>>;
    app_slug: string;
  };
  forcedPropNames: readonly string[];
}> = ({ trigger, forcedPropNames }) => {
  const { t } = useTranslation('automations');
  const rows = summarizePipedreamConfiguredProps({
    componentId: trigger.component_id,
    appSlug: trigger.app_slug,
    configuredProps: trigger.configured_props,
    configuredPropLabels: trigger.configured_prop_labels,
    forcedPropNames,
    t,
  });
  if (rows.length === 0) return null;
  return (
    <>
      <dt className="col-sm-4 text-muted small">{t('pipedreamTriggers.detail.configuredProps')}</dt>
      <dd className="col-sm-8">
        <dl className="row mb-0">
          {rows.map((r) => (
            <React.Fragment key={r.propName}>
              <dt className="col-sm-5 text-muted small">{r.label}</dt>
              <dd className="col-sm-7 small mb-1">{r.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      </dd>
    </>
  );
};

/**
 * Banner shown above the workflow diagram when the underlying Pipedream
 * account for a Pipedream-trigger automation has gone unhealthy. Surfaces
 * a "Reconnect on Integrations" CTA — the trigger keeps existing on the
 * Pipedream side but won't fire until the OAuth grant is reauthorised.
 */
const PipedreamUnhealthyBanner: React.FC<{ appSlug: string }> = ({ appSlug }) => {
  const { t } = useTranslation('automations');
  return (
    <Alert variant="warning" className="d-flex align-items-center justify-content-between">
      <div>
        <strong>{t('pipedreamTriggers.detail.unhealthyTitle', { app: appSlug })}</strong>
        <div className="small mb-0">{t('pipedreamTriggers.detail.unhealthyBody')}</div>
      </div>
      <a href="/integrations" className="btn btn-sm btn-outline-warning">
        {t('pipedreamTriggers.detail.reconnectCta')}
      </a>
    </Alert>
  );
};

export const AutomationDetailPage: React.FC = () => {
  const { automationId } = useParams<{ automationId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('automations');
  const { t: tAgents } = useTranslation('agents');
  const { numaGet, numaPut, numaDelete, numaPost } = useNumaRequest();
  const { getCredentials, region: authRegion, getAccessToken, user, lambdaClient } = useAuth();
  const { branding } = useBranding();
  // BrandingTheme stores colors under `branding.colors.*`; the legacy paths
  // (`branding.primaryColor`, `branding.resolvedAssets?.primaryColor`) don't
  // exist on the type and resolve to undefined at runtime, so partner-branded
  // tenants were silently falling back to the default purple. Use the
  // typed paths.
  const brandPrimaryColor = branding.colors?.primary || '#6366f1';
  const brandPrimaryContrast = branding.colors?.buttonPrimaryText || '#ffffff';

  // Defensive UI gating — if an admin somehow lands on a non-owned schedule
  // (e.g. via a shared URL or stale link), hide owner-only actions and show
  // the same "Viewing as admin" banner pattern as ScheduleDetailPage. The
  // server-side list endpoint is owner-scoped, so for non-admins the
  // automation simply won't load — that's already handled by the not-found
  // branch. This block exists for the future-proofing case where the page
  // ever wires an admin cross-user fetch (and as defence-in-depth if the
  // server gating regresses).
  const currentUserSub = user?.decoded_tokens?.idToken?.sub as string | undefined;
  const isCurrentUserAdmin = (user?.decoded_tokens?.idToken?.['cognito:groups'] as string[] | undefined)?.includes(
    'admin'
  );

  const [automation, setAutomation] = useState<AgentSchedule | null>(null);
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  // Pipedream-only: track whether the underlying app account is unhealthy so
  // the banner can prompt a reconnect. Stays null until we know.
  const [pipedreamHealthState, setPipedreamHealthState] = useState<'unknown' | 'healthy' | 'unhealthy'>('unknown');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Non-blocking advisory surfaced after a successful action (e.g. reactivate
  // while trigger budget is exhausted). Schedule status update succeeded —
  // this just tells the user the trigger won't fire until budget resets.
  const [notice, setNotice] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Run history state
  const [runHistory, setRunHistory] = useState<RunHistoryItem[]>([]);
  const [runHistoryLoading, setRunHistoryLoading] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const outputsBucket = window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME') || '';
  const region = authRegion || window.sessionStorage.getItem('REGION') || '';

  // Load automation from the list endpoint and find by ID
  useEffect(() => {
    if (!automationId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const allSchedules = await ScheduleService.list(numaGet);
        const result = allSchedules.find((s) => s.scheduleId === automationId);
        if (!result) {
          if (!cancelled) setError(t('errors.load'));
          return;
        }
        if (!cancelled) {
          setAutomation(result);
          try {
            const agentResult = await getAgent(numaGet, result.agentId);
            if (!cancelled) setAgent(agentResult);
          } catch {
            // Agent may have been deleted
          }
        }
      } catch (err) {
        if (!cancelled) setError(t('errors.load'));
        console.error('[AutomationDetailPage] Failed to load:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [automationId, numaGet, t]);

  // Load run history from S3
  const getUserIdFromToken = useCallback(async (): Promise<string | null> => {
    try {
      const token = await getAccessToken();
      if (token) {
        const decoded = jwtDecode<{ sub?: string }>(token);
        return decoded.sub || null;
      }
    } catch {
      /* ignore */
    }
    return null;
  }, [getAccessToken]);

  const loadRunHistory = useCallback(async () => {
    if (!automation || !automationId || !outputsBucket || !region || !getCredentials) return;
    try {
      setRunHistoryLoading(true);
      let userId = extractUserIdFromS3Key(automation.lastRunS3Key);
      if (!userId) userId = await getUserIdFromToken();
      if (!userId) {
        setRunHistoryLoading(false);
        return;
      }

      const prefix = `numa-chat/scheduled-runs/${userId}/${automationId}/`;
      const keys = await listObjectsInFolder(prefix, outputsBucket, region, getCredentials);

      // Sort comparator used both pre- and post-log-load. Prefers the log's
      // own timestamps (ISO strings written by the runner); falls back to
      // `timestamp` only if the log isn't loaded yet. Returns `0` for missing
      // values so a NaN-returning comparator can't make sort unstable.
      const sortKey = (r: RunHistoryItem): number => {
        const t = r.log?.completedAt || r.log?.startedAt;
        if (t) {
          const parsed = Date.parse(t);
          if (Number.isFinite(parsed)) return parsed;
        }
        const ts = r.timestamp?.getTime?.();
        return Number.isFinite(ts) ? (ts as number) : 0;
      };

      const items: RunHistoryItem[] = keys
        .filter((key: string) => key.endsWith('.json'))
        .map((key: string) => {
          const parts = key.split('/');
          const fileName = parts[parts.length - 1] || '';
          const runId = fileName.replace('.json', '');
          // Pre-load placeholder. The previous regex (`runId.match(/^(\d+)/)`)
          // tried to extract a ms timestamp from the runId, but our runIds
          // are UUIDv4 strings — the leading hex digits aren't a timestamp.
          // For e.g. `1086091a-...` the regex matched `1086091` and produced
          // a 1970 Date. For `aedffbca-...` (no leading digits) it fell
          // through to `new Date()` which set NOW. Result: completely wrong
          // sort order that never corrected even after logs loaded, because
          // we never re-derived `timestamp` from the log content. Now we
          // sort by `log.completedAt` / `startedAt` directly via `sortKey`,
          // and only consult `timestamp` when no log is loaded yet.
          return { runId, s3Key: key, timestamp: new Date(0) };
        })
        .sort((a: RunHistoryItem, b: RunHistoryItem) => sortKey(b) - sortKey(a));

      setRunHistory(items);

      // Load every listed run's log, not just the first 10. Pre-truncating
      // here produced a misleading "X succeeded / Y total" ratio because the
      // success counter excluded unloaded rows from its numerator but
      // counted them in the denominator, and rows past index 10 rendered as
      // empty placeholders the user could only resolve by clicking each one.
      // Logs are ~1-2 KB so the bandwidth cost is small; we batch to avoid
      // firing N concurrent requests against S3 for very large run histories.
      const batchSize = 10;
      const loaded: RunHistoryItem[] = [];
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (item) => {
            try {
              const blob = await fetchFileFromS3(item.s3Key, outputsBucket, region, getCredentials);
              const text = await blob.text();
              const log = JSON.parse(text) as ScheduledRunLog;
              return { ...item, log, loading: false };
            } catch {
              return { ...item, loading: false, error: 'Failed to load' };
            }
          })
        );
        loaded.push(...batchResults);
      }

      setRunHistory((prev) =>
        prev
          .map((item) => {
            const loadedItem = loaded.find((l) => l.runId === item.runId);
            return loadedItem || item;
          })
          // Re-sort post-load so the now-populated `log.completedAt` values
          // drive ordering. Without this the array kept the pre-load order
          // (where all sortKeys were 0 = stable = S3-list order).
          .sort((a, b) => sortKey(b) - sortKey(a))
      );
    } catch (err) {
      console.error('[AutomationDetailPage] Failed to load run history:', err);
    } finally {
      setRunHistoryLoading(false);
    }
  }, [automation, automationId, outputsBucket, region, getCredentials, getUserIdFromToken]);

  useEffect(() => {
    if (automation) loadRunHistory();
  }, [automation, loadRunHistory]);

  const loadRunLog = useCallback(
    async (runId: string) => {
      const run = runHistory.find((r) => r.runId === runId);
      if (!run || run.log || run.loading) return;

      setRunHistory((prev) => prev.map((r) => (r.runId === runId ? { ...r, loading: true } : r)));

      try {
        const blob = await fetchFileFromS3(run.s3Key, outputsBucket, region, getCredentials);
        const text = await blob.text();
        const log = JSON.parse(text) as ScheduledRunLog;
        setRunHistory((prev) => prev.map((r) => (r.runId === runId ? { ...r, log, loading: false } : r)));
      } catch {
        setRunHistory((prev) =>
          prev.map((r) => (r.runId === runId ? { ...r, loading: false, error: 'Failed to load' } : r))
        );
      }
    },
    [runHistory, outputsBucket, region, getCredentials]
  );

  const handleToggleExpand = useCallback(
    (runId: string) => {
      if (expandedRun === runId) {
        setExpandedRun(null);
      } else {
        setExpandedRun(runId);
        loadRunLog(runId);
      }
    },
    [expandedRun, loadRunLog]
  );

  const handleToggleStatus = useCallback(async () => {
    if (!automation || !automationId) return;
    const newStatus = automation.status === 'active' ? 'paused' : 'active';
    try {
      setActionLoading('status');
      const updated = await ScheduleService.update(numaPut, automationId, { status: newStatus });
      setAutomation((prev) => (prev ? { ...prev, status: newStatus } : prev));
      // Reactivating an event trigger while at-budget: lambda returns a
      // triggerWarning. Update succeeded — schedule is active again — but
      // surface the advisory so the user knows fires won't run until reset.
      if (updated.triggerWarning) {
        const w = updated.triggerWarning;
        const who = w.scope === 'company' ? 'your company is' : 'you are';
        setNotice(
          `Reactivated. Heads up: ${who} at the monthly trigger budget cap (${w.current}/${w.limit}). ` +
            `It won't fire until the budget resets on the 1st. Past usage from deleted/paused triggers ` +
            `stays counted, so removing existing triggers won't refund this month — ask an admin to ` +
            `raise the cap if you need budget now.`
        );
      } else {
        setNotice(null);
      }
    } catch (err) {
      console.error('[AutomationDetailPage] Failed to toggle status:', err);
    } finally {
      setActionLoading(null);
    }
  }, [automation, automationId, numaPut]);

  const handleRunNow = useCallback(async () => {
    if (!automationId) return;
    try {
      setActionLoading('run');
      await ScheduleService.run(numaPost, automationId);
      // Sequenced refetch — was setTimeout(loadRunHistory, 3000) which raced
      // with concurrent toggles. Run is queued (202) so the new row may not
      // appear immediately; user can refresh the page if they want to watch
      // the status transition.
      await loadRunHistory();
    } catch (err) {
      console.error('[AutomationDetailPage] Failed to run:', err);
    } finally {
      setActionLoading(null);
    }
  }, [automationId, numaPost, loadRunHistory]);

  const handleDelete = useCallback(async () => {
    if (!automationId) return;
    try {
      await ScheduleService.delete(numaDelete, automationId);
      navigate('/automations');
    } catch (err) {
      console.error('[AutomationDetailPage] Failed to delete:', err);
    }
  }, [automationId, numaDelete, navigate]);

  const handleDownloadArtifact = useCallback(
    async (conversationId: string, userId: string, artifact: string) => {
      if (!outputsBucket || !region || !getCredentials) return;
      try {
        const key = `numa-chat/${conversationId}/${userId}/outputs/${artifact}`;
        await downloadFileFromS3(key, outputsBucket, region, getCredentials, artifact);
      } catch (err) {
        console.error('[AutomationDetailPage] Failed to download artifact:', err);
      }
    },
    [outputsBucket, region, getCredentials]
  );

  const isEventTrigger = automation?.triggerType === 'event';
  // Narrowed views per source. Each branch's render block uses the matching one.
  const gmailTrigger = automation?.trigger?.source === 'gmail' ? automation.trigger : undefined;
  const pipedreamTrigger = automation?.trigger?.source === 'pipedream' ? automation.trigger : undefined;
  const pipedreamSummary = pipedreamTrigger
    ? summarizePipedreamTrigger(pipedreamTrigger.app_slug, pipedreamTrigger.component_id, t)
    : null;

  // Health check for Pipedream-trigger automations. Runs once on load and
  // surfaces a reconnect banner when the underlying account is missing or
  // marked unhealthy by Pipedream.
  useEffect(() => {
    if (!pipedreamTrigger) {
      setPipedreamHealthState('unknown');
      return;
    }
    let cancelled = false;
    let externalUserId = '';
    try {
      externalUserId = PipedreamProxyService.deriveExternalUserId(
        user as Parameters<typeof PipedreamProxyService.deriveExternalUserId>[0]
      );
    } catch {
      return;
    }
    PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId)
      .then((status) => {
        if (cancelled) return;
        const conn = status.connections.find((c) => c.app_name === pipedreamTrigger.app_slug);
        const healthy = conn?.status === 'connected' && conn.healthy !== false;
        setPipedreamHealthState(healthy ? 'healthy' : 'unhealthy');
      })
      .catch(() => {
        if (!cancelled) setPipedreamHealthState('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, [pipedreamTrigger, user, lambdaClient]);
  const scheduleDescription = automation && !isEventTrigger ? describeCronExpression(automation.cronExpression) : '';
  const nextRuns = useMemo(() => {
    if (!automation || isEventTrigger || automation.status !== 'active' || !automation.cronExpression) return [];
    try {
      return getNextRunTimes(automation.cronExpression, automation.timezone, 3);
    } catch {
      return [];
    }
  }, [automation, isEventTrigger]);

  const derivedStatus = automation ? getDerivedAutomationStatus(automation) : 'active';

  // Run stats
  const runStats = useMemo(() => {
    const loadedRuns = runHistory.filter((r) => r.log);
    if (loadedRuns.length === 0) return null;
    const success = loadedRuns.filter(
      (r) => !r.log?.error && (!r.log?.agentStatus || r.log.agentStatus.status === 'success')
    ).length;
    const failed = loadedRuns.filter((r) => r.log?.error || r.log?.agentStatus?.status === 'failed').length;
    return { total: runHistory.length, success, failed };
  }, [runHistory]);

  // Output status for workflow diagram
  const outputStatus = useMemo(() => {
    if (!automation?.lastRunEpoch) return 'pending';
    if (automation.lastError || automation.lastStatus === 'failed') return 'failed';
    return 'success';
  }, [automation]);

  if (loading) {
    return (
      <LayoutDashboard>
        <div className="d-flex justify-content-center align-items-center py-5">
          <Spinner animation="border" size="sm" className="me-2" />
          {t('page.loading')}
        </div>
      </LayoutDashboard>
    );
  }

  if (error || !automation) {
    return (
      <LayoutDashboard>
        <Container fluid className="px-4 py-4">
          <Alert variant="danger">{error || t('errors.load')}</Alert>
          <Button variant="outline-secondary" onClick={() => navigate('/automations')}>
            <ArrowLeft size={14} className="me-1" />
            {t('actions.backToList')}
          </Button>
        </Container>
      </LayoutDashboard>
    );
  }

  const isActive = automation.status === 'active';
  const displayName = automation.label || automation.agentTitle || t('detail.title');
  const isAdminCrossUser = Boolean(
    automation.userId && currentUserSub && automation.userId !== currentUserSub && isCurrentUserAdmin
  );

  return (
    <LayoutDashboard>
      <PageHeader
        title={displayName}
        subtitle={
          <span className="d-flex align-items-center gap-2">
            <Badge bg={automationStatusBadgeVariant(derivedStatus)}>{t(`status.${derivedStatus}`)}</Badge>
            {agent?.title || automation.agentTitle || ''}
          </span>
        }
        icon={{
          element: <Zap />,
          backgroundColor: brandPrimaryColor,
          color: brandPrimaryContrast,
        }}
        actions={
          <Button variant="outline-secondary" size="sm" onClick={() => navigate('/automations')}>
            <ArrowLeft size={14} className="me-1" />
            {t('actions.backToList')}
          </Button>
        }
      />

      <Container fluid className="px-4 py-3">
        {/* Defensive admin-cross-user banner. The list endpoint is owner-
            scoped server-side so non-admins can never see another user's
            schedule here, but if an admin lands on a non-owned schedule via
            a future cross-user fetch (or a shared URL) we want to hide
            owner-only actions explicitly rather than relying on the lambda
            to reject them. */}
        {isAdminCrossUser && (
          <Alert variant="info" className="mb-4 d-flex align-items-start gap-2">
            <i className="bi bi-info-circle-fill mt-1" aria-hidden="true" />
            <div>
              <div className="fw-semibold">Viewing as admin</div>
              <div className="small">
                This automation is owned by another user. Owner-only actions (Run now, Edit, Delete) are hidden — pause
                or resume from the audit panel if needed.
              </div>
            </div>
          </Alert>
        )}

        {notice && (
          <Alert variant="warning" className="mb-4" dismissible onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}

        {/* Action Buttons */}
        <Row className="mb-4">
          <Col>
            <div className="d-flex gap-2 flex-wrap">
              {/* Run Now + Edit + Delete are owner-only (admin viewing
                  someone else's schedule sees only the inactive/active
                  toggle). Run Now is also hidden for event triggers — they
                  need a real event payload to do anything useful, so a
                  synthetic-payload run isn't a useful smoke test. */}
              {!isAdminCrossUser && automation.triggerType !== 'event' && (
                <Button
                  size="sm"
                  style={{
                    backgroundColor: brandPrimaryColor,
                    borderColor: brandPrimaryColor,
                    color: brandPrimaryContrast,
                  }}
                  onClick={handleRunNow}
                  disabled={actionLoading === 'run'}
                >
                  {actionLoading === 'run' ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-1" /> {t('actions.running')}
                    </>
                  ) : (
                    <>
                      <Play size={14} className="me-1" /> {t('actions.runNow')}
                    </>
                  )}
                </Button>
              )}
              {!isAdminCrossUser && (
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={() => navigate(`/automations/${automationId}/edit`)}
                >
                  <Pencil size={14} className="me-1" />
                  {t('actions.edit')}
                </Button>
              )}
              {(automation.status === 'active' || automation.status === 'paused') && (
                <Button
                  variant={isActive ? 'outline-warning' : 'outline-success'}
                  size="sm"
                  onClick={handleToggleStatus}
                  disabled={actionLoading === 'status'}
                >
                  {isActive ? <Pause size={14} className="me-1" /> : <Play size={14} className="me-1" />}
                  {isActive ? t('actions.pause') : t('actions.resume')}
                </Button>
              )}
              {!isAdminCrossUser && (
                <Button variant="outline-danger" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                  <Trash2 size={14} className="me-1" />
                  {t('actions.delete')}
                </Button>
              )}
            </div>
          </Col>
        </Row>

        {pipedreamTrigger && pipedreamHealthState === 'unhealthy' && (
          <Row className="mb-3">
            <Col>
              <PipedreamUnhealthyBanner appSlug={pipedreamTrigger.app_slug} />
            </Col>
          </Row>
        )}

        {/* Workflow Diagram */}
        <Row className="mb-4">
          <Col>
            <Card className="border-0 shadow-sm" style={{ borderRadius: 12 }}>
              <Card.Body className="py-4 px-5">
                <div className="workflow-diagram">
                  {/* Trigger Node */}
                  <div className="workflow-diagram-node">
                    <div className="workflow-diagram-node__icon workflow-diagram-node__icon--trigger">
                      {isEventTrigger ? <Zap size={22} /> : <Clock size={22} />}
                    </div>
                    <div className="workflow-diagram-node__label">
                      {isEventTrigger ? t('pipeline.trigger') : t('pipeline.schedule')}
                    </div>
                    {isEventTrigger ? (
                      <>
                        {pipedreamSummary ? (
                          <>
                            <div className="workflow-diagram-node__detail d-flex align-items-center gap-1 justify-content-center">
                              {pipedreamSummary.iconSrc ? (
                                <img src={pipedreamSummary.iconSrc} alt="" width={14} height={14} />
                              ) : (
                                <i className={`${pipedreamSummary.fallbackIcon} small`} />
                              )}
                              {pipedreamSummary.appLabel}
                            </div>
                            <div className="workflow-diagram-node__sub">{pipedreamSummary.triggerLabel}</div>
                          </>
                        ) : (
                          <>
                            <div className="workflow-diagram-node__detail">{t('list.triggerEmail')}</div>
                            {automation.trigger?.source === 'gmail' && automation.trigger.filters.length > 0 && (
                              <div className="workflow-diagram-node__sub">
                                {t('list.filterCount', { count: automation.trigger.filters.length })}
                              </div>
                            )}
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="workflow-diagram-node__detail">{scheduleDescription || '\u2014'}</div>
                        <div className="workflow-diagram-node__sub">{automation.timezone}</div>
                        {nextRuns.length > 0 && (
                          <div className="workflow-diagram-node__sub" style={{ color: brandPrimaryColor }}>
                            {t('detail.overview.nextRun')}:{' '}
                            {nextRuns[0].toLocaleString(
                              undefined,
                              automation.timezone ? { timeZone: automation.timezone } : undefined
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Connector */}
                  <div className="workflow-diagram-connector">
                    <div className="workflow-diagram-connector__line" />
                  </div>

                  {/* Agent Node */}
                  <div className="workflow-diagram-node">
                    <div className="workflow-diagram-node__icon workflow-diagram-node__icon--agent">
                      <Bot size={22} />
                    </div>
                    <div className="workflow-diagram-node__label">{t('pipeline.agent')}</div>
                    <div className="workflow-diagram-node__detail d-flex align-items-center gap-2 justify-content-center">
                      <AgentAvatar agent={agent ?? undefined} size={22} />
                      <span>{agent?.title || automation.agentTitle || '\u2014'}</span>
                    </div>
                    {automation.promptText && (
                      <div className="workflow-diagram-node__sub text-truncate" style={{ maxWidth: 200 }}>
                        <FileText size={10} className="me-1" />
                        {automation.promptText.length > 60
                          ? automation.promptText.slice(0, 60) + '...'
                          : automation.promptText}
                      </div>
                    )}
                  </div>

                  {/* Connector */}
                  <div className="workflow-diagram-connector">
                    <div className="workflow-diagram-connector__line" />
                  </div>

                  {/* Output Node */}
                  <div className="workflow-diagram-node">
                    <div className={`workflow-diagram-node__icon workflow-diagram-node__icon--output ${outputStatus}`}>
                      {outputStatus === 'success' ? (
                        <CheckCircle2 size={22} />
                      ) : outputStatus === 'failed' ? (
                        <XCircle size={22} />
                      ) : (
                        <CircleDot size={22} />
                      )}
                    </div>
                    <div className="workflow-diagram-node__label">{t('card.lastRun')}</div>
                    <div className="workflow-diagram-node__detail">
                      {formatTimestamp(automation.lastRunEpoch, automation.timezone)}
                    </div>
                    {automation.lastRunEpoch && (
                      <div className="workflow-diagram-node__sub">{formatRelativeTime(automation.lastRunEpoch)}</div>
                    )}
                    <div className="workflow-diagram-node__sub">
                      {automation.totalRuns || 0} {t('runs.title').toLowerCase().replace('all ', '')}
                      {automation.maxRuns ? ` / ${automation.maxRuns}` : ''}
                    </div>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Schedule + Instructions detail row */}
        <Row className="mb-4 g-3">
          <Col lg={6}>
            <Card className="h-100 border-0 shadow-sm" style={{ borderRadius: 12 }}>
              <Card.Header className="bg-transparent border-bottom fw-medium">
                {isEventTrigger ? t('detail.overview.triggerDetails') : t('detail.overview.scheduleDetails')}
              </Card.Header>
              <Card.Body>
                <dl className="row mb-0">
                  {isEventTrigger ? (
                    <>
                      <dt className="col-sm-4 text-muted small">{t('detail.overview.source')}</dt>
                      <dd className="col-sm-8">
                        {pipedreamSummary ? (
                          <div className="d-flex align-items-center gap-2">
                            {pipedreamSummary.iconSrc ? (
                              <img src={pipedreamSummary.iconSrc} alt="" width={16} height={16} />
                            ) : (
                              <i className={pipedreamSummary.fallbackIcon} />
                            )}
                            <span>{pipedreamSummary.combined}</span>
                          </div>
                        ) : (
                          <div className="d-flex align-items-center gap-1">
                            <Mail size={14} />
                            {t('trigger.event.builder.sourceGmail')}
                          </div>
                        )}
                      </dd>

                      {pipedreamTrigger && pipedreamSummary?.trigger ? (
                        <PipedreamPropsDetail
                          trigger={pipedreamTrigger}
                          forcedPropNames={Object.keys(pipedreamSummary.trigger.restraints.forced_props)}
                        />
                      ) : null}

                      <dt className="col-sm-4 text-muted small">{t('detail.overview.filters')}</dt>
                      <dd className="col-sm-8">
                        {gmailTrigger && gmailTrigger.filters.length > 0 ? (
                          <div className="d-flex flex-column gap-1">
                            {gmailTrigger.filters.map((f, i) => (
                              <div key={i} className="small">
                                {t(`trigger.event.builder.fields.${f.field}`)} {t(`trigger.event.builder.ops.${f.op}`)}{' '}
                                &quot;{f.value}&quot;
                              </div>
                            ))}
                          </div>
                        ) : (
                          '\u2014'
                        )}
                      </dd>

                      {gmailTrigger && gmailTrigger.filters.length > 1 && (
                        <>
                          <dt className="col-sm-4 text-muted small">{t('detail.overview.filterLogic')}</dt>
                          <dd className="col-sm-8">
                            {gmailTrigger.filter_logic === 'any'
                              ? t('trigger.event.builder.matchAny')
                              : t('trigger.event.builder.matchAll')}
                          </dd>
                        </>
                      )}

                      <dt className="col-sm-4 text-muted small">{t('detail.overview.emailContext')}</dt>
                      <dd className="col-sm-8">
                        {gmailTrigger?.include_email_context !== false
                          ? t('detail.overview.emailEnabled')
                          : t('detail.overview.emailDisabled')}
                      </dd>
                    </>
                  ) : (
                    <>
                      <dt className="col-sm-4 text-muted small">{t('detail.overview.frequency')}</dt>
                      <dd className="col-sm-8">{scheduleDescription || '\u2014'}</dd>

                      <dt className="col-sm-4 text-muted small">{t('detail.overview.timezone')}</dt>
                      <dd className="col-sm-8">{automation.timezone || '\u2014'}</dd>

                      <dt className="col-sm-4 text-muted small">{t('detail.overview.nextRun')}</dt>
                      <dd className="col-sm-8">
                        {nextRuns.length > 0
                          ? nextRuns[0].toLocaleString(
                              undefined,
                              automation.timezone ? { timeZone: automation.timezone } : undefined
                            )
                          : '\u2014'}
                      </dd>
                    </>
                  )}

                  <dt className="col-sm-4 text-muted small">{t('detail.overview.created')}</dt>
                  <dd className="col-sm-8">
                    {automation.createdAt ? formatTimestamp(automation.createdAt, automation.timezone) : '\u2014'}
                  </dd>

                  <dt className="col-sm-4 text-muted small">{t('detail.overview.emailNotifications')}</dt>
                  <dd className="col-sm-8">
                    {automation.emailNotifications ? (
                      <div className="d-flex align-items-start gap-1">
                        <Mail size={14} className="text-success mt-1 flex-shrink-0" />
                        <div>
                          <span className="text-success fw-medium">{t('detail.overview.emailEnabled')}</span>
                          {(automation.notificationEmails?.length
                            ? automation.notificationEmails
                            : automation.notificationEmail
                              ? [automation.notificationEmail]
                              : []
                          ).map((email) => (
                            <div key={email} className="text-muted small">
                              {email}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted">{t('detail.overview.emailDisabled')}</span>
                    )}
                  </dd>
                </dl>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={6}>
            <Card className="h-100 border-0 shadow-sm" style={{ borderRadius: 12 }}>
              <Card.Header className="bg-transparent border-bottom fw-medium">
                {t('detail.overview.instructionsTitle')}
              </Card.Header>
              <Card.Body>
                <p className="mb-0" style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem' }}>
                  {automation.promptText || t('detail.overview.instructionsEmpty')}
                </p>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Run History */}
        <Row>
          <Col>
            <Card className="border-0 shadow-sm" style={{ borderRadius: 12 }}>
              <Card.Header className="d-flex justify-content-between align-items-center bg-transparent border-bottom">
                <span className="fw-medium">{t('detail.history.title')}</span>
                <Button variant="outline-secondary" size="sm" onClick={loadRunHistory} disabled={runHistoryLoading}>
                  {runHistoryLoading ? (
                    <Spinner animation="border" size="sm" />
                  ) : (
                    <RefreshCw size={14} className="me-1" />
                  )}
                  {!runHistoryLoading && t('runs.refresh')}
                </Button>
              </Card.Header>

              {/* Run stats summary */}
              {runStats && (
                <div className="d-flex align-items-center gap-3 px-3 py-2 border-bottom bg-light small">
                  <span className="fw-bold">{t('detail.history.total', { count: runStats.total })}</span>
                  <span className="text-success">{t('detail.history.succeeded', { count: runStats.success })}</span>
                  {runStats.failed > 0 && (
                    <span className="text-danger">{t('detail.history.failed', { count: runStats.failed })}</span>
                  )}
                  <span className="text-muted ms-auto">
                    {runStats.total > 0 ? Math.round((runStats.success / runStats.total) * 100) : 0}
                    {'% '}
                    {t('detail.history.successRate')}
                  </span>
                </div>
              )}

              <Card.Body className="p-0">
                {runHistoryLoading && runHistory.length === 0 ? (
                  <div className="text-center py-5">
                    <Spinner animation="border" size="sm" />
                    <p className="mt-3 text-muted">{t('detail.history.loading')}</p>
                  </div>
                ) : runHistory.length === 0 ? (
                  <div className="text-center py-5">
                    <Clock size={36} className="text-muted mb-2" />
                    <p className="text-muted">{t('detail.history.empty')}</p>
                  </div>
                ) : (
                  <Table hover responsive className="mb-0 automation-runs-feed">
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}></th>
                        <th>{t('detail.history.started')}</th>
                        <th>{t('detail.history.completed')}</th>
                        <th>{t('detail.history.duration')}</th>
                        <th>{t('detail.history.status')}</th>
                        <th style={{ width: 48 }} aria-label="" />
                      </tr>
                    </thead>
                    <tbody>
                      {runHistory.map((run) => (
                        <React.Fragment key={run.runId}>
                          <tr
                            onClick={() => handleToggleExpand(run.runId)}
                            role="button"
                            className={expandedRun === run.runId ? 'table-active' : ''}
                          >
                            <td className="align-middle text-center">
                              {expandedRun === run.runId ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </td>
                            <td className="align-middle">
                              {run.log?.startedAt
                                ? new Date(run.log.startedAt).toLocaleString(
                                    undefined,
                                    automation.timezone ? { timeZone: automation.timezone } : undefined
                                  )
                                : '\u2014'}
                            </td>
                            <td className="align-middle">
                              {run.log?.completedAt
                                ? new Date(run.log.completedAt).toLocaleString(
                                    undefined,
                                    automation.timezone ? { timeZone: automation.timezone } : undefined
                                  )
                                : '\u2014'}
                            </td>
                            <td className="align-middle text-muted small">
                              {formatDuration(run.log?.startedAt, run.log?.completedAt) || '\u2014'}
                            </td>
                            <td className="align-middle">
                              {run.loading ? (
                                <Spinner animation="border" size="sm" />
                              ) : run.error ? (
                                <Badge bg="danger">{tAgents('scheduling.details.runHistory.status.error')}</Badge>
                              ) : run.log?.error ? (
                                <Badge bg="danger">{tAgents('scheduling.details.runHistory.status.failed')}</Badge>
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
                                  {run.log.agentStatus.status}
                                </Badge>
                              ) : run.log ? (
                                <Badge bg="success">{tAgents('scheduling.details.runHistory.status.completed')}</Badge>
                              ) : (
                                <Badge bg="secondary">{'\u2014'}</Badge>
                              )}
                            </td>
                            <td className="align-middle text-end">
                              <OpenInChatButton conversationId={run.log?.conversationId} variant="icon" />
                            </td>
                          </tr>
                          {expandedRun === run.runId && (
                            <tr>
                              <td
                                colSpan={6}
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
                                    schedulePrompt={automation.promptText}
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
      </Container>

      {/* Delete confirmation modal */}
      <Modal show={showDeleteConfirm} onHide={() => setShowDeleteConfirm(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{t('actions.delete')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>{t('confirm.delete', { name: automation.label || automation.agentTitle || '' })}</p>
          <p className="text-muted small">{t('confirm.deleteDescription')}</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
            {t('builder.nav.cancel')}
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            {t('actions.delete')}
          </Button>
        </Modal.Footer>
      </Modal>
    </LayoutDashboard>
  );
};

export default AutomationDetailPage;
