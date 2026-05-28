import { z } from 'zod';

// ─── Enums ──────────────────────────────────────────────────────────────────────

export const statusTypeSchema = z.enum(['backlog', 'scoped', 'queued', 'active', 'completed', 'ended', 'deleted']);

export const prioritySchema = z.enum(['highest', 'high', 'medium', 'low', 'lowest']);

export const zoneTypeSchema = z.enum(['board', 'backlog']);

export const boardModeSchema = z.enum(['basic', 'normal', 'development', 'support', 'monthly', 'solo']);

export const workUnitStatusSchema = z.enum(['planning', 'active', 'completed']);

export const linkTypeSchema = z.enum(['blocks', 'depends_on', 'related_to']);

export const accessControlModeSchema = z.enum(['all', 'specific', 'inherit']);

export const fieldTypeSchema = z.enum([
  'text',
  'richtext',
  'select',
  'multiselect',
  'number',
  'currency',
  'date',
  'url',
  'user',
  'workunit',
  'project',
  'customer',
  'supplier',
  'percentage',
]);

export const fieldCategorySchema = z.enum(['Common', 'Development', 'Call Centre', 'CRM', 'Operations']);

export const ticketSourceTypeSchema = z.enum(['app', 'chat', 'agent', 'manual', 'recurrence']);

export const recurrencePatternSchema = z.enum(['daily', 'weekly', 'monthly', 'yearly']);

export const activityTypeSchema = z.enum(['call', 'email', 'meeting', 'note', 'demo', 'slack']);

export const activityDirectionSchema = z.enum(['inbound', 'outbound']);

export const activityOutcomeSchema = z.enum(['positive', 'neutral', 'negative', 'info']);

export const auditActionSchema = z.enum(['created', 'updated', 'moved', 'commented', 'linked', 'deleted', 'restored']);

// ─── Reserved prefixes (cannot be used as ticket type prefixes) ─────────────────

const RESERVED_PREFIXES = new Set([
  'TEAM',
  'TICKET',
  'PREFIX',
  'USER',
  'STAGE',
  'ZONE',
  'WORKUNIT',
  'COMMENT',
  'AUDIT',
  'LINK',
  'META',
  'TENANT',
  'TID',
  'PREF',
  'RECURRENCE',
]);

export const ticketTypePrefixSchema = z
  .string()
  .min(2)
  .max(6)
  .regex(/^[A-Z0-9]+$/, 'Prefix must be 2-6 uppercase alphanumeric characters')
  .refine((val) => !RESERVED_PREFIXES.has(val), {
    message: 'Prefix conflicts with a reserved key prefix',
  });

// ─── Config Entity Schemas ──────────────────────────────────────────────────────

export const ticketTypeSchema = z.object({
  entityType: z.literal('TICKET_TYPE'),
  id: z.string(),
  name: z.string().min(1),
  prefix: ticketTypePrefixSchema,
  icon: z.string(),
  color: z.string(),
  defaultFields: z.array(z.string()),
  order: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const statusSchema = z.object({
  entityType: z.literal('STATUS'),
  id: z.string(),
  name: z.string().min(1),
  type: statusTypeSchema,
  color: z.string(),
  icon: z.string().optional(),
  order: z.number(),
  isPredefined: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const fieldDefinitionSchema = z.object({
  entityType: z.literal('FIELD'),
  id: z.string(),
  name: z.string().min(1),
  fieldType: fieldTypeSchema,
  category: fieldCategorySchema,
  required: z.boolean().optional().default(false),
  helpText: z.string().optional(),
  defaultValue: z.unknown().optional(),
  options: z.array(z.string()).optional(),
  isSystem: z.boolean().optional().default(false),
  order: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const staffProfileSchema = z.object({
  entityType: z.literal('STAFF'),
  id: z.string(),
  name: z.string().min(1),
  email: z.string().email(),
  role: z.string().optional(),
  avatarUrl: z.string().optional(),
  isActive: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const projectSchema = z.object({
  entityType: z.literal('PROJECT'),
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
  status: z.enum(['active', 'planned', 'on_hold', 'complete']).optional().default('active'),
  ownerId: z.string().optional(),
  ownerName: z.string().optional(),
  isActive: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const lifecycleStageSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  colorPosition: z.number(),
});

export const flagSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  color: z.string().optional(),
  icon: z.string().optional(),
});

export const documentTypeSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
});

/**
 * A section of the customer record (e.g. "Company Details", "Contract"),
 * with an ordered list of field ids. Field ids may reference built-in
 * Customer properties (e.g. "companyName") or FieldDefinition ids for
 * custom fields stored on Customer.customFields.
 */
export const customerRecordSectionSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  fieldIds: z.array(z.string()).default([]),
  requiredFieldIds: z.array(z.string()).optional(),
});

export const customerRecordConfigSchema = z.object({
  sections: z.array(customerRecordSectionSchema).default([]),
});

export const customerRecordLayoutSchema = z.object({
  columnsPerSection: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
  density: z.enum(['compact', 'comfortable']).optional(),
  defaultSectionsExpanded: z.boolean().optional(),
  labelPosition: z.enum(['above', 'inline']).optional(),
});

export const crmConfigSchema = z.object({
  entityType: z.literal('CRM_CONFIG'),
  lifecycleStages: z.array(lifecycleStageSchema),
  customerFlags: z.array(flagSchema),
  documentTypes: z.array(documentTypeSchema).optional(),
  territories: z.array(z.string()).optional(),
  industries: z.array(z.string()).optional(),
  defaultStageId: z.string().optional(),
  customerRecord: customerRecordConfigSchema.optional(),
  layout: customerRecordLayoutSchema.optional(),
  // Per-client label overrides for built-in customer fields, keyed by
  // built-in field id (e.g. "companyName"). Empty/missing → fall back to
  // the i18n default label.
  builtinFieldLabels: z.record(z.string()).optional(),
  updatedAt: z.string(),
});

export const supplierConfigSchema = z.object({
  entityType: z.literal('SUPPLIER_CONFIG'),
  lifecycleStages: z.array(lifecycleStageSchema),
  supplierFlags: z.array(flagSchema),
  documentTypes: z.array(documentTypeSchema).optional(),
  defaultStageId: z.string().optional(),
  updatedAt: z.string(),
});

export const linkTypeConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  inverse: z.string(),
  icon: z.string().optional(),
  causesBlocked: z.boolean().optional().default(false),
});

