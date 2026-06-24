import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Container, Row, Col, Button, Alert, Spinner, Modal, Form, Badge, Card, Pagination } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Zap,
  RefreshCw,
  Search,
  LayoutGrid,
  List,
  Play,
  Clock,
  Bot,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Pause,
  CheckCircle2,
  XCircle,
  Activity,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../Components/PageHeader';
import { SubHeaderTabBar } from '../Components/SubHeaderTabBar';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { AutomationPipelineCard } from '../Components/Automations/AutomationPipelineCard';
import { AutomationRunsFeed } from '../Components/Automations/AutomationRunsFeed';
import { AutomationWorkflowBuilder } from '../Components/Automations/AutomationWorkflowBuilder';
import { AgentAvatar } from '../Components/Agents/AgentAvatar';
import { QuotaUsageStrip } from '../Components/Scheduling/QuotaUsageStrip';
import { ScheduleService } from '../Services/ScheduleService';
import { listAgents, getCachedAgents } from '../Services/AgentsService';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useBranding } from '../Providers/BrandingContext';
import { getDerivedAutomationStatus, automationUsesCompanyQuota, formatRelativeTime } from '../utils/automationUtils';
import { describeCronExpression } from '../utils/cronUtils';
import type { AgentSchedule } from '../types/agentSchedules';
import type { AgentSummary } from '../types/agents';
import {
  summarizePipedreamConfiguredProps,
  summarizePipedreamTrigger,
} from '../Components/PipedreamTriggers/pipedreamTriggerLabels';
import { findPipedreamTriggerComponent } from '../../../lib/pipedream-trigger-apps';

const PipedreamTriggerListChip = ({ appSlug, componentId }: { appSlug: string; componentId: string }) => {
  const { t } = useTranslation('automations');
  const summary = summarizePipedreamTrigger(appSlug, componentId, t);
  return (
    <span className="automation-list-row__chip automation-list-row__chip--schedule">
      {summary.iconSrc ? (
        <img src={summary.iconSrc} alt="" width={12} height={12} />
      ) : (
        <i className={`${summary.fallbackIcon} small`} />
      )}
      {summary.combined}
    </span>
  );
};

const RECENT_ACTIVITY_LIMIT = 6;

