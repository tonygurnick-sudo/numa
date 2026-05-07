/**
 * Receiver lambda for Pipedream-delivered trigger events.
 *
 * Route: POST /webhooks/pipedream-events/{secret}
 *
 * Pipedream delivers events with these headers (verified empirically — see
 * dev-notes/tasks/pipedream-triggers/results/validate_delivery.json):
 *
 *   x-pd-signature: t={unix_ts},v1={hex_sha256}     ← Stripe-style HMAC
 *   x-pd-timestamp: 2026-05-01T05:17:03Z
 *   x-pd-emitter-id: dc_xxx                         ← deployed-trigger ID; our schedule lookup key
 *   x-pd-external-user-id: {client}_{cognitoSub}    ← cross-check against schedule.user_id
 *   x-pd-project-id: proj_xxx
 *   x-pd-environment: production
 *
 * Body: raw event payload from the SaaS (Slack message JSON, etc.) — no Pipedream envelope.
 *
 * IMPORTANT — Pipedream does NOT retry failed deliveries. Verified by running
 * probe_retry_policy.py against a 500-returning webhook for 6 minutes; only one
 * delivery arrived. So this handler MUST avoid 5xx responses where it can.
 * Strategy:
 *   - HMAC verification failure → 401 (deliberate auth rejection, nothing to retry)
 *   - Path-secret mismatch → 403
 *   - Schedule lookup miss (orphan dc_xxx) → log + persist + return 200 +
 *     emit a special EventBridge event so the dispatcher can clean up Pipedream
 *   - DDB/S3/EB write failure → log loudly, propagate 5xx as last resort
 */

import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const REGION = process.env.REGION ?? 'us-east-1';

const SCHEDULES_TABLE = process.env.AGENT_SCHEDULES_TABLE_NAME ?? '';
const SCHEDULES_DC_GSI_NAME = process.env.AGENT_SCHEDULES_DC_GSI_NAME ?? 'deployed-trigger-id-index';
const CONNECTOR_EVENTS_TABLE = process.env.CONNECTOR_EVENTS_TABLE_NAME ?? '';
const OUTPUTS_BUCKET = process.env.OUTPUTS_BUCKET_NAME ?? '';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? '';
const CLIENT_NAME = process.env.CLIENT_NAME ?? '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';

// Maximum age of x-pd-timestamp accepted, in seconds. Anything older is treated
// as a replay and rejected. Pipedream delivers within seconds, so 5 min is a
// generous ceiling that absorbs clock skew + brief network delays.
const MAX_TIMESTAMP_AGE_SECONDS = 5 * 60;

// Lazily initialised so unit tests can run without instantiating real clients.
let _ddbClient: DynamoDBDocumentClient | null = null;
let _s3Client: S3Client | null = null;
let _eventBridgeClient: EventBridgeClient | null = null;

const ddb = (): DynamoDBDocumentClient => {
  if (!_ddbClient) {
    _ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
  }
  return _ddbClient;
};

const s3 = (): S3Client => {
  if (!_s3Client) _s3Client = new S3Client({ region: REGION });
  return _s3Client;
};

const eb = (): EventBridgeClient => {
  if (!_eventBridgeClient) _eventBridgeClient = new EventBridgeClient({ region: REGION });
  return _eventBridgeClient;
};

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,POST',
  'Access-Control-Allow-Headers': 'Content-Type,x-pd-signature,x-pd-timestamp',
  'Content-Type': 'application/json',
};

const respond = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body),
});

/* ----------------------------------------------------------------------- *
 * HMAC verification — exported for unit testing.
 * ----------------------------------------------------------------------- */

export type SignatureVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'malformed_header' | 'bad_signature' | 'stale_timestamp' };

/**
 * Verify a Pipedream `x-pd-signature` header against a raw request body and
 * the per-trigger signing key.
 *
 * Header format: `t={unix_ts},v1={hex_sha256}`
 *
 * Verification:
 *   1. Parse `t` (unix seconds) and `v1` (hex SHA-256).
 *   2. Reject if `t` is older than MAX_TIMESTAMP_AGE_SECONDS (replay protection).
 *   3. Compute HMAC-SHA256 of `{t}.{rawBody}` against the signing key.
 *   4. Compare against `v1` using `timingSafeEqual` (constant-time).
 *
 * The signing key comes from the schedule record (set at deploy time from
 * Pipedream's deploy response). It is NEVER logged.
 */
