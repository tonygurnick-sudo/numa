import type { StatusType, ZoneType, TeamPreset } from '../types/ops';

// ─── Zone-to-Status-Type Mapping ────────────────────────────────────────────
//
// Core constraint: a stage's statusType MUST be allowed for its parent zone.
// Board zones support the full workflow. Backlog zones are for triaging and
// scoping work before it enters a board.

export const ZONE_STATUS_TYPES: Record<ZoneType, StatusType[]> = {
  board: ['queued', 'active', 'completed', 'ended'],
  backlog: ['backlog', 'scoped', 'queued'],
};

// Reverse lookup: given a statusType, which zones can it live in?
export const STATUS_TYPE_TO_ZONES: Record<StatusType, ZoneType[]> = {
  backlog: ['backlog'],
  scoped: ['backlog'],
  queued: ['board', 'backlog'],
  active: ['board'],
  completed: ['board'],
  ended: ['board'],
  deleted: ['board'],
};

// ─── Default Zones ──────────────────────────────────────────────────────────

export const DEFAULT_ZONES: { name: string; zoneType: ZoneType; order: number }[] = [
  { name: 'Product Backlog', zoneType: 'backlog', order: 1000 },
  { name: 'Board', zoneType: 'board', order: 2000 },
];

// ─── Default Fields per Ticket Type Prefix ─────────────────────────────────
//
// When the board wizard creates a new ticket type, it uses this map to assign
// sensible defaultFields rather than an empty array.  Matches the seed data
// in seed-ops-config/seed-data.ts so dynamically created types are consistent
// with pre-seeded ones.

const BASE_FIELDS = ['field-name', 'field-description', 'field-priority', 'field-assignee'];

export const DEFAULT_FIELDS_BY_PREFIX: Record<string, string[]> = {};

/** Returns the default fields for a given ticket type prefix, or fallback base fields. */
export const getDefaultFieldsForPrefix = (prefix: string): string[] => DEFAULT_FIELDS_BY_PREFIX[prefix] ?? BASE_FIELDS;

// ─── Team Presets ───────────────────────────────────────────────────────────
//
// Presets define the default zones and stages when creating a new team.
// Each preset is zone-centric: it defines an array of zones, each with its
// own stages.

export type PresetStage = {
  name: string;
  statusType: StatusType;
};

export type PresetZone = {
  name: string;
  zoneType: ZoneType;
  stages: PresetStage[];
};

export type TeamPresetConfig = {
  id: string;
  name: string;
  description: string;
  mode: TeamPreset;
  zones: PresetZone[];
  allowedTicketTypePrefixes?: string[];
  suggestedTicketTypes?: { name: string; prefix: string; icon: string; color: string }[];
};

