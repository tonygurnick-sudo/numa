import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Tab, Button, Spinner, Modal, Alert, OverlayTrigger, Tooltip, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import UserManagement from './UserManagement';
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
import { AdminAgentsService, type AgentsMode } from '../Services/AdminAgentsService';
import { AdminMfaSettingsService } from '../Services/AdminMfaSettingsService';
import { getIntegrationsListFormat, type IntegrationListItem } from '../config/integrationsConfig';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import BrandingAdminPanel from '../Components/Branding/BrandingAdminPanel';
import { UNSAFE_NavigationContext } from 'react-router-dom';
import {
  AdminChatSettingsService,
  type GlobalChatSettings,
  DEFAULT_GLOBAL_CHAT_SETTINGS,
} from '../Services/AdminChatSettingsService';
import ExpandableOverflowBox from '../Components/ExpandableOverflowBox';
import { SynergyIcon } from '../Components/DataConnectors/SynergyConnectorCard';
import { fetchCompanyInfo, saveCompanyInfo, getProfileText } from '../utils/companyInfoUtils';
import { manifestService } from '../Services/manifestService';

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
  const { t, i18n } = useTranslation('settings');
  const { user, getCredentials, lambdaClient } = useAuth();
  const { numaGet, numaPut } = useNumaRequest();
  const [activeKey, setActiveKey] = useState<string>('users');
  const [settingsScope, setSettingsScope] = useState<'user' | 'admin'>('user');
  const brandingFlag =
    typeof window !== 'undefined' ? window.sessionStorage.getItem('BRANDING_PROVIDER_ENABLED') : null;
  const brandingApiEnabled = brandingFlag === 'true';
  const isAdmin = Boolean(user?.groups?.includes('admin'));
  const currentScope: 'user' | 'admin' = isAdmin ? settingsScope : 'user';
  const allowBrandingTab = brandingApiEnabled && isAdmin;
  const agentsFeatureEnabled =
    typeof window !== 'undefined' ? window.sessionStorage.getItem('AGENTS') === 'true' : false;
  const mfaEnabled = typeof window !== 'undefined' ? window.sessionStorage.getItem('MFA_ENABLED') === 'true' : false;
  const dataConnectorsEnabled =
    typeof window !== 'undefined' ? window.sessionStorage.getItem('DATA_CONNECTORS_ENABLED') === 'true' : false;
  const availableIntegrations = useMemo<IntegrationListItem[]>(() => getIntegrationsListFormat(), [i18n.language]);

  useEffect(() => {
    if (!isAdmin) {
      setSettingsScope('user');
    }
  }, [isAdmin]);

  // Global (admin) settings — SWR: initialize from cache for instant render
  const [globalSettings, setGlobalSettings] = useState<GlobalIntegrationSettingsMap>(
    () => AdminIntegrationsService.getCached() ?? {},
  );
  const [dataConnectorSettings, setDataConnectorSettings] = useState<GlobalDataConnectorSettingsMap>({});
  const [loadingSettings, setLoadingSettings] = useState<boolean>(() => !AdminIntegrationsService.getCached());
  const [error, setError] = useState<string | null>(null);

  // Agents (admin) settings
  const [agentsMode, setAgentsMode] = useState<AgentsMode>('full');
  const [agentsLoading, setAgentsLoading] = useState<boolean>(true);
  const [agentsSaving, setAgentsSaving] = useState<boolean>(false);

  // MFA (admin) settings — stored as hours, displayed in a user-chosen unit.
  // mfaInputValue is a string so the input can be empty while typing.
  const [mfaRememberHours, setMfaRememberHours] = useState<number>(0);
  const [mfaInputValue, setMfaInputValue] = useState<string>('0');
  const [mfaUnit, setMfaUnit] = useState<'hours' | 'days'>('days');
  const [mfaLoading, setMfaLoading] = useState<boolean>(true);
  const [mfaSaving, setMfaSaving] = useState<boolean>(false);
  const [mfaSaveStatus, setMfaSaveStatus] = useState<{ variant: string; message: string } | null>(null);
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
  const hasPipedreamFeature = window.sessionStorage.getItem('PIPEDREAM_INTEGRATIONS') === 'true';
  const relayLambdaArn = window.sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN');
  const previewMode = !hasPipedreamFeature || !relayLambdaArn;
  const workspaceChatEnabled = window.sessionStorage.getItem('NUMA_WORKSPACE_CHAT') === 'true';

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

  const loadDataConnectorSettings = async () => {
    try {
      if (!isAdmin) {
        setDataConnectorSettings({ synergy: { status: 'disabled' } });
        return;
      }
      if (!dataConnectorsEnabled) {
        setDataConnectorSettings({ synergy: { status: 'disabled' } });
        return;
      }
      if (!user) return;
      const data = await AdminDataConnectorsService.listWithNuma(numaGet);
      setDataConnectorSettings(data);
    } catch (e) {
      console.warn('Settings: failed to load data connector settings', e);
      setDataConnectorSettings({ synergy: { status: 'disabled' } });
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
    loadDataConnectorSettings();
  }, [isAdmin, user, numaGet, dataConnectorsEnabled]);

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

  // Load MFA settings
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isAdmin || !mfaEnabled) {
        if (!cancelled) setMfaLoading(false);
        return;
      }
      try {
        setMfaLoading(true);
        const res = await AdminMfaSettingsService.get(numaGet);
        if (!cancelled) {
          const hours = res.rememberDurationHours;
          setMfaRememberHours(hours);
          // Default to days if evenly divisible, otherwise hours
          const unit = hours > 0 && hours % 24 === 0 ? 'days' : 'hours';
          setMfaUnit(unit);
          setMfaInputValue(String(unit === 'days' ? Math.floor(hours / 24) : hours));
        }
      } catch (e) {
        console.warn('Settings: failed to load MFA settings', e);
        if (!cancelled) setMfaRememberHours(0);
      } finally {
        if (!cancelled) setMfaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, mfaEnabled, user, numaGet]);

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
  const [integrationsTabKey, setIntegrationsTabKey] = useState<'connected-apps' | 'data-connectors'>('connected-apps');
  const [userSettingsTabKey, setUserSettingsTabKey] = useState<string>('my-profile');

  useEffect(() => {
    if (!dataConnectorsEnabled && integrationsTabKey === 'data-connectors') {
      setIntegrationsTabKey('connected-apps');
    }
  }, [dataConnectorsEnabled, integrationsTabKey]);

  useEffect(() => {
    if (!workspaceChatEnabled && userSettingsTabKey === 'approval-settings') {
      setUserSettingsTabKey('user-settings');
    }
  }, [workspaceChatEnabled, userSettingsTabKey]);
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
    t('navigation.unsavedChatDefaults'),
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
        numaPut,
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
        numaPut,
      );
      await loadGlobal();
    } catch (e) {
      setError((e as Error).message || t('errors.updateIntegration'));
    }
  };

  const toggleDataConnector = async (connectorId: string, nextEnabled: boolean) => {
    try {
      if (!nextEnabled && dataConnectorSettings[connectorId]?.status === 'enabled') {
        const ok = window.confirm(t('confirm.disableDataConnector', { connectorId }));
        if (!ok) return;
      }
      await AdminDataConnectorsService.updateWithNuma(
        connectorId,
        {
          status: nextEnabled ? 'enabled' : 'disabled',
        },
        numaPut,
      );
      await loadDataConnectorSettings();
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

  const renderDataConnectorRow = (connector: { id: string; name: string; description: string }) => {
    const enabled = dataConnectorSettings[connector.id]?.status === 'enabled';

    return (
      <div
        key={connector.id}
        className="border rounded-3 p-3 mb-2 bg-white"
        style={{
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          transition: 'all 0.2s ease',
          opacity: enabled ? 1 : 0.75,
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
              <SynergyIcon />
            </div>
            <div>
              <div className="fw-semibold settings-item-title">{connector.name}</div>
              <div className="text-muted small settings-item-description">{connector.description}</div>
            </div>
          </div>
          <div className="col-md-6 d-flex justify-content-end gap-2 align-items-center">
            <Form.Check
              type="switch"
              id={`toggle-${connector.id}`}
              checked={enabled}
              onChange={() => toggleDataConnector(connector.id, !enabled)}
              label={
                <span className="small">
                  {enabled ? t('integrations.status.enabled') : t('integrations.status.disabled')}
                </span>
              }
            />
          </div>
        </div>
      </div>
    );
  };

  const dataConnectors = [
    {
      id: 'synergy',
      name: t('dataConnectors.synergyName'),
      description: t('dataConnectors.synergyDescription'),
    },
  ];
  const adminTabs = useMemo(
    () => [
      { key: 'users', label: t('tabs.users'), iconClassName: 'bi bi-people' },
      ...(allowBrandingTab ? [{ key: 'branding', label: t('tabs.branding'), iconClassName: 'bi bi-palette' }] : []),
      { key: 'chat-defaults', label: t('tabs.chatDefaults'), iconClassName: 'bi bi-chat-dots' },
      { key: 'company-profile', label: t('tabs.companyProfile'), iconClassName: 'bi bi-building' },
      ...(agentsFeatureEnabled ? [{ key: 'agents', label: t('tabs.agents'), iconClassName: 'bi bi-robot' }] : []),
      ...(mfaEnabled ? [{ key: 'mfa', label: t('tabs.mfa'), iconClassName: 'bi bi-shield-lock' }] : []),
      { key: 'integrations', label: t('tabs.integrations'), iconClassName: 'bi bi-plug' },
    ],
    [allowBrandingTab, agentsFeatureEnabled, mfaEnabled, t],
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
    [workspaceChatEnabled, mfaEnabled, t]
  );

  return (
    <div className="dashboard settings-page">
      <PageHeader
        title={t('header.title')}
        subtitle={currentScope === 'admin' ? t('header.adminSubtitle') : t('header.userSubtitle')}
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

      <div className="app-content settings-app-content">
        <div hidden={currentScope !== 'user'} aria-hidden={currentScope !== 'user'}>
          <UserProfilePage
            embedded
            activeTabKey={userSettingsTabKey}
            onActiveTabChange={setUserSettingsTabKey}
            settingsScope={currentScope}
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
                                  defaultKBIds: nextChecked ? ['company'] : [],
                                }));
                                setChatDefaultsDirty(true);
                              }}
                            />
                            <div className="settings-secondary-label">{t('chatDefaults.companyKnowledgeBase')}</div>
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
                                  numaPut,
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
              {mfaEnabled && (
                <Tab
                  eventKey="mfa"
                  title={
                    <span>
                      <i className="bi bi-shield-lock me-2"></i>
                      {t('tabs.mfa')}
                    </span>
                  }
                >
                  <div className="mb-3">
                    <Alert variant="secondary" className="mb-3">
                      <div className="d-flex align-items-start">
                        <i className="bi bi-phone me-2 mt-1"></i>
                        <div>
                          <div className="settings-section-title">{t('mfaSettings.title')}</div>
                          <div className="small text-muted">{t('mfaSettings.description')}</div>
                        </div>
                      </div>
                    </Alert>
                    {mfaLoading ? (
                      <div className="text-center py-4">
                        <Spinner animation="border" />
                      </div>
                    ) : (
                      <Form>
                        <Form.Group className="mb-3">
                          <Form.Label className="fw-semibold">{t('mfaSettings.durationLabel')}</Form.Label>
                          <div className="d-flex align-items-center gap-2" style={{ maxWidth: 340 }}>
                            <Form.Control
                              type="number"
                              min={0}
                              max={mfaUnit === 'days' ? 365 : 8760}
                              value={mfaInputValue}
                              onChange={(e) => {
                                const str = e.target.value;
                                setMfaInputValue(str);
                                const parsed = parseInt(str, 10);
                                if (!isNaN(parsed) && parsed >= 0) {
                                  const maxVal = mfaUnit === 'days' ? 365 : 8760;
                                  const clamped = Math.min(maxVal, parsed);
                                  setMfaRememberHours(mfaUnit === 'days' ? clamped * 24 : clamped);
                                } else {
                                  setMfaRememberHours(0);
                                }
                              }}
                              onBlur={() => {
                                if (mfaInputValue === '') setMfaInputValue('0');
                              }}
                              style={{ maxWidth: 120 }}
                            />
                            <Form.Select
                              value={mfaUnit}
                              onChange={(e) => {
                                const newUnit = e.target.value as 'hours' | 'days';
                                setMfaUnit(newUnit);
                                // Convert the display value when switching units
                                const display =
                                  newUnit === 'days' ? Math.floor(mfaRememberHours / 24) : mfaRememberHours;
                                setMfaInputValue(String(display));
                              }}
                              style={{ maxWidth: 120 }}
                            >
                              <option value="hours">{t('mfaSettings.unitHours')}</option>
                              <option value="days">{t('mfaSettings.unitDays')}</option>
                            </Form.Select>
                          </div>
                          <Form.Text className="text-muted">{t('mfaSettings.durationHelp')}</Form.Text>
                        </Form.Group>

                        {mfaRememberHours === 0 && (
                          <Alert variant="info" className="mb-3">
                            <i className="bi bi-info-circle me-2"></i>
                            {t('mfaSettings.zeroMeansAlways')}
                          </Alert>
                        )}

                        {mfaSaveStatus && (
                          <Alert
                            variant={mfaSaveStatus.variant}
                            className="mb-3"
                            dismissible
                            onClose={() => setMfaSaveStatus(null)}
                          >
                            {mfaSaveStatus.message}
                          </Alert>
                        )}

                        <Button
                          variant="primary"
                          disabled={mfaSaving}
                          onClick={async () => {
                            try {
                              setMfaSaving(true);
                              setMfaSaveStatus(null);
                              await AdminMfaSettingsService.update(mfaRememberHours, numaPut);
                              setMfaSaveStatus({ variant: 'success', message: t('mfaSettings.saveSuccess') });
                            } catch (e) {
                              setMfaSaveStatus({
                                variant: 'danger',
                                message: (e as Error).message || t('errors:adminMfa.updateFailed'),
                              });
                            } finally {
                              setMfaSaving(false);
                            }
                          }}
                        >
                          {mfaSaving ? (
                            <>
                              <Spinner as="span" animation="border" size="sm" className="me-2" />
                              {t('common:saving')}
                            </>
                          ) : (
                            t('common:save')
                          )}
                        </Button>
                      </Form>
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
                <StyledTabs
                  activeKey={integrationsTabKey}
                  onSelect={(key) => setIntegrationsTabKey((key as typeof integrationsTabKey) || 'connected-apps')}
                  className="mb-3 settings-subtabs--nested"
                >
                  <Tab eventKey="connected-apps" title={t('tabs.connectedApps')}>
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
                        {[...availableIntegrations]
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map(renderIntegrationRow)}
                      </div>
                    )}
                  </Tab>
                  {dataConnectorsEnabled && (
                    <Tab eventKey="data-connectors" title={t('tabs.dataConnectors')}>
                      <Alert variant="secondary" className="mb-3">
                        <div className="d-flex align-items-start">
                          <i className="bi bi-building-gear me-2 mt-1"></i>
                          <div>
                            <div className="settings-section-title">{t('dataConnectors.companySettingsTitle')}</div>
                            <div className="small text-muted">{t('dataConnectors.companySettingsDescription')}</div>
                          </div>
                        </div>
                      </Alert>
                      <div className="mt-3">{dataConnectors.map(renderDataConnectorRow)}</div>
                    </Tab>
                  )}
                </StyledTabs>
              </Tab>
            </StyledTabs>
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
