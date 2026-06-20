import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

// Per-client credit ledger (Numa Credit System / SPK-015).
const TABLE_NAME = process.env.CREDITS_TABLE_NAME as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;

const ddb = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}));

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

type JwtClaims = { [key: string]: unknown; 'cognito:groups'?: string[] };

function parseJwt(token: string): JwtClaims {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as JwtClaims;
  } catch {
    return {} as JwtClaims;
  }
}

function isAdmin(event: { headers?: Record<string, string | undefined> }): boolean {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return false;
  const token = String(auth).replace(/^Bearer\s+/i, '');
  const groups: string[] = (parseJwt(token)['cognito:groups'] as string[]) || [];
  return groups.includes('admin');
}

// The caller's Cognito sub (from the access token). Used to ownership-check the per-conversation
// credit-tier endpoint so a user can only read their OWN conversation's tier.
function callerSub(event: { headers?: Record<string, string | undefined> }): string | null {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return null;
  const sub = parseJwt(String(auth).replace(/^Bearer\s+/i, ''))['sub'];
  return typeof sub === 'string' ? sub : null;
}

const clientPk = (): string => `CLIENT#${CLIENT_NAME}`;

// ── Billing-admin membership (Numa Credit System) ────────────────────────────────────────────────
// Who may SEE credit data, stored as BILLING_ADMIN#<sub> rows on the CLIENT# partition. Deliberately
// NOT a Cognito group: admins hold cognito-idp:AdminAddUserToGroup client-side, so a group would be
// self-grantable. Admin browser creds can't write this table, so the ONLY way in is a caller-checked
// server write (this Lambda) or the Customer Success Portal (assume-role) — enforcing "only a billing
// admin promotes another", with Arcanum bootstrapping the first via the portal.
const billingAdminSk = (sub: string): string => `BILLING_ADMIN#${sub}`;

type BillingAdmin = { sub: string; email: string | null; grantedBy: string | null; grantedAt: string | null };

async function listBillingAdmins(): Promise<BillingAdmin[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': clientPk(), ':sk': 'BILLING_ADMIN#' },
    })
  );
  return (res.Items ?? []).map((it) => ({
    sub: String(it.sub ?? String(it.SK).slice('BILLING_ADMIN#'.length)),
    email: it.email ? String(it.email) : null,
    grantedBy: it.grantedBy ? String(it.grantedBy) : null,
    grantedAt: it.grantedAt ? String(it.grantedAt) : null,
  }));
}

async function isBillingAdmin(event: { headers?: Record<string, string | undefined> }): Promise<boolean> {
  const sub = callerSub(event);
  if (!sub) return false;
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: clientPk(), SK: billingAdminSk(sub) } })
  );
  return !!res.Item;
}

// ── Pricing-policy defaults — MUST mirror lib/credit-pricing (credits.py + tiers.py). The Credit
// Admin tab edits these; the debit Lambda reads the CONFIG row at meter time. AWS token rates are
// deliberately NOT editable (billing facts, not policy knobs).
const TIERS = ['low', 'medium', 'high', 'very_high'] as const;
// Ordinal rank for the value-tier ratchet — mirrors lib/credit-pricing tiers.py TIER_RANK. Used by
// the per-agent stats endpoint to pick a run-set's dominant (highest) tier. Unknown/empty ranks 0.
const TIER_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, very_high: 4 };
// The higher-complexity of two tiers (unknown ranks lowest); result is always a valid tier.
function maxTier(a: string | null, b: string | null): string {
  const ra = TIER_RANK[a || ''] || 0;
  const rb = TIER_RANK[b || ''] || 0;
  const winner = ra >= rb ? a : b;
  return winner && (TIERS as readonly string[]).includes(winner) ? winner : 'low';
}
const CONTEXTS = ['chat', 'agent'] as const;
const DEFAULT_CONFIG = {
  creditUsd: 0.3, // ~NZD $0.50/credit @ FX 1.69 — the NZD-anchored default
  margin: 2.0, // scalar fallback (unclassified); per-tier marginsByTier below are the real defence
  trivialConsumptionUsd: 0.01,
  // Value tiers in half-credit steps; the cost-recovery floor rounds up to 0.1 credit. Agent stays cheaper than chat at every tier.
  valueTiers: {
    chat: { low: 1, medium: 2, high: 5, very_high: 8 },
    agent: { low: 0.5, medium: 1.5, high: 3, very_high: 5 },
  },
  // Per-tier cost-recovery (defence) margin (the floor), scaling UP with complexity so cheap work
  // isn't punished and premium work keeps a fuller margin.
  marginsByTier: { low: 1.1, medium: 1.25, high: 1.4, very_high: 1.6 },
  // Monthly credit allocation (Jan..Dec). Credits granted per calendar month; UNUSED CREDITS EXPIRE
  // at month end (no rollover). Defaults to the new-client starter plan (2000/mo ≈ NZD $1,015) so a
  // fresh client meters against a real allowance; portal-set allocations override this.
  monthlyAllocations: [2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000],
} as const;

