import { describe, expect, it } from 'vitest';
import {
  buildCronExpression,
  computeNextFireAt,
  localTimeToUtc,
  shouldFireNow,
  summarizeRecurrence,
  ymdInZone,
} from '../ops-recurrence';
import type { RecurrenceConfig } from '../ops-schemas';

const base: Pick<RecurrenceConfig, 'timeOfDay' | 'timezone' | 'startDate'> = {
  timeOfDay: '09:00',
  timezone: 'UTC',
  startDate: '2026-01-01',
};

describe('buildCronExpression', () => {
  it('emits daily cron with `?` in day-of-week', () => {
    expect(buildCronExpression({ ...base, pattern: 'daily', interval: 1 })).toBe('cron(0 9 * * ? *)');
  });

  it('emits weekly cron with 1-indexed days sorted ascending', () => {
    // 0=Sun, 1=Mon, 3=Wed, 5=Fri → AWS 1,2,4,6
    const cron = buildCronExpression({
      ...base,
      pattern: 'weekly',
      interval: 1,
      daysOfWeek: [5, 1, 3, 0],
    });
    expect(cron).toBe('cron(0 9 ? * 1,2,4,6 *)');
  });

  it('emits monthly cron with day-of-month and `?` in day-of-week', () => {
    expect(buildCronExpression({ ...base, pattern: 'monthly', interval: 1, dayOfMonth: 15 })).toBe(
      'cron(0 9 15 * ? *)'
    );
  });

  it('emits yearly cron with day and month', () => {
    expect(buildCronExpression({ ...base, pattern: 'yearly', interval: 1, monthOfYear: 3, dayOfMonth: 14 })).toBe(
      'cron(0 9 14 3 ? *)'
    );
  });

  it('throws if weekly is missing daysOfWeek', () => {
    expect(() => buildCronExpression({ ...base, pattern: 'weekly', interval: 1 })).toThrow();
  });
});

describe('shouldFireNow', () => {
  it('fires on startDate for daily interval=1', () => {
    const cfg: RecurrenceConfig = { ...base, pattern: 'daily', interval: 1 };
    expect(shouldFireNow(cfg, new Date('2026-01-01T09:00:00Z'))).toBe(true);
  });

  it('skips before startDate', () => {
    const cfg: RecurrenceConfig = { ...base, pattern: 'daily', interval: 1, startDate: '2026-02-01' };
    expect(shouldFireNow(cfg, new Date('2026-01-15T09:00:00Z'))).toBe(false);
  });

  it('skips after endDate', () => {
    const cfg: RecurrenceConfig = { ...base, pattern: 'daily', interval: 1, endDate: '2026-01-10' };
    expect(shouldFireNow(cfg, new Date('2026-01-15T09:00:00Z'))).toBe(false);
  });

  it('honours daily interval (every 3 days)', () => {
    const cfg: RecurrenceConfig = { ...base, pattern: 'daily', interval: 3 };
    expect(shouldFireNow(cfg, new Date('2026-01-01T09:00:00Z'))).toBe(true);
    expect(shouldFireNow(cfg, new Date('2026-01-02T09:00:00Z'))).toBe(false);
    expect(shouldFireNow(cfg, new Date('2026-01-04T09:00:00Z'))).toBe(true);
    expect(shouldFireNow(cfg, new Date('2026-01-07T09:00:00Z'))).toBe(true);
  });

  it('honours weekly interval (every 2 weeks)', () => {
    const cfg: RecurrenceConfig = {
      ...base,
      pattern: 'weekly',
      interval: 2,
      daysOfWeek: [1], // Monday
      startDate: '2026-01-05', // Mon
    };
    expect(shouldFireNow(cfg, new Date('2026-01-05T09:00:00Z'))).toBe(true); // start
    expect(shouldFireNow(cfg, new Date('2026-01-12T09:00:00Z'))).toBe(false); // +1 week
    expect(shouldFireNow(cfg, new Date('2026-01-19T09:00:00Z'))).toBe(true); // +2 weeks
  });

  it('honours monthly interval (every 3 months)', () => {
    const cfg: RecurrenceConfig = {
      ...base,
      pattern: 'monthly',
      interval: 3,
      dayOfMonth: 15,
      startDate: '2026-01-15',
    };
    expect(shouldFireNow(cfg, new Date('2026-01-15T09:00:00Z'))).toBe(true);
    expect(shouldFireNow(cfg, new Date('2026-02-15T09:00:00Z'))).toBe(false);
    expect(shouldFireNow(cfg, new Date('2026-04-15T09:00:00Z'))).toBe(true);
  });

  it('respects timezone for startDate boundary', () => {
    // startDate 2026-01-02 in NZ; at UTC midnight 2026-01-02 it's already 13:00 NZ
    const cfg: RecurrenceConfig = {
      pattern: 'daily',
      interval: 1,
      timeOfDay: '09:00',
      timezone: 'Pacific/Auckland',
      startDate: '2026-01-02',
    };
    // UTC 2026-01-01 14:00 = NZ 2026-01-02 03:00 — startDate already started in NZ
    expect(shouldFireNow(cfg, new Date('2026-01-01T14:00:00Z'))).toBe(true);
    // UTC 2026-01-01 10:00 = NZ 2026-01-01 23:00 — startDate hasn't begun in NZ
    expect(shouldFireNow(cfg, new Date('2026-01-01T10:00:00Z'))).toBe(false);
  });
});

