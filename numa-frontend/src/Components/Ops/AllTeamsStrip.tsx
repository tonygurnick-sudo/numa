import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useOps } from './OpsContext';
import * as OpsService from '../../Services/OpsService';
import type { TeamSummary, TeamResponse } from '../../types/ops';
import { getCached, setCache } from '../../utils/opsCache';

/**
 * AllTeamsStrip — header strip for "All Teams" board view mode.
 *
 * Fetches zone data for every team so all team boxes can display zone
 * pills (matching Ian's design). The selected team uses the context's
 * `teamData` directly; other teams are fetched on mount and cached.
 */
const AllTeamsStrip = () => {
  const { t } = useTranslation('ops');
  const { numaGet } = useNumaRequest();
  const { teams, selectedTeamId, selectTeam, teamData, activeZoneId, setActiveZone } = useOps();

  // Cache of team data for non-selected teams: teamId → TeamResponse
  // Initialized from localStorage so zone names render instantly on remount.
  const [teamDataCache, setTeamDataCache] = useState<Map<string, TeamResponse>>(() => {
    const cached = getCached<Record<string, TeamResponse>>('allTeamsZones');
    return cached ? new Map(Object.entries(cached)) : new Map();
  });
  const fetchedRef = useRef<Set<string>>(
    new Set(
      (() => {
        const cached = getCached<Record<string, TeamResponse>>('allTeamsZones');
        return cached ? Object.keys(cached) : [];
      })(),
    ),
  );

  // Fetch zone data for all teams that aren't currently selected
  useEffect(() => {
    let cancelled = false;

    const fetchMissing = async () => {
      const toFetch = teams.filter((tm) => tm.id !== selectedTeamId && !fetchedRef.current.has(tm.id));
      if (toFetch.length === 0) return;

      const results = await Promise.allSettled(toFetch.map((tm) => OpsService.getTeam(numaGet, tm.id)));

      if (cancelled) return;

      setTeamDataCache((prev) => {
        const next = new Map(prev);
        toFetch.forEach((tm, i) => {
          const result = results[i];
          if (result.status === 'fulfilled') {
            next.set(tm.id, result.value);
            fetchedRef.current.add(tm.id);
          }
        });
        // Persist to localStorage for instant rendering on remount
        const obj: Record<string, TeamResponse> = {};
        next.forEach((v, k) => {
          obj[k] = v;
        });
        setCache('allTeamsZones', obj);
        return next;
      });
    };

    fetchMissing();

    return () => {
      cancelled = true;
    };
  }, [teams, selectedTeamId, numaGet]);

  // Helper: get zones for a team (use context data for selected, cache for others)
  const getZonesForTeam = useCallback(
    (teamId: string) => {
      if (teamId === selectedTeamId && teamData) {
        return teamData.zones;
      }
      return teamDataCache.get(teamId)?.zones ?? [];
    },
    [selectedTeamId, teamData, teamDataCache],
  );

  // Handle clicking a zone pill inside a team box
  const handleSelectZone = useCallback(
    (teamId: string, zoneId: string) => {
      if (teamId !== selectedTeamId) {
        selectTeam(teamId);
      }
      setActiveZone(zoneId);
    },
    [selectedTeamId, selectTeam, setActiveZone],
  );

  // Handle clicking a team name
  const handleSelectTeam = useCallback(
    (teamId: string) => {
      selectTeam(teamId);
    },
    [selectTeam],
  );

  if (teams.length === 0) {
    return (
      <div className="d-flex align-items-center gap-3 flex-grow-1">
        <span className="text-muted" style={{ fontSize: '0.85rem' }}>
          {t('teams.noTeams')}
        </span>
      </div>
    );
  }

  return (
    <div className="d-flex align-items-stretch gap-3 flex-grow-1" style={{ overflowX: 'auto' }}>
      {teams.map((team) => {
        const isSelected = team.id === selectedTeamId;
        const zones = getZonesForTeam(team.id);

        return (
          <TeamBox
            key={team.id}
            team={team}
            isSelected={isSelected}
            zones={zones}
            activeZoneId={isSelected ? activeZoneId : null}
            onSelectTeam={() => handleSelectTeam(team.id)}
            onSelectZone={(zoneId) => handleSelectZone(team.id, zoneId)}
          />
        );
      })}
    </div>
  );
};

// ─── Team Box ──────────────────────────────────────────────────────────────

interface TeamBoxProps {
  team: TeamSummary;
  isSelected: boolean;
  zones: { id: string; name: string; zoneType: string }[];
  activeZoneId: string | null;
  onSelectTeam: () => void;
  onSelectZone: (zoneId: string) => void;
}

const TeamBox = ({ team, isSelected, zones, activeZoneId, onSelectTeam, onSelectZone }: TeamBoxProps) => {
  return (
    <div
      className={`ops-team-box ${isSelected ? 'selected' : ''}`}
      style={{
        borderColor: isSelected ? team.color || '#0d6efd' : undefined,
        backgroundColor: isSelected ? `${team.color || '#0d6efd'}10` : undefined,
      }}
      onClick={onSelectTeam}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectTeam();
        }
      }}
    >
      {/* Team name row */}
      <div className="d-flex align-items-center gap-2">
        <span
          className="d-inline-block rounded-circle flex-shrink-0"
          style={{
            width: 9,
            height: 9,
            backgroundColor: team.color || '#6c757d',
          }}
        />
        <span
          className="fw-semibold text-truncate"
          style={{ fontSize: '0.85rem', color: isSelected ? team.color || '#0d6efd' : '#1a1a1a' }}
        >
          {team.name}
        </span>
      </div>

      {/* Zone links */}
      {zones.length > 0 && (
        <div className="d-flex align-items-center gap-1 flex-wrap">
          {zones.map((zone) => {
            const isActive = isSelected && zone.id === activeZoneId;
            return (
              <button
                key={zone.id}
                type="button"
                className={`ops-team-zone-link ${isActive ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectZone(zone.id);
                }}
              >
                <i className={`bi ${zone.zoneType === 'board' ? 'bi-kanban' : 'bi-list-task'}`} />
                {zone.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AllTeamsStrip;
