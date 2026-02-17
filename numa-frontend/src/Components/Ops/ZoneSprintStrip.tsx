import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useOps } from './OpsContext';
import * as OpsService from '../../Services/OpsService';
import { StartWorkUnitModal, CompleteWorkUnitModal, WorkUnitSuccessModal } from './Modals/WorkUnitModals';
import type { WorkUnit } from '../../types/ops';

/**
 * ZoneSprintStrip — unified zone / sprint pill strip for OpsHeader Row 2.
 *
 * When work units are enabled → shows sprint pills with progress, backlog
 * count, New Sprint / Start / Complete actions, and a detail strip.
 *
 * When work units are disabled → shows plain zone name pills so the user
 * can navigate between zones (e.g. "Dev Work", "Spikes", "Planning").
 */
const ZoneSprintStrip = () => {
  const { t } = useTranslation('ops');
  const { numaPost } = useNumaRequest();
  const {
    teamData,
    workUnits,
    tickets,
    activeZoneId,
    setActiveZone,
    selectedWorkUnitId,
    selectWorkUnit,
    refreshTeam,
    refreshTickets,
  } = useOps();

  // ── Modal state ──────────────────────────────────────────────────────────
  const [showStart, setShowStart] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successAction, setSuccessAction] = useState<'started' | 'completed'>('started');
  const [successWorkUnit, setSuccessWorkUnit] = useState<WorkUnit | null>(null);

  const zones = teamData?.zones ?? [];
  const hasWorkUnits = Boolean(teamData?.team?.workUnitSeries?.enabled);
  const teamId = teamData?.team?.id ?? '';

  // ── Derived counts (only used when work units are enabled) ─────────────
  const backlogZoneIds = useMemo(
    () => new Set(zones.filter((z) => z.zoneType === 'backlog').map((z) => z.id)),
    [zones],
  );

  const backlogCount = useMemo(
    () => tickets.filter((tk) => !tk.workUnitId && backlogZoneIds.has(tk.zoneId)).length,
    [tickets, backlogZoneIds],
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
  const activeWorkUnit = workUnits.find((wu) => wu.status === 'active') ?? null;
  const hasActiveWu = workUnits.some((wu) => wu.status === 'active');

  const incompleteCount = useMemo(() => {
    if (!activeWorkUnit) return 0;
    return tickets.filter(
      (tk) => tk.workUnitId === activeWorkUnit.id && tk.statusType !== 'completed' && tk.statusType !== 'ended',
    ).length;
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

  // ── New Sprint handler ────────────────────────────────────────────────
  const handleNewSprint = useCallback(async () => {
    if (!teamId) return;
    const label = teamData?.team?.workUnitSeries?.label ?? 'Sprint';
    const existingCount = workUnits.length;
    try {
      await OpsService.createWorkUnit(numaPost, teamId, {
        name: `${label} ${existingCount + 1}`,
      });
      await refreshTeam();
    } catch (err) {
      console.error('[ZoneSprintStrip] Failed to create work unit:', err);
    }
  }, [teamId, teamData?.team?.workUnitSeries?.label, workUnits.length, numaPost, refreshTeam]);

  // ═══════════════════════════════════════════════════════════════════════
  // Mode A — Plain zone pills (no work units)
  // ═══════════════════════════════════════════════════════════════════════
  if (!hasWorkUnits) {
    return (
      <div className="d-flex align-items-center gap-2 flex-grow-1" style={{ overflowX: 'auto' }}>
        <span
          className="text-muted text-uppercase flex-shrink-0 fw-semibold"
          style={{ fontSize: '0.7rem', letterSpacing: '0.5px' }}
        >
          {t('header.zonesLabel')}
        </span>
        {zones.map((zone) => (
          <button
            key={zone.id}
            type="button"
            className={`btn btn-sm flex-shrink-0 ${activeZoneId === zone.id ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setActiveZone(zone.id)}
          >
            <i className={`bi ${zone.zoneType === 'board' ? 'bi-kanban' : 'bi-list-task'} me-1`} />
            {zone.name}
          </button>
        ))}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Mode B — Sprint pills (work units enabled)
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <>
      <div className="d-flex flex-column flex-grow-1" style={{ minWidth: 0 }}>
        {/* ── Pill Row ─────────────────────────────────────────────────── */}
        <div className="d-flex align-items-center gap-2" style={{ overflowX: 'auto' }}>
          <span
            className="text-muted text-uppercase flex-shrink-0 fw-semibold"
            style={{ fontSize: '0.7rem', letterSpacing: '0.5px' }}
          >
            {t('header.sprintsLabel')}
          </span>

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
            className={`btn btn-sm flex-shrink-0 btn-outline-secondary`}
            onClick={() => {
              selectWorkUnit(null);
              const firstBacklog = zones.find((z) => z.zoneType === 'backlog');
              if (firstBacklog) setActiveZone(firstBacklog.id);
            }}
          >
            <i className="bi bi-inbox me-1" />
            {t('sprints.backlog')}
            <span className="badge bg-secondary bg-opacity-25 text-secondary ms-1">{backlogCount}</span>
          </button>

          {/* Work-unit pills */}
          {workUnits.map((wu) => {
            const stats = workUnitStats.get(wu.id) ?? { done: 0, total: 0 };
            const isSelected = selectedWorkUnitId === wu.id;
            const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

            return (
              <button
                key={wu.id}
                type="button"
                className={`btn btn-sm flex-shrink-0 position-relative ${
                  isSelected ? 'btn-primary' : 'btn-outline-secondary'
                }`}
                style={{ paddingBottom: wu.status === 'active' ? 10 : undefined }}
                onClick={() => selectWorkUnit(wu.id)}
              >
                <span
                  className="d-inline-block rounded-circle me-1"
                  style={{
                    width: 8,
                    height: 8,
                    backgroundColor: statusDotColor(wu.status),
                  }}
                />
                {wu.name}{' '}
                <span className="opacity-75">{t('sprints.progress', { done: stats.done, total: stats.total })}</span>
                {/* Thin progress bar for active sprints */}
                {wu.status === 'active' && (
                  <span
                    className="position-absolute bottom-0 start-0"
                    style={{
                      height: 3,
                      width: `${pct}%`,
                      backgroundColor: isSelected ? '#fff' : '#0d6efd',
                      borderRadius: '0 0 4px 4px',
                      transition: 'width 0.3s ease',
                    }}
                  />
                )}
              </button>
            );
          })}

          {/* + New Sprint */}
          <button
            type="button"
            className="btn btn-sm btn-link text-muted text-decoration-none flex-shrink-0"
            style={{ fontSize: '0.82rem' }}
            onClick={handleNewSprint}
          >
            <i className="bi bi-plus me-1" />
            {t('sprints.new')}
          </button>

          {/* Start / Complete action buttons */}
          {selectedWorkUnit && selectedWorkUnit.status === 'planning' && (
            <button
              type="button"
              className="btn btn-sm btn-outline-success flex-shrink-0"
              disabled={hasActiveWu}
              title={hasActiveWu ? t('sprints.completeCurrentFirst') : undefined}
              onClick={() => setShowStart(true)}
            >
              {t('sprints.start')}
            </button>
          )}

          {selectedWorkUnit && selectedWorkUnit.status === 'active' && (
            <button
              type="button"
              className="btn btn-sm btn-outline-warning flex-shrink-0"
              onClick={() => setShowComplete(true)}
            >
              {t('sprints.complete')}
            </button>
          )}
        </div>

        {/* ── Detail strip (date range + goal) ───────────────────────── */}
        {selectedWorkUnit && (
          <div className="d-flex align-items-center gap-3 mt-1 small text-muted">
            {(selectedWorkUnit.startDate || selectedWorkUnit.endDate) && (
              <span>
                <i className="bi bi-calendar3 me-1" />
                {t('sprints.dateRange', {
                  start: formatDate(selectedWorkUnit.startDate),
                  end: formatDate(selectedWorkUnit.endDate),
                })}
              </span>
            )}
            {selectedWorkUnit.goal && (
              <span>
                <i className="bi bi-bullseye me-1" />
                {selectedWorkUnit.goal}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Work Unit Modals ──────────────────────────────────────────── */}
      <StartWorkUnitModal
        show={showStart}
        workUnits={workUnits}
        teamId={teamId}
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
          const updated = await refreshTeam();
          if (updated) {
            const newZone = updated.zones.find((z) => !beforeZoneIds.has(z.id));
            if (newZone) setActiveZone(newZone.id);
          }
          await refreshTickets();
        }}
      />
      {activeWorkUnit && (
        <CompleteWorkUnitModal
          show={showComplete}
          workUnit={activeWorkUnit}
          teamId={teamId}
          incompleteCount={incompleteCount}
          onHide={() => setShowComplete(false)}
          onCompleted={async () => {
            setShowComplete(false);
            setSuccessWorkUnit(activeWorkUnit);
            setSuccessAction('completed');
            setShowSuccess(true);
            await refreshTeam();
            await refreshTickets();
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

export default ZoneSprintStrip;
