---
doc: mutation-patterns
api: QuickBooks Online Accounting API v3
scope: NL → write operation mappings. All writes are POST to /{entity} (relative to …/v3/company/{realmId}/). THERE IS NO PUT.
paths: pin minorversion=75 ; Content-Type: application/json
confidence: field names [DOCUMENTED] from Intuit docs/SDK; verify against sandbox before drop-in.
---

# Mutation Patterns — QuickBooks Online (v3)

## Golden rules (every write)

1. **POST does everything.** Create = POST, no `Id`. Update = POST + `Id` + current `SyncToken`. Delete/void = POST + `?operation=delete|void`.
2. **Sparse-or-wipe.** A plain (non-sparse) update POST REPLACES the whole object — any omitted field is cleared. Patch a subset → `"sparse":true` + `Id` + `SyncToken`.
3. **`SyncToken` mandatory on update**, must be CURRENT (from a fresh GET). Stale → error **5010 "Stale Object"** (HTTP 400). GET-then-update, always.
4. **References must already exist.** `CustomerRef`,`VendorRef`,`ItemRef`,`AccountRef` are `{"value":"<Id>"}`. Resolve ids by querying first (01b). No inline creation.
5. **Don't send computed fields.** `TotalAmt`,`Balance`,`UnappliedAmt`,`MetaData.*`,`Id`(on create),`SyncToken`(on create) are server-managed.
6. **Idempotency:** pass `?requestid={uuid}` on create POSTs — a retried request is deduped instead of creating a second record.

## Create

**Customer** — `POST /v3/company/{realmId}/customer?minorversion=75`
`{"DisplayName":"Acme Corp","CompanyName":"Acme Corporation Ltd","PrimaryEmailAddr":{"Address":"ap@acme.com"},"PrimaryPhone":{"FreeFormNumber":"(415) 555-0100"},"BillAddr":{"Line1":"123 Main St","City":"San Francisco","CountrySubDivisionCode":"CA","PostalCode":"94105"}}`
`DisplayName` unique per realm → duplicate returns error **6240**; query first if unsure.

**Vendor** — `POST /vendor?minorversion=75`
`{"DisplayName":"Office Supplies Co","CompanyName":"Office Supplies Co","PrimaryEmailAddr":{"Address":"billing@officesupplies.com"}}`

**Item (service)** — `POST /item?minorversion=75`
`{"Name":"Consulting Services","Type":"Service","UnitPrice":50.00,"IncomeAccountRef":{"value":"79"}}`
**Item (inventory)** also needs `ExpenseAccountRef`,`AssetAccountRef`,`TrackQtyOnHand:true`,`QtyOnHand`,`InvStartDate`:
`{"Name":"Widget","Type":"Inventory","UnitPrice":25.00,"IncomeAccountRef":{"value":"79"},"ExpenseAccountRef":{"value":"80"},"AssetAccountRef":{"value":"81"},"TrackQtyOnHand":true,"QtyOnHand":100,"InvStartDate":"2026-05-29"}`

**Invoice** — resolve ids first (01b): customer id, item id (+ UnitPrice). `POST /invoice?minorversion=75&requestid={uuid}`
`{"CustomerRef":{"value":"58"},"TxnDate":"2026-05-29","DueDate":"2026-06-28","Line":[{"Amount":150.00,"DetailType":"SalesItemLineDetail","Description":"Consulting - 3 hours","SalesItemLineDetail":{"ItemRef":{"value":"1"},"Qty":3,"UnitPrice":50.00}}]}`
Response carries assigned `Id`, `DocNumber`, computed `TotalAmt`/`Balance`, `SyncToken:"0"`. Line `Amount` must equal `Qty * UnitPrice` — QBO recomputes and rejects mismatches with a validation Fault.

**Bill** — resolve vendor id + expense account id. `POST /bill?minorversion=75&requestid={uuid}`
`{"VendorRef":{"value":"56"},"TxnDate":"2026-05-29","DueDate":"2026-06-28","Line":[{"Amount":200.00,"DetailType":"AccountBasedExpenseLineDetail","Description":"Monthly software subscription","AccountBasedExpenseLineDetail":{"AccountRef":{"value":"63"}}}]}`
Item-based line: use `DetailType:"ItemBasedExpenseLineDetail"` with `ItemBasedExpenseLineDetail.ItemRef`.

**Customer payment (apply to invoice)** — resolve customer id + open invoice id(s)+balances. `POST /payment?minorversion=75&requestid={uuid}`
`{"CustomerRef":{"value":"58"},"TotalAmt":150.00,"TxnDate":"2026-05-29","DepositToAccountRef":{"value":"35"},"Line":[{"Amount":150.00,"LinkedTxn":[{"TxnId":"131","TxnType":"Invoice"}]}]}`

