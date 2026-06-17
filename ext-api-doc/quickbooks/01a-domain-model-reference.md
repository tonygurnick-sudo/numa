---
doc: domain-model-reference
api: QuickBooks Online Accounting API v3
confidence: all [DOCUMENTED] from Intuit per-entity reference + python-quickbooks SDK + apideck guide; NO live calls — verify exact response wrappers/edge fields against sandbox. Non-default markers tagged [INFERRED] inline.
ref: developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/<entity>
---

# Domain Model Reference — QuickBooks Online (v3)

## The realm (top-level container)

Every entity lives inside one **company (realm)**; all calls target it via the `{realmId}` path segment.

`realmId` — long numeric string company id (e.g. `4620816365212402417`). Captured from OAuth callback (`?...&realmId=`), persisted per company, templated into every path. One authorization = one realm. `GET /companyinfo/{realmId}` → realm metadata (`CompanyName`, `Country`, `LegalName`, base currency); good smoke test.

## Shared envelope (every entity)

| Field                      | Type           | Writable?           | Notes                                                                                             |
| -------------------------- | -------------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| `Id`                       | numeric string | no                  | Unique within realm; always a string in JSON                                                      |
| `SyncToken`                | numeric string | no (sent on update) | Optimistic-lock version; send CURRENT value on update; increments per success. Stale → error 5010 |
| `MetaData.CreateTime`      | datetime       | no                  | ISO8601 + offset, e.g. `2026-05-20T09:00:00-07:00`                                                |
| `MetaData.LastUpdatedTime` | datetime       | no                  | Change-detection field for incremental sync                                                       |
| `sparse` (request only)    | boolean        | yes (req)           | `true` on update → patch only supplied fields                                                     |

**Relationships are `*Ref` objects, never nested entities:** `"CustomerRef":{"value":"58","name":"Amy's Bird Sanctuary"}`. Only `value` (foreign id) matters on write; `name` is decorative/echoed. Resolve the id by querying before you write.

## Entity Catalogue

### Customer — `/customer` (name-list; someone you invoice)

CRUD: Create / Read / Update (full+sparse). No hard delete — deactivate via sparse `Active:false`.

| Field                    | Type    | Required?   | Writable? | Notes                                                |
| ------------------------ | ------- | ----------- | --------- | ---------------------------------------------------- |
| `Id`                     | string  | system      | no        | `"58"`                                               |
| `SyncToken`              | string  | for update  | no (sent) |                                                      |
| `DisplayName`            | string  | conditional | yes       | **Unique per realm**; one name field required        |
| `GivenName`/`FamilyName` | string  | no          | yes       | Person name parts                                    |
| `CompanyName`            | string  | no          | yes       | Business name                                        |
| `PrimaryEmailAddr`       | object  | no          | yes       | `{"Address":"amy@birds.com"}`                        |
| `PrimaryPhone`           | object  | no          | yes       | `{"FreeFormNumber":"(650) 555-1234"}`                |
| `BillAddr`/`ShipAddr`    | object  | no          | yes       | `Line1`,`City`,`CountrySubDivisionCode`,`PostalCode` |
| `Balance`                | decimal | system      | no        | Open balance (computed)                              |
| `Active`                 | boolean | no          | yes       | `false`=deactivated                                  |

### Vendor — `/vendor` (supplier side of Customer; referenced by Bills)

CRUD: Create / Read / Update (full+sparse); deactivate via `Active:false`.

| Field                             | Type    | Required?   | Writable? | Notes                         |
| --------------------------------- | ------- | ----------- | --------- | ----------------------------- |
| `Id`                              | string  | system      | no        | Use in `Bill.VendorRef.value` |
| `SyncToken`                       | string  | for update  | no (sent) |                               |
| `DisplayName`                     | string  | conditional | yes       | Unique per realm              |
| `CompanyName`                     | string  | no          | yes       |                               |
| `PrimaryEmailAddr`/`PrimaryPhone` | object  | no          | yes       |                               |
| `Balance`                         | decimal | system      | no        | Amount owed to this vendor    |
| `Active`                          | boolean | no          | yes       |                               |

### Item — `/item` (product/service line on invoices+bills)

CRUD: Create / Read / Update (full+sparse); deactivate via `Active:false`.

