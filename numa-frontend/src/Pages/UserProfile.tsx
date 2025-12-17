import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Col, Container, Form, Row, Spinner, Tab, Tabs } from 'react-bootstrap';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { fromWebToken } from '@aws-sdk/credential-providers';
import { useAuth } from '../Providers/AuthProvider';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import { useNumaRequest } from '../Providers/NumaRequestContext';
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

type Connection = { id: string; name: string; isConnected: boolean; mcpServerUrl?: string };

export default function UserProfilePage() {
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

  const hasPipedreamFeature = window.sessionStorage.getItem('PIPEDREAM_INTEGRATIONS') === 'true';
  const relayLambdaArn = window.sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN');
  const previewMode = !hasPipedreamFeature || !relayLambdaArn;
  const REGION = window.sessionStorage.getItem('REGION') || 'us-east-1';

  const [lambdaClient, setLambdaClient] = useState<LambdaClient | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState<boolean>(false);
  const [availableConnections, setAvailableConnections] = useState<Connection[]>([]);
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
        setLoading(true);
        const res = await ChatSettingsService.getForProfile(numaGet);
        if (cancelled) return;
        setUserDefaults(res.settings);
        setUserDefaultsEnabled(res.userDefaultsEnabled);
        setError(null);
        setDirty(false);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message || 'Failed to load defaults');
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

  const canEdit = globalLoaded && globalAllowUserDefaults;

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
          name: conn.app_name,
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

  const disableForm = saving || loading || !canEdit || !userDefaultsEnabled;

  return (
    <div className="dashboard">
      <header className="page-header">
        <Container fluid>
          <Row>
            <Col>
              <h1 className="page-title">Profile</h1>
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
            ) : !globalAllowUserDefaults ? (
              <Alert variant="secondary" className="mb-3">
                Your admin has disabled personal defaults. You’ll use company defaults when starting new chats.
              </Alert>
            ) : null}

            <Tabs activeKey={activeKey} onSelect={(k) => k && setActiveKey(k)} className="mb-3">
              <Tab
                eventKey="user-defaults"
                title={
                  <span>
                    <i className="bi bi-sliders me-2"></i>User Defaults
                  </span>
                }
              >
                <Alert variant="secondary" className="mb-3">
                  These defaults apply when you start a new chat without selecting an agent.
                </Alert>

                <Form>
                  <div className="mb-3 p-3 border rounded-3 bg-light">
                    <div className="d-flex align-items-center justify-content-between gap-3">
                      <div className="fw-semibold">Enable my defaults</div>
                      <Form.Check
                        type="switch"
                        id="profile-defaults-enabled"
                        label=""
                        checked={userDefaultsEnabled}
                        disabled={!canEdit || saving || loading}
                        onChange={(e) => {
                          setUserDefaultsEnabled(e.target.checked);
                          setDirty(true);
                        }}
                      />
                    </div>
                    <div className="text-muted small">
                      When off, new chats will use company defaults. Your saved defaults remain available when you turn
                      this back on.
                    </div>
                  </div>

                  {loading ? (
                    <div className="text-center py-4">
                      <Spinner animation="border" />
                    </div>
                  ) : (
                    <>
                      <Form.Group className="mb-3">
                        <Form.Label className="fw-semibold">Default knowledge bases</Form.Label>
                        {kbError && <div className="text-danger small mb-2">{kbError}</div>}

                        <ExpandableOverflowBox className="border rounded-3 p-2 bg-white" maxHeight={240}>
                          {isLoadingKBs ? (
                            <div className="text-muted small">Loading knowledge bases…</div>
                          ) : (
                            kbIdsSorted.map((kbId) => {
                              const kb = availableKBs.find((k) => k.kb_id === kbId);
                              const label = kb?.kb_name || kbId;
                              const checked = enabledKBSet.has(kbId);
                              return (
                                <Form.Check
                                  key={kbId}
                                  type="checkbox"
                                  id={`profile-defaults-kb-${kbId}`}
                                  label={label}
                                  checked={checked}
                                  disabled={disableForm}
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
                            <div className="text-muted small">No knowledge bases available.</div>
                          )}
                        </ExpandableOverflowBox>
                        <div className="text-muted small mt-1">
                          Select one or more knowledge bases to enable by default.
                        </div>
                      </Form.Group>

                      <div className="mb-3">
                        <div className="d-flex align-items-center gap-2">
                          <Form.Check
                            type="switch"
                            id="profile-defaults-all-tools"
                            label=""
                            checked={displayedSettings.autoToolsEnabled}
                            disabled={disableForm}
                            onChange={(e) => {
                              const nextEnabled = e.target.checked;
                              setUserDefaults((prev) => ({
                                ...prev,
                                autoToolsEnabled: nextEnabled,
                                ...(nextEnabled
                                  ? { webSearchEnabled: true, createAgentEnabled: true }
                                  : { webSearchEnabled: false, createAgentEnabled: false }),
                              }));
                              setDirty(true);
                            }}
                          />
                          <div className="fw-semibold">All Tools</div>
                        </div>
                        <div className="text-muted small ms-5">When enabled, all tools are automatically available</div>

                        <div className="mt-3 ms-4">
                          <div className="d-flex align-items-center gap-2">
                            <Form.Check
                              type="switch"
                              id="profile-defaults-web-search"
                              label=""
                              checked={displayedSettings.webSearchEnabled}
                              disabled={disableForm || displayedSettings.autoToolsEnabled}
                              onChange={(e) => {
                                setUserDefaults((prev) => ({ ...prev, webSearchEnabled: e.target.checked }));
                                setDirty(true);
                              }}
                            />
                            <div className="fw-semibold">Web Search</div>
                          </div>
                          <div className="text-muted small ms-5">Search the web for current information</div>
                        </div>

                        <div className="mt-3 ms-4">
                          <div className="d-flex align-items-center gap-2">
                            <Form.Check
                              type="switch"
                              id="profile-defaults-create-agent"
                              label=""
                              checked={displayedSettings.createAgentEnabled}
                              disabled={disableForm || displayedSettings.autoToolsEnabled}
                              onChange={(e) => {
                                setUserDefaults((prev) => ({ ...prev, createAgentEnabled: e.target.checked }));
                                setDirty(true);
                              }}
                            />
                            <div className="fw-semibold">Agent Creation</div>
                          </div>
                          <div className="text-muted small ms-5">
                            Allow me to create saved agents when you explicitly ask.
                          </div>
                        </div>
                      </div>

                      <Form.Group className="mb-3">
                        <Form.Label className="fw-semibold">Default integrations</Form.Label>
                        {previewMode ? (
                          <div className="text-muted small">Integrations are not enabled in this environment.</div>
                        ) : connectionsLoading ? (
                          <div className="text-muted small">Loading integrations…</div>
                        ) : (
                          <>
                            <ExpandableOverflowBox className="border rounded-3 p-2 bg-white" maxHeight={240}>
                              {availableConnections
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((conn) => {
                                  const id = conn.id;
                                  const checked = enabledConnectionSet.has(id);
                                  return (
                                    <Form.Check
                                      key={id}
                                      type="checkbox"
                                      id={`profile-defaults-integration-${id}`}
                                      label={conn.name}
                                      checked={checked}
                                      disabled={disableForm}
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
                                <div className="text-muted small">No connected integrations available.</div>
                              )}
                            </ExpandableOverflowBox>
                            <div className="text-muted small mt-1">
                              Select one or more integrations to enable by default.
                            </div>
                          </>
                        )}
                      </Form.Group>

                      <div className="d-flex gap-2">
                        <Button
                          variant="primary"
                          disabled={!dirty || saving || !canEdit}
                          onClick={async () => {
                            try {
                              setSaving(true);
                              setError(null);

                              const payload: UserChatSettingsUpdate = {
                                userDefaultsEnabled,
                                defaultKBIds: userDefaults.defaultKBIds,
                                autoToolsEnabled: userDefaults.autoToolsEnabled,
                                webSearchEnabled: userDefaults.webSearchEnabled,
                                createAgentEnabled: userDefaults.createAgentEnabled,
                                defaultConnectionIds: userDefaults.defaultConnectionIds,
                              };

                              await ChatSettingsService.updateForProfile(payload, numaPut);
                              const refreshed = await ChatSettingsService.getForProfile(numaGet);
                              setUserDefaults(refreshed.settings);
                              setUserDefaultsEnabled(refreshed.userDefaultsEnabled);
                              setDirty(false);
                            } catch (e) {
                              setError((e as Error).message || 'Failed to save defaults');
                            } finally {
                              setSaving(false);
                            }
                          }}
                        >
                          {saving ? (
                            <>
                              <Spinner as="span" animation="border" size="sm" className="me-2" />
                              Saving...
                            </>
                          ) : (
                            'Save Changes'
                          )}
                        </Button>
                        <Button
                          variant="outline-secondary"
                          disabled={saving || !canEdit}
                          onClick={() => {
                            setUserDefaultsEnabled(true);
                            setUserDefaults({
                              defaultKBIds: companyDefaults.defaultKBIds,
                              autoToolsEnabled: companyDefaults.autoToolsEnabled,
                              webSearchEnabled: companyDefaults.webSearchEnabled,
                              createAgentEnabled: companyDefaults.createAgentEnabled,
                              defaultConnectionIds: companyDefaults.defaultConnectionIds,
                            });
                            setDirty(true);
                          }}
                        >
                          Reset to company defaults
                        </Button>
                      </div>
                    </>
                  )}
                </Form>
              </Tab>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}
