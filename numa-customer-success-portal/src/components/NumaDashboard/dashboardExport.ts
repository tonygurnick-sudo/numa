/**
 * Dashboard-view export builder.
 *
 * Produces a JSON-friendly structure that mirrors what the Numa Dashboard
 * actually renders for each (client, window) cell — KPIs and the headline
 * tables, with all the window-slicing and inferred-cost math already
 * applied. The "Raw snapshots" export still bundles `ClientSnapshot`s as
 * stored in DDB; this export is the layer above, suitable for handing to
 * an LLM that wants "what is on Nathan's screen" not "the raw inputs".
 */
import type {
  AggregateView,
  ByClientRow,
  ChatBlock,
  ClientSnapshot,
  CostExplorerBlock,
  DashboardView,
  PerAgentStats,
  TopConversation,
  TopScheduledRun,
} from '@/types/fleetAnalytics';
import {
  aggregateSnapshots,
  buildByClientRowsWindowed,
  isAggregate,
  setLastNDays,
  sumByKeyInWindow,
  sumDailyInWindow,
  topConvInWindow,
  topRunInWindow,
} from './shared';
import type { WindowState } from './shared';
import { buildInferredServiceMix, computeInferredCosts } from './inferredCosts';

const DEFAULT_WINDOW_DAYS = [7, 14, 30, 60, 90] as const;
const TOP_N_USERS = 20;
const TOP_N_AGENTS = 20;
const TOP_N_CONVERSATIONS = 50;
const TOP_N_RUNS = 50;

export interface DashboardWindowView {
  window: { start: string; end: string; days: number; label: string };
  spend: {
    inferred_total: number;
    raw_ce_total: number;
    chat_llm: number;
    ce_claude: number;
    lent: number;
    borrowed: number;
    role: 'standalone' | 'borrower' | 'lender' | 'mixed';
    avg_cost_per_conv: number;
    cost_per_user_msg: number;
    scheduled_runs_count: number;
    scheduled_runs_cost: number;
  };
  unit_economics: {
    plain_chat: { cost: number; user_msgs: number; convs: number; cost_per_msg: number; cost_per_conv: number };
    agent_chat: { cost: number; user_msgs: number; convs: number; cost_per_msg: number; cost_per_conv: number };
    agent_run: { cost: number; convs: number; cost_per_run: number };
  };
  volume: {
    conversations: number;
    adhoc_convs: number;
    scheduled_convs: number;
    user_messages: number;
    tool_calls: number;
    agentic_turns: number;
  };
  operations: {
    active_users: number;
    provisioned_users?: number;
    cache_hit_ratio_pct: number | null;
    errors: number;
    active_schedules?: number;
    total_schedules?: number;
  };
  cost_composition: Record<string, number>;
  by_category: {
    agent_run: { convs: number; cost: number; user_messages: number };
    agent_chat: { convs: number; cost: number; user_messages: number };
    plain_chat: { convs: number; cost: number; user_messages: number };
  };
  by_user_top: Array<{ user_id: string; cost: number; messages: number }>;
  by_agent_top: Array<{
    agent_id: string;
    agent_title?: string | null;
    cost: number;
    scheduled_cost: number;
    adhoc_cost: number;
  }>;
  by_tool: Record<string, number>;
  by_model: Record<string, { cost: number; convs: number }>;
  top_conversations: TopConversation[];
  top_scheduled_runs: TopScheduledRun[];
  /** Aggregate views only — per-stack breakdown sorted by CE. */
  by_client?: ByClientRow[];
}

export interface DashboardExportClientEntry {
  client: string;
  is_aggregate: boolean;
  client_config?: ClientSnapshot['client_config'];
  generated_at?: string;
  window_views: Record<string, DashboardWindowView>;
}

export interface DashboardExportBundle {
  exported_at: string;
  schema_version: '1.0';
  window_presets: number[];
  views: Record<string, DashboardExportClientEntry>;
}

/**
 * Build a single (client, window) view. Works on both real client snapshots
 * and aggregate views — they share the same DashboardView interface.
 */
