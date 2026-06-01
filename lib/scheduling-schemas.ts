import { z } from 'zod';

// Comprehensive cron validation (AWS EventBridge/Quartz style)
const MINUTE_VALUE = '(?:[0-5]?\\d)';
const HOUR_VALUE = '(?:1?\\d|2[0-3])';
const DOM_VALUE = '(?:[1-9]|[12]\\d|3[01])';
const MONTH_VALUE = '(?:[1-9]|1[0-2]|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)';
const DOW_VALUE = '(?:[1-7]|SUN|MON|TUE|WED|THU|FRI|SAT)';

const buildListPattern = (value: string) => {
  const range = `${value}-${value}`;
  const listItem = `(?:${value}|${range})`;
  return {
    listItem,
    list: `${listItem}(?:,${listItem})*`,
    step: `(?:\\*|${listItem})\\/[1-9]\\d*`,
  };
};

const minutePatternParts = buildListPattern(MINUTE_VALUE);
const hourPatternParts = buildListPattern(HOUR_VALUE);
const domPatternParts = buildListPattern(DOM_VALUE);
const monthPatternParts = buildListPattern(MONTH_VALUE);
const dowPatternParts = buildListPattern(DOW_VALUE);

const CRON_FIELD_PATTERNS = {
  minute: new RegExp(`^(?:\\*|${minutePatternParts.list}|${minutePatternParts.step})$`),
  hour: new RegExp(`^(?:\\*|${hourPatternParts.list}|${hourPatternParts.step})$`),
  dayOfMonth: new RegExp(`^(?:\\?|\\*|L|LW|L-\\d{1,2}|${DOM_VALUE}W|${domPatternParts.list}|${domPatternParts.step})$`),
  month: new RegExp(`^(?:\\*|${monthPatternParts.list}|${monthPatternParts.step})$`),
  dayOfWeek: new RegExp(`^(?:\\?|\\*|${DOW_VALUE}L|${DOW_VALUE}#[1-5]|${dowPatternParts.list})$`),
};

const validateCronExpression = (expression: string): boolean => {
  // Handle AWS EventBridge cron format: cron(minute hour day-of-month month day-of-week year)
  const cronMatch = expression.match(/^cron\((.+)\)$/);
  if (!cronMatch) return false;

  const fields = cronMatch[1].trim().split(/\s+/);
  if (fields.length !== 6) return false;

  const normalizedFields = fields.map((field) => field.toUpperCase());
  const [minute, hour, dayOfMonth, month, dayOfWeek, year] = normalizedFields;

  // Validate each field
  if (!CRON_FIELD_PATTERNS.minute.test(minute)) return false;
  if (!CRON_FIELD_PATTERNS.hour.test(hour)) return false;
  if (!CRON_FIELD_PATTERNS.dayOfMonth.test(dayOfMonth)) return false;
  if (!CRON_FIELD_PATTERNS.month.test(month)) return false;
  if (!CRON_FIELD_PATTERNS.dayOfWeek.test(dayOfWeek)) return false;

  // Year validation (AWS supports specific years or ranges)
  const yearPattern = /^(\*|\d{4}(,\d{4})*|\d{4}-\d{4})$/;
  if (!yearPattern.test(year)) return false;

  // Additional logical validations
  const domIsQuestion = dayOfMonth === '?';
  const dowIsQuestion = dayOfWeek === '?';
  const domIsStar = dayOfMonth === '*';
  const dowIsStar = dayOfWeek === '*';
  const domDowOk = (domIsQuestion && !dowIsQuestion) || (!domIsQuestion && dowIsQuestion) || (domIsStar && dowIsStar);
  if (!domDowOk) return false;

  return true;
};

// Timezone validation using Intl.supportedValuesOf
const VALID_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));
VALID_TIMEZONES.add('UTC');

// Unified integrations shape — mirrors the workspace-agent wire format
// (workspaceChatTypes.ts:IntegrationListItem). Each row carries a `method`
// tag so the runner doesn't have to re-derive native vs. Pipedream at wire
// time. Source of truth for the method-routing pattern is FEAT-143.
export const IntegrationMethodSchema = z.enum(['native', 'pipedream']);
export const IntegrationListItemSchema = z.object({
  slug: z.string().min(1),
  method: IntegrationMethodSchema,
  name: z.string().min(1),
});

