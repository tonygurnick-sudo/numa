import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
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
import {
  deployPipedreamTrigger,
  updatePipedreamTriggerProps,
  setPipedreamTriggerActive,
  deletePipedreamTrigger,
  buildExternalUserId,
  PipedreamTriggerError,
  type PipedreamTrigger,
} from './pipedream-trigger-lifecycle';
import {
  parseQuotasFromEnv,
  parseQuotasFromSettingsItem,
  resolveEffectiveQuotas,
  projectMonthlyRuns,
  checkQuotas,
  aggregateTriggerLoad,
  projectMonthlyTriggerRuns,
  daysSinceFirstActivity,
  checkTriggerQuotas,
  currentMonthKey,
  TRIGGER_WARNING_THRESHOLD_PERCENT,
  type LoadCalculationRecord,
  type ScheduleQuotas,
  type QuotaViolation,
  type TriggerCalculationRecord,
} from '../../../lib/schedule-load';

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
const EMAIL_SENDER_LAMBDA_ARN = process.env.EMAIL_SENDER_LAMBDA_ARN ?? '';
const USER_POOL_ID = process.env.USER_POOL_ID ?? '';

/**
 * EventBridge Scheduler DLQ. When a scheduled invocation fails (and the
 * runner now propagates real errors instead of swallowing — see
 * `agent-schedule-runner/handleSchedulerEvent`), Scheduler retries per
 * `SCHEDULER_RETRY_POLICY` then drops the message into this SQS queue.
 * Same queue the runner Lambda's async-invocation DLQ targets so the
 * existing CloudWatch alarm covers both invocation paths.
 */
const SCHEDULER_DLQ_ARN = process.env.AGENT_SCHEDULE_DLQ_ARN ?? '';

/**
 * Standard RetryPolicy + DeadLetterConfig applied to every EB Scheduler
 * target we create. 3 retries with the default 24h max event age is
 * enough for transient blips without burning quota; failures past that
 * land in the DLQ for investigation.
 */
const SCHEDULER_RETRY_POLICY = {
  MaximumRetryAttempts: 3,
  MaximumEventAgeInSeconds: 86_400,
};

const buildSchedulerTarget = (input: {
  scheduleId: string;
}): {
  Arn: string;
  RoleArn: string;
  Input: string;
  RetryPolicy: typeof SCHEDULER_RETRY_POLICY;
  DeadLetterConfig?: { Arn: string };
} => ({
  Arn: RUNNER_ARN,
  RoleArn: EXECUTION_ROLE_ARN,
  Input: JSON.stringify({
    type: 'SCHEDULE',
    scheduleId: input.scheduleId,
    tenantId: CLIENT_NAME,
  }),
  RetryPolicy: SCHEDULER_RETRY_POLICY,
  ...(SCHEDULER_DLQ_ARN ? { DeadLetterConfig: { Arn: SCHEDULER_DLQ_ARN } } : {}),
});

/**
 * Level-2 (per-client) quota overrides resolved from env vars at cold start.
 * Backed by SCHEDULING_MIN_INTERVAL_MINUTES (legacy) and the new
 * SCHEDULE_QUOTA_* family — see lib/schedule-load.ts:parseQuotasFromEnv.
 */
const LEVEL_2_QUOTAS = parseQuotasFromEnv(process.env);

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
// Email-sender lambda lives in the deployer account in us-east-1 — fixed
// region regardless of where the client stack runs.
const emailLambdaClient = withPRM(LambdaClient, { region: 'us-east-1' });
const cognitoClient = withPRM(CognitoIdentityProviderClient, { region: REGION });

/**
 * Resolve a user's email from Cognito by sub. Returns undefined if the
 * lookup fails — the caller should fall through to a no-email branch.
 */
const resolveUserEmail = async (userSub: string): Promise<string | undefined> => {
  if (!USER_POOL_ID) return undefined;
  try {
    const resp = await cognitoClient.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userSub }));
    return resp.UserAttributes?.find((a) => a.Name === 'email')?.Value;
  } catch (err) {
    console.warn('Failed to resolve user email from Cognito', { userSub, error: err });
    return undefined;
  }
};

/**
 * Generate a presigned STS GetCallerIdentity URL — cross-account identity
 * proof for the centralized email-sender lambda. Mirrors the pattern in
 * `agent-schedule-runner` (see that file for the rationale).
 */
const generateStsProofUrl = async (expiresIn = 60): Promise<string> => {
  const { SignatureV4 } = await import('@smithy/signature-v4');
  const { Sha256 } = await import('@aws-crypto/sha256-js');
  const { defaultProvider } = await import('@aws-sdk/credential-provider-node');
  const { HttpRequest } = await import('@smithy/protocol-http');

  const signer = new SignatureV4({
    service: 'sts',
    region: 'us-east-1',
    credentials: defaultProvider(),
    sha256: Sha256,
  });
  const request = new HttpRequest({
    method: 'GET',
    protocol: 'https:',
    hostname: 'sts.us-east-1.amazonaws.com',
    path: '/',
    query: { Action: 'GetCallerIdentity', Version: '2011-06-15' },
    headers: { host: 'sts.us-east-1.amazonaws.com' },
  });
  const signed = await signer.presign(request, { expiresIn });
  const queryString = Object.entries(signed.query ?? {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `https://${signed.hostname}${signed.path}?${queryString}`;
};

/**
 * Fire-and-forget invocation of the centralized email-sender lambda.
 * Failures are logged but never block the caller.
 */
const sendEmail = async (params: {
  to: string;
  template: string;
  templateData: Record<string, string>;
}): Promise<void> => {
  if (!EMAIL_SENDER_LAMBDA_ARN) return;
  try {
    const stsProofUrl = await generateStsProofUrl();
    await emailLambdaClient.send(
      new InvokeCommand({
        FunctionName: EMAIL_SENDER_LAMBDA_ARN,
        InvocationType: 'Event',
        Payload: new TextEncoder().encode(
          JSON.stringify({
            sts_proof_url: stsProofUrl,
            client_name: CLIENT_NAME,
            to: [params.to],
            template: params.template,
            template_data: params.templateData,
          })
        ),
      })
    );
    console.info('[EMAIL_DISPATCH] Sent', { template: params.template, to: params.to });
  } catch (err) {
    console.error('Email send failed (non-blocking)', err);
  }
};

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
      // Optional ?agentId=... filter — backed by the agent-id-index GSI so we
      // don't fetch all-then-filter on the client. Owner-scoped: results are
      // intersected with the caller's user_id (existing semantics).
      const agentIdFilter = event.queryStringParameters?.agentId;
      const list = agentIdFilter ? await listSchedulesByAgent(auth.sub, agentIdFilter) : await listSchedules(auth.sub);
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
      return respond(created.requiresApproval ? 202 : 201, created);
    }

    // Tenant-scope list (admin only) — Phase 3
    if (method === 'GET' && /\/agent-schedules\/tenant\/?$/.test(path)) {
      if (!isAdmin(auth)) return respond(403, { error: 'Forbidden' });
      // Pagination: default page size 200 (well under the 6 MB API GW
      // response limit even with full agent_snapshot blobs); cap at 500
      // for callers that explicitly opt in. Cursor is an opaque base64
      // of the DDB LastEvaluatedKey.
      const qp = event.queryStringParameters ?? {};
      const requestedLimit = parseInt(qp.limit ?? '200', 10);
      const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 200;
      let startKey: Record<string, unknown> | undefined;
      if (qp.cursor) {
        try {
          startKey = JSON.parse(Buffer.from(qp.cursor, 'base64').toString('utf8'));
        } catch {
          return respond(400, { error: 'Invalid cursor' });
        }
      }
      const page = await listTenantSchedulesPage(limit, startKey);
      return respond(200, {
        schedules: page.schedules,
        nextCursor: page.nextKey ? Buffer.from(JSON.stringify(page.nextKey), 'utf8').toString('base64') : undefined,
      });
    }

    // Quota summary for current user — Phase 3
    if (method === 'GET' && /\/agent-schedules\/quota-summary\/?$/.test(path)) {
      const summary = await getQuotaSummary(auth.sub);
      return respond(200, summary);
    }

    // Trigger-load summary (admin) — feeds the audit panel's Triggers tab
    // chart + projection. Returns daily totals for the past N days, current-
    // month actuals, and the linear projection vs cap.
    if (method === 'GET' && /\/agent-schedules\/trigger-load\/?$/.test(path)) {
      if (!isAdmin(auth)) return respond(403, { error: 'Forbidden' });
      const days = Math.min(Math.max(parseInt(event.queryStringParameters?.days ?? '30', 10) || 30, 1), 90);
      const summary = await getTriggerLoadSummary(days);
      return respond(200, summary);
    }

    const approveMatch = path.match(/\/agent-schedules\/([^/]+)\/approve$/);
    if (method === 'POST' && approveMatch) {
      if (!isAdmin(auth)) return respond(403, { error: 'Forbidden' });
      const updated = await approveSchedule(auth, decodeURIComponent(approveMatch[1]));
      return respond(200, updated);
    }

    const rejectMatch = path.match(/\/agent-schedules\/([^/]+)\/reject$/);
    if (method === 'POST' && rejectMatch) {
      if (!isAdmin(auth)) return respond(403, { error: 'Forbidden' });
      await rejectSchedule(auth, decodeURIComponent(rejectMatch[1]));
      return respond(200, { ok: true });
    }

    const idMatch = path.match(/\/agent-schedules\/([^/]+)$/);

    if (method === 'GET' && idMatch) {
      const scheduleId = decodeURIComponent(idMatch[1]);
      // Admins can fetch any user's schedule (e.g. opened from the audit
      // panel). Owners are still owner-scoped to their own.
      const schedule = isAdmin(auth)
        ? await getScheduleByIdAcrossUsers(scheduleId)
        : await getSchedule(auth.sub, scheduleId);
      if (!schedule) return respond(404, { error: 'Schedule not found' });
      return respond(200, schedule);
    }

    if (method === 'DELETE' && idMatch) {
      await deleteSchedule(auth, decodeURIComponent(idMatch[1]));
      return respond(200, { ok: true });
    }

    if (method === 'PUT' && idMatch) {
      const body = JSON.parse(event.body || '{}') as UpdateSchedulePayload;
      const result = await updateSchedule(auth, decodeURIComponent(idMatch[1]), body);
      // 202 when the update was queued for admin review (over-cap) so the
      // frontend can show the same "pending approval" UX as the create path.
      // The schedule field is the merged record; the optional violation field
      // tells the UI exactly which cap pushed it into pending.
      const status = result.requiresApproval ? 202 : 200;
      return respond(status, {
        ...(result.schedule ?? {}),
        requiresApproval: result.requiresApproval,
        ...(result.quotaViolation ? { quotaViolation: result.quotaViolation } : {}),
      });
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
    const payload = (error as { payload?: unknown }).payload;
    return respond(statusCode, payload ? { error: message, ...(payload as object) } : { error: message });
  }
};