| Field               | Type    | Required?  | Writable?   | Notes                                                                 |
| ------------------- | ------- | ---------- | ----------- | --------------------------------------------------------------------- |
| `Id`                | string  | system     | no          | Use in line `ItemRef.value`                                           |
| `SyncToken`         | string  | for update | no (sent)   |                                                                       |
| `Name`              | string  | yes        | yes         | **Unique per realm**                                                  |
| `Type`              | enum    | yes        | yes(create) | `Inventory \| Service \| NonInventory \| Group \| Category \| Bundle` |
| `UnitPrice`         | decimal | no         | yes         | Sales price                                                           |
| `IncomeAccountRef`  | Ref     | cond.      | yes         | Required for Service/Inventory                                        |
| `ExpenseAccountRef` | Ref     | cond.      | yes         | Required for Inventory                                                |
| `AssetAccountRef`   | Ref     | cond.      | yes         | Required for Inventory                                                |
| `TrackQtyOnHand`    | boolean | cond.      | yes(create) | `true` for Inventory                                                  |
| `QtyOnHand`         | decimal | cond.      | yes(create) | Inventory only; needs `InvStartDate`                                  |
| `Active`            | boolean | no         | yes         |                                                                       |

Inventory item requires: `IncomeAccountRef` + `ExpenseAccountRef` + `AssetAccountRef` + `TrackQtyOnHand:true` + `InvStartDate`. Service item needs only `IncomeAccountRef`.

### Account (Chart of Accounts) — `/account` (referenced by Items + account-based lines)

CRUD: Create / Read / Update (full+sparse).

| Field            | Type    | Writable? | Notes                                                                                     |
| ---------------- | ------- | --------- | ----------------------------------------------------------------------------------------- |
| `Id`             | string  | no        | Use in `IncomeAccountRef`/`ExpenseAccountRef`/`DepositToAccountRef`                       |
| `Name`           | string  | yes       | **Unique per realm**                                                                      |
| `AccountType`    | enum    | yes       | `Income`,`Expense`,`Bank`,`Accounts Receivable`,`Accounts Payable`,`Cost of Goods Sold`,… |
| `AccountSubType` | string  | yes       | e.g. `SalesOfProductIncome`,`CheckingAccount`                                             |
| `CurrentBalance` | decimal | no        | Computed                                                                                  |
| `Active`         | boolean | yes       |                                                                                           |

### Invoice — `/invoice` (sales / A/R; references `CustomerRef` + ≥1 `Line`)

CRUD: Create / Read / Update (full+sparse) / Delete (`?operation=delete`) / Void (`?operation=void`) / send / get-PDF.

| Field         | Type    | Required?  | Writable? | Notes                               |
| ------------- | ------- | ---------- | --------- | ----------------------------------- |
| `Id`          | string  | system     | no        | `"130"`                             |
| `SyncToken`   | string  | for update | no (sent) |                                     |
| `CustomerRef` | Ref     | yes        | yes       | `{"value":"58"}`                    |
| `Line`        | array   | yes        | yes       | see Invoice line below              |
| `DocNumber`   | string  | no         | yes       | Invoice number (auto if omitted)    |
| `TxnDate`     | date    | no         | yes       | `YYYY-MM-DD`                        |
| `DueDate`     | date    | no         | yes       | `YYYY-MM-DD`                        |
| `TotalAmt`    | decimal | system     | no        | Computed                            |
| `Balance`     | decimal | system     | no        | Outstanding; 0 once fully paid      |
| `EmailStatus` | enum    | no         | yes       | `NotSet \| NeedToSend \| EmailSent` |
| `LinkedTxn`   | array   | system     | no        | Payments/CreditMemos applied        |

Invoice line (`DetailType:"SalesItemLineDetail"`): `{"Amount":150.00,"DetailType":"SalesItemLineDetail","Description":"Consulting - 3 hours","SalesItemLineDetail":{"ItemRef":{"value":"1"},"Qty":3,"UnitPrice":50.00}}`

### Bill — `/bill` (purchase / A/P; references `VendorRef` + ≥1 `Line`)

CRUD: Create / Read / Update (full+sparse) / Delete (`?operation=delete`).

| Field       | Type    | Required?  | Writable? | Notes                                                           |
| ----------- | ------- | ---------- | --------- | --------------------------------------------------------------- |
| `Id`        | string  | system     | no        | `"890"`                                                         |
| `SyncToken` | string  | for update | no (sent) |                                                                 |
| `VendorRef` | Ref     | yes        | yes       | `{"value":"56"}`                                                |
| `Line`      | array   | yes        | yes       | `AccountBasedExpenseLineDetail` or `ItemBasedExpenseLineDetail` |
| `TxnDate`   | date    | no         | yes       | Bill date                                                       |
| `DueDate`   | date    | no         | yes       |                                                                 |
| `TotalAmt`  | decimal | system     | no        | Computed                                                        |
| `Balance`   | decimal | system     | no        | Outstanding                                                     |

Bill line (account-based): `{"Amount":200.00,"DetailType":"AccountBasedExpenseLineDetail","AccountBasedExpenseLineDetail":{"AccountRef":{"value":"63"}}}`

### Payment — `/payment` (customer payment received / A/R; applied to invoices via `Line[].LinkedTxn`)

