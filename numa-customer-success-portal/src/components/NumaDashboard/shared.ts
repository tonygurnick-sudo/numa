/**
 * Shared utilities for the Numa Dashboard React components.
 *
 * Two responsibilities:
 *   1. Formatters, window helpers, span / daily-bucket utilities.
 *   2. Browser-side aggregation — roll N per-client snapshots into one
 *      AggregateView. This replaces what the Lambda's aggregate.py used to
 *      do, and lets us add new filters (nextgen / non-nextgen / dev /
 *      account-id-dedupe) without a Lambda redeploy.
 */
import type {
  AggregateView,
  ByCategoryBlock,
  ByClientRow,
  ChatBlock,
  ClientConfigSummary,
  ClientSnapshot,
  CostExplorerBlock,
  DashboardView,
  DistributionStats,
  PerAgentStats,
  PerUserStats,
  ScheduledRunsBlock,
  SchedulesBlock,
  TopConversation,
  TopScheduledRun,
} from '@/types/fleetAnalytics';

// ─── formatters ──────────────────────────────────────────────────────────
//
// Currency state is a module-level singleton driven by CurrencyContext. The
// formatters below are pure functions of (n) only — components re-render via
// useCurrency() and the formatters pick up the new state at next call. Source
// data is always USD (the snapshot's source of truth); conversion is a
// display-only affordance.

interface CurrencyState {
  /** Display currency code — 'USD' or any ISO 4217 code the user types. */
  code: string;
  /** Multiplier applied to USD numbers before display. 1.0 for USD. */
  rate: number;
  /** Symbol/prefix shown before the number, e.g. '$' for USD, 'NZ$' for NZD. */
  prefix: string;
}

let _currency: CurrencyState = { code: 'USD', rate: 1, prefix: '$' };

/** Replace the module-level currency state. Called by CurrencyProvider. */
export function setCurrencyState(next: CurrencyState): void {
  _currency = next;
}

export function getCurrencyState(): CurrencyState {
  return _currency;
}

export const fmtUSD = (n: number | null | undefined) =>
  _currency.prefix +
  ((n ?? 0) * _currency.rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtUSDc = (n: number | null | undefined) =>
  _currency.prefix +
  ((n ?? 0) * _currency.rate).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** Compact money — no decimals. Used in the sidebar where space is tight. */
export const fmtUSD0 = (n: number | null | undefined) =>
  _currency.prefix + Math.round((n ?? 0) * _currency.rate).toLocaleString();

export const fmtN = (n: number | null | undefined) => Math.round(n ?? 0).toLocaleString();

export const fmtDecimal = (n: number | null | undefined, d = 2) => (n ?? 0).toFixed(d);

export const pct = (n: number | null | undefined, total: number | null | undefined) =>
  total ? ((100 * (n ?? 0)) / total).toFixed(1) + '%' : '—';

// ─── window helpers ──────────────────────────────────────────────────────

export interface WindowState {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  label: string;
}

const todayUTC = (): Date => new Date(Date.now());
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const daysAgo = (n: number): Date => {
  const d = todayUTC();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};

export function setLastNDays(n: number): WindowState {
  const end = todayUTC();
  const start = daysAgo(n - 1);
  return { startDate: isoDay(start), endDate: isoDay(end), label: `Last ${n} days` };
}

export function setMonth(year: number, month0: number): WindowState {
  const start = new Date(Date.UTC(year, month0, 1));
  const end = new Date(Date.UTC(year, month0 + 1, 0));
  const m = start.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const sameYear = year === todayUTC().getUTCFullYear();
  return {
    startDate: isoDay(start),
    endDate: isoDay(end),
    label: sameYear ? m : `${m} ${year}`,
  };
}

export const parseIsoDay = (s: string): Date => new Date(s + 'T00:00:00Z');

/** Inclusive day range. Never extends past today — future days have no data. */
export function buildDayRange(startIso: string, endIso: string): string[] {
  const todayIso = isoDay(todayUTC());
  const effectiveEnd = endIso > todayIso ? todayIso : endIso;
  const out: string[] = [];
  const start = parseIsoDay(startIso);
  const end = parseIsoDay(effectiveEnd);
  const cur = new Date(start);
  while (cur <= end) {
    out.push(isoDay(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Filter a daily map to the dates inside the window (inclusive). */
export function filterDailyMap(map: Record<string, number> | undefined, win: WindowState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [d, v] of Object.entries(map || {})) {
    if (d >= win.startDate && d <= win.endDate) out[d] = v;
  }
  return out;
}

/** Sum all values in a daily map that fall inside the window. */
export function sumDailyInWindow(map: Record<string, number> | undefined, win: WindowState): number {
  let s = 0;
  for (const [d, v] of Object.entries(map || {})) {
    if (d >= win.startDate && d <= win.endDate) s += v || 0;
  }
  return s;
}

/**
 * For a {key: {day: value}} map, return {key: total-in-window}. Used to
 * collapse `daily_cost_by_user` / `daily_cost_by_agent` into window-scoped
 * per-key totals for drill-down tables.
 */
export function sumByKeyInWindow(
  map: Record<string, Record<string, number>> | undefined,
  win: WindowState
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, byDay] of Object.entries(map || {})) {
    let sum = 0;
    for (const [d, v] of Object.entries(byDay)) {
      if (d >= win.startDate && d <= win.endDate) sum += v || 0;
    }
    if (sum > 0) out[k] = sum;
  }
  return out;
}

/**
 * Window-scoped per-model cost + conversation count for the "Models in use"
 * table. Sums the per-day `daily_cost_by_model` / `daily_convs_by_model` maps
 * over the window. Snapshots generated before those maps shipped don't carry
 * them — in that case we fall back to the snapshot-wide `model_totals` (which
 * ignores the window) so old snapshots still render something rather than
 * showing nothing.
 */
export function modelTotalsInWindow(
  chat: ChatBlock | undefined,
  win: WindowState
): Record<string, { cost: number; convs: number }> {
  const costByModel = chat?.daily_cost_by_model;
  const convsByModel = chat?.daily_convs_by_model;
  // Absent OR empty per-day maps → legacy / not-yet-repopulated snapshot (incl.
  // aggregates rolled up before the rollup redeploy, which seed an empty {}).
  // Fall back to the snapshot-wide totals so the table shows the 90d split
  // rather than nothing. Populated maps with no in-window activity correctly
  // return an empty result (handled below).
  const hasDaily = Object.keys(costByModel || {}).length > 0 || Object.keys(convsByModel || {}).length > 0;
  if (!hasDaily) {
    return chat?.model_totals || {};
  }
  const cost = sumByKeyInWindow(costByModel, win);
  const convs = sumByKeyInWindow(convsByModel, win);
  const out: Record<string, { cost: number; convs: number }> = {};
  for (const m of new Set([...Object.keys(cost), ...Object.keys(convs)])) {
    out[m] = { cost: cost[m] || 0, convs: convs[m] || 0 };
  }
  return out;
}

/**
 * Should this conversation appear in the window?
 *
 * A multi-day conv whose started_at is BEFORE the window but last_request_at
 * is inside it still bills cost in-window — so we include those. We also
 * include any conv with first activity inside the window. A conv is excluded
 * only when its entire activity span sits outside the window.
 */
export function topConvInWindow(c: TopConversation, win: WindowState): boolean {
  const start = (c.started_at || '').slice(0, 10);
  const last = (c.last_request_at || '').slice(0, 10);
  const effectiveStart = start || last;
  const effectiveEnd = last || start;
  if (!effectiveStart && !effectiveEnd) return false;
  // Overlap test: conv span [effectiveStart, effectiveEnd] vs window [start, end]
  return effectiveStart <= win.endDate && effectiveEnd >= win.startDate;
}

export function topRunInWindow(r: TopScheduledRun, win: WindowState): boolean {
  const day = (r.completed_at || r.started_at || '').slice(0, 10);
  return day >= win.startDate && day <= win.endDate;
}

export function rollingMA(series: number[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(series.length).fill(null);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < series.length; i++) {
    sum += series[i];
    count++;
    if (i >= window) {
      sum -= series[i - window];
      count = window;
    }
    out[i] = count ? sum / count : null;
  }
  return out;
}

// ─── span helpers ────────────────────────────────────────────────────────

export function topConvSpanSeconds(c: TopConversation): number | null {
  if (c.span_seconds != null) return c.span_seconds;
  if (!c.started_at || !c.last_request_at) return null;
  const a = Date.parse(c.started_at);
  const b = Date.parse(c.last_request_at);
  if (isNaN(a) || isNaN(b)) return null;
  return (b - a) / 1000;
}

export function fmtSpan(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return Math.round(seconds) + 's';
  if (seconds < 3600) return Math.round(seconds / 60) + 'm';
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return h + 'h' + (m ? ' ' + m + 'm' : '');
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.round((seconds % 86400) / 3600);
  return d + 'd' + (h ? ' ' + h + 'h' : '');
}

// ─── month discovery (for the window selector) ───────────────────────────

export function discoverDataMonths(data: DashboardView): string[] {
  const set = new Set<string>();
  Object.keys(data.cost_explorer?.totals_by_day || {}).forEach((d) => set.add(d.slice(0, 7)));
  Object.keys(data.chat?.daily_cost || {}).forEach((d) => set.add(d.slice(0, 7)));
  Object.keys(data.chat?.daily_convs || {}).forEach((d) => set.add(d.slice(0, 7)));
  return Array.from(set).sort().reverse();
}

// ─── identity helpers ────────────────────────────────────────────────────

export function emailOrSub(sub: string | undefined, subToEmail: Record<string, string> | undefined): string {
  if (!sub) return '?';
  const email = subToEmail?.[sub];
  if (email) return email;
  return sub.slice(0, 8) + '…';
}

// ─── palette ─────────────────────────────────────────────────────────────
// Re-export from theme.ts so the dashboard has a single source of truth
// for all colors. Kept the PAL name to avoid touching every callsite.

export { ND_CHART_PAL as PAL } from './theme';

// ─── type guards ─────────────────────────────────────────────────────────

export function isAggregate(data: DashboardView): data is AggregateView {
  return Boolean((data as AggregateView).is_aggregate);
}

export function isClientSnapshot(data: DashboardView): data is ClientSnapshot {
  return !isAggregate(data);
}

// ─── browser-side aggregation ────────────────────────────────────────────

const TOP_KEEP = 50;

/** Sum N daily maps into one (NOT account-deduplicated — for chat metrics). */
function mergeDailyMap<V extends number>(maps: Array<Record<string, V> | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of maps) {
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) out[k] = (out[k] || 0) + (v || 0);
  }
  return out;
}

