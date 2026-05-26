---
name: numa-scheduled-agents
description: Debug and develop Numa scheduled agents (recurring automated agent runs). Use when working with agent scheduling, schedule runner, EventBridge schedules, scheduled run failures, enabledTools, runConfig, schedule CRUD, cron expressions, or the SCHEDULED_RUN_PREAMBLE.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Numa Scheduled Agents

Scheduled agents let users configure recurring (or one-time) automated runs of their AI agents. A schedule defines which agent to run, a prompt, a cron expression, and a timezone. At the scheduled time, EventBridge triggers a Lambda that invokes the workspace agent in sync mode, stores results in S3, and sends notifications.

## Quick Reference

### End-to-End Flow

```
User creates schedule (AgentCreateModal or AgentScheduleModal)
    |
ScheduleService.create() -> POST /api/agent-schedules
    |
agent-schedules Lambda: writes DynamoDB + creates EventBridge rule
    |
EventBridge fires at cron time -> invokes agent-schedule-runner Lambda
    |
Runner: fetches schedule from DynamoDB
    |
Runner: refreshes agent snapshot from DynamoDB (latest config, not frozen)
    |
Runner: mergeRunConfig() -> buildEnabledTools() -> resolves KBs
    |
Runner: POST /api/workspace-chat-agent/invocations (sync mode)
    | (auth: Bearer SCHEDULE_RUNNER_SECRET + x-schedule-runner-sub header)
    |
Workspace agent proxy -> AgentCore MicroVM executes agent
    |
Agent writes /workdir/outputs/status.json -> synced to S3
    |
Runner: reads status.json, writes run log to S3, sends notifications
    |
User views results on ScheduleDetailPage or NotificationsPage
```

### Key Files

| Component                      | Location                                                         | Purpose                                  |
| ------------------------------ | ---------------------------------------------------------------- | ---------------------------------------- |
| **AgentCreateModal**           | `numa-frontend/src/Components/Agents/AgentCreateModal.tsx`       | Schedule creation inline with agent edit |
| **AgentScheduleModal**         | `numa-frontend/src/Components/Agents/AgentScheduleModal.tsx`     | Standalone schedule create/edit modal    |
| **ScheduleDetailPage**         | `numa-frontend/src/Pages/ScheduleDetailPage.tsx`                 | Schedule detail + run history            |
| **SchedulingPage**             | `numa-frontend/src/Pages/SchedulingPage.tsx`                     | Schedule dashboard listing               |
| **ScheduleService**            | `numa-frontend/src/Services/ScheduleService.ts`                  | Frontend API service                     |
| **agent-schedules**            | `lambdas/node/agent-schedules/index.ts`                          | CRUD API + EventBridge management        |
| **agent-schedule-runner**      | `lambdas/node/agent-schedule-runner/index.ts`                    | Execution engine                         |
| **scheduling-schemas**         | `lib/scheduling-schemas.ts`                                      | Zod validation schemas                   |
| **schedule-load**              | `lib/schedule-load.ts`                                           | Quota projection + enforcement helpers   |
| **notification-service**       | `lib/notification-service.ts`                                    | Schedule notification helpers            |
| **workspace-chat-agent-proxy** | `lambdas/python/workspace-chat-agent-proxy/lambda_function.py`   | Auth + routing for runner calls          |
| **numa_tool.py**               | `services/numa-workspace-agent/.../mcp_tools/numa_tool.py`       | Tool gating (enabledTools enforcement)   |
| **Infra construct**            | `infra/constructs/app-agnostic-api-gateway-lambda-collection.ts` | Lambda, IAM, EventBridge wiring          |
| **DynamoDB table**             | `infra/constructs/core-numa-infra-construct.ts`                  | Schedule table definition                |

### Database

| Table                           | Purpose                                 | PK / SK                   |
| ------------------------------- | --------------------------------------- | ------------------------- |
| `numa-{client}-agent-schedules` | Schedule records                        | `user_id` / `schedule_id` |
| GSI: `schedule-id-index`        | Lookup by scheduleId (runner uses this) | `schedule_id`             |
| GSI: `event-type-index`         | Filter by event type                    | `event_type` / `user_id`  |

### API Endpoints

| Method | Path                                 | Handler                   | Auth  | Purpose                                                |
| ------ | ------------------------------------ | ------------------------- | ----- | ------------------------------------------------------ |
| GET    | `/api/agent-schedules`               | agent-schedules           | User  | List user schedules                                    |
| GET    | `/api/agent-schedules/calendar`      | agent-schedules           | User  | Calendar view (filtered by event type)                 |
| GET    | `/api/agent-schedules/tenant`        | agent-schedules           | Admin | List ALL tenant schedules (audit screen)               |
| GET    | `/api/agent-schedules/quota-summary` | agent-schedules           | User  | `{quotas, user, company}` for dashboard strip          |
| GET    | `/api/agent-schedules/:id`           | agent-schedules           | User  | Get single schedule                                    |
| POST   | `/api/agent-schedules`               | agent-schedules           | User  | Create — 201 (active) or 202 (`requiresApproval:true`) |
| POST   | `/api/agent-schedules/:id/approve`   | agent-schedules           | Admin | Pending → active + create EventBridge entry            |
| POST   | `/api/agent-schedules/:id/reject`    | agent-schedules           | Admin | Pending → soft-deleted                                 |
| PUT    | `/api/agent-schedules/:id`           | agent-schedules           | User  | Update schedule + sync EventBridge                     |
| DELETE | `/api/agent-schedules/:id`           | agent-schedules           | User  | Soft delete + remove EventBridge                       |
| POST   | `/api/agent-schedules/run`           | agent-schedule-runner     | User  | Manual "Run Now"                                       |
| GET    | `/api/settings/scheduling`           | admin-scheduling-settings | User  | Admin overrides + ceilings + platform defaults         |
| PUT    | `/api/settings/scheduling`           | admin-scheduling-settings | Admin | Set Level-3 admin override (full quota partial)        |

