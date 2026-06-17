---
doc: event-and-error-handling
api: QuickBooks Online Accounting API v3
scope: webhooks, CDC, the universal Fault envelope, error catalogue, retry logic, idempotency, output formatting.
confidence: [DOCUMENTED] from Intuit docs unless tagged [INFERRED]; NO live calls — verify rate-limit header behaviour + edge shapes against sandbox.
---

# Event & Error Handling — QuickBooks Online (v3)

## 1. Webhooks

**SUPPORTED — but configured per-app in the Intuit Developer portal, not at runtime.** You cannot subscribe/unsubscribe via API; an app owner sets a notification endpoint URL + entities/operations in the portal. For the agent, **prefer CDC polling** (§3) — runtime-controllable, returns full objects.

Delivers a thin notification (id + operation only, NEVER the full entity):
`{"eventNotifications":[{"realmId":"4620816365212402417","dataChangeEvent":{"entities":[{"name":"Invoice","id":"130","operation":"Update","lastUpdated":"2026-05-29T10:05:00-07:00"}]}}]}`
On receipt, query the entity by id (`GET /invoice/130`).

Event catalogue (operations per entity):
| Entity (subset) | Operations |
| --- | --- |
| `Customer`,`Vendor`,`Item`,`Account` | Create, Update, (Merge) |
| `Invoice`,`Bill`,`Payment`,`BillPayment`,`Estimate`,`CreditMemo` | Create, Update, Delete, Void |
| `JournalEntry`,`Purchase`,`PurchaseOrder`,`SalesReceipt`,`RefundReceipt`,`Deposit`,`Transfer`,`TimeActivity` | Create, Update, Delete |

Verification (if you receive webhooks): signature header **`intuit-signature`**; algorithm **HMAC-SHA256 of the raw request body** using the app's **verifier token** (from portal) as key; base64-encode + constant-time compare to header. HTTPS endpoint required; respond `200` quickly (failures retried w/ backoff).
Reliability: NO ordering guarantee (treat as "something changed, go fetch"); duplicate delivery possible (handlers idempotent); events may be batched/coalesced.

## 2. WebSocket / SSE

Not supported. REST only.

## 3. Change Data Capture (CDC) — the polling workhorse

Full objects for everything changed since a timestamp, across multiple entity types, in ONE call. Recommended change-detection for the agent.
`GET /v3/company/{realmId}/cdc?entities=Invoice,Customer,Bill,Payment,Item&changedSince=2026-05-28T00:00:00-07:00&minorversion=75` (Accept: application/json)
Response shape: `{"CDCResponse":[{"QueryResponse":[{"Invoice":[{"Id":"130","SyncToken":"1","Balance":0}],"startPosition":1,"maxResults":1}]}],"time":"2026-05-29T10:00:00.000-07:00"}`

- `entities` = comma-separated (any queryable entity). `changedSince` = ISO8601 datetime, reaches up to ~30 days back.
- Deletes appear with a status/`Deleted` marker rather than a normal entity body — handle the deleted case.
- One CDC call is far cheaper than per-entity polling against the 500/min budget.

Per-entity alternative (single stream; save last `LastUpdatedTime` as next cursor):
`SELECT * FROM Invoice WHERE MetaData.LastUpdatedTime > '2026-05-28T00:00:00-07:00' ORDER BY MetaData.LastUpdatedTime ASC`
Polling cadence: every few minutes is plenty; stay well within 500/min. Change-detection fields: `MetaData.LastUpdatedTime`, `SyncToken`.

## 4. Error format — the `Fault` envelope

EVERY QBO error uses the same shape:
`{"Fault":{"Error":[{"Message":"Stale Object Error","Detail":"Stale Object Error : You and someone else were working on this at the same time...","code":"5010","element":"SyncToken"}],"type":"ValidationFault"},"time":"2026-05-29T10:00:00.000-07:00"}`

- `Fault.Error[]` — one+ errors, each `Message`, `Detail`, `code`, optional `element` naming the offending field.
- `Fault.type` ∈ `ValidationFault | AuthenticationFault | AuthorizationFault | SystemFault`.
- **Parse `code`, not just HTTP status** — most validation failures return HTTP **400** (not 422) regardless of cause.

## 5. Error catalogue (status + codes)

| HTTP    | Code      | `Fault.type`        | Meaning                           | Retryable?    | Recovery                                           |
| ------- | --------- | ------------------- | --------------------------------- | ------------- | -------------------------------------------------- |
| 200     | —         | —                   | Success (read & write)            | —             | process `{"<Entity>":{…},"time":"…"}`              |
| 400     | 4000/4001 | ValidationFault     | Malformed query / parse error     | No            | fix the SELECT / JSON                              |
| 400     | 2010      | ValidationFault     | Required param/field missing      | No            | add the missing field                              |
| 400     | 6240      | ValidationFault     | Duplicate Name Exists             | No            | unique `DisplayName`/`Name`; query first           |
| 400     | 5010      | ValidationFault     | Stale Object (SyncToken mismatch) | After refetch | GET latest, copy fresh `SyncToken`, retry once     |
| 400     | 610       | ValidationFault     | Object Not Found                  | No            | verify the id exists in this realm                 |
| 401     | 3200      | AuthenticationFault | Token expired / invalid           | Yes           | relay refreshes access token, retry once           |
| 403     | —         | AuthorizationFault  | Insufficient scope / wrong realm  | No            | re-consent w/ correct scope; check realmId         |
| 429     | 003001    | ValidationFault     | ThrottleExceeded                  | Yes           | backoff + jitter, retry                            |
| 500/503 | —         | SystemFault         | Service issue                     | Yes           | backoff + retry; check status.developer.intuit.com |

