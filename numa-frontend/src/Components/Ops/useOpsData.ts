import { useState, useEffect, useCallback, useRef } from 'react';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import * as OpsService from '../../Services/OpsService';
import type { OpsConfigResponse, TeamSummary, TeamResponse, Ticket, WorkUnit } from '../../types/ops';

// ─── localStorage Keys ──────────────────────────────────────────────────────

const LS_ACTIVE_TEAM = 'numa_ops_active_team';
const LS_BOARD_VIEW_MODE = 'numa_ops_board_view_mode';

// ─── View Types ─────────────────────────────────────────────────────────────

export type OpsTopView = 'home' | 'board' | 'allTickets' | 'customers' | 'suppliers' | 'roadmap';
export type BoardViewMode = 'allTeams' | 'singleTeam';

// ─── Return Shape ───────────────────────────────────────────────────────────

export type OpsDataState = {
  // Config (loaded once)
  config: OpsConfigResponse | null;
  configLoading: boolean;

  // Teams
  teams: TeamSummary[];
  teamsLoading: boolean;
  selectedTeamId: string | null;

  // Active Team Data
  teamData: TeamResponse | null;
  teamLoading: boolean;

  // Tickets
  tickets: Ticket[];
  ticketsLoading: boolean;

  // Work Units (sprints)
  workUnits: WorkUnit[];
  selectedWorkUnitId: string | null;

  // View state
  topView: OpsTopView;
  boardViewMode: BoardViewMode;
  activeZoneId: string | null;

  // Actions
  selectTeam: (teamId: string) => void;
  setTopView: (view: OpsTopView) => void;
  setBoardViewMode: (mode: BoardViewMode) => void;
  setActiveZone: (zoneId: string | null) => void;
  selectWorkUnit: (wuId: string | null) => void;
  refreshTeam: () => Promise<TeamResponse | null>;
  refreshTickets: () => Promise<void>;
  refreshTeams: () => Promise<void>;
};

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * useOpsData manages the full lifecycle of Ops page data:
 *
 * 1. On mount: loads config + teams list.
 * 2. Reads localStorage for last-used team and board view mode.
 *    If saved team is valid, selects it. Otherwise defaults to first team.
 * 3. When selectedTeamId changes: loads team data, tickets, and work units.
 * 4. Persists team selection and view mode to localStorage.
 */
