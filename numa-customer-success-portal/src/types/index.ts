import { z } from 'zod'

// Base app configuration schema (matching userConfigurableBaseNumaAppPropsSchema from infrastructure)
const baseAppConfigSchema = z.object({
  enableJobs: z.boolean().optional(),
  urlPathPrefix: z.string().optional(),
  s3KeyPrefix: z.string().optional(),
  senderEmail: z.string().optional(),
  receiverEmails: z.array(z.string()).optional(),
}).strict()

// Data source configuration schemas
const webCrawlerConfigSchema = z.object({
  url: z.string(),
  maxDepth: z.number().optional(),
  maxPages: z.number().optional(),
}).optional()

const sharePointConfigSchema = z.object({
  siteUrl: z.string(),
  tenantId: z.string(),
}).optional()

const boxConfigSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
}).optional()

const teamsConfigSchema = z.object({
  tenantId: z.string(),
}).optional()

const s3ConfigSchema = z.object({
  bucketName: z.string(),
  prefix: z.string().optional(),
}).optional()

// Complete Client Configuration Schema (matching infrastructure schema)
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

  // Q Business settings
  qBusinessRegion: z.string().optional(), // default: 'us-east-1'
  provisionQResources: z.boolean().optional(), // default: false

  // App deployment settings
  allApps: z.boolean().optional(), // default: false
  allProdApps: z.boolean().optional(), // default: false
  apps: z.record(baseAppConfigSchema).optional(), // default: {}

  // Knowledge base settings
  preferredKnowledgeBase: z.enum(['q', 'bedrock']).optional(),
  embeddingModel: z.string().optional(), // default: 'amazon.titan-embed-text-v2:0'
  bedrockParserModel: z.string().optional(), // default: 'amazon.nova-lite-v1:0'
  visionModelType: z.enum(['haiku', 'nova-pro']).optional(), // default: 'haiku'

  // Communication settings
  senderEmail: z.string().optional(),
  receiverEmails: z.array(z.string()).optional(),
  bedrockAccount: z.string().optional(),

  // Feature flags
  numaChatAgents: z.boolean().optional(), // default: true
  allowBedrockQuotaSharing: z.boolean().optional(), // default: false
  pipedreamIntegrations: z.boolean().optional(), // default: false
  dataConnectorsEnabled: z.boolean().optional(), // default: false
  agents: z.boolean().optional(), // default: false
  brandingProviderEnabled: z.boolean().optional(), // default: false
  numaWorkspaceChat: z.boolean().optional(), // default: false

  // Data source configurations
  webCrawlerConfigs: z.array(webCrawlerConfigSchema).optional(),
  sharePointConfigs: z.array(sharePointConfigSchema).optional(),
  boxConfigs: z.array(boxConfigSchema).optional(),
  teamsConfigs: z.array(teamsConfigSchema).optional(),
  s3Configs: z.array(s3ConfigSchema).optional(),

  // Budget configuration
  budget: z.object({
    name: z.string(),
    limitAmount: z.number(),
    alertThresholds: z.array(z.number()),
  }).optional(),
})

export type ClientConfig = z.infer<typeof clientConfigSchema>

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
  embeddingModel: 'amazon.titan-embed-text-v2:0',
  bedrockParserModel: 'amazon.nova-lite-v1:0',
  visionModelType: 'haiku' as const,
  numaChatAgents: true,
  allowBedrockQuotaSharing: false,
  pipedreamIntegrations: false,
  dataConnectorsEnabled: false,
  agents: false,
  brandingProviderEnabled: false,
  numaWorkspaceChat: false,
  mfa: false,
})

// Helper to check if a config value differs from default
export const isCustomValue = (key: keyof ClientConfig, value: any): boolean => {
  const defaults = getDefaultClientConfigValues()
  const defaultValue = defaults[key as keyof typeof defaults]

  // Special handling for different value types
  if (defaultValue === undefined) {
    return value !== undefined && value !== null && value !== ''
  }

  return value !== defaultValue
}

// Helper to get human-readable field names
export const getFieldDisplayName = (key: keyof ClientConfig): string => {
  const fieldNames: Record<string, string> = {
    clientAccountId: 'Account ID',
    region: 'Region',
    devInstance: 'Development Instance',
    allProdApps: 'All Production Apps',
    apps: 'Selected Applications',
    pipedreamIntegrations: 'Pipedream Integrations',
    dataConnectorsEnabled: 'Data Connectors',
    allowBedrockQuotaSharing: 'Bedrock Quota Sharing',
    preferredKnowledgeBase: 'Knowledge Base Type',
    qBusinessRegion: 'Q Business Region',
    embeddingModel: 'Embedding Model',
    bedrockParserModel: 'Parser Model',
    visionModelType: 'Vision Model Type',
    numaChatAgents: 'Numa Chat Agents',
    agents: 'Agents',
    mfa: 'Multi-Factor Authentication (MFA)',
  }

  return fieldNames[key] || key
}

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
  ]

  return advancedFields.includes(key)
}

// Client with status information
export interface Client {
  name: string
  config: ClientConfig
  status: 'healthy' | 'warning' | 'error' | 'pending'
  lastDeployment?: {
    timestamp: string
    imageTag: string
    status: 'success' | 'failed' | 'running'
    deploymentId: string
  }
  deploymentCount: number
}

// ECR Image Information
export interface ECRImage {
  repository: string
  tag: string
  digest: string
  pushedAt: string
  sizeMb: number
  gitCommit?: string
  gitBranch?: string
  customName?: string
  description?: string
}

export interface DeploymentGroup {
  groupName: string
  clients: string[]
  description?: string
  maxConcurrency?: number
  managed?: boolean
  createdAt?: string
  updatedAt?: string
}

// Deployment Record
export interface DeploymentRecord {
  deploymentId: string
  clientName: string
  imageTag: string
  imageDigest: string
  status: 'pending' | 'running' | 'success' | 'failed'
  progress?: number // 0-100 for running deployments
  initiatedBy: string
  startTime: string
  endTime?: string
  logs?: string[]
  error?: string
  // Mock indicator
  isMock?: boolean
}

// Deployment Statistics
export interface DeploymentStats {
  totalDeployments: number
  successfulDeployments: number
  failedDeployments: number
  averageDeploymentTime: number // in minutes
  deploymentsToday: number
  activeDeployments: number
}

// User Session
export interface UserSession {
  email: string
  name: string
  role: 'admin' | 'customer-success' | 'viewer'
  isAuthenticated: boolean
}
