import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { S3Client, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand as DdbGetCommand } from '@aws-sdk/lib-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { normalisePersonas, normaliseIndustries } from '../../../lib/resource-taxonomy';

const client = withPRM(DynamoDBClient, {});
const dynamo = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  },
});

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

const CLIENT_NAME = process.env.CLIENT_NAME;
const WORKSPACE_TABLE = process.env.WORKSPACE_AGENTS_TABLE;
const USER_TABLE = process.env.USER_AGENTS_TABLE;
const OUTPUTS_BUCKET_NAME = process.env.OUTPUTS_BUCKET_NAME;
const AGENTS_SETTINGS_TABLE_NAME = process.env.AGENTS_SETTINGS_TABLE_NAME;
const PREFS_TABLE = process.env.AGENT_USER_PREFS_TABLE;
const TEAMS_TABLE = process.env.AGENT_TEAMS_TABLE;
const TEAM_MEMBERS_TABLE = process.env.AGENT_TEAM_MEMBERS_TABLE;
const SHARING_TABLE = process.env.AGENT_SHARING_TABLE;
const AGENT_SCHEDULES_TABLE = process.env.AGENT_SCHEDULES_TABLE_NAME;

type AgentVisibility = 'personal' | 'public';
type AgentScope = 'workspace' | 'user';

type IntegrationMethod = 'native' | 'pipedream';

type IntegrationListItem = {
  slug: string;
  method: IntegrationMethod;
  name: string;
};

type AgentToolsConfig = {
  autoToolsEnabled?: boolean;
  queryDataSources?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
  memoriesEnabled?: boolean;
  numaOpsEnabled?: boolean;
  /** @deprecated Pre-FEAT-143 flat slug list. New agents write
   *  `enabledIntegrations` instead; we still persist this in parallel for
   *  one release so older chat/runner code paths keep working. */
  enabledConnections?: string[];
  /** Unified method-tagged integrations list — single source of truth. */
  enabledIntegrations?: IntegrationListItem[];
  // Multi-KB support: which knowledge bases the agent can access
  // null/undefined = all KBs (backwards compat with queryDataSources: true)
  // [] = no KB access
  // ['company', 'kb-123'] = specific KBs only
  allowedKnowledgeBases?: string[] | null;
  approvalMode?: 'always' | 'non_destructive' | 'never';
  approvalModes?: Record<string, 'always' | 'non_destructive' | 'never' | undefined>;
};

type ReferenceFile = {
  fileName: string;
  fileType?: string;
  fileSize?: number;
  s3Key: string;
  s3Bucket: string;
  extractedContentS3Key?: string;
  uploadedAt?: string;
  source?: string;
};

type WorkspaceAgentItem = {
  tenant_id: string;
  agent_id: string;
  visibility: AgentVisibility;
  agent_type: string;
  title: string;
  description?: string;
  system_prompt: string;
  user_instructions?: string;
  estimated_time_saved_minutes?: number;
  is_favorite?: boolean;
  icon?: string;
  icon_image?: { s3Bucket: string; s3Key: string };
  required_integrations?: string[];
  tools_config?: AgentToolsConfig;
  reference_files?: ReferenceFile[];
  tags?: string[];
  personas?: string[];
  industries?: string[];
  created_by_user_id: string;
  created_by_name?: string;
  created_at: number;
  updated_at: number;
  version: number;
  // Per-agent workspace-chat model (Standard / Premium / Expert). Optional — omitted means the
  // platform default (Premium / Sonnet 4.6) is resolved at runtime. Validated via normaliseModelId.
  model_id?: string;
  // FEAT-206 — Arcanum-managed agents pushed by the deployer Lambda. When set to
  // 'arcanum' the agent is read-only in this client (edit/delete blocked) and is
  // owned by the central library (re-deploys overwrite by deterministic id).
  managed_by?: string;
  library_agent_id?: string;
  library_version?: number;
};

type UserAgentItem = {
  user_id: string;
  tenant_id: string;
  agent_id: string;
  visibility: AgentVisibility;
  agent_type: string;
  title: string;
  description?: string;
  system_prompt: string;
  user_instructions?: string;
  estimated_time_saved_minutes?: number;
  icon?: string;
  icon_image?: { s3Bucket: string; s3Key: string };
  required_integrations?: string[];
  tools_config?: AgentToolsConfig;
  reference_files?: ReferenceFile[];
  tags?: string[];
  personas?: string[];
  industries?: string[];
  created_by_user_id: string;
  created_by_name?: string;
  created_at: number;
  updated_at: number;
  version: number;
  source_agent_id?: string;
  is_favorite?: boolean;
  // Per-agent workspace-chat model (see WorkspaceAgentItem.model_id).
  model_id?: string;
};

// Removed unused AgentRecord type to satisfy lint

type AgentResponse = {
  agentId: string;
  scope: AgentScope;
  visibility: AgentVisibility;
  agentType: string;
  title: string;
  description?: string;
  systemPrompt: string;
  userWelcomeMessage?: string;
  estimatedTimeSavedMinutes?: number;
  icon?: string;
  iconImage?: { s3Bucket: string; s3Key: string };
  requiredIntegrations: string[];
  toolsConfig: AgentToolsConfig;
  /** Per-agent workspace-chat model id (Standard / Premium / Expert); omitted → platform default. */
  modelId?: string;
  referenceFiles: ReferenceFile[];
  createdBy: {
    userId: string;
    name?: string;
  };
  createdAt: number;
  updatedAt: number;
  version: number;
  sourceAgentId?: string;
  isFavorite?: boolean;
  tags: string[];
  personas: string[];
  industries: string[];
  /** FEAT-206 — 'arcanum' when the agent is centrally managed and read-only here. */
  managedBy?: string;
};

type AuthContext = {
  sub: string;
  email?: string;
  name?: string;
  groups: string[];
};

type CreateAgentPayload = {
  visibility?: AgentVisibility;
  agentType?: string;
  title?: string;
  description?: string;
  systemPrompt?: string;
  userWelcomeMessage?: string;
  estimatedTimeSavedMinutes?: number;
  isFavorite?: boolean;
  icon?: string;
  iconImage?: { s3Bucket: string; s3Key: string } | null;
  requiredIntegrations?: string[];
  toolsConfig?: AgentToolsConfig;
  /** Per-agent workspace-chat model id (Standard / Premium / Expert). */
  modelId?: string;
  referenceFiles?: ReferenceFile[];
  createdByName?: string;
  sourceAgentId?: string;
  tags?: string[];
  personas?: string[];
  industries?: string[];
};

type UpdateAgentPayload = CreateAgentPayload & {
  isFavorite?: boolean;
  sourceAgentId?: string;
};

const jsonResponse = (
  statusCode: number,
  payload: unknown
): { statusCode: number; headers: typeof HEADERS; body: string } => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(payload),
});

const errorResponse = (statusCode: number, message: string): ReturnType<typeof jsonResponse> =>
  jsonResponse(statusCode, { error: message });

const parseJwt = (token: string): Record<string, unknown> => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const resolveAuthContext = (event: APIGatewayProxyEventV2): AuthContext | null => {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader) return null;
  const token = String(authHeader).replace(/^Bearer\s+/i, '');
  const payload = parseJwt(token);
  const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
  if (!sub) return null;
  const groups = Array.isArray(payload['cognito:groups'])
    ? (payload['cognito:groups'] as unknown[]).filter((g): g is string => typeof g === 'string')
    : [];
  return {
    sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    groups,
  };
};

const isAdmin = (auth: AuthContext): boolean => auth.groups.includes('admin');

const ensureEnv = (): void => {
  if (!CLIENT_NAME || !WORKSPACE_TABLE || !USER_TABLE || !OUTPUTS_BUCKET_NAME) {
    throw new Error('Agents API missing required environment variables');
  }
};

const generateAgentId = (): string => `agt_${randomUUID().replace(/-/g, '')}`;

const COPY_SUFFIX_REGEX = /\s+\(Copy(?:\s+\d+)?\)$/i;

const normaliseDuplicateBaseTitle = (title?: string): string => {
  if (!title) return 'Untitled Agent';
  const trimmed = title.trim();
  if (!trimmed) return 'Untitled Agent';
  return trimmed.replace(COPY_SUFFIX_REGEX, '').trim() || 'Untitled Agent';
};

export const generateDuplicateTitle = (originalTitle: string | undefined, existingAgents: UserAgentItem[]): string => {
  const base = normaliseDuplicateBaseTitle(originalTitle);
  const existingTitles = new Set(existingAgents.map((agent) => (agent.title || '').toLowerCase()));

  let candidate = `${base} (Copy)`;
  let counter = 2;
  while (existingTitles.has(candidate.toLowerCase())) {
    candidate = `${base} (Copy ${counter})`;
    counter += 1;
  }
  return candidate;
};

const normaliseIntegrationRows = (rows: unknown): IntegrationListItem[] | undefined => {
  if (!Array.isArray(rows)) return undefined;
  const out: IntegrationListItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const slug = typeof r.slug === 'string' ? r.slug.trim() : '';
    const method = r.method === 'native' || r.method === 'pipedream' ? r.method : undefined;
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : slug;
    if (!slug || !method) continue;
    out.push({ slug, method, name });
  }
  return out;
};

// Valid agent model ids — the curated workspace-chat tiers an agent author can pick (Standard /
// Premium / Expert). Mirrors WORKSPACE_MODEL_OPTIONS_CURATED in
// numa-frontend/src/types/workspaceChatTypes.ts (the source of truth); the workspace agent's
// validate_model_id() is the final backstop. An unknown / retired id normalises to undefined, so the
// agent falls back to the platform default (Premium / Sonnet 4.6) at runtime — no behaviour change.
const VALID_AGENT_MODEL_IDS = new Set<string>([
  'numa-standard-model', // Standard — cheap non-Anthropic model
  'anthropic.claude-sonnet-4-6@medium-thinking', // Premium — Sonnet 4.6 (default)
  'anthropic.claude-opus-4-6-v1@medium-thinking', // Expert — Opus 4.6
]);

const normaliseModelId = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return VALID_AGENT_MODEL_IDS.has(trimmed) ? trimmed : undefined;
};

const normaliseToolsConfig = (config?: AgentToolsConfig | null): AgentToolsConfig => {
  if (!config) return {};
  return {
    autoToolsEnabled: config.autoToolsEnabled ?? true,
    queryDataSources: config.queryDataSources ?? false,
    webSearchEnabled: config.webSearchEnabled ?? false,
    createAgentEnabled: config.createAgentEnabled ?? false,
    // Memories default on (preserves historical always-on behaviour); numaOps
    // default off (also gated by the workspace feature flag at runtime).
    memoriesEnabled: config.memoriesEnabled ?? true,
    numaOpsEnabled: config.numaOpsEnabled ?? false,
    enabledConnections: Array.isArray(config.enabledConnections) ? config.enabledConnections : [],
    enabledIntegrations: normaliseIntegrationRows(config.enabledIntegrations),
    // Preserve allowedKnowledgeBases: null means all KBs, [] means none, array means specific
    allowedKnowledgeBases:
      config.allowedKnowledgeBases === null
        ? null
        : Array.isArray(config.allowedKnowledgeBases)
          ? config.allowedKnowledgeBases
          : undefined,
    approvalMode: config.approvalMode,
    approvalModes: config.approvalModes,
  };
};

const normaliseReferenceFiles = (files?: ReferenceFile[] | null): ReferenceFile[] => {
  if (!files) return [];
  return files
    .filter((file) => Boolean(file?.fileName) && Boolean(file?.s3Key))
    .map((file) => ({
      fileName: file.fileName,
      fileType: file.fileType,
      fileSize: typeof file.fileSize === 'number' ? file.fileSize : undefined,
      s3Key: file.s3Key,
      s3Bucket: file.s3Bucket || OUTPUTS_BUCKET_NAME!,
      extractedContentS3Key: file.extractedContentS3Key,
      uploadedAt: file.uploadedAt,
      source: file.source,
    }));
};