export function buildDashboardWindowView(
  data: DashboardView,
  win: WindowState,
  snapshots: ClientSnapshot[]
): DashboardWindowView {
  const chat = data.chat;
  const ce = data.cost_explorer;
  const inferred = computeInferredCosts(data, win);

  const chatCost = sumDailyInWindow(chat?.daily_cost, win);
  const chatConvs = sumDailyInWindow(chat?.daily_convs, win);
  const chatTurns = sumDailyInWindow(chat?.daily_turns, win);
  const chatUserMsgs = sumDailyInWindow(chat?.daily_messages, win);
  const chatToolCalls = sumDailyInWindow(chat?.daily_tool_calls, win);
  const chatAdhocConvs = sumDailyInWindow(chat?.daily_adhoc_count, win);
  const chatScheduledConvs = sumDailyInWindow(chat?.daily_scheduled_count, win);
  const schedRuns = sumDailyInWindow(data.scheduled_runs?.daily_runs, win);
  const schedCost = sumDailyInWindow(data.scheduled_runs?.daily_cost, win);

  // Unit economics per category — per-day cost / per-day msg buckets summed in window
  const ue = perCategory(chat, win);

  // Tokens — used for cache-hit ratio. We don't carry per-day token series,
  // so this is snapshot-window only (flagged in the export name).
  const tot = chat?.totals;
  const totalInTok = (tot?.input_tokens || 0) + (tot?.cache_read_tokens || 0) + (tot?.cache_creation_tokens || 0);
  const cacheHitPct = totalInTok ? (100 * (tot?.cache_read_tokens || 0)) / totalInTok : null;

  // Cost composition with Claude collapsed
  const cost_composition = ce?.by_service_daily
    ? buildInferredServiceMix(data, win)
    : { ...(ce?.totals_by_service || {}) };

  // by_user top — daily_cost_by_user sliced to window, sorted desc
  const userCostInWin = sumByKeyInWindow(chat?.daily_cost_by_user, win);
  const userMsgsInWin = sumByKeyInWindow(chat?.daily_messages_by_user, win);
  const by_user_top = Object.entries(userCostInWin)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N_USERS)
    .map(([user_id, cost]) => ({ user_id, cost, messages: userMsgsInWin[user_id] || 0 }));

  // by_agent — same idea, joined with the snapshot-window agent_title via by_agent[]
  const agentCostInWin = sumByKeyInWindow(chat?.daily_cost_by_agent, win);
  const schedCostByAgentInWin = sumByKeyInWindow(chat?.daily_scheduled_cost_by_agent, win);
  const adhocCostByAgentInWin = sumByKeyInWindow(chat?.daily_adhoc_cost_by_agent, win);
  const titleByAgent: Record<string, string | undefined> = {};
  for (const row of chat?.by_agent || []) {
    if (row.agent_id) titleByAgent[row.agent_id] = row.agent_title || undefined;
  }
  const by_agent_top: DashboardWindowView['by_agent_top'] = Object.entries(agentCostInWin)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N_AGENTS)
    .map(([agent_id, cost]) => ({
      agent_id,
      agent_title: titleByAgent[agent_id],
      cost,
      scheduled_cost: schedCostByAgentInWin[agent_id] || 0,
      adhoc_cost: adhocCostByAgentInWin[agent_id] || 0,
    }));

  // Top conversations / runs — filtered to window
  const top_conversations = (chat?.top_conversations || [])
    .filter((c) => topConvInWindow(c, win))
    .slice(0, TOP_N_CONVERSATIONS);
  const top_scheduled_runs = (data.scheduled_runs?.top_runs || [])
    .filter((r) => topRunInWindow(r, win))
    .slice(0, TOP_N_RUNS);

  const view: DashboardWindowView = {
    window: {
      start: win.startDate,
      end: win.endDate,
      days: countDaysInclusive(win.startDate, win.endDate),
      label: win.label,
    },
    spend: {
      inferred_total: inferred.totals.inferred,
      raw_ce_total: inferred.totals.ceTotal,
      chat_llm: inferred.totals.chat,
      ce_claude: inferred.totals.ceClaude,
      lent: inferred.totals.lent,
      borrowed: inferred.totals.borrowed,
      role: inferred.role,
      avg_cost_per_conv: chatConvs ? chatCost / chatConvs : 0,
      cost_per_user_msg: chatUserMsgs ? chatCost / chatUserMsgs : 0,
      scheduled_runs_count: schedRuns,
      scheduled_runs_cost: schedCost,
    },
    unit_economics: ue,
    volume: {
      conversations: chatConvs,
      adhoc_convs: chatAdhocConvs,
      scheduled_convs: chatScheduledConvs,
      user_messages: chatUserMsgs,
      tool_calls: chatToolCalls,
      agentic_turns: chatTurns,
    },
    operations: {
      active_users: tot?.users || 0,
      provisioned_users: data.users?.provisioned_users,
      cache_hit_ratio_pct: cacheHitPct,
      errors: tot?.errors || 0,
      active_schedules: data.schedules?.by_derived_status?.active,
      total_schedules: data.schedules?.count,
    },
    cost_composition,
    by_category: {
      agent_run: categorySlice(chat, win, 'agent_run'),
      agent_chat: categorySlice(chat, win, 'agent_chat'),
      plain_chat: categorySlice(chat, win, 'plain_chat'),
    },
    by_user_top,
    by_agent_top,
    by_tool: { ...(chat?.tool_totals || {}) },
    by_model: { ...(chat?.model_totals || {}) },
    top_conversations,
    top_scheduled_runs,
  };

  if (isAggregate(data)) {
    const pool =
      data.aggregate_kind === 'clients' ? snapshots.filter((s) => !s.client_config?.dev_instance) : snapshots;
    view.by_client = buildByClientRowsWindowed(pool, win);
  }

  return view;
}

