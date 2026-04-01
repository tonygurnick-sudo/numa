import { useState, useEffect, useCallback, useRef } from 'react';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import * as OpsService from '../../Services/OpsService';
import type { OpsConfigResponse, TeamSummary, TeamResponse, Ticket, WorkUnit, StaffProfile } from '../../types/ops';
import { getCached, setCache } from '../../utils/opsCache';

// ─── localStorage Keys ──────────────────────────────────────────────────────

const LS_ACTIVE_TEAM = 'numa_ops_active_team';
const LS_ACTIVE_ZONE = 'numa_ops_active_zone';
const LS_BOARD_VIEW_MODE = 'numa_ops_board_view_mode';
const LS_TOP_VIEW = 'numa_ops_top_view';
const LS_SELECTED_WORK_UNIT = 'numa_ops_selected_work_unit';
const LS_MY_WORK_FILTER = 'numa_ops_my_work_filter';

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
  crmRefreshVersion: number;
  pendingSprintFilter: string[] | null;
  myWorkFilter: boolean;

  // Actions
  selectTeam: (teamId: string) => void;
  setTopView: (view: OpsTopView) => void;
  setPendingSprintFilter: (filter: string[] | null) => void;
  setMyWorkFilter: (enabled: boolean) => void;
  setBoardViewMode: (mode: BoardViewMode) => void;
  setActiveZone: (zoneId: string | null) => void;
  selectWorkUnit: (wuId: string | null) => void;
  setTickets: React.Dispatch<React.SetStateAction<Ticket[]>>;
  refreshTeam: () => Promise<TeamResponse | null>;
  refreshTickets: () => Promise<void>;
  refreshWorkUnits: () => Promise<void>;
  refreshTeams: () => Promise<void>;
  refreshStaff: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  refreshCrmData: () => void;
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
// Staff sync is triggered on-demand (when settings modals open), not on a timer.

