---
api_name: 'Cin7 Omni'
api_slug: 'cin7-omni'
generated_from: '00-api-investigation (2026-05-22) + live OpenAPI 3.0 spec'
generated_date: '2026-06-10'
source_phases: ['Phase 5: Mutation Patterns']
---

# Cin7 Omni -- Mutation Patterns Reference

> ⚠️ Investigation-confirmed (live API tests 2026-05-22) but NOT yet validated through the Numa connector path.
> All examples use the Numa `connectors` tool form — relative URLs, **no auth headers** (Numa injects Basic auth automatically).
> Field shapes are from the live OpenAPI 3.0 spec (marked BETA by Cin7) — tagged [SPEC]. Behavioural claims verified against the HTML docs 2026-05-22 — tagged [CONFIRMED — API investigation 2026-05-22].

## Write Capabilities Summary

| Operation         | Supported | Method | Notes                                                                                      |
| ----------------- | --------- | ------ | ------------------------------------------------------------------------------------------ |
| Create            | Yes       | POST   | Body is **always an array**, even for one record [SPEC]                                    |
| Update            | Yes       | PUT    | Array body with `Id` per record; **no PATCH** — `null` = skip, `""` = clear                |
| Delete            | Limited   | DELETE | **Contacts and Payments only** (`/{id}` path) [SPEC]                                       |
| Bulk create       | Yes       | POST   | Up to **250 records per batch**; 251+ → 400 `"Batch limit is 250."` [SPEC]                 |
| Bulk update       | Yes       | PUT    | Same 250-record batch limit [SPEC]                                                         |
| Bulk delete       | No        | --     | DELETE is one record per call (`/{id}`)                                                    |
| State transitions | Via PUT   | PUT    | `IsApproved`, `IsVoid`, `Stage`, `DispatchedDate` — no dedicated transition endpoints      |
| File upload       | Yes*      | POST   | `/v1/ProductImages` only — multipart/form-data; see Upload Pattern caveats below           |

Writable entities [SPEC]: Products, ProductOptions, ProductCategories, Contacts, SalesOrders, PurchaseOrders, Quotes, CreditNotes, Payments, Adjustments, Branches, BranchTransfers, ProductionJobs, Cartons (PUT only), ProductImages (POST only). Everything else (Stock, BomMasters, SerialNumbers, SizeRanges, Users, Voucher, SalesOrdersWithCartons, PaymentFeesAndPayouts) is **read-only**.

## General Rules (apply to every write)

1. **POST creates a LIST, PUT updates a LIST** — wrap single records in `[...]`. A bare object is malformed JSON to this API → 400 `"Missing or malformed JSON data; please see the documentation for examples."` [SPEC]
2. **Max 250 records per batch.** Exceeding it returns 400 with the plain string `"Batch limit is 250."` [SPEC]
3. **`null` skips a field, `""` clears it** on PUT. Sending empty strings silently wipes data — always use `null` (or omit the key) for "no change". [CONFIRMED — API investigation 2026-05-22]
4. **Check per-record results.** HTTP 200 does NOT mean every record succeeded — inspect `Success` and `Errors[]` for each element of the response array (see Batch Semantics). [SPEC]
5. **403 = the API key lacks Create/Update permission for that endpoint** (toggled per endpoint in Cin7 Omni → Settings → Integrations & API → API v1). Not bad credentials; do not retry. [CONFIRMED — API investigation 2026-05-22]
6. **Writes are not idempotent.** There are no idempotency keys; re-POSTing the same payload creates duplicates (except Products, where a duplicate `StyleCode` rejects the batch). Read-before-retry. [UNVERIFIED — no idempotency mechanism documented]
7. **Field casing is PascalCase** in request bodies (`MemberId`, `LineItems`, `UnitPrice`) [SPEC]. The older HTML docs show camelCase in some examples; prefer the spec's PascalCase.
8. **Each batch call costs one request** against 3/sec, 60/min, 5,000/day — batching 250 records per call is the rate-limit-efficient way to write.

## Batch Result Envelope

POST and PUT return **HTTP 200 with an array of per-record results, positionally matched to your input array** [SPEC]:

```json
[
  { "Index": 0, "Success": true,  "Id": 67890, "Code": "SALE4-28", "Errors": [] },
  { "Index": 1, "Success": false, "Id": 0,     "Code": "",         "Errors": ["<reason>"] }
]
```

