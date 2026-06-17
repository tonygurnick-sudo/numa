---
api_name: Xero Accounting API
api_slug: xero
companion_to: 01-llm-api-rules.md
content: natural-language → read operation mappings — the where/order/searchTerm filter language, If-Modified-Since incremental sync, page-number pagination
confidence: all paths/params [DOCUMENTED] from official Xero docs + OpenAPI spec
note: every example also requires Authorization Bearer {token}, Accept application/json, and the mandatory Xero-tenant-id header (omitted from snippets for brevity except where it matters)
---

# Xero — Query Patterns Reference

## Query Capabilities

| Capability              | Supported | Syntax                                                        | Notes                                                  |
| ----------------------- | --------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| Filter by field value   | yes       | `where=Status=="AUTHORISED"`                                  | `==` is the optimised operator                         |
| Filter by date range    | yes       | `where=Date>=DateTime(2024,01,01)&&Date<DateTime(2024,12,31)` | use the `DateTime(y,m,d)` literal                      |
| Full-text search        | partial   | `searchTerm=...` (Invoices, Contacts) or `Name.Contains()`    | newer `searchTerm` param; no global search             |
| Sort by field           | yes       | `order=Date DESC`                                             | direction `ASC`/`DESC`, default ASC                    |
| Field selection         | partial   | `summaryOnly=true`                                            | omits line items; not arbitrary field picking          |
| Include related records | yes       | full objects by default                                       | use `summaryOnly` to trim                              |
| Aggregation / count     | no        | —                                                             | use Reports endpoints (need `accounting.reports.read`) |
| Logical operators       | yes       | `&&` (AND), `\|\|` (OR), `()` grouping                        |                                                        |
| Comparison operators    | yes       | `==`, `!=`, `>`, `>=`, `<`, `<=`                              | non-`==` slower on big orgs                            |
| Null checks             | yes       | `Field==null`                                                 |                                                        |
| Pattern matching        | partial   | `.Contains()`, `.StartsWith()`, `.EndsWith()`                 | string methods, not regex; unoptimised                 |
| Modified-since (header) | yes       | `If-Modified-Since: {RFC1123}`                                | **preferred** for incremental sync                     |
| Batch get by id         | yes       | `?IDs=guid1,guid2,...`                                        | comma-separated multi-fetch                            |

## Filter Syntax (`where`)

Small C#-style boolean expression (URL-encoded). Field names PascalCase, matching entity fields.

```
Equality (optimised):  where=Status=="AUTHORISED"
Multiple conditions:   where=Type=="ACCREC"&&AmountDue>0
String contains:       where=Name.Contains("Ltd")
GUID match:            where=Contact.ContactID==guid("bd2270c3-...")
Boolean:               where=IsCustomer==true
Date range:            where=Date>=DateTime(2024,01,01)&&Date<DateTime(2024,07,01)
Null check:            where=Reference==null
OR + grouping:         where=(Status=="AUTHORISED"||Status=="PAID")&&Type=="ACCREC"
```

⚠️ Raw HTTP: URL-encode operators — `&&`→`%26%26`, `||`→`%7C%7C`, `"`→`%22`, space in `order=Date DESC`→`%20`. The `connect_request` proxy handles standard encoding, but be aware when building the query yourself.

**Performance:** Xero optimises a small set of fields per resource for `==` equality. `.Contains()`, `>`, `<`, `!=`, nested-field filters are **unoptimised** and can time out on large orgs. Bulk/historical pulls: prefer `If-Modified-Since` + `page` over a heavy `where`.

## Sort Syntax (`order`)

```
order=Date                 ascending (default)
order=Date DESC            descending
order=UpdatedDateUTC DESC  most-recently-changed first (recommended for incremental)
```

## Field Selection

No arbitrary field projection. `summaryOnly=true` (Invoices/Contacts/etc.) = fast, lightweight response omitting line items + heavy sub-objects — ideal for list views. Fetch full detail by id when the user drills in.

