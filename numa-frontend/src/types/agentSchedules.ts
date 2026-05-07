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

export type EmailFilterField = 'sender' | 'subject' | 'to' | 'body' | 'has_attachment';
export type EmailFilterOp = 'contains' | 'equals' | 'not_contains' | 'matches';
export type EmailFilter = { field: EmailFilterField; op: EmailFilterOp; value: string };

export type GmailEventTrigger = {
  source: 'gmail';
  event: 'message.received';
  filters: EmailFilter[];
  filter_logic?: 'all' | 'any';
  include_email_context?: boolean;
};

// Pipedream-backed event trigger. The `configured_props` blob is opaque to Numa —
// validated against Pipedream's component schema at deploy time. `deployed_trigger_id`
// (dc_xxx) and `webhook_signing_key` are populated server-side after the deploy call.
//
// `configured_prop_labels` is a snapshot of human-readable labels for prop values
// captured at save-time from the wizard (e.g. channel ID → channel name). Optional
// for backwards compatibility — legacy schedules render raw values.
export type PipedreamEventTrigger = {
  source: 'pipedream';
  app_slug: string;
  component_id: string;
  component_version?: string;
  configured_props: Record<string, unknown>;
  configured_prop_labels?: Record<string, Record<string, string>>;
  deployed_trigger_id?: string;
  webhook_signing_key?: string;
  include_event_context?: boolean;
};

export type EventTrigger = GmailEventTrigger | PipedreamEventTrigger;

export type AgentSchedule = {
  scheduleId: string;
  conversationId: string;
  promptText: string;
  triggerType?: 'cron' | 'event';
  trigger?: EventTrigger;
  cronExpression?: string;
  timezone?: string;
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
  maxRuns?: number;
  totalRuns?: number;
  emailNotifications?: boolean;
  notificationEmail?: string;
  notificationEmails?: string[];
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
  triggerType?: 'cron' | 'event';
  trigger?: EventTrigger;
  cronExpression?: string;
  timezone?: string;
  label?: string;
  runConfig?: ScheduledRunConfig;
  agentSnapshot?: AgentScheduleSnapshot;
  maxRuns?: number;
  emailNotifications?: boolean;
  notificationEmail?: string;
  notificationEmails?: string[];
};

export type UpdateAgentSchedulePayload = {
  promptText?: string;
  triggerType?: 'cron' | 'event';
  trigger?: EventTrigger;
  cronExpression?: string;
  timezone?: string;
  label?: string;
  status?: 'active' | 'paused' | 'deleted';
  runConfig?: ScheduledRunConfig;
  maxRuns?: number;
  emailNotifications?: boolean;
  notificationEmails?: string[];
};
