import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useOps } from './OpsContext';
import * as OpsService from '../../Services/OpsService';
import type { BoardSummary, BoardResponse } from '../../types/ops';
import { getCached, setCache } from '../../utils/opsCache';

/**
 * AllBoardsStrip — header strip for "All Boards" board view mode.
 *
 * Fetches zone data for every board so all board boxes can display zone
 * pills (matching Ian's design). The selected board uses the context's
 * `boardData` directly; other boards are fetched on mount and cached.
 */
interface AllBoardsStripProps {
  canManage?: boolean;
  currentUserSub?: string;
  pinnedBoardIds: string[] | null;
  onOpenBoardSettings?: (boardId: string) => void;
}

const AllBoardsStrip = ({ canManage, currentUserSub, pinnedBoardIds, onOpenBoardSettings }: AllBoardsStripProps) => {
  const { t } = useTranslation('ops');
  const { numaGet } = useNumaRequest();
  const { boards, selectedBoardId, selectBoard, boardData, activeZoneId, setActiveZone } = useOps();

  // Cache of team data for non-selected teams: boardId → BoardResponse
  // Initialized from localStorage so zone names render instantly on remount.
  const [boardDataCache, setBoardDataCache] = useState<Map<string, BoardResponse>>(() => {
    const cached = getCached<Record<string, BoardResponse>>('allBoardsZones');
    return cached ? new Map(Object.entries(cached)) : new Map();
  });

  // Refresh zone data for every non-selected board on mount and whenever the
  // boards list changes. The cache provides instant first render via
  // localStorage; this background refresh corrects any drift (zones
  // renamed/deleted on other boards, sprints completed elsewhere) — without
  // it, stale entries persisted across sessions, e.g. showing a Backlog zone
  // that was deleted weeks ago.
  useEffect(() => {
    let cancelled = false;

    const refreshAll = async () => {
      const toFetch = boards.filter((tm) => tm.id !== selectedBoardId);
      const validIds = new Set(boards.map((b) => b.id));

      const results = toFetch.length
        ? await Promise.allSettled(toFetch.map((tm) => OpsService.getBoard(numaGet, tm.id)))
        : [];

      if (cancelled) return;

      setBoardDataCache((prev) => {
        const next = new Map(prev);
        toFetch.forEach((tm, i) => {
          const result = results[i];
          if (result.status === 'fulfilled') {
            next.set(tm.id, result.value);
          }
        });
        // Evict cache entries for boards that no longer exist
        for (const k of [...next.keys()]) {
          if (!validIds.has(k)) next.delete(k);
        }
        const obj: Record<string, BoardResponse> = {};
        next.forEach((v, k) => {
          obj[k] = v;
        });
        setCache('allBoardsZones', obj);
        return next;
      });
    };

    refreshAll();

    return () => {
      cancelled = true;
    };
  }, [boards, selectedBoardId, numaGet]);

  // Mirror the currently-selected board's fresh data into the cache so that
  // when the user navigates away, the strip immediately shows up-to-date
  // zones without waiting for the next refresh cycle.
  useEffect(() => {
    if (!boardData?.board?.id) return;
    const id = boardData.board.id;
    setBoardDataCache((prev) => {
      const next = new Map(prev);
      next.set(id, boardData);
      const obj: Record<string, BoardResponse> = {};
      next.forEach((v, k) => {
        obj[k] = v;
      });
      setCache('allBoardsZones', obj);
      return next;
    });
  }, [boardData]);

  // Helper: get zones for a team (use context data for selected, cache for others)
  const getZonesForBoard = useCallback(
    (boardId: string) => {
      if (boardId === selectedBoardId && boardData) {
        return boardData.zones;
      }
      return boardDataCache.get(boardId)?.zones ?? [];
    },
    [selectedBoardId, boardData, boardDataCache]
  );

  // Helper: get active work unit name for a team
  const getActiveSprintName = useCallback(
    (boardId: string): string | null => {
      const data = boardId === selectedBoardId && boardData ? boardData : boardDataCache.get(boardId);
      if (!data?.board?.workUnitSeries?.enabled || !data.activeWorkUnit) return null;
      return data.activeWorkUnit.name ?? null;
    },
    [selectedBoardId, boardData, boardDataCache]
  );

  // Handle clicking a zone pill inside a team box
  const handleSelectZone = useCallback(
    (boardId: string, zoneId: string) => {
      if (boardId !== selectedBoardId) {
        selectBoard(boardId);
      }
      setActiveZone(zoneId);
    },
    [selectedBoardId, selectBoard, setActiveZone]
  );

  // Handle clicking a team name
  const handleSelectBoard = useCallback(
    (boardId: string) => {
      selectBoard(boardId);
    },
    [selectBoard]
  );

  const visibleBoards = pinnedBoardIds === null ? boards : boards.filter((b) => pinnedBoardIds.includes(b.id));

  if (boards.length === 0) {
    return (
      <div className="d-flex align-items-center gap-3 flex-grow-1">
        <span className="text-muted" style={{ fontSize: '0.85rem' }}>
          {t('boards.noBoards')}
        </span>
      </div>
    );
  }

  if (visibleBoards.length === 0) {
    return (
      <div className="d-flex align-items-center gap-3 flex-grow-1">
        <span className="text-muted" style={{ fontSize: '0.85rem' }}>
          {t('boards.noPinnedBoards')}
        </span>
      </div>
    );
  }

  return (
    <div
      className="d-flex align-items-stretch gap-3 flex-grow-1 ops-hide-scrollbar pb-2 pb-md-0 px-3 px-md-0"
      style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
    >
      {visibleBoards.map((team) => {
        const isSelected = team.id === selectedBoardId;
        const zones = getZonesForBoard(team.id);
        const activeSprintName = getActiveSprintName(team.id);

        return (
          <BoardBox
            key={team.id}
            team={team}
            isSelected={isSelected}
            zones={zones}
            activeZoneId={isSelected ? activeZoneId : null}
            activeSprintName={activeSprintName}
            onSelectBoard={() => handleSelectBoard(team.id)}
            onSelectZone={(zoneId) => handleSelectZone(team.id, zoneId)}
            onOpenSettings={
              (canManage ||
                (currentUserSub &&
                  (team.createdBy === currentUserSub || team.accessControl?.owners?.includes(currentUserSub)))) &&
              onOpenBoardSettings
                ? () => onOpenBoardSettings(team.id)
                : undefined
            }
          />
        );
      })}
    </div>
  );
};

// ─── Board Box ──────────────────────────────────────────────────────────────

interface BoardBoxProps {
  team: BoardSummary;
  isSelected: boolean;
  zones: { id: string; name: string; zoneType: string }[];
  activeZoneId: string | null;
  activeSprintName: string | null;
  onSelectBoard: () => void;
  onSelectZone: (zoneId: string) => void;
  onOpenSettings?: () => void;
}

const BoardBox = ({
  team,
  isSelected,
  zones,
  activeZoneId,
  activeSprintName,
  onSelectBoard,
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
      onClick={onSelectBoard}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectBoard();
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
