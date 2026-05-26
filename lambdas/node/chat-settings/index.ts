import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.CHAT_SETTINGS_TABLE_NAME as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;

const ddb = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}));

// Type definitions for chat settings
export type ApprovalMode = 'always' | 'non_destructive' | 'never';

export type NumaToolApprovalMode = {
  agents: ApprovalMode;
  memories: ApprovalMode;
  knowledgeBases: ApprovalMode;
  ops: ApprovalMode;
};

const DEFAULT_NUMA_TOOL_APPROVAL_MODE: NumaToolApprovalMode = {
  agents: 'never',
  memories: 'never',
  knowledgeBases: 'never',
  ops: 'never',
};

export type ChatScrollMode = 'auto' | 'manual';

const VALID_SCROLL_MODES: ChatScrollMode[] = ['auto', 'manual'];

export type ChatSettings = {
  defaultKBIds: string[];
  autoToolsEnabled: boolean;
  webSearchEnabled: boolean;
  createAgentEnabled: boolean;
  memoriesEnabled: boolean;
  dataAnalysisEnabled: boolean;
  defaultConnectionIds: string[];
  /** Default per-chat-enable list for NATIVE connectors. Mirrors
   *  defaultConnectionIds for Pipedream. Empty = "none enabled by default". */
  defaultNativeConnectorIds: string[];
  language: string | null;
  approvalMode: ApprovalMode;
  numaToolApprovalMode: NumaToolApprovalMode;
  emailSignatureEnabled: boolean;
  emailSignatureText: string;
  chatScrollMode: ChatScrollMode;
  chatSuggestionsEnabled: boolean;
};

export type UserChatSettings = ChatSettings & {
  userDefaultsEnabled: boolean;
};

export type GlobalChatSettings = ChatSettings & {
  allowUserDefaults: boolean;
  allowedPythonLibraries: { name: string; version: string }[];
};

type ChatSettingsUpdate = {
  [K in keyof ChatSettings]?: ChatSettings[K] | null;
};

type UserChatSettingsUpdate = ChatSettingsUpdate & {
  userDefaultsEnabled?: boolean | null;
};

// Memory type — individual memory item scoped to general, integration, or agent
export type Memory = {
  id: string;
  content: string;
  scope: string; // "general" | "integration:{slug}" | "agent:{agentId}"
  createdAt: string;
  source: 'user' | 'ai';
};

// User profile type — structured "memory" sent to the AI
export type UserProfile = {
  // About You
  name: string;
  jobTitle: string;
  jobDescription: string;
  linkedInUrl: string;
  goalsAndObjectives: string;
  otherInformation: string;
  profileImage: { s3Bucket: string; s3Key: string } | null;
  // Custom Instructions
  customInstructions: string;
  // Memories
  memories: Memory[];
  // Toggle
  useProfile: boolean;
};

const DEFAULT_USER_PROFILE: UserProfile = {
  name: '',
  jobTitle: '',
  jobDescription: '',
  linkedInUrl: '',
  goalsAndObjectives: '',
  otherInformation: '',
  profileImage: null,
  customInstructions: '',
  memories: [],
  useProfile: true,
};

const MAX_NAME = 100;
const MAX_TITLE = 100;
const MAX_URL = 200;
const MAX_LONG_FIELD = 500;
const MAX_CUSTOM_INSTRUCTIONS = 1500;
const MAX_MEMORY_CONTENT = 300;
const MAX_MEMORIES = 50;
const VALID_SCOPE_PATTERN = /^(general|integration:.+|agent:.+)$/;

function validateNumaToolApprovalMode(data: unknown): NumaToolApprovalMode {
  if (typeof data !== 'object' || data === null) return { ...DEFAULT_NUMA_TOOL_APPROVAL_MODE };
  const obj = data as Record<string, unknown>;
  const v = (val: unknown): ApprovalMode =>
    typeof val === 'string' && VALID_APPROVAL_MODES.includes(val as ApprovalMode) ? (val as ApprovalMode) : 'never';
  return { agents: v(obj.agents), memories: v(obj.memories), knowledgeBases: v(obj.knowledgeBases), ops: v(obj.ops) };
}

// Merge a (possibly partial) incoming NumaToolApprovalMode into the current stored value.
// Only keys with a valid ApprovalMode override; unknown/invalid keys fall back to current.
function mergeNumaToolApprovalMode(incoming: unknown, current: NumaToolApprovalMode): NumaToolApprovalMode {
  if (!incoming || typeof incoming !== 'object') return current;
  const src = incoming as Record<string, unknown>;
  const keys: (keyof NumaToolApprovalMode)[] = ['agents', 'memories', 'knowledgeBases', 'ops'];
  const out: NumaToolApprovalMode = { ...current };
  for (const k of keys) {
    const v = src[k];
    if (typeof v === 'string' && VALID_APPROVAL_MODES.includes(v as ApprovalMode)) {
      out[k] = v as ApprovalMode;
    }
  }
  return out;
}

function truncate(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLen);
}

