import { z } from 'zod'

// Base app configuration schema
const baseAppConfigSchema = z.object({
  enabled: z.boolean().optional(),
  // Add other app-specific config fields as needed
})

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
})

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
