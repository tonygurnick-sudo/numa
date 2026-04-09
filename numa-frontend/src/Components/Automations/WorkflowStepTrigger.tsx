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
  const connectorsEnabled = getFlag('DATA_CONNECTORS_ENABLED');

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

        {/* When something happens — event-based */}
        <div
          className={`workflow-trigger-card ${selectedTrigger === 'event' ? 'workflow-trigger-card--selected' : ''} ${!connectorsEnabled ? 'workflow-trigger-card--disabled' : ''}`}
          onClick={() => connectorsEnabled && onSelect('event')}
          role="button"
          tabIndex={connectorsEnabled ? 0 : -1}
          onKeyDown={(e) => e.key === 'Enter' && connectorsEnabled && onSelect('event')}
          aria-disabled={!connectorsEnabled}
        >
          <div className="workflow-trigger-card__icon">
            <Zap size={32} />
          </div>
          <div className="workflow-trigger-card__content">
            <h6 className="mb-1">{t('trigger.event.title')}</h6>
            <p className="text-muted small mb-0">{t('trigger.event.description')}</p>
          </div>
        </div>
      </div>

      {!connectorsEnabled && (
        <Alert variant="light" className="mt-3 small border">
          {t('trigger.event.connectorsDisabled')}
        </Alert>
      )}
    </div>
  );
};

export default WorkflowStepTrigger;
