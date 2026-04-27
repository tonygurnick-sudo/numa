import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';

const dynamo = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}), {
  marshallOptions: { removeUndefinedValues: true },
});

const SEARCH_INDEX_TABLE = process.env.SEARCH_INDEX_TABLE!;

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
// Upper bound on records scanned per query to keep worst-case read cost bounded
// when filter expressions match few items across a large partition.
const MAX_SCAN = 2000;

/** Shape of a record stored in the search index table. */
type SearchRecord = {
  PK: string;
  SK: string;
  type: string;
  entityId: string;
  title: string;
  subtitle?: string;
  searchableText: string;
  userId?: string;
  updatedAt: string;
  navigateTo: string;
};

type SearchResult = {
  type: string;
  entityId: string;
  title: string;
  subtitle?: string;
  navigateTo: string;
  updatedAt: string;
};

type AuthContext = { sub: string };

const jsonResponse = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(payload),
});

const errorResponse = (statusCode: number, message: string) => jsonResponse(statusCode, { error: message });

const parseJwt = (token: string): Record<string, unknown> => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const resolveAuthContext = (event: APIGatewayProxyEventV2): AuthContext | null => {
  const uc = (event as unknown as Record<string, unknown>).userContext as Record<string, unknown> | undefined;
  if (uc && typeof uc.sub === 'string') return { sub: uc.sub };

  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader) return null;
  const payload = parseJwt(String(authHeader).replace(/^Bearer\s+/i, ''));
  const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
  return sub ? { sub } : null;
};

const toResult = (item: SearchRecord): SearchResult => ({
  type: item.type,
  entityId: item.entityId,
  title: item.title,
  subtitle: item.subtitle,
  navigateTo: item.navigateTo,
  updatedAt: item.updatedAt,
});

/**
 * Query a single type partition (PK = `TYPE#{type}`), filtering on searchableText
 * and respecting per-user scoping (userId either absent or matching the caller).
 */
const queryByType = async (type: string, qLower: string, userSub: string, limit: number): Promise<SearchResult[]> => {
  const results: SearchResult[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  let scanned = 0;

  while (results.length < limit && scanned < MAX_SCAN) {
    const resp = await dynamo.send(
      new QueryCommand({
        TableName: SEARCH_INDEX_TABLE,
        KeyConditionExpression: 'PK = :pk',
        FilterExpression:
          '(attribute_not_exists(userId) OR userId = :uid)' + (qLower ? ' AND contains(searchableText, :q)' : ''),
        ExpressionAttributeValues: {
          ':pk': `TYPE#${type}`,
          ':uid': userSub,
          ...(qLower ? { ':q': qLower } : {}),
        },
        Limit: Math.min(limit * 5, 200),
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    for (const item of (resp.Items ?? []) as SearchRecord[]) {
      results.push(toResult(item));
      if (results.length >= limit) break;
    }

    scanned += resp.ScannedCount ?? 0;
    exclusiveStartKey = resp.LastEvaluatedKey;
    if (!exclusiveStartKey) break;
  }

  return results;
};

/**
 * Query the cross-type GSI (GSI1PK = 'ALL') sorted by updatedAt desc, filtering
 * on searchableText and per-user scoping.
 */
const queryAll = async (qLower: string, userSub: string, limit: number): Promise<SearchResult[]> => {
  const results: SearchResult[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  let scanned = 0;

  while (results.length < limit && scanned < MAX_SCAN) {
    const resp = await dynamo.send(
      new QueryCommand({
        TableName: SEARCH_INDEX_TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        FilterExpression:
          '(attribute_not_exists(userId) OR userId = :uid)' + (qLower ? ' AND contains(searchableText, :q)' : ''),
        ExpressionAttributeValues: {
          ':pk': 'ALL',
          ':uid': userSub,
          ...(qLower ? { ':q': qLower } : {}),
        },
        ScanIndexForward: false,
        Limit: Math.min(limit * 5, 200),
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    for (const item of (resp.Items ?? []) as SearchRecord[]) {
      results.push(toResult(item));
      if (results.length >= limit) break;
    }

    scanned += resp.ScannedCount ?? 0;
    exclusiveStartKey = resp.LastEvaluatedKey;
    if (!exclusiveStartKey) break;
  }

  return results;
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method === 'OPTIONS') return jsonResponse(200, null);
  if (method !== 'GET') return errorResponse(405, 'Method not allowed');

  const auth = resolveAuthContext(event);
  if (!auth) return errorResponse(401, 'Unauthorized');

  const qs = event.queryStringParameters ?? {};
  const qRaw = (qs.q ?? '').trim();
  const qLower = qRaw.toLowerCase();
  const type = (qs.type ?? '').trim();
  const limitRaw = Number(qs.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT;

  try {
    const results = type ? await queryByType(type, qLower, auth.sub, limit) : await queryAll(qLower, auth.sub, limit);

    return jsonResponse(200, { results, query: qRaw, type: type || null, limit });
  } catch (err) {
    console.error('[numa-search-api] Error:', err);
    return errorResponse(500, 'Internal server error');
  }
};
