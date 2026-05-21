/**
 * Fleet Map metrics — per-client health + cost numbers driving the
 * constellation tab.
 *
 * Two views share the same shape:
 *   - HEALTH: distance from center = engagement, size = total seats,
 *             color = 30d user-days trend, pulse = 7d delta.
 *   - COST:   distance = cost-per-active-user, size = absolute cost,
 *             color = 30d cost trend (inverted UX: rising = bad).
 *
 * Trend / pulse always use rolling 30d & 7d windows from "today" so the
 * "what changed" signal is consistent regardless of the dashboard window
 * selector. The activity ratio uses 30d active users too — that's the
 * standard MAU framing CS expects.
 */
import { ceForSnapshot, fmtN, fmtUSD0, isInternalClient, isRandDDevStack } from './shared';
import { computeInferredCosts } from './inferredCosts';
import { scalePlanetRadius, type BadgeDirection, type ConstellationPlanet } from './Constellation';
import { ND_COLORS } from './theme';
import type { ClientSnapshot, PerUserStats } from '@/types/fleetAnalytics';

// ─── tunables ────────────────────────────────────────────────────────────

/** Bayesian smoothing strength (pseudo-observations). Higher = more pull
 *  toward fleet mean for small-denominator clients. 5 puts a 1/4 client
 *  meaningfully closer to the fleet mean than a 10/40 client at the same
 *  raw ratio. */
const SMOOTHING_STRENGTH = 5;

/** Health bucket boundaries on smoothed activity ratio. */
const POWER_THRESHOLD = 0.5;
const HEALTHY_THRESHOLD = 0.2;
const AT_RISK_THRESHOLD = 0.0001; // anything > 0 lands here, 0 is dormant

/** Trend classification — relative change. Tightened from ±10% to ±20% so
 *  we don't flag noisy week-to-week wobble (holidays, single-user vacations)
 *  as a real trend. Aligned with the pulse threshold for consistency. */
const TREND_GROW_THRESHOLD = 0.2;
const TREND_DECLINE_THRESHOLD = -0.2;

/** Pulse — anything bigger than this in absolute value fires the pulse. */
const PULSE_THRESHOLD = 0.2;

// ─── cost-per-seat bands (dollars per provisioned seat per 30 days) ────
//
// Calibrated against the contract-revenue-per-seat spread observed across the
// real fleet: $27/seat/mo on the cheapest volume deals up to $167/seat/mo on
// premium small-customer deals. We anchor to the cheapest deal as the floor
// — that's the contract where margin gets squeezed first as cost-per-seat
// rises. So the bands describe where the cost lands relative to the cheapest
// realistic contract value.

const COST_PER_SEAT_EFFICIENT_MAX = 5; // <$5/seat/30d = ≥85% margin even on $27/seat contracts
const COST_PER_SEAT_TYPICAL_MAX = 15; // $5-15 = 55-85% margin on cheap deals, 90%+ on premium
const COST_PER_SEAT_EXPENSIVE_MAX = 30; // $15-30 = margin under stress on cheap deals
// >$30/seat/30d = losing money on the cheapest deals, slim margin on most.

// ─── cost-per-active intensity bands (colour scale for cost mode) ──────
//
// Used purely as a colour scale — "how heavy is each engaged user to serve?"
// These are absolute dollar thresholds so the scale doesn't shift as the
// fleet evolves. Calibrated from observed distributions (most clients fall
// under $30/active, heavy power-user clients run $50-150, outliers >$150).

const COST_PER_ACTIVE_LIGHT_MAX = 10;
const COST_PER_ACTIVE_MODERATE_MAX = 40;
const COST_PER_ACTIVE_HEAVY_MAX = 100;

// ─── types ───────────────────────────────────────────────────────────────