export const useOpsData = (): OpsDataState => {
  const { numaGet } = useNumaRequest();

  // ── Config ──────────────────────────────────────────────────────────────
  const [config, setConfig] = useState<OpsConfigResponse | null>(null);
  const [configLoading, setConfigLoading] = useState(true);

  // ── Teams ───────────────────────────────────────────────────────────────
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  // ── Team Data ───────────────────────────────────────────────────────────
  const [teamData, setTeamData] = useState<TeamResponse | null>(null);
  const [teamLoading, setTeamLoading] = useState(false);

  // ── Tickets ─────────────────────────────────────────────────────────────
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);

  // ── Work Units ──────────────────────────────────────────────────────────
  const [workUnits, setWorkUnits] = useState<WorkUnit[]>([]);
  const [selectedWorkUnitId, setSelectedWorkUnitId] = useState<string | null>(null);

  // ── View State ──────────────────────────────────────────────────────────
  const [topView, setTopViewState] = useState<OpsTopView>('board');
  const [boardViewMode, setBoardViewModeState] = useState<BoardViewMode>(() => {
    try {
      const saved = localStorage.getItem(LS_BOARD_VIEW_MODE);
      return saved === 'singleTeam' ? 'singleTeam' : 'allTeams';
    } catch {
      return 'allTeams';
    }
  });
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const initialLoadDone = useRef(false);

  // ── localStorage Persistence ──────────────────────────────────────────
  const persistTeam = useCallback((teamId: string) => {
    try {
      localStorage.setItem(LS_ACTIVE_TEAM, teamId);
    } catch {
      /* quota or private mode */
    }
  }, []);

  const persistBoardViewMode = useCallback((mode: BoardViewMode) => {
    try {
      localStorage.setItem(LS_BOARD_VIEW_MODE, mode);
    } catch {
      /* quota or private mode */
    }
  }, []);

  // ── Data Loaders ──────────────────────────────────────────────────────

  const loadConfig = useCallback(async () => {
    try {
      setConfigLoading(true);
      const data = await OpsService.getConfig(numaGet);
      setConfig(data);
    } catch (err) {
      console.error('[useOpsData] Failed to load config:', err);
    } finally {
      setConfigLoading(false);
    }
  }, [numaGet]);

  const loadTeams = useCallback(async (): Promise<TeamSummary[]> => {
    try {
      setTeamsLoading(true);
      const data = await OpsService.listTeams(numaGet);
      setTeams(data);
      return data;
    } catch (err) {
      console.error('[useOpsData] Failed to load teams:', err);
      return [];
    } finally {
      setTeamsLoading(false);
    }
  }, [numaGet]);

  const loadTeamData = useCallback(
    async (teamId: string): Promise<TeamResponse | null> => {
      try {
        setTeamLoading(true);
        const data = await OpsService.getTeam(numaGet, teamId);
        setTeamData(data);
        return data;
      } catch (err) {
        console.error('[useOpsData] Failed to load team:', err);
        setTeamData(null);
        return null;
      } finally {
        setTeamLoading(false);
      }
    },
    [numaGet],
  );

  const loadTickets = useCallback(
    async (teamId: string) => {
      try {
        setTicketsLoading(true);
        const response = await OpsService.listTickets(numaGet, { teamId });
        setTickets(response.tickets);
      } catch (err) {
        console.error('[useOpsData] Failed to load tickets:', err);
        setTickets([]);
      } finally {
        setTicketsLoading(false);
      }
    },
    [numaGet],
  );

  const loadWorkUnits = useCallback(
    async (teamId: string) => {
      try {
        const data = await OpsService.listWorkUnits(numaGet, teamId);
        setWorkUnits(data);
      } catch (err) {
        console.error('[useOpsData] Failed to load work units:', err);
        setWorkUnits([]);
      }
    },
    [numaGet],
  );

  // ── Initial Mount ─────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (initialLoadDone.current) return;

      // Load config and teams in parallel
      const [, loadedTeams] = await Promise.all([loadConfig(), loadTeams()]);
      if (cancelled) return;

      // Read persisted team selection from localStorage
      const savedTeamId = localStorage.getItem(LS_ACTIVE_TEAM);

      // Validate that the saved team still exists
      const teamIsValid = savedTeamId && loadedTeams.some((t) => t.id === savedTeamId);

      if (teamIsValid) {
        setSelectedTeamId(savedTeamId);
      } else if (loadedTeams.length > 0) {
        // Auto-select the first team
        setSelectedTeamId(loadedTeams[0].id);
        persistTeam(loadedTeams[0].id);
      }

      initialLoadDone.current = true;
    };

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [loadConfig, loadTeams, persistTeam]);

  // ── React to Team Selection Changes ──────────────────────────────────

  useEffect(() => {
    if (!selectedTeamId) {
      setTeamData(null);
      setTickets([]);
      setWorkUnits([]);
      setSelectedWorkUnitId(null);
      return;
    }

    // Load team data, tickets, and work units in parallel
    loadTeamData(selectedTeamId);
    loadTickets(selectedTeamId);
    loadWorkUnits(selectedTeamId);
    // Reset work unit selection when team changes
    setSelectedWorkUnitId(null);
  }, [selectedTeamId, loadTeamData, loadTickets, loadWorkUnits]);

  // ── Auto-select zone when zones change ──────────────────────────────────
  //
  // If the active zone is null or no longer exists in the current zones,
  // auto-select the first zone. This handles sprint-start (new zone appears)
  // and sprint-complete (zone may be removed) seamlessly.

  useEffect(() => {
    const zones = teamData?.zones ?? [];
    if (zones.length === 0) {
      if (activeZoneId !== null) setActiveZoneId(null);
      return;
    }
    const currentValid = activeZoneId && zones.some((z) => z.id === activeZoneId);
    if (!currentValid) {
      setActiveZoneId(zones[0].id);
    }
  }, [teamData?.zones, activeZoneId]);

  // ── Actions ───────────────────────────────────────────────────────────

  const selectTeam = useCallback(
    (teamId: string) => {
      setSelectedTeamId(teamId);
      persistTeam(teamId);
    },
    [persistTeam],
  );

  const setTopView = useCallback((view: OpsTopView) => {
    setTopViewState(view);
  }, []);

  const setBoardViewMode = useCallback(
    (mode: BoardViewMode) => {
      setBoardViewModeState(mode);
      persistBoardViewMode(mode);
    },
    [persistBoardViewMode],
  );

  const setActiveZone = useCallback((zoneId: string | null) => {
    setActiveZoneId(zoneId);
  }, []);

  const selectWorkUnit = useCallback((wuId: string | null) => {
    setSelectedWorkUnitId(wuId);
  }, []);

  const refreshTeam = useCallback(async (): Promise<TeamResponse | null> => {
    if (selectedTeamId) {
      return loadTeamData(selectedTeamId);
    }
    return null;
  }, [selectedTeamId, loadTeamData]);

  const refreshTickets = useCallback(async () => {
    if (selectedTeamId) {
      await loadTickets(selectedTeamId);
    }
  }, [selectedTeamId, loadTickets]);

  const refreshTeams = useCallback(async () => {
    await loadTeams();
  }, [loadTeams]);

  // ── Return ────────────────────────────────────────────────────────────

  return {
    config,
    configLoading,

    teams,
    teamsLoading,
    selectedTeamId,

    teamData,
    teamLoading,
    tickets,
    ticketsLoading,

    workUnits,
    selectedWorkUnitId,

    topView,
    boardViewMode,
    activeZoneId,

    selectTeam,
    setTopView,
    setBoardViewMode,
    setActiveZone,
    selectWorkUnit,
    refreshTeam,
    refreshTickets,
    refreshTeams,
  };
};
