# credit-debit

Live credit metering for the **Numa Credit System** (SPK-015) — the real-time counterpart to
`tools/credits-backfill.py`.

The workspace agent invokes this Lambda **asynchronously** (fire-and-forget, `InvocationType=Event`)
after each chat turn with `{conversation_id, user_sub}` — gated by the agent's
`CREDIT_METERING_ENABLED` flag. This Lambda then:

1. reads the conversation's `trace.jsonl` from the outputs bucket (synced by the agent),
2. recomputes per-turn cost, classifies the tier + titles it (Nova 2 Lite, once per conversation),
3. writes the conversation's ledger rows (`META` + `MSG#…`) to `numa-<client>-credit-ledger`.

Idempotent — re-processing overwrites by key. All billing logic is shared with the backfill via
`lib/credit-pricing` (`processing`/`pricing`/`credits`/`tiers`/`ledger`), so live and historical
metering can't drift.

**Env:** `CREDITS_TABLE_NAME`, `OUTPUTS_BUCKET_NAME`, `AWS_REGION`; optional `CREDIT_FX`,
`CREDIT_MARGIN`, `CREDIT_UNIT_NZD`, `CREDIT_CACHE_TTL`.

**IAM:** `s3:GetObject` on the outputs bucket, `dynamodb:GetItem`/`PutItem`/`BatchWriteItem` on the
ledger table, `bedrock:InvokeModel` on Nova Lite.

Package: `cd lambdas && bash package-python-lambda.sh python/credit-debit`.
