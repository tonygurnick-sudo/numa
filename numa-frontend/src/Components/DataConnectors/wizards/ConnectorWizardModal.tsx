import type { ReactNode } from 'react';
import { Alert, Button, Modal, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

export interface WizardStep {
  id: string;
  label: string;
}

interface ConnectorWizardModalProps {
  show: boolean;
  onHide: () => void;
  title: string;
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
        <Modal.Title>{title}</Modal.Title>
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
            {/* Step indicator */}
            <div className="d-flex justify-content-center mb-2 gap-2">
              {steps.map((step, i) => (
                <span
                  key={step.id}
                  className={`badge rounded-pill ${i + 1 <= currentStep ? 'bg-primary' : 'bg-secondary'}`}
                  style={{ width: 28, height: 28, lineHeight: '20px', textAlign: 'center' }}
                >
                  {i + 1}
                </span>
              ))}
            </div>
            <h6 className="text-center text-muted mb-3">{steps[currentStep - 1]?.label}</h6>

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