- `Index` — position of the record in your request array [SPEC]
- `Success` — true if that record was inserted/updated [SPEC]
- `Id` — the (new or existing) record Id — capture this after creates [SPEC]
- `Code` — the record's human-facing code (e.g. order `Reference`) [SPEC]
- `Errors` — list of error **strings** for that record when `Success` is false [SPEC]

**Gotchas:**

- The spec's schema names these keys PascalCase but its own response examples show lowercase (`index`, `success`, `id`, `code`, `errors`) — treat the envelope keys **case-insensitively** [SPEC, internally inconsistent].
- **Partial success is per record**: one bad record does not necessarily fail its batch-mates — except Products, where a duplicate `StyleCode`/`ProductOptionCode` anywhere in the batch rejects the ENTIRE request with 400 [CONFIRMED — API investigation 2026-05-22]. Whether a 400 can leave some records created is [UNVERIFIED] — re-query before re-submitting after any 400.
- DELETE (and ProductImages POST) return a **single envelope object**, not an array [SPEC].

## Create Patterns

### Pattern 1: Create a contact

`Type` is the only required field (`Customer` or `Supplier`) [SPEC]. `Email` must be unique [SPEC].

```
connectors(name="request", params={"connector": "cin7-omni", "method": "POST",
  "url": "/v1/Contacts",
  "body": [{
    "Type": "Customer",
    "Company": "Acme Ltd",
    "FirstName": "Jane",
    "LastName": "Smith",
    "Email": "jane.smith@acme.co.nz",
    "Phone": "+64 9 555 1234",
    "IsActive": true
  }]})
```

Response: `[{"Index": 0, "Success": true, "Id": 12345, ...}]` — store the `Id`; you need it for orders (`MemberId`) and updates.

### Pattern 2: Create a sales order

No fields are spec-required, but practically you need a customer link and line items [SPEC]:

- Customer: `MemberId` **or** `MemberEmail` (Id wins if both) [SPEC]
- Product per line: `ProductOptionId` **or** `Code` (the SKU; Id wins if both) [SPEC]
- `Reference` left blank → auto-generated (must be unique if supplied, max 30 chars) [SPEC]
- `BranchId` omitted → defaults to Main Branch [SPEC]; `CurrencyCode`/`CurrencyRate`/`TaxStatus` omitted → account defaults [SPEC]

```
connectors(name="request", params={"connector": "cin7-omni", "method": "POST",
  "url": "/v1/SalesOrders",
  "body": [{
    "MemberId": 12345,
    "Stage": "New",
    "CurrencyCode": "NZD",
    "DeliveryInstructions": "Leave at reception",
    "LineItems": [
      {"Code": "WIDGET-RED-L", "Qty": 2, "UnitPrice": 49.99},
      {"ProductOptionId": 9876, "Qty": 1, "UnitPrice": 120.00}
    ]
  }]})
```

- `?loadboms=true` is available on SalesOrders/Quotes/PurchaseOrders POST and PUT — it expands BOMs and **"cannot be undone"** [SPEC]. Never set it without explicit user confirmation.
- New orders default to `IsApproved: true` → `Status: Approved`. Pass `"IsApproved": false` to create a Draft [SPEC].
- `Status` itself is read-only — never send it [SPEC].

### Pattern 3: Create products (the strict one)

Required: `Name` + `ProductOptions` (at least one variant) [SPEC].

```
connectors(name="request", params={"connector": "cin7-omni", "method": "POST",
  "url": "/v1/Products",
  "body": [{
    "Name": "Widget Red Large",
    "StyleCode": "WIDGET-RED-L",
    "Brand": "AcmeWidgets",
    "ProductOptions": [
      {"ProductOptionCode": "WIDGET-RED-L-01", "RetailPrice": 49.99, "Cost": 18.50}
    ]
  }]})
```

**Duplicate `StyleCode` or `ProductOptionCode` anywhere in the batch → the ENTIRE request is rejected with 400.** If a product with the same code already exists in Cin7, that record is skipped, not created [SPEC, endpoint summary]. **Pre-check before inserting** [CONFIRMED — API investigation 2026-05-22]:

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/Products?where=StyleCode='WIDGET-RED-L'&fields=Id,StyleCode,Name"})
```

### Pattern 4: Create a payment against an order

No spec-required fields, but a useful payment links to its order [SPEC fields; combination UNVERIFIED]:

```
connectors(name="request", params={"connector": "cin7-omni", "method": "POST",
  "url": "/v1/Payments",
  "body": [{
    "OrderId": 67890,
    "OrderType": "SalesOrder",
    "PaymentDate": "2026-06-10T00:00:00Z",
    "Amount": 219.98,
    "Method": "EFT",
    "TransactionRef": "BANK-REF-1234"
  }]})
