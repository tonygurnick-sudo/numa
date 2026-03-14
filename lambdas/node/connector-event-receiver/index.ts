import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { withPRM } from '../../../lib/prm-node/prm';

const REGION = process.env.REGION ?? 'us-east-1';

const CONNECTOR_EVENTS_TABLE = process.env.CONNECTOR_EVENTS_TABLE_NAME ?? '';
const CONNECTOR_EVENT_CONFIGS_TABLE = process.env.CONNECTOR_EVENT_CONFIGS_TABLE_NAME ?? '';
const OUTPUTS_BUCKET = process.env.OUTPUTS_BUCKET_NAME ?? '';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? '';
const CLIENT_NAME = process.env.CLIENT_NAME ?? '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';

const ddbClient = withPRM(DynamoDBClient, { region: REGION });
const dynamo = DynamoDBDocumentClient.from(ddbClient);
const s3 = withPRM(S3Client, { region: REGION });
const eventBridge = withPRM(EventBridgeClient, { region: REGION });

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,POST',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
};

const respond = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body),
});

/**
 * Decode a Gmail Pub/Sub push notification.
 *
 * Google Cloud Pub/Sub wraps the payload in:
 * {
 *   message: {
 *     data: "<base64>",       // base64-encoded JSON: { emailAddress, historyId }
 *     messageId: "...",
 *     publishTime: "..."
 *   },
 *   subscription: "..."
 * }
 */
interface GmailPubSubPayload {
  emailAddress: string;
  historyId: string;
}

interface PubSubMessage {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription?: string;
}

const decodeGmailPubSub = (body: string): { decoded: GmailPubSubPayload; raw: PubSubMessage } => {
  const raw: PubSubMessage = JSON.parse(body);
  const dataBuffer = Buffer.from(raw.message.data, 'base64');
  const decoded: GmailPubSubPayload = JSON.parse(dataBuffer.toString('utf8'));
  return { decoded, raw };
};

/**
 * Check whether the event config allows this event type to be processed.
 * Returns the config item if enabled, or null if disabled/missing.
 */
const getEventConfig = async (connectorId: string, eventType: string) => {
  try {
    const result = await dynamo.send(
      new GetCommand({
        TableName: CONNECTOR_EVENT_CONFIGS_TABLE,
        Key: {
          connector_id: connectorId,
          event_type: eventType,
        },
      })
    );

    if (!result.Item) {
      // No config means allow by default
      return { enabled: true, tags: [] as string[] };
    }

    return result.Item as { enabled: boolean; tags?: string[] };
  } catch (error) {
    console.error('Failed to fetch event config:', error);
    // Fail open — allow the event through if config lookup fails
    return { enabled: true, tags: [] as string[] };
  }
};

/**
 * Lambda handler for connector event receiver.
 *
 * Route: POST /webhooks/connector-events/{secret}
 *
 * Receives webhook events from external sources (e.g. Gmail Pub/Sub),
 * persists them to DynamoDB + S3, and emits a lightweight EventBridge event.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return respond(200, null);
  }

  const method = event.requestContext?.http?.method ?? '';
  const path = event.requestContext?.http?.path ?? '';

  // Route: POST /webhooks/connector-events/{secret}
  const match = path.match(/\/webhooks\/connector-events\/([^/]+)\/?$/);
  if (!match || method !== 'POST') {
    return respond(404, { error: 'Not found' });
  }

  const pathSecret = match[1];

  // Validate webhook secret
  if (!WEBHOOK_SECRET || pathSecret !== WEBHOOK_SECRET) {
    console.warn('Invalid webhook secret received');
    return respond(403, { error: 'Forbidden' });
  }

  try {
    const body = event.body ?? '';

    // Decode the Gmail Pub/Sub message
    const { decoded, raw } = decodeGmailPubSub(body);

    const connectorId = 'gmail';
    const eventType = 'new_email';
    const now = new Date();
    const timestamp = now.toISOString();
    const datePrefix = timestamp.slice(0, 10); // YYYY-MM-DD
    const eventId = crypto.randomUUID();

    // Check event config — if this event type is disabled, return silently
    const config = await getEventConfig(connectorId, eventType);
    if (!config.enabled) {
      console.log(`Event type ${connectorId}/${eventType} is disabled — skipping`);
      return respond(200, { status: 'skipped', reason: 'event_type_disabled' });
    }

    const tags = config.tags?.length ? config.tags : ['email', 'incoming'];
    const pk = `${connectorId}#${eventType}`;
    const sk = `${timestamp}#${eventId}`;
    const s3Key = `connector-events/${connectorId}/${datePrefix}/${eventId}.json`;

    const payloadSummary = {
      email_address: decoded.emailAddress,
      history_id: decoded.historyId,
    };

    // Write event metadata to DynamoDB
    await dynamo.send(
      new PutCommand({
        TableName: CONNECTOR_EVENTS_TABLE,
        Item: {
          PK: pk,
          SK: sk,
          connector_id: connectorId,
          event_type: eventType,
          tags,
          payload_summary: payloadSummary,
          s3_key: s3Key,
          created_at: timestamp,
          event_id: eventId,
        },
      })
    );

    // Write full payload to S3
    await s3.send(
      new PutObjectCommand({
        Bucket: OUTPUTS_BUCKET,
        Key: s3Key,
        ContentType: 'application/json',
        Body: JSON.stringify({
          connector_id: connectorId,
          event_type: eventType,
          event_id: eventId,
          received_at: timestamp,
          pubsub_message_id: raw.message.messageId,
          pubsub_publish_time: raw.message.publishTime,
          decoded_payload: decoded,
          raw_body: JSON.parse(body),
        }),
      })
    );

    // Emit EventBridge event
    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: `numa.connector.${connectorId}`,
            DetailType: 'connector.event',
            EventBusName: EVENT_BUS_NAME,
            Detail: JSON.stringify({
              connector_id: connectorId,
              event_type: eventType,
              event_id: eventId,
              client_name: CLIENT_NAME,
              timestamp,
              tags,
              refs: {
                dynamodb_pk: pk,
                dynamodb_sk: sk,
                s3_key: s3Key,
              },
              payload_summary: payloadSummary,
            }),
          },
        ],
      })
    );

    console.log(`Processed ${connectorId}/${eventType} event ${eventId} for ${decoded.emailAddress}`);

    return respond(200, { status: 'ok', event_id: eventId });
  } catch (error) {
    console.error('Failed to process connector event:', error);
    return respond(500, { error: 'Internal server error' });
  }
};
