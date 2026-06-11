---
api_name: 'Cin7 Core'
api_slug: 'cin7-core'
generated_from: '00-api-investigation (Cin7 dual-product investigation, 2026-05-22)'
generated_date: '2026-06-10'
update_source: 'Official Apiary blueprint (dearinventory.docs.apiary.io), captured live 2026-05-22 — NOT validated through the Numa connector path'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# Cin7 Core -- Mutation Patterns Reference

> ⚠️ **Investigation-confirmed (live API tests 2026-05-22) but NOT yet validated through the Numa connector path.**
> Companion to `01-llm-api-rules.md`. All write patterns: creates, updates, deletes,
> sale/purchase stage transitions, and partial-success handling. [DOCS] = official Apiary
> blueprint, captured in the 2026-05-22 API investigation; [UNVERIFIED] = inferred —
> confirm before relying on it. **No successful-response body has been observed for any
> mutation** — treat all response shapes as [UNVERIFIED] and re-GET after writing.

> **Auth note:** Examples use the Numa request form with bare relative paths. The Numa
> backend injects `api-auth-accountid` + `api-auth-applicationkey` from the user's vault
> automatically and expands relative URLs against
> `https://inventory.dearsystems.com/externalapi/v2`. Never set auth headers; never use an
> absolute URL.

> ⚠️ **No sandbox environment is confirmed for Cin7 Core** [UNVERIFIED] — every mutation
> hits the customer's live company data. Confirm intent with the user before any write,
> and prefer a read-first / write / re-read-verify sequence.

---

## Write Capabilities Summary

| Operation | Supported | Method | Notes |
| --- | --- | --- | --- |
| Create | Yes | POST | Single JSON object per request — NOT batch arrays [DOCS] |
| Full replace | Yes | PUT | `ID` (GUID) required **in the body**; resend the full object [DOCS] |
| Partial update | No | — | No PATCH in the blueprint; PUT semantics for omitted fields [UNVERIFIED] — assume replace |
| Delete | Limited | DELETE | Confirmed only on `/webhooks`, `/Brand`, `/Carrier` [DOCS] |
| Void (soft delete) | Yes | stage endpoints | Sales/purchases/production docs are **voided via their status workflow**, never DELETEd [DOCS] |
| Bulk create/update | No | — | One object per request; pace within 60/min [DOCS] |
| State transitions | Yes | POST/PUT | Stage sub-endpoints (`/SaleOrder`, `/SaleFulfilment`…); exact bodies [UNVERIFIED] |
| File upload | Unclear | POST | `/ProductAttachments` exists; request format [UNVERIFIED] |

---

## General Rules

1. **One object per request.** Core POST/PUT bodies are single JSON objects, not arrays. [DOCS]
2. **PUT requires the `ID` GUID in the body** — there are no `/Entity/{id}` path routes.
   Treat PUT as a full-object replace: GET the record, modify the fields you need, PUT the
   whole thing back. Omitted-field behavior is [UNVERIFIED] — do not "PUT a sparse diff"
   and hope for partial-update semantics.
3. **Reference-by-name fields must already exist.** `PaymentTerm`, `TaxRule`, account
   codes, `PriceTier`, `Carrier`, `Location` are resolved by name/code against the
   customer's reference books — read `/PaymentTerm`, `/Tax`, `/ChartOfAccounts`, etc.
   first and copy exact values. A typo here is a 400. [DOCS]
4. **Check every 200 for an `Errors` array.** Some endpoints (Disassembly confirmed)
   signal partial success inside an HTTP 200 body. HTTP success ≠ business success. [DOCS]
5. **204 No Content is a success with an empty body** — don't JSON-parse it. [DOCS]
6. **403 = bad credentials** (not permissions). Stop, ask the user to reconnect via the
   chat credential card — never retry-loop a 403. [DOCS]
7. **Vendor guidance: queue everything.** "Never assume the API is online at any time.
   Always queue requests… so that you can retry." Before retrying a mutation that may have
   landed, re-GET to check — POSTs are not idempotent and a blind retry can create a
   duplicate document. [DOCS]
8. **Success response bodies are [UNVERIFIED] for all mutations.** If you need the
   server-generated GUID of a created record and the response doesn't obviously contain
   it, find the record via the matching list endpoint (e.g. by unique `Name` or order
   number) rather than guessing.

---

## Create Patterns

