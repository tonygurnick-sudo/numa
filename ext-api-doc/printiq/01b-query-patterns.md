---
api_name: PrintIQ
api_slug: printiq
companion_to: 01-llm-api-rules.md
content: read operations — filtering, search, sorting, pagination, bulk reads
confidence: LOW. No public query/filter/pagination docs exist for IQConnect — this whole file is a DISCOVERY PLAN, not a verified contract. Only `GetPrice` has public grounding (existence [DOCUMENTED], shape [INFERRED]). Everything else is [INFERRED] from REST conventions or [UNKNOWN]. On a real instance, read the actual response envelope and trust it over this doc.
---

# PrintIQ — Query Patterns Reference

## Query Capabilities

All `[UNKNOWN]` — no public query docs: filter by field value · filter by date range (likely a `modifiedSince`-style param [INFERRED]) · full-text search · sort by field · sort direction · field selection · include related records · aggregation/count · logical operators (AND/OR) · comparison operators · null checks.

The most useful read is NOT a query — it is `POST .../GetPrice`, which _computes_ a price from a posted spec rather than filtering stored records. Prefer it for any pricing question.

## Patterns

### 1. Price a product (the primary read) [DOCUMENTED exists / INFERRED shape]

Hero capability. POST product + spec + quantity, get a live price — a compute call, nothing to paginate.

```http
POST /api/Quote/GetPrice   Authorization: Bearer {token}   Content-Type: application/json
{ "productCode": "BC-350GSM", "quantity": 500, "options": { "finish": "Matte Laminate", "sides": "Double Sided" } }
```

- Requires a valid `productCode` AND its required option/spec selections — a bare code may fail or misprice. [INFERRED]
- Do NOT cache — printIQ is the pricing source of truth, prices change. [DOCUMENTED]
- Exact path (`/api/Quote/GetPrice` vs `/api/GetPrice`) and payload keys `[INFERRED]` — confirm.

### 2. Get by reference (quote/job/customer/product) [INFERRED]

Single-resource lookup by human reference; most reliable read beyond GetPrice.

```http
GET /api/Quote/{quoteNo}
GET /api/Job/{jobNo}
GET /api/Customer/{customerCode}
GET /api/Product/{productCode}
Authorization: Bearer {token}
```

- Path-param key `[UNKNOWN]` (could be the human ref `Q-100234` or a GUID). Try human ref first; if 404, try GUID. [INFERRED]
- 404 is ambiguous: wrong reference OR wrong instance host/base path — verify both. [INFERRED]

### 3. List & filter [UNKNOWN — discovery required]

Whether list endpoints exist, and how to filter, is unverified.

```http
[INFERRED — UNVERIFIED] GET /api/Quote?customerCode=CUST001&status=Quoted&page=1&pageSize=20   Authorization: Bearer {token}
```

Filter operators `[UNKNOWN]`; likely flat query-string equality (`field=value`) combined with AND; nested conditions assumed unsupported. [INFERRED]

### 4. Date-range / "modified since" query [UNKNOWN]

Needed for polling (see 01d). Whether a modified-since filter exists is unverified.

```http
[INFERRED — UNVERIFIED] GET /api/Job?modifiedSince=2026-05-29T00:00:00Z   Authorization: Bearer {token}
```

Date format ISO 8601 assumed. If no modified-since filter exists, fall back to fetching by known reference and diffing `status`. [INFERRED]

### 5. Get related records [UNKNOWN]

Whether sub-resource paths or parent-filter params exist is unverified — try ONE, read what comes back:

```http
GET /api/Customer/{customerCode}/Quotes      (sub-resource style)
GET /api/Quote?customerCode={customerCode}    (parent-filter style)
```

### 6. Aggregation / count [UNKNOWN]

No public count/aggregate capability. Do NOT assume a `/count` endpoint exists.

## Pagination

Type `[UNKNOWN]` — likely page-number or offset. Default/max size `[UNKNOWN]`; default conservatively to 20 in requests you construct. Total count `[UNKNOWN]`.

Params (INFERRED — UNVERIFIED): `page` (int, page number if page-number model) · `pageSize` (int, records/page) · `offset` (int, alternative offset model).

Response (INFERRED — read the real envelope and adapt): `{ "data": [ ...records... ], "page": 1, "pageSize": 20, "total": 137 }`

Last page detection `[UNKNOWN]` — likely empty `data`, or `page*pageSize >= total`, or absent `next`. On a live instance: fetch page 1, inspect the envelope, use whatever signal it returns. [INFERRED]

Loop (INFERRED): GET `?page=1&pageSize=20` → `{data:[...20...],page:1,total:137}`; GET `?page=2&pageSize=20`; … last page returns a short/empty page (or `page*size >= total`) = done.

## Worked Examples (all `[INFERRED]` reconstructions, NOT live calls)

1. Price 500 double-sided matte business cards [DOCUMENTED exists / INFERRED shape]:
   `POST /api/Quote/GetPrice` (Host {instance}.printiq.com, Bearer token)
   `{ "productCode": "BC-350GSM", "quantity": 500, "options": { "finish": "Matte Laminate", "sides": "Double Sided" } }`
   → `{ "price": 250.0, "currency": "NZD", "leadTimeDays": 3, "breakdown": [] }`

- Reach for this whenever the user asks "how much for X?". [DOCUMENTED]
- Quantity breaks matter — pricing is usually quantity-tiered; re-call per quantity, don't extrapolate. [INFERRED]

2. Check status of job J-100234 [INFERRED]:
   `GET /api/Job/J-100234` → `{ "jobNo": "J-100234", "status": "In Production", "dueDate": "2026-06-04", "shippedDate": null }`

- Use this (or its modified-since list variant) as the polling read for shipping status if no "shipped" webhook is provisioned. [INFERRED]
- `shippedDate:null` + `status:"In Production"` → not yet shipped. [INFERRED]

3. Look up customer CUST001 [INFERRED]:
   `GET /api/Customer/CUST001` → `{ "customerCode": "CUST001", "name": "Acme Signs Ltd", "accountStatus": "Active", "priceList": "Trade" }`

- `priceList`/pricing tier affects what `GetPrice` returns — note it when pricing for a specific customer. [INFERRED]

## Gotchas

1. `GetPrice` is a POST compute call, not a query — POST the spec, don't try to "filter products for a price". [DOCUMENTED]
2. 404 is ambiguous (wrong reference OR wrong instance host/base path) — re-check the host first. [INFERRED]
3. No confirmed list/pagination contract — don't loop pages blindly; fetch page 1, read the envelope, then decide. [UNKNOWN]
4. Reference key type unknown — a path param might want the human ref (`Q-100234`) or a GUID; try human ref, fall back to GUID. [INFERRED]
5. Pricing is per-customer/per-`priceList` — same product can price differently by tier; don't reuse one customer's price for another. [INFERRED]
