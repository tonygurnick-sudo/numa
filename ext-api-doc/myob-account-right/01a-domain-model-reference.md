---
doc: domain-model-reference — MYOB AccountRight (MYOB Business API v2)
sources: official error-messages doc, scopes doc, retrieving-data doc, pymyob SDK, apideck integration guide
confidence: entity fields are [INFERRED] (from pymyob SDK + apideck guide, not live-confirmed — verify against sandbox) UNLESS tagged [DOCUMENTED]
refs: pymyob=https://github.com/uptick/pymyob · apideck=https://www.apideck.com/blog/how-to-integrate-with-the-myob-api · retrieving-data=https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/ · errors=https://developer.myob.com/api/myob-business-api/api-overview/error-messages/ · rules-section=https://apisupport.myob.com/hc/en-us/sections/360000104856
---

# Domain Model Reference — MYOB AccountRight

## Entity Catalogue

### Company File [DOCUMENTED https://developer.myob.com/api/myob-business-api/api-overview/getting-started/]

Top-level container. All calls target one company file via `businessId`.
| Field | Type | Notes |
| --- | --- | --- |
| `businessId` | GUID | Primary identifier — from OAuth redirect URI |
| `UIAccessFlags` | int | 0=Local AccountRight; 2=Essentials; 3=AccountRight/Browser |
| Company Name | string | returned as `businessName` in OAuth redirect |

### Customer — `/Contact/Customer` · scope `sme-contacts-customer`

| Field                  | Type     | Notes                                                                      |
| ---------------------- | -------- | -------------------------------------------------------------------------- |
| `UID`                  | GUID     | use in invoice `Customer.UID`                                              |
| `DisplayID`            | string   | e.g. "CUS0001"                                                             |
| `CompanyName`          | string   |                                                                            |
| `FirstName`/`LastName` | string   | individual name                                                            |
| `IsActive`             | bool     |                                                                            |
| `Addresses`            | array    | objects with `Email`,`Phone1`,`Street`,`City`,`State`,`PostCode`,`Country` |
| `EmailAddress`         | string   | primary email                                                              |
| `LastModified`         | datetime | incremental sync                                                           |
| `RowVersion`           | string   | required for PUT (optimistic concurrency)                                  |

### Supplier — `/Contact/Supplier` · scope `sme-contacts-supplier`

Like Customer; key fields: `UID` (use in bill `Supplier.UID`), `DisplayID` (e.g. "SUP0001"), `CompanyName`, `ABN` (Australian Business Number), `IsActive`, `LastModified`, `RowVersion` (req for PUT).

### Employee — `/Contact/Employee` · scope `sme-contacts-employee`

`UID`, `DisplayID` (e.g. "EMP0001"), `FirstName`, `LastName`, `IsActive`, `LastModified`, `RowVersion` (req for PUT).

### Account (Chart of Accounts) — `/GeneralLedger/Account` · scope `sme-general-ledger` [DOCUMENTED retrieving-data]

| Field            | Type     | Notes                                                                                      |
| ---------------- | -------- | ------------------------------------------------------------------------------------------ |
| `UID`            | GUID     | use in line item `Account.UID`                                                             |
| `Number`         | string   | e.g. "4-1000"                                                                              |
| `DisplayID`      | string   | formatted account number                                                                   |
| `Name`           | string   |                                                                                            |
| `Type`           | string   | `Asset`,`Liability`,`Equity`,`Income`,`CostOfSales`,`Expense`,`OtherIncome`,`OtherExpense` |
| `Classification` | string   | broad classification                                                                       |
| `IsActive`       | bool     |                                                                                            |
| `LastModified`   | datetime |                                                                                            |
| `RowVersion`     | string   |                                                                                            |

### TaxCode — `/GeneralLedger/TaxCode` · scope `sme-general-ledger`

| Field         | Type    | Notes                          |
| ------------- | ------- | ------------------------------ |
| `UID`         | GUID    | use in line item `TaxCode.UID` |
| `Code`        | string  | e.g. `GST`,`FRE`,`N-T`         |
| `Description` | string  |                                |
| `Rate`        | decimal | e.g. 0.1 for 10%               |
| `Type`        | string  | tax type                       |

Common AU codes: `GST` (10%), `FRE` (GST Free), `N-T` (Not Reportable), `INP` (Input Taxed).

### Inventory Item — `/Inventory/Item` · scope `sme-inventory`

| Field                        | Type     | Notes                          |
| ---------------------------- | -------- | ------------------------------ |
| `UID`                        | GUID     | use in invoice line `Item.UID` |
| `Number`                     | string   | item number                    |
| `Name`                       | string   | item name/description          |
| `IsActive`                   | bool     |                                |
| `SellingPrice`/`BuyingPrice` | decimal  | defaults                       |
| `IsSold`/`IsBought`          | bool     |                                |
| `LastModified`               | datetime |                                |
| `RowVersion`                 | string   |                                |

### Invoice / Item (Sales) — `/Sale/Invoice/Item` · scope `sme-sales`

| Field            | Type        | Notes                                              |
| ---------------- | ----------- | -------------------------------------------------- |
| `UID`            | GUID        |                                                    |
| `Number`         | string      | invoice number                                     |
| `Date`           | date string | ISO format                                         |
| `Status`         | string      | `Open`,`Closed`,`CreditNote`                       |
| `Customer`       | object      | `{"UID":"..."}` — must reference existing customer |
| `Lines`          | array       | line items (below)                                 |
| `TotalAmount`    | decimal     | total inc. tax                                     |
| `TotalTax`       | decimal     | tax amount                                         |
| `Subtotal`       | decimal     | pre-tax total                                      |
| `FreightTaxCode` | object      | `{"UID":"..."}` — required if freight set          |
| `ShipToAddress`  | string      |                                                    |
| `Comment`        | string      | memo                                               |
| `LastModified`   | datetime    |                                                    |
| `RowVersion`     | string      | required for PUT                                   |

