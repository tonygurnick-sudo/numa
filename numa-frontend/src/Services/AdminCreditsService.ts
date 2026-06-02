// Admin Credits service — talks to the admin-credits Lambda (Numa Credit System / SPK-015).
// Always pass numaGet/numaPost from useNumaRequest(); the fetch fallback runs unauthenticated (401).

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

export type ValueTiers = { chat: Record<string, number>; agent: Record<string, number> };
export type CreditConfig = {
  creditUsd: number;
  margin: number;
  trivialConsumptionUsd: number;
  valueTiers: ValueTiers;
  marginsByTier: Record<string, number>;
  // 12 monthly credit allocations (Jan..Dec). Unused credits expire at month end (no rollover).
  monthlyAllocations: number[];
};
export type CreditConfigEnvelope = {
  defaults: CreditConfig;
  current: CreditConfig;
  isCustom: boolean;
  updatedAt?: string | null;
};
// This-month allocation/consumption snapshot (use-it-or-lose-it; remaining = allocation − consumed).
export type CreditMonthly = {
  month: string;
  monthIndex: number;
  allocation: number;
  consumed: number;
  remaining: number;
  allocations: number[];
};
export type CreditBalance = {
  balance: number;
  updatedAt: string | null;
  config?: CreditConfigEnvelope;
  monthly?: CreditMonthly;
};

export type CreditLedgerRow = {
  conversationId: string;
  /** Anonymised title + deliverables, written by the nightly summariser. Empty until it runs. */
  title: string;
  deliverables?: string[];
  dominantTier: string;
  category: string | null;
  creditsCharged: number;
  msgCount: number;
  source: string;
  userSub: string | null;
  firstTs: string | null;
  lastTs: string | null;
};

export type CreditLedger = { month: string; totalCredits: number; items: CreditLedgerRow[] };

// Full per-conversation breakdown for the Credit Admin tab (admin-only): adds cost + tokens + margin.
export type CreditLedgerFullRow = CreditLedgerRow & {
  consumptionCostUsd: number;
  totalTokens: number;
  creditsValue: number;
  creditsFloor: number;
  marginVsConsumption: number | null;
  costIncomplete: boolean;
};
export type CreditLedgerFull = { month: string; totalCredits: number; items: CreditLedgerFullRow[] };

const API = (): string => sessionStorage.getItem('API_ENDPOINT') || '/api';

export const AdminCreditsService = {
  async getBalance(numaGet?: NumaGet): Promise<CreditBalance> {
    if (numaGet) {
      const res = (await numaGet('/api/credits/balance')) as Partial<CreditBalance>;
      return {
        balance: Number(res?.balance ?? 0),
        updatedAt: res?.updatedAt ?? null,
        config: res?.config,
        monthly: res?.monthly,
      };
    }
    const resp = await fetch(`${API()}/credits/balance`, { headers: { 'Content-Type': 'application/json' } });
    if (!resp.ok) return { balance: 0, updatedAt: null };
    const json = (await resp.json()) as Partial<CreditBalance>;
    return {
      balance: Number(json?.balance ?? 0),
      updatedAt: json?.updatedAt ?? null,
      config: json?.config,
      monthly: json?.monthly,
    };
  },

  // Full breakdown (cost/tokens/margin) for the Credit Admin tab — admin-only via ?full=1.
  async getLedgerFull(month: string | undefined, numaGet?: NumaGet): Promise<CreditLedgerFull> {
    const qs = `?full=1${month ? `&month=${encodeURIComponent(month)}` : ''}`;
    const norm = (j: Partial<CreditLedgerFull>): CreditLedgerFull => ({
      month: j?.month ?? month ?? '',
      totalCredits: Number(j?.totalCredits ?? 0),
      items: Array.isArray(j?.items) ? j.items : [],
    });
    if (numaGet) return norm((await numaGet(`/api/credits/ledger${qs}`)) as Partial<CreditLedgerFull>);
    const resp = await fetch(`${API()}/credits/ledger${qs}`, { headers: { 'Content-Type': 'application/json' } });
    if (!resp.ok) return { month: month ?? '', totalCredits: 0, items: [] };
    return norm((await resp.json()) as Partial<CreditLedgerFull>);
  },

  // Pricing config rides the topup route (action discriminator) so no extra API-GW route is needed.
  async saveConfig(config: CreditConfig, numaPost?: NumaPost): Promise<CreditConfigEnvelope | null> {
    if (!numaPost) throw new Error('saveConfig requires an authenticated numaPost');
    const res = (await numaPost('/api/credits/topup', { action: 'saveConfig', config })) as {
      config?: CreditConfigEnvelope;
    };
    return res?.config ?? null;
  },

  async resetConfig(numaPost?: NumaPost): Promise<CreditConfigEnvelope | null> {
    if (!numaPost) throw new Error('resetConfig requires an authenticated numaPost');
    const res = (await numaPost('/api/credits/topup', { action: 'resetConfig' })) as { config?: CreditConfigEnvelope };
    return res?.config ?? null;
  },

  async getLedger(month?: string, numaGet?: NumaGet): Promise<CreditLedger> {
    const qs = month ? `?month=${encodeURIComponent(month)}` : '';
    const normalise = (j: Partial<CreditLedger>): CreditLedger => ({
      month: j?.month ?? month ?? '',
      totalCredits: Number(j?.totalCredits ?? 0),
      items: Array.isArray(j?.items) ? j.items : [],
    });
    if (numaGet) {
      return normalise((await numaGet(`/api/credits/ledger${qs}`)) as Partial<CreditLedger>);
    }
    const resp = await fetch(`${API()}/credits/ledger${qs}`, { headers: { 'Content-Type': 'application/json' } });
    if (!resp.ok) return { month: month ?? '', totalCredits: 0, items: [] };
    return normalise((await resp.json()) as Partial<CreditLedger>);
  },

  async topUp(credits: number, numaPost?: NumaPost): Promise<{ balance: number }> {
    if (numaPost) {
      const res = (await numaPost('/api/credits/topup', { credits })) as { balance?: number };
      return { balance: Number(res?.balance ?? 0) };
    }
    const resp = await fetch(`${API()}/credits/topup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credits }),
    });
    if (!resp.ok) throw new Error('top-up failed');
    const json = (await resp.json()) as { balance?: number };
    return { balance: Number(json?.balance ?? 0) };
  },
};
