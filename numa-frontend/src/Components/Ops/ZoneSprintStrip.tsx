import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useOps } from './OpsContext';

/**
 * ZoneSprintStrip — zone navigation pills for OpsHeader Row 2.
 *
 * Shows zone pills (Backlog, Board, Spikes, etc.) for switching between
 * zones. Sprint controls have moved into the board area (SprintBoardBar).
 */
const ZoneSprintStrip = () => {
  const { t } = useTranslation('ops');
  const { teamData, tickets, activeZoneId, setActiveZone } = useOps();

  const zones = teamData?.zones ?? [];

  // ── Zone ticket counts + completion stats ───────────────────────────
  const zoneStats = useMemo(() => {
    const map = new Map<string, { count: number; done: number }>();
    for (const zone of zones) {
      map.set(zone.id, { count: 0, done: 0 });
    }
    for (const tk of tickets) {
      if (tk.archived) continue;
      const entry = map.get(tk.zoneId);
      if (entry) {
        entry.count += 1;
        if (tk.statusType === 'completed' || tk.statusType === 'ended') {
          entry.done += 1;
        }
      }
    }
    return map;
  }, [zones, tickets]);

  return (
    <div className="d-flex flex-grow-1" style={{ minWidth: 0 }}>
      <div className="d-flex align-items-center gap-2" style={{ overflowX: 'auto' }}>
        <div className="ops-zone-tabs">
          {zones.map((zone) => {
            const stats = zoneStats.get(zone.id) ?? { count: 0, done: 0 };
            const pct = stats.count > 0 ? Math.round((stats.done / stats.count) * 100) : 0;
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
