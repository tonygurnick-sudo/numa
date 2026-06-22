import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { awsCredentialsService } from '@/services/awsCredentialsService';
import { getConfigValue } from '@/services/configService';
import { withPRM } from '@/utils/prmUtils';

/**
 * Arcanum Agent Library (FEAT-206) — CRUD against the deployer-account
 * `numa-arcanum-agent-library` table + raw reference files in the library S3
 * bucket. The numa-arcanum-agent-deployer Lambda reads these and pushes them
 * into client instances.
 */

export interface LibraryReferenceFile {
  fileName: string;
  fileType?: string;
  fileSize?: number;
  /** Key in the library bucket. */
  s3Key: string;
  s3Bucket: string;
  uploadedAt?: string;
}

export interface LibraryIntegration {
  slug: string;
  method?: string;
  name?: string;
}

export interface LibraryToolsConfig {
  autoToolsEnabled?: boolean;
  queryDataSources?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
  memoriesEnabled?: boolean;
  numaOpsEnabled?: boolean;
  allowedKnowledgeBases?: string[] | null;
  /** Legacy flat slug list (pre-FEAT-143). */
  enabledConnections?: string[];
  /** Unified method-tagged integrations list. */
  enabledIntegrations?: LibraryIntegration[];
  approvalMode?: string;
  /** Per-category approval overrides (e.g. { integrations: 'never' }). */
  approvalModes?: Record<string, string | undefined>;
}

export interface LibraryAgent {
  library_agent_id: string;
  title: string;
  description?: string;
  system_prompt: string;
  user_instructions?: string;
  agent_type?: string;
  icon?: string;
  tags?: string[];
  tools_config?: LibraryToolsConfig;
  required_integrations?: string[];
  reference_files?: LibraryReferenceFile[];
  model_id?: string;
  estimated_time_saved_minutes?: number;
  version?: number;
  updated_at?: number;
  updated_by?: string;
}

function getLibraryTable(): string {
  const table = getConfigValue('ARCANUM_AGENT_LIBRARY_TABLE');
  if (!table) throw new Error('ARCANUM_AGENT_LIBRARY_TABLE is not configured in portal config');
  return table;
}

function getLibraryBucket(): string {
  const bucket = getConfigValue('ARCANUM_AGENT_LIBRARY_BUCKET');
  if (!bucket) throw new Error('ARCANUM_AGENT_LIBRARY_BUCKET is not configured in portal config');
  return bucket;
}

function getTargetsTable(): string {
  const table = getConfigValue('ARCANUM_AGENT_TARGETS_TABLE');
  if (!table) throw new Error('ARCANUM_AGENT_TARGETS_TABLE is not configured in portal config');
  return table;
}

/** Per-client deploy target — which library agents a client should have. Stored
 *  in the deployer-account targets table, NOT in numa-client-config. */
export interface DeployTarget {
  includeAll: boolean;
  agentIds: string[];
}

async function getDoc(): Promise<DynamoDBDocumentClient> {
  const deployerConfig = await awsCredentialsService.getDeployerClientConfig();
  return DynamoDBDocumentClient.from(withPRM(DynamoDBClient, deployerConfig), {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
  });
}

async function getS3(): Promise<S3Client> {
  const deployerConfig = await awsCredentialsService.getDeployerClientConfig();
  return withPRM(S3Client, deployerConfig);
}

function newLibraryAgentId(): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `lib_${uuid.replace(/-/g, '')}`;
}