export type HealthBucket = 'power' | 'healthy' | 'at_risk' | 'dormant';
/** Distance bucket on the cost map — anchored to cost/seat economics. */
export type CostBucket = 'efficient' | 'typical' | 'expensive' | 'very_expensive' | 'no_seats';
/** Colour bucket on the cost map — "how heavy is each engaged user?" */
export type CostIntensity = 'light' | 'moderate' | 'heavy' | 'very_heavy' | 'dormant';
export type TrendDirection = 'growing' | 'flat' | 'declining' | 'unknown';
export type OrgKind = 'nextgen' | 'standalone' | 'internal' | 'rd_dev';
// BadgeDirection is owned by the renderer (Constellation.tsx) so the data
// layer doesn't have to invent its own shape. Re-export so consumers of
// fleetMap don't need a second import.
export type { BadgeDirection };

export interface FleetMapMetrics {
  client: string;
  orgKind: OrgKind;
  accountOrg: 'nextgen' | 'arcanum' | 'standalone' | null;
  devInstance: boolean;
  region?: string;
  accountId?: string;

  // ── User counts ────────────────────────────────────────────────────────
  provisionedUsers: number;
  activeUsers30d: number;
  activityRatio: number;
  smoothedRatio: number;

  // ── Health classification ──────────────────────────────────────────────
  healthBucket: HealthBucket;

  // ── 30d trend (user-days) ──────────────────────────────────────────────
  userDays30d: number;
  userDaysPrior30d: number;
  trend30d: number;
  trendDirection: TrendDirection;

  // ── 7d pulse (user-days) ───────────────────────────────────────────────
  userDays7d: number;
  userDaysPrior7d: number;
  pulseDelta: number;
  pulse: boolean;
  /** ↑ if userDays7d up >20% vs prior 7d, ↓ if down >20%, null otherwise.
   *  Drives the static chevron badge in health mode. */
  pulseDirection: BadgeDirection;

  // ── Cost ───────────────────────────────────────────────────────────────
  cost30d: number;
  costPrior30d: number;
  costTrend: number;
  costTrendDirection: TrendDirection;
  cost7d: number;
  costPrior7d: number;
  costPulse: boolean;
  /** ↑ if cost7d up >20% vs prior 7d, ↓ if down >20%, null otherwise.
   *  Drives the static chevron badge in cost mode. */
  costPulseDirection: BadgeDirection;
  /** Cost per PROVISIONED user / 30d — drives the cost ring (margin signal). */
  costPerSeat: number;
  costPerSeatBucket: CostBucket;
  /** Cost per ACTIVE user / 30d — drives the cost colour (intensity). */
  costPerActiveUser: number;
  costPerActiveIntensity: CostIntensity;
}

export interface FleetMapStats {
  /** Pooled mean activity ratio across the included clients. */
  meanActivityRatio: number;
  /** Max provisioned users — used to scale planet sizes on BOTH maps. */
  maxProvisionedUsers: number;
  /** Max 30d inferred cost — diagnostic only (no longer drives sizing). */
  maxCost30d: number;
  /** Cost-per-seat bucket thresholds, surfaced in the legend so operators
   *  can see the bar. Anchored to real contract economics. */
  costPerSeatBands: {
    efficientMax: number;
    typicalMax: number;
    expensiveMax: number;
  };
  /** Cost-per-active intensity thresholds, surfaced in the legend. */
  costPerActiveBands: {
    lightMax: number;
    moderateMax: number;
    heavyMax: number;
  };
}

// ─── date helpers ────────────────────────────────────────────────────────

function isoDayOffset(daysFromToday: number): string {
  const d = new Date(Date.now());
  d.setUTCDate(d.getUTCDate() - daysFromToday);
  return d.toISOString().slice(0, 10);
}

function classifyOrg(s: ClientSnapshot): OrgKind {
  const dev = Boolean(s.client_config?.dev_instance);
  if (isRandDDevStack(s.client, dev)) return 'rd_dev';
  if (isInternalClient(s.client)) return 'internal';
  if (s.client_config?.account_org === 'standalone') return 'standalone';
  // Treat anything else (nextgen / null / arcanum non-internal) as nextgen-ish
  // for filter purposes. Most production customer stacks are 'nextgen'.
  return 'nextgen';
}

