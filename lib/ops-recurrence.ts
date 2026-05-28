/**
 * Recurring-ticket scheduling helpers.
 *
 * The AWS cron expression we emit only describes *candidate* fire moments
 * (e.g. "every Monday at 9am"). Interval semantics ("every 2 Mondays"),
 * startDate gating, and endDate / maxOccurrences are enforced by the runner
 * using {@link shouldFireNow} — keeping the cron itself a tractable
 * day-of-week / day-of-month pattern instead of trying to encode arbitrary
 * step arithmetic in cron.
 *
 * No external date lib — `Intl.DateTimeFormat` handles all timezone work,
 * which keeps Lambda cold start fast and avoids a wire-version drift between
 * lib, lambda, and frontend.
 */

import type { RecurrenceConfig, RecurrencePattern } from './ops-schemas';

// ─── Cron generation ────────────────────────────────────────────────────────────

/**
 * Build an AWS Scheduler-compatible cron expression from a {@link RecurrenceConfig}.
 *
 * The returned expression always uses `?` in either day-of-month OR
 * day-of-week (AWS requires exactly one to be specified, the other `?`).
 * `interval > 1` is NOT encoded into the cron — the runner enforces it.
 */
export function buildCronExpression(config: RecurrenceConfig): string {
  const [hh, mm] = parseTimeOfDay(config.timeOfDay);

  switch (config.pattern) {
    case 'daily':
      return `cron(${mm} ${hh} * * ? *)`;

    case 'weekly': {
      if (!config.daysOfWeek || config.daysOfWeek.length === 0) {
        throw new Error('weekly recurrence requires daysOfWeek');
      }
      // Schema uses 0=Sunday … 6=Saturday. AWS Quartz uses 1=Sunday … 7=Saturday.
      const days = [...config.daysOfWeek]
        .sort((a, b) => a - b)
        .map((d) => d + 1)
        .join(',');
      return `cron(${mm} ${hh} ? * ${days} *)`;
    }

    case 'monthly': {
      if (config.dayOfMonth == null) throw new Error('monthly recurrence requires dayOfMonth');
      return `cron(${mm} ${hh} ${config.dayOfMonth} * ? *)`;
    }

    case 'yearly': {
      if (config.dayOfMonth == null || config.monthOfYear == null) {
        throw new Error('yearly recurrence requires dayOfMonth and monthOfYear');
      }
      return `cron(${mm} ${hh} ${config.dayOfMonth} ${config.monthOfYear} ? *)`;
    }
  }
}

function parseTimeOfDay(timeOfDay: string): [hour: number, minute: number] {
  const [h, m] = timeOfDay.split(':').map(Number);
  return [h, m];
}

// ─── Runner-side gating ─────────────────────────────────────────────────────────

/**
 * Returns true when the candidate fire at `now` should actually spawn a
 * ticket — i.e. it's on/after startDate, on/before endDate, AND lands on an
 * "on" interval relative to startDate.
 *
 * The cron expression already guarantees correct hour/minute/day-of-week or
 * day-of-month; this function adds the multi-unit interval check and the
 * date-range bounds.
 */
export function shouldFireNow(config: RecurrenceConfig, now: Date): boolean {
  const localToday = ymdInZone(now, config.timezone);
  if (localToday < config.startDate) return false;
  if (config.endDate && localToday > config.endDate) return false;

  if (config.interval <= 1) return true;

  const start = parseYmd(config.startDate);
  const today = parseYmd(localToday);

  switch (config.pattern) {
    case 'daily':
      return daysBetween(start, today) % config.interval === 0;

    case 'weekly': {
      // Anchor on the Sunday of startDate's week so all rules with the same
      // startDate share the same "week 0".
      const startWeekAnchor = startOfWeekUtc(start);
      const todayWeekAnchor = startOfWeekUtc(today);
      const weeks = Math.round(daysBetween(startWeekAnchor, todayWeekAnchor) / 7);
      return weeks % config.interval === 0;
    }

    case 'monthly': {
      const months =
        (today.getUTCFullYear() - start.getUTCFullYear()) * 12 + (today.getUTCMonth() - start.getUTCMonth());
      return months >= 0 && months % config.interval === 0;
    }

    case 'yearly': {
      const years = today.getUTCFullYear() - start.getUTCFullYear();
      return years >= 0 && years % config.interval === 0;
    }
  }
}

/**
 * Best-effort "next fire" for display purposes. Walks forward day-by-day
 * from `after` (default: now) until it finds a date that matches the
 * candidate cron pattern AND passes {@link shouldFireNow}. Returns null if
 * the rule has expired (past endDate).
 *
 * Caps the search at 5 years to avoid runaway loops on misconfigured rules.
 */
