/**
 * Frontend cron projection helpers — duplicate of lib/schedule-load.ts on
 * the backend. KEEP IN SYNC with `projectMonthlyRuns` and the estimator in
 * `Components/Agents/CronExpressionBuilder.tsx`.
 *
 * Browser-bundle-friendly (no zod / Node deps).
 */

const MINUTES_PER_MONTH = 43_800; // 30.4375 days
const MIN_PROJECTED_RUNS = 1;

/**
 * Estimate the approximate interval in minutes between runs for a cron
 * expression. Returns `null` for unparseable / overly complex patterns.
 */
export const estimateCronIntervalMinutes = (expression: string): number | null => {
  const match = expression.match(/^cron\((.+)\)$/);
  if (!match) return null;
  const fields = match[1].trim().split(/\s+/);
  if (fields.length !== 6) return null;
  const [minute, hour, dom, month, , year] = fields;
  if (/^\d{4}$/.test(year)) return Infinity;
  const minuteStep = minute.match(/^(?:\d+|\*)\/(\d+)$/);
  if (minuteStep && hour === '*') return parseInt(minuteStep[1], 10);
  if (hour === '*' && /^\d+(,\d+)+$/.test(minute)) {
    const values = minute
      .split(',')
      .map((v) => parseInt(v, 10))
      .sort((a, b) => a - b);
    let minGap = 60 - values[values.length - 1] + values[0];
    for (let i = 1; i < values.length; i++) minGap = Math.min(minGap, values[i] - values[i - 1]);
    return minGap;
  }
  const hourStep = hour.match(/^(?:\d+|\*)\/(\d+)$/);
  if (hourStep) return parseInt(hourStep[1], 10) * 60;
  const domStep = dom.match(/^(?:\d+|\*)\/(\d+)$/);
  if (domStep) return parseInt(domStep[1], 10) * 1440;
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && (dom === '*' || dom === '?')) return 1440;
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && /^\d+$/.test(dom)) return 43200;
  const monthStep = month.match(/^(?:\d+|\*)\/(\d+)$/);
  if (monthStep) return parseInt(monthStep[1], 10) * 43200;
  return null;
};

/**
 * Project the expected number of runs per month. Mirrors
 * `lib/schedule-load.ts:projectMonthlyRuns` exactly.
 */
export const projectMonthlyRuns = (cronExpression: string): number => {
  const intervalMinutes = estimateCronIntervalMinutes(cronExpression);
  if (intervalMinutes === null || intervalMinutes <= 0) return MIN_PROJECTED_RUNS;
  if (!Number.isFinite(intervalMinutes)) return MIN_PROJECTED_RUNS;
  return Math.max(MIN_PROJECTED_RUNS, Math.round(MINUTES_PER_MONTH / intervalMinutes));
};

/**
 * Returns true when the cadence is "high-frequency" by FEAT-105 thresholds:
 * > 100 projected runs/month OR firing more often than every 30 minutes.
 * Lives here (not in HighFrequencyConfirmModal.tsx) to satisfy
 * react-refresh/only-export-components and to keep the rule reusable.
 */
export const isHighFrequencyCadence = (projectedRunsPerMonth: number, intervalMinutes: number | null): boolean => {
  if (projectedRunsPerMonth > 100) return true;
  if (intervalMinutes != null && intervalMinutes < 30) return true;
  return false;
};
