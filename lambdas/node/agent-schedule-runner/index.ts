import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { NotificationService } from '../../../lib/notification-service';
import { v4 as uuidv4 } from 'uuid';

const REGION = process.env.REGION ?? 'us-east-1';
const CHAT_HISTORY_TABLE = process.env.CHAT_HISTORY_TABLE_NAME ?? '';
const SCHEDULES_TABLE = process.env.AGENT_SCHEDULES_TABLE_NAME ?? '';
const WORKSPACE_AGENT_PROXY_URL = (process.env.WORKSPACE_AGENT_PROXY_URL ?? '').replace(/\/$/, '');
const CLOUDFRONT_SHARED_SECRET = process.env.CLOUDFRONT_SHARED_SECRET ?? '';
const SCHEDULE_RUNNER_SECRET = process.env.SCHEDULE_RUNNER_SECRET ?? '';
const OUTPUTS_BUCKET = process.env.OUTPUTS_BUCKET_NAME ?? '';
const WORKSPACE_AGENTS_TABLE = process.env.WORKSPACE_AGENTS_TABLE_NAME ?? '';
const USER_AGENTS_TABLE = process.env.USER_AGENTS_TABLE_NAME ?? '';
const CLIENT_NAME = process.env.CLIENT_NAME ?? '';
const SCHEDULED_RUNS_PREFIX = 'numa-chat/scheduled-runs';

const dynamo = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, { region: REGION }), {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
const s3 = withPRM(S3Client, { region: REGION });
const lambdaClient = withPRM(LambdaClient, { region: REGION });

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,POST',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

type AuthContext = {
  sub: string;
  email?: string;
  name?: string;
  groups: string[];
};

type ScheduledRunConfig = {
  modelId?: string;
  enabledTools?: string[];
  enabledConnections?: string[];
  enabledKBIds?: string[];
  autoToolsEnabled?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
  allKBsAllowed?: boolean;
};

type AgentToolsConfig = {
  autoToolsEnabled?: boolean;
  queryDataSources?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
  enabledConnections?: string[];
  allowedKnowledgeBases?: string[] | null;
};

type AgentSnapshot = {
  agentId?: string;
  title?: string;
  icon?: string;
  iconImage?: { s3Bucket: string; s3Key: string } | null;
  version?: number;
  visibility?: string;
  systemPrompt?: string;
  userWelcomeMessage?: string;
  requiredIntegrations?: string[];
  toolsConfig?: AgentToolsConfig;
};

type ScheduleRecord = {
  user_id: string;
  schedule_id: string;
  conversation_id: string;
  prompt_text: string;
  status: 'active' | 'paused' | 'deleted';
  agent_id: string;
  agent_title?: string;
  agent_snapshot?: AgentSnapshot;
  run_config?: ScheduledRunConfig;
  label?: string;
  max_runs?: number;
  total_runs?: number;
  email_notifications?: boolean;
  last_status?: string;
  last_error?: string;
  last_run_epoch?: number;
  last_run_conversation_id?: string;
  last_run_s3_key?: string;
};

type RunnerEvent = {
  type?: string;
  scheduleId?: string;
  runId?: string;
};

type RunScheduleResponse = {
  runId: string;
  conversationId: string;
  assistantMessage: string;
  runLogS3Key?: string;
  triggeredBySchedule?: boolean;
};

type ScheduledJobRecord = {
  jobId: string;
  userId: string;
  appId: string;
  appName: string;
  dateTime: string;
  status: 'STARTED' | 'COMPLETED' | 'FAILED';
  results: {
    agentTitle: string;
    promptText: string;
    scheduleId: string;
    result?: string;
    error?: string;
  };
  startedAt: string;
  completedAt?: string;
};

/**
 * Structured self-evaluation written by the workspace agent at the end of each
 * scheduled run to /workdir/outputs/status.json. Read from S3 after the run.
 */
type AgentStatus = {
  status: 'success' | 'partial' | 'failed';
  summary: string;
  artifacts: string[];
  errors: string[];
  warnings: string[];
};

/**
 * Preamble prepended to the user's prompt for scheduled (non-interactive) runs.
 *
 * Tells the agent it's running autonomously and MUST write a status.json file
 * summarising the outcome — regardless of whether the task succeeded or failed.
 */
const SCHEDULED_RUN_PREAMBLE = `<scheduled-run>
You are running as a SCHEDULED AGENT — not in an interactive chat session.

Key behaviour differences:
- You CANNOT ask the user for clarification or feedback. Complete the task end-to-end autonomously.
- Do your best with the information available. If something is ambiguous, make a reasonable choice and note it.
- If you encounter errors, try alternative approaches before giving up.
- Do not use the TodoWrite tool — there is no user watching your progress.
- If you get an error like "Approval timed out for proxy request to integration API — human-in-the-loop approval is required but no user was available to respond." then you need to let the user know they need to update their agent config to enable auto-approval for the relevant integration.

MANDATORY — STATUS REPORT:
After completing your work — whether successful, partially successful, or failed — you MUST write a JSON status report as the VERY LAST action before your final response. This is required on EVERY scheduled run, no exceptions.

Write the file to: /workdir/outputs/status.json

The file must contain valid JSON with exactly these fields:
- "status" (string): one of "success", "partial", or "failed"
- "summary" (string): one sentence describing what you accomplished or why you failed
- "artifacts" (array of strings): filenames of any files you created (empty array if none)
- "errors" (array of strings): any error messages encountered (empty array if none)
- "warnings" (array of strings): non-fatal issues or assumptions you made (empty array if none)

Success example:
{
  "status": "success",
  "summary": "Generated daily progress report with 15 KPIs from the sales dashboard",
  "artifacts": ["report.pdf", "summary.csv"],
  "errors": [],
  "warnings": ["Could not access marketing API — used cached data from yesterday"]
}

Failure example:
{
  "status": "failed",
  "summary": "Could not retrieve data — the API returned 404 for the dashboard endpoint",
  "artifacts": [],
  "errors": ["HTTP 404 from https://api.example.com/dashboard"],
  "warnings": []
}

This status report is used to notify the user of the outcome. Be honest and specific in your summary.
Even if the task failed entirely, you MUST still write status.json with status "failed" and an explanation.
</scheduled-run>

`;

const isApiEvent = (event: unknown): event is APIGatewayProxyEventV2 => {
  const requestContext = (event as { requestContext?: { http?: { method?: unknown } } })?.requestContext;
  return Boolean(requestContext?.http && typeof requestContext.http.method === 'string');
};

const parseJwt = (token: string): Record<string, unknown> => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const parseAuthContext = (event: APIGatewayProxyEventV2): AuthContext | null => {
  const claims =
    (
      event.requestContext as
        | (APIGatewayProxyEventV2['requestContext'] & {
            authorizer?: { jwt?: { claims?: Record<string, unknown> } };
          })
        | undefined
    )?.authorizer?.jwt?.claims || {};
  let sub = typeof claims.sub === 'string' ? claims.sub : undefined;
  let email = typeof claims.email === 'string' ? claims.email : undefined;
  let name = typeof claims.name === 'string' ? claims.name : undefined;
  let groups = Array.isArray(claims['cognito:groups'])
    ? (claims['cognito:groups'] as string[])
    : typeof claims['cognito:groups'] === 'string'
      ? [claims['cognito:groups'] as string]
      : [];

  if (!sub) {
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    if (!authHeader) return null;
    const token = String(authHeader).replace(/^Bearer\s+/i, '');
    const payload = parseJwt(token);
    sub = typeof payload.sub === 'string' ? payload.sub : undefined;
    if (!sub) return null;
    email = typeof payload.email === 'string' ? payload.email : undefined;
    name = typeof payload.name === 'string' ? payload.name : undefined;
    groups = Array.isArray(payload['cognito:groups'])
      ? (payload['cognito:groups'] as unknown[]).filter((g): g is string => typeof g === 'string')
      : [];
  }

  return { sub, email, name, groups };
};

const respond = (statusCode: number, payload: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(payload),
});

