# 08 — Open questions, decisions & deferred work

The living "what's not done / not decided" list. The authoritative running version is
`dev-notes/tasks/credits-work/todo.md` (git-ignored); this is the committed snapshot for onboarding. Grouped by:
**genuinely open** (need a human decision) and **decided-but-deferred** (we know what to build, just haven't).

---

## A. Genuinely open — need Nathan / Asa / Ian

### A1. Credit-grant / onboarding policy

- **New clients:** the code default is now **2000 credits/mo** (so a fresh client meters against a real plan, not
  0). Real deals set per-client allocations in the portal. _Decided: 2000 default._
- **Still open:** what does **allocation = 0** mean for a client we haven't done a deal with — _exempt/internal_
  (don't surface a negative balance) or _everything billable_ (balance goes negative by full usage = invoice
  signal)? Today the waterfall treats a missing allocation as 0 → all usage overflows → negative balance. That's
  the right behaviour **if** "no deal = bill it"; if some clients should be exempt, we need an explicit
  exempt/internal flag. This drives whether the fleet "owed" rollup lights up red for un-dealt clients.
- **Enforcement:** confirmed **reporting-only** for the foreseeable — no hard cutoff at zero. Revisit only if/when
  we want gating ("out of credits" as a real blocking state).

### A2. `credit_usd` posture / reference pricing

- `$0.30` (≈ NZD $0.50) is the settled default. Asa/sales sign-off before it hardens into customer-facing pricing.

### A3. Reference pricing bands (the efficiency hedge)

- Price the **floor** off a _fixed rate-card band_ (≥ our cost), not the actual model cost. Then if Numa switches
  to a cheaper model or fewer tokens, the floor doesn't shrink and efficiency accrues to **margin**, not customer
  discount. Implementation: split `floorBasisUsd` (band) from `consumptionCostUsd` (actual, kept for
  reconciliation). **Deferred** — Sonnet-only today so no short-term effect; needs band numbers from Nathan/Asa.

---

## B. Decided / understood — not yet built

### B1. Classifier value-signal (the "#0" item) — ✅ DONE 2026-06-03

The classifier under-tiered **execution-only value**: a terse ask ("generate this week's sales report") that pulls
from 5 integrations classified **medium**, not high. **Shipped live**: `classify(value_signal=…)` now gets the
distinct tools/integrations touched (`processing.extract_tools`/`tools_value_signal`) as a `<work_delivered>`
VALUE signal, and `CLASSIFIER_SYSTEM` carries the rubric rule "judge by what the task did; multi-source/
cross-system = high." Ported from the proven backfill prototype, so live == backfill. See
[02-shared-lib.md](02-shared-lib.md) / [03-live-metering.md](03-live-metering.md).

### B2. Measured AgentCore-seconds (replace the flat 1.234×)

The floor uses a flat `AGENTCORE_MULT = 1.234` (Step-01 fleet average). Replace with **measured per-conversation
AgentCore-seconds** once we have per-`conv-{id}` AgentCore billing data; add **Transcribe** and **heavy-Lambda**
cost lines too. The multiplier is the correct _default_; these are refinements.

### B3. Classifier-cost handling + re-classify cadence

Nova classifier cost isn't currently folded into `consumptionCostUsd`. Decide storage (separate running tally vs
fold-in). (The **re-classify-every-K-turns** idea was considered and **dropped** 2026-06-03 — the current
every-turn-until-`very_high` cadence is fine; Nova cost is a tiny fraction of consumption.)

### B4. Monthly reconciliation vs the real AWS bill

`month_aggregate_item` already supports `actualAwsBillUsd` / `platformFeeUsd` / `marginVsRealBill`, but nothing
pulls Cost Explorer, so `marginVsRealBill` is unpopulated. This is the spec's §6 "standing monthly control" — the
only check that catches infra drift (it doesn't depend on any internal multiplier).

### B5. Billing-admin — ✅ DONE 2026-06-03 (built as a DynamoDB roster, NOT a Cognito role)

Ian's "single special billing-admin who sees the credit view (vs generic `admin`)" is shipped — but **not** as a
Cognito group/role. Rationale: role changes are client-side (admins hold `AdminAddUserToGroup`), so a group would
be self-grantable. Instead membership is `CLIENT#/BILLING_ADMIN#<sub>` rows, written only through caller-checked
server paths (`admin-credits` POST) or the portal (assume-role) — genuinely enforceable. `admin-credits`
balance/ledger now gate on `isBillingAdmin`; in-client lock screen + User Management toggle; portal bootstrap
tool. Full model in [09-billing-admin.md](09-billing-admin.md). (The portal `/numa-credits` route stays on the
existing portal auth — no new portal role needed.)

### B6. Portal allocation enhancements

`monthlyAllocations` is a flat 12-array (calendar months, same every year). For ramping/multi-year deals,
consider year-aware storage (`YYYY-MM` keyed). "Reset to defaults" + the 12-month grid + the "set every month"
broadcast already exist; this is the next step if multi-year is needed.

### B7. In-client dashboard polish

- ✅ **Done 2026-06-03:** the **source split** (chat / agent / scheduled, the agent-adhoc separation) ships as
  `CreditsSourceChart`; **Top-5 agents by agentId→name** ships (agentId stamped on META, resolved via
  `listAgents`); top-up balance is its own summary tile.
- Still open: a 3–6 month trend graph and deeper board→agent→run navigation (prototyped in the R&D calculator HTML).

### B8. Deploy-time seed of the `CONFIG` row (optional)

Could seed the client `CONFIG` row from `config.creditConfig` at `numa-client-stack` deploy. Not needed today —
lib defaults cover until the first portal save, and skipping it guarantees a deploy never clobbers a portal value.

---

## C. Known minor issues / tidy-ups

- ~~**`flooredMsgs` mislabel**~~ — ✅ DONE 2026-06-03: the field was **removed** entirely (dead — written but
  read by nobody, and meaningless under the conversation-level floor).
- **`generate_title` is dead-ish** — still defined in `tiers.py` but no longer called live (the nightly owns
  anonymised labels). Leave or remove.
- **Stale comments** — `numa-frontend/.../CreditsDashboard/helpers.ts` references the now-deleted
  `CreditsAdminPanel` in comments.
- **Task-splitting** — one conversation collapses to one (ratcheted max) tier; no per-deliverable segmentation
  (the old `task_segmenter` idea). An extension, not a fix.

---

## D. Settled in this line of work (for the record)

- Value+floor model with per-tier defence margins; AgentCore uplift **in** the floor (default, not future work).
- Two-pool drawdown (Option B): monthly allocation use-it-or-lose-it → overflow draws the persistent top-up
  balance; balance is an **event log**; months **freeze at NZ rollover** via an idempotent settlement TXN.
- Single **NZ billing calendar** for all clients (bucketing + settlement).
- **Agent chats price on the agent tier** (ad-hoc + scheduled); plain chat on the chat tier.
- Config authored centrally in the **portal** and **pushed** to client accounts; in-client view **read-only**,
  gated by `SHOW_CREDITS`; metering on for everyone.
- Defaults: `$0.30` · chat 1/2/5/8 · agent 0.5/1.5/3/5 · margins 1.1/1.25/1.4/1.6 · 2000/mo (lowered 2026-06-10 after early pricing feedback).