export const verifyPipedreamSignature = (
  signatureHeader: string | undefined,
  rawBody: string,
  signingKey: string,
  options: { now?: number; maxAgeSeconds?: number } = {}
): SignatureVerifyResult => {
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    return { ok: false, reason: 'malformed_header' };
  }
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => {
      const idx = p.indexOf('=');
      return idx === -1 ? [p, ''] : [p.slice(0, idx).trim(), p.slice(idx + 1)];
    })
  );
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1 || !/^\d+$/.test(t)) {
    return { ok: false, reason: 'malformed_header' };
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const maxAge = options.maxAgeSeconds ?? MAX_TIMESTAMP_AGE_SECONDS;
  const ts = Number.parseInt(t, 10);
  if (Number.isNaN(ts) || Math.abs(now - ts) > maxAge) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  // signed payload = `{t}.{rawBody}` (Stripe-style)
  const expected = createHmac('sha256', signingKey).update(`${t}.${rawBody}`).digest('hex');

  // Constant-time compare. Lengths must match for timingSafeEqual.
  if (expected.length !== v1.length) {
    return { ok: false, reason: 'bad_signature' };
  }
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(v1, 'utf8');
    return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
};

/* ----------------------------------------------------------------------- *
 * Schedule lookup by deployed_trigger_id (dc_xxx) via GSI.
 * Exported for unit testing with injected client.
 * ----------------------------------------------------------------------- */

export type ScheduleLookupResult = {
  user_id: string;
  schedule_id: string;
  trigger_webhook_signing_key: string;
  trigger_app_slug: string;
  trigger_component_id: string;
};

export const lookupScheduleByDeployedTriggerId = async (
  deployedTriggerId: string,
  client: DynamoDBDocumentClient = ddb(),
  tableName: string = SCHEDULES_TABLE,
  gsiName: string = SCHEDULES_DC_GSI_NAME
): Promise<ScheduleLookupResult | null> => {
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: gsiName,
      KeyConditionExpression: '#dc = :dc',
      ExpressionAttributeNames: { '#dc': 'deployed_trigger_id' },
      ExpressionAttributeValues: { ':dc': deployedTriggerId },
      Limit: 1,
    })
  );
  const item = result.Items?.[0];
  if (!item) return null;
  // Schema: trigger.webhook_signing_key etc. live nested under `trigger`.
  // The GSI projection includes the `trigger` map in full.
  const trigger = (item.trigger ?? {}) as Record<string, unknown>;
  const signingKey = typeof trigger.webhook_signing_key === 'string' ? trigger.webhook_signing_key : '';
  const appSlug = typeof trigger.app_slug === 'string' ? trigger.app_slug : '';
  const componentId = typeof trigger.component_id === 'string' ? trigger.component_id : '';
  if (!signingKey || typeof item.user_id !== 'string' || typeof item.schedule_id !== 'string') {
    return null;
  }
  return {
    user_id: item.user_id,
    schedule_id: item.schedule_id,
    trigger_webhook_signing_key: signingKey,
    trigger_app_slug: appSlug,
    trigger_component_id: componentId,
  };
};

/* ----------------------------------------------------------------------- *
 * Header helpers
 * ----------------------------------------------------------------------- */

const headerValue = (headers: Record<string, string | undefined> | undefined, name: string): string | undefined => {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
};