// ─── activity ────────────────────────────────────────────────────────────

/** Distinct users with `last_at` on or after `cutoffDay`. */
function distinctActiveUsersSince(byUser: Record<string, PerUserStats> | undefined, cutoffDay: string): number {
  if (!byUser) return 0;
  let n = 0;
  for (const u of Object.values(byUser)) {
    const last = (u.last_at || '').slice(0, 10);
    if (last && last >= cutoffDay) n++;
  }
  return n;
}

/** Sum daily_active_users between [startDay, endDay] inclusive. The values
 *  are per-day distinct counts — summing gives user-days, a volume signal. */
function sumDailyActiveUsers(daily: Record<string, number> | undefined, startDay: string, endDay: string): number {
  if (!daily) return 0;
  let s = 0;
  for (const [d, v] of Object.entries(daily)) {
    if (d >= startDay && d <= endDay) s += v || 0;
  }
  return s;
}

/** Sum daily cost between [startDay, endDay] inclusive. */
function sumDailyCost(daily: Record<string, number> | undefined, startDay: string, endDay: string): number {
  if (!daily) return 0;
  let s = 0;
  for (const [d, v] of Object.entries(daily)) {
    if (d >= startDay && d <= endDay) s += v || 0;
  }
  return s;
}

/**
 * Inferred daily cost across the rolling 60d horizon. Handles quota-sharing
 * (Claude CE swapped for chat trace cost). For standalone customer accounts
 * we apply the Numa-attributable CE filter FIRST so non-Numa workloads
 * (customer RDS/OpenSearch/QuickSight) don't leak in — same wrap the
 * dashboard page does before passing snapshots to tab components.
 */
function inferredDailyCost60d(s: ClientSnapshot, day60: string, today: string): Record<string, number> {
  const { ce } = ceForSnapshot(s);
  // computeInferredCosts reads from `cost_explorer.totals_by_day` and
  // `cost_explorer.by_service_daily` — both already filtered by ceForSnapshot.
  const wrapped: ClientSnapshot = { ...s, cost_explorer: ce };
  const breakdown = computeInferredCosts(wrapped, { startDate: day60, endDate: today, label: '60d' });
  return breakdown.inferredTotalDaily;
}

// ─── trend classification ───────────────────────────────────────────────

function classifyTrend(recent: number, prior: number): { ratio: number; direction: TrendDirection } {
  if (recent === 0 && prior === 0) return { ratio: 0, direction: 'unknown' };
  if (prior === 0) return { ratio: 1, direction: 'growing' };
  const ratio = (recent - prior) / prior;
  if (ratio > TREND_GROW_THRESHOLD) return { ratio, direction: 'growing' };
  if (ratio < TREND_DECLINE_THRESHOLD) return { ratio, direction: 'declining' };
  return { ratio, direction: 'flat' };
}

function classifyHealth(smoothed: number, active: number): HealthBucket {
  if (active === 0) return 'dormant';
  if (smoothed >= POWER_THRESHOLD) return 'power';
  if (smoothed >= HEALTHY_THRESHOLD) return 'healthy';
  if (smoothed >= AT_RISK_THRESHOLD) return 'at_risk';
  return 'dormant';
}

function classifyCostPerSeat(costPerSeat: number, provisioned: number): CostBucket {
  if (provisioned === 0) return 'no_seats';
  if (costPerSeat <= COST_PER_SEAT_EFFICIENT_MAX) return 'efficient';
  if (costPerSeat <= COST_PER_SEAT_TYPICAL_MAX) return 'typical';
  if (costPerSeat <= COST_PER_SEAT_EXPENSIVE_MAX) return 'expensive';
  return 'very_expensive';
}

