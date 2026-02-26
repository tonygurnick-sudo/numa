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
};

export const TEAM_PRESETS: TeamPresetConfig[] = [
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
  sparkles: 'bi-stars',
  stop: 'bi-bug',
  clipboard: 'bi-clipboard',
  ticket: 'bi-ticket-perforated',
};

export const getTicketTypeIconClass = (icon: string): string => {
  return `bi ${TICKET_TYPE_ICON_MAP[icon] ?? `bi-${icon}`}`;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export const isStatusTypeAllowedInZone = (statusType: StatusType, zoneType: ZoneType): boolean =>
  ZONE_STATUS_TYPES[zoneType].includes(statusType);

export const getDefaultZoneForStatusType = (statusType: StatusType): ZoneType => STATUS_TYPE_TO_ZONES[statusType][0];

export const getPreset = (presetId?: string): TeamPresetConfig =>
  TEAM_PRESETS.find((p) => p.id === presetId) ?? TEAM_PRESETS[0];