describe('computeNextFireAt', () => {
  it('returns startDate occurrence when after = startDate', () => {
    const cfg: RecurrenceConfig = {
      pattern: 'daily',
      interval: 1,
      timeOfDay: '09:00',
      timezone: 'UTC',
      startDate: '2026-01-01',
    };
    const next = computeNextFireAt(cfg, new Date('2026-01-01T00:00:00Z'));
    expect(next?.toISOString()).toBe('2026-01-01T09:00:00.000Z');
  });

  it('rolls to next day if today already past timeOfDay', () => {
    const cfg: RecurrenceConfig = {
      pattern: 'daily',
      interval: 1,
      timeOfDay: '09:00',
      timezone: 'UTC',
      startDate: '2026-01-01',
    };
    const next = computeNextFireAt(cfg, new Date('2026-01-01T10:00:00Z'));
    expect(next?.toISOString()).toBe('2026-01-02T09:00:00.000Z');
  });

  it('skips off-interval days for weekly every-2-weeks', () => {
    const cfg: RecurrenceConfig = {
      pattern: 'weekly',
      interval: 2,
      daysOfWeek: [1], // Monday
      timeOfDay: '09:00',
      timezone: 'UTC',
      startDate: '2026-01-05',
    };
    const next = computeNextFireAt(cfg, new Date('2026-01-06T00:00:00Z'));
    expect(next?.toISOString()).toBe('2026-01-19T09:00:00.000Z');
  });

  it('returns null when past endDate', () => {
    const cfg: RecurrenceConfig = {
      pattern: 'daily',
      interval: 1,
      timeOfDay: '09:00',
      timezone: 'UTC',
      startDate: '2026-01-01',
      endDate: '2026-01-05',
    };
    expect(computeNextFireAt(cfg, new Date('2026-01-10T00:00:00Z'))).toBe(null);
  });

  // Regression: in east-of-UTC zones, UTC noon falls on the *next* calendar
  // day, so the previous noon-UTC anchor inside shouldFireNowYmd shifted the
  // interval check by a day. With a daily interval=2 starting today in NZ,
  // tomorrow is off-interval; the next fire must be the day after.
  it('skips off-interval days for daily every-2-days in Pacific/Auckland', () => {
    const cfg: RecurrenceConfig = {
      pattern: 'daily',
      interval: 2,
      timeOfDay: '17:30',
      timezone: 'Pacific/Auckland',
      startDate: '2026-05-28',
    };
    // After NZ-local 17:30 on the start day, the next valid fire is +2 days
    // (2026-05-30 17:30 NZ), NOT +1 day. 17:30 NZDT/NZST in May = 05:30 UTC.
    const next = computeNextFireAt(cfg, new Date('2026-05-28T08:36:00Z'));
    expect(next?.toISOString()).toBe('2026-05-30T05:30:00.000Z');
  });
});

describe('localTimeToUtc', () => {
  it('handles UTC trivially', () => {
    expect(localTimeToUtc('2026-06-15', '09:00', 'UTC').toISOString()).toBe('2026-06-15T09:00:00.000Z');
  });

  it('handles NZ standard time (+12)', () => {
    // 9am NZ standard time on 2026-06-15 (winter, no DST) = 21:00 prev day UTC
    expect(localTimeToUtc('2026-06-15', '09:00', 'Pacific/Auckland').toISOString()).toBe('2026-06-14T21:00:00.000Z');
  });

  it('handles NZ daylight saving (+13)', () => {
    // 9am NZ daylight saving on 2026-01-15 = 20:00 prev day UTC
    expect(localTimeToUtc('2026-01-15', '09:00', 'Pacific/Auckland').toISOString()).toBe('2026-01-14T20:00:00.000Z');
  });

  it('handles America/New_York', () => {
    // 9am EDT on 2026-06-15 = 13:00 UTC
    expect(localTimeToUtc('2026-06-15', '09:00', 'America/New_York').toISOString()).toBe('2026-06-15T13:00:00.000Z');
    // 9am EST on 2026-01-15 = 14:00 UTC
    expect(localTimeToUtc('2026-01-15', '09:00', 'America/New_York').toISOString()).toBe('2026-01-15T14:00:00.000Z');
  });
});

describe('ymdInZone', () => {
  it('formats local date correctly across UTC midnight', () => {
    // UTC 2026-01-15 23:00 = NZ 2026-01-16 12:00 (NZDT +13)
    expect(ymdInZone(new Date('2026-01-15T23:00:00Z'), 'Pacific/Auckland')).toBe('2026-01-16');
    expect(ymdInZone(new Date('2026-01-15T23:00:00Z'), 'UTC')).toBe('2026-01-15');
  });
});

describe('summarizeRecurrence', () => {
  it('summarizes daily interval=1', () => {
    expect(summarizeRecurrence({ ...base, pattern: 'daily', interval: 1 })).toBe('Every day, at 09:00 (UTC)');
  });

  it('summarizes weekly with multiple days', () => {
    expect(summarizeRecurrence({ ...base, pattern: 'weekly', interval: 1, daysOfWeek: [1, 3, 5] })).toBe(
      'Every week on Mon, Wed, Fri, at 09:00 (UTC)'
    );
  });

  it('summarizes monthly with interval and dayOfMonth', () => {
    expect(summarizeRecurrence({ ...base, pattern: 'monthly', interval: 3, dayOfMonth: 1 })).toBe(
      'Every 3 months on day 1, at 09:00 (UTC)'
    );
  });

  it('appends endDate and occurrence count when set', () => {
    expect(
      summarizeRecurrence({
        ...base,
        pattern: 'daily',
        interval: 1,
        endDate: '2026-12-31',
        maxOccurrences: 10,
      })
    ).toBe('Every day, at 09:00 (UTC), until 2026-12-31, for 10 occurrences');
  });
});
