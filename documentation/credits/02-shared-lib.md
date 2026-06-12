# 02 — Shared library: `lib/credit-pricing`

The **single source of billing truth**. Pure Python, stdlib-only (no boto3/network), so any consumer can import
it cheaply: the live `credit-debit` Lambda, the `credit-nightly` Lambda, and the `tools/backfill-credit-ledger.py`
backfill all share it — live and historical metering agree **by construction**.

Packaged as a Poetry path-dependency (`credit-pricing = {path = "../../../lib/credit-pricing", develop = true}`)
into each Lambda's bundle.

```
lib/credit-pricing/
├── credit_pricing/
│   ├── credits.py      # constants + floor / margin math
│   ├── pricing.py      # Anthropic-on-Bedrock cost recompute (rate card)
│   ├── tiers.py        # value tiers + Nova classifier + receipt/title generation
│   ├── processing.py   # trace events -> per-turn costs -> ledger rows (orchestration)
│   ├── ledger.py       # DynamoDB row builders (schema single-source)
│   └── timeutil.py     # NZ billing-calendar helpers
├── tests/              # pytest — 24 tests, run with: python3 -m pytest -q
└── pyproject.toml
```

---

## `credits.py` — constants + floor/margin math

**Canonical constants** (the Python side of the mirrored defaults):

| Name                         | Default                                           | Meaning                                                                                                    |
| ---------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `CREDIT_USD`                 | `0.30`                                            | 1 credit in USD (≈ NZD $0.50 @ 1.69).                                                                      |
| `MARGIN_TARGET`              | `2.0`                                             | Scalar fallback margin for unclassified conversations.                                                     |
| `DEFAULT_MONTHLY_ALLOCATION` | `2000`                                            | New-client starter allocation per month; `credit-debit` falls back to it when no allocation is configured. |
| `AGENTCORE_MULT`             | `1.234`                                           | Floor basis = token cost × this (tokens + AgentCore).                                                      |
| `MARGINS_BY_TIER`            | `{low:1.1, medium:1.25, high:1.4, very_high:1.6}` | Per-tier defence (min-enforced) margins.                                                                   |
| `TRIVIAL_CONSUMPTION_USD`    | `0.01`                                            | Below this, value tier is capped at `low`.                                                                 |

**Functions:**

- `floor_credits(consumption_usd, *, margin=MARGIN_TARGET, credit_usd=CREDIT_USD) -> float` — `consumption × margin / credit_usd` rounded UP to the nearest 0.5 credit; 0 if consumption ≤ 0. The cost-recovery floor (half-credit granularity so fractional value tiers genuinely bill).
- `credits_to_usd(credits, *, credit_usd=CREDIT_USD) -> float` — customer-facing USD value of a credit count.
- `margin_actual(credits_charged, consumption_usd, *, credit_usd=CREDIT_USD) -> float | None` — realised
  margin `(credits × credit_usd) / consumption`; `None` if no cost. Monitor per row: < 1.0 ⇒ wiring bug.

> Note both `floor_credits` and `margin_actual` take `credit_usd` as a keyword — always thread the
> conversation's effective `credit_usd` through, never rely on the module default (a latent bug fixed during the
> $0.50→$0.40→$0.30 changes was a caller using the module default instead of the conversation's price).

---

## `pricing.py` — Anthropic-on-Bedrock cost recompute

The canonical rate card + `recalculate_anthropic_cost(...)`. Rates are **USD per million tokens**.