Schedule status enum is now `'active' | 'paused' | 'deleted' | 'pending_approval'`.

For full quota model, levels, and defaults see `documentation/scheduled-agents/README.md`.

### S3 Storage

| Path                                                                              | Content                                              |
| --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `numa-chat/scheduled-runs/{userId}/{scheduleId}/{runId}.json`                     | Run log (prompt, response, agent status, timestamps) |
| `numa-chat/workspace/{userId}/conversations/{conversationId}/outputs/status.json` | Agent self-evaluation written during run             |

## Detailed Guides

- **[scheduling-execution.md](scheduling-execution.md)** - Runner Lambda, execution flow, tool resolution, auth, known issues
- **[scheduling-frontend.md](scheduling-frontend.md)** - UI components, schedule creation, cron builder
- **[scheduling-infra.md](scheduling-infra.md)** - EventBridge, IAM, DynamoDB, Lambda wiring

## Debugging Cheatsheet

### Common Failure: "Knowledge base is not enabled"

**Symptom:** Scheduled agent says KB is not enabled despite agent having KBs configured.

**Root cause:** The `run_config.enabledTools` in the DynamoDB schedule record is stale (missing `knowledge_base`). This happens when:

1. Schedule was created before the KB tool name unification fix
2. The `AgentScheduleModal` (standalone edit) doesn't update `runConfig` on save

**Debug steps:**

1. Get the schedule record:
   ```bash
   AWS_PROFILE=<profile> aws dynamodb query \
     --table-name numa-<client>-agent-schedules \
     --index-name schedule-id-index \
     --key-condition-expression "schedule_id = :s" \
     --expression-attribute-values '{":s": {"S": "<scheduleId>"}}' \
     --region us-east-1
   ```
2. Check `run_config.enabledTools` - does it include `knowledge_base`?
3. Check `run_config.enabledKBIds` - are KB IDs present?
4. Check runner logs in `/numa/{client}-core` for `[SCHEDULE_RUNNER]` prefixed messages

**Fix:** The runner's `mergeRunConfig()` always rebuilds `enabledTools` from the fresh agent snapshot (not the frozen value). If running old code, patch DynamoDB:

```bash
AWS_PROFILE=<profile> aws dynamodb update-item \
  --table-name numa-<client>-agent-schedules \
  --key '{"user_id": {"S": "<userId>"}, "schedule_id": {"S": "<scheduleId>"}}' \
  --update-expression "SET run_config.enabledTools = :tools" \
  --expression-attribute-values '{":tools": {"L": [{"S": "knowledge_base"}, {"S": "web_search"}, {"S": "memories_tool"}]}}' \
  --region us-east-1
```

### Log Groups for Debugging

| Log Group                                                        | What's There                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `/numa/{client}-core`                                            | Schedule runner logs (`[SCHEDULE_RUNNER]` prefix), agent-schedules CRUD |
| `/numa/{client}/workspace-chat-agent`                            | Container logs (tool invocations, SDK events, KB access)                |
| `/aws/vendedlogs/bedrock-agentcore/numa-{client}-workspace-chat` | AgentCore vendedlogs                                                    |
| `/aws/lambda/{client}-workspace-chat-agent-proxy`                | Proxy auth, routing                                                     |

### Key Log Patterns

```
# Runner - snapshot resolution
filter @message like /SCHEDULE_RUNNER.*Snapshot resolution/

# Runner - merged run config (check enabledTools)
filter @message like /SCHEDULE_RUNNER.*Merged run config/

# Runner - tool building logic
filter @message like /SCHEDULE_RUNNER.*buildEnabledTools/

# Workspace agent - tool setup
filter @message like /AGENT_TOOLS_SETUP/

# Workspace agent - enabled tools passed to SDK
filter @message like /SDK_ENV_TOOLS/

# Workspace agent - KB access validation
filter @message like /KB file listing access validated/
```

### Schedule Record Key Fields

```typescript
{
  user_id: string;          // Cognito sub
  schedule_id: string;      // UUID
  status: 'active' | 'paused' | 'deleted';
  cron_expression: string;  // EventBridge format: cron(M H DoM Mo DoW Y)
  timezone: string;         // IANA timezone
  prompt_text: string;      // Instructions sent to agent
  agent_id: string;
  agent_snapshot: {         // Frozen at creation (runner refreshes at runtime)
    agentId, title, icon, toolsConfig, visibility
  };
  run_config: {             // Tool/model config
    enabledTools: string[];         // ['knowledge_base', 'web_search', 'memories_tool']
    enabledKBIds: string[];         // Bedrock KB IDs
    enabledConnections: string[];   // Pipedream app slugs
    autoToolsEnabled: boolean;
    webSearchEnabled: boolean;
    createAgentEnabled: boolean;
  };
  total_runs: number;
  max_runs?: number;        // Auto-pauses when reached
  last_status: string;
  last_error?: string;
  last_run_epoch: number;
  last_run_conversation_id: string;
  last_run_s3_key: string;
}
```
