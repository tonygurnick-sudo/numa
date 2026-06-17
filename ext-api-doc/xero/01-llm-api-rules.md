---
api_name: Xero Accounting API
api_slug: xero
base_url_data: https://api.xero.com/api.xro/2.0
base_url_connections: https://api.xero.com/connections
path_version_segment: api.xro/2.0 (LITERAL path segment — included in every data path; NOT a "/v2.0/" label)
path_rule: send full paths e.g. /api.xro/2.0/Invoices; /connections is at the api.xero.com ROOT (no api.xro/2.0, no tenant header)
auth: OAuth2 Bearer {token} + mandatory Xero-tenant-id header on every data call
call_surface: HTTP via `numa integrations request` (Direct API through connector connect_request proxy; token + Xero-tenant-id injected per call). NOT a file-store — no list-files/download-file/MCP.
field_casing: PascalCase (resources plural PascalCase /Invoices, fields PascalCase)
id_format: GUID v4 (all *ID fields)
rate_limit: 60/min/tenant, 5000/day/tenant, 5 concurrent/tenant, 10000/min app-wide
access_mode: READ-ONLY as configured (registry scopes are *.read)
confidence: facts sourced from official Xero docs + public xero_accounting.yaml OpenAPI spec [DOCUMENTED]; no live token captured — parse response envelopes defensively
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns(future/write), 01d=events+errors
---

# Xero — API Rules

## Paths (read first)

- Data calls: `/api.xro/2.0/{Resource}` — `api.xro/2.0` is a LITERAL path segment, always present. No `/v2.0/` or `/v1/` label form; the literal string is `api.xro/2.0`.
- `GET /connections` (tenant discovery) lives at the `api.xero.com` ROOT — NOT under `api.xro/2.0`, takes NO `Xero-tenant-id` header.
- Resource names PascalCase + plural: `/Invoices`, `/Contacts`, `/Payments`, `/BankTransactions`, `/Accounts`.

## Auth (every request)

OAuth 2.0 authorization-code flow with `offline_access`. Registry config: `authUrl: https://login.xero.com/identity/connect/authorize`; `tokenUrl: https://identity.xero.com/connect/token`; `scopes: openid profile email accounting.transactions.read accounting.contacts.read offline_access`.

```
Authorization: Bearer {token}          (30-min access token)
Xero-tenant-id: {tenantId}             (REQUIRED on data calls; omit ONLY on GET /connections)
Accept: application/json               (always send — default is XML on some endpoints)
Content-Type: application/json         (POST/PUT bodies only)
```

- `Xero-tenant-id` NOT derivable from the token. First call after auth MUST be `GET /connections` → take `tenantId`. A token may serve many orgs — if multiple, ask the user which, or state which you used. Missing/invalid header → 401/403.
- Access token 30 min. On 401: refresh, verify tenant header, retry ONCE. Refresh tokens rotate (one-time-use); connector persists the new one; `invalid_grant` = stale → user must reconnect. Expire after 60 days inactivity.

## CAN (read-only, current scopes `accounting.transactions.read` + `accounting.contacts.read`)

- `GET /connections` → discover orgs, operate per-tenant.
- List/filter invoices & bills `/Invoices` (status, type, date, contact, amount due); get one with full line items + payments.
- Search contacts `/Contacts`; list payments `/Payments`; list bank transactions `/BankTransactions`. Answers "who owes us money", "bills from supplier X", "payments in June".

## CANNOT

- Create/modify/void/delete ANYTHING — scopes are `*.read`. Writes need `accounting.transactions`/`accounting.contacts` (NOT enabled) → POST/PUT/DELETE return **403**. If asked to create/edit an invoice/contact/payment: explain read-only, point to Xero UI.
- Read chart of accounts/tax rates/items/org: `/Accounts`, `/TaxRates`, `/Items`, `/Organisation` need `accounting.settings.read` (NOT in scopes) → **403**. Reports need `accounting.reports.read` → 403. Don't promise them; don't retry (config, not transient).
- Attachments, email/PDF invoices (need write/attachment scopes).

## Critical Gotchas

1. **`Xero-tenant-id` mandatory on every data call.** Resolve via `GET /connections` first; confirm org if multiple. Missing/invalid → 401/403.
2. **Read-only scope reality.** `/Accounts`, `/Items`, `/TaxRates`, `/Organisation`, `/Reports/*` 403 — config, don't retry.
3. **Dates come back in two shapes.** Legacy fields = Microsoft JSON `/Date(1717272000000+0000)/`; `*UTC` fields (e.g. `UpdatedDateUTC`) = ISO-like `2024-06-02T10:00:00`. Parse defensively; order/compare on `UpdatedDateUTC`.
4. **`where` performance.** `==` on a few optimised fields is fast. `.Contains()`, `>`, `<`, `!=`, nested-field filters are unoptimised → can time out on big orgs. Bulk pulls: prefer `If-Modified-Since` + `page`, not a heavy `where`.
5. **PUT = create, POST = create-or-update (upsert by id)** — inverted from normal REST. Irrelevant while read-only, but never "PUT to update" if writes are ever enabled (see 01c).

## Defaults (override only if user specifies)

