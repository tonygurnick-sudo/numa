/**
 * Arcanum Agent Deployer (FEAT-206)
 * ---------------------------------
 * Deployer-account Lambda that pushes curated "Arcanum" agents from the central
 * library (numa-arcanum-agent-library + library S3) into client Numa instances —
 * as a separate push, NOT a full Numa deploy.
 *
 * For each target client it assumes `ArcanumAIAccess`, copies each agent's
 * reference files into the client's outputs bucket, runs the client's
 * `extract-content` Lambda to produce extracted text, and upserts an
 * Arcanum-managed agent row into `numa-{client}-agents`. Deployed rows are tagged
 * `managed_by: 'arcanum'` and keyed deterministically (`agt_arcanum_{libraryId}`)
 * so re-deploys overwrite in place. De-listed managed agents are reconciled away.
 *
 * Invoked same-account by the Customer Success Portal (Identity Pool creds).
 * Mirrors the portal-nextgen-broker `{ ok, result, error }` envelope.
 */
import { STSClient, AssumeRoleCommand, Credentials as StsCreds } from '@aws-sdk/client-sts';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { randomUUID } from 'node:crypto';
import { withPRM } from '../../../lib/prm-node/prm';

// ── Env ───────────────────────────────────────────────────────────────────
const LIBRARY_TABLE = process.env.LIBRARY_TABLE!;
const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE!;
const TARGETS_TABLE = process.env.TARGETS_TABLE!;
const LIBRARY_BUCKET = process.env.LIBRARY_BUCKET!;
const CLIENT_CONFIG_TABLE = process.env.CLIENT_CONFIG_TABLE_NAME!;
const CLIENT_ASSUME_ROLE_NAME = process.env.CLIENT_ASSUME_ROLE_NAME || 'ArcanumAIAccess';
const DEPLOYMENTS_TTL_DAYS = Number(process.env.DEPLOYMENTS_TTL_DAYS || '180');

// Deployer-account clients (this Lambda's own role)
const deployerDdb = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}), {
  marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
});
const deployerS3 = withPRM(S3Client, {});

// ── Types ───────────────────────────────────────────────────────────────────
type ToolsConfig = Record<string, unknown>;

interface LibraryReferenceFile {
  fileName: string;
  fileType?: string;
  fileSize?: number;
  /** Key in the library bucket (raw upload). */
  s3Key: string;
  s3Bucket?: string;
  uploadedAt?: string;
}

interface LibraryAgent {
  library_agent_id: string;
  title: string;
  description?: string;
  system_prompt: string;
  user_instructions?: string;
  agent_type?: string;
  icon?: string;
  tags?: string[];
  personas?: string[];
  industries?: string[];
  tools_config?: ToolsConfig;
  required_integrations?: string[];
  reference_files?: LibraryReferenceFile[];
  model_id?: string;
  estimated_time_saved_minutes?: number;
  version?: number;
  updated_at?: number;
  updated_by?: string;
}

interface DeployedReferenceFile {
  fileName: string;
  fileType?: string;
  fileSize?: number;
  s3Key: string;
  s3Bucket: string;
  extractedContentS3Key?: string;
  uploadedAt?: string;
  source: string;
}

interface ClientSummary {
  clientName: string;
  clientAccountId?: string;
  region: string;
}

interface DeployTarget {
  includeAll: boolean;
  agentIds: string[];
}

interface AgentDeployOutcome {
  libraryAgentId: string;
  agentId: string;
  title: string;
  status: 'upserted' | 'removed' | 'failed';
  error?: string;
}

interface ClientDeployResult {
  clientName: string;
  status: 'succeeded' | 'partial' | 'failed' | 'skipped';
  upserted: AgentDeployOutcome[];
  removed: AgentDeployOutcome[];
  error?: string;
  /** FEAT-206 — whether this client's agents Lambda enforces the managed-lock
   *  (i.e. has the FEAT-206 code). false → agents deploy but aren't actually
   *  read-only until a full Numa deploy lands the enforcement. */
  enforcementPresent?: boolean;
}

