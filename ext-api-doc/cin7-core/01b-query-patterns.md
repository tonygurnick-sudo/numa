---
api_name: Cin7 Core
api_slug: cin7-core
base_url: https://inventory.dearsystems.com/externalapi/v2
call_surface: HTTP via `numa integrations request cin7-core <METHOD> <relative-url>`; pass flat relative paths. Backend injects api-auth-accountid + api-auth-applicationkey and expands relative URLs against base_url. Never set auth headers; never use an absolute URL.
role: on-demand read reference — list vs detail endpoints, pagination, filtering, incremental-sync polling
confidence: every fact from the official Cin7 Core Apiary blueprint, captured live 2026-05-22; NOT validated through the Numa connector. Inline [UNVERIFIED] = inferred, probe with a cheap request before relying. Companion to 01-llm-api-rules.md.
---

# Cin7 Core — Query Patterns Reference

## Query capabilities summary

| Capability        | Supported                 | Syntax                          | Notes                                                                                                          |
| ----------------- | ------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Pagination        | 7 endpoints only          | `?page={n}&limit={size}`        | `SaleList`, `PurchaseList`, `StockAdjustmentList`, `StockTakeList`, `StockTransferList`, `Product`, `Category` |
| Total count       | Yes (paginated endpoints) | automatic                       | `Total` field in response                                                                                      |
| Get by ID         | Yes                       | `?ID={guid}` / `?SaleID={guid}` | Query-string param, NOT a path segment                                                                         |
| Filter by field   | Endpoint-specific         | e.g. `?Name=...`                | Each endpoint documents its own params; no generic filter grammar [UNVERIFIED per endpoint]                    |
| Date-range filter | Some list endpoints       | e.g. `?CreatedSince=...`        | Param names [UNVERIFIED] — confirm per endpoint                                                                |
| Full-text search  | No                        | —                               | Exact/param matching only [UNVERIFIED]                                                                         |
| Sort              | Not documented            | —                               | Assume server default ordering [UNVERIFIED]                                                                    |
| Field selection   | No                        | —                               | Full rows/objects always returned [UNVERIFIED]                                                                 |
| Logical operators | No                        | —                               | Multiple params combine implicitly (AND) [UNVERIFIED]                                                          |

**Mental model:** no generic query language. Reads are (1) paginated **list endpoints** for summaries, (2) **detail endpoints** keyed by GUID, (3) everything else returns **all records at once**.

## The three read surfaces

### 1. Paginated list endpoints

`/SaleList`, `/PurchaseList`, `/StockAdjustmentList`, `/StockTakeList`, `/StockTransferList`, `/Product`, `/Category`

- Accept `page` (1-based) and `limit` (default 100, min 1, max 1000).
- Response = named array + `Total`, e.g. `{"Products":[...],"Total":412}`.
- `SaleList`/`PurchaseList` rows are **summaries** — give the GUID (`SaleID`) to fetch the full document.

### 2. Detail endpoints by GUID

```
GET /Sale?SaleID={guid}    full composite sale (all stage sub-documents)
GET /Product?ID={guid}     single product
GET /Purchase?ID={guid}    full purchase (param name [UNVERIFIED])
```

ID goes in the **query string**, not the path. The full Sale object embeds quote/order/fulfilment/invoice/payment sub-documents — large but complete; one call answers most "tell me about order SO-00044" questions (after resolving the order number to a `SaleID` via `/SaleList`).

### 3. Non-paginated endpoints — return everything

`/Customer`, `/Supplier`, `/Location`, `/Tax`, `/PaymentTerm`, `/Brand`, `/Carrier`, `/ProductAvailability`, etc. return **all records in one response**.

- Fine for reference books (locations, taxes, terms — usually small).
- Risky for Customers/Suppliers on large accounts — payload can be very large. Fetch once per conversation, filter client-side, summarize rather than dump.
- Some accept endpoint-specific filter params (e.g. a name filter) [UNVERIFIED] — if a filter matters, try it and verify the result count changes.

## Pagination handling

- **Type:** page-based, `?page={n}&limit={size}`, 1-based. Default limit 100, min 1, max 1000.
- **Total:** every paginated response includes `Total` (count of all matching records). Pages needed = `ceil(Total / limit)`.
- Stop when `page >= ceil(Total / limit)` or a page comes back short/empty.
- **Pace requests** — 60/min means a 50-page walk costs ≥ 50s of budget. Prefer `limit=500`–`1000` for bulk reads [UNVERIFIED at the 1000 ceiling — documented max, not exercised].
- Array key matches the entity (`Products`, `SaleList` [UNVERIFIED exact key per endpoint]) — locate the array value defensively, don't hardcode the key.

