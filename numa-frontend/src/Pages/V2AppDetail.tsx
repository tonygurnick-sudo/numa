import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Nav, Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../Providers/AuthProvider';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import { useV2AppRun } from '../hooks/useV2AppRun';
import { useV2AppWorkspaceSettings } from '../hooks/useV2AppWorkspaceSettings';
import { getV2App } from '../Components/V2Apps/V2AppRegistry';
import { AgentsTab } from '../Components/V2Apps/tabs/AgentsTab';
import { RunsTab } from '../Components/V2Apps/tabs/RunsTab';
import { WorkspaceTab } from '../Components/V2Apps/tabs/WorkspaceTab';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import type { V2AppTab } from '../types/apps';

type ConnectionOption = {
  id: string;
  name: string;
  isConnected: boolean;
};

function getUserSubFromToken(): string | undefined {
  const idToken = localStorage.getItem('idToken');
  if (!idToken) return undefined;
  try {
    const payload = idToken.split('.')[1];
    const decoded = JSON.parse(atob(payload));
    return decoded.sub;
  } catch {
    return undefined;
  }
}

export const V2AppDetail: React.FC = () => {
  const { appId } = useParams<{ appId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('apps');
  const { lambdaClient, user } = useAuth();
  const { numaGet, numaPost, numaDelete } = useNumaRequest();

  const app = useMemo(() => (appId ? getV2App(appId) : undefined), [appId]);
  const [activeTab, setActiveTab] = useState<string>('');

  // Set default tab to first tab in app's config
  useEffect(() => {
    if (app?.tabs?.length && !activeTab) {
      setActiveTab(app.tabs[0].id);
    }
  }, [app, activeTab]);

  // V2 App Run hook
  const {
    state,
    currentRun,
    runHistory,
    error,
    uploadProgress,
    startAnalysis,
    startFollowUp,
    viewRun,
    removeRun,
    loadHistory,
    reset,
  } = useV2AppRun({
    appId: appId || '',
    numaGet,
    numaPost,
    numaDelete,
  });

  // Workspace settings
  const workspaceSettings = useV2AppWorkspaceSettings(appId || '');

  // Knowledge Bases
  const { availableKBs, isLoadingKBs } = useKnowledgeBase();

  // Integrations
  const hasPipedreamFeature = window.sessionStorage.getItem('PIPEDREAM_INTEGRATIONS') === 'true';
  const [availableConnections, setAvailableConnections] = useState<ConnectionOption[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [globalIntegrationSettings, setGlobalIntegrationSettings] = useState<
    Record<string, { status: 'enabled' | 'disabled'; denyTools: string[] }>
  >({});

  // Load admin integration settings
  useEffect(() => {
    if (!user || !hasPipedreamFeature) return;
    (async () => {
      try {
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
  }, [user, hasPipedreamFeature, numaGet]);

  // Load connections via proxy
  const loadConnections = useCallback(async () => {
    if (!lambdaClient || !user || !hasPipedreamFeature) return;
    try {
      setConnectionsLoading(true);
      const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
      const response = await PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId, {
        ttlMs: 30 * 60 * 1000,
      });

      const connected = (response.connections || [])
        .filter((conn) => conn.status === 'connected')
        .filter((conn) => globalIntegrationSettings[conn.app_name]?.status !== 'disabled')
        .map((conn) => ({
          id: conn.app_name,
          name: conn.app_name,
          isConnected: true,
        }));

      setAvailableConnections(connected);
    } catch (e) {
      console.error('[V2AppDetail] Failed to load connections:', e);
      setAvailableConnections([]);
    } finally {
      setConnectionsLoading(false);
    }
  }, [lambdaClient, user, hasPipedreamFeature, globalIntegrationSettings]);

  useEffect(() => {
    if (hasPipedreamFeature && lambdaClient) loadConnections();
  }, [hasPipedreamFeature, lambdaClient, loadConnections]);

  // After a run is submitted, switch to the Runs tab so the user can track progress
  const handleStartAnalysis = useCallback(
    async (prompt: string, files: File[], config: Parameters<typeof startAnalysis>[2], runName?: string) => {
      await startAnalysis(prompt, files, config, runName);
      setActiveTab('runs');
    },
    [startAnalysis]
  );

  // Load run history on mount
  useEffect(() => {
    if (appId) loadHistory();
  }, [appId, loadHistory]);

  if (!app || !appId) {
    return (
      <div className="v2-app-detail">
        <div className="v2-app-detail__content">
          <Alert variant="warning">{t('v2Apps.detail.notFound')}</Alert>
        </div>
      </div>
    );
  }

  const Icon = app.icon;

  const renderTabContent = () => {
    switch (activeTab) {
      case 'agents':
        return (
          <AgentsTab
            appId={appId}
            app={app}
            state={state}
            currentRun={currentRun}
            error={error}
            uploadProgress={uploadProgress}
            startAnalysis={handleStartAnalysis}
            reset={reset}
            workspaceSettings={workspaceSettings.settings}
            availableKBs={availableKBs}
            isLoadingKBs={isLoadingKBs}
            availableConnections={availableConnections}
            connectionsLoading={connectionsLoading}
            hasPipedreamFeature={hasPipedreamFeature}
          />
        );
      case 'runs':
        return (
          <RunsTab
            runHistory={runHistory}
            currentRun={currentRun}
            viewRun={viewRun}
            removeRun={removeRun}
            onRefresh={loadHistory}
            agents={app.agents}
            startFollowUp={startFollowUp}
            numaGet={numaGet}
          />
        );
      case 'workspace':
        return (
          <WorkspaceTab
            appId={appId}
            numaGet={numaGet}
            numaPost={numaPost}
            numaDelete={numaDelete}
            getUserSub={getUserSubFromToken}
            workspaceSettings={workspaceSettings}
            availableKBs={availableKBs}
            isLoadingKBs={isLoadingKBs}
            availableConnections={availableConnections}
            connectionsLoading={connectionsLoading}
            hasPipedreamFeature={hasPipedreamFeature}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="v2-app-detail">
      {/* Header */}
      <div className="v2-app-detail__header">
        <div className="v2-app-detail__header-inner">
          <button className="v2-app-detail__back" onClick={() => navigate('/dash')}>
            <i className="bi bi-arrow-left" />
            {t('v2Apps.detail.backToApps')}
          </button>
          <div className="v2-app-detail__header-icon" style={{ backgroundColor: `${app.color}15` }}>
            <Icon size={20} style={{ color: app.color }} />
          </div>
          <div className="v2-app-detail__header-text">
            <h1 className="v2-app-detail__title">{t(app.nameKey)}</h1>
            <p className="v2-app-detail__subtitle">{t(app.descriptionKey)}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="v2-app-detail__tabs">
        <Nav variant="tabs">
          {app.tabs.map((tab: V2AppTab) => (
            <Nav.Item key={tab.id}>
              <Nav.Link active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
                {tab.icon && <i className={tab.icon} />}
                {t(tab.labelKey)}
              </Nav.Link>
            </Nav.Item>
          ))}
        </Nav>
      </div>

      {/* Tab content */}
      <div className="v2-app-detail__content">{renderTabContent()}</div>
    </div>
  );
};

export default V2AppDetail;
