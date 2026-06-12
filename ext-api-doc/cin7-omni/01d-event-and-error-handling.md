---
api_name: 'Cin7 Omni'
api_slug: 'cin7-omni'
generated_from: '00-api-investigation (2026-05-22) + live OpenAPI 3.0 spec'
generated_date: '2026-06-10'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# Cin7 Omni -- Event & Error Handling Reference

> ⚠️ Investigation-confirmed (live API tests 2026-05-22) but NOT yet validated through the Numa connector path.
> All examples use the Numa `connectors` tool form — relative URLs, **no auth headers** (Numa injects Basic auth automatically).

## Event-Driven Capabilities

| Mechanism                | Supported | Notes                                                                       |
| ------------------------ | --------- | --------------------------------------------------------------------------- |
| Webhooks (outbound)      | **No**    | No webhook system found in docs, spec, or live tests [CONFIRMED — API investigation 2026-05-22] |
| WebSocket                | No        | Not available                                                               |
| Server-Sent Events (SSE) | No        | Not available                                                               |
| Change feeds / streams   | No        | Not available                                                               |
| Polling                  | **Yes**   | `ModifiedDate` watermark filters on list endpoints — the only event pattern |

> Do not confuse this with **Cin7 Core** (the other Cin7 product, separate `cin7-core` connector), which DOES have 31 webhook event types. If a user mentions "Cin7 webhooks", they are thinking of Core — Omni has none. Confirm which product they use before promising anything event-driven. [CONFIRMED — API investigation 2026-05-22]

---

## Polling: The Only Change-Detection Pattern

Every list endpoint accepts `where=ModifiedDate>='{watermark}'` [CONFIRMED — API investigation 2026-05-22]. Full query mechanics live in `01b-query-patterns.md`; this section covers the operational loop.

### The Watermark Loop

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/SalesOrders?where=ModifiedDate>='2026-06-10T01:00:00Z'&order=ModifiedDate ASC&page=1&rows=250"})
```

1. Store a `last_synced_at` watermark per entity (UTC, `yyyy-MM-ddTHH:mm:ssZ`).
2. Query with `where=ModifiedDate>='{watermark}'&order=ModifiedDate ASC&rows=250`.
3. Page (`page=2,3,…`) until an empty array comes back — there is **no total count** in any list response [CONFIRMED — API investigation 2026-05-22].
4. Track the highest `ModifiedDate` seen; set it as the new watermark.
5. Use `>=` (not `>`) and de-dupe by `Id` — records sharing the boundary timestamp would otherwise be missed or doubled [UNVERIFIED — boundary semantics untested].

### Recommended Polling Cadence

Intervals from the 2026-05-22 investigation, sized against the 5,000/day budget:

| Entity         | Interval     | Filter                        | Why                                              |
| -------------- | ------------ | ----------------------------- | ------------------------------------------------ |
| SalesOrders    | every 5 min  | `ModifiedDate>='{watermark}'` | Highest-churn, most user-visible entity          |
| PurchaseOrders | every 15 min | `ModifiedDate>='{watermark}'` | Inbound stock changes                            |
| Stock          | every 15 min | `ModifiedDate>='{watermark}'` | Stock `ModifiedDate` = last transaction date [SPEC]; watermark filtering on it is [UNVERIFIED] |
| Products       | every 30 min | `ModifiedDate>='{watermark}'` | Catalog changes are infrequent                   |
| Contacts       | every 60 min | `ModifiedDate>='{watermark}'` | Slowest-moving entity                            |

**Budget check** [CONFIRMED — API investigation 2026-05-22 rate limits]: this schedule ≈ 288 + 96 + 96 + 48 + 24 = **552 polls/day** when most polls return a single page — ~11% of the 5,000/day cap, leaving plenty for interactive use. Each extra result page is one more request; a poll that drains 4 pages costs 4.

### Chat vs Scheduled Context

- **In chat: poll on demand, never on a timer.** When the user asks "what's new", query from the last watermark noted in the conversation. Don't burn budget on speculative refreshes.
- **Standing schedules belong in Numa scheduled agents**, where the cadence table above applies. A scheduled sync should persist its watermark (e.g. in a workspace file) between runs.

### Worked Example: "What changed today?" digest

Three calls, one per entity the user cares about — ~3 requests total:

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/SalesOrders?where=ModifiedDate>='2026-06-10T00:00:00Z'&order=ModifiedDate ASC&fields=Id,Reference,Stage,Total,ModifiedDate&rows=250"})

connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/PurchaseOrders?where=ModifiedDate>='2026-06-10T00:00:00Z'&order=ModifiedDate ASC&fields=Id,Reference,Stage,ModifiedDate&rows=250"})

connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/Contacts?where=ModifiedDate>='2026-06-10T00:00:00Z'&order=ModifiedDate ASC&fields=Id,Company,Email,Type&rows=250"})
```

