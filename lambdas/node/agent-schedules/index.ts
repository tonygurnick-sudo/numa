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
  estimateCronIntervalMinutes,
  type ScheduleRecord,
  type CreateSchedulePayload,
  type UpdateSchedulePayload,
  type EventTrigger,
} from '../../../lib/scheduling-schemas';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  deployPipedreamTrigger,
  updatePipedreamTriggerProps,
  setPipedreamTriggerActive,
  deletePipedreamTrigger,
  buildExternalUserId,
  PipedreamTriggerError,
  type PipedreamTrigger,
} from './pipedream-trigger-lifecycle';

const REGION = process.env.REGION ?? 'us-east-1';
const CLIENT_NAME = process.env.CLIENT_NAME ?? 'numa-client';
const TABLE_NAME = process.env.AGENT_SCHEDULES_TABLE_NAME ?? '';
const EXECUTION_ROLE_ARN = process.env.AGENT_SCHEDULE_EXECUTION_ROLE_ARN ?? '';
const RUNNER_ARN = process.env.AGENT_SCHEDULE_RUNNER_ARN ?? '';
// Pipedream-trigger lifecycle env vars. Both are required for trigger
// schedules; the rest of the lambda functions normally without them.
const PIPEDREAM_RELAY_LAMBDA_ARN = process.env.PIPEDREAM_RELAY_LAMBDA_ARN ?? '';
const PIPEDREAM_WEBHOOK_URL = process.env.PIPEDREAM_WEBHOOK_URL ?? '';

const SCHEDULING_SETTINGS_TABLE = process.env.SCHEDULING_SETTINGS_TABLE_NAME ?? '';
const PER_CLIENT_MIN = process.env.SCHEDULING_MIN_INTERVAL_MINUTES
  ? parseInt(process.env.SCHEDULING_MIN_INTERVAL_MINUTES, 10)
  : undefined;
const GLOBAL_MIN = process.env.GLOBAL_SCHEDULING_MIN_INTERVAL_MINUTES
  ? parseInt(process.env.GLOBAL_SCHEDULING_MIN_INTERVAL_MINUTES, 10)
  : undefined;
const PLATFORM_DEFAULT = 5;
const ARCANUM_FLOOR = PER_CLIENT_MIN ?? GLOBAL_MIN ?? PLATFORM_DEFAULT;

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

    if (method === 'GET' && idMatch) {
      const scheduleId = decodeURIComponent(idMatch[1]);
      const schedule = await getSchedule(auth.sub, scheduleId);
      if (!schedule) return respond(404, { error: 'Schedule not found' });
      return respond(200, schedule);
    }

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
    if (error instanceof PipedreamTriggerError) {
      // Surface clean Pipedream-trigger errors with their declared HTTP status
      // and a stable code field the frontend can branch on.
      return respond(error.httpStatus, { error: error.message, code: error.code });
    }
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    const statusCode = (error as { statusCode?: number }).statusCode ?? (message.startsWith('Invalid') ? 400 : 500);
    return respond(statusCode, { error: message });
  }
};

/**
 * Resolves the effective minimum scheduling interval by reading the client-admin
 * override from DynamoDB (Level 3) and combining with the Arcanum floor (Levels 1+2).
 */
const resolveEffectiveMinimum = async (): Promise<number> => {
  if (!SCHEDULING_SETTINGS_TABLE) return ARCANUM_FLOOR;
  try {
    const res = await dynamo.send(
      new GetCommand({ TableName: SCHEDULING_SETTINGS_TABLE, Key: { setting: 'scheduling' } })
    );
    const clientAdminMin = (res.Item as { minIntervalMinutes?: number } | undefined)?.minIntervalMinutes;
    if (clientAdminMin != null) {
      return Math.max(clientAdminMin, ARCANUM_FLOOR);
    }
  } catch (err) {
    console.warn('Failed to read scheduling settings, using Arcanum floor', err);
  }
  return ARCANUM_FLOOR;
};

/**
 * Validates that a cron expression does not schedule runs more frequently
 * than the effective minimum interval. Throws if too frequent.
 */
