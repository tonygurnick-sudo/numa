import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getFlag } from '../utils/featureFlags';
import { Tab, Button, Spinner, Modal, Alert, OverlayTrigger, Tooltip, Form, Table, Badge } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import UserManagement from './UserManagement';
import { SecuritySettingsPanel } from '../Components/UserManagement';
import UserProfilePage from './UserProfile';
import { PageHeader } from '../Components/PageHeader';
import { SubHeaderTabBar } from '../Components/SubHeaderTabBar';
import { StyledTabs } from '../Components/StyledTabs';
import { useAuth } from '../Providers/AuthProvider';
import { AdminIntegrationsService, type GlobalIntegrationSettingsMap } from '../Services/AdminIntegrationsService';
import {
  AdminDataConnectorsService,
  type GlobalDataConnectorSettingsMap,
} from '../Services/AdminDataConnectorsService';
import { DataConnectorsTab } from '../Components/DataConnectors/DataConnectorsTab';
import { CapabilitiesService, type CapabilitySettingsMap } from '../Services/CapabilitiesService';
import { AdminAgentsService, type AgentsMode } from '../Services/AdminAgentsService';
import { getIntegrationsListFormat, type IntegrationListItem } from '../config/integrationsConfig';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import BrandingAdminPanel from '../Components/Branding/BrandingAdminPanel';
import UsageAnalyticsPanel from '../Components/UsageAnalytics/UsageAnalyticsPanel';
import AuditPanel from '../Components/UsageAnalytics/AuditPanel';
import LoginHeatmap from '../Components/UsageAnalytics/LoginHeatmap';
import { NumaLibrariesPanel } from '../Components/Settings/NumaLibrariesPanel';
import GenericAuditLogTab from '../Components/UsageAnalytics/GenericAuditLogTab';
// CHOSE HEAD: TranscriptionService import needed for rebuild button and filesTable loading.
// 3af3ef8e only imported TranscriptionJobsPanel (no service). To revert: remove TranscriptionService import.
import TranscriptionJobsPanel from '../Components/UsageAnalytics/TranscriptionJobsPanel';
import { TranscriptionService, type TranscriptionJob as TxJob } from '../Services/TranscriptionService';
import NotificationsAuditPanel from '../Components/UsageAnalytics/NotificationsAuditPanel';
import { UNSAFE_NavigationContext, useParams, useNavigate } from 'react-router-dom';
import {
  AdminChatSettingsService,
  type GlobalChatSettings,
  DEFAULT_GLOBAL_CHAT_SETTINGS,
} from '../Services/AdminChatSettingsService';
import ExpandableOverflowBox from '../Components/ExpandableOverflowBox';
import { fetchCompanyInfo, saveCompanyInfo, getProfileText } from '../utils/companyInfoUtils';
import { manifestService } from '../Services/manifestService';
import { loadCapabilities, groupByDependencies } from '../utils/capabilityRegistry';
import { ROUTE_CONFIG } from '../utils/routeConfig';
import type { CapabilityItem } from '../utils/capabilityRegistry';
import { getFlagRegistry } from '../utils/featureFlags';
import { loadAdminCapabilityGating } from '../utils/adminCapabilityGating';

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

const AUDIT_SUB_DEFAULTS: Record<string, string> = {
  activity: 'user-activity',
  index: 'web-crawler',
  files: 'transcribe',
};

