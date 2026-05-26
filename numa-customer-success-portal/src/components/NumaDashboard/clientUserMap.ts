/**
 * Client User Map — per-user metrics for a single client snapshot, driving
 * the user-level constellation (Fleet Map tab when a real client is
 * selected in the sidebar).
 *
 * Single unified encoding (engagement and cost are correlated enough at the
 * user level that splitting into two views was mostly redundant):
 *
 *     - distance = active-days bucket (Power/Engaged/Casual/Dormant)
 *     - size     = 30d cost (heavier compute footprint → bigger planet)
 *     - colour   = recency (when last seen)
 *     - badge    = 7d cost direction (↑/↓)
 *
 * Active days = count of days in last 30d with chat messages > 0. Pulled
 * from chat.daily_messages_by_user. Users provisioned but never active
 * (in sub_to_email but absent from by_user) render as fully dormant.
 */
import { fmtN, fmtUSD0 } from './shared';
import { ND_COLORS } from './theme';
import { scalePlanetRadius, type BadgeDirection, type ConstellationPlanet } from './Constellation';
import type { ClientSnapshot, PerUserStats } from '@/types/fleetAnalytics';

// ─── tunables ───────────────────────────────────────────────────────────

/** Active-day bucket boundaries (days active in last 30). */
const POWER_DAYS_MIN = 15; // ≥15 active days = power user (2+ per week)
const ENGAGED_DAYS_MIN = 6; // 6-14 = engaged (~weekly)
const CASUAL_DAYS_MIN = 1; // 1-5 = casual

/** 30-day cost bucket boundaries ($ per user per 30d). */
const COST_LIGHT_MAX = 5;
const COST_MODERATE_MAX = 30;
const COST_HEAVY_MAX = 100;

/** Recency bucket boundaries (days since last active). */
const RECENT_MAX_DAYS = 7; // active in last 7d
const LAPSING_MAX_DAYS = 14; // active in last 8-14d
const GOING_DARK_MAX_DAYS = 30; // active in last 15-30d
// >30d or never = dormant

/** 7-day pulse threshold (relative cost change). */
const PULSE_THRESHOLD = 0.2;

// ─── types ──────────────────────────────────────────────────────────────

export type UserEngagementBucket = 'power' | 'engaged' | 'casual' | 'dormant';
export type UserCostBucket = 'light' | 'moderate' | 'heavy' | 'very_heavy';
export type UserRecency = 'recent' | 'lapsing' | 'going_dark' | 'dormant';

export interface UserMapMetrics {
  userId: string;
  displayName: string;

  // ── Activity ─────────────────────────────────────────────────────────
  activeDays30d: number;
  lastActiveDay: string | null;
  daysSinceActive: number | null;
  recency: UserRecency;
  engagementBucket: UserEngagementBucket;

  // ── Cost ─────────────────────────────────────────────────────────────
  cost30d: number;
  cost7d: number;
  costPrior7d: number;
  costTrend7d: number;
  costBucket: UserCostBucket;
  badge: BadgeDirection;

  // ── Volume ───────────────────────────────────────────────────────────
  messages30d: number;
  convs30d: number;
}

export interface UserMapStats {
  totalUsers: number;
  activeUsers30d: number;
  dormantUsers: number;
  maxCost30d: number;
  maxActiveDays: number;
  /** Sum of all users' 30d cost — context for the detail panel. */
  totalCost30d: number;
}

// ─── helpers ────────────────────────────────────────────────────────────

function isoDayOffset(daysFromToday: number): string {
  const d = new Date(Date.now());
  d.setUTCDate(d.getUTCDate() - daysFromToday);
  return d.toISOString().slice(0, 10);
}

