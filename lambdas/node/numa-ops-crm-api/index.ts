import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

const OPS_CRM_TABLE = process.env.OPS_CRM_TABLE!;
const OPS_TABLE = process.env.OPS_TABLE!;
const OUTPUTS_BUCKET_NAME = process.env.OUTPUTS_BUCKET_NAME!;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CLIENT_NAME = process.env.CLIENT_NAME!;

// ─── Helpers ────────────────────────────────────────────────────────────────────

type AuthContext = { sub: string; email?: string; name?: string; groups: string[] };
type Item = Record<string, unknown>;

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

const parseJwt = (token: string): Item => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Item;
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

const buildPathSegments = (event: APIGatewayProxyEventV2): string[] => {
  const rawPath = event.requestContext.http?.path ?? event.rawPath ?? '';
  const trimmed = rawPath.replace(/^\/+/, '');
  const withoutApi = trimmed.startsWith('api/') ? trimmed.slice(4) : trimmed;
  return withoutApi.split('/').filter(Boolean);
};

const parseBody = (event: APIGatewayProxyEventV2): Item => {
  try {
    return JSON.parse(event.body ?? '{}') as Item;
  } catch {
    return {};
  }
};

const now = (): string => new Date().toISOString();

/**
 * Normalise a customFields value from a request body. Accepts a plain object
 * keyed by field id; returns `{}` for anything else (undefined, null, array,
 * primitive). Values are pass-through — the field's declared type lives in
 * the ops-config table and is enforced at the UI/tool layer.
 */
const sanitizeCustomFields = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, unknown>) };
};

// ─── DynamoDB Helpers ───────────────────────────────────────────────────────────

const getItem = async (pk: string, sk: string): Promise<Item | undefined> => {
  const result = await dynamo.send(new GetCommand({ TableName: OPS_CRM_TABLE, Key: { PK: pk, SK: sk } }));
  return result.Item as Item | undefined;
};

const putItem = async (item: Item): Promise<void> => {
  await dynamo.send(new PutCommand({ TableName: OPS_CRM_TABLE, Item: item }));
};

const deleteItem = async (pk: string, sk: string): Promise<void> => {
  await dynamo.send(new DeleteCommand({ TableName: OPS_CRM_TABLE, Key: { PK: pk, SK: sk } }));
};

const queryByPK = async (pk: string, skPrefix?: string): Promise<Item[]> => {
  const items: Item[] = [];
  let lastKey: Item | undefined;
  do {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: OPS_CRM_TABLE,
        KeyConditionExpression: skPrefix ? 'PK = :pk AND begins_with(SK, :sk)' : 'PK = :pk',
        ExpressionAttributeValues: skPrefix ? { ':pk': pk, ':sk': skPrefix } : { ':pk': pk },
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...((result.Items ?? []) as Item[]));
    lastKey = result.LastEvaluatedKey as Item | undefined;
  } while (lastKey);
  return items;
};

const queryGSI1 = async (
  gsi1pk: string,
  gsi1skPrefix?: string,
  limit?: number,
  cursor?: Item
): Promise<{ items: Item[]; lastKey?: Item }> => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: OPS_CRM_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: gsi1skPrefix ? 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)' : 'GSI1PK = :pk',
      ExpressionAttributeValues: gsi1skPrefix ? { ':pk': gsi1pk, ':sk': gsi1skPrefix } : { ':pk': gsi1pk },
      Limit: limit,
      ExclusiveStartKey: cursor,
    })
  );
  return { items: (result.Items ?? []) as Item[], lastKey: result.LastEvaluatedKey as Item | undefined };
};

const queryGSI1All = async (gsi1pk: string, gsi1skPrefix?: string): Promise<Item[]> => {
  const items: Item[] = [];
  let lastKey: Item | undefined;
  do {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: OPS_CRM_TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: gsi1skPrefix ? 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)' : 'GSI1PK = :pk',
        ExpressionAttributeValues: gsi1skPrefix ? { ':pk': gsi1pk, ':sk': gsi1skPrefix } : { ':pk': gsi1pk },
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...((result.Items ?? []) as Item[]));
    lastKey = result.LastEvaluatedKey as Item | undefined;
  } while (lastKey);
  return items;
};

