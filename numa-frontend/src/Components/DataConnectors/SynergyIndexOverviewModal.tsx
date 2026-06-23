/**
 * Admin index-overview for the cross-job Synergy → knowledge-base crawler.
 *
 * Opened from SynergyKbSyncPanel (admin + crawler-deployed gated). Fetches
 * GET /api/data-connectors/synergy/index-overview and renders:
 *   - a charts row: a donut (jobs by status) + an overall-coverage bar;
 *   - a summary chip row (now incl. overall coverage);
 *   - a per-job table with a Coverage progress-bar column;
 *   - a manual "index this job id" form that POSTs job_ids to sync-now.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Form, Modal, ProgressBar, Spinner, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { SynergyDataConnectorService } from '../../Services/SynergyDataConnectorService';
import type { SynergyIndexJob, SynergyIndexOverview } from '../../types/synergySync';

type Props = {
  show: boolean;
  onHide: () => void;
};

// Brand-ish status palette: green=indexed, amber=in-progress, grey=pending,
// light-grey=not-started (jobs in Synergy not yet enumerated by a sync).
const STATUS_COLOR = {
  indexed: '#16a34a',
  inProgress: '#f59e0b',
  pending: '#94a3b8',
  notStarted: '#e2e8f0',
} as const;

/** "2h ago" style relative time; em-dash for empty/invalid input. */
const relativeTime = (iso: string | undefined | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return formatDistanceToNow(date, { addSuffix: true });
};

/** Coverage % for a job (indexed/total), guarded against /0. null when total is unknown (0). */
const jobCoverage = (job: SynergyIndexJob): number | null => {
  if (!job.files_total || job.files_total <= 0) return null;
  return Math.min(100, Math.round((job.indexed_files / job.files_total) * 100));
};

/** Three-way status bucket used by the donut and the per-job status badge. */
const jobBucket = (job: SynergyIndexJob): 'indexed' | 'inProgress' | 'pending' => {
  if (job.status === 'done') return 'indexed';
  if (job.indexed_files > 0) return 'inProgress';
  return 'pending';
};

