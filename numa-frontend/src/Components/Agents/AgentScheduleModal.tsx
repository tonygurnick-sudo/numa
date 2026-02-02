import { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Button, Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { AgentSummary } from '../../types/agents';
import type { AgentSchedule } from '../../types/agentSchedules';
import type { FrequencyType, WeekDay, WeekNumber, MonthlyMode } from './schedulingTypes';
import { CronExpressionBuilder } from './CronExpressionBuilder';

type ScheduleModalProps = {
  show: boolean;
  onHide: () => void;
  agent: AgentSummary | null;
  defaultPrompt?: string;
  editingSchedule?: AgentSchedule | null;
  onCreate: (payload: {
    promptText: string;
    cronExpression: string;
    timezone: string;
    label?: string;
  }) => Promise<void>;
};

const getDefaultTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

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

const parseTime = (timeStr: string): { hour: number; minute: number } => {
  const [hourStr, minuteStr] = timeStr.split(':');
  return {
    hour: parseInt(hourStr, 10) || 0,
    minute: parseInt(minuteStr, 10) || 0,
  };
};

type CronBuilderConfig = {
  weekDays: WeekDay[];
  time: string;
  startDate: string;
  customCron?: string;
  monthlyDay?: number;
  hourInterval?: number;
  minuteInterval?: number;
  weeklyWeekNumbers?: WeekNumber[];
  monthlyMode?: MonthlyMode;
  monthlyWeekNumber?: WeekNumber;
  monthlyWeekDay?: WeekDay;
  monthlyInterval?: number;
  dailyInterval?: number;
  dailyAnchorDay?: number;
  monthlyAnchorMonth?: number;
};

const buildCronExpression = (frequency: FrequencyType, config: CronBuilderConfig): string => {
  const {
    weekDays,
    time,
    startDate,
    customCron,
    monthlyDay = 1,
    hourInterval = 1,
    minuteInterval = 5,
    weeklyWeekNumbers = [],
    monthlyMode = 'day_of_month',
    monthlyWeekNumber = 1,
    monthlyWeekDay = 'monday',
    monthlyInterval = 1,
    dailyInterval = 1,
    dailyAnchorDay,
    monthlyAnchorMonth,
  } = config;

  if (frequency === 'custom' && customCron) {
    return customCron;
  }

  const { hour, minute } = parseTime(time);
  const startDateObj = new Date(startDate);
  const fallbackDay = Number.isNaN(startDateObj.getDate()) ? 1 : startDateObj.getDate();
  const fallbackMonth = Number.isNaN(startDateObj.getMonth()) ? 0 : startDateObj.getMonth();
  const anchorDay = dailyAnchorDay ?? fallbackDay;
  const anchorMonth = monthlyAnchorMonth ?? fallbackMonth + 1;
  const monthSegment = frequency === 'monthly' && monthlyInterval > 1 ? `${anchorMonth}/${monthlyInterval}` : '*';

  switch (frequency) {
    case 'once': {
      const [yearStr, monthStr, dayStr] = startDate.split('-');
      const year = parseInt(yearStr, 10) || new Date().getFullYear();
      const month = parseInt(monthStr, 10) || new Date().getMonth() + 1;
      const day = parseInt(dayStr, 10) || new Date().getDate();
      return `cron(${minute} ${hour} ${day} ${month} ? ${year})`;
    }
    case 'five_minute': {
      const interval = Math.max(5, Math.round(minuteInterval / 5) * 5);
      return `cron(${minute}/${interval} * * * ? *)`;
    }
    case 'hourly': {
      const interval = Math.max(1, hourInterval);
      return `cron(${minute} ${hour}/${interval} * * ? *)`;
    }
    case 'daily':
      if (dailyInterval > 1) {
        return `cron(${minute} ${hour} ${anchorDay}/${dailyInterval} * ? *)`;
      }
      return `cron(${minute} ${hour} * * ? *)`;
    case 'weekdays':
      return `cron(${minute} ${hour} ? * 1-5 *)`;
    case 'weekly': {
      const selectedDays = weekDays.length ? weekDays : ['monday'];
      if (weeklyWeekNumbers.length > 0) {
        const combos = weeklyWeekNumbers.flatMap((number) =>
          selectedDays.map((day) => {
            const dow = day.slice(0, 3).toUpperCase();
            if (number === 'last') {
              return `${dow}L`;
            }
            return `${dow}#${number}`;
          }),
        );
        const daySegment = combos.join(',');
        return `cron(${minute} ${hour} ? * ${daySegment || 'MON'} *)`;
      }
      const days = selectedDays.map((d) => d.slice(0, 3).toUpperCase());
      const daySegment = days.join(',');
      return `cron(${minute} ${hour} ? * ${daySegment} *)`;
    }
    case 'monthly': {
      if (monthlyMode === 'day_of_week') {
        const dow = monthlyWeekDay.slice(0, 3).toUpperCase();
        const suffix = monthlyWeekNumber === 'last' ? 'L' : `#${monthlyWeekNumber}`;
        return `cron(${minute} ${hour} ? ${monthSegment} ${dow}${suffix} *)`;
      }
      const safeDay = Math.min(31, Math.max(1, monthlyDay));
      return `cron(${minute} ${hour} ${safeDay} ${monthSegment} ? *)`;
    }
    default:
      return `cron(${minute} ${hour} * * ? *)`;
  }
};

type ParsedCronExpression = {
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

const parseCronExpression = (cronExpr: string): ParsedCronExpression => {
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
            weekDays: uniqueWeekDays,
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

export const AgentScheduleModal = ({
  show,
  onHide,
  agent,
  defaultPrompt = '',
  editingSchedule,
  onCreate,
}: ScheduleModalProps) => {
  const { t } = useTranslation('agents');
  // Form state
  const [taskName, setTaskName] = useState('');
  const [jobInstructions, setJobInstructions] = useState(defaultPrompt);
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    // Use local date components instead of UTC-based toISOString()
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [startTime, setStartTime] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  });
  const [frequency, setFrequency] = useState<FrequencyType>('once');
  const [weekDays, setWeekDays] = useState<WeekDay[]>(['monday']);
  const [weeklyWeekNumbers, setWeeklyWeekNumbers] = useState<WeekNumber[]>([]);
  const [monthlyDay, setMonthlyDay] = useState(1);
  const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>('day_of_month');
  const [monthlyWeekNumber, setMonthlyWeekNumber] = useState<WeekNumber>(1);
  const [monthlyWeekDay, setMonthlyWeekDay] = useState<WeekDay>('monday');
  const [monthlyInterval, setMonthlyInterval] = useState(1);
  const [dailyInterval, setDailyInterval] = useState(1);
  const [hourInterval, setHourInterval] = useState(1);
  const [minuteInterval, setMinuteInterval] = useState(5);
  const [dailyAnchorDay, setDailyAnchorDay] = useState(() => new Date().getDate());
  const [monthlyAnchorMonth, setMonthlyAnchorMonth] = useState(() => new Date().getMonth() + 1);
  const [customCron, setCustomCron] = useState('cron(0 13 * * ? *)');
  const [timezone, setTimezone] = useState(getDefaultTimezone());

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Initialize form values when modal opens or editing schedule changes
  useEffect(() => {
    if (show) {
      if (editingSchedule) {
        // Populate form with existing schedule data
        setTaskName(editingSchedule.label || '');
        setJobInstructions(editingSchedule.promptText || '');
        setTimezone(editingSchedule.timezone || getDefaultTimezone());

        // Parse existing cron expression to user-friendly values
        const parsed = parseCronExpression(editingSchedule.cronExpression || 'cron(0 13 * * ? *)');
        setFrequency(parsed.frequency);
        setWeekDays(parsed.weekDays.length ? parsed.weekDays : ['monday']);
        setWeeklyWeekNumbers(parsed.weeklyWeekNumbers ?? []);
        setStartTime(parsed.time);
        if (parsed.onceDate) {
          setStartDate(parsed.onceDate);
        }
        if (parsed.customCron) {
          setCustomCron(parsed.customCron);
        }
        if (parsed.monthlyDay) {
          setMonthlyDay(parsed.monthlyDay);
        }
        if (parsed.monthlyMode) {
          setMonthlyMode(parsed.monthlyMode);
        }
        if (parsed.monthlyWeekNumber) {
          setMonthlyWeekNumber(parsed.monthlyWeekNumber);
        }
        if (parsed.monthlyWeekDay) {
          setMonthlyWeekDay(parsed.monthlyWeekDay);
        }
        if (parsed.monthlyInterval) {
          setMonthlyInterval(parsed.monthlyInterval);
        }
        if (parsed.dailyInterval) {
          setDailyInterval(parsed.dailyInterval);
        }
        if (parsed.dailyAnchorDay) {
          setDailyAnchorDay(parsed.dailyAnchorDay);
        }
        if (parsed.hourInterval) {
          setHourInterval(parsed.hourInterval);
        }
        if (parsed.minuteInterval) {
          setMinuteInterval(parsed.minuteInterval);
        }
        if (parsed.monthlyAnchorMonth) {
          setMonthlyAnchorMonth(parsed.monthlyAnchorMonth);
        }
      } else {
        // Reset form for new schedule
        setTaskName('');
        setJobInstructions(defaultPrompt || '');
        const now = new Date();
        now.setMinutes(now.getMinutes() + 5);
        // Use local date components instead of UTC-based toISOString()
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        setStartDate(`${year}-${month}-${day}`);
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        setStartTime(`${hours}:${minutes}`);
        setFrequency('once');
        const defaultWeekDay = ((): WeekDay => {
          const dayNames: WeekDay[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
          return dayNames[now.getDay()];
        })();
        setWeekDays([defaultWeekDay]);
        setWeeklyWeekNumbers([]);
        setCustomCron('cron(0 13 * * ? *)');
        setMonthlyDay(1);
        setMonthlyMode('day_of_month');
        setMonthlyWeekNumber(1);
        setMonthlyWeekDay(defaultWeekDay);
        setMonthlyInterval(1);
        setDailyInterval(1);
        setHourInterval(1);
        setMinuteInterval(5);
        setDailyAnchorDay(now.getDate());
        setMonthlyAnchorMonth(now.getMonth() + 1);
        setTimezone(getDefaultTimezone());
      }
      setError(null);
      setSubmitting(false);
    }
  }, [show, editingSchedule, defaultPrompt]);

  // Auto-detect weekday from start date
  useEffect(() => {
    if (!startDate || editingSchedule || frequency !== 'weekly') return;
    const date = new Date(startDate);
    if (Number.isNaN(date.getTime())) return;
    const dayNames: WeekDay[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const detectedDay = dayNames[date.getDay()];
    setWeekDays((current) => {
      if (!detectedDay) return current;
      if (current.length === 1 && current[0] === detectedDay) return current;
      return [detectedDay];
    });
  }, [startDate, frequency, editingSchedule]);

  useEffect(() => {
    if (frequency === 'weekly' && weekDays.length === 0) {
      setWeekDays(['monday']);
    }
  }, [frequency, weekDays]);

  const agentTitle = useMemo(() => agent?.title ?? t('scheduling.labels.agentFallback'), [agent, t]);
  const isEditing = Boolean(editingSchedule);
  const modalTitle = isEditing
    ? t('scheduling.modal.title.edit', { agent: agentTitle })
    : t('scheduling.modal.title.create');
  const submitButtonText = isEditing ? t('scheduling.modal.submit.update') : t('scheduling.modal.submit.create');

  // Get timezone display name
  const timezoneDisplay = useMemo(() => {
    try {
      const offset = new Date().toLocaleString('en', { timeZone: timezone, timeZoneName: 'short' }).split(' ').pop();
      return offset ? `${timezone} (${offset})` : timezone;
    } catch {
      return timezone;
    }
  }, [timezone]);
  const handleStartDateChange = (value: string) => {
    setStartDate(value);
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      setDailyAnchorDay(parsed.getDate());
      setMonthlyAnchorMonth(parsed.getMonth() + 1);
    }
  };
  const cronPreview = useMemo(
    () =>
      buildCronExpression(frequency, {
        weekDays,
        time: startTime,
        startDate,
        customCron,
        monthlyDay,
        hourInterval,
        minuteInterval,
        weeklyWeekNumbers,
        monthlyMode,
        monthlyWeekNumber,
        monthlyWeekDay,
        monthlyInterval,
        dailyInterval,
        dailyAnchorDay,
        monthlyAnchorMonth,
      }),
    [
      frequency,
      weekDays,
      startTime,
      startDate,
      customCron,
      monthlyDay,
      hourInterval,
      minuteInterval,
      weeklyWeekNumbers,
      monthlyMode,
      monthlyWeekNumber,
      monthlyWeekDay,
      monthlyInterval,
      dailyInterval,
      dailyAnchorDay,
      monthlyAnchorMonth,
    ],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!taskName.trim()) {
      setError('Task name is required.');
      return;
    }
    if (!timezone.trim()) {
      setError('Timezone is required.');
      return;
    }

    // Validate custom cron if selected
    if (frequency === 'custom' && !customCron.trim()) {
      setError('Custom cron expression is required.');
      return;
    }
    if (frequency === 'weekly' && weekDays.length === 0) {
      setError('Select at least one day for the weekly schedule.');
      return;
    }

    if (frequency === 'once') {
      const runAt = getZonedTimestamp(startDate, startTime, timezone);
      if (!Number.isFinite(runAt)) {
        setError('Run date/time is invalid.');
        return;
      }
      if (runAt <= Date.now() + 60_000) {
        setError('Run date/time must be in the future.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const cronExpression = cronPreview.trim();

      await onCreate({
        promptText: jobInstructions.trim(),
        cronExpression: cronExpression.trim(),
        timezone: timezone.trim(),
        label: taskName.trim() || undefined,
      });
      setSubmitting(false);

      // Reset form only if creating new schedule (not editing)
      if (!isEditing) {
        setTaskName('');
        setJobInstructions(defaultPrompt || '');
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        // Use local date components instead of UTC-based toISOString()
        const year = tomorrow.getFullYear();
        const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
        const day = String(tomorrow.getDate()).padStart(2, '0');
        setStartDate(`${year}-${month}-${day}`);
        setStartTime('13:00');
        setFrequency('once');
        setWeekDays(['monday']);
        setMonthlyDay(1);
        setHourInterval(1);
        setCustomCron('cron(0 13 * * ? *)');
        setTimezone(getDefaultTimezone());
        setDailyAnchorDay(tomorrow.getDate());
        setMonthlyAnchorMonth(tomorrow.getMonth() + 1);
      }

      onHide();
    } catch (err) {
      console.error(`Failed to ${isEditing ? 'update' : 'create'} schedule`, err);
      setError((err as Error)?.message || t(isEditing ? 'scheduling.errors.update' : 'scheduling.errors.create'));
      setSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} size="xl" centered scrollable>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>{modalTitle}</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {error && <Alert variant="danger">{error}</Alert>}

          {/* Task name */}
          <div className="mb-4">
            <Form.Label>{t('scheduling.fields.taskName.label')}</Form.Label>
            <Form.Control
              type="text"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder={t('scheduling.fields.taskName.placeholder')}
              disabled={submitting}
            />
          </div>

          {/* Agent (read-only, showing selected agent) */}
          <div className="mb-4">
            <Form.Label>{t('scheduling.fields.agent.label')}</Form.Label>
            <Form.Control
              type="text"
              value={agent?.title || t('scheduling.fields.agent.placeholder')}
              readOnly
              disabled={submitting}
              style={{ backgroundColor: '#f8f9fa' }}
            />
          </div>

          <div className="mb-4">
            <CronExpressionBuilder
              frequency={frequency}
              onFrequencyChange={setFrequency}
              startDate={startDate}
              onStartDateChange={handleStartDateChange}
              startTime={startTime}
              onStartTimeChange={setStartTime}
              weekDays={weekDays}
              onWeekDaysChange={setWeekDays}
              monthlyDay={monthlyDay}
              onMonthlyDayChange={setMonthlyDay}
              hourInterval={hourInterval}
              onHourIntervalChange={setHourInterval}
              minuteInterval={minuteInterval}
              onMinuteIntervalChange={setMinuteInterval}
              timezoneLabel={timezoneDisplay}
              customCron={customCron}
              onCustomCronChange={setCustomCron}
              submitting={submitting}
              weeklyWeekNumbers={weeklyWeekNumbers}
              onWeeklyWeekNumbersChange={setWeeklyWeekNumbers}
              dailyInterval={dailyInterval}
              onDailyIntervalChange={setDailyInterval}
              monthlyMode={monthlyMode}
              onMonthlyModeChange={setMonthlyMode}
              monthlyWeekNumber={monthlyWeekNumber}
              onMonthlyWeekNumberChange={setMonthlyWeekNumber}
              monthlyWeekDay={monthlyWeekDay}
              onMonthlyWeekDayChange={setMonthlyWeekDay}
              monthlyInterval={monthlyInterval}
              onMonthlyIntervalChange={setMonthlyInterval}
            />
            <div className="visually-hidden">
              <Form.Label htmlFor="cronExpressionHidden">{t('scheduling.fields.cronExpression.label')}</Form.Label>
              <Form.Control id="cronExpressionHidden" type="text" value={cronPreview} readOnly name="cronExpression" />
            </div>
          </div>

          {/* Job instructions */}
          <div className="mb-3">
            <Form.Label>{t('scheduling.fields.instructions.label')}</Form.Label>
            <Form.Control
              as="textarea"
              rows={4}
              value={jobInstructions}
              onChange={(e) => setJobInstructions(e.target.value)}
              placeholder={t('scheduling.fields.instructions.placeholder')}
              disabled={submitting}
            />
            <Form.Text muted>{t('scheduling.fields.instructions.help')}</Form.Text>
          </div>

          {/* Timezone selector */}
          <div className="mb-3">
            <Form.Label>{t('scheduling.fields.timezone.label')}</Form.Label>
            <Form.Select value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={submitting}>
              <option value="UTC">{t('scheduling.timezones.utc')}</option>
              <option value="America/New_York">{t('scheduling.timezones.americaNewYork')}</option>
              <option value="America/Chicago">{t('scheduling.timezones.americaChicago')}</option>
              <option value="America/Denver">{t('scheduling.timezones.americaDenver')}</option>
              <option value="America/Los_Angeles">{t('scheduling.timezones.americaLosAngeles')}</option>
              <option value="Europe/London">{t('scheduling.timezones.europeLondon')}</option>
              <option value="Europe/Paris">{t('scheduling.timezones.europeParis')}</option>
              <option value="Asia/Tokyo">{t('scheduling.timezones.asiaTokyo')}</option>
              <option value="Australia/Sydney">{t('scheduling.timezones.australiaSydney')}</option>
              <option value="Pacific/Auckland">{t('scheduling.timezones.pacificAuckland')}</option>
            </Form.Select>
          </div>
        </Modal.Body>
        <Modal.Footer className="d-flex justify-content-between">
          <Button variant="secondary" onClick={onHide} disabled={submitting}>
            {t('scheduling.actions.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting
              ? isEditing
                ? t('scheduling.modal.submitting.update')
                : t('scheduling.modal.submitting.create')
              : submitButtonText}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

const getZonedTimestamp = (dateStr: string, timeStr: string, timeZone: string): number => {
  try {
    const [year, month, day] = dateStr.split('-').map((v) => parseInt(v, 10));
    const [hour, minute] = timeStr.split(':').map((v) => parseInt(v, 10));
    if (!year || !month || !day) return Number.NaN;
    if (Number.isNaN(hour) || Number.isNaN(minute)) return Number.NaN;
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    const tzDate = new Date(utcDate.toLocaleString('en-US', { timeZone }));
    const offsetMs = utcDate.getTime() - tzDate.getTime();
    return utcDate.getTime() + offsetMs;
  } catch {
    return Number.NaN;
  }
};
