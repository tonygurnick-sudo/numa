import { useTranslation } from 'react-i18next';
import { Alert } from 'react-bootstrap';
import { CronExpressionBuilder } from '../Agents/CronExpressionBuilder';
import type { FrequencyType, WeekDay, WeekNumber, MonthlyMode } from '../Agents/schedulingTypes';

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

  // Enforce minimum 30-minute interval by wrapping the frequency change
  const handleFrequencyChange = (freq: FrequencyType) => {
    // Block five_minute frequency — redirect to hourly
    if (freq === 'five_minute') {
      props.onFrequencyChange('hourly');
      return;
    }
    props.onFrequencyChange(freq);
  };

  // Enforce minimum 1 hour for hourly interval (since we removed 5-min)
  const handleHourIntervalChange = (value: number) => {
    props.onHourIntervalChange(Math.max(1, value));
  };

  return (
    <div className="workflow-step">
      <h5 className="mb-1">{t('schedule.title')}</h5>
      <p className="text-muted mb-4">{t('schedule.subtitle')}</p>

      <Alert variant="info" className="small mb-3">
        <i className="bi bi-info-circle me-1"></i>
        {t('schedule.minIntervalWarning')}
      </Alert>

      <CronExpressionBuilder
        {...props}
        onFrequencyChange={handleFrequencyChange}
        onHourIntervalChange={handleHourIntervalChange}
      />
    </div>
  );
};

export default WorkflowStepSchedule;
