// Shared formatting helpers + chart palette for the Credits dashboard.
// (Kept local to the dashboard so the existing CreditsAdminPanel is untouched.)

/** i18next t() — narrowed to what we use, to avoid a hard dependency on its types. */
export type TransFn = (key: string, opts?: Record<string, unknown>) => string;

/** Value-tier → Bootstrap badge variant. ("Value" is the client-facing name for the tier.)
 *  Retained for any legacy caller — new UI uses the tonal pill via {@link tierClass}. */
export const TIER_BADGE: Record<string, string> = {
  low: 'secondary',
  medium: 'info',
  high: 'primary',
  very_high: 'warning',
  unclassified: 'light',
};

/** Known value tiers, low → high (mirrors the lib's VALID_TIERS ordering). */
export const VALID_TIERS = ['low', 'medium', 'high', 'very_high', 'unclassified'] as const;

/** Value-tier → tonal pill class. One intentional scale (neutral → blue → brand → amber),
 *  shared across the dashboard, work-delivered table and drill modal. Cost-framed, not a
 *  judgement: a higher tier means the run drew more credits, nothing more. */
export const tierClass = (tier: string): string => {
  const t = (VALID_TIERS as readonly string[]).includes(tier) ? tier : 'unclassified';
  return `credits-tier credits-tier--${t}`;
};

/** Humanised tier label (e.g. very_high → "Very high"). */
export const tierLabel = (tier: string, t: TransFn): string => {
  switch (tier) {
    case 'low':
      return t('credits.tier.low', { defaultValue: 'Low' });
    case 'medium':
      return t('credits.tier.medium', { defaultValue: 'Medium' });
    case 'high':
      return t('credits.tier.high', { defaultValue: 'High' });
    case 'very_high':
      return t('credits.tier.veryHigh', { defaultValue: 'Very high' });
    default:
      return t('credits.tier.unclassified', { defaultValue: 'Unclassified' });
  }
};

/** Resolve the live brand-primary colour (themeable per client) for recharts, which sets
 *  `fill`/`stroke` as SVG attributes — those don't resolve CSS var() — so we read it once.
 *  Falls back through --brand-primary → --color-primary → the default eggplant. */
export const brandColor = (fallback = '#8e50a7'): string => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const s = getComputedStyle(document.documentElement);
  const brand = s.getPropertyValue('--brand-primary').trim();
  if (brand) return brand;
  const base = s.getPropertyValue('--color-primary').trim();
  return base || fallback;
};

/** Friendly label for the deterministic invocation `source` (chat | agent | scheduled). */
export function sourceLabel(source: string, t: TransFn): string {
  switch (source) {
    case 'chat':
      return t('creditsDashboard.sourceChat', { defaultValue: 'Chat' });
    case 'agent':
      return t('creditsDashboard.sourceAgent', { defaultValue: 'Agent chat' });
    case 'scheduled':
      return t('creditsDashboard.sourceScheduled', { defaultValue: 'Scheduled agent' });
    default:
      return source
        ? source.charAt(0).toUpperCase() + source.slice(1)
        : t('creditsDashboard.sourceOther', { defaultValue: 'Other' });
  }
}

/** Categorical palette (modern, muted) for pie slices / bars. Anchored on the brand
 *  eggplant with cool + warm companions; resolved per-client brand colour is layered on
 *  top at the call site for the primary slice. */
export const CHART_PALETTE = [
  '#8e50a7',
  '#6366f1',
  '#14b8a6',
  '#f59e0b',
  '#ec4899',
  '#0ea5e9',
  '#22c55e',
  '#a855f7',
  '#f97316',
  '#ef4444',
  '#64748b',
  '#94a3b8',
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
