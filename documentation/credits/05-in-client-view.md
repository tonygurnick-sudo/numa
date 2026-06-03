# 05 — In-client view: Settings → Credits

The read-only view a **client admin** sees inside their own Numa instance. **Two gates:** the `SHOW_CREDITS`
feature flag (default **off**) decides whether the Credits tab exists for the client at all; within that, only
**billing admins** see the actual data — a plain admin gets a lock screen. Metering runs for every client
regardless of either gate.

- **Frontend:** `numa-frontend/src/Components/Settings/CreditsDashboard/` (+ `Settings.tsx` tab wiring).
- **Read API:** `lambdas/node/admin-credits/index.ts` (`GET /credits/balance`, `GET /credits/ledger`,
  `GET`/`POST /credits/billing-admins`).
- **Billing-admin gate:** see [09-billing-admin.md](09-billing-admin.md) for the full model.
- **Privacy:** never shows chat/agent names or content — runs are identified by ID + time; titles/deliverables
  are AI-anonymised by the nightly job.

---

## Settings tab wiring

`numa-frontend/src/Pages/Settings.tsx`:

- `const creditsEnabled = getFlag('SHOW_CREDITS')` gates a **single** `credits` tab (Coin icon) that mounts
  `<CreditsDashboardPanel />`.
- History: there used to be two tabs (`credits-dashboard` → dashboard, `credits` → a separate read-only panel).
  They were **merged into one** (`CreditsDashboardPanel` now hosts both views as inner tabs), and the old
  `CreditsAdminPanel.tsx` was deleted.

> `getFlag` (`numa-frontend/src/utils/featureFlags.ts`) **defaults TRUE when a key is absent** — which is why the
> deploy must emit `SHOW_CREDITS` explicitly to default it false. See [06-defaults-and-config.md](06-defaults-and-config.md).

---

## `CreditsDashboardPanel` — the one Credits page

`CreditsDashboard/CreditsDashboardPanel.tsx`. **Billing-admin lock:** on mount it calls
`getBillingAdmins()` first — if the caller isn't a billing admin it renders a **lock screen** (_"Only billing
admins can see credit information"_ + who to ask) and **never fetches the data**. Otherwise it fetches (shared
by the inner tabs): `AdminCreditsService.getBalance` (now also returns the top-up **`txns`** event log) +
`getLedger` (the **lean** admin-safe rows) + `UsersService.list` (for sub→email) + `AgentsService.listAgents`
(for agentId→name) + a 6-month trend.

> ⚠️ **Privacy: no tokens/cost in the browser.** The dashboard fetches the **lean** `getLedger` (not
> `getLedgerFull`), so `totalTokens` / `consumptionCostUsd` / margin **never reach the client** — not merely
> hidden. The drill modal and the Work-delivered receipt also no longer show **Msgs** or **Tokens** columns.
> Reason: those expose the internals of the credit formula, which clients shouldn't see.

**Shared header** (always visible): `CreditsSummaryCards` — four tiles + a usage bar:

- **Credits remaining** = `balance.monthly.remaining` (allocation − consumed; use-it-or-lose-it)
- **Allocated** = `balance.monthly.allocation` (this month)
- **Used this month** = ledger total / `monthly.consumed`
- **Top-up balance** = `balance.balance` (the persistent pool; red if negative)

> ⚠️ Correctness note: these come from the **monthly** allocation, NOT the top-up balance. An earlier bug rendered
> `balance.balance` (the top-up pool) as "allocated" — fixed so `allocated`/`remaining` read `monthly.*` and the
> top-up balance is its own tile.

**Inner tabs:**

