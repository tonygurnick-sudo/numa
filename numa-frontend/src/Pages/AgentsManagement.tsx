import { useCallback, useEffect, useMemo, useState } from 'react';
import { getFlag } from '../utils/featureFlags';
import { Badge, Button, Col, Container, Dropdown, Form, Row, Spinner, Alert, Modal } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useAuth } from '../Providers/AuthProvider';
import { useConfirm } from '../Providers/ConfirmContext';
import {
  listAgents,
  getCachedAgents,
  deleteAgent,
  duplicateAgent,
  getAgentPrefs,
  setAgentPref,
  listTeams,
  listTeamAgents,
} from '../Services/AgentsService';
import { AdminAgentsService, type AgentsMode } from '../Services/AdminAgentsService';
import type { AgentSummary, AgentUserPref, Team } from '../types/agents';
import { AgentCard } from '../Components/Agents/AgentCard';
import { AgentListRow } from '../Components/Agents/AgentListRow';
import { AgentShareModal } from '../Components/Agents/AgentShareModal';
import { AgentManageTeamModal } from '../Components/Agents/AgentManageTeamModal';
import { AgentAdminPanel } from '../Components/Agents/AgentAdminPanel';
import { AgentCreateModal } from '../Components/Agents/AgentCreateModal';
import { AgentScheduleModal } from '../Components/Agents/AgentScheduleModal';
import { AgentScheduleListModal } from '../Components/Agents/AgentScheduleListModal';
import { PageHeader } from '../Components/PageHeader';
import { ScheduleService } from '../Services/ScheduleService';
import type { AgentSchedule } from '../types/agentSchedules';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { getConnectionConfig } from '../config/integrationsConfig';
import { useBranding } from '../Providers/BrandingContext';
import { isScheduleCompleted, calculateNextRun } from '../utils/cronUtils';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Grid3X3,
  Link2,
  List,
  PlusCircle,
  RefreshCw,
  Search,
  Settings,
  Star,
  Store,
  User,
  Users,
  X,
} from 'lucide-react';
import { CollapsibleTagRow } from '../Components/Inputs/CollapsibleTagRow';

type FilterOption = 'all' | 'personal' | 'public' | 'team' | 'favourites';
type ViewMode = 'grid' | 'list';
type SortMode = 'recent' | 'name' | 'used' | 'lastRun';

const LS_VIEW_MODE = 'numa_agents_view_mode';
const LS_SORT_MODE = 'numa_agents_sort_mode';
const LS_COLLAPSED = 'numa_agents_collapsed';
const LS_SHOW_FAVS = 'numa_agents_show_favourites';
const LS_SHOW_HIDDEN = 'numa_agents_show_hidden';

