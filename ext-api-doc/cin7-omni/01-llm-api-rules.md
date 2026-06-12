---
api_name: 'Cin7 Omni'
api_slug: 'cin7-omni'
version: 'v1 (v2 BomMasters only)'
generated_from: '00-api-investigation (Cin7 Omni + Core, 2026-05-22) + live OpenAPI 3.0 spec'
generated_date: '2026-06-10'
update_source: 'API investigation 2026-05-22 (live endpoint tests) + OpenAPI spec at api.cin7.com/api/OpenApi/GetSpec'
line_count_target: '< 300 lines'
---

# Cin7 Omni -- Workspace Agent API Rules

> ⚠️ **Investigation-confirmed (live API tests 2026-05-22) but NOT yet validated through the Numa connector path.**
>
> **This file is loaded into the workspace agent's context when the Cin7 Omni integration is active.**
> It must stay under 300 lines. Companion files (01a–01d) contain the detailed reference material.
> Facts are tagged [CONFIRMED — API investigation 2026-05-22], [SPEC] (live OpenAPI 3.0 spec, marked BETA by Cin7), or [UNVERIFIED] (inferred).

## ⚠️ Two Cin7 Products — Confirm Which One First

Cin7 sells **two separate products with two separate APIs**. This connector is **Cin7 Omni only**.

- **Cin7 Omni** (this connector, slug `cin7-omni`) — `api.cin7.com`, Basic auth, integer IDs, used at `go.cin7.com`
- **Cin7 Core** (formerly DEAR Inventory, separate connector `cin7-core`) — `inventory.dearsystems.com`, custom-header auth, GUID IDs

If the customer says "Cin7" without qualification, **ask which product** before calling anything. Wrong product = wrong base URL, wrong auth, 404s everywhere.

## Context

- **API:** Cin7 Omni REST API — inventory management (products, stock, sales/purchase orders, contacts, payments, manufacturing) [CONFIRMED — API investigation 2026-05-22]
- **Base URL:** `https://api.cin7.com/api` — configured in Numa; use **relative URLs** like `/v1/Products`
- **Auth:** HTTP Basic (API username + API key) — **injected automatically by Numa. Never set it.**
- **Integration path:** Data Connector — call via the `connectors` MCP tool, `request` operation
- **Rate limits:** **3/sec, 60/min, 5,000/day** per API connection; 429 on exceed [CONFIRMED — API investigation 2026-05-22]
- **Field casing:** PascalCase (`StyleCode`, `ModifiedDate`, `LineItems`) [SPEC]
- **ID format:** Integer (e.g., `12345`) [SPEC]
- **Dates:** UTC, `yyyy-MM-ddTHH:mm:ssZ` (e.g., `2026-06-09T00:00:00Z`) [CONFIRMED — API investigation 2026-05-22]

## How to Call

```
connectors(name="request", params={
  "connector": "cin7-omni",
  "url": "/v1/Products?page=1&rows=50",
  "method": "GET"
})
```

- Relative `url` expands against `https://api.cin7.com/api`. Always prefix with `/v1/` (or `/v2/BomMasters`).
- POST/PUT: pass the JSON in `body`. **Bodies are always arrays**, even for one record [SPEC].
- **NEVER set `Authorization` headers.** Numa injects the user's vaulted credentials on every request; you never see them.
- Verbs: GET = read, POST = create (array), PUT = update (array), DELETE = only Contacts and Payments [SPEC].

## Auth Structure

Basic auth per request, injected by Numa — show requests WITHOUT auth headers.

- The API key has **per-endpoint Create/Read/Update permissions**, toggled individually in Cin7 Omni [CONFIRMED — API investigation 2026-05-22].
- **403** = the key lacks permission for *that specific endpoint* — NOT bad credentials. Tell the user (or their admin) to enable it in **Cin7 Omni → Settings → Integrations & API → API v1 → their connection → permissions**. Do not retry.
- **401** = bad or regenerated API key. The user should reconnect Cin7 Omni via the chat credential card. Do not retry.
- Keys are static (no OAuth, no expiry) but regenerating a key in Cin7 invalidates the old one immediately [CONFIRMED — API investigation 2026-05-22].