const isAdmin = (auth: AuthContext): boolean => auth.groups.includes('admin');

/**
 * Read the level-3 admin override and resolve effective quotas via the
 * level-1+2+3 chain. Re-read on every call: a warm-container cache would
 * mean admin in-app toggle changes don't take effect until cold start.
 * The cost is one DDB GetItem on the scheduling-settings record per
 * request — cheap.
 */
const resolveQuotas = async (): Promise<ScheduleQuotas> => {
  let level3 = {};
  if (SCHEDULING_SETTINGS_TABLE) {
    try {
      const res = await dynamo.send(
        new GetCommand({ TableName: SCHEDULING_SETTINGS_TABLE, Key: { setting: 'scheduling' } })
      );
      level3 = parseQuotasFromSettingsItem(res.Item);
    } catch (err) {
      console.warn('Failed to read scheduling settings, falling back to level 1+2', err);
    }
  }
  return resolveEffectiveQuotas(LEVEL_2_QUOTAS, level3);
};

/**
 * Validates that a cron expression does not schedule runs more frequently
 * than the effective minimum interval. Throws if too frequent.
 */
const validateCronInterval = async (cronExpression: string): Promise<void> => {
  const quotas = await resolveQuotas();
  const effectiveMin = quotas.minIntervalMinutes;

  const estimated = estimateCronIntervalMinutes(cronExpression);
  // null means we can't reliably estimate. Common offenders are restricted-
  // hour patterns like `cron(*/5 9-17 ? * MON-FRI *)` which the parser
  // can't decompose. Combined with `projectMonthlyRuns` returning the
  // platform minimum (1) for the same null cases, this is a quota-bypass
  // surface: a 5-min weekday-business-hours schedule projects as 1 run/mo
  // but actually fires ~2,400 times/mo. Refuse the schedule outright and
  // tell the user to use a simpler pattern. Tightened from the prior
  // "allow at platform default" stance — that stance assumed projection
  // was load-bearing only when min-interval was raised above the legacy 5
  // mins, which isn't true now that quota enforcement also reads it.
  if (estimated === null) {
    throw Object.assign(
      new Error(
        `Cannot verify schedule cadence — this cron pattern is too complex to estimate. ` +
          `Quotas can't be enforced safely against unparseable schedules. ` +
          `Use a simpler pattern (e.g. "every N minutes/hours" or a fixed time) and try again.`
      ),
      { statusCode: 400 }
    );
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

/**
 * Query all schedules in the tenant for quota aggregation. Cron schedules only —
 * event triggers don't have a projectable cadence.
 *
 * Uses the `tenant-id-index` GSI to avoid a full table Scan. Filters status
 * client-side (active + pending_approval count toward quota).
 */
const scanTenantSchedulesForQuota = async (): Promise<LoadCalculationRecord[]> => {
  const records: LoadCalculationRecord[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'tenant-id-index',
        KeyConditionExpression: 'tenant_id = :tenant',
        FilterExpression: '#status IN (:active, :pending)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':tenant': CLIENT_NAME,
          ':active': 'active',
          ':pending': 'pending_approval',
        },
        ProjectionExpression:
          'user_id, schedule_id, agent_id, #status, trigger_type, cron_expression, projected_runs_per_month, quota_scope, approved_by',
        ExclusiveStartKey: lastKey,
      })
    );
    for (const item of res.Items ?? []) {
      records.push(item as LoadCalculationRecord);
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return records;
};

/**
 * Enforce automation quotas at create / activate time.
 *
 * Throws a structured 400 on hard breach, returns `{ requiresApproval: true }`
 * when the user-cap can be approved up to the company cap, otherwise returns
 * `{ requiresApproval: false }`.
 *
 * Cron schedules pass their projected runs/month — `checkQuotas` adds them
 * to existing tenant load and rejects if the company / user cap is crossed.
 * Concurrent active automations (cron + triggers combined) are checked for
 * both kinds. Per-automation limits are enforced at run time via the
 * schedule's `max_runs` field, not here.
 *
 * Event triggers pass `projectedRuns: 0` — they don't have a projectable
 * cadence — so the run-cap branches are no-ops. Concurrent and trigger
 * actual-usage caps still apply: if the tenant or user is already at/over
 * its monthly trigger cap, this round refuses creation rather than letting
 * the schedule land and silently drop every fire.
 *
 * Soft on quota *decrease*: existing schedules over a newly-lowered cap keep
 * running. Only NEW creations / reactivations are blocked. The first cap
 * check (`current + new > limit`) catches "tenant already over" because
 * `current` already exceeds the limit and any positive `additionalRuns`
 * (or +1 for concurrent) tips it over.
 */
/**
 * Advisory information surfaced when an event trigger is created/reactivated
 * while the tenant or user is already at the trigger budget cap. NOT a
 * blocker — the schedule creates successfully and stays active. The runtime
 * (runner's `enforceTriggerQuotaOrBail`) skips fires until the atomic
 * counter resets on the 1st. Past usage from deleted/paused triggers stays
 * counted, so this is informational, not actionable.
 */
type TriggerBudgetWarning = {
  scope: 'company' | 'user';
  /** Current month's actual fire count for the scope. */
  current: number;
  /** Effective trigger cap for the scope. */
  limit: number;
};

