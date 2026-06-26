import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Form, Button, Row, Col, Alert, Spinner, Modal, Tab, Nav } from 'react-bootstrap';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { clientService } from '@/services/clientService';
import { clientMetadataService } from '@/services/clientMetadataService';
import {
  platformSettingsService,
  PLATFORM_QUOTA_INITIAL_VALUES,
  PlatformSettings as PlatformSettingsType,
} from '@/services/platformSettingsService';
import {
  getDefaultClientConfigValues,
  type ClientConfig,
  clientConfigSchema,
  CLIENT_STATUS_VALUES,
  CLIENT_STATUS_DISPLAY,
} from '@/types';
import type { ClientStatusValue } from '@/types';
import {
  DEFAULT_ADMIN_FEATURES,
  DEFAULT_STANDARD_FEATURES,
  featuresListToString,
  stringToFeatures,
} from '@/constants/features';
import { FeatureChecklist } from '@/components/FeatureChecklist';
import { ConfigField } from '@/components/ConfigField';
import { QuotaCheckCard } from '@/components/tools/QuotaCheckCard';
import { validateClientName, sanitizeClientName } from '@/utils/clientValidation';

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

export default function CreateClientConfig() {
  const [searchParams] = useSearchParams();
  const defaults = getDefaultClientConfigValues();

  const [clientName, setClientName] = useState('');
  const [clientNameError, setClientNameError] = useState<string | null>(null);
  const [clientAccountId, setClientAccountId] = useState('');
  const [region, setRegion] = useState(defaults.qBusinessRegion);
  const [allProdApps, setAllProdApps] = useState(true);
  const [allApps, setAllApps] = useState<boolean>(false);
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [pipedream, setPipedream] = useState(false); // default: false, not in defaults helper
  const [dataConnectorsEnabled, setDataConnectorsEnabled] = useState(defaults.dataConnectorsEnabled);
  const [scheduling, setScheduling] = useState(defaults.scheduling);
  // Sub-flag of `scheduling`. Defaults false — clients must opt in to
  // event triggers explicitly. Cron schedules continue to work even when
  // this is off.
  const [triggers, setTriggers] = useState<boolean>(defaults.eventTriggers);
  const [schedulingMinIntervalMinutes, setSchedulingMinIntervalMinutes] = useState<string>('');
  // FEAT-105 — per-client (Level 2) automation quota overrides
  const [maxRunsPerCompanyPerMonth, setMaxRunsPerCompanyPerMonth] = useState<string>('');
  const [maxRunsPerUserPerMonth, setMaxRunsPerUserPerMonth] = useState<string>('');
  const [maxTriggerRunsPerCompanyPerMonth, setMaxTriggerRunsPerCompanyPerMonth] = useState<string>('');
  const [maxTriggerRunsPerUserPerMonth, setMaxTriggerRunsPerUserPerMonth] = useState<string>('');
  const [maxConcurrentActiveSchedulesPerCompany, setMaxConcurrentActiveSchedulesPerCompany] = useState<string>('');
  const [maxConcurrentActiveSchedulesPerUser, setMaxConcurrentActiveSchedulesPerUser] = useState<string>('');
  const [requireApprovalAboveUserCap, setRequireApprovalAboveUserCap] = useState<boolean | null>(null);
  const [mfa, setMfa] = useState(defaults.mfa);
  const [devInstance, setDevInstance] = useState(defaults.devInstance);
  const [allowQuotaSharing, setAllowQuotaSharing] = useState(defaults.allowBedrockQuotaSharing);
  const [bedrockAccount, setBedrockAccount] = useState('');
  const [provisionQResources, setProvisionQResources] = useState(defaults.provisionQResources);
  const [preferredKnowledgeBase, setPreferredKnowledgeBase] = useState<'q' | 'bedrock' | 'none'>(
    defaults.preferredKnowledgeBase
  );
  const [agents, setAgents] = useState(defaults.agents);
  const [brandingProviderEnabled, setBrandingProviderEnabled] = useState(defaults.brandingProviderEnabled);
  const [numaWorkspaceChat, setNumaWorkspaceChat] = useState(defaults.numaWorkspaceChat);
  const [useGlobalInferenceProfile, setUseGlobalInferenceProfile] = useState(defaults.useGlobalInferenceProfile);
  const [workspaceChatModelSelection, setWorkspaceChatModelSelection] = useState(defaults.workspaceChatModelSelection);
  const [numaOps, setNumaOps] = useState(defaults.numaOps);
  const [numaDropZones, setNumaDropZones] = useState(defaults.numaDropZones);
  const [numaSharing, setNumaSharing] = useState(defaults.numaSharing);
  // Numa Credit System (FEAT-245) — surface the Credits visibility flag here so
  // staff can opt a client in at provisioning time, not just on the Credits page.
  const [showCredits, setShowCredits] = useState(defaults.showCredits);
  // Numa Voice (FEAT-169). connectInstanceUrl is only relevant for manually
  // created Connect instances; auto-provision derives the URL at deploy time.
  const [numaVoice, setNumaVoice] = useState(defaults.numaVoice);
  const [connectAutoProvision, setConnectAutoProvision] = useState(defaults.connectAutoProvision);
  const [connectClaimDid, setConnectClaimDid] = useState(defaults.connectClaimDid);
  const [voiceLiveAssist, setVoiceLiveAssist] = useState(defaults.voiceLiveAssist);
  const [connectInstanceUrl, setConnectInstanceUrl] = useState('');
  const [ssoEnabled, setSsoEnabled] = useState(defaults.ssoEnabled);
  const [ssoEnterprise, setSsoEnterprise] = useState(defaults.ssoEnterprise);
  const [developerMode, setDeveloperMode] = useState(defaults.developerMode);
  const [oauthIntegrationsEnabled, setOauthIntegrationsEnabled] = useState(defaults.oauthIntegrationsEnabled);
  const [v2Apps, setV2Apps] = useState(defaults.v2Apps);
  const [agentCoreRegion, setAgentCoreRegion] = useState('');
  const [groupAdmin, setGroupAdmin] = useState(featuresListToString(DEFAULT_ADMIN_FEATURES));
  const [groupStandard, setGroupStandard] = useState(featuresListToString(DEFAULT_STANDARD_FEATURES));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<ClientConfig | null>(null);
  // Client metadata (non-deployment)
  const [metaStatus, setMetaStatus] = useState<ClientStatusValue>('unclear');
  const [trialStartDate, setTrialStartDate] = useState('');
  const [trialEndDate, setTrialEndDate] = useState('');
  const [metaNotes, setMetaNotes] = useState('');
  // developer JSON create
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [uploadedConfig, setUploadedConfig] = useState<ClientConfig | null>(null);
  const [showJsonPreview, setShowJsonPreview] = useState(false);

  // Live platform-settings (Level 1) so the inheritance placeholders show
  // what users actually inherit, not a hardcoded guess.
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

  const inherited = <K extends keyof typeof PLATFORM_QUOTA_INITIAL_VALUES>(
    key: K
  ): (typeof PLATFORM_QUOTA_INITIAL_VALUES)[K] => {
    const fromRecord = platformSettings?.[key as keyof PlatformSettingsType];
    if (typeof fromRecord === typeof PLATFORM_QUOTA_INITIAL_VALUES[key] && fromRecord !== undefined) {
      return fromRecord as (typeof PLATFORM_QUOTA_INITIAL_VALUES)[K];
    }
    return PLATFORM_QUOTA_INITIAL_VALUES[key];
  };

  const inheritPlaceholder = (key: keyof typeof PLATFORM_QUOTA_INITIAL_VALUES, suffix = ''): string => {
    if (platformSettings === null) return 'Leave empty to inherit (loading…)';
    return `Leave empty to inherit (Platform Settings → ${inherited(key).toLocaleString()}${suffix})`;
  };

  // Prefill from query params when available
  useEffect(() => {
    const qClient = (searchParams.get('clientName') || '').trim();
    const qAccount = (searchParams.get('accountId') || '').trim();
    if (qClient && !clientName) setClientName(qClient);
    if (qAccount && !clientAccountId) setClientAccountId(qAccount);
    // only run once on mount
  }, []);

  // Validate client name whenever it changes
  useEffect(() => {
    if (clientName.trim().length > 0) {
      const error = validateClientName(clientName);
      setClientNameError(error);
    } else {
      setClientNameError(null);
    }
  }, [clientName]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!clientName || !clientAccountId) {
      setError('Client name and account ID are required');
      return;
    }
    // Check for client name validation errors
    if (clientNameError) {
      setError(`Invalid client name: ${clientNameError}`);
      return;
    }

    // Build minimal config: include only required and non-default options
    const minimal: Record<string, unknown> = {
      clientAccountId,
      region,
    };

    if (devInstance !== defaults.devInstance) minimal['devInstance'] = devInstance;
    if (allowQuotaSharing !== defaults.allowBedrockQuotaSharing)
      minimal['allowBedrockQuotaSharing'] = allowQuotaSharing;
    if (bedrockAccount && bedrockAccount.trim()) minimal['bedrockAccount'] = bedrockAccount.trim();
    if (allApps) {
      minimal['allApps'] = true;
    } else if (allProdApps !== defaults.allProdApps) {
      minimal['allProdApps'] = allProdApps;
    }

    // Include apps array when not using allApps
    if (!allApps) {
      const appsToInclude = allProdApps
        ? selectedApps.filter((a) => !PROD_APPS.includes(a)) // Only dev apps when allProdApps is true
        : selectedApps; // All selected apps when allProdApps is false

      if (appsToInclude.length > 0) {
        minimal['apps'] = Object.fromEntries(appsToInclude.map((a) => [a, {}]));
      }
    }
    if (pipedream) minimal['pipedreamIntegrations'] = true;
    if (dataConnectorsEnabled) minimal['dataConnectorsEnabled'] = true;
    if (agents) minimal['agents'] = true;
    if (scheduling) minimal['scheduling'] = true;
    // Only persist `triggers` when it differs from the default (false).
    // Writing `triggers: true` is the opt-in signal; missing/false stays
    // implicit so the create payload stays minimal for the common case.
    if (scheduling && triggers === true) (minimal as any)['eventTriggers'] = true;
    if (schedulingMinIntervalMinutes) {
      const val = parseInt(schedulingMinIntervalMinutes, 10);
      if (isNaN(val) || val < 5 || val > 1440) {
        setError('Minimum Automation Interval must be a whole number between 5 and 1440 minutes');
        return;
      }
      minimal['schedulingMinIntervalMinutes'] = val;
    }
    // FEAT-105 — quota overrides
    const parsePositiveQuota = (raw: string, label: string): number | undefined | { error: string } => {
      if (!raw) return undefined;
      const n = parseInt(raw, 10);
      if (isNaN(n) || !Number.isInteger(n) || n <= 0) return { error: `${label} must be a positive integer` };
      return n;
    };
    const quotaFields: Array<[keyof typeof minimal, string, string]> = [
      ['maxRunsPerCompanyPerMonth', maxRunsPerCompanyPerMonth, 'Max schedule runs / company / month'],
      ['maxRunsPerUserPerMonth', maxRunsPerUserPerMonth, 'Max schedule runs / user / month'],
      ['maxTriggerRunsPerCompanyPerMonth', maxTriggerRunsPerCompanyPerMonth, 'Max trigger runs / company / month'],
      ['maxTriggerRunsPerUserPerMonth', maxTriggerRunsPerUserPerMonth, 'Max trigger runs / user / month'],
      [
        'maxConcurrentActiveSchedulesPerCompany',
        maxConcurrentActiveSchedulesPerCompany,
        'Max concurrent active automations / company',
      ],
      [
        'maxConcurrentActiveSchedulesPerUser',
        maxConcurrentActiveSchedulesPerUser,
        'Max concurrent active automations / user',
      ],
    ];
    for (const [key, raw, label] of quotaFields) {
      const result = parsePositiveQuota(raw, label);
      if (result && typeof result === 'object' && 'error' in result) {
        setError(result.error);
        return;
      }
      if (typeof result === 'number') minimal[key] = result;
    }
    if (requireApprovalAboveUserCap != null) {
      minimal['requireApprovalAboveUserCap'] = requireApprovalAboveUserCap;
    }
    if (mfa) minimal['mfa'] = true;
    if (brandingProviderEnabled !== defaults.brandingProviderEnabled)
      minimal['brandingProviderEnabled'] = brandingProviderEnabled;
    if (!numaWorkspaceChat) minimal['numaWorkspaceChat'] = false;
    if (useGlobalInferenceProfile !== defaults.useGlobalInferenceProfile)
      minimal['useGlobalInferenceProfile'] = useGlobalInferenceProfile;
    if (workspaceChatModelSelection) minimal['workspaceChatModelSelection'] = true;
    if (numaOps) minimal['numaOps'] = true;
    if (numaDropZones !== defaults.numaDropZones) minimal['numaDropZones'] = numaDropZones;
    if (numaSharing !== defaults.numaSharing) minimal['numaSharing'] = numaSharing;
    if (showCredits) minimal['showCredits'] = true;
    if (numaVoice) {
      minimal['numaVoice'] = true;
      if (connectAutoProvision) minimal['connectAutoProvision'] = true;
      if (connectClaimDid) minimal['connectClaimDid'] = true;
      if (voiceLiveAssist) minimal['voiceLiveAssist'] = true;
      if (connectInstanceUrl.trim()) minimal['connectInstanceUrl'] = connectInstanceUrl.trim();
    }
    if (ssoEnabled !== defaults.ssoEnabled) minimal['ssoEnabled'] = ssoEnabled;
    if (ssoEnterprise !== defaults.ssoEnterprise) minimal['ssoEnterprise'] = ssoEnterprise;
    if (developerMode !== defaults.developerMode) minimal['developerMode'] = developerMode;
    if (oauthIntegrationsEnabled !== defaults.oauthIntegrationsEnabled)
      minimal['oauthIntegrationsEnabled'] = oauthIntegrationsEnabled;
    if (v2Apps) minimal['v2Apps'] = true;
    if (agentCoreRegion && agentCoreRegion !== region) minimal['agentCoreRegion'] = agentCoreRegion;

    // Always include these two fields so defaults are written explicitly
    minimal['provisionQResources'] = provisionQResources;
    minimal['preferredKnowledgeBase'] = preferredKnowledgeBase;

    // groups if provided and advanced mode is enabled
    const admin = stringToFeatures(groupAdmin);
    const standard = stringToFeatures(groupStandard);
    if (showAdvanced && (admin.length || standard.length)) {
      minimal['groups'] = {
        ...(standard.length ? { standard } : {}),
        ...(admin.length ? { admin } : {}),
      };
    }
    setPendingConfig(minimal as ClientConfig);
    setShowPreview(true);
  };

  return (
    <div>
      {/* Client Identity - always visible above tabs */}
      <Card className="border-0 shadow-sm mb-3">
        <Card.Header>
          <h5 className="mb-0">Create Client Config</h5>
          <p className="text-muted small mb-0 mt-2">
            Create a new client configuration. All fields show defaults and are ready to deploy immediately. For
            advanced features like data sources or custom domains, contact a developer.
          </p>
        </Card.Header>
        <Card.Body>
          <Row>
            <Col md={6}>
              <Form.Group>
                <Form.Label className="fw-semibold">
                  Client Name <span className="text-danger">*</span>
                </Form.Label>
                <Form.Control
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="e.g. arcanum-demo"
                  className={clientNameError ? 'border-danger' : clientName ? 'border-success' : ''}
                  isInvalid={!!clientNameError}
                />
                {clientNameError ? (
                  <>
                    <Form.Control.Feedback type="invalid">{clientNameError}</Form.Control.Feedback>
                    {sanitizeClientName(clientName) && sanitizeClientName(clientName) !== clientName && (
                      <Form.Text className="text-info">
                        Suggested: <strong>{sanitizeClientName(clientName)}</strong>
                      </Form.Text>
                    )}
                  </>
                ) : (
                  <Form.Text className="text-muted">Unique identifier for this client deployment</Form.Text>
                )}
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label className="fw-semibold">
                  Account ID <span className="text-danger">*</span>
                </Form.Label>
                <Form.Control
                  value={clientAccountId}
                  onChange={(e) => setClientAccountId(e.target.value)}
                  placeholder="12-digit AWS account ID"
                  className={clientAccountId ? 'border-primary' : ''}
                />
                <Form.Text className="text-muted">AWS account where resources will be deployed</Form.Text>
              </Form.Group>
            </Col>
          </Row>
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
                        onChange={setDevInstance}
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
                        defaultValue={true}
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
                              All apps are automatically enabled when 'Deploy All Apps' is selected
                            </Alert>
                          )}
                          {allProdApps && !allApps && (
                            <Alert variant="info" className="py-2 px-3 mb-2 small">
                              All production apps are automatically enabled when 'All Production Apps' is selected
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
                        label="Use Global Bedrock Inference Profile"
                        value={useGlobalInferenceProfile}
                        defaultValue={defaults.useGlobalInferenceProfile}
                        onChange={setUseGlobalInferenceProfile}
                        type="switch"
                        helpText="On (default): route Sonnet/Opus 4.5+ via the global.* Bedrock inference profile, avoiding the 10% per-token regional CRI premium. Off: stay on us./au./apac.* — required for customers whose parent-org SCPs deny the global route."
                      />
                      <ConfigField
                        label="Agent Scheduling"
                        value={scheduling}
                        defaultValue={defaults.scheduling}
                        onChange={setScheduling}
                        type="switch"
                        helpText="Enable agent scheduling and notifications features"
                      />
                      <ConfigField
                        label="Scheduling Min Interval (minutes)"
                        value={schedulingMinIntervalMinutes}
                        defaultValue=""
                        onChange={setSchedulingMinIntervalMinutes}
                        type="text"
                        placeholder="Leave empty to use global default"
                        helpText="Override minimum scheduling interval for this client (minutes, min 5). Leave empty to inherit global default."
                      />
                      <ConfigField
                        label="Workspace Chat Model Selection"
                        value={workspaceChatModelSelection}
                        defaultValue={defaults.workspaceChatModelSelection}
                        onChange={setWorkspaceChatModelSelection}
                        type="switch"
                        helpText="Show the model picker in Workspace Chat. Enables the non-AWS 'Standard' model (Numa Standard Model, billed at lower credits) alongside Premium (Sonnet, default) and Expert (Opus)."
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
                        label="Show Credits"
                        value={showCredits}
                        defaultValue={defaults.showCredits}
                        onChange={setShowCredits}
                        type="switch"
                        helpText="Surface the Credits dashboard (Settings) and the in-chat credit indicator to this client's users. Metering runs regardless; pricing is configured on the Credits page."
                      />
                      <ConfigField
                        label="Numa Voice"
                        value={numaVoice}
                        defaultValue={defaults.numaVoice}
                        onChange={setNumaVoice}
                        type="switch"
                        helpText="Amazon Connect SDR telephony (softphone, recordings, AI call intelligence). Requires Numa Ops."
                      />
                      {numaVoice && (
                        <>
                          <ConfigField
                            label="Connect Auto-Provision"
                            value={connectAutoProvision}
                            defaultValue={defaults.connectAutoProvision}
                            onChange={setConnectAutoProvision}
                            type="switch"
                            helpText="Create the Amazon Connect instance via IaC on first deploy (Phase 2). Off = manually-created instance."
                          />
                          <ConfigField
                            label="Connect Claim DID"
                            value={connectClaimDid}
                            defaultValue={defaults.connectClaimDid}
                            onChange={setConnectClaimDid}
                            type="switch"
                            helpText="Claim a BILLABLE phone number at deploy time (only with auto-provision). Off = claim numbers via the in-app voice admin."
                          />
                          <ConfigField
                            label="Connect Instance URL"
                            value={connectInstanceUrl}
                            defaultValue={''}
                            onChange={setConnectInstanceUrl}
                            type="text"
                            placeholder="https://numa-<client>.my.connect.aws"
                            helpText="Instance access URL — leave blank when auto-provision derives it. Do NOT paste the /ccp-v2 URL."
                          />
                          <ConfigField
                            label="Live Assist (Contact Lens)"
                            value={voiceLiveAssist}
                            defaultValue={defaults.voiceLiveAssist}
                            onChange={setVoiceLiveAssist}
                            type="switch"
                            helpText="Real-time Contact Lens analytics → live in-call SDR assist (suggested objection rebuttals). BILLED per analyzed minute (metered to credits). Off = post-call summary/sentiment only."
                          />
                        </>
                      )}
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
                      below the feature-flag grid for breathing room. Sub-options
                      inherit from the platform-settings record (Level 1) when
                      left empty — that's the sole source of truth, no code-side
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
                    <Button type="submit" disabled={submitting || !!clientNameError} className="px-4">
                      {submitting ? (
                        <>
                          <Spinner size="sm" className="me-2" />
                          Creating...
                        </>
                      ) : (
                        'Create Configuration'
                      )}
                    </Button>
                    <div className="text-muted small">
                      {clientNameError
                        ? 'Fix validation errors to continue'
                        : 'Default values are applied automatically for unspecified settings'}
                    </div>
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

            {/* Developer JSON Create */}
            <Card className="border-0 shadow-sm mt-4">
              <Card.Header>
                <h6 className="mb-0">Create from JSON (Developers)</h6>
                <p className="text-muted small mb-0 mt-2">
                  Upload a full JSON config and create using the Client Name above. Validation is strict and mirrors
                  replace semantics in the CLI.
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
                            setJsonError(err?.message || 'Invalid JSON or schema mismatch');
                          }
                        }}
                      />
                      <Form.Text className="text-muted">
                        Provide a complete JSON config. Unknown fields are not allowed.
                      </Form.Text>
                    </Form.Group>
                  </Col>
                  <Col md={6} className="d-flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={!uploadedConfig || !clientName || !!clientNameError}
                      onClick={() => setShowJsonPreview(true)}
                    >
                      Preview JSON
                    </Button>
                    <Button
                      variant="primary"
                      disabled={!uploadedConfig || !clientName || !!clientNameError || submitting}
                      onClick={async () => {
                        if (!uploadedConfig || !clientName || clientNameError) return;
                        setError(null);
                        try {
                          setSubmitting(true);
                          await clientService.createClientConfig(clientName, uploadedConfig);
                          setSuccess('Client configuration created successfully');
                          setShowJsonPreview(false);
                          setUploadedConfig(null);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Failed to create client config');
                        } finally {
                          setSubmitting(false);
                        }
                      }}
                    >
                      Create From JSON
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
                  Optional. Track trial status, dates, and notes. This data is stored separately from the deployment
                  config and does not affect infrastructure.
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
                        onChange={(date: Date | null) => setTrialEndDate(date ? date.toISOString().split('T')[0] : '')}
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
              </Card.Body>
            </Card>
          </Tab.Pane>

          {/* Tab 3: Quota Check */}
          <Tab.Pane eventKey="quotas">
            {clientAccountId && region ? (
              <QuotaCheckCard accountId={clientAccountId} region={region} disabled={submitting} />
            ) : (
              <Alert variant="info">Enter an Account ID and select a Region above to check Bedrock quotas.</Alert>
            )}
          </Tab.Pane>
        </Tab.Content>
      </Tab.Container>
      <Modal show={showPreview} onHide={() => setShowPreview(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Create</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>
            Please review the configuration to be created for <strong>{clientName || '—'}</strong>:
          </p>
          <pre className="bg-light p-3 rounded" style={{ maxHeight: '50vh', overflow: 'auto' }}>
            {pendingConfig
              ? JSON.stringify(
                  pendingConfig,
                  Object.keys(pendingConfig as Record<string, unknown>)
                    .filter((k) => (pendingConfig as Record<string, unknown>)[k] !== undefined)
                    .sort(),
                  2
                )
              : ''}
          </pre>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowPreview(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={submitting}
            onClick={async () => {
              if (!pendingConfig) return;
              setError(null);
              try {
                setSubmitting(true);
                await clientService.createClientConfig(clientName, pendingConfig);
                if (metaStatus !== 'unclear' || trialStartDate || trialEndDate || metaNotes) {
                  try {
                    await clientMetadataService.saveMetadata({
                      clientName,
                      status: metaStatus,
                      ...(trialStartDate ? { trialStartDate } : {}),
                      ...(trialEndDate ? { trialEndDate } : {}),
                      ...(metaNotes ? { notes: metaNotes } : {}),
                    });
                  } catch (metaErr) {
                    console.error('Failed to save metadata:', metaErr);
                  }
                }
                setSuccess('Client configuration created successfully');
                setShowPreview(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to create client config');
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? (
              <>
                <Spinner size="sm" className="me-2" />
                Creating…
              </>
            ) : (
              'Confirm Create'
            )}
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal show={showJsonPreview} onHide={() => setShowJsonPreview(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>JSON Preview</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>
            Creating configuration for <strong>{clientName || '—'}</strong> with uploaded JSON:
          </p>
          <pre className="bg-light p-3 rounded" style={{ maxHeight: '50vh', overflow: 'auto' }}>
            {uploadedConfig ? JSON.stringify(uploadedConfig, null, 2) : ''}
          </pre>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowJsonPreview(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