// Base schemas
export const ScheduledRunConfigSchema = z.object({
  systemPrompt: z.string().optional(),
  modelId: z.string().optional(),
  enabledTools: z.array(z.string()).optional(),
  /**
   * @deprecated since FEAT-143 — use `enabledIntegrations` (method-tagged).
   * Still read at run time for legacy schedule records; the runner derives
   * the method per slug from live per-user auth state. Records written by
   * older save paths continue to populate this; new writers SHOULD populate
   * `enabledIntegrations` instead.
   */
  enabledConnections: z.array(z.string()).optional(),
  /**
   * Per-schedule integrations override. Each row tagged with the delivery
   * method (`native` vs `pipedream`) so the workspace agent registers the
   * right MCP family. When absent the runner falls back to (a) the agent
   * snapshot's `toolsConfig.enabledConnections` (legacy slug list), then
   * (b) `enabledConnections` above — see runner `buildUnifiedIntegrationsPayload`.
   */
  enabledIntegrations: z.array(IntegrationListItemSchema).optional(),
  enabledKBIds: z.array(z.string()).optional(),
  autoToolsEnabled: z.boolean().optional(),
  webSearchEnabled: z.boolean().optional(),
  createAgentEnabled: z.boolean().optional(),
});

export const AgentSnapshotSchema = z.object({
  agentId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().nullable().optional(),
  iconImage: z
    .object({
      s3Bucket: z.string(),
      s3Key: z.string(),
    })
    .nullable()
    .optional(),
  systemPrompt: z.string().optional(),
  userWelcomeMessage: z.string().optional(),
  requiredIntegrations: z.array(z.string()).optional(),
  toolsConfig: z.record(z.unknown()).optional(),
  estimatedTimeSavedMinutes: z.number().optional(),
  version: z.number().optional(),
  visibility: z.string().optional(),
});

// Event trigger schemas
export const EmailFilterFieldSchema = z.enum(['sender', 'subject', 'to', 'body', 'has_attachment']);
export const EmailFilterOpSchema = z.enum(['contains', 'equals', 'not_contains', 'matches']);

export const EmailFilterSchema = z.object({
  field: EmailFilterFieldSchema,
  op: EmailFilterOpSchema,
  value: z.string().max(500),
});

export const GmailEventTriggerSchema = z.object({
  source: z.literal('gmail'),
  event: z.literal('message.received'),
  filters: z.array(EmailFilterSchema).max(20).default([]),
  filter_logic: z.enum(['all', 'any']).optional().default('all'),
  include_email_context: z.boolean().optional().default(true),
});

// Pipedream-backed event trigger. Configuration (channel, keyword, etc.) is held
// in `configured_props` and validated by Pipedream at deploy time. `deployed_trigger_id`
// (dc_xxx) and `webhook_signing_key` are populated by the agent-schedules lambda after
// it calls the Pipedream Connect deploy endpoint via the relay.
//
// `configured_prop_labels` is a snapshot of human-readable labels for prop values
// (e.g. `{ conversations: { "C0AG75CUDRR": "codespace" } }`), captured at save-time
// from the wizard's remote-options dropdown. We don't refetch labels at view-time —
// detail pages and list cards read from this map and fall back to raw values for
// legacy schedules where it's missing.
export const PipedreamEventTriggerSchema = z.object({
  source: z.literal('pipedream'),
  app_slug: z.string().min(1),
  component_id: z.string().min(1),
  component_version: z.string().optional(),
  configured_props: z.record(z.unknown()),
  configured_prop_labels: z.record(z.record(z.string())).optional(),
  deployed_trigger_id: z.string().optional(),
  webhook_signing_key: z.string().optional(),
  include_event_context: z.boolean().optional().default(true),
});

// Numa Voice native event trigger. Fires the bound agent (e.g. the Post-Call
// Processor) when a call recording has been transcribed. numa-voice-processor
// emits a `numa.connector.connect` EventBridge event; the connector-event
// dispatcher's `connect` branch resolves the schedule(s) bound to this source
// and invokes the runner with the transcript in the event payload.
export const ConnectEventTriggerSchema = z.object({
  source: z.literal('connect'),
  // Sub-event discriminator so multiple Voice triggers (post-call vs prospect
  // ingest) bind to the same `connect` source without cross-firing. The
  // dispatcher matches trigger.event against the connector event_type.
  event: z.enum(['call.completed', 'prospects.uploaded']).optional().default('call.completed'),
  include_event_context: z.boolean().optional().default(true),
});

