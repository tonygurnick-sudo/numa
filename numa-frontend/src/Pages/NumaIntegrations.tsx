import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Container,
  Row,
  Col,
  Card,
  Button,
  Alert,
  Spinner,
  Collapse,
  Modal,
  OverlayTrigger,
  Tooltip,
} from 'react-bootstrap';

import { createFrontendClient } from '@pipedream/sdk/browser';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { fromWebToken } from '@aws-sdk/credential-providers';
import { useAuth } from '../Providers/AuthProvider';
import { Nav } from '../Components/Nav';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { GenericTestConnection } from '../Components/GenericTestConnection';
import { getIntegrationsListFormat, type IntegrationListItem } from '../config/integrationsConfig';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { AdminIntegrationsService, type GlobalIntegrationSettingsMap } from '../Services/AdminIntegrationsService';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import type { ConnectionStatus } from '../types/pipedream';
import { getDefaultDenyTools } from '../config/integrationToolsDefault';

const AVAILABLE_INTEGRATIONS: IntegrationListItem[] = getIntegrationsListFormat();

// Use the proper ConnectionStatus type from the types file
type PipedreamConnection = ConnectionStatus & {
  status: 'connected' | 'not_connected' | string; // Allow string for compatibility
};

export const NumaIntegrations = () => {
  const { user } = useAuth();
  const { numaGet } = useNumaRequest();
  const [lambdaClient, setLambdaClient] = useState<LambdaClient | null>(null);
  const [connections, setConnections] = useState<PipedreamConnection[]>([]);
  const [availableApps] = useState(AVAILABLE_INTEGRATIONS);
  const [loading, setLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<boolean>(false);
  const [connectingApp, setConnectingApp] = useState<string | null>(null);
  const [disconnectingApp, setDisconnectingApp] = useState<string | null>(null);
  const [expandedTestUI, setExpandedTestUI] = useState<Record<string, boolean>>({});
  const [settingsApp, setSettingsApp] = useState<string | null>(null);
  const [settingsLoading, setSettingsLoading] = useState<boolean>(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [availableTools, setAvailableTools] = useState<{ name: string; description?: string }[]>([]);
  const [toolToggles, setToolToggles] = useState<Record<string, boolean>>({});
  // Version removed: last-write-wins policy
  const [recentlyConnectedApp, setRecentlyConnectedApp] = useState<string | null>(null);
  // Global admin integration settings
  const [globalSettings, setGlobalSettings] = useState<GlobalIntegrationSettingsMap>({});
  const lambdaInitializedRef = useRef(false);

  // Initialize Lambda client only if integrations proxy is configured
  useEffect(() => {
    const initializeLambdaClient = async () => {
      if (!user) return;
      if (lambdaClient || lambdaInitializedRef.current) return;
      const relayLambdaArn = sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN');
      const enabledFlag = sessionStorage.getItem('PIPEDREAM_INTEGRATIONS') === 'true';
      if (!relayLambdaArn || !enabledFlag) {
        console.log('Integrations proxy not configured or disabled - entering preview mode');
        setPreviewMode(true);
        setLambdaClient(null);
        setLoading(false);
        return;
      }
      try {
        const REGION = window.sessionStorage.getItem('REGION') || 'us-east-1';
        const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS') || '{}');
        const userGroup = user.decoded_tokens?.idToken?.['cognito:groups']?.[0] || 'standard';
        const roleArn = GROUPS[userGroup]?.roleArn;
        const cognitoUserId = user.decoded_tokens?.idToken?.sub;
        if (!roleArn) {
          console.error('No role ARN found for user group:', userGroup);
          setError('Unable to access AWS resources. Please check your permissions.');
          return;
        }
        const credentials = fromWebToken({
          webIdentityToken: user.tokens.idToken,
          roleArn,
          roleSessionName: cognitoUserId,
          durationSeconds: 3600,
        });
        const newClient = new LambdaClient({ region: REGION, credentials });
        setLambdaClient(newClient);
        if (!lambdaInitializedRef.current) {
          console.log('Lambda client initialized successfully for integrations proxy');
          lambdaInitializedRef.current = true;
        }
      } catch (err) {
        console.error('Error initializing Lambda client:', err);
        setError('Failed to initialize AWS Lambda client. Please try refreshing the page.');
      }
    };
    initializeLambdaClient();
  }, [user, lambdaClient]);

  // Load connection status when lambda client is ready
  useEffect(() => {
    if (lambdaClient) {
      loadConnectionStatus();
    }
  }, [lambdaClient]);

  // Load global admin settings
  const loadGlobalSettings = useCallback(async () => {
    try {
      if (!user) return;
      const data = await AdminIntegrationsService.listWithNuma(numaGet);
      setGlobalSettings(data);
    } catch {
      // leave defaults (all disabled) if API not available
      setGlobalSettings({});
    }
  }, [user, numaGet]);

  // Initial fetch for global settings
  useEffect(() => {
    loadGlobalSettings();
  }, [loadGlobalSettings]);

  const loadConnectionStatus = useCallback(
    async (forceRefresh = false) => {
      if (!lambdaClient || !user || loadingStatus) {
        console.log('Lambda client or user not ready yet, or already loading');
        return;
      }
      try {
        setLoadingStatus(true);
        setLoading(true);
        setError(null);
        const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
        const response = await PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId, {
          forceRefresh,
          ttlMs: 5 * 60 * 1000, // 5 minutes default cache TTL for page loads
        });
        // Transform connection objects from response
        // Use connected_apps array as source of truth for connection status
        const connectedAppNames = response.connected_apps || [];
        const connectionObjects = (response.connections || []).map((conn) => ({
          app_name: conn.app_name,
          status: connectedAppNames.includes(conn.app_name) ? 'connected' : 'not_connected',
          pipedream_account_id: conn.pipedream_account_id,
          last_auth_check: conn.last_auth_check || new Date().toISOString(),
        }));
        setConnections(connectionObjects);
        console.log('Integration status loaded successfully:', {
          connectionsCount: response.connections?.length || 0,
          connectedApps: response.connected_apps?.length || 0,
        });
      } catch (err: unknown) {
        const error = err as Error;
        console.error('Failed to load integration status:', error);
        setError(`Failed to load integration status: ${error.message}`);
      } finally {
        setLoading(false);
        setLoadingStatus(false);
      }
    },
    [lambdaClient, user, loadingStatus],
  );

  const connectApp = async (appName: string) => {
    if (!lambdaClient || !user) {
      setError('System not ready. Please refresh the page and try again.');
      return;
    }
    try {
      setConnectingApp(appName);
      setError(null);
      console.log(`Starting connection process for ${appName}`);
      const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
      const tokenResponse = await PipedreamProxyService.generateConnectToken(lambdaClient, externalUserId);
      const { connectToken } = tokenResponse;
      console.log(`Generated connect token for ${appName}, external user ID: ${externalUserId}`);
      const pd = createFrontendClient({
        tokenCallback: async () => ({
          token: connectToken,
          connectLinkUrl: tokenResponse.connectLinkUrl,
          expiresAt: new Date(tokenResponse.expiresAt),
        }),
        externalUserId,
        token: connectToken,
      });
      await pd.connectAccount({
        app: appName,
        token: connectToken,
        onSuccess: async (account: { id: string; [key: string]: unknown }) => {
          console.log(`Successfully connected ${appName}:`, account);
          setConnections((prev) =>
            prev.map((conn) =>
              conn.app_name === appName
                ? {
                    ...conn,
                    status: 'connected',
                    pipedream_account_id: account.id,
                    last_auth_check: new Date().toISOString(),
                  }
                : conn,
            ),
          );
          try {
            await PipedreamProxyService.invalidateIntegrationStatus(externalUserId);
          } catch {
            /* ignore invalidate errors */
          }
          // Apply default tool policy (deny list) immediately after connection
          try {
            const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
            const defaults = getDefaultDenyTools(appName);
            if (defaults.length > 0) {
              const [{ tools }, currentPolicy] = await Promise.all([
                PipedreamProxyService.listMcpTools(lambdaClient, externalUserId, appName),
                PipedreamProxyService.getMcpPolicy(lambdaClient, externalUserId, appName),
              ]);
              const available = new Set((tools || []).map((t) => t.name));
              const filteredDefaults = defaults.filter((d) => available.has(d));
              const existingDeny = new Set(currentPolicy.denyTools || []);
              let changed = false;
              for (const name of filteredDefaults) {
                if (!existingDeny.has(name)) {
                  existingDeny.add(name);
                  changed = true;
                }
              }
              if (changed) {
                await PipedreamProxyService.setMcpPolicy(lambdaClient, externalUserId, appName, {
                  mode: 'deny',
                  denyTools: Array.from(existingDeny),
                });
                console.log(`Applied default deny tools for ${appName}`, { denyTools: Array.from(existingDeny) });
              } else {
                console.log(`No default deny tools to apply for ${appName}`);
              }
            }
          } catch (e) {
            console.warn('Failed to apply default tool policy after connection', e);
          }
          // Show post-connection guidance
          setRecentlyConnectedApp(appName);
          setTimeout(() => setRecentlyConnectedApp(null), 8000); // Auto-dismiss after 8 seconds
          console.log(`${appName} connected successfully`);
        },
        onError: (error: Error | { message?: string }) => {
          console.error(`Connection error for ${appName}:`, error);
          setError(`Failed to connect ${appName}: ${error.message || 'Unknown error'}`);
        },
      });
    } catch (err: unknown) {
      const error = err as Error;
      console.error(`Error connecting ${appName}:`, error);
      if (error.message?.includes('401')) {
        setError('Authentication failed. Please refresh the page and try again.');
      } else if (error.message?.includes('fetch')) {
        setError('Network error. Please check your connection and try again.');
      } else {
        setError(`Failed to connect ${appName}. ${error.message || 'Please try again.'}`);
      }
    } finally {
      setConnectingApp(null);
    }
  };

  const testConnection = (appName: string) => {
    setExpandedTestUI((prev) => ({ ...prev, [appName]: true }));
  };

  const disconnectApp = async (appName: string) => {
    if (!lambdaClient || !user) return;
    try {
      setError(null);
      const confirmed = window.confirm(
        `Are you sure you want to disconnect ${appName}? This will revoke access until you reconnect.`,
      );
      if (!confirmed) return;
      setDisconnectingApp(appName);
      const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
      const result = await PipedreamProxyService.disconnectIntegration(lambdaClient, externalUserId, {
        appName,
      });

      if (!result.disconnected && result.reason === 'not_connected') {
        // Already disconnected - just refresh state to be safe
        setConnections((prev) =>
          prev.map((c) => (c.app_name === appName ? { ...c, status: 'not_connected', pipedream_account_id: null } : c)),
        );
        return;
      }

      // Mark as not connected locally and collapse test UI
      setConnections((prev) =>
        prev.map((c) => (c.app_name === appName ? { ...c, status: 'not_connected', pipedream_account_id: null } : c)),
      );
      setExpandedTestUI((prev) => ({ ...prev, [appName]: false }));

      // Invalidate cache and re-fetch status to confirm
      try {
        await PipedreamProxyService.invalidateIntegrationStatus(externalUserId);
      } catch {
        /* ignore invalidate errors */
      }
      await loadConnectionStatus(true);
    } catch (err) {
      const e = err as Error;
      console.error('Disconnect failed', e);
      setError(e.message || 'Failed to disconnect integration');
    } finally {
      setDisconnectingApp(null);
    }
  };

  const [initialToggles, setInitialToggles] = useState<Record<string, boolean>>({});

  const openSettings = async (appName: string) => {
    if (!lambdaClient || !user) return;
    try {
      setSettingsError(null);
      setSettingsLoading(true);
      setSettingsApp(appName);
      const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
      const [toolsResp, policy] = await Promise.all([
        PipedreamProxyService.listMcpTools(lambdaClient, externalUserId, appName),
        PipedreamProxyService.getMcpPolicy(lambdaClient, externalUserId, appName),
      ]);
      setAvailableTools(toolsResp.tools || []);
      // Build toggles from deny list (all ON by default)
      const deny = new Set(policy.denyTools || []);
      const globalDeny = new Set(globalSettings[appName]?.denyTools || []);
      const toggles: Record<string, boolean> = {};
      (toolsResp.tools || []).forEach((t) => (toggles[t.name] = !deny.has(t.name) && !globalDeny.has(t.name)));
      setToolToggles(toggles);
      setInitialToggles(toggles); // Store initial state for comparison
    } catch (e: unknown) {
      const err = e as Error;
      setSettingsError(err.message || 'Failed to load settings');
    } finally {
      setSettingsLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!lambdaClient || !user || !settingsApp) return;
    try {
      setSettingsError(null);
      const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
      const denyTools = Object.entries(toolToggles)
        .filter(([_, allowed]) => !allowed)
        .map(([name]) => name);
      await PipedreamProxyService.setMcpPolicy(lambdaClient, externalUserId, settingsApp, {
        mode: 'deny',
        denyTools,
      });
      // refresh policy version by reloading policy if needed (optional)
      setSettingsApp(null);
    } catch (e: unknown) {
      const err = e as Error;
      setSettingsError(err.message || 'Failed to save settings');
    }
  };

  const getConnectionStatus = (appName: string) => {
    const connection = connections.find((conn) => conn.app_name === appName);
    return connection?.status || 'not_connected';
  };

  const renderAppIcon = (app: IntegrationListItem) => {
    return (
      <img
        src={app.img_src}
        alt={`${app.name} icon`}
        style={{ width: '32px', height: '32px', objectFit: 'contain' }}
        onError={(e) => {
          const iconContainer = (e.target as HTMLImageElement).parentElement as HTMLElement;
          iconContainer.innerHTML = `<i class="${app.fallback_icon || 'bi bi-app'} fs-4"></i>`;
        }}
      />
    );
  };

  const renderIntegrationRow = (integration: IntegrationListItem) => {
    const status = getConnectionStatus(integration.name_slug);
    const isConnected = status === 'connected';
    const isConnecting = connectingApp === integration.name_slug;
    const isExpanded = expandedTestUI[integration.name_slug] || false;
    const adminDisabled = globalSettings[integration.name_slug]?.status === 'disabled';

    return (
      <div key={integration.name_slug} className="mb-2">
        <div
          className="rounded-3 p-3 border"
          style={{
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            minHeight: '120px',
            transition: 'all 0.2s ease',
            cursor: 'default',
            opacity: adminDisabled ? 0.55 : 1,
            filter: adminDisabled ? 'grayscale(20%)' : 'none',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
          }}
        >
          <div className="row align-items-center h-100">
            {/* Icon & Name */}
            <div className="col-md-6">
              <div className="d-flex align-items-center">
                <div
                  className="rounded-2 d-flex align-items-center justify-content-center me-3 flex-shrink-0"
                  style={{ width: '48px', height: '48px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6' }}
                >
                  {renderAppIcon(integration)}
                </div>
                <div>
                  <h6 className="mb-1 fw-semibold">{integration.name}</h6>
                  <p className="mb-0 small text-muted" style={{ fontSize: '0.85rem', lineHeight: '1.4' }}>
                    {integration.description}
                  </p>
                </div>
              </div>
            </div>
            {/* Status */}
            <div className="col-md-2 text-center">
              <div className="d-flex align-items-center justify-content-center">
                {isConnected ? (
                  <>
                    <div className="rounded-circle bg-success me-2" style={{ width: '12px', height: '12px' }}></div>
                    <span className="text-success small fw-semibold">Connected</span>
                  </>
                ) : (
                  <>
                    <div
                      className="rounded-circle border border-secondary me-2"
                      style={{ width: '12px', height: '12px' }}
                    ></div>
                    <span className="text-muted small">Not Connected</span>
                  </>
                )}
              </div>
            </div>
            {/* Actions */}
            <div className="col-md-4">
              <div className="d-flex gap-2 justify-content-end">
                {isConnected ? (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => testConnection(integration.name_slug)}
                      disabled={isConnecting}
                      className="d-flex align-items-center"
                    >
                      <i className="bi bi-lightning-fill me-2"></i>
                      Test
                    </Button>
                    <OverlayTrigger
                      placement="top"
                      overlay={
                        <Tooltip>
                          For better security and performance, review each integration&apos;s Settings to enable only
                          the tools you need. Fewer enabled tools means more focused AI responses and enhanced data
                          protection.
                        </Tooltip>
                      }
                    >
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => openSettings(integration.name_slug)}
                        disabled={isConnecting}
                      >
                        <i className="bi bi-sliders me-2"></i>
                        Settings
                      </Button>
                    </OverlayTrigger>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => disconnectApp(integration.name_slug)}
                      disabled={!!disconnectingApp}
                      className="d-flex align-items-center"
                    >
                      {disconnectingApp === integration.name_slug ? (
                        <>
                          <Spinner size="sm" className="me-2" /> Disconnecting...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-x-circle me-2"></i> Disconnect
                        </>
                      )}
                    </Button>
                  </>
                ) : adminDisabled ? (
                  <OverlayTrigger placement="top" overlay={<Tooltip>Disabled by your administrator</Tooltip>}>
                    <div>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => connectApp(integration.name_slug)}
                        disabled
                        className="px-4"
                      >
                        <i className="bi bi-plus-circle me-2"></i>
                        Connect
                      </Button>
                    </div>
                  </OverlayTrigger>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => connectApp(integration.name_slug)}
                    disabled={isConnecting}
                    className="px-4"
                  >
                    {isConnecting ? (
                      <>
                        <Spinner size="sm" className="me-2" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-plus-circle me-2"></i>
                        Connect
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
        <Collapse in={isConnected && isExpanded}>
          <div className="mt-2">
            <div
              className="border border-top-0 rounded-bottom-3 p-4 bg-light bg-opacity-50"
              style={{ borderTop: 'none' }}
            >
              <GenericTestConnection
                appName={integration.name_slug}
                integrationName={integration.name}
                onClose={() => setExpandedTestUI((prev) => ({ ...prev, [integration.name_slug]: false }))}
              />
            </div>
          </div>
        </Collapse>
      </div>
    );
  };

  return (
    <div className="dashboard">
      <Nav />
      <main>
        <Container>
          <Row className="mb-3">
            <Col>
              <Breadcrumbs label={'Integrations'} clearStack={true} />
              <h1 className="mb-0 fs-3">Numa Integrations</h1>
            </Col>
          </Row>
          {previewMode && (
            <Alert variant="info" className="mb-3">
              Numa Integrations are not enabled in your Numa environment. Contact your account administrator to request
              access.
            </Alert>
          )}
          {error && (
            <Alert variant="danger" className="mb-3">
              {error}
            </Alert>
          )}

          {/* Post-connection guidance alert */}
          {recentlyConnectedApp && (
            <Alert variant="success" className="mb-3" dismissible onClose={() => setRecentlyConnectedApp(null)}>
              <div className="d-flex align-items-start">
                <i className="bi bi-check-circle-fill text-success me-3 mt-1"></i>
                <div className="flex-grow-1">
                  <h6 className="mb-1 fw-semibold">Integration Connected Successfully!</h6>
                  <p className="mb-2 small">
                    Your{' '}
                    {availableApps.find((app) => app.name_slug === recentlyConnectedApp)?.name || recentlyConnectedApp}{' '}
                    integration is now ready to use.
                  </p>
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() => {
                      openSettings(recentlyConnectedApp);
                      setRecentlyConnectedApp(null);
                    }}
                    className="d-flex align-items-center"
                  >
                    <i className="bi bi-sliders me-2"></i>
                    Customize Tool Access
                  </Button>
                </div>
              </div>
            </Alert>
          )}

          <Card className="mb-4 border-0 shadow-sm">
            <Card.Body className="p-4">
              <Row className="g-4">
                <Col md={3}>
                  <div className="text-center p-2">
                    <div className="d-flex align-items-center justify-content-center mb-2">
                      <div
                        className="rounded-circle text-white d-inline-flex align-items-center justify-content-center me-2"
                        style={{ width: '32px', height: '32px', background: 'var(--color-primary)' }}
                      >
                        <span className="fw-bold" style={{ fontSize: '1rem' }}>
                          1
                        </span>
                      </div>
                      <h6 className="text-primary fw-semibold mb-0">Connect Integration</h6>
                    </div>
                    <p className="small text-muted mb-0">Click the connect button on any app below to get started</p>
                  </div>
                </Col>
                <Col md={3}>
                  <div className="text-center p-2">
                    <div className="d-flex align-items-center justify-content-center mb-2">
                      <div
                        className="rounded-circle text-white d-inline-flex align-items-center justify-content-center me-2"
                        style={{ width: '32px', height: '32px', background: 'var(--color-primary)' }}
                      >
                        <span className="fw-bold" style={{ fontSize: '1rem' }}>
                          2
                        </span>
                      </div>
                      <h6 className="text-primary fw-semibold mb-0">Sign In Securely</h6>
                    </div>
                    <p className="small text-muted mb-0">
                      Follow the secure authentication steps and test your connection was successful
                    </p>
                  </div>
                </Col>
                <Col md={3}>
                  <div className="text-center p-2">
                    <div className="d-flex align-items-center justify-content-center mb-2">
                      <div
                        className="rounded-circle text-white d-inline-flex align-items-center justify-content-center me-2"
                        style={{ width: '32px', height: '32px', background: 'var(--color-primary)' }}
                      >
                        <span className="fw-bold" style={{ fontSize: '1rem' }}>
                          3
                        </span>
                      </div>
                      <h6 className="text-primary fw-semibold mb-0">Optimize Security</h6>
                    </div>
                    <p className="small text-muted mb-0">
                      Use Settings to enable only the tools you need for better security and performance
                    </p>
                  </div>
                </Col>
                <Col md={3}>
                  <div className="text-center p-2">
                    <div className="d-flex align-items-center justify-content-center mb-2">
                      <div
                        className="rounded-circle text-white d-inline-flex align-items-center justify-content-center me-2"
                        style={{ width: '32px', height: '32px', background: 'var(--color-primary)' }}
                      >
                        <span className="fw-bold" style={{ fontSize: '1rem' }}>
                          4
                        </span>
                      </div>
                      <h6 className="text-primary fw-semibold mb-0">Get Work Done</h6>
                    </div>
                    <p className="small text-muted mb-0">
                      Utilise your integrations while getting work done in{' '}
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 align-baseline small text-primary fw-semibold"
                        onClick={() => (window.location.href = '/chat')}
                      >
                        Numa Chat
                      </Button>
                    </p>
                  </div>
                </Col>
              </Row>
            </Card.Body>
          </Card>
          <div className="mb-4 d-flex align-items-center justify-content-between">
            <h4 className="text-primary mb-0 d-flex align-items-center">
              <i className="bi bi-grid-3x3-gap me-2"></i>
              <span>Available Integrations {!loading && `(${availableApps.length})`}</span>
            </h4>
            <div className="d-flex align-items-center gap-2">
              <Button
                variant="outline-primary"
                size="sm"
                disabled={loading || loadingStatus || previewMode}
                onClick={async () => {
                  await loadGlobalSettings();
                  await loadConnectionStatus(true);
                }}
                className="d-flex align-items-center"
              >
                {loading || loadingStatus ? (
                  <>
                    <Spinner size="sm" className="me-2" /> Refreshing
                  </>
                ) : (
                  <>
                    <i className="bi bi-arrow-repeat me-2" /> Refresh
                  </>
                )}
              </Button>
            </div>
          </div>
          <div style={previewMode ? { position: 'relative' } : undefined}>
            {loading ? (
              <div className="text-center py-5">
                <Spinner animation="border" variant="primary" />
                <p className="mt-3 text-muted">Loading integrations...</p>
              </div>
            ) : (
              <>
                {/* Preview overlay */}
                {previewMode && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(255,255,255,0.6)',
                      backdropFilter: 'blur(2px)',
                      WebkitBackdropFilter: 'blur(2px)',
                      zIndex: 2,
                    }}
                  />
                )}
                <div style={previewMode ? { pointerEvents: 'none', opacity: 0.8 } : undefined}>
                  {availableApps
                    .sort((a: IntegrationListItem, b: IntegrationListItem) => {
                      // Admin allowed (enabled) first
                      const adminDisabledA = globalSettings[a.name_slug]?.status === 'disabled';
                      const adminDisabledB = globalSettings[b.name_slug]?.status === 'disabled';
                      if (adminDisabledA !== adminDisabledB) return adminDisabledA ? 1 : -1;

                      // Then connected first
                      const statusA = getConnectionStatus(a.name_slug);
                      const statusB = getConnectionStatus(b.name_slug);
                      const connectedA = statusA === 'connected';
                      const connectedB = statusB === 'connected';
                      if (connectedA && !connectedB) return -1;
                      if (!connectedA && connectedB) return 1;

                      // Finally alphabetical
                      return a.name.localeCompare(b.name);
                    })
                    .map(renderIntegrationRow)}
                </div>
              </>
            )}
          </div>
        </Container>
      </main>
      {/* Settings modal */}
      <SettingsModal
        show={!!settingsApp}
        onHide={() => setSettingsApp(null)}
        loading={settingsLoading}
        error={settingsError}
        tools={availableTools}
        toggles={toolToggles}
        initialToggles={initialToggles}
        setToggles={setToolToggles}
        onSave={saveSettings}
        appSlug={settingsApp}
        globalDenyTools={settingsApp ? globalSettings[settingsApp]?.denyTools || [] : []}
      />
    </div>
  );
};

