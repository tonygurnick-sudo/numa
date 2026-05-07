import { useState, useEffect, useCallback, useRef } from 'react';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import * as OpsService from '../../Services/OpsService';
import type { OpsConfigResponse, BoardSummary, BoardResponse, Ticket, WorkUnit, StaffProfile } from '../../types/ops';
import { getCached, setCache, LS_ACTIVE_BOARD, LS_ACTIVE_BOARD_LEGACY } from '../../utils/opsCache';

// ─── localStorage Keys ──────────────────────────────────────────────────────

const LS_ACTIVE_ZONE = 'numa_ops_active_zone';
const LS_BOARD_VIEW_MODE = 'numa_ops_board_view_mode';
const LS_TOP_VIEW = 'numa_ops_top_view';
const LS_SELECTED_WORK_UNIT = 'numa_ops_selected_work_unit';
const LS_MY_WORK_FILTER = 'numa_ops_my_work_filter';

// ── One-shot localStorage migration ────────────────────────────────────────
// The team→board rename moved a few keys around. Run once on module load so
// subsequent reads get the new key name even if the user had the old one set.
// Removed in a later cleanup commit.
(() => {
  try {
    const legacyActive = localStorage.getItem(LS_ACTIVE_BOARD_LEGACY);
    const newActive = localStorage.getItem(LS_ACTIVE_BOARD);
    if (legacyActive && !newActive) {
      localStorage.setItem(LS_ACTIVE_BOARD, legacyActive);
    }
    if (legacyActive) localStorage.removeItem(LS_ACTIVE_BOARD_LEGACY);

    // The selected-work-unit blob used to be { teamId, wuId }; rewrite it to
    // { boardId, wuId } so the parser in this module finds it on first paint.
    const swu = localStorage.getItem(LS_SELECTED_WORK_UNIT);
    if (swu) {
      try {
        const parsed = JSON.parse(swu) as { teamId?: string; boardId?: string; wuId?: string };
        if (parsed?.teamId && !parsed.boardId) {
          localStorage.setItem(LS_SELECTED_WORK_UNIT, JSON.stringify({ boardId: parsed.teamId, wuId: parsed.wuId }));
        }
      } catch {
        /* ignore — corrupt JSON, leave alone */
      }
    }
  } catch {
    /* localStorage unavailable */
  }
})();

// ─── View Types ─────────────────────────────────────────────────────────────

export type OpsTopView = 'home' | 'board' | 'allTickets' | 'customers' | 'suppliers' | 'projects' | 'roadmap';
export type BoardViewMode = 'allBoards' | 'singleBoard';

// ─── Return Shape ───────────────────────────────────────────────────────────

export type OpsDataState = {
  // Config (loaded once)
  config: OpsConfigResponse | null;
  configLoading: boolean;

  // Boards
  boards: BoardSummary[];
  boardsLoading: boolean;
  selectedBoardId: string | null;

  // Active Board Data
  boardData: BoardResponse | null;
  boardLoading: boolean;

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
  selectBoard: (boardId: string) => void;
  setTopView: (view: OpsTopView) => void;
  setPendingSprintFilter: (filter: string[] | null) => void;
  setMyWorkFilter: (enabled: boolean) => void;
  setBoardViewMode: (mode: BoardViewMode) => void;
  setActiveZone: (zoneId: string | null) => void;
  selectWorkUnit: (wuId: string | null) => void;
  setTickets: React.Dispatch<React.SetStateAction<Ticket[]>>;
  refreshBoard: () => Promise<BoardResponse | null>;
  refreshTickets: () => Promise<void>;
  refreshWorkUnits: () => Promise<void>;
  refreshBoards: () => Promise<void>;
  refreshStaff: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  refreshCrmData: () => void;
};

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * useOpsData manages the full lifecycle of Ops page data:
 *
 * 1. On mount: loads config + boards list.
 * 2. Reads localStorage for last-used board and board view mode.
 *    If saved board is valid, selects it. Otherwise defaults to first board.
 * 3. When selectedBoardId changes: loads board data, tickets, and work units.
 * 4. Persists board selection and view mode to localStorage.
 */
// Staff sync is triggered on-demand (when settings modals open), not on a timer.

