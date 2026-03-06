// Custom cron parsing implementation to replace problematic cron-parser library
// This handles AWS EventBridge cron expressions and generates next run times

const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();
const weekdayFormatCache = new Map<string, Intl.DateTimeFormat>();

const dayNameToNumber: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

const normalizeCronValue = (value: string, field: 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek') => {
  const upper = value.toUpperCase();
  if (field === 'dayOfWeek' && upper in dayNameToNumber) {
    return String(dayNameToNumber[upper]);
  }
  return value;
};

const parseCronField = (
  field: string,
  min: number,
  max: number,
  fieldName: 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek'
) => {
  const rawField = field.trim();
  if (!rawField) return null;

  const normalizePart = (part: string) => normalizeCronValue(part.trim(), fieldName);

  const parseNumber = (value: string) => {
    const num = parseInt(normalizePart(value), 10);
    if (Number.isNaN(num)) return null;
    if (num < min || num > max) return null;
    return num;
  };

  const parseRange = (value: string) => {
    const [startStr, endStr] = value.split('-').map(normalizePart);
    if (endStr === undefined) return null;
    const start = parseNumber(startStr);
    const end = parseNumber(endStr);
    if (start === null || end === null) return null;
    if (start > end) return null;
    return { start, end };
  };

  const parseStep = (value: string) => {
    const [baseStr, stepStr] = value.split('/');
    if (stepStr === undefined) return null;
    const step = parseInt(stepStr, 10);
    if (Number.isNaN(step) || step <= 0) return null;

    const base = baseStr.trim() || '*';
    if (base === '*') {
      return {
        start: min,
        end: max,
        step,
      };
    }

    if (base.includes('-')) {
      const range = parseRange(base);
      if (!range) return null;
      return { start: range.start, end: range.end, step };
    }

    const start = parseNumber(base);
    if (start === null) return null;
    return {
      start,
      end: max,
      step,
    };
  };

  const parseSimple = (value: string) => {
    if (value === '*') {
      return { matches: (_: number) => true };
    }

    if (value.includes('/')) {
      const stepDef = parseStep(value);
      if (!stepDef) return null;
      return {
        matches: (v: number) => v >= stepDef.start && v <= stepDef.end && (v - stepDef.start) % stepDef.step === 0,
      };
    }

    if (value.includes('-')) {
      const range = parseRange(value);
      if (!range) return null;
      return { matches: (v: number) => v >= range.start && v <= range.end };
    }

    const num = parseNumber(value);
    if (num === null) return null;
    return { matches: (v: number) => v === num };
  };

  if (rawField.includes(',')) {
    const parts = rawField
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const matchers = parts.map(parseSimple);
    if (matchers.some((matcher) => matcher === null)) return null;
    return { matches: (v: number) => matchers.some((matcher) => matcher!.matches(v)) };
  }

  return parseSimple(rawField);
};

const getZonedDateTimeParts = (date: Date, timezone: string) => {
  let formatter = dateTimeFormatCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    dateTimeFormatCache.set(timezone, formatter);
  }

  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';

  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
    second: parseInt(get('second'), 10),
  };
};

const getZonedWeekday = (date: Date, timezone: string): number => {
  let formatter = weekdayFormatCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
    weekdayFormatCache.set(timezone, formatter);
  }

  const weekday = formatter.format(date);
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return weekdayMap[weekday] ?? 0;
};

const makeUtcDateFromZonedParts = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string
): Date => {
  // We want to find the UTC timestamp that, when displayed in the target timezone,
  // shows the specified date/time values.
  //
  // Strategy: Start with a guess (treating input as UTC), then see what that looks like
  // in the target timezone, and adjust by the difference.

  const guessUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0));

  // See what this UTC time looks like in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(guessUtc);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);

  const shownYear = get('year');
  const shownMonth = get('month');
  const shownDay = get('day');
  const shownHour = get('hour');
  const shownMinute = get('minute');
  const shownSecond = get('second');

  // Calculate the difference between what we want and what we got
  const wantedUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const shownUtc = Date.UTC(shownYear, shownMonth - 1, shownDay, shownHour, shownMinute, shownSecond);

  const offsetMs = shownUtc - wantedUtc;

  // Adjust the guess by subtracting the offset
  return new Date(guessUtc.getTime() - offsetMs);
};

/**
 * Parses a standard 5-field cron expression and calculates next occurrence
 */
