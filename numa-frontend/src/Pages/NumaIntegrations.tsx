import { useState, useEffect, useCallback, useMemo } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Container, Row, Col, Button, Alert, Spinner, Collapse, Modal } from 'react-bootstrap';
import { AlertTriangle, Grid3X3, Link2, RefreshCw, Settings, X, Zap } from 'lucide-react';

import { createFrontendClient } from '@pipedream/sdk/browser';
import { useAuth } from '../Providers/AuthProvider';
import { GenericTestConnection } from '../Components/GenericTestConnection';
import { getIntegrationsListFormat, type IntegrationListItem } from '../config/integrationsConfig';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { AdminIntegrationsService, type GlobalIntegrationSettingsMap } from '../Services/AdminIntegrationsService';
import {
  AdminDataConnectorsService,
  type GlobalDataConnectorSettingsMap,
} from '../Services/AdminDataConnectorsService';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import type { ConnectionStatus } from '../types/pipedream';
import { getDefaultDenyTools } from '../config/integrationToolsDefault';
import { PageHeader } from '../Components/PageHeader';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { DataConnectorsTab } from '../Components/DataConnectors/DataConnectorsTab';
import { SubHeaderTabBar } from '../Components/SubHeaderTabBar';

// Use the proper ConnectionStatus type from the types file
type PipedreamConnection = ConnectionStatus & {
  status: 'connected' | 'not_connected' | string; // Allow string for compatibility
};