function perCategory(chat: ChatBlock | undefined, win: WindowState) {
  const cost = chat?.daily_cost_by_category;
  const msgs = chat?.daily_messages_by_category;
  const convs = chat?.daily_convs_by_category;
  const slice = (cat: 'agent_run' | 'agent_chat' | 'plain_chat') => {
    const c = sumDailyInWindow(cost?.[cat], win);
    const m = sumDailyInWindow(msgs?.[cat], win);
    const v = sumDailyInWindow(convs?.[cat], win);
    return { c, m, v };
  };
  const plain = slice('plain_chat');
  const aChat = slice('agent_chat');
  const aRun = slice('agent_run');
  return {
    plain_chat: {
      cost: plain.c,
      user_msgs: plain.m,
      convs: plain.v,
      cost_per_msg: plain.m ? plain.c / plain.m : 0,
      cost_per_conv: plain.v ? plain.c / plain.v : 0,
    },
    agent_chat: {
      cost: aChat.c,
      user_msgs: aChat.m,
      convs: aChat.v,
      cost_per_msg: aChat.m ? aChat.c / aChat.m : 0,
      cost_per_conv: aChat.v ? aChat.c / aChat.v : 0,
    },
    agent_run: {
      cost: aRun.c,
      convs: aRun.v,
      cost_per_run: aRun.v ? aRun.c / aRun.v : 0,
    },
  };
}

function categorySlice(chat: ChatBlock | undefined, win: WindowState, cat: 'agent_run' | 'agent_chat' | 'plain_chat') {
  return {
    cost: sumDailyInWindow(chat?.daily_cost_by_category?.[cat], win),
    user_messages: sumDailyInWindow(chat?.daily_messages_by_category?.[cat], win),
    convs: sumDailyInWindow(chat?.daily_convs_by_category?.[cat], win),
  };
}

function countDaysInclusive(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00Z').getTime();
  const e = new Date(end + 'T00:00:00Z').getTime();
  return Math.round((e - s) / 86_400_000) + 1;
}

/**
 * Build the full dashboard export bundle: every per-client snapshot + the
 * _FLEET and _CLIENTS aggregates, each rendered across all preset windows.
 */
export function buildDashboardExport(snapshots: ClientSnapshot[]): DashboardExportBundle {
  const windowStates: WindowState[] = DEFAULT_WINDOW_DAYS.map((n) => setLastNDays(n));
  const fleet = aggregateSnapshots(snapshots, { key: '_FLEET', kind: 'fleet' });
  const clientsAgg = aggregateSnapshots(snapshots, { key: '_CLIENTS', kind: 'clients' });

  const views: Record<string, DashboardExportClientEntry> = {};

  for (const s of snapshots) {
    views[s.client] = {
      client: s.client,
      is_aggregate: false,
      client_config: s.client_config,
      generated_at: s.generated_at,
      window_views: Object.fromEntries(
        windowStates.map((w) => [windowKey(w), buildDashboardWindowView(s as unknown as DashboardView, w, snapshots)])
      ),
    };
  }

  for (const agg of [fleet, clientsAgg]) {
    views[agg.client] = {
      client: agg.client,
      is_aggregate: true,
      generated_at: new Date().toISOString(),
      window_views: Object.fromEntries(
        windowStates.map((w) => [windowKey(w), buildDashboardWindowView(agg as unknown as DashboardView, w, snapshots)])
      ),
    };
  }

  return {
    exported_at: new Date().toISOString(),
    schema_version: '1.0',
    window_presets: [...DEFAULT_WINDOW_DAYS],
    views,
  };
}

function windowKey(w: WindowState): string {
  const days = countDaysInclusive(w.startDate, w.endDate);
  return `${days}d`;
}

// Re-exports for callers that don't need to import multiple modules
export { computeInferredCosts } from './inferredCosts';
// Type re-exports for downstream consumers
export type { CostExplorerBlock, PerAgentStats, AggregateView };
