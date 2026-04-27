/**
 * Shared filter/sort helpers used by AllTicketsView and CRM list views.
 * Extracted to avoid duplication across table-based views.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type SortDirection = 'asc' | 'desc';
export type FilterEntry = { operator: string; value: unknown };
export type ActiveFilters = Record<string, FilterEntry>;

export type CrmColumnDef<T> = {
  key: string;
  label: string;
  sortable: boolean;
  filterType: 'text' | 'enum' | 'date' | 'number';
  filterOptions?: () => { value: string; label: string }[];
  accessor: (item: T) => unknown;
  render?: (item: T) => React.ReactNode;
  defaultVisible?: boolean;
  category?: string;
};

// ─── Sentinel for "empty / null" enum filtering ────────────────────────────

export const EMPTY_SENTINEL = '__EMPTY__';

// ─── Date preset ranges ────────────────────────────────────────────────────

export function getDatePresetRange(preset: string): { start: Date; end: Date } {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case 'today':
      return { start: startOfDay, end: new Date(startOfDay.getTime() + 86400000 - 1) };
    case 'thisWeek': {
      const day = now.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const monday = new Date(startOfDay);
      monday.setDate(monday.getDate() + mondayOffset);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);
      return { start: monday, end: sunday };
    }
    case 'thisMonth':
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
      };
    case 'thisQuarter': {
      const q = Math.floor(now.getMonth() / 3);
      return {
        start: new Date(now.getFullYear(), q * 3, 1),
        end: new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999),
      };
    }
    default:
      return { start: startOfDay, end: new Date(startOfDay.getTime() + 86400000 - 1) };
  }
}

// ─── Filter matchers ────────────────────────────────────────────────────────

export function matchesTextFilter(value: unknown, filter: FilterEntry): boolean {
  const str = String(value ?? '').toLowerCase();
  const target = String(filter.value ?? '').toLowerCase();
  switch (filter.operator) {
    case 'contains':
      return str.includes(target);
    case 'notContains':
      return !str.includes(target);
    case 'equals':
      return str === target;
    case 'notEquals':
      return str !== target;
    case 'startsWith':
      return str.startsWith(target);
    case 'endsWith':
      return str.endsWith(target);
    case 'empty':
      return !value || str.trim() === '';
    case 'notEmpty':
      return !!value && str.trim() !== '';
    default:
      return true;
  }
}

export function matchesEnumFilter(value: unknown, filter: FilterEntry): boolean {
  const selected = Array.isArray(filter.value) ? (filter.value as string[]) : [];
  if (selected.length === 0) return true;

  const hasEmpty = selected.includes(EMPTY_SENTINEL);
  const realSelected = selected.filter((v) => v !== EMPTY_SENTINEL);
  const strValue = String(value ?? '');

  if (hasEmpty && (!value || strValue === '')) return true;
  if (realSelected.length === 0) return hasEmpty ? !value || strValue === '' : true;
  return realSelected.includes(strValue);
}

export function matchesDateFilter(value: unknown, filter: FilterEntry): boolean {
  if (!value) return filter.operator === 'empty';
  const date = new Date(String(value));
  if (isNaN(date.getTime())) return false;

  if (['today', 'thisWeek', 'thisMonth', 'thisQuarter'].includes(filter.operator)) {
    const range = getDatePresetRange(filter.operator);
    return date >= range.start && date <= range.end;
  }

  switch (filter.operator) {
    case 'before':
      return date < new Date(String(filter.value));
    case 'after':
      return date > new Date(String(filter.value));
    case 'between': {
      const range = filter.value as { start: string; end: string };
      return date >= new Date(range.start) && date <= new Date(range.end);
    }
    default:
      return true;
  }
}

export function matchesNumberFilter(value: unknown, filter: FilterEntry): boolean {
  const num = Number(value);
  if (isNaN(num)) return false;
  const range = filter.value as { min?: string; max?: string };
  if (range.min && num < Number(range.min)) return false;
  if (range.max && num > Number(range.max)) return false;
  return true;
}

export function matchesFilter(value: unknown, filter: FilterEntry, filterType: string): boolean {
  switch (filterType) {
    case 'text':
      return matchesTextFilter(value, filter);
    case 'enum':
      return matchesEnumFilter(value, filter);
    case 'date':
      return matchesDateFilter(value, filter);
    case 'number':
      return matchesNumberFilter(value, filter);
    default:
      return true;
  }
}

export function compareValues(a: unknown, b: unknown, direction: SortDirection): number {
  const aVal = a ?? '';
  const bVal = b ?? '';
  const mul = direction === 'asc' ? 1 : -1;

  if (typeof aVal === 'number' && typeof bVal === 'number') {
    return (aVal - bVal) * mul;
  }
  return String(aVal).localeCompare(String(bVal)) * mul;
}
