import React, { useState, useEffect, useRef } from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../Providers/AuthProvider';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { OpsProvider, useOps } from '../Components/Ops/OpsContext';
import * as OpsService from '../Services/OpsService';
import OpsHeader from '../Components/Ops/OpsHeader';
import BoardView from '../Components/Ops/BoardView/BoardView';
import BacklogView from '../Components/Ops/BacklogView/BacklogView';
import { AllTicketsView } from '../Components/Ops/AllTicketsView/AllTicketsView';
import CrmMirrorView from '../Components/Ops/CrmView/CrmMirrorView';
import { SupplierMirrorView } from '../Components/Ops/CrmView/SupplierMirrorView';
import { RoadmapPlaceholder } from '../Components/Ops/RoadmapView/RoadmapPlaceholder';
import { ProjectsView } from '../Components/Ops/ProjectsView/ProjectsView';
import { OpsHomeView } from '../Components/Ops/HomeView/OpsHomeView';
import { CreateBoardWizard } from '../Components/Ops/Modals/CreateBoardWizard';
import { GlobalSettingsModal } from '../Components/Ops/Modals/GlobalSettingsModal';
import { BoardSettingsModal } from '../Components/Ops/Modals/BoardSettingsModal';
import { TicketDetailModal } from '../Components/Ops/Modals/TicketDetailModal';
import { ActivityFeedSidebar } from '../Components/Ops/ActivityFeedSidebar';

const ACTIVITY_LS_KEY = 'numa_ops_activity_sidebar';

// ─── Inner Content ──────────────────────────────────────────────────────────

/**
 * OpsPageContent sits inside the <OpsProvider> so it can access the Ops
 * context via useOps(). It renders the top nav and routes to the active
 * top-level view.
 */
type OpsPageContentProps = {
  activityOpen: boolean;
  onToggleActivity: () => void;
};

