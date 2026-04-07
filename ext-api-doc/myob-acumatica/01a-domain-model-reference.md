# MYOB Acumatica -- Domain Model Reference

> **API Version:** 24.200.001 | **Entities:** 12 core (200+ total in Default endpoint)
> Companion to `01-llm-api-rules.md`.

---

## Entity Relationship Diagram

```
                                 ┌──────────────┐
                                 │   Employee   │
                                 │ EmployeeID   │
                                 │ Department   │
                                 └──────────────┘

  ┌──────────┐    converts    ┌──────────────┐   converts    ┌──────────────┐
  │   Lead   │ ─────────────→ │ Opportunity  │ ────────────→ │ SalesOrder   │
  │ LeadID   │                │OpportunityID │               │ OrderNbr     │
  └──────────┘                └──────────────┘               │ OrderType    │
                                                             │ CustomerID   │
                                                             │ Details[]    │
  ┌──────────────┐                                           └──────┬───────┘
  │   Customer   │◄──────────────────────────────────────────────────┘
  │ CustomerID   │                                                  │
  │ CustomerName │                                                  │ creates
  │ Balance      │                                                  ▼
  └──────┬───────┘                                           ┌──────────────┐
         │                                                   │ SalesInvoice │
         │ 1:N                                               │ ReferenceNbr │
         └──────────────────────────────────────────────────→│ CustomerID   │
                                                             │ Details[]    │
                                                             └──────────────┘

  ┌──────────────┐    1:N    ┌──────────────┐
  │   Vendor     │──────────→│     Bill     │
  │ VendorID     │           │ ReferenceNbr │
  │ VendorName   │           │ VendorID     │
  └──────┬───────┘           │ Details[]    │
         │                   └──────────────┘
         │ 1:N
         └──────────────────→┌───────────────┐
                             │ PurchaseOrder │
                             │ OrderNbr      │
                             │ VendorID      │
                             │ Details[]     │
                             └───────────────┘

  ┌──────────────┐    M:N (via line items)    ┌───────────────┐
  │  StockItem   │◄──────────────────────────→│ SalesOrder /  │
  │ InventoryID  │                            │ PurchaseOrder │
  │ Description  │                            │ Bill          │
  └──────────────┘                            └───────────────┘

  ┌────────────────────┐    1:N    ┌──────────────┐
  │ JournalTransaction │          │   Project    │
  │ BatchNbr           │          │ ProjectID    │
  │ Module             │          │ Description  │
  │ Details[]          │          │ Tasks[]      │
  └────────────────────┘          └──────────────┘
```

---

## JSON Response Structure

**[DOCUMENTED]** -- Every entity response includes three system fields plus value-wrapped business fields.

```json
{
  "id": "ca4b97c9-7b86-ed11-8688-020017045e71",
  "rowNumber": 1,
  "note": null,
  "CustomerID": { "value": "ACME01" },
  "CustomerName": { "value": "Acme Corporation" },
  "Status": { "value": "Active" }
}
```

- `id` -- GUID, system-assigned, immutable
- `rowNumber` -- integer, position in result set
- `note` -- string or null, record-level note/memo
- All business fields: `{"value": actualValue}`

Source: https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=7b104d41-3457-42f8-8010-165d9d931d3f

---

## Entity Definitions

### 1. Customer

| Field                       | Type     | Required | Writable    | Notes                                         |
| --------------------------- | -------- | -------- | ----------- | --------------------------------------------- |
| id                          | GUID     | --       | Read-only   | System-assigned                               |
| CustomerID                  | string   | Yes\*    | Create-only | Auto-numbered if configured                   |
| CustomerName                | string   | Yes      | Yes         | Display name                                  |
| CustomerClass               | string   | Yes      | Yes         | Must exist in system                          |
| Status                      | enum     | No       | Yes         | Active, OnHold, OneTime, CreditHold, Inactive |
| MainContact.Email           | string   | No       | Yes         | Primary email                                 |
| MainContact.Phone1          | string   | No       | Yes         | Primary phone                                 |
| BillingAddress.AddressLine1 | string   | No       | Yes         | --                                            |
| BillingAddress.City         | string   | No       | Yes         | --                                            |
| BillingAddress.State        | string   | No       | Yes         | --                                            |
| BillingAddress.PostalCode   | string   | No       | Yes         | --                                            |
| BillingAddress.Country      | string   | No       | Yes         | 2-letter ISO code                             |
| CurrencyID                  | string   | No       | Yes         | Base currency if omitted                      |
| Terms                       | string   | No       | Yes         | Payment terms ID                              |
| TaxZone                     | string   | No       | Yes         | Tax calculation zone                          |
| Balance                     | decimal  | --       | Read-only   | Computed: outstanding AR                      |
| CreditLimit                 | decimal  | No       | Yes         | Credit limit amount                           |
| LastModifiedDateTime        | datetime | --       | Read-only   | ISO 8601                                      |