export const linkConfigSchema = z.object({
  entityType: z.literal('LINK_CONFIG'),
  linkTypes: z.array(linkTypeConfigSchema),
  updatedAt: z.string(),
});

// ─── Core Entity Schemas ────────────────────────────────────────────────────────

export const accessControlSchema = z.object({
  mode: accessControlModeSchema,
  users: z.array(z.string()).optional().default([]),
  owners: z.array(z.string()).optional().default([]),
});

export const workUnitSeriesSchema = z.object({
  enabled: z.boolean(),
  label: z.string(),
  labelPlural: z.string(),
  patternType: z.string().optional(),
  patternStart: z.string().optional(),
  allowOverlap: z.boolean().optional().default(false),
  backlogZoneId: z.string().optional(),
});

export const mirrorConfigSchema = z.object({
  enabled: z.boolean(),
  groupBy: z.string().optional(),
});

export const fieldOverrideSchema = z.object({
  visible: z.boolean(),
  required: z.boolean().optional().default(false),
});

export const boardSchema = z.object({
  entityType: z.literal('TEAM'),
  id: z.string(),
  name: z.string().min(1),
  color: z.string().optional(),
  allowedTicketTypes: z.array(z.string()),
  fieldOverrides: z.record(z.string(), fieldOverrideSchema).optional(),
  workUnitSeries: workUnitSeriesSchema.nullable().optional(),
  accessControl: accessControlSchema,
  defaultZoneId: z.string().optional(),
  preset: z.string().optional(),
  // Membership in the persona/industry taxonomy is validated at the API write boundary
  // (see normalisePersonas/normaliseIndustries from lib/resource-taxonomy) — kept permissive
  // here so read-time parsing tolerates legacy/future taxonomy values.
  personas: z.array(z.string()).optional().default([]),
  industries: z.array(z.string()).optional().default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  order: z.number(),
});

/** @deprecated Use boardSchema instead. */
export const teamSchema = boardSchema;

/** @deprecated Use boardSchema instead. */
export const processBoardSchema = boardSchema;

