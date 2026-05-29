# Event & Error Handling — QuickBooks Online Accounting API (v3)

> Webhooks, Change Data Capture, the universal `Fault` envelope, error catalogue, retry logic.
> `[DOCUMENTED]` from Intuit docs unless marked. No `[CONFIRMED]` live calls — verify rate-limit header behaviour and edge-case shapes against a sandbox.

---

## 1. Webhooks

**Status: SUPPORTED — but configured per-app in the Intuit Developer portal, not at runtime.**

You cannot subscribe/unsubscribe through the API. An app owner sets a notification endpoint URL + selects entities/operations in the portal. For the workspace agent, **prefer CDC polling** (Section 3) — it's runtime-controllable and returns full objects.

### What webhooks deliver

A thin notification — **id + operation only, never the full entity**:

```json
{
  "eventNotifications": [
    {
      "realmId": "4620816365212402417",
      "dataChangeEvent": {
        "entities": [
          { "name": "Invoice", "id": "130", "operation": "Update", "lastUpdated": "2026-05-29T10:05:00-07:00" }
        ]
      }
    }
  ]
}
```

On receipt, **query the entity by id** to get current state (`GET /invoice/130`).

### Event catalogue (operations per entity)

| Entity (subset)                                                                                                     | Operations                   |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `Customer`, `Vendor`, `Item`, `Account`                                                                             | Create, Update, (Merge)      |
| `Invoice`, `Bill`, `Payment`, `BillPayment`, `Estimate`, `CreditMemo`                                               | Create, Update, Delete, Void |
| `JournalEntry`, `Purchase`, `PurchaseOrder`, `SalesReceipt`, `RefundReceipt`, `Deposit`, `Transfer`, `TimeActivity` | Create, Update, Delete       |

### Verification (if you receive webhooks)

- Signature header: **`intuit-signature`**.
- Algorithm: **HMAC-SHA256 of the raw request body** using the app's **verifier token** (from the portal) as the key; base64-encode and constant-time compare to the header value.
- HTTPS endpoint required; respond `200` quickly. Failures are retried with backoff.

### Reliability

- **No ordering guarantee** — treat events as "something changed, go fetch", not as an ordered log.
- **Duplicate delivery possible** — handlers must be idempotent.
- Events may be batched/coalesced.

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks

---

## 2. WebSocket / SSE

Not supported. REST only.

---

## 3. Change Data Capture (CDC) — the polling workhorse

CDC returns **full objects** for everything changed since a timestamp, across multiple entity types, in **one call**. This is the recommended change-detection mechanism for the agent.

```http
GET /v3/company/{realmId}/cdc?entities=Invoice,Customer,Bill,Payment,Item&changedSince=2026-05-28T00:00:00-07:00&minorversion=75
Accept: application/json
```

**Response (shape):**

```json
{
  "CDCResponse": [
    {
      "QueryResponse": [
        {
          "Invoice": [{ "Id": "130", "SyncToken": "1", "Balance": 0, "...": "..." }],
          "startPosition": 1,
          "maxResults": 1
        }
      ]
    }
  ],
  "time": "2026-05-29T10:00:00.000-07:00"
}
```

- `entities` = comma-separated list (any of the queryable entities).
- `changedSince` = ISO 8601 datetime; reaches up to **~30 days** back.
- Deletes appear with a status/`Deleted` marker rather than a normal entity body — handle the deleted case.
- One CDC call is far cheaper than per-entity polling against the 500/min budget.

**Per-entity alternative** (single stream):

```
SELECT * FROM Invoice WHERE MetaData.LastUpdatedTime > '2026-05-28T00:00:00-07:00' ORDER BY MetaData.LastUpdatedTime ASC
```

Save the last `LastUpdatedTime` as the next cursor.

**Polling cadence:** every few minutes is plenty for most realms; stay well within 500/min. Change-detection fields: `MetaData.LastUpdatedTime`, `SyncToken`.

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/develop/explore-the-quickbooks-online-api/change-data-capture

---

## 4. Error response format — the `Fault` envelope

**Every** QBO error uses the same shape:

```json
{
  "Fault": {
    "Error": [
      {
        "Message": "Stale Object Error",
        "Detail": "Stale Object Error : You and someone else were working on this at the same time...",
        "code": "5010",
        "element": "SyncToken"
      }
    ],
    "type": "ValidationFault"
  },
  "time": "2026-05-29T10:00:00.000-07:00"
}
```

- `Fault.Error[]` — one or more errors, each with `Message`, `Detail`, `code`, and an optional `element` naming the offending field.
- `Fault.type` ∈ `ValidationFault | AuthenticationFault | AuthorizationFault | SystemFault`.
- **Parse `code`, not just the HTTP status** — most validation failures return **HTTP 400** regardless of cause.

[DOCUMENTED]

---

## 5. HTTP status reference

| Status  | Meaning                                         | Action                                                          |
| ------- | ----------------------------------------------- | --------------------------------------------------------------- |
| 200     | Success (read & write)                          | Process response (`{ "<Entity>": {...}, "time": "..." }`)       |
| 400     | Bad request / validation                        | Read `Fault.Error[].code` — fix payload/query. Usually no retry |
| 401     | Unauthorized (`AuthenticationFault`, code 3200) | Refresh access token (relay), retry once                        |
| 403     | Forbidden (`AuthorizationFault`)                | Insufficient scope / wrong realm. Re-consent. Do not retry      |
| 404     | Not found                                       | Verify the id/path; for entity reads prefer error 610 via query |
| 429     | Throttled (`ThrottleExceeded`, code 003001)     | Exponential backoff + jitter; cap parallelism at 10             |
| 500/503 | `SystemFault`                                   | Retry with exponential backoff; check status page               |

> ⚠️ **Validation errors are HTTP 400, not 422.** Distinguish by `Fault.type` + `code`.

[DOCUMENTED]

---

## 6. Error catalogue (commonly hit)

| Code      | HTTP    | `Fault.type`        | Meaning                           | Retryable?    | Recovery                                           |
| --------- | ------- | ------------------- | --------------------------------- | ------------- | -------------------------------------------------- |
| 4000/4001 | 400     | ValidationFault     | Malformed query / parse error     | No            | Fix the SELECT / JSON                              |
| 2010      | 400     | ValidationFault     | Required param/field missing      | No            | Add the missing field                              |
| 6240      | 400     | ValidationFault     | Duplicate Name Exists             | No            | Use a unique `DisplayName`/`Name`; query first     |
| 5010      | 400     | ValidationFault     | Stale Object (SyncToken mismatch) | After refetch | GET latest, copy fresh `SyncToken`, retry once     |
| 610       | 400     | ValidationFault     | Object Not Found                  | No            | Verify the id exists in this realm                 |
| 3200      | 401     | AuthenticationFault | Token expired / invalid           | Yes           | Refresh access token (relay), retry once           |
| —         | 403     | AuthorizationFault  | Insufficient scope / wrong realm  | No            | Re-consent with correct scope; check realmId       |
| 003001    | 429     | ValidationFault     | ThrottleExceeded                  | Yes           | Backoff + jitter, retry                            |
| —         | 500/503 | SystemFault         | Service issue                     | Yes           | Backoff + retry; check status.developer.intuit.com |

**Throttle (429) body:**

```json
{
  "Fault": {
    "Error": [
      { "Message": "ThrottleExceeded", "Detail": "You have exceeded the number of allowed requests.", "code": "003001" }
    ],
    "type": "ValidationFault"
  },
  "time": "2026-05-29T10:00:00.000-07:00"
}
```

[DOCUMENTED]

---

## 7. Rate limits

| Scope                       | Limit         | Window     | Notes                        |
| --------------------------- | ------------- | ---------- | ---------------------------- |
| Per company (realmId)       | 500 requests  | per minute | Primary throttle             |
| Concurrent requests / realm | 10 in flight  | —          | 11th concurrent → throttled  |
| Batch endpoint / realm      | 120 requests  | per minute | Raised from 40 on 2025-10-31 |
| Reports / heavy endpoints   | ~200 requests | per minute | Lower than the global 500    |

- **No reliable `X-RateLimit-*` headers** and generally **no `Retry-After`** — detect via the 429 response and back off client-side. `intuit_tid` (transaction id) is present on responses — quote it in any support escalation. [INFERRED on header behaviour — verify empirically]