interface PreviewResult {
  clientName: string;
  /** Arcanum-managed agents currently on the client (regardless of selection). */
  current: { libraryAgentId: string; agentId: string; title: string }[];
  /** Desired agents not yet on the client — will be created. */
  toAdd: { libraryAgentId: string; title: string }[];
  /** Desired agents already on the client — will be updated in place (same id). */
  toUpdate: { libraryAgentId: string; title: string }[];
  /** Managed agents no longer desired — will be removed. */
  toRemove: { libraryAgentId: string; agentId: string; title: string }[];
  /** Whether the client's agents Lambda enforces the managed-lock (see ClientDeployResult). */
  enforcementPresent: boolean;
}

type DeployerResponse<T = unknown> = { ok: true; result: T } | { ok: false; error: string };

const MANAGED_BY = 'arcanum';
const DEPLOYER_USER_ID = 'arcanum-deployer';
const DEPLOYER_USER_NAME = 'Arcanum';

const agentIdForLibrary = (libraryAgentId: string): string => `agt_arcanum_${libraryAgentId}`;
const clientOutputsBucket = (clientName: string): string => `numa-${clientName}-outputs`;
const extractContentLambdaName = (clientName: string): string => `${clientName}_extract-content`;
// API-Gateway-fronted agents Lambda → `{client}_agents` (underscore separator).
const agentsLambdaName = (clientName: string): string => `${clientName}_agents`;
// Workspace (public) agents table. Created in core-numa-infra-construct.ts as
// `${numaClient}-agents` where numaClient = `numa-${clientName}` for prod-deployed
// clients (all real client stacks deploy with environmentName='prod').
const clientAgentsTable = (clientName: string): string => `numa-${clientName}-agents`;

// ── Cross-account credentials ───────────────────────────────────────────────
const credsToProvider = (
  c: StsCreds | undefined
): { accessKeyId: string; secretAccessKey: string; sessionToken?: string; expiration?: Date } => {
  if (!c?.AccessKeyId || !c?.SecretAccessKey) throw new Error('AssumeRole returned no credentials');
  return {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
    expiration: c.Expiration,
  };
};

const assumeClientRole = async (accountId: string): Promise<StsCreds> => {
  const sts = withPRM(STSClient, {});
  const roleArn = `arn:aws:iam::${accountId}:role/${CLIENT_ASSUME_ROLE_NAME}`;
  const out = await sts.send(
    new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: 'arcanum-agent-deployer', DurationSeconds: 3600 })
  );
  return out.Credentials as StsCreds;
};

interface ClientClients {
  ddb: DynamoDBDocumentClient;
  s3: S3Client;
  lambda: LambdaClient;
}

const buildClientClients = (creds: StsCreds, region: string): ClientClients => {
  const credentials = credsToProvider(creds);
  return {
    ddb: DynamoDBDocumentClient.from(withPRM(DynamoDBClient, { region, credentials }), {
      marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
    }),
    s3: withPRM(S3Client, { region, credentials }),
    lambda: withPRM(LambdaClient, { region, credentials }),
  };
};

// ── Library / client-config loaders ─────────────────────────────────────────
const loadLibraryAgents = async (): Promise<LibraryAgent[]> => {
  const agents: LibraryAgent[] = [];
  let key: Record<string, unknown> | undefined;
  do {
    const res = await deployerDdb.send(new ScanCommand({ TableName: LIBRARY_TABLE, ExclusiveStartKey: key }));
    for (const item of res.Items ?? []) agents.push(item as LibraryAgent);
    key = res.LastEvaluatedKey;
  } while (key);
  return agents;
};

const flattenTarget = (raw: unknown): DeployTarget => {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const includeAll = obj.include_all === true;
  const agentIds = Array.isArray(obj.agent_ids) ? obj.agent_ids.filter((x): x is string => typeof x === 'string') : [];
  return { includeAll, agentIds };
};

