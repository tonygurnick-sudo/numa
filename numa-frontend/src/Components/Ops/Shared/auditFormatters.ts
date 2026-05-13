import type { TFunction } from 'i18next';
import type {
  Customer,
  Supplier,
  StaffProfile,
  WorkUnit,
  WorkZone,
  WorkStage,
  TeamSummary,
  Project,
  TicketType,
  FieldDefinition,
  OpsConfigResponse,
} from '../../../types/ops';

export interface AuditLookups {
  config: OpsConfigResponse | null;
  customers: Customer[];
  suppliers: Supplier[];
  workUnits: WorkUnit[];
  zones: WorkZone[];
  stages: WorkStage[];
  boards: TeamSummary[];
}

const FIELD_LABEL_KEYS: Record<string, string> = {
  title: 'tickets.title',
  description: 'tickets.description',
  priority: 'tickets.priority',
  assigneeId: 'tickets.assignee',
  reporterId: 'tickets.reporter',
  customerId: 'tickets.customer',
  supplierId: 'tickets.supplier',
  projectId: 'tickets.project',
  workUnitId: 'tickets.workUnit',
  dueDate: 'tickets.dueDate',
  tags: 'tickets.tags',
  statusType: 'boardSettings.statusType',
  stageId: 'zones.stage',
  zoneId: 'zones.zone',
  teamId: 'tickets.board',
  boardId: 'tickets.board',
  ticketTypeId: 'tickets.type',
};

const DATE_FIELDS = new Set(['dueDate', 'startedAt', 'scopedAt', 'completedAt', 'endedAt', 'createdAt', 'updatedAt']);
const LONG_TEXT_FIELDS = new Set(['description', 'title']);
const IGNORED_FIELDS = new Set([
  // Bookkeeping that adds noise without telling the user anything useful.
  'version',
  'updatedAt',
  'updatedBy',
  'order',
  'GSI1PK',
  'GSI1SK',
  'GSI2PK',
  'GSI2SK',
  'GSI3PK',
  'GSI3SK',
  'PK',
  'SK',
  'commentCount',
  'linkCount',
]);

const findStaffName = (staff: StaffProfile[] | undefined, id: string): string | undefined => {
  const s = staff?.find((x) => x.id === id);
  return s?.name || s?.email;
};

const findById = <T extends { id: string }>(list: T[] | undefined, id: string): T | undefined =>
  list?.find((x) => x.id === id);

/** Human-readable label for an audit `field` key. Falls back to a prettified key. */
export function formatAuditFieldLabel(field: string, t: TFunction): string {
  const key = FIELD_LABEL_KEYS[field];
  if (key) {
    const translated = t(key);
    if (translated && translated !== key) return translated;
  }
  // Strip trailing Id, split camelCase, capitalize.
  const cleaned = field
    .replace(/Id$/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Human-readable display for an audit value. Resolves IDs to names where possible. */
export function formatAuditValue(field: string, value: unknown, lookups: AuditLookups, t: TFunction): string {
  if (value == null || value === '') return '';

  // Date fields
  if (DATE_FIELDS.has(field)) {
    const d = new Date(String(value));
    if (!isNaN(d.getTime())) return d.toLocaleDateString();
    return String(value);
  }

  // Status type → translated label
  if (field === 'statusType') {
    const key = `boardSettings.statusTypes.${String(value)}`;
    const translated = t(key);
    return translated && translated !== key ? translated : String(value);
  }

  // Priority → translated label
  if (field === 'priority') {
    const key = `priority.${String(value)}`;
    const translated = t(key);
    return translated && translated !== key ? translated : String(value);
  }

  // ID-based lookups
  if (typeof value === 'string') {
    switch (field) {
      case 'assigneeId':
      case 'reporterId':
      case 'createdBy':
      case 'updatedBy': {
        const name = findStaffName(lookups.config?.staff, value);
        if (name) return name;
        break;
      }
      case 'customerId': {
        const c = findById(lookups.customers, value);
        if (c) return c.companyName;
        break;
      }
      case 'supplierId': {
        const s = findById(lookups.suppliers, value);
        if (s) return s.companyName;
        break;
      }
      case 'projectId': {
        const p = findById<Project>(lookups.config?.projects, value);
        if (p) return p.name;
        break;
      }
      case 'ticketTypeId': {
        const tt = findById<TicketType>(lookups.config?.ticketTypes, value);
        if (tt) return tt.name;
        break;
      }
      case 'workUnitId': {
        const w = findById(lookups.workUnits, value);
        if (w) return w.name;
        break;
      }
      case 'stageId': {
        const st = findById(lookups.stages, value);
        if (st) return st.name;
        break;
      }
      case 'zoneId': {
        const z = findById(lookups.zones, value);
        if (z) return z.name;
        break;
      }
      case 'teamId': {
        const b = lookups.boards.find((x) => x.id === value);
        if (b) return b.name;
        break;
      }
    }
  }

  // Long text — show a truncated preview rather than dumping the whole body.
  if (LONG_TEXT_FIELDS.has(field) && typeof value === 'string') {
    const stripped = value
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (stripped.length > 80) return `${stripped.slice(0, 80)}…`;
    return stripped;
  }

  // Arrays (tags etc.)
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    return value.map((v) => String(v)).join(', ');
  }

  // Plain objects (e.g. custom `fields` blob) — render as comma-separated key=value list.
  if (typeof value === 'object') {
    try {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) return '';
      return entries.map(([k, v]) => `${k}=${String(v)}`).join(', ');
    } catch {
      return String(value);
    }
  }

  return String(value);
}

/** True if this change row should be hidden from the audit display. */
export function shouldIgnoreAuditField(field: string): boolean {
  return IGNORED_FIELDS.has(field);
}

/**
 * Special-case the `fields` blob: it's a Record<fieldId, value>, and we want to
 * surface those as individual change rows using the field's human-readable name.
 */
export function expandCustomFieldChanges(
  from: unknown,
  to: unknown,
  fieldDefs: FieldDefinition[] | undefined
): Array<{ field: string; from: unknown; to: unknown }> {
  const fromObj = (from && typeof from === 'object' ? (from as Record<string, unknown>) : {}) ?? {};
  const toObj = (to && typeof to === 'object' ? (to as Record<string, unknown>) : {}) ?? {};
  const keys = new Set<string>([...Object.keys(fromObj), ...Object.keys(toObj)]);
  const out: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const key of keys) {
    if (fromObj[key] === toObj[key]) continue;
    const def = fieldDefs?.find((f) => f.id === key);
    out.push({ field: def?.name ?? key, from: fromObj[key], to: toObj[key] });
  }
  return out;
}
