---
api_name: Jiwa Financials
api_slug: jiwa
doc: domain-model-reference (companion to 01-llm-api-rules.md)
base_url: per-customer self-hosted instance; no shared host. call_surface: HTTP via `numa integrations request` (connector jiwa). verbs PATCH not PUT.
field_casing: PascalCase
id_format: RecID — opaque string, typically 20 chars; never parse/construct
confidence: spec/docs-derived, NOT live-validated. [SPEC]=OpenAPI DTOs, [DOCS]=Jiwa wiki, [UNVERIFIED]=inferred. Treat all as unconfirmed until tested.
note: Field tables are SELECTED key fields — full DTOs are much larger (prop counts noted per entity). Pull `{instance}/openapi` for complete shapes. All field data [SPEC] unless tagged.
---

# Jiwa Financials — Domain Model Reference

Entity catalog, relationships, lifecycle/status fields, and business rules.

## ID semantics — RecIDs

- Every PK is a **RecID: opaque string, typically 20 chars**. Two styles in real data: zero-padded sequential (`0000000061000000001V`) and hex-ish (`5244dd5e199749f4b6fe`, `babce67cdbf64f778536`). Treat both as opaque [DOCS].
- PK property name differs per entity: `DebtorID`, `CreditorID`, `InventoryID`, **`InvoiceID` (sales order)**, `QuoteID`, `PurchaseOrderID`, `GRNID`, `PurchaseInvoiceID`, `ShipmentID`, `BookInID`, `WorkOrderID`, `BillID`, `JournalSetID`, `WarehouseTransferOutID`, `StaffID`, `CarrierID`, `ToDoID` [SPEC].
- Server generates RecIDs on POST — never supply the PK on create; the response DTO carries the new ID [DOCS].
- **Custom-field `SettingID`s are space-padded** — e.g. `"1ae102b94dc54dfc8a45                "`. URL-encode trailing spaces as `%20` in paths; never trim [DOCS].
- Sub-entity IDs follow the same pattern: `InvoiceLineID`, `InvoiceHistoryID`, `QuoteLineID`, `NoteID` (sometimes GUID-with-dashes, e.g. `DE91CC53-724A-...`), `DocumentID`, `PaymentID` [DOCS].
- Humans use **display numbers**, not RecIDs: `AccountNo` (debtor/creditor), `PartNo` (inventory), `InvoiceNo`/`OrderNo` (sales order), `QuoteNo`, `OrderNo` (PO), `SlipNo` (GRN), `ShipmentNo`, `WorkOrderNo`, `SetNo` (journal set). Resolve display number → RecID via the matching `/Queries/*` route before hitting an entity route [SPEC].

## Two route families

1. **Business-object routes** (`/Debtors/{DebtorID}`, `/SalesOrders/{InvoiceID}`…) — full DTO in/out, business logic runs (pricing, defaults, journals). Use for reads-by-ID and ALL writes.
2. **AutoQuery routes** (`/Queries/...`) — read-only, filterable, paginated projections of DB tables (`SO_Main`, `DB_Main`, `CR_Main`, `IN_Main`…) and joined views (`SalesOrderList`, `DebtorList`, `InventoryItemList`…). Common params on every query DTO: `Skip`, `Take`, `OrderBy`, `OrderByDesc`, `Fields`, `Include=Total`, plus per-column operator suffixes (`Contains`, `StartsWith`, `GreaterThan`, `Between`, `In`…). `/Queries/OR/...` twins OR the criteria instead of ANDing [SPEC].

Query response wrapper [SPEC]: `{"Offset":n,"Total":n,"Results":[...]}`.

## Entity Catalog

### Debtor (Customer) — 87 props

**Paths:** `/Debtors/{DebtorID}` (GET/PATCH/DELETE), `POST /Debtors`. **Queries:** `/Queries/DebtorList` (joined view), `/Queries/DB_Main` (raw table), `/Queries/DebtorTransactionList` (AR txns). AR customer master — identity, terms, balances, pricing, contacts, delivery addresses. CRUD: Create/Read/Update(PATCH)/Delete (409 if referenced).

| Field                                                                      | Type       | Writable | Description                                       | Example                  |
| -------------------------------------------------------------------------- | ---------- | -------- | ------------------------------------------------- | ------------------------ |
| DebtorID                                                                   | string     | no (PK)  | RecID                                             | `"0000000061000000001V"` |
| AccountNo                                                                  | string     | yes      | Human account code — recommended on create [DOCS] | `"CASH001"`              |
| Name                                                                       | string     | yes      |                                                   | `"A new customer"`       |
| EmailAddress / Phone / Fax                                                 | string     | yes      |                                                   |                          |
| Address1..4, Postcode, Country                                             | string     | yes      | Address block (4 free lines)                      |                          |
| ABN / ACN                                                                  | string     | yes      | AU business identifiers                           |                          |
| CreditLimit                                                                | number     | yes      |                                                   | `10000.0`                |
| CurrentBalance, Period1..4Balance                                          | number     | no       | AR balances (computed)                            |                          |
| AccountOnHold                                                              | boolean    | yes      | Credit hold flag                                  | `false`                  |
| TradingStatus                                                              | string     | yes      | [values UNVERIFIED]                               |                          |
| TermsDays / TermsType / PeriodType                                         | int/string | yes      | Payment terms                                     | `30`                     |
| IsCashOnly                                                                 | boolean    | yes      |                                                   |                          |
| WebAccess                                                                  | boolean    | yes      | Web/portal enabled                                | `true`                   |
| PriceSchemeID / PriceSchemeDescription                                     | string     | yes/no   | Pricing scheme                                    |                          |
| ParentDebtorID                                                             | string     | yes      | Branch-account parent                             |                          |
| LastSavedDateTime                                                          | datetime   | no       | Optimistic-concurrency timestamp                  | `"2026-06-01T10:00:00"`  |
| Classification, Category1..5, PricingGroup                                 | object     | yes      | Taxonomy refs                                     |                          |
| ContactNames[]                                                             | array      | yes      | DebtorContactName, 28 props — own sub-routes too  |                          |
| DeliveryAddresses[], FreightForwarderAddresses[]                           | array      | yes      | Shipping addresses                                |                          |
| Notes[] / Documents[] / CustomFieldValues[] / Budgets[] / TagMemberships[] | array      | yes      | Child collections (upsert in PATCH)               |                          |

