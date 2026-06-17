---
api_name: Cin7 Omni
api_slug: cin7-omni
base_url: https://api.cin7.com/api
path_version_segment: /v1/ all entities (no mutations on /v2/) — part of the path
field_casing: PascalCase in request bodies
call_surface: HTTP via `numa integrations request` (connectors(request) form below); relative urls, NO auth headers (Numa injects Basic)
doc_role: on-demand reference — create, update, delete, batch semantics
confidence: every fact live-API-confirmed 2026-05-22 unless tagged [SPEC] or [UNVERIFIED]. NOT yet validated through the Numa connector path.
---

# Cin7 Omni — Mutation Patterns

## Write capabilities

| Operation          | Method   | Notes                                                                                  |
| ------------------ | -------- | -------------------------------------------------------------------------------------- |
| Create             | POST     | body **always an array**, even for one record                                          |
| Update             | PUT      | array with `Id` per record; **no PATCH** — `null`=skip, `""`=clear                     |
| Delete             | DELETE   | **Contacts + Payments only** (`/{id}` path); one record per call (no bulk)             |
| Bulk create/update | POST/PUT | up to **250 records/batch**; 251+ → 400 `"Batch limit is 250."` [SPEC]                 |
| State transitions  | PUT      | via `IsApproved`,`IsVoid`,`Stage`,`DispatchedDate` — no dedicated transition endpoints |
| File upload        | POST     | `/v1/ProductImages` only — multipart; see Upload caveat                                |

Writable entities: Products, ProductOptions, ProductCategories, Contacts, SalesOrders, PurchaseOrders, Quotes, CreditNotes, Payments, Adjustments, Branches, BranchTransfers, ProductionJobs, Cartons (PUT only), ProductImages (POST only). Everything else (Stock, BomMasters, SerialNumbers, SizeRanges, Users, Voucher, SalesOrdersWithCartons, PaymentFeesAndPayouts) is read-only.

## General write rules

1. **POST/PUT bodies are arrays** — wrap single records in `[...]`. A bare object → 400 `"Missing or malformed JSON data; please see the documentation for examples."` [SPEC]
2. **Max 250 records/batch** → over → 400 `"Batch limit is 250."` [SPEC]
3. **PUT: `null` (or omit the key) skips a field, `""` CLEARS it.** Empty strings silently wipe data — use `null` for "no change". The single most dangerous Omni write semantic.
4. **Check per-record results.** HTTP 200 does NOT mean every record succeeded — inspect `Success`/`Errors[]` per element (see Batch Envelope).
5. **403 = key lacks Create/Update permission for that endpoint** (toggled per endpoint in Cin7 → Settings → Integrations & API → API v1). Not bad credentials; do not retry.
6. **Writes are not idempotent** — no idempotency keys; re-POSTing duplicates (except Products dup `StyleCode`). Read-before-retry [UNVERIFIED — no mechanism documented].
7. **Field casing PascalCase** in bodies (`MemberId`,`LineItems`,`UnitPrice`). Prefer spec PascalCase over the older HTML docs' camelCase.
8. **Each batch call = one request** against 3/sec, 60/min, 5000/day — batch 250/call to be rate-efficient.

## Batch result envelope

POST/PUT return **HTTP 200 + an array of per-record results, positionally matched to your input** [SPEC]:

```json
[
  { "Index": 0, "Success": true, "Id": 67890, "Code": "SALE4-28", "Errors": [] },
  { "Index": 1, "Success": false, "Id": 0, "Code": "", "Errors": ["<reason>"] }
]
```

- `Index` — position in your request array · `Success` — inserted/updated? · `Id` — new/existing record Id (capture after creates) · `Code` — human-facing code (e.g. order `Reference`) · `Errors` — error **strings** when `Success` false.
- Spec schema names these PascalCase but its own examples show lowercase (`index`,`success`,`id`,`code`,`errors`) — match **case-insensitively** [SPEC, internally inconsistent].
- **Partial success is per record**: one bad record needn't fail batch-mates — EXCEPT Products, where a duplicate `StyleCode`/`ProductOptionCode` anywhere rejects the ENTIRE request with 400. Whether a 400 leaves some records created is [UNVERIFIED] — re-query before re-submitting after any 400.
- **DELETE and ProductImages POST return a single envelope object, not an array** [SPEC].

## Create patterns

### 1 — Contact (`Type` is the only required field; `Email` unique)

