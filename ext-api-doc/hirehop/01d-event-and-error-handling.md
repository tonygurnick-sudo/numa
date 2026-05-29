---
api_name: 'HireHop'
api_slug: 'hirehop'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# HireHop -- Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Event-driven capabilities (webhooks, polling),
> error handling, rate limits, and recovery playbooks.
>
> **Confidence: MEDIUM.** Webhook payload + `export_key` + rate-limit (429/327) are well
> documented; the full event list and full numeric error-code table are NOT published.
> Tags: `[DOCUMENTED]`, `[INFERRED]`, `[UNKNOWN]`.

---

## Event-Driven Capabilities

| Mechanism                | Supported | Notes                                                    |
| ------------------------ | --------- | -------------------------------------------------------- |
| Webhooks                 | **Yes**   | First-class; configured in company settings [DOCUMENTED] |
| WebSocket                | No        | [INFERRED]                                               |
| Server-Sent Events (SSE) | No        | [INFERRED]                                               |
| Long polling             | No        | [INFERRED]                                               |
| Change feeds / streams   | No        | [INFERRED]                                               |

---

## Webhooks

### Setup

- **Registration method:** **UI only** — Settings → Company Settings → Webhooks → New → enter target URL + tick the events to subscribe to. [DOCUMENTED]
- **Registration endpoint:** none — there is **no API to manage webhook subscriptions.** [DOCUMENTED]
- **URL requirements:** a reachable HTTP(S) endpoint. [DOCUMENTED]

### Event Catalog

| Event Name                    | Trigger                | Key Payload Fields                           | Confidence                           |
| ----------------------------- | ---------------------- | -------------------------------------------- | ------------------------------------ |
| `invoice.status.updated`      | Invoice status changes | `event`, `data`, `changes.{FIELD}.{from,to}` | [DOCUMENTED]                         |
| `job.status.*`                | Job status changes     | same envelope                                | [INFERRED]                           |
| (other `entity.action.event`) | per UI checkboxes      | same envelope                                | [INFERRED — full list not published] |

> The docs publish the **payload shape** and one concrete event (`invoice.status.updated`) but NOT the full event list. Enumerate it from the Webhooks settings UI on a live tenant. [DOCUMENTED / discovery needed]

### Payload Format [DOCUMENTED]

HireHop POSTs JSON to your endpoint:

```json
{
  "time": "2026-05-29 07:50:42",
  "user_id": 1,
  "user_name": "John Smith",
  "user_email": "john@email.com",
  "company_id": 1,
  "export_key": "22u43mrjwe7u",
  "event": "invoice.status.updated",
  "data": {},
  "changes": {
    "STATUS": { "from": "1", "to": "2" }
  }
}
```

- `time` — UTC timestamp the webhook was sent.
- `user_id` / `user_name` / `user_email` — the user who triggered the event.
- `company_id` — the tenant.
- `export_key` — security check value (see below).
- `event` — the event name.
- `data` — event-related info (shape varies by event).
- `changes` — map of changed fields, each `{ "from": old, "to": new }`. [DOCUMENTED]

### Verification / Security

- **Shared-secret check:** the body `export_key` must equal the **export key** in the tenant's company settings. Verify it to authenticate the sender. [DOCUMENTED]
- **Signature header:** **none** — there is NO HMAC signature. The body `export_key` is the only check. Compare it with a constant-time string comparison. [DOCUMENTED]
- **IP allowlist:** not documented. [UNKNOWN]

### Reliability

- **Retry policy:** **none.** HireHop does NOT wait for a response, does NOT report HTTP errors back, and does NOT retry — fire-and-forget. [DOCUMENTED]
- **Ordering / duplicates:** not guaranteed / not documented. [UNKNOWN]
- **Consequence:** a webhook outage = permanent miss. **Reconcile by polling** (re-read affected jobs/invoices). [DOCUMENTED]

---

## WebSocket / SSE

Not supported. [INFERRED]

---

## Polling Fallback