const queryGSI2 = async (
  gsi2pk: string,
  gsi2skPrefix?: string,
  limit?: number,
  cursor?: Item
): Promise<{ items: Item[]; lastKey?: Item }> => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: OPS_CRM_TABLE,
      IndexName: 'GSI2',
      KeyConditionExpression: gsi2skPrefix ? 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)' : 'GSI2PK = :pk',
      ExpressionAttributeValues: gsi2skPrefix ? { ':pk': gsi2pk, ':sk': gsi2skPrefix } : { ':pk': gsi2pk },
      Limit: limit,
      ExclusiveStartKey: cursor,
    })
  );
  return { items: (result.Items ?? []) as Item[], lastKey: result.LastEvaluatedKey as Item | undefined };
};

// Check linked tickets for a customer/supplier via GSI2 on the ops table
const getLinkedTicketCount = async (entityType: string, entityId: string): Promise<number> => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: OPS_TABLE,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
      ExpressionAttributeValues: { ':pk': `${entityType}#${entityId}`, ':sk': 'TICKET#' },
      Select: 'COUNT',
    })
  );
  return result.Count ?? 0;
};

// ─── Customers ──────────────────────────────────────────────────────────────────

const handleCustomers = async (
  method: string,
  segments: string[],
  body: Item,
  auth: AuthContext,
  event: APIGatewayProxyEventV2
): Promise<ReturnType<typeof jsonResponse>> => {
  const qp = event.queryStringParameters ?? {};

  // ── Activities sub-route ────────────────────────────────────────────────────
  if (segments.length >= 2 && segments[1] === 'activities') {
    return handleActivities('CUSTOMER', segments[0], method, segments.slice(2), body, auth);
  }

  // ── Documents sub-route ─────────────────────────────────────────────────────
  if (segments.length >= 2 && segments[1] === 'documents') {
    return handleDocuments('CUSTOMER', segments[0], method, segments.slice(2), body, auth);
  }

  // GET /ops/customers — list customers
  if (method === 'GET' && segments.length === 0) {
    const limit = qp.limit ? parseInt(qp.limit, 10) : undefined;
    const cursor = qp.cursor ? JSON.parse(decodeURIComponent(qp.cursor)) : undefined;

    // Filter by lifecycle stage via GSI1
    if (qp.stage) {
      const { items, lastKey } = await queryGSI1('ENTITY#CUSTOMER', `STAGE#${qp.stage}#`, limit, cursor);
      const filtered = applyFilters(items, qp);
      return jsonResponse(200, {
        customers: filtered,
        cursor: lastKey ? encodeURIComponent(JSON.stringify(lastKey)) : undefined,
      });
    }

    // Filter by owner via GSI2
    if (qp.ownerId) {
      const { items, lastKey } = await queryGSI2(`CRM_OWNER#${qp.ownerId}`, 'CUSTOMER#', limit, cursor);
      const filtered = applyFilters(items, qp);
      return jsonResponse(200, {
        customers: filtered,
        cursor: lastKey ? encodeURIComponent(JSON.stringify(lastKey)) : undefined,
      });
    }

    // Default: query all customers via GSI1
    const items = await queryGSI1All('ENTITY#CUSTOMER');
    const filtered = applyFilters(items, qp);
    return jsonResponse(200, { customers: filtered });
  }

  // GET /ops/customers/{id} — get customer detail
  if (method === 'GET' && segments.length === 1) {
    const customerId = segments[0];
    const [meta, activities, documents] = await Promise.all([
      getItem(`CUSTOMER#${customerId}`, 'META'),
      queryByPK(`CUSTOMER#${customerId}`, 'ACTIVITY#'),
      queryByPK(`CUSTOMER#${customerId}`, 'DOC#'),
    ]);
    if (!meta) return errorResponse(404, 'Customer not found');

    const ticketCount = await getLinkedTicketCount('CUSTOMER', customerId);

    return jsonResponse(200, {
      customer: meta,
      activities,
      documents,
      ticketCount,
    });
  }

  // POST /ops/customers — create customer
  if (method === 'POST' && segments.length === 0) {
    const { companyName, industry, lifecycleStage, ownerId } = body;
    if (!companyName)
      return errorResponse(400, 'Missing required field: companyName (e.g. {"companyName": "Acme Corp"})');

    const id = randomUUID();
    const ts = now();
    const stage = lifecycleStage ? String(lifecycleStage) : 'stage-prospect';
    const owner = ownerId ? String(ownerId) : '';

    const item: Item = {
      PK: `CUSTOMER#${id}`,
      SK: 'META',
      GSI1PK: 'ENTITY#CUSTOMER',
      GSI1SK: `STAGE#${stage}#${id}`,
      GSI2PK: owner ? `CRM_OWNER#${owner}` : `CRM_OWNER#unassigned`,
      GSI2SK: `CUSTOMER#${id}`,
      entityType: 'CUSTOMER',
      id,
      companyName: String(companyName),
      industry: body.industry ? String(industry) : undefined,
      companySize: body.companySize ? String(body.companySize) : undefined,
      website: body.website ? String(body.website) : undefined,
      territory: body.territory ? String(body.territory) : undefined,
      lifecycleStage: stage,
      ownerId: owner || undefined,
      ownerName: body.ownerName ? String(body.ownerName) : undefined,
      flags: Array.isArray(body.flags) ? body.flags : [],
      source: body.source ? String(body.source) : undefined,
      contractStartDate: body.contractStartDate ? String(body.contractStartDate) : undefined,
      contractTerm: body.contractTerm ? String(body.contractTerm) : undefined,
      renewalDate: body.renewalDate ? String(body.renewalDate) : undefined,
      contractValue: typeof body.contractValue === 'number' ? body.contractValue : undefined,
      products: Array.isArray(body.products) ? body.products : undefined,
      productNotes: body.productNotes ? String(body.productNotes) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
      contacts: Array.isArray(body.contacts) ? body.contacts : [],
      customFields: sanitizeCustomFields(body.customFields),
      openTicketCount: 0,
      lastContactDate: undefined,
      createdBy: auth.sub,
      createdAt: ts,
      updatedAt: ts,
    };
    await putItem(item);
    return jsonResponse(201, item);
  }

  // PUT /ops/customers/{id} — update customer
  if (method === 'PUT' && segments.length === 1) {
    const id = segments[0];
    const existing = await getItem(`CUSTOMER#${id}`, 'META');
    if (!existing) return errorResponse(404, 'Customer not found');

    const stage = body.lifecycleStage ? String(body.lifecycleStage) : (existing.lifecycleStage as string);
    const owner = body.ownerId !== undefined ? String(body.ownerId ?? '') : ((existing.ownerId as string) ?? '');

    const updated: Item = {
      ...existing,
      ...body,
      PK: `CUSTOMER#${id}`,
      SK: 'META',
      GSI1PK: 'ENTITY#CUSTOMER',
      GSI1SK: `STAGE#${stage}#${id}`,
      GSI2PK: owner ? `CRM_OWNER#${owner}` : `CRM_OWNER#unassigned`,
      GSI2SK: `CUSTOMER#${id}`,
      id,
      lifecycleStage: stage,
      ownerId: owner || undefined,
      customFields:
        body.customFields !== undefined
          ? sanitizeCustomFields(body.customFields)
          : sanitizeCustomFields(existing.customFields),
      updatedAt: now(),
    };
    await putItem(updated);
    return jsonResponse(200, updated);
  }

  // DELETE /ops/customers/{id} — delete (check linked tickets)
  if (method === 'DELETE' && segments.length === 1) {
    const id = segments[0];
    const ticketCount = await getLinkedTicketCount('CUSTOMER', id);
    if (ticketCount > 0) {
      return errorResponse(409, `Cannot delete customer with ${ticketCount} linked ticket(s)`);
    }

    // Delete all sub-items (activities, documents)
    const allItems = await queryByPK(`CUSTOMER#${id}`);
    for (const item of allItems) {
      await deleteItem(String(item.PK), String(item.SK));
    }
    return jsonResponse(200, { deleted: true });
  }

  return errorResponse(404, 'Route not found');
};

