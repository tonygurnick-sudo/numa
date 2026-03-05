# Scheduled Agents - Infrastructure

## Overview

All scheduling infrastructure is created per-client in the numa-client-stack via two main constructs.

## DynamoDB Table

**Construct:** `infra/constructs/core-numa-infra-construct.ts`

**Table:** `numa-{clientName}-agent-schedules`

| Attribute     | Type | Role          |
| ------------- | ---- | ------------- |
| `user_id`     | S    | Partition key |
| `schedule_id` | S    | Sort key      |

**GSIs:**
| Index | Hash Key | Range Key | Projection | Used By |
|-------|----------|-----------|------------|---------|
| `schedule-id-index` | `schedule_id` | - | ALL | Runner (lookup by ID without userId) |
| `event-type-index` | `event_type` | `user_id` | ALL | Calendar events API |

Point-in-time recovery enabled.

## Lambda Functions

**Construct:** `infra/constructs/app-agnostic-api-gateway-lambda-collection.ts`

### agent-schedule-runner

**Lines:** ~771-848

| Property | Value                                                |
| -------- | ---------------------------------------------------- |
| Runtime  | nodejs22.x                                           |
| Timeout  | 900s (15 min)                                        |
| Memory   | 128MB                                                |
| Handler  | index.handler                                        |
| Route    | `POST /api/agent-schedules/run` (Cognito authorized) |

**Environment variables passed:**

- `CLIENT_NAME`, `REGION`
- `CHAT_HISTORY_TABLE_NAME`
- `AGENT_SCHEDULES_TABLE_NAME`
- `NOTIFICATIONS_TABLE_NAME`
- `WORKSPACE_AGENT_PROXY_URL`
- `CLOUDFRONT_SHARED_SECRET`
- `SCHEDULE_RUNNER_SECRET`
- `OUTPUTS_BUCKET_NAME`
- `WORKSPACE_AGENTS_TABLE_NAME`
- `USER_AGENTS_TABLE_NAME`

**IAM permissions:**

- DynamoDB: Read/write on chat-history, agent-schedules, notifications, workspace-agents, user-agents tables + GSIs
- DynamoDB: Read on `numa-{clientName}-knowledge-bases` table (for KB ID resolution)
- S3: `PutObject` on `numa-chat/scheduled-runs/*`
- S3: `GetObject` on `numa-chat/workspace/*/outputs/status.json`
- Lambda: `InvokeFunction` on self (for async self-invocation on "Run Now")

### agent-schedules

**Lines:** ~932-943

| Property | Value                                                                                |
| -------- | ------------------------------------------------------------------------------------ |
| Runtime  | nodejs22.x                                                                           |
| Timeout  | 30s                                                                                  |
| Handler  | index.handler                                                                        |
| Routes   | `ANY /api/agent-schedules`, `ANY /api/agent-schedules/{proxy+}` (Cognito authorized) |

**Environment variables:**

- `CLIENT_NAME`, `REGION`
- `AGENT_SCHEDULES_TABLE_NAME`
- `EXECUTION_ROLE_ARN` (EventBridge execution role)
- `RUNNER_ARN` (agent-schedule-runner Lambda ARN)

**IAM permissions:**

- DynamoDB: Full CRUD on agent-schedules table + all GSIs
- Scheduler: `CreateSchedule`, `DeleteSchedule`, `GetSchedule`, `UpdateSchedule`
- IAM: `PassRole` on the EventBridge execution role

## EventBridge Scheduler

### Schedule Groups

**Lines:** ~879-890

Three groups are created per client:

- `{clientName}-agent-schedules` - for agent schedules
- `{clientName}-application-schedules` - for app schedules
- `{clientName}-datasync-schedules` - for data sync schedules

### Execution IAM Role

**Lines:** ~850-877

**Role name:** `{clientName}-agent-schedule-runner`
**Trust policy:** `scheduler.amazonaws.com`
**Permissions:** `lambda:InvokeFunction` on the agent-schedule-runner Lambda ARN

### Schedule Creation Flow (in agent-schedules Lambda)

When a schedule is created:

1. `SchedulerClient.send(new CreateScheduleCommand({...}))` with:
   - `Name`: `{clientName}-{scheduleId}`
   - `GroupName`: `{clientName}-agent-schedules`
   - `ScheduleExpression`: the cron expression from the user
   - `ScheduleExpressionTimezone`: the user's timezone
   - `FlexibleTimeWindow`: `{ Mode: 'OFF' }` (exact time, no window)
   - `Target.Arn`: runner Lambda ARN
   - `Target.RoleArn`: execution role ARN
   - `Target.Input`: `JSON.stringify({type: "SCHEDULE", scheduleId, tenantId: CLIENT_NAME})`
   - `State`: `ENABLED`
2. If EventBridge creation fails, the DynamoDB record is rolled back (deleted)

### Schedule Update/Delete

- **Pause:** Deletes the EventBridge schedule (keeps DynamoDB record with status 'paused')
- **Resume from pause:** Creates a new EventBridge schedule
- **Update cron/timezone:** Calls `UpdateScheduleCommand`
- **Delete:** Sets DynamoDB status to 'deleted' + deletes EventBridge schedule

## Workspace Chat Agent Proxy

**Construct:** `infra/constructs/workspace-chat-agent-proxy-construct.ts`

The proxy Lambda receives `SCHEDULE_RUNNER_SECRET` as an env var (conditionally):

```typescript
SCHEDULE_RUNNER_SECRET: props.scheduleRunnerSecret && props.scheduleRunnerSecret;
```

This enables the server-to-server auth path where the runner authenticates with a shared secret instead of a Cognito JWT.

## Secrets

| Secret                     | Where Set           | Purpose                                        |
| -------------------------- | ------------------- | ---------------------------------------------- |
| `SCHEDULE_RUNNER_SECRET`   | Client stack config | Server-to-server auth between runner and proxy |
| `CLOUDFRONT_SHARED_SECRET` | Client stack config | Required header for all proxy requests         |

Both are typically set in the client configuration and passed through the stack to the relevant constructs.

## CloudWatch Log Groups

All Lambda logs go to the shared `/numa/{clientName}-core` log group (configured via the Lambda construct defaults). The workspace agent container logs go to `/numa/{clientName}/workspace-chat-agent`.
