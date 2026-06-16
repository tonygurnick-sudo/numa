---
api_name: Cin7 Core
api_slug: cin7-core
base_url: https://inventory.dearsystems.com/externalapi/v2
call_surface: HTTP via `numa integrations request cin7-core <METHOD> <relative-url> --body '<json>'`; pass flat relative paths. Backend injects api-auth-accountid + api-auth-applicationkey and sets Content-Type. Never set auth headers; never use an absolute URL.
role: on-demand write reference — creates, updates, deletes, sale/purchase stage transitions, partial-success handling
confidence: every fact from the official Cin7 Core Apiary blueprint, captured live 2026-05-22; NOT validated through the Numa connector. Inline [UNVERIFIED] = inferred. **No successful-response body has been observed for any mutation** — treat all response shapes as [UNVERIFIED] and re-GET after writing. Companion to 01-llm-api-rules.md.
sandbox: NONE confirmed [UNVERIFIED] — every mutation hits the customer's live company data. Confirm intent before any write; prefer read → write → re-read-verify.
---

# Cin7 Core — Mutation Patterns Reference

## Write capabilities summary

| Operation          | Supported | Method          | Notes                                                                             |
| ------------------ | --------- | --------------- | --------------------------------------------------------------------------------- |
| Create             | Yes       | POST            | Single JSON object per request — NOT batch arrays                                 |
| Full replace       | Yes       | PUT             | `ID` (GUID) required **in the body**; resend the full object                      |
| Partial update     | No        | —               | No PATCH; PUT semantics for omitted fields [UNVERIFIED] — assume replace          |
| Delete             | Limited   | DELETE          | Confirmed only on `/webhooks`, `/Brand`, `/Carrier`                               |
| Void (soft delete) | Yes       | stage endpoints | Sales/purchases/production docs **voided via status workflow**, never DELETEd     |
| Bulk create/update | No        | —               | One object per request; pace within 60/min                                        |
| State transitions  | Yes       | POST/PUT        | Stage sub-endpoints (`/SaleOrder`, `/SaleFulfilment`…); exact bodies [UNVERIFIED] |
| File upload        | Unclear   | POST            | `/ProductAttachments` exists; request format [UNVERIFIED]                         |

## General rules

1. **One object per request.** POST/PUT bodies are single JSON objects, not arrays.
2. **PUT requires the `ID` GUID in the body** — no `/Entity/{id}` path routes. Treat PUT as full-object replace: GET, modify the fields you need, PUT the whole thing back. Omitted-field behavior [UNVERIFIED] — do not "PUT a sparse diff" and hope for partial-update semantics.
3. **Reference-by-name fields must already exist.** `PaymentTerm`, `TaxRule`, account codes, `PriceTier`, `Carrier`, `Location` resolved by name/code against the customer's reference books — read `/PaymentTerm`, `/Tax`, `/ChartOfAccounts`, etc. first and copy exact values. A typo here is a 400.
4. **Check every 200 for an `Errors` array.** Some endpoints (Disassembly confirmed) signal partial success inside an HTTP 200 body. HTTP success ≠ business success.
5. **204 No Content = success, empty body** — don't JSON-parse it.
6. **403 = bad credentials** (not permissions). Stop, ask the user to reconnect via the chat credential card — never retry-loop a 403.
7. **Vendor guidance: queue everything.** "Never assume the API is online at any time. Always queue requests… so that you can retry." Before retrying a mutation that may have landed, re-GET to check — POSTs are not idempotent; a blind retry can create a duplicate document.
8. **Success bodies [UNVERIFIED] for all mutations.** If you need a created record's server-generated GUID and the response doesn't obviously contain it, find the record via the matching list endpoint (unique `Name` or order number) rather than guessing.

## Create patterns

### Pattern 1: Create a Customer

All 7 required fields present: `Name` (unique), `Status`, `Currency`, `PaymentTerm`, `AccountReceivable`, `RevenueAccount`, `TaxRule`. Missing any → 400.

