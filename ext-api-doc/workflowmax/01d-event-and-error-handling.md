---
api_name: 'WorkflowMax (by Xero)'
api_slug: 'workflowmax'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# WorkflowMax (by Xero) -- Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Event-driven capabilities (none — polling only),
> error formats, recovery playbooks, and output formatting.
>
> **Confidence: medium.** The webhook-absence and legacy XML error envelope are well-grounded;
> rate-limit numbers and the modern JSON error shape are **[UNKNOWN]/[INFERRED]** — capture them
> from the first live 200 and first error.

---

## Event-Driven Capabilities

| Mechanism                | Supported | Notes                                                   |
| ------------------------ | --------- | ------------------------------------------------------- |
| Webhooks                 | **No**    | No webhook registration surface in docs/SDKs [INFERRED] |
| WebSocket                | No        | [INFERRED]                                              |
| Server-Sent Events (SSE) | No        | [INFERRED]                                              |
| Long polling             | No        | [INFERRED]                                              |
| Change feeds / streams   | No        | [INFERRED]                                              |

**There are no push mechanisms. Polling is the only way to detect changes.**

---

## Polling Strategy (the only change-detection option)

Entities carry `WhenModified` (and `WhenCreated`), and list endpoints accept `from`/`to` date
filters. Combine them for incremental polling.

### Incremental poll pattern

```
1. Store last_poll_date (a calendar date, since from/to are date-granular YYYYMMDD).
2. On each poll:
     GET /{resource}.api/list?from={last_poll_date}&to={today}&page=1&pagesize=100
     (page through to the end)
3. Of the returned records, keep those whose WhenModified > your last-seen high-water mark.
4. Update last_poll_date = today.
```

> ⚠️ `from`/`to` are **date-granular** (`YYYYMMDD`), not timestamp-granular. You cannot poll
> "since 14:32 today" — you'll re-pull the whole day. De-dupe on `UUID` + `WhenModified` to avoid
> reprocessing. [DOCUMENTED that from/to are compact dates; the date-granularity limitation is INFERRED.]

### Recommended polling endpoints

| Change to detect         | Poll endpoint                                                    |
| ------------------------ | ---------------------------------------------------------------- |
| New/updated jobs         | `/job.api/list?from=...&to=...` (or `/job.api/current`)          |
| New/updated time entries | `/time.api/list?from=...&to=...`                                 |
| New/updated invoices     | `/invoice.api/list?from=...&to=...` (or `/invoice.api/current`)  |
| New/updated clients      | `/client.api/list` (page + filter on `WhenModified` client-side) |
| New/updated leads        | `/lead.api/list?from=...&to=...` (or `/lead.api/current`)        |

### Polling frequency guidelines

- **Recommended interval: ≥ 15 minutes.** Reasons: (1) access tokens live only ~12-30 min, so each
  poll may straddle a refresh; (2) rate limits are unpublished — don't probe them; (3) date-granular
  filters mean sub-hour polling re-pulls the same day anyway.
- Use `detailed=false` summaries when polling; only GET full detail for UUIDs that actually changed.
- For low-activity orgs, hourly or on-demand is plenty.

---

## Error Response Format

WorkflowMax wraps responses in a status envelope. The **legacy XML** form is the one most likely
still served on the reused resource endpoints; the modern JSON equivalent is [INFERRED].

### Legacy XML (most likely)

```xml
<Response>
  <Status>Error</Status>
  <ErrorDescription>Invalid UUID supplied</ErrorDescription>
</Response>
```

### JSON equivalent (with `Accept: application/json`, [INFERRED])

```json
{ "Status": "Error", "ErrorDescription": "Invalid UUID supplied" }
```

### Success envelope (for contrast)

```json
{
  "Status": "OK",
  "Jobs": [
    /* ... */
  ]
}
```

**Error fields:**

| Field              | Type   | Always present? | Description                                |
| ------------------ | ------ | --------------- | ------------------------------------------ |
| `Status`           | string | Yes             | `"OK"` or `"Error"` — **check this first** |
| `ErrorDescription` | string | On error        | Human-readable failure reason              |

> The modern v2 tier _may_ instead use standard HTTP 4xx/5xx with a JSON `{ "message": "..." }`
> body. This is **[INFERRED]** — capture the real shape on the first failure and reconcile.

---

## ⚠️ The single most important error gotcha

**A successful HTTP status does not mean success.** The legacy tier frequently returns **HTTP 200**
with `<Status>Error</Status>` (or `{"Status":"Error"}`) in the body for validation/business errors.

> **Always inspect the body `Status` field — never trust the HTTP status code alone.** Treat
> `Status: "Error"` exactly like a 400: read `ErrorDescription`, do not retry, surface to the user.

[DOCUMENTED for legacy XML.]

---

## HTTP Status / Recovery Playbook

