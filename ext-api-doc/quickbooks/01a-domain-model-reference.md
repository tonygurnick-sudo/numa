# Domain Model Reference — QuickBooks Online Accounting API (v3)

> Source: Intuit official entity reference (developer.intuit.com/app/developer/qbo/docs/api/accounting), webhooks/CDC docs, `python-quickbooks` SDK, apideck integration guide.
> Field names are `[DOCUMENTED]` from Intuit docs unless marked otherwise. No `[CONFIRMED]` live calls — verify exact response wrappers against a sandbox before treating as ground truth.

---

## The realm — top-level container

Every entity lives inside a **company (realm)**. All calls target one realm via the `{realmId}` path segment.

| Field     | Type                | Notes                                                                                                                                                                            |
| --------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `realmId` | long numeric string | Company id, e.g. `4620816365212402417`. Captured from the OAuth callback (`?...&realmId=`), **persisted per company**, templated into every path. One authorization = one realm. |

`GET /companyinfo/{realmId}` returns realm metadata (`CompanyName`, `Country`, `LegalName`, base currency). Good smoke test.
[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/companyinfo

---

## Shared envelope — every entity

All entities share the same id/lock/metadata envelope:

| Field                      | Type           | Writable? | Notes                                                                                                                       |
| -------------------------- | -------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Id`                       | numeric string | no        | Unique within the realm. Always a string in JSON.                                                                           |
| `SyncToken`                | numeric string | no (sent) | Optimistic-lock version. Send the **current** value on every update; increments each successful update. Stale → error 5010. |
| `MetaData.CreateTime`      | datetime       | no        | ISO 8601 with offset, e.g. `2026-05-20T09:00:00-07:00`                                                                      |
| `MetaData.LastUpdatedTime` | datetime       | no        | Change-detection field for incremental sync                                                                                 |
| `sparse` (request only)    | boolean        | yes (req) | Set `true` on update to patch only the supplied fields                                                                      |

**Relationships are `*Ref` objects, never nested entities:**

```json
"CustomerRef": { "value": "58", "name": "Amy's Bird Sanctuary" }
```

Only `value` (the foreign id) matters on write; `name` is decorative/echoed back. Resolve the id by querying before you write.

---

## Entity Catalogue

### Customer

**Endpoint:** `/customer` · name-list entity (someone you invoice).
**CRUD:** Create / Read / Update (full + sparse). **No hard delete** — deactivate via sparse `Active: false`.

| Field                      | Type    | Required?   | Writable? | Notes                                                   |
| -------------------------- | ------- | ----------- | --------- | ------------------------------------------------------- |
| `Id`                       | string  | system      | no        | `"58"`                                                  |
| `SyncToken`                | string  | for update  | no (sent) |                                                         |
| `DisplayName`              | string  | conditional | yes       | **Unique per realm**. One name field required.          |
| `GivenName` / `FamilyName` | string  | no          | yes       | Person name parts                                       |
| `CompanyName`              | string  | no          | yes       | Business name                                           |
| `PrimaryEmailAddr`         | object  | no          | yes       | `{ "Address": "amy@birds.com" }`                        |
| `PrimaryPhone`             | object  | no          | yes       | `{ "FreeFormNumber": "(650) 555-1234" }`                |
| `BillAddr` / `ShipAddr`    | object  | no          | yes       | `Line1`, `City`, `CountrySubDivisionCode`, `PostalCode` |
| `Balance`                  | decimal | system      | no        | Open balance (computed)                                 |
| `Active`                   | boolean | no          | yes       | `false` = deactivated                                   |

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer

---

### Vendor

**Endpoint:** `/vendor` · the supplier side of Customer. Referenced by Bills.
**CRUD:** Create / Read / Update (full + sparse); deactivate via `Active: false`.

| Field                               | Type    | Required?   | Writable? | Notes                         |
| ----------------------------------- | ------- | ----------- | --------- | ----------------------------- |
| `Id`                                | string  | system      | no        | Use in `Bill.VendorRef.value` |
| `SyncToken`                         | string  | for update  | no (sent) |                               |
| `DisplayName`                       | string  | conditional | yes       | Unique per realm              |
| `CompanyName`                       | string  | no          | yes       |                               |
| `PrimaryEmailAddr` / `PrimaryPhone` | object  | no          | yes       |                               |
| `Balance`                           | decimal | system      | no        | Amount owed to this vendor    |
| `Active`                            | boolean | no          | yes       |                               |

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/vendor

---

### Item

**Endpoint:** `/item` · a product/service line on invoices and bills.
**CRUD:** Create / Read / Update (full + sparse); deactivate via `Active: false`.

| Field               | Type    | Required?  | Writable?   | Notes                                                                 |
| ------------------- | ------- | ---------- | ----------- | --------------------------------------------------------------------- |
| `Id`                | string  | system     | no          | Use in line `ItemRef.value`                                           |
| `SyncToken`         | string  | for update | no (sent)   |                                                                       |
| `Name`              | string  | yes        | yes         | **Unique per realm**                                                  |
| `Type`              | enum    | yes        | yes(create) | `Inventory \| Service \| NonInventory \| Group \| Category \| Bundle` |
| `UnitPrice`         | decimal | no         | yes         | Sales price                                                           |
| `IncomeAccountRef`  | Ref     | cond.      | yes         | Required for Service / Inventory                                      |
| `ExpenseAccountRef` | Ref     | cond.      | yes         | Required for Inventory                                                |
| `AssetAccountRef`   | Ref     | cond.      | yes         | Required for Inventory                                                |
| `TrackQtyOnHand`    | boolean | cond.      | yes(create) | `true` for Inventory                                                  |
| `QtyOnHand`         | decimal | cond.      | yes(create) | Inventory only; needs `InvStartDate`                                  |
| `Active`            | boolean | no         | yes         |                                                                       |

> Inventory items require `IncomeAccountRef` + `ExpenseAccountRef` + `AssetAccountRef` + `TrackQtyOnHand: true` + `InvStartDate`. Service items only need `IncomeAccountRef`.

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/item

---

### Account (Chart of Accounts)

**Endpoint:** `/account` · referenced by Items and account-based lines.
**CRUD:** Create / Read / Update (full + sparse).

| Field            | Type    | Writable? | Notes                                                                                           |
| ---------------- | ------- | --------- | ----------------------------------------------------------------------------------------------- |
| `Id`             | string  | no        | Use in `IncomeAccountRef` / `ExpenseAccountRef` / `DepositToAccountRef`                         |
| `Name`           | string  | yes       | **Unique per realm**                                                                            |
| `AccountType`    | enum    | yes       | `Income`, `Expense`, `Bank`, `Accounts Receivable`, `Accounts Payable`, `Cost of Goods Sold`, … |
| `AccountSubType` | string  | yes       | e.g. `SalesOfProductIncome`, `CheckingAccount`                                                  |
| `CurrentBalance` | decimal | no        | Computed                                                                                        |
| `Active`         | boolean | yes       |                                                                                                 |

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account

---

### Invoice (sales / A/R)

**Endpoint:** `/invoice` · sales transaction. References a `CustomerRef` and ≥1 `Line`.
**CRUD:** Create / Read / Update (full + sparse) / Delete (`?operation=delete`) / Void (`?operation=void`) / send-PDF / get-PDF.

| Field         | Type    | Required?  | Writable? | Notes                                        |
| ------------- | ------- | ---------- | --------- | -------------------------------------------- |
| `Id`          | string  | system     | no        | `"130"`                                      |
| `SyncToken`   | string  | for update | no (sent) |                                              |
| `CustomerRef` | Ref     | yes        | yes       | `{ "value": "58" }`                          |
| `Line`        | array   | yes        | yes       | See "Invoice line" below                     |
| `DocNumber`   | string  | no         | yes       | Invoice number (auto-assigned if omitted)    |
| `TxnDate`     | date    | no         | yes       | `YYYY-MM-DD`                                 |
| `DueDate`     | date    | no         | yes       | `YYYY-MM-DD`                                 |
| `TotalAmt`    | decimal | system     | no        | Computed                                     |
| `Balance`     | decimal | system     | no        | Outstanding; 0 once fully paid               |
| `EmailStatus` | enum    | no         | yes       | `NotSet \| NeedToSend \| EmailSent`          |
| `LinkedTxn`   | array   | system     | no        | Payments/CreditMemos applied to this invoice |

**Invoice line (`DetailType: "SalesItemLineDetail"`):**

```json
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
```

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice

---

### Bill (purchase / A/P)

**Endpoint:** `/bill` · amount owed to a vendor. References `VendorRef` + ≥1 `Line`.
**CRUD:** Create / Read / Update (full + sparse) / Delete (`?operation=delete`).

| Field       | Type    | Required?  | Writable? | Notes                                                           |
| ----------- | ------- | ---------- | --------- | --------------------------------------------------------------- |
| `Id`        | string  | system     | no        | `"890"`                                                         |
| `SyncToken` | string  | for update | no (sent) |                                                                 |
| `VendorRef` | Ref     | yes        | yes       | `{ "value": "56" }`                                             |
| `Line`      | array   | yes        | yes       | `AccountBasedExpenseLineDetail` or `ItemBasedExpenseLineDetail` |
| `TxnDate`   | date    | no         | yes       | Bill date                                                       |
| `DueDate`   | date    | no         | yes       |                                                                 |
| `TotalAmt`  | decimal | system     | no        | Computed                                                        |
| `Balance`   | decimal | system     | no        | Outstanding                                                     |

**Bill line (account-based, `DetailType: "AccountBasedExpenseLineDetail"`):**

```json
{
  "Amount": 200.0,
  "DetailType": "AccountBasedExpenseLineDetail",
  "AccountBasedExpenseLineDetail": { "AccountRef": { "value": "63" } }
}
```

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/bill

---

### Payment (customer payment received / A/R)

**Endpoint:** `/payment` · money received from a customer, applied to one or more invoices via `Line[].LinkedTxn`.
**CRUD:** Create / Read / Update (full + sparse) / Delete / Void.

> The **vendor-side** payment of a Bill is a separate entity: `/billpayment`. Don't confuse the two.

| Field                 | Type    | Required?  | Writable? | Notes                                          |
| --------------------- | ------- | ---------- | --------- | ---------------------------------------------- |
| `Id`                  | string  | system     | no        | `"123"`                                        |
| `SyncToken`           | string  | for update | no (sent) |                                                |
| `CustomerRef`         | Ref     | yes        | yes       | The paying customer                            |
| `TotalAmt`            | decimal | yes        | yes       | Payment amount                                 |
| `Line`                | array   | no         | yes       | Apply to invoices via `LinkedTxn`              |
| `DepositToAccountRef` | Ref     | no         | yes       | Account funds land in (else Undeposited Funds) |
| `TxnDate`             | date    | no         | yes       | Payment date                                   |
| `UnappliedAmt`        | decimal | system     | no        | Portion not yet applied to any invoice         |

**Payment apply-to-invoice line:**

```json
{
  "Amount": 150.0,
  "LinkedTxn": [{ "TxnId": "131", "TxnType": "Invoice" }]
}
```

Each `Line` applies its `Amount` to one transaction. Partial payment = `Amount` < invoice balance. Linked invoices must belong to the same `CustomerRef`.
[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/payment

---

## Entity Relationships

```
┌──────────┐   CustomerRef    ┌──────────┐   LinkedTxn(Invoice)   ┌───────────┐
│ Customer │◄─────────────────│ Invoice  │◄───────────────────────│  Payment  │
└──────────┘                  └────┬─────┘                        └─────┬─────┘
     ▲ (name list)                 │ Line[].ItemRef                     │ DepositToAccountRef
                                   ▼                                    ▼
┌──────────┐   VendorRef     ┌──────────┐   Line[].ItemRef       ┌───────────┐
│  Vendor  │◄────────────────│   Bill   │───────────────────────►│   Item    │
└──────────┘                 └────┬─────┘                        └─────┬─────┘
                                  │ Line[].AccountRef       Income/Expense/AssetAccountRef
                                  ▼                                    ▼
                            ┌───────────────────────────────────────────────┐
                            │          Account (chart of accounts)           │
                            └───────────────────────────────────────────────┘
```

- All edges are `*Ref` objects (`{"value":"<Id>"}`). No nesting of full child entities.
- A Payment links to 1..n Invoices through `Line[].LinkedTxn` with `TxnType: "Invoice"`.
- Referenced Customer / Vendor / Item / Account must exist **before** you reference them. No inline creation.

[DOCUMENTED]

---

## State Machines

### Invoice paid-state (derived, not an explicit field)

```
[open: Balance == TotalAmt] --record Payment (partial)--> [partially paid: 0 < Balance < TotalAmt]
                            --record Payment (full)------> [paid: Balance == 0]
[any]  --void (?operation=void)--> [voided: TotalAmt → 0, lines retained]
[any]  --delete (?operation=delete)--> [removed]
```

| From State | Action                | To State       | Reversible?          | Side Effects                                   |
| ---------- | --------------------- | -------------- | -------------------- | ---------------------------------------------- |
| open       | create Payment + link | partial / paid | yes (delete Payment) | Invoice `Balance` decreases; `LinkedTxn` added |
| open/paid  | void                  | voided         | no (delete only)     | `TotalAmt`→0, lines retained                   |
| any        | delete                | removed        | no                   | Record gone; SyncToken history lost            |

> QBO has **no single "status" enum** for paid/unpaid on Invoice — derive it from `Balance` vs `TotalAmt`. `EmailStatus` is separate (`NotSet \| NeedToSend \| EmailSent`).
> [DOCUMENTED]/[INFERRED]

### Bill paid-state

Same pattern, but via `/billpayment` rather than `/payment`. `Balance == 0` ⇒ fully paid.

---

## Business Rules

1. **Uniqueness:** `Customer.DisplayName`, `Vendor.DisplayName`, `Item.Name`, `Account.Name` are each unique per realm. Duplicate → error **6240**.
2. **Ordering:** Create Customer/Vendor/Item/Account before referencing them. Cannot create inline inside a transaction.
3. **Payment linkage:** A Payment can only link to existing Invoice ids belonging to the same `CustomerRef`.
4. **Inventory items** need income + expense + asset account refs, `TrackQtyOnHand: true`, and `InvStartDate`.
5. **Multicurrency:** `CurrencyRef` is only settable when multicurrency is enabled on the realm; otherwise transaction currency must match company currency.
6. **Computed/read-only:** `Balance`, `TotalAmt`, `UnappliedAmt`, `MetaData.*`, `Id`, `SyncToken` — never send as intent; ignored on create.

[DOCUMENTED]

---

## Field Format Reference

| Type     | Format                            | Example                     | Notes                                             |
| -------- | --------------------------------- | --------------------------- | ------------------------------------------------- |
| Date     | `YYYY-MM-DD`                      | `2026-05-29`                | `TxnDate`, `DueDate`                              |
| DateTime | `YYYY-MM-DDThh:mm:ss±hh:mm`       | `2026-05-20T09:00:00-07:00` | `MetaData.*`, CDC / query filters                 |
| Currency | decimal, no symbol                | `150.00`                    | `CurrencyRef` separate; amounts are plain numbers |
| Phone    | free-form string                  | `(650) 555-1234`            | `{ "FreeFormNumber": "..." }`                     |
| Email    | string                            | `amy@birds.com`             | `{ "Address": "..." }`                            |
| Id       | numeric string (per realm)        | `"58"`                      | Always a string in JSON                           |
| realmId  | long numeric string               | `4620816365212402417`       | Company id; in the URL path, from OAuth callback  |
| Ref      | `{"value":"<id>","name":"<opt>"}` | `{"value":"58"}`            | Foreign-key reference                             |

---

## Enum Value Reference

| Entity  | Field                 | Allowed Values                                                                                                                   |
| ------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Invoice | `EmailStatus`         | `NotSet`, `NeedToSend`, `EmailSent`                                                                                              |
| Item    | `Type`                | `Inventory`, `Service`, `NonInventory`, `Group`, `Category`, `Bundle`                                                            |
| Line    | `DetailType`          | `SalesItemLineDetail`, `AccountBasedExpenseLineDetail`, `ItemBasedExpenseLineDetail`, `SubTotalLineDetail`, `DiscountLineDetail` |
| Payment | `LinkedTxn[].TxnType` | `Invoice`, `CreditMemo`, `Deposit`                                                                                               |
| Account | `AccountType`         | `Income`, `Expense`, `Bank`, `Accounts Receivable`, `Accounts Payable`, `Cost of Goods Sold`, `Other Income`, `Other Expense`, … |

[DOCUMENTED]