export const useOpsData = (): OpsDataState => {
  const { numaGet, numaPost } = useNumaRequest();

  // ── Cache-aware initial state ─────────────────────────────────────────
  // Read cached data so the UI renders instantly; API fetches still happen
  // in the background and overwrite with fresh data.

  const [initialBoardId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(LS_ACTIVE_BOARD);
      const cachedBoards = getCached<BoardSummary[]>('boards');
      if (saved && cachedBoards?.some((t) => t.id === saved)) return saved;
      return null;
    } catch {
      return null;
    }
  });

  // ── Config ──────────────────────────────────────────────────────────────
  const [config, setConfig] = useState<OpsConfigResponse | null>(() => getCached('config'));
  const [configLoading, setConfigLoading] = useState(() => !getCached('config'));

  // ── Boards ──────────────────────────────────────────────────────────────
  const [boards, setBoards] = useState<BoardSummary[]>(() => getCached<BoardSummary[]>('boards') ?? []);
  const [boardsLoading, setBoardsLoading] = useState(() => !getCached('boards'));
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(initialBoardId);

  // ── Board Data ──────────────────────────────────────────────────────────
  const [boardData, setBoardData] = useState<BoardResponse | null>(() =>
    initialBoardId ? getCached<BoardResponse>(`board_${initialBoardId}`) : null
  );
  const [boardLoading, setBoardLoading] = useState(false);

  // ── Tickets ─────────────────────────────────────────────────────────────
  const [tickets, setTickets] = useState<Ticket[]>(
    () => (initialBoardId ? getCached<Ticket[]>(`tickets_${initialBoardId}`) : null) ?? []
  );
  const [ticketsLoading, setTicketsLoading] = useState(false);

  // ── Work Units ──────────────────────────────────────────────────────────
  const [workUnits, setWorkUnits] = useState<WorkUnit[]>(
    () => (initialBoardId ? getCached<WorkUnit[]>(`workUnits_${initialBoardId}`) : null) ?? []
  );
  const [selectedWorkUnitId, setSelectedWorkUnitId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(LS_SELECTED_WORK_UNIT);
      if (saved) {
        const parsed = JSON.parse(saved) as { boardId: string; wuId: string };
        if (parsed.boardId === initialBoardId && parsed.wuId) return parsed.wuId;
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
      if (saved && ['home', 'board', 'allTickets', 'customers', 'suppliers', 'projects', 'roadmap'].includes(saved)) {
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
      // Migrate old singleTeam/allTeams values to singleBoard/allBoards.
      if (saved === 'singleBoard' || saved === 'singleTeam') return 'singleBoard';
      return 'allBoards';
    } catch {
      return 'allBoards';
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
  const persistBoard = useCallback((boardId: string) => {
    try {
      localStorage.setItem(LS_ACTIVE_BOARD, boardId);
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

  const loadBoards = useCallback(async (): Promise<BoardSummary[]> => {
    try {
      setBoardsLoading(true);
      const data = await OpsService.listBoards(numaGet);
      setBoards(data);
      setCache('boards', data);
      return data;
    } catch (err) {
      console.error('[useOpsData] Failed to load boards:', err);
      return [];
    } finally {
      setBoardsLoading(false);
    }
  }, [numaGet]);

  const loadBoardData = useCallback(
    async (boardId: string): Promise<BoardResponse | null> => {
      try {
        setBoardLoading(true);
        const data = await OpsService.getBoard(numaGet, boardId);
        setBoardData(data);
        setCache(`board_${boardId}`, data);
        return data;
      } catch (err) {
        console.error('[useOpsData] Failed to load board:', err);
        setBoardData(null);
        return null;
      } finally {
        setBoardLoading(false);
      }
    },
    [numaGet]
  );

  const loadTickets = useCallback(
    async (boardId: string) => {
      try {
        setTicketsLoading(true);
        const response = await OpsService.listTickets(numaGet, { boardId });
        setTickets(response.tickets);
        setCache(`tickets_${boardId}`, response.tickets);
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
    async (boardId: string) => {
      try {
        const data = await OpsService.listWorkUnits(numaGet, boardId);
        setWorkUnits(data);
        setCache(`workUnits_${boardId}`, data);
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

      // Load config and boards in parallel
      const [, loadedBoards] = await Promise.all([loadConfig(), loadBoards()]);
      if (cancelled) return;

      // Read persisted board selection from localStorage
      const savedBoardId = localStorage.getItem(LS_ACTIVE_BOARD);

      // Validate that the saved board still exists
      const boardIsValid = savedBoardId && loadedBoards.some((t) => t.id === savedBoardId);

      if (boardIsValid) {
        setSelectedBoardId(savedBoardId);
      } else if (loadedBoards.length > 0) {
        // Auto-select the first board
        setSelectedBoardId(loadedBoards[0].id);
        persistBoard(loadedBoards[0].id);
      }

      initialLoadDone.current = true;
    };

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [loadConfig, loadBoards, persistBoard]);

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

  // ── React to Board Selection Changes ──────────────────────────────────

  useEffect(() => {
    if (!selectedBoardId) {
      setBoardData(null);
      setTickets([]);
      setWorkUnits([]);
      setSelectedWorkUnitId(null);
      return;
    }

    // Show cached board data instantly while fresh data loads
    const cachedBoard = getCached<BoardResponse>(`board_${selectedBoardId}`);
    if (cachedBoard) setBoardData(cachedBoard);
    const cachedTickets = getCached<Ticket[]>(`tickets_${selectedBoardId}`);
    if (cachedTickets) setTickets(cachedTickets);
    const cachedWorkUnits = getCached<WorkUnit[]>(`workUnits_${selectedBoardId}`);
    if (cachedWorkUnits) setWorkUnits(cachedWorkUnits);

    // Load fresh data in the background
    loadBoardData(selectedBoardId);
    loadTickets(selectedBoardId);
    loadWorkUnits(selectedBoardId);
    // Reset work unit selection when board changes
    setSelectedWorkUnitId(null);
  }, [selectedBoardId, loadBoardData, loadTickets, loadWorkUnits]);

  // ── Auto-select zone when zones change ──────────────────────────────────
  //
  // If the active zone is null or no longer exists in the current zones,
  // auto-select the first zone. This handles sprint-start (new zone appears)
  // and sprint-complete (zone may be removed) seamlessly.

  useEffect(() => {
    const zones = boardData?.zones ?? [];
    if (zones.length === 0) {
      if (activeZoneId !== null) setActiveZoneId(null);
      return;
    }
    const currentValid = activeZoneId && zones.some((z) => z.id === activeZoneId);
    if (!currentValid) {
      setActiveZoneId(zones[0].id);
    }
  }, [boardData?.zones, activeZoneId]);

  // ── Actions ───────────────────────────────────────────────────────────

  const selectBoard = useCallback(
    (boardId: string) => {
      setSelectedBoardId(boardId);
      persistBoard(boardId);
      // Restore saved sprint filter for the new board, or clear it
      try {
        const saved = localStorage.getItem(LS_SELECTED_WORK_UNIT);
        if (saved) {
          const parsed = JSON.parse(saved) as { boardId: string; wuId: string };
          setSelectedWorkUnitId(parsed.boardId === boardId ? parsed.wuId : null);
        } else {
          setSelectedWorkUnitId(null);
        }
      } catch {
        setSelectedWorkUnitId(null);
      }
    },
    [persistBoard]
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
        if (wuId && selectedBoardId) {
          localStorage.setItem(LS_SELECTED_WORK_UNIT, JSON.stringify({ boardId: selectedBoardId, wuId }));
        } else {
          localStorage.removeItem(LS_SELECTED_WORK_UNIT);
        }
      } catch {
        /* quota or private mode */
      }
    },
    [selectedBoardId]
  );

  const refreshWorkUnits = useCallback(async () => {
    if (selectedBoardId) {
      await loadWorkUnits(selectedBoardId);
    }
  }, [selectedBoardId, loadWorkUnits]);

  const refreshBoard = useCallback(async (): Promise<BoardResponse | null> => {
    if (selectedBoardId) {
      return loadBoardData(selectedBoardId);
    }
    return null;
  }, [selectedBoardId, loadBoardData]);

  const refreshTickets = useCallback(async () => {
    if (selectedBoardId) {
      await loadTickets(selectedBoardId);
    }
  }, [selectedBoardId, loadTickets]);

  const refreshBoards = useCallback(async () => {
    await loadBoards();
  }, [loadBoards]);

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

    boards,
    boardsLoading,
    selectedBoardId,

    boardData,
    boardLoading,
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

    selectBoard,
    setTopView,
    setPendingSprintFilter,
    setMyWorkFilter,
    setBoardViewMode,
    setActiveZone,
    selectWorkUnit,
    refreshBoard,
    refreshTickets,
    refreshWorkUnits,
    refreshBoards,
    refreshConfig,
    refreshStaff,
    refreshCrmData,
  };
};