function sanitizeImportedToolsConfig(tc: unknown): LibraryToolsConfig {
  const out: LibraryToolsConfig = {};
  if (!tc || typeof tc !== 'object') return out;
  const o = tc as Record<string, unknown>;
  for (const k of [
    'autoToolsEnabled',
    'queryDataSources',
    'webSearchEnabled',
    'createAgentEnabled',
    'memoriesEnabled',
    'numaOpsEnabled',
  ] as const) {
    if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  }
  if (Array.isArray(o.allowedKnowledgeBases) || o.allowedKnowledgeBases === null) {
    out.allowedKnowledgeBases = o.allowedKnowledgeBases as string[] | null;
  }
  // Preserve integrations so they survive import → deploy (previously dropped).
  if (Array.isArray(o.enabledConnections)) {
    out.enabledConnections = (o.enabledConnections as unknown[]).filter((x): x is string => typeof x === 'string');
  }
  if (Array.isArray(o.enabledIntegrations)) {
    out.enabledIntegrations = (o.enabledIntegrations as unknown[])
      .filter(
        (x): x is Record<string, unknown> =>
          !!x && typeof x === 'object' && typeof (x as { slug?: unknown }).slug === 'string'
      )
      .map((x) => ({
        slug: x.slug as string,
        method: x.method as string | undefined,
        name: x.name as string | undefined,
      }));
  }
  if (typeof o.approvalMode === 'string') out.approvalMode = o.approvalMode;
  if (o.approvalModes && typeof o.approvalModes === 'object') {
    const modes: Record<string, string> = {};
    for (const [cat, mode] of Object.entries(o.approvalModes as Record<string, unknown>)) {
      if (typeof mode === 'string') modes[cat] = mode;
    }
    if (Object.keys(modes).length) out.approvalModes = modes;
  }
  return out;
}

/**
 * Parse an agent exported from Numa (the AgentExportV1 `{ meta, agent, attachments }`
 * shape produced by the in-app "Export" button) — or a raw agent object — into a
 * draft LibraryAgent. Reference-file *bytes* are never in the export (only names),
 * so they must be re-attached after import; we surface that as a warning.
 */
export function parseExportedAgent(raw: string): { draft: Partial<LibraryAgent>; warnings: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON file');
  }
  const root = (data ?? {}) as Record<string, unknown>;
  const a = (root.meta && root.agent ? root.agent : root) as Record<string, unknown>;
  const warnings: string[] = [];

  const title = String(a.title ?? '').trim();
  const systemPrompt = String(a.systemPrompt ?? a.system_prompt ?? '').trim();
  if (!title) throw new Error('Missing required field: title');
  if (!systemPrompt) throw new Error('Missing required field: systemPrompt');

  const attachments = root.attachments as { referenceFiles?: unknown[]; iconImage?: unknown } | undefined;
  const refCount = Array.isArray(attachments?.referenceFiles) ? attachments!.referenceFiles!.length : 0;
  if (refCount > 0) {
    warnings.push(
      `This agent had ${refCount} reference file(s) — those aren't included in the export. Re-attach them below before deploying.`
    );
  }
  if (attachments?.iconImage) warnings.push('Custom avatar image is not imported.');

  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

  const draft: Partial<LibraryAgent> = {
    library_agent_id: newLibraryAgentId(),
    title,
    description: String(a.description ?? '').trim() || undefined,
    system_prompt: systemPrompt,
    user_instructions: String(a.userWelcomeMessage ?? a.user_instructions ?? '').trim() || undefined,
    agent_type: (a.agentType as string) || (a.agent_type as string) || 'task',
    icon: (a.icon as string) || undefined,
    tags: strArr(a.tags),
    required_integrations: strArr(a.requiredIntegrations ?? a.required_integrations),
    tools_config: sanitizeImportedToolsConfig(a.toolsConfig ?? a.tools_config),
    estimated_time_saved_minutes:
      typeof a.estimatedTimeSavedMinutes === 'number'
        ? (a.estimatedTimeSavedMinutes as number)
        : typeof a.estimated_time_saved_minutes === 'number'
          ? (a.estimated_time_saved_minutes as number)
          : undefined,
    reference_files: [], // bytes not in export — attach after import
  };
  return { draft, warnings };
}

export class ArcanumAgentsLibraryService {
  async listAgents(): Promise<LibraryAgent[]> {
    const doc = await getDoc();
    const table = getLibraryTable();
    const agents: LibraryAgent[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const res = await doc.send(new ScanCommand({ TableName: table, ExclusiveStartKey: key }));
      for (const item of res.Items ?? []) agents.push(item as LibraryAgent);
      key = res.LastEvaluatedKey;
    } while (key);
    return agents.sort((a, b) => a.title.localeCompare(b.title));
  }