### 2. Vendor

| Field             | Type    | Required | Writable    | Notes                             |
| ----------------- | ------- | -------- | ----------- | --------------------------------- |
| id                | GUID    | --       | Read-only   | System-assigned                   |
| VendorID          | string  | Yes\*    | Create-only | Auto-numbered if configured       |
| VendorName        | string  | Yes      | Yes         | Display name                      |
| VendorClass       | string  | Yes      | Yes         | Must exist in system              |
| Status            | enum    | No       | Yes         | Active, OnHold, OneTime, Inactive |
| MainContact.Email | string  | No       | Yes         | --                                |
| PaymentMethod     | string  | No       | Yes         | AP payment method                 |
| Terms             | string  | No       | Yes         | Payment terms ID                  |
| TaxZone           | string  | No       | Yes         | --                                |
| CurrencyID        | string  | No       | Yes         | --                                |
| Balance           | decimal | --       | Read-only   | Computed: outstanding AP          |
| LandedCostVendor  | boolean | No       | Yes         | --                                |
| Vendor1099        | boolean | No       | Yes         | US-specific                       |

### 3. SalesOrder

| Field           | Type    | Required | Writable    | Notes                  |
| --------------- | ------- | -------- | ----------- | ---------------------- |
| id              | GUID    | --       | Read-only   | --                     |
| OrderType       | string  | Yes      | Create-only | SO, TR, QT, etc.       |
| OrderNbr        | string  | Yes\*    | Create-only | Auto-numbered          |
| CustomerID      | string  | Yes      | Yes         | Must be valid Customer |
| Status          | enum    | --       | Read-only   | See state machine      |
| Date            | date    | No       | Yes         | Order date             |
| Description     | string  | No       | Yes         | --                     |
| Details[]       | array   | No       | Yes         | Line items (see below) |
| OrderTotal      | decimal | --       | Read-only   | Computed from lines    |
| TaxTotal        | decimal | --       | Read-only   | Computed               |
| CurrencyID      | string  | No       | Yes         | --                     |
| ShipVia         | string  | No       | Yes         | Carrier code           |
| ShippingAddress | object  | No       | Yes         | Nested address         |

**SalesOrder.Details[] line item:**

| Field           | Type    | Required | Writable  | Notes                               |
| --------------- | ------- | -------- | --------- | ----------------------------------- |
| id              | GUID    | --       | Read-only | Include on updates to preserve line |
| InventoryID     | string  | Yes      | Yes       | Valid StockItem                     |
| Quantity        | decimal | Yes      | Yes       | --                                  |
| UnitPrice       | decimal | No       | Yes       | Defaults from price list            |
| LineDescription | string  | No       | Yes       | --                                  |
| DiscountPercent | decimal | No       | Yes       | Line discount                       |
| Amount          | decimal | --       | Read-only | Computed: Qty x UnitPrice           |
| WarehouseID     | string  | No       | Yes       | Source warehouse                    |

### 4. SalesInvoice

| Field        | Type    | Required | Writable    | Notes                       |
| ------------ | ------- | -------- | ----------- | --------------------------- |
| id           | GUID    | --       | Read-only   | --                          |
| Type         | string  | Yes      | Create-only | INV, CM, DM                 |
| ReferenceNbr | string  | Yes\*    | Create-only | Auto-numbered               |
| CustomerID   | string  | Yes      | Yes         | Must be valid Customer      |
| Status       | enum    | --       | Read-only   | See state machine           |
| Date         | date    | No       | Yes         | Invoice date                |
| DueDate      | date    | No       | Yes         | --                          |
| Description  | string  | No       | Yes         | --                          |
| Details[]    | array   | No       | Yes         | Line items                  |
| Amount       | decimal | --       | Read-only   | Computed                    |
| Balance      | decimal | --       | Read-only   | Computed: Amount - payments |

### 5. Bill

