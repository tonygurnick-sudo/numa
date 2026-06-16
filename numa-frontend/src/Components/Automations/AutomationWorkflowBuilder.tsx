import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Button, Alert, Card } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Save } from 'lucide-react';
import { useAuth } from '../../Providers/AuthProvider';
import { useBranding } from '../../Providers/BrandingContext';
import { WorkflowConnector } from './WorkflowConnector';
import { WorkflowStepTrigger } from './WorkflowStepTrigger';
import { WorkflowStepSchedule } from './WorkflowStepSchedule';
import { WorkflowStepEventTrigger, type EventSourceSelection } from './WorkflowStepEventTrigger';
import type { EventTrigger, GmailEventTrigger } from '../../types/agentSchedules';
import type { PipedreamTriggerDraft } from '../PipedreamTriggers/PipedreamTriggerConfigurator';
import { PipedreamProxyService } from '../../Services/PipedreamProxyService';
import type { ScheduleQuotaViolation as QuotaViolation } from '../../Services/ScheduleService';
import { WorkflowStepAgent } from './WorkflowStepAgent';
import { WorkflowStepPrompt } from './WorkflowStepPrompt';
import { WorkflowStepReview } from './WorkflowStepReview';
import { getDefaultTimezone } from '../../utils/timezoneUtils';
import { parseCronExpression } from '../../utils/schedulingUtils';
import type { AgentSchedule } from '../../types/agentSchedules';
import type { AgentSummary } from '../../types/agents';
import type { FrequencyType, WeekDay, WeekNumber, MonthlyMode } from '../Agents/schedulingTypes';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { ChatSettingsService, DEFAULT_CHAT_SETTINGS, type ChatSettings } from '../../Services/ChatSettingsService';
import { atRiskCapabilitiesForSchedule } from '../../utils/approvalPosture';
import { ScheduleApprovalWarningModal } from '../Scheduling/ScheduleApprovalWarningModal';

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
    triggerType: 'cron' | 'event';
    trigger?: EventTrigger;
    cronExpression?: string;
    timezone?: string;
    label: string;
    maxRuns?: number;
    emailNotifications: boolean;
    notificationEmails: string[];
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
      return `cron(${minute} ${hour} ? * MON-FRI *)`;
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

/**
 * The creator's email is always a notification recipient — they cannot remove
 * themselves from the list. This guarantees the owner gets failure / quota /
 * approval notices even if they prune the picker.
 */
