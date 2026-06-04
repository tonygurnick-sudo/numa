import type { Board, FieldDefinition, FieldOverride, Ticket, TicketType } from '../../../types/ops';
import { isFieldRequired, isFieldVisible } from './fieldResolution';

export type DataQualitySeverity = 'ok' | 'warn' | 'error';

export type DataQualityIssue = {
  fieldId: string;
  fieldName: string;
  reason: 'missing-required' | 'overdue';
};

export type DataQualityResult = {
  severity: DataQualitySeverity;
  issues: DataQualityIssue[];
};

const OK_RESULT: DataQualityResult = { severity: 'ok', issues: [] };

/**
 * Field IDs that map to dedicated `Ticket` columns rather than the generic
 * `fields` bag. Required-checks must look at the column, not `fields[id]`.
 */
const FIELD_TO_TICKET_PROP: Record<string, keyof Ticket> = {
  'field-name': 'title',
  'field-description': 'description',
  'field-priority': 'priority',
  'field-assignee': 'assigneeId',
  'field-reporter': 'reporterId',
  'field-due-date': 'dueDate',
  'field-project': 'projectId',
  'field-client': 'customerId',
  'field-supplier': 'supplierId',
  'field-work-unit-id': 'workUnitId',
  'field-effort-points': 'effortPoints',
};

function readEffectiveValue(ticket: Ticket, fieldId: string): unknown {
  const prop = FIELD_TO_TICKET_PROP[fieldId];
  if (prop) return ticket[prop];
  return ticket.fields?.[fieldId];
}

function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Computes data-quality issues for a single ticket. Sources of issues today:
 *
 * - Required field is empty (from the global FieldDefinition, the board's
 *   FieldOverride, or a matching conditional rule that says required=true).
 * - Due date is in the past while the ticket is still open.
 *
 * The function is pure and intentionally lightweight so a kanban or backlog
 * view can call it per render without paying for a hook subscription. If a
 * ticket has hundreds of fields we can move this to useOpsData later.
 */
export function computeTicketDataQuality(
  ticket: Ticket,
  board: Board | null | undefined,
  ticketType: TicketType | undefined,
  fields: FieldDefinition[]
): DataQualityResult {
  const issues: DataQualityIssue[] = [];

  // Required-field check across defaultFields + board addedFields.
  const fieldIds = new Set<string>(ticketType?.defaultFields ?? []);
  const addedForType = board?.addedFields?.[ticketType?.id ?? ''] ?? [];
  for (const id of addedForType) fieldIds.add(id);

  const overrides: Record<string, FieldOverride> = board?.fieldOverrides ?? {};
  const ticketValues: Record<string, unknown> = ticket.fields ?? {};

  for (const fieldId of fieldIds) {
    const field = fields.find((f) => f.id === fieldId);
    if (!field) continue;
    const override = overrides[fieldId];
    if (!isFieldVisible(field, override, ticketValues)) continue;
    if (!isFieldRequired(field, override, ticketValues)) continue;
    const value = readEffectiveValue(ticket, fieldId);
    if (isMissing(value)) {
      issues.push({ fieldId, fieldName: override?.label || field.name, reason: 'missing-required' });
    }
  }

  // Overdue check — only for open tickets.
  const openStatuses = new Set(['backlog', 'scoped', 'queued', 'active']);
  if (openStatuses.has(ticket.statusType) && ticket.dueDate) {
    const due = new Date(ticket.dueDate);
    if (!isNaN(due.getTime()) && due.getTime() < Date.now()) {
      issues.push({ fieldId: 'field-due-date', fieldName: 'Due date', reason: 'overdue' });
    }
  }

  if (issues.length === 0) return OK_RESULT;
  const severity: DataQualitySeverity = issues.some((i) => i.reason === 'missing-required') ? 'error' : 'warn';
  return { severity, issues };
}