export const useOpsData = (): OpsDataState => {
  const { numaGet, numaPost } = useNumaRequest();

  // ── Cache-aware initial state ─────────────────────────────────────────
  // Read cached data so the UI renders instantly; API fetches still happen
  // in the background and overwrite with fresh data.

  const [initialTeamId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(LS_ACTIVE_TEAM);
      const cachedTeams = getCached<TeamSummary[]>('teams');
      if (saved && cachedTeams?.some((t) => t.id === saved)) return saved;
      return null;
    } catch {
      return null;
    }
  });

  // ── Config ──────────────────────────────────────────────────────────────
  const [config, setConfig] = useState<OpsConfigResponse | null>(() => getCached('config'));
  const [configLoading, setConfigLoading] = useState(() => !getCached('config'));

  // ── Teams ───────────────────────────────────────────────────────────────
  const [teams, setTeams] = useState<TeamSummary[]>(() => getCached<TeamSummary[]>('teams') ?? []);
  const [teamsLoading, setTeamsLoading] = useState(() => !getCached('teams'));
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(initialTeamId);

  // ── Team Data ───────────────────────────────────────────────────────────
  const [teamData, setTeamData] = useState<TeamResponse | null>(() =>
    initialTeamId ? getCached<TeamResponse>(`team_${initialTeamId}`) : null
  );
  const [teamLoading, setTeamLoading] = useState(false);

  // ── Tickets ─────────────────────────────────────────────────────────────
  const [tickets, setTickets] = useState<Ticket[]>(
    () => (initialTeamId ? getCached<Ticket[]>(`tickets_${initialTeamId}`) : null) ?? []
  );
  const [ticketsLoading, setTicketsLoading] = useState(false);

  // ── Work Units ──────────────────────────────────────────────────────────
  const [workUnits, setWorkUnits] = useState<WorkUnit[]>(
    () => (initialTeamId ? getCached<WorkUnit[]>(`workUnits_${initialTeamId}`) : null) ?? []
  );
  const [selectedWorkUnitId, setSelectedWorkUnitId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(LS_SELECTED_WORK_UNIT);
      if (saved) {
        const parsed = JSON.parse(saved) as { teamId: string; wuId: string };
        if (parsed.teamId === initialTeamId && parsed.wuId) return parsed.wuId;
      }
    } catch {
      /* ignore */
    }
    return null;
  });

  // ── View State ──────────────────────────────────────────────────────────
  const [topView, setTopViewState] = useState<OpsTopView>(() => {
    try {
      const saved = localStorage.getItem(LS_TOP_VIEW);
      if (saved && ['home', 'board', 'allTickets', 'customers', 'suppliers', 'roadmap'].includes(saved)) {
        return saved as OpsTopView;
      }
    } catch {
      /* quota or private mode */
    }
    return 'board';
  });
  const [boardViewMode, setBoardViewModeState] = useState<BoardViewMode>(() => {
    try {
      const saved = localStorage.getItem(LS_BOARD_VIEW_MODE);
      return saved === 'singleTeam' ? 'singleTeam' : 'allTeams';
    } catch {
      return 'allTeams';
    }
  });
  const [activeZoneId, setActiveZoneId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LS_ACTIVE_ZONE);
    } catch {
      return null;
    }
  });
  const [crmRefreshVersion, setCrmRefreshVersion] = useState(0);
  const [pendingSprintFilter, setPendingSprintFilter] = useState<string[] | null>(null);
  const [myWorkFilter, setMyWorkFilterState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LS_MY_WORK_FILTER) === '1';
    } catch {
      return false;
    }
  });

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
      setCache('config', data);
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
      setCache('teams', data);
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
        setCache(`team_${teamId}`, data);
        return data;
      } catch (err) {
        console.error('[useOpsData] Failed to load team:', err);
        setTeamData(null);
        return null;
      } finally {
        setTeamLoading(false);
      }
    },
    [numaGet]
  );

  const loadTickets = useCallback(
    async (teamId: string) => {
      try {
        setTicketsLoading(true);
        const response = await OpsService.listTickets(numaGet, { teamId });
        setTickets(response.tickets);
        setCache(`tickets_${teamId}`, response.tickets);
      } catch (err) {
        console.error('[useOpsData] Failed to load tickets:', err);
        setTickets([]);
      } finally {
        setTicketsLoading(false);
      }
    },
    [numaGet]
  );

  const loadWorkUnits = useCallback(
    async (teamId: string) => {
      try {
        const data = await OpsService.listWorkUnits(numaGet, teamId);
        setWorkUnits(data);
        setCache(`workUnits_${teamId}`, data);
      } catch (err) {
        console.error('[useOpsData] Failed to load work units:', err);
        setWorkUnits([]);
      }
    },
    [numaGet]
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

  // ── On-demand Staff Sync ────────────────────────────────────────────
  // Called by settings modals when they open to ensure fresh staff data.

  const refreshStaff = useCallback(async () => {
    try {
      const result = await OpsService.syncStaff(numaPost);
      if (result.skipped) return;
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              staff: result.staff as StaffProfile[],
              lastStaffSyncedAt: result.lastSyncedAt,
            }
          : prev
      );
    } catch (err) {
      console.warn('[useOpsData] Staff sync failed:', err);
    }
  }, [numaPost]);

  // ── React to Team Selection Changes ──────────────────────────────────

  useEffect(() => {
    if (!selectedTeamId) {
      setTeamData(null);
      setTickets([]);
      setWorkUnits([]);
      setSelectedWorkUnitId(null);
      return;
    }

    // Show cached team data instantly while fresh data loads
    const cachedTeam = getCached<TeamResponse>(`team_${selectedTeamId}`);
    if (cachedTeam) setTeamData(cachedTeam);
    const cachedTickets = getCached<Ticket[]>(`tickets_${selectedTeamId}`);
    if (cachedTickets) setTickets(cachedTickets);
    const cachedWorkUnits = getCached<WorkUnit[]>(`workUnits_${selectedTeamId}`);
    if (cachedWorkUnits) setWorkUnits(cachedWorkUnits);

    // Load fresh data in the background
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
      // Restore saved sprint filter for the new team, or clear it
      try {
        const saved = localStorage.getItem(LS_SELECTED_WORK_UNIT);
        if (saved) {
          const parsed = JSON.parse(saved) as { teamId: string; wuId: string };
          setSelectedWorkUnitId(parsed.teamId === teamId ? parsed.wuId : null);
        } else {
          setSelectedWorkUnitId(null);
        }
      } catch {
        setSelectedWorkUnitId(null);
      }
    },
    [persistTeam]
  );

  const setTopView = useCallback((view: OpsTopView) => {
    setTopViewState(view);
    try {
      localStorage.setItem(LS_TOP_VIEW, view);
    } catch {
      /* quota or private mode */
    }
  }, []);

  const setBoardViewMode = useCallback(
    (mode: BoardViewMode) => {
      setBoardViewModeState(mode);
      persistBoardViewMode(mode);
    },
    [persistBoardViewMode]
  );

  const setActiveZone = useCallback((zoneId: string | null) => {
    setActiveZoneId(zoneId);
    try {
      if (zoneId) localStorage.setItem(LS_ACTIVE_ZONE, zoneId);
      else localStorage.removeItem(LS_ACTIVE_ZONE);
    } catch {
      /* quota or private mode */
    }
  }, []);

  const selectWorkUnit = useCallback(
    (wuId: string | null) => {
      setSelectedWorkUnitId(wuId);
      try {
        if (wuId && selectedTeamId) {
          localStorage.setItem(LS_SELECTED_WORK_UNIT, JSON.stringify({ teamId: selectedTeamId, wuId }));
        } else {
          localStorage.removeItem(LS_SELECTED_WORK_UNIT);
        }
      } catch {
        /* quota or private mode */
      }
    },
    [selectedTeamId]
  );

  const refreshWorkUnits = useCallback(async () => {
    if (selectedTeamId) {
      await loadWorkUnits(selectedTeamId);
    }
  }, [selectedTeamId, loadWorkUnits]);

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

  const refreshConfig = useCallback(async () => {
    await loadConfig();
  }, [loadConfig]);

  const refreshCrmData = useCallback(() => {
    setCrmRefreshVersion((prev) => prev + 1);
  }, []);

  const setMyWorkFilter = useCallback((enabled: boolean) => {
    setMyWorkFilterState(enabled);
    try {
      if (enabled) localStorage.setItem(LS_MY_WORK_FILTER, '1');
      else localStorage.removeItem(LS_MY_WORK_FILTER);
    } catch {
      /* quota or private mode */
    }
  }, []);

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
    setTickets,
    ticketsLoading,

    workUnits,
    selectedWorkUnitId,

    topView,
    boardViewMode,
    activeZoneId,
    crmRefreshVersion,
    pendingSprintFilter,
    myWorkFilter,

    selectTeam,
    setTopView,
    setPendingSprintFilter,
    setMyWorkFilter,
    setBoardViewMode,
    setActiveZone,
    selectWorkUnit,
    refreshTeam,
    refreshTickets,
    refreshWorkUnits,
    refreshTeams,
    refreshConfig,
    refreshStaff,
    refreshCrmData,
  };
};
