import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { withPRM } from '../../../lib/prm-node/prm';
import { v4 as uuidv4 } from 'uuid';

const REGION = process.env.REGION ?? 'us-east-1';
const CLIENT_NAME = process.env.CLIENT_NAME ?? 'numa-client';
const SCHEDULES_TABLE = process.env.AGENT_SCHEDULES_TABLE_NAME ?? '';
const SCHEDULE_RUNNER_SECRET = process.env.SCHEDULE_RUNNER_SECRET ?? '';
const OUTPUTS_BUCKET = process.env.OUTPUTS_BUCKET_NAME ?? '';

const dynamo = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, { region: REGION }), {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

const stepFunctions = withPRM(SFNClient, { region: REGION });

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

type ApplicationScheduleRecord = {
  user_id: string;
  schedule_id: string;
  event_type: 'application';
  app_id: string;
  app_title?: string;
  status: 'active' | 'paused' | 'deleted';
  input_config: Record<string, unknown>;
  label?: string;
  last_status?: string;
  last_error?: string;
  last_run_epoch?: number;
  created_at: number;
  updated_at: number;
};

type RunnerEvent = {
  type?: string;
  scheduleId?: string;
  tenantId?: string;
};

const isApiEvent = (event: unknown): event is APIGatewayProxyEventV2 =>
  Boolean((event as APIGatewayProxyEventV2)?.requestContext?.http && isRequestMethodString(event));

const isRequestMethodString = (event: unknown): boolean =>
  typeof (event as APIGatewayProxyEventV2)?.requestContext?.http?.method === 'string';

const parseAuthContext = (event: APIGatewayProxyEventV2): AuthContext | null => {
  const requestContext = event.requestContext as unknown as {
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
  const claims = requestContext?.authorizer?.jwt?.claims || {};
  const sub = typeof claims.sub === 'string' ? claims.sub : undefined;
  if (!sub) return null;
  const email = typeof claims.email === 'string' ? claims.email : undefined;
  const name = typeof claims.name === 'string' ? claims.name : undefined;
  const groups = Array.isArray(claims['cognito:groups'])
    ? (claims['cognito:groups'] as string[])
    : typeof claims['cognito:groups'] === 'string'
      ? [claims['cognito:groups'] as string]
      : [];
  return { sub, email, name, groups };
};

const respond = (statusCode: number, payload: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(payload),
});

const ensureConfigured = (): boolean => Boolean(SCHEDULES_TABLE && SCHEDULE_RUNNER_SECRET && OUTPUTS_BUCKET);

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
    return respond(500, { error: 'Application scheduling not configured' });
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
      appId?: string;
      inputConfig?: Record<string, unknown>;
    };

    let schedule: ApplicationScheduleRecord | null = null;

    if (body.scheduleId) {
      schedule = await getSchedule(body.scheduleId);
      if (!schedule || schedule.user_id !== auth.sub) {
        return respond(404, { error: 'Schedule not found' });
      }
    } else {
      return respond(400, { error: 'scheduleId required for ad-hoc application runs' });
    }

    const result = await executeApplicationRun({
      schedule,
      auth,
      adHoc: !body.scheduleId,
    });

    return respond(200, result);
  } catch (error) {
    console.error('Application schedule runner API error', error);
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
    console.error('Application schedule runner missing configuration, skipping');
    return;
  }
  try {
    const event = parseRunnerEvent(rawEvent);
    if (!event?.scheduleId) {
      throw new Error('Missing scheduleId for scheduled application run');
    }
    const schedule = await getSchedule(event.scheduleId);
    if (!schedule) {
      console.warn('Application schedule not found for scheduled run', event.scheduleId);
      return;
    }
    if (schedule.status !== 'active') {
      console.info('Skipping application schedule because status is not active', schedule.schedule_id, schedule.status);
      return;
    }
    await executeApplicationRun({
      schedule,
      auth: { sub: schedule.user_id, email: undefined, name: undefined, groups: [] },
      adHoc: false,
      triggeredBySchedule: true,
    });
  } catch (error) {
    console.error('Scheduled application run failed', error);
  }
};

