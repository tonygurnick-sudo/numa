import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { withPRM } from '../../../lib/prm-node/prm';

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

// ─── Helpers ────────────────────────────────────────────────────────────────────

type AuthContext = { sub: string; email?: string; name?: string; groups: string[] };

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
  };

  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const response = await dynamo.send(
      new QueryCommand({
        TableName: OPS_CONFIG_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'CONFIG' },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
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
    }

    lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

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
    }),
  );
  return (response.Items ?? []) as Record<string, unknown>[];
};

// ─── Route Handlers ─────────────────────────────────────────────────────────────

const handleTicketTypes = async (
  method: string,
  segments: string[],
  body: Record<string, unknown>,
  auth: AuthContext,
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
    if (!name || !prefix || !icon || !color)
      return errorResponse(400, 'Missing required fields: name, prefix, icon, color');

    const p = String(prefix).toUpperCase();
    if (!/^[A-Z0-9]{2,6}$/.test(p)) return errorResponse(400, 'Prefix must be 2-6 uppercase alphanumeric characters');
    if (RESERVED_PREFIXES.has(p)) return errorResponse(400, 'Prefix conflicts with a reserved key');

    // Check uniqueness
    const existing = await listConfigByPrefix('TICKET_TYPE#');
    if (existing.some((t) => (t.prefix as string)?.toUpperCase() === p)) {
      return errorResponse(409, 'Prefix already in use by another ticket type');
    }

    const id = `tt-${randomUUID().slice(0, 8)}`;
    const item = {
      SK: `TICKET_TYPE#${id}`,
      entityType: 'TICKET_TYPE',
      id,
      name: String(name),
      prefix: p,
      icon: String(icon),
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
  auth: AuthContext,
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
  auth: AuthContext,
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

  return errorResponse(404, 'Route not found');
};

const handleStaff = async (
  method: string,
  segments: string[],
  body: Record<string, unknown>,
  auth: AuthContext,
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

const handleProjects = async (
  method: string,
  segments: string[],
  body: Record<string, unknown>,
  auth: AuthContext,
): Promise<ReturnType<typeof jsonResponse>> => {
  if (method === 'GET' && segments.length === 0) {
    const items = await listConfigByPrefix('PROJECT#');
    return jsonResponse(200, { projects: items });
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
    const updated = { ...existing, ...body, id, updatedAt: now() };
    await putConfigItem(updated);
    return jsonResponse(200, updated);
  }

  if (method === 'DELETE' && segments.length === 1 && isAdmin(auth)) {
    await deleteConfigItem(`PROJECT#${segments[0]}`);
    return jsonResponse(200, { deleted: true });
  }

  return errorResponse(404, 'Route not found');
};

const handleCrmSettings = async (
  method: string,
  body: Record<string, unknown>,
  auth: AuthContext,
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
  auth: AuthContext,
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
      return jsonResponse(200, config);
    }

    // Route by entity type
    const entity = rest[0];
    const entitySegments = rest.slice(1);

    switch (entity) {
      case 'ticket-types':
        return handleTicketTypes(method, entitySegments, body, auth);
      case 'statuses':
        return handleStatuses(method, entitySegments, body, auth);
      case 'fields':
        return handleFields(method, entitySegments, body, auth);
      case 'staff':
        return handleStaff(method, entitySegments, body, auth);
      case 'projects':
        return handleProjects(method, entitySegments, body, auth);
      case 'crm-settings':
        return handleCrmSettings(method, body, auth);
      case 'supplier-settings':
        return handleSupplierSettings(method, body, auth);
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
      }),
    );
    return errorResponse(500, `Internal Server Error: ${err.message}`);
  }
};
