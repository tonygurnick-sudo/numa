---
api_name: 'NetSuite AI Connector Service (MCP)'
api_slug: 'netsuite'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-03-30'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# NetSuite MCP -- Domain Model Reference

> Companion to `01-llm-api-rules.md`. Contains the entity catalog, record types,
> relationships, state machines, and business rules for the NetSuite MCP integration.
>
> **Key concept:** NetSuite MCP exposes a GENERIC record API. There are no entity-specific
> tools. Instead, `ns_createRecord`, `ns_updateRecord`, and `ns_getRecord` accept a
> `recordType` string parameter. Field schemas are discovered via `ns_getRecordTypeMetadata`.

---

## Generic Record Model

Unlike traditional REST APIs with entity-specific endpoints, NetSuite MCP provides:

1. **ns_getRecordTypeMetadata** -- Discover available record types and their field schemas
2. **ns_createRecord(recordType, data)** -- Create any record type
3. **ns_updateRecord(recordType, recordId, data)** -- Update any record type
4. **ns_getRecord(recordType, recordId, fields)** -- Read any record type

All field names and types are dynamic per record type. Always call `ns_getRecordTypeMetadata` before writing.

---

## Entity Catalog

### Customer

**Record type string:** `customer`
**SuiteQL table:** `customer`
**Description:** Companies and individuals that purchase goods/services
**CRUD via MCP:** Create / Read / Update (no Delete)

| Field            | Type        | Writable | Description                | SuiteQL Column     |
| ---------------- | ----------- | -------- | -------------------------- | ------------------ |
| id               | integer     | No       | Internal ID                | `id`               |
| companyname      | string      | Yes      | Company name               | `companyname`      |
| email            | string      | Yes      | Primary email              | `email`            |
| phone            | string      | Yes      | Primary phone              | `phone`            |
| subsidiary       | integer ref | Yes      | Subsidiary ID              | `subsidiary`       |
| category         | integer ref | Yes      | Customer category          | `category`         |
| balance          | currency    | No       | Account balance (computed) | `balance`          |
| overduebalance   | currency    | No       | Overdue balance (computed) | `overduebalance`   |
| datecreated      | datetime    | No       | Creation timestamp         | `datecreated`      |
| lastmodifieddate | datetime    | No       | Last modification          | `lastmodifieddate` |
| isinactive       | boolean     | Yes      | Active/inactive flag       | `isinactive` (T/F) |
| entitystatus     | integer ref | Yes      | CRM status                 | `entitystatus`     |
| terms            | integer ref | Yes      | Payment terms              | `terms`            |
| creditlimit      | currency    | Yes      | Credit limit               | `creditlimit`      |

**Relationships:**

| Related Entity | Type | Expression                            | Notes                      |
| -------------- | ---- | ------------------------------------- | -------------------------- |
| Transaction    | 1:N  | `transaction.entity = customer.id`    | Orders, invoices, payments |
| Contact        | 1:N  | `contact.company = customer.id`       | Associated contacts        |
| Subsidiary     | N:1  | `customer.subsidiary = subsidiary.id` | Parent subsidiary          |

---

### Vendor

**Record type string:** `vendor`
**SuiteQL table:** `vendor`
**Description:** Suppliers and service providers
**CRUD via MCP:** Create / Read / Update

| Field       | Type        | Writable | Description           | SuiteQL Column |
| ----------- | ----------- | -------- | --------------------- | -------------- |
| id          | integer     | No       | Internal ID           | `id`           |
| companyname | string      | Yes      | Company name          | `companyname`  |
| email       | string      | Yes      | Primary email         | `email`        |
| phone       | string      | Yes      | Primary phone         | `phone`        |
| subsidiary  | integer ref | Yes      | Subsidiary ID         | `subsidiary`   |
| balance     | currency    | No       | AP balance (computed) | `balance`      |
| isinactive  | boolean     | Yes      | Active/inactive flag  | `isinactive`   |

---

### Employee

**Record type string:** `employee`
**SuiteQL table:** `employee`
**Description:** Internal employees
**CRUD via MCP:** Create / Read / Update

