import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useConfirm } from '../../Providers/ConfirmContext';
import { useOps } from './OpsContext';
import * as OpsService from '../../Services/OpsService';
import {
  CreateWorkUnitModal,
  StartWorkUnitModal,
  CompleteWorkUnitModal,
  WorkUnitSuccessModal,
} from './Modals/WorkUnitModals';
import type { WorkUnit } from '../../types/ops';

const SprintBar = () => {
  const { t } = useTranslation('ops');
  const { t: tCommon } = useTranslation('common');
  const { numaDelete } = useNumaRequest();
  const confirm = useConfirm();
  const {
    boardData,
    workUnits,
    tickets,
    selectedWorkUnitId,
    selectWorkUnit,
    refreshBoard,
    refreshTickets,
    refreshWorkUnits,
    setActiveZone,
  } = useOps();

  // ── Modal state ──────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [showStart, setShowStart] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successAction, setSuccessAction] = useState<'started' | 'completed'>('started');
  const [successWorkUnit, setSuccessWorkUnit] = useState<WorkUnit | null>(null);

  const zones = boardData?.zones ?? [];

  // ── Derived counts ──────────────────────────────────────────────────────
  const backlogZoneIds = useMemo(
    () => new Set(zones.filter((z) => z.zoneType === 'backlog').map((z) => z.id)),
    [zones]
  );

  const backlogCount = useMemo(
    () => tickets.filter((tk) => !tk.workUnitId && backlogZoneIds.has(tk.zoneId)).length,
    [tickets, backlogZoneIds]
  );

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

  const selectedWorkUnit: WorkUnit | null = workUnits.find((wu) => wu.id === selectedWorkUnitId) ?? null;

  // ── Status dot color helper ─────────────────────────────────────────────
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

  // ── Format date for display ─────────────────────────────────────────────
  const formatDate = (iso: string | null | undefined): string => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  const boardId = boardData?.board?.id ?? '';

  // ── Determine action button state ───────────────────────────────────────
  const hasActiveWu = workUnits.some((wu) => wu.status === 'active');
  const activeWorkUnit = workUnits.find((wu) => wu.status === 'active') ?? null;
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

  // ── Default name for the next sprint ──────────────────────────────────
  const defaultSprintName = useMemo(() => {
    const label = boardData?.board?.workUnitSeries?.label ?? 'Sprint';
    return `${label} ${workUnits.length + 1}`;
  }, [boardData?.board?.workUnitSeries?.label, workUnits.length]);

  // ── Delete Sprint handler ───────────────────────────────────────────────
  const [deleting, setDeleting] = useState(false);
  const handleDeleteSprint = useCallback(
    async (wu: WorkUnit) => {
      if (!boardId || deleting) return;
      const ok = await confirm({
        message: t('sprints.deleteSprintConfirm', { name: wu.name }),
        confirmLabel: tCommon('confirm.delete'),
        variant: 'danger',
      });
      if (!ok) return;
      setDeleting(true);
      try {
        await OpsService.deleteWorkUnit(numaDelete, boardId, wu.id);
        selectWorkUnit(null);
        await Promise.all([refreshWorkUnits(), refreshTickets()]);
      } catch (err) {
        console.error('[SprintBar] Failed to delete work unit:', err);
      } finally {
        setDeleting(false);
      }
    },
    [boardId, deleting, numaDelete, selectWorkUnit, refreshWorkUnits, refreshTickets, t, tCommon, confirm]
  );

  return (
    <>
      <div className="border-bottom bg-white px-3 py-2">
        {/* ── Pill Row ────────────────────────────────────────────────────── */}
        <div className="d-flex align-items-center gap-2" style={{ overflowX: 'auto' }}>
          {/* "All" pill */}
          <button
            type="button"
            className={`btn btn-sm flex-shrink-0 ${
              selectedWorkUnitId === null ? 'btn-primary' : 'btn-outline-secondary'
            }`}
            onClick={() => selectWorkUnit(null)}
          >
            {t('sprints.all')}
          </button>

          {/* Backlog pill */}
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary flex-shrink-0"
            onClick={() => selectWorkUnit(null)}
          >
            {t('sprints.backlog')} [{backlogCount}]
          </button>

          {/* Work-unit pills — only active sprints shown here */}
          {workUnits
            .filter((wu) => wu.status === 'active')
            .map((wu) => {
              const stats = workUnitStats.get(wu.id) ?? { done: 0, total: 0 };
              const isSelected = selectedWorkUnitId === wu.id;
              const ticketPct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

              // Time progress
              let timePct = 0;
              if (wu.startDate && wu.endDate) {
                const start = new Date(wu.startDate).getTime();
                const end = new Date(wu.endDate).getTime();
                const now = Date.now();
                if (end > start) {
                  timePct = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
                }
              }

              return (
                <button
                  key={wu.id}
                  type="button"
                  className={`ops-pill ops-pill--sprint ${isSelected ? 'active' : ''}`}
                  onClick={() => selectWorkUnit(wu.id)}
                >
                  <span className="ops-sprint-dot" style={{ backgroundColor: statusDotColor(wu.status) }} />
                  {wu.name}{' '}
                  <span className="ops-sprint-fraction">
                    {t('sprints.progress', { done: stats.done, total: stats.total })}
                  </span>
                  {wu.startDate && wu.endDate && (
                    <span
                      className="ops-sprint-progress"
                      style={{
                        width: `${timePct}%`,
                        backgroundColor: isSelected ? 'rgba(255,255,255,0.4)' : '#adb5bd',
                        bottom: 5,
                      }}
                    />
                  )}
                  <span
                    className="ops-sprint-progress"
                    style={{
                      width: `${ticketPct}%`,
                      backgroundColor: isSelected ? '#fff' : '#0d6efd',
                      bottom: 0,
                    }}
                  />
                </button>
              );
            })}

          {/* ── Right-side actions ── */}
          <div className="ms-auto d-flex align-items-center gap-2 flex-shrink-0">
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setShowCreate(true)}>
              <i className="bi bi-plus me-1" />
              {t('sprints.new')}
            </button>

            {selectedWorkUnit && selectedWorkUnit.status === 'planning' && (
              <button
                type="button"
                className="btn btn-sm btn-outline-danger"
                disabled={deleting}
                title={t('sprints.deleteSprint')}
                onClick={() => handleDeleteSprint(selectedWorkUnit)}
              >
                <i className="bi bi-trash" />
              </button>
            )}

            {selectedWorkUnit && selectedWorkUnit.status === 'planning' && (
              <button
                type="button"
                className="btn btn-sm btn-outline-success"
                disabled={hasActiveWu}
                title={hasActiveWu ? t('sprints.completeCurrentFirst') : undefined}
                onClick={() => setShowStart(true)}
              >
                {t('sprints.start')}
              </button>
            )}

            {selectedWorkUnit && selectedWorkUnit.status === 'active' && (
              <button type="button" className="btn btn-sm btn-outline-warning" onClick={() => setShowComplete(true)}>
                {t('sprints.complete')}
              </button>
            )}
          </div>
        </div>

        {/* ── Selected work-unit detail strip ─────────────────────────────── */}
        {selectedWorkUnit && (
          <div className="d-flex align-items-center gap-3 mt-1 small text-muted">
            {(selectedWorkUnit.startDate || selectedWorkUnit.endDate) && (
              <span>
                {t('sprints.dateRange', {
                  start: formatDate(selectedWorkUnit.startDate),
                  end: formatDate(selectedWorkUnit.endDate),
                })}
              </span>
            )}
            {selectedWorkUnit.goal && (
              <span>
                <strong>{t('sprints.goal')}:</strong> {selectedWorkUnit.goal}
              </span>
            )}
          </div>
        )}
      </div>

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
        onHide={() => setShowStart(false)}
        onStarted={async () => {
          setShowStart(false);
          const started = workUnits.find((wu) => wu.status === 'planning');
          if (started) {
            setSuccessWorkUnit(started);
            setSuccessAction('started');
            setShowSuccess(true);
          }
          // Refresh team to pick up the new sprint zone, then navigate to it
          const beforeZoneIds = new Set(zones.map((z) => z.id));
          const updated = await refreshBoard();
          if (updated) {
            const newZone = updated.zones.find((z) => !beforeZoneIds.has(z.id));
            if (newZone) setActiveZone(newZone.id);
          }
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

export default SprintBar;