const ensureConfigured = (): boolean =>
  Boolean(CHAT_HISTORY_TABLE && SCHEDULES_TABLE && WORKSPACE_AGENT_PROXY_URL && SCHEDULE_RUNNER_SECRET);

export const handler = async (event: unknown): Promise<APIGatewayProxyResultV2 | void> => {
  if (isApiEvent(event)) {
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return respond(200, {});
    }
    return handleApiEvent(event);
  }
  return handleSchedulerEvent(event as RunnerEvent);
};

const handleApiEvent = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  if (!ensureConfigured()) {
    return respond(500, { error: 'Scheduling not configured' });
  }
  if (event.requestContext?.http?.method !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const auth = parseAuthContext(event);
  if (!auth) {
    return respond(401, { error: 'Unauthorized' });
  }

  try {
    const body = JSON.parse(event.body || '{}') as {
      scheduleId?: string;
      conversationId?: string;
      promptText?: string;
      runConfig?: ScheduledRunConfig;
      agentSnapshot?: AgentSnapshot;
    };

    let schedule: ScheduleRecord | null = null;
    let prompt = body.promptText;
    let runConfig = body.runConfig;
    let agentSnapshot = body.agentSnapshot;

    if (body.scheduleId) {
      schedule = await getSchedule(body.scheduleId);
      if (!schedule || schedule.user_id !== auth.sub) {
        return respond(404, { error: 'Schedule not found' });
      }
      prompt = schedule.prompt_text;
      runConfig = schedule.run_config;
      agentSnapshot = schedule.agent_snapshot;
    } else {
      if (!body.conversationId || body.promptText === undefined || body.promptText === null) {
        return respond(400, { error: 'Missing conversationId or promptText' });
      }
      schedule = {
        user_id: auth.sub,
        schedule_id: `adhoc-${uuidv4()}`,
        conversation_id: body.conversationId,
        prompt_text: body.promptText,
        status: 'active',
        agent_id: agentSnapshot?.agentId || 'adhoc',
        agent_title: agentSnapshot?.title,
        agent_snapshot: agentSnapshot,
        run_config: runConfig,
      };
    }

    if (body.scheduleId) {
      const runId = uuidv4();
      const runConversationId = buildRunConversationId(schedule.schedule_id, runId);
      const runLogS3Key = buildRunLogKey(schedule.user_id, schedule.schedule_id, runId);
      await invokeRunnerAsync({
        type: 'SCHEDULE',
        scheduleId: schedule.schedule_id,
        runId,
      });
      return respond(202, {
        status: 'queued',
        runId,
        conversationId: runConversationId,
        runLogS3Key,
      });
    }

    const result = await executeRun({
      schedule,
      prompt: prompt ?? schedule.prompt_text,
      runConfig,
      agentSnapshot,
      auth,
      adHoc: true,
    });

    return respond(200, result);
  } catch (error) {
    console.error('Agent schedule runner API error', error);
    const message = error instanceof Error ? error.message : 'Internal error';
    return respond(message.startsWith('Invalid') ? 400 : 500, { error: message });
  }
};

const parseRunnerEvent = (event: unknown): RunnerEvent => {
  if (!event) return {};
  if (typeof event === 'string') {
    try {
      return JSON.parse(event) as RunnerEvent;
    } catch {
      return {};
    }
  }
  return event as RunnerEvent;
};

const handleSchedulerEvent = async (rawEvent: RunnerEvent | unknown): Promise<void> => {
  if (!ensureConfigured()) {
    console.error('Schedule runner missing configuration, skipping');
    return;
  }
  try {
    const event = parseRunnerEvent(rawEvent);
    if (!event?.scheduleId) {
      throw new Error('Missing scheduleId for scheduled run');
    }
    const schedule = await getSchedule(event.scheduleId);
    if (!schedule) {
      console.warn('Schedule not found for scheduled run', event.scheduleId);
      return;
    }
    if (schedule.status !== 'active') {
      console.info('Skipping schedule because status is not active', schedule.schedule_id, schedule.status);
      return;
    }

    // maxRuns enforcement: skip if total_runs has reached the limit
    if (schedule.max_runs && (schedule.total_runs ?? 0) >= schedule.max_runs) {
      console.info(
        'Skipping schedule because maxRuns reached',
        schedule.schedule_id,
        `${schedule.total_runs}/${schedule.max_runs}`,
      );
      await pauseScheduleForMaxRuns(schedule);
      return;
    }

    await executeRun({
      schedule,
      prompt: schedule.prompt_text,
      runConfig: schedule.run_config,
      agentSnapshot: schedule.agent_snapshot,
      auth: { sub: schedule.user_id, email: undefined, name: undefined, groups: [] },
      adHoc: false,
      triggeredBySchedule: true,
      runId: event.runId,
    });
  } catch (error) {
    console.error('Scheduled run failed', error);
  }
};