export const workZoneSchema = z.object({
  entityType: z.literal('WORK_ZONE'),
  id: z.string(),
  boardId: z.string(),
  name: z.string().min(1),
  zoneType: zoneTypeSchema,
  // Active sprint applied to this zone. Only set for board zones with a running sprint.
  // Managed exclusively by work-unit lifecycle handlers (start/complete/rollover),
  // not by the generic zone update endpoint.
  activeWorkUnitId: z.string().nullable().optional(),
  order: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const workStageSchema = z.object({
  entityType: z.literal('WORK_STAGE'),
  id: z.string(),
  boardId: z.string(),
  zoneId: z.string(),
  name: z.string().min(1),
  statusId: z.string(),
  statusType: statusTypeSchema.optional(),
  workUnitId: z.string().nullable().optional(),
  order: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ticketSchema = z.object({
  entityType: z.literal('TICKET'),
  id: z.string(),
  displayId: z.string(),
  boardId: z.string(),
  ticketTypeId: z.string(),
  title: z.string().min(1),
  description: z.string().optional().default(''),
  statusType: statusTypeSchema,
  zoneId: z.string(),
  stageId: z.string(),
  assigneeId: z.string().nullable().optional(),
  assigneeName: z.string().nullable().optional(),
  reporterId: z.string().nullable().optional(),
  reporterName: z.string().nullable().optional(),
  priority: prioritySchema,
  projectId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  supplierName: z.string().nullable().optional(),
  workUnitId: z.string().nullable().optional(),
  effortPoints: z.number().nullable().optional(),
  fields: z.record(z.string(), z.unknown()).optional().default({}),
  tags: z.array(z.string()).optional().default([]),
  dueDate: z.string().nullable().optional(),
  sourceType: ticketSourceTypeSchema.nullable().optional(),
  sourceId: z.string().nullable().optional(),
  sourceAppType: z.string().nullable().optional(),
  commentCount: z.number().default(0),
  linkCount: z.number().default(0),
  archived: z.boolean().default(false),
  version: z.number().default(1),
  order: z.number(),
  createdBy: z.string(),
  createdByName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable().optional(),
  scopedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  endedAt: z.string().nullable().optional(),
});

export const attachmentSchema = z.object({
  name: z.string(),
  s3Key: z.string(),
  size: z.number(),
  mimeType: z.string(),
});

export const commentSchema = z.object({
  entityType: z.literal('COMMENT'),
  id: z.string(),
  ticketId: z.string(),
  boardId: z.string(),
  content: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  attachments: z.array(attachmentSchema).optional().default([]),
  isSystem: z.boolean().optional().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ticketLinkSchema = z.object({
  entityType: z.literal('TICKET_LINK'),
  ticketId: z.string(),
  linkedTicketId: z.string(),
  linkedTicketDisplayId: z.string(),
  linkedTicketTitle: z.string().optional(),
  linkType: linkTypeSchema,
  createdBy: z.string(),
  createdAt: z.string(),
});

export const workUnitSchema = z.object({
  entityType: z.literal('WORK_UNIT'),
  id: z.string(),
  boardId: z.string(),
  name: z.string().min(1),
  goal: z.string().nullable().optional(),
  status: workUnitStatusSchema,
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  order: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const auditChangeSchema = z.object({
  field: z.string(),
  from: z.unknown(),
  to: z.unknown(),
});

export const auditEntrySchema = z.object({
  entityType: z.literal('AUDIT'),
  id: z.string(),
  ticketId: z.string(),
  boardId: z.string(),
  userId: z.string(),
  userName: z.string(),
  action: auditActionSchema,
  changes: z.array(auditChangeSchema).optional().default([]),
  timestamp: z.string(),
});

export const filterConfigSchema = z.object({
  name: z.string(),
  config: z.record(z.string(), z.unknown()),
});

// ─── Recurrence Rule ────────────────────────────────────────────────────────────
// A recurring ticket — attached to a "template" ticket. Each fire spawns a
// fresh ticket from the template's current state, placed in the board's
// default backlog/queued column (or an explicit override).
//
// Fired by EventBridge Scheduler (one rule per recurrence). State is tracked
// in DynamoDB and re-evaluated on each fire so endDate / maxOccurrences /
// `enabled` are honoured without relying on schedule deletion timing.

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const recurrenceConfigSchema = z
  .object({
    pattern: recurrencePatternSchema,
    interval: z.number().int().min(1).max(365).default(1),
    /** Required for weekly: 0=Sunday … 6=Saturday. */
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    /** Required for monthly: 1-31. Values past month-end clamp to last day. */
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    /** Required for yearly: 1-12. */
    monthOfYear: z.number().int().min(1).max(12).optional(),
    /** Local HH:MM (24h). Interpreted in `timezone`. */
    timeOfDay: z.string().regex(HHMM_PATTERN, 'timeOfDay must be HH:MM (24h)'),
    /** IANA timezone (e.g. "Pacific/Auckland"). */
    timezone: z.string().min(1),
    /** ISO date (YYYY-MM-DD). First valid occurrence is on/after this date. */
    startDate: z.string().regex(ISO_DATE_PATTERN, 'startDate must be YYYY-MM-DD'),
    /** ISO date (YYYY-MM-DD). Last valid occurrence is on/before this date. */
    endDate: z.string().regex(ISO_DATE_PATTERN, 'endDate must be YYYY-MM-DD').nullable().optional(),
    /** Stop after this many spawned tickets. */
    maxOccurrences: z.number().int().min(1).nullable().optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.pattern === 'weekly' && (!cfg.daysOfWeek || cfg.daysOfWeek.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'weekly recurrence requires at least one daysOfWeek entry',
        path: ['daysOfWeek'],
      });
    }
    if (cfg.pattern === 'monthly' && cfg.dayOfMonth == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'monthly recurrence requires dayOfMonth',
        path: ['dayOfMonth'],
      });
    }
    if (cfg.pattern === 'yearly' && (cfg.monthOfYear == null || cfg.dayOfMonth == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'yearly recurrence requires monthOfYear and dayOfMonth',
        path: ['monthOfYear'],
      });
    }
    if (cfg.endDate && cfg.endDate < cfg.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endDate must be on or after startDate',
        path: ['endDate'],
      });
    }
  });

export const recurrenceRuleSchema = z.object({
  entityType: z.literal('RECURRENCE'),
  id: z.string(),
  /** Ticket that defines the template — its current state is snapshotted on each fire. */
  templateTicketId: z.string(),
  boardId: z.string(),
  ticketTypeId: z.string(),
  /** Where spawned tickets land. Defaults to board.defaultZoneId/defaultStageId on create. */
  targetZoneId: z.string(),
  targetStageId: z.string(),
  config: z.object({
    pattern: recurrencePatternSchema,
    interval: z.number().int().min(1),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    monthOfYear: z.number().int().min(1).max(12).optional(),
    timeOfDay: z.string().regex(HHMM_PATTERN),
    timezone: z.string().min(1),
    startDate: z.string().regex(ISO_DATE_PATTERN),
    endDate: z.string().regex(ISO_DATE_PATTERN).nullable().optional(),
    maxOccurrences: z.number().int().min(1).nullable().optional(),
  }),
  /** Derived AWS Scheduler cron expression (without the wrapping `cron(...)`). */
  cronExpression: z.string(),
  /** EventBridge Scheduler resource name (== recurrence id). */
  scheduleName: z.string(),
  scheduleGroup: z.string(),
  enabled: z.boolean().default(true),
  lastRunAt: z.string().nullable().optional(),
  nextRunAt: z.string().nullable().optional(),
  runCount: z.number().int().min(0).default(0),
  lastError: z.string().nullable().optional(),
  createdBy: z.string(),
  createdByName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const userPrefSchema = z.object({
  entityType: z.literal('USER_PREF'),
  userId: z.string(),
  savedFilters: z.array(filterConfigSchema).nullable().optional(),
  columnOrder: z.array(z.string()).nullable().optional(),
  columnVisibility: z.record(z.string(), z.boolean()).nullable().optional(),
  lastViewedBoardId: z.string().nullable().optional(),
  updatedAt: z.string(),
});

// ─── CRM Entity Schemas ────────────────────────────────────────────────────────

export const contactSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  role: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  isPrimary: z.boolean().optional().default(false),
  isVip: z.boolean().optional().default(false),
  notes: z.string().optional(),
});

export const customerSchema = z.object({
  entityType: z.literal('CUSTOMER'),
  id: z.string(),
  companyName: z.string().min(1),
  industry: z.string().nullable().optional(),
  companySize: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  territory: z.string().nullable().optional(),
  lifecycleStage: z.string(),
  ownerId: z.string().nullable().optional(),
  ownerName: z.string().nullable().optional(),
  flags: z.array(z.string()).optional().default([]),
  source: z.string().nullable().optional(),
  contractStartDate: z.string().nullable().optional(),
  contractTerm: z.string().nullable().optional(),
  renewalDate: z.string().nullable().optional(),
  contractValue: z.number().nullable().optional(),
  products: z.array(z.string()).nullable().optional(),
  productNotes: z.string().nullable().optional(),
  notes: z.string().optional().default(''),
  contacts: z.array(contactSchema).optional().default([]),
  customFields: z.record(z.string(), z.unknown()).optional().default({}),
  openTicketCount: z.number().optional().default(0),
  lastContactDate: z.string().nullable().optional(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const supplierSchema = z.object({
  entityType: z.literal('SUPPLIER'),
  id: z.string(),
  companyName: z.string().min(1),
  industry: z.string().nullable().optional(),
  companySize: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  territory: z.string().nullable().optional(),
  lifecycleStage: z.string(),
  ownerId: z.string().nullable().optional(),
  ownerName: z.string().nullable().optional(),
  flags: z.array(z.string()).optional().default([]),
  source: z.string().nullable().optional(),
  notes: z.string().optional().default(''),
  contacts: z.array(contactSchema).optional().default([]),
  annualSpend: z.number().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  openTicketCount: z.number().optional().default(0),
  lastContactDate: z.string().nullable().optional(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const activitySchema = z.object({
  entityType: z.literal('ACTIVITY'),
  id: z.string(),
  parentId: z.string(),
  type: activityTypeSchema,
  direction: activityDirectionSchema.optional(),
  date: z.string(),
  duration: z.number().optional(),
  summary: z.string(),
  outcome: activityOutcomeSchema.optional(),
  nextActionDate: z.string().nullable().optional(),
  nextActionType: z.string().nullable().optional(),
  staffId: z.string().optional(),
  staffName: z.string().optional(),
  source: z.enum(['manual', 'system']).optional().default('manual'),
  createdAt: z.string(),
});

export const crmDocumentSchema = z.object({
  entityType: z.literal('DOCUMENT'),
  id: z.string(),
  parentId: z.string(),
  type: z.string(),
  name: z.string().min(1),
  s3Key: z.string(),
  s3Bucket: z.string().optional(),
  size: z.number().optional(),
  notes: z.string().optional(),
  uploadedBy: z.string(),
  uploadedAt: z.string(),
});

// ─── Request Schemas ────────────────────────────────────────────────────────────

export const createBoardZoneSchema = z.object({
  name: z.string().min(1),
  zoneType: zoneTypeSchema,
  stages: z.array(
    z.object({
      name: z.string().min(1),
      statusId: z.string(),
    })
  ),
});

/** @deprecated Use createBoardZoneSchema instead. */
export const createTeamZoneSchema = createBoardZoneSchema;

export const createBoardRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  color: z.string().optional(),
  preset: z.string().optional(),
  customStages: z
    .union([
      z.array(
        z.object({
          name: z.string(),
          zoneType: zoneTypeSchema,
          stages: z.array(z.object({ name: z.string(), statusType: statusTypeSchema })),
        })
      ),
      z.record(z.string(), z.array(z.object({ name: z.string(), statusType: statusTypeSchema }))),
    ])
    .optional(),
  allowedTicketTypes: z.array(z.string()).min(1, 'At least one ticket type is required'),
  fieldOverrides: z.record(z.string(), fieldOverrideSchema).optional(),
  workUnitSeries: workUnitSeriesSchema.nullable().optional(),
  accessControl: accessControlSchema.optional().default({ mode: 'all', users: [] }),
  zones: z.array(createBoardZoneSchema).optional(),
});

/** @deprecated Use createBoardRequestSchema instead. */
export const createTeamRequestSchema = createBoardRequestSchema;

export const updateBoardRequestSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  allowedTicketTypes: z.array(z.string()).optional(),
  fieldOverrides: z.record(z.string(), fieldOverrideSchema).optional(),
  workUnitSeries: workUnitSeriesSchema.nullable().optional(),
  accessControl: accessControlSchema.optional(),
  order: z.number().optional(),
});

/** @deprecated Use updateBoardRequestSchema instead. */
export const updateTeamRequestSchema = updateBoardRequestSchema;

export const createTicketRequestSchema = z.object({
  boardId: z.string().min(1, 'Board ID is required'),
  ticketTypeId: z.string().min(1, 'Ticket type ID is required'),
  title: z.string().min(1, 'Title is required').max(500),
  description: z.string().max(100000).optional().default(''),
  zoneId: z.string().optional(),
  stageId: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
  assigneeName: z.string().nullable().optional(),
  reporterId: z.string().nullable().optional(),
  reporterName: z.string().nullable().optional(),
  priority: prioritySchema.optional().default('medium'),
  projectId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  supplierName: z.string().nullable().optional(),
  workUnitId: z.string().nullable().optional(),
  effortPoints: z.number().nullable().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  dueDate: z.string().nullable().optional(),
  sourceType: ticketSourceTypeSchema.nullable().optional(),
  sourceId: z.string().nullable().optional(),
  sourceAppType: z.string().nullable().optional(),
});

export const updateTicketRequestSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(100000).optional(),
  zoneId: z.string().optional(),
  stageId: z.string().optional(),
  boardId: z.string().optional(),
  archived: z.boolean().optional(),
  assigneeId: z.string().nullable().optional(),
  assigneeName: z.string().nullable().optional(),
  reporterId: z.string().nullable().optional(),
  reporterName: z.string().nullable().optional(),
  priority: prioritySchema.optional(),
  projectId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  supplierName: z.string().nullable().optional(),
  workUnitId: z.string().nullable().optional(),
  effortPoints: z.number().nullable().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  dueDate: z.string().nullable().optional(),
  order: z.number().optional(),
  version: z.number({ required_error: 'Version is required for optimistic locking' }),
});

export const bulkUpdateTicketsRequestSchema = z.object({
  ticketIds: z.array(z.string()).min(1),
  changes: z.object({
    statusId: z.string().optional(),
    assigneeId: z.string().nullable().optional(),
    assigneeName: z.string().nullable().optional(),
    zoneId: z.string().optional(),
    stageId: z.string().optional(),
    priority: prioritySchema.optional(),
  }),
});

export const createCommentRequestSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  attachments: z.array(attachmentSchema).optional().default([]),
});

