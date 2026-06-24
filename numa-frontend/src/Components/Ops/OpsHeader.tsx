import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../Providers/AuthProvider';
import { useBranding } from '../../Providers/BrandingContext';
import { useBrandingAsset } from '../../hooks/useBrandingAsset';
import DefaultLogo from '../../../public/numa-logo.svg';
import { useOps } from './OpsContext';
import { CreateTicketModal } from './Modals/CreateTicketModal';
import { TicketSuccessModal } from './Modals/TicketSuccessModal';
import { TicketDetailModal } from './Modals/TicketDetailModal';
import { GlobalSettingsModal } from './Modals/GlobalSettingsModal';
import { BoardSettingsModal } from './Modals/BoardSettingsModal';
import { CreateBoardWizard } from './Modals/CreateBoardWizard';
import BoardSelector from './BoardSelector';
import ZoneSprintStrip from './ZoneSprintStrip';
import AllBoardsStrip from './AllBoardsStrip';
import { useActivityBadgeCount } from './useActivityBadgeCount';
import { getCached, setCache } from '../../utils/opsCache';
import type { Ticket } from '../../types/ops';
import type { OpsTopView } from './useOpsData';
import './BoardView/kanban.css';

// ── Top-level navigation tabs ────────────────────────────────────────────────

const OPS_TOP_VIEWS: { key: OpsTopView; labelKey: string; icon: string }[] = [
  { key: 'board', labelKey: 'tabs.board', icon: 'bi-grid-3x3-gap' },
  { key: 'customers', labelKey: 'tabs.customers', icon: 'bi-people' },
  { key: 'allTickets', labelKey: 'tabs.allTickets', icon: 'bi-list-task' },
  { key: 'suppliers', labelKey: 'tabs.suppliers', icon: 'bi-truck' },
  { key: 'projects', labelKey: 'tabs.projects', icon: 'bi-folder' },
  { key: 'roadmap', labelKey: 'tabs.roadmap', icon: 'bi-signpost-split' },
];

// ── Component ────────────────────────────────────────────────────────────────

type OpsHeaderProps = {
  activityOpen?: boolean;
  onToggleActivity?: () => void;
};

