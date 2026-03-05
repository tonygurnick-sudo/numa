import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { v4 as uuidv4 } from 'uuid';
import { withPRM } from '../../../lib/prm-node/prm';
import {
  validateCreatePayload,
  validateUpdatePayload,
  validateScheduleRecord,
  type ScheduleRecord,
  type CreateSchedulePayload,
  type UpdateSchedulePayload,
} from '../../../lib/scheduling-schemas';

const REGION = process.env.REGION ?? 'us-east-1';
const CLIENT_NAME = process.env.CLIENT_NAME ?? 'numa-client';
const TABLE_NAME = process.env.AGENT_SCHEDULES_TABLE_NAME ?? '';
const EXECUTION_ROLE_ARN = process.env.AGENT_SCHEDULE_EXECUTION_ROLE_ARN ?? '';
const RUNNER_ARN = process.env.AGENT_SCHEDULE_RUNNER_ARN ?? '';

if (!TABLE_NAME || !EXECUTION_ROLE_ARN || !RUNNER_ARN) {
  console.warn('Agent schedules lambda missing required environment variables');
}

const SCHEDULE_GROUP = `${CLIENT_NAME}-agent-schedules`;

const dynamo = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, { region: REGION }), {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
const scheduler = withPRM(SchedulerClient, { region: REGION });

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

type AuthContext = {
  sub: string;
  email?: string;
  name?: string;
  groups: string[];
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
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader) return null;
  const token = String(authHeader).replace(/^Bearer\s+/i, '');
  const payload = parseJwt(token);
  const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
  if (!sub) return null;
  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const name = typeof payload.name === 'string' ? payload.name : undefined;
  const groups = Array.isArray(payload['cognito:groups'])
    ? (payload['cognito:groups'] as unknown[]).filter((g): g is string => typeof g === 'string')
    : [];
  return { sub, email, name, groups };
};

const scheduleName = (scheduleId: string): string => `${CLIENT_NAME}-${scheduleId}`;

const respond = (
  statusCode: number,
  payload: unknown
): { statusCode: number; headers: Record<string, string>; body: string } => ({
  statusCode,
  headers: HEADERS,
  body: payload !== undefined ? JSON.stringify(payload) : '',
});

const ensureConfigured = (): boolean => Boolean(TABLE_NAME && EXECUTION_ROLE_ARN && RUNNER_ARN);

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return respond(200, null);
  }

  if (!ensureConfigured()) {
    return respond(500, { error: 'Agent scheduling not configured' });
  }

  const auth = parseAuthContext(event);
  if (!auth) {
    return respond(401, { error: 'Unauthorized' });
  }

  try {
    const method = event.requestContext?.http?.method ?? 'GET';
    const path = event.requestContext?.http?.path ?? '';

    if (method === 'GET' && /\/agent-schedules\/?$/.test(path)) {
      const list = await listSchedules(auth.sub);
      return respond(200, { schedules: list });
    }

    if (method === 'GET' && /\/agent-schedules\/calendar\/?$/.test(path)) {
      const queryParams = event.queryStringParameters || {};
      const startDate = queryParams.startDate;
      const endDate = queryParams.endDate;
      const eventTypes = queryParams.eventTypes?.split(',') || ['agent', 'application', 'data_sync'];

      const calendarEvents = await getCalendarEvents(auth.sub, startDate, endDate, eventTypes);
      return respond(200, { events: calendarEvents });
    }

    if (method === 'POST' && /\/agent-schedules\/?$/.test(path)) {
      const body = JSON.parse(event.body || '{}') as CreateSchedulePayload;
      const created = await createSchedule(auth, body);
      return respond(201, created);
    }

    const idMatch = path.match(/\/agent-schedules\/([^/]+)$/);
    if (method === 'DELETE' && idMatch) {
      await deleteSchedule(auth, decodeURIComponent(idMatch[1]));
      return respond(200, { ok: true });
    }

    if (method === 'PUT' && idMatch) {
      const body = JSON.parse(event.body || '{}') as UpdateSchedulePayload;
      const updated = await updateSchedule(auth, decodeURIComponent(idMatch[1]), body);
      return respond(200, updated);
    }

    return respond(404, { error: 'Not found' });
  } catch (error) {
    console.error('agent-schedules error', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return respond(message.startsWith('Invalid') ? 400 : 500, { error: message });
  }
};

