import type { DateRange } from '@/types/tools'

export class DateUtils {
  /**
   * Parse time period string into DateRange object
   */
  static parseTimePeriod(timePeriod: string): DateRange {
    const now = new Date()

    if (timePeriod === 'current-year') {
      const year = now.getFullYear()
      return {
        startDate: new Date(`${year}-01-01T00:00:00Z`),
        endDate: new Date(`${year + 1}-01-01T00:00:00Z`),
        period: year.toString(),
        displayName: `${year}`,
      }
    }

    if (timePeriod === 'previous-month') {
      const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const year = previousMonth.getFullYear()
      const month = previousMonth.getMonth()
      const startDate = new Date(year, month, 1)
      const endDate = new Date(year, month + 1, 1)

      return {
        startDate,
        endDate,
        period: `${year}-${String(month + 1).padStart(2, '0')}`,
        displayName: `${year}-${String(month + 1).padStart(2, '0')} (Previous Month)`,
      }
    }

    // Check if it's a year (YYYY)
    const yearMatch = timePeriod.match(/^(\d{4})$/)
    if (yearMatch) {
      const year = parseInt(yearMatch[1])
      return {
        startDate: new Date(`${year}-01-01T00:00:00Z`),
        endDate: new Date(`${year + 1}-01-01T00:00:00Z`),
        period: year.toString(),
        displayName: `${year}`,
      }
    }

    // Check if it's a specific month (YYYY-MM)
    const monthMatch = timePeriod.match(/^(\d{4})-(\d{2})$/)
    if (monthMatch) {
      const year = parseInt(monthMatch[1])
      const month = parseInt(monthMatch[2]) - 1 // JavaScript months are 0-based
      const startDate = new Date(year, month, 1)
      const endDate = new Date(year, month + 1, 1)

      return {
        startDate,
        endDate,
        period: timePeriod,
        displayName: timePeriod,
      }
    }

    throw new Error(`Invalid time period: ${timePeriod}. Use 'current-year', 'previous-month', 'YYYY', or 'YYYY-MM'`)
  }

  /**
   * Get available time period options for UI
   */
  static getTimePeriodOptions(): { label: string; value: string }[] {
    const currentYear = new Date().getFullYear()
    const previousYear = currentYear - 1
    const currentMonth = new Date().getMonth() + 1
    const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1
    const previousMonthYear = currentMonth === 1 ? previousYear : currentYear

    return [
      { label: `Current Year (${currentYear})`, value: 'current-year' },
      { label: 'Previous Month', value: 'previous-month' },
      { label: `${currentYear}`, value: currentYear.toString() },
      { label: `${previousYear}`, value: previousYear.toString() },
      {
        label: `${previousMonthYear}-${String(previousMonth).padStart(2, '0')}`,
        value: `${previousMonthYear}-${String(previousMonth).padStart(2, '0')}`
      },
    ]
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
    })
  }

  /**
   * Convert timestamp to NZ date format
   */
  static toNZDateFormat(timestamp: string | Date): string {
    if (!timestamp) {
      return 'Invalid Date'
    }

    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return 'Invalid Date'
    }

    try {
      return date.toLocaleDateString('en-NZ', {
        timeZone: 'Pacific/Auckland',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    } catch (error) {
      console.warn('Date formatting error:', error, 'for timestamp:', timestamp)
      return date.toISOString().split('T')[0] // Fallback to YYYY-MM-DD
    }
  }

  /**
   * Check if date is within range
   */
  static isDateInRange(date: Date, startDate: Date, endDate: Date): boolean {
    return date >= startDate && date < endDate
  }
}