export const AgentsManagement = () => {
  const { t } = useTranslation('agents');
  const { t: tCommon } = useTranslation('common');
  const { numaGet, numaDelete, numaPost, numaPut } = useNumaRequest();
  const { user, lambdaClient } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const agentsFeatureEnabled = getFlag('AGENTS');
  const schedulingEnabled = getFlag('SCHEDULING');

  // Feature flag UX: do not redirect; show disabled preview panel instead
  const { branding } = useBranding();
  const brandPrimaryColor = branding.colors.primary ?? 'var(--brand-primary, var(--color-primary))';
  const brandPrimaryContrast = branding.colors.primaryContrast ?? branding.colors.buttonPrimaryText ?? '#ffffff';
  const brandPrimaryBorderColor =
    branding.colors.buttonPrimaryBorder ?? branding.colors.buttonPrimary ?? brandPrimaryColor;
  const brandPrimarySoftBackground = `color-mix(in srgb, ${brandPrimaryColor} 12%, transparent)`;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentSummary | null>(null);
  const [editModalAccordionKey, setEditModalAccordionKey] = useState<string | undefined>(undefined);
  // SWR: initialize from localStorage cache so agents render instantly.
  // My Agents = personal copies only. Company = all workspace agents.
  const [loading, setLoading] = useState(() => !getCachedAgents('owned'));
  const [companyLoading, setCompanyLoading] = useState(() => !getCachedAgents('public'));
  const [error, setError] = useState<string | null>(null);
  const [myAgents, setMyAgents] = useState<AgentSummary[]>(() => {
    const owned = getCachedAgents('owned') ?? [];
    return owned.filter((a) => a.scope === 'user');
  });
  const [workspaceAgents, setWorkspaceAgents] = useState<AgentSummary[]>(() => getCachedAgents('public') ?? []);
  const [filter, setFilter] = useState<FilterOption>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [agentsMode, setAgentsMode] = useState<AgentsMode>('full');
  const [missingModal, setMissingModal] = useState<{
    show: boolean;
    loading: boolean;
    agent: AgentSummary | null;
    missing: string[];
    error?: string | null;
  }>({ show: false, loading: false, agent: null, missing: [], error: null });

  // Schedule management state
  const [scheduleModal, setScheduleModal] = useState<{
    show: boolean;
    agent: AgentSummary | null;
    editingSchedule: AgentSchedule | null;
  }>({ show: false, agent: null, editingSchedule: null });

  const [scheduleListModal, setScheduleListModal] = useState<{
    show: boolean;
    agent: AgentSummary | null;
  }>({ show: false, agent: null });

  const [agentScheduleMap, setAgentScheduleMap] = useState<Map<string, number>>(new Map());

  // ── New UX state ──
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem(LS_VIEW_MODE) as ViewMode) || 'grid');
  const [sortMode, setSortMode] = useState<SortMode>(
    () => (localStorage.getItem(LS_SORT_MODE) as SortMode) || 'recent'
  );
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_COLLAPSED) || '{}');
    } catch {
      return {};
    }
  });
  const [showFavourites, setShowFavourites] = useState(() => localStorage.getItem(LS_SHOW_FAVS) !== 'false');
  const [showHidden, setShowHidden] = useState(() => localStorage.getItem(LS_SHOW_HIDDEN) === 'true');
  const [prefs, setPrefs] = useState<AgentUserPref[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamAgents, setTeamAgents] = useState<Map<string, AgentSummary[]>>(new Map());
  const [shareModal, setShareModal] = useState<{ show: boolean; agent: AgentSummary | null }>({
    show: false,
    agent: null,
  });
  const [teamModal, setTeamModal] = useState<{ show: boolean; team: Team | null }>({
    show: false,
    team: null,
  });
  const [activeSchedules, setActiveSchedules] = useState<AgentSchedule[]>([]);

  const userId = user?.decoded_tokens?.idToken?.sub ?? '';

  const loadSchedules = async () => {
    try {
      const schedules = await ScheduleService.list(numaGet);
      const scheduleMap = new Map<string, number>();

      // Count schedules per agent - include paused schedules
      const active: AgentSchedule[] = [];
      schedules.forEach((schedule) => {
        if (schedule.agentId && schedule.status !== 'deleted') {
          scheduleMap.set(schedule.agentId, (scheduleMap.get(schedule.agentId) ?? 0) + 1);
          if (schedule.status === 'active' && !isScheduleCompleted(schedule)) {
            active.push(schedule);
          }
        }
      });

      // Sort active by next run time so upcoming schedules banner displays correctly
      active.sort((a, b) => {
        const nextA = calculateNextRun(a.cronExpression, a.timezone, a.status).nextRun;
        const nextB = calculateNextRun(b.cronExpression, b.timezone, b.status).nextRun;
        if (!nextA && !nextB) return 0;
        if (!nextA) return 1;
        if (!nextB) return -1;
        return nextA.getTime() - nextB.getTime();
      });

      setAgentScheduleMap(scheduleMap);
      setActiveSchedules(active);
    } catch (err) {
      console.error('Failed to load schedules:', err);
      // Don't set error for schedule loading - it's not critical
    }
  };

  const loadAgents = async () => {
    try {
      // Only show spinner if we have no cached data — avoids flash when SWR is active
      if (myAgents.length === 0 && workspaceAgents.length === 0) {
        setLoading(true);
      }
      if (workspaceAgents.length === 0) {
        setCompanyLoading(true);
      }
      setError(null);
      const [ownedAgents, companyAgents] = await Promise.all([
        listAgents(numaGet, { scope: 'owned' }),
        listAgents(numaGet, { scope: 'public' }),
      ]);

      const personal = ownedAgents.filter((agent) => agent.scope === 'user');

      if (agentsMode === 'personal_only') {
        setMyAgents([...personal].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
        setWorkspaceAgents([]);
      } else {
        // My Agents = personal copies only. Workspace agents (including ones
        // the user created/shared) stay in Company where they belong.
        setMyAgents([...personal].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
        setWorkspaceAgents(companyAgents.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
      }

      // Load schedules after agents are loaded
      await loadSchedules();
    } catch (err) {
      console.error('AgentsManagement: failed to load agents', err);
      setError((err as Error)?.message ?? t('management.errors.load'));
    } finally {
      setLoading(false);
      setCompanyLoading(false);
    }
  };

  const loadPrefsAndTeams = useCallback(async () => {
    try {
      const [prefsData, teamsData] = await Promise.all([
        getAgentPrefs(numaGet).catch(() => []),
        listTeams(numaGet).catch(() => []),
      ]);
      setPrefs(prefsData);
      setTeams(teamsData);

      // Fetch agents for each team
      if (teamsData.length > 0) {
        const results = await Promise.all(
          teamsData.map((team) => listTeamAgents(numaGet, team.teamId).catch(() => [] as AgentSummary[]))
        );
        const map = new Map<string, AgentSummary[]>();
        teamsData.forEach((team, i) => map.set(team.teamId, results[i]));
        setTeamAgents(map);
      } else {
        setTeamAgents(new Map());
      }
    } catch {
      // best-effort
    }
  }, [numaGet]);

  // ── Persist new UX state to localStorage ──
  useEffect(() => {
    localStorage.setItem(LS_VIEW_MODE, viewMode);
  }, [viewMode]);
  useEffect(() => {
    localStorage.setItem(LS_SORT_MODE, sortMode);
  }, [sortMode]);
  useEffect(() => {
    localStorage.setItem(LS_COLLAPSED, JSON.stringify(collapsedSections));
  }, [collapsedSections]);
  useEffect(() => {
    localStorage.setItem(LS_SHOW_FAVS, String(showFavourites));
  }, [showFavourites]);
  useEffect(() => {
    localStorage.setItem(LS_SHOW_HIDDEN, String(showHidden));
  }, [showHidden]);

  // ── Prefs helpers ──
  const prefsMap = useMemo(() => {
    const map = new Map<string, AgentUserPref>();
    prefs.forEach((p) => map.set(p.agentId, p));
    return map;
  }, [prefs]);

  const isAgentFavorite = useCallback(
    (agent: AgentSummary) => prefsMap.get(agent.agentId)?.isFavorite ?? agent.isFavorite ?? false,
    [prefsMap]
  );

  const isAgentHidden = useCallback(
    (agent: AgentSummary) => prefsMap.get(agent.agentId)?.isHidden ?? false,
    [prefsMap]
  );

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!agentsFeatureEnabled) {
        // When feature is off, present preview/disabled state, no API calls
        setAgentsMode('off');
        setLoading(false);
        setCompanyLoading(false);
        setMyAgents([]);
        setWorkspaceAgents([]);
        return;
      }
      try {
        const res = await AdminAgentsService.get(numaGet);
        if (!cancelled) setAgentsMode(res.mode);
      } catch {
        if (!cancelled) setAgentsMode('full');
      } finally {
        // then load agents + prefs/teams
        loadAgents();
        loadPrefsAndTeams();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentsFeatureEnabled]);

  // All tags sorted by popularity (most used first)
  const allTagsByPopularity = useMemo(() => {
    const counts = new Map<string, number>();
    [...myAgents, ...workspaceAgents].forEach((agent) => {
      agent.tags?.forEach((tag) => {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag);
  }, [myAgents, workspaceAgents]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  // ── Search + hidden + tag filtering ──
  const matchesSearch = useCallback(
    (agent: AgentSummary) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        agent.title?.toLowerCase().includes(q) ||
        agent.description?.toLowerCase().includes(q) ||
        agent.tags?.some((t) => t.toLowerCase().includes(q)) ||
        agent.requiredIntegrations?.some((i) => i.toLowerCase().includes(q))
      );
    },
    [searchQuery]
  );

  const applyFilters = useCallback(
    (agents: AgentSummary[]) => {
      let result = agents;
      // Hide hidden agents unless searching or showHidden is on
      if (!showHidden && !searchQuery) {
        result = result.filter((a) => !isAgentHidden(a));
      }
      // Search
      result = result.filter(matchesSearch);
      // Tags
      if (selectedTags.length > 0) {
        result = result.filter((a) => selectedTags.every((tag) => a.tags?.includes(tag)));
      }
      return result;
    },
    [showHidden, searchQuery, isAgentHidden, matchesSearch, selectedTags]
  );

  const sortAgents = useCallback(
    (agents: AgentSummary[]) => {
      return [...agents].sort((a, b) => {
        switch (sortMode) {
          case 'name':
            return (a.title || '').localeCompare(b.title || '');
          case 'used':
            // Fall through to recent for now (usage tracking needs ConversationMeta integration)
            return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
          case 'lastRun':
            return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
          case 'recent':
          default:
            return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
        }
      });
    },
    [sortMode]
  );

  // Set of agent IDs that are assigned to at least one team -- excluded from personal section
  const teamAgentIds = useMemo(() => {
    const ids = new Set<string>();
    teamAgents.forEach((agents) => agents.forEach((a) => ids.add(a.agentId)));
    return ids;
  }, [teamAgents]);

  // Base agents visible given the scope filter (before tag filtering)
  const filteredMyAgents = useMemo(() => {
    if (filter === 'public' || filter === 'team') return [];
    if (filter === 'favourites')
      return sortAgents(applyFilters(myAgents.filter((a) => isAgentFavorite(a) && !teamAgentIds.has(a.agentId))));
    const base = filter === 'personal' ? myAgents.filter((a) => a.visibility === 'personal') : myAgents;
    const withoutTeamAgents = base.filter((a) => !teamAgentIds.has(a.agentId));
    return sortAgents(applyFilters(withoutTeamAgents));
  }, [filter, myAgents, applyFilters, sortAgents, isAgentFavorite, teamAgentIds]);

  const filteredWorkspaceAgents = useMemo(() => {
    if (filter === 'personal' || filter === 'team') return [];
    if (filter === 'favourites') return sortAgents(applyFilters(workspaceAgents.filter((a) => isAgentFavorite(a))));
    return sortAgents(applyFilters(workspaceAgents));
  }, [filter, workspaceAgents, applyFilters, sortAgents, isAgentFavorite]);

  // Favourite agents across all sections
  const favouriteAgents = useMemo(() => {
    const all = [...myAgents, ...workspaceAgents];
    return sortAgents(applyFilters(all.filter((a) => isAgentFavorite(a))));
  }, [myAgents, workspaceAgents, applyFilters, sortAgents, isAgentFavorite]);

  // Faceted tags: only show tags that still appear on at least one matching agent
  // (agents that already match ALL currently selected tags)
  const availableFilterTags = useMemo(() => {
    const matchingAgents = [...filteredMyAgents, ...filteredWorkspaceAgents];
    const counts = new Map<string, number>();
    matchingAgents.forEach((agent) => {
      agent.tags?.forEach((tag) => {
        if (!selectedTags.includes(tag)) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      });
    });
    // Keep popularity order from allTagsByPopularity, but only include available tags + selected tags
    return allTagsByPopularity.filter((tag) => selectedTags.includes(tag) || counts.has(tag));
  }, [allTagsByPopularity, filteredMyAgents, filteredWorkspaceAgents, selectedTags]);

  const handleCreate = () => {
    setEditingAgent(null);
    setEditModalAccordionKey(undefined);
    setIsModalOpen(true);
  };

  const handleEdit = (agent: AgentSummary) => {
    setEditingAgent(agent);
    setEditModalAccordionKey(undefined);
    setIsModalOpen(true);
  };

  const handleDuplicate = async (agent: AgentSummary) => {
    try {
      await duplicateAgent(numaPost, agent.agentId);
      await loadAgents();
    } catch (err) {
      console.error('AgentsManagement: duplicate failed', err);
      setError((err as Error)?.message ?? t('management.errors.duplicate'));
    }
  };

  const handleToggleFavorite = async (agent: AgentSummary, next: boolean) => {
    try {
      setError(null);
      await setAgentPref(numaPut, agent.agentId, { isFavorite: next });
      // Optimistic update
      setPrefs((prev) => {
        const existing = prev.find((p) => p.agentId === agent.agentId);
        if (existing) {
          return prev.map((p) => (p.agentId === agent.agentId ? { ...p, isFavorite: next } : p));
        }
        return [...prev, { agentId: agent.agentId, isFavorite: next, isHidden: false }];
      });
    } catch (err) {
      console.error('AgentsManagement: toggle favorite failed', err);
      setError((err as Error)?.message ?? t('management.errors.favorite'));
    }
  };

  const handleToggleHidden = async (agent: AgentSummary, next: boolean) => {
    try {
      setError(null);
      await setAgentPref(numaPut, agent.agentId, { isHidden: next });
      // Optimistic update
      setPrefs((prev) => {
        const existing = prev.find((p) => p.agentId === agent.agentId);
        if (existing) {
          return prev.map((p) => (p.agentId === agent.agentId ? { ...p, isHidden: next } : p));
        }
        return [...prev, { agentId: agent.agentId, isFavorite: false, isHidden: next }];
      });
    } catch (err) {
      console.error('AgentsManagement: toggle hidden failed', err);
    }
  };

  const handleShare = (agent: AgentSummary) => {
    setShareModal({ show: true, agent });
  };

  const handleManageTeam = (team: Team) => {
    setTeamModal({ show: true, team });
  };

  const handleCreateTeam = () => {
    setTeamModal({ show: true, team: null });
  };

  const handleDelete = async (agent: AgentSummary) => {
    try {
      const schedules = await ScheduleService.getByAgent(numaGet, agent.agentId);
      const activeSchedules = schedules.filter((s) => s.status === 'active');

      if (activeSchedules.length > 0) {
        // Collect a list of recognizable schedule names (label, prompt text, or ID as fallback)
        const scheduleNames = activeSchedules.map((s) => s.label || s.promptText || s.scheduleId).join('\n• ');
        const confirmMessage = `${t('management.confirmDeleteWithSchedules', {
          title: agent.title,
          count: activeSchedules.length,
        })}\n\n• ${scheduleNames}`;

        const ok = await confirm({
          message: confirmMessage,
          confirmLabel: tCommon('confirm.delete'),
          variant: 'danger',
        });
        if (!ok) return;
      } else {
        const ok = await confirm({
          message: t('management.confirmDelete', { title: agent.title }),
          confirmLabel: tCommon('confirm.delete'),
          variant: 'danger',
        });
        if (!ok) return;
      }

      await deleteAgent(numaDelete, agent.agentId);
      await loadAgents();
    } catch (err) {
      console.error('AgentsManagement: delete failed', err);
      setError((err as Error)?.message ?? t('management.errors.delete'));
    }
  };

  const proceedToChat = (agent: AgentSummary) => {
    const token = String(Date.now());
    sessionStorage.setItem('numa_preselected_agent', JSON.stringify(agent));
    sessionStorage.setItem('numa_preselected_agent_token', token);
    sessionStorage.removeItem('numa_preselected_agent_consumed');
    navigate('/chat');
  };

  const initiateChat = (agent: AgentSummary) => {
    proceedToChat(agent);
  };

  const handleStartChat = async (agent: AgentSummary) => {
    const needs = agent.requiredIntegrations || [];
    const hasPipedreamFeature = getFlag('PIPEDREAM_INTEGRATIONS');
    if (!hasPipedreamFeature || needs.length === 0) {
      initiateChat(agent);
      return;
    }
    // Open modal in loading state while we resolve connections
    setMissingModal({ show: true, loading: true, agent, missing: [], error: null });

    try {
      if (!user || !lambdaClient) {
        setMissingModal({ show: true, loading: false, agent, missing: needs, error: null });
        return;
      }

      const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
      const status = await PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId, {
        ttlMs: 30 * 60 * 1000,
      });
      const connected = new Set((status.connected_apps || []).map((n) => String(n)));
      const missing = needs.filter((n) => !connected.has(n));
      if (missing.length === 0) {
        setMissingModal({ show: false, loading: false, agent: null, missing: [] });
        initiateChat(agent);
        return;
      }
      setMissingModal({ show: true, loading: false, agent, missing, error: null });
    } catch {
      setMissingModal({ show: true, loading: false, agent, missing: needs, error: null });
    }
  };

  const handleModalSaved = async () => {
    await Promise.all([loadAgents(), loadPrefsAndTeams()]);
  };

  const handleScheduleAgent = (_agent: AgentSummary) => {
    // Navigate to the Automations page — scheduling is managed there
    navigate('/automations');
  };

  const buildScheduleRunConfig = (agent: AgentSummary) => {
    const toolsConfig = agent.toolsConfig || {};
    const enabledConnections = Array.from(
      new Set([...(toolsConfig.enabledConnections || []), ...(agent.requiredIntegrations || [])])
    );
    const enabledKBIds = Array.isArray(toolsConfig.allowedKnowledgeBases)
      ? toolsConfig.allowedKnowledgeBases
      : undefined;
    return {
      enabledConnections,
      enabledKBIds,
      autoToolsEnabled: toolsConfig.autoToolsEnabled,
      webSearchEnabled: toolsConfig.webSearchEnabled,
      createAgentEnabled: toolsConfig.createAgentEnabled,
    };
  };

  const buildAgentSnapshot = (agent: AgentSummary) => ({
    agentId: agent.agentId,
    title: agent.title,
    icon: agent.icon,
    iconImage: agent.iconImage,
    version: agent.version,
    visibility: agent.visibility,
    systemPrompt: agent.systemPrompt,
    userWelcomeMessage: agent.userWelcomeMessage,
    requiredIntegrations: agent.requiredIntegrations,
    toolsConfig: agent.toolsConfig,
  });

  const handleScheduleCreate = async (payload: {
    promptText: string;
    cronExpression: string;
    timezone: string;
    label?: string;
  }) => {
    try {
      if (!scheduleModal.agent) return;

      if (scheduleModal.editingSchedule) {
        // Update existing schedule
        await ScheduleService.update(numaPut, scheduleModal.editingSchedule.scheduleId, payload);
      } else {
        // Create new schedule
        await ScheduleService.create(numaPost, {
          agentId: scheduleModal.agent.agentId,
          agentTitle: scheduleModal.agent.title,
          conversationId: `schedule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, // Generate unique conversation ID
          ...payload,
          runConfig: buildScheduleRunConfig(scheduleModal.agent),
          agentSnapshot: buildAgentSnapshot(scheduleModal.agent),
        });
      }

      // Refresh schedules after creation/update
      await loadSchedules();

      // Close modal
      setScheduleModal({ show: false, agent: null, editingSchedule: null });
    } catch (err) {
      console.error('Failed to save schedule:', err);
      // Error will be handled by the modal component
      throw err;
    }
  };

  const handleScheduleModalClose = () => {
    setScheduleModal({ show: false, agent: null, editingSchedule: null });
  };

  const handleScheduleListModalClose = () => {
    setScheduleListModal({ show: false, agent: null });
  };

  const handleEditSchedule = (schedule: AgentSchedule) => {
    // Find the agent for this schedule
    const agent = [...myAgents, ...workspaceAgents].find((a) => a.agentId === schedule.agentId);
    if (agent) {
      setScheduleModal({ show: true, agent, editingSchedule: schedule });
    }
  };

  const handleScheduleChange = () => {
    // Called when schedules are modified in the list modal
    loadSchedules();
  };

  const handleCreateScheduleFromList = () => {
    // Create a new schedule for the current agent from the schedule list modal
    if (scheduleListModal.agent) {
      setScheduleModal({ show: true, agent: scheduleListModal.agent, editingSchedule: null });
    }
  };

  // Warm integrations cache on page load to make pre-chat checks instant
  useEffect(() => {
    const warmCache = async () => {
      try {
        const hasPipedreamFeature = getFlag('PIPEDREAM_INTEGRATIONS');
        if (!hasPipedreamFeature || !user || !lambdaClient) return;
        const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
        await PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId, {
          ttlMs: 30 * 60 * 1000,
        });
      } catch {
        // best-effort warm
      }
    };
    warmCache();
  }, [user, lambdaClient]);

  const renderAgentsSection = (
    agents: AgentSummary[],
    emptyMessage: string,
    isMyAgentsSection = false,
    roleBadgeMap?: Map<string, string>
  ) => {
    if (!agents.length) {
      return <p className="text-muted small">{emptyMessage}</p>;
    }

    if (viewMode === 'list') {
      return (
        <div className="d-flex flex-column gap-2">
          {agents.map((agent) => (
            <AgentListRow
              key={agent.agentId}
              agent={agent}
              isFavorite={isAgentFavorite(agent)}
              isHidden={isAgentHidden(agent)}
              roleBadge={roleBadgeMap?.get(agent.agentId)}
              onChat={handleStartChat}
              onEdit={agent.scope === 'user' || agent.createdBy.userId === userId ? handleEdit : undefined}
              onDelete={agent.scope === 'user' || agent.createdBy.userId === userId ? handleDelete : undefined}
              onToggleFavorite={handleToggleFavorite}
              onToggleHidden={agent.scope !== 'user' ? handleToggleHidden : undefined}
              onShare={handleShare}
              searchHighlight={searchQuery}
            />
          ))}
        </div>
      );
    }

    return (
      <Row xs={1} md={2} lg={3} className="g-4">
        {agents.map((agent) => (
          <Col key={agent.agentId}>
            <AgentCard
              agent={agent}
              isFavorite={isAgentFavorite(agent)}
              onChat={handleStartChat}
              onEdit={agent.scope === 'user' || agent.createdBy.userId === userId ? handleEdit : undefined}
              onDuplicate={handleDuplicate}
              onDelete={agent.scope === 'user' || agent.createdBy.userId === userId ? handleDelete : undefined}
              onSchedule={schedulingEnabled ? handleScheduleAgent : undefined}
              onToggleFavorite={handleToggleFavorite}
              hasSchedules={schedulingEnabled && (agentScheduleMap.get(agent.agentId) ?? 0) > 0}
              scheduleCount={agentScheduleMap.get(agent.agentId) ?? 0}
              isInMyAgentsSection={isMyAgentsSection}
            />
          </Col>
        ))}
      </Row>
    );
  };

  const totalAgents = myAgents.length + workspaceAgents.length;
  const personalCount = myAgents.filter((a) => a.scope === 'user' && !teamAgentIds.has(a.agentId)).length;
  const publicCount = workspaceAgents.length;
  const favouriteCount = favouriteAgents.length;
  const teamCount = useMemo(() => {
    let count = 0;
    teamAgents.forEach((agents) => {
      count += agents.length;
    });
    return count;
  }, [teamAgents]);
  const headerActions = (
    <div className="agents-hero__actions d-flex align-items-center gap-2 flex-wrap">
      {/* Search */}
      <div className="position-relative">
        <Search
          size={14}
          className="position-absolute text-muted"
          style={{ left: 10, top: '50%', transform: 'translateY(-50%)' }}
        />
        <Form.Control
          type="text"
          placeholder={t('management.search.placeholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          size="sm"
          style={{ paddingLeft: 32, width: 240 }}
        />
        {searchQuery && (
          <button
            className="btn btn-sm position-absolute border-0 text-muted"
            style={{ right: 4, top: '50%', transform: 'translateY(-50%)', padding: '2px 4px' }}
            onClick={() => setSearchQuery('')}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* View toggle */}
      <div className="btn-group btn-group-sm">
        <button
          className={`btn ${viewMode === 'grid' ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => setViewMode('grid')}
          title={t('management.view.grid')}
        >
          <Grid3X3 size={14} />
        </button>
        <button
          className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => setViewMode('list')}
          title={t('management.view.list')}
        >
          <List size={14} />
        </button>
      </div>

      {/* View Options dropdown */}
      <Dropdown align="end">
        <Dropdown.Toggle variant="outline-secondary" size="sm" className="d-flex align-items-center gap-1">
          <Settings size={14} />
          {t('management.viewOptions.title')}
        </Dropdown.Toggle>
        <Dropdown.Menu style={{ minWidth: 220, fontSize: '0.85rem' }}>
          <Dropdown.Header
            className="text-uppercase small fw-bold"
            style={{ letterSpacing: '0.5px', fontSize: '0.7rem' }}
          >
            {t('management.viewOptions.sortBy')}
          </Dropdown.Header>
          {(['recent', 'name', 'used', 'lastRun'] as SortMode[]).map((mode) => (
            <Dropdown.Item key={mode} active={sortMode === mode} onClick={() => setSortMode(mode)}>
              {sortMode === mode && (
                <span style={{ width: 14, display: 'inline-block', color: 'var(--brand-primary, #6366f1)' }}>
                  <Check size={14} />
                </span>
              )}
              {sortMode !== mode && <span style={{ width: 14, display: 'inline-block' }} />}
              {t(`management.viewOptions.sort.${mode}`)}
            </Dropdown.Item>
          ))}
          <Dropdown.Divider />
          <Dropdown.Header
            className="text-uppercase small fw-bold"
            style={{ letterSpacing: '0.5px', fontSize: '0.7rem' }}
          >
            {t('management.viewOptions.sections')}
          </Dropdown.Header>
          <Dropdown.Item
            as="div"
            className="d-flex justify-content-between align-items-center px-3 py-2"
            style={{ cursor: 'pointer' }}
            onClick={() => setShowFavourites(!showFavourites)}
          >
            <span>{t('management.viewOptions.showFavourites')}</span>
            <div
              style={{
                width: 32,
                height: 18,
                borderRadius: 9,
                position: 'relative',
                background: showFavourites ? 'var(--brand-primary, #6366f1)' : '#d1d5db',
                transition: 'background 0.2s',
                flexShrink: 0,
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: 2,
                  left: showFavourites ? 16 : 2,
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              />
            </div>
          </Dropdown.Item>
          <Dropdown.Divider />
          <Dropdown.Header
            className="text-uppercase small fw-bold"
            style={{ letterSpacing: '0.5px', fontSize: '0.7rem' }}
          >
            {t('management.viewOptions.visibility')}
          </Dropdown.Header>
          <Dropdown.Item
            as="div"
            className="d-flex justify-content-between align-items-center px-3 py-2"
            style={{ cursor: 'pointer' }}
            onClick={() => setShowHidden(!showHidden)}
          >
            <span>{t('management.viewOptions.showHidden')}</span>
            <div
              style={{
                width: 32,
                height: 18,
                borderRadius: 9,
                position: 'relative',
                background: showHidden ? 'var(--brand-primary, #6366f1)' : '#d1d5db',
                transition: 'background 0.2s',
                flexShrink: 0,
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: 2,
                  left: showHidden ? 16 : 2,
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              />
            </div>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>

      <button type="button" className="agents-hero__action-btn" onClick={loadAgents} disabled={loading}>
        <RefreshCw
          size={16}
          className={`agents-hero__action-icon ${loading ? 'is-spinning' : ''}`}
          aria-hidden="true"
        />
        {t('management.actions.refresh')}
      </button>
      {agentsFeatureEnabled && agentsMode !== 'off' && (
        <>
          <button type="button" className="agents-hero__action-btn" onClick={handleCreateTeam}>
            <Users size={16} className="agents-hero__action-icon" aria-hidden="true" />
            {t('management.createTeam.button')}
          </button>
          <button
            type="button"
            className="agents-hero__action-btn agents-hero__action-btn--primary"
            onClick={handleCreate}
          >
            <PlusCircle size={16} className="agents-hero__action-icon" aria-hidden="true" />
            {t('management.actions.create')}
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="dashboard agents-page">
      <PageHeader title={t('management.title')} subtitle={t('management.subtitle')} actions={headerActions} />

      <LayoutDashboard>
        {agentsFeatureEnabled && (
          <Container fluid className="px-0">
            <Row className="g-3 mb-4">
              {(
                [
                  { key: 'all' as FilterOption, label: t('management.stats.total'), count: totalAgents, Icon: Bot },
                  {
                    key: 'personal' as FilterOption,
                    label: t('management.stats.personal'),
                    count: personalCount,
                    Icon: User,
                  },
                  { key: 'team' as FilterOption, label: t('management.stats.team'), count: teamCount, Icon: Users },
                  {
                    key: 'public' as FilterOption,
                    label: t('management.stats.company'),
                    count: publicCount,
                    Icon: Store,
                  },
                  {
                    key: 'favourites' as FilterOption,
                    label: t('management.stats.favourites'),
                    count: favouriteCount,
                    Icon: Star,
                  },
                ] as const
              ).map(({ key, label, count, Icon }) => (
                <Col key={key}>
                  <div
                    className="p-3 rounded-3 border bg-white"
                    role="button"
                    onClick={() => setFilter(key)}
                    style={{
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      borderColor: filter === key ? brandPrimaryColor : '#e8ecf2',
                      borderWidth: filter === key ? '2px' : '1px',
                      backgroundColor: filter === key ? brandPrimarySoftBackground : '#ffffff',
                      boxShadow: filter === key ? `0 0 0 1px ${brandPrimaryColor}20` : 'none',
                    }}
                  >
                    <div className="d-flex align-items-center justify-content-between">
                      <div>
                        <div className="text-muted small mb-1">{label}</div>
                        <div className="fs-4 fw-bold" style={{ color: filter === key ? brandPrimaryColor : undefined }}>
                          {count}
                        </div>
                      </div>
                      <div
                        className="rounded-circle d-flex align-items-center justify-content-center"
                        style={{ width: 48, height: 48, backgroundColor: brandPrimarySoftBackground }}
                      >
                        <Icon size={20} style={{ color: brandPrimaryColor }} aria-hidden="true" />
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          </Container>
        )}

        {/* Admin Panel (admin users only) -- above tag filter */}
        {agentsFeatureEnabled && user?.groups?.includes('admin') && (
          <Container fluid className="px-0 mb-3">
            <AgentAdminPanel onAgentDeleted={loadAgents} onAgentDuplicated={loadAgents} />
          </Container>
        )}

        {/* Tag filter bar */}
        {availableFilterTags.length > 0 && (
          <Container fluid className="px-0 mb-3">
            <CollapsibleTagRow
              tags={availableFilterTags}
              gap="0.35rem"
              prefix={<span className="text-muted small fw-semibold me-1">{t('management.filters.tags')}</span>}
              renderTag={(tag) => (
                <Badge
                  bg=""
                  role="button"
                  onClick={() => toggleTag(tag)}
                  style={{
                    backgroundColor: selectedTags.includes(tag) ? brandPrimaryColor : '#f0f0f0',
                    color: selectedTags.includes(tag) ? brandPrimaryContrast : '#333',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    padding: '0.35em 0.7em',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {tag}
                </Badge>
              )}
            />
            {selectedTags.length > 0 && (
              <Button variant="link" size="sm" className="p-0 text-muted mt-1" onClick={() => setSelectedTags([])}>
                <X size={14} className="me-1" />
                {t('management.filters.clearTags')}
              </Button>
            )}
          </Container>
        )}

        {/* Upcoming Schedules Banner */}
        {schedulingEnabled && activeSchedules.length > 0 && (
          <Container fluid className="px-0 mb-4">
            <div
              className="p-3 rounded-3 border"
              style={{ backgroundColor: brandPrimarySoftBackground, borderColor: brandPrimaryBorderColor }}
            >
              <div className="d-flex align-items-center justify-content-between mb-2">
                <div className="d-flex align-items-center gap-2">
                  <Clock size={18} style={{ color: brandPrimaryColor }} />
                  <h6 className="mb-0 fw-semibold" style={{ color: brandPrimaryColor }}>
                    {t('management.upcomingSchedules.title')}
                  </h6>
                  <span
                    className="badge rounded-pill"
                    style={{ backgroundColor: brandPrimaryColor, color: brandPrimaryContrast }}
                  >
                    {activeSchedules.length}
                  </span>
                </div>
                {schedulingEnabled && (
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0 text-decoration-none"
                    style={{ color: brandPrimaryColor }}
                    onClick={() => navigate('/automations')}
                  >
                    {t('management.upcomingSchedules.viewAll')}
                  </Button>
                )}
              </div>
              <div className="d-flex flex-wrap gap-2">
                {activeSchedules.slice(0, 5).map((schedule) => {
                  const nextRunInfo = calculateNextRun(schedule.cronExpression, schedule.timezone, schedule.status);
                  const agentName = schedule.agentTitle || schedule.label || schedule.agentId;
                  const nextTimeStr = nextRunInfo.nextRun
                    ? nextRunInfo.nextRun.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                    : null;
                  return (
                    <div
                      key={schedule.scheduleId}
                      className="bg-white rounded-2 border px-3 py-2 d-flex align-items-center gap-2"
                      style={{ fontSize: '0.85rem', cursor: 'pointer' }}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/automations/${schedule.scheduleId}`, { state: { schedule } })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(`/scheduling/${schedule.scheduleId}`, { state: { schedule } });
                        }
                      }}
                    >
                      <Clock size={13} style={{ color: brandPrimaryColor }} />
                      <span className="fw-medium">
                        {nextTimeStr
                          ? t('management.upcomingSchedules.atTime', { agent: agentName, time: nextTimeStr })
                          : agentName}
                      </span>
                      {nextRunInfo.humanReadable && (
                        <span className="text-muted small">{nextRunInfo.humanReadable}</span>
                      )}
                    </div>
                  );
                })}
                {activeSchedules.length > 5 && (
                  <span className="text-muted small align-self-center">+{activeSchedules.length - 5}</span>
                )}
              </div>
            </div>
          </Container>
        )}

        <Container fluid className="px-0 pt-0 pb-4">
          {!agentsFeatureEnabled && (
            <>
              <Alert variant="info" className="mb-3">
                <div className="d-flex align-items-start">
                  <Bot size={16} className="me-2 mt-1" aria-hidden="true" />
                  <div>
                    <div className="fw-semibold">{t('management.disabled.title')}</div>
                    <div className="small text-muted">{t('management.disabled.description')}</div>
                  </div>
                </div>
              </Alert>
              <div className="text-center py-5">
                <div className="mb-4">
                  <Bot size={64} className="text-muted" aria-hidden="true" />
                </div>
                <h3 className="h5 mb-2">{t('management.disabled.emptyTitle')}</h3>
                <p className="text-muted mb-0" style={{ maxWidth: 640, margin: '0 auto' }}>
                  {t('management.disabled.emptyDescription')}
                </p>
              </div>
            </>
          )}

          {agentsFeatureEnabled && error && (
            <Alert variant="danger" onClose={() => setError(null)} dismissible>
              {error}
            </Alert>
          )}

          {agentsFeatureEnabled &&
            (loading ? (
              <div className="d-flex justify-content-center align-items-center py-5">
                <Spinner animation="border" />
              </div>
            ) : (
              <>
                {/* ── Favourites Section ── */}
                {showFavourites &&
                  favouriteAgents.length > 0 &&
                  filter !== 'personal' &&
                  filter !== 'public' &&
                  filter !== 'team' && (
                    <section className="agents-section mb-4">
                      <div
                        className="agents-section__header d-flex align-items-center gap-2 p-3 rounded-3 border bg-white mb-3"
                        role="button"
                        onClick={() => toggleSection('favourites')}
                        style={{ cursor: 'pointer' }}
                      >
                        <Star size={16} style={{ color: '#f59e0b' }} />
                        <h2 className="agents-section__title mb-0 fs-6 fw-bold">
                          {t('management.sections.favourites.title')}
                        </h2>
                        <span className="badge rounded-pill" style={{ backgroundColor: '#fce7f3', color: '#db2777' }}>
                          {favouriteAgents.length}
                        </span>
                        <span className="ms-auto">
                          {collapsedSections.favourites ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                        </span>
                      </div>
                      {!collapsedSections.favourites &&
                        renderAgentsSection(favouriteAgents, t('management.empty.favourites'))}
                    </section>
                  )}

                {/* ── Personal Section ── */}
                {filter !== 'public' && filter !== 'team' && filteredMyAgents.length > 0 && (
                  <section className="agents-section mb-4">
                    <div
                      className="agents-section__header d-flex align-items-center gap-2 p-3 rounded-3 border bg-white mb-3"
                      role="button"
                      onClick={() => toggleSection('personal')}
                      style={{ cursor: 'pointer' }}
                    >
                      <User size={16} style={{ color: brandPrimaryColor }} />
                      <h2 className="agents-section__title mb-0 fs-6 fw-bold">
                        {t('management.sections.myAgents.title')}
                      </h2>
                      <span className="badge rounded-pill" style={{ backgroundColor: '#ede9fe', color: '#6366f1' }}>
                        {filteredMyAgents.length}
                      </span>
                      <span className="ms-auto">
                        {collapsedSections.personal ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      </span>
                    </div>
                    {!collapsedSections.personal &&
                      renderAgentsSection(
                        filteredMyAgents,
                        filter === 'personal' ? t('management.empty.personalOnly') : t('management.empty.none'),
                        true
                      )}
                  </section>
                )}

                {/* ── Team Sections ── */}
                {filter !== 'personal' &&
                  filter !== 'public' &&
                  teams.map((team) => {
                    const agents = teamAgents.get(team.teamId) ?? [];
                    const filteredTeamAgentsList = sortAgents(applyFilters(agents));
                    return (
                      <section key={team.teamId} className="agents-section mb-4">
                        <div
                          className="agents-section__header d-flex align-items-center gap-2 p-3 rounded-3 border bg-white mb-3"
                          role="button"
                          onClick={() => toggleSection(`team-${team.teamId}`)}
                          style={{ cursor: 'pointer' }}
                        >
                          <Users size={16} style={{ color: '#16a34a' }} />
                          <h2 className="agents-section__title mb-0 fs-6 fw-bold">{team.teamName}</h2>
                          <span className="badge rounded-pill" style={{ backgroundColor: '#dcfce7', color: '#16a34a' }}>
                            {filteredTeamAgentsList.length}
                          </span>
                          <span
                            className="small text-muted"
                            style={{ cursor: 'pointer', marginLeft: 8 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleManageTeam(team);
                            }}
                          >
                            {t('teamModal.title')} &rsaquo;
                          </span>
                          <span className="ms-auto">
                            {collapsedSections[`team-${team.teamId}`] ? (
                              <ChevronRight size={16} />
                            ) : (
                              <ChevronDown size={16} />
                            )}
                          </span>
                        </div>
                        {!collapsedSections[`team-${team.teamId}`] &&
                          renderAgentsSection(filteredTeamAgentsList, t('management.sections.team.placeholder'))}
                      </section>
                    );
                  })}

                {/* ── Company Section ── */}
                {agentsMode !== 'personal_only' &&
                  filter !== 'personal' &&
                  filter !== 'team' &&
                  (filteredWorkspaceAgents.length > 0 || companyLoading) && (
                    <section className="agents-section mb-4">
                      <div
                        className="agents-section__header d-flex align-items-center gap-2 p-3 rounded-3 border bg-white mb-3"
                        role="button"
                        onClick={() => toggleSection('company')}
                        style={{ cursor: 'pointer' }}
                      >
                        <Store size={16} style={{ color: '#d97706' }} />
                        <h2 className="agents-section__title mb-0 fs-6 fw-bold">
                          {t('management.sections.company.title')}
                        </h2>
                        {!companyLoading && (
                          <span className="badge rounded-pill" style={{ backgroundColor: '#fef3c7', color: '#d97706' }}>
                            {filteredWorkspaceAgents.length}
                          </span>
                        )}
                        <span className="ms-auto">
                          {collapsedSections.company ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                        </span>
                      </div>
                      {!collapsedSections.company &&
                        (companyLoading && filteredWorkspaceAgents.length === 0 ? (
                          <div className="d-flex justify-content-center py-4">
                            <Spinner animation="border" size="sm" />
                          </div>
                        ) : (
                          renderAgentsSection(filteredWorkspaceAgents, t('management.empty.company'))
                        ))}
                    </section>
                  )}

                {filteredMyAgents.length === 0 &&
                  filteredWorkspaceAgents.length === 0 &&
                  favouriteAgents.length === 0 && (
                    <div className="text-center py-5">
                      <div className="mb-4">
                        <Bot size={64} className="text-muted" aria-hidden="true" />
                      </div>
                      <h3 className="h5 mb-2">{t('management.empty.title')}</h3>
                      <p className="text-muted mb-4">
                        {searchQuery
                          ? t('management.empty.noSearchMatch')
                          : selectedTags.length > 0
                            ? t('management.empty.noTagMatch')
                            : agentsMode === 'off'
                              ? t('management.empty.modeOff')
                              : filter === 'all'
                                ? t('management.empty.all')
                                : filter === 'personal'
                                  ? t('management.empty.personal')
                                  : t('management.empty.company')}
                      </p>
                      {agentsMode !== 'off' && !searchQuery && (
                        <Button variant="primary" onClick={handleCreate}>
                          <PlusCircle size={16} className="me-2" aria-hidden="true" />
                          {t('management.actions.createFirst')}
                        </Button>
                      )}
                    </div>
                  )}
              </>
            ))}

          <AgentCreateModal
            show={isModalOpen}
            onHide={() => {
              setIsModalOpen(false);
              setEditModalAccordionKey(undefined);
            }}
            editingAgent={editingAgent}
            onAgentSaved={handleModalSaved}
            onScheduleCreated={loadSchedules}
            initialAccordionKey={editModalAccordionKey}
            onScheduleChange={loadSchedules}
            existingTags={allTagsByPopularity}
            teams={teams}
          />

          <AgentScheduleModal
            show={scheduleModal.show}
            onHide={handleScheduleModalClose}
            agent={scheduleModal.agent}
            editingSchedule={scheduleModal.editingSchedule}
            onCreate={handleScheduleCreate}
          />

          <AgentScheduleListModal
            show={scheduleListModal.show}
            onHide={handleScheduleListModalClose}
            agent={scheduleListModal.agent}
            onScheduleChange={handleScheduleChange}
            onEditSchedule={handleEditSchedule}
            onCreateSchedule={handleCreateScheduleFromList}
          />
          <AgentShareModal
            show={shareModal.show}
            onHide={() => setShareModal({ show: false, agent: null })}
            agent={shareModal.agent}
            teams={teams}
          />

          <AgentManageTeamModal
            show={teamModal.show}
            onHide={() => setTeamModal({ show: false, team: null })}
            team={teamModal.team}
            onTeamCreated={loadPrefsAndTeams}
            onTeamDeleted={loadPrefsAndTeams}
            onTeamUpdated={loadPrefsAndTeams}
          />

          {/* Missing integrations confirmation modal (pre-chat) */}
          <Modal show={missingModal.show} onHide={() => setMissingModal((m) => ({ ...m, show: false }))} centered>
            <Modal.Header closeButton>
              <Modal.Title>{t('management.missingIntegrations.title')}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              {missingModal.loading ? (
                <div className="d-flex align-items-center">
                  <Spinner animation="border" size="sm" className="me-2" />{' '}
                  {t('management.missingIntegrations.loading')}
                </div>
              ) : (
                <>
                  <p className="mb-3">{t('management.missingIntegrations.description')}</p>
                  <div className="d-flex flex-column gap-2 mb-3">
                    {missingModal.missing.map((id) => {
                      const config = getConnectionConfig(id);
                      return (
                        <div
                          key={id}
                          className="d-flex align-items-center gap-3 p-3 border rounded-2 bg-light"
                          style={{ transition: 'all 0.2s ease' }}
                        >
                          {config?.img_src ? (
                            <img
                              src={config.img_src}
                              alt={config.name}
                              style={{ width: 32, height: 32, objectFit: 'contain', flexShrink: 0 }}
                            />
                          ) : (
                            <div
                              className="rounded-2 bg-secondary bg-opacity-10 d-flex align-items-center justify-content-center"
                              style={{ width: 32, height: 32, flexShrink: 0 }}
                            >
                              <Link2 size={16} className="text-secondary" aria-hidden="true" />
                            </div>
                          )}
                          <span className="fw-medium">{config?.name || id}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mb-0 text-muted small">{t('management.missingIntegrations.note')}</p>
                </>
              )}
            </Modal.Body>
            {!missingModal.loading && (
              <Modal.Footer>
                <Button
                  variant="outline-secondary"
                  onClick={() => setMissingModal((m) => ({ ...m, show: false }))}
                  className="me-auto"
                >
                  <ArrowLeft size={16} className="me-2" aria-hidden="true" />
                  {t('management.missingIntegrations.back')}
                </Button>
                <a className="btn btn-outline-primary" href="/integrations">
                  <ExternalLink size={16} className="me-2" aria-hidden="true" />
                  {t('management.missingIntegrations.goToIntegrations')}
                </a>
                <Button
                  variant="primary"
                  onClick={() => {
                    const a = missingModal.agent;
                    setMissingModal({ show: false, loading: false, agent: null, missing: [] });
                    if (a) initiateChat(a);
                  }}
                >
                  {t('management.missingIntegrations.continue')}
                </Button>
              </Modal.Footer>
            )}
          </Modal>
        </Container>
      </LayoutDashboard>
    </div>
  );
};

export default AgentsManagement;
