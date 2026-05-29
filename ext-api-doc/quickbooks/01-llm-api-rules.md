---
api_name: 'QuickBooks Online Accounting API'
api_slug: 'quickbooks'
version: 'v3'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
line_count_target: '< 300 lines'
---

# QuickBooks Online — Workspace Agent API Rules

> **Loaded into the workspace agent's context when the QuickBooks Online integration is active.**
> Keep under 300 lines. Companion files (`01a`–`01d`) hold the deep reference.

## Context

- **API:** QuickBooks Online Accounting API v3 (REST, JSON) — Intuit Inc.
- **Base URL:** `https://quickbooks.api.intuit.com/v3/company/{realmId}/` (sandbox: `https://sandbox-quickbooks.api.intuit.com/v3/company/{realmId}/`)
- **Auth:** OAuth 2.0 (authorization_code) — Bearer token. **Only** auth method; no API keys.
- **Integration path:** Direct API via `connect_request` (not a Files connector). The agent never calls Intuit directly — it issues `connect_request` through the Numa relay, which injects the stored bearer token and forwards to the base URL above.
- **Rate limits:** 500 req/min/realm, 10 concurrent/realm, batch 120 req/min/realm. No reliable `X-RateLimit-*` headers — detect via 429.

## Auth Structure

OAuth 2.0 Bearer in the `Authorization` header. The Numa relay attaches the token; you build the path + body.

```
Authorization: Bearer {access_token}
Accept: application/json
Content-Type: application/json     # writes only; query body uses application/text
```

**Token lifecycle (handled by the relay, but know the behaviour):**

- Access token lives **1 hour**. Refresh token lives **~100 days and ROTATES** — a new `refresh_token` comes back roughly every 24h and on every exchange; the old one dies. The relay must persist the rotated token or the next refresh fails with `invalid_grant`.
- **`realmId` is the company id.** It is captured from the OAuth callback (`?...&realmId=4620816...`), persisted per company, and templated into **every** request path. One authorization = one company. Multiple companies = multiple connections.

## Capabilities

### CAN

1. Read/filter any entity via the SQL-like `query` endpoint (`SELECT ... FROM Invoice WHERE ...`) and read one by id (`GET /invoice/130`).
2. Create and update (full + **sparse**) Invoice, Customer, Item, Bill; record customer Payments and apply them to invoices.
3. List unpaid/overdue invoices and bills, report A/R / A/P, pull `companyinfo`, `preferences`, and `/reports` (P&L, A/R aging).
4. Incremental sync via CDC (`/cdc`) or `WHERE MetaData.LastUpdatedTime > '...'`. Download invoice PDFs; bundle ops in `/batch` (≤30).

### CANNOT

1. No JOINs, no `OR`, no nested parentheses in the query dialect. Filter is **AND-only** + `LIKE`.
2. No PUT — create AND update both go through **POST** to `/{entity}`. No webhook subscription at runtime (configured in the Intuit portal).
3. Cannot create a Customer/Item inline inside an Invoice — referenced entities must already exist. No Payments-scope features (`com.intuit.quickbooks.payment` not granted).

## Critical Gotchas

> Get these wrong and you get errors or silent data loss.

1. **Sparse update or you wipe fields.** A plain POST update **clears every field you omit**. To change just a few fields, send `"sparse": true` + `Id` + current `SyncToken`. See `01c`.
2. **`SyncToken` is an optimistic lock.** Every update needs the _current_ `SyncToken` (from a fresh GET). Stale token → **error 5010 "Stale Object"** (HTTP 400). GET-then-update, always.
3. **Relationships are `*Ref` objects, never nested entities.** `{"value": "<Id>"}`. Resolve `CustomerRef`, `ItemRef`, `IncomeAccountRef` etc. by querying for the id _before_ you write.
4. **Validation failures return HTTP 400, not 422.** Distinguish by `Fault.type` + `code`, not status. `6240` = duplicate name, `2010` = missing field, `610` = not found.
5. **Pin `minorversion=75`.** Minor versions 1–74 were deprecated Aug 2025; 75 is the current minimum. Never use "latest" in production — field behaviour can shift.
6. **`Accept: application/json` or you get XML.** Omitting it can return XML silently.
7. **Empty query result = `"QueryResponse": {}`** (the entity array key is absent, `totalCount` may be missing). Handle the missing-key case — don't assume the array exists.