**Relationships:** Sales Orders 1:N (`DebtorID` on order); Sales Quotes 1:N; Transactions 1:N (`/Queries/DebtorTransactionList`); Parent/branch debtors (self-referencing); Classification/Categories N:1.

**DebtorContactName** (28 props, also at `/Debtors/{DebtorID}/ContactNames[/{ContactNameID}]`): `ContactNameID` (PK), `Title`/`FirstName`/`Surname`, `Phone`/`Mobile`/`Fax`/`EmailAddress`, `DefaultContact` (bool, primary flag), `Primary/Secondary/TertiaryPosition` (ID+Name, role taxonomy), `LogonCode`/`CustomerWebPortalPassword` (portal credentials — **never read or display**), `TagMemberships[]`/`CustomFieldValues[]`.

**DebtorDeliveryAddress** (18 props): `DeliveryAddressID`, `DeliveryAddressName`/`Code`, `IsDefault`, `Address1..4`, `Postcode`, `Country`, `Phone`, `EmailAddress`, `Notes`, `CourierDetails`, `Latitude`/`Longitude`, `EDIStoreLocationCode`. Picked onto orders as the frozen `DeliveryAddress*` block.

### Creditor (Supplier) — 35 props

**Paths:** `/Creditors/{CreditorID}` (GET/PATCH/DELETE), `POST /Creditors`. **Query:** `/Queries/CR_Main`. AP supplier master (slimmer than Debtor). CRUD: full.

| Field                                                    | Type   | Writable | Description                       | Example    |
| -------------------------------------------------------- | ------ | -------- | --------------------------------- | ---------- |
| CreditorID                                               | string | no (PK)  | RecID                             |            |
| AccountNo / AltAccountNo                                 | string | yes      | Supplier account code             | `"SUPP01"` |
| Name                                                     | string | yes      | Supplier name                     |            |
| Address1..4, Postcode, Country, Phone, Fax, EmailAddress | string | yes      | Contact block                     |            |
| ABN / ACN                                                | string | yes      | Business identifiers              |            |
| BankName / BankAccountNo / BankBSBN / BankAccountName    | string | yes      | Payment details                   |            |
| CreditLimit                                              | number | yes      | Credit limit                      |            |
| DefaultCurrencyID/-Name/-ShortName                       | string | yes/no   | FX currency                       | `"AUD"`    |
| Classification                                           | object | yes      | CreditorClassification ref        |            |
| WarehouseAddresses[]                                     | array  | yes      | Supplier warehouses (used on POs) |            |
| Notes[] / Documents[] / CustomFieldValues[] / Balances[] | array  | varies   | Child collections                 |            |

**Relationships:** Purchase Orders 1:N (`CreditorRecID`); GRNs 1:N; Purchase Invoices 1:N; Shipments via `ShippingAgentCreditorID`.

### Inventory Item (Product) — 89 props

**Paths:** `/Inventory/{InventoryID}` (GET/PATCH/DELETE), `POST /Inventory`. **Queries:** `/Queries/InventoryItemList` (incl. `AvailableStock`, `SellPrice`, `InStock`), `/Queries/IN_Main`, `/Queries/IN_SOH` + `/Queries/INSOHWithBinLocations` (stock-on-hand), `/Queries/BackOrderList`. Product/SKU master — pricing, costs, classifications, warehouses, BOM components, UoM. CRUD: full.

| Field                                                                                      | Type          | Writable | Description                                                                                                                                                         | Example  |
| ------------------------------------------------------------------------------------------ | ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| InventoryID                                                                                | string        | no (PK)  | RecID                                                                                                                                                               |          |
| PartNo                                                                                     | string        | yes      | SKU / part number (human key)                                                                                                                                       | `"1170"` |
| Description                                                                                | string        | yes      | Item description                                                                                                                                                    |          |
| Status                                                                                     | string        | yes      | Item status [values UNVERIFIED]                                                                                                                                     |          |
| DefaultPrice / RRPPrice                                                                    | number        | yes      | Sell prices                                                                                                                                                         | `15.45`  |
| LCost / SCost / StandardCost                                                               | number        | yes/no   | Last / standard costs                                                                                                                                               |          |
| SellPriceIncTax                                                                            | boolean       | yes      | Whether DefaultPrice includes tax                                                                                                                                   |          |
| PhysicalItem                                                                               | boolean       | yes      | Physical vs non-physical (service/charge)                                                                                                                           | `true`   |
| UseSerialNo / UseExpiryDate                                                                | boolean       | yes      | Serial/batch tracking flags                                                                                                                                         |          |
| BackOrderable / Discountable / WebEnabled                                                  | boolean       | yes      | Behavior flags                                                                                                                                                      |          |
| UnitMeasure                                                                                | string        | yes      | Base unit of measure                                                                                                                                                | `"EACH"` |
| Weight / Cubic                                                                             | number        | yes      | Shipping dimensions                                                                                                                                                 |          |
| GSTOutwardsRate / GSTInwardsRate (+IDs)                                                    | number/string | yes      | Tax in/out config                                                                                                                                                   |          |
| Classification, Category1..5                                                               | object        | yes      | Taxonomy refs                                                                                                                                                       |          |
| WarehouseSOHs[]                                                                            | array         | no       | Stock per warehouse: `IN_LogicalID`, `Warehouse`, `TotalSOH`, `TotalBackOrders`, `UnprocessedSales`, `WarehouseTransfers`, `ForwardRequirements`, `BOMComponentWIP` |          |
| DebtorPrices[] / DebtorClassPrices[] / SellingPrices                                       | array/object  | yes      | Customer-specific pricing                                                                                                                                           |          |
| Components[]                                                                               | array         | yes      | BOM components (kit items)                                                                                                                                          |          |
| UnitOfMeasures[], AlternateChildren[], Notes[], Documents[], CustomFieldValues[], Images[] | array         | yes      | Child collections                                                                                                                                                   |          |