const calculateNextOccurrence = (cronFields: string[], from: Date, timezone: string): Date | null => {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cronFields;

  const minuteField = parseCronField(minute, 0, 59, 'minute');
  const hourField = parseCronField(hour, 0, 23, 'hour');
  const dayField = parseCronField(dayOfMonth, 1, 31, 'dayOfMonth');
  const monthField = parseCronField(month, 1, 12, 'month');
  const dayOfWeekField = parseCronField(dayOfWeek, 0, 6, 'dayOfWeek');

  if (!minuteField || !hourField || !dayField || !monthField || !dayOfWeekField) {
    return null;
  }

  // Start from the next minute (rounded to minute) to avoid returning current time
  const startMs = from.getTime();
  let nextDate = new Date(Math.floor((startMs + 60000) / 60000) * 60000);

  // Find next valid occurrence (with reasonable limit to prevent infinite loop)
  for (let attempts = 0; attempts < 525600; attempts++) {
    // Max 1 year of minutes
    const parts = getZonedDateTimeParts(nextDate, timezone);
    const checkMinute = parts.minute;
    const checkHour = parts.hour;
    const checkDay = parts.day;
    const checkMonth = parts.month;
    const checkDayOfWeek = getZonedWeekday(nextDate, timezone);

    // Check if this time matches the cron pattern
    let matches = true;

    if (!minuteField.matches(checkMinute)) matches = false;
    if (!hourField.matches(checkHour)) matches = false;
    if (!dayField.matches(checkDay)) matches = false;
    if (!monthField.matches(checkMonth)) matches = false;
    if (!dayOfWeekField.matches(checkDayOfWeek)) matches = false;

    if (matches) {
      return nextDate;
    }

    // Move to next minute (UTC)
    nextDate = new Date(nextDate.getTime() + 60000);
  }

  return null;
};

/**
 * Generates a single occurrence for a specific year (one-time event)
 */
const generateOneTimeEvent = (cronFields: string[], targetYear: number, timezone: string): Date[] => {
  if (!Array.isArray(cronFields) || cronFields.length !== 5) {
    console.error('Invalid cronFields for one-time event:', { cronFields });
    return [];
  }

  const [minute, hour, dayOfMonth, month, _dayOfWeek] = cronFields;

  // Convert to numbers (month is 1-based in cron, 0-based in JS Date)
  const minuteVal = parseInt(minute);
  const hourVal = parseInt(hour);
  const dayVal = parseInt(dayOfMonth);
  const monthVal = parseInt(month) - 1; // Convert to 0-based

  if (isNaN(minuteVal) || isNaN(hourVal) || isNaN(dayVal) || isNaN(monthVal)) {
    console.error('Invalid numeric values in cron fields:', { minute, hour, dayOfMonth, month });
    return [];
  }

  // Create the specific date in the requested timezone
  const eventDate = makeUtcDateFromZonedParts(targetYear, monthVal + 1, dayVal, hourVal, minuteVal, 0, timezone);

  return [eventDate];
};

/**
 * Generates multiple future occurrences from a cron expression
 */
const generateNextOccurrences = (cronFields: string[], startFrom: Date, timezone: string, count: number): Date[] => {
  if (!Array.isArray(cronFields)) {
    console.error('cronFields is not an array:', { cronFields, type: typeof cronFields });
    return [];
  }

  const occurrences: Date[] = [];
  let currentDate = new Date(startFrom);

  for (let i = 0; i < count; i++) {
    const nextOccurrence = calculateNextOccurrence(cronFields, currentDate, timezone);
    if (!nextOccurrence) {
      break;
    }

    occurrences.push(nextOccurrence);

    // Move just past this occurrence to avoid duplicates while preserving step/range patterns
    currentDate = new Date(nextOccurrence.getTime() + 60000);
  }

  return occurrences;
};

/**
 * Validates a cron expression format
 */
