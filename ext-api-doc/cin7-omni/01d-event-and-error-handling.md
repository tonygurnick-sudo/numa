---
api_name: Cin7 Omni
api_slug: cin7-omni
base_url: https://api.cin7.com/api
path_version_segment: /v1/ all entities, /v2/ BomMasters only — part of the path
call_surface: HTTP via `numa integrations request` (connectors(request) form below); relative urls, NO auth headers (Numa injects Basic)
rate_limit: 3/sec, 60/min, 5000/day per API connection
doc_role: on-demand reference — events/polling, rate budget, errors, recovery
confidence: every fact live-API-confirmed 2026-05-22 unless tagged [SPEC] (BETA spec) or [UNVERIFIED]. Error bodies are spec-only (never observed live) — read the status code first, surface the returned string verbatim. NOT yet validated through the Numa connector path.
---

# Cin7 Omni — Event & Error Handling

## Event-driven capabilities

| Mechanism                      | Supported | Notes                                                                       |
| ------------------------------ | --------- | --------------------------------------------------------------------------- |
| Webhooks (outbound)            | **No**    | none in docs, spec, or live tests                                           |
| WebSocket / SSE / change feeds | No        | not available                                                               |
| Polling                        | **Yes**   | `ModifiedDate` watermark filters on list endpoints — the only event pattern |

> Don't confuse with **Cin7 Core** (separate `cin7-core` connector), which DOES have 31 webhook event types. "Cin7 webhooks" = Core; Omni has none. Confirm the product before promising anything event-driven.

If the user asks for "real-time" updates: be explicit that no webhooks exist and the floor is polling latency (minutes). Offer a Numa scheduled agent running the watermark loop.

## Polling — the only change-detection pattern

Every list endpoint accepts `where=ModifiedDate>='{watermark}'`. The loop:

1. Store a `last_synced_at` watermark per entity (UTC, `yyyy-MM-ddTHH:mm:ssZ`).
2. Query `where=ModifiedDate>='{watermark}'&order=ModifiedDate ASC&rows=250`.
3. Page (`page=2,3,…`) until an empty array — there is **no total count** in any list response.
4. Track the highest `ModifiedDate` seen; set it as the new watermark.
5. Use `>=` (not `>`) and de-dupe by `Id` — records sharing the boundary timestamp would otherwise be missed or doubled [UNVERIFIED — boundary semantics untested].

```
connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/SalesOrders?where=ModifiedDate>='2026-06-10T01:00:00Z'&order=ModifiedDate ASC&page=1&rows=250"})
```

### Recommended cadence (sized against 5000/day)

| Entity         | Interval     | Why                                                                           |
| -------------- | ------------ | ----------------------------------------------------------------------------- |
| SalesOrders    | every 5 min  | highest-churn, most user-visible                                              |
| PurchaseOrders | every 15 min | inbound stock changes                                                         |
| Stock          | every 15 min | `ModifiedDate`=last transaction date [SPEC]; watermark filtering [UNVERIFIED] |
| Products       | every 30 min | catalog changes infrequent                                                    |
| Contacts       | every 60 min | slowest-moving                                                                |

(All filter `ModifiedDate>='{watermark}'`.) This schedule ≈ 288+96+96+48+24 = **552 polls/day** if most polls return one page — ~11% of the cap. Each extra result page is one more request.

### Chat vs scheduled context

- **In chat: poll on demand, never on a timer.** When the user asks "what's new", query from the last watermark in the conversation. Don't burn budget on speculative refreshes.
- **Standing schedules belong in Numa scheduled agents**, where the cadence above applies; persist the watermark between runs.

### "What changed today?" digest — ~3 requests, one per entity (use `fields` to trim the 70+-field DTOs):

```
connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/SalesOrders?where=ModifiedDate>='2026-06-10T00:00:00Z'&order=ModifiedDate ASC&fields=Id,Reference,Stage,Total,ModifiedDate&rows=250"})
connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/PurchaseOrders?where=ModifiedDate>='2026-06-10T00:00:00Z'&order=ModifiedDate ASC&fields=Id,Reference,Stage,ModifiedDate&rows=250"})
connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/Contacts?where=ModifiedDate>='2026-06-10T00:00:00Z'&order=ModifiedDate ASC&fields=Id,Company,Email,Type&rows=250"})
```

### Scheduled sync recipe (Numa scheduled agent — operational guidance, not an API feature)

