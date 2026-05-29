---
api_name: 'Xero Accounting API'
api_slug: 'xero'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# Xero Accounting API -- Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Event-driven capabilities (webhooks + polling),
> rate limits with exact headers, the validation-error shape, and recovery playbooks.
> All `[DOCUMENTED]` from official Xero docs unless noted.

---

## Event-Driven Capabilities

| Mechanism                | Supported | Notes                                                                |
| ------------------------ | --------- | -------------------------------------------------------------------- |
| Webhooks                 | **yes**   | Invoice + Contact create/update only; HMAC-signed; ID-only payloads  |
| WebSocket                | no        | —                                                                    |
| Server-Sent Events (SSE) | no        | —                                                                    |
| Long polling             | no        | —                                                                    |
| Change feeds / streams   | partial   | `If-Modified-Since` + `UpdatedDateUTC` polling; Journals offset feed |

> The read-only Numa connector does **not** register webhooks (no Numa-hosted public,
> signature-validating endpoint is wired for Xero today). **Use polling.** The webhook
> section below is for reference / future use.

---

## Webhooks (reference)

### Setup

- **Registration method:** Xero developer portal UI, per app — set a delivery URL and get a **webhook signing key**.
- **URL requirements:** HTTPS, publicly reachable, must respond within **5 seconds** with `200`.
- **Activation handshake ("Intent to Receive"):** Xero posts a payload; you must validate the signature and respond `200` for a valid signature, `401` for an invalid one. A wrong response blocks activation.

### Event Catalog

| Event Name           | Trigger         | Key Payload Fields                                   |
| -------------------- | --------------- | ---------------------------------------------------- |
| `INVOICE` / `CREATE` | Invoice created | `resourceId` (InvoiceID), `tenantId`, `eventDateUtc` |
| `INVOICE` / `UPDATE` | Invoice updated | as above                                             |
| `CONTACT` / `CREATE` | Contact created | `resourceId` (ContactID), `tenantId`, `eventDateUtc` |
| `CONTACT` / `UPDATE` | Contact updated | as above                                             |

> Webhooks cover **Contacts and Invoices only**. Everything else (payments, bank
> transactions, accounts) requires polling.

### Payload Format

```json
{
  "events": [
    {
      "resourceUrl": "https://api.xero.com/api.xro/2.0/Invoices/297c2dc5-...",
      "resourceId": "297c2dc5-cc47-4afd-8ec8-74990b8761e9",
      "tenantId": "70784a63-d24b-46a9-a4db-0b70a274b056",
      "tenantType": "ORGANISATION",
      "eventCategory": "INVOICE",
      "eventType": "UPDATE",
      "eventDateUtc": "2026-05-29T03:14:00.000"
    }
  ],
  "firstEventSequence": 1,
  "lastEventSequence": 1,
  "entropy": "..."
}
```

> **Payloads are ID-only** — they tell you _what_ changed, not the new data. Call the
> `resourceUrl` (with the correct `Xero-tenant-id`) to fetch the actual record.

### Verification / Security

- **Signature header:** `x-xero-signature`
- **Algorithm:** HMAC-SHA256 over the **raw request body** using the webhook signing key, base64-encoded, constant-time compared.

```
1. Read x-xero-signature from the request headers.
2. Compute base64( HMAC-SHA256( raw_unparsed_body, webhook_signing_key ) ).
3. Constant-time compare. Match → 200; mismatch → 401.
   ⚠ Must use the RAW body — JSON re-serialisation changes bytes and breaks the HMAC.
```

### Reliability

- **Retries:** failed deliveries (non-200 or timeout) retried with backoff over ~24h, then the webhook is disabled.
- **Ordering:** `firstEventSequence`/`lastEventSequence` provided; not strictly guaranteed across retries.
- **Duplicates:** possible — design idempotent handlers (dedupe on `resourceId` + `eventDateUtc`).

---

## Polling Fallback (the actual strategy here)

### Recommended Approach