function validateMemory(raw: unknown): Memory | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id.slice(0, 100) : '';
  const content = truncate(obj.content, MAX_MEMORY_CONTENT);
  const scope = typeof obj.scope === 'string' ? obj.scope.slice(0, 200) : '';
  const createdAt = typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString();
  const source = obj.source === 'ai' ? 'ai' : 'user';
  if (!id || !content || !VALID_SCOPE_PATTERN.test(scope)) return null;
  return { id, content, scope, createdAt, source } as Memory;
}

function validateUserProfile(raw: unknown): UserProfile {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_USER_PROFILE };
  const obj = raw as Record<string, unknown>;

  let profileImage: { s3Bucket: string; s3Key: string } | null = null;
  if (obj.profileImage && typeof obj.profileImage === 'object' && !Array.isArray(obj.profileImage)) {
    const img = obj.profileImage as Record<string, unknown>;
    if (typeof img.s3Bucket === 'string' && typeof img.s3Key === 'string') {
      profileImage = { s3Bucket: img.s3Bucket, s3Key: img.s3Key };
    }
  }

  const customInstructions = truncate(obj.customInstructions, MAX_CUSTOM_INSTRUCTIONS);
  const linkedInUrl = truncate(obj.linkedInUrl, MAX_URL);
  const goalsAndObjectives = truncate(obj.goalsAndObjectives, MAX_LONG_FIELD);
  const otherInformation = truncate(obj.otherInformation, MAX_LONG_FIELD);

  const memories: Memory[] = Array.isArray(obj.memories)
    ? obj.memories
        .map((m: unknown) => validateMemory(m))
        .filter((m): m is Memory => m !== null)
        .slice(0, MAX_MEMORIES)
    : [];

  return {
    name: truncate(obj.name, MAX_NAME),
    jobTitle: truncate(obj.jobTitle, MAX_TITLE),
    jobDescription: truncate(obj.jobDescription, MAX_LONG_FIELD),
    linkedInUrl,
    goalsAndObjectives,
    otherInformation,
    profileImage,
    customInstructions,
    memories,
    useProfile: typeof obj.useProfile === 'boolean' ? obj.useProfile : DEFAULT_USER_PROFILE.useProfile,
  };
}

// Default settings for new users
const VALID_APPROVAL_MODES: ApprovalMode[] = ['always', 'non_destructive', 'never'];

// Sentinel for the user's Personal folder in defaultKBIds. The actual KB id
// is the user's Cognito sub, which isn't known until apply time — the chat
// runtime + frontend both expand this token. Admins never see Personal as a
// toggle (it's user-only), so company-level defaultKBIds never carry it; we
// inject it for users on the company-defaults fallback so Personal is on by
// default everywhere it should be.
const MY_FILES_SENTINEL = '__my_files__';

const DEFAULT_SETTINGS: ChatSettings = {
  defaultKBIds: ['company', 'numa-support', MY_FILES_SENTINEL],
  autoToolsEnabled: true,
  webSearchEnabled: true,
  createAgentEnabled: false,
  memoriesEnabled: true,
  dataAnalysisEnabled: true,
  defaultConnectionIds: [],
  defaultNativeConnectorIds: [],
  language: 'browser',
  approvalMode: 'non_destructive',
  numaToolApprovalMode: { ...DEFAULT_NUMA_TOOL_APPROVAL_MODE },
  emailSignatureEnabled: true,
  emailSignatureText: 'Sent by my AI assistant, Numa (https://www.arcanum.ai)',
  chatScrollMode: 'auto',
  chatSuggestionsEnabled: true,
};

const DEFAULT_GLOBAL_CHAT_SETTINGS: GlobalChatSettings = {
  ...DEFAULT_SETTINGS,
  allowUserDefaults: false,
  allowedPythonLibraries: [],
};

const GLOBAL_SETTINGS_KEY = '__global__';
const COMPANY_KB_ID = 'company';
const NUMA_SUPPORT_KB_ID = 'numa-support';
const SHAREPOINT_KB_ID = 'sharepoint';
// `sharepoint` is only meaningful for workspaces with provisionQResources=true,
// but the chat-settings Lambda has no per-workspace flag visibility — we
// include it in the system whitelist so it can be persisted. The backend KB
// router enforces availability (returns an error if Q isn't configured) and
// the frontend hides the tickbox when PROVISION_Q_RESOURCES is off.
const SYSTEM_KB_IDS = new Set([COMPANY_KB_ID, NUMA_SUPPORT_KB_ID, SHAREPOINT_KB_ID]);

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

type JwtClaims = { sub?: string; email?: string; [key: string]: unknown };

function parseJwt(token: string): JwtClaims {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as JwtClaims;
  } catch {
    return {};
  }
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
}

function getClaims(event: { headers?: Record<string, string | undefined> }): JwtClaims | null {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return null;
  const token = String(auth).replace(/^Bearer\s+/i, '');
  return parseJwt(token);
}

function isAdmin(claims: JwtClaims | null): boolean {
  if (!claims) return false;
  const groups = claims['cognito:groups'];
  if (Array.isArray(groups)) {
    return groups.includes('admin');
  }
  if (typeof groups === 'string') {
    return groups
      .split(',')
      .map((g) => g.trim())
      .includes('admin');
  }
  return false;
}