const OpsPageContent: React.FC<OpsPageContentProps> = ({ activityOpen, onToggleActivity }) => {
  const { t } = useTranslation('ops');
  const { user } = useAuth();
  const {
    config,
    configLoading,
    boardLoading,
    boardData,
    boards,
    topView,
    setTopView,
    activeZoneId,
    selectBoard,
    setBoardViewMode,
    refreshBoard,
    refreshBoards,
  } = useOps();

  const canManage = Boolean(user?.features?.includes('manageUsers'));
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Project deep link (?project=<id>) ──────────────────────────────────
  const [deepLinkProjectId, setDeepLinkProjectId] = useState<string | null>(null);

  useEffect(() => {
    const projectParam = searchParams.get('project');
    if (projectParam) {
      setDeepLinkProjectId(projectParam);
      setTopView('projects');
      searchParams.delete('project');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, setTopView]);

  // ── Modal state ─────────────────────────────────────────────────────────
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [globalSettingsTab, setGlobalSettingsTab] = useState<string | undefined>();
  const [showBoardSettings, setShowBoardSettings] = useState(false);

  // ── Loading State (only show spinner if we have no data at all) ──────
  // When cached data is available, config/teams are already populated so
  // the page renders instantly while fresh data loads in the background.
  if (!config && configLoading) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center flex-grow-1">
        <Spinner animation="border" />
        <p className="mt-3 text-muted">{t('common.loading')}</p>
      </div>
    );
  }

  // ── Home view (admin dashboard) ──────────────────────────────────────
  if (topView === 'home' && canManage) {
    return (
      <>
        <OpsHeader activityOpen={activityOpen} onToggleActivity={onToggleActivity} />
        <div className="flex-grow-1 overflow-auto">
          <OpsHomeView
            onCreateBoard={() => setShowCreateBoard(true)}
            onCreateCustomer={() => setTopView('customers')}
            onCreateSupplier={() => setTopView('suppliers')}
            onOpenGlobalSettings={(tab) => {
              setGlobalSettingsTab(tab);
              setShowGlobalSettings(true);
            }}
            onOpenBoardSettings={(boardId) => {
              selectBoard(boardId);
              setShowBoardSettings(true);
            }}
            onNavigateToBoard={(boardId) => {
              selectBoard(boardId);
              setBoardViewMode('singleBoard');
              setTopView('board');
            }}
          />
        </div>
        {/* Modals accessible from home view */}
        <CreateBoardWizard
          show={showCreateBoard}
          onHide={() => setShowCreateBoard(false)}
          onCreated={(team) => {
            setShowCreateBoard(false);
            refreshBoards();
            selectBoard(team.id);
          }}
        />
        <BoardSettingsModal
          show={showBoardSettings}
          onHide={() => setShowBoardSettings(false)}
          onSaved={() => {
            setShowBoardSettings(false);
            refreshBoard();
          }}
        />
        <GlobalSettingsModal
          show={showGlobalSettings}
          onHide={() => setShowGlobalSettings(false)}
          defaultTab={globalSettingsTab}
          onSaved={() => {
            setShowGlobalSettings(false);
          }}
        />
      </>
    );
  }

  // ── Top-level view routing ──────────────────────────────────────────
  if (topView === 'allTickets') {
    return (
      <>
        <OpsHeader activityOpen={activityOpen} onToggleActivity={onToggleActivity} />
        <div className="flex-grow-1 overflow-auto">
          <AllTicketsView />
        </div>
      </>
    );
  }

  if (topView === 'customers') {
    return (
      <>
        <OpsHeader activityOpen={activityOpen} onToggleActivity={onToggleActivity} />
        <div className="flex-grow-1 overflow-auto">
          <CrmMirrorView />
        </div>
      </>
    );
  }

  if (topView === 'suppliers') {
    return (
      <>
        <OpsHeader activityOpen={activityOpen} onToggleActivity={onToggleActivity} />
        <div className="flex-grow-1 overflow-auto">
          <SupplierMirrorView />
        </div>
      </>
    );
  }

  if (topView === 'projects') {
    return (
      <>
        <OpsHeader activityOpen={activityOpen} onToggleActivity={onToggleActivity} />
        <div className="flex-grow-1 overflow-auto">
          <ProjectsView initialProjectId={deepLinkProjectId} key={deepLinkProjectId ?? 'projects'} />
        </div>
      </>
    );
  }

  if (topView === 'roadmap') {
    return (
      <>
        <OpsHeader activityOpen={activityOpen} onToggleActivity={onToggleActivity} />
        <div className="flex-grow-1 overflow-auto">
          <RoadmapPlaceholder />
        </div>
      </>
    );
  }

  // ── Board view (default) — unified for both singleTeam and allTeams ──

  // Empty state: no boards at all → welcome screen
  if (boards.length === 0) {
    return (
      <>
        <OpsHeader activityOpen={activityOpen} onToggleActivity={onToggleActivity} />
        <div className="d-flex justify-content-center align-items-start py-5 px-3">
          <div style={{ maxWidth: 520, width: '100%' }}>
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

            <p className="text-center text-muted mb-2">{t('boards.welcome.body')}</p>
            <p className="text-center mb-4" style={{ fontSize: '0.85rem' }}>
              <i className="bi bi-lightbulb text-warning me-1" />
              <span className="text-muted fst-italic">{t('boards.welcome.soloTip')}</span>
            </p>

            <div className="text-center">
              <button type="button" className="btn btn-primary btn-lg px-4" onClick={() => setShowCreateBoard(true)}>
                <i className="bi bi-plus-lg me-2" />
                {t('boards.welcome.cta')}
              </button>
            </div>
          </div>
        </div>
        <CreateBoardWizard
          show={showCreateBoard}
          onHide={() => setShowCreateBoard(false)}
          onCreated={(team) => {
            setShowCreateBoard(false);
            refreshBoards();
            selectBoard(team.id);
          }}
        />
      </>
    );
  }

  // Loading team data
  if (boardLoading && !boardData) {
    return (
      <>
        <OpsHeader activityOpen={activityOpen} onToggleActivity={onToggleActivity} />
        <div className="d-flex flex-column align-items-center justify-content-center flex-grow-1">
          <Spinner animation="border" />
          <p className="mt-3 text-muted">{t('common.loading')}</p>
        </div>
      </>
    );
  }

  // Determine zone type for content rendering
  const activeZone = boardData?.zones?.find((z) => z.id === activeZoneId);
  const zoneType = activeZone?.zoneType ?? 'board';

  return (
    <>
      <OpsHeader activityOpen={activityOpen} onToggleActivity={onToggleActivity} />
      <div className="flex-grow-1 overflow-auto">{zoneType === 'board' ? <BoardView /> : <BacklogView />}</div>
    </>
  );
};

