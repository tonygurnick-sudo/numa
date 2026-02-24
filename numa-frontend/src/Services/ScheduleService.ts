import type {
  AgentSchedule,
  AgentScheduleSnapshot,
  CreateAgentSchedulePayload,
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
  cron_expression: string;
  timezone: string;
  status: 'active' | 'paused' | 'deleted';
  event_type?: 'agent' | 'application' | 'data_sync';
  agent_id: string;
  agent_title?: string;
  label?: string;
  created_at: number;
  updated_at: number;
  last_run_epoch?: number;
  last_status?: string;
  last_error?: string;
  last_run_conversation_id?: string;
  last_run_s3_key?: string;
  run_config?: ScheduledRunConfig;
  agent_snapshot?: AgentScheduleSnapshot;
  max_runs?: number;
  total_runs?: number;
  email_notifications?: boolean;
};

// Transform backend response to frontend format
const transformScheduleResponse = (backendSchedule: BackendScheduleResponse): AgentSchedule => ({
  scheduleId: backendSchedule.schedule_id,
  conversationId: backendSchedule.conversation_id,
  promptText: backendSchedule.prompt_text,
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
  lastRunConversationId: backendSchedule.last_run_conversation_id,
  lastRunS3Key: backendSchedule.last_run_s3_key,
  runConfig: backendSchedule.run_config,
  maxRuns: backendSchedule.max_runs,
  totalRuns: backendSchedule.total_runs,
  emailNotifications: backendSchedule.email_notifications,
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
    eventTypes?: string[],
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

  // POST /api/agent-schedules - Create new schedule
  create: async (numaPost: NumaPost, payload: CreateAgentSchedulePayload): Promise<AgentSchedule> => {
    const response = (await numaPost(BASE_URL, payload)) as BackendScheduleResponse;
    if (!response) {
      throw new Error('Failed to create schedule');
    }
    return transformScheduleResponse(response);
  },

  // PUT /api/agent-schedules/:id - Update schedule
  update: async (numaPut: NumaPut, scheduleId: string, payload: UpdateAgentSchedulePayload): Promise<AgentSchedule> => {
    const response = (await numaPut(`${BASE_URL}/${scheduleId}`, payload)) as BackendScheduleResponse;
    if (!response) {
      throw new Error('Failed to update schedule');
    }
    return transformScheduleResponse(response);
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

  // Helper methods
  getByAgent: async (numaGet: NumaGet, agentId: string): Promise<AgentSchedule[]> => {
    const allSchedules = await ScheduleService.list(numaGet);
    return allSchedules.filter((schedule) => schedule.agentId === agentId && schedule.status !== 'deleted');
  },

  getActiveSchedules: async (numaGet: NumaGet): Promise<AgentSchedule[]> => {
    const allSchedules = await ScheduleService.getCalendarEvents(numaGet);
    return allSchedules.filter((schedule) => schedule.status !== 'deleted');
  },
};