// ─── Suppliers ──────────────────────────────────────────────────────────────────

const handleSuppliers = async (
  method: string,
  segments: string[],
  body: Item,
  auth: AuthContext,
  event: APIGatewayProxyEventV2
): Promise<ReturnType<typeof jsonResponse>> => {
  const qp = event.queryStringParameters ?? {};

  // ── Activities sub-route ────────────────────────────────────────────────────
  if (segments.length >= 2 && segments[1] === 'activities') {
    return handleActivities('SUPPLIER', segments[0], method, segments.slice(2), body, auth);
  }

  // ── Documents sub-route ─────────────────────────────────────────────────────
  if (segments.length >= 2 && segments[1] === 'documents') {
    return handleDocuments('SUPPLIER', segments[0], method, segments.slice(2), body, auth);
  }

  // GET /ops/suppliers — list suppliers
  if (method === 'GET' && segments.length === 0) {
    const limit = qp.limit ? parseInt(qp.limit, 10) : undefined;
    const cursor = qp.cursor ? JSON.parse(decodeURIComponent(qp.cursor)) : undefined;

    if (qp.stage) {
      const { items, lastKey } = await queryGSI1('ENTITY#SUPPLIER', `STAGE#${qp.stage}#`, limit, cursor);
      const filtered = applyFilters(items, qp);
      return jsonResponse(200, {
        suppliers: filtered,
        cursor: lastKey ? encodeURIComponent(JSON.stringify(lastKey)) : undefined,
      });
    }

    if (qp.ownerId) {
      const { items, lastKey } = await queryGSI2(`SUP_OWNER#${qp.ownerId}`, 'SUPPLIER#', limit, cursor);
      const filtered = applyFilters(items, qp);
      return jsonResponse(200, {
        suppliers: filtered,
        cursor: lastKey ? encodeURIComponent(JSON.stringify(lastKey)) : undefined,
      });
    }

    // Default: query all suppliers via GSI1
    const items = await queryGSI1All('ENTITY#SUPPLIER');
    const filtered = applyFilters(items, qp);
    return jsonResponse(200, { suppliers: filtered });
  }

  // GET /ops/suppliers/{id} — get supplier detail
  if (method === 'GET' && segments.length === 1) {
    const supplierId = segments[0];
    const [meta, activities, documents] = await Promise.all([
      getItem(`SUPPLIER#${supplierId}`, 'META'),
      queryByPK(`SUPPLIER#${supplierId}`, 'ACTIVITY#'),
      queryByPK(`SUPPLIER#${supplierId}`, 'DOC#'),
    ]);
    if (!meta) return errorResponse(404, 'Supplier not found');

    const ticketCount = await getLinkedTicketCount('SUPPLIER', supplierId);

    return jsonResponse(200, {
      supplier: meta,
      activities,
      documents,
      ticketCount,
    });
  }

  // POST /ops/suppliers — create supplier
  if (method === 'POST' && segments.length === 0) {
    const { companyName, lifecycleStage, ownerId } = body;
    if (!companyName)
      return errorResponse(400, 'Missing required field: companyName (e.g. {"companyName": "Acme Corp"})');

    const id = randomUUID();
    const ts = now();
    const stage = lifecycleStage ? String(lifecycleStage) : 'stage-prospect';
    const owner = ownerId ? String(ownerId) : '';

    const item: Item = {
      PK: `SUPPLIER#${id}`,
      SK: 'META',
      GSI1PK: 'ENTITY#SUPPLIER',
      GSI1SK: `STAGE#${stage}#${id}`,
      GSI2PK: owner ? `SUP_OWNER#${owner}` : `SUP_OWNER#unassigned`,
      GSI2SK: `SUPPLIER#${id}`,
      entityType: 'SUPPLIER',
      id,
      companyName: String(companyName),
      industry: body.industry ? String(body.industry) : undefined,
      companySize: body.companySize ? String(body.companySize) : undefined,
      website: body.website ? String(body.website) : undefined,
      territory: body.territory ? String(body.territory) : undefined,
      lifecycleStage: stage,
      ownerId: owner || undefined,
      ownerName: body.ownerName ? String(body.ownerName) : undefined,
      flags: Array.isArray(body.flags) ? body.flags : [],
      source: body.source ? String(body.source) : undefined,
      annualSpend: typeof body.annualSpend === 'number' ? body.annualSpend : undefined,
      paymentTerms: body.paymentTerms ? String(body.paymentTerms) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
      contacts: Array.isArray(body.contacts) ? body.contacts : [],
      customFields: sanitizeCustomFields(body.customFields),
      openTicketCount: 0,
      lastContactDate: undefined,
      createdBy: auth.sub,
      createdAt: ts,
      updatedAt: ts,
    };
    await putItem(item);
    return jsonResponse(201, item);
  }

  // PUT /ops/suppliers/{id} — update supplier
  if (method === 'PUT' && segments.length === 1) {
    const id = segments[0];
    const existing = await getItem(`SUPPLIER#${id}`, 'META');
    if (!existing) return errorResponse(404, 'Supplier not found');

    const stage = body.lifecycleStage ? String(body.lifecycleStage) : (existing.lifecycleStage as string);
    const owner = body.ownerId !== undefined ? String(body.ownerId ?? '') : ((existing.ownerId as string) ?? '');

    const updated: Item = {
      ...existing,
      ...body,
      PK: `SUPPLIER#${id}`,
      SK: 'META',
      GSI1PK: 'ENTITY#SUPPLIER',
      GSI1SK: `STAGE#${stage}#${id}`,
      GSI2PK: owner ? `SUP_OWNER#${owner}` : `SUP_OWNER#unassigned`,
      GSI2SK: `SUPPLIER#${id}`,
      id,
      lifecycleStage: stage,
      ownerId: owner || undefined,
      customFields:
        body.customFields !== undefined
          ? sanitizeCustomFields(body.customFields)
          : sanitizeCustomFields(existing.customFields),
      updatedAt: now(),
    };
    await putItem(updated);
    return jsonResponse(200, updated);
  }

  // DELETE /ops/suppliers/{id}
  if (method === 'DELETE' && segments.length === 1) {
    const id = segments[0];
    const ticketCount = await getLinkedTicketCount('SUPPLIER', id);
    if (ticketCount > 0) {
      return errorResponse(409, `Cannot delete supplier with ${ticketCount} linked ticket(s)`);
    }
    const allItems = await queryByPK(`SUPPLIER#${id}`);
    for (const item of allItems) {
      await deleteItem(String(item.PK), String(item.SK));
    }
    return jsonResponse(200, { deleted: true });
  }

  return errorResponse(404, 'Route not found');
};