**Why recompute at all** (not trust the SDK's `total_cost_usd`): the Claude Agent SDK under-reports
`cache_creation` on the **1h** cache tier (Numa's interactive chat uses 1h cache) by ~2× — it only knows the 5m
write rate, while AWS bills the 1h rate. So we recompute from raw token counts using the correct per-tier rates.

`ANTHROPIC_MODEL_PRICING` (current entries):

| Model                                      | input | output | cache_write_5m | cache_write_1h | cache_read |
| ------------------------------------------ | ----: | -----: | -------------: | -------------: | ---------: |
| `anthropic.claude-sonnet-4-6`              |  3.00 |  15.00 |           3.75 |           6.00 |       0.30 |
| `anthropic.claude-opus-4-6-v1`             | 15.00 |  75.00 |          18.75 |          30.00 |       1.50 |
| `anthropic.claude-haiku-4-5-20251001-v1:0` |  1.00 |   5.00 |           1.25 |              … |          … |

**No 1M-context premium tier — deliberately.** The premium (`_200k` rates) applies per API _call_ when a single
prompt exceeds 200K tokens on the 1M-context model variant, which Numa doesn't route to. Critically, every caller
feeds usage **summed across a whole agentic request** (SDK `ResultMessage` aggregates all inner API calls), so a
threshold check here fires on cumulative cache reads that AWS bills at standard rates — that bug inflated agentic
conversation costs ~1.6–1.8× until removed (June 2026). If 1M context is ever enabled, the premium must be priced
per individual API call, never from aggregated result usage.

`recalculate_anthropic_cost` accepts per-tier cache-creation splits
(`cache_creation_5m_tokens` / `cache_creation_1h_tokens`) when the trace carries
`usage.cache_creation.ephemeral_{1h,5m}_input_tokens`; otherwise it falls back to a global `cache_ttl`
("5m"/"1h").

> **Keep in sync** with `services/numa-workspace-agent/numa_workspace_agent/sdk_config.py:ANTHROPIC_MODEL_PRICING`.
> Note `lib/bedrock` has a _separate_, non-cache-aware pricing table for a different purpose — don't confuse them.

---

## `tiers.py` — value tiers + Nova classifier + receipts

**Value tiers:**

- `VALUE_TIER_CREDITS = {chat: {low:1, medium:2, high:5, very_high:8}, agent: {low:0.5, medium:1.5, high:3, very_high:5}}`.
- `tier_to_credits(tier, context="chat", *, overrides=None) -> int` — looks up the credits; unknown tier → that
  context's `medium`; unknown context → the chat table. `overrides` lets a client's CONFIG override the table.
- `VALID_TIERS = ("low","medium","high","very_high")`, `TIER_RANK = {low:1,…,very_high:4}`.
- `max_tier(a, b) -> str` — the higher-ranked of two tiers; the **ratchet** primitive (tier only goes up).

**Nova classifier:**

- `NOVA_MODEL = "global.amazon.nova-2-lite-v1:0"` (Amazon Nova 2 Lite).
- `classify(user_texts, *, context, actions, value_signal="", bedrock, region, model=NOVA_MODEL) -> {"tier"}` —
  calls Nova with `CLASSIFIER_SYSTEM`; returns `medium` on any error. **Tier only** — the live path no longer
  produces a work `category` (see note below). The complexity rubric lives in
  `dev-notes/tasks/credits-work/complexity-rubric.md` (R&D); `CLASSIFIER_SYSTEM` is the shipped prompt.
  - **`actions`** = trusted EFFORT telemetry (turn/token volume, models) → a `<work_done>` block.
  - **`value_signal`** = trusted VALUE telemetry — the distinct tools/integrations touched (from
    `processing.tools_value_signal`) → a `<work_delivered>` block. This is the **cross-system value signal**:
    a terse ask that pulled from many integrations is high-VALUE even when the words are thin. `CLASSIFIER_SYSTEM`
    carries the matching rubric rule ("judge by what the task DID; multi-source/cross-system = high"). Ported
    live 2026-06-03 from the proven backfill prototype, so live == backfill classification.
- `_parse_classification(text) -> {"tier"}` — tolerant JSON parse (ignores any extra keys).

> **No live `category`.** `classify()` used to return a descriptive work `category` too; it was removed from
> the live debit path (2026-06-03). `VALID_CATEGORIES` is kept in `tiers.py` marked **reserved** for a planned
> nightly-receipt category field (admin-safe, off the hot path) — see
> [08-open-questions.md](08-open-questions.md). Don't re-add category to the live classifier.

**Anonymised receipt (nightly):**

- `generate_receipt(user_texts, *, actions, bedrock, region, model=NOVA_MODEL) -> {"title", "deliverables"}` —
  the admin-safe, anonymised title + deliverables list (uses `RECEIPT_SYSTEM`, parsed by `_parse_receipt`).
- `generate_title(...)` — still defined but **no longer called live** (the live debit path stopped titling; the
  nightly job owns anonymised labels).

---

## `processing.py` — trace → costs → ledger rows

Pure orchestration; no S3/Nova/boto3 (callers fetch the trace and decide the title/tier).

- `TurnCost` dataclass — one `result` turn's tokens + model + `recomputed_usd`.
- `process_trace_events(events, *, cache_ttl="1h") -> (turns, user_texts, first_ts, last_ts)` — walks the trace
  once: recovers the model from the preceding `assistant` event, prices each `result` turn via `pricing.py`,
  collects user texts (for the classifier), and the earliest/latest ISO timestamps (the real wall-clock span).
- `extract_tools(events) -> list[str]` — distinct tool/integration names from the trace's assistant `tool_use`
  blocks (first-seen, deduped). `tools_value_signal(tools) -> str` — formats them into the classifier's VALUE
  signal (empty string when no tools, so the prompt omits the block). The cross-system breadth signal fed to
  `classify(value_signal=…)`. Mirrors the backfill so live == historical classification.
- `build_conversation_rows(*, conversation_id, user_sub, month, last_ts, turns, title, margin, credit_usd, …, value_tier, context, source, agent_id, value_tier_credits, trivial_consumption_usd, margins, agentcore_mult) -> (meta, msg_rows)`
  — the deterministic assembly: applies the trivial cap, computes the single-ceil floor on
  `total_consumption × agentcore_mult`, records `agentCoreCostUsd = consumption × (mult − 1)`, computes
  `charge = max(value, floor)`, stamps `agentId` on the META row (for Top-5-agents name resolution), and builds
  the META + MSG rows (via `ledger.py`). Pre-classification (no `value_tier`) → value 0, charged = floor.

---

## `ledger.py` — DynamoDB row builders (schema single-source)

Pure dict builders (no boto3; the caller coerces floats → `Decimal` at write time). Keeps the PK/SK/GSI layout
and field names in one place so the live Lambda and backfill can't drift.

**Key helpers:** `conv_pk(id)`, `msg_sk(ts, msg_id)`, `client_pk(client)`, `month_sk(month)`,
`txn_sk(ts, id)` → `TXN#<ts>#<id>`, `settlement_sk(month)` → `TXN#SETTLEMENT#<month>`.

**Drawdown helpers:**

- `overflow_credits(consumed_credits, allocation_credits) -> float` — `max(0, consumed − max(0, allocation))`.
- `available_balance(txn_credits_sum, open_month_overflow) -> float` — `txn_sum − max(0, overflow)` (can be < 0).

**Row builders:**

- `meta_item(...)` — the conversation aggregate (display + telemetry; `marginVsConsumption` measured against
  `consumption + agentcore_cost`, threading the conversation's `credit_usd`).
- `msg_item(...)` — per-message detail; asserts no `content`/`text`/`prompt` ever.
- `month_aggregate_item(*, client, month, credit_revenue_usd, consumption_cost_usd, credits_charged=0, allocation_snapshot=None, actual_aws_bill_usd=None, platform_fee_usd=None)` —
  the monthly rollup; `creditsCharged` + `allocationSnapshot` added for the drawdown model;
  `marginVsRealBill` computed if a real AWS bill is supplied (the §6 reconciliation hook — currently unused).
- `txn_item(*, client, kind, credits, created_at, created_by="system", txn_id=None, month=None, note=None)` —
  a balance event-log row. `kind ∈ TXN_KINDS = ("topup","settlement","adjustment")`; `settlement` uses the
  deterministic per-month SK (idempotent) and requires `month`; others are append-only/time-ordered. Raises on
  an unknown kind or a settlement without a month.

---

## `timeutil.py` — NZ billing calendar

- `BILLING_TZ = ZoneInfo("Pacific/Auckland")` — the one billing calendar for all clients.
- `billing_month_of(iso_ts) -> "YYYY-MM"` — the NZ-local month an ISO timestamp falls in (naive → treated as UTC).
- `billing_now() -> datetime` (NZ), `billing_month_now() -> "YYYY-MM"`.
- `previous_billing_month("2026-01") -> "2025-12"` — wraps the year.

Runtime note: `zoneinfo` needs the IANA tz DB. The Lambdas add the `tzdata` pip package so
`ZoneInfo("Pacific/Auckland")` resolves regardless of the base image (verified in the bundle).

---

## Tests

`python3 -m pytest -q` from `lib/credit-pricing/` (26 tests). Coverage includes:

- `test_processing.py` — charge = max(value, floor); unclassified → floor; single-ceil floor (not per-message
  sum); the trivial-cost cap; per-tier cache-creation split; the no-premium-on-cumulative-usage regression
  guard; per-tier margin
  lifting the floor; the AgentCore uplift in the floor (default 1.234, and `marginVsConsumption` measured against
  tokens + AgentCore).
- `test_tiers.py` — `tier_to_credits` for the current defaults; classifier parse.
- `test_ledger.py` — META keys + `marginVsConsumption` at the default `credit_usd`; MSG carries no content; the
  month aggregate (incl. `creditsCharged` + `allocationSnapshot`); `overflow_credits`; `available_balance`;
  `txn_item` topup + idempotent settlement SK + guards.
- `test_timeutil.py` — NZ-vs-UTC boundary bucketing; DST not hardcoded; naive→UTC; previous-month year wrap.

> When you change a default in `credits.py`/`tiers.py`, expect 2–3 assertions in these tests to need updating
> (they pin the current scheme on purpose, as a drift guard).
