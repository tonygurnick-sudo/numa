# 03 — Live metering: how credits are charged inside Numa

End-to-end runtime path: a chat turn finishes → the workspace agent fires the debit Lambda → the ledger updates
→ the nightly job adds anonymised labels and settles months.

```
workspace-agent (after a turn)
        │  fire-and-forget Lambda invoke {conversation_id, user_sub, agent_id?}
        ▼
credit-debit Lambda  ──reads──>  S3 trace.jsonl
        │  classify (Nova) + recompute cost (lib) + build rows
        ▼
DynamoDB  numa-<client>-credit-ledger   (META + MSG + MONTH aggregate)
        ▲
credit-nightly Lambda (00:30 NZ)  ── anonymised title/deliverables + month-close settlement
```

---

## 1. The trigger — workspace agent hook

`services/numa-workspace-agent/numa_workspace_agent/credit_metering.py` →
`maybe_emit_credit_event(user_sub, conversation_id, agent_id=None)`:

- **Gated** by env `CREDIT_METERING_ENABLED` (default OFF; set per the infra construct). No-op unless on.
- After the turn's trace is synced to S3, it **async-invokes** the credit-debit Lambda
  (`InvocationType="Event"` → returns 202 immediately, adds no latency) named by env `CREDIT_DEBIT_LAMBDA_NAME`,
  with payload `{conversation_id, user_sub, agent_id?}`.
- `agent_id` is included only when the conversation is running an agent — this is what tells credit-debit to
  price on the **agent** tier (ad-hoc agent chats as well as scheduled runs).
- **Best-effort:** any failure is logged (`CREDIT_METER_EMIT_FAIL`) and swallowed — metering must never affect
  a chat request.

Called at **two sites** in `main.py` (the streaming handler `_handle_chat` and the sync handler `_handle_sync`),
both passing `agent_id` (= `body.get("agentId")`, present for agent conversations, `None` for plain chat).

---

## 2. The `credit-debit` Lambda

`lambdas/python/credit-debit/lambda_function.py`. Invoked async per turn with `{conversation_id, user_sub, agent_id?}`.

**Env:** `CREDITS_TABLE_NAME`, `OUTPUTS_BUCKET_NAME`, `AWS_REGION`, `CLIENT_NAME`. Optional tuning:
`CREDIT_MARGIN`, `CREDIT_UNIT_USD`, `CREDIT_AGENTCORE_MULT`, `CREDIT_CACHE_TTL` (default these fall back to the
lib defaults). (Note: `CREDIT_METERING_ENABLED` is on the **workspace agent**, not here.)

**Flow:**

1. **Read the trace** from S3:
   `s3://numa-<client>-outputs/numa-chat/workspace/<user_sub>/conversations/<conversation_id>/_system/trace.jsonl`.
   Missing/late trace ⇒ skip (`CREDIT_DEBIT_NO_TRACE`).
2. `process_trace_events` → per-turn costs (recomputed via `pricing.py`), user texts, first/last timestamps.
3. **Read the CONFIG row** (`CLIENT#<client>/CONFIG`) for the effective per-client pricing: `creditUsd`,
   `margin`, `trivialConsumptionUsd`, `valueTiers`, `marginsByTier`, `agentcoreMult`. Missing keys → env / lib
   defaults. **`monthlyAllocations`** falls back to `[DEFAULT_MONTHLY_ALLOCATION]×12` (2000) when not configured,
   so a fresh client meters against a real allowance.
