/**
 * Connector Event Dispatcher — Routes connector events (e.g. Gmail new email)
 * to user-defined Automation event triggers.
 *
 * Triggered by EventBridge rule on the connector events bus. For each event:
 *   1. Resolve the user from the connector's connected email
 *   2. Refresh the user's Gmail OAuth token via the company OAuth client
 *   3. Use Gmail History API to fetch any new messages since the last
 *      processed historyId stored on the connector record
 *   4. Normalize each message into an `email` object
 *   5. Query the user's event-trigger schedules and evaluate filters
 *   6. For each match, invoke the agent-schedule-runner with an EVENT payload
 *   7. Persist the new historyId watermark on the connector record
 */

import type { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { withPRM } from '../../../lib/prm-node/prm';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REGEX_LENGTH = 200;
const LOG_PREFIX = '[DISPATCHER]';

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const ddbDoc = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}), {
  marshallOptions: { removeUndefinedValues: true },
});
const secretsManager = withPRM(SecretsManagerClient, {});
const lambdaClient = withPRM(LambdaClient, {});

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const DATA_CONNECTORS_TABLE = process.env.DATA_CONNECTORS_TABLE_NAME ?? '';
const SCHEDULES_TABLE = process.env.AGENT_SCHEDULES_TABLE_NAME ?? '';
const RUNNER_FUNCTION_NAME = process.env.AGENT_SCHEDULE_RUNNER_FUNCTION_NAME ?? '';
const CLIENT_NAME = process.env.CLIENT_NAME ?? '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectorEventDetail {
  connector_id: string;
  event_type: string;
  event_id: string;
  client_name: string;
  timestamp: string;
  payload_summary: {
    email_address?: string;
    history_id?: string;
  };
}

interface EventBridgeEvent {
  detail: ConnectorEventDetail;
  source: string;
  'detail-type': string;
}

interface VaultData {
  secrets: Record<string, VaultEntry>;
  metadata?: Record<string, unknown>;
  _compressed?: boolean;
  _data?: string;
}
interface VaultEntry {
  fields?: Record<string, string>;
  [key: string]: unknown;
}

interface NormalizedEmail {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  has_attachment: boolean;
  received_at: string;
}

type FilterField = 'sender' | 'subject' | 'to' | 'body' | 'has_attachment';
type FilterOp = 'contains' | 'equals' | 'not_contains' | 'matches';
interface EmailFilter {
  field: FilterField;
  op: FilterOp;
  value: string;
}

interface ScheduleRecord {
  user_id: string;
  schedule_id: string;
  status: string;
  trigger_type?: string;
  trigger?: {
    source: string;
    event: string;
    filters?: EmailFilter[];
    filter_logic?: 'all' | 'any';
  };
}

// ---------------------------------------------------------------------------
// Fetch with timeout helper
// ---------------------------------------------------------------------------

