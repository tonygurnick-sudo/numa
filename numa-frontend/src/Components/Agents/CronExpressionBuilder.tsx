import { useMemo } from 'react';
import { Alert, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { FrequencyType, WeekDay, WeekNumber, MonthlyMode } from './schedulingTypes';

type CronExpressionBuilderProps = {
  frequency: FrequencyType;
  onFrequencyChange: (frequency: FrequencyType) => void;
  startDate: string;
  onStartDateChange: (value: string) => void;
  startTime: string;
  onStartTimeChange: (value: string) => void;
  weekDays: WeekDay[];
  onWeekDaysChange: (days: WeekDay[]) => void;
  monthlyDay: number;
  onMonthlyDayChange: (day: number) => void;
  hourInterval: number;
  onHourIntervalChange: (value: number) => void;
  minuteInterval: number;
  onMinuteIntervalChange: (value: number) => void;
  timezoneLabel: string;
  customCron: string;
  onCustomCronChange: (value: string) => void;
  submitting: boolean;
  weeklyWeekNumbers: WeekNumber[];
  onWeeklyWeekNumbersChange: (numbers: WeekNumber[]) => void;
  dailyInterval: number;
  onDailyIntervalChange: (value: number) => void;
  monthlyMode: MonthlyMode;
  onMonthlyModeChange: (mode: MonthlyMode) => void;
  monthlyWeekNumber: WeekNumber;
  onMonthlyWeekNumberChange: (number: WeekNumber) => void;
  monthlyWeekDay: WeekDay;
  onMonthlyWeekDayChange: (day: WeekDay) => void;
  monthlyInterval: number;
  onMonthlyIntervalChange: (value: number) => void;
  /** Effective minimum scheduling interval in minutes. Defaults to 5 (platform default). */
  minIntervalMinutes?: number;
};

const dayOrder: WeekDay[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/**
 * Lightweight cron interval estimator for frontend validation.
 * KEEP IN SYNC with lib/scheduling-schemas.ts:estimateCronIntervalMinutes()
 * (duplicated because that module depends on zod + Node APIs not available in the browser bundle)
 */
const estimateCronIntervalMinutes = (expression: string): number | null => {
  const match = expression.match(/^cron\((.+)\)$/);
  if (!match) return null;
  const fields = match[1].trim().split(/\s+/);
  if (fields.length !== 6) return null;
  const [minute, hour, dom, month, , year] = fields;
  if (/^\d{4}$/.test(year)) return Infinity;
  const minuteStep = minute.match(/^(?:\d+|\*)\/(\d+)$/);
  if (minuteStep && hour === '*') return parseInt(minuteStep[1], 10);
  // Comma-separated minute list with hour = * (e.g. "0,15,30,45 * * * ? *")
  if (hour === '*' && /^\d+(,\d+)+$/.test(minute)) {
    const values = minute
      .split(',')
      .map((v) => parseInt(v, 10))
      .sort((a, b) => a - b);
    let minGap = 60 - values[values.length - 1] + values[0];
    for (let i = 1; i < values.length; i++) minGap = Math.min(minGap, values[i] - values[i - 1]);
    return minGap;
  }
  const hourStep = hour.match(/^(?:\d+|\*)\/(\d+)$/);
  if (hourStep) return parseInt(hourStep[1], 10) * 60;
  const domStep = dom.match(/^(?:\d+|\*)\/(\d+)$/);
  if (domStep) return parseInt(domStep[1], 10) * 1440;
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && (dom === '*' || dom === '?')) return 1440;
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && /^\d+$/.test(dom)) return 43200;
  const monthStep = month.match(/^(?:\d+|\*)\/(\d+)$/);
  if (monthStep) return parseInt(monthStep[1], 10) * 43200;
  return null;
};

/** Formats a minute-based interval into a human-readable string */
const formatMinIntervalForDisplay = (
  minutes: number,
  t: (key: string, opts?: Record<string, unknown>) => string
): string => {
  if (minutes < 60) return t('scheduling.minInterval.displayMinutes', { count: minutes });
  if (minutes === 60) return t('scheduling.minInterval.displayHour');
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0
      ? t('scheduling.minInterval.displayHoursMinutes', { hours, minutes: remainingMinutes })
      : t('scheduling.minInterval.displayHours', { hours });
  }
  const days = Math.floor(minutes / 1440);
  return days === 1 ? t('scheduling.minInterval.displayDay') : t('scheduling.minInterval.displayDays', { count: days });
};

const formatTimeForDisplay = (time: string) => {
  try {
    const [h, m] = time.split(':');
    const date = new Date();
    date.setHours(parseInt(h ?? '0', 10), parseInt(m ?? '0', 10), 0, 0);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return time;
  }
};

