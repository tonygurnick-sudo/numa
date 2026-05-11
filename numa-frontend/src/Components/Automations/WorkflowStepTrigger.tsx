import { useTranslation } from 'react-i18next';
import { Clock, Zap } from 'lucide-react';
import { Alert } from 'react-bootstrap';
import { getFlag } from '../../utils/featureFlags';

type TriggerType = 'schedule' | 'event';

type WorkflowStepTriggerProps = {
  selectedTrigger: TriggerType;
  onSelect: (trigger: TriggerType) => void;
};

export const WorkflowStepTrigger = ({ selectedTrigger, onSelect }: WorkflowStepTriggerProps) => {
  const { t } = useTranslation('automations');
  // EVENT_TRIGGERS is the sub-flag of SCHEDULING. When off, the event
  // trigger card is HIDDEN entirely — Schedule (cron) remains the only
  // option. SCHEDULING gates the whole automations module; EVENT_TRIGGERS
  // gates only the event-based automation type. Pipedream-backed source
  // availability is a further step inside the picker, gated by
  // PIPEDREAM_INTEGRATIONS.
  const triggersEnabled = getFlag('EVENT_TRIGGERS');
  // When triggers are enabled, the card additionally requires data
  // connectors so the user can actually wire up an event source. If
  // connectors are off, we show the card in a disabled state with an
  // explanatory alert below (rather than hiding it — the user knows the
  // feature exists, just needs admin action).
  const connectorsEnabled = getFlag('DATA_CONNECTORS_ENABLED');
  const eventOptionAvailable = triggersEnabled && connectorsEnabled;

  return (
    <div className="workflow-step">
      <h5 className="mb-1">{t('trigger.title')}</h5>
      <p className="text-muted mb-4">{t('trigger.subtitle')}</p>

      <div className="d-flex flex-column flex-md-row gap-3">
        {/* On a schedule — active */}
        <div
          className={`workflow-trigger-card ${selectedTrigger === 'schedule' ? 'workflow-trigger-card--selected' : ''}`}
          onClick={() => onSelect('schedule')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onSelect('schedule')}
        >
          <div className="workflow-trigger-card__icon">
            <Clock size={32} />
          </div>
          <div className="workflow-trigger-card__content">
            <h6 className="mb-1">{t('trigger.schedule.title')}</h6>
            <p className="text-muted small mb-0">{t('trigger.schedule.description')}</p>
          </div>
        </div>

        {/* When something happens — event-based. Hidden when EVENT_TRIGGERS
            is off (admin / CSP killswitch). When the flag is on but data
            connectors aren't enabled, the card stays visible but disabled
            with the connectorsDisabled alert below. */}
        {triggersEnabled && (
          <div
            className={`workflow-trigger-card ${selectedTrigger === 'event' ? 'workflow-trigger-card--selected' : ''} ${!eventOptionAvailable ? 'workflow-trigger-card--disabled' : ''}`}
            onClick={() => eventOptionAvailable && onSelect('event')}
            role="button"
            tabIndex={eventOptionAvailable ? 0 : -1}
            onKeyDown={(e) => e.key === 'Enter' && eventOptionAvailable && onSelect('event')}
            aria-disabled={!eventOptionAvailable}
          >
            <div className="workflow-trigger-card__icon">
              <Zap size={32} />
            </div>
            <div className="workflow-trigger-card__content">
              <h6 className="mb-1">{t('trigger.event.title')}</h6>
              <p className="text-muted small mb-0">{t('trigger.event.description')}</p>
            </div>
          </div>
        )}
      </div>

      {triggersEnabled && !connectorsEnabled && (
        <Alert variant="light" className="mt-3 small border">
          {t('trigger.event.triggersDisabled')}
        </Alert>
      )}
    </div>
  );
};

export default WorkflowStepTrigger;