- **Dashboard** — `CreditsTrendChart` (allocated vs used, monthly), `CreditsSourceChart` (**Credits by type** —
  the deterministic Chat / Agent chat / Scheduled agent split, via `groupBySource`), `CreditsValueTierChart`
  (**Runs by value tier** — a bar chart counting runs per value tier Low→Very high, with an
  **All / Chats / Agent chats / Scheduled** source filter), and three `CreditsTopList`s,
  each clickable into `CreditsDrillModal`:
  - **Top-5 chats** — per-conversation, leading with the anonymised nightly **title** + **timestamp + email**
    (the conversation UUID rides a copy button to drill into a specific user/run).
  - **Top-5 agents** — **aggregated by `agentId`** (mirrors Top-5 staff), labelled by the agent's **name**
    resolved via `AgentsService.listAgents` (falls back to a short id for a deleted/invisible agent). Populates
    from runs metered after the `agentId`-on-META change ships.
  - **Top-5 staff** — aggregated by user, labelled by email.
- **Work delivered** — `CreditsWorkDelivered`: the anonymised receipt table
  (What was done · By · When · Duration · **Value** · Credits). Title + deliverables come from the nightly
  summariser; until then a row shows a "Summary coming overnight" placeholder alongside live tier/credits/duration.
- **Top-ups** — `CreditsTopupActivity`: the top-up-balance **event log** (`balance.txns`) — Date · Type
  (Top-up / Settlement (month) / Adjustment) · signed Credits · Note. The top-up balance tile = Σ of these rows.
  (Deliberately **no "By" column** — top-ups always come from the portal, which means nothing to a client; the
  portal keeps "By" for the Arcanum-staff audit trail.)

> **No category.** The Nova work-`category` was removed from the live path (2026-06-03): there is no
> "Consumption by category" pie or Top-5-categories list any more — the breakdown is by **source** (chat / agent /
> scheduled). "Complexity" is renamed **Value** everywhere (the client-facing name). See
> [02-shared-lib.md](02-shared-lib.md) for the future nightly-category plan.

Sub-components live in `CreditsDashboard/`: `CreditsSummaryCards`, `CreditsTrendChart`, `CreditsSourceChart`,
`CreditsValueTierChart`, `CreditsTopList`, `CreditsDrillModal`, `CreditsWorkDelivered`, `CreditsTopupActivity`,
`TierBadge`, `helpers.ts`.

Frontend service: `numa-frontend/src/Services/AdminCreditsService.ts` — `getBalance` → `/api/credits/balance`;
`getLedger` / `getLedgerFull` → `/api/credits/ledger`. (The `saveConfig`/`resetConfig`/`topUp` write methods
still exist in the service but the endpoint now returns **410** — writes moved to the portal.)

---

## The read API — `admin-credits` Lambda

`lambdas/node/admin-credits/index.ts`. Routes are mounted in
`infra/constructs/app-agnostic-api-gateway-lambda-collection.ts` (each `route:{verb,path}` → `node/admin-credits`,
switched by path in the handler). **The credit-data reads are billing-admin-gated** (`isBillingAdmin`, a
`BILLING_ADMIN#<callerSub>` lookup) → `403 not_billing_admin` for a plain admin; the billing-admins **roster**
read is `admin`-gated. See [09-billing-admin.md](09-billing-admin.md).

- **`GET /credits/balance`** _(billing-admin)_ — the live drawdown standing. One `CLIENT#` partition query → computes the same
  waterfall as the portal (`balance = Σ TXN − unsettled overflow`). Returns:
  ```jsonc
  {
    "balance": 500,            // availableBalance (live; can be negative)
    "settledBalance": 500,     // Σ TXN
    "liveOverflow": 0,
    "txns": [ … ],             // event log, newest first
    "config": { "defaults": …, "current": …, "isCustom": true, "updatedAt": … },
    "monthly": { "month": "2026-06", "monthIndex": 5,
                 "allocation": 2000, "consumed": 2, "remaining": 1998,
                 "allocations": [ …12… ] }
  }
  ```
