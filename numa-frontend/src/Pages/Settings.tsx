import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getFlag } from '../utils/featureFlags';
import { Tab, Button, Spinner, Modal, Alert, OverlayTrigger, Tooltip, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import UserManagement from './UserManagement';
import { SecuritySettingsPanel, ConnectorAccessPanel } from '../Components/UserManagement';
import UserProfilePage from './UserProfile';
import { PageHeader } from '../Components/PageHeader';
import { SubHeaderTabBar } from '../Components/SubHeaderTabBar';
import { StyledTabs } from '../Components/StyledTabs';
import { useAuth } from '../Providers/AuthProvider';
import {
  AdminIntegrationsService,
  type GlobalIntegrationSettingsMap,
  type CatalogEntry,
  type IntegrationMethod,
} from '../Services/AdminIntegrationsService';
import { AddIntegrationModal, type AddIntegrationMethod } from '../Components/Integrations/AddIntegrationModal';
import {
  resolveServiceIcon,
  connectorSlugForPipedream,
  pipedreamSlugForConnector,
  type IntegrationPickerEntry,
} from '../Components/Integrations/integrationCatalogHelpers';
import { MethodBadge } from '../Components/Integrations/MethodBadge';
import { NativeConfigurationModal } from '../Components/Integrations/NativeConfigurationModal';
import { GmailTriggerSetupWizard } from '../Components/DataConnectors/wizards/GmailTriggerSetupWizard';
import { VaultUserSecretsPanel } from '../Components/Vault/VaultUserSecretsPanel';
import { VaultCompanySecretsPanel } from '../Components/Vault/VaultCompanySecretsPanel';
import { ManageMethodCard } from '../Components/Integrations/ManageMethodCard';
import { UserChoiceCard } from '../Components/Integrations/UserChoiceCard';
import { SynergyPatBadge } from '../Components/DataConnectors/SynergyPatBadge';
import {
  getConnectionDisplayName,
  getConnectionDescription,
  getConnectionIcon,
  getConnectionFallbackIcon,
} from '../config/integrationsConfig';
import { getConnectorById } from '../Components/DataConnectors/connectorRegistry';
import { AdminDataConnectorsService, type DataConnectorAdminSettings } from '../Services/AdminDataConnectorsService';
import { ConnectorsService } from '../Services/ConnectorsService';
import { DisasterRecoveryTab } from '../Components/DisasterRecovery/DisasterRecoveryTab';
import { CapabilitiesService, type CapabilitySettingsMap } from '../Services/CapabilitiesService';
import { AdminAgentsService, type AgentsMode } from '../Services/AdminAgentsService';
import { ScheduleQuotaAdminForm } from '../Components/Scheduling/ScheduleQuotaAdminForm';
import { ScheduleAuditPanel } from '../Components/Scheduling/ScheduleAuditPanel';
import { getIntegrationsListFormat, type IntegrationListItem } from '../config/integrationsConfig';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useAlert, useConfirm } from '../Providers/ConfirmContext';
import BrandingAdminPanel from '../Components/Branding/BrandingAdminPanel';
import LoginHeatmap from '../Components/UsageAnalytics/LoginHeatmap';
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
import type { CapabilityItem, CapabilityGroup } from '../utils/capabilityRegistry';
import { getFlagRegistry } from '../utils/featureFlags';
import SSOSettingsPanel from '../Components/Settings/SSOSettingsPanel';
import { VoiceAdminPanel } from '../Components/Voice/VoiceAdminPanel';
import { CreditsDashboardPanel } from '../Components/Settings/CreditsDashboard/CreditsDashboardPanel';
import { loadAdminCapabilityGating, DEFAULT_DISABLED_FLAGS } from '../utils/adminCapabilityGating';
import { CHAT_SUGGESTIONS_DISABLED } from '../hooks/useChatSuggestions';
// Mobile-only Settings tweaks (Tool Approvals matrix reflow + Ask Numa FAB
// clearance). Every rule is gated to <=768px; desktop is unchanged.
import './Settings.scss';

// Capability flags hidden by a code-level kill switch. When the corresponding
// kill switch is engaged, the capability is removed from the admin Capabilities
// list so we don't show a toggle that wouldn't actually do anything.
const KILLED_CAPABILITY_FLAGS = new Set<string>([...(CHAT_SUGGESTIONS_DISABLED ? ['CHAT_SUGGESTIONS'] : [])]);

const useNavigationConfirm = (when: boolean, message: string) => {
  const navigationContext = useContext(UNSAFE_NavigationContext);
  const confirm = useConfirm();
  const { t: tCommon } = useTranslation('common');

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
      confirm({ message, confirmLabel: tCommon('confirm.leave'), variant: 'warning' }).then((ok) => {
        if (ok) {
          unblock();
          tx.retry();
        }
      });
    });

    return () => {
      unblock();
    };
  }, [navigationContext, when, message, confirm, tCommon]);
};

