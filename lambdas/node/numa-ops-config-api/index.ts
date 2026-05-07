import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type AttributeType,
} from '@aws-sdk/client-cognito-identity-provider';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { withPRM } from '../../../lib/prm-node/prm';
import { dbToApi, translateTeamString } from '../../../lib/ops-serialize';

const client = withPRM(DynamoDBClient, {});
const dynamo = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
});

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

const OPS_CONFIG_TABLE = process.env.OPS_CONFIG_TABLE!;
const OPS_TABLE = process.env.OPS_TABLE ?? '';
const USER_POOL_ID = process.env.USER_POOL_ID ?? '';
const CHAT_SETTINGS_TABLE = process.env.CHAT_SETTINGS_TABLE ?? '';
const REGION = process.env.AWS_REGION ?? 'us-east-1';

const s3 = new S3Client({ region: REGION });
const AVATAR_URL_EXPIRY = 12 * 60 * 60; // 12 hours

/**
 * Parse an s3://bucket/key URL into its components.
 */
const parseS3Url = (url: string): { bucket: string; key: string } | null => {
  const match = url.match(/^s3:\/\/([^/]+)\/(.+)$/);
  return match ? { bucket: match[1], key: match[2] } : null;
};

/**
 * Generate presigned URLs for avatarUrl on each staff record.
 * The Lambda's execution role has broad S3 read access, so it can
 * sign URLs for any user's profile image (unlike frontend credentials
 * which are scoped to the current user's prefix).
 */
