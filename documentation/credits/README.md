# Numa Credit System — Developer & Agent Documentation

> Audience: **Arcanum engineers and AI coding agents.** This is internal documentation, not client-facing.
> Goal: someone (or some agent) with **zero prior context** can read this folder and fully understand how
> the credit system works, where everything lives, and how to operate/extend it.

The Numa Credit System (ticket **SPK-015**) meters every Numa conversation, prices it in **credits**, and
tracks per-client consumption against a monthly allocation + a top-up balance. It was originally shipped by
Tony (commit `2681ee950`) and then substantially extended (drawdown model, NZ billing calendar, event-log
balance, portal authoring, agent-tier pricing, in-client dashboard).

---

## The model in 90 seconds

Every conversation is charged:

```
charge_credits = max( value_tier_credits , floor_credits )

floor_credits  = ceil( token_cost_usd × AGENTCORE_MULT × tier_margin / credit_usd )
```

- **Value tier** — a Nova-classified complexity tier (`low` / `medium` / `high` / `very_high`) maps to a
  fixed number of credits, separately for **chat** vs **agent** conversations. This is the "what the work
  was worth" price.
- **Floor** — a cost-recovery safety net: the charge can never be worth less (in USD) than the conversation's
  measured token cost × an AgentCore uplift × a per-tier margin. This guarantees we never bill below cost.
- The conversation is charged the **greater** of the two.

Everything is in **USD** — there is deliberately **no FX** in the billing engine, so an exchange-rate move can
never retroactively reprice usage. (NZD is shown in the portal as a display-only sense-check.)

### The current defaults (Scheme settled 2026-06-03)

| Knob                              | Default                    | Notes                                                                           |
| --------------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| `credit_usd`                      | **$0.30**                  | ≈ NZD $0.50 at FX 1.69 — the NZD-anchored price                                 |
| value tiers — **chat**            | **2 / 4 / 8 / 18**         | low / medium / high / very_high                                                 |
| value tiers — **agent**           | **2 / 3 / 5 / 12**         | agent (ad-hoc + scheduled) is cheaper than chat above the shared 2-credit floor |
| defence (min-enforced) margins    | **1.15 / 1.3 / 1.6 / 2.0** | per tier; the floor's multiple over cost                                        |
| `AGENTCORE_MULT`                  | **1.234**                  | floor basis = tokens + AgentCore, not tokens alone                              |
| `TRIVIAL_CONSUMPTION_USD`         | **0.01**                   | anti-inflation: < $0.01 conversations capped at `low` tier                      |
| `MARGIN_TARGET` (scalar fallback) | **2.0**                    | used only when a conversation is unclassified                                   |
| default monthly allocation        | **2000 credits/mo**        | new-client starter plan; ≈ NZD $1,015/mo                                        |

These live in **three mirrored places** that must stay in sync — see [06-defaults-and-config.md](06-defaults-and-config.md).

### The two pools (drawdown waterfall — "Option B")

1. **Monthly allocation** — a recurring per-calendar-month grant (default 2000). **Use-it-or-lose-it**:
   `remaining = allocation − consumed`, derived live, never a stored counter. A new month starts fresh; a
   past month is frozen history.
2. **Top-up balance** — a persistent pool (an **event log**: top-ups + month-close settlements + manual
   adjustments). A conversation draws its month's allocation first; the **overflow** past allocation draws
   the top-up balance, which **can go negative** = the signal that a client needs invoicing. **No hard cutoff
   at zero** — the system is reporting/metering only, never blocking.

At each **NZ month rollover**, the closed month's overflow is locked in as a `settlement` event (so it's
immune to later config edits). See [01-architecture.md](01-architecture.md).

### Billing calendar

All clients bill on a single **NZ calendar (`Pacific/Auckland`, DST-aware)** — month bucketing and month-close
settlement both use it, so a conversation just after NZ-midnight on the 1st counts in the new month.

---

## Where it runs (component map)