const MAX_TAGS = 20;

const normaliseTags = (tags?: string[] | null): string[] => {
  if (!tags || !Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(trimmed);
    if (result.length >= MAX_TAGS) break;
  }
  return result;
};

const resolveSourceAgentId = (agent: WorkspaceAgentItem | UserAgentItem): string => {
  if ('source_agent_id' in agent && agent.source_agent_id) {
    return agent.source_agent_id;
  }
  return agent.agent_id;
};

const buildPersonalDuplicatePayload = (
  agent: WorkspaceAgentItem | UserAgentItem,
  duplicateTitle: string,
  referenceFileFallbackSource?: string
): CreateAgentPayload => {
  const referenceFiles = normaliseReferenceFiles(agent.reference_files);
  const processedReferenceFiles = referenceFiles.length
    ? referenceFiles.map((file) =>
        referenceFileFallbackSource && !file.source ? { ...file, source: referenceFileFallbackSource } : file
      )
    : undefined;

  return {
    visibility: 'personal',
    agentType: agent.agent_type,
    title: duplicateTitle,
    description: agent.description,
    systemPrompt: agent.system_prompt,
    userWelcomeMessage: agent.user_instructions,
    estimatedTimeSavedMinutes: agent.estimated_time_saved_minutes,
    icon: agent.icon,
    iconImage: agent.icon_image,
    requiredIntegrations: agent.required_integrations ?? [],
    toolsConfig: agent.tools_config ?? {},
    modelId: agent.model_id,
    referenceFiles: processedReferenceFiles,
    sourceAgentId: resolveSourceAgentId(agent),
    tags: agent.tags ?? [],
    personas: agent.personas ?? [],
    industries: agent.industries ?? [],
  };
};

// FEAT-206 — Arcanum-managed reference files live under a shared, library-owned
// prefix in the client outputs bucket. The deployer's drift-removal deletes that
// whole prefix when a managed agent is un-deployed, so any duplicate that reused
// those keys would silently lose its files. The prefix used by the deployer
// (lambdas/node/arcanum-agent-deployer: deployReferenceFiles / removeAgentReferenceFiles).
const MANAGED_REFERENCE_PREFIX = 'numa-chat/agents/arcanum/';

// When duplicating an agent, copy any reference file that sits under the managed
// prefix into a prefix owned by the new agent, so the duplicate is self-contained
// and survives the source being un-deployed. Files outside the managed prefix are
// left untouched (a no-op for ordinary agents). Best-effort: on copy failure we
// keep the original key rather than failing the whole duplicate.
const relocateManagedReferenceFiles = async (
  referenceFiles: ReferenceFile[] | undefined,
  ownerSegment: string,
  newAgentId: string
): Promise<ReferenceFile[] | undefined> => {
  if (!referenceFiles?.length || !OUTPUTS_BUCKET_NAME) return referenceFiles;
  const s3 = withPRM(S3Client, {});
  const destPrefix = `numa-chat/agents/${ownerSegment}/${newAgentId}/`;
  const copyObject = async (srcBucket: string, srcKey: string, suffix: string): Promise<string> => {
    const destKey = `${destPrefix}${suffix}`;
    await s3.send(
      new CopyObjectCommand({
        Bucket: OUTPUTS_BUCKET_NAME,
        Key: destKey,
        CopySource: `${srcBucket}/${encodeURIComponent(srcKey)}`,
        MetadataDirective: 'COPY',
      })
    );
    return destKey;
  };
  return Promise.all(
    referenceFiles.map(async (file, idx) => {
      if (!file.s3Key?.startsWith(MANAGED_REFERENCE_PREFIX)) return file;
      const srcBucket = file.s3Bucket || OUTPUTS_BUCKET_NAME;
      try {
        const rawName = file.s3Key.split('/').pop() || `file-${idx}`;
        const newS3Key = await copyObject(srcBucket, file.s3Key, `${idx}-${rawName}`);
        let newExtractedKey = file.extractedContentS3Key;
        if (file.extractedContentS3Key) {
          const extName = file.extractedContentS3Key.split('/').pop() || `extracted-${idx}.json`;
          newExtractedKey = await copyObject(srcBucket, file.extractedContentS3Key, `extracted/${idx}-${extName}`);
        }
        return { ...file, s3Bucket: OUTPUTS_BUCKET_NAME, s3Key: newS3Key, extractedContentS3Key: newExtractedKey };
      } catch (e) {
        console.warn('DuplicateAgent: failed to relocate managed reference file; keeping shared key', {
          newAgentId,
          fileName: file.fileName,
          error: (e as Error)?.message,
        });
        return file;
      }
    })
  );
};

const normaliseWelcomeMessage = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const resolveWelcomeMessageFromPayload = (
  payload: CreateAgentPayload | UpdateAgentPayload,
  existing?: { user_instructions?: string }
): string | undefined => {
  if (Object.prototype.hasOwnProperty.call(payload, 'userWelcomeMessage')) {
    return normaliseWelcomeMessage(payload.userWelcomeMessage);
  }
  return normaliseWelcomeMessage(existing?.user_instructions);
};

const mapWorkspaceAgent = (item: WorkspaceAgentItem): AgentResponse => {
  const est = typeof item.estimated_time_saved_minutes === 'number' ? item.estimated_time_saved_minutes : undefined;
  return {
    agentId: item.agent_id,
    scope: 'workspace',
    visibility: item.visibility ?? 'public',
    agentType: item.agent_type,
    title: item.title,
    description: item.description,
    systemPrompt: item.system_prompt,
    userWelcomeMessage: normaliseWelcomeMessage(item.user_instructions),
    estimatedTimeSavedMinutes: est,
    isFavorite: item.is_favorite,
    icon: item.icon,
    iconImage: item.icon_image,
    requiredIntegrations: item.required_integrations ?? [],
    toolsConfig: normaliseToolsConfig(item.tools_config),
    modelId: item.model_id,
    referenceFiles: normaliseReferenceFiles(item.reference_files),
    createdBy: {
      userId: item.created_by_user_id,
      name: item.created_by_name,
    },
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    version: item.version,
    tags: item.tags ?? [],
    personas: item.personas ?? [],
    industries: item.industries ?? [],
    managedBy: item.managed_by,
  };
};

const mapUserAgent = (item: UserAgentItem): AgentResponse => {
  const est = typeof item.estimated_time_saved_minutes === 'number' ? item.estimated_time_saved_minutes : undefined;
  return {
    agentId: item.agent_id,
    scope: 'user',
    visibility: item.visibility ?? 'personal',
    agentType: item.agent_type,
    title: item.title,
    description: item.description,
    systemPrompt: item.system_prompt,
    userWelcomeMessage: normaliseWelcomeMessage(item.user_instructions),
    estimatedTimeSavedMinutes: est,
    icon: item.icon,
    iconImage: item.icon_image,
    requiredIntegrations: item.required_integrations ?? [],
    toolsConfig: normaliseToolsConfig(item.tools_config),
    modelId: item.model_id,
    referenceFiles: normaliseReferenceFiles(item.reference_files),
    createdBy: {
      userId: item.created_by_user_id,
      name: item.created_by_name,
    },
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    version: item.version,
    sourceAgentId: item.source_agent_id,
    isFavorite: item.is_favorite,
    tags: item.tags ?? [],
    personas: item.personas ?? [],
    industries: item.industries ?? [],
  };
};

const buildWorkspaceItem = (
  payload: CreateAgentPayload,
  auth: AuthContext,
  timestamp: number,
  agentId: string
): WorkspaceAgentItem => {
  const userWelcomeMessage = normaliseWelcomeMessage(payload.userWelcomeMessage);
  return {
    tenant_id: CLIENT_NAME!,
    agent_id: agentId,
    visibility: 'public' as const,
    agent_type: payload.agentType ?? 'task',
    title: payload.title?.trim() ?? 'Untitled Agent',
    description: payload.description?.trim() || undefined,
    system_prompt: payload.systemPrompt?.trim() ?? '',
    user_instructions: userWelcomeMessage,
    estimated_time_saved_minutes:
      typeof payload.estimatedTimeSavedMinutes === 'number' && payload.estimatedTimeSavedMinutes >= 0
        ? Math.floor(payload.estimatedTimeSavedMinutes)
        : undefined,
    is_favorite: 'isFavorite' in payload && typeof payload.isFavorite === 'boolean' ? payload.isFavorite : undefined,
    icon: payload.icon?.trim() || undefined,
    icon_image: payload.iconImage?.s3Bucket && payload.iconImage?.s3Key ? payload.iconImage : undefined,
    required_integrations: Array.isArray(payload.requiredIntegrations) ? payload.requiredIntegrations : [],
    tools_config: normaliseToolsConfig(payload.toolsConfig),
    model_id: normaliseModelId(payload.modelId),
    reference_files: normaliseReferenceFiles(payload.referenceFiles),
    tags: normaliseTags(payload.tags),
    personas: normalisePersonas(payload.personas).values,
    industries: normaliseIndustries(payload.industries).values,
    created_by_user_id: auth.sub,
    created_by_name: payload.createdByName?.trim() || auth.email || auth.name || auth.sub,
    created_at: timestamp,
    updated_at: timestamp,
    version: timestamp,
  };
};

const buildUserItem = (
  payload: CreateAgentPayload | UpdateAgentPayload,
  auth: AuthContext,
  timestamp: number,
  agentId: string,
  existing?: UserAgentItem
): UserAgentItem => {
  const userWelcomeMessage = resolveWelcomeMessageFromPayload(payload, existing);
  return {
    user_id: auth.sub,
    tenant_id: CLIENT_NAME!,
    agent_id: agentId,
    visibility:
      payload.visibility === 'public'
        ? 'public'
        : payload.visibility === 'personal'
          ? 'personal'
          : existing?.visibility === 'public'
            ? 'public'
            : 'personal',
    agent_type: payload.agentType ?? existing?.agent_type ?? 'task',
    title: payload.title?.trim() ?? existing?.title ?? 'Untitled Agent',
    description: payload.description?.trim() ?? existing?.description,
    system_prompt: payload.systemPrompt?.trim() ?? existing?.system_prompt ?? '',
    user_instructions: userWelcomeMessage,
    estimated_time_saved_minutes:
      'estimatedTimeSavedMinutes' in payload && typeof payload.estimatedTimeSavedMinutes === 'number'
        ? Math.max(0, Math.floor(payload.estimatedTimeSavedMinutes))
        : existing?.estimated_time_saved_minutes,
    icon: payload.icon?.trim() ?? existing?.icon,
    icon_image:
      'iconImage' in payload
        ? payload.iconImage && payload.iconImage.s3Bucket && payload.iconImage.s3Key
          ? payload.iconImage
          : undefined
        : existing?.icon_image,
    required_integrations: Array.isArray(payload.requiredIntegrations)
      ? payload.requiredIntegrations
      : (existing?.required_integrations ?? []),
    tools_config: normaliseToolsConfig(payload.toolsConfig ?? existing?.tools_config),
    model_id:
      'modelId' in payload && typeof payload.modelId === 'string'
        ? normaliseModelId(payload.modelId)
        : existing?.model_id,
    reference_files: normaliseReferenceFiles(payload.referenceFiles ?? existing?.reference_files),
    tags: normaliseTags(payload.tags ?? existing?.tags),
    personas: normalisePersonas(payload.personas ?? existing?.personas).values,
    industries: normaliseIndustries(payload.industries ?? existing?.industries).values,
    created_by_user_id: existing?.created_by_user_id ?? auth.sub,
    created_by_name: payload.createdByName?.trim() ?? existing?.created_by_name ?? auth.email ?? auth.name ?? auth.sub,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
    version: timestamp,
    source_agent_id:
      'sourceAgentId' in payload && typeof payload.sourceAgentId === 'string'
        ? payload.sourceAgentId
        : existing?.source_agent_id,
    is_favorite: typeof payload.isFavorite === 'boolean' ? payload.isFavorite : existing?.is_favorite,
  };
};

