import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { CloudWatchLogsClient, GetQueryResultsCommand, StartQueryCommand } from '@aws-sdk/client-cloudwatch-logs';
import { awsCredentialsService } from '@/services/awsCredentialsService';
import { withPRM } from '@/utils/prmUtils';
import type { Client } from '@/types';
import type {
  ConversationDetail,
  ConversationSummary,
  ParsedTraceEvent,
  ProxyRequestEvent,
} from '@/types/publicDemoConversation';

const DEMO_USER_SUB = 'public-demo-user';

function outputsBucket(clientName: string): string {
  return `numa-${clientName}-outputs`;
}

function conversationsPrefix(): string {
  return `numa-chat/workspace/${DEMO_USER_SUB}/conversations/`;
}

function tracePrefix(conversationId: string): string {
  return `${conversationsPrefix()}${conversationId}/_system/trace.jsonl`;
}

async function getS3(client: Client) {
  const { clientAccountId, region = 'us-east-1' } = client.config;
  const awsConfig = await awsCredentialsService.getClientConfig(clientAccountId, region);
  return withPRM(S3Client, awsConfig);
}

async function getLogs(client: Client) {
  const { clientAccountId, region = 'us-east-1' } = client.config;
  const awsConfig = await awsCredentialsService.getClientConfig(clientAccountId, region);
  return withPRM(CloudWatchLogsClient, awsConfig);
}

function proxyLogGroup(clientName: string): string {
  return `/aws/lambda/${clientName}-public-demo-proxy`;
}

/**
 * List every public-demo conversation, newest first. Cheap: one LIST per call
 * (plus continuation tokens if needed). LastModified comes from S3 directly.
 */
export async function listPublicDemoConversations(client: Client): Promise<ConversationSummary[]> {
  const s3 = await getS3(client);
  const bucket = outputsBucket(client.name);
  const prefix = conversationsPrefix();

  const found = new Map<string, ConversationSummary>();
  let continuationToken: string | undefined;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const item of response.Contents ?? []) {
      const key = item.Key;
      if (!key) continue;
      // Only consider trace.jsonl keys — ignore conversation bundle files.
      if (!key.endsWith('/_system/trace.jsonl')) continue;

      // key shape: numa-chat/workspace/public-demo-user/conversations/<id>/_system/trace.jsonl
      const rest = key.slice(prefix.length); // <id>/_system/trace.jsonl
      const conversationId = rest.split('/', 1)[0];
      if (!conversationId) continue;

      const lastModified = item.LastModified?.toISOString() ?? '';
      const existing = found.get(conversationId);
      if (!existing || lastModified > existing.lastModified) {
        found.set(conversationId, {
          conversationId,
          lastModified,
          traceBytes: item.Size ?? 0,
        });
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return Array.from(found.values()).sort((a, b) => b.lastModified.localeCompare(a.lastModified));
}

/**
 * Shorten tool-call parameter objects into a single-line summary suitable for
 * inline display. Strips long fields and collapses to "k1=v1, k2=v2" form.
 */
function summariseToolParams(input: unknown): string {
  if (input == null) return '';
  if (typeof input !== 'object') return String(input).slice(0, 120);
  const entries = Object.entries(input as Record<string, unknown>);
  const parts: string[] = [];
  for (const [k, v] of entries) {
    let val: string;
    if (v == null) {
      val = 'null';
    } else if (typeof v === 'string') {
      val = v.length > 60 ? `${v.slice(0, 57)}…` : v;
      val = `"${val}"`;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      val = String(v);
    } else {
      val = Array.isArray(v) ? `[${v.length}]` : '{…}';
    }
    parts.push(`${k}=${val}`);
    if (parts.join(', ').length > 200) break;
  }
  return parts.join(', ');
}

/**
 * Parse a single trace.jsonl line into one of three surfaced event kinds.
 * Returns null for events we intentionally drop (thinking, stream deltas,
 * system init, tool results).
 */
function parseTraceLine(line: string): ParsedTraceEvent | null {
  let ev: unknown;
  try {
    ev = JSON.parse(line);
  } catch {
    return null;
  }
  if (!ev || typeof ev !== 'object') return null;
  const event = ev as Record<string, unknown>;
  const type = event.type;
  const timestamp = typeof event.timestamp === 'string' ? event.timestamp : '';

  // User turns: {type: "user", message: {role: "user", content: [{type:"text"|"tool_result", ...}]}}
  if (type === 'user') {
    const message = event.message as { role?: string; content?: unknown } | undefined;
    if (message?.role !== 'user' || !Array.isArray(message.content)) return null;
    const textParts: string[] = [];
    for (const part of message.content) {
      if (part && typeof part === 'object' && (part as Record<string, unknown>).type === 'text') {
        const t = (part as Record<string, unknown>).text;
        if (typeof t === 'string') textParts.push(t);
      }
    }
    if (textParts.length === 0) return null; // tool_result — skip
    return { kind: 'user', timestamp, text: textParts.join('\n') };
  }

  // Assistant turns: {type: "assistant", message: {role: "assistant", content: [{type:"text"|"tool_use"|"thinking", ...}]}}
  if (type === 'assistant') {
    const message = event.message as { role?: string; content?: unknown } | undefined;
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) return null;
    // Assistant events may contain multiple content blocks — emit the first
    // surfaced one per line (callers compact adjacent text events downstream).
    for (const part of message.content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      if (p.type === 'text' && typeof p.text === 'string' && p.text.trim().length > 0) {
        return { kind: 'assistant', timestamp, text: p.text };
      }
      if (p.type === 'tool_use') {
        const toolName = typeof p.name === 'string' ? p.name : 'tool';
        const paramsSummary = summariseToolParams(p.input);
        return { kind: 'tool_call', timestamp, toolName, paramsSummary };
      }
      // thinking / other — drop
    }
    return null;
  }

  return null;
}

