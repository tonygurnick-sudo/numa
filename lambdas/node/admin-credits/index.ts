import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

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

const balanceKey = (): { PK: string; SK: string } => ({ PK: `CLIENT#${CLIENT_NAME}`, SK: 'BALANCE' });
const configKey = (): { PK: string; SK: string } => ({ PK: `CLIENT#${CLIENT_NAME}`, SK: 'CONFIG' });

// ── Pricing-policy defaults — MUST mirror lib/credit-pricing (credits.py + tiers.py). The Credit
// Admin tab edits these; the debit Lambda reads the CONFIG row at meter time. AWS token rates and
// the 200K long-context threshold are deliberately NOT editable (billing facts, not policy knobs).
const TIERS = ['low', 'medium', 'high', 'very_high'] as const;
const CONTEXTS = ['chat', 'agent'] as const;
const DEFAULT_CONFIG = {
  creditUsd: 0.4,
  margin: 2.0, // scalar fallback (unclassified); per-tier marginsByTier below are the real defence
  trivialConsumptionUsd: 0.01,
  valueTiers: {
    chat: { low: 1, medium: 3, high: 8, very_high: 18 },
    agent: { low: 1, medium: 2, high: 5, very_high: 12 },
  },
  // Per-tier cost-recovery (defence) margin (the floor), scaling UP with complexity (Scheme A) so
  // cheap work isn't punished and premium work keeps a fuller margin.
  marginsByTier: { low: 1.05, medium: 1.25, high: 1.5, very_high: 1.9 },
  // Monthly credit allocation (Jan..Dec). Credits granted per calendar month; UNUSED CREDITS EXPIRE
  // at month end (no rollover). The Credit Admin panel sets an annual total and splits it evenly,
  // then lets any month be fine-tuned. All zero = unconfigured (no budget enforced/shown).
  monthlyAllocations: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
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

// UTC YYYY-MM. (Monthly expiry is Asa's default — the ledger is keyed by month.)
const currentMonth = (): string => new Date().toISOString().slice(0, 7);

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
    category: item.category ?? null,
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

    // GET /credits/balance -> current credit balance (admin-only: exposes spend signal)
    if (method === 'GET' && /\/credits\/balance\/?$/.test(path)) {
      if (!isAdmin(event)) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
      }
      // Also return the pricing config here (the Credit Admin tab reads it from this call — avoids
      // adding a new API-GW route so the whole feature is hotfix-deployable). Plus this month's
      // allocation/consumption so the panel can show "X / Y used, Z remaining (expires month end)".
      const month = currentMonth();
      const monthIndex = Number(month.slice(5, 7)) - 1; // 0=Jan .. 11=Dec
      const [balRes, cfgRes, monthRes] = await Promise.all([
        ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: balanceKey() })),
        ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: configKey() })),
        ddb.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: 'GSI2',
            KeyConditionExpression: 'GSI2PK = :pk',
            ExpressionAttributeValues: { ':pk': `MONTH#${month}` },
            ProjectionExpression: 'creditsCharged',
          })
        ),
      ]);
      const balance = (balRes.Item?.balance as number) ?? 0;
      const cfg = effectiveConfig(cfgRes.Item);
      // Use-it-or-lose-it: remaining is THIS month's allocation minus THIS month's consumption.
      // Prior months never carry over (the ledger is keyed by month), so expiry is implicit.
      const consumed = (monthRes.Items || []).reduce((sum, it) => sum + Number(it.creditsCharged ?? 0), 0);
      const allocation = cfg.monthlyAllocations[monthIndex] ?? 0;
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({
          balance,
          updatedAt: balRes.Item?.updatedAt ?? null,
          config: {
            defaults: DEFAULT_CONFIG,
            current: cfg,
            isCustom: !!cfgRes.Item,
            updatedAt: cfgRes.Item?.updatedAt ?? null,
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