export const AutomationsPage = () => {
  const { t } = useTranslation('automations');
  // Hold a ref to `t` so callbacks can read the latest translator without
  // re-creating themselves whenever react-i18next swaps the function
  // identity (which it does on language load and other internal events).
  // Without this, `loadData` recreates → `useEffect([loadData])` fires →
  // `setLoading(true)` re-renders → `t` swaps again → infinite loop.
  const tRef = useRef(t);
  tRef.current = t;
  const navigate = useNavigate();
  const { numaGet, numaPost, numaPut, numaDelete } = useNumaRequest();
  const { branding } = useBranding();
  const brandPrimaryColor = branding.resolvedAssets?.primaryColor || branding.primaryColor || '#6366f1';
  const brandPrimaryContrast = branding.resolvedAssets?.primaryContrast || branding.primaryContrast || '#ffffff';

  const [automations, setAutomations] = useState<AgentSchedule[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>(() => getCachedAgents('owned') || []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Non-blocking notice surfaced after a successful action (e.g. trigger
  // saved while at-budget — informational, not a failure).
  const [notice, setNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() => {
    const saved = localStorage.getItem('automations-view-mode');
    return saved === 'cards' ? 'cards' : 'table';
  });
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<AgentSchedule | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [expandedFilters, setExpandedFilters] = useState<Set<string>>(new Set());
  // Page through long lists — silent 1MB DDB cap aside, rendering 200+ cards
  // makes the page feel sluggish. Paginating client-side is good enough for now.
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 24;

  const agentMap = useMemo(() => {
    const map = new Map<string, AgentSummary>();
    agents.forEach((a) => map.set(a.agentId, a));
    return map;
  }, [agents]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setAgentsLoading(true);
      setError(null);
      const [schedulesResult, agentsResult] = await Promise.all([
        ScheduleService.list(numaGet),
        listAgents(numaGet, { scope: 'owned' }),
      ]);
      setAutomations(schedulesResult.filter((s) => s.status !== 'deleted'));
      setAgents(agentsResult);
    } catch (err) {
      setError(tRef.current('errors.load'));
      console.error('[AutomationsPage] Failed to load:', err);
    } finally {
      setLoading(false);
      setAgentsLoading(false);
    }
  }, [numaGet]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredAutomations = useMemo(() => {
    let result = automations;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (a) =>
          (a.label || '').toLowerCase().includes(q) ||
          (a.agentTitle || '').toLowerCase().includes(q) ||
          (agentMap.get(a.agentId)?.title || '').toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') {
      result = result.filter((a) => {
        const derived = getDerivedAutomationStatus(a);
        if (statusFilter === 'active') return derived === 'active';
        // 'inactive' is anything that isn't currently firing — paused,
        // pending approval, admin-locked, or completed. The badge on each
        // card surfaces the precise reason.
        if (statusFilter === 'inactive') return derived !== 'active';
        return true;
      });
    }
    return result;
  }, [automations, searchQuery, statusFilter, agentMap]);

  // Reset to page 1 whenever filters change so we don't get stuck "looking at"
  // an empty later page.
  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredAutomations.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageAutomations = filteredAutomations.slice(pageStart, pageStart + PAGE_SIZE);

  // Recent activity: automations that have run, sorted by most recent
  const recentActivity = useMemo(() => {
    return automations
      .filter((a) => a.lastRunEpoch)
      .sort((a, b) => (b.lastRunEpoch || 0) - (a.lastRunEpoch || 0))
      .slice(0, RECENT_ACTIVITY_LIMIT);
  }, [automations]);

  /**
   * Optimistic toggle — flip the switch immediately, hit the API in the
   * background, and roll back + surface an error if it fails. Without this
   * the switch lags behind the click by however long the round-trip takes,
   * which feels broken even on a fast network.
   */
  const handleToggleStatus = useCallback(
    async (automation: AgentSchedule) => {
      // Capture the FULL object for rollback, not just `status`. Derived UI
      // state (next-run label, quota chip, badge variant) reads from
      // `quotaScope`, `expiresAt`, `cronExpression`, and others — flipping
      // status alone is fine today but will silently diverge as soon as any
      // other field is added to derived computations.
      const previousAutomation = automation;
      const newStatus = automation.status === 'active' ? 'paused' : 'active';

      setAutomations((prev) =>
        prev.map((a) => (a.scheduleId === automation.scheduleId ? { ...a, status: newStatus } : a))
      );

      try {
        await ScheduleService.update(numaPut, automation.scheduleId, { status: newStatus });
      } catch (err) {
        // Restore the entire previous object so any derived state stays consistent.
        setAutomations((prev) => prev.map((a) => (a.scheduleId === automation.scheduleId ? previousAutomation : a)));
        const responseError = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        const msg =
          responseError ||
          (err instanceof Error
            ? err.message
            : tRef.current('errors.toggleStatus', { defaultValue: 'Failed to update automation status' }));
        setError(msg);
        console.error('[AutomationsPage] Failed to toggle status:', err);
      }
    },
    [numaPut]
  );

  const handleDelete = useCallback(
    async (automation: AgentSchedule) => {
      try {
        await ScheduleService.delete(numaDelete, automation.scheduleId);
        setAutomations((prev) => prev.filter((a) => a.scheduleId !== automation.scheduleId));
        setDeleteTarget(null);
      } catch (err) {
        console.error('[AutomationsPage] Failed to delete:', err);
      }
    },
    [numaDelete]
  );

  const handleRunNow = useCallback(
    async (automation: AgentSchedule) => {
      try {
        setRunningIds((prev) => new Set(prev).add(automation.scheduleId));
        await ScheduleService.run(numaPost, automation.scheduleId);
        // Sequenced refetch: previously this used setTimeout(loadData, 2000)
        // which raced with concurrent toggles and overwrote optimistic state.
        // The runner returns 202 (queued) — the actual run status changes
        // asynchronously; the user can refresh manually if they want to see
        // the new last_status. The schedule list itself is up-to-date.
        await loadData();
      } catch (err) {
        console.error('[AutomationsPage] Failed to run:', err);
      } finally {
        setRunningIds((prev) => {
          const next = new Set(prev);
          next.delete(automation.scheduleId);
          return next;
        });
      }
    },
    [numaPost, loadData]
  );

  const handleBuilderSave = useCallback(
    async (payload: {
      agentId: string;
      agentTitle: string;
      promptText: string;
      triggerType: 'cron' | 'event';
      trigger?: import('../types/agentSchedules').EventTrigger;
      cronExpression?: string;
      timezone?: string;
      label: string;
      maxRuns?: number;
      emailNotifications: boolean;
      notificationEmails: string[];
      agentSnapshot?: {
        agentId: string;
        title: string;
        icon?: string;
        iconImage?: { s3Bucket: string; s3Key: string } | null;
        systemPrompt: string;
      };
    }) => {
      const conversationId = `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const created = await ScheduleService.create(numaPost, {
        agentId: payload.agentId,
        agentTitle: payload.agentTitle,
        conversationId,
        promptText: payload.promptText,
        triggerType: payload.triggerType,
        trigger: payload.trigger,
        cronExpression: payload.cronExpression,
        timezone: payload.timezone,
        label: payload.label,
        maxRuns: payload.maxRuns,
        emailNotifications: payload.emailNotifications,
        notificationEmails: payload.notificationEmails,
        agentSnapshot: payload.agentSnapshot,
      });
      // Non-blocking advisory: when a trigger is created while the tenant /
      // user is already at trigger budget cap, the create succeeds but
      // fires won't run until next month's reset. Surface as a notice on
      // the dashboard rather than blocking the save.
      setError(null);
      if (created.triggerWarning) {
        const w = created.triggerWarning;
        const who = w.scope === 'company' ? 'your company is' : 'you are';
        setNotice(
          `Automation saved. Heads up: ${who} at the monthly trigger budget cap (${w.current}/${w.limit}). ` +
            `It won't fire until the budget resets on the 1st. Past usage from deleted/paused triggers stays counted, ` +
            `so removing existing triggers won't refund this month — ask an admin to raise the cap if you need budget now.`
        );
      } else {
        setNotice(null);
      }
      await loadData();
      setActiveTab('dashboard');
    },
    [numaPost, loadData]
  );

  const tabItems = useMemo(
    () => [
      {
        key: 'dashboard',
        label: t('tabs.dashboard'),
        iconClassName: 'bi bi-speedometer2',
      },
      { key: 'create', label: t('tabs.create'), iconClassName: 'bi bi-plus-circle' },
      { key: 'runs', label: t('tabs.runs'), iconClassName: 'bi bi-clock-history' },
    ],
    [t]
  );

  const statusCounts = useMemo(() => {
    let active = 0;
    let inactive = 0;
    for (const a of automations) {
      if (getDerivedAutomationStatus(a) === 'active') active++;
      else inactive++;
    }
    return { active, inactive };
  }, [automations]);

  const statusBadgeVariant = (status: string) => {
    if (status === 'active') return 'success';
    if (status === 'paused') return 'warning';
    return 'secondary';
  };

  const renderStatCards = () => {
    // Three buckets keeps the dashboard focused: Active = what's firing,
    // Inactive = everything else (paused / pending / locked / completed —
    // the per-card badge spells out which), All = total. The detail badge
    // on each list item is the canonical answer for "why isn't this active?"
    const cards = [
      {
        key: 'active',
        label: t('page.filters.status.active'),
        count: statusCounts.active,
        icon: <Zap size={20} />,
        color: '#198754',
        bg: 'rgba(25, 135, 84, 0.08)',
      },
      {
        key: 'inactive',
        label: t('page.filters.status.inactive', { defaultValue: 'Inactive' }),
        count: statusCounts.inactive,
        icon: <Pause size={20} />,
        color: '#6c757d',
        bg: 'rgba(108, 117, 125, 0.08)',
      },
      {
        key: 'all',
        label: t('page.filters.status.all'),
        count: automations.length,
        icon: <Activity size={20} />,
        color: brandPrimaryColor,
        bg: `color-mix(in srgb, ${brandPrimaryColor} 8%, transparent)`,
      },
    ];

    return (
      <Row className="g-3 mb-4">
        {cards.map((card) => (
          <Col key={card.key} xs={4}>
            <Card
              className="border-0 shadow-sm h-100"
              role="button"
              onClick={() => setStatusFilter(card.key)}
              style={{
                borderRadius: 10,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                outline: statusFilter === card.key ? `2px solid ${card.color}` : 'none',
                outlineOffset: -1,
              }}
            >
              <Card.Body className="d-flex align-items-center justify-content-between py-3 px-3">
                <div>
                  <div className="text-muted small mb-1">{card.label}</div>
                  <div className="fs-4 fw-bold">{card.count}</div>
                </div>
                <div
                  className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: 44, height: 44, background: card.bg, color: card.color }}
                >
                  {card.icon}
                </div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
    );
  };

  const renderAutomationsList = () => (
    <>
      {/* Search + view toggle */}
      <div className="automations-dashboard-toolbar d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3">
        <h6 className="mb-0 fw-semibold">
          {statusFilter === 'all'
            ? t('page.filters.status.all')
            : statusFilter === 'active'
              ? t('page.filters.status.active')
              : statusFilter === 'completed'
                ? t('status.completed')
                : t('page.filters.status.paused')}
          {filteredAutomations.length > 0 && (
            <span className="text-muted fw-normal ms-2" style={{ fontSize: '0.85rem' }}>
              ({filteredAutomations.length})
            </span>
          )}
        </h6>
        <div className="d-flex align-items-center gap-2">
          <div className="position-relative" style={{ maxWidth: 240 }}>
            <Search
              size={14}
              className="position-absolute text-muted"
              style={{ left: 10, top: '50%', transform: 'translateY(-50%)' }}
            />
            <Form.Control
              type="text"
              placeholder={t('page.filters.search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              size="sm"
              style={{ paddingLeft: 32, fontSize: '0.85rem' }}
            />
          </div>
          <div className="btn-group btn-group-sm">
            <Button
              variant={viewMode === 'cards' ? 'primary' : 'outline-secondary'}
              onClick={() => {
                setViewMode('cards');
                localStorage.setItem('automations-view-mode', 'cards');
              }}
              style={
                viewMode === 'cards'
                  ? { backgroundColor: brandPrimaryColor, borderColor: brandPrimaryColor, color: brandPrimaryContrast }
                  : {}
              }
              aria-label={t('page.viewMode.cards')}
            >
              <LayoutGrid size={14} />
            </Button>
            <Button
              variant={viewMode === 'table' ? 'primary' : 'outline-secondary'}
              onClick={() => {
                setViewMode('table');
                localStorage.setItem('automations-view-mode', 'table');
              }}
              style={
                viewMode === 'table'
                  ? { backgroundColor: brandPrimaryColor, borderColor: brandPrimaryColor, color: brandPrimaryContrast }
                  : {}
              }
              aria-label={t('page.viewMode.table')}
            >
              <List size={14} />
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="d-flex justify-content-center align-items-center py-5">
          <Spinner animation="border" size="sm" className="me-2" />
          {t('page.loading')}
        </div>
      ) : filteredAutomations.length === 0 ? (
        <div className="text-center py-5">
          <div className="automation-empty-state">
            <Zap size={48} className="text-muted mb-3" />
            <h5>{automations.length === 0 ? t('page.empty.title') : t('sections.noActive')}</h5>
            <p className="text-muted">{automations.length === 0 ? t('page.empty.description') : t('runs.noRuns')}</p>
            {automations.length === 0 && (
              <Button
                onClick={() => setActiveTab('create')}
                style={{
                  backgroundColor: brandPrimaryColor,
                  borderColor: brandPrimaryColor,
                  color: brandPrimaryContrast,
                }}
              >
                <Plus size={16} className="me-1" />
                {t('page.empty.cta')}
              </Button>
            )}
          </div>
        </div>
      ) : viewMode === 'cards' ? (
        <Row className="g-3">
          {pageAutomations.map((automation) => (
            <Col key={automation.scheduleId} xs={12} sm={6} lg={4}>
              <AutomationPipelineCard
                automation={automation}
                agent={agentMap.get(automation.agentId)}
                derivedStatus={getDerivedAutomationStatus(automation)}
                onToggleStatus={handleToggleStatus}
                onDelete={(a) => setDeleteTarget(a)}
                onRunNow={handleRunNow}
                isRunning={runningIds.has(automation.scheduleId)}
              />
            </Col>
          ))}
        </Row>
      ) : (
        <div className="automation-list">
          {pageAutomations.map((automation) => {
            const agent = agentMap.get(automation.agentId);
            const derived = getDerivedAutomationStatus(automation);
            const lastRun = formatRelativeTime(automation.lastRunEpoch);
            const runsLabel =
              automation.maxRuns && automation.maxRuns > 0
                ? `${automation.totalRuns || 0} / ${automation.maxRuns}`
                : `${automation.totalRuns || 0}`;

            return (
              <div
                key={automation.scheduleId}
                className="automation-list-row"
                onClick={() => navigate(`/automations/${automation.scheduleId}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/automations/${automation.scheduleId}`)}
              >
                <div className="automation-list-row__body">
                  <div className="automation-list-row__left">
                    <span className="automation-list-row__name">
                      {automation.label || automation.agentTitle || '\u2014'}
                    </span>
                    <div className="automation-list-row__chips">
                      <span className="automation-list-row__chip">
                        <Bot size={12} />
                        <AgentAvatar agent={agent ?? undefined} size={16} />
                        {agent?.title || automation.agentTitle || '\u2014'}
                      </span>
                      {automation.triggerType === 'event' ? (
                        <>
                          {automation.trigger?.source === 'pipedream' ? (
                            <>
                              <PipedreamTriggerListChip
                                appSlug={automation.trigger.app_slug}
                                componentId={automation.trigger.component_id}
                              />
                              {(() => {
                                const pdTrigger = automation.trigger;
                                const found = findPipedreamTriggerComponent(pdTrigger.app_slug, pdTrigger.component_id);
                                const forced = found ? Object.keys(found.trigger.restraints.forced_props) : [];
                                const rows = summarizePipedreamConfiguredProps({
                                  componentId: pdTrigger.component_id,
                                  appSlug: pdTrigger.app_slug,
                                  configuredProps: pdTrigger.configured_props,
                                  configuredPropLabels: pdTrigger.configured_prop_labels,
                                  forcedPropNames: forced,
                                  t,
                                });
                                return rows.map((r) => (
                                  <span
                                    key={r.propName}
                                    className="automation-list-row__chip automation-list-row__chip--filter"
                                  >
                                    <span className="text-muted small me-1">{r.label}:</span>
                                    {r.value}
                                  </span>
                                ));
                              })()}
                            </>
                          ) : (
                            <span className="automation-list-row__chip automation-list-row__chip--schedule">
                              <Zap size={12} />
                              {t('list.triggerEmail')}
                            </span>
                          )}
                          {automation.trigger?.source === 'gmail' &&
                            automation.trigger.filters.length > 0 &&
                            (() => {
                              // narrowed to GmailEventTrigger by the source check above
                              const gmailTrigger = automation.trigger;
                              const filters = gmailTrigger.filters;
                              const isExpanded = expandedFilters.has(automation.scheduleId);
                              const MAX_VISIBLE = 3;
                              const visible = isExpanded ? filters : filters.slice(0, MAX_VISIBLE);
                              const hasMore = filters.length > MAX_VISIBLE;
                              const logic =
                                gmailTrigger.filter_logic === 'any' ? t('list.filterOr') : t('list.filterAnd');

                              return (
                                <>
                                  {visible.map((f, i) => (
                                    <span
                                      key={i}
                                      className="automation-list-row__chip automation-list-row__chip--filter"
                                    >
                                      {i > 0 && <span className="text-muted small me-1">{logic}</span>}
                                      {t(`trigger.event.builder.fields.${f.field}`)}{' '}
                                      {t(`trigger.event.builder.ops.${f.op}`)}{' '}
                                      {f.field !== 'has_attachment' && <>&ldquo;{f.value}&rdquo;</>}
                                    </span>
                                  ))}
                                  {hasMore && (
                                    <span
                                      className="automation-list-row__chip automation-list-row__chip--toggle"
                                      role="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedFilters((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(automation.scheduleId)) next.delete(automation.scheduleId);
                                          else next.add(automation.scheduleId);
                                          return next;
                                        });
                                      }}
                                    >
                                      {isExpanded ? (
                                        <>
                                          <ChevronUp size={12} /> {t('list.showLess')}
                                        </>
                                      ) : (
                                        <>
                                          <ChevronDown size={12} /> {t('list.showMore', { count: filters.length })}
                                        </>
                                      )}
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                        </>
                      ) : (
                        <span className="automation-list-row__chip automation-list-row__chip--schedule">
                          <Clock size={12} />
                          {describeCronExpression(automation.cronExpression || '') || '\u2014'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="automation-list-row__right">
                    {automationUsesCompanyQuota(automation) && (
                      <span
                        className="text-muted me-2"
                        style={{ fontSize: '0.7rem' }}
                        title={t('card.companyQuotaTooltip', {
                          defaultValue:
                            'Admin-approved — runs against the company quota only, not your personal monthly cap.',
                        })}
                      >
                        {t('card.companyQuota', { defaultValue: 'company quota' })}
                      </span>
                    )}
                    <Badge bg={statusBadgeVariant(derived)} className="automation-list-row__status me-3">
                      {t(`status.${derived}`)}
                    </Badge>
                    <div className="automation-list-row__stats">
                      <span className="automation-list-row__stat">
                        <Play size={10} />
                        {runsLabel}
                      </span>
                      {lastRun && (
                        <span className="automation-list-row__stat">
                          <Clock size={10} />
                          {lastRun}
                        </span>
                      )}
                    </div>
                    <div className="automation-list-row__actions" onClick={(e) => e.stopPropagation()}>
                      {/* Run Now is meaningless for event triggers — they need
                          an actual event payload to do anything useful. Hide
                          it on event automations rather than wire up a synthetic-
                          payload UX. */}
                      {automation.triggerType !== 'event' && (
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          className="automation-list-row__run-btn"
                          onClick={() => handleRunNow(automation)}
                          disabled={runningIds.has(automation.scheduleId)}
                        >
                          <Play size={12} />
                        </Button>
                      )}
                      <Form.Check
                        type="switch"
                        checked={automation.status === 'active'}
                        disabled={automation.status !== 'active' && automation.status !== 'paused'}
                        onChange={() => handleToggleStatus(automation)}
                        className="automation-card__toggle"
                      />
                    </div>
                    <ChevronRight size={16} className="automation-list-row__chevron" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {filteredAutomations.length > PAGE_SIZE && (
        <div className="d-flex justify-content-between align-items-center mt-3">
          <div className="small text-muted">
            {t('page.pagination.showing', {
              defaultValue: 'Showing {{from}}–{{to}} of {{total}}',
              from: pageStart + 1,
              to: Math.min(pageStart + PAGE_SIZE, filteredAutomations.length),
              total: filteredAutomations.length,
            })}
          </div>
          <Pagination size="sm" className="mb-0">
            <Pagination.First disabled={safePage === 1} onClick={() => setPage(1)} />
            <Pagination.Prev disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} />
            <Pagination.Item active>{safePage}</Pagination.Item>
            <Pagination.Next
              disabled={safePage === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            />
            <Pagination.Last disabled={safePage === totalPages} onClick={() => setPage(totalPages)} />
            <span className="ms-2 small text-muted align-self-center">
              {t('page.pagination.totalPages', { defaultValue: 'of {{total}}', total: totalPages })}
            </span>
          </Pagination>
        </div>
      )}
    </>
  );

  const renderRecentActivity = () => {
    if (recentActivity.length === 0) return null;

    return (
      <div className="mt-4">
        <div className="d-flex align-items-center justify-content-between mb-3">
          <h6 className="mb-0 fw-semibold d-flex align-items-center gap-2">
            <Activity size={16} style={{ color: brandPrimaryColor }} />
            {t('dashboard.recentActivity')}
          </h6>
          <Button
            variant="link"
            size="sm"
            className="p-0 text-decoration-none"
            style={{ color: brandPrimaryColor }}
            onClick={() => setActiveTab('runs')}
          >
            {t('dashboard.viewAllRuns')}
            <ChevronRight size={14} className="ms-1" />
          </Button>
        </div>
        <Card className="border-0 shadow-sm" style={{ borderRadius: 10 }}>
          <Card.Body className="p-0">
            {recentActivity.map((automation, idx) => {
              const agent = agentMap.get(automation.agentId);
              const isFailed = automation.lastStatus === 'failed' || !!automation.lastError;
              const lastRun = formatRelativeTime(automation.lastRunEpoch);

              return (
                <div
                  key={automation.scheduleId}
                  className="automation-activity-row"
                  style={{ borderBottom: idx < recentActivity.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}
                  onClick={() => navigate(`/automations/${automation.scheduleId}`)}
                  role="button"
                >
                  <div className="d-flex align-items-center gap-2 flex-shrink-0" style={{ width: 24 }}>
                    {isFailed ? (
                      <XCircle size={16} className="text-danger" />
                    ) : (
                      <CheckCircle2 size={16} className="text-success" />
                    )}
                  </div>
                  <div className="flex-grow-1 min-w-0 automation-activity-row__name">
                    <span className="fw-medium text-truncate d-block" style={{ fontSize: '0.85rem' }}>
                      {automation.label || automation.agentTitle || '\u2014'}
                    </span>
                  </div>
                  <div className="d-flex align-items-center gap-2 flex-shrink-0 automation-activity-row__account">
                    <AgentAvatar agent={agent ?? undefined} size={18} />
                    <span className="text-muted small text-truncate">
                      {agent?.title || automation.agentTitle || '\u2014'}
                    </span>
                  </div>
                  <span className="text-muted small flex-shrink-0" style={{ width: 80, textAlign: 'right' }}>
                    {lastRun || '\u2014'}
                  </span>
                  <ChevronRight size={14} className="text-muted flex-shrink-0" />
                </div>
              );
            })}
          </Card.Body>
        </Card>
      </div>
    );
  };

  const renderDashboard = () => (
    <>
      {renderStatCards()}
      {renderAutomationsList()}
      {renderRecentActivity()}
      {/* Quota usage moved to the bottom — it's reference material, not
          something the user needs to look at every visit. The preflight
          banner during create-flow surfaces it when it actually matters. */}
      <QuotaUsageStrip />
    </>
  );

  return (
    <LayoutDashboard>
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        icon={{
          element: <Zap />,
          backgroundColor: brandPrimaryColor,
          color: brandPrimaryContrast,
        }}
        actions={
          <div className="d-flex gap-2">
            <Button variant="outline-secondary" size="sm" onClick={loadData}>
              <RefreshCw size={14} />
            </Button>
            <Button
              onClick={() => setActiveTab('create')}
              style={{
                backgroundColor: brandPrimaryColor,
                borderColor: brandPrimaryColor,
                color: brandPrimaryContrast,
              }}
            >
              <Plus size={16} className="me-1" />
              {t('page.newAutomation')}
            </Button>
          </div>
        }
      />

      <SubHeaderTabBar items={tabItems} activeKey={activeTab} onSelect={setActiveTab} ariaLabel={t('page.title')} />

      <Container fluid className="px-4 py-2">
        {error && (
          <Alert variant="danger" className="mb-3">
            {error}
          </Alert>
        )}

        {notice && (
          <Alert variant="warning" className="mb-3" dismissible onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}

        {activeTab === 'dashboard' && renderDashboard()}

        {activeTab === 'create' && (
          <div>
            <AutomationWorkflowBuilder
              agents={agents}
              agentsLoading={agentsLoading}
              onSave={handleBuilderSave}
              onCancel={() => setActiveTab('dashboard')}
            />
          </div>
        )}

        {activeTab === 'runs' && <AutomationRunsFeed automations={automations} agentMap={agentMap} />}
      </Container>

      {/* Delete confirmation modal */}
      <Modal show={!!deleteTarget} onHide={() => setDeleteTarget(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{t('actions.delete')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {deleteTarget && <p>{t('confirm.delete', { name: deleteTarget.label || deleteTarget.agentTitle || '' })}</p>}
          <p className="text-muted small">{t('confirm.deleteDescription')}</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
            {t('builder.nav.cancel')}
          </Button>
          <Button variant="danger" onClick={() => deleteTarget && handleDelete(deleteTarget)}>
            {t('actions.delete')}
          </Button>
        </Modal.Footer>
      </Modal>
    </LayoutDashboard>
  );
};

export default AutomationsPage;