/** Compact adjacent assistant text events into a single message per turn. */
function compactAssistantRuns(events: ParsedTraceEvent[]): ParsedTraceEvent[] {
  const out: ParsedTraceEvent[] = [];
  for (const ev of events) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === 'assistant' && ev.kind === 'assistant') {
      out[out.length - 1] = { ...prev, text: `${prev.text}\n${ev.text}` };
      continue;
    }
    out.push(ev);
  }
  return out;
}

export async function fetchConversationTrace(client: Client, conversationId: string): Promise<ConversationDetail> {
  const s3 = await getS3(client);
  const bucket = outputsBucket(client.name);
  const key = tracePrefix(conversationId);

  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = response.Body;
  if (!body) {
    throw new Error(`Trace has no body: ${key}`);
  }
  const text = await body.transformToString();
  const parsed: ParsedTraceEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const ev = parseTraceLine(line);
    if (ev) parsed.push(ev);
  }
  const events = compactAssistantRuns(parsed);
  const firstUserMessage = events.find((e) => e.kind === 'user')?.text;
  return { conversationId, events, firstUserMessage };
}

// ─── Proxy-log IP enrichment ──────────────────────────────────────────
// The container trace doesn't include caller IPs. The public-demo-proxy
// Lambda logs each POST with the caller IP in the uvicorn access line:
//   `INFO:     49.224.117.149:0 - "POST /api/public-demo/invocations HTTP/1.1" 200 OK`
// We run a single Logs Insights query over the window and match each
// conversation's S3 LastModified timestamp to the nearest proxy event.