async function loadGlobalSettings(): Promise<GlobalChatSettings> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { user_id: GLOBAL_SETTINGS_KEY },
      ConsistentRead: true,
    })
  );

  const item = res.Item as Partial<GlobalChatSettings> | undefined;
  if (!item) {
    // If company defaults haven't been configured yet, default to disallowing user overrides
    return {
      defaultKBIds: DEFAULT_SETTINGS.defaultKBIds,
      autoToolsEnabled: DEFAULT_SETTINGS.autoToolsEnabled,
      webSearchEnabled: DEFAULT_SETTINGS.webSearchEnabled,
      createAgentEnabled: DEFAULT_SETTINGS.createAgentEnabled,
      memoriesEnabled: DEFAULT_SETTINGS.memoriesEnabled,
      dataAnalysisEnabled: DEFAULT_SETTINGS.dataAnalysisEnabled,
      defaultConnectionIds: DEFAULT_SETTINGS.defaultConnectionIds,
      defaultNativeConnectorIds: DEFAULT_SETTINGS.defaultNativeConnectorIds,
      language: DEFAULT_SETTINGS.language,
      approvalMode: DEFAULT_SETTINGS.approvalMode,
      numaToolApprovalMode: DEFAULT_SETTINGS.numaToolApprovalMode,
      emailSignatureEnabled: DEFAULT_SETTINGS.emailSignatureEnabled,
      emailSignatureText: DEFAULT_SETTINGS.emailSignatureText,
      chatScrollMode: DEFAULT_SETTINGS.chatScrollMode,
      chatSuggestionsEnabled: DEFAULT_SETTINGS.chatSuggestionsEnabled,
      allowUserDefaults: false,
      allowedPythonLibraries: [],
    };
  }

  const defaultKBIds = Array.isArray(item?.defaultKBIds)
    ? item!.defaultKBIds.filter((id) => SYSTEM_KB_IDS.has(id))
    : DEFAULT_SETTINGS.defaultKBIds;
  const itemRecord = item as Record<string, unknown>;
  const allowUserDefaults =
    parseBoolean(itemRecord.allowUserDefaults) ?? parseBoolean(itemRecord.allow_user_defaults) ?? false;
  const itemRecord2 = item as Record<string, unknown>;
  const approvalMode =
    typeof itemRecord2.approvalMode === 'string' &&
    VALID_APPROVAL_MODES.includes(itemRecord2.approvalMode as ApprovalMode)
      ? (itemRecord2.approvalMode as ApprovalMode)
      : DEFAULT_SETTINGS.approvalMode;

  return {
    defaultKBIds,
    autoToolsEnabled:
      typeof item?.autoToolsEnabled === 'boolean' ? item!.autoToolsEnabled : DEFAULT_SETTINGS.autoToolsEnabled,
    webSearchEnabled:
      typeof item?.webSearchEnabled === 'boolean' ? item!.webSearchEnabled : DEFAULT_SETTINGS.webSearchEnabled,
    createAgentEnabled:
      typeof item?.createAgentEnabled === 'boolean' ? item!.createAgentEnabled : DEFAULT_SETTINGS.createAgentEnabled,
    memoriesEnabled:
      typeof item?.memoriesEnabled === 'boolean' ? item!.memoriesEnabled : DEFAULT_SETTINGS.memoriesEnabled,
    dataAnalysisEnabled:
      typeof item?.dataAnalysisEnabled === 'boolean' ? item!.dataAnalysisEnabled : DEFAULT_SETTINGS.dataAnalysisEnabled,
    defaultConnectionIds: Array.isArray(item?.defaultConnectionIds)
      ? item!.defaultConnectionIds
      : DEFAULT_SETTINGS.defaultConnectionIds,
    defaultNativeConnectorIds: Array.isArray((item as Record<string, unknown>)?.defaultNativeConnectorIds)
      ? ((item as Record<string, unknown>).defaultNativeConnectorIds as unknown[]).filter(
          (id): id is string => typeof id === 'string'
        )
      : DEFAULT_SETTINGS.defaultNativeConnectorIds,
    language: DEFAULT_SETTINGS.language,
    approvalMode,
    numaToolApprovalMode: validateNumaToolApprovalMode(item?.numaToolApprovalMode),
    emailSignatureEnabled:
      typeof item?.emailSignatureEnabled === 'boolean'
        ? item!.emailSignatureEnabled
        : DEFAULT_SETTINGS.emailSignatureEnabled,
    emailSignatureText:
      typeof item?.emailSignatureText === 'string' ? item!.emailSignatureText : DEFAULT_SETTINGS.emailSignatureText,
    chatScrollMode:
      typeof item?.chatScrollMode === 'string' && VALID_SCROLL_MODES.includes(item!.chatScrollMode as ChatScrollMode)
        ? (item!.chatScrollMode as ChatScrollMode)
        : DEFAULT_SETTINGS.chatScrollMode,
    chatSuggestionsEnabled:
      typeof item?.chatSuggestionsEnabled === 'boolean'
        ? item!.chatSuggestionsEnabled
        : DEFAULT_SETTINGS.chatSuggestionsEnabled,
    allowUserDefaults,
    allowedPythonLibraries: Array.isArray(item?.allowedPythonLibraries)
      ? item!.allowedPythonLibraries
      : DEFAULT_GLOBAL_CHAT_SETTINGS.allowedPythonLibraries,
  };
}

