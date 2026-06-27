/**
 * Type definitions for Numa Dashboard fleet-analytics snapshots.
 *
 * Mirrors what the rollup Lambda's gather pipeline emits to DynamoDB.
 * Aggregates (_FLEET, _NEXTGEN, etc.) are computed in the BROWSER from
 * per-client snapshots — see Components/NumaDashboard/shared.ts for the
 * aggregation helpers.
 *
 * Privacy note: conversation titles, schedule prompts, schedule labels,
 * and error text are NEVER stored in the snapshot — they can contain
 * sensitive client content. Conversations/runs are identified by IDs +
 * timestamps + numeric stats only.
 */

// ─── shared primitives ────────────────────────────────────────────────────

export interface ClientConfigSummary {
  client_name?: string;
  client_account_id?: string;
  region?: string;
  dev_instance?: boolean;
  bedrock_account?: string | null;
  allow_bedrock_quota_sharing?: boolean;
  preferred_kb?: string | null;
  // From numa-client-metadata. Drives the Cost-composition filter: standalone
  // customer accounts get an allowlist applied so their non-Numa AWS workloads
  // (RDS, OpenSearch, QuickSight, ...) don't bleed into the donut + KPIs.
  account_org?: 'nextgen' | 'arcanum' | 'standalone' | null;
}

// ─── per-client snapshot ──────────────────────────────────────────────────

export interface CostExplorerBlock {
  window?: { start: string; end: string; days: number };
  totals_by_service: Record<string, number>;
  totals_by_day: Record<string, number>;
  by_service_daily?: Record<string, Record<string, number>>;
  grand_total: number;
  bedrock_usage_type_totals?: Record<string, number>;
  // Set by the frontend after filtering standalone customers' non-Numa AWS
  // workloads out of the rollup. Sum of services that were dropped from
  // grand_total — surfaced in the dashboard as a "$X filtered" badge so the
  // raw AWS bill is still inspectable. Always 0 for nextgen/arcanum.
  non_numa_filtered_total?: number;
}

/**
 * Top-N conversation summary. Privacy-stripped: no title (use `started_at`
 * as the identifier in the UI).
 */
export interface TopConversation {
  conversation_id: string;
  user_id?: string;
  agent_id?: string;
  agent_title?: string;
  model?: string;
  is_scheduled: boolean;
  is_agent_conversation?: boolean;
  started_at?: string; // first_request_at
  last_request_at?: string;
  span_seconds?: number | null;
  total_cost_usd: number;
  total_turns: number;
  user_messages: number;
  tool_call_count: number;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
}

export interface PerUserStats {
  cost: number;
  convs: number;
  requests: number;
  turns: number;
  user_messages: number;
  tool_calls: number;
  avg_span_seconds: number | null;
  first_at: string | null;
  last_at: string | null;
}

export interface PerAgentStats {
  agent_id: string;
  agent_title?: string | null;
  scheduled_count: number;
  adhoc_count: number;
  cost: number;
  /** Cost from scheduled / event-triggered runs only. */
  scheduled_cost?: number;
  /** Cost from ad-hoc agent chats only (user clicked into the agent). */
  adhoc_cost?: number;
  turns: number;
  user_messages: number;
  tool_calls: number;
  first_at: string | null;
  last_at: string | null;
}

/**
 * 3-way conversation classification.
 *
 *  - `agent_run`  scheduled or event-triggered agent invocation
 *                 (conversation_id starts with 'schedule-')
 *  - `agent_chat` user chatting with an agent (has agent_id, not a run)
 *  - `plain_chat` user chatting without an agent
 */
export interface CategoryStats {
  convs: number;
  cost: number;
  user_messages: number;
  turns: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
}

export interface ByCategoryBlock {
  agent_run: CategoryStats;
  agent_chat: CategoryStats;
  plain_chat: CategoryStats;
}