export const updateCommentRequestSchema = z.object({
  content: z.string().min(1, 'Content is required'),
});

export const createLinkRequestSchema = z.object({
  linkedTicketId: z.string().min(1, 'Linked ticket ID is required'),
  linkedTicketDisplayId: z.string().min(1, 'Linked ticket display ID is required'),
  linkedTicketTitle: z.string().optional(),
  linkType: linkTypeSchema,
  boardId: z.string().optional(),
  linkedBoardId: z.string().optional(),
});

export const createWorkUnitRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  goal: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

export const updateWorkUnitRequestSchema = z.object({
  name: z.string().min(1).optional(),
  goal: z.string().nullable().optional(),
  status: workUnitStatusSchema.optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  // Required when transitioning planning -> active: which board zone the sprint runs in.
  targetZoneId: z.string().optional(),
  // For active -> completed: where to roll incomplete tickets. 'next' resolves to next planning sprint.
  rolloverToWorkUnitId: z.string().optional(),
});

export const presignedUrlRequestSchema = z.object({
  context: z.enum(['ticket', 'customer', 'supplier']),
  contextId: z.string().min(1),
  fileName: z.string().min(1),
  subContext: z.string().optional(),
  subContextId: z.string().optional(),
});

export const createTicketTypeRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  prefix: ticketTypePrefixSchema,
  icon: z.string(),
  color: z.string(),
  defaultFields: z.array(z.string()),
});