`connectors(name="request", params={"connector":"cin7-omni","method":"POST","url":"/v1/Contacts","body":[{"Type":"Customer","Company":"Acme Ltd","FirstName":"Jane","LastName":"Smith","Email":"jane.smith@acme.co.nz","Phone":"+64 9 555 1234","IsActive":true}]})`
→ `[{"Index":0,"Success":true,"Id":12345,...}]` — store `Id`; needed for orders (`MemberId`) and updates.

### 2 — Sales order (no fields spec-required, but practically need a customer link + lines)

- Customer: `MemberId` OR `MemberEmail` (Id wins if both). Product per line: `ProductOptionId` OR `Code` (SKU; Id wins). `Reference` blank → auto-generated (unique if supplied, max 30). `BranchId` omitted → Main Branch; `CurrencyCode`/`CurrencyRate`/`TaxStatus` omitted → account defaults. [SPEC]
- New orders default `IsApproved:true` → `Status:Approved`; pass `"IsApproved":false` for a Draft. `Status` is read-only — never send it.
  `connectors(name="request", params={"connector":"cin7-omni","method":"POST","url":"/v1/SalesOrders","body":[{"MemberId":12345,"Stage":"New","CurrencyCode":"NZD","DeliveryInstructions":"Leave at reception","LineItems":[{"Code":"WIDGET-RED-L","Qty":2,"UnitPrice":49.99},{"ProductOptionId":9876,"Qty":1,"UnitPrice":120.00}]}]})`
- `?loadboms=true` (SalesOrders/Quotes/PurchaseOrders POST+PUT) expands BOMs and **"cannot be undone"** [SPEC]. Never set without explicit user confirmation.

### 3 — Products (the strict one; required: `Name` + `ProductOptions`)

`connectors(name="request", params={"connector":"cin7-omni","method":"POST","url":"/v1/Products","body":[{"Name":"Widget Red Large","StyleCode":"WIDGET-RED-L","Brand":"AcmeWidgets","ProductOptions":[{"ProductOptionCode":"WIDGET-RED-L-01","RetailPrice":49.99,"Cost":18.50}]}]})`
**Duplicate `StyleCode`/`ProductOptionCode` anywhere in the batch → ENTIRE request 400.** If the code already exists in Cin7, that record is skipped not created [SPEC]. **Pre-check first:**
`connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/Products?where=StyleCode='WIDGET-RED-L'&fields=Id,StyleCode,Name"})`

### 4 — Payment against an order (`OrderType` enum has 19 values — see 01a) [SPEC fields; combination UNVERIFIED]

`connectors(name="request", params={"connector":"cin7-omni","method":"POST","url":"/v1/Payments","body":[{"OrderId":67890,"OrderType":"SalesOrder","PaymentDate":"2026-06-10T00:00:00Z","Amount":219.98,"Method":"EFT","TransactionRef":"BANK-REF-1234"}]})`

### 5 — Stock adjustment (lines use `QtyAdjusted` delta, not `Qty`; changes stock-on-hand — confirm with user)

`connectors(name="request", params={"connector":"cin7-omni","method":"POST","url":"/v1/Adjustments","body":[{"Reference":"STOCKTAKE-2026-06","BranchId":1,"AdjustmentReason":"Stocktake variance","LineItems":[{"Code":"WIDGET-RED-L","QtyAdjusted":-2,"UnitCost":18.50}]}]})`

## Update patterns

### 6 — Contact (null vs empty string); PUT body is an array, include `Id`

`connectors(name="request", params={"connector":"cin7-omni","method":"PUT","url":"/v1/Contacts","body":[{"Id":12345,"Email":"new.email@acme.co.nz","Phone":null,"Fax":""}]})`

- `"Phone":null` → unchanged · `"Fax":""` → cleared · omitting a key = `null` (no change).

### 7 — Order workflow transitions (via PUT field changes, not endpoints — no `/approve`,`/dispatch`,`/void`)

```
Approve draft:    body:[{"Id":67890,"IsApproved":true}]
Advance stage:    body:[{"Id":67890,"Stage":"Processing"}]
Mark dispatched:  body:[{"Id":67890,"Stage":"Dispatched","DispatchedDate":"2026-06-10T02:30:00Z","TrackingCode":"NZP123456789"}]   # DispatchedDate populates QtyShipped on lines
Void (IRREVERSIBLE, confirm first): body:[{"Id":67890,"IsVoid":true}]
```

(all PUT `/v1/SalesOrders`.) `Status` (`Draft`/`Approved`/`Void`) is read-only — reflects `IsApproved`/`IsVoid`. `Stage` ∈ `New`,`Awaiting Payment`,`Declined`,`Dispatched`,`Processing`,`On Hold`; allowed transition order is account-configured [UNVERIFIED]. `BranchId` not updatable once a SO is dispatched / PO received.