const getSchedule = async (scheduleId: string): Promise<ScheduleRecord | null> => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: SCHEDULES_TABLE,
      IndexName: 'schedule-id-index',
      KeyConditionExpression: 'schedule_id = :s',
      ExpressionAttributeValues: {
        ':s': scheduleId,
      },
      Limit: 1,
    }),
  );
  const record = (result.Items || [])[0] as ScheduleRecord | undefined;
  return record || null;
};

type ExecuteRunParams = {
  schedule: ScheduleRecord;
  prompt: string;
  runConfig?: ScheduledRunConfig;
  agentSnapshot?: AgentSnapshot;
  auth: AuthContext;
  adHoc: boolean;
  triggeredBySchedule?: boolean;
  runId?: string;
};

const executeRun = async ({
  schedule,
  prompt,
  runConfig,
  agentSnapshot,
  auth,
  adHoc,
  triggeredBySchedule,
  runId: providedRunId,
}: ExecuteRunParams): Promise<RunScheduleResponse> => {
  const runPrompt = (prompt ?? '').trim();
  const apiPrompt = runPrompt || 'Scheduled run';
  if (!schedule.conversation_id) throw new Error('Conversation ID missing');

  const now = Date.now();
  const runId = providedRunId ?? uuidv4();
  const agentMeta = agentSnapshot || schedule.agent_snapshot;
  const scheduleName = schedule.label || schedule.agent_title || schedule.agent_id || 'Unknown Schedule';
  const runConversationId = adHoc ? schedule.conversation_id : buildRunConversationId(schedule.schedule_id, runId);
  const conversationName = adHoc ? undefined : buildConversationName(scheduleName, now);

  // Notify schedule started and create job record
  if (!adHoc) {
    await NotificationService.notifyScheduleStarted(schedule.user_id, schedule.schedule_id, 'agent', scheduleName);
    await createJobRecord(schedule.user_id, schedule.schedule_id, scheduleName, runPrompt, 'STARTED');
  }

  if (!adHoc) {
    await ensureConversationMeta({
      conversationId: runConversationId,
      userId: schedule.user_id,
      conversationName,
      agentMeta,
      timestamp: now,
      isScheduledRun: true,
      scheduleId: schedule.schedule_id,
    });
  }

  if (runPrompt) {
    await appendMessage({
      conversationId: runConversationId,
      userId: schedule.user_id,
      role: 'user',
      content: runPrompt,
      timestamp: now,
      agentMeta,
      isScheduledRun: !adHoc ? true : undefined,
      scheduleId: !adHoc ? schedule.schedule_id : undefined,
    });
  }

  let assistantText: string;
  try {
    // Refresh agent snapshot from DynamoDB so scheduled runs use the latest
    // agent config (integrations, KBs, tools) rather than the frozen snapshot
    // stored at schedule creation time.
    const freshSnapshot = await refreshAgentSnapshot(agentMeta?.agentId, auth.sub);
    const effectiveSnapshot = freshSnapshot ?? agentMeta;

    console.info('[SCHEDULE_RUNNER] Snapshot resolution', {
      agentId: agentMeta?.agentId,
      usedFreshSnapshot: !!freshSnapshot,
      frozenToolsConfig: JSON.stringify(agentMeta?.toolsConfig),
      freshToolsConfig: freshSnapshot ? JSON.stringify(freshSnapshot.toolsConfig) : 'N/A',
      frozenRequiredIntegrations: agentMeta?.requiredIntegrations,
      freshRequiredIntegrations: freshSnapshot?.requiredIntegrations,
    });

    const mergedRunConfig = mergeRunConfig(runConfig, effectiveSnapshot);

    // When allKBsAllowed is true (agent configured with "All knowledge bases") but
    // no specific KB IDs are available, resolve actual KB IDs from DynamoDB.
    // This mirrors what the frontend does via KnowledgeBaseProvider.
    if (
      mergedRunConfig?.allKBsAllowed &&
      (!mergedRunConfig.enabledKBIds || mergedRunConfig.enabledKBIds.length === 0)
    ) {
      const resolvedKBIds = await fetchAccessibleKBIds(auth.sub);
      if (resolvedKBIds.length > 0 && mergedRunConfig) {
        mergedRunConfig.enabledKBIds = resolvedKBIds;
      }
    }

    console.info('[SCHEDULE_RUNNER] Merged run config', {
      inputRunConfig: JSON.stringify(runConfig),
      mergedEnabledTools: mergedRunConfig?.enabledTools,
      mergedEnabledKBIds: mergedRunConfig?.enabledKBIds,
      mergedEnabledConnections: mergedRunConfig?.enabledConnections,
      mergedAutoToolsEnabled: mergedRunConfig?.autoToolsEnabled,
    });

    assistantText = await invokeWorkspaceAgent({
      prompt: apiPrompt,
      conversationId: runConversationId,
      runConfig: mergedRunConfig,
      agentSnapshot: effectiveSnapshot,
      auth,
      scheduledRun: !adHoc,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Agent invocation failed';
    if (!adHoc) {
      const runLogKey = await writeRunLogToS3({
        schedule,
        runId,
        conversationId: runConversationId,
        userId: schedule.user_id,
        agentMeta,
        prompt: runPrompt,
        assistantText: '',
        error: errorMessage,
        startedAt: now,
        completedAt: Date.now(),
      });
      await markScheduleStatus(
        schedule.user_id,
        schedule.schedule_id,
        'failed',
        errorMessage,
        runConversationId,
        runLogKey,
      );
      await NotificationService.notifyScheduleFailed(
        schedule.user_id,
        schedule.schedule_id,
        'agent',
        scheduleName,
        errorMessage,
      );
      await createJobRecord(
        schedule.user_id,
        schedule.schedule_id,
        scheduleName,
        runPrompt,
        'FAILED',
        undefined,
        errorMessage,
      );
    }
    throw err instanceof Error ? err : new Error('Agent invocation failed');
  }

  let runLogKey: string | null = null;
  try {
    const assistantTimestamp = Date.now();
    await appendMessage({
      conversationId: runConversationId,
      userId: schedule.user_id,
      role: 'assistant',
      content: assistantText,
      timestamp: assistantTimestamp,
      agentMeta,
      isScheduledRun: !adHoc ? true : undefined,
      scheduleId: !adHoc ? schedule.schedule_id : undefined,
    });
    await updateConversationMeta(runConversationId, schedule.user_id, assistantText);

    if (!adHoc) {
      // Read the agent's structured self-evaluation from the workspace.
      // The workspace agent syncs /workdir/outputs/ to S3 before returning,
      // so status.json should be available by this point.
      const agentStatus = await readWorkspaceStatus(schedule.user_id, runConversationId);
      if (agentStatus) {
        console.log('Agent self-evaluation read successfully', {
          status: agentStatus.status,
          summary: agentStatus.summary,
          artifactCount: agentStatus.artifacts.length,
          errorCount: agentStatus.errors.length,
          warningCount: agentStatus.warnings.length,
        });
      } else {
        console.warn('No status.json from agent — falling back to assistant text preview');
      }

      // Determine effective status from the agent's self-evaluation.
      // "failed" = agent couldn't do the core task, "partial" = some parts worked,
      // "success" (or no status.json) = everything worked.
      const agentReportedStatus = agentStatus?.status ?? 'success';
      const effectiveStatus = agentReportedStatus === 'success' ? 'success' : agentReportedStatus;
      const notificationMessage = agentStatus?.summary || assistantText.substring(0, 200);

      runLogKey = await writeRunLogToS3({
        schedule,
        runId,
        conversationId: runConversationId,
        userId: schedule.user_id,
        agentMeta,
        prompt: runPrompt,
        assistantText,
        agentStatus: agentStatus ?? undefined,
        startedAt: now,
        completedAt: assistantTimestamp,
      });

      await markScheduleStatus(
        schedule.user_id,
        schedule.schedule_id,
        effectiveStatus,
        effectiveStatus !== 'success' ? notificationMessage : null,
        runConversationId,
        runLogKey,
      );

      // Notification metadata includes runId so the frontend can deeplink
      // directly to this specific run in the schedule detail page.
      const notifExtra = { runId };

      if (agentReportedStatus === 'failed') {
        await NotificationService.notifyScheduleFailed(
          schedule.user_id,
          schedule.schedule_id,
          'agent',
          scheduleName,
          notificationMessage,
          notifExtra,
        );
        await createJobRecord(
          schedule.user_id,
          schedule.schedule_id,
          scheduleName,
          runPrompt,
          'FAILED',
          undefined,
          notificationMessage,
        );
      } else if (agentReportedStatus === 'partial') {
        await NotificationService.notifySchedulePartial(
          schedule.user_id,
          schedule.schedule_id,
          'agent',
          scheduleName,
          notificationMessage,
          notifExtra,
        );
        await createJobRecord(
          schedule.user_id,
          schedule.schedule_id,
          scheduleName,
          runPrompt,
          'COMPLETED',
          notificationMessage,
        );
      } else {
        await NotificationService.notifyScheduleCompleted(
          schedule.user_id,
          schedule.schedule_id,
          'agent',
          scheduleName,
          notificationMessage,
          notifExtra,
        );
        await createJobRecord(
          schedule.user_id,
          schedule.schedule_id,
          scheduleName,
          runPrompt,
          'COMPLETED',
          notificationMessage,
        );
      }
    }
  } catch (err) {
    console.error('Failed to persist assistant response', err);
    const errorMessage = 'Failed to persist chat output';
    if (!adHoc) {
      await markScheduleStatus(
        schedule.user_id,
        schedule.schedule_id,
        'failed',
        errorMessage,
        runConversationId,
        runLogKey,
      );
      await NotificationService.notifyScheduleFailed(
        schedule.user_id,
        schedule.schedule_id,
        'agent',
        scheduleName,
        errorMessage,
      );
      await createJobRecord(
        schedule.user_id,
        schedule.schedule_id,
        scheduleName,
        runPrompt,
        'FAILED',
        undefined,
        errorMessage,
      );
    }
    throw err instanceof Error ? err : new Error('Unable to persist response');
  }

  return {
    runId,
    conversationId: runConversationId,
    assistantMessage: assistantText,
    runLogS3Key: runLogKey ?? undefined,
    triggeredBySchedule: Boolean(triggeredBySchedule),
  };
};

const createJobRecord = async (
  userId: string,
  scheduleId: string,
  agentTitle: string,
  promptText: string,
  status: 'STARTED' | 'COMPLETED' | 'FAILED',
  result?: string,
  error?: string,
): Promise<ScheduledJobRecord> => {
  // Create a job record for scheduled agent runs to appear in job history
  const jobRecord = {
    jobId: `schedule-${scheduleId}-${Date.now()}`,
    userId,
    appId: 'scheduled-agents',
    appName: 'Scheduled Agents',
    dateTime: new Date().toISOString(),
    status,
    results: {
      agentTitle,
      promptText,
      scheduleId,
      ...(result && { result }),
      ...(error && { error }),
    },
    startedAt: new Date().toISOString(),
    ...(status !== 'STARTED' && { completedAt: new Date().toISOString() }),
  };

  // For now, just log the job record - in a full implementation,
  // this would write to a jobs table or call the jobs API
  console.log('Job record created:', JSON.stringify(jobRecord, null, 2));

  return jobRecord;
};

const markScheduleStatus = async (
  userId: string,
  scheduleId: string,
  status: string,
  error: string | null,
  runConversationId?: string | null,
  runLogKey?: string | null,
): Promise<void> => {
  const updateExpressions = ['last_run_epoch = :ts', 'last_status = :status', 'last_error = :err'];
  const expressionAttributeValues: Record<string, unknown> = {
    ':ts': Date.now(),
    ':status': status,
    ':err': error,
  };

  // Increment total_runs counter on each completed or failed run
  updateExpressions.push('total_runs = if_not_exists(total_runs, :zero) + :one');
  expressionAttributeValues[':zero'] = 0;
  expressionAttributeValues[':one'] = 1;

  if (runConversationId) {
    updateExpressions.push('last_run_conversation_id = :conversationId');
    expressionAttributeValues[':conversationId'] = runConversationId;
  }

  if (runLogKey) {
    updateExpressions.push('last_run_s3_key = :runLogKey');
    expressionAttributeValues[':runLogKey'] = runLogKey;
  }

  await dynamo.send(
    new UpdateCommand({
      TableName: SCHEDULES_TABLE,
      Key: { user_id: userId, schedule_id: scheduleId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeValues: expressionAttributeValues,
    }),
  );
};

/** Auto-pause a schedule that has reached its maxRuns limit. */
const pauseScheduleForMaxRuns = async (schedule: ScheduleRecord): Promise<void> => {
  try {
    await dynamo.send(
      new UpdateCommand({
        TableName: SCHEDULES_TABLE,
        Key: { user_id: schedule.user_id, schedule_id: schedule.schedule_id },
        UpdateExpression: 'SET #status = :paused, updated_at = :ts',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':paused': 'paused',
          ':ts': Date.now(),
        },
      }),
    );
    const scheduleName = schedule.label || schedule.agent_title || schedule.agent_id || 'Unknown Schedule';
    await NotificationService.notifyScheduleCompleted(
      schedule.user_id,
      schedule.schedule_id,
      'agent',
      scheduleName,
      `Schedule paused: reached maximum of ${schedule.max_runs} runs.`,
    );
    console.info('Schedule auto-paused due to maxRuns limit', schedule.schedule_id);
  } catch (err) {
    console.error('Failed to auto-pause schedule for maxRuns', err);
  }
};

const appendMessage = async ({
  conversationId,
  userId,
  role,
  content,
  timestamp,
  agentMeta,
  isScheduledRun,
  scheduleId,
}: {
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  agentMeta?: AgentSnapshot;
  isScheduledRun?: boolean;
  scheduleId?: string;
}): Promise<void> => {
  if (!CHAT_HISTORY_TABLE) return;
  const sk = `${conversationId}#${timestamp}`;
  await dynamo.send(
    new PutCommand({
      TableName: CHAT_HISTORY_TABLE,
      Item: {
        user_id: userId,
        sk,
        conversation_id: conversationId,
        timestamp,
        message_type: 'text',
        role,
        content,
        agentId: agentMeta?.agentId,
        agentTitle: agentMeta?.title,
        agentVersion: agentMeta?.version,
        agentIcon: agentMeta?.icon,
        agentVisibility: agentMeta?.visibility,
        isAgentConversation: Boolean(agentMeta?.agentId),
        isScheduledRun,
        scheduleId,
      },
    }),
  );
};

const updateConversationMeta = async (conversationId: string, userId: string, latestMessage: string): Promise<void> => {
  if (!CHAT_HISTORY_TABLE) return;
  const result = await dynamo.send(
    new QueryCommand({
      TableName: CHAT_HISTORY_TABLE,
      KeyConditionExpression: 'user_id = :u AND begins_with(sk, :c)',
      FilterExpression: 'message_type = :meta',
      ExpressionAttributeValues: {
        ':u': userId,
        ':c': `${conversationId}#`,
        ':meta': 'meta',
      },
      Limit: 1,
    }),
  );
  const meta = (result.Items || [])[0];
  if (!meta) return;
  await dynamo.send(
    new UpdateCommand({
      TableName: CHAT_HISTORY_TABLE,
      Key: {
        user_id: meta.user_id,
        sk: meta.sk,
      },
      UpdateExpression: 'SET latestTimestamp = :ts, latestMessage = :msg',
      ExpressionAttributeValues: {
        ':ts': Date.now(),
        ':msg': latestMessage.slice(0, 1000),
      },
    }),
  );
};

const buildRunConversationId = (scheduleId: string, runId: string): string => `schedule-${scheduleId}-${runId}`;

const buildConversationName = (scheduleName: string, timestamp: number): string =>
  `Scheduled - ${scheduleName} - ${new Date(timestamp).toISOString()}`;

const ensureConversationMeta = async ({
  conversationId,
  userId,
  conversationName,
  agentMeta,
  timestamp,
  isScheduledRun,
  scheduleId,
}: {
  conversationId: string;
  userId: string;
  conversationName?: string;
  agentMeta?: AgentSnapshot;
  timestamp: number;
  isScheduledRun?: boolean;
  scheduleId?: string;
}): Promise<void> => {
  if (!CHAT_HISTORY_TABLE) return;
  const sk = `${conversationId}#${timestamp}`;
  await dynamo.send(
    new PutCommand({
      TableName: CHAT_HISTORY_TABLE,
      Item: {
        user_id: userId,
        sk,
        conversation_id: conversationId,
        timestamp,
        message_type: 'meta',
        role: 'user',
        content: 'Scheduled run started',
        conversationName,
        latestTimestamp: timestamp,
        latestMessage: 'Scheduled run started',
        agentId: agentMeta?.agentId,
        agentTitle: agentMeta?.title,
        agentVersion: agentMeta?.version,
        agentIcon: agentMeta?.icon,
        agentVisibility: agentMeta?.visibility,
        isAgentConversation: Boolean(agentMeta?.agentId),
        isScheduledRun,
        scheduleId,
      },
    }),
  );
};

const writeRunLogToS3 = async ({
  schedule,
  runId,
  conversationId,
  userId,
  agentMeta,
  prompt: runPrompt,
  assistantText,
  agentStatus,
  error,
  startedAt,
  completedAt,
}: {
  schedule: ScheduleRecord;
  runId: string;
  conversationId: string;
  userId: string;
  agentMeta?: AgentSnapshot;
  prompt: string;
  assistantText?: string;
  agentStatus?: AgentStatus;
  error?: string;
  startedAt: number;
  completedAt: number;
}): Promise<string | null> => {
  if (!OUTPUTS_BUCKET) {
    console.warn('Outputs bucket not configured; skipping scheduled run log upload');
    return null;
  }

  const key = buildRunLogKey(userId, schedule.schedule_id, runId);
  const messages = [];
  if (runPrompt) {
    messages.push({ role: 'user', content: runPrompt, timestamp: startedAt });
  }
  if (assistantText) {
    messages.push({ role: 'assistant', content: assistantText, timestamp: completedAt });
  }

  const payload = {
    scheduleId: schedule.schedule_id,
    scheduleLabel: schedule.label ?? null,
    runId,
    conversationId,
    userId,
    agent: {
      agentId: agentMeta?.agentId ?? schedule.agent_id,
      agentTitle: agentMeta?.title ?? schedule.agent_title ?? null,
      agentVersion: agentMeta?.version ?? null,
      agentIcon: agentMeta?.icon ?? null,
      agentVisibility: agentMeta?.visibility ?? null,
    },
    ...(runPrompt ? { prompt: runPrompt } : {}),
    ...(error ? { error } : {}),
    ...(agentStatus ? { agentStatus } : {}),
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    messages,
  };

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: OUTPUTS_BUCKET,
        Key: key,
        Body: JSON.stringify(payload),
        ContentType: 'application/json',
      }),
    );
    return key;
  } catch (error) {
    console.error('Failed to upload scheduled run log to S3', error);
    return null;
  }
};

