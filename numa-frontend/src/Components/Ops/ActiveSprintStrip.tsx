import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useOps } from './OpsContext';
import { CompleteWorkUnitModal, WorkUnitSuccessModal } from './Modals/WorkUnitModals';
import type { WorkUnit } from '../../types/ops';

/**
 * ActiveSprintStrip — minimal info bar for the Board (kanban) view.
 *
 * Shows the active sprint name + progress + Complete button.
 * If no active sprint exists, shows a message.
 * This replaces the full SprintBar on the Board view.
 */
const ActiveSprintStrip = () => {
  const { t } = useTranslation('ops');
  const { boardData, workUnits, tickets, selectWorkUnit, refreshBoard, refreshTickets, refreshWorkUnits } = useOps();

  const [showComplete, setShowComplete] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successWorkUnit, setSuccessWorkUnit] = useState<WorkUnit | null>(null);

  const boardId = boardData?.board?.id ?? '';
  const activeWorkUnit = workUnits.find((wu) => wu.status === 'active') ?? null;

  const stats = useMemo(() => {
    if (!activeWorkUnit) return { done: 0, total: 0 };
    let done = 0;
    let total = 0;
    for (const tk of tickets) {
      if (tk.workUnitId === activeWorkUnit.id) {
        total += 1;
        if (tk.statusType === 'completed' || tk.statusType === 'ended') {
          done += 1;
        }
      }
    }
    return { done, total };
  }, [activeWorkUnit, tickets]);

  const incompleteCount = stats.total - stats.done;
  const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  if (!activeWorkUnit) {
    return (
      <div className="border-bottom bg-white px-3 py-2">
        <small className="text-muted">
          <i className="bi bi-info-circle me-1" />
          {t('sprints.noActiveSprint')} — {t('sprints.noActiveSprintHelp')}
        </small>
      </div>
    );
  }

  return (
    <>
      <div className="border-bottom bg-white px-3 py-2">
        <div className="d-flex align-items-center gap-3">
          {/* Sprint name + status dot */}
          <div className="d-flex align-items-center gap-2">
            <span
              className="d-inline-block rounded-circle"
              style={{ width: 8, height: 8, backgroundColor: '#198754' }}
            />
            <span className="fw-semibold">{activeWorkUnit.name}</span>
          </div>

          {/* Progress */}
          <div className="d-flex align-items-center gap-2">
            <span className="text-muted small">{t('sprints.progress', { done: stats.done, total: stats.total })}</span>
            <div className="rounded-pill bg-light" style={{ width: 80, height: 6, overflow: 'hidden' }}>
              <div
                className="rounded-pill"
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  backgroundColor: '#198754',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>

          {/* Date range */}
          {(activeWorkUnit.startDate || activeWorkUnit.endDate) && (
            <span className="text-muted small">
              {t('sprints.dateRange', {
                start: formatDate(activeWorkUnit.startDate),
                end: formatDate(activeWorkUnit.endDate),
              })}
            </span>
          )}

          {/* Goal */}
          {activeWorkUnit.goal && (
            <span className="text-muted small text-truncate" style={{ maxWidth: 200 }}>
              {activeWorkUnit.goal}
            </span>
          )}

          {/* Complete button */}
          <div className="ms-auto">
            <button type="button" className="btn btn-sm btn-outline-warning" onClick={() => setShowComplete(true)}>
              {t('sprints.complete')}
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      <CompleteWorkUnitModal
        show={showComplete}
        workUnit={activeWorkUnit}
        workUnits={workUnits}
        boardId={boardId}
        incompleteCount={incompleteCount}
        completedCount={stats.done}
        onHide={() => setShowComplete(false)}
        onCompleted={async () => {
          setShowComplete(false);
          setSuccessWorkUnit(activeWorkUnit);
          setShowSuccess(true);
          selectWorkUnit(null);
          await refreshBoard();
          await Promise.all([refreshTickets(), refreshWorkUnits()]);
        }}
      />
      <WorkUnitSuccessModal
        show={showSuccess}
        workUnit={successWorkUnit}
        action="completed"
        onHide={() => {
          setShowSuccess(false);
          setSuccessWorkUnit(null);
        }}
      />
    </>
  );
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export default ActiveSprintStrip;
