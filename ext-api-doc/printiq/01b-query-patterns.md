---
api_name: 'PrintIQ'
api_slug: 'printiq'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
update_source: 'web research only — NO live API access; partner-gated docs'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# PrintIQ -- Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Read operation patterns: filtering, searching, sorting,
> pagination, and bulk reads.
>
> ⚠️ **CONFIDENCE: LOW.** No public query/filter/pagination documentation exists for the IQConnect
> API. **This entire file is a discovery plan, not a verified contract.** The only read operation
> with real public grounding is `GetPrice` (existence DOCUMENTED, shape INFERRED). Everything else is
> `[INFERRED]` from REST conventions or `[UNKNOWN]`. When you hit a real instance, read the actual
> response envelope and trust it over this document.

---

## Query Capabilities Summary

| Capability                 | Supported | Syntax | Notes                                           |
| -------------------------- | --------- | ------ | ----------------------------------------------- |
| Filter by field value      | [UNKNOWN] | —      | No public query docs                            |
| Filter by date range       | [UNKNOWN] | —      | Likely a `modifiedSince`-style param [INFERRED] |
| Full-text search           | [UNKNOWN] | —      | No public search docs                           |
| Sort by field              | [UNKNOWN] | —      |                                                 |
| Sort direction             | [UNKNOWN] | —      |                                                 |
| Field selection            | [UNKNOWN] | —      |                                                 |
| Include related records    | [UNKNOWN] | —      |                                                 |
| Aggregation / count        | [UNKNOWN] | —      |                                                 |
| Logical operators (AND/OR) | [UNKNOWN] | —      |                                                 |
| Comparison operators       | [UNKNOWN] | —      |                                                 |
| Null checks                | [UNKNOWN] | —      |                                                 |

> The most useful read is **not a query at all** — it is `POST .../GetPrice`, which _computes_ a price
> from a posted product spec rather than filtering stored records. Prefer it for any pricing question.

---

## Common Patterns

### Pattern 1: Price a product (the primary read) [DOCUMENTED it exists / INFERRED shape]

> printIQ's hero capability. POST a product + spec + quantity, get a live price. This is a compute
> call, not a list/filter — there is nothing to paginate.

**Syntax (INFERRED):**

```http
POST /api/Quote/GetPrice
Authorization: Bearer {token}
Content-Type: application/json

{ "productCode": "BC-350GSM", "quantity": 500,
  "options": { "finish": "Matte Laminate", "sides": "Double Sided" } }
```

**Key points:**

- Requires a valid `productCode` AND its required option/spec selections — a bare code may fail or misprice. [INFERRED]
- Do not cache the result; printIQ is the pricing source of truth and prices change. [DOCUMENTED]
- Exact path (`/api/Quote/GetPrice` vs `/api/GetPrice`) and payload keys are `[INFERRED]` — confirm.

---

### Pattern 2: Get by reference (quote / job / customer / product) [INFERRED]

> Single-resource lookup by its human reference. Most reliable read pattern beyond GetPrice.

```http
GET /api/Quote/{quoteNo}
GET /api/Job/{jobNo}
GET /api/Customer/{customerCode}
GET /api/Product/{productCode}
Authorization: Bearer {token}
```

**Key points:**

- The path-parameter key is `[UNKNOWN]` (could be the human reference `Q-100234` or a GUID). Try the human ref first; if 404, try the GUID. [INFERRED]
- 404 here can mean either "wrong reference" OR "wrong instance host/base path" — verify both. [INFERRED]

---

### Pattern 3: List & filter [UNKNOWN — discovery required]

> Whether list endpoints exist, and how to filter them, is unverified.

```http
[INFERRED — UNVERIFIED]
GET /api/Quote?customerCode=CUST001&status=Quoted&page=1&pageSize=20
Authorization: Bearer {token}
```

**Filter operators:** `[UNKNOWN]`. Likely flat query-string equality filters (`field=value`) combined with AND. [INFERRED]
**Combining filters:** assumed AND; nested conditions assumed unsupported. [INFERRED]

---

### Pattern 4: Date-range / "modified since" query [UNKNOWN]

> Needed for polling (see `01d`). Whether a modified-since filter exists is unverified.

```http
[INFERRED — UNVERIFIED]
GET /api/Job?modifiedSince=2026-05-29T00:00:00Z
Authorization: Bearer {token}
```

**Date format:** ISO 8601 assumed (`2026-05-29T00:00:00Z`). [INFERRED]
**If no modified-since filter exists:** fall back to fetching by known reference and diffing `status`. [INFERRED]

---

### Pattern 5: Get related records [UNKNOWN]

