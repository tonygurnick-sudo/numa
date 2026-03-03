import { useMemo } from 'react';
import { useOps } from './OpsContext';

/**
 * ZoneSprintStrip — zone navigation pills for OpsHeader Row 2.
 *
 * Shows zone pills (Backlog, Board, Spikes, etc.) for switching between
 * zones. Sprint controls have moved into the board area (SprintBoardBar).
 */
const ZoneSprintStrip = () => {
  const { teamData, tickets, activeZoneId, setActiveZone } = useOps();

  const zones = teamData?.zones ?? [];

  // ── Zone ticket counts ──────────────────────────────────────────────
  const zoneTicketCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const zone of zones) {
      map.set(zone.id, 0);
    }
    for (const tk of tickets) {
      if (map.has(tk.zoneId)) {
        map.set(tk.zoneId, (map.get(tk.zoneId) ?? 0) + 1);
      }
    }
    return map;
  }, [zones, tickets]);

  return (
    <div className="d-flex flex-grow-1" style={{ minWidth: 0 }}>
      <div className="d-flex align-items-center gap-2" style={{ overflowX: 'auto' }}>
        <div className="ops-zone-tabs">
          {zones.map((zone) => {
            const count = zoneTicketCounts.get(zone.id) ?? 0;
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
                <span className="ops-zone-tab-count">({count})</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ZoneSprintStrip;
