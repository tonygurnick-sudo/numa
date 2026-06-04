import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { v5 as uuidv5 } from 'uuid';
import { withPRM } from '../../../lib/prm-node/prm';
import { validateScheduleRecord } from '../../../lib/scheduling-schemas';
import {
  VOICE_AGENTS,
  AGENT_IDS,
  VOICE_UUID_NAMESPACE,
  POST_CALL_PROMPT,
  CALL_PREP_PROMPT,
  INGEST_PROMPT,
} from './seed-data';

// Idempotent deploy-time seeder for Numa Voice. Writes the 4 voice agents into
// {client}-agents and the Post-Call Processor event schedule into
// {client}-agent-schedules. Mirrors seed-ops-config (attribute_not_exists puts
// + 10s IAM-propagation sleep). Owned by the tenant system user so the schedule
// runs with admin KB-write access.

const client = withPRM(DynamoDBClient, {});
const dynamo = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});
const cognito = withPRM(CognitoIdentityProviderClient, {});

const AGENTS_TABLE = process.env.AGENTS_TABLE!;
const SCHEDULES_TABLE = process.env.SCHEDULES_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;
const SYSTEM_USER_EMAIL = process.env.SYSTEM_USER_EMAIL || 'numa-system-user@arcanum.ai';
const CLIENT_NAME = process.env.CLIENT_NAME!;

interface SeedResult {
  created: number;
  skipped: number;
  errors: string[];
}

const sleep = (ms: number): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, ms));

// Schedule-record fields that carry RUNTIME state — never overwritten on a
// re-seed (only the create path sets them). Everything else (prompt_text,
// agent_snapshot, trigger/cron, titles) is seed-managed and refreshed.
const PRESERVE_ON_REFRESH = new Set<string>([
  'user_id',
  'schedule_id',
  'status',
  'total_runs',
  'recent_runs',
  'last_run_epoch',
  'last_run_started_epoch',
  'last_run_s3_key',
  'last_run_conversation_id',
  'last_status',
  'last_error',
  'consecutive_failures',
  'created_at',
  'last_quota_blocked_month',
]);

/**
 * Seed a schedule record: create it if absent, otherwise REFRESH the seed-managed
 * fields (prompt_text, agent_snapshot, trigger/cron, titles) while preserving all
 * runtime state. A plain create-if-absent froze the original prompts forever, so
 * the file-format contract / prompt fixes in seed-data.ts never reached existing
 * stacks on re-deploy. This makes them propagate without resetting run history.
 */
async function seedSchedule(item: Record<string, unknown>, id: string, result: SeedResult): Promise<void> {
  try {
    await dynamo.send(
      new PutCommand({
        TableName: SCHEDULES_TABLE,
        Item: item,
        ConditionExpression: 'attribute_not_exists(user_id) AND attribute_not_exists(schedule_id)',
      })
    );
    result.created++;
    return;
  } catch (err: unknown) {
    if (!(err && typeof err === 'object' && 'name' in err && err.name === 'ConditionalCheckFailedException')) {
      result.errors.push(`Failed to seed ${id}: ${String(err)}`);
      return;
    }
  }
  // Record exists — refresh only the seed-managed fields.
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  let i = 0;
  for (const [k, v] of Object.entries(item)) {
    if (PRESERVE_ON_REFRESH.has(k)) continue;
    names[`#k${i}`] = k;
    values[`:v${i}`] = v;
    sets.push(`#k${i} = :v${i}`);
    i += 1;
  }
  if (sets.length === 0) {
    result.skipped++;
    return;
  }
  try {
    await dynamo.send(
      new UpdateCommand({
        TableName: SCHEDULES_TABLE,
        Key: { user_id: item.user_id, schedule_id: item.schedule_id },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
    );
    result.created++;
  } catch (uerr: unknown) {
    result.errors.push(`Failed to refresh ${id}: ${String(uerr)}`);
  }
}

/**
 * Unconditional upsert — used for AGENT records so code changes (system prompt,
 * tools) propagate on re-deploy (the LambdaInvocation re-fires on seedSourceHash).
 * Safe for agents: they carry no runtime counters and the runner re-reads the
 * live record each run. NOT used for schedules (those carry total_runs/status).
 */
async function putUpsert(
  tableName: string,
  item: Record<string, unknown>,
  id: string,
  result: SeedResult
): Promise<void> {
  try {
    await dynamo.send(new PutCommand({ TableName: tableName, Item: item }));
    result.created++;
  } catch (err: unknown) {
    result.errors.push(`Failed to seed ${id}: ${String(err)}`);
  }
}

async function resolveSystemUserSub(): Promise<string> {
  // Bounded retry: guards both the deploy-time ordering race (system-user-creator
  // invocation) and Cognito's own eventual consistency right after AdminCreateUser.
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await cognito.send(
        new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: SYSTEM_USER_EMAIL })
      );
      const sub = resp.UserAttributes?.find((a) => a.Name === 'sub')?.Value;
      if (sub) return sub;
      throw new Error('sub attribute missing from AdminGetUser response');
    } catch (err: unknown) {
      const name = err && typeof err === 'object' && 'name' in err ? (err as { name?: string }).name : undefined;
      const transient = name === 'UserNotFoundException' || name === 'ResourceNotFoundException';
      if (!transient || attempt === maxAttempts) {
        throw new Error(`Could not resolve system user sub for ${SYSTEM_USER_EMAIL}: ${String(err)}`);
      }
      await sleep(5_000);
    }
  }
  throw new Error(`Could not resolve system user sub for ${SYSTEM_USER_EMAIL}`);
}

