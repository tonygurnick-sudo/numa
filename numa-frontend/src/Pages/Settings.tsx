import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Container,
  Row,
  Col,
  Tabs,
  Tab,
  Button,
  Spinner,
  Modal,
  Alert,
  OverlayTrigger,
  Tooltip,
  Form,
} from 'react-bootstrap';
import UserManagement from './UserManagement';
import { useAuth } from '../Providers/AuthProvider';
import { AdminIntegrationsService, type GlobalIntegrationSettingsMap } from '../Services/AdminIntegrationsService';
import { AdminAgentsService, type AgentsMode } from '../Services/AdminAgentsService';
import { getIntegrationsListFormat, type IntegrationListItem } from '../config/integrationsConfig';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { fromWebToken } from '@aws-sdk/credential-providers';
import { withPRM } from '../utils/prmUtils';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import BrandingAdminPanel from '../Components/Branding/BrandingAdminPanel';
import { UNSAFE_NavigationContext } from 'react-router-dom';
import {
  AdminChatSettingsService,
  type GlobalChatSettings,
  DEFAULT_GLOBAL_CHAT_SETTINGS,
} from '../Services/AdminChatSettingsService';
import ExpandableOverflowBox from '../Components/ExpandableOverflowBox';

const AVAILABLE_INTEGRATIONS: IntegrationListItem[] = getIntegrationsListFormat();

const useNavigationConfirm = (when: boolean, message: string) => {
  const navigationContext = useContext(UNSAFE_NavigationContext);

  useEffect(() => {
    if (!when) {
      return;
    }

    const navigator = navigationContext?.navigator as {
      block?: (blocker: (tx: { retry: () => void }) => void) => () => void;
    } | null;
    if (!navigator?.block) {
      return;
    }

    const unblock = navigator.block((tx: { retry: () => void }) => {
      const confirmLeave = window.confirm(message);
      if (confirmLeave) {
        unblock();
        tx.retry();
      }
    });

    return () => {
      unblock();
    };
  }, [navigationContext, when, message]);
};