export const EventTriggerSchema = z.discriminatedUnion('source', [
  GmailEventTriggerSchema,
  PipedreamEventTriggerSchema,
  ConnectEventTriggerSchema,
]);

/**
 * Typed error written by the runner when a scheduled run fails for a
 * reason the frontend can act on (broken integration, missing KB, etc.).
 * Free-form `last_error` is still kept alongside this for legacy records.
 */
export const TypedScheduleErrorSchema = z.object({
  kind: z.enum([
    'integration_not_connected',
    'integration_revoked',
    'kb_not_accessible',
    'agent_archived',
    'agent_deleted',
    'feature_disabled_company',
    'feature_disabled_user',
    'quota_exceeded',
    'agent_invocation_failed',
    'unknown',
  ]),
  /** Human-readable summary for fallback rendering. */
  message: z.string().max(500),
  /** Optional integration / KB / feature identifier the error refers to. */
  resource: z.string().optional(),
  /** Path the frontend can deep-link to for remediation. */
  remediationPath: z.string().optional(),
});
export type TypedScheduleError = z.infer<typeof TypedScheduleErrorSchema>;

// Main schedule record schema
export const ScheduleRecordSchema = z
  .object({
    user_id: z.string().min(1, 'User ID is required'),
    schedule_id: z.string().uuid('Invalid schedule ID format'),
    tenant_id: z.string().min(1, 'Tenant ID is required'),
    conversation_id: z.string().min(1, 'Conversation ID is required'),
    prompt_text: z.string().max(4000, 'Prompt text too long'),
    trigger_type: z.enum(['cron', 'event']).optional().default('cron'),
    trigger: EventTriggerSchema.optional(),
    cron_expression: z
      .string()
      .refine(validateCronExpression, {
        message:
          'Invalid cron expression format. Use AWS EventBridge format: cron(minute hour day-of-month month day-of-week year)',
      })
      .optional(),
    timezone: z
      .string()
      .refine((tz) => VALID_TIMEZONES.has(tz), {
        message: 'Invalid timezone. Must be a valid IANA timezone identifier',
      })
      .optional(),
    /**
     * `admin_locked` is set by an admin via the tenant audit panel. The owner
     * can see the schedule but cannot reactivate or edit it — only an admin
     * can transition out of `admin_locked` (typically back to `paused` so the
     * owner regains control).
     */
    status: z.enum(['active', 'paused', 'deleted', 'pending_approval', 'admin_locked']),
    event_type: z.enum(['agent', 'application', 'data_sync']).optional().default('agent'),
    agent_id: z.string().min(1, 'Agent ID is required'),
    agent_title: z.string().optional(),
    agent_snapshot: AgentSnapshotSchema.optional(),
    run_config: ScheduledRunConfigSchema.optional(),
    label: z.string().max(200, 'Label too long').optional(),
    max_runs: z.number().int().positive().optional(),
    total_runs: z.number().int().min(0).optional().default(0),
    email_notifications: z.boolean().optional().default(false),
    notification_email: z.string().email().optional(),
    notification_emails: z.array(z.string().email()).max(10).optional(),
    last_run_epoch: z.number().optional(),
    last_status: z.string().optional(),
    /**
     * Free-form error string. Prefer `last_error_typed` for new code; this
     * field is kept for backwards compatibility with existing records.
     */
    last_error: z.string().optional(),
    /**
     * Typed last_error so the frontend can render an actionable message
     * (e.g. "Reconnect Gmail") instead of the raw exception text.
     */
    last_error_typed: TypedScheduleErrorSchema.optional(),
    /**
     * Cached projected runs/month for this schedule. Computed at create /
     * update time from the cron expression. Null for event-trigger schedules.
     */
    projected_runs_per_month: z.number().int().min(0).optional(),
    /**
     * Sub of the admin who approved the schedule when it was created above
     * the user cap. Set only on transition from `pending_approval` → `active`.
     */
    approved_by: z.string().optional(),
    /** Epoch ms of the approval. */
    approved_at: z.number().optional(),
    /**
     * Which quota bucket this schedule is counted against.
     *
     * - `'user'` (default): counts against the owner's per-user monthly cap
     *   AND the company cap.
     * - `'company'`: counts against the company cap ONLY — excluded from the
     *   owner's per-user monthly cap. Set automatically when an admin
     *   approves a `pending_approval` schedule (which by definition exceeded
     *   the owner's user cap), so the user can keep creating schedules up to
     *   their personal cap without the approved one eating into it.
     *
     * Per-agent and concurrent caps remain unaffected (those are hard caps,
     * never approvable).
     */
    quota_scope: z.enum(['user', 'company']).optional().default('user'),
    /**
     * Optional schedule expiry. When set and `Date.now() >= expires_at`, the
     * runner auto-pauses the schedule, deletes the EventBridge rule, and
     * sends a `schedule_expired` notification. Owners cannot reactivate
     * past-expiry schedules (must extend or clear `expires_at` first).
     */
    expires_at: z.number().int().positive().optional(),
    /** Sub of the admin who put the schedule into `admin_locked`. */
    admin_locked_by: z.string().optional(),
    /** Epoch ms when the admin lock was applied. */
    admin_locked_at: z.number().optional(),
    /** Optional admin-supplied reason shown to the owner. */
    admin_lock_reason: z.string().max(500).optional(),
    /**
     * Rolling per-day fire counter for event-trigger schedules. Keyed
     * `'YYYY-MM-DD'`. Pruned to the last ~35 entries on each write — old
     * enough to project a 30-day rate, small enough to keep the record
     * lightweight. Cron schedules don't populate this (use projected
     * `projected_runs_per_month` instead).
     */
    recent_runs: z.record(z.string(), z.number().int().min(0)).optional(),
    /**
     * `'YYYY-MM'` of the last month a quota-block notification was sent for
     * this schedule. Used by the dispatcher to dedupe so a tenant over cap
     * gets one notification per month, not one per blocked fire.
     */
    last_quota_blocked_month: z.string().optional(),
    created_at: z.number().positive('Invalid creation timestamp'),
    updated_at: z.number().positive('Invalid update timestamp'),
    schedule_name: z.string().min(1, 'Schedule name is required'),
  })
  .superRefine((record, ctx) => {
    if (record.trigger_type === 'event') {
      if (!record.trigger) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['trigger'],
          message: 'trigger is required when trigger_type is "event"',
        });
      }
    } else {
      if (!record.cron_expression) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cron_expression'],
          message: 'cron_expression is required when trigger_type is "cron"',
        });
      }
      if (!record.timezone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['timezone'],
          message: 'timezone is required when trigger_type is "cron"',
        });
      }
    }
  });