## Default Parameters

Use these unless the user says otherwise:

| Parameter      | Default            | Reason                                            |
| -------------- | ------------------ | ------------------------------------------------- |
| `minorversion` | `75`               | Current minimum; pin for stable field behaviour   |
| `MAXRESULTS`   | `100` (cap 1000)   | Sane page size; raise to 1000 only for bulk reads |
| `Accept`       | `application/json` | Avoid accidental XML responses                    |
| environment    | production base    | Sandbox base only in dev/testing                  |

## Working Examples

### Example 1: List unpaid invoices, newest first

```http
GET /v3/company/{realmId}/query?query=SELECT * FROM Invoice WHERE Balance > '0' ORDER BY TxnDate DESC MAXRESULTS 100&minorversion=75
Accept: application/json
```

```json
{
  "QueryResponse": {
    "startPosition": 1,
    "maxResults": 100,
    "totalCount": 2,
    "Invoice": [
      {
        "Id": "130",
        "SyncToken": "0",
        "CustomerRef": { "value": "58", "name": "Amy's Bird Sanctuary" },
        "TotalAmt": 150.0,
        "Balance": 150.0,
        "TxnDate": "2026-05-20",
        "DueDate": "2026-06-19"
      }
    ]
  },
  "time": "2026-05-29T10:00:00.123-07:00"
}
```

### Example 2: Create an invoice

```http
POST /v3/company/{realmId}/invoice?minorversion=75
Content-Type: application/json
```

```json
{
  "CustomerRef": { "value": "58" },
  "Line": [
    {
      "Amount": 150.0,
      "DetailType": "SalesItemLineDetail",
      "Description": "Consulting - 3 hours",
      "SalesItemLineDetail": {
        "ItemRef": { "value": "1", "name": "Consulting Services" },
        "Qty": 3,
        "UnitPrice": 50.0
      }
    }
  ],
  "DueDate": "2026-06-28"
}
```

Response: `{ "Invoice": { "Id": "131", "SyncToken": "0", "DocNumber": "1071", "TotalAmt": 150.00, "Balance": 150.00, ... }, "time": "..." }`

### Example 3: Sparse update a customer (change email only)

```http
POST /v3/company/{realmId}/customer?minorversion=75
Content-Type: application/json
```

```json
{
  "sparse": true,
  "Id": "58",
  "SyncToken": "1",
  "PrimaryEmailAddr": { "Address": "newemail@birds.com" }
}
```

Returns the full updated `Customer` with an incremented `SyncToken`. Omit `"sparse": true` and every unspecified field is wiped.

### Example 4: Record a payment applied to an invoice

```http
POST /v3/company/{realmId}/payment?minorversion=75
Content-Type: application/json
```

```json
{
  "CustomerRef": { "value": "58" },
  "TotalAmt": 150.0,
  "Line": [
    {
      "Amount": 150.0,
      "LinkedTxn": [{ "TxnId": "131", "TxnType": "Invoice" }]
    }
  ]
}
```

After this, the linked invoice's `Balance` drops to 0. Payment must reference invoices belonging to the same `CustomerRef`.

## Proxy API Operations

> All paths are relative to `…/v3/company/{realmId}/`. `{entity}` ∈ `invoice|customer|item|bill|payment|…`.

| Operation         | Method | Path                                | Key Parameters                           | Notes                          |
| ----------------- | ------ | ----------------------------------- | ---------------------------------------- | ------------------------------ |
| Query / list      | GET    | `/query?query=SELECT...`            | URL-encoded SELECT, `minorversion`       | Primary read path; AND-only    |
| Read one by id    | GET    | `/{entity}/{id}`                    | `minorversion`                           | e.g. `/invoice/130`            |
| Create            | POST   | `/{entity}`                         | body (no `Id`), `requestid` (idempotent) | 200 + created entity           |
| Update (full)     | POST   | `/{entity}`                         | body w/ `Id` + `SyncToken`               | Omitted fields **cleared**     |
| Update (sparse)   | POST   | `/{entity}`                         | `sparse:true` + `Id` + `SyncToken`       | Only sent fields change        |
| Delete txn        | POST   | `/{entity}?operation=delete`        | `{ "Id", "SyncToken" }`                  | Txn entities only; HITL-gate   |
| Void invoice      | POST   | `/invoice?operation=void`           | `{ "Id", "SyncToken" }`                  | Lines kept, total→0; HITL-gate |
| Invoice PDF       | GET    | `/invoice/{id}/pdf`                 | `Accept: application/pdf`                | Binary                         |
| Send invoice      | POST   | `/invoice/{id}/send?sendTo={email}` | —                                        | Sets `EmailStatus`             |
| Batch             | POST   | `/batch`                            | `BatchItemRequest[]` (≤30)               | Partial success; 120/min/realm |
| Change feed (CDC) | GET    | `/cdc?entities=...&changedSince=`   | ISO8601 timestamp                        | Full objects for many entities |
| Company info      | GET    | `/companyinfo/{realmId}`            | —                                        | Smoke test                     |
| Reports           | GET    | `/reports/{reportName}`             | report params                            | Lower rate limit (~200/min)    |

