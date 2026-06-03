# 01 — Architecture: pricing model, ledger schema, drawdown & settlement

This is the conceptual core. Read it before the implementation docs.

---

## 1. The charge formula

Per **conversation** (not per message), the charge is:

```
charge_credits = max( value_credits , floor_credits )
```

### Value credits

`value_credits = VALUE_TIER_CREDITS[context][tier]`

- `context` ∈ `{chat, agent}` — see §5.
- `tier` ∈ `{low, medium, high, very_high}` — the Nova-classified complexity (see [03-live-metering.md](03-live-metering.md)).
- Defaults: chat `2/4/8/18`, agent `2/3/5/12`.
- An **unclassified** conversation has `value_credits = 0` (so the floor sets the charge).

### Floor credits (cost-recovery)

```
floor_basis_usd = total_token_cost_usd × AGENTCORE_MULT          # tokens + AgentCore
floor_credits   = ceil( floor_basis_usd × tier_margin / credit_usd )
```

- `tier_margin = MARGINS_BY_TIER[tier]` (defaults `1.15/1.3/1.6/2.0`); falls back to the scalar `MARGIN_TARGET`
  (2.0) when unclassified.
- `AGENTCORE_MULT = 1.234` — the floor is enforced over **tokens + AgentCore**, not tokens alone. (1.234 is the
  Step-01 fleet-average uplift of token cost → token+AgentCore cost. It's the current best estimate; a future
  refinement replaces it with measured per-conversation AgentCore-seconds + Transcribe/heavy-Lambda lines.)
- `ceil` rounds **up** so the floored charge never dips below the target margin.
- It's a **single ceil on the conversation total**, NOT a sum of per-message ceils (per-message floors are kept
  on the MSG rows for detail only — summing them would over-charge).

### Why max(value, floor)

The value tier is "what the work was worth"; the floor is "never bill below cost × margin". Whichever is larger
wins. On token-heavy work the floor binds; on cheap-but-valuable work the value tier binds. This is what protects
margin as Numa gets more efficient: for **value-bound** conversations, a falling token cost flows straight to
margin (the charge is fixed in credits). For **floor-bound** conversations the charge tracks cost, so the
**margin %** is preserved but the absolute credit count falls as cost falls.

### The anti-inflation trivial cap

Before the floor is computed, if a conversation's measured consumption is below `TRIVIAL_CONSUMPTION_USD`
($0.01) its value tier is capped at `low` regardless of what the classifier returned. This stops a hallucinated
or prompt-injected high tier from billing near-zero work as premium. It only caps the _value_ tier — the floor
already self-limits at low cost.

---

## 2. The health metric — margin-vs-consumption

```
margin_vs_consumption = charged_usd / (token_cost_usd × AGENTCORE_MULT)
```

where `charged_usd = charged_credits × credit_usd`. This is the **chat / consumption margin** — margin over
**tokens + AgentCore**. With the floor applied it can never fall below the tier margin, so a value < 1.0 means a
wiring bug, not a cheap customer. It's recorded on each META row as `marginVsConsumption`, and per-client/month
on the MONTH aggregate.

> ⚠️ The **all-in** margin (≈ `margin_vs_consumption × 1.234/1.42`, dividing by tokens × ~1.42 to include fixed
> infra) was only ever a _secondary reference column_ in R&D reports. The system targets and reports the
> consumption margin above. Fixed infra is recovered separately via the platform fee, not the per-credit margin.

---

## 3. The pricing knobs (defaults)

See [06-defaults-and-config.md](06-defaults-and-config.md) for where each is defined. Summary:

| Knob                       | Field                                               | Default                                           |
| -------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| 1 credit (USD)             | `credit_usd` / `creditUsd`                          | 0.30                                              |
| AgentCore uplift           | `AGENTCORE_MULT` / `agentcoreMult`                  | 1.234                                             |
| Per-tier defence margins   | `MARGINS_BY_TIER` / `marginsByTier`                 | `{low:1.15, medium:1.3, high:1.6, very_high:2.0}` |
| Scalar fallback margin     | `MARGIN_TARGET` / `margin`                          | 2.0                                               |
| Trivial-cost cap           | `TRIVIAL_CONSUMPTION_USD` / `trivialConsumptionUsd` | 0.01                                              |
| Value tiers                | `VALUE_TIER_CREDITS` / `valueTiers`                 | chat `2/4/8/18`, agent `2/3/5/12`                 |
| Default monthly allocation | `DEFAULT_MONTHLY_ALLOCATION` / `monthlyAllocations` | 2000 (×12)                                        |