/**
 * Merge per-day unique-user maps. Each input is {day: count} where count is
 * the # of distinct user_ids on that day for one client. Since user_ids are
 * scoped per Cognito pool (per stack), no user appears in two stacks — so
 * summing is exact.
 */
function mergeDailyUsers(maps: Array<Record<string, number> | undefined>): Record<string, number> {
  return mergeDailyMap(maps);
}

// ─── R&D dev classification ──────────────────────────────────────────────
//
// `dev_instance: true` flags a stack as "developer/demo" in client config —
// but `hq` is special: it's flagged dev because it sits in an arcanum-owned
// account, but operationally it's our internal Numa deployment (Arcanum
// dogfooding the product as if we were a customer). For sidebar grouping +
// `_CLIENTS` aggregation we treat hq like a real client, not an R&D stack.
//
// If we add more "internal client" deployments later, extend INTERNAL_CLIENT_NAMES
// rather than touching every consumer.
const INTERNAL_CLIENT_NAMES = new Set(['hq']);

export function isRandDDevStack(clientName: string | undefined, devInstance: boolean | undefined): boolean {
  if (!devInstance) return false;
  if (clientName && INTERNAL_CLIENT_NAMES.has(clientName)) return false;
  return true;
}

/** Arcanum-owned stacks that act as our own internal Numa deployment, not
 *  customer-facing and not R&D dev. Excluded from `_CLIENTS` aggregate so
 *  customer KPIs don't include Arcanum's own usage. */
export function isInternalClient(clientName: string | undefined): boolean {
  if (!clientName) return false;
  return INTERNAL_CLIENT_NAMES.has(clientName);
}

/**
 * Snapshot pool backing each browser-derived aggregate. Single source of
 * truth so the aggregate's KPIs (computed by aggregateSnapshots) and every
 * per-stack table (Overview "By client", Chat "Per-stack", export by_client)
 * pick the same stacks.
 *
 *   - fleet      → every stack
 *   - clients    → real external customers (not R&D dev, not internal hq)
 *   - nextgen    → account_org === 'nextgen'
 *   - standalone → account_org === 'standalone'
 *   - arcanum    → every Arcanum-owned account (account_org !== 'standalone'):
 *                  HQ + dev/demo + all NextGen. i.e. everything Arcanum pays
 *                  the AWS bill for. Excludes customer-owned standalone accounts.
 */
