import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

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
  creditUsd: 0.5,
  margin: 2.0,
  trivialConsumptionUsd: 0.01,
  valueTiers: {
    chat: { low: 2, medium: 5, high: 12, very_high: 30 },
    agent: { low: 1, medium: 3, high: 6, very_high: 15 },
  },
  // Per-tier cost-recovery margin (the floor). Default 2x everywhere; raise high/very_high so
  // token-heavy premium work doesn't collapse to a flat 2x when the floor binds.
  marginsByTier: { low: 2.0, medium: 2.0, high: 2.0, very_high: 2.0 },
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

// Validate + pick only known fields. Returns null on any invalid value.
function validateConfig(body: Record<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const pos = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  if (body.creditUsd !== undefined) {
    const n = pos(body.creditUsd);
    if (n === null) return null;
    out.creditUsd = n;
  }
  if (body.margin !== undefined) {
    const n = pos(body.margin);
    if (n === null || n < 1) return null; // margin < 1x would let credits fall below cost
    out.margin = n;
  }
  if (body.trivialConsumptionUsd !== undefined) {
    const n = Number(body.trivialConsumptionUsd);
    if (!Number.isFinite(n) || n < 0) return null;
    out.trivialConsumptionUsd = n;
  }
  if (body.valueTiers !== undefined) {
    const src = body.valueTiers as ValueTiers;
    const vt: ValueTiers = {};
    for (const ctx of CONTEXTS) {
      if (!src?.[ctx]) continue;
      vt[ctx] = {};
      for (const tier of TIERS) {
        if (src[ctx][tier] === undefined) continue;
        const n = pos(src[ctx][tier]);
        if (n === null) return null;
        vt[ctx][tier] = Math.round(n);
      }
    }
    out.valueTiers = vt;
  }
  if (body.marginsByTier !== undefined) {
    const src = body.marginsByTier as Record<string, number>;
    const mt: Record<string, number> = {};
    for (const tier of TIERS) {
      if (src?.[tier] === undefined) continue;
      const n = Number(src[tier]);
      if (!Number.isFinite(n) || n < 1) return null; // margin < 1x would let credits fall below cost
      mt[tier] = n;
    }
    out.marginsByTier = mt;
  }
  if (body.monthlyAllocations !== undefined) {
    const src = body.monthlyAllocations;
    if (!Array.isArray(src)) return null;
    const arr: number[] = [];
    for (let i = 0; i < 12; i++) {
      const n = Number(src[i] ?? 0);
      if (!Number.isFinite(n) || n < 0) return null; // a month's allocation can't be negative
      arr.push(Math.round(n));
    }
    out.monthlyAllocations = arr;
  }
  return out;
}

// UTC YYYY-MM. (Monthly expiry is Asa's default — the ledger is keyed by month.)
const currentMonth = (): string => new Date().toISOString().slice(0, 7);

// Admin-safe projection of a META row. NEVER returns internal cost/token fields or chat content —
// admins see what was done, by whom, over what span, and what it cost in credits. userSub is
// included (admins legitimately see who ran each conversation; the route is admin-gated); the
// frontend resolves it to an email/name. firstTs/lastTs give the conversation's wall-clock span.
function toAdminRow(item: Record<string, unknown>): Record<string, unknown> {
  return {
    conversationId: String(item.PK || '').replace(/^CONV#/, ''),
    title: item.title ?? '',
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

    // POST /credits/topup -> admin-only. Discriminated by `action` so config save/reset can ride
    // this route (no new API-GW route needed -> hotfix-deployable):
    //   { credits: N }                 -> manual balance top-up
    //   { action: 'saveConfig', config } -> persist pricing-policy overrides (Credit Admin tab)
    //   { action: 'resetConfig' }       -> delete overrides, revert to lib defaults
    if (method === 'POST' && /\/credits\/topup\/?$/.test(path)) {
      if (!isAdmin(event)) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
      }
      const body = JSON.parse(event.body || '{}') as {
        credits?: unknown;
        action?: string;
        config?: Record<string, unknown>;
      };

      if (body.action === 'resetConfig') {
        await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: configKey() }));
        return {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify({
            ok: true,
            config: { defaults: DEFAULT_CONFIG, current: DEFAULT_CONFIG, isCustom: false },
          }),
        };
      }
      if (body.action === 'saveConfig') {
        const clean = validateConfig(body.config || {});
        if (!clean) {
          return {
            statusCode: 400,
            headers: HEADERS,
            body: JSON.stringify({ error: 'Invalid config: all values must be positive (margin >= 1).' }),
          };
        }
        await ddb.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: { ...configKey(), ...clean, updatedAt: new Date().toISOString(), updatedBy: 'admin' },
          })
        );
        return {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify({
            ok: true,
            config: { defaults: DEFAULT_CONFIG, current: effectiveConfig(clean), isCustom: true },
          }),
        };
      }

      const credits = Number(body.credits);
      if (!Number.isFinite(credits) || credits <= 0) {
        return {
          statusCode: 400,
          headers: HEADERS,
          body: JSON.stringify({ error: 'credits must be a positive number' }),
        };
      }
      const res = await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: balanceKey(),
          UpdateExpression: 'ADD balance :c SET updatedAt = :t, updatedBy = :u',
          ExpressionAttributeValues: { ':c': credits, ':t': new Date().toISOString(), ':u': 'admin' },
          ReturnValues: 'UPDATED_NEW',
        })
      );
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ ok: true, balance: res.Attributes?.balance ?? credits }),
      };
    }

    return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error('admin-credits error', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