const fetchWithTimeout = async (url: string, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

// ---------------------------------------------------------------------------
// Retry helper (exponential backoff for transient errors)
// ---------------------------------------------------------------------------

const fetchWithRetry = async (url: string, init?: RequestInit, maxRetries = 3): Promise<Response> => {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetchWithTimeout(url, init);
    if (res.ok || (res.status < 500 && res.status !== 429)) return res;
    if (attempt < maxRetries) {
      const delay = Math.min(1000 * 2 ** attempt, 8000);
      console.warn(`${LOG_PREFIX} Retrying ${url} after ${res.status} (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, delay));
    } else {
      return res;
    }
  }
  // Unreachable, but satisfies TS
  throw new Error('Retry exhausted');
};

// ---------------------------------------------------------------------------
// Vault helpers (mirror gmail-watch-manager)
// ---------------------------------------------------------------------------

const readVault = async (secretId: string): Promise<VaultData | null> => {
  try {
    const res = await secretsManager.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!res.SecretString) return null;
    let parsed = JSON.parse(res.SecretString) as VaultData;
    if (parsed._compressed && parsed._data) {
      const { gunzipSync } = await import('zlib');
      const decompressed = gunzipSync(Buffer.from(parsed._data, 'base64')).toString('utf-8');
      parsed = JSON.parse(decompressed) as VaultData;
    }
    return parsed;
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to read vault ${secretId}`, err);
    return null;
  }
};

const getCompanyGoogleClient = async (): Promise<{ clientId: string; clientSecret: string } | null> => {
  const v = await readVault(`${CLIENT_NAME}/vault/company`);
  const fields = v?.secrets?.['oauth-client-google']?.fields;
  if (!fields?.client_id || !fields?.client_secret) return null;
  return { clientId: fields.client_id, clientSecret: fields.client_secret };
};

const getUserGmailRefresh = async (userSub: string): Promise<{ refreshToken: string; email?: string } | null> => {
  const v = await readVault(`${CLIENT_NAME}/vault/users/${userSub}`);
  const fields = v?.secrets?.['oauth-gmail']?.fields;
  if (!fields?.refresh_token) return null;
  return { refreshToken: fields.refresh_token, email: fields.email };
};

const refreshGoogleAccessToken = async (
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string | null> => {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    console.error(`${LOG_PREFIX} Token refresh failed with status ${res.status}`);
    return null;
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
};

// ---------------------------------------------------------------------------
// Connector record helpers
// ---------------------------------------------------------------------------

interface ConnectorRecord {
  user_id: string;
  connector_id: string;
  connected_email?: string;
  last_history_id?: string;
}

// NOTE: Table key is (user_id, connector_id). Without a GSI on connected_email
// we must Scan. ProjectionExpression keeps the read units minimal.
const findConnectorByEmail = async (connectorId: string, email: string): Promise<ConnectorRecord | null> => {
  const res = await ddbDoc.send(
    new ScanCommand({
      TableName: DATA_CONNECTORS_TABLE,
      FilterExpression: 'connector_id = :cid AND connected_email = :email',
      ExpressionAttributeValues: { ':cid': connectorId, ':email': email },
      ProjectionExpression: 'user_id, connector_id, connected_email, last_history_id',
      Limit: 1000,
    })
  );
  const item = (res.Items || [])[0] as ConnectorRecord | undefined;
  return item ?? null;
};

const updateConnectorWatermark = async (record: ConnectorRecord, newHistoryId: string): Promise<void> => {
  await ddbDoc.send(
    new UpdateCommand({
      TableName: DATA_CONNECTORS_TABLE,
      Key: { user_id: record.user_id, connector_id: record.connector_id },
      UpdateExpression: 'SET last_history_id = :h, updated_at = :ts',
      ExpressionAttributeValues: { ':h': newHistoryId, ':ts': Date.now() },
    })
  );
};

// ---------------------------------------------------------------------------
// Gmail History + message fetch
// ---------------------------------------------------------------------------

interface GmailHistoryResponse {
  history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>;
  historyId?: string;
}

const fetchHistory = async (accessToken: string, startHistoryId: string): Promise<string[]> => {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/history');
  url.searchParams.set('startHistoryId', startHistoryId);
  url.searchParams.set('historyTypes', 'messageAdded');
  url.searchParams.set('labelId', 'INBOX');
  const res = await fetchWithRetry(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    console.error(`${LOG_PREFIX} Gmail history.list failed`, res.status);
    return [];
  }
  const data = (await res.json()) as GmailHistoryResponse;
  const ids = new Set<string>();
  for (const h of data.history || []) {
    for (const m of h.messagesAdded || []) {
      if (m.message?.id) ids.add(m.message.id);
    }
  }
  return Array.from(ids);
};

interface GmailMessage {
  id: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    parts?: GmailPart[];
    body?: { data?: string };
    mimeType?: string;
    filename?: string;
  };
}
interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

const decodeBase64Url = (data: string): string => {
  try {
    const padded = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(padded, 'base64').toString('utf-8');
  } catch {
    return '';
  }
};

const extractBodyAndAttachments = (msg: GmailMessage): { body: string; hasAttachment: boolean } => {
  let body = '';
  let hasAttachment = false;

  const walk = (part: GmailPart | undefined): void => {
    if (!part) return;
    if (part.filename && part.filename.length > 0) hasAttachment = true;
    if (part.mimeType === 'text/plain' && part.body?.data && !body) {
      body = decodeBase64Url(part.body.data);
    }
    for (const child of part.parts || []) walk(child);
  };
  walk(msg.payload);

  // Fallback: top-level body
  if (!body && msg.payload?.body?.data) {
    body = decodeBase64Url(msg.payload.body.data);
  }

  return { body, hasAttachment };
};

const fetchMessage = async (accessToken: string, messageId: string): Promise<NormalizedEmail | null> => {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    console.warn(`${LOG_PREFIX} Gmail messages.get failed`, messageId, res.status);
    return null;
  }
  const msg = (await res.json()) as GmailMessage;
  const headers = msg.payload?.headers || [];
  const headerMap: Record<string, string> = {};
  for (const h of headers) headerMap[h.name.toLowerCase()] = h.value;
  const { body, hasAttachment } = extractBodyAndAttachments(msg);
  return {
    id: msg.id,
    from: headerMap['from'] ?? '',
    to: headerMap['to'] ?? '',
    subject: headerMap['subject'] ?? '',
    body,
    has_attachment: hasAttachment,
    received_at: msg.internalDate ? new Date(parseInt(msg.internalDate, 10)).toISOString() : new Date().toISOString(),
  };
};

