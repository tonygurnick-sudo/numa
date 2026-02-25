import type { StatusType, ZoneType, BoardMode } from './ops-schemas';

// ─── Zone-to-Status-Type Mapping ────────────────────────────────────────────
//
// Core constraint: a stage's statusType MUST be in the allowed list for its
// parent zone. Board zones support the full workflow. Backlog zones are for
// triaging and scoping work before it enters a board.

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
//
// Default two-zone layout used when no explicit zones array is provided
// during team creation.

export const DEFAULT_ZONES: { name: string; zoneType: ZoneType; order: number }[] = [
  { name: 'Product Backlog', zoneType: 'backlog', order: 1000 },
  { name: 'Board', zoneType: 'board', order: 2000 },
];

// ─── Team Presets ───────────────────────────────────────────────────────────
//
// Presets define the default zones and stages when creating a new team.
// Each preset is zone-centric: it defines an array of zones, each with its
// own stages. Users can rename stages during wizard creation or later in
// Team Settings.

export type PresetStage = {
  name: string;
  statusType: StatusType;
};

export type PresetZone = {
  name: string;
  zoneType: ZoneType;
  stages: PresetStage[];
};

export type TeamPreset = {
  id: string;
  name: string;
  description: string;
  mode: BoardMode;
  zones: PresetZone[];
};

/** @deprecated Use TeamPreset instead. */
export type BoardPreset = TeamPreset;

export const TEAM_PRESETS: TeamPreset[] = [
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
    id: 'standard',
    name: 'Normal',
    description: 'Backlog zone + board zone — full workflow with sprint support.',
    mode: 'normal',
    zones: [
      {
        name: 'Backlog',
        zoneType: 'backlog',
        stages: [
          { name: 'New', statusType: 'backlog' },
          { name: 'Backlog', statusType: 'backlog' },
          { name: 'Ready', statusType: 'scoped' },
        ],
      },
      {
        name: 'Board',
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
    id: 'simple',
    name: 'Basic',
    description: 'Single board zone — simple kanban (e.g., To Do / In Progress / Done).',
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

/** @deprecated Use TEAM_PRESETS instead. */
export const BOARD_PRESETS = TEAM_PRESETS;

// ─── Team Preset Metadata ───────────────────────────────────────────────────

export type TeamPresetInfo = {
  mode: BoardMode;
  name: string;
  nameKey: string;
  descriptionKey: string;
  defaultPreset: string;
};

/** @deprecated Use TeamPresetInfo instead. */
export type BoardModeInfo = TeamPresetInfo;

export const TEAM_PRESETS_INFO: TeamPresetInfo[] = [
  {
    mode: 'development',
    name: 'Development',
    nameKey: 'teams.modeDevelopment',
    descriptionKey: 'teams.modeDevelopmentDesc',
    defaultPreset: 'development',
  },
  {
    mode: 'support',
    name: 'Support',
    nameKey: 'teams.modeSupport',
    descriptionKey: 'teams.modeSupportDesc',
    defaultPreset: 'support',
  },
  {
    mode: 'monthly',
    name: 'Monthly',
    nameKey: 'teams.modeMonthly',
    descriptionKey: 'teams.modeMonthlyDesc',
    defaultPreset: 'monthly',
  },
  {
    mode: 'solo',
    name: 'Solo',
    nameKey: 'teams.modeSolo',
    descriptionKey: 'teams.modeSoloDesc',
    defaultPreset: 'solo',
  },
  {
    mode: 'basic',
    name: 'Basic',
    nameKey: 'teams.modeBasic',
    descriptionKey: 'teams.modeBasicDesc',
    defaultPreset: 'simple',
  },
  {
    mode: 'normal',
    name: 'Normal',
    nameKey: 'teams.modeNormal',
    descriptionKey: 'teams.modeNormalDesc',
    defaultPreset: 'standard',
  },
];

/** @deprecated Use TEAM_PRESETS_INFO instead. */
export const BOARD_MODES = TEAM_PRESETS_INFO;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Check if a statusType is allowed in a given zone. */
export const isStatusTypeAllowedInZone = (statusType: StatusType, zoneType: ZoneType): boolean =>
  ZONE_STATUS_TYPES[zoneType].includes(statusType);

/** Get the first valid zone for a statusType (used for auto-move). */
export const getDefaultZoneForStatusType = (statusType: StatusType): ZoneType =>
  STATUS_TYPE_TO_ZONES[statusType][0];

/** Get a team preset by ID, falling back to 'standard'. */
export const getPreset = (presetId?: string): TeamPreset =>
  TEAM_PRESETS.find((p) => p.id === presetId) ?? TEAM_PRESETS[0];
