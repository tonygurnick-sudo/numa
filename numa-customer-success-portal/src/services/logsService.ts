import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
  FilterLogEventsCommand,
  type OutputLogEvent,
  type FilteredLogEvent,
} from '@aws-sdk/client-cloudwatch-logs';
import { getConfigValue } from './configService';
import { authService } from './authService';
import type { DeploymentRecord } from './deploymentService';

function getRegion(): string {
  return getConfigValue('AWS_REGION') || 'us-east-1';
}

function getAwsCredentialsProvider() {
  const region = getRegion();
  const identityPoolId = getConfigValue('IDENTITY_POOL_ID')!;
  const userPoolId = getConfigValue('USER_POOL_ID')!;
  return async () => {
    const ensured = await authService.ensureValidSession(60 * 1000);
    const session = ensured || authService.getCurrentSession();
    if (!session) throw new Error('Not authenticated');
    const idToken = session.idToken;
    const { fromCognitoIdentityPool } = await import('@aws-sdk/credential-providers');
    const base = fromCognitoIdentityPool({
      identityPoolId,
      logins: { [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: idToken },
      clientConfig: { region },
    });
    return base();
  };
}

function getLogsClient(): CloudWatchLogsClient {
  const region = getRegion();
  return new CloudWatchLogsClient({ region, credentials: getAwsCredentialsProvider() });
}

export interface LogTarget {
  group: string;
  stream?: string;
}

export function resolveDeploymentLogTarget(dep: DeploymentRecord): LogTarget {
  const group = (dep.logsGroup || getConfigValue('LOG_GROUP_NAME') || '/ecs/numa-portal-deploy') as string;
  let stream = dep.logsStream;
  if (!stream && dep.ecsTaskArn) {
    const taskId = dep.ecsTaskArn.split('/').pop() || dep.ecsTaskArn;
    stream = `ecs/deployer/${taskId}`;
  }
  return { group, stream };
}

export interface TailOptions {
  group: string;
  stream: string;
  // If true, start at the end (tail only new lines). If false, start from head.
  startAtEnd?: boolean;
  // Poll interval in ms
  intervalMs?: number;
  // Initial last seen timestamp (ms) to avoid overlap with a prior backfill
  initialLastTs?: number;
  // Callback when new events arrive
  onEvents: (events: OutputLogEvent[]) => void;
  onError?: (err: unknown) => void;
  // Optional: report lastTs updates to caller
  onLastTsUpdate?: (ts: number) => void;
}

export function tailLogStream(opts: TailOptions) {
  const cw = getLogsClient();
  const interval = Math.max(500, opts.intervalMs ?? 1500);
  let nextToken: string | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  let lastTs = opts.initialLastTs && Number.isFinite(opts.initialLastTs) ? (opts.initialLastTs as number) : 0;
  let idleTicks = 0;
  const seen = new Set<string>();
  const seenOrder: string[] = [];
  const seenCap = 20000;

  function keyFor(e: Pick<OutputLogEvent, 'timestamp' | 'ingestionTime' | 'message'>): string {
    const ts = e.timestamp ?? 0;
    const ing = e.ingestionTime ?? 0;
    const msg = e.message ?? '';
    return `${ts}|${ing}|${msg.length}:${msg.slice(0, 200)}`;
  }

  function dedup(events: OutputLogEvent[]): OutputLogEvent[] {
    const out: OutputLogEvent[] = [];
    let dropped = 0;
    for (const e of events) {
      const k = keyFor(e);
      if (seen.has(k)) {
        dropped++;
        continue;
      }
      out.push(e);
      seen.add(k);
      seenOrder.push(k);
      if (seenOrder.length > seenCap) {
        const old = seenOrder.shift()!;
        seen.delete(old);
      }
    }
    if (dropped) console.debug('[logs] dedup dropped', { dropped });
    return out;
  }

  async function tick() {
    if (stopped) return;
    try {
      console.debug('[logs] tick', {
        group: opts.group,
        stream: opts.stream,
        started,
        startAtEnd: opts.startAtEnd,
        intervalMs: interval,
      });
      if (!started) {
        // Prime nextToken by calling GetLogEvents; when startFromHead=false this positions us at the tail
        const prime = await cw.send(
          new GetLogEventsCommand({
            logGroupName: opts.group,
            logStreamName: opts.stream,
            startFromHead: opts.startAtEnd ? false : true,
            limit: 1000,
          })
        );
        nextToken = prime.nextForwardToken;
        console.debug('[logs] primed', { events: prime.events?.length ?? 0 });
        if (!opts.startAtEnd && (prime.events?.length ?? 0) > 0) {
          const appended = dedup(prime.events!);
          if (appended.length) {
            opts.onEvents(appended);
            const ts = appended[appended.length - 1]?.timestamp;
            if (typeof ts === 'number') {
              lastTs = ts;
              opts.onLastTsUpdate?.(lastTs);
            }
          }
        }
        started = true;
      } else {
        const res = await cw.send(
          new GetLogEventsCommand({
            logGroupName: opts.group,
            logStreamName: opts.stream,
            nextToken,
            startFromHead: false,
            limit: 1000,
          })
        );
        const newToken = res.nextForwardToken;
        if (newToken && newToken !== nextToken) {
          const events = res.events ?? [];
          console.debug('[logs] events', { count: events.length });
          const filtered = lastTs ? events.filter((e) => (e.timestamp ?? 0) > lastTs) : events;
          const appended = dedup(filtered);
          if (appended.length) {
            opts.onEvents(appended);
            const ts = appended[appended.length - 1]?.timestamp;
            if (typeof ts === 'number') {
              lastTs = Math.max(lastTs, ts);
              opts.onLastTsUpdate?.(lastTs);
            }
          }
          nextToken = newToken;
          idleTicks = 0;
        } else {
          console.debug('[logs] no new events');
          idleTicks += 1;
          // Guard refresh: after several idle ticks, search for late-arriving events near the last timestamp
          if (idleTicks >= 6) {
            try {
              const windowStart = lastTs ? lastTs + 1 : Date.now() - 60_000;
              console.debug('[logs] resync filter window', { windowStart, lastTs });
              const filter = await cw.send(
                new FilterLogEventsCommand({
                  logGroupName: opts.group,
                  logStreamNames: [opts.stream],
                  startTime: windowStart,
                  limit: 1000,
                  interleaved: true,
                })
              );
              const events: OutputLogEvent[] = (filter.events ?? []).map((e: FilteredLogEvent) => ({
                message: e.message,
                timestamp: e.timestamp,
              }));
              const appended = dedup(events.filter((e) => (e.timestamp ?? 0) > lastTs));
              if (appended.length) {
                console.debug('[logs] resync found', { count: appended.length });
                opts.onEvents(appended);
                const ts = appended[appended.length - 1]?.timestamp || 0;
                if (ts) {
                  lastTs = Math.max(lastTs, ts);
                  opts.onLastTsUpdate?.(lastTs);
                }
              }
              // Re-prime token to the current tail to avoid being stuck
              const rePrime = await cw.send(
                new GetLogEventsCommand({
                  logGroupName: opts.group,
                  logStreamName: opts.stream,
                  startFromHead: false,
                  limit: 1,
                })
              );
              if (rePrime.nextForwardToken) nextToken = rePrime.nextForwardToken;
            } catch (err) {
              console.debug('[logs] resync error', err);
            } finally {
              idleTicks = 0;
            }
          }
        }
      }
    } catch (e: unknown) {
      // If stream not found yet, retry; throttle on other errors
      const err = e as { name?: string };
      if (err?.name === 'ResourceNotFoundException') {
        // keep retrying silently
        console.debug('[logs] waiting for stream to appear');
      } else if (opts.onError) {
        opts.onError(e);
      }
    } finally {
      if (!stopped) timer = setTimeout(tick, interval);
    }
  }

  function start() {
    if (timer) return;
    stopped = false;
    console.debug('[logs] start tail', {
      group: opts.group,
      stream: opts.stream,
      startAtEnd: opts.startAtEnd,
      intervalMs: interval,
    });
    timer = setTimeout(tick, 0);
  }
  function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    console.debug('[logs] stop tail', { group: opts.group, stream: opts.stream });
  }

  function getLastTs() {
    return lastTs;
  }

  return { start, stop, getLastTs };
}

export async function backfillSince(group: string, stream: string, sinceEpochMs: number): Promise<OutputLogEvent[]> {
  const cw = getLogsClient();
  console.debug('[logs] backfill request', { group, stream, sinceEpochMs });
  const PAGE_LIMIT = 1000;
  const MAX_PAGES = 20; // up to ~20k events
  const events: OutputLogEvent[] = [];
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await cw.send(
      new FilterLogEventsCommand({
        logGroupName: group,
        logStreamNames: [stream],
        startTime: sinceEpochMs,
        interleaved: true,
        limit: PAGE_LIMIT,
        nextToken: token,
      })
    );
    const batch = res.events?.map((e) => ({ message: e.message, timestamp: e.timestamp })) ?? [];
    events.push(...batch);
    console.debug('[logs] backfill page', { page: page + 1, batch: batch.length, total: events.length });
    if (!res.nextToken) break;
    token = res.nextToken;
  }
  console.debug('[logs] backfill complete', { total: events.length });
  return events;
}

export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  const ansiRegex = /[\u001B\u009B][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  return input.replace(ansiRegex, '');
}