- **Endpoint:** the relevant list endpoint — `/Invoices`, `/Contacts`, `/Payments`, `/BankTransactions`.
- **Change detection:** `If-Modified-Since: {RFC1123 GMT}` header (preferred) or `where=UpdatedDateUTC>=DateTime(...)`. Change field is `UpdatedDateUTC`.
- **Interval:** comfortable at a few-minute cadence — budget is 60 calls/min/tenant.

### Polling Pattern

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

### Efficient Polling Tips

- Use `If-Modified-Since` rather than a heavy `where` — it doesn't consume `where` optimisation budget.
- Use `summaryOnly=true` on list pulls to shrink payloads; fetch full detail by id only when needed.
- Watch `X-MinLimit-Remaining` and slow down before hitting 0; spread multiple tenants across the minute to stay under the 10,000/min app ceiling.

---

## Rate Limits

| Scope               | Limit        | Window      | Notes              |
| ------------------- | ------------ | ----------- | ------------------ |
| Per tenant (minute) | 60 calls     | rolling 60s | per connected org  |
| Per tenant (day)    | 5,000 calls  | 24h         | per connected org  |
| Concurrent          | 5 in-flight  | —           | per tenant         |
| App-wide (minute)   | 10,000 calls | rolling 60s | across all tenants |

**Rate limit headers (on every response):**

| Header                    | Meaning                           | Example   |
| ------------------------- | --------------------------------- | --------- |
| `X-MinLimit-Remaining`    | calls left this minute (tenant)   | `58`      |
| `X-DayLimit-Remaining`    | calls left today (tenant)         | `4990`    |
| `X-AppMinLimit-Remaining` | calls left this minute (app-wide) | `9985`    |
| `Retry-After`             | seconds to wait (on 429 only)     | `1`       |
| `X-Rate-Limit-Problem`    | which limit was hit (on 429)      | `minute`  |
| `Xero-Correlation-Id`     | trace id for support tickets      | `8be4...` |

**Rate limit exceeded (429):**

```json
{
  "Type": null,
  "Title": "Rate limit exceeded",
  "Status": 429,
  "Detail": "The API rate limit for your application/organisation has been reached. The minute limit is 60. Please try again in 1 seconds."
}
```

**Backoff strategy:**

1. On 429, read `Retry-After` and sleep exactly that many seconds, then retry.
2. Check `X-Rate-Limit-Problem` (`minute` / `day` / `concurrent`) to decide whether to retry soon (minute), back off hard (day), or reduce parallelism (concurrent).
3. For 5xx, exponential backoff with jitter (e.g. 1s, 2s, 4s), max ~3 retries.
4. Proactively throttle when `X-MinLimit-Remaining` approaches 0.

---

## Error Handling

### Standard Validation Error Format

```json
{
  "ErrorNumber": 10,
  "Type": "ValidationException",
  "Message": "A validation exception occurred",
  "Elements": [
    {
      "InvoiceID": "00000000-0000-0000-0000-000000000000",
      "ValidationErrors": [{ "Message": "Invoice not of valid status for modification" }]
    }
  ]
}
```

**Error fields:**

| Field                           | Type   | Always Present? | Description                                |
| ------------------------------- | ------ | --------------- | ------------------------------------------ |
| `ErrorNumber`                   | int    | on validation   | Xero internal error number                 |
| `Type`                          | string | on validation   | e.g. `ValidationException`                 |
| `Message`                       | string | yes             | Human-readable summary                     |
| `Elements[]`                    | array  | on validation   | Per-item failures                          |
| `Elements[].ValidationErrors[]` | array  | on validation   | Field/business-rule messages for that item |

> For batch posts with `summarizeErrors=false`, each failed element carries its own
> `ValidationErrors[]` and a `StatusAttributeString` (partial success).

### Recovery Playbook