async function runLogsInsightsQuery(
  logs: CloudWatchLogsClient,
  logGroupName: string,
  startSec: number,
  endSec: number,
  queryString: string
): Promise<Array<Record<string, string>>> {
  const start = await logs.send(
    new StartQueryCommand({
      logGroupName,
      startTime: startSec,
      endTime: endSec,
      queryString,
      limit: 10_000,
    })
  );
  const queryId = start.queryId;
  if (!queryId) throw new Error('StartQuery returned no queryId');

  // Poll up to 15s.
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? 500 : 1000));
    const res = await logs.send(new GetQueryResultsCommand({ queryId }));
    if (res.status === 'Complete') {
      return (res.results ?? []).map((row) => {
        const obj: Record<string, string> = {};
        for (const field of row) {
          if (field.field && typeof field.value === 'string') {
            obj[field.field] = field.value;
          }
        }
        return obj;
      });
    }
    if (res.status === 'Failed' || res.status === 'Cancelled' || res.status === 'Timeout') {
      throw new Error(`Logs Insights query ${res.status}`);
    }
  }
  throw new Error('Logs Insights query timed out after 15s');
}

/**
 * Fetch all proxy POSTs in the window, extracting timestamp + caller IP.
 * Returns sorted by timestamp ascending so binary-searching callers is cheap.
 */
export async function fetchProxyRequestEvents(client: Client, daysBack = 30): Promise<ProxyRequestEvent[]> {
  const logs = await getLogs(client);
  const now = Math.floor(Date.now() / 1000);
  const start = now - daysBack * 24 * 60 * 60;
  // parse out the IP; require the POST pattern so we don't match random log lines.
  const queryString = `
    fields @timestamp, @message
    | filter @message like /POST \\/api\\/public-demo\\/invocations/
    | parse @message /(?<ip>\\d+\\.\\d+\\.\\d+\\.\\d+):0/
    | filter ispresent(ip)
    | sort @timestamp asc
  `;
  const rows = await runLogsInsightsQuery(logs, proxyLogGroup(client.name), start, now, queryString);
  const events: ProxyRequestEvent[] = [];
  for (const r of rows) {
    const ts = r['@timestamp'];
    const ip = r['ip'];
    if (ts && ip) events.push({ timestamp: new Date(ts.replace(' ', 'T') + 'Z').toISOString(), ip });
  }
  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Pick the single IP that best represents a conversation, given all proxy
 * events from the window. We search for any proxy event within ±5 minutes of
 * the conversation's S3 LastModified, take the most common IP among matches,
 * and fall back to the nearest single event.
 */
function correlateIp(conversationTs: string, proxyEvents: ProxyRequestEvent[]): string | undefined {
  if (proxyEvents.length === 0 || !conversationTs) return undefined;
  const target = new Date(conversationTs).getTime();
  if (!Number.isFinite(target)) return undefined;

  const WINDOW_MS = 5 * 60 * 1000;
  const withinWindow: ProxyRequestEvent[] = [];
  let nearest: ProxyRequestEvent | undefined;
  let nearestDelta = Infinity;

  for (const ev of proxyEvents) {
    const t = new Date(ev.timestamp).getTime();
    const delta = Math.abs(t - target);
    if (delta < nearestDelta) {
      nearestDelta = delta;
      nearest = ev;
    }
    if (delta <= WINDOW_MS) withinWindow.push(ev);
  }

  if (withinWindow.length > 0) {
    // Mode of IPs in the window.
    const counts = new Map<string, number>();
    for (const ev of withinWindow) counts.set(ev.ip, (counts.get(ev.ip) ?? 0) + 1);
    let bestIp: string | undefined;
    let bestCount = 0;
    for (const [ip, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestIp = ip;
      }
    }
    return bestIp;
  }

  // No events in window — fall back to the absolute nearest if it's within 30 min.
  if (nearest && nearestDelta <= 30 * 60 * 1000) return nearest.ip;
  return undefined;
}

/** Enrich a list of conversation summaries with best-effort source IPs. */
export function attachIpsToConversations(
  conversations: ConversationSummary[],
  proxyEvents: ProxyRequestEvent[]
): ConversationSummary[] {
  return conversations.map((c) => ({
    ...c,
    sourceIp: correlateIp(c.lastModified, proxyEvents),
  }));
}