/* ----------------------------------------------------------------------- *
 * Lambda handler
 * ----------------------------------------------------------------------- */

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return respond(200, null);
  }

  const method = event.requestContext?.http?.method ?? '';
  const path = event.requestContext?.http?.path ?? '';

  const match = path.match(/\/webhooks\/pipedream-events\/([^/]+)\/?$/);
  if (!match || method !== 'POST') {
    return respond(404, { error: 'Not found' });
  }

  // 1. Path-secret check. Per-client, env-injected.
  const pathSecret = match[1];
  if (!WEBHOOK_SECRET || pathSecret !== WEBHOOK_SECRET) {
    console.warn(JSON.stringify({ _name: 'WEBHOOK_SECRET_MISMATCH', path: '<redacted>' }));
    return respond(403, { error: 'Forbidden' });
  }

  const rawBody = event.body ?? '';
  const headers = event.headers as Record<string, string | undefined> | undefined;

  // 2. Pull the Pipedream-stamped headers we rely on.
  const sigHeader = headerValue(headers, 'x-pd-signature');
  const emitterId = headerValue(headers, 'x-pd-emitter-id');
  const externalUserId = headerValue(headers, 'x-pd-external-user-id');
  const projectId = headerValue(headers, 'x-pd-project-id');
  const pdTimestamp = headerValue(headers, 'x-pd-timestamp');

  if (!sigHeader || !emitterId || !externalUserId) {
    console.warn(
      JSON.stringify({
        _name: 'WEBHOOK_MISSING_HEADERS',
        has_sig: !!sigHeader,
        has_emitter: !!emitterId,
        has_external_user: !!externalUserId,
      })
    );
    return respond(400, { error: 'Missing required headers' });
  }

  // 3. Look up the schedule by emitter (dc_xxx).
  let schedule: ScheduleLookupResult | null;
  try {
    schedule = await lookupScheduleByDeployedTriggerId(emitterId);
  } catch (err) {
    console.error(
      JSON.stringify({
        _name: 'WEBHOOK_SCHEDULE_LOOKUP_FAILED',
        emitter_id: emitterId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    // Persistence failures here are exceptional — surface 5xx so we at least see them in logs.
    return respond(500, { error: 'Internal server error' });
  }

  if (!schedule) {
    // Orphan dc_xxx — the Pipedream side has a deployed trigger we don't know
    // about. Persist for forensics + emit cleanup event, return 200 (Pipedream
    // doesn't retry, so 200 is correct here regardless).
    await emitOrphanCleanupEvent(emitterId, externalUserId, projectId, pdTimestamp).catch((err) =>
      console.error(
        JSON.stringify({
          _name: 'WEBHOOK_ORPHAN_EMIT_FAILED',
          emitter_id: emitterId,
          error: err instanceof Error ? err.message : String(err),
        })
      )
    );
    console.warn(
      JSON.stringify({
        _name: 'WEBHOOK_ORPHAN_EVENT',
        emitter_id: emitterId,
        external_user_id: externalUserId,
      })
    );
    return respond(200, { status: 'orphan' });
  }

  // 4. HMAC verification using the per-trigger signing key from the schedule record.
  const sigResult = verifyPipedreamSignature(sigHeader, rawBody, schedule.trigger_webhook_signing_key);
  if (!sigResult.ok) {
    console.warn(
      JSON.stringify({
        _name: 'WEBHOOK_HMAC_FAILED',
        reason: sigResult.reason,
        emitter_id: emitterId,
        external_user_id: externalUserId,
        schedule_id: schedule.schedule_id,
      })
    );
    return respond(401, { error: 'Invalid signature' });
  }

  // 5. Defence-in-depth: cross-check x-pd-external-user-id matches schedule owner.
  if (externalUserId !== buildExpectedExternalUserId(schedule.user_id)) {
    console.warn(
      JSON.stringify({
        _name: 'WEBHOOK_USER_MISMATCH',
        emitter_id: emitterId,
        external_user_id: externalUserId,
        schedule_user_id: schedule.user_id,
        schedule_id: schedule.schedule_id,
      })
    );
    return respond(401, { error: 'User mismatch' });
  }

  // 6. Persist + emit. From here we follow the existing connector-event pattern.
  try {
    await persistAndEmit({
      schedule,
      rawBody,
      pdTimestamp,
      projectId,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        _name: 'WEBHOOK_PERSIST_FAILED',
        schedule_id: schedule.schedule_id,
        emitter_id: emitterId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return respond(500, { error: 'Internal server error' });
  }

  return respond(200, { status: 'ok' });
};

/* ----------------------------------------------------------------------- *
 * The external_user_id we passed to Pipedream at deploy time is
 * `{CLIENT_NAME}_{schedule.user_id}`. Mirror that for cross-check.
 * ----------------------------------------------------------------------- */
const buildExpectedExternalUserId = (userId: string): string => {
  return CLIENT_NAME ? `${CLIENT_NAME}_${userId}` : userId;
};

/* ----------------------------------------------------------------------- *
 * Persistence — DDB + S3 + EventBridge.
 * Mirrors the existing connector-event-receiver pattern.
 * ----------------------------------------------------------------------- */

type PersistArgs = {
  schedule: ScheduleLookupResult;
  rawBody: string;
  pdTimestamp: string | undefined;
  projectId: string | undefined;
};

const persistAndEmit = async (args: PersistArgs): Promise<void> => {
  const { schedule, rawBody, pdTimestamp, projectId } = args;
  const now = new Date();
  const timestamp = now.toISOString();
  const datePrefix = timestamp.slice(0, 10);
  const eventId = crypto.randomUUID();

  const connectorId = 'pipedream';
  const eventType = `${schedule.trigger_app_slug}.${schedule.trigger_component_id}`;
  const pk = `${connectorId}#${eventType}`;
  const sk = `${timestamp}#${eventId}`;
  const s3Key = `connector-events/${connectorId}/${schedule.trigger_app_slug}/${datePrefix}/${eventId}.json`;

  // Best-effort parse of body into JSON so payload_summary is readable in DDB.
  let parsedPayload: unknown = undefined;
  try {
    parsedPayload = JSON.parse(rawBody);
  } catch {
    // leave undefined — raw body still goes to S3
  }

  const payloadSummary = summarizePayload(parsedPayload);

  await ddb().send(
    new PutCommand({
      TableName: CONNECTOR_EVENTS_TABLE,
      Item: {
        pk,
        sk,
        connector_id: connectorId,
        event_type: eventType,
        app_slug: schedule.trigger_app_slug,
        component_id: schedule.trigger_component_id,
        deployed_trigger_id: pk,
        schedule_id: schedule.schedule_id,
        user_id: schedule.user_id,
        payload_summary: payloadSummary,
        s3_key: s3Key,
        created_at: timestamp,
        event_id: eventId,
      },
    })
  );

  await s3().send(
    new PutObjectCommand({
      Bucket: OUTPUTS_BUCKET,
      Key: s3Key,
      ContentType: 'application/json',
      Body: JSON.stringify({
        connector_id: connectorId,
        event_type: eventType,
        event_id: eventId,
        received_at: timestamp,
        pd_timestamp: pdTimestamp ?? null,
        pd_project_id: projectId ?? null,
        schedule_id: schedule.schedule_id,
        user_id: schedule.user_id,
        app_slug: schedule.trigger_app_slug,
        component_id: schedule.trigger_component_id,
        decoded_payload: parsedPayload ?? null,
        raw_body: rawBody,
      }),
    })
  );

  await eb().send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'numa.connector.pipedream',
          DetailType: 'connector.event',
          EventBusName: EVENT_BUS_NAME,
          Detail: JSON.stringify({
            connector_id: connectorId,
            event_type: eventType,
            event_id: eventId,
            client_name: CLIENT_NAME,
            timestamp,
            schedule_id: schedule.schedule_id,
            user_id: schedule.user_id,
            app_slug: schedule.trigger_app_slug,
            component_id: schedule.trigger_component_id,
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

  console.log(
    JSON.stringify({
      _name: 'WEBHOOK_PERSISTED',
      connector_id: connectorId,
      event_type: eventType,
      event_id: eventId,
      schedule_id: schedule.schedule_id,
    })
  );
};

/**
 * Best-effort summary suitable for DDB attribute storage. Strips large
 * fields (rich_text blocks, files arrays) to keep the row small while
 * preserving the headline fields the dispatcher uses for filtering and
 * the runs feed uses for display.
 */
const summarizePayload = (payload: unknown): Record<string, unknown> => {
  if (!payload || typeof payload !== 'object') return {};
  const p = payload as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  // Slack-shape fields commonly useful in summaries.
  for (const k of ['type', 'user', 'channel', 'channel_name', 'team', 'ts', 'event_ts', 'client_msg_id']) {
    if (k in p) summary[k] = p[k];
  }
  // Truncate text to 200 chars max.
  if (typeof p.text === 'string') {
    summary.text = p.text.length > 200 ? `${p.text.slice(0, 200)}…` : p.text;
  }
  return summary;
};

/**
 * For orphan emitters: emit an EventBridge event the dispatcher can hook to
 * delete the unmatched dc_xxx from Pipedream.
 */
const emitOrphanCleanupEvent = async (
  emitterId: string,
  externalUserId: string,
  projectId: string | undefined,
  pdTimestamp: string | undefined
): Promise<void> => {
  await eb().send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'numa.connector.pipedream',
          DetailType: 'connector.orphan',
          EventBusName: EVENT_BUS_NAME,
          Detail: JSON.stringify({
            connector_id: 'pipedream',
            event_type: 'orphan_emitter',
            client_name: CLIENT_NAME,
            deployed_trigger_id: emitterId,
            external_user_id: externalUserId,
            pd_project_id: projectId ?? null,
            pd_timestamp: pdTimestamp ?? null,
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    })
  );
};