// Client account id + region come from numa-client-config (legit config fields).
// The deploy target (which agents) lives in the separate targets table — never in
// client-config, so it can't break the strict per-client config schema.
const loadClientSummary = async (clientName: string): Promise<ClientSummary | undefined> => {
  const res = await deployerDdb.send(new GetCommand({ TableName: CLIENT_CONFIG_TABLE, Key: { clientName } }));
  const item = res.Item;
  if (!item) return undefined;
  const cfg = (item.config && typeof item.config === 'object' ? item.config : {}) as Record<string, unknown>;
  return {
    clientName,
    clientAccountId: (item.clientAccountId as string) || (cfg.clientAccountId as string) || undefined,
    region: (item.region as string) || (cfg.region as string) || 'us-east-1',
  };
};

const loadClientTarget = async (clientName: string): Promise<DeployTarget> => {
  const res = await deployerDdb.send(new GetCommand({ TableName: TARGETS_TABLE, Key: { client_name: clientName } }));
  return flattenTarget(res.Item);
};

// Clients that have a configured deploy target (scan the targets table), joined
// with their account id / region from client config.
const listConfiguredClients = async (): Promise<(ClientSummary & { target: DeployTarget })[]> => {
  const out: (ClientSummary & { target: DeployTarget })[] = [];
  let key: Record<string, unknown> | undefined;
  do {
    const res = await deployerDdb.send(new ScanCommand({ TableName: TARGETS_TABLE, ExclusiveStartKey: key }));
    for (const item of res.Items ?? []) {
      const clientName = item.client_name as string | undefined;
      if (!clientName) continue;
      const target = flattenTarget(item);
      if (!target.includeAll && target.agentIds.length === 0) continue;
      const summary = await loadClientSummary(clientName);
      if (!summary) continue;
      out.push({ ...summary, target });
    }
    key = res.LastEvaluatedKey;
  } while (key);
  return out;
};

const resolveDesired = (
  library: LibraryAgent[],
  desiredSelection: { includeAll: boolean; agentIds: string[] }
): LibraryAgent[] => {
  if (desiredSelection.includeAll) return library;
  const wanted = new Set(desiredSelection.agentIds);
  return library.filter((a) => wanted.has(a.library_agent_id));
};

// ── Reference-file copy + extraction (per client) ───────────────────────────
const streamToBuffer = async (body: unknown): Promise<Uint8Array> => {
  // v3 GetObject body exposes transformToByteArray()
  const b = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (b?.transformToByteArray) return b.transformToByteArray();
  throw new Error('Unexpected S3 body type');
};

const deployReferenceFiles = async (
  agent: LibraryAgent,
  clientName: string,
  clients: ClientClients
): Promise<DeployedReferenceFile[]> => {
  const files = agent.reference_files ?? [];
  if (files.length === 0) return [];
  const bucket = clientOutputsBucket(clientName);
  const out: DeployedReferenceFile[] = [];

  for (const file of files) {
    const destKey = `numa-chat/agents/arcanum/${agent.library_agent_id}/${file.fileName}`;
    // 1. Read raw bytes from the library bucket (deployer account creds).
    const obj = await deployerS3.send(
      new GetObjectCommand({ Bucket: file.s3Bucket || LIBRARY_BUCKET, Key: file.s3Key })
    );
    const bytes = await streamToBuffer(obj.Body);
    // 2. Write into the client outputs bucket (assumed-role creds).
    await clients.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: destKey,
        Body: bytes,
        ContentType: file.fileType || 'application/octet-stream',
      })
    );
    // 3. Run the client's extract-content Lambda to produce extracted text.
    const outputKey = `${destKey}.json`;
    let extractedContentS3Key: string | undefined;
    try {
      const res = await clients.lambda.send(
        new InvokeCommand({
          FunctionName: extractContentLambdaName(clientName),
          Payload: new TextEncoder().encode(
            JSON.stringify({
              input_bucket: bucket,
              input_key: destKey,
              output_bucket: bucket,
              output_key: outputKey,
              file_name: file.fileName,
            })
          ),
        })
      );
      const payload = res.Payload ? JSON.parse(new TextDecoder().decode(res.Payload)) : {};
      if (res.FunctionError) throw new Error(payload?.errorMessage || res.FunctionError);
      extractedContentS3Key = payload?.output_key || outputKey;
    } catch (e) {
      // Non-fatal: the agent still works without extracted text (degraded KB use).
      console.warn('extract-content failed for reference file', {
        _name: 'DEPLOY_EXTRACT_FAILED',
        clientName,
        libraryAgentId: agent.library_agent_id,
        fileName: file.fileName,
        error: (e as Error)?.message,
      });
    }

    out.push({
      fileName: file.fileName,
      fileType: file.fileType,
      fileSize: file.fileSize,
      s3Key: destKey,
      s3Bucket: bucket,
      extractedContentS3Key,
      uploadedAt: file.uploadedAt || new Date().toISOString(),
      source: 'arcanum',
    });
  }
  return out;
};

