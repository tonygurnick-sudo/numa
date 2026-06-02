import type {
  FieldConditionRule,
  FieldDefinition,
  FieldOverride,
  TicketPriority,
  TicketType,
} from '../../../types/ops';
import { BOARD_COLORS, getPriorityColor } from './colorUtils';

/**
 * Marker used to detect whether `board.addedFields[ttId]` is a complete,
 * board-owned snapshot (post-FEAT-171) or a legacy "extras on top of template
 * defaults" list (pre-FEAT-171).
 *
 * Pre-FEAT-171 the "+ Add field" picker filtered out hidden system fields
 * (`field-name`, `field-description`, `field-watchers`), so a legacy stored
 * list could never contain `field-name`. A board-owned snapshot, on the other
 * hand, copies the template's defaultFields wholesale — which always starts
 * with `field-name`. The presence of `field-name` is therefore a reliable
 * "is this a complete list?" probe with no schema/version flag required.
 */
const SNAPSHOT_MARKER_FIELD_ID = 'field-name';

/**
 * Returns the ordered field-id list a board uses for a given ticket type,
 * handling both the post-FEAT-171 "board owns the complete list" model and
 * the legacy "extras layered on top of template defaults" model.
 *
 * - No stored entry → return the template's defaultFields (board never
 *   customised the list, render live from template).
 * - Stored entry that contains `SNAPSHOT_MARKER_FIELD_ID` → it's a complete
 *   snapshot; return as-is.
 * - Stored entry that's missing the marker → legacy extras-only; merge with
 *   the template defaults, preserving any unique extras.
 *
 * This is the single source of truth for "what field ids belong to this
 * ticket type on this board" across all sidebars, editors, and validators.
 */
export function resolveBoardFieldList(
  ticketType: TicketType | null | undefined,
  addedFieldsForBoard: Record<string, string[]> | undefined
): string[] {
  if (!ticketType) return [];
  const defaults = ticketType.defaultFields ?? [];
  const stored = addedFieldsForBoard?.[ticketType.id];
  if (!Array.isArray(stored) || stored.length === 0) {
    return [...defaults];
  }
  if (stored.includes(SNAPSHOT_MARKER_FIELD_ID)) {
    return [...stored];
  }
  const extras = stored.filter((id) => !defaults.includes(id));
  return [...defaults, ...extras];
}

/**
 * Builds a complete board-owned snapshot of a ticket type's field list, ready
 * to persist back to `board.addedFields[ttId]`. Use this whenever a write
 * needs to start from "the current effective list" — e.g. the first time a
 * legacy board edits a ticket type, the modal calls this to materialise the
 * complete list before applying the user's change.
 */
export function buildBoardFieldSnapshot(
  ticketType: TicketType | null | undefined,
  addedFieldsForBoard: Record<string, string[]> | undefined
): string[] {
  return resolveBoardFieldList(ticketType, addedFieldsForBoard);
}

export const CANONICAL_PRIORITY_OPTIONS: TicketPriority[] = ['highest', 'high', 'medium', 'low', 'lowest'];

const CANONICAL_PRIORITY_SET = new Set<string>(CANONICAL_PRIORITY_OPTIONS);

export function isCanonicalPriority(value: unknown): value is TicketPriority {
  return typeof value === 'string' && CANONICAL_PRIORITY_SET.has(value);
}

/**
 * Merges a global field definition with a board-level override into the
 * effective field that should drive UI rendering on this board. Override
 * values win when defined — the board has the final say. Properties the
 * board hasn't set fall back to the global field.
 */
export function getEffectiveField(field: FieldDefinition, override?: FieldOverride): FieldDefinition {
  if (!override) return field;
  return {
    ...field,
    name: override.label?.trim() || field.name,
    options: override.options ?? field.options,
    required: override.required ?? field.required,
    conditions: override.conditions ?? field.conditions,
  };
}

