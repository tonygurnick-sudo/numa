---
api_name: WorkflowMax (by Xero)
api_slug: workflowmax
doc: event & error handling reference (companion to 01-llm-api-rules.md)
call_surface: HTTP via `numa integrations request`; proxy injects token + account_id
events: NONE — no webhook/WebSocket/SSE/long-poll/change-feed. Polling is the only change-detection mechanism.
confidence: webhook-absence + legacy XML error envelope well-grounded; rate-limit numbers + modern JSON error shape [UNKNOWN]/[INFERRED] — capture from first live 200 and first error. [DOCUMENTED] = vendor/SDK-stated.
---

# WorkflowMax — Event & Error Handling Reference

## Event-Driven Capabilities

No webhooks, WebSocket, SSE, long polling, or change feeds/streams [INFERRED — none found in docs/SDKs]. **Polling is the only way to detect changes.**

## Polling Strategy

Entities carry `WhenModified` (+ `WhenCreated`); list endpoints accept `from`/`to` date filters. Combine for incremental polling:

```
1. Store last_poll_date (a calendar date — from/to are date-granular YYYYMMDD).
2. Each poll: GET /{resource}.api/list?from={last_poll_date}&to={today}&page=1&pagesize=100  (page to end)
3. Keep records whose WhenModified > your last-seen high-water mark.
4. last_poll_date = today.
```

> ⚠️ `from`/`to` are **date-granular** (`YYYYMMDD`), not timestamp-granular. You cannot poll "since 14:32 today" — you re-pull the whole day. De-dupe on `UUID` + `WhenModified`. [from/to as compact dates DOCUMENTED; date-granularity limitation INFERRED]

Recommended polling endpoints:
| Change to detect | Poll endpoint |
| --- | --- |
| new/updated jobs | `/job.api/list?from=...&to=...` (or `/job.api/current`) |
| new/updated time entries | `/time.api/list?from=...&to=...` |
| new/updated invoices | `/invoice.api/list?from=...&to=...` (or `/invoice.api/current`) |
| new/updated clients | `/client.api/list` (page + filter `WhenModified` client-side) |
| new/updated leads | `/lead.api/list?from=...&to=...` (or `/lead.api/current`) |

Frequency: **≥15 min.** Reasons: (1) access tokens live ~12-30 min so each poll may straddle a refresh; (2) rate limits unpublished — don't probe; (3) date-granular filters mean sub-hour polling re-pulls the same day. Poll with `detailed=false` summaries; GET full detail only for UUIDs that changed. Low-activity orgs: hourly or on-demand.

## ⚠️ The single most important error gotcha

**A successful HTTP status does not mean success.** The legacy tier frequently returns **HTTP 200** with `{"Status":"Error",...}` (XML: `<Status>Error</Status>`) in the body for validation/business errors. **Always inspect the body `Status` field — never trust the HTTP code alone.** Treat `Status:"Error"` exactly like a 400: read `ErrorDescription`, do NOT retry, surface to the user. [DOCUMENTED for legacy XML]

## Error Response Format

Legacy XML (most likely on reused endpoints): `<Response><Status>Error</Status><ErrorDescription>Invalid UUID supplied</ErrorDescription></Response>`
JSON equivalent (`Accept: application/json`, [INFERRED]): `{"Status":"Error","ErrorDescription":"Invalid UUID supplied"}`
Success envelope: `{"Status":"OK","Jobs":[...]}`

Fields: `Status` (string, always present, `"OK"`/`"Error"` — **check first**); `ErrorDescription` (string, on error, human-readable reason).

> Modern v2 tier MAY instead use standard HTTP 4xx/5xx + `{"message":"..."}` — [INFERRED]; capture the real shape on the first failure.

## HTTP Status / Recovery Playbook

| HTTP                       | Signal             | Meaning                                      | Retryable  | Action                                                   | Max retries |
| -------------------------- | ------------------ | -------------------------------------------- | ---------- | -------------------------------------------------------- | ----------- |
| 200 + `Status:"OK"`        | —                  | success                                      | —          | process                                                  | —           |
| **200 + `Status:"Error"`** | `ErrorDescription` | business/validation error in body            | **No**     | read `ErrorDescription`; fix input                       | 0           |
| 400                        | —                  | bad request / malformed params               | No         | fix params                                               | 0           |
| 401                        | —                  | access token expired/invalid                 | No (agent) | surface "reconnect required"; do NOT blind-retry         | 0           |
| 403                        | —                  | missing `account_id` OR no 3rd-party access  | No         | header issue (proxy) / user must enable 3rd-party access | 0           |
| 404                        | —                  | unknown UUID/resource OR **wrong base host** | Maybe      | verify UUID; try the other base host once                | 1           |
| 429 (assumed)              | —                  | rate limited                                 | Yes        | exponential backoff + jitter                             | 3           |
| 500/502/503                | —                  | server error                                 | Yes        | exponential backoff                                      | 3           |

