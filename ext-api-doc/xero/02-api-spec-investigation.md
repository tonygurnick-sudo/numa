---
api_name: 'Xero Accounting API'
api_slug: 'xero'
base_url: 'https://api.xero.com/api.xro/2.0'
version: 'api.xro/2.0'
spec_format: 'OpenAPI 3.0' # OpenAPI 3.x | Swagger 2.0 | custom | none
spec_url: 'https://github.com/XeroAPI/Xero-OpenAPI (xero_accounting.yaml)'
docs_url: 'https://developer.xero.com/documentation/api/accounting/overview'
date_researched: '2026-05-29'
---

# Xero Accounting API -- API Specification & Investigation

> Clean developer reference for the Xero Accounting API. This document is the condensed
> output of the investigation questionnaire (`00-api-investigation-questionnaire.md`) --
> everything a developer needs to integrate with this API, in one place.
>
> Confidence markers: **[CONFIRMED]** (live-verified), **[DOCUMENTED]** (in official Xero
> docs or the public OpenAPI spec), **[INFERRED]**, **[UNKNOWN]**.
>
> ⚠️ **No live OAuth token was captured during this investigation.** Field names and enums
> are sourced from the public `xero_accounting.yaml` OpenAPI spec (high confidence), but
> exact response envelopes (e.g. Microsoft `/Date()/` vs ISO date serialisation per field)
> are **[DOCUMENTED]**, not **[CONFIRMED]**. Confirm against a connected Demo Company.

---

## Overview

