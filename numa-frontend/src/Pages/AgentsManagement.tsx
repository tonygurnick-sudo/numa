import { useEffect, useMemo, useState } from 'react';
import { Button, Col, Container, Row, Spinner, Alert, Modal } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useAuth } from '../Providers/AuthProvider';
import { listAgents, deleteAgent, duplicateAgent, updateAgent } from '../Services/AgentsService';
import { AdminAgentsService, type AgentsMode } from '../Services/AdminAgentsService';
import type { AgentSummary } from '../types/agents';
import { AgentCard } from '../Components/AgentCard';
import { AgentCreateModal } from '../Components/AgentCreateModal';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { fromWebToken } from '@aws-sdk/credential-providers';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { getConnectionConfig } from '../config/integrationsConfig';

type FilterOption = 'all' | 'personal' | 'public';

export const AgentsManagement = () => {
  const { numaGet, numaDelete, numaPost, numaPut } = useNumaRequest();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [myAgents, setMyAgents] = useState<AgentSummary[]>([]);
  const [workspaceAgents, setWorkspaceAgents] = useState<AgentSummary[]>([]);
  const [filter, setFilter] = useState<FilterOption>('all');
  const [agentsMode, setAgentsMode] = useState<AgentsMode>('full');
  const [missingModal, setMissingModal] = useState<{
    show: boolean;
    loading: boolean;
    agent: AgentSummary | null;
    missing: string[];
    error?: string | null;
  }>({ show: false, loading: false, agent: null, missing: [], error: null });

  const userId = user?.decoded_tokens?.idToken?.sub ?? '';

  const loadAgents = async () => {
    try {
      setLoading(true);
      setError(null);
      const [ownedAgents, companyAgents] = await Promise.all([
        listAgents(numaGet, { scope: 'owned' }),
        listAgents(numaGet, { scope: 'public' }),
      ]);

      const personal = ownedAgents.filter((agent) => agent.scope === 'user');
      const personalSourceIds = new Set(personal.map((p) => p.sourceAgentId).filter((v): v is string => Boolean(v)));

      // Show workspace agents created by me, except those where I also have a personal copy
      // referencing that same workspace agent. This avoids duplicate entries in "My Agents".
      const createdPublic = ownedAgents
        .filter((agent) => agent.scope === 'workspace')
        .filter((agent) => !personalSourceIds.has(agent.agentId));

      if (agentsMode === 'personal_only') {
        // Only personal agents in My Agents; no company marketplace
        setMyAgents([...personal].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
        setWorkspaceAgents([]);
      } else {
        setMyAgents([...personal, ...createdPublic].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
        setWorkspaceAgents(companyAgents.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
      }
    } catch (err) {
      console.error('AgentsManagement: failed to load agents', err);
      setError((err as Error)?.message ?? 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Load policy first, then agents
    let cancelled = false;
    (async () => {
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
  }, []);

  const filteredMyAgents = useMemo(() => {
    if (filter === 'public') return [];
    if (filter === 'personal') {
      return myAgents.filter((agent) => agent.visibility === 'personal');
    }
    return myAgents;
  }, [filter, myAgents]);

  const filteredWorkspaceAgents = useMemo(() => {
    if (filter === 'personal') return [];
    return workspaceAgents;
  }, [filter, workspaceAgents]);

  const handleCreate = () => {
    setEditingAgent(null);
    setIsModalOpen(true);
  };

  const handleEdit = (agent: AgentSummary) => {
    setEditingAgent(agent);
    setIsModalOpen(true);
  };

  const handleDuplicate = async (agent: AgentSummary) => {
    try {
      await duplicateAgent(numaPost, agent.agentId);
      await loadAgents();
    } catch (err) {
      console.error('AgentsManagement: duplicate failed', err);
      setError((err as Error)?.message ?? 'Failed to duplicate agent');
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
      setError((err as Error)?.message ?? 'Failed to update favorite');
    }
  };

  const handleDelete = async (agent: AgentSummary) => {
    if (!window.confirm(`Delete agent "${agent.title}"?`)) return;
    try {
      await deleteAgent(numaDelete, agent.agentId);
      await loadAgents();
    } catch (err) {
      console.error('AgentsManagement: delete failed', err);
      setError((err as Error)?.message ?? 'Failed to delete agent');
    }
  };

  const proceedToChat = (agent: AgentSummary) => {
    const token = String(Date.now());
    sessionStorage.setItem('numa_preselected_agent', JSON.stringify(agent));
    sessionStorage.setItem('numa_preselected_agent_token', token);
    sessionStorage.removeItem('numa_preselected_agent_consumed');
    navigate('/chat');
  };

  const handleStartChat = async (agent: AgentSummary) => {
    const needs = agent.requiredIntegrations || [];
    const hasPipedreamFeature = window.sessionStorage.getItem('PIPEDREAM_INTEGRATIONS') === 'true';
    if (!hasPipedreamFeature || needs.length === 0) {
      proceedToChat(agent);
      return;
    }
    // Open modal in loading state while we resolve connections
    setMissingModal({ show: true, loading: true, agent, missing: [], error: null });

    try {
      if (!user) {
        setMissingModal({ show: true, loading: false, agent, missing: needs, error: null });
        return;
      }
      const REGION = window.sessionStorage.getItem('REGION') || '';
      const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS') || '{}');
      const userGroup = user.decoded_tokens?.idToken?.['cognito:groups']?.[0] || 'standard';
      const roleArn = GROUPS?.[userGroup]?.roleArn;
      const cognitoUserId = user.decoded_tokens?.idToken?.sub;
      const idTokenValue = user.tokens?.idToken;
      if (!REGION || !roleArn || !cognitoUserId || !idTokenValue) {
        setMissingModal({ show: true, loading: false, agent, missing: needs, error: null });
        return;
      }

      const credentials = fromWebToken({
        webIdentityToken: idTokenValue,
        roleArn,
        roleSessionName: cognitoUserId,
      });
      const lambdaClient = new LambdaClient({ region: REGION, credentials });
      const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
      const status = await PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId, {
        ttlMs: 30 * 60 * 1000,
      });
      const connected = new Set((status.connected_apps || []).map((n) => String(n)));
      const missing = needs.filter((n) => !connected.has(n));
      if (missing.length === 0) {
        setMissingModal({ show: false, loading: false, agent: null, missing: [] });
        proceedToChat(agent);
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

  // Warm integrations cache on page load to make pre-chat checks instant
  useEffect(() => {
    const warmCache = async () => {
      try {
        const hasPipedreamFeature = window.sessionStorage.getItem('PIPEDREAM_INTEGRATIONS') === 'true';
        if (!hasPipedreamFeature || !user) return;
        const REGION = window.sessionStorage.getItem('REGION') || '';
        const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS') || '{}');
        const userGroup = user.decoded_tokens?.idToken?.['cognito:groups']?.[0] || 'standard';
        const roleArn = GROUPS?.[userGroup]?.roleArn;
        const cognitoUserId = user.decoded_tokens?.idToken?.sub;
        const idTokenValue = user.tokens?.idToken;
        if (!REGION || !roleArn || !cognitoUserId || !idTokenValue) return;
        const credentials = fromWebToken({
          webIdentityToken: idTokenValue,
          roleArn,
          roleSessionName: cognitoUserId,
        });
        const lambdaClient = new LambdaClient({ region: REGION, credentials });
        const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
        await PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId, {
          ttlMs: 30 * 60 * 1000,
        });
      } catch {
        // best-effort warm
      }
    };
    warmCache();
  }, [user]);

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
              onToggleFavorite={
                agent.scope === 'user' || agent.createdBy.userId === userId ? handleToggleFavorite : undefined
              }
              isInMyAgentsSection={isMyAgentsSection}
            />
          </Col>
        ))}
      </Row>
    );
  };

  const totalAgents = myAgents.length + workspaceAgents.length;
  const personalCount = myAgents.filter((a) => a.visibility === 'personal').length;
  const publicCount = workspaceAgents.length;

  return (
    <>
      <Nav />
      <div className="dashboard">
        <header className="mb-1">
          <Container fluid>
            <Row>
              <Col lg={12}>
                <Breadcrumbs label="Agents" />
                <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3 mb-4">
                  <div className="d-flex align-items-center gap-3">
                    <div
                      className="rounded-3 d-flex align-items-center justify-content-center"
                      style={{
                        width: 56,
                        height: 56,
                        backgroundColor: '#8e50a7',
                        flexShrink: 0,
                      }}
                    >
                      <i className="bi bi-robot" style={{ fontSize: '28px', color: 'white' }}></i>
                    </div>
                    <div>
                      <h1 className="mb-1 fs-2 fw-bold">AI Agents</h1>
                      <p className="text-muted mb-0 fs-6">Design, deploy, and manage your intelligent AI assistants</p>
                    </div>
                  </div>
                  <div className="d-flex gap-2">
                    <Button variant="outline-secondary" onClick={loadAgents} disabled={loading}>
                      <i className="bi bi-arrow-clockwise me-1"></i> Refresh
                    </Button>
                    {agentsMode !== 'off' && (
                      <Button
                        onClick={handleCreate}
                        size="lg"
                        className="fw-bold"
                        style={{
                          backgroundColor: '#8e50a7',
                          borderColor: '#8e50a7',
                          color: 'white',
                          paddingLeft: '1.5rem',
                          paddingRight: '1.5rem',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#a366bd';
                          e.currentTarget.style.borderColor = '#a366bd';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = '#8e50a7';
                          e.currentTarget.style.borderColor = '#8e50a7';
                        }}
                      >
                        <i className="bi bi-plus-circle me-2"></i> Create Agent
                      </Button>
                    )}
                  </div>
                </div>

                {/* Separator Line */}
                <div style={{ borderBottom: '1px solid #e0e0e0', marginBottom: '1.5rem' }}></div>

                {/* Stats Cards */}
                <Row className="g-3 mb-4">
                  <Col xs={6} md={4}>
                    <div
                      className="p-3 rounded-3 border bg-white"
                      role="button"
                      onClick={() => setFilter('all')}
                      style={{
                        boxShadow:
                          filter === 'all' ? '0 4px 12px rgba(142, 80, 167, 0.2)' : '0 1px 3px rgba(0,0,0,0.05)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        borderColor: filter === 'all' ? '#8e50a7' : undefined,
                        borderWidth: filter === 'all' ? '2px' : '1px',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow =
                          filter === 'all' ? '0 4px 12px rgba(142, 80, 167, 0.2)' : '0 1px 3px rgba(0,0,0,0.05)';
                      }}
                    >
                      <div className="d-flex align-items-center justify-content-between">
                        <div>
                          <div className="text-muted small mb-1">Total Agents</div>
                          <div className="fs-4 fw-bold">{totalAgents}</div>
                        </div>
                        <div
                          className="rounded-circle bg-primary bg-opacity-10 d-flex align-items-center justify-content-center"
                          style={{ width: 48, height: 48 }}
                        >
                          <i className="bi bi-robot text-primary fs-5"></i>
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
                        boxShadow:
                          filter === 'personal' ? '0 4px 12px rgba(142, 80, 167, 0.2)' : '0 1px 3px rgba(0,0,0,0.05)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        borderColor: filter === 'personal' ? '#8e50a7' : undefined,
                        borderWidth: filter === 'personal' ? '2px' : '1px',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow =
                          filter === 'personal' ? '0 4px 12px rgba(142, 80, 167, 0.2)' : '0 1px 3px rgba(0,0,0,0.05)';
                      }}
                    >
                      <div className="d-flex align-items-center justify-content-between">
                        <div>
                          <div className="text-muted small mb-1">Personal</div>
                          <div className="fs-4 fw-bold">{personalCount}</div>
                        </div>
                        <div
                          className="rounded-circle bg-secondary bg-opacity-10 d-flex align-items-center justify-content-center"
                          style={{ width: 48, height: 48 }}
                        >
                          <i className="bi bi-person-fill text-secondary fs-5"></i>
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
                        boxShadow:
                          filter === 'public' ? '0 4px 12px rgba(142, 80, 167, 0.2)' : '0 1px 3px rgba(0,0,0,0.05)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        borderColor: filter === 'public' ? '#8e50a7' : undefined,
                        borderWidth: filter === 'public' ? '2px' : '1px',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow =
                          filter === 'public' ? '0 4px 12px rgba(142, 80, 167, 0.2)' : '0 1px 3px rgba(0,0,0,0.05)';
                      }}
                    >
                      <div className="d-flex align-items-center justify-content-between">
                        <div>
                          <div className="text-muted small mb-1">Company</div>
                          <div className="fs-4 fw-bold">{publicCount}</div>
                        </div>
                        <div
                          className="rounded-circle d-flex align-items-center justify-content-center"
                          style={{ width: 48, height: 48, backgroundColor: 'rgba(142, 80, 167, 0.1)' }}
                        >
                          <i className="bi bi-shop fs-5" style={{ color: '#8e50a7' }}></i>
                        </div>
                      </div>
                    </div>
                  </Col>
                </Row>
              </Col>
            </Row>
          </Container>
        </header>

        <LayoutDashboard>
          <Container className="py-4">
            {error && (
              <Alert variant="danger" onClose={() => setError(null)} dismissible>
                {error}
              </Alert>
            )}

            {loading ? (
              <div className="d-flex justify-content-center align-items-center py-5">
                <Spinner animation="border" />
              </div>
            ) : (
              <>
                {filter !== 'public' && filteredMyAgents.length > 0 && (
                  <section className="mb-5">
                    <div className="mb-4">
                      <div className="d-flex align-items-center gap-3">
                        <div
                          className="rounded-3 d-flex align-items-center justify-content-center"
                          style={{
                            width: 56,
                            height: 56,
                            backgroundColor: '#8e50a7',
                            flexShrink: 0,
                          }}
                        >
                          <i className="bi bi-person-circle" style={{ fontSize: '28px', color: 'white' }}></i>
                        </div>
                        <div className="flex-grow-1">
                          <div className="d-flex justify-content-between align-items-center mb-1">
                            <h2 className="h4 mb-0 fw-bold">My Agents</h2>
                            <span
                              className="badge rounded-pill px-3 py-2"
                              style={{ backgroundColor: '#8e50a7', color: 'white', fontSize: '0.9rem' }}
                            >
                              {filteredMyAgents.length}
                            </span>
                          </div>
                          <p className="text-muted mb-0" style={{ fontSize: '0.95rem' }}>
                            Your personal AI assistants
                          </p>
                        </div>
                      </div>
                    </div>
                    {renderAgentsGrid(
                      filteredMyAgents,
                      filter === 'personal'
                        ? 'You have not created any personal agents yet. Click "Create Agent" to get started.'
                        : 'No agents found.',
                      true,
                    )}
                  </section>
                )}

                {agentsMode !== 'personal_only' && filter !== 'personal' && filteredWorkspaceAgents.length > 0 && (
                  <section>
                    <div className="mb-4">
                      <div className="d-flex align-items-center gap-3">
                        <div
                          className="rounded-3 d-flex align-items-center justify-content-center"
                          style={{
                            width: 56,
                            height: 56,
                            backgroundColor: '#8e50a7',
                            flexShrink: 0,
                          }}
                        >
                          <i className="bi bi-shop" style={{ fontSize: '28px', color: 'white' }}></i>
                        </div>
                        <div className="flex-grow-1">
                          <div className="d-flex justify-content-between align-items-center mb-1">
                            <h2 className="h4 mb-0 fw-bold">Company Agent Marketplace</h2>
                            <span
                              className="badge rounded-pill px-3 py-2"
                              style={{ backgroundColor: '#8e50a7', color: 'white', fontSize: '0.9rem' }}
                            >
                              {filteredWorkspaceAgents.length}
                            </span>
                          </div>
                          <p className="text-muted mb-0" style={{ fontSize: '0.95rem' }}>
                            Discover and copy agents shared by other users in your organization
                          </p>
                        </div>
                      </div>
                    </div>
                    {renderAgentsGrid(
                      filteredWorkspaceAgents,
                      'No company agents are available in your workspace yet.',
                    )}
                  </section>
                )}

                {filteredMyAgents.length === 0 && filteredWorkspaceAgents.length === 0 && (
                  <div className="text-center py-5">
                    <div className="mb-4">
                      <i className="bi bi-robot text-muted" style={{ fontSize: '4rem' }}></i>
                    </div>
                    <h3 className="h5 mb-2">No agents found</h3>
                    <p className="text-muted mb-4">
                      {agentsMode === 'off'
                        ? 'Agents are disabled. Contact your admin to enable Agents.'
                        : filter === 'all'
                          ? 'Get started by creating your first AI agent'
                          : filter === 'personal'
                            ? 'You have not created any personal agents yet'
                            : 'No company agents are available in your workspace'}
                    </p>
                    {agentsMode !== 'off' && (
                      <Button variant="primary" onClick={handleCreate}>
                        <i className="bi bi-plus-circle me-2"></i>
                        Create Your First Agent
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}

            <AgentCreateModal
              show={isModalOpen}
              onHide={() => setIsModalOpen(false)}
              editingAgent={editingAgent}
              onAgentSaved={handleModalSaved}
            />
            {/* Missing integrations confirmation modal (pre-chat) */}
            <Modal show={missingModal.show} onHide={() => setMissingModal((m) => ({ ...m, show: false }))} centered>
              <Modal.Header closeButton>
                <Modal.Title>Missing integrations</Modal.Title>
              </Modal.Header>
              <Modal.Body>
                {missingModal.loading ? (
                  <div className="d-flex align-items-center">
                    <Spinner animation="border" size="sm" className="me-2" /> Checking your integrations…
                  </div>
                ) : (
                  <>
                    <p className="mb-3">
                      This agent requests access to the following integrations which are not connected for your account:
                    </p>
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
                                <i className="bi bi-link text-secondary"></i>
                              </div>
                            )}
                            <span className="fw-medium">{config?.name || id}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mb-0 text-muted small">
                      Continuing may result in limited or unintended behavior. You can connect integrations now from the
                      Integrations page and try again.
                    </p>
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
                    <i className="bi bi-arrow-left me-2"></i>
                    Back
                  </Button>
                  <a className="btn btn-outline-primary" href="/integrations">
                    <i className="bi bi-link-45deg me-2"></i>
                    Go to Integrations
                  </a>
                  <Button
                    variant="primary"
                    onClick={() => {
                      const a = missingModal.agent;
                      setMissingModal({ show: false, loading: false, agent: null, missing: [] });
                      if (a) proceedToChat(a);
                    }}
                  >
                    Continue without
                  </Button>
                </Modal.Footer>
              )}
            </Modal>
          </Container>
        </LayoutDashboard>
      </div>
    </>
  );
};

export default AgentsManagement;