// ---------------------------------------------------------------------------
// Filter evaluation
// ---------------------------------------------------------------------------

const fieldValue = (email: NormalizedEmail, field: FilterField): string => {
  switch (field) {
    case 'sender':
      return email.from;
    case 'subject':
      return email.subject;
    case 'to':
      return email.to;
    case 'body':
      return email.body;
    case 'has_attachment':
      return email.has_attachment ? 'true' : 'false';
  }
};

const safeRegex = (pattern: string): RegExp | null => {
  if (pattern.length > MAX_REGEX_LENGTH) return null;
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
};

const evalFilter = (email: NormalizedEmail, filter: EmailFilter): boolean => {
  const haystack = fieldValue(email, filter.field).toLowerCase();
  const needle = (filter.value || '').toLowerCase();
  switch (filter.op) {
    case 'contains':
      return haystack.includes(needle);
    case 'not_contains':
      return !haystack.includes(needle);
    case 'equals':
      return haystack === needle;
    case 'matches': {
      const re = safeRegex(filter.value);
      if (!re) return false;
      return re.test(fieldValue(email, filter.field));
    }
  }
};

const matchesSchedule = (email: NormalizedEmail, schedule: ScheduleRecord): boolean => {
  const filters = schedule.trigger?.filters ?? [];
  if (filters.length === 0) return true;
  const logic = schedule.trigger?.filter_logic ?? 'all';
  return logic === 'any' ? filters.some((f) => evalFilter(email, f)) : filters.every((f) => evalFilter(email, f));
};

// ---------------------------------------------------------------------------
// Schedule lookup + runner invocation
// ---------------------------------------------------------------------------

const listEventSchedulesForUser = async (userId: string): Promise<ScheduleRecord[]> => {
  const res = await ddbDoc.send(
    new QueryCommand({
      TableName: SCHEDULES_TABLE,
      KeyConditionExpression: 'user_id = :u',
      FilterExpression: '#status = :active AND trigger_type = :event',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':u': userId, ':active': 'active', ':event': 'event' },
    })
  );
  return (res.Items || []) as ScheduleRecord[];
};