- **`GET /credits/ledger?month=YYYY-MM[&full=1]`** _(billing-admin)_ — this month's conversations, newest first by
  `lastTs`, via GSI2. `month` defaults to the **current NZ month**. Default rows are the lean admin-safe receipt
  (`toAdminRow`, includes `agentId`); `full=1` returns `toAdminFullRow` (adds cost/tokens/margin). Neither contains
  chat content. **The in-client dashboard now uses the lean `getLedger`** (no `full=1`), so token/cost data never
  reaches the browser; `full=1`/`getLedgerFull` remain in the service for any internal tooling that needs the breakdown.
- **`GET /credits/conversation?id=<conversationId>`** _(ownership-checked — **not** billing-admin)_ — the credit
  tier of the **caller's own** conversation, for the in-chat indicator (below). The caller's JWT `sub` must match
  the conversation's `userSub`; returns only `{classified, tier, source, creditsCharged}` — no cost/token/content.
  Returns `{classified:false}` when the conversation hasn't been metered yet. Service: `getConversationValue`.
- **`GET /credits/billing-admins`** _(any admin)_ — `{isBillingAdmin, admins[]}`: caller's own status + roster
  (so a locked-out admin sees who to ask, and User Management renders badges).
- **`POST /credits/billing-admins`** _(billing-admin only)_ — `{action:'grant'|'revoke', sub, email?}`;
  server-enforced caller check + last-admin lockout (`409 last_billing_admin`). See [09-billing-admin.md](09-billing-admin.md).
- **`POST /credits/topup`** — **RETIRED**, returns **410 Gone**. Pricing config, allocations, and top-ups are now
  authored in the portal and pushed into this account.

Helpers: `currentMonth()` = current NZ month (`Intl` `Pacific/Auckland`); `effectiveConfig(stored)` overlays the
stored CONFIG on `DEFAULT_CONFIG` (the Node mirror of the lib defaults — keep in sync). `toAdminRow` is the
admin-safe projection (never returns cost/token fields or chat content for the read-only receipt).

---

## In-chat credit indicator (a separate surface)

Distinct from the Settings → Credits dashboard above: a small **coin** in the chat input bar, beside the
chat-health donut. Unlike the dashboard it is shown to **all users** (not just billing admins), gated only by
`SHOW_CREDITS`.

- **Frontend:** `numa-frontend/src/Components/WorkspaceChat/ChatValue/` — `ChatValueIndicator` (coin + hover
  popover), `ChatValuePopover`, `useChatValue` (hook). Wired into the chat page's `chatHealthSlot`
  (`NumaWorkspaceChatAgents.tsx`) behind `getFlag('SHOW_CREDITS')`.
- **On hover:** the conversation's current **credit tier** on a 4-step ladder (Low → Very high), framed as
  cost, never a judgement on the work — _"Higher-impact work moves up a tier and uses more credits."_ No exact
  credit amounts. Copy in `chat.json` → `creditTier.*` ("impact" wording chosen by the team over "value").
- **Data + lag:** `useChatValue` → `AdminCreditsService.getConversationValue` → `GET /credits/conversation`. The
  tier is the ratcheted `dominantTier` written by `credit-debit` **after** each turn (fire-and-forget), so it
  **lags a few seconds** and ratchets up over the chat. The hook refetches on conversation load + each time a turn
  settles (streaming true→false), with 2 short retries to absorb the metering lag; pre-first-meter it shows a
  neutral "still being rated" state (muted coin).

---

## What the client admin sees (and doesn't)

- **Sees:** remaining/allocated/used + top-up balance, a usage trend, credits by type (chat / agent / scheduled),
  top-5 chats/agents/staff (by **anonymised** title + time + email), and the "work delivered" receipt (anonymised
  title + deliverables, value tier, credits, when, duration, who).
- **Never sees:** raw chat content, real conversation/agent titles, or cost/token figures (those are internal
  telemetry on the META row, not exposed by the admin-safe API).
- **Who sees it:** only **billing admins** (gated server-side). A plain admin sees the tab + a lock screen, and
  can ask a billing admin to grant access in User Management. See [09-billing-admin.md](09-billing-admin.md).
- **Lag:** title/deliverables are filled by the nightly job (~1 day); live tier/credits/duration are immediate.
