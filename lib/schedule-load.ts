/**
 * Shared scheduling load + quota helpers.
 *
 * Used by both `agent-schedules` (create/update enforcement) and
 * `agent-schedule-runner` (telemetry, defence-in-depth).
 *
 * Quota model is *projected* — we sum each active schedule's
 * `projected_runs_per_month` and reject when adding a new schedule
 * would push the user / agent / company over its cap. There is no
 * per-run actual counter on the hot path.
 *
 * Three-level config chain (mirrors min-interval):
 *   Level 1 — platform default (constant in this file)
 *   Level 2 — per-client override (env var, set from numa-client-config)
 *   Level 3 — client-admin override (DynamoDB scheduling-settings record)
 *
 * The level-3 admin can never raise a value above the resolved level-1+2
 * ceiling (enforced in `admin-scheduling-settings`).
 */

import { estimateCronIntervalMinutes } from './scheduling-schemas';

/** Mean number of minutes per month (30.4375 days). Used for cron→runs/mo. */
const MINUTES_PER_MONTH = 43_800;

/** Minimum projected runs returned for any active schedule (avoids zero). */
const MIN_PROJECTED_RUNS = 1;

/**
 * Platform defaults (Level 1). These are the hard ceilings unless overridden.
 * Tune via the CS portal `platform-settings` record (numa-client-config table)
 * before reaching for these.
 */
/**
 * Run-count and concurrency defaults.
 *
 *   - Min interval         = 60 min  (most use cases need ≥ hourly cadence)
 *   - Cron runs/mo company = 2,000   (projected: ~3 hourly schedules' worth)
 *   - Cron runs/mo user    = 750     (≈ one hourly schedule × 1 user)
 *   - Cron runs/mo agent   = 750     (matches user — no extra per-agent layer)
 *   - Trigger runs/mo company = 1,000 (actual: event-trigger fires)
 *   - Trigger runs/mo user    = 100
 *   - Trigger runs/mo agent   = 100  (matches user)
 *   - Concurrent automations / company = 1,000 (cron + triggers combined)
 *   - Concurrent automations / user    = 100
 *
 * Cron run quotas are *projected* (computed once from the cron expression).
 * Trigger run quotas are *actual* (counted from `recent_runs` map at fire
 * time). Concurrent caps cover BOTH cron and event schedules — they're
 * "automations" to the user.
 */
/**
 * No code-side default quotas. The platform-settings record in the deployer
 * `numa-client-config` table is the SOLE source of truth for Level 1 values;
 * lambdas receive them as env vars at deploy time. If a required value is
 * missing, `resolveEffectiveQuotas` throws so the misconfiguration surfaces
 * immediately rather than getting silently masked by a code constant.
 *
 * Bootstrap seed values (used by the CSP PlatformSettings page when first
 * populating the record) live in
 * `numa-customer-success-portal/src/services/platformSettingsService.ts`
 * as `PLATFORM_QUOTA_INITIAL_VALUES`.
 */

/**
 * % of trigger cap at which the audit panel shows a warning when the 30-day
 * projection lands above this fraction. Hard-coded — not exposed as a
 * configurable quota. Tweak the constant if the heuristic needs adjusting.
 */
export const TRIGGER_WARNING_THRESHOLD_PERCENT = 80;

export type ScheduleQuotas = {
  minIntervalMinutes: number;
  maxRunsPerCompanyPerMonth: number;
  maxRunsPerUserPerMonth: number;
  maxTriggerRunsPerCompanyPerMonth: number;
  maxTriggerRunsPerUserPerMonth: number;
  maxConcurrentActiveSchedulesPerCompany: number;
  maxConcurrentActiveSchedulesPerUser: number;
  requireApprovalAboveUserCap: boolean;
};

export type PartialScheduleQuotas = Partial<ScheduleQuotas>;

/**
 * Project the expected number of runs per month for a cron expression.
 *
 * For complex / unparseable patterns this returns the platform-default
 * minimum (1) — DO NOT use this on the create/update path, which must
 * reject unparseable crons via `validateCronInterval` before storing.
 * Quota enforcement against `null`-projecting crons is unsafe (they can
 * fire thousands of times/month while projecting to 1).
 *
 * Read-path callers (audit panels, telemetry, legacy-record aggregation)
 * may use this freely — those records have already passed the create-time
 * gate. We log a warn when the fallback fires so misconfiguration is
 * observable in CloudWatch.
 */