export default function SettingsPage() {
  const { t, i18n } = useTranslation('settings');
  const { user, getCredentials, lambdaClient } = useAuth();
  const { numaGet, numaPut, numaPost } = useNumaRequest();
  const { scope: urlScope, tab: urlTab } = useParams<{ scope?: string; tab?: string }>();
  const navigate = useNavigate();
  const [activeKey, setActiveKey] = useState<string>(urlTab || 'users');
  const validScopes = ['user', 'admin', 'developer', 'services'] as const;
  type SettingsScope = (typeof validScopes)[number];
  const [settingsScope, setSettingsScope] = useState<SettingsScope>(
    validScopes.includes(urlScope as SettingsScope) ? (urlScope as SettingsScope) : 'user'
  );
  // CHOSE HEAD: richer services-scope tab state + rebuild state. 3af3ef8e used a simpler audit scope.
  // To revert to 3af3ef8e: replace with:
  //   const [auditTabKey, setAuditTabKey] = useState<string>(urlScope === 'audit' && urlTab ? urlTab : 'user-activity');
  const [auditTabKey, setAuditTabKey] = useState<string>(() => {
    if ((urlScope === 'services' || urlScope === 'audit') && urlTab && urlTab in AUDIT_SUB_DEFAULTS) return urlTab;
    return 'activity';
  });
  const [auditSubKey, setAuditSubKey] = useState<string>(() => AUDIT_SUB_DEFAULTS[auditTabKey] ?? 'user-activity');
  const handleAuditTabChange = useCallback((key: string) => {
    setAuditTabKey(key);
    setAuditSubKey(AUDIT_SUB_DEFAULTS[key] ?? 'user-activity');
  }, []);

  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<{ created: number; skipped: number; failed: number } | null>(null);

  // Upload/Scan table state (shared data source)
  const [filesTableJobs, setFilesTableJobs] = useState<TxJob[]>([]);
  const [filesTableLoading, setFilesTableLoading] = useState(false);
  const [filesTableNextToken, setFilesTableNextToken] = useState<string | undefined>();
  const filesTableLoaded = useRef(false);
  const brandingFlag =
    typeof window !== 'undefined' ? window.sessionStorage.getItem('BRANDING_PROVIDER_ENABLED') : null;
  const brandingApiEnabled = brandingFlag === 'true';
  const isAdmin = Boolean(user?.groups?.includes('admin'));
  const currentScope: SettingsScope = isAdmin ? settingsScope : 'user';
  const allowBrandingTab = brandingApiEnabled && isAdmin;
  const agentsFeatureEnabled = getFlag('AGENTS');
  const dataConnectorsEnabled = getFlag('DATA_CONNECTORS_ENABLED');
  const mfaEnabled = getFlag('MFA_ENABLED');
  const availableIntegrations = useMemo<IntegrationListItem[]>(() => getIntegrationsListFormat(), [i18n.language]);

  useEffect(() => {
    if (!isAdmin && settingsScope !== 'user') {
      setSettingsScope('user');
    }
  }, [isAdmin]);

  // Global (admin) settings — SWR: initialize from cache for instant render
  const [globalSettings, setGlobalSettings] = useState<GlobalIntegrationSettingsMap>(
    () => AdminIntegrationsService.getCached() ?? {}
  );
  const [capabilitySettings, setCapabilitySettings] = useState<CapabilitySettingsMap>({});
  const [dataConnectorSettings, setDataConnectorSettings] = useState<GlobalDataConnectorSettingsMap>({});
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);
  const [loadingSettings, setLoadingSettings] = useState<boolean>(() => !AdminIntegrationsService.getCached());
  const [error, setError] = useState<string | null>(null);

  // Agents (admin) settings
  const [agentsMode, setAgentsMode] = useState<AgentsMode>('full');
  const [agentsLoading, setAgentsLoading] = useState<boolean>(true);
  const [agentsSaving, setAgentsSaving] = useState<boolean>(false);

  const [dataAnalysisAvailable, setDataAnalysisAvailable] = useState(true);

  // Company profile (admin) settings
  const [companyProfileText, setCompanyProfileText] = useState<string>('');
  const [companyProfileLastUpdated, setCompanyProfileLastUpdated] = useState<string | null>(null);
  const [companyProfileLoading, setCompanyProfileLoading] = useState<boolean>(true);
  const [companyProfileSaving, setCompanyProfileSaving] = useState<boolean>(false);
  const [companyProfileStatus, setCompanyProfileStatus] = useState<{
    show: boolean;
    type: string;
    message: string;
  }>({ show: false, type: '', message: '' });

  const companyProfileRegion = window.sessionStorage.getItem('REGION');
  const companyProfileClientName = window.sessionStorage.getItem('CLIENT_NAME');
  const companyProfileBucket = companyProfileClientName ? `numa-${companyProfileClientName}-company` : '';

  // Pipedream feature + relay
  const hasPipedreamFeature = getFlag('PIPEDREAM_INTEGRATIONS');
  const relayLambdaArn = window.sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN');
  const previewMode = !hasPipedreamFeature || !relayLambdaArn;
  const workspaceChatEnabled = getFlag('NUMA_WORKSPACE_CHAT');

  useEffect(() => {
    let isMounted = true;
    const loadAvailability = async () => {
      try {
        const apps = await manifestService.fetchAppsFromManifest();
        const dataAnalysisApp = apps?.find((app: { id?: string }) => app?.id === 'data-analysis');
        const status = String(dataAnalysisApp?.status || '').toLowerCase();
        const isActive = status === 'active';
        if (isMounted) setDataAnalysisAvailable(isActive);
      } catch (error) {
        console.warn('[Settings] Unable to determine data analysis availability', error);
        if (isMounted) setDataAnalysisAvailable(false);
      }
    };
    loadAvailability();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!dataAnalysisAvailable) {
      setGlobalChatSettings((prev) => ({ ...prev, dataAnalysisEnabled: false }));
      setChatDefaultsDirty(true);
    }
  }, [dataAnalysisAvailable]);

  const loadGlobal = async () => {
    try {
      // Only show spinner if we have no cached data
      if (Object.keys(globalSettings).length === 0) {
        setLoadingSettings(true);
      }
      if (!isAdmin) {
        setGlobalSettings({});
        setError(null);
        return;
      }
      if (!user) return;
      const data = await AdminIntegrationsService.listWithNuma(numaGet);
      setGlobalSettings(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message || t('errors.loadSettings'));
    } finally {
      setLoadingSettings(false);
    }
  };

  const loadCapabilitySettings = async () => {
    try {
      if (!user) return;
      const data = await CapabilitiesService.list(numaGet);
      setCapabilitySettings(data);
    } catch (e) {
      console.warn('Settings: failed to load capability settings', e);
      setCapabilitySettings({});
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      setGlobalSettings({});
      setLoadingSettings(false);
      return;
    }
    if (previewMode) {
      // Feature disabled: avoid calling the API and clear loading state
      setGlobalSettings({});
      setLoadingSettings(false);
      return;
    }
    loadGlobal();
  }, [isAdmin, user, numaGet, previewMode]);

  useEffect(() => {
    if (!isAdmin) return;
    loadCapabilitySettings();

    // Build capability list from config.json flags (DEPLOY_* keys in sessionStorage),
    // enriched with metadata from capabilities.json where available.
    loadCapabilities().then((meta) => {
      const metaByFlag = new Map(meta.map((c) => [c.flag, c]));
      const items: CapabilityItem[] = [];

      // 1. Flags from config.json — show all except hard-denied (DEPLOY_FLAG=false)
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (!key?.startsWith('DEPLOY_')) continue;
        const flag = key.slice(7);
        const deployValue = sessionStorage.getItem(key);
        if (deployValue === 'false') continue; // Hard deny — do not show
        const existing = metaByFlag.get(flag);
        items.push(
          existing ?? { flag, name: flag, description: '', deployRequired: false, devOnly: false, dependencies: [] }
        );
        metaByFlag.delete(flag); // Mark as handled
      }

      // 2. Collect all known flags: from route config featureFlags + code registry.
      //    This ensures flags like NUMA_FILES and KNOWLEDGE_BASES always appear
      //    even if they're not in config.json and Nav hasn't rendered them yet.
      const allKnownFlags = new Set(getFlagRegistry());
      for (const r of ROUTE_CONFIG) {
        if (r.featureFlag) allKnownFlags.add(r.featureFlag);
      }

      for (const flag of allKnownFlags) {
        if (items.some((c) => c.flag === flag)) continue; // Already in list
        if (sessionStorage.getItem(`DEPLOY_${flag}`) === 'false') continue; // Hard denied
        const existing = metaByFlag.get(flag);
        items.push(
          existing ?? {
            flag,
            name: flag,
            description: '',
            deployRequired: false,
            devOnly: false,
            dependencies: [],
          }
        );
      }

      setCapabilities(items);
    });
  }, [isAdmin, user, numaGet]);

  // Load Data Connector admin settings
  useEffect(() => {
    if (!isAdmin || !dataConnectorsEnabled || !user) return;
    AdminDataConnectorsService.listWithNuma(numaGet)
      .then(setDataConnectorSettings)
      .catch(() => setDataConnectorSettings({ synergy: { status: 'disabled' } }));
  }, [isAdmin, dataConnectorsEnabled, user, numaGet]);

  // Load files table data when the files sub-tab is active (Upload / Scan tabs)
  const loadFilesTable = useCallback(
    async (token?: string) => {
      setFilesTableLoading(true);
      try {
        const response = await TranscriptionService.listAll({ limit: 50, nextToken: token }, numaGet);
        setFilesTableJobs((prev) => (token ? [...prev, ...(response.jobs ?? [])] : (response.jobs ?? [])));
        setFilesTableNextToken(response.nextToken);
      } catch (e) {
        console.error('Failed to load files table data', e);
      } finally {
        setFilesTableLoading(false);
      }
    },
    [numaGet]
  );

  useEffect(() => {
    if (
      isAdmin &&
      currentScope === 'services' &&
      auditTabKey === 'files' &&
      (auditSubKey === 'upload' || auditSubKey === 'scan') &&
      !filesTableLoaded.current
    ) {
      filesTableLoaded.current = true;
      loadFilesTable();
    }
  }, [isAdmin, currentScope, auditTabKey, auditSubKey, loadFilesTable]);

  const formatFileSizeSettings = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  // Load Agents settings
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isAdmin || !agentsFeatureEnabled) {
        if (!cancelled) setAgentsLoading(false);
        return;
      }
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
  }, [isAdmin, agentsFeatureEnabled, user, numaGet]);

  // Load Company Profile
  useEffect(() => {
    let cancelled = false;
    if (!isAdmin || !companyProfileRegion || !companyProfileBucket || !getCredentials) {
      setCompanyProfileLoading(false);
      return;
    }
    (async () => {
      try {
        setCompanyProfileLoading(true);
        const info = await fetchCompanyInfo(companyProfileBucket, companyProfileRegion, getCredentials);
        if (!cancelled) {
          setCompanyProfileText(getProfileText(info));
          setCompanyProfileLastUpdated(info.lastUpdated);
          if (!info.lastUpdated) {
            setCompanyProfileStatus({
              show: true,
              type: 'info',
              message: t('companyInfo.status.empty'),
            });
          }
        }
      } catch (e) {
        if (!cancelled) {
          setCompanyProfileStatus({
            show: true,
            type: 'danger',
            message: t('companyInfo.status.loadError', { message: (e as Error).message }),
          });
        }
      } finally {
        if (!cancelled) setCompanyProfileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, getCredentials]);

  const handleSaveCompanyProfile = async () => {
    setCompanyProfileSaving(true);
    setCompanyProfileStatus({ show: false, type: '', message: '' });
    try {
      await saveCompanyInfo(companyProfileText, companyProfileBucket, companyProfileRegion, getCredentials);
      setCompanyProfileLastUpdated(new Date().toISOString());
      setCompanyProfileStatus({
        show: true,
        type: 'success',
        message: t('companyInfo.status.saveSuccess'),
      });
    } catch (e) {
      setCompanyProfileStatus({
        show: true,
        type: 'danger',
        message: t('companyInfo.status.saveError', { message: (e as Error).message }),
      });
    } finally {
      setCompanyProfileSaving(false);
    }
  };

  // Integrations tab internal state
  const [manageToolsFor, setManageToolsFor] = useState<string | null>(null);
  const [toolsLoading, setToolsLoading] = useState<boolean>(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [toolList, setToolList] = useState<{ name: string; description?: string }[]>([]);
  const [toolToggles, setToolToggles] = useState<Record<string, boolean>>({});
  const [_integrationsTabKey, _setIntegrationsTabKey] = useState<'connected-apps' | 'data-connectors'>(
    'connected-apps'
  );
  const [userSettingsTabKey, setUserSettingsTabKey] = useState<string>(urlTab || 'my-profile');

  useEffect(() => {
    if (!workspaceChatEnabled && userSettingsTabKey === 'approval-settings') {
      setUserSettingsTabKey('user-settings');
    }
  }, [workspaceChatEnabled, userSettingsTabKey]);

  // Sync active tab + scope to URL path so refreshing preserves position
  useEffect(() => {
    let tab: string;
    switch (currentScope) {
      case 'admin':
        tab = activeKey;
        break;
      case 'developer':
        tab = 'api-keys';
        break;
      case 'services':
        tab = auditTabKey;
        break;
      default:
        tab = userSettingsTabKey;
    }
    navigate(`/settings/${currentScope}/${tab}`, { replace: true });
  }, [currentScope, activeKey, userSettingsTabKey, auditTabKey, navigate]);

  const [isBrandingDirty, setIsBrandingDirty] = useState<boolean>(false);

  useNavigationConfirm(isAdmin && activeKey === 'branding' && isBrandingDirty, t('navigation.unsavedBranding'));

  // Chat defaults (company-wide)
  const [globalChatSettings, setGlobalChatSettings] = useState<GlobalChatSettings>(DEFAULT_GLOBAL_CHAT_SETTINGS);
  const [chatDefaultsLoading, setChatDefaultsLoading] = useState<boolean>(true);
  const [chatDefaultsSaving, setChatDefaultsSaving] = useState<boolean>(false);
  const [chatDefaultsError, setChatDefaultsError] = useState<string | null>(null);
  const [chatDefaultsDirty, setChatDefaultsDirty] = useState<boolean>(false);
  const chatDefaultsDirtyRef = useRef<boolean>(chatDefaultsDirty);
  const savedChatDefaultsRef = useRef<string>('');

  useEffect(() => {
    chatDefaultsDirtyRef.current = chatDefaultsDirty;
  }, [chatDefaultsDirty]);

  // Auto-clear dirty when admin undoes chat defaults changes
  useEffect(() => {
    if (!chatDefaultsDirty) return;
    if (JSON.stringify(globalChatSettings) === savedChatDefaultsRef.current) setChatDefaultsDirty(false);
  }, [globalChatSettings, chatDefaultsDirty]);

  useNavigationConfirm(
    isAdmin && activeKey === 'chat-defaults' && chatDefaultsDirty,
    t('navigation.unsavedChatDefaults')
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isAdmin) {
        if (!cancelled) setChatDefaultsLoading(false);
        return;
      }
      try {
        setChatDefaultsLoading(true);
        const settings = await AdminChatSettingsService.getGlobal(numaGet);
        if (!cancelled) {
          if (!chatDefaultsDirtyRef.current) {
            setGlobalChatSettings(settings);
            savedChatDefaultsRef.current = JSON.stringify(settings);
            setChatDefaultsError(null);
            setChatDefaultsDirty(false);
          }
        }
      } catch (e) {
        if (!cancelled) setChatDefaultsError((e as Error).message || t('errors.loadChatDefaults'));
      } finally {
        if (!cancelled) setChatDefaultsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, numaGet]);

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
      setToolsError((e as Error).message || t('errors.loadTools'));
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
        numaPut
      );
      await loadGlobal();
      setManageToolsFor(null);
    } catch (e) {
      setToolsError((e as Error).message || t('errors.saveFailed'));
    }
  };

  const toggleIntegration = async (integrationId: string, nextEnabled: boolean) => {
    try {
      if (!nextEnabled && globalSettings[integrationId]?.status === 'enabled') {
        const ok = window.confirm(t('confirm.disableIntegration', { integrationId }));
        if (!ok) return;
      }
      await AdminIntegrationsService.updateWithNuma(
        integrationId,
        {
          status: nextEnabled ? 'enabled' : 'disabled',
          denyTools: globalSettings[integrationId]?.denyTools || [],
        },
        numaPut
      );
      await loadGlobal();
    } catch (e) {
      setError((e as Error).message || t('errors.updateIntegration'));
    }
  };

  const toggleCapability = async (flagName: string, nextEnabled: boolean) => {
    try {
      const cap = capabilities.find((c) => c.flag === flagName);
      if (!nextEnabled && capabilitySettings[flagName]?.status !== 'disabled') {
        const displayName = cap?.labelKey ? t(cap.labelKey) : (cap?.name ?? flagName);
        const ok = window.confirm(t('capabilities.disableConfirm', { name: displayName }));
        if (!ok) return;
      }
      await CapabilitiesService.update(flagName, { status: nextEnabled ? 'enabled' : 'disabled' }, numaPut);
      await loadCapabilitySettings();
      // Refresh gating so Nav and Routes reflect the change immediately
      await loadAdminCapabilityGating(numaGet);
    } catch (e) {
      setError((e as Error).message || t('errors.updateDataConnector'));
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
        const confirmLeave = window.confirm(t('navigation.unsavedBranding'));

        if (!confirmLeave) {
          return;
        }

        setIsBrandingDirty(false);
      }

      setActiveKey(nextKey);
    },
    [activeKey, isBrandingDirty]
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
              <div className="fw-semibold settings-item-title">{integration.name}</div>
              <div className="text-muted small settings-item-description">{integration.description}</div>
            </div>
          </div>
          <div className="col-md-6 d-flex justify-content-end gap-2 align-items-center">
            {disabledByPreview ? (
              <OverlayTrigger placement="top" overlay={<Tooltip>{t('integrations.previewTooltip')}</Tooltip>}>
                <div>
                  <Form.Check
                    type="switch"
                    id={`toggle-${id}`}
                    checked={enabled}
                    disabled
                    label={
                      <span className="small">
                        {enabled ? t('integrations.status.enabled') : t('integrations.status.disabled')}
                      </span>
                    }
                  />
                </div>
              </OverlayTrigger>
            ) : (
              <Form.Check
                type="switch"
                id={`toggle-${id}`}
                checked={enabled}
                onChange={() => toggleIntegration(id, !enabled)}
                label={
                  <span className="small">
                    {enabled ? t('integrations.status.enabled') : t('integrations.status.disabled')}
                  </span>
                }
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
              {t('integrations.manageTools')}{' '}
              {deniedCount > 0 && (
                <span className="ms-1 badge bg-light text-dark settings-item-badge">
                  {t('integrations.toolsOff', { count: deniedCount })}
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  /**
   * Resolve effective devOnly / deployRequired for a capability.
   * DynamoDB values (from per-instance admin settings) override the metadata defaults.
   */
  const resolveCapMeta = (cap: CapabilityItem) => {
    return {
      devOnly: cap.devOnly,
      deployRequired: cap.deployRequired,
    };
  };

  /** Filter: devOnly capabilities hidden unless user has DEVELOPER_MODE enabled. */
  const isDeveloper = getFlag('DEVELOPER_MODE');
  const visibleCapabilities = capabilities.filter((cap) => {
    const meta = resolveCapMeta(cap);
    return !meta.devOnly || isDeveloper;
  });

  /** Group visible capabilities by dependency for the UI. */
  const capabilityGroups = groupByDependencies(visibleCapabilities);

  const renderCapabilityRow = (cap: CapabilityItem, isChild = false) => {
    const deployValue = typeof window !== 'undefined' ? window.sessionStorage.getItem(`DEPLOY_${cap.flag}`) : null;
    // isDeployed: true if explicitly in config, or unknown (not yet wired up — dev flag)
    const isDeployed = deployValue !== null ? deployValue === 'true' : true;
    const capSetting = capabilitySettings[cap.flag];
    // Default to enabled if no admin setting exists (user requirement: enabled by default)
    const adminEnabled = capSetting ? capSetting.status === 'enabled' : true;
    const meta = resolveCapMeta(cap);
    const displayName = cap.labelKey ? t(cap.labelKey, { defaultValue: cap.name }) : cap.name;
    const displayDescription = cap.descriptionKey
      ? t(cap.descriptionKey, { defaultValue: cap.description })
      : cap.description;

    return (
      <div
        key={cap.flag}
        className="border rounded-3 p-3 mb-2 bg-white"
        style={{
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          transition: 'all 0.2s ease',
          opacity: isDeployed ? 1 : 0.5,
          cursor: 'default',
          filter: !isDeployed ? 'grayscale(50%)' : 'none',
          ...(isChild ? { marginLeft: '2rem', borderLeft: '3px solid #dee2e6' } : {}),
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
        }}
      >
        <div className="row align-items-center">
          <div className="col-md-7 d-flex align-items-center">
            <div
              className="rounded-2 d-flex align-items-center justify-content-center me-3 flex-shrink-0"
              style={{ width: '48px', height: '48px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6' }}
            >
              <i
                className={`bi ${cap.icon ?? 'bi-gear'}`}
                style={{ fontSize: '24px', color: isDeployed ? '#0d6efd' : '#6c757d' }}
              />
            </div>
            <div>
              <div
                className="fw-semibold settings-item-title d-flex align-items-center gap-2"
                style={{ fontSize: '0.95rem' }}
              >
                {displayName}
                {!isDeployed && <span className="badge bg-secondary small">{t('capabilities.notDeployed')}</span>}
                {meta.deployRequired && (
                  <span className="text-muted small">{t('capabilities.requiresDeployBadge')}</span>
                )}
              </div>
              <div
                className="text-muted small settings-item-description"
                style={{ fontSize: '0.85rem', lineHeight: '1.4' }}
              >
                {displayDescription}
              </div>
            </div>
          </div>
          <div className="col-md-5 d-flex justify-content-end gap-2 align-items-center">
            {!isDeployed ? (
              <OverlayTrigger placement="top" overlay={<Tooltip>{t('capabilities.notDeployed')}</Tooltip>}>
                <div>
                  <Form.Check
                    type="switch"
                    id={`toggle-cap-${cap.flag}`}
                    checked={false}
                    disabled
                    label={<span className="small text-muted">{t('capabilities.notDeployed')}</span>}
                  />
                </div>
              </OverlayTrigger>
            ) : (
              <Form.Check
                type="switch"
                id={`toggle-cap-${cap.flag}`}
                checked={adminEnabled}
                onChange={() => toggleCapability(cap.flag, !adminEnabled)}
                label={
                  <span className="small">
                    {adminEnabled ? t('capabilities.toggleEnabled') : t('capabilities.toggleDisabled')}
                  </span>
                }
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  const adminTabs = useMemo(
    () => [
      { key: 'users', label: t('tabs.users'), iconClassName: 'bi bi-people' },
      ...(allowBrandingTab ? [{ key: 'branding', label: t('tabs.branding'), iconClassName: 'bi bi-palette' }] : []),
      { key: 'chat-defaults', label: t('tabs.chatDefaults'), iconClassName: 'bi bi-chat-dots' },
      { key: 'numa-libraries', label: 'Numa Libraries', iconClassName: 'bi bi-journal-code' },
      { key: 'company-profile', label: t('tabs.companyProfile'), iconClassName: 'bi bi-building' },
      ...(agentsFeatureEnabled ? [{ key: 'agents', label: t('tabs.agents'), iconClassName: 'bi bi-robot' }] : []),
      { key: 'integrations', label: t('tabs.integrations'), iconClassName: 'bi bi-plug' },
      ...(dataConnectorsEnabled
        ? [{ key: 'data-connectors', label: t('tabs.dataConnectors'), iconClassName: 'bi bi-cloud-download' }]
        : []),
      { key: 'capabilities', label: t('capabilities.tabTitle'), iconClassName: 'bi bi-toggles' },
      { key: 'usage', label: t('tabs.usage'), iconClassName: 'bi bi-bar-chart-line' },
    ],
    // REBASE RESOLUTION: Kept HEAD deps. Incoming (8e1a6ca9, 0139d1c5) omitted mfaEnabled.
    [allowBrandingTab, agentsFeatureEnabled, mfaEnabled, dataConnectorsEnabled, t]
  );
  const userTabs = useMemo(
    () => [
      { key: 'my-profile', label: t('userProfile.tabs.myProfile'), iconClassName: 'bi bi-person-circle' },
      { key: 'user-settings', label: t('userProfile.tabs.userSettings'), iconClassName: 'bi bi-person-gear' },
      { key: 'user-defaults', label: t('userProfile.tabs.chatDefaults'), iconClassName: 'bi bi-sliders' },
      ...(workspaceChatEnabled
        ? [
            {
              key: 'approval-settings',
              label: t('userProfile.tabs.approvalSettings'),
              iconClassName: 'bi bi-shield-check',
            },
          ]
        : []),
      ...(mfaEnabled
        ? [{ key: 'trusted-devices', label: t('userProfile.trustedDevices.title'), iconClassName: 'bi bi-phone' }]
        : []),
    ],
    // REBASE RESOLUTION: Kept HEAD — includes mfaEnabled in deps. Incoming (8e1a6ca9, 2f54184e) omitted it,
    // but mfaEnabled IS used in the useMemo body (line ~767), so omitting it was a bug.
    [workspaceChatEnabled, mfaEnabled, t]
  );

  return (
    <div className="dashboard settings-page">
      <PageHeader
        title={t('header.title')}
        subtitle={
          currentScope === 'admin'
            ? t('header.adminSubtitle')
            : currentScope === 'developer'
              ? t('header.developerSubtitle')
              : currentScope === 'services'
                ? t('header.servicesSubtitle')
                : t('header.userSubtitle')
        }
        actions={
          isAdmin ? (
            <div className="settings-scope-toggle" role="group" aria-label={t('scope.label')}>
              <button
                type="button"
                className={`settings-scope-toggle__button ${currentScope === 'user' ? 'active' : ''}`}
                onClick={() => setSettingsScope('user')}
              >
                <i className="bi bi-person-circle" aria-hidden="true"></i>
                {t('scope.user')}
              </button>
              <button
                type="button"
                className={`settings-scope-toggle__button ${currentScope === 'admin' ? 'active' : ''}`}
                onClick={() => setSettingsScope('admin')}
              >
                <i className="bi bi-shield-lock" aria-hidden="true"></i>
                {t('scope.admin')}
              </button>
              <button
                type="button"
                className={`settings-scope-toggle__button ${currentScope === 'developer' ? 'active' : ''}`}
                onClick={() => setSettingsScope('developer')}
              >
                <i className="bi bi-code-slash" aria-hidden="true"></i>
                {t('scope.developer')}
              </button>
              <button
                type="button"
                className={`settings-scope-toggle__button ${currentScope === 'services' ? 'active' : ''}`}
                onClick={() => setSettingsScope('services')}
              >
                <i className="bi bi-clock-history" aria-hidden="true"></i>
                {t('scope.services')}
              </button>
            </div>
          ) : undefined
        }
      />

      {isAdmin && currentScope === 'admin' && (
        <SubHeaderTabBar
          items={adminTabs}
          activeKey={activeKey}
          onSelect={(key) => handleTabSelect(key)}
          ariaLabel={t('header.title')}
          className="settings-admin-tabs-bar"
        />
      )}
      {currentScope === 'user' && (
        <SubHeaderTabBar
          items={userTabs}
          activeKey={userSettingsTabKey}
          onSelect={setUserSettingsTabKey}
          ariaLabel={t('scope.user')}
          className="settings-user-tabs-bar"
        />
      )}
      {isAdmin && currentScope === 'services' && (
        <SubHeaderTabBar
          // CHOSE HEAD: grouped sub-tabs (activity/index/files) match the nested services panel below.
          // 3af3ef8e used flat top-level tabs. To revert: replace with the 3af3ef8e flat list.
          items={[
            { key: 'activity', label: t('auditTabs.activity'), iconClassName: 'bi bi-people' },
            { key: 'index', label: t('auditTabs.index'), iconClassName: 'bi bi-search' },
            { key: 'files', label: t('auditTabs.files'), iconClassName: 'bi bi-file-text' },
          ]}
          activeKey={auditTabKey}
          onSelect={handleAuditTabChange}
          ariaLabel={t('scope.services')}
          className="settings-admin-tabs-bar"
        />
      )}

      <div className="app-content settings-app-content">
        <div hidden={currentScope !== 'user'} aria-hidden={currentScope !== 'user'}>
          <UserProfilePage
            embedded
            activeTabKey={userSettingsTabKey}
            onActiveTabChange={setUserSettingsTabKey}
            settingsScope={currentScope === 'user' || currentScope === 'admin' ? currentScope : 'user'}
          />
        </div>

        {isAdmin && (
          <div hidden={currentScope !== 'admin'} aria-hidden={currentScope !== 'admin'}>
            {(chatDefaultsDirty || isBrandingDirty) && (
              <div className="settings-unsaved-banner">
                <i className="bi bi-exclamation-circle" />
                {t('unsavedBanner')}
              </div>
            )}
            {error && (
              <Alert variant="danger" className="mb-3">
                {error}
              </Alert>
            )}
            <StyledTabs activeKey={activeKey} onSelect={handleTabSelect} className="mb-3 settings-subtabs--panels-only">
              <Tab
                eventKey="users"
                title={
                  <span>
                    <i className="bi bi-people-fill me-2"></i>
                    {t('tabs.users')}
                  </span>
                }
              >
                <UserManagement embedded />
                <SecuritySettingsPanel mfaEnabled={mfaEnabled} numaGet={numaGet} numaPut={numaPut} />
              </Tab>
              {allowBrandingTab && (
                <Tab
                  eventKey="branding"
                  title={
                    <span>
                      <i className="bi bi-palette-fill me-2"></i>
                      {t('tabs.branding')}
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
                      <i className="bi bi-chat-dots-fill me-2"></i>
                      {t('tabs.chatDefaults')}
                    </span>
                  }
                >
                  <div className="mb-3">
                    <Alert variant="secondary" className="mb-3">
                      <div className="d-flex align-items-start">
                        <i className="bi bi-building-gear me-2 mt-1"></i>
                        <div>
                          <div className="settings-section-title">{t('chatDefaults.title')}</div>
                          <div className="small text-muted">{t('chatDefaults.description')}</div>
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
                                <div className="settings-secondary-label">
                                  {t('chatDefaults.allowUserOverridesTitle')}
                                </div>
                                <Form.Check
                                  type="switch"
                                  id="chat-defaults-allow-user-defaults"
                                  label=""
                                  checked={globalChatSettings.allowUserDefaults}
                                  onChange={(e) => {
                                    setGlobalChatSettings((prev) => ({
                                      ...prev,
                                      allowUserDefaults: e.target.checked,
                                    }));
                                    setChatDefaultsDirty(true);
                                  }}
                                />
                              </div>
                              <div className="text-muted small">{t('chatDefaults.allowUserOverridesHelp')}</div>
                            </div>
                          </div>
                        </div>

                        <Form.Group className="mb-3">
                          <Form.Label className="settings-section-title">
                            {t('chatDefaults.defaultKnowledgeBases')}
                          </Form.Label>
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
                                  defaultKBIds: nextChecked
                                    ? Array.from(new Set([...prev.defaultKBIds, 'company']))
                                    : prev.defaultKBIds.filter((id) => id !== 'company'),
                                }));
                                setChatDefaultsDirty(true);
                              }}
                            />
                            <div className="settings-secondary-label">{t('chatDefaults.companyKnowledgeBase')}</div>
                          </div>

                          <div className="d-flex align-items-center gap-2 mt-2">
                            <Form.Check
                              type="switch"
                              id="chat-defaults-kb-support"
                              label=""
                              checked={globalChatSettings.defaultKBIds.includes('numa-support')}
                              onChange={(e) => {
                                const nextChecked = e.target.checked;
                                setGlobalChatSettings((prev) => ({
                                  ...prev,
                                  defaultKBIds: nextChecked
                                    ? Array.from(new Set([...prev.defaultKBIds, 'numa-support']))
                                    : prev.defaultKBIds.filter((id) => id !== 'numa-support'),
                                }));
                                setChatDefaultsDirty(true);
                              }}
                            />
                            <div className="settings-secondary-label">{t('chatDefaults.supportKnowledgeBase')}</div>
                          </div>
                          <div className="text-muted small ms-5">{t('chatDefaults.companyKnowledgeBaseHelp')}</div>
                        </Form.Group>

                        <div className="mb-3">
                          <div className="settings-section-title mb-2">{t('chatDefaults.toolsTitle')}</div>
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
                                    ? {
                                        webSearchEnabled: true,
                                        dataAnalysisEnabled: true,
                                        createAgentEnabled: true,
                                        memoriesEnabled: true,
                                      }
                                    : {
                                        webSearchEnabled: false,
                                        dataAnalysisEnabled: false,
                                        createAgentEnabled: false,
                                        memoriesEnabled: false,
                                      }),
                                }));
                                setChatDefaultsDirty(true);
                              }}
                            />
                            <div className="settings-secondary-label">{t('chatDefaults.allTools')}</div>
                          </div>
                          <div className="text-muted small ms-5">{t('chatDefaults.allToolsHelp')}</div>

                          <div className="mt-3 ms-4">
                            <div className="d-flex align-items-center gap-2">
                              <Form.Check
                                type="switch"
                                id="chat-defaults-web-search"
                                label=""
                                checked={globalChatSettings.autoToolsEnabled || globalChatSettings.webSearchEnabled}
                                disabled={globalChatSettings.autoToolsEnabled}
                                onChange={(e) => {
                                  setGlobalChatSettings((prev) => ({
                                    ...prev,
                                    webSearchEnabled: e.target.checked,
                                  }));
                                  setChatDefaultsDirty(true);
                                }}
                              />
                              <div className="settings-secondary-label">{t('chatDefaults.webSearch')}</div>
                            </div>
                            <div className="text-muted small ms-5">{t('chatDefaults.webSearchHelp')}</div>
                          </div>

                          {dataAnalysisAvailable && (
                            <div className="mt-3 ms-4">
                              <div className="d-flex align-items-center gap-2">
                                <Form.Check
                                  type="switch"
                                  id="chat-defaults-data-analysis"
                                  label=""
                                  checked={
                                    globalChatSettings.autoToolsEnabled || globalChatSettings.dataAnalysisEnabled
                                  }
                                  disabled={globalChatSettings.autoToolsEnabled}
                                  onChange={(e) => {
                                    setGlobalChatSettings((prev) => ({
                                      ...prev,
                                      dataAnalysisEnabled: e.target.checked,
                                    }));
                                    setChatDefaultsDirty(true);
                                  }}
                                />
                                <div className="settings-secondary-label">{t('chatDefaults.dataAnalysis')}</div>
                              </div>
                              <div className="text-muted small ms-5">{t('chatDefaults.dataAnalysisHelp')}</div>
                            </div>
                          )}

                          <div className="mt-3 ms-4">
                            <div className="d-flex align-items-center gap-2">
                              <Form.Check
                                type="switch"
                                id="chat-defaults-create-agent"
                                label=""
                                checked={globalChatSettings.autoToolsEnabled || globalChatSettings.createAgentEnabled}
                                disabled={globalChatSettings.autoToolsEnabled}
                                onChange={(e) => {
                                  setGlobalChatSettings((prev) => ({
                                    ...prev,
                                    createAgentEnabled: e.target.checked,
                                  }));
                                  setChatDefaultsDirty(true);
                                }}
                              />
                              <div className="settings-secondary-label">{t('chatDefaults.agentCreation')}</div>
                            </div>
                            <div className="text-muted small ms-5">{t('chatDefaults.agentCreationHelp')}</div>
                          </div>

                          <div className="mt-3 ms-4">
                            <div className="d-flex align-items-center gap-2">
                              <Form.Check
                                type="switch"
                                id="chat-defaults-memories"
                                label=""
                                checked={globalChatSettings.autoToolsEnabled || globalChatSettings.memoriesEnabled}
                                disabled={globalChatSettings.autoToolsEnabled}
                                onChange={(e) => {
                                  setGlobalChatSettings((prev) => ({
                                    ...prev,
                                    memoriesEnabled: e.target.checked,
                                  }));
                                  setChatDefaultsDirty(true);
                                }}
                              />
                              <div className="settings-secondary-label">{t('chatDefaults.memoryManagement')}</div>
                            </div>
                            <div className="text-muted small ms-5">{t('chatDefaults.memoryManagementHelp')}</div>
                          </div>
                        </div>

                        <Form.Group className="mb-3">
                          <Form.Label className="settings-section-title">
                            {t('chatDefaults.defaultIntegrations')}
                          </Form.Label>
                          {previewMode ? (
                            <div className="text-muted small">{t('chatDefaults.integrationsDisabled')}</div>
                          ) : (
                            <>
                              <ExpandableOverflowBox className="border rounded-3 p-2 bg-white" maxHeight={240}>
                                {availableIntegrations
                                  .filter((integration) => {
                                    const id = integration.name_slug;
                                    return globalSettings[id]?.status === 'enabled';
                                  })
                                  .map((integration) => {
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
                                {availableIntegrations.filter((integration) => {
                                  const id = integration.name_slug;
                                  return globalSettings[id]?.status === 'enabled';
                                }).length === 0 && (
                                  <div className="text-muted small">{t('chatDefaults.noIntegrations')}</div>
                                )}
                              </ExpandableOverflowBox>
                              <div className="text-muted small mt-1">{t('chatDefaults.defaultIntegrationsHelp')}</div>
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
                                    memoriesEnabled: globalChatSettings.memoriesEnabled,
                                    dataAnalysisEnabled: globalChatSettings.dataAnalysisEnabled,
                                    defaultConnectionIds: globalChatSettings.defaultConnectionIds,
                                    allowUserDefaults: globalChatSettings.allowUserDefaults,
                                  },
                                  numaPut
                                );
                                setGlobalChatSettings(saved);
                                savedChatDefaultsRef.current = JSON.stringify(saved);
                                setChatDefaultsError(null);
                                setChatDefaultsDirty(false);
                              } catch (e) {
                                setChatDefaultsError((e as Error).message || t('errors.saveChatDefaults'));
                              } finally {
                                setChatDefaultsSaving(false);
                              }
                            }}
                          >
                            {chatDefaultsSaving ? (
                              <>
                                <Spinner as="span" animation="border" size="sm" className="me-2" />
                                {t('actions.saving')}
                              </>
                            ) : (
                              t('actions.saveChanges')
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
                            {t('actions.resetDefaults')}
                          </Button>
                        </div>
                      </Form>
                    )}
                  </div>
                </Tab>
              )}
              {isAdmin && (
                <Tab
                  eventKey="numa-libraries"
                  title={
                    <span>
                      <i className="bi bi-journal-code me-2"></i>
                      {t('numaLibraries', 'Numa Libraries')}
                    </span>
                  }
                >
                  <NumaLibrariesPanel
                    globalChatSettings={globalChatSettings}
                    setGlobalChatSettings={setGlobalChatSettings}
                    setChatDefaultsDirty={setChatDefaultsDirty}
                    isAdmin={isAdmin}
                  />
                </Tab>
              )}
              {isAdmin && (
                <Tab
                  eventKey="company-profile"
                  title={
                    <span>
                      <i className="bi bi-building-fill me-2"></i>
                      {t('tabs.companyProfile')}
                    </span>
                  }
                >
                  <div className="mb-3">
                    <Alert variant="secondary" className="mb-3">
                      <div className="d-flex align-items-start">
                        <i className="bi bi-building-gear me-2 mt-1"></i>
                        <div>
                          <div className="settings-section-title">{t('companyInfo.adminTitle')}</div>
                          <div className="small text-muted">{t('companyInfo.adminDescription')}</div>
                        </div>
                      </div>
                    </Alert>

                    {companyProfileStatus.show && (
                      <Alert
                        variant={companyProfileStatus.type}
                        dismissible
                        onClose={() => setCompanyProfileStatus({ ...companyProfileStatus, show: false })}
                        className="mb-3"
                      >
                        {companyProfileStatus.message}
                      </Alert>
                    )}

                    {companyProfileLoading ? (
                      <div className="text-center py-4">
                        <Spinner animation="border" />
                      </div>
                    ) : (
                      <Form>
                        <Form.Group className="mb-3">
                          <Form.Label className="settings-section-title">{t('companyInfo.form.label')}</Form.Label>
                          <Form.Control
                            as="textarea"
                            rows={15}
                            value={companyProfileText}
                            onChange={(e) => setCompanyProfileText(e.target.value)}
                            maxLength={10000}
                            placeholder={t('companyInfo.form.placeholder')}
                          />
                          <Form.Text className="d-block mt-2 mb-1 text-muted">
                            {t('companyInfo.form.characterCount', { count: companyProfileText.length })}
                          </Form.Text>
                          <Form.Text className="d-block mb-1 text-muted">{t('companyInfo.form.sharedNote')}</Form.Text>
                          {companyProfileText.length > 3000 && (
                            <Form.Text className="d-block mb-1 text-warning">
                              {t('companyInfo.form.limitNote')}
                            </Form.Text>
                          )}
                        </Form.Group>

                        {companyProfileLastUpdated && (
                          <p className="text-muted small mb-3">
                            <i className="bi bi-clock me-1"></i>
                            {t('companyInfo.lastUpdated.label', {
                              date: new Date(companyProfileLastUpdated).toLocaleString(i18n.language),
                            })}
                          </p>
                        )}

                        <Button variant="primary" onClick={handleSaveCompanyProfile} disabled={companyProfileSaving}>
                          {companyProfileSaving ? (
                            <>
                              <Spinner as="span" animation="border" size="sm" className="me-2" />
                              {t('companyInfo.actions.saving')}
                            </>
                          ) : (
                            t('companyInfo.actions.save')
                          )}
                        </Button>
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
                      <Bot size={16} className="me-2" />
                      {t('tabs.agents')}
                    </span>
                  }
                >
                  <div className="mb-3">
                    <Alert variant="secondary" className="mb-3">
                      <div className="d-flex align-items-start">
                        <i className="bi bi-building-gear me-2 mt-1"></i>
                        <div>
                          <div className="settings-section-title">{t('agents.title')}</div>
                          <div className="small text-muted">{t('agents.description')}</div>
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
                            label: t('agents.options.off.label'),
                            desc: t('agents.options.off.desc'),
                          },
                          {
                            key: 'personal_only',
                            label: t('agents.options.personal.label'),
                            desc: t('agents.options.personal.desc'),
                          },
                          {
                            key: 'full',
                            label: t('agents.options.full.label'),
                            desc: t('agents.options.full.desc'),
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
                                  message = t('agents.confirm.off');
                                } else if (opt.key === 'personal_only') {
                                  message = t('agents.confirm.personal');
                                } else {
                                  message = t('agents.confirm.full');
                                }
                                const ok = window.confirm(message);
                                if (!ok) return;
                                try {
                                  setAgentsSaving(true);
                                  await AdminAgentsService.update(opt.key as AgentsMode, numaPut);
                                  setAgentsMode(opt.key as AgentsMode);
                                } catch (e) {
                                  alert((e as Error).message || t('errors.updateAgentsPolicy'));
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
                                <div className="fw-semibold settings-item-title">{opt.label}</div>
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
                        <div className="text-muted small mt-2">{t('agents.footerNote')}</div>
                      </div>
                    )}
                  </div>
                </Tab>
              )}
              <Tab
                eventKey="integrations"
                title={
                  <span>
                    <i className="bi bi-plug-fill me-2"></i>
                    {t('tabs.integrations')}
                  </span>
                }
              >
                <Alert variant="secondary" className="mb-3">
                  <div className="d-flex align-items-start">
                    <i className="bi bi-building-gear me-2 mt-1"></i>
                    <div>
                      <div className="settings-section-title">{t('integrations.companySettingsTitle')}</div>
                      <div className="small text-muted">{t('integrations.companySettingsDescription')}</div>
                    </div>
                  </div>
                </Alert>
                {previewMode && (
                  <Alert variant="info" className="mb-3">
                    {t('integrations.previewNotice')}
                  </Alert>
                )}
                {loadingSettings ? (
                  <div className="text-center py-5">
                    <Spinner animation="border" variant="primary" />
                  </div>
                ) : (
                  <div>
                    {[...availableIntegrations].sort((a, b) => a.name.localeCompare(b.name)).map(renderIntegrationRow)}
                  </div>
                )}
              </Tab>
              {dataConnectorsEnabled && (
                <Tab
                  eventKey="data-connectors"
                  title={
                    <span>
                      <i className="bi bi-cloud-download me-2"></i>
                      {t('tabs.dataConnectors')}
                    </span>
                  }
                >
                  <DataConnectorsTab adminSettings={dataConnectorSettings} />
                </Tab>
              )}
              <Tab
                eventKey="capabilities"
                title={
                  <span>
                    <i className="bi bi-toggles me-2"></i>
                    {t('capabilities.tabTitle')}
                  </span>
                }
              >
                <Alert variant="secondary" className="mb-3">
                  <div className="d-flex align-items-start">
                    <i className="bi bi-toggles me-2 mt-1"></i>
                    <div>
                      <div className="settings-section-title">{t('capabilities.companySettingsTitle')}</div>
                      <div className="small text-muted">{t('capabilities.companySettingsDescription')}</div>
                    </div>
                  </div>
                </Alert>
                <div>
                  {capabilityGroups.map((group) => (
                    <div key={group.parent.flag}>
                      {renderCapabilityRow(group.parent)}
                      {group.children.map((child) => renderCapabilityRow(child, true))}
                    </div>
                  ))}
                </div>
              </Tab>
              {isAdmin && (
                <Tab
                  eventKey="usage"
                  title={
                    <span>
                      <i className="bi bi-bar-chart-line me-2"></i>
                      {t('tabs.usage')}
                    </span>
                  }
                >
                  <LoginHeatmap />
                </Tab>
              )}
            </StyledTabs>
          </div>
        )}

        {isAdmin && (
          <div hidden={currentScope !== 'developer'} aria-hidden={currentScope !== 'developer'}>
            <UsageAnalyticsPanel />
          </div>
        )}

        {/* CHOSE HEAD: services scope panel with nested activity/index/files sub-tabs.
            3af3ef8e had a simpler 'audit' scope with flat top-level tabs.
            To revert to 3af3ef8e panel: replace this div's scope with 'audit' and simplify tab structure. */}
        {isAdmin && (
          <div hidden={currentScope !== 'services'} aria-hidden={currentScope !== 'services'}>
            {auditTabKey === 'activity' && (
              <>
                <div className="d-flex gap-2 mb-3">
                  <button
                    className={`btn btn-sm ${auditSubKey === 'user-activity' ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setAuditSubKey('user-activity')}
                  >
                    <i className="bi bi-people me-1" />
                    {t('auditTabs.userActivity')}
                  </button>
                  <button
                    className={`btn btn-sm ${auditSubKey === 'automation' ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setAuditSubKey('automation')}
                  >
                    <i className="bi bi-gear me-1" />
                    {t('auditTabs.automation')}
                  </button>
                  <button
                    className={`btn btn-sm ${auditSubKey === 'notifications' ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setAuditSubKey('notifications')}
                  >
                    <i className="bi bi-bell me-1" />
                    {t('auditTabs.notifications')}
                  </button>
                  <button
                    className={`btn btn-sm ${auditSubKey === 'schedule' ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setAuditSubKey('schedule')}
                  >
                    <i className="bi bi-calendar-event me-1" />
                    {t('auditTabs.schedule')}
                  </button>
                </div>
                {auditSubKey === 'user-activity' && <AuditPanel />}
                {auditSubKey === 'automation' && <GenericAuditLogTab logType="automation" />}
                {auditSubKey === 'notifications' && <NotificationsAuditPanel />}
                {auditSubKey === 'schedule' && <GenericAuditLogTab logType="schedule" />}
              </>
            )}

            {auditTabKey === 'index' && (
              <>
                <div className="d-flex gap-2 mb-3">
                  <button
                    className={`btn btn-sm ${auditSubKey === 'web-crawler' ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setAuditSubKey('web-crawler')}
                  >
                    <i className="bi bi-globe me-1" />
                    {t('auditTabs.webCrawler')}
                  </button>
                  <button
                    className={`btn btn-sm ${auditSubKey === 'search-index' ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setAuditSubKey('search-index')}
                  >
                    <i className="bi bi-search me-1" />
                    {t('auditTabs.searchIndex')}
                  </button>
                  <button
                    className={`btn btn-sm ${auditSubKey === 'kb-index' ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setAuditSubKey('kb-index')}
                  >
                    <i className="bi bi-database me-1" />
                    {t('auditTabs.kbIndex')}
                  </button>
                </div>
                {auditSubKey === 'web-crawler' && <GenericAuditLogTab logType="web-crawler" />}
                {auditSubKey === 'search-index' && <GenericAuditLogTab logType="search-index" />}
                {auditSubKey === 'kb-index' && <GenericAuditLogTab logType="kb-index" />}
              </>
            )}

            {auditTabKey === 'files' && (
              <>
                <div className="d-flex gap-2 mb-3">
                  <button
                    className={`btn btn-sm ${auditSubKey === 'upload' ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setAuditSubKey('upload')}
                  >
                    <i className="bi bi-cloud-arrow-up me-1" />
                    {t('auditTabs.upload')}
                  </button>
                  <button
                    className={`btn btn-sm ${auditSubKey === 'scan' ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setAuditSubKey('scan')}
                  >
                    <i className="bi bi-shield-check me-1" />
                    {t('auditTabs.scan')}
                  </button>
                  <button
                    className={`btn btn-sm ${auditSubKey === 'transcribe' ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setAuditSubKey('transcribe')}
                  >
                    <i className="bi bi-file-earmark-text me-1" />
                    {t('auditTabs.transcribe')}
                  </button>
                  <button
                    className={`btn btn-sm ${auditSubKey === 'sync' ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setAuditSubKey('sync')}
                  >
                    <i className="bi bi-arrow-repeat me-1" />
                    {t('auditTabs.sync')}
                  </button>
                  <button
                    className={`btn btn-sm ${auditSubKey === 'recovery' ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setAuditSubKey('recovery')}
                  >
                    <i className="bi bi-arrow-counterclockwise me-1" />
                    {t('auditTabs.recovery')}
                  </button>
                </div>
                {auditSubKey === 'upload' && (
                  <>
                    {filesTableLoading && filesTableJobs.length === 0 ? (
                      <div className="text-center py-5">
                        <Spinner animation="border" />
                      </div>
                    ) : (
                      <>
                        <div className="table-responsive">
                          <Table striped bordered hover>
                            <thead>
                              <tr>
                                <th>{t('auditTabs.uploadTable.fileName')}</th>
                                <th>{t('auditTabs.uploadTable.fileSize')}</th>
                                <th>{t('auditTabs.uploadTable.uploadedAt')}</th>
                                <th>{t('auditTabs.uploadTable.status')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filesTableJobs.length === 0 ? (
                                <tr>
                                  <td colSpan={4} className="text-center text-muted py-4">
                                    {t('auditTabs.uploadTable.noUploads')}
                                  </td>
                                </tr>
                              ) : (
                                filesTableJobs.map((job) => (
                                  <tr key={job.jobId}>
                                    <td className="text-truncate" style={{ maxWidth: '300px' }} title={job.fileName}>
                                      {job.fileName}
                                    </td>
                                    <td>{formatFileSizeSettings(job.fileSize)}</td>
                                    <td>
                                      {new Date(job.createdAt).toLocaleString(undefined, {
                                        dateStyle: 'short',
                                        timeStyle: 'medium',
                                      })}
                                    </td>
                                    <td>
                                      <Badge bg="success">{t('auditTabs.uploadTable.uploaded')}</Badge>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </Table>
                        </div>
                        <div className="d-flex justify-content-between align-items-center">
                          <span className="text-muted small">
                            {t('auditTabs.uploadTable.showing', { count: filesTableJobs.length })}
                          </span>
                          {filesTableNextToken && (
                            <Button
                              variant="outline-primary"
                              size="sm"
                              disabled={filesTableLoading}
                              onClick={() => loadFilesTable(filesTableNextToken)}
                            >
                              {filesTableLoading ? (
                                <Spinner as="span" animation="border" size="sm" />
                              ) : (
                                t('auditTabs.uploadTable.loadMore')
                              )}
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}
                {auditSubKey === 'scan' && (
                  <>
                    {filesTableLoading && filesTableJobs.length === 0 ? (
                      <div className="text-center py-5">
                        <Spinner animation="border" />
                      </div>
                    ) : (
                      <>
                        <div className="table-responsive">
                          <Table striped bordered hover>
                            <thead>
                              <tr>
                                <th>{t('auditTabs.scanTable.fileName')}</th>
                                <th>{t('auditTabs.scanTable.scannedAt')}</th>
                                <th>{t('auditTabs.scanTable.scanResult')}</th>
                                <th>{t('auditTabs.scanTable.duration')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filesTableJobs.length === 0 ? (
                                <tr>
                                  <td colSpan={4} className="text-center text-muted py-4">
                                    {t('auditTabs.scanTable.noScans')}
                                  </td>
                                </tr>
                              ) : (
                                filesTableJobs.map((job) => (
                                  <tr key={job.jobId}>
                                    <td className="text-truncate" style={{ maxWidth: '300px' }} title={job.fileName}>
                                      {job.fileName}
                                    </td>
                                    <td>
                                      {new Date(job.createdAt).toLocaleString(undefined, {
                                        dateStyle: 'short',
                                        timeStyle: 'medium',
                                      })}
                                    </td>
                                    <td>
                                      <Badge bg="secondary">{t('auditTabs.scanTable.skipped')}</Badge>
                                    </td>
                                    <td>{'-'}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </Table>
                        </div>
                        <div className="d-flex justify-content-between align-items-center">
                          <span className="text-muted small">
                            {t('auditTabs.scanTable.showing', { count: filesTableJobs.length })}
                          </span>
                          {filesTableNextToken && (
                            <Button
                              variant="outline-primary"
                              size="sm"
                              disabled={filesTableLoading}
                              onClick={() => loadFilesTable(filesTableNextToken)}
                            >
                              {filesTableLoading ? (
                                <Spinner as="span" animation="border" size="sm" />
                              ) : (
                                t('auditTabs.scanTable.loadMore')
                              )}
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}
                {/* CHOSE HEAD: TranscriptionJobsPanel used here instead of ec7ae674's GenericAuditLogTab.
                    The rebuild button from ec7ae674 is placed above the panel.
                    To revert to ec7ae674: replace this block with:
                      <GenericAuditLogTab logType="transcripts" actionButton={...rebuild button...} /> */}
                {/* CHOSE HEAD (kept across f9106bfc): button stays here, not in Files.tsx */}
                {auditSubKey === 'transcribe' && (
                  <>
                    {/* Rebuild button — integrated into services/files/transcribe sub-tab */}
                    <div className="d-flex align-items-center mb-3 gap-2">
                      {rebuildResult && (
                        <Alert
                          variant="info"
                          className="d-inline-block me-3 mb-0 py-1 px-3"
                          style={{ fontSize: '0.875rem' }}
                        >
                          {t('rebuildResult', {
                            created: rebuildResult.created,
                            skipped: rebuildResult.skipped,
                            failed: rebuildResult.failed,
                          })}
                        </Alert>
                      )}
                      <Button
                        variant="outline-warning"
                        size="sm"
                        disabled={rebuilding}
                        onClick={async () => {
                          setRebuilding(true);
                          setRebuildResult(null);
                          try {
                            const result = await TranscriptionService.rebuild(numaPost);
                            setRebuildResult(result);
                          } catch (e) {
                            console.error('Rebuild failed', e);
                          } finally {
                            setRebuilding(false);
                          }
                        }}
                      >
                        {rebuilding ? (
                          <>
                            <Spinner animation="border" size="sm" className="me-1" />
                            {t('rebuilding')}
                          </>
                        ) : (
                          <>
                            <i className="bi bi-arrow-repeat me-1"></i>
                            {t('rebuildTranscripts')}
                          </>
                        )}
                      </Button>
                    </div>
                    <TranscriptionJobsPanel />
                  </>
                )}
                {/* CHOSE HEAD (final): services panel already contains the rebuild button.
                    392dea79 would have used 'audit' scope + GenericAuditLogTab for transcripts.
                    To revert: swap scope to 'audit' and replace TranscriptionJobsPanel with
                    GenericAuditLogTab + actionButton rebuild button (see 392dea79 diff). */}
                {auditSubKey === 'sync' && <GenericAuditLogTab logType="sync" />}
                {auditSubKey === 'recovery' && <GenericAuditLogTab logType="recovery" />}
              </>
            )}
          </div>
        )}
      </div>

      {isAdmin && (
        <Modal show={!!manageToolsFor} onHide={() => setManageToolsFor(null)} centered size="lg">
          <Modal.Header closeButton className="border-0 pb-2">
            <Modal.Title>
              <div className="d-flex align-items-center">
                <i className="bi bi-sliders me-2 text-primary"></i>
                {t('manageTools.title', { integration: manageToolsFor || '' })}
              </div>
              <div className="small text-muted fw-normal mt-2 settings-modal-subtitle">{t('manageTools.subtitle')}</div>
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="pt-2" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {toolsLoading ? (
              <div className="text-center py-5">
                <Spinner animation="border" variant="primary" />
                <p className="mt-3 text-muted mb-0">{t('manageTools.loading')}</p>
              </div>
            ) : toolsError ? (
              <Alert variant="danger" className="mb-0">
                <i className="bi bi-exclamation-triangle-fill me-2"></i>
                {toolsError}
              </Alert>
            ) : toolList.length === 0 ? (
              <div className="text-center py-5">
                <i className="bi bi-info-circle text-muted settings-empty-state-icon"></i>
                <p className="text-muted mt-2 mb-0">{t('manageTools.empty')}</p>
              </div>
            ) : (
              <div className="d-flex flex-column gap-2">
                {toolList.map((tool) => {
                  const allowed = toolToggles[tool.name] ?? true;

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
                      const linkText = match[1].toLowerCase().includes('see')
                        ? t('manageTools.seeDocumentation')
                        : match[1];

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
                        </a>
                      );

                      lastIndex = match.index + match[0].length;
                    }

                    // Add any remaining text
                    if (lastIndex < desc.length) {
                      parts.push(desc.substring(lastIndex));
                    }

                    return parts.length > 0 ? parts : desc;
                  };

                  const displayName = toTitle(stripPrefix(tool.name, manageToolsFor));

                  return (
                    <div
                      key={tool.name}
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
                        {tool.description && (
                          <div
                            className={`small settings-tool-description ${allowed ? 'text-muted' : 'text-secondary'}`}
                            style={{
                              maxWidth: 720,
                              whiteSpace: 'normal',
                              wordBreak: 'break-word',
                            }}
                          >
                            {parseDescription(tool.description)}
                          </div>
                        )}
                      </div>
                      <div className="form-check form-switch ms-2">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={allowed}
                          onChange={(e) => setToolToggles({ ...toolToggles, [tool.name]: e.target.checked })}
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
                    {t('manageTools.enabledCount', {
                      enabled: Object.values(toolToggles).filter(Boolean).length,
                      total: toolList.length,
                    })}
                  </span>
                )}
              </small>
              <div>
                <Button variant="secondary" onClick={() => setManageToolsFor(null)} className="me-2">
                  {t('actions.cancel')}
                </Button>
                <Button variant="primary" onClick={saveManageTools} disabled={toolsLoading || !!toolsError}>
                  <i className="bi bi-check-lg me-2"></i>
                  {t('actions.saveChanges')}
                </Button>
              </div>
            </div>
          </Modal.Footer>
        </Modal>
      )}
    </div>
  );
}
