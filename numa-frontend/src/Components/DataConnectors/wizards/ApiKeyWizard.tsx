import { useCallback, useEffect, useState } from 'react';
import { Alert, Col, Collapse, Form, Row } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ConnectorWizardModal } from './ConnectorWizardModal';
import type { WizardStep } from './ConnectorWizardModal';
import {
  createCompanySecret,
  updateCompanySecret,
  getCompanySecret,
  deleteCompanySecret,
} from '../../../Services/VaultService';
import type { VaultSecretMetadata, VaultSecretWithFields } from '../../../Services/VaultService';
import type { ConnectorTemplate } from '../connectorRegistry';
import { AuthTypeBadge } from '../AuthTypeBadge';

// Admin flow for non-OAuth connectors: register + optional metadata only.
// The per-user credential (PAT / API key / username+password) is captured in
// chat on first use and stored in the user's personal vault, not here.

interface ApiKeyFormState {
  connectorId: string;
  displayName: string;
  icon: string;
  description: string;
  rateLimitRpm: string;
  rateLimitDaily: string;
  /** Optional admin-configured base URL for connectors whose API lives at a
   *  customer-hosted / per-instance location (e.g. Synergy 12d). If empty,
   *  runtime falls back to whatever the connector registry / backend has
   *  hardcoded for this connector. */
  instanceUrl: string;
}

interface ApiKeyWizardProps {
  show: boolean;
  onHide: () => void;
  onSaved: () => void;
  connector: ConnectorTemplate;
  existingSecrets: VaultSecretMetadata[];
}