Use `fields` to trim the wide order DTOs (70+ fields each) — digest polls don't need full payloads.

---

## Rate-Limit Budgeting

Three nested limits per API connection [CONFIRMED — API investigation 2026-05-22]:

| Window | Limit | Practical rule                                                  |
| ------ | ----- | ---------------------------------------------------------------- |
| Second | 3     | Space calls ≥ ~350ms apart; never fire parallel bursts          |
| Minute | 60    | A 40-page pagination drain ≈ 2/3 of a whole minute's budget     |
| Day    | 5,000 | The real constraint — plan syncs; never full-scan large entities |

- Exceeding any window → **429** with body `"Rate limit exceeded. Retry after some time."` [SPEC]. No `Retry-After` header is documented [UNVERIFIED — response headers not captured in the investigation].
- **Budget arithmetic:** a 10,000-record entity at `rows=250` = 40 requests. A naive unfiltered re-sync of five such entities = 200 requests; doing that every 15 minutes = 19,200/day = **blown budget by mid-morning**. `ModifiedDate` filters are what keep you alive. [CONFIRMED — API investigation 2026-05-22]
- A first-time historical backfill of a large account may legitimately need multiple days under the 5,000/day cap — warn the user up front. [CONFIRMED — API investigation 2026-05-22]
- The daily reset boundary is not documented — assume a rolling or UTC-midnight window and don't engineer close to the line [UNVERIFIED].

**When the daily cap is hit:** stop all non-critical calls, tell the user the Cin7 Omni daily API budget (5,000 calls) is exhausted, and resume the next day. Prioritise user-initiated reads over background syncs.

---

## Error Response Format

**Error bodies are bare JSON strings, not objects** [SPEC]. There is no `{ "error": ..., "message": ... }` envelope to parse:

| Status | Example body [SPEC]                                          |
| ------ | ------------------------------------------------------------ |
| 400    | `"Batch limit is 250."` / `"The rows argument cannot be greater than 250."` / `"The page number is out of range; the value must be greater than or equal to 1."` / `"Missing or malformed JSON data; please see the documentation for examples."` / other validation strings |
| 401    | `"Unauthorized access"`                                      |
| 403    | `"Access is forbidden"`                                      |
| 404    | `"Resource not found"`                                       |
| 429    | `"Rate limit exceeded. Retry after some time."`              |
| 500    | `"An unexpected error occurred. Please try again later."`    |
| 503    | `"Service temporarily unavailable. Please try again later."` |

The exact runtime body format was an **outstanding unknown** in the investigation (spec examples only, never observed live) — read the **status code first**, then surface whatever string comes back verbatim [CONFIRMED — API investigation 2026-05-22, listed as needs-testing].

### Two Error Channels — Always Check Both

1. **HTTP status** — request-level failures: auth, permission, rate limit, malformed/oversized batch.
2. **Per-record `Errors[]` inside an HTTP 200** — on POST/PUT, the response array carries `{Index, Success, Id, Code, Errors[]}` per record; a record can fail while the request "succeeds" [SPEC].

Decision flow for any write:

```
HTTP status != 200?  → request-level failure → Recovery Playbook below
HTTP 200             → for each element: Success == true?
                          yes → capture Id/Code
                          no  → surface that record's Errors[] strings (by Index)
```

Never report success from HTTP 200 alone. See `01c-mutation-patterns.md` § Batch Result Envelope for the full envelope semantics (including the PascalCase-vs-lowercase key inconsistency).

---

## Recovery Playbook

