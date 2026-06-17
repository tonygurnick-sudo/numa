---
api_name: Cin7 Omni
api_slug: cin7-omni
base_url: https://api.cin7.com/api
route_prefix_injected_by_connector: none (pass the FULL relative path incl. the version segment)
path_version_segment: REQUIRED in path — /v1/ for all entities, /v2/ for BomMasters only (e.g. /v1/Products, /v2/BomMasters). "v1" is a real path segment, NOT a label.
auth: HTTP Basic base64(api-username:api-key) — injected by Numa; NEVER set Authorization yourself
field_casing: PascalCase in bodies (StyleCode, LineItems); where/fields/order params case-insensitive [UNVERIFIED]
id_format: integer
rate_limit: 3/sec, 60/min, 5000/day per API connection; 429 on exceed
call_surface: HTTP via `numa integrations request` (relative url + method [+ body]). NOT a file store; NOT MCP. Examples below use the connectors(request) form.
integration_path: native data connector, authType username-password
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
confidence: every fact live-API-confirmed 2026-05-22 unless tagged [SPEC] (from BETA OpenAPI 3.0 spec) or [UNVERIFIED] (inferred). NOT yet validated through the Numa connector path — trust live responses over this file if they conflict.
---

# Cin7 Omni — API Rules

## TWO products — confirm which first

Cin7 sells two separate products with two separate APIs. This connector is **Omni only**.

- **Omni** (this, slug `cin7-omni`) — `api.cin7.com`, Basic auth, integer IDs, app at `go.cin7.com`/`app.cin7.com`.
- **Core** (formerly DEAR Inventory, separate connector `cin7-core`) — `inventory.dearsystems.com`, custom-header auth, GUID IDs, HAS webhooks.
  If the user says "Cin7" unqualified → ask which product. Wrong product = wrong base URL, wrong auth, 404s.

## Paths (read first)

- Base `https://api.cin7.com/api`. Pass relative urls. **The `/v1/` (or `/v2/`) segment IS part of the path — always include it.** e.g. `/v1/Products`, `/v2/BomMasters`. There is NO connector-injected prefix.
- v1 for everything; v2 exists ONLY for BomMasters (v1 BomMasters also works).
- Field casing PascalCase in bodies. Dates UTC `yyyy-MM-ddTHH:mm:ssZ` (e.g. `2026-06-09T00:00:00Z`).

## Call

```
connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/Products?page=1&rows=50"})
```

- POST/PUT: pass JSON in `body`. **Bodies are ALWAYS arrays**, even for one record.
- Verbs: GET=read, POST=create (array), PUT=update (array), DELETE=Contacts + Payments only.
- **NEVER set `Authorization`.** Numa injects the user's vaulted Basic creds; you never see them.

## Auth & permissions

Basic auth, injected per request. Keys are static (no OAuth, no expiry); regenerating a key in Cin7 invalidates the old one immediately.

- **403 = the key lacks permission for THAT endpoint — NOT bad credentials.** Fix: Cin7 Omni → Settings → Integrations & API → API v1 → connection → permissions. Do not retry.
- **401 = bad/regenerated key.** User reconnects via the chat credential card. Do not retry.

## CAN

Read+write: Products, ProductOptions, ProductCategories, Contacts, SalesOrders, PurchaseOrders, Quotes, CreditNotes, Payments, Adjustments, Branches, BranchTransfers, ProductionJobs. Read-only: Stock, BomMasters (v1+v2), SalesOrdersWithCartons, SerialNumbers, SizeRanges, Users, Voucher, PaymentFeesAndPayouts (Fees/Payouts). DELETE: Contacts + Payments only. PUT cartons: `/v1/Cartons/{salesOrderId}`. Upload image: `POST /v1/ProductImages?productId={id}&imagePriority={n}` (multipart) [SPEC]. Filter lists with `where`, trim with `fields`, sort with `order`, page with `page`/`rows`.

## CANNOT

Webhooks (none — poll with `ModifiedDate`). DELETE anything but Contacts/Payments. OAuth (static key only). >250 rows/page or >250 records/batch. Filter on nested line-item fields (`where` = parent-level only). Trust Users for new accounts (≤2h propagation).

## Critical gotchas

