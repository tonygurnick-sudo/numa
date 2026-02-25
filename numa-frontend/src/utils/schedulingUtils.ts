/**
 * Cron expression parsing utilities for the scheduling UI.
 * Parses AWS EventBridge cron expressions into user-friendly form values.
 */
import type { FrequencyType, WeekDay, WeekNumber, MonthlyMode } from '../Components/Agents/schedulingTypes';

const cronDayToWeekDay: Record<string, WeekDay> = {
  '0': 'sunday',
  '1': 'monday',
  '2': 'tuesday',
  '3': 'wednesday',
  '4': 'thursday',
  '5': 'friday',
  '6': 'saturday',
  SUN: 'sunday',
  MON: 'monday',
  TUE: 'tuesday',
  WED: 'wednesday',
  THU: 'thursday',
  FRI: 'friday',
  SAT: 'saturday',
};

const formatTime = (hour: number, minute: number): string => {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
};

export type ParsedCronExpression = {
  frequency: FrequencyType;
  weekDays: WeekDay[];
  time: string;
  customCron?: string;
  monthlyDay?: number;
  hourInterval?: number;
  minuteInterval?: number;
  onceDate?: string;
  weeklyWeekNumbers?: WeekNumber[];
  monthlyMode?: MonthlyMode;
  monthlyWeekNumber?: WeekNumber;
  monthlyWeekDay?: WeekDay;
  monthlyInterval?: number;
  dailyInterval?: number;
  dailyAnchorDay?: number;
  monthlyAnchorMonth?: number;
};

