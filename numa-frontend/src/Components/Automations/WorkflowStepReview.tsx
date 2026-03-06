import { useTranslation } from 'react-i18next';
import { Button } from 'react-bootstrap';
import { Clock, Bot, Settings, Pencil } from 'lucide-react';
import { describeCronExpression } from '../../utils/cronUtils';
import { AgentAvatar } from '../Agents/AgentAvatar';
import type { AgentSummary } from '../../types/agents';

type WorkflowStepReviewProps = {
  triggerType: 'schedule' | 'event';
  cronExpression: string;
  agent: AgentSummary | null;
  name: string;
  prompt: string;
  maxRuns: number;
  timezone: string;
  emailNotifications: boolean;
  onEditStep: (step: number) => void;
};

export const WorkflowStepReview = ({
  cronExpression,
  agent,
  name,
  prompt,
  maxRuns,
  timezone,
  emailNotifications,
  onEditStep,
}: WorkflowStepReviewProps) => {
  const { t } = useTranslation('automations');

  const scheduleDescription = cronExpression ? describeCronExpression(cronExpression) : '\u2014';

  return (
    <div className="workflow-step">
      <h5 className="mb-1 fw-semibold">{t('review.title')}</h5>
      <p className="text-muted small mb-4">{t('review.subtitle')}</p>

      <div className="d-flex flex-column gap-3">
        {/* Trigger type */}
        <div className="workflow-review-item">
          <div className="d-flex align-items-center gap-3 flex-grow-1">
            <div className="workflow-review-item__icon">
              <Clock size={18} />
            </div>
            <div>
              <div
                className="text-muted"
                style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}
              >
                {t('review.triggerType')}
              </div>
              <div className="fw-medium">{t('trigger.schedule.title')}</div>
            </div>
          </div>
          <Button variant="link" size="sm" className="text-muted p-0" onClick={() => onEditStep(0)}>
            <Pencil size={14} />
          </Button>
        </div>

        {/* Schedule */}
        <div className="workflow-review-item">
          <div className="d-flex align-items-center gap-3 flex-grow-1">
            <div className="workflow-review-item__icon workflow-review-item__icon--schedule">
              <Clock size={18} />
            </div>
            <div>
              <div
                className="text-muted"
                style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}
              >
                {t('review.scheduleLabel')}
              </div>
              <div className="fw-medium">{scheduleDescription}</div>
              <div className="text-muted small">{timezone}</div>
            </div>
          </div>
          <Button variant="link" size="sm" className="text-muted p-0" onClick={() => onEditStep(1)}>
            <Pencil size={14} />
          </Button>
        </div>

        {/* Agent */}
        <div className="workflow-review-item">
          <div className="d-flex align-items-center gap-3 flex-grow-1">
            {agent ? (
              <AgentAvatar agent={agent} size={36} />
            ) : (
              <div className="workflow-review-item__icon workflow-review-item__icon--agent">
                <Bot size={18} />
              </div>
            )}
            <div>
              <div
                className="text-muted"
                style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}
              >
                {t('review.agentLabel')}
              </div>
              <div className="fw-medium">{agent?.title || '\u2014'}</div>
            </div>
          </div>
          <Button variant="link" size="sm" className="text-muted p-0" onClick={() => onEditStep(2)}>
            <Pencil size={14} />
          </Button>
        </div>

        {/* Name + Settings */}
        <div className="workflow-review-item" style={{ alignItems: 'flex-start' }}>
          <div className="d-flex align-items-start gap-3 flex-grow-1">
            <div className="workflow-review-item__icon workflow-review-item__icon--settings" style={{ marginTop: 2 }}>
              <Settings size={18} />
            </div>
            <div>
              <div
                className="text-muted"
                style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}
              >
                {t('review.nameLabel')}
              </div>
              <div className="fw-medium mb-2">{name || '\u2014'}</div>
              <div className="d-flex flex-column gap-1 text-muted small">
                <div>
                  <span className="fw-medium">{t('review.promptLabel')}:</span> {prompt || t('review.noPrompt')}
                </div>
                <div>
                  <span className="fw-medium">{t('review.maxRunsLabel')}:</span>{' '}
                  {maxRuns > 0 ? maxRuns : t('review.unlimited')}
                </div>
                <div>
                  <span className="fw-medium">{t('review.emailLabel')}:</span>{' '}
                  {emailNotifications ? t('review.enabled') : t('review.disabled')}
                </div>
              </div>
            </div>
          </div>
          <Button variant="link" size="sm" className="text-muted p-0" onClick={() => onEditStep(3)}>
            <Pencil size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default WorkflowStepReview;
