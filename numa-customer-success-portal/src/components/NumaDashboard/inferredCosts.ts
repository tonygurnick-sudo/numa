/**
 * Inferred-cost computation for the Numa Dashboard.
 *
 * Why this exists:
 *   Bedrock quota sharing means a client's Claude usage is often billed to a
 *   DIFFERENT account via the `bedrock-quota-sharing` assume-role hop.
 *   AWS Cost Explorer therefore mis-attributes Claude cost:
 *     - Borrowers (e.g. ddconsulting, roof-logic) show ~$0 Claude CE despite
 *       very real LLM usage.
 *     - Lenders (e.g. hq, allow_bedrock_quota_sharing: true) show OVER-stated
 *       Claude CE because borrowers' usage is billed to their account.
 *   CE also has a 2-day billing lag, so recent days look mis-attributed even
 *   for standalone clients.
 *
 * Fix: swap the Claude-model CE lines (the only ones routed via quota
 * sharing) with the token-priced `chat.daily_cost` series, leaving every
 * other CE line untouched. Same daily-bucket math handles all three roles
 * (standalone / borrower / lender) and the CE lag.
 *
 *   inferred_total[d] = totals_by_day[d] − ce_claude_daily[d] + chat_daily[d]
 *   lent[d]           = max(0, ce_claude_daily[d] − chat_daily[d])
 *   borrowed[d]       = max(0, chat_daily[d] − ce_claude_daily[d])
 */
import type { DashboardView } from '@/types/fleetAnalytics';
import type { WindowState } from './shared';
import { sumDailyInWindow } from './shared';

/**
 * CE service-name pattern for the LLM lines that are quota-shared.
 * Matches "Claude Sonnet 4.6 (Amazon Bedrock Edition)", "Claude Opus 4.6
 * (Amazon Bedrock Edition)", "Claude 3 Haiku (Amazon Bedrock Edition)", etc.
 * Other Bedrock lines ("Amazon Bedrock" for embeddings/Nova-Lite, "Amazon
 * Bedrock AgentCore" for MicroVM hosting) are NOT quota-shared — they stay.
 */
export const CLAUDE_CE_SERVICE_PATTERN = /^Claude .* \(Amazon Bedrock Edition\)$/;

/** Display name for the collapsed Claude slice in the inferred service mix. */
export const INFERRED_LLM_SERVICE_LABEL = 'Numa LLM (inferred)';

export type QuotaSharingRole = 'standalone' | 'borrower' | 'lender' | 'mixed';

export interface InferredCostBreakdown {
  /** Sum across CE services matching CLAUDE_CE_SERVICE_PATTERN, per day. */
  ceClaudeDaily: Record<string, number>;
  /** chat.daily_cost (token-priced LLM cost) within window. */
  chatDaily: Record<string, number>;
  /** Daily inferred grand total: totals_by_day - ceClaudeDaily + chatDaily. */
  inferredTotalDaily: Record<string, number>;
  /** max(0, ceClaude - chat) per day — lender direction. */
  lentDaily: Record<string, number>;
  /** max(0, chat - ceClaude) per day — borrower direction. */
  borrowedDaily: Record<string, number>;
  totals: {
    ceTotal: number;
    ceClaude: number;
    chat: number;
    inferred: number;
    lent: number;
    borrowed: number;
    /** inferred - ceTotal. Positive for borrowers, negative for lenders. */
    delta: number;
  };
  role: QuotaSharingRole;
}

/**
 * Pure compute — no React. Reads existing snapshot fields, derives inferred
 * cost + role for the given window.
 */
