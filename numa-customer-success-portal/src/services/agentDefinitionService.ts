/**
 * Agent-definition export for the CS dashboard.
 *
 * Given an agent id (from a `PerAgentStats` row), this assumes the
 * `ArcanumAIAccess` role into the client account and fetches the full agent
 * record — looking in the workspace agents table first, then the personal
 * (user) agents table, both via the `agent-id-index` GSI (projection ALL, so
 * one query returns the whole record). It also pulls any schedules attached to
 * the agent, since an expensive *scheduled* agent's cost is best explained by
 * its cron cadence.
 *
 * The result is packaged as either pretty-printed `.json` (raw records) or a
 * readable `.md` summary.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { awsCredentialsService } from '@/services/awsCredentialsService';
import { withPRM } from '@/utils/prmUtils';
import type { ClientAccountRef } from '@/types/clientAccount';
import type { ToolResultFile } from '@/types/tools';

export type AgentExportFormat = 'json' | 'md';

type AgentScope = 'workspace' | 'personal';

/** Loose view of an agent record — we render known fields, pass through the rest. */
interface AgentRecord {
  agent_id?: string;
  tenant_id?: string;
  user_id?: string;
  title?: string;
  description?: string;
  visibility?: string;
  agent_type?: string;
  system_prompt?: string;
  user_instructions?: string;
  estimated_time_saved_minutes?: number;
  model_id?: string;
  required_integrations?: string[];
  tools_config?: Record<string, unknown>;
  reference_files?: Array<Record<string, unknown>>;
  tags?: string[];
  personas?: string[];
  industries?: string[];
  source_agent_id?: string;
  created_by_user_id?: string;
  created_by_name?: string;
  created_at?: number;
  updated_at?: number;
  version?: number;
  [key: string]: unknown;
}

interface AgentDefinitionExport {
  client_name: string;
  agent_id: string;
  scope: AgentScope;
  exported_at: string;
  agent: AgentRecord;
  schedules: Array<Record<string, unknown>>;
  schedules_error?: string;
}

async function docClient(ref: ClientAccountRef): Promise<DynamoDBDocumentClient> {
  const awsConfig = await awsCredentialsService.getClientConfig(ref.accountId, ref.region);
  return DynamoDBDocumentClient.from(withPRM(DynamoDBClient, awsConfig));
}

async function queryByAgentId(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  agentId: string
): Promise<AgentRecord | undefined> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'agent-id-index',
      KeyConditionExpression: 'agent_id = :aid',
      ExpressionAttributeValues: { ':aid': agentId },
      Limit: 1,
    })
  );
  return result.Items?.[0] as AgentRecord | undefined;
}

/** Fetch the agent record (+ schedules) for an agent id from the client account. */
export async function fetchAgentDefinition(ref: ClientAccountRef, agentId: string): Promise<AgentDefinitionExport> {
  const ddb = await docClient(ref);

  let scope: AgentScope = 'workspace';
  let record = await queryByAgentId(ddb, `numa-${ref.clientName}-agents`, agentId);
  if (!record) {
    record = await queryByAgentId(ddb, `numa-${ref.clientName}-user-agents`, agentId);
    scope = 'personal';
  }
  if (!record) {
    throw new Error(`Agent ${agentId} not found in this client (it may have been deleted).`);
  }

  // Schedules are best-effort — a missing table / permission shouldn't sink the export.
  let schedules: Array<Record<string, unknown>> = [];
  let schedulesError: string | undefined;
  try {
    const result = await ddb.send(
      new QueryCommand({
        TableName: `numa-${ref.clientName}-agent-schedules`,
        IndexName: 'agent-id-index',
        KeyConditionExpression: 'agent_id = :aid',
        ExpressionAttributeValues: { ':aid': agentId },
      })
    );
    schedules = (result.Items ?? []) as Array<Record<string, unknown>>;
  } catch (e) {
    schedulesError = e instanceof Error ? e.message : String(e);
  }

  return {
    client_name: ref.clientName,
    agent_id: agentId,
    scope,
    exported_at: new Date().toISOString(),
    agent: record,
    schedules,
    ...(schedulesError ? { schedules_error: schedulesError } : {}),
  };
}

function fmtEpoch(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value ?? '—');
  // Records store epoch ms.
  const ms = value > 1e12 ? value : value * 1000;
  return new Date(ms).toISOString();
}