> **401 nuance:** the agent holds no tokens — the connector/proxy refreshes them. A 401 means the refresh failed or the connection needs re-consent (worsened by the `offline_access` scope gap). Don't loop on 401; report that WorkflowMax needs reconnecting.

## Rate Limits

| Scope        | Limit            | Window | Source                                                      |
| ------------ | ---------------- | ------ | ----------------------------------------------------------- |
| Global       | [UNKNOWN]        | —      | a "Rate Limiting" section exists in the gated v2 docs       |
| Per-endpoint | [UNKNOWN]        | —      | —                                                           |
| Per-org      | ~1000/hr + ~10/s | hr/s   | [INFERRED, unconfirmed] — cited for the **legacy** API only |

Rate-limit headers + `Retry-After`: [UNKNOWN] — capture on first 200 and first 429; honour `Retry-After` if present. Exceeded response: assume HTTP 429; legacy may instead return `Status:"Error"`.

Backoff: (1) honour `Retry-After` if present; (2) else exponential `2^attempt` s (1s,2s,4s,...) capped ~60s; (3) add ±20% jitter; (4) cap concurrency low (single-flight per resource — no bulk endpoints, limits unknown).

## Retry Logic (pseudocode)

```
function callWithRetry(request, maxRetries=3):
    for attempt in 1..maxRetries:
        response = connect_request(request)        # proxy injects token + account_id
        # 1. Envelope check FIRST — 200 can still be an error
        if response.http == 200 and body.Status == "Error":
            raise BusinessError(body.ErrorDescription)   # do NOT retry
        if response.http == 200 and body.Status == "OK":
            return body
        # 2. HTTP-level handling
        switch response.http:
            case 401: raise ReconnectRequired()          # token refresh is the connector's job
            case 403: raise AccessError("account_id missing or 3rd-party access not enabled")
            case 400, 404: raise ClientError(response)   # fix input / verify UUID — no retry
            case 429: wait(retryAfter or 2^attempt + jitter); continue
            case 500, 502, 503: wait(2^attempt + jitter); continue
            default: raise ApiError(response)
    raise MaxRetriesExceeded()
```

## Idempotency & Consistency

- **No idempotency key.** GET/PUT/DELETE are naturally idempotent; POST (`add`) is NOT — guard duplicate creates (check-before-create; never replay a POST that returned `Status: OK`).
- **No optimistic-locking token** (unlike sibling MYOB's `RowVersion`). Concurrent edits are last-write-wins; GET immediately before an update to reduce clobbering.
- Consistency: assume read-after-write within the org. No async/long-running operations — every call is synchronous.

## Output Formatting

| Data type         | Format            | Example                                                                     |
| ----------------- | ----------------- | --------------------------------------------------------------------------- |
| Single job/client | key-value summary | "Job J000123 — Website Redesign · Acme Ltd · In Progress · due 30 Jun 2026" |
| Record list       | markdown table    | columns: ID, Name, Client, State, Due                                       |
| Time totals       | aggregated        | "Jane Smith: 12.5h billable, 1.0h non-billable (this week)"                 |
| Dates             | human-readable    | "27 May 2026"                                                               |
| Currency          | localized         | "$12,000.00 NZD" (org currency)                                             |
| Errors            | clear message     | "WorkflowMax rejected that: 'Invalid UUID supplied'. Check the job exists." |

Truncation: lists — show first ~20 records, then note the total ("showing 20 of 237 jobs"); long notes/descriptions — truncate at ~280 chars with "…". Always present the human `ID` (`J000123`) to the user but use the `UUID` internally for follow-up calls.

Numbers & money: monetary values are decimal strings to 2dp, no symbol — render with the org's currency. Time is stored in **minutes** — convert to hours for display (`Minutes/60`) and label billable vs non-billable.
