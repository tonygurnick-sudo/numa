import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { S3Client, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand as DdbGetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
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

type AgentVisibility = 'personal' | 'public';
type AgentScope = 'workspace' | 'user';

type AgentToolsConfig = {
  autoToolsEnabled?: boolean;
  queryDataSources?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
  enabledConnections?: string[];
  // Multi-KB support: which knowledge bases the agent can access
  // null/undefined = all KBs (backwards compat with queryDataSources: true)
  // [] = no KB access
  // ['company', 'kb-123'] = specific KBs only
  allowedKnowledgeBases?: string[] | null;
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
  created_by_user_id: string;
  created_by_name?: string;
  created_at: number;
  updated_at: number;
  version: number;
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
  created_by_user_id: string;
  created_by_name?: string;
  created_at: number;
  updated_at: number;
  version: number;
  source_agent_id?: string;
  is_favorite?: boolean;
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
  referenceFiles?: ReferenceFile[];
  createdByName?: string;
  sourceAgentId?: string;
};

type UpdateAgentPayload = CreateAgentPayload & {
  isFavorite?: boolean;
  sourceAgentId?: string;
};

const jsonResponse = (
  statusCode: number,
  payload: unknown,
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

const normaliseToolsConfig = (config?: AgentToolsConfig | null): AgentToolsConfig => {
  if (!config) return {};
  return {
    autoToolsEnabled: config.autoToolsEnabled ?? true,
    queryDataSources: config.queryDataSources ?? false,
    webSearchEnabled: config.webSearchEnabled ?? false,
    createAgentEnabled: config.createAgentEnabled ?? false,
    enabledConnections: Array.isArray(config.enabledConnections) ? config.enabledConnections : [],
    // Preserve allowedKnowledgeBases: null means all KBs, [] means none, array means specific
    allowedKnowledgeBases:
      config.allowedKnowledgeBases === null
        ? null
        : Array.isArray(config.allowedKnowledgeBases)
          ? config.allowedKnowledgeBases
          : undefined,
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

const resolveSourceAgentId = (agent: WorkspaceAgentItem | UserAgentItem): string => {
  if ('source_agent_id' in agent && agent.source_agent_id) {
    return agent.source_agent_id;
  }
  return agent.agent_id;
};

const buildPersonalDuplicatePayload = (
  agent: WorkspaceAgentItem | UserAgentItem,
  duplicateTitle: string,
  referenceFileFallbackSource?: string,
): CreateAgentPayload => {
  const referenceFiles = normaliseReferenceFiles(agent.reference_files);
  const processedReferenceFiles = referenceFiles.length
    ? referenceFiles.map((file) =>
        referenceFileFallbackSource && !file.source ? { ...file, source: referenceFileFallbackSource } : file,
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
    referenceFiles: processedReferenceFiles,
    sourceAgentId: resolveSourceAgentId(agent),
  };
};

const normaliseWelcomeMessage = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const resolveWelcomeMessageFromPayload = (
  payload: CreateAgentPayload | UpdateAgentPayload,
  existing?: { user_instructions?: string },
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
    referenceFiles: normaliseReferenceFiles(item.reference_files),
    createdBy: {
      userId: item.created_by_user_id,
      name: item.created_by_name,
    },
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    version: item.version,
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
  };
};

const buildWorkspaceItem = (
  payload: CreateAgentPayload,
  auth: AuthContext,
  timestamp: number,
  agentId: string,
): WorkspaceAgentItem => {
  const userWelcomeMessage = normaliseWelcomeMessage(payload.userWelcomeMessage);
  return {
    tenant_id: CLIENT_NAME!,
    agent_id: agentId,
    visibility: payload.visibility === 'public' ? 'public' : 'public',
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
    reference_files: normaliseReferenceFiles(payload.referenceFiles),
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
  existing?: UserAgentItem,
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
    reference_files: normaliseReferenceFiles(payload.referenceFiles ?? existing?.reference_files),
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
    }),
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
    }),
  );
  return result.Item as UserAgentItem | undefined;
};

