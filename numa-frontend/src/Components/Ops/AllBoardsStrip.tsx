import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useOps } from './OpsContext';
import * as OpsService from '../../Services/OpsService';
import type { TeamSummary, TeamResponse } from '../../types/ops';
import { getCached, setCache } from '../../utils/opsCache';

/**
 * AllBoardsStrip — header strip for "All Boards" board view mode.
 *
 * Fetches zone data for every board so all board boxes can display zone
 * pills (matching Ian's design). The selected board uses the context's
 * `teamData` directly; other boards are fetched on mount and cached.
 */
interface AllBoardsStripProps {
  canManage?: boolean;
  onOpenTeamSettings?: (teamId: string) => void;
}

const AllBoardsStrip = ({ canManage, onOpenTeamSettings }: AllBoardsStripProps) => {
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
      })()
    )
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
    [selectedTeamId, teamData, teamDataCache]
  );

  // Helper: get active work unit name for a team
  const getActiveSprintName = useCallback(
    (teamId: string): string | null => {
      const data = teamId === selectedTeamId && teamData ? teamData : teamDataCache.get(teamId);
      if (!data?.team?.workUnitSeries?.enabled || !data.activeWorkUnit) return null;
      return data.activeWorkUnit.name ?? null;
    },
    [selectedTeamId, teamData, teamDataCache]
  );

  // Handle clicking a zone pill inside a team box
  const handleSelectZone = useCallback(
    (teamId: string, zoneId: string) => {
      if (teamId !== selectedTeamId) {
        selectTeam(teamId);
      }
      setActiveZone(zoneId);
    },
    [selectedTeamId, selectTeam, setActiveZone]
  );

  // Handle clicking a team name
  const handleSelectTeam = useCallback(
    (teamId: string) => {
      selectTeam(teamId);
    },
    [selectTeam]
  );

  if (teams.length === 0) {
    return (
      <div className="d-flex align-items-center gap-3 flex-grow-1">
        <span className="text-muted" style={{ fontSize: '0.85rem' }}>
          {t('boards.noBoards')}
        </span>
      </div>
    );
  }

  return (
    <div
      className="d-flex align-items-stretch gap-3 flex-grow-1 ops-hide-scrollbar pb-2 pb-md-0 px-3 px-md-0"
      style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
    >
      {teams.map((team) => {
        const isSelected = team.id === selectedTeamId;
        const zones = getZonesForTeam(team.id);
        const activeSprintName = getActiveSprintName(team.id);

        return (
          <BoardBox
            key={team.id}
            team={team}
            isSelected={isSelected}
            zones={zones}
            activeZoneId={isSelected ? activeZoneId : null}
            activeSprintName={activeSprintName}
            onSelectTeam={() => handleSelectTeam(team.id)}
            onSelectZone={(zoneId) => handleSelectZone(team.id, zoneId)}
            onOpenSettings={canManage && onOpenTeamSettings ? () => onOpenTeamSettings(team.id) : undefined}
          />
        );
      })}
    </div>
  );
};

// ─── Board Box ──────────────────────────────────────────────────────────────

interface BoardBoxProps {
  team: TeamSummary;
  isSelected: boolean;
  zones: { id: string; name: string; zoneType: string }[];
  activeZoneId: string | null;
  activeSprintName: string | null;
  onSelectTeam: () => void;
  onSelectZone: (zoneId: string) => void;
  onOpenSettings?: () => void;
}

const BoardBox = ({
  team,
  isSelected,
  zones,
  activeZoneId,
  activeSprintName,
  onSelectTeam,
  onSelectZone,
  onOpenSettings,
}: BoardBoxProps) => {
  const { t } = useTranslation('ops');
  return (
    <div
      className={`ops-team-box ops-board-box border bg-white ${isSelected ? 'selected' : ''}`}
      style={{
        cursor: 'pointer',
        minWidth: 140,
        height: '100%',
        borderColor: isSelected ? team.color || '#0d6efd' : 'var(--bs-border-color)',
        borderWidth: isSelected ? '2px' : '1px',
        backgroundColor: isSelected ? `${team.color || '#0d6efd'}10` : 'white',
        padding: '8px 12px',
        borderRadius: '12px',
        transition: 'all 0.2s ease',
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
      {/* Board name row */}
      <div className="d-flex align-items-center gap-2 mb-1">
        <span
          className="d-inline-block rounded-circle flex-shrink-0"
          style={{
            width: 8,
            height: 8,
            backgroundColor: team.color || '#6c757d',
          }}
        />
        <span
          className="fw-bold text-truncate"
          style={{ fontSize: '0.85rem', color: isSelected ? team.color || '#0d6efd' : '#495057' }}
        >
          {team.name}
        </span>
        {onOpenSettings && (
          <button
            type="button"
            className="btn btn-link text-muted p-0 ms-auto flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onOpenSettings();
            }}
            title={t('boards.settings')}
            style={{ fontSize: '0.8rem', lineHeight: 1 }}
          >
            <i className="bi bi-sliders" />
          </button>
        )}
      </div>

      {/* Zone links */}
      {zones.length > 0 && (
        <div className="d-flex align-items-center gap-2 flex-wrap mt-2">
          {zones.map((zone) => {
            const isActive = isSelected && zone.id === activeZoneId;
            return (
              <button
                key={zone.id}
                type="button"
                className={`ops-team-zone-link bg-transparent border-0 p-0 d-flex align-items-center gap-1 ${isActive ? 'active fw-bold' : 'text-muted'}`}
                style={{
                  fontSize: '0.75rem',
                  transition: 'color 0.2s',
                  color: isActive ? team.color || '#0d6efd' : 'inherit',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectZone(zone.id);
                }}
              >
                <i
                  className={`bi ${zone.zoneType === 'board' ? 'bi-kanban' : 'bi-list-task'}`}
                  style={{ fontSize: '0.7rem' }}
                />
                {zone.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Active sprint indicator */}
      {activeSprintName && (
        <div className="d-flex align-items-center gap-1 mt-1" style={{ fontSize: '0.75rem' }}>
          <span className="d-inline-block rounded-circle" style={{ width: 6, height: 6, backgroundColor: '#198754' }} />
          <span className="text-muted">{activeSprintName}</span>
        </div>
      )}
    </div>
  );
};

export default AllBoardsStrip;
