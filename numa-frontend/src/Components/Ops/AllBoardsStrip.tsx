import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useOps } from './OpsContext';
import type { TeamSummary } from '../../types/ops';

/**
 * AllBoardsStrip — header strip for "All Boards" board view mode.
 */
const AllBoardsStrip = () => {
  const { t } = useTranslation('ops');
  const { teams, selectedTeamId, selectTeam } = useOps();

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
          {t('boards.noBoards')}
        </span>
      </div>
    );
  }

  return (
    <div className="d-flex align-items-stretch gap-3 flex-grow-1" style={{ overflowX: 'auto' }}>
      {teams.map((team) => {
        const isSelected = team.id === selectedTeamId;

        return (
          <BoardBox key={team.id} team={team} isSelected={isSelected} onSelectBoard={() => handleSelectTeam(team.id)} />
        );
      })}
    </div>
  );
};

// ─── Team Box ──────────────────────────────────────────────────────────────

interface BoardBoxProps {
  team: TeamSummary;
  isSelected: boolean;
  onSelectBoard: () => void;
}

const BoardBox = ({ team, isSelected, onSelectBoard }: BoardBoxProps) => {
  return (
    <div
      className={`ops-board-box ${isSelected ? 'selected' : ''}`}
      style={{
        borderColor: isSelected ? team.color || '#0d6efd' : undefined,
        backgroundColor: isSelected ? `${team.color || '#0d6efd'}10` : undefined,
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
    </div>
  );
};

export default AllBoardsStrip;