| Status | Meaning                                 | Retryable? | Action                                                                                          |
| ------ | --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| 200    | OK — but check per-record `Success`     | --         | Surface any `Errors[]`; capture returned `Id`s                                                   |
| 400    | Validation / paging / batch error       | No         | Read the string, fix the payload or params; for batch writes re-query state before re-submitting |
| 401    | Bad or regenerated API key              | No         | User reconnects Cin7 Omni via the chat credential card                                           |
| 403    | **Per-endpoint key permission missing** | No         | Admin enables it: Cin7 Omni → Settings → Integrations & API → API v1 → connection → permissions  |
| 404    | Wrong Id or path                        | No         | Verify the entity Id and the `/v1/` prefix (`/v2/` only for BomMasters)                          |
| 429    | Rate limit (3/sec, 60/min, 5,000/day)   | Yes        | Back off 1s → 5s → 30s → 2min; after 4 attempts, stop and report. Keep ≥350ms between calls.     |
| 500    | Server error                            | Once       | Retry once after 5s — but for POST/PUT, check first whether the write landed (no idempotency keys) [UNVERIFIED] |
| 503    | Scheduled maintenance                   | Yes        | Wait 5–10 minutes; retry; report if persistent                                                   |

### Backoff for 429

```
attempt 1: wait 1 second
attempt 2: wait 5 seconds
attempt 3: wait 30 seconds
attempt 4: wait 2 minutes
→ then stop, report, and defer to the next window
```

[CONFIRMED — API investigation 2026-05-22, recommended strategy]

Which window you tripped matters: a per-second/minute 429 clears within a minute of backoff; if 429s persist after the full ladder, assume the **daily** cap and stop entirely rather than grinding the retry loop.

### Timeouts and Network Failures

A timeout or dropped connection gives **no signal about whether the request was processed** — never assume failure on a write.

- **Reads:** safe to retry immediately after a short wait.
- **Writes:** treat as "unknown outcome" — run the write-retry check below before re-sending.
- The investigation's standing guidance: never assume the API is online; structure multi-call work so any single failed call can be retried without redoing the rest. [CONFIRMED — API investigation 2026-05-22, recommended practice]

### Retrying Writes Safely

Mutations have **no idempotency keys** [UNVERIFIED — none documented]. After a timeout, 429, or 5xx on a POST:

1. Query for the record you tried to create — by `Reference` (orders), `Email` (contacts), `StyleCode` (products), or `TransactionRef` (payments).
2. Only re-POST if it's genuinely absent.
3. PUTs are naturally safe to repeat (same `Id`, same field values) — but rebuild from a fresh GET if time has passed, and keep the `null` = skip / `""` = clear rule in mind.

---

## Counter-Exception Handling

1. **403 is a configuration problem, not an auth problem.** The API key lacks that specific endpoint's Create/Read/Update permission toggle. Do not retry; do not tell the user to re-enter credentials. Name the exact endpoint so the admin knows which toggle to flip (Cin7 Omni → Settings → Integrations & API → API v1 → connection → permissions). [CONFIRMED — API investigation 2026-05-22]

2. **401 mid-conversation after earlier success = regenerated key.** Keys are static and never expire, but regenerating a key in Cin7 invalidates the old one immediately. Reconnect via the chat credential card. [CONFIRMED — API investigation 2026-05-22]

3. **HTTP 200 with `Success: false` records is a partial failure.** Report exactly which records failed (by `Index` and `Code`) with their `Errors[]` strings; re-attempt only the failed ones. [SPEC]

4. **Envelope keys may come back lowercase.** The spec schema says `Index`/`Success`/`Errors`; its own examples say `index`/`success`/`errors`. Match case-insensitively. [SPEC]

5. **Empty array `[]` with 200 is not an error** — no matches, or you paged past the end. Stop paging; don't retry.

6. **400 on a Products batch ≈ duplicate codes.** Almost always a duplicate `StyleCode`/`ProductOptionCode` within the batch or against existing data. Find it with a `where` query; do NOT resubmit unchanged — and whether the 400 left any records created is [UNVERIFIED], so re-query first. [CONFIRMED — API investigation 2026-05-22]

7. **A just-created Cin7 user missing from `/v1/Users` is normal** — up to 2 hours propagation delay. Wait; don't escalate. [CONFIRMED — API investigation 2026-05-22]