const isValidCronFormat = (cronFields: string[]): boolean => {
  if (!Array.isArray(cronFields) || cronFields.length !== 5) {
    console.error('Invalid cronFields structure:', { cronFields });
    return false;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = cronFields;

  const minuteField = parseCronField(minute, 0, 59, 'minute');
  const hourField = parseCronField(hour, 0, 23, 'hour');
  const dayField = parseCronField(dayOfMonth, 1, 31, 'dayOfMonth');
  const monthField = parseCronField(month, 1, 12, 'month');
  const dayOfWeekField = parseCronField(dayOfWeek, 0, 6, 'dayOfWeek');

  const isValid = Boolean(minuteField && hourField && dayField && monthField && dayOfWeekField);

  if (!isValid) {
    console.error('Invalid cron field validation:', { minute, hour, dayOfMonth, month, dayOfWeek });
  }

  return isValid;
};

export interface NextRunInfo {
  nextRun: Date | null;
  humanReadable: string;
  isActive: boolean;
}

/**
 * Parses AWS EventBridge cron expression and determines if it's a one-time event
 * EventBridge format: cron(minute hour day-of-month month day-of-week year)
 */
const parseEventBridgeCron = (
  cronExpr: string
): { cronFields: string[]; isOneTime: boolean; targetYear?: number } | null => {
  // Remove 'cron(' prefix and ')' suffix if present
  let expr = cronExpr.trim();
  if (expr.startsWith('cron(') && expr.endsWith(')')) {
    expr = expr.slice(5, -1);
  }

  // Split into parts
  const parts = expr.split(/\s+/);

  // EventBridge cron has 6 parts, standard cron has 5
  if (parts.length === 6) {
    const [minute, hour, dayOfMonth, month, dayOfWeek, year] = parts;

    // Convert AWS EventBridge '?' to standard cron '*' for the first 5 fields
    const standardParts = [minute, hour, dayOfMonth, month, dayOfWeek].map((part) => (part === '?' ? '*' : part));

    // Check if year is specific (not * or ?)
    const isOneTime = year !== '*' && year !== '?' && !isNaN(parseInt(year));
    const targetYear = isOneTime ? parseInt(year) : undefined;

    return {
      cronFields: standardParts,
      isOneTime,
      targetYear,
    };
  }

  // If it's already 5 parts, assume it's standard cron (recurring)
  if (parts.length === 5) {
    const convertedParts = parts.map((part) => (part === '?' ? '*' : part));
    return {
      cronFields: convertedParts,
      isOneTime: false,
    };
  }

  console.error('Invalid cron parts count:', { cronExpr, partsLength: parts.length });
  return null;
};

/**
 * Legacy function for backwards compatibility
 */
const convertEventBridgeCronToStandard = (cronExpr: string): string | null => {
  const parsed = parseEventBridgeCron(cronExpr);
  return parsed ? parsed.cronFields.join(' ') : null;
};

/**
 * Converts AWS EventBridge rate expression to cron format
 * Rate format: rate(value unit) where unit is minutes, hours, or days
 */
const convertRateToCron = (rateExpr: string): string | null => {
  // Remove 'rate(' prefix and ')' suffix
  let expr = rateExpr.trim();
  if (expr.startsWith('rate(') && expr.endsWith(')')) {
    expr = expr.slice(5, -1);
  }

  const parts = expr.split(/\s+/);
  if (parts.length !== 2) return null;

  const [valueStr, unit] = parts;
  const value = parseInt(valueStr);
  if (isNaN(value)) return null;

  const now = new Date();

  switch (unit.toLowerCase()) {
    case 'minute':
    case 'minutes':
      if (value === 1) return '* * * * *'; // Every minute
      if (value <= 60 && 60 % value === 0) {
        // Every N minutes within an hour
        const minutes = Array.from({ length: 60 / value }, (_, i) => i * value).join(',');
        return `${minutes} * * * *`;
      }
      break;

    case 'hour':
    case 'hours':
      if (value === 1) return `${now.getMinutes()} * * * *`; // Every hour
      if (value <= 24 && 24 % value === 0) {
        const hours = Array.from({ length: 24 / value }, (_, i) => i * value).join(',');
        return `${now.getMinutes()} ${hours} * * *`;
      }
      break;

    case 'day':
    case 'days':
      if (value === 1) return `${now.getMinutes()} ${now.getHours()} * * *`; // Daily
      return `${now.getMinutes()} ${now.getHours()} */${value} * *`;

    default:
      return null;
  }

  return null;
};

/**
 * Calculates the next run time for a given cron expression
 */
export const calculateNextRun = (
  cronExpression: string,
  timezone: string = 'UTC',
  status: 'active' | 'paused' | 'deleted' = 'active'
): NextRunInfo => {
  const defaultResult: NextRunInfo = {
    nextRun: null,
    humanReadable: 'Unable to calculate',
    isActive: status === 'active',
  };

  if (status !== 'active') {
    return {
      nextRun: null,
      humanReadable: status === 'paused' ? 'Paused' : 'Deleted',
      isActive: false,
    };
  }

  try {
    // For EventBridge cron, use parseEventBridgeCron to detect one-time events
    if (cronExpression.startsWith('cron(')) {
      const parsed = parseEventBridgeCron(cronExpression);
      if (!parsed) return defaultResult;

      if (parsed.isOneTime && parsed.targetYear) {
        // One-time event: generate the specific date and check if it's in the future
        const eventDates = generateOneTimeEvent(parsed.cronFields, parsed.targetYear, timezone);
        if (eventDates.length > 0 && eventDates[0] > new Date()) {
          return {
            nextRun: eventDates[0],
            humanReadable: formatNextRunTime(eventDates[0]),
            isActive: true,
          };
        }
        // One-time event in the past — no future occurrences
        return {
          ...defaultResult,
          humanReadable: 'Completed',
          isActive: false,
        };
      }
    }

    let standardCron: string | null = null;

    // Handle different expression formats
    if (cronExpression.startsWith('cron(')) {
      standardCron = convertEventBridgeCronToStandard(cronExpression);
    } else if (cronExpression.startsWith('rate(')) {
      standardCron = convertRateToCron(cronExpression);
    } else {
      standardCron = cronExpression;
    }

    if (!standardCron) {
      return defaultResult;
    }

    // Parse the standard cron expression into fields
    const cronFields = standardCron.split(/\s+/).filter((field) => field.length > 0);

    if (!isValidCronFormat(cronFields)) {
      return {
        ...defaultResult,
        humanReadable: 'Invalid cron format',
      };
    }

    // Calculate the next occurrence
    const nextRun = calculateNextOccurrence(cronFields, new Date(), timezone);

    if (!nextRun) {
      return {
        ...defaultResult,
        humanReadable: 'No future occurrences found',
      };
    }

    return {
      nextRun,
      humanReadable: formatNextRunTime(nextRun),
      isActive: true,
    };
  } catch (error) {
    console.error('CRON PARSER ERROR: Failed to parse cron expression:', {
      cronExpression,
      timezone,
      error,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      ...defaultResult,
      humanReadable: 'Parse error: ' + (error instanceof Error ? error.message : 'Unknown error'),
    };
  }
};

/**
 * Formats the next run time into a human-readable string
 */
const formatNextRunTime = (nextRun: Date): string => {
  const now = new Date();
  const diffMs = nextRun.getTime() - now.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  // If it's in the past, show "Overdue"
  if (diffMs < 0) {
    return 'Overdue';
  }

  // If it's within the next minute
  if (diffMinutes < 1) {
    return 'In less than a minute';
  }

  // If it's within the next hour
  if (diffMinutes < 60) {
    return `In ${diffMinutes} minute${diffMinutes === 1 ? '' : 's'}`;
  }

  // If it's within the next 24 hours
  if (diffHours < 24) {
    const remainingMinutes = diffMinutes % 60;
    if (remainingMinutes === 0) {
      return `In ${diffHours} hour${diffHours === 1 ? '' : 's'}`;
    }
    return `In ${diffHours}h ${remainingMinutes}m`;
  }

  // If it's within the next week
  if (diffDays < 7) {
    const remainingHours = diffHours % 24;
    if (remainingHours === 0) {
      return `In ${diffDays} day${diffDays === 1 ? '' : 's'}`;
    }
    return `In ${diffDays}d ${remainingHours}h`;
  }

  // For longer periods, show the actual date and time
  return nextRun.toLocaleString();
};

/**
 * Converts a cron expression to a human-readable description
 */
export const describeCronExpression = (cronExpression: string): string => {
  if (!cronExpression) return '';
  try {
    // Handle rate expressions first
    if (cronExpression.startsWith('rate(')) {
      let expr = cronExpression.trim();
      if (expr.startsWith('rate(') && expr.endsWith(')')) {
        expr = expr.slice(5, -1);
        const parts = expr.split(/\s+/);
        if (parts.length === 2) {
          const [value, unit] = parts;
          const num = parseInt(value);
          if (!isNaN(num)) {
            const unitName = unit.toLowerCase().replace(/s$/, ''); // Remove plural 's'
            if (num === 1) {
              return `Every ${unitName}`;
            } else {
              return `Every ${num} ${unitName}s`;
            }
          }
        }
        return `Every ${expr}`;
      }
      return cronExpression;
    }

    // Parse EventBridge cron expressions (which may include year)
    let parsed: { cronFields: string[]; isOneTime: boolean; targetYear?: number } | null = null;

    if (cronExpression.startsWith('cron(')) {
      parsed = parseEventBridgeCron(cronExpression);
    } else {
      // Standard cron expression
      const cronFields = cronExpression.split(/\s+/).filter((field) => field.length > 0);
      if (cronFields.length === 5) {
        parsed = {
          cronFields: cronFields.map((part) => (part === '?' ? '*' : part)),
          isOneTime: false,
        };
      }
    }

    if (!parsed || !parsed.cronFields || parsed.cronFields.length !== 5) {
      return cronExpression;
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parsed.cronFields;

    const parseStepValue = (value: string) => {
      if (!value.includes('/')) return null;
      const [base, stepStr] = value.split('/');
      const step = parseInt(stepStr, 10);
      if (Number.isNaN(step) || step <= 0) return null;
      return {
        base: base.trim(),
        step,
      };
    };

    // Helper function to format time
    const formatTime = (h: string, m: string): string => {
      const hourNum = parseInt(h);
      const minuteNum = parseInt(m);
      if (isNaN(hourNum) || isNaN(minuteNum)) return `${h}:${m}`;

      const hour12 = hourNum === 0 ? 12 : hourNum > 12 ? hourNum - 12 : hourNum;
      const ampm = hourNum >= 12 ? 'PM' : 'AM';
      const minuteStr = minuteNum.toString().padStart(2, '0');
      return `${hour12}:${minuteStr} ${ampm}`;
    };

    // Helper function to get month name
    const getMonthName = (m: string): string => {
      const months = [
        '',
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
      const monthNum = parseInt(m);
      return !isNaN(monthNum) && monthNum >= 1 && monthNum <= 12 ? months[monthNum] : m;
    };

    // Helper function to get day name (handles both numeric 0-6 and text SUN-SAT)
    const getDayName = (d: string): string => {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayNum = parseInt(d);
      if (!isNaN(dayNum) && dayNum >= 0 && dayNum <= 6) return days[dayNum];

      // Handle text abbreviations
      const dayMap: Record<string, string> = {
        SUN: 'Sunday',
        MON: 'Monday',
        TUE: 'Tuesday',
        WED: 'Wednesday',
        THU: 'Thursday',
        FRI: 'Friday',
        SAT: 'Saturday',
      };
      return dayMap[d.toUpperCase()] || d;
    };

    // Helper to get ordinal word (first, second, etc.)
    const getOrdinalWord = (num: number | 'last'): string => {
      if (num === 'last') return 'last';
      const words = ['', 'first', 'second', 'third', 'fourth', 'fifth'];
      return words[num] || `${num}th`;
    };

    // Helper to parse day-of-week with #N or L suffix
    const parseDayOfWeekSpecifier = (
      dow: string
    ): { days: string[]; weekNumbers: (number | 'last')[]; isNthPattern: boolean } => {
      const days: string[] = [];
      const weekNumbers: (number | 'last')[] = [];
      let isNthPattern = false;

      const tokens = dow.split(',');
      for (const token of tokens) {
        const trimmed = token.trim().toUpperCase();

        // Handle "MONL" or "MON#L" (last Monday)
        if (trimmed.endsWith('L')) {
          isNthPattern = true;
          const dayPart = trimmed.replace(/L$/, '').replace(/#$/, '');
          days.push(getDayName(dayPart));
          if (!weekNumbers.includes('last')) weekNumbers.push('last');
        }
        // Handle "MON#1", "TUE#2", etc. (nth weekday)
        else if (trimmed.includes('#')) {
          isNthPattern = true;
          const [dayPart, numPart] = trimmed.split('#');
          days.push(getDayName(dayPart));
          const weekNum = parseInt(numPart, 10);
          if (!isNaN(weekNum) && !weekNumbers.includes(weekNum)) {
            weekNumbers.push(weekNum);
          }
        }
        // Plain day name or number
        else {
          days.push(getDayName(trimmed));
        }
      }

      return { days: [...new Set(days)], weekNumbers: [...new Set(weekNumbers)], isNthPattern };
    };

    // Helper to check if day-of-week represents weekdays (Mon-Fri)
    const isWeekdaysPattern = (dow: string): boolean => {
      const normalized = dow.toUpperCase().trim();
      // Check for numeric range 1-5 (our generated format) or MON-FRI
      if (normalized === '1-5' || normalized === 'MON-FRI' || normalized === '2-6') {
        return true;
      }
      // Check for comma-separated weekdays
      const weekdayPatterns = ['1,2,3,4,5', '2,3,4,5,6', 'MON,TUE,WED,THU,FRI'];
      return weekdayPatterns.includes(normalized);
    };

    // Helper function to get ordinal suffix
    const getOrdinal = (num: number): string => {
      const suffix = ['th', 'st', 'nd', 'rd'];
      const v = num % 100;
      return num + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
    };

    // Handle one-time events (with specific year)
    if (parsed.isOneTime && parsed.targetYear) {
      const timeStr = minute !== '*' && hour !== '*' ? formatTime(hour, minute) : 'unspecified time';

      if (minute !== '*' && hour !== '*' && dayOfMonth !== '*' && month !== '*') {
        const monthName = getMonthName(month);
        const dayNum = parseInt(dayOfMonth);
        const dayStr = !isNaN(dayNum) ? getOrdinal(dayNum) : dayOfMonth;
        return `Once on ${monthName} ${dayStr}, ${parsed.targetYear} at ${timeStr}`;
      }

      return `Once in ${parsed.targetYear} at ${timeStr}`;
    }

    // Handle recurring patterns

    // Every minute
    if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return 'Every minute';
    }

    const minuteStep = parseStepValue(minute);
    const hourStep = parseStepValue(hour);

    // Every N minutes
    if (minuteStep && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      if (minuteStep.base === '*' || minuteStep.base === '0') {
        return `Every ${minuteStep.step} minutes`;
      }
      const baseMinute = parseInt(minuteStep.base, 10);
      if (!isNaN(baseMinute)) {
        return `Every ${minuteStep.step} minutes starting at minute ${baseMinute}`;
      }
      return `Every ${minuteStep.step} minutes`;
    }

    // Every N hours at specific minute
    if (hourStep && minute !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      const minNum = parseInt(minute);
      if (!isNaN(minNum)) {
        if (hourStep.base === '*' || hourStep.base === '0') {
          return `Every ${hourStep.step} hours at minute ${minNum}`;
        }
        const baseHour = parseInt(hourStep.base, 10);
        if (!isNaN(baseHour)) {
          return `Every ${hourStep.step} hours starting at ${formatTime(String(baseHour), minute)}`;
        }
        return `Every ${hourStep.step} hours at minute ${minNum}`;
      }
    }

    // Every hour at specific minute
    if (minute !== '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      const minNum = parseInt(minute);
      if (!isNaN(minNum)) {
        return `Every hour at minute ${minNum}`;
      }
    }

    // Daily at specific time
    if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return `Daily at ${formatTime(hour, minute)}`;
    }

    // Weekdays (Mon-Fri) at specific time
    if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && isWeekdaysPattern(dayOfWeek)) {
      return `Weekdays at ${formatTime(hour, minute)}`;
    }

    // Weekly/Monthly with nth week specifiers (e.g., MON#1, TUE#2, FRIL)
    if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && dayOfWeek !== '*') {
      const { days, weekNumbers, isNthPattern } = parseDayOfWeekSpecifier(dayOfWeek);

      if (isNthPattern && days.length > 0 && weekNumbers.length > 0) {
        const timeStr = formatTime(hour, minute);

        // Single day with single week number - most common case
        if (days.length === 1 && weekNumbers.length === 1) {
          const weekWord = getOrdinalWord(weekNumbers[0]);
          // Check if it's monthly (month === '*') or specific month pattern
          if (month === '*') {
            return `${weekWord.charAt(0).toUpperCase() + weekWord.slice(1)} ${days[0]} of each month at ${timeStr}`;
          }
        }

        // Multiple days or week numbers
        const weekWords = weekNumbers.map((n) => getOrdinalWord(n)).join(', ');
        const dayList = days.join(', ');

        if (month === '*') {
          if (days.length === 1) {
            return `${dayList} (${weekWords} week) of each month at ${timeStr}`;
          }
          return `${dayList} (${weekWords} week) of each month at ${timeStr}`;
        }
      }

      // Simple weekly pattern (no # or L specifiers)
      if (!isNthPattern && days.length > 0) {
        const dayList = days.length === 1 ? `${days[0]}s` : days.join(', ');
        return `Weekly on ${dayList} at ${formatTime(hour, minute)}`;
      }
    }

    // Fallback for simple weekly on specific day and time (handles numeric days)
    if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
      const dayName = getDayName(dayOfWeek);
      return `Weekly on ${dayName}s at ${formatTime(hour, minute)}`;
    }

    // Monthly on specific day and time
    if (minute !== '*' && hour !== '*' && dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
      const dayNum = parseInt(dayOfMonth);
      const dayStr = !isNaN(dayNum) ? getOrdinal(dayNum) : dayOfMonth;
      return `Monthly on the ${dayStr} at ${formatTime(hour, minute)}`;
    }

    // Yearly on specific date and time
    if (minute !== '*' && hour !== '*' && dayOfMonth !== '*' && month !== '*' && dayOfWeek === '*') {
      const monthName = getMonthName(month);
      const dayNum = parseInt(dayOfMonth);
      const dayStr = !isNaN(dayNum) ? getOrdinal(dayNum) : dayOfMonth;
      return `Yearly on ${monthName} ${dayStr} at ${formatTime(hour, minute)}`;
    }

    // Specific month and day (any year)
    if (dayOfMonth !== '*' && month !== '*' && dayOfWeek === '*') {
      const monthName = getMonthName(month);
      const dayNum = parseInt(dayOfMonth);
      const dayStr = !isNaN(dayNum) ? getOrdinal(dayNum) : dayOfMonth;
      const timeStr = minute !== '*' && hour !== '*' ? ` at ${formatTime(hour, minute)}` : '';
      return `Every ${monthName} ${dayStr}${timeStr}`;
    }

    // If we can't describe it simply, try to give a basic breakdown
    const parts = [];
    if (minute !== '*') parts.push(`minute ${minute}`);
    if (hour !== '*') parts.push(`hour ${hour}`);
    if (dayOfMonth !== '*') parts.push(`day ${dayOfMonth}`);
    if (month !== '*') parts.push(`month ${getMonthName(month)}`);
    if (dayOfWeek !== '*') parts.push(`${getDayName(dayOfWeek)}s`);

    if (parts.length > 0) {
      return `When ${parts.join(', ')}`;
    }

    // Final fallback - return original but cleaned up
    return cronExpression;
  } catch (error) {
    console.warn('Error describing cron expression:', error);
    return cronExpression;
  }
};