4. **Context / source** (see [01-architecture.md §5](01-architecture.md)):
   `is_scheduled = conversation_id.startswith("schedule-")`; `is_agent = is_scheduled or bool(agent_id)`;
   `context = "agent" if is_agent else "chat"`; `source = "scheduled" if is_scheduled else ("agent" if agent_id else "chat")`.
   - **Scheduled-run agentId recovery:** a scheduled run is detected by the `schedule-` id prefix, but the
     metering event can arrive **without** an `agent_id` (the schedule runner's emit may omit it). When
     `is_scheduled and not agent_id`, credit-debit recovers it from the conversation's **chat-history** rows
     (`_scheduled_agent_id` → Query `user_id` + `begins_with(sk, conversation_id)` → read `agentId`) and stamps it
     on the META. Without this the run lands in the `scheduled` consumption slice but is **absent from Top-5-agents**
     (which groups by `agentId`). Best-effort (logs `CREDIT_DEBIT_AGENT_LOOKUP` on failure, never blocks metering);
     needs `CHAT_HISTORY_TABLE_NAME` + a read-only chat-history Query grant (§4).
5. **Ratcheting classification:** reuse the prior `dominantTier` as a floor; if it isn't already `very_high`,
   re-classify a **bounded window** (opening intent + recent turns) with Nova and keep `max_tier(prior, new)`.
   Two trusted signals go in alongside the window: an **effort** summary (`_actions_summary` — turn/token volume)
   and a **value** signal (`processing.tools_value_signal(processing.extract_tools(events))` — the distinct
   tools/integrations the run touched). The value signal is the fix for terse-but-cross-system work: a one-line
   ask that pulled from many integrations now tiers as high, not medium. Once `very_high` is reached, Nova is
   skipped (bounds Nova calls). The trivial-cost cap still pins near-zero conversations to `low`. **No live
   titling** — the nightly job owns anonymised labels. (Category is **not** produced live; tier only.)
6. `build_conversation_rows` → META + MSG rows; write with a batch writer, deleting stale MSG rows from a
   shortened/edited conversation (idempotent).
7. **Maintain the monthly aggregate** (`CLIENT#<client>/MONTH#<nz-month>`): recompute from GSI2 (sum
   `creditsCharged` + `consumptionCostUsd` across the month, overriding the just-written conversation with
   in-hand values since GSI2 is eventually consistent), and **stamp** `creditsCharged` + `allocationSnapshot`
   (current config's allocation for the NZ month index). Best-effort — never breaks metering
   (`CREDIT_DEBIT_MONTHAGG` on failure).
8. Log `CREDIT_DEBIT_OK` (credits_charged, msgCount, tier).

**Month bucketing:** `month = billing_month_of(last_ts)` — NZ calendar (was `last_ts[:7]` = UTC).

> The monthly-aggregate recompute is O(convs this month) per turn. Fine at current volume; the code comment
> flags moving it to a scheduled month-close job if a tenant's monthly conversation count grows large.

---

## 3. The `credit-nightly` Lambda

`lambdas/python/credit-nightly/lambda_function.py`. Fires **00:30 NZ** daily. Two independent jobs (both
best-effort; one failing never stops the other):

**(a) Anonymised receipt summariser.** Scans GSI2 for the current + previous NZ month, selects META rows whose
`lastTs` is within the last ~36h (`CREDIT_NIGHTLY_LOOKBACK_HOURS`) and which lack a fresh `summarisedAt`. For
each: read the trace from S3 → `generate_receipt` (Nova 2 Lite) → `UpdateItem` the META row with `title`,
`deliverables`, `summarisedAt`. No raw chat content stored. Idempotent (skips rows already summarised after
their `lastTs`). `CREDIT_NIGHTLY_MAX` caps how many per run (0 = no cap).

**(b) Month-close settlement** (`_settle_prev_month`). Settles the **previous NZ billing month**:
read `MONTH#<prev>`, `overflow = max(0, creditsCharged − allocationSnapshot)`; if > 0 write a `settlement` TXN
(`credits = −overflow`, deterministic SK ⇒ idempotent); else delete any stale settlement for that month. A
client with no `allocationSnapshot` has allocation 0, so all usage overflows (balance goes negative).
`CREDIT_NIGHTLY_SETTLE` logs the result.

**Env:** `CREDITS_TABLE_NAME`, `OUTPUTS_BUCKET_NAME`, `CLIENT_NAME`, `AWS_REGION`; optional
`CREDIT_NIGHTLY_LOOKBACK_HOURS` (36), `CREDIT_NIGHTLY_MAX` (0), `CREDIT_CACHE_TTL`.

---

## 4. Infra wiring

`infra/constructs/core-numa-infra-construct.ts`:

- **Table** `numa-<client>-credit-ledger` (`creditLedgerTable`) with GSI1 + GSI2.
- **`credit-debit`** `NumaLambda` (env: `CLIENT_NAME`, `CREDITS_TABLE_NAME`, `OUTPUTS_BUCKET_NAME`,
  `CHAT_HISTORY_TABLE_NAME`); IAM: DynamoDB read/write on the ledger table + index, **read-only `dynamodb:Query`
  on the chat-history table** (the scheduled-run agentId recovery, §1 step 4), S3 GetObject on the outputs bucket,
  `bedrock:InvokeModel` (Nova).
- **`credit-nightly`** `NumaLambda` (timeout 600); IAM: DynamoDB Query/UpdateItem/GetItem/PutItem/DeleteItem,
  S3 GetObject, `bedrock:InvokeModel`.
- **Scheduler:** an `IamRole` (assumed by `scheduler.amazonaws.com`) + `SchedulerSchedule` named
  `<client>-credit-nightly`, `scheduleExpression: cron(30 0 * * ? *)`,
  `scheduleExpressionTimezone: Pacific/Auckland`, `flexibleTimeWindow: OFF`, targeting the nightly Lambda. (Uses
  **EventBridge Scheduler** specifically because it supports a timezone — `CloudwatchEventRule` is UTC-only.)
- **Dedicated log group** `/numa/<client>-credits` (`creditLogGroup`): both `credit-debit` and
  `credit-nightly` log here (no longer the shared `<client>-core`), so all credit logs are in one
  place. Created directly via `CloudwatchLogGroup` (not `NumaLogGroup`, whose hardcoded inner id
  would collide under this scope); covered by the core group's `/numa/*` resource policy.

`infra/constructs/workspace-chat-agent-construct.ts`: props `creditDebitLambdaName`, `creditDebitLambdaArn`,
`creditMeteringEnabled`; sets env `CREDIT_METERING_ENABLED` on the agent; grants `lambda:InvokeFunction` on the
debit Lambda ARN.

`infra/stacks/numa-client-stack.ts`: `creditMeteringEnabled: true` is **hardcoded ON for all clients** (~L531) —
metering accrues for everyone; visibility is gated separately by `SHOW_CREDITS`. See
[06-defaults-and-config.md](06-defaults-and-config.md).

---

## 5. CloudWatch logs

Structured logs (`structlog`) with a `_name` field per event. Every credit line is also bound with
`domain="credits"`, so a single filter spans all of them regardless of source — `credit-debit` +
`credit-nightly` (in `/numa/<client>-credits`) **and** the workspace-agent meter emit (which lands in
the agent's own container group `/numa/<client>/workspace-chat-agent`). Filter by `_name` for a
specific event, or `domain = "credits"` for everything.

| `_name`                                                               | Where           | Meaning                                                                                                                            |
| --------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `CREDIT_METER_EMIT` / `CREDIT_METER_EMIT_FAIL`                        | workspace agent | usage event emitted / emit failed                                                                                                  |
| `CREDIT_DEBIT_OK`                                                     | credit-debit    | conversation metered (credits, msgCount, tier)                                                                                     |
| `CREDIT_DEBIT_CLASSIFY`                                               | credit-debit    | per-turn classification: window size, actions (effort) + value_signal (tools touched), Nova's tier, prior + final (ratcheted) tier |
| `CREDIT_DEBIT_SKIP` / `CREDIT_DEBIT_NO_TRACE` / `CREDIT_DEBIT_CONFIG` | credit-debit    | skipped (missing ids / no trace / not configured)                                                                                  |
| `CREDIT_DEBIT_MONTHAGG`                                               | credit-debit    | monthly-aggregate update failed (non-fatal)                                                                                        |
| `CREDIT_DEBIT_AGENT_LOOKUP`                                           | credit-debit    | scheduled-run agentId recovery from chat-history failed (non-fatal; run stays unattributed)                                        |
| `CREDIT_NIGHTLY_OK`                                                   | credit-nightly  | run summary (candidates, summarised, errors, settlement)                                                                           |
| `CREDIT_NIGHTLY_SETTLE` / `CREDIT_NIGHTLY_SETTLE_FAIL`                | credit-nightly  | month-close settlement result / failure                                                                                            |
| `CREDIT_NIGHTLY_FAIL`                                                 | credit-nightly  | a single receipt summary failed (best-effort)                                                                                      |

Examples (CloudWatch Logs Insights, on `/numa/<client>-credits`):

- One event type: `fields @timestamp, credits_charged, tier, conversation_id | filter _name = "CREDIT_DEBIT_OK" | sort @timestamp desc`
- Why a tier landed: `fields @timestamp, conversation_id, nova_tier, prior_tier, final_tier, actions | filter _name = "CREDIT_DEBIT_CLASSIFY" | sort @timestamp desc`
- Everything credit-related (spans the agent container group too): `filter domain = "credits"`