```
1. Read watermarks.json from /workdir (e.g. {"SalesOrders":"2026-06-10T01:00:00Z",...}); if absent,
   init to a backstop (e.g. 7 days ago) — NOT epoch zero, or run 1 becomes a full historical scan.
2. For each entity on this run's cadence: watermark loop (ModifiedDate>=watermark, order ASC, rows=250,
   page until empty); ≥350ms between requests; abort cleanly on a persistent 429.
3. Process/report the changed records.
4. Write new high-water marks back to watermarks.json ONLY after processing succeeds — a crashed run
   then safely re-reads the same window next time (dedupe by Id).
```

## Rate-limit budgeting

Three nested limits per API connection:
| Window | Limit | Rule |
| --- | --- | --- |
| Second | 3 | space calls ≥~350ms apart; no parallel bursts |
| Minute | 60 | a 40-page drain ≈ 2/3 of a minute's budget |
| Day | 5,000 | the real constraint — never full-scan large entities |

- Exceeding any window → **429**, body `"Rate limit exceeded. Retry after some time."` [SPEC]. No `Retry-After` header documented [UNVERIFIED — headers not captured].
- A 10,000-record entity at `rows=250` = 40 requests. Naive unfiltered re-sync of five such entities every 15 min = 19,200/day = **blown by mid-morning**. `ModifiedDate` filters keep you alive.
- A first-time historical backfill of a large account may legitimately need multiple days under 5000/day — warn the user up front.
- Daily reset boundary is not documented — assume rolling or UTC-midnight; don't engineer close to the line [UNVERIFIED].
- **When the daily cap is hit:** stop non-critical calls, tell the user the 5,000-call daily budget is exhausted, resume next day. Prioritise user-initiated reads over background syncs.

## Error response format

**Error bodies are bare JSON strings, not objects** [SPEC]. No `{error,message}` envelope to parse:
| Status | Example body [SPEC] |
| --- | --- |
| 400 | `"Batch limit is 250."` / `"The rows argument cannot be greater than 250."` / `"The page number is out of range; the value must be greater than or equal to 1."` / `"Missing or malformed JSON data; please see the documentation for examples."` / other validation strings |
| 401 | `"Unauthorized access"` |
| 403 | `"Access is forbidden"` |
| 404 | `"Resource not found"` |
| 429 | `"Rate limit exceeded. Retry after some time."` |
| 500 | `"An unexpected error occurred. Please try again later."` |
| 503 | `"Service temporarily unavailable. Please try again later."` |

Runtime body format was unobserved in the investigation (spec examples only) — read the **status code first**, then surface whatever string comes back verbatim.

### Two error channels — always check both

1. **HTTP status** — request-level: auth, permission, rate limit, malformed/oversized batch.
2. **Per-record `Errors[]` inside an HTTP 200** — on POST/PUT, the response array carries `{Index,Success,Id,Code,Errors[]}` per record; a record can fail while the request "succeeds" (full envelope in 01c).

```
HTTP status != 200?  → request-level failure → Recovery Playbook
HTTP 200             → per element: Success==true? yes→capture Id/Code · no→surface that record's Errors[] (by Index)
```

Never report success from HTTP 200 alone.

## Recovery playbook

| Status | Meaning                                 | Retryable? | Action                                                                                                         |
| ------ | --------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| 200    | OK — check per-record `Success`         | —          | surface any `Errors[]`; capture `Id`s                                                                          |
| 400    | validation / paging / batch             | No         | read the string, fix payload/params; for batch writes re-query state before re-submitting                      |
| 401    | bad/regenerated API key                 | No         | user reconnects Cin7 Omni via the chat credential card                                                         |
| 403    | **per-endpoint key permission missing** | No         | admin enables it: Cin7 Omni → Settings → Integrations & API → API v1 → connection → permissions                |
| 404    | wrong Id or path                        | No         | verify the entity Id and the `/v1/` prefix (`/v2/` only for BomMasters)                                        |
| 429    | rate limit (3/s, 60/m, 5000/day)        | Yes        | back off 1s→5s→30s→2m; after 4 attempts stop & report; keep ≥350ms between calls                               |
| 500    | server error                            | Once       | retry once after 5s — but for POST/PUT check first whether the write landed (no idempotency keys) [UNVERIFIED] |
| 503    | maintenance                             | Yes        | wait 5–10 min; retry; report if persistent                                                                     |

