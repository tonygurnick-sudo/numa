---
api_name: Cin7 Core
api_slug: cin7-core
base_url: https://inventory.dearsystems.com/externalapi/v2
call_surface: HTTP via `numa integrations request cin7-core <METHOD> <relative-url>`; pass flat relative paths
field_casing: PascalCase
id_format: GUID string in query string (?ID=/?SaleID=), never a path segment
role: on-demand domain reference — entity catalog, field tables, relationships, lifecycle state machines, business rules
confidence: every fact from the official Cin7 Core Apiary blueprint, captured live 2026-05-22; NOT validated through the Numa connector. Inline [UNVERIFIED] = inferred, confirm before relying. Companion to 01-llm-api-rules.md.
---

# Cin7 Core — Domain Model Reference

## ID semantics

- Primary key = **GUID/UUID string** (e.g. `91EE7B1D-BD35-4E43-B98A-DB86BE777624`); opaque, server-generated on create.
- PK field name differs per entity: `ID` (Product, Customer, Webhook…), `SaleID` (sale docs), `TaskID` (production/fulfilment tasks).
- Humans use **display values**, not GUIDs: `SaleOrderNumber` (`"SO-00044"`), product `SKU`, customer `Name` (unique across customers), supplier `Name`. Resolve display value → GUID via the matching list endpoint before fetching detail.
- `LastModifiedOn` (DateTime, read-only) on master records (e.g. Customer) — change watermark.
- Multi-company: each Cin7 Core company is a separate tenant with its own Account ID — the connector reaches exactly the company whose credentials the user stored.

## Two entity surfaces

1. **List endpoints** (`/SaleList`, `/PurchaseList`, `/StockAdjustmentList`, `/StockTakeList`, `/StockTransferList`, `/Product`, `/Category`) — paginated summary rows + `Total`. Entry point for "find/list" questions.
2. **Document/detail endpoints** (`/Sale?SaleID={guid}`, `/Customer`, `/Purchase`…) — full objects. Sale and Purchase are **composite lifecycle documents**: the parent embeds stage sub-documents (quote, order, fulfilment, invoice, payments), and each stage also has its own endpoint for reads/writes.

## Entity catalog

### Product domain

| Entity              | Endpoint               | Ops            | Paginated | Notes                                                        |
| ------------------- | ---------------------- | -------------- | --------- | ------------------------------------------------------------ |
| Product             | `/Product`             | GET, POST, PUT | **Yes**   | SKU master; detail via `?ID={guid}`                          |
| ProductFamily       | `/ProductFamily`       | GET, POST, PUT | No        | Product groups/variants; attachments sub-resource            |
| Category            | `/Category`            | GET, POST, PUT | **Yes**   | Product categories                                           |
| ProductAvailability | `/ProductAvailability` | GET            | No        | Real-time stock on hand / allocated / available per location |
| ProductAttachments  | `/ProductAttachments`  | GET, POST      | No        | Files attached to products [UNVERIFIED ops]                  |

### Sale domain

| Entity         | Endpoint          | Ops            | Notes                                                                                   |
| -------------- | ----------------- | -------------- | --------------------------------------------------------------------------------------- |
| SaleList       | `/SaleList`       | GET            | Paginated summary; source of `SaleID`                                                   |
| Sale           | `/Sale`           | GET, POST, PUT | Full lifecycle document (all stages embedded)                                           |
| SaleQuote      | `/SaleQuote`      | GET, POST, PUT | Quote stage                                                                             |
| SaleOrder      | `/SaleOrder`      | GET, POST, PUT | Order stage                                                                             |
| SaleFulfilment | `/SaleFulfilment` | GET, POST, PUT | Fulfilment task; Pick/Pack/Ship sub-endpoints (`/SaleFulfilmentPick`, `…Pack`, `…Ship`) |
| SaleInvoice    | `/SaleInvoice`    | GET, POST, PUT | Invoice stage                                                                           |
| SaleCreditNote | `/SaleCreditNote` | GET, POST, PUT | Credit notes against a sale                                                             |
| SalePayments   | `/SalePayments`   | GET, POST, PUT | Payments against a sale                                                                 |