```
numa integrations request cin7-core POST /Customer --body '{"Name":"Acme Ltd","Status":"Active","Currency":"NZD","PaymentTerm":"30 days","AccountReceivable":"200","RevenueAccount":"400","TaxRule":"GST on Sales"}' -m "create customer"
```

- `PaymentTerm`/`TaxRule` are names; `AccountReceivable`/`RevenueAccount` are account codes from `/ChartOfAccounts`. Read the reference books first, copy exact values.
- `Name` must be unique (max 256 chars) — on a duplicate expect a 400 [UNVERIFIED exact behavior]. Check `/Customer` first if unsure.
- Full optional field list (addresses, contacts, credit limit, attributes) in `01a`.
- Response body [UNVERIFIED] — re-fetch via `GET /Customer`, match on `Name` for the server-generated `ID`.

### Pattern 2: Create a Sale (draft) [body details UNVERIFIED]

Initial POST creates the composite document in Draft; stages advanced via the stage endpoints (see `01a`).

```
numa integrations request cin7-core POST /Sale --body '{"Customer":"Acme Ltd","ShipBy":"2026-07-01T00:00:00.000","Note":"","Order":{"Status":"DRAFT","Lines":[{"ProductCode":"WIDGET-001","Quantity":5,"Price":49.99}]}}' -m "create draft sale"
```

- `Customer` is the customer **name**, resolved against existing customers.
- Dates use `yyyy-MM-ddTHH:mm:ss.fff`, no `Z`.
- Exact required-field set and response body [UNVERIFIED] — on a 400, read the error text, fix, resend. Verify with `GET /SaleList` (newest rows) then `GET /Sale?SaleID={guid}`.

### Pattern 3: Create a webhook subscription

Requires the **Automation module add-on**. Max 5 webhooks per event type. `ExternalURL` is the **customer's own endpoint** — Numa cannot receive these (see `01d`).

```
numa integrations request cin7-core POST /webhooks --body '{"Type":"Sale/OrderAuthorised","IsActive":true,"ExternalURL":"https://customer-system.example.com/webhook","ExternalAuthorizationType":"bearerauth","ExternalBearerToken":"customer-secret-token"}' -m "create webhook"
```

- `ExternalAuthorizationType`: `noauth` | `basicauth` (+ `ExternalUserName`/`ExternalPassword`) | `bearerauth` (+ `ExternalBearerToken`). Optional `ExternalHeaders` array for extra key/value headers.
- Event type catalog (31 types) + delivery/retry semantics: see `01d`.
- **Lowercase** path `/webhooks` — the one exception to TitleCase endpoint naming.

### Pattern 4: Create a Product [endpoint confirmed; body fields UNVERIFIED]

`POST /Product` exists, but the required-field set was not captured. Safest: `GET /Product?page=1&limit=1`, copy an existing product's shape, change `SKU` (must be unique [UNVERIFIED]) and `Name`, drop server fields (`ID`), POST. Same recipe for other create-capable entities not detailed here (`/Supplier`, `/Location`, `/Lead`, `/Journal`…): **read one, clone the shape, POST.**

## Update patterns

### Pattern 5: Update a Customer (PUT = full replace)

```
numa integrations request cin7-core PUT /Customer --body '{"ID":"91EE7B1D-BD35-4E43-B98A-DB86BE777624","Name":"Acme Ltd (Updated)","Status":"Active","Currency":"NZD","PaymentTerm":"30 days","AccountReceivable":"200","RevenueAccount":"400","TaxRule":"GST on Sales"}' -m "update customer"
```

- `ID` required in the body.
- **Always GET → modify → PUT the full object.** Whether omitted fields are preserved or cleared is [UNVERIFIED] — resending everything makes the question moot. No documented `null` = "skip" convention; don't rely on one.
- Verify with a follow-up GET before reporting success.

