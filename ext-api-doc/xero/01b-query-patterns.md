---
api_name: 'Xero Accounting API'
api_slug: 'xero'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Xero Accounting API -- Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Natural language → read operation mappings: the
> `where`/`order`/`searchTerm` filter language, `If-Modified-Since` incremental sync, and
> page-number pagination.
>
> All paths/params are `[DOCUMENTED]` from the official Xero docs + OpenAPI spec. Every
> example assumes `Authorization: Bearer {token}`, `Accept: application/json`, and the
> mandatory `Xero-tenant-id` header (omitted from snippets for brevity except where it
> matters).

---

## Query Capabilities Summary

| Capability                 | Supported | Syntax                                                        | Notes                                                   |
| -------------------------- | --------- | ------------------------------------------------------------- | ------------------------------------------------------- | ------------------- | --- |
| Filter by field value      | yes       | `where=Status=="AUTHORISED"`                                  | `==` is the optimised operator                          |
| Filter by date range       | yes       | `where=Date>=DateTime(2024,01,01)&&Date<DateTime(2024,12,31)` | use the `DateTime(y,m,d)` literal                       |
| Full-text search           | partial   | `searchTerm=...` (Invoices, Contacts) or `Name.Contains()`    | newer `searchTerm` param; no global search              |
| Sort by field              | yes       | `order=Date DESC`                                             |                                                         |
| Sort direction             | yes       | `ASC` / `DESC`                                                | default ASC                                             |
| Field selection            | partial   | `summaryOnly=true`                                            | omits line items; not arbitrary field picking           |
| Include related records    | yes       | full objects by default                                       | use `summaryOnly` to trim                               |
| Aggregation / count        | no        | —                                                             | use Reports endpoints (needs `accounting.reports.read`) |
| Logical operators (AND/OR) | yes       | `&&` (AND), `                                                 |                                                         | `(OR),`()` grouping |     |
| Comparison operators       | yes       | `==`, `!=`, `>`, `>=`, `<`, `<=`                              | non-`==` operators are slower on big orgs               |
| Null checks                | yes       | `Field==null`                                                 |                                                         |
| Pattern matching           | partial   | `.Contains()`, `.StartsWith()`, `.EndsWith()`                 | string methods, not full regex; unoptimised             |
| Modified-since (header)    | yes       | `If-Modified-Since: {RFC1123}`                                | **preferred** for incremental sync                      |
| Batch get by id            | yes       | `?IDs=guid1,guid2,...`                                        | comma-separated multi-fetch                             |

---

## Filter Syntax (`where` parameter)

The `where` parameter is a small C#-style boolean expression (URL-encoded). Field names are PascalCase and match the entity fields.

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

> ⚠️ When sending raw HTTP, URL-encode the operators: `&&` → `%26%26`, `||` → `%7C%7C`,
> `"` → `%22`. Spaces in `order=Date DESC` → `%20`. The `connect_request` proxy handles
> standard encoding, but be aware when constructing the query yourself.

**Performance:** Xero optimises a small set of fields per resource for `==` equality. `.Contains()`, `>`, `<`, `!=`, and nested-field filters are **unoptimised** and can time out on large orgs. For bulk/historical pulls, prefer `If-Modified-Since` + `page` over a heavy `where`.

---

## Sort Syntax (`order` parameter)

```
order=Date                ascending (default)
order=Date DESC           descending
order=UpdatedDateUTC DESC  most-recently-changed first (recommended for incremental)
```

---

## Field Selection

No arbitrary field projection. Use `summaryOnly=true` on Invoices/Contacts/etc. for a fast, lightweight response that omits line items and heavy sub-objects — ideal for list views. Fetch full detail by id when the user drills in.

---

## Search

- **Global search endpoint:** none.
- **Per-resource search:** `searchTerm` query param on Invoices and Contacts; plus `where=Name.Contains("...")`.
- **Fuzzy matching:** no — substring only via `.Contains()`.
- **Minimum query length:** not documented `[UNKNOWN]`.

---

## Modified-Since (Incremental Sync)

The cleanest way to pull only changed records:

```http
GET /api.xro/2.0/Invoices?page=1
Xero-tenant-id: {tenantId}
If-Modified-Since: Mon, 27 May 2026 00:00:00 GMT
Accept: application/json
```

