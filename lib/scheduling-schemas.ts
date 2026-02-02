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

// Base schemas
export const ScheduledRunConfigSchema = z.object({
  systemPrompt: z.string().optional(),
  modelId: z.string().optional(),
  enabledTools: z.array(z.string()).optional(),
  enabledConnections: z.array(z.string()).optional(),
  enabledKBIds: z.array(z.string()).optional(),
  autoToolsEnabled: z.boolean().optional(),
  webSearchEnabled: z.boolean().optional(),
  createAgentEnabled: z.boolean().optional(),
});

export const AgentSnapshotSchema = z.object({
  agentId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
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

// Main schedule record schema
export const ScheduleRecordSchema = z.object({
  user_id: z.string().min(1, 'User ID is required'),
  schedule_id: z.string().uuid('Invalid schedule ID format'),
  tenant_id: z.string().min(1, 'Tenant ID is required'),
  conversation_id: z.string().min(1, 'Conversation ID is required'),
  prompt_text: z.string().max(4000, 'Prompt text too long'),
  cron_expression: z.string().refine(validateCronExpression, {
    message:
      'Invalid cron expression format. Use AWS EventBridge format: cron(minute hour day-of-month month day-of-week year)',
  }),
  timezone: z.string().refine((tz) => VALID_TIMEZONES.has(tz), {
    message: 'Invalid timezone. Must be a valid IANA timezone identifier',
  }),
  status: z.enum(['active', 'paused', 'deleted']),
  event_type: z.enum(['agent', 'application', 'data_sync']).optional().default('agent'),
  agent_id: z.string().min(1, 'Agent ID is required'),
  agent_title: z.string().optional(),
  agent_snapshot: AgentSnapshotSchema.optional(),
  run_config: ScheduledRunConfigSchema.optional(),
  label: z.string().max(200, 'Label too long').optional(),
  last_run_epoch: z.number().optional(),
  last_status: z.string().optional(),
  last_error: z.string().optional(),
  created_at: z.number().positive('Invalid creation timestamp'),
  updated_at: z.number().positive('Invalid update timestamp'),
  schedule_name: z.string().min(1, 'Schedule name is required'),
});

// Create payload schema
export const CreateSchedulePayloadSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
  agentTitle: z.string().optional(),
  agentSnapshot: AgentSnapshotSchema.optional(),
  conversationId: z.string().min(1, 'Conversation ID is required'),
  promptText: z.string().max(4000, 'Prompt text too long'),
  cronExpression: z.string().refine(validateCronExpression, {
    message:
      'Invalid cron expression format. Use AWS EventBridge format: cron(minute hour day-of-month month day-of-week year)',
  }),
  timezone: z.string().refine((tz) => VALID_TIMEZONES.has(tz), {
    message: 'Invalid timezone. Must be a valid IANA timezone identifier',
  }),
  label: z.string().max(200, 'Label too long').optional(),
  runConfig: ScheduledRunConfigSchema.optional(),
  eventType: z.enum(['agent', 'application', 'data_sync']).optional().default('agent'),
});

// Update payload schema
export const UpdateSchedulePayloadSchema = z.object({
  status: z.enum(['active', 'paused', 'deleted']).optional(),
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
  agentSnapshot: AgentSnapshotSchema.optional(),
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

// Export types
export type ScheduleRecord = z.infer<typeof ScheduleRecordSchema>;
export type CreateSchedulePayload = z.infer<typeof CreateSchedulePayloadSchema>;
export type UpdateSchedulePayload = z.infer<typeof UpdateSchedulePayloadSchema>;
export type ScheduledRunConfig = z.infer<typeof ScheduledRunConfigSchema>;
export type AgentSnapshot = z.infer<typeof AgentSnapshotSchema>;
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
