/**
 * numa-voice-analytics — read-only analytics + call-logs API for Numa Voice.
 *
 * Serves the Voice Analytics dashboard, Call Logs, and Live Monitoring.
 *
 * DATA SOURCE (v1): the canonical vCons in the DATA bucket
 * (documents/company/voice/vcons/) — same region as this lambda, so no pipeline
 * is required. Each vCon carries parties, disposition, duration, rating + the
 * recording/transcript refs. Aggregate timing averages (queue/hold/wrap) + live
 * agent/queue state come from Amazon Connect GetMetricDataV2 / GetCurrentMetricData.
 *
 * Phase 3b (operational metrics — answer rate split, missed reasons, per-call
 * queue wait, journey timeline): the numa-voice-call-ingest pipeline writes a
 * `voice-calls` DynamoDB read-model from Connect contact events; this API will
 * merge it once that cross-region pipeline is wired. Code for it is built + tested.
 *
 * Separate from numa-voice-admin on purpose: read-only, higher-traffic, clean
 * route array. Authz: summary/timeseries/live are admin-only; /calls is scoped —
 * a non-admin SDR sees only their own calls.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  ConnectClient,
  ListInstancesCommand,
  ListRoutingProfilesCommand,
  GetMetricDataV2Command,
  GetCurrentMetricDataCommand,
  ListQueuesCommand,
} from '@aws-sdk/client-connect';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { aggregateSummary, aggregateTimeseries, dateRange, type CallRow } from './aggregate';
import { vconToRow } from './vconRow';

const CONNECT_REGION = process.env.CONNECT_REGION || 'ap-southeast-2';
const CLIENT_REGION = process.env.CLIENT_REGION || 'us-east-1';
const CLIENT_NAME = process.env.CLIENT_NAME || '';
const ENV_SUFFIX = process.env.ENV_SUFFIX || '';
const INSTANCE_ALIAS = `numa-${CLIENT_NAME}${ENV_SUFFIX}`;
const VOICE_ROUTING_PROFILE = 'numa-voice-routing';
const DATA_BUCKET = process.env.DATA_BUCKET || '';
const VCONS_PREFIX = process.env.KB_VCONS_S3_PREFIX || 'documents/company/voice/vcons/';
const TENANT_TZ = process.env.TENANT_TZ || 'Pacific/Auckland';
const CREDITS_TABLE = process.env.CREDITS_TABLE_NAME || '';
const RECORDING_PRESIGN_TTL = 300;
// Bound the per-request vCon fan-out (a pilot has tens–hundreds of calls; this
// caps cost if a tenant grows before the DynamoDB read-model is wired).
const MAX_VCONS = Number(process.env.MAX_VCONS) || 1500;

const connect = withPRM(ConnectClient, { region: CONNECT_REGION });
// Recordings live in the Connect region; the vCon/transcript in the DATA bucket (client region).
const s3Recordings = withPRM(S3Client, { region: CONNECT_REGION });
const s3Data = withPRM(S3Client, { region: CLIENT_REGION });
// The credit ledger lives in the CLIENT region (this lambda's region) — read the
// per-call charged credits for the call-detail drawer.
const ddb = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, { region: CLIENT_REGION }));

const HEADERS = { 'Content-Type': 'application/json' };
const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body),
});

interface Claims {
  sub?: string;
  email?: string;
  'cognito:groups'?: string[];
}
function callerClaims(event: APIGatewayProxyEventV2): Claims {
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64').toString('utf-8')) as Claims;
  } catch {
    return {};
  }
}
const isAdmin = (c: Claims): boolean => Array.isArray(c['cognito:groups']) && c['cognito:groups'].includes('admin');

let cachedInstance: { id: string; arn: string } | null | undefined;
async function resolveInstance(): Promise<{ id: string; arn: string } | null> {
  if (cachedInstance !== undefined) return cachedInstance;
  const res = await connect.send(new ListInstancesCommand({}));
  const inst = res.InstanceSummaryList?.find((i) => i.InstanceAlias === INSTANCE_ALIAS);
  cachedInstance = inst?.Id && inst.Arn ? { id: inst.Id, arn: inst.Arn } : null;
  return cachedInstance;
}

async function findRoutingProfileId(instanceId: string): Promise<string | undefined> {
  let token: string | undefined;
  do {
    const res = await connect.send(new ListRoutingProfilesCommand({ InstanceId: instanceId, NextToken: token }));
    const match = res.RoutingProfileSummaryList?.find((r) => r.Name === VOICE_ROUTING_PROFILE);
    if (match?.Id) return match.Id;
    token = res.NextToken;
  } while (token);
  return undefined;
}

function parseRange(q: Record<string, string | undefined>): { fromMs: number; toMs: number } {
  const now = Date.now();
  if (q.from || q.to) {
    const toMs = q.to ? (Number.isFinite(Number(q.to)) ? Number(q.to) : Date.parse(q.to)) : now;
    const fromMs = q.from ? (Number.isFinite(Number(q.from)) ? Number(q.from) : Date.parse(q.from)) : now - 7 * 864e5;
    return { fromMs, toMs };
  }
  const range = q.range || '7d';
  if (range === 'mtd') {
    const d = new Date(now);
    return { fromMs: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), toMs: now };
  }
  const days = range === '30d' ? 30 : range === '24h' ? 1 : 7;
  return { fromMs: now - days * 864e5, toMs: now };
}

async function readJson(s3: S3Client, bucket: string, key: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await res.Body?.transformToString();
    return body ? (JSON.parse(body) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** List + read the vCons in the DATA bucket and map to CallRows in the date range. */