const getWorkspaceAgentById = async (agentId: string): Promise<WorkspaceAgentItem | undefined> => {
  const result = await dynamo.send(
    new GetCommand({
      TableName: WORKSPACE_TABLE,
      Key: {
        tenant_id: CLIENT_NAME,
        agent_id: agentId,
      },
    })
  );
  return result.Item as WorkspaceAgentItem | undefined;
};

const getUserAgentById = async (agentId: string, userId: string): Promise<UserAgentItem | undefined> => {
  const result = await dynamo.send(
    new GetCommand({
      TableName: USER_TABLE,
      Key: {
        user_id: userId,
        agent_id: agentId,
      },
    })
  );
  return result.Item as UserAgentItem | undefined;
};

const getUserAgentByAgentIdOnly = async (agentId: string): Promise<UserAgentItem | undefined> => {
  if (!USER_TABLE) return undefined;
  const result = await dynamo.send(
    new QueryCommand({
      TableName: USER_TABLE,
      IndexName: 'agent-id-index',
      KeyConditionExpression: 'agent_id = :aid',
      ExpressionAttributeValues: { ':aid': agentId },
      Limit: 1,
    })
  );
  return result.Items?.[0] as UserAgentItem | undefined;
};

const listUserAgents = async (userId: string): Promise<UserAgentItem[]> => {
  const response = await dynamo.send(
    new QueryCommand({
      TableName: USER_TABLE,
      KeyConditionExpression: 'user_id = :uid',
      ExpressionAttributeValues: {
        ':uid': userId,
      },
    })
  );
  const items = (response.Items || []) as UserAgentItem[];
  return items;
};

const listWorkspaceAgentsForTenant = async (): Promise<WorkspaceAgentItem[]> => {
  const response = await dynamo.send(
    new QueryCommand({
      TableName: WORKSPACE_TABLE,
      KeyConditionExpression: 'tenant_id = :tenant',
      ExpressionAttributeValues: {
        ':tenant': CLIENT_NAME,
      },
    })
  );
  return (response.Items || []) as WorkspaceAgentItem[];
};

const listWorkspaceAgentsByCreator = async (userId: string): Promise<WorkspaceAgentItem[]> => {
  const response = await dynamo.send(
    new QueryCommand({
      TableName: WORKSPACE_TABLE,
      IndexName: 'agent-creator-index',
      KeyConditionExpression: 'created_by_user_id = :uid',
      ExpressionAttributeValues: {
        ':uid': userId,
      },
    })
  );
  const items = (response.Items || []) as WorkspaceAgentItem[];
  return items.filter((item) => item.tenant_id === CLIENT_NAME);
};

const buildPathSegments = (event: APIGatewayProxyEventV2): string[] => {
  const rawPath = event.requestContext.http?.path ?? event.rawPath ?? '';
  const trimmed = rawPath.replace(/^\/+/, '');
  const withoutApi = trimmed.startsWith('api/') ? trimmed.slice(4) : trimmed;
  return withoutApi.split('/').filter(Boolean);
};

const parseJsonBody = <T>(body: string | undefined): T | null => {
  if (!body) return null;
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    console.error('Failed to parse JSON body', error);
    return null;
  }
};

const handleListAgents = async (
  event: APIGatewayProxyEventV2,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  const scope = (event.queryStringParameters?.scope || 'owned').toLowerCase();
  if (!['owned', 'public', 'all'].includes(scope)) {
    return errorResponse(400, `Invalid scope '${scope}'. Must be one of: owned, public, all.`);
  }
  const includeOwned = scope === 'owned' || scope === 'all';
  const includePublic = scope === 'public' || scope === 'all';
  const agentTypeFilter = event.queryStringParameters?.agentType?.toLowerCase();
  const titleFilter = event.queryStringParameters?.title?.toLowerCase();
  const searchFilter = event.queryStringParameters?.search?.toLowerCase();
  const limit = Math.min(parseInt(event.queryStringParameters?.limit || '0', 10) || 0, 200) || undefined;
  const offset = parseInt(event.queryStringParameters?.offset || '0', 10) || 0;

  const matchesFilter = (agent: AgentResponse): boolean => {
    if (titleFilter && !agent.title.toLowerCase().includes(titleFilter)) return false;
    if (searchFilter) {
      const searchable = `${agent.title} ${agent.description ?? ''} ${(agent.tags ?? []).join(' ')}`.toLowerCase();
      if (!searchable.includes(searchFilter)) return false;
    }
    return true;
  };

  const results = new Map<string, AgentResponse>();

  if (includeOwned) {
    const [userAgents, ownedWorkspaceAgents] = await Promise.all([
      listUserAgents(auth.sub),
      listWorkspaceAgentsByCreator(auth.sub),
    ]);

    userAgents.forEach((item) => {
      const mapped = mapUserAgent(item);
      if ((!agentTypeFilter || mapped.agentType.toLowerCase() === agentTypeFilter) && matchesFilter(mapped)) {
        results.set(`user:${mapped.agentId}`, mapped);
      }
    });

    ownedWorkspaceAgents.forEach((item) => {
      const mapped = mapWorkspaceAgent(item);
      if ((!agentTypeFilter || mapped.agentType.toLowerCase() === agentTypeFilter) && matchesFilter(mapped)) {
        results.set(`workspace:${mapped.agentId}`, mapped);
      }
    });
  }

  if (includePublic) {
    const workspaceAgents = await listWorkspaceAgentsForTenant();
    workspaceAgents.forEach((item) => {
      const mapped = mapWorkspaceAgent(item);
      if ((!agentTypeFilter || mapped.agentType.toLowerCase() === agentTypeFilter) && matchesFilter(mapped)) {
        results.set(`workspace:${mapped.agentId}`, mapped);
      }
    });
  }

  const allAgents = Array.from(results.values()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const total = allAgents.length;
  const agents = limit ? allAgents.slice(offset, offset + limit) : allAgents;

  const response: Record<string, unknown> = { agents };
  if (limit) {
    response.pagination = { total, limit, offset, hasMore: offset + limit < total };
  }
  return jsonResponse(200, response);
};

const handleGetAgent = async (agentId: string, auth: AuthContext): Promise<ReturnType<typeof jsonResponse>> => {
  const personal = await getUserAgentById(agentId, auth.sub);
  if (personal) {
    return jsonResponse(200, { agent: mapUserAgent(personal) });
  }

  const workspace = await getWorkspaceAgentById(agentId);
  if (workspace) {
    return jsonResponse(200, { agent: mapWorkspaceAgent(workspace) });
  }

  // Share fallback: a personal agent owned by someone else may be shared with
  // a team the caller is in (or directly with the caller).
  const shareRole = await getAgentShareRoleForUser(agentId, auth);
  if (shareRole) {
    const sharedAgent = await getUserAgentByAgentIdOnly(agentId);
    if (sharedAgent) {
      return jsonResponse(200, { agent: { ...mapUserAgent(sharedAgent), shareRole } });
    }
  }

  return errorResponse(404, 'Agent not found');
};

const validateTaxonomyPayload = (payload: CreateAgentPayload | UpdateAgentPayload): string | null => {
  if (payload.personas !== undefined) {
    const { invalid } = normalisePersonas(payload.personas);
    if (invalid.length > 0) {
      return `Invalid persona values: ${invalid.join(', ')}`;
    }
  }
  if (payload.industries !== undefined) {
    const { invalid } = normaliseIndustries(payload.industries);
    if (invalid.length > 0) {
      return `Invalid industry values: ${invalid.join(', ')}`;
    }
  }
  return null;
};

const validateCreatePayload = (payload: CreateAgentPayload | null): string | null => {
  if (!payload) return 'Invalid JSON body';
  if (!payload.systemPrompt || !payload.systemPrompt.trim()) {
    return 'systemPrompt is required';
  }
  if (!payload.title || !payload.title.trim()) {
    return 'title is required';
  }
  if (payload.referenceFiles && payload.referenceFiles.length > 5) {
    return 'A maximum of 5 reference files is supported';
  }
  if (
    payload.estimatedTimeSavedMinutes !== undefined &&
    (typeof payload.estimatedTimeSavedMinutes !== 'number' || payload.estimatedTimeSavedMinutes < 0)
  ) {
    return 'estimatedTimeSavedMinutes must be a non-negative number';
  }
  const taxonomyError = validateTaxonomyPayload(payload);
  if (taxonomyError) return taxonomyError;
  return null;
};

const handleCreateAgent = async (
  payload: CreateAgentPayload | null,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  const validationError = validateCreatePayload(payload);
  if (validationError) return errorResponse(400, validationError);
  const now = Date.now();
  const agentId = generateAgentId();

  const visibility: AgentVisibility = payload?.visibility === 'public' ? 'public' : 'personal';

  if (visibility === 'public') {
    const workspaceItem = buildWorkspaceItem(payload ?? {}, auth, now, agentId);
    // Ensure public agents' icon images live under a shared public prefix readable by all users
    if (workspaceItem.icon_image?.s3Bucket && workspaceItem.icon_image?.s3Key && OUTPUTS_BUCKET_NAME) {
      try {
        const img = workspaceItem.icon_image;
        const inPublicPrefix =
          img.s3Bucket === OUTPUTS_BUCKET_NAME && img.s3Key.startsWith('numa-chat/agent-icons/public/');
        if (!inPublicPrefix) {
          const s3 = withPRM(S3Client, {});
          const extMatch = img.s3Key.match(/\.([a-zA-Z0-9]+)$/);
          const ext = (extMatch?.[1] || 'png').toLowerCase();
          const destKey = `numa-chat/agent-icons/public/${agentId}.${ext}`;
          await s3.send(
            new CopyObjectCommand({
              Bucket: OUTPUTS_BUCKET_NAME,
              Key: destKey,
              CopySource: `${img.s3Bucket}/${encodeURIComponent(img.s3Key)}`,
              MetadataDirective: 'COPY',
            })
          );
          workspaceItem.icon_image = { s3Bucket: OUTPUTS_BUCKET_NAME, s3Key: destKey };
        }
      } catch (e) {
        console.warn('CreateAgent: failed to normalise public icon image', { agentId, error: (e as Error)?.message });
      }
    }
    await dynamo.send(
      new PutCommand({
        TableName: WORKSPACE_TABLE,
        Item: workspaceItem,
      })
    );
    return jsonResponse(201, { agent: mapWorkspaceAgent(workspaceItem) });
  }

  const userItem = buildUserItem(payload ?? {}, auth, now, agentId);
  await dynamo.send(
    new PutCommand({
      TableName: USER_TABLE,
      Item: userItem,
    })
  );
  return jsonResponse(201, { agent: mapUserAgent(userItem) });
};

const syncAgentSchedules = async (
  agentId: string,
  updatedAgentResponse: AgentResponse | null,
  action: 'update' | 'delete'
): Promise<void> => {
  if (!AGENT_SCHEDULES_TABLE) return;
  try {
    // 1. Sync regular agent schedules
    const schedulesResult = await dynamo.send(
      new QueryCommand({
        TableName: AGENT_SCHEDULES_TABLE,
        IndexName: 'agent-id-index',
        KeyConditionExpression: 'agent_id = :agentId',
        ExpressionAttributeValues: {
          ':agentId': agentId,
        },
      })
    );
    if (schedulesResult.Items && schedulesResult.Items.length > 0) {
      for (const rawItem of schedulesResult.Items) {
        const item = rawItem as { user_id: string; schedule_id: string; status: string };
        if (action === 'delete') {
          if (item.status === 'active') {
            await dynamo.send(
              new UpdateCommand({
                TableName: AGENT_SCHEDULES_TABLE,
                Key: { user_id: item.user_id, schedule_id: item.schedule_id },
                UpdateExpression: 'SET #status = :paused, updated_at = :ts',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':paused': 'paused', ':ts': Date.now() },
              })
            );
          }
        } else if (action === 'update' && updatedAgentResponse) {
          await dynamo.send(
            new UpdateCommand({
              TableName: AGENT_SCHEDULES_TABLE,
              Key: { user_id: item.user_id, schedule_id: item.schedule_id },
              UpdateExpression: 'SET agent_title = :at, agent_snapshot = :as, updated_at = :ts',
              ExpressionAttributeValues: {
                ':at': updatedAgentResponse.title,
                ':as': updatedAgentResponse,
                ':ts': Date.now(),
              },
            })
          );
        }
      }
    }

    // 2. Sync application schedules
    const appSchedulesResult = await dynamo.send(
      new QueryCommand({
        TableName: AGENT_SCHEDULES_TABLE,
        IndexName: 'app-id-index',
        KeyConditionExpression: 'app_id = :appId',
        ExpressionAttributeValues: {
          ':appId': agentId,
        },
      })
    );
    if (appSchedulesResult.Items && appSchedulesResult.Items.length > 0) {
      for (const rawItem of appSchedulesResult.Items) {
        const item = rawItem as { user_id: string; schedule_id: string; status: string };
        if (action === 'delete') {
          if (item.status === 'active') {
            await dynamo.send(
              new UpdateCommand({
                TableName: AGENT_SCHEDULES_TABLE,
                Key: { user_id: item.user_id, schedule_id: item.schedule_id },
                UpdateExpression: 'SET #status = :paused, updated_at = :ts',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':paused': 'paused', ':ts': Date.now() },
              })
            );
          }
        } else if (action === 'update' && updatedAgentResponse) {
          await dynamo.send(
            new UpdateCommand({
              TableName: AGENT_SCHEDULES_TABLE,
              Key: { user_id: item.user_id, schedule_id: item.schedule_id },
              UpdateExpression: 'SET app_title = :at, updated_at = :ts',
              // Note: Application schedules do not currently hold an `agent_snapshot` field, only `app_title`
              ExpressionAttributeValues: {
                ':at': updatedAgentResponse.title,
                ':ts': Date.now(),
              },
            })
          );
        }
      }
    }
  } catch (err) {
    console.error('Failed to sync agent schedules', err);
  }
};