| Field        | Type    | Required | Writable    | Notes                     |
| ------------ | ------- | -------- | ----------- | ------------------------- |
| id           | GUID    | --       | Read-only   | --                        |
| Type         | string  | Yes      | Create-only | BL, CR, ADR               |
| ReferenceNbr | string  | Yes\*    | Create-only | Auto-numbered             |
| VendorID     | string  | Yes      | Yes         | Must be valid Vendor      |
| Status       | enum    | --       | Read-only   | See state machine         |
| Date         | date    | No       | Yes         | Bill date                 |
| DueDate      | date    | No       | Yes         | --                        |
| Description  | string  | No       | Yes         | --                        |
| Details[]    | array   | No       | Yes         | Line items                |
| Amount       | decimal | --       | Read-only   | Computed                  |
| Balance      | decimal | --       | Read-only   | Computed                  |
| VendorRef    | string  | No       | Yes         | Vendor's reference number |

### 6. PurchaseOrder

| Field       | Type    | Required | Writable    | Notes                |
| ----------- | ------- | -------- | ----------- | -------------------- |
| id          | GUID    | --       | Read-only   | --                   |
| OrderType   | string  | Yes      | Create-only | RO, NO, DP, etc.     |
| OrderNbr    | string  | Yes\*    | Create-only | Auto-numbered        |
| VendorID    | string  | Yes      | Yes         | Must be valid Vendor |
| Status      | enum    | --       | Read-only   | See state machine    |
| Date        | date    | No       | Yes         | --                   |
| Description | string  | No       | Yes         | --                   |
| Details[]   | array   | No       | Yes         | Line items           |
| OrderTotal  | decimal | --       | Read-only   | Computed             |
| CurrencyID  | string  | No       | Yes         | --                   |

### 7. StockItem

| Field              | Type    | Required | Writable    | Notes                                                                |
| ------------------ | ------- | -------- | ----------- | -------------------------------------------------------------------- |
| id                 | GUID    | --       | Read-only   | --                                                                   |
| InventoryID        | string  | Yes      | Create-only | Unique item code                                                     |
| Description        | string  | No       | Yes         | --                                                                   |
| ItemClass          | string  | Yes      | Yes         | Must exist in system                                                 |
| ItemStatus         | enum    | No       | Yes         | Active, Inactive, MarkedForDeletion, NoSales, NoPurchases, NoRequest |
| ItemType           | enum    | No       | Yes         | FinishedGood, Component, SubAssembly, etc.                           |
| BaseUnit           | string  | Yes      | Yes         | UOM (EACH, KG, etc.)                                                 |
| DefaultPrice       | decimal | No       | Yes         | --                                                                   |
| CurrentStockQty    | decimal | --       | Read-only   | Total on-hand                                                        |
| TaxCategory        | string  | No       | Yes         | --                                                                   |
| DefaultWarehouseID | string  | No       | Yes         | --                                                                   |

### 8. JournalTransaction

| Field           | Type    | Required | Writable    | Notes                              |
| --------------- | ------- | -------- | ----------- | ---------------------------------- |
| id              | GUID    | --       | Read-only   | --                                 |
| BatchNbr        | string  | Yes\*    | Create-only | Auto-numbered                      |
| Module          | string  | Yes      | Create-only | GL                                 |
| Status          | enum    | --       | Read-only   | Balanced, Unposted, Posted, Voided |
| Description     | string  | No       | Yes         | --                                 |
| TransactionDate | date    | No       | Yes         | --                                 |
| Details[]       | array   | Yes      | Yes         | Debit/credit lines                 |
| CreditTotal     | decimal | --       | Read-only   | Computed                           |
| DebitTotal      | decimal | --       | Read-only   | Must equal CreditTotal             |

**JournalTransaction.Details[] line item:**

| Field        | Type    | Required    | Writable | Notes                      |
| ------------ | ------- | ----------- | -------- | -------------------------- |
| AccountID    | string  | Yes         | Yes      | GL account number          |
| SubaccountID | string  | No          | Yes      | --                         |
| DebitAmount  | decimal | Conditional | Yes      | Set either Debit or Credit |
| CreditAmount | decimal | Conditional | Yes      | Set either Debit or Credit |
| Description  | string  | No          | Yes      | Line description           |
| ReferenceNbr | string  | No          | Yes      | External reference         |
| BranchID     | string  | No          | Yes      | --                         |

### 9. Lead

| Field       | Type   | Required | Writable    | Notes                              |
| ----------- | ------ | -------- | ----------- | ---------------------------------- |
| id          | GUID   | --       | Read-only   | --                                 |
| LeadID      | string | Yes\*    | Create-only | Auto-numbered                      |
| Status      | enum   | --       | Yes         | New, Open, Converted, Disqualified |
| FirstName   | string | No       | Yes         | --                                 |
| LastName    | string | Yes      | Yes         | --                                 |
| Email       | string | No       | Yes         | --                                 |
| Phone1      | string | No       | Yes         | --                                 |
| CompanyName | string | No       | Yes         | --                                 |
| Source      | string | No       | Yes         | Lead source                        |
| LeadClass   | string | No       | Yes         | --                                 |