async function listCalls(fromMs: number, toMs: number): Promise<CallRow[]> {
  if (!DATA_BUCKET) return [];
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3Data.send(
      new ListObjectsV2Command({ Bucket: DATA_BUCKET, Prefix: VCONS_PREFIX, ContinuationToken: token })
    );
    for (const obj of res.Contents ?? []) {
      const key = obj.Key ?? '';
      // Canonical vCon objects only — skip the index pointers.
      if (key.endsWith('.json') && !key.includes('/index/')) keys.push(key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token && keys.length < MAX_VCONS);

  // uuid7 filenames are time-ordered, so the newest calls are at the tail.
  const recent = keys.slice(-MAX_VCONS);
  const rows: CallRow[] = [];
  const CONCURRENCY = 16;
  for (let i = 0; i < recent.length; i += CONCURRENCY) {
    const batch = recent.slice(i, i + CONCURRENCY);
    const vcons = await Promise.all(batch.map((k) => readJson(s3Data, DATA_BUCKET, k)));
    for (const v of vcons) {
      if (!v) continue;
      const row = vconToRow(v, TENANT_TZ);
      if (row && row.startMs !== undefined && row.startMs >= fromMs && row.startMs <= toMs) rows.push(row);
    }
  }
  return rows;
}

async function fetchTimingAverages(fromMs: number, toMs: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    const instance = await resolveInstance();
    if (!instance) return out;
    const rpId = await findRoutingProfileId(instance.id);
    if (!rpId) return out;
    const res = await connect.send(
      new GetMetricDataV2Command({
        ResourceArn: instance.arn,
        StartTime: new Date(fromMs),
        EndTime: new Date(toMs),
        Filters: [{ FilterKey: 'ROUTING_PROFILE', FilterValues: [rpId] }],
        Metrics: [
          { Name: 'AVG_QUEUE_ANSWER_TIME' },
          { Name: 'AVG_HOLD_TIME' },
          { Name: 'AVG_AFTER_CONTACT_WORK_TIME' },
          { Name: 'AVG_INTERACTION_TIME' },
        ],
      })
    );
    for (const r of res.MetricResults ?? []) {
      for (const c of r.Collections ?? []) {
        if (c.Metric?.Name && typeof c.Value === 'number') out[c.Metric.Name] = Math.round(c.Value);
      }
    }
  } catch (err) {
    console.warn('voice-analytics: GetMetricDataV2 timing unavailable', String(err));
  }
  return out;
}

async function handleSummary(q: Record<string, string | undefined>): Promise<APIGatewayProxyStructuredResultV2> {
  const { fromMs, toMs } = parseRange(q);
  const rows = await listCalls(fromMs, toMs);
  const summary = aggregateSummary(rows);
  const timing = await fetchTimingAverages(fromMs, toMs);
  summary.timing.avgQueueSec = timing.AVG_QUEUE_ANSWER_TIME ?? null;
  summary.timing.avgHoldSec = timing.AVG_HOLD_TIME ?? null;
  summary.timing.avgWrapSec = timing.AVG_AFTER_CONTACT_WORK_TIME ?? null;
  if (timing.AVG_INTERACTION_TIME) summary.timing.avgTalkSec = timing.AVG_INTERACTION_TIME;
  return json(200, { range: { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() }, ...summary });
}

