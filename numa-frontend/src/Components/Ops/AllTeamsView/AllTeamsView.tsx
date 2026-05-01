import { useState, useMemo } from 'react';
import { Nav } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../Providers/AuthProvider';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useAlert } from '../../../Providers/ConfirmContext';
import { useOps } from '../OpsContext';
import { CreateBoardWizard } from '../Modals/CreateBoardWizard';
import { ConfirmModal } from '../Modals/ConfirmModal';
import ActiveSprintStrip from '../ActiveSprintStrip';
import BoardView from '../BoardView/BoardView';
import BacklogView from '../BacklogView/BacklogView';
import * as OpsService from '../../../Services/OpsService';
import type { BoardSummary } from '../../../types/ops';

/**
 * AllTeamsView — "All Teams" board-view mode.
 *
 * Shows every team as a horizontal card. The selected team's card is
 * highlighted and its zone tabs are shown beneath it. Below the card
 * row the active zone's content (board or backlog) is rendered.
 *
 * Selecting a different team card triggers the normal selectBoard flow
 * which loads that team's data, tickets, and work units.
 */
const AllTeamsView = () => {
  const { t } = useTranslation('ops');
  const { user } = useAuth();
  const { numaDelete } = useNumaRequest();
  const showAlert = useAlert();
  const {
    boards,
    selectedBoardId,
    selectBoard,
    refreshBoards,
    refreshConfig,
    boardData,
    boardLoading,
    tickets,
    workUnits,
    activeZoneId,
    setActiveZone,
  } = useOps();

  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [boardToDelete, setBoardToDelete] = useState<BoardSummary | null>(null);

  const zones = boardData?.zones ?? [];
  const activeZone = useMemo(() => zones.find((z) => z.id === activeZoneId) ?? null, [zones, activeZoneId]);

  const hasWorkUnits = Boolean(boardData?.board?.workUnitSeries?.enabled);
  const showSprintStrip = activeZone?.zoneType === 'board' && hasWorkUnits;

  // Ticket count per team (only available for the selected team)
  const selectedBoardTicketCount = useMemo(
    () => (selectedBoardId ? tickets.filter((tk) => !tk.archived).length : 0),
    [selectedBoardId, tickets]
  );

  // Active work unit for the selected team
  const activeWorkUnit = useMemo(
    () => (hasWorkUnits ? (workUnits.find((wu) => wu.status === 'active') ?? null) : null),
    [hasWorkUnits, workUnits]
  );

  const handleDeleteTeam = async () => {
    if (!boardToDelete) return;
    try {
      await OpsService.deleteBoard(numaDelete, boardToDelete.id);
      setBoardToDelete(null);
      refreshBoards();
      if (selectedBoardId === boardToDelete.id) {
        selectBoard('');
      }
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes('409')) {
        await showAlert({ message: t('boards.deleteTeamHasTickets'), variant: 'warning' });
      } else {
        await showAlert({ message: t('errors.saveFailed', { message: msg }), variant: 'error' });
      }
    }
  };

  if (boards.length === 0) {
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
              <h4 className="fw-bold mb-1">{t('boards.welcome.headline')}</h4>
              <p className="text-muted mb-0">{t('boards.welcome.subtitle')}</p>
            </div>

            {/* Feature highlights */}
            <div className="d-flex justify-content-center gap-4 mb-4">
              {[
                { icon: 'bi-check2-square', text: t('boards.welcome.featureTracking') },
                { icon: 'bi-sliders', text: t('boards.welcome.featureWorkflows') },
                { icon: 'bi-lightning-charge', text: t('boards.welcome.featureSprints') },
              ].map(({ icon, text }) => (
                <div key={icon} className="text-center" style={{ maxWidth: 120 }}>
                  <i className={`bi ${icon} fs-5 text-primary d-block mb-1`} />
                  <small className="text-muted">{text}</small>
                </div>
              ))}
            </div>

            {/* Description */}
            <p className="text-center text-muted mb-2">{t('boards.welcome.body')}</p>
            <p className="text-center mb-4" style={{ fontSize: '0.85rem' }}>
              <i className="bi bi-lightbulb text-warning me-1" />
              <span className="text-muted fst-italic">{t('boards.welcome.soloTip')}</span>
            </p>

            {/* CTA */}
            <div className="text-center">
              <button type="button" className="btn btn-primary btn-lg px-4" onClick={() => setShowCreateTeam(true)}>
                <i className="bi bi-plus-lg me-2" />
                {t('boards.welcome.cta')}
              </button>
            </div>
          </div>
        </div>
        <CreateBoardWizard
          show={showCreateTeam}
          onHide={() => setShowCreateTeam(false)}
          onCreated={async (team) => {
            setShowCreateTeam(false);
            await refreshConfig();
            refreshBoards();
            selectBoard(team.id);
          }}
        />
      </>
    );
  }

  return (
    <div className="d-flex flex-column h-100">
      {/* ── Team Cards Row ─────────────────────────────────────── */}
      <div className="d-flex flex-wrap gap-3 px-3 py-3">
        {boards.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            isSelected={team.id === selectedBoardId}
            ticketCount={team.id === selectedBoardId ? selectedBoardTicketCount : null}
            activeWorkUnitName={team.id === selectedBoardId ? (activeWorkUnit?.name ?? null) : null}
            onSelect={() => selectBoard(team.id)}
            isOwner={Boolean(
              team.createdBy && user?.decoded_tokens?.idToken?.sub && team.createdBy === user.decoded_tokens.idToken.sub
            )}
            onDelete={() => setBoardToDelete(team)}
          />
        ))}
      </div>

      {/* ── Zone Tabs for Selected Team ────────────────────────── */}
      {selectedBoardId && zones.length > 0 && (
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
        {boardLoading && !boardData ? (
          <div className="d-flex justify-content-center align-items-center py-5 text-muted">
            <div className="spinner-border spinner-border-sm me-2" role="status" />
            {t('common.loading')}
          </div>
        ) : !selectedBoardId ? (
          <div className="text-center text-muted py-5">{t('boards.noBoards')}</div>
        ) : activeZone?.zoneType === 'board' ? (
          <BoardView />
        ) : activeZone?.zoneType === 'backlog' ? (
          <BacklogView />
        ) : null}
      </div>

      <ConfirmModal
        show={boardToDelete !== null}
        title={t('boards.deleteTeam')}
        message={t('boards.deleteTeamConfirm', { name: boardToDelete?.name ?? '' })}
        confirmLabel={t('boards.deleteTeam')}
        variant="danger"
        onConfirm={handleDeleteTeam}
        onHide={() => setBoardToDelete(null)}
      />
    </div>
  );
};