function classifyCostPerActiveIntensity(costPerActive: number, active: number): CostIntensity {
  if (active === 0 || !isFinite(costPerActive)) return 'dormant';
  if (costPerActive <= COST_PER_ACTIVE_LIGHT_MAX) return 'light';
  if (costPerActive <= COST_PER_ACTIVE_MODERATE_MAX) return 'moderate';
  if (costPerActive <= COST_PER_ACTIVE_HEAVY_MAX) return 'heavy';
  return 'very_heavy';
}

/** Translate a 7d trend ratio into a badge direction (or null if within
 *  the pulse threshold). */
function badgeFromTrend(direction: TrendDirection, ratio: number): BadgeDirection {
  if (direction === 'unknown') return null;
  if (ratio > PULSE_THRESHOLD) return 'up';
  if (ratio < -PULSE_THRESHOLD) return 'down';
  return null;
}

// ─── main ────────────────────────────────────────────────────────────────

/**
 * Compute fleet-map metrics for every snapshot. Returns the per-client
 * array AND fleet-level stats (mean activity ratio for smoothing, scale
 * maxes, cost efficiency quartiles).
 *
 * The 30d / 7d windows are rolling-from-today — independent of the user's
 * dashboard window selector. The "what changed" signal should be stable
 * regardless of how the user is slicing the rest of the dashboard.
 */
