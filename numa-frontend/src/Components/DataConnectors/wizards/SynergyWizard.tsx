import { useState } from 'react';
import { Alert, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { ConnectorWizardModal } from './ConnectorWizardModal';
import type { WizardStep } from './ConnectorWizardModal';
import { DataConnectorsService } from '../../../Services/DataConnectorsService';
import type { NumaPost } from '../../../Providers/NumaRequestContext';

interface SynergyWizardProps {
  show: boolean;
  onHide: () => void;
  onSaved: () => void;
  existingServer?: string;
  numaPost: NumaPost;
}

export const SynergyWizard = ({ show, onHide, onSaved, existingServer, numaPost }: SynergyWizardProps) => {
  const { t } = useTranslation('integrations');

  const [step, setStep] = useState(1);
  const [server, setServer] = useState(existingServer || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const steps: WizardStep[] = [
    { id: 'url', label: t('dataConnectors.synergyWizard.stepUrl') },
    { id: 'review', label: t('dataConnectors.synergyWizard.stepReview') },
  ];

  const canProceed = step === 1 ? server.trim().length > 0 : true;

  const handleNext = async () => {
    if (step === 1) {
      setStep(2);
      return;
    }

    // Step 2: save
    try {
      setSaving(true);
      setError(null);
      await DataConnectorsService.connect(numaPost, {
        connector_id: 'synergy',
        config: { server: server.trim() },
        skip_test: true,
      });
      setSuccess(t('dataConnectors.synergyWizard.saveSuccess'));
      setTimeout(() => {
        onSaved();
        resetState();
      }, 800);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('dataConnectors.synergyWizard.saveError');
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const resetState = () => {
    setStep(1);
    setServer(existingServer || '');
    setError(null);
    setSuccess(null);
  };

  const handleHide = () => {
    resetState();
    onHide();
  };

  return (
    <ConnectorWizardModal
      show={show}
      onHide={handleHide}
      title={t('dataConnectors.synergyWizard.title')}
      steps={steps}
      currentStep={step}
      onNext={handleNext}
      onBack={handleBack}
      canProceed={canProceed}
      isSaving={saving}
      error={error}
      success={success}
    >
      {step === 1 && (
        <Form.Group>
          <Form.Label className="small fw-semibold">{t('dataConnectors.synergyWizard.urlLabel')}</Form.Label>
          <Form.Control
            type="url"
            placeholder={t('dataConnectors.synergyWizard.urlPlaceholder')}
            value={server}
            onChange={(e) => setServer(e.target.value)}
            autoFocus
          />
          <Form.Text className="text-muted">{t('dataConnectors.synergyWizard.urlHint')}</Form.Text>
        </Form.Group>
      )}

      {step === 2 && (
        <div>
          <h6 className="fw-semibold mb-3">{t('dataConnectors.synergyWizard.reviewTitle')}</h6>
          <div className="border rounded p-3 mb-3">
            <div className="mb-2">
              <span className="text-muted small">{t('dataConnectors.synergyWizard.reviewUrl')}</span>
              <div className="fw-semibold">{server.trim()}</div>
            </div>
          </div>
          <Alert variant="info" className="py-2 small">
            <i className="bi bi-info-circle me-2"></i>
            {t('dataConnectors.synergyWizard.credentialNote')}
          </Alert>
        </div>
      )}
    </ConnectorWizardModal>
  );
};