// ─── Page Component (named export for lazy loading) ─────────────────────────

/**
 * DeepLinkHandler resolves a ?ticket=DISPLAY_ID query parameter and opens
 * the ticket detail modal. Lives inside OpsProvider so it can use numaGet.
 */
const DeepLinkHandler: React.FC = () => {
  const { numaGet } = useNumaRequest();
  const { tickets, refreshTickets, boardLoading } = useOps();
  const [searchParams, setSearchParams] = useSearchParams();

  const [ticketId, setTicketId] = useState<string | null>(null);
  const [resolvedBoardId, setResolvedBoardId] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const processingRef = useRef<string | null>(null);

  // Try to resolve from locally loaded tickets first (works with cached data),
  // then fall back to the API call.
  useEffect(() => {
    const displayId = searchParams.get('ticket');
    if (!displayId) {
      processingRef.current = null;
      return;
    }

    // Only resolve once per deep link
    if (processingRef.current === displayId) return;

    // Check if the ticket is already in the local tickets array
    const local = tickets.find((t) => t.displayId === displayId);
    if (local) {
      processingRef.current = displayId;
      setTicketId(local.id);
      setResolvedBoardId(local.boardId ?? null);
      setShow(true);
      searchParams.delete('ticket');
      setSearchParams(searchParams, { replace: true });
      return;
    }

    // If local isn't found, we should fall back to the API.
    // However, if the current board's tickets are still loading, wait before trying the API fallback.
    if (boardLoading) return;

    // Tickets have finished loading but this one isn't in them — try API (different team)
    processingRef.current = displayId;
    searchParams.delete('ticket');
    setSearchParams(searchParams, { replace: true });

    OpsService.getTicketByDisplayId(numaGet, displayId)
      .then((response) => {
        setTicketId(response.ticket.id);
        // Cross-board deep link: keep the ticket's real boardId so the detail
        // modal queries the right DynamoDB partition instead of the user's
        // currently-open board.
        setResolvedBoardId(response.ticket.boardId ?? null);
        setShow(true);
      })
      .catch((err) => {
        console.error('[OpsPage] Failed to resolve ticket deep link:', err);
      });
  }, [tickets, numaGet, searchParams, setSearchParams, boardLoading]);

  return (
    <TicketDetailModal
      show={show}
      ticketId={ticketId}
      boardIdOverride={resolvedBoardId}
      onHide={() => {
        setShow(false);
        setTicketId(null);
        setResolvedBoardId(null);
      }}
      onDeleted={() => {
        setShow(false);
        setTicketId(null);
        setResolvedBoardId(null);
        refreshTickets();
      }}
    />
  );
};

/**
 * ActivitySidebarWrapper renders the sidebar and its associated ticket detail
 * modal. Lives inside OpsProvider so it has access to useOps().
 */
const ActivitySidebarWrapper: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const { refreshTickets } = useOps();
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  return (
    <>
      <ActivityFeedSidebar
        open={open}
        onClose={onClose}
        onOpenTicket={(id) => {
          setTicketId(id);
          setShowDetail(true);
        }}
      />
      <TicketDetailModal
        show={showDetail}
        ticketId={ticketId}
        onHide={() => {
          setShowDetail(false);
          setTicketId(null);
        }}
        onDeleted={() => {
          setShowDetail(false);
          setTicketId(null);
          refreshTickets();
        }}
      />
    </>
  );
};

export const OpsPage: React.FC = () => {
  // ── Activity sidebar state (lifted here so sidebar renders once) ──────
  const [activityOpen, setActivityOpen] = useState(() => {
    try {
      return localStorage.getItem(ACTIVITY_LS_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleActivity = () => {
    setActivityOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ACTIVITY_LS_KEY, String(next));
      } catch {
        /* noop */
      }
      return next;
    });
  };

  return (
    <OpsProvider>
      <div className="d-flex flex-column h-100 ops-root">
        <OpsPageContent activityOpen={activityOpen} onToggleActivity={toggleActivity} />
      </div>
      <ActivitySidebarWrapper
        open={activityOpen}
        onClose={() => {
          setActivityOpen(false);
          try {
            localStorage.setItem(ACTIVITY_LS_KEY, 'false');
          } catch {
            /* noop */
          }
        }}
      />
      <DeepLinkHandler />
    </OpsProvider>
  );
};

export default OpsPage;
