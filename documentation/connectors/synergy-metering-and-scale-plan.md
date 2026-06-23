# Synergy — Metering Component + Remaining Scale Work (plan)

> Authored 2026-06-21. Covers the remaining structured-backbone work, all
> **credit-metered** like the crawl. Companion to `synergy-capability-gap-analysis.md`.
> Grounded in `lib/credit-pricing/`, `lambdas/python/synergy-credit-debit/`,
> `documentation/credits/`, and the synergy crawler/construct.

## 0. Portal reflection — VERIFIED (no code needed)

Requirement: synergy spend must show in the Customer Success Portal, rolled into
the tenant total. **Verified already correct by construction** — no change needed:

- `synergy-credit-debit` writes a `source="synergy"` ledger META row **and**
  recomputes the `MONTH#` aggregate, which sums **every** source.
- `admin-credits` (the portal's data source) reads the tenant's consumed/balance
  from that `MONTH#` aggregate's `creditsCharged` with **no source filtering**
  (`admin-credits/index.ts` ~L281-292). So synergy crawl spend is in the total.
- Every synergy debit (crawl today; portfolio + nightly when built) uses the same
  `source="synergy"` → `MONTH#` path, so they roll into the portal total
  **automatically** — no portal work per feature.
  A per-source _breakdown_ in the portal was explicitly NOT wanted (total only).

## 1. The metering component (foundation) — BUILT

One **synergy-ops metering substrate**, generalised from the live crawl debit (not
three bespoke meters). The existing pattern is the template: read CONFIG rates →
USD estimate → `floor_credits` at the `low` (cost-recovery) margin → write a
`source="synergy"` ledger META row under the `system-synergy-crawl` sentinel sub →
recompute the `MONTH` aggregate; idempotent on a deterministic conv id; gated by
`CREDIT_METERING_ENABLED`.

**`lib/credit-pricing/synergy_pricing.py` extension (done, 14/14 tests):**

- `portfolio_scan_cost_usd(scanned_count, rates)` — fixed per-query overhead + the
  read-capacity of rows scanned, uplifted.
- `nightly_aggregate_cost_usd(scanned_count, rates)` — fixed per-run + full-scan RCU.
- `SynergyQueryRates` / `SynergyNightlyRates` + `query_rates_from_config` /
  `nightly_rates_from_config` (CONFIG → env → anchors, like `synergyRates`).
- **Embedding tiering needs no new meter** — it changes how many chars are embedded,
  which the existing `synergy_ingest_cost_usd` already reflects (fewer chars ⇒ lower charge).

**Debits fire from two Lambdas (no proliferation):**

- **Reuse `synergy-credit-debit`** for run-scoped costs — crawl (today), the
  tier-aware embed breakdown, and the **nightly aggregate** settlement (new
  `source_detail="aggregates"`, conv id `synergy-aggregates-nightly-{YYYY-MM-DD}`).
- **One tiny new `synergy-portfolio-debit`** (~50 lines) for the per-interaction
  portfolio meter, fire-and-forget from `oauth-workspace-tools` after
  `portfolio_query`, conv id `synergy-portfolio-{YYYYMM}-{query_hash}`.

All sources roll into the tenant `MONTH` aggregate, filtered out of per-user
dashboards (same as crawl). Master gate: `synergyKbCrawl` + `CREDIT_METERING_ENABLED`.

## 2. Feature plan (each with its metering)

**A. Nightly aggregates (build first).** A `synergy-nightly-aggregates` Lambda scans
JOB# rows → writes `AGG#staleness` + `AGG#facets-{attr}` rows into the **existing**
state table; `synergy-portfolio` reads these first, falls back to SCAN if missing.
_Infra:_ one EventBridge schedule (~04:00 Auckland), one new compute Lambda
(**CI-matrix add**), reuses coordinator IAM/table. _Metering:_ reused
`synergy-credit-debit`, fixed anchor per run, deterministic daily conv id. _Medium._

**B. Portfolio GSI / facet-rows.** Replace the bounded 30k SCAN with deterministic
facet reads: write sparse `FACET#{attr}#{value}#{job_id}` rows at crawl time + a
`created_date` GSI for date bounds. _Infra:_ GSI(s) + facet-row writes in the
coordinator's enumeration + delete-sweep — **no new Lambda**. _Metering:_ facet
writes are <1% of embed cost, absorbed by `overhead_mult` — **no new meter**;
queries get cheaper. _Medium._

**C. Embedding tiering (cost lever).** `CONFIG#crawl.embedStrategy = full | rollup |
tiered`; the worker decides per-file whether to embed full text or rollup-only,
stamps `embed_tier`/`vector_archived` on FILE# rows; nightly ageout demotes old
vectors. Live job-scoped `/files/search` is the fallback for non-embedded docs.
_Infra:_ CONFIG + FILE#/JOB# fields, ageout folded into the scheduled run — **no new
Lambda, no GSI**. _Metering:_ worker accumulates full-text vs rollup chars; the
reused debit computes the tier-aware cost + logs the breakdown. _Large_ (worker
decision + ageout is the bulk).

## 3. Recommended build sequence

1. **Metering foundation** — `synergy_pricing.py` cost fns + rate config (**done**);
   then generalise `synergy-credit-debit` with a `source_detail` so the new callers reuse it.
2. **Nightly aggregates Lambda + meter** — staleness first, then facet counts; debit on completion.
3. **Portfolio read path + facet-rows/GSI** — `synergy-portfolio` reads AGG#/FACET# with SCAN fallback.
4. **Embedding tiering** — schema + worker logic + tier-aware debit + ageout (default `full` = no change).

Each is flag-gated (`synergyKbCrawl`) and verifiable.

## 4. Decisions for the lead

- **Rates (provisional anchors — confirm with Asa before they harden):** portfolio
  `rcu_usd_per_million` **0.25** (internal, below the ~1.25 AWS list) + `fixed_overhead`
  **0.002 USD**/query; nightly **0.01 USD**/run (+ scan RCU); embed-tier price = baseline
  ingest cost for `full`, ~**0.5×** for `rollup`. All at the `low` cost-recovery margin (no value tier).
- **GSI vs facet-row + key design:** recommend **facet-rows** (`FACET#{attr}#{value}#{job_id}`,
  pk-only, sparse projection of `job_id|allowed_users|created_date|is_template`) over a wide
  attr-value GSI — deterministic counts, no truncation, ACL at write time. Confirm the 15-attr
  cap + pk-only layout.
- **Embed-tier default:** ship `embedStrategy="full"` (no behaviour change until an admin opts in);
  `tiered` predicate = `active_status_only` to start; defer `first_deep_dive` (needs access tracking).
- **Client-config schema (the gotcha):** the new keys live in the **CONFIG ledger row**, NOT the
  strict client-config schemas → no infra/CSP change needed. **But** if any is promoted to a
  deploy-time client-config flag (e.g. surfacing `synergyEmbedStrategy` in the admin card), it
  MUST be added to **both** the infra schema and the CSP schema (or the deploy dies on
  `unrecognized_keys`) + a capabilities-metadata entry. Recommend **ledger-only** to start.

Key files: `lib/credit-pricing/credit_pricing/synergy_pricing.py`,
`lambdas/python/synergy-credit-debit/lambda_function.py`,
`infra/constructs/synergy-kb-crawler-construct.ts`.