/**
 * Small helper to sleep for a given number of milliseconds.
 */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read the agent's self-evaluation status.json from the workspace in S3.
 *
 * After a scheduled run, the workspace agent writes /workdir/outputs/status.json
 * and syncs it to S3. This function reads that file to get structured outcome data
 * (status, summary, artifacts, errors, warnings) for richer notifications.
 *
 * The workspace sync to S3 happens inside the agent container before it returns
 * the HTTP response, but S3 eventual consistency or minor timing differences
 * could mean the file isn't immediately visible. We retry up to 3 times with
 * a short delay (2s, 4s) before giving up.
 *
 * Returns null if the file doesn't exist or is malformed — callers should
 * fall back to the raw assistant text in that case.
 */
const readWorkspaceStatus = async (userId: string, conversationId: string): Promise<AgentStatus | null> => {
  if (!OUTPUTS_BUCKET) return null;

  // S3 path mirrors the workspace agent's sync convention:
  // numa-chat/workspace/{user_sub}/conversations/{conversation_id}/outputs/status.json
  const key = `numa-chat/workspace/${userId}/conversations/${conversationId}/outputs/status.json`;

  const MAX_ATTEMPTS = 3;
  const RETRY_DELAYS_MS = [2_000, 4_000]; // delays between attempt 1→2 and 2→3

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: OUTPUTS_BUCKET,
          Key: key,
        }),
      );
      const body = await response.Body?.transformToString();
      if (!body) return null;

      const parsed = JSON.parse(body);

      // Validate required fields
      if (!parsed.status || !parsed.summary) {
        console.warn('status.json missing required fields', { key, parsed });
        return null;
      }

      const validStatuses = ['success', 'partial', 'failed'];

      return {
        status: validStatuses.includes(parsed.status) ? parsed.status : 'partial',
        summary: String(parsed.summary).substring(0, 500),
        artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts.map(String) : [],
        errors: Array.isArray(parsed.errors) ? parsed.errors.map(String) : [],
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
      };
    } catch (err: unknown) {
      const errorName = err instanceof Error ? (err as { name?: string }).name : undefined;
      const isNotFound = errorName === 'NoSuchKey';

      if (isNotFound && attempt < MAX_ATTEMPTS) {
        // File may not have synced to S3 yet — wait and retry
        const delayMs = RETRY_DELAYS_MS[attempt - 1];
        console.log(`status.json not found yet, retrying in ${delayMs}ms (attempt ${attempt}/${MAX_ATTEMPTS})`, {
          key,
        });
        await sleep(delayMs);
        continue;
      }

      // Final attempt or non-retryable error
      if (isNotFound) {
        console.warn('status.json not found after retries (agent may not have written it)', { key, attempts: attempt });
      } else {
        console.warn('Could not read workspace status.json', { key, error: err });
      }
      return null;
    }
  }

  return null;
};