export const NumaIntegrations = () => {
  const { t, i18n } = useTranslation('integrations');
  const { user, lambdaClient } = useAuth();
  const { numaGet } = useNumaRequest();
  const [connections, setConnections] = useState<PipedreamConnection[]>([]);
  const availableApps = useMemo<IntegrationListItem[]>(() => getIntegrationsListFormat(), [i18n.language]);
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
  const [activeTab, setActiveTab] = useState<'connected-apps' | 'data-connectors'>('connected-apps');
  const dataConnectorsEnabled =
    typeof window !== 'undefined' ? window.sessionStorage.getItem('DATA_CONNECTORS_ENABLED') === 'true' : false;
  const tabItems = useMemo(
    () => [
      { key: 'connected-apps', label: t('tabs.connectedApps') },
      ...(dataConnectorsEnabled ? [{ key: 'data-connectors', label: t('tabs.dataConnectors') }] : []),
    ],
    [dataConnectorsEnabled, t],
  );
  // Version removed: last-write-wins policy
  const [recentlyConnectedApp, setRecentlyConnectedApp] = useState<string | null>(null);
  // Track per-app default policy application in-flight to avoid race in Settings
  const [defaultsApplying, setDefaultsApplying] = useState<Record<string, boolean>>({});
  // Global admin integration settings
  const [globalSettings, setGlobalSettings] = useState<GlobalIntegrationSettingsMap>({});
  const [dataConnectorSettings, setDataConnectorSettings] = useState<GlobalDataConnectorSettingsMap>({});

  // Detect preview mode when integrations proxy is not configured
  useEffect(() => {
    if (!user) return;
    const relayLambdaArn = sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN');
    const enabledFlag = sessionStorage.getItem('PIPEDREAM_INTEGRATIONS') === 'true';
    if (!relayLambdaArn || !enabledFlag) {
      setPreviewMode(true);
      setLoading(false);
    }
  }, [user]);

  // Load connection status when lambda client is ready and not in preview mode
  useEffect(() => {
    if (lambdaClient && !previewMode) {
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

  const loadDataConnectorSettings = useCallback(async () => {
    try {
      if (!dataConnectorsEnabled) {
        setDataConnectorSettings({ synergy: { status: 'disabled' } });
        return;
      }
      if (!user) return;
      const data = await AdminDataConnectorsService.listWithNuma(numaGet);
      setDataConnectorSettings(data);
    } catch {
      setDataConnectorSettings({ synergy: { status: 'disabled' } });
    }
  }, [user, numaGet, dataConnectorsEnabled]);

  // Initial fetch for global settings
  useEffect(() => {
    loadGlobalSettings();
    loadDataConnectorSettings();
  }, [loadGlobalSettings, loadDataConnectorSettings]);

  useEffect(() => {
    if (!dataConnectorsEnabled && activeTab === 'data-connectors') {
      setActiveTab('connected-apps');
    }
  }, [dataConnectorsEnabled, activeTab]);

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
          ttlMs: 30 * 60 * 1000, // 30 minutes default cache TTL for page loads
        });
        // Transform connection objects from response
        // Use connected_apps array as source of truth for connection status
        const connectedAppNames = response.connected_apps || [];
        // DEBUG: Log raw response to identify name_slug mismatches
        console.log('DEBUG: Raw Pipedream response:', {
          connected_apps: connectedAppNames,
          all_connections: response.connections?.map((c) => ({ app_name: c.app_name, status: c.status })),
        });
        const connectionObjects = (response.connections || []).map((conn) => ({
          app_name: conn.app_name,
          status: connectedAppNames.includes(conn.app_name) ? 'connected' : 'not_connected',
          pipedream_account_id: conn.pipedream_account_id,
          last_auth_check: conn.last_auth_check || new Date().toISOString(),
          healthy: conn.healthy,
          dead: conn.dead,
          connection_name: conn.connection_name,
          connected_at: conn.connected_at,
        }));
        setConnections(connectionObjects);
        console.log('Integration status loaded successfully:', {
          connectionsCount: response.connections?.length || 0,
          connectedApps: response.connected_apps?.length || 0,
        });
      } catch (err: unknown) {
        const error = err as Error;
        console.error('Failed to load integration status:', error);
        setError(t('errors.loadStatus', { message: error.message }));
      } finally {
        setLoading(false);
        setLoadingStatus(false);
      }
    },
    [lambdaClient, user, loadingStatus],
  );

  const connectApp = async (appName: string) => {
    if (!lambdaClient || !user) {
      setError(t('errors.systemNotReady'));
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
          // Refresh status in background to reflect new connection everywhere
          await loadConnectionStatus(true);
          // Apply default tool policy (deny list) immediately after connection
          try {
            setDefaultsApplying((prev) => ({ ...prev, [appName]: true }));
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
          } finally {
            setDefaultsApplying((prev) => ({ ...prev, [appName]: false }));
          }
          // Show post-connection guidance
          setRecentlyConnectedApp(appName);
          setTimeout(() => setRecentlyConnectedApp(null), 8000); // Auto-dismiss after 8 seconds
          console.log(`${appName} connected successfully`);
        },
        onError: (error: Error | { message?: string }) => {
          console.error(`Connection error for ${appName}:`, error);
          setError(t('errors.connectFailed', { appName, message: error.message || t('errors.unknownError') }));
        },
      });
    } catch (err: unknown) {
      const error = err as Error;
      console.error(`Error connecting ${appName}:`, error);
      if (error.message?.includes('401')) {
        setError(t('errors.authFailed'));
      } else if (error.message?.includes('fetch')) {
        setError(t('errors.network'));
      } else {
        setError(
          t('errors.connectFailedGeneric', {
            appName,
            message: error.message || t('errors.tryAgain'),
          }),
        );
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
      const confirmed = window.confirm(t('confirm.disconnect', { appName }));
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
      setError(e.message || t('errors.disconnectFailed'));
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
      setSettingsError(err.message || t('errors.loadSettings'));
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
      setSettingsError(err.message || t('errors.saveSettings'));
    }
  };

  const getConnectionStatus = (appName: string) => {
    const connection = connections.find((conn) => conn.app_name === appName);
    return connection?.status || 'not_connected';
  };

  const getConnection = (appName: string) => {
    return connections.find((conn) => conn.app_name === appName);
  };

  const renderAppIcon = (app: IntegrationListItem) => {
    return (
      <img
        src={app.img_src}
        alt={t('appIconAlt', { name: app.name })}
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
    const conn = getConnection(integration.name_slug);
    const isUnhealthy = isConnected && conn?.healthy === false;
    const isDead = isConnected && conn?.dead === true;

    return (
      <div key={integration.name_slug} className="mb-2">
        <div
          className="integrations-row-card"
          style={{
            opacity: adminDisabled ? 0.55 : 1,
            filter: adminDisabled ? 'grayscale(20%)' : 'none',
          }}
        >
          <div className="integrations-row-card__inner">
            <div className="integrations-row-card__identity">
              <div className="integrations-row-card__app-icon d-flex align-items-center justify-content-center">
                {renderAppIcon(integration)}
              </div>
              <div className="integrations-row-card__text">
                <h6 className="integrations-row-card__name">{integration.name}</h6>
                <p className="integrations-row-card__description">{integration.description}</p>
                {isConnected && conn?.connection_name && (
                  <div className="integrations-row-card__meta">
                    {conn.connection_name}
                    {conn.connected_at && (
                      <span className="ms-1">
                        &middot;{' '}
                        {t('status.connectedSince', { date: new Date(conn.connected_at).toLocaleDateString() })}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="integrations-row-card__controls">
              {isConnected && (
                <div className={`integrations-row-status ${isUnhealthy || isDead ? 'is-warning' : ''}`}>
                  {isUnhealthy || isDead ? (
                    <>
                      <AlertTriangle size={14} className="integrations-row-status__icon" />
                      <span>{isDead ? t('status.accountInactive') : t('status.reconnectRequired')}</span>
                    </>
                  ) : (
                    <>
                      <span className="integrations-row-status__dot" aria-hidden="true" />
                      <span>{t('status.connected')}</span>
                    </>
                  )}
                </div>
              )}

              <div className="integrations-row-actions">
                {isConnected ? (
                  <>
                    <Button
                      variant="light"
                      size="sm"
                      onClick={() => testConnection(integration.name_slug)}
                      disabled={isConnecting}
                      className="integrations-row-btn integrations-row-btn--primary"
                    >
                      <Zap size={14} className="integrations-row-btn__icon" />
                      <span className="integrations-row-btn__label">{t('actions.test')}</span>
                    </Button>
                    <Button
                      variant="light"
                      size="sm"
                      onClick={() => openSettings(integration.name_slug)}
                      disabled={isConnecting || !!defaultsApplying[integration.name_slug]}
                      className="integrations-row-btn integrations-row-btn--secondary"
                    >
                      <Settings size={14} className="integrations-row-btn__icon" />
                      <span className="integrations-row-btn__label">
                        {defaultsApplying[integration.name_slug] ? t('actions.pleaseWait') : t('actions.settings')}
                      </span>
                    </Button>
                    <Button
                      variant="light"
                      size="sm"
                      onClick={() => disconnectApp(integration.name_slug)}
                      disabled={!!disconnectingApp}
                      className="integrations-row-btn integrations-row-btn--neutral"
                    >
                      {disconnectingApp === integration.name_slug ? (
                        <>
                          <Spinner size="sm" className="integrations-row-btn__spinner" />
                          <span className="integrations-row-btn__label">{t('actions.disconnecting')}</span>
                        </>
                      ) : (
                        <>
                          <X size={14} className="integrations-row-btn__icon" />
                          <span className="integrations-row-btn__label">{t('actions.disconnect')}</span>
                        </>
                      )}
                    </Button>
                  </>
                ) : adminDisabled ? (
                  <Button
                    variant="light"
                    size="sm"
                    onClick={() => connectApp(integration.name_slug)}
                    disabled
                    className="integrations-row-btn integrations-row-btn--primary"
                  >
                    <Link2 size={14} className="integrations-row-btn__icon" />
                    <span className="integrations-row-btn__label">{t('actions.connect')}</span>
                  </Button>
                ) : (
                  <Button
                    variant="light"
                    size="sm"
                    onClick={() => connectApp(integration.name_slug)}
                    disabled={isConnecting}
                    className="integrations-row-btn integrations-row-btn--primary"
                  >
                    {isConnecting ? (
                      <>
                        <Spinner size="sm" className="integrations-row-btn__spinner" />
                        <span className="integrations-row-btn__label">{t('actions.connecting')}</span>
                      </>
                    ) : (
                      <>
                        <Link2 size={14} className="integrations-row-btn__icon" />
                        <span className="integrations-row-btn__label">{t('actions.connect')}</span>
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
            <div className="integrations-row-test-panel">
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

  const handleRefresh = async () => {
    await loadGlobalSettings();
    await loadConnectionStatus(true);
  };

  return (
    <div className="dashboard integrations-page">
      <PageHeader
        title={t('header.title')}
        subtitle={t('header.subtitle')}
        actions={
          <Button
            variant="secondary"
            className="standard-refresh-btn"
            disabled={loading || loadingStatus || previewMode}
            onClick={handleRefresh}
          >
            {loading || loadingStatus ? (
              <>
                <Spinner size="sm" className="me-2" animation="border" />
                {t('actions.refreshing')}
              </>
            ) : (
              <>
                <RefreshCw size={16} className="standard-refresh-btn__icon" aria-hidden="true" />
                <span className="standard-refresh-btn__label">{t('actions.refresh')}</span>
              </>
            )}
          </Button>
        }
      />

      <SubHeaderTabBar
        items={tabItems}
        activeKey={activeTab}
        onSelect={(key) => setActiveTab((key as 'connected-apps' | 'data-connectors') || 'connected-apps')}
        ariaLabel={t('header.title')}
      />

      <LayoutDashboard>
        <Container fluid className="integrations-page-content">
          <div className="integrations-page-content__inner">
            <div hidden={activeTab !== 'connected-apps'} aria-hidden={activeTab !== 'connected-apps'}>
              {previewMode && (
                <Alert variant="info" className="mb-3">
                  {t('preview.notice')}
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
                      <h6 className="mb-1 fw-semibold">{t('connection.successTitle')}</h6>
                      <p className="mb-2 small">
                        {t('connection.successDescription', {
                          appName:
                            availableApps.find((app) => app.name_slug === recentlyConnectedApp)?.name ||
                            recentlyConnectedApp,
                        })}
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
                        {t('connection.customizeTools')}
                      </Button>
                    </div>
                  </div>
                </Alert>
              )}

              <div className="integrations-steps-card mb-4">
                <Row className="g-4">
                  <Col md={3}>
                    <div className="integrations-step-item">
                      <div className="integrations-step-badge integrations-step-item__number">1</div>
                      <h6 className="integrations-step-item__title">{t('steps.connect.title')}</h6>
                      <p className="integrations-step-item__body">{t('steps.connect.body')}</p>
                    </div>
                  </Col>
                  <Col md={3}>
                    <div className="integrations-step-item">
                      <div className="integrations-step-badge integrations-step-item__number">2</div>
                      <h6 className="integrations-step-item__title">{t('steps.signIn.title')}</h6>
                      <p className="integrations-step-item__body">{t('steps.signIn.body')}</p>
                    </div>
                  </Col>
                  <Col md={3}>
                    <div className="integrations-step-item">
                      <div className="integrations-step-badge integrations-step-item__number">3</div>
                      <h6 className="integrations-step-item__title">{t('steps.optimize.title')}</h6>
                      <p className="integrations-step-item__body">{t('steps.optimize.body')}</p>
                    </div>
                  </Col>
                  <Col md={3}>
                    <div className="integrations-step-item">
                      <div className="integrations-step-badge integrations-step-item__number">4</div>
                      <h6 className="integrations-step-item__title">{t('steps.work.title')}</h6>
                      <p className="integrations-step-item__body">
                        {t('steps.work.bodyPrefix')}{' '}
                        <Button
                          variant="link"
                          size="sm"
                          className="integrations-step-item__link"
                          onClick={() => (window.location.href = '/chat')}
                        >
                          {t('steps.work.chatLink')}
                        </Button>
                      </p>
                    </div>
                  </Col>
                </Row>
              </div>
              <div className="integrations-section-heading">
                <div className="integrations-available-heading">
                  <Grid3X3 size={18} className="integrations-available-heading__icon" aria-hidden="true" />
                  <h4 className="integrations-available-heading__text mb-0">
                    {loading
                      ? t('availableIntegrations')
                      : t('availableIntegrationsWithCount', { count: availableApps.length })}
                  </h4>
                </div>
              </div>
              <div style={previewMode ? { position: 'relative' } : undefined}>
                {loading ? (
                  <div className="text-center py-5">
                    <Spinner animation="border" variant="primary" />
                    <p className="mt-3 text-muted">{t('loadingIntegrations')}</p>
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
                      {[...availableApps]
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
            </div>

            {dataConnectorsEnabled && (
              <div hidden={activeTab !== 'data-connectors'} aria-hidden={activeTab !== 'data-connectors'}>
                <DataConnectorsTab adminSettings={dataConnectorSettings} />
              </div>
            )}
          </div>
        </Container>
      </LayoutDashboard>
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
const formatDescriptionWithLinks = (description: string, translate: TFunction) => {
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
    const linkText = match[1].toLowerCase().includes('see') ? translate('settingsModal.seeDocumentation') : match[1];

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
  const { t } = useTranslation('integrations');
  // Check if there are unsaved changes
  const hasUnsavedChanges = JSON.stringify(toggles) !== JSON.stringify(initialToggles);

  // Custom close handler with confirmation
  const handleClose = () => {
    if (hasUnsavedChanges) {
      const confirmClose = window.confirm(t('settingsModal.confirmClose'));
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
                {t('settingsModal.title')}
                {hasUnsavedChanges && (
                  <span
                    className="ms-2 badge bg-warning text-dark"
                    style={{ fontSize: '0.65rem', fontWeight: 'normal' }}
                  >
                    {t('settingsModal.unsavedBadge')}
                  </span>
                )}
              </div>
            </Modal.Title>
            <p className="text-muted mb-0 small" style={{ fontSize: '0.85rem' }}>
              {t('settingsModal.subtitle')}
            </p>
          </div>
        </div>
      </Modal.Header>
      <Modal.Body className="pt-2" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {loading ? (
          <div className="text-center py-5">
            <Spinner animation="border" variant="primary" />
            <p className="mt-3 text-muted mb-0">{t('settingsModal.loading')}</p>
          </div>
        ) : error ? (
          <Alert variant="danger" className="mb-0">
            <i className="bi bi-exclamation-triangle-fill me-2"></i>
            {error}
          </Alert>
        ) : tools.length === 0 ? (
          <div className="text-center py-5">
            <i className="bi bi-info-circle text-muted" style={{ fontSize: '2rem' }}></i>
            <p className="text-muted mt-2 mb-0">{t('settingsModal.empty')}</p>
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

              return sorted.map((tool, index) => {
                const display = toTitle(stripPrefix(tool.name, appSlug || undefined));
                const isEnabled = toggles[tool.name] ?? true;
                const isGloballyDenied = (globalDenyTools || []).includes(tool.name);
                return (
                  <div
                    key={tool.name}
                    className={`rounded-3 p-3 border ${index < sorted.length - 1 ? 'mb-2' : ''}
                      ${isEnabled ? 'bg-light bg-opacity-25' : 'bg-light bg-opacity-50'}`}
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
                        {tool.description && (
                          <div
                            className={`small text-break ${isEnabled ? 'text-muted' : 'text-secondary'}`}
                            style={{
                              whiteSpace: 'normal',
                              wordBreak: 'break-word',
                              lineHeight: '1.4',
                              fontSize: '0.85rem',
                            }}
                          >
                            {formatDescriptionWithLinks(tool.description, t)}
                          </div>
                        )}
                        {isGloballyDenied && (
                          <div className="small text-danger mt-1">
                            <i className="bi bi-slash-circle me-1"></i>
                            {t('settingsModal.globallyDisabled')}
                          </div>
                        )}
                      </div>
                      <div className="form-check form-switch ms-2">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={isEnabled && !isGloballyDenied}
                          disabled={isGloballyDenied}
                          onChange={(e) => setToggles({ ...toggles, [tool.name]: e.target.checked })}
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
                {t('settingsModal.toolsEnabledCount', {
                  enabled: Object.values(toggles).filter(Boolean).length,
                  total: tools.length,
                })}
              </span>
            )}
          </small>
          <div>
            <Button variant="secondary" onClick={handleClose} className="me-2">
              {t('actions.cancel')}
            </Button>
            <Button variant="primary" onClick={onSave} disabled={loading || !!error}>
              <i className="bi bi-check-lg me-2"></i>
              {t('actions.saveChanges')}
            </Button>
          </div>
        </div>
      </Modal.Footer>
    </Modal>
  );
};
