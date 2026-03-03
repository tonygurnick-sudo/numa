/**
 * Shared types for the Numa CLI.
 * Strictly typed - no `any` allowed.
 */

import { z } from 'zod';

/**
 * Category of an AWS profile based on its role ARN pattern.
 */
export type ProfileCategory = 'deployer' | 'client' | 'org' | 'demo' | 'management' | 'unknown';

/**
 * Metadata for a discovered AWS profile.
 */
export interface ProfileMetadata {
  category: ProfileCategory;
  accountId?: string;
  region?: string;
  roleArn?: string;
  sourceProfile?: string;
  ssoAccountId?: string;
}

/**
 * Roles configuration stored in .numa/config.json.
 */
export interface RolesConfig {
  /** Active deployer profile name (used for DynamoDB client-config access) */
  deployer?: string;
  /** Active client profile name (used for client account operations) */
  activeProfile?: string;
  /** All discovered profiles with metadata */
  profiles: Record<string, ProfileMetadata>;
  /** ISO timestamp of last scan */
  lastScanned?: string;
}

/**
 * Known deployer AWS account IDs.
 */
export const DEPLOYER_ACCOUNT_IDS = ['207567759910', '324037291751'] as const;

/**
 * Environment configuration stored in .numa/config.json
 */
export interface NumaConfig {
  currentEnv?: string;
  environments: Record<string, EnvironmentConfig>;
  roles?: RolesConfig;
}

/**
 * Cognito configuration for an environment.
 */
export interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  region: string;
}

/**
 * Configuration for a single environment.
 */
export interface EnvironmentConfig {
  clientName: string;
  clientAccountId: string;
  region: string;
  awsProfile?: string;
  cognito?: CognitoConfig;
}

/**
 * Client configuration schema (simplified from infra).
 */
export const clientConfigSchema = z.object({
  clientAccountId: z.string(),
  region: z.string(),
  createServiceLinkedRole: z.boolean().optional(),
  devInstance: z.boolean().optional(),
  provisionQResources: z.boolean().optional(),
  preferredKnowledgeBase: z.enum(['q', 'bedrock', 'none']).optional(),
  allowBedrockQuotaSharing: z.boolean().optional(),
  allApps: z.boolean().optional(),
  allProdApps: z.boolean().optional(),
  apps: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  pipedreamIntegrations: z.boolean().optional(),
  vectorStorageType: z.enum(['opensearch', 's3vectors']).optional(),
  agents: z.boolean().optional(),
  brandingProviderEnabled: z.boolean().optional(),
  bedrockAccount: z.string().optional(),
  numaWorkspaceChat: z.boolean().optional(),
  agentCoreRegion: z.string().optional(),
  dataConnectorsEnabled: z.boolean().optional(),
  scheduling: z.boolean().optional(),
  budget: z.object({
    name: z.string(),
    limitAmount: z.number(),
    alertThresholds: z.array(z.number()),
  }).optional(),
});

export type ClientConfig = z.infer<typeof clientConfigSchema>;

/**
 * Options for creating a shared document.
 */
export interface CreateSharedDocumentOptions {
  prompt: string;
  expires: number;
  maxCalls?: number;
}

/**
 * Result of creating a shared document.
 */
export interface CreateSharedDocumentResult {
  uuid: string;
  expiresAt: string;
  localUrl: string;
  productionUrl: string;
}

/**
 * Content type mappings for file extensions.
 */
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
} as const;

/**
 * Default system prompt for shared documents.
 */
export const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant. Answer questions about this document accurately and concisely.';

/**
 * Default expiry in hours (7 days).
 */
export const DEFAULT_EXPIRY_HOURS = 168;

/**
 * Default AWS region.
 */
export const DEFAULT_REGION = 'us-east-1';

/**
 * Default AWS profile for deployer account.
 */
export const DEFAULT_AWS_PROFILE = 'arcanum-q-deployer-prod';

/**
 * Default domain suffix for client environments.
 * Client domains follow the pattern: <clientName>.<DOMAIN_SUFFIX>
 */
export const DOMAIN_SUFFIX = 'numa.arcanum.ai';