/**
 * Invoke the V2 workspace agent proxy in sync mode.
 *
 * Calls the workspace-chat-agent-proxy Lambda's /invocations endpoint with
 * responseMode: "sync". The V2 agent natively supports agent prompt injection
 * via agentId — no manual system prompt building is needed.
 *
 * Auth: Uses SCHEDULE_RUNNER_SECRET as bearer token + x-schedule-runner-sub
 * header for user identity (the proxy recognises this auth pattern for
 * server-to-server calls).
 */
const invokeWorkspaceAgent = async ({
  prompt: runPrompt,
  conversationId,
  runConfig,
  agentSnapshot,
  auth,
  scheduledRun,
}: {
  prompt: string;
  conversationId: string;
  runConfig?: ScheduledRunConfig;
  agentSnapshot?: AgentSnapshot;
  auth: AuthContext;
  scheduledRun?: boolean;
}): Promise<string> => {
  if (!WORKSPACE_AGENT_PROXY_URL || !SCHEDULE_RUNNER_SECRET) {
    throw new Error('Workspace agent invocation unavailable');
  }

  // For scheduled runs, prepend instructions so the agent knows to complete
  // autonomously and write a structured status report when finished.
  // V2 handles the agent's system prompt natively via agentId — we only add the scheduled-run context.
  const prompt = scheduledRun ? `${SCHEDULED_RUN_PREAMBLE}${runPrompt}` : runPrompt;

  const requestBody = {
    action: 'chat',
    responseMode: 'sync',
    prompt,
    conversationId,
    // V2 resolves the agent config (system prompt, tools, KBs) from agentId
    agentId: agentSnapshot?.agentId,
    // numa-chat is the default workspace agent type — it supports agent prompt injection natively
    type: 'numa-chat',
    modelId: runConfig?.modelId,
    // Map V1 tool names to V2 equivalents
    enabledTools: mapToolsToCanonical(runConfig?.enabledTools),
    // Map V1 KB IDs to V2 availableKBs format
    availableKBs: mapKBsToV2(runConfig?.enabledKBIds),
    enabledConnections: runConfig?.enabledConnections,
    timezone: 'UTC',
    userEmail: auth.email ?? '',
    todayString: buildTodayString(),
  };

  const response = await fetch(`${WORKSPACE_AGENT_PROXY_URL}/api/workspace-chat-agent/invocations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SCHEDULE_RUNNER_SECRET}`,
      'x-arcanum-cloudfront-secret': CLOUDFRONT_SHARED_SECRET,
      // The proxy uses this header to identify the user when schedule runner secret auth is used
      'x-schedule-runner-sub': auth.sub,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(840_000), // 14 min — just under the 15 min Lambda timeout
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Workspace agent invocation failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as {
    status?: string;
    result?: { text?: string; artifacts?: unknown[]; usage?: unknown };
    error?: string;
  };

  if (payload.status === 'error' || payload.error) {
    throw new Error(payload.error ?? 'Workspace agent returned error status');
  }

  return payload.result?.text ?? '';
};

/** Normalise legacy tool names to the canonical form used by the workspace agent MCP tool layer. */
const mapToolsToCanonical = (tools?: string[]): string[] | undefined => {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => {
    if (tool === 'query_knowledge_base' || tool === 'knowledge_search') return 'knowledge_base';
    return tool;
  });
};

