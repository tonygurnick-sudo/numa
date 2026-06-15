/**
 * Numa App Inbox API Lambda (FEAT-130)
 *
 * Data + API layer for the V2 app framework inbox — lets work items exist
 * outside of a run. Items arrive in the inbox (fixtures today, email/webhook
 * ingestion in later roadmap cards), queue as `new`, and are dispatched to
 * v2-apps-api runs on demand.
 *
 * Item lifecycle: new → processing → ready (run completed)
 *                 new → failed (dispatch error) / processing → failed (run failed)
 *
 * Routes:
 *   GET    /api/inbox?appId=…            — List inbox items for an app (caller-scoped)
 *   GET    /api/inbox/{itemId}?appId=…   — Get a single item (syncs run status)
 *   PATCH  /api/inbox/{itemId}/status    — Set item status manually
 *   POST   /api/inbox/{itemId}/dispatch  — Dispatch item to a v2-apps-api run
 *
 * All requests are scoped by appId + caller user. Items are user-private —
 * cross-user shared scope (SCOPE_SHARED_APPS-style opt-in) is out of scope
 * for Card 1. The inbox table's partition key is the composite
 * `appUserKey` = `${appId}#${userId}`, so list reads paginate the caller's
 * items directly (no userId filter) and cross-user access is structurally
 * impossible — a caller can only address items in their own partition.
 *
 * Run execution is delegated to the v2-apps-api Lambda (create + start),
 * invoked directly with an API Gateway V2-shaped payload and the caller's
 * Authorization header passed through — the same pattern v2-apps-api uses to
 * invoke the workspace proxy. Run completion is discovered lazily: reading an
 * item whose status is `processing` triggers a GET of the underlying run
 * (which performs v2-apps-api's own S3 result check) and flips the item to
 * `ready`/`failed` accordingly.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { randomUUID } from 'node:crypto';
import { withPRM } from '../../../lib/prm-node/prm';
import { getAppRegistryEntry } from '../../../lib/app-registry';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const INBOX_TABLE = process.env.APP_INBOX_TABLE as string;
const V2_APPS_API_FUNCTION = process.env.V2_APPS_API_FUNCTION_NAME as string;

const dynamo = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}), {
  marshallOptions: { removeUndefinedValues: true },
});
const lambda = withPRM(LambdaClient, {});

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PATCH',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AuthContext = {
  sub: string;
  email?: string;
  groups: string[];
};

const parseJwt = (token: string): Record<string, unknown> => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return {};
  }
};

const resolveAuthContext = (event: APIGatewayProxyEventV2): AuthContext | null => {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader) return null;
  const token = String(authHeader).replace(/^Bearer\s+/i, '');
  const claims = parseJwt(token);
  const sub = typeof claims.sub === 'string' ? claims.sub : undefined;
  if (!sub) return null;
  const groups = Array.isArray(claims['cognito:groups'])
    ? (claims['cognito:groups'] as unknown[]).filter((g): g is string => typeof g === 'string')
    : [];
  return {
    sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    groups,
  };
};

const getAuthHeader = (event: APIGatewayProxyEventV2): string =>
  String(event.headers?.authorization || event.headers?.Authorization || '');

const jsonResponse = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(payload),
});

const errorResponse = (statusCode: number, message: string) => jsonResponse(statusCode, { error: message });

const parseBody = (event: APIGatewayProxyEventV2): Record<string, unknown> => {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('app-inbox-api parseBody failed', {
      isBase64Encoded: event.isBase64Encoded,
      bodyLength: event.body?.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
};

const buildPathSegments = (event: APIGatewayProxyEventV2): string[] => {
  const rawPath = event.requestContext.http?.path ?? event.rawPath ?? '';
  const trimmed = rawPath.replace(/^\/+/, '');
  const withoutApi = trimmed.startsWith('api/') ? trimmed.slice(4) : trimmed;
  return withoutApi.split('/').filter(Boolean);
};

/**
 * Composite partition key for the inbox table — `${appId}#${userId}`. appIds are
 * registry slugs and userIds are Cognito subs, neither of which contains `#`, so
 * the delimiter is unambiguous.
 */
const appUserKey = (appId: string, userId: string): string => `${appId}#${userId}`;