export interface ChatBlock {
  window_days: number;
  all_time_count?: number;
  top_conversations: TopConversation[];
  top_conversations_kept?: number;
  top_conversations_dropped?: number;
  totals: {
    cost: number;
    /** SDK-reported cost — sidecar for cross-check vs the canonical
     *  `cost` field (which is recomputed with proper 1h-cache pricing). */
    sdk_cost?: number;
    convs: number;
    turns: number;
    requests: number;
    user_messages: number;
    errors: number;
    users: number;
    tool_calls: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  };
  by_user: Record<string, PerUserStats>;
  by_agent: PerAgentStats[];
  /** 3-way conversation classification (snapshot-window totals). */
  by_category?: ByCategoryBlock;
  // Daily buckets — frontend slices these by selected window for KPIs +
  // trend charts. Replaces the per-conversation array.
  daily_cost: Record<string, number>;
  daily_messages: Record<string, number>;
  daily_convs: Record<string, number>;
  daily_turns: Record<string, number>;
  daily_tool_calls: Record<string, number>;
  daily_active_users: Record<string, number>;
  daily_scheduled_count: Record<string, number>;
  daily_adhoc_count: Record<string, number>;
  /** Per-day cost keyed by user_id. Enables window-aware "All Users" table. */
  daily_cost_by_user?: Record<string, Record<string, number>>;
  /** Per-day user-messages keyed by user_id. */
  daily_messages_by_user?: Record<string, Record<string, number>>;
  /** Per-day cost keyed by agent_id (agent runs + agent chat). */
  daily_cost_by_agent?: Record<string, Record<string, number>>;
  /** Per-day scheduled-run cost keyed by agent_id. */
  daily_scheduled_cost_by_agent?: Record<string, Record<string, number>>;
  /** Per-day ad-hoc-chat cost keyed by agent_id. */
  daily_adhoc_cost_by_agent?: Record<string, Record<string, number>>;
  /** Per-day cost keyed by category (agent_run / agent_chat / plain_chat). */
  daily_cost_by_category?: Record<string, Record<string, number>>;
  /** Per-day user-messages keyed by category. */
  daily_messages_by_category?: Record<string, Record<string, number>>;
  /** Per-day conversation count keyed by category. */
  daily_convs_by_category?: Record<string, Record<string, number>>;
  /** Per-day total turns keyed by category. */
  daily_turns_by_category?: Record<string, Record<string, number>>;
  /** Per-day tool-call count keyed by category. */
  daily_tool_calls_by_category?: Record<string, Record<string, number>>;
  /** Per-day cost keyed by model id. Enables the window-aware "Models in use"
   *  table. Absent on snapshots generated before this field shipped — consumers
   *  fall back to the snapshot-wide `model_totals`. */
  daily_cost_by_model?: Record<string, Record<string, number>>;
  /** Per-day conversation count keyed by model id. */
  daily_convs_by_model?: Record<string, Record<string, number>>;
  tool_totals: Record<string, number>;
  model_totals: Record<string, { cost: number; convs: number }>;
  scheduled_vs_adhoc: {
    scheduled: { count: number; cost: number; turns: number; requests: number; user_messages: number };
    adhoc: { count: number; cost: number; turns: number; requests: number; user_messages: number };
  };
}

export interface ScheduleRow {
  schedule_id?: string;
  user_id?: string;
  agent_id?: string;
  agent_title?: string;
  label?: string;
  status: string;
  derived_status: 'active' | 'completed' | 'scheduled' | 'paused' | 'deleted' | string;
  trigger_type?: string;
  cron_expression?: string;
  cron_kind?: 'recurring' | 'one-off' | 'unknown';
  cron_state?: 'recurring' | 'expired' | 'scheduled' | 'unknown';
  projected_runs_per_month: number;
  is_one_off: boolean;
  total_runs: number;
  max_runs?: number;
  last_run_epoch?: number;
  last_status?: string;
  last_error_present?: boolean;
}

export interface SchedulesBlock {
  count: number;
  rows: ScheduleRow[];
  by_status: Record<string, number>;
  by_derived_status: Record<string, number>;
  by_event_type?: Record<string, number>;
  by_trigger?: Record<string, number>;
  total_runs: number;
  schedules_with_errors: number;
  projected_runs_per_month_total: number;
  schedule_to_agent?: Record<string, string>;
  error?: string;
}

/**
 * Top-N scheduled run summary. Privacy-stripped: no `prompt` (the user's
 * schedule template), no `scheduleLabel`, no error text — only status and
 * `errors_in_trace` count.
 */
export interface TopScheduledRun {
  schedule_id: string;
  user_id?: string;
  conversation_id?: string;
  agent_id?: string;
  agent_title?: string;
  agent_version?: string;
  started_at?: string;
  completed_at?: string;
  status: string;
  cost: number;
  turns: number;
  requests: number;
  user_messages: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  duration_ms_total: number;
  model?: string;
  errors_in_trace: number;
  first_request_at?: string;
  last_request_at?: string;
  filename_ts_ms?: number;
  last_modified?: string | null;
}

export interface ScheduledRunsBlock {
  discovered?: number;
  fetch_errors?: number;
  top_runs: TopScheduledRun[];
  top_runs_kept?: number;
  top_runs_dropped?: number;
  totals: { count: number; cost: number; turns: number };
  by_status: Record<string, number>;
  by_agent: Record<
    string,
    { agent_id: string; agent_title?: string; runs: number; cost: number; turns: number; errors: number }
  >;
  daily_runs: Record<string, number>;
  daily_cost: Record<string, number>;
  error?: string;
}

export interface AgentRow {
  agent_id?: string;
  title?: string;
  visibility?: string;
  agent_type?: string;
  estimated_time_saved_minutes?: number;
  version?: number;
  created_by_user_id?: string;
  created_at?: string | number;
  updated_at?: string | number;
}

export interface AgentsBlock {
  agents?: { count: number; rows: AgentRow[]; error?: string };
  user_agents?: { count: number; rows: AgentRow[]; error?: string };
}

export interface KnowledgeBaseRow {
  kb_id?: string;
  name?: string;
  kind?: string;
}

export interface IntegrationsBlock {
  data_connectors?: {
    count: number;
    by_type?: Record<string, number>;
    by_user_count?: Record<string, number>;
    error?: string;
  };
  knowledge_bases?: { count: number; rows: KnowledgeBaseRow[]; error?: string };
  'mcp-tool-policies'?: { count: number; error?: string };
  'global-data-connector-settings'?: { count: number; error?: string };
  'integrations-approval'?: { count: number; error?: string };
}

