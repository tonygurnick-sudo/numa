#!/usr/bin/env -S node --import tsx
/**
 * Backfill the buggy "Weekdays" cron expression across every Numa client.
 *
 * Background: the Weekdays preset in the schedule builder used to emit
 *   cron(M H ? * 1-5 *)
 * but AWS EventBridge numbers day-of-week 1=Sun..7=Sat, so `1-5` actually
 * means Sun-Thu, not Mon-Fri. This script rewrites the dow position from
 * `1-5` to `MON-FRI` on every affected schedule across every client.
 *
 * Touches two stores per schedule:
 *   1. DynamoDB row in `numa-{client}-agent-schedules` — `cron_expression` field
 *   2. AWS EventBridge Scheduler entry (only when status === 'active' — paused /
 *      pending / deleted schedules have no Scheduler entry)
 *
 * Usage:
 *   AWS_PROFILE=arcanum-q-deployer-prod yarn workspace @arcanumai/q-apps-deployer-tools backfill-weekdays-cron
 *   AWS_PROFILE=arcanum-q-deployer-prod yarn workspace @arcanumai/q-apps-deployer-tools backfill-weekdays-cron --apply
 *   AWS_PROFILE=arcanum-q-deployer-prod yarn workspace @arcanumai/q-apps-deployer-tools backfill-weekdays-cron --client racetech --apply
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { listClients, getClientConfig } from '@arcanumai/client-config';
import { DynamoDBClient, ResourceNotFoundException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  SchedulerClient,
  GetScheduleCommand,
  UpdateScheduleCommand,
  ResourceNotFoundException as SchedulerResourceNotFoundException,
} from '@aws-sdk/client-scheduler';
import { temporaryCredentials, type AWSClientConfig, type BasicClientConfig } from './utils';

const req = createRequire(import.meta.url);
const prmBundle = req('../lib/prm-node/prm.js');
const withPRM = prmBundle.withPRM || prmBundle.default?.withPRM;

const BUGGY_TOKEN = '1-5';
const FIXED_TOKEN = 'MON-FRI';

interface ScheduleRow {
  user_id: string;
  schedule_id: string;
  cron_expression: string;
  status: string;
  label?: string;
}

interface PlannedChange {
  client: string;
  userId: string;
  scheduleId: string;
  label: string;
  status: string;
  oldCron: string;
  newCron: string;
}

interface ApplyResult extends PlannedChange {
  ddbUpdated: boolean;
  schedulerUpdated: boolean;
  schedulerSkipReason?: string;
  error?: string;
}

/**
 * Tokenise a `cron(min hr dom mo dow yr)` expression. Returns the six fields
 * (without the `cron(...)` wrapper) or null if the input is malformed.
 */
function parseCronFields(expr: string): string[] | null {
  const match = expr.match(/^cron\((.+)\)$/);
  if (!match) return null;
  const fields = match[1].split(/\s+/);
  if (fields.length !== 6) return null;
  return fields;
}

/**
 * Returns the rewritten cron if-and-only-if the input matches the exact
 * "Weekdays" preset shape: any min/hr, dom=`?`, mo=`*`, dow=`1-5`, yr=`*`.
 * Anything else (e.g. `1-5` appearing in a different field) is left alone.
 */
function rewriteWeekdays(expr: string): string | null {
  const fields = parseCronFields(expr);
  if (!fields) return null;
  const [min, hr, dom, mo, dow, yr] = fields;
  if (dom !== '?' || mo !== '*' || dow !== BUGGY_TOKEN || yr !== '*') return null;
  return `cron(${min} ${hr} ${dom} ${mo} ${FIXED_TOKEN} ${yr})`;
}