const formatDateForDisplay = (dateStr: string) => {
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
};

export const CronExpressionBuilder = ({
  frequency,
  onFrequencyChange,
  startDate,
  onStartDateChange,
  startTime,
  onStartTimeChange,
  weekDays,
  onWeekDaysChange,
  monthlyDay,
  onMonthlyDayChange,
  hourInterval,
  onHourIntervalChange,
  minuteInterval,
  onMinuteIntervalChange,
  timezoneLabel,
  customCron,
  onCustomCronChange,
  submitting,
  weeklyWeekNumbers,
  onWeeklyWeekNumbersChange,
  dailyInterval,
  onDailyIntervalChange,
  monthlyMode,
  onMonthlyModeChange,
  monthlyWeekNumber,
  onMonthlyWeekNumberChange,
  monthlyWeekDay,
  onMonthlyWeekDayChange,
  monthlyInterval,
  onMonthlyIntervalChange,
  minIntervalMinutes = 5,
}: CronExpressionBuilderProps) => {
  const { t } = useTranslation('agents');
  const effectiveMin = Math.max(minIntervalMinutes, 5);
  const hourlyMinHours = Math.ceil(effectiveMin / 60);
  const frequencyOptions = useMemo(
    () => [
      {
        value: 'once' as const,
        label: t('scheduling.frequency.once.label'),
        description: t('scheduling.frequency.once.description'),
        icon: 'bi-calendar-check',
      },
      {
        value: 'five_minute' as const,
        label: t('scheduling.frequency.fiveMinute.label', { min: effectiveMin }),
        description: t('scheduling.frequency.fiveMinute.description', { min: effectiveMin }),
        icon: 'bi-clock',
      },
      {
        value: 'hourly' as const,
        label: t('scheduling.frequency.hourly.label'),
        description: t('scheduling.frequency.hourly.description'),
        icon: 'bi-clock-history',
      },
      {
        value: 'daily' as const,
        label: t('scheduling.frequency.daily.label'),
        description: t('scheduling.frequency.daily.description'),
        icon: 'bi-sun',
      },
      {
        value: 'weekdays' as const,
        label: t('scheduling.frequency.weekdays.label'),
        description: t('scheduling.frequency.weekdays.description'),
        icon: 'bi-briefcase',
      },
      {
        value: 'weekly' as const,
        label: t('scheduling.frequency.weekly.label'),
        description: t('scheduling.frequency.weekly.description'),
        icon: 'bi-calendar-week',
      },
      {
        value: 'monthly' as const,
        label: t('scheduling.frequency.monthly.label'),
        description: t('scheduling.frequency.monthly.description'),
        icon: 'bi-calendar3',
      },
      {
        value: 'custom' as const,
        label: t('scheduling.frequency.custom.label'),
        description: t('scheduling.frequency.custom.description'),
        icon: 'bi-code-slash',
      },
    ],
    [t, effectiveMin]
  );

  // Filter tiles based on effective minimum interval
  const visibleFrequencyOptions = useMemo(() => {
    return frequencyOptions.filter((opt) => {
      if (opt.value === 'five_minute' && effectiveMin >= 60) return false;
      if (opt.value === 'hourly' && effectiveMin >= 1440) return false;
      return true;
    });
  }, [frequencyOptions, effectiveMin]);

  const dayLabels = useMemo(
    () => ({
      monday: { short: t('scheduling.days.monday.short'), full: t('scheduling.days.monday.full') },
      tuesday: { short: t('scheduling.days.tuesday.short'), full: t('scheduling.days.tuesday.full') },
      wednesday: { short: t('scheduling.days.wednesday.short'), full: t('scheduling.days.wednesday.full') },
      thursday: { short: t('scheduling.days.thursday.short'), full: t('scheduling.days.thursday.full') },
      friday: { short: t('scheduling.days.friday.short'), full: t('scheduling.days.friday.full') },
      saturday: { short: t('scheduling.days.saturday.short'), full: t('scheduling.days.saturday.full') },
      sunday: { short: t('scheduling.days.sunday.short'), full: t('scheduling.days.sunday.full') },
    }),
    [t]
  );
  const weekNumberOptions = useMemo(
    () => [
      { value: 1 as const, label: t('scheduling.weekNumbers.first') },
      { value: 2 as const, label: t('scheduling.weekNumbers.second') },
      { value: 3 as const, label: t('scheduling.weekNumbers.third') },
      { value: 4 as const, label: t('scheduling.weekNumbers.fourth') },
      { value: 5 as const, label: t('scheduling.weekNumbers.fifth') },
      { value: 'last' as const, label: t('scheduling.weekNumbers.last') },
    ],
    [t]
  );
  const timeLabel = useMemo(() => formatTimeForDisplay(startTime), [startTime]);
  const dateLabel = useMemo(() => formatDateForDisplay(startDate), [startDate]);

  const summary = useMemo(() => {
    switch (frequency) {
      case 'once':
        return t('scheduling.summary.once', { date: dateLabel, time: timeLabel });
      case 'five_minute':
        return t('scheduling.summary.fiveMinute', { interval: minuteInterval, time: timeLabel });
      case 'hourly':
        return t('scheduling.summary.hourly', { interval: hourInterval, time: timeLabel });
      case 'daily':
        return dailyInterval > 1
          ? t('scheduling.summary.dailyEvery', { interval: dailyInterval, time: timeLabel })
          : t('scheduling.summary.daily', { time: timeLabel });
      case 'weekdays':
        return t('scheduling.summary.weekdays', { time: timeLabel });
      case 'weekly': {
        if (!weekDays.length) return t('scheduling.summary.weeklySelectPrompt');
        const days = weekDays
          .slice()
          .sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b))
          .map((d) => dayLabels[d].full);
        const weekText =
          weeklyWeekNumbers.length > 0
            ? t('scheduling.summary.weeklyWeekText', {
                weeks: weeklyWeekNumbers
                  .map((w) => weekNumberOptions.find((opt) => opt.value === w)?.label || String(w))
                  .join(', '),
              })
            : '';
        return t('scheduling.summary.weekly', { days: days.join(', '), weekText, time: timeLabel });
      }
      case 'monthly':
        if (monthlyMode === 'day_of_week') {
          const weekLabel =
            weekNumberOptions.find((opt) => opt.value === monthlyWeekNumber)?.label ||
            t('scheduling.weekNumbers.first');
          return t('scheduling.summary.monthlyDayOfWeek', {
            weekLabel,
            weekday: dayLabels[monthlyWeekDay].full,
            interval: monthlyInterval,
            time: timeLabel,
          });
        }
        return t('scheduling.summary.monthlyDayOfMonth', {
          day: monthlyDay,
          interval: monthlyInterval,
          time: timeLabel,
        });
      case 'custom':
        return t('scheduling.summary.custom');
      default:
        return '';
    }
  }, [
    frequency,
    dateLabel,
    timeLabel,
    hourInterval,
    minuteInterval,
    weekDays,
    monthlyDay,
    weeklyWeekNumbers,
    monthlyMode,
    monthlyWeekNumber,
    monthlyWeekDay,
    monthlyInterval,
    dailyInterval,
    dayLabels,
    weekNumberOptions,
    t,
  ]);

  const handleWeekDayToggle = (day: WeekDay) => {
    if (submitting) return;
    const exists = weekDays.includes(day);
    if (exists) {
      onWeekDaysChange(weekDays.filter((d) => d !== day));
    } else {
      const ordered = [...weekDays, day].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
      onWeekDaysChange(ordered);
    }
  };

  const handleWeekNumberToggle = (value: WeekNumber) => {
    if (submitting) return;
    const exists = weeklyWeekNumbers.includes(value);
    if (exists) {
      onWeeklyWeekNumbersChange(weeklyWeekNumbers.filter((v) => v !== value));
    } else {
      onWeeklyWeekNumbersChange([...weeklyWeekNumbers, value]);
    }
  };

  const renderTimeInput = (label = t('scheduling.fields.timeOfDay')) => (
    <div>
      <Form.Label>{label}</Form.Label>
      <Form.Control
        type="time"
        value={startTime}
        onChange={(e) => onStartTimeChange(e.target.value)}
        disabled={submitting}
      />
    </div>
  );

  const renderFrequencyDetails = () => {
    switch (frequency) {
      case 'once':
        return (
          <div className="d-flex flex-column flex-lg-row gap-3">
            <div className="flex-grow-1">
              <Form.Label>{t('scheduling.fields.runDate')}</Form.Label>
              <Form.Control
                type="date"
                value={startDate}
                onChange={(e) => onStartDateChange(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex-grow-1">{renderTimeInput(t('scheduling.fields.runTime'))}</div>
          </div>
        );
      case 'five_minute':
        return (
          <div className="d-flex flex-column gap-3">
            <div>
              <Form.Label>{t('scheduling.fields.every')}</Form.Label>
              <Form.Range
                min={effectiveMin}
                max={60}
                step={5}
                value={Math.max(minuteInterval, effectiveMin)}
                onChange={(e) =>
                  onMinuteIntervalChange(Math.max(effectiveMin, parseInt(e.target.value, 10) || effectiveMin))
                }
                disabled={submitting}
              />
              <div className="d-flex justify-content-between">
                <span className="text-muted small">
                  {t('scheduling.fields.minuteRange.min', { min: effectiveMin })}
                </span>
                <span className="text-muted small">{t('scheduling.fields.minuteRange.max')}</span>
              </div>
              <div className="fw-semibold">
                {t('scheduling.fields.minuteInterval', { interval: Math.max(minuteInterval, effectiveMin) })}
              </div>
            </div>
            {renderTimeInput(t('scheduling.fields.startAt'))}
          </div>
        );
      case 'hourly':
        return (
          <div className="d-flex flex-column gap-3">
            <div>
              <Form.Label>{t('scheduling.fields.every')}</Form.Label>
              <Form.Range
                min={hourlyMinHours}
                max={24}
                value={Math.max(hourInterval, hourlyMinHours)}
                onChange={(e) =>
                  onHourIntervalChange(Math.max(hourlyMinHours, parseInt(e.target.value, 10) || hourlyMinHours))
                }
                disabled={submitting}
              />
              <div className="d-flex justify-content-between">
                <span className="text-muted small">
                  {t('scheduling.fields.hourRange.min', { min: hourlyMinHours })}
                </span>
                <span className="text-muted small">{t('scheduling.fields.hourRange.max')}</span>
              </div>
              <div className="fw-semibold">
                {t('scheduling.fields.hourInterval', { interval: Math.max(hourInterval, hourlyMinHours) })}
              </div>
            </div>
            {renderTimeInput(t('scheduling.fields.startAt'))}
          </div>
        );
      case 'daily':
        return (
          <div className="d-flex flex-column gap-3">
            {renderTimeInput(t('scheduling.fields.timeOfDay'))}
            <div>
              <Form.Label>{t('scheduling.fields.repeatEvery')}</Form.Label>
              <div className="d-flex align-items-center gap-2">
                <Form.Control
                  type="number"
                  min={1}
                  max={60}
                  value={dailyInterval}
                  onChange={(e) => onDailyIntervalChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  disabled={submitting}
                  style={{ width: '120px' }}
                />
                <span>{t('scheduling.fields.daysSuffix')}</span>
              </div>
              <Form.Text muted>{t('scheduling.fields.dailyHelp')}</Form.Text>
            </div>
          </div>
        );
      case 'weekdays':
        return renderTimeInput(t('scheduling.fields.timeOfDay'));
      case 'weekly':
        return (
          <div className="d-flex flex-column gap-3">
            {renderTimeInput(t('scheduling.fields.timeOfDay'))}
            <div>
              <Form.Label>{t('scheduling.fields.selectDays')}</Form.Label>
              <div className="cron-builder__days">
                {dayOrder.map((day) => (
                  <button
                    key={day}
                    type="button"
                    className={`cron-builder__day ${weekDays.includes(day) ? 'active' : ''}`}
                    onClick={() => handleWeekDayToggle(day)}
                    disabled={submitting}
                  >
                    {dayLabels[day].short}
                  </button>
                ))}
              </div>
              <Form.Text muted>{t('scheduling.fields.selectDaysHelp')}</Form.Text>
            </div>
            <div>
              <Form.Label>{t('scheduling.fields.weekOfMonth')}</Form.Label>
              <div className="cron-builder__weeks">
                {weekNumberOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`cron-builder__week ${weeklyWeekNumbers.includes(option.value) ? 'active' : ''}`}
                    onClick={() => handleWeekNumberToggle(option.value)}
                    disabled={submitting}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <Form.Text muted>{t('scheduling.fields.weekOfMonthHelp')}</Form.Text>
            </div>
          </div>
        );
      case 'monthly':
        return (
          <div className="d-flex flex-column gap-3">
            {renderTimeInput(t('scheduling.fields.timeOfDay'))}
            <div className="d-flex flex-column flex-lg-row gap-3">
              <div className="flex-grow-1">
                <Form.Label>{t('scheduling.fields.repeatEvery')}</Form.Label>
                <div className="d-flex align-items-center gap-2">
                  <Form.Control
                    type="number"
                    min={1}
                    max={12}
                    value={monthlyInterval}
                    onChange={(e) => onMonthlyIntervalChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    disabled={submitting}
                    style={{ width: '120px' }}
                  />
                  <span>{t('scheduling.fields.monthsSuffix')}</span>
                </div>
              </div>
              <div className="flex-grow-1">
                <Form.Label>{t('scheduling.fields.scheduleStyle')}</Form.Label>
                <div className="d-flex gap-2 flex-wrap">
                  <button
                    type="button"
                    className={`cron-builder__toggle ${monthlyMode === 'day_of_month' ? 'active' : ''}`}
                    onClick={() => onMonthlyModeChange('day_of_month')}
                    disabled={submitting}
                  >
                    {t('scheduling.fields.scheduleStyleDate')}
                  </button>
                  <button
                    type="button"
                    className={`cron-builder__toggle ${monthlyMode === 'day_of_week' ? 'active' : ''}`}
                    onClick={() => onMonthlyModeChange('day_of_week')}
                    disabled={submitting}
                  >
                    {t('scheduling.fields.scheduleStyleWeekday')}
                  </button>
                </div>
              </div>
            </div>
            {monthlyMode === 'day_of_month' ? (
              <div className="flex-grow-1">
                <Form.Label>{t('scheduling.fields.dayOfMonth')}</Form.Label>
                <Form.Select
                  value={monthlyDay.toString()}
                  onChange={(e) => onMonthlyDayChange(parseInt(e.target.value, 10) || 1)}
                  disabled={submitting}
                >
                  {Array.from({ length: 31 }, (_, idx) => idx + 1).map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </Form.Select>
              </div>
            ) : (
              <div className="d-flex flex-column flex-lg-row gap-3">
                <div className="flex-grow-1">
                  <Form.Label>{t('scheduling.fields.week')}</Form.Label>
                  <Form.Select
                    value={monthlyWeekNumber.toString()}
                    onChange={(e) =>
                      onMonthlyWeekNumberChange(
                        e.target.value === 'last' ? 'last' : (parseInt(e.target.value, 10) as WeekNumber) || 1
                      )
                    }
                    disabled={submitting}
                  >
                    {weekNumberOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Form.Select>
                </div>
                <div className="flex-grow-1">
                  <Form.Label>{t('scheduling.fields.weekday')}</Form.Label>
                  <Form.Select
                    value={monthlyWeekDay}
                    onChange={(e) => onMonthlyWeekDayChange(e.target.value as WeekDay)}
                    disabled={submitting}
                  >
                    {dayOrder.map((day) => (
                      <option key={day} value={day}>
                        {dayLabels[day].full}
                      </option>
                    ))}
                  </Form.Select>
                </div>
              </div>
            )}
          </div>
        );
      case 'custom': {
        const estimated = estimateCronIntervalMinutes(customCron);
        const tooFrequent = estimated !== null && estimated < effectiveMin;
        return (
          <div>
            <Form.Label>{t('scheduling.fields.customCron.label')}</Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              value={customCron}
              onChange={(e) => onCustomCronChange(e.target.value)}
              placeholder={t('scheduling.fields.customCron.placeholder')}
              disabled={submitting}
            />
            <Form.Text muted>{t('scheduling.fields.customCron.help')}</Form.Text>
            {tooFrequent && (
              <Alert variant="warning" className="mt-2 mb-0 py-2">
                {t('scheduling.minInterval.cronTooFrequent', {
                  value: formatMinIntervalForDisplay(effectiveMin, t),
                })}
              </Alert>
            )}
          </div>
        );
      }
      default:
        return renderTimeInput();
    }
  };

  return (
    <div className="cron-builder p-3 rounded-4 border">
      <div className="d-flex flex-column flex-md-row justify-content-between gap-3 mb-3">
        <div>
          <div className="fw-semibold">{t('scheduling.header.title')}</div>
          <div className="text-muted small">{t('scheduling.header.timezone', { timezone: timezoneLabel })}</div>
        </div>
      </div>

      {effectiveMin > 5 && (
        <div className="text-muted small mb-3 d-flex align-items-center">
          <i className="bi bi-info-circle me-2"></i>
          {t('scheduling.minInterval.info', { value: formatMinIntervalForDisplay(effectiveMin, t) })}
        </div>
      )}

      <div className="cron-builder__options mb-4">
        {visibleFrequencyOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`cron-builder__option ${frequency === option.value ? 'active' : ''}`}
            onClick={() => onFrequencyChange(option.value)}
            disabled={submitting}
          >
            <i className={`bi ${option.icon}`}></i>
            <div>
              <div className="fw-semibold">{option.label}</div>
              <div className="text-muted small">{option.description}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="cron-builder__details">{renderFrequencyDetails()}</div>

      <div className="cron-builder__preview mt-4 p-3 rounded-3">
        <div className="text-muted small mb-1">{t('scheduling.summary.label')}</div>
        <div className="cron-builder__summary">{summary}</div>
      </div>
    </div>
  );
};