async function loadUserItem(userId: string): Promise<Record<string, unknown> | null> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { user_id: userId },
      ConsistentRead: true,
    })
  );
  const item = res.Item as Record<string, unknown> | undefined;
  return item ?? null;
}

function mergeUserSettings(globalSettings: ChatSettings, userItem: Record<string, unknown> | null): UserChatSettings {
  // When the user hasn't customised defaultKBIds we fall back to the
  // admin-set company defaults, which (by design) never include the Personal
  // sentinel — admins can't toggle it. Inject it here so existing users on
  // company defaults still get Personal enabled. Users who HAVE customised
  // get their saved state respected (so an explicit "Personal off" sticks).
  const withPersonal = (ids: string[]): string[] =>
    ids.includes(MY_FILES_SENTINEL) ? ids : [...ids, MY_FILES_SENTINEL];
  const defaultKBIds = Array.isArray(userItem?.defaultKBIds)
    ? (userItem!.defaultKBIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : withPersonal(globalSettings.defaultKBIds);
  const autoToolsEnabled =
    typeof userItem?.autoToolsEnabled === 'boolean'
      ? (userItem!.autoToolsEnabled as boolean)
      : globalSettings.autoToolsEnabled;
  const webSearchEnabled =
    typeof userItem?.webSearchEnabled === 'boolean'
      ? (userItem!.webSearchEnabled as boolean)
      : globalSettings.webSearchEnabled;
  const createAgentEnabled =
    typeof userItem?.createAgentEnabled === 'boolean'
      ? (userItem!.createAgentEnabled as boolean)
      : globalSettings.createAgentEnabled;
  const memoriesEnabled =
    typeof userItem?.memoriesEnabled === 'boolean'
      ? (userItem!.memoriesEnabled as boolean)
      : globalSettings.memoriesEnabled;
  const dataAnalysisEnabled =
    typeof userItem?.dataAnalysisEnabled === 'boolean'
      ? (userItem!.dataAnalysisEnabled as boolean)
      : globalSettings.dataAnalysisEnabled;
  const defaultConnectionIds = Array.isArray(userItem?.defaultConnectionIds)
    ? (userItem!.defaultConnectionIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : globalSettings.defaultConnectionIds;
  const defaultNativeConnectorIds = Array.isArray(userItem?.defaultNativeConnectorIds)
    ? (userItem!.defaultNativeConnectorIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : globalSettings.defaultNativeConnectorIds;
  const language =
    typeof userItem?.language === 'string' || userItem?.language === null
      ? (userItem!.language as string | null)
      : globalSettings.language;
  const approvalMode =
    typeof userItem?.approvalMode === 'string' && VALID_APPROVAL_MODES.includes(userItem.approvalMode as ApprovalMode)
      ? (userItem.approvalMode as ApprovalMode)
      : globalSettings.approvalMode;
  const numaToolApprovalMode =
    userItem?.numaToolApprovalMode && typeof userItem.numaToolApprovalMode === 'object'
      ? validateNumaToolApprovalMode(userItem.numaToolApprovalMode)
      : globalSettings.numaToolApprovalMode;
  const emailSignatureEnabled =
    typeof userItem?.emailSignatureEnabled === 'boolean'
      ? (userItem!.emailSignatureEnabled as boolean)
      : globalSettings.emailSignatureEnabled;
  const emailSignatureText =
    typeof userItem?.emailSignatureText === 'string'
      ? (userItem!.emailSignatureText as string)
      : globalSettings.emailSignatureText;
  const chatScrollMode =
    typeof userItem?.chatScrollMode === 'string' &&
    VALID_SCROLL_MODES.includes(userItem.chatScrollMode as ChatScrollMode)
      ? (userItem.chatScrollMode as ChatScrollMode)
      : globalSettings.chatScrollMode;
  const chatSuggestionsEnabled =
    typeof userItem?.chatSuggestionsEnabled === 'boolean'
      ? (userItem.chatSuggestionsEnabled as boolean)
      : globalSettings.chatSuggestionsEnabled;
  const userDefaultsEnabled =
    parseBoolean(userItem?.userDefaultsEnabled) ?? parseBoolean(userItem?.user_defaults_enabled) ?? true;

  return {
    defaultKBIds,
    autoToolsEnabled,
    webSearchEnabled,
    createAgentEnabled,
    memoriesEnabled,
    dataAnalysisEnabled,
    defaultConnectionIds,
    defaultNativeConnectorIds,
    language,
    approvalMode,
    numaToolApprovalMode,
    emailSignatureEnabled,
    emailSignatureText,
    chatScrollMode,
    chatSuggestionsEnabled,
    userDefaultsEnabled,
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path || '';
  const scope = event.queryStringParameters?.scope;
  const profileView = event.queryStringParameters?.profile === 'true';

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  try {
    if (!TABLE_NAME || !CLIENT_NAME) {
      console.error('Missing required environment variables', { TABLE_NAME, CLIENT_NAME });
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    const claims = getClaims(event);
    const userId = claims && typeof claims.sub === 'string' ? claims.sub : null;
    if (!userId) {
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    // GET/PUT /chat/settings?scope=global - company-wide defaults and policy
    console.log('chat-settings handler', { method, path, scope, pathMatch: /\/chat\/settings\/?$/.test(path) });
    if ((method === 'GET' || method === 'PUT') && /\/chat\/settings\/?$/.test(path) && scope === 'global') {
      if (method === 'GET') {
        const globalSettings = await loadGlobalSettings();
        console.log('GET scope=global returning', globalSettings);
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify(globalSettings) };
      }

      const adminCheck = isAdmin(claims);
      console.log('PUT scope=global adminCheck', { adminCheck, groups: claims?.['cognito:groups'] });
      if (!adminCheck) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
      }

      const body = JSON.parse(event.body || '{}') as Partial<GlobalChatSettings>;
      console.log('PUT scope=global body', body);
      const currentGlobal = await loadGlobalSettings();
      const bodyRecord = body as Record<string, unknown>;
      const allowUserDefaults =
        parseBoolean(bodyRecord.allowUserDefaults) ??
        parseBoolean(bodyRecord.allow_user_defaults) ??
        currentGlobal.allowUserDefaults;

      const updatedSettings: GlobalChatSettings & { user_id: string; updatedAt: string } = {
        user_id: GLOBAL_SETTINGS_KEY,
        defaultKBIds:
          'defaultKBIds' in body
            ? Array.isArray(body.defaultKBIds)
              ? body.defaultKBIds.filter((id): id is string => typeof id === 'string' && SYSTEM_KB_IDS.has(id))
              : currentGlobal.defaultKBIds
            : currentGlobal.defaultKBIds,
        autoToolsEnabled:
          'autoToolsEnabled' in body && typeof body.autoToolsEnabled === 'boolean'
            ? body.autoToolsEnabled
            : currentGlobal.autoToolsEnabled,
        webSearchEnabled:
          'webSearchEnabled' in body && typeof body.webSearchEnabled === 'boolean'
            ? body.webSearchEnabled
            : currentGlobal.webSearchEnabled,
        createAgentEnabled:
          'createAgentEnabled' in body && typeof body.createAgentEnabled === 'boolean'
            ? body.createAgentEnabled
            : currentGlobal.createAgentEnabled,
        memoriesEnabled:
          'memoriesEnabled' in body && typeof body.memoriesEnabled === 'boolean'
            ? body.memoriesEnabled
            : currentGlobal.memoriesEnabled,
        dataAnalysisEnabled:
          'dataAnalysisEnabled' in body && typeof body.dataAnalysisEnabled === 'boolean'
            ? body.dataAnalysisEnabled
            : currentGlobal.dataAnalysisEnabled,
        defaultConnectionIds:
          'defaultConnectionIds' in body
            ? Array.isArray(body.defaultConnectionIds)
              ? body.defaultConnectionIds.filter((id): id is string => typeof id === 'string')
              : currentGlobal.defaultConnectionIds
            : currentGlobal.defaultConnectionIds,
        defaultNativeConnectorIds:
          'defaultNativeConnectorIds' in body
            ? Array.isArray((body as Record<string, unknown>).defaultNativeConnectorIds)
              ? ((body as Record<string, unknown>).defaultNativeConnectorIds as unknown[]).filter(
                  (id): id is string => typeof id === 'string'
                )
              : currentGlobal.defaultNativeConnectorIds
            : currentGlobal.defaultNativeConnectorIds,
        language: DEFAULT_SETTINGS.language,
        approvalMode:
          'approvalMode' in body &&
          typeof body.approvalMode === 'string' &&
          VALID_APPROVAL_MODES.includes(body.approvalMode as ApprovalMode)
            ? (body.approvalMode as ApprovalMode)
            : currentGlobal.approvalMode,
        numaToolApprovalMode:
          'numaToolApprovalMode' in body
            ? mergeNumaToolApprovalMode(body.numaToolApprovalMode, currentGlobal.numaToolApprovalMode)
            : currentGlobal.numaToolApprovalMode,
        emailSignatureEnabled: currentGlobal.emailSignatureEnabled,
        emailSignatureText: currentGlobal.emailSignatureText,
        chatScrollMode: currentGlobal.chatScrollMode,
        chatSuggestionsEnabled:
          'chatSuggestionsEnabled' in body && typeof body.chatSuggestionsEnabled === 'boolean'
            ? body.chatSuggestionsEnabled
            : currentGlobal.chatSuggestionsEnabled,
        allowUserDefaults,
        allowedPythonLibraries:
          'allowedPythonLibraries' in body && Array.isArray(body.allowedPythonLibraries)
            ? body.allowedPythonLibraries
            : currentGlobal.allowedPythonLibraries,
        updatedAt: new Date().toISOString(),
      };

      console.log('PUT scope=global saving to DynamoDB', { tableName: TABLE_NAME, item: updatedSettings });
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: updatedSettings,
        })
      );
      console.log('PUT scope=global saved successfully');

      const responseSettings: GlobalChatSettings = {
        defaultKBIds: updatedSettings.defaultKBIds,
        autoToolsEnabled: updatedSettings.autoToolsEnabled,
        webSearchEnabled: updatedSettings.webSearchEnabled,
        createAgentEnabled: updatedSettings.createAgentEnabled,
        memoriesEnabled: updatedSettings.memoriesEnabled,
        dataAnalysisEnabled: updatedSettings.dataAnalysisEnabled,
        defaultConnectionIds: updatedSettings.defaultConnectionIds,
        defaultNativeConnectorIds: updatedSettings.defaultNativeConnectorIds,
        language: updatedSettings.language,
        approvalMode: updatedSettings.approvalMode,
        numaToolApprovalMode: updatedSettings.numaToolApprovalMode,
        emailSignatureEnabled: updatedSettings.emailSignatureEnabled,
        emailSignatureText: updatedSettings.emailSignatureText,
        chatScrollMode: updatedSettings.chatScrollMode,
        chatSuggestionsEnabled: updatedSettings.chatSuggestionsEnabled,
        allowUserDefaults: updatedSettings.allowUserDefaults,
        allowedPythonLibraries: updatedSettings.allowedPythonLibraries,
      };

      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(responseSettings) };
    }

    // GET/PUT /chat/settings?scope=profile - user profile (AI memory)
    if ((method === 'GET' || method === 'PUT') && /\/chat\/settings\/?$/.test(path) && scope === 'profile') {
      if (method === 'GET') {
        const userItem = await loadUserItem(userId);
        const profile = validateUserProfile(userItem?.userProfile);
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify(profile) };
      }

      // PUT — use UpdateCommand to set only userProfile without clobbering other fields
      const body = JSON.parse(event.body || '{}');
      const validated = validateUserProfile(body);
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { user_id: userId },
          UpdateExpression: 'SET userProfile = :p, updatedAt = :u',
          ExpressionAttributeValues: {
            ':p': validated,
            ':u': new Date().toISOString(),
          },
        })
      );
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    // GET /chat/settings - Get user's chat settings
    if (method === 'GET' && /\/chat\/settings\/?$/.test(path)) {
      const globalSettings = await loadGlobalSettings();
      const userItem = await loadUserItem(userId);
      const merged = mergeUserSettings(globalSettings, userItem);

      const mergedSettings: ChatSettings = {
        defaultKBIds: merged.defaultKBIds,
        autoToolsEnabled: merged.autoToolsEnabled,
        webSearchEnabled: merged.webSearchEnabled,
        createAgentEnabled: merged.createAgentEnabled,
        memoriesEnabled: merged.memoriesEnabled,
        dataAnalysisEnabled: merged.dataAnalysisEnabled,
        defaultConnectionIds: merged.defaultConnectionIds,
        defaultNativeConnectorIds: merged.defaultNativeConnectorIds,
        language: merged.language,
        approvalMode: merged.approvalMode,
        numaToolApprovalMode: merged.numaToolApprovalMode,
        emailSignatureEnabled: merged.emailSignatureEnabled,
        emailSignatureText: merged.emailSignatureText,
        chatScrollMode: merged.chatScrollMode,
        chatSuggestionsEnabled: merged.chatSuggestionsEnabled,
      };

      if (profileView) {
        return {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify({ userDefaultsEnabled: merged.userDefaultsEnabled, settings: mergedSettings }),
        };
      }

      // Only apply user chat defaults when the user has explicitly enabled them.
      // Profile fields (language, email signature, approval mode) always use user values.
      const useUserChatDefaults = merged.userDefaultsEnabled && globalSettings.allowUserDefaults;
      const effective: ChatSettings = {
        defaultKBIds: useUserChatDefaults ? merged.defaultKBIds : globalSettings.defaultKBIds,
        autoToolsEnabled: useUserChatDefaults ? merged.autoToolsEnabled : globalSettings.autoToolsEnabled,
        webSearchEnabled: useUserChatDefaults ? merged.webSearchEnabled : globalSettings.webSearchEnabled,
        createAgentEnabled: useUserChatDefaults ? merged.createAgentEnabled : globalSettings.createAgentEnabled,
        memoriesEnabled: useUserChatDefaults ? merged.memoriesEnabled : globalSettings.memoriesEnabled,
        dataAnalysisEnabled: useUserChatDefaults ? merged.dataAnalysisEnabled : globalSettings.dataAnalysisEnabled,
        defaultConnectionIds: useUserChatDefaults ? merged.defaultConnectionIds : globalSettings.defaultConnectionIds,
        defaultNativeConnectorIds: useUserChatDefaults
          ? merged.defaultNativeConnectorIds
          : globalSettings.defaultNativeConnectorIds,
        language: merged.language,
        approvalMode: merged.approvalMode,
        numaToolApprovalMode: merged.numaToolApprovalMode,
        emailSignatureEnabled: merged.emailSignatureEnabled,
        emailSignatureText: merged.emailSignatureText,
        chatScrollMode: merged.chatScrollMode,
        chatSuggestionsEnabled: merged.chatSuggestionsEnabled,
      };

      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ ...effective, userDefaultsEnabled: merged.userDefaultsEnabled }),
      };
    }

    // PUT /chat/settings - Update user's chat settings
    if (method === 'PUT' && /\/chat\/settings\/?$/.test(path)) {
      const globalSettings = await loadGlobalSettings();
      const body = JSON.parse(event.body || '{}') as UserChatSettingsUpdate;

      // Profile fields (language, email signature, approval mode) are always saveable.
      // Chat default fields (KBs, tools, integrations) require admin allowUserDefaults.
      const CHAT_DEFAULT_KEYS = [
        'defaultKBIds',
        'autoToolsEnabled',
        'webSearchEnabled',
        'createAgentEnabled',
        'memoriesEnabled',
        'dataAnalysisEnabled',
        'defaultConnectionIds',
        'defaultNativeConnectorIds',
        'userDefaultsEnabled',
      ];
      const hasChatDefaultFields = CHAT_DEFAULT_KEYS.some((k) => k in body);
      if (!globalSettings.allowUserDefaults && hasChatDefaultFields) {
        return {
          statusCode: 403,
          headers: HEADERS,
          body: JSON.stringify({ error: 'User defaults are disabled by admin policy' }),
        };
      }

      const existing = await loadUserItem(userId);
      const current = (existing as (Partial<UserChatSettings> & { user_id: string }) | null) ?? { user_id: userId };

      const next: Partial<UserChatSettings> & { user_id: string; updatedAt: string; approvalMode?: ApprovalMode } = {
        user_id: userId,
        updatedAt: new Date().toISOString(),
      };

      const mergeArray = (value: unknown): string[] | undefined =>
        Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : undefined;

      // defaultKBIds
      if ('defaultKBIds' in body) {
        if (body.defaultKBIds === null) {
          // clear override
        } else {
          next.defaultKBIds = mergeArray(body.defaultKBIds) ?? [];
        }
      } else if (Array.isArray(current.defaultKBIds)) {
        next.defaultKBIds = current.defaultKBIds;
      }

      // autoToolsEnabled
      if ('autoToolsEnabled' in body) {
        if (body.autoToolsEnabled === null) {
          // clear override
        } else if (typeof body.autoToolsEnabled === 'boolean') {
          next.autoToolsEnabled = body.autoToolsEnabled;
        }
      } else if (typeof current.autoToolsEnabled === 'boolean') {
        next.autoToolsEnabled = current.autoToolsEnabled;
      }

      // webSearchEnabled
      if ('webSearchEnabled' in body) {
        if (body.webSearchEnabled === null) {
          // clear override
        } else if (typeof body.webSearchEnabled === 'boolean') {
          next.webSearchEnabled = body.webSearchEnabled;
        }
      } else if (typeof current.webSearchEnabled === 'boolean') {
        next.webSearchEnabled = current.webSearchEnabled;
      }

      // createAgentEnabled
      if ('createAgentEnabled' in body) {
        if (body.createAgentEnabled === null) {
          // clear override
        } else if (typeof body.createAgentEnabled === 'boolean') {
          next.createAgentEnabled = body.createAgentEnabled;
        }
      } else if (typeof current.createAgentEnabled === 'boolean') {
        next.createAgentEnabled = current.createAgentEnabled;
      }

      // memoriesEnabled
      if ('memoriesEnabled' in body) {
        if (body.memoriesEnabled === null) {
          // clear override
        } else if (typeof body.memoriesEnabled === 'boolean') {
          next.memoriesEnabled = body.memoriesEnabled;
        }
      } else if (typeof current.memoriesEnabled === 'boolean') {
        next.memoriesEnabled = current.memoriesEnabled;
      }

      // dataAnalysisEnabled
      if ('dataAnalysisEnabled' in body) {
        if (body.dataAnalysisEnabled === null) {
          // clear override
        } else if (typeof body.dataAnalysisEnabled === 'boolean') {
          next.dataAnalysisEnabled = body.dataAnalysisEnabled;
        }
      } else if (typeof current.dataAnalysisEnabled === 'boolean') {
        next.dataAnalysisEnabled = current.dataAnalysisEnabled;
      }

      // defaultConnectionIds
      if ('defaultConnectionIds' in body) {
        if (body.defaultConnectionIds === null) {
          // clear override
        } else {
          next.defaultConnectionIds = mergeArray(body.defaultConnectionIds) ?? [];
        }
      } else if (Array.isArray(current.defaultConnectionIds)) {
        next.defaultConnectionIds = current.defaultConnectionIds;
      }

      // defaultNativeConnectorIds — mirrors defaultConnectionIds for natives.
      if ('defaultNativeConnectorIds' in body) {
        const incoming = (body as Record<string, unknown>).defaultNativeConnectorIds;
        if (incoming === null) {
          // clear override
        } else {
          next.defaultNativeConnectorIds = mergeArray(incoming) ?? [];
        }
      } else if (Array.isArray((current as Record<string, unknown>).defaultNativeConnectorIds)) {
        next.defaultNativeConnectorIds = (current as UserChatSettings).defaultNativeConnectorIds;
      }

      // language
      if ('language' in body) {
        if (body.language === null) {
          // clear override
        } else if (typeof body.language === 'string') {
          next.language = body.language;
        }
      } else if (typeof current.language === 'string' || current.language === null) {
        next.language = current.language as string | null;
      }

      // approvalMode
      if ('approvalMode' in body) {
        if (body.approvalMode === null) {
          // clear override
        } else if (
          typeof body.approvalMode === 'string' &&
          VALID_APPROVAL_MODES.includes(body.approvalMode as ApprovalMode)
        ) {
          next.approvalMode = body.approvalMode as ApprovalMode;
        }
      } else if (
        typeof current.approvalMode === 'string' &&
        VALID_APPROVAL_MODES.includes(current.approvalMode as ApprovalMode)
      ) {
        next.approvalMode = current.approvalMode as ApprovalMode;
      }

      // numaToolApprovalMode
      if ('numaToolApprovalMode' in body) {
        if (body.numaToolApprovalMode === null) {
          // clear override
        } else if (typeof body.numaToolApprovalMode === 'object' && body.numaToolApprovalMode !== null) {
          next.numaToolApprovalMode = validateNumaToolApprovalMode(body.numaToolApprovalMode);
        }
      } else if (current.numaToolApprovalMode && typeof current.numaToolApprovalMode === 'object') {
        next.numaToolApprovalMode = validateNumaToolApprovalMode(current.numaToolApprovalMode);
      }

      // emailSignatureEnabled
      if ('emailSignatureEnabled' in body) {
        if (body.emailSignatureEnabled === null) {
          // clear override
        } else if (typeof body.emailSignatureEnabled === 'boolean') {
          next.emailSignatureEnabled = body.emailSignatureEnabled;
        }
      } else if (typeof current.emailSignatureEnabled === 'boolean') {
        next.emailSignatureEnabled = current.emailSignatureEnabled;
      }

      // emailSignatureText
      if ('emailSignatureText' in body) {
        if (body.emailSignatureText === null) {
          // clear override
        } else if (typeof body.emailSignatureText === 'string') {
          next.emailSignatureText = body.emailSignatureText;
        }
      } else if (typeof current.emailSignatureText === 'string') {
        next.emailSignatureText = current.emailSignatureText;
      }

      // chatScrollMode
      if ('chatScrollMode' in body) {
        if (body.chatScrollMode === null) {
          // clear override
        } else if (
          typeof body.chatScrollMode === 'string' &&
          VALID_SCROLL_MODES.includes(body.chatScrollMode as ChatScrollMode)
        ) {
          next.chatScrollMode = body.chatScrollMode as ChatScrollMode;
        }
      } else if (
        typeof current.chatScrollMode === 'string' &&
        VALID_SCROLL_MODES.includes(current.chatScrollMode as ChatScrollMode)
      ) {
        next.chatScrollMode = current.chatScrollMode as ChatScrollMode;
      }

      // chatSuggestionsEnabled
      if ('chatSuggestionsEnabled' in body) {
        if ((body as Record<string, unknown>).chatSuggestionsEnabled === null) {
          // clear override
        } else if (typeof (body as Record<string, unknown>).chatSuggestionsEnabled === 'boolean') {
          next.chatSuggestionsEnabled = (body as Record<string, unknown>).chatSuggestionsEnabled as boolean;
        }
      } else if (typeof current.chatSuggestionsEnabled === 'boolean') {
        next.chatSuggestionsEnabled = current.chatSuggestionsEnabled as boolean;
      }

      // userDefaultsEnabled
      if ('userDefaultsEnabled' in body) {
        if (body.userDefaultsEnabled === null) {
          // clear explicit flag (default true)
        } else if (typeof body.userDefaultsEnabled === 'boolean') {
          next.userDefaultsEnabled = body.userDefaultsEnabled;
        }
      } else if ('user_defaults_enabled' in body) {
        const val = (body as Record<string, unknown>).user_defaults_enabled;
        if (val === null) {
          // clear explicit flag (default true)
        } else if (typeof val === 'boolean') {
          next.userDefaultsEnabled = val;
        }
      } else if (typeof current.userDefaultsEnabled === 'boolean') {
        next.userDefaultsEnabled = current.userDefaultsEnabled;
      }

      // Remove empty overrides item (keep minimal keys) - store only if at least one override is set
      const hasOverrides =
        'defaultKBIds' in next ||
        'autoToolsEnabled' in next ||
        'webSearchEnabled' in next ||
        'createAgentEnabled' in next ||
        'memoriesEnabled' in next ||
        'dataAnalysisEnabled' in next ||
        'defaultConnectionIds' in next ||
        'defaultNativeConnectorIds' in next ||
        'language' in next ||
        'approvalMode' in next ||
        'numaToolApprovalMode' in next ||
        'emailSignatureEnabled' in next ||
        'emailSignatureText' in next ||
        'chatScrollMode' in next ||
        'chatSuggestionsEnabled' in next ||
        'userDefaultsEnabled' in next;

      const itemToStore = hasOverrides ? next : { user_id: userId, updatedAt: next.updatedAt };

      // Preserve userProfile if it exists — PutCommand overwrites the entire item,
      // so we carry forward the existing userProfile attribute to avoid clobbering it.
      if (existing?.userProfile) {
        (itemToStore as Record<string, unknown>).userProfile = existing.userProfile;
      }

      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: itemToStore,
        })
      );

      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error('chat-settings error', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
