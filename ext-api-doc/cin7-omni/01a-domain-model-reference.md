---
api_name: 'Cin7 Omni'
api_slug: 'cin7-omni'
generated_from: '00-api-investigation (2026-05-22) + live OpenAPI 3.0 spec'
generated_date: '2026-06-10'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# Cin7 Omni -- Domain Model Reference

> ⚠️ Investigation-confirmed (live API tests 2026-05-22) but NOT yet validated through the Numa connector path.
> Field-level detail extracted from the live OpenAPI 3.0 spec (`api.cin7.com/api/OpenApi/GetSpec`, marked BETA) — tagged [SPEC].
> Behavioural claims from the HTML docs verified 2026-05-22 — tagged [CONFIRMED — API investigation 2026-05-22].

## ID Semantics

- All entity IDs are **integers** assigned by Cin7 (`Id`) [SPEC].
- Human-facing keys exist alongside: `Reference` (orders — unique, auto-generated when blank), `StyleCode` (products), `ProductOptionCode` (variant SKU), `Barcode` [SPEC].
- All dates UTC, `yyyy-MM-ddTHH:mm:ssZ` [CONFIRMED — API investigation 2026-05-22].

## Entity Catalog

All from the live OpenAPI spec (44 paths) [SPEC].

| Entity                  | Description                                | GET list | GET /{id} | POST | PUT | DELETE |
| ----------------------- | ------------------------------------------ | -------- | --------- | ---- | --- | ------ |
| Products                | Inventory items with variants              | ✓        | ✓         | ✓    | ✓   | —      |
| ProductOptions          | Variants/SKUs (prices, stock)              | ✓        | ✓         | ✓    | ✓   | —      |
| ProductCategories       | Product categories                         | ✓        | ✓         | ✓    | ✓   | —      |
| ProductImages           | Product image upload                       | —        | —         | ✓    | —   | —      |
| SizeRanges              | Size grids (apparel/footwear)              | ✓        | ✓         | —    | —   | —      |
| SalesOrders             | Customer orders                            | ✓        | ✓         | ✓    | ✓   | —      |
| SalesOrdersWithCartons  | Orders incl. carton detail                 | ✓        | ✓         | —    | —   | —      |
| Cartons                 | Packing cartons for a sales order          | —        | ✓         | —    | ✓   | —      |
| Quotes                  | Pre-order quotes                           | ✓        | ✓         | ✓    | ✓   | —      |
| PurchaseOrders          | Supplier orders                            | ✓        | ✓         | ✓    | ✓   | —      |
| Contacts                | Customers AND suppliers (one entity)       | ✓        | ✓         | ✓    | ✓   | ✓      |
| CreditNotes             | Credit notes                               | ✓        | ✓         | ✓    | ✓   | —      |
| Payments                | Payments against orders                    | ✓        | ✓         | ✓    | ✓   | ✓      |
| PaymentFeesAndPayouts   | Cin7 Pay fees + payouts                    | ✓        | —         | —    | —   | —      |
| Adjustments             | Stock adjustments                          | ✓        | ✓         | ✓    | ✓   | —      |
| Branches                | Warehouses/locations                       | ✓        | ✓         | ✓    | ✓   | —      |
| BranchTransfers         | Inter-branch stock movements               | ✓        | ✓         | ✓    | ✓   | —      |
| BomMasters (v1 + v2)    | Bills of Materials                         | ✓        | ✓         | —    | —   | —      |
| ProductionJobs          | Manufacturing jobs                         | ✓        | ✓         | ✓    | ✓   | —      |
| Stock                   | Stock units by branch/SKU/barcode          | ✓        | —         | —    | —   | —      |
| SerialNumbers           | Serial tracking                            | ✓        | ✓         | —    | —   | —      |
| Voucher                 | Gift vouchers / promo codes                | ✓        | —         | —    | —   | —      |
| Users                   | Cin7 user accounts                         | ✓        | ✓         | —    | —   | —      |

**Only Contacts and Payments support DELETE.** Everything else is voided/deactivated via PUT (`IsVoid`, `IsActive`, `Status: "Disabled"`).