type ValueTiers = Record<string, Record<string, number>>;
type CreditConfig = {
  creditUsd: number;
  margin: number;
  trivialConsumptionUsd: number;
  valueTiers: ValueTiers;
  marginsByTier: Record<string, number>;
  monthlyAllocations: number[];
};

// Effective config = stored overrides overlaid on defaults (missing key -> default).
function effectiveConfig(stored?: Record<string, unknown>): CreditConfig {
  const s = stored ?? {};
  const storedTiers = (s.valueTiers as ValueTiers | undefined) ?? {};
  const valueTiers: ValueTiers = {};
  for (const ctx of CONTEXTS) {
    valueTiers[ctx] = {};
    for (const tier of TIERS) {
      valueTiers[ctx][tier] = Number(storedTiers[ctx]?.[tier] ?? DEFAULT_CONFIG.valueTiers[ctx][tier]);
    }
  }
  const storedMargins = (s.marginsByTier as Record<string, number> | undefined) ?? {};
  const marginsByTier: Record<string, number> = {};
  for (const tier of TIERS) {
    marginsByTier[tier] = Number(storedMargins[tier] ?? DEFAULT_CONFIG.marginsByTier[tier]);
  }
  const storedAlloc = Array.isArray(s.monthlyAllocations) ? (s.monthlyAllocations as unknown[]) : [];
  const monthlyAllocations: number[] = Array.from({ length: 12 }, (_, i) => {
    const n = Number(storedAlloc[i]);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  return {
    creditUsd: Number(s.creditUsd ?? DEFAULT_CONFIG.creditUsd),
    margin: Number(s.margin ?? DEFAULT_CONFIG.margin),
    trivialConsumptionUsd: Number(s.trivialConsumptionUsd ?? DEFAULT_CONFIG.trivialConsumptionUsd),
    valueTiers,
    marginsByTier,
    monthlyAllocations,
  };
}

// Config validation/write now lives in the Customer Success Portal (the central authoring surface);
// this Lambda is read-only for pricing config (validateConfig retired with the POST write path).

// Current NZ billing month (YYYY-MM). The credit system bills on one calendar — Pacific/Auckland —
// for all clients, matching how credit-debit buckets months. The TZ only decides the month boundary.
const currentMonth = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' }).slice(0, 7);

// Admin-safe projection of a META row. NEVER returns internal cost/token fields or chat content —
// admins see what was done, by whom, over what span, and what it cost in credits. userSub is
// included (admins legitimately see who ran each conversation; the route is admin-gated); the
// frontend resolves it to an email/name. firstTs/lastTs give the conversation's wall-clock span.
function toAdminRow(item: Record<string, unknown>): Record<string, unknown> {
  return {
    conversationId: String(item.PK || '').replace(/^CONV#/, ''),
    // title + deliverables are the anonymised, admin-safe labels written by the nightly summariser;
    // empty until it runs (frontend shows a "anonymised summary coming overnight" placeholder).
    title: item.title ?? '',
    deliverables: Array.isArray(item.deliverables) ? item.deliverables : [],
    dominantTier: item.dominantTier ?? 'unclassified',
    creditsCharged: item.creditsCharged ?? 0,
    msgCount: item.msgCount ?? 0,
    source: item.source ?? 'chat',
    // agentId present on agent / scheduled runs; the frontend joins it to the agent's name.
    agentId: item.agentId ?? null,
    userSub: item.userSub ?? null,
    firstTs: item.firstTs ?? null,
    lastTs: item.lastTs ?? null,
  };
}

// Full breakdown for the Credit Admin tab (admin-only, ?full=1): adds cost + token + margin telemetry
// on top of the admin-safe row. Still NO chat content. Never used by the read-only Credits receipt.
function toAdminFullRow(item: Record<string, unknown>): Record<string, unknown> {
  return {
    ...toAdminRow(item),
    consumptionCostUsd: Number(item.consumptionCostUsd ?? 0),
    totalTokens: Number(item.totalTokens ?? 0),
    creditsValue: Number(item.creditsValue ?? 0),
    creditsFloor: Number(item.creditsFloor ?? 0),
    marginVsConsumption: item.marginVsConsumption ?? null,
    costIncomplete: !!item.costIncomplete,
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path || '';
  if (method === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  try {
    if (!TABLE_NAME || !CLIENT_NAME) {
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    // GET /credits/conversation?id=<conversationId> -> the credit tier of the caller's OWN
    // conversation, for the in-chat credit indicator. NOT admin-gated (any user sees the tier of
    // their own chats), but ownership-checked: the caller's JWT sub must match the conversation's
    // userSub. Returns ONLY tier + credits (no cost/token internals, no chat content). The tier is
    // the ratcheted dominantTier written by credit-debit, so it lags a few seconds behind a turn and
    // is unrated (classified:false) on a brand-new conversation not yet metered.
    if (method === 'GET' && /\/credits\/conversation\/?$/.test(path)) {
      const sub = callerSub(event);
      if (!sub) {
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const conversationId = event.queryStringParameters?.id;
      if (!conversationId) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing id' }) };
      }
      const res = await ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND SK = :sk',
          ExpressionAttributeValues: { ':pk': `CONV#${conversationId}`, ':sk': 'META' },
          Limit: 1,
        })
      );
      const item = res.Items?.[0];
      // No META yet (not metered) -> report unrated rather than 404, so the indicator can show a
      // neutral "rating…" state on a fresh chat instead of an error.
      if (!item) {
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ classified: false }) };
      }
      // Ownership check — never expose another user's conversation tier.
      if (item.userSub && item.userSub !== sub) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
      }
      const tier =
        typeof item.dominantTier === 'string' && (TIERS as readonly string[]).includes(item.dominantTier)
          ? item.dominantTier
          : null;
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({
          classified: tier !== null,
          tier,
          source: item.source ?? 'chat',
          creditsCharged: Number(item.creditsCharged ?? 0),
        }),
      };
    }

    // GET /credits/balance -> live drawdown standing. Billing-admin only (exposes the spend signal);
    // a plain admin gets 403 'not_billing_admin' and the UI shows the lock screen.
    if (method === 'GET' && /\/credits\/balance\/?$/.test(path)) {
      if (!(await isBillingAdmin(event))) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'not_billing_admin' }) };
      }
      // One CLIENT# partition query returns CONFIG + MONTH# aggregates + TXN# event log together, so we
      // can derive the Option-B drawdown waterfall here (same logic as the portal's getStanding):
      //   balance = Σ TXN credits − overflow of months not yet settled by the nightly job.
      const month = currentMonth();
      const monthIndex = Number(month.slice(5, 7)) - 1; // 0=Jan .. 11=Dec
      const part = await ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': clientPk() },
        })
      );
      const items = part.Items ?? [];
      const cfgItem = items.find((it) => it.SK === 'CONFIG');
      const cfg = effectiveConfig(cfgItem);
      const txns = items.filter((it) => String(it.SK).startsWith('TXN#'));
      const settledBalance = txns.reduce((sum, t) => sum + Number(t.credits ?? 0), 0);
      const settledMonths = new Set(
        txns.filter((t) => t.txnKind === 'settlement' && t.month).map((t) => String(t.month))
      );
      let liveOverflow = 0;
      let consumed = 0;
      for (const it of items) {
        const sk = String(it.SK ?? '');
        if (!sk.startsWith('MONTH#')) continue;
        const m = sk.slice('MONTH#'.length);
        const mIdx = Number(m.slice(5, 7)) - 1;
        const used =
          it.creditsCharged != null
            ? Number(it.creditsCharged)
            : cfg.creditUsd
              ? Math.round(Number(it.creditRevenueUsd ?? 0) / cfg.creditUsd)
              : 0;
        const alloc =
          it.allocationSnapshot != null ? Number(it.allocationSnapshot) : (cfg.monthlyAllocations[mIdx] ?? 0);
        if (m === month) consumed = used;
        if (!settledMonths.has(m)) liveOverflow += Math.max(0, used - Math.max(0, alloc));
      }
      const availableBalance = settledBalance - Math.max(0, liveOverflow);
      const allocation = cfg.monthlyAllocations[monthIndex] ?? 0;
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({
          balance: availableBalance, // live: settled events minus unsettled overflow (can be negative)
          settledBalance,
          liveOverflow,
          txns: txns
            .map((t) => ({
              kind: String(t.txnKind ?? ''),
              credits: Number(t.credits ?? 0),
              month: t.month ? String(t.month) : undefined,
              createdAt: String(t.createdAt ?? ''),
              createdBy: t.createdBy ? String(t.createdBy) : undefined,
              note: t.note ? String(t.note) : undefined,
            }))
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
          config: {
            defaults: DEFAULT_CONFIG,
            current: cfg,
            isCustom: !!cfgItem,
            updatedAt: (cfgItem?.updatedAt as string) ?? null,
          },
          monthly: {
            month,
            monthIndex,
            allocation,
            consumed,
            remaining: allocation - consumed,
            allocations: cfg.monthlyAllocations,
          },
        }),
      };
    }

    // GET /credits/ledger?month=YYYY-MM -> this month's conversations (admin-safe rows, newest first).
    // Billing-admin only (same gate as balance).
    if (method === 'GET' && /\/credits\/ledger\/?$/.test(path)) {
      if (!(await isBillingAdmin(event))) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'not_billing_admin' }) };
      }
      const month = event.queryStringParameters?.month || currentMonth();
      const res = await ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: { ':pk': `MONTH#${month}` },
        })
      );
      const full = event.queryStringParameters?.full === '1';
      const items = (res.Items || []).map(full ? toAdminFullRow : toAdminRow);
      // GSI2 sorts by conversation id; present newest-first by lastTs for the admin view.
      items.sort((a, b) => String(b.lastTs ?? '').localeCompare(String(a.lastTs ?? '')));
      const totalCredits = items.reduce((sum, r) => sum + Number(r.creditsCharged ?? 0), 0);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ month, totalCredits, items }) };
    }

    // GET /credits/agent-stats?agentId=<id>&months=<N> -> per-agent credit analytics for the agent
    // card's Credits section (FEAT-246). Queries the sparse GSI3 (AGENT#<agentId>) over the last N
    // calendar months. ACCESS MODEL: a normal caller always sees their OWN usage of the agent
    // (scope:'own', rows filtered to the caller's sub); a BILLING ADMIN additionally gets the
    // all-users aggregate + a per-user breakdown (scope:'all', byUser populated). PRIVACY FENCE: this
    // returns credits + value tier ONLY — never consumptionCostUsd / token / margin telemetry (those
    // stay internal on the META row). Historical rows metered before the GSI3 keys shipped have no
    // GSI3 keys (no v1 backfill), so a long-lived agent's numbers start from the change going forward.
    if (method === 'GET' && /\/credits\/agent-stats\/?$/.test(path)) {
      const sub = callerSub(event);
      if (!sub) {
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const agentId = event.queryStringParameters?.agentId;
      if (!agentId) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing agentId' }) };
      }
      // Window: N calendar months back from the current NZ month (default 6, clamped 1..24).
      const monthsParam = Number(event.queryStringParameters?.months);
      const months = Number.isFinite(monthsParam) ? Math.min(24, Math.max(1, Math.floor(monthsParam))) : 6;
      const billingAdmin = await isBillingAdmin(event);

      // All META rows for this agent (sparse GSI3). Sorted by GSI3SK = TS#<lastTs>, so we read newest
      // first and stop paginating once we fall out of the window.
      const cutoff = ((): string => {
        const d = new Date();
        d.setMonth(d.getMonth() - (months - 1));
        return `${d.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' }).slice(0, 7)}-01`;
      })();
      type LedgerRow = Record<string, unknown>;
      const rows: LedgerRow[] = [];
      let lastKey: Record<string, unknown> | undefined;
      do {
        const page = await ddb.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: 'GSI3',
            KeyConditionExpression: 'GSI3PK = :pk',
            ExpressionAttributeValues: { ':pk': `AGENT#${agentId}` },
            ScanIndexForward: false, // newest lastTs first
            ExclusiveStartKey: lastKey,
          })
        );
        for (const it of page.Items ?? []) rows.push(it as LedgerRow);
        lastKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);

      // Keep only rows inside the window (by `month`, defensive against any missing lastTs).
      const windowMonth = cutoff.slice(0, 7);
      const inWindow = rows.filter((r) => String(r.month ?? '') >= windowMonth);

      // Aggregation over a row set. The card is RUN-FIRST (FEAT-243): the chart shows the last few
      // individual runs and the header reflects the MOST RECENT run's tier — so `runs` (newest-first,
      // capped) + `latestTier` are the primary signal. `monthly`/`dominantTier`/`totalCredits` are kept
      // for the payload contract but the agent card no longer renders them. Credits + tier ONLY.
      const RUNS_PER_SOURCE = 5;
      // `source` lets the card draw separate scheduled vs on-demand lines. Bucket = 'scheduled' for a
      // scheduled run, else 'ondemand' (covers interactive 'agent' + 'chat' runs).
      type RunSource = 'scheduled' | 'ondemand';
      type AgentStatRun = {
        conversationId: string;
        ts: string | null;
        credits: number;
        tier: string;
        source: RunSource;
      };
      type AgentStatAggregate = {
        monthly: { month: string; credits: number; runCount: number }[];
        dominantTier: string;
        totalCredits: number;
        runCount: number;
        runs: AgentStatRun[];
        latestTier: string;
      };
      const tierOf = (r: LedgerRow): string =>
        typeof r.dominantTier === 'string' && (TIERS as readonly string[]).includes(r.dominantTier)
          ? r.dominantTier
          : 'unclassified';
      const sourceOf = (r: LedgerRow): RunSource => (String(r.source ?? '') === 'scheduled' ? 'scheduled' : 'ondemand');
      // The newest runs of `full` (already newest-first), keeping up to RUNS_PER_SOURCE per source bucket
      // so each line on the card can show its own last 5. Flat + newest-first; runs[0] is the newest
      // overall (always kept), so it still drives `latestTier`.
      const latestRuns = (full: LedgerRow[]): AgentStatRun[] => {
        const counts: Record<RunSource, number> = { scheduled: 0, ondemand: 0 };
        const out: AgentStatRun[] = [];
        for (const r of full) {
          const source = sourceOf(r);
          if (counts[source] >= RUNS_PER_SOURCE) continue;
          counts[source] += 1;
          out.push({
            conversationId: String(r.PK ?? '').replace(/^CONV#/, ''),
            ts: (r.lastTs as string) ?? (r.firstTs as string) ?? null,
            credits: Number(r.creditsCharged ?? 0),
            tier: tierOf(r),
            source,
          });
          if (counts.scheduled >= RUNS_PER_SOURCE && counts.ondemand >= RUNS_PER_SOURCE) break;
        }
        return out;
      };
      // `windowed` drives the monthly/total figures (respects the N-month window); `full` (un-windowed,
      // newest-first) drives `runs` so "last 5 runs" never drops a run that crossed a month boundary.
      const aggregate = (windowed: LedgerRow[], full: LedgerRow[]): AgentStatAggregate => {
        const byMonth = new Map<string, { credits: number; runCount: number }>();
        let dominant = '';
        let totalCredits = 0;
        for (const r of windowed) {
          const m = String(r.month ?? '');
          if (!m) continue;
          const credits = Number(r.creditsCharged ?? 0);
          totalCredits += credits;
          const cur = byMonth.get(m) ?? { credits: 0, runCount: 0 };
          cur.credits += credits;
          cur.runCount += 1;
          byMonth.set(m, cur);
          dominant = maxTier(dominant || null, typeof r.dominantTier === 'string' ? r.dominantTier : null);
        }
        const monthly = Array.from(byMonth.entries())
          .map(([month, v]) => ({ month, credits: v.credits, runCount: v.runCount }))
          .sort((a, b) => a.month.localeCompare(b.month)); // oldest -> newest for the chart
        const runs = latestRuns(full);
        return {
          monthly,
          dominantTier: dominant || 'unclassified',
          totalCredits,
          runCount: windowed.length,
          runs,
          latestTier: runs[0]?.tier ?? 'unclassified',
        };
      };

      // Caller's OWN usage of the agent (always returned). `runs` come from full history (newest-first),
      // monthly/total from the windowed slice.
      const ownFull = rows.filter((r) => r.userSub === sub);
      const ownWindow = inWindow.filter((r) => r.userSub === sub);
      const own = aggregate(ownWindow, ownFull);

      const body: Record<string, unknown> = {
        agentId,
        months,
        scope: billingAdmin ? 'all' : 'own',
        own,
      };

      if (billingAdmin) {
        // All-users aggregate + a per-user breakdown (credits + run count per sub; tier omitted per
        // user to keep the payload lean — the dominant tier is an agent-level signal).
        body.all = aggregate(inWindow, rows);
        const userMap = new Map<string, { credits: number; runCount: number }>();
        for (const r of inWindow) {
          const us = String(r.userSub ?? '');
          if (!us) continue;
          const cur = userMap.get(us) ?? { credits: 0, runCount: 0 };
          cur.credits += Number(r.creditsCharged ?? 0);
          cur.runCount += 1;
          userMap.set(us, cur);
        }
        body.byUser = Array.from(userMap.entries())
          .map(([userSub, v]) => ({ userSub, credits: v.credits, runCount: v.runCount }))
          .sort((a, b) => b.credits - a.credits); // top spenders first
      }

      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(body) };
    }

    // POST /credits/topup -> RETIRED. Pricing config, allocations, and top-ups are now authored in
    // the Customer Success Portal ("Numa Credits" page) and pushed into this account's CONFIG/BALANCE
    // rows. The in-client view is READ-ONLY; clients no longer self-configure credits.
    if (method === 'POST' && /\/credits\/topup\/?$/.test(path)) {
      if (!isAdmin(event)) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
      }
      return {
        statusCode: 410,
        headers: HEADERS,
        body: JSON.stringify({
          error: 'Credit config and top-ups are managed centrally in the Customer Success Portal.',
        }),
      };
    }

    // GET /credits/billing-admins -> the caller's own billing-admin status + the roster (so an admin
    // who's locked out can see who to ask, and User Management can render badges). Any admin may read.
    if (method === 'GET' && /\/credits\/billing-admins\/?$/.test(path)) {
      if (!isAdmin(event)) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
      }
      const sub = callerSub(event);
      const admins = await listBillingAdmins();
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ isBillingAdmin: !!sub && admins.some((a) => a.sub === sub), admins }),
      };
    }

    // POST /credits/billing-admins {action:'grant'|'revoke', sub, email?} -> peer-propagation.
    // Caller MUST already be a billing-admin (server-enforced; admins can't write this table from the
    // browser). Lockout: the final billing-admin can't be removed — Arcanum re-seeds via the portal.
    if (method === 'POST' && /\/credits\/billing-admins\/?$/.test(path)) {
      const caller = callerSub(event);
      if (!caller) {
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const admins = await listBillingAdmins();
      if (!admins.some((a) => a.sub === caller)) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'not_billing_admin' }) };
      }
      let body: { action?: string; sub?: string; email?: string };
      try {
        body = JSON.parse(event.body || '{}');
      } catch {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) };
      }
      const targetSub = String(body.sub || '');
      const action = body.action;
      if (!targetSub || (action !== 'grant' && action !== 'revoke')) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing action/sub' }) };
      }
      if (action === 'revoke') {
        if (admins.length <= 1 && admins.some((a) => a.sub === targetSub)) {
          return {
            statusCode: 409,
            headers: HEADERS,
            body: JSON.stringify({ error: 'last_billing_admin' }),
          };
        }
        await ddb.send(
          new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: clientPk(), SK: billingAdminSk(targetSub) } })
        );
      } else {
        await ddb.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: {
              PK: clientPk(),
              SK: billingAdminSk(targetSub),
              sub: targetSub,
              email: body.email ? String(body.email) : null,
              grantedBy: caller,
              grantedAt: new Date().toISOString(),
            },
          })
        );
      }
      const updated = await listBillingAdmins();
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ isBillingAdmin: updated.some((a) => a.sub === caller), admins: updated }),
      };
    }

    return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error('admin-credits error', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
