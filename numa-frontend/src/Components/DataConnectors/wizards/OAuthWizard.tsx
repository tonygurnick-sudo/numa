import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Col, Collapse, Form, Row, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Copy, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { ConnectorWizardModal } from './ConnectorWizardModal';
import type { WizardStep } from './ConnectorWizardModal';
import { PROVIDER_SCOPES, buildScopeString, parseScopeString, getDefaultScopeIds } from './oauthScopeDefinitions';
import { createCompanySecret, updateCompanySecret, getCompanySecret } from '../../../Services/VaultService';
import { OAuthProvidersService } from '../../../Services/OAuthProvidersService';
import type { VaultSecretMetadata, VaultSecretWithFields } from '../../../Services/VaultService';
import type { OAuthProviderInfo } from '../../../types/oauthProviders';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderTemplate {
  id: string;
  displayName: string;
  icon: string;
  description: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string;
  extraAuthParams: string;
  helpUrl: string;
  discoveryUrl?: string;
}

interface CustomHeader {
  name: string;
  value: string;
}

interface OAuthFormState {
  template: string;
  providerId: string;
  displayName: string;
  icon: string;
  description: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string;
  selectedScopeIds: string[];
  extraAuthParams: string;
  clientId: string;
  clientSecret: string;
  helpUrl: string;
  apiDocsUrl: string;
  rateLimitRpm: string;
  rateLimitDaily: string;
  customHeaders: CustomHeader[];
}

