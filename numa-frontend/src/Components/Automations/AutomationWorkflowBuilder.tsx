import { useState, useEffect, useMemo, useCallback } from 'react';
import { Button, Alert, Card } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Save } from 'lucide-react';
import { useBranding } from '../../Providers/BrandingContext';
import { WorkflowConnector } from './WorkflowConnector';
import { WorkflowStepTrigger } from './WorkflowStepTrigger';
import { WorkflowStepSchedule } from './WorkflowStepSchedule';
import { WorkflowStepAgent } from './WorkflowStepAgent';
import { WorkflowStepPrompt } from './WorkflowStepPrompt';
import { WorkflowStepReview } from './WorkflowStepReview';
import { getDefaultTimezone } from '../../utils/timezoneUtils';
import { parseCronExpression } from '../../utils/schedulingUtils';
import type { AgentSchedule } from '../../types/agentSchedules';
import type { AgentSummary } from '../../types/agents';
import type { FrequencyType, WeekDay, WeekNumber, MonthlyMode } from '../Agents/schedulingTypes';

type TriggerType = 'schedule' | 'event';

type AutomationWorkflowBuilderProps = {
  agents: AgentSummary[];
  agentsLoading?: boolean;
  editingAutomation?: AgentSchedule | null;
  preselectedAgentId?: string | null;
  onSave: (payload: {
    agentId: string;
    agentTitle: string;
    promptText: string;
    cronExpression: string;
    timezone: string;
    label: string;
    maxRuns: number;
    emailNotifications: boolean;
    agentSnapshot?: {
      agentId: string;
      title: string;
      icon?: string;
      iconImage?: { s3Bucket: string; s3Key: string } | null;
      systemPrompt: string;
    };
  }) => Promise<void>;
  onCancel: () => void;
};

const STEP_COUNT = 5;

const parseTime = (timeStr: string): { hour: number; minute: number } => {
  const [hourStr, minuteStr] = timeStr.split(':');
  return {
    hour: parseInt(hourStr, 10) || 0,
    minute: parseInt(minuteStr, 10) || 0,
  };
};

const buildCronExpression = (
  frequency: FrequencyType,
  config: {
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
  }
): string => {
  const {
    weekDays,
    time,
    startDate,
    customCron,
    monthlyDay = 1,
    hourInterval = 1,
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
      const minuteInterval = config.minuteInterval ?? 5;
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
            if (number === 'last') return `${dow}L`;
            return `${dow}#${number}`;
          })
        );
        return `cron(${minute} ${hour} ? * ${combos.join(',') || 'MON'} *)`;
      }
      const days = selectedDays.map((d) => d.slice(0, 3).toUpperCase());
      return `cron(${minute} ${hour} ? * ${days.join(',')} *)`;
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

