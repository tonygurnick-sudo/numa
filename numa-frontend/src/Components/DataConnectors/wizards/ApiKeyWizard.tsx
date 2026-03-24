// MERGE: kept dev version — adds Collapse/Chevron imports, collapsible API
//   reference section, setup step rendering, and enriched wizard steps.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Col, Collapse, Form, Row } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { ConnectorWizardModal } from './ConnectorWizardModal';
import type { WizardStep } from './ConnectorWizardModal';
import { createCompanySecret, updateCompanySecret, getCompanySecret } from '../../../Services/VaultService';
import type { VaultSecretMetadata, VaultSecretWithFields } from '../../../Services/VaultService';
import type { ConnectorTemplate } from '../connectorRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiKeyFormState {
  connectorId: string;
  displayName: string;
  icon: string;
  description: string;
  credentials: Record<string, string>;
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
}

interface ApiKeyWizardProps {
  show: boolean;
  onHide: () => void;
  onSaved: () => void;
  connector: ConnectorTemplate;
  existingSecrets: VaultSecretMetadata[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ApiKeyWizard = ({ show, onHide, onSaved, connector, existingSecrets }: ApiKeyWizardProps) => {
  const { t } = useTranslation('integrations');

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [secretExists, setSecretExists] = useState(false);
  const [customizeExpanded, setCustomizeExpanded] = useState(false);

  const secretName = `connector-${connector.id}`;

  const emptyForm = useCallback(
    (): ApiKeyFormState => ({
      connectorId: connector.id,
      displayName: connector.displayName,
      icon: connector.icon,
      description: connector.description,
      credentials: Object.fromEntries((connector.credentialFields || []).map((f) => [f.key, ''])),
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
    }),
    [connector]
  );

  const [form, setForm] = useState<ApiKeyFormState>(emptyForm);

  const updateForm = (partial: Partial<ApiKeyFormState>) => setForm((prev) => ({ ...prev, ...partial }));

  const updateCredential = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, credentials: { ...prev.credentials, [key]: value } }));

  // Helper: find matching company secret
  const getConnectorSecret = useCallback(
    (): VaultSecretMetadata | undefined => existingSecrets.find((s) => s.name === secretName),
    [existingSecrets, secretName]
  );

  // ---------------------------------------------------------------------------
  // Load existing data
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!show) return;

    setStep(1);
    setError(null);
    setSuccess(null);
    setCustomizeExpanded(false);

    const existing = getConnectorSecret();
    if (existing) {
      setSecretExists(true);
      setLoading(true);
      getCompanySecret(existing.name)
        .then((full: VaultSecretWithFields) => {
          const creds: Record<string, string> = {};
          for (const field of connector.credentialFields || []) {
            creds[field.key] = full.fields?.[field.key] || '';
          }
          updateForm({
            ...emptyForm(),
            credentials: creds,
            displayName: full.fields?.display_name || connector.displayName,
            icon: full.fields?.icon || connector.icon,
            description: full.fields?.description || connector.description,
            apiDocsUrl: full.fields?.api_docs_url || connector.apiReference?.docsUrl || '',
            openApiUrl: full.fields?.open_api_url || connector.apiReference?.openApiUrl || '',
            postmanUrl: full.fields?.postman_url || connector.apiReference?.postmanUrl || '',
            mcpServerRef: full.fields?.mcp_server_ref || connector.apiReference?.mcpServerRef || '',
            rateLimitRpm: full.fields?.rate_limit_rpm || connector.rateLimitRpm?.toString() || '',
            rateLimitDaily: full.fields?.rate_limit_daily || connector.rateLimitDaily?.toString() || '',
            purposeHint: full.fields?.purpose_hint || connector.apiReference?.purpose || '',
          });
        })
        .catch(() => {
          setForm(emptyForm());
        })
        .finally(() => setLoading(false));
    } else {
      setSecretExists(false);
      setForm(emptyForm());
    }
  }, [show, connector.id]);

  // ---------------------------------------------------------------------------
  // Steps — compressed to 3: Setup, Review & Save, Done
  // ---------------------------------------------------------------------------

  const steps: WizardStep[] = [
    { id: 'overview', label: t('dataConnectors.oauthWizard.stepOverview') },
    { id: 'credentials', label: t('dataConnectors.oauthWizard.stepCredentialsOnly') },
    { id: 'review', label: t('dataConnectors.apiKeyWizard.stepReviewSave') },
    { id: 'done', label: t('dataConnectors.apiKeyWizard.stepDone') },
  ];

  const canProceed = (() => {
    switch (step) {
      case 1:
        return true;
      case 2: {
        if (secretExists) return true;
        const requiredFields = (connector.credentialFields || []).filter((f) => f.required);
        return requiredFields.every((f) => form.credentials[f.key]?.trim());
      }
      case 3:
        return true;
      case 4:
        return true;
      default:
        return false;
    }
  })();

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const existing = getConnectorSecret();

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

      // Caching policy
      fields.cache_ttl = form.cacheTtl;
      fields.cache_stale_while_revalidate = form.cacheStaleWhileRevalidate ? 'true' : 'false';
      fields.cache_prefetch = form.cachePrefetch ? 'true' : 'false';
      fields.cache_background_refresh = form.cacheBackgroundRefresh;

      // Build API reference JSON blob
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

      if (existing) {
        // Update — include credential fields that have values
        for (const [key, val] of Object.entries(form.credentials)) {
          if (val.trim()) fields[key] = val.trim();
        }
        await updateCompanySecret(existing.name, { fields });
      } else {
        // Create — include all credential fields
        for (const [key, val] of Object.entries(form.credentials)) {
          fields[key] = val.trim();
        }
        await createCompanySecret({
          name: secretName,
          description: `Connector credentials for ${form.displayName.trim() || connector.id}`,
          category: 'Connector Credentials',
          type: 'custom',
          fields,
          help_url: connector.helpUrl || undefined,
        });
        setSecretExists(true);
      }

      setSuccess(t('dataConnectors.apiKeyWizard.saveSuccess'));
      setStep(4);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('dataConnectors.apiKeyWizard.saveError');
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const handleNext = async () => {
    if (step === 3) {
      await handleSave();
      return;
    }
    if (step === 4) {
      onSaved();
      onHide();
      return;
    }
    setError(null);
    setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1 && step < 4) {
      setError(null);
      setStep(step - 1);
    }
  };

  const resetState = () => {
    setStep(1);
    setForm(emptyForm());
    setError(null);
    setSuccess(null);
    setSecretExists(false);
    setCustomizeExpanded(false);
  };

  const handleHide = () => {
    resetState();
    onHide();
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const wizardTitle = t('dataConnectors.apiKeyWizard.title', { connector: connector.displayName });

  return (
    <ConnectorWizardModal
      show={show}
      onHide={handleHide}
      title={wizardTitle}
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
        step === 4 ? t('dataConnectors.wizard.done') : step === 3 ? t('dataConnectors.wizard.save') : undefined
      }
    >
      {/* ── Step 1: Overview (identity, metadata, signup, help) ── */}
      {step === 1 && (
        <div>
          {/* Connector identity header */}
          <div className="d-flex align-items-center gap-3 mb-3 p-3 border rounded">
            <i className={connector.icon} style={{ fontSize: '2rem' }} />
            <div>
              <h5 className="mb-1">{connector.displayName}</h5>
              <p className="text-muted mb-0 small">{connector.description}</p>
            </div>
          </div>
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

          {/* Signup prompt when credentials don't exist */}
          {!secretExists && signupLink && (
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

      {/* ── Step 2: Credentials ── */}
      {step === 2 && (
        <div>
          <Row className="g-3">
            {secretExists ? (
              <Col md={12}>
                <div className="border rounded p-3 mb-2">
                  <div className="d-flex justify-content-between align-items-center">
                    <div>
                      <span className="text-muted small">{t('dataConnectors.apiKeyWizard.secretLabel')}</span>
                      <div>
                        <code>{secretName}</code>
                      </div>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <span className="badge bg-success-subtle text-success">
                        <i className="bi bi-check-circle me-1"></i>
                        {t('dataConnectors.oauthWizard.secretConfigured')}
                      </span>
                      <a
                        href="/vault-secrets"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1"
                      >
                        <ExternalLink size={14} />
                        {t('dataConnectors.oauthWizard.editInVault')}
                      </a>
                    </div>
                  </div>
                </div>
                <Alert variant="info" className="py-2 small mt-2">
                  <i className="bi bi-info-circle me-2"></i>
                  {t('dataConnectors.apiKeyWizard.credentialsExistHint')}
                </Alert>
                {/* Show editable fields for re-entry if desired */}
                {(connector.credentialFields || []).map((field) => (
                  <Form.Group key={field.key} className="mt-3">
                    <Form.Label className="small fw-semibold">{t(field.label)}</Form.Label>
                    <Form.Control
                      type={field.type}
                      placeholder={field.placeholder || ''}
                      value={form.credentials[field.key] || ''}
                      onChange={(e) => updateCredential(field.key, e.target.value)}
                    />
                    {field.helpText && <Form.Text className="text-muted">{t(field.helpText)}</Form.Text>}
                  </Form.Group>
                ))}
              </Col>
            ) : (
              <Col md={12}>
                <Alert variant="info" className="py-2 small">
                  <i className="bi bi-info-circle me-2"></i>
                  {t('dataConnectors.apiKeyWizard.enterCredentials')}
                </Alert>
                {(connector.credentialFields || []).map((field) => (
                  <Form.Group key={field.key} className="mb-3">
                    <Form.Label className="small fw-semibold">
                      {t(field.label)}
                      {field.required && <span className="text-danger ms-1">*</span>}
                    </Form.Label>
                    <Form.Control
                      type={field.type}
                      placeholder={field.placeholder || ''}
                      value={form.credentials[field.key] || ''}
                      onChange={(e) => updateCredential(field.key, e.target.value)}
                      required={field.required}
                    />
                    {field.helpText && <Form.Text className="text-muted">{t(field.helpText)}</Form.Text>}
                  </Form.Group>
                ))}
              </Col>
            )}
          </Row>
        </div>
      )}

      {/* ── Step 3: Review & Save (summary + read-only API reference with optional expand) ── */}
      {step === 3 && (
        <div>
          {/* Review summary */}
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

            <h6 className="fw-semibold small text-muted mb-2">{t('dataConnectors.oauthWizard.reviewCredentials')}</h6>
            <div className="d-flex align-items-center gap-2 mb-1">
              <span className="text-muted small">{t('dataConnectors.apiKeyWizard.secretLabel')}:</span>
              <code>{secretName}</code>
              {secretExists ? (
                <span className="badge bg-success-subtle text-success small">
                  <i className="bi bi-check-circle me-1"></i>
                  {t('dataConnectors.oauthWizard.secretConfigured')}
                </span>
              ) : (
                <span className="badge bg-warning-subtle text-warning small">
                  {t('dataConnectors.oauthWizard.secretNotConfigured')}
                </span>
              )}
            </div>
            {(connector.credentialFields || []).map((field) => (
              <div key={field.key} className="mb-1 small">
                <span className="text-muted">{t(field.label)}:</span>{' '}
                {form.credentials[field.key] ? (
                  field.type === 'password' ? (
                    <span>{t('dataConnectors.oauthWizard.reviewMasked')}</span>
                  ) : (
                    <span>{form.credentials[field.key]}</span>
                  )
                ) : secretExists ? (
                  <span className="text-muted fst-italic">{t('dataConnectors.apiKeyWizard.storedInVault')}</span>
                ) : (
                  <span className="text-muted">{t('dataConnectors.oauthWizard.reviewNotProvided')}</span>
                )}
              </div>
            ))}
          </div>

          {/* Read-only API reference summary */}
          {renderApiReferenceSummary()}

          {/* Customize toggle to show full edit form */}
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

                {/* Caching Settings */}
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

      {/* ── Step 4: Done ── */}
      {step === 4 && (
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
