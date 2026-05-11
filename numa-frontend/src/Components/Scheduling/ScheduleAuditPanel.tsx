/* eslint-disable i18next/no-literal-string -- admin-only scheduling UI; translations deferred to round-2 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Table, Badge, Button, Spinner, Alert, ButtonGroup, Pagination, Nav, Tab, Modal } from 'react-bootstrap';

/** Rows per page in the audit tables. Same value used for Schedules + Triggers. */
const AUDIT_PAGE_SIZE = 25;
import { useTranslation } from 'react-i18next';
import { ScheduleService, type QuotaSummary } from '../../Services/ScheduleService';
import { UsersService, type WorkspaceUser } from '../../Services/UsersService';
import type { AgentSchedule } from '../../types/agentSchedules';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { describeCronExpression } from '../../utils/cronUtils';
import { TriggerAuditPanel } from './TriggerAuditPanel';
import { AdminScheduleOverviewModal } from './AdminScheduleOverviewModal';
import { ConfirmModal } from '../Ops/Modals/ConfirmModal';
import { getFlag } from '../../utils/featureFlags';
import { extractApiError } from '../../utils/extractApiError';

type SortKey = 'agent' | 'owner' | 'projected' | 'lastRun' | 'status';

const STATUS_BADGES: Record<AgentSchedule['status'], { variant: string; label: string }> = {
  active: { variant: 'success', label: 'Active' },
  paused: { variant: 'warning', label: 'Paused' },
  pending_approval: { variant: 'info', label: 'Pending approval' },
  deleted: { variant: 'secondary', label: 'Deleted' },
  admin_locked: { variant: 'danger', label: 'Locked by admin' },
};

/**
 * Admin tenant-wide schedule audit. Lists every schedule in the tenant with
 * the data needed to spot quota waste and to action pending_approval items.
 *
 * Loaded behind an admin gate in `Settings.tsx > Scheduling tab`.
 */
