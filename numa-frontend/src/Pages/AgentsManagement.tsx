import { useEffect, useMemo, useState } from 'react';
import { getFlag } from '../utils/featureFlags';
import { Badge, Button, Col, Container, Row, Spinner, Alert, Modal } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useAuth } from '../Providers/AuthProvider';
import { listAgents, getCachedAgents, deleteAgent, duplicateAgent, updateAgent } from '../Services/AgentsService';
import { AdminAgentsService, type AgentsMode } from '../Services/AdminAgentsService';
import type { AgentSummary } from '../types/agents';
import { AgentCard } from '../Components/Agents/AgentCard';
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
import { ArrowLeft, Bot, Clock, ExternalLink, Link2, PlusCircle, RefreshCw, Store, User, X } from 'lucide-react';
import { CollapsibleTagRow } from '../Components/Inputs/CollapsibleTagRow';

type FilterOption = 'all' | 'personal' | 'public';

export const AgentsManagement = () => {
  const { t } = useTranslation('agents');
  const { numaGet, numaDelete, numaPost, numaPut } = useNumaRequest();
  const { user, lambdaClient } = useAuth();
  const navigate = useNavigate();
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
        // then load agents
        loadAgents();
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

  // Base agents visible given the scope filter (before tag filtering)
  const baseMyAgents = useMemo(() => {
    if (filter === 'public') return [];
    return filter === 'personal' ? myAgents.filter((agent) => agent.visibility === 'personal') : myAgents;
  }, [filter, myAgents]);

  const baseWorkspaceAgents = useMemo(() => {
    if (filter === 'personal') return [];
    return workspaceAgents;
  }, [filter, workspaceAgents]);

  const filteredMyAgents = useMemo(() => {
    if (selectedTags.length === 0) return baseMyAgents;
    return baseMyAgents.filter((agent) => selectedTags.every((tag) => agent.tags?.includes(tag)));
  }, [baseMyAgents, selectedTags]);

  const filteredWorkspaceAgents = useMemo(() => {
    if (selectedTags.length === 0) return baseWorkspaceAgents;
    return baseWorkspaceAgents.filter((agent) => selectedTags.every((tag) => agent.tags?.includes(tag)));
  }, [baseWorkspaceAgents, selectedTags]);

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
      if (agent.scope === 'user') {
        await updateAgent(numaPut, agent.agentId, { isFavorite: next });
      } else if (agent.scope === 'workspace' && agent.createdBy.userId === userId) {
        await updateAgent(numaPut, agent.agentId, { isFavorite: next });
      }
      await loadAgents();
    } catch (err) {
      console.error('AgentsManagement: toggle favorite failed', err);
      setError((err as Error)?.message ?? t('management.errors.favorite'));
    }
  };

  const handleDelete = async (agent: AgentSummary) => {
    if (!window.confirm(t('management.confirmDelete', { title: agent.title }))) return;
    try {
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
    await loadAgents();
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

  const renderAgentsGrid = (agents: AgentSummary[], emptyMessage: string, isMyAgentsSection = false) => {
    if (!agents.length) {
      return <p className="text-muted">{emptyMessage}</p>;
    }

    return (
      <Row xs={1} md={2} lg={3} className="g-4">
        {agents.map((agent) => (
          <Col key={agent.agentId}>
            <AgentCard
              agent={agent}
              onChat={handleStartChat}
              onEdit={agent.scope === 'user' || agent.createdBy.userId === userId ? handleEdit : undefined}
              onDuplicate={handleDuplicate}
              onDelete={agent.scope === 'user' || agent.createdBy.userId === userId ? handleDelete : undefined}
              onSchedule={schedulingEnabled ? handleScheduleAgent : undefined}
              onToggleFavorite={
                agent.scope === 'user' || agent.createdBy.userId === userId ? handleToggleFavorite : undefined
              }
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
  const personalCount = myAgents.filter((a) => a.scope === 'user').length;
  const publicCount = workspaceAgents.length;
  const headerActions = (
    <div className="agents-hero__actions">
      <button type="button" className="agents-hero__action-btn" onClick={loadAgents} disabled={loading}>
        <RefreshCw
          size={16}
          className={`agents-hero__action-icon ${loading ? 'is-spinning' : ''}`}
          aria-hidden="true"
        />
        {t('management.actions.refresh')}
      </button>
      {agentsFeatureEnabled && agentsMode !== 'off' && (
        <button
          type="button"
          className="agents-hero__action-btn agents-hero__action-btn--primary"
          onClick={handleCreate}
        >
          <PlusCircle size={16} className="agents-hero__action-icon" aria-hidden="true" />
          {t('management.actions.create')}
        </button>
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
              <Col xs={6} md={4}>
                <div
                  className="p-3 rounded-3 border bg-white"
                  role="button"
                  onClick={() => setFilter('all')}
                  style={{
                    boxShadow: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    borderColor: filter === 'all' ? brandPrimaryBorderColor : undefined,
                    borderWidth: filter === 'all' ? '2px' : '1px',
                    backgroundColor: filter === 'all' ? brandPrimarySoftBackground : '#ffffff',
                  }}
                >
                  <div className="d-flex align-items-center justify-content-between">
                    <div>
                      <div className="text-muted small mb-1">{t('management.stats.total')}</div>
                      <div className="fs-4 fw-bold">{totalAgents}</div>
                    </div>
                    <div
                      className="rounded-circle d-flex align-items-center justify-content-center"
                      style={{ width: 48, height: 48, backgroundColor: brandPrimarySoftBackground }}
                    >
                      <Bot size={20} style={{ color: brandPrimaryColor }} aria-hidden="true" />
                    </div>
                  </div>
                </div>
              </Col>
              <Col xs={6} md={4}>
                <div
                  className="p-3 rounded-3 border bg-white"
                  role="button"
                  onClick={() => setFilter('personal')}
                  style={{
                    boxShadow: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    borderColor: filter === 'personal' ? brandPrimaryBorderColor : undefined,
                    borderWidth: filter === 'personal' ? '2px' : '1px',
                    backgroundColor: filter === 'personal' ? brandPrimarySoftBackground : '#ffffff',
                  }}
                >
                  <div className="d-flex align-items-center justify-content-between">
                    <div>
                      <div className="text-muted small mb-1">{t('management.stats.personal')}</div>
                      <div className="fs-4 fw-bold">{personalCount}</div>
                    </div>
                    <div
                      className="rounded-circle bg-secondary bg-opacity-10 d-flex align-items-center justify-content-center"
                      style={{ width: 48, height: 48 }}
                    >
                      <User size={20} style={{ color: brandPrimaryColor }} aria-hidden="true" />
                    </div>
                  </div>
                </div>
              </Col>
              <Col xs={6} md={4}>
                <div
                  className="p-3 rounded-3 border bg-white"
                  role="button"
                  onClick={() => setFilter('public')}
                  style={{
                    boxShadow: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    borderColor: filter === 'public' ? brandPrimaryBorderColor : undefined,
                    borderWidth: filter === 'public' ? '2px' : '1px',
                    backgroundColor: filter === 'public' ? brandPrimarySoftBackground : '#ffffff',
                  }}
                >
                  <div className="d-flex align-items-center justify-content-between">
                    <div>
                      <div className="text-muted small mb-1">{t('management.stats.company')}</div>
                      <div className="fs-4 fw-bold">{publicCount}</div>
                    </div>
                    <div
                      className="rounded-circle d-flex align-items-center justify-content-center"
                      style={{ width: 48, height: 48, backgroundColor: brandPrimarySoftBackground }}
                    >
                      <Store size={20} style={{ color: brandPrimaryColor }} aria-hidden="true" />
                    </div>
                  </div>
                </div>
              </Col>
            </Row>
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
                {filter !== 'public' && filteredMyAgents.length > 0 && (
                  <section className="agents-section agents-section--my">
                    <div className="agents-section__header">
                      <div className="d-flex align-items-center gap-3">
                        <div
                          className="agents-section__icon rounded-3 d-flex align-items-center justify-content-center"
                          style={{
                            backgroundColor: brandPrimaryColor,
                          }}
                        >
                          <User size={28} style={{ color: brandPrimaryContrast }} aria-hidden="true" />
                        </div>
                        <div className="flex-grow-1">
                          <div className="d-flex justify-content-between align-items-center mb-1">
                            <h2 className="agents-section__title">{t('management.sections.myAgents.title')}</h2>
                            <span
                              className="badge rounded-pill px-3 py-2 agents-section__count"
                              style={{
                                backgroundColor: brandPrimaryColor,
                                color: brandPrimaryContrast,
                              }}
                            >
                              {filteredMyAgents.length}
                            </span>
                          </div>
                          <p className="agents-section__subtitle">{t('management.sections.myAgents.subtitle')}</p>
                        </div>
                      </div>
                    </div>
                    {renderAgentsGrid(
                      filteredMyAgents,
                      filter === 'personal' ? t('management.empty.personalOnly') : t('management.empty.none'),
                      true
                    )}
                  </section>
                )}

                {agentsMode !== 'personal_only' &&
                  filter !== 'personal' &&
                  (filteredWorkspaceAgents.length > 0 || companyLoading) && (
                    <section className="agents-section agents-section--company">
                      <div className="agents-section__header">
                        <div className="d-flex align-items-center gap-3">
                          <div
                            className="agents-section__icon rounded-3 d-flex align-items-center justify-content-center"
                            style={{
                              backgroundColor: brandPrimaryColor,
                            }}
                          >
                            <Store size={28} style={{ color: brandPrimaryContrast }} aria-hidden="true" />
                          </div>
                          <div className="flex-grow-1">
                            <div className="d-flex justify-content-between align-items-center mb-1">
                              <h2 className="agents-section__title">{t('management.sections.company.title')}</h2>
                              {!companyLoading && (
                                <span
                                  className="badge rounded-pill px-3 py-2 agents-section__count"
                                  style={{
                                    backgroundColor: brandPrimaryColor,
                                    color: brandPrimaryContrast,
                                  }}
                                >
                                  {filteredWorkspaceAgents.length}
                                </span>
                              )}
                            </div>
                            <p className="agents-section__subtitle">{t('management.sections.company.subtitle')}</p>
                          </div>
                        </div>
                      </div>
                      {companyLoading && filteredWorkspaceAgents.length === 0 ? (
                        <div className="d-flex justify-content-center py-4">
                          <Spinner animation="border" size="sm" />
                        </div>
                      ) : (
                        renderAgentsGrid(filteredWorkspaceAgents, t('management.empty.company'))
                      )}
                    </section>
                  )}

                {filteredMyAgents.length === 0 && filteredWorkspaceAgents.length === 0 && (
                  <div className="text-center py-5">
                    <div className="mb-4">
                      <Bot size={64} className="text-muted" aria-hidden="true" />
                    </div>
                    <h3 className="h5 mb-2">{t('management.empty.title')}</h3>
                    <p className="text-muted mb-4">
                      {selectedTags.length > 0
                        ? t('management.empty.noTagMatch')
                        : agentsMode === 'off'
                          ? t('management.empty.modeOff')
                          : filter === 'all'
                            ? t('management.empty.all')
                            : filter === 'personal'
                              ? t('management.empty.personal')
                              : t('management.empty.company')}
                    </p>
                    {agentsMode !== 'off' && (
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