const listSchedules = async (userId: string): Promise<ScheduleRecord[]> => {
  console.log('AGENT_SCHEDULES DEBUG: Querying with userId:', userId);
  console.log('AGENT_SCHEDULES DEBUG: Table name:', TABLE_NAME);

  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'user_id = :u',
      ExpressionAttributeValues: {
        ':u': userId,
      },
    })
  );

  console.log('AGENT_SCHEDULES DEBUG: DynamoDB query result:', {
    Count: result.Count,
    Items: result.Items?.length || 0,
    FirstItem: result.Items?.[0]
      ? {
          user_id: result.Items[0].user_id,
          schedule_id: result.Items[0].schedule_id,
          agent_title: result.Items[0].agent_title,
        }
      : null,
  });

  const items = (result.Items || []) as ScheduleRecord[];
  return items.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
};

const getCalendarEvents = async (
  userId: string,
  startDate?: string,
  endDate?: string,
  eventTypes: string[] = ['agent', 'application', 'data_sync']
): Promise<ScheduleRecord[]> => {
  console.log('CALENDAR_EVENTS DEBUG: Querying with userId:', userId);
  console.log('CALENDAR_EVENTS DEBUG: Table name:', TABLE_NAME);

  // First get all schedules for the user
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'user_id = :u',
      FilterExpression: '#status <> :deleted',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':u': userId,
        ':deleted': 'deleted',
      },
    })
  );

  console.log('CALENDAR_EVENTS DEBUG: DynamoDB query result:', {
    Count: result.Count,
    Items: result.Items?.length || 0,
    FirstItem: result.Items?.[0]
      ? {
          user_id: result.Items[0].user_id,
          schedule_id: result.Items[0].schedule_id,
          agent_title: result.Items[0].agent_title,
        }
      : null,
  });

  let items = (result.Items || []) as ScheduleRecord[];

  // Filter by event types (default to 'agent' if event_type is not set for backward compatibility)
  items = items.filter((item) => {
    const eventType = item.event_type || 'agent';
    return eventTypes.includes(eventType);
  });

  // TODO: For future enhancement - filter by date range using cron expression calculations
  // For now, return all active schedules filtered by event type
  // Calendar date filtering will be handled on the frontend based on cron expressions

  return items.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
};

const createSchedule = async (
  auth: AuthContext,
  payload: CreateSchedulePayload
): Promise<{ scheduleId: string } & ScheduleRecord> => {
  // Validate payload with Zod
  const validatedPayload = validateCreatePayload(payload);

  const scheduleId = uuidv4();
  const now = Date.now();
  const item: ScheduleRecord = {
    user_id: auth.sub,
    schedule_id: scheduleId,
    tenant_id: CLIENT_NAME,
    conversation_id: validatedPayload.conversationId,
    prompt_text: validatedPayload.promptText,
    cron_expression: validatedPayload.cronExpression,
    timezone: validatedPayload.timezone,
    status: 'active',
    event_type: validatedPayload.eventType ?? 'agent',
    agent_id: validatedPayload.agentId,
    agent_title: validatedPayload.agentTitle,
    agent_snapshot: validatedPayload.agentSnapshot,
    run_config: validatedPayload.runConfig,
    label: validatedPayload.label,
    max_runs: validatedPayload.maxRuns,
    total_runs: 0,
    email_notifications: validatedPayload.emailNotifications ?? false,
    created_at: now,
    updated_at: now,
    schedule_name: scheduleName(scheduleId),
  };

  // Validate the complete record before saving
  const validatedRecord = validateScheduleRecord(item);

  await dynamo.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: validatedRecord,
      ConditionExpression: 'attribute_not_exists(user_id) AND attribute_not_exists(schedule_id)',
    })
  );

  try {
    await scheduler.send(
      new CreateScheduleCommand({
        Name: validatedRecord.schedule_name,
        GroupName: SCHEDULE_GROUP,
        Description:
          validatedPayload.label ||
          `Scheduled agent run for ${validatedPayload.agentTitle || validatedPayload.agentId}`,
        ScheduleExpression: validatedPayload.cronExpression,
        ScheduleExpressionTimezone: validatedPayload.timezone,
        FlexibleTimeWindow: { Mode: 'OFF' },
        Target: {
          Arn: RUNNER_ARN,
          RoleArn: EXECUTION_ROLE_ARN,
          Input: JSON.stringify({
            type: 'SCHEDULE',
            scheduleId,
            tenantId: CLIENT_NAME,
          }),
        },
      })
    );
  } catch (error) {
    console.error('Failed to create scheduler entry, rolling back', error);
    await dynamo.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          user_id: auth.sub,
          schedule_id: scheduleId,
        },
      })
    );
    throw new Error('Failed to register schedule');
  }

  return { scheduleId, ...validatedRecord };
};