> Whether sub-resource paths (e.g. a customer's quotes) or parent-filter params exist is unverified.

```http
[INFERRED — UNVERIFIED — try ONE, read what comes back]
GET /api/Customer/{customerCode}/Quotes          (sub-resource style)
GET /api/Quote?customerCode={customerCode}        (parent-filter style)
```

---

### Pattern 6: Aggregation / count [UNKNOWN]

No public count/aggregate capability. Do not assume a `/count` endpoint exists. [UNKNOWN]

---

## Pagination Handling

### Model

- **Type:** `[UNKNOWN]` — likely page-number or offset on list endpoints. [INFERRED]
- **Default page size:** `[UNKNOWN]`. Default conservatively to 20 in requests you construct.
- **Max page size:** `[UNKNOWN]`.
- **Total count available:** `[UNKNOWN]`.

### Request Parameters (INFERRED — UNVERIFIED)

| Parameter | Type    | Default     | Description                            |
| --------- | ------- | ----------- | -------------------------------------- |
| page      | integer | `[UNKNOWN]` | Page number (if page-number model)     |
| pageSize  | integer | `[UNKNOWN]` | Records per page                       |
| offset    | integer | `[UNKNOWN]` | Offset (if offset model — alternative) |

### Response Structure

```json
[INFERRED — UNVERIFIED — read the real envelope and adapt]
{
  "data": [ /* records */ ],
  "page": 1,
  "pageSize": 20,
  "total": 137
}
```

### Last Page Detection

`[UNKNOWN]` — likely an empty `data` array, or `page * pageSize >= total`, or an absent `next`. [INFERRED]
**On a live instance:** fetch page 1, inspect the envelope, and use whatever pagination signal it actually returns.

### Full Pagination Loop (INFERRED)

```
Request 1: GET /api/{resource}?page=1&pageSize=20
Response 1: { "data": [...20...], "page": 1, "total": 137 }

Request 2: GET /api/{resource}?page=2&pageSize=20
Response 2: { "data": [...20...], "page": 2, "total": 137 }

...

Last Page: GET /api/{resource}?page=7&pageSize=20
Response:  { "data": [...17...], "page": 7, "total": 137 }
           ← short/empty page (or page*size >= total) means done
```

---

## Worked Examples

> ⚠️ All examples are `[INFERRED]` reconstructions, not captured live calls.

### Example 1: Price 500 double-sided matte business cards [DOCUMENTED it exists / INFERRED shape]

```http
POST /api/Quote/GetPrice
Host: {instance}.printiq.com
Authorization: Bearer {token}
Content-Type: application/json

{ "productCode": "BC-350GSM", "quantity": 500,
  "options": { "finish": "Matte Laminate", "sides": "Double Sided" } }
```

```json
{ "price": 250.0, "currency": "NZD", "leadTimeDays": 3, "breakdown": [] }
```

**Key points:**

- This is the call to reach for whenever the user asks "how much for X?". [DOCUMENTED]
- Quantity breaks matter — printIQ pricing is usually quantity-tiered; re-call per quantity rather than extrapolating. [INFERRED]

---

### Example 2: Check the status of job J-100234 [INFERRED]

```http
GET /api/Job/J-100234
Host: {instance}.printiq.com
Authorization: Bearer {token}
```

```json
{ "jobNo": "J-100234", "status": "In Production", "dueDate": "2026-06-04", "shippedDate": null }
```

**Key points:**

- Use this (or its modified-since list variant) as the polling read for shipping status if no "shipped" webhook is provisioned. [INFERRED]
- `shippedDate: null` + `status: "In Production"` → not yet shipped. [INFERRED]

---

### Example 3: Look up customer CUST001 [INFERRED]

```http
GET /api/Customer/CUST001
Host: {instance}.printiq.com
Authorization: Bearer {token}
```

```json
{ "customerCode": "CUST001", "name": "Acme Signs Ltd", "accountStatus": "Active", "priceList": "Trade" }
```

**Key points:**

- `priceList` / pricing tier affects what `GetPrice` returns — note it when pricing for a specific customer. [INFERRED]

---

## Gotchas & Counter-Exceptions

1. **GetPrice is a POST compute call, not a query.** Don't try to "filter products for a price" — POST the spec. [DOCUMENTED]
2. **404 is ambiguous.** It can mean wrong reference OR wrong instance host/base path. Always re-check the host first. [INFERRED]
3. **No confirmed list/pagination contract.** Do not loop pages blindly — fetch page 1, read the envelope, then decide. [UNKNOWN]
4. **Reference key type is unknown.** A path param might want the human reference (`Q-100234`) or a GUID. Try human ref, fall back to GUID. [INFERRED]
5. **Pricing is per-customer/per-pricelist.** The same product can price differently by `priceList`; don't reuse one customer's price for another. [INFERRED]

---

_Generated from the investigation questionnaire, Phases 5-6 (web research only; no live call). All query/pagination detail is inferred — discover real syntax before relying on it._