## Search

- Global search endpoint: none.
- Per-resource: `searchTerm` query param on Invoices and Contacts; plus `where=Name.Contains("...")`.
- Fuzzy matching: no — substring only via `.Contains()`.
- Minimum query length: not documented `[UNKNOWN]`.

## Modified-Since (Incremental Sync)

Cleanest way to pull only changed records:

```http
GET /api.xro/2.0/Invoices?page=1
Xero-tenant-id: {tenantId}
If-Modified-Since: Mon, 27 May 2026 00:00:00 GMT
Accept: application/json
```

Returns only records with `UpdatedDateUTC >=` the header value (RFC 1123 / GMT). Combine with `page` to walk the whole changed set. Equivalent `where`: `where=UpdatedDateUTC>=DateTime(2026,05,27)`. Header preferred — doesn't consume `where` optimisation budget.

## Pagination

- **Type:** page-number (1-based) on list endpoints.
- **Default page size:** 100 records when `page` supplied. **Max:** `pageSize=1000` on supported resources (Invoices, Contacts, BankTransactions, CreditNotes, Payments).
- **Total count:** when `page` supplied, envelope includes `Pagination` (`itemCount`, `pageCount`).
- **Not paged:** `/Accounts`, `/TaxRates`, `/Items`, `/Organisation` return the full set (and are scope-gated today). Journals use a separate `offset` cursor.

| Parameter  | Type | Default | Description                                                         |
| ---------- | ---- | ------- | ------------------------------------------------------------------- |
| `page`     | int  | 1       | 1-based page number; enables paging (caps 100/pg unless `pageSize`) |
| `pageSize` | int  | 100     | records per page (max 1000 on supported resources)                  |

Response (when `page` supplied): `{"Status":"OK","Invoices":[/* up to pageSize items */],"Pagination":{"page":1,"pageSize":100,"pageCount":5,"itemCount":437}}`

**Loop / last-page detection:** `GET ...?page=1` → read `Pagination.pageCount`; request `page=2..pageCount`; stop when `page >= pageCount` (equivalently, returned array `< pageSize` or empty). Incremental sync: set `If-Modified-Since` once, then walk `page=1..pageCount`.

## Query Pattern Library

### Invoices / Bills

- All authorised sales invoices, newest first: `GET /api.xro/2.0/Invoices?where=Type=="ACCREC"&&Status=="AUTHORISED"&order=Date DESC&page=1`
- Outstanding receivables (who owes us money): `GET /api.xro/2.0/Invoices?where=Type=="ACCREC"&&AmountDue>0&summaryOnly=true&order=Date DESC&page=1`
- Bills we owe a specific supplier: `GET /api.xro/2.0/Invoices?where=Type=="ACCPAY"&&Contact.ContactID==guid("bd2270c3-...")&&AmountDue>0&page=1`
- Invoices in a date range: `GET /api.xro/2.0/Invoices?where=Date>=DateTime(2024,06,01)&&Date<DateTime(2024,07,01)&order=Date asc&page=1`
- Invoices by status, comma list (cheaper than `where`): `GET /api.xro/2.0/Invoices?Statuses=AUTHORISED,PAID&page=1`
- Specific invoices by number/id: `GET /api.xro/2.0/Invoices?InvoiceNumbers=INV-0042,INV-0043` or `GET /api.xro/2.0/Invoices?IDs=297c2dc5-...,3a1b...`
- One invoice, full detail (line items + payments): `GET /api.xro/2.0/Invoices/297c2dc5-cc47-4afd-8ec8-74990b8761e9`

### Contacts

- Find a contact by name: `GET /api.xro/2.0/Contacts?where=Name.Contains("Acme")`
- All active customers: `GET /api.xro/2.0/Contacts?where=IsCustomer==true&&ContactStatus=="ACTIVE"&page=1`
- Free-text contact search: `GET /api.xro/2.0/Contacts?searchTerm=acme&page=1`

### Payments

