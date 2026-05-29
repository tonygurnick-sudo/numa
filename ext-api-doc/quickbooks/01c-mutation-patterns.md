# Mutation Patterns — QuickBooks Online Accounting API (v3)

> Natural language → API write operation mappings.
> All writes are **POST** to `/{entity}` (relative to `…/v3/company/{realmId}/`). **There is no PUT.**
> Request field names `[DOCUMENTED]` from Intuit docs/SDK; verify against sandbox before treating as drop-in.
> Pin `minorversion=75`. `Content-Type: application/json`.

---

## Golden rules for every write

1. **POST does everything.** Create = POST with no `Id`. Update = POST with `Id` + current `SyncToken`. Delete/void = POST with `?operation=delete|void`.
2. **Sparse update or you wipe fields.** A plain update POST **replaces the whole object** — any field you omit is cleared. To patch a subset, send `"sparse": true` + `Id` + `SyncToken`.
3. **`SyncToken` is mandatory on update** and must be the **current** value (from a fresh GET). Stale → error **5010 "Stale Object"** (HTTP 400). GET-then-update, always.
4. **References must already exist.** `CustomerRef`, `VendorRef`, `ItemRef`, `AccountRef` are `{"value":"<Id>"}`. Resolve ids by querying first (see `01b`). No inline creation.
5. **Don't send computed fields.** `TotalAmt`, `Balance`, `UnappliedAmt`, `MetaData.*`, `Id` (on create), `SyncToken` (on create) are server-managed.
6. **Idempotency:** pass `?requestid={uuid}` on create POSTs so a retried request is deduped instead of creating a second record.

---

## Create patterns

### Create a customer

```http
POST /v3/company/{realmId}/customer?minorversion=75
Content-Type: application/json
```

```json
{
  "DisplayName": "Acme Corp",
  "CompanyName": "Acme Corporation Ltd",
  "PrimaryEmailAddr": { "Address": "ap@acme.com" },
  "PrimaryPhone": { "FreeFormNumber": "(415) 555-0100" },
  "BillAddr": {
    "Line1": "123 Main St",
    "City": "San Francisco",
    "CountrySubDivisionCode": "CA",
    "PostalCode": "94105"
  }
}
```

> `DisplayName` must be unique per realm → duplicate returns error **6240**. Query first if unsure.

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer

---

### Create a vendor

```http
POST /v3/company/{realmId}/vendor?minorversion=75
```

```json
{
  "DisplayName": "Office Supplies Co",
  "CompanyName": "Office Supplies Co",
  "PrimaryEmailAddr": { "Address": "billing@officesupplies.com" }
}
```

[DOCUMENTED]

---

### Create an item (service)

```http
POST /v3/company/{realmId}/item?minorversion=75
```

```json
{
  "Name": "Consulting Services",
  "Type": "Service",
  "UnitPrice": 50.0,
  "IncomeAccountRef": { "value": "79" }
}
```

For an **inventory** item, you must also supply `ExpenseAccountRef`, `AssetAccountRef`, `TrackQtyOnHand: true`, `QtyOnHand`, and `InvStartDate`:

```json
{
  "Name": "Widget",
  "Type": "Inventory",
  "UnitPrice": 25.0,
  "IncomeAccountRef": { "value": "79" },
  "ExpenseAccountRef": { "value": "80" },
  "AssetAccountRef": { "value": "81" },
  "TrackQtyOnHand": true,
  "QtyOnHand": 100,
  "InvStartDate": "2026-05-29"
}
```

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/item

---

### Create an invoice

**Prerequisites — resolve these ids first (see `01b`):**

- Customer id → `SELECT Id FROM Customer WHERE DisplayName LIKE '...'`
- Item id → `SELECT Id, UnitPrice FROM Item WHERE Name = '...'`

```http
POST /v3/company/{realmId}/invoice?minorversion=75&requestid={uuid}
```

