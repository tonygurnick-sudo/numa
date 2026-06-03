# 04 — Customer Success Portal: the "Numa Credits" authoring page

The portal is the **central authoring surface** — where Arcanum staff set per-client pricing, allocations,
top-ups, and visibility. It is the **source of truth**: config is written centrally and **pushed** into each
client account. Clients never author their own config; their in-app view is read-only.

- **Page:** `numa-customer-success-portal/src/pages/NumaCredits.tsx`
- **Service:** `numa-customer-success-portal/src/services/creditsService.ts`
- **Route + nav:** `/numa-credits` in `src/App.tsx`; nav item (Coin icon) in `src/components/NavigationBar.tsx`.

> The portal is a React SPA that talks to AWS directly from the browser using Cognito Identity-Pool credentials,
> and assumes `ArcanumAIAccess` into client accounts for cross-account reads/writes (the same pattern the Usage/
> Quota report tools use). Plain English copy — the portal does **not** use i18n.

---

## The push model (config flow)

```
Portal (NumaCredits)
   │  saveConfig()
   ├─(1)─> numa-client-config  (deployer account)   config.creditConfig   ← central source of truth
   └─(2)─> client account: numa-<client>-credit-ledger  CLIENT#/CONFIG row ← pushed copy
                                                              │
                                                              ▼
                                       credit-debit Lambda reads its LOCAL CONFIG row at meter time
                                       (no meter-time cross-account call, no latency)
```

- **(1) Central store:** `clientService.updateClientConfig(client, { creditConfig })` writes
  `config.creditConfig` in the `numa-client-config` DynamoDB table (deployer account) via the shared
  `@arcanumai/client-config` library. This is what the portal reads back, and what a deploy could seed from.
- **(2) Push:** a browser-side cross-account write — `awsCredentialsService.getClientCredentials(accountId, region)`
  assumes `ArcanumAIAccess`, then `PutCommand` the `CLIENT#/CONFIG` row on `numa-<client>-credit-ledger`. This is
  the row the in-client `credit-debit` Lambda reads. **No deployer broker Lambda required.**
- Every change is also logged to the portal **activity table** via `activityService.logActivity` (audit trail
  for config edits, top-ups, adjustments).