export const projectMonthlyRuns = (cronExpression: string): number => {
  const intervalMinutes = estimateCronIntervalMinutes(cronExpression);
  if (intervalMinutes === null) {
    console.warn(
      '[SCHEDULE_PROJECTION] unparseable cron — falling back to 1 run/mo for read-path. This must NOT happen on the create/update path; investigate if seen during enforcement.',
      { cronExpression }
    );
    return MIN_PROJECTED_RUNS;
  }
  if (intervalMinutes <= 0) return MIN_PROJECTED_RUNS;
  if (!Number.isFinite(intervalMinutes)) return MIN_PROJECTED_RUNS; // once-off
  return Math.max(MIN_PROJECTED_RUNS, Math.round(MINUTES_PER_MONTH / intervalMinutes));
};

/**
 * A subset of ScheduleRecord that the load helpers care about. Keeps this
 * module decoupled from the full Zod schema so it can be imported by
 * lambdas that don't need the rest of `scheduling-schemas`.
 */
export type LoadCalculationRecord = {
  user_id: string;
  schedule_id: string;
  agent_id?: string;
  status: string;
  trigger_type?: string;
  cron_expression?: string;
  projected_runs_per_month?: number;
  /**
   * Quota bucket. `'company'` means the schedule is excluded from per-user
   * and per-(user, agent) monthly run totals — only counted against the
   * company total. Concurrent counts and the company total still include it.
   * Defaults to `'user'` semantically when unset.
   */
  quota_scope?: 'user' | 'company';
  /**
   * Sub of the admin who approved a `pending_approval` schedule. Treated as
   * a fallback signal of company-scoped: legacy approvals (before the
   * `quota_scope` field existed) won't have `quota_scope === 'company'`
   * set, but they were over the user cap by definition, so we still want
   * to exclude them from the user's bucket. New approvals set both fields.
   */
  approved_by?: string;
};

export type AggregatedLoad = {
  /** Total projected monthly runs across all active schedules in scope. */
  totalRunsPerMonth: number;
  /** Count of active schedules in scope. */
  activeScheduleCount: number;
  /** Per-user breakdown (user_id → projected runs/mo). */
  perUser: Record<string, number>;
  /** Per-user active count. */
  perUserActiveCount: Record<string, number>;
};

/**
 * Aggregate cron-projected runs/month + concurrent-active counts across a
 * set of schedule records.
 *
 * Concurrent counts (`activeScheduleCount`, `perUserActiveCount`) include
 * BOTH cron and event-trigger schedules — they're "automations" to the
 * user.
 *
 * Run-count totals (`totalRunsPerMonth`, `perUser`) include only cron
 * schedules — event triggers are reactive and tracked via actuals
 * (`recent_runs` map; see `aggregateTriggerLoad`).
 *
 * Only `active` schedules count. `pending_approval` schedules are queued
 * demand and don't consume budget — they're re-checked individually at
 * approve time (`approveSchedule`). Counting them here caused a deadlock:
 * with N pendings competing for budget, the sum exceeded cap so none
 * could be approved even when each one alone would have fit. The audit
 * panel UI was already showing active-only numbers; this brings the
 * backend in line.
 */
export const aggregateLoad = (records: LoadCalculationRecord[]): AggregatedLoad => {
  const out: AggregatedLoad = {
    totalRunsPerMonth: 0,
    activeScheduleCount: 0,
    perUser: {},
    perUserActiveCount: {},
  };

  for (const r of records) {
    if (r.status !== 'active') continue;

    const isEventTrigger = (r.trigger_type ?? 'cron') === 'event';
    // Company-scoped schedules don't eat the owner's per-user budgets
    // (concurrent or monthly). They're funded by the company bucket via
    // admin promotion. Accept either explicit `quota_scope === 'company'`
    // (new approvals) or `approved_by` (legacy approvals from before the
    // field existed — by definition over the user cap).
    const isCompanyScoped = r.quota_scope === 'company' || !!r.approved_by;

    // Concurrent count includes cron AND event triggers — combined "automations" cap.
    // Company total always counts every schedule; per-user count excludes
    // company-scoped ones for consistency with the monthly-runs accounting.
    out.activeScheduleCount += 1;
    if (!isCompanyScoped) {
      out.perUserActiveCount[r.user_id] = (out.perUserActiveCount[r.user_id] ?? 0) + 1;
    }

    // Run-count totals are cron-only (event triggers go through aggregateTriggerLoad).
    if (isEventTrigger) continue;

    const projected = r.projected_runs_per_month ?? (r.cron_expression ? projectMonthlyRuns(r.cron_expression) : 0);
    if (projected <= 0) continue;

    // Company total always counts every schedule.
    out.totalRunsPerMonth += projected;

    if (isCompanyScoped) continue;

    out.perUser[r.user_id] = (out.perUser[r.user_id] ?? 0) + projected;
  }

  return out;
};

