/* eslint-disable i18next/no-literal-string -- admin-only scheduling UI; translations deferred to round-2 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Table, Badge, Button, Spinner, Alert, Pagination } from 'react-bootstrap';
import { ScheduleService, type TriggerLoadSummary } from '../../Services/ScheduleService';
import type { AgentSchedule } from '../../types/agentSchedules';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { extractApiError } from '../../utils/extractApiError';
import { AdminScheduleOverviewModal } from './AdminScheduleOverviewModal';
import { ConfirmModal } from '../Ops/Modals/ConfirmModal';

const TRIGGER_PAGE_SIZE = 25;

type Props = {
  /** Pre-fetched tenant schedule list — passed in from `ScheduleAuditPanel` so we don't fetch twice. */
  schedules: AgentSchedule[];
};

/** Tiny inline SVG bar chart for daily fire counts. No deps — keeps bundle clean. */
const DailyFiresChart: React.FC<{ daily: Array<{ date: string; total: number }>; cap?: number }> = ({ daily, cap }) => {
  if (!daily.length) return <div className="text-muted small">No data</div>;
  const maxValue = Math.max(...daily.map((d) => d.total), cap ? cap / 30 : 1, 1);
  const barWidth = 100 / daily.length;
  // Cap line: average daily run rate that would saturate the monthly cap.
  // Useful as a "you're sustainably above this" mark.
  const capPerDay = cap ? cap / 30 : null;
  // Wrapper has no fixed height — SVG owns its 100px and the axis row sits
  // below in normal flow. Previously the wrapper was clamped to 100px so
  // the date axis collapsed onto the next caption.
  return (
    <div style={{ width: '100%' }}>
      <svg width="100%" height="100" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ display: 'block' }}>
        {capPerDay && capPerDay <= maxValue && (
          <line
            x1="0"
            x2="100"
            y1={100 - (capPerDay / maxValue) * 100}
            y2={100 - (capPerDay / maxValue) * 100}
            stroke="#dc3545"
            strokeWidth="0.5"
            strokeDasharray="1,1"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {daily.map((d, i) => {
          const h = (d.total / maxValue) * 100;
          const fill = capPerDay && d.total > capPerDay ? '#dc3545' : '#0d6efd';
          return (
            <rect
              key={d.date}
              x={i * barWidth + barWidth * 0.1}
              y={100 - h}
              width={barWidth * 0.8}
              height={h}
              fill={fill}
              opacity={0.85}
            >
              <title>{`${d.date}: ${d.total}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="d-flex justify-content-between text-muted mt-1" style={{ fontSize: 10 }}>
        <span>{daily[0]?.date.slice(5)}</span>
        <span>{daily[daily.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
};

const STATUS_BADGES: Record<AgentSchedule['status'], { variant: string; label: string }> = {
  active: { variant: 'success', label: 'Active' },
  paused: { variant: 'warning', label: 'Paused' },
  pending_approval: { variant: 'info', label: 'Pending approval' },
  deleted: { variant: 'secondary', label: 'Deleted' },
  admin_locked: { variant: 'danger', label: 'Locked by admin' },
};

/**
 * Triggers tab of the admin audit panel. Shows tenant-wide event-trigger
 * actuals: monthly count, last-30-day chart, projection vs cap, per-schedule
 * table with lock/unlock controls.
 */
export const TriggerAuditPanel: React.FC<Props> = ({ schedules }) => {
  const { numaGet, numaPut } = useNumaRequest();

  const [summary, setSummary] = useState<TriggerLoadSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // Cross-user View routes through the admin overview modal — same pattern
  // as `ScheduleAuditPanel`. Direct-navigation to `/scheduling/:id` was the
  // broken View → 404 flow that the modal was created to replace; the
  // Triggers tab kept the bad path until this fix.
  const [overviewTarget, setOverviewTarget] = useState<AgentSchedule | null>(null);
  const [pendingAction, setPendingAction] = useState<{ kind: 'lock' | 'unlock'; schedule: AgentSchedule } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await ScheduleService.triggerLoad(numaGet, 30);
      setSummary(data);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load trigger usage'));
    } finally {
      setLoading(false);
    }
  }, [numaGet]);

  useEffect(() => {
    void load();
  }, [load]);

  const triggerSchedules = useMemo(
    () => schedules.filter((s) => s.triggerType === 'event' && s.status !== 'deleted'),
    [schedules]
  );

  // Pagination — same shape as the Schedules tab.
  const totalPages = Math.max(1, Math.ceil(triggerSchedules.length / TRIGGER_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * TRIGGER_PAGE_SIZE;
  const pageRows = triggerSchedules.slice(pageStart, pageStart + TRIGGER_PAGE_SIZE);
  // Reset to page 1 if the underlying list shrinks (e.g. after a lock action).
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const handleLock = (s: AgentSchedule) => setPendingAction({ kind: 'lock', schedule: s });
  const handleUnlock = (s: AgentSchedule) => setPendingAction({ kind: 'unlock', schedule: s });

  const handleConfirmedAction = async (reason: string): Promise<void> => {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    const { kind, schedule: s } = action;
    setActionInProgress(s.scheduleId);
    try {
      if (kind === 'lock') {
        await ScheduleService.adminLock(numaPut, s.scheduleId, reason || undefined);
      } else if (kind === 'unlock') {
        await ScheduleService.adminUnlock(numaPut, s.scheduleId);
      }
      await load();
    } catch (err) {
      setError(extractApiError(err, kind === 'lock' ? 'Lock failed' : 'Unlock failed'));
    } finally {
      setActionInProgress(null);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-4">
        <Spinner animation="border" />
      </div>
    );
  }

  const projectedPct =
    summary && summary.caps.company > 0 ? (summary.projectedMonthRuns / summary.caps.company) * 100 : 0;
  const monthPct = summary && summary.caps.company > 0 ? (summary.monthRuns / summary.caps.company) * 100 : 0;
  const overWarning = summary ? projectedPct >= summary.warningThresholdPercent : false;

  return (
    <>
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {summary && (
        <>
          {overWarning && (
            <Alert variant={projectedPct >= 100 ? 'danger' : 'warning'} className="mb-3">
              <strong>{projectedPct >= 100 ? 'Projected over cap' : 'Approaching cap'}:</strong> 30-day projection of{' '}
              <strong>{summary.projectedMonthRuns.toLocaleString()}</strong> trigger fires would reach{' '}
              <strong>{Math.round(projectedPct)}%</strong> of the company cap ({summary.caps.company.toLocaleString()}).
              Warning fires above {summary.warningThresholdPercent}%.
            </Alert>
          )}

          <div className="mb-3">
            <div className="d-flex justify-content-between align-items-baseline mb-1">
              <strong className="small">Tenant trigger usage — {summary.monthKey}</strong>
              <span className="small text-muted">
                {summary.monthRuns.toLocaleString()} actual · {summary.projectedMonthRuns.toLocaleString()} projected /{' '}
                {summary.caps.company.toLocaleString()} cap
              </span>
            </div>
            {/* Plain styled divs instead of <ProgressBar> — global
                `.progress-bar { height: 16px }` rule in _components.scss
                breaks rounded corners on custom heights. */}
            {(() => {
              const actualPct = Math.min(monthPct, 100);
              const projectionDelta = Math.max(0, Math.min(projectedPct, 100) - actualPct);
              const actualColor =
                monthPct >= 100 ? '#dc3545' : monthPct >= summary.warningThresholdPercent ? '#f59e0b' : '#10b981';
              return (
                <div
                  role="progressbar"
                  aria-valuenow={Math.min(projectedPct, 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Tenant trigger usage"
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: 'rgba(0, 0, 0, 0.08)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: `${actualPct}%`,
                      height: '100%',
                      backgroundColor: actualColor,
                      borderRadius: 5,
                      transition: 'width 0.3s ease',
                    }}
                  />
                  {projectionDelta > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: `${actualPct}%`,
                        width: `${projectionDelta}%`,
                        height: '100%',
                        backgroundColor: '#adb5bd',
                        borderRadius: 5,
                        transition: 'left 0.3s ease, width 0.3s ease',
                      }}
                    />
                  )}
                </div>
              );
            })()}
            <div className="small text-muted mt-1">
              Solid = used so far. Faded = remaining projection from last-30-day rate.
            </div>
          </div>

          <div className="mb-4">
            <div className="small fw-semibold mb-1">Daily fires (last {summary.windowDays} days)</div>
            <DailyFiresChart daily={summary.dailyTotals} cap={summary.caps.company} />
            <div className="small text-muted">
              Red dashed line: per-day rate that saturates the {summary.caps.company.toLocaleString()}/mo cap.
            </div>
          </div>
        </>
      )}

      <div className="table-responsive">
        <Table hover size="sm" className="mb-0">
          <thead>
            <tr>
              <th>Trigger / agent</th>
              <th>Owner</th>
              <th>Source</th>
              <th>Month runs</th>
              <th>Projected</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted py-3">
                  No event-trigger automations in this tenant.
                </td>
              </tr>
            )}
            {pageRows.map((s) => {
              const badge = STATUS_BADGES[s.status];
              const ownerLabel = s.userId ? `${s.userId.slice(0, 8)}…` : '—';
              // Per-row counts are PER-SCHEDULE — fall back gracefully on
              // older lambda responses that don't ship `perSchedule`. Using
              // `perUser[s.userId]` (the previous behaviour) was wrong: it
              // showed the owner's total across all their triggers, so every
              // row from the same user displayed identical numbers regardless
              // of whether that individual trigger had ever fired.
              const scheduleSummary = summary?.perSchedule?.[s.scheduleId];
              const isPending = s.status === 'pending_approval';
              const isAdminLocked = s.status === 'admin_locked';
              const inProgress = actionInProgress === s.scheduleId;
              // Show this trigger's projected fires as a % of the user cap —
              // helps admins spot the worst-offender trigger inside a busy
              // user's bucket. Tenant-level / user-level rollups live in the
              // header bar above.
              const triggerPctOfUserCap =
                summary && summary.caps.user > 0 && scheduleSummary
                  ? (scheduleSummary.projectedMonthRuns / summary.caps.user) * 100
                  : 0;
              const triggerOver = summary && triggerPctOfUserCap >= summary.warningThresholdPercent;
              return (
                <tr key={s.scheduleId} className={isAdminLocked || s.status === 'paused' ? 'text-muted' : undefined}>
                  <td>
                    <div className="fw-semibold">{s.label || s.agentTitle || s.agentId}</div>
                    {s.label && s.agentTitle && <div className="small text-muted">{s.agentTitle}</div>}
                  </td>
                  <td className="small text-muted">{ownerLabel}</td>
                  <td className="small">{s.trigger?.source ?? '—'}</td>
                  <td>{scheduleSummary?.monthRuns?.toLocaleString() ?? '0'}</td>
                  <td>
                    {scheduleSummary?.projectedMonthRuns?.toLocaleString() ?? '0'}
                    {triggerOver && (
                      <Badge bg={triggerPctOfUserCap >= 100 ? 'danger' : 'warning'} className="ms-1">
                        {Math.round(triggerPctOfUserCap)}%
                      </Badge>
                    )}
                  </td>
                  <td>
                    <Badge bg={badge.variant}>{badge.label}</Badge>
                  </td>
                  <td>
                    <div className="d-flex gap-1 flex-wrap">
                      {!isPending && (
                        <Button size="sm" variant="outline-secondary" onClick={() => setOverviewTarget(s)}>
                          View
                        </Button>
                      )}
                      {!isPending && !isAdminLocked && (
                        <Button size="sm" variant="outline-danger" disabled={inProgress} onClick={() => handleLock(s)}>
                          Lock
                        </Button>
                      )}
                      {isAdminLocked && (
                        <Button size="sm" variant="warning" disabled={inProgress} onClick={() => handleUnlock(s)}>
                          {inProgress ? <Spinner size="sm" animation="border" /> : 'Unlock'}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      {triggerSchedules.length > TRIGGER_PAGE_SIZE && (
        <div className="d-flex justify-content-between align-items-center mt-3">
          <div className="small text-muted">
            Showing {pageStart + 1}–{Math.min(pageStart + TRIGGER_PAGE_SIZE, triggerSchedules.length)} of{' '}
            {triggerSchedules.length}
          </div>
          <Pagination size="sm" className="mb-0">
            <Pagination.First disabled={safePage === 1} onClick={() => setPage(1)} />
            <Pagination.Prev disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} />
            <Pagination.Item active>{safePage}</Pagination.Item>
            <Pagination.Next
              disabled={safePage === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            />
            <Pagination.Last disabled={safePage === totalPages} onClick={() => setPage(totalPages)} />
            <span className="ms-2 small text-muted align-self-center">of {totalPages}</span>
          </Pagination>
        </div>
      )}

      {/* Admin overview modal — opened from View. Owner-aware actions live
          inside; we don't need to thread an owner lookup here because the
          modal falls back to schedule.userId when the user record isn't
          provided. */}
      <AdminScheduleOverviewModal
        schedule={overviewTarget}
        onHide={() => setOverviewTarget(null)}
        onActionComplete={() => {
          setOverviewTarget(null);
          void load();
        }}
      />

      <ConfirmModal
        show={pendingAction?.kind === 'lock'}
        onHide={() => setPendingAction(null)}
        onConfirm={handleConfirmedAction}
        title="Lock trigger"
        message={
          pendingAction?.schedule ? (
            <>
              Lock{' '}
              <strong>
                {pendingAction.schedule.label || pendingAction.schedule.agentTitle || pendingAction.schedule.agentId}
              </strong>
              ? The owner will see it but cannot reactivate it themselves.
            </>
          ) : null
        }
        confirmLabel="Lock"
        variant="danger"
        suppressDeleteWarning
        reasonInput={{
          label: 'Reason (optional, shown to the owner)',
          placeholder: 'e.g. High volume causing customer-account quota issues — please reach out before reactivating.',
          maxLength: 500,
        }}
      />

      <ConfirmModal
        show={pendingAction?.kind === 'unlock'}
        onHide={() => setPendingAction(null)}
        onConfirm={handleConfirmedAction}
        title="Unlock trigger"
        message={
          pendingAction?.schedule ? (
            <>
              Unlock{' '}
              <strong>
                {pendingAction.schedule.label || pendingAction.schedule.agentTitle || pendingAction.schedule.agentId}
              </strong>
              ? It will return to <em>paused</em>.
            </>
          ) : null
        }
        confirmLabel="Unlock"
        variant="warning"
        suppressDeleteWarning
      />
    </>
  );
};
