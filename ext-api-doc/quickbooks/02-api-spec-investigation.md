---
api_name: 'QuickBooks Online Accounting API'
api_slug: 'quickbooks'
base_url: 'https://quickbooks.api.intuit.com/v3/company/{realmId}/'
version: 'v3'
spec_format: 'none' # No official OpenAPI; Postman collection is the closest machine-readable artefact
spec_url: ''
docs_url: 'https://developer.intuit.com/app/developer/qbo/docs/api/accounting'
date_researched: '2026-05-29'
---

# API Spec Investigation — QuickBooks Online (Accounting API v3)

> Clean consolidated developer reference. All endpoints, auth, query dialect, pagination, rate limits, and entity fields a developer needs to integrate, in one place.
> Confidence markers used throughout: [CONFIRMED], [DOCUMENTED], [INFERRED], [UNKNOWN].
>
> **Honesty note:** QuickBooks Online is a mature, well-documented API. Almost everything below is `[DOCUMENTED]` against Intuit's official reference. **No claim is `[CONFIRMED]`** — no authenticated live/sandbox call was made during this investigation, so exact response wrappers, empty-result shapes, and a few field-level nuances are `[DOCUMENTED]`/`[INFERRED]` rather than verified. Verify against a sandbox company before treating edge-case fields as ground truth. See `00-api-investigation-questionnaire.md` for the full research trail.

---

## API Identity

| Property           | Value                                                                         | Confidence   |
| ------------------ | ----------------------------------------------------------------------------- | ------------ |
| API Name           | QuickBooks Online Accounting API                                              | [DOCUMENTED] |
| Version            | v3 (path-versioned) + additive `minorversion` query param                     | [DOCUMENTED] |
| Vendor             | Intuit Inc.                                                                   | [DOCUMENTED] |
| Protocol           | HTTPS REST                                                                    | [DOCUMENTED] |
| Response Format    | JSON (default) / XML (legacy) / PDF (with `Accept` header)                    | [DOCUMENTED] |
| Base URL (prod)    | `https://quickbooks.api.intuit.com/v3/company/{realmId}/`                     | [DOCUMENTED] |
| Base URL (sandbox) | `https://sandbox-quickbooks.api.intuit.com/v3/company/{realmId}/`             | [DOCUMENTED] |
| Developer Portal   | https://developer.intuit.com                                                  | [DOCUMENTED] |
| API Reference      | https://developer.intuit.com/app/developer/qbo/docs/api/accounting            | [DOCUMENTED] |
| Status Page        | https://status.developer.intuit.com/                                          | [DOCUMENTED] |
| OpenAPI Spec       | None published by Intuit                                                      | [DOCUMENTED] |
| Postman Collection | https://developer.intuit.com/app/developer/qbo/docs/develop/tutorials/postman | [DOCUMENTED] |

**Summary:** QuickBooks Online's Accounting API exposes a small-business accounting ledger — invoices, customers, items, bills, payments, accounts, etc. — over REST + a SQL-like query language. Used by accounting integrations, bookkeeping tools, and now Numa's workspace agent to read and mutate a company's books.

> **The `{realmId}` path segment is per-company.** It is **not** a fixed base URL — it is captured during the OAuth callback (`?...&realmId=...`), persisted per authorised company, and templated into every request path. One authorisation = one company. This is the QuickBooks analogue of MYOB's `businessId` and Xero's tenant id.

---

## Authentication

**Type:** OAuth 2.0 Authorization Code grant. This is the **only** supported auth method — no API keys, no basic auth. [DOCUMENTED]

### Endpoints

| Step           | Method | URL                                                                 | Confidence                    |
| -------------- | ------ | ------------------------------------------------------------------- | ----------------------------- |
| Authorize      | GET    | `https://appcenter.intuit.com/connect/oauth2`                       | [DOCUMENTED — registry match] |
| Token exchange | POST   | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`         | [DOCUMENTED — registry match] |
| Token refresh  | POST   | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`         | [DOCUMENTED]                  |
| Revocation     | POST   | `https://developer.api.intuit.com/v2/oauth2/tokens/revoke`          | [DOCUMENTED]                  |
| Discovery doc  | GET    | `https://developer.api.intuit.com/.well-known/openid_configuration` | [DOCUMENTED]                  |