```json
{
  "CustomerRef": { "value": "58" },
  "TxnDate": "2026-05-29",
  "DueDate": "2026-06-28",
  "Line": [
    {
      "Amount": 150.0,
      "DetailType": "SalesItemLineDetail",
      "Description": "Consulting - 3 hours",
      "SalesItemLineDetail": {
        "ItemRef": { "value": "1" },
        "Qty": 3,
        "UnitPrice": 50.0
      }
    }
  ]
}
```

Response carries the assigned `Id`, `DocNumber`, computed `TotalAmt`/`Balance`, and `SyncToken: "0"`.

> `Amount` per line must equal `Qty * UnitPrice` — QBO recomputes and rejects mismatches with a validation Fault.

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice

---

### Create a bill

**Prerequisite:** resolve the vendor id and the expense account id.

```http
POST /v3/company/{realmId}/bill?minorversion=75&requestid={uuid}
```

```json
{
  "VendorRef": { "value": "56" },
  "TxnDate": "2026-05-29",
  "DueDate": "2026-06-28",
  "Line": [
    {
      "Amount": 200.0,
      "DetailType": "AccountBasedExpenseLineDetail",
      "Description": "Monthly software subscription",
      "AccountBasedExpenseLineDetail": {
        "AccountRef": { "value": "63" }
      }
    }
  ]
}
```

For an item-based bill line, use `DetailType: "ItemBasedExpenseLineDetail"` with `ItemBasedExpenseLineDetail.ItemRef` instead.

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/bill

---

### Record a customer payment (apply to invoice)

**Prerequisite:** resolve the customer id and the open invoice id(s) + their balances.

```http
POST /v3/company/{realmId}/payment?minorversion=75&requestid={uuid}
```

```json
{
  "CustomerRef": { "value": "58" },
  "TotalAmt": 150.0,
  "TxnDate": "2026-05-29",
  "DepositToAccountRef": { "value": "35" },
  "Line": [
    {
      "Amount": 150.0,
      "LinkedTxn": [{ "TxnId": "131", "TxnType": "Invoice" }]
    }
  ]
}
```

- Each `Line` applies its `Amount` to one transaction via `LinkedTxn` (`TxnType: "Invoice"`).
- **Partial payment:** set `Line[].Amount` (and `TotalAmt`) below the invoice balance — the invoice moves to partially-paid.
- **Multiple invoices:** add one `Line` per invoice; `TotalAmt` = sum of line amounts.
- Omit `DepositToAccountRef` and the payment lands in Undeposited Funds.
- Linked invoices must belong to the same `CustomerRef`. After success, the invoice `Balance` decreases.

> The vendor-side equivalent (paying a Bill) is a **separate entity**: `POST /billpayment` with `VendorRef` and `Line[].LinkedTxn` of `TxnType: "Bill"`.

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/workflows/manage-linked-transactions

---

## Update patterns

### Sparse update (recommended — patch a few fields)

Change only the fields you send; everything else is preserved.

```http
POST /v3/company/{realmId}/customer?minorversion=75
```

```json
{
  "sparse": true,
  "Id": "58",
  "SyncToken": "1",
  "PrimaryEmailAddr": { "Address": "newemail@acme.com" }
}
```

Steps:

1. `GET /customer/58` (or query) → read the current `SyncToken`.
2. POST with `"sparse": true`, the `Id`, the current `SyncToken`, and only the changed fields.
3. Response returns the full updated entity with an incremented `SyncToken`.

> Forget `"sparse": true` and every field you didn't include gets **cleared**. Forget the current `SyncToken` (or send a stale one) → error **5010**.

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries

---

### Full update (replace the whole object)

Only when you genuinely want to overwrite. Send the **entire** entity (typically a GET result with your edits applied) including `Id` + current `SyncToken`, **without** `"sparse"`:

```http
POST /v3/company/{realmId}/invoice?minorversion=75
```

```json
{
  "Id": "131",
  "SyncToken": "0",
  "CustomerRef": { "value": "58" },
  "TxnDate": "2026-05-29",
  "DueDate": "2026-07-15",
  "Line": [
    {
      "Id": "1",
      "Amount": 150.0,
      "DetailType": "SalesItemLineDetail",
      "SalesItemLineDetail": { "ItemRef": { "value": "1" }, "Qty": 3, "UnitPrice": 50.0 }
    }
  ]
}
```

