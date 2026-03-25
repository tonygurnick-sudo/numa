import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Table, Badge, Spinner, Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, RefreshCw, Clock } from 'lucide-react';
import { AgentAvatar } from '../Agents/AgentAvatar';
import { RunHistoryExpandedRow } from '../Scheduling/RunHistoryExpandedRow';
import { useAuth } from '../../Providers/AuthProvider';
import { listObjectsInFolder, fetchFileFromS3 } from '../../utils/s3Utils';
import { formatDuration, extractUserIdFromS3Key } from '../../utils/automationUtils';
import { jwtDecode } from 'jwt-decode';
import type { AgentSchedule } from '../../types/agentSchedules';
import type { AgentSummary } from '../../types/agents';
import type { RunHistoryItem, ScheduledRunLog } from '../../types/scheduledRuns';

type FeedRunItem = RunHistoryItem & {
  automationId: string;
  automationLabel: string;
  agentTitle: string;
  agentId: string;
};

type AutomationRunsFeedProps = {
  automations: AgentSchedule[];
  agentMap: Map<string, AgentSummary>;
};

const MAX_RUNS_PER_AUTOMATION = 10;
const CACHE_KEY = 'numa_automation_runs_feed';

type CachedRun = {
  runId: string;
  s3Key: string;
  timestamp: number;
  automationId: string;
  automationLabel: string;
  agentTitle: string;
  agentId: string;
  log?: ScheduledRunLog;
  error?: string;
};

/** Get the best available time for sorting — prefer log timestamps over S3 key timestamps */
const getRunSortTime = (run: FeedRunItem): number => {
  const fromLog = run.log?.completedAt || run.log?.startedAt;
  if (fromLog) {
    const parsed = Date.parse(fromLog);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return run.timestamp?.getTime?.() ?? 0;
};

/** Get the best display time for the "Run At" column */
const getRunDisplayTime = (run: FeedRunItem): Date | null => {
  const fromLog = run.log?.startedAt || run.log?.completedAt;
  if (fromLog) {
    const parsed = Date.parse(fromLog);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  return run.timestamp ?? null;
};

const sortRuns = (runs: FeedRunItem[]): FeedRunItem[] =>
  [...runs].sort((a, b) => getRunSortTime(b) - getRunSortTime(a));

const saveToCache = (runs: FeedRunItem[]) => {
  try {
    const serializable: CachedRun[] = runs.map((r) => ({
      runId: r.runId,
      s3Key: r.s3Key,
      timestamp: r.timestamp.getTime(),
      automationId: r.automationId,
      automationLabel: r.automationLabel,
      agentTitle: r.agentTitle,
      agentId: r.agentId,
      log: r.log,
      error: r.error,
    }));
    localStorage.setItem(CACHE_KEY, JSON.stringify(serializable));
  } catch {
    /* storage full or unavailable */
  }
};

const loadFromCache = (): FeedRunItem[] => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed: CachedRun[] = JSON.parse(raw);
    return parsed.map((r) => ({
      ...r,
      timestamp: new Date(r.timestamp),
      loading: false,
    }));
  } catch {
    return [];
  }
};