> HireHop has **no "modified since" filter**, so polling is coarse. Use webhooks for status changes; poll on demand otherwise.

### Recommended Approach

- **Jobs:** re-read by ID with `job_data.php?job={id}` when you need current state. There is no list-changed-jobs endpoint with a timestamp filter. [INFERRED]
- **Availability:** query `availability_get_available.php` fresh each time (never cache). [DOCUMENTED]
- **Reference data (depots, categories, custom-field defs):** poll infrequently; safe to cache ~5 min. [INFERRED]

### Polling Pattern (coarse)

```
1. Maintain the set of job IDs you care about.
2. Re-read each via job_data.php on demand or on a slow cadence.
3. Compare STATUS / fields against your last-seen snapshot.
4. Stay within 60 req/min and 3 req/s (one poll per job costs one request).
```

### Rate-Limit Budget for Polling [DOCUMENTED]

- Hard caps: 60 requests / 60 s AND 3 requests / s per user.
- Reserve headroom for user-initiated actions — do not consume the whole budget polling.
- Watch `X-RateLimit-Available` (a Unix timestamp) to time the next request.

### Efficient Polling Tips

- Prefer webhooks for status changes; poll only what webhooks can't cover.
- Cache slow-changing reference data (depots, categories, custom-field defs).
- Never cache availability or financial totals.
- Batch reads logically; a `jobs_totals.php` call covers up to 50 jobs in one request. [DOCUMENTED]

---

## Error Handling

### Standard Error Response Format [DOCUMENTED]

Application errors return a JSON object with a numeric (or text) `error` code. The human-readable _message_ is NOT in the body — it lives in HireHop language files (e.g. `en-US.js`) keyed by the code. **Inspect the body's `error` field even on an otherwise-2xx response.**

```json
{ "error": 327 }
```

### Error Field Summary

| Field | Type          | Always Present? | Description                                                         |
| ----- | ------------- | --------------- | ------------------------------------------------------------------- |
| error | number/string | on error        | HireHop error code (numeric usual; resolves to a lang-file message) |

### Recovery Playbook

| HTTP Status | Error Code(s) | Meaning                   | Retryable? | Recovery Action                                                                          | Max Retries |
| ----------- | ------------- | ------------------------- | ---------- | ---------------------------------------------------------------------------------------- | ----------- |
| 200         | `error` set   | Application error in body | Depends    | Read `error` (3 = missing params); fix the request                                       | 0           |
| 400         | `error` set   | Bad/malformed request     | No         | Fix params per the code                                                                  | 0           |
| 401 / 403   | —             | Invalid/expired token     | No         | Token invalidated (user re-login or pw change) → regenerate; advise a dedicated API user | 0           |
| 404         | —             | Wrong host or path        | No         | Use the tenant `base_url` (NOT `www.hirehop.com`); check the path                        | 0           |
| 429         | 327           | Rate limit exceeded       | Yes        | Back off; respect 60/min + 3/s; honor `X-RateLimit-Available`                            | 3           |
| 5xx         | —             | Server error              | Yes        | Retry with exponential backoff                                                           | 3           |

### Error Code Reference

| Error Code | Meaning                                                | Common Cause                       | Fix                                                               |
| ---------- | ------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------- |
| 3          | "Missing parameters"                                   | Required create/edit param omitted | Supply the missing param (e.g. `name`/`out`/`start`) [DOCUMENTED] |
| 327        | "Security warning, too many transactions" (rate limit) | >60/min or >3/s per token          | Back off and retry after the window [DOCUMENTED]                  |
| (others)   | Not published                                          | —                                  | Treat as non-retryable; surface the code [INFERRED]               |

> The complete numeric error-code table is not published — 3 and 327 are the documented ones. Treat unknown codes as non-retryable and surface them to the user. [DOCUMENTED / INFERRED]

### Rate Limit Details [DOCUMENTED]