// Create payload schema
export const CreateSchedulePayloadSchema = z
  .object({
    agentId: z.string().min(1, 'Agent ID is required'),
    agentTitle: z.string().optional(),
    agentSnapshot: AgentSnapshotSchema.optional(),
    conversationId: z.string().min(1, 'Conversation ID is required'),
    promptText: z.string().max(4000, 'Prompt text too long'),
    triggerType: z.enum(['cron', 'event']).optional().default('cron'),
    trigger: EventTriggerSchema.optional(),
    cronExpression: z
      .string()
      .refine(validateCronExpression, {
        message:
          'Invalid cron expression format. Use AWS EventBridge format: cron(minute hour day-of-month month day-of-week year)',
      })
      .optional(),
    timezone: z
      .string()
      .refine((tz) => VALID_TIMEZONES.has(tz), {
        message: 'Invalid timezone. Must be a valid IANA timezone identifier',
      })
      .optional(),
    label: z.string().max(200, 'Label too long').optional(),
    runConfig: ScheduledRunConfigSchema.optional(),
    eventType: z.enum(['agent', 'application', 'data_sync']).optional().default('agent'),
    maxRuns: z.number().int().positive().optional(),
    /** Optional epoch-ms expiry. Must be in the future at create time. */
    expiresAt: z.number().int().positive().optional(),
    emailNotifications: z.boolean().optional().default(false),
    notificationEmail: z.string().email().optional(),
    notificationEmails: z.array(z.string().email()).max(10).optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.expiresAt !== undefined && payload.expiresAt <= Date.now()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'Expiry must be in the future',
      });
    }
    if (payload.triggerType === 'event') {
      if (!payload.trigger) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['trigger'],
          message: 'trigger is required when triggerType is "event"',
        });
      }
    } else {
      if (!payload.cronExpression) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cronExpression'],
          message: 'cronExpression is required when triggerType is "cron"',
        });
      }
      if (!payload.timezone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['timezone'],
          message: 'timezone is required when triggerType is "cron"',
        });
      }
    }
  });

