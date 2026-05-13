#!/usr/bin/env -S node --import tsx
/**
 * Backfill zone.activeWorkUnitId for the zone-bound sprint model.
 *
 * For each team in a client's ops table:
 *   - Find any work unit with status === 'active'
 *   - Find the first board zone (sorted by order)
 *   - Set zone.activeWorkUnitId = activeSprint.id
 *   - For every ticket sitting in that zone with a different workUnitId,
 *     reset its workUnitId to the active sprint's id and update the
 *     GSI2 IDX_WORKUNIT index entry.
 *
 * Usage:
 *   AWS_PROFILE=arcanum-prod-numa-demo node --import tsx tools/backfill-ops-sprint-zones.ts --client hq
 *   AWS_PROFILE=q-demo node --import tsx tools/backfill-ops-sprint-zones.ts --client nd-labs --dry-run
 */
import { Command } from 'commander';
import { getClientConfig } from '@arcanumai/client-config';
import type { ClientConfig } from '../infra/stacks/numa-client-stack';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { temporaryCredentials } from './utils';
import type { AWSClientConfig } from './utils';
import { withPRM } from '../lib/prm-node/prm';

const program = new Command();
program
  .description('Backfill zone.activeWorkUnitId for the zone-bound sprint model')
  .requiredOption('-c, --client <name>', 'Client name (e.g. hq, nd-labs)')
  .option('--dry-run', 'Preview only, no writes', false);

type Row = Record<string, unknown>;

async function getDynamo(clientName: string): Promise<{ doc: DynamoDBDocumentClient; opsTable: string }> {
  const cfg = await getClientConfig<ClientConfig>(clientName);
  const credentials = temporaryCredentials(cfg.clientAccountId);
  const aws: AWSClientConfig = { region: cfg.region, credentials };
  const client = withPRM(DynamoDBClient, aws);
  const doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
  });
  return { doc, opsTable: `${clientName}-ops` };
}

async function queryAllByPk(doc: DynamoDBDocumentClient, table: string, pk: string): Promise<Row[]> {
  const items: Row[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res: { Items?: Row[]; LastEvaluatedKey?: Record<string, unknown> } = await doc.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ExclusiveStartKey: exclusiveStartKey,
      })
    );
    if (res.Items) items.push(...res.Items);
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

async function listTeams(doc: DynamoDBDocumentClient, table: string): Promise<Row[]> {
  // GSI1: PK=TEAMS, SK=ORDER#...
  const items: Row[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res: { Items?: Row[]; LastEvaluatedKey?: Record<string, unknown> } = await doc.send(
      new QueryCommand({
        TableName: table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': 'TEAMS' },
        ExclusiveStartKey: exclusiveStartKey,
      })
    );
    if (res.Items) items.push(...res.Items);
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

async function backfillForClient(clientName: string, dryRun: boolean): Promise<void> {
  const { doc, opsTable } = await getDynamo(clientName);
  console.log(`[${clientName}] Scanning ${opsTable}...`);

  const teams = await listTeams(doc, opsTable);
  console.log(`[${clientName}] Found ${teams.length} teams`);

  let zonesUpdated = 0;
  let ticketsUpdated = 0;

  for (const team of teams) {
    const teamId = String(team.id ?? '');
    if (!teamId) continue;
    const teamName = String(team.name ?? '<unnamed>');

    const teamItems = await queryAllByPk(doc, opsTable, `TEAM#${teamId}`);
    const zones = teamItems
      .filter((i) => String(i.SK ?? '').startsWith('ZONE#'))
      .sort((a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0));
    const workUnits = teamItems.filter((i) => String(i.SK ?? '').startsWith('WORKUNIT#'));
    const tickets = teamItems.filter((i) => {
      const sk = String(i.SK ?? '');
      return sk.startsWith('TICKET#') && !sk.includes('#IDX_') && !sk.includes('#AUDIT#') && !sk.includes('#COMMENT#');
    });

    const activeSprint = workUnits.find((w) => String(w.status) === 'active');
    if (!activeSprint) {
      console.log(`[${clientName}] team=${teamName} no active sprint, skipping`);
      continue;
    }

    const firstBoardZone = zones.find((z) => String(z.zoneType) === 'board');
    if (!firstBoardZone) {
      console.log(`[${clientName}] team=${teamName} no board zone, skipping`);
      continue;
    }

    const sprintId = String(activeSprint.id);
    const boardZoneId = String(firstBoardZone.id);
    const currentActiveWuId = firstBoardZone.activeWorkUnitId ? String(firstBoardZone.activeWorkUnitId) : null;
    const now = new Date().toISOString();

    if (currentActiveWuId !== sprintId) {
      console.log(
        `[${clientName}] team=${teamName} board zone "${String(firstBoardZone.name)}" -> activeWorkUnitId=${sprintId} (${String(activeSprint.name)})`
      );
      if (!dryRun) {
        await doc.send(
          new PutCommand({
            TableName: opsTable,
            Item: { ...firstBoardZone, activeWorkUnitId: sprintId, updatedAt: now },
          })
        );
      }
      zonesUpdated += 1;
    }

    // Fix tickets in the board zone whose workUnitId doesn't match
    const mismatched = tickets.filter(
      (t) => String(t.zoneId ?? '') === boardZoneId && String(t.workUnitId ?? '') !== sprintId
    );
    for (const ticket of mismatched) {
      const ticketId = String(ticket.id ?? '');
      console.log(
        `  [ticket] ${String(ticket.displayId ?? ticketId)} workUnitId ${String(ticket.workUnitId ?? 'null')} -> ${sprintId}`
      );
      if (!dryRun) {
        await doc.send(
          new PutCommand({
            TableName: opsTable,
            Item: { ...ticket, workUnitId: sprintId, updatedAt: now },
          })
        );
        // Replace IDX_WORKUNIT row
        try {
          await doc.send(
            new DeleteCommand({
              TableName: opsTable,
              Key: { PK: `TEAM#${teamId}`, SK: `TICKET#${ticketId}#IDX_WORKUNIT` },
            })
          );
        } catch {
          /* may not exist */
        }
        await doc.send(
          new PutCommand({
            TableName: opsTable,
            Item: {
              PK: `TEAM#${teamId}`,
              SK: `TICKET#${ticketId}#IDX_WORKUNIT`,
              GSI2PK: `WORKUNIT#${sprintId}`,
              GSI2SK: `TICKET#${now}#${ticketId}`,
              entityType: 'TICKET_INDEX',
              indexType: 'IDX_WORKUNIT',
              ticketId,
              teamId,
              workUnitId: sprintId,
            },
          })
        );
      }
      ticketsUpdated += 1;
    }
  }

  console.log(
    `[${clientName}] done: ${zonesUpdated} zone(s), ${ticketsUpdated} ticket(s) ${dryRun ? '(dry-run, no writes)' : 'updated'}`
  );
}

async function main(): Promise<void> {
  program.parse();
  const opts = program.opts<{ client: string; dryRun: boolean }>();
  await backfillForClient(opts.client, opts.dryRun);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
