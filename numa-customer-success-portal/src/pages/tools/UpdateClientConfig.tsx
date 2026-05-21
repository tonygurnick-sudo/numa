import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Form, Button, Row, Col, Alert, Spinner, Modal, Tab, Nav } from 'react-bootstrap';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { ClientSelectGroup } from '@/components/ClientSelectGroup';
import { FeatureChecklist } from '@/components/FeatureChecklist';
import { ConfigField } from '@/components/ConfigField';
import { QuotaCheckCard } from '@/components/tools/QuotaCheckCard';
import { clientService } from '@/services/clientService';
import { clientMetadataService } from '@/services/clientMetadataService';
import {
  platformSettingsService,
  PLATFORM_QUOTA_INITIAL_VALUES,
  PlatformSettings as PlatformSettingsType,
} from '@/services/platformSettingsService';
import {
  Client,
  ClientConfig,
  clientConfigSchema,
  getDefaultClientConfigValues,
  CLIENT_STATUS_VALUES,
  CLIENT_STATUS_DISPLAY,
} from '@/types';
import type { ClientStatusValue } from '@/types';
import { FileExportService } from '@/utils/fileExport';
import {
  DEFAULT_ADMIN_FEATURES,
  DEFAULT_STANDARD_FEATURES,
  featuresListToString,
  sameMembers,
  stringToFeatures,
} from '@/constants/features';

const REGION_OPTIONS = [
  { label: 'US East (N. Virginia) us-east-1', value: 'us-east-1' },
  { label: 'Asia Pacific (Sydney) ap-southeast-2', value: 'ap-southeast-2' },
  { label: 'Asia Pacific (Jakarta) ap-southeast-3', value: 'ap-southeast-3' },
];

// Regions where Bedrock AgentCore is available (for cross-region AgentCore deployments)
const AGENTCORE_REGION_OPTIONS = [
  { label: 'US East (N. Virginia) us-east-1', value: 'us-east-1' },
  { label: 'Asia Pacific (Sydney) ap-southeast-2', value: 'ap-southeast-2' },
  { label: 'Asia Pacific (Singapore) ap-southeast-1', value: 'ap-southeast-1' },
  { label: 'Asia Pacific (Tokyo) ap-northeast-1', value: 'ap-northeast-1' },
  { label: 'Asia Pacific (Seoul) ap-northeast-2', value: 'ap-northeast-2' },
  { label: 'Asia Pacific (Mumbai) ap-south-1', value: 'ap-south-1' },
];

// All apps from infrastructure appLibrary + devAppLibrary (sorted alphabetically)
// Matches infra/stacks/numa-client-stack.ts appLibrary and devAppLibrary
const ALL_APPS = [
  'beyond-expectations',
  'candidate-screening',
  'company-profile',
  'contract-analysis',
  'council-recourse-consents',
  'costing-calculator',
  'data-analysis',
  'document-summariser',
  'e2e-test',
  'financial-analysis',
  'gdsr-assessment',
  'infringement-review',
  'meeting-analyser',
  'nolia',
  'nzsba-policy-builder',
  'policy-drafter',
  'policy-reviewer',
  'procurement-rfp-assessment',
  'rfp-response-comparison',
  'tor-assessment',
];

// Production apps only (isProdApp: true in infra/stacks/numa-client-stack.ts)
const PROD_APPS = [
  'candidate-screening',
  'company-profile',
  'contract-analysis',
  'document-summariser',
  'financial-analysis',
  'meeting-analyser',
  'policy-drafter',
  'policy-reviewer',
];

