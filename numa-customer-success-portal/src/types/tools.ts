export interface Tool {
  id: string
  name: string
  description: string
  icon?: string
  category: string
  parameters: ToolParameter[]
}

export interface ToolParameter {
  name: string
  label: string
  type: 'text' | 'select' | 'date' | 'number' | 'boolean'
  required: boolean
  defaultValue?: string | number | boolean
  options?: { label: string; value: string | number }[]
  placeholder?: string
  description?: string
}

export interface ToolExecution {
  id: string
  toolId: string
  status: ToolExecutionStatus
  startedAt: Date
  completedAt?: Date
  parameters: Record<string, unknown>
  progress?: ToolProgress
  result?: ToolResult
  error?: string
}

export type ToolExecutionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ToolProgress {
  current: number
  total: number
  message: string
  details?: string
}

export interface ToolResult {
  type: 'file' | 'data' | 'message'
  data?: unknown
  files?: ToolResultFile[]
  message?: string
}

export interface ToolResultFile {
  name: string
  content: string | Blob
  mimeType: string
  size: number
}

// Quota Report specific interfaces
export type QuotaType = 'On-demand' | 'Cross-region'
export type ModelFamily = 'sonnet' | 'opus' | 'haiku' | 'nova'
export type QuotaMetric = 'requests-per-minute' | 'tokens-per-minute'

export interface QuotaDescriptor {
  QuotaCode: string
  QuotaName: string
  Model: string
  Type: QuotaType
  Metric: QuotaMetric
  InferenceProfile?: string  // e.g., 'US', 'Global', 'APAC' - to distinguish regional quotas
}

export interface QuotaReportRow {
  accountName: string
  stackNames?: string[]  // For dev accounts sharing AWS account, list stack names
  accountId: string
  region: string
  isDev: boolean
  bedrockAccount?: string  // Cross-account quota sharing target
  values: Record<string /* QuotaCode */, number | null>
}

export interface QuotaReportParameters {
  clientScope: 'all' | 'selected' | 'arcanum-internal'
  clients?: string[]
  regionMode: 'client-region' | 'all-regions'  // Use client's region or query all
  modelFamilies: ModelFamily[]
  quotaMetrics: QuotaMetric[]
  advancedFilter?: string
  types: QuotaType[]
  output: 'table+csv' | 'csv'
}

export interface QuotaReportResult {
  metadata: {
    runAt: string
    totalClients: number
    processedAccounts: number
    modelFamilies: ModelFamily[]
    quotaMetrics: QuotaMetric[]
    advancedFilter?: string
    types: QuotaType[]
  }
  quotas: QuotaDescriptor[]
  rows: QuotaReportRow[]
  message?: string
}

// Usage Report specific interfaces
export interface AppRunRecord {
  userId: string
  userEmail?: string
  appId: string
  appName: string
  month: string
  jobId: string
  startedAt: string
  status: string
}

export interface ChatMessageRecord {
  userId: string
  userEmail?: string
  month: string
  conversationId: string
  messageType: string
  role: string
  timestamp: string
}

export interface UsageSummary {
  userId: string
  userEmail?: string
  month: string
  appRuns: number
  chatMessages: number
  appRunsByApp: Record<string, number>
  chatMessagesByType: Record<string, number>
}

export interface DateRange {
  startDate: Date
  endDate: Date
  period: string
  displayName: string
}

export interface UsageReportParameters {
  clientName: string
  timePeriod: string // 'current-year', 'previous-month', 'YYYY', 'YYYY-MM'
  outputFormat: 'csv' | 'json'
}

export interface UsageReportResult {
  metadata: {
    clientName: string
    period: string
    displayName: string
    exportDate: string
    totalAppRuns: number
    totalChatMessages: number
    uniqueUsers: number
  }
  appRuns: AppRunRecord[]
  chatMessages: ChatMessageRecord[]
  summary: UsageSummary[]
  message?: string // Optional message for when no data is found
}