/** Returns the current month as `'YYYY-MM'` (UTC). */
export const currentMonthKey = (now: Date = new Date()): string => {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
};

/** Returns today's date as `'YYYY-MM-DD'` (UTC). Used as a `recent_runs` map key. */
export const currentDayKey = (now: Date = new Date()): string => {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * A subset of ScheduleRecord that the trigger-load helpers care about.
 */
export type TriggerCalculationRecord = {
  user_id: string;
  schedule_id: string;
  agent_id?: string;
  status: string;
  trigger_type?: string;
  /** `'YYYY-MM-DD' → count` map maintained by the dispatcher on each fire. */
  recent_runs?: Record<string, number>;
};

export type AggregatedTriggerLoad = {
  /** Sum of `recent_runs` entries falling inside the given month, across all event records. */
  totalRunsThisMonth: number;
  /** Per-user breakdown (user_id → runs this month). */
  perUser: Record<string, number>;
  /** Per-schedule breakdown (schedule_id → runs this month). Drives the
   *  per-row Month/Projected columns in the trigger audit panel. */
  perSchedule: Record<string, number>;
  /** Per-day total across the tenant — last N days, oldest first. Used for the chart. */
  dailyTotals: Array<{ date: string; total: number }>;
  /** Per-day per-user (sparse map) — for the per-user mini-chart. */
  dailyPerUser: Record<string, Array<{ date: string; total: number }>>;
  /** Per-day per-schedule — used to project monthly fires per individual trigger. */
  dailyPerSchedule: Record<string, Array<{ date: string; total: number }>>;
};

/**
 * Sum the `recent_runs` map across event-trigger records to get monthly
 * actuals + last-N-days daily series. Skipped for non-event records.
 *
 * `monthKey` is `'YYYY-MM'`. `lastNDays` is the chart window; entries
 * outside it are still counted toward `totalRunsThisMonth` if they fall
 * in the month, but only `lastNDays` show up in `dailyTotals`.
 */
export const aggregateTriggerLoad = (
  records: TriggerCalculationRecord[],
  monthKey: string,
  lastNDays: number = 30,
  now: Date = new Date()
): AggregatedTriggerLoad => {
  const out: AggregatedTriggerLoad = {
    totalRunsThisMonth: 0,
    perUser: {},
    perSchedule: {},
    dailyTotals: [],
    dailyPerUser: {},
    dailyPerSchedule: {},
  };

  // Build the chart window — N consecutive days ending today.
  const windowDates: string[] = [];
  for (let i = lastNDays - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    windowDates.push(currentDayKey(d));
  }
  const windowSet = new Set(windowDates);
  const totalsByDay: Record<string, number> = {};
  const perUserByDay: Record<string, Record<string, number>> = {}; // userId → date → count
  const perScheduleByDay: Record<string, Record<string, number>> = {}; // scheduleId → date → count

  for (const r of records) {
    if ((r.trigger_type ?? 'cron') !== 'event') continue;
    if (!r.recent_runs) continue;
    if (r.status === 'deleted') continue;

    for (const [day, count] of Object.entries(r.recent_runs)) {
      if (!count || count <= 0) continue;

      // Monthly actuals — match by month prefix.
      if (day.startsWith(`${monthKey}-`)) {
        out.totalRunsThisMonth += count;
        out.perUser[r.user_id] = (out.perUser[r.user_id] ?? 0) + count;
        out.perSchedule[r.schedule_id] = (out.perSchedule[r.schedule_id] ?? 0) + count;
      }

      // Chart series — only days inside the window.
      if (windowSet.has(day)) {
        totalsByDay[day] = (totalsByDay[day] ?? 0) + count;
        const userBucket = (perUserByDay[r.user_id] ??= {});
        userBucket[day] = (userBucket[day] ?? 0) + count;
        const scheduleBucket = (perScheduleByDay[r.schedule_id] ??= {});
        scheduleBucket[day] = (scheduleBucket[day] ?? 0) + count;
      }
    }
  }

  out.dailyTotals = windowDates.map((d) => ({ date: d, total: totalsByDay[d] ?? 0 }));
  for (const [userId, byDay] of Object.entries(perUserByDay)) {
    out.dailyPerUser[userId] = windowDates.map((d) => ({ date: d, total: byDay[d] ?? 0 }));
  }
  for (const [scheduleId, byDay] of Object.entries(perScheduleByDay)) {
    out.dailyPerSchedule[scheduleId] = windowDates.map((d) => ({ date: d, total: byDay[d] ?? 0 }));
  }

  return out;
};

/**
 * Project monthly trigger runs from an N-day actual count by linear
 * extrapolation, with a cold-start adjustment.
 *
 * The naive form `(runsInWindow / windowDays) * daysInMonth` dilutes
 * recent bursts when the trigger has only existed for a short time
 * (e.g. 22 fires in 1 day projects to ~23/mo because divided by 30).
 * That's almost always wrong: a brand-new trigger's near-term rate is
 * better extrapolated from the days it has actually been alive.
 *
 * Strategy (a): if `daysSinceFirstFire` is provided AND smaller than
 * `windowDays`, use it as the effective denominator. Today's burst of
 * 22 with `daysSinceFirstFire=1` projects to `22 * daysInMonth ≈ 682`,
 * which is a more honest "if this rate holds" number even if it's
 * noisy on day 1. Caller decides how to surface the noise (e.g. an
 * "early data" badge in the UI). Returns 0 when `runsInWindow <= 0`
 * regardless.
 */
export const projectMonthlyTriggerRuns = (
  runsInWindow: number,
  windowDays: number,
  now: Date = new Date(),
  daysSinceFirstFire?: number
): number => {
  if (windowDays <= 0 || runsInWindow <= 0) return 0;
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const effectiveDays =
    typeof daysSinceFirstFire === 'number' && daysSinceFirstFire > 0
      ? Math.min(windowDays, daysSinceFirstFire)
      : windowDays;
  return Math.round((runsInWindow / effectiveDays) * daysInMonth);
};

/**
 * Days since the oldest non-zero entry in a daily series, inclusive of
 * today (so a single fire today returns 1, not 0). Returns null when
 * the series has no fires at all — caller should treat as "no
 * projection possible".
 *
 * `daily` is the oldest-first array shape returned by
 * `aggregateTriggerLoad` (`dailyTotals`, `dailyPerUser[id]`, etc.).
 */
export const daysSinceFirstActivity = (daily: Array<{ total: number }>): number | null => {
  for (let i = 0; i < daily.length; i++) {
    if (daily[i].total > 0) return daily.length - i;
  }
  return null;
};

/**
 * Atomically prune `recent_runs` entries older than `keepDays` and return
 * the filtered map plus the new total for `monthKey`. Pure helper —
 * callers persist the result.
 */
export const pruneRecentRuns = (
  recentRuns: Record<string, number> | undefined,
  keepDays: number = 35,
  now: Date = new Date()
): Record<string, number> => {
  if (!recentRuns) return {};
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - keepDays));
  const cutoffKey = currentDayKey(cutoff);
  const out: Record<string, number> = {};
  for (const [day, count] of Object.entries(recentRuns)) {
    if (day >= cutoffKey && count > 0) out[day] = count;
  }
  return out;
};