export function poolForAggregate(snapshots: ClientSnapshot[], aggregateKind: string | undefined): ClientSnapshot[] {
  switch (aggregateKind) {
    case 'clients':
      return snapshots.filter(
        (s) => !isRandDDevStack(s.client, s.client_config?.dev_instance) && !isInternalClient(s.client)
      );
    case 'nextgen':
      return snapshots.filter((s) => s.client_config?.account_org === 'nextgen');
    case 'standalone':
      return snapshots.filter((s) => s.client_config?.account_org === 'standalone');
    case 'arcanum':
      return snapshots.filter((s) => s.client_config?.account_org !== 'standalone');
    case 'fleet':
    default:
      return snapshots;
  }
}

// ─── Numa-attributable cost filter (standalone customer accounts) ───────
//
// Standalone accounts host customer workloads alongside Numa — RDS, OpenSearch,
// QuickSight, etc. Those services would otherwise show up in the Cost
// composition donut as "Numa cost" when they're really the customer's own
// non-Numa spend. Filter pulls just the services Numa actually provisions
// (CDKTF resources are tagged ServiceName=numa, but model-line items like
// "Claude Sonnet" are usage-type lines without tags — a curated allowlist is
// more reliable than tag-filtering CE).
//
// Filter only applies when account_org === 'standalone'. NextGen + Arcanum
// accounts pass through — their entire bill IS Numa COGS so filtering would
// drop legitimate spend like Nolia ECS/VPC infra or Arcanum-org Tax.

export const NUMA_COST_SERVICES: ReadonlySet<string> = new Set([
  // Compute / runtime
  'Amazon Bedrock',
  'Amazon Bedrock AgentCore',
  'Amazon Q',
  'Amazon Q Business',
  'AWS Lambda',
  'AWS Step Functions',
  // Storage
  'Amazon DynamoDB',
  'Amazon Glacier',
  'Amazon SimpleDB',
  'Amazon OpenSearch Serverless', // Bedrock KB backend (NOT the provisioned 'Amazon OpenSearch Service')
  // Edge / API
  'Amazon API Gateway',
  'Amazon CloudFront',
  'Amazon Route 53',
  'Amazon Cognito',
  // Observability + security
  'AmazonCloudWatch',
  'CloudWatch Events',
  'AWS Key Management Service',
  'AWS Secrets Manager',
  'AWS Identity and Access Management',
  // Containers + supporting
  'Amazon EC2 Container Registry (ECR)',
  'Amazon Simple Notification Service',
  'Amazon Simple Queue Service',
  'Amazon Simple Workflow Service',
  'AWS Cost Explorer',
  // Numa app stack
  'Amazon Transcribe',
  'Amazon Comprehend',
  'Amazon Textract',
  'Amazon Simple Email Service',
  //
  // INTENTIONALLY EXCLUDED for standalone accounts:
  //   - Amazon Elastic Container Service / AWS Fargate (Nolia infra only)
  //   - Amazon Virtual Private Cloud (Numa VPC endpoints are cents; large
  //     VPC bills in a standalone account = customer's own VPC)
  //   - Amazon Elastic Load Balancing (Nolia ALB only)
  //   - EC2 - Other (NAT/EBS/ENI — customer-driven in non-Nolia accounts)
  //   - AWS WAF / WAFV2 (Numa's CloudFront WAF is cents; large WAF bills =
  //     customer's own ALB WAF)
  //   - AWS Glue (Numa rarely uses Glue; standalone Glue bills are 100%
  //     customer ETL pipelines — observed at $1,197 in one standalone
  //     customer's 90d, zero in every other standalone)
  //   - Amazon Simple Storage Service (Numa S3 spend per client is $0.10-5
  //     for chat traces + app outputs; standalone S3 bills are dominated
  //     by customer data lake / backups / static assets. Losing ~$30 of
  //     legit Numa S3 to drop ~$700 of customer storage noise is the right
  //     trade.)
  //
  // The filter is applied ONLY when account_org === 'standalone', so
  // nextgen/arcanum accounts (where these are legit Numa infra for Nolia +
  // AgentCore + Bedrock VPC endpoints) still see them in full. When we
  // onboard a standalone Nolia client, add a per-client signal (e.g. a flag
  // in numa-client-metadata) and re-include these for that specific account.
]);

function isNumaAttributableService(svc: string): boolean {
  if (NUMA_COST_SERVICES.has(svc)) return true;
  // Bedrock model line items: 'Claude Sonnet 4.6 (Amazon Bedrock Edition)', etc.
  if (svc.startsWith('Claude ')) return true;
  return false;
}

/**
 * Strip non-Numa services from a per-snapshot CE block for standalone customer
 * accounts. Returns the filtered block plus the dollar amount that was
 * removed (for the dashboard's "$X filtered" badge). Passes through unchanged
 * for nextgen / arcanum / unknown account_org.
 */
function applyCeFilter(
  ce: CostExplorerBlock | undefined,
  accountOrg: ClientConfigSummary['account_org']
): { ce: CostExplorerBlock; droppedTotal: number } {
  const empty: CostExplorerBlock = {
    grand_total: 0,
    totals_by_service: {},
    totals_by_day: {},
    by_service_daily: {},
    bedrock_usage_type_totals: {},
  };
  if (!ce) return { ce: empty, droppedTotal: 0 };
  if (accountOrg !== 'standalone') {
    return { ce, droppedTotal: 0 };
  }

  let droppedTotal = 0;
  const totals_by_service: Record<string, number> = {};
  const by_service_daily: Record<string, Record<string, number>> = {};
  const totals_by_day: Record<string, number> = {};

  for (const [svc, v] of Object.entries(ce.totals_by_service || {})) {
    if (isNumaAttributableService(svc)) {
      totals_by_service[svc] = v || 0;
    } else {
      droppedTotal += v || 0;
    }
  }
  for (const [svc, days] of Object.entries(ce.by_service_daily || {})) {
    if (!isNumaAttributableService(svc)) continue;
    by_service_daily[svc] = { ...days };
    for (const [d, v] of Object.entries(days || {})) {
      totals_by_day[d] = (totals_by_day[d] || 0) + (v || 0);
    }
  }
  // If by_service_daily wasn't present, fall back to scaling totals_by_day by
  // the kept share. Old snapshots — best-effort.
  if (!ce.by_service_daily) {
    const kept = Object.values(totals_by_service).reduce((a, b) => a + b, 0);
    const total = ce.grand_total || 0 || kept + droppedTotal;
    const factor = total > 0 ? kept / total : 0;
    for (const [d, v] of Object.entries(ce.totals_by_day || {})) {
      totals_by_day[d] = (v || 0) * factor;
    }
  }

  const grand_total = Object.values(totals_by_service).reduce((a, b) => a + b, 0);
  return {
    ce: {
      window: ce.window,
      grand_total,
      totals_by_service,
      totals_by_day,
      by_service_daily,
      bedrock_usage_type_totals: ce.bedrock_usage_type_totals,
    },
    droppedTotal,
  };
}

