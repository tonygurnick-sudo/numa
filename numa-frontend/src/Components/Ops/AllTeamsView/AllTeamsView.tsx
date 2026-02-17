import { useState, useMemo } from 'react';
import { Nav } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useOps } from '../OpsContext';
import { CreateTeamWizard } from '../Modals/CreateTeamWizard';
import ActiveSprintStrip from '../ActiveSprintStrip';
import BoardView from '../BoardView/BoardView';
import BacklogView from '../BacklogView/BacklogView';
import type { TeamSummary } from '../../../types/ops';

/**
 * AllTeamsView — "All Teams" board-view mode.
 *
 * Shows every team as a horizontal card. The selected team's card is
 * highlighted and its zone tabs are shown beneath it. Below the card
 * row the active zone's content (board or backlog) is rendered.
 *
 * Selecting a different team card triggers the normal selectTeam flow
 * which loads that team's data, tickets, and work units.
 */
const AllTeamsView = () => {
  const { t } = useTranslation('ops');
  const {
    teams,
    selectedTeamId,
    selectTeam,
    refreshTeams,
    teamData,
    teamLoading,
    tickets,
    workUnits,
    activeZoneId,
    setActiveZone,
  } = useOps();

  const [showCreateTeam, setShowCreateTeam] = useState(false);

  const zones = teamData?.zones ?? [];
  const activeZone = useMemo(() => zones.find((z) => z.id === activeZoneId) ?? null, [zones, activeZoneId]);

  const hasWorkUnits = Boolean(teamData?.team?.workUnitSeries?.enabled);
  const showSprintStrip = activeZone?.zoneType === 'board' && hasWorkUnits;

  // Ticket count per team (only available for the selected team)
  const selectedTeamTicketCount = useMemo(
    () => (selectedTeamId ? tickets.filter((tk) => !tk.archived).length : 0),
    [selectedTeamId, tickets],
  );

  // Active work unit for the selected team
  const activeWorkUnit = useMemo(
    () => (hasWorkUnits ? (workUnits.find((wu) => wu.status === 'active') ?? null) : null),
    [hasWorkUnits, workUnits],
  );

  if (teams.length === 0) {
    return (
      <>
        <div className="d-flex justify-content-center align-items-start py-5 px-3">
          <div style={{ maxWidth: 520, width: '100%' }}>
            {/* Header */}
            <div className="text-center mb-4">
              <div
                className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3"
                style={{ width: 64, height: 64, backgroundColor: '#eef2ff' }}
              >
                <i className="bi bi-kanban fs-2" style={{ color: '#6366f1' }} />
              </div>
              <h4 className="fw-bold mb-1">{t('teams.welcome.headline')}</h4>
              <p className="text-muted mb-0">{t('teams.welcome.subtitle')}</p>
            </div>

            {/* Feature highlights */}
            <div className="d-flex justify-content-center gap-4 mb-4">
              {[
                { icon: 'bi-check2-square', text: t('teams.welcome.featureTracking') },
                { icon: 'bi-sliders', text: t('teams.welcome.featureWorkflows') },
                { icon: 'bi-lightning-charge', text: t('teams.welcome.featureSprints') },
              ].map(({ icon, text }) => (
                <div key={icon} className="text-center" style={{ maxWidth: 120 }}>
                  <i className={`bi ${icon} fs-5 text-primary d-block mb-1`} />
                  <small className="text-muted">{text}</small>
                </div>
              ))}
            </div>

            {/* Description */}
            <p className="text-center text-muted mb-2">{t('teams.welcome.body')}</p>
            <p className="text-center mb-4" style={{ fontSize: '0.85rem' }}>
              <i className="bi bi-lightbulb text-warning me-1" />
              <span className="text-muted fst-italic">{t('teams.welcome.soloTip')}</span>
            </p>

            {/* CTA */}
            <div className="text-center">
              <button type="button" className="btn btn-primary btn-lg px-4" onClick={() => setShowCreateTeam(true)}>
                <i className="bi bi-plus-lg me-2" />
                {t('teams.welcome.cta')}
              </button>
            </div>
          </div>
        </div>
        <CreateTeamWizard
          show={showCreateTeam}
          onHide={() => setShowCreateTeam(false)}
          onCreated={(team) => {
            setShowCreateTeam(false);
            refreshTeams();
            selectTeam(team.id);
          }}
        />
      </>
    );
  }

  return (
    <div className="d-flex flex-column h-100">
      {/* ── Team Cards Row ─────────────────────────────────────── */}
      <div className="d-flex gap-3 px-3 py-3" style={{ overflowX: 'auto' }}>
        {teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            isSelected={team.id === selectedTeamId}
            ticketCount={team.id === selectedTeamId ? selectedTeamTicketCount : null}
            activeWorkUnitName={team.id === selectedTeamId ? (activeWorkUnit?.name ?? null) : null}
            onSelect={() => selectTeam(team.id)}
          />
        ))}
      </div>

      {/* ── Zone Tabs for Selected Team ────────────────────────── */}
      {selectedTeamId && zones.length > 0 && (
        <div className="px-3 border-bottom bg-white">
          <Nav variant="tabs" className="border-0 gap-1">
            {zones.map((zone) => (
              <Nav.Item key={zone.id}>
                <Nav.Link
                  active={activeZoneId === zone.id}
                  onClick={() => setActiveZone(zone.id)}
                  className="py-1 px-2 border-0"
                  style={{ fontSize: '0.8rem' }}
                >
                  <i className={`bi ${zone.zoneType === 'board' ? 'bi-kanban' : 'bi-list-task'} me-1`} />
                  {zone.name}
                </Nav.Link>
              </Nav.Item>
            ))}
          </Nav>
        </div>
      )}

      {/* ── Sprint Strip ───────────────────────────────────────── */}
      {showSprintStrip && <ActiveSprintStrip />}

      {/* ── Zone Content ───────────────────────────────────────── */}
      <div className="flex-grow-1 overflow-auto">
        {teamLoading && !teamData ? (
          <div className="d-flex justify-content-center align-items-center py-5 text-muted">
            <div className="spinner-border spinner-border-sm me-2" role="status" />
            {t('common.loading')}
          </div>
        ) : !selectedTeamId ? (
          <div className="text-center text-muted py-5">{t('teams.noTeams')}</div>
        ) : activeZone?.zoneType === 'board' ? (
          <BoardView />
        ) : activeZone?.zoneType === 'backlog' ? (
          <BacklogView />
        ) : null}
      </div>
    </div>
  );
};

