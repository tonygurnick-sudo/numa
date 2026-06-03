# 05 — In-client view: Settings → Credits

The read-only view a **client admin** sees inside their own Numa instance. It is gated by the `SHOW_CREDITS`
feature flag (default **off**) — metering runs for every client regardless, but the view is hidden until rollout.

- **Frontend:** `numa-frontend/src/Components/Settings/CreditsDashboard/` (+ `Settings.tsx` tab wiring).
- **Read API:** `lambdas/node/admin-credits/index.ts` (`GET /credits/balance`, `GET /credits/ledger`).
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

`CreditsDashboard/CreditsDashboardPanel.tsx`. Fetches once (shared by both inner tabs):
`AdminCreditsService.getBalance` + `getLedgerFull` + `UsersService.list` (for sub→email) + a 6-month trend.

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
  the deterministic Chat / Agent chat / Scheduled agent split, via `groupBySource`), and three `CreditsTopList`s:
  Top-5 chats / agents / staff, each clickable into `CreditsDrillModal`. Each chat/agent row leads with the
  anonymised nightly **title** + **timestamp + email** (the conversation UUID rides a copy button to drill into a
  specific user/run). (Top-5 agents populates once agent metering surfaces agent runs.)
- **Work delivered** — `CreditsWorkDelivered`: the anonymised receipt table
  (What was done · By · When · Duration · **Value** · Credits). Title + deliverables come from the nightly
  summariser; until then a row shows a "Summary coming overnight" placeholder alongside live tier/credits/duration.

> **No category.** The Nova work-`category` was removed from the live path (2026-06-03): there is no
> "Consumption by category" pie or Top-5-categories list any more — the breakdown is by **source** (chat / agent /
> scheduled). "Complexity" is renamed **Value** everywhere (the client-facing name). See
> [02-shared-lib.md](02-shared-lib.md) for the future nightly-category plan.

Sub-components live in `CreditsDashboard/`: `CreditsSummaryCards`, `CreditsTrendChart`, `CreditsSourceChart`,
`CreditsTopList`, `CreditsDrillModal`, `CreditsWorkDelivered`, `helpers.ts`.

Frontend service: `numa-frontend/src/Services/AdminCreditsService.ts` — `getBalance` → `/api/credits/balance`;
`getLedger` / `getLedgerFull` → `/api/credits/ledger`. (The `saveConfig`/`resetConfig`/`topUp` write methods
still exist in the service but the endpoint now returns **410** — writes moved to the portal.)

---

## The read API — `admin-credits` Lambda

`lambdas/node/admin-credits/index.ts`. **Admin-gated** (`isAdmin`: the caller's JWT `cognito:groups` must include
`admin`). Routes (mounted in `infra/constructs/app-agnostic-api-gateway-lambda-collection.ts` as
`admin-credits-balance` / `admin-credits-ledger` / `admin-credits-topup`, all from `node/admin-credits`):

- **`GET /credits/balance`** — the live drawdown standing. One `CLIENT#` partition query → computes the same
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
- **`GET /credits/ledger?month=YYYY-MM[&full=1]`** — this month's conversations, newest first by `lastTs`, via
  GSI2. `month` defaults to the **current NZ month**. Default rows are the lean admin-safe receipt
  (`toAdminRow`); `full=1` returns `toAdminFullRow` (adds cost/tokens/margin for the dashboard's drill-downs).
  Neither contains chat content. The frontend's `getLedger` uses the lean form; `getLedgerFull` passes `full=1`.
- **`POST /credits/topup`** — **RETIRED**, returns **410 Gone**. Pricing config, allocations, and top-ups are now
  authored in the portal and pushed into this account.

Helpers: `currentMonth()` = current NZ month (`Intl` `Pacific/Auckland`); `effectiveConfig(stored)` overlays the
stored CONFIG on `DEFAULT_CONFIG` (the Node mirror of the lib defaults — keep in sync). `toAdminRow` is the
admin-safe projection (never returns cost/token fields or chat content for the read-only receipt).

---

## What the client admin sees (and doesn't)

- **Sees:** remaining/allocated/used + top-up balance, a usage trend, credits by type (chat / agent / scheduled),
  top-5 chats/agents/staff (by **anonymised** title + time + email), and the "work delivered" receipt (anonymised
  title + deliverables, value tier, credits, when, duration, who).
- **Never sees:** raw chat content, real conversation/agent titles, or cost/token figures (those are internal
  telemetry on the META row, not exposed by the admin-safe API).
- **Lag:** title/deliverables are filled by the nightly job (~1 day); live tier/credits/duration are immediate.