1. **403 ≠ wrong credentials** — per-endpoint permission toggle is off. Fix in Cin7 Settings, not Numa.
2. **PUT: `null` (or omit) = leave unchanged, `""` = CLEAR the field.** Empty strings silently wipe data. Use `null` for "no change".
3. **POST/PUT bodies are ARRAYS.** Response = array of `{Index,Success,Id,Code,Errors[]}` per record. DELETE + ProductImages return a single object, not an array. [SPEC]
4. **No total count in list responses.** Page until the array is empty.
5. **`rows` max 250 (default 50); batch limit 250.** Over either → 400 plain-string. [SPEC]
6. **Encode `%` as `%25` in `where` LIKE** (e.g. `where=Name LIKE '%25Widget%25'`). Unencoded `%` corrupts the query.
7. **Duplicate `StyleCode`/`ProductOptionCode` on Products POST → ENTIRE batch rejected (400).** Pre-check first.
8. **5000/day budget is the binding constraint.** Never full-scan large entities; filter by `ModifiedDate` and cache.
9. **`IsVoid:true` on an order is IRREVERSIBLE** [SPEC]; **`loadboms=true` on SalesOrders/Quotes/PurchaseOrders POST/PUT expands BOMs and "cannot be undone"** [SPEC]. Confirm with the user first.
10. **Order `Status` (`Draft`/`Approved`/`Void`) is read-only** — drive workflow via `Stage`, `IsApproved`, `IsVoid`, `DispatchedDate`.
11. **Resolution pairs:** order→customer via `MemberId` OR `MemberEmail`; line→product via `ProductOptionId` OR `Code` (SKU). ID wins if both. [SPEC]
12. **Required on POST:** Products → `Name`+`ProductOptions`; Contacts → `Type` (`Customer`/`Supplier`). [SPEC]
13. **Order Stage values:** New, Awaiting Payment, Declined, Dispatched, Processing, On Hold (default New). [SPEC]

## Defaults (override only if the user specifies)

`rows=50` (max 250), `page=1` then 2,3… until empty, `order=ModifiedDate ASC` for syncs (default sort DESC; append ` ASC` to reverse), `where=ModifiedDate>='{watermark}'` for change detection, `fields=` only the columns you need (order DTOs are 70+ fields wide).

## Operations

| Operation              | Method              | Path                                         | Notes                                                                       |
| ---------------------- | ------------------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| List/get products      | GET                 | /v1/Products[/{id}]                          | fields, where, order, page, rows                                            |
| Create/update products | POST/PUT            | /v1/Products                                 | array; dup StyleCode/OptionCode → 400 whole batch                           |
| List variants          | GET                 | /v1/ProductOptions                           | SKU = `ProductOptionCode`; prices, stock                                    |
| List/get sales orders  | GET                 | /v1/SalesOrders[/{id}]                       |                                                                             |
| Create/update orders   | POST/PUT            | /v1/SalesOrders?loadboms={bool}              | loadboms expands BOMs — cannot be undone                                    |
| Orders + cartons       | GET                 | /v1/SalesOrdersWithCartons[/{id}]            | read-only                                                                   |
| Get/replace cartons    | GET/PUT             | /v1/Cartons/{salesOrderId}                   | PUT replaces whole carton list                                              |
| List/get quotes        | GET/POST/PUT        | /v1/Quotes[/{id}]                            | `loadboms` on POST/PUT                                                      |
| List/get POs           | GET/POST/PUT        | /v1/PurchaseOrders[/{id}]                    | `loadboms` on POST/PUT                                                      |
| Contacts               | GET/POST/PUT/DELETE | /v1/Contacts[/{id}]                          | POST needs `Type`; DELETE /{id}                                             |
| Payments               | GET/POST/PUT/DELETE | /v1/Payments[/{id}]                          | DELETE /{id}                                                                |
| Cin7 Pay fees/payouts  | GET                 | /v1/PaymentFeesAndPayouts/Fees, /Payouts     | read-only                                                                   |
| List/get credit notes  | GET/POST/PUT        | /v1/CreditNotes[/{id}]                       |                                                                             |
| Stock levels           | GET                 | /v1/Stock                                    | read-only; filter via where (BranchId, Code, Barcode); `?barcode=` shortcut |
| List/get adjustments   | GET/POST/PUT        | /v1/Adjustments[/{id}]                       | lines use `QtyAdjusted` (delta)                                             |
| List/get branches      | GET/POST/PUT        | /v1/Branches[/{id}]                          |                                                                             |
| Branch transfers       | GET/POST/PUT        | /v1/BranchTransfers[/{id}]                   |                                                                             |
| Production jobs        | GET/POST/PUT        | /v1/ProductionJobs[/{id}]                    |                                                                             |
| BOMs                   | GET                 | /v1/BomMasters[/{id}], /v2/BomMasters[/{id}] | read-only                                                                   |
| Product categories     | GET/POST/PUT        | /v1/ProductCategories[/{id}]                 |                                                                             |
| Upload product image   | POST                | /v1/ProductImages?productId&imagePriority    | multipart/form-data; body undocumented [SPEC]                               |
| Serial numbers         | GET                 | /v1/SerialNumbers[/{id}]                     | read-only                                                                   |
| Size ranges            | GET                 | /v1/SizeRanges[/{id}]                        | read-only                                                                   |
| Users                  | GET                 | /v1/Users[/{id}]                             | read-only; ~2h delay for new users                                          |
| Vouchers               | GET                 | /v1/Voucher?code={code}                      | read-only                                                                   |

