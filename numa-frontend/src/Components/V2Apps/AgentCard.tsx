import React from 'react';
import { useTranslation } from 'react-i18next';
import type { V2AppAgent } from '../../types/apps';

interface AgentCardProps {
  agent: V2AppAgent;
  isSelected: boolean;
  onClick: () => void;
}

export const AgentCard: React.FC<AgentCardProps> = ({ agent, isSelected, onClick }) => {
  const { t } = useTranslation('apps');

  return (
    <div
      className={`v2-agent-card ${isSelected ? 'v2-agent-card--selected' : ''} ${agent.status !== 'active' ? 'v2-agent-card--disabled' : ''}`}
      onClick={agent.status === 'active' ? onClick : undefined}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && agent.status === 'active' && onClick()}
    >
      <div className="v2-agent-card__header">
        <div className="v2-agent-card__icon" style={{ backgroundColor: `${agent.color}15` }}>
          <i className={agent.icon} style={{ color: agent.color }} />
        </div>
        <div className="v2-agent-card__info">
          <h4 className="v2-agent-card__name">{t(agent.nameKey)}</h4>
          <p className="v2-agent-card__description">{t(agent.descriptionKey)}</p>
        </div>
        <div className="v2-agent-card__status-area">
          <span className={`v2-agent-card__status v2-agent-card__status--${agent.status}`}>
            <span className="v2-agent-card__status-dot" />
            {t(`v2Apps.agents.status.${agent.status}`)}
          </span>
        </div>
      </div>
      {agent.capabilities && agent.capabilities.length > 0 && (
        <div className="v2-agent-card__capabilities">
          {agent.capabilities.map((cap) => (
            <span key={cap} className="v2-agent-card__capability-tag">
              {t(`v2Apps.agents.capabilities.${cap}`, { defaultValue: cap })}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