export const ApiKeyWizard = ({ show, onHide, onSaved, connector, existingSecrets }: ApiKeyWizardProps) => {
  const { t } = useTranslation('integrations');

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [existingSecretName, setExistingSecretName] = useState<string | null>(null);
  const [legacySecretName, setLegacySecretName] = useState<string | null>(null);
  const [customizeExpanded, setCustomizeExpanded] = useState(false);

  const configSecretName = `connector-config-${connector.id}`;
  const legacyCredentialSecretName = `connector-${connector.id}`;

  const emptyForm = useCallback(
    (): ApiKeyFormState => ({
      connectorId: connector.id,
      displayName: connector.displayName,
      icon: connector.icon,
      description: connector.description,
      rateLimitRpm: connector.rateLimitRpm?.toString() || '',
      rateLimitDaily: connector.rateLimitDaily?.toString() || '',
      // No default — always optional. If the registry has a baseUrl it's used at
      // runtime when this is blank; we don't pre-fill to avoid forking the value.
      instanceUrl: '',
    }),
    [connector]
  );

  const [form, setForm] = useState<ApiKeyFormState>(emptyForm);

  const updateForm = (partial: Partial<ApiKeyFormState>) => setForm((prev) => ({ ...prev, ...partial }));

  /** Structural URL validation. Empty is valid (field is optional). Accepts
   *  only http(s) schemes to stop obvious misconfigurations (e.g. ftp://). */
  const instanceUrlError = ((): string | null => {
    const v = form.instanceUrl.trim();
    if (!v) return null;
    try {
      const u = new URL(v);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return t('dataConnectors.apiKeyWizard.instanceUrlInvalidProtocol', {
          defaultValue: 'Must start with http:// or https://',
        });
      }
      if (!u.host) {
        return t('dataConnectors.apiKeyWizard.instanceUrlInvalid', { defaultValue: 'Invalid URL' });
      }
      return null;
    } catch {
      return t('dataConnectors.apiKeyWizard.instanceUrlInvalid', { defaultValue: 'Invalid URL' });
    }
  })();

  const applyFieldsToForm = useCallback(
    (fields: Record<string, string>) => {
      updateForm({
        ...emptyForm(),
        displayName: fields.display_name || connector.displayName,
        icon: fields.icon || connector.icon,
        description: fields.description || connector.description,
        rateLimitRpm: fields.rate_limit_rpm || connector.rateLimitRpm?.toString() || '',
        rateLimitDaily: fields.rate_limit_daily || connector.rateLimitDaily?.toString() || '',
        instanceUrl: fields.instance_url || '',
      });
    },
    [connector, emptyForm]
  );

  useEffect(() => {
    if (!show) return;

    setStep(1);
    setError(null);
    setSuccess(null);
    setCustomizeExpanded(false);
    setExistingSecretName(null);
    setLegacySecretName(null);

    const configHit = existingSecrets.find((s) => s.name === configSecretName);
    const legacyHit = existingSecrets.find((s) => s.name === legacyCredentialSecretName);
    const hit = configHit ?? legacyHit;
    if (legacyHit) setLegacySecretName(legacyHit.name);

    if (hit) {
      setExistingSecretName(hit.name);
      setLoading(true);
      getCompanySecret(hit.name)
        .then((full: VaultSecretWithFields) => {
          applyFieldsToForm(full.fields ?? {});
        })
        .catch(() => {
          setForm(emptyForm());
        })
        .finally(() => setLoading(false));
    } else {
      setForm(emptyForm());
    }
  }, [show, connector.id, existingSecrets, configSecretName, legacyCredentialSecretName, applyFieldsToForm, emptyForm]);

  const steps: WizardStep[] = [
    { id: 'overview', label: t('dataConnectors.oauthWizard.stepOverview') },
    { id: 'review', label: t('dataConnectors.apiKeyWizard.stepReviewSave') },
    { id: 'done', label: t('dataConnectors.apiKeyWizard.stepDone') },
  ];

  // Step 2 shows form inputs; disable Next/Save if any field has a validation
  // error. Right now only instance URL has structural validation — extend this
  // predicate as more fields are validated.
  const canProceed = step === 1 || step === 3 || (step === 2 && instanceUrlError === null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const fields: Record<string, string> = {
        display_name: form.displayName.trim(),
        icon: form.icon.trim(),
        description: form.description.trim(),
        connector_type: connector.authType,
      };

      if (form.rateLimitRpm.trim()) fields.rate_limit_rpm = form.rateLimitRpm.trim();
      if (form.rateLimitDaily.trim()) fields.rate_limit_daily = form.rateLimitDaily.trim();
      if (form.instanceUrl.trim()) fields.instance_url = form.instanceUrl.trim();

      // Persist the credential-field schema so the backend can emit the right
      // `needs_credential` error shape when a user has no stored credential
      // yet. The frontend registry is the source of truth; this is a snapshot.
      if (connector.credentialFields && connector.credentialFields.length > 0) {
        fields.credential_fields = JSON.stringify(
          connector.credentialFields.map((f) => ({
            key: f.key,
            label: f.label,
            type: f.type,
            placeholder: f.placeholder,
            required: f.required,
          }))
        );
      }

      const targetAlreadyNamedConfig = existingSecretName === configSecretName;
      if (targetAlreadyNamedConfig) {
        await updateCompanySecret(configSecretName, { fields });
      } else {
        await createCompanySecret({
          name: configSecretName,
          description: `Connector config for ${form.displayName.trim() || connector.id}`,
          category: 'Connector Config',
          type: 'custom',
          fields,
        });
      }

      if (legacySecretName && legacySecretName !== configSecretName) {
        await deleteCompanySecret(legacySecretName).catch(() => {});
        setLegacySecretName(null);
      }

      setExistingSecretName(configSecretName);
      setSuccess(t('dataConnectors.apiKeyWizard.saveSuccess'));
      setStep(3);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('dataConnectors.apiKeyWizard.saveError');
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleNext = async () => {
    if (step === 2) {
      await handleSave();
      return;
    }
    if (step === 3) {
      onSaved();
      onHide();
      return;
    }
    setError(null);
    setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1 && step < 3) {
      setError(null);
      setStep(step - 1);
    }
  };

  const resetState = () => {
    setStep(1);
    setForm(emptyForm());
    setError(null);
    setSuccess(null);
    setExistingSecretName(null);
    setLegacySecretName(null);
    setCustomizeExpanded(false);
  };

  const handleHide = () => {
    resetState();
    onHide();
  };

  const wizardTitle = t('dataConnectors.apiKeyWizard.title', { connector: connector.displayName });

  return (
    <ConnectorWizardModal
      show={show}
      onHide={handleHide}
      title={wizardTitle}
      authType={connector.authType}
      steps={steps}
      currentStep={step}
      onNext={handleNext}
      onBack={handleBack}
      canProceed={canProceed}
      isSaving={saving}
      isLoading={loading}
      error={error}
      success={success}
      nextLabel={
        step === 3 ? t('dataConnectors.wizard.done') : step === 2 ? t('dataConnectors.wizard.save') : undefined
      }
    >
      {step === 1 && (
        <div>
          <div className="d-flex align-items-center gap-3 mb-3 p-3 border rounded">
            <i className={connector.icon} style={{ fontSize: '2rem' }} />
            <div>
              <h5 className="mb-1 d-flex align-items-center gap-2">
                <span>{connector.displayName}</span>
                <AuthTypeBadge authType={connector.authType} />
              </h5>
              <p className="text-muted mb-0 small">{connector.description}</p>
            </div>
          </div>

          <Alert variant="info" className="py-2 small">
            <i className="bi bi-info-circle me-2"></i>
            {t(
              'dataConnectors.apiKeyWizard.perUserNotice',
              'No credential needed here. Each user will be asked for their own credential the first time they use this connector from chat.'
            )}
          </Alert>

          <Row className="g-2 mb-3">
            <Col md={6}>
              <div className="small text-muted">{t('dataConnectors.apiKeyWizard.category')}</div>
              <div className="small fw-semibold">{connector.category}</div>
            </Col>
            <Col md={6}>
              <div className="small text-muted">{t('dataConnectors.apiKeyWizard.authType')}</div>
              <div className="small fw-semibold" style={{ textTransform: 'capitalize' }}>
                {connector.authType.replace('-', ' ')}
              </div>
            </Col>
          </Row>
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="border rounded p-3 mb-3">
            <h6 className="fw-semibold small text-muted mb-2">{t('dataConnectors.oauthWizard.reviewBasicInfo')}</h6>
            <div className="mb-1">
              <span className="text-muted small">{t('dataConnectors.oauth.displayName')}:</span>{' '}
              <strong>{form.displayName}</strong>
            </div>
            <div className="mb-1">
              <span className="text-muted small">{t('dataConnectors.apiKeyWizard.connectorId')}:</span>{' '}
              <code>{connector.id}</code>
            </div>
            {form.description && (
              <div className="mb-1">
                <span className="text-muted small">{t('dataConnectors.oauth.descriptionLabel')}:</span>{' '}
                {form.description}
              </div>
            )}
            <hr className="my-2" />

            <div className="d-flex align-items-center gap-2 mb-1">
              <span className="text-muted small">{t('dataConnectors.apiKeyWizard.secretLabel')}:</span>
              <code>{configSecretName}</code>
              <span className="badge bg-light text-dark small">
                {t('dataConnectors.apiKeyWizard.metadataOnly', 'metadata only, no credential')}
              </span>
            </div>
            <div className="small text-muted">
              {t(
                'dataConnectors.apiKeyWizard.credentialCapturedInChatHint',
                'Per-user credentials are captured in chat, not here.'
              )}
            </div>
          </div>

          <div className="border rounded p-3 mb-3">
            <Form.Group>
              <Form.Label className="small fw-semibold mb-1">
                {t('dataConnectors.apiKeyWizard.instanceUrlLabel', { defaultValue: 'Instance URL' })}
                <span className="text-muted ms-2" style={{ fontWeight: 400 }}>
                  ({t('dataConnectors.apiKeyWizard.optional', { defaultValue: 'optional' })})
                </span>
              </Form.Label>
              <Form.Control
                type="url"
                placeholder={t('dataConnectors.apiKeyWizard.instanceUrlPlaceholder', {
                  defaultValue: 'https://your-instance.example.com',
                })}
                value={form.instanceUrl}
                onChange={(e) => updateForm({ instanceUrl: e.target.value })}
                isInvalid={instanceUrlError !== null}
                autoComplete="off"
              />
              {instanceUrlError && <Form.Control.Feedback type="invalid">{instanceUrlError}</Form.Control.Feedback>}
              <Form.Text className="text-muted small">
                {t('dataConnectors.apiKeyWizard.instanceUrlHelp', {
                  defaultValue:
                    "Set this only if your connector's API is hosted at a customer-specific address (e.g. a private Synergy 12d server). Leave empty to use the connector's built-in default.",
                })}
              </Form.Text>
            </Form.Group>
          </div>

          <div
            className="d-flex align-items-center gap-2 cursor-pointer mb-2"
            onClick={() => setCustomizeExpanded(!customizeExpanded)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setCustomizeExpanded(!customizeExpanded)}
          >
            <h6 className="fw-semibold small mb-0">{t('dataConnectors.apiReference.customize')}</h6>
            {customizeExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
          <Collapse in={customizeExpanded}>
            <div>
              <Row className="g-3">
                <Col md={12}>
                  <Form.Label className="small fw-semibold">
                    {t('dataConnectors.oauthWizard.rateLimitsLabel')}
                  </Form.Label>
                </Col>
                <Col md={6}>
                  <Form.Group>
                    <Form.Label className="small text-muted">
                      {t('dataConnectors.oauthWizard.rateLimitRpmLabel')}
                    </Form.Label>
                    <Form.Control
                      type="number"
                      placeholder={t('dataConnectors.oauthWizard.rateLimitRpmPlaceholder')}
                      value={form.rateLimitRpm}
                      onChange={(e) => updateForm({ rateLimitRpm: e.target.value })}
                      min={0}
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group>
                    <Form.Label className="small text-muted">
                      {t('dataConnectors.oauthWizard.rateLimitDailyLabel')}
                    </Form.Label>
                    <Form.Control
                      type="number"
                      placeholder={t('dataConnectors.oauthWizard.rateLimitDailyPlaceholder')}
                      value={form.rateLimitDaily}
                      onChange={(e) => updateForm({ rateLimitDaily: e.target.value })}
                      min={0}
                    />
                  </Form.Group>
                </Col>
              </Row>
            </div>
          </Collapse>
        </div>
      )}

      {step === 3 && (
        <div className="text-center py-3">
          <Alert variant="success" className="py-2">
            <i className="bi bi-check-circle me-2"></i>
            {t('dataConnectors.apiKeyWizard.saveSuccess')}
          </Alert>
          <p className="text-muted small">{t('dataConnectors.apiKeyWizard.doneHint')}</p>
        </div>
      )}
    </ConnectorWizardModal>
  );
};