interface OAuthWizardProps {
  show: boolean;
  onHide: () => void;
  onSaved: () => void;
  providerId?: string;
  isNew: boolean;
  templates: ProviderTemplate[];
  existingSecrets: VaultSecretMetadata[];
  mergedProviders: OAuthProviderInfo[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_ID_REGEX = /^[a-z][a-z0-9-]*$/;

// ---------------------------------------------------------------------------
// Auto-discovery from OpenID Connect well-known endpoint
// ---------------------------------------------------------------------------

interface DiscoveryResult {
  authUrl?: string;
  tokenUrl?: string;
}

async function discoverOAuthConfig(discoveryUrl: string): Promise<DiscoveryResult> {
  try {
    const response = await fetch(discoveryUrl, { method: 'GET' });
    if (!response.ok) return {};
    const data = await response.json();
    return {
      authUrl: data.authorization_endpoint || undefined,
      tokenUrl: data.token_endpoint || undefined,
    };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const OAuthWizard = ({
  show,
  onHide,
  onSaved,
  providerId: editingProviderId,
  isNew,
  templates,
  existingSecrets,
  mergedProviders,
}: OAuthWizardProps) => {
  const { t } = useTranslation('integrations');

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [providerIdError, setProviderIdError] = useState<string | null>(null);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [testResult, setTestResult] = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const [secretExists, setSecretExists] = useState(false);

  const emptyForm: OAuthFormState = {
    template: 'custom',
    providerId: '',
    displayName: '',
    icon: 'bi-cloud',
    description: '',
    authUrl: '',
    tokenUrl: '',
    scopes: '',
    selectedScopeIds: [],
    extraAuthParams: '',
    clientId: '',
    clientSecret: '',
    helpUrl: '',
    apiDocsUrl: '',
    rateLimitRpm: '',
    rateLimitDaily: '',
    customHeaders: [],
  };

  const [form, setForm] = useState<OAuthFormState>(emptyForm);

  const updateForm = (partial: Partial<OAuthFormState>) => setForm((prev) => ({ ...prev, ...partial }));

  // Helper: find matching company secret
  const getProviderSecret = useCallback(
    (pid: string): VaultSecretMetadata | undefined => existingSecrets.find((s) => s.name === `oauth-client-${pid}`),
    [existingSecrets]
  );

  // ---------------------------------------------------------------------------
  // Load existing data when editing
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!show) return;

    // Reset state
    setStep(1);
    setError(null);
    setSuccess(null);
    setTestResult('idle');
    setTestError(null);
    setAdvancedExpanded(false);

    if (isNew) {
      setForm(emptyForm);
      setSecretExists(false);
      setAdvancedExpanded(true);
      return;
    }

    if (!editingProviderId) return;

    // Pre-fill from template
    const tpl = templates.find((t) => t.id === editingProviderId);
    const info = mergedProviders.find((p) => p.id === editingProviderId);

    const baseForm: Partial<OAuthFormState> = {
      template: tpl ? tpl.id : 'custom',
      providerId: editingProviderId,
      displayName: info?.display_name || tpl?.displayName || '',
      icon: info?.icon || tpl?.icon || 'bi-cloud',
      description: info?.description || tpl?.description || '',
      authUrl: tpl?.authUrl || '',
      tokenUrl: tpl?.tokenUrl || '',
      scopes: tpl?.scopes || '',
      extraAuthParams: tpl?.extraAuthParams || '',
      helpUrl: tpl?.helpUrl || '',
    };

    // Set default scopes from definitions if available
    const scopeDefsLocal = PROVIDER_SCOPES[editingProviderId];
    if (scopeDefsLocal) {
      baseForm.selectedScopeIds = getDefaultScopeIds(editingProviderId);
    }

    // Check if vault secret already exists
    const existing = getProviderSecret(editingProviderId);
    if (existing) {
      setSecretExists(true);
      setLoading(true);
      getCompanySecret(existing.name)
        .then((full: VaultSecretWithFields) => {
          // Load non-credential fields only — credentials stay in vault
          updateForm({
            ...baseForm,
            authUrl: full.fields?.auth_url || baseForm.authUrl || '',
            tokenUrl: full.fields?.token_url || baseForm.tokenUrl || '',
            scopes: full.fields?.scopes || baseForm.scopes || '',
            selectedScopeIds: scopeDefsLocal
              ? parseScopeString(editingProviderId, full.fields?.scopes || baseForm.scopes || '')
              : [],
            extraAuthParams: full.fields?.extra_auth_params || baseForm.extraAuthParams || '',
            displayName: full.fields?.display_name || baseForm.displayName || '',
            icon: full.fields?.icon || baseForm.icon || '',
            description: full.fields?.description || baseForm.description || '',
            apiDocsUrl: full.fields?.api_docs_url || '',
            rateLimitRpm: full.fields?.rate_limit_rpm || '',
            rateLimitDaily: full.fields?.rate_limit_daily || '',
            customHeaders: parseCustomHeaders(full.fields?.custom_headers),
          });
        })
        .catch(() => {
          updateForm(baseForm);
        })
        .finally(() => setLoading(false));

      // Run auto-discovery in parallel to confirm/update endpoints
      if (tpl?.discoveryUrl) {
        discoverOAuthConfig(tpl.discoveryUrl).then((discovered) => {
          if (discovered.authUrl || discovered.tokenUrl) {
            updateForm({
              ...(discovered.authUrl ? { authUrl: discovered.authUrl } : {}),
              ...(discovered.tokenUrl ? { tokenUrl: discovered.tokenUrl } : {}),
            });
          }
        });
      }
    } else {
      setSecretExists(false);
      setForm({ ...emptyForm, ...baseForm });

      // Run auto-discovery for new providers with a template
      if (tpl?.discoveryUrl) {
        discoverOAuthConfig(tpl.discoveryUrl).then((discovered) => {
          if (discovered.authUrl || discovered.tokenUrl) {
            updateForm({
              ...(discovered.authUrl ? { authUrl: discovered.authUrl } : {}),
              ...(discovered.tokenUrl ? { tokenUrl: discovered.tokenUrl } : {}),
            });
          }
        });
      }
    }
  }, [show, editingProviderId, isNew]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const effectiveProviderId = editingProviderId || form.providerId;
  const frontendBaseUrl = window.location.origin;
  const scopeDefs = PROVIDER_SCOPES[effectiveProviderId];
  const secretName = effectiveProviderId ? `oauth-client-${effectiveProviderId}` : '';

  const steps: WizardStep[] = [
    { id: 'basic', label: t('dataConnectors.oauthWizard.stepBasicInfo') },
    { id: 'creds', label: t('dataConnectors.oauthWizard.stepCredentials') },
    { id: 'advanced', label: t('dataConnectors.oauthWizard.stepAdvanced') },
    { id: 'review', label: t('dataConnectors.oauthWizard.stepReview') },
    { id: 'test', label: t('dataConnectors.oauthWizard.stepTest') },
  ];

  const validateProviderId = (id: string): string | null => {
    if (!id) return null;
    if (!PROVIDER_ID_REGEX.test(id)) return t('dataConnectors.oauth.providerIdInvalid');
    if (isNew && mergedProviders.some((p) => p.id === id)) return t('dataConnectors.oauth.providerIdTaken');
    return null;
  };

  const canProceed = (() => {
    switch (step) {
      case 1:
        return form.providerId.trim().length > 0 && form.displayName.trim().length > 0 && !providerIdError;
      case 2:
        // If secret exists, credentials are already in vault — always can proceed
        // If new, need client_id and client_secret
        return secretExists || (form.clientId.trim().length > 0 && form.clientSecret.trim().length > 0);
      case 3:
        return true;
      case 4:
        return true;
      case 5:
        return true;
      default:
        return false;
    }
  })();

  // ---------------------------------------------------------------------------
  // Template application with auto-discovery
  // ---------------------------------------------------------------------------

  const applyTemplate = (templateId: string) => {
    updateForm({ template: templateId });
    if (templateId === 'custom') {
      setAdvancedExpanded(true);
      return;
    }
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    const scopeIds = getDefaultScopeIds(tpl.id);
    updateForm({
      providerId: tpl.id,
      displayName: tpl.displayName,
      icon: tpl.icon,
      description: tpl.description,
      authUrl: tpl.authUrl,
      tokenUrl: tpl.tokenUrl,
      scopes: tpl.scopes,
      selectedScopeIds: scopeIds.length > 0 ? scopeIds : [],
      extraAuthParams: tpl.extraAuthParams,
      helpUrl: tpl.helpUrl,
    });
    setAdvancedExpanded(false);

    // Check if secret already exists for this template
    const existing = getProviderSecret(tpl.id);
    setSecretExists(!!existing);

    // Auto-discover OAuth endpoints
    if (tpl.discoveryUrl) {
      discoverOAuthConfig(tpl.discoveryUrl).then((discovered) => {
        if (discovered.authUrl || discovered.tokenUrl) {
          updateForm({
            ...(discovered.authUrl ? { authUrl: discovered.authUrl } : {}),
            ...(discovered.tokenUrl ? { tokenUrl: discovered.tokenUrl } : {}),
          });
        }
      });
    }
  };

  // ---------------------------------------------------------------------------
  // Scope toggle
  // ---------------------------------------------------------------------------

  const toggleScope = (scopeId: string) => {
    setForm((prev) => {
      const ids = prev.selectedScopeIds.includes(scopeId)
        ? prev.selectedScopeIds.filter((id) => id !== scopeId)
        : [...prev.selectedScopeIds, scopeId];
      return { ...prev, selectedScopeIds: ids };
    });
  };

  // ---------------------------------------------------------------------------
  // Custom headers
  // ---------------------------------------------------------------------------

  const addHeader = () => updateForm({ customHeaders: [...form.customHeaders, { name: '', value: '' }] });

  const removeHeader = (index: number) =>
    updateForm({ customHeaders: form.customHeaders.filter((_, i) => i !== index) });

  const updateHeader = (index: number, field: 'name' | 'value', val: string) =>
    updateForm({
      customHeaders: form.customHeaders.map((h, i) => (i === index ? { ...h, [field]: val } : h)),
    });

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const pid = form.providerId.trim();
      const sName = `oauth-client-${pid}`;
      const existing = getProviderSecret(pid);

      // Build scopes string from checkboxes or raw input
      const scopeString = scopeDefs ? buildScopeString(pid, form.selectedScopeIds) : form.scopes.trim();

      // Non-credential config fields
      const fields: Record<string, string> = {
        auth_url: form.authUrl.trim(),
        token_url: form.tokenUrl.trim(),
        scopes: scopeString,
        display_name: form.displayName.trim(),
        icon: form.icon.trim(),
        description: form.description.trim(),
      };

      if (form.extraAuthParams.trim()) fields.extra_auth_params = form.extraAuthParams.trim();
      if (form.apiDocsUrl.trim()) fields.api_docs_url = form.apiDocsUrl.trim();
      if (form.rateLimitRpm.trim()) fields.rate_limit_rpm = form.rateLimitRpm.trim();
      if (form.rateLimitDaily.trim()) fields.rate_limit_daily = form.rateLimitDaily.trim();

      const validHeaders = form.customHeaders.filter((h) => h.name.trim() && h.value.trim());
      if (validHeaders.length > 0) {
        fields.custom_headers = JSON.stringify(
          Object.fromEntries(validHeaders.map((h) => [h.name.trim(), h.value.trim()]))
        );
      }

      if (existing) {
        // Update existing secret — do NOT overwrite client_id/client_secret
        await updateCompanySecret(existing.name, { fields });
      } else {
        // Creating new — include credentials
        fields.client_id = form.clientId.trim();
        fields.client_secret = form.clientSecret.trim();
        await createCompanySecret({
          name: sName,
          description: `OAuth client credentials for ${form.displayName.trim() || pid}`,
          category: 'OAuth Clients',
          type: 'custom',
          fields,
          help_url: form.helpUrl.trim() || undefined,
        });
        setSecretExists(true);
      }

      OAuthProvidersService.clearProvidersCache();
      setSuccess(t('dataConnectors.oauthWizard.saveSuccess'));
      setStep(5);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('dataConnectors.oauthWizard.saveError');
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Test connection
  // ---------------------------------------------------------------------------

  const handleTest = async () => {
    setTestResult('running');
    setTestError(null);
    try {
      const result = await OAuthProvidersService.connect(effectiveProviderId);
      if (result.success) {
        setTestResult('success');
      } else {
        setTestResult('failed');
        setTestError(result.error || 'Unknown error');
      }
    } catch (err) {
      setTestResult('failed');
      setTestError(err instanceof Error ? err.message : 'Connection test failed');
    }
  };

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const handleNext = async () => {
    if (step === 1) {
      const idError = validateProviderId(form.providerId);
      if (idError) {
        setProviderIdError(idError);
        return;
      }
    }

    if (step === 2 && form.extraAuthParams.trim()) {
      try {
        JSON.parse(form.extraAuthParams.trim());
      } catch {
        setError(t('dataConnectors.oauth.extraAuthParamsHint'));
        return;
      }
    }

    if (step === 4) {
      await handleSave();
      return;
    }

    if (step === 5) {
      onSaved();
      resetState();
      return;
    }

    setError(null);
    setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1 && step < 5) {
      setError(null);
      setStep(step - 1);
    }
  };

  const resetState = () => {
    setStep(1);
    setForm(emptyForm);
    setError(null);
    setSuccess(null);
    setProviderIdError(null);
    setAdvancedExpanded(false);
    setTestResult('idle');
    setTestError(null);
    setSecretExists(false);
  };

  const handleHide = () => {
    resetState();
    onHide();
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const wizardTitle = isNew
    ? t('dataConnectors.oauthWizard.newTitle')
    : t('dataConnectors.oauthWizard.title', { provider: form.displayName || effectiveProviderId });

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
    >
      {/* ── Step 1: Basic Info ── */}
      {step === 1 && (
        <Row className="g-3">
          {isNew && (
            <Col md={12}>
              <Form.Group>
                <Form.Label className="small fw-semibold">{t('dataConnectors.oauth.providerTemplate')}</Form.Label>
                <Form.Select value={form.template} onChange={(e) => applyTemplate(e.target.value)}>
                  <option value="custom">{t('dataConnectors.oauth.templateCustom')}</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.displayName}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
          )}
          <Col md={6}>
            <Form.Group>
              <Form.Label className="small fw-semibold">{t('dataConnectors.oauth.providerIdLabel')}</Form.Label>
              <Form.Control
                type="text"
                placeholder={t('dataConnectors.oauth.providerIdPlaceholder')}
                value={form.providerId}
                onChange={(e) => {
                  updateForm({ providerId: e.target.value });
                  setProviderIdError(null);
                }}
                isInvalid={!!providerIdError}
                required
                readOnly={!isNew || form.template !== 'custom'}
              />
              <Form.Control.Feedback type="invalid">{providerIdError}</Form.Control.Feedback>
              <Form.Text className="text-muted">{t('dataConnectors.oauth.providerIdHint')}</Form.Text>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label className="small fw-semibold">{t('dataConnectors.oauth.displayName')}</Form.Label>
              <Form.Control
                type="text"
                placeholder={t('dataConnectors.oauth.displayNamePlaceholder')}
                value={form.displayName}
                onChange={(e) => updateForm({ displayName: e.target.value })}
                required
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label className="small fw-semibold">{t('dataConnectors.oauth.iconClass')}</Form.Label>
              <div className="d-flex gap-2 align-items-center">
                <i className={form.icon} style={{ fontSize: '1.25rem', minWidth: '1.5rem' }} />
                <Form.Control
                  type="text"
                  placeholder={t('dataConnectors.oauth.iconClassPlaceholder')}
                  value={form.icon}
                  onChange={(e) => updateForm({ icon: e.target.value })}
                />
              </div>
              <Form.Text className="text-muted">{t('dataConnectors.oauth.iconClassHint')}</Form.Text>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label className="small fw-semibold">{t('dataConnectors.oauth.descriptionLabel')}</Form.Label>
              <Form.Control
                type="text"
                placeholder={t('dataConnectors.oauth.descriptionPlaceholder')}
                value={form.description}
                onChange={(e) => updateForm({ description: e.target.value })}
              />
            </Form.Group>
          </Col>
        </Row>
      )}

      {/* ── Step 2: Credentials & Scopes ── */}
      {step === 2 && (
        <Row className="g-3">
          {/* Credentials section */}
          <Col md={12}>
            {secretExists ? (
              <div className="border rounded p-3 mb-2">
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <span className="text-muted small">{t('dataConnectors.oauthWizard.secretName')}</span>
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
            ) : (
              <>
                <Alert variant="info" className="py-2 small">
                  <i className="bi bi-info-circle me-2"></i>
                  {t('dataConnectors.oauthWizard.enterCredentials')}
                </Alert>
                <Form.Group className="mb-3">
                  <Form.Label className="small fw-semibold">{t('dataConnectors.oauth.clientId')}</Form.Label>
                  <Form.Control
                    type="text"
                    placeholder={t('dataConnectors.oauth.clientIdPlaceholder')}
                    value={form.clientId}
                    onChange={(e) => updateForm({ clientId: e.target.value })}
                    required
                  />
                </Form.Group>
                <Form.Group>
                  <Form.Label className="small fw-semibold">{t('dataConnectors.oauth.clientSecret')}</Form.Label>
                  <Form.Control
                    type="password"
                    placeholder={t('dataConnectors.oauth.clientSecretPlaceholder')}
                    value={form.clientSecret}
                    onChange={(e) => updateForm({ clientSecret: e.target.value })}
                    required
                  />
                </Form.Group>
              </>
            )}
          </Col>

          {/* Scopes: friendly checkboxes for known providers, raw input for custom */}
          <Col md={12}>
            {scopeDefs ? (
              <Form.Group>
                <Form.Label className="small fw-semibold">{t('dataConnectors.oauthWizard.scopesLabel')}</Form.Label>
                <Form.Text className="d-block text-muted mb-2">{t('dataConnectors.oauthWizard.scopesHint')}</Form.Text>
                {scopeDefs.map((scope) => (
                  <Form.Check
                    key={scope.id}
                    type="checkbox"
                    id={`scope-${scope.id}`}
                    className="mb-2"
                    label={
                      <span>
                        <strong>{scope.label}</strong>
                        <span className="text-muted ms-2 small">— {scope.description}</span>
                      </span>
                    }
                    checked={form.selectedScopeIds.includes(scope.id)}
                    onChange={() => toggleScope(scope.id)}
                  />
                ))}
              </Form.Group>
            ) : (
              <Form.Group>
                <Form.Label className="small fw-semibold">{t('dataConnectors.oauthWizard.scopesRawLabel')}</Form.Label>
                <Form.Control
                  type="text"
                  placeholder={t('dataConnectors.oauthWizard.scopesRawPlaceholder')}
                  value={form.scopes}
                  onChange={(e) => updateForm({ scopes: e.target.value })}
                />
              </Form.Group>
            )}
          </Col>

          {/* Advanced OAuth settings (collapsible) */}
          <Col md={12}>
            <div
              className="d-flex align-items-center gap-2 cursor-pointer"
              onClick={() => setAdvancedExpanded(!advancedExpanded)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setAdvancedExpanded(!advancedExpanded)}
            >
              <h6 className="fw-semibold mb-0">{t('dataConnectors.oauthWizard.advancedOauth')}</h6>
              {advancedExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </Col>
          <Collapse in={advancedExpanded}>
            <div>
              <Row className="g-3">
                <Col md={12}>
                  <Form.Group>
                    <Form.Label className="small fw-semibold">{t('dataConnectors.oauth.authUrl')}</Form.Label>
                    <Form.Control
                      type="url"
                      placeholder={t('dataConnectors.oauth.authUrlPlaceholder')}
                      value={form.authUrl}
                      onChange={(e) => updateForm({ authUrl: e.target.value })}
                    />
                  </Form.Group>
                </Col>
                <Col md={12}>
                  <Form.Group>
                    <Form.Label className="small fw-semibold">{t('dataConnectors.oauth.tokenUrl')}</Form.Label>
                    <Form.Control
                      type="url"
                      placeholder={t('dataConnectors.oauth.tokenUrlPlaceholder')}
                      value={form.tokenUrl}
                      onChange={(e) => updateForm({ tokenUrl: e.target.value })}
                    />
                  </Form.Group>
                </Col>
                <Col md={12}>
                  <Form.Group>
                    <Form.Label className="small fw-semibold">{t('dataConnectors.oauth.extraAuthParams')}</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={2}
                      placeholder={t('dataConnectors.oauth.extraAuthParamsPlaceholder')}
                      value={form.extraAuthParams}
                      onChange={(e) => updateForm({ extraAuthParams: e.target.value })}
                    />
                    <Form.Text className="text-muted">{t('dataConnectors.oauth.extraAuthParamsHint')}</Form.Text>
                  </Form.Group>
                </Col>
              </Row>
            </div>
          </Collapse>

          {/* Redirect URI */}
          <Col md={12}>
            <Form.Group>
              <Form.Label className="small fw-semibold">{t('dataConnectors.oauth.redirectUri')}</Form.Label>
              <div className="d-flex gap-2">
                <Form.Control
                  type="text"
                  readOnly
                  value={effectiveProviderId ? `${frontendBaseUrl}/oauth/callback/${effectiveProviderId}` : ''}
                  onClick={(e) => {
                    (e.target as HTMLInputElement).select();
                    navigator.clipboard.writeText((e.target as HTMLInputElement).value).catch(() => {});
                  }}
                  style={{ cursor: 'pointer' }}
                />
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={() => {
                    const uri = effectiveProviderId ? `${frontendBaseUrl}/oauth/callback/${effectiveProviderId}` : '';
                    navigator.clipboard.writeText(uri).catch(() => {});
                  }}
                  title="Copy"
                >
                  <Copy size={14} />
                </Button>
              </div>
              <Form.Text className="text-muted">{t('dataConnectors.oauth.redirectUriHint')}</Form.Text>
            </Form.Group>
          </Col>

          {form.helpUrl && (
            <Col md={12}>
              <a
                href={form.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="d-inline-flex align-items-center gap-1 small"
              >
                <ExternalLink size={14} />
                {t('dataConnectors.oauth.helpLink')}
              </a>
            </Col>
          )}
        </Row>
      )}

      {/* ── Step 3: API Docs & Advanced ── */}
      {step === 3 && (
        <Row className="g-3">
          <Col md={12}>
            <Form.Group>
              <Form.Label className="small fw-semibold">{t('dataConnectors.oauthWizard.apiDocsUrlLabel')}</Form.Label>
              <Form.Control
                type="url"
                placeholder={t('dataConnectors.oauthWizard.apiDocsUrlPlaceholder')}
                value={form.apiDocsUrl}
                onChange={(e) => updateForm({ apiDocsUrl: e.target.value })}
              />
              <Form.Text className="text-muted">{t('dataConnectors.oauthWizard.apiDocsUrlHint')}</Form.Text>
            </Form.Group>
          </Col>

          {/* Rate Limits */}
          <Col md={12}>
            <Form.Label className="small fw-semibold">{t('dataConnectors.oauthWizard.rateLimitsLabel')}</Form.Label>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label className="small text-muted">{t('dataConnectors.oauthWizard.rateLimitRpmLabel')}</Form.Label>
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

          {/* Custom Headers */}
          <Col md={12}>
            <Form.Label className="small fw-semibold">{t('dataConnectors.oauthWizard.customHeadersLabel')}</Form.Label>
            <Form.Text className="d-block text-muted mb-2">
              {t('dataConnectors.oauthWizard.customHeadersHint')}
            </Form.Text>
            {form.customHeaders.map((header, i) => (
              <div key={i} className="d-flex gap-2 mb-2">
                <Form.Control
                  type="text"
                  placeholder={t('dataConnectors.oauthWizard.headerNamePlaceholder')}
                  value={header.name}
                  onChange={(e) => updateHeader(i, 'name', e.target.value)}
                  className="flex-grow-1"
                />
                <Form.Control
                  type="text"
                  placeholder={t('dataConnectors.oauthWizard.headerValuePlaceholder')}
                  value={header.value}
                  onChange={(e) => updateHeader(i, 'value', e.target.value)}
                  className="flex-grow-1"
                />
                <Button variant="outline-danger" size="sm" onClick={() => removeHeader(i)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
            <Button variant="outline-secondary" size="sm" onClick={addHeader}>
              <Plus size={14} className="me-1" />
              {t('dataConnectors.oauthWizard.addHeader')}
            </Button>
          </Col>
        </Row>
      )}

      {/* ── Step 4: Review ── */}
      {step === 4 && (
        <div>
          <div className="border rounded p-3 mb-3">
            {/* Basic Info */}
            <h6 className="fw-semibold small text-muted mb-2">{t('dataConnectors.oauthWizard.reviewBasicInfo')}</h6>
            <div className="mb-1">
              <span className="text-muted small">{t('dataConnectors.oauth.displayName')}:</span>{' '}
              <strong>{form.displayName}</strong>
            </div>
            <div className="mb-1">
              <span className="text-muted small">{t('dataConnectors.oauth.providerIdLabel')}:</span>{' '}
              <code>{form.providerId}</code>
            </div>
            {form.description && (
              <div className="mb-1">
                <span className="text-muted small">{t('dataConnectors.oauth.descriptionLabel')}:</span>{' '}
                {form.description}
              </div>
            )}
            <hr className="my-2" />

            {/* Credentials — vault reference only, no values shown */}
            <h6 className="fw-semibold small text-muted mb-2">{t('dataConnectors.oauthWizard.reviewCredentials')}</h6>
            <div className="d-flex align-items-center gap-2 mb-1">
              <span className="text-muted small">{t('dataConnectors.oauthWizard.secretName')}:</span>
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
              <a
                href="/vault-secrets"
                target="_blank"
                rel="noopener noreferrer"
                className="small d-inline-flex align-items-center gap-1"
              >
                <ExternalLink size={12} />
                {t('dataConnectors.oauthWizard.viewInVault')}
              </a>
            </div>
            <hr className="my-2" />

            {/* Scopes */}
            <h6 className="fw-semibold small text-muted mb-2">{t('dataConnectors.oauthWizard.reviewScopes')}</h6>
            {scopeDefs ? (
              <ul className="mb-0 ps-3 small">
                {scopeDefs
                  .filter((s) => form.selectedScopeIds.includes(s.id))
                  .map((s) => (
                    <li key={s.id}>{s.label}</li>
                  ))}
              </ul>
            ) : (
              <div className="small">{form.scopes || t('dataConnectors.oauthWizard.reviewNone')}</div>
            )}
            <hr className="my-2" />

            {/* OAuth Config */}
            <h6 className="fw-semibold small text-muted mb-2">{t('dataConnectors.oauthWizard.reviewOauthConfig')}</h6>
            <div className="mb-1 small">
              <span className="text-muted">{t('dataConnectors.oauth.authUrl')}:</span>{' '}
              <span className="text-break">{form.authUrl}</span>
            </div>
            <div className="mb-1 small">
              <span className="text-muted">{t('dataConnectors.oauth.tokenUrl')}:</span>{' '}
              <span className="text-break">{form.tokenUrl}</span>
            </div>

            {/* API Docs */}
            {form.apiDocsUrl && (
              <>
                <hr className="my-2" />
                <h6 className="fw-semibold small text-muted mb-2">{t('dataConnectors.oauthWizard.reviewApiDocs')}</h6>
                <div className="small text-break">{form.apiDocsUrl}</div>
              </>
            )}

            {/* Rate Limits */}
            {(form.rateLimitRpm || form.rateLimitDaily) && (
              <>
                <hr className="my-2" />
                <h6 className="fw-semibold small text-muted mb-2">
                  {t('dataConnectors.oauthWizard.reviewRateLimits')}
                </h6>
                {form.rateLimitRpm && (
                  <div className="small">{t('dataConnectors.oauthWizard.reviewRpm', { count: form.rateLimitRpm })}</div>
                )}
                {form.rateLimitDaily && (
                  <div className="small">
                    {t('dataConnectors.oauthWizard.reviewDaily', { count: form.rateLimitDaily })}
                  </div>
                )}
              </>
            )}

            {/* Custom Headers */}
            {form.customHeaders.filter((h) => h.name.trim()).length > 0 && (
              <>
                <hr className="my-2" />
                <h6 className="fw-semibold small text-muted mb-2">
                  {t('dataConnectors.oauthWizard.reviewCustomHeaders')}
                </h6>
                {form.customHeaders
                  .filter((h) => h.name.trim())
                  .map((h, i) => (
                    <div key={i} className="small">
                      <code>{h.name}</code>: {h.value}
                    </div>
                  ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Step 5: Test Connection ── */}
      {step === 5 && (
        <div className="text-center py-3">
          {testResult === 'idle' && (
            <div>
              <p className="text-muted mb-3">{t('dataConnectors.oauthWizard.saveSuccess')}</p>
              <Button variant="primary" onClick={handleTest}>
                {t('dataConnectors.oauth.testConnection')}
              </Button>
            </div>
          )}
          {testResult === 'running' && (
            <div>
              <Spinner animation="border" variant="primary" className="mb-3" />
              <p className="text-muted">{t('dataConnectors.oauthWizard.testRunning')}</p>
            </div>
          )}
          {testResult === 'success' && (
            <Alert variant="success" className="py-2">
              <i className="bi bi-check-circle me-2"></i>
              {t('dataConnectors.oauthWizard.testSuccess')}
            </Alert>
          )}
          {testResult === 'failed' && (
            <Alert variant="warning" className="py-2">
              <i className="bi bi-exclamation-triangle me-2"></i>
              {t('dataConnectors.oauthWizard.testFailed', { error: testError })}
            </Alert>
          )}
        </div>
      )}
    </ConnectorWizardModal>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCustomHeaders(raw?: string): CustomHeader[] {
  if (!raw) return [];
  try {
    const obj = JSON.parse(raw);
    return Object.entries(obj).map(([name, value]) => ({ name, value: String(value) }));
  } catch {
    return [];
  }
}