const handleUpdateAgent = async (
  agentId: string,
  payload: UpdateAgentPayload | null,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (!payload) {
    return errorResponse(400, 'Invalid JSON body');
  }
  if (payload.referenceFiles && payload.referenceFiles.length > 5) {
    return errorResponse(400, 'A maximum of 5 reference files is supported');
  }
  const taxonomyError = validateTaxonomyPayload(payload);
  if (taxonomyError) return errorResponse(400, taxonomyError);

  const [userAgent, workspaceAgent] = await Promise.all([
    getUserAgentById(agentId, auth.sub),
    getWorkspaceAgentById(agentId),
  ]);

  // FEAT-206 — Arcanum-managed agents are read-only here; edits happen in the
  // central library and land via a re-deploy (which writes DynamoDB directly).
  if (workspaceAgent?.managed_by === 'arcanum') {
    return errorResponse(403, 'This agent is managed by Arcanum and cannot be edited here.');
  }

  const now = Date.now();

  if (userAgent) {
    const merged = buildUserItem(payload, auth, now, agentId, userAgent);

    if (merged.visibility === 'public') {
      const publicAgentId = workspaceAgent?.agent_id ?? agentId;
      merged.source_agent_id = publicAgentId;
    } else if (payload.visibility === 'personal' && merged.source_agent_id === agentId) {
      merged.source_agent_id = undefined;
    }

    await dynamo.send(
      new PutCommand({
        TableName: USER_TABLE,
        Item: merged,
      })
    );

    if (merged.visibility === 'public') {
      const publicAgentId = merged.source_agent_id ?? agentId;
      const workspaceItem: WorkspaceAgentItem = {
        tenant_id: CLIENT_NAME!,
        agent_id: publicAgentId,
        visibility: 'public',
        agent_type: merged.agent_type,
        title: merged.title,
        description: merged.description,
        system_prompt: merged.system_prompt,
        user_instructions: merged.user_instructions,
        estimated_time_saved_minutes: merged.estimated_time_saved_minutes,
        is_favorite: merged.is_favorite,
        icon: merged.icon,
        icon_image: merged.icon_image,
        required_integrations: merged.required_integrations ?? [],
        tools_config: merged.tools_config,
        reference_files: merged.reference_files,
        tags: merged.tags ?? [],
        personas: merged.personas ?? [],
        industries: merged.industries ?? [],
        created_by_user_id: workspaceAgent?.created_by_user_id ?? merged.created_by_user_id,
        created_by_name: workspaceAgent?.created_by_name ?? merged.created_by_name,
        created_at: workspaceAgent?.created_at ?? merged.created_at ?? now,
        updated_at: now,
        version: now,
      };

      // Normalise icon image to public prefix
      if (workspaceItem.icon_image?.s3Bucket && workspaceItem.icon_image?.s3Key && OUTPUTS_BUCKET_NAME) {
        try {
          const img = workspaceItem.icon_image;
          const inPublicPrefix =
            img.s3Bucket === OUTPUTS_BUCKET_NAME && img.s3Key.startsWith('numa-chat/agent-icons/public/');
          if (!inPublicPrefix) {
            const s3 = withPRM(S3Client, {});
            const extMatch = img.s3Key.match(/\.([a-zA-Z0-9]+)$/);
            const ext = (extMatch?.[1] || 'png').toLowerCase();
            const destKey = `numa-chat/agent-icons/public/${publicAgentId}.${ext}`;
            await s3.send(
              new CopyObjectCommand({
                Bucket: OUTPUTS_BUCKET_NAME,
                Key: destKey,
                CopySource: `${img.s3Bucket}/${encodeURIComponent(img.s3Key)}`,
                MetadataDirective: 'COPY',
              })
            );
            workspaceItem.icon_image = { s3Bucket: OUTPUTS_BUCKET_NAME, s3Key: destKey };
          }
        } catch (e) {
          console.warn('UpdateAgent->Public: failed to normalise public icon image', {
            agentId: publicAgentId,
            error: (e as Error)?.message,
          });
        }
      }

      await dynamo.send(
        new PutCommand({
          TableName: WORKSPACE_TABLE,
          Item: workspaceItem,
        })
      );
    } else if (workspaceAgent && workspaceAgent.created_by_user_id === auth.sub) {
      await dynamo.send(
        new DeleteCommand({
          TableName: WORKSPACE_TABLE,
          Key: {
            tenant_id: CLIENT_NAME!,
            agent_id: agentId,
          },
        })
      );
    }

    const responseAgent = mapUserAgent(merged);
    await syncAgentSchedules(agentId, responseAgent, 'update');
    return jsonResponse(200, { agent: responseAgent });
  }

  if (workspaceAgent) {
    if (workspaceAgent.created_by_user_id !== auth.sub && !isAdmin(auth)) {
      return errorResponse(403, 'You do not have permission to update this agent');
    }
    // Moving workspace agent to personal: create user item, delete workspace item
    if (payload.visibility === 'personal') {
      const userItem = buildUserItem(payload, auth, now, agentId);
      // Preserve original creation metadata from the workspace agent
      userItem.created_at = workspaceAgent.created_at ?? now;
      userItem.created_by_user_id = workspaceAgent.created_by_user_id ?? auth.sub;
      userItem.created_by_name = workspaceAgent.created_by_name ?? userItem.created_by_name;
      userItem.visibility = 'personal';
      userItem.source_agent_id = undefined;

      await dynamo.send(
        new PutCommand({
          TableName: USER_TABLE,
          Item: userItem,
        })
      );
      await dynamo.send(
        new DeleteCommand({
          TableName: WORKSPACE_TABLE,
          Key: {
            tenant_id: CLIENT_NAME!,
            agent_id: agentId,
          },
        })
      );
      const responseAgent = mapUserAgent(userItem);
      await syncAgentSchedules(agentId, responseAgent, 'update');
      return jsonResponse(200, { agent: responseAgent });
    }

    const userWelcomeMessage = resolveWelcomeMessageFromPayload(payload, workspaceAgent);
    const merged: WorkspaceAgentItem = {
      ...workspaceAgent,
      visibility: 'public',
      agent_type: payload.agentType ?? workspaceAgent.agent_type,
      title: payload.title?.trim() ?? workspaceAgent.title,
      description: payload.description?.trim() ?? workspaceAgent.description,
      system_prompt: payload.systemPrompt?.trim() ?? workspaceAgent.system_prompt,
      user_instructions: userWelcomeMessage,
      estimated_time_saved_minutes:
        'estimatedTimeSavedMinutes' in payload && typeof payload.estimatedTimeSavedMinutes === 'number'
          ? Math.max(0, Math.floor(payload.estimatedTimeSavedMinutes))
          : workspaceAgent.estimated_time_saved_minutes,
      is_favorite:
        'isFavorite' in payload && typeof payload.isFavorite === 'boolean'
          ? payload.isFavorite
          : workspaceAgent.is_favorite,
      icon: payload.icon?.trim() ?? workspaceAgent.icon,
      icon_image:
        'iconImage' in payload
          ? payload.iconImage && payload.iconImage.s3Bucket && payload.iconImage.s3Key
            ? payload.iconImage
            : undefined
          : workspaceAgent.icon_image,
      required_integrations: Array.isArray(payload.requiredIntegrations)
        ? payload.requiredIntegrations
        : (workspaceAgent.required_integrations ?? []),
      tools_config: normaliseToolsConfig(payload.toolsConfig ?? workspaceAgent.tools_config),
      model_id:
        'modelId' in payload && typeof payload.modelId === 'string'
          ? normaliseModelId(payload.modelId)
          : workspaceAgent.model_id,
      reference_files: normaliseReferenceFiles(payload.referenceFiles ?? workspaceAgent.reference_files),
      tags: normaliseTags(payload.tags ?? workspaceAgent.tags),
      personas: normalisePersonas(payload.personas ?? workspaceAgent.personas).values,
      industries: normaliseIndustries(payload.industries ?? workspaceAgent.industries).values,
      updated_at: now,
      version: now,
    };

    // Ensure icon image for workspace agent lives in public prefix
    if (merged.icon_image?.s3Bucket && merged.icon_image?.s3Key && OUTPUTS_BUCKET_NAME) {
      try {
        const img = merged.icon_image;
        const inPublicPrefix =
          img.s3Bucket === OUTPUTS_BUCKET_NAME && img.s3Key.startsWith('numa-chat/agent-icons/public/');
        if (!inPublicPrefix) {
          const s3 = withPRM(S3Client, {});
          const extMatch = img.s3Key.match(/\.([a-zA-Z0-9]+)$/);
          const ext = (extMatch?.[1] || 'png').toLowerCase();
          const destKey = `numa-chat/agent-icons/public/${workspaceAgent.agent_id}.${ext}`;
          await s3.send(
            new CopyObjectCommand({
              Bucket: OUTPUTS_BUCKET_NAME,
              Key: destKey,
              CopySource: `${img.s3Bucket}/${encodeURIComponent(img.s3Key)}`,
              MetadataDirective: 'COPY',
            })
          );
          merged.icon_image = { s3Bucket: OUTPUTS_BUCKET_NAME, s3Key: destKey };
        }
      } catch (e) {
        console.warn('UpdateWorkspaceAgent: failed to normalise public icon image', {
          agentId,
          error: (e as Error)?.message,
        });
      }
    }

    await dynamo.send(
      new PutCommand({
        TableName: WORKSPACE_TABLE,
        Item: merged,
      })
    );
    const responseAgent = mapWorkspaceAgent(merged);
    await syncAgentSchedules(agentId, responseAgent, 'update');
    return jsonResponse(200, { agent: responseAgent });
  }

  // Share fallback: the caller isn't the owner, but may have edit rights via a
  // direct user share or through a team. Co-owners and editors can update the
  // agent; the update is written back under the original creator's user_id and
  // does NOT allow transferring ownership or switching to a public/workspace
  // agent (those remain creator-only actions).
  const shareRole = await getAgentShareRoleForUser(agentId, auth);
  if (shareRole) {
    const sharedAgent = await getUserAgentByAgentIdOnly(agentId);
    if (!sharedAgent) return errorResponse(404, 'Agent not found');
    if (!canEditViaShare(shareRole)) {
      return errorResponse(403, 'You do not have permission to update this agent');
    }

    const ownerAuth: AuthContext = {
      sub: sharedAgent.user_id,
      email: undefined,
      name: sharedAgent.created_by_name,
      groups: [],
    };
    // Share-based edits cannot change ownership or promote to workspace-public.
    const safePayload: UpdateAgentPayload = { ...payload };
    delete safePayload.visibility;
    const merged = buildUserItem(safePayload, ownerAuth, now, agentId, sharedAgent);
    // Preserve creator identity explicitly (buildUserItem falls back to ownerAuth).
    merged.created_by_user_id = sharedAgent.created_by_user_id ?? sharedAgent.user_id;
    merged.created_by_name = sharedAgent.created_by_name ?? merged.created_by_name;
    merged.source_agent_id = sharedAgent.source_agent_id;

    await dynamo.send(
      new PutCommand({
        TableName: USER_TABLE,
        Item: merged,
      })
    );

    const responseAgent = { ...mapUserAgent(merged), shareRole };
    await syncAgentSchedules(agentId, responseAgent, 'update');
    return jsonResponse(200, { agent: responseAgent });
  }

  return errorResponse(404, 'Agent not found');
};