### Pattern 6: Deactivate / reactivate a webhook

PUT with the `ID` plus the full field set — flip `IsActive`:

```
numa integrations request cin7-core PUT /webhooks --body '{"ID":"A1B2C3D4-0000-0000-0000-000000000000","Type":"Sale/OrderAuthorised","IsActive":false,"ExternalURL":"https://customer-system.example.com/webhook","ExternalAuthorizationType":"bearerauth","ExternalBearerToken":"customer-secret-token"}' -m "deactivate webhook"
```

Same pattern reactivates a webhook auto-deactivated after 6 failed deliveries (`IsActive:true`) — but investigate why it failed first (see `01d`).

### Pattern 7: Chart of Accounts — conditional update

`PUT /ChartOfAccounts` is **disabled while a Xero or QuickBooks integration is active** — the accounting integration owns the ledger. Check with the user first; on an unexpected error here, an active accounting integration is the first suspect.

## Delete patterns

DELETE confirmed on exactly three endpoints: `/webhooks`, `/Brand`, `/Carrier`. Everything else is removed by **voiding/deprecating through its status workflow** (e.g. `Sale/Voided`, Customer `Status:"Deprecated"`), not by DELETE — expect 405 or 404 on unsupported DELETEs [UNVERIFIED which].

### Pattern 8: Delete a webhook

DELETE takes the `ID` in the body (not the path):

```
numa integrations request cin7-core DELETE /webhooks --body '{"ID":"A1B2C3D4-0000-0000-0000-000000000000"}' -m "delete webhook"
```

Expect 200/204 on success [UNVERIFIED which]. Brand/Carrier DELETE shape [UNVERIFIED] — assume the same body-`ID` convention, verify with a follow-up GET.

## State transitions (Sale & Purchase lifecycles)

Sales and purchases are **state machines driven through stage sub-endpoints** — never flip lifecycle status directly on the parent `/Sale` or `/Purchase`.

| Lifecycle | Stage endpoints (in order)                                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sale      | `/SaleQuote` → `/SaleOrder` → `/SaleFulfilment` (Pick → Pack → Ship via `/SaleFulfilmentPick`, `/SaleFulfilmentPack`, `/SaleFulfilmentShip`) → `/SaleInvoice` → `/SalePayments` (+ `/SaleCreditNote`) |
| Purchase  | `/PurchaseOrder` → `/PurchaseStockReceived` → `/PurchaseInvoice` → `/PurchasePayments` (+ `/PurchaseCreditNote`)                                                                                      |

**Exact transition request bodies [UNVERIFIED]** — inferred from the Apiary sub-endpoint structure, never replayed live. Reliable recipe:

1. `GET /Sale?SaleID={guid}` — composite document embeds every stage sub-document.
2. Inspect the target stage's current shape (`Status`, lines, task IDs).
3. POST/PUT to the stage endpoint, echoing that shape with the new `Status`.
4. `GET /Sale?SaleID={guid}` again; confirm the stage actually advanced before reporting success.

### Pattern 9: Advance a sale to Order stage [UNVERIFIED body]

```
numa integrations request cin7-core POST /SaleOrder --body '{"SaleID":"91EE7B1D-BD35-4E43-B98A-DB86BE777624","Status":"AUTHORISED"}' -m "authorise sale order"
```

Inferred minimal body — the live endpoint may also require the order lines. On a 400, GET the full sale, copy the embedded `Order` sub-document, set `Status:"AUTHORISED"`, resend.

### Pattern 10: Authorise a shipment [UNVERIFIED body]

```
numa integrations request cin7-core POST /SaleFulfilmentShip --body '{"SaleID":"91EE7B1D-BD35-4E43-B98A-DB86BE777624","TaskID":"F0E1D2C3-0000-0000-0000-000000000000","Status":"AUTHORISED"}' -m "authorise shipment"
```

