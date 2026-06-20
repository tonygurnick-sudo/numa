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
// One top-up-balance event-log entry (CLIENT#/TXN#…). `credits` is signed (top-ups +, settlements −,
// adjustments ±). The balance is the running sum of these — there's no decrementing scalar.
export type CreditTxn = {
  kind: 'topup' | 'settlement' | 'adjustment' | string;
  credits: number;
  month?: string;
  createdAt: string;
  createdBy?: string;
  note?: string;
};
export type CreditBalance = {
  balance: number;
  updatedAt: string | null;
  config?: CreditConfigEnvelope;
  monthly?: CreditMonthly;
  /** Top-up-balance event log, newest first (for the in-client top-up activity view). */
  txns?: CreditTxn[];
};

export type CreditLedgerRow = {
  conversationId: string;
  /** Anonymised title + deliverables, written by the nightly summariser. Empty until it runs. */
  title: string;
  deliverables?: string[];
  dominantTier: string;
  creditsCharged: number;
  msgCount: number;
  source: string;
  /** Present on agent / scheduled runs; the dashboard joins it to the agent's name. */
  agentId: string | null;
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

// Per-conversation credit tier for the in-chat indicator (ownership-checked, not admin-gated).
// `classified` is false until credit-debit has metered the conversation (a few seconds after a turn,
// or never on a brand-new chat), in which case `tier` is null.
export type ConversationValue = {
  classified: boolean;
  tier: 'low' | 'medium' | 'high' | 'very_high' | null;
  source: string;
  creditsCharged: number;
};

// ── Per-agent credit analytics (FEAT-246) ───────────────────────────────────────────────────────
// Per-month credits + run count (kept in the payload; the agent card now renders `runs` instead).
export type AgentStatMonth = { month: string; credits: number; runCount: number };
// One individual run: its credits + own value tier + when it ran + how it was triggered. Newest-first
// in `runs` (up to 5 per source, so the card can draw separate scheduled vs on-demand lines).
export type RunSource = 'scheduled' | 'ondemand';
export type AgentStatRun = {
  conversationId: string;
  ts: string | null;
  credits: number;
  tier: string;
  source: RunSource;
};
// An aggregate over a set of runs. The card is run-first: `runs` (last 5, newest-first) drives the
// chart and `latestTier` (most recent run's tier) drives the header badge. monthly/dominantTier/
// totalCredits remain for the payload contract but are no longer rendered on the card.
export type AgentStatAggregate = {
  monthly: AgentStatMonth[];
  dominantTier: string;
  totalCredits: number;
  runCount: number;
  runs: AgentStatRun[];
  latestTier: string;
};
// One row of the per-user breakdown (billing-admin scope only). Credits + run count; no cost/tokens.
export type AgentStatUser = { userSub: string; credits: number; runCount: number };
// Per-agent stats response. `scope` is 'own' for a normal caller (only `own` populated) and 'all' for
// a billing admin (adds the all-users `all` aggregate + the `byUser` breakdown). Credits + tier ONLY
// — never cost/token telemetry (privacy fence). `own` is always the caller's own usage of the agent.
export type AgentStats = {
  agentId: string;
  months: number;
  scope: 'own' | 'all';
  own: AgentStatAggregate;
  all?: AgentStatAggregate;
  byUser?: AgentStatUser[];
};

// Billing-admin roster (who may see credit data). Membership lives server-side in the credit ledger,
// not a Cognito group — only an existing billing-admin (or the portal) can grant it.
export type BillingAdmin = { sub: string; email: string | null; grantedBy: string | null; grantedAt: string | null };
export type BillingAdminsResponse = { isBillingAdmin: boolean; admins: BillingAdmin[] };

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
        txns: Array.isArray(res?.txns) ? res.txns : [],
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
      txns: Array.isArray(json?.txns) ? json.txns : [],
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

  // The current credit tier of the caller's OWN conversation (in-chat indicator). Returns an
  // unrated result on any miss/error so the indicator degrades to a neutral "rating…" state.
  async getConversationValue(conversationId: string, numaGet?: NumaGet): Promise<ConversationValue> {
    const unrated: ConversationValue = { classified: false, tier: null, source: 'chat', creditsCharged: 0 };
    const norm = (j: Partial<ConversationValue>): ConversationValue => ({
      classified: Boolean(j?.classified),
      tier: j?.tier ?? null,
      source: j?.source ?? 'chat',
      creditsCharged: Number(j?.creditsCharged ?? 0),
    });
    const qs = `?id=${encodeURIComponent(conversationId)}`;
    try {
      if (numaGet) return norm((await numaGet(`/api/credits/conversation${qs}`)) as Partial<ConversationValue>);
      const resp = await fetch(`${API()}/credits/conversation${qs}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp.ok) return unrated;
      return norm((await resp.json()) as Partial<ConversationValue>);
    } catch {
      return unrated;
    }
  },

  // Per-agent credit analytics for the agent card's Credits section (FEAT-246). Returns the caller's
  // OWN usage of the agent (scope:'own'); for a billing admin the server also returns the all-users
  // aggregate + per-user breakdown (scope:'all'). Credits + value tier only — no cost/token figures.
  async getAgentStats(agentId: string, months = 6, numaGet?: NumaGet): Promise<AgentStats> {
    const empty = (): AgentStatAggregate => ({
      monthly: [],
      dominantTier: 'unclassified',
      totalCredits: 0,
      runCount: 0,
      runs: [],
      latestTier: 'unclassified',
    });
    const norm = (j: Partial<AgentStats>): AgentStats => ({
      agentId: j?.agentId ?? agentId,
      months: Number(j?.months ?? months),
      scope: j?.scope === 'all' ? 'all' : 'own',
      own: j?.own ?? empty(),
      all: j?.all,
      byUser: Array.isArray(j?.byUser) ? j.byUser : undefined,
    });
    const qs = `?agentId=${encodeURIComponent(agentId)}&months=${encodeURIComponent(String(months))}`;
    if (numaGet) return norm((await numaGet(`/api/credits/agent-stats${qs}`)) as Partial<AgentStats>);
    const resp = await fetch(`${API()}/credits/agent-stats${qs}`, { headers: { 'Content-Type': 'application/json' } });
    if (!resp.ok) return norm({ agentId, months });
    return norm((await resp.json()) as Partial<AgentStats>);
  },

  // The caller's billing-admin status + the roster. Any admin may read (so a locked-out admin sees
  // who to ask, and User Management can render badges). Empty/false on any miss.
  async getBillingAdmins(numaGet?: NumaGet): Promise<BillingAdminsResponse> {
    const norm = (j: Partial<BillingAdminsResponse>): BillingAdminsResponse => ({
      isBillingAdmin: Boolean(j?.isBillingAdmin),
      admins: Array.isArray(j?.admins) ? j.admins : [],
    });
    if (numaGet) return norm((await numaGet('/api/credits/billing-admins')) as Partial<BillingAdminsResponse>);
    const resp = await fetch(`${API()}/credits/billing-admins`, { headers: { 'Content-Type': 'application/json' } });
    if (!resp.ok) return { isBillingAdmin: false, admins: [] };
    return norm((await resp.json()) as Partial<BillingAdminsResponse>);
  },

  // Grant/revoke billing-admin (peer-propagation). Server enforces that the caller is already a
  // billing-admin and that the last one can't be revoked; throws with the server's error code so the
  // UI can message 'last_billing_admin' / 'not_billing_admin' precisely.
  async setBillingAdmin(
    action: 'grant' | 'revoke',
    sub: string,
    email: string | null,
    numaPost?: NumaPost
  ): Promise<BillingAdminsResponse> {
    if (!numaPost) throw new Error('setBillingAdmin requires an authenticated numaPost');
    const res = (await numaPost('/api/credits/billing-admins', {
      action,
      sub,
      email,
    })) as Partial<BillingAdminsResponse>;
    return { isBillingAdmin: Boolean(res?.isBillingAdmin), admins: Array.isArray(res?.admins) ? res.admins : [] };
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