// ─── Shared: Activities ─────────────────────────────────────────────────────────

const handleActivities = async (
  entityType: string,
  entityId: string,
  method: string,
  segments: string[],
  body: Item,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  const pkPrefix = `${entityType}#${entityId}`;

  // POST — create activity
  if (method === 'POST' && segments.length === 0) {
    const { type, date, summary } = body;
    if (!type || !summary) return errorResponse(400, 'Missing required fields: type, summary');

    const id = randomUUID();
    const actDate = date ? String(date) : now();
    const ts = now();

    const item: Item = {
      PK: pkPrefix,
      SK: `ACTIVITY#${actDate}#${id}`,
      entityType: 'ACTIVITY',
      id,
      parentId: entityId,
      parentType: entityType,
      type: String(type),
      direction: body.direction ? String(body.direction) : undefined,
      date: actDate,
      duration: typeof body.duration === 'number' ? body.duration : undefined,
      summary: String(summary),
      outcome: body.outcome ? String(body.outcome) : undefined,
      nextActionDate: body.nextActionDate ? String(body.nextActionDate) : undefined,
      nextActionType: body.nextActionType ? String(body.nextActionType) : undefined,
      staffId: auth.sub,
      staffName: auth.name ?? auth.email ?? auth.sub,
      source: 'manual',
      createdAt: ts,
    };
    await putItem(item);

    // Update lastContactDate on parent
    try {
      const parent = await getItem(pkPrefix, 'META');
      if (parent) {
        parent.lastContactDate = actDate;
        parent.updatedAt = ts;
        await putItem(parent);
      }
    } catch (e) {
      console.warn('Failed to update lastContactDate', (e as Error).message);
    }

    return jsonResponse(201, item);
  }

  // PUT — update activity
  if (method === 'PUT' && segments.length === 1) {
    const activityId = segments[0];
    const activities = await queryByPK(pkPrefix, 'ACTIVITY#');
    const existing = activities.find((a) => a.id === activityId);
    if (!existing) return errorResponse(404, 'Activity not found');

    const updated: Item = {
      ...existing,
      ...body,
      PK: existing.PK,
      SK: existing.SK,
      id: activityId,
      updatedAt: now(),
    };
    await putItem(updated);
    return jsonResponse(200, updated);
  }

  // DELETE — delete activity
  if (method === 'DELETE' && segments.length === 1) {
    const activityId = segments[0];
    const activities = await queryByPK(pkPrefix, 'ACTIVITY#');
    const existing = activities.find((a) => a.id === activityId);
    if (!existing) return errorResponse(404, 'Activity not found');
    await deleteItem(String(existing.PK), String(existing.SK));
    return jsonResponse(200, { deleted: true });
  }

  return errorResponse(404, 'Route not found');
};