const enforceQuotas = async (input: {
  userSub: string;
  isEventTrigger: boolean;
  /** Cron schedules pass projected runs/month. Event triggers pass 0. */
  projectedRuns: number;
  excludeScheduleId?: string;
}): Promise<{ requiresApproval: boolean; violation?: QuotaViolation; triggerWarning?: TriggerBudgetWarning }> => {
  const quotas = await resolveQuotas();
  const existing = await scanTenantSchedulesForQuota();
  const violation = checkQuotas({
    userSub: input.userSub,
    additionalRuns: input.projectedRuns,
    existingRecords: existing,
    quotas,
    excludeScheduleId: input.excludeScheduleId,
  });
  if (violation) {
    if (violation.approvable) return { requiresApproval: true, violation };
    throw Object.assign(
      new Error(`Schedule quota exceeded (${violation.scope}): ${violation.requested} > ${violation.limit}.`),
      {
        statusCode: 400,
        payload: { code: 'QUOTA_EXCEEDED', violation },
      }
    );
  }

  // Event triggers: don't block creation when current trigger actuals are
  // already at/over the cap. Removing or pausing an existing trigger
  // doesn't refund this month's atomic counter usage anyway, so refusing
  // creation gives the user no actionable remediation. Instead, allow the
  // create and surface a `triggerWarning` so the frontend can show a
  // non-blocking banner ("saved — heads up, fires won't run until budget
  // resets next month, or ask an admin to raise the cap"). The runtime
  // gate in `enforceTriggerQuotaOrBail` is the actual enforcement point —
  // it skips each over-cap fire and emails the owner once per month.
  //
  // When approving / reactivating, exclude the schedule's own historical
  // `recent_runs` so we don't double-count: those fires already
  // contributed to the atomic counter at fire time. Counting them in the
  // load aggregation here would make a long-paused trigger appear "more
  // expensive" than a brand-new one.
  let triggerWarning: TriggerBudgetWarning | undefined;
  if (input.isEventTrigger) {
    const triggerRecords = await scanTenantTriggerSchedules();
    const filteredRecords = input.excludeScheduleId
      ? triggerRecords.filter((r) => r.schedule_id !== input.excludeScheduleId)
      : triggerRecords;
    const monthKey = currentMonthKey();
    const triggerLoad = aggregateTriggerLoad(filteredRecords, monthKey);
    const triggerViolation = checkTriggerQuotas({
      userSub: input.userSub,
      load: triggerLoad,
      quotas,
    });
    if (triggerViolation) {
      triggerWarning = {
        scope: triggerViolation.scope,
        current: triggerViolation.current,
        limit: triggerViolation.limit,
      };
    }
  }

  return { requiresApproval: false, triggerWarning };
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

/**
 * List the caller's schedules for a single agent. Uses the `agent-id-index`
 * GSI (defined in `core-numa-infra-construct.ts`) so it's a Query rather than
 * the previous fetch-all-then-filter-client-side. Filters by user_id at the
 * Query level so a user only sees their own schedules.
 */
const listSchedulesByAgent = async (userId: string, agentId: string): Promise<ScheduleRecord[]> => {
  const records: ScheduleRecord[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'agent-id-index',
        KeyConditionExpression: 'agent_id = :a',
        FilterExpression: 'user_id = :u AND #status <> :deleted',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':a': agentId,
          ':u': userId,
          ':deleted': 'deleted',
        },
        ExclusiveStartKey: lastKey,
      })
    );
    for (const item of result.Items ?? []) {
      records.push(item as ScheduleRecord);
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return records.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
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

type CreateScheduleResult = {
  scheduleId: string;
  requiresApproval: boolean;
  quotaViolation?: QuotaViolation;
  /**
   * Set on event-trigger creates when the tenant / user is already at
   * trigger budget cap. Schedule is still created — this is advisory.
   * Frontend surfaces it as a non-blocking banner.
   */
  triggerWarning?: TriggerBudgetWarning;
} & ScheduleRecord;

const createSchedule = async (auth: AuthContext, payload: CreateSchedulePayload): Promise<CreateScheduleResult> => {
  // Validate payload with Zod
  const validatedPayload = validateCreatePayload(payload);
  const isEventTrigger = validatedPayload.triggerType === 'event';

  // Enforce minimum scheduling interval (cron only)
  if (!isEventTrigger && validatedPayload.cronExpression) {
    await validateCronInterval(validatedPayload.cronExpression);
  }

  // Project monthly runs (cron only — event triggers don't have a projectable
  // cadence). The raw cron projection is clamped down by `maxRuns` when set,
  // since the schedule auto-pauses on hitting its monthly run cap (handled
  // in the runner). e.g. "5-min interval, max_runs: 20" projects to 20, not
  // ~8640 — what we store + what quotas check against is the realistic
  // upper bound, not the theoretical one.
  const rawCronProjection =
    isEventTrigger || !validatedPayload.cronExpression
      ? undefined
      : projectMonthlyRuns(validatedPayload.cronExpression);
  const projectedRuns =
    rawCronProjection !== undefined && validatedPayload.maxRuns !== undefined
      ? Math.min(rawCronProjection, validatedPayload.maxRuns)
      : rawCronProjection;

  const quotaResult = await enforceQuotas({
    userSub: auth.sub,
    isEventTrigger,
    projectedRuns: projectedRuns ?? 0,
  });

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
    status: quotaResult.requiresApproval ? 'pending_approval' : 'active',
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
    projected_runs_per_month: projectedRuns,
    // New schedules always start as user-scoped. Admin approval may flip
    // this to 'company' (see approveSchedule) when a pending schedule is
    // approved over the user cap.
    quota_scope: 'user',
    expires_at: validatedPayload.expiresAt,
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
          requiresApproval: false,
          triggerWarning: quotaResult.triggerWarning,
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
    return {
      scheduleId,
      requiresApproval: false,
      triggerWarning: quotaResult.triggerWarning,
      ...validatedRecord,
    };
  }

  // Pending-approval schedules don't create an EventBridge entry until an admin approves.
  if (quotaResult.requiresApproval) {
    return {
      scheduleId,
      requiresApproval: true,
      quotaViolation: quotaResult.violation,
      ...validatedRecord,
    };
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
        Target: buildSchedulerTarget({ scheduleId }),
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

  // Fire-and-forget quota-warning email if the new schedule pushed user or
  // company past 80%. Deduped per month (one email per scope per month).
  void maybeFireQuotaWarning({ userSub: auth.sub, userEmail: auth.email });

  return { scheduleId, requiresApproval: false, ...validatedRecord };
};

type UpdateScheduleResult = {
  schedule: Record<string, unknown> | undefined;
  /** True when the update was queued for admin review instead of going active. */
  requiresApproval: boolean;
  /** Which cap pushed the update into pending — surfaced so the UI can explain. */
  quotaViolation?: QuotaViolation;
  /**
   * Set on event-trigger reactivation when the tenant / user is already at
   * trigger budget cap. Update succeeds — schedule goes active. Frontend
   * surfaces this as a non-blocking warning so the user knows fires won't
   * run until next month's reset.
   */
  triggerWarning?: TriggerBudgetWarning;
};

const updateSchedule = async (
  auth: AuthContext,
  scheduleId: string,
  payload: UpdateSchedulePayload
): Promise<UpdateScheduleResult> => {
  const validatedPayload = validateUpdatePayload(payload);
  const hasUpdates = Object.keys(validatedPayload).length > 0;
  if (!hasUpdates) {
    throw new Error('No updates provided');
  }

  const callerIsAdmin = isAdmin(auth);

  // Admins can update any user's schedule — load via the cross-user path so
  // the audit panel's pause / lock / unlock actions work for schedules owned
  // by other users. Owners are still scoped to their own (`user_id = sub`).
  let record: ScheduleRecord | undefined;
  if (callerIsAdmin) {
    record = (await getScheduleByIdAcrossUsers(scheduleId)) ?? undefined;
  } else {
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
    record = (existing.Items || [])[0] as ScheduleRecord | undefined;
  }

  if (!record || record.status === 'deleted') {
    throw new Error('Schedule not found');
  }

  // Admin acting on someone else's schedule — used to gate the email
  // notification on admin pause/lock (don't email yourself for your own
  // pauses).
  const adminActingOnAnotherUser = callerIsAdmin && record.user_id !== auth.sub;

  // Admin lock gating: only admins can write `admin_locked`, and only admins
  // can transition a schedule out of `admin_locked`. The owner sees the
  // locked schedule but cannot reactivate or edit it.
  if (validatedPayload.status === 'admin_locked' && !callerIsAdmin) {
    throw Object.assign(new Error('Only admins can lock schedules'), { statusCode: 403 });
  }
  if (record.status === 'admin_locked' && !callerIsAdmin) {
    throw Object.assign(new Error('Schedule is locked by an admin and cannot be edited'), { statusCode: 403 });
  }

  const isEventTrigger = (validatedPayload.triggerType ?? record.trigger_type ?? 'cron') === 'event';

  // Reactivating a paused / pending_approval / admin_locked schedule needs the
  // same checks as creation. Admins can reactivate from admin_locked; owners
  // cannot (rejected above).
  const isReactivating =
    validatedPayload.status === 'active' &&
    (record.status === 'paused' || record.status === 'pending_approval' || record.status === 'admin_locked');

  // If the caller is reactivating a schedule whose expiry has passed, refuse.
  // They must extend `expiresAt` (or clear it via null) in the same request.
  const incomingExpires =
    validatedPayload.expiresAt === null ? null : (validatedPayload.expiresAt ?? record.expires_at);
  if (isReactivating && typeof incomingExpires === 'number' && incomingExpires <= Date.now()) {
    throw Object.assign(new Error('Cannot reactivate a schedule past its expiry — extend or clear expiresAt first'), {
      statusCode: 400,
    });
  }
  // Setting a future expiresAt is fine; setting one in the past on an
  // already-active schedule isn't useful but isn't worth a hard reject.
  if (typeof validatedPayload.expiresAt === 'number' && validatedPayload.expiresAt <= Date.now()) {
    throw Object.assign(new Error('Expiry must be in the future'), { statusCode: 400 });
  }

  // Enforce minimum scheduling interval when cron expression changes or schedule is reactivated
  const cronToValidate = isEventTrigger
    ? undefined
    : (validatedPayload.cronExpression ?? (isReactivating ? record.cron_expression : undefined));
  if (cronToValidate) {
    await validateCronInterval(cronToValidate);
  }

  // Re-check quotas + recompute projected runs when cron changes or reactivating.
  // Cron path: triggered by cron-expression change or status reactivation.
  // Event-trigger path: triggered by reactivation only (no cadence to recompute).
  // Soft-decrease semantics: existing schedules over a newly-lowered cap keep
  // running, but reactivating one when over-cap is treated as a new add and
  // gets blocked.
  // Quota enforcement is always against the OWNER's bucket — never the
  // caller's. When an admin reactivates someone else's schedule we'd
  // otherwise check the admin's empty bucket and silently bypass the owner's
  // user cap. record.user_id is the source of truth for ownership; auth.sub
  // is only the actor.
  const quotaSubject = record.user_id;

  let projectedRuns: number | undefined = record.projected_runs_per_month;
  let updateRequiresApproval = false;
  let updateQuotaViolation: QuotaViolation | undefined;
  let updateTriggerWarning: TriggerBudgetWarning | undefined;
  if (!isEventTrigger && cronToValidate) {
    // Clamp by max_runs the same way createSchedule does (monthly cap takes
    // precedence over the raw cron projection). max_runs may be coming from
    // the payload or from the existing record.
    const rawCronProjection = projectMonthlyRuns(cronToValidate);
    const effectiveMaxRuns = validatedPayload.maxRuns !== undefined ? validatedPayload.maxRuns : record.max_runs;
    projectedRuns = effectiveMaxRuns !== undefined ? Math.min(rawCronProjection, effectiveMaxRuns) : rawCronProjection;
    const quotaCheck = await enforceQuotas({
      userSub: quotaSubject,
      isEventTrigger: false,
      projectedRuns,
      // Exclude this schedule's existing contribution from the aggregate.
      excludeScheduleId: scheduleId,
    });
    if (quotaCheck.requiresApproval) {
      updateRequiresApproval = true;
      updateQuotaViolation = quotaCheck.violation;
    }
  } else if (isEventTrigger && isReactivating) {
    // Event-trigger reactivation: no run-cap recompute, but still need to
    // check concurrent caps + current trigger actuals. Trigger over-budget
    // is advisory only — propagate as a warning, don't block the reactivate.
    const quotaCheck = await enforceQuotas({
      userSub: quotaSubject,
      isEventTrigger: true,
      projectedRuns: 0,
      excludeScheduleId: scheduleId,
    });
    if (quotaCheck.requiresApproval) {
      updateRequiresApproval = true;
      updateQuotaViolation = quotaCheck.violation;
    }
    if (quotaCheck.triggerWarning) {
      updateTriggerWarning = quotaCheck.triggerWarning;
    }
  }

  const expressionNames: Record<string, string> = {};
  const expressionValues: Record<string, unknown> = {
    ':ts': Date.now(),
  };
  const setParts: string[] = ['updated_at = :ts'];
  const removeParts: string[] = [];

  // If a quota recheck demands approval, force the status to pending_approval
  // regardless of what the caller asked for — they can't reactivate above quota.
  const effectiveStatus = updateRequiresApproval ? 'pending_approval' : (validatedPayload.status ?? record.status);
  if (validatedPayload.status || updateRequiresApproval) {
    expressionNames['#status'] = 'status';
    expressionValues[':status'] = effectiveStatus;
    setParts.push('#status = :status');
  }

  // Reset the auto-pause counter when a user explicitly transitions a
  // schedule back to active. The runner's inline comment claims pause/resume
  // clears it but the reset was never wired here — meaning a previously
  // auto-paused schedule would re-pause on the very first failure after
  // resume (counter sat at threshold, +1 failure → auto-pause). The user
  // hitting "resume" IS the human-intervention signal the counter was
  // waiting for; treat it as the implicit acknowledgement.
  if (effectiveStatus === 'active' && record.status !== 'active') {
    expressionNames['#consecutive_failures'] = 'consecutive_failures';
    removeParts.push('#consecutive_failures');
  }

  // Admin lock metadata: stamp on transition INTO admin_locked, clear on transition OUT.
  if (validatedPayload.status === 'admin_locked' && record.status !== 'admin_locked') {
    expressionNames['#admin_locked_by'] = 'admin_locked_by';
    expressionValues[':admin_locked_by'] = auth.sub;
    setParts.push('#admin_locked_by = :admin_locked_by');
    expressionNames['#admin_locked_at'] = 'admin_locked_at';
    expressionValues[':admin_locked_at'] = Date.now();
    setParts.push('#admin_locked_at = :admin_locked_at');
    if (validatedPayload.adminLockReason) {
      expressionNames['#admin_lock_reason'] = 'admin_lock_reason';
      expressionValues[':admin_lock_reason'] = validatedPayload.adminLockReason;
      setParts.push('#admin_lock_reason = :admin_lock_reason');
    }
  } else if (
    record.status === 'admin_locked' &&
    validatedPayload.status &&
    validatedPayload.status !== 'admin_locked'
  ) {
    // Transitioning out — clear lock metadata so it doesn't linger on the record.
    expressionNames['#admin_locked_by'] = 'admin_locked_by';
    expressionNames['#admin_locked_at'] = 'admin_locked_at';
    expressionNames['#admin_lock_reason'] = 'admin_lock_reason';
    removeParts.push('#admin_locked_by', '#admin_locked_at', '#admin_lock_reason');
  }

  // Expiry: number sets it, null clears it.
  if (validatedPayload.expiresAt !== undefined) {
    expressionNames['#expires_at'] = 'expires_at';
    if (validatedPayload.expiresAt === null) {
      removeParts.push('#expires_at');
    } else {
      expressionValues[':expires_at'] = validatedPayload.expiresAt;
      setParts.push('#expires_at = :expires_at');
    }
  }
  if (projectedRuns !== undefined && projectedRuns !== record.projected_runs_per_month) {
    expressionNames['#projected_runs_per_month'] = 'projected_runs_per_month';
    expressionValues[':projected_runs_per_month'] = projectedRuns;
    setParts.push('#projected_runs_per_month = :projected_runs_per_month');
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
    // `cron_expression` is fine bare (underscore breaks the reservation).
    if (validatedPayload.triggerType === 'event') {
      expressionNames['#timezone'] = 'timezone';
      removeParts.push('cron_expression', '#timezone');
    } else if (validatedPayload.triggerType === 'cron') {
      expressionNames['#trigger_field'] = 'trigger';
      removeParts.push('#trigger_field');
    }
  }

  const updatedStatus = effectiveStatus;
  const updatedCron = validatedPayload.cronExpression ?? record.cron_expression;
  const updatedTimezone = validatedPayload.timezone ?? record.timezone;
  const updatedLabel = validatedPayload.label ?? record.label;
  const scheduleName = `${CLIENT_NAME}-${scheduleId}`;
  const description = updatedLabel || `Scheduled agent run for ${record.agent_title || record.agent_id}`;
  const hasScheduleChanges = Boolean(
    validatedPayload.cronExpression || validatedPayload.timezone || validatedPayload.label
  );

  // Sync ordering rule:
  //   - Transitions TO `active` (or active→active with cron change) write
  //     EventBridge BEFORE DynamoDB. If EB fails, DDB is unchanged and the
  //     caller retries cleanly. If we wrote DDB first and EB then threw,
  //     the schedule would be marked active with no rule firing it — a
  //     silent dead schedule (the original FEAT-105 partial-failure bug).
  //   - Transitions AWAY from `active` (paused / deleted / pending /
  //     admin_locked) write DDB first then best-effort delete EB. If EB
  //     delete fails the rule keeps firing harmlessly — the runner sees
  //     the non-active status in DDB and skips. Reversing the order here
  //     would create the symmetric bug: EB rule deleted but DDB still
  //     says active, so the schedule mysteriously stops running.
  const isActiveTransition = updatedStatus === 'active';
  // Event-triggered schedules (Gmail, Pipedream) have no EventBridge cron
  // rule — they're driven by webhooks. Calling CreateSchedule with an
  // undefined ScheduleExpression 400s and bubbles up as a generic "Failed
  // to update schedule" 500. Pipedream activation/deactivation is handled
  // further down via setPipedreamTriggerActive.
  if (isActiveTransition && !isEventTrigger) {
    try {
      if (record.status === 'paused' || record.status === 'pending_approval' || record.status === 'admin_locked') {
        await scheduler.send(
          new CreateScheduleCommand({
            Name: scheduleName,
            GroupName: SCHEDULE_GROUP,
            Description: description,
            ScheduleExpression: updatedCron,
            ScheduleExpressionTimezone: updatedTimezone,
            FlexibleTimeWindow: { Mode: 'OFF' },
            Target: buildSchedulerTarget({ scheduleId }),
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
            Target: buildSchedulerTarget({ scheduleId }),
          })
        );
      }
    } catch (err) {
      console.error('Failed to update EventBridge schedule', err);
      throw new Error('Failed to update schedule');
    }
  }

  let updatedRecord;
  try {
    updatedRecord = await dynamo.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          // Use the record's actual owner — admins acting cross-user need to
          // hit the schedule's row, not their own caller_id row.
          user_id: record.user_id,
          schedule_id: scheduleId,
        },
        UpdateExpression: `SET ${setParts.join(', ')}${removeParts.length > 0 ? ` REMOVE ${removeParts.join(', ')}` : ''}`,
        ExpressionAttributeNames: expressionNames,
        ...(Object.keys(expressionValues).length > 0 ? { ExpressionAttributeValues: expressionValues } : {}),
        ReturnValues: 'ALL_NEW',
      })
    );
  } catch (err) {
    // DDB failed AFTER the EB op committed. We're now in an inconsistent
    // state: EB has the new schedule (or updated cron), DDB still has the
    // old record. Best-effort revert depending on what EB op we ran:
    //   - Reactivation create → delete the new EB rule (DDB still says
    //     paused / pending / locked, so deleting EB is correct)
    //   - Cron-change update → can't easily revert without the prior cron
    //     captured; log loudly so an operator can replay the update.
    if (isActiveTransition) {
      const wasReactivation =
        record.status === 'paused' || record.status === 'pending_approval' || record.status === 'admin_locked';
      if (wasReactivation) {
        try {
          await scheduler.send(new DeleteScheduleCommand({ Name: scheduleName, GroupName: SCHEDULE_GROUP }));
          console.error('[SCHEDULE_UPDATE] DDB write failed after EB create; reverted EB to keep state consistent', {
            scheduleId,
            error: err,
          });
        } catch (revertErr) {
          console.error(
            '[SCHEDULE_UPDATE] DDB write failed after EB create AND revert failed — ' +
              'schedule has an EB rule but is still marked paused/pending/locked in DDB. ' +
              'Manual cleanup required: delete the EB rule or retry the update.',
            { scheduleId, ddbError: err, revertError: revertErr }
          );
        }
      } else {
        console.error(
          '[SCHEDULE_UPDATE] DDB write failed after EB UpdateSchedule; EB now points at new cron but DDB has old record. ' +
            'Schedule will fire on the new cadence with old prompt/runConfig. Retry the update to converge.',
          { scheduleId, error: err }
        );
      }
    }
    throw err;
  }

  if (isEventTrigger) {
    // Event-triggered schedules have no EventBridge entry. Pipedream-backed
    // ones do need their lifecycle synced with Pipedream though:
    //   - status change → relay update_deployed_trigger(active=true|false)
    //   - configured_props change → relay update_deployed_trigger(configured_props=...)
    // Both preserve dc_xxx and webhook_signing_key (verified empirically).
    const recordPipedreamTrigger =
      record.trigger?.source === 'pipedream' ? (record.trigger as PipedreamTrigger) : undefined;
    const deployedTriggerId = recordPipedreamTrigger?.deployed_trigger_id;
    if (deployedTriggerId) {
      const externalUserId = buildExternalUserId(CLIENT_NAME, auth.sub);

      // Pause/resume mirror to Pipedream — paused/deleted/admin_locked all
      // need the trigger deactivated upstream so we don't keep paying for
      // webhook delivery on a schedule that won't fire. Reactivation only
      // covers the non-active → active path; admin_locked unlock goes to
      // paused first, so this branch picks it up on the next save.
      const newStatus = validatedPayload.status;
      const becomingInactive =
        (newStatus === 'paused' || newStatus === 'deleted' || newStatus === 'admin_locked') &&
        record.status === 'active';
      const becomingActive = newStatus === 'active' && record.status !== 'active';
      try {
        if (becomingInactive) {
          await setPipedreamTriggerActive({
            relayArn: PIPEDREAM_RELAY_LAMBDA_ARN,
            externalUserId,
            deployedTriggerId,
            active: false,
          });
        } else if (becomingActive) {
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
      } catch (err) {
        // Pipedream lifecycle sync failed AFTER DDB committed. Log loudly so
        // an operator can replay; don't throw — DDB is authoritative for
        // status, and the receiver lambda will reject deliveries that don't
        // match an active schedule anyway.
        console.error(
          '[SCHEDULE_UPDATE] Pipedream lifecycle sync failed after DDB write — DDB and Pipedream may disagree until next save',
          { scheduleId, deployedTriggerId, error: err }
        );
      }
    }
    return {
      schedule: updatedRecord.Attributes,
      requiresApproval: updateRequiresApproval,
      quotaViolation: updateQuotaViolation,
      triggerWarning: updateTriggerWarning,
    };
  }

  if (
    updatedStatus === 'paused' ||
    updatedStatus === 'deleted' ||
    updatedStatus === 'pending_approval' ||
    updatedStatus === 'admin_locked'
  ) {
    // Best-effort EB delete after DDB committed the new (non-active)
    // status. Failure here is OK: the runner gates on DDB status, so a
    // lingering EB rule fires the runner which then skips with
    // "status is not active".
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
  }

  // When an admin takes any visible action on another user's schedule,
  // email the owner so they aren't left guessing why state changed. Covers
  // pause, resume, lock, unlock, and the "your over-cap update was queued
  // for review" path. Fire-and-forget — email failure doesn't roll back
  // the status change. The admin's own actions on their own schedule
  // don't trigger emails (no point self-emailing).
  if (adminActingOnAnotherUser) {
    let action: AdminActionKind | null = null;
    if (updateRequiresApproval) {
      // The recheck forced this update into pending_approval — owner needs
      // to know their automation is paused awaiting admin review.
      action = 'queued_for_approval';
    } else if (validatedPayload.status === 'paused') {
      action = 'paused';
    } else if (validatedPayload.status === 'admin_locked') {
      action = 'admin_locked';
    } else if (validatedPayload.status === 'active') {
      // Reactivation. Differentiate "resumed from paused" vs "unlocked from
      // admin_locked" so the email's "next steps" wording matches the
      // owner's mental model of what they can now do.
      action = record.status === 'admin_locked' ? 'unlocked' : 'resumed';
    }
    if (action) {
      void notifyOwnerOfAdminAction({
        record,
        action,
        reason: validatedPayload.adminLockReason,
        adminEmail: auth.email,
      });
    }
  }

  // Fire-and-forget quota-warning if reactivation or cron-change pushed
  // load over the 80% threshold. Same dedupe semantics as the create path.
  // Don't pass `auth.email` — when an admin updates someone else's schedule,
  // the caller's email isn't the owner's. The helper falls through to a
  // Cognito lookup keyed by `record.user_id` instead.
  if (effectiveStatus === 'active') {
    void maybeFireQuotaWarning({
      userSub: record.user_id,
      userEmail: adminActingOnAnotherUser ? undefined : auth.email,
    });
  }

  return {
    schedule: updatedRecord.Attributes,
    requiresApproval: updateRequiresApproval,
    quotaViolation: updateQuotaViolation,
    triggerWarning: updateTriggerWarning,
  };
};

