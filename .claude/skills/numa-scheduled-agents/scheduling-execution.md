# Scheduled Agents - Execution Engine

## agent-schedule-runner Lambda

**File:** `lambdas/node/agent-schedule-runner/index.ts`
**Runtime:** Node.js 22.x | **Timeout:** 900s (15 min) | **Memory:** 128MB

### Dual Entry Points

The runner handles two invocation types:

1. **EventBridge trigger** (`handleSchedulerEvent`) - no HTTP context, payload is `{type: "SCHEDULE", scheduleId}`
2. **API trigger** (`handleApiEvent`) - `POST /api/agent-schedules/run`, authenticated via Cognito JWT

For API calls with a `scheduleId`, the runner self-invokes asynchronously (`InvocationType: 'Event'`) and returns 202 immediately. The actual execution happens in the background invocation.

### Execution Flow (executeRun)

```
1. Generate runId (UUID) and conversationId: schedule-{scheduleId}-{runId}
2. Send "started" notification + create job record
3. Create conversation meta in chat-history DynamoDB
4. Append user prompt to chat history
5. refreshAgentSnapshot() - fetch latest agent config from DynamoDB
6. mergeRunConfig() - combine run config with fresh agent toolsConfig
7. If allKBsAllowed && no specific KBs: fetchAccessibleKBIds() from KB table
8. invokeWorkspaceAgent() - HTTP POST to proxy in sync mode
9. Append assistant response to chat history
10. readWorkspaceStatus() - read /workdir/outputs/status.json from S3 (retry x3)
11. writeRunLogToS3() - persist full run log
12. markScheduleStatus() - update schedule record with run outcome
13. Send completion/failure notification + create job record
```

### Agent Snapshot Refresh

**Why:** Snapshots are frozen at schedule creation time. If the agent is later updated (KBs added, integrations changed), the schedule would use stale config.

**How:** `refreshAgentSnapshot()` fetches from DynamoDB at runtime:

1. Try `{client}-user-agents` table (personal agents) with `{user_id, agent_id}`
2. Fall back to `{client}-agents` table (workspace agents) with `{tenant_id: CLIENT_NAME, agent_id}`
3. If neither found, use the frozen snapshot

**Key field mapping (DynamoDB -> AgentSnapshot):**

- `tools_config` -> `toolsConfig`
- `system_prompt` -> `systemPrompt`
- `required_integrations` -> `requiredIntegrations`
- `user_instructions` -> `userWelcomeMessage`

### Tool Resolution (mergeRunConfig + buildEnabledTools)

This is the most critical and historically bug-prone part.

**mergeRunConfig()** always rebuilds `enabledTools` from the fresh agent snapshot via `buildEnabledTools()`. It does NOT trust the frozen `run_config.enabledTools` from the schedule record.

**buildEnabledTools()** logic:

```
KB access enabled when ANY of:
  - allKBsAllowed (allowedKnowledgeBases === null -> "All knowledge bases")
  - enabledKBIds.length > 0 (specific KBs selected)
  - Legacy fallback: allowedKnowledgeBases field not set AND queryDataSources === true

If autoToolsEnabled (default true):
  -> knowledge_base (if hasKBs), web_search, memories_tool, create_agent_tool (if enabled)
Else:
  -> knowledge_base (if hasKBs), web_search (if webSearchEnabled), memories_tool, create_agent_tool (if enabled)
```