function renderToolsConfig(cfg: Record<string, unknown> | undefined): string {
  if (!cfg || Object.keys(cfg).length === 0) return '_None_';
  const lines: string[] = [];
  for (const [k, v] of Object.entries(cfg)) {
    let rendered: string;
    if (Array.isArray(v)) {
      rendered =
        v.length === 0 ? '[]' : v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
    } else if (v && typeof v === 'object') {
      rendered = JSON.stringify(v);
    } else {
      rendered = String(v);
    }
    lines.push(`- \`${k}\`: ${rendered}`);
  }
  return lines.join('\n');
}

function renderSchedulesMd(schedules: Array<Record<string, unknown>>): string {
  if (schedules.length === 0) return '_No schedules._';
  return schedules
    .map((s, i) => {
      const get = (k: string) => (s[k] === undefined || s[k] === null || s[k] === '' ? '—' : String(s[k]));
      return [
        `### Schedule ${i + 1}`,
        `- **Status:** ${get('status')}`,
        `- **Label:** ${get('label')}`,
        `- **Cron:** \`${get('cron_expression')}\`  ·  **Timezone:** ${get('timezone')}`,
        `- **Trigger type:** ${get('trigger_type')}`,
        `- **Schedule id:** ${get('schedule_id')}`,
        `- **Owner (user id):** ${get('user_id')}`,
      ].join('\n');
    })
    .join('\n\n');
}

function renderMarkdown(def: AgentDefinitionExport): string {
  const a = def.agent;
  const refFiles = (a.reference_files ?? []).map((f) => {
    const name = (f.fileName ?? f.name ?? '(unnamed)') as string;
    const key = (f.s3Key ?? '') as string;
    return `- ${name}${key ? ` — \`${key}\`` : ''}`;
  });

  // Each entry is a markdown block; blocks are joined with a blank line so
  // headings, lists and paragraphs are spaced correctly.
  const blocks: string[] = [
    `# Agent definition — ${a.title ?? def.agent_id}`,
    [
      `- **Client:** ${def.client_name}`,
      `- **Agent id:** \`${def.agent_id}\``,
      `- **Scope:** ${def.scope}`,
      `- **Type:** ${a.agent_type ?? '—'}  ·  **Visibility:** ${a.visibility ?? '—'}`,
      `- **Model:** ${a.model_id ?? '— (platform default — Premium / Sonnet)'}`,
      `- **Est. time saved / run:** ${a.estimated_time_saved_minutes ?? '—'} min`,
      `- **Version:** ${a.version ?? '—'}`,
      `- **Created:** ${fmtEpoch(a.created_at)}${a.created_by_name ? ` by ${a.created_by_name}` : ''}`,
      `- **Updated:** ${fmtEpoch(a.updated_at)}`,
      ...(a.source_agent_id ? [`- **Copied from:** \`${a.source_agent_id}\``] : []),
      `- **Exported:** ${def.exported_at}`,
    ].join('\n'),
    '## Description',
    a.description ? a.description : '_None_',
    '## User instructions (welcome message)',
    a.user_instructions ? a.user_instructions : '_None_',
    '## System prompt',
    `\`\`\`\n${a.system_prompt ?? '(none)'}\n\`\`\``,
    '## Tools config',
    renderToolsConfig(a.tools_config),
    '## Required integrations',
    a.required_integrations && a.required_integrations.length
      ? a.required_integrations.map((i) => `- ${i}`).join('\n')
      : '_None_',
    '## Reference files',
    refFiles.length ? refFiles.join('\n') : '_None_',
    '## Tags / personas / industries',
    [
      `- **Tags:** ${a.tags?.join(', ') || '—'}`,
      `- **Personas:** ${a.personas?.join(', ') || '—'}`,
      `- **Industries:** ${a.industries?.join(', ') || '—'}`,
    ].join('\n'),
    '## Schedules',
    def.schedules_error ? `_Could not load schedules: ${def.schedules_error}_` : renderSchedulesMd(def.schedules),
  ];

  return `${blocks.join('\n\n')}\n`;
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

/**
 * Fetch + package an agent definition as a downloadable file. Returns a
 * `ToolResultFile` ready for `FileExportService.downloadFile`.
 */
export async function fetchAgentDefinitionExport(
  ref: ClientAccountRef,
  agentId: string,
  format: AgentExportFormat
): Promise<ToolResultFile> {
  const def = await fetchAgentDefinition(ref, agentId);
  const titleSlug = (def.agent.title ?? agentId).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40);
  const base = `${ref.clientName}-agent-${titleSlug}-${stamp()}`;

  if (format === 'json') {
    const content = JSON.stringify(def, null, 2);
    return { name: `${base}.json`, content, mimeType: 'application/json', size: new Blob([content]).size };
  }

  const content = renderMarkdown(def);
  return { name: `${base}.md`, content, mimeType: 'text/markdown', size: new Blob([content]).size };
}
