---
api_name: Xero Accounting API
api_slug: xero
companion_to: 01-llm-api-rules.md
content: event-driven capabilities (webhooks + polling), rate limits with exact headers, validation-error shape, recovery playbooks
confidence: all [DOCUMENTED] from official Xero docs unless noted; webhook retry schedule + live response envelopes not captured against a real token
---

# Xero — Event & Error Handling Reference

## Event-Driven Capabilities

| Mechanism              | Supported | Notes                                                                |
| ---------------------- | --------- | -------------------------------------------------------------------- |
| Webhooks               | **yes**   | Invoice + Contact create/update only; HMAC-signed; ID-only payloads  |
| WebSocket              | no        | —                                                                    |
| Server-Sent Events     | no        | —                                                                    |
| Long polling           | no        | —                                                                    |
| Change feeds / streams | partial   | `If-Modified-Since` + `UpdatedDateUTC` polling; Journals offset feed |

> The read-only Numa connector does **not** register webhooks (no Numa-hosted public, signature-validating endpoint is wired for Xero today). **Use polling.** The webhook section below is reference / future use.

## Webhooks (reference)

### Setup

- Registration: Xero developer portal UI, per app — set a delivery URL, get a **webhook signing key**.
- URL requirements: HTTPS, publicly reachable, must respond within **5 seconds** with `200`.
- Activation handshake ("Intent to Receive"): Xero posts a payload; validate the signature, respond `200` for valid, `401` for invalid. Wrong response blocks activation.

### Event Catalog

Webhooks cover **Contacts and Invoices only**. Everything else (payments, bank transactions, accounts) requires polling.

| Event              | Trigger         | Key payload fields                                   |
| ------------------ | --------------- | ---------------------------------------------------- |
| `INVOICE`/`CREATE` | invoice created | `resourceId` (InvoiceID), `tenantId`, `eventDateUtc` |
| `INVOICE`/`UPDATE` | invoice updated | as above                                             |
| `CONTACT`/`CREATE` | contact created | `resourceId` (ContactID), `tenantId`, `eventDateUtc` |
| `CONTACT`/`UPDATE` | contact updated | as above                                             |

### Payload Format (ID-only)

`{"events":[{"resourceUrl":"https://api.xero.com/api.xro/2.0/Invoices/297c2dc5-...","resourceId":"297c2dc5-cc47-4afd-8ec8-74990b8761e9","tenantId":"70784a63-d24b-46a9-a4db-0b70a274b056","tenantType":"ORGANISATION","eventCategory":"INVOICE","eventType":"UPDATE","eventDateUtc":"2026-05-29T03:14:00.000"}],"firstEventSequence":1,"lastEventSequence":1,"entropy":"..."}`

> Payloads are ID-only — they tell you _what_ changed, not the new data. Call the `resourceUrl` (with the correct `Xero-tenant-id`) to fetch the actual record.

### Verification / Security

- Signature header: `x-xero-signature`.
- Algorithm: HMAC-SHA256 over the **raw request body** using the webhook signing key, base64-encoded, constant-time compared.

```
1. Read x-xero-signature from request headers.
2. Compute base64( HMAC-SHA256( raw_unparsed_body, webhook_signing_key ) ).
3. Constant-time compare. Match → 200; mismatch → 401.
   ⚠ Must use the RAW body — JSON re-serialisation changes bytes and breaks the HMAC.
```

### Reliability

- Retries: failed deliveries (non-200 or timeout) retried with backoff over ~24h, then the webhook is disabled.
- Ordering: `firstEventSequence`/`lastEventSequence` provided; not strictly guaranteed across retries.
- Duplicates: possible — design idempotent handlers (dedupe on `resourceId` + `eventDateUtc`).

## Polling Fallback (the actual strategy here)

- Endpoint: the relevant list endpoint — `/Invoices`, `/Contacts`, `/Payments`, `/BankTransactions`.
- Change detection: `If-Modified-Since: {RFC1123 GMT}` header (preferred) or `where=UpdatedDateUTC>=DateTime(...)`. Change field `UpdatedDateUTC`.
- Interval: comfortable at a few-minute cadence — budget is 60 calls/min/tenant.

Pattern:

```
1. last_sync = stored cursor (RFC1123), else epoch.
2. For each resource (Invoices, Contacts, Payments, BankTransactions):
     page = 1
     repeat:
       GET /api.xro/2.0/{Resource}?page={page}
         Header: If-Modified-Since: {last_sync}
         Header: Xero-tenant-id: {tenantId}
       process items
       page += 1
     until page > Pagination.pageCount
3. last_sync = max(UpdatedDateUTC) seen, formatted RFC1123.
```