## Key Entities

### Product [SPEC]

The parent style; sellable SKUs live in `ProductOptions` underneath.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `Id` | integer | Read-only |
| `Status` | enum | `Inactive`, `Public`, `ShowInB2B`, `Internal` |
| `StyleCode` | string | Unique; duplicate on POST → 400 for whole batch [CONFIRMED — API investigation 2026-05-22] |
| `Name` | string (250) | **Required on POST** |
| `Description`, `Brand`, `Category`, `SubCategory`, `Tags` | string | `Tags` is comma-delimited |
| `CategoryIdArray` | int[] | Category IDs assigned |
| `SupplierId` | integer | Links to a Contact of Type Supplier |
| `Weight`/`Height`/`Width`/`Length`/`Volume` | number | 0–999 |
| `StockControl` | enum | `Undefined`, `Batch`, `Machine`, `Serial`, `Labour`, `FIFO` |
| `OrderType` | string | Order, Kit, Limited Stock, Buy To Order, Pre-order, Gift Voucher |
| `OptionLabel1..3` | string | Labels for the variant axes (e.g. Color/Size/Fabric) |
| `SalesAccount`, `PurchasesAccount` | string | GL account codes |
| `ProductOptions` | array | **Required on POST** — at least one variant |
| `Images[].Link`, `PdfUpload`, `CustomFields` | — | Media + custom fields |
| `CreatedDate`, `ModifiedDate` | datetime | Read-only; `ModifiedDate` is the polling watermark |

### ProductOption (variant / SKU) [SPEC]

