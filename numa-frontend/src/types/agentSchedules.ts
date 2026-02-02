export type ScheduledRunConfig = {
  systemPrompt?: string;
  modelId?: string;
  enabledTools?: string[];
  enabledConnections?: string[];
  enabledKBIds?: string[];
  autoToolsEnabled?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
};

export type AgentSchedule = {
  scheduleId: string;
  conversationId: string;
  promptText: string;
  cronExpression: string;
  timezone: string;
  status: 'active' | 'paused' | 'deleted';
  eventType?: 'agent' | 'application' | 'data_sync';
  label?: string;
  agentId: string;
  agentTitle?: string;
  createdAt?: number;
  updatedAt?: number;
  lastRunEpoch?: number;
  lastStatus?: string;
  lastError?: string;
  lastRunConversationId?: string;
  lastRunS3Key?: string;
  runConfig?: ScheduledRunConfig;
};

import type { AgentToolsConfig } from './agents';

export type AgentScheduleSnapshot = {
  agentId?: string;
  title?: string;
  icon?: string;
  iconImage?: { s3Bucket: string; s3Key: string } | null;
  version?: number;
  visibility?: string;
  systemPrompt?: string;
  userWelcomeMessage?: string;
  requiredIntegrations?: string[];
  toolsConfig?: AgentToolsConfig;
};

export type CreateAgentSchedulePayload = {
  agentId: string;
  agentTitle?: string;
  conversationId: string;
  promptText: string;
  cronExpression: string;
  timezone: string;
  label?: string;
  runConfig?: ScheduledRunConfig;
  agentSnapshot?: AgentScheduleSnapshot;
};

export type UpdateAgentSchedulePayload = {
  promptText?: string;
  cronExpression?: string;
  timezone?: string;
  label?: string;
  status?: 'active' | 'paused' | 'deleted';
  runConfig?: ScheduledRunConfig;
};
