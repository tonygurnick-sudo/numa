#!/usr/bin/env -S node --import tsx
/**
 * Bulk-set the per-agent workspace-chat model (model_id) across a client's
 * agents. Built for the Numa Standard Model (DeepSeek V4 Flash) rollout on HQ:
 * agents with no model_id default to Premium (Sonnet 4.6) at runtime, so to
 * move the fleet onto the cheap Standard tier we write model_id explicitly.
 *
 * Touches BOTH agent tables:
 *   • numa-<client>-agents       — workspace / public (shared) agents
 *   • numa-<client>-user-agents  — personal / private agents
 *
 * Default policy PRESERVES explicit picks: only agents that currently resolve to
 * Premium are updated — i.e. model_id is absent OR already the Premium id. Any
 * agent a user deliberately set to Expert (Opus) or Standard is left alone.
 * Pass --force-all to overwrite every agent in scope regardless of current value.
 *
 * model_id is validated against the same curated set the agents Lambda enforces
 * (VALID_AGENT_MODEL_IDS in lambdas/node/agents/index.ts) — an unknown id would
 * normalise to undefined server-side and silently fall back to Premium.
 *
 * Credentials: uses the ambient AWS_PROFILE directly (no assume-role). Run it
 * with the target account's own profile — e.g. HQ is arcanum-prod-numa-demo.
 *
 * Usage:
 *   # Preview HQ → Standard (both tables, dry run is the default):
 *   AWS_PROFILE=arcanum-prod-numa-demo node --import tsx tools/set-agent-models.ts --client hq --model standard
 *
 *   # Apply it:
 *   AWS_PROFILE=arcanum-prod-numa-demo node --import tsx tools/set-agent-models.ts --client hq --model standard --apply
 *
 *   # Only personal agents, overwrite everything incl. explicit Expert picks:
 *   AWS_PROFILE=arcanum-prod-numa-demo node --import tsx tools/set-agent-models.ts \
 *     --client hq --model standard --scope personal --force-all --apply
 */
import { Command } from 'commander';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createRequire } from 'module';

// prm.js compiles to CommonJS — the named ESM import resolves for types but fails
// at runtime (tsx loads the .js as CJS). Mirror tools/utils.ts and require it.
const req = createRequire(import.meta.url);
const prmBundle = req('../lib/prm-node/prm.js');
const withPRM = prmBundle.withPRM || prmBundle.default?.withPRM;

// Friendly tier aliases → curated model ids. Mirrors WORKSPACE_MODEL_OPTIONS_CURATED
// (numa-frontend/src/types/workspaceChatTypes.ts) and VALID_AGENT_MODEL_IDS
// (lambdas/node/agents/index.ts). Keep in sync if the curated tiers change.
const MODEL_ALIASES: Record<string, string> = {
  standard: 'numa-standard-model',
  premium: 'anthropic.claude-sonnet-4-6@medium-thinking',
  expert: 'anthropic.claude-opus-4-6-v1@medium-thinking',
};
const PREMIUM_MODEL_ID = MODEL_ALIASES.premium;
const VALID_MODEL_IDS = new Set(Object.values(MODEL_ALIASES));

type Scope = 'both' | 'workspace' | 'personal';
type Row = Record<string, unknown>;

const program = new Command();
program
  .description("Bulk-set per-agent workspace-chat model (model_id) across a client's agent tables")
  .requiredOption('-c, --client <name>', 'Client name (e.g. hq) — drives table names')
  .requiredOption('-m, --model <tier>', 'Target tier: standard | premium | expert (or a raw curated model id)')
  .option('-r, --region <region>', 'AWS region', 'us-east-1')
  .option('-s, --scope <scope>', 'Which tables: both | workspace | personal', 'both')
  .option('--force-all', 'Overwrite every agent in scope, incl. explicit Expert/Standard picks', false)
  .option('--apply', 'Actually write changes (otherwise dry run)', false)
  .option('--dry-run', 'Preview only, no writes (default; --apply overrides)', true);

function resolveModelId(input: string): string {
  const key = input.trim().toLowerCase();
  if (key in MODEL_ALIASES) return MODEL_ALIASES[key];
  if (VALID_MODEL_IDS.has(input.trim())) return input.trim();
  throw new Error(
    `Invalid --model "${input}". Use one of: ${Object.keys(MODEL_ALIASES).join(', ')} ` +
      `(or a raw curated id: ${[...VALID_MODEL_IDS].join(', ')}).`
  );
}