### Pattern 1: Create a Customer [DOCS]

All 7 required fields must be present: `Name` (unique), `Status`, `Currency`,
`PaymentTerm`, `AccountReceivable`, `RevenueAccount`, `TaxRule`. Missing any → 400.

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/Customer",
  "method": "POST",
  "body": {
    "Name": "Acme Ltd",
    "Status": "Active",
    "Currency": "NZD",
    "PaymentTerm": "30 days",
    "AccountReceivable": "200",
    "RevenueAccount": "400",
    "TaxRule": "GST on Sales"
  }
})
```

- `PaymentTerm` and `TaxRule` are names; `AccountReceivable`/`RevenueAccount` are account
  codes from `/ChartOfAccounts`. Read the reference books first and copy exact values. [DOCS]
- `Name` must be unique across customers (max 256 chars) — on a duplicate expect a 400
  [UNVERIFIED exact behavior]. Check `/Customer` first if unsure.
- Full optional field list (addresses, contacts, credit limit, attributes) in `01a`.
- Response body [UNVERIFIED] — re-fetch via `GET /Customer` and match on `Name` to get the
  server-generated `ID`.

### Pattern 2: Create a Sale (draft) [DOCS structure; body details UNVERIFIED]

Sale creation follows the multi-step state machine (see `01a`). The initial POST creates
the composite document in Draft; stages are then advanced via the stage endpoints.

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/Sale",
  "method": "POST",
  "body": {
    "Customer": "Acme Ltd",
    "ShipBy": "2026-07-01T00:00:00.000",
    "Note": "",
    "Order": {
      "Status": "DRAFT",
      "Lines": [
        { "ProductCode": "WIDGET-001", "Quantity": 5, "Price": 49.99 }
      ]
    }
  }
})
```

- `Customer` is the customer **name**, resolved against existing customers. [DOCS]
- Dates use `yyyy-MM-ddTHH:mm:ss.fff`, no `Z`. [DOCS]
- The exact required-field set and response body are [UNVERIFIED] — on a 400, read the
  error text, fix, and resend. Verify the result with `GET /SaleList` (newest rows) and
  then `GET /Sale?SaleID={guid}`.

### Pattern 3: Create a webhook subscription [DOCS]

Requires the customer's **Automation module add-on**. Max 5 webhooks per event type.
The `ExternalURL` is the **customer's own endpoint** — Numa cannot receive these (see `01d`).

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/webhooks",
  "method": "POST",
  "body": {
    "Type": "Sale/OrderAuthorised",
    "IsActive": true,
    "ExternalURL": "https://customer-system.example.com/webhook",
    "ExternalAuthorizationType": "bearerauth",
    "ExternalBearerToken": "customer-secret-token"
  }
})
```

- `ExternalAuthorizationType`: `noauth` | `basicauth` (+ `ExternalUserName`/`ExternalPassword`)
  | `bearerauth` (+ `ExternalBearerToken`). Optional `ExternalHeaders` array for extra
  key/value headers. [DOCS]
- Event type catalog (31 types) and delivery/retry semantics: see `01d`.
- Note the **lowercase** path `/webhooks` — the one exception to TitleCase endpoint naming. [DOCS]

### Pattern 4: Create a Product [DOCS endpoint; body fields UNVERIFIED]

`POST /Product` exists [DOCS], but the required-field set was not captured in the
investigation. Safest approach: `GET /Product?page=1&limit=1`, copy an existing product's
shape, change `SKU` (must be unique [UNVERIFIED]) and `Name`, drop server fields (`ID`),
and POST. Same recipe applies to other create-capable entities not detailed here
(`/Supplier`, `/Location`, `/Lead`, `/Journal`, …): **read one, clone the shape, POST**.

---

## Update Patterns

### Pattern 5: Update a Customer (PUT = full replace) [DOCS]

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/Customer",
  "method": "PUT",
  "body": {
    "ID": "91EE7B1D-BD35-4E43-B98A-DB86BE777624",
    "Name": "Acme Ltd (Updated)",
    "Status": "Active",
    "Currency": "NZD",
    "PaymentTerm": "30 days",
    "AccountReceivable": "200",
    "RevenueAccount": "400",
    "TaxRule": "GST on Sales"
  }
})
```

