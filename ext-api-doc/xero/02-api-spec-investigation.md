---
api_name: Xero Accounting API
api_slug: xero
base_url_data: https://api.xero.com/api.xro/2.0
base_url_connections: https://api.xero.com/connections (api.xero.com ROOT, no tenant header)
identity_host: https://identity.xero.com
path_version_segment: api.xro/2.0 (LITERAL path segment on every data path; NOT a "/v2.0/" label; OpenAPI spec semver ~v12.x is a separate thing)
spec_format: OpenAPI 3.0
spec_url: https://github.com/XeroAPI/Xero-OpenAPI (xero_accounting.yaml) — treat as ground truth for fields/enums
docs_url: https://developer.xero.com/documentation/api/accounting/overview
status_page: https://status.xero.com/
date_researched: 2026-05-29
confidence: field names/enums [DOCUMENTED] from public xero_accounting.yaml (high confidence); exact response envelopes (/Date()/ vs ISO per field) [DOCUMENTED] not [CONFIRMED] — no live OAuth token captured; confirm against a connected Demo Company
---

# Xero — API Specification & Investigation

Condensed developer reference (from `00-api-investigation-questionnaire.md`). Markers: **[CONFIRMED]** live-verified, **[DOCUMENTED]** in official docs/public OpenAPI spec, **[INFERRED]**, **[UNKNOWN]**. All facts [DOCUMENTED] unless tagged otherwise.

## Overview

- Vendor: Xero Limited. API type: REST (JSON default; legacy XML supported — always send `Accept: application/json`).
- Base URL (data): `https://api.xero.com/api.xro/2.0`. Base URL (tenant discovery): `https://api.xero.com/connections` (NOT under `api.xro/2.0`). Identity/token host: `https://identity.xero.com`.
- Sandbox: no separate host. Xero provides a **Demo Company** per org (toggle in Xero UI, resets ~28 days); call the same production base URL against the Demo Company's `tenantId`.
- Summary: cloud accounting for small businesses. The Accounting API exposes invoices/bills, contacts, chart of accounts, payments, bank transactions for a connected org. One OAuth token can connect to many orgs ("tenants"); every data call names the target org via the `Xero-tenant-id` header.

## Authentication

**OAuth 2.0** (authorization-code flow with `offline_access`). Bearer-token auth + mandatory `Xero-tenant-id` header on every data call. Registry entry: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`, `id: 'xero'`, `authType: 'oauth2'`.

Header format:

```
Authorization: Bearer eyJ...            (30-min JWT access token)
Xero-tenant-id: 70784a63-d24b-46a9-...  (REQUIRED on data calls; omit only on GET /connections)
Accept: application/json                (always send — default is XML on some endpoints)
Content-Type: application/json          (POST/PUT bodies only)
```

| OAuth Parameter   | Value                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Grant type        | `authorization_code` (+ optional PKCE), `refresh_token`                                                                              |
| Authorization URL | `https://login.xero.com/identity/connect/authorize`                                                                                  |
| Token URL         | `https://identity.xero.com/connect/token`                                                                                            |
| Revocation URL    | `https://identity.xero.com/connect/revocation`                                                                                       |
| Token lifetime    | access token **30 minutes**                                                                                                          |
| Refresh mechanism | **rotating / one-time-use** — each refresh returns a NEW refresh token and invalidates the old; expires after **60 days inactivity** |
| PKCE required     | optional for web apps (recommended); required for the mobile/desktop PKCE flow                                                       |

> Auth/token URLs above are the **exact** registry values. Full app-registration + refresh flow in `04-connection-and-reauth.md`.

Required scopes (the actual registry config, all [DOCUMENTED]):
| Scope | Purpose |
| --- | --- |
| `openid` | OpenID Connect — identifies the user |
| `profile` | user name/profile claims |
| `email` | user email claim |
| `accounting.transactions.read` | **read** Invoices, Bills, BankTransactions, CreditNotes, Payments (core read scope) |
| `accounting.contacts.read` | **read** Contacts and Contact Groups |
| `offline_access` | returns a **refresh token** (required for long-lived/background use) |

