import { Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { getAllTimezones } from '../../utils/timezoneUtils';

type WorkflowStepPromptProps = {
  name: string;
  onNameChange: (value: string) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  maxRuns: number;
  onMaxRunsChange: (value: number) => void;
  emailNotifications: boolean;
  onEmailNotificationsChange: (value: boolean) => void;
  timezone: string;
  onTimezoneChange: (value: string) => void;
  submitting: boolean;
  nameError?: string;
};

export const WorkflowStepPrompt = ({
  name,
  onNameChange,
  prompt,
  onPromptChange,
  maxRuns,
  onMaxRunsChange,
  timezone,
  onTimezoneChange,
  submitting,
  nameError,
}: WorkflowStepPromptProps) => {
  const { t } = useTranslation('automations');
  const timezones = getAllTimezones();

  return (
    <div className="workflow-step">
      <h5 className="mb-1">{t('prompt.title')}</h5>
      <p className="text-muted mb-4">{t('prompt.subtitle')}</p>

      <div className="d-flex flex-column gap-4">
        {/* Name */}
        <div>
          <Form.Label>{t('prompt.name.label')}</Form.Label>
          <Form.Control
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t('prompt.name.placeholder')}
            disabled={submitting}
            isInvalid={!!nameError}
          />
          {nameError && <Form.Control.Feedback type="invalid">{nameError}</Form.Control.Feedback>}
        </div>

        {/* Instructions */}
        <div>
          <Form.Label>{t('prompt.instructions.label')}</Form.Label>
          <Form.Control
            as="textarea"
            rows={4}
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder={t('prompt.instructions.placeholder')}
            disabled={submitting}
          />
          <Form.Text muted>{t('prompt.instructions.help')}</Form.Text>
        </div>

        {/* Max runs */}
        <div>
          <Form.Label>{t('prompt.maxRuns.label')}</Form.Label>
          <div className="d-flex align-items-center gap-3">
            <Form.Control
              type="number"
              min={0}
              max={10000}
              value={maxRuns}
              onChange={(e) => onMaxRunsChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
              disabled={submitting}
              style={{ width: 120 }}
            />
            <span className="text-muted small">{maxRuns === 0 ? t('prompt.maxRuns.unlimited') : ''}</span>
          </div>
          <Form.Text muted>{t('prompt.maxRuns.help')}</Form.Text>
        </div>

        {/* Email notifications — coming soon */}
        <div style={{ opacity: 0.5 }}>
          <Form.Check
            type="switch"
            id="email-notifications"
            label={`${t('prompt.emailNotifications.label')} (${t('prompt.emailNotifications.comingSoon')})`}
            checked={false}
            disabled
          />
        </div>

        {/* Timezone */}
        <div>
          <Form.Label>{t('prompt.timezone.label')}</Form.Label>
          <Form.Select value={timezone} onChange={(e) => onTimezoneChange(e.target.value)} disabled={submitting}>
            {timezones.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </Form.Select>
        </div>
      </div>
    </div>
  );
};

export default WorkflowStepPrompt;
