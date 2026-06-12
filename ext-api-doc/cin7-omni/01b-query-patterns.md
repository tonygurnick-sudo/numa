---
api_name: 'Cin7 Omni'
api_slug: 'cin7-omni'
generated_from: '00-api-investigation (2026-05-22) + live OpenAPI 3.0 spec'
generated_date: '2026-06-10'
source_phases: ['Phase 4: Query Patterns']
---

# Cin7 Omni -- Query Patterns Reference

> ⚠️ Investigation-confirmed (live API tests 2026-05-22) but NOT yet validated through the Numa connector path.
> All examples use the Numa `connectors` tool form — relative URLs, **no auth headers** (Numa injects Basic auth automatically).

## Query Capabilities Summary

Every list endpoint accepts the same five query parameters [SPEC]:

| Parameter | Purpose                              | Notes                                                              |
| --------- | ------------------------------------ | ------------------------------------------------------------------ |
| `fields`  | Comma-separated columns to return    | Supports nested child selection: `fields=Id,InvoiceDate,LineItems(Code)` [CONFIRMED — API investigation 2026-05-22] |
| `where`   | SQL-like filter expression           | Parent-level fields only — cannot filter on line-item fields [CONFIRMED — API investigation 2026-05-22] |
| `order`   | Sort field(s)                        | Default direction DESC; append ` ASC` to reverse [CONFIRMED — API investigation 2026-05-22] |
| `page`    | Page number, 1-based                 | Default 1 [SPEC]                                                   |
| `rows`    | Records per page                     | Default 50, **max 250** [SPEC]                                     |

There is **no full-text search endpoint** — use `LIKE` filters [UNVERIFIED, inferred from docs].

## `where` Filter Syntax

Operators [CONFIRMED — API investigation 2026-05-22]: `=`, `<>`, `>`, `<`, `>=`, `<=`, `IS`, `IS NOT`, `LIKE`, `NOT LIKE`, `IN`.

```
# Equality (strings single-quoted)
where=Stage='Dispatched'

# Date comparison (UTC, ISO format)
where=ModifiedDate>='2026-06-01T00:00:00Z'

# LIKE contains — the % wildcard MUST be written as %25
where=Company LIKE '%25Acme%25'

# IN list
where=Id IN (101,102,103)

# NULL checks
where=TrackingCode IS NULL
where=TrackingCode IS NOT NULL
```

**Critical:** encode `%` as `%25` inside `where` (e.g. `LIKE '%25363%25'`). An unencoded `%` corrupts the query string. [CONFIRMED — API investigation 2026-05-22]

Combining conditions: the vendor docs only demonstrate single-condition `where` clauses. Whether `AND`/`OR` compose inside one clause is [UNVERIFIED] — prefer one strong filter (usually `ModifiedDate`) and refine client-side.

## Field Selection

Trim wide payloads (order DTOs have 70+ fields) with `fields`:

```
# Top-level columns only
fields=Id,Reference,Stage,Total,ModifiedDate

# Include specific child-array columns
fields=Id,InvoiceDate,LineItems(Code)
```

Nested syntax is documented for SalesOrders; exact support per entity is [UNVERIFIED] — fall back to full payloads if a `fields` combination 400s.

## Pagination

- 1-based `page`, `rows` ≤ 250 [SPEC].
- **No total count anywhere in the response** — loop until an empty array comes back [CONFIRMED — API investigation 2026-05-22].
- Always set `order` for deterministic paging (default sort is DESC) [CONFIRMED — API investigation 2026-05-22].
- Out-of-range paging errors are explicit 400 strings: `"The page number is out of range..."`, `"The rows argument cannot be greater than 250."` [SPEC]

```
/v1/SalesOrders?order=ModifiedDate ASC&page=1&rows=250    → 250 records
/v1/SalesOrders?order=ModifiedDate ASC&page=2&rows=250    → 250 records
/v1/SalesOrders?order=ModifiedDate ASC&page=3&rows=250    → []  ← stop
```

**Rate-limit awareness:** each page is one request against 3/sec, 60/min, 5,000/day. A 10,000-record entity at `rows=250` costs 40 requests. Use `rows=250` for bulk reads, `rows=50` (default) for interactive answers.

## Common Patterns

### Pattern 1: List & filter

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/SalesOrders?where=Stage='Processing'&order=CreatedDate ASC&page=1&rows=50"})
```

### Pattern 2: Get by ID

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/Products/12345"})
```

Returns a single JSON object (not an array) with the full DTO including `ProductOptions[]` [SPEC].

### Pattern 3: Search by name (LIKE)

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/Contacts?where=Company LIKE '%25Acme%25'&fields=Id,Company,Email,Type,IsActive&rows=20"})
```

### Pattern 4: Date-range query

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/PurchaseOrders?where=CreatedDate>='2026-05-01T00:00:00Z'&order=CreatedDate ASC&page=1&rows=100"})
```

Only one bound is shown in vendor examples; for an upper bound, filter the tail client-side or rely on the watermark loop [UNVERIFIED whether two date conditions compose].