// ─── Shared: Documents ──────────────────────────────────────────────────────────

const handleDocuments = async (
  entityType: string,
  entityId: string,
  method: string,
  segments: string[],
  body: Item,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  const pkPrefix = `${entityType}#${entityId}`;

  // POST — create document (with presigned URL)
  if (method === 'POST' && segments.length === 0) {
    const { name, type, fileName, contentType } = body;
    if (!name || !fileName) return errorResponse(400, 'Missing required fields: name, fileName');

    const id = randomUUID();
    const ts = now();
    const entityLower = entityType.toLowerCase();
    const s3Key = `ops/${entityLower}s/${entityId}/documents/${id}/${String(fileName)}`;

    // Generate presigned upload URL
    const s3 = withPRM(S3Client, {});
    const command = new PutObjectCommand({
      Bucket: OUTPUTS_BUCKET_NAME,
      Key: s3Key,
      ContentType: contentType ? String(contentType) : 'application/octet-stream',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uploadUrl = await getSignedUrl(s3 as any, command, { expiresIn: 900 });

    const item: Item = {
      PK: pkPrefix,
      SK: `DOC#${id}`,
      entityType: 'DOCUMENT',
      id,
      parentId: entityId,
      parentType: entityType,
      type: type ? String(type) : 'other',
      name: String(name),
      fileName: String(fileName),
      s3Key,
      s3Bucket: OUTPUTS_BUCKET_NAME,
      size: typeof body.size === 'number' ? body.size : undefined,
      notes: body.notes ? String(body.notes) : undefined,
      uploadedBy: auth.sub,
      uploadedAt: ts,
    };
    await putItem(item);
    return jsonResponse(201, { document: item, uploadUrl });
  }

  // DELETE — delete document
  if (method === 'DELETE' && segments.length === 1) {
    const docId = segments[0];
    const existing = await getItem(pkPrefix, `DOC#${docId}`);
    if (!existing) return errorResponse(404, 'Document not found');
    await deleteItem(pkPrefix, `DOC#${docId}`);
    return jsonResponse(200, { deleted: true });
  }

  return errorResponse(404, 'Route not found');
};

// ─── Filter Helper ──────────────────────────────────────────────────────────────

const applyFilters = (items: Item[], qp: Record<string, string | undefined>): Item[] => {
  let filtered = items;
  if (qp.territory) filtered = filtered.filter((i) => i.territory === qp.territory);
  if (qp.industry) filtered = filtered.filter((i) => i.industry === qp.industry);
  if (qp.flags) {
    const flagList = qp.flags.split(',');
    filtered = filtered.filter((i) => {
      const itemFlags = Array.isArray(i.flags) ? (i.flags as string[]) : [];
      return flagList.some((f) => itemFlags.includes(f));
    });
  }
  if (qp.search) {
    const term = qp.search.toLowerCase();
    filtered = filtered.filter((i) => {
      const name = String(i.companyName ?? '').toLowerCase();
      const notes = String(i.notes ?? '').toLowerCase();
      return name.includes(term) || notes.includes(term);
    });
  }
  return filtered;
};

// ─── Main Handler ───────────────────────────────────────────────────────────────

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (!OPS_CRM_TABLE) throw new Error('Missing OPS_CRM_TABLE environment variable');
    if (!OPS_TABLE) throw new Error('Missing OPS_TABLE environment variable');

    if (event.requestContext.http?.method === 'OPTIONS') {
      return { statusCode: 200, headers: HEADERS, body: '' };
    }

    const auth = resolveAuthContext(event);
    if (!auth) return errorResponse(401, 'Unauthorized');

    const segments = buildPathSegments(event);
    if (segments[0] !== 'ops') return errorResponse(404, 'Not Found');

    const method = event.requestContext.http?.method ?? 'GET';
    const body = parseBody(event);
    const resource = segments[1];
    const rest = segments.slice(2);

    switch (resource) {
      case 'customers':
        return handleCustomers(method, rest, body, auth, event);
      case 'suppliers':
        return handleSuppliers(method, rest, body, auth, event);
      default:
        return errorResponse(404, 'Route not found');
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const method = event.requestContext?.http?.method ?? 'UNKNOWN';
    const path = event.requestContext?.http?.path ?? event.rawPath ?? 'UNKNOWN';
    console.error(
      '[OPS-CRM-API] Unhandled error',
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