  async getAgent(libraryAgentId: string): Promise<LibraryAgent | undefined> {
    const doc = await getDoc();
    const res = await doc.send(
      new GetCommand({ TableName: getLibraryTable(), Key: { library_agent_id: libraryAgentId } })
    );
    return res.Item as LibraryAgent | undefined;
  }

  /** Create or update a library agent. Returns the persisted agent. */
  async saveAgent(agent: Partial<LibraryAgent>, updatedBy?: string): Promise<LibraryAgent> {
    if (!agent.title?.trim()) throw new Error('Title is required');
    if (!agent.system_prompt?.trim()) throw new Error('System prompt is required');
    const doc = await getDoc();
    const now = Date.now();
    const item: LibraryAgent = {
      library_agent_id: agent.library_agent_id || newLibraryAgentId(),
      title: agent.title.trim(),
      description: agent.description?.trim() || undefined,
      system_prompt: agent.system_prompt,
      user_instructions: agent.user_instructions?.trim() || undefined,
      agent_type: agent.agent_type || 'task',
      icon: agent.icon || undefined,
      tags: agent.tags ?? [],
      tools_config: agent.tools_config ?? {},
      required_integrations: agent.required_integrations ?? [],
      reference_files: agent.reference_files ?? [],
      model_id: agent.model_id || undefined,
      estimated_time_saved_minutes:
        typeof agent.estimated_time_saved_minutes === 'number' ? agent.estimated_time_saved_minutes : undefined,
      version: now,
      updated_at: now,
      updated_by: updatedBy || agent.updated_by || 'unknown',
    };
    await doc.send(new PutCommand({ TableName: getLibraryTable(), Item: item }));
    return item;
  }

  async deleteAgent(agent: LibraryAgent): Promise<void> {
    const doc = await getDoc();
    // Best-effort delete of reference files first.
    if (agent.reference_files?.length) {
      const s3 = await getS3();
      await Promise.all(
        agent.reference_files.map((f) =>
          s3.send(new DeleteObjectCommand({ Bucket: f.s3Bucket, Key: f.s3Key })).catch(() => undefined)
        )
      );
    }
    await doc.send(
      new DeleteCommand({ TableName: getLibraryTable(), Key: { library_agent_id: agent.library_agent_id } })
    );
  }

  /** Upload a raw reference file into the library bucket; returns its manifest entry. */
  async uploadReferenceFile(libraryAgentId: string, file: File): Promise<LibraryReferenceFile> {
    const bucket = getLibraryBucket();
    const s3 = await getS3();
    const safeName = file.name.replace(/\s+/g, '_');
    const s3Key = `library/${libraryAgentId}/files/${safeName}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: bytes,
        ContentType: file.type || 'application/octet-stream',
      })
    );
    return {
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      fileSize: file.size,
      s3Key,
      s3Bucket: bucket,
      uploadedAt: new Date().toISOString(),
    };
  }

  async deleteReferenceFile(file: LibraryReferenceFile): Promise<void> {
    const s3 = await getS3();
    await s3.send(new DeleteObjectCommand({ Bucket: file.s3Bucket, Key: file.s3Key })).catch(() => undefined);
  }

  /** Read a client's deploy target (which agents it should have). */
  async getDeployTarget(clientName: string): Promise<DeployTarget> {
    const doc = await getDoc();
    const res = await doc.send(new GetCommand({ TableName: getTargetsTable(), Key: { client_name: clientName } }));
    const item = res.Item as { include_all?: boolean; agent_ids?: string[] } | undefined;
    return { includeAll: !!item?.include_all, agentIds: Array.isArray(item?.agent_ids) ? item!.agent_ids! : [] };
  }

  /** Persist a client's deploy target. */
  async setDeployTarget(clientName: string, target: DeployTarget, updatedBy?: string): Promise<void> {
    const doc = await getDoc();
    await doc.send(
      new PutCommand({
        TableName: getTargetsTable(),
        Item: {
          client_name: clientName,
          include_all: target.includeAll,
          agent_ids: target.agentIds,
          updated_at: Date.now(),
          updated_by: updatedBy || 'unknown',
        },
      })
    );
  }
}

export const arcanumAgentsLibraryService = new ArcanumAgentsLibraryService();