// ─── Team Card ──────────────────────────────────────────────────────────────

interface TeamCardProps {
  team: BoardSummary;
  isSelected: boolean;
  ticketCount: number | null;
  activeWorkUnitName: string | null;
  onSelect: () => void;
  isOwner: boolean;
  onDelete: () => void;
}

const TeamCard = ({
  team,
  isSelected,
  ticketCount,
  activeWorkUnitName,
  onSelect,
  isOwner,
  onDelete,
}: TeamCardProps) => {
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
        <span className="fw-semibold text-truncate" style={{ fontSize: '0.85rem', flexGrow: 1 }}>
          {team.name}
        </span>
        {isOwner && (
          <button
            type="button"
            className="btn btn-link text-danger p-0 ms-auto delete-team-btn"
            style={{ fontSize: '0.8rem', opacity: 0.6 }}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.6')}
          >
            <i className="bi bi-trash" />
          </button>
        )}
      </div>

      <div className="d-flex align-items-center gap-2">
        {/* Ticket count (only shown for selected team) */}
        {ticketCount !== null && (
          <span className="text-muted" style={{ fontSize: '0.75rem' }}>
            {t('boards.tickets', { count: ticketCount })}
          </span>
        )}

        {/* Active sprint indicator */}
        {activeWorkUnitName && (
          <span
            className="badge bg-success bg-opacity-10 text-success"
            style={{ fontSize: '0.65rem' }}
            title={t('boards.activeSprint')}
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