### Purchase domain

| Entity                | Endpoint                 | Ops            | Notes                   |
| --------------------- | ------------------------ | -------------- | ----------------------- |
| PurchaseList          | `/PurchaseList`          | GET            | Paginated summary       |
| Purchase              | `/Purchase`              | GET, POST, PUT | Full lifecycle document |
| PurchaseOrder         | `/PurchaseOrder`         | GET, POST, PUT | PO stage                |
| PurchaseStockReceived | `/PurchaseStockReceived` | GET, POST, PUT | Goods receipt           |
| PurchaseInvoice       | `/PurchaseInvoice`       | GET, POST, PUT | Supplier invoice        |
| PurchaseCreditNote    | `/PurchaseCreditNote`    | GET, POST, PUT | Purchase credit notes   |
| PurchasePayments      | `/PurchasePayments`      | GET, POST, PUT | Payments to supplier    |

### Stock domain (List endpoints paginated; detail/write endpoints not)

| Entity          | Endpoint                                      | Ops            | Notes                    |
| --------------- | --------------------------------------------- | -------------- | ------------------------ |
| StockAdjustment | `/StockAdjustment` (+ `/StockAdjustmentList`) | GET, POST, PUT | Quantity corrections     |
| StockTake       | `/StockTake` (+ `/StockTakeList`)             | GET, POST, PUT | Stocktake operations     |
| StockTransfer   | `/StockTransfer` (+ `/StockTransferList`)     | GET, POST, PUT | Inter-location transfers |

### Customer / Supplier domain

| Entity           | Endpoint            | Ops            | Notes                                      |
| ---------------- | ------------------- | -------------- | ------------------------------------------ |
| Customer         | `/Customer`         | GET, POST, PUT | NOT paginated — returns all; `Name` unique |
| CustomerCredits  | `/CustomerCredits`  | GET            | Credit balances                            |
| Supplier         | `/Supplier`         | GET, POST, PUT | NOT paginated                              |
| SupplierDeposits | `/SupplierDeposits` | GET, POST, PUT | Deposits held with supplier                |

### Production domain

| Entity          | Endpoint           | Ops            | Notes                                                                                            |
| --------------- | ------------------ | -------------- | ------------------------------------------------------------------------------------------------ |
| ProductionOrder | `/ProductionOrder` | GET, POST, PUT | Manufacturing orders (BOM-driven)                                                                |
| FinishedGoods   | `/FinishedGoods`   | GET, POST, PUT | Assembly into finished goods                                                                     |
| Disassembly     | `/Disassembly`     | GET, POST, PUT | Break finished goods into components; documented status machine + `Errors` partial-success array |
| FactoryCalendar | `/FactoryCalendar` | GET, POST, PUT | Working-day calendar [UNVERIFIED ops]                                                            |

### Reference books

| Entity          | Endpoint           | Ops                        | Notes                                                 |
| --------------- | ------------------ | -------------------------- | ----------------------------------------------------- |
| Location        | `/Location`        | GET, POST, PUT             | Warehouses/locations                                  |
| Brand           | `/Brand`           | GET, POST, PUT, **DELETE** |                                                       |
| Carrier         | `/Carrier`         | GET, POST, PUT, **DELETE** | Shipping carriers                                     |
| Tax             | `/Tax`             | GET, POST, PUT             | Tax rules (referenced by name, e.g. `"GST on Sales"`) |
| PriceTiers      | `/PriceTiers`      | GET                        | Price tier names                                      |
| PaymentTerm     | `/PaymentTerm`     | GET, POST, PUT             | Terms (referenced by name, e.g. `"30 days"`)          |
| UnitOfMeasure   | `/UnitOfMeasure`   | GET, POST, PUT             | UOM definitions                                       |
| ChartOfAccounts | `/ChartOfAccounts` | GET, POST, PUT             | PUT blocked while Xero/QBO integration active         |

### CRM domain

| Entity                  | Endpoint                     | Ops                  | Notes                                              |
| ----------------------- | ---------------------------- | -------------------- | -------------------------------------------------- |
| Lead                    | `/Lead`                      | GET, POST, PUT       | Convertible to Customer (webhook `Lead/Converted`) |
| Opportunity             | `/Opportunity`               | GET, POST, PUT       |                                                    |
| Task                    | `/Task`                      | GET, POST, PUT       | CRM tasks; `Task/Overdue` webhook                  |
| TaskCategory / Workflow | `/TaskCategory`, `/Workflow` | GET [UNVERIFIED ops] | CRM configuration                                  |

### Finance domain

| Entity                   | Endpoint                      | Ops              | Notes                              |
| ------------------------ | ----------------------------- | ---------------- | ---------------------------------- |
| Journal                  | `/Journal`                    | GET, POST, PUT   | Manual journal entries             |
| Transactions             | `/Transactions`               | GET              | Financial transactions (read-only) |
| MoneyTask / BankTransfer | `/MoneyTask`, `/BankTransfer` | [UNVERIFIED ops] | Money movements                    |

### System

| Entity  | Endpoint    | Ops                    | Notes                                      |
| ------- | ----------- | ---------------------- | ------------------------------------------ |
| Webhook | `/webhooks` | GET, POST, PUT, DELETE | Lowercase path; requires Automation module |
| Me      | `/me`       | GET                    | Current account/company details            |

## Key field definitions

### Customer

| Field                                       | Type     | Max  | Required       | Notes                                    |
| ------------------------------------------- | -------- | ---- | -------------- | ---------------------------------------- |
| `ID`                                        | GUID     | —    | Yes (PUT)      | Server-generated on POST                 |
| `Name`                                      | string   | 256  | **Yes**        | Unique across customers                  |
| `DisplayName`                               | string   | 256  | —              | Non-unique preferred name                |
| `Status`                                    | string   | —    | **Yes (POST)** | `Active` or `Deprecated`                 |
| `Currency`                                  | string   | 3    | **Yes**        | ISO 4217 code                            |
| `PaymentTerm`                               | string   | —    | **Yes**        | Must match an existing payment term name |
| `AccountReceivable`                         | string   | —    | **Yes**        | Account code from Chart of Accounts      |
| `RevenueAccount`                            | string   | —    | **Yes**        | Sale account code                        |
| `TaxRule`                                   | string   | —    | **Yes**        | Must match an existing tax rule name     |
| `PriceTier`                                 | string   | —    | —              | Price tier name                          |
| `Carrier`                                   | string   | —    | —              | Carrier name                             |
| `Discount`                                  | integer  | —    | —              | 0–100 (%)                                |
| `CreditLimit`                               | integer  | —    | —              |                                          |
| `Comments`                                  | string   | 2000 | —              |                                          |
| `TaxNumber`                                 | integer  | —    | —              | Tax/VAT number                           |
| `Tags`                                      | string   | —    | —              | Comma-delimited                          |
| `AttributeSet` / `AdditionalAttribute1..10` | string   | —    | —              | Custom attributes                        |
| `LastModifiedOn`                            | DateTime | —    | —              | UTC, read-only                           |
| `IsOnCreditHold`                            | boolean  | —    | —              |                                          |
| `IsLegalEntity`                             | boolean  | —    | —              | Default false                            |
| `CustomerParentID`                          | GUID     | —    | —              | Parent customer                          |
| `IsBillParent`                              | boolean  | —    | —              | Bill to parent's address                 |
| `ProductPrices`                             | array    | —    | —              | Customer-specific pricing                |
| `Addresses` / `Contacts`                    | array    | —    | —              | Child collections                        |
| `ChildCustomers`                            | array    | —    | —              | Read-only, response only                 |

### Chart of Accounts

| Field                        | Type         | Required       | Notes                                                |
| ---------------------------- | ------------ | -------------- | ---------------------------------------------------- |
| `Code`                       | string (50)  | **Yes**        | Unique account code                                  |
| `Name`                       | string (256) | **Yes**        |                                                      |
| `Type`                       | string       | **Yes**        | `BANK`, `CURRLIAB`, `LIABILITY`, `TERMLIA`, etc.     |
| `Status`                     | string       | **Yes**        |                                                      |
| `Class`                      | string       | —              | `ASSET`, `LIABILITY`, `EXPENSE`, `EQUITY`, `REVENUE` |
| `Bank` / `BankAccountNumber` | string       | If Type=`BANK` |                                                      |
| `Currency`                   | string       | —              | Read-only                                            |

### Webhook subscription

| Field                                   | Type    | Required      | Notes                                    |
| --------------------------------------- | ------- | ------------- | ---------------------------------------- |
| `ID`                                    | GUID    | PUT/DELETE    | Server-generated on POST                 |
| `Type`                                  | string  | **Yes**       | Event type (see `01d` — 31 types)        |
| `IsActive`                              | boolean | **Yes**       | `false` after 6 failed deliveries (auto) |
| `ExternalURL`                           | string  | **Yes**       | Customer's callback URL                  |
| `ExternalAuthorizationType`             | string  | **Yes**       | `noauth` \| `basicauth` \| `bearerauth`  |
| `ExternalUserName` / `ExternalPassword` | string  | If basicauth  |                                          |
| `ExternalBearerToken`                   | string  | If bearerauth |                                          |
| `ExternalHeaders`                       | array   | —             | Extra key/value headers                  |

### Disassembly status values

| Status             | Meaning                       |
| ------------------ | ----------------------------- |
| `DRAFT`            | Not yet started               |
| `WORK IN PROGRESS` | Auto-picks items              |
| `COMPLETED`        | Auto-picks, orders, completes |
| `VOIDED`           | Cancelled                     |

## Entity relationships

```
ORDER-TO-CASH                                   PROCURE-TO-PAY
┌──────────┐ 1:N ┌────────────────────────┐     ┌──────────┐ 1:N ┌──────────────────────────┐
│ Customer │────>│ Sale (composite doc)   │     │ Supplier │────>│ Purchase (composite doc) │
└────┬─────┘     │  SaleQuote             │     └────┬─────┘     │  PurchaseOrder           │
     │ 1:N       │  → SaleOrder           │          │ 1:N      │  → PurchaseStockReceived │
     ▼           │  → SaleFulfilment      │          ▼          │  → PurchaseInvoice       │
CustomerCredits  │    (Pick/Pack/Ship)    │   SupplierDeposits  │  → PurchasePayments      │
                 │  → SaleInvoice         │                     │  (PurchaseCreditNote)    │
   Lead ──conv──>│  → SalePayments        │                     └──────────┬───────────────┘
 (CRM, 1:N Tasks)│  (SaleCreditNote)      │                                │ receives stock
                 └──────────┬─────────────┘                                ▼
                            │ lines reference                   ProductAvailability
                            ▼                                   (per Location)
                 Product ──< ProductFamily                          ▲
                    │  belongs to Category, Brand                   │ adjusts
                    └── BOM ──> ProductionOrder / FinishedGoods   StockAdjustment /
                                / Disassembly                     StockTake / StockTransfer
Webhooks listen to Sale / Purchase / Stock / Product / Customer / Supplier / CRM state changes
```

## Lifecycle state machines

### Sale

```
Draft ──> Quote Authorised ──> Order Authorised ──> Fulfilment (Pick → Pack → Ship)
                                     │                        │
                                Backordered            Invoice Authorised ──> Paid
                                                       (partial → full payment)
Voided (reachable from any stage); Undo reverses an authorised stage
```

- Each transition fires the matching webhook event (`Sale/QuoteAuthorised`, `Sale/OrderAuthorised`, `Sale/PickAuthorised`, `Sale/PackAuthorised`, `Sale/ShipmentAuthorised`, `Sale/InvoiceAuthorised`, `Sale/PartialPaymentReceived`, `Sale/FullPaymentReceived`, `Sale/Voided`, `Sale/Backordered`, `Sale/Undo`).
- Stage documents carry a `Status` (e.g. `DRAFT`, `AUTHORISED` — full value set per stage [UNVERIFIED]).
- Advance via stage endpoints; exact transition bodies [UNVERIFIED], see `01c`.

### Purchase

```
Draft ──> PO Authorised ──> Stock Received ──> Invoice Authorised ──> Paid
                                  │
                          Credit Note Authorised
```

Webhook events: `Purchase/OrderAuthorised`, `Purchase/StockReceivedAuthorised`, `Purchase/InvoiceAuthorised`, `Purchase/CreditNoteAuthorised`, `Purchase/Updated`.

### Disassembly

```
DRAFT ──> WORK IN PROGRESS ──> COMPLETED
   └──> VOIDED
```

`WORK IN PROGRESS` auto-picks items; `COMPLETED` auto-picks, orders, and completes. Partial failures surface in the `Errors` array of a 200 response.

## Business rules

| Rule                                                                                                                                                 | Source                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Customer `Name` unique (max 256 chars)                                                                                                               |                        |
| Customer POST requires `Name`, `Status`, `Currency`, `PaymentTerm`, `AccountReceivable`, `RevenueAccount`, `TaxRule`                                 |                        |
| `PaymentTerm`, `TaxRule`, account codes, `PriceTier`, `Carrier` resolved **by name/code** against existing reference books — create/read those first |                        |
| `Discount` must be 0–100                                                                                                                             |                        |
| `/ChartOfAccounts` PUT disabled while a Xero/QuickBooks integration is active                                                                        |                        |
| Webhooks require the Automation module add-on; max 5 active per event type; auto-deactivate after 6 failed deliveries                                |                        |
| Sales/purchases must advance through their stage sequence — skipping may violate business rules                                                      |                        |
| Rate limit per Application Key (60/min)                                                                                                              |                        |
| Leading zeros in SKUs dropped by CSV import/export — affects spreadsheet round-trips, not the JSON API                                               | third-party consultant |
| Long numeric barcodes in scientific notation are rejected                                                                                            | third-party consultant |

## Field format reference

| Format                  | Pattern                       | Example                                | Notes                                                                           |
| ----------------------- | ----------------------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| ID                      | GUID string                   | `91EE7B1D-BD35-4E43-B98A-DB86BE777624` | Server-generated; never construct                                               |
| DateTime                | `yyyy-MM-ddTHH:mm:ss.fff` UTC | `2012-11-14T13:28:33.363`              | No `Z` suffix                                                                   |
| Date (webhook payloads) | `yyyy-MM-dd`                  | `2025-10-27`                           | Observed in documented payloads                                                 |
| Currency code           | ISO 4217                      | `NZD`                                  | 3 letters                                                                       |
| Money                   | plain number                  | `49.99`                                | Company base currency unless stated                                             |
| Boolean                 | JSON `true`/`false`           | `true`                                 | Webhook payloads use string `"0"`/`"1"` for some flags                          |
| Percentage              | integer 0–100                 | `10`                                   | e.g. Customer `Discount`                                                        |
| Display numbers         | string                        | `SO-00044`                             | `SaleOrderNumber` etc.; resolve to GUID via list endpoints                      |
| Enums                   | UPPER or Mixed strings        | `Active`, `DRAFT`, `AUTHORISED`        | Per-field value sets; many [UNVERIFIED] — read existing records to learn values |