- `ID` is required in the body. [DOCS]
- **Always GET → modify → PUT the full object.** Whether omitted fields are preserved or
  cleared is [UNVERIFIED] — resending everything makes the question moot. There is no
  documented `null` = "skip" convention in Core; don't rely on one.
- Verify with a follow-up GET before reporting success.

### Pattern 6: Deactivate / reactivate a webhook [DOCS]

PUT with the `ID` plus the full field set — flip `IsActive`:

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/webhooks",
  "method": "PUT",
  "body": {
    "ID": "A1B2C3D4-0000-0000-0000-000000000000",
    "Type": "Sale/OrderAuthorised",
    "IsActive": false,
    "ExternalURL": "https://customer-system.example.com/webhook",
    "ExternalAuthorizationType": "bearerauth",
    "ExternalBearerToken": "customer-secret-token"
  }
})
```

Same pattern reactivates a webhook that was auto-deactivated after 6 failed deliveries
(`IsActive: true`) — but investigate why it failed first (see `01d`). [DOCS]

### Pattern 7: Chart of Accounts — conditional update [DOCS]

`PUT /ChartOfAccounts` is **disabled while a Xero or QuickBooks integration is active** —
the accounting integration owns the ledger. Check with the user before attempting; on an
unexpected error here, an active accounting integration is the first suspect. [DOCS]

---

## Delete Patterns

DELETE is confirmed on exactly three endpoints: `/webhooks`, `/Brand`, `/Carrier`. [DOCS]
Everything else is removed by **voiding/deprecating through its status workflow**
(e.g. `Sale/Voided`, Customer `Status: "Deprecated"`), not by DELETE — expect 405 or 404
on unsupported DELETEs [UNVERIFIED which].

### Pattern 8: Delete a webhook [DOCS]

DELETE takes the `ID` in the request body (not the path):

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/webhooks",
  "method": "DELETE",
  "body": { "ID": "A1B2C3D4-0000-0000-0000-000000000000" }
})
```

Expect 200/204 on success [UNVERIFIED which]. Brand/Carrier DELETE shape is [UNVERIFIED] —
assume the same body-`ID` convention and verify with a follow-up GET.

---

## State Transitions (Sale & Purchase Lifecycles)

Sales and purchases are **state machines driven through stage sub-endpoints** — never try
to flip lifecycle status directly on the parent `/Sale` or `/Purchase`. [DOCS]

| Lifecycle | Stage endpoints (in order) |
| --- | --- |
| Sale | `/SaleQuote` → `/SaleOrder` → `/SaleFulfilment` (Pick → Pack → Ship via `/SaleFulfilmentPick`, `/SaleFulfilmentPack`, `/SaleFulfilmentShip`) → `/SaleInvoice` → `/SalePayments` (+ `/SaleCreditNote`) [DOCS] |
| Purchase | `/PurchaseOrder` → `/PurchaseStockReceived` → `/PurchaseInvoice` → `/PurchasePayments` (+ `/PurchaseCreditNote`) [DOCS] |

**Exact transition request bodies are [UNVERIFIED]** — inferred from the Apiary
sub-endpoint structure, never replayed live. The reliable recipe:

1. `GET /Sale?SaleID={guid}` — the composite document embeds every stage sub-document. [DOCS]
2. Inspect the target stage's current shape (its `Status`, lines, task IDs).
3. POST/PUT to the stage endpoint, echoing that shape with the new `Status`.
4. `GET /Sale?SaleID={guid}` again and confirm the stage actually advanced before
   reporting success.

### Pattern 9: Advance a sale to Order stage [UNVERIFIED body]

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/SaleOrder",
  "method": "POST",
  "body": {
    "SaleID": "91EE7B1D-BD35-4E43-B98A-DB86BE777624",
    "Status": "AUTHORISED"
  }
})
```

Inferred minimal body — the live endpoint may also require the order lines. On a 400, GET
the full sale, copy the embedded `Order` sub-document, set `Status: "AUTHORISED"`, resend.

### Pattern 10: Authorise a shipment [UNVERIFIED body]

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/SaleFulfilmentShip",
  "method": "POST",
  "body": {
    "SaleID": "91EE7B1D-BD35-4E43-B98A-DB86BE777624",
    "TaskID": "F0E1D2C3-0000-0000-0000-000000000000",
    "Status": "AUTHORISED"
  }
})
```