A client with **no** `creditConfig` saved uses the code defaults everywhere (the portal shows `DEFAULT_CREDIT_CONFIG`,
and `credit-debit` falls back to lib defaults incl. the 2000 allocation). The portal value always wins once saved;
a deploy never clobbers a portal-set value (there's no DB seed — see [06-defaults-and-config.md](06-defaults-and-config.md)).

---

## `creditsService.ts` — the API

| Method                                                    | What it does                                                                                                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saveConfig(client, accountId, region, config)`           | Writes `creditConfig` centrally **and** pushes the `CONFIG` row to the client ledger. Logs activity. This is the "Save & push" action.                                                                                     |
| `topUp(client, accountId, region, credits)`               | Appends a `topup` TXN event (`TXN#<iso>#<uuid>`, `credits` +) to the client ledger. No scalar mutation — balance is the TXN sum. Logs activity.                                                                            |
| `adjustBalance(client, accountId, region, credits, note)` | Appends a signed `adjustment` TXN (used by Reset-to-defaults to zero the balance, and for manual corrections). Auditable, never a deletion.                                                                                |
| `setVisibility(client, show)`                             | Writes `showCredits` to the central `numa-client-config` only (the in-app view gate). **Applies on the next deploy** (it's emitted to the client's `config.json` at deploy time); metering runs regardless. Logs activity. |
| `getStanding(client, accountId, region)`                  | **Read-only** cross-account: one `CLIENT#` partition query → CONFIG + MONTH# + TXN# rows → computes the drawdown waterfall. Returns `CreditStanding`.                                                                      |

`DEFAULT_CREDIT_CONFIG` (exported) — the TS mirror of the lib defaults; **keep in sync** with
`credit_pricing/credits.py` + `tiers.py`.

### `CreditStanding` (what `getStanding` returns)

```ts
interface CreditStanding {
  availableBalance: number; // settled TXN − unsettled overflow (live; can be negative)
  settledBalance: number; // Σ TXN.credits (top-ups + settlements + adjustments)
  liveOverflow: number; // overflow of months NOT yet settled (open + closed-unsettled)
  months: Record<string, { used: number; allocation: number; settled: boolean }>; // keyed 'YYYY-MM'
  txns: CreditTxn[]; // event log, newest first
}
```

The waterfall computation mirrors the lib exactly (see [01-architecture.md §6](01-architecture.md)): `used` =
`MONTH.creditsCharged` (or `creditRevenueUsd / creditUsd` for older rows); `allocation` = `MONTH.allocationSnapshot`
(or current CONFIG allocation for the open month); `liveOverflow` sums `max(0, used − allocation)` over months
without a `settlement` TXN; `availableBalance = Σ TXN − liveOverflow`.

---

## The page — layout

Dashboard-style: a **left rail** drives the **main pane**.

### Left rail

- A search box; an **Overview** entry pinned at top; then **Dev / Demo** and **Clients** groups (via
  `groupClientsByType` from `clientService`, splitting on `config.devInstance`).
- Each client row shows a **green dot** if `showCredits` is on (visible to client) and a **`custom`** badge if it
  has a saved `creditConfig`.

### Overview (landing — no client selected)

- **Global defaults index** — a read-only "how every client is priced unless customised" panel: `$0.30 USD`
  (≈ NZD $0.51/credit), default allocation `2,000/mo` (≈ NZD value), value tiers chat + agent, min-enforced
  margins, USD/NZ-calendar note, `1.234×` AgentCore uplift. (Reads `DEFAULT_CREDIT_CONFIG`.)
- **Fleet rollup** — behind a **"Load fleet overview"** button (on-demand, NOT on page load): a
  concurrency-limited (8-at-a-time) sweep calling `getStanding` for every client, with a progress bar. Aggregates:
  **owed** (Σ negative balances — accounts-payable view), **prepaid** (Σ positive), **used this month**,
  **visible/total** (`showCredits`), **custom-config count**, and `withLedger`/`failed` counts. NZD shown at the
  default credit price (indicative).

### Per-client detail (a client selected)

- **Header bar:** name + `Custom config`/`Defaults` badge + `Visible`/`Hidden` badge; a **"Show in client app"**
  switch (`setVisibility`, with "applies on next deploy") and a **"Reset to defaults"** button.
- **Hero standing tiles:** Allocated (this NZ month) · Used · Remaining · **Top-up balance** (red if negative)
  - a usage progress bar + an "overdrawn by N" note when negative.
- **NZD overlay:** an editable FX rate (`fxNzd`, default 1.69) driving "≈ NZD" annotations on the allocation
  total, the balance, and the top-up confirm. Display-only — billing stays USD.
- **Monthly credit allocation:** a "set every month to…" broadcast + a 12-month grid (Jan–Dec), each with its
  live "used N" for the current year.
- **Top up balance:** current balance + an "add credits" input with a **NZD confirm dialog**
  (`Allocate N ≈ NZD $X — sure?`), applied immediately (separate from the config Save).
- **Advanced pricing** (collapsed by default): `1 credit (USD)`, `AgentCore multiplier`, `Fallback margin`,
  `Trivial-cost cap`, the per-tier **Minimum enforced margin**, and value tiers for chat + agent run.
- **Dirty-aware sticky save bar:** appears whenever pricing/allocation differs from the saved baseline →
  **Discard** / **Save & push to client** (one button saves the whole config; top-ups are separate/immediate).

### Reset to defaults

Confirm → `saveConfig(withDefaults())` (default pricing + 2000/mo allocation) → `adjustBalance(-settledBalance, "reset to defaults")` to zero the top-up balance via an auditable adjustment.

---

## Types & central schema

- Portal types: `numa-customer-success-portal/src/types/index.ts` — `clientConfigSchema` carries
  `showCredits?` and `creditConfig?`; `CreditConfig = NonNullable<ClientConfig['creditConfig']>`.
- Central store: `config.creditConfig` under the client in `numa-client-config` (deployer account), holding
  `creditUsd, margin, trivialConsumptionUsd, valueTiers, marginsByTier, agentcoreMult, monthlyAllocations`.
- The infra `ClientConfig` zod schema (`infra/stacks/numa-client-stack.ts`) also defines `showCredits` +
  `creditConfig` so the deploy can read/emit them.

---

## Deploying the portal

The portal ships with the `q-apps-deployer` stack (build first): `yarn build` in
`numa-customer-success-portal/`, then deploy the deployer stack. Locally, `yarn dev` (port 5173) reads source
directly. Gotcha learned the hard way: if you change a default in source but only the built `dist/` is served
(deployed / `yarn preview`), it'll show the **old** baked value until you rebuild — always `yarn build` after a
defaults change.