// Update payload schema
export const UpdateSchedulePayloadSchema = z
  .object({
    /**
     * `admin_locked` writes (and reactivations FROM `admin_locked`) are gated
     * server-side — the schema accepts the value but the lambda rejects when
     * the caller isn't an admin.
     */
    status: z.enum(['active', 'paused', 'deleted', 'admin_locked']).optional(),
    /** Optional admin-supplied reason for an `admin_locked` transition. */
    adminLockReason: z.string().max(500).optional(),
    /** Set or clear (via null) the schedule's expiry. */
    expiresAt: z.number().int().positive().nullable().optional(),
    promptText: z.string().max(4000, 'Prompt text too long').optional(),
    cronExpression: z
      .string()
      .refine(validateCronExpression, {
        message:
          'Invalid cron expression format. Use AWS EventBridge format: cron(minute hour day-of-month month day-of-week year)',
      })
      .optional(),
    timezone: z
      .string()
      .refine((tz) => VALID_TIMEZONES.has(tz), {
        message: 'Invalid timezone. Must be a valid IANA timezone identifier',
      })
      .optional(),
    label: z.string().max(200, 'Label too long').optional(),
    runConfig: ScheduledRunConfigSchema.optional(),
    agentTitle: z.string().optional(),
    appTitle: z.string().optional(),
    agentSnapshot: AgentSnapshotSchema.optional(),
    maxRuns: z.number().int().positive().nullable().optional(),
    // Do NOT add `.default(false)` here — partial PUTs would silently disable
    // existing email notifications because Zod fills in the default and the
    // lambda's `!== undefined` write check then overwrites the stored value.
    // The lambda only writes this field when the caller explicitly sets it.
    emailNotifications: z.boolean().optional(),
    notificationEmail: z.string().email().optional(),
    notificationEmails: z.array(z.string().email()).max(10).optional(),
    triggerType: z.enum(['cron', 'event']).optional(),
    trigger: EventTriggerSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    // Mirror the create-side rule: an explicit non-null expiresAt must be in
    // the future. `null` clears the expiry, `undefined` leaves it untouched.
    if (payload.expiresAt !== undefined && payload.expiresAt !== null && payload.expiresAt <= Date.now()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'Expiry must be in the future',
      });
    }
  });

// Application schedule schema
export const ApplicationScheduleRecordSchema = z.object({
  user_id: z.string().min(1, 'User ID is required'),
  schedule_id: z.string().uuid('Invalid schedule ID format'),
  event_type: z.literal('application'),
  app_id: z.string().min(1, 'App ID is required'),
  app_title: z.string().optional(),
  status: z.enum(['active', 'paused', 'deleted']),
  input_config: z.record(z.unknown()),
  label: z.string().max(200, 'Label too long').optional(),
  last_status: z.string().optional(),
  last_error: z.string().optional(),
  last_run_epoch: z.number().optional(),
  created_at: z.number().positive('Invalid creation timestamp'),
  updated_at: z.number().positive('Invalid update timestamp'),
});

// Data sync schedule schema
export const DataSyncScheduleRecordSchema = z.object({
  user_id: z.string().min(1, 'User ID is required'),
  schedule_id: z.string().uuid('Invalid schedule ID format'),
  event_type: z.literal('data_sync'),
  source_type: z.enum(['knowledge_base', 's3', 'api']),
  source_config: z.record(z.unknown()),
  status: z.enum(['active', 'paused', 'deleted']),
  label: z.string().max(200, 'Label too long').optional(),
  last_status: z.string().optional(),
  last_error: z.string().optional(),
  last_run_epoch: z.number().optional(),
  created_at: z.number().positive('Invalid creation timestamp'),
  updated_at: z.number().positive('Invalid update timestamp'),
});

/**
 * Estimates the approximate interval in minutes between runs for a cron expression.
 * NOTE: A frontend copy exists in CronExpressionBuilder.tsx — keep both in sync.
 * Returns `null` for complex patterns that cannot be reliably estimated (conservatively allowed).
 *
 * Handles:
 *   - Minute steps:  cron(0/N * * * ? *)  → N minutes
 *   - Hour steps:    cron(M H/N * * ? *)  → N * 60 minutes
 *   - Day steps:     cron(M H D/N * ? *)  → N * 1440 minutes
 *   - Fixed daily / weekdays / weekly / monthly → large number (always valid)
 *   - "once" (specific year)               → Infinity (always valid)
 *   - Unrecognised patterns                → null (conservatively allow)
 */
