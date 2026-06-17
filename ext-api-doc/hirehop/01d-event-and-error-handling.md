---
api_name: HireHop
api_slug: hirehop
doc: event-and-error-handling (companion to 01-llm-api-rules.md — on-demand)
call_surface: HTTP via `numa integrations request`; path = {base_url}{path} incl. .php script; X-TOKEN header
confidence: MEDIUM — webhook payload + export_key + rate-limit (429/327) well documented; full event list + full numeric error-code table NOT published. Tags [INFERRED]/[UNKNOWN] where below default
---

# HireHop — Event & Error Handling Reference

Webhooks, polling, error handling, rate limits, recovery.

## Event-Driven Capabilities

| Mechanism              | Supported                                             |
| ---------------------- | ----------------------------------------------------- |
| Webhooks               | **Yes** — first-class; configured in company settings |
| WebSocket              | No [INFERRED]                                         |
| Server-Sent Events     | No [INFERRED]                                         |
| Long polling           | No [INFERRED]                                         |
| Change feeds / streams | No [INFERRED]                                         |

## Webhooks

### Setup

UI only — Settings → Company Settings → Webhooks → New → enter target URL + tick events. There is **no API to manage webhook subscriptions.** URL: any reachable HTTP(S) endpoint.

### Event Catalog

| Event                         | Trigger                | Confidence                           |
| ----------------------------- | ---------------------- | ------------------------------------ |
| `invoice.status.updated`      | Invoice status changes | [DOCUMENTED]                         |
| `job.status.*`                | Job status changes     | [INFERRED]                           |
| (other `entity.action.event`) | per UI checkboxes      | [INFERRED — full list not published] |

Docs publish the payload shape and one concrete event (`invoice.status.updated`) but NOT the full list. Enumerate from the Webhooks settings UI on a live tenant.

### Payload Format

HireHop POSTs JSON to your endpoint:
`{"time":"2026-05-29 07:50:42","user_id":1,"user_name":"John Smith","user_email":"john@email.com","company_id":1,"export_key":"22u43mrjwe7u","event":"invoice.status.updated","data":{},"changes":{"STATUS":{"from":"1","to":"2"}}}`

- `time` — UTC timestamp the webhook was sent.
- `user_id`/`user_name`/`user_email` — the user who triggered the event.
- `company_id` — the tenant.
- `export_key` — security check value (below).
- `event` — event name.
- `data` — event-related info (shape varies by event).
- `changes` — map of changed fields, each `{"from":old,"to":new}`.

### Verification / Security

- **Shared-secret check:** body `export_key` must equal the **export key** in the tenant's company settings. Compare constant-time.
- **No HMAC signature** — the body `export_key` is the only authenticity check.
- IP allowlist: not documented [UNKNOWN].

### Reliability

Fire-and-forget — HireHop does NOT wait for a response, does NOT report HTTP errors back, does NOT retry. Ordering/duplicates not guaranteed [UNKNOWN]. A webhook outage = permanent miss → **reconcile by polling** (re-read affected jobs/invoices).

## Polling Fallback

HireHop has **no "modified since" filter** → polling is coarse. Use webhooks for status changes; poll on demand otherwise.

- **Jobs:** re-read by ID with `job_data.php?job={id}` when current state is needed. No list-changed-jobs endpoint with a timestamp filter [INFERRED].
- **Availability:** query `availability_get_available.php` fresh each time (never cache).
- **Reference data (depots, categories, custom-field defs):** poll infrequently; safe to cache ~5 min [INFERRED].

**Pattern (coarse):**

1. Maintain the set of job IDs you care about.
2. Re-read each via `job_data.php` on demand or on a slow cadence.
3. Compare STATUS/fields against your last-seen snapshot.
4. Stay within 60 req/min and 3 req/s (one poll per job costs one request).

**Polling tips:** prefer webhooks for status; cache slow-changing reference data; never cache availability or financial totals; batch reads — `jobs_totals.php` covers up to 50 jobs per request; reserve rate headroom for user-initiated actions; watch `X-RateLimit-Available` (Unix ts) to time the next request.