- Each `Line` applies its `Amount` to one txn via `LinkedTxn` (`TxnType:"Invoice"`).
- Partial payment: set `Line[].Amount` (and `TotalAmt`) below the invoice balance → invoice → partially-paid.
- Multiple invoices: one `Line` per invoice; `TotalAmt` = sum of line amounts.
- Omit `DepositToAccountRef` → lands in Undeposited Funds. Linked invoices must belong to the same `CustomerRef`; after success the invoice `Balance` decreases.
- Vendor-side (paying a Bill) is a SEPARATE entity: `POST /billpayment` with `VendorRef` + `Line[].LinkedTxn` of `TxnType:"Bill"`.

## Update

**Sparse (recommended — patch a few fields)** — `POST /customer?minorversion=75`
`{"sparse":true,"Id":"58","SyncToken":"1","PrimaryEmailAddr":{"Address":"newemail@acme.com"}}`
Steps: 1) `GET /customer/58` (or query) → read current `SyncToken`. 2) POST with `"sparse":true`, `Id`, current `SyncToken`, only changed fields. 3) Response returns the full updated entity with incremented `SyncToken`.
Forget `"sparse":true` → every omitted field is CLEARED. Stale/missing `SyncToken` → error **5010**.

**Full (replace whole object)** — only to overwrite. Send the ENTIRE entity (typically a GET result with edits) incl. `Id`+current `SyncToken`, WITHOUT `"sparse"`. `POST /invoice?minorversion=75`
`{"Id":"131","SyncToken":"0","CustomerRef":{"value":"58"},"TxnDate":"2026-05-29","DueDate":"2026-07-15","Line":[{"Id":"1","Amount":150.00,"DetailType":"SalesItemLineDetail","SalesItemLineDetail":{"ItemRef":{"value":"1"},"Qty":3,"UnitPrice":50.00}}]}`
On full updates that change lines: include each line's existing `Id` to preserve it; omit `Id` to add a new line. Lines ABSENT from a full update are removed.

**Deactivate (soft delete) a name-list entity** — Customer/Vendor/Item have NO hard delete; deactivate via sparse:
`{"sparse":true,"Id":"58","SyncToken":"2","Active":false}`

## Destructive operations (HITL-gate — confirm with user before executing)

**Delete a transaction** — `POST /invoice?operation=delete&minorversion=75` → `{"Id":"131","SyncToken":"0"}`. Works for txn entities (Invoice, Bill, Payment, …). Returns a deletion confirmation. **Irreversible** — record + SyncToken history gone.

**Void an invoice** — `POST /invoice?operation=void&minorversion=75` → `{"Id":"131","SyncToken":"0"}`. Sets `TotalAmt`→0 but RETAINS lines + audit trail (status Voided). Prefer void over delete when you need to keep a record.

**Send invoice by email** — `POST /invoice/131/send?sendTo=customer@example.com&minorversion=75`. Sets `EmailStatus` to `EmailSent`. Omit `sendTo` → uses customer's `PrimaryEmailAddr`.

## Batch (≤30 ops, one round trip)

`POST /batch?minorversion=75`
`{"BatchItemRequest":[{"bId":"1","operation":"create","Invoice":{"CustomerRef":{"value":"58"},"Line":[…]}},{"bId":"2","operation":"update","Customer":{"sparse":true,"Id":"58","SyncToken":"2","Active":false}},{"bId":"3","Query":"SELECT * FROM Item WHERE Active = true MAXRESULTS 50"}]}`

- Up to 30 items/call; mixed create/update/delete/query allowed.
- Partial success: each `BatchItemResponse` carries either the entity or a `Fault`; reconcile by `bId`.
- Batch throttle: **120 req/min/realm** (raised from 40 on 2025-10-31).

## Write-error codes (full Fault catalogue in 01d)

| Code | HTTP | Cause                          | Fix                                           |
| ---- | ---- | ------------------------------ | --------------------------------------------- |
| 5010 | 400  | Stale `SyncToken`              | re-GET entity, retry with fresh token         |
| 6240 | 400  | Duplicate `DisplayName`/`Name` | use a unique name; query for the existing one |
| 2010 | 400  | Required field missing         | add the missing field                         |
| 610  | 400  | Referenced object not found    | verify the `*Ref.value` id exists in realm    |
| 4001 | 400  | Invalid request / parse error  | fix the JSON / detail type                    |

Risk reminders: non-sparse update silently clears omitted fields → use `"sparse":true` unless full replace intended; `?operation=delete` is permanent/irreversible (HITL-gate, prefer void, confirm id+realm); bulk financial mutation via `/batch` carries audit/rate-limit risk — keep batches small and reviewed.
