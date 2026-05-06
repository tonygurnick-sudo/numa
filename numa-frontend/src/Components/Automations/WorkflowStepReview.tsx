import { useTranslation } from 'react-i18next';
import { Button } from 'react-bootstrap';
import { Clock, Bot, Settings, Pencil, Zap, Mail } from 'lucide-react';
import { describeCronExpression } from '../../utils/cronUtils';
import { AgentAvatar } from '../Agents/AgentAvatar';
import type { AgentSummary } from '../../types/agents';
import type { GmailEventTrigger } from '../../types/agentSchedules';
import type { PipedreamTriggerDraft } from '../PipedreamTriggers/PipedreamTriggerConfigurator';
import { summarizePipedreamTrigger } from '../PipedreamTriggers/pipedreamTriggerLabels';

type WorkflowStepReviewProps = {
  triggerType: 'schedule' | 'event';
  cronExpression: string;
  /** Gmail trigger, when the user picked Gmail in the source picker. */
  eventTrigger?: GmailEventTrigger;
  /** Pipedream trigger draft, when the user picked any registry app. */
  pipedreamDraft?: PipedreamTriggerDraft | null;
  agent: AgentSummary | null;
  name: string;
  prompt: string;
  maxRuns: number;
  timezone: string;
  emailNotifications: boolean;
  onEditStep: (step: number) => void;
};

export const WorkflowStepReview = ({
  triggerType,
  cronExpression,
  eventTrigger,
  pipedreamDraft,
  agent,
  name,
  prompt,
  maxRuns,
  timezone,
  emailNotifications,
  onEditStep,
}: WorkflowStepReviewProps) => {
  const { t } = useTranslation('automations');

  const isEvent = triggerType === 'event';
  const scheduleDescription = cronExpression ? describeCronExpression(cronExpression) : '\u2014';
  const pipedreamSummary = pipedreamDraft
    ? summarizePipedreamTrigger(pipedreamDraft.app_slug, pipedreamDraft.component_id, t)
    : null;

  return (
    <div className="workflow-step">
      <h5 className="mb-1 fw-semibold">{t('review.title')}</h5>
      <p className="text-muted small mb-4">{t('review.subtitle')}</p>

      <div className="d-flex flex-column gap-3">
        {/* Trigger type */}
        <div className="workflow-review-item">
          <div className="d-flex align-items-center gap-3 flex-grow-1">
            <div className="workflow-review-item__icon">{isEvent ? <Zap size={18} /> : <Clock size={18} />}</div>
            <div>
              <div
                className="text-muted"
                style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}
              >
                {t('review.triggerType')}
              </div>
              <div className="fw-medium">{isEvent ? t('trigger.event.title') : t('trigger.schedule.title')}</div>
            </div>
          </div>
          <Button variant="link" size="sm" className="text-muted p-0" onClick={() => onEditStep(0)}>
            <Pencil size={14} />
          </Button>
        </div>

        {/* Schedule or Event trigger details */}
        <div className="workflow-review-item" style={isEvent ? { alignItems: 'flex-start' } : undefined}>
          <div className="d-flex align-items-start gap-3 flex-grow-1">
            <div
              className="workflow-review-item__icon workflow-review-item__icon--schedule"
              style={isEvent ? { marginTop: 2 } : undefined}
            >
              {isEvent ? <Mail size={18} /> : <Clock size={18} />}
            </div>
            <div>
              <div
                className="text-muted"
                style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}
              >
                {isEvent ? t('review.eventLabel') : t('review.scheduleLabel')}
              </div>
              {isEvent && pipedreamSummary && pipedreamDraft ? (
                <div>
                  <div className="fw-medium mb-1 d-flex align-items-center gap-2">
                    {pipedreamSummary.iconSrc ? (
                      <img src={pipedreamSummary.iconSrc} alt="" width={16} height={16} />
                    ) : (
                      <i className={pipedreamSummary.fallbackIcon} />
                    )}
                    {pipedreamSummary.combined}
                  </div>
                  {(() => {
                    const forced = new Set(Object.keys(pipedreamSummary.trigger?.restraints.forced_props ?? {}));
                    const visible = Object.entries(pipedreamDraft.configured_props).filter(
                      ([k, v]) =>
                        k !== pipedreamDraft.app_slug && // auth prop
                        !forced.has(k) &&
                        v != null &&
                        v !== '' &&
                        !(Array.isArray(v) && v.length === 0)
                    );
                    if (visible.length === 0) return null;
                    return (
                      <div className="d-flex flex-column gap-0 text-muted small mt-1">
                        {visible.map(([k, v]) => (
                          <div key={k} className="ps-2">
                            <span className="fw-medium">{k}:</span> {typeof v === 'string' ? v : JSON.stringify(v)}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              ) : isEvent && eventTrigger ? (
                <div>
                  <div className="fw-medium mb-1">
                    {t('trigger.event.builder.sourceGmail')} — {t('list.triggerEmail').toLowerCase()}
                  </div>
                  {/* Filters */}
                  {eventTrigger.filters.length > 0 && (
                    <div className="d-flex flex-column gap-1 text-muted small">
                      <div className="fw-medium">
                        {t('trigger.event.builder.filters')} (
                        {eventTrigger.filter_logic === 'any'
                          ? t('trigger.event.builder.matchAny').toLowerCase()
                          : t('trigger.event.builder.matchAll').toLowerCase()}
                        ):
                      </div>
                      {eventTrigger.filters.map((f, i) => (
                        <div key={i} className="ps-2">
                          {t(`trigger.event.builder.fields.${f.field}`)} {t(`trigger.event.builder.ops.${f.op}`)} &quot;
                          {f.value}&quot;
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Email context */}
                  <div className="text-muted small mt-1">
                    {t('trigger.event.builder.includeContext')}:{' '}
                    {eventTrigger.include_email_context !== false ? t('review.enabled') : t('review.disabled')}
                  </div>
                </div>
              ) : (
                <>
                  <div className="fw-medium">{scheduleDescription}</div>
                  <div className="text-muted small">{timezone}</div>
                </>
              )}
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
                  <span className="fw-medium">{t('review.maxRunsLabel')}:</span> {maxRuns}
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