/**
 * Validates a cron expression
 */
export const validateCronExpression = (cronExpression: string): { isValid: boolean; error?: string } => {
  try {
    let standardCron: string | null = null;

    if (cronExpression.startsWith('cron(')) {
      standardCron = convertEventBridgeCronToStandard(cronExpression);
    } else if (cronExpression.startsWith('rate(')) {
      standardCron = convertRateToCron(cronExpression);
    } else {
      standardCron = cronExpression;
    }

    if (!standardCron) {
      return { isValid: false, error: 'Invalid expression format' };
    }

    // Parse the standard cron expression into fields
    const cronFields = standardCron.split(/\s+/);

    if (!isValidCronFormat(cronFields)) {
      return { isValid: false, error: 'Invalid cron field values' };
    }

    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Invalid cron expression',
    };
  }
};

/**
 * Gets both past and future run times for a cron expression for calendar display
 */
export const getCalendarRunTimes = (
  cronExpression: string,
  timezone: string = 'UTC',
  pastCount: number = 10,
  futureCount: number = 30
): Date[] => {
  try {
    let parsedCron: { cronFields: string[]; isOneTime: boolean; targetYear?: number } | null = null;

    if (cronExpression.startsWith('cron(')) {
      parsedCron = parseEventBridgeCron(cronExpression);
    } else if (cronExpression.startsWith('rate(')) {
      const standardCron = convertRateToCron(cronExpression);
      if (standardCron) {
        const cronFields = standardCron.split(/\s+/).filter((field) => field.length > 0);
        parsedCron = { cronFields, isOneTime: false };
      }
    } else {
      const cronFields = cronExpression.split(/\s+/).filter((field) => field.length > 0);
      parsedCron = { cronFields, isOneTime: false };
    }

    if (!parsedCron || !parsedCron.cronFields) {
      return [];
    }

    if (!isValidCronFormat(parsedCron.cronFields)) {
      return [];
    }

    const now = new Date();
    const runTimes: Date[] = [];

    // For one-time events, just generate the single occurrence
    if (parsedCron.isOneTime && parsedCron.targetYear) {
      const oneTimeEvents = generateOneTimeEvent(parsedCron.cronFields, parsedCron.targetYear, timezone);
      return oneTimeEvents;
    }

    // Generate past events (working backwards from now)
    const pastEvents = generatePastOccurrences(parsedCron.cronFields, now, timezone, pastCount);
    runTimes.push(...pastEvents);

    // Generate future events
    const futureEvents = generateNextOccurrences(parsedCron.cronFields, now, timezone, futureCount);
    runTimes.push(...futureEvents);

    // Sort all events chronologically
    return runTimes.sort((a, b) => a.getTime() - b.getTime());
  } catch (error) {
    console.error('GET_CALENDAR_RUN_TIMES ERROR:', error);
    return [];
  }
};