// ── Upsert a single managed agent into a client ─────────────────────────────
const upsertAgent = async (
  agent: LibraryAgent,
  clientName: string,
  clients: ClientClients,
  now: number
): Promise<void> => {
  const agentId = agentIdForLibrary(agent.library_agent_id);
  const table = clientAgentsTable(clientName);

  // Preserve created_at across re-deploys.
  const existing = await clients.ddb.send(
    new GetCommand({ TableName: table, Key: { tenant_id: clientName, agent_id: agentId } })
  );
  const createdAt = (existing.Item?.created_at as number) ?? now;

  const referenceFiles = await deployReferenceFiles(agent, clientName, clients);

  // Prune any client-side files left over from a previous version of this agent
  // (e.g. a reference file removed/renamed in the library since the last deploy),
  // so edits are reflected cleanly and no orphans accumulate in the client bucket.
  const keepKeys = new Set<string>();
  for (const f of referenceFiles) {
    keepKeys.add(f.s3Key);
    if (f.extractedContentS3Key) keepKeys.add(f.extractedContentS3Key);
  }
  await pruneClientReferenceFiles(clientName, agent.library_agent_id, keepKeys, clients);

  const item = {
    tenant_id: clientName,
    agent_id: agentId,
    visibility: 'public' as const,
    agent_type: agent.agent_type || 'task',
    title: agent.title,
    description: agent.description,
    system_prompt: agent.system_prompt,
    user_instructions: agent.user_instructions,
    estimated_time_saved_minutes:
      typeof agent.estimated_time_saved_minutes === 'number' ? agent.estimated_time_saved_minutes : undefined,
    icon: agent.icon,
    required_integrations: agent.required_integrations ?? [],
    tools_config: agent.tools_config ?? {},
    model_id: agent.model_id,
    reference_files: referenceFiles,
    tags: agent.tags ?? [],
    personas: agent.personas ?? [],
    industries: agent.industries ?? [],
    created_by_user_id: DEPLOYER_USER_ID,
    created_by_name: DEPLOYER_USER_NAME,
    created_at: createdAt,
    updated_at: now,
    version: now,
    // Arcanum-managed markers (FEAT-206)
    managed_by: MANAGED_BY,
    library_agent_id: agent.library_agent_id,
    library_version: agent.version,
  };

  await clients.ddb.send(new PutCommand({ TableName: table, Item: item }));
};

// List existing Arcanum-managed agents already in a client (for drift removal + preview).
const listManagedAgents = async (
  clientName: string,
  clients: ClientClients
): Promise<{ agentId: string; libraryAgentId: string; title: string }[]> => {
  const table = clientAgentsTable(clientName);
  const managed: { agentId: string; libraryAgentId: string; title: string }[] = [];
  let key: Record<string, unknown> | undefined;
  do {
    const res = await clients.ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'tenant_id = :t',
        FilterExpression: 'managed_by = :m',
        ExpressionAttributeValues: { ':t': clientName, ':m': MANAGED_BY },
        ExclusiveStartKey: key,
      })
    );
    for (const item of res.Items ?? []) {
      managed.push({
        agentId: item.agent_id as string,
        libraryAgentId: (item.library_agent_id as string) || '',
        title: (item.title as string) || (item.agent_id as string),
      });
    }
    key = res.LastEvaluatedKey;
  } while (key);
  return managed;
};

