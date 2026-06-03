import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

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

const clientPk = (): string => `CLIENT#${CLIENT_NAME}`;

// ── Pricing-policy defaults — MUST mirror lib/credit-pricing (credits.py + tiers.py). The Credit
// Admin tab edits these; the debit Lambda reads the CONFIG row at meter time. AWS token rates and
// the 200K long-context threshold are deliberately NOT editable (billing facts, not policy knobs).
const TIERS = ['low', 'medium', 'high', 'very_high'] as const;
const CONTEXTS = ['chat', 'agent'] as const;
const DEFAULT_CONFIG = {
  creditUsd: 0.3, // ~NZD $0.50/credit @ FX 1.69 — the NZD-anchored default
  margin: 2.0, // scalar fallback (unclassified); per-tier marginsByTier below are the real defence
  trivialConsumptionUsd: 0.01,
  // 2-credit floor on every interaction (low); agent stays cheaper than chat above the floor.
  valueTiers: {
    chat: { low: 2, medium: 4, high: 8, very_high: 18 },
    agent: { low: 2, medium: 3, high: 5, very_high: 12 },
  },
  // Per-tier cost-recovery (defence) margin (the floor), scaling UP with complexity so cheap work
  // isn't punished and premium work keeps a fuller margin.
  marginsByTier: { low: 1.15, medium: 1.3, high: 1.6, very_high: 2.0 },
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
    // empty until it runs (frontend shows a "summary coming overnight" placeholder).
    title: item.title ?? '',
    deliverables: Array.isArray(item.deliverables) ? item.deliverables : [],
    dominantTier: item.dominantTier ?? 'unclassified',
    creditsCharged: item.creditsCharged ?? 0,
    msgCount: item.msgCount ?? 0,
    source: item.source ?? 'chat',
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

    // GET /credits/balance -> live drawdown standing (admin-only: exposes spend signal).
    if (method === 'GET' && /\/credits\/balance\/?$/.test(path)) {
      if (!isAdmin(event)) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
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

    // GET /credits/ledger?month=YYYY-MM -> this month's conversations (admin-safe rows, newest first)
    if (method === 'GET' && /\/credits\/ledger\/?$/.test(path)) {
      if (!isAdmin(event)) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
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

    return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error('admin-credits error', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
