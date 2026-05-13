import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useOps } from '../OpsContext';
import {
  CreateWorkUnitModal,
  StartWorkUnitModal,
  CompleteWorkUnitModal,
  WorkUnitSuccessModal,
} from '../Modals/WorkUnitModals';
import type { WorkUnit } from '../../../types/ops';

/**
 * SprintBoardBar — lightweight sprint controls rendered inside the board area,
 * above the kanban columns. Shows the active sprint pill (toggleable filter),
 * inline date/progress/goal details, + New Sprint link, and Complete button.
 *
 * Only renders when work units (sprints) are enabled for the team.
 */
const SprintBoardBar = ({ inline = false }: { inline?: boolean }) => {
  const { t } = useTranslation('ops');
  const {
    boardData,
    workUnits,
    tickets,
    selectWorkUnit,
    activeZoneId,
    refreshBoard,
    refreshTickets,
    refreshWorkUnits,
  } = useOps();

  // ── Modal state ──────────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [showStart, setShowStart] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successAction, setSuccessAction] = useState<'started' | 'completed'>('started');
  const [successWorkUnit, setSuccessWorkUnit] = useState<WorkUnit | null>(null);

  const zones = boardData?.zones ?? [];
  const hasWorkUnits = Boolean(boardData?.board?.workUnitSeries?.enabled);
  const boardId = boardData?.board?.id ?? '';

  // ── Derived sprint stats ─────────────────────────────────────────────
  const workUnitStats = useMemo(() => {
    const map = new Map<string, { done: number; total: number }>();
    for (const wu of workUnits) {
      map.set(wu.id, { done: 0, total: 0 });
    }
    for (const tk of tickets) {
      if (tk.workUnitId && map.has(tk.workUnitId)) {
        const entry = map.get(tk.workUnitId)!;
        entry.total += 1;
        if (tk.statusType === 'completed' || tk.statusType === 'ended') {
          entry.done += 1;
        }
      }
    }
    return map;
  }, [workUnits, tickets]);

  // The "selected" sprint under the zone-bound model is whatever sprint the
  // current zone is running. The user can no longer toggle this off.
  const activeWorkUnit = useMemo(() => {
    const zone = boardData?.zones?.find((z) => z.id === activeZoneId);
    if (zone?.activeWorkUnitId) {
      return workUnits.find((wu) => wu.id === zone.activeWorkUnitId) ?? null;
    }
    return null;
  }, [boardData?.zones, activeZoneId, workUnits]);
  const selectedWorkUnit: WorkUnit | null = activeWorkUnit;

  const { incompleteCount, completedCount } = useMemo(() => {
    if (!activeWorkUnit) return { incompleteCount: 0, completedCount: 0 };
    let incomplete = 0;
    let completed = 0;
    for (const tk of tickets) {
      if (tk.workUnitId === activeWorkUnit.id) {
        if (tk.statusType === 'completed' || tk.statusType === 'ended') {
          completed += 1;
        } else {
          incomplete += 1;
        }
      }
    }
    return { incompleteCount: incomplete, completedCount: completed };
  }, [activeWorkUnit, tickets]);

  // ── Helpers ────────────────────────────────────────────────────────────
  const statusDotColor = (status: WorkUnit['status']): string => {
    switch (status) {
      case 'active':
        return '#198754';
      case 'planning':
        return '#0d6efd';
      case 'completed':
        return '#6c757d';
      default:
        return '#6c757d';
    }
  };

  const formatDate = (iso: string | null | undefined): string => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  };

  // ── Default name for the next sprint ──────────────────────────────────
  const defaultSprintName = useMemo(() => {
    const label = boardData?.board?.workUnitSeries?.label ?? 'Sprint';
    return `${label} ${workUnits.length + 1}`;
  }, [boardData?.board?.workUnitSeries?.label, workUnits.length]);

  if (!hasWorkUnits) return null;

  // Under the zone-bound sprint model the active sprint of the current zone is
  // a fixed property of the board, not a filter the user toggles. Render it as
  // a static indicator (no onClick).
  const activeZone = zones.find((z) => z.id === activeZoneId);
  const zoneActiveSprintId = activeZone?.activeWorkUnitId ?? null;
  const sprintPills = workUnits
    .filter((wu) => wu.status === 'active' && wu.id === zoneActiveSprintId)
    .map((wu) => {
      const stats = workUnitStats.get(wu.id) ?? { done: 0, total: 0 };
      const ticketPct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

      return (
        <div key={wu.id} className="ops-pill ops-pill--sprint active" aria-label={`Active sprint: ${wu.name}`}>
          <span className="ops-sprint-dot" style={{ backgroundColor: statusDotColor(wu.status) }} />
          {wu.name}
          <span className="ops-sprint-fraction">{t('sprints.progress', { done: stats.done, total: stats.total })}</span>
          <span className="ops-sprint-track">
            <span
              className="ops-sprint-track-fill"
              style={{
                width: `${ticketPct}%`,
                backgroundColor: statusDotColor(wu.status),
              }}
            />
          </span>
        </div>
      );
    });

  const actions = (
    <div className={`d-flex align-items-center gap-2 flex-shrink-0${inline ? '' : ' ms-auto'}`}>
      <button type="button" className="ops-new-link" onClick={() => setShowCreate(true)}>
        <i className="bi bi-plus" />
        {t('sprints.new')}
      </button>

      {selectedWorkUnit && selectedWorkUnit.status === 'active' && (
        <button
          type="button"
          className="ops-new-link"
          style={{ color: '#d97706' }}
          onClick={() => setShowComplete(true)}
        >
          {t('sprints.complete')}
        </button>
      )}
    </div>
  );

  const inlineContent = (
    <>
      {sprintPills}
      {actions}
    </>
  );

  const fullContent = (
    <div className="ops-sprint-board-bar">
      <div className="d-flex align-items-center gap-2 flex-wrap">
        {sprintPills}

        {/* Inline detail info -- date range, progress, goal */}
        {selectedWorkUnit && (
          <>
            <div className="vr align-self-stretch my-1 mx-1" style={{ opacity: 0.3 }} />
            <div
              className="d-flex align-items-center gap-3"
              style={{ fontSize: '0.78rem', color: 'var(--ops-text-muted)' }}
            >
              {(selectedWorkUnit.startDate || selectedWorkUnit.endDate) && (
                <span className="d-flex align-items-center gap-1">
                  <i className="bi bi-calendar3" style={{ fontSize: '0.72rem' }} />
                  {t('sprints.dateRange', {
                    start: formatDate(selectedWorkUnit.startDate),
                    end: formatDate(selectedWorkUnit.endDate),
                  })}
                </span>
              )}
              {selectedWorkUnit.status === 'active' &&
                (() => {
                  const stats = workUnitStats.get(selectedWorkUnit.id) ?? { done: 0, total: 0 };
                  return (
                    <span className="d-flex align-items-center gap-1">
                      <i className="bi bi-check2-square" style={{ fontSize: '0.72rem' }} />
                      {t('sprints.completionSummary', { done: stats.done, incomplete: stats.total - stats.done })}
                    </span>
                  );
                })()}
              {selectedWorkUnit.goal && (
                <span className="d-flex align-items-center gap-1 text-truncate" style={{ maxWidth: 280 }}>
                  <i className="bi bi-bullseye" style={{ fontSize: '0.72rem' }} />
                  {selectedWorkUnit.goal}
                </span>
              )}
            </div>
          </>
        )}

        {actions}
      </div>
    </div>
  );

  return (
    <>
      {inline ? inlineContent : fullContent}

      {/* ── Work Unit Modals ──────────────────────────────────────────── */}
      <CreateWorkUnitModal
        show={showCreate}
        boardId={boardId}
        defaultName={defaultSprintName}
        onHide={() => setShowCreate(false)}
        onCreated={async () => {
          setShowCreate(false);
          await refreshWorkUnits();
        }}
      />
      <StartWorkUnitModal
        show={showStart}
        workUnits={workUnits}
        boardId={boardId}
        tickets={tickets}
        zones={zones}
        defaultZoneId={activeZoneId}
        onHide={() => setShowStart(false)}
        onStarted={async () => {
          setShowStart(false);
          const started = workUnits.find((wu) => wu.status === 'planning');
          if (started) {
            setSuccessWorkUnit(started);
            setSuccessAction('started');
            setShowSuccess(true);
          }
          // Zone-bound model: the active sprint is applied to an existing zone.
          // No new zone is created on start, so we don't need to switch zones.
          await refreshBoard();
          await Promise.all([refreshTickets(), refreshWorkUnits()]);
        }}
      />
      {activeWorkUnit && (
        <CompleteWorkUnitModal
          show={showComplete}
          workUnit={activeWorkUnit}
          workUnits={workUnits}
          boardId={boardId}
          incompleteCount={incompleteCount}
          completedCount={completedCount}
          onHide={() => setShowComplete(false)}
          onCompleted={async () => {
            setShowComplete(false);
            setSuccessWorkUnit(activeWorkUnit);
            setSuccessAction('completed');
            setShowSuccess(true);
            // Clear the sprint filter so the board doesn't stay stuck on the completed sprint
            selectWorkUnit(null);
            await refreshBoard();
            await Promise.all([refreshTickets(), refreshWorkUnits()]);
          }}
        />
      )}
      <WorkUnitSuccessModal
        show={showSuccess}
        workUnit={successWorkUnit}
        action={successAction}
        onHide={() => {
          setShowSuccess(false);
          setSuccessWorkUnit(null);
        }}
      />
    </>
  );
};

export default SprintBoardBar;
