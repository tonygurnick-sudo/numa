import { Modal, Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { AtRiskIntegration } from '../../utils/approvalPosture';

type IntegrationApprovalWarningModalProps = {
  show: boolean;
  integrations: AtRiskIntegration[];
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Shown before a schedule / automation is created when the chosen agent uses
 * integrations whose approval mode is NOT auto-approve. Scheduled and triggered
 * runs are unattended — there is no one to approve, so those actions stall
 * (~180s) and fail. Non-blocking: the user can acknowledge with OK and proceed,
 * or go back and fix the agent's / their integration approval settings.
 *
 * Only rendered when there is at least one at-risk integration (callers gate on
 * `atRiskIntegrationsForSchedule(...).length`), so an agent with no integrations
 * never triggers it.
 */
export const IntegrationApprovalWarningModal: React.FC<IntegrationApprovalWarningModalProps> = ({
  show,
  integrations,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation('agents');
  const names = integrations.map((i) => i.name).join(', ');

  return (
    <Modal show={show} onHide={onCancel} centered backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-shield-exclamation text-warning me-2" />
          {t('scheduling.approvalWarning.title', {
            defaultValue: 'This agent needs approval for some actions',
          })}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>
          {t('scheduling.approvalWarning.lead', {
            defaultValue:
              'This agent uses {{names}}, which require your approval before they run. Scheduled and triggered runs happen unattended — there is no one to approve, so those actions will stall and fail.',
            names,
          })}
        </p>
        <p className="small text-muted mb-0">
          {t('scheduling.approvalWarning.fix', {
            defaultValue:
              'To let them run automatically, set the agent\'s integration approval to "Auto-approve all" (Tools → Approval), or change your per-integration approval in Settings → Integrations.',
          })}
        </p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          {t('scheduling.approvalWarning.cancel', { defaultValue: 'Go back' })}
        </Button>
        <Button variant="primary" onClick={onConfirm}>
          {t('scheduling.approvalWarning.confirm', { defaultValue: 'OK, create anyway' })}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