/** A trigger-quota violation surfaced when an event fire would breach a cap. */
export type TriggerQuotaViolation = {
  scope: 'company' | 'user';
  current: number;
  requested: number;
  limit: number;
};

/**
 * Determine whether one more event-trigger fire fits within the trigger
 * quotas. Returns `null` if allowed, otherwise the most restrictive violation.
 */
export const checkTriggerQuotas = (input: {
  userSub: string;
  load: AggregatedTriggerLoad;
  quotas: ScheduleQuotas;
}): TriggerQuotaViolation | null => {
  const { userSub, load, quotas } = input;

  const companyAfter = load.totalRunsThisMonth + 1;
  if (companyAfter > quotas.maxTriggerRunsPerCompanyPerMonth) {
    return {
      scope: 'company',
      current: load.totalRunsThisMonth,
      requested: companyAfter,
      limit: quotas.maxTriggerRunsPerCompanyPerMonth,
    };
  }

  const userCurrent = load.perUser[userSub] ?? 0;
  if (userCurrent + 1 > quotas.maxTriggerRunsPerUserPerMonth) {
    return {
      scope: 'user',
      current: userCurrent,
      requested: userCurrent + 1,
      limit: quotas.maxTriggerRunsPerUserPerMonth,
    };
  }

  return null;
};

