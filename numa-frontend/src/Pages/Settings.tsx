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
import { DisasterRecoveryTab } from '../Components/DisasterRecovery/DisasterRecoveryTab';
import { CapabilitiesService, type CapabilitySettingsMap } from '../Services/CapabilitiesService';
import { AdminAgentsService, type AgentsMode } from '../Services/AdminAgentsService';
import { AdminSchedulingSettingsService } from '../Services/AdminSchedulingSettingsService';
import { getIntegrationsListFormat, type IntegrationListItem } from '../config/integrationsConfig';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import BrandingAdminPanel from '../Components/Branding/BrandingAdminPanel';
import UsageAnalyticsPanel from '../Components/UsageAnalytics/UsageAnalyticsPanel';
import AuditPanel from '../Components/UsageAnalytics/AuditPanel';
import LoginHeatmap from '../Components/UsageAnalytics/LoginHeatmap';

import GenericAuditLogTab from '../Components/UsageAnalytics/GenericAuditLogTab';
import NotificationsAuditPanel from '../Components/UsageAnalytics/NotificationsAuditPanel';
import UserManagementAuditTab from '../Components/UsageAnalytics/UserManagementAuditTab';
import { UNSAFE_NavigationContext, useParams, useNavigate } from 'react-router-dom';
import {
  AdminChatSettingsService,
  type GlobalChatSettings,
  DEFAULT_GLOBAL_CHAT_SETTINGS,
} from '../Services/AdminChatSettingsService';
import ExpandableOverflowBox from '../Components/ExpandableOverflowBox';
import {
  fetchCompanyInfo,
  saveCompanyInfo,
  type CompanyProfileData,
  LIMIT_COMPANY_NAME,
  LIMIT_INDUSTRY,
  LIMIT_COUNTRY,
  LIMIT_COMPANY_INFO,
  LIMIT_BEST_PRACTICES,
} from '../utils/companyInfoUtils';
import { CharCount } from '../Components/CharCount';
import { manifestService } from '../Services/manifestService';
import { loadCapabilities, groupByDependencies } from '../utils/capabilityRegistry';
import { ROUTE_CONFIG } from '../utils/routeConfig';
import type { CapabilityItem } from '../utils/capabilityRegistry';
import { getFlagRegistry } from '../utils/featureFlags';
import SSOSettingsPanel from '../Components/Settings/SSOSettingsPanel';
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
  files: 'sync',
  users: 'user-management',
};