export function computeFleetMap(snapshots: ClientSnapshot[]): {
  metrics: FleetMapMetrics[];
  stats: FleetMapStats;
} {
  // Rolling reference dates.
  const today = isoDayOffset(0);
  const day7 = isoDayOffset(7);
  const day14 = isoDayOffset(14);
  const day30 = isoDayOffset(30);
  const day60 = isoDayOffset(60);

  // First pass: per-client raw numbers (we need the pooled mean before
  // we can compute smoothed ratios).
  type Intermediate = {
    s: ClientSnapshot;
    activeUsers30d: number;
    provisionedUsers: number;
    userDays30d: number;
    userDaysPrior30d: number;
    userDays7d: number;
    userDaysPrior7d: number;
    cost30d: number;
    costPrior30d: number;
    cost7d: number;
    costPrior7d: number;
  };

  const inter: Intermediate[] = snapshots.map((s) => {
    const provisionedUsers = s.users?.provisioned_users || 0;
    const activeUsers30d = distinctActiveUsersSince(s.chat?.by_user, day30);

    const userDays30d = sumDailyActiveUsers(s.chat?.daily_active_users, day30, today);
    // Prior window is the 30d before the recent 30d → [day60, day30) — we
    // use inclusive bounds and skip the overlap by using day30+1 implicitly
    // (sumDailyActiveUsers is inclusive, so day31..day60 is correct).
    const userDaysPrior30d = sumDailyActiveUsers(s.chat?.daily_active_users, day60, prevDay(day30));

    const userDays7d = sumDailyActiveUsers(s.chat?.daily_active_users, day7, today);
    const userDaysPrior7d = sumDailyActiveUsers(s.chat?.daily_active_users, day14, prevDay(day7));

    // Cost — use INFERRED daily cost so quota-sharing borrowers (whose
    // Claude CE is ~$0 but real LLM spend lives in chat traces) and lenders
    // (whose Claude CE is overstated by borrowers' usage) both see their
    // true Numa COGS. Standalone non-Numa filter is applied inside
    // computeInferredCosts via the CE block, same as the rest of the
    // dashboard. One call covers the full 60d horizon.
    const inferredDaily = inferredDailyCost60d(s, day60, today);
    const cost30d = sumDailyCost(inferredDaily, day30, today);
    const costPrior30d = sumDailyCost(inferredDaily, day60, prevDay(day30));
    const cost7d = sumDailyCost(inferredDaily, day7, today);
    const costPrior7d = sumDailyCost(inferredDaily, day14, prevDay(day7));

    return {
      s,
      activeUsers30d,
      provisionedUsers,
      userDays30d,
      userDaysPrior30d,
      userDays7d,
      userDaysPrior7d,
      cost30d,
      costPrior30d,
      cost7d,
      costPrior7d,
    };
  });

  // Pooled fleet mean activity ratio — sum(active) / sum(provisioned),
  // excluding clients with zero provisioned (no signal).
  let totalActive = 0;
  let totalProvisioned = 0;
  for (const r of inter) {
    if (r.provisionedUsers > 0) {
      totalActive += r.activeUsers30d;
      totalProvisioned += r.provisionedUsers;
    }
  }
  const meanActivityRatio = totalProvisioned > 0 ? totalActive / totalProvisioned : 0;

  // Bayesian smoothing prior parameters.
  const alpha = SMOOTHING_STRENGTH * meanActivityRatio;
  const beta = SMOOTHING_STRENGTH - alpha;

  // Max provisioned + max cost for size scaling.
  let maxProvisioned = 0;
  let maxCost30d = 0;
  for (const r of inter) {
    if (r.provisionedUsers > maxProvisioned) maxProvisioned = r.provisionedUsers;
    if (r.cost30d > maxCost30d) maxCost30d = r.cost30d;
  }

  // Second pass: emit final metrics.
  const metrics: FleetMapMetrics[] = inter.map((r) => {
    const activityRatio = r.provisionedUsers > 0 ? r.activeUsers30d / r.provisionedUsers : 0;
    const smoothedRatio = r.provisionedUsers > 0 ? (r.activeUsers30d + alpha) / (r.provisionedUsers + alpha + beta) : 0;

    const trend = classifyTrend(r.userDays30d, r.userDaysPrior30d);
    const pulse = classifyTrend(r.userDays7d, r.userDaysPrior7d);

    const cost = classifyTrend(r.cost30d, r.costPrior30d);
    const costPulse = classifyTrend(r.cost7d, r.costPrior7d);

    const costPerActiveUser = r.activeUsers30d > 0 ? r.cost30d / r.activeUsers30d : Number.POSITIVE_INFINITY;
    const costPerSeat = r.provisionedUsers > 0 ? r.cost30d / r.provisionedUsers : 0;

    return {
      client: r.s.client,
      orgKind: classifyOrg(r.s),
      accountOrg: r.s.client_config?.account_org ?? null,
      devInstance: Boolean(r.s.client_config?.dev_instance),
      region: r.s.client_config?.region,
      accountId: r.s.client_config?.client_account_id,

      provisionedUsers: r.provisionedUsers,
      activeUsers30d: r.activeUsers30d,
      activityRatio,
      smoothedRatio,

      healthBucket: classifyHealth(smoothedRatio, r.activeUsers30d),

      userDays30d: r.userDays30d,
      userDaysPrior30d: r.userDaysPrior30d,
      trend30d: trend.ratio,
      trendDirection: trend.direction,

      userDays7d: r.userDays7d,
      userDaysPrior7d: r.userDaysPrior7d,
      pulseDelta: pulse.ratio,
      pulse: Math.abs(pulse.ratio) > PULSE_THRESHOLD && pulse.direction !== 'unknown',
      pulseDirection: badgeFromTrend(pulse.direction, pulse.ratio),

      cost30d: r.cost30d,
      costPrior30d: r.costPrior30d,
      costTrend: cost.ratio,
      costTrendDirection: cost.direction,
      cost7d: r.cost7d,
      costPrior7d: r.costPrior7d,
      costPulse: Math.abs(costPulse.ratio) > PULSE_THRESHOLD && costPulse.direction !== 'unknown',
      costPulseDirection: badgeFromTrend(costPulse.direction, costPulse.ratio),
      costPerSeat,
      costPerSeatBucket: classifyCostPerSeat(costPerSeat, r.provisionedUsers),
      costPerActiveUser,
      costPerActiveIntensity: classifyCostPerActiveIntensity(costPerActiveUser, r.activeUsers30d),
    };
  });

  return {
    metrics,
    stats: {
      meanActivityRatio,
      maxProvisionedUsers: maxProvisioned,
      maxCost30d,
      costPerSeatBands: {
        efficientMax: COST_PER_SEAT_EFFICIENT_MAX,
        typicalMax: COST_PER_SEAT_TYPICAL_MAX,
        expensiveMax: COST_PER_SEAT_EXPENSIVE_MAX,
      },
      costPerActiveBands: {
        lightMax: COST_PER_ACTIVE_LIGHT_MAX,
        moderateMax: COST_PER_ACTIVE_MODERATE_MAX,
        heavyMax: COST_PER_ACTIVE_HEAVY_MAX,
      },
    },
  };
}