| Scope    | Limit       | Window | Notes     |
| -------- | ----------- | ------ | --------- |
| Per user | 60 requests | 60 s   | Per token |
| Per user | 3 requests  | 1 s    | Burst cap |

**Rate limit headers (on responses):**

| Header                  | Meaning                                                | Example      |
| ----------------------- | ------------------------------------------------------ | ------------ |
| `X-Request-Count`       | Requests made in the last 60 s                         | `41`         |
| `X-RateLimit-Available` | **Unix timestamp** of when the next request is allowed | `1748505600` |

**Rate-limit exceeded response:**

```
HTTP/1.1 429 Too Many Requests
X-Request-Count: 61
X-RateLimit-Available: 1748505600
```

```json
{ "error": 327 }
```

**Backoff strategy:**

1. On 429 / error 327, read `X-RateLimit-Available` and wait until that Unix time before retrying.
2. If absent, exponential backoff starting at 2 s, max 60 s, with 0–1 s jitter.
3. Proactively throttle to ≤3/s and ≤60/min; watch `X-Request-Count` approaching 60.
4. Max 3 retries for rate limits, then surface the error.

---

## Counter-Exceptions

> Behaviors that differ from standard HTTP/REST conventions.

1. **Application errors can ride on a 2xx.** HireHop may return HTTP 200 with `{"error": <code>}` in the body.
   - Standard: errors use 4xx/5xx status.
   - Actual: inspect the body `error` field regardless of status. [DOCUMENTED]

2. **Error bodies carry a CODE, not a message.** The text lives in language files; the body is just the number.
   - Standard: `{"message": "..."}`.
   - Actual: `{"error": 327}` — map the code to a message yourself. [DOCUMENTED]

3. **`X-RateLimit-Available` is a timestamp, not a count.** Many APIs expose "remaining"; HireHop exposes "when you may call again".
   - Standard: remaining-requests integer.
   - Actual: a Unix timestamp. [DOCUMENTED]

4. **Webhooks are fire-and-forget.** No retry, no delivery confirmation, no signature.
   - Standard: signed payloads with retry/backoff.
   - Actual: unsigned, `export_key`-only, never retried. [DOCUMENTED]

5. **No "modified since" anywhere.** Polling cannot be incremental.
   - Standard: `updated_at` / `If-Modified-Since` filters.
   - Actual: re-read full records; rely on webhooks for change signals. [INFERRED]

---

## Output Formatting Guide

> How to present HireHop responses to the user in the workspace agent.

### Recommended Display Formats

| Data Type | Format              | Example                                                                                      |
| --------- | ------------------- | -------------------------------------------------------------------------------------------- |
| Job       | Summary line        | "Job #52: Summer Festival Main Stage — Booked, Main Depot, 10–15 Jun"                        |
| Line item | Title + qty + price | "LED Par 64 ×4 — £180.00 (weekly)"                                                           |
| Depot     | Name                | "Main Depot"                                                                                 |
| Contact   | Company name        | "Acme Events Ltd (#1023)"                                                                    |
| Margins   | Revenue/cost/%      | "Revenue £1,850 · Cost £720 · Margin £1,130 (61%)"                                           |
| Dates     | Human-readable      | "10 June 2026, 8:00 AM"                                                                      |
| Currency  | Localized + symbol  | "£1,850.00" (use the job's CURRENCY.SYMBOL)                                                  |
| Status    | Label + colour      | "[Booked]" (label requires the verified status map)                                          |
| Errors    | Clear message       | "Could not save the job: missing required parameter (error 3). Supply name, out, and start." |

### Truncation Rules

- Lists: show first 10 records, note the total.
- Long fields (`details`, addresses): truncate at ~200 chars with "…".
- Nested records: show 2 levels deep (job → line items, not deeper nesting).

### Status Display Caveat

Do NOT display a status label unless you have verified the tenant's numeric→label map. If unverified, show the raw `STATUS` integer and note it is unmapped. [INFERRED]

---

_Generated from the investigation questionnaire (Phases 7-8) + official HireHop docs. NOT live-tested._
