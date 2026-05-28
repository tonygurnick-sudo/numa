/**
 * Numa Ops recurrence runner.
 *
 * Fired by EventBridge Scheduler whenever a recurring ticket's cron lands.
 * The cron only represents *candidate* fire times — interval semantics,
 * startDate / endDate / maxOccurrences are evaluated here so we can update
 * a single source of truth (the DynamoDB recurrence record) without
 * worrying about schedule-deletion timing.
 *
 * Flow per invocation:
 *   1. Validate event payload + load recurrence record
 *   2. Gate: enabled, shouldFireNow, runCount < maxOccurrences, today ≤ endDate
 *   3. Load template ticket snapshot
 *   4. Invoke numa-ops-api Lambda with a synthesized POST /ops/tickets event,
 *      passing userContext for the original template creator so audit/
 *      reporter attribution is correct
 *   5. Record the run (lastRunAt, nextRunAt, runCount++)
 *   6. If this was the terminal run (maxOccurrences hit or endDate passed),
 *      disable the recurrence and delete its schedule
 *
 * Errors that prevent ticket creation propagate so EventBridge Scheduler
 * retries per its RetryPolicy. Errors that indicate the recurrence is
 * permanently broken (template ticket deleted, etc.) self-disable so the
 * scheduler stops firing.
 */

import type { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SchedulerClient, DeleteScheduleCommand, ResourceNotFoundException } from '@aws-sdk/client-scheduler';
import { computeNextFireAt, shouldFireNow, ymdInZone } from '../../../lib/ops-recurrence';
import type { RecurrenceConfig } from '../../../lib/ops-schemas';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const OPS_TABLE = process.env.OPS_TABLE ?? '';
const OPS_API_LAMBDA_ARN = process.env.OPS_API_LAMBDA_ARN ?? '';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});
const lambdaClient = new LambdaClient({ region: REGION });
const scheduler = new SchedulerClient({ region: REGION });

// ─── Types ──────────────────────────────────────────────────────────────────────

type SchedulerEvent = {
  type?: string;
  recurrenceId?: string;
  tenantId?: string;
};

type RecurrenceRecord = {
  PK: string;
  SK: string;
  id: string;
  templateTicketId: string;
  boardId: string;
  ticketTypeId: string;
  targetZoneId: string;
  targetStageId: string;
  config: RecurrenceConfig;
  scheduleName: string;
  scheduleGroup: string;
  enabled: boolean;
  runCount: number;
  lastRunAt?: string;
  nextRunAt?: string;
  lastError?: string;
  createdBy: string;
  createdByName: string;
};

type TicketRecord = Record<string, unknown> & {
  id: string;
  teamId: string;
  ticketTypeId?: string;
  title?: string;
  description?: string;
  priority?: string;
  assigneeId?: string;
  assigneeName?: string;
  reporterId?: string;
  reporterName?: string;
  customerId?: string;
  customerName?: string;
  supplierId?: string;
  supplierName?: string;
  projectId?: string;
  effortPoints?: number;
  fields?: Record<string, unknown>;
  tags?: string[];
};

// ─── Handler ────────────────────────────────────────────────────────────────────