async function scanAffectedSchedules(doc: DynamoDBDocumentClient, table: string): Promise<ScheduleRow[]> {
  const items: ScheduleRow[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: 'contains(cron_expression, :p)',
        ExpressionAttributeValues: { ':p': BUGGY_TOKEN },
        ExclusiveStartKey: exclusiveStartKey,
      })
    );
    if (res.Items) items.push(...(res.Items as ScheduleRow[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

async function processClient(
  clientName: string,
  apply: boolean
): Promise<{ planned: PlannedChange[]; applied: ApplyResult[]; skipped: string[] }> {
  const planned: PlannedChange[] = [];
  const applied: ApplyResult[] = [];
  const skipped: string[] = [];

  let cfg: BasicClientConfig;
  try {
    cfg = await getClientConfig<BasicClientConfig>(clientName);
  } catch (err) {
    skipped.push(`config lookup failed: ${(err as Error).message}`);
    return { planned, applied, skipped };
  }

  const credentials = temporaryCredentials(cfg.clientAccountId);
  const aws: AWSClientConfig = { region: cfg.region, credentials };

  const ddbClient = withPRM(DynamoDBClient, aws);
  const doc = DynamoDBDocumentClient.from(ddbClient, {
    marshallOptions: { removeUndefinedValues: true },
  });
  const scheduler = withPRM(SchedulerClient, aws);

  const ddbTable = `numa-${clientName}-agent-schedules`;
  const scheduleGroup = `${clientName}-agent-schedules`;

  let rows: ScheduleRow[];
  try {
    rows = await scanAffectedSchedules(doc, ddbTable);
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      skipped.push(`table not found: ${ddbTable}`);
      return { planned, applied, skipped };
    }
    skipped.push(`scan failed: ${(err as Error).message}`);
    return { planned, applied, skipped };
  }

  for (const row of rows) {
    const newCron = rewriteWeekdays(row.cron_expression);
    if (!newCron) continue; // false-positive contains() match — leave it alone

    const change: PlannedChange = {
      client: clientName,
      userId: row.user_id,
      scheduleId: row.schedule_id,
      label: row.label ?? '',
      status: row.status,
      oldCron: row.cron_expression,
      newCron,
    };
    planned.push(change);

    if (!apply) continue;

    const result: ApplyResult = { ...change, ddbUpdated: false, schedulerUpdated: false };

    try {
      await doc.send(
        new UpdateCommand({
          TableName: ddbTable,
          Key: { user_id: row.user_id, schedule_id: row.schedule_id },
          UpdateExpression: 'SET cron_expression = :new, updated_at = :ts',
          ConditionExpression: 'cron_expression = :old',
          ExpressionAttributeValues: { ':new': newCron, ':old': row.cron_expression, ':ts': Date.now() },
        })
      );
      result.ddbUpdated = true;
    } catch (err) {
      result.error = `ddb update failed: ${(err as Error).message}`;
      applied.push(result);
      continue;
    }

    if (row.status !== 'active') {
      result.schedulerSkipReason = `status=${row.status} (no Scheduler entry expected)`;
      applied.push(result);
      continue;
    }

    const scheduleName = `${clientName}-${row.schedule_id}`;
    try {
      const existing = await scheduler.send(new GetScheduleCommand({ Name: scheduleName, GroupName: scheduleGroup }));
      await scheduler.send(
        new UpdateScheduleCommand({
          Name: scheduleName,
          GroupName: scheduleGroup,
          Description: existing.Description,
          ScheduleExpression: newCron,
          ScheduleExpressionTimezone: existing.ScheduleExpressionTimezone,
          FlexibleTimeWindow: existing.FlexibleTimeWindow ?? { Mode: 'OFF' },
          State: existing.State,
          ActionAfterCompletion: existing.ActionAfterCompletion,
          KmsKeyArn: existing.KmsKeyArn,
          StartDate: existing.StartDate,
          EndDate: existing.EndDate,
          Target: existing.Target,
        })
      );
      result.schedulerUpdated = true;
    } catch (err) {
      if (err instanceof SchedulerResourceNotFoundException) {
        result.schedulerSkipReason = 'Scheduler entry not found (status was active but entry missing)';
      } else {
        result.error = `scheduler update failed: ${(err as Error).message}`;
      }
    }
    applied.push(result);
  }

  return { planned, applied, skipped };
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .description('Rewrite buggy "1-5" weekdays cron to "MON-FRI" across every Numa client.')
    .option('-c, --client <name>', 'Restrict to a single client name')
    .option('--apply', 'Actually perform writes (default: dry run)', false);
  program.parse(process.argv);
  const opts = program.opts<{ client?: string; apply: boolean }>();
  const apply = opts.apply;

  console.log(chalk.bold('\nbackfill-weekdays-cron'));
  console.log(`Mode:   ${apply ? chalk.red('APPLY') : chalk.green('DRY RUN')}`);
  console.log(`Client: ${opts.client ?? chalk.cyan('<all>')}\n`);

  const clients = opts.client ? [opts.client] : (await listClients()).sort();
  console.log(`Scanning ${clients.length} client(s)...\n`);

  const allPlanned: PlannedChange[] = [];
  const allApplied: ApplyResult[] = [];
  const clientSkips: Array<{ client: string; reason: string }> = [];

  for (const client of clients) {
    process.stdout.write(`  ${client.padEnd(35)} `);
    const { planned, applied, skipped } = await processClient(client, apply);
    for (const s of skipped) clientSkips.push({ client, reason: s });
    if (skipped.length && planned.length === 0) {
      process.stdout.write(chalk.dim(`(${skipped[0]})\n`));
      continue;
    }
    if (planned.length === 0) {
      process.stdout.write(chalk.dim('clean\n'));
      continue;
    }
    process.stdout.write(chalk.yellow(`${planned.length} schedule(s) affected\n`));
    for (const p of planned) {
      const tag = apply ? '' : chalk.dim(' [dry-run]');
      console.log(
        `      ${chalk.cyan(p.scheduleId)} status=${p.status} label="${p.label}"${tag}\n` +
          `        ${chalk.dim(p.oldCron)}\n` +
          `        ${chalk.green(p.newCron)}`
      );
    }
    if (apply) {
      for (const a of applied) {
        if (a.error) {
          console.log(`      ${chalk.red('ERROR')} ${a.scheduleId}: ${a.error}`);
        } else if (a.schedulerSkipReason) {
          console.log(
            `      ${chalk.dim('OK')}    ${a.scheduleId} ddb=${a.ddbUpdated} scheduler=skipped (${a.schedulerSkipReason})`
          );
        } else {
          console.log(
            `      ${chalk.green('OK')}    ${a.scheduleId} ddb=${a.ddbUpdated} scheduler=${a.schedulerUpdated}`
          );
        }
      }
    }
    allPlanned.push(...planned);
    allApplied.push(...applied);
  }

  // Summary
  console.log(chalk.bold('\nSummary'));
  console.log(`  Clients scanned:       ${clients.length}`);
  console.log(`  Clients skipped:       ${clientSkips.length}`);
  console.log(`  Schedules affected:    ${allPlanned.length}`);
  if (apply) {
    const okDdb = allApplied.filter((a) => a.ddbUpdated && !a.error).length;
    const okSched = allApplied.filter((a) => a.schedulerUpdated && !a.error).length;
    const errors = allApplied.filter((a) => a.error);
    console.log(`  DDB rows updated:      ${okDdb}`);
    console.log(`  Scheduler updated:     ${okSched}`);
    console.log(`  Errors:                ${errors.length}`);
    if (errors.length) {
      console.log(chalk.bold.red('\n  Errors:'));
      for (const e of errors) {
        console.log(`    ${e.client}/${e.scheduleId}: ${e.error}`);
      }
    }
  }
  if (clientSkips.length) {
    console.log(chalk.bold('\n  Clients skipped (no agent-schedules table or config issue):'));
    for (const s of clientSkips) console.log(`    ${s.client}: ${s.reason}`);
  }

  // Audit artefact
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = `dev-notes/tasks/racetech-skipped-schedule/backfill-${apply ? 'apply' : 'dry'}-${ts}.json`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        mode: apply ? 'apply' : 'dry-run',
        clientFilter: opts.client ?? null,
        clientsScanned: clients.length,
        clientsSkipped: clientSkips,
        planned: allPlanned,
        applied: apply ? allApplied : [],
      },
      null,
      2
    )
  );
  console.log(`\n  Audit log: ${chalk.cyan(outPath)}`);

  if (!apply) {
    console.log(chalk.green.bold('\nDry run complete. Re-run with --apply to write changes.'));
  } else {
    console.log(chalk.green.bold('\nDone.'));
  }
}

main().catch((err) => {
  console.error(chalk.red('Fatal:'), err);
  process.exit(1);
});
