// MERGE: kept dev version — adds setup guide steps, collapsible advanced section,
//   scope picker with PROVIDER_SCOPES integration, and enriched review step.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Col, Collapse, Form, Row, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Copy, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { ConnectorWizardModal } from './ConnectorWizardModal';
import type { WizardStep } from './ConnectorWizardModal';
import { PROVIDER_SCOPES, buildScopeString, parseScopeString, getDefaultScopeIds } from './oauthScopeDefinitions';
import { createCompanySecret, updateCompanySecret, getCompanySecret } from '../../../Services/VaultService';
import { ConnectorsService } from '../../../Services/ConnectorsService';
import type { VaultSecretMetadata, VaultSecretWithFields } from '../../../Services/VaultService';
import type { OAuthProviderInfo } from '../../../types/oauthProviders';
import { getConnectorById, getConnectorsByPlatform, getOAuthSecretId } from '../connectorRegistry';

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
  rateLimitRpm: string;
  rateLimitDaily: string;
  customHeaders: CustomHeader[];
  customCredentials: Record<string, string>;
}

interface OAuthWizardProps {
  show: boolean;
  onHide: () => void;
  onSaved: (connectorId?: string) => void;
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
  const [relatedProviderName, setRelatedProviderName] = useState<string | null>(null);

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
    rateLimitRpm: '',
    rateLimitDaily: '',
    customHeaders: [],
    customCredentials: {},
  };

  const [form, setForm] = useState<OAuthFormState>(emptyForm);

  const updateForm = (partial: Partial<OAuthFormState>) => setForm((prev) => ({ ...prev, ...partial }));

  // Helper: find matching company secret
  const getProviderSecret = useCallback(
    (pid: string): VaultSecretMetadata | undefined =>
      existingSecrets.find((s) => s.name === `oauth-client-${getOAuthSecretId(pid)}`),
    [existingSecrets]
  );

  // Is this a known template connector (not custom/new)?
  const isKnownTemplate = !isNew && !!editingProviderId;

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
    setRelatedProviderName(null);

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
          // Parse custom credentials if any
          const loadedCustomCredentials: Record<string, string> = {};
          const editingEntry = getConnectorById(editingProviderId);
          if (editingEntry?.credentialFields) {
            editingEntry.credentialFields.forEach((field) => {
              if (full.fields?.[field.key]) {
                loadedCustomCredentials[field.key] = full.fields[field.key];
              }
            });
          }

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
            rateLimitRpm: full.fields?.rate_limit_rpm || '',
            rateLimitDaily: full.fields?.rate_limit_daily || '',
            customHeaders: parseCustomHeaders(full.fields?.custom_headers),
            customCredentials: loadedCustomCredentials,
          });
        })
        .catch(() => {
          updateForm(baseForm);
        })
        .finally(() => setLoading(false));

      // Run auto-discovery only if template is missing auth/token URLs
      if (tpl?.discoveryUrl && (!tpl.authUrl || !tpl.tokenUrl)) {
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
      setRelatedProviderName(null);
      setForm({ ...emptyForm, ...baseForm });

      // Check platform siblings for reusable OAuth credentials
      const connector = getConnectorById(editingProviderId);
      if (connector?.oauthPlatform) {
        const siblings = getConnectorsByPlatform(connector.oauthPlatform);
        for (const sibling of siblings) {
          if (sibling.id === editingProviderId) continue;
          const relatedSecret = existingSecrets.find((s) => s.name === `oauth-client-${sibling.id}`);
          if (relatedSecret) {
            getCompanySecret(relatedSecret.name)
              .then((full: VaultSecretWithFields) => {
                if (full?.fields?.client_id) {
                  updateForm({
                    clientId: full.fields.client_id,
                    clientSecret: full.fields.client_secret || '',
                  });
                  setRelatedProviderName(sibling.displayName);
                }
              })
              .catch(() => {
                // Silently ignore — user can enter credentials manually
              });
            break;
          }
        }
      }

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
  const oauthSecretId = effectiveProviderId ? getOAuthSecretId(effectiveProviderId) : '';
  const secretName = oauthSecretId ? `oauth-client-${oauthSecretId}` : '';
  const registryEntry = getConnectorById(effectiveProviderId);

  // ---------------------------------------------------------------------------
  // Steps — dynamic based on isNew vs known template
  // ---------------------------------------------------------------------------

  // Known template: 5 steps (Overview, Credentials, Permissions, Review & Save, Test Connection)
  // Custom/new: 7 steps (Basic Info, Setup Guide, Credentials, Permissions, Docs & Advanced, Review & Save, Test Connection)
  const steps: WizardStep[] = isKnownTemplate
    ? [
        { id: 'overview', label: t('dataConnectors.oauthWizard.stepOverview') },
        { id: 'credentials', label: t('dataConnectors.oauthWizard.stepCredentialsOnly') },
        { id: 'scopes', label: t('dataConnectors.oauthWizard.stepPermissions') },
        { id: 'review', label: t('dataConnectors.oauthWizard.stepReview') },
        { id: 'test', label: t('dataConnectors.oauthWizard.stepTest') },
      ]
    : [
        { id: 'basic', label: t('dataConnectors.oauthWizard.stepBasicInfo') },
        { id: 'guide', label: t('dataConnectors.oauthWizard.stepGuide') },
        { id: 'credentials', label: t('dataConnectors.oauthWizard.stepCredentialsOnly') },
        { id: 'scopes', label: t('dataConnectors.oauthWizard.stepPermissions') },
        { id: 'advanced', label: t('dataConnectors.oauthWizard.stepAdvanced') },
        { id: 'review', label: t('dataConnectors.oauthWizard.stepReview') },
        { id: 'test', label: t('dataConnectors.oauthWizard.stepTest') },
      ];

  const totalSteps = steps.length;

  // Map logical step to what content to show
  const getStepContent = () => {
    if (isKnownTemplate) {
      // 5-step flow: overview, credentials, scopes, review, test
      switch (step) {
        case 1:
          return 'overview';
        case 2:
          return 'credentials';
        case 3:
          return 'scopes';
        case 4:
          return 'review';
        case 5:
          return 'test';
        default:
          return 'overview';
      }
    }
    // 7-step flow: basic, guide, credentials, scopes, advanced, review, test
    switch (step) {
      case 1:
        return 'basic';
      case 2:
        return 'guide';
      case 3:
        return 'credentials';
      case 4:
        return 'scopes';
      case 5:
        return 'advanced';
      case 6:
        return 'review';
      case 7:
        return 'test';
      default:
        return 'basic';
    }
  };

  const stepContent = getStepContent();

  const validateProviderId = (id: string): string | null => {
    if (!id) return null;
    if (!PROVIDER_ID_REGEX.test(id)) return t('dataConnectors.oauth.providerIdInvalid');
    if (isNew && mergedProviders.some((p) => p.id === id)) return t('dataConnectors.oauth.providerIdTaken');
    return null;
  };

  const canProceed = (() => {
    switch (stepContent) {
      case 'basic':
        return form.providerId.trim().length > 0 && form.displayName.trim().length > 0 && !providerIdError;
      case 'overview':
      case 'guide':
        return true;
      case 'credentials':
        if (!secretExists) {
          if (form.clientId.trim().length === 0) return false;
          if (!registryEntry?.oauth?.hideClientSecret && form.clientSecret.trim().length === 0) return false;

          if (registryEntry?.credentialFields) {
            for (const field of registryEntry.credentialFields) {
              if (field.required && !form.customCredentials[field.key]?.trim()) {
                return false;
              }
            }
          }
        }
        return true;
      case 'scopes':
      case 'advanced':
      case 'review':
      case 'test':
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
      const secretId = getOAuthSecretId(pid);
      const sName = `oauth-client-${secretId}`;
      const existing = getProviderSecret(pid);

      // Build scopes string from checkboxes or raw input
      const scopeString = scopeDefs ? buildScopeString(pid, form.selectedScopeIds) : form.scopes.trim();

      // Dynamic URL interpolation. Fields declared with `hostnameSafe: true`
      // are normalised to DNS-safe form (lowercased, `_` → `-`) before being
      // spliced into authUrl / tokenUrl so admins can enter Account IDs like
      // `1234567_SB1` and still get a resolvable hostname.
      let finalAuthUrl = form.authUrl.trim();
      let finalTokenUrl = form.tokenUrl.trim();
      const hostnameSafeKeys = new Set(
        (registryEntry?.credentialFields ?? []).filter((f) => f.hostnameSafe).map((f) => f.key)
      );
      Object.entries(form.customCredentials).forEach(([key, value]) => {
        const raw = value.trim();
        const safeValue = hostnameSafeKeys.has(key) ? raw.toLowerCase().replace(/_/g, '-') : raw;
        const placeholder = `<${key.toUpperCase()}>`;
        finalAuthUrl = finalAuthUrl.replace(new RegExp(placeholder, 'g'), safeValue);
        finalTokenUrl = finalTokenUrl.replace(new RegExp(placeholder, 'g'), safeValue);
      });

      // Shared config fields (auth endpoints, extra params)
      const fields: Record<string, string> = {
        auth_url: finalAuthUrl,
        token_url: finalTokenUrl,
        ...form.customCredentials,
      };

      if (form.extraAuthParams.trim()) fields.extra_auth_params = form.extraAuthParams.trim();

      // Non-standard auth header scheme (e.g. Zoho uses "Zoho-oauthtoken"
      // instead of "Bearer"). Persist when the registry defines it; the
      // backend connect_request reads this field and falls back to Bearer.
      if (registryEntry?.authHeaderScheme) {
        fields.auth_header_scheme = registryEntry.authHeaderScheme;
      }

      // Fixed-base-URL OAuth connectors (e.g. JobAdder): persist the registry
      // baseUrl so the backend URL resolver finds it in the vault and agents
      // can use relative request URLs. Mirrors the ApiKeyWizard write-back.
      // Tenant-specific api_endpoint/instance_url values still win — the
      // backend resolver checks base_url last.
      if (registryEntry?.baseUrl) {
        fields.base_url = registryEntry.baseUrl;
      }

      const connector = getConnectorById(pid);
      if (connector?.oauthPlatform) {
        // Platform connector: scopes at top level, fall back to registry if empty
        const effectiveScopes = scopeString || connector.oauth?.scopes || '';
        fields.scopes = effectiveScopes;
        fields[`connector_${pid}`] = JSON.stringify({
          display_name: form.displayName.trim(),
          icon: form.icon.trim(),
          description: form.description.trim(),
          scopes: effectiveScopes,
        });

        if (existing) {
          // Add this connector to enabled list (idempotent — Set prevents duplicates)
          const full = await getCompanySecret(existing.name);
          const enabledStr = full?.fields?.enabled_connectors || '';
          const enabled = new Set(enabledStr.split(',').filter(Boolean));
          enabled.add(pid);
          fields.enabled_connectors = Array.from(enabled).join(',');
        } else {
          fields.enabled_connectors = pid;
        }
      } else {
        // Non-platform connector: store metadata at top level
        fields.scopes = scopeString;
        fields.display_name = form.displayName.trim();
        fields.icon = form.icon.trim();
        fields.description = form.description.trim();

        if (form.rateLimitRpm.trim()) fields.rate_limit_rpm = form.rateLimitRpm.trim();
        if (form.rateLimitDaily.trim()) fields.rate_limit_daily = form.rateLimitDaily.trim();
      }

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
          description: registryEntry?.oauthPlatform
            ? `OAuth client for ${registryEntry.oauthPlatform} platform`
            : `OAuth client credentials for ${form.displayName.trim() || pid}`,
          category: 'OAuth Clients',
          type: 'custom',
          fields,
        });
        setSecretExists(true);
      }

      ConnectorsService.clearListCache();
      setSuccess(t('dataConnectors.oauthWizard.saveSuccess'));
      setStep(totalSteps); // Go to last step (test)
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
      // Wizard is OAuth-only by nature; facade routes to the OAuth authorize
      // endpoint which navigates the browser on success, so we never actually
      // see 'success' here unless classification fails.
      const action = await ConnectorsService.connect(effectiveProviderId);
      if (action.kind === 'redirecting') {
        setTestResult('success');
      } else {
        setTestResult('failed');
        setTestError(action.kind === 'unsupported' ? action.reason : 'Wizard expected an OAuth connector');
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
    if (stepContent === 'basic') {
      const idError = validateProviderId(form.providerId);
      if (idError) {
        setProviderIdError(idError);
        return;
      }
    }

    if (stepContent === 'credentials' && form.extraAuthParams.trim()) {
      try {
        JSON.parse(form.extraAuthParams.trim());
      } catch {
        setError(t('dataConnectors.oauth.extraAuthParamsHint'));
        return;
      }
    }

    if (stepContent === 'review') {
      await handleSave();
      return;
    }

    if (stepContent === 'test') {
      onSaved(effectiveProviderId);
      onHide();
      return;
    }

    setError(null);
    setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1 && step < totalSteps) {
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
    setRelatedProviderName(null);
  };

  const handleHide = () => {
    resetState();
    onHide();
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const setupSteps = registryEntry?.oauthSetupSteps;

  const renderSetupGuide = () => {
    const guideSteps = setupSteps || [
      t('dataConnectors.oauthWizard.genericStep1'),
      t('dataConnectors.oauthWizard.genericStep2'),
      t('dataConnectors.oauthWizard.genericStep3'),
      t('dataConnectors.oauthWizard.genericStep4'),
      t('dataConnectors.oauthWizard.genericStep5'),
    ];

    return (
      <div className="border rounded p-3 mb-3">
        <h6 className="fw-semibold small mb-2">{t('dataConnectors.oauthWizard.setupGuideTitle')}</h6>
        <ol className="small mb-0 ps-3">
          {guideSteps.map((guideStep, i) => (
            <li key={i} className="mb-1">
              {guideStep}
            </li>
          ))}
        </ol>
      </div>
    );
  };

  const renderCredentialsSection = () => (
    <>
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
            {relatedProviderName ? (
              <Alert variant="info" className="py-2 small mb-3">
                <i className="bi bi-info-circle me-2"></i>
                {t('dataConnectors.oauthWizard.relatedCredentials', { provider: relatedProviderName })}
                <br />
                <a
                  href="#"
                  className="small"
                  onClick={(e) => {
                    e.preventDefault();
                    setRelatedProviderName(null);
                    updateForm({ clientId: '', clientSecret: '' });
                  }}
                >
                  {t('dataConnectors.oauthWizard.useOther')}
                </a>
              </Alert>
            ) : (
              <Alert variant="info" className="py-2 small">
                <i className="bi bi-info-circle me-2"></i>
                {t('dataConnectors.oauthWizard.enterCredentials')}
              </Alert>
            )}
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
            {!registryEntry?.oauth?.hideClientSecret && (
              <Form.Group className={registryEntry?.credentialFields?.length ? 'mb-3' : ''}>
                <Form.Label className="small fw-semibold">{t('dataConnectors.oauth.clientSecret')}</Form.Label>
                <Form.Control
                  type="password"
                  placeholder={t('dataConnectors.oauth.clientSecretPlaceholder')}
                  value={form.clientSecret}
                  onChange={(e) => updateForm({ clientSecret: e.target.value })}
                  required
                />
              </Form.Group>
            )}

            {registryEntry?.credentialFields?.map((field, idx) => (
              <Form.Group key={field.key} className={idx < registryEntry.credentialFields!.length - 1 ? 'mb-3' : ''}>
                <Form.Label className="small fw-semibold">{field.label}</Form.Label>
                <Form.Control
                  type={field.type === 'password' ? 'password' : 'text'}
                  placeholder={field.placeholder}
                  value={form.customCredentials[field.key] || ''}
                  onChange={(e) =>
                    updateForm({
                      customCredentials: { ...form.customCredentials, [field.key]: e.target.value },
                    })
                  }
                  required={field.required}
                />
                {field.helpText && <Form.Text className="text-muted">{field.helpText}</Form.Text>}
              </Form.Group>
            ))}
          </>
        )}
      </Col>
    </>
  );

  const renderScopesSection = () => (
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
          <Form.Text className="text-muted">
            {detectScopeSeparator(form.scopes) === ','
              ? t('dataConnectors.oauthWizard.scopesRawHintCommas')
              : t('dataConnectors.oauthWizard.scopesRawHintSpaces')}
          </Form.Text>
        </Form.Group>
      )}
    </Col>
  );

  const renderRedirectUri = () => (
    <Col md={12}>
      <Form.Group>
        <Form.Label className="small fw-semibold">{t('dataConnectors.oauth.redirectUri')}</Form.Label>
        <div className="d-flex gap-2">
          <Form.Control
            type="text"
            readOnly
            plaintext
            className="bg-light px-2 rounded border"
            value={oauthSecretId ? `${frontendBaseUrl}/oauth/callback/${oauthSecretId}` : ''}
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
              const uri = oauthSecretId ? `${frontendBaseUrl}/oauth/callback/${oauthSecretId}` : '';
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
  );

  const renderAdvancedOAuthSettings = () => {
    // Once a secret exists, every editable field inside this collapse is gated
    // off (auth/token URLs and extra params are locked because changing them on
    // a live config breaks signed tokens). Don't render an empty toggle.
    if (secretExists) return null;
    return (
      <>
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
      </>
    );
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
      authType="oauth2"
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
        stepContent === 'test'
          ? t('dataConnectors.wizard.done')
          : stepContent === 'review'
            ? t('dataConnectors.wizard.save')
            : undefined
      }
    >
      {/* ── Overview (known template: step 1) ── */}
      {stepContent === 'overview' && (
        <Row className="g-3">
          {/* Provider identity header */}
          <Col md={12}>
            <div className="d-flex align-items-center gap-3 p-3 border rounded">
              <i className={form.icon} style={{ fontSize: '2rem' }} />
              <div>
                <h5 className="mb-1">{form.displayName}</h5>
                <p className="text-muted mb-0 small">{form.description}</p>
              </div>
            </div>
          </Col>

          {/* Setup guide for OAuth providers */}
          {!secretExists && <Col md={12}>{renderSetupGuide()}</Col>}
        </Row>
      )}

      {/* ── Credentials (known template: step 2, custom: step 3) ── */}
      {stepContent === 'credentials' && (
        <Row className="g-3">
          {/* Credentials */}
          {renderCredentialsSection()}

          {/* Redirect URI */}
          {renderRedirectUri()}

          {/* Advanced OAuth settings (collapsible) */}
          {renderAdvancedOAuthSettings()}
        </Row>
      )}

      {/* ── Permissions / Scopes (known template: step 3, custom: step 4) ── */}
      {stepContent === 'scopes' && <Row className="g-3">{renderScopesSection()}</Row>}

      {/* ── Step 1 (5-step flow): Basic Info ── */}
      {stepContent === 'basic' && (
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

      {/* ── Setup Guide (custom/new flow: step 2) ── */}
      {stepContent === 'guide' && (
        <Row className="g-3">
          {/* Setup guide */}
          <Col md={12}>{renderSetupGuide()}</Col>
        </Row>
      )}

      {/* ── Docs & Advanced (custom/new flow: step 5) ── */}
      {stepContent === 'advanced' && (
        <Row className="g-3">
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

      {/* ── Review (both flows) ── */}
      {stepContent === 'review' && (
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

            {/* Rate Limits */}
            {(form.rateLimitRpm || form.rateLimitDaily) && (
              <>
                <hr className="my-2" />
                <h6 className="fw-semibold small text-muted mb-2">
                  {t('dataConnectors.oauthWizard.reviewRateLimits')}
                </h6>
                {form.rateLimitRpm && (
                  <div className="small">
                    {t('dataConnectors.oauthWizard.reviewRpm', { count: Number(form.rateLimitRpm) })}
                  </div>
                )}
                {form.rateLimitDaily && (
                  <div className="small">
                    {t('dataConnectors.oauthWizard.reviewDaily', { count: Number(form.rateLimitDaily) })}
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

      {/* ── Test Connection (both flows — last step) ── */}
      {stepContent === 'test' && (
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

/**
 * Infer the scope separator from a pre-filled scope string so the field hint
 * reflects what the provider actually expects. Zoho + Xero use commas;
 * Google, Microsoft, and most others use spaces. Falls back to space when
 * the string is empty or ambiguous.
 */
function detectScopeSeparator(scopes: string): ',' | ' ' {
  const trimmed = (scopes || '').trim();
  if (!trimmed) return ' ';
  if (trimmed.includes(',') && !/\s/.test(trimmed)) return ',';
  if (trimmed.includes(',') && /\s/.test(trimmed)) {
    // Mixed — comma wins if there's no whitespace between tokens that
    // look like scope identifiers.
    return trimmed.split(',').every((part) => !/\s/.test(part.trim())) ? ',' : ' ';
  }
  return ' ';
}