> For updates that change lines, include each line's existing `Id` to preserve it; omit `Id` to add a new line. Lines absent from a full update are removed.

[DOCUMENTED]

---

### Deactivate (soft delete) a name-list entity

Customers, Vendors, Items have **no hard delete** — deactivate with a sparse update:

```json
{ "sparse": true, "Id": "58", "SyncToken": "2", "Active": false }
```

---

## Destructive operations (HITL-gate these)

> These change the books. Confirm with the user before executing.

### Delete a transaction

```http
POST /v3/company/{realmId}/invoice?operation=delete&minorversion=75
```

```json
{ "Id": "131", "SyncToken": "0" }
```

Works for transaction entities (Invoice, Bill, Payment, …). Returns a deletion confirmation. **Irreversible** — record and SyncToken history are gone.

### Void an invoice

```http
POST /v3/company/{realmId}/invoice?operation=void&minorversion=75
```

```json
{ "Id": "131", "SyncToken": "0" }
```

Sets `TotalAmt` → 0 but **retains the lines** and the audit trail (status Voided). Prefer void over delete when you need to keep a record.

### Send an invoice by email

```http
POST /v3/company/{realmId}/invoice/131/send?sendTo=customer@example.com&minorversion=75
```

Sets `EmailStatus` to `EmailSent`. Omit `sendTo` to use the customer's `PrimaryEmailAddr`.

[DOCUMENTED]

---

## Batch mutations (≤30 ops, one round trip)

```http
POST /v3/company/{realmId}/batch?minorversion=75
```

```json
{
  "BatchItemRequest": [
    {
      "bId": "1",
      "operation": "create",
      "Invoice": {
        "CustomerRef": { "value": "58" },
        "Line": [
          /* ... */
        ]
      }
    },
    {
      "bId": "2",
      "operation": "update",
      "Customer": { "sparse": true, "Id": "58", "SyncToken": "2", "Active": false }
    },
    {
      "bId": "3",
      "Query": "SELECT * FROM Item WHERE Active = true MAXRESULTS 50"
    }
  ]
}
```

- Up to **30** items per call; mixed create/update/delete/query allowed.
- **Partial success:** each `BatchItemResponse` carries either the entity or a `Fault`; reconcile by `bId`.
- Batch endpoint throttle: **120 req/min/realm** (raised from 40 on 2025-10-31).

[DOCUMENTED]

---

## Dangerous operations summary

| Operation                                  | Risk                                       | Mitigation                                           |
| ------------------------------------------ | ------------------------------------------ | ---------------------------------------------------- |
| `?operation=delete` on a transaction       | Permanent, irreversible; affects the books | HITL-gate; prefer void; confirm the id + realm       |
| Plain (non-sparse) update                  | Silently clears every omitted field        | Use `"sparse": true` unless full replace is intended |
| Update with stale `SyncToken`              | Error 5010, no write                       | GET fresh entity, copy `SyncToken`, retry once       |
| Create with duplicate `DisplayName`/`Name` | Error 6240                                 | Query for existing record before create              |
| Bulk financial mutation via `/batch`       | Audit/rate-limit risk at scale             | Keep batches small and reviewed                      |

---

## Common write-error scenarios

| Code | HTTP | Cause                          | Fix                                           |
| ---- | ---- | ------------------------------ | --------------------------------------------- |
| 5010 | 400  | Stale `SyncToken`              | Re-GET entity, retry with fresh token         |
| 6240 | 400  | Duplicate `DisplayName`/`Name` | Use a unique name; query for the existing one |
| 2010 | 400  | Required field missing         | Add the missing field                         |
| 610  | 400  | Referenced object not found    | Verify the `*Ref.value` id exists in realm    |
| 4001 | 400  | Invalid request / parse error  | Fix the JSON / detail type                    |

Full Fault envelope + catalogue in `01d-event-and-error-handling.md`.
