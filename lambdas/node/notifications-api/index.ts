import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { validateUpdateNotificationPayload, type EventNotification } from '../../../lib/notification-schemas';

const REGION = process.env.REGION ?? 'us-east-1';
const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE_NAME ?? '';

const dynamo = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, { region: REGION }), {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

type AuthContext = {
  sub: string;
  email?: string;
  name?: string;
  groups: string[];
};

const parseJwt = (token: string): Record<string, unknown> => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const parseAuthContext = (event: APIGatewayProxyEventV2): AuthContext | null => {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader) return null;
  const token = String(authHeader).replace(/^Bearer\s+/i, '');
  const payload = parseJwt(token);
  const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
  if (!sub) return null;
  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const name = typeof payload.name === 'string' ? payload.name : undefined;
  const groups = Array.isArray(payload['cognito:groups'])
    ? (payload['cognito:groups'] as unknown[]).filter((g): g is string => typeof g === 'string')
    : [];
  return { sub, email, name, groups };
};

const respond = (statusCode: number, payload: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: HEADERS,
  body: payload !== undefined ? JSON.stringify(payload) : '',
});

const ensureConfigured = (): boolean => Boolean(NOTIFICATIONS_TABLE);

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return respond(200, null);
  }

  if (!ensureConfigured()) {
    return respond(500, { error: 'Notifications not configured' });
  }

  const auth = parseAuthContext(event);
  if (!auth) {
    return respond(401, { error: 'Unauthorized' });
  }

  try {
    const method = event.requestContext?.http?.method ?? 'GET';
    const path = event.requestContext?.http?.path ?? '';

    if (method === 'GET' && /\/notifications\/?$/.test(path)) {
      const notifications = await listNotifications(auth.sub);
      return respond(200, { notifications });
    }

    if (method === 'GET' && /\/notifications\/unread-count\/?$/.test(path)) {
      const count = await getUnreadCount(auth.sub);
      return respond(200, { count });
    }

    const idMatch = path.match(/\/notifications\/([^/]+)$/);
    if (method === 'PUT' && idMatch) {
      const body = JSON.parse(event.body || '{}');
      const updated = await updateNotification(auth, decodeURIComponent(idMatch[1]), body);
      return respond(200, updated);
    }

    if (method === 'DELETE' && idMatch) {
      await deleteNotification(auth, decodeURIComponent(idMatch[1]));
      return respond(200, { ok: true });
    }

    return respond(404, { error: 'Not found' });
  } catch (error) {
    console.error('notifications-api error', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return respond(message.startsWith('Invalid') ? 400 : 500, { error: message });
  }
};

const listNotifications = async (userId: string): Promise<EventNotification[]> => {
  const allItems: EventNotification[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  // Paginate through all results (DynamoDB returns max 1MB per query)
  do {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: NOTIFICATIONS_TABLE,
        KeyConditionExpression: 'user_id = :u',
        ExpressionAttributeValues: {
          ':u': userId,
        },
        ExclusiveStartKey: lastEvaluatedKey,
        // Note: DynamoDB sorts by notification_id (UUID), not time.
        // Frontend sorts by created_at for correct chronological order.
        // TTL auto-cleans notifications after 90 days.
      }),
    );
    allItems.push(...((result.Items || []) as EventNotification[]));
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return allItems;
};

const getUnreadCount = async (userId: string): Promise<number> => {
  let totalCount = 0;
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  // Paginate through all results to get accurate count
  do {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: NOTIFICATIONS_TABLE,
        KeyConditionExpression: 'user_id = :u',
        FilterExpression: '#status = :unread',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':u': userId,
          ':unread': 'unread',
        },
        Select: 'COUNT',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    totalCount += result.Count || 0;
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return totalCount;
};

const updateNotification = async (
  auth: AuthContext,
  notificationId: string,
  payload: unknown,
): Promise<EventNotification | undefined> => {
  const validatedPayload = validateUpdateNotificationPayload(payload);

  let updateExpression = 'SET #status = :status';
  const expressionAttributeNames = { '#status': 'status' };
  const expressionAttributeValues: Record<string, unknown> = { ':status': validatedPayload.status };

  if (validatedPayload.status === 'read') {
    updateExpression = `${updateExpression}, read_at = :readAt`;
    expressionAttributeValues[':readAt'] = Date.now();
  }

  const result = await dynamo.send(
    new UpdateCommand({
      TableName: NOTIFICATIONS_TABLE,
      Key: {
        user_id: auth.sub,
        notification_id: notificationId,
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
      ConditionExpression: 'attribute_exists(user_id) AND attribute_exists(notification_id)',
    }),
  );

  return result.Attributes as EventNotification | undefined;
};

const deleteNotification = async (auth: AuthContext, notificationId: string): Promise<void> => {
  await dynamo.send(
    new DeleteCommand({
      TableName: NOTIFICATIONS_TABLE,
      Key: {
        user_id: auth.sub,
        notification_id: notificationId,
      },
      ConditionExpression: 'attribute_exists(user_id) AND attribute_exists(notification_id)',
    }),
  );
};