export default function UpdateClientConfig() {
  const [searchParams] = useSearchParams();
  const defaults = getDefaultClientConfigValues();

  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientName, setSelectedClientName] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // editable fields
  const [region, setRegion] = useState('us-east-1');
  const [allProdApps, setAllProdApps] = useState(true);
  const [allApps, setAllApps] = useState<boolean>(false);
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [pipedream, setPipedream] = useState<boolean>(false);
  const [dataConnectorsEnabled, setDataConnectorsEnabled] = useState<boolean>(false);
  const [agents, setAgents] = useState<boolean>(false);
  const [devInstance, setDevInstance] = useState<boolean>(false);
  const [allowQuotaSharing, setAllowQuotaSharing] = useState<boolean>(false);
  const [bedrockAccount, setBedrockAccount] = useState<string>('');
  const [provisionQResources, setProvisionQResources] = useState<boolean>(false);
  const [preferredKnowledgeBase, setPreferredKnowledgeBase] = useState<'q' | 'bedrock' | 'none'>(
    defaults.preferredKnowledgeBase
  );
  const [brandingProviderEnabled, setBrandingProviderEnabled] = useState<boolean>(false);
  const [numaWorkspaceChat, setNumaWorkspaceChat] = useState<boolean>(false);
  const [scheduling, setScheduling] = useState<boolean>(false);
  // Sub-flag of `scheduling` — defaults to false (clients must opt in to
  // event triggers). Setting to true exposes the trigger builder, trigger
  // quota fields, and trigger admin sections.
  const [triggers, setTriggers] = useState<boolean>(false);
  const [schedulingMinIntervalMinutes, setSchedulingMinIntervalMinutes] = useState<string>('');
  // FEAT-105 — per-client (Level 2) automation quota overrides
  const [maxRunsPerCompanyPerMonth, setMaxRunsPerCompanyPerMonth] = useState<string>('');
  const [maxRunsPerUserPerMonth, setMaxRunsPerUserPerMonth] = useState<string>('');
  const [maxTriggerRunsPerCompanyPerMonth, setMaxTriggerRunsPerCompanyPerMonth] = useState<string>('');
  const [maxTriggerRunsPerUserPerMonth, setMaxTriggerRunsPerUserPerMonth] = useState<string>('');
  const [maxConcurrentActiveSchedulesPerCompany, setMaxConcurrentActiveSchedulesPerCompany] = useState<string>('');
  const [maxConcurrentActiveSchedulesPerUser, setMaxConcurrentActiveSchedulesPerUser] = useState<string>('');
  const [requireApprovalAboveUserCap, setRequireApprovalAboveUserCap] = useState<boolean | null>(null);
  const [workspaceChatModelSelection, setWorkspaceChatModelSelection] = useState<boolean>(false);
  const [numaOps, setNumaOps] = useState<boolean>(false);
  const [numaDropZones, setNumaDropZones] = useState<boolean>(false);
  const [numaSharing, setNumaSharing] = useState<boolean>(false);
  const [ssoEnabled, setSsoEnabled] = useState<boolean>(true);
  const [ssoEnterprise, setSsoEnterprise] = useState<boolean>(false);
  const [developerMode, setDeveloperMode] = useState<boolean>(false);
  const [secretsVaultEnabled, setSecretsVaultEnabled] = useState<boolean>(false);
  const [oauthIntegrationsEnabled, setOauthIntegrationsEnabled] = useState<boolean>(false);
  const [v2Apps, setV2Apps] = useState<boolean>(false);
  const [agentCoreRegion, setAgentCoreRegion] = useState<string>('');
  const [mfa, setMfa] = useState<boolean>(false);
  const [groupAdmin, setGroupAdmin] = useState(featuresListToString(DEFAULT_ADMIN_FEATURES));
  const [groupStandard, setGroupStandard] = useState(featuresListToString(DEFAULT_STANDARD_FEATURES));
  // Client metadata (non-deployment)
  const [metaStatus, setMetaStatus] = useState<ClientStatusValue>('unclear');
  const [trialStartDate, setTrialStartDate] = useState('');
  const [trialEndDate, setTrialEndDate] = useState('');
  const [metaNotes, setMetaNotes] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [beforeJson, setBeforeJson] = useState('');
  const [afterJson, setAfterJson] = useState('');
  // developer JSON replace
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [uploadedConfig, setUploadedConfig] = useState<ClientConfig | null>(null);
  const [showReplacePreview, setShowReplacePreview] = useState(false);

  // Live platform-settings (Level 1) so the inheritance placeholders show
  // what users actually inherit, not a hardcoded guess. Falls back to
  // PLATFORM_QUOTA_INITIAL_VALUES for fields the record doesn't override.
  const [platformSettings, setPlatformSettings] = useState<PlatformSettingsType | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await platformSettingsService.get();
        if (!cancelled) setPlatformSettings(s);
      } catch {
        if (!cancelled) setPlatformSettings({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Effective inherited value for a quota field — what the customer would
   * actually get if they leave the per-client override empty.
   */
  const inherited = <K extends keyof typeof PLATFORM_QUOTA_INITIAL_VALUES>(
    key: K
  ): (typeof PLATFORM_QUOTA_INITIAL_VALUES)[K] => {
    const fromRecord = platformSettings?.[key as keyof PlatformSettingsType];
    if (typeof fromRecord === typeof PLATFORM_QUOTA_INITIAL_VALUES[key] && fromRecord !== undefined) {
      return fromRecord as (typeof PLATFORM_QUOTA_INITIAL_VALUES)[K];
    }
    return PLATFORM_QUOTA_INITIAL_VALUES[key];
  };

  /**
   * Build the placeholder string. While platform-settings is still loading,
   * show a neutral message so we never display a misleading number.
   */
  const inheritPlaceholder = (key: keyof typeof PLATFORM_QUOTA_INITIAL_VALUES, suffix = ''): string => {
    if (platformSettings === null) return 'Leave empty to inherit (loading…)';
    return `Leave empty to inherit (Platform Settings → ${inherited(key).toLocaleString()}${suffix})`;
  };

  // Prefill selected client from query params (if present)
  useEffect(() => {
    const qClient = (searchParams.get('clientName') || '').trim();
    if (qClient) setSelectedClientName(qClient);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setWorking(true);
        const list = await clientService.getAllClients();
        setClients(list);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load clients');
      } finally {
        setWorking(false);
      }
    })();
  }, []);

  useEffect(() => {
    const client = clients.find((c) => c.name === selectedClientName);
    if (!client) return;
    const cfg = client.config;
    setRegion(cfg.region || 'us-east-1');
    const ap = Boolean(cfg.allProdApps);
    setAllProdApps(ap);
    setAllApps(Boolean((cfg as any).allApps));
    const appsRecord = !ap && cfg.apps ? (cfg.apps as Record<string, { enabled?: boolean }>) : undefined;
    const apps = appsRecord ? Object.keys(appsRecord) : [];
    setSelectedApps(apps);
    const pd = (cfg as unknown as Record<string, unknown>)['pipedreamIntegrations'];
    setPipedream(Boolean(pd));
    const dc = (cfg as unknown as Record<string, unknown>)['dataConnectorsEnabled'];
    setDataConnectorsEnabled(Boolean(dc));
    const ag = (cfg as unknown as Record<string, unknown>)['agents'];
    setAgents(Boolean(ag));
    setDevInstance(Boolean(cfg.devInstance));
    setAllowQuotaSharing(Boolean(cfg.allowBedrockQuotaSharing));
    setBedrockAccount(cfg.bedrockAccount || '');
    setProvisionQResources(Boolean((cfg as any).provisionQResources));
    setPreferredKnowledgeBase(
      ((cfg as any).preferredKnowledgeBase as 'q' | 'bedrock' | 'none') || defaults.preferredKnowledgeBase
    );
    setBrandingProviderEnabled(Boolean((cfg as any).brandingProviderEnabled));
    setNumaWorkspaceChat((cfg as any).numaWorkspaceChat ?? defaults.numaWorkspaceChat);
    setScheduling(Boolean((cfg as any).scheduling));
    // Read from eventTriggers first (authoritative post-rebase), fall back
    // to the legacy `triggers` key for unmigrated records, then default to
    // false. Reading only from `triggers` would miss records already on
    // the new key, and reading only from `eventTriggers` would miss the
    // pre-migration ones.
    {
      const cfgAny = cfg as { eventTriggers?: boolean; triggers?: boolean };
      setTriggers(cfgAny.eventTriggers ?? cfgAny.triggers ?? false);
    }
    setSchedulingMinIntervalMinutes(
      (cfg as any).schedulingMinIntervalMinutes != null ? String((cfg as any).schedulingMinIntervalMinutes) : ''
    );
    setMaxRunsPerCompanyPerMonth(
      (cfg as any).maxRunsPerCompanyPerMonth != null ? String((cfg as any).maxRunsPerCompanyPerMonth) : ''
    );
    setMaxRunsPerUserPerMonth(
      (cfg as any).maxRunsPerUserPerMonth != null ? String((cfg as any).maxRunsPerUserPerMonth) : ''
    );
    setMaxTriggerRunsPerCompanyPerMonth(
      (cfg as any).maxTriggerRunsPerCompanyPerMonth != null ? String((cfg as any).maxTriggerRunsPerCompanyPerMonth) : ''
    );
    setMaxTriggerRunsPerUserPerMonth(
      (cfg as any).maxTriggerRunsPerUserPerMonth != null ? String((cfg as any).maxTriggerRunsPerUserPerMonth) : ''
    );
    setMaxConcurrentActiveSchedulesPerCompany(
      (cfg as any).maxConcurrentActiveSchedulesPerCompany != null
        ? String((cfg as any).maxConcurrentActiveSchedulesPerCompany)
        : ''
    );
    setMaxConcurrentActiveSchedulesPerUser(
      (cfg as any).maxConcurrentActiveSchedulesPerUser != null
        ? String((cfg as any).maxConcurrentActiveSchedulesPerUser)
        : ''
    );
    setRequireApprovalAboveUserCap(
      typeof (cfg as any).requireApprovalAboveUserCap === 'boolean' ? (cfg as any).requireApprovalAboveUserCap : null
    );
    setWorkspaceChatModelSelection(Boolean((cfg as any).workspaceChatModelSelection));
    setNumaOps(Boolean((cfg as any).numaOps));
    setNumaDropZones(Boolean((cfg as any).numaDropZones));
    setNumaSharing(Boolean((cfg as any).numaSharing));
    setSsoEnabled((cfg as any).ssoEnabled ?? defaults.ssoEnabled);
    setSsoEnterprise(Boolean((cfg as any).ssoEnterprise));
    setDeveloperMode(Boolean((cfg as any).developerMode));
    setSecretsVaultEnabled(Boolean((cfg as any).secretsVaultEnabled));
    setOauthIntegrationsEnabled(Boolean((cfg as any).oauthIntegrationsEnabled));
    setV2Apps(Boolean((cfg as any)?.v2Apps));
    setAgentCoreRegion((cfg as any).agentCoreRegion || '');
    setMfa(Boolean((cfg as any).mfa));
    const groups = (cfg as unknown as Record<string, unknown>)['groups'] as
      | { admin?: string[]; standard?: string[] }
      | undefined;
    const adminList = groups?.admin && groups.admin.length > 0 ? groups.admin : DEFAULT_ADMIN_FEATURES;
    const standardList = groups?.standard && groups.standard.length > 0 ? groups.standard : DEFAULT_STANDARD_FEATURES;
    setGroupAdmin(featuresListToString(adminList));
    setGroupStandard(featuresListToString(standardList));

    // Load metadata for the selected client
    clientMetadataService.getMetadata(selectedClientName).then((meta) => {
      if (meta) {
        setMetaStatus(meta.status ?? 'unclear');
        setTrialStartDate(meta.trialStartDate || '');
        setTrialEndDate(meta.trialEndDate || '');
        setMetaNotes(meta.notes || '');
      } else {
        setMetaStatus('unclear');
        setTrialStartDate('');
        setTrialEndDate('');
        setMetaNotes('');
      }
    });
  }, [selectedClientName, clients]);

  const buildUpdates = (current?: ClientConfig): Partial<ClientConfig> => {
    const eff = {
      region: current?.region,
      allProdApps: current?.allProdApps ?? defaults.allProdApps,
      allApps: (current as any)?.allApps ?? false,
      apps: current?.apps,
      devInstance: current?.devInstance ?? defaults.devInstance,
      allowBedrockQuotaSharing: current?.allowBedrockQuotaSharing ?? defaults.allowBedrockQuotaSharing,
      bedrockAccount: current?.bedrockAccount ?? '',
      pipedreamIntegrations: current?.pipedreamIntegrations ?? false,
      dataConnectorsEnabled: (current as any)?.dataConnectorsEnabled ?? false,
      agents: (current as any)?.agents ?? false,
      brandingProviderEnabled: (current as any)?.brandingProviderEnabled ?? defaults.brandingProviderEnabled,
      numaWorkspaceChat: (current as any)?.numaWorkspaceChat ?? defaults.numaWorkspaceChat,
      scheduling: (current as any)?.scheduling ?? defaults.scheduling,
      eventTriggers: (current as any)?.eventTriggers ?? defaults.eventTriggers,
      schedulingMinIntervalMinutes: (current as any)?.schedulingMinIntervalMinutes ?? undefined,
      maxRunsPerCompanyPerMonth: (current as any)?.maxRunsPerCompanyPerMonth ?? undefined,
      maxRunsPerUserPerMonth: (current as any)?.maxRunsPerUserPerMonth ?? undefined,
      maxTriggerRunsPerCompanyPerMonth: (current as any)?.maxTriggerRunsPerCompanyPerMonth ?? undefined,
      maxTriggerRunsPerUserPerMonth: (current as any)?.maxTriggerRunsPerUserPerMonth ?? undefined,
      maxConcurrentActiveSchedulesPerCompany: (current as any)?.maxConcurrentActiveSchedulesPerCompany ?? undefined,
      maxConcurrentActiveSchedulesPerUser: (current as any)?.maxConcurrentActiveSchedulesPerUser ?? undefined,
      requireApprovalAboveUserCap: (current as any)?.requireApprovalAboveUserCap ?? undefined,
      workspaceChatModelSelection:
        (current as any)?.workspaceChatModelSelection ?? defaults.workspaceChatModelSelection,
      numaOps: (current as any)?.numaOps ?? defaults.numaOps,
      numaDropZones: (current as any)?.numaDropZones ?? defaults.numaDropZones,
      numaSharing: (current as any)?.numaSharing ?? defaults.numaSharing,
      ssoEnabled: (current as any)?.ssoEnabled ?? defaults.ssoEnabled,
      ssoEnterprise: (current as any)?.ssoEnterprise ?? defaults.ssoEnterprise,
      developerMode: (current as any)?.developerMode ?? defaults.developerMode,
      secretsVaultEnabled: (current as any)?.secretsVaultEnabled ?? defaults.secretsVaultEnabled,
      oauthIntegrationsEnabled: (current as any)?.oauthIntegrationsEnabled ?? defaults.oauthIntegrationsEnabled,
      v2Apps: (current as any)?.v2Apps ?? defaults.v2Apps,
      agentCoreRegion: (current as any)?.agentCoreRegion ?? '',
      provisionQResources: (current as any)?.provisionQResources ?? defaults.provisionQResources,
      preferredKnowledgeBase:
        ((current as any)?.preferredKnowledgeBase as 'q' | 'bedrock' | 'none') ?? defaults.preferredKnowledgeBase,
      mfa: (current as any)?.mfa ?? defaults.mfa,
    };

    const updates: Partial<ClientConfig> = {};

    // Only include region if changed
    if (region && eff.region !== region) updates.region = region;

    // Only include allApps/allProdApps if changed
    if (eff.allApps !== allApps) updates.allApps = allApps;
    if (!allApps && eff.allProdApps !== allProdApps) updates.allProdApps = allProdApps;

    // Handle apps array: when allApps is true, don't include apps (all apps deployed automatically)
    // When allProdApps is true, only include selected dev apps
    // When both false, include all selected apps
    if (!allApps) {
      const appsToInclude = allProdApps
        ? selectedApps.filter((a) => !PROD_APPS.includes(a)) // Only dev apps when allProdApps is true
        : selectedApps; // All selected apps when allProdApps is false

      const currentApps = Object.keys(eff.apps || {});
      const hasChanged = !sameMembers(currentApps, appsToInclude);

      if (hasChanged) {
        updates.apps = appsToInclude.length > 0 ? Object.fromEntries(appsToInclude.map((a) => [a, {}])) : {};
      }
    }

    // Only include pipedreamIntegrations if changed
    if (eff.pipedreamIntegrations !== pipedream) updates.pipedreamIntegrations = pipedream;
    if (eff.dataConnectorsEnabled !== dataConnectorsEnabled) updates.dataConnectorsEnabled = dataConnectorsEnabled;

    // Only include agents if changed
    if (eff.agents !== agents) updates.agents = agents;

    // Only include other flags if changed vs effective current
    if (eff.devInstance !== devInstance) updates.devInstance = devInstance;
    if (eff.allowBedrockQuotaSharing !== allowQuotaSharing) updates.allowBedrockQuotaSharing = allowQuotaSharing;
    if (eff.bedrockAccount !== bedrockAccount.trim()) {
      if (bedrockAccount.trim()) {
        updates.bedrockAccount = bedrockAccount.trim();
      } else if (current?.bedrockAccount) {
        // Remove bedrockAccount if it was set but now cleared
        updates.bedrockAccount = undefined as any;
      }
    }
    if (eff.brandingProviderEnabled !== brandingProviderEnabled)
      updates.brandingProviderEnabled = brandingProviderEnabled;
    if (eff.numaWorkspaceChat !== numaWorkspaceChat) updates.numaWorkspaceChat = numaWorkspaceChat;
    if (eff.scheduling !== scheduling) updates.scheduling = scheduling;
    if ((eff as any).eventTriggers !== triggers) (updates as any).eventTriggers = triggers;
    // Legacy field cleanup. The boolean was originally named `triggers`; we
    // renamed it to `eventTriggers` to match the dev-side flag. If a record
    // still carries the old key, drop it on save (REMOVE expression in
    // updateClientConfig — `undefined` value is the signal). Idempotent: a
    // second save where `triggers` is already absent is a no-op.
    if ((current as Record<string, unknown> | undefined)?.triggers !== undefined) {
      (updates as Record<string, unknown>).triggers = undefined;
    }
    const rawMinInterval = schedulingMinIntervalMinutes ? parseInt(schedulingMinIntervalMinutes, 10) : undefined;
    const parsedMinInterval = rawMinInterval != null && !Number.isNaN(rawMinInterval) ? rawMinInterval : undefined;
    if (eff.schedulingMinIntervalMinutes !== parsedMinInterval)
      updates.schedulingMinIntervalMinutes = parsedMinInterval;

    // FEAT-105 — quota overrides
    const parsePositive = (raw: string): number | undefined => {
      const n = raw ? parseInt(raw, 10) : undefined;
      return n != null && !Number.isNaN(n) && n > 0 ? n : undefined;
    };
    const parsedMaxCompany = parsePositive(maxRunsPerCompanyPerMonth);
    const parsedMaxUser = parsePositive(maxRunsPerUserPerMonth);
    const parsedMaxTriggerCompany = parsePositive(maxTriggerRunsPerCompanyPerMonth);
    const parsedMaxTriggerUser = parsePositive(maxTriggerRunsPerUserPerMonth);
    const parsedMaxConcurrentCompany = parsePositive(maxConcurrentActiveSchedulesPerCompany);
    const parsedMaxConcurrent = parsePositive(maxConcurrentActiveSchedulesPerUser);
    if ((eff as any).maxRunsPerCompanyPerMonth !== parsedMaxCompany)
      (updates as any).maxRunsPerCompanyPerMonth = parsedMaxCompany;
    if ((eff as any).maxRunsPerUserPerMonth !== parsedMaxUser) (updates as any).maxRunsPerUserPerMonth = parsedMaxUser;
    if ((eff as any).maxTriggerRunsPerCompanyPerMonth !== parsedMaxTriggerCompany)
      (updates as any).maxTriggerRunsPerCompanyPerMonth = parsedMaxTriggerCompany;
    if ((eff as any).maxTriggerRunsPerUserPerMonth !== parsedMaxTriggerUser)
      (updates as any).maxTriggerRunsPerUserPerMonth = parsedMaxTriggerUser;
    if ((eff as any).maxConcurrentActiveSchedulesPerCompany !== parsedMaxConcurrentCompany)
      (updates as any).maxConcurrentActiveSchedulesPerCompany = parsedMaxConcurrentCompany;
    if ((eff as any).maxConcurrentActiveSchedulesPerUser !== parsedMaxConcurrent)
      (updates as any).maxConcurrentActiveSchedulesPerUser = parsedMaxConcurrent;
    if ((eff as any).requireApprovalAboveUserCap !== (requireApprovalAboveUserCap ?? undefined))
      (updates as any).requireApprovalAboveUserCap = requireApprovalAboveUserCap ?? undefined;
    if (eff.workspaceChatModelSelection !== workspaceChatModelSelection)
      updates.workspaceChatModelSelection = workspaceChatModelSelection;
    if (eff.numaOps !== numaOps) updates.numaOps = numaOps;
    if (eff.numaDropZones !== numaDropZones) (updates as any).numaDropZones = numaDropZones;
    if (eff.numaSharing !== numaSharing) (updates as any).numaSharing = numaSharing;
    if (eff.ssoEnabled !== ssoEnabled) (updates as any).ssoEnabled = ssoEnabled;
    if (eff.ssoEnterprise !== ssoEnterprise) (updates as any).ssoEnterprise = ssoEnterprise;
    if (eff.developerMode !== developerMode) (updates as any).developerMode = developerMode;
    if (eff.secretsVaultEnabled !== secretsVaultEnabled) (updates as any).secretsVaultEnabled = secretsVaultEnabled;
    if (eff.oauthIntegrationsEnabled !== oauthIntegrationsEnabled)
      (updates as any).oauthIntegrationsEnabled = oauthIntegrationsEnabled;
    if (eff.v2Apps !== v2Apps) updates.v2Apps = v2Apps;
    if ((eff as any).agentCoreRegion !== agentCoreRegion) {
      if (agentCoreRegion) {
        (updates as any).agentCoreRegion = agentCoreRegion;
      } else if ((current as any)?.agentCoreRegion) {
        (updates as any).agentCoreRegion = undefined as any;
      }
    }
    if (eff.mfa !== mfa) updates.mfa = mfa;

    // Ensure these new fields are written even if default and currently missing
    if ((current as any)?.provisionQResources === undefined) {
      updates.provisionQResources = provisionQResources;
    } else if (eff.provisionQResources !== provisionQResources) {
      updates.provisionQResources = provisionQResources;
    }
    if ((current as any)?.preferredKnowledgeBase === undefined) {
      updates.preferredKnowledgeBase = preferredKnowledgeBase;
    } else if (eff.preferredKnowledgeBase !== preferredKnowledgeBase) {
      updates.preferredKnowledgeBase = preferredKnowledgeBase;
    }

    // Groups: only include if advanced mode enabled and values differ from current effective
    const admin = stringToFeatures(groupAdmin);
    const standard = stringToFeatures(groupStandard);
    const currentGroups = (current as unknown as Record<string, unknown>)?.['groups'] as
      | { admin?: string[]; standard?: string[] }
      | undefined;
    const currentAdmin = currentGroups?.admin ?? DEFAULT_ADMIN_FEATURES;
    const currentStandard = currentGroups?.standard ?? DEFAULT_STANDARD_FEATURES;
    if (showAdvanced && (!sameMembers(admin, currentAdmin) || !sameMembers(standard, currentStandard))) {
      (updates as unknown as Record<string, unknown>)['groups'] = {
        ...(standard.length ? { standard } : {}),
        ...(admin.length ? { admin } : {}),
      };
    }

    return updates;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!selectedClientName) {
      setError('Select a client');
      return;
    }
    // Validate scheduling min interval
    if (schedulingMinIntervalMinutes) {
      const val = parseInt(schedulingMinIntervalMinutes, 10);
      if (isNaN(val) || val < 5 || val > 1440) {
        setError('Minimum Automation Interval must be a whole number between 5 and 1440 minutes');
        return;
      }
    }
    // FEAT-105 — validate quota overrides (positive integer or empty)
    const validatePositive = (raw: string, label: string): string | null => {
      if (!raw) return null;
      const n = parseInt(raw, 10);
      if (isNaN(n) || !Number.isInteger(n) || n <= 0) return `${label} must be a positive integer`;
      return null;
    };
    const quotaErrors = [
      validatePositive(maxRunsPerCompanyPerMonth, 'Max schedule runs / company / month'),
      validatePositive(maxRunsPerUserPerMonth, 'Max schedule runs / user / month'),
      validatePositive(maxTriggerRunsPerCompanyPerMonth, 'Max trigger runs / company / month'),
      validatePositive(maxTriggerRunsPerUserPerMonth, 'Max trigger runs / user / month'),
      validatePositive(maxConcurrentActiveSchedulesPerCompany, 'Max concurrent active automations / company'),
      validatePositive(maxConcurrentActiveSchedulesPerUser, 'Max concurrent active automations / user'),
    ].filter(Boolean) as string[];
    if (quotaErrors.length) {
      setError(quotaErrors.join('; '));
      return;
    }

    const current = clients.find((c) => c.name === selectedClientName)?.config;
    const updates: Partial<ClientConfig> = buildUpdates(current);
    const merged = { ...(current || {}), ...updates };
    // Sort keys alphabetically before stringifying so newly-added fields
    // (e.g. `eventTriggers` replacing legacy `triggers`) land in their
    // alphabetical slot in the diff preview rather than appended at the
    // end. JSON.stringify(value, replacerArray) only emits keys in the
    // replacer order — pass merged|current keys sorted alphabetically.
    const sortedStringify = (obj: Record<string, unknown> | undefined): string => {
      if (!obj) return JSON.stringify(obj, null, 2);
      // `undefined` values are dropped by stringify already; we still want
      // them excluded from the key list so the diff shows the field as
      // removed rather than rendered as `null`.
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return JSON.stringify(obj, keys, 2);
    };
    setBeforeJson(sortedStringify(current as Record<string, unknown> | undefined));
    setAfterJson(sortedStringify(merged as Record<string, unknown>));
    setShowPreview(true);
  };

  const selectedClient = clients.find((c) => c.name === selectedClientName);

  return (
    <div>
      {/* Client Selection - always visible above tabs */}
      <Card className="border-0 shadow-sm mb-3">
        <Card.Header>
          <h5 className="mb-0">Update Client Config</h5>
          <p className="text-muted small mb-0 mt-2">
            Modify an existing client configuration. Values that differ from defaults are highlighted.
          </p>
        </Card.Header>
        <Card.Body>
          <Form.Group>
            <Form.Label className="fw-semibold">Select Client</Form.Label>
            <ClientSelectGroup value={selectedClientName} onChange={setSelectedClientName} clients={clients} />
            {selectedClient && (
              <Form.Text className="text-muted">
                Account: {selectedClient.config.clientAccountId} | Type:{' '}
                {selectedClient.config.devInstance ? 'Development' : 'Production'}
              </Form.Text>
            )}
          </Form.Group>
        </Card.Body>
      </Card>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert variant="success" dismissible onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {selectedClientName && (
        <Tab.Container defaultActiveKey="config">
          <Nav variant="tabs" className="mb-3">
            <Nav.Item>
              <Nav.Link eventKey="config">Deployment Configuration</Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link eventKey="metadata">Client Metadata</Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link eventKey="quotas">Quota Check</Nav.Link>
            </Nav.Item>
          </Nav>

          <Tab.Content>
            {/* Tab 1: Deployment Configuration */}
            <Tab.Pane eventKey="config">
              <Card className="border-0 shadow-sm">
                <Card.Body>
                  <Form onSubmit={onSubmit}>
                    {/* Core Settings Row */}
                    <Row className="mb-4">
                      <Col md={6}>
                        <ConfigField
                          label="Region"
                          value={region}
                          defaultValue={defaults.qBusinessRegion}
                          onChange={setRegion}
                          type="select"
                          options={REGION_OPTIONS}
                          helpText="AWS region for deployment"
                        />
                      </Col>
                      <Col md={6}>
                        <ConfigField
                          label="Development Instance"
                          value={devInstance}
                          defaultValue={defaults.devInstance}
                          onChange={(v: boolean) => {
                            setDevInstance(v);
                            if (!v && allApps) {
                              setAllApps(false);
                              setSelectedApps([]);
                            }
                          }}
                          type="switch"
                          helpText="Mark as development/demo environment. Independent from Deploy All Apps."
                        />
                      </Col>
                    </Row>

                    {/* App Configuration Row */}
                    <Row className="mb-4">
                      <Col md={6}>
                        <ConfigField
                          label="Deploy All Apps"
                          value={allApps}
                          defaultValue={defaults.allApps}
                          onChange={setAllApps}
                          type="switch"
                          helpText="Deploy every app in the library (recommended for dev/demo stacks). Independent from Development Instance."
                        />
                        <ConfigField
                          label="All Production Apps"
                          value={allProdApps}
                          defaultValue={defaults.allProdApps}
                          onChange={setAllProdApps}
                          type="switch"
                          helpText="Enable all production applications"
                        >
                          <Form.Group className="mt-3">
                            <Form.Label className="small">
                              {allProdApps || allApps ? 'Included Apps' : 'Select Specific Apps'}
                            </Form.Label>
                            {allApps && (
                              <Alert variant="info" className="py-2 px-3 mb-2 small">
                                All apps are automatically enabled when &apos;Deploy All Apps&apos; is selected
                              </Alert>
                            )}
                            {allProdApps && !allApps && (
                              <Alert variant="info" className="py-2 px-3 mb-2 small">
                                All production apps are automatically enabled when &apos;All Production Apps&apos; is
                                selected
                              </Alert>
                            )}
                            <div className="d-flex flex-column gap-1">
                              {ALL_APPS.map((a) => {
                                const isProdApp = PROD_APPS.includes(a);
                                const isChecked = allApps || (allProdApps && isProdApp) || selectedApps.includes(a);
                                const isDisabled = allApps || (allProdApps && isProdApp);
                                return (
                                  <Form.Check
                                    key={a}
                                    type="checkbox"
                                    id={`app-${a}`}
                                    label={a}
                                    checked={isChecked}
                                    disabled={isDisabled}
                                    onChange={(e) => {
                                      const checked = e.currentTarget.checked;
                                      setSelectedApps((prev) =>
                                        checked ? Array.from(new Set([...prev, a])) : prev.filter((x) => x !== a)
                                      );
                                    }}
                                  />
                                );
                              })}
                            </div>
                            <Form.Text className="text-muted">
                              {allApps
                                ? 'All applications are included'
                                : allProdApps
                                  ? 'All production apps are included (dev apps can be selected individually)'
                                  : 'Tick one or more applications'}
                            </Form.Text>
                          </Form.Group>
                        </ConfigField>
                      </Col>
                      <Col md={6}>
                        <ConfigField
                          label="Pipedream Integrations"
                          value={pipedream}
                          defaultValue={false}
                          onChange={setPipedream}
                          type="switch"
                          helpText="Enable external API integrations"
                        />
                        <ConfigField
                          label="Native Integrations"
                          value={dataConnectorsEnabled}
                          defaultValue={defaults.dataConnectorsEnabled}
                          onChange={setDataConnectorsEnabled}
                          type="switch"
                          helpText="Surface Arcanum's native (first-party OAuth/PAT) integrations alongside Pipedream-backed ones in the unified Integrations surface"
                        />
                        <ConfigField
                          label="Agents"
                          value={agents}
                          defaultValue={defaults.agents}
                          onChange={setAgents}
                          type="switch"
                          helpText="Enable Agents UI and related functionality"
                        />
                        <ConfigField
                          label="Allow Bedrock Quota Sharing"
                          value={allowQuotaSharing}
                          defaultValue={defaults.allowBedrockQuotaSharing}
                          onChange={setAllowQuotaSharing}
                          type="switch"
                          helpText="When enabled, OTHER Numa accounts can use THIS account's Bedrock quotas"
                        />
                        <ConfigField
                          label="Bedrock Account"
                          value={bedrockAccount}
                          defaultValue=""
                          onChange={setBedrockAccount}
                          type="text"
                          helpText="AWS account ID that THIS account will use for Bedrock quotas (instead of its own). Leave empty to use this account's own quota."
                        />
                        <ConfigField
                          label="Branding Provider"
                          value={brandingProviderEnabled}
                          defaultValue={defaults.brandingProviderEnabled}
                          onChange={setBrandingProviderEnabled}
                          type="switch"
                          helpText="Enable custom branding UI and runtime asset loading"
                        />
                        <ConfigField
                          label="Numa Workspace Chat"
                          value={numaWorkspaceChat}
                          defaultValue={defaults.numaWorkspaceChat}
                          onChange={setNumaWorkspaceChat}
                          type="switch"
                          helpText="Enable Numa Workspace Chat (V2). On by default."
                        />
                        <ConfigField
                          label="Workspace Chat Model Selection"
                          value={workspaceChatModelSelection}
                          defaultValue={defaults.workspaceChatModelSelection}
                          onChange={setWorkspaceChatModelSelection}
                          type="switch"
                          helpText="Allow users to select AI models in Chat V2"
                        />
                        <ConfigField
                          label="Numa Ops"
                          value={numaOps}
                          defaultValue={defaults.numaOps}
                          onChange={setNumaOps}
                          type="switch"
                          helpText="Enable Numa Ops (work management, kanban boards, CRM)"
                        />
                        <ConfigField
                          label="Drop Zones"
                          value={numaDropZones}
                          defaultValue={defaults.numaDropZones}
                          onChange={setNumaDropZones}
                          type="switch"
                          helpText="Allow users to create shared upload folders for external users"
                        />
                        <ConfigField
                          label="Sharing"
                          value={numaSharing}
                          defaultValue={defaults.numaSharing}
                          onChange={setNumaSharing}
                          type="switch"
                          helpText="Allow users to share documents externally for Q&A"
                        />
                        <ConfigField
                          label="SSO Self-Service"
                          value={ssoEnabled}
                          defaultValue={defaults.ssoEnabled}
                          onChange={setSsoEnabled}
                          type="switch"
                          helpText="Show SSO admin tab so admins can configure SAML 2.0 identity providers"
                        />
                        <ConfigField
                          label="SSO Enterprise (SCIM/OIDC)"
                          value={ssoEnterprise}
                          defaultValue={defaults.ssoEnterprise}
                          onChange={setSsoEnterprise}
                          type="switch"
                          helpText="Group mapping, OIDC, SSO-only, SCIM. Requires SSO Self-Service enabled."
                        />
                        <ConfigField
                          label="Developer Mode"
                          value={developerMode}
                          defaultValue={defaults.developerMode}
                          onChange={setDeveloperMode}
                          type="switch"
                          helpText="Show power-user actions: file system drill-down, metadata inspection, debug views"
                        />
                        <ConfigField
                          label="Secrets Vault"
                          value={secretsVaultEnabled}
                          defaultValue={defaults.secretsVaultEnabled}
                          onChange={setSecretsVaultEnabled}
                          type="switch"
                          helpText="Secure credential storage for the workspace"
                        />
                        <ConfigField
                          label="OAuth Cloud Storage"
                          value={oauthIntegrationsEnabled}
                          defaultValue={defaults.oauthIntegrationsEnabled}
                          onChange={setOauthIntegrationsEnabled}
                          type="switch"
                          helpText="Connect Google Drive / OneDrive / Dropbox accounts"
                        />
                        <ConfigField
                          label="V2 Apps (not ready for customers)"
                          value={v2Apps}
                          defaultValue={defaults.v2Apps}
                          onChange={setV2Apps}
                          type="switch"
                          helpText="Enable V2 Apps. Internal/dev only — not ready for customer use."
                        />
                        <ConfigField
                          label="Multi-Factor Authentication (MFA)"
                          value={mfa}
                          defaultValue={defaults.mfa}
                          onChange={setMfa}
                          type="switch"
                          helpText="Require TOTP-based two-factor authentication for all users"
                        />
                        <ConfigField
                          label="Provision Q Resources"
                          value={provisionQResources}
                          defaultValue={defaults.provisionQResources}
                          onChange={setProvisionQResources}
                          type="switch"
                          helpText="Provision Q Business resources in this account"
                        />
                        <ConfigField
                          label="Numa Files backend"
                          value={preferredKnowledgeBase}
                          defaultValue={defaults.preferredKnowledgeBase}
                          onChange={(v: any) => setPreferredKnowledgeBase(v as 'q' | 'bedrock' | 'none')}
                          type="select"
                          options={[
                            { label: 'Bedrock', value: 'bedrock' },
                            { label: 'Q Business', value: 'q' },
                            { label: 'None (disabled)', value: 'none' },
                          ]}
                          helpText="Indexing backend that powers Numa Files search for this client"
                        />
                      </Col>
                    </Row>

                    {/* FEAT-105 — Agent Automations gets its own full-width section
                        below the feature-flag grid. The cramped right-column layout
                        couldn't breathe with the quota sub-options stacked under it.
                        Sub-options inherit from the platform-settings record (Level 1)
                        when left empty — that's the sole source of truth, no code-side
                        fallback default. */}
                    <Row className="mb-4">
                      <Col xs={12}>
                        <h5 className="mb-3">Agent Automations</h5>
                        <ConfigField
                          label="Agent Automations"
                          value={scheduling}
                          defaultValue={defaults.scheduling}
                          onChange={setScheduling}
                          type="switch"
                          helpText="Enable agent automations (schedules + triggers) and notifications. The sub-options below only apply when this is on."
                        />
                        {scheduling && (
                          <div className="border-start border-3 ps-3 ms-2 mb-3 bg-light bg-opacity-50 rounded-end py-3">
                            <ConfigField
                              label="Event Triggers"
                              value={triggers}
                              defaultValue={defaults.eventTriggers}
                              onChange={setTriggers}
                              type="switch"
                              helpText="Sub-flag of Agent Automations. When off, hides the event-trigger builder for users, the trigger admin tab, and the trigger quota fields below. Cron schedules continue to work."
                            />
                            <Row className="g-3 mt-1">
                              <Col xs={12}>
                                <ConfigField
                                  label="Minimum Automation Interval (minutes)"
                                  value={schedulingMinIntervalMinutes}
                                  defaultValue=""
                                  onChange={setSchedulingMinIntervalMinutes}
                                  type="text"
                                  placeholder={inheritPlaceholder('schedulingMinIntervalMinutes', ' min')}
                                  helpText="Minimum allowed interval between automation runs. Applies to schedules. Leave empty to inherit platform default."
                                />
                              </Col>
                              <Col md={6}>
                                <div className="text-muted small fw-semibold mb-2 text-uppercase">
                                  Schedule Run Quotas (cron-based, projected)
                                </div>
                                <ConfigField
                                  label="Max Schedule Runs / Company / Month"
                                  value={maxRunsPerCompanyPerMonth}
                                  defaultValue=""
                                  onChange={setMaxRunsPerCompanyPerMonth}
                                  type="text"
                                  placeholder={inheritPlaceholder('maxRunsPerCompanyPerMonth')}
                                  helpText="Hard cap on tenant-wide schedule runs per month. Always enforced — schedules above this are rejected at creation regardless of admin approval."
                                />
                                <ConfigField
                                  label="Max Schedule Runs / User / Month"
                                  value={maxRunsPerUserPerMonth}
                                  defaultValue=""
                                  onChange={setMaxRunsPerUserPerMonth}
                                  type="text"
                                  placeholder={inheritPlaceholder('maxRunsPerUserPerMonth')}
                                  helpText="Above this triggers admin approval (when enabled) or hard rejection."
                                />
                              </Col>
                              {triggers && (
                                <Col md={6}>
                                  <div className="text-muted small fw-semibold mb-2 text-uppercase">
                                    Trigger Run Quotas (event-based, actuals)
                                  </div>
                                  <ConfigField
                                    label="Max Trigger Runs / Company / Month"
                                    value={maxTriggerRunsPerCompanyPerMonth}
                                    defaultValue=""
                                    onChange={setMaxTriggerRunsPerCompanyPerMonth}
                                    type="text"
                                    placeholder={inheritPlaceholder('maxTriggerRunsPerCompanyPerMonth')}
                                    helpText="Hard cap on tenant-wide trigger fires per month. Counted at fire time."
                                  />
                                  <ConfigField
                                    label="Max Trigger Runs / User / Month"
                                    value={maxTriggerRunsPerUserPerMonth}
                                    defaultValue=""
                                    onChange={setMaxTriggerRunsPerUserPerMonth}
                                    type="text"
                                    placeholder={inheritPlaceholder('maxTriggerRunsPerUserPerMonth')}
                                    helpText="Over-cap fires are dropped silently with a one-shot per-month notification to the owner."
                                  />
                                </Col>
                              )}
                              <Col xs={12}>
                                <div className="text-muted small fw-semibold mb-2 text-uppercase mt-2">
                                  Concurrent Active Automations{triggers ? ' (schedules + triggers combined)' : ''}
                                </div>
                              </Col>
                              <Col md={6}>
                                <ConfigField
                                  label="Max Concurrent Active Automations / Company"
                                  value={maxConcurrentActiveSchedulesPerCompany}
                                  defaultValue=""
                                  onChange={setMaxConcurrentActiveSchedulesPerCompany}
                                  type="text"
                                  placeholder={inheritPlaceholder('maxConcurrentActiveSchedulesPerCompany')}
                                  helpText={
                                    triggers
                                      ? 'Hard tenant-wide cap on simultaneously active automations (cron schedules + event triggers).'
                                      : 'Hard tenant-wide cap on simultaneously active cron schedules.'
                                  }
                                />
                              </Col>
                              <Col md={6}>
                                <ConfigField
                                  label="Max Concurrent Active Automations / User"
                                  value={maxConcurrentActiveSchedulesPerUser}
                                  defaultValue=""
                                  onChange={setMaxConcurrentActiveSchedulesPerUser}
                                  type="text"
                                  placeholder={inheritPlaceholder('maxConcurrentActiveSchedulesPerUser')}
                                  helpText="Per-user cap on simultaneously active automations."
                                />
                              </Col>
                              <Col xs={12}>
                                <ConfigField
                                  label="Require Admin Approval Above User Cap"
                                  value={requireApprovalAboveUserCap ?? false}
                                  defaultValue={true}
                                  onChange={setRequireApprovalAboveUserCap as any}
                                  type="switch"
                                  helpText="When on, a user requesting more than their per-user cap goes to admin approval (admin can authorise up to the company cap, never above). When off, those requests are hard-rejected. The company quota is always a hard ceiling — admin approval cannot breach it. Default on."
                                />
                              </Col>
                            </Row>
                          </div>
                        )}
                      </Col>
                    </Row>

                    {/* Actions */}
                    <div className="d-flex align-items-center gap-3 mb-4">
                      <Button type="submit" disabled={working} className="px-4">
                        {working ? (
                          <>
                            <Spinner size="sm" className="me-2" />
                            Saving...
                          </>
                        ) : (
                          'Save Changes'
                        )}
                      </Button>
                      <div className="text-muted small">Only modified values will be updated in the configuration</div>
                    </div>

                    {/* Advanced Section */}
                    <div className="border-top pt-3">
                      <Form.Check
                        type="switch"
                        id="showAdvanced"
                        label="Advanced Configuration"
                        checked={showAdvanced}
                        onChange={(e) => setShowAdvanced(e.currentTarget.checked)}
                        className="mb-3"
                      />
                      {showAdvanced && (
                        <div className="bg-light rounded p-3">
                          <Row className="mb-3">
                            <Col md={6}>
                              <ConfigField
                                label="AgentCore Region"
                                value={agentCoreRegion}
                                defaultValue=""
                                onChange={setAgentCoreRegion}
                                type="select"
                                options={[
                                  { label: 'Same as deployment region (default)', value: '' },
                                  ...AGENTCORE_REGION_OPTIONS,
                                ]}
                                helpText="Only set this if the deployment region does not support Bedrock AgentCore. Consult a developer before changing."
                              />
                              {agentCoreRegion && (
                                <Alert variant="warning" className="mt-2 py-2 small">
                                  <strong>Warning:</strong> Cross-region AgentCore adds latency and complexity. Do not
                                  change this without consulting a developer.
                                </Alert>
                              )}
                            </Col>
                          </Row>
                          <Row>
                            <Col md={6}>
                              <Form.Group className="mb-3">
                                <Form.Label>Standard User Features</Form.Label>
                                <FeatureChecklist value={groupStandard} onChange={setGroupStandard} />
                              </Form.Group>
                            </Col>
                            <Col md={6}>
                              <Form.Group className="mb-3">
                                <Form.Label>Admin User Features</Form.Label>
                                <FeatureChecklist value={groupAdmin} onChange={setGroupAdmin} />
                              </Form.Group>
                            </Col>
                          </Row>
                          <div className="text-muted small">
                            Leave unchanged to use system defaults. Modify only if you need to override the recommended
                            groups.
                          </div>
                        </div>
                      )}
                    </div>
                  </Form>
                </Card.Body>
              </Card>

              {/* Developer JSON Replace */}
              <Card className="border-0 shadow-sm mt-4">
                <Card.Header>
                  <h6 className="mb-0">Replace Config from JSON (Developers)</h6>
                  <p className="text-muted small mb-0 mt-2">
                    Upload a full JSON config to replace the current configuration. Validation is strict. This mirrors
                    the CLI write-config replace behavior.
                  </p>
                </Card.Header>
                <Card.Body>
                  <Row className="align-items-end g-3">
                    <Col md={6}>
                      <Form.Group>
                        <Form.Label className="fw-semibold">Upload JSON file</Form.Label>
                        <Form.Control
                          type="file"
                          accept="application/json,.json"
                          onChange={async (e) => {
                            setJsonError(null);
                            setUploadedConfig(null);
                            const file = e.currentTarget.files?.[0];
                            if (!file) return;
                            try {
                              const text = await file.text();
                              const parsed = JSON.parse(text);
                              const validated = clientConfigSchema.strict().parse(parsed);
                              setUploadedConfig(validated as ClientConfig);
                            } catch (err: any) {
                              const msg = err?.message || 'Invalid JSON or schema mismatch';
                              setJsonError(msg);
                            }
                          }}
                        />
                        <Form.Text className="text-muted">
                          Only valid JSON matching the strict schema is accepted.
                        </Form.Text>
                      </Form.Group>
                    </Col>
                    <Col md={6} className="d-flex gap-2">
                      <Button
                        variant="outline-secondary"
                        disabled={!selectedClient}
                        onClick={() => {
                          if (!selectedClient) return;
                          const content = JSON.stringify(selectedClient.config, null, 2);
                          FileExportService.downloadFile({
                            name: `${selectedClient.name}.json`,
                            content,
                            mimeType: 'application/json',
                            size: new Blob([content]).size,
                          });
                        }}
                      >
                        Download current JSON
                      </Button>
                      <Button
                        variant="primary"
                        disabled={!uploadedConfig || !selectedClientName || working}
                        onClick={() => {
                          try {
                            setJsonError(null);
                            const before = clients.find((c) => c.name === selectedClientName)?.config;
                            setBeforeJson(JSON.stringify(before, null, 2));
                            setAfterJson(JSON.stringify(uploadedConfig, null, 2));
                            setShowReplacePreview(true);
                          } catch (err: any) {
                            setJsonError(err?.message || 'Unable to prepare preview');
                          }
                        }}
                      >
                        Preview Replace
                      </Button>
                    </Col>
                  </Row>
                  {jsonError && (
                    <Alert variant="danger" className="mt-3">
                      {jsonError}
                    </Alert>
                  )}
                </Card.Body>
              </Card>
            </Tab.Pane>

            {/* Tab 2: Client Metadata */}
            <Tab.Pane eventKey="metadata">
              <Card className="border-0 shadow-sm">
                <Card.Header>
                  <h6 className="mb-0">Client Metadata (Non-Deployment)</h6>
                  <p className="text-muted small mb-0 mt-2">
                    Track trial status, dates, and notes. This data is stored separately from the deployment config and
                    does not affect infrastructure.
                  </p>
                </Card.Header>
                <Card.Body>
                  <Row>
                    <Col md={4}>
                      <Form.Group className="mb-3">
                        <Form.Label className="fw-semibold">Status</Form.Label>
                        <Form.Select
                          value={metaStatus}
                          onChange={(e) => setMetaStatus(e.target.value as ClientStatusValue)}
                        >
                          {CLIENT_STATUS_VALUES.map((s) => (
                            <option key={s} value={s}>
                              {CLIENT_STATUS_DISPLAY[s].label}
                            </option>
                          ))}
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group className="mb-3">
                        <Form.Label className={metaStatus !== 'trial' ? 'text-muted' : ''}>Trial Start Date</Form.Label>
                        <DatePicker
                          selected={trialStartDate ? new Date(trialStartDate) : null}
                          onChange={(date: Date | null) =>
                            setTrialStartDate(date ? date.toISOString().split('T')[0] : '')
                          }
                          dateFormat="yyyy-MM-dd"
                          className="form-control"
                          placeholderText="Select start date"
                          disabled={metaStatus !== 'trial'}
                          showMonthDropdown
                          showYearDropdown
                          dropdownMode="select"
                        />
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group className="mb-3">
                        <Form.Label className={metaStatus !== 'trial' ? 'text-muted' : ''}>Trial End Date</Form.Label>
                        <DatePicker
                          selected={trialEndDate ? new Date(trialEndDate) : null}
                          onChange={(date: Date | null) =>
                            setTrialEndDate(date ? date.toISOString().split('T')[0] : '')
                          }
                          dateFormat="yyyy-MM-dd"
                          className="form-control"
                          placeholderText="Select end date"
                          disabled={metaStatus !== 'trial'}
                          showMonthDropdown
                          showYearDropdown
                          dropdownMode="select"
                          minDate={trialStartDate ? new Date(trialStartDate) : undefined}
                        />
                      </Form.Group>
                    </Col>
                  </Row>
                  <Form.Group className="mb-3">
                    <Form.Label>Notes</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={metaNotes}
                      onChange={(e) => setMetaNotes(e.target.value)}
                      placeholder="Free text notes about this client..."
                    />
                  </Form.Group>
                  <Button
                    variant="outline-primary"
                    disabled={working}
                    onClick={async () => {
                      try {
                        setWorking(true);
                        await clientMetadataService.saveMetadata({
                          clientName: selectedClientName,
                          status: metaStatus,
                          ...(trialStartDate ? { trialStartDate } : {}),
                          ...(trialEndDate ? { trialEndDate } : {}),
                          ...(metaNotes ? { notes: metaNotes } : {}),
                        });
                        setSuccess('Metadata saved');
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Failed to save metadata');
                      } finally {
                        setWorking(false);
                      }
                    }}
                  >
                    {working ? (
                      <>
                        <Spinner size="sm" className="me-2" />
                        Saving...
                      </>
                    ) : (
                      'Save Metadata'
                    )}
                  </Button>
                </Card.Body>
              </Card>
            </Tab.Pane>

            {/* Tab 3: Quota Check */}
            <Tab.Pane eventKey="quotas">
              {selectedClient && (
                <QuotaCheckCard accountId={selectedClient.config.clientAccountId} region={region} disabled={working} />
              )}
            </Tab.Pane>
          </Tab.Content>
        </Tab.Container>
      )}

      <Modal show={showPreview} onHide={() => setShowPreview(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Update</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Row>
            <Col md={6}>
              <h6 className="text-muted">Current</h6>
              <pre className="bg-light p-3 rounded" style={{ maxHeight: '50vh', overflow: 'auto' }}>
                {beforeJson}
              </pre>
            </Col>
            <Col md={6}>
              <h6 className="text-muted">Updated</h6>
              <pre className="bg-light p-3 rounded" style={{ maxHeight: '50vh', overflow: 'auto' }}>
                {afterJson}
              </pre>
            </Col>
          </Row>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowPreview(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={working}
            onClick={async () => {
              try {
                setWorking(true);
                // Recompute updates from afterJson – safer to reuse local updates by parsing the diff is overkill; call update with our 'updates' closure values
                const current = clients.find((c) => c.name === selectedClientName)?.config;
                const finalUpdates = buildUpdates(current);
                await clientService.updateClientConfig(selectedClientName, finalUpdates);
                try {
                  await clientMetadataService.saveMetadata({
                    clientName: selectedClientName,
                    status: metaStatus,
                    ...(trialStartDate ? { trialStartDate } : {}),
                    ...(trialEndDate ? { trialEndDate } : {}),
                    ...(metaNotes ? { notes: metaNotes } : {}),
                  });
                } catch (metaErr) {
                  console.error('Failed to save metadata alongside config update:', metaErr);
                }
                setSuccess('Configuration updated');
                setShowPreview(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to update config');
              } finally {
                setWorking(false);
              }
            }}
          >
            {working ? (
              <>
                <Spinner size="sm" className="me-2" />
                Saving…
              </>
            ) : (
              'Confirm Update'
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showReplacePreview} onHide={() => setShowReplacePreview(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Replace</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted">
            This will replace the entire configuration for <strong>{selectedClientName || '—'}</strong>.
          </p>
          <Row>
            <Col md={6}>
              <h6 className="text-muted">Current</h6>
              <pre className="bg-light p-3 rounded" style={{ maxHeight: '50vh', overflow: 'auto' }}>
                {beforeJson}
              </pre>
            </Col>
            <Col md={6}>
              <h6 className="text-muted">New</h6>
              <pre className="bg-light p-3 rounded" style={{ maxHeight: '50vh', overflow: 'auto' }}>
                {afterJson}
              </pre>
            </Col>
          </Row>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowReplacePreview(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={working || !uploadedConfig || !selectedClientName}
            onClick={async () => {
              if (!uploadedConfig || !selectedClientName) return;
              try {
                setWorking(true);
                await clientService.replaceClientConfig(selectedClientName, uploadedConfig);
                setSuccess('Configuration replaced');
                setShowReplacePreview(false);
                setUploadedConfig(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to replace config');
              } finally {
                setWorking(false);
              }
            }}
          >
            {working ? (
              <>
                <Spinner size="sm" className="me-2" />
                Replacing…
              </>
            ) : (
              'Confirm Replace'
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

// FeatureChecklist moved to shared component
