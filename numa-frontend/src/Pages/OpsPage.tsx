import React, { useState, useEffect, useRef } from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
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
import { OpsHomeView } from '../Components/Ops/HomeView/OpsHomeView';
import { CreateTeamWizard } from '../Components/Ops/Modals/CreateTeamWizard';
import { GlobalSettingsModal } from '../Components/Ops/Modals/GlobalSettingsModal';
import { TeamSettingsModal } from '../Components/Ops/Modals/TeamSettingsModal';
import { TicketDetailModal } from '../Components/Ops/Modals/TicketDetailModal';

// ─── Inner Content ──────────────────────────────────────────────────────────

/**
 * OpsPageContent sits inside the <OpsProvider> so it can access the Ops
 * context via useOps(). It renders the top nav and routes to the active
 * top-level view.
 */
const OpsPageContent: React.FC = () => {
  const { t } = useTranslation('ops');
  const { user } = useAuth();
  const {
    config,
    configLoading,
    teamLoading,
    teamData,
    teams,
    topView,
    setTopView,
    activeZoneId,
    selectTeam,
    setBoardViewMode,
    refreshTeam,
    refreshTeams,
  } = useOps();

  const canManage = Boolean(user?.features?.includes('manageUsers'));

  // ── Modal state ─────────────────────────────────────────────────────────
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [globalSettingsTab, setGlobalSettingsTab] = useState<string | undefined>();
  const [showTeamSettings, setShowTeamSettings] = useState(false);

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
        <OpsHeader />
        <div className="flex-grow-1 overflow-auto">
          <OpsHomeView
            onCreateTeam={() => setShowCreateTeam(true)}
            onCreateCustomer={() => setTopView('customers')}
            onCreateSupplier={() => setTopView('suppliers')}
            onOpenGlobalSettings={(tab) => {
              setGlobalSettingsTab(tab);
              setShowGlobalSettings(true);
            }}
            onOpenTeamSettings={(teamId) => {
              selectTeam(teamId);
              setShowTeamSettings(true);
            }}
            onNavigateToTeam={(teamId) => {
              selectTeam(teamId);
              setBoardViewMode('singleTeam');
              setTopView('board');
            }}
          />
        </div>
        {/* Modals accessible from home view */}
        <CreateTeamWizard
          show={showCreateTeam}
          onHide={() => setShowCreateTeam(false)}
          onCreated={(team) => {
            setShowCreateTeam(false);
            refreshTeams();
            selectTeam(team.id);
          }}
        />
        <TeamSettingsModal
          show={showTeamSettings}
          onHide={() => setShowTeamSettings(false)}
          onSaved={() => {
            setShowTeamSettings(false);
            refreshTeam();
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
        <OpsHeader />
        <div className="flex-grow-1 overflow-auto">
          <AllTicketsView />
        </div>
      </>
    );
  }

  if (topView === 'customers') {
    return (
      <>
        <OpsHeader />
        <div className="flex-grow-1 overflow-auto">
          <CrmMirrorView />
        </div>
      </>
    );
  }

  if (topView === 'suppliers') {
    return (
      <>
        <OpsHeader />
        <div className="flex-grow-1 overflow-auto">
          <SupplierMirrorView />
        </div>
      </>
    );
  }

  if (topView === 'roadmap') {
    return (
      <>
        <OpsHeader />
        <div className="flex-grow-1 overflow-auto">
          <RoadmapPlaceholder />
        </div>
      </>
    );
  }

  // ── Board view (default) — unified for both singleTeam and allTeams ──

  // Empty state: no teams at all → welcome screen
  if (teams.length === 0) {
    return (
      <>
        <OpsHeader />
        <div className="d-flex justify-content-center align-items-start py-5 px-3">
          <div style={{ maxWidth: 520, width: '100%' }}>
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

            <p className="text-center text-muted mb-2">{t('teams.welcome.body')}</p>
            <p className="text-center mb-4" style={{ fontSize: '0.85rem' }}>
              <i className="bi bi-lightbulb text-warning me-1" />
              <span className="text-muted fst-italic">{t('teams.welcome.soloTip')}</span>
            </p>

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

  // Loading team data
  if (teamLoading && !teamData) {
    return (
      <>
        <OpsHeader />
        <div className="d-flex flex-column align-items-center justify-content-center flex-grow-1">
          <Spinner animation="border" />
          <p className="mt-3 text-muted">{t('common.loading')}</p>
        </div>
      </>
    );
  }

  // Determine zone type for content rendering
  const activeZone = teamData?.zones?.find((z) => z.id === activeZoneId);
  const zoneType = activeZone?.zoneType ?? 'board';

  return (
    <>
      <OpsHeader />
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
  const { tickets, refreshTickets } = useOps();

  const [ticketId, setTicketId] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const displayIdRef = useRef<string | null>(null);
  const resolved = useRef(false);

  // Capture the display ID once on mount (before anything can strip it)
  if (displayIdRef.current === null) {
    displayIdRef.current = new URLSearchParams(window.location.search).get('ticket') ?? '';
  }

  const stripParam = () => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('ticket')) {
      url.searchParams.delete('ticket');
      window.history.replaceState(null, '', url.pathname + url.search);
    }
  };

  // Try to resolve from locally loaded tickets first (works with cached data),
  // then fall back to the API call.
  useEffect(() => {
    const displayId = displayIdRef.current;
    if (!displayId || resolved.current) return;

    // Check if the ticket is already in the local tickets array
    const local = tickets.find((t) => t.displayId === displayId);
    if (local) {
      resolved.current = true;
      setTicketId(local.id);
      setShow(true);
      stripParam();
      return;
    }

    // Only try the API once tickets have had a chance to load (non-empty)
    // or if we have no tickets at all, go straight to the API
    if (tickets.length > 0) {
      // Tickets loaded but this one isn't in them — try API (different team)
      resolved.current = true;
      stripParam();
      OpsService.getTicketByDisplayId(numaGet, displayId)
        .then((response) => {
          setTicketId(response.ticket.id);
          setShow(true);
        })
        .catch((err) => {
          console.error('[OpsPage] Failed to resolve ticket deep link:', err);
        });
    }
  }, [tickets, numaGet]);

  return (
    <TicketDetailModal
      show={show}
      ticketId={ticketId}
      onHide={() => {
        setShow(false);
        setTicketId(null);
      }}
      onDeleted={() => {
        setShow(false);
        setTicketId(null);
        refreshTickets();
      }}
    />
  );
};

/**
 * OpsPage is the top-level page component for the Numa Ops module.
 * It wraps everything in the <OpsProvider> so all children can access the
 * Ops context, and delegates rendering to OpsPageContent.
 */
export const OpsPage: React.FC = () => {
  return (
    <OpsProvider>
      <div className="d-flex flex-column h-100">
        <OpsPageContent />
      </div>
      <DeepLinkHandler />
    </OpsProvider>
  );
};

export default OpsPage;