const listUserAgents = async (userId: string): Promise<UserAgentItem[]> => {
  const response = await dynamo.send(
    new QueryCommand({
      TableName: USER_TABLE,
      KeyConditionExpression: 'user_id = :uid',
      ExpressionAttributeValues: {
        ':uid': userId,
      },
    }),
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
    }),
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
    }),
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
  auth: AuthContext,
): Promise<ReturnType<typeof jsonResponse>> => {
  const scope = (event.queryStringParameters?.scope || 'owned').toLowerCase();
  const includeOwned = scope === 'owned' || scope === 'all' || scope === '';
  const includePublic = scope === 'public' || scope === 'all';
  const agentTypeFilter = event.queryStringParameters?.agentType?.toLowerCase();

  const results = new Map<string, AgentResponse>();

  if (includeOwned) {
    const [userAgents, ownedWorkspaceAgents] = await Promise.all([
      listUserAgents(auth.sub),
      listWorkspaceAgentsByCreator(auth.sub),
    ]);

    userAgents.forEach((item) => {
      const mapped = mapUserAgent(item);
      if (!agentTypeFilter || mapped.agentType.toLowerCase() === agentTypeFilter) {
        results.set(`user:${mapped.agentId}`, mapped);
      }
    });

    ownedWorkspaceAgents.forEach((item) => {
      const mapped = mapWorkspaceAgent(item);
      if (!agentTypeFilter || mapped.agentType.toLowerCase() === agentTypeFilter) {
        results.set(`workspace:${mapped.agentId}`, mapped);
      }
    });
  }

  if (includePublic) {
    const workspaceAgents = await listWorkspaceAgentsForTenant();
    workspaceAgents.forEach((item) => {
      const mapped = mapWorkspaceAgent(item);
      if (!agentTypeFilter || mapped.agentType.toLowerCase() === agentTypeFilter) {
        results.set(`workspace:${mapped.agentId}`, mapped);
      }
    });
  }

  const agents = Array.from(results.values()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return jsonResponse(200, { agents });
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

  return errorResponse(404, 'Agent not found');
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
  return null;
};

const handleCreateAgent = async (
  payload: CreateAgentPayload | null,
  auth: AuthContext,
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
          const s3 = new S3Client({});
          const extMatch = img.s3Key.match(/\.([a-zA-Z0-9]+)$/);
          const ext = (extMatch?.[1] || 'png').toLowerCase();
          const destKey = `numa-chat/agent-icons/public/${agentId}.${ext}`;
          await s3.send(
            new CopyObjectCommand({
              Bucket: OUTPUTS_BUCKET_NAME,
              Key: destKey,
              CopySource: `${img.s3Bucket}/${encodeURIComponent(img.s3Key)}`,
              MetadataDirective: 'COPY',
            }),
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
      }),
    );
    return jsonResponse(201, { agent: mapWorkspaceAgent(workspaceItem) });
  }

  const userItem = buildUserItem(payload ?? {}, auth, now, agentId);
  await dynamo.send(
    new PutCommand({
      TableName: USER_TABLE,
      Item: userItem,
    }),
  );
  return jsonResponse(201, { agent: mapUserAgent(userItem) });
};

const handleUpdateAgent = async (
  agentId: string,
  payload: UpdateAgentPayload | null,
  auth: AuthContext,
): Promise<ReturnType<typeof jsonResponse>> => {
  if (!payload) {
    return errorResponse(400, 'Invalid JSON body');
  }
  if (payload.referenceFiles && payload.referenceFiles.length > 5) {
    return errorResponse(400, 'A maximum of 5 reference files is supported');
  }

  const [userAgent, workspaceAgent] = await Promise.all([
    getUserAgentById(agentId, auth.sub),
    getWorkspaceAgentById(agentId),
  ]);

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
      }),
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
            const s3 = new S3Client({});
            const extMatch = img.s3Key.match(/\.([a-zA-Z0-9]+)$/);
            const ext = (extMatch?.[1] || 'png').toLowerCase();
            const destKey = `numa-chat/agent-icons/public/${publicAgentId}.${ext}`;
            await s3.send(
              new CopyObjectCommand({
                Bucket: OUTPUTS_BUCKET_NAME,
                Key: destKey,
                CopySource: `${img.s3Bucket}/${encodeURIComponent(img.s3Key)}`,
                MetadataDirective: 'COPY',
              }),
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
        }),
      );
    } else if (workspaceAgent && workspaceAgent.created_by_user_id === auth.sub) {
      await dynamo.send(
        new DeleteCommand({
          TableName: WORKSPACE_TABLE,
          Key: {
            tenant_id: CLIENT_NAME!,
            agent_id: agentId,
          },
        }),
      );
    }

    return jsonResponse(200, { agent: mapUserAgent(merged) });
  }

  if (workspaceAgent) {
    if (workspaceAgent.created_by_user_id !== auth.sub && !isAdmin(auth)) {
      return errorResponse(403, 'You do not have permission to update this agent');
    }
    const userWelcomeMessage = resolveWelcomeMessageFromPayload(payload, workspaceAgent);
    const merged: WorkspaceAgentItem = {
      ...workspaceAgent,
      visibility: payload.visibility === 'public' ? 'public' : workspaceAgent.visibility,
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
      reference_files: normaliseReferenceFiles(payload.referenceFiles ?? workspaceAgent.reference_files),
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
          const s3 = new S3Client({});
          const extMatch = img.s3Key.match(/\.([a-zA-Z0-9]+)$/);
          const ext = (extMatch?.[1] || 'png').toLowerCase();
          const destKey = `numa-chat/agent-icons/public/${workspaceAgent.agent_id}.${ext}`;
          await s3.send(
            new CopyObjectCommand({
              Bucket: OUTPUTS_BUCKET_NAME,
              Key: destKey,
              CopySource: `${img.s3Bucket}/${encodeURIComponent(img.s3Key)}`,
              MetadataDirective: 'COPY',
            }),
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
      }),
    );
    return jsonResponse(200, { agent: mapWorkspaceAgent(merged) });
  }

  return errorResponse(404, 'Agent not found');
};

