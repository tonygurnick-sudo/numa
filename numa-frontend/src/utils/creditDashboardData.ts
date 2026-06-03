// Pure aggregation + trend helpers for the Credits dashboard.
//
// CRITICAL: everything here aggregates REAL CreditLedgerRow data only — there is
// no mock/synthetic data anywhere. A dimension with no records yields an empty
// result (the UI renders an honest empty state); when records appear, the charts
// pick them up automatically because nothing is hardcoded.

import { AdminCreditsService, type CreditBalance, type CreditLedgerRow } from '../Services/AdminCreditsService';

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;

export type CreditSlice = { key: string; credits: number; count: number };
export type UserSlice = { userSub: string; credits: number; count: number };
export type TrendPoint = { month: string; label: string; used: number; allocated: number };

const credits = (r: CreditLedgerRow): number => Number(r.creditsCharged) || 0;

/** Group rows by `source` — the deterministic invocation split: chat | agent | scheduled.
 *  Sorted by credits desc. Real data only (empty dimensions render an honest empty state). */
export function groupBySource(rows: CreditLedgerRow[]): CreditSlice[] {
  const map = new Map<string, CreditSlice>();
  for (const r of rows) {
    const key = r.source || 'unknown';
    const e = map.get(key) ?? { key, credits: 0, count: 0 };
    e.credits += credits(r);
    e.count += 1;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => b.credits - a.credits);
}

/** Top N rows by credits, with an optional predicate (e.g. only chats / only agents).
 *  Generic so the full-row type (CreditLedgerFullRow) flows through unchanged. */
export function topRowsByCredits<T extends CreditLedgerRow>(rows: T[], n: number, filter?: (r: T) => boolean): T[] {
  return rows
    .filter((r) => (filter ? filter(r) : true))
    .slice()
    .sort((a, b) => credits(b) - credits(a))
    .slice(0, n);
}

/** Top N users (by cognito sub) by total credits consumed. */
export function topUsersByCredits(rows: CreditLedgerRow[], n: number): UserSlice[] {
  const map = new Map<string, UserSlice>();
  for (const r of rows) {
    if (!r.userSub) continue;
    const e = map.get(r.userSub) ?? { userSub: r.userSub, credits: 0, count: 0 };
    e.credits += credits(r);
    e.count += 1;
    map.set(r.userSub, e);
  }
  return [...map.values()].sort((a, b) => b.credits - a.credits).slice(0, n);
}

/** Build the last `months` YYYY-MM windows ending with the current month. */
function recentMonths(months: number): { month: string; monthIndex: number; label: string }[] {
  const now = new Date();
  const out: { month: string; monthIndex: number; label: string }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthIndex = d.getMonth(); // 0-based, calendar month
    const month = `${d.getFullYear()}-${String(monthIndex + 1).padStart(2, '0')}`;
    const label = d.toLocaleString(undefined, { month: 'short' });
    out.push({ month, monthIndex, label });
  }
  return out;
}

/**
 * Fetch the per-month credits-used trend over the last `months` months by
 * querying the real ledger for each month (no multi-month endpoint exists yet).
 * The `allocated` line comes from the real 12-element monthly allocation config.
 * Months with no records return used=0 (honest gap), never a fabricated value.
 */
export async function fetchTrend(
  numaGet: NumaGet | undefined,
  balance: CreditBalance,
  months: number
): Promise<TrendPoint[]> {
  const points = recentMonths(months);
  const allocations = balance.monthly?.allocations ?? [];
  const ledgers = await Promise.all(
    points.map((p) => AdminCreditsService.getLedger(p.month, numaGet).catch(() => null))
  );
  return points.map((p, i) => ({
    month: p.month,
    label: p.label,
    used: ledgers[i]?.totalCredits ?? 0,
    allocated: allocations[p.monthIndex] ?? 0,
  }));
}