Returns only records with `UpdatedDateUTC >=` the header value (RFC 1123 / GMT). Combine with `page` to walk the whole changed set. Equivalent `where` form: `where=UpdatedDateUTC>=DateTime(2026,05,27)`. The header is preferred — it does not consume `where` optimisation budget.

---

## Pagination Handling

### Model

- **Type:** page-number (1-based) on list endpoints.
- **Default page size:** 100 records when `page` is supplied.
- **Max page size:** `pageSize=1000` on resources that support it (Invoices, Contacts, BankTransactions, CreditNotes, Payments).
- **Total count available:** yes — when `page` is supplied the envelope includes a `Pagination` object (`itemCount`, `pageCount`).
- **Not paged:** `/Accounts`, `/TaxRates`, `/Items`, `/Organisation` return the full set (and are scope-gated today). Journals use a separate `offset` cursor.

### Request Parameters

| Parameter  | Type | Default | Description                                                         |
| ---------- | ---- | ------- | ------------------------------------------------------------------- |
| `page`     | int  | 1       | 1-based page number; enables paging (caps 100/pg unless `pageSize`) |
| `pageSize` | int  | 100     | Records per page (max 1000 on supported resources)                  |

### Response Structure (when `page` supplied)

```json
{
  "Status": "OK",
  "Invoices": [
    /* up to 100 (or pageSize) items */
  ],
  "Pagination": { "page": 1, "pageSize": 100, "pageCount": 5, "itemCount": 437 }
}
```

### Last Page Detection

Stop when `page >= Pagination.pageCount` — equivalently, when the returned array length `< pageSize`, or is empty.

### Full Pagination Loop

```
Page 1: GET /api.xro/2.0/Invoices?page=1   → Pagination.pageCount = 5
Page 2: GET /api.xro/2.0/Invoices?page=2
Page 3: GET /api.xro/2.0/Invoices?page=3
Page 4: GET /api.xro/2.0/Invoices?page=4
Page 5: GET /api.xro/2.0/Invoices?page=5   → last (page == pageCount), stop
```

For incremental sync, set `If-Modified-Since` once, then walk `page=1..pageCount`.

---

## Query Pattern Library

### Invoices / Bills

**"All authorised sales invoices, newest first"**

```http
GET /api.xro/2.0/Invoices?where=Type=="ACCREC"&&Status=="AUTHORISED"&order=Date DESC&page=1
```

**"Outstanding receivables (who owes us money)"**

```http
GET /api.xro/2.0/Invoices?where=Type=="ACCREC"&&AmountDue>0&summaryOnly=true&order=Date DESC&page=1
```

**"Bills we owe a specific supplier"**

```http
GET /api.xro/2.0/Invoices?where=Type=="ACCPAY"&&Contact.ContactID==guid("bd2270c3-...")&&AmountDue>0&page=1
```

**"Invoices in a date range"**

```http
GET /api.xro/2.0/Invoices?where=Date>=DateTime(2024,06,01)&&Date<DateTime(2024,07,01)&order=Date asc&page=1
```

**"Invoices by status, comma list"** (cheaper than a `where`)

```http
GET /api.xro/2.0/Invoices?Statuses=AUTHORISED,PAID&page=1
```

**"Specific invoices by number/id"**

```http
GET /api.xro/2.0/Invoices?InvoiceNumbers=INV-0042,INV-0043
GET /api.xro/2.0/Invoices?IDs=297c2dc5-...,3a1b...
```

**"One invoice, full detail (line items + payments)"**

```http
GET /api.xro/2.0/Invoices/297c2dc5-cc47-4afd-8ec8-74990b8761e9
```

### Contacts

**"Find a contact by name"**

```http
GET /api.xro/2.0/Contacts?where=Name.Contains("Acme")
```

**"All active customers"**

```http
GET /api.xro/2.0/Contacts?where=IsCustomer==true&&ContactStatus=="ACTIVE"&page=1
```

**"Free-text contact search"**

```http
GET /api.xro/2.0/Contacts?searchTerm=acme&page=1
```

### Payments

**"Payments in June, newest first"**

```http
GET /api.xro/2.0/Payments?where=Date>=DateTime(2024,06,01)&&Date<DateTime(2024,07,01)&order=Date DESC&page=1
```

### Bank Transactions

**"Spend-money transactions since a date"**