async function handleTimeseries(q: Record<string, string | undefined>): Promise<APIGatewayProxyStructuredResultV2> {
  const { fromMs, toMs } = parseRange(q);
  const dates = dateRange(fromMs, toMs, TENANT_TZ);
  const rows = await listCalls(fromMs, toMs);
  return json(200, { interval: 'DAY', points: aggregateTimeseries(rows, dates) });
}

function callRowView(r: CallRow): Record<string, unknown> {
  return {
    contactId: r.contactId,
    direction: r.direction,
    agent: r.agentUsername,
    company: r.company,
    number: r.prospectPhone,
    durationSec: r.durationSeconds,
    disposition: r.disposition,
    rating: r.rating,
    missed: r.missed,
    startedAt: r.startMs ? new Date(r.startMs).toISOString() : undefined,
  };
}

async function handleCallsList(
  q: Record<string, string | undefined>,
  claims: Claims
): Promise<APIGatewayProxyStructuredResultV2> {
  const { fromMs, toMs } = parseRange(q);
  let rows = await listCalls(fromMs, toMs);
  if (!isAdmin(claims)) rows = rows.filter((r) => r.agentUsername && r.agentUsername === claims.email);
  if (q.agent) rows = rows.filter((r) => r.agentUsername === q.agent);
  if (q.disposition) rows = rows.filter((r) => r.disposition === q.disposition);
  if (q.direction) rows = rows.filter((r) => r.direction === q.direction);
  rows.sort((a, b) => (b.startMs ?? 0) - (a.startMs ?? 0));
  const limit = Math.min(Number(q.limit) || 100, 500);
  return json(200, { items: rows.slice(0, limit).map(callRowView), total: rows.length });
}

/** The credits + USD charged for a call, from the credit ledger META row. */
async function creditCost(contactId: string): Promise<{ credits: number; usd: number } | undefined> {
  if (!CREDITS_TABLE) return undefined;
  try {
    const res = await ddb.send(
      new GetCommand({ TableName: CREDITS_TABLE, Key: { PK: `CONV#voice-${contactId}`, SK: 'META' } })
    );
    if (!res.Item) return undefined;
    return { credits: Number(res.Item.creditsCharged ?? 0), usd: Number(res.Item.consumptionCostUsd ?? 0) };
  } catch (err) {
    console.warn('voice-analytics: credit cost read failed', String(err));
    return undefined;
  }
}

async function handleCallDetail(contactId: string, claims: Claims): Promise<APIGatewayProxyStructuredResultV2> {
  if (!DATA_BUCKET) return json(200, { contactId, available: false });
  // Resolve the vCon via the contactId → uuid index pointer.
  const idx = await readJson(s3Data, DATA_BUCKET, `${VCONS_PREFIX}index/${contactId}.json`);
  const vconKey = idx?.vcon_key as string | undefined;
  const vcon = vconKey ? await readJson(s3Data, DATA_BUCKET, vconKey) : null;
  if (!vcon) return json(404, { error: 'Call not found' });
  const row = vconToRow(vcon, TENANT_TZ);
  if (!row) return json(404, { error: 'Call not found' });
  if (!isAdmin(claims) && row.agentUsername !== claims.email) return json(403, { error: 'Forbidden' });

  // Presigned recording (short TTL, regenerated per request — never stored).
  let recordingUrl: string | undefined;
  const r = row as CallRow & {
    recordingKey?: string;
    recordingBucket?: string;
    transcriptKey?: string;
    summary?: string;
  };
  if (r.recordingKey && r.recordingBucket) {
    try {
      recordingUrl = await getSignedUrl(
        s3Recordings as unknown as Parameters<typeof getSignedUrl>[0],
        new GetObjectCommand({ Bucket: r.recordingBucket, Key: r.recordingKey }) as unknown as Parameters<
          typeof getSignedUrl
        >[1],
        { expiresIn: RECORDING_PRESIGN_TTL }
      );
    } catch (err) {
      console.warn('voice-analytics: presign failed', String(err));
    }
  }
  const transcript = r.transcriptKey ? await readJson(s3Data, DATA_BUCKET, r.transcriptKey) : null;
  // Insights straight from the canonical vCon analysis.
  const analysis = (vcon.analysis as Array<Record<string, unknown>> | undefined) ?? [];
  const body = (type: string): unknown => analysis.find((a) => a?.type === type)?.body;
  const cost = await creditCost(contactId);

  return json(200, {
    ...callRowView(row),
    summary: r.summary,
    insights: { summary: body('summary'), objections: body('objections'), nextSteps: body('next_steps') },
    // Sentiment comes from the post-call LLM (analysis[type:sentiment]) — no Contact
    // Lens / extra spend. Shape: { overall, prospect, trajectory, rationale }.
    sentiment: body('sentiment'),
    recordingUrl,
    transcript: transcript ?? { available: false },
    cost,
  });
}

