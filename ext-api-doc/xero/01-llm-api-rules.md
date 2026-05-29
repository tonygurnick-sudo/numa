---
api_name: 'Xero Accounting API'
api_slug: 'xero'
version: 'api.xro/2.0'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
line_count_target: '< 300 lines'
---

# Xero Accounting API -- Workspace Agent API Rules

> **Loaded into the workspace agent's context when the Xero integration is active.**
> Companion files (01a-01d) hold the detailed reference. Keep this file under 300 lines.

## Context

- **API:** Xero Accounting API (`api.xro/2.0`), REST + JSON.
- **Base URL (data):** `https://api.xero.com/api.xro/2.0`
- **Base URL (tenant discovery):** `https://api.xero.com/connections` (NOT under `api.xro/2.0`)
- **Auth:** OAuth 2.0 (`Authorization: Bearer {token}`) **+ mandatory `Xero-tenant-id` header on every data call.**
- **Integration path:** Direct API Only — all interactions go through the connector's `connect_request` proxy (token + `Xero-tenant-id` injected per call).
- **Rate limits:** 60 calls/min/tenant, 5,000/day/tenant, 5 concurrent/tenant, 10,000/min app-wide. See 01d.

## Auth Structure

OAuth 2.0 authorization-code flow with `offline_access`. Registry config (the real connector entry):

```
authUrl:  https://login.xero.com/identity/connect/authorize
tokenUrl: https://identity.xero.com/connect/token
scopes:   openid profile email accounting.transactions.read accounting.contacts.read offline_access
```

Every request:

```
Authorization: Bearer eyJ...           (30-min access token)
Xero-tenant-id: 70784a63-d24b-46a9-...  (REQUIRED on data calls; omit only on GET /connections)
Accept: application/json                (always send — default is XML on some endpoints)
```

**Token lifecycle:**

- Access token lives **30 minutes**. On 401, refresh and retry once.
- Refresh tokens are **rotating / one-time-use** — each refresh returns a NEW refresh token and kills the old one; it expires after **60 days of inactivity**. The connector layer persists the rotated token. If you ever see `invalid_grant`, the stored refresh token is stale — the user must reconnect.

## Capabilities

### CAN (read-only, with current registry scopes)

1. Discover connected orgs via `GET /connections`, then operate **per tenant** using `Xero-tenant-id`.
2. List & filter **invoices/bills** (`/Invoices`) by status, type, date, contact, amount due; fetch one invoice with full line items + payments.
3. List & search **contacts** (`/Contacts`), list **payments** (`/Payments`) and **bank transactions** (`/BankTransactions`) — answer "who owes us money", "bills from supplier X", "payments in June".

### CANNOT

1. **Create / modify / void / delete** anything — registry scopes are read-only (`*.read`). Writes need `accounting.transactions` / `accounting.contacts` (not enabled). If asked to create an invoice, explain it is read-only and direct the user to the Xero UI.
2. **Read chart of accounts, tax rates, items, organisation, or reports** — `/Accounts`, `/TaxRates`, `/Items`, `/Organisation` need `accounting.settings.read`; reports need `accounting.reports.read`. Neither is in the registry scopes → these calls **403**. Do not promise them.
3. Manage **attachments** or **email/PDF** invoices (needs write/attachment scopes).

## Critical Gotchas

> Things that WILL cause errors if you get them wrong.

1. **`Xero-tenant-id` is mandatory on every data call.** It is NOT derivable from the token. Your first call after auth must be `GET https://api.xero.com/connections` to get `tenantId`, then send it as a header on everything else. A token can be connected to many orgs — if there are multiple, ask the user which org, or state which one you used. Missing/invalid header → 401/403.
2. **Read-only scope reality.** `/Accounts`, `/Items`, `/TaxRates`, `/Organisation`, `/Reports/*` will 403 with the current scopes. This is config, not a transient error — don't retry.
3. **Dates come back in two shapes.** Legacy fields serialize as Microsoft JSON `/Date(1717272000000+0000)/`; the `*UTC` fields (e.g. `UpdatedDateUTC`) are ISO-like. Parse defensively; prefer `UpdatedDateUTC` for sync ordering.
4. **`where` performance.** Equality `==` on a few "optimised" fields is fast. `.Contains()`, `>`, `<`, and nested-field filters are unoptimised and can time out on big orgs — prefer `If-Modified-Since` + `page` for bulk pulls.
5. **PUT = create, POST = create-or-update (upsert by id).** Opposite of normal REST. Not relevant while read-only, but never "PUT to update" if writes are ever enabled.

