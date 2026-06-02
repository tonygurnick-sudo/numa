// Shared formatting helpers + chart palette for the Credits dashboard.
// (Kept local to the dashboard so the existing CreditsAdminPanel is untouched.)

/** i18next t() — narrowed to what we use, to avoid a hard dependency on its types. */
export type TransFn = (key: string, opts?: Record<string, unknown>) => string;

/** Complexity-tier → Bootstrap badge variant. Mirrors CreditsAdminPanel. */
export const TIER_BADGE: Record<string, string> = {
  low: 'secondary',
  medium: 'info',
  high: 'primary',
  very_high: 'warning',
  unclassified: 'light',
};

/** Categorical palette aligned to Bootstrap theme colours, for pie slices / bars. */
export const CHART_PALETTE = [
  '#0d6efd',
  '#6f42c1',
  '#d63384',
  '#fd7e14',
  '#198754',
  '#0dcaf0',
  '#ffc107',
  '#6610f2',
  '#20c997',
  '#dc3545',
  '#6c757d',
  '#adb5bd',
];
export const colorAt = (i: number): string => CHART_PALETTE[i % CHART_PALETTE.length];

/** Shorten a UUID for privacy-safe display (full value lives behind a copy button). */
export const shortId = (id: string): string => (id.length > 10 ? `${id.slice(0, 8)}…` : id);

export const fmtCredits = (n: number): string => Number(n || 0).toLocaleString();

/** Wall-clock span first→last message, rendered human-readable. Not a price driver. */
export function fmtDuration(first: string | null, last: string | null, t: TransFn): string {
  if (!first || !last) return '—';
  const ms = new Date(last).getTime() - new Date(first).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const min = ms / 60000;
  if (min < 1) return t('credits.durInstant', { defaultValue: '<1 min' });
  if (min < 60) return t('credits.durMin', { defaultValue: '{{n}} min', n: Math.round(min) });
  const hrs = min / 60;
  if (hrs < 24)
    return t('credits.durHrs', { defaultValue: '{{n}} hr', n: hrs < 10 ? hrs.toFixed(1) : String(Math.round(hrs)) });
  const days = hrs / 24;
  return t('credits.durDays', {
    defaultValue: '{{n}} days',
    n: days < 10 ? days.toFixed(1) : String(Math.round(days)),
  });
}

/** Compact absolute timestamp for "last run" (locale-aware, no year clutter). */
export function fmtTimestamp(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