const handleDeleteAgent = async (agentId: string, auth: AuthContext): Promise<ReturnType<typeof jsonResponse>> => {
  const [userAgent, workspaceAgent] = await Promise.all([
    getUserAgentById(agentId, auth.sub),
    getWorkspaceAgentById(agentId),
  ]);

  // FEAT-206 — Arcanum-managed agents can only be removed by un-listing them in
  // the central library + re-deploying (drift reconciliation), not deleted here.
  if (workspaceAgent?.managed_by === 'arcanum') {
    return errorResponse(403, 'This agent is managed by Arcanum and cannot be deleted here.');
  }

  if (userAgent) {
    // Best-effort cleanup of user-owned icon image
    try {
      const img = userAgent.icon_image;
      if (
        img?.s3Bucket &&
        img?.s3Key &&
        OUTPUTS_BUCKET_NAME &&
        img.s3Bucket === OUTPUTS_BUCKET_NAME &&
        img.s3Key.startsWith(`numa-chat/agent-icons/${auth.sub}/`)
      ) {
        const s3 = withPRM(S3Client, {});
        await s3.send(new DeleteObjectCommand({ Bucket: OUTPUTS_BUCKET_NAME, Key: img.s3Key }));
      }
    } catch (e) {
      console.warn('DeleteAgent: failed to delete icon image', {
        agentId,
        error: (e as Error)?.message,
      });
    }
    await dynamo.send(
      new DeleteCommand({
        TableName: USER_TABLE,
        Key: {
          user_id: auth.sub,
          agent_id: agentId,
        },
      })
    );
    await syncAgentSchedules(agentId, null, 'delete');
    return jsonResponse(200, { ok: true });
  }

  if (workspaceAgent) {
    if (workspaceAgent.created_by_user_id !== auth.sub && !isAdmin(auth)) {
      return errorResponse(403, 'You do not have permission to delete this agent');
    }
    // Best-effort cleanup of public icon image when deleting a workspace agent
    try {
      const img = workspaceAgent.icon_image;
      if (
        img?.s3Bucket &&
        img?.s3Key &&
        OUTPUTS_BUCKET_NAME &&
        img.s3Bucket === OUTPUTS_BUCKET_NAME &&
        img.s3Key.startsWith('numa-chat/agent-icons/public/')
      ) {
        const s3 = withPRM(S3Client, {});
        await s3.send(new DeleteObjectCommand({ Bucket: OUTPUTS_BUCKET_NAME, Key: img.s3Key }));
      }
    } catch (e) {
      console.warn('DeleteWorkspaceAgent: failed to delete public icon image', {
        agentId,
        error: (e as Error)?.message,
      });
    }
    await dynamo.send(
      new DeleteCommand({
        TableName: WORKSPACE_TABLE,
        Key: {
          tenant_id: CLIENT_NAME,
          agent_id: agentId,
        },
      })
    );
    await syncAgentSchedules(agentId, null, 'delete');
    return jsonResponse(200, { ok: true });
  }

  // Share fallback: only co-owners can delete on behalf of the creator.
  const shareRole = await getAgentShareRoleForUser(agentId, auth);
  if (shareRole) {
    if (shareRole !== 'co-owner') {
      return errorResponse(403, 'You do not have permission to delete this agent');
    }
    const sharedAgent = await getUserAgentByAgentIdOnly(agentId);
    if (!sharedAgent) return errorResponse(404, 'Agent not found');
    await dynamo.send(
      new DeleteCommand({
        TableName: USER_TABLE,
        Key: {
          user_id: sharedAgent.user_id,
          agent_id: agentId,
        },
      })
    );
    await syncAgentSchedules(agentId, null, 'delete');
    return jsonResponse(200, { ok: true });
  }

  return errorResponse(404, 'Agent not found');
};

const duplicateWorkspaceAgent = async (
  agentId: string,
  workspaceAgent: WorkspaceAgentItem,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  const existingAgents = await listUserAgents(auth.sub);
  const duplicateTitle = generateDuplicateTitle(workspaceAgent.title, existingAgents);
  const duplicatePayload = buildPersonalDuplicatePayload(workspaceAgent, duplicateTitle, 'workspace');

  const now = Date.now();
  const newId = generateAgentId();

  if (workspaceAgent.icon_image?.s3Bucket && workspaceAgent.icon_image?.s3Key && OUTPUTS_BUCKET_NAME) {
    try {
      const s3 = withPRM(S3Client, {});
      const srcBucket = workspaceAgent.icon_image.s3Bucket;
      const srcKey = workspaceAgent.icon_image.s3Key;
      const extMatch = srcKey.match(/\.([a-zA-Z0-9]+)$/);
      const ext = (extMatch?.[1] || 'png').toLowerCase();
      const randomId = Math.random().toString(36).slice(2, 10);
      const destKey = `numa-chat/agent-icons/${auth.sub}/${now}_${randomId}.${ext}`;

      await s3.send(
        new CopyObjectCommand({
          Bucket: OUTPUTS_BUCKET_NAME,
          Key: destKey,
          CopySource: `${srcBucket}/${encodeURIComponent(srcKey)}`,
          MetadataDirective: 'COPY',
        })
      );
      duplicatePayload.iconImage = { s3Bucket: OUTPUTS_BUCKET_NAME, s3Key: destKey };
      delete duplicatePayload.icon;
    } catch (e) {
      console.warn('DuplicateAgent: failed to copy icon image', { agentId, error: (e as Error)?.message });
    }
  }

  duplicatePayload.referenceFiles = await relocateManagedReferenceFiles(
    duplicatePayload.referenceFiles,
    auth.sub,
    newId
  );

  const userItem = buildUserItem(duplicatePayload, auth, now, newId);

  await dynamo.send(
    new PutCommand({
      TableName: USER_TABLE,
      Item: userItem,
      ConditionExpression: 'attribute_not_exists(agent_id) AND attribute_not_exists(user_id)',
    })
  );

  return jsonResponse(201, { agent: mapUserAgent(userItem) });
};

const duplicatePersonalAgent = async (
  agent: UserAgentItem,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (agent.user_id !== auth.sub) {
    return errorResponse(403, 'You do not have permission to duplicate this agent');
  }

  const existingAgents = await listUserAgents(auth.sub);
  const duplicateTitle = generateDuplicateTitle(agent.title, existingAgents);
  const duplicatePayload = buildPersonalDuplicatePayload(agent, duplicateTitle);

  const now = Date.now();
  const newId = generateAgentId();
  duplicatePayload.referenceFiles = await relocateManagedReferenceFiles(
    duplicatePayload.referenceFiles,
    auth.sub,
    newId
  );
  const userItem = buildUserItem(duplicatePayload, auth, now, newId);

  await dynamo.send(
    new PutCommand({
      TableName: USER_TABLE,
      Item: userItem,
      ConditionExpression: 'attribute_not_exists(agent_id) AND attribute_not_exists(user_id)',
    })
  );

  return jsonResponse(201, { agent: mapUserAgent(userItem) });
};

type DuplicateOptions = { targetVisibility?: 'personal' | 'workspace' };

const duplicateAsWorkspaceAgent = async (
  agent: WorkspaceAgentItem | UserAgentItem,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  const existingWorkspace = await listWorkspaceAgentsForTenant();
  const duplicateTitle = generateDuplicateTitle(agent.title, existingWorkspace as unknown as UserAgentItem[]);

  const referenceFiles = normaliseReferenceFiles(agent.reference_files);
  const processedReferenceFiles = referenceFiles.length
    ? referenceFiles.map((file) => (!file.source ? { ...file, source: 'workspace' } : file))
    : undefined;

  const payload: CreateAgentPayload = {
    visibility: 'public',
    agentType: agent.agent_type,
    title: duplicateTitle,
    description: agent.description,
    systemPrompt: agent.system_prompt,
    userWelcomeMessage: agent.user_instructions,
    estimatedTimeSavedMinutes: agent.estimated_time_saved_minutes,
    icon: agent.icon,
    iconImage: agent.icon_image,
    requiredIntegrations: agent.required_integrations ?? [],
    toolsConfig: agent.tools_config ?? {},
    modelId: agent.model_id,
    referenceFiles: processedReferenceFiles,
    sourceAgentId: resolveSourceAgentId(agent),
    tags: agent.tags ?? [],
    personas: agent.personas ?? [],
    industries: agent.industries ?? [],
  };

  const now = Date.now();
  const newId = generateAgentId();

  if (agent.icon_image?.s3Bucket && agent.icon_image?.s3Key && OUTPUTS_BUCKET_NAME) {
    try {
      const s3 = withPRM(S3Client, {});
      const srcBucket = agent.icon_image.s3Bucket;
      const srcKey = agent.icon_image.s3Key;
      const extMatch = srcKey.match(/\.([a-zA-Z0-9]+)$/);
      const ext = (extMatch?.[1] || 'png').toLowerCase();
      const randomId = Math.random().toString(36).slice(2, 10);
      const destKey = `numa-chat/agent-icons/workspace/${now}_${randomId}.${ext}`;

      await s3.send(
        new CopyObjectCommand({
          Bucket: OUTPUTS_BUCKET_NAME,
          Key: destKey,
          CopySource: `${srcBucket}/${encodeURIComponent(srcKey)}`,
          MetadataDirective: 'COPY',
        })
      );
      payload.iconImage = { s3Bucket: OUTPUTS_BUCKET_NAME, s3Key: destKey };
      delete payload.icon;
    } catch (e) {
      console.warn('DuplicateAgent: failed to copy icon image', { error: (e as Error)?.message });
    }
  }

  payload.referenceFiles = await relocateManagedReferenceFiles(payload.referenceFiles, 'workspace', newId);

  const workspaceItem = buildWorkspaceItem(payload, auth, now, newId);

  await dynamo.send(
    new PutCommand({
      TableName: WORKSPACE_TABLE,
      Item: workspaceItem,
      ConditionExpression: 'attribute_not_exists(agent_id) AND attribute_not_exists(tenant_id)',
    })
  );

  return jsonResponse(201, {
    agent: {
      agentId: workspaceItem.agent_id,
      title: workspaceItem.title,
      scope: 'workspace',
      visibility: workspaceItem.visibility,
      owner: { userId: workspaceItem.created_by_user_id, name: workspaceItem.created_by_name },
      updatedAt: workspaceItem.updated_at,
      tags: workspaceItem.tags || [],
      personas: workspaceItem.personas || [],
      industries: workspaceItem.industries || [],
    },
  });
};