| Field      | Type        | Writable | Description            | SuiteQL Column |
| ---------- | ----------- | -------- | ---------------------- | -------------- |
| id         | integer     | No       | Internal ID            | `id`           |
| firstname  | string      | Yes      | First name             | `firstname`    |
| lastname   | string      | Yes      | Last name              | `lastname`     |
| email      | string      | Yes      | Email                  | `email`        |
| title      | string      | Yes      | Job title              | `title`        |
| department | integer ref | Yes      | Department             | `department`   |
| supervisor | integer ref | Yes      | Supervisor employee ID | `supervisor`   |
| isinactive | boolean     | Yes      | Active/inactive flag   | `isinactive`   |

---

### Transaction (Sales Order, Invoice, PO, etc.)

**Record type strings:** `salesorder`, `invoice`, `purchaseorder`, `vendorbill`, `journalentry`, `creditmemo`, `estimate`, `itemfulfillment`, `itemreceipt`, `customerpayment`, `vendorpayment`
**SuiteQL table:** `transaction` (unified, filtered by `type` column)
**Description:** All financial transactions. The `transaction` table is unified -- use the `type` column to filter.
**CRUD via MCP:** Create / Read / Update (type-specific fields vary)

| Field            | Type        | Writable | Description                        | SuiteQL Column     |
| ---------------- | ----------- | -------- | ---------------------------------- | ------------------ |
| id               | integer     | No       | Internal ID                        | `id`               |
| type             | string      | No       | Transaction type code              | `type`             |
| tranid           | string      | Yes      | Transaction number (e.g., SO-1234) | `tranid`           |
| entity           | integer ref | Yes      | Customer/vendor ID                 | `entity`           |
| trandate         | date        | Yes      | Transaction date                   | `trandate`         |
| status           | string      | No       | Status string                      | `status`           |
| total            | currency    | No       | Total amount (computed)            | `total`            |
| foreigntotal     | currency    | No       | Foreign currency total             | `foreigntotal`     |
| amountremaining  | currency    | No       | Unpaid balance                     | `amountremaining`  |
| subsidiary       | integer ref | Yes      | Subsidiary                         | `subsidiary`       |
| department       | integer ref | Yes      | Department                         | `department`       |
| class            | integer ref | Yes      | Class/segment                      | `class`            |
| location         | integer ref | Yes      | Location                           | `location`         |
| memo             | string      | Yes      | Memo/description                   | `memo`             |
| currency         | integer ref | Yes      | Currency                           | `currency`         |
| duedate          | date        | Yes      | Due date (invoices)                | `duedate`          |
| datecreated      | datetime    | No       | Created timestamp                  | `datecreated`      |
| lastmodifieddate | datetime    | No       | Last modified                      | `lastmodifieddate` |

**Transaction type codes (for SuiteQL `WHERE type = '...'`):**

| Code       | Transaction Type     |
| ---------- | -------------------- |
| `SalesOrd` | Sales Order          |
| `CustInvc` | Invoice              |
| `PurchOrd` | Purchase Order       |
| `VendBill` | Vendor Bill          |
| `CustPymt` | Customer Payment     |
| `VendPymt` | Vendor Payment       |
| `Journal`  | Journal Entry        |
| `ItemShip` | Item Fulfillment     |
| `ItemRcpt` | Item Receipt         |
| `Estimate` | Quote/Estimate       |
| `CustCred` | Credit Memo          |
| `RtnAuth`  | Return Authorization |
| `CashSale` | Cash Sale            |

---

### Transaction Line

**SuiteQL table:** `transactionline`
**Description:** Individual line items on transactions
**CRUD via MCP:** Created/updated as part of parent transaction record

| Field              | Type        | Description            | SuiteQL Column       |
| ------------------ | ----------- | ---------------------- | -------------------- |
| id                 | integer     | Line internal ID       | `id`                 |
| transaction        | integer ref | Parent transaction ID  | `transaction`        |
| item               | integer ref | Item ID                | `item`               |
| quantity           | number      | Line quantity          | `quantity`           |
| rate               | currency    | Unit price             | `rate`               |
| amount             | currency    | Line amount (computed) | `amount`             |
| netamount          | currency    | Net amount             | `netamount`          |
| linesequencenumber | integer     | Line order             | `linesequencenumber` |

