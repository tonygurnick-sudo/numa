import { useTranslation } from 'react-i18next';
import { CronExpressionBuilder } from '../Agents/CronExpressionBuilder';
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
};

export const WorkflowStepSchedule = (props: WorkflowStepScheduleProps) => {
  const { t } = useTranslation('automations');
  const { effectiveMin } = useSchedulingMinInterval();

  return (
    <div className="workflow-step">
      <h5 className="mb-1">{t('schedule.title')}</h5>
      <p className="text-muted mb-4">{t('schedule.subtitle')}</p>

      <CronExpressionBuilder {...props} minIntervalMinutes={effectiveMin} />
    </div>
  );
};

export default WorkflowStepSchedule;
