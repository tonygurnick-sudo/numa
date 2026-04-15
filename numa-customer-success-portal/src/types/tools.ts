export interface Tool {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category: string;
  parameters: ToolParameter[];
}

export interface ToolParameter {
  name: string;
  label: string;
  type: 'text' | 'select' | 'date' | 'number' | 'boolean';
  required: boolean;
  defaultValue?: string | number | boolean;
  options?: { label: string; value: string | number }[];
  placeholder?: string;
  description?: string;
}

export interface ToolExecution {
  id: string;
  toolId: string;
  status: ToolExecutionStatus;
  startedAt: Date;
  completedAt?: Date;
  parameters: Record<string, unknown>;
  progress?: ToolProgress;
  result?: ToolResult;
  error?: string;
}

export type ToolExecutionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ToolProgress {
  current: number;
  total: number;
  message: string;
  details?: string;
}

export interface ToolResult {
  type: 'file' | 'data' | 'message';
  data?: unknown;
  files?: ToolResultFile[];
  message?: string;
}

export interface ToolResultFile {
  name: string;
  content: string | Blob;
  mimeType: string;
  size: number;
}

// Quota Report specific interfaces
export type QuotaType = 'On-demand' | 'Cross-region' | 'Global cross-region';
export type ModelFamily = 'sonnet' | 'opus' | 'haiku' | 'nova';
export type QuotaMetric = 'requests-per-minute' | 'tokens-per-minute' | 'requests-per-day' | 'tokens-per-day';

export interface QuotaDescriptor {
  QuotaCode: string;
  QuotaName: string;
  Model: string;
  Type: QuotaType;
  Metric: QuotaMetric;
  InferenceProfile?: string; // e.g., 'US', 'Global', 'APAC' - to distinguish regional quotas
  isPriority?: boolean; // True for Claude 4.5, 4.6+ models
}

export interface QuotaReportRow {
  accountName: string;
  stackNames?: string[]; // For dev accounts sharing AWS account, list stack names
  accountId: string;
  region: string;
  isDev: boolean;
  bedrockAccount?: string; // Cross-account quota sharing target
  values: Record<string /* QuotaCode */, number | null>;
}

export interface QuotaReportParameters {
  clientScope: 'all' | 'selected' | 'arcanum-internal';
  clients?: string[];
  regionMode: 'client-region' | 'all-regions'; // Use client's region or query all
  modelFamilies: ModelFamily[];
  quotaMetrics: QuotaMetric[];
  advancedFilter?: string;
  types: QuotaType[];
  output: 'table+csv' | 'csv';
}

export interface QuotaReportResult {
  metadata: {
    runAt: string;
    totalClients: number;
    processedAccounts: number;
    modelFamilies: ModelFamily[];
    quotaMetrics: QuotaMetric[];
    advancedFilter?: string;
    types: QuotaType[];
  };
  quotas: QuotaDescriptor[];
  rows: QuotaReportRow[];
  message?: string;
}

// Client metadata fields included in usage report records for filtering/analysis
interface ClientMetadataFields {
  clientStatus?: string;
  clientTrialStart?: string;
  clientTrialEnd?: string;
  clientNotes?: string;
}

// Usage Report specific interfaces
export interface AppRunRecord extends ClientMetadataFields {
  clientName: string;
  userId: string;
  userEmail?: string;
  appId: string;
  appName: string;
  month: string;
  jobId: string;
  startedAt: string;
  status: string;
}

export interface ChatMessageRecord extends ClientMetadataFields {
  clientName: string;
  userId: string;
  userEmail?: string;
  month: string;
  conversationId: string;
  messageType: string;
  role: string;
  timestamp: string;
  toolName?: string;
  toolType?: string;
  agentId?: string;
  agentTitle?: string;
  agentType?: string;
  agentVersion?: number;
  agentVisibility?: string;
  isAgentConversation?: boolean;
  isScheduledRun?: boolean;
  scheduleId?: string;
}

export interface UsageSummary extends ClientMetadataFields {
  clientName: string;
  userId: string;
  userEmail?: string;
  month: string;
  appRuns: number;
  chatMessages: number;
  appRunsByApp: Record<string, number>;
  chatMessagesByType: Record<string, number>;
}

export type UsageReportType =
  | 'summary'
  | 'app-runs'
  | 'chat-messages'
  | 'agents'
  | 'agent-usage'
  | 'scheduled-agent-usage'
  | 'integrations'
  | 'integration-chat-usage'
  | 'agent-integration-usage'
  | 'knowledge-bases';

export interface KnowledgeBaseRecord extends ClientMetadataFields {
  clientName: string;
  kbType: 'bedrock' | 'q-business' | 'unknown';
  name: string;
  kbId?: string;
  bucket?: string;
  prefix?: string;
  fileCount: number;
  scope: 'company' | 'user';
  createdBy?: string;
  isDefault?: boolean;
  isShared?: boolean;
  isPublic?: boolean;
  notes?: string;
}