export const TEAM_PRESETS: TeamPresetConfig[] = [
  {
    id: 'standard',
    name: 'Blank Board',
    description: 'Empty template to build your board from scratch.',
    mode: 'normal' as TeamPreset,
    zones: [
      {
        name: 'Backlog',
        zoneType: 'backlog',
        stages: [
          { name: 'New', statusType: 'backlog' },
          { name: 'Ready', statusType: 'scoped' },
        ],
      },
      {
        name: 'Board',
        zoneType: 'board',
        stages: [
          { name: 'To Do', statusType: 'queued' },
          { name: 'In Progress', statusType: 'active' },
          { name: 'Done', statusType: 'completed' },
        ],
      },
    ],
  },
  {
    id: 'development',
    name: 'Product Development',
    description: 'Backlog + Sprints. Perfect for software engineering and product teams.',
    mode: 'development',
    zones: [
      {
        name: 'Backlog',
        zoneType: 'backlog',
        stages: [
          { name: 'New', statusType: 'backlog' },
          { name: 'Ready', statusType: 'scoped' },
        ],
      },
      {
        name: 'Sprint',
        zoneType: 'board',
        stages: [
          { name: 'To Do', statusType: 'queued' },
          { name: 'In Progress', statusType: 'active' },
          { name: 'Review', statusType: 'active' },
          { name: 'Done', statusType: 'completed' },
        ],
      },
    ],
    allowedTicketTypePrefixes: ['FEAT', 'BUG', 'TASK'],
    suggestedTicketTypes: [
      { name: 'Feature', prefix: 'FEAT', icon: 'sparkles', color: '#0d6efd' },
      { name: 'Bug', prefix: 'BUG', icon: 'stop', color: '#dc3545' },
      { name: 'Task', prefix: 'TASK', icon: 'clipboard', color: '#0dcaf0' },
    ],
  },
  {
    id: 'support',
    name: 'Support Desk',
    description: 'Kanban board for managing incoming tickets and requests.',
    mode: 'support',
    zones: [
      {
        name: 'Tickets',
        zoneType: 'board',
        stages: [
          { name: 'New', statusType: 'queued' },
          { name: 'Investigating', statusType: 'active' },
          { name: 'Pending', statusType: 'queued' },
          { name: 'Resolved', statusType: 'completed' },
        ],
      },
    ],
    allowedTicketTypePrefixes: ['SUPP', 'BUG', 'SRQ'],
    suggestedTicketTypes: [
      { name: 'Support', prefix: 'SUPP', icon: 'ticket', color: '#ffc107' },
      { name: 'Bug', prefix: 'BUG', icon: 'stop', color: '#dc3545' },
      { name: 'Service Request', prefix: 'SRQ', icon: 'inbox', color: '#198754' },
    ],
  },
  {
    id: 'monthly',
    name: 'Monthly Cycles',
    description: 'Backlog + Board planned in monthly periods (e.g., Marketing, Finance).',
    mode: 'monthly',
    zones: [
      {
        name: 'Pipeline',
        zoneType: 'backlog',
        stages: [
          { name: 'New', statusType: 'backlog' },
          { name: 'Quoted / Approved', statusType: 'scoped' },
        ],
      },
      {
        name: 'Board',
        zoneType: 'board',
        stages: [
          { name: 'Queued', statusType: 'queued' },
          { name: 'In Progress', statusType: 'active' },
          { name: 'Done', statusType: 'completed' },
        ],
      },
    ],
    allowedTicketTypePrefixes: ['TASK', 'REQ', 'MILE'],
    suggestedTicketTypes: [
      { name: 'Task', prefix: 'TASK', icon: 'clipboard', color: '#0dcaf0' },
      { name: 'Request', prefix: 'REQ', icon: 'inbox', color: '#fd7e14' },
      { name: 'Milestone', prefix: 'MILE', icon: 'flag', color: '#6f42c1' },
    ],
  },
  {
    id: 'solo',
    name: 'Solo Consultant',
    description: 'Simple kanban for managing personal client work.',
    mode: 'solo',
    zones: [
      {
        name: 'Work',
        zoneType: 'board',
        stages: [
          { name: 'Inbox', statusType: 'queued' },
          { name: 'Active', statusType: 'active' },
          { name: 'Waiting', statusType: 'queued' },
          { name: 'Done', statusType: 'completed' },
        ],
      },
    ],
    allowedTicketTypePrefixes: ['TASK', 'NOTE'],
    suggestedTicketTypes: [
      { name: 'Task', prefix: 'TASK', icon: 'clipboard', color: '#0dcaf0' },
      { name: 'Note', prefix: 'NOTE', icon: 'journal-text', color: '#6c757d' },
    ],
  },
  {
    id: 'simple',
    name: 'Basic Kanban',
    description: 'Single board zone with simple columns (To Do / In Progress / Done).',
    mode: 'basic',
    zones: [
      {
        name: 'Board',
        zoneType: 'board',
        stages: [
          { name: 'To Do', statusType: 'queued' },
          { name: 'In Progress', statusType: 'active' },
          { name: 'Done', statusType: 'completed' },
        ],
      },
    ],
    allowedTicketTypePrefixes: ['TASK'],
    suggestedTicketTypes: [{ name: 'Task', prefix: 'TASK', icon: 'clipboard', color: '#0dcaf0' }],
  },
  {
    id: 'mining',
    name: 'Mining / Logistics',
    description: 'Specialized for heavy equipment and logistics (Workshops / Repairs / Transport).',
    mode: 'basic',
    zones: [
      {
        name: 'Logistics',
        zoneType: 'board',
        stages: [
          { name: 'Planned', statusType: 'queued' },
          { name: 'In Transit', statusType: 'active' },
          { name: 'Arrived', statusType: 'active' },
          { name: 'Unloaded', statusType: 'completed' },
        ],
      },
      {
        name: 'Maintenance',
        zoneType: 'board',
        stages: [
          { name: 'Workshop', statusType: 'queued' },
          { name: 'Repairs', statusType: 'active' },
          { name: 'Testing', statusType: 'active' },
          { name: 'Released', statusType: 'completed' },
        ],
      },
    ],
    allowedTicketTypePrefixes: ['REP', 'LOGI', 'EQUIP'],
    suggestedTicketTypes: [
      { name: 'Repair', prefix: 'REP', icon: 'wrench', color: '#fd7e14' },
      { name: 'Logistics', prefix: 'LOGI', icon: 'truck', color: '#6610f2' },
      { name: 'Equipment', prefix: 'EQUIP', icon: 'box', color: '#198754' },
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise Portfolio',
    description: 'High-level oversight for multi-project organizations. Focuses on roadmap and cross-team delivery.',
    mode: 'monthly',
    zones: [
      {
        name: 'Portfolio Backlog',
        zoneType: 'backlog',
        stages: [
          { name: 'Idea', statusType: 'backlog' },
          { name: 'Business Case', statusType: 'scoped' },
          { name: 'Approved', statusType: 'queued' },
        ],
      },
      {
        name: 'Execution',
        zoneType: 'board',
        stages: [
          { name: 'Initiated', statusType: 'active' },
          { name: 'Delivering', statusType: 'active' },
          { name: 'Review', statusType: 'active' },
          { name: 'Closed', statusType: 'completed' },
        ],
      },
    ],
    allowedTicketTypePrefixes: ['PROJ', 'EPIC', 'STRAT'],
    suggestedTicketTypes: [
      { name: 'Project', prefix: 'PROJ', icon: 'folder', color: '#0d6efd' },
      { name: 'Epic', prefix: 'EPIC', icon: 'diagram-3', color: '#6f42c1' },
      { name: 'Strategy', prefix: 'STRAT', icon: 'compass', color: '#d63384' },
    ],
  },
  {
    id: 'work_mgmt',
    name: 'Work Management',
    description: 'Essential workflows for teams managing various tasks, requests, and simple projects.',
    mode: 'basic',
    zones: [
      {
        name: 'Board',
        zoneType: 'board',
        stages: [
          { name: 'To Do', statusType: 'queued' },
          { name: 'Doing', statusType: 'active' },
          { name: 'Blocked', statusType: 'queued' },
          { name: 'Done', statusType: 'completed' },
        ],
      },
    ],
    allowedTicketTypePrefixes: ['TASK', 'REQ', 'INFO'],
    suggestedTicketTypes: [
      { name: 'Task', prefix: 'TASK', icon: 'clipboard', color: '#0dcaf0' },
      { name: 'Request', prefix: 'REQ', icon: 'inbox', color: '#fd7e14' },
      { name: 'Information', prefix: 'INFO', icon: 'info-circle', color: '#0d6efd' },
    ],
  },
  {
    id: 'supplier',
    name: 'Supplier Management',
    description: 'Manage onboarding, reviews, and ongoing tracking of external suppliers.',
    mode: 'basic',
    zones: [
      {
        name: 'Suppliers',
        zoneType: 'board',
        stages: [
          { name: 'Potential', statusType: 'queued' },
          { name: 'Onboarding', statusType: 'active' },
          { name: 'Active', statusType: 'completed' },
          { name: 'Inactive', statusType: 'ended' },
        ],
      },
    ],
    allowedTicketTypePrefixes: ['SUPP', 'VEND'],
    suggestedTicketTypes: [
      { name: 'Supplier', prefix: 'SUPP', icon: 'building', color: '#20c997' },
      { name: 'Vendor Task', prefix: 'VEND', icon: 'briefcase', color: '#6c757d' },
    ],
  },
  {
    id: 'software',
    name: 'Software Engineering',
    description: 'Sprint-based board for software development teams.',
    mode: 'development',
    zones: [
      {
        name: 'Backlog',
        zoneType: 'backlog',
        stages: [
          { name: 'New', statusType: 'backlog' },
          { name: 'Ready', statusType: 'scoped' },
        ],
      },
      {
        name: 'Sprint',
        zoneType: 'board',
        stages: [
          { name: 'To Do', statusType: 'queued' },
          { name: 'In Progress', statusType: 'active' },
          { name: 'Code Review', statusType: 'active' },
          { name: 'Done', statusType: 'completed' },
        ],
      },
    ],
    allowedTicketTypePrefixes: ['FEAT', 'BUG', 'CHORE'],
    suggestedTicketTypes: [
      { name: 'Feature', prefix: 'FEAT', icon: 'sparkles', color: '#0d6efd' },
      { name: 'Bug', prefix: 'BUG', icon: 'stop', color: '#dc3545' },
      { name: 'Chore', prefix: 'CHORE', icon: 'tools', color: '#6c757d' },
    ],
  },
  {
    id: 'sales',
    name: 'Sales Pipeline',
    description: 'Track deals and leads through lifecycle stages.',
    mode: 'basic',
    zones: [
      {
        name: 'Sales Playbook',
        zoneType: 'board',
        stages: [
          { name: 'Cold Call', statusType: 'queued' },
          { name: 'Workshop #1', statusType: 'active' },
          { name: 'Email #1', statusType: 'active' },
          { name: 'Implementation Plan', statusType: 'active' },
          { name: 'Champions', statusType: 'active' },
          { name: 'Email #2', statusType: 'active' },
          { name: 'Workshop #2', statusType: 'active' },
          { name: 'Proposal', statusType: 'active' },
          { name: 'Commercials', statusType: 'active' },
          { name: 'Contract Sent', statusType: 'completed' },
        ],
      },
    ],
    allowedTicketTypePrefixes: ['LEAD', 'DEAL', 'RENEW'],
    suggestedTicketTypes: [
      { name: 'Lead', prefix: 'LEAD', icon: 'person', color: '#198754' },
      { name: 'Deal', prefix: 'DEAL', icon: 'currency-dollar', color: '#ffc107' },
      { name: 'Renewal', prefix: 'RENEW', icon: 'arrow-repeat', color: '#0dcaf0' },
    ],
  },
  {
    id: 'legal',
    name: 'Legal Case Management',
    description: 'Organize legal briefs, matters, and compliance tasks.',
    mode: 'basic',
    zones: [
      {
        name: 'Cases',
        zoneType: 'board',
        stages: [
          { name: 'Intake', statusType: 'queued' },
          { name: 'Discovery', statusType: 'active' },
          { name: 'Drafting', statusType: 'active' },
          { name: 'Filed', statusType: 'completed' },
        ],
      },
    ],
    allowedTicketTypePrefixes: ['CASE', 'COMP', 'DOC'],
    suggestedTicketTypes: [
      { name: 'Case', prefix: 'CASE', icon: 'briefcase', color: '#6c757d' },
      { name: 'Compliance', prefix: 'COMP', icon: 'shield-check', color: '#198754' },
      { name: 'Document', prefix: 'DOC', icon: 'file-text', color: '#0dcaf0' },
    ],
  },
];

// ─── Zone Type Badge Colors ─────────────────────────────────────────────────

export const ZONE_TYPE_BADGE_COLORS: Record<ZoneType, string> = {
  board: 'primary',
  backlog: 'secondary',
};

// ─── Team Preset Metadata ───────────────────────────────────────────────────

export type TeamPresetInfo = {
  mode: TeamPreset;
  name: string;
  nameKey: string;
  descriptionKey: string;
  defaultPreset: string;
};

export const TEAM_PRESETS_INFO: TeamPresetInfo[] = [
  {
    mode: 'normal' as TeamPreset,
    name: 'Empty Template',
    nameKey: 'teams.modeStandard',
    descriptionKey: 'teams.modeStandardDesc',
    defaultPreset: 'standard',
  },
  {
    mode: 'development',
    name: 'Product Development',
    nameKey: 'teams.modeDevelopment',
    descriptionKey: 'teams.modeDevelopmentDesc',
    defaultPreset: 'development',
  },
  {
    mode: 'support',
    name: 'Support Desk',
    nameKey: 'teams.modeSupport',
    descriptionKey: 'teams.modeSupportDesc',
    defaultPreset: 'support',
  },
  {
    mode: 'monthly',
    name: 'Monthly Cycles',
    nameKey: 'teams.modeMonthly',
    descriptionKey: 'teams.modeMonthlyDesc',
    defaultPreset: 'monthly',
  },
  {
    mode: 'solo',
    name: 'Solo Consultant',
    nameKey: 'teams.modeSolo',
    descriptionKey: 'teams.modeSoloDesc',
    defaultPreset: 'solo',
  },
  {
    mode: 'basic',
    name: 'Basic Kanban',
    nameKey: 'teams.modeBasic',
    descriptionKey: 'teams.modeBasicDesc',
    defaultPreset: 'simple',
  },
];

// ─── Ticket Type Icon Mapping ────────────────────────────────────────────────

const TICKET_TYPE_ICON_MAP: Record<string, string> = {
  // Core types
  sparkles: 'bi-stars',
  stop: 'bi-bug',
  clipboard: 'bi-clipboard',
  ticket: 'bi-ticket-perforated',
  // Mining / Logistics
  wrench: 'bi-wrench-adjustable',
  truck: 'bi-truck',
  logistics: 'bi-truck',
  box: 'bi-box-seam',
  // Support / Work Management
  inbox: 'bi-inbox',
  'info-circle': 'bi-info-circle',
  // Monthly / Enterprise
  flag: 'bi-flag',
  folder: 'bi-folder',
  'diagram-3': 'bi-diagram-3',
  compass: 'bi-compass',
  // Sales
  person: 'bi-person',
  'currency-dollar': 'bi-currency-dollar',
  'arrow-repeat': 'bi-arrow-repeat',
  // Legal / Supplier
  briefcase: 'bi-briefcase',
  'shield-check': 'bi-shield-check',
  'file-text': 'bi-file-text',
  building: 'bi-building',
  'journal-text': 'bi-journal-text',
  tools: 'bi-tools',
};

export const getTicketTypeIconClass = (icon: string): string => {
  if (icon.startsWith('bi-')) return `bi ${icon}`;
  return `bi ${TICKET_TYPE_ICON_MAP[icon] ?? `bi-${icon}`}`;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export const isStatusTypeAllowedInZone = (statusType: StatusType, zoneType: ZoneType): boolean =>
  ZONE_STATUS_TYPES[zoneType].includes(statusType);

export const getDefaultZoneForStatusType = (statusType: StatusType): ZoneType => STATUS_TYPE_TO_ZONES[statusType][0];

export const getPreset = (presetId?: string): TeamPresetConfig =>
  TEAM_PRESETS.find((p) => p.id === presetId) ?? TEAM_PRESETS[0];

// ─── Default Industries (from Ian's core data v185a) ────────────────────────
//
// Seeded as sensible defaults for the CRM config industries dropdown.
// Admins can customise these in Global Settings.

export const DEFAULT_INDUSTRIES: string[] = [
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
];
