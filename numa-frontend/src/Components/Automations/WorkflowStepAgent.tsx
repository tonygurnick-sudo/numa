import { useState, useMemo } from 'react';
import { Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Search, Check } from 'lucide-react';
import { AgentAvatar } from '../Agents/AgentAvatar';
import type { AgentSummary } from '../../types/agents';

type WorkflowStepAgentProps = {
  agents: AgentSummary[];
  selectedAgentId: string | null;
  onSelect: (agentId: string) => void;
  loading?: boolean;
};

export const WorkflowStepAgent = ({ agents, selectedAgentId, onSelect, loading }: WorkflowStepAgentProps) => {
  const { t } = useTranslation('automations');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredAgents = useMemo(() => {
    if (!searchQuery) return agents;
    const q = searchQuery.toLowerCase();
    return agents.filter((a) => a.title.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q));
  }, [agents, searchQuery]);

  return (
    <div className="workflow-step">
      <h5 className="mb-1">{t('agent.title')}</h5>
      <p className="text-muted mb-4">{t('agent.subtitle')}</p>

      {/* Search */}
      <div className="position-relative mb-3">
        <Search size={14} className="position-absolute top-50 translate-middle-y" style={{ left: 12 }} />
        <Form.Control
          type="text"
          placeholder={t('agent.search')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ paddingLeft: 36 }}
          size="sm"
        />
      </div>

      {/* Agent list */}
      {loading ? (
        <div className="text-center py-4 text-muted">{t('page.loading')}</div>
      ) : filteredAgents.length === 0 ? (
        <div className="text-center py-4 text-muted">{t('agent.empty')}</div>
      ) : (
        <div className="workflow-agent-list">
          {filteredAgents.map((agent) => {
            const isSelected = agent.agentId === selectedAgentId;
            return (
              <div
                key={agent.agentId}
                className={`workflow-agent-item ${isSelected ? 'workflow-agent-item--selected' : ''}`}
                onClick={() => onSelect(agent.agentId)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onSelect(agent.agentId)}
              >
                <AgentAvatar agent={agent} size={40} />
                <div className="flex-grow-1 min-w-0">
                  <div className="fw-medium text-truncate">{agent.title}</div>
                  {agent.description && <div className="text-muted small text-truncate">{agent.description}</div>}
                </div>
                {isSelected && (
                  <div className="workflow-agent-item__check">
                    <Check size={16} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WorkflowStepAgent;