/** YYYY-MM-DD → previous day. */
function prevDay(isoDay: string): string {
  const d = new Date(isoDay + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ─── display helpers ─────────────────────────────────────────────────────

export const HEALTH_BUCKETS: Array<{ key: HealthBucket; label: string; description: string }> = [
  { key: 'power', label: 'Power', description: '50%+ of users active in last 30d' },
  { key: 'healthy', label: 'Healthy', description: '20-50% active' },
  { key: 'at_risk', label: 'At risk', description: '<20% active' },
  { key: 'dormant', label: 'Dormant', description: 'No active users in last 30d' },
];

export const COST_BUCKETS: Array<{ key: CostBucket; label: string; description: string }> = [
  {
    key: 'efficient',
    label: 'Efficient',
    description: `≤ $${COST_PER_SEAT_EFFICIENT_MAX}/seat/30d — ≥85% margin even on the cheapest contracts`,
  },
  {
    key: 'typical',
    label: 'Typical',
    description: `$${COST_PER_SEAT_EFFICIENT_MAX}-${COST_PER_SEAT_TYPICAL_MAX}/seat/30d — healthy margin range`,
  },
  {
    key: 'expensive',
    label: 'Expensive',
    description: `$${COST_PER_SEAT_TYPICAL_MAX}-${COST_PER_SEAT_EXPENSIVE_MAX}/seat/30d — margin under stress on cheap contracts`,
  },
  {
    key: 'very_expensive',
    label: 'Very expensive',
    description: `> $${COST_PER_SEAT_EXPENSIVE_MAX}/seat/30d — losing money on cheap contracts`,
  },
  { key: 'no_seats', label: 'No seats', description: 'No provisioned users — cost/seat undefined' },
];

export const COST_INTENSITY: Array<{ key: CostIntensity; label: string; description: string }> = [
  { key: 'light', label: 'Light', description: `≤ $${COST_PER_ACTIVE_LIGHT_MAX}/active/30d` },
  {
    key: 'moderate',
    label: 'Moderate',
    description: `$${COST_PER_ACTIVE_LIGHT_MAX}-${COST_PER_ACTIVE_MODERATE_MAX}/active/30d`,
  },
  {
    key: 'heavy',
    label: 'Heavy',
    description: `$${COST_PER_ACTIVE_MODERATE_MAX}-${COST_PER_ACTIVE_HEAVY_MAX}/active/30d`,
  },
  { key: 'very_heavy', label: 'Very heavy', description: `> $${COST_PER_ACTIVE_HEAVY_MAX}/active/30d` },
  { key: 'dormant', label: 'No active users', description: 'No engaged users to amortise compute over' },
];

export const ORG_KIND_LABEL: Record<OrgKind, string> = {
  nextgen: 'NextGen',
  standalone: 'Standalone',
  internal: 'Internal (HQ)',
  rd_dev: 'R&D / dev',
};

// ─── planet builders (data → Constellation render input) ───────────────

export type FleetMode = 'health' | 'cost';

const HEALTH_RING_ORDER: HealthBucket[] = ['power', 'healthy', 'at_risk', 'dormant'];
const COST_RING_ORDER: CostBucket[] = ['efficient', 'typical', 'expensive', 'very_expensive'];

/** Ring labels innermost → outermost for the chosen fleet view. */
export function fleetRingLabels(mode: FleetMode): [string, string, string, string] {
  if (mode === 'health') return ['Power users', 'Healthy', 'At risk', 'Dormant'];
  return ['Efficient', 'Typical', 'Expensive', 'Very expensive'];
}

function fleetRingIndex(m: FleetMapMetrics, mode: FleetMode): number {
  if (mode === 'health') return HEALTH_RING_ORDER.indexOf(m.healthBucket);
  // Cost mode — clients without provisioned seats go to the outer ring.
  if (m.costPerSeatBucket === 'no_seats') return COST_RING_ORDER.length - 1;
  return COST_RING_ORDER.indexOf(m.costPerSeatBucket);
}

function healthTrendColor(direction: TrendDirection): string {
  if (direction === 'unknown') return '#a8a29e';
  if (direction === 'growing') return ND_COLORS.good;
  if (direction === 'declining') return ND_COLORS.bad;
  return ND_COLORS.warn;
}

function costIntensityColor(intensity: CostIntensity): string {
  switch (intensity) {
    case 'light':
      return ND_COLORS.good;
    case 'moderate':
      return '#84cc16';
    case 'heavy':
      return ND_COLORS.warn;
    case 'very_heavy':
      return ND_COLORS.bad;
    case 'dormant':
    default:
      return '#a8a29e';
  }
}

function fleetPlanetFill(m: FleetMapMetrics, mode: FleetMode): string {
  return mode === 'health' ? healthTrendColor(m.trendDirection) : costIntensityColor(m.costPerActiveIntensity);
}

function fleetTooltipLines(m: FleetMapMetrics, mode: FleetMode): string[] {
  const lines: string[] = [m.client];
  if (mode === 'health') {
    lines.push(
      `${fmtN(m.activeUsers30d)} / ${fmtN(m.provisionedUsers)} active (${(m.activityRatio * 100).toFixed(0)}%)`
    );
    lines.push(`30d usage: ${trendLabel(m.trendDirection, m.trend30d)}`);
    if (m.pulseDirection)
      lines.push(`${m.pulseDirection === 'up' ? '↑' : '↓'} 7d change: ${formatSignedPct(m.pulseDelta)}`);
  } else {
    lines.push(`${fmtUSD0(m.costPerSeat)} / seat / 30d`);
    if (isFinite(m.costPerActiveUser)) lines.push(`${fmtUSD0(m.costPerActiveUser)} / active user`);
    else lines.push('No active users to amortise');
    lines.push(`Total ${fmtUSD0(m.cost30d)} / 30d (inferred)`);
    if (m.costPulseDirection)
      lines.push(`${m.costPulseDirection === 'up' ? '↑' : '↓'} 7d cost: ${formatSignedPct(m.costTrend)}`);
  }
  return lines;
}

function trendLabel(dir: TrendDirection, ratio: number): string {
  if (dir === 'unknown') return '— (no data)';
  return `${dir} (${formatSignedPct(ratio)})`;
}

function formatSignedPct(ratio: number): string {
  const sign = ratio >= 0 ? '+' : '';
  return `${sign}${(ratio * 100).toFixed(0)}%`;
}

/** Map fleet metrics → ConstellationPlanet[] for the chosen view. Size is
 *  scaled by provisioned users in both views — keeps a client's visual
 *  identity stable when switching Health ↔ Cost. */
export function buildFleetPlanets(
  metrics: FleetMapMetrics[],
  stats: FleetMapStats,
  mode: FleetMode
): ConstellationPlanet[] {
  return metrics.map((m) => ({
    key: m.client,
    ringIndex: fleetRingIndex(m, mode),
    fillColor: fleetPlanetFill(m, mode),
    sizeR: scalePlanetRadius(m.provisionedUsers, stats.maxProvisionedUsers),
    badge: mode === 'health' ? m.pulseDirection : m.costPulseDirection,
    tooltipLines: fleetTooltipLines(m, mode),
  }));
}