| Param         | Default               | Reason                                            |
| ------------- | --------------------- | ------------------------------------------------- |
| `Accept`      | `application/json`    | avoid XML                                         |
| `page`        | `1`                   | always page; walk to `Pagination.pageCount`       |
| `pageSize`    | `100`                 | Xero default; raise (max 1000) only for bulk sync |
| `summaryOnly` | `true` for list views | faster/lighter; fetch full detail by id           |
| `order`       | `UpdatedDateUTC DESC` | most-recent-first; good for incremental           |

## Operations

| Operation       | Method | Path                            | Key params / notes                                                           |
| --------------- | ------ | ------------------------------- | ---------------------------------------------------------------------------- |
| List tenants    | GET    | `/connections`                  | host `api.xero.com` ROOT, **no** tenant header                               |
| List invoices   | GET    | `/api.xro/2.0/Invoices`         | `where`, `order`, `page`, `Statuses`, `summaryOnly`; paged 100/pg            |
| Get one invoice | GET    | `/api.xro/2.0/Invoices/{id}`    | `{id}` = `InvoiceID` GUID **or** `InvoiceNumber`; full line items + payments |
| List contacts   | GET    | `/api.xro/2.0/Contacts`         | `where`, `searchTerm`, `page`, `includeArchived`                             |
| List payments   | GET    | `/api.xro/2.0/Payments`         | `where`, `order`, `page`                                                     |
| List bank txns  | GET    | `/api.xro/2.0/BankTransactions` | `where`, `order`, `page`, `If-Modified-Since`                                |
| List accounts   | GET    | `/api.xro/2.0/Accounts`         | ⚠ needs `accounting.settings.read` → 403 today                               |

## Pagination

Page-number (1-based) on list endpoints; default size 100, max `pageSize=1000` on supported resources (Invoices, Contacts, BankTransactions, CreditNotes, Payments). `/Accounts`, `/TaxRates`, `/Items`, `/Organisation` NOT paged (and scope-gated); Journals use an `offset` cursor. When `page` supplied, envelope carries `Pagination:{page,pageSize,pageCount,itemCount}`. Walk `page=1..pageCount`; stop when `page >= pageCount` or returned array `< pageSize`/empty. Incremental: set `If-Modified-Since` once, walk pages.

## Webhooks / Events

Webhooks ARE supported (Invoice + Contact create/update only) but the read-only connector does NOT register them. **Use polling:** list endpoints + `If-Modified-Since: {RFC1123 GMT}` header (preferred) or `where=UpdatedDateUTC>=DateTime(...)`. Change field `UpdatedDateUTC`. Cadence a few minutes — within 60/min/tenant. Signature validation in 01d.

## Errors

Validation shape: `{"ErrorNumber":10,"Type":"ValidationException","Message":"A validation exception occurred","Elements":[{"InvoiceID":"00000000-...","ValidationErrors":[{"Message":"..."}]}]}`
Recovery by status: 400 bad `where`/`order` → fix query, don't retry · 401 expired token OR missing/invalid tenant header → refresh + verify tenant header + retry 1× · 403 missing scope (config) → do NOT retry · 404 → verify id + tenant · 405 wrong verb (recall PUT=create, POST=upsert) · 429 → honour `Retry-After` (seconds) then retry · 5xx → exponential backoff + jitter (≤3), quote `Xero-Correlation-Id`.
On 429 check `X-Rate-Limit-Problem` (`minute`/`day`/`concurrent`). Track `X-MinLimit-Remaining`/`X-DayLimit-Remaining` to throttle proactively.

## Examples

1. Discover tenants (mandatory first call):
   `GET /connections` (host `api.xero.com`, Bearer + Accept, NO tenant header)
   → `[{"id":"e1eede29-f875-4a5d-8470-17f6a29a88b1","tenantId":"70784a63-d24b-46a9-a4db-0b70a274b056","tenantType":"ORGANISATION","tenantName":"Demo Company (NZ)"}]`

2. Outstanding receivables (who owes us money):
   `GET /api.xro/2.0/Invoices?where=Type=="ACCREC"%26%26AmountDue>0&summaryOnly=true&order=Date DESC&page=1` (+ `Xero-tenant-id`)
   → `{"Status":"OK","Invoices":[{"InvoiceID":"297c2dc5-cc47-4afd-8ec8-74990b8761e9","Type":"ACCREC","InvoiceNumber":"INV-0042","Contact":{"ContactID":"bd2270c3-...","Name":"ABC Ltd"},"Status":"AUTHORISED","AmountDue":115.0,"Total":115.0,"CurrencyCode":"NZD","UpdatedDateUTC":"/Date(1717272000000+0000)/"}],"Pagination":{"page":1,"pageSize":100,"pageCount":3,"itemCount":247}}`

3. Incremental pull (everything changed since last sync):
   `GET /api.xro/2.0/Invoices?page=1` + `Xero-tenant-id` + `If-Modified-Since: Mon, 27 May 2026 00:00:00 GMT`
   → returns only records with `UpdatedDateUTC >=` header value. Walk `page=1..pageCount`.

4. Find a contact by name:
   `GET /api.xro/2.0/Contacts?where=Name.Contains("Acme")` (+ `Xero-tenant-id`)
   → `{"Status":"OK","Contacts":[{"ContactID":"bd2270c3-...","Name":"Acme Ltd","EmailAddress":"ap@acme.com","ContactStatus":"ACTIVE","IsCustomer":true,"IsSupplier":false}]}`