## Default Parameters

Use these unless the user says otherwise:

| Parameter     | Default               | Reason                                              |
| ------------- | --------------------- | --------------------------------------------------- |
| `Accept`      | `application/json`    | Avoid XML responses                                 |
| `page`        | `1`                   | Always page; walk to `Pagination.pageCount`         |
| `pageSize`    | `100`                 | Xero default; raise (max 1000) only for bulk sync   |
| `summaryOnly` | `true` for list views | Faster/lighter; fetch full detail by id when needed |
| `order`       | `UpdatedDateUTC DESC` | Most-recent-first; good for incremental             |

## Working Examples

### Example 1: Discover tenants (mandatory first call)

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
    "tenantName": "Demo Company (NZ)"
  }
]
```

### Example 2: Outstanding receivables (who owes us money)

```http
GET /api.xro/2.0/Invoices?where=Type=="ACCREC"%26%26AmountDue>0&summaryOnly=true&order=Date DESC&page=1
Host: api.xero.com
Authorization: Bearer {access_token}
Xero-tenant-id: 70784a63-d24b-46a9-a4db-0b70a274b056
Accept: application/json
```

```json
{
  "Status": "OK",
  "Invoices": [
    {
      "InvoiceID": "297c2dc5-cc47-4afd-8ec8-74990b8761e9",
      "Type": "ACCREC",
      "InvoiceNumber": "INV-0042",
      "Contact": { "ContactID": "bd2270c3-...", "Name": "ABC Ltd" },
      "Status": "AUTHORISED",
      "AmountDue": 115.0,
      "Total": 115.0,
      "CurrencyCode": "NZD",
      "UpdatedDateUTC": "/Date(1717272000000+0000)/"
    }
  ],
  "Pagination": { "page": 1, "pageSize": 100, "pageCount": 3, "itemCount": 247 }
}
```

### Example 3: Incremental pull (everything changed since last sync)

```http
GET /api.xro/2.0/Invoices?page=1 HTTP/1.1
Host: api.xero.com
Authorization: Bearer {access_token}
Xero-tenant-id: 70784a63-d24b-46a9-a4db-0b70a274b056
Accept: application/json
If-Modified-Since: Mon, 27 May 2026 00:00:00 GMT
```

Returns only records with `UpdatedDateUTC >=` the header value. Walk `page=1..Pagination.pageCount`.

### Example 4: Find a contact by name

```http
GET /api.xro/2.0/Contacts?where=Name.Contains("Acme")
Xero-tenant-id: 70784a63-d24b-46a9-a4db-0b70a274b056
Accept: application/json
```

```json
{
  "Status": "OK",
  "Contacts": [
    {
      "ContactID": "bd2270c3-...",
      "Name": "Acme Ltd",
      "EmailAddress": "ap@acme.com",
      "ContactStatus": "ACTIVE",
      "IsCustomer": true,
      "IsSupplier": false
    }
  ]
}
```

## Proxy API Operations

| Operation       | Method | Path                            | Key Parameters                                      | Notes                                          |
| --------------- | ------ | ------------------------------- | --------------------------------------------------- | ---------------------------------------------- |
| List tenants    | GET    | `/connections`                  | —                                                   | host `api.xero.com`, **no** tenant hdr         |
| List invoices   | GET    | `/api.xro/2.0/Invoices`         | `where`, `order`, `page`, `Statuses`, `summaryOnly` | paged 100/pg                                   |
| Get one invoice | GET    | `/api.xro/2.0/Invoices/{id}`    | by `InvoiceID` or `InvoiceNumber`                   | full line items + payments                     |
| List contacts   | GET    | `/api.xro/2.0/Contacts`         | `where`, `searchTerm`, `page`, `includeArchived`    | paged                                          |
| List payments   | GET    | `/api.xro/2.0/Payments`         | `where`, `order`, `page`                            | paged                                          |
| List bank txns  | GET    | `/api.xro/2.0/BankTransactions` | `where`, `order`, `page`, `If-Modified-Since`       | paged                                          |
| List accounts   | GET    | `/api.xro/2.0/Accounts`         | —                                                   | ⚠ needs `accounting.settings.read` → 403 today |

## Pagination

- **Type:** page-number (1-based) on list endpoints. `/Accounts`, `/TaxRates`, `/Items`, `/Organisation` are **not paged**. Journals use an `offset` cursor.
- **Default page size:** 100 when `page` supplied. **Max:** `pageSize=1000` on supported resources.
- **How to paginate:**

```http
GET /api.xro/2.0/Invoices?page=1   → response includes "Pagination": { "pageCount": 5, ... }
GET /api.xro/2.0/Invoices?page=2
...continue to page == pageCount
```

- **Last page detection:** stop when `page >= Pagination.pageCount` (or when the returned array length `< pageSize`).

## Webhooks / Events

Webhooks ARE supported (Invoice + Contact create/update only), but the read-only connector does not register them. Use **polling**: list endpoints + `If-Modified-Since` header (preferred) or `where=UpdatedDateUTC>=DateTime(...)`. Change-detection field is `UpdatedDateUTC`. Recommended cadence: a few minutes, well within 60/min/tenant. Details + signature validation in 01d.

## Error Handling

**Validation error format:**

```json
{
  "ErrorNumber": 10,
  "Type": "ValidationException",
  "Message": "A validation exception occurred",
  "Elements": [{ "InvoiceID": "00000000-...", "ValidationErrors": [{ "Message": "..." }] }]
}
```

**Recovery by status:**

| Status | Meaning                                                | Action                                                        |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------- |
| 400    | Bad `where`/`order` syntax                             | Fix query — do not retry                                      |
| 401    | Expired/invalid token OR missing/invalid tenant header | Refresh token; verify `Xero-tenant-id`; retry 1×              |
| 403    | Token lacks scope for this resource                    | Config issue (e.g. `accounting.settings.read`) — do NOT retry |
| 404    | Record/tenant not found                                | Verify id + tenant                                            |
| 429    | Rate limit exceeded                                    | Honour `Retry-After` (seconds), then retry                    |
| 5xx    | Server error                                           | Exponential backoff + jitter; quote `Xero-Correlation-Id`     |

On 429, check `X-Rate-Limit-Problem` (`minute`/`day`/`concurrent`). Track `X-MinLimit-Remaining` / `X-DayLimit-Remaining` to throttle proactively.

## Known Limitations

1. **Read-only as configured** — no writes; Accounts/Items/TaxRates/Org/Reports 403 (scope gap). See 01c for the write surface that would unlock with added scopes.
2. **Multi-tenant ambiguity** — one token may serve many orgs; always resolve/confirm the target `tenantId` before answering.
3. **Mixed date formats** — `/Date(...)/` vs ISO `*UTC`; parse defensively. (Live response envelopes not yet captured against a real token — high-confidence from official docs + OpenAPI spec.)

---

_See companion files for detailed reference:_

- _01a-domain-model-reference.md — Entities (Invoice/Contact/Account/Payment/BankTransaction), relationships, invoice state machine, enums_
- _01b-query-patterns.md — `where`/`order`/`searchTerm`, pagination, `If-Modified-Since`_
- _01c-mutation-patterns.md — Write patterns (future / requires write scope), PUT=create vs POST=upsert, idempotency_
- _01d-event-and-error-handling.md — Webhooks (HMAC `x-xero-signature`), polling, rate limits, error recovery_