export default function SettingsPage() {
  const { t, i18n } = useTranslation('settings');
  const { user, getCredentials, lambdaClient } = useAuth();
  const { numaGet, numaPut, numaPost, numaDelete } = useNumaRequest();
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

  // Upload/Scan table state (shared data source)
  const brandingFlag =
    typeof window !== 'undefined' ? window.sessionStorage.getItem('BRANDING_PROVIDER_ENABLED') : null;
  const brandingApiEnabled = brandingFlag === 'true';
  const isAdmin = Boolean(user?.groups?.includes('admin'));
  const currentScope: SettingsScope = isAdmin ? settingsScope : 'user';
  const allowBrandingTab = brandingApiEnabled && isAdmin;
  const agentsFeatureEnabled = getFlag('AGENTS');
  const schedulingEnabled = getFlag('SCHEDULING');
  const dataConnectorsEnabled = getFlag('DATA_CONNECTORS_ENABLED');
  const mfaEnabled = getFlag('MFA_ENABLED');
  const hasOps = getFlag('NUMA_OPS');
  const ssoEnabled = getFlag('SSO_ENABLED');
  // Hidden by default — only shown when explicitly set to true in numa-client-config
  const usageReportingEnabled = window.sessionStorage.getItem('DEPLOY_USAGE_REPORTING') === 'true';
  const developerModeEnabled = window.sessionStorage.getItem('DEPLOY_DEVELOPER_MODE') === 'true';
  const disasterRecoveryEnabled = getFlag('DISASTER_RECOVERY');
  const availableIntegrations = useMemo<IntegrationListItem[]>(() => getIntegrationsListFormat(), [i18n.language]);

  useEffect(() => {
    if (!isAdmin && settingsScope !== 'user') {
      setSettingsScope('user');
    }
    if (!developerModeEnabled && (settingsScope === 'developer' || settingsScope === 'services')) {
      setSettingsScope('admin');
    }
  }, [isAdmin, developerModeEnabled, settingsScope]);

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

  // Scheduling admin settings (Level 3 — client-admin minimum interval)
  const [schedulingMinInterval, setSchedulingMinInterval] = useState<string>('');
  const [schedulingArcanumFloor, setSchedulingArcanumFloor] = useState<number>(5);
  const [schedulingMinLoading, setSchedulingMinLoading] = useState<boolean>(true);
  const [schedulingMinSaving, setSchedulingMinSaving] = useState<boolean>(false);
  const [schedulingMinError, setSchedulingMinError] = useState<string | null>(null);
  const [schedulingMinSuccess, setSchedulingMinSuccess] = useState<string | null>(null);

  const [dataAnalysisAvailable, setDataAnalysisAvailable] = useState(true);

  // Company profile (admin) settings
  const [companyProfile, setCompanyProfile] = useState<CompanyProfileData>({
    companyName: '',
    industry: '',
    country: '',
    companyInformation: '',
    bestPractices: '',
    lastUpdated: null,
  });
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

    loadCapabilities().then((meta) => {
      if (meta.length > 0) {
        // New path: capabilities.json exists (post-deploy with metadata).
        // Only show capabilities in BOTH the metadata AND deployed as true.
        const items = meta.filter((cap) => {
          const deployValue = sessionStorage.getItem(`DEPLOY_${cap.flag}`);
          // Also check raw flag for backward compat (older deployments without DEPLOY_ prefix)
          const rawValue = sessionStorage.getItem(cap.flag);
          return deployValue === 'true' || (deployValue === null && rawValue === 'true');
        });
        setCapabilities(items);
      } else {
        // Fallback: no capabilities.json (old deployment) — existing behavior with raw flag names
        const items: CapabilityItem[] = [];

        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (!key?.startsWith('DEPLOY_')) continue;
          const flag = key.slice(7);
          const deployValue = sessionStorage.getItem(key);
          if (deployValue === 'false') continue;
          items.push({
            flag,
            name: flag,
            description: '',
            deployRequired: false,
            devOnly: false,
            dependencies: [],
            systemOnly: false,
          });
        }

        const allKnownFlags = new Set(getFlagRegistry());
        for (const r of ROUTE_CONFIG) {
          if (r.featureFlag) allKnownFlags.add(r.featureFlag);
        }

        for (const flag of allKnownFlags) {
          if (items.some((c) => c.flag === flag)) continue;
          if (sessionStorage.getItem(`DEPLOY_${flag}`) === 'false') continue;
          items.push({
            flag,
            name: flag,
            description: '',
            deployRequired: false,
            devOnly: false,
            dependencies: [],
            systemOnly: false,
          });
        }

        setCapabilities(items);
      }
    });
  }, [isAdmin, user, numaGet]);

  // Load Data Connector admin settings
  useEffect(() => {
    if (!isAdmin || !dataConnectorsEnabled || !user) return;
    AdminDataConnectorsService.listWithNuma(numaGet)
      .then(setDataConnectorSettings)
      .catch(() => setDataConnectorSettings({ synergy: { status: 'disabled' } }));
  }, [isAdmin, dataConnectorsEnabled, user, numaGet]);

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

  // Load Scheduling admin settings
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isAdmin || !schedulingEnabled) {
        if (!cancelled) setSchedulingMinLoading(false);
        return;
      }
      try {
        setSchedulingMinLoading(true);
        const res = await AdminSchedulingSettingsService.get(numaGet);
        if (!cancelled) {
          setSchedulingMinInterval(res.minIntervalMinutes != null ? String(res.minIntervalMinutes) : '');
          setSchedulingArcanumFloor(res.arcanumFloor);
        }
      } catch (e) {
        console.warn('Settings: failed to load scheduling settings', e);
        if (!cancelled) setSchedulingMinLoading(false);
      } finally {
        if (!cancelled) setSchedulingMinLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, schedulingEnabled, user, numaGet]);

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
          setCompanyProfile(info);
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
      await saveCompanyInfo(companyProfile, companyProfileBucket, companyProfileRegion, getCredentials);
      setCompanyProfile((prev) => ({ ...prev, lastUpdated: new Date().toISOString() }));
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
    const capSetting = capabilitySettings[cap.flag];
    const adminEnabled = capSetting ? capSetting.status === 'enabled' : true;
    const isSystemOnly = cap.systemOnly ?? false;
    const displayName = cap.labelKey ? t(cap.labelKey, { defaultValue: cap.name }) : cap.name;
    const displayDescription = cap.descriptionKey
      ? t(cap.descriptionKey, { defaultValue: cap.description })
      : cap.description;

    // Visual states:
    // 1. systemOnly = true → always on, no toggle, info styling
    // 2. systemOnly = false + adminEnabled → normal with toggle on
    // 3. systemOnly = false + !adminEnabled → greyed out with toggle off
    const isGreyed = !isSystemOnly && !adminEnabled;

    // Icon color: system-managed = teal, enabled = blue, disabled = grey
    const iconColor = isSystemOnly ? '#0d9488' : isGreyed ? '#6c757d' : '#0d6efd';

    return (
      <div
        key={cap.flag}
        className="border rounded-3 p-3 mb-2 bg-white"
        style={{
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          transition: 'all 0.2s ease',
          opacity: isGreyed ? 0.55 : 1,
          cursor: 'default',
          filter: isGreyed ? 'grayscale(40%)' : 'none',
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
              style={{
                width: '48px',
                height: '48px',
                backgroundColor: isSystemOnly ? '#f0fdfa' : '#f8f9fa',
                border: `1px solid ${isSystemOnly ? '#99f6e4' : '#dee2e6'}`,
              }}
            >
              <i className={`bi ${cap.icon ?? 'bi-gear'}`} style={{ fontSize: '24px', color: iconColor }} />
            </div>
            <div>
              <div
                className="fw-semibold settings-item-title d-flex align-items-center gap-2"
                style={{ fontSize: '0.95rem' }}
              >
                {displayName}
                {isSystemOnly && (
                  <OverlayTrigger placement="top" overlay={<Tooltip>{t('capabilities.systemManagedTooltip')}</Tooltip>}>
                    <span
                      className="badge d-inline-flex align-items-center gap-1"
                      style={{
                        backgroundColor: '#f0fdfa',
                        color: '#0d9488',
                        border: '1px solid #99f6e4',
                        fontSize: '0.7rem',
                      }}
                    >
                      <i className="bi bi-lock-fill" />
                      {t('capabilities.systemManaged')}
                    </span>
                  </OverlayTrigger>
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
            {isSystemOnly ? (
              <span className="small" style={{ color: '#0d9488' }}>
                {t('capabilities.toggleEnabled')}
              </span>
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
      ...(ssoEnabled ? [{ key: 'sso', label: t('tabs.sso'), iconClassName: 'bi bi-shield-check' }] : []),
      ...(allowBrandingTab ? [{ key: 'branding', label: t('tabs.branding'), iconClassName: 'bi bi-palette' }] : []),
      { key: 'chat-defaults', label: t('tabs.chatDefaults'), iconClassName: 'bi bi-chat-dots' },
      { key: 'company-profile', label: t('tabs.companyProfile'), iconClassName: 'bi bi-building' },
      ...(agentsFeatureEnabled ? [{ key: 'agents', label: t('tabs.agents'), iconClassName: 'bi bi-robot' }] : []),
      ...(schedulingEnabled
        ? [{ key: 'scheduling', label: t('tabs.scheduling'), iconClassName: 'bi bi-clock-history' }]
        : []),
      { key: 'integrations', label: t('tabs.integrations'), iconClassName: 'bi bi-plug' },
      ...(dataConnectorsEnabled
        ? [{ key: 'data-connectors', label: t('tabs.dataConnectors'), iconClassName: 'bi bi-cloud-download' }]
        : []),
      { key: 'capabilities', label: t('capabilities.tabTitle'), iconClassName: 'bi bi-toggles' },
      ...(usageReportingEnabled
        ? [{ key: 'usage', label: t('tabs.usage'), iconClassName: 'bi bi-bar-chart-line' }]
        : []),
      ...(disasterRecoveryEnabled
        ? [{ key: 'disaster-recovery', label: t('tabs.disasterRecovery'), iconClassName: 'bi bi-shield-check' }]
        : []),
    ],
    [
      allowBrandingTab,
      ssoEnabled,
      agentsFeatureEnabled,
      mfaEnabled,
      schedulingEnabled,
      dataConnectorsEnabled,
      usageReportingEnabled,
      disasterRecoveryEnabled,
      t,
    ]
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
        ? [{ key: 'trusted-devices', label: t('userProfile.trustedDevices.title'), iconClassName: 'bi bi-shield-lock' }]
        : []),
    ],
    // REBASE RESOLUTION: Kept HEAD — includes mfaEnabled in deps. Incoming (8e1a6ca9, 2f54184e) omitted it,
    // but mfaEnabled IS used in the useMemo body (line ~767), so omitting it was a bug.
    [workspaceChatEnabled, mfaEnabled, t]
  );

  const activeTabLabel = (() => {
    if (currentScope === 'admin') return adminTabs.find((tab) => tab.key === activeKey)?.label;
    if (currentScope === 'user') return userTabs.find((tab) => tab.key === userSettingsTabKey)?.label;
    if (currentScope === 'services')
      return [
        { key: 'activity', label: t('auditTabs.activity') },
        { key: 'index', label: t('auditTabs.index') },
        { key: 'files', label: t('auditTabs.files') },
        { key: 'users', label: t('auditTabs.users') },
      ].find((tab) => tab.key === auditTabKey)?.label;
    return undefined;
  })();

  return (
    <div className="dashboard settings-page">
      <PageHeader
        title={activeTabLabel ? `${t('header.title')} / ${activeTabLabel}` : t('header.title')}
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
              {developerModeEnabled && (
                <button
                  type="button"
                  className={`settings-scope-toggle__button ${currentScope === 'developer' ? 'active' : ''}`}
                  onClick={() => setSettingsScope('developer')}
                >
                  <i className="bi bi-code-slash" aria-hidden="true"></i>
                  {t('scope.developer')}
                </button>
              )}
              {developerModeEnabled && (
                <button
                  type="button"
                  className={`settings-scope-toggle__button ${currentScope === 'services' ? 'active' : ''}`}
                  onClick={() => setSettingsScope('services')}
                >
                  <i className="bi bi-clock-history" aria-hidden="true"></i>
                  {t('scope.services')}
                </button>
              )}
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
            { key: 'users', label: t('auditTabs.users'), iconClassName: 'bi bi-person-plus' },
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
                <UserManagement embedded mfaEnabled={mfaEnabled} />
                <SecuritySettingsPanel mfaEnabled={mfaEnabled} numaGet={numaGet} numaPut={numaPut} />
              </Tab>
              {ssoEnabled && isAdmin && (
                <Tab
                  eventKey="sso"
                  title={
                    <span>
                      <i className="bi bi-shield-check me-2"></i>
                      {t('tabs.sso')}
                    </span>
                  }
                >
                  <SSOSettingsPanel numaGet={numaGet} numaPut={numaPut} numaPost={numaPost} numaDelete={numaDelete} />
                </Tab>
              )}
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
                                        dataConnectorsEnabled: true,
                                      }
                                    : {
                                        webSearchEnabled: false,
                                        dataAnalysisEnabled: false,
                                        createAgentEnabled: false,
                                        memoriesEnabled: false,
                                        dataConnectorsEnabled: false,
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

                          {dataConnectorsEnabled && (
                            <div className="mt-3 ms-4">
                              <div className="d-flex align-items-center gap-2">
                                <Form.Check
                                  type="switch"
                                  id="chat-defaults-data-connectors"
                                  label=""
                                  checked={
                                    globalChatSettings.autoToolsEnabled || globalChatSettings.dataConnectorsEnabled
                                  }
                                  disabled={globalChatSettings.autoToolsEnabled}
                                  onChange={(e) => {
                                    setGlobalChatSettings((prev) => ({
                                      ...prev,
                                      dataConnectorsEnabled: e.target.checked,
                                    }));
                                    setChatDefaultsDirty(true);
                                  }}
                                />
                                <div className="settings-secondary-label">{t('chatDefaults.dataConnectors')}</div>
                              </div>
                              <div className="text-muted small ms-5">{t('chatDefaults.dataConnectorsHelp')}</div>
                            </div>
                          )}
                        </div>

                        <div className="mb-3">
                          <div className="settings-section-title mb-1">{t('chatDefaults.approvalsTitle')}</div>
                          <div className="text-muted small mb-3">{t('chatDefaults.approvalsHelp')}</div>
                          <table className="table table-borderless approval-grid mb-0">
                            <thead>
                              <tr>
                                <th style={{ width: '28%' }}>{t('userProfile.approval.grid.toolType')}</th>
                                <th className="text-center">{t('userProfile.approval.modes.always.label')}</th>
                                <th className="text-center">{t('userProfile.approval.modes.non_destructive.label')}</th>
                                <th className="text-center">{t('userProfile.approval.modes.never.label')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td>
                                  <div className="fw-semibold">{t('userProfile.approval.grid.integrations')}</div>
                                  <div className="text-muted small">
                                    {t('userProfile.approval.grid.integrationsHelp')}
                                  </div>
                                </td>
                                {(['always', 'non_destructive', 'never'] as const).map((mode) => (
                                  <td key={mode} className="text-center align-middle">
                                    <Form.Check
                                      type="radio"
                                      id={`chat-defaults-approval-integrations-${mode}`}
                                      name="chatDefaultsApprovalMode"
                                      checked={globalChatSettings.approvalMode === mode}
                                      onChange={() => {
                                        setGlobalChatSettings((prev) => ({ ...prev, approvalMode: mode }));
                                        setChatDefaultsDirty(true);
                                      }}
                                      className="d-inline-block"
                                    />
                                  </td>
                                ))}
                              </tr>
                              <tr>
                                <td>
                                  <div className="fw-semibold">{t('userProfile.approval.grid.agents')}</div>
                                  <div className="text-muted small">{t('userProfile.approval.grid.agentsHelp')}</div>
                                </td>
                                {(['always', 'non_destructive', 'never'] as const).map((mode) => (
                                  <td key={mode} className="text-center align-middle">
                                    <Form.Check
                                      type="radio"
                                      id={`chat-defaults-approval-agents-${mode}`}
                                      name="chatDefaultsNumaToolApprovalMode.agents"
                                      checked={(globalChatSettings.numaToolApprovalMode?.agents ?? 'never') === mode}
                                      onChange={() => {
                                        setGlobalChatSettings((prev) => ({
                                          ...prev,
                                          numaToolApprovalMode: {
                                            ...(prev.numaToolApprovalMode ??
                                              DEFAULT_GLOBAL_CHAT_SETTINGS.numaToolApprovalMode),
                                            agents: mode,
                                          },
                                        }));
                                        setChatDefaultsDirty(true);
                                      }}
                                      className="d-inline-block"
                                    />
                                  </td>
                                ))}
                              </tr>
                              <tr>
                                <td>
                                  <div className="fw-semibold">{t('userProfile.approval.grid.memories')}</div>
                                  <div className="text-muted small">{t('userProfile.approval.grid.memoriesHelp')}</div>
                                </td>
                                {(['always', 'non_destructive', 'never'] as const).map((mode) => (
                                  <td key={mode} className="text-center align-middle">
                                    <Form.Check
                                      type="radio"
                                      id={`chat-defaults-approval-memories-${mode}`}
                                      name="chatDefaultsNumaToolApprovalMode.memories"
                                      checked={(globalChatSettings.numaToolApprovalMode?.memories ?? 'never') === mode}
                                      onChange={() => {
                                        setGlobalChatSettings((prev) => ({
                                          ...prev,
                                          numaToolApprovalMode: {
                                            ...(prev.numaToolApprovalMode ??
                                              DEFAULT_GLOBAL_CHAT_SETTINGS.numaToolApprovalMode),
                                            memories: mode,
                                          },
                                        }));
                                        setChatDefaultsDirty(true);
                                      }}
                                      className="d-inline-block"
                                    />
                                  </td>
                                ))}
                              </tr>
                              <tr>
                                <td>
                                  <div className="fw-semibold">{t('userProfile.approval.grid.knowledgeBases')}</div>
                                  <div className="text-muted small">
                                    {t('userProfile.approval.grid.knowledgeBasesHelp')}
                                  </div>
                                </td>
                                {(['always', 'non_destructive', 'never'] as const).map((mode) => (
                                  <td key={mode} className="text-center align-middle">
                                    <Form.Check
                                      type="radio"
                                      id={`chat-defaults-approval-kb-${mode}`}
                                      name="chatDefaultsNumaToolApprovalMode.knowledgeBases"
                                      checked={
                                        (globalChatSettings.numaToolApprovalMode?.knowledgeBases ?? 'never') === mode
                                      }
                                      onChange={() => {
                                        setGlobalChatSettings((prev) => ({
                                          ...prev,
                                          numaToolApprovalMode: {
                                            ...(prev.numaToolApprovalMode ??
                                              DEFAULT_GLOBAL_CHAT_SETTINGS.numaToolApprovalMode),
                                            knowledgeBases: mode,
                                          },
                                        }));
                                        setChatDefaultsDirty(true);
                                      }}
                                      className="d-inline-block"
                                    />
                                  </td>
                                ))}
                              </tr>
                              {hasOps && (
                                <tr>
                                  <td>
                                    <div className="fw-semibold">{t('userProfile.approval.grid.ops')}</div>
                                    <div className="text-muted small">{t('userProfile.approval.grid.opsHelp')}</div>
                                  </td>
                                  {(['always', 'non_destructive', 'never'] as const).map((mode) => (
                                    <td key={mode} className="text-center align-middle">
                                      <Form.Check
                                        type="radio"
                                        id={`chat-defaults-approval-ops-${mode}`}
                                        name="chatDefaultsNumaToolApprovalMode.ops"
                                        checked={(globalChatSettings.numaToolApprovalMode?.ops ?? 'never') === mode}
                                        onChange={() => {
                                          setGlobalChatSettings((prev) => ({
                                            ...prev,
                                            numaToolApprovalMode: {
                                              ...(prev.numaToolApprovalMode ??
                                                DEFAULT_GLOBAL_CHAT_SETTINGS.numaToolApprovalMode),
                                              ops: mode,
                                            },
                                          }));
                                          setChatDefaultsDirty(true);
                                        }}
                                        className="d-inline-block"
                                      />
                                    </td>
                                  ))}
                                </tr>
                              )}
                            </tbody>
                          </table>
                          <div className="text-muted small mt-2">
                            <strong>{t('userProfile.approval.modes.always.label')}:</strong>{' '}
                            {t('userProfile.approval.grid.alwaysHelp')}
                            <br />
                            <strong>{t('userProfile.approval.modes.non_destructive.label')}:</strong>{' '}
                            {t('userProfile.approval.grid.safeHelp')}
                            <br />
                            <strong>{t('userProfile.approval.modes.never.label')}:</strong>{' '}
                            {t('userProfile.approval.grid.neverHelp')}
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
                                    dataConnectorsEnabled: globalChatSettings.dataConnectorsEnabled,
                                    dataAnalysisEnabled: globalChatSettings.dataAnalysisEnabled,
                                    defaultConnectionIds: globalChatSettings.defaultConnectionIds,
                                    allowUserDefaults: globalChatSettings.allowUserDefaults,
                                    approvalMode: globalChatSettings.approvalMode,
                                    numaToolApprovalMode: globalChatSettings.numaToolApprovalMode,
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
                        {/* Section: Company Details */}
                        <div className="profile-section">
                          <div className="profile-section__title">{t('companyInfo.sections.details')}</div>
                          <p className="profile-section__description">{t('companyInfo.sections.detailsDescription')}</p>

                          <Form.Group className="mb-3">
                            <Form.Label className="profile-field-label">
                              {t('companyInfo.fields.companyName.label')}
                            </Form.Label>
                            <Form.Control
                              type="text"
                              maxLength={LIMIT_COMPANY_NAME}
                              value={companyProfile.companyName}
                              disabled={companyProfileSaving}
                              placeholder={t('companyInfo.fields.companyName.placeholder')}
                              onChange={(e) => setCompanyProfile((prev) => ({ ...prev, companyName: e.target.value }))}
                            />
                          </Form.Group>

                          <Form.Group className="mb-3">
                            <Form.Label className="profile-field-label">
                              {t('companyInfo.fields.industry.label')}
                            </Form.Label>
                            <Form.Control
                              type="text"
                              maxLength={LIMIT_INDUSTRY}
                              value={companyProfile.industry}
                              disabled={companyProfileSaving}
                              placeholder={t('companyInfo.fields.industry.placeholder')}
                              onChange={(e) => setCompanyProfile((prev) => ({ ...prev, industry: e.target.value }))}
                            />
                          </Form.Group>

                          <Form.Group className="mb-3">
                            <Form.Label className="profile-field-label">
                              {t('companyInfo.fields.country.label')}
                            </Form.Label>
                            <Form.Control
                              type="text"
                              maxLength={LIMIT_COUNTRY}
                              value={companyProfile.country}
                              disabled={companyProfileSaving}
                              placeholder={t('companyInfo.fields.country.placeholder')}
                              onChange={(e) => setCompanyProfile((prev) => ({ ...prev, country: e.target.value }))}
                            />
                          </Form.Group>
                        </div>

                        {/* Section: Company Information */}
                        <div className="profile-section">
                          <div className="profile-section__title">{t('companyInfo.sections.information')}</div>
                          <p className="profile-section__description">
                            {t('companyInfo.sections.informationDescription')}
                          </p>

                          <Form.Group className="mb-3">
                            <Form.Control
                              as="textarea"
                              rows={8}
                              maxLength={LIMIT_COMPANY_INFO}
                              value={companyProfile.companyInformation}
                              disabled={companyProfileSaving}
                              placeholder={t('companyInfo.fields.companyInformation.placeholder')}
                              onChange={(e) =>
                                setCompanyProfile((prev) => ({ ...prev, companyInformation: e.target.value }))
                              }
                            />
                            <CharCount value={companyProfile.companyInformation} max={LIMIT_COMPANY_INFO} />
                          </Form.Group>
                        </div>

                        {/* Section: Company-wide Best Practices */}
                        <div className="profile-section">
                          <div className="profile-section__title">{t('companyInfo.sections.bestPractices')}</div>
                          <p className="profile-section__description">
                            {t('companyInfo.sections.bestPracticesDescription')}
                          </p>

                          <Form.Group className="mb-3">
                            <Form.Control
                              as="textarea"
                              rows={6}
                              maxLength={LIMIT_BEST_PRACTICES}
                              value={companyProfile.bestPractices}
                              disabled={companyProfileSaving}
                              placeholder={t('companyInfo.fields.bestPractices.placeholder')}
                              onChange={(e) =>
                                setCompanyProfile((prev) => ({ ...prev, bestPractices: e.target.value }))
                              }
                            />
                            <CharCount value={companyProfile.bestPractices} max={LIMIT_BEST_PRACTICES} />
                          </Form.Group>
                        </div>

                        <Form.Text className="d-block mb-3 text-muted">{t('companyInfo.form.sharedNote')}</Form.Text>

                        {companyProfile.lastUpdated && (
                          <p className="text-muted small mb-3">
                            <i className="bi bi-clock me-1"></i>
                            {t('companyInfo.lastUpdated.label', {
                              date: new Date(companyProfile.lastUpdated).toLocaleString(i18n.language),
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
              {schedulingEnabled && (
                <Tab
                  eventKey="scheduling"
                  title={
                    <span>
                      <i className="bi bi-clock-history me-2"></i>
                      {t('tabs.scheduling')}
                    </span>
                  }
                >
                  <div className="mb-3">
                    <Alert variant="secondary" className="mb-3">
                      <div className="d-flex align-items-start">
                        <i className="bi bi-clock-history me-2 mt-1"></i>
                        <div>
                          <div className="settings-section-title">{t('schedulingSettings.title')}</div>
                          <div className="small text-muted">{t('schedulingSettings.description')}</div>
                        </div>
                      </div>
                    </Alert>
                    {schedulingMinLoading ? (
                      <div className="text-center py-4">
                        <Spinner animation="border" />
                      </div>
                    ) : (
                      <div>
                        {schedulingMinError && (
                          <Alert variant="danger" dismissible onClose={() => setSchedulingMinError(null)}>
                            {schedulingMinError}
                          </Alert>
                        )}
                        {schedulingMinSuccess && (
                          <Alert variant="success" dismissible onClose={() => setSchedulingMinSuccess(null)}>
                            {schedulingMinSuccess}
                          </Alert>
                        )}
                        <div className="mb-3 p-3 border rounded-3 bg-light">
                          <div className="small text-muted mb-1">
                            {t('schedulingSettings.arcanumFloor', {
                              minutes: schedulingArcanumFloor,
                            })}
                          </div>
                        </div>
                        <Form.Group className="mb-3">
                          <Form.Label>{t('schedulingSettings.minInterval.label')}</Form.Label>
                          <Form.Control
                            type="number"
                            min={schedulingArcanumFloor}
                            step={1}
                            value={schedulingMinInterval}
                            onChange={(e) => setSchedulingMinInterval(e.target.value)}
                            placeholder={t('schedulingSettings.minInterval.placeholder')}
                          />
                          <Form.Text className="text-muted">
                            {t('schedulingSettings.minInterval.helpText', {
                              floor: schedulingArcanumFloor,
                            })}
                          </Form.Text>
                        </Form.Group>
                        <div className="d-flex gap-2">
                          <Button
                            variant="primary"
                            disabled={schedulingMinSaving}
                            onClick={async () => {
                              setSchedulingMinError(null);
                              setSchedulingMinSuccess(null);
                              const parsed = schedulingMinInterval ? parseInt(schedulingMinInterval, 10) : null;
                              if (parsed !== null && (isNaN(parsed) || parsed < schedulingArcanumFloor)) {
                                setSchedulingMinError(
                                  t('schedulingSettings.validation.belowFloor', {
                                    floor: schedulingArcanumFloor,
                                  })
                                );
                                return;
                              }
                              try {
                                setSchedulingMinSaving(true);
                                await AdminSchedulingSettingsService.update(parsed, numaPut);
                                setSchedulingMinSuccess(t('schedulingSettings.saveSuccess'));
                              } catch (e) {
                                setSchedulingMinError((e as Error).message || t('schedulingSettings.saveFailed'));
                              } finally {
                                setSchedulingMinSaving(false);
                              }
                            }}
                          >
                            {schedulingMinSaving ? <Spinner animation="border" size="sm" className="me-2" /> : null}
                            {schedulingMinSaving ? t('actions.saving') : t('actions.saveChanges')}
                          </Button>
                          {schedulingMinInterval && (
                            <Button variant="outline-secondary" onClick={() => setSchedulingMinInterval('')}>
                              {t('schedulingSettings.clearButton')}
                            </Button>
                          )}
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
              {isAdmin && usageReportingEnabled && (
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
              {isAdmin && disasterRecoveryEnabled && (
                <Tab
                  eventKey="disaster-recovery"
                  title={
                    <span>
                      <i className="bi bi-shield-check me-2"></i>
                      {t('tabs.disasterRecovery')}
                    </span>
                  }
                >
                  <DisasterRecoveryTab />
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
                {auditSubKey === 'sync' && <GenericAuditLogTab logType="sync" />}
                {auditSubKey === 'recovery' && <GenericAuditLogTab logType="recovery" />}
              </>
            )}

            {auditTabKey === 'users' && <UserManagementAuditTab />}
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
