import type {
  AgentSchedule,
  AgentScheduleSnapshot,
  CreateAgentSchedulePayload,
  EventTrigger,
  ScheduledRunConfig,
  UpdateAgentSchedulePayload,
} from '../types/agentSchedules';

type NumaGet = (url: string, params?: Record<string, unknown>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaDelete = (url: string, headers?: Record<string, string>) => Promise<unknown>;

const BASE_URL = '/api/agent-schedules';

// Backend returns snake_case, frontend expects camelCase
type BackendScheduleResponse = {
  user_id: string;
  schedule_id: string;
  tenant_id: string;
  conversation_id: string;
  prompt_text: string;
  trigger_type?: 'cron' | 'event';
  trigger?: EventTrigger;
  cron_expression?: string;
  timezone?: string;
  status: 'active' | 'paused' | 'deleted' | 'pending_approval' | 'admin_locked';
  event_type?: 'agent' | 'application' | 'data_sync';
  agent_id: string;
  agent_title?: string;
  label?: string;
  created_at: number;
  updated_at: number;
  last_run_epoch?: number;
  last_status?: string;
  last_error?: string;
  last_error_typed?: TypedScheduleError;
  last_run_conversation_id?: string;
  last_run_s3_key?: string;
  run_config?: ScheduledRunConfig;
  agent_snapshot?: AgentScheduleSnapshot;
  max_runs?: number;
  total_runs?: number;
  projected_runs_per_month?: number;
  email_notifications?: boolean;
  notification_email?: string;
  notification_emails?: string[];
  approved_by?: string;
  approved_at?: number;
  quota_scope?: 'user' | 'company';
  expires_at?: number;
  admin_locked_by?: string;
  admin_locked_at?: number;
  admin_lock_reason?: string;
};

/** Server-side quota violation surfaced when a create/update is rejected. */
export type ScheduleQuotaViolation = {
  scope: 'company' | 'user' | 'concurrent_user' | 'concurrent_company';
  current: number;
  requested: number;
  limit: number;
  approvable: boolean;
};

/** Typed error written by the runner — see lib/scheduling-schemas.ts:TypedScheduleErrorSchema. */
export type TypedScheduleError = {
  kind:
    | 'integration_not_connected'
    | 'integration_revoked'
    | 'kb_not_accessible'
    | 'agent_archived'
    | 'agent_deleted'
    | 'feature_disabled_company'
    | 'feature_disabled_user'
    | 'quota_exceeded'
    | 'agent_invocation_failed'
    | 'unknown';
  message: string;
  resource?: string;
  remediationPath?: string;
};

/**
 * Advisory info returned alongside an event-trigger create when the tenant /
 * user is already at the trigger budget cap. NOT a save failure — the
 * schedule is created and stays active. Surfaced as a non-blocking banner so
 * the user knows fires won't actually run until next month's reset (past
 * usage from deleted/paused triggers stays counted, so there's no
 * actionable remediation other than asking an admin to raise the cap).
 */
export type TriggerBudgetWarning = {
  scope: 'company' | 'user';
  current: number;
  limit: number;
};

/** Response from `POST /api/agent-schedules` — includes the approval flag. */
export type CreateScheduleResponse = AgentSchedule & {
  /** True when the schedule was created in `pending_approval` status. */
  requiresApproval: boolean;
  /** Populated when requiresApproval is true. */
  quotaViolation?: ScheduleQuotaViolation;
  /**
   * Populated for event-trigger creates when current month's actuals are
   * already at/over cap. Schedule was still created successfully — this is
   * advisory only.
   */
  triggerWarning?: TriggerBudgetWarning;
};

export type QuotaSummary = {
  quotas: {
    minIntervalMinutes: number;
    maxRunsPerCompanyPerMonth: number;
    maxRunsPerUserPerMonth: number;
    maxTriggerRunsPerCompanyPerMonth?: number;
    maxTriggerRunsPerUserPerMonth?: number;
    maxConcurrentActiveSchedulesPerCompany: number;
    maxConcurrentActiveSchedulesPerUser: number;
    requireApprovalAboveUserCap: boolean;
  };
  user: {
    runsPerMonth: number;
    activeScheduleCount: number;
    triggerRunsThisMonth: number;
    activeTriggerCount: number;
    activeAutomationCount: number;
  };
  company: { runsPerMonth: number; activeScheduleCount: number };
};

/** Response from `GET /api/agent-schedules/trigger-load` — admin only. */
export type TriggerLoadSummary = {
  caps: { company: number; user: number };
  warningThresholdPercent: number;
  monthKey: string;
  windowDays: number;
  /** One entry per day in the window, ordered oldest → newest. */
  dailyTotals: Array<{ date: string; total: number }>;
  /** Tenant-wide actual fires so far this month. */
  monthRuns: number;
  /** Linear projection from the N-day window onto the full month. */
  projectedMonthRuns: number;
  /** Per-user breakdown — `{ userId: { monthRuns, projectedMonthRuns } }`. */
  perUser: Record<string, { monthRuns: number; projectedMonthRuns: number }>;
  /** Per-schedule breakdown — `{ scheduleId: { monthRuns, projectedMonthRuns } }`.
   *  Drives per-row columns in the trigger audit panel. May be missing on
   *  older lambda responses; callers should default to `{}` for safety. */
  perSchedule?: Record<string, { monthRuns: number; projectedMonthRuns: number }>;
};

// Transform backend response to frontend format
const transformScheduleResponse = (backendSchedule: BackendScheduleResponse): AgentSchedule => ({
  scheduleId: backendSchedule.schedule_id,
  userId: backendSchedule.user_id,
  conversationId: backendSchedule.conversation_id,
  promptText: backendSchedule.prompt_text,
  triggerType: backendSchedule.trigger_type,
  trigger: backendSchedule.trigger,
  cronExpression: backendSchedule.cron_expression,
  timezone: backendSchedule.timezone,
  status: backendSchedule.status,
  eventType: backendSchedule.event_type ?? 'agent',
  agentId: backendSchedule.agent_id,
  agentTitle: backendSchedule.agent_title,
  label: backendSchedule.label,
  createdAt: backendSchedule.created_at,
  updatedAt: backendSchedule.updated_at,
  lastRunEpoch: backendSchedule.last_run_epoch,
  lastStatus: backendSchedule.last_status,
  lastError: backendSchedule.last_error,
  lastErrorTyped: backendSchedule.last_error_typed,
  lastRunConversationId: backendSchedule.last_run_conversation_id,
  lastRunS3Key: backendSchedule.last_run_s3_key,
  runConfig: backendSchedule.run_config,
  maxRuns: backendSchedule.max_runs,
  totalRuns: backendSchedule.total_runs,
  projectedRunsPerMonth: backendSchedule.projected_runs_per_month,
  emailNotifications: backendSchedule.email_notifications,
  notificationEmail: backendSchedule.notification_email,
  notificationEmails: backendSchedule.notification_emails,
  approvedBy: backendSchedule.approved_by,
  approvedAt: backendSchedule.approved_at,
  quotaScope: backendSchedule.quota_scope,
  expiresAt: backendSchedule.expires_at,
  adminLockedBy: backendSchedule.admin_locked_by,
  adminLockedAt: backendSchedule.admin_locked_at,
  adminLockReason: backendSchedule.admin_lock_reason,
});

type RunScheduleResponse = {
  runId: string;
  conversationId: string;
  assistantMessage?: string;
  runLogS3Key?: string;
  triggeredBySchedule?: boolean;
  status?: 'queued' | 'completed';
};

export const ScheduleService = {
  // GET /api/agent-schedules - List all schedules for user
  list: async (numaGet: NumaGet): Promise<AgentSchedule[]> => {
    const response = (await numaGet(BASE_URL)) as { schedules?: BackendScheduleResponse[] };
    if (response?.schedules) {
      return response.schedules.map(transformScheduleResponse);
    }
    return [];
  },

  // GET /api/agent-schedules/calendar - Get calendar events (same as list but different endpoint)
  getCalendarEvents: async (
    numaGet: NumaGet,
    startDate?: string,
    endDate?: string,
    eventTypes?: string[]
  ): Promise<AgentSchedule[]> => {
    const params: Record<string, unknown> = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    if (eventTypes && eventTypes.length > 0) params.eventTypes = eventTypes.join(',');

    const response = (await numaGet(`${BASE_URL}/calendar`, params)) as { events?: BackendScheduleResponse[] };
    if (response?.events) {
      return response.events.map(transformScheduleResponse);
    }
    return [];
  },

  // GET /api/agent-schedules/:id - Get single schedule
  get: async (numaGet: NumaGet, scheduleId: string): Promise<AgentSchedule> => {
    const response = (await numaGet(`${BASE_URL}/${scheduleId}`)) as BackendScheduleResponse;
    if (!response) {
      throw new Error('Schedule not found');
    }
    return transformScheduleResponse(response);
  },

  // POST /api/agent-schedules - Create new schedule.
  // Returns 201 (active) or 202 (pending_approval) — both yield a CreateScheduleResponse.
  create: async (numaPost: NumaPost, payload: CreateAgentSchedulePayload): Promise<CreateScheduleResponse> => {
    const response = (await numaPost(BASE_URL, payload)) as BackendScheduleResponse & {
      requiresApproval?: boolean;
      quotaViolation?: ScheduleQuotaViolation;
      triggerWarning?: TriggerBudgetWarning;
    };
    if (!response) {
      throw new Error('Failed to create schedule');
    }
    return {
      ...transformScheduleResponse(response),
      requiresApproval: response.requiresApproval ?? response.status === 'pending_approval',
      quotaViolation: response.quotaViolation,
      triggerWarning: response.triggerWarning,
    };
  },

  // PUT /api/agent-schedules/:id - Update schedule. Returns the updated schedule plus optional
  // triggerWarning (set when reactivating an event-trigger while at-budget — advisory only).
  update: async (
    numaPut: NumaPut,
    scheduleId: string,
    payload: UpdateAgentSchedulePayload
  ): Promise<AgentSchedule & { triggerWarning?: TriggerBudgetWarning }> => {
    const response = (await numaPut(`${BASE_URL}/${scheduleId}`, payload)) as BackendScheduleResponse & {
      triggerWarning?: TriggerBudgetWarning;
    };
    if (!response) {
      throw new Error('Failed to update schedule');
    }
    return {
      ...transformScheduleResponse(response),
      triggerWarning: response.triggerWarning,
    };
  },

  // DELETE /api/agent-schedules/:id - Delete schedule
  delete: async (numaDelete: NumaDelete, scheduleId: string): Promise<void> => {
    await numaDelete(`${BASE_URL}/${scheduleId}`);
  },

  // POST /api/agent-schedules/run - Run a schedule immediately
  run: async (numaPost: NumaPost, scheduleId: string): Promise<RunScheduleResponse> => {
    const response = (await numaPost(`${BASE_URL}/run`, { scheduleId })) as RunScheduleResponse;
    if (!response) {
      throw new Error('Failed to run schedule');
    }
    return response;
  },

  // POST /api/agent-schedules/:id/approve - Admin: approve a pending_approval schedule
  approve: async (numaPost: NumaPost, scheduleId: string): Promise<AgentSchedule> => {
    const response = (await numaPost(`${BASE_URL}/${scheduleId}/approve`, {})) as BackendScheduleResponse;
    if (!response) throw new Error('Failed to approve schedule');
    return transformScheduleResponse(response);
  },

  // POST /api/agent-schedules/:id/reject - Admin: reject a pending_approval schedule
  reject: async (numaPost: NumaPost, scheduleId: string): Promise<void> => {
    await numaPost(`${BASE_URL}/${scheduleId}/reject`, {});
  },

  // PUT /api/agent-schedules/:id with admin_locked status — admin lock.
  // Owner cannot reactivate; only an admin can transition out of admin_locked.
  adminLock: async (numaPut: NumaPut, scheduleId: string, reason?: string): Promise<AgentSchedule> => {
    const response = (await numaPut(`${BASE_URL}/${scheduleId}`, {
      status: 'admin_locked',
      ...(reason ? { adminLockReason: reason } : {}),
    })) as BackendScheduleResponse;
    if (!response) throw new Error('Failed to lock schedule');
    return transformScheduleResponse(response);
  },

  // PUT /api/agent-schedules/:id with paused status — admin unlock from admin_locked.
  // Hands control back to the owner (who can then resume to active).
  adminUnlock: async (numaPut: NumaPut, scheduleId: string): Promise<AgentSchedule> => {
    const response = (await numaPut(`${BASE_URL}/${scheduleId}`, { status: 'paused' })) as BackendScheduleResponse;
    if (!response) throw new Error('Failed to unlock schedule');
    return transformScheduleResponse(response);
  },

  // GET /api/agent-schedules/tenant - Admin: list all tenant schedules.
  // Server-side paginated (200/page, cap 500). We follow the cursor
  // transparently here — callers see a single flat array. A safety cap
  // (10 pages = 5,000 schedules) prevents accidental runaway fetches.
  listTenant: async (numaGet: NumaGet): Promise<AgentSchedule[]> => {
    const all: BackendScheduleResponse[] = [];
    let cursor: string | undefined;
    let pages = 0;
    const MAX_PAGES = 10;
    do {
      const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const response = (await numaGet(`${BASE_URL}/tenant${qs}`)) as {
        schedules?: BackendScheduleResponse[];
        nextCursor?: string;
      };
      all.push(...(response?.schedules ?? []));
      cursor = response?.nextCursor;
      pages += 1;
      if (pages >= MAX_PAGES) {
        console.warn(
          '[ScheduleService] listTenant truncated at 10 pages — tenant has more schedules than the audit UI can render in one go'
        );
        break;
      }
    } while (cursor);
    return all.map(transformScheduleResponse);
  },

  // GET /api/agent-schedules/quota-summary - Current user's quota usage + caps
  quotaSummary: async (numaGet: NumaGet): Promise<QuotaSummary> => {
    return (await numaGet(`${BASE_URL}/quota-summary`)) as QuotaSummary;
  },

  // GET /api/agent-schedules/trigger-load - Admin: trigger usage + 30-day chart data.
  triggerLoad: async (numaGet: NumaGet, days = 30): Promise<TriggerLoadSummary> => {
    return (await numaGet(`${BASE_URL}/trigger-load`, { days })) as TriggerLoadSummary;
  },

  // Helper methods
  // Backed by the agent-id-index GSI on the schedules table — server-side
  // filtering, no longer an O(n) fetch-all-then-filter.
  getByAgent: async (numaGet: NumaGet, agentId: string): Promise<AgentSchedule[]> => {
    const response = (await numaGet(BASE_URL, { agentId })) as { schedules?: BackendScheduleResponse[] };
    return (response?.schedules ?? []).map(transformScheduleResponse);
  },

  getActiveSchedules: async (numaGet: NumaGet): Promise<AgentSchedule[]> => {
    const allSchedules = await ScheduleService.getCalendarEvents(numaGet);
    return allSchedules.filter((schedule) => schedule.status !== 'deleted');
  },
};