**429 backoff ladder:** attempt 1 → 1s, 2 → 5s, 3 → 30s, 4 → 2min, then stop and defer to the next window. Which window you tripped matters: a per-second/minute 429 clears within a minute; if 429s persist after the full ladder, assume the **daily** cap and stop entirely rather than grinding.

**Timeouts / network failures** give no signal whether the request was processed — never assume failure on a write.

- **Reads:** safe to retry immediately after a short wait.
- **Writes:** "unknown outcome" — run the write-retry check before re-sending. Structure multi-call work so any single failed call can be retried without redoing the rest.

**Retrying writes safely** (no idempotency keys [UNVERIFIED]): after a timeout/429/5xx on a POST —

1. Query for the record you tried to create — by `Reference` (orders), `Email` (contacts), `StyleCode` (products), or `TransactionRef` (payments).
2. Only re-POST if genuinely absent.
3. PUTs are naturally safe to repeat (same `Id`, same values) — but rebuild from a fresh GET if time has passed; keep `null`=skip / `""`=clear in mind.

## Counter-exceptions (non-obvious cases)

1. **403 is a configuration problem, not auth.** Key lacks that endpoint's permission toggle. Don't retry; don't re-prompt for credentials. Name the exact endpoint so the admin knows which toggle (Cin7 Omni → Settings → Integrations & API → API v1 → connection → permissions).
2. **401 mid-conversation after earlier success = regenerated key.** Keys are static/never-expire, but regenerating invalidates the old one immediately. Reconnect via the chat credential card.
3. **HTTP 200 with `Success:false` records = partial failure.** Report which records failed (by `Index`+`Code`) with their `Errors[]`; re-attempt only the failed ones.
4. **Envelope keys may come back lowercase** (`index`/`success`/`errors`). Match case-insensitively. [SPEC]
5. **Empty `[]` with 200 is not an error** — no matches / paged past the end. Stop paging; don't retry.
6. **400 on a Products batch ≈ duplicate codes** (`StyleCode`/`ProductOptionCode`, in-batch or vs existing). Find it with a `where` query; don't resubmit unchanged; re-query first (whether the 400 left records created is [UNVERIFIED]).
7. **A just-created Cin7 user missing from `/v1/Users` is normal** — ≤2h propagation. Wait; don't escalate.
8. **None of this is exercised through the Numa connector path yet.** If a response contradicts these files, trust what the API returned, surface it verbatim, note the discrepancy.

## Connection health check

When errors look auth-shaped (401/403) or the user reports "Cin7 isn't working", run two cheap probes first (agent-side version of `04-connection-and-reauth.md`):

```
# Probe 1 — credentials valid at all?
connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/Users?rows=1"})
# Probe 2 — does the key have Read on a real business entity?
connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/Stock?page=1&rows=1"})
```

| Outcome                      | Diagnosis                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Both 200                     | healthy — original error is endpoint-specific (missing permission toggle on that endpoint, or a payload problem) |
| Probe 1 → 401                | credential pair is bad (key regenerated/removed) — reconnect via chat card                                       |
| Probe 1 → 403, Probe 2 → 200 | credentials fine; key just lacks Read on Users — harmless, ignore                                                |
| Both 403                     | credentials fine but few/no permission toggles enabled — admin must configure the API connection in Cin7         |

Two probes cost 2 of the day's 5,000 — worth it before a long debugging detour.

## Output formatting

| Data type    | Format                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Sales order  | "SALE4-28: Acme Ltd — Processing, $219.98 NZD (2 lines, modified Jun 10)"                                                        |
| Contact      | "Acme Ltd — Jane Smith (jane.smith@acme.co.nz, Customer, active)"                                                                |
| Stock row    | "WIDGET-RED-L @ Main Branch: 14 available (16 on hand, 2 open sales, 5 incoming)"                                                |
| Write result | "Created 3 of 4 contacts — record 2 (jane@acme.co.nz) failed: <Errors[0] verbatim>"                                              |
| Rate limit   | "Cin7 Omni's rate limit was hit; retrying shortly (limits: 3/sec, 60/min, 5,000/day)"                                            |
| 403          | "Your Cin7 API key doesn't have permission for <endpoint>. An admin can enable it under Settings → Integrations & API → API v1." |
| Errors       | quote the API's error string verbatim — bodies are plain strings, don't paraphrase away detail                                   |

Truncation: show the first 10 records and say how many pages were fetched. No total count in any list response, so phrase totals as "at least N" unless you paged to the end.