**Relationships:** Sales Order Lines N:1 (`InventoryID`/`PartNo`); PO Lines N:1; Warehouses N:M via WarehouseSOHs; Bill/Work Order inputs+outputs; supplier part numbers per Creditor.

### Sales Order (+ History snapshots + Lines + Payments) — header 105 props

**Paths:** `POST /SalesOrders`; `/SalesOrders/{InvoiceID}` (GET/PATCH); lines `/SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines[/{InvoiceLineID}]` (GET/POST/PATCH/DELETE); payments `/SalesOrders/{InvoiceID}/Payments[/{PaymentID}]`; process `GET /SalesOrders/{InvoiceID}/Process`. **Queries:** `/Queries/SalesOrderList` (joined customer+delivery view), `/Queries/SO_Main`, `/Queries/v_Jiwa_SalesInformation`. The AR order/invoice document. **Snapshot-based**: each order owns `Histories[]` (SalesOrderHistory); the current history holds the live lines, delivery and print state. The header DTO exposes `Lines[]` for the current snapshot as a convenience. **No top-level DELETE route** [SPEC]. CRUD: Create/Read/Update (PATCH header upserts Lines/Notes/Payments)/Process (posts financials).

Header (key fields):

| Field                                                                                | Type          | Writable | Description                                      | Example        |
| ------------------------------------------------------------------------------------ | ------------- | -------- | ------------------------------------------------ | -------------- |
| InvoiceID                                                                            | string        | no (PK)  | RecID                                            |                |
| InvoiceNo                                                                            | string        | no       | Human order/invoice number (generated)           | `"104001"`     |
| Status                                                                               | string        | varies   | Order status [values UNVERIFIED — see lifecycle] |                |
| OrderNo                                                                              | string        | yes      | Customer's PO / order reference                  | `"1234"`       |
| SOReference                                                                          | string        | yes      | Free-text reference                              | `"Test order"` |
| DebtorID / DebtorAccountNo / DebtorName                                              | string        | create   | Customer (ID wins if both [DOCS])                |                |
| InitiatedDate / ExpectedDeliveryDate / DeliveredDate                                 | datetime      | yes      | Key dates                                        |                |
| Delivered                                                                            | boolean       | no       | Delivery complete                                |                |
| CreditNote                                                                           | boolean       | create   | True = credit note document                      | `false`        |
| DeliveryAddress\* (Addressee, 1, 2, Suburb, State, Postcode, Country, Phone, Notes…) | string        | yes      | Shipping address block                           |                |
| LogicalID / LogicalWarehouseDescription / PhysicalWarehouseDescription               | string        | yes/no   | Fulfilling warehouse                             |                |
| StaffID / StaffUserName…                                                             | string        | no       | Owning staff member                              |                |
| CurrencyID / CurrencyRate / CurrencyShortName                                        | string/number | yes/no   | FX info                                          | `"AUD"`        |
| OrderedExGSTTotal / OrderedGSTTotal / OrderedIncGSTTotal (+FX twins, +Lines\* twins) | number        | no       | Computed totals                                  |                |
| Lines[] / Payments[] / Notes[] / Documents[] / CustomFieldValues[] / Histories[]     | array         | yes      | Child collections                                |                |

**SalesOrderLine** (68 props — key fields):

| Field                                              | Type        | Writable | Description                                                     | Example  |
| -------------------------------------------------- | ----------- | -------- | --------------------------------------------------------------- | -------- |
| InvoiceLineID                                      | string      | no (PK)  | Present in PATCH body = update; absent = append [DOCS]          |          |
| InventoryID / PartNo                               | string      | create   | Item (ID wins if both [DOCS])                                   | `"1170"` |
| Description                                        | string      | yes      | Line description (defaults from item)                           |          |
| QuantityOrdered                                    | number      | yes      | Ordered qty                                                     | `5`      |
| QuantityThisDel / QuantityBackOrd / QuantityDemand | number      | varies   | Delivery/backorder splits                                       |          |
| DiscountedPrice                                    | number      | yes      | Unit price — **omit to let Jiwa price the line** [DOCS]         | `15.67`  |
| PriceExGst / PriceIncGst / TaxToCharge / LineTotal | number      | no       | Computed pricing                                                |          |
| DiscountedPercentage / DiscountGiven               | number      | yes      | Discounting                                                     |          |
| CommentLine + CommentText                          | bool+string | yes      | `{"CommentLine":true,"CommentText":"..."}` = comment row [DOCS] |          |
| TaxRate                                            | object      | yes      | TaxRate ref                                                     |          |
| LineDetails[]                                      | array       | varies   | Serial/bin/SOH allocations                                      |          |
| CustomFieldValues[]                                | array       | yes      | Per-line custom fields                                          |          |