// Probe the client's agents Lambda to confirm it enforces the managed-lock
// (i.e. has the FEAT-206 code). Ground truth — executes the deployed code rather
// than guessing from a version. Old Lambdas lack the probe branch and fail → false.
const probeEnforcement = async (clientName: string, clients: ClientClients): Promise<boolean> => {
  try {
    const res = await clients.lambda.send(
      new InvokeCommand({
        FunctionName: agentsLambdaName(clientName),
        Payload: new TextEncoder().encode(JSON.stringify({ action: 'capabilities' })),
      })
    );
    if (res.FunctionError) return false;
    const payload = res.Payload ? JSON.parse(new TextDecoder().decode(res.Payload)) : {};
    return payload?.capabilities?.managedAgents === true;
  } catch {
    return false;
  }
};

// Delete a managed agent's copied reference files from the client outputs bucket
// (prefix is deterministic from the library id). Best-effort — never fails a deploy.
const removeAgentReferenceFiles = async (
  clientName: string,
  libraryAgentId: string,
  clients: ClientClients
): Promise<void> => {
  if (!libraryAgentId) return;
  const bucket = clientOutputsBucket(clientName);
  const prefix = `numa-chat/agents/arcanum/${libraryAgentId}/`;
  try {
    let token: string | undefined;
    do {
      const listed = await clients.s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
      );
      const keys = (listed.Contents ?? []).map((o) => o.Key).filter((k): k is string => !!k);
      if (keys.length) {
        await clients.s3.send(
          new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } })
        );
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
  } catch (e) {
    console.warn('removeAgentReferenceFiles failed', {
      _name: 'DEPLOY_FILE_CLEANUP_FAILED',
      clientName,
      libraryAgentId,
      error: (e as Error)?.message,
    });
  }
};

// Delete client-side files under an agent's prefix that are NOT in keepKeys —
// i.e. leftovers from a previous version of the agent (file removed/renamed since
// the last deploy). Keeps the client bucket in sync with the agent on edits.
const pruneClientReferenceFiles = async (
  clientName: string,
  libraryAgentId: string,
  keepKeys: Set<string>,
  clients: ClientClients
): Promise<void> => {
  if (!libraryAgentId) return;
  const bucket = clientOutputsBucket(clientName);
  const prefix = `numa-chat/agents/arcanum/${libraryAgentId}/`;
  try {
    let token: string | undefined;
    do {
      const listed = await clients.s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
      );
      const stale = (listed.Contents ?? []).map((o) => o.Key).filter((k): k is string => !!k && !keepKeys.has(k));
      if (stale.length) {
        await clients.s3.send(
          new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: stale.map((Key) => ({ Key })), Quiet: true } })
        );
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
  } catch (e) {
    console.warn('pruneClientReferenceFiles failed', {
      _name: 'DEPLOY_FILE_PRUNE_FAILED',
      clientName,
      libraryAgentId,
      error: (e as Error)?.message,
    });
  }
};

