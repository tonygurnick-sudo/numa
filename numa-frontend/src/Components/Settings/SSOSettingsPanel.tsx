import { useState, useEffect, useCallback } from 'react';
import { Alert, Badge, Button, Card, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import {
  AdminSSOSettingsService,
  type SSOConfig,
  type SPMetadata,
  type IdpType,
  type SSOSaveConfig,
  type EmailSource,
  type GroupMappingConfig,
  type SSOUser,
} from '../../Services/AdminSSOSettingsService';
import { getFlag } from '../../utils/featureFlags';
import { useConfirm } from '../../Providers/ConfirmContext';

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaDelete = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;

interface SSOSettingsPanelProps {
  numaGet: NumaGet;
  numaPut: NumaPut;
  numaPost: NumaPost;
  numaDelete: NumaDelete;
}

const DEFAULT_ATTRIBUTE_MAPPINGS: Record<IdpType, Record<string, string>> = {
  'azure-ad': {
    email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    given_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
    family_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
  },
  okta: {
    email: 'email',
    given_name: 'firstName',
    family_name: 'lastName',
  },
  'google-workspace': {
    email: 'email',
    given_name: 'first_name',
    family_name: 'last_name',
  },
  other: {
    email: 'email',
    given_name: 'given_name',
    family_name: 'family_name',
  },
};

const IDP_OPTIONS: { value: IdpType; labelKey: string; descKey: string; icon: string }[] = [
  {
    value: 'azure-ad',
    labelKey: 'sso.wizard.step1.azureAd',
    descKey: 'sso.wizard.step1.azureAdDescription',
    icon: 'bi-microsoft',
  },
  {
    value: 'okta',
    labelKey: 'sso.wizard.step1.okta',
    descKey: 'sso.wizard.step1.oktaDescription',
    icon: 'bi-shield-lock',
  },
  {
    value: 'google-workspace',
    labelKey: 'sso.wizard.step1.googleWorkspace',
    descKey: 'sso.wizard.step1.googleWorkspaceDescription',
    icon: 'bi-google',
  },
  { value: 'other', labelKey: 'sso.wizard.step1.other', descKey: 'sso.wizard.step1.otherDescription', icon: 'bi-box' },
];

const SSOSettingsPanel = ({ numaGet, numaPut, numaPost, numaDelete }: SSOSettingsPanelProps) => {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const confirm = useConfirm();

  // State
  const [config, setConfig] = useState<SSOConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Wizard state
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [idpType, setIdpType] = useState<IdpType>('azure-ad');
  const [providerProtocol, setProviderProtocol] = useState<'SAML' | 'OIDC'>('SAML');
  const [metadataUrl, setMetadataUrl] = useState('');
  const [metadataXml, setMetadataXml] = useState('');
  // OIDC fields
  const [oidcIssuer, setOidcIssuer] = useState('');
  const [oidcClientId, setOidcClientId] = useState('');
  const [oidcClientSecret, setOidcClientSecret] = useState('');
  const [oidcScopes, setOidcScopes] = useState('openid email profile');
  const [attributeMapping, setAttributeMapping] = useState<Record<string, string>>(
    DEFAULT_ATTRIBUTE_MAPPINGS['azure-ad']
  );
  const [emailSource, setEmailSource] = useState<EmailSource>('email-claim');
  const [spMetadata, setSpMetadata] = useState<SPMetadata | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Enterprise features (SSO_ENTERPRISE flag)
  const enterpriseEnabled = getFlag('SSO_ENTERPRISE');
  const [groupMapping, setGroupMapping] = useState<GroupMappingConfig | null>(null);
  const [ssoUsers, setSsoUsers] = useState<SSOUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [scimConfig, setScimConfig] = useState<{
    configured: boolean;
    scimEndpoint: string;
    tokenCreatedAt: string | null;
    tokenRevoked: boolean;
  } | null>(null);
  const [scimToken, setScimToken] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const data = await AdminSSOSettingsService.get(numaGet);
      setConfig(data);
    } catch {
      setError(t('errors.loadSettings'));
    } finally {
      setLoading(false);
    }
  }, [numaGet, t]);

  const loadGroupMapping = useCallback(async () => {
    if (!enterpriseEnabled) return;
    try {
      const data = await AdminSSOSettingsService.getGroupMapping(numaGet);
      setGroupMapping(data);
    } catch {
      // Non-critical
    }
  }, [numaGet, enterpriseEnabled]);

  const loadSSOUsers = useCallback(async () => {
    if (!enterpriseEnabled) return;
    setUsersLoading(true);
    try {
      const data = await AdminSSOSettingsService.listUsers(numaGet);
      setSsoUsers(data.users || []);
    } catch {
      // Non-critical
    } finally {
      setUsersLoading(false);
    }
  }, [numaGet, enterpriseEnabled]);

  const loadScimConfig = useCallback(async () => {
    if (!enterpriseEnabled) return;
    try {
      const data = await AdminSSOSettingsService.getScimConfig(numaGet);
      setScimConfig(data);
    } catch {
      // Non-critical
    }
  }, [numaGet, enterpriseEnabled]);

  useEffect(() => {
    loadConfig();
    loadGroupMapping();
    loadScimConfig();
  }, [loadConfig, loadGroupMapping, loadScimConfig]);

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const copyToClipboard = (value: string, field: string) => {
    navigator.clipboard.writeText(value);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  // --- Wizard ---

  const openWizard = async (editing = false) => {
    clearMessages();
    setWizardStep(1);
    setWizardError(null);

    if (editing && config?.configured) {
      setIdpType((config.idpType as IdpType) || 'azure-ad');
      setProviderProtocol(config.providerProtocol || 'SAML');
      setMetadataUrl(config.metadataUrl || '');
      setMetadataXml(config.metadataXml || '');
      setOidcIssuer(config.oidcIssuer || '');
      setOidcClientId('');
      setOidcClientSecret('');
      setOidcScopes('openid email profile');
      setEmailSource(config.emailSource || 'email-claim');
      setAttributeMapping(
        config.attributeMapping || DEFAULT_ATTRIBUTE_MAPPINGS[(config.idpType as IdpType) || 'azure-ad']
      );
    } else {
      setIdpType('azure-ad');
      setProviderProtocol('SAML');
      setMetadataUrl('');
      setMetadataXml('');
      setOidcIssuer('');
      setOidcClientId('');
      setOidcClientSecret('');
      setOidcScopes('openid email profile');
      setEmailSource('email-claim');
      setAttributeMapping(DEFAULT_ATTRIBUTE_MAPPINGS['azure-ad']);
    }

    // Fetch SP metadata for step 2
    try {
      const metadata = await AdminSSOSettingsService.getSPMetadata(numaGet);
      setSpMetadata(metadata);
    } catch {
      // Will show error in wizard
    }

    setShowWizard(true);
  };

  const handleIdpTypeChange = (type: IdpType) => {
    setIdpType(type);
    setAttributeMapping(DEFAULT_ATTRIBUTE_MAPPINGS[type]);
  };

  const handleSaveConfig = async () => {
    clearMessages();
    setWizardError(null);
    setActionLoading(true);
    try {
      const saveData: SSOSaveConfig = {
        idpType,
        providerProtocol,
        attributeMapping,
        emailSource,
      };
      if (providerProtocol === 'OIDC') {
        saveData.oidcIssuer = oidcIssuer;
        saveData.oidcClientId = oidcClientId;
        if (oidcClientSecret) saveData.oidcClientSecret = oidcClientSecret;
        saveData.oidcScopes = oidcScopes;
      } else {
        if (metadataUrl) {
          saveData.metadataUrl = metadataUrl;
        } else if (metadataXml) {
          saveData.metadataXml = metadataXml;
        }
      }

      await AdminSSOSettingsService.save(saveData, numaPut);
      setSuccess(t('sso.saveSuccess'));
      await loadConfig();
      setWizardStep(4);
    } catch (err) {
      setWizardError(getErrorMessage(err, t('sso.saveFailed')));
    } finally {
      setActionLoading(false);
    }
  };

  const handleEnable = async () => {
    clearMessages();
    setWizardError(null);
    setActionLoading(true);
    try {
      await AdminSSOSettingsService.enable(numaPost);
      setSuccess(t('sso.enableSuccess'));
      await loadConfig();
      setShowWizard(false);
    } catch (err) {
      const msg = getErrorMessage(err, t('sso.saveFailed'));
      // Show in modal if wizard is open, otherwise on main page
      if (showWizard) {
        setWizardError(msg);
      } else {
        setError(msg);
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisable = async () => {
    clearMessages();
    setActionLoading(true);
    try {
      await AdminSSOSettingsService.disable(numaPost);
      setSuccess(t('sso.disableSuccess'));
      await loadConfig();
    } catch (err) {
      setError(getErrorMessage(err, t('sso.saveFailed')));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    clearMessages();
    setActionLoading(true);
    try {
      await AdminSSOSettingsService.remove(numaDelete);
      setSuccess(t('sso.deleteSuccess'));
      setConfig(null);
      await loadConfig();
      setShowDeleteConfirm(false);
    } catch (err) {
      setError(getErrorMessage(err, t('sso.saveFailed')));
    } finally {
      setActionLoading(false);
    }
  };

  const handleTestSSO = () => {
    if (!config?.providerName || !spMetadata) return;
    const signOnUrl = `${spMetadata.signOnUrl}&identity_provider=${encodeURIComponent(config.providerName)}`;
    window.open(signOnUrl, 'sso-test', 'width=600,height=700');
  };

  const canProceedToStep3 =
    providerProtocol === 'OIDC'
      ? oidcIssuer.trim() !== '' && oidcClientId.trim() !== ''
      : metadataUrl.trim() !== '' || metadataXml.trim() !== '';

  /** Extract the error message from an axios error or plain Error. */
  const getErrorMessage = (err: unknown, fallback: string): string => {
    // Axios errors have response.data with our Lambda error message
    const axiosData = (err as { response?: { data?: { error?: string } } })?.response?.data;
    if (axiosData?.error) return axiosData.error;
    if (err instanceof Error) return err.message;
    return fallback;
  };

  // --- Render ---

  if (loading) {
    return (
      <div className="text-center py-4">
        <Spinner animation="border" />
      </div>
    );
  }

  const getIdpLabel = (type: string) => {
    const option = IDP_OPTIONS.find((o) => o.value === type);
    return option ? t(option.labelKey) : type;
  };

  return (
    <div>
      <Alert variant="secondary" className="mb-3">
        <div className="d-flex align-items-start">
          <i className="bi bi-shield-check me-2 mt-1"></i>
          <div>
            <div className="settings-section-title">{t('sso.title')}</div>
            <div className="small text-muted">{t('sso.description')}</div>
          </div>
        </div>
      </Alert>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert variant="success" dismissible onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {/* Status card */}
      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <div className="d-flex align-items-center gap-2 mb-1">
                <strong>{t('sso.status.label')}</strong>
                {!config?.configured && <Badge bg="secondary">{t('sso.status.notConfigured')}</Badge>}
                {config?.configured && config.enabled && <Badge bg="success">{t('sso.status.active')}</Badge>}
                {config?.configured && !config.enabled && (
                  <Badge bg="warning" text="dark">
                    {t('sso.status.inactive')}
                  </Badge>
                )}
              </div>
              {config?.configured && (
                <div className="text-muted small">
                  <span className="me-3">
                    <strong>{t('sso.provider.label')}:</strong> {getIdpLabel(config.idpType || '')}
                  </span>
                  {config.updatedAt && (
                    <span>
                      <strong>{t('sso.provider.lastUpdated')}:</strong>{' '}
                      {new Date(config.updatedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="d-flex gap-2">
              {!config?.configured && (
                <Button variant="primary" size="sm" onClick={() => openWizard()}>
                  <i className="bi bi-plus-lg me-1"></i>
                  {t('sso.setupButton')}
                </Button>
              )}
              {config?.configured && (
                <>
                  <Button variant="outline-secondary" size="sm" onClick={() => openWizard(true)}>
                    <i className="bi bi-pencil me-1"></i>
                    {t('sso.editButton')}
                  </Button>
                  {config.enabled ? (
                    <Button variant="outline-warning" size="sm" onClick={handleDisable} disabled={actionLoading}>
                      {t('sso.disableButton')}
                    </Button>
                  ) : (
                    <Button variant="success" size="sm" onClick={handleEnable} disabled={actionLoading}>
                      {t('sso.enableButton')}
                    </Button>
                  )}
                  <Button variant="outline-danger" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                    <i className="bi bi-trash me-1"></i>
                    {t('sso.deleteButton')}
                  </Button>
                </>
              )}
            </div>
          </div>
          {config?.configured && (
            <div className="mt-2">
              <small className="text-muted">
                <i className="bi bi-info-circle me-1"></i>
                {t('sso.passwordFallback')}
              </small>
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Enterprise: SSO-Only Mode */}
      {enterpriseEnabled && config?.configured && config.enabled && (
        <Card className="mb-3">
          <Card.Body>
            <div className="d-flex justify-content-between align-items-center">
              <div>
                <strong>{t('sso.ssoOnly.title')}</strong>
                <div className="text-muted small">{t('sso.ssoOnly.description')}</div>
              </div>
              <Form.Check
                type="switch"
                id="sso-only-toggle"
                checked={config.ssoOnlyMode || false}
                onChange={async (e) => {
                  const newMode = e.target.checked;
                  if (newMode) {
                    const ok = await confirm({
                      message: t('sso.ssoOnly.enableConfirm'),
                      confirmLabel: tCommon('common.ok'),
                      variant: 'warning',
                    });
                    if (!ok) return;
                  }
                  clearMessages();
                  setActionLoading(true);
                  try {
                    await AdminSSOSettingsService.save(
                      { idpType: config.idpType as IdpType, ssoOnlyMode: newMode },
                      numaPut
                    );
                    // Re-enable to apply the new mode to the User Pool Client
                    await AdminSSOSettingsService.enable(numaPost);
                    setSuccess(newMode ? t('sso.ssoOnly.enabled') : t('sso.ssoOnly.disabled'));
                    await loadConfig();
                  } catch (err) {
                    setError(getErrorMessage(err, t('sso.saveFailed')));
                    // Fix #7: always reload config on error so UI reflects actual backend state
                    await loadConfig();
                  } finally {
                    setActionLoading(false);
                  }
                }}
                disabled={actionLoading}
              />
            </div>
            {config.ssoOnlyMode && (
              <Alert variant="warning" className="mt-2 mb-0 small">
                <i className="bi bi-exclamation-triangle me-1"></i>
                {t('sso.ssoOnly.activeWarning')}
              </Alert>
            )}
          </Card.Body>
        </Card>
      )}

      {/* Enterprise: Group Mapping */}
      {enterpriseEnabled && config?.configured && config.enabled && (
        <Card className="mb-3">
          <Card.Body>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div>
                <strong>{t('sso.groupMapping.title')}</strong>
                <div className="text-muted small">{t('sso.groupMapping.description')}</div>
              </div>
              <Form.Check
                type="switch"
                id="group-mapping-toggle"
                checked={groupMapping?.enabled || false}
                onChange={async (e) => {
                  const newConfig: GroupMappingConfig = {
                    enabled: e.target.checked,
                    groupClaimName:
                      groupMapping?.groupClaimName || 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
                    mappings: groupMapping?.mappings || [],
                  };
                  try {
                    await AdminSSOSettingsService.saveGroupMapping(newConfig, numaPut);
                    await loadGroupMapping();
                  } catch (err) {
                    setError(getErrorMessage(err, t('sso.saveFailed')));
                  }
                }}
                disabled={actionLoading}
              />
            </div>
            {groupMapping?.enabled && (
              <div className="mt-2">
                <Alert variant="info" className="small mb-2">
                  <i className="bi bi-info-circle me-1"></i>
                  {t('sso.groupMapping.claimHelp')}
                </Alert>
                <Form.Group className="mb-2">
                  <Form.Label className="small fw-bold">{t('sso.groupMapping.claimName')}</Form.Label>
                  <Form.Control
                    size="sm"
                    value={groupMapping.groupClaimName || ''}
                    onChange={(e) =>
                      setGroupMapping((prev) => (prev ? { ...prev, groupClaimName: e.target.value } : prev))
                    }
                    className="font-monospace"
                  />
                </Form.Group>
                <Form.Label className="small fw-bold">{t('sso.groupMapping.mappings')}</Form.Label>
                {(groupMapping.mappings || []).map((m, i) => (
                  <div key={i} className="d-flex align-items-center gap-2 mb-1">
                    <Form.Control
                      size="sm"
                      placeholder={t('sso.groupMapping.idpGroup')}
                      value={m.idpGroup}
                      onChange={(e) => {
                        const newMappings = [...(groupMapping.mappings || [])];
                        newMappings[i] = { ...newMappings[i], idpGroup: e.target.value };
                        setGroupMapping((prev) => (prev ? { ...prev, mappings: newMappings } : prev));
                      }}
                    />
                    <i className="bi bi-arrow-right text-muted"></i>
                    <Form.Select
                      size="sm"
                      value={m.cognitoGroup}
                      onChange={(e) => {
                        const newMappings = [...(groupMapping.mappings || [])];
                        newMappings[i] = { ...newMappings[i], cognitoGroup: e.target.value };
                        setGroupMapping((prev) => (prev ? { ...prev, mappings: newMappings } : prev));
                      }}
                    >
                      <option value="standard">{t('sso.groupMapping.groupStandard')}</option>
                      <option value="admin">{t('sso.groupMapping.groupAdmin')}</option>
                    </Form.Select>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => {
                        const newMappings = (groupMapping.mappings || []).filter((_, idx) => idx !== i);
                        setGroupMapping((prev) => (prev ? { ...prev, mappings: newMappings } : prev));
                      }}
                    >
                      <i className="bi bi-trash"></i>
                    </Button>
                  </div>
                ))}
                <div className="d-flex gap-2 mt-2">
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={() => {
                      const newMappings = [...(groupMapping.mappings || []), { idpGroup: '', cognitoGroup: 'admin' }];
                      setGroupMapping((prev) => (prev ? { ...prev, mappings: newMappings } : prev));
                    }}
                  >
                    <i className="bi bi-plus me-1"></i>
                    {t('sso.groupMapping.addMapping')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={async () => {
                      if (!groupMapping) return;
                      try {
                        await AdminSSOSettingsService.saveGroupMapping(groupMapping, numaPut);
                        setSuccess(t('sso.groupMapping.saved'));
                        await loadGroupMapping();
                      } catch (err) {
                        setError(getErrorMessage(err, t('sso.saveFailed')));
                      }
                    }}
                  >
                    {t('sso.groupMapping.saveButton')}
                  </Button>
                </div>
              </div>
            )}
          </Card.Body>
        </Card>
      )}

      {/* Enterprise: SSO Users */}
      {enterpriseEnabled && config?.configured && config.enabled && (
        <Card className="mb-3">
          <Card.Body>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <strong>{t('sso.users.title')}</strong>
              <Button variant="outline-secondary" size="sm" onClick={loadSSOUsers} disabled={usersLoading}>
                {usersLoading ? <Spinner size="sm" /> : <i className="bi bi-arrow-clockwise me-1"></i>}
                {t('sso.users.refresh')}
              </Button>
            </div>
            {ssoUsers.length > 0 ? (
              <Table size="sm" hover responsive>
                <thead>
                  <tr>
                    <th>{t('sso.users.email')}</th>
                    <th>{t('sso.users.authMethod')}</th>
                    <th>{t('sso.users.provider')}</th>
                    <th>{t('sso.users.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ssoUsers.map((user) => (
                    <tr key={user.sub}>
                      <td className="small">{user.email}</td>
                      <td>
                        <Badge
                          bg={
                            user.authMethod === 'both' ? 'primary' : user.authMethod === 'sso' ? 'success' : 'secondary'
                          }
                        >
                          {user.authMethod}
                        </Badge>
                      </td>
                      <td className="small">{user.providerName || '—'}</td>
                      <td>
                        {(user.authMethod === 'sso' || user.authMethod === 'both') && (
                          <Button
                            variant="outline-warning"
                            size="sm"
                            onClick={async () => {
                              const ok = await confirm({
                                message: t('sso.users.unlinkConfirm', { email: user.email }),
                                confirmLabel: t('sso.users.unlink'),
                                variant: 'warning',
                              });
                              if (!ok) return;
                              try {
                                await AdminSSOSettingsService.unlinkUser(user.sub, numaPost);
                                setSuccess(t('sso.users.unlinkSuccess', { email: user.email }));
                                await loadSSOUsers();
                              } catch (err) {
                                setError(getErrorMessage(err, t('sso.saveFailed')));
                              }
                            }}
                          >
                            {t('sso.users.unlink')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <div className="text-muted small text-center py-3">{t('sso.users.clickRefresh')}</div>
            )}
          </Card.Body>
        </Card>
      )}

      {/* Enterprise: SCIM Provisioning */}
      {enterpriseEnabled && config?.configured && config.enabled && (
        <Card className="mb-3">
          <Card.Body>
            <strong>{t('sso.scim.title')}</strong>
            <div className="text-muted small mb-2">{t('sso.scim.description')}</div>

            {scimConfig && (
              <div>
                <div className="mb-2">
                  <Form.Label className="small fw-bold">{t('sso.scim.endpoint')}</Form.Label>
                  <div className="d-flex align-items-center gap-2">
                    <code className="p-2 bg-light border rounded small flex-grow-1">{scimConfig.scimEndpoint}</code>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(scimConfig.scimEndpoint);
                        setCopied('scimEndpoint');
                        setTimeout(() => setCopied(null), 2000);
                      }}
                    >
                      {copied === 'scimEndpoint' ? (
                        <i className="bi bi-check"></i>
                      ) : (
                        <i className="bi bi-clipboard"></i>
                      )}
                    </Button>
                  </div>
                </div>

                {scimConfig.configured && !scimConfig.tokenRevoked ? (
                  <div>
                    <Badge bg="success" className="me-2">
                      {t('sso.scim.tokenActive')}
                    </Badge>
                    <span className="text-muted small">
                      {t('sso.scim.tokenCreated')}:{' '}
                      {scimConfig.tokenCreatedAt ? new Date(scimConfig.tokenCreatedAt).toLocaleDateString() : '—'}
                    </span>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      className="ms-2"
                      onClick={async () => {
                        const ok = await confirm({
                          message: t('sso.scim.revokeConfirm'),
                          confirmLabel: t('sso.scim.revokeButton'),
                          variant: 'danger',
                        });
                        if (!ok) return;
                        try {
                          await AdminSSOSettingsService.revokeScimToken(numaDelete);
                          setScimToken(null);
                          await loadScimConfig();
                          setSuccess(t('sso.scim.revoked'));
                        } catch (err) {
                          setError(getErrorMessage(err, t('sso.saveFailed')));
                        }
                      }}
                    >
                      {t('sso.scim.revokeButton')}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={async () => {
                      try {
                        const res = await AdminSSOSettingsService.generateScimToken(numaPost);
                        setScimToken(res.token);
                        await loadScimConfig();
                      } catch (err) {
                        setError(getErrorMessage(err, t('sso.saveFailed')));
                      }
                    }}
                  >
                    <i className="bi bi-key me-1"></i>
                    {t('sso.scim.generateButton')}
                  </Button>
                )}

                {scimToken && (
                  <Alert variant="warning" className="mt-2">
                    <strong>{t('sso.scim.tokenWarning')}</strong>
                    <div className="d-flex align-items-center gap-2 mt-1">
                      <code className="p-2 bg-white border rounded small flex-grow-1 text-break">{scimToken}</code>
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(scimToken);
                          setCopied('scimToken');
                          setTimeout(() => setCopied(null), 2000);
                        }}
                      >
                        {copied === 'scimToken' ? <i className="bi bi-check"></i> : <i className="bi bi-clipboard"></i>}
                      </Button>
                    </div>
                  </Alert>
                )}
              </div>
            )}
          </Card.Body>
        </Card>
      )}

      {/* Delete confirmation modal */}
      <Modal show={showDeleteConfirm} onHide={() => setShowDeleteConfirm(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{t('sso.deleteButton')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{t('sso.deleteConfirm')}</Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
            {t('sso.wizard.cancel')}
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={actionLoading}>
            {actionLoading ? <Spinner size="sm" /> : t('sso.deleteButton')}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Setup wizard modal */}
      <Modal show={showWizard} onHide={() => setShowWizard(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>{t('sso.wizard.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {wizardError && (
            <Alert variant="danger" dismissible onClose={() => setWizardError(null)} className="mb-3">
              {wizardError}
            </Alert>
          )}
          {/* Step indicators */}
          <div className="d-flex justify-content-center mb-4">
            {[1, 2, 3, 4].map((step) => (
              <div key={step} className="d-flex align-items-center">
                <div
                  className={`rounded-circle d-flex align-items-center justify-content-center ${
                    wizardStep >= step ? 'bg-primary text-white' : 'bg-light text-muted border'
                  }`}
                  style={{ width: 32, height: 32, fontSize: '0.875rem' }}
                >
                  {step}
                </div>
                {step < 4 && (
                  <div
                    className={`mx-2 ${wizardStep > step ? 'border-primary' : ''}`}
                    style={{ width: 40, height: 1, backgroundColor: wizardStep > step ? '#0d6efd' : '#dee2e6' }}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Step 1: Choose IdP */}
          {wizardStep === 1 && (
            <div>
              <h5>{t('sso.wizard.step1.title')}</h5>
              <p className="text-muted">{t('sso.wizard.step1.description')}</p>
              <div className="d-flex flex-column gap-2">
                {IDP_OPTIONS.map((option) => (
                  <Card
                    key={option.value}
                    className={`cursor-pointer ${idpType === option.value ? 'border-primary' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleIdpTypeChange(option.value)}
                  >
                    <Card.Body className="py-2 px-3">
                      <div className="d-flex align-items-center">
                        <Form.Check
                          type="radio"
                          name="idpType"
                          checked={idpType === option.value}
                          onChange={() => handleIdpTypeChange(option.value)}
                          className="me-3"
                        />
                        <i className={`${option.icon} me-2`}></i>
                        <div>
                          <strong>{t(option.labelKey)}</strong>
                          <div className="text-muted small">{t(option.descKey)}</div>
                        </div>
                      </div>
                    </Card.Body>
                  </Card>
                ))}
              </div>

              {/* OIDC available to all clients — not gated behind SSO_ENTERPRISE */}
              <div className="mt-3">
                <Form.Label className="fw-bold small">{t('sso.wizard.step1.protocolLabel')}</Form.Label>
                <div className="d-flex gap-3">
                  <Form.Check
                    type="radio"
                    name="providerProtocol"
                    id="protocol-saml"
                    label="SAML 2.0"
                    checked={providerProtocol === 'SAML'}
                    onChange={() => setProviderProtocol('SAML')}
                  />
                  <Form.Check
                    type="radio"
                    name="providerProtocol"
                    id="protocol-oidc"
                    label="OIDC"
                    checked={providerProtocol === 'OIDC'}
                    onChange={() => setProviderProtocol('OIDC')}
                  />
                </div>
                <Form.Text className="text-muted">{t('sso.wizard.step1.protocolHelp')}</Form.Text>
              </div>
            </div>
          )}

          {/* Step 2: Configure IdP */}
          {wizardStep === 2 && (
            <div>
              <h5>{t('sso.wizard.step2.title')}</h5>
              <p className="text-muted">{t('sso.wizard.step2.description')}</p>

              {providerProtocol === 'OIDC' ? (
                <>
                  {/* OIDC configuration fields */}
                  <Form.Group className="mb-3">
                    <Form.Label>{t('sso.wizard.step2.oidcIssuer')}</Form.Label>
                    <Form.Control
                      type="url"
                      value={oidcIssuer}
                      onChange={(e) => setOidcIssuer(e.target.value)}
                      placeholder="https://accounts.google.com"
                    />
                    <Form.Text className="text-muted">{t('sso.wizard.step2.oidcIssuerHelp')}</Form.Text>
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>{t('sso.wizard.step2.oidcClientId')}</Form.Label>
                    <Form.Control
                      value={oidcClientId}
                      onChange={(e) => setOidcClientId(e.target.value)}
                      placeholder="your-client-id.apps.googleusercontent.com"
                    />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>{t('sso.wizard.step2.oidcClientSecret')}</Form.Label>
                    <Form.Control
                      type="password"
                      value={oidcClientSecret}
                      onChange={(e) => setOidcClientSecret(e.target.value)}
                      placeholder={t('sso.wizard.step2.oidcClientSecretPlaceholder')}
                    />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label>{t('sso.wizard.step2.oidcScopes')}</Form.Label>
                    <Form.Control
                      value={oidcScopes}
                      onChange={(e) => setOidcScopes(e.target.value)}
                      placeholder="openid email profile"
                    />
                    <Form.Text className="text-muted">{t('sso.wizard.step2.oidcScopesHelp')}</Form.Text>
                  </Form.Group>
                </>
              ) : (
                <>
                  {/* SAML configuration fields */}
                  {spMetadata && (
                    <Card className="mb-3 bg-light">
                      <Card.Body>
                        <div className="mb-3">
                          <Form.Label className="fw-bold small">{t('sso.wizard.step2.entityId')}</Form.Label>
                          <div className="d-flex align-items-center gap-2">
                            <code className="flex-grow-1 p-2 bg-white border rounded small">{spMetadata.entityId}</code>
                            <Button
                              variant="outline-secondary"
                              size="sm"
                              onClick={() => copyToClipboard(spMetadata.entityId, 'entityId')}
                            >
                              {copied === 'entityId' ? (
                                <i className="bi bi-check"></i>
                              ) : (
                                <i className="bi bi-clipboard"></i>
                              )}
                            </Button>
                          </div>
                        </div>
                        <div>
                          <Form.Label className="fw-bold small">{t('sso.wizard.step2.acsUrl')}</Form.Label>
                          <div className="d-flex align-items-center gap-2">
                            <code className="flex-grow-1 p-2 bg-white border rounded small">{spMetadata.acsUrl}</code>
                            <Button
                              variant="outline-secondary"
                              size="sm"
                              onClick={() => copyToClipboard(spMetadata.acsUrl, 'acsUrl')}
                            >
                              {copied === 'acsUrl' ? (
                                <i className="bi bi-check"></i>
                              ) : (
                                <i className="bi bi-clipboard"></i>
                              )}
                            </Button>
                          </div>
                        </div>
                      </Card.Body>
                    </Card>
                  )}

                  {idpType === 'azure-ad' && (
                    <Alert variant="info" className="small">
                      <i className="bi bi-info-circle me-1"></i>
                      {t('sso.wizard.step2.azureInstructions')}
                    </Alert>
                  )}
                  {idpType === 'okta' && (
                    <Alert variant="info" className="small">
                      <i className="bi bi-info-circle me-1"></i>
                      {t('sso.wizard.step2.oktaInstructions')}
                    </Alert>
                  )}
                  {idpType === 'google-workspace' && (
                    <Alert variant="info" className="small">
                      <i className="bi bi-info-circle me-1"></i>
                      {t('sso.wizard.step2.googleInstructions')}
                    </Alert>
                  )}

                  <Form.Group className="mb-3">
                    <Form.Label>{t('sso.wizard.step2.metadataUrlLabel')}</Form.Label>
                    <Form.Control
                      type="url"
                      value={metadataUrl}
                      onChange={(e) => {
                        setMetadataUrl(e.target.value);
                        setMetadataXml('');
                      }}
                      placeholder={t(
                        idpType === 'azure-ad'
                          ? 'sso.wizard.step2.metadataUrlPlaceholderAzure'
                          : idpType === 'okta'
                            ? 'sso.wizard.step2.metadataUrlPlaceholderOkta'
                            : idpType === 'google-workspace'
                              ? 'sso.wizard.step2.metadataUrlPlaceholderGoogle'
                              : 'sso.wizard.step2.metadataUrlPlaceholder'
                      )}
                    />
                    <Form.Text className="text-muted">{t('sso.wizard.step2.metadataUrlHelp')}</Form.Text>
                  </Form.Group>

                  <div className="text-center text-muted mb-3">
                    <small>— {t('sso.wizard.step2.orDivider')} —</small>
                  </div>

                  <Form.Group>
                    <Form.Label>{t('sso.wizard.step2.metadataXmlLabel')}</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={6}
                      value={metadataXml}
                      onChange={(e) => {
                        setMetadataXml(e.target.value);
                        setMetadataUrl('');
                      }}
                      placeholder={t('sso.wizard.step2.metadataXmlPlaceholder')}
                      className="font-monospace small"
                    />
                    <Form.Text className="text-muted">{t('sso.wizard.step2.metadataXmlHelp')}</Form.Text>
                  </Form.Group>
                </>
              )}
            </div>
          )}

          {/* Step 3: Attribute Mapping */}
          {wizardStep === 3 && (
            <div>
              <h5>{t('sso.wizard.step3.title')}</h5>
              <p className="text-muted">{t('sso.wizard.step3.description')}</p>

              {(idpType === 'azure-ad' || idpType === 'other') && (
                <Card className="mb-3 bg-light">
                  <Card.Body className="py-2">
                    <Form.Label className="fw-bold small mb-2">{t('sso.wizard.step3.emailSourceLabel')}</Form.Label>
                    <Form.Check
                      type="radio"
                      name="emailSource"
                      id="emailSource-claim"
                      label={t('sso.wizard.step3.emailSourceClaim')}
                      checked={emailSource === 'email-claim'}
                      onChange={() => setEmailSource('email-claim')}
                      className="mb-1"
                    />
                    <Form.Check
                      type="radio"
                      name="emailSource"
                      id="emailSource-upn"
                      label={t('sso.wizard.step3.emailSourceUpn')}
                      checked={emailSource === 'upn'}
                      onChange={() => setEmailSource('upn')}
                    />
                    <Form.Text className="text-muted">{t('sso.wizard.step3.emailSourceHelp')}</Form.Text>
                  </Card.Body>
                </Card>
              )}

              <Alert variant="info" className="small mb-3">
                <i className="bi bi-info-circle me-1"></i>
                {t('sso.wizard.step3.defaultMappingNote')}
              </Alert>

              <div className="mb-3">
                {(['email', 'given_name', 'family_name'] as const).map((attr) => (
                  <Form.Group key={attr} className="mb-2">
                    <div className="d-flex align-items-center gap-2">
                      <div style={{ width: 120 }}>
                        <Form.Label className="mb-0 fw-bold small">
                          {t(
                            `sso.wizard.step3.${attr === 'email' ? 'email' : attr === 'given_name' ? 'givenName' : 'familyName'}`
                          )}
                        </Form.Label>
                      </div>
                      <i className="bi bi-arrow-right text-muted"></i>
                      <Form.Control
                        size="sm"
                        value={attributeMapping[attr] || ''}
                        onChange={(e) => setAttributeMapping((prev) => ({ ...prev, [attr]: e.target.value }))}
                        className="font-monospace"
                      />
                    </div>
                  </Form.Group>
                ))}
              </div>
            </div>
          )}

          {/* Step 4: Test & Enable */}
          {wizardStep === 4 && (
            <div>
              <h5>{t('sso.wizard.step4.title')}</h5>
              <p className="text-muted">{t('sso.wizard.step4.description')}</p>

              <Card className="mb-3">
                <Card.Body className="text-center">
                  <p className="text-muted small">{t('sso.wizard.step4.testDescription')}</p>
                  <Button
                    variant="outline-primary"
                    onClick={handleTestSSO}
                    disabled={!config?.configured || !spMetadata}
                    className="me-2"
                  >
                    <i className="bi bi-box-arrow-up-right me-1"></i>
                    {t('sso.testButton')}
                  </Button>
                </Card.Body>
              </Card>

              {config?.configured && !config.enabled && (
                <div className="text-center">
                  <p className="text-muted small">{t('sso.wizard.step4.readyToEnable')}</p>
                  <Button variant="success" onClick={handleEnable} disabled={actionLoading}>
                    {actionLoading ? <Spinner size="sm" className="me-1" /> : <i className="bi bi-check-lg me-1"></i>}
                    {t('sso.enableButton')}
                  </Button>
                  <div className="mt-2">
                    <small className="text-muted">
                      <i className="bi bi-info-circle me-1"></i>
                      {t('sso.passwordFallback')}
                    </small>
                  </div>
                </div>
              )}

              {config?.configured && config.enabled && (
                <Alert variant="success" className="text-center">
                  <i className="bi bi-check-circle me-1"></i>
                  {t('sso.wizard.step4.alreadyEnabled')}
                </Alert>
              )}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowWizard(false)}>
            {wizardStep === 4 ? t('sso.wizard.close') : t('sso.wizard.cancel')}
          </Button>
          {wizardStep > 1 && wizardStep < 4 && (
            <Button variant="outline-primary" onClick={() => setWizardStep((s) => s - 1)}>
              {t('sso.wizard.back')}
            </Button>
          )}
          {wizardStep === 1 && (
            <Button variant="primary" onClick={() => setWizardStep(2)}>
              {t('sso.wizard.next')}
            </Button>
          )}
          {wizardStep === 2 && (
            <Button variant="primary" onClick={() => setWizardStep(3)} disabled={!canProceedToStep3}>
              {t('sso.wizard.next')}
            </Button>
          )}
          {wizardStep === 3 && (
            <Button variant="primary" onClick={handleSaveConfig} disabled={actionLoading}>
              {actionLoading ? (
                <>
                  <Spinner size="sm" className="me-1" />
                  {t('sso.wizard.saving')}
                </>
              ) : (
                t('sso.wizard.save')
              )}
            </Button>
          )}
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default SSOSettingsPanel;
