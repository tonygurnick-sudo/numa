import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { NotificationService } from '../../../lib/notification-service';
import { v4 as uuidv4 } from 'uuid';

const REGION = process.env.REGION ?? 'us-east-1';
const CHAT_HISTORY_TABLE = process.env.CHAT_HISTORY_TABLE_NAME ?? '';
const SCHEDULES_TABLE = process.env.AGENT_SCHEDULES_TABLE_NAME ?? '';
const CHAT_AGENT_FUNCTION_URL = (process.env.CHAT_AGENT_FUNCTION_URL ?? '').replace(/\/$/, '');
const CLOUDFRONT_SHARED_SECRET = process.env.CLOUDFRONT_SHARED_SECRET ?? '';
const SCHEDULE_RUNNER_SECRET = process.env.SCHEDULE_RUNNER_SECRET ?? '';
const OUTPUTS_BUCKET = process.env.OUTPUTS_BUCKET_NAME ?? '';
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
  systemPrompt?: string;
  modelId?: string;
  enabledTools?: string[];
  enabledConnections?: string[];
  enabledKBIds?: string[];
  autoToolsEnabled?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
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
  Boolean(CHAT_HISTORY_TABLE && SCHEDULES_TABLE && CHAT_AGENT_FUNCTION_URL && SCHEDULE_RUNNER_SECRET);

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
    });
  }

  let assistantText: string;
  try {
    const mergedRunConfig = mergeRunConfig(runConfig, agentSnapshot);
    assistantText = await invokeChatAgent({
      prompt: apiPrompt,
      conversationId: runConversationId,
      runConfig: mergedRunConfig,
      agentSnapshot: agentMeta,
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
    });
    await updateConversationMeta(runConversationId, schedule.user_id, assistantText);

    if (!adHoc) {
      runLogKey = await writeRunLogToS3({
        schedule,
        runId,
        conversationId: runConversationId,
        userId: schedule.user_id,
        agentMeta,
        prompt: runPrompt,
        assistantText,
        startedAt: now,
        completedAt: assistantTimestamp,
      });
      await markScheduleStatus(schedule.user_id, schedule.schedule_id, 'success', null, runConversationId, runLogKey);
      await NotificationService.notifyScheduleCompleted(
        schedule.user_id,
        schedule.schedule_id,
        'agent',
        scheduleName,
        assistantText.substring(0, 100), // First 100 chars as preview
      );
      await createJobRecord(
        schedule.user_id,
        schedule.schedule_id,
        scheduleName,
        runPrompt,
        'COMPLETED',
        assistantText.substring(0, 200), // First 200 chars as result
      );
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

const appendMessage = async ({
  conversationId,
  userId,
  role,
  content,
  timestamp,
  agentMeta,
}: {
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  agentMeta?: AgentSnapshot;
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
}: {
  conversationId: string;
  userId: string;
  conversationName?: string;
  agentMeta?: AgentSnapshot;
  timestamp: number;
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

const invokeChatAgent = async ({
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
  if (!CHAT_AGENT_FUNCTION_URL || !SCHEDULE_RUNNER_SECRET) {
    throw new Error('Chat agent invocation unavailable');
  }
  const systemPrompt = buildSystemPrompt(runConfig?.systemPrompt, agentSnapshot, scheduledRun);
  const requestBody = {
    prompt: runPrompt,
    conversationId,
    systemPrompt,
    modelId: runConfig?.modelId,
    enabledTools: runConfig?.enabledTools,
    enabledConnections: runConfig?.enabledConnections,
    enabledKBIds: runConfig?.enabledKBIds,
    autoToolsEnabled: runConfig?.autoToolsEnabled,
    webSearchEnabled: runConfig?.webSearchEnabled,
    createAgentEnabled: runConfig?.createAgentEnabled,
    userAuth: {
      sub: auth.sub,
      email: auth.email,
      groups: auth.groups,
    },
    internalUser: {
      sub: auth.sub,
      email: auth.email,
      groups: auth.groups,
    },
  };

  const response = await fetch(`${CHAT_AGENT_FUNCTION_URL}/api/numa-chat-agent/invoke`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SCHEDULE_RUNNER_SECRET}`,
      'x-arcanum-cloudfront-secret': CLOUDFRONT_SHARED_SECRET,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Agent invocation failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as { content?: string; error?: string };
  if (payload.error) throw new Error(payload.error);
  return payload.content ?? '';
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

  const enabledKBIds = Array.isArray(base.enabledKBIds) ? base.enabledKBIds : [];
  const autoToolsEnabled = base.autoToolsEnabled ?? toolsConfig.autoToolsEnabled;
  const webSearchEnabled = base.webSearchEnabled ?? toolsConfig.webSearchEnabled;
  const createAgentEnabled = base.createAgentEnabled ?? toolsConfig.createAgentEnabled;

  const enabledTools =
    base.enabledTools && base.enabledTools.length > 0
      ? base.enabledTools
      : buildEnabledTools({
          autoToolsEnabled,
          webSearchEnabled,
          createAgentEnabled,
          enabledKBIds,
          queryDataSources: toolsConfig.queryDataSources,
        });

  return {
    ...base,
    systemPrompt: buildSystemPrompt(base.systemPrompt, agentSnapshot),
    enabledTools,
    enabledConnections,
    enabledKBIds,
    autoToolsEnabled,
    webSearchEnabled,
    createAgentEnabled,
  };
};

const buildEnabledTools = ({
  autoToolsEnabled,
  webSearchEnabled,
  createAgentEnabled,
  enabledKBIds,
  queryDataSources,
}: {
  autoToolsEnabled?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
  enabledKBIds: string[];
  queryDataSources?: boolean;
}): string[] => {
  const enabledTools: string[] = [];
  const hasKBs = enabledKBIds.length > 0 && queryDataSources !== false;
  const auto = autoToolsEnabled ?? true;

  if (auto) {
    if (hasKBs) enabledTools.push('query_knowledge_base');
    enabledTools.push('web_search');
    if (createAgentEnabled) enabledTools.push('create_agent_tool');
  } else {
    if (hasKBs) enabledTools.push('query_knowledge_base');
    if (webSearchEnabled) enabledTools.push('web_search');
    if (createAgentEnabled) enabledTools.push('create_agent_tool');
  }

  return enabledTools;
};

const buildSystemPrompt = (
  basePrompt: string | undefined,
  agentSnapshot?: AgentSnapshot,
  scheduledRun?: boolean,
): string => {
  let prompt = (basePrompt ?? '').trim();
  if (scheduledRun) {
    const scheduledNotice =
      'This is a scheduled run. Do your best to complete the agent instructions with no further inputs.';
    if (!prompt.includes(scheduledNotice)) {
      if (prompt) prompt += '\n\n';
      prompt += scheduledNotice;
    }
  }
  const agentPrompt = agentSnapshot?.systemPrompt?.trim();
  const agentNotes = agentSnapshot?.userWelcomeMessage?.trim();

  if (agentPrompt && !prompt.includes(agentPrompt)) {
    if (prompt) prompt += '\n\n';
    prompt += `**Agent Instructions (${agentSnapshot?.title ?? 'Agent'}):**\n${agentPrompt}`;
  }

  if (agentNotes && !prompt.includes(agentNotes)) {
    if (prompt) prompt += '\n\n';
    prompt += `**Agent Notes:**\n${agentNotes}`;
  }

  return prompt;
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
