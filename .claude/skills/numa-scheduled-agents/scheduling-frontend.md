# Scheduled Agents - Frontend

## Schedule Creation Paths

There are two ways to create a schedule:

### 1. Inline in AgentCreateModal (primary)

**File:** `numa-frontend/src/Components/Agents/AgentCreateModal.tsx`

The agent create/edit modal has a "Scheduling" accordion section. This is the primary path and the only one that correctly builds `runConfig.enabledTools`.

**For new agents:** Schedule is created in `handleSave()` after the agent is saved:

```typescript
await ScheduleService.create(numaPost, {
  agentId: saved.agentId,
  agentTitle: saved.title,
  conversationId: `schedule-${saved.agentId}-${Date.now()}`,
  promptText: schedulePrompt.trim(),
  cronExpression,
  timezone: scheduleTimezone,
  label: scheduleName.trim() || undefined,
  maxRuns: scheduleMaxRuns ? parseInt(scheduleMaxRuns, 10) : undefined,
  emailNotifications: scheduleEmailNotifications,
  runConfig: {
    enabledTools: buildScheduleEnabledTools(),
    enabledConnections: formState.toolsConfig?.enabledConnections,
    enabledKBIds: formState.toolsConfig?.allowedKnowledgeBases?.filter(Boolean),
    autoToolsEnabled: formState.toolsConfig?.autoToolsEnabled,
    webSearchEnabled: formState.toolsConfig?.webSearchEnabled,
    createAgentEnabled: formState.toolsConfig?.createAgentEnabled,
  },
  agentSnapshot: { agentId, title, icon, toolsConfig, visibility },
});
```

**For existing agents:** Inline schedule management in the accordion allows create/edit/pause/delete of schedules via `handleInlineScheduleFormSave()`.

**buildScheduleEnabledTools():**

```typescript
const buildScheduleEnabledTools = (): string[] => {
  const tools: string[] = [];
  const tc = formState.toolsConfig;
  const allowed = tc?.allowedKnowledgeBases;
  const hasKBs = allowed === null || (Array.isArray(allowed) && allowed.length > 0);
  if (hasKBs) tools.push('knowledge_base');
  if (tc?.webSearchEnabled || tc?.autoToolsEnabled) tools.push('web_search');
  if (tc?.createAgentEnabled) tools.push('create_agent_tool');
  tools.push('memories_tool');
  return tools;
};
```

### 2. AgentScheduleModal (standalone)

**File:** `numa-frontend/src/Components/Agents/AgentScheduleModal.tsx`

Used by ScheduleDetailPage for editing schedules. Only updates:

- `promptText` (job instructions)
- `cronExpression` (frequency/time)
- `timezone`
- `label` (task name)

**Does NOT update `runConfig` or `enabledTools`.** This is a known gap - edits here won't fix stale tool config.

## Cron Builder

Both creation paths use a cron builder UI. The `buildCronExpression()` function generates AWS EventBridge format: `cron(minute hour day-of-month month day-of-week year)`.

**Supported frequencies:**
| Type | Example Output |
|------|---------------|
| `once` | `at(2026-03-04T14:00:00)` (one-time schedule) |
| `five_minute` | `rate(5 minutes)` |
| `hourly` | `cron(0 6/1 * * ? *)` (every hour starting at 6) |
| `daily` | `cron(0 14 * * ? *)` |
| `weekdays` | `cron(0 14 ? * MON-FRI *)` |
| `weekly` | `cron(0 14 ? * MON *)` |
| `monthly` | `cron(0 14 15 * ? *)` or `cron(0 14 ? * MON#2 *)` |
| `custom` | User enters raw cron expression |

**Cron parsing for edit:** `schedulingUtils.ts` contains `parseCronExpression()` that reverse-engineers a cron string back into UI state.

**Validation:** `lib/scheduling-schemas.ts` has `validateCronExpression()` which enforces:

- 6 fields (EventBridge format, not standard 5-field)
- Exactly one of day-of-month/day-of-week must be `?`
- Valid ranges for each field