- Payments in June, newest first: `GET /api.xro/2.0/Payments?where=Date>=DateTime(2024,06,01)&&Date<DateTime(2024,07,01)&order=Date DESC&page=1`

### Bank Transactions

- Spend-money transactions since a date: `GET /api.xro/2.0/BankTransactions?where=Type=="SPEND"&&Date>=DateTime(2024,06,01)&order=Date DESC&page=1`

### Bootstrap (always first)

- Which orgs can I see? `GET /connections` (host `api.xero.com`, Bearer + Accept, NO tenant header)

## Worked Examples

### Example 1: Aged receivables summary — "How much does each customer owe us right now?"

`GET /api.xro/2.0/Invoices?where=Type=="ACCREC"&&AmountDue>0&summaryOnly=true&order=Contact DESC&page=1` (+ `Xero-tenant-id`, `Accept: application/json`)
→ `{"Status":"OK","Invoices":[{"InvoiceID":"297c...","Contact":{"Name":"ABC Ltd"},"AmountDue":115.0,"DueDate":"/Date(1719792000000+0000)/","Status":"AUTHORISED"},{"InvoiceID":"3a1b...","Contact":{"Name":"ABC Ltd"},"AmountDue":230.0,"DueDate":"/Date(1722384000000+0000)/","Status":"AUTHORISED"}],"Pagination":{"page":1,"pageSize":100,"pageCount":2,"itemCount":134}}`

- `summaryOnly=true` keeps the payload small — group by `Contact.Name` in the agent.
- Walk to `pageCount` (here 2) to sum the full ledger; don't stop at page 1.

### Example 2: Incremental invoice sync since last run — "Pull everything that changed since yesterday."

`GET /api.xro/2.0/Invoices?page=1` + `Xero-tenant-id` + `If-Modified-Since: Wed, 28 May 2026 00:00:00 GMT`
→ `{"Status":"OK","Invoices":[{"InvoiceID":"297c...","InvoiceNumber":"INV-0042","Status":"PAID","UpdatedDateUTC":"/Date(1748390400000+0000)/"}],"Pagination":{"page":1,"pageSize":100,"pageCount":1,"itemCount":7}}`

- Header filters server-side; only changed records come back.
- Save the max `UpdatedDateUTC` returned as the next cursor.

### Example 3: Find a contact then list their open bills — "What do we still owe Acme?"

- Step 1 (resolve ContactID): `GET /api.xro/2.0/Contacts?where=Name.Contains("Acme")` (+ `Xero-tenant-id`)
- Step 2 (list unpaid bills): `GET /api.xro/2.0/Invoices?where=Type=="ACCPAY"&&Contact.ContactID==guid("bd2270c3-...")&&AmountDue>0&order=DueDate asc&page=1` (+ `Xero-tenant-id`)
- Two-step: resolve the GUID first, then filter `Contact.ContactID==guid("...")`. `Type=="ACCPAY"` = bills (money out); `Type=="ACCREC"` = sales invoices (money in).

## Gotchas

1. **Tenant header is non-negotiable.** Every example silently requires `Xero-tenant-id`. Resolve via `GET /connections` first; confirm the org if the token serves multiple.
2. **`Statuses`/`IDs`/`InvoiceNumbers` beat `where`.** For "give me these specific ones" or "these statuses", use the dedicated comma-separated params — cheaper, no `where` optimisation limits.
3. **`.Contains()` is unoptimised.** Fine for an interactive name lookup; do NOT use it as the spine of a full-org sync — use `If-Modified-Since` + paging.
4. **`/Accounts`, `/TaxRates`, `/Items`, `/Organisation` are not paged AND scope-gated.** With current scopes they 403 (`accounting.settings.read` missing) — don't build paging loops for them.
5. **Dates in responses are mixed.** Filter inputs use `DateTime(y,m,d)` / `YYYY-MM-DD`; responses come back as `/Date(epoch+tz)/` or ISO `*UTC`. Order/compare on `UpdatedDateUTC`.