const validateCronInterval = async (cronExpression: string): Promise<void> => {
  const effectiveMin = await resolveEffectiveMinimum();

  const estimated = estimateCronIntervalMinutes(cronExpression);
  // null means we can't reliably estimate — deny when an override is active,
  // but allow when only the platform default applies (backwards-compatible)
  if (estimated === null) {
    if (effectiveMin > PLATFORM_DEFAULT) {
      throw Object.assign(
        new Error(
          `Cannot verify schedule interval against the minimum of ${effectiveMin} minutes. Use a simpler cron pattern or contact support.`
        ),
        { statusCode: 400 }
      );
    }
    return;
  }

  if (estimated < effectiveMin) {
    throw Object.assign(
      new Error(
        `Schedule interval too frequent. Minimum allowed is ${effectiveMin} minutes, but this schedule would run approximately every ${estimated} minutes.`
      ),
      { statusCode: 400 }
    );
  }
};

const listSchedules = async (userId: string): Promise<ScheduleRecord[]> => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'user_id = :u',
      ExpressionAttributeValues: {
        ':u': userId,
      },
    })
  );

  const items = (result.Items || []) as ScheduleRecord[];
  return items.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
};

const getSchedule = async (userId: string, scheduleId: string): Promise<ScheduleRecord | null> => {
  const result = await dynamo.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { user_id: userId, schedule_id: scheduleId },
    })
  );
  return (result.Item as ScheduleRecord) || null;
};

