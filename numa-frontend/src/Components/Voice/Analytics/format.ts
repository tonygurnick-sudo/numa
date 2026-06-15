/** Shared formatting helpers for the Voice Analytics surface. */

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function formatPct(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : `${Math.round(n)}%`;
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** Title-case a snake/lower disposition for display (interested → Interested). */
export function prettyDisposition(d: string | undefined): string {
  if (!d) return '—';
  return d
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export const DISPOSITION_COLORS: Record<string, string> = {
  interested: '#2e7d32',
  callback: '#1565c0',
  no_answer: '#9e9e9e',
  not_interested: '#c62828',
};