/** Map V1 KB ID strings to V2 availableKBs format: [{id, name}]. */
const mapKBsToV2 = (kbIds?: string[]): Array<{ id: string; name: string }> | undefined => {
  if (!kbIds || kbIds.length === 0) return undefined;
  const valid = kbIds.filter((id): id is string => Boolean(id));
  if (valid.length === 0) return undefined;
  return valid.map((id) => ({ id, name: id }));
};

/** Build a todayString for the workspace agent (provides local date/time context). */
const buildTodayString = (): string => {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  };
  const dateStr = now.toLocaleDateString('en-US', options);
  const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'UTC' });
  return `Local date: ${dateStr}, Local time: ${timeStr} (UTC)`;
};

const invokeRunnerAsync = async (event: RunnerEvent): Promise<void> => {
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!functionName) {
    throw new Error('Runner function name unavailable');
  }
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(event)),
    }),
  );
};

const buildRunLogKey = (userId: string, scheduleId: string, runId: string): string =>
  `${SCHEDULED_RUNS_PREFIX}/${userId}/${scheduleId}/${runId}.json`;

/**
 * Refresh the agent snapshot by fetching the current agent config from DynamoDB.
 *
 * Agent snapshots are frozen at schedule creation time. If the agent config is
 * later updated (e.g. integrations added/removed, KB access changed), the
 * schedule would use stale data. This function fetches the latest config so
 * scheduled runs always reflect the current agent state.
 *
 * Tries the user agent table first (personal agents), falls back to workspace
 * table (shared agents). Returns null if the agent no longer exists or the
 * tables are not configured.
 */