[DOCUMENTED]/[INFERRED] — Intuit help KB + 2026 third-party guides (Coefficient, Satva, Truto).

---

## 8. Retry logic

```
function callWithRetry(request, maxRetries=4):
    for attempt in 1..maxRetries:
        response = makeRequest(request)        # via Numa connect_request relay

        if response.status in (200,):
            return response

        fault = parseJSON(response.body).Fault   # may be null on non-API errors

        if response.status == 401:               # token expired
            relay.refreshAccessToken()           # relay persists the rotated refresh_token
            continue                             # retry once with new token

        if response.status == 429 or response.status >= 500:
            wait( min(2^attempt, 30) seconds + jitter )   # cap parallelism at 10
            continue

        if response.status == 400 and fault.Error[0].code == "5010":
            entity = GET(request.entityUrl)      # refetch for fresh SyncToken
            request.body.SyncToken = entity.SyncToken
            continue                             # retry once

        if response.status in (400, 403, 404):
            raise NonRetryable(fault)            # fix payload/scope/id — do not retry

    raise MaxRetriesExceeded()
```

**Do NOT retry:** 400 validation (`2010`, `6240`, `4001`, `610`), 403 authorization, 404. Retrying won't help — fix the cause.

**DO retry (with backoff):** 401 (after refresh, once), 429, 5xx, and 5010 (after refetching `SyncToken`, once).

---

## 9. Idempotency

- **Write idempotency:** pass `?requestid={uuid}` on create POSTs. A retried request with the same `requestid` is deduped instead of creating a duplicate. Treat the window as short/best-effort. [DOCUMENTED]
- **Updates** (POST with `Id` + `SyncToken`) are effectively idempotent: the SyncToken lock means a replayed update either succeeds once or fails 5010, never double-applies.
- **Deletes/voids** are idempotent in effect (a second delete of a gone record errors, not double-deletes).
- **Webhook/CDC handlers must be idempotent** — duplicate and out-of-order delivery are both possible.

---

## 10. Output formatting notes

### Dates

- API returns dates as `YYYY-MM-DD` (`TxnDate`, `DueDate`) and datetimes as `YYYY-MM-DDThh:mm:ss±hh:mm` (`MetaData.*`).
- In query filters, quote them: `WHERE TxnDate >= '2026-01-01'`, `WHERE MetaData.LastUpdatedTime > '2026-05-28T00:00:00-07:00'`.
- Datetimes carry the **realm's timezone offset** — don't assume UTC; preserve the offset for cursors.

### Currency

- Amounts are plain decimals (2 dp), **no symbol**. Base currency comes from the realm (`companyinfo`/`preferences`).
- `CurrencyRef` only applies when multicurrency is enabled.

### Ids & refs

- All ids are numeric **strings** (`"58"`), unique within a realm — not globally unique. The same id can exist in a different realm meaning a different record.
- References are `{"value":"<id>"}`. Only `value` matters on write; `name` is echoed back, not authoritative.

### Paid/unpaid

- There is no explicit paid-status field on Invoice/Bill — derive from `Balance` (0 = paid, `Balance == TotalAmt` = nothing paid, in-between = partial). `EmailStatus` is unrelated to payment.

---

## 11. Counter-exceptions — when behaviour surprises you

| Scenario                                     | Reality                                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Update "succeeded" but other fields are gone | You did a non-sparse update and omitted them — they were cleared. Use `"sparse": true`.      |
| Empty query returns no array                 | `"QueryResponse": {}` with the entity key absent — check for the key, don't index blindly.   |
| 401 right after a successful call            | Access token expired mid-session (1h). Relay should refresh + retry transparently.           |
| Next refresh fails `invalid_grant`           | The rotated `refresh_token` from the previous refresh wasn't persisted. Re-auth the company. |
| Validation error but HTTP is 400 not 422     | Normal — QBO uses 400 for validation. Read `Fault.Error[].code`.                             |
| `companyinfo` 404 / odd id                   | `companyinfo` takes the **realmId** as its resource id, not `"1"`.                           |