/**
 * Evaluates a single field's conditional rules against a snapshot of the
 * current ticket's field values. Returns the rule outcomes that the renderer
 * should apply on top of static configuration.
 *
 * Today the only operators are `eq`, `in`, and `present`. The resolver is
 * deliberately small and pure so it can be reused on read (data-quality
 * computation) and on write (form rendering) without dragging in React state.
 */
export type FieldRuleOutcome = {
  /** undefined means "no rule said anything about visibility" — caller decides default. */
  visible?: boolean;
  required?: boolean;
};

function ruleMatches(rule: FieldConditionRule, values: Record<string, unknown>): boolean {
  const observed = values[rule.when.fieldId];
  switch (rule.when.op) {
    case 'present':
      return observed !== undefined && observed !== null && observed !== '';
    case 'eq':
      return observed === rule.when.value;
    case 'in':
      return Array.isArray(rule.when.value) && rule.when.value.includes(observed as never);
    default:
      return false;
  }
}

export function evaluateFieldRules(
  field: FieldDefinition,
  override: FieldOverride | undefined,
  ticketValues: Record<string, unknown>
): FieldRuleOutcome {
  const rules = override?.conditions ?? field.conditions ?? [];
  if (rules.length === 0) return {};
  const outcome: FieldRuleOutcome = {};
  for (const rule of rules) {
    if (!ruleMatches(rule, ticketValues)) continue;
    if (rule.then.visible !== undefined) outcome.visible = rule.then.visible;
    if (rule.then.required !== undefined) outcome.required = rule.then.required;
  }
  return outcome;
}

/**
 * Returns true when the field should render, given the static override and
 * any conditional rules. Defaults to visible when nothing pins it down.
 */
export function isFieldVisible(
  field: FieldDefinition,
  override: FieldOverride | undefined,
  ticketValues: Record<string, unknown>
): boolean {
  if (override?.visible === false) return false;
  const ruled = evaluateFieldRules(field, override, ticketValues);
  if (ruled.visible !== undefined) return ruled.visible;
  return true;
}

/**
 * Returns true when the field should be enforced as required at write time,
 * considering global defaults, the board override, and any matching rules.
 */
export function isFieldRequired(
  field: FieldDefinition,
  override: FieldOverride | undefined,
  ticketValues: Record<string, unknown>
): boolean {
  const baseRequired = override?.required ?? field.required ?? false;
  const ruled = evaluateFieldRules(field, override, ticketValues);
  return ruled.required ?? baseRequired;
}

/**
 * Returns the resolved option list for a field, applying any board-level
 * override. Falls back to the field's own options. For `field-priority`
 * with no override, returns the canonical TicketPriority enum so existing
 * boards keep their familiar priority list.
 */
export function resolveFieldOptions(
  fields: FieldDefinition[] | undefined,
  fieldOverrides: Record<string, FieldOverride> | undefined,
  fieldId: string
): string[] {
  const override = fieldOverrides?.[fieldId];
  if (override?.options?.length) {
    return [...override.options];
  }
  const field = fields?.find((f) => f.id === fieldId);
  if (field?.options?.length) {
    return [...field.options];
  }
  if (fieldId === 'field-priority') {
    return [...CANONICAL_PRIORITY_OPTIONS];
  }
  return [];
}

/**
 * Deterministic colour for a custom option label. Uses an FNV-1a-style
 * hash over the lowercased option, indexed into BOARD_COLORS so the same
 * option always renders with the same chip colour.
 */
function hashOptionColor(option: string): string {
  const s = option.toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return BOARD_COLORS[Math.abs(h) % BOARD_COLORS.length];
}

/**
 * Returns a hex colour for an option value. Priority gets its existing
 * red/orange/green/blue palette; everything else falls back to a stable
 * hash colour so custom options like Ian's "Tom" priority always render
 * the same chip.
 */
export function getFieldOptionColor(fieldId: string, option: string): string {
  if (fieldId === 'field-priority' && isCanonicalPriority(option)) {
    return getPriorityColor(option);
  }
  return hashOptionColor(option);
}