export function estimateCronIntervalMinutes(expression: string): number | null {
  const match = expression.match(/^cron\((.+)\)$/);
  if (!match) return null;

  const fields = match[1].trim().split(/\s+/);
  if (fields.length !== 6) return null;

  const [minute, hour, dom, month, dow, year] = fields;

  // Once-off: specific year → effectively infinite interval
  if (/^\d{4}$/.test(year)) return Infinity;

  // Minute-level step:  N/step or */step in minute field, hour = *
  const minuteStep = minute.match(/^(?:\d+|\*)\/(\d+)$/);
  if (minuteStep && hour === '*') {
    return parseInt(minuteStep[1], 10);
  }

  // Comma-separated minute list with hour = * (e.g. "0,15,30,45 * * * ? *")
  // Estimate the minimum gap between listed minute values
  if (hour === '*' && /^\d+(,\d+)+$/.test(minute)) {
    const values = minute
      .split(',')
      .map((v) => parseInt(v, 10))
      .sort((a, b) => a - b);
    let minGap = 60 - values[values.length - 1] + values[0]; // wrap-around gap
    for (let i = 1; i < values.length; i++) {
      minGap = Math.min(minGap, values[i] - values[i - 1]);
    }
    return minGap;
  }

  // Hour-level step:  hour field has N/step or */step
  const hourStep = hour.match(/^(?:\d+|\*)\/(\d+)$/);
  if (hourStep) {
    return parseInt(hourStep[1], 10) * 60;
  }

  // Day-level step:  dom field has N/step or */step
  const domStep = dom.match(/^(?:\d+|\*)\/(\d+)$/);
  if (domStep) {
    return parseInt(domStep[1], 10) * 1440;
  }

  // Fixed minute + fixed hour + wildcard day → daily (1440 min)
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && (dom === '*' || dom === '?')) {
    // Check for specific DOW patterns (weekly)
    if (dow !== '*' && dow !== '?') {
      // Weekly or weekday schedule — at least daily
      return 1440;
    }
    return 1440;
  }

  // Fixed minute + fixed hour + fixed dom → monthly or less frequent
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && /^\d+$/.test(dom)) {
    return 43200; // ~30 days
  }

  // Month-level step
  const monthStep = month.match(/^(?:\d+|\*)\/(\d+)$/);
  if (monthStep) {
    return parseInt(monthStep[1], 10) * 43200;
  }

  return null;
}

// Export types
export type ScheduleRecord = z.infer<typeof ScheduleRecordSchema>;
export type CreateSchedulePayload = z.infer<typeof CreateSchedulePayloadSchema>;
export type UpdateSchedulePayload = z.infer<typeof UpdateSchedulePayloadSchema>;
export type ScheduledRunConfig = z.infer<typeof ScheduledRunConfigSchema>;
export type AgentSnapshot = z.infer<typeof AgentSnapshotSchema>;
export type IntegrationMethod = z.infer<typeof IntegrationMethodSchema>;
export type IntegrationListItem = z.infer<typeof IntegrationListItemSchema>;
export type EmailFilter = z.infer<typeof EmailFilterSchema>;
export type GmailEventTrigger = z.infer<typeof GmailEventTriggerSchema>;
export type PipedreamEventTrigger = z.infer<typeof PipedreamEventTriggerSchema>;
export type EventTrigger = z.infer<typeof EventTriggerSchema>;
export type ApplicationScheduleRecord = z.infer<typeof ApplicationScheduleRecordSchema>;
export type DataSyncScheduleRecord = z.infer<typeof DataSyncScheduleRecordSchema>;

// Validation helpers
export const validateScheduleRecord = (data: unknown): ScheduleRecord => {
  return ScheduleRecordSchema.parse(data);
};

export const validateCreatePayload = (data: unknown): CreateSchedulePayload => {
  return CreateSchedulePayloadSchema.parse(data);
};

export const validateUpdatePayload = (data: unknown): UpdateSchedulePayload => {
  return UpdateSchedulePayloadSchema.parse(data);
};
