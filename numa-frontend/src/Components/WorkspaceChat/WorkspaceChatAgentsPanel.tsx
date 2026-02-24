import React from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import AgentAvatar from '../Agents/AgentAvatar';

type AgentSummary = {
  agentId: string;
  title: string;
  icon?: string;
  iconImage?: { s3Bucket: string; s3Key: string };
  agentType?: string;
  visibility?: string;
};

export interface WorkspaceChatAgentsPanelProps {
  isOpen: boolean;
  agents: AgentSummary[];
  agentsLoading: boolean;
  onSelectAgent: (agent: AgentSummary) => void;
}

export const WorkspaceChatAgentsPanel: React.FC<WorkspaceChatAgentsPanelProps> = ({
  isOpen,
  agents,
  agentsLoading,
  onSelectAgent,
}) => {
  const { t } = useTranslation('chat');

  if (!isOpen) return null;

  return (
    <div className="workspace-chat-agents-panel workspace-settings-modern-panel">
      <div className="workspace-chat-agents-panel-body workspace-settings-modern-body">
        {agentsLoading ? (
          <div className="text-muted small d-flex align-items-center gap-2 py-2">
            <Spinner animation="border" size="sm" />
            {t('agentsPanel.loading')}
          </div>
        ) : agents.length === 0 ? (
          <div className="text-muted small fst-italic py-2">{t('agentsPanel.empty')}</div>
        ) : (
          <div className="workspace-agents-list">
            {agents.map((agent) => (
              <button
                key={agent.agentId}
                type="button"
                className="workspace-agents-item"
                onClick={() => onSelectAgent(agent)}
              >
                <AgentAvatar agent={agent} size={32} rounded alt={agent.title} />
                <div className="workspace-agents-item-meta">
                  <div className="workspace-agents-item-title">{agent.title}</div>
                  {agent.agentType && <div className="workspace-agents-item-type">{agent.agentType}</div>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkspaceChatAgentsPanel;
