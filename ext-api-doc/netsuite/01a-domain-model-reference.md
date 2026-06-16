---
api_name: NetSuite AI Connector Service (MCP)
api_slug: netsuite
doc: on-demand domain-model reference (companion to 01-llm-api-rules.md)
call_surface: MCP via mcp_call (also valid for SuiteQL tables under the REST surface)
key_concept: Generic record API — no entity-specific tools. recordType string selects the entity; field schemas discovered via ns_getRecordTypeMetadata.
---

# NetSuite MCP — Domain Model Reference

Entity catalog, record types, relationships, state machines, business rules. Companion to `01-llm-api-rules.md`.

## Generic record model

`ns_getRecordTypeMetadata` discovers record types + field schemas. `ns_createRecord(recordType,data)` / `ns_updateRecord(recordType,recordId,data)` / `ns_getRecord(recordType,recordId,fields)` operate on any type. Field names/types are dynamic per type — ALWAYS call `ns_getRecordTypeMetadata` before writing.

## Entity catalog

Cols: field | type | Writable(Y/N). SuiteQL column = field name. `id` (integer, non-writable, internal ID) implicit on every entity. Booleans store as `'T'`/`'F'` in SuiteQL. CRUD = Create/Read/Update for all entities below; **no Delete** anywhere (MCP has no delete tool).

### customer — table `customer`

| Field            | Type     | W   | Notes                                      |
| ---------------- | -------- | --- | ------------------------------------------ |
| companyname      | string   | Y   | Company name (required on customer/vendor) |
| email            | string   | Y   | Primary email                              |
| phone            | string   | Y   | Primary phone                              |
| subsidiary       | int ref  | Y   | Subsidiary id (required in OneWorld)       |
| category         | int ref  | Y   | Customer category                          |
| balance          | currency | N   | Account balance (computed from open txns)  |
| overduebalance   | currency | N   | Overdue balance (computed)                 |
| datecreated      | datetime | N   | Creation timestamp                         |
| lastmodifieddate | datetime | N   | Last modification                          |
| isinactive       | boolean  | Y   | Active/inactive                            |
| entitystatus     | int ref  | Y   | CRM status                                 |
| terms            | int ref  | Y   | Payment terms                              |
| creditlimit      | currency | Y   | Credit limit                               |

Relationships: `transaction.entity = customer.id` (1:N orders/invoices/payments) · `contact.company = customer.id` (1:N) · `customer.subsidiary = subsidiary.id` (N:1).

### vendor — table `vendor`

| Field       | Type     | W                        |
| ----------- | -------- | ------------------------ |
| companyname | string   | Y                        |
| email       | string   | Y                        |
| phone       | string   | Y                        |
| subsidiary  | int ref  | Y                        |
| balance     | currency | N (AP balance, computed) |
| isinactive  | boolean  | Y                        |

### employee — table `employee`

| Field      | Type    | W   |
| ---------- | ------- | --- |
| firstname  | string  | Y   |
| lastname   | string  | Y   |
| email      | string  | Y   |
| title      | string  | Y   |
| department | int ref | Y   |
| supervisor | int ref | Y   |
| isinactive | boolean | Y   |

### transaction — table `transaction` (unified; filter by `type`)

Record-type strings: `salesorder` `invoice` `purchaseorder` `vendorbill` `journalentry` `creditmemo` `estimate` `itemfulfillment` `itemreceipt` `customerpayment` `vendorpayment`. Type-specific fields vary.
| Field | Type | W | Notes |
| --- | --- | --- | --- |
| type | string | N | Transaction type code |
| tranid | string | Y | Number e.g. SO-1234 (auto on create) |
| entity | int ref | Y | Customer (sales) or vendor (purchasing) id |
| trandate | date | Y | Transaction date |
| status | string | N | Status string |
| total | currency | N | Total (computed from lines) |
| foreigntotal | currency | N | Foreign currency total |
| amountremaining | currency | N | Unpaid balance (total − payments) |
| subsidiary | int ref | Y | Subsidiary |
| department | int ref | Y | Department |
| class | int ref | Y | Class/segment |
| location | int ref | Y | Location |
| memo | string | Y | Memo/description |
| currency | int ref | Y | Currency |
| duedate | date | Y | Due date (invoices) |
| datecreated | datetime | N | Created |
| lastmodifieddate | datetime | N | Last modified |

**Transaction `type` codes (SuiteQL `WHERE type='...'`):** `SalesOrd`=Sales Order · `CustInvc`=Invoice · `PurchOrd`=Purchase Order · `VendBill`=Vendor Bill · `CustPymt`=Customer Payment · `VendPymt`=Vendor Payment · `Journal`=Journal Entry · `ItemShip`=Item Fulfillment · `ItemRcpt`=Item Receipt · `Estimate`=Quote/Estimate · `CustCred`=Credit Memo · `RtnAuth`=Return Authorization · `CashSale`=Cash Sale.

### transactionline — table `transactionline` — created/updated as part of parent transaction

| Field              | Type     | Notes                  |
| ------------------ | -------- | ---------------------- |
| transaction        | int ref  | Parent transaction id  |
| item               | int ref  | Item id                |
| quantity           | number   | Line quantity          |
| rate               | currency | Unit price             |
| amount             | currency | Line amount (computed) |
| netamount          | currency | Net amount             |
| linesequencenumber | integer  | Line order             |

### item — table `item`

Record-type strings: `inventoryitem` `noninventoryitem` `serviceitem` `kititem` `assemblyitem`.
| Field | Type | W | Notes |
| --- | --- | --- | --- |
| itemid | string | Y | Item code/SKU |
| displayname | string | Y | Display name |
| description | string | Y | Description |
| itemtype | string | N | Item type |
| baseprice | currency | Y | Base/list price |
| quantityavailable | number | N | Available (computed) |
| quantityonhand | number | N | On-hand (computed) |
| quantityonorder | number | N | On order (computed) |
| isinactive | boolean | Y | Active/inactive |

### contact — table `contact`

| Field     | Type    | W   | Notes                                      |
| --------- | ------- | --- | ------------------------------------------ |
| firstname | string  | Y   | (firstname OR lastname typically required) |
| lastname  | string  | Y   |                                            |
| email     | string  | Y   |                                            |
| phone     | string  | Y   |                                            |
| company   | int ref | Y   | Parent customer/vendor id                  |
| title     | string  | Y   | Job title                                  |

### subsidiary — table `subsidiary` — Read primarily (also via ns_getSubsidiaries)

`id` (integer; negative = consolidated), `name` (string).

### account (chart of accounts) — table `account` — Read primarily

`id`, `acctnumber` (string), `acctname` (string), `accttype` (string), `balance` (currency).

## Relationships (ERD)

- Customer 1:N Transaction (SO/Inv); Vendor 1:N Transaction (PO/Bill) — both via `transaction.entity`.
- Customer 1:N Contact (`contact.company`).
- Transaction 1:N TransactionLine (`transactionline.transaction`); TransactionLine N:1 Item (`transactionline.item`).
- Subsidiary N:1 from customer/vendor/transaction (`*.subsidiary`).
- Department N:1 from transaction/employee (`*.department`).

## State machines

- **Sales Order:** Pending Approval →approve→ Pending Fulfillment →fulfill→ Pending Billing →invoice→ Billed →close→ Closed. Any open state →cancel→ Cancelled.
- **Invoice:** Open →partial payment→ Open (amountremaining decreases) →full payment→ Paid In Full; Open →void→ Voided.
- **Purchase Order:** Pending Approval →approve→ Pending Receipt →receive→ Partially Received →receive all→ Fully Received →bill→ Fully Billed; →close→ Closed.

## Business rules

**Ordering/dependency:** call `ns_getRecordTypeMetadata(recordType)` before any create/update; call `ns_listAllReports` before `ns_runReport`; if a report's `has_subsidiary_filter` is true, call `ns_getSubsidiaries` first; an item must exist before being referenced on a transaction line.
**Field-level:** `companyname` required on customer/vendor; transaction `entity` must reference a valid customer (sales) or vendor (purchasing); `subsidiary` required on all records in OneWorld accounts; SuiteQL booleans `'T'`/`'F'`; SuiteQL dates `TO_DATE('2026-01-01','YYYY-MM-DD')`.
**Cascading:** voiding an invoice creates a reversing journal entry; closing a sales order may close related item fulfillments; inactivating a customer does NOT delete their transaction history.
**Computed/read-only:** customer `balance`/`overduebalance`; transaction `total`/`foreigntotal`/`amountremaining`; item `quantityavailable`/`quantityonhand`/`quantityonorder`; `datecreated`/`lastmodifieddate` (system timestamps).

## Field formats

| Format   | Pattern                | Example                | Notes                                            |
| -------- | ---------------------- | ---------------------- | ------------------------------------------------ |
| Date     | `YYYY-MM-DD`           | `2026-03-30`           | ISO 8601 in MCP; `TO_DATE()` in SuiteQL          |
| DateTime | `YYYY-MM-DDTHH:mm:ssZ` | `2026-03-30T14:30:00Z` | ISO 8601                                         |
| Currency | decimal                | `1234.56`              | No symbol; currency from record's currency field |
| ID       | integer                | `12345`                | Internal id; string in MCP tool params           |
| Boolean  | `T`/`F`                | `T`                    | In SuiteQL; may be true/false in MCP record data |
| Phone    | free-form              | `+64 21 123 4567`      | No enforced format                               |
| Email    | string                 | `user@example.com`     | Standard validation                              |

## Enum reference

| Entity      | Field      | Values                                                                             |
| ----------- | ---------- | ---------------------------------------------------------------------------------- |
| Transaction | type       | `SalesOrd` `CustInvc` `PurchOrd` `VendBill` `CustPymt` `Journal` (full list above) |
| Item        | itemtype   | `InvtPart` `NonInvtPart` `Service` `Kit` `Assembly`                                |
| Account     | accttype   | `AcctRec` `AcctPay` `Bank` `Income` `Expense` `COGS` `Equity` `OthAsset` `OthLiab` |
| Customer    | isinactive | `T` / `F`                                                                          |
