#!/usr/bin/env -S node --import tsx
/**
 * BUG-367 — Renumber Ops tickets whose displayId carries the fallback `TKT-`
 * prefix even though their ticketTypeId resolves to a real prefix (e.g. SAL).
 *
 * Root cause: displayId is generated once, at creation, from whatever prefix is
 * resolvable at that moment. Tickets created with no type (or before the type
 * had a prefix) get the `TKT` fallback; assigning/correcting the type later does
 * NOT regenerate the displayId (it is immutable on update by design). The result
 * is a split state: correct type internally, wrong display identity externally.
 *
 * This migration fixes the *existing data*; the creation-time CODE fix lives in
 * numa-ops-api (the create handler now resolves the board's default ticket type
 * before minting the displayId, so new tickets never fall back to `TKT`). The
 * affected rows are TYPELESS (ticketTypeId === null) — NOT already typed — which
 * is why the first cut of this tool was a no-op: its filter required
 * ticketTypeId === <type> and null never matched. For every affected ticket it:
 *   - allocates a fresh sequential number from the new prefix's counter
 *     (`TKT-231` -> `SAL-435`, etc. — fresh numbers, because the old numeric
 *     suffix almost always collides with an existing SAL ticket),
 *   - rewrites `displayId` + `GSI3PK` (`TID#<displayId>`) AND persists
 *     `ticketTypeId` (the previously-missing half — without it the rows stay
 *     typeless and the bug recurs on the next read/create); no other field is
 *     touched, so comments / fields / CRM links / index rows stay intact,
 *   - appends an `updated` audit entry recording the rename + the type assignment,
 *   - bumps the new prefix's `PREFIX` counter so future tickets never collide.
 *
 * Surface area per ticket: `displayId` + `GSI3PK` (`TID#<displayId>`, the by-id
 * lookup — there is no GSI2 DISPLAYID row) + `ticketTypeId`. LINK rows DO
 * denormalise the counterpart's displayId (`linkedTicketDisplayId`, which the UI
 * renders verbatim), so the rename also refreshes the inverse link row on each
 * linked ticket. Comments / fields / CRM links key on ticketId, so they're
 * untouched.
 *
 * SAFE BY DEFAULT: prints the plan and writes nothing unless `--execute` is given.
 *
 * Usage:
 *   # Dry-run (default) — show the exact old -> new mapping, no writes:
 *   AWS_PROFILE=arcanum-prod-numa-demo node --import tsx tools/fix-ops-displayid-prefix.ts --client hq
 *
 *   # Execute the migration:
 *   AWS_PROFILE=arcanum-prod-numa-demo node --import tsx tools/fix-ops-displayid-prefix.ts --client hq --execute
 *
 *   # Verify only (no plan, just assert zero TKT- left for the type):
 *   AWS_PROFILE=arcanum-prod-numa-demo node --import tsx tools/fix-ops-displayid-prefix.ts --client hq --verify-only
 *
 * Defaults target the HQ Sales board / Sales type from BUG-367; override with flags.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

// PRM helper ships a compiled CJS prm.js that the ESM named-import can't see;
// load it via require so the marketplace product code rides on every SDK call.
const require = createRequire(import.meta.url);
const { withPRM } = require('../lib/prm-node/prm.js') as {
  withPRM: <T>(ctor: T, config?: unknown) => InstanceType<T & (new (...args: never[]) => unknown)>;
};

const DEFAULTS = {
  board: '0bd17602-34d1-4363-85c6-34fb020a289b', // HQ Sales board (teamId)
  type: 'tt-4f81c68a', // Sales ticket type
  oldPrefix: 'TKT', // fallback prefix to replace
  newPrefix: 'SAL', // correct prefix for the type
};

const program = new Command();
program
  .description('BUG-367: renumber TKT- display IDs that should carry the ticket-type prefix (e.g. SAL)')
  .requiredOption('-c, --client <name>', 'Client name (e.g. hq) — used to derive the {client}-ops table')
  .option('-r, --region <region>', 'AWS region of the client account', 'us-east-1')
  .option('-b, --board <teamId>', 'Board (team) id to scan', DEFAULTS.board)
  .option('-t, --type <ticketTypeId>', 'Only tickets with this ticketTypeId', DEFAULTS.type)
  .option('--old-prefix <prefix>', 'Fallback prefix to replace', DEFAULTS.oldPrefix)
  .option('--new-prefix <prefix>', 'Correct prefix to assign', DEFAULTS.newPrefix)
  .option('--execute', 'Apply the writes (default is a dry-run preview)', false)
  .option('--verify-only', 'Skip the plan; just report any remaining mismatches', false);

type Row = Record<string, unknown>;

function getDynamo(clientName: string, region: string): { doc: DynamoDBDocumentClient; opsTable: string } {
  // Talk to the client account directly with ambient credentials (AWS_PROFILE).
  // withPRM's generic return resolves to `unknown`, so pin it to the real type.
  const client = withPRM(DynamoDBClient, { region }) as DynamoDBClient;
  const doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
  });
  return { doc, opsTable: `${clientName}-ops` };
}

async function queryBoardTickets(doc: DynamoDBDocumentClient, table: string, teamId: string): Promise<Row[]> {
  const items: Row[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res: { Items?: Row[]; LastEvaluatedKey?: Record<string, unknown> } = await doc.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        FilterExpression: 'entityType = :t',
        ExpressionAttributeValues: { ':pk': `TEAM#${teamId}`, ':sk': 'TICKET#', ':t': 'TICKET' },
        ExclusiveStartKey: exclusiveStartKey,
      })
    );
    if (res.Items) items.push(...res.Items);
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

// All LINK rows hanging off a single ticket (both directions of each link).
async function queryLinks(doc: DynamoDBDocumentClient, table: string, ticketId: string): Promise<Row[]> {
  const res: { Items?: Row[] } = await doc.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `TICKET#${ticketId}`, ':sk': 'LINK#' },
    })
  );
  return res.Items ?? [];
}

// LINK rows denormalise the counterpart's displayId (`linkedTicketDisplayId`),
// and the UI renders that stored value verbatim — so renaming a ticket leaves a
// stale `TKT-` id on whoever links TO it. Links are bidirectional, so the renamed
// ticket's own LINK rows name each counterpart (`linkedTicketId`); on that
// counterpart we refresh the single row that points back at us. Returns the count
// found (writes only when execute=true). Read-only in dry-run, so it doubles as
// the preview of how many link rows the rename would touch.
async function fixInverseLinks(
  doc: DynamoDBDocumentClient,
  table: string,
  ticketId: string,
  oldDisplayId: string,
  newDisplayId: string,
  execute: boolean
): Promise<number> {
  let fixed = 0;
  for (const own of await queryLinks(doc, table, ticketId)) {
    const otherId = String(own.linkedTicketId ?? '');
    if (!otherId) continue;
    for (const back of await queryLinks(doc, table, otherId)) {
      if (String(back.linkedTicketId ?? '') !== ticketId) continue;
      if (String(back.linkedTicketDisplayId ?? '') !== oldDisplayId) continue;
      if (execute) {
        await doc.send(
          new UpdateCommand({
            TableName: table,
            Key: { PK: `TICKET#${otherId}`, SK: String(back.SK) },
            UpdateExpression: 'SET linkedTicketDisplayId = :n',
            ConditionExpression: 'linkedTicketDisplayId = :o',
            ExpressionAttributeValues: { ':n': newDisplayId, ':o': oldDisplayId },
          })
        );
      }
      fixed++;
    }
  }
  return fixed;
}

type Affected = { ticket: Row; ticketId: string; oldDisplayId: string; createdAt: string };

function findAffected(tickets: Row[], type: string, oldPrefix: string): Affected[] {
  return tickets
    .filter((t) => {
      const displayId = String(t.displayId ?? '');
      if (!displayId.startsWith(`${oldPrefix}-`)) return false;
      // The real affected set is TYPELESS tickets — ticketTypeId was never
      // persisted at creation (the root cause), so the rows store null — PLUS any
      // that already carry the target type. The original filter required
      // ticketTypeId === type, which matched NOTHING (null !== type) — that is
      // exactly why the first migration ran as a no-op.
      const stored = String(t.ticketTypeId ?? '');
      return stored === '' || stored === type;
    })
    .map((t) => ({
      ticket: t,
      ticketId: String(t.id ?? ''),
      oldDisplayId: String(t.displayId ?? ''),
      createdAt: String(t.createdAt ?? ''),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // preserve creation order
}

async function readCounter(doc: DynamoDBDocumentClient, table: string, prefix: string): Promise<number> {
  const res = await doc.send(new GetCommand({ TableName: table, Key: { PK: 'PREFIX', SK: prefix } }));
  return (res.Item?.nextSequence as number) ?? 0;
}

const fmtId = (prefix: string, seq: number): string => `${prefix}-${String(seq).padStart(3, '0')}`;

async function main(): Promise<void> {
  program.parse();
  const opts = program.opts<{
    client: string;
    region: string;
    board: string;
    type: string;
    oldPrefix: string;
    newPrefix: string;
    execute: boolean;
    verifyOnly: boolean;
  }>();

  const { doc, opsTable } = getDynamo(opts.client, opts.region);
  const tag = `[${opts.client}]`;

  // ── Verify-only: report any remaining mismatches and exit ────────────────────
  if (opts.verifyOnly) {
    const tickets = await queryBoardTickets(doc, opsTable, opts.board);
    const remaining = findAffected(tickets, opts.type, opts.oldPrefix);
    if (remaining.length === 0) {
      console.log(`${tag} ✓ verification passed: zero ${opts.oldPrefix}- tickets remain for type ${opts.type}`);
    } else {
      console.log(`${tag} ✗ verification FAILED: ${remaining.length} ${opts.oldPrefix}- ticket(s) still present:`);
      for (const a of remaining) console.log(`    ${a.oldDisplayId}  ${String(a.ticket.title ?? '')}`);
      process.exitCode = 1;
    }
    return;
  }

  console.log(`${tag} Scanning board ${opts.board} in ${opsTable}...`);
  const tickets = await queryBoardTickets(doc, opsTable, opts.board);
  const affected = findAffected(tickets, opts.type, opts.oldPrefix);
  console.log(
    `${tag} ${tickets.length} ticket(s) on board; ${affected.length} affected (${opts.oldPrefix}- + type ${opts.type}).`
  );

  if (affected.length === 0) {
    console.log(`${tag} Nothing to do.`);
    return;
  }

  // ── Reserve a contiguous block of new numbers ────────────────────────────────
  // Dry-run projects from the current counter; --execute atomically reserves the
  // block (ADD ... ReturnValues ALL_NEW) so concurrent creates can't collide.
  const n = affected.length;
  let ceiling: number; // highest reserved sequence
  if (opts.execute) {
    const res = await doc.send(
      new UpdateCommand({
        TableName: opsTable,
        Key: { PK: 'PREFIX', SK: opts.newPrefix },
        UpdateExpression: 'ADD nextSequence :n',
        ExpressionAttributeValues: { ':n': n },
        ReturnValues: 'ALL_NEW',
      })
    );
    ceiling = res.Attributes?.nextSequence as number;
    console.log(
      `${tag} Reserved ${opts.newPrefix} block: ${fmtId(opts.newPrefix, ceiling - n + 1)} … ${fmtId(opts.newPrefix, ceiling)} (counter now ${ceiling}).`
    );
  } else {
    const current = await readCounter(doc, opsTable, opts.newPrefix);
    ceiling = current + n;
    console.log(
      `${tag} ${opts.newPrefix} counter at ${current}; would reserve ${fmtId(opts.newPrefix, current + 1)} … ${fmtId(opts.newPrefix, ceiling)}.`
    );
  }
  const base = ceiling - n; // numbers are base+1 … base+n, in creation order

  // ── Plan / apply ─────────────────────────────────────────────────────────────
  console.log(`${tag} ${opts.execute ? 'APPLYING' : 'DRY-RUN — would apply'} ${n} rename(s):`);
  const ts0 = new Date().toISOString();
  let done = 0;
  let totalLinks = 0;
  for (let i = 0; i < affected.length; i++) {
    const a = affected[i];
    const newDisplayId = fmtId(opts.newPrefix, base + i + 1);
    console.log(`    ${a.oldDisplayId.padEnd(9)} -> ${newDisplayId.padEnd(9)}  ${String(a.ticket.title ?? '')}`);

    // Refresh any inverse LINK rows that denormalise this ticket's old displayId.
    // Read-only in dry-run (counts only); writes with --execute.
    const linksFixed = await fixInverseLinks(doc, opsTable, a.ticketId, a.oldDisplayId, newDisplayId, opts.execute);
    if (linksFixed > 0) {
      totalLinks += linksFixed;
      console.log(`        ${opts.execute ? 'updated' : 'would update'} ${linksFixed} inverse link row(s)`);
    }

    if (!opts.execute) continue;

    // 1) Rewrite displayId + GSI3PK AND persist ticketTypeId. The original
    //    migration set only displayId, leaving the rows typeless — so the bug
    //    recurred on the next read/create and the displayId-vs-type mismatch
    //    stayed unresolved. updatedAt is deliberately left untouched so the IDX_*
    //    rows (GSI2SK = TICKET#<updatedAt>#<id>) stay consistent.
    await doc.send(
      new UpdateCommand({
        TableName: opsTable,
        Key: { PK: `TEAM#${opts.board}`, SK: `TICKET#${a.ticketId}` },
        UpdateExpression: 'SET displayId = :d, GSI3PK = :g, ticketTypeId = :tt',
        ConditionExpression: 'attribute_exists(PK) AND displayId = :old',
        ExpressionAttributeValues: {
          ':d': newDisplayId,
          ':g': `TID#${newDisplayId}`,
          ':tt': opts.type,
          ':old': a.oldDisplayId,
        },
      })
    );

    // 2) Audit entry (action 'updated', mirrors the API's change shape).
    const auditId = randomUUID();
    const ts = new Date().toISOString();
    await doc.send(
      new PutCommand({
        TableName: opsTable,
        Item: {
          PK: `TICKET#${a.ticketId}`,
          SK: `AUDIT#${ts}#${auditId}`,
          entityType: 'AUDIT',
          auditId,
          ticketId: a.ticketId,
          action: 'updated',
          changes: {
            displayId: { from: a.oldDisplayId, to: newDisplayId },
            ticketTypeId: { from: a.ticket.ticketTypeId ?? null, to: opts.type },
          },
          performedBy: 'bug-367-migration',
          performedByName: 'BUG-367 displayId migration',
          note: 'Renumbered fallback prefix to ticket-type prefix (BUG-367)',
          createdAt: ts,
        },
      })
    );
    done++;
  }

  if (!opts.execute) {
    console.log(
      `${tag} Dry-run complete — no writes (${totalLinks} inverse link row(s) would also be refreshed). Re-run with --execute to apply.`
    );
    return;
  }

  // ── Post-migration verification ──────────────────────────────────────────────
  console.log(`${tag} Applied ${done} rename(s) + ${totalLinks} link refresh(es) (started ${ts0}). Verifying...`);
  const after = await queryBoardTickets(doc, opsTable, opts.board);
  const remaining = findAffected(after, opts.type, opts.oldPrefix);
  if (remaining.length === 0) {
    console.log(`${tag} ✓ verification passed: zero ${opts.oldPrefix}- tickets remain for type ${opts.type}.`);
  } else {
    console.log(`${tag} ✗ verification FAILED: ${remaining.length} still present:`);
    for (const a of remaining) console.log(`    ${a.oldDisplayId}  ${String(a.ticket.title ?? '')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