// ---------------------------------------------------------------------------
// Inbox item types
// ---------------------------------------------------------------------------

const ITEM_STATUSES = ['new', 'processing', 'ready', 'failed'] as const;
type ItemStatus = (typeof ITEM_STATUSES)[number];

const isItemStatus = (value: unknown): value is ItemStatus => ITEM_STATUSES.includes(value as ItemStatus);

interface InboxItemRecord {
  /** Composite partition key `${appId}#${userId}` — see appUserKey(). */
  appUserKey: string;
  appId: string;
  itemId: string;
  /** Owner — inbox items are user-private in Card 1 (no cross-user shared scope). */
  userId: string;
  /** How the item arrived — see AppSourceType in lib/app-registry.ts ('manual', 'email', …). */
  source: string;
  status: ItemStatus;
  /** S3 key of the raw work item payload (e.g. ingested email body). */
  payloadS3Key?: string;
  /** Populated on dispatch — the v2-app-runs record processing this item. */
  runId?: string;
  customerId?: string;
  customerEmail?: string;
  /** Optional business value of the item (e.g. quote/deal amount). */
  value?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// v2-apps-api invocation
// ---------------------------------------------------------------------------

/**
 * Invoke the v2-apps-api Lambda directly with an API Gateway V2-shaped
 * payload, passing the caller's Authorization header through so runs are
 * created and started as the dispatching user.
 */
const invokeV2AppsApi = async (
  method: string,
  path: string,
  authHeader: string,
  body?: Record<string, unknown>
): Promise<{ statusCode: number; json: Record<string, unknown> }> => {
  const payload = {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: {
      'content-type': 'application/json',
      authorization: authHeader,
    },
    requestContext: {
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'numa-app-inbox-api/1.0',
      },
      requestId: randomUUID(),
      routeKey: '$default',
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    isBase64Encoded: false,
  };

  const invokeResult = await lambda.send(
    new InvokeCommand({
      FunctionName: V2_APPS_API_FUNCTION,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );

  if (invokeResult.FunctionError) {
    const errorPayload = invokeResult.Payload ? Buffer.from(invokeResult.Payload).toString() : 'Unknown error';
    throw new Error(`v2-apps-api invoke failed: ${errorPayload}`);
  }

  const response = invokeResult.Payload ? JSON.parse(Buffer.from(invokeResult.Payload).toString()) : {};
  const statusCode = typeof response.statusCode === 'number' ? response.statusCode : 200;
  let json: Record<string, unknown> = {};
  if (typeof response.body === 'string' && response.body.length > 0) {
    try {
      json = JSON.parse(response.body);
    } catch {
      json = { raw: response.body };
    }
  }
  return { statusCode, json };
};

// ---------------------------------------------------------------------------
// Authorization + run-status sync helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the caller's item. Ownership is structural — the GetItem key is the
 * caller's composite partition (`${appId}#${userId}`), so another user's item is
 * simply not found (404), which also avoids leaking item existence. Returns the
 * item or an error response.
 */
const getOwnedItem = async (
  appId: string,
  itemId: string,
  auth: AuthContext
): Promise<InboxItemRecord | { statusCode: number; headers: typeof HEADERS; body: string }> => {
  const result = await dynamo.send(
    new GetCommand({ TableName: INBOX_TABLE, Key: { appUserKey: appUserKey(appId, auth.sub), itemId } })
  );
  if (!result.Item) return errorResponse(404, 'Inbox item not found');
  return result.Item as InboxItemRecord;
};

/**
 * If the item is processing, look up its run via v2-apps-api (which performs
 * the S3 result check and updates the run record) and flip the item to
 * ready/failed when the run has finished. Sync failures are non-fatal — the
 * item is returned unchanged and the next read retries.
 */
const syncItemRunStatus = async (item: InboxItemRecord, authHeader: string): Promise<InboxItemRecord> => {
  if (item.status !== 'processing' || !item.runId) return item;

  try {
    const { statusCode, json } = await invokeV2AppsApi('GET', `/api/v2-apps/runs/${item.runId}`, authHeader);
    if (statusCode !== 200) {
      console.warn('app-inbox-api run lookup failed', item.appId, item.itemId, item.runId, statusCode, json.error);
      return item;
    }

    const runStatus = json.status;
    if (runStatus !== 'COMPLETED' && runStatus !== 'FAILED') return item;

    const newStatus: ItemStatus = runStatus === 'COMPLETED' ? 'ready' : 'failed';
    const runError = typeof json.error === 'string' ? json.error : undefined;
    const now = new Date().toISOString();

    await dynamo.send(
      new UpdateCommand({
        TableName: INBOX_TABLE,
        Key: { appUserKey: item.appUserKey, itemId: item.itemId },
        UpdateExpression:
          'SET #status = :status, updatedAt = :now, completedAt = :now' + (runError ? ', #error = :error' : ''),
        ExpressionAttributeNames: { '#status': 'status', ...(runError ? { '#error': 'error' } : {}) },
        ExpressionAttributeValues: { ':status': newStatus, ':now': now, ...(runError ? { ':error': runError } : {}) },
      })
    );

    console.info('app-inbox-api item status synced from run', item.appId, item.itemId, item.runId, newStatus);
    return { ...item, status: newStatus, updatedAt: now, completedAt: now, ...(runError ? { error: runError } : {}) };
  } catch (err) {
    console.warn('app-inbox-api failed to sync run status', item.appId, item.itemId, item.runId, err);
    return item;
  }
};

// ---------------------------------------------------------------------------
// Inbox handlers
// ---------------------------------------------------------------------------

const handleListInbox = async (event: APIGatewayProxyEventV2, auth: AuthContext) => {
  const params = event.queryStringParameters || {};
  const appId = params.appId;
  const statusFilter = params.status;
  const limit = Math.min(parseInt(params.limit || '20', 10), 100);
  const nextToken = params.nextToken;

  if (!appId) {
    return errorResponse(400, 'Missing required query parameter: appId');
  }
  if (!getAppRegistryEntry(appId)) {
    return errorResponse(400, `Unknown appId: ${appId}`);
  }
  if (statusFilter !== undefined && !isItemStatus(statusFilter)) {
    return errorResponse(400, `Invalid status filter — must be one of: ${ITEM_STATUSES.join(', ')}`);
  }

  // Partition on the caller's composite key so Limit/pagination bound the
  // caller's own items — no userId FilterExpression. status is an optional
  // post-query filter, but bounded to one user's items in one app (small N),
  // so the residual filter-after-limit effect is negligible.
  const exprValues: Record<string, unknown> = { ':appUser': appUserKey(appId, auth.sub) };
  const exprNames: Record<string, string> = {};
  let filterExpression: string | undefined;
  if (statusFilter) {
    filterExpression = '#status = :status';
    exprNames['#status'] = 'status';
    exprValues[':status'] = statusFilter;
  }

  const result = await dynamo.send(
    new QueryCommand({
      TableName: INBOX_TABLE,
      IndexName: 'appUserKey-createdAt-index',
      KeyConditionExpression: 'appUserKey = :appUser',
      ...(filterExpression ? { FilterExpression: filterExpression } : {}),
      ExpressionAttributeValues: exprValues,
      ...(Object.keys(exprNames).length > 0 ? { ExpressionAttributeNames: exprNames } : {}),
      ScanIndexForward: false, // newest first
      Limit: limit,
      ...(nextToken ? { ExclusiveStartKey: JSON.parse(Buffer.from(nextToken, 'base64').toString()) } : {}),
    })
  );

  // Lazily sync processing items against their runs so completed work shows
  // as ready without requiring a per-item GET. Page size is capped at 100 and
  // most items won't be processing, so the fan-out is bounded.
  const authHeader = getAuthHeader(event);
  const items = await Promise.all(
    ((result.Items || []) as InboxItemRecord[]).map((item) => syncItemRunStatus(item, authHeader))
  );

  const response: Record<string, unknown> = {
    items,
    count: result.Count || 0,
  };
  if (result.LastEvaluatedKey) {
    response.nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
  }

  return jsonResponse(200, response);
};

const handleGetItem = async (itemId: string, auth: AuthContext, event: APIGatewayProxyEventV2) => {
  const appId = event.queryStringParameters?.appId;
  if (!appId) {
    return errorResponse(400, 'Missing required query parameter: appId');
  }

  const fetched = await getOwnedItem(appId, itemId, auth);
  if ('statusCode' in fetched) return fetched;

  const item = await syncItemRunStatus(fetched, getAuthHeader(event));
  return jsonResponse(200, item);
};

const handlePatchStatus = async (itemId: string, body: Record<string, unknown>, auth: AuthContext) => {
  const appId = typeof body.appId === 'string' ? body.appId : '';
  if (!appId) {
    return errorResponse(400, 'Missing required field: appId');
  }
  if (!isItemStatus(body.status)) {
    return errorResponse(400, `Invalid status — must be one of: ${ITEM_STATUSES.join(', ')}`);
  }
  const status = body.status;

  const fetched = await getOwnedItem(appId, itemId, auth);
  if ('statusCode' in fetched) return fetched;

  const now = new Date().toISOString();
  // Resetting to `new` re-arms the item for dispatch — clear the previous
  // attempt's run linkage and error so the next dispatch starts clean.
  const updateExpression =
    'SET #status = :status, updatedAt = :now' +
    (status === 'new' ? ' REMOVE runId, #error, dispatchedAt, completedAt' : '');

  // Ownership is structural (composite key partitions on the caller); the
  // condition just guards against patching an item that no longer exists.
  const result = await dynamo.send(
    new UpdateCommand({
      TableName: INBOX_TABLE,
      Key: { appUserKey: appUserKey(appId, auth.sub), itemId },
      UpdateExpression: updateExpression,
      ConditionExpression: 'attribute_exists(itemId)',
      ExpressionAttributeNames: { '#status': 'status', ...(status === 'new' ? { '#error': 'error' } : {}) },
      ExpressionAttributeValues: { ':status': status, ':now': now },
      ReturnValues: 'ALL_NEW',
    })
  );

  console.info('app-inbox-api item status updated', appId, itemId, status);
  return jsonResponse(200, result.Attributes);
};

const handleDispatch = async (
  itemId: string,
  body: Record<string, unknown>,
  auth: AuthContext,
  event: APIGatewayProxyEventV2
) => {
  const appId = typeof body.appId === 'string' ? body.appId : '';
  if (!appId) {
    return errorResponse(400, 'Missing required field: appId');
  }
  const registryEntry = getAppRegistryEntry(appId);
  if (!registryEntry) {
    return errorResponse(400, `Unknown appId: ${appId}`);
  }

  const fetched = await getOwnedItem(appId, itemId, auth);
  if ('statusCode' in fetched) return fetched;
  const item = fetched;

  if (item.status !== 'new') {
    return errorResponse(409, `Item is already ${item.status}${item.runId ? ` (runId: ${item.runId})` : ''}`);
  }

  // Claim the item first with a conditional update so concurrent dispatches
  // can't both create runs — losers get a 409.
  const claimedAt = new Date().toISOString();
  try {
    await dynamo.send(
      new UpdateCommand({
        TableName: INBOX_TABLE,
        Key: { appUserKey: appUserKey(appId, auth.sub), itemId },
        UpdateExpression: 'SET #status = :processing, dispatchedAt = :now, updatedAt = :now',
        ConditionExpression: '#status = :new',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':processing': 'processing',
          ':new': 'new',
          ':now': claimedAt,
        },
      })
    );
  } catch (err) {
    if (err && typeof err === 'object' && 'name' in err && err.name === 'ConditionalCheckFailedException') {
      return errorResponse(409, 'Item was already dispatched');
    }
    throw err;
  }

  console.info('app-inbox-api dispatching item', appId, itemId, auth.sub);

  const agentType = registryEntry.agents[0] || `${appId}-v2`;
  const promptParts = [
    `Process app inbox work item ${itemId} for the ${registryEntry.name} app.`,
    `Source: ${item.source || 'unknown'}.`,
  ];
  if (item.customerEmail || item.customerId) {
    promptParts.push(`Customer: ${[item.customerEmail, item.customerId].filter(Boolean).join(' / ')}.`);
  }
  if (item.payloadS3Key) {
    promptParts.push(`The work item payload is stored in S3 at: ${item.payloadS3Key}`);
  }

  const metadata: Record<string, string> = { inboxItemId: itemId };
  if (item.payloadS3Key) metadata.payloadS3Key = item.payloadS3Key;
  if (item.customerId) metadata.customerId = item.customerId;

  const authHeader = getAuthHeader(event);
  let runId: string | undefined;
  try {
    const createRes = await invokeV2AppsApi('POST', '/api/v2-apps/runs', authHeader, {
      appId,
      agentType,
      prompt: promptParts.join('\n'),
      name: `Inbox · ${item.customerEmail || item.customerId || itemId}`,
      options: { metadata },
    });
    if (createRes.statusCode !== 201 || typeof createRes.json.runId !== 'string') {
      throw new Error(`run create returned ${createRes.statusCode}: ${JSON.stringify(createRes.json)}`);
    }
    runId = createRes.json.runId;

    const startRes = await invokeV2AppsApi('POST', `/api/v2-apps/runs/${runId}/start`, authHeader);
    if (startRes.statusCode !== 200) {
      throw new Error(`run start returned ${startRes.statusCode}: ${JSON.stringify(startRes.json)}`);
    }
  } catch (err) {
    console.error('app-inbox-api dispatch failed', appId, itemId, runId, err);
    const failedAt = new Date().toISOString();
    await dynamo.send(
      new UpdateCommand({
        TableName: INBOX_TABLE,
        Key: { appUserKey: appUserKey(appId, auth.sub), itemId },
        // Keep the runId (if a run was created) for debugging the failure.
        UpdateExpression:
          'SET #status = :failed, #error = :error, updatedAt = :now' + (runId ? ', runId = :runId' : ''),
        ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
        ExpressionAttributeValues: {
          ':failed': 'failed',
          ':error': `Dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
          ':now': failedAt,
          ...(runId ? { ':runId': runId } : {}),
        },
      })
    );
    return errorResponse(502, 'Failed to dispatch inbox item');
  }

  const now = new Date().toISOString();
  await dynamo.send(
    new UpdateCommand({
      TableName: INBOX_TABLE,
      Key: { appUserKey: appUserKey(appId, auth.sub), itemId },
      UpdateExpression: 'SET runId = :runId, updatedAt = :now',
      ExpressionAttributeValues: { ':runId': runId, ':now': now },
    })
  );

  console.info('app-inbox-api item dispatched', appId, itemId, runId);
  return jsonResponse(200, { appId, itemId, runId, status: 'processing' });
};

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (event.requestContext.http?.method === 'OPTIONS') {
      return { statusCode: 200, headers: HEADERS, body: '' };
    }

    const auth = resolveAuthContext(event);
    if (!auth) return errorResponse(401, 'Unauthorized');

    if (!INBOX_TABLE || !V2_APPS_API_FUNCTION) {
      return errorResponse(500, 'Server configuration error: missing APP_INBOX_TABLE or V2_APPS_API_FUNCTION_NAME');
    }

    const segments = buildPathSegments(event);
    const method = event.requestContext.http?.method ?? 'GET';
    const body = parseBody(event);

    // Expected path: inbox/...
    if (segments[0] !== 'inbox') {
      return errorResponse(404, 'Not Found');
    }
    const rest = segments.slice(1);

    // GET /inbox?appId=… — list items
    if (method === 'GET' && rest.length === 0) {
      return handleListInbox(event, auth);
    }

    // GET /inbox/{itemId}?appId=… — get a single item
    if (method === 'GET' && rest.length === 1) {
      return handleGetItem(rest[0], auth, event);
    }

    // PATCH /inbox/{itemId}/status — set item status
    if (method === 'PATCH' && rest.length === 2 && rest[1] === 'status') {
      return handlePatchStatus(rest[0], body, auth);
    }

    // POST /inbox/{itemId}/dispatch — dispatch item to a run
    if (method === 'POST' && rest.length === 2 && rest[1] === 'dispatch') {
      return handleDispatch(rest[0], body, auth, event);
    }

    return errorResponse(404, 'Route not found');
  } catch (error) {
    console.error('app-inbox-api unhandled error', error);
    return errorResponse(500, 'Internal Server Error');
  }
};