| Field | Type | Notes |
| ----- | ---- | ----- |
| `Id`, `ProductId` | integer | |
| `Status` | enum | `Primary`, `Active`, `Disabled` |
| `ProductOptionCode` | string (20) | The SKU. Unique; duplicate on POST → 400. (`Code` is OBSOLETE — don't write it) |
| `ProductOptionBarcode` | string (13) | (`Barcode` is OBSOLETE) |
| `ProductOptionSizeCode` / `ProductOptionSizeBarcode` | string | Size-grid variants |
| `Option1`/`Option2`/`Option3` | string (50) | Variant values (e.g. Red / XL / Cotton) |
| `SupplierCode` | string (20) | |
| `RetailPrice`, `WholesalePrice`, `VIPPrice`, `SpecialPrice` | number | Plus `PriceColumns` array for custom price tiers |
| `SpecialsStartDate`, `SpecialDays` | — | Special-pricing window |
| `StockAvailable`, `StockOnHand` | number | Read-only convenience copies of stock |
| `UomOptions` | array | Unit-of-measure packs (`Code`, `Quantity`, `Barcode`, `PriceColumns`) |
| `Image.Link` | string | |

### SalesOrder [SPEC]

Shares its base shape with PurchaseOrders, Quotes, and CreditNotes (one "transaction" model).

| Field group | Fields / notes |
| ----------- | -------------- |
| Identity | `Id` (RO), `Reference` (string 30, unique — leave blank to auto-generate), `CreatedDate`/`ModifiedDate` (RO), `CreatedBy`/`ProcessedBy` (user IDs), `Source` (RO) |
| Customer link | `MemberId` (Contact Id) OR `MemberEmail` — one should be set to link the customer; plus free-text `FirstName`, `LastName`, `Company`, `Email`, `Phone`, `Mobile` for the order contact |
| Workflow | `Status` enum `Draft`/`Approved`/`Void` (**read-only**), `IsApproved` (default true), `Stage` (New, Awaiting Payment, Declined, Dispatched, Processing, On Hold; default New), `IsVoid` (set true to void — **irreversible**), `DispatchedDate` (populate to mark dispatched and drive `QtyShipped`), `InvoiceDate`, `InvoiceNumber` (RO, set when invoice date set), `EstimatedDeliveryDate`, `CancellationDate` (RO) |
| Addresses | `DeliveryFirstName/.../DeliveryCountry`, `BillingFirstName/.../BillingCountry` (string 250 each) |
| Logistics | `BranchId` (defaults to Main Branch; **not updatable once dispatched**), `DistributionBranchId`, `TrackingCode`, `LogisticsCarrier`, `FreightTotal`, `FreightDescription`, `DeliveryInstructions` (2000) |
| Money | `ProductTotal`, `DiscountTotal`, `Surcharge`, `Total` (incl. everything), `CurrencyCode` (ISO, omit for account default), `CurrencyRate` (omit → Cin7 looks up), `TaxStatus` enum `Undefined`/`Incl`/`Excl`/`Exempt`, `TaxRate` |
| Misc | `CustomerOrderNo`, `PaymentTerms`, `InternalComments`, `SalesPersonId`, `VoucherCode` (30), `CustomFields`, `AccountingAttributes.AccountingImportStatus` enum `NotImported`/`Imported`/`DoNotImport`/`Error` |

**LineItem** (shared by orders/quotes/credit notes) [SPEC]: `Id`, `TransactionId` (parent order), `ProductId` (RO), `ProductOptionId` OR `Code` (SKU) to link the product, `Name`, `StyleCode`, `Barcode`, `Option1..3`, `Qty`, `QtyShipped` (RO — derived from `DispatchedDate`), `UnitPrice`, `UnitCost`, `Discount`, `LineComments`, `AccountCode` (alt GL), `Sort`, `StockControl`, `StockMovements[]` (RO: Batch/Serial/Quantity), UOM fields (`UomPrice`, `UomQtyOrdered`, `UomSize` RO), `SizeCodes` (RO), `HoldingQty` (RO), `IntegrationRef`.

### PurchaseOrder [SPEC]

Same transaction base as SalesOrder, plus: `SupplierInvoiceReference`, `SupplierAcceptanceDate`, `Port` (indent orders), `EstimatedArrivalDate`, `FullyReceivedDate`. The "member" here is the **supplier** Contact. `loadboms` query param on POST/PUT.

### Quote [SPEC]

Transaction base plus: `Probability` (of winning), `ExpectedOrderDate`, `AcceptanceDate`. No documented quote→order conversion endpoint — create a SalesOrder from the quote's data [UNVERIFIED].

### CreditNote [SPEC]

Transaction base plus: `CreditNoteNumber` (RO), `CreditNoteDate`, `SalesReference` (links the originating sales order), `CustomerReport` (notes to customer/reason), `CompletedDate`.

### Contact [SPEC]

One entity for customers AND suppliers.

| Field | Notes |
| ----- | ----- |
| `Type` | **Required on POST** — enum `Customer`, `Supplier` (also `Internal`) |
| `Id`, `CreatedDate`, `ModifiedDate` | RO |
| `IsActive`, `OnHold` | booleans |
| `Company` (250), `FirstName`/`LastName` (250), `JobTitle`, `Email` (**unique**), `Phone`/`Mobile`/`Fax` (50), `Website` | identity fields |
| `Address1/2`, `City`, `State`, `PostCode`, `Country` (50 each) | physical address |
| `PostalAddress1/2`, `PostalCity`, `PostalState`, `PostalPostCode`, `PostalCountry` | billing/postal address |
| `AccountNumber` (10), `BillingId`/`BillingCompany` (parent company), `BillingEmail`, `AccountsFirstName`/`AccountsLastName`/`AccountsPhone` | accounts contact |
| `PriceColumn` (price tier name — valid names come from ProductOptions), `PercentageOff`, `PaymentTerms`, `TaxStatus`, `TaxNumber`, `CreditLimit`, `BalanceOwing`, `CostCenter` | commercial terms |
| `Group`, `SubGroup`, `Stages`, `SalesPersonId`, `Notes` (250), `IntegrationRef`, `CustomFields` | CRM-ish extras |
| `AccountingIntegrationId` | RO — Xero / QuickBooksOnline / QuickBooksDesktop IDs |
| `SecondaryContacts[]` | Id, Company, First/LastName, JobTitle, Email, Phone, Mobile |

### Stock (read-only) [SPEC]

One row per product-option per branch: `ProductId`, `ProductOptionId`, `StyleCode`, `Code` (SKU), `Barcode`, `ProductName`, `Option1..3`, `Size`, `BranchId`, `BranchName`, `ModifiedDate` (last transaction date), and the quantities — `Available` (= StockOnHand − OpenSales), `StockOnHand`, `OpenSales`, `Incoming` (inbound POs), `Virtual` (kit products), `Holding`.

### Payment [SPEC]

`Id`, `OrderId` (sales OR purchase order), `OrderRef` (RO), `PaymentDate`, `Amount`, `Method`, `IsAuthorized`, `TransactionRef` (gateway ref), `BatchReference` (RO), `ReconcileDate`, `BranchId`, `Comments`, `OrderType` enum (SalesOrder, PurchaseOrder, Quote, CreditNote, Layby, … 19 values).

### Others (brief) [SPEC]

- **Adjustment:** `Reference`, `BranchId`, `AdjustmentReason`, `CompletedDate`, `AdjustInAccountingSystem` (date), `AlternativeAccountCode`, `LineItems[]`, `IsApproved`.
- **Branch:** Contact-shaped (it IS a contact subtype) + `BranchType`, `StockControlOptions`, `TaxStatus`, `BranchLocations[]`.
- **BranchTransfer:** `SourceBranchId`, `DestinationBranchId`, `Stage`, `ApprovalDate`, `DispatchedDate`, `ReceivedDate`, `LineItems[]`.
- **ProductionJob:** `Reference`, `BranchId`, `DueDate`, `CompletedDate`, `ProductionNotes`, `TotalCost`, `Products[]`.
- **BomMaster component:** `ProductId`, `ProductOptionId`, `Type` enum `Undefined`/`Make`/`Use`/`Addon`, `Code`, `Name`, `Qty` (**required**), `UnitCost`, `Sort`, `Notes`.
- **SerialNumber:** `Serialnumber`, `ProductId`, `ProductOptionId`, `LineItemId`, `BranchId`, `Available`, `HoldingGroup`.
- **Voucher:** `Code`, `Type`, `Status` (Active = has balance, Inactive = fully redeemed/expired), `Amount`, `RedeemedAmount`, `RedeemedCount`/`RedeemedCountLimit`, `ExpiryDate`, `CustomerID`/`CustomerEmail`.
- **User:** `Id`, `IsActive`, `FirstName`, `LastName`, `JobTitle`, `Email`. New users take up to 2h to appear [CONFIRMED — API investigation 2026-05-22].

## Entity Relationships

```
Contacts (Type=Customer) 1 ──< SalesOrders / Quotes / CreditNotes   (via MemberId/MemberEmail)
Contacts (Type=Supplier) 1 ──< PurchaseOrders                       (via MemberId)
Contacts (Type=Supplier) 1 ──< Products                             (via SupplierId)
Products 1 ──< ProductOptions (variants/SKUs)
Products 1 ──< ProductImages;   Products >──< ProductCategories (CategoryIdArray)
Products 1 ── BomMasters 1 ──< BomMaster components (Type=Make/Use/Addon)
SalesOrders 1 ──< LineItems >── ProductOptions (ProductOptionId/Code)
SalesOrders 1 ──< Payments (OrderId + OrderType);  1 ──< Cartons
Branches 1 ──< Stock rows;   BranchTransfers: SourceBranchId → DestinationBranchId
ProductionJobs ──< Products[];  SerialNumbers >── ProductOptions + LineItems
Voucher >── Contacts (CustomerID);  Users ── CreatedBy/ProcessedBy/SalesPersonId on transactions
```

## State Machines

### Order lifecycle (SalesOrders / PurchaseOrders / Quotes / CreditNotes) [SPEC]

```
                    IsApproved=false            IsApproved=true (default)
   create ────────► Status: Draft ────────────► Status: Approved
                                                      │
                              IsVoid=true (IRREVERSIBLE)
                                                      ▼
                                                Status: Void
```

- `Status` is **read-only** — it reflects `IsApproved`/`IsVoid`.
- Operational progress is `Stage`: `New → Processing → Dispatched` (or `Awaiting Payment`, `Declined`, `On Hold`). Exact allowed transitions are configured per account [UNVERIFIED].
- Dispatch is driven by setting `DispatchedDate` (this populates `QtyShipped` on lines) [SPEC].

### ProductOption status [SPEC]

```
Primary / Active ⇄ Disabled      (one Primary per product [UNVERIFIED])
```

### Voucher status [SPEC]

```
Active (has balance) ──► Inactive (fully redeemed or expired)
```

## Business Rules

| Rule | Source |
| ---- | ------ |
| `StyleCode` and `ProductOptionCode` must be unique; a duplicate in a POST batch rejects the ENTIRE batch with 400 | [CONFIRMED — API investigation 2026-05-22] |
| PUT semantics: `null` = leave unchanged, `""` = clear the field | [CONFIRMED — API investigation 2026-05-22] |
| POST/PUT bodies are arrays; max 250 records per batch | [SPEC] |
| `Reference` left blank on insert → auto-generated; must be unique otherwise | [SPEC] |
| `MemberId`/`MemberEmail`: provide one to link a customer; `ProductOptionId`/`Code`: provide one to link a product to a line | [SPEC] |
| `BranchId` not updatable after SO dispatched / PO received | [SPEC] |
| `IsVoid: true` is irreversible; `loadboms=true` BOM expansion cannot be undone | [SPEC] |
| Contact `Email` must be unique | [SPEC] |
| New Users take up to 2 hours to appear via API | [CONFIRMED — API investigation 2026-05-22] |
| Omit `CurrencyCode`/`CurrencyRate`/`TaxStatus` to inherit account defaults | [SPEC] |

## Field Format Reference

| Format | Value | Notes |
| ------ | ----- | ----- |
| Date/time | `yyyy-MM-ddTHH:mm:ssZ` UTC | e.g. `2026-06-09T13:45:00Z` [CONFIRMED — API investigation 2026-05-22] |
| IDs | integer | All entities |
| Currency code | ISO 4217 (e.g. `NZD`) | Omit to use account default [SPEC] |
| SKU (`ProductOptionCode`) | string, max 20 | [SPEC] |
| Barcode | string, max 13 | [SPEC] |
| `Reference` | string, max 30, unique | [SPEC] |
| Tags / Channels | comma-delimited string | [SPEC] |
| Field casing | PascalCase in payloads | `where`/`fields`/`order` params accept lowercase names in vendor examples (`modifieddate`) — casing appears case-insensitive in queries [UNVERIFIED] |

## Enum Value Reference [SPEC]

| Field | Values |
| ----- | ------ |
| Product.Status | `Inactive`, `Public`, `ShowInB2B`, `Internal` |
| ProductOption.Status | `Primary`, `Active`, `Disabled` |
| StockControl | `Undefined`, `Batch`, `Machine`, `Serial`, `Labour`, `FIFO` |
| Order Status (RO) | `Draft`, `Approved`, `Void` |
| Order Stage | `New`, `Awaiting Payment`, `Declined`, `Dispatched`, `Processing`, `On Hold` |
| TaxStatus | `Undefined`, `Incl`, `Excl`, `Exempt` |
| Contact.Type | `Internal`, `Customer`, `Supplier` |
| Payment.OrderType | `Undefined`, `GenericOrder`, `SalesOrder`, `PreOrder`, `ProductionJob`, `PurchaseOrder`, `PurchaseQuote`, `Quote`, `Adjustment`, `BatchOrSplitInvoice`, `BinLocationTransfer`, `BranchTransfer`, `SupplierConsignment`, `Consignment`, `CreditNote`, `SupplierCreditNote`, `Layby`, `BomMaster`, `SalesOrdersWithCartons` |
| BomMaster component Type | `Undefined`, `Make`, `Use`, `Addon` |
| AccountingImportStatus | `NotImported`, `Imported`, `DoNotImport`, `Error` |