---

### Item

**Record type strings:** `inventoryitem`, `noninventoryitem`, `serviceitem`, `kititem`, `assemblyitem`
**SuiteQL table:** `item`
**Description:** Products, services, and inventory items
**CRUD via MCP:** Create / Read / Update

| Field             | Type     | Writable | Description                   | SuiteQL Column      |
| ----------------- | -------- | -------- | ----------------------------- | ------------------- |
| id                | integer  | No       | Internal ID                   | `id`                |
| itemid            | string   | Yes      | Item code/SKU                 | `itemid`            |
| displayname       | string   | Yes      | Display name                  | `displayname`       |
| description       | string   | Yes      | Description                   | `description`       |
| itemtype          | string   | No       | Item type                     | `itemtype`          |
| baseprice         | currency | Yes      | Base/list price               | `baseprice`         |
| quantityavailable | number   | No       | Available quantity (computed) | `quantityavailable` |
| quantityonhand    | number   | No       | On-hand quantity (computed)   | `quantityonhand`    |
| quantityonorder   | number   | No       | On order quantity (computed)  | `quantityonorder`   |
| isinactive        | boolean  | Yes      | Active/inactive               | `isinactive`        |

---

### Contact

**Record type string:** `contact`
**SuiteQL table:** `contact`
**Description:** Individual contacts associated with companies
**CRUD via MCP:** Create / Read / Update

| Field     | Type        | Writable | Description               | SuiteQL Column |
| --------- | ----------- | -------- | ------------------------- | -------------- |
| id        | integer     | No       | Internal ID               | `id`           |
| firstname | string      | Yes      | First name                | `firstname`    |
| lastname  | string      | Yes      | Last name                 | `lastname`     |
| email     | string      | Yes      | Email                     | `email`        |
| phone     | string      | Yes      | Phone                     | `phone`        |
| company   | integer ref | Yes      | Parent customer/vendor ID | `company`      |
| title     | string      | Yes      | Job title                 | `title`        |

---

### Subsidiary

**Record type string:** `subsidiary`
**SuiteQL table:** `subsidiary`
**Description:** Business units/legal entities within OneWorld accounts
**CRUD via MCP:** Read primarily (also accessible via ns_getSubsidiaries)

| Field | Type    | Description                           | SuiteQL Column |
| ----- | ------- | ------------------------------------- | -------------- |
| id    | integer | Internal ID (negative = consolidated) | `id`           |
| name  | string  | Subsidiary name                       | `name`         |

---

### Account (Chart of Accounts)

**SuiteQL table:** `account`
**Description:** General ledger accounts
**CRUD via MCP:** Read primarily

| Field      | Type     | Description     | SuiteQL Column |
| ---------- | -------- | --------------- | -------------- |
| id         | integer  | Internal ID     | `id`           |
| acctnumber | string   | Account number  | `acctnumber`   |
| acctname   | string   | Account name    | `acctname`     |
| accttype   | string   | Account type    | `accttype`     |
| balance    | currency | Current balance | `balance`      |

---

## Entity Relationship Diagram

```
┌──────────────┐       1:N        ┌──────────────────┐       N:1       ┌──────────────┐
│   Customer   │─────────────────>│   Transaction    │<───────────────│    Vendor     │
│              │                  │ (SO/Inv/PO/Bill) │                │              │
└──────────────┘                  └──────────────────┘                └──────────────┘
       │                                  │
       │ 1:N                              │ 1:N
       ▼                                  ▼
┌──────────────┐                  ┌──────────────────┐       N:1       ┌──────────────┐
│   Contact    │                  │ Transaction Line │───────────────>│     Item      │
└──────────────┘                  └──────────────────┘                └──────────────┘

┌──────────────┐       N:1 (all entities)
│  Subsidiary  │<─── customer.subsidiary, vendor.subsidiary, transaction.subsidiary
└──────────────┘

┌──────────────┐       N:1 (transactions, employees)
│  Department  │<─── transaction.department, employee.department
└──────────────┘
```