/** The reason a quota check rejected a schedule. */
export type QuotaViolation = {
  scope: 'company' | 'user' | 'concurrent_user' | 'concurrent_company';
  /** Current usage in this scope before the new schedule. */
  current: number;
  /** Usage including the new schedule (i.e. what would be true after). */
  requested: number;
  /** Effective cap for this scope. */
  limit: number;
  /**
   * Whether the request can be QUEUED for admin review. True for `user`
   * (when `requireApprovalAboveUserCap` is on) and `company` (always — so
   * admin sees the demand and can free up budget). False for the
   * concurrent caps which are always hard rejects. "Approvable" does NOT
   * mean the admin can necessarily approve right now — for company-scope
   * violations, the admin still has to wait until the tenant is back under
   * cap before approval succeeds. The approve endpoint re-runs this check
   * and refuses if still over.
   */
  approvable: boolean;
};

export type AssertWithinQuotasInput = {
  /** The user creating / updating the schedule. */
  userSub: string;
  /** Projected runs/month for the new (or edited) schedule. */
  additionalRuns: number;
  /** All schedules in the tenant (active + pending_approval). */
  existingRecords: LoadCalculationRecord[];
  /** Effective quotas for this tenant (Level 1+2+3 already resolved). */
  quotas: ScheduleQuotas;
  /**
   * If editing an existing schedule, its id — so we don't double-count it.
   * The caller is responsible for omitting it from `existingRecords` OR
   * setting this so the helper subtracts the schedule's prior contribution.
   */
  excludeScheduleId?: string;
};

/**
 * Determine whether a schedule can be created / activated within quotas.
 *
 * Returns `null` if allowed. Returns the most restrictive `QuotaViolation`
 * found otherwise — caller decides whether to surface as 400, 202
 * (pending approval), or auto-suggest a less-frequent cadence.
 *
 * Order of checks: company → user → concurrent. Company and user violations
 * are both "approvable" — they queue the request as `pending_approval`
 * instead of hard-rejecting. User-scope approval is gated on
 * `requireApprovalAboveUserCap`; company-scope is always queueable so the
 * admin sees demand and can free up budget. Concurrent caps remain hard
 * rejects (no approval flow). Per-automation limits are enforced via the
 * schedule's `max_runs` field at run time, not here.
 *
 * When a company-scope violation lands in pending, the admin can only
 * approve if the tenant has dropped back under cap by approve-time —
 * `approveSchedule` re-runs this check and refuses if still over.
 */
export const checkQuotas = (input: AssertWithinQuotasInput): QuotaViolation | null => {
  const { userSub, additionalRuns, existingRecords, quotas, excludeScheduleId } = input;

  const filtered = excludeScheduleId
    ? existingRecords.filter((r) => r.schedule_id !== excludeScheduleId)
    : existingRecords;

  const load = aggregateLoad(filtered);

  // Company scope. Marked approvable so the request lands in
  // `pending_approval` and the admin sees it in the audit panel — they
  // still can't approve while the tenant is over cap (re-checked at
  // approve time), but the request isn't a dead-end 400.
  const companyAfter = load.totalRunsPerMonth + additionalRuns;
  if (companyAfter > quotas.maxRunsPerCompanyPerMonth) {
    return {
      scope: 'company',
      current: load.totalRunsPerMonth,
      requested: companyAfter,
      limit: quotas.maxRunsPerCompanyPerMonth,
      approvable: true,
    };
  }

  // User scope — approvable if enabled.
  const userCurrent = load.perUser[userSub] ?? 0;
  const userAfter = userCurrent + additionalRuns;
  if (userAfter > quotas.maxRunsPerUserPerMonth) {
    return {
      scope: 'user',
      current: userCurrent,
      requested: userAfter,
      limit: quotas.maxRunsPerUserPerMonth,
      approvable: quotas.requireApprovalAboveUserCap,
    };
  }

  // Tenant-wide concurrent active count — hard cap.
  const companyActiveAfter = load.activeScheduleCount + 1;
  if (companyActiveAfter > quotas.maxConcurrentActiveSchedulesPerCompany) {
    return {
      scope: 'concurrent_company',
      current: load.activeScheduleCount,
      requested: companyActiveAfter,
      limit: quotas.maxConcurrentActiveSchedulesPerCompany,
      approvable: false,
    };
  }

  // Per-user concurrent active count — hard cap (the new schedule counts as +1
  // unless we're editing one that's already active, which the caller has filtered out).
  const userActiveAfter = (load.perUserActiveCount[userSub] ?? 0) + 1;
  if (userActiveAfter > quotas.maxConcurrentActiveSchedulesPerUser) {
    return {
      scope: 'concurrent_user',
      current: load.perUserActiveCount[userSub] ?? 0,
      requested: userActiveAfter,
      limit: quotas.maxConcurrentActiveSchedulesPerUser,
      approvable: false,
    };
  }

  return null;
};