// ─── Team Card ──────────────────────────────────────────────────────────────

interface TeamCardProps {
  team: TeamSummary;
  isSelected: boolean;
  ticketCount: number | null;
  activeWorkUnitName: string | null;
  onSelect: () => void;
}

const TeamCard = ({ team, isSelected, ticketCount, activeWorkUnitName, onSelect }: TeamCardProps) => {
  const { t } = useTranslation('ops');

  return (
    <button
      type="button"
      className="btn text-start flex-shrink-0"
      onClick={onSelect}
      style={{
        width: 200,
        border: isSelected ? '2px solid #0d6efd' : '1px solid #dee2e6',
        borderRadius: 8,
        backgroundColor: isSelected ? '#f0f6ff' : '#fff',
        transition: 'border-color 0.15s, background-color 0.15s',
      }}
    >
      <div className="d-flex align-items-center gap-2 mb-1">
        {/* Color dot */}
        <span
          className="d-inline-block rounded-circle flex-shrink-0"
          style={{
            width: 10,
            height: 10,
            backgroundColor: team.color || '#6c757d',
          }}
        />
        <span className="fw-semibold text-truncate" style={{ fontSize: '0.85rem' }}>
          {team.name}
        </span>
      </div>

      <div className="d-flex align-items-center gap-2">
        {/* Ticket count (only shown for selected team) */}
        {ticketCount !== null && (
          <span className="text-muted" style={{ fontSize: '0.75rem' }}>
            {t('teams.tickets', { count: ticketCount })}
          </span>
        )}

        {/* Active sprint indicator */}
        {activeWorkUnitName && (
          <span
            className="badge bg-success bg-opacity-10 text-success"
            style={{ fontSize: '0.65rem' }}
            title={t('teams.activeSprint')}
          >
            <i className="bi bi-lightning-charge me-1" />
            {activeWorkUnitName}
          </span>
        )}
      </div>
    </button>
  );
};

export default AllTeamsView;
