// Default seed data for Numa Ops configuration.
// Written to DynamoDB by the seed Lambda on first deploy.
// All items use the ops-config table key pattern: PK=CONFIG, SK={entity}#{id}

const now = new Date().toISOString();

// ─── Ticket Types ───────────────────────────────────────────────────────────────

export const DEFAULT_TICKET_TYPES = [
  {
    PK: 'CONFIG',
    SK: 'TICKET_TYPE#tt-feature',
    entityType: 'TICKET_TYPE',
    id: 'tt-feature',
    name: 'Feature',
    prefix: 'FEAT',
    icon: 'sparkles',
    color: 'indigo',
    defaultFields: [
      'field-name',
      'field-description',
      'field-priority',
      'field-assignee',
      'field-effort-points',
      'field-work-unit-id',
      'field-client',
      'field-due-date',
    ],
    order: 1,
    createdAt: now,
    updatedAt: now,
  },
  {
    PK: 'CONFIG',
    SK: 'TICKET_TYPE#tt-bug',
    entityType: 'TICKET_TYPE',
    id: 'tt-bug',
    name: 'Bug',
    prefix: 'BUG',
    icon: 'stop',
    color: 'red',
    defaultFields: [
      'field-name',
      'field-description',
      'field-priority',
      'field-assignee',
      'field-severity',
      'field-work-unit-id',
      'field-client',
      'field-due-date',
    ],
    order: 2,
    createdAt: now,
    updatedAt: now,
  },
  {
    PK: 'CONFIG',
    SK: 'TICKET_TYPE#tt-task',
    entityType: 'TICKET_TYPE',
    id: 'tt-task',
    name: 'Task',
    prefix: 'TASK',
    icon: 'clipboard',
    color: 'blue',
    defaultFields: [
      'field-name',
      'field-description',
      'field-priority',
      'field-assignee',
      'field-effort-points',
      'field-work-unit-id',
      'field-due-date',
    ],
    order: 3,
    createdAt: now,
    updatedAt: now,
  },
  {
    PK: 'CONFIG',
    SK: 'TICKET_TYPE#tt-service-request',
    entityType: 'TICKET_TYPE',
    id: 'tt-service-request',
    name: 'Service Request',
    prefix: 'SRQ',
    icon: 'ticket',
    color: 'green',
    defaultFields: [
      'field-name',
      'field-description',
      'field-priority',
      'field-assignee',
      'field-client',
      'field-work-unit-id',
      'field-due-date',
    ],
    order: 4,
    createdAt: now,
    updatedAt: now,
  },
];

// ─── Statuses ───────────────────────────────────────────────────────────────────

export const DEFAULT_STATUSES = [
  { id: 'new', name: 'New', type: 'backlog', color: 'gray', icon: 'circle', order: 1 },
  { id: 'backlog', name: 'Backlog', type: 'backlog', color: 'gray', icon: 'inbox', order: 2 },
  { id: 'ready', name: 'Ready', type: 'scoped', color: 'blue', icon: 'check-circle', order: 3 },
  { id: 'todo', name: 'To Do', type: 'queued', color: 'cyan', icon: 'list', order: 4 },
  { id: 'in-progress', name: 'In Progress', type: 'active', color: 'yellow', icon: 'play', order: 5 },
  { id: 'blocked', name: 'Blocked', type: 'active', color: 'red', icon: 'ban', order: 6 },
  { id: 'review', name: 'Review', type: 'active', color: 'purple', icon: 'eye', order: 7 },
  { id: 'completed', name: 'Completed', type: 'completed', color: 'green', icon: 'check', order: 8 },
  { id: 'cancelled', name: 'Cancelled', type: 'ended', color: 'gray', icon: 'x', order: 9 },
  { id: 'deleted', name: 'Deleted', type: 'deleted', color: 'gray', icon: 'trash', order: 10 },
].map((s) => ({
  PK: 'CONFIG',
  SK: `STATUS#${s.id}`,
  entityType: 'STATUS',
  ...s,
  isPredefined: true,
  createdAt: now,
  updatedAt: now,
}));

// ─── Field Definitions ──────────────────────────────────────────────────────────

interface FieldDef {
  id: string;
  name: string;
  fieldType: string;
  category: string;
  helpText?: string;
  options?: string[];
  required?: boolean;
  isSystem?: boolean;
}