> **⚠ Scope gap (IMPORTANT).** Registry scopes are **read-only** and **omit `accounting.settings.read`**. Consequence: `/Accounts` (chart of accounts), `/TaxRates`, `/Items`, `/Organisation` need `accounting.settings.read` and **403** as configured today. To read the chart of accounts, add `accounting.settings.read` to the registry `scopes` string. Reports need `accounting.reports.read`. Writes need the non-`.read` scopes (`accounting.transactions`, `accounting.contacts`), also absent.
> **Granular-scopes migration (timing).** Xero is rolling out a new granular scope model; apps registered **on/after 2 March 2026** must use granular scopes from day one. Classic scopes above remain valid for existing apps. When registering a _new_ Xero app, confirm the exact granular scope strings against the live consent screen.

## The Tenant-ID Two-Step (read this first)

The single most important thing about Xero — equivalent of MYOB's `businessId`, but a **header** not a path segment.

1. `Xero-tenant-id` mandatory on every data call, **NOT derivable from the access token.** A token can connect to many orgs.
2. First call after auth **must** be `GET https://api.xero.com/connections` to enumerate accessible tenant ids.
3. Send the chosen `tenantId` as the `Xero-tenant-id` header on every subsequent call. Missing/invalid → **401/403**.

`GET /connections` (host `api.xero.com`, Bearer + `Accept: application/json`, NO tenant header)
→ `[{"id":"e1eede29-f875-4a5d-8470-17f6a29a88b1","tenantId":"70784a63-d24b-46a9-a4db-0b70a274b056","tenantType":"ORGANISATION","tenantName":"Demo Company (NZ)","createdDateUtc":"2024-07-01T18:07:09.6121490","updatedDateUtc":"2024-07-01T18:07:09.6121490"}]`
(https://developer.xero.com/documentation/guides/oauth2/tenants)

## Endpoint Catalog

All data paths relative to `https://api.xero.com/api.xro/2.0/`. Resource names **PascalCase + plural**. `GET /connections` is the only exception — at the `api.xero.com` root, **no** tenant header.

### Invoices (`accounting.transactions.read`)

| Method | Path                    | Purpose                                 | Paginated         | Idempotent |
| ------ | ----------------------- | --------------------------------------- | ----------------- | ---------- |
| GET    | `/Invoices`             | list invoices/bills (filter/sort/page)  | yes (`page`, 100) | yes        |
| GET    | `/Invoices/{InvoiceID}` | get one (full line items + payments)    | no                | yes        |
| GET    | `/Invoices/{id}/pdf`    | invoice PDF (`Accept: application/pdf`) | no                | yes        |

> `{InvoiceID}` accepts a GUID **or** the human `InvoiceNumber`. POST/PUT exist but need write scope `accounting.transactions` (not in registry).

### Contacts (`accounting.contacts.read`)

| Method | Path                    | Purpose             | Paginated |
| ------ | ----------------------- | ------------------- | --------- |
| GET    | `/Contacts`             | list contacts       | yes       |
| GET    | `/Contacts/{ContactID}` | get one contact     | no        |
| GET    | `/ContactGroups`        | list contact groups | no        |

### Payments (`accounting.transactions.read`)

| Method | Path                    | Purpose         | Paginated |
| ------ | ----------------------- | --------------- | --------- |
| GET    | `/Payments`             | list payments   | yes       |
| GET    | `/Payments/{PaymentID}` | get one payment | no        |

### Bank Transactions (`accounting.transactions.read`)

| Method | Path                     | Purpose                       | Paginated |
| ------ | ------------------------ | ----------------------------- | --------- |
| GET    | `/BankTransactions`      | list spend/receive money txns | yes       |
| GET    | `/BankTransactions/{id}` | get one                       | no        |

### Accounts — ⚠ needs `accounting.settings.read` (not in registry → 403 today)

| Method | Path                    | Purpose           | Paginated |
| ------ | ----------------------- | ----------------- | --------- |
| GET    | `/Accounts`             | chart of accounts | **No**    |
| GET    | `/Accounts/{AccountID}` | get one account   | no        |

### Full Endpoint Index

| #   | Method       | Path                             | Purpose                            | Notes                                             |
| --- | ------------ | -------------------------------- | ---------------------------------- | ------------------------------------------------- |
| 1   | GET          | `/connections`                   | list connected tenants             | host `api.xero.com`, **no** tenant header         |
| 2   | GET          | `/api.xro/2.0/Organisation`      | org details                        | ⚠ needs `accounting.settings.read`                |
| 3   | GET/POST/PUT | `/api.xro/2.0/Invoices`          | invoices/bills                     | write needs `accounting.transactions`             |
| 4   | GET          | `/api.xro/2.0/Invoices/{id}`     | one invoice                        | by GUID or InvoiceNumber                          |
| 5   | GET          | `/api.xro/2.0/Invoices/{id}/pdf` | invoice PDF                        | `Accept: application/pdf`                         |
| 6   | GET/POST/PUT | `/api.xro/2.0/Contacts`          | contacts                           | registry has read scope                           |
| 7   | GET          | `/api.xro/2.0/ContactGroups`     | contact groups                     | —                                                 |
| 8   | GET/POST/PUT | `/api.xro/2.0/Accounts`          | chart of accounts                  | ⚠ needs `accounting.settings.read`                |
| 9   | GET/POST     | `/api.xro/2.0/Payments`          | payments                           | delete via status change                          |
| 10  | GET/POST/PUT | `/api.xro/2.0/BankTransactions`  | spend/receive money                | supports `If-Modified-Since`                      |
| 11  | GET          | `/api.xro/2.0/BankTransfers`     | transfers between bank accounts    | —                                                 |
| 12  | GET/POST/PUT | `/api.xro/2.0/CreditNotes`       | credit notes                       | —                                                 |
| 13  | GET          | `/api.xro/2.0/Items`             | inventory items                    | ⚠ needs `accounting.settings.read`                |
| 14  | GET          | `/api.xro/2.0/TaxRates`          | tax rates                          | ⚠ needs `accounting.settings.read`                |
| 15  | GET          | `/api.xro/2.0/Reports/{report}`  | P&L, BalanceSheet, AgedReceivables | ⚠ needs `accounting.reports.read`                 |
| 16  | GET          | `/api.xro/2.0/Journals`          | GL journals                        | cursor via `offset`; ⚠ `accounting.journals.read` |

(https://developer.xero.com/documentation/api/accounting/)

## Data Models

Fields/enums from `xero_accounting.yaml`. Only in-scope read entities detailed; full domain model (state machines, relationships, all enums) in `01a`.

### Invoice

| Field                                     | Type     | Required(write) | Writable    | Description                                             |
| ----------------------------------------- | -------- | --------------- | ----------- | ------------------------------------------------------- |
| `InvoiceID`                               | GUID     | system          | no          | unique id                                               |
| `Type`                                    | enum     | yes             | on create   | `ACCREC` (sales) / `ACCPAY` (bill)                      |
| `InvoiceNumber`                           | string   | no              | yes         | human number e.g. `INV-0042`                            |
| `Reference`                               | string   | no              | yes         | ACCREC reference                                        |
| `Contact`                                 | object   | yes             | yes         | `{"ContactID":"..."}` or `{"Name":"..."}`               |
| `Date`/`DueDate`                          | date     | no              | yes         | invoice / due date                                      |
| `LineItems`                               | array    | yes             | yes         | Description, Quantity, UnitAmount, AccountCode, TaxType |
| `LineAmountTypes`                         | enum     | no              | yes         | `Exclusive`/`Inclusive`/`NoTax`                         |
| `Status`                                  | enum     | no              | via actions | see state machine in 01a                                |
| `SubTotal`/`TotalTax`/`Total`             | decimal  | computed        | no          | server-computed totals                                  |
| `AmountDue`/`AmountPaid`/`AmountCredited` | decimal  | computed        | no          | payment tracking                                        |
| `CurrencyCode`                            | string   | no              | yes         | ISO currency e.g. `NZD`                                 |
| `UpdatedDateUTC`                          | datetime | system          | no          | **last-modified — key for incremental sync**            |
| `HasAttachments`                          | bool     | system          | no          | attachment flag                                         |

Relationships: Contact N:1 (nested `Contact.ContactID`); Payments 1:N (nested `Payments[]`); CreditNotes 1:N; per-line `AccountCode` → Account.

### Contact

| Field                     | Type     | Writable | Description                       |
| ------------------------- | -------- | -------- | --------------------------------- |
| `ContactID`               | GUID     | no       | unique id                         |
| `Name`                    | string   | yes      | display name — **unique per org** |
| `ContactNumber`           | string   | yes      | external ref                      |
| `FirstName`/`LastName`    | string   | yes      | primary person                    |
| `EmailAddress`            | string   | yes      | primary email                     |
| `ContactStatus`           | enum     | yes      | `ACTIVE`/`ARCHIVED`/`GDPRREQUEST` |
| `Addresses`/`Phones`      | array    | yes      | address & phone collections       |
| `IsCustomer`/`IsSupplier` | bool     | no       | derived flags                     |
| `UpdatedDateUTC`          | datetime | no       | last-modified                     |

### Payment

| Field         | Type    | Writable | Description                                                         |
| ------------- | ------- | -------- | ------------------------------------------------------------------- |
| `PaymentID`   | GUID    | no       | unique id                                                           |
| `Date`        | date    | yes      | payment date                                                        |
| `Amount`      | decimal | yes      | payment amount                                                      |
| `Reference`   | string  | yes      | reference                                                           |
| `Invoice`     | object  | yes      | `{"InvoiceID":"..."}` — the document paid                           |
| `Account`     | object  | yes      | bank / clearing account                                             |
| `PaymentType` | enum    | no       | `ACCRECPAYMENT`,`ACCPAYPAYMENT`,`ARCREDITPAYMENT`,`APCREDITPAYMENT` |
| `Status`      | enum    | no       | `AUTHORISED`/`DELETED`                                              |

### BankTransaction

| Field                                | Type     | Writable | Description                                                                                         |
| ------------------------------------ | -------- | -------- | --------------------------------------------------------------------------------------------------- |
| `BankTransactionID`                  | GUID     | no       | unique id                                                                                           |
| `Type`                               | enum     | yes      | `RECEIVE`,`SPEND`,`RECEIVE-OVERPAYMENT`,`RECEIVE-PREPAYMENT`,`SPEND-OVERPAYMENT`,`SPEND-PREPAYMENT` |
| `Status`                             | enum     | no       | `AUTHORISED`,`DELETED` (`DRAFT` in some flows)                                                      |
| `Contact`                            | object   | yes      | counterparty                                                                                        |
| `BankAccount`                        | object   | yes      | `{"AccountID":"..."}` — must be a BANK account                                                      |
| `LineItems`                          | array    | yes      | lines                                                                                               |
| `IsReconciled`                       | bool     | no       | reconciliation flag                                                                                 |
| `Date`/`Total`/`SubTotal`/`TotalTax` | —        | —        | standard amounts                                                                                    |
| `UpdatedDateUTC`                     | datetime | no       | last-modified                                                                                       |

### Account (Chart of Accounts) — ⚠ needs `accounting.settings.read`

| Field               | Type   | Writable | Description                                                                                 |
| ------------------- | ------ | -------- | ------------------------------------------------------------------------------------------- |
| `AccountID`         | GUID   | no       | unique id                                                                                   |
| `Code`              | string | yes      | account code (referenced by line items) e.g. `200`                                          |
| `Name`              | string | yes      | account name e.g. `Sales`                                                                   |
| `Type`              | enum   | yes      | `BANK`,`REVENUE`,`EXPENSE`,`CURRENT`,`FIXED`,`EQUITY`,`LIABILITY`,… (full enum in 01a/spec) |
| `Status`            | enum   | yes      | `ACTIVE`/`ARCHIVED`                                                                         |
| `TaxType`           | string | yes      | default tax code                                                                            |
| `BankAccountNumber` | string | yes      | BANK accounts only                                                                          |

### Field Format Reference

| Format                      | Pattern                     | Example                                | Notes                                   |
| --------------------------- | --------------------------- | -------------------------------------- | --------------------------------------- |
| Date (request)              | `YYYY-MM-DD`                | `2024-06-01`                           | accepted in JSON request bodies         |
| DateTime (response, legacy) | `/Date(epoch_ms+tzoffset)/` | `/Date(1717272000000+0000)/`           | Microsoft JSON — **parse defensively**  |
| DateTime (`*UTC` fields)    | ISO-like                    | `2024-06-02T10:00:00`                  | `UpdatedDateUTC` etc. — prefer for sync |
| Currency / decimal          | plain decimal               | `100.00`                               | no thousands separators                 |
| ID format                   | GUID v4                     | `297c2dc5-cc47-4afd-8ec8-74990b8761e9` | all `*ID` fields                        |
| Enum values                 | UPPERCASE                   | `AUTHORISED`, `ACCREC`                 | status/type enums                       |
| `LineAmountTypes`           | PascalCase                  | `Exclusive`                            | exception — not uppercase               |

## Query & Filtering

`where` = (URL-encoded) filter expression; `order` = sort clause.

```
GET /api.xro/2.0/Invoices?where=Status=="AUTHORISED"
GET /api.xro/2.0/Invoices?where=Type=="ACCREC"&&AmountDue>0
GET /api.xro/2.0/Contacts?where=Name.Contains("Smith")
GET /api.xro/2.0/Payments?where=Date>=DateTime(2024,06,01)&&Date<DateTime(2024,07,01)&order=Date DESC
```

| Capability                    | Supported? | Syntax / notes                                              |
| ----------------------------- | ---------- | ----------------------------------------------------------- |
| Equality (optimised)          | yes        | `Status=="AUTHORISED"` — fast on optimised fields           |
| Date range                    | yes        | `Date>=DateTime(2024,01,01)&&Date<DateTime(2024,12,31)`     |
| GUID match                    | yes        | `Contact.ContactID==guid("...")`                            |
| String contains/starts/ends   | partial    | `.Contains()`, `.StartsWith()`, `.EndsWith()` — unoptimised |
| Logical AND/OR                | yes        | `&&` / `\|\|`, parentheses for grouping                     |
| Comparison `>`,`<`,`!=`       | yes        | unoptimised on large orgs                                   |
| Sort                          | yes        | `order=Date DESC` / `order=UpdatedDateUTC DESC`             |
| Per-resource free-text search | partial    | `searchTerm=...` on Invoices/Contacts                       |
| Sparse response               | partial    | `summaryOnly=true` omits line items (faster lists)          |
| Aggregate / count             | no         | use Reports endpoints                                       |

> Performance: Xero strongly recommends `==` on a small set of optimised fields. `.Contains()`, `>`, `<`, nested-field filters are unoptimised and can time out on large orgs — bulk pulls prefer `If-Modified-Since` + `page` over a heavy `where`.

## Pagination

- Type: page-number (1-based) on list endpoints. `/Accounts`, `/TaxRates`, `/Items`, `/Organisation` **not paged** (full set). Journals use an `offset` cursor.
- Default page size: 100/page when `page` supplied. Max: `pageSize` up to **1000** on supported resources.
- Total count: when `page` supplied, envelope includes `Pagination` with `itemCount` and `pageCount`.

| Parameter  | Type | Default | Description                                            |
| ---------- | ---- | ------- | ------------------------------------------------------ |
| `page`     | int  | 1       | 1-based page number; enables paging + caps at 100/page |
| `pageSize` | int  | 100     | records per page (max 1000 on supported resources)     |

Response (when `page` supplied): `{"Status":"OK","Invoices":[/* up to pageSize items */],"Pagination":{"page":1,"pageSize":100,"pageCount":5,"itemCount":437}}`
Last page: stop when `page >= Pagination.pageCount` (or returned array `< pageSize`). Incremental sync: set `If-Modified-Since` once, walk `page=1..pageCount`.

## Rate Limits

| Scope               | Limit        | Window      | Notes              |
| ------------------- | ------------ | ----------- | ------------------ |
| Per tenant (minute) | 60 calls     | rolling 60s | per connected org  |
| Per tenant (day)    | 5,000 calls  | 24h         | per connected org  |
| Concurrent          | 5 in-flight  | —           | per tenant         |
| App-wide (minute)   | 10,000 calls | rolling 60s | across all tenants |

Headers (every response): `X-MinLimit-Remaining` (calls left this minute, tenant), `X-DayLimit-Remaining` (calls left today, tenant), `X-AppMinLimit-Remaining` (calls left this minute, app-wide), `Retry-After` (seconds to wait, on 429 only), `X-Rate-Limit-Problem` (which limit hit: `minute`/`day`/`concurrent`), `Xero-Correlation-Id` (trace id — quote in support).

When exceeded: HTTP **429 Too Many Requests** + `Retry-After`. Body: `{"Type":null,"Title":"Rate limit exceeded","Status":429,"Detail":"The API rate limit for your application/organisation has been reached. The minute limit is 60. Please try again in 1 seconds."}`

Strategy: honour `Retry-After` exactly on 429; exponential backoff + jitter on 5xx; track `X-MinLimit-Remaining` to throttle proactively; spread tenants to stay under the 10,000/min app ceiling. (https://developer.xero.com/documentation/guides/oauth2/limits/)

## Error Handling

Validation error format: `{"ErrorNumber":10,"Type":"ValidationException","Message":"A validation exception occurred","Elements":[{"InvoiceID":"00000000-0000-0000-0000-000000000000","ValidationErrors":[{"Message":"Invoice not of valid status for modification"}]}]}`

| Status | Meaning                                                   | Retryable           | Recovery                                                          |
| ------ | --------------------------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| 400    | bad request / malformed `where`/`order`                   | No                  | fix query syntax                                                  |
| 401    | expired/invalid token OR missing/invalid `Xero-tenant-id` | Yes (after refresh) | refresh token; verify tenant header; retry once                   |
| 403    | token lacks the required scope                            | No                  | config issue (e.g. add `accounting.settings.read`) — do NOT retry |
| 404    | record/tenant not found                                   | No                  | verify id + tenant                                                |
| 405    | method not allowed                                        | No                  | wrong verb for resource                                           |
| 412    | precondition failed                                       | No                  | check headers                                                     |
| 429    | rate limit exceeded                                       | Yes                 | honour `Retry-After`                                              |
| 500    | internal server error                                     | Yes                 | backoff + retry; quote `Xero-Correlation-Id`                      |
| 503    | service unavailable / throttling                          | Yes                 | backoff + retry                                                   |

(https://developer.xero.com/documentation/api/accounting/responsecodes)

> **Idempotency:** create endpoints accept an `Idempotency-Key` request header (~24h window). **Quirk:** in Xero, **PUT = create new** and **POST = create-or-update (upsert by id)** — opposite of most REST APIs, a common source of duplicates. Irrelevant while read-only, critical if writes are enabled (see 01c).

## Webhooks / Events

Webhooks **ARE** supported (advantage over MYOB), but cover only **Invoice + Contact create/update**. The read-only connector does not register them.

- Registration: Xero developer portal UI (per app) — set delivery URL, get a webhook signing key. URL must be HTTPS, publicly reachable, respond `200` within 5s.
- Activation: "Intent to Receive" handshake — validate the signature, respond `200` (valid) / `401` (invalid).
- Payloads ID-only — `resourceId`, `tenantId`, `eventCategory`, `eventType`, `eventDateUtc`. Call the API (`resourceUrl`) with the right `Xero-tenant-id` to fetch the changed record.
- Verification: `x-xero-signature` = base64(HMAC-SHA256(raw_body, signing_key)); constant-time compare against the **raw** (un-reparsed) body.
- Retry policy: Xero retries failed deliveries with backoff over ~24h, then disables the webhook. Duplicate delivery possible — design idempotent handlers.

Polling fallback (what this connector uses): list endpoints + `If-Modified-Since: {RFC1123}` header (preferred) or `where=UpdatedDateUTC>=DateTime(...)`. Change field `UpdatedDateUTC`. Few-minutes cadence sits comfortably under 60/min/tenant.

## Known Limitations

1. **Read-only as configured.** Registry scopes are `*.read` only — no create/modify/void/delete. Writes need `accounting.transactions`/`accounting.contacts` (not enabled).
2. **Scope gap → 403s.** `/Accounts`, `/Items`, `/TaxRates`, `/Organisation` need `accounting.settings.read`; reports need `accounting.reports.read`. Neither in registry scopes → 403 today (config, not transient — don't retry).
3. **Multi-tenant ambiguity.** One token can serve many orgs; always resolve/confirm the target `tenantId` (via `GET /connections`) before answering.
4. **Mixed date formats.** Legacy `/Date(...)/` vs ISO `*UTC` — parse defensively; prefer `UpdatedDateUTC` for ordering.
5. **Refresh-token rotation.** One-time-use refresh tokens; storage layer must persist the new token on every refresh or background use breaks with `invalid_grant`.
6. **No live [CONFIRMED] capture.** Response envelopes are spec-/doc-sourced — confirm exact per-field date serialisation against a connected Demo Company.

## SDKs & Tooling

| SDK                | Language | Repository                      | Notes                                       |
| ------------------ | -------- | ------------------------------- | ------------------------------------------- |
| `xero-python`      | Python   | github.com/XeroAPI/xero-python  | reference; raw HTTP via proxy is simpler    |
| `xero-node`        | Node.js  | github.com/XeroAPI/xero-node    | reference only                              |
| `Xero-OpenAPI`     | spec     | github.com/XeroAPI/Xero-OpenAPI | authoritative — **field/enum ground truth** |
| PHP/Ruby/.NET/Java | various  | github.com/XeroAPI              | reference (all first-party)                 |

Postman: https://www.postman.com/xeroapi/workspace/xeroapi · OpenAPI spec: https://github.com/XeroAPI/Xero-OpenAPI (`xero_accounting.yaml`, `xero-webhooks.yaml`)

## Integration Path Assessment

**Recommended path: Direct API Only** (via the connector's `connect_request` proxy). Xero is a structured accounting **records-and-actions** API (invoices, contacts, accounts, payments, bank transactions), not a file/document browser — same path as MYOB AccountRight, simPRO, Jobber. The agent makes authenticated REST calls through `connect_request` (OAuth2 token + `Xero-tenant-id` injected per call). **Not** a `Data Connector (Files)` integration — no `list_files`/`download_file` surface. The registry already declares `authType: 'oauth2'` with the correct `authUrl`/`tokenUrl`.

Connector compatibility (Files-connector methods don't apply — for completeness): `list_files` none (records, not files); `download_file` partial (`/Invoices/{id}/pdf` only); `search_files` none (`where`/`searchTerm`); `get_file_metadata` none.

Build callouts (address before build):

1. **`/connections` bootstrap.** First call after auth must enumerate tenant ids; send `Xero-tenant-id` on everything else.
2. **Scope gap fix.** Add `accounting.settings.read` to registry `scopes` if chart-of-accounts reads required; `accounting.reports.read` for reports.
3. **Refresh-token rotation.** Persist the rotated refresh token after every refresh.

See also `01-llm-api-rules.md` (+ `01a`–`01d`, the workspace-agent knowledge pack), `03-connector-setup.md` (registry entry + `ext-api-doc` deploy), `04-connection-and-reauth.md` (OAuth registration, scopes, refresh, reauth).