## Capabilities

### CAN

1. Read + write: Products, ProductOptions, ProductCategories, Contacts, SalesOrders, PurchaseOrders, Quotes, CreditNotes, Payments, Adjustments, Branches, BranchTransfers, ProductionJobs [SPEC]
2. Read-only: Stock, BomMasters (v1+v2), SalesOrdersWithCartons, SerialNumbers, SizeRanges, Users, Voucher, PaymentFeesAndPayouts (Fees/Payouts) [SPEC]
3. Filter any list with `where` (SQL-like), trim columns with `fields`, sort with `order`, page with `page`/`rows` [CONFIRMED — API investigation 2026-05-22]
4. Delete Contacts and Payments (the only two DELETE endpoints) [SPEC]
5. Upload product images: `POST /v1/ProductImages?productId={id}&imagePriority={n}` (multipart/form-data) [SPEC]
6. Update cartons for a sales order: `PUT /v1/Cartons/{salesOrderId}` [SPEC]

### CANNOT

1. Receive webhooks — Cin7 Omni has **no outbound webhook system**; poll with `modifieddate` filters [CONFIRMED — API investigation 2026-05-22]
2. Delete anything except Contacts and Payments [SPEC]
3. Use OAuth — static API key only [CONFIRMED — API investigation 2026-05-22]
4. Exceed 250 rows per page or 250 records per POST/PUT batch [SPEC]
5. Filter on nested line-item fields — `where` works on parent-level fields only [CONFIRMED — API investigation 2026-05-22]
6. Trust the Users endpoint for new users — up to 2 hours propagation delay [CONFIRMED — API investigation 2026-05-22]
7. Confirm exact runtime behaviour until tested through Numa — investigation hit the API live, but **not via this connector**

## Critical Gotchas

1. **403 ≠ wrong credentials.** It means the per-endpoint permission toggle is off for this API key. Fix is in Cin7 Omni Settings → Integrations & API, not in Numa. [CONFIRMED — API investigation 2026-05-22]
2. **PUT: `null` skips a field, `""` clears it.** Sending empty strings silently wipes data. Always use `null` (or omit) for "no change". [CONFIRMED — API investigation 2026-05-22]
3. **POST/PUT bodies are ARRAYS** — wrap single records in `[...]`. Response is an array of `{Index, Success, Id, Code, Errors[]}` per record. [SPEC]
4. **No total count in list responses.** Page until you get an empty array. [CONFIRMED — API investigation 2026-05-22]
5. **`rows` max is 250, default 50. Batch limit is 250.** Exceeding either returns 400 with a plain-string message. [SPEC]
6. **Encode `%` as `%25` in `where` LIKE patterns** (e.g. `where=Name LIKE '%25Widget%25'`). [CONFIRMED — API investigation 2026-05-22]
7. **Duplicate `StyleCode`/`ProductOptionCode` on Products POST → the ENTIRE batch is rejected (400).** Pre-check before inserting. [CONFIRMED — API investigation 2026-05-22]
8. **5,000/day budget is tight.** Never full-scan large entities; always filter by `ModifiedDate` and cache. [CONFIRMED — API investigation 2026-05-22]
9. **`IsVoid: true` on an order is irreversible** [SPEC]. **`loadboms=true` on SalesOrders/Quotes POST/PUT expands BOMs and "cannot be undone"** [SPEC]. Confirm with the user first.
10. **Order `Status` is read-only** (`Draft`/`Approved`/`Void`); drive workflow via `Stage`, `IsApproved`, `IsVoid`, `DispatchedDate`. [SPEC]
11. **Resolution pairs:** orders link a customer via `MemberId` OR `MemberEmail`; line items link a product via `ProductOptionId` OR `Code` (SKU). ID wins if both. [SPEC]
12. **Products POST requires `Name` + `ProductOptions`; Contacts POST requires `Type`** (`Customer`/`Supplier`). [SPEC]
13. **Stage values for orders:** New, Awaiting Payment, Declined, Dispatched, Processing, On Hold (default: New). [SPEC]

## Default Parameters

Use these defaults unless the user specifies otherwise:

| Parameter | Default                              | Reason                                          |
| --------- | ------------------------------------ | ----------------------------------------------- |
| rows      | 50                                   | API default; max 250 [SPEC]                     |
| page      | 1 (then 2, 3… until empty)           | 1-based paging, no total count                  |
| order     | `ModifiedDate ASC` for sync; default sort is DESC | Stable watermark-based paging      |
| where     | `ModifiedDate>='{watermark}'` for change detection | Protects the 5,000/day budget    |
| fields    | only the columns you need            | Full order DTOs are very wide                   |

## Working Examples

### Example 1: Sales orders modified in the last 24 hours

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/SalesOrders?where=ModifiedDate>='2026-06-09T00:00:00Z'&order=ModifiedDate ASC&page=1&rows=50"})
```

Response: JSON array of SalesOrder objects (`Id`, `Reference`, `Stage`, `Total`, `LineItems[]`, …). Next page: `page=2`; stop on empty array. [SPEC]

### Example 2: Find a contact by name (note `%25`)

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/Contacts?where=Company LIKE '%25Acme%25'&fields=Id,Company,FirstName,LastName,Email,Type&rows=20"})
```

### Example 3: Create a sales order (body is an ARRAY)

```
connectors(name="request", params={"connector": "cin7-omni", "method": "POST",
  "url": "/v1/SalesOrders",
  "body": [{
    "MemberId": 12345,
    "Stage": "New",
    "CurrencyCode": "NZD",
    "LineItems": [{"Code": "WIDGET-RED-L", "Qty": 2, "UnitPrice": 49.99}]
  }]})
```

Response `200`: `[{"Index": 0, "Success": true, "Id": 67890, "Code": "...", "Errors": []}]` — check `Success` per record. [SPEC]