### 10. Opportunity

| Field         | Type    | Required | Writable    | Notes                   |
| ------------- | ------- | -------- | ----------- | ----------------------- |
| id            | GUID    | --       | Read-only   | --                      |
| OpportunityID | string  | Yes\*    | Create-only | Auto-numbered           |
| Status        | enum    | No       | Yes         | New, Open, Won, Lost    |
| Subject       | string  | Yes      | Yes         | --                      |
| CustomerID    | string  | No       | Yes         | Link to Customer        |
| Amount        | decimal | No       | Yes         | Estimated deal value    |
| CurrencyID    | string  | No       | Yes         | --                      |
| Stage         | string  | No       | Yes         | Sales stage             |
| Probability   | decimal | No       | Yes         | Win probability (0-100) |
| CloseDate     | date    | No       | Yes         | Expected close date     |
| Owner         | string  | No       | Yes         | Employee owner          |

### 11. Project

| Field       | Type   | Required | Writable    | Notes                                                          |
| ----------- | ------ | -------- | ----------- | -------------------------------------------------------------- |
| id          | GUID   | --       | Read-only   | --                                                             |
| ProjectID   | string | Yes      | Create-only | Unique project code                                            |
| Description | string | No       | Yes         | --                                                             |
| Status      | enum   | --       | Read-only   | Planned, Active, Completed, Cancelled, OnHold, PendingApproval |
| CustomerID  | string | No       | Yes         | Billing customer                                               |
| StartDate   | date   | No       | Yes         | --                                                             |
| EndDate     | date   | No       | Yes         | --                                                             |
| BillingRule | string | No       | Yes         | --                                                             |
| Tasks[]     | array  | No       | Yes         | ProjectTask sub-entities                                       |

### 12. Employee

| Field        | Type   | Required | Writable    | Notes                      |
| ------------ | ------ | -------- | ----------- | -------------------------- |
| id           | GUID   | --       | Read-only   | --                         |
| EmployeeID   | string | Yes\*    | Create-only | Auto-numbered              |
| EmployeeName | string | --       | Read-only   | Computed from first + last |
| FirstName    | string | No       | Yes         | --                         |
| LastName     | string | Yes      | Yes         | --                         |
| Status       | enum   | No       | Yes         | Active, Inactive           |
| Department   | string | No       | Yes         | Department ID              |
| Position     | string | No       | Yes         | --                         |
| Email        | string | No       | Yes         | --                         |
| Phone1       | string | No       | Yes         | --                         |

---

## Custom Fields

**[DOCUMENTED]** -- Custom and user-defined fields (UDFs) use a special `custom` wrapper in the JSON.

```json
{
  "CustomerID": { "value": "ACME01" },
  "custom": {
    "DefContact": {
      "UsrPersonalID": {
        "type": "CustomStringField",
        "value": "AB123456"
      }
    }
  }
}
```

- `custom` contains a map of data view names to field definitions
- Each field has `type` (e.g., `CustomStringField`, `CustomDecimalField`) and `value`
- Use `$custom` query parameter to include custom fields in GET responses
- Type names depend on the contract version

Source: https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=bd0d8a36-b00b-44c8-bdcd-b2b4e4c86fd0

---

## State Machines

### SalesInvoice / Bill

```
Balanced ──→ Open ──→ Released ──→ Closed
                         │
                         └──→ Voided
```

| Transition         | Trigger                                      | Reversible         |
| ------------------ | -------------------------------------------- | ------------------ |
| Balanced -> Open   | All lines valid, totals balance              | Yes (remove lines) |
| Open -> Released   | `ReleaseSalesInvoice` / `ReleaseBill` action | No                 |
| Released -> Closed | Full payment applied                         | Auto (system)      |
| Released -> Voided | Void action (creates reversal)               | No                 |

### SalesOrder

```
Open ──→ BackOrder ──→ Shipping ──→ Completed
  │                                      │
  └──────────────→ Cancelled ←───────────┘ (only if no shipments)
```

### PurchaseOrder

```
Open ──→ PendingApproval ──→ Approved ──→ Completed
```

### Lead

```
New ──→ Open ──→ Converted (creates Opportunity)
New/Open ──→ Disqualified
```

### Opportunity

```
New ──→ Open ──→ Won (creates SalesOrder via action)
Open ──→ Lost
```