(Full catalogue: 44 paths / 73 ops / 24 resource families [SPEC]. See 01a.)

## Pagination

Page-based: `page` (1-based) + `rows` (default 50, max 250). No total count — fetch until the array is empty. Always set `order` when paging (default sort DESC; append ` ASC`). Bounds errors are explicit 400 strings: `"The page number is out of range; the value must be greater than or equal to 1."`, `"The rows argument cannot be greater than 250."` [SPEC]

```
GET /v1/SalesOrders?order=ModifiedDate ASC&page=1&rows=50   (then page=2,3… stop on [])
```

## Errors

Bodies are **plain strings**, not JSON objects [SPEC]: 401 `"Unauthorized access"`, 403 `"Access is forbidden"`, 404 `"Resource not found"`, 429 `"Rate limit exceeded. Retry after some time."`, 400 e.g. `"Batch limit is 250."` / `"Missing or malformed JSON data; please see the documentation for examples."`, 500 `"An unexpected error occurred. Please try again later."`, 503 `"Service temporarily unavailable. Please try again later."`. Write failures also come back per-record inside a 200 envelope (`Success:false` + `Errors[]`).

| Status | Meaning                                   | Action                                                                              |
| ------ | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| 200    | OK (check per-record `Success` on writes) | process; surface any `Errors[]`                                                     |
| 400    | validation / paging / batch               | fix payload/params; don't retry unchanged; on batch write re-query first            |
| 401    | bad/regenerated key                       | reconnect via chat credential card; don't retry                                     |
| 403    | endpoint permission off                   | enable in Cin7 Settings → Integrations & API; don't retry                           |
| 404    | wrong id/path                             | verify id + `/v1/` (or `/v2/`) prefix                                               |
| 429    | rate limit (3/s, 60/m, 5000/day)          | back off 1s→5s→30s→2m, ≥350ms between calls; persistent = daily cap, stop           |
| 500    | server error                              | retry once after 5s; for writes check whether it landed first (no idempotency keys) |
| 503    | maintenance                               | wait 5–10 min, retry                                                                |

## Examples

1. Sales orders modified since a watermark:
   `connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/SalesOrders?where=ModifiedDate>='2026-06-09T00:00:00Z'&order=ModifiedDate ASC&page=1&rows=50"})`
   → JSON array of SalesOrder objects (`Id`,`Reference`,`Stage`,`Total`,`LineItems[]`,…); page=2 next; stop on empty. [SPEC]

2. Find a contact by name (note `%25`):
   `connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/Contacts?where=Company LIKE '%25Acme%25'&fields=Id,Company,FirstName,LastName,Email,Type&rows=20"})`

3. Create a sales order (body is an ARRAY):
   `connectors(name="request", params={"connector":"cin7-omni","method":"POST","url":"/v1/SalesOrders","body":[{"MemberId":12345,"Stage":"New","CurrencyCode":"NZD","LineItems":[{"Code":"WIDGET-RED-L","Qty":2,"UnitPrice":49.99}]}]})`
   → 200: `[{"Index":0,"Success":true,"Id":67890,"Code":"...","Errors":[]}]` — check `Success` per record. [SPEC]

4. Stock on hand for a branch:
   `connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/Stock?where=BranchId=1&fields=ProductName,Code,Available,StockOnHand,Incoming&rows=250"})`