8. **5,000/day exhausted mid-task:** stop background/polling work, keep only user-critical reads, resume next day. Reset timing is [UNVERIFIED]. [CONFIRMED — API investigation 2026-05-22 limits]

9. **User asks for "real-time" updates from Omni:** be explicit that no webhooks exist and the floor is polling latency (minutes). Offer a Numa scheduled agent running the watermark loop instead. [CONFIRMED — API investigation 2026-05-22]

10. **None of this has been exercised through the Numa connector path yet.** If a response shape contradicts this file, trust what the API actually returned, surface it verbatim, and note the discrepancy.

---

## Connection Health Check

When errors look auth-shaped (401/403) or the user reports "Cin7 isn't working", run two cheap probes before debugging anything else (agent-side version of the sequence in `04-connection-and-reauth.md`):

```
# Probe 1 — are the credentials valid at all?
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/Users?rows=1"})

# Probe 2 — does the key have Read on a real business entity?
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/Stock?page=1&rows=1"})
```

| Probe outcome              | Diagnosis                                                                  |
| -------------------------- | --------------------------------------------------------------------------- |
| Both 200                   | Connection healthy — the original error is endpoint-specific (likely a missing permission toggle on that endpoint, or a payload problem) |
| Probe 1 → 401              | Credential pair is bad (key regenerated/removed) — reconnect via chat card  |
| Probe 1 → 403, Probe 2 → 200 | Credentials fine; the key just lacks Read on Users — harmless, ignore     |
| Both 403                   | Credentials fine but the key has few/no permission toggles enabled — admin must configure the API connection in Cin7 |

Two probes cost 2 of the day's 5,000 requests — always worth it before a long debugging detour.

## Scheduled Sync Recipe (Numa scheduled agent)

For a standing "sync changes" schedule, persist the watermark between runs in a workspace file:

```
1. Read watermarks.json from /workdir (e.g. {"SalesOrders": "2026-06-10T01:00:00Z", ...});
   if absent, initialise to a sensible backstop (e.g. 7 days ago) — NOT epoch zero,
   or the first run becomes a full historical scan against the 5,000/day budget.
2. For each entity on this run's cadence:
   a. Watermark loop (above): filter ModifiedDate >= watermark, order ASC, rows=250, page until empty.
   b. ≥350ms between requests; abort the run cleanly on a persistent 429.
3. Process/report the changed records.
4. Write the new high-water marks back to watermarks.json ONLY after processing succeeds —
   a crashed run then safely re-reads the same window next time (dedupe by Id).
```

This is a recommended pattern, not an API feature — the watermark filter itself is [CONFIRMED — API investigation 2026-05-22]; the recipe is operational guidance.

---

## Output Formatting Guide

How to present Cin7 Omni results and failures to the user:

| Data type    | Format                                                                                |
| ------------ | -------------------------------------------------------------------------------------- |
| Sales order  | "SALE4-28: Acme Ltd — Processing, $219.98 NZD (2 lines, modified Jun 10)"              |
| Contact      | "Acme Ltd — Jane Smith (jane.smith@acme.co.nz, Customer, active)"                      |
| Stock row    | "WIDGET-RED-L @ Main Branch: 14 available (16 on hand, 2 open sales, 5 incoming)"      |
| Write result | "Created 3 of 4 contacts — record 2 (jane@acme.co.nz) failed: <Errors[0] verbatim>"    |
| Rate limit   | "Cin7 Omni's rate limit was hit; retrying shortly (limits: 3/sec, 60/min, 5,000/day)"  |
| 403          | "Your Cin7 API key doesn't have permission for <endpoint>. An admin can enable it under Settings → Integrations & API → API v1." |
| Errors       | Quote the API's error string verbatim — bodies are plain strings, don't paraphrase away the detail |

Truncation: show the first 10 records and say how many pages were fetched. There is no total count in any list response [CONFIRMED — API investigation 2026-05-22], so phrase totals as "at least N" unless you paged to the end.

---

_Generated 2026-06-10 from the 2026-05-22 API investigation + live OpenAPI spec. Companion to `01-llm-api-rules.md`. See `01b-query-patterns.md` for the watermark polling loop and `01c-mutation-patterns.md` for write-error envelopes._
