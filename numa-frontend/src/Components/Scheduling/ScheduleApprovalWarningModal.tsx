import { Modal, Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { AtRiskCapability } from '../../utils/approvalPosture';

type ScheduleApprovalWarningModalProps = {
  show: boolean;
  capabilities: AtRiskCapability[];
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Shown before a schedule / automation is created when the chosen agent has
 * tool capabilities (integrations, Numa Files, agents, memories, Numa Ops)
 * whose approval mode is NOT auto-approve. Scheduled and triggered runs are
 * unattended — there is no one to approve, so those actions stall (~180s) and
 * fail. Non-blocking: the user can acknowledge with OK and proceed, or go back
 * and fix the agent's / their approval settings.
 *
 * Only rendered when there is at least one at-risk capability (callers gate on
 * `atRiskCapabilitiesForSchedule(...).length`), so an agent whose tools are all
 * auto-approved (or has none enabled) never triggers it.
 */
export const ScheduleApprovalWarningModal: React.FC<ScheduleApprovalWarningModalProps> = ({
  show,
  capabilities,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation('agents');

  const labelFor = (cap: AtRiskCapability): string => {
    switch (cap.category) {
      case 'integrations':
        return t('scheduling.approvalWarning.cap.integrations', {
          defaultValue: 'Integrations ({{names}})',
          names: (cap.integrationNames ?? []).join(', '),
        });
      case 'knowledgeBases':
        return t('scheduling.approvalWarning.cap.knowledgeBases', { defaultValue: 'Numa Files' });
      case 'agents':
        return t('scheduling.approvalWarning.cap.agents', { defaultValue: 'Agents' });
      case 'memories':
        return t('scheduling.approvalWarning.cap.memories', { defaultValue: 'Memories' });
      case 'ops':
        return t('scheduling.approvalWarning.cap.ops', { defaultValue: 'Numa Ops' });
      default:
        return cap.category;
    }
  };

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
              'This agent can perform actions that require your approval before they run. Scheduled and triggered runs happen unattended — there is no one to approve, so these will stall and fail:',
          })}
        </p>
        <ul className="mb-3">
          {capabilities.map((cap) => (
            <li key={cap.category}>{labelFor(cap)}</li>
          ))}
        </ul>
        <p className="small text-muted mb-0">
          {t('scheduling.approvalWarning.fix', {
            defaultValue:
              'To let them run automatically, set these to "Auto-approve all" in the agent\'s approval settings (or your account defaults).',
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
