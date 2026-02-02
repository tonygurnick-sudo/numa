import { describe, it, expect } from 'vitest';
import { describeCronExpression, calculateNextRun, validateCronExpression } from './cronUtils';

describe('describeCronExpression', () => {
  describe('rate expressions', () => {
    it('should describe rate(1 minute)', () => {
      expect(describeCronExpression('rate(1 minute)')).toBe('Every minute');
    });

    it('should describe rate(5 minutes)', () => {
      expect(describeCronExpression('rate(5 minutes)')).toBe('Every 5 minutes');
    });

    it('should describe rate(1 hour)', () => {
      expect(describeCronExpression('rate(1 hour)')).toBe('Every hour');
    });

    it('should describe rate(2 hours)', () => {
      expect(describeCronExpression('rate(2 hours)')).toBe('Every 2 hours');
    });

    it('should describe rate(1 day)', () => {
      expect(describeCronExpression('rate(1 day)')).toBe('Every day');
    });
  });

  describe('every minute patterns', () => {
    it('should describe every minute', () => {
      expect(describeCronExpression('cron(* * * * ? *)')).toBe('Every minute');
    });

    it('should describe every 5 minutes', () => {
      expect(describeCronExpression('cron(*/5 * * * ? *)')).toBe('Every 5 minutes');
    });

    it('should describe every 15 minutes', () => {
      expect(describeCronExpression('cron(*/15 * * * ? *)')).toBe('Every 15 minutes');
    });

    it('should describe every 15 minutes starting at minute 5', () => {
      expect(describeCronExpression('cron(5/15 * * * ? *)')).toBe('Every 15 minutes starting at minute 5');
    });
  });

  describe('hourly patterns', () => {
    it('should describe every hour at minute 0', () => {
      expect(describeCronExpression('cron(0 * * * ? *)')).toBe('Every hour at minute 0');
    });

    it('should describe every hour at minute 30', () => {
      expect(describeCronExpression('cron(30 * * * ? *)')).toBe('Every hour at minute 30');
    });

    it('should describe every 2 hours at minute 0', () => {
      expect(describeCronExpression('cron(0 */2 * * ? *)')).toBe('Every 2 hours at minute 0');
    });

    it('should describe every 4 hours starting at 8:00 AM', () => {
      expect(describeCronExpression('cron(0 8/4 * * ? *)')).toBe('Every 4 hours starting at 8:00 AM');
    });
  });

  describe('daily patterns', () => {
    it('should describe daily at 9:00 AM', () => {
      expect(describeCronExpression('cron(0 9 * * ? *)')).toBe('Daily at 9:00 AM');
    });

    it('should describe daily at 2:30 PM', () => {
      expect(describeCronExpression('cron(30 14 * * ? *)')).toBe('Daily at 2:30 PM');
    });

    it('should describe daily at midnight', () => {
      expect(describeCronExpression('cron(0 0 * * ? *)')).toBe('Daily at 12:00 AM');
    });

    it('should describe daily at noon', () => {
      expect(describeCronExpression('cron(0 12 * * ? *)')).toBe('Daily at 12:00 PM');
    });
  });

  describe('weekday patterns', () => {
    it('should describe weekdays at 9:00 AM (numeric 1-5)', () => {
      expect(describeCronExpression('cron(0 9 ? * 1-5 *)')).toBe('Weekdays at 9:00 AM');
    });

    it('should describe weekdays at 9:00 AM (MON-FRI)', () => {
      expect(describeCronExpression('cron(0 9 ? * MON-FRI *)')).toBe('Weekdays at 9:00 AM');
    });
  });

  describe('weekly patterns', () => {
    it('should describe weekly on Mondays', () => {
      expect(describeCronExpression('cron(0 9 ? * MON *)')).toBe('Weekly on Mondays at 9:00 AM');
    });

    it('should describe weekly on Fridays', () => {
      expect(describeCronExpression('cron(30 17 ? * FRI *)')).toBe('Weekly on Fridays at 5:30 PM');
    });

    it('should describe weekly on multiple days', () => {
      const result = describeCronExpression('cron(0 9 ? * MON,WED,FRI *)');
      expect(result).toContain('Monday');
      expect(result).toContain('Wednesday');
      expect(result).toContain('Friday');
    });

    it('should describe weekly with numeric day (1 = Monday in our system)', () => {
      expect(describeCronExpression('cron(0 9 ? * 1 *)')).toBe('Weekly on Mondays at 9:00 AM');
    });
  });

  describe('nth weekday patterns (weekly with week specifiers)', () => {
    it('should describe first Monday of each month', () => {
      expect(describeCronExpression('cron(0 9 ? * MON#1 *)')).toBe('First Monday of each month at 9:00 AM');
    });

    it('should describe second Tuesday of each month', () => {
      expect(describeCronExpression('cron(0 10 ? * TUE#2 *)')).toBe('Second Tuesday of each month at 10:00 AM');
    });

    it('should describe third Wednesday of each month', () => {
      expect(describeCronExpression('cron(30 14 ? * WED#3 *)')).toBe('Third Wednesday of each month at 2:30 PM');
    });

    it('should describe fourth Thursday of each month', () => {
      expect(describeCronExpression('cron(0 9 ? * THU#4 *)')).toBe('Fourth Thursday of each month at 9:00 AM');
    });

    it('should describe last Friday of each month', () => {
      expect(describeCronExpression('cron(0 17 ? * FRIL *)')).toBe('Last Friday of each month at 5:00 PM');
    });

    it('should describe last Monday of each month (alternative format)', () => {
      expect(describeCronExpression('cron(0 9 ? * MON#L *)')).toBe('Last Monday of each month at 9:00 AM');
    });

    it('should handle multiple nth weekday patterns', () => {
      const result = describeCronExpression('cron(0 9 ? * MON#1,WED#1 *)');
      expect(result).toContain('Monday');
      expect(result).toContain('Wednesday');
      expect(result).toContain('first');
    });
  });

  describe('monthly patterns', () => {
    it('should describe monthly on the 1st', () => {
      expect(describeCronExpression('cron(0 9 1 * ? *)')).toBe('Monthly on the 1st at 9:00 AM');
    });

    it('should describe monthly on the 15th', () => {
      expect(describeCronExpression('cron(0 9 15 * ? *)')).toBe('Monthly on the 15th at 9:00 AM');
    });

    it('should describe monthly on the 22nd', () => {
      expect(describeCronExpression('cron(30 14 22 * ? *)')).toBe('Monthly on the 22nd at 2:30 PM');
    });

    it('should describe monthly on the 31st', () => {
      expect(describeCronExpression('cron(0 9 31 * ? *)')).toBe('Monthly on the 31st at 9:00 AM');
    });
  });

  describe('yearly patterns', () => {
    it('should describe yearly on January 1st', () => {
      expect(describeCronExpression('cron(0 0 1 1 ? *)')).toBe('Yearly on January 1st at 12:00 AM');
    });

    it('should describe yearly on December 25th', () => {
      expect(describeCronExpression('cron(0 9 25 12 ? *)')).toBe('Yearly on December 25th at 9:00 AM');
    });
  });

  describe('one-time events', () => {
    it('should describe a one-time event with specific year', () => {
      expect(describeCronExpression('cron(30 10 5 3 ? 2026)')).toBe('Once on March 5th, 2026 at 10:30 AM');
    });

    it('should describe a one-time event on December 31st', () => {
      expect(describeCronExpression('cron(0 23 31 12 ? 2025)')).toBe('Once on December 31st, 2025 at 11:00 PM');
    });
  });

  describe('ordinal formatting', () => {
    it('should format 1st correctly', () => {
      expect(describeCronExpression('cron(0 9 1 * ? *)')).toContain('1st');
    });

    it('should format 2nd correctly', () => {
      expect(describeCronExpression('cron(0 9 2 * ? *)')).toContain('2nd');
    });

    it('should format 3rd correctly', () => {
      expect(describeCronExpression('cron(0 9 3 * ? *)')).toContain('3rd');
    });

    it('should format 4th correctly', () => {
      expect(describeCronExpression('cron(0 9 4 * ? *)')).toContain('4th');
    });

    it('should format 11th correctly (special case)', () => {
      expect(describeCronExpression('cron(0 9 11 * ? *)')).toContain('11th');
    });

    it('should format 12th correctly (special case)', () => {
      expect(describeCronExpression('cron(0 9 12 * ? *)')).toContain('12th');
    });

    it('should format 13th correctly (special case)', () => {
      expect(describeCronExpression('cron(0 9 13 * ? *)')).toContain('13th');
    });

    it('should format 21st correctly', () => {
      expect(describeCronExpression('cron(0 9 21 * ? *)')).toContain('21st');
    });

    it('should format 22nd correctly', () => {
      expect(describeCronExpression('cron(0 9 22 * ? *)')).toContain('22nd');
    });

    it('should format 23rd correctly', () => {
      expect(describeCronExpression('cron(0 9 23 * ? *)')).toContain('23rd');
    });
  });

  describe('fallback behavior', () => {
    it('should return original expression for invalid input', () => {
      expect(describeCronExpression('invalid')).toBe('invalid');
    });

    it('should return original expression for empty string', () => {
      expect(describeCronExpression('')).toBe('');
    });
  });
});