function makeClients(region: string): { doc: DynamoDBDocumentClient; raw: DynamoDBClient } {
  // Ambient AWS_PROFILE credentials — run with the target account's own profile.
  const raw = withPRM(DynamoDBClient, { region });
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

const currentTier = (row: Row): string => {
  const id = typeof row.model_id === 'string' ? row.model_id : undefined;
  if (!id) return 'premium (unset)';
  const alias = Object.entries(MODEL_ALIASES).find(([, v]) => v === id)?.[0];
  return alias ? alias : `other (${id})`;
};

/** True when this agent should be written, given the target + force policy. */
function shouldUpdate(row: Row, targetId: string, forceAll: boolean): boolean {
  const current = typeof row.model_id === 'string' ? row.model_id : undefined;
  if (current === targetId) return false; // already there — idempotent skip
  if (forceAll) return true;
  // Preserve explicit picks: only touch agents that resolve to Premium today.
  return current === undefined || current === PREMIUM_MODEL_ID;
}

interface TableStats {
  total: number;
  updated: number;
  skippedExplicit: number;
  alreadyTarget: number;
}

async function processTable(
  doc: DynamoDBDocumentClient,
  raw: DynamoDBClient,
  table: string,
  targetId: string,
  forceAll: boolean,
  apply: boolean,
  now: number
): Promise<TableStats> {
  const rows = await scanAll(doc, table);
  const keys = await keyNames(raw, table);
  const stats: TableStats = { total: rows.length, updated: 0, skippedExplicit: 0, alreadyTarget: 0 };

  console.log(`\n${table} — ${rows.length} agent(s):`);
  const sorted = [...rows].sort((a, b) =>
    String(a.title ?? a.agent_id ?? '').localeCompare(String(b.title ?? b.agent_id ?? ''))
  );

  for (const row of sorted) {
    const name = String(row.title ?? row.agent_id ?? '(agent)');
    const current = typeof row.model_id === 'string' ? row.model_id : undefined;

    if (current === targetId) {
      stats.alreadyTarget++;
      continue;
    }
    if (!shouldUpdate(row, targetId, forceAll)) {
      stats.skippedExplicit++;
      console.log(`  ⏭  ${name} — keep ${currentTier(row)} (explicit pick)`);
      continue;
    }

    stats.updated++;
    const targetLabel = Object.keys(MODEL_ALIASES).find((k) => MODEL_ALIASES[k] === targetId) ?? targetId;
    console.log(`  ✏️  ${name} — ${currentTier(row)} → ${targetLabel}`);
    if (!apply) continue;

    const Key = Object.fromEntries(keys.map((k) => [k, row[k]]));
    await doc.send(
      new UpdateCommand({
        TableName: table,
        Key,
        UpdateExpression: 'SET model_id = :m, updated_at = :t',
        ExpressionAttributeValues: { ':m': targetId, ':t': now },
      })
    );
  }
  return stats;
}

async function main(): Promise<void> {
  program.parse();
  const opts = program.opts<{
    client: string;
    model: string;
    region: string;
    scope: Scope;
    forceAll: boolean;
    apply: boolean;
  }>();

  const targetId = resolveModelId(opts.model);
  const targetAlias = Object.keys(MODEL_ALIASES).find((k) => MODEL_ALIASES[k] === targetId) ?? targetId;
  const apply = opts.apply === true;
  const scope = opts.scope;
  if (!['both', 'workspace', 'personal'].includes(scope)) {
    throw new Error(`Invalid --scope "${scope}". Use both | workspace | personal.`);
  }

  console.log(
    `\nset-agent-models — client=${opts.client} region=${opts.region}\n` +
      `target=${targetAlias} (${targetId})  scope=${scope}  ` +
      `policy=${opts.forceAll ? 'force-all' : 'preserve-explicit'}  ` +
      `${apply ? 'APPLY' : 'DRY RUN'}`
  );

  const { doc, raw } = makeClients(opts.region);
  const now = Date.now();

  const tables: string[] = [];
  if (scope === 'both' || scope === 'workspace') tables.push(`numa-${opts.client}-agents`);
  if (scope === 'both' || scope === 'personal') tables.push(`numa-${opts.client}-user-agents`);

  const all: TableStats[] = [];
  for (const table of tables) {
    all.push(await processTable(doc, raw, table, targetId, opts.forceAll, apply, now));
  }

  const sum = (k: keyof TableStats): number => all.reduce((acc, s) => acc + s[k], 0);
  console.log(
    `\nSummary: ${sum('total')} agent(s) scanned — ` +
      `${sum('updated')} ${apply ? 'updated' : 'to update'}, ` +
      `${sum('alreadyTarget')} already ${targetAlias}, ` +
      `${sum('skippedExplicit')} kept (explicit pick).` +
      `${apply ? '' : '\n\nDry run — no writes. Re-run with --apply to commit.'}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