// ── Core reconcile ──────────────────────────────────────────────────────────
const reconcileClient = async (
  summary: ClientSummary,
  library: LibraryAgent[],
  desired: LibraryAgent[]
): Promise<ClientDeployResult> => {
  const result: ClientDeployResult = { clientName: summary.clientName, status: 'succeeded', upserted: [], removed: [] };

  if (!summary.clientAccountId) {
    return { ...result, status: 'failed', error: 'missing clientAccountId in client config' };
  }

  const creds = await assumeClientRole(summary.clientAccountId);
  const clients = buildClientClients(creds, summary.region);
  const now = Date.now();
  const desiredIds = new Set(desired.map((a) => a.library_agent_id));

  // Pre-flight: does this client actually enforce the managed-lock? Agents still
  // deploy if not, but they won't be read-only until a full Numa deploy lands.
  result.enforcementPresent = await probeEnforcement(summary.clientName, clients);

  // Upserts
  for (const agent of desired) {
    try {
      await upsertAgent(agent, summary.clientName, clients, now);
      result.upserted.push({
        libraryAgentId: agent.library_agent_id,
        agentId: agentIdForLibrary(agent.library_agent_id),
        title: agent.title,
        status: 'upserted',
      });
    } catch (e) {
      result.status = 'partial';
      result.upserted.push({
        libraryAgentId: agent.library_agent_id,
        agentId: agentIdForLibrary(agent.library_agent_id),
        title: agent.title,
        status: 'failed',
        error: (e as Error)?.message,
      });
    }
  }

  // Drift removal — managed agents no longer desired.
  const existingManaged = await listManagedAgents(summary.clientName, clients);
  for (const managed of existingManaged) {
    if (managed.libraryAgentId && desiredIds.has(managed.libraryAgentId)) continue;
    try {
      await clients.ddb.send(
        new DeleteCommand({
          TableName: clientAgentsTable(summary.clientName),
          Key: { tenant_id: summary.clientName, agent_id: managed.agentId },
        })
      );
      // Clean up the copied reference files so we don't leave S3 orphans.
      await removeAgentReferenceFiles(summary.clientName, managed.libraryAgentId, clients);
      result.removed.push({
        libraryAgentId: managed.libraryAgentId,
        agentId: managed.agentId,
        title: '',
        status: 'removed',
      });
    } catch (e) {
      result.status = 'partial';
      result.removed.push({
        libraryAgentId: managed.libraryAgentId,
        agentId: managed.agentId,
        title: '',
        status: 'failed',
        error: (e as Error)?.message,
      });
    }
  }

  if (result.upserted.every((u) => u.status === 'failed') && result.upserted.length > 0) {
    result.status = 'failed';
  }
  return result;
};

const writeDeploymentRecord = async (
  result: ClientDeployResult,
  actor: string | undefined,
  startedAt: number
): Promise<string> => {
  const deploymentId = `dep_${randomUUID()}`;
  const finishedAt = Date.now();
  await deployerDdb.send(
    new PutCommand({
      TableName: DEPLOYMENTS_TABLE,
      Item: {
        deployment_id: deploymentId,
        client_name: result.clientName,
        status: result.status,
        actor: actor || 'unknown',
        created_at: startedAt,
        finished_at: finishedAt,
        upserted: result.upserted,
        removed: result.removed,
        error: result.error,
        ttl: Math.floor(finishedAt / 1000) + DEPLOYMENTS_TTL_DAYS * 86400,
      },
    })
  );
  return deploymentId;
};

// ── Actions ─────────────────────────────────────────────────────────────────
interface DeployToClientEvent {
  action: 'deployToClient';
  clientName: string;
  /** Optional override; otherwise the client's saved target (targets table) is used. */
  includeAll?: boolean;
  agentIds?: string[];
  actor?: string;
}

const doDeployToClient = async (e: DeployToClientEvent): Promise<ClientDeployResult & { deploymentId: string }> => {
  if (!e.clientName) throw new Error('Missing clientName');
  const summary = await loadClientSummary(e.clientName);
  if (!summary) throw new Error(`Unknown client: ${e.clientName}`);
  const selection =
    e.includeAll !== undefined || e.agentIds !== undefined
      ? { includeAll: e.includeAll === true, agentIds: e.agentIds ?? [] }
      : await loadClientTarget(e.clientName);

  const library = await loadLibraryAgents();
  const desired = resolveDesired(library, selection);
  const startedAt = Date.now();
  const result = await reconcileClient(summary, library, desired);
  const deploymentId = await writeDeploymentRecord(result, e.actor, startedAt);
  return { ...result, deploymentId };
};

interface PreviewClientEvent {
  action: 'previewClient';
  clientName: string;
  includeAll?: boolean;
  agentIds?: string[];
}