/**
 * Resolve effective quotas by applying the level chain.
 *
 * - Level 1+2 = platform-settings + per-client overrides, merged into the
 *   `level2` argument (passed to lambdas via env vars at deploy time).
 * - Level 3 = client-admin overrides (scheduling-settings DynamoDB record).
 *
 * For each numeric quota, level 3 may LOWER but not RAISE the level-2 value.
 * `requireApprovalAboveUserCap` is a boolean — admin can toggle it freely
 * within bounds set by level 2.
 *
 * If `level2` is missing any required field this function THROWS — the
 * caller must ensure the platform-settings record is fully populated.
 * There is no code-side fallback by design.
 */
export const resolveEffectiveQuotas = (
  level2: PartialScheduleQuotas | undefined,
  level3: PartialScheduleQuotas | undefined
): ScheduleQuotas => {
  const requireL2 = <K extends keyof ScheduleQuotas>(key: K): NonNullable<ScheduleQuotas[K]> => {
    const v = level2?.[key];
    if (v === undefined || v === null) {
      // Configuration error, NOT a runtime "quota exceeded" — this fires
      // when the lambda's env block doesn't carry the corresponding
      // SCHEDULE_QUOTA_* var. Common cause: a new lambda consumes
      // `resolveEffectiveQuotas` but its infra construct only wires a
      // subset of the env vars (e.g. trigger-only fields). Either thread
      // the missing var through the construct, or repopulate the
      // platform-settings record in numa-client-config and redeploy.
      throw new Error(
        `Schedule-quota config error: Level-2 quota '${String(key)}' is not set on this lambda. ` +
          `This is a deployment / wiring bug, not a runtime cap-hit. ` +
          `Check (1) the lambda's SCHEDULE_QUOTA_* env vars in the infra construct, and ` +
          `(2) the platform-settings record in numa-client-config (deployer account). ` +
          `Then redeploy this stack.`
      );
    }
    return v as NonNullable<ScheduleQuotas[K]>;
  };

  const ceil = (key: keyof Omit<ScheduleQuotas, 'minIntervalMinutes' | 'requireApprovalAboveUserCap'>): number => {
    const l2 = requireL2(key) as number;
    const l3 = level3?.[key] as number | undefined;
    return typeof l3 === 'number' ? Math.min(l3, l2) : l2;
  };

  // For minIntervalMinutes the semantics are inverted — admin can RAISE the
  // floor but not lower it. Take the max instead of min.
  const floor = (): number => {
    const l2 = requireL2('minIntervalMinutes') as number;
    const l3 = level3?.minIntervalMinutes;
    return typeof l3 === 'number' ? Math.max(l3, l2) : l2;
  };

  // Approval policy: Level 2 (platform / per-client) is a HARD FLOOR — admin
  // (Level 3) cannot change it in either direction. If platform/client says
  // approval is OFF, admin cannot turn it on (no surprise approval gates
  // per-tenant). If platform/client says approval is ON, admin cannot turn
  // it OFF (admin cannot bypass the company-level safeguard the platform
  // mandates). The L3 value for this key is therefore deliberately ignored.
  // Adjust the L2 value at the platform-settings or per-client record level
  // to change the policy.
  const requireApproval = requireL2('requireApprovalAboveUserCap') as boolean;

  return {
    minIntervalMinutes: floor(),
    maxRunsPerCompanyPerMonth: ceil('maxRunsPerCompanyPerMonth'),
    maxRunsPerUserPerMonth: ceil('maxRunsPerUserPerMonth'),
    maxTriggerRunsPerCompanyPerMonth: ceil('maxTriggerRunsPerCompanyPerMonth'),
    maxTriggerRunsPerUserPerMonth: ceil('maxTriggerRunsPerUserPerMonth'),
    maxConcurrentActiveSchedulesPerCompany: ceil('maxConcurrentActiveSchedulesPerCompany'),
    maxConcurrentActiveSchedulesPerUser: ceil('maxConcurrentActiveSchedulesPerUser'),
    requireApprovalAboveUserCap: requireApproval,
  };
};

