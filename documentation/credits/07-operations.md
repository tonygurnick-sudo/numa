# 07 — Operations: build, deploy, query, backfill, R&D

How to package, deploy, inspect, and tune the credit system.

---

## 1. What needs (re)building when you change X

| You changed…                                                   | Rebuild / repackage                                                               |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `lib/credit-pricing/*`                                         | **Both** Python lambdas (they bundle the lib): `credit-debit` + `credit-nightly`. |
| `lambdas/python/credit-debit`                                  | `credit-debit`                                                                    |
| `lambdas/python/credit-nightly`                                | `credit-nightly`                                                                  |
| `lambdas/node/admin-credits`                                   | `admin-credits`                                                                   |
| `services/numa-workspace-agent/*` (incl. `credit_metering.py`) | the workspace-agent **container** (slow)                                          |
| `numa-customer-success-portal/*`                               | portal `dist`                                                                     |
| `numa-frontend/*` (Settings, CreditsDashboard)                 | numa-frontend `dist`                                                              |
| infra constructs/stack                                         | redeploy the stack                                                                |

### Package commands

```bash
# Python lambdas (Poetry; bundles lib/credit-pricing + tzdata). Output: <dir>/lambda_function.zip
cd lambdas && bash package-python-lambda.sh python/credit-debit
cd lambdas && bash package-python-lambda.sh python/credit-nightly

# Node lambda (esbuild). Output: node/admin-credits/lambda_function.zip
cd lambdas && bash package-node-lambda.sh node/admin-credits

# Workspace-agent container (ARM64 Docker, requires Docker Desktop). Output:
#   infra/assets/artifacts/numa-workspace-agent/image.tar  (~1.6 GB)
cd services && ./package-service.sh numa-workspace-agent

# Frontends
cd numa-customer-success-portal && yarn build
cd numa-frontend && yarn build      # 8GB Node heap
```

> Verify the NZ timezone is bundled in a Python zip:
> `unzip -l lambdas/python/credit-debit/lambda_function.zip | grep -c 'Pacific/Auckland'` → should be ≥ 1
> (the `tzdata` package). If it's 0, `zoneinfo("Pacific/Auckland")` will fail at runtime.

### Deploy

- **Dev stacks** (e.g. `nd-labs`, `arcanum-demo-greg`): locally from `infra/`
  (`export TF_ENVIRONMENT=prod; export AWS_REGION=us-east-1; export CLIENT_OVERRIDE=<client>; yarn cdktf deploy --auto-approve numa-<client>`).
  The client stack pulls the credit table, the three lambdas, the nightly scheduler, the `SHOW_CREDITS` emit, and
  the workspace-agent image.
- **Customer stacks:** **never** deploy locally — go through the Customer Success Portal deploy UI.
- **Portal itself:** `yarn build` then deploy the `q-apps-deployer` stack.

> **Billing-admin rollout order** (see [09-billing-admin.md](09-billing-admin.md)): deploy the `admin-credits`
> gate **and** the numa-frontend lock screen **together** — the gate alone makes `/credits/balance`+`/ledger`
> return `403` to plain admins with no friendly screen. After deploying, **seed the first billing-admin** for the
> client via the portal's NumaCredits → Billing admins panel (the only bootstrap path); they then promote others
> in-client. Until one is seeded, every admin sees the lock screen.

---

## 2. Inspecting a client's ledger

The table is `numa-<client>-credit-ledger` in the **client's own account**. Use the right profile:
`q-demo` for dev stacks (incl. `nd-labs`, account 905418183804), `arcanum-prod-numa-demo` for `hq`, or the
per-client profile if one exists.

```bash
# Whole CLIENT# partition (CONFIG + MONTH# + TXN# rows)
AWS_PROFILE=q-demo aws dynamodb query --region us-east-1 \
  --table-name numa-nd-labs-credit-ledger \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"CLIENT#nd-labs"}}'

# A single conversation (META + MSG rows)
AWS_PROFILE=q-demo aws dynamodb query --region us-east-1 \
  --table-name numa-nd-labs-credit-ledger \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"CONV#<conversation_id>"}}'

# A month's conversations via GSI2
AWS_PROFILE=q-demo aws dynamodb query --region us-east-1 \
  --table-name numa-nd-labs-credit-ledger --index-name GSI2 \
  --key-condition-expression "GSI2PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"MONTH#2026-06"}}'

# Billing-admin roster (who may see credit data in-client)
AWS_PROFILE=q-demo aws dynamodb query --region us-east-1 \
  --table-name numa-nd-labs-credit-ledger \
  --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"CLIENT#nd-labs"},":sk":{"S":"BILLING_ADMIN#"}}'
```

**Reading it:** `CONFIG.monthlyAllocations` = the plan; `MONTH#<m>.creditsCharged` + `.allocationSnapshot` =
this month's usage vs the allocation it settles against; `TXN#…` = the balance event log
(`topup` +, `settlement` −, `adjustment` ±); balance = Σ TXN.credits.

