import type { IntegrationListItem } from './workspaceChatTypes';

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
  /** Legacy whole-feature toggle for native data connectors. Replaced by
   *  per-integration enable in `enabledConnections` / the unified
   *  Integrations list. Kept on the type so we can read existing DDB
   *  records without TS errors; new agents don't write it. */
  dataConnectorsEnabled?: boolean;
  /** @deprecated Pre-FEAT-143 flat slug list (Pipedream-canonical). Method
   *  ambiguous for dual-method services (Gmail, Google Drive). New agents
   *  write `enabledIntegrations` instead; legacy reads still fall back here. */
  enabledConnections?: string[];
  /** Unified, method-tagged integrations list. Single source of truth for
   *  what the agent has access to — Pipedream and native rows live side by
   *  side. The chat-page state and wire payload both derive from this. */
  enabledIntegrations?: IntegrationListItem[];
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

// ─── Per-user preferences ────────────────────────────────────────────────────

export type AgentUserPref = {
  agentId: string;
  isFavorite: boolean;
  isHidden: boolean;
};

// ─── Teams ───────────────────────────────────────────────────────────────────

export type TeamRole = 'owner' | 'editor' | 'viewer';

export type Team = {
  teamId: string;
  teamName: string;
  description?: string;
  myRole: TeamRole;
  createdBy: string;
  createdAt: number;
};

export type TeamMember = {
  userId: string;
  role: TeamRole;
  userName?: string;
  userEmail?: string;
  addedAt: number;
};

export type TeamDetail = Team & {
  members: TeamMember[];
};

// ─── Sharing ─────────────────────────────────────────────────────────────────

export type ShareRole = 'co-owner' | 'editor' | 'viewer';

export type AgentShare = {
  principalId: string;
  principalType: 'user' | 'team';
  role: ShareRole;
  sharedBy: string;
  sharedAt: number;
};

// ─── Admin ───────────────────────────────────────────────────────────────────

export type AdminAgentEntry = {
  agentId: string;
  title: string;
  scope: AgentScope;
  visibility: AgentVisibility;
  owner: { userId: string; name?: string };
  updatedAt: number;
  tags: string[];
};
