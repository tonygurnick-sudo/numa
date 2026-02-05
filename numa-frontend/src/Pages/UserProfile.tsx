import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Col, Container, Form, Row, Spinner, Tab, Tabs } from 'react-bootstrap';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { fromWebToken } from '@aws-sdk/credential-providers';
import { useAuth } from '../Providers/AuthProvider';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useTranslation } from 'react-i18next';
import {
  AdminChatSettingsService,
  DEFAULT_GLOBAL_CHAT_SETTINGS,
  type GlobalChatSettings,
} from '../Services/AdminChatSettingsService';
import {
  ChatSettingsService,
  DEFAULT_CHAT_SETTINGS,
  type UserChatSettingsUpdate,
} from '../Services/ChatSettingsService';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { withPRM } from '../utils/prmUtils';
import ExpandableOverflowBox from '../Components/ExpandableOverflowBox';
import { manifestService } from '../Services/manifestService';
import { applyLanguagePreference, LANGUAGE_BROWSER_DEFAULT } from '../utils/languagePreference';
import { getConnectionDisplayName } from '../config/integrationsConfig';

type Connection = { id: string; isConnected: boolean; mcpServerUrl?: string };

export default function UserProfilePage() {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const { numaGet, numaPut } = useNumaRequest();
  const { availableKBs, isLoadingKBs, kbError } = useKnowledgeBase();

  const [activeKey, setActiveKey] = useState<string>('user-defaults');

  const [globalAllowUserDefaults, setGlobalAllowUserDefaults] = useState<boolean>(false);
  const [globalLoaded, setGlobalLoaded] = useState<boolean>(false);
  const [companyDefaults, setCompanyDefaults] = useState<GlobalChatSettings>(DEFAULT_GLOBAL_CHAT_SETTINGS);

  const [userDefaultsEnabled, setUserDefaultsEnabled] = useState<boolean>(false);
  const [userDefaults, setUserDefaults] = useState(() => ({ ...DEFAULT_CHAT_SETTINGS }));
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState<boolean>(false);

  const hasWorkspaceChat = window.sessionStorage.getItem('NUMA_WORKSPACE_CHAT') === 'true';
  const hasPipedreamFeature = window.sessionStorage.getItem('PIPEDREAM_INTEGRATIONS') === 'true';
  const relayLambdaArn = window.sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN');
  const previewMode = !hasPipedreamFeature || !relayLambdaArn;
  const REGION = window.sessionStorage.getItem('REGION') || 'us-east-1';

  const [lambdaClient, setLambdaClient] = useState<LambdaClient | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState<boolean>(false);
  const [availableConnections, setAvailableConnections] = useState<Connection[]>([]);
  const [dataAnalysisAvailable, setDataAnalysisAvailable] = useState(true);
  const [globalIntegrationSettings, setGlobalIntegrationSettings] = useState<
    Record<string, { status: 'enabled' | 'disabled'; denyTools: string[] }>
  >({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const global = await AdminChatSettingsService.getGlobal(numaGet);
        if (cancelled) return;
        setCompanyDefaults(global);
        setGlobalAllowUserDefaults(Boolean(global.allowUserDefaults));
        if (!global.allowUserDefaults) {
          setUserDefaultsEnabled(false);
        }
      } catch {
        if (cancelled) return;
        setCompanyDefaults(DEFAULT_GLOBAL_CHAT_SETTINGS);
        setGlobalAllowUserDefaults(Boolean(DEFAULT_GLOBAL_CHAT_SETTINGS.allowUserDefaults));
        if (!DEFAULT_GLOBAL_CHAT_SETTINGS.allowUserDefaults) {
          setUserDefaultsEnabled(false);
        }
      } finally {
        if (!cancelled) setGlobalLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numaGet]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const apps = await manifestService.fetchAppsFromManifest();
        const dataAnalysisApp = apps?.find((app: { id?: string }) => app?.id === 'data-analysis');
        const status = String(dataAnalysisApp?.status || '').toLowerCase();
        if (!cancelled) setDataAnalysisAvailable(status === 'active');
      } catch (error) {
        console.warn('[UserProfile] Unable to determine data analysis availability', error);
        if (!cancelled) setDataAnalysisAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!dataAnalysisAvailable) {
      setUserDefaults((prev) => ({ ...prev, dataAnalysisEnabled: false }));
      setDirty(true);
    }
  }, [dataAnalysisAvailable]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await ChatSettingsService.getForProfile(numaGet);
        if (cancelled) return;
        setUserDefaults(res.settings);
        setUserDefaultsEnabled(res.userDefaultsEnabled);
        setError(null);
        setDirty(false);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message || t('userProfile.errors.loadDefaults'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numaGet]);

  const kbIdsSorted = useMemo(
    () => availableKBs.map((kb) => kb.kb_id).filter((id) => typeof id === 'string'),
    [availableKBs],
  );

  const canEditUserDefaults = globalLoaded && globalAllowUserDefaults;
  const canEditProfile = globalLoaded;

  useEffect(() => {
    const init = async () => {
      if (!user) return;
      if (previewMode) {
        setConnectionsLoading(false);
        setAvailableConnections([]);
        return;
      }

      try {
        const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS') || '{}');
        const userGroup = user.decoded_tokens?.idToken?.['cognito:groups']?.[0] || 'standard';
        const roleArn = GROUPS[userGroup]?.roleArn;
        const cognitoUserId = user.decoded_tokens?.idToken?.sub;
        if (!roleArn) {
          setConnectionsLoading(false);
          setAvailableConnections([]);
          return;
        }
        const credentials = fromWebToken({
          webIdentityToken: user.tokens.idToken,
          roleArn,
          roleSessionName: cognitoUserId,
        });
        const client = withPRM(LambdaClient, { region: REGION, credentials });
        setLambdaClient(client);
      } catch {
        setConnectionsLoading(false);
        setAvailableConnections([]);
      }
    };
    init();
  }, [REGION, previewMode, user]);

  useEffect(() => {
    (async () => {
      try {
        if (!user) return;
        const items = (await numaGet('/api/settings/integrations')) as Array<{
          integration: string;
          status: 'enabled' | 'disabled';
          denyTools: string[];
        }>;
        const map: Record<string, { status: 'enabled' | 'disabled'; denyTools: string[] }> = {};
        for (const item of items || []) {
          map[item.integration] = { status: item.status, denyTools: item.denyTools || [] };
        }
        setGlobalIntegrationSettings(map);
      } catch {
        /* ignore */
      }
    })();
  }, [numaGet, user]);

  useEffect(() => {
    const loadConnectionStatus = async () => {
      if (!lambdaClient || !user) return;
      try {
        setConnectionsLoading(true);
        const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
        const response = await PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId, {
          ttlMs: 30 * 60 * 1000,
        });

        const allConnections: Connection[] = (response.connections || []).map((conn) => ({
          id: conn.app_name,
          isConnected: conn.status === 'connected',
          mcpServerUrl: undefined,
        }));

        const connected = allConnections
          .filter((conn) => conn.isConnected)
          .filter((conn) => globalIntegrationSettings[conn.id]?.status !== 'disabled');

        setAvailableConnections(connected);
      } catch {
        setAvailableConnections([]);
      } finally {
        setConnectionsLoading(false);
      }
    };

    if (lambdaClient) {
      loadConnectionStatus();
    }
  }, [globalIntegrationSettings, lambdaClient, user]);

  // When user defaults are disabled, show company defaults in the form
  const displayedSettings = useMemo(() => {
    if (!userDefaultsEnabled) {
      return {
        defaultKBIds: companyDefaults.defaultKBIds,
        autoToolsEnabled: companyDefaults.autoToolsEnabled,
        webSearchEnabled: companyDefaults.webSearchEnabled,
        createAgentEnabled: companyDefaults.createAgentEnabled,
        dataAnalysisEnabled: companyDefaults.dataAnalysisEnabled,
        defaultConnectionIds: companyDefaults.defaultConnectionIds,
      };
    }
    return userDefaults;
  }, [userDefaultsEnabled, userDefaults, companyDefaults]);

  const enabledKBSet = useMemo(() => new Set(displayedSettings.defaultKBIds), [displayedSettings.defaultKBIds]);
  const enabledConnectionSet = useMemo(
    () => new Set(displayedSettings.defaultConnectionIds),
    [displayedSettings.defaultConnectionIds],
  );
  const getKBLabel = (kbId: string, kbName?: string) => {
    if (kbId === 'company') {
      return t('chatDefaults.companyKnowledgeBase');
    }
    return kbName || kbId;
  };

  const disableDefaultsForm = saving || loading || !canEditUserDefaults || !userDefaultsEnabled;
  const disableProfileForm = saving || loading;
  const resetToCompanyDefaults = () => {
    setUserDefaultsEnabled(true);
    setUserDefaults({
      defaultKBIds: companyDefaults.defaultKBIds,
      autoToolsEnabled: companyDefaults.autoToolsEnabled,
      webSearchEnabled: companyDefaults.webSearchEnabled,
      createAgentEnabled: companyDefaults.createAgentEnabled,
      dataAnalysisEnabled: companyDefaults.dataAnalysisEnabled,
      defaultConnectionIds: companyDefaults.defaultConnectionIds,
      language: LANGUAGE_BROWSER_DEFAULT,
    });
    setDirty(true);
  };

  const resetToBrowserDefaults = () => {
    setUserDefaults((prev) => ({ ...prev, language: LANGUAGE_BROWSER_DEFAULT }));
    setDirty(true);
  };

  const renderSaveActions = (resetLabelKey: string, onReset: () => void, onSave: () => void, canSave: boolean) => (
    <div className="d-flex gap-2">
      <Button variant="primary" disabled={!dirty || saving || !canSave} onClick={onSave}>
        {saving ? (
          <>
            <Spinner as="span" animation="border" size="sm" className="me-2" />
            {t('userProfile.actions.saving')}
          </>
        ) : (
          t('userProfile.actions.save')
        )}
      </Button>
      <Button variant="outline-secondary" disabled={saving || !canSave} onClick={onReset}>
        {t(resetLabelKey)}
      </Button>
    </div>
  );

  const handleSaveProfileLanguage = async () => {
    try {
      setSaving(true);
      setError(null);
      await ChatSettingsService.updateForProfile({ language: userDefaults.language }, numaPut);
      const refreshed = await ChatSettingsService.getForProfile(numaGet);
      setUserDefaults(refreshed.settings);
      setUserDefaultsEnabled(refreshed.userDefaultsEnabled);
      await applyLanguagePreference(refreshed.settings.language);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message || t('userProfile.errors.saveDefaults'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveUserDefaults = async () => {
    try {
      setSaving(true);
      setError(null);

      const payload: UserChatSettingsUpdate = {
        userDefaultsEnabled,
        defaultKBIds: userDefaults.defaultKBIds,
        autoToolsEnabled: userDefaults.autoToolsEnabled,
        webSearchEnabled: userDefaults.webSearchEnabled,
        createAgentEnabled: userDefaults.createAgentEnabled,
        dataAnalysisEnabled: userDefaults.dataAnalysisEnabled,
        defaultConnectionIds: userDefaults.defaultConnectionIds,
        language: userDefaults.language,
        approvalMode: userDefaults.approvalMode,
      };

      await ChatSettingsService.updateForProfile(payload, numaPut);
      const refreshed = await ChatSettingsService.getForProfile(numaGet);
      setUserDefaults(refreshed.settings);
      setUserDefaultsEnabled(refreshed.userDefaultsEnabled);
      await applyLanguagePreference(refreshed.settings.language);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message || t('userProfile.errors.saveDefaults'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dashboard">
      <header className="page-header">
        <Container fluid>
          <Row>
            <Col>
              <h1 className="page-title">{t('userProfile.title')}</h1>
            </Col>
          </Row>
        </Container>
      </header>

      <div className="app-content">
        <div className="content-panel">
          <div className="content-panel__body">
            {error && (
              <Alert variant="danger" className="mb-3">
                {error}
              </Alert>
            )}

            {!globalLoaded ? (
              <div className="text-center py-4">
                <Spinner animation="border" />
              </div>
            ) : null}

            <Tabs activeKey={activeKey} onSelect={(k) => k && setActiveKey(k)} className="mb-3">
              <Tab
                eventKey="user-settings"
                title={
                  <span>
                    <i className="bi bi-person-gear me-2"></i>
                    {t('userProfile.tabs.userSettings')}
                  </span>
                }
              >
                <Form>
                  <Form.Group className="mb-3">
                    <Form.Label className="fw-semibold">{t('userProfile.defaults.language.label')}</Form.Label>
                    <Form.Select
                      value={userDefaults.language ?? LANGUAGE_BROWSER_DEFAULT}
                      disabled={disableProfileForm}
                      onChange={(e) => {
                        setUserDefaults((prev) => ({ ...prev, language: e.target.value }));
                        setDirty(true);
                      }}
                    >
                      <option value={LANGUAGE_BROWSER_DEFAULT}>{t('userProfile.defaults.language.browser')}</option>
                      <option value="en">{t('userProfile.defaults.language.english')}</option>
                    </Form.Select>
                    <div className="text-muted small mt-1">{t('userProfile.defaults.language.help')}</div>
                  </Form.Group>
                  {renderSaveActions(
                    'userProfile.actions.resetBrowser',
                    resetToBrowserDefaults,
                    handleSaveProfileLanguage,
                    canEditProfile,
                  )}
                </Form>
              </Tab>
              <Tab
                eventKey="user-defaults"
                title={
                  <span>
                    <i className="bi bi-sliders me-2"></i>
                    {t('userProfile.tabs.chatDefaults')}
                  </span>
                }
              >
                {!globalAllowUserDefaults && (
                  <Alert variant="secondary" className="mb-3">
                    {t('userProfile.adminDisabled')}
                  </Alert>
                )}
                <Alert variant="secondary" className="mb-3">
                  {t('userProfile.defaults.description')}
                </Alert>

                <Form>
                  <div className="mb-3 p-3 border rounded-3 bg-light">
                    <div className="d-flex align-items-center justify-content-between gap-3">
                      <div className="fw-semibold">{t('userProfile.defaults.enableTitle')}</div>
                      <Form.Check
                        type="switch"
                        id="profile-defaults-enabled"
                        label=""
                        checked={userDefaultsEnabled}
                        disabled={!canEditUserDefaults || saving || loading}
                        onChange={(e) => {
                          setUserDefaultsEnabled(e.target.checked);
                          setDirty(true);
                        }}
                      />
                    </div>
                    <div className="text-muted small">{t('userProfile.defaults.enableHelp')}</div>
                  </div>

                  {loading ? (
                    <div className="text-center py-4">
                      <Spinner animation="border" />
                    </div>
                  ) : (
                    <>
                      <Form.Group className="mb-3">
                        <Form.Label className="fw-semibold">{t('userProfile.defaults.kbLabel')}</Form.Label>
                        {kbError && <div className="text-danger small mb-2">{kbError}</div>}

                        <ExpandableOverflowBox className="border rounded-3 p-2 bg-white" maxHeight={240}>
                          {isLoadingKBs ? (
                            <div className="text-muted small">{t('userProfile.defaults.kbLoading')}</div>
                          ) : (
                            kbIdsSorted.map((kbId) => {
                              const kb = availableKBs.find((k) => k.kb_id === kbId);
                              const label = getKBLabel(kbId, kb?.kb_name);
                              const checked = enabledKBSet.has(kbId);
                              return (
                                <Form.Check
                                  key={kbId}
                                  type="checkbox"
                                  id={`profile-defaults-kb-${kbId}`}
                                  label={label}
                                  checked={checked}
                                  disabled={disableDefaultsForm}
                                  onChange={(e) => {
                                    const nextChecked = e.target.checked;
                                    setUserDefaults((prev) => ({
                                      ...prev,
                                      defaultKBIds: nextChecked
                                        ? Array.from(new Set([...prev.defaultKBIds, kbId]))
                                        : prev.defaultKBIds.filter((id) => id !== kbId),
                                    }));
                                    setDirty(true);
                                  }}
                                />
                              );
                            })
                          )}
                          {!isLoadingKBs && kbIdsSorted.length === 0 && (
                            <div className="text-muted small">{t('userProfile.defaults.kbEmpty')}</div>
                          )}
                        </ExpandableOverflowBox>
                        <div className="text-muted small mt-1">{t('userProfile.defaults.kbHelp')}</div>
                      </Form.Group>

                      <div className="mb-3">
                        <div className="d-flex align-items-center gap-2">
                          <Form.Check
                            type="switch"
                            id="profile-defaults-all-tools"
                            label=""
                            checked={displayedSettings.autoToolsEnabled}
                            disabled={disableDefaultsForm}
                            onChange={(e) => {
                              const nextEnabled = e.target.checked;
                              setUserDefaults((prev) => ({
                                ...prev,
                                autoToolsEnabled: nextEnabled,
                                ...(nextEnabled
                                  ? { webSearchEnabled: true, dataAnalysisEnabled: true, createAgentEnabled: true }
                                  : { webSearchEnabled: false, dataAnalysisEnabled: false, createAgentEnabled: false }),
                              }));
                              setDirty(true);
                            }}
                          />
                          <div className="fw-semibold">{t('userProfile.defaults.allTools.title')}</div>
                        </div>
                        <div className="text-muted small ms-5">{t('userProfile.defaults.allTools.help')}</div>

                        <div className="mt-3 ms-4">
                          <div className="d-flex align-items-center gap-2">
                            <Form.Check
                              type="switch"
                              id="profile-defaults-web-search"
                              label=""
                              checked={displayedSettings.webSearchEnabled}
                              disabled={disableDefaultsForm || displayedSettings.autoToolsEnabled}
                              onChange={(e) => {
                                setUserDefaults((prev) => ({ ...prev, webSearchEnabled: e.target.checked }));
                                setDirty(true);
                              }}
                            />
                            <div className="fw-semibold">{t('userProfile.defaults.webSearch.title')}</div>
                          </div>
                          <div className="text-muted small ms-5">{t('userProfile.defaults.webSearch.help')}</div>
                        </div>

                        {dataAnalysisAvailable && (
                          <div className="mt-3 ms-4">
                            <div className="d-flex align-items-center gap-2">
                              <Form.Check
                                type="switch"
                                id="profile-defaults-data-analysis"
                                label=""
                                checked={displayedSettings.dataAnalysisEnabled}
                                disabled={disableDefaultsForm || displayedSettings.autoToolsEnabled}
                                onChange={(e) => {
                                  setUserDefaults((prev) => ({ ...prev, dataAnalysisEnabled: e.target.checked }));
                                  setDirty(true);
                                }}
                              />
                              <div className="fw-semibold">{t('userProfile.defaults.dataAnalysis.title')}</div>
                            </div>
                            <div className="text-muted small ms-5">{t('userProfile.defaults.dataAnalysis.help')}</div>
                          </div>
                        )}

                        <div className="mt-3 ms-4">
                          <div className="d-flex align-items-center gap-2">
                            <Form.Check
                              type="switch"
                              id="profile-defaults-create-agent"
                              label=""
                              checked={displayedSettings.createAgentEnabled}
                              disabled={disableDefaultsForm || displayedSettings.autoToolsEnabled}
                              onChange={(e) => {
                                setUserDefaults((prev) => ({ ...prev, createAgentEnabled: e.target.checked }));
                                setDirty(true);
                              }}
                            />
                            <div className="fw-semibold">{t('userProfile.defaults.agentCreation.title')}</div>
                          </div>
                          <div className="text-muted small ms-5">{t('userProfile.defaults.agentCreation.help')}</div>
                        </div>
                      </div>

                      <Form.Group className="mb-3">
                        <Form.Label className="fw-semibold">{t('userProfile.defaults.integrations.label')}</Form.Label>
                        {previewMode ? (
                          <div className="text-muted small">{t('userProfile.defaults.integrations.disabled')}</div>
                        ) : connectionsLoading ? (
                          <div className="text-muted small">{t('userProfile.defaults.integrations.loading')}</div>
                        ) : (
                          <>
                            <ExpandableOverflowBox className="border rounded-3 p-2 bg-white" maxHeight={240}>
                              {availableConnections
                                .sort((a, b) =>
                                  getConnectionDisplayName(a.id).localeCompare(getConnectionDisplayName(b.id)),
                                )
                                .map((conn) => {
                                  const id = conn.id;
                                  const checked = enabledConnectionSet.has(id);
                                  return (
                                    <Form.Check
                                      key={id}
                                      type="checkbox"
                                      id={`profile-defaults-integration-${id}`}
                                      label={getConnectionDisplayName(id)}
                                      checked={checked}
                                      disabled={disableDefaultsForm}
                                      onChange={(e) => {
                                        const nextChecked = e.target.checked;
                                        setUserDefaults((prev) => ({
                                          ...prev,
                                          defaultConnectionIds: nextChecked
                                            ? Array.from(new Set([...prev.defaultConnectionIds, id]))
                                            : prev.defaultConnectionIds.filter((x) => x !== id),
                                        }));
                                        setDirty(true);
                                      }}
                                    />
                                  );
                                })}
                              {availableConnections.length === 0 && (
                                <div className="text-muted small">{t('userProfile.defaults.integrations.empty')}</div>
                              )}
                            </ExpandableOverflowBox>
                            <div className="text-muted small mt-1">{t('userProfile.defaults.integrations.help')}</div>
                          </>
                        )}
                      </Form.Group>

                      {renderSaveActions(
                        'userProfile.actions.reset',
                        resetToCompanyDefaults,
                        handleSaveUserDefaults,
                        canEditUserDefaults,
                      )}
                    </>
                  )}
                </Form>
              </Tab>

              {hasWorkspaceChat && (
                <Tab
                  eventKey="approval-settings"
                  title={
                    <span>
                      <i className="bi bi-shield-check me-2"></i>
                      {t('userProfile.tabs.approvalSettings')}
                    </span>
                  }
                >
                  <Form>
                    <p className="text-muted mb-3">{t('userProfile.approval.description')}</p>
                    <Form.Group className="mb-3">
                      <Form.Label className="fw-semibold">{t('userProfile.approval.label')}</Form.Label>
                      {(['always', 'non_destructive', 'never'] as const).map((mode) => (
                        <Form.Check
                          key={mode}
                          type="radio"
                          id={`approval-mode-${mode}`}
                          name="approvalMode"
                          label={t(`userProfile.approval.modes.${mode}.label`)}
                          checked={userDefaults.approvalMode === mode}
                          disabled={disableDefaultsForm}
                          onChange={() => {
                            setUserDefaults((prev) => ({ ...prev, approvalMode: mode }));
                            setDirty(true);
                          }}
                          className="mb-2"
                        />
                      ))}
                      <div className="text-muted small mt-1">
                        {t(`userProfile.approval.modes.${userDefaults.approvalMode}.help`)}
                      </div>
                    </Form.Group>
                    {renderSaveActions(
                      'userProfile.actions.reset',
                      resetToCompanyDefaults,
                      handleSaveUserDefaults,
                      canEditUserDefaults,
                    )}
                  </Form>
                </Tab>
              )}
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}