| HTTP Status                | Error signal       | Meaning                                        | Retryable? | Recovery action                                          | Max retries |
| -------------------------- | ------------------ | ---------------------------------------------- | ---------- | -------------------------------------------------------- | ----------- |
| 200 + `Status: "OK"`       | —                  | Success                                        | —          | Process response                                         | —           |
| **200 + `Status:"Error"`** | `ErrorDescription` | Business/validation error in body              | **No**     | Read `ErrorDescription`; fix input                       | 0           |
| 400                        | —                  | Bad request / malformed params                 | No         | Fix params — do not retry                                | 0           |
| 401                        | —                  | Access token expired/invalid                   | No (agent) | Surface "reconnect required"; do not blind-retry         | 0           |
| 403                        | —                  | Missing `account_id` OR no 3rd-party access    | No         | Header issue (proxy) / user must enable 3rd-party access | 0           |
| 404                        | —                  | Unknown UUID/resource — or **wrong base host** | Maybe      | Verify UUID; try the other base host once                | 1           |
| 429 (assumed)              | —                  | Rate limited                                   | Yes        | Exponential backoff + jitter                             | 3           |
| 500 / 502 / 503            | —                  | Server error                                   | Yes        | Exponential backoff                                      | 3           |

> **401 nuance:** the agent does not hold tokens — the connector/proxy refreshes them. A 401 means
> the refresh failed or the connection needs re-consent (worsened by the `offline_access` scope gap).
> Don't loop on 401; report that the WorkflowMax connection needs reconnecting.

---

## Rate Limits

| Scope        | Limit            | Window | Source                                                      |
| ------------ | ---------------- | ------ | ----------------------------------------------------------- |
| Global       | [UNKNOWN]        | —      | A "Rate Limiting" section exists in the gated v2 docs       |
| Per-endpoint | [UNKNOWN]        | —      | —                                                           |
| Per-org      | ~1000/hr + ~10/s | hr/s   | [INFERRED, unconfirmed] — cited for the **legacy** API only |

- **Rate-limit headers:** [UNKNOWN] — capture response headers on the first 200 and first 429.
- **Retry-After header:** [UNKNOWN] — honour it if present.
- **Exceeded response:** assume HTTP 429; legacy may instead return `Status: "Error"`. [INFERRED]

**Backoff strategy:**

1. If a `Retry-After` header is present, honour it.
2. Otherwise exponential backoff: `2^attempt` seconds (1s, 2s, 4s, ...), capped at ~60s.
3. Add jitter (±20%) to avoid thundering-herd on retries.
4. Cap concurrency low (single-flight per resource) — there are no bulk endpoints and limits are unknown.

---

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
            case 401:
                raise ReconnectRequired()            # token refresh is the connector's job
            case 403:
                raise AccessError("account_id missing or 3rd-party access not enabled")
            case 400, 404:
                raise ClientError(response)          # fix input / verify UUID — no retry
            case 429:
                wait(retryAfter or 2^attempt + jitter); continue
            case 500, 502, 503:
                wait(2^attempt + jitter); continue
            default:
                raise ApiError(response)

    raise MaxRetriesExceeded()
```

---

## Idempotency & Consistency

- **No idempotency key.** GET/PUT/DELETE are naturally idempotent; POST (`add`) is **not** — guard
  against duplicate creates (check-before-create; never replay a POST that returned `Status: OK`).
- **No optimistic-locking token** (unlike the sibling MYOB API's `RowVersion`). Concurrent edits are
  last-write-wins; GET immediately before an update to reduce clobbering. [INFERRED]
- **Consistency:** assume read-after-write within the org. [INFERRED]
- **No async/long-running operations** — every call is synchronous.

---

## Counter-Exceptions (differs from standard REST)

1. **200 means "request reached us", not "it worked."**
   - Standard: 2xx = success, 4xx = client error.
   - Actual: a validation/business failure can arrive as **HTTP 200** with `Status: "Error"`. Always read the envelope.
2. **403 ≠ purely a permission problem.**
   - Standard: 403 = forbidden by policy.
   - Actual: a 403 here is most often a **missing `account_id` header** (a request-shaping bug) or the user lacking "Authorise 3rd Party Full Access" — not a scope problem.
3. **A 404 can mean the wrong host, not a missing record.**
   - Standard: 404 = resource not found.
   - Actual: the base host is unconfirmed (`api.workflowmax2.com` vs `api.workflowmax.com`); a host-level 404 should prompt trying the other host before concluding the UUID is wrong.

---

## Output Formatting Guide

### Recommended display formats

| Data type         | Format            | Example                                                                     |
| ----------------- | ----------------- | --------------------------------------------------------------------------- |
| Single job/client | Key-value summary | "Job J000123 — Website Redesign · Acme Ltd · In Progress · due 30 Jun 2026" |
| Record list       | Markdown table    | Columns: ID, Name, Client, State, Due                                       |
| Time totals       | Aggregated        | "Jane Smith: 12.5h billable, 1.0h non-billable (this week)"                 |
| Dates             | Human-readable    | "27 May 2026"                                                               |
| Currency          | Localized         | "$12,000.00 NZD" (org currency)                                             |
| Errors            | Clear message     | "WorkflowMax rejected that: 'Invalid UUID supplied'. Check the job exists." |

### Truncation rules

- Lists: show the first ~20 records, then note the total (e.g. "showing 20 of 237 jobs").
- Long notes/descriptions: truncate at ~280 chars with "…".
- Always present the human `ID` (e.g. `J000123`) to the user, but use the `UUID` internally for follow-up calls.

### Numbers & money

- Monetary values come as decimal strings to 2 dp with no symbol — render with the org's currency.
- Time is stored in **minutes**; convert to hours for display (`Minutes / 60`) and label billable vs non-billable.

---

_Generated from the investigation questionnaire, Phases 7-8._