```

`OrderType` enum has 19 values (`SalesOrder`, `PurchaseOrder`, `Quote`, `CreditNote`, `Layby`, …) — see 01a [SPEC].

### Pattern 5: Create a stock adjustment

```
connectors(name="request", params={"connector": "cin7-omni", "method": "POST",
  "url": "/v1/Adjustments",
  "body": [{
    "Reference": "STOCKTAKE-2026-06",
    "BranchId": 1,
    "AdjustmentReason": "Stocktake variance",
    "LineItems": [{"Code": "WIDGET-RED-L", "QtyAdjusted": -2, "UnitCost": 18.50}]
  }]})
```

Adjustment lines use `QtyAdjusted` (delta), not `Qty` [SPEC]. Adjustments change stock-on-hand — confirm with the user before posting.

## Update Patterns

### Pattern 6: Update a contact (null vs empty string)

PUT body is an array; include `Id` to address each record [SPEC].

```
connectors(name="request", params={"connector": "cin7-omni", "method": "PUT",
  "url": "/v1/Contacts",
  "body": [{
    "Id": 12345,
    "Email": "new.email@acme.co.nz",
    "Phone": null,
    "Fax": ""
  }]})
```

- `"Phone": null` → phone **unchanged**
- `"Fax": ""` → fax **cleared**
- Omitting a key behaves like `null` (no change) [CONFIRMED — API investigation 2026-05-22]

This is the single most dangerous Omni write semantic: a "helpful" client that serializes missing fields as `""` will silently wipe data.

### Pattern 7: Order workflow transitions (via PUT, not endpoints)

There are no `/approve`, `/dispatch`, `/void` endpoints — order state is driven by fields on PUT [SPEC]:

```
# Approve a draft order
connectors(name="request", params={"connector": "cin7-omni", "method": "PUT",
  "url": "/v1/SalesOrders",
  "body": [{"Id": 67890, "IsApproved": true}]})

# Move through fulfilment stages
connectors(name="request", params={"connector": "cin7-omni", "method": "PUT",
  "url": "/v1/SalesOrders",
  "body": [{"Id": 67890, "Stage": "Processing"}]})

# Mark dispatched — setting DispatchedDate populates QtyShipped on lines
connectors(name="request", params={"connector": "cin7-omni", "method": "PUT",
  "url": "/v1/SalesOrders",
  "body": [{"Id": 67890, "Stage": "Dispatched", "DispatchedDate": "2026-06-10T02:30:00Z",
            "TrackingCode": "NZP123456789"}]})

# Void — IRREVERSIBLE, confirm with the user first
connectors(name="request", params={"connector": "cin7-omni", "method": "PUT",
  "url": "/v1/SalesOrders",
  "body": [{"Id": 67890, "IsVoid": true}]})
```

- `Status` (`Draft`/`Approved`/`Void`) is **read-only** — it reflects `IsApproved`/`IsVoid` [SPEC].
- `Stage` values: `New`, `Awaiting Payment`, `Declined`, `Dispatched`, `Processing`, `On Hold` [SPEC]. Allowed transition order is account-configured [UNVERIFIED].
- `BranchId` is **not updatable** once a sales order is dispatched / a purchase order is received [SPEC].
- `IsVoid: true` is irreversible [SPEC].

### Pattern 8: Update order line items

Send the line with its `Id` inside the parent's `LineItems` array. Whether omitted lines are preserved or the array is replaced wholesale is [UNVERIFIED] — **safest pattern: GET the order first, modify the `LineItems` array in place, PUT the full array back.**

```
connectors(name="request", params={"connector": "cin7-omni", "method": "GET",
  "url": "/v1/SalesOrders/67890"})

connectors(name="request", params={"connector": "cin7-omni", "method": "PUT",
  "url": "/v1/SalesOrders",
  "body": [{"Id": 67890, "LineItems": [ /* full modified array, each existing line keeps its Id */ ]}]})
```

### Pattern 9: Replace cartons for a sales order

The one PUT that addresses a record in the URL — and it **replaces the whole carton list** [SPEC]:

```
connectors(name="request", params={"connector": "cin7-omni", "method": "PUT",
  "url": "/v1/Cartons/67890",
  "body": [{
    "Number": 1,
    "SSCC": "000123456700000018",
    "Weight": 4.2,
    "TrackingNumber": "NZP123456789",
    "CartonItems": [{"Code": "WIDGET-RED-L", "Qty": 2}]
  }]})
