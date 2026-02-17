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