function prevDay(isoDay: string): string {
  const d = new Date(isoDay + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function daysBetween(isoStart: string, isoEnd: string): number {
  const a = Date.parse(isoStart + 'T00:00:00Z');
  const b = Date.parse(isoEnd + 'T00:00:00Z');
  if (isNaN(a) || isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.floor((b - a) / 86_400_000);
}

function sumDaily(daily: Record<string, number> | undefined, startDay: string, endDay: string): number {
  if (!daily) return 0;
  let s = 0;
  for (const [d, v] of Object.entries(daily)) {
    if (d >= startDay && d <= endDay) s += v || 0;
  }
  return s;
}

function countActiveDays(daily: Record<string, number> | undefined, startDay: string, endDay: string): number {
  if (!daily) return 0;
  let n = 0;
  for (const [d, v] of Object.entries(daily)) {
    if (d >= startDay && d <= endDay && (v || 0) > 0) n++;
  }
  return n;
}

function classifyEngagement(activeDays: number): UserEngagementBucket {
  if (activeDays >= POWER_DAYS_MIN) return 'power';
  if (activeDays >= ENGAGED_DAYS_MIN) return 'engaged';
  if (activeDays >= CASUAL_DAYS_MIN) return 'casual';
  return 'dormant';
}

function classifyCost(cost30d: number): UserCostBucket {
  if (cost30d <= COST_LIGHT_MAX) return 'light';
  if (cost30d <= COST_MODERATE_MAX) return 'moderate';
  if (cost30d <= COST_HEAVY_MAX) return 'heavy';
  return 'very_heavy';
}

function classifyRecency(daysSinceActive: number | null): UserRecency {
  if (daysSinceActive == null) return 'dormant';
  if (daysSinceActive <= RECENT_MAX_DAYS) return 'recent';
  if (daysSinceActive <= LAPSING_MAX_DAYS) return 'lapsing';
  if (daysSinceActive <= GOING_DARK_MAX_DAYS) return 'going_dark';
  return 'dormant';
}

function badgeFromCostTrend(recent: number, prior: number): BadgeDirection {
  if (recent === 0 && prior === 0) return null;
  if (prior === 0) return recent > PULSE_THRESHOLD ? 'up' : null;
  const ratio = (recent - prior) / prior;
  if (ratio > PULSE_THRESHOLD) return 'up';
  if (ratio < -PULSE_THRESHOLD) return 'down';
  return null;
}

function relativeCostTrend(recent: number, prior: number): number {
  if (recent === 0 && prior === 0) return 0;
  if (prior === 0) return 1;
  return (recent - prior) / prior;
}

function displayNameFor(userId: string, subToEmail: Record<string, string> | undefined): string {
  const email = subToEmail?.[userId];
  if (email) return email;
  // No email mapping — the sub exists in chat history but Cognito doesn't
  // know about it. Almost always means the user was deleted after chatting.
  return 'Unknown/Deleted';
}

/** Short label rendered on the planet itself. Email gets trimmed to the
 *  username (left of @) since full addresses are too long for the SVG.
 *  Tooltip + detail panel still show the full display name. */
function shortLabelFor(displayName: string): string {
  if (displayName.includes('@')) return displayName.split('@')[0];
  return displayName;
}

// ─── main ───────────────────────────────────────────────────────────────

/**
 * Compute per-user metrics for one client snapshot. Includes provisioned
 * users who have NEVER chatted (from sub_to_email but absent from by_user)
 * — they surface as fully dormant in the outermost ring, useful for
 * spotting license waste.
 */
export function computeClientUserMap(snapshot: ClientSnapshot): {
  metrics: UserMapMetrics[];
  stats: UserMapStats;
} {
  const today = isoDayOffset(0);
  const day7 = isoDayOffset(7);
  const day14 = isoDayOffset(14);
  const day30 = isoDayOffset(30);

  const byUser = snapshot.chat?.by_user || {};
  const dailyCostByUser = snapshot.chat?.daily_cost_by_user || {};
  const dailyMessagesByUser = snapshot.chat?.daily_messages_by_user || {};
  const subToEmail = snapshot.users?.sub_to_email;

  // Union of every user we know about: anyone with chat activity + anyone
  // listed in Cognito. The Cognito-only set surfaces never-active seats.
  const allUserIds = new Set<string>([
    ...Object.keys(byUser),
    ...Object.keys(dailyCostByUser),
    ...Object.keys(dailyMessagesByUser),
    ...Object.keys(subToEmail || {}),
  ]);

  const metrics: UserMapMetrics[] = [];

  for (const userId of allUserIds) {
    const stats: PerUserStats | undefined = byUser[userId];
    const dailyCost = dailyCostByUser[userId];
    const dailyMessages = dailyMessagesByUser[userId];

    const activeDays30d = countActiveDays(dailyMessages, day30, today);
    const cost30d = sumDaily(dailyCost, day30, today);
    const cost7d = sumDaily(dailyCost, day7, today);
    const costPrior7d = sumDaily(dailyCost, day14, prevDay(day7));
    const messages30d = sumDaily(dailyMessages, day30, today);
    const convs30d = 0; // no per-day convs map keyed by user; leave 0 for now

    const lastActiveRaw = stats?.last_at ? stats.last_at.slice(0, 10) : null;
    const daysSinceActive = lastActiveRaw && lastActiveRaw <= today ? daysBetween(lastActiveRaw, today) : null;

    metrics.push({
      userId,
      displayName: displayNameFor(userId, subToEmail),
      activeDays30d,
      lastActiveDay: lastActiveRaw,
      daysSinceActive,
      recency: classifyRecency(daysSinceActive),
      engagementBucket: classifyEngagement(activeDays30d),
      cost30d,
      cost7d,
      costPrior7d,
      costTrend7d: relativeCostTrend(cost7d, costPrior7d),
      costBucket: classifyCost(cost30d),
      badge: badgeFromCostTrend(cost7d, costPrior7d),
      messages30d,
      convs30d,
    });
  }

  let maxCost = 0;
  let maxDays = 0;
  let active = 0;
  let dormant = 0;
  let totalCost = 0;
  for (const m of metrics) {
    if (m.cost30d > maxCost) maxCost = m.cost30d;
    if (m.activeDays30d > maxDays) maxDays = m.activeDays30d;
    if (m.activeDays30d > 0) active++;
    else dormant++;
    totalCost += m.cost30d;
  }

  return {
    metrics,
    stats: {
      totalUsers: metrics.length,
      activeUsers30d: active,
      dormantUsers: dormant,
      maxCost30d: maxCost,
      maxActiveDays: maxDays,
      totalCost30d: totalCost,
    },
  };
}

// ─── planet builders (data → Constellation render input) ───────────────

const ENGAGEMENT_RING_ORDER: UserEngagementBucket[] = ['power', 'engaged', 'casual', 'dormant'];

/** Ring labels innermost → outermost — single fixed scheme since the
 *  user view encodes engagement on the radial axis. */
export function userRingLabels(): [string, string, string, string] {
  return ['Power users', 'Engaged', 'Casual', 'Dormant'];
}

function userRingIndex(m: UserMapMetrics): number {
  return ENGAGEMENT_RING_ORDER.indexOf(m.engagementBucket);
}

/** Recency → fill colour. Same scale used in both engagement + cost views
 *  so the visual language stays consistent. */
function recencyColor(r: UserRecency): string {
  switch (r) {
    case 'recent':
      return ND_COLORS.good; // active in last 7d
    case 'lapsing':
      return ND_COLORS.warn; // 8-14d
    case 'going_dark':
      return ND_COLORS.bad; // 15-30d
    case 'dormant':
    default:
      return '#a8a29e'; // no activity in 30d / never
  }
}

function userTooltipLines(m: UserMapMetrics): string[] {
  const lines: string[] = [m.displayName];
  lines.push(`${fmtN(m.activeDays30d)} active days / 30d`);
  if (m.daysSinceActive == null) {
    lines.push('Never active');
  } else if (m.daysSinceActive === 0) {
    lines.push('Active today');
  } else {
    lines.push(`Last active ${fmtN(m.daysSinceActive)}d ago`);
  }
  lines.push(`${fmtUSD0(m.cost30d)} / 30d`);
  if (m.badge) {
    const sign = m.badge === 'up' ? '+' : '';
    lines.push(`${m.badge === 'up' ? '↑' : '↓'} 7d cost: ${sign}${(m.costTrend7d * 100).toFixed(0)}%`);
  }
  return lines;
}

/** Map user metrics → ConstellationPlanet[] for the single unified view. */
export function buildUserPlanets(metrics: UserMapMetrics[], stats: UserMapStats): ConstellationPlanet[] {
  return metrics.map((m) => ({
    key: m.userId,
    ringIndex: userRingIndex(m),
    fillColor: recencyColor(m.recency),
    sizeR: scalePlanetRadius(m.cost30d, stats.maxCost30d),
    badge: m.badge,
    label: shortLabelFor(m.displayName),
    tooltipLines: userTooltipLines(m),
  }));
}

// ─── display tables (legend / filters) ─────────────────────────────────

export const USER_ENGAGEMENT_BUCKETS: Array<{ key: UserEngagementBucket; label: string; description: string }> = [
  { key: 'power', label: 'Power users', description: `≥ ${POWER_DAYS_MIN} active days in last 30 (2+ per week)` },
  { key: 'engaged', label: 'Engaged', description: `${ENGAGED_DAYS_MIN}-${POWER_DAYS_MIN - 1} active days (~weekly)` },
  {
    key: 'casual',
    label: 'Casual',
    description: `${CASUAL_DAYS_MIN}-${ENGAGED_DAYS_MIN - 1} active days (occasional)`,
  },
  { key: 'dormant', label: 'Dormant', description: 'No activity in last 30d (or never)' },
];

export const USER_COST_BUCKETS: Array<{ key: UserCostBucket; label: string; description: string }> = [
  { key: 'light', label: 'Light', description: `≤ $${COST_LIGHT_MAX}/30d` },
  { key: 'moderate', label: 'Moderate', description: `$${COST_LIGHT_MAX}-${COST_MODERATE_MAX}/30d` },
  { key: 'heavy', label: 'Heavy', description: `$${COST_MODERATE_MAX}-${COST_HEAVY_MAX}/30d` },
  { key: 'very_heavy', label: 'Very heavy', description: `> $${COST_HEAVY_MAX}/30d` },
];

export const USER_RECENCY_LABELS: Record<UserRecency, { label: string; description: string }> = {
  recent: { label: 'Recent', description: `Active in last ${RECENT_MAX_DAYS}d` },
  lapsing: { label: 'Lapsing', description: `${RECENT_MAX_DAYS + 1}-${LAPSING_MAX_DAYS}d since active` },
  going_dark: {
    label: 'Going dark',
    description: `${LAPSING_MAX_DAYS + 1}-${GOING_DARK_MAX_DAYS}d since active`,
  },
  dormant: { label: 'Dormant', description: 'No activity in last 30d (or never)' },
};
