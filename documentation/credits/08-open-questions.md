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

### B1. Classifier value-signal (the "#0" item — high priority)

The classifier under-tiers **execution-only value**: a terse ask ("generate this week's sales report") that pulls
from 5 integrations classifies **medium**, not high, because the prompt is ask-anchored and the actions block is
framed as _effort_ (discounted). Proven fix (empirically flips medium→high without over-inflating): surface the
**tools/integrations/data-sources touched + deliverable nature** as a **value** signal (from trace `tool_use`),
not effort telemetry; optionally add the rubric rule "judge by what the task did; multi-source/cross-system =
high." This is **the real efficiency hedge** — value-led pricing only protects margin if cheap-but-valuable work
actually reaches the high tier. Prototyped in the R&D backfill; the live prompt/signal change is the prod
follow-up. (Aligns the shipped `CLASSIFIER_SYSTEM` with `complexity-rubric.md`.)

### B2. Measured AgentCore-seconds (replace the flat 1.234×)

The floor uses a flat `AGENTCORE_MULT = 1.234` (Step-01 fleet average). Replace with **measured per-conversation
AgentCore-seconds** once we have per-`conv-{id}` AgentCore billing data; add **Transcribe** and **heavy-Lambda**
cost lines too. The multiplier is the correct _default_; these are refinements.

### B3. Classifier-cost handling + re-classify cadence

Nova classifier cost isn't currently folded into `consumptionCostUsd`. Decide storage (separate running tally vs
fold-in). Also: live classification currently runs **every turn until `very_high`** — likely ~10× more Nova than
needed; evaluate a **re-classify-every-K-turns** optimisation.

### B4. Monthly reconciliation vs the real AWS bill

`month_aggregate_item` already supports `actualAwsBillUsd` / `platformFeeUsd` / `marginVsRealBill`, but nothing
pulls Cost Explorer, so `marginVsRealBill` is unpopulated. This is the spec's §6 "standing monthly control" — the
only check that catches infra drift (it doesn't depend on any internal multiplier).

### B5. Billing-admin Cognito role

Ian wants a single special **billing-admin** who can see the credit admin view (vs the generic `admin` check).
Replace `isAdmin('admin')` in `admin-credits` + the `SHOW_CREDITS` gating, and wrap the portal `/numa-credits`
route in `<ProtectedRoute requireRole=…>` once the role exists.

### B6. Portal allocation enhancements

`monthlyAllocations` is a flat 12-array (calendar months, same every year). For ramping/multi-year deals,
consider year-aware storage (`YYYY-MM` keyed). "Reset to defaults" + the 12-month grid + the "set every month"
broadcast already exist; this is the next step if multi-year is needed.

### B7. In-client dashboard polish

- The in-client **Credits Dashboard** doesn't yet surface the **top-up balance** as its own card (it's in the
  shared summary header but not the charts area) — minor add when the dashboard styling pass happens.
- Ian's full admin-dashboard vision (3–6 month trend, separate agent-adhoc split, top-5 agents via agentId join,
  deeper board→agent→run navigation) — partially prototyped in the R&D calculator HTML.

### B8. Deploy-time seed of the `CONFIG` row (optional)

Could seed the client `CONFIG` row from `config.creditConfig` at `numa-client-stack` deploy. Not needed today —
lib defaults cover until the first portal save, and skipping it guarantees a deploy never clobbers a portal value.

---

## C. Known minor issues / tidy-ups

- **`flooredMsgs` mislabel** — `processing.py` sets it to the count of turns with _positive cost_, not turns where
  the floor beat the value tier. Cosmetic telemetry field; fix when convenient.
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
- Defaults: `$0.30` · chat 2/4/8/18 · agent 2/3/5/12 · margins 1.15/1.3/1.6/2.0 · 2000/mo.
