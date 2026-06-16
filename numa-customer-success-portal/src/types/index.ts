import { z } from 'zod';

// Base app configuration schema (matching userConfigurableBaseNumaAppPropsSchema from infrastructure)
const baseAppConfigSchema = z
  .object({
    enableJobs: z.boolean().optional(),
    urlPathPrefix: z.string().optional(),
    s3KeyPrefix: z.string().optional(),
    senderEmail: z.string().optional(),
    receiverEmails: z.array(z.string()).optional(),
  })
  .strict();

// Data source configuration schemas
const webCrawlerConfigSchema = z
  .object({
    url: z.string(),
    maxDepth: z.number().optional(),
    maxPages: z.number().optional(),
  })
  .optional();

const sharePointConfigSchema = z
  .object({
    siteUrl: z.string(),
    tenantId: z.string(),
  })
  .optional();

const boxConfigSchema = z
  .object({
    clientId: z.string(),
    clientSecret: z.string(),
  })
  .optional();

const teamsConfigSchema = z
  .object({
    tenantId: z.string(),
  })
  .optional();

const s3ConfigSchema = z
  .object({
    bucketName: z.string(),
    prefix: z.string().optional(),
  })
  .optional();

const oauthProviderSchema = z.object({
  enabled: z.boolean(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  scopes: z.array(z.string()),
});

// Complete Client Configuration Schema (matching infrastructure schema in
// infra/stacks/numa-client-stack.ts and infra/constructs/core-numa-infra-construct.ts).
// Keep in sync — JSON upload validates with .strict() and rejects unknown fields.
export const clientConfigSchema = z.object({
  // Core required fields
  clientAccountId: z.string(),
  region: z.string(),

  // Infrastructure settings
  enableIFrame: z.boolean().optional(), // default: false
  indexType: z.enum(['ENTERPRISE', 'STARTER']).optional(),
  indexUnits: z.number().optional(),
  loadSampleFile: z.boolean().optional(),
  createServiceLinkedRole: z.boolean().optional(),
  temporaryPasswordValidityDays: z.number().optional(),
  passwordLength: z.number().optional(),
  mfa: z.boolean().optional(),

  // Development settings
  devInstance: z.boolean().optional(), // default: false
  customDomain: z.string().optional(),
  emailDomain: z.string().optional(),

  // Q Business settings
  qBusinessRegion: z.string().optional(), // default: 'us-east-1'
  provisionQResources: z.boolean().optional(), // default: false
  enableDirectLLMAccess: z.boolean().optional(), // default: true — Q "allow end users to send queries directly to the LLM"
  enableLLMKnowledgeFallback: z.boolean().optional(), // default: true — Q "allow fall back to LLM knowledge"

  // App deployment settings
  allApps: z.boolean().optional(), // default: false
  allProdApps: z.boolean().optional(), // default: false
  apps: z.record(baseAppConfigSchema).optional(), // default: {}
  jobHistory: z.boolean().optional(), // default: true (when allApps is enabled)

  // Knowledge base settings
  preferredKnowledgeBase: z.enum(['q', 'bedrock', 'none']).optional(),
  vectorStorageType: z.enum(['rds', 's3vectors']).optional(), // default: 's3vectors'
  embeddingModel: z.string().optional(), // default: 'amazon.titan-embed-text-v2:0'
  bedrockParserModel: z.string().optional(), // default: 'amazon.nova-lite-v1:0'
  visionModelType: z.enum(['haiku', 'nova-pro']).optional(), // default: 'haiku'
  knowledgeBases: z.boolean().optional(), // default: true
  recordsKBEnabled: z.boolean().optional(),
  contentSearchEnabled: z.boolean().optional(),

  // Communication settings
  senderEmail: z.string().optional(),
  receiverEmails: z.array(z.string()).optional(),
  bedrockAccount: z.string().optional(),

  // Feature flags
  numaChatAgents: z.boolean().optional(), // default: true
  allowBedrockQuotaSharing: z.boolean().optional(), // default: false
  pipedreamIntegrations: z.boolean().optional(), // default: false
  dataConnectorsEnabled: z.boolean().optional(), // default: false
  synergyFileParity: z.boolean().optional(), // default: false — Synergy 12d file-interface parity (sub-flag of data connectors)
  agents: z.boolean().optional(), // default: false
  brandingProviderEnabled: z.boolean().optional(), // default: false
  brandingAssetsBucketArn: z.string().optional(),
  brandingAssetsPrefix: z.string().optional(),
  numaWorkspaceChat: z.boolean().optional(), // default: true
  agentCoreRegion: z.string().optional(), // default: client region
  useGlobalInferenceProfile: z.boolean().optional(), // default: true (global Bedrock CRI; false routes to regional us./au./apac.* for tight-SCP customers)
  scheduling: z.boolean().optional(), // default: false
  /**
   * Sub-flag of `scheduling`. When `scheduling: true` and `eventTriggers: false`,
   * cron schedules work but event triggers (Gmail-message etc.) are hidden
   * from the user-facing automation builder, the admin Settings >
   * Scheduling page, and trigger-quota fields here in the CSP.
   *
   * Default `false` — new clients must opt in via the CSP form. Existing
   * clients that had scheduling on at the time this flag landed were
   * backfilled to `true` via `tools/backfill-triggers-flag.ts`. Has no effect
   * when `scheduling: false`.
   */
  eventTriggers: z.boolean().optional(),
  schedulingMinIntervalMinutes: z.number().int().min(5).optional(), // per-client min interval override
  // Per-client quota overrides (Level 2). Unset → fall back to platform-settings (Level 1).
  // 0 is a valid value for caps — means "0 allowed" (a way to disable a quota target).
  maxRunsPerCompanyPerMonth: z.number().int().min(0).optional(),
  maxRunsPerUserPerMonth: z.number().int().min(0).optional(),
  maxTriggerRunsPerCompanyPerMonth: z.number().int().min(0).optional(),
  maxTriggerRunsPerUserPerMonth: z.number().int().min(0).optional(),
  maxConcurrentActiveSchedulesPerCompany: z.number().int().min(0).optional(),
  maxConcurrentActiveSchedulesPerUser: z.number().int().min(0).optional(),
  requireApprovalAboveUserCap: z.boolean().optional(),
  workspaceChatModelSelection: z.boolean().optional(), // default: false
  numaOps: z.boolean().optional(), // default: false
  numaDropZones: z.boolean().optional(), // default: false
  numaSharing: z.boolean().optional(), // default: false
  developerMode: z.boolean().optional(), // default: false
  // @deprecated TASK-146 — vault now follows `dataConnectorsEnabled`. Kept on
  // the schema so legacy DynamoDB items with this field still parse.
  secretsVaultEnabled: z.boolean().optional(),
  oauthIntegrationsEnabled: z.boolean().optional(), // default: false
  oauthProviders: z.record(z.string(), oauthProviderSchema).optional(),
  ssoEnabled: z.boolean().optional(), // default: true
  ssoEnterprise: z.boolean().optional(), // default: false
  chatSuggestions: z.boolean().optional(), // default: true (capability availability)
  siteWideSearch: z.boolean().optional(), // default: false
  racetechDataFeed: z.boolean().optional(), // default: false
  disasterRecovery: z.boolean().optional(), // default: false

  // Numa Voice (Amazon Connect SDR telephony) — kept in sync with the infra
  // schema in numa-client-stack.ts. recordingsBucket/didNumbers are written
  // back at runtime by numa-voice-config-writer; without them here the portal
  // rejects any voice-enabled client config with unrecognized_keys.
  numaVoice: z.boolean().optional(), // default: false
  connectAutoProvision: z.boolean().optional(), // default: false
  connectClaimDid: z.boolean().optional(), // default: false
  connectInstanceUrl: z.string().optional(),
  recordingsBucket: z.string().optional(),
  didNumbers: z.array(z.string()).optional(),
  voiceCallPrepTime: z
    .string()
    .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "voiceCallPrepTime must be 'HH:MM' 24-hour")
    .optional(), // morning call-list run (default 07:30) — same regex as the infra schema so bad input is rejected here, not at synth
  voiceCallPrepTimezone: z.string().optional(), // IANA tz (default Pacific/Auckland)
  voiceLiveAssist: z.boolean().optional(), // default: false — realtime Contact Lens live assist (billed/min)
  enableOpenApiDocs: z.boolean().optional(), // default: false
  v2Apps: z.boolean().optional(), // default: false
  publicDemo: z.boolean().optional(), // default: false
  publicDemoDailyLimitUsd: z.number().optional(), // default: 10

  // Numa Files
  numaFiles: z.boolean().optional(),

  // Numa Voice (Amazon Connect — FEAT-158/169). connectInstanceUrl, recordingsBucket and
  // didNumbers are written back into the config map by the numa-voice-config-writer Lambda;
  // they must be declared here so the .strict() parse in replaceClientConfig doesn't reject
  // a voice-enabled tenant's config on read-back.
  numaVoice: z.boolean().optional(), // default: false
  connectAutoProvision: z.boolean().optional(), // default: false
  connectClaimDid: z.boolean().optional(), // default: false
  connectInstanceUrl: z.string().optional(),
  recordingsBucket: z.string().optional(),
  didNumbers: z.array(z.string()).optional(),

  // Forward-compat / internal — kept so existing DynamoDB items parse under .strict().
  // transcriptionService mirrors the infra `z.any()` forward-compat field; logGroup is an
  // internal infra-only prop (never persisted) included for full schema parity.
  transcriptionService: z.any().optional(),
  logGroup: z.any().optional(),

  // Whitelabel / multi-frontend
  additionalCognitoClientIds: z.string().optional(),
  additionalOrigins: z.array(z.string()).optional(),

  // Cognito group → feature mapping
  groups: z.record(z.string(), z.array(z.string())).optional(),

  // Data source configurations
  webCrawlerConfigs: z.array(webCrawlerConfigSchema).optional(),
  sharePointConfigs: z.array(sharePointConfigSchema).optional(),
  boxConfigs: z.array(boxConfigSchema).optional(),
  teamsConfigs: z.array(teamsConfigSchema).optional(),
  s3Configs: z.array(s3ConfigSchema).optional(),

  // Budget configuration
  budget: z
    .object({
      name: z.string(),
      limitAmount: z.number(),
      alertThresholds: z.array(z.number()),
    })
    .optional(),

  // Numa Credit System (SPK-015). showCredits gates the in-app admin view; creditConfig is the
  // central pricing config authored here and pushed to the client (kept in sync with infra schema).
  showCredits: z.boolean().optional(), // default: false
  creditConfig: z
    .object({
      creditUsd: z.number().positive().optional(),
      margin: z.number().min(1).optional(),
      agentcoreMult: z.number().min(1).optional(),
      trivialConsumptionUsd: z.number().min(0).optional(),
      valueTiers: z.record(z.string(), z.record(z.string(), z.number())).optional(),
      marginsByTier: z.record(z.string(), z.number()).optional(),
      monthlyAllocations: z.array(z.number().min(0)).optional(),
      // Numa Voice consumption rates (USD/min): telephony + transcribe (+ contact lens).
      // The non-LLM cost of a call; metered into the same ledger via numa-voice-credit-debit.
      voiceRates: z
        .object({
          telephonyPerMin: z.number().min(0).optional(),
          transcribePerMin: z.number().min(0).optional(),
          contactLensPerMin: z.number().min(0).optional(),
        })
        .optional(),
    })
    .optional(),
});