**Line item fields (Invoice/Item):** `LineType` (`Transaction`/`Header`), `Item` (`{"UID":"..."}`→Inventory Item), `ShipQuantity` (decimal), `UnitPrice` (decimal), `DiscountPercent` (0–100), `Total` (decimal), `TaxCode` (`{"UID":"..."}`), `Account` (`{"UID":"..."}` income account), `Description` (string).

### Invoice / Service (Sales) — `/Sale/Invoice/Service` · scope `sme-sales`

Same header fields as Item invoice. Line items differ: `Account` (`{"UID":"..."}` income account, required, no Item ref), `Amount` (decimal), `TaxCode` (`{"UID":"..."}`), `Description`.

### Customer Payment — `/Sale/CustomerPayment` · scope `sme-sales`

`UID`, `Customer` (`{"UID":"..."}`), `ReceiveFrom` (bank account `{"UID":"..."}`), `Date`, `Amount` (total), `Invoices` (array of `{"UID":"...","AmountApplied":0.00}`), `LastModified`, `RowVersion`.

### Bill / Item (Purchases) — `/Purchase/Bill/Item` · scope `sme-purchases`

Mirror of Invoice/Item for purchases: `UID`, `Number` (bill/PO number), `Supplier` (`{"UID":"..."}`), `Date`, `Status` (`Open`/`Closed`), `Lines` (Item + Account refs), `LastModified`, `RowVersion`.

### General Journal — `/GeneralLedger/GeneralJournal` · scope `sme-general-ledger`

`UID`, `DateOccurred` (date), `Lines` (array of debit/credit entries), `Memo`, `LastModified`, `RowVersion`.

### Banking Transactions — `/Banking/SpendMoneyTxn`, `/Banking/ReceiveMoneyTxn`, `/Banking/TransferMoneyTxn` · scope `sme-banking`

`UID`, `Date`, `Amount` (decimal), `Account` (bank account `{"UID":"..."}`), `Lines` (allocation lines), `Memo`, `LastModified`, `RowVersion`.

## Entity Relationships

```
CompanyFile (businessId)
  ├── Contacts
  │     ├── Customer (uid) ─────────┐
  │     ├── Supplier (uid) ──────┐  │
  │     └── Employee (uid)       │  │
  ├── GeneralLedger              │  │
  │     ├── Account (uid) ◄──────┼──┤ (line items)
  │     ├── TaxCode (uid) ◄──────┼──┤ (line items)
  │     └── JournalTransaction   │  │
  ├── Inventory                  │  │
  │     └── Item (uid) ◄─────────┼──┤ (invoice lines)
  ├── Sales                      │  │
  │     ├── Invoice/Item ────────┼──┘
  │     ├── Invoice/Service      │
  │     ├── CustomerPayment ─────┘
  │     └── Order/Item
  ├── Purchases
  │     ├── Bill/Item ───────────► Supplier
  │     └── SupplierPayment
  └── Banking ── SpendMoneyTxn / ReceiveMoneyTxn / TransferMoneyTxn
```

## State Machines

**Invoice:** `[Open] --payment applied--> [Closed]` · `[Open] --credit created--> [CreditNote]` · `[Closed] --reversal--> requires new reversal journal (cannot DELETE if "must be reversed" set)`.
**Bill:** `[Open] --payment applied--> [Closed]`.

## Business Rules

1. **UID references must exist** — all cross-entity refs (`Customer.UID`, `Item.UID`, `TaxCode.UID`, `Account.UID`) must point to real, active entities in the company file.
2. **Freight TaxCode** [DOCUMENTED rules-section] — if freight amount is set on an invoice, `FreightTaxCode` must also be set, else `FreightHasNotBeenSet` error.
3. **Date restrictions** [DOCUMENTED errors] — transaction dates cannot precede the financial-year start (error 25008); dates in a locked period also rejected.
4. **Account restrictions on inventoried items** [DOCUMENTED rules-section] — MYOB enforces account-type compatibility on item invoice lines.
5. **Consolidated tax codes** [DOCUMENTED rules-section] — passing a consolidated (compound) tax code on a line item may error.
6. **Invoice rounding** [DOCUMENTED rules-section] — a 1-cent rounding variation can occur; if totals don't match exactly, check rounding logic.

## Field Format Reference

| Type             | Format                  | Example                                  |
| ---------------- | ----------------------- | ---------------------------------------- |
| GUID / UID       | UUID v4 string          | `"5d4b1ce0-bb9f-4f4c-9578-2b168b7295db"` |
| Date             | `"YYYY-MM-DDTHH:MM:SS"` | `"2024-06-15T00:00:00"`                  |
| DateTime filter  | `datetime'YYYY-MM-DD'`  | `datetime'2024-06-01'`                   |
| RowVersion       | base64-like string      | `"6869722900005164"`                     |
| Currency         | decimal                 | `1250.00`                                |
| Boolean          | JSON boolean            | `true`/`false`                           |
| Object reference | `{ "UID": "{guid}" }`   | `{ "UID": "abc123..." }`                 |