export const SynergyIndexOverviewModal = ({ show, onHide }: Props) => {
  const { t } = useTranslation('integrations');
  const { numaGet, numaPost } = useNumaRequest();

  const [data, setData] = useState<SynergyIndexOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual "index this job id" form state.
  const [jobIdInput, setJobIdInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [indexNotice, setIndexNotice] = useState<string | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  // Post-index auto-refresh timer — cleared on unmount so load() never fires on
  // an unmounted modal (the modal can be closed within the 4s window).
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    []
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const overview = await SynergyDataConnectorService.getIndexOverview(numaGet);
      setData(overview);
    } catch {
      setError(t('dataConnectors.synergy.indexOverview.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [numaGet, t]);

  useEffect(() => {
    if (show) void load();
  }, [show, load]);

  const summary = data?.summary;
  const jobs = useMemo(() => data?.jobs ?? [], [data]);
  const lastRun = summary?.last_run ?? null;

  // Donut data: jobs by status, measured against the FULL Synergy job count so
  // the "not yet started" majority is visible (1 in progress out of ~15,000).
  const statusData = useMemo(() => {
    const counts = { indexed: 0, inProgress: 0, pending: 0 };
    for (const job of jobs) counts[jobBucket(job)] += 1;
    const totalSynergy = summary?.total_synergy_jobs ?? 0;
    const notStarted = totalSynergy > jobs.length ? totalSynergy - jobs.length : 0;
    return [
      { key: 'indexed', label: t('dataConnectors.synergy.indexOverview.statusIndexed'), value: counts.indexed },
      {
        key: 'inProgress',
        label: t('dataConnectors.synergy.indexOverview.statusInProgress'),
        value: counts.inProgress,
      },
      { key: 'pending', label: t('dataConnectors.synergy.indexOverview.statusPending'), value: counts.pending },
      {
        key: 'notStarted',
        label: t('dataConnectors.synergy.indexOverview.statusNotStarted'),
        value: notStarted,
      },
    ].filter((s) => s.value > 0);
  }, [jobs, summary, t]);
  const statusTotal = statusData.reduce((a, s) => a + s.value, 0);

  // PRIMARY metric: jobs indexed vs the TOTAL jobs in Synergy (live denominator).
  // total_synergy_jobs is null when the live count is unavailable (degrade to '—').
  const totalSynergyJobs = summary?.total_synergy_jobs ?? null;
  const indexedJobs = summary?.indexed_jobs ?? 0;
  const jobPct =
    totalSynergyJobs && totalSynergyJobs > 0 ? Math.min(100, Math.round((indexedJobs / totalSynergyJobs) * 100)) : 0;

  // Secondary: file-level coverage across already-touched jobs (guard /0 — when
  // files_total is still being enumerated we show indexed-only, never "/0 · 0%").
  const totalIndexed = summary?.total_indexed_files ?? 0;
  const totalFiles = summary?.files_total ?? 0;
  const overallPct = totalFiles > 0 ? Math.min(100, Math.round((totalIndexed / totalFiles) * 100)) : 0;

  const submitIndexJob = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = jobIdInput.trim();
    if (!id) return;
    setSubmitting(true);
    setIndexNotice(null);
    setIndexError(null);
    try {
      await SynergyDataConnectorService.indexJob(numaPost, [id]);
      setIndexNotice(t('dataConnectors.synergy.indexOverview.indexJobQueued', { jobId: id }));
      setJobIdInput('');
      // Give the coordinator a moment to register the run, then refresh the
      // overview. Tracked in a ref so it's cancelled if the modal closes first.
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void load(), 4000);
    } catch {
      setIndexError(t('dataConnectors.synergy.indexOverview.indexJobFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} size="xl" centered scrollable>
      <Modal.Header closeButton>
        <Modal.Title className="h6 mb-0">{t('dataConnectors.synergy.indexOverview.title')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading ? (
          <div className="d-flex align-items-center gap-2 text-muted small py-3">
            <Spinner size="sm" />
            {t('dataConnectors.synergy.indexOverview.loading')}
          </div>
        ) : error ? (
          <Alert variant="danger" className="py-2 small mb-0">
            {error}
          </Alert>
        ) : (
          <>
            {/* Manual index control */}
            <Form onSubmit={submitIndexJob} className="mb-3">
              <Form.Label className="small fw-semibold mb-1">
                {t('dataConnectors.synergy.indexOverview.indexJobLabel')}
              </Form.Label>
              <div className="d-flex gap-2 align-items-start">
                <Form.Control
                  size="sm"
                  value={jobIdInput}
                  onChange={(e) => setJobIdInput(e.target.value)}
                  placeholder={t('dataConnectors.synergy.indexOverview.indexJobPlaceholder')}
                  disabled={submitting}
                  style={{ maxWidth: '16rem' }}
                />
                <Button type="submit" size="sm" variant="primary" disabled={submitting || !jobIdInput.trim()}>
                  {submitting ? (
                    <>
                      <Spinner size="sm" className="me-1" />
                      {t('dataConnectors.synergy.indexOverview.indexJobSubmitting')}
                    </>
                  ) : (
                    t('dataConnectors.synergy.indexOverview.indexJobButton')
                  )}
                </Button>
              </div>
              {indexNotice && (
                <Alert variant="success" className="py-2 small mt-2 mb-0">
                  {indexNotice}
                </Alert>
              )}
              {indexError && (
                <Alert variant="danger" className="py-2 small mt-2 mb-0">
                  {indexError}
                </Alert>
              )}
            </Form>

            {/* Charts row */}
            {jobs.length > 0 && (
              <div className="row g-3 mb-3">
                <div className="col-12 col-md-6">
                  <div className="border rounded p-2 h-100">
                    <div className="small fw-semibold text-muted mb-1">
                      {t('dataConnectors.synergy.indexOverview.chartJobsTitle')}
                    </div>
                    {statusTotal === 0 ? (
                      <p className="text-muted small mb-0 py-3 text-center">
                        {t('dataConnectors.synergy.indexOverview.chartEmpty')}
                      </p>
                    ) : (
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie
                            data={statusData}
                            dataKey="value"
                            nameKey="label"
                            cx="50%"
                            cy="50%"
                            outerRadius={72}
                            innerRadius={42}
                            paddingAngle={2}
                            stroke="#ffffff"
                            strokeWidth={2}
                          >
                            {statusData.map((s) => (
                              <Cell key={s.key} fill={STATUS_COLOR[s.key as keyof typeof STATUS_COLOR]} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e4e4e7', fontSize: 12 }} />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
                <div className="col-12 col-md-6">
                  <div className="border rounded p-2 h-100 d-flex flex-column">
                    <div className="small fw-semibold text-muted mb-2">
                      {t('dataConnectors.synergy.indexOverview.chartCoverageTitle')}
                    </div>
                    <div className="my-auto">
                      <ProgressBar now={jobPct} variant="success" style={{ height: '1.5rem' }} label={`${jobPct}%`} />
                      <div className="small fw-semibold mt-2">
                        {t('dataConnectors.synergy.indexOverview.jobsProgress', {
                          indexed: indexedJobs.toLocaleString(),
                          total: totalSynergyJobs != null ? totalSynergyJobs.toLocaleString() : '—',
                          pct: jobPct,
                        })}
                      </div>
                      <div className="small text-muted mt-1">
                        {totalFiles > 0
                          ? t('dataConnectors.synergy.indexOverview.filesProgress', {
                              indexed: totalIndexed.toLocaleString(),
                              total: totalFiles.toLocaleString(),
                              pct: overallPct,
                            })
                          : t('dataConnectors.synergy.indexOverview.filesIndexedCounting', {
                              indexed: totalIndexed.toLocaleString(),
                            })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {summary && (
              <div className="d-flex flex-wrap gap-2 mb-3">
                <Badge bg="primary" className="fw-semibold py-2 px-3">
                  {summary.total_synergy_jobs != null
                    ? t('dataConnectors.synergy.indexOverview.chipJobsToIndex', {
                        count: summary.total_synergy_jobs,
                      })
                    : t('dataConnectors.synergy.indexOverview.chipJobsToIndexUnknown')}
                </Badge>
                <Badge bg="light" text="dark" className="border fw-normal py-2 px-3">
                  {t('dataConnectors.synergy.indexOverview.chipIndexedJobs', { count: summary.indexed_jobs })}
                </Badge>
                <Badge bg="light" text="dark" className="border fw-normal py-2 px-3">
                  {t('dataConnectors.synergy.indexOverview.chipJobsEnumerated', { count: summary.total_jobs })}
                </Badge>
                <Badge bg="light" text="dark" className="border fw-normal py-2 px-3">
                  {t('dataConnectors.synergy.indexOverview.chipPendingJobs', { count: summary.pending_jobs })}
                </Badge>
                <Badge bg="light" text="dark" className="border fw-normal py-2 px-3">
                  {t('dataConnectors.synergy.indexOverview.chipIndexedFiles', {
                    count: summary.total_indexed_files,
                  })}
                </Badge>
                <Badge bg="light" text="dark" className="border fw-normal py-2 px-3">
                  {summary.sync_enabled
                    ? t('dataConnectors.synergy.indexOverview.chipSyncOn', { hours: summary.frequency_hours })
                    : t('dataConnectors.synergy.indexOverview.chipSyncOff')}
                </Badge>
                <Badge bg="light" text="dark" className="border fw-normal py-2 px-3">
                  {lastRun
                    ? t('dataConnectors.synergy.indexOverview.chipLastRun', {
                        status: lastRun.status || '—',
                        when: relativeTime(lastRun.completed_at || lastRun.started_at),
                      })
                    : t('dataConnectors.synergy.indexOverview.chipNeverRun')}
                </Badge>
              </div>
            )}

            {data?.truncated && (
              <Alert variant="warning" className="py-2 small">
                {t('dataConnectors.synergy.indexOverview.truncated')}
              </Alert>
            )}

            {jobs.length === 0 ? (
              <p className="text-muted small mb-0 py-2">{t('dataConnectors.synergy.indexOverview.empty')}</p>
            ) : (
              <Table responsive hover size="sm" className="mb-0 align-middle">
                <thead>
                  <tr>
                    <th>{t('dataConnectors.synergy.indexOverview.colJobName')}</th>
                    <th>{t('dataConnectors.synergy.indexOverview.colPath')}</th>
                    <th>{t('dataConnectors.synergy.indexOverview.colStatus')}</th>
                    <th className="text-end">{t('dataConnectors.synergy.indexOverview.colFiles')}</th>
                    <th style={{ minWidth: '11rem' }}>{t('dataConnectors.synergy.indexOverview.colCoverage')}</th>
                    <th>{t('dataConnectors.synergy.indexOverview.colLastCrawled')}</th>
                    <th className="text-end">{t('dataConnectors.synergy.indexOverview.colAccess')}</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const bucket = jobBucket(job);
                    const pct = jobCoverage(job);
                    return (
                      <tr key={job.job_id}>
                        <td>{job.name || job.job_id}</td>
                        <td
                          className="text-muted text-truncate"
                          style={{ maxWidth: '16rem' }}
                          title={job.path || undefined}
                        >
                          {job.path || '—'}
                        </td>
                        <td>
                          {bucket === 'indexed' ? (
                            <Badge bg="success">{t('dataConnectors.synergy.indexOverview.statusIndexed')}</Badge>
                          ) : bucket === 'inProgress' ? (
                            <Badge bg="warning" text="dark">
                              {t('dataConnectors.synergy.indexOverview.statusInProgress')}
                            </Badge>
                          ) : (
                            <Badge bg="secondary">{t('dataConnectors.synergy.indexOverview.statusPending')}</Badge>
                          )}
                        </td>
                        <td className="text-end">{job.indexed_files}</td>
                        <td>
                          {pct === null ? (
                            <span className="text-muted">
                              {t('dataConnectors.synergy.indexOverview.coverageUnknown')}
                            </span>
                          ) : (
                            <div>
                              <ProgressBar
                                now={pct}
                                variant={pct >= 100 ? 'success' : 'info'}
                                style={{ height: '0.5rem' }}
                              />
                              <div className="small text-muted mt-1">
                                {t('dataConnectors.synergy.indexOverview.coverageCell', {
                                  indexed: job.indexed_files.toLocaleString(),
                                  total: job.files_total.toLocaleString(),
                                  pct,
                                })}
                              </div>
                            </div>
                          )}
                        </td>
                        <td title={job.last_indexed_at || undefined}>{relativeTime(job.last_indexed_at)}</td>
                        <td className="text-end">{job.allowed_users}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" size="sm" disabled={loading} onClick={() => void load()}>
          {loading ? (
            <>
              <Spinner size="sm" className="me-1" />
              {t('dataConnectors.synergy.indexOverview.loading')}
            </>
          ) : (
            t('dataConnectors.synergy.indexOverview.refresh')
          )}
        </Button>
        <Button variant="secondary" size="sm" onClick={onHide}>
          {t('dataConnectors.synergy.indexOverview.close')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