| Component                      | Path                                                                                                                                                   | Role                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shared pricing lib**         | `lib/credit-pricing/`                                                                                                                                  | The single source of billing truth (cost recompute, floor, tiers, ledger row builders, NZ time). Imported by every consumer so live + backfill never drift. |
| **Live debit Lambda**          | `lambdas/python/credit-debit/`                                                                                                                         | Fired after each chat turn; reads the trace, classifies, writes the ledger rows.                                                                            |
| **Nightly Lambda**             | `lambdas/python/credit-nightly/`                                                                                                                       | Midnight-NZ job: anonymised receipt summaries **+** month-close settlement.                                                                                 |
| **In-client read API**         | `lambdas/node/admin-credits/`                                                                                                                          | Read-only `GET /credits/balance` + `GET /credits/ledger` for the in-app admin view.                                                                         |
| **Workspace agent hook**       | `services/numa-workspace-agent/numa_workspace_agent/credit_metering.py`                                                                                | Fire-and-forget invoke of credit-debit after a turn (passes `agent_id`).                                                                                    |
| **Portal authoring page**      | `numa-customer-success-portal/src/pages/NumaCredits.tsx` + `src/services/creditsService.ts`                                                            | Central authoring of pricing/allocation/top-ups; pushes to client accounts.                                                                                 |
| **In-client view**             | `numa-frontend/src/Components/Settings/CreditsDashboard/`                                                                                              | Settings → Credits tab (gated by `SHOW_CREDITS`, billing-admin only). Tabs: Dashboard / Work delivered / Top-ups.                                           |
| **In-chat credit indicator**   | `numa-frontend/src/Components/WorkspaceChat/ChatValue/`                                                                                                | Coin in the chat bar → hover shows the conversation's credit tier. All users, gated by `SHOW_CREDITS`. Reads `GET /credits/conversation`.                   |
| **Per-client ledger table**    | DynamoDB `numa-<client>-credit-ledger`                                                                                                                 | All credit state for a client (lives in the client's own account).                                                                                          |
| **Infra wiring**               | `infra/constructs/core-numa-infra-construct.ts`, `infra/constructs/app-agnostic-api-gateway-lambda-collection.ts`, `infra/stacks/numa-client-stack.ts` | Table, lambdas, scheduler, API routes, flags.                                                                                                               |
| **R&D backfill / experiments** | `dev-notes/tasks/credits-work/` (git-ignored)                                                                                                          | Tuning scripts, fleet pricing sweeps, the calculator HTML. Not part of the shipped system.                                                                  |

---

## Documentation index

| File                                                   | What's in it                                                                                                                                                                                                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [01-architecture.md](01-architecture.md)               | The pricing model in full, the cost-recovery floor, value tiers, the ledger table schema (every row type + GSIs), the drawdown waterfall, month-close settlement, the NZ billing calendar. **Start here.**                                                                  |
| [02-shared-lib.md](02-shared-lib.md)                   | `lib/credit-pricing` module-by-module reference: `credits.py`, `pricing.py`, `tiers.py`, `processing.py`, `ledger.py`, `timeutil.py`; the canonical constants; the tests.                                                                                                   |
| [03-live-metering.md](03-live-metering.md)             | How metering works in Numa: the workspace-agent hook, the credit-debit Lambda flow, the Nova classifier + ratchet, context mapping (chat/agent/scheduled), the nightly summariser + settlement, the EventBridge Scheduler, CloudWatch logs.                                 |
| [04-portal.md](04-portal.md)                           | The Customer Success Portal "Numa Credits" page, `creditsService`, the central-config **push model**, cross-account writes, the event-log top-up/adjustment/reset, the on-demand fleet rollup, the NZD overlay.                                                             |
| [05-in-client-view.md](05-in-client-view.md)           | The in-app Settings → Credits tab, the merged Dashboard / Work-delivered tabs, the `admin-credits` read API, `SHOW_CREDITS` gating, privacy guarantees.                                                                                                                     |
| [06-defaults-and-config.md](06-defaults-and-config.md) | Every default value and **exactly where it's defined** (the three mirrored places), the config flow end-to-end, the `SHOW_CREDITS` flag, the metering kill-switch, the `creditConfig` schema.                                                                               |
| [07-operations.md](07-operations.md)                   | Deploying, packaging, querying the ledger, the `tools/backfill-credit-ledger.py` backfill, manually invoking the nightly settlement, the R&D experiment workflow, the fleet-pricing decision history.                                                                       |
| [08-open-questions.md](08-open-questions.md)           | Open / deferred / settled: still-open allocation=0 onboarding policy, reference pricing bands, measured AgentCore-seconds, monthly reconciliation — **plus what shipped 2026-06-03** (classifier value-signal, billing-admin, agentId/Top-5-agents, `flooredMsgs` removal). |
| [09-billing-admin.md](09-billing-admin.md)             | **Billing admins** — who may see credit data in-client. The DynamoDB-roster model (why not a Cognito group), the `admin-credits` gate + grant/revoke API, the in-client lock screen + User Management toggle, the portal bootstrap tool, the rollout order.                 |

---

## Glossary

- **credit** — the billing unit. USD value = `credit_usd` (default $0.30).
- **value tier** (a.k.a. complexity tier) — `low`/`medium`/`high`/`very_high`, assigned by the Nova classifier.
  Customer-facing copy calls it "value"; internal fields call it `tier` / `dominantTier`.
- **floor** — the cost-recovery minimum charge (in credits) for a conversation.
- **defence margin / minimum enforced margin** — `MARGINS_BY_TIER[tier]`: the multiple over cost the floor enforces.
- **margin-vs-consumption** — the headline health metric: `charged_usd ÷ (token_cost × AGENTCORE_MULT)`. The
  "chat/consumption margin" — margin over tokens + AgentCore, **not** all-in infra (the all-in ≈ ×1.42 was only
  ever a secondary reference column in R&D reports).
- **context** — `chat` (plain chat → chat tier) vs `agent` (ad-hoc agent chat **or** scheduled run → agent tier).
- **source** — 3-way label on the ledger row: `chat` / `agent` / `scheduled` (for the dashboard's split).
- **ratchet** — the classifier only moves a conversation's tier **up** across turns, never down.
- **AgentCore uplift** — the `× 1.234` applied to token cost to approximate tokens + AgentCore compute in the floor.
- **settlement** — the nightly month-close event that locks a closed month's overflow into the top-up balance.
- **the floor binds** — phrase meaning `floor_credits > value_tier_credits`, so cost (not value) sets the charge.
- **billing-admin** — a per-user grant (a `CLIENT#/BILLING_ADMIN#<sub>` ledger row, **not** a Cognito group)
  deciding who may _see_ credit data in-client. Layered on top of `SHOW_CREDITS`. See [09-billing-admin.md](09-billing-admin.md).
- **value signal** — the distinct tools/integrations a run touched, fed to the classifier so terse-but-cross-system
  work tiers as high (vs the **effort** signal of token/turn volume).

---

## Conventions & cardinal rules

1. **One source of billing truth.** All charge math lives in `lib/credit-pricing`. The live Lambda, the nightly
   Lambda, and the backfill tool all import it — never re-implement the formula.
2. **USD everywhere; no FX in billing.** NZD is display-only.
3. **Idempotent writes.** Ledger rows use deterministic keys; re-processing a conversation overwrites, never
   double-counts. Re-running the backfill or settlement is safe.
4. **Privacy.** Per-message rows and the in-client view never contain raw chat content. Human-readable labels
   (title + deliverables) are AI-anonymised by the nightly job.
5. **Defaults are mirrored in three places** (lib Python, admin-credits Node, portal TS) — change all three together.
6. **Metering runs for every client; visibility is gated** by `SHOW_CREDITS` (default off).