---

## Business Rules

### Required Field Enforcement

| Entity             | Required Fields                                |
| ------------------ | ---------------------------------------------- |
| Customer           | CustomerID (or auto), CustomerClass            |
| Vendor             | VendorID (or auto), VendorClass                |
| SalesOrder         | OrderType, CustomerID                          |
| SalesInvoice       | Type, CustomerID                               |
| Bill               | Type, VendorID                                 |
| StockItem          | InventoryID, ItemClass, BaseUnit               |
| JournalTransaction | Module (GL), at least one balanced detail line |
| Lead               | LastName                                       |
| Opportunity        | Subject                                        |

### Computed / Read-Only Fields

| Entity             | Computed Fields                  |
| ------------------ | -------------------------------- |
| SalesOrder         | OrderTotal, TaxTotal, OrderedQty |
| SalesInvoice       | Amount, Balance, TaxTotal        |
| Bill               | Amount, Balance, TaxTotal        |
| JournalTransaction | CreditTotal, DebitTotal          |
| Customer           | Balance                          |
| Vendor             | Balance                          |
| StockItem          | CurrentStockQty                  |
| Employee           | EmployeeName                     |

### Key Business Rules

1. **Referential integrity** -- Cannot delete Customer with open SalesOrders or unpaid invoices
2. **Immutability after release** -- Released financial documents cannot be modified (void and recreate)
3. **Journal entry balance** -- Total debits must equal total credits
4. **Line item array replacement** -- PUT replaces the entire `Details` array
5. **Auto-numbering** -- Fields marked `*` may be auto-generated by numbering sequences
6. **Tax auto-calculation** -- Tax calculated from TaxZone + TaxCategory configuration
7. **Currency conversion** -- Multi-currency amounts converted at exchange rates in system

---

## Enum Reference

### Customer.Status

`Active` | `OnHold` | `OneTime` | `CreditHold` | `Inactive`

### Vendor.Status

`Active` | `OnHold` | `OneTime` | `Inactive`

### SalesOrder.Status (read-only)

`Open` | `BackOrder` | `Shipping` | `Completed` | `Cancelled`

### SalesOrder.OrderType

`SO` (Sales Order) | `TR` (Transfer) | `QT` (Quote) | `IN` (Invoice) | `RC` (Credit Memo) | `CM` (Credit Memo)

### SalesInvoice.Status (read-only)

`Balanced` | `Open` | `Released` | `Closed` | `Voided`

### SalesInvoice.Type

`INV` (Invoice) | `CM` (Credit Memo) | `DM` (Debit Memo)

### Bill.Status (read-only)

`Balanced` | `Open` | `Released` | `Closed` | `Voided`

### Bill.Type

`BL` (Bill) | `CR` (Credit Adjustment) | `ADR` (Debit Adjustment)

### PurchaseOrder.Status (read-only)

`Open` | `PendingApproval` | `Approved` | `Completed`

### PurchaseOrder.OrderType

`RO` (Normal) | `NO` (Normal) | `DP` (Drop Ship) | `BL` (Blanket)

### StockItem.ItemStatus

`Active` | `Inactive` | `MarkedForDeletion` | `NoSales` | `NoPurchases` | `NoRequest`

### Lead.Status

`New` | `Open` | `Converted` | `Disqualified`

### Opportunity.Status

`New` | `Open` | `Won` | `Lost`

### Project.Status (read-only)

`Planned` | `Active` | `Completed` | `Cancelled` | `OnHold` | `PendingApproval`

### Employee.Status

`Active` | `Inactive`

### JournalTransaction.Status (read-only)

`Balanced` | `Unposted` | `Posted` | `Voided`

---

## Field Format Reference

| Format   | Pattern               | Example                                  | Notes                               |
| -------- | --------------------- | ---------------------------------------- | ----------------------------------- |
| Date     | ISO 8601              | `"2026-03-30T00:00:00+00:00"`            | Always wrapped in `{"value": ...}`  |
| DateTime | ISO 8601              | `"2026-03-30T14:30:00+00:00"`            | Timezone offset included            |
| Decimal  | Number                | `1250.000000`                            | Up to 6 decimal places in responses |
| Boolean  | true/false            | `true`                                   | Wrapped: `{"value": true}`          |
| GUID     | UUID format           | `"ca4b97c9-7b86-ed11-8688-020017045e71"` | System `id` field (NOT wrapped)     |
| String   | PascalCase field name | `"ACME01"`                               | Wrapped: `{"value": "ACME01"}`      |

---

_Generated from the investigation questionnaire, Phase 3._