export const ScheduleAuditPanel: React.FC = () => {
  const { t } = useTranslation('agents');
  const { numaGet, numaPost, numaPut } = useNumaRequest();

  const [schedules, setSchedules] = useState<AgentSchedule[]>([]);
  const [quotas, setQuotas] = useState<QuotaSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastErrorStatus, setLastErrorStatus] = useState<number | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending_approval' | 'active'>('all');
  // The schedule the admin is about to approve. Setting this opens the
  // confirmation modal, which spells out the company-quota promotion before
  // the action goes through.
  const [approvalTarget, setApprovalTarget] = useState<AgentSchedule | null>(null);
  // Schedule shown in the admin-overview modal (opened via the View button).
  // Replaces the earlier nav-to-detail-page flow which dumped admins into
  // the owner's edit page with broken data.
  const [overviewTarget, setOverviewTarget] = useState<AgentSchedule | null>(null);
  // Confirm-modal state replaces the prior `window.confirm` / `window.prompt`
  // calls. Holds the schedule + the action kind so a single ConfirmModal can
  // dispatch to the right handler.
  const [pendingAction, setPendingAction] = useState<{
    kind: 'lock' | 'unlock' | 'reject';
    schedule: AgentSchedule;
  } | null>(null);
  // Workspace users — fetched once for owner-name resolution. Schedules carry
  // only `user_id` (Cognito sub); we look up display name / email here so the
  // overview modal and audit table can show something readable.
  const [usersBySub, setUsersBySub] = useState<Record<string, WorkspaceUser>>({});
  const [sortKey, setSortKey] = useState<SortKey>('projected');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  /**
   * Auto-retries once on 403 — Settings.tsx fires many panels in parallel and
   * one of them can race the AuthProvider's background token refresh. After
   * the first 403 we wait briefly and try again before showing an error.
   */
  const load = useCallback(
    async (attempt = 1): Promise<void> => {
      if (attempt === 1) {
        setLoading(true);
        setError(null);
        setLastErrorStatus(null);
      }
      try {
        const [list, summary] = await Promise.all([
          ScheduleService.listTenant(numaGet),
          ScheduleService.quotaSummary(numaGet).catch(() => null), // non-fatal
        ]);
        setSchedules(list);
        setQuotas(summary);
        setError(null);
        setLastErrorStatus(null);
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status ?? null;
        if (status === 403 && attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          return load(attempt + 1);
        }
        setLastErrorStatus(status);
        setError(
          status === 403
            ? t('scheduling.audit.loadError403', {
                defaultValue:
                  "Couldn't load tenant schedules — your session may have a stale token. Click Retry, or refresh the page.",
              })
            : t('scheduling.audit.loadError', { defaultValue: 'Failed to load tenant schedules' })
        );

        console.error('ScheduleAuditPanel load failed', err);
      } finally {
        setLoading(false);
      }
    },
    [numaGet, t]
  );

  const handleRetry = () => void load(1);

  useEffect(() => {
    void load();
  }, [load]);

  // Workspace users — fetched once for owner-name resolution in the
  // overview modal. Non-fatal: if the call fails the modal just falls
  // back to email / sub.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await UsersService.list(numaGet);
        if (cancelled) return;
        const map: Record<string, WorkspaceUser> = {};
        for (const u of list) {
          if (u.sub) map[u.sub] = u;
        }
        setUsersBySub(map);
      } catch (err) {
        console.warn('[ScheduleAuditPanel] Failed to load users for owner resolution', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numaGet]);

  const handleApprove = async (s: AgentSchedule) => {
    setActionInProgress(s.scheduleId);
    try {
      await ScheduleService.approve(numaPost, s.scheduleId);
      await load();
    } catch (err) {
      setError(extractApiError(err, 'Approve failed'));
    } finally {
      setActionInProgress(null);
    }
  };

  // Action triggers — open the ConfirmModal with the right kind. The actual
  // service call happens in `handleConfirm` once the user clicks confirm.
  const handleReject = (s: AgentSchedule) => setPendingAction({ kind: 'reject', schedule: s });
  const handleLock = (s: AgentSchedule) => setPendingAction({ kind: 'lock', schedule: s });
  const handleUnlock = (s: AgentSchedule) => setPendingAction({ kind: 'unlock', schedule: s });

  // Single confirm handler. The ConfirmModal passes the reason text back via
  // its onConfirm — we forward to adminLock when present, ignore for the
  // others.
  const handleConfirmedAction = async (reason: string): Promise<void> => {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    const { kind, schedule: s } = action;
    setActionInProgress(s.scheduleId);
    try {
      if (kind === 'reject') {
        await ScheduleService.reject(numaPost, s.scheduleId);
      } else if (kind === 'lock') {
        await ScheduleService.adminLock(numaPut, s.scheduleId, reason || undefined);
      } else if (kind === 'unlock') {
        await ScheduleService.adminUnlock(numaPut, s.scheduleId);
      }
      await load();
    } catch (err) {
      const fallback = kind === 'reject' ? 'Reject failed' : kind === 'lock' ? 'Lock failed' : 'Unlock failed';
      setError(extractApiError(err, fallback));
    } finally {
      setActionInProgress(null);
    }
  };

  // Sub-flag of SCHEDULING — when false the Triggers tab and its row count
  // are hidden, leaving a single-pane Schedules view.
  const triggersEnabled = getFlag('EVENT_TRIGGERS');

  // The Schedules tab covers cron schedules only. Event triggers live in the
  // Triggers tab — different model (actuals, not projected) and different
  // table columns.
  const cronSchedules = useMemo(() => schedules.filter((s) => (s.triggerType ?? 'cron') === 'cron'), [schedules]);

  const filtered = useMemo(() => {
    return cronSchedules.filter((s) => {
      if (filterStatus === 'all') return s.status !== 'deleted';
      return s.status === filterStatus;
    });
  }, [cronSchedules, filterStatus]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'agent':
          return dir * (a.agentTitle ?? '').localeCompare(b.agentTitle ?? '');
        case 'owner':
          return dir * (a.userId ?? '').localeCompare(b.userId ?? '');
        case 'projected':
          return dir * ((a.projectedRunsPerMonth ?? 0) - (b.projectedRunsPerMonth ?? 0));
        case 'lastRun':
          return dir * ((a.lastRunEpoch ?? 0) - (b.lastRunEpoch ?? 0));
        case 'status':
          return dir * a.status.localeCompare(b.status);
        default:
          return 0;
      }
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const onHeaderClick = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'projected' || key === 'lastRun' ? 'desc' : 'asc');
    }
  };

  // IMPORTANT: cap totals are tenant-wide and must be computed from the
  // UNFILTERED `cronSchedules`, not the filtered `sorted` slice. When admin
  // applies the status filter (e.g. "show only pending_approval"), `sorted`
  // shrinks — using it here would show "0 active runs" and incorrectly
  // disable the approve-modal's cap-exceeded guard, leaving the user to
  // discover the issue via a server-side 409.
  const totalActiveProjected = useMemo(
    () =>
      cronSchedules.filter((s) => s.status === 'active').reduce((sum, s) => sum + (s.projectedRunsPerMonth ?? 0), 0),
    [cronSchedules]
  );

  // Parked = paused or admin_locked — projected runs that *would* fire if reactivated.
  // Surfacing these helps admins understand the latent load if everyone resumed at once.
  const totalParkedProjected = useMemo(
    () =>
      cronSchedules
        .filter((s) => s.status === 'paused' || s.status === 'admin_locked')
        .reduce((sum, s) => sum + (s.projectedRunsPerMonth ?? 0), 0),
    [cronSchedules]
  );

  const companyCap = quotas?.quotas?.maxRunsPerCompanyPerMonth ?? 0;
  const activePctOfCap = companyCap > 0 ? Math.round((totalActiveProjected / companyCap) * 100) : 0;
  const parkedPctOfCap = companyCap > 0 ? Math.round((totalParkedProjected / companyCap) * 100) : 0;

  const pendingCount = useMemo(() => schedules.filter((s) => s.status === 'pending_approval').length, [schedules]);

  // Tiny helper for per-row "% of company cap" badges.
  const pctOfCap = (projected: number | undefined): string => {
    if (!projected || companyCap <= 0) return '—';
    return `${Math.round((projected / companyCap) * 100)}%`;
  };

  // Pagination: slice the sorted list. Reset to page 1 whenever the filter,
  // sort key, or status changes so we never end up "looking at" an empty page.
  const totalPages = Math.max(1, Math.ceil(sorted.length / AUDIT_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * AUDIT_PAGE_SIZE;
  const pageRows = sorted.slice(pageStart, pageStart + AUDIT_PAGE_SIZE);
  useEffect(() => {
    setPage(1);
  }, [filterStatus, sortKey, sortDir]);

  if (loading) {
    return (
      <div className="text-center py-4">
        <Spinner animation="border" />
      </div>
    );
  }

  return (
    <Tab.Container defaultActiveKey="schedules">
      {error && (
        <Alert variant={lastErrorStatus === 403 ? 'warning' : 'danger'} dismissible onClose={() => setError(null)}>
          <div className="d-flex align-items-center justify-content-between gap-2">
            <span>{error}</span>
            <Button size="sm" variant="outline-secondary" onClick={handleRetry} disabled={loading}>
              {loading ? <Spinner size="sm" animation="border" /> : t('common.retry', { defaultValue: 'Retry' })}
            </Button>
          </div>
        </Alert>
      )}

      {/* Sub-flag of SCHEDULING — gates the Triggers tab here AND the trigger
          quota fields in ScheduleQuotaAdminForm. When false, the audit panel
          collapses to a single Schedules view with no tab switcher. */}
      <Nav variant="tabs" className="mb-3 audit-tabs">
        <Nav.Item>
          <Nav.Link eventKey="schedules">
            Schedules ({cronSchedules.filter((s) => s.status !== 'deleted').length})
          </Nav.Link>
        </Nav.Item>
        {triggersEnabled && (
          <Nav.Item>
            <Nav.Link eventKey="triggers">
              Triggers ({schedules.filter((s) => s.triggerType === 'event' && s.status !== 'deleted').length})
            </Nav.Link>
          </Nav.Item>
        )}
      </Nav>

      <Tab.Content>
        {triggersEnabled && (
          <Tab.Pane eventKey="triggers">
            <TriggerAuditPanel schedules={schedules} />
          </Tab.Pane>
        )}
        <Tab.Pane eventKey="schedules">
          <div className="d-flex justify-content-between align-items-end mb-3 flex-wrap gap-2">
            <div className="flex-grow-1" style={{ minWidth: 320 }}>
              <div className="settings-section-title">
                {t('scheduling.audit.title', { defaultValue: 'Automations audit' })}
              </div>
              <div className="small text-muted mb-1">
                {totalActiveProjected.toLocaleString()} projected runs/mo from{' '}
                {sorted.filter((s) => s.status === 'active').length} active{' '}
                {totalParkedProjected > 0 && (
                  <>
                    ·{' '}
                    <span className="text-secondary">
                      {totalParkedProjected.toLocaleString()} parked (paused / locked)
                    </span>
                  </>
                )}
                {pendingCount > 0 && <> · {pendingCount} pending approval</>}
              </div>
              {companyCap > 0 && (
                <div className="d-flex align-items-center gap-2">
                  {/* Bar shows ACTUAL budget utilisation (active schedules only).
                      Parked load is already called out in the description text
                      above. Stacking parked on top here used to push the visual
                      fill to 100% even when only a small fraction was in use —
                      misleading admins into thinking the tenant was at cap. */}
                  {/* Plain styled div rather than <ProgressBar> — global
                      `.progress-bar { height: 16px }` rule overflows our
                      8-px-tall track and breaks rounded corners. Uses
                      position: relative + absolute fill with matching
                      border-radius so the track corners render cleanly
                      regardless of flex parent context. */}
                  <div
                    role="progressbar"
                    aria-valuenow={Math.min(activePctOfCap, 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    style={{
                      position: 'relative',
                      flexGrow: 1,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: 'rgba(0, 0, 0, 0.08)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: `${Math.min(activePctOfCap, 100)}%`,
                        height: '100%',
                        backgroundColor:
                          activePctOfCap >= 100 ? '#dc3545' : activePctOfCap >= 80 ? '#f59e0b' : '#10b981',
                        borderRadius: 4,
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                  <span className="small text-muted" style={{ whiteSpace: 'nowrap' }}>
                    {activePctOfCap}% / {companyCap.toLocaleString()} cap
                  </span>
                </div>
              )}
              {/* Surface latent overflow when reactivating everything would
                  exceed the cap — the part the old bar was awkwardly trying
                  to convey. Clear, separate, non-blocking. */}
              {companyCap > 0 && activePctOfCap + parkedPctOfCap > 100 && (
                <div
                  className="small text-warning mt-1"
                  title="Resuming all paused / admin-locked schedules would push the tenant over the company cap."
                >
                  <i className="bi bi-exclamation-triangle me-1" />
                  Resuming all parked schedules would push to {activePctOfCap + parkedPctOfCap}% of cap.
                </div>
              )}
            </div>
            <ButtonGroup>
              <Button
                variant={filterStatus === 'all' ? 'primary' : 'outline-secondary'}
                size="sm"
                onClick={() => setFilterStatus('all')}
              >
                All
              </Button>
              <Button
                variant={filterStatus === 'pending_approval' ? 'primary' : 'outline-secondary'}
                size="sm"
                onClick={() => setFilterStatus('pending_approval')}
              >
                Pending approval {pendingCount > 0 && <Badge bg="info">{pendingCount}</Badge>}
              </Button>
              <Button
                variant={filterStatus === 'active' ? 'primary' : 'outline-secondary'}
                size="sm"
                onClick={() => setFilterStatus('active')}
              >
                Active
              </Button>
            </ButtonGroup>
          </div>

          <div className="table-responsive">
            <Table hover size="sm" className="mb-0 audit-table">
              <thead className="audit-table__head">
                <tr>
                  <th className="ps-3" style={{ cursor: 'pointer' }} onClick={() => onHeaderClick('agent')}>
                    Label / agent
                  </th>
                  <th style={{ cursor: 'pointer' }} onClick={() => onHeaderClick('owner')}>
                    Owner
                  </th>
                  <th>Cadence</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => onHeaderClick('projected')}>
                    Projected runs/mo {companyCap > 0 && <span className="small text-muted">(% of cap)</span>}
                  </th>
                  <th style={{ cursor: 'pointer' }} onClick={() => onHeaderClick('lastRun')}>
                    Last run
                  </th>
                  <th style={{ cursor: 'pointer' }} onClick={() => onHeaderClick('status')}>
                    Status
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-muted py-3">
                      {t('scheduling.audit.empty', { defaultValue: 'No schedules match the current filter.' })}
                    </td>
                  </tr>
                )}
                {pageRows.map((s) => {
                  const badge = STATUS_BADGES[s.status];
                  const cadence = s.cronExpression
                    ? describeCronExpression(s.cronExpression)
                    : s.triggerType === 'event'
                      ? 'Event trigger'
                      : '—';
                  const lastRun = s.lastRunEpoch ? new Date(s.lastRunEpoch).toLocaleString() : '—';
                  const ownerLabel = s.userId ? `${s.userId.slice(0, 8)}…` : '—';
                  const isPending = s.status === 'pending_approval';
                  const isAdminLocked = s.status === 'admin_locked';
                  const isParked = s.status === 'paused' || isAdminLocked;
                  const inProgress = actionInProgress === s.scheduleId;
                  return (
                    <tr key={s.scheduleId} className={isParked ? 'text-muted' : undefined}>
                      <td className="ps-3">
                        <div className="fw-semibold">{s.label || s.agentTitle || s.agentId}</div>
                        {s.label && s.agentTitle && <div className="small text-muted">{s.agentTitle}</div>}
                      </td>
                      <td className="text-muted small">{ownerLabel}</td>
                      <td className="small">{cadence}</td>
                      <td>
                        {/* Show projected for active AND parked schedules so admins can see latent load. */}
                        <span className={isParked ? 'fw-normal' : 'fw-semibold'}>
                          {s.projectedRunsPerMonth?.toLocaleString() ?? '—'}
                        </span>
                        {s.projectedRunsPerMonth != null && companyCap > 0 && (
                          <span className="small text-muted ms-1">({pctOfCap(s.projectedRunsPerMonth)})</span>
                        )}
                        {isParked && <div className="small text-muted">parked</div>}
                      </td>
                      <td className="small text-muted">
                        {lastRun}
                        {s.lastStatus && <span className="ms-1">· {s.lastStatus}</span>}
                      </td>
                      <td>
                        <Badge bg={badge.variant}>{badge.label}</Badge>
                      </td>
                      <td>
                        <div className="d-flex gap-1 flex-wrap">
                          {isPending && (
                            <>
                              <Button
                                size="sm"
                                variant="outline-success"
                                disabled={inProgress}
                                onClick={() => setApprovalTarget(s)}
                              >
                                {inProgress ? <Spinner size="sm" animation="border" /> : 'Approve'}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline-danger"
                                disabled={inProgress}
                                onClick={() => handleReject(s)}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {!isPending && (
                            <Button size="sm" variant="outline-secondary" onClick={() => setOverviewTarget(s)}>
                              View
                            </Button>
                          )}
                          {/* Admin lock controls — visible on any non-pending row.
                          Locked schedules show Unlock; everything else shows Lock. */}
                          {!isPending && !isAdminLocked && s.status !== 'deleted' && (
                            <Button
                              size="sm"
                              variant="outline-danger"
                              disabled={inProgress}
                              onClick={() => handleLock(s)}
                              title="Lock this schedule so the owner cannot reactivate it"
                            >
                              Lock
                            </Button>
                          )}
                          {isAdminLocked && (
                            <Button
                              size="sm"
                              variant="outline-warning"
                              disabled={inProgress}
                              onClick={() => handleUnlock(s)}
                              title="Unlock — schedule returns to paused, owner regains control"
                            >
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

          {sorted.length > AUDIT_PAGE_SIZE && (
            <div className="d-flex justify-content-between align-items-center mt-3">
              <div className="small text-muted">
                Showing {pageStart + 1}–{Math.min(pageStart + AUDIT_PAGE_SIZE, sorted.length)} of {sorted.length}
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
        </Tab.Pane>
      </Tab.Content>

      {/*
        Approve-confirmation modal. Spells out the quota-scope promotion
        explicitly so admins understand they're absorbing the schedule into
        the company budget rather than just silently letting it through.
      */}
      {/* Admin overview modal — opened from the View button on each row. */}
      <AdminScheduleOverviewModal
        schedule={overviewTarget}
        owner={overviewTarget?.userId ? usersBySub[overviewTarget.userId] : undefined}
        onHide={() => setOverviewTarget(null)}
        onActionComplete={load}
      />

      {/* Confirm modals for lock / unlock / reject — one ConfirmModal
          shared across the three actions, swapping copy + variant based on
          `pendingAction.kind`. Replaces the previous `window.confirm` /
          `window.prompt` calls (unstyled, screen-reader hostile, no input
          validation). */}
      <ConfirmModal
        show={pendingAction?.kind === 'lock'}
        onHide={() => setPendingAction(null)}
        onConfirm={handleConfirmedAction}
        title="Lock automation"
        message={
          pendingAction?.schedule ? (
            <>
              Lock{' '}
              <strong>
                {pendingAction.schedule.label || pendingAction.schedule.agentTitle || pendingAction.schedule.agentId}
              </strong>
              ? The owner will see it as locked and cannot reactivate it themselves.
            </>
          ) : null
        }
        confirmLabel="Lock"
        variant="danger"
        suppressDeleteWarning
        reasonInput={{
          label: 'Reason (optional, shown to the owner)',
          placeholder: 'e.g. Pending policy review — please reach out to me before reactivating.',
          maxLength: 500,
        }}
      />

      <ConfirmModal
        show={pendingAction?.kind === 'unlock'}
        onHide={() => setPendingAction(null)}
        onConfirm={handleConfirmedAction}
        title="Unlock automation"
        message={
          pendingAction?.schedule ? (
            <>
              Unlock{' '}
              <strong>
                {pendingAction.schedule.label || pendingAction.schedule.agentTitle || pendingAction.schedule.agentId}
              </strong>
              ? It will return to <em>paused</em>; the owner can then resume it.
            </>
          ) : null
        }
        confirmLabel="Unlock"
        variant="warning"
        suppressDeleteWarning
      />

      <ConfirmModal
        show={pendingAction?.kind === 'reject'}
        onHide={() => setPendingAction(null)}
        onConfirm={handleConfirmedAction}
        title="Reject pending automation"
        message={t('scheduling.audit.confirmReject', {
          defaultValue: 'Reject this schedule? It will be permanently removed and cannot be approved later.',
        })}
        confirmLabel="Reject"
        variant="danger"
      />

      <Modal show={!!approvalTarget} onHide={() => setApprovalTarget(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 mb-0">Approve over-cap schedule</Modal.Title>
        </Modal.Header>
        <Modal.Body className="px-3 py-3" style={{ lineHeight: 1.55 }}>
          {approvalTarget &&
            (() => {
              // Preflight company-cap check: would approving this push the
              // tenant over its monthly cap right now? If so, surface here
              // before the admin commits — much nicer than letting them click
              // Approve, hit a 409, and read the error message. The backend
              // re-runs the same check at approve time, so the only way the
              // button is enabled here but the request still fails is if
              // active load changed between modal open and click (e.g.
              // another admin approved a competing pending in parallel).
              const targetProjection = approvalTarget.projectedRunsPerMonth ?? 0;
              const projectedAfter = totalActiveProjected + targetProjection;
              const wouldExceedCap = companyCap > 0 && projectedAfter > companyCap;
              const overBy = projectedAfter - companyCap;
              return (
                <>
                  <p className="mb-2">
                    You&apos;re approving{' '}
                    <span className="fw-semibold">
                      &ldquo;{approvalTarget.label || approvalTarget.agentTitle || approvalTarget.agentId}&rdquo;
                    </span>{' '}
                    which projects to{' '}
                    <span className="fw-semibold">{targetProjection.toLocaleString()} runs/month</span> &mdash; above
                    the owner&apos;s personal cap.
                  </p>
                  {wouldExceedCap ? (
                    <Alert variant="danger" className="mb-0 px-3 py-2">
                      <div className="fw-semibold mb-1">
                        <i className="bi bi-x-circle-fill me-1" />
                        Cannot approve &mdash; would exceed the company cap
                      </div>
                      Active schedules already project to{' '}
                      <span className="fw-semibold">{totalActiveProjected.toLocaleString()}</span> runs/month. Adding{' '}
                      <span className="fw-semibold">{targetProjection.toLocaleString()}</span> would total{' '}
                      <span className="fw-semibold">{projectedAfter.toLocaleString()}</span> &mdash; over the company
                      cap of <span className="fw-semibold">{companyCap.toLocaleString()}</span> by{' '}
                      <span className="fw-semibold">{overBy.toLocaleString()}</span>. Pause or delete other active
                      schedules to free up budget, then try again.
                    </Alert>
                  ) : (
                    <Alert variant="info" className="mb-0 px-3 py-2">
                      Once approved, this schedule moves to the{' '}
                      <span className="fw-semibold">company quota bucket</span>. It will count only against the company
                      monthly cap and will{' '}
                      <span className="fw-semibold">no longer eat into the owner&apos;s personal cap</span> &mdash; so
                      they can keep creating schedules up to their own limit. The company cap is a hard ceiling and
                      admin approval can never breach it.
                    </Alert>
                  )}
                </>
              );
            })()}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" size="sm" onClick={() => setApprovalTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="success"
            size="sm"
            disabled={
              !approvalTarget ||
              actionInProgress === approvalTarget.scheduleId ||
              (companyCap > 0 && totalActiveProjected + (approvalTarget.projectedRunsPerMonth ?? 0) > companyCap)
            }
            onClick={async () => {
              if (!approvalTarget) return;
              const target = approvalTarget;
              setApprovalTarget(null);
              await handleApprove(target);
            }}
          >
            {approvalTarget && actionInProgress === approvalTarget.scheduleId ? (
              <Spinner size="sm" animation="border" />
            ) : (
              'Approve & promote to company quota'
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </Tab.Container>
  );
};