describe('validateCronExpression', () => {
  it('should validate a correct EventBridge cron expression', () => {
    const result = validateCronExpression('cron(0 9 * * ? *)');
    expect(result.isValid).toBe(true);
  });

  it('should validate a one-time cron expression', () => {
    const result = validateCronExpression('cron(30 10 5 3 ? 2026)');
    expect(result.isValid).toBe(true);
  });

  it('should invalidate an incorrect format', () => {
    const result = validateCronExpression('invalid cron');
    expect(result.isValid).toBe(false);
  });

  it('should validate rate expressions converted to cron', () => {
    const result = validateCronExpression('rate(5 minutes)');
    expect(result.isValid).toBe(true);
  });
});

describe('calculateNextRun', () => {
  it('should return humanReadable string for active schedule', () => {
    const result = calculateNextRun('cron(0 9 * * ? *)', 'UTC', 'active');
    expect(result.humanReadable).toBeTruthy();
    expect(result.isActive).toBe(true);
  });

  it('should return "Paused" for paused schedule', () => {
    const result = calculateNextRun('cron(0 9 * * ? *)', 'UTC', 'paused');
    expect(result.humanReadable).toBe('Paused');
    expect(result.isActive).toBe(false);
  });

  it('should return "Deleted" for deleted schedule', () => {
    const result = calculateNextRun('cron(0 9 * * ? *)', 'UTC', 'deleted');
    expect(result.humanReadable).toBe('Deleted');
    expect(result.isActive).toBe(false);
  });

  it('should calculate next run for a daily schedule', () => {
    const result = calculateNextRun('cron(0 9 * * ? *)', 'UTC', 'active');
    expect(result.nextRun).toBeInstanceOf(Date);
  });

  it('should handle timezone parameter', () => {
    const resultUTC = calculateNextRun('cron(0 9 * * ? *)', 'UTC', 'active');
    const resultNY = calculateNextRun('cron(0 9 * * ? *)', 'America/New_York', 'active');
    // Both should return valid dates (they may differ due to timezone)
    expect(resultUTC.nextRun).toBeInstanceOf(Date);
    expect(resultNY.nextRun).toBeInstanceOf(Date);
  });
});