const handleDuplicateAgent = async (
  agentId: string,
  auth: AuthContext,
  options?: DuplicateOptions
): Promise<ReturnType<typeof jsonResponse>> => {
  const targetVisibility = options?.targetVisibility ?? 'personal';

  // Try own personal agent first
  const personalAgent = await getUserAgentById(agentId, auth.sub);
  if (personalAgent) {
    if (targetVisibility === 'workspace') {
      if (!isAdmin(auth)) return errorResponse(403, 'Admin access required to duplicate as workspace agent');
      return duplicateAsWorkspaceAgent(personalAgent, auth);
    }
    return duplicatePersonalAgent(personalAgent, auth);
  }

  // Try workspace agent
  const workspaceAgent = await getWorkspaceAgentById(agentId);
  if (workspaceAgent) {
    if (targetVisibility === 'workspace') {
      if (!isAdmin(auth)) return errorResponse(403, 'Admin access required to duplicate as workspace agent');
      return duplicateAsWorkspaceAgent(workspaceAgent, auth);
    }
    return duplicateWorkspaceAgent(agentId, workspaceAgent, auth);
  }

  // Admin: try any user's personal agent via GSI
  if (isAdmin(auth)) {
    const anyUserAgent = await getUserAgentByAgentIdOnly(agentId);
    if (anyUserAgent) {
      if (targetVisibility === 'workspace') {
        return duplicateAsWorkspaceAgent(anyUserAgent, auth);
      }
      return duplicatePersonalAgent({ ...anyUserAgent, user_id: auth.sub } as UserAgentItem, auth);
    }
  }

  return errorResponse(404, 'Agent not found');
};

// ─── Prefs ───────────────────────────────────────────────────────────────────

type AgentUserPrefs = {
  user_id: string;
  agent_id: string;
  is_favorite?: boolean;
  is_hidden?: boolean;
  updated_at: number;
};

const handleGetPrefs = async (auth: AuthContext): Promise<ReturnType<typeof jsonResponse>> => {
  if (!PREFS_TABLE) return jsonResponse(200, { prefs: [] });
  const res = await dynamo.send(
    new QueryCommand({
      TableName: PREFS_TABLE,
      KeyConditionExpression: 'user_id = :uid',
      ExpressionAttributeValues: { ':uid': auth.sub },
    })
  );
  const prefs = (res.Items || []).map((item) => ({
    agentId: (item as AgentUserPrefs).agent_id,
    isFavorite: (item as AgentUserPrefs).is_favorite ?? false,
    isHidden: (item as AgentUserPrefs).is_hidden ?? false,
  }));
  return jsonResponse(200, { prefs });
};

const handleSetPref = async (
  agentId: string,
  body: { isFavorite?: boolean; isHidden?: boolean } | null,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (!PREFS_TABLE || !body) return errorResponse(400, 'Invalid request');

  const updates: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  if (body.isFavorite !== undefined) {
    updates.push('#fav = :fav');
    names['#fav'] = 'is_favorite';
    values[':fav'] = body.isFavorite;
  }
  if (body.isHidden !== undefined) {
    updates.push('#hid = :hid');
    names['#hid'] = 'is_hidden';
    values[':hid'] = body.isHidden;
  }
  if (updates.length === 0) return errorResponse(400, 'No fields to update');

  updates.push('#upd = :upd');
  names['#upd'] = 'updated_at';
  values[':upd'] = Date.now();

  await dynamo.send(
    new PutCommand({
      TableName: PREFS_TABLE,
      Item: {
        user_id: auth.sub,
        agent_id: agentId,
        ...(body.isFavorite !== undefined && { is_favorite: body.isFavorite }),
        ...(body.isHidden !== undefined && { is_hidden: body.isHidden }),
        updated_at: Date.now(),
      },
    })
  );
  return jsonResponse(200, { ok: true });
};

// ─── Teams ───────────────────────────────────────────────────────────────────

type TeamItem = {
  team_id: string;
  sk: string;
  team_name: string;
  description?: string;
  created_by: string;
  created_by_name?: string;
  created_at: number;
  updated_at: number;
  tenant_id: string;
};

type TeamMemberItem = {
  team_id: string;
  user_id: string;
  role: 'owner' | 'editor' | 'viewer';
  user_name?: string;
  user_email?: string;
  added_by: string;
  added_at: number;
};

const generateTeamId = (): string => `team_${randomUUID().replace(/-/g, '')}`;

const handleListTeams = async (auth: AuthContext): Promise<ReturnType<typeof jsonResponse>> => {
  if (!TEAM_MEMBERS_TABLE || !TEAMS_TABLE) return jsonResponse(200, { teams: [] });

  // Get all teams this user belongs to
  const memberRes = await dynamo.send(
    new QueryCommand({
      TableName: TEAM_MEMBERS_TABLE,
      IndexName: 'user-teams-index',
      KeyConditionExpression: 'user_id = :uid',
      ExpressionAttributeValues: { ':uid': auth.sub },
    })
  );
  const memberships = (memberRes.Items || []) as TeamMemberItem[];
  if (memberships.length === 0) return jsonResponse(200, { teams: [] });

  // Fetch team metadata for each
  const teams = await Promise.all(
    memberships.map(async (m) => {
      const res = await dynamo.send(
        new GetCommand({ TableName: TEAMS_TABLE, Key: { team_id: m.team_id, sk: 'META' } })
      );
      const team = res.Item as TeamItem | undefined;
      if (!team) return null;
      return {
        teamId: team.team_id,
        teamName: team.team_name,
        description: team.description,
        myRole: m.role,
        createdBy: team.created_by,
        createdAt: team.created_at,
      };
    })
  );
  return jsonResponse(200, { teams: teams.filter(Boolean) });
};

const handleCreateTeam = async (
  body: { teamName?: string; description?: string; creatorName?: string; creatorEmail?: string } | null,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (!TEAMS_TABLE || !TEAM_MEMBERS_TABLE) return errorResponse(500, 'Teams not configured');
  if (!body?.teamName) return errorResponse(400, 'teamName is required');

  const teamId = generateTeamId();
  const now = Date.now();
  // Prefer body-provided name/email (from ID token on frontend) over access token claims
  const creatorName = body.creatorName || auth.name;
  const creatorEmail = body.creatorEmail || auth.email;

  // Write team metadata and the creator's owner membership atomically so a
  // partial failure can't leave an orphaned team (or a team without an owner).
  await dynamo.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TEAMS_TABLE,
            Item: {
              team_id: teamId,
              sk: 'META',
              team_name: body.teamName,
              description: body.description || '',
              created_by: auth.sub,
              created_by_name: creatorName,
              created_at: now,
              updated_at: now,
              tenant_id: CLIENT_NAME,
            },
          },
        },
        {
          Put: {
            TableName: TEAM_MEMBERS_TABLE,
            Item: {
              team_id: teamId,
              user_id: auth.sub,
              role: 'owner',
              user_name: creatorName,
              user_email: creatorEmail,
              added_by: auth.sub,
              added_at: now,
            },
          },
        },
      ],
    })
  );

  return jsonResponse(201, { teamId, teamName: body.teamName });
};

const handleGetTeam = async (teamId: string, auth: AuthContext): Promise<ReturnType<typeof jsonResponse>> => {
  if (!TEAMS_TABLE || !TEAM_MEMBERS_TABLE) return errorResponse(500, 'Teams not configured');

  const [teamRes, membersRes] = await Promise.all([
    dynamo.send(new GetCommand({ TableName: TEAMS_TABLE, Key: { team_id: teamId, sk: 'META' } })),
    dynamo.send(
      new QueryCommand({
        TableName: TEAM_MEMBERS_TABLE,
        KeyConditionExpression: 'team_id = :tid',
        ExpressionAttributeValues: { ':tid': teamId },
      })
    ),
  ]);

  const team = teamRes.Item as TeamItem | undefined;
  if (!team) return errorResponse(404, 'Team not found');

  const members = (membersRes.Items || []) as TeamMemberItem[];
  const isMember = members.some((m) => m.user_id === auth.sub);
  if (!isMember && !isAdmin(auth)) return errorResponse(403, 'Not a member of this team');

  return jsonResponse(200, {
    teamId: team.team_id,
    teamName: team.team_name,
    description: team.description,
    createdBy: team.created_by,
    createdAt: team.created_at,
    members: members.map((m) => ({
      userId: m.user_id,
      role: m.role,
      userName: m.user_name,
      userEmail: m.user_email,
      addedAt: m.added_at,
    })),
  });
};

const handleUpdateTeam = async (
  teamId: string,
  body: { teamName?: string; description?: string } | null,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (!TEAMS_TABLE || !TEAM_MEMBERS_TABLE) return errorResponse(500, 'Teams not configured');
  if (!body) return errorResponse(400, 'Invalid request');

  // Check caller is owner or editor
  const memberRes = await dynamo.send(
    new GetCommand({ TableName: TEAM_MEMBERS_TABLE, Key: { team_id: teamId, user_id: auth.sub } })
  );
  const membership = memberRes.Item as TeamMemberItem | undefined;
  if (!membership && !isAdmin(auth)) return errorResponse(403, 'Not a member of this team');
  if (membership && membership.role === 'viewer') return errorResponse(403, 'Viewers cannot update teams');

  const teamRes = await dynamo.send(new GetCommand({ TableName: TEAMS_TABLE, Key: { team_id: teamId, sk: 'META' } }));
  const team = teamRes.Item as TeamItem | undefined;
  if (!team) return errorResponse(404, 'Team not found');

  await dynamo.send(
    new PutCommand({
      TableName: TEAMS_TABLE,
      Item: {
        ...team,
        ...(body.teamName && { team_name: body.teamName }),
        ...(body.description !== undefined && { description: body.description }),
        updated_at: Date.now(),
      },
    })
  );
  return jsonResponse(200, { ok: true });
};

const handleDeleteTeam = async (teamId: string, auth: AuthContext): Promise<ReturnType<typeof jsonResponse>> => {
  if (!TEAMS_TABLE || !TEAM_MEMBERS_TABLE) return errorResponse(500, 'Teams not configured');

  // Only owner or admin can delete
  const memberRes = await dynamo.send(
    new GetCommand({ TableName: TEAM_MEMBERS_TABLE, Key: { team_id: teamId, user_id: auth.sub } })
  );
  const membership = memberRes.Item as TeamMemberItem | undefined;
  if (!isAdmin(auth) && (!membership || membership.role !== 'owner')) {
    return errorResponse(403, 'Only the team owner can delete a team');
  }

  // Delete all members
  const membersRes = await dynamo.send(
    new QueryCommand({
      TableName: TEAM_MEMBERS_TABLE,
      KeyConditionExpression: 'team_id = :tid',
      ExpressionAttributeValues: { ':tid': teamId },
    })
  );
  await Promise.all(
    (membersRes.Items || []).map((m) =>
      dynamo.send(
        new DeleteCommand({
          TableName: TEAM_MEMBERS_TABLE,
          Key: { team_id: teamId, user_id: (m as TeamMemberItem).user_id },
        })
      )
    )
  );

  // Delete team metadata
  await dynamo.send(new DeleteCommand({ TableName: TEAMS_TABLE, Key: { team_id: teamId, sk: 'META' } }));

  return jsonResponse(200, { ok: true });
};

