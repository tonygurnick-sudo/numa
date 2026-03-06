import { useState, useEffect, useCallback, useMemo } from 'react';
import { Container, Row, Col, Button, Alert, Spinner, Modal, Form, Badge, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Plus, Zap, RefreshCw, Search, LayoutGrid, List, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../Components/PageHeader';
import { SubHeaderTabBar } from '../Components/SubHeaderTabBar';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { AutomationPipelineCard } from '../Components/Automations/AutomationPipelineCard';
import { AutomationRunsFeed } from '../Components/Automations/AutomationRunsFeed';
import { AutomationWorkflowBuilder } from '../Components/Automations/AutomationWorkflowBuilder';
import { AgentAvatar } from '../Components/Agents/AgentAvatar';
import { ScheduleService } from '../Services/ScheduleService';
import { listAgents, getCachedAgents } from '../Services/AgentsService';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useBranding } from '../Providers/BrandingContext';
import { getDerivedAutomationStatus, formatRelativeTime } from '../utils/automationUtils';
import { describeCronExpression } from '../utils/cronUtils';
import type { AgentSchedule } from '../types/agentSchedules';
import type { AgentSummary } from '../types/agents';

export const AutomationsPage = () => {
  const { t } = useTranslation('automations');
  const navigate = useNavigate();
  const { numaGet, numaPost, numaPut, numaDelete } = useNumaRequest();
  const { branding } = useBranding();
  const brandPrimaryColor = branding.resolvedAssets?.primaryColor || branding.primaryColor || '#6366f1';
  const brandPrimaryContrast = branding.resolvedAssets?.primaryContrast || branding.primaryContrast || '#ffffff';

  const [automations, setAutomations] = useState<AgentSchedule[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>(() => getCachedAgents('owned') || []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() => {
    const saved = localStorage.getItem('automations-view-mode');
    return saved === 'table' ? 'table' : 'cards';
  });
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<AgentSchedule | null>(null);
  const [activeTab, setActiveTab] = useState('automations');
  const [agentsLoading, setAgentsLoading] = useState(true);

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
      setError(t('errors.load'));
      console.error('[AutomationsPage] Failed to load:', err);
    } finally {
      setLoading(false);
      setAgentsLoading(false);
    }
  }, [numaGet, t]);

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
        if (statusFilter === 'paused') return derived === 'paused';
        if (statusFilter === 'completed') return derived === 'completed';
        return true;
      });
    }
    return result;
  }, [automations, searchQuery, statusFilter, agentMap]);

  const handleToggleStatus = useCallback(
    async (automation: AgentSchedule) => {
      const newStatus = automation.status === 'active' ? 'paused' : 'active';
      try {
        await ScheduleService.update(numaPut, automation.scheduleId, { status: newStatus });
        setAutomations((prev) =>
          prev.map((a) => (a.scheduleId === automation.scheduleId ? { ...a, status: newStatus } : a))
        );
      } catch (err) {
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
        setTimeout(() => loadData(), 2000);
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
      cronExpression: string;
      timezone: string;
      label: string;
      maxRuns: number;
      emailNotifications: boolean;
      agentSnapshot?: {
        agentId: string;
        title: string;
        icon?: string;
        iconImage?: { s3Bucket: string; s3Key: string } | null;
        systemPrompt: string;
      };
    }) => {
      const conversationId = `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await ScheduleService.create(numaPost, {
        agentId: payload.agentId,
        agentTitle: payload.agentTitle,
        conversationId,
        promptText: payload.promptText,
        cronExpression: payload.cronExpression,
        timezone: payload.timezone,
        label: payload.label,
        maxRuns: payload.maxRuns,
        emailNotifications: payload.emailNotifications,
        agentSnapshot: payload.agentSnapshot,
      });
      await loadData();
      setActiveTab('automations');
    },
    [numaPost, loadData]
  );

  const tabItems = useMemo(
    () => [
      {
        key: 'automations',
        label: `${t('tabs.automations')}${automations.length > 0 ? ` (${automations.length})` : ''}`,
        iconClassName: 'bi bi-lightning-charge',
      },
      { key: 'create', label: t('tabs.create'), iconClassName: 'bi bi-plus-circle' },
      { key: 'runs', label: t('tabs.runs'), iconClassName: 'bi bi-clock-history' },
    ],
    [t, automations.length]
  );

  const statusCounts = useMemo(() => {
    let active = 0;
    let completed = 0;
    let paused = 0;
    for (const a of automations) {
      const derived = getDerivedAutomationStatus(a);
      if (derived === 'active') active++;
      else if (derived === 'completed') completed++;
      else if (derived === 'paused') paused++;
    }
    return { active, completed, paused };
  }, [automations]);

  const filterButtons = useMemo(
    () => [
      { key: 'all', label: t('page.filters.status.all'), count: automations.length },
      { key: 'active', label: t('page.filters.status.active'), count: statusCounts.active },
      { key: 'completed', label: t('status.completed'), count: statusCounts.completed },
      { key: 'paused', label: t('page.filters.status.paused'), count: statusCounts.paused },
    ],
    [t, automations.length, statusCounts]
  );

  const statusBadgeVariant = (status: string) => {
    if (status === 'active') return 'success';
    if (status === 'paused') return 'warning';
    return 'secondary';
  };

  const renderAutomationsTab = () => (
    <>
      {/* Filter bar: pills + search + view toggle */}
      <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3">
        <div className="d-flex align-items-center gap-1">
          {filterButtons.map((fb) => (
            <Button
              key={fb.key}
              variant={statusFilter === fb.key ? 'primary' : 'outline-secondary'}
              size="sm"
              onClick={() => setStatusFilter(fb.key)}
              className="d-flex align-items-center gap-1"
              style={
                statusFilter === fb.key
                  ? {
                      backgroundColor: brandPrimaryColor,
                      borderColor: brandPrimaryColor,
                      color: brandPrimaryContrast,
                      fontSize: '0.8rem',
                    }
                  : { fontSize: '0.8rem' }
              }
            >
              {fb.label}
              {fb.count > 0 && (
                <Badge
                  bg={statusFilter === fb.key ? 'light' : 'secondary'}
                  text={statusFilter === fb.key ? 'dark' : undefined}
                  pill
                  className="ms-1"
                  style={{ fontSize: '0.7rem' }}
                >
                  {fb.count}
                </Badge>
              )}
            </Button>
          ))}
        </div>
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
          {filteredAutomations.map((automation) => (
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
        <div className="automation-table">
          <Table hover className="mb-0 align-middle">
            <thead>
              <tr>
                <th
                  style={{
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: '#6c757d',
                    fontWeight: 600,
                  }}
                >
                  {t('table.name')}
                </th>
                <th
                  style={{
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: '#6c757d',
                    fontWeight: 600,
                  }}
                >
                  {t('table.agent')}
                </th>
                <th
                  style={{
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: '#6c757d',
                    fontWeight: 600,
                  }}
                >
                  {t('table.schedule')}
                </th>
                <th
                  style={{
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: '#6c757d',
                    fontWeight: 600,
                  }}
                >
                  {t('table.status')}
                </th>
                <th
                  style={{
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: '#6c757d',
                    fontWeight: 600,
                  }}
                >
                  {t('table.runs')}
                </th>
                <th
                  style={{
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: '#6c757d',
                    fontWeight: 600,
                  }}
                >
                  {t('table.lastRun')}
                </th>
                <th
                  style={{
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: '#6c757d',
                    fontWeight: 600,
                    width: 80,
                  }}
                >
                  {t('table.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAutomations.map((automation) => {
                const agent = agentMap.get(automation.agentId);
                const derived = getDerivedAutomationStatus(automation);
                const lastRun = formatRelativeTime(automation.lastRunEpoch);
                return (
                  <tr
                    key={automation.scheduleId}
                    className="automation-table-row"
                    onClick={() => navigate(`/automations/${automation.scheduleId}`)}
                    role="button"
                  >
                    <td>
                      <span className="fw-medium">{automation.label || automation.agentTitle || '\u2014'}</span>
                    </td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <AgentAvatar agent={agent ?? undefined} size={24} />
                        <span className="small">{agent?.title || automation.agentTitle || '\u2014'}</span>
                      </div>
                    </td>
                    <td className="small">{describeCronExpression(automation.cronExpression) || '\u2014'}</td>
                    <td>
                      <Badge bg={statusBadgeVariant(derived)} style={{ fontSize: '0.7rem' }}>
                        {t(`status.${derived}`)}
                      </Badge>
                    </td>
                    <td className="small text-muted">
                      {automation.maxRuns && automation.maxRuns > 0
                        ? `${automation.totalRuns || 0} / ${automation.maxRuns}`
                        : `${automation.totalRuns || 0}`}
                    </td>
                    <td className="small text-muted">{lastRun || '\u2014'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="d-flex gap-1">
                        <Button
                          variant="outline-primary"
                          size="sm"
                          onClick={() => handleRunNow(automation)}
                          disabled={runningIds.has(automation.scheduleId)}
                          style={{ fontSize: '0.7rem', padding: '1px 6px' }}
                        >
                          <Play size={10} />
                        </Button>
                        <Form.Check
                          type="switch"
                          checked={automation.status === 'active'}
                          onChange={() => handleToggleStatus(automation)}
                          className="automation-card__toggle ms-1"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
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

      <Container fluid className="px-4 py-3">
        {error && (
          <Alert variant="danger" className="mb-3">
            {error}
          </Alert>
        )}

        {activeTab === 'automations' && renderAutomationsTab()}

        {activeTab === 'create' && (
          <div style={{ maxWidth: 860, margin: '0 auto' }}>
            <AutomationWorkflowBuilder
              agents={agents}
              agentsLoading={agentsLoading}
              onSave={handleBuilderSave}
              onCancel={() => setActiveTab('automations')}
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