const refreshAgentSnapshot = async (agentId: string | undefined, userId: string): Promise<AgentSnapshot | null> => {
  if (!agentId) return null;
  if (!USER_AGENTS_TABLE && !WORKSPACE_AGENTS_TABLE) {
    console.warn('Agent tables not configured; using frozen snapshot');
    return null;
  }

  // Try user (personal) agent table first
  if (USER_AGENTS_TABLE) {
    try {
      const result = await dynamo.send(
        new GetCommand({
          TableName: USER_AGENTS_TABLE,
          Key: { user_id: userId, agent_id: agentId },
        }),
      );
      if (result.Item) {
        console.info('Refreshed agent snapshot from user table', { agentId, userId });
        return mapDynamoItemToSnapshot(result.Item);
      }
    } catch (err) {
      console.warn('Failed to fetch user agent', { agentId, error: (err as Error).message });
    }
  }

  // Fall back to workspace (shared) agent table
  if (WORKSPACE_AGENTS_TABLE && CLIENT_NAME) {
    try {
      const result = await dynamo.send(
        new GetCommand({
          TableName: WORKSPACE_AGENTS_TABLE,
          Key: { tenant_id: CLIENT_NAME, agent_id: agentId },
        }),
      );
      if (result.Item) {
        console.info('Refreshed agent snapshot from workspace table', { agentId });
        return mapDynamoItemToSnapshot(result.Item);
      }
    } catch (err) {
      console.warn('Failed to fetch workspace agent', { agentId, error: (err as Error).message });
    }
  }

  console.warn('Agent not found in either table; using frozen snapshot', { agentId });
  return null;
};

/** Map a raw DynamoDB agent item to the AgentSnapshot type used by the schedule runner. */
const mapDynamoItemToSnapshot = (item: Record<string, unknown>): AgentSnapshot => ({
  agentId: item.agent_id as string,
  title: item.title as string | undefined,
  icon: item.icon as string | undefined,
  iconImage: item.icon_image as { s3Bucket: string; s3Key: string } | null | undefined,
  version: item.version as number | undefined,
  visibility: item.visibility as string | undefined,
  systemPrompt: item.system_prompt as string | undefined,
  userWelcomeMessage: item.user_instructions as string | undefined,
  requiredIntegrations: (item.required_integrations as string[] | undefined) ?? [],
  toolsConfig: item.tools_config as AgentToolsConfig | undefined,
});

/** System KBs that are accessible to all authenticated users (mirrors kb_permissions.py). */
const SYSTEM_KB_IDS = new Set(['company', 'numa-support']);

/**
 * Fetch all KB IDs that the user can access from the knowledge-bases DynamoDB table.
 * Used when an agent has allowedKnowledgeBases=null ("All knowledge bases") so the
 * schedule runner can resolve actual KB IDs — the same resolution the frontend does
 * via KnowledgeBaseProvider.
 */