export const handler: Handler<SchedulerEvent, { ok: boolean; reason?: string }> = async (event) => {
  if (!OPS_TABLE || !OPS_API_LAMBDA_ARN) {
    throw new Error('Recurrence runner missing OPS_TABLE or OPS_API_LAMBDA_ARN env');
  }
  if (event.type !== 'OPS_RECURRENCE' || !event.recurrenceId) {
    console.warn('[ops-recurrence-runner] unexpected payload', event);
    return { ok: false, reason: 'invalid_event' };
  }
  const recurrenceId = event.recurrenceId;

  const rule = await getRecurrence(recurrenceId);
  if (!rule) {
    console.warn('[ops-recurrence-runner] recurrence not found, deleting orphan schedule', { recurrenceId });
    // Don't throw — the schedule will keep firing until we delete it. Best-effort cleanup:
    try {
      await scheduler.send(
        new DeleteScheduleCommand({
          Name: recurrenceId,
          GroupName: process.env.OPS_RECURRENCE_SCHEDULER_GROUP ?? '',
        })
      );
    } catch (err) {
      if (!(err instanceof ResourceNotFoundException)) {
        console.warn('[ops-recurrence-runner] orphan schedule delete failed', { error: (err as Error).message });
      }
    }
    return { ok: false, reason: 'recurrence_not_found' };
  }

  if (!rule.enabled) {
    console.log('[ops-recurrence-runner] recurrence disabled, skipping', { recurrenceId });
    return { ok: false, reason: 'disabled' };
  }

  const now = new Date();

  // Honour interval / startDate / endDate.
  if (!shouldFireNow(rule.config, now)) {
    console.log('[ops-recurrence-runner] off-interval candidate fire, skipping', {
      recurrenceId,
      today: ymdInZone(now, rule.config.timezone),
      startDate: rule.config.startDate,
      interval: rule.config.interval,
      pattern: rule.config.pattern,
    });
    // Still update nextRunAt so the UI stays accurate.
    const next = computeNextFireAt(rule.config, now);
    await touchNextRunAt(recurrenceId, next);
    return { ok: false, reason: 'off_interval' };
  }

  // Honour endDate: shouldFireNow already covers this, but we also need to
  // disable the rule when the boundary is crossed so we stop firing forever.
  if (rule.config.endDate && ymdInZone(now, rule.config.timezone) > rule.config.endDate) {
    await terminateRecurrence(rule, 'endDate reached');
    return { ok: false, reason: 'past_end_date' };
  }

  // Honour maxOccurrences. We check >= so the Nth fire still creates a ticket,
  // and the post-fire branch below terminates after that creation.
  if (rule.config.maxOccurrences != null && rule.runCount >= rule.config.maxOccurrences) {
    await terminateRecurrence(rule, 'maxOccurrences reached');
    return { ok: false, reason: 'max_occurrences' };
  }

  // Load the template ticket. If it's missing or soft-deleted, the
  // recurrence is permanently broken — terminate.
  const template = await getTemplateTicket(rule);
  if (!template || template.statusType === 'deleted') {
    await terminateRecurrence(rule, 'template ticket missing or deleted');
    return { ok: false, reason: 'template_missing' };
  }

  // Spawn the new ticket via the ops API. Throws on failure → Scheduler retries.
  await spawnTicket(rule, template);

  // Record the successful fire.
  const next = computeNextFireAt(rule.config, new Date(now.getTime() + 1000));
  await recordRun(recurrenceId, now.toISOString(), next);

  // Post-fire termination check (runCount on the record is now runCount + 1).
  const newRunCount = rule.runCount + 1;
  if (rule.config.maxOccurrences != null && newRunCount >= rule.config.maxOccurrences) {
    await terminateRecurrence(rule, 'maxOccurrences reached after final fire');
    return { ok: true, reason: 'final_run' };
  }
  if (!next) {
    // No further occurrences in the next 5y — likely past endDate after this run.
    await terminateRecurrence(rule, 'no further occurrences');
    return { ok: true, reason: 'no_more_occurrences' };
  }

  return { ok: true };
};

// ─── DynamoDB helpers ───────────────────────────────────────────────────────────

async function getRecurrence(recurrenceId: string): Promise<RecurrenceRecord | null> {
  const result = await dynamo.send(
    new GetCommand({ TableName: OPS_TABLE, Key: { PK: `RECURRENCE#${recurrenceId}`, SK: 'META' } })
  );
  return (result.Item as RecurrenceRecord | undefined) ?? null;
}

async function getTemplateTicket(rule: RecurrenceRecord): Promise<TicketRecord | null> {
  const result = await dynamo.send(
    new GetCommand({
      TableName: OPS_TABLE,
      Key: { PK: `TEAM#${rule.boardId}`, SK: `TICKET#${rule.templateTicketId}` },
    })
  );
  return (result.Item as TicketRecord | undefined) ?? null;
}

async function recordRun(recurrenceId: string, lastRunAt: string, nextFire: Date | null): Promise<void> {
  const sets: string[] = ['lastRunAt = :lastRunAt', 'updatedAt = :updatedAt', 'lastError = :nullError'];
  const values: Record<string, unknown> = {
    ':lastRunAt': lastRunAt,
    ':updatedAt': lastRunAt,
    ':one': 1,
    ':nullError': null,
  };
  if (nextFire) {
    sets.push('nextRunAt = :nextRunAt');
    values[':nextRunAt'] = nextFire.toISOString();
  }
  await dynamo.send(
    new UpdateCommand({
      TableName: OPS_TABLE,
      Key: { PK: `RECURRENCE#${recurrenceId}`, SK: 'META' },
      UpdateExpression: `SET ${sets.join(', ')} ADD runCount :one`,
      ExpressionAttributeValues: values,
    })
  );
}