## Pages

### SchedulingPage (`/scheduling`)

**File:** `numa-frontend/src/Pages/SchedulingPage.tsx`

Dashboard listing all schedules. Features:

- Loads via `ScheduleService.getCalendarEvents()`
- Expandable rows showing run history (loaded from S3)
- Actions: Run Now, Pause/Resume, Edit, Delete, View Detail
- Search and filtering
- Gated behind `SCHEDULING` feature flag

### ScheduleDetailPage (`/scheduling/:scheduleId`)

**File:** `numa-frontend/src/Pages/ScheduleDetailPage.tsx`

Detail view for a single schedule. Features:

- Schedule info (agent, frequency, timezone, status)
- Run history table loaded from S3: `numa-chat/scheduled-runs/{userId}/{scheduleId}/*.json`
- Expandable rows per run showing: prompt, assistant response, agent status, errors, artifacts
- Run stats: total, success, partial, failed, success rate %
- Deep link to specific run via `?run=<runId>` query param
- Actions: Run Now, Edit, Pause/Resume, Delete
- Run history loaded with batched S3 fetches (5 concurrent)

## Services

### ScheduleService

**File:** `numa-frontend/src/Services/ScheduleService.ts`

All methods take authenticated `numaGet`/`numaPost`/`numaPut`/`numaDelete` hooks as first arg.

| Method                                             | Endpoint                            | Notes                  |
| -------------------------------------------------- | ----------------------------------- | ---------------------- |
| `list(numaGet)`                                    | `GET /api/agent-schedules`          | All user schedules     |
| `getCalendarEvents(numaGet, start?, end?, types?)` | `GET /api/agent-schedules/calendar` | Filtered by event type |
| `get(numaGet, id)`                                 | `GET /api/agent-schedules/:id`      | Single schedule        |
| `create(numaPost, payload)`                        | `POST /api/agent-schedules`         | Create                 |
| `update(numaPut, id, payload)`                     | `PUT /api/agent-schedules/:id`      | Update                 |
| `delete(numaDelete, id)`                           | `DELETE /api/agent-schedules/:id`   | Soft delete            |
| `run(numaPost, id)`                                | `POST /api/agent-schedules/run`     | Manual trigger         |
| `getByAgent(numaGet, agentId)`                     | Lists all, filters client-side      | O(n), no server filter |

Backend returns snake_case; `transformScheduleResponse()` converts to camelCase.

## Types

**File:** `numa-frontend/src/types/agentSchedules.ts`

Key types:

```typescript
type AgentSchedule = {
  scheduleId: string;
  conversationId: string;
  promptText: string;
  cronExpression: string;
  timezone: string;
  status: 'active' | 'paused' | 'deleted';
  agentId: string;
  agentTitle?: string;
  runConfig?: ScheduledRunConfig;
  agentSnapshot?: AgentScheduleSnapshot;
  label?: string;
  maxRuns?: number;
  totalRuns?: number;
  emailNotifications?: boolean;
  lastStatus?: string;
  lastError?: string;
  lastRunEpoch?: number;
  lastRunConversationId?: string;
  lastRunS3Key?: string;
};

type ScheduledRunConfig = {
  enabledTools?: string[];
  enabledConnections?: string[];
  enabledKBIds?: string[];
  autoToolsEnabled?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
};
```

**File:** `numa-frontend/src/Components/Agents/schedulingTypes.ts`

Cron builder types:

```typescript
type FrequencyType = 'once' | 'five_minute' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';
type WeekDay = 'sunday' | 'monday' | ... | 'saturday';
type WeekNumber = 1 | 2 | 3 | 4 | 5 | 'last';
type MonthlyMode = 'day_of_month' | 'day_of_week';
```

## Feature Flag

Scheduling UI is gated behind:

```typescript
window.sessionStorage.getItem('SCHEDULING') === 'true';
```

Set in `public/config.json` per client.