export function computeNextFireAt(config: RecurrenceConfig, after: Date = new Date()): Date | null {
  const MAX_DAYS = 365 * 5;
  const todayYmd = ymdInZone(after, config.timezone);
  let cursor = parseYmd(todayYmd > config.startDate ? todayYmd : config.startDate);

  for (let i = 0; i < MAX_DAYS; i++) {
    const cursorYmd = formatYmd(cursor);
    if (config.endDate && cursorYmd > config.endDate) return null;

    if (matchesPattern(config, cursor) && shouldFireNowYmd(config, cursorYmd)) {
      // Convert local (cursor date + timeOfDay) in config.timezone → UTC Date
      const utc = localTimeToUtc(cursorYmd, config.timeOfDay, config.timezone);
      if (utc.getTime() > after.getTime()) return utc;
    }
    cursor = addDaysUtc(cursor, 1);
  }
  return null;
}

function matchesPattern(config: RecurrenceConfig, day: Date): boolean {
  switch (config.pattern) {
    case 'daily':
      return true;
    case 'weekly':
      return config.daysOfWeek?.includes(day.getUTCDay()) ?? false;
    case 'monthly':
      return config.dayOfMonth === day.getUTCDate();
    case 'yearly':
      return config.dayOfMonth === day.getUTCDate() && config.monthOfYear === day.getUTCMonth() + 1;
  }
}

function shouldFireNowYmd(config: RecurrenceConfig, ymd: string): boolean {
  // Anchor on local noon in the target timezone. Using *UTC* noon is wrong
  // for high-offset zones — Pacific/Auckland (+12/+13) sees UTC noon as the
  // next calendar day, so the interval check inside shouldFireNow runs
  // against a day off-by-one from the candidate `ymd`. Local noon
  // guarantees `ymdInZone(localNoon, timezone) === ymd` for any zone.
  const localNoon = localTimeToUtc(ymd, '12:00', config.timezone);
  return shouldFireNow(config, localNoon);
}

// ─── Timezone-aware date helpers ────────────────────────────────────────────────

/** Returns YYYY-MM-DD of `instant` in `timezone`. */
export function ymdInZone(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

/**
 * Convert a local calendar date + HH:MM in the given timezone to a UTC Date.
 * Works by computing the timezone's offset at the candidate UTC instant and
 * adjusting until the local readout matches the requested wall-clock time.
 * Handles DST correctly because the offset is computed per-instant.
 */
export function localTimeToUtc(ymd: string, timeOfDay: string, timezone: string): Date {
  const [hh, mm] = parseTimeOfDay(timeOfDay);
  const [y, m, d] = ymd.split('-').map(Number);
  // First guess: treat the local time as if it were UTC.
  let candidate = new Date(Date.UTC(y, m - 1, d, hh, mm));
  // Two-pass adjustment handles DST boundaries.
  for (let i = 0; i < 2; i++) {
    const offsetMinutes = timezoneOffsetMinutes(candidate, timezone);
    candidate = new Date(Date.UTC(y, m - 1, d, hh, mm) - offsetMinutes * 60_000);
  }
  return candidate;
}

/** Minutes east of UTC for `timezone` at `instant`. e.g. NZST=+720, EST=-300. */
function timezoneOffsetMinutes(instant: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  const localMs = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour === '24' ? '00' : map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return Math.round((localMs - instant.getTime()) / 60_000);
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function addDaysUtc(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfWeekUtc(date: Date): Date {
  const dow = date.getUTCDay(); // 0=Sunday
  return addDaysUtc(date, -dow);
}

// ─── Human-readable summary ─────────────────────────────────────────────────────

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * One-line English summary like "Every 2 weeks on Mon, Wed at 09:00 (Pacific/Auckland)".
 * Used in the picker preview and on the ticket detail "Repeats" row.
 */
export function summarizeRecurrence(config: RecurrenceConfig): string {
  const unit = unitLabel(config.pattern, config.interval);
  const interval = config.interval > 1 ? `Every ${config.interval} ${unit}` : `Every ${unit}`;

  let detail = '';
  switch (config.pattern) {
    case 'weekly':
      if (config.daysOfWeek?.length) {
        const days = [...config.daysOfWeek]
          .sort((a, b) => a - b)
          .map((d) => DOW_NAMES[d])
          .join(', ');
        detail = ` on ${days}`;
      }
      break;
    case 'monthly':
      if (config.dayOfMonth != null) detail = ` on day ${config.dayOfMonth}`;
      break;
    case 'yearly':
      if (config.monthOfYear != null && config.dayOfMonth != null) {
        detail = ` on ${MONTH_NAMES[config.monthOfYear - 1]} ${config.dayOfMonth}`;
      }
      break;
  }

  const tail: string[] = [`at ${config.timeOfDay} (${config.timezone})`];
  if (config.endDate) tail.push(`until ${config.endDate}`);
  if (config.maxOccurrences) tail.push(`for ${config.maxOccurrences} occurrences`);
  return `${interval}${detail}, ${tail.join(', ')}`;
}

function unitLabel(pattern: RecurrencePattern, interval: number): string {
  const plural = interval > 1;
  switch (pattern) {
    case 'daily':
      return plural ? 'days' : 'day';
    case 'weekly':
      return plural ? 'weeks' : 'week';
    case 'monthly':
      return plural ? 'months' : 'month';
    case 'yearly':
      return plural ? 'years' : 'year';
  }
}
