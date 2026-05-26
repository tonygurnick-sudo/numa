# Domain Model Reference — MYOB AccountRight (MYOB Business API v2)

> Source: Official error messages doc, scopes doc, retrieving data doc, pymyob SDK, apideck integration guide.
> All entity fields marked [INFERRED] unless confirmed from live calls.

---

## Entity Catalogue

### Company File

The top-level container. All API calls target a specific company file via its `businessId`.

| Field           | Type        | Notes                                                            |
| --------------- | ----------- | ---------------------------------------------------------------- |
| `businessId`    | GUID string | Primary identifier — extracted from OAuth redirect URI           |
| `UIAccessFlags` | integer     | 0 = Local AccountRight; 2 = Essentials; 3 = AccountRight/Browser |
| Company Name    | string      | Returned as `businessName` in OAuth redirect                     |

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/getting-started/

---

### Customer (Contact)

**Endpoint:** `/Contact/Customer`
**Scope:** `sme-contacts-customer`

| Field          | Type     | Notes                                                                                             |
| -------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `UID`          | GUID     | Unique identifier — use in invoice `Customer.UID`                                                 |
| `DisplayID`    | string   | Human-readable ID (e.g. "CUS0001")                                                                |
| `CompanyName`  | string   | Company/organisation name                                                                         |
| `FirstName`    | string   | Individual first name                                                                             |
| `LastName`     | string   | Individual last name                                                                              |
| `IsActive`     | boolean  | Active status                                                                                     |
| `Addresses`    | array    | Array of address objects with `Email`, `Phone1`, `Street`, `City`, `State`, `PostCode`, `Country` |
| `EmailAddress` | string   | Primary email                                                                                     |
| `LastModified` | datetime | ISO datetime — use for incremental sync                                                           |
| `RowVersion`   | string   | Required for PUT updates — optimistic concurrency                                                 |