`TaskID` is the fulfilment task's GUID from the composite sale document. Fulfilment runs Pick → Pack → Ship; authorising out of order may be rejected [UNVERIFIED]. Stage `Status` values observed in docs: `DRAFT`, `AUTHORISED` (full per-stage set [UNVERIFIED]).

### Pattern 11: Disassembly status machine

`/Disassembly` has a documented status workflow with **side effects on stock**:
| Set `Status` to | Effect |
| --- | --- |
| `DRAFT` | No stock movement |
| `WORK IN PROGRESS` | Auto-picks component stock |
| `COMPLETED` | Auto-picks, orders, and completes — stock is committed |
| `VOIDED` | Cancels |

Partial failures surface as an `Errors` array **inside an HTTP 200 response** — always check it, log the failed lines, and re-attempt only those.

## Batch semantics

- **No batch arrays.** Each POST/PUT carries one object; bulk work = a paced loop of single requests within 60/min (~1 req/sec → 60 records/min ceiling).
- **Partial success is in-band:** `Errors` array in a 200 body (Disassembly confirmed; assume other task-like endpoints can too). Process what succeeded, retry only failed lines.
- For long runs, checkpoint progress (which records done) so a 429 or network failure mid-run doesn't force a restart — re-POSTing already-created records makes duplicates.

## Dangerous operations

Confirm with the user before executing. **All writes hit live company data — no sandbox is confirmed** [UNVERIFIED].
| Operation | Risk | Safeguard |
| --- | --- | --- |
| Any document void (`Status:"VOIDED"` via stage endpoints) | Irreversible business-document cancellation | Confirm document number first |
| `Disassembly` → `WORK IN PROGRESS`/`COMPLETED` | Auto-picks/commits real stock | Confirm; check `Errors` array after |
| `DELETE /Brand`, `DELETE /Carrier` | Permanent reference-book deletion; may be referenced by products/sales | List dependents first; confirm |
| `PUT /ChartOfAccounts` | Blocked when Xero/QBO active; ledger structure changes affect accounting | Ask about accounting integrations first |
| `DELETE /webhooks` / `PUT IsActive:false` | Silently breaks the customer's existing automations | Show the subscription to the user first |
| Stock mutations (`/StockAdjustment`, `/StockTake`, `/StockTransfer`) | Change inventory quantities and valuations | Echo exact quantities/locations back before posting |
| Blind retry of a timed-out POST | Duplicate documents (no idempotency keys) [UNVERIFIED] | Re-GET (list endpoint) to check whether the first attempt landed |

## Gotchas & counter-exceptions

1. **`ID` goes in the body, not the path.** `PUT /Customer/{guid}` is not a route — 404 here means a malformed URL, not a missing record.
2. **HTTP 200 can hide failure.** Check for an `Errors` array on every mutation response before declaring success.
3. **405 = read-only endpoint.** The `…List` endpoints (`/SaleList`, `/PurchaseList`…) are GET-only; mutate via the document/stage endpoints.
4. **Reference values matched by exact name/code.** `"30 Days"` vs `"30 days"` may 400 [UNVERIFIED case-sensitivity] — copy strings verbatim from the reference books.
5. **No PATCH anywhere.** Partial-update intent = GET → modify → full PUT.
6. **Mutation flows are request-hungry.** A safe stage transition costs ≥ 3 calls (read, write, verify) — budget against 60/min, pace ~1 req/sec.
7. **204 responses have no body** — a JSON parse here is a bug, not an API error.
8. **Created-record GUIDs may not come back** [UNVERIFIED] — recover via the list endpoint (unique `Name`, `SKU`, newest order number).
9. **`/webhooks` is lowercase**; every other endpoint is TitleCase singular.
10. **Don't invent enum values.** Status strings are per-stage (`DRAFT`, `AUTHORISED`…) with incomplete documented sets [UNVERIFIED] — copy values observed in real records.
