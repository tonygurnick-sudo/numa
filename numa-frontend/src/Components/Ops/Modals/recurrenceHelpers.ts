import type { RecurrenceConfig } from '../../../types/ops';

export const DOW_LABEL_KEYS: { value: number; key: string }[] = [
  { value: 0, key: 'sun' },
  { value: 1, key: 'mon' },
  { value: 2, key: 'tue' },
  { value: 3, key: 'wed' },
  { value: 4, key: 'thu' },
  { value: 5, key: 'fri' },
  { value: 6, key: 'sat' },
];

export const MONTH_NUMBERS = Array.from({ length: 12 }, (_, i) => i + 1);

/**
 * One-line summary used by the picker preview and the ticket-detail "Repeats"
 * row. Lives outside the component file so the bundler's fast-refresh rule
 * can keep treating the modal as a pure component module.
 */
export function summarizeRecurrence(
  config: RecurrenceConfig,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const unitKey =
    config.pattern === 'daily'
      ? 'day'
      : config.pattern === 'weekly'
        ? 'week'
        : config.pattern === 'monthly'
          ? 'month'
          : 'year';
  const intervalPart =
    config.interval > 1
      ? t('recurrence.summary.everyN', { n: config.interval, unit: t(`recurrence.unit.${unitKey}Plural`) })
      : t('recurrence.summary.every', { unit: t(`recurrence.unit.${unitKey}`) });

  let detail = '';
  if (config.pattern === 'weekly' && config.daysOfWeek?.length) {
    const days = [...config.daysOfWeek]
      .sort((a, b) => a - b)
      .map((d) => t(`recurrence.dow.${DOW_LABEL_KEYS.find((l) => l.value === d)!.key}`))
      .join(', ');
    detail = ` ${t('recurrence.summary.onDays', { days })}`;
  } else if (config.pattern === 'monthly' && config.dayOfMonth != null) {
    detail = ` ${t('recurrence.summary.onDayOfMonth', { day: config.dayOfMonth })}`;
  } else if (config.pattern === 'yearly' && config.monthOfYear != null && config.dayOfMonth != null) {
    detail = ` ${t('recurrence.summary.onMonthDay', {
      month: t(`recurrence.month.${config.monthOfYear}`),
      day: config.dayOfMonth,
    })}`;
  }

  const tail: string[] = [t('recurrence.summary.atTime', { time: config.timeOfDay, tz: config.timezone })];
  if (config.endDate) tail.push(t('recurrence.summary.until', { date: config.endDate }));
  if (config.maxOccurrences) tail.push(t('recurrence.summary.forN', { n: config.maxOccurrences }));
  return `${intervalPart}${detail}, ${tail.join(', ')}`;
}