const handleDeleteAgent = async (agentId: string, auth: AuthContext): Promise<ReturnType<typeof jsonResponse>> => {
  const [userAgent, workspaceAgent] = await Promise.all([
    getUserAgentById(agentId, auth.sub),
    getWorkspaceAgentById(agentId),
  ]);

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
        const s3 = new S3Client({});
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
      }),
    );
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
        const s3 = new S3Client({});
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
      }),
    );
    return jsonResponse(200, { ok: true });
  }

  return errorResponse(404, 'Agent not found');
};

const duplicateWorkspaceAgent = async (
  agentId: string,
  workspaceAgent: WorkspaceAgentItem,
  auth: AuthContext,
): Promise<ReturnType<typeof jsonResponse>> => {
  const existingAgents = await listUserAgents(auth.sub);
  const duplicateTitle = generateDuplicateTitle(workspaceAgent.title, existingAgents);
  const duplicatePayload = buildPersonalDuplicatePayload(workspaceAgent, duplicateTitle, 'workspace');

  const now = Date.now();
  const newId = generateAgentId();

  if (workspaceAgent.icon_image?.s3Bucket && workspaceAgent.icon_image?.s3Key && OUTPUTS_BUCKET_NAME) {
    try {
      const s3 = new S3Client({});
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
        }),
      );
      duplicatePayload.iconImage = { s3Bucket: OUTPUTS_BUCKET_NAME, s3Key: destKey };
      delete duplicatePayload.icon;
    } catch (e) {
      console.warn('DuplicateAgent: failed to copy icon image', { agentId, error: (e as Error)?.message });
    }
  }

  const userItem = buildUserItem(duplicatePayload, auth, now, newId);

  await dynamo.send(
    new PutCommand({
      TableName: USER_TABLE,
      Item: userItem,
      ConditionExpression: 'attribute_not_exists(agent_id) AND attribute_not_exists(user_id)',
    }),
  );

  return jsonResponse(201, { agent: mapUserAgent(userItem) });
};

const duplicatePersonalAgent = async (
  agent: UserAgentItem,
  auth: AuthContext,
): Promise<ReturnType<typeof jsonResponse>> => {
  if (agent.user_id !== auth.sub) {
    return errorResponse(403, 'You do not have permission to duplicate this agent');
  }

  const existingAgents = await listUserAgents(auth.sub);
  const duplicateTitle = generateDuplicateTitle(agent.title, existingAgents);
  const duplicatePayload = buildPersonalDuplicatePayload(agent, duplicateTitle);

  const now = Date.now();
  const newId = generateAgentId();
  const userItem = buildUserItem(duplicatePayload, auth, now, newId);

  await dynamo.send(
    new PutCommand({
      TableName: USER_TABLE,
      Item: userItem,
      ConditionExpression: 'attribute_not_exists(agent_id) AND attribute_not_exists(user_id)',
    }),
  );

  return jsonResponse(201, { agent: mapUserAgent(userItem) });
};

const handleDuplicateAgent = async (agentId: string, auth: AuthContext): Promise<ReturnType<typeof jsonResponse>> => {
  const personalAgent = await getUserAgentById(agentId, auth.sub);
  if (personalAgent) {
    return duplicatePersonalAgent(personalAgent, auth);
  }

  const workspaceAgent = await getWorkspaceAgentById(agentId);
  if (!workspaceAgent) {
    return errorResponse(404, 'Agent not found');
  }

  return duplicateWorkspaceAgent(agentId, workspaceAgent, auth);
};

export const __testExports = {
  normaliseDuplicateBaseTitle,
  buildPersonalDuplicatePayload,
  buildUserItem,
  resolveSourceAgentId,
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
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
          new DdbGetCommand({ TableName: AGENTS_SETTINGS_TABLE_NAME, Key: { setting: 'policy' } }),
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
          return await handleDuplicateAgent(decodeURIComponent(actionSegments[0]), auth);
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