/**
 * Email the owner when an admin takes action on their schedule. Covers all
 * admin-driven status transitions on schedules owned by another user:
 * pause / resume / lock / unlock / approve / queue-for-approval. The owner
 * shouldn't have to deduce why their automation changed state by reading
 * the audit panel — they get a direct email explaining what happened and
 * what (if anything) they can do about it.
 *
 * Resolves the recipient via the schedule's `notification_email` (set at
 * create time) then falls back to a Cognito sub lookup. Branding is
 * intentionally skipped — the email-sender renders an unbranded template,
 * which is acceptable for this low-frequency admin-action notice.
 */
type AdminActionKind = 'paused' | 'admin_locked' | 'resumed' | 'unlocked' | 'approved' | 'queued_for_approval';

const notifyOwnerOfAdminAction = async (params: {
  record: ScheduleRecord;
  action: AdminActionKind;
  reason?: string;
  adminEmail?: string;
}): Promise<void> => {
  const { record, action, reason, adminEmail } = params;
  const recipient = record.notification_email || (await resolveUserEmail(record.user_id));
  if (!recipient) {
    console.info('[ADMIN_ACTION_EMAIL] No recipient resolvable; skipping', {
      scheduleId: record.schedule_id,
      action,
    });
    return;
  }
  const scheduleName = record.label || record.agent_title || record.agent_id || 'Unknown automation';

  // action_label fills the existing `schedule_paused_by_admin` template
  // wording: "An admin has {{action_label}} your automation X." Keep these
  // verbs grammatically compatible with that sentence.
  const actionLabels: Record<AdminActionKind, string> = {
    paused: 'paused',
    admin_locked: 'locked',
    resumed: 'resumed',
    unlocked: 'unlocked',
    approved: 'approved',
    queued_for_approval: 'queued for approval',
  };
  const actionLabel = actionLabels[action];

  const nextStepsByAction: Record<AdminActionKind, string> = {
    paused: 'You can review the automation and resume it any time from your scheduling dashboard.',
    admin_locked:
      "You won't be able to reactivate this automation yourself — contact your admin if you need it back on.",
    resumed: 'No action needed — the automation is running again on its normal schedule.',
    unlocked: 'You can now reactivate or edit this automation from your scheduling dashboard.',
    approved:
      'Your over-cap automation has been approved by an admin and will run on its schedule. ' +
      'It now counts against the company quota rather than your personal cap.',
    queued_for_approval:
      'Your automation is waiting for admin review because activating it would push you over the user cap. ' +
      'It will not run until an admin approves it.',
  };

  await sendEmail({
    to: recipient,
    template: 'schedule_paused_by_admin',
    templateData: {
      schedule_name: scheduleName,
      action_label: actionLabel,
      ...(reason ? { reason } : {}),
      next_steps: nextStepsByAction[action],
      manage_url: `https://${CLIENT_NAME}.numa.arcanum.ai/scheduling/${record.schedule_id}`,
      ...(adminEmail ? { admin_email: adminEmail } : {}),
    },
  });
};