const fetchAccessibleKBIds = async (userSub: string): Promise<string[]> => {
  const tableName = `numa-${CLIENT_NAME}-knowledge-bases`;
  if (!CLIENT_NAME) {
    console.warn('[SCHEDULE_RUNNER] CLIENT_NAME not set; cannot fetch KBs');
    return [];
  }

  try {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${CLIENT_NAME}`,
          ':skPrefix': 'KB#',
        },
        ProjectionExpression: 'SK, viewers, editors, created_by',
      }),
    );

    const items = result.Items ?? [];
    const accessibleKBIds: string[] = [];

    for (const item of items) {
      const sk = item.SK as string | undefined;
      if (!sk) continue;
      const kbId = sk.replace('KB#', '');
      if (!kbId) continue;

      // System KBs are accessible to all authenticated users
      if (SYSTEM_KB_IDS.has(kbId)) {
        accessibleKBIds.push(kbId);
        continue;
      }

      // Check user access: viewers, editors, or creator
      const viewers = extractStringList(item.viewers);
      const editors = extractStringList(item.editors);
      const createdBy = typeof item.created_by === 'string' ? item.created_by : '';

      if (viewers.includes('*') || viewers.includes(userSub) || editors.includes(userSub) || createdBy === userSub) {
        accessibleKBIds.push(kbId);
      }
    }

    console.info('[SCHEDULE_RUNNER] Resolved all-KBs-allowed', {
      tableName,
      totalKBs: items.length,
      accessibleKBIds,
      userSub: userSub.slice(0, 8) + '...',
    });

    return accessibleKBIds;
  } catch (err) {
    console.error('[SCHEDULE_RUNNER] Failed to fetch KB IDs', {
      tableName,
      error: (err as Error).message,
    });
    return [];
  }
};

/**
 * Extract a list of strings from a DynamoDB attribute that may be stored as
 * a string array (DynamoDB document client unmarshalled) or other formats.
 * Mirrors the _extract_string_list helper in kb_permissions.py.
 */
const extractStringList = (attr: unknown): string[] => {
  if (Array.isArray(attr)) return attr.filter((v): v is string => typeof v === 'string');
  return [];
};

/**
 * Merge the run config from the schedule record with the agent snapshot's tools config.
 *
 * The V2 workspace agent resolves agent system prompts natively via agentId,
 * so we no longer build system prompts here. We still merge enabled tools,
 * connections, and KBs to pass as request parameters.
 */
const mergeRunConfig = (
  runConfig: ScheduledRunConfig | undefined,
  agentSnapshot?: AgentSnapshot,
): ScheduledRunConfig | undefined => {
  if (!runConfig && !agentSnapshot) return runConfig;

  const base = runConfig ?? {};
  const toolsConfig = agentSnapshot?.toolsConfig ?? {};

  const enabledConnections = uniqStrings([
    ...(base.enabledConnections ?? []),
    ...(toolsConfig.enabledConnections ?? []),
    ...(agentSnapshot?.requiredIntegrations ?? []),
  ]);

  // Merge KB IDs from both the run config and the agent snapshot's allowedKnowledgeBases.
  // allowedKnowledgeBases semantics:
  //   null      = "All knowledge bases" (user explicitly selected this)
  //   undefined = field not set (legacy agent — fall back to queryDataSources)
  //   []        = "No knowledge bases"
  //   [...ids]  = "Selected knowledge bases"
  const allKBsAllowed = toolsConfig.allowedKnowledgeBases === null;
  const kbFieldSet = 'allowedKnowledgeBases' in toolsConfig;
  const enabledKBIds = uniqStrings([
    ...(Array.isArray(base.enabledKBIds) ? base.enabledKBIds : []),
    ...(Array.isArray(toolsConfig.allowedKnowledgeBases) ? toolsConfig.allowedKnowledgeBases : []),
  ]);
  const autoToolsEnabled = base.autoToolsEnabled ?? toolsConfig.autoToolsEnabled;
  const webSearchEnabled = base.webSearchEnabled ?? toolsConfig.webSearchEnabled;
  const createAgentEnabled = base.createAgentEnabled ?? toolsConfig.createAgentEnabled;

  console.info('[SCHEDULE_RUNNER] mergeRunConfig KB resolution', {
    'base.enabledKBIds': base.enabledKBIds,
    'toolsConfig.allowedKnowledgeBases': toolsConfig.allowedKnowledgeBases,
    'toolsConfig.queryDataSources': toolsConfig.queryDataSources,
    allKBsAllowed,
    kbFieldSet,
    enabledKBIds,
    'base.enabledTools': base.enabledTools,
    willRebuildTools: !(base.enabledTools && base.enabledTools.length > 0),
  });

  const enabledTools =
    base.enabledTools && base.enabledTools.length > 0
      ? base.enabledTools
      : buildEnabledTools({
          autoToolsEnabled,
          webSearchEnabled,
          createAgentEnabled,
          enabledKBIds,
          allKBsAllowed,
          kbFieldSet,
          queryDataSources: toolsConfig.queryDataSources,
        });

  return {
    ...base,
    enabledTools,
    enabledConnections,
    enabledKBIds,
    allKBsAllowed,
    autoToolsEnabled,
    webSearchEnabled,
    createAgentEnabled,
  };
};

/**
 * Build the list of enabled tools using canonical tool names.
 *
 * Canonical names: knowledge_base, memories_tool, web_search, create_agent_tool.
 * The MCP tool layer also accepts legacy names (query_knowledge_base, knowledge_search)
 * for backward compatibility with existing schedule records stored in DynamoDB.
 *
 * KB access: The new allowedKnowledgeBases field (null / [] / [...ids]) is authoritative
 * when present. The legacy queryDataSources boolean is only used as a fallback for
 * agents created before allowedKnowledgeBases existed.
 */
const buildEnabledTools = ({
  autoToolsEnabled,
  webSearchEnabled,
  createAgentEnabled,
  enabledKBIds,
  allKBsAllowed,
  kbFieldSet,
  queryDataSources,
}: {
  autoToolsEnabled?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
  enabledKBIds: string[];
  allKBsAllowed?: boolean;
  kbFieldSet?: boolean;
  queryDataSources?: boolean;
}): string[] => {
  const enabledTools: string[] = [];
  // KB access is enabled when:
  // - allKBsAllowed (allowedKnowledgeBases was null = "All knowledge bases"), OR
  // - specific KB IDs were selected (enabledKBIds has entries), OR
  // - legacy fallback: allowedKnowledgeBases field doesn't exist and queryDataSources is true
  const hasKBs = allKBsAllowed || enabledKBIds.length > 0 || (!kbFieldSet && queryDataSources === true);
  const auto = autoToolsEnabled ?? true;

  console.info('[SCHEDULE_RUNNER] buildEnabledTools', {
    hasKBs,
    hasKBs_reason: allKBsAllowed
      ? 'allKBsAllowed'
      : enabledKBIds.length > 0
        ? 'specificKBIds'
        : !kbFieldSet && queryDataSources === true
          ? 'legacyQueryDataSources'
          : 'none',
    auto,
    allKBsAllowed,
    enabledKBIdsCount: enabledKBIds.length,
    kbFieldSet,
    queryDataSources,
  });

  if (auto) {
    if (hasKBs) enabledTools.push('knowledge_base');
    enabledTools.push('web_search');
    if (createAgentEnabled) enabledTools.push('create_agent_tool');
    enabledTools.push('memories_tool');
  } else {
    if (hasKBs) enabledTools.push('knowledge_base');
    if (webSearchEnabled) enabledTools.push('web_search');
    if (createAgentEnabled) enabledTools.push('create_agent_tool');
    enabledTools.push('memories_tool');
  }

  console.info('[SCHEDULE_RUNNER] buildEnabledTools result', { enabledTools });

  return enabledTools;
};

const uniqStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim?.();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};