- **Vendor:** Xero Limited
- **API version:** `api.xro/2.0` (path version); OpenAPI spec semver ~v12.x
- **Base URL (data):** `https://api.xero.com/api.xro/2.0`
- **Base URL (tenant discovery):** `https://api.xero.com/connections` (NOT under `api.xro/2.0`)
- **Identity / token host:** `https://identity.xero.com`
- **Sandbox URL:** No separate sandbox host. Xero provides a **Demo Company** per organisation (toggle in the Xero UI, resets ~28 days). You call the same production base URL against the Demo Company's `tenantId`. — [DOCUMENTED]
- **API type:** REST (JSON default; legacy XML also supported — always send `Accept: application/json`)
- **Data format:** JSON
- **Documentation:** [developer.xero.com/documentation/api/accounting/overview](https://developer.xero.com/documentation/api/accounting/overview)
- **API reference:** [developer.xero.com/documentation/api/accounting/](https://developer.xero.com/documentation/api/accounting/)
- **OpenAPI spec:** [github.com/XeroAPI/Xero-OpenAPI](https://github.com/XeroAPI/Xero-OpenAPI) — `xero_accounting.yaml` (public, official, machine-readable — **treat as ground truth for fields/enums**)
- **Status page:** [status.xero.com](https://status.xero.com/)

**Summary:** Cloud accounting platform for small businesses. The Accounting API exposes
invoices/bills, contacts, the chart of accounts, payments, and bank transactions for a
connected Xero organisation. One OAuth token can be connected to many organisations
("tenants"); every data call must name the target org via the `Xero-tenant-id` header.

---

## Authentication

### Method: OAuth 2.0 (authorization-code flow with `offline_access`)

Bearer-token auth with a **mandatory `Xero-tenant-id` header on every data call**. The
registry entry (`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`,
`id: 'xero'`) declares `authType: 'oauth2'` with the exact `authUrl`/`tokenUrl`/`scopes`
reproduced below.

**Header format:**

```
Authorization: Bearer eyJ...            (30-min JWT access token)
Xero-tenant-id: 70784a63-d24b-46a9-...  (REQUIRED on data calls; omit only on GET /connections)
Accept: application/json                (always send — default is XML on some endpoints)
Content-Type: application/json          (POST/PUT bodies only)
```

**For OAuth 2.0:**

| Parameter         | Value                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grant type        | `authorization_code` (+ optional PKCE), `refresh_token`                                                                                                   |
| Authorization URL | `https://login.xero.com/identity/connect/authorize`                                                                                                       |
| Token URL         | `https://identity.xero.com/connect/token`                                                                                                                 |
| Revocation URL    | `https://identity.xero.com/connect/revocation`                                                                                                            |
| Token lifetime    | Access token **30 minutes**                                                                                                                               |
| Refresh mechanism | **Rotating / one-time-use** — each refresh returns a NEW refresh token and invalidates the old one; refresh token expires after **60 days of inactivity** |
| PKCE required     | Optional for web apps (recommended); required for the mobile/desktop PKCE flow                                                                            |

> The auth/token URLs above are the **exact** values in the connector registry. See
> `04-connection-and-reauth.md` for the full app-registration and refresh flow.

**Required scopes (the actual registry config):**

| Scope                          | Purpose                                                              | Required for integration? | Confidence   |
| ------------------------------ | -------------------------------------------------------------------- | ------------------------- | ------------ |
| `openid`                       | OpenID Connect — identifies the user                                 | Yes (in registry)         | [DOCUMENTED] |
| `profile`                      | User name/profile claims                                             | In registry               | [DOCUMENTED] |
| `email`                        | User email claim                                                     | In registry               | [DOCUMENTED] |
| `accounting.transactions.read` | **Read** Invoices, Bills, BankTransactions, CreditNotes, Payments    | Yes — core read scope     | [DOCUMENTED] |
| `accounting.contacts.read`     | **Read** Contacts and Contact Groups                                 | Yes — in registry         | [DOCUMENTED] |
| `offline_access`               | Returns a **refresh token** (required for long-lived/background use) | Yes — in registry         | [DOCUMENTED] |

> **⚠ Scope gap (IMPORTANT).** The registry scopes are **read-only** and **omit
> `accounting.settings.read`**. Consequence: `/Accounts` (chart of accounts), `/TaxRates`,
> `/Items`, and `/Organisation` require `accounting.settings.read` and will **403** as
> configured today. The task brief lists "accounts" as in-scope — to read the chart of
> accounts, add `accounting.settings.read` to the registry `scopes` string. Reports need
> `accounting.reports.read`. Writes need the non-`.read` scopes (`accounting.transactions`,
> `accounting.contacts`), which are also not present. — [DOCUMENTED]
>
> **Granular-scopes migration (timing note).** Xero is rolling out a new granular scope
> model; apps registered **on/after 2 March 2026** must use granular scopes from day one.
> Classic scopes above remain valid for existing apps. When registering a _new_ Xero app,
> confirm the exact granular scope strings against the live consent screen. — [DOCUMENTED]

---

## The Tenant-ID Two-Step (read this first)

This is the single most important thing about Xero — the equivalent of MYOB's
`businessId`, but expressed as a **header** rather than a path segment.

1. **`Xero-tenant-id` is mandatory on every data call** and is **NOT derivable from the
   access token.** A token can be connected to many organisations.
2. Your first call after auth **must** be `GET https://api.xero.com/connections` to
   enumerate the tenant ids the token can access.
3. Send the chosen `tenantId` as the `Xero-tenant-id` header on every subsequent call.
   Missing/invalid header → **401/403**.

```http
GET /connections HTTP/1.1
Host: api.xero.com
Authorization: Bearer {access_token}
Accept: application/json
```

```json
[
  {
    "id": "e1eede29-f875-4a5d-8470-17f6a29a88b1",
    "tenantId": "70784a63-d24b-46a9-a4db-0b70a274b056",
    "tenantType": "ORGANISATION",
    "tenantName": "Demo Company (NZ)",
    "createdDateUtc": "2024-07-01T18:07:09.6121490",
    "updatedDateUtc": "2024-07-01T18:07:09.6121490"
  }
]
```

[DOCUMENTED] https://developer.xero.com/documentation/guides/oauth2/tenants

---

## Endpoint Catalog

All data paths are relative to `https://api.xero.com/api.xro/2.0/`. Resource names are
**PascalCase and plural**. `GET /connections` is the only exception — it lives at the
`api.xero.com` root and takes **no** tenant header.

### Invoices (`accounting.transactions.read`)

| Method | Path                    | Purpose                                      | Auth | Paginated         | Idempotent |
| ------ | ----------------------- | -------------------------------------------- | ---- | ----------------- | ---------- |
| GET    | `/Invoices`             | List invoices/bills (filter/sort/page)       | Yes  | Yes (`page`, 100) | Yes        |
| GET    | `/Invoices/{InvoiceID}` | Get one invoice (full line items + payments) | Yes  | No                | Yes        |
| GET    | `/Invoices/{id}/pdf`    | Invoice PDF (`Accept: application/pdf`)      | Yes  | No                | Yes        |

> `{InvoiceID}` accepts a GUID **or** the human `InvoiceNumber`. POST/PUT exist but require
> the write scope `accounting.transactions` (not in registry).

### Contacts (`accounting.contacts.read`)

| Method | Path                    | Purpose             | Auth | Paginated | Idempotent |
| ------ | ----------------------- | ------------------- | ---- | --------- | ---------- |
| GET    | `/Contacts`             | List contacts       | Yes  | Yes       | Yes        |
| GET    | `/Contacts/{ContactID}` | Get one contact     | Yes  | No        | Yes        |
| GET    | `/ContactGroups`        | List contact groups | Yes  | No        | Yes        |

### Payments (`accounting.transactions.read`)

| Method | Path                    | Purpose         | Auth | Paginated | Idempotent |
| ------ | ----------------------- | --------------- | ---- | --------- | ---------- |
| GET    | `/Payments`             | List payments   | Yes  | Yes       | Yes        |
| GET    | `/Payments/{PaymentID}` | Get one payment | Yes  | No        | Yes        |

### Bank Transactions (`accounting.transactions.read`)

| Method | Path                     | Purpose                       | Auth | Paginated | Idempotent |
| ------ | ------------------------ | ----------------------------- | ---- | --------- | ---------- |
| GET    | `/BankTransactions`      | List spend/receive money txns | Yes  | Yes       | Yes        |
| GET    | `/BankTransactions/{id}` | Get one bank transaction      | Yes  | No        | Yes        |

### Accounts — ⚠ needs `accounting.settings.read` (not in registry → 403 today)

| Method | Path                    | Purpose           | Auth | Paginated | Idempotent |
| ------ | ----------------------- | ----------------- | ---- | --------- | ---------- |
| GET    | `/Accounts`             | Chart of accounts | Yes  | **No**    | Yes        |
| GET    | `/Accounts/{AccountID}` | Get one account   | Yes  | No        | Yes        |

### Full Endpoint Index

| #   | Method       | Path                             | Purpose                            | Notes                                             |
| --- | ------------ | -------------------------------- | ---------------------------------- | ------------------------------------------------- |
| 1   | GET          | `/connections`                   | List connected tenants             | host `api.xero.com`, **no** tenant header         |
| 2   | GET          | `/api.xro/2.0/Organisation`      | Org details                        | ⚠ needs `accounting.settings.read`                |
| 3   | GET/POST/PUT | `/api.xro/2.0/Invoices`          | Invoices/bills                     | write needs `accounting.transactions`             |
| 4   | GET          | `/api.xro/2.0/Invoices/{id}`     | One invoice                        | by GUID or InvoiceNumber                          |
| 5   | GET          | `/api.xro/2.0/Invoices/{id}/pdf` | Invoice PDF                        | `Accept: application/pdf`                         |
| 6   | GET/POST/PUT | `/api.xro/2.0/Contacts`          | Contacts                           | registry has read scope                           |
| 7   | GET          | `/api.xro/2.0/ContactGroups`     | Contact groups                     | —                                                 |
| 8   | GET/POST/PUT | `/api.xro/2.0/Accounts`          | Chart of accounts                  | ⚠ needs `accounting.settings.read`                |
| 9   | GET/POST     | `/api.xro/2.0/Payments`          | Payments                           | delete via status change                          |
| 10  | GET/POST/PUT | `/api.xro/2.0/BankTransactions`  | Spend/receive money                | supports `If-Modified-Since`                      |
| 11  | GET          | `/api.xro/2.0/BankTransfers`     | Transfers between bank accounts    | —                                                 |
| 12  | GET/POST/PUT | `/api.xro/2.0/CreditNotes`       | Credit notes                       | —                                                 |
| 13  | GET          | `/api.xro/2.0/Items`             | Inventory items                    | ⚠ needs `accounting.settings.read`                |
| 14  | GET          | `/api.xro/2.0/TaxRates`          | Tax rates                          | ⚠ needs `accounting.settings.read`                |
| 15  | GET          | `/api.xro/2.0/Reports/{report}`  | P&L, BalanceSheet, AgedReceivables | ⚠ needs `accounting.reports.read`                 |
| 16  | GET          | `/api.xro/2.0/Journals`          | GL journals                        | cursor via `offset`; ⚠ `accounting.journals.read` |

[DOCUMENTED] https://developer.xero.com/documentation/api/accounting/

---

## Data Models

Field names and enums below are from the official `xero_accounting.yaml` OpenAPI spec. Only
the in-scope read entities are detailed; for the full domain model (state machines,
relationships, enums) see the companion `01a-domain-model-reference.md`.

### Invoice

| Field                                         | Type     | Required (write) | Writable    | Description                                             |
| --------------------------------------------- | -------- | ---------------- | ----------- | ------------------------------------------------------- |
| `InvoiceID`                                   | GUID     | system           | no          | Unique id                                               |
| `Type`                                        | enum     | yes              | on create   | `ACCREC` (sales) / `ACCPAY` (bill)                      |
| `InvoiceNumber`                               | string   | no               | yes         | Human number, e.g. `INV-0042`                           |
| `Reference`                                   | string   | no               | yes         | ACCREC reference                                        |
| `Contact`                                     | object   | yes              | yes         | `{ "ContactID": "..." }` or `{ "Name": "..." }`         |
| `Date` / `DueDate`                            | date     | no               | yes         | Invoice / due date                                      |
| `LineItems`                                   | array    | yes              | yes         | Description, Quantity, UnitAmount, AccountCode, TaxType |
| `LineAmountTypes`                             | enum     | no               | yes         | `Exclusive` / `Inclusive` / `NoTax`                     |
| `Status`                                      | enum     | no               | via actions | See state machine in `01a`                              |
| `SubTotal` / `TotalTax` / `Total`             | decimal  | computed         | no          | Server-computed totals                                  |
| `AmountDue` / `AmountPaid` / `AmountCredited` | decimal  | computed         | no          | Payment tracking                                        |
| `CurrencyCode`                                | string   | no               | yes         | ISO currency, e.g. `NZD`                                |
| `UpdatedDateUTC`                              | datetime | system           | no          | **Last-modified — key for incremental sync**            |
| `HasAttachments`                              | bool     | system           | no          | Attachment flag                                         |

**Relationships:** Contact (many-to-one, nested `Contact.ContactID`); Payments
(one-to-many, nested `Payments[]`); CreditNotes (one-to-many); per-line `AccountCode` →
Account.

### Contact

| Field                       | Type     | Writable | Description                           |
| --------------------------- | -------- | -------- | ------------------------------------- |
| `ContactID`                 | GUID     | no       | Unique id                             |
| `Name`                      | string   | yes      | Display name — **unique per org**     |
| `ContactNumber`             | string   | yes      | External ref                          |
| `FirstName` / `LastName`    | string   | yes      | Primary person                        |
| `EmailAddress`              | string   | yes      | Primary email                         |
| `ContactStatus`             | enum     | yes      | `ACTIVE` / `ARCHIVED` / `GDPRREQUEST` |
| `Addresses` / `Phones`      | array    | yes      | Address & phone collections           |
| `IsCustomer` / `IsSupplier` | bool     | no       | Derived flags                         |
| `UpdatedDateUTC`            | datetime | no       | Last-modified                         |

### Payment

| Field         | Type    | Writable | Description                                                            |
| ------------- | ------- | -------- | ---------------------------------------------------------------------- |
| `PaymentID`   | GUID    | no       | Unique id                                                              |
| `Date`        | date    | yes      | Payment date                                                           |
| `Amount`      | decimal | yes      | Payment amount                                                         |
| `Reference`   | string  | yes      | Reference                                                              |
| `Invoice`     | object  | yes      | `{ "InvoiceID": "..." }` — the document paid                           |
| `Account`     | object  | yes      | Bank / clearing account                                                |
| `PaymentType` | enum    | no       | `ACCRECPAYMENT`, `ACCPAYPAYMENT`, `ARCREDITPAYMENT`, `APCREDITPAYMENT` |
| `Status`      | enum    | no       | `AUTHORISED` / `DELETED`                                               |

### BankTransaction

| Field                                      | Type     | Writable | Description                                                                                              |
| ------------------------------------------ | -------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `BankTransactionID`                        | GUID     | no       | Unique id                                                                                                |
| `Type`                                     | enum     | yes      | `RECEIVE`, `SPEND`, `RECEIVE-OVERPAYMENT`, `RECEIVE-PREPAYMENT`, `SPEND-OVERPAYMENT`, `SPEND-PREPAYMENT` |
| `Status`                                   | enum     | no       | `AUTHORISED`, `DELETED` (`DRAFT` in some flows)                                                          |
| `Contact`                                  | object   | yes      | Counterparty                                                                                             |
| `BankAccount`                              | object   | yes      | `{ "AccountID": "..." }` — must be a BANK account                                                        |
| `LineItems`                                | array    | yes      | Lines                                                                                                    |
| `IsReconciled`                             | bool     | no       | Reconciliation flag                                                                                      |
| `Date` / `Total` / `SubTotal` / `TotalTax` | —        | —        | Standard amounts                                                                                         |
| `UpdatedDateUTC`                           | datetime | no       | Last-modified                                                                                            |

### Account (Chart of Accounts) — ⚠ needs `accounting.settings.read`

| Field               | Type   | Writable | Description                                                                                    |
| ------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------- |
| `AccountID`         | GUID   | no       | Unique id                                                                                      |
| `Code`              | string | yes      | Account code (referenced by line items), e.g. `200`                                            |
| `Name`              | string | yes      | Account name, e.g. `Sales`                                                                     |
| `Type`              | enum   | yes      | `BANK`, `REVENUE`, `EXPENSE`, `CURRENT`, `FIXED`, `EQUITY`, `LIABILITY`, … (full enum in spec) |
| `Status`            | enum   | yes      | `ACTIVE` / `ARCHIVED`                                                                          |
| `TaxType`           | string | yes      | Default tax code                                                                               |
| `BankAccountNumber` | string | yes      | BANK accounts only                                                                             |

### Field Format Reference

| Format                      | Pattern                     | Example                                | Notes                                         |
| --------------------------- | --------------------------- | -------------------------------------- | --------------------------------------------- |
| Date (request)              | `YYYY-MM-DD`                | `2024-06-01`                           | Accepted in JSON request bodies               |
| DateTime (response, legacy) | `/Date(epoch_ms+tzoffset)/` | `/Date(1717272000000+0000)/`           | Microsoft JSON format — **parse defensively** |
| DateTime (`*UTC` fields)    | ISO-like                    | `2024-06-02T10:00:00`                  | `UpdatedDateUTC` etc. — prefer for sync       |
| Currency / decimal          | plain decimal               | `100.00`                               | No thousands separators                       |
| ID format                   | GUID v4                     | `297c2dc5-cc47-4afd-8ec8-74990b8761e9` | All `*ID` fields                              |
| Enum values                 | UPPERCASE                   | `AUTHORISED`, `ACCREC`                 | Status/Type enums                             |
| `LineAmountTypes`           | PascalCase                  | `Exclusive`                            | Exception — not uppercase                     |

---

## Query & Filtering

The `where` parameter takes a (URL-encoded) filter expression; `order` takes a sort clause.

```
GET /api.xro/2.0/Invoices?where=Status=="AUTHORISED"
GET /api.xro/2.0/Invoices?where=Type=="ACCREC"&&AmountDue>0
GET /api.xro/2.0/Contacts?where=Name.Contains("Smith")
GET /api.xro/2.0/Payments?where=Date>=DateTime(2024,06,01)&&Date<DateTime(2024,07,01)&order=Date DESC
```

| Capability                    | Supported? | Syntax / notes                                              |
| ----------------------------- | ---------- | ----------------------------------------------------------- | --- | --------------------------- |
| Equality (optimised)          | yes        | `Status=="AUTHORISED"` — fast on optimised fields           |
| Date range                    | yes        | `Date>=DateTime(2024,01,01)&&Date<DateTime(2024,12,31)`     |
| GUID match                    | yes        | `Contact.ContactID==guid("...")`                            |
| String contains/starts/ends   | partial    | `.Contains()`, `.StartsWith()`, `.EndsWith()` — unoptimised |
| Logical AND / OR              | yes        | `&&` / `                                                    |     | `, parentheses for grouping |
| Comparison `>`, `<`, `!=`     | yes        | unoptimised on large orgs                                   |
| Sort                          | yes        | `order=Date DESC` / `order=UpdatedDateUTC DESC`             |
| Per-resource free-text search | partial    | `searchTerm=...` on Invoices/Contacts                       |
| Sparse response               | partial    | `summaryOnly=true` omits line items (faster lists)          |
| Aggregate / count             | no         | use Reports endpoints                                       |

> **Performance:** Xero strongly recommends `==` equality on a small set of "optimised
> fields". `.Contains()`, `>`, `<`, and nested-field filters are unoptimised and can time
> out on large orgs — for bulk pulls prefer the `If-Modified-Since` header + `page` walk
> over a heavy `where`. — [DOCUMENTED]

---

## Pagination

- **Type:** page-number (1-based) on list endpoints. `/Accounts`, `/TaxRates`, `/Items`,
  `/Organisation` are **not paged** (return the full set). Journals use an `offset` cursor.
- **Default page size:** 100 records per page when `page` is supplied.
- **Max page size:** `pageSize` up to **1000** on resources that support it.
- **Total count:** available — when `page` is supplied the envelope includes a `Pagination`
  object with `itemCount` and `pageCount`.

**Parameters:**

| Parameter  | Type | Default | Description                                            |
| ---------- | ---- | ------- | ------------------------------------------------------ |
| `page`     | int  | 1       | 1-based page number; enables paging + caps at 100/page |
| `pageSize` | int  | 100     | Records per page (max 1000 on supported resources)     |

**Response structure (when `page` supplied):**

```json
{
  "Status": "OK",
  "Invoices": [
    /* up to 100 (or pageSize) items */
  ],
  "Pagination": { "page": 1, "pageSize": 100, "pageCount": 5, "itemCount": 437 }
}
```

**Last page detection:** stop when `page >= Pagination.pageCount` (or when the returned
array length `< pageSize`). For incremental sync, set `If-Modified-Since` once and walk
`page=1..pageCount`. — [DOCUMENTED]

---

## Rate Limits

| Scope               | Limit        | Window      | Notes              |
| ------------------- | ------------ | ----------- | ------------------ |
| Per tenant (minute) | 60 calls     | rolling 60s | per connected org  |
| Per tenant (day)    | 5,000 calls  | 24h         | per connected org  |
| Concurrent          | 5 in-flight  | —           | per tenant         |
| App-wide (minute)   | 10,000 calls | rolling 60s | across all tenants |

**Headers (on every response):**

| Header                    | Meaning                                          |
| ------------------------- | ------------------------------------------------ |
| `X-MinLimit-Remaining`    | calls left this minute (tenant)                  |
| `X-DayLimit-Remaining`    | calls left today (tenant)                        |
| `X-AppMinLimit-Remaining` | calls left this minute (app-wide)                |
| `Retry-After`             | seconds to wait (on 429 only)                    |
| `X-Rate-Limit-Problem`    | which limit was hit: `minute`/`day`/`concurrent` |
| `Xero-Correlation-Id`     | trace id — quote in support tickets              |

**When exceeded:** HTTP **429 Too Many Requests** with a `Retry-After` header.

```json
{
  "Type": null,
  "Title": "Rate limit exceeded",
  "Status": 429,
  "Detail": "The API rate limit for your application/organisation has been reached. The minute limit is 60. Please try again in 1 seconds."
}
```

**Recommended strategy:** honour `Retry-After` exactly on 429; exponential backoff + jitter
on 5xx; track `X-MinLimit-Remaining` to throttle proactively; spread tenants out to stay
under the 10,000/min app-wide ceiling. — [DOCUMENTED]
https://developer.xero.com/documentation/guides/oauth2/limits/

---

## Error Handling

**Standard validation error format:**

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

**Status codes:**

| Status | Meaning                                                   | Retryable           | Recovery                                                          |
| ------ | --------------------------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| 400    | Bad request / malformed `where`/`order`                   | No                  | Fix query syntax                                                  |
| 401    | Expired/invalid token OR missing/invalid `Xero-tenant-id` | Yes (after refresh) | Refresh token; verify tenant header; retry once                   |
| 403    | Token lacks the required scope                            | No                  | Config issue (e.g. add `accounting.settings.read`) — do NOT retry |
| 404    | Record/tenant not found                                   | No                  | Verify id + tenant                                                |
| 405    | Method not allowed                                        | No                  | Wrong verb for resource                                           |
| 412    | Precondition failed                                       | No                  | Check headers                                                     |
| 429    | Rate limit exceeded                                       | Yes                 | Honour `Retry-After`                                              |
| 500    | Internal server error                                     | Yes                 | Backoff + retry; quote `Xero-Correlation-Id`                      |
| 503    | Service unavailable / throttling                          | Yes                 | Backoff + retry                                                   |

[DOCUMENTED] https://developer.xero.com/documentation/api/accounting/responsecodes

> **Idempotency:** Xero supports an `Idempotency-Key` request header on create endpoints
> (~24h window). **Quirk:** in Xero, **PUT = create new** and **POST = create-or-update
> (upsert by id)** — the opposite of most REST APIs and a common source of duplicates. Not
> relevant while read-only, but critical if writes are ever enabled. — [DOCUMENTED]

---

## Webhooks / Events

Webhooks **ARE** supported (a notable advantage over MYOB, which has none), but cover only
**Invoice + Contact create/update** events. The read-only connector does not register them.

- **Registration:** Xero developer portal UI (per app) — set delivery URL, get a webhook
  signing key. Delivery URL must be HTTPS, publicly reachable, and respond `200` within 5s.
- **Activation:** "Intent to Receive" handshake — validate the signature, respond `200`
  (valid) / `401` (invalid).
- **Payloads are ID-only** — `resourceId`, `tenantId`, `eventCategory`, `eventType`,
  `eventDateUtc`. You must call the API (`resourceUrl`) with the right `Xero-tenant-id` to
  fetch the changed record.
- **Verification:** `x-xero-signature` header = base64(HMAC-SHA256(raw_body, signing_key));
  constant-time compare against the **raw** (un-reparsed) body.
- **Retry policy:** Xero retries failed deliveries with backoff over ~24h, then disables the
  webhook. Duplicate delivery is possible — design idempotent handlers.

**Polling fallback (what this connector uses):** list endpoints + `If-Modified-Since:
{RFC1123}` header (preferred) or `where=UpdatedDateUTC>=DateTime(...)`. Change-detection
field is `UpdatedDateUTC`. A few-minutes cadence sits comfortably under 60/min/tenant. — [DOCUMENTED]

---

## Known Limitations

1. **Read-only as configured.** Registry scopes are `*.read` only — no create/modify/void/
   delete. Writes need `accounting.transactions` / `accounting.contacts` (not enabled).
2. **Scope gap → 403s.** `/Accounts`, `/Items`, `/TaxRates`, `/Organisation` need
   `accounting.settings.read`; reports need `accounting.reports.read`. Neither is in the
   registry scopes, so these calls 403 today (config issue, not transient — don't retry).
3. **Multi-tenant ambiguity.** One token can serve many orgs; always resolve/confirm the
   target `tenantId` (via `GET /connections`) before answering.
4. **Mixed date formats.** Legacy `/Date(...)/` vs ISO `*UTC` — parse defensively; prefer
   `UpdatedDateUTC` for ordering.
5. **Refresh-token rotation.** One-time-use refresh tokens; the storage layer must persist
   the new token on every refresh or background use breaks with `invalid_grant`.
6. **No live [CONFIRMED] capture.** Response envelopes are spec-/doc-sourced — confirm exact
   per-field date serialisation against a connected Demo Company.

---

## SDKs & Tooling

| SDK                | Language | Repository                      | Quality                    | Notes                                    |
| ------------------ | -------- | ------------------------------- | -------------------------- | ---------------------------------------- |
| `xero-python`      | Python   | github.com/XeroAPI/xero-python  | high (generated from spec) | Reference; raw HTTP via proxy is simpler |
| `xero-node`        | Node.js  | github.com/XeroAPI/xero-node    | high                       | Reference only                           |
| `Xero-OpenAPI`     | spec     | github.com/XeroAPI/Xero-OpenAPI | authoritative              | **Field/enum ground truth**              |
| PHP/Ruby/.NET/Java | various  | github.com/XeroAPI              | high (all first-party)     | Reference                                |

**Postman collection:** https://www.postman.com/xeroapi/workspace/xeroapi
**OpenAPI spec:** https://github.com/XeroAPI/Xero-OpenAPI (`xero_accounting.yaml`, `xero-webhooks.yaml`)

---

## Integration Path Assessment

**Recommended path:** **Direct API Only** (via the connector's `connect_request` proxy).

**Justification:** Xero is a structured accounting **records-and-actions** API (invoices,
contacts, accounts, payments, bank transactions), not a file/document browser. It matches
the same path as MYOB AccountRight, simPRO, Jobber, etc. in this codebase. The workspace
agent makes authenticated calls through the connector's `connect_request` proxy (OAuth2
token + `Xero-tenant-id` header injected per call). It is **not** a `Data Connector (Files)`
integration — there is no `list_files`/`download_file` surface to map. The registry already
declares `authType: 'oauth2'` with the correct `authUrl`/`tokenUrl`, confirming the
Direct-API/OAuth2 shape.

**Connector compatibility (Files-connector methods do not apply — shown for completeness):**

| Connector Method  | API Endpoint                | Feasibility |
| ----------------- | --------------------------- | ----------- |
| list_files        | n/a — records, not files    | none        |
| download_file     | `/Invoices/{id}/pdf` (only) | partial     |
| search_files      | n/a — `where`/`searchTerm`  | none        |
| get_file_metadata | n/a                         | none        |

**Build callouts (must be addressed before build):**

1. **`/connections` bootstrap.** First call after auth must enumerate tenant ids; send
   `Xero-tenant-id` on everything else.
2. **Scope gap fix.** Add `accounting.settings.read` to the registry `scopes` if chart-of-
   accounts reads are required; `accounting.reports.read` for reports.
3. **Refresh-token rotation.** Persist the rotated refresh token after every refresh.

---

_Researched on 2026-05-29. Source: `00-api-investigation-questionnaire.md` + official Xero
docs and the public `xero_accounting.yaml` OpenAPI spec. See also `01-llm-api-rules.md`
(+ `01a`–`01d`) for the workspace-agent knowledge pack and `03-connector-setup.md` /
`04-connection-and-reauth.md` for build instructions._