> The Authorize and Token URLs match the connector registry entry (`oauth.authUrl` / `oauth.tokenUrl`) exactly — see `03-connector-setup.md`.

### Authorization URL Required Parameters

| Parameter       | Value                                                                     |
| --------------- | ------------------------------------------------------------------------- |
| `client_id`     | Your app's Client ID (from Intuit Developer portal)                       |
| `redirect_uri`  | Registered redirect URI — must match byte-for-byte                        |
| `response_type` | `code`                                                                    |
| `scope`         | `com.intuit.quickbooks.accounting` (the only scope this connector grants) |
| `state`         | CSRF token (strongly recommended; Numa's OAuth layer always sends one)    |

### Token Response Fields

| Field                        | Type    | Notes                                                                  |
| ---------------------------- | ------- | ---------------------------------------------------------------------- |
| `access_token`               | string  | Bearer token for API calls                                             |
| `refresh_token`              | string  | **Rotates ~every 24h and on each exchange — must be stored each time** |
| `token_type`                 | string  | `bearer`                                                               |
| `expires_in`                 | integer | Access token lifetime in seconds (**3600 = 1 hour**)                   |
| `x_refresh_token_expires_in` | integer | Refresh token lifetime in seconds (~100 days)                          |

### Post-OAuth Redirect Parameters

| Parameter | Description                                                                         |
| --------- | ----------------------------------------------------------------------------------- |
| `code`    | Authorization code (exchange for tokens)                                            |
| `state`   | Echoed CSRF token (verify it matches what you sent)                                 |
| `realmId` | **QuickBooks company id — primary identifier for every API call path.** Persist it. |

```
{redirect_uri}?code=AB11...&state={csrf}&realmId=4620816365212402417
```

There is no "list companies" call for a token — each authorisation is scoped to exactly one realm. To connect multiple companies, run OAuth once per company. [DOCUMENTED]

### Token Lifetimes

| Property                | Value                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token lifetime   | 1 hour (3600 s)                                                                                                                                                                     |
| Refresh token lifetime  | ~100 days                                                                                                                                                                           |
| Refresh token rotation? | **Yes** — a new `refresh_token` is returned ~every 24h and on every exchange; the old one is invalidated. Persist the rotated token or the next refresh fails with `invalid_grant`. |
| PKCE required?          | No (confidential server-side client uses `client_secret`; PKCE supported but not required)                                                                                          |
| Re-consent required?    | When the refresh token expires (~100 days unused) or the user revokes access                                                                                                        |

[DOCUMENTED] — https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
[DOCUMENTED] — https://help.developer.intuit.com/s/article/Validity-of-Refresh-Token

### Required scope

| Scope                              | Access Area                                          | Required?                           |
| ---------------------------------- | ---------------------------------------------------- | ----------------------------------- |
| `com.intuit.quickbooks.accounting` | Full read/write to the Accounting API (all entities) | **Yes** — registry's sole scope     |
| `com.intuit.quickbooks.payment`    | QuickBooks Payments API (charges, tokens)            | No — not granted by this connector  |
| `openid`, `profile`, `email`       | OpenID Connect identity claims                       | No — not needed for accounting data |

---

## Required Headers

| Header          | Value                   | Required                                                 |
| --------------- | ----------------------- | -------------------------------------------------------- |
| `Authorization` | `Bearer {access_token}` | Always                                                   |
| `Accept`        | `application/json`      | Always — **omit it and the API may silently return XML** |
| `Content-Type`  | `application/json`      | POST writes (use `application/text` for query body)      |
| `Content-Type`  | `multipart/form-data`   | Attachable file uploads (`/upload`)                      |

[DOCUMENTED] — https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0

> The Numa relay attaches `Authorization` automatically (it injects the stored bearer token). The agent builds the path + body + `Accept`/`Content-Type`. See `01-llm-api-rules.md`.

---

## URL Structure & Versioning

```
https://quickbooks.api.intuit.com/v3/company/{realmId}/{resource}[/{id}]?minorversion={n}
https://quickbooks.api.intuit.com/v3/company/{realmId}/query?query={SQL}&minorversion={n}
```

- **Version:** path `/v3/` is fixed; behaviour is layered via the additive `minorversion` query param.
- **Pin `minorversion`.** Minor versions 1–74 were deprecated in Aug 2025; **75 is the current minimum**. Never use "latest" in production — field behaviour can shift between versions. [DOCUMENTED]
- **Reference:** https://developer.intuit.com/app/developer/qbo/docs/develop/explore-the-quickbooks-online-api/minor-versions

---

## Endpoint Catalog

All paths relative to `https://quickbooks.api.intuit.com/v3/company/{realmId}/`. `{entity}` ∈ `invoice | customer | item | bill | payment | …` (case-insensitive in the path; entity names are capitalised in the query language and in JSON bodies).

### Read

| Method | Path                                  | Purpose                                   | Auth | Paginated                | Idempotent |
| ------ | ------------------------------------- | ----------------------------------------- | ---- | ------------------------ | ---------- |
| GET    | `/query?query=SELECT...`              | Read / list / filter any entity           | Yes  | STARTPOSITION/MAXRESULTS | Yes        |
| GET    | `/{entity}/{id}`                      | Read one by id (e.g. `/invoice/130`)      | Yes  | No                       | Yes        |
| GET    | `/companyinfo/{realmId}`              | Company metadata (smoke test)             | Yes  | No                       | Yes        |
| GET    | `/preferences`                        | Company preferences (multicurrency, etc.) | Yes  | No                       | Yes        |
| GET    | `/cdc?entities=...&changedSince={ts}` | Change Data Capture (delta poll)          | Yes  | No                       | Yes        |
| GET    | `/reports/{reportName}`               | Run a report (P&L, A/R aging, …)          | Yes  | No                       | Yes        |
| GET    | `/invoice/{id}/pdf`                   | Download invoice PDF (binary)             | Yes  | No                       | Yes        |

### Write

| Method | Path                                | Purpose                                | Auth | Idempotent                                |
| ------ | ----------------------------------- | -------------------------------------- | ---- | ----------------------------------------- |
| POST   | `/{entity}`                         | **Create OR update** (no PUT in QBO)   | Yes  | No for create — use `requestid` to dedupe |
| POST   | `/{entity}?operation=delete`        | Delete a transaction                   | Yes  | Effectively (needs `Id`+`SyncToken`)      |
| POST   | `/invoice?operation=void`           | Void an invoice (lines kept, total→0)  | Yes  | Effectively                               |
| POST   | `/invoice/{id}/send?sendTo={email}` | Email the invoice (sets `EmailStatus`) | Yes  | No                                        |
| POST   | `/batch`                            | Up to 30 mixed ops, partial success    | Yes  | Per-item                                  |
| POST   | `/upload`                           | Upload an `Attachable` (multipart)     | Yes  | No                                        |

> **No PUT.** Create and update both go through `POST /{entity}`. A body with no `Id` creates; a body with `Id` + current `SyncToken` updates. Add `"sparse": true` to update only the supplied fields (see Data Models / `01c-mutation-patterns.md`).

### Full Endpoint Index

| #   | Method | Path                                               | Notes                                                     |
| --- | ------ | -------------------------------------------------- | --------------------------------------------------------- |
| 1   | GET    | `/query?query=SELECT...`                           | Primary read path; AND-only filter dialect                |
| 2   | GET    | `/{entity}/{id}`                                   | Read one — returns `{ "<Entity>": {...}, "time": "..." }` |
| 3   | POST   | `/{entity}`                                        | Create or full/sparse update                              |
| 4   | POST   | `/{entity}?operation=delete`                       | Transaction entities only                                 |
| 5   | POST   | `/invoice?operation=void`                          | Void; total→0, lines retained                             |
| 6   | GET    | `/invoice/{id}/pdf`                                | `Accept: application/pdf`                                 |
| 7   | POST   | `/invoice/{id}/send?sendTo={email}`                | Sets `EmailStatus`                                        |
| 8   | POST   | `/batch`                                           | ≤30 ops; 120/min/realm; partial success                   |
| 9   | GET    | `/cdc?entities=Invoice,Customer&changedSince={ts}` | Full objects for many entities since a timestamp          |
| 10  | GET    | `/companyinfo/{realmId}`                           | Smoke test — `companyinfo` id is the realmId              |
| 11  | GET    | `/preferences`                                     | Company preferences                                       |
| 12  | POST   | `/upload`                                          | `Attachable` multipart upload                             |
| 13  | GET    | `/reports/{reportName}`                            | Lower rate limit (~200/min)                               |

[DOCUMENTED] — https://developer.intuit.com/app/developer/qbo/docs/api/accounting

---

## Data Models

> Every entity shares the `Id` + `SyncToken` + `MetaData` envelope. Relationships are **`*Ref` objects** (`{"value": "<Id>", "name": "<optional>"}`), never nested child entities. `Id` and `SyncToken` are strings in JSON. All field-name detail below is `[DOCUMENTED]` from Intuit's per-entity reference, not verified live — see `01a-domain-model-reference.md` for the full tables.

### Customer (`/customer`)

| Field                      | Type    | Required    | Writable | Description                                |
| -------------------------- | ------- | ----------- | -------- | ------------------------------------------ |
| `Id`                       | string  | system      | no       | Entity id (per realm)                      |
| `SyncToken`                | string  | for update  | no       | Optimistic-lock version                    |
| `DisplayName`              | string  | conditional | yes      | Unique per realm (one name field required) |
| `GivenName` / `FamilyName` | string  | no          | yes      | Person name parts                          |
| `CompanyName`              | string  | no          | yes      | Business name                              |
| `PrimaryEmailAddr`         | object  | no          | yes      | `{ "Address": "amy@birds.com" }`           |
| `PrimaryPhone`             | object  | no          | yes      | `{ "FreeFormNumber": "(650) 555-1234" }`   |
| `BillAddr`                 | object  | no          | yes      | Address sub-object                         |
| `Balance`                  | decimal | system      | no       | Open balance (computed)                    |
| `Active`                   | boolean | no          | yes      | `false` = deactivated (no hard delete)     |

### Item (`/item`)

| Field               | Type    | Required    | Writable     | Description                                                           |
| ------------------- | ------- | ----------- | ------------ | --------------------------------------------------------------------- |
| `Id`                | string  | system      | no           | Item id                                                               |
| `SyncToken`         | string  | for update  | no           | Lock version                                                          |
| `Name`              | string  | yes         | yes          | Unique per realm                                                      |
| `Type`              | enum    | yes         | yes (create) | `Inventory \| Service \| NonInventory \| Group \| Category \| Bundle` |
| `UnitPrice`         | decimal | no          | yes          | Sales price                                                           |
| `IncomeAccountRef`  | Ref     | conditional | yes          | Required for Service/Inventory                                        |
| `ExpenseAccountRef` | Ref     | conditional | yes          | Required for Inventory                                                |
| `AssetAccountRef`   | Ref     | conditional | yes          | Required for Inventory                                                |
| `QtyOnHand`         | decimal | conditional | yes (create) | Inventory only; with `TrackQtyOnHand: true`                           |
| `Active`            | boolean | no          | yes          | Active flag                                                           |

### Invoice (`/invoice`)

| Field         | Type    | Required   | Writable | Description                              |
| ------------- | ------- | ---------- | -------- | ---------------------------------------- |
| `Id`          | string  | system     | no       | Invoice id                               |
| `SyncToken`   | string  | for update | no       | Lock version                             |
| `CustomerRef` | Ref     | yes        | yes      | The customer being billed                |
| `Line`        | array   | yes        | yes      | Line items (`SalesItemLineDetail`, etc.) |
| `DocNumber`   | string  | no         | yes      | Invoice number                           |
| `TxnDate`     | date    | no         | yes      | Transaction date (`YYYY-MM-DD`)          |
| `DueDate`     | date    | no         | yes      | Payment due date                         |
| `TotalAmt`    | decimal | system     | no       | Computed total                           |
| `Balance`     | decimal | system     | no       | Outstanding balance (0 once paid)        |
| `EmailStatus` | enum    | no         | yes      | `NotSet \| NeedToSend \| EmailSent`      |
| `LinkedTxn`   | array   | system     | no       | Links to Payments/CreditMemos applied    |

> QBO has **no explicit paid/unpaid status enum** on Invoice — paid state is derived from `Balance` vs `TotalAmt`. `EmailStatus` is a separate concern.

### Bill (`/bill`)

| Field       | Type    | Required   | Writable | Description                                                    |
| ----------- | ------- | ---------- | -------- | -------------------------------------------------------------- |
| `Id`        | string  | system     | no       | Bill id                                                        |
| `SyncToken` | string  | for update | no       | Lock version                                                   |
| `VendorRef` | Ref     | yes        | yes      | The vendor owed                                                |
| `Line`      | array   | yes        | yes      | `AccountBasedExpenseLineDetail` / `ItemBasedExpenseLineDetail` |
| `TxnDate`   | date    | no         | yes      | Bill date                                                      |
| `DueDate`   | date    | no         | yes      | Due date                                                       |
| `TotalAmt`  | decimal | system     | no       | Computed total                                                 |
| `Balance`   | decimal | system     | no       | Outstanding balance                                            |

### Payment (`/payment`)

> Customer payment received against invoices (A/R). Vendor-side payment of a Bill is the separate `/billpayment` entity.

| Field                 | Type    | Required   | Writable | Description                                           |
| --------------------- | ------- | ---------- | -------- | ----------------------------------------------------- |
| `Id`                  | string  | system     | no       | Payment id                                            |
| `SyncToken`           | string  | for update | no       | Lock version                                          |
| `CustomerRef`         | Ref     | yes        | yes      | Customer who paid                                     |
| `TotalAmt`            | decimal | yes        | yes      | Payment amount                                        |
| `Line`                | array   | no         | yes      | Apply to invoices via `LinkedTxn` (`TxnType=Invoice`) |
| `DepositToAccountRef` | Ref     | no         | yes      | Account funds deposited to                            |
| `TxnDate`             | date    | no         | yes      | Payment date                                          |
| `UnappliedAmt`        | decimal | system     | no       | Amount not yet applied to an invoice                  |

**Relationships:**

- `Customer ←CustomerRef← Invoice ←LinkedTxn← Payment`; `Vendor ←VendorRef← Bill`; `Item` referenced by `Invoice.Line[].ItemRef` / `Bill.Line[].ItemRef`; `Item.IncomeAccountRef`/`ExpenseAccountRef`/`AssetAccountRef` → `Account`.
- Referenced entities (Customer, Vendor, Item, Account) must exist **before** they can be referenced — you cannot create them inline inside an Invoice/Bill payload.
- A `Payment` may only link to `Invoice`s belonging to the same `CustomerRef`.

**Field formats:** dates `YYYY-MM-DD`; datetimes `YYYY-MM-DDThh:mm:ss±hh:mm`; currency = plain decimal (no symbol); ids = numeric strings; `realmId` = long numeric string in the URL path.

---

## Query & Filter (SQL-like dialect)

The `query` endpoint takes a URL-encoded `SELECT` statement. It is **not** SQL — it is Intuit's restricted dialect.

```
GET /v3/company/{realmId}/query?query=SELECT * FROM Invoice WHERE Balance > '0' ORDER BY TxnDate DESC STARTPOSITION 1 MAXRESULTS 100
```

| Capability              | Supported?   | Syntax / Note                                               |
| ----------------------- | ------------ | ----------------------------------------------------------- |
| Filter by field         | Yes          | `WHERE DisplayName = 'Amy'`                                 |
| Date range              | Yes          | `WHERE TxnDate >= '2026-01-01' AND TxnDate <= '2026-05-31'` |
| Comparison operators    | Yes          | `=`, `<`, `>`, `<=`, `>=`, `IN`, `LIKE`                     |
| Text match              | Partial      | `LIKE 'Amy%'` / `LIKE '%pump%'` — no true full-text search  |
| Sort                    | Yes          | `ORDER BY TxnDate [DESC]`                                   |
| Field selection         | Yes          | `SELECT Id, DocNumber FROM Invoice` or `SELECT *`           |
| Count                   | Yes          | `SELECT COUNT(*) FROM Invoice` → `totalCount`               |
| Logical operators       | **AND only** | **No `OR`** in the dialect                                  |
| Parentheses / nesting   | **No**       | Not supported                                               |
| JOINs / include related | **No**       | Resolve `*Ref` ids with follow-up queries                   |
| Null checks             | Limited      | not generally supported — [INFERRED, verify in sandbox]     |

**Common patterns:**

```sql
-- Unpaid invoices, newest first
SELECT * FROM Invoice WHERE Balance > '0' ORDER BY TxnDate DESC MAXRESULTS 100
-- Find a customer by name
SELECT * FROM Customer WHERE DisplayName LIKE 'Amy%'
-- Bills due this month for a vendor
SELECT * FROM Bill WHERE VendorRef = '56' AND DueDate <= '2026-05-31' AND Balance > '0'
-- Incremental sync (records changed since a timestamp)
SELECT * FROM Customer WHERE MetaData.LastUpdatedTime > '2026-05-28T00:00:00-07:00'
```

See `01b-query-patterns.md` for the full query reference.

---

## Pagination

| Property          | Value                                                                                |
| ----------------- | ------------------------------------------------------------------------------------ |
| Type              | Offset, expressed **inside the SELECT** via `STARTPOSITION` (1-based) + `MAXRESULTS` |
| Default page size | 100 (when `MAXRESULTS` omitted)                                                      |
| Maximum page size | 1000 (`MAXRESULTS 1000`)                                                             |
| Total count       | Available via `SELECT COUNT(*)`; list responses echo `startPosition`/`maxResults`    |
| Cursors           | None                                                                                 |

**Response structure (list):**

```json
{
  "QueryResponse": {
    "startPosition": 1,
    "maxResults": 100,
    "totalCount": 2,
    "Invoice": [
      /* up to 100 */
    ]
  },
  "time": "2026-05-29T10:00:00.000-07:00"
}
```

**Worked example:**

```
Page 1: SELECT * FROM Invoice ORDER BY Id STARTPOSITION 1    MAXRESULTS 1000
Page 2: SELECT * FROM Invoice ORDER BY Id STARTPOSITION 1001 MAXRESULTS 1000
Last:   returned array length < 1000  -> stop
```

**Last-page detection:** the returned entity array has fewer rows than `MAXRESULTS` (or is absent). Always include a stable `ORDER BY Id` so offsets are deterministic. [DOCUMENTED]

> **Empty-result gotcha:** when zero rows match, `QueryResponse` is an empty object `{}` — the entity array key is **absent** and `totalCount` may be omitted. Handle the missing-key case. [DOCUMENTED]/[INFERRED]

---

## Rate Limits

| Scope                       | Limit         | Window     | Notes                        |
| --------------------------- | ------------- | ---------- | ---------------------------- |
| Per company (realmId)       | 500 requests  | per minute | Primary throttle             |
| Concurrent requests / realm | 10 in flight  | —          | 11th concurrent → throttled  |
| Batch endpoint / realm      | 120 requests  | per minute | Raised from 40 on 2025-10-31 |
| Reports / heavy endpoints   | ~200 requests | per minute | Lower than the global 500    |

**Headers:** Intuit does **not** reliably return `X-RateLimit-*` headers — detect throttling via the 429 response. `intuit_tid` (transaction id) is present on every response; quote it in support tickets.

**When exceeded (429):**

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

**Recommended strategy:** exponential backoff **with jitter**; `Retry-After` is generally absent. Cap parallelism at the 10-concurrent ceiling.

[DOCUMENTED] — Intuit help KB + 2026 third-party guides (Coefficient, Satva, Truto). `Retry-After`/`X-RateLimit-*` behaviour: [INFERRED].

---

## Error Handling

**Standard error format — the `Fault` envelope:**

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

`Fault.type` ∈ `ValidationFault | AuthenticationFault | AuthorizationFault | SystemFault`.

**Status codes:**

| Status | Meaning                        | Retryable | Recovery                                      |
| ------ | ------------------------------ | --------- | --------------------------------------------- |
| 400    | Bad request / validation       | No        | Read `Fault.Error[].code` — fix payload/query |
| 401    | Token expired / invalid        | Yes       | Refresh token, retry once                     |
| 403    | Forbidden / insufficient scope | No        | Re-consent with correct scope                 |
| 404    | Not found                      | No        | Verify the id exists in this realm            |
| 429    | Rate limited                   | Yes       | Backoff + jitter; cap parallelism at 10       |
| 5xx    | Server error                   | Yes       | Retry with backoff; check status page         |

> **Gotcha:** most **validation** failures return **HTTP 400, not 422**. Distinguish by `Fault.type` + `code`, not by status alone.

**Selected error codes:**

| HTTP | Code      | Meaning                           | Recovery                                 |
| ---- | --------- | --------------------------------- | ---------------------------------------- |
| 400  | 4000/4001 | Invalid query / parse error       | Fix the SELECT syntax                    |
| 400  | 2010      | Required param/field missing      | Add the missing field                    |
| 400  | 6240      | Duplicate Name Exists             | Use a unique `DisplayName`/`Name`        |
| 400  | 5010      | Stale Object (SyncToken mismatch) | GET latest, retry with fresh `SyncToken` |
| 400  | 610       | Object Not Found                  | Verify the id exists in this realm       |
| 401  | 3200      | Token expired / invalid           | Refresh access token, retry              |
| 429  | 003001    | ThrottleExceeded                  | Backoff + retry                          |

See `01d-event-and-error-handling.md` for the full Fault catalogue.

---

## Webhooks / Events

**Supported** — but configured **per-app in the Intuit Developer portal**, not at runtime via API.

- **Registration:** Intuit portal — set notification endpoint URL + select entities/operations. HTTPS only; respond 200 quickly.
- **Payload:** carries only `{ name, id, operation, lastUpdated }` per change — **never the full entity**. On receipt, query the entity by id.
- **Verification:** `intuit-signature` header — HMAC-SHA256 of the raw request body using the app's verifier token; compare to the base64 value.
- **Retry:** Intuit retries failed deliveries with backoff; events may be batched/coalesced; duplicate delivery possible → handlers must be idempotent; ordering not guaranteed.

**Change Data Capture (polling, preferred for the agent):**

```http
GET /v3/company/{realmId}/cdc?entities=Invoice,Customer,Bill,Payment,Item&changedSince=2026-05-28T00:00:00-07:00
```

CDC returns **full objects** for everything changed since the timestamp in one call (cheaper than per-entity polling). `changedSince` accepts up to ~30 days back. Change-detection fields: `MetaData.LastUpdatedTime`, `SyncToken`. [DOCUMENTED]

---

## Idempotency, Async & Files

- **Idempotency:** GET is idempotent; POST-create is not — use the **`requestid`** query param to dedupe retried writes (`POST /invoice?requestid=abc123`). POST-update with `Id`+`SyncToken` is effectively idempotent via the lock. No header form of the key.
- **Async:** none — all writes (and `/batch`, ≤30 items) are synchronous.
- **Files:** `POST /upload` (multipart) attaches files via the `Attachable` entity; `GET /invoice/{id}/pdf` (with `Accept: application/pdf`) downloads a PDF; Attachable downloads via a `TempDownloadUri`.
- **Concurrency:** optimistic locking via `SyncToken` (increments per update; stale token → error 5010). **GET-then-update, always.**

---

## Known Limitations

1. Query dialect is restricted: **AND-only**, no `OR`/`JOIN`/parentheses; text matching is only `LIKE '%...%'`. For OR-style logic, run multiple queries or use CDC.
2. **No PUT** — create and update both go through `POST /{entity}`. A plain update **clears every omitted field**; you must send `"sparse": true` to do a partial update.
3. `Retry-After` / `X-RateLimit-*` headers are not reliably returned — implement client-side backoff.
4. No `[CONFIRMED]` live responses behind this reference — field names/wrappers verified against docs + SDKs only. Verify exact wrappers and empty-result shapes against a sandbox before trusting edge-case fields.

---

## SDKs & Tooling

| SDK                | Language | Repository                                   | Quality | Notes                                     |
| ------------------ | -------- | -------------------------------------------- | ------- | ----------------------------------------- |
| oauth-jsclient     | Node.js  | https://github.com/intuit/oauth-jsclient     | Good    | Official — OAuth/token handling only      |
| oauth-pythonclient | Python   | https://github.com/intuit/oauth-pythonclient | Good    | Official — OAuth/token handling only      |
| python-quickbooks  | Python   | https://github.com/ej2/python-quickbooks     | Good    | Community — useful to confirm field names |
| node-quickbooks    | Node.js  | (community)                                  | Fair    | Reference for entity shapes               |
| .NET / PHP / Java  | various  | Intuit official                              | Good    | Reference for CRUD semantics              |

**Postman collection:** https://developer.intuit.com/app/developer/qbo/docs/develop/tutorials/postman
**OpenAPI spec:** Not available (no official OpenAPI; Postman collection is the closest machine-readable artefact).

> Numa drives QBO through the relay (`connect_request` / `connectors(name="request", ...)`), so no SDK is embedded — SDKs are reference material for exact field names only.

---

## Integration Path Assessment

**Recommended path:** **Direct API via `connect_request`** (Direct API Only).

**Justification:** QuickBooks Online exposes transactional and name-list accounting entities (Invoice, Customer, Item, Bill, Payment) through a SQL-like query endpoint plus REST CRUD — there is no browsable file tree to surface in Files Remote. This mirrors the other accounting connectors (MYOB, Xero). The workspace agent issues `connect_request`-style calls through the Numa relay/proxy, which injects the stored OAuth bearer token and forwards to `https://quickbooks.api.intuit.com/v3/company/{realmId}/...`. The connector is **not** a Data Connector (Files).

**Connector compatibility:**

| Connector Method     | API Endpoint                                        | Feasibility |
| -------------------- | --------------------------------------------------- | ----------- |
| list_files           | n/a                                                 | none        |
| download_file        | `/invoice/{id}/pdf` (incidental only)               | partial     |
| search_files         | n/a                                                 | none        |
| get_file_metadata    | n/a                                                 | none        |
| request (direct API) | `/query`, `/{entity}`, `/batch`, `/cdc`, `/reports` | good        |

---

## Unknowns Requiring Live Testing

| Unknown                                  | Impact                    | How to Verify                                                |
| ---------------------------------------- | ------------------------- | ------------------------------------------------------------ |
| Exact response wrappers / field names    | Integration field mapping | `GET /companyinfo/{realmId}`, `GET /invoice/{id}` in sandbox |
| Empty-result shape (`QueryResponse: {}`) | Read parsing              | Run a query that matches zero rows in sandbox                |
| Current `minorversion` to pin            | Field behaviour stability | Confirm latest stable minor version at build time            |
| `Retry-After`/`X-RateLimit-*` presence   | Backoff strategy          | Trigger a 429 in sandbox; inspect headers                    |
| Null-check support in the query dialect  | Query correctness         | Test `WHERE Field = NULL`-style filters in sandbox           |

---

_Researched 2026-05-29. Source: `00-api-investigation-questionnaire.md` + Intuit official docs + official/community SDKs. No `[CONFIRMED]` live call._
