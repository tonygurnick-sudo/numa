// ─── Due Date Formatting ────────────────────────────────────────────────────

export type DueDateInfo = {
  text: string;
  className: string;
  /** Bootstrap-compatible badge background colour (hex). Present for badge-worthy states. */
  badgeBg?: string;
  /** Badge text colour (hex). */
  badgeText?: string;
};

/**
 * Smart due-date formatter. Returns a label + CSS class + optional badge colours, or null when no date.
 */
export function formatDueDate(dueDate: string | null | undefined): DueDateInfo | null {
  if (!dueDate) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(dueDate);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());

  const diffMs = dueDay.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0)
    return {
      text: `${String(Math.abs(diffDays))}d overdue`,
      className: 'text-danger',
      badgeBg: '#dc3545',
      badgeText: '#fff',
    };
  if (diffDays === 0) return { text: 'Today', className: 'text-success', badgeBg: '#198754', badgeText: '#fff' };
  if (diffDays === 1) return { text: 'Tomorrow', className: 'text-warning', badgeBg: '#fd7e14', badgeText: '#fff' };
  if (diffDays <= 7)
    return { text: `${String(diffDays)}d`, className: 'text-secondary', badgeBg: '#6c757d', badgeText: '#fff' };

  const month = dueDay.toLocaleString('default', { month: 'short' });
  return { text: `${month} ${String(dueDay.getDate())}`, className: 'text-secondary' };
}

// ─── Relative Date Formatting ───────────────────────────────────────────────

/**
 * Formats an ISO timestamp as a relative date string.
 * Same day → "Today", yesterday → "Yesterday", <30d → "5d ago", older → "Jan 23".
 */
export function formatRelativeDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const diffMs = today.getTime() - target.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${String(diffDays)}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