const addAvatarPresignedUrls = async (staffRecords: Record<string, unknown>[]): Promise<void> => {
  await Promise.all(
    staffRecords.map(async (staff) => {
      const avatarUrl = staff.avatarUrl as string | undefined;
      if (!avatarUrl) return;
      const parsed = parseS3Url(avatarUrl);
      if (!parsed) return;
      try {
        staff.avatarPresignedUrl = await getSignedUrl(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK version mismatch between S3 and presigner
          s3 as any,
          new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
          {
            expiresIn: AVATAR_URL_EXPIRY,
          }
        );
      } catch {
        // If signing fails, leave avatarPresignedUrl unset — frontend shows initials
      }
    })
  );
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

type AuthContext = { sub: string; email?: string; name?: string; groups: string[] };

/**
 * Get the set of team IDs the user has access to. Used to filter projects
 * by boardIds so users only see projects linked to their accessible boards.
 */
const getAccessibleTeamIds = async (auth: AuthContext): Promise<Set<string>> => {
  if (!OPS_TABLE) return new Set(); // No ops table configured — no filtering
  const result = await dynamo.send(
    new QueryCommand({
      TableName: OPS_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: { ':pk': 'TENANT', ':sk': 'TEAM#' },
    })
  );
  const teams = result.Items ?? [];
  return new Set(
    teams
      .filter((team) => {
        const ac = team.accessControl as { mode?: string; users?: string[] } | undefined;
        if (!ac || ac.mode === 'all') return true;
        if (team.createdBy === auth.sub) return true;
        return Array.isArray(ac.users) && ac.users.includes(auth.sub);
      })
      .map((team) => String(team.id ?? team.SK ?? '').replace('TEAM#', ''))
  );
};

/** Filter a projects array to only those accessible to the user. */
const filterProjectsByAccess = (
  projects: Record<string, unknown>[],
  accessibleTeamIds: Set<string>
): Record<string, unknown>[] =>
  projects.filter((p) => {
    const boardIds = p.boardIds as string[] | undefined;
    if (!boardIds?.length) return true; // No boards = visible to all
    return boardIds.some((id) => accessibleTeamIds.has(id));
  });

const jsonResponse = (
  statusCode: number,
  payload: unknown
): { statusCode: number; headers: typeof HEADERS; body: string } => ({
  statusCode,
  headers: HEADERS,
  // dbToApi recursively translates DB-shape keys (teamId, team, teams, etc.)
  // to API-shape (boardId, board, boards). Single boundary for all ops APIs.
  body: JSON.stringify(dbToApi(payload)),
});

const errorResponse = (statusCode: number, message: string): ReturnType<typeof jsonResponse> =>
  jsonResponse(statusCode, { error: translateTeamString(message) });

const parseJwt = (token: string): Record<string, unknown> => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const resolveAuthContext = (event: APIGatewayProxyEventV2): AuthContext | null => {
  // Path 1: Direct Lambda invocation with pre-authenticated context
  // (e.g. workspace-chat-tools calling us — IAM controls who can invoke)
  const uc = (event as unknown as Record<string, unknown>).userContext as Record<string, unknown> | undefined;
  if (uc && typeof uc.sub === 'string') {
    return {
      sub: uc.sub,
      email: typeof uc.email === 'string' ? uc.email : undefined,
      name: typeof uc.name === 'string' ? uc.name : undefined,
      groups: Array.isArray(uc.groups)
        ? (uc.groups as unknown[]).filter((g): g is string => typeof g === 'string')
        : [],
    };
  }

  // Path 2: API Gateway with JWT (already verified by Cognito authorizer)
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

const buildPathSegments = (event: APIGatewayProxyEventV2): string[] => {
  const rawPath = event.requestContext.http?.path ?? event.rawPath ?? '';
  const trimmed = rawPath.replace(/^\/+/, '');
  const withoutApi = trimmed.startsWith('api/') ? trimmed.slice(4) : trimmed;
  return withoutApi.split('/').filter(Boolean);
};

const parseBody = (event: APIGatewayProxyEventV2): Record<string, unknown> => {
  try {
    return JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
};

const now = (): string => new Date().toISOString();

// ─── Reserved prefixes that cannot be used as ticket type prefixes ───────────────

const RESERVED_PREFIXES = new Set([
  'WC',
  'BOARD',
  'TICKET',
  'PREFIX',
  'USER',
  'STAGE',
  'ZONE',
  'WORKUNIT',
  'COMMENT',
  'AUDIT',
  'LINK',
  'META',
  'TENANT',
  'TID',
  'PREF',
]);

// ─── Bulk Config Loader ─────────────────────────────────────────────────────────

interface OpsConfigResponse {
  ticketTypes: Record<string, unknown>[];
  statuses: Record<string, unknown>[];
  fields: Record<string, unknown>[];
  staff: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  crmConfig: Record<string, unknown> | null;
  supplierConfig: Record<string, unknown> | null;
  linkConfig: Record<string, unknown> | null;
  lastStaffSyncedAt?: string | null;
}

const loadAllConfig = async (): Promise<OpsConfigResponse> => {
  const result: OpsConfigResponse = {
    ticketTypes: [],
    statuses: [],
    fields: [],
    staff: [],
    projects: [],
    crmConfig: null,
    supplierConfig: null,
    linkConfig: null,
    lastStaffSyncedAt: null,
  };

  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const response = await dynamo.send(
      new QueryCommand({
        TableName: OPS_CONFIG_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'CONFIG' },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    for (const item of response.Items ?? []) {
      const sk = item.SK as string;
      if (sk.startsWith('TICKET_TYPE#')) result.ticketTypes.push(item);
      else if (sk.startsWith('STATUS#')) result.statuses.push(item);
      else if (sk.startsWith('FIELD#')) result.fields.push(item);
      else if (sk.startsWith('STAFF#')) result.staff.push(item);
      else if (sk.startsWith('PROJECT#')) result.projects.push(item);
      else if (sk === 'CRM_CONFIG') result.crmConfig = item;
      else if (sk === 'SUPPLIER_CONFIG') result.supplierConfig = item;
      else if (sk === 'LINK_CONFIG') result.linkConfig = item;
      else if (sk === 'META#STAFF_SYNC') result.lastStaffSyncedAt = (item.lastSyncedAt as string) ?? null;
    }

    lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  // Generate presigned URLs so the frontend can display any user's avatar
  await addAvatarPresignedUrls(result.staff);

  return result;
};

// ─── CRUD Helpers ───────────────────────────────────────────────────────────────

const getConfigItem = async (sk: string): Promise<Record<string, unknown> | undefined> => {
  const result = await dynamo.send(new GetCommand({ TableName: OPS_CONFIG_TABLE, Key: { PK: 'CONFIG', SK: sk } }));
  return result.Item as Record<string, unknown> | undefined;
};

const putConfigItem = async (item: Record<string, unknown>): Promise<void> => {
  await dynamo.send(new PutCommand({ TableName: OPS_CONFIG_TABLE, Item: { PK: 'CONFIG', ...item } }));
};

const deleteConfigItem = async (sk: string): Promise<void> => {
  await dynamo.send(new DeleteCommand({ TableName: OPS_CONFIG_TABLE, Key: { PK: 'CONFIG', SK: sk } }));
};

const listConfigByPrefix = async (prefix: string): Promise<Record<string, unknown>[]> => {
  const response = await dynamo.send(
    new QueryCommand({
      TableName: OPS_CONFIG_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': 'CONFIG', ':prefix': prefix },
    })
  );
  return (response.Items ?? []) as Record<string, unknown>[];
};

// ─── Route Handlers ─────────────────────────────────────────────────────────────

const handleTicketTypes = async (
  method: string,
  segments: string[],
  body: Record<string, unknown>,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  // GET /config/ticket-types
  if (method === 'GET' && segments.length === 0) {
    const items = await listConfigByPrefix('TICKET_TYPE#');
    return jsonResponse(200, { ticketTypes: items });
  }

  // Admin-only from here
  if (!isAdmin(auth)) return errorResponse(403, 'Admin access required');

  // POST /config/ticket-types
  if (method === 'POST' && segments.length === 0) {
    const { name, prefix, icon, color, defaultFields } = body;
    if (!name || !prefix || !color) return errorResponse(400, 'Missing required fields: name, prefix, color');

    const p = String(prefix).toUpperCase();
    if (!/^[A-Z0-9]{2,6}$/.test(p)) return errorResponse(400, 'Prefix must be 2-6 uppercase alphanumeric characters');
    if (RESERVED_PREFIXES.has(p)) return errorResponse(400, 'Prefix conflicts with a reserved key');

    // Check uniqueness
    const existing = await listConfigByPrefix('TICKET_TYPE#');
    if (existing.some((t) => (t.prefix as string)?.toUpperCase() === p)) {
      return errorResponse(409, 'Prefix already in use by another ticket type');
    }

    const resolvedIcon = icon ? String(icon) : 'ticket';
    const id = `tt-${randomUUID().slice(0, 8)}`;
    const item = {
      SK: `TICKET_TYPE#${id}`,
      entityType: 'TICKET_TYPE',
      id,
      name: String(name),
      prefix: p,
      icon: resolvedIcon,
      color: String(color),
      defaultFields: Array.isArray(defaultFields) ? defaultFields : [],
      order: existing.length + 1,
      createdAt: now(),
      updatedAt: now(),
    };
    await putConfigItem(item);
    return jsonResponse(201, item);
  }

  // PUT /config/ticket-types/{id}
  if (method === 'PUT' && segments.length === 1) {
    const id = segments[0];
    const existing = await getConfigItem(`TICKET_TYPE#${id}`);
    if (!existing) return errorResponse(404, 'Ticket type not found');
    // Prefix cannot be changed after creation — strip it from the update
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { prefix: _ignored, ...bodyWithoutPrefix } = body;
    const updated = { ...existing, ...bodyWithoutPrefix, id, updatedAt: now() };
    await putConfigItem(updated);
    return jsonResponse(200, updated);
  }

  // DELETE /config/ticket-types/{id}
  if (method === 'DELETE' && segments.length === 1) {
    await deleteConfigItem(`TICKET_TYPE#${segments[0]}`);
    return jsonResponse(200, { deleted: true });
  }

  return errorResponse(404, 'Route not found');
};

const handleStatuses = async (
  method: string,
  segments: string[],
  body: Record<string, unknown>,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (method === 'GET' && segments.length === 0) {
    const items = await listConfigByPrefix('STATUS#');
    return jsonResponse(200, { statuses: items });
  }

  if (!isAdmin(auth)) return errorResponse(403, 'Admin access required');

  if (method === 'POST' && segments.length === 0) {
    const { name, type, color, icon } = body;
    if (!name || !type || !color) return errorResponse(400, 'Missing required fields: name, type, color');
    const id = `status-${randomUUID().slice(0, 8)}`;
    const item = {
      SK: `STATUS#${id}`,
      entityType: 'STATUS',
      id,
      name: String(name),
      type: String(type),
      color: String(color),
      icon: icon ? String(icon) : undefined,
      order: 100,
      isPredefined: false,
      createdAt: now(),
      updatedAt: now(),
    };
    await putConfigItem(item);
    return jsonResponse(201, item);
  }

  if (method === 'PUT' && segments.length === 1) {
    const id = segments[0];
    const existing = await getConfigItem(`STATUS#${id}`);
    if (!existing) return errorResponse(404, 'Status not found');
    const updated = { ...existing, ...body, id, updatedAt: now() };
    await putConfigItem(updated);
    return jsonResponse(200, updated);
  }

  return errorResponse(404, 'Route not found');
};

const handleFields = async (
  method: string,
  segments: string[],
  body: Record<string, unknown>,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (method === 'GET' && segments.length === 0) {
    const items = await listConfigByPrefix('FIELD#');
    return jsonResponse(200, { fields: items });
  }

  if (!isAdmin(auth)) return errorResponse(403, 'Admin access required');

  if (method === 'POST' && segments.length === 0) {
    const { name, fieldType, category } = body;
    if (!name || !fieldType || !category)
      return errorResponse(400, 'Missing required fields: name, fieldType, category');
    const id = `field-${randomUUID().slice(0, 8)}`;
    const existing = await listConfigByPrefix('FIELD#');
    const item = {
      SK: `FIELD#${id}`,
      entityType: 'FIELD',
      id,
      name: String(name),
      fieldType: String(fieldType),
      category: String(category),
      required: body.required === true,
      helpText: body.helpText ? String(body.helpText) : '',
      defaultValue: body.defaultValue ?? null,
      options: Array.isArray(body.options) ? body.options : [],
      isSystem: false,
      order: existing.length + 1,
      createdAt: now(),
      updatedAt: now(),
    };
    await putConfigItem(item);
    return jsonResponse(201, item);
  }

  if (method === 'PUT' && segments.length === 1) {
    const id = segments[0];
    const existing = await getConfigItem(`FIELD#${id}`);
    if (!existing) return errorResponse(404, 'Field not found');
    const updated = { ...existing, ...body, id, updatedAt: now() };
    await putConfigItem(updated);
    return jsonResponse(200, updated);
  }

  // DELETE /config/fields/{id} — refuse if system field or referenced by the CRM layout
  if (method === 'DELETE' && segments.length === 1) {
    const id = segments[0];
    const existing = await getConfigItem(`FIELD#${id}`);
    if (!existing) return errorResponse(404, 'Field not found');
    if (existing.isSystem === true) {
      return errorResponse(409, 'Cannot delete a built-in system field');
    }
    const crmConfig = await getConfigItem('CRM_CONFIG');
    const customerRecord = crmConfig?.customerRecord as
      | { sections?: { name?: string; fieldIds?: string[] }[] }
      | undefined;
    const sections = customerRecord?.sections ?? [];
    const usedInSections = sections.filter((s) => s.fieldIds?.includes(id)).map((s) => s.name ?? '(unnamed)');
    if (usedInSections.length > 0) {
      return errorResponse(
        409,
        `Cannot delete field: still used in CRM layout sections [${usedInSections.join(', ')}]. Remove it from the layout first via update_crm_config.`
      );
    }
    await deleteConfigItem(`FIELD#${id}`);
    return jsonResponse(200, { deleted: true });
  }

  return errorResponse(404, 'Route not found');
};

const handleStaff = async (
  method: string,
  segments: string[],
  body: Record<string, unknown>,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (method === 'GET' && segments.length === 0) {
    const items = await listConfigByPrefix('STAFF#');
    return jsonResponse(200, { staff: items });
  }

  if (!isAdmin(auth)) return errorResponse(403, 'Admin access required');

  if (method === 'POST' && segments.length === 0) {
    const { id, name, email } = body;
    if (!id || !name || !email) return errorResponse(400, 'Missing required fields: id (Cognito sub), name, email');
    const item = {
      SK: `STAFF#${String(id)}`,
      entityType: 'STAFF',
      id: String(id),
      name: String(name),
      email: String(email),
      role: body.role ? String(body.role) : undefined,
      avatarUrl: body.avatarUrl ? String(body.avatarUrl) : undefined,
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    };
    await putConfigItem(item);
    return jsonResponse(201, item);
  }

  if (method === 'PUT' && segments.length === 1) {
    const id = segments[0];
    const existing = await getConfigItem(`STAFF#${id}`);
    if (!existing) return errorResponse(404, 'Staff not found');
    const updated = { ...existing, ...body, id, updatedAt: now() };
    await putConfigItem(updated);
    return jsonResponse(200, updated);
  }

  return errorResponse(404, 'Route not found');
};

// ─── Staff Sync from Cognito ─────────────────────────────────────────────────

// No cooldown — always sync fresh from Cognito when called.

const getCognitoAttr = (attrs: AttributeType[] | undefined, name: string): string | undefined =>
  attrs?.find((a) => a.Name === name)?.Value;

/**
 * Resolve the best available display name from Cognito user attributes.
 * Returns null when no real name is available (i.e. only a username/email prefix).
 *
 * Checks (in priority order):
 *   1. `name` attribute — only if it looks like a real name (contains a space)
 *   2. `given_name` + `family_name` attributes
 *   3. null — no real name found
 */
const resolveCognitoName = (attrs: AttributeType[] | undefined): string | null => {
  const name = getCognitoAttr(attrs, 'name');
  if (name && name.includes(' ')) return name;

  const given = getCognitoAttr(attrs, 'given_name');
  const family = getCognitoAttr(attrs, 'family_name');
  if (given && family) return `${given} ${family}`;
  if (given) return given;
  if (family) return family;

  return null;
};

// ─── User Profile Enrichment from Chat Settings ─────────────────────────────

/** Shape of the userProfile attribute stored in the chat-settings table. */
interface ChatUserProfile {
  name?: string;
  jobTitle?: string;
  profileImage?: { s3Bucket: string; s3Key: string } | null;
}

/**
 * Batch-read user profiles from the chat-settings DynamoDB table.
 * Returns a map of userId (Cognito sub) → ChatUserProfile.
 * DynamoDB BatchGetItem supports up to 100 keys per request, so we chunk.
 */
const batchGetUserProfiles = async (userIds: string[]): Promise<Map<string, ChatUserProfile>> => {
  const result = new Map<string, ChatUserProfile>();
  if (!CHAT_SETTINGS_TABLE || userIds.length === 0) return result;

  const BATCH_SIZE = 100;
  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const chunk = userIds.slice(i, i + BATCH_SIZE);
    const keys = chunk.map((id) => ({ user_id: id }));

    const response = await dynamo.send(
      new BatchGetCommand({
        RequestItems: {
          [CHAT_SETTINGS_TABLE]: {
            Keys: keys,
            ProjectionExpression: 'user_id, userProfile',
          },
        },
      })
    );

    const items = response.Responses?.[CHAT_SETTINGS_TABLE] ?? [];
    for (const item of items) {
      const userId = item.user_id as string;
      const profile = item.userProfile as ChatUserProfile | undefined;
      if (profile) {
        result.set(userId, profile);
      }
    }
  }

  return result;
};

/**
 * handleStaffSync — POST /ops/config/staff/sync
 *
 * Syncs Cognito users into the ops-config DynamoDB staff records, then enriches
 * each record with profile data from the chat-settings table (name, jobTitle,
 * profile image). This gives Ops richer staff data without users having to
 * re-enter it.
 *
 * - Creates new staff records for users not yet in DynamoDB
 * - Enriches with user profile data: name (preferred over Cognito), jobTitle → role, profileImage → avatarUrl
 * - Marks staff as isActive: false if the Cognito user is disabled
 * - Always performs a fresh sync from Cognito (no cooldown)
 */
const handleStaffSync = async (
  event: APIGatewayProxyEventV2,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (!USER_POOL_ID) {
    return errorResponse(500, 'USER_POOL_ID not configured — staff sync unavailable');
  }

  const force = event.queryStringParameters?.force === 'true';

  // Force sync requires admin
  if (force && !isAdmin(auth)) {
    return errorResponse(403, 'Admin access required for force sync');
  }

  // Paginate through all Cognito users
  const cognitoClient = withPRM(CognitoIdentityProviderClient, {});
  const cognitoUsers: {
    sub: string;
    email: string;
    name: string | null;
    enabled: boolean;
  }[] = [];

  let paginationToken: string | undefined;
  do {
    const response = await cognitoClient.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Limit: 60,
        PaginationToken: paginationToken,
      })
    );

    for (const user of response.Users ?? []) {
      const sub = user.Username ?? getCognitoAttr(user.Attributes, 'sub');
      const email = getCognitoAttr(user.Attributes, 'email');
      if (!sub || !email) continue;

      cognitoUsers.push({
        sub,
        email,
        name: resolveCognitoName(user.Attributes),
        enabled: user.Enabled !== false,
      });
    }

    paginationToken = response.PaginationToken;
  } while (paginationToken);

  // Load existing staff records
  const existingStaff = await listConfigByPrefix('STAFF#');
  const existingById = new Map(existingStaff.map((s) => [String(s.id), s]));

  // Enrich from chat-settings user profiles (name, jobTitle, profileImage)
  const userProfiles = await batchGetUserProfiles(cognitoUsers.map((u) => u.sub));

  const ts = now();
  const upsertedStaff: Record<string, unknown>[] = [];

  for (const cu of cognitoUsers) {
    const existing = existingById.get(cu.sub);
    const profile = userProfiles.get(cu.sub);

    // Prefer user-profile name over Cognito name (users set their display name
    // in the profile settings — it's more accurate than the Cognito attribute).
    // Returns null when no real name is available — frontend displays email.
    const enrichedName = profile?.name?.trim() || cu.name || cu.email?.split('@')[0] || null;

    // Map jobTitle from user profile → role field on staff record
    const enrichedRole = profile?.jobTitle?.trim() || undefined;

    // Build an S3 path string from the profile image reference so the frontend
    // can generate a signed URL to display the avatar
    const enrichedAvatarUrl = profile?.profileImage
      ? `s3://${profile.profileImage.s3Bucket}/${profile.profileImage.s3Key}`
      : undefined;

    if (existing) {
      const updated = {
        ...existing,
        name: enrichedName,
        email: cu.email,
        isActive: cu.enabled,
        // Enrich role and avatarUrl from profile — but don't overwrite if
        // an admin has manually set them and the profile has nothing
        role: enrichedRole || (existing.role as string | undefined),
        avatarUrl: enrichedAvatarUrl || (existing.avatarUrl as string | undefined),
        updatedAt: ts,
      };
      await putConfigItem(updated);
      upsertedStaff.push(updated);
    } else {
      // Create new staff record with enriched data
      const newStaff = {
        SK: `STAFF#${cu.sub}`,
        entityType: 'STAFF',
        id: cu.sub,
        name: enrichedName,
        email: cu.email,
        role: enrichedRole,
        avatarUrl: enrichedAvatarUrl,
        isActive: cu.enabled,
        createdAt: ts,
        updatedAt: ts,
      };
      await putConfigItem(newStaff);
      upsertedStaff.push(newStaff);
    }
  }

  // Update sync metadata
  const newSyncTs = now();
  await putConfigItem({
    SK: 'META#STAFF_SYNC',
    entityType: 'META',
    lastSyncedAt: newSyncTs,
    syncedBy: auth.sub,
    userCount: cognitoUsers.length,
  });

  // Generate presigned URLs so the frontend can display any user's avatar
  await addAvatarPresignedUrls(upsertedStaff);

  return jsonResponse(200, { staff: upsertedStaff, lastSyncedAt: newSyncTs });
};

const handleProjects = async (
  method: string,
  segments: string[],
  body: Record<string, unknown>,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (method === 'GET' && segments.length === 0) {
    const items = await listConfigByPrefix('PROJECT#');
    const accessibleTeamIds = await getAccessibleTeamIds(auth);
    const filtered = filterProjectsByAccess(items, accessibleTeamIds);
    return jsonResponse(200, { projects: filtered });
  }

  if (method === 'POST' && segments.length === 0) {
    const { name } = body;
    if (!name) return errorResponse(400, 'Missing required field: name');
    const id = `proj-${randomUUID().slice(0, 8)}`;
    const item = {
      SK: `PROJECT#${id}`,
      entityType: 'PROJECT',
      id,
      name: String(name),
      description: body.description ? String(body.description) : undefined,
      color: body.color ? String(body.color) : undefined,
      status: body.status ? String(body.status) : 'active',
      ownerId: body.ownerId ? String(body.ownerId) : auth.sub,
      ownerName: body.ownerName ? String(body.ownerName) : (auth.name ?? auth.email ?? undefined),
      goals: body.goals ? String(body.goals) : undefined,
      startDate: body.startDate ? String(body.startDate) : undefined,
      endDate: body.endDate ? String(body.endDate) : undefined,
      boardIds: Array.isArray(body.boardIds) ? body.boardIds.map(String) : undefined,
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    };
    await putConfigItem(item);
    return jsonResponse(201, item);
  }

  if (method === 'PUT' && segments.length === 1) {
    const id = segments[0];
    const existing = await getConfigItem(`PROJECT#${id}`);
    if (!existing) return errorResponse(404, 'Project not found');
    // Sanitize boardIds if provided
    if (body.boardIds !== undefined) {
      body.boardIds = Array.isArray(body.boardIds) ? body.boardIds.map(String) : [];
    }
    const updated = { ...existing, ...body, id, updatedAt: now() };
    await putConfigItem(updated);
    return jsonResponse(200, updated);
  }

  if (method === 'DELETE' && segments.length === 1) {
    const existing = await getConfigItem(`PROJECT#${segments[0]}`);
    if (!existing) return errorResponse(404, 'Project not found');
    // Owner, unowned, or admin can delete
    const projectOwnerId = existing.ownerId as string | undefined;
    if (projectOwnerId && projectOwnerId !== auth.sub && !isAdmin(auth)) {
      return errorResponse(403, 'Only the project owner can delete this project');
    }
    await deleteConfigItem(`PROJECT#${segments[0]}`);
    return jsonResponse(200, { deleted: true });
  }

  return errorResponse(404, 'Route not found');
};

const handleCrmSettings = async (
  method: string,
  body: Record<string, unknown>,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (method === 'GET') {
    const item = await getConfigItem('CRM_CONFIG');
    return jsonResponse(200, item ?? {});
  }
  if (method === 'PUT') {
    if (!isAdmin(auth)) return errorResponse(403, 'Admin access required');
    const existing = await getConfigItem('CRM_CONFIG');
    const updated = { ...(existing ?? {}), ...body, SK: 'CRM_CONFIG', entityType: 'CRM_CONFIG', updatedAt: now() };
    await putConfigItem(updated);
    return jsonResponse(200, updated);
  }
  return errorResponse(404, 'Route not found');
};

const handleSupplierSettings = async (
  method: string,
  body: Record<string, unknown>,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (method === 'GET') {
    const item = await getConfigItem('SUPPLIER_CONFIG');
    return jsonResponse(200, item ?? {});
  }
  if (method === 'PUT') {
    if (!isAdmin(auth)) return errorResponse(403, 'Admin access required');
    const existing = await getConfigItem('SUPPLIER_CONFIG');
    const updated = {
      ...(existing ?? {}),
      ...body,
      SK: 'SUPPLIER_CONFIG',
      entityType: 'SUPPLIER_CONFIG',
      updatedAt: now(),
    };
    await putConfigItem(updated);
    return jsonResponse(200, updated);
  }
  return errorResponse(404, 'Route not found');
};

// ─── Main Handler ───────────────────────────────────────────────────────────────

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (!OPS_CONFIG_TABLE) throw new Error('Missing OPS_CONFIG_TABLE environment variable');

    if (event.requestContext.http?.method === 'OPTIONS') {
      return { statusCode: 200, headers: HEADERS, body: '' };
    }

    const auth = resolveAuthContext(event);
    if (!auth) return errorResponse(401, 'Unauthorized');

    const segments = buildPathSegments(event);
    // Expect segments: ['ops', 'config', ...rest]
    if (segments[0] !== 'ops' || segments[1] !== 'config') {
      return errorResponse(404, 'Not Found');
    }

    const method = event.requestContext.http?.method ?? 'GET';
    const body = parseBody(event);
    const rest = segments.slice(2); // everything after /ops/config/

    // GET /ops/config — bulk load all config
    if (method === 'GET' && rest.length === 0) {
      const config = await loadAllConfig();
      const accessibleTeamIds = await getAccessibleTeamIds(auth);

      // Auto-trigger staff sync on first access if staff has never been synced
      if (config.staff.length === 0 && !config.lastStaffSyncedAt) {
        try {
          await handleStaffSync(event, auth);
          const refreshed = await loadAllConfig();
          refreshed.projects = filterProjectsByAccess(refreshed.projects, accessibleTeamIds);
          return jsonResponse(200, refreshed);
        } catch (e) {
          // Don't break get_config if auto-sync fails — return what we have
          console.warn('Auto staff sync failed, returning config without staff:', (e as Error).message);
        }
      }

      config.projects = filterProjectsByAccess(config.projects, accessibleTeamIds);
      return jsonResponse(200, config);
    }

    // Route by entity type
    const entity = rest[0];
    const entitySegments = rest.slice(1);

    switch (entity) {
      case 'ticket-types':
        return await handleTicketTypes(method, entitySegments, body, auth);
      case 'statuses':
        return await handleStatuses(method, entitySegments, body, auth);
      case 'fields':
        return await handleFields(method, entitySegments, body, auth);
      case 'staff':
        // POST /ops/config/staff/sync — Cognito staff sync
        if (method === 'POST' && entitySegments[0] === 'sync') {
          return await handleStaffSync(event, auth);
        }
        return await handleStaff(method, entitySegments, body, auth);
      case 'projects':
        return await handleProjects(method, entitySegments, body, auth);
      case 'crm-settings':
        return await handleCrmSettings(method, body, auth);
      case 'supplier-settings':
        return await handleSupplierSettings(method, body, auth);
      default:
        return errorResponse(404, 'Route not found');
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const method = event.requestContext?.http?.method ?? 'UNKNOWN';
    const path = event.requestContext?.http?.path ?? event.rawPath ?? 'UNKNOWN';
    console.error(
      '[OPS-CONFIG-API] Unhandled error',
      JSON.stringify({
        method,
        path,
        error: err.message,
        name: err.name,
        stack: err.stack,
      })
    );
    return errorResponse(500, `Internal Server Error: ${err.message}`);
  }
};