CRUD: Create / Read / Update (full+sparse) / Delete / Void. **Vendor-side payment of a Bill is a separate entity `/billpayment` — don't confuse the two.**

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

Apply-to-invoice line: `{"Amount":150.00,"LinkedTxn":[{"TxnId":"131","TxnType":"Invoice"}]}`. Each `Line` applies its `Amount` to one txn; partial = `Amount` < invoice balance. Linked invoices must belong to the same `CustomerRef`.

## Entity Relationships

```
Customer ◄─CustomerRef─ Invoice ◄─LinkedTxn(Invoice)─ Payment ─DepositToAccountRef─► Account
Vendor   ◄─VendorRef─── Bill    ─Line[].ItemRef─► Item ─Income/Expense/AssetAccountRef─► Account
Bill ─Line[].AccountRef─► Account ; Invoice ─Line[].ItemRef─► Item
```

- All edges are `*Ref` objects (`{"value":"<Id>"}`); no nesting of full child entities.
- A Payment links to 1..n Invoices via `Line[].LinkedTxn` with `TxnType:"Invoice"`.
- Referenced Customer/Vendor/Item/Account must exist BEFORE you reference them. No inline creation.

## State Machines

### Invoice paid-state (derived, not an explicit field)

- open (`Balance==TotalAmt`) → partial (`0<Balance<TotalAmt`) → paid (`Balance==0`) via Payment+link.
- any → voided (`?operation=void`): `TotalAmt`→0, lines retained, audit kept; reversible only by delete.
- any → removed (`?operation=delete`): record gone, SyncToken history lost; irreversible.

QBO has NO single "status" enum for paid/unpaid on Invoice — derive from `Balance` vs `TotalAmt`. `EmailStatus` is separate (`NotSet|NeedToSend|EmailSent`). [INFERRED on exact transition shapes]

### Bill paid-state

Same pattern but via `/billpayment` (not `/payment`). `Balance==0` ⇒ fully paid.

## Business Rules

1. **Uniqueness:** `Customer.DisplayName`, `Vendor.DisplayName`, `Item.Name`, `Account.Name` each unique per realm. Duplicate → error **6240**.
2. **Ordering:** create Customer/Vendor/Item/Account before referencing; no inline creation inside a transaction.
3. **Payment linkage:** a Payment links only to existing Invoice ids of the same `CustomerRef`.
4. **Inventory items** need income+expense+asset account refs, `TrackQtyOnHand:true`, `InvStartDate`.
5. **Multicurrency:** `CurrencyRef` settable only when multicurrency enabled on the realm; else txn currency must match company currency.
6. **Computed/read-only** (ignored on create, never send as intent): `Balance`, `TotalAmt`, `UnappliedAmt`, `MetaData.*`, `Id`, `SyncToken`.

## Field Formats

| Type     | Format                            | Example                     | Notes                                            |
| -------- | --------------------------------- | --------------------------- | ------------------------------------------------ |
| Date     | `YYYY-MM-DD`                      | `2026-05-29`                | `TxnDate`,`DueDate`                              |
| DateTime | `YYYY-MM-DDThh:mm:ss±hh:mm`       | `2026-05-20T09:00:00-07:00` | `MetaData.*`, CDC/query filters; realm-tz offset |
| Currency | decimal, no symbol                | `150.00`                    | `CurrencyRef` separate                           |
| Phone    | free-form string                  | `(650) 555-1234`            | `{"FreeFormNumber":"…"}`                         |
| Email    | string                            | `amy@birds.com`             | `{"Address":"…"}`                                |
| Id       | numeric string (per realm)        | `"58"`                      | always a string in JSON                          |
| realmId  | long numeric string               | `4620816365212402417`       | company id; in URL path, from OAuth callback     |
| Ref      | `{"value":"<id>","name":"<opt>"}` | `{"value":"58"}`            | foreign key                                      |

## Enum Reference

| Entity  | Field                 | Allowed Values                                                                                                                   |
| ------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Invoice | `EmailStatus`         | `NotSet`, `NeedToSend`, `EmailSent`                                                                                              |
| Item    | `Type`                | `Inventory`, `Service`, `NonInventory`, `Group`, `Category`, `Bundle`                                                            |
| Line    | `DetailType`          | `SalesItemLineDetail`, `AccountBasedExpenseLineDetail`, `ItemBasedExpenseLineDetail`, `SubTotalLineDetail`, `DiscountLineDetail` |
| Payment | `LinkedTxn[].TxnType` | `Invoice`, `CreditMemo`, `Deposit`                                                                                               |
| Account | `AccountType`         | `Income`, `Expense`, `Bank`, `Accounts Receivable`, `Accounts Payable`, `Cost of Goods Sold`, `Other Income`, `Other Expense`, … |