const OpsHeader = ({ activityOpen, onToggleActivity }: OpsHeaderProps = {}) => {
  const { t } = useTranslation('ops');
  const { user } = useAuth();
  const activityBadgeCount = useActivityBadgeCount();
  const { branding } = useBranding();
  const rawNavLogo = branding.resolvedAssets?.logoNav || branding.assets?.logoNav || branding.logo || DefaultLogo;
  const navLogo = useBrandingAsset(rawNavLogo, DefaultLogo);
  const {
    boards,
    selectedBoardId,
    topView,
    setTopView,
    boardViewMode,
    setBoardViewMode,
    selectBoard,
    refreshBoard,
    refreshBoards,
    refreshConfig,
    myWorkFilter,
    setMyWorkFilter,
  } = useOps();

  // ── Pinned boards (which boards appear in the All Boards strip) ──────────
  const [pinnedBoardIds, setPinnedBoardIds] = useState<string[] | null>(() => getCached<string[]>('pinnedBoards'));

  const handleToggleBoardPin = useCallback(
    (boardId: string) => {
      setPinnedBoardIds((prev) => {
        // null means "all shown" — first toggle initialises from full board list
        const current = prev ?? boards.map((b) => b.id);
        const next = current.includes(boardId) ? current.filter((id) => id !== boardId) : [...current, boardId];
        setCache('pinnedBoards', next);
        return next;
      });
    },
    [boards]
  );

  // ── Modal state ──────────────────────────────────────────────────────────
  const [showCreateTicket, setShowCreateTicket] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [showBoardSettings, setShowBoardSettings] = useState(false);
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [showTicketSuccess, setShowTicketSuccess] = useState(false);
  const [showTicketDetail, setShowTicketDetail] = useState(false);
  const [successTicket, setSuccessTicket] = useState<Ticket | null>(null);
  const [detailTicketId, setDetailTicketId] = useState<string | null>(null);

  const canManage = Boolean(user?.features?.includes('manageUsers'));
  const currentUserSub = user?.decoded_tokens?.idToken?.sub;
  const selectedBoard = boards.find((tm) => tm.id === selectedBoardId);
  const isTeamOwner = Boolean(
    currentUserSub &&
    selectedBoard &&
    (selectedBoard.createdBy === currentUserSub || selectedBoard.accessControl?.owners?.includes(currentUserSub))
  );

  return (
    <>
      <div className="ops-header-sticky">
        {/* ── Row 1: Title + Team Selector | Nav Tabs + Actions ── */}
        <div
          className="d-flex align-items-center justify-content-between px-2 px-md-3 py-2 border-bottom bg-white flex-wrap"
          style={{ minHeight: 64 }}
        >
          {/* Left: Page Title */}
          <div className="d-flex align-items-center gap-2 gap-md-4">
            <div
              className="d-flex align-items-center gap-2"
              style={{ cursor: canManage ? 'pointer' : 'default' }}
              onClick={() => {
                if (canManage) setTopView('home');
              }}
              role={canManage ? 'button' : undefined}
              tabIndex={canManage ? 0 : undefined}
              onKeyDown={
                canManage
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setTopView('home');
                      }
                    }
                  : undefined
              }
            >
              <img src={navLogo} alt={t('title')} style={{ height: 40, width: 40, objectFit: 'contain' }} />
              <div className="d-flex flex-column lh-sm">
                <span className="fw-bold text-dark" style={{ fontSize: '1.15rem' }}>
                  {t('title')}
                </span>
                <span className="text-muted d-none d-lg-inline" style={{ fontSize: '0.78rem' }}>
                  {t('subtitle')}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Nav tabs + actions grouped together */}
          <div className="d-flex align-items-center gap-2 gap-md-3">
            <div className="ops-nav-tabs d-flex flex-wrap" style={{ paddingBottom: 4 }}>
              {OPS_TOP_VIEWS.map(({ key, labelKey, icon }) => (
                <button
                  key={key}
                  type="button"
                  className={`ops-nav-tab ${topView === key ? 'active' : ''}`}
                  onClick={() => setTopView(key)}
                >
                  <i className={`bi ${icon}`} />
                  {t(labelKey)}
                </button>
              ))}
            </div>

            {onToggleActivity && (
              <button
                type="button"
                className="btn btn-link text-muted p-1 position-relative"
                onClick={onToggleActivity}
                title={t('activity.title')}
                style={{ fontSize: '1.1rem' }}
              >
                <i className={`bi ${activityOpen ? 'bi-bell-fill' : 'bi-bell'}`} />
                {activityBadgeCount > 0 && !activityOpen && (
                  <span className="ops-activity-badge">{activityBadgeCount > 99 ? '99+' : activityBadgeCount}</span>
                )}
              </button>
            )}

            {canManage && (
              <button
                type="button"
                className="btn btn-link text-muted p-1"
                onClick={() => setShowGlobalSettings(true)}
                title={t('settings.title')}
                style={{ fontSize: '1.1rem' }}
              >
                <i className="bi bi-gear" />
              </button>
            )}
          </div>
        </div>

        {/* ── Row 2: Team selector + Zone/Sprint strip (Board view only) ── */}
        {topView === 'board' && (
          <div
            className="ops-board-bar d-flex align-items-center px-3 gap-3 border-bottom bg-white"
            style={{ minHeight: 54, padding: '10px 0' }}
          >
            {/* Board / All Boards selector */}
            {boards.length > 0 && (
              <div className="d-flex align-items-center gap-3 flex-shrink-0">
                <BoardSelector
                  currentBoard={boards.find((tm) => tm.id === selectedBoardId) ?? null}
                  boards={boards}
                  isAllBoards={boardViewMode === 'allBoards'}
                  pinnedBoardIds={pinnedBoardIds}
                  onSelectBoard={(boardId) => {
                    selectBoard(boardId);
                    setBoardViewMode('singleBoard');
                  }}
                  onSelectAllBoards={() => setBoardViewMode('allBoards')}
                  onCreateBoard={() => setShowCreateTeam(true)}
                  onToggleBoardPin={handleToggleBoardPin}
                />
                {/* Board settings — next to board name in single-board mode */}
                {boardViewMode === 'singleBoard' && selectedBoardId && (canManage || isTeamOwner) && (
                  <button
                    type="button"
                    className="btn btn-link text-muted p-0"
                    onClick={() => setShowBoardSettings(true)}
                    title={t('boards.settings')}
                    style={{ fontSize: '0.95rem' }}
                  >
                    <i className="bi bi-sliders" />
                  </button>
                )}

                <div className="vr align-self-stretch my-2" />
              </div>
            )}

            {boardViewMode === 'singleBoard' ? (
              <ZoneSprintStrip />
            ) : (
              <AllBoardsStrip
                canManage={canManage}
                currentUserSub={currentUserSub}
                pinnedBoardIds={pinnedBoardIds}
                onOpenBoardSettings={(boardId) => {
                  selectBoard(boardId);
                  setShowBoardSettings(true);
                }}
              />
            )}

            {/* My Work toggle + New Ticket button — right side of board bar */}
            <div className="d-flex align-items-center gap-2 ms-auto flex-shrink-0">
              <button
                type="button"
                className={`ops-my-work-toggle${myWorkFilter ? ' ops-my-work-toggle--active' : ''}`}
                onClick={() => setMyWorkFilter(!myWorkFilter)}
                title={t('common.myWork')}
              >
                <i className="bi bi-person-check" />
                <span className="d-none d-sm-inline">{t('common.myWork')}</span>
              </button>
              <button
                type="button"
                className="btn btn-primary rounded-pill d-flex align-items-center justify-content-center"
                style={{ fontSize: '0.9rem', padding: '8px 18px' }}
                onClick={() => setShowCreateTicket(true)}
              >
                <i className="bi bi-plus-lg me-0 me-md-1" />
                <span className="d-none d-md-inline">{t('tickets.newTicket')}</span>
              </button>
            </div>
          </div>
        )}
      </div>
      {/* ── Modals ── */}
      <CreateTicketModal
        show={showCreateTicket}
        onHide={() => setShowCreateTicket(false)}
        onSuccess={(ticket) => {
          setShowCreateTicket(false);
          setSuccessTicket(ticket);
          setShowTicketSuccess(true);
        }}
      />
      <TicketSuccessModal
        show={showTicketSuccess}
        ticket={successTicket}
        onHide={() => setShowTicketSuccess(false)}
        onViewOnBoard={() => setShowTicketSuccess(false)}
        onOpenTicket={() => {
          setShowTicketSuccess(false);
          if (successTicket) {
            setDetailTicketId(successTicket.id);
            setShowTicketDetail(true);
          }
        }}
        onCreateAnother={() => {
          setShowTicketSuccess(false);
          setShowCreateTicket(true);
        }}
      />
      <TicketDetailModal
        show={showTicketDetail}
        ticketId={detailTicketId}
        onHide={() => {
          setShowTicketDetail(false);
          setDetailTicketId(null);
        }}
      />
      <BoardSettingsModal
        show={showBoardSettings}
        onHide={() => setShowBoardSettings(false)}
        onSaved={async () => {
          setShowBoardSettings(false);
          await refreshBoard();
          refreshBoards();
        }}
      />
      <GlobalSettingsModal
        show={showGlobalSettings}
        onHide={() => setShowGlobalSettings(false)}
        onSaved={async () => {
          setShowGlobalSettings(false);
          await refreshConfig();
        }}
      />
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
};

export default OpsHeader;
