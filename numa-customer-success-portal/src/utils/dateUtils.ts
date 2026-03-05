import type { DateRange } from '@/types/tools';

const NZ_TIMEZONE = 'Pacific/Auckland';

export class DateUtils {
  private static getZonedParts(date: Date, timeZone: string) {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = dtf.formatToParts(date);
    const filled: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        filled[part.type] = part.value;
      }
    }
    return filled as { year: string; month: string; day: string; hour: string; minute: string; second: string };
  }

  private static getTimeZoneOffset(timeZone: string, date: Date): number {
    const parts = this.getZonedParts(date, timeZone);
    const asUTC = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    return (asUTC - date.getTime()) / 60000;
  }

  private static getZonedMidnight(timeZone: string, year: number, monthIndex: number, day: number): Date {
    const base = Date.UTC(year, monthIndex, day, 0, 0, 0);
    const offsetMinutes = this.getTimeZoneOffset(timeZone, new Date(base));
    return new Date(base - offsetMinutes * 60000);
  }

  private static parseDateStringToZonedMidnight(dateStr: string, timeZone: string): Date {
    const [yearStr, monthStr, dayStr] = dateStr.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr) - 1;
    const day = Number(dayStr);
    return this.getZonedMidnight(timeZone, year, month, day);
  }

  /**
   * Parse time period string into DateRange object
   */
  static parseTimePeriod(timePeriod: string, customRange?: { startDate?: string; endDate?: string }): DateRange {
    const now = new Date();

    if (timePeriod === 'custom') {
      const startDate = customRange?.startDate
        ? this.parseDateStringToZonedMidnight(customRange.startDate, NZ_TIMEZONE)
        : undefined;
      const endDate = customRange?.endDate
        ? this.parseDateStringToZonedMidnight(customRange.endDate, NZ_TIMEZONE)
        : undefined;

      if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Custom date range requires valid start and end dates (YYYY-MM-DD)');
      }

      if (startDate > endDate) {
        throw new Error('Start date must be before or equal to end date');
      }

      return {
        startDate,
        // Include the full end date by adding one day (NZ)
        endDate: new Date(endDate.getTime() + 24 * 60 * 60 * 1000),
        period: `${customRange.startDate}--${customRange.endDate}`,
        displayName: `${customRange.startDate} to ${customRange.endDate}`,
      };
    }

    if (timePeriod === 'current-year') {
      const year = now.getFullYear();
      return {
        startDate: this.getZonedMidnight(NZ_TIMEZONE, year, 0, 1),
        endDate: this.getZonedMidnight(NZ_TIMEZONE, year + 1, 0, 1),
        period: year.toString(),
        displayName: `${year}`,
      };
    }

    if (timePeriod === 'previous-month') {
      const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const year = previousMonth.getFullYear();
      const month = previousMonth.getMonth();
      const startDate = this.getZonedMidnight(NZ_TIMEZONE, year, month, 1);
      const endDate = this.getZonedMidnight(NZ_TIMEZONE, year, month + 1, 1);

      return {
        startDate,
        endDate,
        period: `${year}-${String(month + 1).padStart(2, '0')}`,
        displayName: `${year}-${String(month + 1).padStart(2, '0')} (Previous Month)`,
      };
    }

    if (timePeriod === 'current-month') {
      const year = now.getFullYear();
      const month = now.getMonth();
      const startDate = this.getZonedMidnight(NZ_TIMEZONE, year, month, 1);
      const endDate = this.getZonedMidnight(NZ_TIMEZONE, year, month + 1, 1);

      return {
        startDate,
        endDate,
        period: `${year}-${String(month + 1).padStart(2, '0')}`,
        displayName: `${year}-${String(month + 1).padStart(2, '0')} (Current Month)`,
      };
    }

    // Check if it's a year (YYYY)
    const yearMatch = timePeriod.match(/^(\d{4})$/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      return {
        startDate: this.getZonedMidnight(NZ_TIMEZONE, year, 0, 1),
        endDate: this.getZonedMidnight(NZ_TIMEZONE, year + 1, 0, 1),
        period: year.toString(),
        displayName: `${year}`,
      };
    }

    // Check if it's a specific month (YYYY-MM)
    const monthMatch = timePeriod.match(/^(\d{4})-(\d{2})$/);
    if (monthMatch) {
      const year = parseInt(monthMatch[1]);
      const month = parseInt(monthMatch[2]) - 1; // JavaScript months are 0-based
      const startDate = this.getZonedMidnight(NZ_TIMEZONE, year, month, 1);
      const endDate = this.getZonedMidnight(NZ_TIMEZONE, year, month + 1, 1);

      return {
        startDate,
        endDate,
        period: timePeriod,
        displayName: timePeriod,
      };
    }

    throw new Error(
      `Invalid time period: ${timePeriod}. Use 'current-month', 'current-year', 'previous-month', 'YYYY', 'YYYY-MM', or 'custom'`
    );
  }

  /**
   * Get available time period options for UI
   */
  static getTimePeriodOptions(): { label: string; value: string }[] {
    const currentYear = new Date().getFullYear();
    const previousYear = currentYear - 1;
    const currentMonth = new Date().getMonth() + 1;
    const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const previousMonthYear = currentMonth === 1 ? previousYear : currentYear;

    return [
      { label: `Current Month (${currentYear}-${String(currentMonth).padStart(2, '0')})`, value: 'current-month' },
      { label: `Current Year (${currentYear})`, value: 'current-year' },
      { label: 'Previous Month', value: 'previous-month' },
      { label: `${currentYear}`, value: currentYear.toString() },
      { label: `${previousYear}`, value: previousYear.toString() },
      {
        label: `${previousMonthYear}-${String(previousMonth).padStart(2, '0')}`,
        value: `${previousMonthYear}-${String(previousMonth).padStart(2, '0')}`,
      },
      { label: 'Custom Range', value: 'custom' },
    ];
  }

  /**
   * Get a period key (month or day) for a given date
   */
  static getPeriodKey(date: Date, granularity: 'month' | 'day' = 'month'): string {
    const parts = this.getZonedParts(date, NZ_TIMEZONE);
    const year = parts.year;
    const month = parts.month;
    const day = parts.day;
    if (granularity === 'day') {
      return `${year}-${month}-${day}`;
    }
    return `${year}-${month}`;
  }

  /**
   * Format date for display
   */
  static formatDate(date: Date): string {
    return date.toLocaleDateString('en-NZ', {
      timeZone: 'Pacific/Auckland',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  /**
   * Convert timestamp to NZ date format
   */
  static toNZDateFormat(timestamp: string | Date): string {
    if (!timestamp) {
      return 'Invalid Date';
    }

    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return 'Invalid Date';
    }

    try {
      return date.toLocaleDateString('en-NZ', {
        timeZone: 'Pacific/Auckland',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch (error) {
      console.warn('Date formatting error:', error, 'for timestamp:', timestamp);
      return date.toISOString().split('T')[0]; // Fallback to YYYY-MM-DD
    }
  }

  /**
   * Check if date is within range
   */
  static isDateInRange(date: Date, startDate: Date, endDate: Date): boolean {
    return date >= startDate && date < endDate;
  }
}