async function handleLive(): Promise<APIGatewayProxyStructuredResultV2> {
  const empty = { contactsInQueue: 0, oldestContactAgeSec: 0, agentsOnline: 0, agentsAvailable: 0, agentsOnCall: 0 };
  try {
    const instance = await resolveInstance();
    if (!instance) return json(200, empty);
    const queues = await connect.send(new ListQueuesCommand({ InstanceId: instance.id, QueueTypes: ['STANDARD'] }));
    const queueIds = (queues.QueueSummaryList ?? [])
      .map((qq) => qq.Id)
      .filter((x): x is string => !!x)
      .slice(0, 100);
    if (queueIds.length === 0) return json(200, empty);
    const res = await connect.send(
      new GetCurrentMetricDataCommand({
        InstanceId: instance.id,
        Filters: { Queues: queueIds, Channels: ['VOICE'] },
        CurrentMetrics: [
          { Name: 'AGENTS_ONLINE', Unit: 'COUNT' },
          { Name: 'AGENTS_AVAILABLE', Unit: 'COUNT' },
          { Name: 'AGENTS_ON_CALL', Unit: 'COUNT' },
          { Name: 'CONTACTS_IN_QUEUE', Unit: 'COUNT' },
          { Name: 'OLDEST_CONTACT_AGE', Unit: 'SECONDS' },
        ],
      })
    );
    const sum: Record<string, number> = {};
    let oldest = 0;
    for (const r of res.MetricResults ?? []) {
      for (const c of r.Collections ?? []) {
        const n = c.Metric?.Name;
        const v = c.Value ?? 0;
        if (!n) continue;
        if (n === 'OLDEST_CONTACT_AGE') oldest = Math.max(oldest, v);
        else sum[n] = (sum[n] ?? 0) + v;
      }
    }
    return json(200, {
      contactsInQueue: sum.CONTACTS_IN_QUEUE ?? 0,
      oldestContactAgeSec: Math.round(oldest),
      agentsOnline: sum.AGENTS_ONLINE ?? 0,
      agentsAvailable: sum.AGENTS_AVAILABLE ?? 0,
      agentsOnCall: sum.AGENTS_ON_CALL ?? 0,
    });
  } catch (err) {
    console.warn('voice-analytics: live metrics unavailable', String(err));
    return json(200, empty);
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const method = event.requestContext?.http?.method || 'GET';
  const path = event.requestContext?.http?.path || event.rawPath || '';
  if (method === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (method !== 'GET') return json(405, { error: 'Method not allowed' });

  const claims = callerClaims(event);
  const q = (event.queryStringParameters ?? {}) as Record<string, string | undefined>;

  try {
    if (/\/voice\/analytics\/summary\/?$/.test(path)) {
      if (!isAdmin(claims)) return json(403, { error: 'Admin only' });
      return await handleSummary(q);
    }
    if (/\/voice\/analytics\/timeseries\/?$/.test(path)) {
      if (!isAdmin(claims)) return json(403, { error: 'Admin only' });
      return await handleTimeseries(q);
    }
    if (/\/voice\/analytics\/live\/?$/.test(path)) {
      if (!isAdmin(claims)) return json(403, { error: 'Admin only' });
      return await handleLive();
    }
    const detail = path.match(/\/voice\/calls\/([^/]+)\/?$/);
    if (detail) return await handleCallDetail(decodeURIComponent(detail[1]), claims);
    if (/\/voice\/calls\/?$/.test(path)) return await handleCallsList(q, claims);

    return json(404, { error: 'Not found', path });
  } catch (err) {
    console.error('voice-analytics error', { path, err: String(err) });
    return json(500, { error: 'Internal error' });
  }
};