`TaskID` is the fulfilment task's GUID from the composite sale document. Fulfilment runs
Pick → Pack → Ship; authorising out of order may be rejected [UNVERIFIED]. Stage `Status`
values observed in docs: `DRAFT`, `AUTHORISED` (full per-stage value set [UNVERIFIED]).

### Pattern 11: Disassembly status machine [DOCS]

`/Disassembly` has a documented status workflow with **side effects on stock**:

| Set `Status` to | Effect |
| --- | --- |
| `DRAFT` | No stock movement |
| `WORK IN PROGRESS` | Auto-picks component stock |
| `COMPLETED` | Auto-picks, orders, and completes — stock is committed |
| `VOIDED` | Cancels |

Partial failures surface as an `Errors` array **inside an HTTP 200 response** — always
check it, log the failed lines, and re-attempt only those. [DOCS]

---

## Batch Semantics

- **No batch arrays.** Each POST/PUT carries one object; bulk work = a paced loop of
  single requests within the 60/min budget (~1 req/sec → 60 records/min ceiling). [DOCS]
- **Partial success is in-band:** `Errors` array in a 200 body (Disassembly confirmed;
  assume other task-like endpoints can do the same). Process what succeeded, retry only
  the failed lines. [DOCS]
- For long batch runs, checkpoint progress (which records are done) so a 429 or network
  failure mid-run doesn't force a restart — re-POSTing already-created records makes
  duplicates.

---

## Dangerous Operations

> Confirm with the user before executing any of these. **All writes hit live company
> data — no sandbox is confirmed.** [UNVERIFIED]

| Operation | Risk | Safeguard |
| --- | --- | --- |
| Any document void (`Status: "VOIDED"` via stage endpoints) | Irreversible business-document cancellation | Confirm document number with the user first |
| `Disassembly` → `WORK IN PROGRESS`/`COMPLETED` | Auto-picks/commits real stock [DOCS] | Confirm; check `Errors` array after |
| `DELETE /Brand`, `DELETE /Carrier` | Permanent reference-book deletion; may be referenced by products/sales | List dependents first; confirm |
| `PUT /ChartOfAccounts` | Blocked when Xero/QBO active [DOCS]; ledger structure changes affect accounting | Ask about accounting integrations first |
| `DELETE /webhooks` / `PUT IsActive:false` | Silently breaks the customer's existing automations | Show the subscription to the user before touching it |
| Stock mutations (`/StockAdjustment`, `/StockTake`, `/StockTransfer`) | Change inventory quantities and valuations | Echo the exact quantities/locations back to the user before posting |
| Blind retry of a timed-out POST | Duplicate documents (no idempotency keys) [UNVERIFIED] | Re-GET (list endpoint) to check whether the first attempt landed |

---

## Gotchas & Counter-Exceptions

1. **`ID` goes in the body, not the path.** `PUT /Customer/{guid}` is not a route — 404
   here means a malformed URL, not a missing record. [DOCS]
2. **HTTP 200 can hide failure.** Check for an `Errors` array on every mutation response
   before declaring success. [DOCS]
3. **405 = read-only endpoint.** The `…List` endpoints (`/SaleList`, `/PurchaseList`, …)
   are GET-only; mutate via the document/stage endpoints instead. [DOCS]
4. **Reference values are matched by exact name/code.** `"30 Days"` vs `"30 days"` may
   400 [UNVERIFIED case-sensitivity] — copy strings verbatim from the reference books.
5. **No PATCH anywhere.** Partial-update intent must be expressed as GET → modify → full
   PUT.
6. **Mutation flows are request-hungry.** A safe stage transition costs ≥ 3 calls
   (read, write, verify) — budget against 60/min and pace at ~1 req/sec. [DOCS]
7. **204 responses have no body** — a JSON parse here is a bug, not an API error. [DOCS]
8. **Created-record GUIDs may not come back in the response** [UNVERIFIED] — recover them
   via the list endpoint (unique `Name`, `SKU`, or newest order number).
9. **`/webhooks` is lowercase**; every other endpoint is TitleCase singular. [DOCS]
10. **Don't invent enum values.** Status strings are per-stage (`DRAFT`, `AUTHORISED`, …)
    with incomplete documented sets [UNVERIFIED] — copy values observed in real records.

---

_Generated 2026-06-10 from the 2026-05-22 Cin7 API investigation (official Apiary blueprint). NOT yet validated through the Numa connector path._
