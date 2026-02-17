import { Dropdown } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

type TeamSummaryItem = {
  id: string;
  name: string;
  color?: string;
  order?: number;
};

type TeamSelectorProps = {
  currentTeam: TeamSummaryItem | null;
  teams: TeamSummaryItem[];
  isAllTeams: boolean;
  onSelectTeam: (teamId: string) => void;
  onSelectAllTeams: () => void;
  onCreateTeam: () => void;
};

const TeamSelector = ({
  currentTeam,
  teams,
  isAllTeams,
  onSelectTeam,
  onSelectAllTeams,
  onCreateTeam,
}: TeamSelectorProps) => {
  const { t } = useTranslation('ops');

  return (
    <Dropdown>
      <Dropdown.Toggle variant="outline-secondary" size="sm" id="team-selector-dropdown">
        {isAllTeams ? (
          <span className="d-flex align-items-center gap-1">
            <i className="bi bi-grid me-1" style={{ fontSize: '0.75rem' }} />
            {t('teams.allTeamsLabel')}
          </span>
        ) : currentTeam ? (
          <span className="d-flex align-items-center gap-1">
            <span
              className="d-inline-block rounded-circle"
              style={{ width: 8, height: 8, backgroundColor: currentTeam.color ?? '#6c757d' }}
            />
            {currentTeam.name}
          </span>
        ) : (
          t('teams.selector')
        )}
      </Dropdown.Toggle>

      <Dropdown.Menu style={{ maxHeight: 400, overflowY: 'auto' }}>
        {/* All Teams option */}
        <Dropdown.Item active={isAllTeams} onClick={onSelectAllTeams}>
          <span className="d-flex align-items-center gap-2">
            <i className="bi bi-grid" style={{ fontSize: '0.85rem' }} />
            {t('teams.allTeamsLabel')}
          </span>
        </Dropdown.Item>

        {teams.length > 0 && <Dropdown.Divider />}

        {teams.map((team) => (
          <Dropdown.Item
            key={team.id}
            active={!isAllTeams && team.id === currentTeam?.id}
            onClick={() => onSelectTeam(team.id)}
          >
            <span className="d-flex align-items-center gap-2">
              <span
                className="d-inline-block rounded-circle"
                style={{ width: 8, height: 8, backgroundColor: team.color ?? '#6c757d' }}
              />
              {team.name}
            </span>
          </Dropdown.Item>
        ))}

        {teams.length > 0 && <Dropdown.Divider />}
        <Dropdown.Item onClick={onCreateTeam}>
          <i className="bi bi-plus me-1" />
          {t('teams.newTeam')}
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
};

export default TeamSelector;