```http
GET /api.xro/2.0/BankTransactions?where=Type=="SPEND"&&Date>=DateTime(2024,06,01)&order=Date DESC&page=1
```

### Bootstrap

**"Which orgs can I see?"** (always first)

```http
GET /connections
Host: api.xero.com
Authorization: Bearer {token}
Accept: application/json
```

---

## Worked Examples

### Example 1: Aged receivables summary

> "How much does each customer owe us right now?"

```http
GET /api.xro/2.0/Invoices?where=Type=="ACCREC"&&AmountDue>0&summaryOnly=true&order=Contact DESC&page=1
Xero-tenant-id: 70784a63-d24b-46a9-a4db-0b70a274b056
Accept: application/json
```

```json
{
  "Status": "OK",
  "Invoices": [
    {
      "InvoiceID": "297c...",
      "Contact": { "Name": "ABC Ltd" },
      "AmountDue": 115.0,
      "DueDate": "/Date(1719792000000+0000)/",
      "Status": "AUTHORISED"
    },
    {
      "InvoiceID": "3a1b...",
      "Contact": { "Name": "ABC Ltd" },
      "AmountDue": 230.0,
      "DueDate": "/Date(1722384000000+0000)/",
      "Status": "AUTHORISED"
    }
  ],
  "Pagination": { "page": 1, "pageSize": 100, "pageCount": 2, "itemCount": 134 }
}
```

**Key points:**

- `summaryOnly=true` keeps the payload small for a list view — group by `Contact.Name` in the agent.
- Walk to `pageCount` (here 2) to sum the full ledger; don't stop at page 1.

### Example 2: Incremental invoice sync since last run

> "Pull everything that changed since yesterday."

```http
GET /api.xro/2.0/Invoices?page=1
Xero-tenant-id: 70784a63-d24b-46a9-a4db-0b70a274b056
If-Modified-Since: Wed, 28 May 2026 00:00:00 GMT
Accept: application/json
```

```json
{
  "Status": "OK",
  "Invoices": [
    {
      "InvoiceID": "297c...",
      "InvoiceNumber": "INV-0042",
      "Status": "PAID",
      "UpdatedDateUTC": "/Date(1748390400000+0000)/"
    }
  ],
  "Pagination": { "page": 1, "pageSize": 100, "pageCount": 1, "itemCount": 7 }
}
```

**Key points:**

- The header filters server-side; only changed records come back.
- Save the max `UpdatedDateUTC` returned as the next cursor.

### Example 3: Find a contact then list their open bills

> "What do we still owe Acme?"

```http
# Step 1 — resolve the ContactID
GET /api.xro/2.0/Contacts?where=Name.Contains("Acme")
Xero-tenant-id: 70784a63-...

# Step 2 — list their unpaid bills (ACCPAY)
GET /api.xro/2.0/Invoices?where=Type=="ACCPAY"&&Contact.ContactID==guid("bd2270c3-...")&&AmountDue>0&order=DueDate asc&page=1
Xero-tenant-id: 70784a63-...
```

**Key points:**

- Two-step: resolve the GUID first, then filter invoices by `Contact.ContactID==guid("...")`.
- `Type=="ACCPAY"` = bills (money out); `Type=="ACCREC"` = sales invoices (money in).

---

## Gotchas & Counter-Exceptions

1. **Tenant header is non-negotiable.** Every example above silently requires `Xero-tenant-id`. Resolve it via `GET /connections` first; if the token serves multiple orgs, confirm which one with the user.
2. **`Statuses`/`IDs`/`InvoiceNumbers` beat `where`.** For "give me these specific ones" or "these statuses", use the dedicated comma-separated params — they're cheaper and don't hit `where` optimisation limits.
3. **`.Contains()` is unoptimised.** Fine for an interactive name lookup; do NOT use it as the spine of a full-org sync — use `If-Modified-Since` + paging instead.
4. **`/Accounts`, `/TaxRates`, `/Items`, `/Organisation` are not paged AND scope-gated.** With the current registry scopes they 403 (`accounting.settings.read` missing) — don't construct paging loops for them.
5. **Dates in responses are mixed.** Filter inputs use `DateTime(y,m,d)` / `YYYY-MM-DD`; responses come back as `/Date(epoch+tz)/` or ISO `*UTC`. Order/compare on `UpdatedDateUTC`.

---

_Generated from the investigation questionnaire, Phases 5-6._