All are per-client overridable via the portal; a client with no override uses these code defaults.

---

## 4. The ledger table — `numa-<client>-credit-ledger`

One DynamoDB table **per client, in the client's own AWS account**. Created in
`infra/constructs/core-numa-infra-construct.ts` (the construct names it from `numaClient`, which already carries
the `numa-` prefix → `numa-<client>-credit-ledger`). All monetary fields are USD.

Row builders are the single schema source in `lib/credit-pricing/credit_pricing/ledger.py` — both the live
Lambda and the backfill build identical rows, so the two writers can't drift.

### Row types

| PK                | SK                         | What it is                                                                                                                                                                                      |
| ----------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONV#<id>`       | `META`                     | **Conversation aggregate** — the row the admin dashboard lists. Display + cost telemetry.                                                                                                       |
| `CONV#<id>`       | `MSG#<turn_idx>#<msg_id>`  | **Per-message** cost/credit detail. **No chat content** (privacy).                                                                                                                              |
| `CLIENT#<client>` | `MONTH#<YYYY-MM>`          | **Monthly aggregate** — revenue, consumption, `creditsCharged` count, `allocationSnapshot`, `marginVsConsumption`. Recomputed live each turn.                                                   |
| `CLIENT#<client>` | `TXN#<iso_ts>#<id>`        | **Top-up / adjustment** event (balance event log). `credits` signed.                                                                                                                            |
| `CLIENT#<client>` | `TXN#SETTLEMENT#<YYYY-MM>` | **Month-close settlement** event. Deterministic SK ⇒ idempotent (one per month).                                                                                                                |
| `CLIENT#<client>` | `CONFIG`                   | **Pushed pricing config** (creditUsd, margins, valueTiers, marginsByTier, agentcoreMult, trivialConsumptionUsd, monthlyAllocations). Written by the portal; read by credit-debit at meter time. |

> **Deprecated:** an older `CLIENT#<client>/BALANCE` scalar row existed (top-ups did `ADD balance`). The balance
> is now derived from the TXN event log (`Σ TXN.credits`); the scalar is no longer written or read. Ignore it.

### GSIs (sparse — only META rows carry the keys)

| Index  | PK                | SK             | Use                                                                                                                                                       |
| ------ | ----------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GSI1` | `USER#<sub>`      | `TS#<last_ts>` | A user's conversations, newest first.                                                                                                                     |
| `GSI2` | `MONTH#<YYYY-MM>` | `CONV#<id>`    | Per-client monthly rollup (all conversations in a month). Used by the live monthly aggregate, the nightly summariser, and the read API's ledger endpoint. |

### Key META fields

- Display (admin-safe): `title`, `deliverables[]` (both AI-anonymised by the nightly job; empty until it runs),
  `msgCount`, `tiers`, `dominantTier`, `creditsCharged`, `source` (`chat`/`agent`/`scheduled`), `firstTs`, `lastTs`.
- Internal cost telemetry: `consumptionCostUsd`, `tokenCostUsd`, `agentCoreCostUsd`, `creditsValue`, `creditsFloor`,
  `flooredMsgs`, `marginVsConsumption`, `totalTokens`, `costIncomplete`, `userSub`, `month`, `bedrockRegion`.

### Key MONTH-aggregate fields (added for the drawdown model)

- `creditRevenueUsd`, `consumptionCostUsd`, `marginVsConsumption` (original).
- `creditsCharged` — exact credit count consumed this month (not derived from revenue/price, so it stays correct
  across a mid-cycle `creditUsd` change).
- `allocationSnapshot` — the monthly allocation **in effect**, stamped each turn from the CONFIG row. The
  month-close settlement computes overflow against this snapshot, so a later config edit can't rewrite a closed
  month's overflow. (It's forward-only: the last metered turn of the month sets it; a stale snapshot self-corrects
  on the next metered turn and only matters for settlement, never the live display.)

---

## 5. Context mapping — which tier a conversation uses

The pricing `context` decides whether a conversation prices on the **chat** or **agent** value tier:

| Conversation kind   | How it's detected                                  | `context` (tier) | `source` (label) |
| ------------------- | -------------------------------------------------- | ---------------- | ---------------- |
| Plain chat          | no `agent_id`, id not `schedule-…`                 | `chat`           | `chat`           |
| Ad-hoc agent chat   | `agent_id` present (passed by the workspace agent) | `agent`          | `agent`          |
| Scheduled agent run | `conversation_id` starts `schedule-`               | `agent`          | `scheduled`      |