const getSchedule = async (scheduleId: string): Promise<ApplicationScheduleRecord | null> => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: SCHEDULES_TABLE,
      IndexName: 'schedule-id-index',
      KeyConditionExpression: 'schedule_id = :s',
      FilterExpression: 'event_type = :event_type',
      ExpressionAttributeValues: {
        ':s': scheduleId,
        ':event_type': 'application',
      },
      Limit: 1,
    }),
  );
  const record = (result.Items || [])[0] as ApplicationScheduleRecord | undefined;
  return record || null;
};

type ExecuteApplicationRunParams = {
  schedule: ApplicationScheduleRecord;
  auth: AuthContext;
  adHoc: boolean;
  triggeredBySchedule?: boolean;
};

const executeApplicationRun = async ({
  schedule,
  adHoc,
  triggeredBySchedule,
}: ExecuteApplicationRunParams): Promise<{
  runId: string;
  executionArn: string;
  appId: string;
  appTitle: string | undefined;
  triggeredBySchedule: boolean;
  status: string;
}> => {
  if (!schedule.app_id) throw new Error('Invalid app ID');
  if (!schedule.input_config) throw new Error('Input configuration missing');

  const runId = uuidv4();
  const executionName = `${CLIENT_NAME}-${schedule.app_id}-${runId}`;

  // Determine Step Function ARN based on app ID
  // This would need to be configured based on available Numa Apps
  const stepFunctionArn = getStepFunctionArnForApp(schedule.app_id);

  if (!stepFunctionArn) {
    const error = `No Step Function configured for app: ${schedule.app_id}`;
    if (!adHoc) {
      await markScheduleStatus(schedule.user_id, schedule.schedule_id, 'failed', error);
    }
    throw new Error(error);
  }

  let executionArn: string;
  try {
    // Start Step Function execution
    const response = await stepFunctions.send(
      new StartExecutionCommand({
        stateMachineArn: stepFunctionArn,
        name: executionName,
        input: JSON.stringify({
          ...schedule.input_config,
          userId: schedule.user_id,
          runId,
          scheduledRun: Boolean(triggeredBySchedule),
          outputsBucket: OUTPUTS_BUCKET,
          appId: schedule.app_id,
          tenantId: CLIENT_NAME,
        }),
      }),
    );

    executionArn = response.executionArn!;
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Step Function start failed';
    if (!adHoc) {
      await markScheduleStatus(schedule.user_id, schedule.schedule_id, 'failed', error);
    }
    throw err instanceof Error ? err : new Error('Step Function start failed');
  }

  try {
    if (!adHoc) {
      await markScheduleStatus(schedule.user_id, schedule.schedule_id, 'running', null);
    }
  } catch (err) {
    console.error('Failed to update schedule status to running', err);
  }

  return {
    runId,
    executionArn,
    appId: schedule.app_id,
    appTitle: schedule.app_title,
    triggeredBySchedule: Boolean(triggeredBySchedule),
    status: 'started',
  };
};

const markScheduleStatus = async (
  userId: string,
  scheduleId: string,
  status: string,
  error: string | null,
): Promise<void> => {
  await dynamo.send(
    new UpdateCommand({
      TableName: SCHEDULES_TABLE,
      Key: { user_id: userId, schedule_id: scheduleId },
      UpdateExpression: 'SET last_run_epoch = :ts, last_status = :status, last_error = :err',
      ExpressionAttributeValues: {
        ':ts': Date.now(),
        ':status': status,
        ':err': error,
      },
    }),
  );
};

// Map app IDs to their corresponding Step Function ARNs
// This would be populated based on the available Numa Apps in the deployment
const getStepFunctionArnForApp = (appId: string): string | null => {
  const APP_STEP_FUNCTION_MAP: Record<string, string> = {
    'document-summariser': `arn:aws:states:${REGION}:${process.env.AWS_ACCOUNT_ID || ''}:stateMachine:${CLIENT_NAME}-document-summariser`,
    'policy-builder': `arn:aws:states:${REGION}:${process.env.AWS_ACCOUNT_ID || ''}:stateMachine:${CLIENT_NAME}-policy-builder`,
    'candidate-screening': `arn:aws:states:${REGION}:${process.env.AWS_ACCOUNT_ID || ''}:stateMachine:${CLIENT_NAME}-candidate-screening`,
    'financial-analysis': `arn:aws:states:${REGION}:${process.env.AWS_ACCOUNT_ID || ''}:stateMachine:${CLIENT_NAME}-financial-analysis`,
    // Add more apps as they become available
  };

  return APP_STEP_FUNCTION_MAP[appId] || null;
};