## Pagination

- **Type:** Offset, expressed **inside the SELECT** via `STARTPOSITION` (1-based) + `MAXRESULTS`. No cursors.
- **Default page size:** 100. **Max page size:** 1000.
- **How to paginate:**

```http
GET /v3/company/{realmId}/query?query=SELECT * FROM Invoice ORDER BY Id STARTPOSITION 1 MAXRESULTS 1000
GET /v3/company/{realmId}/query?query=SELECT * FROM Invoice ORDER BY Id STARTPOSITION 1001 MAXRESULTS 1000
```

- **Last page detection:** the returned entity array has fewer rows than `MAXRESULTS` (or is absent). Always include a stable `ORDER BY Id` so offsets are deterministic.

## Webhooks / Events

Webhooks exist but are configured **per-app in the Intuit portal**, not at runtime. They carry only `{ name, id, operation, lastUpdated }` per change — **never the full entity**. On receipt, query the entity by id. Verify with the `intuit-signature` header (HMAC-SHA256 of the raw body using the app verifier token).

**For the agent, prefer polling:**

```http
GET /v3/company/{realmId}/cdc?entities=Invoice,Customer,Bill,Payment,Item&changedSince=2026-05-28T00:00:00-07:00
```

CDC returns full objects for everything changed since the timestamp in one call (cheaper than per-entity polling). Recommended interval: a few minutes, within the 500/min budget. See `01d`.

## Error Handling

**Standard error format (`Fault` envelope):**

```json
{
  "Fault": {
    "Error": [
      {
        "Message": "Stale Object Error",
        "Detail": "You and someone else were working on this...",
        "code": "5010",
        "element": "SyncToken"
      }
    ],
    "type": "ValidationFault"
  },
  "time": "2026-05-29T10:00:00.000-07:00"
}
```

`Fault.type` ∈ `ValidationFault | AuthenticationFault | AuthorizationFault | SystemFault`.

**Recovery by status:**

| Status   | Meaning         | Action                                                    |
| -------- | --------------- | --------------------------------------------------------- |
| 400      | Bad request     | Read `Fault.Error[].code` — fix payload/query (NOT retry) |
| 400+5010 | Stale SyncToken | GET latest entity, copy fresh `SyncToken`, retry once     |
| 400+6240 | Duplicate name  | Use a unique `DisplayName`/`Name`                         |
| 401      | Unauthorized    | Refresh token (relay), retry once                         |
| 403      | Forbidden       | Insufficient scope / re-consent — do not retry            |
| 404      | Not found       | Verify the id exists in this realm                        |
| 429      | Rate limited    | Exponential backoff + jitter; cap parallelism at 10       |
| 5xx      | Server error    | Retry with exponential backoff; check status page         |

## Known Limitations

1. Query dialect: AND-only, no OR/JOIN/parentheses; only `LIKE '%...%'` for text. For OR-style logic, run multiple queries or use CDC.
2. No live `[CONFIRMED]` responses behind these docs — shapes are `[DOCUMENTED]`/`[INFERRED]` from Intuit docs + SDKs. Verify exact wrappers against a sandbox before trusting edge-case fields.
3. `Retry-After` / `X-RateLimit-*` headers are not reliably returned — implement client-side backoff.

---

_See companion files for detail:_

- _`01a-domain-model-reference.md` — entities, refs, state machines, field formats_
- _`01b-query-patterns.md` — SQL-like query dialect, filters, pagination_
- _`01c-mutation-patterns.md` — create / sparse-update / delete / void / payments_
- _`01d-event-and-error-handling.md` — webhooks, CDC, Fault catalogue, retries_