/**
 * Gets all run times for a cron expression within a specific range.
 */
export const getRunTimesInRange = (
  cronExpression: string,
  startDate: Date,
  endDate: Date,
  timezone: string = 'UTC',
  maxOccurrences: number = 1000
): Date[] => {
  try {
    if (startDate > endDate) return [];

    let parsedCron: { cronFields: string[]; isOneTime: boolean; targetYear?: number } | null = null;

    if (cronExpression.startsWith('cron(')) {
      parsedCron = parseEventBridgeCron(cronExpression);
    } else if (cronExpression.startsWith('rate(')) {
      const standardCron = convertRateToCron(cronExpression);
      if (standardCron) {
        const cronFields = standardCron.split(/\s+/).filter((field) => field.length > 0);
        parsedCron = { cronFields, isOneTime: false };
      }
    } else {
      const cronFields = cronExpression.split(/\s+/).filter((field) => field.length > 0);
      parsedCron = { cronFields, isOneTime: false };
    }

    if (!parsedCron || !parsedCron.cronFields) {
      return [];
    }

    if (!isValidCronFormat(parsedCron.cronFields)) {
      return [];
    }

    if (parsedCron.isOneTime && parsedCron.targetYear) {
      return generateOneTimeEvent(parsedCron.cronFields, parsedCron.targetYear, timezone).filter(
        (date) => date >= startDate && date <= endDate
      );
    }

    const occurrences: Date[] = [];
    let currentDate = new Date(startDate.getTime() - 60000);

    for (let attempts = 0; attempts < maxOccurrences; attempts++) {
      const nextOccurrence = calculateNextOccurrence(parsedCron.cronFields, currentDate, timezone);
      if (!nextOccurrence) break;
      if (nextOccurrence > endDate) break;
      if (nextOccurrence >= startDate) {
        occurrences.push(nextOccurrence);
      }
      currentDate = new Date(nextOccurrence.getTime() + 60000);
    }

    return occurrences;
  } catch (error) {
    console.error('GET_RUN_TIMES_IN_RANGE ERROR:', error);
    return [];
  }
};

