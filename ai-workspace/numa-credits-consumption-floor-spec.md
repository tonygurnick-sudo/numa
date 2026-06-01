# Numa Credits — Consumption-Cost Floor & Pricing Spec

**Status:** Draft proposal — feeds Nathan's _"Refine Pricing Model"_ action item from the Credits Check-in.
**Author:** Tony Gurnick (design), captured with Claude.
**Date:** 2026-05-31
**Related artefacts:** SPK-015 _"Spike: Numa Credit System"_ · `complexity-rubric.md` (v0.1) · AV Media Value Receipt (`av-media-emma`) · _Numa Credits & Pricing — Real-Usage Analysis_ · _Numa Credits Check-in_ (Asa, Tony, Ian, Jayson, Nathan, Tom) · the April Cost Attribution Analysis (Asa).

---

## 0. Purpose

The credit model prices on **perceived value**, deliberately decoupled from token cost (Asa's call). That's right for the _upside_, but on its own it has a hole: work that is cheap to classify but **expensive to run** (token-heavy chats, scheduled agents doing heavy per-fire work, audio/video jobs) can be billed _below what it costs us to serve_ — already visible in the data as `<1×`-margin agents (SLP P&L Generator, roof-logic).

This spec defines the **cost-recovery floor** that sits underneath value pricing, the **measured consumption cost** the floor is built on, the **DynamoDB data model** that records it, and the **monthly reconciliation loop** that validates the whole thing against the real AWS bill.

**One-line model:**

> Charge for **value** above the line; never sell below **measured consumption × margin** below the line; recover **fixed** cost via the platform fee; and **reconcile monthly against the real AWS bill** so nothing drifts.

---

## 1. Decisions this builds on (already agreed in the Check-in)

- **Value-based pricing, decoupled from tokens.** A "high" task costs the same credits whether it cost us 10c or 90c of Bedrock. Efficiency gains accrue to _us_ as margin, not to a shrinking price.
- **Fixed credit model + thresholding** — flagged "NEEDS FURTHER DISCUSSION". This spec _is_ that thresholding work.
- **1 credit = NZ$0.50** (working anchor).
- **Platform fee covers fixed ops** (WAF, GuardDuty, etc.); **credit margin is the upside**; **Q Business / SharePoint are separate fixed-cost add-ons**.
- **Admin visibility (ALIGNED):** admins see high-level deliverables + credit totals only — **never raw chat content**.
- **Annual commitment, credits allocated monthly, expire monthly by default** (Asa — changeable; currently in the pricing schedule as monthly expiry).

---

## 2. Core pricing rule — value above, cost floor below

For each billing unit (see §5.1 for _unit_):

```
charge_credits = max( value_tier_credits , cost_floor_credits )
```

- **`value_tier_credits`** — the Nova 2 Lite classifier rates the work `low | medium | high | very_high`; the tier maps to credits. This is the decoupled, "charge for value" number. **Governs ~99% of the time.**
- **`cost_floor_credits`** — derived from _measured_ consumption cost (§4). **Only binds on the expensive tail**, where value pricing would otherwise lose money.

### Two thresholds, opposite ends — the model needs BOTH

|                                                               | Purpose                                                                            | Direction                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------ |
| **Anti-deflation floor** (the Check-in's "minimum threshold") | Stop efficiency gains shrinking the charge to nothing; keep perceived value stable | Floor at the **cheap** end     |
| **Cost-recovery floor** (this spec)                           | Stop token/compute-heavy work bleeding margin                                      | Floor at the **expensive** end |

Nathan's action item ("decouple margins from token costs, incorporate thresholding") is really _both_ of these. The cost-recovery floor is the one most at risk of being scoped out — it's the one that prevents losses.

> **Note on decoupling:** a cost floor is **not** re-pegging to tokens. It's a backstop that only fires on the loss-making tail. You stay decoupled in the normal case and become cost-aware only where you'd otherwise sell below cost. This is the _safe_ version of Asa's decoupling, not a contradiction.

---

## 3. What the floor recovers — the 3-bucket cost taxonomy

**Decision rule — a cost belongs in the per-unit floor only if it is all three:**

1. **Consumption-scaled** (grows with usage, not fixed),
2. **Cleanly attributable** to a single conversation/run,
3. **Material** enough that attribution is worth the engineering.

Fail any one → it goes to the **platform fee**, with the **monthly real-bill reconciliation (§6)** as the catch-all.

| Service                                                         | Consumption?    | Attributable?                                               | Material?   | Verdict                                                               |
| --------------------------------------------------------------- | --------------- | ----------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| Bedrock tokens                                                  | ✓               | ✓ per call                                                  | ✓           | **Floor (consumption)**                                               |
| AgentCore MicroVM seconds                                       | ✓               | ✓ per `conv-{id}`                                           | ✓           | **Floor (consumption)**                                               |
| Transcribe                                                      | ✓               | ✓ upload event                                              | ✓ **large** | **Floor (consumption)** — the media tail                              |
| Heavy Lambdas (browser/Playwright, large-file extraction)       | ✓               | ✓                                                           | sometimes   | **Floor when over a threshold**, else aggregate                       |
| Bedrock KB **indexing**                                         | ✓               | fuzzy (bursty, ~30-min batch, shared across future queries) | sometimes   | **Judgment call** → lean _amortize per-client / KB-tier feature_ (§8) |
| OpenSearch vector store                                         | provisioned min | ✗                                                           | —           | **Platform fee** (provisioned); §6 watchlist backstop                 |
| Q Business KB                                                   | —               | —                                                           | —           | **Add-on** (Asa's call)                                               |
| Lambda (cheap majority), DynamoDB, S3 storage, CloudWatch       | partly          | not worth it                                                | ✗           | **Platform fee + aggregate**                                          |
| WAF, GuardDuty, Cognito, NAT, KMS, Route53, CloudFront baseline | ✗ fixed         | ✗                                                           | —           | **Platform fee**                                                      |

---

## 4. The floor formula (measured consumption, no fragile multiplier)

```
consumptionCostNzd = tokenCostNzd          (Bedrock, region rate card)
                   + agentCoreCostNzd       (MicroVM resource-seconds × region rate, per conv-{id})
                   + transcribeNzd          (audio-minutes × rate, attributed to the upload)
                   + heavyLambdaNzd         (browser / large-file extraction, only when > threshold)

cost_floor_credits = ⌈ consumptionCostNzd × marginTarget ÷ 0.50 ⌉
charge_credits     = max( value_tier_credits , cost_floor_credits )
```

**Why no `infraMultiplier` (1.42) inside the floor.** Each conversation runs its own MicroVM (`conv-{conversationId}`), and AgentCore bills CPU/memory _by the second the session is alive_ — so AgentCore is directly _measurable_ per conversation, not estimated as a % of tokens. We **add a measured line**, we don't multiply by a fudge. The 1.42 was fragile precisely because the infra-to-token ratio swings wildly by conversation shape (dense one-shot ≈ 1.1×; idle warm VM ≈ 3×+; roof-logic high on both). Measuring kills that.

**Margin target is over _consumption_, not all-in.** The per-unit floor guarantees `charge × 0.50 ≥ consumptionCost × marginTarget`. The _all-in_ 2× target (incl. fixed infra) is achieved at the **client level** via platform fee + value upside, and validated in §6 — that's the grain where the averages are actually real.

Illustrative: `tokenCost 7.40 + agentCore 4.10 + transcribe 3.20 + heavyLambda 0.40 = 15.10`; floor @ 2× = `⌈15.10 × 2 ÷ 0.50⌉ = 61 cr`; value classified at 31.5 cr → **charge = max(31.5, 61) = 61 cr**. Margin-vs-consumption = `61 × 0.50 ÷ 15.10 = 2.02×`.

---

## 5. Data model (DynamoDB)

### 5.1 Billing unit

- **Floor + cost are measured per message** (catches single token-bomb messages — e.g. one scheduled fire doing 50 tool calls).
- **Display + ledger roll up to the conversation.** A long wandering conversation is _summed_, never force-classified into one tier. The total is correct by construction.
- _(Open: §8 — per-message floor vs gentler per-conversation floor.)_

### 5.2 Table: `numa-<client>-credits` (client account, beside `numa-<client>-chat-history`)

```
PK = CONV#<conversationId>
SK = META                                   ← the row the dashboard lists

── identity / routing ──
clientName · userSub · userEmail
source           chat | agent | scheduled
agentId / agentName        (when source ≠ chat)
bedrockRegion    ap-southeast-2             ← drives the rate card (cost differs per region)
month            2026-05
firstTs / lastTs / status

── display  (admin-safe — the ONLY fields an admin sees) ──
title            "Rydges April revenue validation + misc"   ← vague topical aggregate
msgCount         32
tiers            {low:24, medium:5, high:2, very_high:1}     ← histogram, NOT one label
dominantTier     low                                          ← cosmetic
creditsCharged   61                                           ← headline number

── consumption cost  (MEASURED, internal, frozen at bill time) ──
tokenCostNzd       7.40
agentCoreCostNzd   4.10
transcribeNzd      3.20
heavyLambdaNzd     0.40
consumptionCostNzd 15.10        ← the floor basis
fxRate             1.71         ← USD→NZD snapshot
rateCardVersion    2026-05-01

── credits / floor  (the billing truth) ──
creditUnitNzd        0.50       marginTarget   2.0
creditsValue         31.5       ← Σ value-tier credits (the decoupled price)
creditsFloor         61         ← Σ ⌈consumptionCost_msg × 2 ÷ 0.50⌉
creditsCharged       61         ← Σ max(valueᵢ, floorᵢ)   = SOURCE OF TRUTH
flooredMsgs          5          ← messages where floor beat value (classifier-underprice signal)
marginVsConsumption  2.02       ← (creditsCharged × 0.50) ÷ consumptionCostNzd  (must ≥ marginTarget)

# SK = MSG#<ts>#<msgId> items carry the per-message version of consumption + credits — and NO content.

── GSIs ──
GSI1  list a user's convs, recent first:  PK = USER#<sub>       SK = TS#<lastTs>
GSI2  monthly billing rollup per client:   PK = MONTH#<YYYY-MM>  SK = CONV#<id>
```

### 5.3 Aggregate item — per client, per month (the reconciliation row)

```
PK = CLIENT#<client>   SK = MONTH#2026-05
  creditRevenueNzd     Σ (creditsCharged × 0.50)
  consumptionCostNzd   Σ per-conv consumption (measured)
  actualAwsBillNzd     ← pulled from Cost Explorer (the REAL all-in number)
  platformFeeNzd
  marginVsConsumption  creditRevenue ÷ consumptionCost
  marginVsRealBill     (creditRevenue + platformFee) ÷ actualAwsBill   ← the honest all-in margin
```

### 5.4 Cross-cutting rules

- **Idempotency:** write the `MSG#` item with a _conditional put_ (skip if `messageId` exists), then atomic `ADD` its `charged` onto `META`. Replaying a message can't double-bill.
- **Privacy:** only the four `display` fields ever reach an admin. `MSG#` rows hold tier + cost but **no chat content**. Matches the ALIGNED Check-in decision.
- **Freeze on bill:** snapshot `fxRate` + `rateCardVersion` (+ consumption numbers) onto the row. Never recompute historical conversations — an FX move or rate update must not retroactively change a past invoice.

---

## 6. Reconciliation loop — the validation (do NOT skip)

A monthly job per client:

1. Sum `creditRevenueNzd` and measured `consumptionCostNzd` from the conversation rows.
2. Pull the **actual AWS bill** for that client/month from Cost Explorer (same source as the April Cost Attribution doc).
3. Compute `marginVsRealBill = (creditRevenue + platformFee) ÷ actualAwsBill`.

**Why this is non-negotiable:** the per-row `marginVsConsumption` monitor uses _measured_ consumption, so it's honest about the consumption slice — but it cannot see the **fixed/residual** infra. Only `marginVsRealBill` checks the _whole_ picture against ground truth. If a client is structurally lopsided (infra-heavy, token-light; abuses a "fixed" service; KB-index heavy), it shows up here and is handled **at the account level** (platform-fee bump or tier conversation at renewal) — _never_ by retroactively re-billing conversations. This is §12's "per-client infra > 20% of revenue" watchlist made concrete.

**The 1.42 multiplier is demoted to a planning number only** — used once to size the platform fee and tier prices, then continuously _replaced_ by the real ratio `marginVsRealBill` reports each month. We stop guessing per-row and start measuring per-month.

> This is the April Cost Attribution Analysis promoted from a one-off study into a **standing monthly control**. It is the single thing that keeps the model honest as regions, caching, and infra mix change.

---

## 7. What this fixes (traceability to known problems)

| Known problem (source)                                                                        | How this resolves it                                                                                                                  |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| _"Meeting Analyser 1hr MP4 vs 1-page PDF indistinguishable, 50× cost difference"_ (April doc) | **Transcribe in the consumption floor** — the MP4 run's floor reflects its real cost; the PDF run's doesn't. Finally distinguishable. |
| roof-logic stays loss-making even under credits (fleet doc §12)                               | Token-heavy retries **and** repeated MicroVM spins are both _measured consumption_ → its floor reflects true cost.                    |
| `<1×`-margin agents — credits track messages, cost tracks tokens (Value Receipt note)         | Floor on **measured consumption per message** → credits can never fall below cost × margin.                                           |
| Idle warm-VM distortion (token-light, VM-time-heavy)                                          | AgentCore warm seconds are **measured and attributed** to the conv that kept the VM alive.                                            |
| "The margin monitor is blind to its own multiplier"                                           | `marginVsRealBill` divides by the **actual AWS bill**, not a multiplier → drift becomes visible.                                      |

---

## 8. Open decisions — need team sign-off

1. **Per-message vs per-conversation floor.** Per-message (assumed above) is margin-safe — every message covers its own cost, so a token-bomb message can't hide in a cheap chat. Per-conversation is gentler (allows intra-conv cross-subsidy, less nickel-and-diming). Store both `creditsValue` and `creditsFloor` either way so the policy can flip without a backfill.
2. **KB indexing attribution.** Lean: **amortize at the client/KB-tier level** (matches the 1 / 5 / unlimited KB feature ladder) rather than spiking the one conversation that uploaded the doc.
3. **OpenSearch classification.** Lean: **platform fee** (provisioned OCU minimums = effectively fixed), with the §6 watchlist as the drift alarm. Reclassify only if a truly pay-per-query store is used.
4. **AgentCore metric for scheduled fires.** Exact unit (resource-seconds vs session-duration × configured CPU/mem) and how a _scheduled fire_ maps to MicroVM time — fuzziest attribution, biggest cost tail. Needs Nathan + the AgentCore billing data.
5. **`marginTarget` (consumption) + platform-fee co-calibration.** Two dials that together hit the all-in target at the client level. Decide the split.
6. **Anti-deflation minimum credits/task** (the cheap-end threshold) — the value the Check-in agreed in principle but didn't set.
7. **Classifier cost.** Nova 2 Lite runs per message (classification + title) → real per-message cost. On low-tier (1 cr = NZ$0.50), the Nova classifier + title calls eating > ~NZ$0.25 pushes low tier under 2× (already the thinnest tier). Must be inside `consumptionCostNzd`.
8. **Display of floored charges.** If a "very*high / 40 cr" task bills at 61, the tier label and the charge disagree. Options: tiers generous enough the floor rarely fires; cap how far the floor exceeds tier and eat the rest; or let the floor silently bump the \_displayed* tier. → Tuesday UX prototype (Ian/Tom/Tony task force).
9. **Monthly expiry policy** (Asa's default) — confirm or change rollover.

---

## 9. Build notes — where each number comes from

- **`tokenCostNzd`** — Bedrock returns input/output/**cache** token counts per call. Price via a rate card keyed by **(model, region)** — `{inputPer1k, outputPer1k, cacheReadPer1k, cacheWritePer1k}` in USD. **Cache reads are ~10% of input rate** and dominate iterative chats (1-hour prompt cache is a headline efficiency lever) — price them at the cache rate or the floor will be wildly over-stated.
- **`agentCoreCostNzd`** — MicroVM resource-seconds for `conv-{id}` × region rate. Include warm/idle seconds until the session times out.
- **`transcribeNzd`** — Transcribe job duration (audio-minutes) × rate, attributed to the upload that triggered it.
- **`heavyLambdaNzd`** — only browser-lambda / large-file extraction, and only when the per-invocation cost crosses a threshold.
- **Multi-model:** one conversation can mix Sonnet (main) + Haiku (routed) + Nova 2 Lite (classifier + title). `tokenCostNzd` sums across **all** model calls — don't assume one model per conversation.
- **`actualAwsBillNzd`** — Cost Explorer, per client account, per month (the April doc's data source).
- **Regions in play:** `us-east-1` (most), `ap-southeast-2` (Sydney + Nolia AgentCore), `ap-southeast-3` (Jakarta / Nolia). Rate card must cover all three.

---

_End of draft. Intended as input to Nathan's "Refine Pricing Model" task and the Tuesday UX session. Nothing here is committed code or a final pricing decision — the §8 calls are for the team._
