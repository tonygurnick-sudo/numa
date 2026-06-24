import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useOps } from './OpsContext';
import { getCompletedWorkUnitIds, isHiddenFromBoard } from './opsWorkFilters';

/**
 * ZoneSprintStrip — zone navigation pills for OpsHeader Row 2.
 *
 * Shows zone pills (Backlog, Board, Spikes, etc.) for switching between
 * zones. Board zones running an active sprint show the sprint name inline.
 */
const ZoneSprintStrip = () => {
  const { t } = useTranslation('ops');
  const { boardData, workUnits, tickets, activeZoneId, setActiveZone } = useOps();

  const zones = boardData?.zones ?? [];

  // ── Zone ticket counts + completion stats ───────────────────────────
  const zoneStats = useMemo(() => {
    const completedWuIds = getCompletedWorkUnitIds(workUnits);
    const map = new Map<string, { count: number; done: number }>();
    for (const zone of zones) {
      map.set(zone.id, { count: 0, done: 0 });
    }
    for (const tk of tickets) {
      // Past-sprint + legacy-archived work is hidden from the board, so keep it out of counts.
      if (isHiddenFromBoard(tk, completedWuIds)) continue;
      const entry = map.get(tk.zoneId);
      if (entry) {
        entry.count += 1;
        if (tk.statusType === 'completed' || tk.statusType === 'ended') {
          entry.done += 1;
        }
      }
    }
    return map;
  }, [zones, tickets, workUnits]);

  const workUnitById = useMemo(() => {
    const map = new Map<string, (typeof workUnits)[number]>();
    for (const wu of workUnits) map.set(wu.id, wu);
    return map;
  }, [workUnits]);

  return (
    <div className="d-flex flex-grow-1" style={{ minWidth: 0 }}>
      <div className="d-flex align-items-center gap-2" style={{ overflowX: 'auto' }}>
        <div className="ops-zone-tabs">
          {zones.map((zone) => {
            const stats = zoneStats.get(zone.id) ?? { count: 0, done: 0 };
            const pct = stats.count > 0 ? Math.round((stats.done / stats.count) * 100) : 0;
            const activeSprint = zone.activeWorkUnitId ? workUnitById.get(zone.activeWorkUnitId) : undefined;
            return (
              <button
                key={zone.id}
                type="button"
                className={`ops-zone-tab ${activeZoneId === zone.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveZone(zone.id);
                }}
              >
                <i className={`bi ${zone.zoneType === 'board' ? 'bi-kanban' : 'bi-list-task'}`} />
                {zone.name}
                {activeSprint && (
                  <span
                    className="ops-zone-tab-sprint"
                    title={t('sprints.zoneActiveSprint', { name: activeSprint.name })}
                  >
                    {activeSprint.name}
                  </span>
                )}
                <span className="ops-zone-tab-count">({stats.count})</span>
                {stats.count > 0 && (
                  <span className="ops-zone-tab-pct" title={t('sprints.zoneProgress', { percent: pct })}>
                    {pct}%
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ZoneSprintStrip;