/**
 * Quota-warning threshold — once post-add load crosses this percentage of
 * the cap, the owner gets one email per scope per month. Hard-coded to
 * match the in-product `WARN_PCT` in QuotaPreflight.
 */
const QUOTA_WARNING_THRESHOLD_PCT = 80;

/**
 * Conditionally claim "this user/company has been warned this month" by
 * writing to the scheduling-settings table with a unique `setting` key.
 * Returns true if this caller should send the email (first claim of the
 * month), false if a prior call already claimed it.
 */
const claimQuotaWarningSlot = async (settingKey: string, monthKey: string): Promise<boolean> => {
  if (!SCHEDULING_SETTINGS_TABLE) return false;
  try {
    await dynamo.send(
      new UpdateCommand({
        TableName: SCHEDULING_SETTINGS_TABLE,
        Key: { setting: settingKey },
        UpdateExpression: 'SET last_warned_month = :m',
        ConditionExpression: 'attribute_not_exists(last_warned_month) OR last_warned_month <> :m',
        ExpressionAttributeValues: { ':m': monthKey },
      })
    );
    return true;
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') return false;
    console.warn('[QUOTA_WARNING] Failed to claim dedupe slot', { settingKey, error: err });
    return false;
  }
};

/**
 * Compute current usage % and dispatch a warning email when the user or
 * company crosses 80% of their monthly run cap. Deduped per scope per
 * month via `scheduling-settings` rows. Fire-and-forget — never throws.
 *
 * Recipient model: both user-scope and company-scope warnings are sent to
 * the user whose action triggered the threshold crossing. That keeps the
 * notification close to the action that caused it; admins picking up the
 * "company at 80%" signal can then take broader action.
 */
