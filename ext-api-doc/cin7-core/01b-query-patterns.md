---
api_name: 'Cin7 Core'
api_slug: 'cin7-core'
generated_from: '00-api-investigation (Cin7 dual-product investigation, 2026-05-22)'
generated_date: '2026-06-10'
update_source: 'Official Apiary blueprint (dearinventory.docs.apiary.io), captured live 2026-05-22 — NOT validated through the Numa connector path'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Cin7 Core -- Query Patterns Reference

> ⚠️ **Investigation-confirmed (live API tests 2026-05-22) but NOT yet validated through the Numa connector path.**
> Companion to `01-llm-api-rules.md`. All read patterns: list vs detail endpoints,
> pagination, filtering, and incremental-sync polling. [DOCS] = official Apiary blueprint;
> [UNVERIFIED] = inferred — probe with a cheap request before relying on it.

> **Auth note:** Examples use the Numa request form with bare relative paths. The Numa
> backend injects `api-auth-accountid` + `api-auth-applicationkey` from the user's vault
> automatically and expands relative URLs against
> `https://inventory.dearsystems.com/externalapi/v2`. Never set auth headers; never use an
> absolute URL.

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/SaleList?page=1&limit=100",
  "method": "GET"
})
```

---

## Query Capabilities Summary

| Capability | Supported | Syntax | Notes |
| --- | --- | --- | --- |
| Pagination | 7 endpoints only | `?page={n}&limit={size}` | `SaleList`, `PurchaseList`, `StockAdjustmentList`, `StockTakeList`, `StockTransferList`, `Product`, `Category` [DOCS] |
| Total count | Yes (paginated endpoints) | automatic | `Total` field in response [DOCS] |
| Get by ID | Yes | `?ID={guid}` / `?SaleID={guid}` | Query-string param, NOT a path segment [DOCS] |
| Filter by field | Endpoint-specific | e.g. `?Name=...` | Each endpoint documents its own params; no generic filter grammar [UNVERIFIED per endpoint] |
| Date-range filter | Some list endpoints | e.g. `?CreatedSince=...` | Parameter names [UNVERIFIED] — confirm per endpoint before use |
| Full-text search | No | — | Exact/param matching only [UNVERIFIED] |
| Sort | Not documented | — | Assume server default ordering [UNVERIFIED] |
| Field selection | No | — | Full rows/objects always returned [UNVERIFIED] |
| Logical operators | No | — | Multiple params combine implicitly (AND) [UNVERIFIED] |

**The key mental model:** Cin7 Core has no generic query language. Reads are
(1) paginated **list endpoints** for summaries, (2) **detail endpoints** keyed by GUID,
and (3) everything else returns **all records at once**.

---

## The Three Read Surfaces

### 1. Paginated list endpoints [DOCS]

`/SaleList`, `/PurchaseList`, `/StockAdjustmentList`, `/StockTakeList`,
`/StockTransferList`, `/Product`, `/Category`

- Accept `page` (1-based) and `limit` (default 100, min 1, max 1000).
- Response = named array + `Total`, e.g. `{ "Products": [...], "Total": 412 }`.
- `SaleList`/`PurchaseList` rows are **summaries** — they give you the GUID
  (`SaleID`) to fetch the full document.

### 2. Detail endpoints by GUID [DOCS]

```
GET /Sale?SaleID={guid}        full composite sale (all stage sub-documents)
GET /Product?ID={guid}         single product
GET /Purchase?ID={guid}        full purchase ([UNVERIFIED] param name)
```

Note the ID goes in the **query string**, not the path. The full Sale object embeds
quote/order/fulfilment/invoice/payment sub-documents — large but complete; one call answers
most "tell me about order SO-00044" questions (after resolving the order number to a
`SaleID` via `/SaleList`).

### 3. Non-paginated endpoints — return everything [DOCS]

`/Customer`, `/Supplier`, `/Location`, `/Tax`, `/PaymentTerm`, `/Brand`, `/Carrier`,
`/ProductAvailability`, etc. return **all records in one response**.

- Fine for reference books (locations, taxes, terms — usually small).
- Risky for Customers/Suppliers on large accounts — the payload can be very large. Fetch
  once per conversation, filter client-side, summarize rather than dump.
- Some of these accept endpoint-specific filter params (e.g. a name filter) [UNVERIFIED] —
  if a filter matters, try it and verify the result count changes.

---

## Pagination Handling

### Model [DOCS]

- **Type:** page-based — `?page={n}&limit={size}`, 1-based.
- **Default limit:** 100. **Min:** 1. **Max:** 1000.
- **Total:** every paginated response includes `Total` (count of all matching records).
- **Pages needed:** `ceil(Total / limit)`.

### Full pagination loop

```
Request 1: GET /Product?page=1&limit=200
Response 1: { "Products": [...200 rows...], "Total": 412 }

Request 2: GET /Product?page=2&limit=200
Response 2: { "Products": [...200 rows...], "Total": 412 }