const handleAddTeamMember = async (
  teamId: string,
  body: { userId?: string; role?: string; userName?: string; userEmail?: string } | null,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (!TEAM_MEMBERS_TABLE) return errorResponse(500, 'Teams not configured');
  if (!body?.userId || !body?.role) return errorResponse(400, 'userId and role are required');
  if (!['owner', 'editor', 'viewer'].includes(body.role)) return errorResponse(400, 'Invalid role');

  // Check caller has permission (owner or editor can add members)
  const callerRes = await dynamo.send(
    new GetCommand({ TableName: TEAM_MEMBERS_TABLE, Key: { team_id: teamId, user_id: auth.sub } })
  );
  const caller = callerRes.Item as TeamMemberItem | undefined;
  if (!isAdmin(auth) && (!caller || caller.role === 'viewer')) {
    return errorResponse(403, 'Insufficient permissions');
  }
  // Only owners can add other owners
  if (body.role === 'owner' && caller?.role !== 'owner' && !isAdmin(auth)) {
    return errorResponse(403, 'Only owners can add other owners');
  }

  try {
    await dynamo.send(
      new PutCommand({
        TableName: TEAM_MEMBERS_TABLE,
        Item: {
          team_id: teamId,
          user_id: body.userId,
          role: body.role as TeamMemberItem['role'],
          user_name: body.userName,
          user_email: body.userEmail,
          added_by: auth.sub,
          added_at: Date.now(),
        },
        // Prevent silent overwrite of an existing member row (e.g. demoting the
        // team owner from owner → viewer by accidental re-add). Role changes
        // must go through PUT /teams/:id/members/:userId.
        ConditionExpression: 'attribute_not_exists(user_id)',
      })
    );
  } catch (e) {
    if ((e as { name?: string })?.name === 'ConditionalCheckFailedException') {
      return errorResponse(409, 'User is already a member of this team');
    }
    throw e;
  }
  return jsonResponse(201, { ok: true });
};

const countTeamOwners = async (teamId: string): Promise<number> => {
  if (!TEAM_MEMBERS_TABLE) return 0;
  const res = await dynamo.send(
    new QueryCommand({
      TableName: TEAM_MEMBERS_TABLE,
      KeyConditionExpression: 'team_id = :tid',
      FilterExpression: '#role = :owner',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: { ':tid': teamId, ':owner': 'owner' },
    })
  );
  return res.Items?.length ?? 0;
};

const handleUpdateTeamMember = async (
  teamId: string,
  userId: string,
  body: { role?: string } | null,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (!TEAM_MEMBERS_TABLE) return errorResponse(500, 'Teams not configured');
  if (!body?.role || !['owner', 'editor', 'viewer'].includes(body.role)) {
    return errorResponse(400, 'Valid role is required');
  }

  // Check caller is owner
  const callerRes = await dynamo.send(
    new GetCommand({ TableName: TEAM_MEMBERS_TABLE, Key: { team_id: teamId, user_id: auth.sub } })
  );
  const caller = callerRes.Item as TeamMemberItem | undefined;
  if (!isAdmin(auth) && (!caller || caller.role !== 'owner')) {
    return errorResponse(403, 'Only owners can change roles');
  }

  const memberRes = await dynamo.send(
    new GetCommand({ TableName: TEAM_MEMBERS_TABLE, Key: { team_id: teamId, user_id: userId } })
  );
  const member = memberRes.Item as TeamMemberItem | undefined;
  if (!member) return errorResponse(404, 'Member not found');

  // Refuse to demote the last owner so a team can't be left ownerless.
  if (member.role === 'owner' && body.role !== 'owner') {
    const ownerCount = await countTeamOwners(teamId);
    if (ownerCount <= 1) {
      return errorResponse(400, 'Cannot demote the last owner of a team');
    }
  }

  try {
    await dynamo.send(
      new PutCommand({
        TableName: TEAM_MEMBERS_TABLE,
        Item: { ...member, role: body.role as TeamMemberItem['role'] },
        ConditionExpression: 'attribute_exists(user_id)',
      })
    );
  } catch (e) {
    if ((e as { name?: string })?.name === 'ConditionalCheckFailedException') {
      return errorResponse(404, 'Member not found');
    }
    throw e;
  }
  return jsonResponse(200, { ok: true });
};

const handleRemoveTeamMember = async (
  teamId: string,
  userId: string,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (!TEAM_MEMBERS_TABLE) return errorResponse(500, 'Teams not configured');

  // Check caller is owner (or removing themselves)
  if (userId !== auth.sub) {
    const callerRes = await dynamo.send(
      new GetCommand({ TableName: TEAM_MEMBERS_TABLE, Key: { team_id: teamId, user_id: auth.sub } })
    );
    const caller = callerRes.Item as TeamMemberItem | undefined;
    if (!isAdmin(auth) && (!caller || caller.role !== 'owner')) {
      return errorResponse(403, 'Only owners can remove members');
    }
  }

  await dynamo.send(new DeleteCommand({ TableName: TEAM_MEMBERS_TABLE, Key: { team_id: teamId, user_id: userId } }));
  return jsonResponse(200, { ok: true });
};

// ─── Team Agents ────────────────────────────────────────────────────────────

const handleListTeamAgents = async (teamId: string, auth: AuthContext): Promise<ReturnType<typeof jsonResponse>> => {
  if (!SHARING_TABLE || !TEAM_MEMBERS_TABLE) {
    return jsonResponse(200, { agents: [], teamId });
  }

  // Verify caller is a team member or admin
  const memberRes = await dynamo.send(
    new GetCommand({ TableName: TEAM_MEMBERS_TABLE, Key: { team_id: teamId, user_id: auth.sub } })
  );
  if (!memberRes.Item && !isAdmin(auth)) {
    return errorResponse(403, 'Not a member of this team');
  }

  // Query sharing table for all agents shared with this team
  const sharingRes = await dynamo.send(
    new QueryCommand({
      TableName: SHARING_TABLE,
      IndexName: 'principal-agents-index',
      KeyConditionExpression: 'principal_id = :pid',
      ExpressionAttributeValues: { ':pid': `team:${teamId}` },
    })
  );

  const sharingItems = (sharingRes.Items || []) as SharingItem[];
  if (sharingItems.length === 0) {
    return jsonResponse(200, { agents: [], teamId });
  }

  // Hydrate each agent -- try workspace table first, fall back to user table GSI
  const agents: (AgentResponse & { shareRole?: string })[] = [];
  await Promise.all(
    sharingItems.map(async (item) => {
      const workspaceAgent = await getWorkspaceAgentById(item.agent_id);
      if (workspaceAgent) {
        agents.push({ ...mapWorkspaceAgent(workspaceAgent), shareRole: item.role });
        return;
      }
      const userAgent = await getUserAgentByAgentIdOnly(item.agent_id);
      if (userAgent) {
        agents.push({ ...mapUserAgent(userAgent), shareRole: item.role });
      }
    })
  );

  agents.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return jsonResponse(200, { agents, teamId });
};

// ─── Sharing ─────────────────────────────────────────────────────────────────

type SharingItem = {
  agent_id: string;
  principal_id: string;
  principal_type: 'user' | 'team';
  role: 'co-owner' | 'editor' | 'viewer';
  shared_by: string;
  shared_at: number;
};

type ShareRole = SharingItem['role'];

const SHARE_ROLE_RANK: Record<ShareRole, number> = { 'co-owner': 3, editor: 2, viewer: 1 };

const higherRole = (a: ShareRole | null, b: ShareRole | null): ShareRole | null => {
  if (!a) return b;
  if (!b) return a;
  return SHARE_ROLE_RANK[a] >= SHARE_ROLE_RANK[b] ? a : b;
};

/**
 * Returns the highest sharing role (co-owner > editor > viewer) granted to `auth.sub`
 * for the given agent, either directly (principal_type='user') or via team membership
 * (principal_type='team'). Returns null if the caller has no share.
 */
const getAgentShareRoleForUser = async (agentId: string, auth: AuthContext): Promise<ShareRole | null> => {
  if (!SHARING_TABLE) return null;

  const sharingRes = await dynamo.send(
    new QueryCommand({
      TableName: SHARING_TABLE,
      KeyConditionExpression: 'agent_id = :aid',
      ExpressionAttributeValues: { ':aid': agentId },
    })
  );
  const shares = (sharingRes.Items || []) as SharingItem[];
  if (shares.length === 0) return null;

  let best: ShareRole | null = null;

  // Direct user shares
  for (const share of shares) {
    if (share.principal_type === 'user' && share.principal_id === auth.sub) {
      best = higherRole(best, share.role);
    }
  }

  // Team shares — require a membership lookup each
  if (TEAM_MEMBERS_TABLE) {
    const teamShares = shares.filter((s) => s.principal_type === 'team');
    if (teamShares.length > 0) {
      const memberships = await Promise.all(
        teamShares.map(async (share) => {
          const teamId = share.principal_id.replace(/^team:/, '');
          const res = await dynamo.send(
            new GetCommand({
              TableName: TEAM_MEMBERS_TABLE,
              Key: { team_id: teamId, user_id: auth.sub },
            })
          );
          return res.Item ? share.role : null;
        })
      );
      for (const role of memberships) {
        if (role) best = higherRole(best, role);
      }
    }
  }

  return best;
};

const canEditViaShare = (role: ShareRole | null): boolean => role === 'co-owner' || role === 'editor';

const handleGetSharing = async (agentId: string): Promise<ReturnType<typeof jsonResponse>> => {
  if (!SHARING_TABLE) return jsonResponse(200, { shares: [] });

  const res = await dynamo.send(
    new QueryCommand({
      TableName: SHARING_TABLE,
      KeyConditionExpression: 'agent_id = :aid',
      ExpressionAttributeValues: { ':aid': agentId },
    })
  );
  const shares = (res.Items || []).map((item) => {
    const s = item as SharingItem;
    return {
      principalId: s.principal_id,
      principalType: s.principal_type,
      role: s.role,
      sharedBy: s.shared_by,
      sharedAt: s.shared_at,
    };
  });
  return jsonResponse(200, { shares });
};

const handleShareAgent = async (
  agentId: string,
  body: { principalId?: string; principalType?: string; role?: string } | null,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (!SHARING_TABLE) return errorResponse(500, 'Sharing not configured');
  if (!body?.principalId || !body?.principalType || !body?.role) {
    return errorResponse(400, 'principalId, principalType, and role are required');
  }
  if (!['user', 'team'].includes(body.principalType)) return errorResponse(400, 'Invalid principalType');
  if (!['co-owner', 'editor', 'viewer'].includes(body.role)) return errorResponse(400, 'Invalid role');

  await dynamo.send(
    new PutCommand({
      TableName: SHARING_TABLE,
      Item: {
        agent_id: agentId,
        principal_id: body.principalId,
        principal_type: body.principalType,
        role: body.role,
        shared_by: auth.sub,
        shared_at: Date.now(),
      },
    })
  );
  // BUG-172: structured audit log for agent share grants
  console.log(
    JSON.stringify({
      _name: 'AGENT_SHARE_GRANTED',
      agentId,
      principalId: body.principalId,
      role: body.role,
      sharedBy: auth.sub,
      clientName: CLIENT_NAME,
    })
  );
  return jsonResponse(201, { ok: true });
};