export const updateTicketTypeRequestSchema = z.object({
  name: z.string().min(1).optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  defaultFields: z.array(z.string()).optional(),
  order: z.number().optional(),
});

export const createStatusRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: statusTypeSchema,
  color: z.string(),
  icon: z.string().optional(),
});

export const createFieldRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  fieldType: fieldTypeSchema,
  category: fieldCategorySchema,
  required: z.boolean().optional().default(false),
  helpText: z.string().optional(),
  defaultValue: z.unknown().optional(),
  options: z.array(z.string()).optional(),
});

export const createStaffRequestSchema = z.object({
  id: z.string().min(1, 'Cognito sub is required'),
  name: z.string().min(1, 'Name is required'),
  email: z.string().email(),
  role: z.string().optional(),
  avatarUrl: z.string().optional(),
});

export const createProjectRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  color: z.string().optional(),
});

export const createCustomerRequestSchema = z.object({
  companyName: z.string().min(1, 'Company name is required'),
  industry: z.string().nullable().optional(),
  companySize: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  territory: z.string().nullable().optional(),
  lifecycleStage: z.string(),
  ownerId: z.string().nullable().optional(),
  ownerName: z.string().nullable().optional(),
  flags: z.array(z.string()).optional(),
  source: z.string().nullable().optional(),
  contractStartDate: z.string().nullable().optional(),
  contractTerm: z.string().nullable().optional(),
  renewalDate: z.string().nullable().optional(),
  contractValue: z.number().nullable().optional(),
  products: z.array(z.string()).nullable().optional(),
  productNotes: z.string().nullable().optional(),
  notes: z.string().optional(),
  contacts: z.array(contactSchema).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export const updateCustomerRequestSchema = z.object({
  companyName: z.string().min(1).optional(),
  industry: z.string().nullable().optional(),
  companySize: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  territory: z.string().nullable().optional(),
  lifecycleStage: z.string().optional(),
  ownerId: z.string().nullable().optional(),
  ownerName: z.string().nullable().optional(),
  flags: z.array(z.string()).optional(),
  source: z.string().nullable().optional(),
  contractStartDate: z.string().nullable().optional(),
  contractTerm: z.string().nullable().optional(),
  renewalDate: z.string().nullable().optional(),
  contractValue: z.number().nullable().optional(),
  products: z.array(z.string()).nullable().optional(),
  productNotes: z.string().nullable().optional(),
  notes: z.string().optional(),
  contacts: z.array(contactSchema).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export const createSupplierRequestSchema = z.object({
  companyName: z.string().min(1, 'Company name is required'),
  industry: z.string().nullable().optional(),
  companySize: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  territory: z.string().nullable().optional(),
  lifecycleStage: z.string(),
  ownerId: z.string().nullable().optional(),
  ownerName: z.string().nullable().optional(),
  flags: z.array(z.string()).optional(),
  source: z.string().nullable().optional(),
  notes: z.string().optional(),
  contacts: z.array(contactSchema).optional(),
  annualSpend: z.number().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
});

export const updateSupplierRequestSchema = z.object({
  companyName: z.string().min(1).optional(),
  industry: z.string().nullable().optional(),
  companySize: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  territory: z.string().nullable().optional(),
  lifecycleStage: z.string().optional(),
  ownerId: z.string().nullable().optional(),
  ownerName: z.string().nullable().optional(),
  flags: z.array(z.string()).optional(),
  source: z.string().nullable().optional(),
  notes: z.string().optional(),
  contacts: z.array(contactSchema).optional(),
  annualSpend: z.number().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
});

export const createActivityRequestSchema = z.object({
  type: activityTypeSchema,
  direction: activityDirectionSchema.optional(),
  date: z.string(),
  duration: z.number().optional(),
  summary: z.string().min(1, 'Summary is required'),
  outcome: activityOutcomeSchema.optional(),
  nextActionDate: z.string().nullable().optional(),
  nextActionType: z.string().nullable().optional(),
  staffId: z.string().optional(),
  staffName: z.string().optional(),
});

export const updateActivityRequestSchema = z.object({
  type: activityTypeSchema.optional(),
  direction: activityDirectionSchema.optional(),
  date: z.string().optional(),
  duration: z.number().optional(),
  summary: z.string().min(1).optional(),
  outcome: activityOutcomeSchema.optional(),
  nextActionDate: z.string().nullable().optional(),
  nextActionType: z.string().nullable().optional(),
});

export const createDocumentRequestSchema = z.object({
  type: z.string().min(1, 'Document type is required'),
  name: z.string().min(1, 'Document name is required'),
  s3Key: z.string().min(1, 'S3 key is required'),
  s3Bucket: z.string().optional(),
  size: z.number().optional(),
  notes: z.string().optional(),
});

export const createRecurrenceRequestSchema = z.object({
  config: recurrenceConfigSchema,
  /** Optional override — defaults to board's defaultZoneId. */
  targetZoneId: z.string().optional(),
  /** Optional override — defaults to board's defaultStageId (or first stage of target zone). */
  targetStageId: z.string().optional(),
});

export const updateRecurrenceRequestSchema = z.object({
  config: recurrenceConfigSchema.optional(),
  targetZoneId: z.string().optional(),
  targetStageId: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const updateUserPrefRequestSchema = z.object({
  savedFilters: z.array(filterConfigSchema).nullable().optional(),
  columnOrder: z.array(z.string()).nullable().optional(),
  columnVisibility: z.record(z.string(), z.boolean()).nullable().optional(),
  lastViewedBoardId: z.string().nullable().optional(),
});

export const batchUpdateZonesRequestSchema = z.array(
  z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    zoneType: zoneTypeSchema,
    order: z.number(),
  })
);

export const batchUpdateStagesRequestSchema = z.array(
  z.object({
    id: z.string().optional(),
    boardId: z.string(),
    zoneId: z.string(),
    name: z.string().min(1),
    statusId: z.string(),
    workUnitId: z.string().nullable().optional(),
    order: z.number(),
  })
);

// ─── Exported Types ─────────────────────────────────────────────────────────────

export type StatusType = z.infer<typeof statusTypeSchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type ZoneType = z.infer<typeof zoneTypeSchema>;
export type BoardMode = z.infer<typeof boardModeSchema>;
export type WorkUnitStatus = z.infer<typeof workUnitStatusSchema>;
export type LinkType = z.infer<typeof linkTypeSchema>;
export type AccessControlMode = z.infer<typeof accessControlModeSchema>;
export type FieldType = z.infer<typeof fieldTypeSchema>;
export type FieldCategory = z.infer<typeof fieldCategorySchema>;
export type TicketSourceType = z.infer<typeof ticketSourceTypeSchema>;
export type ActivityType = z.infer<typeof activityTypeSchema>;
export type ActivityDirection = z.infer<typeof activityDirectionSchema>;
export type ActivityOutcome = z.infer<typeof activityOutcomeSchema>;
export type AuditAction = z.infer<typeof auditActionSchema>;
export type RecurrencePattern = z.infer<typeof recurrencePatternSchema>;
export type RecurrenceConfig = z.infer<typeof recurrenceConfigSchema>;
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

export type TicketTypeConfig = z.infer<typeof ticketTypeSchema>;
export type Status = z.infer<typeof statusSchema>;
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;
export type StaffProfile = z.infer<typeof staffProfileSchema>;
export type Project = z.infer<typeof projectSchema>;
export type LifecycleStage = z.infer<typeof lifecycleStageSchema>;
export type Flag = z.infer<typeof flagSchema>;
export type DocumentType = z.infer<typeof documentTypeSchema>;
export type CustomerRecordSection = z.infer<typeof customerRecordSectionSchema>;
export type CustomerRecordConfig = z.infer<typeof customerRecordConfigSchema>;
export type CustomerRecordLayout = z.infer<typeof customerRecordLayoutSchema>;
export type CrmConfig = z.infer<typeof crmConfigSchema>;
export type SupplierConfig = z.infer<typeof supplierConfigSchema>;
export type LinkTypeConfig = z.infer<typeof linkTypeConfigSchema>;
export type LinkConfig = z.infer<typeof linkConfigSchema>;

export type AccessControl = z.infer<typeof accessControlSchema>;
export type Board = z.infer<typeof boardSchema>;
/** @deprecated Use Board instead. */
export type Team = Board;
export type WorkUnitSeries = z.infer<typeof workUnitSeriesSchema>;
export type MirrorConfig = z.infer<typeof mirrorConfigSchema>;
export type FieldOverride = z.infer<typeof fieldOverrideSchema>;
/** @deprecated Use Board instead. */
export type ProcessBoard = Board;
export type WorkZone = z.infer<typeof workZoneSchema>;
export type WorkStage = z.infer<typeof workStageSchema>;
export type Ticket = z.infer<typeof ticketSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type TicketLink = z.infer<typeof ticketLinkSchema>;
export type WorkUnit = z.infer<typeof workUnitSchema>;
export type AuditChange = z.infer<typeof auditChangeSchema>;
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type FilterConfig = z.infer<typeof filterConfigSchema>;
export type UserPref = z.infer<typeof userPrefSchema>;

export type Contact = z.infer<typeof contactSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type Supplier = z.infer<typeof supplierSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type CrmDocument = z.infer<typeof crmDocumentSchema>;

export type CreateBoardRequest = z.infer<typeof createBoardRequestSchema>;
export type UpdateBoardRequest = z.infer<typeof updateBoardRequestSchema>;
/** @deprecated Use CreateBoardRequest instead. */
export type CreateTeamRequest = CreateBoardRequest;
/** @deprecated Use UpdateBoardRequest instead. */
export type UpdateTeamRequest = UpdateBoardRequest;
export type CreateTicketRequest = z.infer<typeof createTicketRequestSchema>;
export type UpdateTicketRequest = z.infer<typeof updateTicketRequestSchema>;
export type BulkUpdateTicketsRequest = z.infer<typeof bulkUpdateTicketsRequestSchema>;
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;
export type UpdateCommentRequest = z.infer<typeof updateCommentRequestSchema>;
export type CreateLinkRequest = z.infer<typeof createLinkRequestSchema>;
export type CreateWorkUnitRequest = z.infer<typeof createWorkUnitRequestSchema>;
export type UpdateWorkUnitRequest = z.infer<typeof updateWorkUnitRequestSchema>;
export type PresignedUrlRequest = z.infer<typeof presignedUrlRequestSchema>;
export type CreateTicketTypeRequest = z.infer<typeof createTicketTypeRequestSchema>;
export type UpdateTicketTypeRequest = z.infer<typeof updateTicketTypeRequestSchema>;
export type CreateStatusRequest = z.infer<typeof createStatusRequestSchema>;
export type CreateFieldRequest = z.infer<typeof createFieldRequestSchema>;
export type CreateStaffRequest = z.infer<typeof createStaffRequestSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type CreateCustomerRequest = z.infer<typeof createCustomerRequestSchema>;
export type UpdateCustomerRequest = z.infer<typeof updateCustomerRequestSchema>;
export type CreateSupplierRequest = z.infer<typeof createSupplierRequestSchema>;
export type UpdateSupplierRequest = z.infer<typeof updateSupplierRequestSchema>;
export type CreateActivityRequest = z.infer<typeof createActivityRequestSchema>;
export type UpdateActivityRequest = z.infer<typeof updateActivityRequestSchema>;
export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>;
export type UpdateUserPrefRequest = z.infer<typeof updateUserPrefRequestSchema>;
export type CreateRecurrenceRequest = z.infer<typeof createRecurrenceRequestSchema>;
export type UpdateRecurrenceRequest = z.infer<typeof updateRecurrenceRequestSchema>;

// ─── Aggregated Config Response ─────────────────────────────────────────────────

export type OpsConfigResponse = {
  ticketTypes: TicketTypeConfig[];
  statuses: Status[];
  fields: FieldDefinition[];
  staff: StaffProfile[];
  projects: Project[];
  crmConfig: CrmConfig | null;
  supplierConfig: SupplierConfig | null;
  linkConfig: LinkConfig | null;
};