const maybeFireQuotaWarning = async (params: { userSub: string; userEmail?: string }): Promise<void> => {
  const { userSub, userEmail } = params;
  try {
    const summary = await getQuotaSummary(userSub);
    const q = summary.quotas;
    const userPct =
      q.maxRunsPerUserPerMonth > 0 ? Math.round((summary.user.runsPerMonth / q.maxRunsPerUserPerMonth) * 100) : 0;
    const companyPct =
      q.maxRunsPerCompanyPerMonth > 0
        ? Math.round((summary.company.runsPerMonth / q.maxRunsPerCompanyPerMonth) * 100)
        : 0;
    const monthKey = currentMonthKey();
    const recipient = userEmail || (await resolveUserEmail(userSub));
    if (!recipient) return;
    const manageUrl = `https://${CLIENT_NAME}.numa.arcanum.ai/scheduling`;

    if (userPct >= QUOTA_WARNING_THRESHOLD_PCT) {
      const claimed = await claimQuotaWarningSlot(`quota_warn_user_${userSub}`, monthKey);
      if (claimed) {
        await sendEmail({
          to: recipient,
          template: 'schedule_quota_warning',
          templateData: {
            scope: 'user',
            scope_label: 'You',
            percent: String(userPct),
            current: summary.user.runsPerMonth.toLocaleString(),
            limit: q.maxRunsPerUserPerMonth.toLocaleString(),
            active_count: String(summary.user.activeScheduleCount),
            manage_url: manageUrl,
          },
        });
      }
    }

    if (companyPct >= QUOTA_WARNING_THRESHOLD_PCT) {
      const claimed = await claimQuotaWarningSlot('quota_warn_company', monthKey);
      if (claimed) {
        await sendEmail({
          to: recipient,
          template: 'schedule_quota_warning',
          templateData: {
            scope: 'company',
            scope_label: 'Your company',
            percent: String(companyPct),
            current: summary.company.runsPerMonth.toLocaleString(),
            limit: q.maxRunsPerCompanyPerMonth.toLocaleString(),
            active_count: String(summary.company.activeScheduleCount),
            manage_url: manageUrl,
          },
        });
      }
    }
  } catch (err) {
    console.warn('[QUOTA_WARNING] Failed to fire quota warning (non-blocking)', err);
  }
};