const getCalendarEvents = async (
  userId: string,
  startDate?: string,
  endDate?: string,
  eventTypes: string[] = ['agent', 'application', 'data_sync']
): Promise<ScheduleRecord[]> => {
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
  const isEventTrigger = validatedPayload.triggerType === 'event';

  // Enforce minimum scheduling interval (cron only)
  if (!isEventTrigger && validatedPayload.cronExpression) {
    await validateCronInterval(validatedPayload.cronExpression);
  }

  const scheduleId = uuidv4();
  const now = Date.now();
  const item: ScheduleRecord = {
    user_id: auth.sub,
    schedule_id: scheduleId,
    tenant_id: CLIENT_NAME,
    conversation_id: validatedPayload.conversationId,
    prompt_text: validatedPayload.promptText,
    trigger_type: validatedPayload.triggerType ?? 'cron',
    trigger: validatedPayload.trigger,
    cron_expression: isEventTrigger ? undefined : validatedPayload.cronExpression,
    timezone: isEventTrigger ? undefined : validatedPayload.timezone,
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
    // Persist user email(s) for email notifications (schedule runner has no JWT context)
    notification_email:
      validatedPayload.notificationEmail ?? (validatedPayload.emailNotifications ? auth.email : undefined),
    notification_emails: validatedPayload.notificationEmails,
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

  // Event-triggered schedules skip EventBridge Scheduler — they fire from connector-event-dispatcher
  if (isEventTrigger) {
    // Pipedream-backed event triggers: deploy the trigger via the relay,
    // persist the resulting dc_xxx + webhook_signing_key on the record. Gmail
    // event triggers are passive (Pub/Sub watches handled elsewhere) and
    // need no relay call.
    if (validatedRecord.trigger?.source === 'pipedream') {
      try {
        const deployed = await deployPipedreamTrigger({
          relayArn: PIPEDREAM_RELAY_LAMBDA_ARN,
          webhookUrl: PIPEDREAM_WEBHOOK_URL,
          externalUserId: buildExternalUserId(CLIENT_NAME, auth.sub),
          trigger: validatedRecord.trigger as PipedreamTrigger,
        });
        // Persist the deploy result back onto the record. The receiver lambda
        // looks up the schedule via the deployed-trigger-id-index GSI.
        const newTrigger = {
          ...validatedRecord.trigger,
          deployed_trigger_id: deployed.deployed_trigger_id,
          webhook_signing_key: deployed.webhook_signing_key,
        };
        await dynamo.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { user_id: auth.sub, schedule_id: scheduleId },
            UpdateExpression: 'SET #trigger = :trigger, deployed_trigger_id = :dc',
            ExpressionAttributeNames: { '#trigger': 'trigger' },
            ExpressionAttributeValues: {
              ':trigger': newTrigger,
              ':dc': deployed.deployed_trigger_id,
            },
          })
        );
        return {
          scheduleId,
          ...validatedRecord,
          trigger: newTrigger,
        };
      } catch (error) {
        console.error('Failed to deploy Pipedream trigger, rolling back schedule', error);
        await dynamo.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { user_id: auth.sub, schedule_id: scheduleId },
          })
        );
        if (error instanceof PipedreamTriggerError) throw error;
        throw new Error('Failed to deploy Pipedream trigger');
      }
    }
    return { scheduleId, ...validatedRecord };
  }

  try {
    await scheduler.send(
      new CreateScheduleCommand({
        Name: validatedRecord.schedule_name,
        GroupName: SCHEDULE_GROUP,
        Description:
          validatedPayload.label ||
          `Scheduled agent run for ${validatedPayload.agentTitle || validatedPayload.agentId}`,
        ScheduleExpression: validatedPayload.cronExpression!,
        ScheduleExpressionTimezone: validatedPayload.timezone!,
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

  const isEventTrigger = (validatedPayload.triggerType ?? record.trigger_type ?? 'cron') === 'event';

  // Enforce minimum scheduling interval when cron expression changes or schedule is reactivated
  const cronToValidate = isEventTrigger
    ? undefined
    : (validatedPayload.cronExpression ??
      (validatedPayload.status === 'active' && record.status === 'paused' ? record.cron_expression : undefined));
  if (cronToValidate) {
    await validateCronInterval(cronToValidate);
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
  if (validatedPayload.agentTitle !== undefined) {
    expressionNames['#agent_title'] = 'agent_title';
    expressionValues[':agent_title'] = validatedPayload.agentTitle;
    setParts.push('#agent_title = :agent_title');
  }
  if (validatedPayload.appTitle !== undefined) {
    expressionNames['#app_title'] = 'app_title';
    expressionValues[':app_title'] = validatedPayload.appTitle;
    setParts.push('#app_title = :app_title');
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
  // Persist notification email when email notifications are enabled
  if (validatedPayload.notificationEmail) {
    expressionNames['#notification_email'] = 'notification_email';
    expressionValues[':notification_email'] = validatedPayload.notificationEmail;
    setParts.push('#notification_email = :notification_email');
  } else if (validatedPayload.emailNotifications && auth.email) {
    // Auto-populate from JWT when toggling on and no explicit email provided
    expressionNames['#notification_email'] = 'notification_email';
    expressionValues[':notification_email'] = auth.email;
    setParts.push('#notification_email = if_not_exists(#notification_email, :notification_email)');
  }
  if (validatedPayload.notificationEmails !== undefined) {
    expressionNames['#notification_emails'] = 'notification_emails';
    expressionValues[':notification_emails'] = validatedPayload.notificationEmails;
    setParts.push('#notification_emails = :notification_emails');
  }
  // Persist trigger field updates for event triggers. CRITICAL: the wizard
  // payload only contains user-editable fields (app_slug, component_id,
  // configured_props, configured_prop_labels). Server-set lifecycle fields
  // (deployed_trigger_id, webhook_signing_key) live on the existing record
  // — we MUST merge them onto the new trigger before writing, otherwise
  // every props edit silently wipes the signing key and the receiver
  // starts orphaning all subsequent webhook deliveries with no way to
  // recover (Pipedream doesn't expose the key after deploy).
  if (validatedPayload.trigger !== undefined) {
    expressionNames['#trigger'] = 'trigger';
    let nextTrigger: EventTrigger = validatedPayload.trigger;
    if (validatedPayload.trigger.source === 'pipedream' && record.trigger?.source === 'pipedream') {
      const existingPipedream = record.trigger as PipedreamTrigger;
      nextTrigger = {
        ...validatedPayload.trigger,
        ...(existingPipedream.deployed_trigger_id
          ? { deployed_trigger_id: existingPipedream.deployed_trigger_id }
          : {}),
        ...(existingPipedream.webhook_signing_key
          ? { webhook_signing_key: existingPipedream.webhook_signing_key }
          : {}),
      };
    }
    expressionValues[':trigger'] = nextTrigger;
    setParts.push('#trigger = :trigger');
  }
  // Persist trigger_type changes and clean up stale fields
  if (validatedPayload.triggerType !== undefined) {
    expressionNames['#trigger_type'] = 'trigger_type';
    expressionValues[':trigger_type'] = validatedPayload.triggerType;
    setParts.push('#trigger_type = :trigger_type');
    // Clean up fields that don't apply to the new trigger type. `timezone`
    // is a DynamoDB reserved keyword (Glue/Athena heritage) so it MUST be
    // referenced via ExpressionAttributeNames in REMOVE expressions —
    // unaliased usage 400s with a ValidationException at runtime.
    if (validatedPayload.triggerType === 'event') {
      expressionNames['#timezone'] = 'timezone';
      removeParts.push('cron_expression', '#timezone');
    } else if (validatedPayload.triggerType === 'cron') {
      expressionNames['#trigger_field'] = 'trigger';
      removeParts.push('#trigger_field');
    }
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

  if (isEventTrigger) {
    // Event-triggered schedules have no EventBridge entry. Pipedream-backed
    // ones do need their lifecycle synced with Pipedream though:
    //   - status change → relay update_deployed_trigger(active=true|false)
    //   - configured_props change → relay update_deployed_trigger(configured_props=...)
    // Both preserve dc_xxx and webhook_signing_key (verified empirically).
    const triggerSource = (validatedPayload.trigger?.source as string | undefined) ?? record.trigger?.source ?? 'gmail';
    // record.trigger is a discriminated union (gmail | pipedream); the
    // pipedream branch is the only one carrying deployed_trigger_id. Cast
    // narrowly to avoid threading a TS type-guard through every caller.
    const recordPipedreamTrigger =
      record.trigger?.source === 'pipedream' ? (record.trigger as PipedreamTrigger) : undefined;
    const deployedTriggerId = recordPipedreamTrigger?.deployed_trigger_id;
    if (triggerSource === 'pipedream' && deployedTriggerId) {
      const externalUserId = buildExternalUserId(CLIENT_NAME, auth.sub);

      // Pause/resume mirror to Pipedream
      if (validatedPayload.status === 'paused' && record.status !== 'paused') {
        await setPipedreamTriggerActive({
          relayArn: PIPEDREAM_RELAY_LAMBDA_ARN,
          externalUserId,
          deployedTriggerId,
          active: false,
        });
      } else if (validatedPayload.status === 'active' && record.status === 'paused') {
        await setPipedreamTriggerActive({
          relayArn: PIPEDREAM_RELAY_LAMBDA_ARN,
          externalUserId,
          deployedTriggerId,
          active: true,
        });
      }

      // Props update mirror
      if (validatedPayload.trigger && validatedPayload.trigger.source === 'pipedream') {
        await updatePipedreamTriggerProps({
          relayArn: PIPEDREAM_RELAY_LAMBDA_ARN,
          externalUserId,
          deployedTriggerId,
          trigger: validatedPayload.trigger as PipedreamTrigger,
        });
      }
    }
    return updatedRecord.Attributes;
  }

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

  if ((record.trigger_type ?? 'cron') !== 'event') {
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
  } else if (record.trigger?.source === 'pipedream') {
    // Pipedream-trigger event schedule: delete the deployed trigger before
    // soft-deleting the record so we don't leave an orphan firing into a
    // schedule that the receiver will then drop. The proxy treats
    // Pipedream-side 404 as success, so this is safe to retry on transient
    // failure (we still soft-delete the record below regardless).
    //
    // Fallback to the top-level `deployed_trigger_id` attribute (which feeds
    // the GSI and was preserved across the now-fixed update wipe-bug) if
    // the in-trigger copy is missing. Records created/edited before that
    // fix shipped won't have the in-trigger copy.
    const pipedreamTrigger = record.trigger as PipedreamTrigger;
    const dcId =
      pipedreamTrigger.deployed_trigger_id ??
      (typeof (record as { deployed_trigger_id?: unknown }).deployed_trigger_id === 'string'
        ? (record as { deployed_trigger_id: string }).deployed_trigger_id
        : undefined);
    if (dcId) {
      try {
        await deletePipedreamTrigger({
          relayArn: PIPEDREAM_RELAY_LAMBDA_ARN,
          externalUserId: buildExternalUserId(CLIENT_NAME, auth.sub),
          deployedTriggerId: dcId,
        });
      } catch (err) {
        console.warn(
          'Failed to delete Pipedream trigger; proceeding with schedule soft-delete. ' +
            'A reconciliation worker will catch the orphan on next sweep.',
          err
        );
      }
    }
  }

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
