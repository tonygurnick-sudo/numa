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
    id: 'standard',
    name: 'Blank Board',
    description: 'Empty template to build your board from scratch.',
    mode: 'normal',
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
          { name: 'Blocked', statusType: 'active' },
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
    mode: 'normal',
    name: 'Empty Template',
    nameKey: 'teams.modeStandard',
    descriptionKey: 'teams.modeStandardDesc',
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
export const getDefaultZoneForStatusType = (statusType: StatusType): ZoneType => STATUS_TYPE_TO_ZONES[statusType][0];

/** Get a team preset by ID, falling back to 'standard'. */
export const getPreset = (presetId?: string): TeamPreset =>
  TEAM_PRESETS.find((p) => p.id === presetId) ?? TEAM_PRESETS[0];