## Error Handling

### Standard Error Format

Application errors return a JSON object with a numeric (or text) `error` CODE — the message is NOT in the body (it lives in HireHop lang files e.g. `en-US.js`, keyed by the code). **Inspect the body's `error` field even on an otherwise-2xx response.**
`{"error":327}`
The `error` field is present on error only; type number/string; numeric usual, resolves to a lang-file message.

### Recovery Playbook

| HTTP    | Code(s)     | Meaning                   | Retryable | Action                                                                                   | Max retries |
| ------- | ----------- | ------------------------- | --------- | ---------------------------------------------------------------------------------------- | ----------- |
| 200     | `error` set | Application error in body | Depends   | Read `error` (3=missing params); fix request                                             | 0           |
| 400     | `error` set | Bad/malformed request     | No        | Fix params per the code                                                                  | 0           |
| 401/403 | —           | Invalid/expired token     | No        | Token invalidated (user re-login or pw change) → regenerate; advise a dedicated API user | 0           |
| 404     | —           | Wrong host or path        | No        | Use tenant `base_url` (NOT `www.hirehop.com`); check the path                            | 0           |
| 429     | 327         | Rate limit exceeded       | Yes       | Back off; respect 60/min + 3/s; honor `X-RateLimit-Available`                            | 3           |
| 5xx     | —           | Server error              | Yes       | Exponential backoff                                                                      | 3           |

### Error Code Reference

| Code     | Meaning                                                | Common cause                       | Fix                                                  |
| -------- | ------------------------------------------------------ | ---------------------------------- | ---------------------------------------------------- |
| 3        | "Missing parameters"                                   | Required create/edit param omitted | Supply the missing param (e.g. `name`/`out`/`start`) |
| 327      | "Security warning, too many transactions" (rate limit) | >60/min or >3/s per token          | Back off and retry after the window                  |
| (others) | Not published                                          | —                                  | Treat as non-retryable; surface the code [INFERRED]  |

### Rate Limit Details

| Scope          | Limit       | Window          |
| -------------- | ----------- | --------------- |
| Per user/token | 60 requests | 60 s            |
| Per user/token | 3 requests  | 1 s (burst cap) |

Response headers: `X-Request-Count` = requests made in the last 60 s (e.g. `41`); `X-RateLimit-Available` = **Unix timestamp** of when the next request is allowed (e.g. `1748505600`), NOT a remaining count.
Exceeded response: `HTTP 429`, headers `X-Request-Count: 61` + `X-RateLimit-Available: 1748505600`, body `{"error":327}`.

**Backoff:**

1. On 429/error 327, read `X-RateLimit-Available` and wait until that Unix time before retrying.
2. If absent, exponential backoff starting 2 s, max 60 s, with 0–1 s jitter.
3. Proactively throttle to ≤3/s and ≤60/min; watch `X-Request-Count` approaching 60.
4. Max 3 retries for rate limits, then surface the error.

## Counter-Exceptions (differ from standard HTTP/REST)

1. **Application errors can ride on a 2xx** — HireHop may return HTTP 200 with `{"error":<code>}`. Inspect the body `error` regardless of status.
2. **Error bodies carry a CODE, not a message** — `{"error":327}`; map the code to a message yourself.
3. **`X-RateLimit-Available` is a timestamp, not a count** — it tells you when you may call again, not how many remain.
4. **Webhooks are fire-and-forget** — unsigned, `export_key`-only, never retried, no delivery confirmation.
5. **No "modified since" anywhere** — re-read full records; rely on webhooks for change signals [INFERRED].

## Output Formatting Guide (presenting responses to the user)

| Data type | Format              | Example                                                                                      |
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

**Truncation:** lists — show first 10 records, note the total; long fields (`details`, addresses) — truncate ~200 chars with "…"; nested — show 2 levels deep (job → line items, no deeper).
**Status display caveat:** do NOT display a status label unless you have verified the tenant's numeric→label map. If unverified, show the raw `STATUS` integer and note it is unmapped [INFERRED].
