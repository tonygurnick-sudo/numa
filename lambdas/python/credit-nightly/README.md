# credit-nightly

Nightly anonymised-receipt summariser for the **Numa Credit System** (SPK-015).

Runs once a day (EventBridge cron, midnight UTC). For each conversation whose ledger `META` row was
updated in the recent window (default last 36h) and not yet summarised — or summarised before its
latest activity — it:

1. Reads the conversation trace from S3
   (`numa-chat/workspace/<user_sub>/conversations/<conv_id>/_system/trace.jsonl`),
2. Runs **Amazon Nova 2 Lite** via the shared `credit_pricing.tiers.generate_receipt()` to produce an
   **admin-safe** anonymised `title` + `deliverables` (no names / companies / figures / chat content),
3. Writes `title`, `deliverables`, `summarisedAt` onto the `CONV#<id> / META` row.

This is what powers the admin view's "what was done" — live metering writes credits/tier/time
immediately; this fills in the human-readable, anonymised labels overnight. Until it runs, the UI
shows a "anonymised summary coming overnight" placeholder.

**Idempotent** — re-running skips rows already summarised after their `lastTs`. **Best-effort** —
one failing conversation never stops the run. **Privacy** — only the anonymised title + deliverables
are stored; raw chat content is never persisted.

## Env

| Var                             | Required | Default      | Purpose                                                                   |
| ------------------------------- | -------- | ------------ | ------------------------------------------------------------------------- |
| `CREDITS_TABLE_NAME`            | ✓        | —            | `numa-<client>-credit-ledger`                                             |
| `OUTPUTS_BUCKET_NAME`           | ✓        | —            | `numa-<client>-outputs` (traces)                                          |
| `CLIENT_NAME`                   | —        | —            | logging                                                                   |
| `AWS_REGION`                    | —        | `us-east-1`  |                                                                           |
| `CREDIT_NIGHTLY_LOOKBACK_HOURS` | —        | `36`         | how far back to consider "updated today"                                  |
| `CREDIT_NIGHTLY_MAX`            | —        | `0` (no cap) | optional cap on conversations per run                                     |
| `CREDIT_CACHE_TTL`              | —        | `1h`         | cache tier for trace cost recompute (unused for summary, kept for parity) |

Scanned via the ledger **GSI2** (`MONTH#<YYYY-MM>`), current + previous month.