Throttle (429) body: `{"Fault":{"Error":[{"Message":"ThrottleExceeded","Detail":"You have exceeded the number of allowed requests.","code":"003001"}],"type":"ValidationFault"},"time":"…"}`

## 6. Rate limits

| Scope                     | Limit        | Window | Notes                        |
| ------------------------- | ------------ | ------ | ---------------------------- |
| Per company (realmId)     | 500          | /min   | primary throttle             |
| Concurrent / realm        | 10 in flight | —      | 11th concurrent → throttled  |
| Batch endpoint / realm    | 120          | /min   | raised from 40 on 2025-10-31 |
| Reports / heavy endpoints | ~200         | /min   | lower than the global 500    |

NO reliable `X-RateLimit-*` headers and generally NO `Retry-After` — detect via the 429 response, back off client-side. `intuit_tid` (transaction id) is present on responses — quote it in support escalation. [INFERRED on header behaviour — verify empirically. Source: Intuit help KB + 2026 guides Coefficient/Satva/Truto]

## 7. Retry logic

```
callWithRetry(request, maxRetries=4):
  for attempt in 1..maxRetries:
    response = makeRequest(request)            # via Numa connect_request relay
    if response.status == 200: return response
    fault = parseJSON(response.body).Fault     # may be null on non-API errors
    if response.status == 401:                 # token expired
      relay.refreshAccessToken()               # relay persists the rotated refresh_token
      continue                                 # retry once with new token
    if response.status == 429 or response.status >= 500:
      wait( min(2^attempt, 30)s + jitter )     # cap parallelism at 10
      continue
    if response.status == 400 and fault.Error[0].code == "5010":
      entity = GET(request.entityUrl)          # refetch for fresh SyncToken
      request.body.SyncToken = entity.SyncToken
      continue                                 # retry once
    if response.status in (400, 403, 404):
      raise NonRetryable(fault)                # fix payload/scope/id — do not retry
  raise MaxRetriesExceeded()
```

**Do NOT retry:** 400 validation (`2010`,`6240`,`4001`,`610`), 403, 404 — fix the cause.
**DO retry (w/ backoff):** 401 (after refresh, once), 429, 5xx, 5010 (after refetching `SyncToken`, once).

## 8. Idempotency

- **Write:** pass `?requestid={uuid}` on create POSTs — a retried request with the same `requestid` is deduped, not duplicated (window short/best-effort).
- **Updates** (POST + `Id`+`SyncToken`) are effectively idempotent — the lock means a replay either succeeds once or fails 5010, never double-applies.
- **Deletes/voids** idempotent in effect (a second delete of a gone record errors, not double-deletes).
- **Webhook/CDC handlers must be idempotent** — duplicate + out-of-order delivery both possible.

## 9. Output formatting

- **Dates:** `YYYY-MM-DD` (`TxnDate`,`DueDate`); datetimes `YYYY-MM-DDThh:mm:ss±hh:mm` (`MetaData.*`). Quote in filters: `WHERE TxnDate >= '2026-01-01'`, `WHERE MetaData.LastUpdatedTime > '2026-05-28T00:00:00-07:00'`. Datetimes carry the REALM's tz offset — don't assume UTC; preserve the offset for cursors.
- **Currency:** plain decimal (2dp), no symbol. Base currency from the realm (`companyinfo`/`preferences`). `CurrencyRef` only when multicurrency enabled.
- **Ids & refs:** numeric strings (`"58"`), unique within a realm — NOT globally unique (same id in another realm = a different record). Refs are `{"value":"<id>"}`; only `value` matters on write, `name` is echoed, not authoritative.
- **Paid/unpaid:** no explicit paid-status field on Invoice/Bill — derive from `Balance` (0=paid, `Balance==TotalAmt`=nothing paid, between=partial). `EmailStatus` is unrelated to payment.

## 10. Counter-exceptions (when behaviour surprises you)

| Scenario                                 | Reality                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Update "succeeded" but other fields gone | Non-sparse update omitted them → cleared. Use `"sparse":true`.                               |
| Empty query returns no array             | `"QueryResponse":{}`, entity key absent — check for the key, don't index blindly.            |
| 401 right after a successful call        | Access token expired mid-session (1h). Relay refreshes + retries transparently.              |
| Next refresh fails `invalid_grant`       | The rotated `refresh_token` from the previous refresh wasn't persisted. Re-auth the company. |
| Validation error but HTTP 400 not 422    | Normal — QBO uses 400 for validation. Read `Fault.Error[].code`.                             |
| `companyinfo` 404 / odd id               | `companyinfo` takes the **realmId** as its resource id, not `"1"`.                           |