/**
 * Generate past occurrences of a cron expression
 */
const generatePastOccurrences = (cronFields: string[], from: Date, timezone: string, count: number): Date[] => {
  const occurrences: Date[] = [];
  let currentDate = new Date(from);

  // Go back in time to find past occurrences
  for (let attempts = 0; attempts < 100000 && occurrences.length < count; attempts++) {
    currentDate.setMinutes(currentDate.getMinutes() - 1);

    const occurrence = calculateNextOccurrence(cronFields, currentDate, timezone);
    if (occurrence && occurrence < from) {
      // Check if this occurrence is not already in our list
      const isDuplicate = occurrences.some(
        (existing) => Math.abs(existing.getTime() - occurrence.getTime()) < 60000 // Within 1 minute
      );

      if (!isDuplicate) {
        occurrences.unshift(occurrence); // Add to beginning to maintain chronological order
      }
    }
  }

  return occurrences;
};

/**
 * Gets the next N run times for a cron expression
 */
export const getNextRunTimes = (cronExpression: string, timezone: string = 'UTC', count: number = 5): Date[] => {
  try {
    let parsedCron: { cronFields: string[]; isOneTime: boolean; targetYear?: number } | null = null;

    if (cronExpression.startsWith('cron(')) {
      parsedCron = parseEventBridgeCron(cronExpression);
    } else if (cronExpression.startsWith('rate(')) {
      const standardCron = convertRateToCron(cronExpression);
      if (standardCron) {
        const cronFields = standardCron.split(/\s+/).filter((field) => field.length > 0);
        parsedCron = { cronFields, isOneTime: false };
      }
    } else {
      const cronFields = cronExpression.split(/\s+/).filter((field) => field.length > 0);
      parsedCron = { cronFields, isOneTime: false };
    }

    if (!parsedCron || !parsedCron.cronFields) {
      return [];
    }

    if (!isValidCronFormat(parsedCron.cronFields)) {
      console.error('Invalid cron format:', parsedCron.cronFields);
      return [];
    }

    // For one-time events, generate only 1 occurrence
    const actualCount = parsedCron.isOneTime ? 1 : count;

    // Generate run times
    let runTimes =
      parsedCron.isOneTime && parsedCron.targetYear
        ? generateOneTimeEvent(parsedCron.cronFields, parsedCron.targetYear, timezone)
        : generateNextOccurrences(parsedCron.cronFields, new Date(), timezone, actualCount);

    // Filter out past one-time events (they won't run again)
    if (parsedCron.isOneTime) {
      const now = new Date();
      runTimes = runTimes.filter((date) => date > now);
    }

    return runTimes;
  } catch (error) {
    console.error('Failed to get next run times:', {
      cronExpression,
      timezone,
      count,
      error,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return [];
  }
};

/**
 * Determines if a schedule is effectively completed (client-side).
 * A schedule is completed if:
 * 1. maxRuns is set and totalRuns >= maxRuns, OR
 * 2. It's a one-off cron expression whose date has passed
 */
export const isScheduleCompleted = (schedule: {
  cronExpression: string;
  timezone: string;
  status: string;
  maxRuns?: number;
  totalRuns?: number;
}): boolean => {
  if (schedule.status !== 'active') return false;

  // Check if max runs have been reached
  if (schedule.maxRuns && schedule.totalRuns && schedule.totalRuns >= schedule.maxRuns) {
    return true;
  }

  // Check if it's a one-off schedule with a past date
  const nextRuns = getNextRunTimes(schedule.cronExpression, schedule.timezone, 1);
  if (nextRuns.length === 0) {
    const parsed = parseEventBridgeCron(schedule.cronExpression);
    if (parsed?.isOneTime) {
      return true;
    }
  }

  return false;
};
