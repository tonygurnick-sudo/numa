# credit-pricing

Canonical, dependency-light Python core for the **Numa Credit System** cost engine:

- `pricing.py` — Anthropic-on-Bedrock token **cost recompute** (cache-tier aware). The
  authoritative pricing table for credits.
- `credits.py` — credit math: the **cost-recovery floor** (`floor_credits`), NZD↔credit
  conversion, and realised-margin.

Both the **backfill tool** (`tools/`) and the **live debit Lambda** import this lib, so the
cost math has one home.

## Pricing single-source-of-truth (drift guard)

The workspace agent keeps its **own** copy of the pricing table in
`services/numa-workspace-agent/numa_workspace_agent/sdk_config.py:ANTHROPIC_MODEL_PRICING`.
It can't import this lib because its Docker build context is the service directory (it can't
`COPY lib/`). So instead of sharing by import, the two tables are kept identical by a test:

`tests/test_pricing_drift.py` AST-reads the agent's table and asserts it equals this lib's.
**If you change a model rate or add a model in one place, the test fails until you mirror it in
the other.** This is the guard against the silent-under-billing bug a stale table causes.

> Note: `lib/bedrock` has a separate, non-cache-aware pricing table for the `BedrockClaude3Model`
> wrapper. That is **not** authoritative for credits — credit cost needs the cache-tier rates here.

## Run the drift test

```
python3 lib/credit-pricing/tests/test_pricing_drift.py      # standalone, no pytest needed
# or
cd lib/credit-pricing && poetry install && poetry run pytest
```
