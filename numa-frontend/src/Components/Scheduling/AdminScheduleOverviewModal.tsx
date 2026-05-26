/* eslint-disable i18next/no-literal-string -- admin-only audit panel UI; translations deferred */
import { useState } from 'react';
import { Modal, Button, Spinner, Badge, Alert } from 'react-bootstrap';
import { describeCronExpression } from '../../utils/cronUtils';
import { ScheduleService } from '../../Services/ScheduleService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import type { AgentSchedule } from '../../types/agentSchedules';
import type { WorkspaceUser } from '../../Services/UsersService';
import { extractApiError } from '../../utils/extractApiError';
import { ConfirmModal } from '../Ops/Modals/ConfirmModal';

type Props = {
  schedule: AgentSchedule | null;
  /**
   * Resolved owner record (display name + email) — looked up by the audit
   * panel from `UsersService.list`. Optional: if the lookup failed or the
   * user no longer exists, falls back to the schedule's notification email,
   * then to the raw Cognito sub.
   */
  owner?: WorkspaceUser;
  onHide: () => void;
  /**
   * Called after a successful admin action on the schedule (pause / resume /
   * lock / unlock / reject). The parent audit panel reloads so the row's
   * status / projected load is in sync.
   */
  onActionComplete: () => void | Promise<void>;
};

