import type { ReactNode } from 'react';
import { Alert, Button, Modal, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { AuthTypeBadge } from '../AuthTypeBadge';
import type { ConnectorTemplate } from '../connectorRegistry';

export interface WizardStep {
  id: string;
  label: string;
}

interface ConnectorWizardModalProps {
  show: boolean;
  onHide: () => void;
  title: string;
  authType?: ConnectorTemplate['authType'];
  steps: WizardStep[];
  currentStep: number;
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  isSaving: boolean;
  isLoading?: boolean;
  error?: string | null;
  success?: string | null;
  nextLabel?: string;
  children: ReactNode;
}

export const ConnectorWizardModal = ({
  show,
  onHide,
  title,
  authType,
  steps,
  currentStep,
  onNext,
  onBack,
  canProceed,
  isSaving,
  isLoading,
  error,
  success,
  nextLabel,
  children,
}: ConnectorWizardModalProps) => {
  const { t } = useTranslation('integrations');
  const isLastStep = currentStep >= steps.length;

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title className="d-flex align-items-center gap-2">
          <span>{title}</span>
          {authType && <AuthTypeBadge authType={authType} size="md" />}
        </Modal.Title>
      </Modal.Header>

      <Modal.Body style={{ minHeight: 300 }}>
        {error && (
          <Alert variant="danger" className="py-2">
            {error}
          </Alert>
        )}
        {success && (
          <Alert variant="success" className="py-2">
            {success}
          </Alert>
        )}

        {isLoading ? (
          <div className="text-center py-5">
            <Spinner animation="border" variant="primary" />
          </div>
        ) : (
          <>
            {/* Step indicator + label, centered as a single block */}
            <div className="d-flex flex-column align-items-center mb-3">
              <div className="d-flex gap-2 mb-2">
                {steps.map((step, i) => (
                  <span
                    key={step.id}
                    className={`badge rounded-pill d-inline-flex align-items-center justify-content-center ${
                      i + 1 <= currentStep ? 'bg-primary' : 'bg-secondary'
                    }`}
                    style={{ width: 28, height: 28 }}
                  >
                    {i + 1}
                  </span>
                ))}
              </div>
              <h6 className="text-muted mb-0">{steps[currentStep - 1]?.label}</h6>
            </div>

            {children}
          </>
        )}
      </Modal.Body>

      <Modal.Footer>
        {currentStep > 1 && (
          <Button variant="outline-secondary" onClick={onBack} disabled={isSaving}>
            {t('dataConnectors.wizard.back')}
          </Button>
        )}
        <Button variant="secondary" onClick={onHide} disabled={isSaving}>
          {t('dataConnectors.wizard.cancel')}
        </Button>
        <Button variant="primary" onClick={onNext} disabled={!canProceed || isSaving}>
          {isSaving ? (
            <>
              <Spinner size="sm" className="me-2" />
              {t('dataConnectors.wizard.saving')}
            </>
          ) : nextLabel ? (
            nextLabel
          ) : isLastStep ? (
            t('dataConnectors.wizard.save')
          ) : (
            t('dataConnectors.wizard.next')
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
