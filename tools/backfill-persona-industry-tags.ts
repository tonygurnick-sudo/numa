#!/usr/bin/env -S node --import tsx
/**
 * FEAT-127 — seed persona/industry tags on a dev stack so the new audience
 * filtering (agents catalogue, Ops boards, chat KB picker) can be tested.
 *
 * Writes a DETERMINISTIC test matrix rather than tagging everything, so every
 * filter rule is exercised: some resources get a single persona, some a single
 * industry, some both, some multiple values, and some are left untagged (to
 * prove "untagged = visible to all"). Assignment is by sorted index, so the
 * matrix is stable across re-runs (idempotent) and predictable for the run
 * sheet below.
 *
 * Tagged resources (the audience-filterable ones):
 *   • Workspace (public) agents  → numa-<client>-agents
 *   • Ops boards (TEAM META rows) → <client>-ops
 *   • Knowledge bases            → numa-<client>-knowledge-bases
 * Personal agents / My Files KBs are intentionally NOT tagged — the UI never
 * audience-filters a user's own resources, so tagging them proves nothing.
 *
 * Usage:
 *   AWS_PROFILE=q-demo node --import tsx tools/backfill-persona-industry-tags.ts --client arcanum-demo-tom --dry-run
 *   AWS_PROFILE=q-demo node --import tsx tools/backfill-persona-industry-tags.ts --client arcanum-demo-tom
 *
 * After running, set your Profile → Persona/Industry (e.g. Finance +
 * Manufacturing) and watch the three surfaces narrow. See the printed summary
 * for exactly which resources should appear/disappear for a given selection.
 */
import { Command } from 'commander';
import { getClientConfig } from '@arcanumai/client-config';
import type { ClientConfig } from '../infra/stacks/numa-client-stack';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { temporaryCredentials } from './utils';
import type { AWSClientConfig } from './utils';
import { withPRM } from '../lib/prm-node/prm';
import { PERSONAS, INDUSTRIES } from '../lib/resource-taxonomy';

const program = new Command();
program
  .description('Seed persona/industry tags on a dev stack for FEAT-127 testing')
  .option('-c, --client <name>', 'Client name', 'arcanum-demo-tom')
  .option('--dry-run', 'Preview only, no writes', false);

type Row = Record<string, unknown>;
type Tags = { personas: string[]; industries: string[] };

// Deterministic test matrix. Resources are assigned MATRIX[sortedIndex % len].
// Values reference the shared taxonomy so they stay valid if it ever changes.
const P = (...i: number[]): string[] => i.map((n) => PERSONAS[n % PERSONAS.length]);
const I = (...i: number[]): string[] => i.map((n) => INDUSTRIES[n % INDUSTRIES.length]);
const MATRIX: Tags[] = [
  { personas: [], industries: [] }, // untagged → always visible
  { personas: P(1), industries: [] }, // Finance (persona only)
  { personas: P(0), industries: [] }, // CEO (persona only)
  { personas: [], industries: I(0) }, // Manufacturing (industry only)
  { personas: [], industries: I(1) }, // Construction (industry only)
  { personas: P(1), industries: I(0) }, // Finance + Manufacturing (both)
  { personas: P(2), industries: I(2) }, // HR + Engineering (both)
  { personas: P(1, 3), industries: I(0, 3) }, // Finance,Operations + Manufacturing,Professional Services
  { personas: P(0, 4), industries: I(4) }, // CEO,Commercial + Franchise
];

const SYSTEM_KB_IDS = new Set(['company', 'numa-support', 'sharepoint']);

async function getDynamo(clientName: string): Promise<{ doc: DynamoDBDocumentClient; raw: DynamoDBClient }> {
  const cfg = await getClientConfig<ClientConfig>(clientName);
  const credentials = temporaryCredentials(cfg.clientAccountId);
  const aws: AWSClientConfig = { region: cfg.region, credentials };
  const raw = withPRM(DynamoDBClient, aws);
  const doc = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
  });
  return { doc, raw };
}

async function keyNames(raw: DynamoDBClient, table: string): Promise<string[]> {
  const res = await raw.send(new DescribeTableCommand({ TableName: table }));
  return (res.Table?.KeySchema ?? []).map((k) => k.AttributeName as string);
}