```

`SSCC` and `CartonItems` are required per carton [SPEC]. Include every carton you want to keep — anything missing is gone.

## Delete Patterns

Only **Contacts** and **Payments** support DELETE [SPEC]. Both are permanent — no trash, no undo [UNVERIFIED — no restore endpoint exists in the spec]. Confirm with the user, and quote the record back to them before deleting.

```
# Delete a contact
connectors(name="request", params={"connector": "cin7-omni", "method": "DELETE",
  "url": "/v1/Contacts/12345"})

# Delete a payment (affects financial records — be careful)
connectors(name="request", params={"connector": "cin7-omni", "method": "DELETE",
  "url": "/v1/Payments/98765"})
```

Response is a **single** result object (not an array): `{"Success": true, "Id": 12345, "Code": "...", "Errors": []}` [SPEC].

**For everything else, "delete" means deactivate via PUT:**

| Entity        | Soft-delete field                                  |
| ------------- | -------------------------------------------------- |
| Contacts      | `IsActive: false` (if you don't want hard DELETE)  |
| Products      | `Status: "Inactive"` [SPEC]                        |
| ProductOptions| `Status: "Disabled"` [SPEC]                        |
| Orders/Quotes/CreditNotes | `IsVoid: true` — **irreversible** [SPEC] |

## Upload Pattern: Product Images

```
POST /v1/ProductImages?productId={id}&imagePriority={n}
```

Both query params are required; the body is `multipart/form-data` with a single binary `file` field [SPEC]. Response is a single result envelope [SPEC].

**Caveat:** the Numa `connectors` request tool sends JSON bodies — multipart file upload through the connector is **not validated and likely unsupported** [UNVERIFIED]. Treat ProductImages as out of reach until tested; suggest the user upload images via the Cin7 UI instead.

## Dangerous Operations

| Operation | Risk | Mitigation |
| --------- | ---- | ---------- |
| PUT with `""` field values | Silently clears data | Use `null`/omit for "no change"; only send `""` to intentionally clear [CONFIRMED — API investigation 2026-05-22] |
| `IsVoid: true` on any order | **Irreversible** void [SPEC] | Explicit user confirmation, restate the order Reference + Total first |
| `?loadboms=true` on order/quote POST/PUT | BOM expansion "cannot be undone" [SPEC] | Never set it unless the user asks for it by name |
| POST /v1/Products with duplicate codes | Whole batch rejected 400 [CONFIRMED — API investigation 2026-05-22] | Pre-check `StyleCode`/`ProductOptionCode` with a `where` query |
| DELETE Contacts/Payments | Permanent; may orphan linked orders / financial records | Confirm Id + show the record before deleting |
| POST /v1/Adjustments | Changes stock-on-hand | Confirm branch, SKUs, and quantity deltas with the user |
| PUT /v1/Cartons/{id} | Replaces the entire carton list | GET current cartons first; send the full desired list |
| Retrying a timed-out POST | Duplicate records (no idempotency keys) [UNVERIFIED] | Query for the would-be record (Reference/Email/StyleCode) before re-posting |

## Safe Mutation Workflow

1. **Read before write** — fetch current state; for updates, build the PUT from the GET payload.
2. **Confirm destructive intent** — void, delete, adjustments, `loadboms`: restate what will change and get a yes.
3. **Batch sensibly** — ≤ 250 records; for Products, de-dupe codes inside the batch AND against existing data first.
4. **Send the write** — array body, PascalCase fields, `null` for untouched fields.
5. **Check every envelope entry** — `Success: false` → surface that record's `Errors[]`; don't claim success on HTTP 200 alone.
6. **Capture returned `Id`s** — you'll need them for follow-up writes and verification.
7. **Verify if it matters** — GET the record back after high-stakes writes (the spec is BETA; runtime drift is possible [CONFIRMED — API investigation 2026-05-22]).
8. **On 400, re-query before retrying** — partial-creation behaviour on batch 400s is [UNVERIFIED].

---

_Generated 2026-06-10 from the 2026-05-22 API investigation + live OpenAPI spec. Companion to `01-llm-api-rules.md`. See `01d-event-and-error-handling.md` for error recovery and `01a-domain-model-reference.md` for full field tables._
