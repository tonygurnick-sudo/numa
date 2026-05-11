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

export type TypedScheduleErrorKind =
  | 'integration_not_connected'
  | 'integration_revoked'
  | 'kb_not_accessible'
  | 'agent_archived'
  | 'agent_deleted'
  | 'feature_disabled_company'
  | 'feature_disabled_user'
  | 'quota_exceeded'
  | 'agent_invocation_failed'
  | 'unknown';

export type TypedScheduleError = {
  kind: TypedScheduleErrorKind;
  message: string;
  resource?: string;
  remediationPath?: string;
};


export type AgentSchedule = {
  scheduleId: string;
  /** Schedule owner's Cognito sub. Useful in admin tenant view. */
  userId?: string;
  conversationId: string;
  promptText: string;
  triggerType?: 'cron' | 'event';
  trigger?: EventTrigger;
  cronExpression?: string;
  timezone?: string;
  status: 'active' | 'paused' | 'deleted' | 'pending_approval' | 'admin_locked';
  eventType?: 'agent' | 'application' | 'data_sync';
  label?: string;
  agentId: string;
  agentTitle?: string;
  createdAt?: number;
  updatedAt?: number;
  lastRunEpoch?: number;
  lastStatus?: string;
  lastError?: string;
  lastErrorTyped?: TypedScheduleError;
  lastRunConversationId?: string;
  lastRunS3Key?: string;
  runConfig?: ScheduledRunConfig;
  maxRuns?: number;
  totalRuns?: number;
  /** Cached projected runs/month — computed at create/update time. */
  projectedRunsPerMonth?: number;
  emailNotifications?: boolean;
  notificationEmail?: string;
  notificationEmails?: string[];
  /** Set when an admin approved a pending_approval schedule. */
  approvedBy?: string;
  approvedAt?: number;
  /**
   * `'company'` means the schedule was promoted to the company quota
   * bucket (typically via admin approval) — it counts against the company
   * monthly cap only, not the owner's per-user cap. Defaults to `'user'`.
   */
  quotaScope?: 'user' | 'company';
  /** Optional schedule expiry — epoch ms. */
  expiresAt?: number;
  /** Sub of the admin who set status to admin_locked. */
  adminLockedBy?: string;
  /** Epoch ms when the admin lock was applied. */
  adminLockedAt?: number;
  /** Optional reason the admin gave for locking — surfaced to the owner. */
  adminLockReason?: string;
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
  /** Optional schedule expiry — epoch ms. Must be in the future at create time. */
  expiresAt?: number;
};

export type UpdateAgentSchedulePayload = {
  promptText?: string;
  triggerType?: 'cron' | 'event';
  trigger?: EventTrigger;
  cronExpression?: string;
  timezone?: string;
  label?: string;
  status?: 'active' | 'paused' | 'deleted' | 'admin_locked';
  /** Admin-supplied reason when transitioning to admin_locked. Optional. */
  adminLockReason?: string;
  /** Set or clear (via null) the schedule's expiry. */
  expiresAt?: number | null;
  runConfig?: ScheduledRunConfig;
  /**
   * FEAT-105 round-2 — fresh agent snapshot rebuilt from the live agent's
   * toolsConfig. Optional; when present, the schedule's cached agent_snapshot
   * is updated so future runs see the same config the user just edited.
   */
  agentSnapshot?: AgentScheduleSnapshot;
  maxRuns?: number;
  emailNotifications?: boolean;
  notificationEmails?: string[];
};