**SalesOrderHistory** (78 props): `InvoiceHistoryID`, `HistoryNo` (snapshot counter), `Status` (wiki PATCHes it as a **number**, e.g. `{"Status":2}` [DOCS]; value meanings UNVERIFIED), totals, `AmountPaid`, delivery-address freeze, print/email flags (`InvoicePrinted`, `PickSheetPrinted`…), `ConsignmentNote`. To change most history fields, PATCH the parent sales order — it writes through to the current snapshot [DOCS].

**SalesOrderPayment** (20 props): `PaymentID`, `PaymentType` (ref — omit on create for instance default [DOCS]), `AmountPaid` (+FX twin), `PaymentDate`, `PaymentRef`, `ProcessPayment`/`Processed`, `AuthorisationStatus`/`AuthorisationNumber`, payment-gateway return fields, card/bank detail fields (**never read or display card/bank numbers**).

**SalesOrderLineDetail** (12 props — serial/bin allocations under each line): `LineDetailID`, `SOHID`, `Quantity`, `SerialNo`, `ExpiryDate`, `BinLocationID`/`BinLocation`, `IN_LogicalID`, `Cost`, `DateIn`. Bulk-replace a line's details with `PUT /SalesOrders/{InvoiceID}/{InvoiceLineID}/LineDetails` (one of the rare PUT routes [SPEC]).

**Relationships:** Debtor N:1; Lines → InventoryItem N:1; Payments 1:N (typed by SalesOrderPaymentType); Warehouse N:1; Carrier consignment notes under `/Historys/{id}/Carrier/...`; credit notes reference originating history (`CreditNoteFromInvoiceHistoryID`).

### Sales Quote — 73 props

**Paths:** `POST /SalesQuotes`; `/SalesQuotes/{QuoteID}` (GET/PATCH); lines `/SalesQuotes/{QuoteID}/Historys/{QuoteHistoryID}/Lines[/{QuoteLineID}]`; convert `POST /SalesQuotes/{QuoteID}/MakeOrder` (or `/MakeOrderB2B`). **Queries:** `/Queries/SalesQuoteList`, `/Queries/QO_Main`. Quote document mirroring the sales order shape — same snapshot/Historys model, same Debtor + Lines structure, `QuoteID`/`QuoteNo` keys, `SalesQuoteType`, `ExpectedDeliveryDate`. Lines (SalesQuoteLine, 41 props) mirror order lines minus delivery quantities. CRUD: Create/Read/Update; MakeOrder converts to a Sales Order [SPEC].

### Purchase Order — 85 props

**Paths:** `POST /PurchaseOrders/` (note trailing slash in spec); `/PurchaseOrders/{PurchaseOrderID}` (GET/PATCH/DELETE); lines `/PurchaseOrders/{PurchaseOrderID}/Lines[/{PurchaseOrderLineID}]`; activate `POST /PurchaseOrders/Activate/{PurchaseOrderID}`; split/copy `POST /PurchaseOrders/FromPurchaseOrderLines`. **Queries:** `/Queries/PO_Main`, `/Queries/PurchaseOrderSelection`. AP purchase document. NOT snapshot-based — lines are a direct child collection. CRUD: full; Activate.

| Field                                                                            | Type     | Writable | Description                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PurchaseOrderID                                                                  | string   | no (PK)  | RecID                                                                                                                                                                             |
| OrderNo                                                                          | string   | yes      | PO number                                                                                                                                                                         |
| OrderDate                                                                        | datetime | yes      | Order date                                                                                                                                                                        |
| OrderStatus                                                                      | string   | varies   | Status [values UNVERIFIED]                                                                                                                                                        |
| OrderType / OrderSupplierType                                                    | string   | yes      | Type flags                                                                                                                                                                        |
| CreditorRecID / CreditorAccountNo / CreditorName                                 | string   | create   | Supplier                                                                                                                                                                          |
| CreditorWarehouseRecID                                                           | string   | yes      | Supplier warehouse to order from                                                                                                                                                  |
| LogicalWarehouseResidingIn/-OrderingFrom/-InTransit (RecID+Description ×3 pairs) | string   | yes      | Warehouse routing                                                                                                                                                                 |
| UseInTransit                                                                     | boolean  | yes      | Route stock through an in-transit warehouse                                                                                                                                       |
| Reference / Attention / ContactBy                                                | string   | yes      | Header texts                                                                                                                                                                      |
| Freight / Duty / TaxTotal / TotalGross / TotalNet (+FX twins)                    | number   | varies   | Costs/totals                                                                                                                                                                      |
| Lines[]                                                                          | array    | yes      | PurchaseOrderLine (82 props): `PurchaseOrderLineID`, `InventoryID`/`PartNo`, `SupplierPartNo`, `Quantity`, `IncPrice`, `TaxAmount`, `DeliveryDate`, `Delivered`, job-costing refs |
| Notes[] / Documents[] / CustomFieldValues[] / ReceivalDocuments[]                | array    | yes      | Children                                                                                                                                                                          |

**Relationships:** Creditor N:1; Lines → InventoryItem; received by GRNs/Shipments (`/GoodsReceivedNotes/FromPurchaseOrders/{OrderNos}`, `/Shipments/FromPurchaseOrders/{OrderNos}`); back-orders link via `IN_OnBackOrder_*` line fields.

### Goods Received Note (GRN) — 57 props