Loop example:

```
GET /Product?page=1&limit=200 → {"Products":[...200...],"Total":412}
GET /Product?page=2&limit=200 → {"Products":[...200...],"Total":412}
GET /Product?page=3&limit=200 → {"Products":[...12...],"Total":412}  ← done (3 = ceil(412/200))
```

## Worked examples

Response rows illustrative; none replayed through the connector yet.

**1. Verify connection / identify company:**
`numa integrations request cin7-core GET /me -m "verify connection"` → current account/company details. Cheap first call to confirm credentials before real work.

**2. Paginated product catalogue scan:**
`numa integrations request cin7-core GET "/Product?page=1&limit=500" -m "scan products"`
→ `{"Products":[{"ID":"guid","SKU":"WIDGET-001","Name":"Widget","Status":"Active"}],"Total":412}`
`Total` ≤ 500 → one page suffices. For catalogue questions ("how many SKUs…", "find products like…") fetch pages and filter client-side.

**3. Find a sale by order number, then full detail:**
`numa integrations request cin7-core GET "/SaleList?page=1&limit=100" -m "list sales"` → scan rows for `SaleOrderNumber == "SO-00044"`, take its `SaleID`. (A direct `?Search=`/number filter on SaleList may exist [UNVERIFIED] — try it before walking pages on large accounts.) Then:
`numa integrations request cin7-core GET "/Sale?SaleID=91EE7B1D-BD35-4E43-B98A-DB86BE777624" -m "get sale"` → composite sale: customer, lines, and quote/order/fulfilment/invoice/payment stage sub-documents in one object.

**4. Stock on hand for a product:**
`numa integrations request cin7-core GET /ProductAvailability -m "stock on hand"` → real-time availability per location. Not paginated — returns all rows; filter client-side by SKU/location. Per-SKU query params [UNVERIFIED].

**5. Customer lookup (non-paginated — handle with care):**
`numa integrations request cin7-core GET /Customer -m "list customers"` → ALL customers. On large accounts a heavy call — make it once, filter in memory (`Name` is unique), reuse within the conversation. A `?Name={exact}` filter may be supported [UNVERIFIED] — worth one probe on first use.

**6. Recent stock adjustments (paginated list + detail):**
`numa integrations request cin7-core GET "/StockAdjustmentList?page=1&limit=100" -m "list adjustments"` → then fetch a specific one via `/StockAdjustment?ID={guid}` [UNVERIFIED param name].

## Incremental sync / polling strategy

No Numa webhook receiver, so in-chat change detection is polling-based:

1. **Watermark on `LastModifiedOn`** — master records (e.g. Customer) carry a read-only `LastModifiedOn` (UTC). Fetch, compare against the last-seen watermark client-side.
2. **List endpoints + date params** — `SaleList`/`PurchaseList` likely accept created/updated date-range params (names [UNVERIFIED]). If confirmed on the live instance, prefer them over full walks.
3. **Full-walk diff (fallback)** — walk paginated pages and diff against what you saw earlier. Budget: a 1,000-record entity at `limit=500` costs 2 requests — comfortably inside 60/min.
4. If the customer has the **Automation module**, they can point webhooks at their own systems — but those events do not reach Numa. See `01d`.

Date literal format for any date parameter: `yyyy-MM-ddTHH:mm:ss.fff` (e.g. `2026-06-10T00:00:00.000`) — no `Z`.

## Gotchas & counter-exceptions

1. **`?page`/`?limit` silently meaningless outside the 7 paginated endpoints** — the response is just "everything". Never claim you fetched "the first 100 customers"; `/Customer` gave you all of them.
2. **404 on a read = wrong endpoint name**, not a missing record. Endpoints are singular (`/Product`, `/Customer`); `/Products` 404s. Detail lookups with an unknown GUID return [UNVERIFIED — possibly 200 with empty body or 404]; check both.
3. **IDs go in the query string** (`/Sale?SaleID={guid}`), not the path. No `/Sale/{id}` path routes exist.
4. **204 No Content** is a valid success for reads with nothing to return — handle the empty body without JSON-parsing.
5. **Heavy reads burn rate budget.** 60/min shared across everything — interleave page walks with other work, pace ~1 req/sec.
6. **The full `/Sale` object is large.** When the user only needs status or a total, prefer the `SaleList` summary row you already have.
7. **Response array key varies per endpoint** (`Products` vs others [UNVERIFIED]) — find the array dynamically.
8. **No sort guarantees.** Ordering undocumented [UNVERIFIED] — if order matters (e.g. "latest 5 orders"), sort client-side on the relevant date field after fetching.
