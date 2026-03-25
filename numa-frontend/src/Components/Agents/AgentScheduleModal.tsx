import { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Button, Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { AgentSummary } from '../../types/agents';
import type { AgentSchedule } from '../../types/agentSchedules';
import type { FrequencyType, WeekDay, WeekNumber, MonthlyMode } from './schedulingTypes';
import { CronExpressionBuilder } from './CronExpressionBuilder';
import { getDefaultTimezone, getAllTimezones } from '../../utils/timezoneUtils';
import { parseCronExpression } from '../../utils/schedulingUtils';
import { useSchedulingMinInterval } from '../../hooks/useSchedulingMinInterval';

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
      const interval = Math.max(minuteInterval, Math.round(minuteInterval / 5) * 5);
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
          })
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

export const AgentScheduleModal = ({
  show,
  onHide,
  agent,
  defaultPrompt = '',
  editingSchedule,
  onCreate,
}: ScheduleModalProps) => {
  const { t } = useTranslation('agents');
  const { effectiveMin, loading: minIntervalLoading } = useSchedulingMinInterval();
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
        // Auto-fallback if parsed frequency is no longer valid under current effectiveMin
        let resolvedFrequency = parsed.frequency;
        if (resolvedFrequency === 'five_minute' && effectiveMin >= 60) resolvedFrequency = 'hourly';
        if (resolvedFrequency === 'hourly' && effectiveMin >= 1440) resolvedFrequency = 'daily';
        setFrequency(resolvedFrequency);
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

  // AC8: Auto-fallback when effectiveMin changes and invalidates the current frequency.
  // Intentionally omits `frequency` from deps — user tile clicks must never be overridden.
  // The editing case is handled inline in the initialization effect above.
  useEffect(() => {
    if (minIntervalLoading) return;
    if (frequency === 'five_minute' && effectiveMin >= 60) {
      setFrequency('hourly');
    } else if (frequency === 'hourly' && effectiveMin >= 1440) {
      setFrequency('daily');
    }
  }, [effectiveMin, minIntervalLoading]);

  // Clamp interval states when effectiveMin changes so stale defaults can't be submitted
  useEffect(() => {
    if (minuteInterval < effectiveMin) {
      setMinuteInterval(effectiveMin);
    }
    const hourlyMinHours = Math.ceil(effectiveMin / 60);
    if (hourInterval < hourlyMinHours) {
      setHourInterval(hourlyMinHours);
    }
  }, [effectiveMin, minuteInterval, hourInterval]);

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
    ]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!taskName.trim()) {
      setError(t('scheduling.validation.taskNameRequired'));
      return;
    }
    if (!timezone.trim()) {
      setError(t('scheduling.validation.timezoneRequired'));
      return;
    }

    // Validate custom cron if selected
    if (frequency === 'custom' && !customCron.trim()) {
      setError(t('scheduling.validation.customCronRequired'));
      return;
    }
    if (frequency === 'weekly' && weekDays.length === 0) {
      setError(t('scheduling.validation.weeklyDayRequired'));
      return;
    }

    if (frequency === 'once') {
      const runAt = getZonedTimestamp(startDate, startTime, timezone);
      if (!Number.isFinite(runAt)) {
        setError(t('scheduling.validation.runDateInvalid'));
        return;
      }
      if (runAt <= Date.now() + 60_000) {
        setError(t('scheduling.validation.runDateFuture'));
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
              minIntervalMinutes={effectiveMin}
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
              {getAllTimezones().map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
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