export const AutomationWorkflowBuilder = ({
  agents,
  agentsLoading,
  editingAutomation,
  preselectedAgentId,
  onSave,
  onCancel,
}: AutomationWorkflowBuilderProps) => {
  const { t } = useTranslation('automations');
  const isEditing = !!editingAutomation;

  // Step state
  const [currentStep, setCurrentStep] = useState(0);

  // Trigger
  const [triggerType, setTriggerType] = useState<TriggerType>('schedule');

  // Schedule
  const [frequency, setFrequency] = useState<FrequencyType>('daily');
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [startTime, setStartTime] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  });
  const [weekDays, setWeekDays] = useState<WeekDay[]>(['monday']);
  const [weeklyWeekNumbers, setWeeklyWeekNumbers] = useState<WeekNumber[]>([]);
  const [monthlyDay, setMonthlyDay] = useState(1);
  const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>('day_of_month');
  const [monthlyWeekNumber, setMonthlyWeekNumber] = useState<WeekNumber>(1);
  const [monthlyWeekDay, setMonthlyWeekDay] = useState<WeekDay>('monday');
  const [monthlyInterval, setMonthlyInterval] = useState(1);
  const [dailyInterval, setDailyInterval] = useState(1);
  const [hourInterval, setHourInterval] = useState(1);
  const [minuteInterval, setMinuteInterval] = useState(30);
  const [customCron, setCustomCron] = useState('cron(0 13 * * ? *)');
  const [dailyAnchorDay] = useState(() => new Date().getDate());
  const [monthlyAnchorMonth] = useState(() => new Date().getMonth() + 1);

  // Agent
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(preselectedAgentId || null);

  // Details
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [maxRuns, setMaxRuns] = useState(100);
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [timezone, setTimezone] = useState(getDefaultTimezone());

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Initialize from editing automation
  useEffect(() => {
    if (editingAutomation) {
      setName(editingAutomation.label || '');
      setPrompt(editingAutomation.promptText || '');
      setMaxRuns(editingAutomation.maxRuns || 0);
      setEmailNotifications(editingAutomation.emailNotifications || false);
      setTimezone(editingAutomation.timezone || getDefaultTimezone());
      setSelectedAgentId(editingAutomation.agentId);

      // Parse cron
      const parsed = parseCronExpression(editingAutomation.cronExpression || 'cron(0 13 * * ? *)');
      setFrequency(parsed.frequency);
      setWeekDays(parsed.weekDays.length ? parsed.weekDays : ['monday']);
      setWeeklyWeekNumbers(parsed.weeklyWeekNumbers ?? []);
      setStartTime(parsed.time);
      if (parsed.onceDate) setStartDate(parsed.onceDate);
      if (parsed.monthlyDay) setMonthlyDay(parsed.monthlyDay);
      if (parsed.hourInterval) setHourInterval(parsed.hourInterval);
      if (parsed.minuteInterval) setMinuteInterval(parsed.minuteInterval);
      if (parsed.monthlyMode) setMonthlyMode(parsed.monthlyMode);
      if (parsed.monthlyWeekNumber) setMonthlyWeekNumber(parsed.monthlyWeekNumber);
      if (parsed.monthlyWeekDay) setMonthlyWeekDay(parsed.monthlyWeekDay);
      if (parsed.monthlyInterval) setMonthlyInterval(parsed.monthlyInterval);
      if (parsed.dailyInterval) setDailyInterval(parsed.dailyInterval);
      if (parsed.customCron) setCustomCron(parsed.customCron);
    }
  }, [editingAutomation]);

  // Initialize preselected agent
  useEffect(() => {
    if (preselectedAgentId && !editingAutomation) {
      setSelectedAgentId(preselectedAgentId);
    }
  }, [preselectedAgentId, editingAutomation]);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.agentId === selectedAgentId) || null,
    [agents, selectedAgentId]
  );

  const timezoneLabel = useMemo(() => {
    try {
      const now = new Date();
      const offsetMinutes = -now.getTimezoneOffset();
      const sign = offsetMinutes >= 0 ? '+' : '-';
      const h = Math.floor(Math.abs(offsetMinutes) / 60);
      const m = Math.abs(offsetMinutes) % 60;
      return `${timezone} (UTC${sign}${h}${m > 0 ? ':' + String(m).padStart(2, '0') : ''})`;
    } catch {
      return timezone;
    }
  }, [timezone]);

  const cronExpression = useMemo(
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

  const stepLabels = useMemo(
    () => [
      t('builder.steps.trigger'),
      t('builder.steps.schedule'),
      t('builder.steps.agent'),
      t('builder.steps.prompt'),
      t('builder.steps.review'),
    ],
    [t]
  );

  const canProceed = useCallback(
    (step: number): boolean => {
      switch (step) {
        case 0:
          return triggerType === 'schedule';
        case 1:
          return !!cronExpression;
        case 2:
          return !!selectedAgentId;
        case 3:
          return !!name.trim();
        default:
          return true;
      }
    },
    [triggerType, cronExpression, selectedAgentId, name]
  );

  const handleNext = useCallback(() => {
    if (currentStep === 3 && !name.trim()) {
      setNameError(t('errors.nameRequired'));
      return;
    }
    setNameError(null);
    setError(null);
    if (currentStep < STEP_COUNT - 1) {
      setCurrentStep((prev) => prev + 1);
    }
  }, [currentStep, name, t]);

  const handleBack = useCallback(() => {
    setError(null);
    setNameError(null);
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  const handleSave = useCallback(async () => {
    if (!selectedAgentId || !name.trim()) return;
    try {
      setSubmitting(true);
      setError(null);
      await onSave({
        agentId: selectedAgentId,
        agentTitle: selectedAgent?.title || '',
        promptText: prompt,
        cronExpression,
        timezone,
        label: name.trim(),
        maxRuns,
        emailNotifications,
        agentSnapshot: selectedAgent
          ? {
              agentId: selectedAgent.agentId,
              title: selectedAgent.title,
              icon: selectedAgent.icon,
              iconImage: selectedAgent.iconImage,
              systemPrompt: selectedAgent.systemPrompt,
            }
          : undefined,
      });
    } catch (err) {
      setError(isEditing ? t('errors.update') : t('errors.create'));
      console.error('[AutomationWorkflowBuilder] Save failed:', err);
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedAgentId,
    selectedAgent,
    name,
    prompt,
    cronExpression,
    timezone,
    maxRuns,
    emailNotifications,
    onSave,
    isEditing,
    t,
  ]);

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <WorkflowStepTrigger selectedTrigger={triggerType} onSelect={setTriggerType} />;
      case 1:
        return (
          <WorkflowStepSchedule
            frequency={frequency}
            onFrequencyChange={setFrequency}
            startDate={startDate}
            onStartDateChange={setStartDate}
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
            timezoneLabel={timezoneLabel}
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
        );
      case 2:
        return (
          <WorkflowStepAgent
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelect={setSelectedAgentId}
            loading={agentsLoading}
          />
        );
      case 3:
        return (
          <WorkflowStepPrompt
            name={name}
            onNameChange={(v) => {
              setName(v);
              setNameError(null);
            }}
            prompt={prompt}
            onPromptChange={setPrompt}
            maxRuns={maxRuns}
            onMaxRunsChange={setMaxRuns}
            emailNotifications={emailNotifications}
            onEmailNotificationsChange={setEmailNotifications}
            timezone={timezone}
            onTimezoneChange={setTimezone}
            submitting={submitting}
            nameError={nameError || undefined}
          />
        );
      case 4:
        return (
          <WorkflowStepReview
            triggerType={triggerType}
            cronExpression={cronExpression}
            agent={selectedAgent}
            name={name}
            prompt={prompt}
            maxRuns={maxRuns}
            timezone={timezone}
            emailNotifications={emailNotifications}
            onEditStep={setCurrentStep}
          />
        );
      default:
        return null;
    }
  };

  const { branding } = useBranding();
  const brandPrimaryColor = branding.resolvedAssets?.primaryColor || branding.primaryColor || '#6366f1';
  const brandPrimaryContrast = branding.resolvedAssets?.primaryContrast || branding.primaryContrast || '#ffffff';

  return (
    <div className="automation-workflow-builder">
      {/* Step indicator */}
      <div className="workflow-steps-indicator mb-3">
        {stepLabels.map((label, idx) => (
          <WorkflowConnector
            key={idx}
            stepNumber={idx + 1}
            label={label}
            isActive={idx === currentStep}
            isCompleted={idx < currentStep}
            isLast={idx === STEP_COUNT - 1}
          />
        ))}
      </div>

      {/* Error */}
      {error && (
        <Alert variant="danger" className="mb-3" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Step content wrapped in a card with scrollable body */}
      <Card className="border-0 shadow-sm" style={{ borderRadius: 12 }}>
        <Card.Body className="p-4" style={{ maxHeight: 'calc(100vh - 340px)', overflowY: 'auto' }}>
          {renderStep()}
        </Card.Body>
      </Card>

      {/* Navigation */}
      <div className="d-flex justify-content-between align-items-center pt-3">
        <div>
          {currentStep > 0 ? (
            <Button variant="outline-secondary" onClick={handleBack} disabled={submitting}>
              <ArrowLeft size={14} className="me-1" />
              {t('builder.nav.back')}
            </Button>
          ) : (
            <Button variant="outline-secondary" onClick={onCancel} disabled={submitting}>
              {t('builder.nav.cancel')}
            </Button>
          )}
        </div>
        <div>
          {currentStep < STEP_COUNT - 1 ? (
            <Button
              onClick={handleNext}
              disabled={!canProceed(currentStep) || submitting}
              style={{
                backgroundColor: brandPrimaryColor,
                borderColor: brandPrimaryColor,
                color: brandPrimaryContrast,
              }}
            >
              {t('builder.nav.next')}
              <ArrowRight size={14} className="ms-1" />
            </Button>
          ) : (
            <Button
              onClick={handleSave}
              disabled={submitting || !canProceed(3)}
              style={{
                backgroundColor: brandPrimaryColor,
                borderColor: brandPrimaryColor,
                color: brandPrimaryContrast,
              }}
            >
              <Save size={14} className="me-1" />
              {submitting ? t('builder.nav.saving') : t('builder.nav.save')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AutomationWorkflowBuilder;