### Pattern 5: Column trimming for reports

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/Products?fields=Id,StyleCode,Name,Brand,Category,Status&order=Name ASC&page=1&rows=250"})
```

### Pattern 6: Sorting

```
order=CreatedDate            # DESC (default direction)
order=CreatedDate ASC        # oldest first — use for watermark syncs
```

## Worked Examples

### Example 1: "What sales orders changed in the last 24 hours?"

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/SalesOrders?where=ModifiedDate>='2026-06-09T00:00:00Z'&order=ModifiedDate ASC&page=1&rows=50"})
```

Walk `page=2,3,…` until empty. Each record: `Id`, `Reference`, `Stage`, `Status`, `MemberId`, `Company`, `Total`, `CurrencyCode`, `LineItems[]`, … [SPEC]

### Example 2: "How much stock do we have for SKU WIDGET-RED-L?"

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/Stock?where=Code='WIDGET-RED-L'&fields=ProductName,Code,BranchName,Available,StockOnHand,OpenSales,Incoming"})
```

One row per branch. `Available = StockOnHand − OpenSales`; `Incoming` = inbound PO qty; `Virtual` = kit stock [SPEC]. The HTML docs also show a `?barcode=` shortcut (`/v1/Stock?barcode=9780201379624`) [CONFIRMED — API investigation 2026-05-22].

### Example 3: "Show unpaid dispatched orders for Acme"

Two steps — find the contact, then their orders (filtering on nested fields is not possible):

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/Contacts?where=Company LIKE '%25Acme%25'&fields=Id,Company,Type"})

connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/SalesOrders?where=MemberId=12345&order=CreatedDate ASC&rows=100"})
```

Then check payments per order: `/v1/Payments?where=OrderId=67890` and compare `Amount` sums against order `Total` [UNVERIFIED — exact paid-status fields not documented; compute client-side].

### Example 4: "List products in a category" (note `%25` for the LIKE on an array-ish field)

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/Products?where=CategoryIdArray LIKE '%25363%25'&fields=Id,Name,StyleCode&rows=100"})
```

This `categoryIdArray LIKE '%25363%25'` form is the vendor's own example [CONFIRMED — API investigation 2026-05-22].

### Example 5: "Look up a gift voucher"

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/Voucher?code=GIFT-2026-XYZ"})
```

Returns `Code`, `Status` (Active = has balance), `Amount`, `RedeemedAmount`, `ExpiryDate`, `CustomerEmail` [SPEC].

### Example 6: "Get the BOM for a product"

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v2/BomMasters?where=ProductId=9876"})
```

BomMasters is the only v2 entity; v1 also works [CONFIRMED — API investigation 2026-05-22].

## Incremental Sync Strategy (no webhooks)

Cin7 Omni has **no outbound webhooks** [CONFIRMED — API investigation 2026-05-22]. The change-detection pattern is a `ModifiedDate` watermark poll:

1. Store `last_synced_at` per entity.
2. Each cycle:
   ```
   /v1/SalesOrders?where=ModifiedDate>='{last_synced_at}'&order=ModifiedDate ASC&page=1&rows=250
   ```
3. Page until empty; track the highest `ModifiedDate` seen.
4. Set the watermark to that value (use `>=` and dedupe by `Id` to avoid boundary misses) [UNVERIFIED — boundary semantics untested].
5. Sleep until the next cycle.

**Budget check** [CONFIRMED — API investigation 2026-05-22 rate limits]: polling 5 entities every 5 minutes ≈ 1,440 calls/day if most polls return one page — comfortably inside 5,000/day. A Stock-level scan has no `where=ModifiedDate` guarantee per row — Stock rows expose `ModifiedDate` as "last transaction date" [SPEC], so the same watermark filter should work [UNVERIFIED].

## Gotchas & Counter-Exceptions

1. **Filters apply to parent fields only.** "Orders containing product X" requires fetching orders and scanning `LineItems` client-side, or going via `/v1/Stock`/`OpenSales`. [CONFIRMED — API investigation 2026-05-22]
2. **`%` must be `%25`** in every LIKE — the single most common query bug. [CONFIRMED — API investigation 2026-05-22]
3. **Empty result ≠ error.** `[]` with HTTP 200 just means no matches / past the last page.
4. **`rows` > 250 → 400** with `"The rows argument cannot be greater than 250."` [SPEC]
5. **403 on a read** = the API key lacks Read permission for that endpoint (Cin7 Settings → Integrations & API), not bad credentials. [CONFIRMED — API investigation 2026-05-22]
6. **Users endpoint lags** — newly created Cin7 users can take up to 2 hours to appear. [CONFIRMED — API investigation 2026-05-22]
7. **Wide DTOs**: SalesOrders/PurchaseOrders return 70+ fields each — use `fields` whenever you don't need everything; 250 full orders is a large payload.
8. **Query param field casing** — vendor examples use lowercase (`modifieddate`), the spec uses PascalCase (`ModifiedDate`); both appear accepted [UNVERIFIED]. Pick one and stay consistent.