const commonFields: FieldDef[] = [
  { id: 'field-name', name: 'Name', fieldType: 'text', category: 'common', required: true, isSystem: true },
  { id: 'field-description', name: 'Description', fieldType: 'richtext', category: 'common', isSystem: true },
  {
    id: 'field-priority',
    name: 'Priority',
    fieldType: 'select',
    category: 'common',
    options: ['highest', 'high', 'medium', 'low', 'lowest'],
    isSystem: true,
  },
  { id: 'field-assignee', name: 'Assignee', fieldType: 'user', category: 'common', isSystem: true },
  { id: 'field-reporter', name: 'Reporter', fieldType: 'user', category: 'common' },
  { id: 'field-due-date', name: 'Due Date', fieldType: 'date', category: 'common' },
  {
    id: 'field-labels',
    name: 'Labels',
    fieldType: 'multiselect',
    category: 'common',
    helpText: 'Tags for categorisation',
  },
  { id: 'field-client', name: 'Client', fieldType: 'customer', category: 'common', helpText: 'Linked customer' },
  { id: 'field-project', name: 'Project', fieldType: 'project', category: 'common' },
  { id: 'field-work-unit-id', name: 'Sprint / Work Unit', fieldType: 'workunit', category: 'common' },
  { id: 'field-watchers', name: 'Watchers', fieldType: 'multiselect', category: 'common' },
];

const developmentFields: FieldDef[] = [
  {
    id: 'field-effort-points',
    name: 'Effort Points',
    fieldType: 'number',
    category: 'development',
    helpText: 'Story points or effort estimate',
  },
  {
    id: 'field-work-category',
    name: 'Work Category',
    fieldType: 'select',
    category: 'development',
    options: ['Feature', 'Bug Fix', 'Refactor', 'Infrastructure', 'Documentation', 'Testing'],
  },
  { id: 'field-git-branch', name: 'Git Branch', fieldType: 'text', category: 'development' },
  { id: 'field-pull-request', name: 'Pull Request', fieldType: 'url', category: 'development' },
  { id: 'field-test-coverage', name: 'Test Coverage', fieldType: 'percentage', category: 'development' },
  { id: 'field-acceptance-criteria', name: 'Acceptance Criteria', fieldType: 'richtext', category: 'development' },
  { id: 'field-technical-notes', name: 'Technical Notes', fieldType: 'richtext', category: 'development' },
  {
    id: 'field-environment',
    name: 'Environment',
    fieldType: 'select',
    category: 'development',
    options: ['Development', 'Staging', 'Production', 'All'],
  },
  { id: 'field-estimated-hours', name: 'Estimated Hours', fieldType: 'number', category: 'development' },
  { id: 'field-actual-hours', name: 'Actual Hours', fieldType: 'number', category: 'development' },
];

const callCentreFields: FieldDef[] = [
  {
    id: 'field-severity',
    name: 'Severity',
    fieldType: 'select',
    category: 'support',
    options: ['Critical', 'Major', 'Minor', 'Trivial'],
  },
  {
    id: 'field-issue-type',
    name: 'Issue Type',
    fieldType: 'select',
    category: 'support',
    options: ['Bug', 'Enhancement', 'Question', 'Incident'],
  },
  {
    id: 'field-resolution',
    name: 'Resolution',
    fieldType: 'select',
    category: 'support',
    options: ['Fixed', "Won't Fix", 'Duplicate', 'Cannot Reproduce', 'By Design'],
  },
  {
    id: 'field-sla-status',
    name: 'SLA Status',
    fieldType: 'select',
    category: 'support',
    options: ['Within SLA', 'At Risk', 'Breached'],
  },
  {
    id: 'field-escalation-level',
    name: 'Escalation Level',
    fieldType: 'select',
    category: 'support',
    options: ['L1', 'L2', 'L3', 'Management'],
  },
  {
    id: 'field-customer-satisfaction',
    name: 'Customer Satisfaction',
    fieldType: 'select',
    category: 'support',
    options: ['Very Satisfied', 'Satisfied', 'Neutral', 'Dissatisfied', 'Very Dissatisfied'],
  },
  {
    id: 'field-contact-method',
    name: 'Contact Method',
    fieldType: 'select',
    category: 'support',
    options: ['Phone', 'Email', 'Chat', 'Portal', 'Social'],
  },
  {
    id: 'field-response-time',
    name: 'Response Time',
    fieldType: 'text',
    category: 'support',
    helpText: 'Time to first response',
  },
  {
    id: 'field-resolution-time',
    name: 'Resolution Time',
    fieldType: 'text',
    category: 'support',
    helpText: 'Total time to resolution',
  },
  {
    id: 'field-knowledge-base',
    name: 'Knowledge Base',
    fieldType: 'url',
    category: 'support',
    helpText: 'Related KB article',
  },
];