export interface CognitoBlock {
  user_pool_id?: string;
  user_pool_name?: string;
  provisioned_users?: number;
  modified_in_last_30d?: number;
  sub_to_email?: Record<string, string>;
  warning?: string;
  error?: string;
}

export interface PipedreamAppRow {
  app_name: string;
  user_count: number;
  user_subs: string[];
  /** Only populated in aggregate views — number of stacks where the app
   *  has at least one connection. Not set on per-client snapshots. */
  stack_count?: number;
}

export interface PipedreamBlock {
  fn_name?: string;
  skipped?: string;
  users_queried: number;
  users_with_data: number;
  users_with_errors: number;
  active_connections: number;
  distinct_active_apps: number;
  by_app_active: PipedreamAppRow[];
  per_user_active?: Record<string, string[]>;
}

export interface ImpactBlock {
  total_time_saved_minutes: number;
  per_agent_runs: Record<string, number>;
  total_schedule_runs: number;
  total_agents: number;
  total_schedules: number;
  active_schedules: number;
}

/**
 * One per-client snapshot row (written by the rollup Lambda). The frontend
 * reads many of these and either renders one directly or rolls a subset up
 * into an aggregate view via shared.ts helpers.
 */
export interface ClientSnapshot {
  client: string;
  generated_at?: string;
  window_days: number;
  client_config?: ClientConfigSummary;
  cost_explorer: CostExplorerBlock;
  chat: ChatBlock;
  schedules: SchedulesBlock;
  scheduled_runs: ScheduledRunsBlock;
  agents: AgentsBlock;
  integrations: IntegrationsBlock;
  users: CognitoBlock;
  pipedream: PipedreamBlock;
  impact: ImpactBlock;
}

// ─── aggregate view (derived in browser) ──────────────────────────────────

export interface ByClientRow {
  client: string;
  dev_instance: boolean;
  ce_total: number;
  chat_cost: number;
  convs: number;
  user_messages: number;
  active_users: number;
  provisioned_users: number;
  schedules: number;
  active_schedules: number;
  scheduled_runs: number;
  agents: number;
  kbs: number;
  integrations: number;
  time_saved_minutes: number;
  bedrock_account?: string | null;
  region?: string;
  client_account_id?: string;
}

export interface DistributionStats {
  min: number;
  median: number;
  mean: number;
  max: number;
  p90: number;
}

/**
 * Result of rolling N per-client snapshots up into one synthetic view.
 * Shape mirrors `ClientSnapshot` so the same tab components can render
 * either — plus aggregate-only extras (`by_client`, `per_stack_averages`,
 * etc.). The CE totals here are deduped by `client_account_id` so shared
 * AWS accounts (dev stacks) aren't counted multiple times.
 */
export interface AggregateView {
  client: string; // synthetic key like "_FLEET", "_NEXTGEN", "_DEV"
  is_aggregate: true;
  aggregate_kind: string;
  generated_at?: string;
  window_days: number;
  stack_count: number;
  unique_account_count: number;
  cost_explorer: CostExplorerBlock;
  chat: ChatBlock;
  schedules: SchedulesBlock;
  scheduled_runs: ScheduledRunsBlock;
  agents: AgentsBlock;
  integrations: IntegrationsBlock;
  users: CognitoBlock;
  pipedream: PipedreamBlock;
  impact: ImpactBlock;
  by_client: ByClientRow[];
  per_stack_averages: {
    ce_total: number;
    chat_cost: number;
    active_users: number;
    convs: number;
    user_messages: number;
    turns: number;
    tool_calls: number;
    schedules: number;
    agents: number;
    kbs: number;
    time_saved_minutes: number;
  };
  distributions: Record<
    'ce_total' | 'chat_cost' | 'convs' | 'active_users' | 'user_messages' | 'schedules',
    DistributionStats
  >;
  outliers: Array<{ client: string; metric: string; value: number; mean: number; z_score: number }>;
}

// ─── union + helpers ──────────────────────────────────────────────────────

export type DashboardView = ClientSnapshot | AggregateView;

export interface SnapshotMetadata {
  clientName: string;
  generated_at?: string;
  dev_instance?: boolean;
  client_account_id?: string;
  region?: string;
  chat_cost: number;
  ce_total: number;
  /** From numa-client-metadata. Drives the NextGen / Standalone aggregate
   *  sidebar entries + the standalone Numa-attributable cost filter. */
  account_org?: 'nextgen' | 'arcanum' | 'standalone' | null;
}

export type RefreshScope = { kind: 'all' } | { kind: 'client'; clientName: string };

export interface RollupResponse {
  ok: boolean;
  scope: string;
  client?: string | null;
  duration_ms: number;
  per_client?: Array<{ clientName: string; ok: boolean; duration_ms: number; error: string | null }>;
  error?: string;
}

// Back-compat aliases (preserved so any not-yet-migrated call sites still
// resolve; the union type is what new code should use).
export type FleetAnalyticsSnapshot = DashboardView;