const fmtEpoch = (epoch?: number): string => {
  if (!epoch) return 'Never';
  const d = new Date(epoch);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const statusBadgeVariant = (status?: string): { variant: string; textClass: string; label: string } => {
  switch (status) {
    case 'active':
      return { variant: 'success', textClass: 'text-white', label: 'Active' };
    case 'paused':
      return { variant: 'secondary', textClass: 'text-white', label: 'Paused' };
    case 'pending_approval':
      return { variant: 'info', textClass: 'text-white', label: 'Pending approval' };
    case 'admin_locked':
      return { variant: 'danger', textClass: 'text-white', label: 'Admin locked' };
    case 'deleted':
      return { variant: 'dark', textClass: 'text-white', label: 'Deleted' };
    default:
      // Light bg → dark text. White-on-light would be invisible.
      return { variant: 'light', textClass: 'text-dark', label: status ?? 'Unknown' };
  }
};

/**
 * Admin overview dialog opened from the tenant audit panel. Shows a
 * read-only summary of someone else's schedule plus the admin-only actions
 * (pause / resume / lock / unlock / approve / reject). Replaces the broken
 * "navigate to /scheduling/:id" path which dumped admins into the owner's
 * detail page (with Run Now / Edit / Delete buttons that aren't theirs to
 * use).
 */
export const AdminScheduleOverviewModal: React.FC<Props> = ({ schedule, owner, onHide, onActionComplete }) => {
  const { numaPut, numaPost } = useNumaRequest();
  const [busy, setBusy] = useState<null | 'pause' | 'resume' | 'lock' | 'unlock' | 'approve' | 'reject'>(null);
  const [error, setError] = useState<string | null>(null);
  // Confirm-modal state replaces the prior `window.confirm` / `window.prompt`
  // calls. Set to the pending action when the admin clicks lock / unlock /
  // reject; cleared when they confirm or cancel.
  const [pendingConfirm, setPendingConfirm] = useState<null | 'lock' | 'unlock' | 'reject'>(null);

  if (!schedule) return null;

  const status = schedule.status ?? 'active';
  const badge = statusBadgeVariant(status);
  // Owner resolution priority: workspace-user lookup (display name + email)
  // → schedule's notification email → raw Cognito sub. Last fallback is
  // ugly but at least uniquely identifies the user when a name lookup
  // failed.
  const ownerPrimary = owner?.displayName || owner?.name || schedule.notificationEmail || schedule.userId;
  const ownerSecondary = owner?.email && owner.email !== ownerPrimary ? owner.email : undefined;
  const cronHuman = schedule.cronExpression ? describeCronExpression(schedule.cronExpression) : '—';

  const runAction = async (
    kind: 'pause' | 'resume' | 'lock' | 'unlock' | 'approve' | 'reject',
    fn: () => Promise<unknown>
  ): Promise<void> => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      await onActionComplete();
      onHide();
    } catch (err) {
      setError(extractApiError(err, 'Action failed'));
    } finally {
      setBusy(null);
    }
  };

  const onPause = (): Promise<void> =>
    runAction('pause', () => ScheduleService.update(numaPut, schedule.scheduleId, { status: 'paused' }));
  const onResume = (): Promise<void> =>
    runAction('resume', () => ScheduleService.update(numaPut, schedule.scheduleId, { status: 'active' }));
  const onApprove = (): Promise<void> =>
    runAction('approve', () => ScheduleService.approve(numaPost, schedule.scheduleId));

  // Confirm flows for destructive / friction-required actions. The
  // ConfirmModal reads the reason input and passes it to onConfirm — we
  // pass that value through to `adminLock` (or ignore it for unlock /
  // reject).
  const handleConfirm = async (reason: string): Promise<void> => {
    const action = pendingConfirm;
    setPendingConfirm(null);
    if (action === 'lock') {
      await runAction('lock', () => ScheduleService.adminLock(numaPut, schedule.scheduleId, reason || undefined));
    } else if (action === 'unlock') {
      await runAction('unlock', () => ScheduleService.adminUnlock(numaPut, schedule.scheduleId));
    } else if (action === 'reject') {
      await runAction('reject', () => ScheduleService.reject(numaPost, schedule.scheduleId));
    }
  };

  const scheduleLabel = schedule.label || schedule.agentTitle || schedule.agentId;

  return (
    <Modal show={!!schedule} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title className="h6 mb-0 d-flex align-items-center gap-2">
          <span>{schedule.label || schedule.agentTitle || 'Schedule overview'}</span>
          <Badge bg={badge.variant} className={badge.textClass}>
            {badge.label}
          </Badge>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="px-4 py-3">
        {error && (
          <Alert variant="danger" className="py-2 small mb-3">
            {error}
          </Alert>
        )}

        <div className="mb-3">
          <div className="text-muted text-uppercase small fw-semibold" style={{ fontSize: '0.7rem' }}>
            Owner
          </div>
          <div>{ownerPrimary || 'Unknown owner'}</div>
          {ownerSecondary && <div className="text-muted small">{ownerSecondary}</div>}
          {owner?.jobTitle && <div className="text-muted small">{owner.jobTitle}</div>}
        </div>

        <div className="row g-3 mb-3">
          <div className="col-md-6">
            <div className="text-muted text-uppercase small fw-semibold" style={{ fontSize: '0.7rem' }}>
              Agent
            </div>
            <div>{schedule.agentTitle || schedule.agentId || '—'}</div>
          </div>
          <div className="col-md-6">
            <div className="text-muted text-uppercase small fw-semibold" style={{ fontSize: '0.7rem' }}>
              Quota scope
            </div>
            <div>{schedule.quotaScope === 'company' ? 'Company-funded (admin-approved)' : 'Personal'}</div>
          </div>
          <div className="col-md-6">
            <div className="text-muted text-uppercase small fw-semibold" style={{ fontSize: '0.7rem' }}>
              Cadence
            </div>
            <div>{cronHuman}</div>
            <div className="text-muted small">{schedule.timezone}</div>
          </div>
          <div className="col-md-6">
            <div className="text-muted text-uppercase small fw-semibold" style={{ fontSize: '0.7rem' }}>
              Projected runs / month
            </div>
            <div>{schedule.projectedRunsPerMonth?.toLocaleString() ?? '—'}</div>
          </div>
          <div className="col-md-6">
            <div className="text-muted text-uppercase small fw-semibold" style={{ fontSize: '0.7rem' }}>
              Total runs (lifetime)
            </div>
            <div>{schedule.totalRuns?.toLocaleString() ?? '0'}</div>
          </div>
          <div className="col-md-6">
            <div className="text-muted text-uppercase small fw-semibold" style={{ fontSize: '0.7rem' }}>
              Max runs / month
            </div>
            <div>{schedule.maxRuns ? schedule.maxRuns.toLocaleString() : 'Unlimited'}</div>
          </div>
          <div className="col-md-6">
            <div className="text-muted text-uppercase small fw-semibold" style={{ fontSize: '0.7rem' }}>
              Last run
            </div>
            <div>{fmtEpoch(schedule.lastRunEpoch)}</div>
            {schedule.lastStatus && <div className="text-muted small">Status: {schedule.lastStatus}</div>}
          </div>
          <div className="col-md-6">
            <div className="text-muted text-uppercase small fw-semibold" style={{ fontSize: '0.7rem' }}>
              Created
            </div>
            <div>{fmtEpoch(schedule.createdAt)}</div>
          </div>
        </div>

        {status === 'admin_locked' && schedule.adminLockReason && (
          <Alert variant="light" className="border small py-2 mb-0">
            <strong>Lock reason:</strong> {schedule.adminLockReason}
          </Alert>
        )}
        {schedule.lastError && (
          <Alert variant="warning" className="py-2 small mb-0">
            <strong>Last error:</strong> {schedule.lastError}
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer className="justify-content-between">
        <div className="text-muted small">Owner will be emailed when an admin pauses or locks this schedule.</div>
        <div className="d-flex gap-2 flex-wrap">
          {status === 'pending_approval' && (
            <>
              <Button variant="outline-success" disabled={!!busy} onClick={onApprove}>
                {busy === 'approve' ? <Spinner size="sm" animation="border" /> : 'Approve'}
              </Button>
              <Button variant="outline-danger" disabled={!!busy} onClick={() => setPendingConfirm('reject')}>
                {busy === 'reject' ? <Spinner size="sm" animation="border" /> : 'Reject'}
              </Button>
            </>
          )}
          {status === 'active' && (
            <Button variant="outline-warning" disabled={!!busy} onClick={onPause}>
              {busy === 'pause' ? <Spinner size="sm" animation="border" /> : 'Pause'}
            </Button>
          )}
          {status === 'paused' && (
            <Button variant="outline-success" disabled={!!busy} onClick={onResume}>
              {busy === 'resume' ? <Spinner size="sm" animation="border" /> : 'Resume'}
            </Button>
          )}
          {status === 'admin_locked' && (
            <Button variant="outline-warning" disabled={!!busy} onClick={() => setPendingConfirm('unlock')}>
              {busy === 'unlock' ? <Spinner size="sm" animation="border" /> : 'Unlock'}
            </Button>
          )}
          {(status === 'active' || status === 'paused') && (
            <Button variant="outline-danger" disabled={!!busy} onClick={() => setPendingConfirm('lock')}>
              {busy === 'lock' ? <Spinner size="sm" animation="border" /> : 'Lock'}
            </Button>
          )}
          <Button variant="secondary" onClick={onHide} disabled={!!busy}>
            Close
          </Button>
        </div>
      </Modal.Footer>

      {/* Lock — destructive-but-recoverable; collects an optional reason
          shown to the owner. Suppresses the default "cannot be undone"
          danger boilerplate because admins CAN unlock from this same view. */}
      <ConfirmModal
        show={pendingConfirm === 'lock'}
        onHide={() => setPendingConfirm(null)}
        onConfirm={handleConfirm}
        title="Lock automation"
        message={
          <>
            Lock <strong>{scheduleLabel}</strong>? The owner will see it as locked and cannot reactivate it themselves.
          </>
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

      {/* Unlock — recoverable, plain confirm. */}
      <ConfirmModal
        show={pendingConfirm === 'unlock'}
        onHide={() => setPendingConfirm(null)}
        onConfirm={handleConfirm}
        title="Unlock automation"
        message={
          <>
            Unlock <strong>{scheduleLabel}</strong>? It will return to <em>paused</em>; the owner can then resume it.
          </>
        }
        confirmLabel="Unlock"
        variant="warning"
        suppressDeleteWarning
      />

      {/* Reject — destructive (soft-deletes the pending record). Keeps
          the danger warning on so the admin pauses to think. */}
      <ConfirmModal
        show={pendingConfirm === 'reject'}
        onHide={() => setPendingConfirm(null)}
        onConfirm={handleConfirm}
        title="Reject pending automation"
        message="Reject this schedule? It will be permanently removed and cannot be approved later."
        confirmLabel="Reject"
        variant="danger"
      />
    </Modal>
  );
};

export default AdminScheduleOverviewModal;