export interface AgentRecord extends ClientMetadataFields {
  clientName: string;
  agentId: string;
  agentName: string;
  visibility: string;
  agentType?: string;
  createdBy: string;
  createdByEmail?: string;
  createdAt?: string;
  scope: 'workspace' | 'user';
}

export interface AgentUsageRecord extends ClientMetadataFields {
  clientName: string;
  agentId: string;
  agentName: string;
  userId: string;
  userEmail?: string;
  month: string;
  conversationCount: number;
  visibility?: string;
  agentType?: string;
}

export interface IntegrationRecord extends ClientMetadataFields {
  clientName: string;
  integration: string;
  status: string;
  denyTools?: string[];
  updatedAt?: string;
  updatedBy?: string;
  raw?: Record<string, unknown>;
}

export interface IntegrationChatUsageRecord extends ClientMetadataFields {
  clientName: string;
  integration: string;
  userId: string;
  userEmail?: string;
  conversationId: string;
  month: string;
  toolName?: string;
}

export interface AgentIntegrationUsageRecord extends ClientMetadataFields {
  clientName: string;
  integration: string;
  userId: string;
  userEmail?: string;
  agentId?: string;
  agentName?: string;
  conversationId: string;
  month: string;
  toolName?: string;
}

// Cost Analytics specific interfaces
export interface CostAnalyticsParameters {
  clientNames: string[];
  timePeriod: string; // 'last-1-month', 'last-3-months', 'last-6-months', 'current-year', 'custom'
  customStartDate?: string;
  customEndDate?: string;
  granularity: 'DAILY' | 'MONTHLY';
  includeForecast: boolean;
  outputFormat: 'csv' | 'json';
}

export interface CostRecord extends ClientMetadataFields {
  clientName: string;
  period: string;
  service: string;
  unblendedCost: number;
  currency: string;
}

export interface CostSummaryRecord extends ClientMetadataFields {
  clientName: string;
  period: string;
  totalCost: number;
  forecastedCost?: number;
  costChange?: number;
  costChangePercent?: number;
  currency: string;
  topServices: { service: string; cost: number }[];
}

export interface CostAnalyticsResult {
  metadata: {
    clientNames: string[];
    startDate: string;
    endDate: string;
    granularity: 'DAILY' | 'MONTHLY';
    exportDate: string;
    clientsProcessed: number;
    clientsFailed: number;
    totalCost: number;
    currency: string;
  };
  summary: CostSummaryRecord[];
  serviceBreakdown: CostRecord[];
  failedClients?: { clientName: string; error: string }[];
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
  period: string;
  displayName: string;
}

export interface UsageReportParameters {
  clientNames: string[]; // Support multiple clients, empty = all clients
  timePeriod: string; // 'current-year', 'previous-month', 'YYYY', 'YYYY-MM'
  customStartDate?: string;
  customEndDate?: string;
  timeGranularity?: 'month' | 'day';
  outputFormat: 'csv' | 'json';
  reports: UsageReportType[];
}

// All Users Report specific interfaces
export interface UserRecord {
  clientName: string;
  email: string;
  username: string;
  userType: 'admin' | 'user';
  status: string;
  enabled: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface AllUsersReportParameters {
  clientNames: string[]; // Empty = all clients
  userTypeFilter: 'all' | 'admin' | 'user';
  outputFormat: 'csv' | 'json';
  includeLastLogin?: boolean; // Expensive query - calls AdminListUserAuthEvents for each user
}

export interface AllUsersReportResult {
  metadata: {
    clientNames: string[];
    exportDate: string;
    totalUsers: number;
    adminUsers: number;
    regularUsers: number;
    clientsProcessed: number;
    clientsFailed: number;
  };
  users: UserRecord[];
  failedClients?: { clientName: string; error: string }[];
  message?: string;
}

export interface UsageReportResult {
  metadata: {
    clientNames: string[]; // Changed to array for multi-client
    period: string;
    displayName: string;
    timeGranularity?: 'month' | 'day';
    exportDate: string;
    clientsProcessed: number;
    clientsFailed: number;
    selectedReports: UsageReportType[];
    totalAppRuns?: number;
    totalChatMessages?: number;
    uniqueUsers?: number;
    totalAgents?: number;
    totalAgentUsage?: number;
    uniqueAgentUsers?: number;
    agentConversationCount?: number;
    scheduledAgentConversationCount?: number;
    totalIntegrations?: number;
    totalIntegrationChats?: number;
    totalAgentIntegrationRuns?: number;
    totalKnowledgeBases?: number;
    totalKnowledgeBaseFiles?: number;
  };
  appRuns?: AppRunRecord[];
  chatMessages?: ChatMessageRecord[];
  summary?: UsageSummary[];
  agents?: AgentRecord[];
  agentUsage?: AgentUsageRecord[];
  scheduledAgentUsage?: AgentUsageRecord[];
  integrations?: IntegrationRecord[];
  integrationChatUsage?: IntegrationChatUsageRecord[];
  agentIntegrationUsage?: AgentIntegrationUsageRecord[];
  knowledgeBases?: KnowledgeBaseRecord[];
  failedClients?: { clientName: string; error: string }[]; // Track failures
  message?: string; // Optional message for when no data is found
}