const crmFields: FieldDef[] = [
  {
    id: 'field-deal-type',
    name: 'Deal Type',
    fieldType: 'select',
    category: 'crm',
    options: ['New Business', 'Expansion', 'Renewal', 'Upsell'],
  },
  { id: 'field-deal-value', name: 'Deal Value', fieldType: 'currency', category: 'crm' },
  { id: 'field-probability', name: 'Probability', fieldType: 'percentage', category: 'crm' },
  { id: 'field-expected-close-date', name: 'Expected Close Date', fieldType: 'date', category: 'crm' },
  {
    id: 'field-lead-source',
    name: 'Lead Source',
    fieldType: 'select',
    category: 'crm',
    options: ['Inbound', 'Outbound', 'Referral', 'Partner', 'Event', 'Website'],
  },
  { id: 'field-competitor', name: 'Competitor', fieldType: 'text', category: 'crm' },
  { id: 'field-next-action', name: 'Next Action', fieldType: 'text', category: 'crm' },
  { id: 'field-next-action-date', name: 'Next Action Date', fieldType: 'date', category: 'crm' },
  { id: 'field-decision-maker', name: 'Decision Maker', fieldType: 'text', category: 'crm' },
  {
    id: 'field-engagement-type',
    name: 'Engagement Type',
    fieldType: 'select',
    category: 'crm',
    options: ['Discovery', 'Demo', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'],
  },
  { id: 'field-contract-value', name: 'Contract Value', fieldType: 'currency', category: 'crm' },
  { id: 'field-renewal-date', name: 'Renewal Date', fieldType: 'date', category: 'crm' },
];

const operationsFields: FieldDef[] = [
  { id: 'field-supplier', name: 'Supplier', fieldType: 'supplier', category: 'operations' },
  {
    id: 'field-service-type',
    name: 'Service Type',
    fieldType: 'select',
    category: 'operations',
    options: ['Maintenance', 'Installation', 'Repair', 'Inspection', 'Consulting'],
  },
  { id: 'field-location', name: 'Location', fieldType: 'text', category: 'operations' },
  { id: 'field-scheduled-date', name: 'Scheduled Date', fieldType: 'date', category: 'operations' },
  { id: 'field-completion-date', name: 'Completion Date', fieldType: 'date', category: 'operations' },
  { id: 'field-materials', name: 'Materials', fieldType: 'richtext', category: 'operations' },
  { id: 'field-cost', name: 'Cost', fieldType: 'currency', category: 'operations' },
  {
    id: 'field-approval-status',
    name: 'Approval Status',
    fieldType: 'select',
    category: 'operations',
    options: ['Pending', 'Approved', 'Rejected', 'On Hold'],
  },
  { id: 'field-approver', name: 'Approver', fieldType: 'user', category: 'operations' },
  { id: 'field-vendor', name: 'Vendor', fieldType: 'text', category: 'operations' },
  { id: 'field-purchase-order', name: 'Purchase Order', fieldType: 'text', category: 'operations' },
  { id: 'field-invoice', name: 'Invoice', fieldType: 'text', category: 'operations' },
  { id: 'field-warranty-expiry', name: 'Warranty Expiry', fieldType: 'date', category: 'operations' },
  { id: 'field-asset-tag', name: 'Asset Tag', fieldType: 'text', category: 'operations' },
  { id: 'field-serial-number', name: 'Serial Number', fieldType: 'text', category: 'operations' },
  { id: 'field-notes', name: 'Notes', fieldType: 'richtext', category: 'operations' },
];

const allFields = [...commonFields, ...developmentFields, ...callCentreFields, ...crmFields, ...operationsFields];

export const DEFAULT_FIELDS = allFields.map((f, idx) => ({
  PK: 'CONFIG',
  SK: `FIELD#${f.id}`,
  entityType: 'FIELD',
  id: f.id,
  name: f.name,
  fieldType: f.fieldType,
  category: f.category,
  required: f.required ?? false,
  helpText: f.helpText ?? '',
  options: f.options ?? [],
  isSystem: f.isSystem ?? false,
  order: idx + 1,
  createdAt: now,
  updatedAt: now,
}));

// ─── CRM Config ─────────────────────────────────────────────────────────────────

export const DEFAULT_CRM_CONFIG = {
  PK: 'CONFIG',
  SK: 'CRM_CONFIG',
  entityType: 'CRM_CONFIG',
  lifecycleStages: [
    { id: 'stage-prospect', name: 'Prospect', colorPosition: 10 },
    { id: 'stage-active', name: 'Active', colorPosition: 6 },
    { id: 'stage-at-risk', name: 'At Risk', colorPosition: 3 },
    { id: 'stage-churned', name: 'Churned', colorPosition: 1 },
  ],
  customerFlags: [
    { id: 'flag-vip', name: 'VIP', color: 'amber' },
    { id: 'flag-strategic', name: 'Strategic', color: 'indigo' },
  ],
  documentTypes: [
    { id: 'doc-contract', name: 'Contract' },
    { id: 'doc-proposal', name: 'Proposal' },
    { id: 'doc-sla', name: 'SLA' },
    { id: 'doc-other', name: 'Other' },
  ],
  territories: ['Auckland', 'Wellington', 'Christchurch', 'Other'],
  industries: [
    'Agriculture',
    'Aviation',
    'Construction',
    'Education',
    'Environmental',
    'Finance',
    'Food & Beverage',
    'Government',
    'Healthcare',
    'Logistics',
    'Manufacturing',
    'Media',
    'Non-profit',
    'Professional Services',
    'Real Estate',
    'Retail',
    'Security',
    'Sports & Recreation',
    'Technology',
    'Tourism',
    'Other',
  ],
  defaultStageId: 'stage-prospect',
  updatedAt: now,
};

// ─── Supplier Config ────────────────────────────────────────────────────────────

export const DEFAULT_SUPPLIER_CONFIG = {
  PK: 'CONFIG',
  SK: 'SUPPLIER_CONFIG',
  entityType: 'SUPPLIER_CONFIG',
  lifecycleStages: [
    { id: 'sup-stage-potential', name: 'Potential', colorPosition: 10 },
    { id: 'sup-stage-approved', name: 'Approved', colorPosition: 7 },
    { id: 'sup-stage-preferred', name: 'Preferred', colorPosition: 6 },
    { id: 'sup-stage-inactive', name: 'Inactive', colorPosition: 1 },
  ],
  supplierFlags: [
    { id: 'sup-flag-preferred', name: 'Preferred', icon: 'star', color: 'amber' },
    { id: 'sup-flag-iso', name: 'ISO Certified', icon: 'check', color: 'green' },
    { id: 'sup-flag-sole-source', name: 'Sole Source', icon: 'lock', color: 'purple' },
  ],
  documentTypes: [
    { id: 'sup-doc-contract', name: 'Contract' },
    { id: 'sup-doc-quote', name: 'Quote' },
    { id: 'sup-doc-invoice', name: 'Invoice' },
    { id: 'sup-doc-certificate', name: 'Certificate' },
    { id: 'sup-doc-sla', name: 'SLA' },
  ],
  defaultStageId: 'sup-stage-potential',
  updatedAt: now,
};

// ─── Link Config ────────────────────────────────────────────────────────────────

export const DEFAULT_LINK_CONFIG = {
  PK: 'CONFIG',
  SK: 'LINK_CONFIG',
  entityType: 'LINK_CONFIG',
  linkTypes: [
    { id: 'depends_on', name: 'Depends on', inverse: 'blocks', icon: 'clock', causesBlocked: true },
    { id: 'blocks', name: 'Blocks', inverse: 'depends_on', icon: 'ban', causesBlocked: false },
    { id: 'related_to', name: 'Related to', inverse: 'related_to', icon: 'link', causesBlocked: false },
  ],
  updatedAt: now,
};

// ─── Prefix Registry (written to ops table, not ops-config) ─────────────────────

export const DEFAULT_PREFIX_REGISTRY = [
  {
    PK: 'PREFIX',
    SK: 'FEAT',
    entityType: 'PREFIX_REGISTRY',
    prefix: 'FEAT',
    nextSequence: 1,
    ticketTypeId: 'tt-feature',
  },
  { PK: 'PREFIX', SK: 'BUG', entityType: 'PREFIX_REGISTRY', prefix: 'BUG', nextSequence: 1, ticketTypeId: 'tt-bug' },
  { PK: 'PREFIX', SK: 'TASK', entityType: 'PREFIX_REGISTRY', prefix: 'TASK', nextSequence: 1, ticketTypeId: 'tt-task' },
  {
    PK: 'PREFIX',
    SK: 'SRQ',
    entityType: 'PREFIX_REGISTRY',
    prefix: 'SRQ',
    nextSequence: 1,
    ticketTypeId: 'tt-service-request',
  },
];
