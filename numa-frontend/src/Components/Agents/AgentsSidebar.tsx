import {
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
  ForwardRefRenderFunction,
  useCallback,
  useRef,
} from 'react';
import { Button, Offcanvas, Spinner, Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { AdminAgentsService, type AgentsMode } from '../../Services/AdminAgentsService';
import { listAgents } from '../../Services/AgentsService';
import type { AgentSummary } from '../../types/agents';
import type { ConversationMeta } from '../../hooks/useChatInactivity';
import { useNavigate } from 'react-router-dom';
import AgentAvatar from './AgentAvatar';
import { sortAgentsByPriority } from '../../utils/agentSortingUtils';
import { useDrawerBackClose } from '../../hooks/useDrawerBackClose';

type AgentsSidebarProps = {
  onSelectAgent?: (agent: AgentSummary) => void;
  currentAgentId?: string | null;
  recentConversations?: ConversationMeta[];
};

export type AgentsSidebarHandle = {
  refreshAgents: () => void;
  toggleSidebar: () => void;
};

const AgentsSidebarComponent: ForwardRefRenderFunction<AgentsSidebarHandle, AgentsSidebarProps> = (
  { onSelectAgent, currentAgentId, recentConversations },
  ref,
) => {
  const { numaGet } = useNumaRequest();
  const { t } = useTranslation('agents');
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentsMode, setAgentsMode] = useState<AgentsMode>('full');
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
  const skipBackOnCloseRef = useRef(false);

  const handleClose = useCallback(() => setShow(false), []);
  const handleManageAgents = useCallback(() => {
    if (isMobile) {
      skipBackOnCloseRef.current = true;
    }
    setShow(false);
    navigate('/agents', { replace: isMobile });
  }, [isMobile, navigate]);

  const loadAgents = async () => {
    try {
      setLoading(true);
      setError(null);
      const ownedAgents = await listAgents(numaGet, { scope: 'owned' });

      // Deduplicate: prefer user-scoped agents over workspace-scoped when both exist with same agentId
      // This happens when a personal agent is made public (creates both user and workspace copies)
      const agentMap = new Map<string, (typeof ownedAgents)[0]>();

      for (const agent of ownedAgents) {
        const existing = agentMap.get(agent.agentId);
        // Prefer user scope over workspace scope to avoid duplicates
        if (!existing || (agent.scope === 'user' && existing.scope === 'workspace')) {
          agentMap.set(agent.agentId, agent);
        }
      }

      const deduplicatedAgents = Array.from(agentMap.values());
      const filtered =
        agentsMode === 'personal_only' ? deduplicatedAgents.filter((a) => a.scope === 'user') : deduplicatedAgents;
      const sortedAgents = sortAgentsByPriority(filtered, recentConversations);
      setAgents(sortedAgents);
    } catch (err) {
      console.error('AgentsSidebar: failed to load agents', err);
      setError((err as Error)?.message ?? t('sidebar.errors.loadAgents'));
    } finally {
      setLoading(false);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      refreshAgents: loadAgents,
      toggleSidebar: () => setShow((prev) => !prev),
    }),
    [],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useDrawerBackClose({
    isOpen: show,
    onClose: handleClose,
    enabled: isMobile,
    stateKey: 'agents-sidebar',
    skipBackOnCloseRef,
  });

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const res = await AdminAgentsService.get(numaGet);
        if (!cancelled) setAgentsMode(res.mode);
      } catch {
        if (!cancelled) setAgentsMode('full');
      }
    };
    if (show) {
      init().finally(loadAgents);
    }
    return () => {
      cancelled = true;
    };
  }, [show]);

  // Delete action is available on the Agents management page

  // Duplicate action is available on the Agents management page

  const handleSelectAgent = (agent: AgentSummary) => {
    onSelectAgent?.(agent);
    setShow(false);
  };

  const offcanvasStyle = {
    width: '320px',
    maxWidth: '320px',
    zIndex: 1100,
    top: isMobile ? 'calc(60px + env(safe-area-inset-top, 0px))' : undefined,
  } as const;

  return (
    <>
      <Button variant="secondary" className="btn" onClick={() => setShow(true)} disabled={agentsMode === 'off'}>
        <i className="bi bi-robot me-1"></i> {t('sidebar.openButton')}
      </Button>
      <Offcanvas show={show} placement="end" onHide={() => setShow(false)} backdrop scroll style={offcanvasStyle}>
        <Offcanvas.Header closeButton closeVariant="dark">
          <div className="d-flex align-items-center justify-content-between w-100">
            <Offcanvas.Title className="mb-0">{t('sidebar.title')}</Offcanvas.Title>
            <Button variant="secondary" size="sm" onClick={handleManageAgents}>
              {t('sidebar.manage')}
            </Button>
          </div>
        </Offcanvas.Header>
        <Offcanvas.Body className="d-flex flex-column">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <p className="mb-0 text-muted small">{t('sidebar.subtitle')}</p>
            </div>
            <Button variant="outline-primary" size="sm" onClick={loadAgents} disabled={loading}>
              <i className="bi bi-arrow-clockwise"></i>
            </Button>
          </div>
          {agentsMode === 'off' ? (
            <Alert variant="info">{t('sidebar.disabled')}</Alert>
          ) : loading ? (
            <div className="d-flex justify-content-center align-items-center flex-grow-1">
              <Spinner animation="border" />
            </div>
          ) : error ? (
            <Alert variant="danger" onClose={() => setError(null)} dismissible>
              {error}
            </Alert>
          ) : agents.length === 0 ? (
            <div className="text-center text-muted mt-4">
              <i className="bi bi-robot display-6 d-block mb-2"></i>
              <p>{t('sidebar.empty')}</p>
            </div>
          ) : (
            <div className="d-flex flex-column gap-3">
              {agents.map((agent) => {
                const isActive = agent.agentId === currentAgentId;
                return (
                  <div
                    key={agent.agentId}
                    className={`border rounded p-3 ${isActive ? 'border-primary' : 'border-light'} agent-list-item`}
                  >
                    <div className="d-flex align-items-start justify-content-between gap-2">
                      <div>
                        <div className="d-flex align-items-center gap-2">
                          <AgentAvatar agent={agent} size={24} alt={`${agent.title} avatar`} />
                          <strong>{agent.title}</strong>
                        </div>
                        <div className="text-muted small mt-1">
                          {agent.visibility === 'public'
                            ? t('sidebar.visibility.public')
                            : t('sidebar.visibility.personal')}
                        </div>
                      </div>
                      <div className="d-flex gap-1">
                        <Button variant="outline-success" size="sm" onClick={() => handleSelectAgent(agent)}>
                          {t('sidebar.use')}
                        </Button>
                      </div>
                    </div>
                    {agent.requiredIntegrations?.length ? (
                      <div className="mt-2 text-muted small">
                        {t('sidebar.requires', { integrations: agent.requiredIntegrations.join(', ') })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
};

export const AgentsSidebar = forwardRef(AgentsSidebarComponent);

export default AgentsSidebar;