export default function SettingsPage() {
  const { user } = useAuth();
  const { numaGet, numaPut } = useNumaRequest();
  const [activeKey, setActiveKey] = useState<string>('users');
  const brandingFlag =
    typeof window !== 'undefined' ? window.sessionStorage.getItem('BRANDING_PROVIDER_ENABLED') : null;
  const brandingApiEnabled = brandingFlag === 'true';
  const isAdmin = Boolean(user?.groups?.includes('admin'));
  const allowBrandingTab = brandingApiEnabled && isAdmin;
  const agentsFeatureEnabled =
    typeof window !== 'undefined' ? window.sessionStorage.getItem('AGENTS') === 'true' : false;

  // Global (admin) settings
  const [globalSettings, setGlobalSettings] = useState<GlobalIntegrationSettingsMap>({});
  const [loadingSettings, setLoadingSettings] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Agents (admin) settings
  const [agentsMode, setAgentsMode] = useState<AgentsMode>('full');
  const [agentsLoading, setAgentsLoading] = useState<boolean>(true);
  const [agentsSaving, setAgentsSaving] = useState<boolean>(false);

  // Pipedream feature + relay
  const hasPipedreamFeature = window.sessionStorage.getItem('PIPEDREAM_INTEGRATIONS') === 'true';
  const relayLambdaArn = window.sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN');
  const previewMode = !hasPipedreamFeature || !relayLambdaArn;

  // AWS Lambda client for listing tools (admin view)
  const [lambdaClient, setLambdaClient] = useState<LambdaClient | null>(null);

  useEffect(() => {
    const initLambda = async () => {
      if (!user || previewMode) return;
      try {
        const REGION = window.sessionStorage.getItem('REGION') || 'us-east-1';
        const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS') || '{}');
        const userGroup = user.decoded_tokens?.idToken?.['cognito:groups']?.[0] || 'standard';
        const roleArn = GROUPS[userGroup]?.roleArn;
        const cognitoUserId = user.decoded_tokens?.idToken?.sub;
        if (!roleArn) return;
        const credentials = fromWebToken({
          webIdentityToken: user.tokens.idToken,
          roleArn,
          roleSessionName: cognitoUserId,
        });
        setLambdaClient(withPRM(LambdaClient, { region: REGION, credentials }));
      } catch (e) {
        console.error('Settings: init lambda failed', e);
      }
    };
    initLambda();
  }, [user, previewMode]);

  const loadGlobal = async () => {
    try {
      setLoadingSettings(true);
      if (!user) return;
      const data = await AdminIntegrationsService.listWithNuma(numaGet);
      setGlobalSettings(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Failed to load settings');
    } finally {
      setLoadingSettings(false);
    }
  };

  useEffect(() => {
    if (previewMode) {
      // Feature disabled: avoid calling the API and clear loading state
      setGlobalSettings({});
      setLoadingSettings(false);
      return;
    }
    loadGlobal();
  }, [user, numaGet, previewMode]);

  // Load Agents settings
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setAgentsLoading(true);
        const res = await AdminAgentsService.get(numaGet);
        if (!cancelled) setAgentsMode(res.mode);
      } catch (e) {
        console.warn('Settings: failed to load agents settings', e);
        if (!cancelled) setAgentsMode('full');
      } finally {
        if (!cancelled) setAgentsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, numaGet]);

  // Integrations tab internal state
  const [manageToolsFor, setManageToolsFor] = useState<string | null>(null);
  const [toolsLoading, setToolsLoading] = useState<boolean>(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [toolList, setToolList] = useState<{ name: string; description?: string }[]>([]);
  const [toolToggles, setToolToggles] = useState<Record<string, boolean>>({});
  const [isBrandingDirty, setIsBrandingDirty] = useState<boolean>(false);

  useNavigationConfirm(
    activeKey === 'branding' && isBrandingDirty,
    'You have unsaved branding changes. Leaving this page will discard them. Continue?',
  );

  // Chat defaults (company-wide)
  const [globalChatSettings, setGlobalChatSettings] = useState<GlobalChatSettings>(DEFAULT_GLOBAL_CHAT_SETTINGS);
  const [chatDefaultsLoading, setChatDefaultsLoading] = useState<boolean>(true);
  const [chatDefaultsSaving, setChatDefaultsSaving] = useState<boolean>(false);
  const [chatDefaultsError, setChatDefaultsError] = useState<string | null>(null);
  const [chatDefaultsDirty, setChatDefaultsDirty] = useState<boolean>(false);
  const chatDefaultsDirtyRef = useRef<boolean>(chatDefaultsDirty);

  useEffect(() => {
    chatDefaultsDirtyRef.current = chatDefaultsDirty;
  }, [chatDefaultsDirty]);

  useNavigationConfirm(
    activeKey === 'chat-defaults' && chatDefaultsDirty,
    'You have unsaved chat default changes. Leaving this tab will discard them. Continue?',
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setChatDefaultsLoading(true);
        const settings = await AdminChatSettingsService.getGlobal(numaGet);
        if (!cancelled) {
          if (!chatDefaultsDirtyRef.current) {
            setGlobalChatSettings(settings);
            setChatDefaultsError(null);
            setChatDefaultsDirty(false);
          }
        }
      } catch (e) {
        if (!cancelled) setChatDefaultsError((e as Error).message || 'Failed to load chat defaults');
      } finally {
        if (!cancelled) setChatDefaultsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numaGet]);

  const openManageTools = async (integrationId: string) => {
    if (!lambdaClient || !user) return;
    try {
      setManageToolsFor(integrationId);
      setToolsLoading(true);
      setToolsError(null);
      const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
      const { tools } = await PipedreamProxyService.listMcpTools(lambdaClient, externalUserId, integrationId);
      const globalDeny = new Set(globalSettings[integrationId]?.denyTools || []);
      const toggles: Record<string, boolean> = {};
      (tools || []).forEach((t) => (toggles[t.name] = !globalDeny.has(t.name)));
      setToolList(tools || []);
      setToolToggles(toggles);
    } catch (e) {
      setToolsError((e as Error).message || 'Failed to load tools');
    } finally {
      setToolsLoading(false);
    }
  };

  const saveManageTools = async () => {
    if (!manageToolsFor) return;
    try {
      const denyTools = Object.entries(toolToggles)
        .filter(([, allowed]) => !allowed)
        .map(([name]) => name);
      await AdminIntegrationsService.updateWithNuma(
        manageToolsFor,
        {
          status: globalSettings[manageToolsFor]?.status || 'disabled',
          denyTools,
        },
        numaPut,
      );
      await loadGlobal();
      setManageToolsFor(null);
    } catch (e) {
      setToolsError((e as Error).message || 'Failed to save');
    }
  };

  const toggleIntegration = async (integrationId: string, nextEnabled: boolean) => {
    try {
      if (!nextEnabled && globalSettings[integrationId]?.status === 'enabled') {
        const ok = window.confirm(`Disabling ${integrationId} will prevent users from accessing it in Numa. Continue?`);
        if (!ok) return;
      }
      await AdminIntegrationsService.updateWithNuma(
        integrationId,
        {
          status: nextEnabled ? 'enabled' : 'disabled',
          denyTools: globalSettings[integrationId]?.denyTools || [],
        },
        numaPut,
      );
      await loadGlobal();
    } catch (e) {
      setError((e as Error).message || 'Failed to update integration');
    }
  };

  const handleBrandingDirtyChange = useCallback((dirty: boolean) => {
    setIsBrandingDirty(dirty);
  }, []);

  const handleTabSelect = useCallback(
    (nextKey: string | null) => {
      if (!nextKey) {
        return;
      }

      if (activeKey === 'branding' && nextKey !== 'branding' && isBrandingDirty) {
        const confirmLeave = window.confirm(
          'You have unsaved branding changes. Leaving this tab will discard them. Continue?',
        );

        if (!confirmLeave) {
          return;
        }

        setIsBrandingDirty(false);
      }

      setActiveKey(nextKey);
    },
    [activeKey, isBrandingDirty],
  );

  const renderIntegrationRow = (integration: IntegrationListItem) => {
    const id = integration.name_slug;
    const enabled = globalSettings[id]?.status === 'enabled';
    const deniedCount = globalSettings[id]?.denyTools?.length || 0;
    const disabledByPreview = previewMode;

    return (
      <div
        key={id}
        className="border rounded-3 p-3 mb-2 bg-white"
        style={{
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          transition: 'all 0.2s ease',
          opacity: enabled || disabledByPreview ? 1 : 0.75,
          cursor: 'default',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
        }}
      >
        <div className="row align-items-center">
          <div className="col-md-6 d-flex align-items-center">
            <div
              className="rounded-2 d-flex align-items-center justify-content-center me-3 flex-shrink-0"
              style={{ width: '48px', height: '48px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6' }}
            >
              <img
                src={integration.img_src}
                alt={integration.name}
                width={32}
                height={32}
                style={{ objectFit: 'contain' }}
              />
            </div>
            <div>
              <div className="fw-semibold" style={{ fontSize: '0.95rem' }}>
                {integration.name}
              </div>
              <div className="text-muted small" style={{ fontSize: '0.85rem', lineHeight: '1.4' }}>
                {integration.description}
              </div>
            </div>
          </div>
          <div className="col-md-6 d-flex justify-content-end gap-2 align-items-center">
            {disabledByPreview ? (
              <OverlayTrigger
                placement="top"
                overlay={
                  <Tooltip>
                    Numa Integrations are not enabled in your Numa environment. Contact your account administrator to
                    request access.
                  </Tooltip>
                }
              >
                <div>
                  <Form.Check
                    type="switch"
                    id={`toggle-${id}`}
                    checked={enabled}
                    disabled
                    label={<span className="small">{enabled ? 'Enabled' : 'Disabled'}</span>}
                  />
                </div>
              </OverlayTrigger>
            ) : (
              <Form.Check
                type="switch"
                id={`toggle-${id}`}
                checked={enabled}
                onChange={() => toggleIntegration(id, !enabled)}
                label={<span className="small">{enabled ? 'Enabled' : 'Disabled'}</span>}
              />
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() => openManageTools(id)}
              disabled={disabledByPreview}
              className="d-flex align-items-center"
            >
              <i className="bi bi-sliders me-2"></i>
              Manage Tools{' '}
              {deniedCount > 0 && (
                <span className="ms-1 badge bg-light text-dark" style={{ fontSize: '0.7rem' }}>
                  {deniedCount} off
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="dashboard">
      <header className="page-header">
        <Container fluid>
          <Row>
            <Col>
              <h1 className="page-title">Admin Settings</h1>
            </Col>
          </Row>
        </Container>
      </header>

      <div className="app-content">
        <div className="content-panel">
          <div className="content-panel__body">
            {/* Note: company-wide banner and preview notice moved into Integrations tab */}

            {error && (
              <Alert variant="danger" className="mb-3">
                {error}
              </Alert>
            )}
            <Tabs activeKey={activeKey} onSelect={handleTabSelect} className="mb-3">
              <Tab
                eventKey="users"
                title={
                  <span>
                    <i className="bi bi-people-fill me-2"></i>Users
                  </span>
                }
              >
                <UserManagement />
              </Tab>
              {allowBrandingTab && (
                <Tab
                  eventKey="branding"
                  title={
                    <span>
                      <i className="bi bi-palette-fill me-2"></i>Branding
                    </span>
                  }
                >
                  <BrandingAdminPanel onDirtyChange={handleBrandingDirtyChange} />
                </Tab>
              )}
              {isAdmin && (
                <Tab
                  eventKey="chat-defaults"
                  title={
                    <span>
                      <i className="bi bi-chat-dots-fill me-2"></i>Chat Defaults
                    </span>
                  }
                >
                  <div className="mb-3">
                    <Alert variant="secondary" className="mb-3">
                      <div className="d-flex align-items-start">
                        <i className="bi bi-building-gear me-2 mt-1"></i>
                        <div>
                          <div className="fw-semibold">Company-wide chat defaults</div>
                          <div className="small text-muted">
                            These defaults apply when users start a new chat without selecting an agent. If user
                            defaults are allowed, users can override these for themselves.
                          </div>
                        </div>
                      </div>
                    </Alert>

                    {chatDefaultsError && (
                      <Alert variant="danger" className="mb-3">
                        {chatDefaultsError}
                      </Alert>
                    )}

                    {chatDefaultsLoading ? (
                      <div className="text-center py-4">
                        <Spinner animation="border" />
                      </div>
                    ) : (
                      <Form>
                        <div className="mb-3 p-3 border rounded-3 bg-light">
                          <div className="d-flex align-items-start gap-2">
                            <i className="bi bi-shield-lock-fill text-primary mt-1"></i>
                            <div className="flex-grow-1">
                              <div className="d-flex align-items-center justify-content-between gap-3">
                                <div className="fw-semibold">Allow users to override company defaults</div>
                                <Form.Check
                                  type="switch"
                                  id="chat-defaults-allow-user-defaults"
                                  label=""
                                  checked={globalChatSettings.allowUserDefaults}
                                  onChange={(e) => {
                                    setGlobalChatSettings((prev) => ({ ...prev, allowUserDefaults: e.target.checked }));
                                    setChatDefaultsDirty(true);
                                  }}
                                />
                              </div>
                              <div className="text-muted small">
                                When this setting is inactive, users will only get the company defaults.
                              </div>
                            </div>
                          </div>
                        </div>

                        <Form.Group className="mb-3">
                          <Form.Label className="fw-semibold">Default knowledge bases</Form.Label>
                          <div className="d-flex align-items-center gap-2">
                            <Form.Check
                              type="switch"
                              id="chat-defaults-kb-company"
                              label=""
                              checked={globalChatSettings.defaultKBIds.includes('company')}
                              onChange={(e) => {
                                const nextChecked = e.target.checked;
                                setGlobalChatSettings((prev) => ({
                                  ...prev,
                                  defaultKBIds: nextChecked ? ['company'] : [],
                                }));
                                setChatDefaultsDirty(true);
                              }}
                            />
                            <div className="fw-semibold">Company Knowledge Base</div>
                          </div>
                          <div className="text-muted small ms-5">
                            Only the company knowledge base can be set as a company default; user KB defaults can be set
                            by the user only, and only if personal defaults are active.
                          </div>
                        </Form.Group>

                        <div className="mb-3">
                          <div className="d-flex align-items-center gap-2">
                            <Form.Check
                              type="switch"
                              id="chat-defaults-all-tools"
                              label=""
                              checked={globalChatSettings.autoToolsEnabled}
                              onChange={(e) => {
                                const nextEnabled = e.target.checked;
                                setGlobalChatSettings((prev) => ({
                                  ...prev,
                                  autoToolsEnabled: nextEnabled,
                                  ...(nextEnabled
                                    ? { webSearchEnabled: true, createAgentEnabled: true }
                                    : { webSearchEnabled: false, createAgentEnabled: false }),
                                }));
                                setChatDefaultsDirty(true);
                              }}
                            />
                            <div className="fw-semibold">All Tools</div>
                          </div>
                          <div className="text-muted small ms-5">
                            When enabled, all tools are automatically available
                          </div>

                          <div className="mt-3 ms-4">
                            <div className="d-flex align-items-center gap-2">
                              <Form.Check
                                type="switch"
                                id="chat-defaults-web-search"
                                label=""
                                checked={globalChatSettings.webSearchEnabled}
                                disabled={globalChatSettings.autoToolsEnabled}
                                onChange={(e) => {
                                  setGlobalChatSettings((prev) => ({ ...prev, webSearchEnabled: e.target.checked }));
                                  setChatDefaultsDirty(true);
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
                                id="chat-defaults-create-agent"
                                label=""
                                checked={globalChatSettings.createAgentEnabled}
                                disabled={globalChatSettings.autoToolsEnabled}
                                onChange={(e) => {
                                  setGlobalChatSettings((prev) => ({ ...prev, createAgentEnabled: e.target.checked }));
                                  setChatDefaultsDirty(true);
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
                          ) : (
                            <>
                              <ExpandableOverflowBox className="border rounded-3 p-2 bg-white" maxHeight={240}>
                                {AVAILABLE_INTEGRATIONS.filter((integration) => {
                                  const id = integration.name_slug;
                                  return globalSettings[id]?.status === 'enabled';
                                }).map((integration) => {
                                  const id = integration.name_slug;
                                  const checked = globalChatSettings.defaultConnectionIds.includes(id);
                                  return (
                                    <Form.Check
                                      key={id}
                                      type="checkbox"
                                      id={`chat-defaults-integration-${id}`}
                                      label={integration.name}
                                      checked={checked}
                                      disabled={loadingSettings}
                                      onChange={(e) => {
                                        const nextChecked = e.target.checked;
                                        setGlobalChatSettings((prev) => ({
                                          ...prev,
                                          defaultConnectionIds: nextChecked
                                            ? [...prev.defaultConnectionIds, id]
                                            : prev.defaultConnectionIds.filter((x) => x !== id),
                                        }));
                                        setChatDefaultsDirty(true);
                                      }}
                                    />
                                  );
                                })}
                                {AVAILABLE_INTEGRATIONS.filter((integration) => {
                                  const id = integration.name_slug;
                                  return globalSettings[id]?.status === 'enabled';
                                }).length === 0 && (
                                  <div className="text-muted small">
                                    No integrations are enabled for this environment.
                                  </div>
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
                            disabled={!chatDefaultsDirty || chatDefaultsSaving}
                            onClick={async () => {
                              try {
                                setChatDefaultsSaving(true);
                                const saved = await AdminChatSettingsService.updateGlobal(
                                  {
                                    defaultKBIds: globalChatSettings.defaultKBIds,
                                    autoToolsEnabled: globalChatSettings.autoToolsEnabled,
                                    webSearchEnabled: globalChatSettings.webSearchEnabled,
                                    createAgentEnabled: globalChatSettings.createAgentEnabled,
                                    defaultConnectionIds: globalChatSettings.defaultConnectionIds,
                                    allowUserDefaults: globalChatSettings.allowUserDefaults,
                                  },
                                  numaPut,
                                );
                                setGlobalChatSettings(saved);
                                setChatDefaultsError(null);
                                setChatDefaultsDirty(false);
                              } catch (e) {
                                setChatDefaultsError((e as Error).message || 'Failed to save chat defaults');
                              } finally {
                                setChatDefaultsSaving(false);
                              }
                            }}
                          >
                            {chatDefaultsSaving ? (
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
                            disabled={chatDefaultsSaving}
                            onClick={() => {
                              setGlobalChatSettings(DEFAULT_GLOBAL_CHAT_SETTINGS);
                              setChatDefaultsDirty(true);
                            }}
                          >
                            Reset to defaults
                          </Button>
                        </div>
                      </Form>
                    )}
                  </div>
                </Tab>
              )}
              {agentsFeatureEnabled && (
                <Tab
                  eventKey="agents"
                  title={
                    <span>
                      <i className="bi bi-robot me-2"></i>Agents
                    </span>
                  }
                >
                  <div className="mb-3">
                    <Alert variant="secondary" className="mb-3">
                      <div className="d-flex align-items-start">
                        <i className="bi bi-building-gear me-2 mt-1"></i>
                        <div>
                          <div className="fw-semibold">Company-wide agents policy</div>
                          <div className="small text-muted">
                            Choose how agents work across your company. Changes take effect immediately for everyone.
                          </div>
                        </div>
                      </div>
                    </Alert>
                    {agentsLoading ? (
                      <div className="text-center py-4">
                        <Spinner animation="border" />
                      </div>
                    ) : (
                      <div className="d-flex flex-column gap-2">
                        {[
                          {
                            key: 'off',
                            label: 'Agents Off',
                            desc: 'Agents are disabled for everyone. The Agents UI shows a notice that it is disabled and to contact an admin.',
                          },
                          {
                            key: 'personal_only',
                            label: 'Personal Agents Only',
                            desc: 'Users can create and use personal agents. Company sharing is disabled and the Company Agent Marketplace is hidden.',
                          },
                          {
                            key: 'full',
                            label: 'Agents On (Full)',
                            desc: 'Users can create and use personal agents and share company agents. The marketplace is available.',
                          },
                        ].map((opt) => {
                          const selected = agentsMode === (opt.key as AgentsMode);
                          return (
                            <div
                              key={opt.key}
                              className={`p-3 border rounded-3 bg-white d-flex align-items-start justify-content-between ${selected ? 'border-primary border-2' : ''}`}
                              role="button"
                              onClick={async () => {
                                if (agentsSaving || agentsMode === (opt.key as AgentsMode)) return;
                                // Confirmation copy per mode transition
                                let message = '';
                                if (opt.key === 'off') {
                                  message =
                                    'Turn off Agents for everyone? Users will not be able to create or use agents. The Agents UI will display a disabled notice. Continue?';
                                } else if (opt.key === 'personal_only') {
                                  message =
                                    'Disable company agent sharing? The Company Agent Marketplace will be hidden and users can only create and use personal agents. Existing company agents will be hidden. Continue?';
                                } else {
                                  message = 'Enable Agents and company sharing for everyone?';
                                }
                                const ok = window.confirm(message);
                                if (!ok) return;
                                try {
                                  setAgentsSaving(true);
                                  await AdminAgentsService.update(opt.key as AgentsMode, numaPut);
                                  setAgentsMode(opt.key as AgentsMode);
                                } catch (e) {
                                  alert((e as Error).message || 'Failed to update agents policy');
                                } finally {
                                  setAgentsSaving(false);
                                }
                              }}
                              style={{
                                cursor: agentsSaving ? 'not-allowed' : 'pointer',
                                opacity: agentsSaving ? 0.7 : 1,
                              }}
                            >
                              <div className="me-3">
                                <div className="fw-semibold" style={{ fontSize: '0.95rem' }}>
                                  {opt.label}
                                </div>
                                <div className="text-muted small" style={{ maxWidth: 720 }}>
                                  {opt.desc}
                                </div>
                              </div>
                              <div className="ms-3 align-self-center">
                                {selected ? (
                                  <i className="bi bi-check-circle-fill text-primary"></i>
                                ) : (
                                  <i className="bi bi-circle text-secondary"></i>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        <div className="text-muted small mt-2">
                          Users will still see gentle hints where agents are disabled (e.g., &quot;Agents are disabled.
                          Contact your admin&quot;).
                        </div>
                      </div>
                    )}
                  </div>
                </Tab>
              )}
              <Tab
                eventKey="integrations"
                title={
                  <span>
                    <i className="bi bi-plug-fill me-2"></i>Integrations
                  </span>
                }
              >
                <Alert variant="secondary" className="mb-3">
                  <div className="d-flex align-items-start">
                    <i className="bi bi-building-gear me-2 mt-1"></i>
                    <div>
                      <div className="fw-semibold">Company-wide settings</div>
                      <div className="small text-muted">
                        These settings apply to everyone in your Numa environment. Use the toggle to enable/disable each
                        integration for your company, and use <span className="fw-semibold">Manage Tools</span> to turn
                        specific capabilities off globally.
                      </div>
                    </div>
                  </div>
                </Alert>
                {previewMode && (
                  <Alert variant="info" className="mb-3">
                    Numa Integrations are not enabled in your Numa environment. Contact your account administrator to
                    request access.
                  </Alert>
                )}
                {loadingSettings ? (
                  <div className="text-center py-5">
                    <Spinner animation="border" variant="primary" />
                  </div>
                ) : (
                  <div>
                    {AVAILABLE_INTEGRATIONS.sort((a, b) => a.name.localeCompare(b.name)).map(renderIntegrationRow)}
                  </div>
                )}
              </Tab>
            </Tabs>
          </div>
        </div>
      </div>

      <Modal show={!!manageToolsFor} onHide={() => setManageToolsFor(null)} centered size="lg">
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title>
            <div className="d-flex align-items-center">
              <i className="bi bi-sliders me-2 text-primary"></i>
              Manage Tools – {manageToolsFor}
            </div>
            <div className="small text-muted fw-normal mt-2" style={{ fontSize: '0.85rem' }}>
              These tool settings are company-wide. Users cannot enable tools you disable here.
            </div>
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="pt-2" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {toolsLoading ? (
            <div className="text-center py-5">
              <Spinner animation="border" variant="primary" />
              <p className="mt-3 text-muted mb-0">Loading tools...</p>
            </div>
          ) : toolsError ? (
            <Alert variant="danger" className="mb-0">
              <i className="bi bi-exclamation-triangle-fill me-2"></i>
              {toolsError}
            </Alert>
          ) : toolList.length === 0 ? (
            <div className="text-center py-5">
              <i className="bi bi-info-circle text-muted" style={{ fontSize: '2rem' }}></i>
              <p className="text-muted mt-2 mb-0">No tools found for this integration.</p>
            </div>
          ) : (
            <div className="d-flex flex-column gap-2">
              {toolList.map((t) => {
                const allowed = toolToggles[t.name] ?? true;

                // Helper functions for formatting tool names
                const stripPrefix = (name: string, prefix?: string | null) =>
                  prefix && name.startsWith(prefix + '-') ? name.slice(prefix.length + 1) : name;
                const toTitle = (s: string) =>
                  s
                    .split('-')
                    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
                    .join(' ');

                // Parse markdown links in description and clean up display
                const parseDescription = (desc: string | undefined) => {
                  if (!desc) return null;

                  // Match markdown links: [text](url)
                  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
                  const parts: (string | React.ReactElement)[] = [];
                  let lastIndex = 0;
                  let match: RegExpExecArray | null;

                  while ((match = linkRegex.exec(desc)) !== null) {
                    // Add text before the link
                    if (match.index > lastIndex) {
                      parts.push(desc.substring(lastIndex, match.index));
                    }

                    // Replace "See the docs" with "see documentation"
                    const linkText = match[1].toLowerCase().includes('see') ? 'see documentation' : match[1];

                    // Add the link as JSX
                    parts.push(
                      <a
                        key={match.index}
                        href={match[2]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-decoration-none"
                      >
                        [{linkText}]
                      </a>,
                    );

                    lastIndex = match.index + match[0].length;
                  }

                  // Add any remaining text
                  if (lastIndex < desc.length) {
                    parts.push(desc.substring(lastIndex));
                  }

                  return parts.length > 0 ? parts : desc;
                };

                const displayName = toTitle(stripPrefix(t.name, manageToolsFor));

                return (
                  <div
                    key={t.name}
                    className={`d-flex align-items-start justify-content-between p-3 border rounded-3 ${allowed ? 'bg-light bg-opacity-25' : 'bg-light bg-opacity-50'}`}
                    style={{
                      transition: 'all 0.2s ease',
                      borderColor: allowed ? 'var(--bs-border-color)' : 'var(--bs-border-color-translucent)',
                    }}
                  >
                    <div className="flex-grow-1 me-3">
                      <div className="d-flex align-items-center mb-1">
                        <div
                          className={`rounded-circle me-2 ${allowed ? 'bg-success' : 'bg-secondary'}`}
                          style={{ width: '8px', height: '8px', transition: 'all 0.2s ease' }}
                        ></div>
                        <span className={`fw-semibold ${allowed ? 'text-dark' : 'text-muted'}`}>{displayName}</span>
                      </div>
                      {t.description && (
                        <div
                          className={`small ${allowed ? 'text-muted' : 'text-secondary'}`}
                          style={{
                            maxWidth: 720,
                            whiteSpace: 'normal',
                            wordBreak: 'break-word',
                            lineHeight: '1.4',
                            fontSize: '0.85rem',
                          }}
                        >
                          {parseDescription(t.description)}
                        </div>
                      )}
                    </div>
                    <div className="form-check form-switch ms-2">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={allowed}
                        onChange={(e) => setToolToggles({ ...toolToggles, [t.name]: e.target.checked })}
                        style={{
                          transform: 'scale(1.1)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer
          className="border-top pt-3"
          style={{
            position: 'sticky',
            bottom: 0,
            backgroundColor: 'white',
            zIndex: 1050,
            boxShadow: '0 -2px 8px rgba(0,0,0,0.05)',
          }}
        >
          <div className="d-flex justify-content-between align-items-center w-100">
            <small className="text-muted">
              {toolList.length > 0 && (
                <span>
                  <i className="bi bi-info-circle me-1"></i>
                  {Object.values(toolToggles).filter(Boolean).length} of {toolList.length} tools enabled
                </span>
              )}
            </small>
            <div>
              <Button variant="secondary" onClick={() => setManageToolsFor(null)} className="me-2">
                Cancel
              </Button>
              <Button variant="primary" onClick={saveManageTools} disabled={toolsLoading || !!toolsError}>
                <i className="bi bi-check-lg me-2"></i>
                Save Changes
              </Button>
            </div>
          </div>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