---

## 3. Manually invoking the nightly (settlement / summaries)

To force a settlement or receipt pass without waiting for 00:30 NZ, invoke the client's `credit-nightly` Lambda
with an empty event. Resolve the exact function name first (it's a `NumaLambda` with suffix `_credit-nightly`):

```bash
AWS_PROFILE=q-demo aws lambda list-functions --region us-east-1 \
  --query "Functions[?contains(FunctionName, 'credit-nightly')].FunctionName" --output text

AWS_PROFILE=q-demo aws lambda invoke --region us-east-1 \
  --function-name <that-name> --payload '{}' /tmp/nightly.json && cat /tmp/nightly.json
```

It's idempotent — safe to re-run. The result reports `summarised`, `errors`, and the `settlement` summary
(month, consumed, allocation, overflow, action).

---

## 4. Backfilling a deployed client — `tools/backfill-credit-ledger.py`

Estimates/writes the credit ledger for a client over a recent window from existing chat traces — useful to seed
a client's ledger or sanity-check pricing on real data.

- **Safe by default — dry-run** (prints a per-conversation table + summary, writes nothing). Pass `--write` to
  write to the deployed table (it must already exist — it does on any deployed client).
- Reads the client's `CONFIG` row for effective pricing, classifies + generates the anonymised receipt, builds
  rows via the shared lib, and writes idempotently (cleans stale MSG rows).
- Trace reads + table writes use the **client** account (`AWS_PROFILE` / `--region`); Nova can be routed to a
  high-quota account with `--bedrock-profile` (e.g. `q-demo`) so a fleet backfill doesn't exhaust one account's
  quota.

```bash
# Dry-run (default), last 30 days
AWS_PROFILE=arcanum-prod-numa-demo python3 tools/backfill-credit-ledger.py --client hq

# Write 14 days, Nova routed to q-demo
AWS_PROFILE=av-media python3 tools/backfill-credit-ledger.py --client av-media --days 14 \
  --bedrock-profile q-demo --write
```

Flags: `--client`, `--days` (default 30), `--region`, `--write`, `--bedrock-profile`, `--no-receipt` (skip Nova
receipts). Run `--help` for the full set.

---

## 5. R&D workspace (not part of the shipped system)

`dev-notes/tasks/credits-work/` is git-ignored, personal R&D — the tuning that produced the current scheme. Key
artifacts:

- `live-backfill/replay_backfill.py` — the local replay backfill (replays the live ratchet turn-by-turn, real
  classifier cost, `--reprice` to retune instantly without re-running LLMs, high-parallelism fleet runs with Nova
  centralised via `--bedrock-profile q-demo`). Output under `out/<client>/`.
- `live-backfill/experiments/` — fleet pricing sweeps: `sweep.py` (the original 5-scheme sweep + loader that the
  others import), `thirty-cent-sweep.py`, `low-tier-bump.py`, `agent-tier-bump.py`, `context-fix.py`, plus their
  `.md` / `.csv` outputs. These are pure stats over the dump (no LLM/AWS).
- `*-calculator.html` — an interactive calculator/dashboard prototype (drag credit/margin dials, watch metrics
  recompute) that also prototypes the admin dashboard vision.
- `todo.md` — the running task log + the decided-vs-open items (mirrored in [08-open-questions.md](08-open-questions.md)).

### How the current scheme was chosen

A 48-client / 12,599-priceable-conversation fleet backfill drove the pricing decision (headline metric =
margin-vs-consumption, target band [1.1, 2.0]×). The settled scheme: **$0.30/credit** (≈ NZD $0.50), chat
**2/4/8/18**, agent **2/3/5/12**, defence margins **1.15/1.3/1.6/2.0**, **2000/mo** default allocation.
**(Superseded 2026-06-10:** after early "too expensive" customer feedback, defaults were lowered to chat
**1/2/5/8**, agent **0.5/1.5/3/5**, margins **1.1/1.25/1.4/1.6**, with the floor moving to half-credit
granularity so the fractional agent tiers genuinely bill — Asa approved. Mean fleet margin on chat drops from
~1.68× to ~1.44×. The analysis below describes the original scheme.) Findings
that shaped it: lowering `credit_usd` is the strongest lever to pull structurally-cheap chat-light clients toward
band; the chat 2/4 bump trades ~9pts of band-coverage for more value-led (efficiency-protected) pricing and
+revenue; the agent value tier is nearly a no-op at $0.30 (most scheduled runs are floor-bound), but raising it
future-proofs as Numa gets more efficient; nobody goes underwater under any candidate.

> Note on efficiency: with value-led pricing, getting Numa cheaper to run flows to **margin** on value-bound
> conversations. Floor-bound conversations preserve the margin **%** but their absolute credit count falls with
> cost — partially buffered by the monthly-allocation subscription. The structural fix (reference pricing bands)
> is in [08-open-questions.md](08-open-questions.md).