const deleteSchedule = async (auth: AuthContext, scheduleId: string): Promise<void> => {
  // Admins can delete any schedule; regular users can only delete their own.
  const record = isAdmin(auth) ? await getScheduleByIdAcrossUsers(scheduleId) : await getSchedule(auth.sub, scheduleId);
  if (!record || record.status === 'deleted') {
    throw new Error('Schedule not found');
  }

  // Pending-approval schedules never had an EventBridge entry to delete.
  const hasEventBridgeEntry = (record.trigger_type ?? 'cron') !== 'event' && record.status !== 'pending_approval';
  if (hasEventBridgeEntry) {
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
        user_id: record.user_id,
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

/**
 * Look up a schedule by ID without knowing its owner's user_id. Uses the
 * `schedule-id-index` GSI. Used by admin actions (approve/reject/delete) and
 * the runner.
 */
const getScheduleByIdAcrossUsers = async (scheduleId: string): Promise<ScheduleRecord | null> => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'schedule-id-index',
      KeyConditionExpression: 'schedule_id = :s',
      ExpressionAttributeValues: { ':s': scheduleId },
      Limit: 1,
    })
  );
  return (result.Items?.[0] as ScheduleRecord | undefined) ?? null;
};

/**
 * Admin-only: list a single page of schedules across the tenant. Used by
 * the audit screen + admin overview. Uses the `tenant-id-index` GSI;
 * filters out soft-deleted records via DDB FilterExpression (so soft-
 * deleted records still consume read capacity but don't bloat the
 * response payload).
 *
 * `limit` is the max returned items in the page. DynamoDB may apply the
 * filter AFTER the page-size limit so we may need to keep paging until
 * we've collected `limit` items or DDB returns no LastEvaluatedKey.
 *
 * Returns the page items + the next key (base64-wrapped at the API layer).
 *
 * Note: the GSI doesn't support a "sort by updated_at" key — sorting must
 * happen client-side. Within a page we sort newest-first; across pages,
 * order is ScheduleId-keyed within DDB's partition. The audit panel's
 * client-side sort handles re-merging.
 */
const listTenantSchedulesPage = async (
  limit: number,
  startKey?: Record<string, unknown>
): Promise<{ schedules: ScheduleRecord[]; nextKey?: Record<string, unknown> }> => {
  const records: ScheduleRecord[] = [];
  let lastKey: Record<string, unknown> | undefined = startKey;
  while (records.length < limit) {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'tenant-id-index',
        KeyConditionExpression: 'tenant_id = :tenant',
        FilterExpression: '#status <> :deleted',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':tenant': CLIENT_NAME, ':deleted': 'deleted' },
        ExclusiveStartKey: lastKey,
        // Page size from DDB; we may iterate to fill the requested limit.
        Limit: Math.max(limit - records.length, 25),
      })
    );
    for (const item of res.Items ?? []) {
      if (records.length >= limit) break;
      records.push(item as ScheduleRecord);
    }
    lastKey = res.LastEvaluatedKey;
    if (!lastKey) break;
  }
  return {
    schedules: records.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0)),
    nextKey: lastKey,
  };
};

/**
 * Return the user's projected monthly run usage and the resolved caps so
 * the frontend can render a "X / Y monthly runs" strip.
 */
const getQuotaSummary = async (
  userSub: string
): Promise<{
  quotas: ScheduleQuotas;
  user: {
    runsPerMonth: number;
    activeScheduleCount: number;
    triggerRunsThisMonth: number;
    activeTriggerCount: number;
    activeAutomationCount: number;
  };
  company: { runsPerMonth: number; activeScheduleCount: number };
}> => {
  // Cron load + active counts come from the full tenant scan; trigger
  // actuals come from the atomic counter row read further down.
  const [quotas, allRecords] = await Promise.all([resolveQuotas(), scanTenantSchedulesForQuota()]);
  let userRuns = 0;
  let userScheduleCount = 0;
  let userTriggerCount = 0;
  let companyRuns = 0;
  let companyCount = 0;
  for (const r of allRecords) {
    if (r.status !== 'active' && r.status !== 'pending_approval') continue;
    const isEvent = (r.trigger_type ?? 'cron') === 'event';

    if (!isEvent && r.status === 'active') {
      const projected = r.projected_runs_per_month ?? (r.cron_expression ? projectMonthlyRuns(r.cron_expression) : 0);
      companyRuns += projected;
      companyCount += 1;
      if (r.user_id === userSub) {
        // Concurrent count includes the schedule regardless of scope, but
        // company-scoped (admin-promoted) schedules are excluded from the
        // user's monthly-run total — they're funded by the company bucket.
        // Same legacy-signal logic as `aggregateLoad`: treat any approved
        // schedule as company-scoped even if `quota_scope` was never set.
        userScheduleCount += 1;
        const isCompanyScoped = r.quota_scope === 'company' || !!r.approved_by;
        if (!isCompanyScoped) {
          userRuns += projected;
        }
      }
    } else if (isEvent && r.user_id === userSub) {
      userTriggerCount += 1;
    }
  }

  // Trigger actuals — read directly from the atomic counter row in the
  // scheduling-settings table. This is the SAME number the runner uses
  // for cap enforcement, so the displayed "X / cap" always matches reality.
  // Used to sum `recent_runs` via `aggregateTriggerLoad`, but that field
  // is per-schedule and historically had a double-increment bug — the
  // displayed count drifted past the actual atomic-counter value, leading
  // to "cap hit" displays when the real counter was nowhere near.
  const userTriggerRunsThisMonth = await readTriggerCounter(`trigger_count_user_${userSub}_${currentMonthKey()}`);

  return {
    quotas,
    user: {
      runsPerMonth: userRuns,
      activeScheduleCount: userScheduleCount,
      triggerRunsThisMonth: userTriggerRunsThisMonth,
      activeTriggerCount: userTriggerCount,
      activeAutomationCount: userScheduleCount + userTriggerCount,
    },
    company: { runsPerMonth: companyRuns, activeScheduleCount: companyCount },
  };
};

/**
 * Read a single atomic-counter row from the scheduling-settings table.
 * Returns the `total` value, or 0 if the row doesn't exist yet (no fires
 * this month). Used by the dashboard / quota-summary to display actual
 * usage rather than a sum of per-schedule counters that can drift.
 */
const readTriggerCounter = async (settingKey: string): Promise<number> => {
  if (!SCHEDULING_SETTINGS_TABLE) return 0;
  try {
    const res = await dynamo.send(
      new GetCommand({ TableName: SCHEDULING_SETTINGS_TABLE, Key: { setting: settingKey } })
    );
    const total = res.Item?.total;
    return typeof total === 'number' ? total : 0;
  } catch (err) {
    console.warn('Failed to read trigger counter; defaulting to 0', { settingKey, err });
    return 0;
  }
};

/**
 * Query every event-trigger schedule in the tenant, projecting fields
 * needed for the trigger-load aggregation (including `recent_runs`).
 * Includes paused/admin_locked rows so the chart shows historical fires
 * even when a schedule is currently parked.
 */
const scanTenantTriggerSchedules = async (): Promise<TriggerCalculationRecord[]> => {
  const records: TriggerCalculationRecord[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'tenant-id-index',
        KeyConditionExpression: 'tenant_id = :tenant',
        FilterExpression: 'trigger_type = :event AND #status <> :deleted',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':tenant': CLIENT_NAME,
          ':event': 'event',
          ':deleted': 'deleted',
        },
        ProjectionExpression: 'user_id, schedule_id, agent_id, #status, trigger_type, recent_runs',
        ExclusiveStartKey: lastKey,
      })
    );
    for (const item of res.Items ?? []) {
      records.push(item as TriggerCalculationRecord);
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return records;
};

/**
 * Admin-only: trigger-load summary for the audit panel.
 *
 * Returns:
 *  - `dailyTotals`: per-day fire totals for the last N days (drives the chart)
 *  - `monthRuns`: actuals so far this month (used for cap %)
 *  - `projectedMonthRuns`: linear projection from the N-day rate
 *  - `caps`: effective caps for context
 *  - `warningThresholdPercent`: from quotas; UI compares projected/cap × 100
 *  - `perUser`: same shape per-user (for inline user warnings)
 */