The rule: **any agent conversation (ad-hoc OR scheduled) prices on the agent tier**; only plain chat uses the
chat tier. `source` is the finer 3-way label used by the dashboard's consumption split. (This was a real fix —
ad-hoc agent chats previously mispriced as `chat`; see [03-live-metering.md](03-live-metering.md).)

---

## 6. The two pools & the drawdown waterfall ("Option B")

Two independent pools, **both derived, never decremented in place**:

### Monthly allocation (use-it-or-lose-it)

- `monthlyAllocations[0..11]` — a credit grant per calendar month (default 2000 each).
- `remaining(month) = allocation(month) − consumed(month)`, computed on the fly. **Never a stored counter.**
- A past month is frozen history (its allocation vs its actual consumption); a new month starts fresh; nothing
  "resets". A year later, the same calendar month is a _different_ `YYYY-MM` bucket.

### Top-up balance (persistent, event-sourced)

- The balance is the **sum of TXN events**: `topup` (+), `settlement` (−), `adjustment` (±). There is no scalar.
- A conversation draws its **month's allocation first**; the **overflow** past the allocation draws the top-up
  balance.

### The live waterfall (computed at read time — see `getStanding` / `GET /credits/balance`)

```
settledBalance   = Σ TXN.credits                                   # top-ups + settlements + adjustments
liveOverflow     = Σ over months WITHOUT a settlement TXN of max(0, consumed − allocation)
availableBalance = settledBalance − liveOverflow                   # can be NEGATIVE = invoice signal
```

- `liveOverflow` excludes already-settled months (their overflow is already in `settledBalance` as a settlement
  TXN) — so there's no double-count.
- For a month with no `allocationSnapshot` (e.g. a client with no allocation configured) the allocation is
  treated as 0, so **all** their usage overflows → balance goes negative by their full usage. This is the
  "no deal yet = everything billable" behaviour (an open policy question — see
  [08-open-questions.md](08-open-questions.md)).
- **No enforcement.** A negative balance is purely an invoicing signal; nothing blocks a client at zero.

---

## 7. Month-close settlement (the nightly job)

At each **NZ month rollover**, the `credit-nightly` Lambda settles the **previous NZ billing month**:

```
overflow = max(0, MONTH.creditsCharged − MONTH.allocationSnapshot)
if overflow > 0:  write TXN settlement (credits = −overflow, deterministic SK TXN#SETTLEMENT#<month>)
else:             delete any prior settlement for that month
```

- Deterministic SK ⇒ **idempotent**: re-running converges. Within the settling window it self-corrects for
  late-arriving traces; months older than "previous" are never re-touched, so they stay **frozen**.
- This is what makes the negative balance trustworthy for invoicing: once a closed month is settled, editing its
  config later does **not** silently move the balance — you'd post an explicit `adjustment` instead.

See [03-live-metering.md](03-live-metering.md) for the nightly Lambda detail.

---

## 8. The NZ billing calendar

All clients bill on **one** calendar — `Pacific/Auckland`, DST-aware (NZDT = UTC+13 ~late-Sep→early-Apr, NZST =
UTC+12 otherwise). Never hardcode the offset; `zoneinfo` handles DST (the Lambdas bundle the `tzdata` package).

Two places it matters, and they must agree:

1. **Consumption bucketing** — the `YYYY-MM` a conversation's credits land in = the NZ-local month of its last
   timestamp. (Was UTC; a conversation just after NZ-midnight on the 1st must count in the new month.)
2. **Settlement timing** — the nightly fires at **00:30 NZ** via EventBridge Scheduler with
   `ScheduleExpressionTimezone: Pacific/Auckland`, so the previous month is freshly closed.

USD throughout — the timezone only decides **when** a month boundary falls, never any monetary value. Helper:
`lib/credit-pricing/credit_pricing/timeutil.py`.

---

## 9. Idempotency & privacy invariants

- **Idempotent:** deterministic SKs (`META`, `MSG#<idx>#<id>`, `TXN#SETTLEMENT#<month>`) ⇒ re-processing a
  conversation or re-running the nightly/backfill overwrites, never double-counts. Stale MSG rows from a
  shortened/edited conversation are cleaned up on re-meter.
- **Privacy:** MSG rows and the in-client view never carry chat content. `title` + `deliverables` are
  AI-anonymised by the nightly summariser (a one-day lag; until then the UI shows a "summary coming overnight"
  placeholder alongside live time/credits/tier).