### Example 4: Stock on hand for a branch

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/Stock?where=BranchId=1&fields=ProductName,Code,Available,StockOnHand,Incoming&rows=250"})
```

## Proxy API Operations

All confirmed from the live OpenAPI spec (44 paths) [SPEC]; query params per HTML docs [CONFIRMED — API investigation 2026-05-22].

| Operation              | Method | Path                                  | Notes                                            |
| ---------------------- | ------ | ------------------------------------- | ------------------------------------------------ |
| List products          | GET    | /v1/Products                          | fields, where, order, page, rows                 |
| Get product            | GET    | /v1/Products/{id}                     |                                                  |
| Create/update products | POST/PUT | /v1/Products                        | Array body; dup StyleCode → 400 whole batch      |
| List product variants  | GET    | /v1/ProductOptions                    | SKU (`ProductOptionCode`), prices, stock fields  |
| List/get sales orders  | GET    | /v1/SalesOrders[/{id}]                |                                                  |
| Create/update orders   | POST/PUT | /v1/SalesOrders?loadboms={bool}     | loadboms expands BOMs — cannot be undone         |
| Orders + cartons       | GET    | /v1/SalesOrdersWithCartons[/{id}]     | Read-only                                        |
| Update cartons         | GET/PUT | /v1/Cartons/{salesOrderId}           | PUT replaces carton list                         |
| List/get quotes        | GET    | /v1/Quotes[/{id}]                     | POST/PUT also available (`loadboms`)             |
| List/get POs           | GET    | /v1/PurchaseOrders[/{id}]             | POST/PUT also available (`loadboms`)             |
| List/get contacts      | GET    | /v1/Contacts[/{id}]                   | POST (Type required) / PUT / DELETE /{id}        |
| List/get payments      | GET    | /v1/Payments[/{id}]                   | POST / PUT / DELETE /{id}                        |
| Cin7 Pay fees/payouts  | GET    | /v1/PaymentFeesAndPayouts/Fees, /Payouts | Read-only                                     |
| List/get credit notes  | GET    | /v1/CreditNotes[/{id}]                | POST/PUT also available                          |
| Stock levels           | GET    | /v1/Stock                             | Read-only; filter via where (BranchId, Code, Barcode…) |
| List/get adjustments   | GET    | /v1/Adjustments[/{id}]                | POST/PUT also available                          |
| List/get branches      | GET    | /v1/Branches[/{id}]                   | POST/PUT also available                          |
| Branch transfers       | GET    | /v1/BranchTransfers[/{id}]            | POST/PUT also available                          |
| Production jobs        | GET    | /v1/ProductionJobs[/{id}]             | POST/PUT also available                          |
| BOMs                   | GET    | /v1/BomMasters[/{id}], /v2/BomMasters[/{id}] | Read-only                                 |
| Product categories     | GET    | /v1/ProductCategories[/{id}]          | POST/PUT also available                          |
| Upload product image   | POST   | /v1/ProductImages?productId&imagePriority | multipart/form-data; body undocumented       |
| Serial numbers         | GET    | /v1/SerialNumbers[/{id}]              | Read-only                                        |
| Size ranges            | GET    | /v1/SizeRanges[/{id}]                 | Read-only                                        |
| Users                  | GET    | /v1/Users[/{id}]                      | Read-only; ~2h delay for new users               |
| Vouchers               | GET    | /v1/Voucher?code={code}               | Read-only                                        |

## Pagination

- **Type:** page-based — `page` (1-based) + `rows` (default 50, max 250) [SPEC]
- **No total count** — fetch until the response array is empty [CONFIRMED — API investigation 2026-05-22]
- Always set `order` when paging (default sort is DESC; append ` ASC` to reverse) [CONFIRMED — API investigation 2026-05-22]

```
GET /v1/SalesOrders?order=ModifiedDate ASC&page=1&rows=50   (page 1)
GET /v1/SalesOrders?order=ModifiedDate ASC&page=2&rows=50   (page 2 … stop on empty)
```

## Error Handling

Error bodies are **plain strings**, not JSON objects, per the spec (e.g. `"Unauthorized access"`, `"Access is forbidden"`, `"Rate limit exceeded. Retry after some time."`) [SPEC]. Mutation-level failures come back inside the 200 envelope per record (`Success: false` + `Errors[]`) [SPEC].

| Status | Meaning                          | Action                                                                |
| ------ | -------------------------------- | --------------------------------------------------------------------- |
| 200    | OK (check per-record `Success` on writes) | Process; surface any `Errors[]` entries                      |
| 400    | Validation / paging error        | Fix payload or params; do NOT retry unchanged                          |
| 401    | Bad or regenerated API key       | Reconnect Cin7 Omni via the chat credential card; do not retry         |
| 403    | Endpoint permission not enabled  | Enable in Cin7 Omni Settings → Integrations & API; do not retry        |
| 404    | Wrong ID or path                 | Verify entity ID and `/v1/` prefix                                     |
| 429    | Rate limit (3/sec, 60/min, 5,000/day) | Back off (1s → 5s → 30s), respect ~350ms between calls           |
| 500    | Server error                     | Retry once with backoff; report if persistent                          |
| 503    | Scheduled maintenance            | Wait 5–10 min, retry                                                   |

## Known Limitations

1. **Not yet validated through the Numa connector path** — investigation tested the API live (2026-05-22) but not via `connectors`; treat exact response shapes as unconfirmed until first customer use
2. No webhooks — polling with `ModifiedDate` watermarks is the only change-detection pattern [CONFIRMED — API investigation 2026-05-22]
3. 5,000 requests/day cap makes full historical syncs of large catalogs a multi-day exercise [CONFIRMED — API investigation 2026-05-22]
4. OpenAPI spec is BETA — field definitions may drift from runtime behaviour [CONFIRMED — API investigation 2026-05-22]
5. ProductImages POST body format is undocumented (multipart/form-data per spec, fields unknown) [SPEC]
6. No sandbox/trial environment confirmed; no official SDK or Postman collection exists [CONFIRMED — API investigation 2026-05-22]

---

_Generated 2026-06-10 from the 2026-05-22 API investigation + live OpenAPI spec. See companion files:_

- _01a-domain-model-reference.md — Entity catalog, relationships, state machines_
- _01b-query-patterns.md — Filtering, search, pagination examples_
- _01c-mutation-patterns.md — Create, update, delete patterns_
- _01d-event-and-error-handling.md — Polling, error recovery_