/**
 * Parse the `ScheduleQuotas` shape from environment variables. Used by the
 * lambdas to read level-2 (per-client) overrides set in the construct.
 *
 * Each field has both a `*_MIN_INTERVAL_MINUTES`-style legacy var and a
 * unified `SCHEDULE_QUOTA_<KEY>` form. Legacy vars take precedence so the
 * existing min-interval wiring keeps working unchanged.
 */
export const parseQuotasFromEnv = (env: Record<string, string | undefined>): PartialScheduleQuotas => {
  // Run-count and concurrency caps allow 0 — meaning "0 runs / 0 concurrent
  // automations allowed". Set explicitly to disable a quota target.
  const cap = (v: string | undefined): number | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  // minIntervalMinutes is a FLOOR not a cap — 0 would mean "no minimum"
  // which makes no practical sense, so we still require >0 here.
  const positive = (v: string | undefined): number | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const bool = (v: string | undefined): boolean | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    return undefined;
  };

  return {
    minIntervalMinutes:
      positive(env.SCHEDULING_MIN_INTERVAL_MINUTES) ?? positive(env.SCHEDULE_QUOTA_MIN_INTERVAL_MINUTES),
    maxRunsPerCompanyPerMonth: cap(env.SCHEDULE_QUOTA_MAX_RUNS_PER_COMPANY_PER_MONTH),
    maxRunsPerUserPerMonth: cap(env.SCHEDULE_QUOTA_MAX_RUNS_PER_USER_PER_MONTH),
    maxTriggerRunsPerCompanyPerMonth: cap(env.SCHEDULE_QUOTA_MAX_TRIGGER_RUNS_PER_COMPANY_PER_MONTH),
    maxTriggerRunsPerUserPerMonth: cap(env.SCHEDULE_QUOTA_MAX_TRIGGER_RUNS_PER_USER_PER_MONTH),
    maxConcurrentActiveSchedulesPerCompany: cap(env.SCHEDULE_QUOTA_MAX_CONCURRENT_ACTIVE_SCHEDULES_PER_COMPANY),
    maxConcurrentActiveSchedulesPerUser: cap(env.SCHEDULE_QUOTA_MAX_CONCURRENT_ACTIVE_SCHEDULES_PER_USER),
    requireApprovalAboveUserCap: bool(env.SCHEDULE_QUOTA_REQUIRE_APPROVAL_ABOVE_USER_CAP),
  };
};

/**
 * Same shape as `parseQuotasFromEnv` but pulls from a DynamoDB item — the
 * `scheduling-settings` record. The Level 3 admin override.
 */
export const parseQuotasFromSettingsItem = (item: Record<string, unknown> | undefined): PartialScheduleQuotas => {
  if (!item) return {};
  // Caps allow 0 — meaning "0 allowed". minIntervalMinutes (a floor) requires >0.
  const cap = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
  const positive = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
  const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
  return {
    minIntervalMinutes: positive(item.minIntervalMinutes),
    maxRunsPerCompanyPerMonth: cap(item.maxRunsPerCompanyPerMonth),
    maxRunsPerUserPerMonth: cap(item.maxRunsPerUserPerMonth),
    maxTriggerRunsPerCompanyPerMonth: cap(item.maxTriggerRunsPerCompanyPerMonth),
    maxTriggerRunsPerUserPerMonth: cap(item.maxTriggerRunsPerUserPerMonth),
    maxConcurrentActiveSchedulesPerCompany: cap(item.maxConcurrentActiveSchedulesPerCompany),
    maxConcurrentActiveSchedulesPerUser: cap(item.maxConcurrentActiveSchedulesPerUser),
    requireApprovalAboveUserCap: bool(item.requireApprovalAboveUserCap),
  };
};
