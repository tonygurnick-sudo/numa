/**
 * Pure aggregation over the voice-calls read-model. Kept dependency-free so the
 * dashboard maths is unit-tested without AWS. Timing averages that the read-model
 * can't supply (queue/hold/wrap) are filled in by the handler from GetMetricDataV2.
 */

export interface CallRow {
  contactId: string;
  direction?: string; // 'outbound' | 'inbound'
  durationSeconds?: number;
  disposition?: string;
  missed?: boolean;
  wasAnswered?: boolean;
  agentUsername?: string;
  company?: string;
  prospectPhone?: string;
  rating?: number;
  startMs?: number;
  gsi1pk?: string; // tenant-local date 'YYYY-MM-DD'
}

const mean = (xs: number[]): number => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
const pct = (num: number, den: number): number => (den ? Math.round((num / den) * 100) : 0);

export interface SummaryResult {
  outbound: { count: number; connectRate: number; avgDurationSec: number };
  inbound: { count: number; answerRate: number; missed: number };
  timing: { avgTalkSec: number; avgQueueSec: number | null; avgHoldSec: number | null; avgWrapSec: number | null };
  missedDistribution: { afterHours: number; duringHours: number; abandoned: number };
  dispositions: Array<{ disposition: string; count: number }>;
  agents: Array<{ agent: string; contacts: number; avgTalkSec: number; answered: number }>;
  totalCalls: number;
}

export function aggregateSummary(rows: CallRow[]): SummaryResult {
  const outbound = rows.filter((r) => r.direction === 'outbound');
  const inbound = rows.filter((r) => r.direction !== 'outbound');

  const outAnswered = outbound.filter((r) => r.wasAnswered || (r.durationSeconds ?? 0) > 0).length;
  const inAnswered = inbound.filter((r) => r.wasAnswered).length;
  const inMissed = inbound.filter((r) => r.missed).length;

  const durations = rows.map((r) => r.durationSeconds ?? 0).filter((d) => d > 0);

  const dispCounts = new Map<string, number>();
  for (const r of rows) {
    if (!r.disposition) continue;
    dispCounts.set(r.disposition, (dispCounts.get(r.disposition) ?? 0) + 1);
  }

  const agentMap = new Map<string, { contacts: number; talk: number[]; answered: number }>();
  for (const r of rows) {
    if (!r.agentUsername) continue;
    const a = agentMap.get(r.agentUsername) ?? { contacts: 0, talk: [], answered: 0 };
    a.contacts += 1;
    if ((r.durationSeconds ?? 0) > 0) a.talk.push(r.durationSeconds as number);
    if (r.wasAnswered) a.answered += 1;
    agentMap.set(r.agentUsername, a);
  }

  return {
    outbound: {
      count: outbound.length,
      connectRate: pct(outAnswered, outbound.length),
      avgDurationSec: mean(outbound.map((r) => r.durationSeconds ?? 0).filter((d) => d > 0)),
    },
    inbound: {
      count: inbound.length,
      answerRate: pct(inAnswered, inbound.length),
      missed: inMissed,
    },
    timing: { avgTalkSec: mean(durations), avgQueueSec: null, avgHoldSec: null, avgWrapSec: null },
    // After-hours split needs Connect Hours-of-Operation (not captured yet); only
    // the abandoned bucket is derivable from the read-model today.
    missedDistribution: { afterHours: 0, duringHours: 0, abandoned: inMissed },
    dispositions: [...dispCounts.entries()]
      .map(([disposition, count]) => ({ disposition, count }))
      .sort((a, b) => b.count - a.count),
    agents: [...agentMap.entries()]
      .map(([agent, a]) => ({ agent, contacts: a.contacts, avgTalkSec: mean(a.talk), answered: a.answered }))
      .sort((a, b) => b.contacts - a.contacts),
    totalCalls: rows.length,
  };
}

export interface TimeseriesPoint {
  date: string;
  inbound: number;
  outbound: number;
}

/** Group rows into a per-day inbound/outbound series across the given dates. */
export function aggregateTimeseries(rows: CallRow[], dates: string[]): TimeseriesPoint[] {
  const byDate = new Map<string, { inbound: number; outbound: number }>();
  for (const d of dates) byDate.set(d, { inbound: 0, outbound: 0 });
  for (const r of rows) {
    const d = r.gsi1pk;
    if (!d || !byDate.has(d)) continue;
    const bucket = byDate.get(d) as { inbound: number; outbound: number };
    if (r.direction === 'outbound') bucket.outbound += 1;
    else bucket.inbound += 1;
  }
  return dates.map((date) => ({ date, ...(byDate.get(date) as { inbound: number; outbound: number }) }));
}

/** The list of tenant-local YYYY-MM-DD dates spanning [fromMs, toMs] inclusive. */
export function dateRange(fromMs: number, toMs: number, tz: string): string[] {
  const fmt = (ms: number): string => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(ms));
    } catch {
      return new Date(ms).toISOString().slice(0, 10);
    }
  };
  const out: string[] = [];
  const DAY = 24 * 60 * 60 * 1000;
  // Walk by UTC days but label in tenant tz; dedupe to be DST-safe.
  for (let ms = fromMs; ms <= toMs + DAY; ms += DAY) {
    const d = fmt(ms);
    if (!out.includes(d)) out.push(d);
  }
  return out;
}