const ensureCreatorIncluded = (emails: string[], creatorEmail: string | undefined): string[] => {
  if (!creatorEmail) return emails;
  return emails.includes(creatorEmail) ? emails : [creatorEmail, ...emails];
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
  const { user } = useAuth();
  const currentUserEmail = user?.decoded_tokens?.idToken?.email as string | undefined;
  // Derived once — used by the Pipedream pickers to scope status/list calls.
  const externalUserId = useMemo(() => {
    try {
      return PipedreamProxyService.deriveExternalUserId(
        user as Parameters<typeof PipedreamProxyService.deriveExternalUserId>[0]
      );
    } catch {
      return '';
    }
  }, [user]);
  const isEditing = !!editingAutomation;

  // Step state
  const [currentStep, setCurrentStep] = useState(0);

  // Trigger
  const [triggerType, setTriggerType] = useState<TriggerType>('schedule');
  // Sub-state for event triggers: which source the user picked (Gmail or one
  // of the curated Pipedream apps). Null = haven't picked yet (show source picker).
  const [eventSource, setEventSource] = useState<EventSourceSelection | null>(null);
  // Gmail-event state. Independent of pipedreamDraft so users can switch
  // sources without losing in-flight config on either side.
  const [eventTrigger, setEventTrigger] = useState<GmailEventTrigger>({
    source: 'gmail',
    event: 'message.received',
    filters: [],
    filter_logic: 'all',
  });
  // Pipedream-event state.
  const [pipedreamDraft, setPipedreamDraft] = useState<PipedreamTriggerDraft | null>(null);

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
  const [maxRuns, setMaxRuns] = useState(0);
  const [notificationEmails, setNotificationEmails] = useState<string[]>([]);
  const [timezone, setTimezone] = useState(getDefaultTimezone());
  // Latest QuotaPreflight verdict — bubbled up from the schedule + review
  // steps. Used to gate Next / Save when the verdict is `blocked` (cron
  // would push the company over its hard cap, or admin approval is off and
  // the user-cap would be breached).
  const [quotaVerdict, setQuotaVerdict] = useState<'ok' | 'needs-approval' | 'blocked' | null>(null);
  // Number of unresolved preflight blockers (feature-flag, integrations,
  // folder access) bubbled up from the review step. Save is hard-disabled
  // while > 0 so users resolve them before submitting.
  const [preflightBlockerCount, setPreflightBlockerCount] = useState(0);

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Initialize from editing automation
  useEffect(() => {
    if (editingAutomation) {
      if (editingAutomation.triggerType === 'event') {
        setTriggerType('event');
        if (editingAutomation.trigger?.source === 'gmail') {
          setEventSource({ source_id: 'gmail' });
          setEventTrigger(editingAutomation.trigger);
        } else if (editingAutomation.trigger?.source === 'pipedream') {
          setEventSource({
            source_id: editingAutomation.trigger.app_slug,
            pipedream_app_slug: editingAutomation.trigger.app_slug,
          });
          setPipedreamDraft({
            app_slug: editingAutomation.trigger.app_slug,
            component_id: editingAutomation.trigger.component_id,
            configured_props: editingAutomation.trigger.configured_props,
            configured_prop_labels: editingAutomation.trigger.configured_prop_labels,
          });
        }
      }
      setName(editingAutomation.label || '');
      setPrompt(editingAutomation.promptText || '');
      setMaxRuns(editingAutomation.maxRuns ?? 0);
      // emailNotifications has no UI surface in this builder — saves always
      // pass `true` (see handleSave below). The legacy `setEmailNotifications`
      // load that lived here was a rebase-merge artefact; the state pair
      // doesn't exist. Removing this line was the missing half of that
      // refactor — leaving it caused a ReferenceError when editing.
      setNotificationEmails(
        editingAutomation.notificationEmails?.length
          ? editingAutomation.notificationEmails
          : editingAutomation.notificationEmail
            ? [editingAutomation.notificationEmail]
            : currentUserEmail
              ? [currentUserEmail]
              : []
      );
      setTimezone(editingAutomation.timezone || getDefaultTimezone());
      setSelectedAgentId(editingAutomation.agentId);

      // Parse cron (no-op for event triggers)
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

  // Pre-populate notification emails with current user for new automations
  useEffect(() => {
    if (!editingAutomation && currentUserEmail && notificationEmails.length === 0) {
      setNotificationEmails([currentUserEmail]);
    }
  }, [currentUserEmail, editingAutomation]);

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

  // Integration approval-posture warning: warn before creating an automation if
  // the selected agent uses integrations that aren't auto-approved — an
  // unattended (scheduled/triggered) run can't approve them. Acknowledgement is
  // a ref so the re-submit after the user clicks OK isn't blocked by the async
  // state update.
  const { numaGet } = useNumaRequest();
  const [userChatSettings, setUserChatSettings] = useState<ChatSettings | null>(() => ChatSettingsService.getCached());
  const [showApprovalWarning, setShowApprovalWarning] = useState(false);
  const approvalAckRef = useRef(false);

  useEffect(() => {
    if (userChatSettings) return;
    let cancelled = false;
    ChatSettingsService.get(numaGet)
      .then((s) => {
        if (!cancelled) setUserChatSettings(s);
      })
      .catch(() => {
        /* fail open — show no warning rather than a wrong one */
      });
    return () => {
      cancelled = true;
    };
  }, [numaGet, userChatSettings]);

  // Re-arm the warning whenever the chosen agent changes.
  useEffect(() => {
    approvalAckRef.current = false;
  }, [selectedAgentId]);

  const atRiskCapabilities = useMemo(
    () => atRiskCapabilitiesForSchedule(selectedAgent?.toolsConfig, userChatSettings ?? DEFAULT_CHAT_SETTINGS),
    [selectedAgent, userChatSettings]
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
      triggerType === 'event' ? t('builder.steps.event') : t('builder.steps.schedule'),
      t('builder.steps.agent'),
      t('builder.steps.prompt'),
      t('builder.steps.review'),
    ],
    [t, triggerType]
  );

  const canProceed = useCallback(
    (step: number): boolean => {
      switch (step) {
        case 0:
          return triggerType === 'schedule' || triggerType === 'event';
        case 1:
          if (triggerType === 'event') {
            // No source picked yet → block.
            if (!eventSource) return false;
            if (eventSource.source_id === 'gmail') {
              return eventTrigger.filters.length > 0 && eventTrigger.filters.every((f) => f.value.trim().length > 0);
            }
            // Pipedream: a trigger must be picked + configured_props non-empty
            // for the things the registry says are required. We let the
            // backend assert required_props (it has the registry too); here
            // we just ensure the user has selected a trigger and isn't
            // sitting on an empty config form.
            return Boolean(pipedreamDraft?.component_id);
          }
          // Cron schedules: also block on a hard quota verdict (e.g. company
          // cap breach, or admin approval disabled and user cap breached).
          // The lambda would reject at save time anyway — gating Next here
          // forces the user to fix the cadence before they get further into
          // the wizard.
          return !!cronExpression && quotaVerdict !== 'blocked';
        case 2:
          return !!selectedAgentId;
        case 3:
          return !!name.trim();
        case 4:
          // Review step: same gating as the schedule step. `quotaVerdict`
          // here reflects the review-step preflight (which knows about
          // maxRuns), so it can flip from blocked → needs-approval / ok if
          // the user set Max-runs to fit. Also blocks on any unresolved
          // SchedulePreflightStepper blockers (feature flag off, missing
          // integration, folder access).
          return quotaVerdict !== 'blocked' && preflightBlockerCount === 0;
        default:
          return true;
      }
    },
    [
      triggerType,
      cronExpression,
      selectedAgentId,
      name,
      eventTrigger,
      eventSource,
      pipedreamDraft,
      quotaVerdict,
      preflightBlockerCount,
    ]
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
    // Integration approval-posture gate: if the agent uses integrations that
    // aren't auto-approved, warn before creating an unattended automation. The
    // modal's OK sets approvalAckRef and re-runs handleSave.
    if (atRiskCapabilities.length > 0 && !approvalAckRef.current) {
      setShowApprovalWarning(true);
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      // Build the trigger payload from whichever source the user picked.
      // Gmail → existing GmailEventTrigger shape. Pipedream → registry-driven
      // shape with app_slug + component_id + configured_props (deploy_trigger
      // metadata like dc_xxx and signing key are populated server-side).
      let triggerPayload: EventTrigger | undefined;
      if (triggerType === 'event' && eventSource?.source_id === 'gmail') {
        triggerPayload = eventTrigger;
      } else if (triggerType === 'event' && eventSource?.pipedream_app_slug && pipedreamDraft) {
        triggerPayload = {
          source: 'pipedream',
          app_slug: pipedreamDraft.app_slug,
          component_id: pipedreamDraft.component_id,
          configured_props: pipedreamDraft.configured_props,
          configured_prop_labels: pipedreamDraft.configured_prop_labels,
        };
      }
      await onSave({
        agentId: selectedAgentId,
        agentTitle: selectedAgent?.title || '',
        promptText: prompt,
        triggerType: triggerType === 'event' ? 'event' : 'cron',
        trigger: triggerPayload,
        cronExpression: triggerType === 'event' ? undefined : cronExpression,
        timezone: triggerType === 'event' ? undefined : timezone,
        label: name.trim(),
        // 0 in the UI means "unlimited" — backend expects either a positive
        // integer cap or omitted/undefined, so translate 0 → undefined.
        maxRuns: maxRuns > 0 ? maxRuns : undefined,
        emailNotifications: true,
        notificationEmails: ensureCreatorIncluded(notificationEmails, currentUserEmail),
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
      // Prefer the structured error from the lambda response body. The
      // `agent-schedules` create endpoint returns:
      //   { error: "Schedule quota exceeded (user): 350 > 300.",
      //     code: "QUOTA_EXCEEDED",
      //     violation: { scope, current, requested, limit, approvable } }
      // Surface this so the user sees the actual reason instead of the generic
      // "Failed to create automation" axios string.
      const response = (err as { response?: { data?: { error?: string; violation?: QuotaViolation } } })?.response;
      const serverError = response?.data?.error;
      const violation = response?.data?.violation;
      if (violation) {
        const scopeLabel =
          violation.scope === 'company'
            ? 'company runs/month'
            : violation.scope === 'user'
              ? 'user runs/month'
              : violation.scope === 'concurrent_company'
                ? 'concurrent schedules in the company'
                : violation.scope === 'concurrent_user'
                  ? 'concurrent schedules per user'
                  : 'concurrent schedules';
        setError(
          `${serverError ?? 'Quota exceeded.'} (${scopeLabel} cap: ${violation.current} → ${violation.requested}, limit ${violation.limit})`
        );
      } else {
        setError(serverError || (isEditing ? t('errors.update') : t('errors.create')));
      }
      console.error('[AutomationWorkflowBuilder] Save failed:', err);
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedAgentId,
    selectedAgent,
    name,
    prompt,
    triggerType,
    eventSource,
    eventTrigger,
    pipedreamDraft,
    cronExpression,
    timezone,
    maxRuns,
    notificationEmails,
    onSave,
    isEditing,
    t,
    atRiskCapabilities,
  ]);

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <WorkflowStepTrigger selectedTrigger={triggerType} onSelect={setTriggerType} />;
      case 1:
        if (triggerType === 'event') {
          return (
            <WorkflowStepEventTrigger
              source={eventSource}
              onSourceChange={setEventSource}
              externalUserId={externalUserId}
              gmailTrigger={eventTrigger}
              onGmailTriggerChange={setEventTrigger}
              pipedreamDraft={pipedreamDraft}
              onPipedreamDraftChange={setPipedreamDraft}
            />
          );
        }
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
            cronExpression={cronExpression}
            timezone={timezone}
            maxRuns={maxRuns}
            onQuotaVerdictChange={setQuotaVerdict}
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
            notificationEmails={notificationEmails}
            onNotificationEmailsChange={setNotificationEmails}
            currentUserEmail={currentUserEmail}
            timezone={timezone}
            onTimezoneChange={setTimezone}
            submitting={submitting}
            nameError={nameError || undefined}
            cronExpression={triggerType === 'event' ? undefined : cronExpression}
          />
        );
      case 4:
        return (
          <WorkflowStepReview
            triggerType={triggerType}
            cronExpression={cronExpression}
            eventTrigger={triggerType === 'event' && eventSource?.source_id === 'gmail' ? eventTrigger : undefined}
            pipedreamDraft={triggerType === 'event' && eventSource?.pipedream_app_slug ? pipedreamDraft : null}
            agent={selectedAgent}
            name={name}
            prompt={prompt}
            maxRuns={maxRuns}
            timezone={timezone}
            onEditStep={setCurrentStep}
            onQuotaVerdictChange={setQuotaVerdict}
            onPreflightBlockerCountChange={setPreflightBlockerCount}
          />
        );
      default:
        return null;
    }
  };

  const { branding } = useBranding();
  // Use BrandingTheme's typed colors object — `branding.primaryColor` and
  // `branding.resolvedAssets?.primaryColor` aren't on the type and resolve
  // to undefined at runtime.
  const brandPrimaryColor = branding.colors?.primary || '#6366f1';
  const brandPrimaryContrast = branding.colors?.buttonPrimaryText || '#ffffff';

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
        <Card.Body className="p-4">{renderStep()}</Card.Body>
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
              disabled={submitting || !canProceed(3) || !canProceed(4)}
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
      <ScheduleApprovalWarningModal
        show={showApprovalWarning}
        capabilities={atRiskCapabilities}
        onCancel={() => setShowApprovalWarning(false)}
        onConfirm={() => {
          approvalAckRef.current = true;
          setShowApprovalWarning(false);
          void handleSave();
        }}
      />
    </div>
  );
};

export default AutomationWorkflowBuilder;