async function scanAll(doc: DynamoDBDocumentClient, table: string): Promise<Row[]> {
  const items: Row[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res: { Items?: Row[]; LastEvaluatedKey?: Record<string, unknown> } = await doc.send(
      new ScanCommand({ TableName: table, ExclusiveStartKey: startKey })
    );
    if (res.Items) items.push(...res.Items);
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items;
}

const fmt = (t: Tags): string =>
  t.personas.length === 0 && t.industries.length === 0
    ? '(untagged)'
    : `personas=[${t.personas.join(', ')}] industries=[${t.industries.join(', ')}]`;

/**
 * Tag a set of rows from one table. `label` resolves a human name for the
 * summary, `keys` are the table's key attribute names, `asSet` writes tags as
 * DynamoDB string sets (KB convention) vs lists (agents/ops convention).
 */
async function tagRows(
  doc: DynamoDBDocumentClient,
  table: string,
  keys: string[],
  rows: Row[],
  label: (r: Row) => string,
  asSet: boolean,
  dryRun: boolean
): Promise<void> {
  const sorted = [...rows].sort((a, b) => label(a).localeCompare(label(b)));
  console.log(`\n${table} — ${sorted.length} resource(s):`);
  for (let idx = 0; idx < sorted.length; idx++) {
    const row = sorted[idx];
    const tags = MATRIX[idx % MATRIX.length];
    const toAttr = (vals: string[]): string[] | Set<string> => (asSet && vals.length > 0 ? new Set(vals) : vals); // empty set is invalid in DDB → write empty list
    console.log(`  • ${label(row)} → ${fmt(tags)}`);
    if (dryRun) continue;
    const Key = Object.fromEntries(keys.map((k) => [k, row[k]]));
    await doc.send(
      new UpdateCommand({
        TableName: table,
        Key,
        UpdateExpression: 'SET personas = :p, industries = :i',
        ExpressionAttributeValues: { ':p': toAttr(tags.personas), ':i': toAttr(tags.industries) },
      })
    );
  }
}

async function main(): Promise<void> {
  program.parse();
  const { client, dryRun } = program.opts<{ client: string; dryRun: boolean }>();
  console.log(`\nFEAT-127 tag backfill — client=${client}${dryRun ? ' (DRY RUN)' : ''}\n`);

  const { doc, raw } = await getDynamo(client);

  // 1. Workspace (public) agents — the catalogue + chat "company" section.
  const agentsTable = `numa-${client}-agents`;
  const agentRows = await scanAll(doc, agentsTable);
  await tagRows(
    doc,
    agentsTable,
    await keyNames(raw, agentsTable),
    agentRows,
    (r) => String(r.title ?? r.agent_id ?? r.agentId ?? '(agent)'),
    false,
    dryRun
  );

  // 2. Ops boards — only TEAM META rows (skip tickets/zones/stages).
  const opsTable = `${client}-ops`;
  const opsRows = (await scanAll(doc, opsTable)).filter(
    (r) => String(r.PK ?? '').startsWith('TEAM#') && r.SK === 'META'
  );
  await tagRows(
    doc,
    opsTable,
    await keyNames(raw, opsTable),
    opsRows,
    (r) => String(r.name ?? r.id ?? '(board)'),
    false,
    dryRun
  );

  // 3. Knowledge bases — KB meta rows (SK = KB#<id>), excluding system KBs.
  const kbTable = `numa-${client}-knowledge-bases`;
  const kbRows = (await scanAll(doc, kbTable)).filter((r) => {
    const sk = String(r.SK ?? '');
    return sk.startsWith('KB#') && !SYSTEM_KB_IDS.has(String(r.kb_id ?? sk.slice(3)));
  });
  await tagRows(
    doc,
    kbTable,
    await keyNames(raw, kbTable),
    kbRows,
    (r) => String(r.kb_name ?? r.kb_id ?? '(kb)'),
    true,
    dryRun
  );

  console.log(
    `\nDone.${dryRun ? ' (dry run — no writes)' : ''}\n` +
      `Next: open Profile → set Persona/Industry (e.g. Finance + Manufacturing), save, then\n` +
      `check /agents, the Ops board switcher, and the chat KB picker. Resources whose tags\n` +
      `don't intersect your selection (and that aren't untagged) should disappear.\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