const updateSchedule = async (
  auth: AuthContext,
  scheduleId: string,
  payload: UpdateSchedulePayload
): Promise<Record<string, unknown> | undefined> => {
  const validatedPayload = validateUpdatePayload(payload);
  const hasUpdates = Object.keys(validatedPayload).length > 0;
  if (!hasUpdates) {
    throw new Error('No updates provided');
  }

  const existing = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'user_id = :u AND schedule_id = :s',
      ExpressionAttributeValues: {
        ':u': auth.sub,
        ':s': scheduleId,
      },
    })
  );

  const record = (existing.Items || [])[0] as ScheduleRecord | undefined;
  if (!record || record.status === 'deleted') {
    throw new Error('Schedule not found');
  }

  const expressionNames: Record<string, string> = {};
  const expressionValues: Record<string, unknown> = {
    ':ts': Date.now(),
  };
  const setParts: string[] = ['updated_at = :ts'];
  const removeParts: string[] = [];

  if (validatedPayload.status) {
    expressionNames['#status'] = 'status';
    expressionValues[':status'] = validatedPayload.status;
    setParts.push('#status = :status');
  }
  if (validatedPayload.promptText !== undefined) {
    expressionNames['#prompt_text'] = 'prompt_text';
    expressionValues[':prompt_text'] = validatedPayload.promptText;
    setParts.push('#prompt_text = :prompt_text');
  }
  if (validatedPayload.cronExpression) {
    expressionNames['#cron_expression'] = 'cron_expression';
    expressionValues[':cron_expression'] = validatedPayload.cronExpression;
    setParts.push('#cron_expression = :cron_expression');
  }
  if (validatedPayload.timezone) {
    expressionNames['#timezone'] = 'timezone';
    expressionValues[':timezone'] = validatedPayload.timezone;
    setParts.push('#timezone = :timezone');
  }
  if (validatedPayload.label !== undefined) {
    expressionNames['#label'] = 'label';
    expressionValues[':label'] = validatedPayload.label;
    setParts.push('#label = :label');
  }
  if (validatedPayload.runConfig !== undefined) {
    expressionNames['#run_config'] = 'run_config';
    expressionValues[':run_config'] = validatedPayload.runConfig;
    setParts.push('#run_config = :run_config');
  }
  if (validatedPayload.agentSnapshot !== undefined) {
    expressionNames['#agent_snapshot'] = 'agent_snapshot';
    expressionValues[':agent_snapshot'] = validatedPayload.agentSnapshot;
    setParts.push('#agent_snapshot = :agent_snapshot');
  }
  if (validatedPayload.maxRuns !== undefined) {
    expressionNames['#max_runs'] = 'max_runs';
    if (validatedPayload.maxRuns === null) {
      // Clearing maxRuns removes the limit — REMOVE the attribute
      removeParts.push('#max_runs');
    } else {
      expressionValues[':max_runs'] = validatedPayload.maxRuns;
      setParts.push('#max_runs = :max_runs');
    }
  }
  if (validatedPayload.emailNotifications !== undefined) {
    expressionNames['#email_notifications'] = 'email_notifications';
    expressionValues[':email_notifications'] = validatedPayload.emailNotifications;
    setParts.push('#email_notifications = :email_notifications');
  }

  const updatedRecord = await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        user_id: auth.sub,
        schedule_id: scheduleId,
      },
      UpdateExpression: `SET ${setParts.join(', ')}${removeParts.length > 0 ? ` REMOVE ${removeParts.join(', ')}` : ''}`,
      ExpressionAttributeNames: expressionNames,
      ...(Object.keys(expressionValues).length > 0 ? { ExpressionAttributeValues: expressionValues } : {}),
      ReturnValues: 'ALL_NEW',
    })
  );

  const updatedStatus = validatedPayload.status ?? record.status;
  const updatedCron = validatedPayload.cronExpression ?? record.cron_expression;
  const updatedTimezone = validatedPayload.timezone ?? record.timezone;
  const updatedLabel = validatedPayload.label ?? record.label;
  const scheduleName = `${CLIENT_NAME}-${scheduleId}`;
  const description = updatedLabel || `Scheduled agent run for ${record.agent_title || record.agent_id}`;
  const hasScheduleChanges = Boolean(
    validatedPayload.cronExpression || validatedPayload.timezone || validatedPayload.label
  );

  if (updatedStatus === 'paused' || updatedStatus === 'deleted') {
    try {
      await scheduler.send(
        new DeleteScheduleCommand({
          Name: scheduleName,
          GroupName: SCHEDULE_GROUP,
        })
      );
    } catch (err) {
      console.warn('Failed to delete EventBridge schedule', err);
    }
  } else if (updatedStatus === 'active') {
    const target = {
      Arn: RUNNER_ARN,
      RoleArn: EXECUTION_ROLE_ARN,
      Input: JSON.stringify({
        type: 'SCHEDULE',
        scheduleId,
        tenantId: CLIENT_NAME,
      }),
    };

    try {
      if (record.status === 'paused') {
        await scheduler.send(
          new CreateScheduleCommand({
            Name: scheduleName,
            GroupName: SCHEDULE_GROUP,
            Description: description,
            ScheduleExpression: updatedCron,
            ScheduleExpressionTimezone: updatedTimezone,
            FlexibleTimeWindow: { Mode: 'OFF' },
            Target: target,
          })
        );
      } else if (hasScheduleChanges) {
        await scheduler.send(
          new UpdateScheduleCommand({
            Name: scheduleName,
            GroupName: SCHEDULE_GROUP,
            Description: description,
            ScheduleExpression: updatedCron,
            ScheduleExpressionTimezone: updatedTimezone,
            FlexibleTimeWindow: { Mode: 'OFF' },
            Target: target,
          })
        );
      }
    } catch (err) {
      console.error('Failed to update EventBridge schedule', err);
      throw new Error('Failed to update schedule');
    }
  }

  return updatedRecord.Attributes;
};

const deleteSchedule = async (auth: AuthContext, scheduleId: string): Promise<void> => {
  const existing = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'user_id = :u AND schedule_id = :s',
      ExpressionAttributeValues: {
        ':u': auth.sub,
        ':s': scheduleId,
      },
    })
  );

  const record = (existing.Items || [])[0] as ScheduleRecord | undefined;
  if (!record || record.status === 'deleted') {
    throw new Error('Schedule not found');
  }

  await scheduler
    .send(
      new DeleteScheduleCommand({
        Name: record.schedule_name,
        GroupName: SCHEDULE_GROUP,
      })
    )
    .catch((err) => {
      console.warn('Failed to delete scheduler entry', err);
    });

  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        user_id: auth.sub,
        schedule_id: scheduleId,
      },
      UpdateExpression: 'SET #status = :deleted, updated_at = :ts',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':deleted': 'deleted',
        ':ts': Date.now(),
      },
    })
  );
};
