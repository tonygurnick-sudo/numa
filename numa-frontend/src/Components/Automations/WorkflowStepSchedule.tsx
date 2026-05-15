import { useTranslation } from 'react-i18next';
import { CronExpressionBuilder } from '../Agents/CronExpressionBuilder';
import { QuotaPreflight } from '../Scheduling/QuotaPreflight';
import type { FrequencyType, WeekDay, WeekNumber, MonthlyMode } from '../Agents/schedulingTypes';
import { useSchedulingMinInterval } from '../../hooks/useSchedulingMinInterval';

type WorkflowStepScheduleProps = {
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
  /** Pre-built cron expression — passed through to the builder for the projected runs/mo badge. */
  cronExpression?: string;
  /** IANA timezone — passed through for the next-5-runs preview (FEAT-105 round-2). */
  timezone?: string;
  /**
   * Per-month run cap from the prompt step. Lets the preflight clamp the
   * projection — a 5-min cron with maxRuns=100 only really projects to 100
   * runs/mo, not ~8,640. 0/undefined = unlimited.
   */
  maxRuns?: number;
  /** Bubbles the preflight verdict up so the wizard can disable Next. */
  onQuotaVerdictChange?: (verdict: 'ok' | 'needs-approval' | 'blocked' | null) => void;
};

export const WorkflowStepSchedule = (props: WorkflowStepScheduleProps) => {
  const { t } = useTranslation('automations');
  const { effectiveMin } = useSchedulingMinInterval();

  return (
    <div className="workflow-step">
      <h5 className="mb-1">{t('schedule.title')}</h5>
      <p className="text-muted mb-4">{t('schedule.subtitle')}</p>

      <CronExpressionBuilder {...props} minIntervalMinutes={effectiveMin} />

      {/* Live quota verdict — recomputes as the user changes frequency / interval. */}
      <div className="mt-3">
        <QuotaPreflight
          triggerType="cron"
          cronExpression={props.cronExpression}
          maxRuns={props.maxRuns}
          onVerdictChange={props.onQuotaVerdictChange}
        />
      </div>
    </div>
  );
};

export default WorkflowStepSchedule;
