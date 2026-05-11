import { Alert, Button } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { SchedulePreflightBlocker } from '../../utils/scheduleSavePreflight';

type SchedulePreflightStepperProps = {
  blockers: SchedulePreflightBlocker[];
};

/**
 * Renders preflight blockers as a vertical stepper before the schedule Save
 * button. Empty `blockers` means ready-to-save and renders nothing.
 *
 * Each blocker shows the kind icon, a title, a one-line detail, and a
 * remediation CTA when one is provided. Clicking the CTA navigates the user
 * to the relevant page (e.g. /integrations) so they can resolve the issue
 * without leaving Numa.
 */
export const SchedulePreflightStepper: React.FC<SchedulePreflightStepperProps> = ({ blockers }) => {
  const navigate = useNavigate();
  const { t } = useTranslation('agents');

  if (blockers.length === 0) {
    return (
      <Alert variant="success" className="d-flex align-items-center mb-3 py-2">
        <i className="bi bi-check-circle-fill me-2" />
        <span className="small">
          {t('scheduling.preflight.readyToSave', { defaultValue: 'All checks pass — ready to save.' })}
        </span>
      </Alert>
    );
  }

  return (
    <Alert variant="warning" className="mb-3">
      <div className="fw-semibold mb-2 d-flex align-items-center">
        <i className="bi bi-exclamation-triangle-fill me-2" />
        {t('scheduling.preflight.title', {
          defaultValue: 'Resolve {{count}} issue(s) before saving:',
          count: blockers.length,
        })}
      </div>
      <ol className="mb-0 ps-4">
        {blockers.map((b, i) => (
          <li key={`${b.kind}-${b.resource ?? i}`} className="mb-2">
            <div className="fw-semibold">{b.title}</div>
            <div className="small text-muted mb-1">{b.detail}</div>
            {b.remediationPath && (
              <Button size="sm" variant="outline-warning" onClick={() => navigate(b.remediationPath!)}>
                {b.remediationLabel ?? 'Open'} →
              </Button>
            )}
          </li>
        ))}
      </ol>
    </Alert>
  );
};
