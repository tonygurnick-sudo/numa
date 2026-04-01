export type AgentScope = 'workspace' | 'user';
export type AgentVisibility = 'personal' | 'public';

export type AgentType = 'task' | 'knowledge' | 'scheduled' | string;

export type AgentToolsConfig = {
  autoToolsEnabled?: boolean;
  queryDataSources?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
  memoriesEnabled?: boolean;
  numaOpsEnabled?: boolean;
  dataConnectorsEnabled?: boolean;
  enabledConnections?: string[];
  // Multi-KB support: which knowledge bases the agent can access
  // null/undefined = all KBs (backwards compat with queryDataSources: true)
  // [] = no KB access
  // ['company', 'kb-123'] = specific KBs only
  allowedKnowledgeBases?: string[] | null;
  // Integration approval mode override for this agent
  // undefined = use user's default setting
  // 'always' | 'non_destructive' | 'never'
  approvalMode?: 'always' | 'non_destructive' | 'never';
  // Per-category approval mode overrides for this agent
  // undefined/missing per category = use user's default setting
  approvalModes?: Record<string, 'always' | 'non_destructive' | 'never' | undefined>;
};

export type AgentReferenceFile = {
  fileName: string;
  fileType?: string;
  fileSize?: number;
  s3Key: string;
  s3Bucket: string;
  extractedContentS3Key?: string;
  uploadedAt?: string;
  source?: string;
};

export type AgentSummary = {
  agentId: string;
  scope: AgentScope;
  visibility: AgentVisibility;
  agentType: AgentType;
  title: string;
  description?: string;
  systemPrompt: string;
  userWelcomeMessage?: string;
  // Estimated manual time the agent saves per task, in minutes
  estimatedTimeSavedMinutes?: number;
  icon?: string;
  iconImage?: {
    s3Bucket: string;
    s3Key: string;
  } | null;
  requiredIntegrations: string[];
  toolsConfig: AgentToolsConfig;
  referenceFiles: AgentReferenceFile[];
  createdBy: {
    userId: string;
    name?: string;
  };
  createdAt: number;
  updatedAt: number;
  version: number;
  sourceAgentId?: string;
  isFavorite?: boolean;
  tags: string[];
};

export type AgentListResponse = {
  agents: AgentSummary[];
};

export type AgentResponse = {
  agent: AgentSummary;
};

export type AgentPayload = {
  visibility?: AgentVisibility;
  agentType?: AgentType;
  title: string;
  description?: string;
  systemPrompt: string;
  userWelcomeMessage?: string;
  // Estimated manual time the agent saves per task, in minutes
  estimatedTimeSavedMinutes?: number;
  icon?: string;
  iconImage?: {
    s3Bucket: string;
    s3Key: string;
  } | null;
  requiredIntegrations?: string[];
  toolsConfig?: AgentToolsConfig;
  referenceFiles?: AgentReferenceFile[];
  createdByName?: string;
  tags?: string[];
};

export type AgentUpdatePayload = AgentPayload & {
  isFavorite?: boolean;
  sourceAgentId?: string;
};