export default function SettingsPage() {
  const { t, i18n } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const { user, getCredentials, lambdaClient } = useAuth();
  const { numaGet, numaPut, numaPost, numaDelete } = useNumaRequest();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const { scope: urlScope, tab: urlTab } = useParams<{ scope?: string; tab?: string }>();
  const navigate = useNavigate();
  // The legacy `data-connectors` tab is now folded into the `integrations`
  // tab — preserve any deep links by mapping the old key on initial mount.
  const [activeKey, setActiveKey] = useState<string>(urlTab === 'data-connectors' ? 'integrations' : urlTab || 'users');
  const validScopes = ['user', 'admin'] as const;
  type SettingsScope = (typeof validScopes)[number];
  const [settingsScope, setSettingsScope] = useState<SettingsScope>(
    validScopes.includes(urlScope as SettingsScope) ? (urlScope as SettingsScope) : 'user'
  );

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
  // FEAT-129 — Connector Access Review admin panel (Settings → Users). Off by
  // default; emitted explicitly from numa-client-stack so getFlag doesn't
  // default-true on older deployments.
  const connectorAccessReviewEnabled = getFlag('CONNECTOR_ACCESS_REVIEW');
  const hasOps = getFlag('NUMA_OPS');
  const ssoEnabled = getFlag('SSO_ENABLED');
  const voiceEnabled = getFlag('NUMA_VOICE');
  // Credits admin view (Numa Credit System / SPK-015). Gated by the SHOW_CREDITS flag, which is
  // emitted explicitly (default false) from numa-client-stack. Metering runs for all clients
  // regardless; this only controls whether the in-app Credits view is visible.
  const creditsEnabled = getFlag('SHOW_CREDITS');
  // Hidden by default — only shown when explicitly set to true in numa-client-config
  const usageReportingEnabled = window.sessionStorage.getItem('DEPLOY_USAGE_REPORTING') === 'true';
  const disasterRecoveryEnabled = getFlag('DISASTER_RECOVERY');
  const availableIntegrations = useMemo<IntegrationListItem[]>(() => getIntegrationsListFormat(), [i18n.language]);

  useEffect(() => {
    if (!isAdmin && settingsScope !== 'user') {
      setSettingsScope('user');
    }
  }, [isAdmin, settingsScope]);

  // Global (admin) settings — SWR: initialize from cache for instant render
  const [globalSettings, setGlobalSettings] = useState<GlobalIntegrationSettingsMap>(
    () => AdminIntegrationsService.getCached() ?? {}
  );
  const [capabilitySettings, setCapabilitySettings] = useState<CapabilitySettingsMap>({});
  const [dataConnectorAdmin, setDataConnectorAdmin] = useState<DataConnectorAdminSettings>({
    settings: {},
    apiDocsAvailableSlugs: new Set(),
  });
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);
  const [loadingSettings, setLoadingSettings] = useState<boolean>(() => !AdminIntegrationsService.getCached());
  const [error, setError] = useState<string | null>(null);
  // Holds the pipedreamSlug currently being saved by the multi-account toggle,
  // so the switch can disable + show a busy state without leaking into other
  // rows. Null when no save is in flight.
  const [savingMultiAccount, setSavingMultiAccount] = useState<string | null>(null);

  // Agents (admin) settings
  const [agentsMode, setAgentsMode] = useState<AgentsMode>('full');
  const [agentsLoading, setAgentsLoading] = useState<boolean>(true);
  const [agentsSaving, setAgentsSaving] = useState<boolean>(false);

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

  const [integrationsCatalog, setIntegrationsCatalog] = useState<CatalogEntry[]>(
    () => AdminIntegrationsService.getCachedCatalog() ?? []
  );
  // Native connectors with admin-configured credentials in vault (OAuth client
  // secrets or PAT entries). Backwards compat: pre-this-PR, native setups
  // never wrote to the data-connector-settings table — vault was the source
  // of truth. We pull this list separately and merge it with the catalog so
  // existing setups still appear in the unified Integrations list.
  const [configuredNativeSlugs, setConfiguredNativeSlugs] = useState<Set<string>>(new Set());

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
      // Catalog drives the per-service method picker; non-fatal on failure.
      AdminIntegrationsService.catalogWithNuma(numaGet)
        .then(setIntegrationsCatalog)
        .catch(() => undefined);
      // Vault-side configured native connectors. Used to surface existing
      // setups that pre-date the data-connector-settings flag convention.
      ConnectorsService.listConfigured()
        .then(({ oauth, pat }) => {
          setConfiguredNativeSlugs(new Set([...oauth.map((c) => c.id), ...pat.map((c) => c.id)]));
        })
        .catch(() => undefined);
      setError(null);
    } catch (e) {
      setError((e as Error).message || t('errors.loadSettings'));
    } finally {
      setLoadingSettings(false);
    }
  };

  /** Optimistically update both the catalog and globalSettings for a single
   *  Pipedream slug — used so method-switching feels instantaneous in the
   *  Manage modal while the API call runs in the background. */
  const optimisticPreferredMethod = useCallback((pipedreamSlug: string, nextMethod: IntegrationMethod | null) => {
    setGlobalSettings((prev) => ({
      ...prev,
      [pipedreamSlug]: {
        status: prev[pipedreamSlug]?.status ?? 'disabled',
        denyTools: prev[pipedreamSlug]?.denyTools ?? [],
        preferred_method: nextMethod,
        allowMultipleAccounts: prev[pipedreamSlug]?.allowMultipleAccounts ?? false,
      },
    }));
    setIntegrationsCatalog((prev) =>
      prev.map((e) => (e.pipedreamSlug === pipedreamSlug ? { ...e, preferred_method: nextMethod } : e))
    );
  }, []);

  const setPreferredMethod = async (integrationId: string, nextMethod: IntegrationMethod | null) => {
    optimisticPreferredMethod(integrationId, nextMethod);
    try {
      const current = globalSettings[integrationId];
      await AdminIntegrationsService.updateWithNuma(
        integrationId,
        {
          status: current?.status ?? 'disabled',
          denyTools: current?.denyTools ?? [],
          preferred_method: nextMethod,
        },
        numaPut
      );
      // Re-sync from server so any divergence (e.g. concurrent admin edit)
      // gets reconciled. Optimistic update + server reconcile = instant UI
      // with eventual consistency.
      await loadGlobal();
    } catch (e) {
      // Rollback by re-fetching the truth.
      await loadGlobal();
      setError((e as Error).message || t('errors.updateIntegration'));
    }
  };

  // Lazy-add admin UX: only services the admin has explicitly added show up
  // in the unified Integrations list. "Added" means at least one method
  // (Pipedream-enable in global-integration-settings, or native enable in
  // data-connector-settings) is on. Adding flips the relevant flag; removing
  // turns both off.
  const [addModalOpen, setAddModalOpen] = useState(false);
  // Connector currently being configured for native OAuth/PAT credentials.
  const [configuringConnector, setConfiguringConnector] = useState<string | null>(null);
  // Why the configurator is open. 'reconfigure' keeps the current preferred
  // method untouched (admin is just updating credentials); 'add' / 'switch'
  // signal that admin wants native to become the active method post-save.
  const [configuringIntent, setConfiguringIntent] = useState<'add' | 'switch' | 'reconfigure' | 'user_choice'>('add');
  // Slugs being removed — kept locally so the row disappears instantly while
  // the API call is in flight (rolled back on error).
  const [removingSlugs, setRemovingSlugs] = useState<Set<string>>(new Set());

  /** Pipedream-slug -> connector-slug map, for icon resolution and add routing. */
  const pipedreamForConnector = useMemo(() => {
    const map: Record<string, string> = {};
    for (const entry of integrationsCatalog) {
      if (entry.pipedreamSlug && entry.connectorSlug) {
        map[entry.connectorSlug] = entry.pipedreamSlug;
      }
    }
    return map;
  }, [integrationsCatalog]);

  /**
   * Native counterpart is "available" when admin has either:
   *   - explicitly enabled it via the new data-connector-settings flag, or
   *   - configured credentials in vault (the legacy pre-PR setup convention),
   * AND has NOT explicitly disabled it via the data-connector-settings flag.
   *
   * This keeps existing native setups visible in the unified list while still
   * letting the trash icon hide a service.
   */
  const isNativeAvailable = useCallback(
    (connectorSlug: string | null | undefined, catalogConnectorEnabled: boolean | null) => {
      if (!connectorSlug) return false;
      if (dataConnectorAdmin.settings[connectorSlug]?.status === 'disabled') return false;
      return Boolean(catalogConnectorEnabled) || configuredNativeSlugs.has(connectorSlug);
    },
    [dataConnectorAdmin, configuredNativeSlugs]
  );

  /** Services that are currently CONNECTED for this workspace. A service
   *  appears in the admin tab when it's actively enabled on either side:
   *    - Pipedream row with `status='enabled'`, OR
   *    - data-connector-settings row with `status='enabled'`, OR
   *    - (legacy back-compat) vault has a per-service credential for
   *      this native connector that pre-dates the flag-row convention
   *
   *  No more "added but disabled" intermediate state in the admin tab —
   *  if you want to turn an integration off, click Remove (trash) and
   *  re-add via the picker when you want it back. This eliminates the
   *  confusion of rows piling up across testing sessions, and matches
   *  what admins actually want to see: "what's live right now."
   */
  const addedServices = useMemo(() => {
    return integrationsCatalog
      .filter((entry) => {
        if (removingSlugs.has(entry.slug)) return false;
        const pdEnabled = entry.pipedreamSlug && globalSettings[entry.pipedreamSlug]?.status === 'enabled';
        const cnEnabled = entry.connectorSlug && dataConnectorAdmin.settings[entry.connectorSlug]?.status === 'enabled';
        const legacyVaultPresent = Boolean(
          entry.connectorSlug &&
          !dataConnectorAdmin.settings[entry.connectorSlug] &&
          configuredNativeSlugs.has(entry.connectorSlug)
        );
        return pdEnabled || cnEnabled || legacyVaultPresent;
      })
      .map((entry) => {
        const name = entry.pipedreamSlug
          ? getConnectionDisplayName(entry.pipedreamSlug)
          : (getConnectorById(entry.connectorSlug ?? '')?.displayName ?? entry.slug);
        const description = entry.pipedreamSlug
          ? getConnectionDescription(entry.pipedreamSlug)
          : (getConnectorById(entry.connectorSlug ?? '')?.description ?? '');
        return {
          ...entry,
          name,
          description,
          icon: resolveServiceIcon(entry.pipedreamSlug, entry.connectorSlug),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [integrationsCatalog, removingSlugs, globalSettings, dataConnectorAdmin, configuredNativeSlugs]);

  const addedKeys = useMemo(
    () => new Set(addedServices.flatMap((s) => [s.pipedreamSlug, s.connectorSlug].filter(Boolean) as string[])),
    [addedServices]
  );

  const handleAddService = useCallback(
    async (entry: IntegrationPickerEntry, method: AddIntegrationMethod) => {
      try {
        if (method === 'pipedream' && entry.pipedreamSlug) {
          // One-click: enable Pipedream side. Method preference is set so the
          // user-facing page doesn't bounce between options.
          const current = globalSettings[entry.pipedreamSlug];
          await AdminIntegrationsService.updateWithNuma(
            entry.pipedreamSlug,
            {
              status: 'enabled',
              denyTools: current?.denyTools ?? [],
              preferred_method: 'pipedream',
            },
            numaPut
          );
          setAddModalOpen(false);
          await loadGlobal();
        } else if (method === 'native' && entry.connectorSlug) {
          // Native: launch the OAuth/PAT wizard. Once credentials are saved,
          // handleConfiguredNative flips the enabled flag in the connector
          // settings table so the row appears.
          setAddModalOpen(false);
          setConfiguringIntent('add');
          setConfiguringConnector(entry.connectorSlug);
        } else if (method === 'user_choice' && entry.pipedreamSlug && entry.connectorSlug) {
          // Dual setup: enable Pipedream immediately with preferred_method=null,
          // then launch the native wizard. handleConfiguredNative will see
          // intent='user_choice' and leave preferred_method untouched, so once
          // both sides are configured the service ends up in user-choice mode.
          const current = globalSettings[entry.pipedreamSlug];
          await AdminIntegrationsService.updateWithNuma(
            entry.pipedreamSlug,
            {
              status: 'enabled',
              denyTools: current?.denyTools ?? [],
              preferred_method: null,
            },
            numaPut
          );
          setAddModalOpen(false);
          setConfiguringIntent('user_choice');
          setConfiguringConnector(entry.connectorSlug);
        }
      } catch (e) {
        setError((e as Error).message || t('errors.updateIntegration'));
      }
    },
    [globalSettings, numaPut, t]
  );

  const handleRemoveService = useCallback(
    async (entry: CatalogEntry) => {
      const name = entry.pipedreamSlug
        ? getConnectionDisplayName(entry.pipedreamSlug)
        : (entry.connectorSlug ?? entry.slug);
      const ok = await confirm({
        message: t('integrations.confirmRemove', {
          defaultValue: 'Remove {{name}} from this workspace?',
          name,
        }),
        confirmLabel: tCommon('confirm.remove', { defaultValue: 'Remove' }),
        variant: 'danger',
      });
      if (!ok) return;

      // Optimistic: drop the row immediately so admins get instant feedback.
      // Restore on failure.
      setRemovingSlugs((prev) => new Set(prev).add(entry.slug));

      try {
        const tasks: Promise<unknown>[] = [];
        if (entry.pipedreamSlug) {
          const current = globalSettings[entry.pipedreamSlug];
          tasks.push(
            AdminIntegrationsService.updateWithNuma(
              entry.pipedreamSlug,
              {
                status: 'disabled',
                denyTools: current?.denyTools ?? [],
                preferred_method: current?.preferred_method ?? null,
              },
              numaPut
            )
          );
        }
        if (entry.connectorSlug) {
          tasks.push(AdminDataConnectorsService.updateWithNuma(entry.connectorSlug, { status: 'disabled' }, numaPut));
          // Disabling the data-connector-settings row alone isn't enough: the
          // catalog falls back to vault-side proof (configuredNativeSlugs)
          // when the registry doesn't carry an explicit flag, so we also need
          // to nuke the stored credential. Best-effort — if there is no
          // credential to remove, ConnectorsService.disconnect is a no-op.
          tasks.push(ConnectorsService.disconnect(entry.connectorSlug).catch(() => undefined));
        }
        await Promise.all(tasks);
        // Refresh every source of truth that feeds the catalog row:
        //   - globalSettings + catalog (Pipedream + preferred_method)
        //   - dataConnectorSettings (native admin-side flag)
        //   - configuredNativeSlugs (vault-side proof; survives flag flips)
        // Without all four, isNativeAvailable can re-surface the row on the
        // next render — see FEAT-143 review for the resurrection bug.
        const [nextSettings, nextCatalog, nextConnectors, nextConfigured] = await Promise.all([
          AdminIntegrationsService.listWithNuma(numaGet),
          AdminIntegrationsService.catalogWithNuma(numaGet),
          AdminDataConnectorsService.listWithNuma(numaGet).catch(() => null),
          ConnectorsService.listConfigured().catch(() => null),
        ]);
        setGlobalSettings(nextSettings);
        setIntegrationsCatalog(nextCatalog);
        if (nextConnectors) setDataConnectorAdmin(nextConnectors);
        if (nextConfigured) {
          setConfiguredNativeSlugs(
            new Set([...nextConfigured.oauth.map((c) => c.id), ...nextConfigured.pat.map((c) => c.id)])
          );
        }
        setRemovingSlugs((prev) => {
          const next = new Set(prev);
          next.delete(entry.slug);
          return next;
        });
      } catch (e) {
        // Roll back the optimistic hide so the row reappears with the error.
        setRemovingSlugs((prev) => {
          const next = new Set(prev);
          next.delete(entry.slug);
          return next;
        });
        setError((e as Error).message || t('errors.updateIntegration'));
      }
    },
    [confirm, globalSettings, numaPut, numaGet, t, tCommon]
  );

  const handleConfiguredNative = useCallback(async () => {
    const slug = configuringConnector;
    const intent = configuringIntent;
    setConfiguringConnector(null);
    if (slug) {
      try {
        // Always flip the data-connector-settings flag so the unified catalog
        // surfaces the row with the correct method indication.
        await AdminDataConnectorsService.updateWithNuma(slug, { status: 'enabled' }, numaPut);
        // For 'add' / 'switch' intent the admin explicitly chose native, so
        // make it the preferred method on the paired Pipedream record (the
        // preferred_method field lives on the Pipedream side of the catalog).
        // For 'reconfigure' we leave preferred_method alone — they're just
        // updating credentials. For 'user_choice' we keep preferred_method
        // null (set when Pipedream was enabled in handleAddService) so users
        // pick the method themselves at connect time.
        if (intent !== 'reconfigure' && intent !== 'user_choice') {
          const pairedPipedreamSlug = pipedreamForConnector[slug];
          if (pairedPipedreamSlug) {
            const cur = globalSettings[pairedPipedreamSlug];
            await AdminIntegrationsService.updateWithNuma(
              pairedPipedreamSlug,
              {
                status: cur?.status ?? 'disabled',
                denyTools: cur?.denyTools ?? [],
                preferred_method: 'native',
              },
              numaPut
            );
          }
        }
      } catch (e) {
        console.warn('Failed to flag native connector as enabled', e);
      }
    }
    await loadGlobal();
    if (isAdmin && dataConnectorsEnabled) {
      AdminDataConnectorsService.listWithNuma(numaGet)
        .then(setDataConnectorAdmin)
        .catch(() => undefined);
    }
  }, [
    configuringConnector,
    configuringIntent,
    globalSettings,
    pipedreamForConnector,
    isAdmin,
    dataConnectorsEnabled,
    numaGet,
    numaPut,
  ]);

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
        // Only show capabilities in BOTH the metadata AND deployed as true,
        // and not currently behind a code-level kill switch.
        const items = meta.filter((cap) => {
          if (KILLED_CAPABILITY_FLAGS.has(cap.flag)) return false;
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
          if (KILLED_CAPABILITY_FLAGS.has(flag)) continue;
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
          if (KILLED_CAPABILITY_FLAGS.has(flag)) continue;
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
      .then(setDataConnectorAdmin)
      .catch(() =>
        setDataConnectorAdmin({
          settings: { synergy: { status: 'disabled' } },
          apiDocsAvailableSlugs: new Set(),
        })
      );
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
  // Slug of the catalog entry currently open in the Manage modal. We store
  // the slug rather than the full entry so the modal stays in sync with the
  // live catalog — after a method switch or native setup the catalog
  // refreshes and the modal reactively reflects the new "Active" / configured
  // state without the admin having to reopen it.
  const [manageForSlug, setManageForSlug] = useState<string | null>(null);
  // Gmail event-trigger setup wizard (native Gmail only, gated on automations).
  const [showGmailTriggers, setShowGmailTriggers] = useState(false);
  const [gmailTriggerStatus, setGmailTriggerStatus] = useState<{
    configured: boolean;
    pubsubTopic: string | null;
  } | null>(null);
  const manageFor = useMemo(
    () => (manageForSlug ? (integrationsCatalog.find((e) => e.slug === manageForSlug) ?? null) : null),
    [manageForSlug, integrationsCatalog]
  );

  // Whether the Gmail-triggers card/wizard is relevant for the open Manage modal:
  // native Gmail + automations (SCHEDULING) + event triggers enabled.
  const gmailTriggersEligible =
    !!manageFor &&
    manageFor.connectorSlug === 'gmail' &&
    isNativeAvailable(manageFor.connectorSlug, manageFor.connectorEnabled) &&
    schedulingEnabled &&
    getFlag('EVENT_TRIGGERS');

  // Read the current trigger config (from the connector-settings row) so the card
  // can reflect "already set up" instead of always offering a fresh "Set up".
  const loadGmailTriggerStatus = useCallback(async () => {
    try {
      const res = (await numaGet('/api/admin/google-cloud/trigger-info')) as {
        configured: boolean;
        pubsubTopic: string | null;
      };
      setGmailTriggerStatus(res);
    } catch {
      setGmailTriggerStatus(null);
    }
  }, [numaGet]);

  useEffect(() => {
    if (!gmailTriggersEligible) {
      setGmailTriggerStatus(null);
      return;
    }
    void loadGmailTriggerStatus();
  }, [gmailTriggersEligible, loadGmailTriggerStatus]);
  const [toolsLoading, setToolsLoading] = useState<boolean>(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [toolList, setToolList] = useState<{ name: string; description?: string }[]>([]);
  const [toolToggles, setToolToggles] = useState<Record<string, boolean>>({});
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
      default:
        tab = userSettingsTabKey;
    }
    navigate(`/settings/${currentScope}/${tab}`, { replace: true });
  }, [currentScope, activeKey, userSettingsTabKey, navigate]);

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

  /** Open the unified Manage modal for a service. Loads Pipedream tool list
   *  when the Pipedream side is the active method; otherwise just renders the
   *  method-switching UI. */
  const openManage = (entry: CatalogEntry) => {
    setManageForSlug(entry.slug);
    if (entry.pipedreamSlug && entry.pipedreamEnabled) {
      void openManageTools(entry.pipedreamSlug);
    } else {
      setManageToolsFor(null);
      setToolList([]);
      setToolToggles({});
    }
  };

  const closeManage = () => {
    setManageForSlug(null);
    setManageToolsFor(null);
    setToolList([]);
    setToolToggles({});
    setToolsError(null);
  };

  // Keep the Manage modal's tool list in sync with the live active method.
  // When admin switches from native -> Pipedream the catalog refreshes; this
  // fires openManageTools so the tool list materialises in the same modal
  // session. The reverse direction clears the list so stale Pipedream tools
  // don't bleed through if the admin switches back to Pipedream later.
  useEffect(() => {
    if (!manageFor) return;
    const nativeAvailable = isNativeAvailable(manageFor.connectorSlug, manageFor.connectorEnabled);
    const isPdActive =
      manageFor.pipedreamEnabled === true && (!nativeAvailable || manageFor.preferred_method !== 'native');
    if (isPdActive && manageFor.pipedreamSlug) {
      if (manageToolsFor !== manageFor.pipedreamSlug) {
        void openManageTools(manageFor.pipedreamSlug);
      }
    } else if (manageToolsFor !== null) {
      setManageToolsFor(null);
      setToolList([]);
      setToolToggles({});
    }
  }, [manageFor, isNativeAvailable]);

  /** Render a single tool row inside the Manage modal's Tools section. */
  const renderManagedTool = (tool: { name: string; description?: string }) => {
    const allowed = toolToggles[tool.name] ?? true;
    const stripPrefix = (name: string, prefix?: string | null) =>
      prefix && name.startsWith(prefix + '-') ? name.slice(prefix.length + 1) : name;
    const toTitle = (s: string) =>
      s
        .split('-')
        .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(' ');
    const parseDescription = (desc: string | undefined) => {
      if (!desc) return null;
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      const parts: (string | React.ReactElement)[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(desc)) !== null) {
        if (match.index > lastIndex) parts.push(desc.substring(lastIndex, match.index));
        const linkText = match[1].toLowerCase().includes('see') ? t('manageTools.seeDocumentation') : match[1];
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
      if (lastIndex < desc.length) parts.push(desc.substring(lastIndex));
      return parts.length > 0 ? parts : desc;
    };
    const displayName = toTitle(stripPrefix(tool.name, manageToolsFor));
    return (
      <div
        key={tool.name}
        className={`d-flex align-items-start justify-content-between p-3 border rounded-3 ${allowed ? 'bg-light bg-opacity-25' : 'bg-light bg-opacity-50'}`}
      >
        <div className="flex-grow-1 me-3">
          <div className="d-flex align-items-center mb-1">
            <div
              className={`rounded-circle me-2 ${allowed ? 'bg-success' : 'bg-secondary'}`}
              style={{ width: 8, height: 8 }}
            />
            <span className={`fw-semibold ${allowed ? 'text-dark' : 'text-muted'}`}>{displayName}</span>
          </div>
          {tool.description && (
            <div
              className={`small settings-tool-description ${allowed ? 'text-muted' : 'text-secondary'}`}
              style={{ maxWidth: 720, whiteSpace: 'normal', wordBreak: 'break-word' }}
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
            style={{ transform: 'scale(1.1)' }}
          />
        </div>
      </div>
    );
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
          preferred_method: globalSettings[manageToolsFor]?.preferred_method ?? null,
        },
        numaPut
      );
      await loadGlobal();
      closeManage();
    } catch (e) {
      setToolsError((e as Error).message || t('errors.saveFailed'));
    }
  };

  const toggleCapability = async (flagName: string, nextEnabled: boolean) => {
    try {
      const cap = capabilities.find((c) => c.flag === flagName);
      if (!nextEnabled && capabilitySettings[flagName]?.status !== 'disabled') {
        const displayName = cap?.labelKey ? t(cap.labelKey) : (cap?.name ?? flagName);
        const ok = await confirm({
          message: t('capabilities.disableConfirm', { name: displayName }),
          confirmLabel: tCommon('common.ok'),
          variant: 'warning',
        });
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
    async (nextKey: string | null) => {
      if (!nextKey) {
        return;
      }

      if (activeKey === 'branding' && nextKey !== 'branding' && isBrandingDirty) {
        const confirmLeave = await confirm({
          message: t('navigation.unsavedBranding'),
          confirmLabel: tCommon('confirm.leave'),
          variant: 'warning',
        });

        if (!confirmLeave) {
          return;
        }

        setIsBrandingDirty(false);
      }

      setActiveKey(nextKey);
    },
    [activeKey, isBrandingDirty, confirm, t, tCommon]
  );

  const renderUnifiedAdminRow = (svc: (typeof addedServices)[number]) => {
    const pdSlug = svc.pipedreamSlug;
    const connectorSlug = svc.connectorSlug;
    const pdSettings = pdSlug ? globalSettings[pdSlug] : undefined;
    const pdEnabled = svc.pipedreamEnabled === true;
    const nativeEnabled = isNativeAvailable(connectorSlug, svc.connectorEnabled);
    // Method picker is only meaningful when the admin has *both* sides set
    // up — picking native makes no sense if no native credentials exist for
    // this service yet.
    const hasBothMethods = pdEnabled && nativeEnabled;
    const preferredMethod: IntegrationMethod | null = pdSettings?.preferred_method ?? null;
    const deniedCount = pdSettings?.denyTools?.length ?? 0;
    const disabledByPreview = previewMode;

    // Three display states on the row badge:
    //   1. User-choice mode (both configured + no preferred) -> "User choice" badge
    //   2. Both configured + preferred picked -> that method's badge
    //   3. Single method configured -> that method's badge
    const isUserChoice = hasBothMethods && preferredMethod === null;
    const displayMethod: IntegrationMethod = hasBothMethods
      ? (preferredMethod ?? 'pipedream') // only used when isUserChoice is false
      : pdEnabled
        ? 'pipedream'
        : 'native';

    return (
      <div key={svc.slug} className="border rounded-3 p-3 mb-2 bg-white">
        <div className="row align-items-center">
          <div className="col-md-6 d-flex align-items-center">
            <div
              className="rounded-2 d-flex align-items-center justify-content-center me-3 flex-shrink-0"
              style={{ width: 48, height: 48, backgroundColor: '#f8f9fa', border: '1px solid #dee2e6' }}
            >
              {svc.icon.iconUrl ? (
                <img src={svc.icon.iconUrl} alt={svc.name} width={32} height={32} style={{ objectFit: 'contain' }} />
              ) : svc.icon.iconClass ? (
                <i className={svc.icon.iconClass} style={{ fontSize: '1.4rem' }} />
              ) : null}
            </div>
            <div className="d-flex flex-column" style={{ gap: '0.25rem', minWidth: 0 }}>
              <div
                className="fw-semibold settings-item-title d-flex align-items-center"
                style={{ gap: '0.5rem', margin: 0 }}
              >
                <span>{svc.name}</span>
                {isUserChoice ? (
                  <span
                    className="badge bg-info-subtle text-info-emphasis border border-info-subtle d-inline-flex align-items-center"
                    style={{
                      fontSize: '0.7rem',
                      padding: '0.15rem 0.5rem',
                      gap: '0.3rem',
                      fontWeight: 500,
                      letterSpacing: '0.01em',
                      lineHeight: 1.2,
                      verticalAlign: 'middle',
                    }}
                    title={t('manage.method.userChoiceBadgeTooltip', {
                      defaultValue: 'Users pick the connection method at connect time',
                    })}
                  >
                    <i className="bi bi-people-fill" style={{ fontSize: '0.7rem' }} />
                    {t('manage.method.userChoiceBadge', { defaultValue: 'User choice' })}
                  </span>
                ) : (
                  <MethodBadge method={displayMethod} size="xs" />
                )}
                {/* FEAT-019: multi-account opt-in indicator. Pipedream-scope
                    only; shown whenever Pipedream is enabled for this row and
                    admin has flipped the toggle, so admins can see at a glance
                    which integrations are multi-account without opening the
                    manage modal. */}
                {pdEnabled && pdSettings?.allowMultipleAccounts && (
                  <span
                    className="badge d-inline-flex align-items-center"
                    style={{
                      fontSize: '0.7rem',
                      padding: '0.15rem 0.5rem',
                      gap: '0.3rem',
                      fontWeight: 500,
                      letterSpacing: '0.01em',
                      lineHeight: 1.2,
                      verticalAlign: 'middle',
                      background: '#ede9fe',
                      color: '#5b21b6',
                      border: '1px solid #ddd6fe',
                    }}
                    title={t('manage.multipleAccountsBadgeTooltip', {
                      defaultValue: 'Users can connect multiple Pipedream accounts for this integration',
                    })}
                  >
                    <i className="bi bi-people-fill" style={{ fontSize: '0.7rem' }} />
                    {t('manage.multipleAccountsBadge', { defaultValue: 'Multi-account' })}
                  </span>
                )}
              </div>
              {svc.description && (
                <div className="text-muted small settings-item-description" style={{ margin: 0, paddingLeft: 0 }}>
                  {svc.description}
                </div>
              )}
            </div>
          </div>
          <div className="col-md-6 d-flex justify-content-end gap-2 align-items-center flex-wrap">
            <Button
              variant="primary"
              size="sm"
              onClick={() => openManage(svc)}
              disabled={disabledByPreview}
              className="d-flex align-items-center"
            >
              <i className="bi bi-sliders me-2"></i>
              {t('integrations.manage', { defaultValue: 'Manage' })}
              {deniedCount > 0 && (
                <span className="ms-1 badge bg-light text-dark settings-item-badge">
                  {t('integrations.toolsOff', { count: deniedCount })}
                </span>
              )}
            </Button>
            <Button
              variant="outline-danger"
              size="sm"
              disabled={disabledByPreview}
              onClick={() => void handleRemoveService(svc)}
              title={t('integrations.remove', { defaultValue: 'Remove' })}
            >
              <i className="bi bi-trash" />
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

  const renderCapabilityRow = (cap: CapabilityItem, depth = 0) => {
    const capSetting = capabilitySettings[cap.flag];
    const adminEnabled = capSetting ? capSetting.status === 'enabled' : !DEFAULT_DISABLED_FLAGS.has(cap.flag);
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
          ...(depth > 0 ? { marginLeft: `${depth * 2}rem`, borderLeft: '3px solid #dee2e6' } : {}),
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
                {cap.tier === 'gold' && (
                  <OverlayTrigger placement="top" overlay={<Tooltip>{t('capabilities.goldTierTooltip')}</Tooltip>}>
                    <span
                      className="badge d-inline-flex align-items-center gap-1"
                      style={{
                        backgroundColor: '#fffbeb',
                        color: '#92400e',
                        border: '1px solid #fcd34d',
                        fontSize: '0.7rem',
                      }}
                    >
                      <i className="bi bi-gem" />
                      {t('capabilities.goldTier')}
                    </span>
                  </OverlayTrigger>
                )}
                {cap.metered && (
                  <OverlayTrigger placement="top" overlay={<Tooltip>{t('capabilities.meteredTooltip')}</Tooltip>}>
                    <span
                      className="badge d-inline-flex align-items-center gap-1"
                      style={{
                        backgroundColor: '#eef2ff',
                        color: '#4338ca',
                        border: '1px solid #c7d2fe',
                        fontSize: '0.7rem',
                      }}
                    >
                      <i className="bi bi-coin" />
                      {t('capabilities.metered')}
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

  // Recursively render a capability and its nested sub-capabilities, indenting
  // one level per depth (DATA_CONNECTORS_ENABLED → SYNERGY → SYNERGY_FILE_PARITY).
  // Depth-capped so a malformed cyclic dependency in capabilities.json can never
  // infinitely recurse and hang the Settings page.
  const renderCapabilityGroup = (group: CapabilityGroup, depth = 0): React.ReactNode => {
    if (depth > 10) return null;
    return (
      <div key={group.parent.flag}>
        {renderCapabilityRow(group.parent, depth)}
        {group.children.map((child) => renderCapabilityGroup(child, depth + 1))}
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
        ? [{ key: 'scheduling', label: t('tabs.scheduling'), iconClassName: 'bi bi-lightning-charge-fill' }]
        : []),
      { key: 'integrations', label: t('tabs.integrations'), iconClassName: 'bi bi-plug' },
      ...(dataConnectorsEnabled
        ? [
            {
              key: 'company-secrets',
              label: t('vault.company.tabLabel', 'Company Secrets'),
              iconClassName: 'bi bi-shield-lock-fill',
            },
          ]
        : []),
      { key: 'capabilities', label: t('capabilities.tabTitle'), iconClassName: 'bi bi-toggles' },
      ...(creditsEnabled
        ? [{ key: 'credits', label: t('tabs.credits', { defaultValue: 'Credits' }), iconClassName: 'bi bi-coin' }]
        : []),
      ...(voiceEnabled ? [{ key: 'voice', label: t('tabs.voice'), iconClassName: 'bi bi-telephone' }] : []),
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
      voiceEnabled,
      creditsEnabled,
      t,
    ]
  );
  const userTabs = useMemo(
    () => [
      { key: 'my-profile', label: t('userProfile.tabs.myProfile'), iconClassName: 'bi bi-person-circle' },
      { key: 'memories', label: t('userProfile.tabs.memories'), iconClassName: 'bi bi-stars' },
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
      ...(dataConnectorsEnabled
        ? [
            {
              key: 'secrets',
              label: t('vault.user.tabLabel', 'My Secrets'),
              iconClassName: 'bi bi-shield-lock-fill',
            },
          ]
        : []),
      ...(mfaEnabled
        ? [{ key: 'trusted-devices', label: t('userProfile.trustedDevices.title'), iconClassName: 'bi bi-shield-lock' }]
        : []),
    ],
    // REBASE RESOLUTION: Kept HEAD — includes mfaEnabled in deps. Incoming (8e1a6ca9, 2f54184e) omitted it,
    // but mfaEnabled IS used in the useMemo body (line ~767), so omitting it was a bug.
    [workspaceChatEnabled, mfaEnabled, dataConnectorsEnabled, t]
  );

  const activeTabLabel = (() => {
    if (currentScope === 'admin') return adminTabs.find((tab) => tab.key === activeKey)?.label;
    if (currentScope === 'user') return userTabs.find((tab) => tab.key === userSettingsTabKey)?.label;
    return undefined;
  })();

  return (
    <div className="dashboard settings-page">
      <PageHeader
        title={activeTabLabel ? `${t('header.title')} / ${activeTabLabel}` : t('header.title')}
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
          {/* The secrets vault is rendered as a sibling rather than inside
              UserProfilePage so the profile component stays focused on
              profile/chat-defaults concerns. */}
          <div hidden={userSettingsTabKey === 'secrets'} aria-hidden={userSettingsTabKey === 'secrets'}>
            <UserProfilePage
              embedded
              activeTabKey={userSettingsTabKey}
              onActiveTabChange={setUserSettingsTabKey}
              settingsScope={currentScope === 'user' || currentScope === 'admin' ? currentScope : 'user'}
            />
          </div>
          {userSettingsTabKey === 'secrets' && dataConnectorsEnabled && <VaultUserSecretsPanel />}
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
                {connectorAccessReviewEnabled && isAdmin && (
                  <ConnectorAccessPanel numaGet={numaGet} numaPost={numaPost} confirm={confirm} />
                )}
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
                                {/* One row per unique service. Dual-method
                                    services collapse to a single entry using
                                    the Pipedream icon + display name, with the
                                    toggle adding the slug to BOTH default
                                    lists so whichever method the workspace
                                    has configured wins on chat init. */}
                                {(() => {
                                  type Row = {
                                    key: string;
                                    label: string;
                                    iconSrc?: string;
                                    iconClass?: string;
                                    pipedreamSlug?: string;
                                    nativeSlug?: string;
                                  };
                                  const rows: Row[] = [];

                                  for (const integration of availableIntegrations) {
                                    const id = integration.name_slug;
                                    if (globalSettings[id]?.status !== 'enabled') continue;
                                    rows.push({
                                      key: `pd-${id}`,
                                      label: integration.name,
                                      iconSrc: getConnectionIcon(id),
                                      iconClass: getConnectionFallbackIcon(id),
                                      pipedreamSlug: id,
                                      nativeSlug: connectorSlugForPipedream(id) ?? undefined,
                                    });
                                  }

                                  for (const entry of integrationsCatalog) {
                                    const slug = entry.connectorSlug;
                                    if (!slug) continue;
                                    if (!isNativeAvailable(slug, entry.connectorEnabled)) continue;
                                    const pdSlug = pipedreamSlugForConnector(slug);
                                    // Skip if a Pipedream row already covers
                                    // this service.
                                    if (pdSlug && rows.some((r) => r.pipedreamSlug === pdSlug)) {
                                      continue;
                                    }
                                    const tmpl = getConnectorById(slug);
                                    rows.push({
                                      key: `nv-${slug}`,
                                      label: pdSlug ? getConnectionDisplayName(pdSlug) : (tmpl?.displayName ?? slug),
                                      iconSrc: pdSlug ? getConnectionIcon(pdSlug) : undefined,
                                      iconClass: pdSlug
                                        ? getConnectionFallbackIcon(pdSlug)
                                        : (tmpl?.icon ?? 'bi bi-plug'),
                                      pipedreamSlug: undefined,
                                      nativeSlug: slug,
                                    });
                                  }

                                  rows.sort((a, b) => a.label.localeCompare(b.label));

                                  if (rows.length === 0) {
                                    return <div className="text-muted small">{t('chatDefaults.noIntegrations')}</div>;
                                  }

                                  return rows.map((row) => {
                                    const pdEnabled = row.pipedreamSlug
                                      ? globalChatSettings.defaultConnectionIds.includes(row.pipedreamSlug)
                                      : false;
                                    const nvEnabled = row.nativeSlug
                                      ? (globalChatSettings.defaultNativeConnectorIds ?? []).includes(row.nativeSlug)
                                      : false;
                                    const checked = pdEnabled || nvEnabled;
                                    return (
                                      <Form.Check
                                        key={row.key}
                                        type="checkbox"
                                        id={`chat-defaults-${row.key}`}
                                        label={
                                          <span className="d-inline-flex align-items-center gap-2">
                                            {row.iconSrc ? (
                                              <img
                                                src={row.iconSrc}
                                                alt={row.label}
                                                style={{ width: 16, height: 16, objectFit: 'contain' }}
                                                onError={(e) => {
                                                  e.currentTarget.style.display = 'none';
                                                }}
                                              />
                                            ) : (
                                              <i className={row.iconClass} />
                                            )}
                                            {row.label}
                                          </span>
                                        }
                                        checked={checked}
                                        disabled={loadingSettings}
                                        onChange={(e) => {
                                          const nextChecked = e.target.checked;
                                          setGlobalChatSettings((prev) => {
                                            const pd = prev.defaultConnectionIds;
                                            const nv = prev.defaultNativeConnectorIds ?? [];
                                            let nextPd = pd;
                                            let nextNv = nv;
                                            if (row.pipedreamSlug) {
                                              nextPd = nextChecked
                                                ? Array.from(new Set([...pd, row.pipedreamSlug]))
                                                : pd.filter((x) => x !== row.pipedreamSlug);
                                            }
                                            if (row.nativeSlug) {
                                              nextNv = nextChecked
                                                ? Array.from(new Set([...nv, row.nativeSlug]))
                                                : nv.filter((x) => x !== row.nativeSlug);
                                            }
                                            return {
                                              ...prev,
                                              defaultConnectionIds: nextPd,
                                              defaultNativeConnectorIds: nextNv,
                                            };
                                          });
                                          setChatDefaultsDirty(true);
                                        }}
                                      />
                                    );
                                  });
                                })()}
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
                                    defaultNativeConnectorIds: globalChatSettings.defaultNativeConnectorIds,
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
                                const ok = await confirm({
                                  message,
                                  confirmLabel: tCommon('common.ok'),
                                  variant: 'warning',
                                });
                                if (!ok) return;
                                try {
                                  setAgentsSaving(true);
                                  await AdminAgentsService.update(opt.key as AgentsMode, numaPut);
                                  setAgentsMode(opt.key as AgentsMode);
                                } catch (e) {
                                  await showAlert({
                                    message: (e as Error).message || t('errors.updateAgentsPolicy'),
                                    variant: 'error',
                                  });
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
                      <i className="bi bi-lightning-charge-fill me-2"></i>
                      {t('tabs.scheduling')}
                    </span>
                  }
                >
                  <div className="mb-3">
                    {isAdmin && (
                      <>
                        <ScheduleQuotaAdminForm />
                        <hr className="my-4" />
                        <ScheduleAuditPanel />
                      </>
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
                  <>
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <span className="small text-muted">
                        {addedServices.length === 0
                          ? t('integrations.emptyHeader', {
                              defaultValue: 'No integrations added yet.',
                            })
                          : t('integrations.countHeader', {
                              count: addedServices.length,
                              defaultValue: '{{count}} integration added',
                            })}
                      </span>
                      <Button variant="primary" size="sm" onClick={() => setAddModalOpen(true)} disabled={previewMode}>
                        <i className="bi bi-plus-lg me-1" />
                        {t('integrations.addIntegration', { defaultValue: 'Add integration' })}
                      </Button>
                    </div>

                    {addedServices.length === 0 ? (
                      <div className="text-center text-muted small py-5 border rounded-3 bg-light">
                        <i className="bi bi-plug fs-3 d-block mb-2" />
                        {t('integrations.emptyBody', {
                          defaultValue:
                            'Click "Add integration" to enable services like Gmail, Slack, Google Drive, or any of the native data connectors.',
                        })}
                      </div>
                    ) : (
                      <div>{addedServices.map(renderUnifiedAdminRow)}</div>
                    )}
                  </>
                )}
              </Tab>
              {dataConnectorsEnabled && (
                <Tab
                  eventKey="company-secrets"
                  title={
                    <span>
                      <i className="bi bi-shield-lock-fill me-2"></i>
                      {t('vault.company.tabLabel', 'Company Secrets')}
                    </span>
                  }
                >
                  <VaultCompanySecretsPanel active={activeKey === 'company-secrets'} />
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
                <div>{capabilityGroups.map((group) => renderCapabilityGroup(group, 0))}</div>
              </Tab>
              {creditsEnabled && (
                <Tab
                  eventKey="credits"
                  title={
                    <span>
                      <i className="bi bi-coin me-2"></i>
                      {t('tabs.credits', { defaultValue: 'Credits' })}
                    </span>
                  }
                >
                  {activeKey === 'credits' && <CreditsDashboardPanel />}
                </Tab>
              )}
              {voiceEnabled && (
                <Tab
                  eventKey="voice"
                  title={
                    <span>
                      <i className="bi bi-telephone me-2"></i>
                      {t('tabs.voice')}
                    </span>
                  }
                >
                  <VoiceAdminPanel />
                </Tab>
              )}
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
      </div>

      <AddIntegrationModal
        show={addModalOpen}
        onHide={() => setAddModalOpen(false)}
        addedKeys={addedKeys}
        pipedreamForConnector={pipedreamForConnector}
        apiDocsAvailableSlugs={dataConnectorAdmin.apiDocsAvailableSlugs}
        onSelect={(entry, method) => void handleAddService(entry, method)}
      />

      <NativeConfigurationModal
        show={configuringConnector !== null}
        connectorSlug={configuringConnector}
        onHide={() => setConfiguringConnector(null)}
        onSaved={() => void handleConfiguredNative()}
      />

      <GmailTriggerSetupWizard
        show={showGmailTriggers}
        onHide={() => setShowGmailTriggers(false)}
        onComplete={() => {
          setShowGmailTriggers(false);
          void loadGmailTriggerStatus();
        }}
      />

      {isAdmin && (
        <Modal show={!!manageFor} onHide={closeManage} centered size="lg">
          {manageFor &&
            (() => {
              const mf = manageFor;
              const mfName = mf.pipedreamSlug
                ? getConnectionDisplayName(mf.pipedreamSlug)
                : (getConnectorById(mf.connectorSlug ?? '')?.displayName ?? mf.slug);
              const mfIcon = resolveServiceIcon(mf.pipedreamSlug, mf.connectorSlug);
              const mfSettings = mf.pipedreamSlug ? globalSettings[mf.pipedreamSlug] : undefined;
              const mfPreferred = mfSettings?.preferred_method ?? null;
              const mfPdEnabled = mf.pipedreamEnabled === true;
              const mfNativeEnabled = isNativeAvailable(mf.connectorSlug, mf.connectorEnabled);
              const mfHasPdOption = Boolean(mf.pipedreamSlug);
              const mfHasNativeOption = Boolean(mf.connectorSlug);
              // When both methods are configured AND admin hasn't picked a
              // preferred one, the service is in "user-choice" mode — users see
              // a method picker at connect time. Neither card is "active".
              const mfBothConfigured = mfPdEnabled && mfNativeEnabled;
              const mfUserChoice = mfBothConfigured && mfPreferred === null;
              const mfActiveMethod: IntegrationMethod | null = mfBothConfigured
                ? mfPreferred
                : mfPdEnabled
                  ? 'pipedream'
                  : mfNativeEnabled
                    ? 'native'
                    : null;
              const setUserChoiceMode = async (next: boolean) => {
                if (!mf.pipedreamSlug) return;
                // Toggling on -> null (user picks). Toggling off -> default to
                // Pipedream as the active method; admin can flip to native via
                // the card buttons.
                const nextPreferred: IntegrationMethod | null = next ? null : 'pipedream';
                await setPreferredMethod(mf.pipedreamSlug, nextPreferred);
              };
              return (
                <>
                  <Modal.Header closeButton className="border-0 pb-2">
                    <Modal.Title>
                      <div className="d-flex align-items-center gap-2">
                        <span
                          className="rounded d-flex align-items-center justify-content-center"
                          style={{ width: 36, height: 36, background: '#f8f9fa', border: '1px solid #dee2e6' }}
                        >
                          {mfIcon.iconUrl ? (
                            <img src={mfIcon.iconUrl} alt="" width={22} height={22} style={{ objectFit: 'contain' }} />
                          ) : mfIcon.iconClass ? (
                            <i className={mfIcon.iconClass} style={{ fontSize: '1.2rem' }} />
                          ) : null}
                        </span>
                        <span>{t('manage.title', { defaultValue: 'Manage {{name}}', name: mfName })}</span>
                      </div>
                    </Modal.Title>
                  </Modal.Header>
                  <Modal.Body className="pt-2" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                    {/* Method section — always shown. Lets admin switch the active
                      method, set up a not-yet-configured method, or reconfigure
                      native credentials. Replaces the old inline Add native/
                      Native buttons that used to live on the row. */}
                    <div className="mb-4">
                      <h6 className="text-uppercase small text-muted fw-semibold mb-2">
                        {t('manage.methodHeading', { defaultValue: 'Connection method' })}
                      </h6>
                      <div className="d-flex flex-column gap-2">
                        {mfBothConfigured && (
                          <UserChoiceCard isActive={mfUserChoice} t={t} onToggle={(next) => setUserChoiceMode(next)} />
                        )}
                        {mfHasPdOption && (
                          <ManageMethodCard
                            method="pipedream"
                            isActive={mfActiveMethod === 'pipedream'}
                            isConfigured={mfPdEnabled}
                            isUserChoiceMode={mfUserChoice}
                            t={t}
                            onActivate={async () => {
                              if (!mf.pipedreamSlug) return;
                              // Optimistic: switch the badge / Active state in
                              // the same React tick. setPreferredMethod handles
                              // the PUT + reconcile internally; we just need to
                              // also flip status to 'enabled' for the very
                              // first add case where Pipedream wasn't enabled.
                              optimisticPreferredMethod(mf.pipedreamSlug, 'pipedream');
                              const cur = globalSettings[mf.pipedreamSlug];
                              try {
                                await AdminIntegrationsService.updateWithNuma(
                                  mf.pipedreamSlug,
                                  {
                                    status: 'enabled',
                                    denyTools: cur?.denyTools ?? [],
                                    preferred_method: 'pipedream',
                                  },
                                  numaPut
                                );
                                await loadGlobal();
                              } catch (e) {
                                await loadGlobal();
                                setError((e as Error).message || t('errors.updateIntegration'));
                              }
                            }}
                          />
                        )}
                        {mfHasNativeOption && (
                          <ManageMethodCard
                            method="native"
                            isActive={mfActiveMethod === 'native'}
                            isConfigured={mfNativeEnabled}
                            isUserChoiceMode={mfUserChoice}
                            docsUnavailable={
                              // googledrive/gmail/onedrive are exempt — the LLM has
                              // strong native knowledge of these APIs and doesn't
                              // need per-slug docs. Mirror of the AddIntegrationModal
                              // exemption list.
                              !!mf.connectorSlug &&
                              !['googledrive', 'gmail', 'onedrive'].includes(mf.connectorSlug) &&
                              !dataConnectorAdmin.apiDocsAvailableSlugs.has(mf.connectorSlug)
                            }
                            t={t}
                            onActivate={async () => {
                              if (mfNativeEnabled && mf.pipedreamSlug) {
                                // Already configured — flip preferred_method
                                // with optimistic UI feedback.
                                await setPreferredMethod(mf.pipedreamSlug, 'native');
                              } else if (mf.connectorSlug) {
                                // Not yet configured — launch the wizard with
                                // 'switch' intent so handleConfiguredNative will
                                // set preferred_method='native' on save.
                                setConfiguringIntent('switch');
                                setConfiguringConnector(mf.connectorSlug);
                              }
                            }}
                            onReconfigure={
                              mfNativeEnabled && mf.connectorSlug
                                ? () => {
                                    // Reconfigure: just update credentials, leave
                                    // the admin's current preferred_method alone.
                                    setConfiguringIntent('reconfigure');
                                    setConfiguringConnector(mf.connectorSlug ?? null);
                                  }
                                : undefined
                            }
                          />
                        )}
                      </div>
                    </div>

                    {/* Gmail event-trigger setup — native Gmail only, gated on
                      automations + event triggers. Reflects whether Pub/Sub is
                      already wired (read from the connector-settings row). */}
                    {gmailTriggersEligible && (
                      <div className="mb-4">
                        <h6 className="text-uppercase small text-muted fw-semibold mb-2">
                          {t('manage.triggersHeading', { defaultValue: 'Email triggers' })}
                        </h6>
                        <div
                          className="d-flex align-items-start justify-content-between p-3 rounded"
                          style={{ background: '#f8f9fa', border: '1px solid #dee2e6' }}
                        >
                          <div className="me-3">
                            <div className="fw-semibold small mb-1 d-flex align-items-center gap-2">
                              {t('manage.triggersLabel', {
                                defaultValue: 'Trigger automations from incoming email',
                              })}
                              {gmailTriggerStatus?.configured && (
                                <span className="badge bg-success">
                                  <i className="bi bi-check-circle-fill me-1" />
                                  {t('manage.triggersConfigured', { defaultValue: 'Configured' })}
                                </span>
                              )}
                            </div>
                            <div className="small text-muted">
                              {gmailTriggerStatus?.configured
                                ? t('manage.triggersConfiguredHelp', {
                                    defaultValue: 'Incoming-email triggers are active for this workspace.',
                                  })
                                : t('manage.triggersHelp', {
                                    defaultValue:
                                      'Lets users build automations that fire when an email arrives. Requires a one-time Google Cloud Pub/Sub setup in your own project.',
                                  })}
                            </div>
                            {gmailTriggerStatus?.configured && gmailTriggerStatus.pubsubTopic && (
                              <div className="small text-muted mt-1 font-monospace text-break">
                                {gmailTriggerStatus.pubsubTopic}
                              </div>
                            )}
                          </div>
                          <Button
                            variant="outline-primary"
                            size="sm"
                            className="flex-shrink-0"
                            onClick={() => setShowGmailTriggers(true)}
                          >
                            <i className="bi bi-broadcast me-1" />
                            {gmailTriggerStatus?.configured
                              ? t('manage.triggersReconfigure', { defaultValue: 'Reconfigure' })
                              : t('manage.triggersSetUp', { defaultValue: 'Set up' })}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Multiple accounts section — visible whenever Pipedream
                      is enabled for this integration. Renders in user-choice
                      mode too, because users on user-choice may still pick
                      Pipedream and the multi-account opt-in governs Pipedream
                      behaviour. Hidden when Pipedream is unavailable or admin
                      has forced native as the active method (FEAT-019). */}
                    {mfPdEnabled && mfActiveMethod !== 'native' && mf.pipedreamSlug && (
                      <div className="mb-4">
                        <h6 className="text-uppercase small text-muted fw-semibold mb-2">
                          {t('manage.multipleAccountsHeading', { defaultValue: 'Multiple Pipedream accounts' })}
                        </h6>
                        <div
                          className="d-flex align-items-start justify-content-between p-3 rounded"
                          style={{ background: '#f8f9fa', border: '1px solid #dee2e6' }}
                        >
                          <div className="me-3">
                            <div className="fw-semibold small mb-1 d-flex align-items-center gap-2">
                              <span
                                className="badge"
                                style={{ background: '#ede9fe', color: '#5b21b6', fontWeight: 600 }}
                              >
                                <i className="bi bi-lightning-charge-fill me-1" />
                                {t('manage.method.pipedreamHeading', { defaultValue: 'Pipedream' })}
                              </span>
                              <span>
                                {t('manage.multipleAccountsLabel', {
                                  defaultValue: 'Allow users to connect multiple Pipedream accounts',
                                })}
                              </span>
                            </div>
                            <div className="small text-muted">
                              {t('manage.multipleAccountsHelp', {
                                defaultValue:
                                  "When enabled, users can connect more than one Pipedream account for this integration (e.g. two Gmail inboxes) and pick which to use in chat. Doesn't affect the native connector.",
                              })}
                            </div>
                          </div>
                          <Form.Check
                            type="switch"
                            id={`allow-multi-${mf.pipedreamSlug}`}
                            checked={mfSettings?.allowMultipleAccounts === true}
                            disabled={savingMultiAccount === mf.pipedreamSlug}
                            onChange={async (e) => {
                              if (!mf.pipedreamSlug) return;
                              const next = e.target.checked;
                              const slug = mf.pipedreamSlug;
                              const cur = globalSettings[slug];
                              // Optimistic flip so the switch feels instant.
                              setGlobalSettings((prev) => ({
                                ...prev,
                                [slug]: {
                                  status: prev[slug]?.status ?? 'disabled',
                                  denyTools: prev[slug]?.denyTools ?? [],
                                  preferred_method: prev[slug]?.preferred_method ?? null,
                                  allowMultipleAccounts: next,
                                },
                              }));
                              setSavingMultiAccount(slug);
                              try {
                                await AdminIntegrationsService.updateWithNuma(
                                  slug,
                                  {
                                    status: cur?.status ?? 'enabled',
                                    denyTools: cur?.denyTools ?? [],
                                    preferred_method: cur?.preferred_method ?? null,
                                    allowMultipleAccounts: next,
                                  },
                                  numaPut
                                );
                                await loadGlobal();
                              } catch (err) {
                                await loadGlobal();
                                setError((err as Error).message || t('errors.updateIntegration'));
                              } finally {
                                setSavingMultiAccount(null);
                              }
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Tools section — only relevant when Pipedream is the active
                      method. The deny list applies to Pipedream's MCP tools. */}
                    {mfPdEnabled && mfActiveMethod === 'pipedream' && (
                      <div>
                        <h6 className="text-uppercase small text-muted fw-semibold mb-2">
                          {t('manage.toolsHeading', { defaultValue: 'Tools' })}
                        </h6>
                        <p className="small text-muted mb-2">{t('manageTools.subtitle')}</p>
                        {toolsLoading ? (
                          <div className="text-center py-4">
                            <Spinner animation="border" size="sm" variant="primary" />
                          </div>
                        ) : toolsError ? (
                          <Alert variant="danger" className="mb-0">
                            <i className="bi bi-exclamation-triangle-fill me-2" />
                            {toolsError}
                          </Alert>
                        ) : toolList.length === 0 ? (
                          <div className="text-center py-3 small text-muted">{t('manageTools.empty')}</div>
                        ) : (
                          <div className="d-flex flex-column gap-2">{toolList.map(renderManagedTool)}</div>
                        )}
                      </div>
                    )}
                    {/* Synergy 12d PAT health + manual rotation. Only surfaces
                        when the connector is Synergy and the native side is
                        configured — auto-rotation can silently fail, and
                        before this badge there was no admin signal for it. */}
                    {mf.connectorSlug === 'synergy' &&
                      mfNativeEnabled &&
                      sessionStorage.getItem('DEPLOY_SYNERGY') === 'true' &&
                      getFlag('SYNERGY') && (
                        <div className="mt-3 d-flex justify-content-end">
                          <SynergyPatBadge connectorConfigured={mfNativeEnabled} />
                        </div>
                      )}
                  </Modal.Body>
                  <Modal.Footer className="border-top pt-3">
                    <div className="d-flex justify-content-between align-items-center w-100">
                      <small className="text-muted">
                        {mfActiveMethod === 'pipedream' && toolList.length > 0 && (
                          <>
                            <i className="bi bi-info-circle me-1" />
                            {t('manageTools.enabledCount', {
                              enabled: Object.values(toolToggles).filter(Boolean).length,
                              total: toolList.length,
                            })}
                          </>
                        )}
                      </small>
                      <div>
                        {/* When the Save button is present, the close button
                          discards pending tool-toggle edits — "Cancel" is the
                          honest label. Otherwise method-switching is already
                          auto-saved, so close means "Done", not "Cancel". */}
                        {mfActiveMethod === 'pipedream' && toolList.length > 0 ? (
                          <>
                            <Button variant="secondary" onClick={closeManage} className="me-2">
                              {t('actions.cancel')}
                            </Button>
                            <Button variant="primary" onClick={saveManageTools} disabled={toolsLoading || !!toolsError}>
                              <i className="bi bi-check-lg me-2" />
                              {t('actions.saveChanges')}
                            </Button>
                          </>
                        ) : (
                          <Button variant="primary" onClick={closeManage}>
                            {t('actions.done', { defaultValue: 'Done' })}
                          </Button>
                        )}
                      </div>
                    </div>
                  </Modal.Footer>
                </>
              );
            })()}
        </Modal>
      )}
    </div>
  );
}
