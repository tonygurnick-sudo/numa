/**
 * Smart due-date formatter. Returns a label + CSS class, or null when no date.
 */
export function formatDueDate(dueDate: string | null | undefined): { text: string; className: string } | null {
  if (!dueDate) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(dueDate);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());

  const diffMs = dueDay.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { text: `${String(Math.abs(diffDays))}d overdue`, className: 'text-danger' };
  if (diffDays === 0) return { text: 'Today', className: 'text-success' };
  if (diffDays === 1) return { text: 'Tomorrow', className: 'text-warning' };
  if (diffDays <= 7) return { text: `${String(diffDays)}d`, className: 'text-secondary' };

  const month = dueDay.toLocaleString('default', { month: 'short' });
  return { text: `${month} ${String(dueDay.getDate())}`, className: 'text-secondary' };
}