[INFERRED from pymyob SDK https://github.com/uptick/pymyob + apideck guide]

---

### Supplier (Contact)

**Endpoint:** `/Contact/Supplier`
**Scope:** `sme-contacts-supplier`

Similar structure to Customer. Key additional fields:

| Field          | Type     | Notes                      |
| -------------- | -------- | -------------------------- |
| `UID`          | GUID     | Use in bill `Supplier.UID` |
| `DisplayID`    | string   | e.g. "SUP0001"             |
| `CompanyName`  | string   |                            |
| `ABN`          | string   | Australian Business Number |
| `IsActive`     | boolean  |                            |
| `LastModified` | datetime |                            |
| `RowVersion`   | string   | Required for PUT           |

[INFERRED]

---

### Employee (Contact)

**Endpoint:** `/Contact/Employee`
**Scope:** `sme-contacts-employee`

| Field          | Type     | Notes            |
| -------------- | -------- | ---------------- |
| `UID`          | GUID     |                  |
| `DisplayID`    | string   | e.g. "EMP0001"   |
| `FirstName`    | string   |                  |
| `LastName`     | string   |                  |
| `IsActive`     | boolean  |                  |
| `LastModified` | datetime |                  |
| `RowVersion`   | string   | Required for PUT |

[INFERRED]

---

### Account (Chart of Accounts)

**Endpoint:** `/GeneralLedger/Account`
**Scope:** `sme-general-ledger`

| Field            | Type     | Notes                                                                                             |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `UID`            | GUID     | Use in line item `Account.UID`                                                                    |
| `Number`         | string   | Account number (e.g. "4-1000")                                                                    |
| `DisplayID`      | string   | Formatted account number                                                                          |
| `Name`           | string   | Account name                                                                                      |
| `Type`           | string   | `Asset`, `Liability`, `Equity`, `Income`, `CostOfSales`, `Expense`, `OtherIncome`, `OtherExpense` |
| `Classification` | string   | Broad classification                                                                              |
| `IsActive`       | boolean  |                                                                                                   |
| `LastModified`   | datetime |                                                                                                   |
| `RowVersion`     | string   |                                                                                                   |

[INFERRED from retrieving data examples https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/]

---

### TaxCode

**Endpoint:** `/GeneralLedger/TaxCode`
**Scope:** `sme-general-ledger`

| Field         | Type    | Notes                          |
| ------------- | ------- | ------------------------------ |
| `UID`         | GUID    | Use in line item `TaxCode.UID` |
| `Code`        | string  | e.g. `GST`, `FRE`, `N-T`       |
| `Description` | string  | Human-readable name            |
| `Rate`        | decimal | Tax rate (e.g. 0.1 for 10%)    |
| `Type`        | string  | Tax type                       |

Common AU tax codes: `GST` (10%), `FRE` (GST Free), `N-T` (Not Reportable), `INP` (Input Taxed)

[INFERRED from apideck guide https://www.apideck.com/blog/how-to-integrate-with-the-myob-api]

---

### Inventory Item

**Endpoint:** `/Inventory/Item`
**Scope:** `sme-inventory`

| Field          | Type     | Notes                          |
| -------------- | -------- | ------------------------------ |
| `UID`          | GUID     | Use in invoice line `Item.UID` |
| `Number`       | string   | Item number                    |
| `Name`         | string   | Item name/description          |
| `IsActive`     | boolean  |                                |
| `SellingPrice` | decimal  | Default selling price          |
| `BuyingPrice`  | decimal  | Default buying price           |
| `IsSold`       | boolean  | Can be sold                    |
| `IsBought`     | boolean  | Can be bought                  |
| `LastModified` | datetime |                                |
| `RowVersion`   | string   |                                |

[INFERRED from apideck guide + pymyob SDK]

---

### Invoice / Item (Sales)

**Endpoint:** `/Sale/Invoice/Item`
**Scope:** `sme-sales`

| Field            | Type        | Notes                                                 |
| ---------------- | ----------- | ----------------------------------------------------- |
| `UID`            | GUID        |                                                       |
| `Number`         | string      | Invoice number                                        |
| `Date`           | date string | Invoice date (ISO format)                             |
| `Status`         | string      | `Open`, `Closed`, `CreditNote`                        |
| `Customer`       | object      | `{ "UID": "..." }` — must reference existing customer |
| `Lines`          | array       | Array of line items (see below)                       |
| `TotalAmount`    | decimal     | Total inc. tax                                        |
| `TotalTax`       | decimal     | Tax amount                                            |
| `Subtotal`       | decimal     | Pre-tax total                                         |
| `FreightTaxCode` | object      | `{ "UID": "..." }` — required if freight is set       |
| `ShipToAddress`  | string      | Shipping address                                      |
| `Comment`        | string      | Invoice comment/memo                                  |
| `LastModified`   | datetime    |                                                       |
| `RowVersion`     | string      | Required for PUT                                      |

**Line item fields (Invoice/Item):**

| Field             | Type    | Notes                                          |
| ----------------- | ------- | ---------------------------------------------- |
| `LineType`        | string  | `Transaction` or `Header`                      |
| `Item`            | object  | `{ "UID": "..." }` — references Inventory Item |
| `ShipQuantity`    | decimal | Quantity                                       |
| `UnitPrice`       | decimal | Price per unit                                 |
| `DiscountPercent` | decimal | Discount (0–100)                               |
| `Total`           | decimal | Line total                                     |
| `TaxCode`         | object  | `{ "UID": "..." }` — references TaxCode        |
| `Account`         | object  | `{ "UID": "..." }` — income account            |
| `Description`     | string  | Line description                               |

[INFERRED from apideck guide + error messages doc + pymyob SDK]

---

### Invoice / Service (Sales)

**Endpoint:** `/Sale/Invoice/Service`
**Scope:** `sme-sales`

Same header fields as Item invoice. Line items differ:

| Field         | Type    | Notes                                                             |
| ------------- | ------- | ----------------------------------------------------------------- |
| `Account`     | object  | `{ "UID": "..." }` — income account (required, no Item reference) |
| `Amount`      | decimal | Line amount                                                       |
| `TaxCode`     | object  | `{ "UID": "..." }`                                                |
| `Description` | string  |                                                                   |

[INFERRED]

---

### Customer Payment

**Endpoint:** `/Sale/CustomerPayment`
**Scope:** `sme-sales`

| Field          | Type        | Notes                                              |
| -------------- | ----------- | -------------------------------------------------- |
| `UID`          | GUID        |                                                    |
| `Customer`     | object      | `{ "UID": "..." }`                                 |
| `ReceiveFrom`  | object      | Bank account `{ "UID": "..." }`                    |
| `Date`         | date string | Payment date                                       |
| `Amount`       | decimal     | Total payment amount                               |
| `Invoices`     | array       | Array of `{ "UID": "...", "AmountApplied": 0.00 }` |
| `LastModified` | datetime    |                                                    |
| `RowVersion`   | string      |                                                    |

[INFERRED from pymyob SDK]

---

### Bill / Item (Purchases)

**Endpoint:** `/Purchase/Bill/Item`
**Scope:** `sme-purchases`

Mirror of Invoice/Item but for purchases. Key fields:

| Field          | Type        | Notes                                  |
| -------------- | ----------- | -------------------------------------- |
| `UID`          | GUID        |                                        |
| `Number`       | string      | Bill/PO number                         |
| `Supplier`     | object      | `{ "UID": "..." }`                     |
| `Date`         | date string |                                        |
| `Status`       | string      | `Open`, `Closed`                       |
| `Lines`        | array       | Line items (Item + Account references) |
| `LastModified` | datetime    |                                        |
| `RowVersion`   | string      |                                        |

[INFERRED]

---

### General Journal

**Endpoint:** `/GeneralLedger/GeneralJournal`
**Scope:** `sme-general-ledger`

| Field          | Type        | Notes                         |
| -------------- | ----------- | ----------------------------- |
| `UID`          | GUID        |                               |
| `DateOccurred` | date string |                               |
| `Lines`        | array       | Array of debit/credit entries |
| `Memo`         | string      |                               |
| `LastModified` | datetime    |                               |
| `RowVersion`   | string      |                               |

[INFERRED]

---

### Banking Transactions

**Endpoints:** `/Banking/SpendMoneyTxn`, `/Banking/ReceiveMoneyTxn`, `/Banking/TransferMoneyTxn`
**Scope:** `sme-banking`

| Field          | Type        | Notes                           |
| -------------- | ----------- | ------------------------------- |
| `UID`          | GUID        |                                 |
| `Date`         | date string |                                 |
| `Amount`       | decimal     |                                 |
| `Account`      | object      | Bank account `{ "UID": "..." }` |
| `Lines`        | array       | Allocation lines                |
| `Memo`         | string      |                                 |
| `LastModified` | datetime    |                                 |
| `RowVersion`   | string      |                                 |

[INFERRED]

---

## Entity Relationships

```
CompanyFile (businessId)
  ├── Contacts
  │     ├── Customer (uid) ─────────┐
  │     ├── Supplier (uid) ──────┐  │
  │     └── Employee (uid)       │  │
  │                              │  │
  ├── GeneralLedger              │  │
  │     ├── Account (uid) ◄──────┼──┤ (line items)
  │     ├── TaxCode (uid) ◄──────┼──┤ (line items)
  │     └── JournalTransaction   │  │
  │                              │  │
  ├── Inventory                  │  │
  │     └── Item (uid) ◄─────────┼──┤ (invoice lines)
  │                              │  │
  ├── Sales                      │  │
  │     ├── Invoice/Item ────────┼──┘
  │     ├── Invoice/Service      │
  │     ├── CustomerPayment ─────┘
  │     └── Order/Item
  │
  ├── Purchases
  │     ├── Bill/Item ───────────► Supplier
  │     └── SupplierPayment
  │
  └── Banking
        ├── SpendMoneyTxn
        ├── ReceiveMoneyTxn
        └── TransferMoneyTxn
```

[INFERRED from scope structure + SDK]

---

## State Machines

### Invoice Status

```
[Open] ──(payment applied)──► [Closed]
[Open] ──(credit created)───► [CreditNote]
[Closed] ──(reversal)───────► requires new reversal journal (cannot DELETE if "must be reversed" setting)
```

[INFERRED from webhook doc + error messages doc]

### Bill Status

```
[Open] ──(payment applied)──► [Closed]
```

[INFERRED]

---

## Business Rules

1. **UID references must exist** — All cross-entity references (Customer.UID, Item.UID, TaxCode.UID, Account.UID) must point to real, active entities in the company file.

2. **Freight TaxCode** — If freight amount is set on an invoice, `FreightTaxCode` must also be set. Omitting it returns `FreightHasNotBeenSet` error.
   [DOCUMENTED] https://apisupport.myob.com/hc/en-us/sections/360000104856

3. **Date restrictions** — Transaction dates cannot be prior to the beginning of the financial year (error code 25008). Dates in a locked period also rejected.
   [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/

4. **Account restrictions on inventoried items** — Cannot set certain account types for inventoried items. MYOB enforces account type compatibility on item invoice lines.
   [DOCUMENTED] https://apisupport.myob.com/hc/en-us/sections/360000104856

5. **Consolidated tax codes** — Some tax codes are consolidated (compound). Passing a consolidated tax code on a line item may cause errors.
   [DOCUMENTED] https://apisupport.myob.com/hc/en-us/sections/360000104856

6. **Invoice rounding** — A 1-cent rounding variation can occur on invoices. If totals don't match exactly, check rounding logic.
   [DOCUMENTED] https://apisupport.myob.com/hc/en-us/sections/360000104856

---

## Field Format Reference

| Type             | Format                  | Example                                  |
| ---------------- | ----------------------- | ---------------------------------------- |
| GUID / UID       | UUID v4 string          | `"5d4b1ce0-bb9f-4f4c-9578-2b168b7295db"` |
| Date             | `"YYYY-MM-DDTHH:MM:SS"` | `"2024-06-15T00:00:00"`                  |
| DateTime filter  | `datetime'YYYY-MM-DD'`  | `datetime'2024-06-01'`                   |
| RowVersion       | Base64-like string      | `"6869722900005164"` [INFERRED]          |
| Currency         | Decimal                 | `1250.00`                                |
| Boolean          | JSON boolean            | `true` / `false`                         |
| Object reference | `{ "UID": "{guid}" }`   | `{ "UID": "abc123..." }`                 |