**KB ID resolution for "All knowledge bases":**
When `allKBsAllowed` is true but no specific IDs exist, `fetchAccessibleKBIds()` queries the `numa-{client}-knowledge-bases` table to resolve actual KB IDs the user can access (same logic as the frontend's KnowledgeBaseProvider). Checks: system KBs (company, numa-support), viewer/editor lists, creator.

**Tool name normalization:**

- `mapToolsToCanonical()`: `query_knowledge_base` and `knowledge_search` -> `knowledge_base`
- `mapKBsToV2()`: converts `string[]` to `[{id, name}]` format for workspace agent

### Workspace Agent Invocation

**Function:** `invokeWorkspaceAgent()`

Calls `POST {WORKSPACE_AGENT_PROXY_URL}/api/workspace-chat-agent/invocations` with:

**Headers:**

```
authorization: Bearer {SCHEDULE_RUNNER_SECRET}
x-arcanum-cloudfront-secret: {CLOUDFRONT_SHARED_SECRET}
x-schedule-runner-sub: {userId}
```

**Body:**

```json
{
  "action": "chat",
  "responseMode": "sync",
  "prompt": "<SCHEDULED_RUN_PREAMBLE> + <user prompt>",
  "conversationId": "schedule-{scheduleId}-{runId}",
  "agentId": "agt_xxx",
  "type": "numa-chat",
  "modelId": "anthropic.claude-sonnet-4-5-20250514-v1:0",
  "enabledTools": ["knowledge_base", "web_search", "memories_tool"],
  "availableKBs": [{ "id": "abc-123", "name": "abc-123" }],
  "enabledConnections": ["slack", "jira"],
  "timezone": "UTC",
  "userEmail": "user@example.com",
  "todayString": "Local date: Wednesday, 3/4/2026, Local time: 5:05:22 AM (UTC)"
}
```

**Timeout:** 840s (14 min) via `AbortSignal.timeout()` - just under the 15 min Lambda timeout.

### Server-to-Server Auth (Proxy Side)

**File:** `lambdas/python/workspace-chat-agent-proxy/lambda_function.py`

The proxy's `extract_user_sub()` function:

1. Checks if the bearer token matches `SCHEDULE_RUNNER_SECRET` via `hmac.compare_digest()`
2. If yes, reads user identity from `x-schedule-runner-sub` header
3. This **bypasses Cognito JWT verification** entirely - it's trusted server-to-server auth
4. If the header is missing, returns 400

### SCHEDULED_RUN_PREAMBLE

Prepended to the user's prompt for scheduled runs. Key instructions:

- Agent is running autonomously (no human interaction)
- Cannot ask for clarification - must complete end-to-end
- Must write `/workdir/outputs/status.json` as the VERY LAST action
- status.json schema: `{status: "success"|"partial"|"failed", summary, artifacts[], errors[], warnings[]}`
- If integration approval times out, tell user to enable auto-approval

### Status.json Reading

**Function:** `readWorkspaceStatus()`

After the workspace agent completes:

1. S3 key: `numa-chat/workspace/{userId}/conversations/{conversationId}/outputs/status.json`
2. Retries up to 3 times with 2s/4s delays (S3 eventual consistency)
3. Validates required fields (status, summary)
4. Returns structured `AgentStatus` or null (fallback to raw assistant text)

### Run Log Storage

**Function:** `writeRunLogToS3()`

Writes to: `numa-chat/scheduled-runs/{userId}/{scheduleId}/{runId}.json`

Contains: scheduleId, runId, conversationId, userId, agent metadata, prompt, assistant text, agentStatus, timestamps, messages array.

### MaxRuns Enforcement

Before execution, the runner checks `total_runs >= max_runs`. If reached:

1. Auto-pauses the schedule (sets status to 'paused' in DynamoDB)
2. Sends a "completed" notification with pause message
3. Skips execution

`total_runs` is incremented atomically via `if_not_exists(total_runs, 0) + 1` after each run.

### Notifications

Uses `lib/notification-service.ts`:

- `notifyScheduleStarted()` - when run begins
- `notifyScheduleCompleted()` - success
- `notifySchedulePartial()` - partial success (agent reported issues)
- `notifyScheduleFailed()` - failure
- Notifications include `{runId}` in metadata for frontend deep-linking
- 90-day TTL on notification records
- Notification failures are swallowed (never throw)

### Environment Variables

| Variable                      | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `WORKSPACE_AGENT_PROXY_URL`   | URL of workspace-chat-agent-proxy Lambda           |
| `SCHEDULE_RUNNER_SECRET`      | Shared secret for server-to-server auth with proxy |
| `CLOUDFRONT_SHARED_SECRET`    | Required header for proxy                          |
| `CHAT_HISTORY_TABLE_NAME`     | DynamoDB table for chat history                    |
| `AGENT_SCHEDULES_TABLE_NAME`  | DynamoDB table for schedule records                |
| `OUTPUTS_BUCKET_NAME`         | S3 bucket for run logs and workspace status        |
| `WORKSPACE_AGENTS_TABLE_NAME` | For snapshot refresh (shared agents)               |
| `USER_AGENTS_TABLE_NAME`      | For snapshot refresh (personal agents)             |
| `CLIENT_NAME`                 | Client identifier (e.g. "hq", "nd-labs")           |
| `NOTIFICATIONS_TABLE_NAME`    | DynamoDB notifications table                       |
| `REGION`                      | AWS region                                         |

### Tool Gating in Workspace Agent

**File:** `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/numa_tool.py`

The workspace agent enforces `enabledTools` at the MCP tool layer:

1. Runner passes `enabledTools` in request body
2. Proxy sets `NUMA_ENABLED_TOOLS` environment variable in the MicroVM
3. `numa_tool.py` checks `_check_operation_allowed(operation)` before executing any tool
4. If `knowledge_base` is not in `enabledTools`, the agent gets: "Knowledge base is not enabled. Enable a knowledge base in chat settings."

The mapping `_OPERATION_TO_ENABLED_TOOL_KEYS` accepts legacy names for backward compat:

- `knowledge_base` operation accepts: `["knowledge_base", "query_knowledge_base", "knowledge_search"]`

### Known Issues and Historical Bugs

1. **Stale enabledTools (fixed):** Schedule records created before the KB fix had `enabledTools: ["web_search"]` without `knowledge_base`. The runner now always rebuilds from the fresh snapshot.

2. **AgentScheduleModal doesn't update runConfig:** The standalone schedule edit modal (`AgentScheduleModal.tsx`) only updates prompt/cron/timezone/label. It does NOT rebuild `enabledTools`. Only the inline path in `AgentCreateModal` does.

3. **createJobRecord() is a no-op:** Job records are logged but not persisted to any DynamoDB table. This is a known TODO.

4. **getByAgent() is O(n):** `ScheduleService.getByAgent()` fetches ALL user schedules and filters client-side. No server-side filtering by agentId.