export const AutomationRunsFeed = ({ automations, agentMap }: AutomationRunsFeedProps) => {
  const { t } = useTranslation('automations');
  const { t: tAgents } = useTranslation('agents');
  const { getCredentials, region: authRegion, getAccessToken } = useAuth();

  const [runs, setRuns] = useState<FeedRunItem[]>(() => loadFromCache());
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const outputsBucket = window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME') || '';
  const region = authRegion || window.sessionStorage.getItem('REGION') || '';

  // Use refs so the load function doesn't depend on changing callback identities
  const credentialsRef = useRef(getCredentials);
  credentialsRef.current = getCredentials;
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;

  const loadAllRuns = useCallback(async () => {
    if (!outputsBucket || !region || !credentialsRef.current || automations.length === 0) {
      setLoading(false);
      return;
    }
    if (loadingRef.current) return; // prevent double-calls
    loadingRef.current = true;

    try {
      setLoading(true);

      // Try to extract userId from any automation's lastRunS3Key, or fallback to token
      let userId: string | null = null;
      for (const auto of automations) {
        userId = extractUserIdFromS3Key(auto.lastRunS3Key);
        if (userId) break;
      }
      if (!userId) {
        try {
          const token = await getAccessTokenRef.current();
          if (token) {
            const decoded = jwtDecode<{ sub?: string }>(token);
            userId = decoded.sub || null;
          }
        } catch {
          /* ignore */
        }
      }
      if (!userId) return; // finally will set loading=false

      const creds = credentialsRef.current;

      // Phase 1: List all run keys for each automation in parallel
      const results = await Promise.allSettled(
        automations.map(async (auto) => {
          const prefix = `numa-chat/scheduled-runs/${userId}/${auto.scheduleId}/`;
          const keys = await listObjectsInFolder(prefix, outputsBucket, region, creds);
          const jsonKeys = keys.filter((k: string) => k.endsWith('.json'));

          return jsonKeys
            .map((key: string) => {
              const parts = key.split('/');
              const fileName = parts[parts.length - 1] || '';
              const runId = fileName.replace('.json', '');
              const tsMatch = runId.match(/^(\d+)/);
              const timestamp = tsMatch ? new Date(parseInt(tsMatch[1], 10)) : new Date();
              return {
                runId,
                s3Key: key,
                timestamp,
                automationId: auto.scheduleId,
                automationLabel: auto.label || auto.agentTitle || '',
                agentTitle: auto.agentTitle || '',
                agentId: auto.agentId,
              } as FeedRunItem;
            })
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, MAX_RUNS_PER_AUTOMATION);
        })
      );

      const allRuns: FeedRunItem[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          allRuns.push(...result.value);
        }
      }

      // Show the run list immediately (phase 2 loads logs in background)
      setRuns(sortRuns(allRuns));
      setLoading(false);

      // Phase 2: Load all logs in parallel, then sort once when done
      const logResults = await Promise.allSettled(
        allRuns.map(async (item) => {
          const blob = await fetchFileFromS3(item.s3Key, outputsBucket, region, creds);
          const text = await blob.text();
          const log = JSON.parse(text) as ScheduledRunLog;
          return { runId: item.runId, log };
        })
      );

      const logMap = new Map<string, ScheduledRunLog>();
      for (const result of logResults) {
        if (result.status === 'fulfilled' && result.value.log) {
          logMap.set(result.value.runId, result.value.log);
        }
      }

      const withLogs = allRuns.map((r) => {
        const log = logMap.get(r.runId);
        return log ? { ...r, log, loading: false } : { ...r, loading: false };
      });
      const sorted = sortRuns(withLogs);
      saveToCache(sorted);
      setRuns(sorted);
    } catch (err) {
      console.error('[RunsFeed] Failed to load runs:', err);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
    // Only re-run when automations change — credentials accessed via refs
  }, [automations, outputsBucket, region]);

  // Load once when automations change — credentials accessed via refs (stable)
  useEffect(() => {
    if (automations.length > 0) {
      loadAllRuns();
    }
  }, [loadAllRuns]);

  const loadRunLog = useCallback(
    async (runId: string) => {
      const run = runs.find((r) => r.runId === runId);
      if (!run || run.log || run.loading) return;

      setRuns((prev) => prev.map((r) => (r.runId === runId ? { ...r, loading: true } : r)));

      try {
        const blob = await fetchFileFromS3(run.s3Key, outputsBucket, region, getCredentials);
        const text = await blob.text();
        const log = JSON.parse(text) as ScheduledRunLog;
        setRuns((prev) => {
          const next = prev.map((r) => (r.runId === runId ? { ...r, log, loading: false } : r));
          const sorted = sortRuns(next);
          saveToCache(sorted);
          return sorted;
        });
      } catch {
        setRuns((prev) => prev.map((r) => (r.runId === runId ? { ...r, loading: false, error: 'Failed to load' } : r)));
      }
    },
    [runs, outputsBucket, region, getCredentials]
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

  if (loading && runs.length === 0) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" size="sm" />
        <p className="mt-3 text-muted">{t('runs.loading')}</p>
      </div>
    );
  }

  if (!loading && runs.length === 0) {
    return (
      <div className="text-center py-5">
        <Clock size={36} className="text-muted mb-2" />
        <p className="text-muted">{t('runs.noRuns')}</p>
      </div>
    );
  }

  return (
    <div className="automation-runs-feed">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h6 className="mb-0">{t('runs.title')}</h6>
        <Button variant="outline-secondary" size="sm" onClick={loadAllRuns} disabled={loading}>
          {loading ? <Spinner animation="border" size="sm" /> : <RefreshCw size={14} />}
        </Button>
      </div>

      <Table hover className="mb-0">
        <thead>
          <tr>
            <th style={{ width: 40 }}></th>
            <th>{t('runs.automation')}</th>
            <th>{t('runs.agent')}</th>
            <th>{t('runs.runAt')}</th>
            <th>{t('runs.duration')}</th>
            <th>{t('runs.status')}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const agent = agentMap.get(run.agentId);
            const duration = formatDuration(run.log?.startedAt, run.log?.completedAt);
            const displayTime = getRunDisplayTime(run);
            return (
              <React.Fragment key={`${run.automationId}-${run.runId}`}>
                <tr
                  onClick={() => handleToggleExpand(run.runId)}
                  role="button"
                  className={expandedRun === run.runId ? 'table-active' : ''}
                >
                  <td className="align-middle text-center">
                    {expandedRun === run.runId ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </td>
                  <td className="align-middle">
                    <span className="fw-medium">{run.automationLabel}</span>
                  </td>
                  <td className="align-middle">
                    <div className="d-flex align-items-center gap-2">
                      <AgentAvatar agent={agent ?? undefined} size={20} />
                      <span className="small">{agent?.title || run.agentTitle}</span>
                    </div>
                  </td>
                  <td className="align-middle small">
                    {displayTime
                      ? displayTime.toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })
                      : '\u2014'}
                  </td>
                  <td className="align-middle text-muted small">{duration || '\u2014'}</td>
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
                </tr>
                {expandedRun === run.runId && (
                  <tr>
                    <td colSpan={6} className="p-3 bg-light">
                      <RunHistoryExpandedRow run={run} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
};

export default AutomationRunsFeed;