const getTriggerLoadSummary = async (
  days: number
): Promise<{
  caps: {
    company: number;
    user: number;
  };
  warningThresholdPercent: number;
  monthKey: string;
  windowDays: number;
  dailyTotals: Array<{ date: string; total: number }>;
  monthRuns: number;
  projectedMonthRuns: number;
  perUser: Record<string, { monthRuns: number; projectedMonthRuns: number }>;
  perSchedule: Record<string, { monthRuns: number; projectedMonthRuns: number }>;
}> => {
  const quotas = await resolveQuotas();
  const records = await scanTenantTriggerSchedules();
  const monthKey = currentMonthKey();
  // Per-day chart still comes from `recent_runs` aggregation — that's the
  // only source for daily granularity. But the headline "monthRuns"
  // (actuals total used by the % bar against cap) is read from the atomic
  // counter so it matches the runner's enforcement number exactly.
  const load = aggregateTriggerLoad(records, monthKey, days);
  const windowTotal = load.dailyTotals.reduce((sum, d) => sum + d.total, 0);
  // Cold-start adjustment (strategy A): cap the denominator at the days
  // since the first observed fire. A 22-fire burst on day 1 of a new
  // trigger should NOT dilute to ~23/mo by dividing by 30 — that hid
  // genuinely high-frequency triggers from quota review.
  const companyDaysSinceFirst = daysSinceFirstActivity(load.dailyTotals) ?? days;
  const projectedMonthRuns = projectMonthlyTriggerRuns(windowTotal, days, undefined, companyDaysSinceFirst);
  const monthRunsAtomic = await readTriggerCounter(`trigger_count_company_${monthKey}`);
  const perUser: Record<string, { monthRuns: number; projectedMonthRuns: number }> = {};
  // Per-user actual: read each user's atomic counter row. The set of users
  // that have ever fired comes from `aggregateTriggerLoad.perUser` keys.
  await Promise.all(
    Object.keys(load.perUser).map(async (userId) => {
      const userDaily = load.dailyPerUser[userId] ?? [];
      const userWindow = userDaily.reduce((sum, d) => sum + d.total, 0);
      const userDaysSinceFirst = daysSinceFirstActivity(userDaily) ?? days;
      const userMonthRuns = await readTriggerCounter(`trigger_count_user_${userId}_${monthKey}`);
      perUser[userId] = {
        monthRuns: userMonthRuns,
        projectedMonthRuns: projectMonthlyTriggerRuns(userWindow, days, undefined, userDaysSinceFirst),
      };
    })
  );
  // Per-schedule actuals + projection. No atomic counter exists per-schedule
  // (that would multiply trigger writes — the existing actuals counter is
  // tenant + user only), so monthRuns here comes from the `recent_runs`
  // sum. Projection uses each schedule's own N-day window. Drives the
  // per-row Month/Projected columns in the trigger audit panel; without
  // this every row was showing the owner's TOTAL across all their triggers.
  const perSchedule: Record<string, { monthRuns: number; projectedMonthRuns: number }> = {};
  for (const [scheduleId, scheduleMonthRuns] of Object.entries(load.perSchedule)) {
    const scheduleDaily = load.dailyPerSchedule[scheduleId] ?? [];
    const scheduleWindow = scheduleDaily.reduce((sum, d) => sum + d.total, 0);
    const scheduleDaysSinceFirst = daysSinceFirstActivity(scheduleDaily) ?? days;
    perSchedule[scheduleId] = {
      monthRuns: scheduleMonthRuns,
      projectedMonthRuns: projectMonthlyTriggerRuns(scheduleWindow, days, undefined, scheduleDaysSinceFirst),
    };
  }
  return {
    caps: {
      company: quotas.maxTriggerRunsPerCompanyPerMonth,
      user: quotas.maxTriggerRunsPerUserPerMonth,
    },
    warningThresholdPercent: TRIGGER_WARNING_THRESHOLD_PERCENT,
    monthKey,
    windowDays: days,
    dailyTotals: load.dailyTotals,
    monthRuns: monthRunsAtomic,
    projectedMonthRuns,
    perUser,
    perSchedule,
  };
};

/**
 * Admin-only: approve a pending_approval schedule, transition to active,
 * and create the EventBridge entry.
 *
 * Re-runs the quota check at approve time so a request that landed in
 * pending while the tenant was over the company cap can't be rubber-
 * stamped through. The world may have changed (other schedules paused,
 * the user lowered max_runs, etc.) — if it has improved, approval
 * succeeds; if not, the admin sees a structured 409 with a clear
 * remediation hint.
 */
const approveSchedule = async (auth: AuthContext, scheduleId: string): Promise<ScheduleRecord> => {
  const record = await getScheduleByIdAcrossUsers(scheduleId);
  if (!record) throw Object.assign(new Error('Schedule not found'), { statusCode: 404 });
  if (record.status !== 'pending_approval') {
    throw Object.assign(new Error('Schedule is not pending approval'), { statusCode: 400 });
  }
  if (!record.cron_expression || !record.timezone) {
    throw Object.assign(new Error('Schedule is missing cron / timezone — cannot approve'), { statusCode: 400 });
  }

  // Live re-check at approve time. enforceQuotas excludes the schedule
  // itself so we don't double-count its own projection. We only refuse
  // for company-cap violations — admin approval is by definition the
  // mechanism for breaching the user cap, so a user-scope violation here
  // is the expected case (proceed). Concurrent caps shouldn't trigger
  // since the schedule is currently paused/pending and contributes 0,
  // but if they do we treat as hard refuse — admin can't approve over
  // the tenant's concurrent ceiling either.
  const isEventTrigger = (record.trigger_type ?? 'cron') === 'event';
  const reCheck = await enforceQuotas({
    userSub: record.user_id,
    isEventTrigger,
    projectedRuns: record.projected_runs_per_month ?? 0,
    excludeScheduleId: scheduleId,
  }).catch((err: unknown) => {
    // enforceQuotas only throws for non-approvable violations (concurrent
    // caps + trigger-actuals exhaustion). Re-throw with a clearer
    // approve-time message; the caller's structured payload is preserved.
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const e = err as { statusCode: number; payload?: unknown; message?: string };
      throw Object.assign(new Error(`Cannot approve — ${e.message ?? 'quota check failed'}`), {
        statusCode: 409,
        payload: e.payload,
      });
    }
    throw err;
  });
  if (reCheck.violation && reCheck.violation.scope === 'company') {
    const v = reCheck.violation;
    throw Object.assign(
      new Error(
        `Cannot approve right now — tenant is over its company cap ` +
          `(${v.current.toLocaleString()} + ${(v.requested - v.current).toLocaleString()} requested = ` +
          `${v.requested.toLocaleString()}, cap is ${v.limit.toLocaleString()} runs/month). ` +
          `Pause or delete other active schedules to free up budget, then try again.`
      ),
      {
        statusCode: 409,
        payload: { code: 'COMPANY_CAP_EXCEEDED', violation: v },
      }
    );
  }

  const now = Date.now();
  await scheduler.send(
    new CreateScheduleCommand({
      Name: record.schedule_name,
      GroupName: SCHEDULE_GROUP,
      Description: record.label || `Scheduled agent run for ${record.agent_title || record.agent_id}`,
      ScheduleExpression: record.cron_expression,
      ScheduleExpressionTimezone: record.timezone,
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: buildSchedulerTarget({ scheduleId }),
    })
  );

  // Promote to company quota: a `pending_approval` schedule by definition
  // exceeded the owner's user cap (the only approvable scope — per-agent /
  // concurrent caps are hard). Marking it company-scoped means it'll be
  // counted only against the company total, freeing up the user's personal
  // bucket for further schedules. See `aggregateLoad` in lib/schedule-load.ts.
  const updated = await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { user_id: record.user_id, schedule_id: scheduleId },
      UpdateExpression:
        'SET #status = :active, approved_by = :sub, approved_at = :ts, updated_at = :ts, quota_scope = :scope',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':active': 'active', ':sub': auth.sub, ':ts': now, ':scope': 'company' },
      ReturnValues: 'ALL_NEW',
    })
  );

  // Owner notification — they queued the schedule, an admin approved it.
  // Fire-and-forget; don't block the response on email send.
  void notifyOwnerOfAdminAction({
    record,
    action: 'approved',
    adminEmail: auth.email,
  });

  return updated.Attributes as ScheduleRecord;
};

/** Admin-only: soft-delete a pending_approval schedule. */
const rejectSchedule = async (_auth: AuthContext, scheduleId: string): Promise<void> => {
  const record = await getScheduleByIdAcrossUsers(scheduleId);
  if (!record) throw Object.assign(new Error('Schedule not found'), { statusCode: 404 });
  if (record.status !== 'pending_approval') {
    throw Object.assign(new Error('Schedule is not pending approval'), { statusCode: 400 });
  }
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { user_id: record.user_id, schedule_id: scheduleId },
      UpdateExpression: 'SET #status = :deleted, updated_at = :ts',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':deleted': 'deleted', ':ts': Date.now() },
    })
  );
};