const invokeRunner = async (scheduleId: string, email: NormalizedEmail): Promise<void> => {
  if (!RUNNER_FUNCTION_NAME) {
    console.error(`${LOG_PREFIX} AGENT_SCHEDULE_RUNNER_FUNCTION_NAME not configured`);
    return;
  }
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: RUNNER_FUNCTION_NAME,
      InvocationType: 'Event',
      Payload: Buffer.from(
        JSON.stringify({
          type: 'EVENT',
          scheduleId,
          tenantId: CLIENT_NAME,
          event: { source: 'gmail', email },
        })
      ),
    })
  );
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: Handler = async (event: EventBridgeEvent) => {
  console.log(`${LOG_PREFIX} Received`, {
    source: event.source,
    detailType: event['detail-type'],
    connectorId: event.detail?.connector_id,
    eventType: event.detail?.event_type,
  });

  if (!DATA_CONNECTORS_TABLE || !SCHEDULES_TABLE || !RUNNER_FUNCTION_NAME) {
    console.error(`${LOG_PREFIX} Missing required environment variables`);
    return { success: false, error: 'Missing configuration' };
  }

  const detail = event.detail;
  if (detail?.connector_id !== 'gmail' || detail?.event_type !== 'new_email') {
    console.info(`${LOG_PREFIX} Ignoring non-gmail event`, detail?.connector_id, detail?.event_type);
    return { success: true, ignored: true };
  }

  const mailbox = detail.payload_summary?.email_address;
  const incomingHistoryId = detail.payload_summary?.history_id;
  if (!mailbox || !incomingHistoryId) {
    console.warn(`${LOG_PREFIX} Missing mailbox or historyId in event payload`);
    return { success: false, error: 'Invalid payload' };
  }

  const connector = await findConnectorByEmail('gmail', mailbox);
  if (!connector) {
    console.warn(`${LOG_PREFIX} No connector record for gmail/${mailbox}`);
    return { success: false, error: 'Connector not found' };
  }

  const tokens = await getUserGmailRefresh(connector.user_id);
  const googleClient = await getCompanyGoogleClient();
  if (!tokens || !googleClient) {
    console.warn(`${LOG_PREFIX} Missing OAuth tokens or company client`);
    return { success: false, error: 'OAuth not configured' };
  }
  const accessToken = await refreshGoogleAccessToken(
    googleClient.clientId,
    googleClient.clientSecret,
    tokens.refreshToken
  );
  if (!accessToken) {
    return { success: false, error: 'Token refresh failed' };
  }

  // First-time bootstrap: store the watermark and skip — there's nothing prior
  // to compare against, and replaying historical messages would be unsafe.
  const startHistoryId = connector.last_history_id;
  if (!startHistoryId) {
    await updateConnectorWatermark(connector, incomingHistoryId);
    console.info(`${LOG_PREFIX} Bootstrapped historyId watermark, no messages dispatched`);
    return { success: true, bootstrapped: true };
  }

  const messageIds = await fetchHistory(accessToken, startHistoryId);
  if (messageIds.length === 0) {
    await updateConnectorWatermark(connector, incomingHistoryId);
    return { success: true, dispatched: 0 };
  }

  const schedules = await listEventSchedulesForUser(connector.user_id);
  if (schedules.length === 0) {
    await updateConnectorWatermark(connector, incomingHistoryId);
    return { success: true, dispatched: 0, reason: 'no event schedules' };
  }

  let dispatchCount = 0;
  let failCount = 0;
  for (const messageId of messageIds) {
    const email = await fetchMessage(accessToken, messageId);
    if (!email) {
      failCount += 1;
      continue;
    }

    for (const schedule of schedules) {
      if (matchesSchedule(email, schedule)) {
        try {
          await invokeRunner(schedule.schedule_id, email);
          dispatchCount += 1;
        } catch (err) {
          failCount += 1;
          console.error(`${LOG_PREFIX} Failed to invoke runner`, schedule.schedule_id, err);
        }
      }
    }
  }

  // Only advance the watermark if there were no failures, to avoid skipping
  // messages that failed to dispatch. On the next invocation the history API
  // will re-deliver them (runner invocations are idempotent fire-and-forget).
  if (failCount === 0) {
    await updateConnectorWatermark(connector, incomingHistoryId);
  } else {
    console.warn(
      `${LOG_PREFIX} Skipped watermark update due to ${failCount} failure(s). ` +
        `Will re-process from historyId ${startHistoryId} on next event.`
    );
  }

  console.log(`${LOG_PREFIX} Dispatched ${dispatchCount}, failed ${failCount}, messages ${messageIds.length}`);
  return { success: failCount === 0, dispatched: dispatchCount, failed: failCount, messages: messageIds.length };
};