export function computeInferredCosts(data: DashboardView, win: WindowState): InferredCostBreakdown {
  const byServiceDaily = data.cost_explorer?.by_service_daily ?? {};
  const ceTotalsByDay = data.cost_explorer?.totals_by_day ?? {};
  const chatDailyRaw = data.chat?.daily_cost ?? {};

  // Sum the Claude-model CE lines per day.
  const ceClaudeDaily: Record<string, number> = {};
  for (const [svc, days] of Object.entries(byServiceDaily)) {
    if (!CLAUDE_CE_SERVICE_PATTERN.test(svc)) continue;
    for (const [d, v] of Object.entries(days)) {
      if (d < win.startDate || d > win.endDate) continue;
      ceClaudeDaily[d] = (ceClaudeDaily[d] || 0) + (v || 0);
    }
  }

  // Filter chat + totals to the window.
  const chatDaily: Record<string, number> = {};
  for (const [d, v] of Object.entries(chatDailyRaw)) {
    if (d >= win.startDate && d <= win.endDate) chatDaily[d] = v || 0;
  }

  const inferredTotalDaily: Record<string, number> = {};
  const lentDaily: Record<string, number> = {};
  const borrowedDaily: Record<string, number> = {};
  const allDays = new Set<string>([
    ...Object.keys(ceTotalsByDay).filter((d) => d >= win.startDate && d <= win.endDate),
    ...Object.keys(chatDaily),
  ]);
  for (const d of allDays) {
    const ceTotal = ceTotalsByDay[d] || 0;
    const claudeCE = ceClaudeDaily[d] || 0;
    const chat = chatDaily[d] || 0;
    inferredTotalDaily[d] = ceTotal - claudeCE + chat;
    if (claudeCE > chat) lentDaily[d] = claudeCE - chat;
    else if (chat > claudeCE) borrowedDaily[d] = chat - claudeCE;
  }

  const totals = {
    ceTotal: sumDailyInWindow(ceTotalsByDay, win),
    ceClaude: Object.values(ceClaudeDaily).reduce((a, b) => a + b, 0),
    chat: Object.values(chatDaily).reduce((a, b) => a + b, 0),
    inferred: Object.values(inferredTotalDaily).reduce((a, b) => a + b, 0),
    lent: Object.values(lentDaily).reduce((a, b) => a + b, 0),
    borrowed: Object.values(borrowedDaily).reduce((a, b) => a + b, 0),
    delta: 0,
  };
  totals.delta = totals.inferred - totals.ceTotal;

  return {
    ceClaudeDaily,
    chatDaily,
    inferredTotalDaily,
    lentDaily,
    borrowedDaily,
    totals,
    role: classifyRole(totals.lent, totals.borrowed, totals.chat),
  };
}

/**
 * Role classification rules (window-scoped):
 *   - standalone: |lent| and |borrowed| are both <10% of chat
 *   - borrower:   borrowed dominates by ≥10% of chat
 *   - lender:     lent dominates by ≥10% of chat
 *   - mixed:      both signals are ≥10% of chat (e.g. quota-sharing toggled mid-window)
 *
 * The 10% threshold keeps small daily noise from flipping the badge.
 */
function classifyRole(lent: number, borrowed: number, chat: number): QuotaSharingRole {
  if (chat <= 0) return 'standalone';
  const threshold = chat * 0.1;
  const lentSig = lent >= threshold;
  const borrowedSig = borrowed >= threshold;
  if (lentSig && borrowedSig) return 'mixed';
  if (lentSig) return 'lender';
  if (borrowedSig) return 'borrower';
  return 'standalone';
}

/**
 * Service mix for the Cost composition donut with Claude lines collapsed
 * into a single INFERRED_LLM_SERVICE_LABEL slice.
 *
 *   svc[name] = window-summed cost from cost_explorer.by_service_daily,
 *               EXCEPT Claude lines are dropped and a single
 *               INFERRED_LLM_SERVICE_LABEL line is added with the value of
 *               chat.daily_cost summed in window.
 *
 * Sum of resulting map equals computeInferredCosts(...).totals.inferred.
 */
export function buildInferredServiceMix(data: DashboardView, win: WindowState): Record<string, number> {
  const byServiceDaily = data.cost_explorer?.by_service_daily ?? {};
  const out: Record<string, number> = {};

  for (const [svc, days] of Object.entries(byServiceDaily)) {
    if (CLAUDE_CE_SERVICE_PATTERN.test(svc)) continue;
    let sum = 0;
    for (const [d, v] of Object.entries(days)) {
      if (d >= win.startDate && d <= win.endDate) sum += v || 0;
    }
    if (sum > 0) out[svc] = sum;
  }

  const chatInWindow = sumDailyInWindow(data.chat?.daily_cost, win);
  if (chatInWindow > 0) out[INFERRED_LLM_SERVICE_LABEL] = chatInWindow;

  return out;
}