**Paths:** `POST /GoodsReceivedNotes`; `/GoodsReceivedNotes/{GRNID}` (GET/PATCH/DELETE); from POs `POST /GoodsReceivedNotes/FromPurchaseOrders/{OrderNos}` or `/FromPurchaseOrderLines`; activate `POST /GoodsReceivedNotes/Activate/{GRNID}`; lines `/GoodsReceivedNotes/{GRNID}/Lines`. **Query:** `/Queries/GR_ReceivalDocuments`. Receipt of supplier goods into a warehouse. Key fields: `GRNID`, `SlipNo`, `SlipDate`, `Status` [UNVERIFIED], `CreditorID/-AccountNo/-Name`, warehouse IDs/descriptions, `Freight`/`Duty`/`Insurance` (+tax splits), `TotalGross`/`TotalNet` (+FX), **`Invoiced` boolean + `PI_MainID`** (set once a purchase invoice consumes it), `Lines[]` (GoodsReceivedNoteLine, 81 props: `QuantityOrdered`/`QuantityDelivered`, `OrderID`/`OrderNo`/`OrderLineID` PO back-refs, `Cost`, ledger account refs), `PurchaseOrders[]` received against.
**Lifecycle:** create (from PO) → edit lines/costs → **Activate** (posts to stock/GL) → invoiced by a Purchase Invoice [SPEC / UNVERIFIED ordering].

### Purchase Invoice — 55 props

