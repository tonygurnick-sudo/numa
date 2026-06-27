import ReactMarkdown from 'react-markdown';

// Static reference document for anyone (human or LLM) consuming the exported
// snapshot JSON. Documents the schema + every non-obvious design decision —
// especially the ones that change what raw numbers mean (cost re-pricing,
// standalone Numa-attributable filter, etc.).
//
// Keep this in sync with: shared.ts (filter rules), gather/chat.py (pricing
// model + per-day buckets), gather/__init__.py (block composition).
export const README_MARKDOWN = `
# Numa Dashboard — schema + analysis README

This document is the source of truth for anyone (human or LLM) consuming the
exported JSON. Read it before computing anything from the data — several
numbers have been pre-processed and won't mean what you'd assume from their
raw service line items.

## What you're looking at

A 90-day rolling window of fleet analytics for every Numa client deployment.
Each client has one **snapshot** (a single JSON object) under
\`SNAPSHOT#latest\` in the \`numa-portal-fleet-analytics\` DynamoDB table.
Snapshots are regenerated nightly (00:00 UTC) by the
\`numa-fleet-analytics-rollup-orchestrator\` Step Function.

Aggregates (\`_FLEET\`, \`_CLIENTS\`) are **not** stored — the dashboard rolls
them up in the browser from per-client snapshots so we can iterate on filters
without a Lambda redeploy. If you're analysing the fleet as a whole, sum the
per-client snapshots yourself; if you're focused on one client, just read its
snapshot directly.

The dashboard ships **two** export shapes — check \`export_kind\` to know
which you have:

**\`export_kind: "raw_snapshots"\`** — the rest of this README applies. Wraps:

\`\`\`
{
  export_kind:    "raw_snapshots",
  exported_at:    ISO8601 string,
  snapshot_count: number,
  snapshots:      { [clientName]: ClientSnapshot },
  inferred_costs: { [clientName]: InferredCostBreakdown }   // see decision #11
}
\`\`\`

**\`export_kind: "dashboard_view"\`** — pre-aggregated, what the dashboard
renders. Use this when you want "what is on screen" without re-deriving:

\`\`\`
{
  export_kind:     "dashboard_view",
  exported_at:     ISO8601 string,
  schema_version:  "1.0",
  window_presets:  [7, 14, 30, 60, 90],
  views: {
    [clientName | "_FLEET" | "_CLIENTS"]: {
      client, is_aggregate, client_config?, generated_at,
      window_views: {
        "7d":  DashboardWindowView,
        "14d": DashboardWindowView,
        "30d": DashboardWindowView,
        "60d": DashboardWindowView,
        "90d": DashboardWindowView
      }
    }
  }
}

DashboardWindowView = {
  window, spend, unit_economics, volume, operations,
  cost_composition, by_category,
  by_user_top, by_agent_top, by_tool, by_model,
  top_conversations, top_scheduled_runs,
  by_client?   // aggregate views only (_FLEET / _CLIENTS / _ARCANUM)
}
\`\`\`

Dashboard-view fields are all window-scoped: \`spend.inferred_total\` is the
inferred (quota-sharing-adjusted) total for that window, \`spend.role\` is
the window-scoped role (\`standalone\` / \`borrower\` / \`lender\` / \`mixed\`),
\`cost_composition\` already has Claude lines collapsed into one
\`Numa LLM (inferred)\` slice. No raw daily maps — if you need those, use
the raw-snapshots export.

The \`inferred_costs\` block (in either export) is a frontend derivation
that **corrects for Bedrock quota sharing** — read decision #11 before
doing per-client cost analysis or you will mis-attribute spend.

## Top-level schema

\`\`\`
{
  client:           string               // client name (e.g. "av-media")
  window_days:      number               // typically 90
  generated_at:     ISO8601 string

  client_config: {
    client_name, client_account_id, region, dev_instance, bedrock_account,
    allow_bedrock_quota_sharing, preferred_kb,
    account_org: 'nextgen' | 'arcanum' | 'standalone' | null
  }

  chat:             ChatBlock            // see below
  cost_explorer:    CostExplorerBlock    // see below
  scheduled_runs:   ScheduledRunsBlock
  schedules:        SchedulesBlock
  agents:           AgentsBlock
  integrations:     IntegrationsBlock
  pipedream:        PipedreamBlock
  users:            UsersBlock
  impact:           ImpactBlock
}
\`\`\`

## Design decisions you MUST know about

### 1. Cost composition is Numa-attributable, not raw AWS CE — for standalone customer accounts

**Why:** standalone customer accounts host non-Numa workloads (RDS, OpenSearch,
QuickSight, EC2, etc.) alongside Numa. Showing raw Cost Explorer in the
dashboard would attribute customer-owned workloads to Numa.

**Logic:**
- \`account_org === 'nextgen' | 'arcanum'\`: full CE passes through unfiltered.
  The entire account bill IS Numa COGS (we own the account; the customer pays
  Arcanum for the Numa subscription).
- \`account_org === 'standalone'\`: an allowlist of Numa-provisioned AWS
  services is applied. Anything not on the list is summed into
  \`cost_explorer.non_numa_filtered_total\` and dropped from
  \`grand_total\`, \`totals_by_service\`, \`totals_by_day\`,
  \`by_service_daily\`.
- \`account_org === null\` (unknown): pass-through (same as nextgen). Most
  unknowns are legacy deployments that should be backfilled.

The filter is applied **everywhere** the dashboard surfaces a standalone
client's CE: the aggregate (\`_FLEET\` / \`_STANDALONE\`), the per-row "By
client" table, AND the per-stack view (e.g. clicking retailcare in the
sidebar). Raw unfiltered CE is only visible by reading the source DDB row
directly.

**What's kept (the allowlist):**

- All Bedrock model line items (anything starting with \`Claude \`)
- Amazon Bedrock, Amazon Bedrock AgentCore, Amazon Q, Amazon Q Business
- AWS Lambda, AWS Step Functions
- Amazon DynamoDB, Amazon Glacier, Amazon SimpleDB, Amazon OpenSearch Serverless
  (Bedrock KB backend — NOT the provisioned \`Amazon OpenSearch Service\`)
- Amazon API Gateway, Amazon CloudFront, Amazon Route 53, Amazon Cognito
- AmazonCloudWatch, CloudWatch Events, AWS KMS, AWS Secrets Manager,
  AWS Identity and Access Management
- Amazon EC2 Container Registry, Amazon SNS, Amazon SQS,
  Amazon Simple Workflow Service, AWS Cost Explorer
- Amazon Transcribe, Amazon Comprehend, Amazon Textract,
  Amazon Simple Email Service

**What's filtered out (for standalone accounts only):**

- *Customer's own infrastructure*: Amazon RDS, Amazon OpenSearch Service
  (provisioned, NOT the Serverless variant), Amazon QuickSight, Amazon EC2
  Compute, EC2-Other (NAT/EBS/ENI), Amazon Virtual Private Cloud,
  Amazon Elastic Load Balancing, Amazon Elastic Container Service, AWS Fargate
- *Customer's storage / ETL*: Amazon Simple Storage Service (S3),
  AWS Glue. Numa's S3 usage per client is \\$0.10-5/month (chat traces, app
  outputs); standalone S3 bills are dominated by customer data lake /
  backups / static assets, so we filter unconditionally. Glue is rarely
  used by Numa at all.
- *Customer's security / observability extras*: Amazon GuardDuty, AWS Security
  Hub, AWS Config, AWS Amplify, Amazon Macie, Amazon Inspector, Amazon Athena,
  AWS WAF / WAFV2
- *Account-level overhead*: Tax, AWS Support (Business)

Services intentionally kept in the allowlist that COULD be partially customer
in some accounts but are usually Numa: \`AmazonCloudWatch\` (Numa generates
logs), \`Amazon Q\` (Q Business when client's \`preferred_kb=q\`), \`Amazon
Cognito\`. If a specific client's standalone view looks off, check the raw
DDB row to confirm which lines drive the spend.

**If you're doing your own analysis on standalone accounts**, decide whether
you want the Numa-attributable view (\`cost_explorer.grand_total\` as-is,
plus \`non_numa_filtered_total\` if you want to know how much was dropped) or
the full AWS bill (sum the raw \`totals_by_service\` from the source DDB row
before any frontend filtering).

### 2. Cost is recomputed from token counts, not the SDK's \`total_cost_usd\`

**Why:** The Claude Agent SDK prices ALL cache writes at the 5-minute tier
(\\$3.75/MTok for Sonnet). But the workspace agent enables 1-hour caching,
which Bedrock bills at the 1-hour tier (\\$6/MTok). The SDK undercharges
1h-cache writes by ~\\$2.25/MTok — typically ~22% underpricing on Sonnet-heavy
stacks. The dashboard's \`total_cost_usd\` is the **recomputed** figure
(canonical); \`sdk_cost_usd\` is the SDK's own number, kept as a sidecar for
cross-check.

**Cross-region inference multiplier:** Bedrock regional cross-region profiles
(\`us.\`, \`apac.\`, \`eu.\`) add a 10% markup over base in-region pricing.
Numa invoked through these profiles up until **2026-05-22**, when we cut over
to the \`global.\` inference profile (no markup). Events strictly before that
cutover get the 1.10 multiplier; events on/after get the base price. The
cutover applies retroactively on every nightly rollup — historical traces are
re-priced.

**Validated against AWS Cost Explorer**: 13 settled days of av-media,
recomputed costs match actual Bedrock CE within 1.2%.

### 3. Per-day buckets are derived from event timestamps, not conversation start

Every per-day map (\`daily_cost\`, \`daily_messages\`, \`daily_turns\`,
\`daily_tool_calls\`, \`daily_active_users\`, \`daily_scheduled_count\`,
\`daily_adhoc_count\`, plus their \`*_by_user\` / \`*_by_agent\` /
\`*_by_category\` variants) buckets activity to the day it **actually
happened**, derived from the trace's per-event timestamps.

**Why this matters:** a \\$10 conversation that ran over two weeks would
otherwise dump its whole cost into a single day (its \`last_request_at\`),
making the dashboard's window slicing wildly wrong for long-running chats and
scheduled agents.

**Fallback path:** when only DDB meta is available (no S3 trace was parsed),
the conv's totals collapse into its \`last_request_at\` day. Affects a small
minority of convs — call it out in your analysis if precision matters.

### 4. Conversations are categorised three ways

- **\`agent_run\`** — conversation_id starts with \`schedule-\`. Catches both
  cron-scheduled and event-triggered agent invocations (they share the prefix).
- **\`agent_chat\`** — has an \`agent_id\` but conversation_id does NOT start
  with \`schedule-\` (a human chatting with an agent).
- **\`plain_chat\`** — no \`agent_id\` (a human chatting with Numa directly).

This split appears in \`chat.by_category\` (snapshot-wide) and
\`chat.daily_*_by_category\` (per-day per-category). Cost/turn/message counts
for each category are independent — sum them to get the total.

### 5. \`user_messages\` excludes skill loads

The Claude Agent SDK injects skill content as **user-role** text messages
starting with \`"Base directory for this skill:"\`. Without filtering, every
Skill tool_use would add +1 to \`user_messages\`, roughly doubling the count
for scheduled runs that load any skill. Those auto-injected user messages
are excluded from \`user_messages\` (and from \`daily_messages\` /
\`daily_messages_by_user\` / \`daily_messages_by_category\`).

If you're computing "cost per user message", the denominator already excludes
skill loads.

### 6. Conversation data is the UNION of S3 traces and DDB meta items

The rollup iterates the union of (a) every \`trace.jsonl\` found in
\`s3://numa-{client}-outputs/numa-chat/workspace/\` and (b) every \`meta\`
item in \`numa-{client}-chat-history\`.

**Why the union (not just DDB meta):** scheduled-run conversations frequently
end up in S3 without a meta item ever being written — iterating DDB meta only
would silently drop ~20-30% of scheduled cost. See
\`dev-notes/tasks/av-media-cost-investigation/\` for the investigation.

S3 supplies cost/tokens/per-day buckets. DDB supplies nice-to-have fields
(\`agentTitle\`, \`isAgentConversation\`, the canonical \`latestTimestamp\`).

### 7. \`cost_explorer\` is deduplicated by AWS account ID at the aggregate level

Multiple stacks can share an AWS account in the pre-NextGen architecture
(e.g. dev/demo stacks all live in the Q-demo account). When computing the
\`_FLEET\` aggregate, CE is summed once per unique \`client_account_id\` —
not once per snapshot. Chat / users / agents / schedules are still summed
per-stack (those are stack-isolated).

If you're aggregating in your own code, mirror this dedup or you'll
double/triple-count shared-account spend.

**In the "By client" table** the dashboard goes further: three known shared
dev accounts (Q-demo, HQ + Trial, Quota sharing) collapse into a single row
each. Their CE is the deduped account total; per-stack columns (chat cost,
convs, users, schedules, agents, time saved) are summed across the grouped
stacks. Other shared accounts (NextGen config errors) deliberately do NOT
collapse — they show as duplicated rows so the misconfig is visible.

### 7a. Stack categorisation rules

The dashboard slices stacks into four buckets for sidebar grouping +
aggregate filters:

- **R&D dev** — \`client_config.dev_instance === true\` AND the stack name
  is NOT in the internal-client allowlist (currently just \`hq\`). These are
  ad-hoc developer / demo / quota-sharing stacks. Excluded from
  \`_CLIENTS\`.
- **Internal** — \`hq\`. Arcanum's own Numa deployment (dogfooding).
  Excluded from \`_CLIENTS\` so customer KPIs don't include our usage.
  Has its own "Internal" section in the sidebar.
- **NextGen customer** — \`client_config.account_org === 'nextgen'\`.
  Arcanum-owned per-client AWS account; entire bill IS Numa COGS.
- **Standalone customer** — \`client_config.account_org === 'standalone'\`.
  Customer-owned AWS account; non-Numa filter applies (see §1).

\`_CLIENTS\` aggregate = "not R&D dev" AND "not internal". This is the
"real external customers" pool.

### 8. AWS Cost Explorer lags 1-2 days

CE numbers for the most recent 1-2 days are partial. The dashboard hides this
caveat behind a footnote in the Spend KPIs. If you're comparing
\`cost_explorer.totals_by_day\` to \`chat.daily_cost\` (recomputed from
traces), expect the trace numbers to be more current.

### 9. Conversation titles are NEVER included

Top-N conversations (in \`chat.top_conversations\`) carry IDs, timestamps,
\`agent_title\`, cost, tokens, and tool counts only. The conversation's
human-readable title is stripped because it can contain sensitive client
content. Identify rows by \`started_at\` + \`agent_title\` + IDs.

### 10. \`cache_creation_tokens\` is the rolled-up figure

When the SDK supplies the breakdown (\`cache_creation.ephemeral_1h_input_tokens\`
+ \`ephemeral_5m_input_tokens\`), those land in
\`cache_creation_1h_tokens\` / \`cache_creation_5m_tokens\` and their sum is
\`cache_creation_tokens\`. Older traces only carry the rolled-up figure — in
those, \`cache_creation_tokens\` is set but the 1h/5m breakdown is zero, and
the recompute assumes 5m (matching what the SDK assumed, so we don't
double-correct).

### 11. Bedrock quota sharing — prefer \`inferred_costs\` over raw \`cost_explorer\` for per-client analysis

Some clients have \`client_config.bedrock_account\` set (borrowers) or
\`client_config.allow_bedrock_quota_sharing: true\` (lenders). Their Claude
invocations are routed through the cross-account \`bedrock-quota-sharing\`
IAM role and billed to a DIFFERENT account than the one running their stack.
Consequence: \`cost_explorer.totals_by_service\` is misleading.

- **Borrowers** show ~$0 on every \`Claude * (Amazon Bedrock Edition)\` CE
  line despite real LLM usage (the cost is on the pool account, not theirs).
- **Lenders** show INFLATED Claude CE lines — their bill absorbs every
  borrower's Claude usage on top of their own.
- This affects ONLY the Claude model service lines. Other Bedrock-related
  CE lines (\`Amazon Bedrock\` for Nova-Lite / Titan Embeddings,
  \`Amazon Bedrock AgentCore\` for MicroVM hosting) are NOT quota-shared and
  are correctly attributed.

The exported JSON bundles a per-client \`inferred_costs\` block that fixes
this by replacing the Claude CE lines with the token-priced
\`chat.daily_cost\` series:

\`\`\`
inferred_total[d] = ce_total[d] − ce_claude[d] + chat[d]
lent[d]           = max(0, ce_claude[d] − chat[d])     # lender-direction
borrowed[d]       = max(0, chat[d] − ce_claude[d])     # borrower-direction
\`\`\`

The block carries:
- \`ceClaudeDaily\`, \`chatDaily\`, \`inferredTotalDaily\` — per-day maps
- \`lentDaily\`, \`borrowedDaily\` — per-day quota-sharing-direction signal
- \`totals\` — window sums (\`ceTotal\`, \`ceClaude\`, \`chat\`, \`inferred\`,
  \`lent\`, \`borrowed\`, \`delta\`)
- \`role\` — \`standalone\` / \`borrower\` / \`lender\` / \`mixed\`
  (window-scoped; \`mixed\` means quota sharing was toggled mid-window)

**For per-client cost analysis, use \`inferred_costs.totals.inferred\` as
the per-client total.** Use raw \`cost_explorer.grand_total\` only when you
specifically want "what AWS billed this account" (audit / chargeback /
investigating who paid for what). For fleet-wide subsidy questions, sum
\`inferred_costs.totals.lent\` across all clients — that's roughly what
Arcanum-controlled lender accounts and the pool account paid on others'
behalf.

The same logic also fills in the 1-2 day CE billing lag for standalone
clients: the most recent days have $0 Claude CE for everyone (lag), but
\`chat.daily_cost\` is current — so inferred totals are honest at all times.

## Useful query patterns

**Window-aware spend** (any \`daily_*\` map → sum days in window):
\`\`\`
sum(daily_cost[d] for d in days_in_window)
\`\`\`

**Cost per user message** (window-aware):
\`\`\`
sum(daily_cost[d]) / sum(daily_messages[d])      // overall
sum(daily_cost_by_category[c][d]) / sum(daily_messages_by_category[c][d])  // per-category
\`\`\`

**Numa-attributable AWS spend for a standalone account** (per-snapshot,
window-scoped):
\`\`\`
sum(by_service_daily[svc][d] for d in days_in_window
                              for svc in by_service_daily)
\`\`\`
(\`by_service_daily\` is already Numa-filtered for standalone accounts when
read through the dashboard's aggregator; the raw DDB row has the unfiltered
service list.)

**Per-agent scheduled vs ad-hoc cost** (window-scoped):
\`\`\`
sched = sum(daily_scheduled_cost_by_agent[agent_id][d] for d in days_in_window)
adhoc = sum(daily_adhoc_cost_by_agent[agent_id][d] for d in days_in_window)
\`\`\`

## Schema reference

### \`chat\` block

\`\`\`
chat: {
  window_days: number,
  all_time_count: number,

  totals: { cost, sdk_cost, convs, turns, requests, user_messages, errors,
            users, tool_calls, input_tokens, output_tokens,
            cache_read_tokens, cache_creation_tokens },

  // 3-way categorization (see §4 above)
  by_category: {
    agent_run:  { convs, cost, user_messages, turns, tool_calls,
                  input_tokens, output_tokens },
    agent_chat: { same shape },
    plain_chat: { same shape }
  },

  // Top-N by cost. Privacy-stripped (no titles).
  top_conversations: [{ conversation_id, user_id, agent_id, agent_title,
                        model, is_scheduled, is_agent_conversation,
                        started_at, last_request_at, span_seconds,
                        total_cost_usd, total_turns, user_messages,
                        tool_call_count, request_count, input_tokens,
                        output_tokens }],

  // Per-user / per-agent rollups (snapshot-wide)
  by_user:   { [user_sub]:  { cost, convs, requests, turns, user_messages,
                              tool_calls, avg_span_seconds, first_at, last_at } },
  by_agent:  [{ agent_id, agent_title, scheduled_count, adhoc_count,
                cost, scheduled_cost, adhoc_cost, turns, user_messages,
                tool_calls, first_at, last_at }],

  // Per-day buckets — bucketed by EVENT timestamp (see §3 above)
  daily_cost, daily_messages, daily_convs, daily_turns, daily_tool_calls,
  daily_active_users, daily_scheduled_count, daily_adhoc_count,

  // Per-day per-user / per-agent / per-category drilldowns
  daily_cost_by_user:     { [user_sub]:  { [day]: number } },
  daily_messages_by_user: { [user_sub]:  { [day]: number } },
  daily_cost_by_agent:    { [agent_id]: { [day]: number } },
  daily_scheduled_cost_by_agent: { [agent_id]: { [day]: number } },
  daily_adhoc_cost_by_agent:     { [agent_id]: { [day]: number } },
  daily_cost_by_category, daily_messages_by_category, daily_convs_by_category,
  daily_turns_by_category, daily_tool_calls_by_category,

  // Per-day per-model — powers the window-aware "Models in use" table.
  // (Absent on snapshots generated before this shipped; consumers fall back
  // to the snapshot-wide model_totals below.)
  daily_cost_by_model:  { [model_id]: { [day]: number } },
  daily_convs_by_model: { [model_id]: { [day]: number } },

  // Snapshot-wide tool/model aggregates. model_totals is the 90d roll-up;
  // for window-scoped per-model use daily_cost_by_model / daily_convs_by_model.
  tool_totals:   { [tool_name]: total_use_count },
  model_totals:  { [model_id]:  { cost, convs } },
  scheduled_vs_adhoc: { scheduled: agg, adhoc: agg }
}
\`\`\`

### \`cost_explorer\` block

\`\`\`
cost_explorer: {
  window: { start, end, days },
  grand_total: number,           // Numa-attributable for standalone; full bill for nextgen/arcanum
  totals_by_service:    { [service]: $$ },
  totals_by_day:        { [day]: $$ },
  by_service_daily:     { [service]: { [day]: $$ } },
  bedrock_usage_type_totals: { [usage_type]: $$ },
  non_numa_filtered_total: number   // $$ dropped by the standalone filter; 0 for nextgen/arcanum
}
\`\`\`

### \`scheduled_runs\` block

Counts and costs for cron-scheduled / event-triggered agent runs. Sourced from
\`s3://.../numa-chat/scheduled-runs/\` — independent path from interactive
\`workspace/\` chats. \`top_scheduled_runs\` carries the same privacy
guarantees as \`top_conversations\`.

### \`schedules\` / \`agents\` / \`integrations\` / \`pipedream\` blocks

Snapshot-wide configuration counts. Not time-bounded — these reflect current
state at \`generated_at\`, not the window. Don't subtract them across days
to infer activity.

### \`impact\` block

Time-saved math derived from \`agents.estimated_time_saved_minutes\` ×
\`scheduled_runs.totals.count\`. Snapshot-wide; the dashboard pro-rates it to
the window picker by the share of runs that fell inside.

## Things explicitly NOT in the snapshot

- Conversation message content / titles
- User PII beyond \`user_sub\` (anonymous opaque ID)
- Cognito email addresses (these stay in the client's User Pool)
- Pipedream-side OAuth tokens or external-service responses
- Raw Bedrock invocation payloads

## Provenance + how to reproduce

- **Lambda:** \`numa-fleet-analytics-rollup\` (Python 3.13, deployer account)
- **Trigger:** \`numa-fleet-analytics-rollup-orchestrator\` Step Function,
  daily at 00:00 UTC, fan-out across clients (max concurrency 5)
- **Per-client work:** assumes \`ArcanumAIAccess\` role in each client account,
  scans Cost Explorer, walks S3 traces, scans chat-history meta, queries
  Pipedream relay, etc.
- **Code paths to read for the canonical logic:**
  - \`lambdas/python/numa-fleet-analytics-rollup/numa_fleet_analytics_rollup/gather/chat.py\` (pricing model, per-day buckets, 3-way categorization)
  - \`lambdas/python/numa-fleet-analytics-rollup/numa_fleet_analytics_rollup/gather/cost_explorer.py\` (CE queries)
  - \`numa-customer-success-portal/src/Components/NumaDashboard/shared.ts\` (Numa-attributable filter, aggregation)
`;

export function ReadmeTab() {
  return (
    <div className="nd-card">
      <div className="nd-card-header">
        <div className="nd-card-title">README.md</div>
        <div className="nd-card-subtitle">
          Schema + design decisions. Read this before doing your own analysis on the exported JSON.
        </div>
      </div>
      <div className="markdown-body" style={{ padding: '1rem 1.5rem 2rem' }}>
        <ReactMarkdown>{README_MARKDOWN}</ReactMarkdown>
      </div>
    </div>
  );
}
