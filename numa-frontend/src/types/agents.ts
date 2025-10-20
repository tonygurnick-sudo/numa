export type AgentScope = 'workspace' | 'user';
export type AgentVisibility = 'personal' | 'public';

export type AgentType = 'task' | 'knowledge' | 'scheduled' | string;

export type AgentToolsConfig = {
  autoToolsEnabled?: boolean;
  queryDataSources?: boolean;
  webSearchEnabled?: boolean;
  enabledConnections?: string[];
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
};

export type AgentUpdatePayload = AgentPayload & {
  isFavorite?: boolean;
  sourceAgentId?: string;
};