**Paths:** `POST /PurchaseInvoices`; `/PurchaseInvoices/{PurchaseInvoiceID}` (GET/PATCH/DELETE); from GRNs `POST /PurchaseInvoices/FromGoodsReceivedNotes/{GRNNos}`; activate `POST /PurchaseInvoices/Activate/{PurchaseInvoiceID}`. **Query:** `/Queries/PI_Main`. Supplier invoice matching one or more GRNs. Key fields: `PurchaseInvoiceID`, `InvoiceNo` (supplier's number), `InvoiceDate`, `DueDate`, `Status` [UNVERIFIED], `CreditorID/-AccountNo/-Name`, `Freight`/`Duty`/`Insurance` + tax splits, `TaxAdjustment`, `TotalGross`/`TotalNet` (+FX), currency fields, `Lines[]`, `GoodsReceivedNotes[]` consumed.
**Relationships:** Creditor N:1; GRNs N:M (`/PurchaseInvoices/{id}/GoodsReceivedNotes`).

### Shipment (25 props) & Book-In (12 props) — Landed Cost

**Shipment paths:** `POST /Shipments`; `/Shipments/{ShipmentID}` (GET/PATCH/DELETE); from POs `POST /Shipments/FromPurchaseOrders/{OrderNos}`; activate `POST /Shipments/Activate/{ShipmentID}`. **Query:** `/Queries/SH_Main`. Imported-goods consignment: `ShipmentNo`, `Status` [UNVERIFIED], `DepartureDate`/`ExpectedArrivalDate`/`ScheduledArrivalDate`/`ReceiptDate`, `WayBillNo`, `VesselName`, `ContainerNo`, `ShippingAgentCreditor*`, `Lines[]`, `PurchaseOrders[]`, `ImportCosts[]`, `VOTIs[]`, `Invoices[]`.
**BookIn paths:** `POST /BookIns/FromShipmentID/{ShipmentID}` (or `/FromShipmentNo/{ShipmentNo}`); `/BookIns/{BookInID}` (GET/PATCH); activate `POST /BookIns/Activate/{BookInID}`. **Query:** `/Queries/SH_BookInMain`. Books shipment stock into the warehouse: `BookInNo`, `BookInDate`, **`Activated` boolean**, `GL_Sets_RecID` (journal posted), `Lines[]`, `OtherBookInsForThisShipment[]`. Landed-cost variants exist as `/LandedCost*` DTOs [SPEC].

### Warehouse & Transfers

- **Warehouses are queried, not CRUDed**: `/Queries/IN_Logical` (logical), `/Queries/IN_Physical` (physical), `/Queries/WarehouseSelection`, `/Queries/IN_WarehouseSOH` (stock per warehouse). Logical warehouses nest inside physical ones; documents carry both `Logical*` and `Physical*` descriptions [SPEC].
- **Warehouse Transfer Out** (45 props): `POST /WarehouseTransfersOut`; `/WarehouseTransfersOut/{id}` (GET/PATCH/DELETE); `POST /WarehouseTransfersOut/Activate/{id}`; lines + `ReceiveIns` sub-routes. Fields: `TransferNo`, `TransferDate`, `Status` [UNVERIFIED], `Source*`/`Destination*`/`InTransit*` warehouse triplets, `UseInTransit`, `AddedCost1..3`, `TransferredCost`, `TotalCost`, `Lines[]`, `ReceiveIns[]`.
- **Warehouse Transfer In:** mirror routes `/WarehouseTransfersIn/...` receive stock at the destination. **Queries:** `/Queries/WH_Transfer`, `/Queries/IN_Transfer` [SPEC].

### Work Order & Bill (Manufacturing)

- **Bill** (`/Bills`, `/Queries/BM_Main`, 14 props) = bill of materials / routing template: `BillNo`, `Description`, `IsEnabled`, `MaximumProductionCapability`, `Stages[]` (BillStage with Inputs/Instructions), `Outputs[]`, `ProductionLine`, `BillParents[]`.
- **Work Order** (`/WorkOrders`, `/Queries/WorkOrderSelection`, `/Queries/BM_WorkOrder`, 32 props) = production run of a Bill: `WorkOrderNo`, `BillID/BillNo/BillDescription`, `DateCreated`/`DateRequired`/`PlannedStartDate`/`ActualStartDate`/`DateCompleted`, `ProductionQuantity`, `Status` (string) + `ConfigurableStatus` (WorkOrderStatus object — customer-defined statuses, per-instance values [UNVERIFIED]), `WorkOrderType`, `AssignedTo` (StaffMember), `Stages[]`, `Outputs[]`, `Allocations[]`, `TimeSheetLines[]`, warehouse fields. `POST /WorkOrders/Reversal` reverses one; `ReversalWorkOrderID` links the pair [SPEC].

### Journal Set (General Ledger) — 27 props

**Paths:** `POST /JournalSets/`; `/JournalSets/{JournalSetID}` (GET/PATCH/DELETE); lines `/JournalSets/{JournalSetID}/Lines[/{JournalSetLineID}]`. **Queries:** `/Queries/GL_Sets`, `/Queries/GL_Ledger` (accounts), `/Queries/GL_Category`. GL journal batch: `SetNo`, `SetType`, `Description`, `Source`/`SourceID` (originating document), `PostedDate`, `PostedToPeriodNo/-Name/-YearNo` + period-lock flags, reversal fields (`IsReversed`, `ReverseType`, `ReverseDate`), repeating-journal fields (`RepeatingType`, `NextRepeatingDate`, `RepeatingEndDate`), `Staff`, `Lines[]`.
**JournalSetLine** (20 props): `ItemNo`, `Reference`, `Remark`, `DebitAmount`/`CreditAmount`, `GeneralLedgerAccountRecID/-AccountNo/-Description`, `TransCode1/2`, `BASCode`, job-costing refs. Debits and credits must balance [UNVERIFIED — standard accounting rule, not in spec].

### Staff

**Routes:** read via `/Queries/HR_Staff` and `/Queries/StaffUserGroups`; no general staff CRUD — only `/Staff/Department`, `/Staff/Timesheet` (POST + id routes), and password ops (`/Staff/{StaffID}/PasswordChange`, `/Staff/{Username}/PasswordReset`) [SPEC]. **StaffMember DTO** (embedded, 7 props): `StaffID`, `Title`, `FirstName`, `Surname`, `Username`, `IsActive`, `IsEnabled`. The HR_Staff query row adds `EmailAddress`, `Position1/2`, department ref, `Mobile` (plus sensitive columns — **do not select password/SQL credential fields**).

### Carrier — 8 props

**Paths:** `POST /Carriers`; `/Carriers/{CarrierID}` (GET/PATCH/DELETE); services `/Carriers/{CarrierID}/Services`; freight descriptions `/Carriers/{CarrierID}/FreightDescriptions`. **Query:** `/Queries/FR_Carriers`. Freight carrier: `CarrierName`, `AccountNo`, `Enabled`, `Notes`, `Services[]`, `FreightDescriptions[]`. Used on sales order history consignment notes (`/SalesOrders/{id}/Historys/{hid}/Carrier/ConsignmentNotes`, `/FreightItems`).

### To Do — 28 props

**Paths:** `POST /ToDos`; `/ToDos/{ToDoID}` (GET/PATCH/DELETE); `/Collaborations`, `/Dependencies`, `/Documents` sub-routes. Task assigned between staff: `ToDoNo`, `Subject`, `Body`, `AssignedBy`/`AssignedTo` (StaffMember), `DueDateTime`, `DurationInHours`, `CompletePercentage` (0–100), `FinishedDateTime`, `Status` + `ToDoType` + `Priority` (objects — customer-defined values [UNVERIFIED]), reminder fields (`ReminderEnabled`, `ReminderDateTime`, `ReminderTrigger`), `Source` (RecordLink to originating record), `Dependencies[]`, `Collaborations[]`.

### Webhook Subscriptions

**Routes:** `/Webhooks/Events/` (GET available events, POST raise), `/Webhooks/Subscribers/` (GET/POST), `/Webhooks/Subscribers/{SubscriberID}/Subscriptions/` (GET/POST; PATCH/DELETE on `/{SubscriptionID}/`), message logs `/Webhooks/Subscribers/{SubscriberID}/Messages[/Responses]`, `POST /Webhooks/Test/`. **Query:** `/Queries/SY_WebhookSubscriber`. Model: Subscriber (`Name`, `IsEnabled`) → Subscriptions (`EventName`, `URL`, `LastMessageResponseHTTPCode`, `RetryAfterDateTime`) → Messages (delivery log: `Status`, `Retries`, `Body`, response codes). Retry backoff = `10^(RetryNo × WebhooksRetryInterval)` seconds, capped by WebhooksMaxRetries [DOCS]. **No Numa receiver exists — informational only.**

### Shared sub-objects (appear on most entities) [SPEC]

| DTO              | Key fields                                                                                       | Notes                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Note             | `NoteID`, `NoteType` (ref), `NoteText`, `LineNo`, LastModifiedByStaff\*                          | Omit `NoteType` on create → instance default [DOCS]     |
| Document         | `DocumentID`, `DocumentType` (ref), `PhysicalFileName`, `Description`, **`FileBinary` (base64)** | Embedded file content — large payloads                  |
| CustomFieldValue | `SettingID` (space-padded!), `SettingName`, `Contents` (string), `PluginID`/`PluginName`         | All values serialized as strings (e.g. `"True"`) [DOCS] |
| TaxRate          | rate/description/ledger refs; tax codes queryable via `/Queries/TX_Main`                         |                                                         |

## Entity Relationship Diagram

```
ORDER-TO-CASH                                      PROCURE-TO-PAY
┌─────────┐ 1:N ┌────────────┐                     ┌──────────┐ 1:N ┌───────────────┐
│ Debtor  │────>│ SalesQuote │--MakeOrder--┐       │ Creditor │────>│ PurchaseOrder │
│(customer)│    └────────────┘             ▼       │(supplier)│     └───────┬───────┘
└────┬────┘ 1:N ┌────────────┐      ┌────────────┐ └────┬─────┘  FromPOs────┼────FromPOs
     │─────────>│ SalesOrder │<─────┘             │     │ 1:N        ▼      ▼
     │          └─────┬──────┘                    │     │      ┌─────────┐ ┌──────────┐
     │ AR txns        │ 1:N Histories (snapshots) │     │      │   GRN   │ │ Shipment │
     ▼                ▼                           │     │      └────┬────┘ └────┬─────┘
(DebtorTransaction    Lines ──N:1── InventoryItem ──N:1 lines      │ FromGRNs   │ BookIn
 List query)          Payments         │  ▲                        ▼            ▼
                                       │  └── Bill ──> WorkOrder  PurchaseInvoice  (stock
GET /Process posts ──> JournalSet      │      (BOM)   (production)  (AP invoice)  booked in)
journals + AR txns     (GL batch)      └── WarehouseSOH per Logical/Physical Warehouse
                                            (WarehouseTransferOut ──> WarehouseTransferIn)
```

## Lifecycle & status

> Most `Status` fields are bare strings in the spec with **no enum values declared** — concrete values are per-version/per-instance. Discover empirically: query the route with `Fields=Status&Take=200`, inspect distinct values before branching. Values below are [UNVERIFIED] unless tagged.

**Sales Order:** `[created/entered] --edit lines/payments--> [current snapshot] --GET /Process--> [processed: journals + AR posted]`. New snapshot per history cycle; `CreditNote=true` variant; PATCH header writes through to current snapshot [DOCS]. `Status` (header, string) + `Histories[].Status` — wiki updates history status with a **numeric** body `{"Status":2}` [DOCS]; number→state map UNVERIFIED. Processing posts journals + debtor transactions; expect 409 if business logic refuses [DOCS]. Delivery tracked per history (`Delivered`, `DeliveredDate`, `QuantityThisDel`/`QuantityBackOrd` per line). Print/email flags (`InvoicePrinted`, `PickSheetEmailed`…) server-maintained.

**Sales Quote:** `[quote] --POST /SalesQuotes/{QuoteID}/MakeOrder--> [sales order created]`. One-way conversion [SPEC]; quote retains its own ID/history.

**Purchase cycle:**

```
[PO created] --POST /PurchaseOrders/Activate/{id}--> [active PO]
     └─> GRN (FromPurchaseOrders) --Activate--> [stock received, Invoiced=false]
              └─> PurchaseInvoice (FromGoodsReceivedNotes) --Activate--> [AP posted; GRN.Invoiced=true, GRN.PI_MainID set]
Imports: Shipment (FromPurchaseOrders) --Activate--> BookIn (FromShipmentID) --Activate--> [stock + landed costs]
```

All "Activate" endpoints are POST with the document ID in the path; activation is the posting step [SPEC]. Reversal/undo routes absent for most documents — deletes may 409 once referenced [DOCS].

**Warehouse Transfer:** `[TransferOut created] --Activate--> [in transit (optional InTransit warehouse)] --TransferIn + Activate--> [received]`.

**Work Order:** `[created from Bill] --stages progress (ConfigurableStatus, customer-defined)--> [DateCompleted set]`; `POST /WorkOrders/Reversal` --> reversal work order linked via `ReversalWorkOrderID`.

**Journal Set:** `PostedDate` + `PostedToPeriodNo` mark posting; period-lock booleans (`PostedToPeriodNoIsGloballyLocked`) block writes to closed periods [SPEC]; repeating journals re-spawn per `RepeatingType`/`NextRepeatingDate`.

### Status/enum value reference (per-entity specifics)

The OpenAPI spec declares **zero enum constraints** — every status/type field is a bare string (or number) [SPEC]. Entity-specific notes beyond the lifecycle above:

| Entity                                   | Field                                          | What is known                                                                         |
| ---------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| SalesOrder                               | SalesOrderType, OrderType, BillType, EDIStatus | Strings; values UNVERIFIED                                                            |
| SalesQuote                               | Status, SalesQuoteType                         | Strings; values UNVERIFIED                                                            |
| PurchaseOrder                            | OrderStatus, OrderType, OrderSupplierType      | Strings; values UNVERIFIED                                                            |
| GRN/PurchaseInvoice/Shipment/WH_Transfer | Status                                         | Strings; activation flips state via `/Activate/` routes [SPEC]                        |
| BookIn                                   | Activated                                      | Boolean — the one unambiguous lifecycle flag [SPEC]                                   |
| GRN                                      | Invoiced + PI_MainID                           | Boolean + RecID set when a Purchase Invoice consumes the GRN [SPEC]                   |
| Debtor                                   | TradingStatus, TermsType, PeriodType           | Strings; values UNVERIFIED                                                            |
| InventoryItem                            | Status                                         | String; values UNVERIFIED                                                             |
| WorkOrder                                | Status + ConfigurableStatus                    | ConfigurableStatus = customer-defined WorkOrderStatus object — per-instance by design |
| ToDo                                     | Status, Priority, ToDoType                     | Objects (customer-defined sets); read existing To Dos to learn valid values           |
| JournalSet                               | SetType, ReverseType, RepeatingType            | Strings; values UNVERIFIED                                                            |
| Webhook message                          | Status                                         | Delivery-state string in `v_SY_WebhookSubscriber_Messages`; values UNVERIFIED         |

## Business rules

**Ordering/dependency:** Debtor before a Sales Order/Quote; Creditor before a PO; InventoryItem before order/PO lines (or use `NonInventory` lines on sales docs) [SPEC]. GRN from PO (`FromPurchaseOrders/{OrderNos}` — comma-separated OrderNos in path [SPEC]); Purchase Invoice from GRNs (`FromGoodsReceivedNotes/{GRNNos}`); BookIn from Shipment. Create-from routes copy lines automatically. Child documents reference parents by RecID — resolve display numbers via `/Queries/*` first.

**Write semantics (PATCH conventions) [DOCS]:** PATCH is partial — omitted fields keep their values. Child collections upsert by ID: element WITH its ID (`InvoiceLineID`, `NoteID`…) updates that child; WITHOUT it appends. No "delete child via parent PATCH" — use the child's DELETE route [UNVERIFIED for delete-via-null]. Resolution pairs: `DebtorID` > `DebtorAccountNo`; `InventoryID` > `PartNo` (ID wins). Server-side defaults when omitted: line price (pricing scheme), `NoteType`, `PaymentType`.

**Concurrency & deletion:** Optimistic concurrency — a record saved by someone else between your read and write → **409**; re-read, reapply, retry once (`LastSavedDateTime`/`RowHash` are the version markers) [DOCS]. DELETE returns 409 when the record is referenced (e.g. inventory item on a sales order) [DOCS].

**Computed/read-only fields:** all `*Total`, `Tax*`, `Price*` aggregates; `CurrentBalance`/period balances on Debtor; `AvailableStock`/`InStock` on the inventory list view; `WarehouseSOHs`. FX twin fields (`FX*`) hold the foreign-currency value alongside local — write the natural one, treat the twin as derived [UNVERIFIED which side wins on write]. IDs, `LastSavedDateTime`, `RowHash`, staff-attribution fields are server-set.

## Field format reference

| Format      | Pattern                              | Example                                                      | Notes                                                      |
| ----------- | ------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------- |
| RecID       | opaque string, typically 20 chars    | `0000000061000000001V`, `5244dd5e199749f4b6fe`               | Never parse/construct; server-generated                    |
| SettingID   | RecID + trailing spaces              | `1ae102b94dc54dfc8a45%20%20…`                                | URL-encode trailing spaces in paths [DOCS]                 |
| DateTime    | ISO8601, no timezone offset observed | `2017-09-18T00:00:00.000`                                    | Spec format `date-time`; server-local time [UNVERIFIED tz] |
| Money       | plain double                         | `15.67`                                                      | Local currency; `FX*` twin for foreign                     |
| Quantity    | double + `QuantityDecimalPlaces`     | `5`                                                          | Respect the item's decimal places                          |
| Boolean     | JSON boolean                         | `true`                                                       | CustomFieldValue contents are STRINGS (`"True"`) [DOCS]    |
| RowHash     | base64 binary                        | —                                                            | Concurrency token; echo back if present [UNVERIFIED]       |
| Display nos | string                               | `AccountNo "CASH001"`, `PartNo "1170"`, `InvoiceNo "104001"` | Human keys; resolve to RecIDs via queries                  |

## Query route quick reference (read paths for common questions) [SPEC]

| Question domain        | Query route                                                                  | Useful columns                                                                            |
| ---------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Customers              | /Queries/DebtorList, /Queries/DB_Main                                        | DebtorID, AccountNo, Name, CurrentBalance, AccountOnHold, EmailAddress, LastSavedDateTime |
| Customer AR activity   | /Queries/DebtorTransactionList                                               | per-debtor transactions                                                                   |
| Products + price/stock | /Queries/InventoryItemList                                                   | PartNo, Description, AvailableStock, InStock, SellPrice, RRPPrice                         |
| Stock on hand / bins   | /Queries/IN_SOH, /Queries/INSOHWithBinLocations, /Queries/IN_WarehouseSOH    | QuantityLeft, QuantityAllocated, SerialNo, ExpiryDate                                     |
| Back orders            | /Queries/BackOrderList                                                       | outstanding back-ordered lines                                                            |
| Sales orders           | /Queries/SalesOrderList, /Queries/SO_Main, /Queries/v_Jiwa_SalesInformation  | InvoiceNo, Status, DebtorName, totals, DueDate, warehouse                                 |
| Sales quotes           | /Queries/SalesQuoteList, /Queries/QO_Main                                    | QuoteNo/InvoiceNo, Status, DebtorID                                                       |
| Suppliers              | /Queries/CR_Main                                                             | AccountNo, Name, CreditLimit, AccountOnHold                                               |
| Purchase orders        | /Queries/PO_Main, /Queries/PurchaseOrderSelection                            | OrderNo, Status, CreditorID, totals                                                       |
| Supplier invoices      | /Queries/PI_Main                                                             | InvoiceNo, Status, DueDate                                                                |
| Shipments / book-ins   | /Queries/SH_Main, /Queries/SH_BookInMain                                     | ShipmentNo, Status, arrival dates                                                         |
| GL accounts / journals | /Queries/GL_Ledger, /Queries/GL_Sets, /Queries/GL_Category                   | AccountNo, Description, CurrBal                                                           |
| Tax / currency         | /Queries/TX_Main, /Queries/FX_Currency, /Queries/FX_CurrencyRates            | TaxRate, BASCode; currency rates                                                          |
| Staff / departments    | /Queries/HR_Staff, /Queries/HR_Departments, /Queries/StaffUserGroups         | names, email, user groups — avoid credential columns                                      |
| Manufacturing          | /Queries/BM_Main (bills), /Queries/WorkOrderSelection, /Queries/BM_WorkOrder | BillNo, WorkOrder status views                                                            |
| Warehouses             | /Queries/IN_Logical, /Queries/IN_Physical, /Queries/WarehouseSelection       | warehouse ids + descriptions                                                              |
| Emails logged in Jiwa  | /Queries/EM_Main                                                             | EmailTo, EmailSubject, EmailStatus, SourceType                                            |
| System settings        | /Queries/SY_SysValues                                                        | Section, IDKey, Contents (e.g. AutoQueryMaxLimit)                                         |
| Branches / plugins     | /Queries/SY_Branch, /Queries/SY_Plugin                                       | branch list; enabled plugins                                                              |