const doPreviewClient = async (e: PreviewClientEvent): Promise<PreviewResult> => {
  if (!e.clientName) throw new Error('Missing clientName');
  const summary = await loadClientSummary(e.clientName);
  if (!summary) throw new Error(`Unknown client: ${e.clientName}`);
  if (!summary.clientAccountId) throw new Error('missing clientAccountId in client config');
  const selection =
    e.includeAll !== undefined || e.agentIds !== undefined
      ? { includeAll: e.includeAll === true, agentIds: e.agentIds ?? [] }
      : await loadClientTarget(e.clientName);

  const library = await loadLibraryAgents();
  const desired = resolveDesired(library, selection);
  const desiredIds = new Set(desired.map((a) => a.library_agent_id));

  const creds = await assumeClientRole(summary.clientAccountId);
  const clients = buildClientClients(creds, summary.region);
  const [existingManaged, enforcementPresent] = await Promise.all([
    listManagedAgents(summary.clientName, clients),
    probeEnforcement(summary.clientName, clients),
  ]);
  const existingIds = new Set(existingManaged.map((m) => m.libraryAgentId).filter(Boolean));

  const toAdd = desired
    .filter((a) => !existingIds.has(a.library_agent_id))
    .map((a) => ({ libraryAgentId: a.library_agent_id, title: a.title }));
  const toUpdate = desired
    .filter((a) => existingIds.has(a.library_agent_id))
    .map((a) => ({ libraryAgentId: a.library_agent_id, title: a.title }));
  const toRemove = existingManaged
    .filter((m) => m.libraryAgentId && !desiredIds.has(m.libraryAgentId))
    .map((m) => ({ libraryAgentId: m.libraryAgentId, agentId: m.agentId, title: m.title }));
  const current = existingManaged.map((m) => ({
    libraryAgentId: m.libraryAgentId,
    agentId: m.agentId,
    title: m.title,
  }));

  return { clientName: summary.clientName, current, toAdd, toUpdate, toRemove, enforcementPresent };
};

interface DeployFleetEvent {
  action: 'deployFleet';
  actor?: string;
}

const doDeployFleet = async (
  e: DeployFleetEvent
): Promise<{ results: (ClientDeployResult & { deploymentId?: string })[] }> => {
  const clients = await listConfiguredClients();
  const library = await loadLibraryAgents();
  const results: (ClientDeployResult & { deploymentId?: string })[] = [];
  for (const summary of clients) {
    const startedAt = Date.now();
    try {
      const desired = resolveDesired(library, summary.target);
      const result = await reconcileClient(summary, library, desired);
      const deploymentId = await writeDeploymentRecord(result, e.actor, startedAt);
      results.push({ ...result, deploymentId });
    } catch (err) {
      results.push({
        clientName: summary.clientName,
        status: 'failed',
        upserted: [],
        removed: [],
        error: (err as Error)?.message,
      });
    }
  }
  return { results };
};

interface StatusForClientEvent {
  action: 'statusForClient';
  clientName: string;
  limit?: number;
}

const doStatusForClient = async (e: StatusForClientEvent): Promise<{ deployments: unknown[] }> => {
  if (!e.clientName) throw new Error('Missing clientName');
  const res = await deployerDdb.send(
    new QueryCommand({
      TableName: DEPLOYMENTS_TABLE,
      IndexName: 'client-index',
      KeyConditionExpression: 'client_name = :c',
      ExpressionAttributeValues: { ':c': e.clientName },
      ScanIndexForward: false,
      Limit: Math.min(Math.max(e.limit ?? 10, 1), 50),
    })
  );
  return { deployments: res.Items ?? [] };
};

// ── Handler ─────────────────────────────────────────────────────────────────
type DeployerEvent = DeployToClientEvent | PreviewClientEvent | DeployFleetEvent | StatusForClientEvent;

export const handler = async (event: DeployerEvent): Promise<DeployerResponse> => {
  try {
    if (!event || !('action' in event)) throw new Error('Missing action');
    switch (event.action) {
      case 'deployToClient':
        return { ok: true, result: await doDeployToClient(event) };
      case 'previewClient':
        return { ok: true, result: await doPreviewClient(event) };
      case 'deployFleet':
        return { ok: true, result: await doDeployFleet(event) };
      case 'statusForClient':
        return { ok: true, result: await doStatusForClient(event) };
      default:
        throw new Error(`Unknown action: ${(event as { action: string }).action}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('arcanum-agent-deployer error', { _name: 'DEPLOYER_ERROR', error: message });
    return { ok: false, error: message };
  }
};