/** Public helper: apply the standalone filter to a single snapshot's CE block. */
export function ceForSnapshot(s: ClientSnapshot): { ce: CostExplorerBlock; droppedTotal: number } {
  return applyCeFilter(s.cost_explorer, s.client_config?.account_org);
}

/**
 * Sum cost-explorer fields, deduplicating by client_account_id. Multiple
 * stacks share an AWS account in the pre-NextGen architecture (e.g. all dev
 * stacks live in the Q-demo account). Without this dedup, that account's
 * spend would be counted N times when computing _FLEET totals.
 *
 * Standalone customer accounts get the Numa-attributable filter applied
 * BEFORE merging so the aggregate donut + grand_total only reflect Numa-driven
 * AWS spend. Stripped amount is surfaced as `non_numa_filtered_total`.
 */
function dedupedCostExplorer(snapshots: ClientSnapshot[]): CostExplorerBlock {
  const seen = new Set<string>();
  let grand_total = 0;
  let non_numa_filtered_total = 0;
  const totals_by_service: Record<string, number> = {};
  const totals_by_day: Record<string, number> = {};
  const by_service_daily: Record<string, Record<string, number>> = {};
  const bedrock_usage_type_totals: Record<string, number> = {};

  for (const s of snapshots) {
    const acct = s.client_config?.client_account_id;
    // No account_id known → count it (better to over-report than to silently
    // drop). Real stacks should always have an account_id.
    const key = acct || `unknown:${s.client}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { ce, droppedTotal } = applyCeFilter(s.cost_explorer, s.client_config?.account_org);
    non_numa_filtered_total += droppedTotal;
    grand_total += ce.grand_total || 0;
    for (const [svc, v] of Object.entries(ce.totals_by_service || {})) {
      totals_by_service[svc] = (totals_by_service[svc] || 0) + (v || 0);
    }
    for (const [d, v] of Object.entries(ce.totals_by_day || {})) {
      totals_by_day[d] = (totals_by_day[d] || 0) + (v || 0);
    }
    for (const [svc, days] of Object.entries(ce.by_service_daily || {})) {
      const bucket = (by_service_daily[svc] ||= {});
      for (const [d, v] of Object.entries(days)) {
        bucket[d] = (bucket[d] || 0) + (v || 0);
      }
    }
    for (const [k, v] of Object.entries(ce.bedrock_usage_type_totals || {})) {
      bedrock_usage_type_totals[k] = (bedrock_usage_type_totals[k] || 0) + (v || 0);
    }
  }

  return {
    grand_total,
    totals_by_service,
    totals_by_day,
    by_service_daily,
    bedrock_usage_type_totals,
    non_numa_filtered_total,
  };
}

function rollupChat(snapshots: ClientSnapshot[]): ChatBlock {
  const days = snapshots[0]?.chat?.window_days || 90;

  // Daily buckets — simple sums across stacks
  const daily_cost = mergeDailyMap(snapshots.map((s) => s.chat?.daily_cost));
  const daily_messages = mergeDailyMap(snapshots.map((s) => s.chat?.daily_messages));
  const daily_convs = mergeDailyMap(snapshots.map((s) => s.chat?.daily_convs));
  const daily_turns = mergeDailyMap(snapshots.map((s) => s.chat?.daily_turns));
  const daily_tool_calls = mergeDailyMap(snapshots.map((s) => s.chat?.daily_tool_calls));
  const daily_active_users = mergeDailyUsers(snapshots.map((s) => s.chat?.daily_active_users));
  const daily_scheduled_count = mergeDailyMap(snapshots.map((s) => s.chat?.daily_scheduled_count));
  const daily_adhoc_count = mergeDailyMap(snapshots.map((s) => s.chat?.daily_adhoc_count));

  // Totals — simple sums of per-client totals
  const totals = {
    cost: 0,
    convs: 0,
    turns: 0,
    requests: 0,
    user_messages: 0,
    errors: 0,
    users: 0,
    tool_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };
  for (const s of snapshots) {
    const t = s.chat?.totals;
    if (!t) continue;
    totals.cost += t.cost || 0;
    totals.convs += t.convs || 0;
    totals.turns += t.turns || 0;
    totals.requests += t.requests || 0;
    totals.user_messages += t.user_messages || 0;
    totals.errors += t.errors || 0;
    totals.users += t.users || 0;
    totals.tool_calls += t.tool_calls || 0;
    totals.input_tokens += t.input_tokens || 0;
    totals.output_tokens += t.output_tokens || 0;
    totals.cache_read_tokens += t.cache_read_tokens || 0;
    totals.cache_creation_tokens += t.cache_creation_tokens || 0;
  }

  // Per-user merge — user_ids are scoped per stack so no key collision
  const by_user: Record<string, PerUserStats> = {};
  for (const s of snapshots) {
    for (const [uid, m] of Object.entries(s.chat?.by_user || {})) {
      by_user[uid] = m;
    }
  }

  // Per-agent — agent_ids are also stack-scoped (live in per-stack DDB tables)
  const by_agent: PerAgentStats[] = [];
  for (const s of snapshots) {
    by_agent.push(...(s.chat?.by_agent || []));
  }
  by_agent.sort((a, b) => b.cost - a.cost);

  // 3-way category merge — sum across stacks (no key collisions, fixed keys)
  const by_category: ByCategoryBlock = {
    agent_run: { convs: 0, cost: 0, user_messages: 0, turns: 0, tool_calls: 0, input_tokens: 0, output_tokens: 0 },
    agent_chat: { convs: 0, cost: 0, user_messages: 0, turns: 0, tool_calls: 0, input_tokens: 0, output_tokens: 0 },
    plain_chat: { convs: 0, cost: 0, user_messages: 0, turns: 0, tool_calls: 0, input_tokens: 0, output_tokens: 0 },
  };
  for (const s of snapshots) {
    const bc = s.chat?.by_category;
    if (!bc) continue;
    for (const k of ['agent_run', 'agent_chat', 'plain_chat'] as const) {
      const src = bc[k];
      if (!src) continue;
      by_category[k].convs += src.convs || 0;
      by_category[k].cost += src.cost || 0;
      by_category[k].user_messages += src.user_messages || 0;
      by_category[k].turns += src.turns || 0;
      by_category[k].tool_calls += src.tool_calls || 0;
      by_category[k].input_tokens += src.input_tokens || 0;
      by_category[k].output_tokens += src.output_tokens || 0;
    }
  }

  // Per-day per-user / per-agent cost maps — user_ids and agent_ids are
  // stack-scoped, so no key collisions. Merge by union.
  const daily_cost_by_user: Record<string, Record<string, number>> = {};
  const daily_messages_by_user: Record<string, Record<string, number>> = {};
  const daily_cost_by_agent: Record<string, Record<string, number>> = {};
  const daily_scheduled_cost_by_agent: Record<string, Record<string, number>> = {};
  const daily_adhoc_cost_by_agent: Record<string, Record<string, number>> = {};
  for (const s of snapshots) {
    for (const [uid, byDay] of Object.entries(s.chat?.daily_cost_by_user || {})) {
      daily_cost_by_user[uid] = { ...(daily_cost_by_user[uid] || {}), ...byDay };
    }
    for (const [uid, byDay] of Object.entries(s.chat?.daily_messages_by_user || {})) {
      daily_messages_by_user[uid] = { ...(daily_messages_by_user[uid] || {}), ...byDay };
    }
    for (const [aid, byDay] of Object.entries(s.chat?.daily_cost_by_agent || {})) {
      daily_cost_by_agent[aid] = { ...(daily_cost_by_agent[aid] || {}), ...byDay };
    }
    for (const [aid, byDay] of Object.entries(s.chat?.daily_scheduled_cost_by_agent || {})) {
      daily_scheduled_cost_by_agent[aid] = { ...(daily_scheduled_cost_by_agent[aid] || {}), ...byDay };
    }
    for (const [aid, byDay] of Object.entries(s.chat?.daily_adhoc_cost_by_agent || {})) {
      daily_adhoc_cost_by_agent[aid] = { ...(daily_adhoc_cost_by_agent[aid] || {}), ...byDay };
    }
  }

  // Per-day per-category — same fixed key set across stacks; sum within
  // each category. (Unlike user/agent maps, day collisions across stacks
  // are real and must be summed, not overwritten.)
  const daily_cost_by_category: Record<string, Record<string, number>> = {};
  const daily_messages_by_category: Record<string, Record<string, number>> = {};
  const daily_convs_by_category: Record<string, Record<string, number>> = {};
  const daily_turns_by_category: Record<string, Record<string, number>> = {};
  const daily_tool_calls_by_category: Record<string, Record<string, number>> = {};
  const mergeIntoCat = (
    target: Record<string, Record<string, number>>,
    src: Record<string, Record<string, number>> | undefined
  ) => {
    for (const [cat, byDay] of Object.entries(src || {})) {
      const t = (target[cat] ||= {});
      for (const [d, v] of Object.entries(byDay)) {
        t[d] = (t[d] || 0) + (v || 0);
      }
    }
  };
  // Per-day per-model — same merge shape as category (day collisions across
  // stacks are real and must be summed). Powers the window-aware Models table
  // for aggregate views (_FLEET / _CLIENTS / _ARCANUM / …).
  const daily_cost_by_model: Record<string, Record<string, number>> = {};
  const daily_convs_by_model: Record<string, Record<string, number>> = {};
  for (const s of snapshots) {
    mergeIntoCat(daily_cost_by_category, s.chat?.daily_cost_by_category);
    mergeIntoCat(daily_messages_by_category, s.chat?.daily_messages_by_category);
    mergeIntoCat(daily_convs_by_category, s.chat?.daily_convs_by_category);
    mergeIntoCat(daily_turns_by_category, s.chat?.daily_turns_by_category);
    mergeIntoCat(daily_tool_calls_by_category, s.chat?.daily_tool_calls_by_category);
    mergeIntoCat(daily_cost_by_model, s.chat?.daily_cost_by_model);
    mergeIntoCat(daily_convs_by_model, s.chat?.daily_convs_by_model);
  }

  // tool / model totals — sum the maps
  const tool_totals: Record<string, number> = {};
  for (const s of snapshots) {
    for (const [k, v] of Object.entries(s.chat?.tool_totals || {})) {
      tool_totals[k] = (tool_totals[k] || 0) + (v || 0);
    }
  }
  const model_totals: Record<string, { cost: number; convs: number }> = {};
  for (const s of snapshots) {
    for (const [k, v] of Object.entries(s.chat?.model_totals || {})) {
      if (!model_totals[k]) model_totals[k] = { cost: 0, convs: 0 };
      model_totals[k].cost += v?.cost || 0;
      model_totals[k].convs += v?.convs || 0;
    }
  }

  // Top conversations — re-sort across all stacks, keep top 50
  const top_conversations: TopConversation[] = [];
  for (const s of snapshots) {
    top_conversations.push(...(s.chat?.top_conversations || []));
  }
  top_conversations.sort((a, b) => b.total_cost_usd - a.total_cost_usd);
  const top = top_conversations.slice(0, TOP_KEEP);

  const scheduled_vs_adhoc = {
    scheduled: { count: 0, cost: 0, turns: 0, requests: 0, user_messages: 0 },
    adhoc: { count: 0, cost: 0, turns: 0, requests: 0, user_messages: 0 },
  };
  for (const s of snapshots) {
    const sv = s.chat?.scheduled_vs_adhoc;
    if (!sv) continue;
    for (const k of ['scheduled', 'adhoc'] as const) {
      scheduled_vs_adhoc[k].count += sv[k]?.count || 0;
      scheduled_vs_adhoc[k].cost += sv[k]?.cost || 0;
      scheduled_vs_adhoc[k].turns += sv[k]?.turns || 0;
      scheduled_vs_adhoc[k].requests += sv[k]?.requests || 0;
      scheduled_vs_adhoc[k].user_messages += sv[k]?.user_messages || 0;
    }
  }

  return {
    window_days: days,
    all_time_count: snapshots.reduce((s, x) => s + (x.chat?.all_time_count || 0), 0),
    top_conversations: top,
    top_conversations_kept: top.length,
    top_conversations_dropped: Math.max(0, top_conversations.length - top.length),
    totals,
    by_user,
    by_agent,
    daily_cost,
    daily_messages,
    daily_convs,
    daily_turns,
    daily_tool_calls,
    daily_active_users,
    daily_scheduled_count,
    daily_adhoc_count,
    daily_cost_by_user,
    daily_messages_by_user,
    daily_cost_by_agent,
    daily_scheduled_cost_by_agent,
    daily_adhoc_cost_by_agent,
    daily_cost_by_category,
    daily_messages_by_category,
    daily_convs_by_category,
    daily_turns_by_category,
    daily_tool_calls_by_category,
    daily_cost_by_model,
    daily_convs_by_model,
    by_category,
    tool_totals,
    model_totals,
    scheduled_vs_adhoc,
  };
}

function rollupSchedules(snapshots: ClientSnapshot[]): SchedulesBlock {
  const out: SchedulesBlock = {
    count: 0,
    rows: [],
    by_status: {},
    by_derived_status: {},
    by_event_type: {},
    by_trigger: {},
    total_runs: 0,
    schedules_with_errors: 0,
    projected_runs_per_month_total: 0,
  };
  for (const s of snapshots) {
    const sb = s.schedules;
    if (!sb) continue;
    out.count += sb.count || 0;
    out.total_runs += sb.total_runs || 0;
    out.schedules_with_errors += sb.schedules_with_errors || 0;
    out.projected_runs_per_month_total += sb.projected_runs_per_month_total || 0;
    for (const r of sb.rows || []) out.rows.push(r);
    for (const k of Object.keys(sb.by_status || {})) {
      out.by_status[k] = (out.by_status[k] || 0) + (sb.by_status[k] || 0);
    }
    for (const k of Object.keys(sb.by_derived_status || {})) {
      out.by_derived_status[k] = (out.by_derived_status[k] || 0) + (sb.by_derived_status[k] || 0);
    }
    for (const k of Object.keys(sb.by_event_type || {})) {
      out.by_event_type![k] = (out.by_event_type![k] || 0) + (sb.by_event_type![k] || 0);
    }
    for (const k of Object.keys(sb.by_trigger || {})) {
      out.by_trigger![k] = (out.by_trigger![k] || 0) + (sb.by_trigger![k] || 0);
    }
  }
  return out;
}

function rollupScheduledRuns(snapshots: ClientSnapshot[]): ScheduledRunsBlock {
  const top_runs: TopScheduledRun[] = [];
  const totals = { count: 0, cost: 0, turns: 0 };
  const by_status: Record<string, number> = {};
  const by_agent: Record<
    string,
    { agent_id: string; agent_title?: string; runs: number; cost: number; turns: number; errors: number }
  > = {};
  const daily_runs: Record<string, number> = {};
  const daily_cost: Record<string, number> = {};

  for (const s of snapshots) {
    const sr = s.scheduled_runs;
    if (!sr) continue;
    top_runs.push(...(sr.top_runs || []));
    totals.count += sr.totals?.count || 0;
    totals.cost += sr.totals?.cost || 0;
    totals.turns += sr.totals?.turns || 0;
    for (const [k, v] of Object.entries(sr.by_status || {})) {
      by_status[k] = (by_status[k] || 0) + (v || 0);
    }
    for (const [aid, m] of Object.entries(sr.by_agent || {})) {
      if (!by_agent[aid]) by_agent[aid] = { ...m, runs: 0, cost: 0, turns: 0, errors: 0 };
      by_agent[aid].runs += m.runs || 0;
      by_agent[aid].cost += m.cost || 0;
      by_agent[aid].turns += m.turns || 0;
      by_agent[aid].errors += m.errors || 0;
    }
    for (const [d, v] of Object.entries(sr.daily_runs || {})) {
      daily_runs[d] = (daily_runs[d] || 0) + (v || 0);
    }
    for (const [d, v] of Object.entries(sr.daily_cost || {})) {
      daily_cost[d] = (daily_cost[d] || 0) + (v || 0);
    }
  }

  top_runs.sort((a, b) => (b.cost || 0) - (a.cost || 0));
  const top = top_runs.slice(0, TOP_KEEP);

  return {
    top_runs: top,
    top_runs_kept: top.length,
    top_runs_dropped: Math.max(0, top_runs.length - top.length),
    totals,
    by_status,
    by_agent,
    daily_runs,
    daily_cost,
  };
}

/**
 * Window-aware per-client rows for the aggregate "By client" table.
 *
 * Columns split by what daily data we have:
 *   - ce_total / chat_cost / convs / user_messages / scheduled_runs → summed
 *     from per-day buckets sliced by the window
 *   - active_users → max of daily_active_users in window (peak in window —
 *     summing days would over-count multi-day users; we don't have unique-set
 *     per arbitrary window)
 *   - schedules / agents / kbs / integrations / provisioned_users →
 *     snapshot-wide concepts, not time-bounded, shown as-is
 *   - time_saved_minutes → pro-rated from the snapshot total by the share of
 *     runs that fell inside the window (impact is run × agent-minutes-saved,
 *     so this is an approximation; exact requires per-day per-agent runs)
 */
export function buildByClientRowsWindowed(snapshots: ClientSnapshot[], win: WindowState): ByClientRow[] {
  return snapshots
    .map((s) => {
      const cfg = s.client_config || {};
      // Apply Numa-attributable filter to standalone customer accounts so the
      // "By client" ce_total only reflects Numa-driven AWS spend (not the
      // customer's own RDS/OpenSearch/QuickSight workloads). Pass-through for
      // nextgen/arcanum.
      const { ce } = applyCeFilter(s.cost_explorer, cfg.account_org);
      const sched = s.schedules || ({} as SchedulesBlock);
      const ag = s.agents || {};
      const intg = s.integrations || {};
      const usr = s.users || {};
      const pd = s.pipedream || {};
      const impact = s.impact || ({} as { total_time_saved_minutes?: number });

      const ce_total = sumDailyInWindow(ce.totals_by_day, win);
      const chat_cost = sumDailyInWindow(s.chat?.daily_cost, win);
      const convs = sumDailyInWindow(s.chat?.daily_convs, win);
      const user_messages = sumDailyInWindow(s.chat?.daily_messages, win);
      const scheduled_runs_in_window = sumDailyInWindow(s.scheduled_runs?.daily_runs, win);

      // Peak daily active users inside the window — closest unique-user proxy
      // we have without storing per-day user sets.
      let active_users = 0;
      for (const [d, v] of Object.entries(s.chat?.daily_active_users || {})) {
        if (d >= win.startDate && d <= win.endDate && v > active_users) active_users = v;
      }

      // Pro-rate snapshot-wide time saved by the windowed share of runs.
      const totalRuns = s.scheduled_runs?.totals?.count || 0;
      const totalTimeSaved = impact.total_time_saved_minutes || 0;
      const time_saved_minutes = totalRuns ? Math.round((totalTimeSaved * scheduled_runs_in_window) / totalRuns) : 0;

      return {
        client: s.client,
        dev_instance: Boolean(cfg.dev_instance),
        ce_total,
        chat_cost,
        convs,
        user_messages,
        active_users,
        provisioned_users: usr.provisioned_users || 0,
        schedules: sched.count || 0,
        active_schedules: sched.by_derived_status?.active || 0,
        scheduled_runs: scheduled_runs_in_window,
        agents: (ag.agents?.count || 0) + (ag.user_agents?.count || 0),
        kbs: intg.knowledge_bases?.count || 0,
        integrations: pd.distinct_active_apps || 0,
        time_saved_minutes,
        bedrock_account: cfg.bedrock_account,
        region: cfg.region,
        client_account_id: cfg.client_account_id,
      };
    })
    .sort((a, b) => b.ce_total - a.ce_total);
}

function buildByClientRows(snapshots: ClientSnapshot[]): ByClientRow[] {
  return snapshots
    .map((s) => {
      const cfg = s.client_config || {};
      // See buildByClientRowsWindowed — same Numa-attributable filtering.
      const { ce } = applyCeFilter(s.cost_explorer, cfg.account_org);
      const chat = s.chat?.totals || ({} as ChatBlock['totals']);
      const sched = s.schedules || ({} as SchedulesBlock);
      const sruns = s.scheduled_runs?.totals || { count: 0, cost: 0, turns: 0 };
      const ag = s.agents || {};
      const intg = s.integrations || {};
      const usr = s.users || {};
      const pd = s.pipedream || {};
      const impact = s.impact || ({} as { total_time_saved_minutes?: number });
      return {
        client: s.client,
        dev_instance: Boolean(cfg.dev_instance),
        ce_total: ce.grand_total || 0,
        chat_cost: chat.cost || 0,
        convs: chat.convs || 0,
        user_messages: chat.user_messages || 0,
        active_users: chat.users || 0,
        provisioned_users: usr.provisioned_users || 0,
        schedules: sched.count || 0,
        active_schedules: sched.by_derived_status?.active || 0,
        scheduled_runs: sruns.count || 0,
        agents: (ag.agents?.count || 0) + (ag.user_agents?.count || 0),
        kbs: intg.knowledge_bases?.count || 0,
        integrations: pd.distinct_active_apps || 0,
        time_saved_minutes: impact.total_time_saved_minutes || 0,
        bedrock_account: cfg.bedrock_account,
        region: cfg.region,
        client_account_id: cfg.client_account_id,
      };
    })
    .sort((a, b) => b.ce_total - a.ce_total);
}

function dist(values: number[]): DistributionStats {
  if (!values.length) return { min: 0, median: 0, mean: 0, max: 0, p90: 0 };
  const vs = [...values].sort((a, b) => a - b);
  const median = vs.length % 2 ? vs[(vs.length - 1) >> 1] : (vs[vs.length / 2 - 1] + vs[vs.length / 2]) / 2;
  const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
  const p90 = vs[Math.min(vs.length - 1, Math.floor(vs.length * 0.9))];
  return { min: vs[0], median, mean, max: vs[vs.length - 1], p90 };
}

function detectOutliers(rows: ByClientRow[]) {
  if (rows.length < 3) return [];
  const out: Array<{ client: string; metric: string; value: number; mean: number; z_score: number }> = [];
  for (const [metric, key] of [
    ['ce_total', 'ce_total'],
    ['chat_cost', 'chat_cost'],
  ] as const) {
    const vals = rows.map((r) => r[key]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance);
    if (std === 0) continue;
    for (const r of rows) {
      const z = (r[key] - mean) / std;
      if (z > 2) out.push({ client: r.client, metric, value: r[key], mean, z_score: z });
    }
  }
  return out;
}

/**
 * Roll N per-client snapshots into one synthetic AggregateView.
 * CE totals are deduped by client_account_id (multiple stacks can share one
 * AWS account in the pre-NextGen architecture). Chat / users / schedules
 * are summed per-stack.
 */
export function aggregateSnapshots(snapshots: ClientSnapshot[], opts: { key: string; kind: string }): AggregateView {
  const stack_count = snapshots.length;
  const unique_accounts = new Set<string>();
  for (const s of snapshots) {
    if (s.client_config?.client_account_id) unique_accounts.add(s.client_config.client_account_id);
  }

  const by_client = buildByClientRows(snapshots);

  let users_active_30d = 0;
  let users_provisioned = 0;
  let agents = 0;
  let kbs = 0;
  let time_saved_minutes = 0;
  let total_schedule_runs = 0;
  let active_schedules = 0;
  // Fleet-wide pipedream rollup: group by_app_active across all stacks.
  // user_subs are stack-scoped (Cognito pool per stack) so summing
  // user_counts across stacks gives the true total of user-app links.
  let total_active_connections = 0;
  let total_users_queried = 0;
  let total_users_with_data = 0;
  let total_users_with_errors = 0;
  const apps_by_name: Record<
    string,
    { app_name: string; user_count: number; stack_count: number; user_subs: string[] }
  > = {};
  for (const s of snapshots) {
    users_active_30d += s.users?.modified_in_last_30d || 0;
    users_provisioned += s.users?.provisioned_users || 0;
    agents += (s.agents?.agents?.count || 0) + (s.agents?.user_agents?.count || 0);
    kbs += s.integrations?.knowledge_bases?.count || 0;
    time_saved_minutes += s.impact?.total_time_saved_minutes || 0;
    total_schedule_runs += s.schedules?.total_runs || 0;
    active_schedules += s.schedules?.by_derived_status?.active || 0;
    const pd = s.pipedream;
    if (pd) {
      total_active_connections += pd.active_connections || 0;
      total_users_queried += pd.users_queried || 0;
      total_users_with_data += pd.users_with_data || 0;
      total_users_with_errors += pd.users_with_errors || 0;
      for (const a of pd.by_app_active || []) {
        const slot = (apps_by_name[a.app_name] ||= {
          app_name: a.app_name,
          user_count: 0,
          stack_count: 0,
          user_subs: [],
        });
        slot.user_count += a.user_count || 0;
        slot.stack_count += 1;
        if (Array.isArray(a.user_subs)) slot.user_subs.push(...a.user_subs);
      }
    }
  }
  const by_app_active = Object.values(apps_by_name).sort(
    (a, b) => b.user_count - a.user_count || a.app_name.localeCompare(b.app_name)
  );

  const chat = rollupChat(snapshots);
  const cost_explorer = dedupedCostExplorer(snapshots);

  return {
    client: opts.key,
    is_aggregate: true,
    aggregate_kind: opts.kind,
    generated_at: new Date().toISOString(),
    window_days: snapshots[0]?.window_days || 90,
    stack_count,
    unique_account_count: unique_accounts.size,
    cost_explorer,
    chat,
    schedules: rollupSchedules(snapshots),
    scheduled_runs: rollupScheduledRuns(snapshots),
    agents: { agents: { count: agents, rows: [] }, user_agents: { count: 0, rows: [] } },
    integrations: { knowledge_bases: { count: kbs, rows: [] } },
    users: {
      modified_in_last_30d: users_active_30d,
      provisioned_users: users_provisioned,
    },
    pipedream: {
      users_queried: total_users_queried,
      users_with_data: total_users_with_data,
      users_with_errors: total_users_with_errors,
      active_connections: total_active_connections,
      distinct_active_apps: by_app_active.length,
      by_app_active,
    },
    impact: {
      total_time_saved_minutes: time_saved_minutes,
      per_agent_runs: {},
      total_schedule_runs,
      total_agents: agents,
      total_schedules: by_client.reduce((s, r) => s + r.schedules, 0),
      active_schedules,
    },
    by_client,
    per_stack_averages: stack_count
      ? {
          ce_total: cost_explorer.grand_total / unique_accounts.size || 0,
          chat_cost: chat.totals.cost / stack_count,
          active_users: chat.totals.users / stack_count,
          convs: chat.totals.convs / stack_count,
          user_messages: chat.totals.user_messages / stack_count,
          turns: chat.totals.turns / stack_count,
          tool_calls: chat.totals.tool_calls / stack_count,
          schedules: by_client.reduce((s, r) => s + r.schedules, 0) / stack_count,
          agents: agents / stack_count,
          kbs: kbs / stack_count,
          time_saved_minutes: time_saved_minutes / stack_count,
        }
      : {
          ce_total: 0,
          chat_cost: 0,
          active_users: 0,
          convs: 0,
          user_messages: 0,
          turns: 0,
          tool_calls: 0,
          schedules: 0,
          agents: 0,
          kbs: 0,
          time_saved_minutes: 0,
        },
    distributions: {
      ce_total: dist(by_client.map((r) => r.ce_total)),
      chat_cost: dist(by_client.map((r) => r.chat_cost)),
      convs: dist(by_client.map((r) => r.convs)),
      active_users: dist(by_client.map((r) => r.active_users)),
      user_messages: dist(by_client.map((r) => r.user_messages)),
      schedules: dist(by_client.map((r) => r.schedules)),
    },
    outliers: detectOutliers(by_client),
  };
}

// ─── Shared-account groups ───────────────────────────────────────────────
//
// Why this exists: AWS Cost Explorer is per-account. When multiple Numa stacks
// live in the same AWS account (the dev/demo herd in Q-demo, the HQ-org
// arcanum-prod-* stacks, the quota-sharing accounts), each stack's snapshot
// sees the SAME CE numbers — they're just account-wide spend, not per-stack.
// At the aggregate level dedupedCostExplorer correctly counts each account
// once. At the per-stack level the numbers are misleading: arcanum-prod-
// numa-demo says it has $11,627 of CE when really $0 of conversations ran
// there.
//
// Solution: surface the implicit "account group" as a first-class view. Pick
// the group from the sidebar → see the account's total CE once, plus a
// per-stack breakdown of the per-stack data (chat trace cost, convs, users)
// so you can see who's actually using the shared account.

export interface SharedAccountGroup {
  /** Stable selection key: `account:<accountId>` */
  key: string;
  /** AWS account id (12 digits) */
  accountId: string;
  /** Short display label, e.g. "Q-demo (7 stacks)" / "Account ...3471 (3 stacks)" */
  label: string;
  /** Names of every stack in this account */
  stackNames: string[];
  /** Per-stack snapshots (handy for the aggregate builder) */
  stacks: ClientSnapshot[];
  /** Account-wide CE total (the same number across all stack snapshots — picked once) */
  ce_total: number;
  /** Summed chat trace cost across stacks (real per-stack data, summed) */
  chat_cost_summed: number;
}

/**
 * Friendly account labels for accounts we know by name. Exported so the
 * "By client" table/chart can collapse multi-stack accounts under one row
 * using the same names.
 */
export const KNOWN_ACCOUNTS: Record<string, string> = {
  '905418183804': 'Q-demo',
  '619071323471': 'HQ + Trial',
  '978450690680': 'Quota sharing',
};

/** Return a friendly group name for an AWS account, falling back to a
 *  "Account …XXXX" placeholder. */
export function friendlyAccountName(accountId: string | undefined | null): string {
  if (!accountId) return 'Unknown account';
  return KNOWN_ACCOUNTS[accountId] || `Account …${accountId.slice(-4)}`;
}

/**
 * Group snapshots by shared AWS account. Only emits groups with 2+ stacks —
 * single-stack accounts don't need a synthetic view (the per-stack page IS
 * the account view).
 *
 * NextGen accounts are excluded: by design every NextGen client gets its own
 * AWS account, so a "shared NextGen account" is a misconfiguration to fix at
 * the source, not a state worth normalising in the UI. Only arcanum-org
 * accounts (the dev/demo/HQ herd, quota-sharing accounts) — plus any
 * standalone customer that legitimately runs multiple stacks in one of
 * their accounts — surface here.
 */
export function buildSharedAccountGroups(snapshots: ClientSnapshot[]): SharedAccountGroup[] {
  const byAccount: Record<string, ClientSnapshot[]> = {};
  for (const s of snapshots) {
    const acct = s.client_config?.client_account_id;
    if (!acct) continue;
    (byAccount[acct] ||= []).push(s);
  }
  const groups: SharedAccountGroup[] = [];
  for (const [accountId, stacks] of Object.entries(byAccount)) {
    if (stacks.length < 2) continue;
    // Skip if any stack is NextGen — NextGen is one-account-per-client by
    // design, so sharing is a config error to investigate separately.
    if (stacks.some((s) => s.client_config?.account_org === 'nextgen')) continue;
    // Every stack snapshot in the same account carries the same CE total —
    // pick the first one. (Defensively: max across stacks in case rollups
    // straddled a CE update window.)
    const ceTotal = stacks.reduce((m, s) => Math.max(m, s.cost_explorer?.grand_total || 0), 0);
    const chatSum = stacks.reduce((sum, s) => sum + (s.chat?.totals?.cost || 0), 0);
    const known = KNOWN_ACCOUNTS[accountId];
    const label = known
      ? `${known} (${stacks.length} stacks)`
      : `Account …${accountId.slice(-4)} (${stacks.length} stacks)`;
    groups.push({
      key: `account:${accountId}`,
      accountId,
      label,
      stackNames: stacks.map((s) => s.client).sort(),
      stacks,
      ce_total: ceTotal,
      chat_cost_summed: chatSum,
    });
  }
  // Sort by total CE descending — the noisiest accounts surface first.
  groups.sort((a, b) => b.ce_total - a.ce_total);
  return groups;
}

/**
 * Find siblings of `s` — other snapshots sharing the same AWS account. Used
 * by per-stack OverviewTab to warn the operator that CE figures are shared
 * across stacks. Returns [] for non-shared accounts.
 */
export function siblingStacksFor(s: ClientSnapshot, all: ClientSnapshot[]): ClientSnapshot[] {
  const acct = s.client_config?.client_account_id;
  if (!acct) return [];
  return all.filter((x) => x.client !== s.client && x.client_config?.client_account_id === acct);
}
