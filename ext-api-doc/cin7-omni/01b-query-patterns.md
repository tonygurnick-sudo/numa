---
api_name: Cin7 Omni
api_slug: cin7-omni
base_url: https://api.cin7.com/api
path_version_segment: /v1/ all entities, /v2/ BomMasters only — part of the path
call_surface: HTTP via `numa integrations request` (connectors(request) form below); relative urls, NO auth headers (Numa injects Basic)
doc_role: on-demand reference — filtering, search, pagination, incremental sync
confidence: every fact live-API-confirmed 2026-05-22 unless tagged [SPEC] or [UNVERIFIED]. NOT yet validated through the Numa connector path.
---

# Cin7 Omni — Query Patterns

## Query params (every list GET)

| Param    | Purpose                 | Notes                                                                                                                                                                     |
| -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields` | comma-separated columns | nested child selection: `fields=Id,InvoiceDate,LineItems(Code)` (documented for SalesOrders; per-entity support [UNVERIFIED] — fall back to full payload if a combo 400s) |
| `where`  | SQL-like filter         | **parent-level fields only** — cannot filter line-item fields                                                                                                             |
| `order`  | sort field(s)           | default direction DESC; append ` ASC` to reverse                                                                                                                          |
| `page`   | page number, 1-based    | default 1 [SPEC]                                                                                                                                                          |
| `rows`   | records/page            | default 50, **max 250** [SPEC]                                                                                                                                            |

No full-text search endpoint — use `LIKE` [UNVERIFIED, inferred].

## `where` syntax

Operators: `=`, `<>`, `>`, `<`, `>=`, `<=`, `IS`, `IS NOT`, `LIKE`, `NOT LIKE`, `IN`.

```
where=Stage='Dispatched'                          # equality (strings single-quoted)
where=ModifiedDate>='2026-06-01T00:00:00Z'        # date (UTC, ISO)
where=Company LIKE '%25Acme%25'                   # LIKE contains — % MUST be %25
where=Id IN (101,102,103)                          # IN list
where=TrackingCode IS NULL / IS NOT NULL           # NULL checks
```

**`%` must be written `%25` in every LIKE** (e.g. `'%25363%25'`). Unencoded `%` corrupts the query string — the single most common query bug.
Whether `AND`/`OR` compose inside one `where` clause is [UNVERIFIED] (vendor docs show single-condition only) — prefer one strong filter (usually `ModifiedDate`) and refine client-side.

## Field selection

Trim wide payloads (order DTOs 70+ fields) with `fields`:

```
fields=Id,Reference,Stage,Total,ModifiedDate       # top-level columns
fields=Id,InvoiceDate,LineItems(Code)              # include child-array columns
```

## Pagination

1-based `page`, `rows` ≤ 250. **No total count anywhere** — loop until an empty array. Always set `order` (default sort DESC). Out-of-range → explicit 400 strings: `"The page number is out of range; the value must be greater than or equal to 1."`, `"The rows argument cannot be greater than 250."` [SPEC]

```
/v1/SalesOrders?order=ModifiedDate ASC&page=1&rows=250    → 250
/v1/SalesOrders?order=ModifiedDate ASC&page=2&rows=250    → 250
/v1/SalesOrders?order=ModifiedDate ASC&page=3&rows=250    → []  ← stop
```

Each page is one request against 3/sec, 60/min, 5000/day. A 10,000-record entity at `rows=250` costs 40 requests. Use `rows=250` for bulk reads, `rows=50` for interactive answers.
Sort: `order=CreatedDate` (DESC default) · `order=CreatedDate ASC` (oldest first — use for watermark syncs).

## Patterns

1. List & filter:
   `connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/SalesOrders?where=Stage='Processing'&order=CreatedDate ASC&page=1&rows=50"})`

2. Get by ID (returns a single JSON object, not an array; full DTO incl. `ProductOptions[]`):
   `connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/Products/12345"})`

3. Search by name (LIKE):
   `connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/Contacts?where=Company LIKE '%25Acme%25'&fields=Id,Company,Email,Type,IsActive&rows=20"})`