| HTTP Status | Meaning                                                    | Retryable?          | Recovery Action                                                                   | Max Retries |
| ----------- | ---------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------- | ----------- |
| 400         | Bad request / malformed `where`/`order`                    | No                  | Fix query syntax                                                                  | 0           |
| 401         | Expired/invalid token, OR missing/invalid `Xero-tenant-id` | Yes (after refresh) | Refresh token; verify tenant header; retry once. Still 401 → "reconnect required" | 1           |
| 403         | Forbidden — token lacks the required scope                 | No                  | Config issue (e.g. add `accounting.settings.read`); do not retry                  | 0           |
| 404         | Resource/record/tenant not found                           | No                  | Verify id + tenant                                                                | 0           |
| 405         | Method not allowed                                         | No                  | Wrong verb for resource (recall PUT=create, POST=upsert)                          | 0           |
| 412         | Precondition failed                                        | No                  | Check headers                                                                     | 0           |
| 429         | Rate limit exceeded                                        | Yes                 | Honour `Retry-After`; check `X-Rate-Limit-Problem`                                | 3           |
| 500         | Internal server error                                      | Yes                 | Backoff + retry; quote `Xero-Correlation-Id` in support                           | 3           |
| 503         | Service unavailable / throttling                           | Yes                 | Backoff + retry                                                                   | 3           |

### Retry Logic (pseudocode)

```
function callWithRetry(request, maxRetries=3):
    for attempt in 1..maxRetries:
        response = makeRequest(request)
        s = response.status

        if s in (200, 201):
            return response

        elif s == 401:
            # token expired OR tenant header problem
            refreshAccessToken()              # rotates + persists new refresh token
            ensureTenantHeader(request)
            continue                          # retry once

        elif s == 429:
            wait(seconds = response.header("Retry-After") or 1)
            continue

        elif s in (500, 503):
            wait(2 ** attempt + jitter)
            continue

        elif s == 403:
            raise ScopeError(response.body)   # do NOT retry — missing scope/config

        elif s == 400 or s == 404:
            raise ClientError(response.body)  # do NOT retry — fix the request

        else:
            raise ApiError(response)

    raise MaxRetriesExceeded()
```

---

## Counter-Exceptions

> Behaviours that differ from standard HTTP/REST conventions.

1. **403 means scope/config, not a transient block.**
   - Expected: 403 is sometimes a soft "try later".
   - Xero: 403 means the token lacks the scope (e.g. `/Accounts` without `accounting.settings.read`). Retrying never helps — fix the scope or stop calling that resource.

2. **A successful GET can still carry a per-element error.**
   - Expected: 200 = everything fine.
   - Xero (batch writes with `summarizeErrors=false`): the envelope is 200 but individual `Elements[]` may carry `ValidationErrors`. Always inspect elements on bulk operations.

3. **Rate limiting is 429 here (unlike MYOB's 403).**
   - If you also work with MYOB, note Xero correctly uses 429 + `Retry-After`; do not reuse MYOB's "inspect 403 body" logic.

4. **PUT vs POST verbs are inverted** (PUT=create, POST=upsert) — see 01c. A 405/duplicate is often a verb mistake.

---

## Output Formatting Guide

### Recommended Display Formats

| Data Type     | Format            | Example                                                                                           |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| Single record | Key-value summary | "INV-0042 — ABC Ltd, AUTHORISED, due 30 Jun 2024, $115.00 NZD"                                    |
| Record list   | Markdown table    | Columns: Number, Contact, Status, AmountDue, DueDate                                              |
| Dates         | Human-readable    | Parse `/Date(epoch+tz)/` or ISO `*UTC` → "30 Jun 2024"                                            |
| Currency      | Localized + code  | "$1,234.56 NZD" (use `CurrencyCode`; org base currency may differ)                                |
| Errors        | Clear message     | "Couldn't read the chart of accounts — this connector is read-only and lacks the settings scope." |

### Truncation Rules

- Lists: show the first ~25 records, then note the total from `Pagination.itemCount`.
- Always state which `tenantName`/org the figures came from when multiple orgs are connected.
- Money totals: if you only fetched some pages, say so — don't imply a complete total from page 1.

---

## Idempotency (recap)

- Create endpoints accept `Idempotency-Key` (~24h window) — send a unique key per logical create to make retries safe (see 01c).
- GET is naturally idempotent. POST is **not** without the key (POST upserts). DELETE is N/A (deletes are status changes).

---

_Generated from the investigation questionnaire, Phases 7-8. Webhook specifics (exact retry
schedule) and live response envelopes are documented but not captured against a real token._