async function touchNextRunAt(recurrenceId: string, nextFire: Date | null): Promise<void> {
  if (!nextFire) return;
  await dynamo.send(
    new UpdateCommand({
      TableName: OPS_TABLE,
      Key: { PK: `RECURRENCE#${recurrenceId}`, SK: 'META' },
      UpdateExpression: 'SET nextRunAt = :n',
      ExpressionAttributeValues: { ':n': nextFire.toISOString() },
    })
  );
}

async function terminateRecurrence(rule: RecurrenceRecord, reason: string): Promise<void> {
  console.log('[ops-recurrence-runner] terminating recurrence', { recurrenceId: rule.id, reason });
  try {
    await scheduler.send(new DeleteScheduleCommand({ Name: rule.scheduleName, GroupName: rule.scheduleGroup }));
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) {
      console.warn('[ops-recurrence-runner] schedule delete during termination failed', {
        error: (err as Error).message,
      });
    }
  }
  await dynamo.send(
    new UpdateCommand({
      TableName: OPS_TABLE,
      Key: { PK: rule.PK, SK: rule.SK },
      UpdateExpression: 'SET enabled = :false, lastError = :reason, updatedAt = :now',
      ExpressionAttributeValues: { ':false': false, ':reason': reason, ':now': new Date().toISOString() },
    })
  );
}

// ─── Spawning the next ticket ───────────────────────────────────────────────────

async function spawnTicket(rule: RecurrenceRecord, template: TicketRecord): Promise<void> {
  // Synthesize a POST /ops/tickets event for direct invocation of numa-ops-api.
  // userContext bypasses JWT auth — the ops-api Lambda accepts pre-authenticated
  // calls from sibling services (see resolveAuthContext in numa-ops-api/index.ts).
  const body = {
    boardId: rule.boardId,
    stageId: rule.targetStageId,
    zoneId: rule.targetZoneId,
    ticketTypeId: rule.ticketTypeId || template.ticketTypeId,
    title: template.title ?? 'Untitled',
    description: template.description ?? '',
    priority: template.priority ?? 'medium',
    assigneeId: template.assigneeId ?? null,
    assigneeName: template.assigneeName ?? null,
    reporterId: template.reporterId ?? rule.createdBy,
    reporterName: template.reporterName ?? rule.createdByName,
    customerId: template.customerId ?? null,
    customerName: template.customerName ?? null,
    supplierId: template.supplierId ?? null,
    supplierName: template.supplierName ?? null,
    projectId: template.projectId ?? null,
    effortPoints: template.effortPoints ?? null,
    fields: template.fields ?? {},
    tags: template.tags ?? [],
    sourceType: 'recurrence',
    sourceId: rule.id,
  };

  const event = {
    requestContext: {
      http: { method: 'POST', path: '/api/ops/tickets' },
    },
    rawPath: '/api/ops/tickets',
    headers: {},
    body: JSON.stringify(body),
    userContext: {
      sub: rule.createdBy,
      name: rule.createdByName,
      groups: [],
    },
  };

  const resp = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: OPS_API_LAMBDA_ARN,
      InvocationType: 'RequestResponse',
      Payload: new TextEncoder().encode(JSON.stringify(event)),
    })
  );
  if (resp.FunctionError) {
    throw new Error(`ops-api returned FunctionError: ${resp.FunctionError}`);
  }
  const payloadText = resp.Payload ? new TextDecoder().decode(resp.Payload) : '';
  let parsed: { statusCode?: number; body?: string };
  try {
    parsed = JSON.parse(payloadText) as { statusCode?: number; body?: string };
  } catch {
    throw new Error(`ops-api returned non-JSON payload: ${payloadText.slice(0, 200)}`);
  }
  if (!parsed.statusCode || parsed.statusCode >= 400) {
    throw new Error(`ops-api returned ${parsed.statusCode ?? 'no'} status: ${parsed.body ?? ''}`);
  }
}

// ─── Test surface ───────────────────────────────────────────────────────────────

export const _internals = { getRecurrence, getTemplateTicket, dynamo };