export default NumaIntegrations;

// Helper function to parse markdown links and make them clickable
const formatDescriptionWithLinks = (description: string) => {
  // Match markdown links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts: (string | React.ReactElement)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(description)) !== null) {
    // Add text before the link
    if (match.index > lastIndex) {
      parts.push(description.substring(lastIndex, match.index));
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
        className="text-primary text-decoration-none"
        style={{ fontSize: 'inherit' }}
      >
        [{linkText}]
      </a>,
    );

    lastIndex = match.index + match[0].length;
  }

  // Add any remaining text
  if (lastIndex < description.length) {
    parts.push(description.substring(lastIndex));
  }

  return parts.length > 0 ? parts : description;
};

// Settings Modal (inline for simplicity)
export const SettingsModal = ({
  show,
  onHide,
  loading,
  error,
  tools,
  toggles,
  initialToggles,
  setToggles,
  onSave,
  appSlug,
  globalDenyTools = [],
}: {
  show: boolean;
  onHide: () => void;
  loading: boolean;
  error: string | null;
  tools: { name: string; description?: string }[];
  toggles: Record<string, boolean>;
  initialToggles: Record<string, boolean>;
  setToggles: (t: Record<string, boolean>) => void;
  onSave: () => void;
  appSlug?: string | null;
  globalDenyTools?: string[];
}) => {
  // Check if there are unsaved changes
  const hasUnsavedChanges = JSON.stringify(toggles) !== JSON.stringify(initialToggles);

  // Custom close handler with confirmation
  const handleClose = () => {
    if (hasUnsavedChanges) {
      const confirmClose = window.confirm(
        'Exit will lose the changes made. Cancel and use "Save Changes" if you wish to update the available tools.\n\nExit anyway?',
      );
      if (!confirmClose) return;
    }
    onHide();
  };

  return (
    <Modal show={show} onHide={handleClose} centered size="lg">
      <Modal.Header closeButton className="border-0 pb-2">
        <div className="d-flex align-items-center justify-content-between w-100 pe-3">
          <div>
            <Modal.Title className="mb-1">
              <div className="d-flex align-items-center">
                <i className="bi bi-sliders me-2 text-primary"></i>
                Integration Settings
                {hasUnsavedChanges && (
                  <span
                    className="ms-2 badge bg-warning text-dark"
                    style={{ fontSize: '0.65rem', fontWeight: 'normal' }}
                  >
                    Unsaved Changes
                  </span>
                )}
              </div>
            </Modal.Title>
            <p className="text-muted mb-0 small" style={{ fontSize: '0.85rem' }}>
              Toggle on and off the tools that Numa will have access to when using this integration
            </p>
          </div>
        </div>
      </Modal.Header>
      <Modal.Body className="pt-2" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {loading ? (
          <div className="text-center py-5">
            <Spinner animation="border" variant="primary" />
            <p className="mt-3 text-muted mb-0">Loading available tools...</p>
          </div>
        ) : error ? (
          <Alert variant="danger" className="mb-0">
            <i className="bi bi-exclamation-triangle-fill me-2"></i>
            {error}
          </Alert>
        ) : tools.length === 0 ? (
          <div className="text-center py-5">
            <i className="bi bi-info-circle text-muted" style={{ fontSize: '2rem' }}></i>
            <p className="text-muted mt-2 mb-0">No tools available for this integration.</p>
          </div>
        ) : (
          <div className="d-flex flex-column gap-2">
            {(() => {
              // Helpers
              const stripPrefix = (name: string, prefix?: string | null) =>
                prefix && name.startsWith(prefix + '-') ? name.slice(prefix.length + 1) : name;
              const toTitle = (s: string) =>
                s
                  .split('-')
                  .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
                  .join(' ');

              // Sort by on/off (enabled first), then by display name
              const sorted = [...tools].sort((a, b) => {
                const aEnabled = toggles[a.name] ?? true;
                const bEnabled = toggles[b.name] ?? true;
                if (aEnabled !== bEnabled) return aEnabled ? -1 : 1;
                const aLabel = toTitle(stripPrefix(a.name, appSlug || undefined));
                const bLabel = toTitle(stripPrefix(b.name, appSlug || undefined));
                return aLabel.localeCompare(bLabel);
              });

              return sorted.map((t, index) => {
                const display = toTitle(stripPrefix(t.name, appSlug || undefined));
                const isEnabled = toggles[t.name] ?? true;
                const isGloballyDenied = (globalDenyTools || []).includes(t.name);
                return (
                  <div
                    key={t.name}
                    className={`rounded-3 p-3 border ${
                      index < sorted.length - 1 ? 'mb-2' : ''
                    } ${isEnabled ? 'bg-light bg-opacity-25' : 'bg-light bg-opacity-50'}`}
                    style={{
                      transition: 'all 0.2s ease',
                      borderColor: isEnabled ? 'var(--bs-border-color)' : 'var(--bs-border-color-translucent)',
                    }}
                  >
                    <div className="d-flex align-items-start justify-content-between">
                      <div className="flex-grow-1 me-3">
                        <div className="d-flex align-items-center mb-1">
                          <div
                            className={`rounded-circle me-2 ${isEnabled ? 'bg-success' : 'bg-secondary'}`}
                            style={{ width: '8px', height: '8px', transition: 'all 0.2s ease' }}
                          ></div>
                          <span className={`fw-semibold ${isEnabled ? 'text-dark' : 'text-muted'}`}>{display}</span>
                        </div>
                        {t.description && (
                          <div
                            className={`small text-break ${isEnabled ? 'text-muted' : 'text-secondary'}`}
                            style={{
                              whiteSpace: 'normal',
                              wordBreak: 'break-word',
                              lineHeight: '1.4',
                              fontSize: '0.85rem',
                            }}
                          >
                            {formatDescriptionWithLinks(t.description)}
                          </div>
                        )}
                        {isGloballyDenied && (
                          <div className="small text-danger mt-1">
                            <i className="bi bi-slash-circle me-1"></i>Disabled globally by your administrator
                          </div>
                        )}
                      </div>
                      <div className="form-check form-switch ms-2">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={isEnabled && !isGloballyDenied}
                          disabled={isGloballyDenied}
                          onChange={(e) => setToggles({ ...toggles, [t.name]: e.target.checked })}
                          style={{
                            accentColor: 'var(--color-primary)',
                            transform: 'scale(1.1)',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
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
            {tools.length > 0 && (
              <span>
                <i className="bi bi-info-circle me-1"></i>
                {Object.values(toggles).filter(Boolean).length} of {tools.length} tools enabled
              </span>
            )}
          </small>
          <div>
            <Button variant="outline-secondary" onClick={handleClose} className="me-2">
              Cancel
            </Button>
            <Button variant="primary" onClick={onSave} disabled={loading || !!error}>
              <i className="bi bi-check-lg me-2"></i>
              Save Changes
            </Button>
          </div>
        </div>
      </Modal.Footer>
    </Modal>
  );
};