export const parseCronExpression = (cronExpr: string): ParsedCronExpression => {
  try {
    if (cronExpr.startsWith('cron(') && cronExpr.endsWith(')')) {
      const parts = cronExpr.slice(5, -1).trim().split(/\s+/);
      if (parts.length >= 6) {
        const [minute, hourRaw, dayOfMonth, month, dayOfWeek, year] = parts;
        const baseHour = parseInt(hourRaw.split('/')[0], 10) || 0;
        const timeStr = formatTime(baseHour, parseInt(minute, 10));
        // Once (specific date)
        if (dayOfMonth !== '*' && month !== '*' && dayOfWeek === '?' && year && year !== '*') {
          const monthInt = parseInt(month, 10) || 1;
          const dayInt = parseInt(dayOfMonth, 10) || 1;
          const yearInt = parseInt(year, 10) || new Date().getFullYear();
          const date = new Date(Date.UTC(yearInt, monthInt - 1, dayInt));
          const isoDate = date.toISOString().split('T')[0];
          return { frequency: 'once', weekDays: ['monday'], time: timeStr, onceDate: isoDate };
        }

        // Five-minute pattern
        if (
          (minute.includes('/') || minute.includes('*/')) &&
          hourRaw === '*' &&
          dayOfMonth === '*' &&
          month === '*' &&
          dayOfWeek === '?'
        ) {
          const interval = parseInt(minute.split('/')[1], 10) || 0;
          if (interval >= 5 && interval % 5 === 0) {
            return { frequency: 'five_minute', weekDays: ['monday'], time: timeStr, minuteInterval: interval };
          }
        }

        // Hourly pattern
        if (
          (hourRaw.includes('/') || hourRaw.includes('*/')) &&
          dayOfMonth === '*' &&
          month === '*' &&
          dayOfWeek === '?'
        ) {
          const interval = parseInt(hourRaw.split('/')[1], 10) || 1;
          return { frequency: 'hourly', weekDays: ['monday'], time: timeStr, hourInterval: interval };
        }

        // Daily
        if (month === '*' && dayOfWeek === '?' && (dayOfMonth === '*' || dayOfMonth.includes('/'))) {
          const parts = dayOfMonth.split('/');
          const anchorDay = parts.length > 1 ? parseInt(parts[0], 10) || 1 : undefined;
          const dailyInterval = parts.length > 1 ? parseInt(parts[1], 10) || 1 : 1;
          return { frequency: 'daily', weekDays: ['monday'], time: timeStr, dailyInterval, dailyAnchorDay: anchorDay };
        }

        // Weekdays
        if (dayOfMonth === '?' && month === '*' && dayOfWeek === '1-5') {
          return {
            frequency: 'weekdays',
            weekDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
            time: timeStr,
          };
        }

        const parsedWeekNumbers: WeekNumber[] = [];
        let parsedWeekDays: WeekDay[] = [];
        if (dayOfWeek !== '?' && dayOfWeek !== '*') {
          const tokens = dayOfWeek.split(',');
          const containsNthSpecifier = tokens.some((token) => token.includes('#') || token.endsWith('L'));
          if (containsNthSpecifier && (month !== '*' || month.includes('/'))) {
            // Monthly by day-of-week
            const token = tokens[0];
            let weekNumber: WeekNumber = 1;
            let weekDay: WeekDay = 'monday';
            if (token.endsWith('L')) {
              weekNumber = 'last';
              const dayToken = token.replace('L', '');
              weekDay = cronDayToWeekDay[dayToken] || 'monday';
            } else if (token.includes('#')) {
              const [dayToken, numberToken] = token.split('#');
              weekNumber = (parseInt(numberToken, 10) as WeekNumber) || 1;
              weekDay = cronDayToWeekDay[dayToken] || 'monday';
            }
            const [monthStart, monthStep] = month.includes('/') ? month.split('/') : [month, null];
            const monthlyInterval = monthStep ? parseInt(monthStep, 10) || 1 : 1;
            const anchorMonth = parseInt(monthStart, 10) || 1;
            return {
              frequency: 'monthly',
              weekDays: ['monday'],
              time: timeStr,
              monthlyMode: 'day_of_week',
              monthlyWeekNumber: weekNumber,
              monthlyWeekDay: weekDay,
              monthlyInterval,
              monthlyAnchorMonth: anchorMonth,
            };
          }

          // Weekly (allow multiple days + optional nth selection)
          tokens.forEach((token) => {
            if (token.endsWith('L')) {
              parsedWeekNumbers.push('last');
              const dayToken = token.replace('L', '');
              parsedWeekDays.push(cronDayToWeekDay[dayToken] || 'monday');
            } else if (token.includes('#')) {
              const [dayToken, numberToken] = token.split('#');
              parsedWeekNumbers.push((parseInt(numberToken, 10) as WeekNumber) || 1);
              parsedWeekDays.push(cronDayToWeekDay[dayToken] || 'monday');
            } else {
              parsedWeekDays.push(cronDayToWeekDay[token] || 'monday');
            }
          });
          const uniqueWeekDays = parsedWeekDays.length ? Array.from(new Set(parsedWeekDays)) : ['monday'];
          const weekNumbers = Array.from(new Set(parsedWeekNumbers));
          return {
            frequency: 'weekly',
            weekDays: uniqueWeekDays as WeekDay[],
            time: timeStr,
            weeklyWeekNumbers: weekNumbers,
          };
        }

        // Monthly
        if (dayOfMonth !== '*' && (month === '*' || month.includes('/')) && (dayOfWeek === '?' || dayOfWeek === '*')) {
          const [monthStart, monthStep] = month.includes('/') ? month.split('/') : [month, null];
          const monthlyInterval = monthStep ? parseInt(monthStep, 10) || 1 : 1;
          const anchorMonth = monthStart && monthStart !== '*' ? parseInt(monthStart, 10) || 1 : undefined;
          return {
            frequency: 'monthly',
            weekDays: ['monday'],
            time: timeStr,
            monthlyDay: parseInt(dayOfMonth.replace('?', ''), 10) || 1,
            monthlyInterval,
            monthlyAnchorMonth: anchorMonth,
          };
        }
      }
    }

    return {
      frequency: 'custom',
      weekDays: ['monday'],
      time: '13:00',
      customCron: cronExpr,
    };
  } catch {
    return {
      frequency: 'daily',
      weekDays: ['monday'],
      time: '13:00',
    };
  }
};