Request 3: GET /Product?page=3&limit=200
Response 3: { "Products": [...12 rows...], "Total": 412 }   ← done (3 = ceil(412/200))
```

- Stop when `page >= ceil(Total / limit)` or a page comes back short/empty.
- **Pace requests** — the 60/min limit means a 50-page walk takes ≥ 50 seconds of budget.
  Prefer `limit=500`–`1000` for bulk reads to minimize request count [UNVERIFIED at the
  1000 ceiling — documented max, not exercised].
- The array key matches the entity (e.g. `Products`, `SaleList` [UNVERIFIED exact key per
  endpoint]) — locate the array value defensively rather than hardcoding the key.

---

## Worked Examples

> Request shapes from the Apiary blueprint [DOCS]; response rows illustrative. None
> replayed through the Numa connector yet.

### Example 1: Verify the connection / identify the company

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/me",
  "method": "GET"
})
```

Returns current account/company details [DOCS]. Cheap first call to confirm credentials
work before doing real work.

### Example 2: Paginated product catalogue scan

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/Product?page=1&limit=500",
  "method": "GET"
})
```

```json
{ "Products": [ { "ID": "guid", "SKU": "WIDGET-001", "Name": "Widget", "Status": "Active" } ], "Total": 412 }
```

`Total` ≤ 500 here, so one page suffices. For catalogue questions ("how many SKUs…",
"find products like…") fetch pages and filter client-side.

### Example 3: Find a sale by order number, then get full detail

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/SaleList?page=1&limit=100",
  "method": "GET"
})
```

Scan rows for `SaleOrderNumber == "SO-00044"` → take its `SaleID`. (A direct
`?Search=`/number filter on SaleList may exist [UNVERIFIED] — try it before walking pages
on large accounts.) Then:

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/Sale?SaleID=91EE7B1D-BD35-4E43-B98A-DB86BE777624",
  "method": "GET"
})
```

Returns the composite sale: customer, lines, and the quote/order/fulfilment/invoice/payment
stage sub-documents in one object. [DOCS]

### Example 4: Stock on hand for a product

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/ProductAvailability",
  "method": "GET"
})
```

Real-time availability per location [DOCS]. Not paginated — returns all rows; filter
client-side by SKU/location. Per-SKU query params [UNVERIFIED].

### Example 5: Customer lookup (non-paginated — handle with care)

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/Customer",
  "method": "GET"
})
```

Returns ALL customers [DOCS]. On large accounts this is a heavy call — make it once,
filter in memory (`Name` is unique [DOCS]), and reuse within the conversation. A
`?Name={exact}` filter may be supported [UNVERIFIED] — worth one probe on first use.

### Example 6: Recent stock adjustments (paginated list + detail)

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/StockAdjustmentList?page=1&limit=100",
  "method": "GET"
})
```

Then fetch a specific adjustment via `/StockAdjustment?ID={guid}` [UNVERIFIED param name].

---

## Incremental Sync / Polling Strategy

There is no Numa webhook receiver, so in-chat change detection is polling-based:

1. **Watermark on `LastModifiedOn`** — master records (e.g. Customer) carry a read-only
   `LastModifiedOn` (UTC) [DOCS]. Fetch, then compare against the last-seen watermark
   client-side.
2. **List endpoints + date params** — `SaleList`/`PurchaseList` likely accept
   created/updated date-range parameters (names [UNVERIFIED]). If confirmed on the live
   instance, prefer them over full walks.
3. **Full-walk diff (fallback)** — for paginated endpoints, walk pages and diff against
   what you saw earlier in the conversation. Budget: a 1,000-record entity at `limit=500`
   costs 2 requests — comfortably inside 60/min.
4. If the customer has the **Automation module**, they can point webhooks at their own
   systems — but those events do not reach Numa. See `01d`.

**Date literal format for any date parameter:** `yyyy-MM-ddTHH:mm:ss.fff`
(e.g. `2026-06-10T00:00:00.000`) — no `Z`. [DOCS]

---

## Gotchas & Counter-Exceptions

1. **`?page`/`?limit` are silently meaningless outside the 7 paginated endpoints** — the
   response is just "everything". Never claim you fetched "the first 100 customers";
   `/Customer` gave you all of them. [DOCS]
2. **404 on a read = wrong endpoint name**, not a missing record. Endpoints are singular
   (`/Product`, `/Customer`); `/Products` 404s. Detail lookups with an unknown GUID return
   [UNVERIFIED — possibly 200 with empty body/404]; check both. [DOCS]
3. **IDs go in the query string** (`/Sale?SaleID={guid}`), not the path. There are no
   `/Sale/{id}` path routes in the blueprint. [DOCS]
4. **204 No Content** is a valid success for reads with nothing to return — handle the
   empty body without JSON-parsing it. [DOCS]
5. **Heavy reads burn rate budget.** 60/min shared across everything you do — interleave
   page walks with other work and pace at ~1 req/sec.
6. **The full `/Sale` object is large.** When the user only needs status or a total, prefer
   the `SaleList` summary row you already have.
7. **Response array key varies per endpoint** (`Products` vs others [UNVERIFIED]) — find
   the array dynamically; don't assume the entity name.
8. **No sort guarantees.** Ordering is undocumented [UNVERIFIED] — if order matters (e.g.
   "latest 5 orders"), sort client-side on the relevant date field after fetching.

---

_Generated 2026-06-10 from the 2026-05-22 Cin7 API investigation (official Apiary blueprint). NOT yet validated through the Numa connector path._