const handleUpdateSharing = async (
  agentId: string,
  principalId: string,
  body: { role?: string } | null,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (!SHARING_TABLE) return errorResponse(500, 'Sharing not configured');
  if (!body?.role || !['co-owner', 'editor', 'viewer'].includes(body.role)) {
    return errorResponse(400, 'Valid role is required');
  }

  const res = await dynamo.send(
    new GetCommand({ TableName: SHARING_TABLE, Key: { agent_id: agentId, principal_id: principalId } })
  );
  const existing = res.Item as SharingItem | undefined;
  if (!existing) return errorResponse(404, 'Share not found');

  await dynamo.send(
    new PutCommand({
      TableName: SHARING_TABLE,
      Item: { ...existing, role: body.role as SharingItem['role'] },
    })
  );
  // BUG-172: structured audit log for agent share role changes
  console.log(
    JSON.stringify({
      _name: 'AGENT_SHARE_UPDATED',
      agentId,
      principalId,
      role: body.role,
      sharedBy: auth.sub,
      clientName: CLIENT_NAME,
    })
  );
  return jsonResponse(200, { ok: true });
};

const handleRevokeSharing = async (
  agentId: string,
  principalId: string,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (!SHARING_TABLE) return errorResponse(500, 'Sharing not configured');

  await dynamo.send(
    new DeleteCommand({ TableName: SHARING_TABLE, Key: { agent_id: agentId, principal_id: principalId } })
  );
  // BUG-172: structured audit log for agent share revocations.
  // role omitted: the share row is gone; principalId + agentId identify the grant.
  console.log(
    JSON.stringify({
      _name: 'AGENT_SHARE_REVOKED',
      agentId,
      principalId,
      role: null,
      sharedBy: auth.sub,
      clientName: CLIENT_NAME,
    })
  );
  return jsonResponse(200, { ok: true });
};

// ─── Admin ───────────────────────────────────────────────────────────────────

const handleAdminListAgents = async (auth: AuthContext): Promise<ReturnType<typeof jsonResponse>> => {
  if (!isAdmin(auth)) return errorResponse(403, 'Admin access required');

  // Scan both tables for all agents
  const [workspaceRes, userScanRes] = await Promise.all([
    dynamo.send(
      new QueryCommand({
        TableName: WORKSPACE_TABLE!,
        KeyConditionExpression: 'tenant_id = :tid',
        ExpressionAttributeValues: { ':tid': CLIENT_NAME },
      })
    ),
    dynamo.send(new ScanCommand({ TableName: USER_TABLE! })),
  ]);

  const agents: Array<Record<string, unknown>> = [];

  for (const item of (workspaceRes.Items || []) as WorkspaceAgentItem[]) {
    agents.push({
      agentId: item.agent_id,
      title: item.title,
      scope: 'workspace',
      visibility: item.visibility,
      owner: { userId: item.created_by_user_id, name: item.created_by_name },
      updatedAt: item.updated_at,
      tags: item.tags || [],
      personas: item.personas || [],
      industries: item.industries || [],
      modelId: item.model_id,
    });
  }

  for (const item of (userScanRes.Items || []) as UserAgentItem[]) {
    agents.push({
      agentId: item.agent_id,
      title: item.title,
      scope: 'user',
      visibility: item.visibility,
      owner: { userId: item.created_by_user_id || item.user_id, name: item.created_by_name },
      updatedAt: item.updated_at,
      tags: item.tags || [],
      personas: item.personas || [],
      industries: item.industries || [],
      modelId: item.model_id,
    });
  }

  agents.sort((a, b) => ((b.updatedAt as number) || 0) - ((a.updatedAt as number) || 0));

  return jsonResponse(200, { agents, total: agents.length });
};

export const __testExports = {
  normaliseDuplicateBaseTitle,
  buildPersonalDuplicatePayload,
  buildUserItem,
  resolveSourceAgentId,
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  // FEAT-206 — capability probe via direct Lambda Invoke (the arcanum-agent-deployer
  // calls this before pushing managed agents, to confirm THIS client actually
  // enforces the managed-lock). API Gateway v2 events never carry a top-level
  // `action`, so there's no collision with the normal request path. Returns a
  // plain object (not an HTTP response) since it's a direct invoke. Older agents
  // Lambdas (pre-FEAT-206) lack this branch, so the probe fails → deployer treats
  // the client as not-yet-enforcing.
  if ((event as unknown as { action?: string })?.action === 'capabilities') {
    return { capabilities: { managedAgents: true } } as unknown as APIGatewayProxyResultV2;
  }
  try {
    ensureEnv();

    if (event.requestContext.http?.method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: HEADERS,
        body: '',
      };
    }

    const auth = resolveAuthContext(event);
    if (!auth) {
      return errorResponse(401, 'Unauthorized');
    }

    const segments = buildPathSegments(event);
    if (segments[0] !== 'agents') {
      return errorResponse(404, 'Not Found');
    }

    const method = event.requestContext.http?.method ?? 'GET';
    // Read agents mode
    type AgentsMode = 'off' | 'personal_only' | 'full';
    let agentsMode: AgentsMode = 'full';
    if (AGENTS_SETTINGS_TABLE_NAME) {
      try {
        const res = await dynamo.send(
          new DdbGetCommand({ TableName: AGENTS_SETTINGS_TABLE_NAME, Key: { setting: 'policy' } })
        );
        const item = res.Item as { mode?: AgentsMode } | undefined;
        if (item && (item.mode === 'off' || item.mode === 'personal_only' || item.mode === 'full')) {
          agentsMode = item.mode;
        }
      } catch (e) {
        console.warn('Agents settings read failed:', (e as Error)?.message);
      }
    }
    const actionSegments = segments.slice(1);

    // ── Sub-resource routing (prefs, teams, sharing, admin) ──
    // These routes are checked before the main CRUD switch so they don't
    // collide with the :agentId wildcard patterns.

    // GET /agents/prefs -- all prefs for current user
    if (method === 'GET' && actionSegments.length === 1 && actionSegments[0] === 'prefs') {
      return await handleGetPrefs(auth);
    }
    // PUT /agents/:id/prefs -- set pref for one agent
    if (method === 'PUT' && actionSegments.length === 2 && actionSegments[1] === 'prefs') {
      return await handleSetPref(decodeURIComponent(actionSegments[0]), parseJsonBody(event.body), auth);
    }

    // Teams: /agents/teams, /agents/teams/:id, /agents/teams/:id/members[/:userId]
    if (actionSegments[0] === 'teams') {
      const teamSegs = actionSegments.slice(1);
      if (method === 'GET' && teamSegs.length === 0) return await handleListTeams(auth);
      if (method === 'POST' && teamSegs.length === 0) {
        return await handleCreateTeam(parseJsonBody(event.body), auth);
      }
      if (teamSegs.length >= 1) {
        const teamId = decodeURIComponent(teamSegs[0]);
        if (method === 'GET' && teamSegs.length === 1) return await handleGetTeam(teamId, auth);
        if (method === 'PUT' && teamSegs.length === 1) {
          return await handleUpdateTeam(teamId, parseJsonBody(event.body), auth);
        }
        if (method === 'DELETE' && teamSegs.length === 1) return await handleDeleteTeam(teamId, auth);
        // Agents sub-resource: GET /agents/teams/:id/agents
        if (teamSegs[1] === 'agents' && method === 'GET' && teamSegs.length === 2) {
          return await handleListTeamAgents(teamId, auth);
        }
        // Members sub-resource
        if (teamSegs[1] === 'members') {
          if (method === 'POST' && teamSegs.length === 2) {
            return await handleAddTeamMember(teamId, parseJsonBody(event.body), auth);
          }
          if (teamSegs.length === 3) {
            const userId = decodeURIComponent(teamSegs[2]);
            if (method === 'PUT') {
              return await handleUpdateTeamMember(teamId, userId, parseJsonBody(event.body), auth);
            }
            if (method === 'DELETE') return await handleRemoveTeamMember(teamId, userId, auth);
          }
        }
      }
      return errorResponse(404, 'Team route not found');
    }

    // Sharing: /agents/:id/sharing[/:principalId]
    if (actionSegments.length >= 2 && actionSegments[1] === 'sharing') {
      const agentId = decodeURIComponent(actionSegments[0]);
      if (method === 'GET' && actionSegments.length === 2) {
        return await handleGetSharing(agentId);
      }
      if (method === 'POST' && actionSegments.length === 2) {
        return await handleShareAgent(agentId, parseJsonBody(event.body), auth);
      }
      if (actionSegments.length === 3) {
        const principalId = decodeURIComponent(actionSegments[2]);
        if (method === 'PUT') {
          return await handleUpdateSharing(agentId, principalId, parseJsonBody(event.body), auth);
        }
        if (method === 'DELETE') return await handleRevokeSharing(agentId, principalId, auth);
      }
      return errorResponse(404, 'Sharing route not found');
    }

    // Admin: GET /agents/admin
    if (method === 'GET' && actionSegments.length === 1 && actionSegments[0] === 'admin') {
      return await handleAdminListAgents(auth);
    }

    // ── Main agent CRUD ──
    switch (method.toUpperCase()) {
      case 'GET': {
        if (actionSegments.length === 0) {
          if (agentsMode === 'off') {
            return jsonResponse(200, { agents: [] });
          }
          // Use existing list then filter if needed
          const raw = await handleListAgents(event, auth);
          try {
            const body = JSON.parse(String(raw.body || '{}')) as { agents?: Array<Record<string, unknown>> };
            let agents = Array.isArray(body.agents) ? (body.agents as Array<Record<string, unknown>>) : [];
            if (agentsMode === 'personal_only') {
              agents = agents.filter((a) => (a?.scope as unknown) === 'user');
            }
            return jsonResponse(200, { agents });
          } catch {
            return raw;
          }
        }
        if (actionSegments.length === 1) {
          return await handleGetAgent(decodeURIComponent(actionSegments[0]), auth);
        }
        break;
      }
      case 'POST': {
        if (actionSegments.length === 0) {
          if (agentsMode === 'off') return errorResponse(403, 'Agents are disabled');
          const payload = parseJsonBody<CreateAgentPayload>(event.body);
          if (agentsMode === 'personal_only' && payload?.visibility === 'public') {
            return errorResponse(403, 'Company sharing is disabled');
          }
          return await handleCreateAgent(payload, auth);
        }
        if (actionSegments.length === 2 && actionSegments[1] === 'duplicate') {
          if (agentsMode === 'off') return errorResponse(403, 'Agents are disabled');
          const dupOpts = parseJsonBody<DuplicateOptions>(event.body);
          return await handleDuplicateAgent(decodeURIComponent(actionSegments[0]), auth, dupOpts ?? undefined);
        }
        break;
      }
      case 'PUT': {
        if (actionSegments.length === 1) {
          if (agentsMode === 'off') return errorResponse(403, 'Agents are disabled');
          const payload = parseJsonBody<UpdateAgentPayload>(event.body);
          if (agentsMode === 'personal_only' && payload?.visibility === 'public') {
            return errorResponse(403, 'Company sharing is disabled');
          }
          return await handleUpdateAgent(decodeURIComponent(actionSegments[0]), payload, auth);
        }
        break;
      }
      case 'DELETE': {
        if (actionSegments.length === 1) {
          return await handleDeleteAgent(decodeURIComponent(actionSegments[0]), auth);
        }
        break;
      }
      default:
        break;
    }

    return errorResponse(404, 'Route not found');
  } catch (error) {
    console.error('Agents API error', error);
    return errorResponse(500, 'Internal Server Error');
  }
};