export type ClientConfig = z.infer<typeof clientConfigSchema>;
export type CreditConfig = NonNullable<ClientConfig['creditConfig']>;

// Client metadata (non-deployment) — stored in a separate table from client config
export const CLIENT_STATUS_VALUES = ['trial', 'paying', 'partner', 'internal', 'other', 'unclear'] as const;
export type ClientStatusValue = (typeof CLIENT_STATUS_VALUES)[number];

// Which AWS Organization the client's account belongs to.
//   - nextgen: modern Arcanum-owned per-client accounts under the NextGen org (mgmt 282304106064)
//   - arcanum: Arcanum's internal/dev/HQ/quota-sharing org
//   - standalone: customer-owned account, not in either Arcanum-controlled org
export const ACCOUNT_ORG_VALUES = ['nextgen', 'arcanum', 'standalone'] as const;
export type AccountOrgValue = (typeof ACCOUNT_ORG_VALUES)[number];

export const clientMetadataSchema = z.object({
  clientName: z.string(),
  // Optional so the Configs page can seed a minimal row from the deterministic
  // account-id classifier (clientName + accountOrg) for clients that have no
  // metadata yet. Operators fill in status manually from the UI later.
  status: z.enum(CLIENT_STATUS_VALUES).optional(),
  trialStartDate: z.string().optional(),
  trialEndDate: z.string().optional(),
  notes: z.string().optional(),
  accountOrg: z.enum(ACCOUNT_ORG_VALUES).optional(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type ClientMetadata = z.infer<typeof clientMetadataSchema>;

export const CLIENT_STATUS_DISPLAY: Record<ClientStatusValue, { label: string; variant: string }> = {
  trial: { label: 'Trial', variant: 'warning' },
  paying: { label: 'Paying', variant: 'success' },
  partner: { label: 'Partner', variant: 'info' },
  internal: { label: 'Internal', variant: 'primary' },
  other: { label: 'Other', variant: 'secondary' },
  unclear: { label: 'Unclear', variant: 'light' },
};

export const ACCOUNT_ORG_DISPLAY: Record<AccountOrgValue, { label: string; variant: string }> = {
  nextgen: { label: 'NextGen', variant: 'dark' },
  arcanum: { label: 'Arcanum', variant: 'info' },
  standalone: { label: 'Standalone', variant: 'secondary' },
};

export function getStatusBadgeInfo(metadata?: ClientMetadata): { label: string; variant: string } | null {
  if (!metadata || !metadata.status) return null;
  if (metadata.status === 'trial' && metadata.trialEndDate && new Date(metadata.trialEndDate) < new Date()) {
    return { label: 'Trial - Expired', variant: 'danger' };
  }
  return CLIENT_STATUS_DISPLAY[metadata.status];
}

export function getAccountOrgBadgeInfo(org?: AccountOrgValue | null): { label: string; variant: string } | null {
  return org ? ACCOUNT_ORG_DISPLAY[org] : null;
}

// Helper to get default values for display
export const getDefaultClientConfigValues = () => ({
  enableIFrame: false,
  devInstance: false,
  provisionQResources: false,
  allApps: false,
  allProdApps: false,
  apps: {},
  qBusinessRegion: 'us-east-1',
  preferredKnowledgeBase: 'bedrock' as const,
  vectorStorageType: 's3vectors' as const,
  embeddingModel: 'amazon.titan-embed-text-v2:0',
  bedrockParserModel: 'amazon.nova-lite-v1:0',
  visionModelType: 'haiku' as const,
  numaChatAgents: true,
  allowBedrockQuotaSharing: false,
  pipedreamIntegrations: false,
  dataConnectorsEnabled: false,
  agents: false,
  brandingProviderEnabled: false,
  numaWorkspaceChat: true,
  useGlobalInferenceProfile: true,
  scheduling: false,
  // Defaults to false. Existing clients with scheduling already on were
  // backfilled by tools/backfill-triggers-flag.ts so they keep triggers;
  // any new client must explicitly opt in via the Agent Automations form.
  eventTriggers: false,
  workspaceChatModelSelection: false,
  numaOps: false,
  numaDropZones: false,
  numaSharing: false,
  developerMode: false,
  oauthIntegrationsEnabled: false,
  ssoEnabled: true,
  ssoEnterprise: false,
  v2Apps: false,
  publicDemo: false,
  publicDemoDailyLimitUsd: 10,
  mfa: false,
  numaVoice: false,
  connectAutoProvision: false,
  connectClaimDid: false,
  voiceLiveAssist: false,
});

// Helper to check if a config value differs from default
export const isCustomValue = (key: keyof ClientConfig, value: any): boolean => {
  const defaults = getDefaultClientConfigValues();
  const defaultValue = defaults[key as keyof typeof defaults];

  // Special handling for different value types
  if (defaultValue === undefined) {
    return value !== undefined && value !== null && value !== '';
  }

  return value !== defaultValue;
};

// Helper to get human-readable field names
export const getFieldDisplayName = (key: keyof ClientConfig): string => {
  const fieldNames: Record<string, string> = {
    clientAccountId: 'Account ID',
    region: 'Region',
    devInstance: 'Development Instance',
    allProdApps: 'All Production Apps',
    apps: 'Selected Applications',
    pipedreamIntegrations: 'Pipedream Integrations',
    dataConnectorsEnabled: 'Native Integrations',
    allowBedrockQuotaSharing: 'Bedrock Quota Sharing',
    preferredKnowledgeBase: 'Numa Files backend',
    qBusinessRegion: 'Q Business Region',
    embeddingModel: 'Embedding Model',
    bedrockParserModel: 'Parser Model',
    visionModelType: 'Vision Model Type',
    numaChatAgents: 'Numa Chat Agents',
    agents: 'Agents',
    scheduling: 'Agent Automations',
    eventTriggers: 'Event Triggers',
    schedulingMinIntervalMinutes: 'Minimum Automation Interval (minutes)',
    maxRunsPerCompanyPerMonth: 'Max Schedule Runs / Company / Month',
    maxRunsPerUserPerMonth: 'Max Schedule Runs / User / Month',
    maxTriggerRunsPerCompanyPerMonth: 'Max Trigger Runs / Company / Month',
    maxTriggerRunsPerUserPerMonth: 'Max Trigger Runs / User / Month',
    maxConcurrentActiveSchedulesPerCompany: 'Max Concurrent Active Automations / Company',
    maxConcurrentActiveSchedulesPerUser: 'Max Concurrent Active Automations / User',
    requireApprovalAboveUserCap: 'Require Admin Approval Above User Cap',
    v2Apps: 'V2 Apps',
    mfa: 'Multi-Factor Authentication (MFA)',
    numaDropZones: 'Drop Zones',
    numaSharing: 'Sharing',
    ssoEnabled: 'SSO Self-Service',
    ssoEnterprise: 'SSO Enterprise (SCIM/OIDC)',
    developerMode: 'Developer Mode',
    oauthIntegrationsEnabled: 'OAuth Cloud Storage',
    useGlobalInferenceProfile: 'Use Global Bedrock Inference Profile',
  };

  return fieldNames[key] || key;
};

// Helper to identify which fields are considered "advanced"
export const isAdvancedField = (key: keyof ClientConfig): boolean => {
  const advancedFields = [
    'webCrawlerConfigs',
    'sharePointConfigs',
    'boxConfigs',
    'teamsConfigs',
    's3Configs',
    'budget',
    'embeddingModel',
    'bedrockParserModel',
    'visionModelType',
    'customDomain',
    'senderEmail',
    'receiverEmails',
    'bedrockAccount',
    'indexType',
    'indexUnits',
    'loadSampleFile',
    'createServiceLinkedRole',
    'temporaryPasswordValidityDays',
    'passwordLength',
    'mfa',
  ];

  return advancedFields.includes(key);
};

// Client with status information
export interface Client {
  name: string;
  config: ClientConfig;
  status: 'healthy' | 'warning' | 'error' | 'pending';
  lastDeployment?: {
    timestamp: string;
    imageTag: string;
    status: 'success' | 'failed' | 'running';
    deploymentId: string;
  };
  deploymentCount: number;
}

// ECR Image Information
export interface ECRImage {
  repository: string;
  tag: string;
  digest: string;
  pushedAt: string;
  sizeMb: number;
  gitCommit?: string;
  gitBranch?: string;
  customName?: string;
  description?: string;
}

export interface DeploymentGroup {
  groupName: string;
  clients: string[];
  description?: string;
  maxConcurrency?: number;
  managed?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Deployment Record
export interface DeploymentRecord {
  deploymentId: string;
  clientName: string;
  imageTag: string;
  imageDigest: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  progress?: number; // 0-100 for running deployments
  initiatedBy: string;
  startTime: string;
  endTime?: string;
  logs?: string[];
  error?: string;
  // Mock indicator
  isMock?: boolean;
}

// Deployment Statistics
export interface DeploymentStats {
  totalDeployments: number;
  successfulDeployments: number;
  failedDeployments: number;
  averageDeploymentTime: number; // in minutes
  deploymentsToday: number;
  activeDeployments: number;
}

// User Session
export interface UserSession {
  email: string;
  name: string;
  role: 'admin' | 'customer-success' | 'viewer';
  isAuthenticated: boolean;
}