4. Date-range (one bound shown in vendor examples; for an upper bound filter the tail client-side or rely on the watermark loop — two date conditions composing is [UNVERIFIED]):
   `connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/PurchaseOrders?where=CreatedDate>='2026-05-01T00:00:00Z'&order=CreatedDate ASC&page=1&rows=100"})`

5. Column trimming for reports:
   `connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/Products?fields=Id,StyleCode,Name,Brand,Category,Status&order=Name ASC&page=1&rows=250"})`

## Worked examples

1. "What sales orders changed in the last 24h?" Walk `page=2,3,…` until empty. Each record: `Id`,`Reference`,`Stage`,`Status`,`MemberId`,`Company`,`Total`,`CurrencyCode`,`LineItems[]`,… [SPEC]
   `connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/SalesOrders?where=ModifiedDate>='2026-06-09T00:00:00Z'&order=ModifiedDate ASC&page=1&rows=50"})`

2. "Stock for SKU WIDGET-RED-L?" One row per branch. `Available=StockOnHand−OpenSales`; `Incoming`=inbound PO qty; `Virtual`=kit stock [SPEC]. HTML docs also show a `?barcode=` shortcut (`/v1/Stock?barcode=9780201379624`).
   `connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/Stock?where=Code='WIDGET-RED-L'&fields=ProductName,Code,BranchName,Available,StockOnHand,OpenSales,Incoming"})`

3. "Unpaid dispatched orders for Acme" — two steps (can't filter nested fields): find the contact, then their orders, then compare payment sums vs order `Total` ([UNVERIFIED] — exact paid-status fields not documented; compute client-side):
   `connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/Contacts?where=Company LIKE '%25Acme%25'&fields=Id,Company,Type"})`
   `connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/SalesOrders?where=MemberId=12345&order=CreatedDate ASC&rows=100"})`
   `connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/Payments?where=OrderId=67890"})`

4. "Products in a category" (LIKE on an array-ish field — vendor's own example):
   `connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/Products?where=CategoryIdArray LIKE '%25363%25'&fields=Id,Name,StyleCode&rows=100"})`

5. "Look up a gift voucher" → returns `Code`,`Status` (Active=has balance),`Amount`,`RedeemedAmount`,`ExpiryDate`,`CustomerEmail` [SPEC]:
   `connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/Voucher?code=GIFT-2026-XYZ"})`

6. "Get the BOM for a product" (BomMasters is the only v2 entity; v1 also works):
   `connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v2/BomMasters?where=ProductId=9876"})`

## Incremental sync (no webhooks)

Cin7 Omni has **no outbound webhooks** — the only change-detection pattern is a `ModifiedDate` watermark poll:

1. Store `last_synced_at` per entity.
2. Each cycle: `/v1/SalesOrders?where=ModifiedDate>='{last_synced_at}'&order=ModifiedDate ASC&page=1&rows=250`.
3. Page until empty; track the highest `ModifiedDate` seen.
4. Set the watermark to that value (use `>=` and dedupe by `Id` to avoid boundary misses) [UNVERIFIED — boundary semantics untested].
5. Sleep until the next cycle.

**Budget:** polling 5 entities every 5 min ≈ 1,440 calls/day if most polls return one page — comfortably inside 5000/day. Stock rows expose `ModifiedDate` as "last transaction date" [SPEC], so the same watermark filter should work [UNVERIFIED].

## Gotchas (query-specific)

1. **Filters apply to parent fields only.** "Orders containing product X" → fetch orders + scan `LineItems` client-side, or go via `/v1/Stock`/`OpenSales`.
2. **`%` must be `%25`** in every LIKE.
3. **Empty `[]` with HTTP 200 is not an error** — no matches / past the last page. Stop paging; don't retry.
4. **`rows` > 250 → 400** `"The rows argument cannot be greater than 250."` [SPEC]
5. **403 on a read** = the key lacks Read permission for that endpoint (Cin7 Settings → Integrations & API), not bad credentials.
6. **Users endpoint lags** — newly created Cin7 users take up to 2h to appear.
7. **Query-param field casing** — vendor examples lowercase (`modifieddate`), spec PascalCase (`ModifiedDate`); both appear accepted [UNVERIFIED]. Pick one, stay consistent.