/**
 * Minimal agent_snapshot for a seeded schedule. Without it the runner's
 * `agentMeta = agentSnapshot || schedule.agent_snapshot` is undefined and
 * refreshAgentSnapshot(undefined) returns null — the agent would run with no
 * system prompt or tools. The runner re-reads the live {client}-agents record
 * each run via agentId, so this only needs to carry the agentId (+ basics).
 */
function snapshotFor(agentId: string): Record<string, unknown> {
  const def = VOICE_AGENTS.find((a) => a.agent_id === agentId);
  return {
    agentId,
    title: def?.title ?? 'Numa Voice',
    toolsConfig: def?.tools_config ?? {},
    visibility: 'public',
  };
}

export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  // IAM is eventually consistent and the invocation fires right after the policy
  // attachment — wait for propagation (same as seed-ops-config).
  console.log('Waiting 10s for IAM policy propagation...');
  await sleep(10_000);

  const result: SeedResult = { created: 0, skipped: 0, errors: [] };
  const now = Date.now();

  const systemSub = await resolveSystemUserSub();
  console.log(`Seeding Numa Voice agents for ${CLIENT_NAME} as system user ${systemSub.slice(0, 8)}…`);

  // Validate the company KB record exists. fetchAccessibleKBIds in the runner only
  // grants 'company' (a system KB) when its row is present, so without it the
  // 7:30am Call List Preparer runs with ZERO KB access — a silent failure. Fail the
  // deploy loudly now instead. A query ERROR is non-fatal (don't self-break the
  // deploy on a transient/permission issue) — only a CONFIRMED-absent row fails.
  const kbTable = process.env.KNOWLEDGE_BASES_TABLE;
  if (kbTable) {
    try {
      const kb = await dynamo.send(
        new GetCommand({ TableName: kbTable, Key: { PK: `TENANT#${CLIENT_NAME}`, SK: 'KB#company' } })
      );
      if (!kb.Item) {
        result.errors.push(
          `Company KB record (PK=TENANT#${CLIENT_NAME}, SK=KB#company) missing in ${kbTable}; ` +
            `the Call List Preparer would run with no KB access. Ensure the default-KB seed runs before the voice seed.`
        );
      }
    } catch (err: unknown) {
      console.warn(`Could not verify company KB record (non-fatal): ${String(err)}`);
    }
  }

  // ── Agents → {client}-agents ──────────────────────────────────────────────
  for (const def of VOICE_AGENTS) {
    const item = {
      tenant_id: CLIENT_NAME,
      agent_id: def.agent_id,
      visibility: 'public',
      agent_type: def.agent_type,
      title: def.title,
      description: def.description,
      system_prompt: def.system_prompt,
      required_integrations: [],
      tools_config: def.tools_config,
      tags: def.tags,
      created_by_user_id: systemSub,
      created_by_name: 'Numa Voice',
      created_at: now,
      updated_at: now,
      version: now,
    };
    // Upsert agents so prompt/tool changes propagate on re-deploy.
    await putUpsert(AGENTS_TABLE, item, def.agent_id, result);
  }

  // ── Post-Call Processor event schedule → {client}-agent-schedules ─────────
  // Deterministic UUIDv5 id so re-deploys upsert (not duplicate). Owned by the
  // system user (admin) so it can write back to the company KB.
  const scheduleId = uuidv5(`postcall-${CLIENT_NAME}`, VOICE_UUID_NAMESPACE);
  const scheduleRecord = validateScheduleRecord({
    user_id: systemSub,
    schedule_id: scheduleId,
    tenant_id: CLIENT_NAME,
    conversation_id: `voice-postcall-${CLIENT_NAME}`,
    prompt_text: POST_CALL_PROMPT,
    trigger_type: 'event',
    trigger: { source: 'connect', event: 'call.completed', include_event_context: true },
    status: 'active',
    event_type: 'agent',
    agent_id: AGENT_IDS.postCall,
    agent_title: 'Post-Call Processor',
    agent_snapshot: snapshotFor(AGENT_IDS.postCall),
    total_runs: 0,
    created_at: now,
    updated_at: now,
    schedule_name: 'Numa Voice — Post-Call Processor',
  });
  await seedSchedule(scheduleRecord as unknown as Record<string, unknown>, `schedule:${scheduleId}`, result);

  // ── Call List Preparer cron schedule → {client}-agent-schedules ───────────
  // Timing is driven by the SchedulerSchedule in NumaVoiceConstruct (which fires
  // the runner with {type:'SCHEDULE', scheduleId}); cron_expression/timezone here
  // satisfy validateScheduleRecord and document the cadence. Same deterministic
  // UUIDv5 the construct computes, so the SchedulerSchedule targets this record.
  // Prefer the construct-passed id (single source of truth — it is also the
  // SchedulerSchedule target, so they cannot drift). Fall back to the local
  // computation only if the env is absent (older deploys / unit tests).
  const callPrepScheduleId =
    process.env.CALL_PREP_SCHEDULE_ID || uuidv5(`callprep-${CLIENT_NAME}`, VOICE_UUID_NAMESPACE);
  const callPrepRecord = validateScheduleRecord({
    user_id: systemSub,
    schedule_id: callPrepScheduleId,
    tenant_id: CLIENT_NAME,
    conversation_id: `voice-callprep-${CLIENT_NAME}`,
    prompt_text: CALL_PREP_PROMPT,
    trigger_type: 'cron',
    // AWS EventBridge 6-field wrapped form required by validateCronExpression;
    // matches the construct's SchedulerSchedule (cron(30 7 * * ? *)).
    cron_expression: 'cron(30 7 * * ? *)',
    timezone: 'Pacific/Auckland',
    status: 'active',
    event_type: 'agent',
    agent_id: AGENT_IDS.callPrep,
    agent_title: 'Call List Preparer',
    agent_snapshot: snapshotFor(AGENT_IDS.callPrep),
    total_runs: 0,
    created_at: now,
    updated_at: now,
    schedule_name: 'Numa Voice — Call List Preparer',
  });
  await seedSchedule(callPrepRecord as unknown as Record<string, unknown>, `schedule:${callPrepScheduleId}`, result);

  // ── Prospect Ingest event schedule (connect / 'prospects.uploaded') ───────
  const ingestScheduleId = uuidv5(`ingest-${CLIENT_NAME}`, VOICE_UUID_NAMESPACE);
  const ingestRecord = validateScheduleRecord({
    user_id: systemSub,
    schedule_id: ingestScheduleId,
    tenant_id: CLIENT_NAME,
    conversation_id: `voice-ingest-${CLIENT_NAME}`,
    prompt_text: INGEST_PROMPT,
    trigger_type: 'event',
    trigger: { source: 'connect', event: 'prospects.uploaded', include_event_context: true },
    status: 'active',
    event_type: 'agent',
    agent_id: AGENT_IDS.ingest,
    agent_title: 'Prospect Ingest',
    agent_snapshot: snapshotFor(AGENT_IDS.ingest),
    total_runs: 0,
    created_at: now,
    updated_at: now,
    schedule_name: 'Numa Voice — Prospect Ingest',
  });
  await seedSchedule(ingestRecord as unknown as Record<string, unknown>, `schedule:${ingestScheduleId}`, result);

  // NOTE: the Qualification Promoter AGENT is seeded (agt_voice_promoter) and
  // available for manual / future use, but it is intentionally NOT given a
  // call.completed event schedule. Firing it concurrently with the Post-Call
  // agent on the same event caused a lost-update race on master_prospects.json
  // (both read-modify-write the whole file). Instead the Post-Call agent is the
  // SINGLE writer per call and performs the qualified→CRM promotion itself.

  const summary = `Numa Voice seed complete: ${result.created} created, ${result.skipped} skipped, ${result.errors.length} errors`;
  console.log(summary);
  if (result.errors.length > 0) {
    console.error('Seed errors:', result.errors);
    // THROW (not statusCode:500) — aws_lambda_invocation only treats a Lambda
    // FunctionError as a failure; a 500-in-body is recorded as SUCCESS, so the
    // deploy would go green with agents/schedules silently missing. Re-applies
    // are safe: writes are conditional/idempotent, so only failed rows re-attempt.
    throw new Error(`Numa Voice seed failed (${result.errors.length} errors): ${result.errors.join('; ')}`);
  }
  return { statusCode: 200, body: JSON.stringify({ message: summary, ...result }) };
};
