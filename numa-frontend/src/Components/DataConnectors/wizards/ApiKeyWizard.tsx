import { useCallback, useEffect, useState } from 'react';
import { Alert, Col, Collapse, Form, Row } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
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
  apiDocsUrl: string;
  openApiUrl: string;
  postmanUrl: string;
  mcpServerRef: string;
  rateLimitRpm: string;
  rateLimitDaily: string;
  purposeHint: string;
  cacheTtl: string;
  cacheStaleWhileRevalidate: boolean;
  cachePrefetch: boolean;
  cacheBackgroundRefresh: string;
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
      apiDocsUrl: connector.apiReference?.docsUrl || '',
      openApiUrl: connector.apiReference?.openApiUrl || '',
      postmanUrl: connector.apiReference?.postmanUrl || '',
      mcpServerRef: connector.apiReference?.mcpServerRef || '',
      rateLimitRpm: connector.rateLimitRpm?.toString() || '',
      rateLimitDaily: connector.rateLimitDaily?.toString() || '',
      purposeHint: connector.apiReference?.purpose || '',
      cacheTtl: String(connector.cachingPolicy?.ttl ?? 300),
      cacheStaleWhileRevalidate: (connector.cachingPolicy?.staleWhileRevalidate ?? 600) > 0,
      cachePrefetch: connector.cachingPolicy?.prefetch ?? true,
      cacheBackgroundRefresh: String(connector.cachingPolicy?.backgroundRefresh ?? 0),
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
        apiDocsUrl: fields.api_docs_url || connector.apiReference?.docsUrl || '',
        openApiUrl: fields.open_api_url || connector.apiReference?.openApiUrl || '',
        postmanUrl: fields.postman_url || connector.apiReference?.postmanUrl || '',
        mcpServerRef: fields.mcp_server_ref || connector.apiReference?.mcpServerRef || '',
        rateLimitRpm: fields.rate_limit_rpm || connector.rateLimitRpm?.toString() || '',
        rateLimitDaily: fields.rate_limit_daily || connector.rateLimitDaily?.toString() || '',
        purposeHint: fields.purpose_hint || connector.apiReference?.purpose || '',
        cacheTtl: fields.cache_ttl || String(connector.cachingPolicy?.ttl ?? 300),
        cacheStaleWhileRevalidate:
          fields.cache_stale_while_revalidate != null
            ? fields.cache_stale_while_revalidate === 'true'
            : (connector.cachingPolicy?.staleWhileRevalidate ?? 600) > 0,
        cachePrefetch:
          fields.cache_prefetch != null
            ? fields.cache_prefetch === 'true'
            : (connector.cachingPolicy?.prefetch ?? true),
        cacheBackgroundRefresh:
          fields.cache_background_refresh || String(connector.cachingPolicy?.backgroundRefresh ?? 0),
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

      if (form.apiDocsUrl.trim()) fields.api_docs_url = form.apiDocsUrl.trim();
      if (form.openApiUrl.trim()) fields.open_api_url = form.openApiUrl.trim();
      if (form.postmanUrl.trim()) fields.postman_url = form.postmanUrl.trim();
      if (form.mcpServerRef.trim()) fields.mcp_server_ref = form.mcpServerRef.trim();
      if (form.rateLimitRpm.trim()) fields.rate_limit_rpm = form.rateLimitRpm.trim();
      if (form.rateLimitDaily.trim()) fields.rate_limit_daily = form.rateLimitDaily.trim();
      if (form.purposeHint.trim()) fields.purpose_hint = form.purposeHint.trim();
      if (form.instanceUrl.trim()) fields.instance_url = form.instanceUrl.trim();

      fields.cache_ttl = form.cacheTtl;
      fields.cache_stale_while_revalidate = form.cacheStaleWhileRevalidate ? 'true' : 'false';
      fields.cache_prefetch = form.cachePrefetch ? 'true' : 'false';
      fields.cache_background_refresh = form.cacheBackgroundRefresh;

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

      const apiRef = connector.apiReference;
      if (apiRef) {
        const refBlob = {
          ...apiRef,
          purpose: form.purposeHint.trim() || apiRef.purpose,
          docsUrl: form.apiDocsUrl.trim() || apiRef.docsUrl,
          openApiUrl: form.openApiUrl.trim() || apiRef.openApiUrl,
          postmanUrl: form.postmanUrl.trim() || apiRef.postmanUrl,
          mcpServerRef: form.mcpServerRef.trim() || apiRef.mcpServerRef,
        };
        fields.api_reference = JSON.stringify(refBlob);
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
          help_url: connector.helpUrl || undefined,
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

  const signupLink = connector.signupUrl || connector.helpUrl;
  const apiRef = connector.apiReference;

  const renderApiReferenceSummary = () => {
    if (!apiRef) return null;
    return (
      <div className="border rounded p-3 mb-3">
        <div className="d-flex align-items-center gap-2 mb-2">
          <h6 className="fw-semibold small text-muted mb-0">{t('dataConnectors.apiReference.title')}</h6>
          <span className="badge bg-success-subtle text-success small">
            <i className="bi bi-check-circle me-1"></i>
            {t('dataConnectors.apiReference.autoConfigured')}
          </span>
        </div>
        {apiRef.purpose && <p className="small text-muted mb-2">{apiRef.purpose}</p>}
        {apiRef.dataTypes && apiRef.dataTypes.length > 0 && (
          <div className="mb-2">
            <span className="small text-muted me-2">{t('dataConnectors.apiReference.dataTypesLabel')}:</span>
            {apiRef.dataTypes.map((dt) => (
              <span key={dt} className="badge bg-light text-dark me-1" style={{ fontSize: '0.7rem' }}>
                {dt}
              </span>
            ))}
          </div>
        )}
        {apiRef.capabilities && apiRef.capabilities.length > 0 && (
          <div className="mb-2">
            <span className="small text-muted me-2">{t('dataConnectors.apiReference.capabilitiesLabel')}:</span>
            {apiRef.capabilities.map((cap) => (
              <span key={cap} className="badge bg-primary-subtle text-primary me-1" style={{ fontSize: '0.7rem' }}>
                {cap}
              </span>
            ))}
          </div>
        )}
        <div className="d-flex flex-wrap gap-2">
          {(form.apiDocsUrl || apiRef.docsUrl) && (
            <a
              href={form.apiDocsUrl || apiRef.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="small d-inline-flex align-items-center gap-1"
            >
              <ExternalLink size={12} />
              {t('dataConnectors.apiReference.docsUrl')}
            </a>
          )}
          {(form.openApiUrl || apiRef.openApiUrl) && (
            <a
              href={form.openApiUrl || apiRef.openApiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="small d-inline-flex align-items-center gap-1"
            >
              <ExternalLink size={12} />
              {t('dataConnectors.apiReference.openApiUrl')}
            </a>
          )}
          {(form.postmanUrl || apiRef.postmanUrl) && (
            <a
              href={form.postmanUrl || apiRef.postmanUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="small d-inline-flex align-items-center gap-1"
            >
              <ExternalLink size={12} />
              {t('dataConnectors.apiReference.postmanUrl')}
            </a>
          )}
        </div>
        {(connector.rateLimitRpm || connector.rateLimitDaily) && (
          <div className="mt-2 small text-muted">
            {connector.rateLimitRpm && (
              <span className="me-3">
                {t('dataConnectors.oauthWizard.reviewRpm', { count: connector.rateLimitRpm })}
              </span>
            )}
            {connector.rateLimitDaily && (
              <span>{t('dataConnectors.oauthWizard.reviewDaily', { count: connector.rateLimitDaily })}</span>
            )}
          </div>
        )}
      </div>
    );
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

          {signupLink && (
            <Alert variant="light" className="py-2 small border d-flex align-items-center gap-2">
              <i className="bi bi-info-circle"></i>
              <span>{t('dataConnectors.signup.noAccount')}</span>
              <a
                href={signupLink}
                target="_blank"
                rel="noopener noreferrer"
                className="d-inline-flex align-items-center gap-1"
              >
                <ExternalLink size={12} />
                {t('dataConnectors.signup.signUp', { provider: connector.displayName })}
              </a>
            </Alert>
          )}

          {connector.helpUrl && (
            <a
              href={connector.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="d-inline-flex align-items-center gap-1 small"
            >
              <ExternalLink size={14} />
              {t('dataConnectors.oauth.helpLink')}
            </a>
          )}
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

          {renderApiReferenceSummary()}

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
                  <Form.Group>
                    <Form.Label className="small fw-semibold">{t('dataConnectors.apiReference.docsUrl')}</Form.Label>
                    <Form.Control
                      type="url"
                      placeholder={t('dataConnectors.apiReference.docsUrlPlaceholder')}
                      value={form.apiDocsUrl}
                      onChange={(e) => updateForm({ apiDocsUrl: e.target.value })}
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group>
                    <Form.Label className="small fw-semibold">{t('dataConnectors.apiReference.openApiUrl')}</Form.Label>
                    <Form.Control
                      type="url"
                      placeholder={t('dataConnectors.apiReference.openApiUrlPlaceholder')}
                      value={form.openApiUrl}
                      onChange={(e) => updateForm({ openApiUrl: e.target.value })}
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group>
                    <Form.Label className="small fw-semibold">{t('dataConnectors.apiReference.postmanUrl')}</Form.Label>
                    <Form.Control
                      type="url"
                      placeholder={t('dataConnectors.apiReference.postmanUrlPlaceholder')}
                      value={form.postmanUrl}
                      onChange={(e) => updateForm({ postmanUrl: e.target.value })}
                    />
                  </Form.Group>
                </Col>
                <Col md={12}>
                  <Form.Group>
                    <Form.Label className="small fw-semibold">
                      {t('dataConnectors.apiReference.mcpServerRef')}
                    </Form.Label>
                    <Form.Control
                      type="text"
                      placeholder={t('dataConnectors.apiReference.mcpServerRefPlaceholder')}
                      value={form.mcpServerRef}
                      onChange={(e) => updateForm({ mcpServerRef: e.target.value })}
                    />
                  </Form.Group>
                </Col>
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
                <Col md={12}>
                  <Form.Group>
                    <Form.Label className="small fw-semibold">
                      {t('dataConnectors.apiReference.purposeHint')}
                    </Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={2}
                      placeholder={t('dataConnectors.apiReference.purposeHintPlaceholder')}
                      value={form.purposeHint}
                      onChange={(e) => updateForm({ purposeHint: e.target.value })}
                    />
                    <Form.Text className="text-muted">{t('dataConnectors.apiReference.purposeHintDesc')}</Form.Text>
                  </Form.Group>
                </Col>

                <Col md={12} className="mt-3">
                  <h6 className="fw-semibold small text-muted mb-2">
                    {t('dataConnectors.oauth.cachingSettings', 'Caching Settings')}
                  </h6>
                </Col>
                <Col md={6}>
                  <Form.Group>
                    <Form.Label className="small fw-semibold">
                      {t('dataConnectors.oauth.cacheTtl', 'Cache Duration')}
                    </Form.Label>
                    <Form.Select value={form.cacheTtl} onChange={(e) => updateForm({ cacheTtl: e.target.value })}>
                      <option value="60">{t('dataConnectors.cache.1min', '1 minute (email)')}</option>
                      <option value="300">{t('dataConnectors.cache.5min', '5 minutes (files)')}</option>
                      <option value="1800">{t('dataConnectors.cache.30min', '30 minutes (projects)')}</option>
                      <option value="3600">{t('dataConnectors.cache.1hr', '1 hour')}</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group>
                    <Form.Label className="small fw-semibold">
                      {t('dataConnectors.oauth.backgroundRefresh', 'Background Refresh')}
                    </Form.Label>
                    <Form.Select
                      value={form.cacheBackgroundRefresh}
                      onChange={(e) => updateForm({ cacheBackgroundRefresh: e.target.value })}
                    >
                      <option value="0">{t('dataConnectors.cache.off', 'Off')}</option>
                      <option value="60">{t('dataConnectors.cache.every1min', 'Every 1 minute')}</option>
                      <option value="300">{t('dataConnectors.cache.every5min', 'Every 5 minutes')}</option>
                      <option value="1800">{t('dataConnectors.cache.every30min', 'Every 30 minutes')}</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Check
                    type="checkbox"
                    label={t('dataConnectors.oauth.staleWhileRevalidate', 'Serve stale while refreshing')}
                    checked={form.cacheStaleWhileRevalidate}
                    onChange={(e) => updateForm({ cacheStaleWhileRevalidate: e.target.checked })}
                    className="mt-2"
                  />
                </Col>
                <Col md={6}>
                  <Form.Check
                    type="checkbox"
                    label={t('dataConnectors.oauth.prefetch', 'Auto-prefetch subfolders')}
                    checked={form.cachePrefetch}
                    onChange={(e) => updateForm({ cachePrefetch: e.target.checked })}
                    className="mt-2"
                  />
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