Tips: prefer `If-Modified-Since` over a heavy `where` (doesn't consume `where` optimisation budget). `summaryOnly=true` shrinks payloads; fetch full detail by id only when needed. Watch `X-MinLimit-Remaining` and slow before 0; spread multiple tenants across the minute to stay under the 10,000/min app ceiling.

## Rate Limits

| Scope               | Limit        | Window      | Notes              |
| ------------------- | ------------ | ----------- | ------------------ |
| Per tenant (minute) | 60 calls     | rolling 60s | per connected org  |
| Per tenant (day)    | 5,000 calls  | 24h         | per connected org  |
| Concurrent          | 5 in-flight  | —           | per tenant         |
| App-wide (minute)   | 10,000 calls | rolling 60s | across all tenants |

Headers (on every response):
| Header | Meaning | Example |
| --- | --- | --- |
| `X-MinLimit-Remaining` | calls left this minute (tenant) | `58` |
| `X-DayLimit-Remaining` | calls left today (tenant) | `4990` |
| `X-AppMinLimit-Remaining` | calls left this minute (app-wide) | `9985` |
| `Retry-After` | seconds to wait (on 429 only) | `1` |
| `X-Rate-Limit-Problem` | which limit was hit (on 429): `minute`/`day`/`concurrent` | `minute` |
| `Xero-Correlation-Id` | trace id for support tickets | `8be4...` |

429 body: `{"Type":null,"Title":"Rate limit exceeded","Status":429,"Detail":"The API rate limit for your application/organisation has been reached. The minute limit is 60. Please try again in 1 seconds."}`

Backoff: (1) on 429, read `Retry-After`, sleep exactly that many seconds, retry. (2) check `X-Rate-Limit-Problem` — `minute` retry soon, `day` back off hard, `concurrent` reduce parallelism. (3) 5xx: exponential backoff + jitter (1s,2s,4s), max ~3 retries. (4) throttle proactively as `X-MinLimit-Remaining` approaches 0.

## Error Handling

Validation error format:
`{"ErrorNumber":10,"Type":"ValidationException","Message":"A validation exception occurred","Elements":[{"InvoiceID":"00000000-0000-0000-0000-000000000000","ValidationErrors":[{"Message":"Invoice not of valid status for modification"}]}]}`

| Field                           | Type   | Always present? | Description                                |
| ------------------------------- | ------ | --------------- | ------------------------------------------ |
| `ErrorNumber`                   | int    | on validation   | Xero internal error number                 |
| `Type`                          | string | on validation   | e.g. `ValidationException`                 |
| `Message`                       | string | yes             | human-readable summary                     |
| `Elements[]`                    | array  | on validation   | per-item failures                          |
| `Elements[].ValidationErrors[]` | array  | on validation   | field/business-rule messages for that item |

> For batch posts with `summarizeErrors=false`, each failed element carries its own `ValidationErrors[]` and a `StatusAttributeString` (partial success).

### Recovery Playbook

| Status | Meaning                                                   | Retryable?          | Recovery                                                                          | Max retries |
| ------ | --------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------- | ----------- |
| 400    | bad request / malformed `where`/`order`                   | No                  | fix query syntax                                                                  | 0           |
| 401    | expired/invalid token OR missing/invalid `Xero-tenant-id` | Yes (after refresh) | refresh token; verify tenant header; retry once. Still 401 → "reconnect required" | 1           |
| 403    | forbidden — token lacks the required scope                | No                  | config issue (e.g. add `accounting.settings.read`); do not retry                  | 0           |
| 404    | resource/record/tenant not found                          | No                  | verify id + tenant                                                                | 0           |
| 405    | method not allowed                                        | No                  | wrong verb (recall PUT=create, POST=upsert)                                       | 0           |
| 412    | precondition failed                                       | No                  | check headers                                                                     | 0           |
| 429    | rate limit exceeded                                       | Yes                 | honour `Retry-After`; check `X-Rate-Limit-Problem`                                | 3           |
| 500    | internal server error                                     | Yes                 | backoff + retry; quote `Xero-Correlation-Id`                                      | 3           |
| 503    | service unavailable / throttling                          | Yes                 | backoff + retry                                                                   | 3           |

Retry logic:

```
function callWithRetry(request, maxRetries=3):
    for attempt in 1..maxRetries:
        response = makeRequest(request); s = response.status
        if s in (200, 201): return response
        elif s == 401:                       # token expired OR tenant header problem
            refreshAccessToken()             # rotates + persists new refresh token
            ensureTenantHeader(request); continue   # retry once
        elif s == 429:
            wait(seconds = response.header("Retry-After") or 1); continue
        elif s in (500, 503):
            wait(2 ** attempt + jitter); continue
        elif s == 403: raise ScopeError(response.body)    # do NOT retry — missing scope/config
        elif s == 400 or s == 404: raise ClientError(response.body)  # do NOT retry — fix the request
        else: raise ApiError(response)
    raise MaxRetriesExceeded()
```

## Counter-Exceptions (differ from standard HTTP/REST)

1. **403 = scope/config, not a transient block.** Retrying never helps — fix the scope (e.g. `/Accounts` without `accounting.settings.read`) or stop calling that resource.
2. **A successful GET can still carry a per-element error.** Batch writes with `summarizeErrors=false`: envelope is 200 but individual `Elements[]` may carry `ValidationErrors`. Always inspect elements on bulk operations.
3. **Rate limiting is 429 here (unlike MYOB's 403).** Xero correctly uses 429 + `Retry-After`; don't reuse MYOB's "inspect 403 body" logic.
4. **PUT vs POST verbs are inverted** (PUT=create, POST=upsert) — see 01c. A 405/duplicate is often a verb mistake.

## Output Formatting Guide

| Data type     | Format            | Example                                                                                           |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| Single record | key-value summary | "INV-0042 — ABC Ltd, AUTHORISED, due 30 Jun 2024, $115.00 NZD"                                    |
| Record list   | markdown table    | columns: Number, Contact, Status, AmountDue, DueDate                                              |
| Dates         | human-readable    | parse `/Date(epoch+tz)/` or ISO `*UTC` → "30 Jun 2024"                                            |
| Currency      | localized + code  | "$1,234.56 NZD" (use `CurrencyCode`; org base currency may differ)                                |
| Errors        | clear message     | "Couldn't read the chart of accounts — this connector is read-only and lacks the settings scope." |

Truncation: show first ~25 records, then note total from `Pagination.itemCount`. When multiple orgs connected, always state which `tenantName`/org figures came from. Money totals: if you only fetched some pages, say so — don't imply a complete total from page 1.

## Idempotency (recap)

Create endpoints accept `Idempotency-Key` (~24h window) — unique key per logical create makes retries safe (see 01c). GET is naturally idempotent. POST is **not** without the key (POST upserts). DELETE is N/A (deletes are status changes).