---

## State Machines

### Sales Order Lifecycle

```
[Pending Approval] ──approve──> [Pending Fulfillment] ──fulfill──> [Pending Billing]
                                                                         │
                                                                    ──invoice──>  [Billed]
                                                                         │
                                                                    ──close──>    [Closed]
[Any open state] ──cancel──> [Cancelled]
```

### Invoice Lifecycle

```
[Open] ──partial payment──> [Open] (amountremaining decreases)
[Open] ──full payment──>    [Paid In Full]
[Open] ──void──>            [Voided]
```

### Purchase Order Lifecycle

```
[Pending Approval] ──approve──> [Pending Receipt] ──receive──> [Partially Received]
                                                   ──receive all──> [Fully Received]
                                                                         │
                                                                    ──bill──> [Fully Billed]
                                                                    ──close──> [Closed]
```

---

## Business Rules

### Ordering / Dependency Rules

- Call `ns_getRecordTypeMetadata(recordType)` before any create/update to discover required fields
- Call `ns_listAllReports` before `ns_runReport` to obtain valid report IDs
- If `has_subsidiary_filter` is true on a report, call `ns_getSubsidiaries` before running
- Transaction line items reference item IDs -- the item must exist before it can be used on a transaction

### Field-Level Rules

- `companyname` is required on customer and vendor records
- Transaction `entity` must reference a valid customer (for sales) or vendor (for purchasing)
- `subsidiary` is required on all records in OneWorld accounts
- SuiteQL booleans: use `'T'` and `'F'`, not `true`/`false`
- Date values in SuiteQL: use `TO_DATE('2026-01-01', 'YYYY-MM-DD')`

### Cascading Effects

- Voiding an invoice creates a reversing journal entry
- Closing a sales order may close related item fulfillments
- Inactivating a customer does not delete their transaction history

### Computed / Read-Only Fields

- `balance`, `overduebalance` on Customer -- computed from open transactions
- `total`, `foreigntotal`, `amountremaining` on Transaction -- computed from line items and payments
- `quantityavailable`, `quantityonhand`, `quantityonorder` on Item -- computed from inventory transactions
- `datecreated`, `lastmodifieddate` -- system-managed timestamps

---

## Field Format Reference

| Format   | Pattern                | Example                | Notes                                            |
| -------- | ---------------------- | ---------------------- | ------------------------------------------------ |
| Date     | `YYYY-MM-DD`           | `2026-03-30`           | ISO 8601 in MCP; `TO_DATE()` in SuiteQL          |
| DateTime | `YYYY-MM-DDTHH:mm:ssZ` | `2026-03-30T14:30:00Z` | ISO 8601                                         |
| Currency | Decimal number         | `1234.56`              | No symbol; currency from record's currency field |
| ID       | Integer                | `12345`                | Internal IDs; string in MCP tool params          |
| Boolean  | `T` / `F`              | `T`                    | In SuiteQL; may be true/false in MCP record data |
| Phone    | Free-form string       | `+64 21 123 4567`      | No enforced format                               |
| Email    | String                 | `user@example.com`     | Standard email validation                        |

---

## Enum Value Reference

| Entity      | Field      | Common Values                                                                              | Notes                        |
| ----------- | ---------- | ------------------------------------------------------------------------------------------ | ---------------------------- |
| Transaction | type       | `SalesOrd`, `CustInvc`, `PurchOrd`, `VendBill`, `CustPymt`, `Journal`                      | Used in SuiteQL WHERE clause |
| Item        | itemtype   | `InvtPart`, `NonInvtPart`, `Service`, `Kit`, `Assembly`                                    | Item categorization          |
| Account     | accttype   | `AcctRec`, `AcctPay`, `Bank`, `Income`, `Expense`, `COGS`, `Equity`, `OthAsset`, `OthLiab` | GL account types             |
| Customer    | isinactive | `T`, `F`                                                                                   | Boolean as string            |

---

_Generated from the investigation questionnaire, Phase 3._