### 8 — Update order line items

Send the line with its `Id` inside the parent's `LineItems` array. Whether omitted lines are preserved or the array is replaced wholesale is [UNVERIFIED] — **safest: GET the order first, modify `LineItems` in place, PUT the full array back (each existing line keeps its Id).**
`connectors(name="request", params={"connector":"cin7-omni","method":"GET","url":"/v1/SalesOrders/67890"})`
`connectors(name="request", params={"connector":"cin7-omni","method":"PUT","url":"/v1/SalesOrders","body":[{"Id":67890,"LineItems":[/* full modified array */]}]})`

### 9 — Replace cartons (the one PUT that addresses a record in the URL; replaces the WHOLE carton list)

`SSCC` and `CartonItems` are required per carton [SPEC]. Include every carton you want to keep — anything missing is gone.
`connectors(name="request", params={"connector":"cin7-omni","method":"PUT","url":"/v1/Cartons/67890","body":[{"Number":1,"SSCC":"000123456700000018","Weight":4.2,"TrackingNumber":"NZP123456789","CartonItems":[{"Code":"WIDGET-RED-L","Qty":2}]}]})`

## Delete patterns

Only **Contacts** and **Payments** support DELETE. Both permanent — no trash, no undo [UNVERIFIED — no restore endpoint]. Confirm + quote the record back before deleting.
`connectors(name="request", params={"connector":"cin7-omni","method":"DELETE","url":"/v1/Contacts/12345"})`
`connectors(name="request", params={"connector":"cin7-omni","method":"DELETE","url":"/v1/Payments/98765"})` (affects financial records — be careful)
Response is a **single** object: `{"Success":true,"Id":12345,"Code":"...","Errors":[]}` [SPEC].

**For everything else, "delete" = deactivate via PUT:**
| Entity | Soft-delete field |
| --- | --- |
| Contacts | `IsActive:false` (if not using hard DELETE) |
| Products | `Status:"Inactive"` |
| ProductOptions | `Status:"Disabled"` |
| Orders/Quotes/CreditNotes | `IsVoid:true` — **irreversible** |

## Upload: Product Images

`POST /v1/ProductImages?productId={id}&imagePriority={n}` — both query params required; body is `multipart/form-data` with a single binary `file` field; response a single envelope [SPEC].
**Caveat:** the Numa `connectors` request tool sends JSON bodies — multipart upload through the connector is **not validated and likely unsupported** [UNVERIFIED]. Treat ProductImages as out of reach until tested; suggest the user upload images via the Cin7 UI.

## Dangerous operations

| Operation                                | Risk                                                    | Mitigation                                                                  |
| ---------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| PUT with `""` values                     | silently clears data                                    | use `null`/omit for "no change"; `""` only to intentionally clear           |
| `IsVoid:true` on any order               | **irreversible** void [SPEC]                            | explicit user confirmation; restate Reference + Total first                 |
| `?loadboms=true` on order/quote POST/PUT | BOM expansion "cannot be undone" [SPEC]                 | never set unless the user asks by name                                      |
| POST /v1/Products with dup codes         | whole batch rejected 400                                | pre-check `StyleCode`/`ProductOptionCode` with a `where` query              |
| DELETE Contacts/Payments                 | permanent; may orphan linked orders / financial records | confirm Id + show the record first                                          |
| POST /v1/Adjustments                     | changes stock-on-hand                                   | confirm branch, SKUs, qty deltas                                            |
| PUT /v1/Cartons/{id}                     | replaces the entire carton list                         | GET current cartons first; send the full desired list                       |
| Retrying a timed-out POST                | duplicate records (no idempotency keys) [UNVERIFIED]    | query for the would-be record (Reference/Email/StyleCode) before re-posting |

## Safe mutation workflow

1. **Read before write** — for updates, build the PUT from the GET payload.
2. **Confirm destructive intent** — void, delete, adjustments, `loadboms`: restate what changes, get a yes.
3. **Batch sensibly** — ≤250 records; for Products, de-dupe codes inside the batch AND against existing data.
4. **Send** — array body, PascalCase, `null` for untouched fields.
5. **Check every envelope entry** — `Success:false` → surface that record's `Errors[]`; never claim success on HTTP 200 alone.
6. **Capture returned `Id`s** for follow-up writes/verification.
7. **Verify if it matters** — GET back after high-stakes writes (spec is BETA; runtime drift possible).
8. **On 400, re-query before retrying** — partial-creation behaviour is [UNVERIFIED].
