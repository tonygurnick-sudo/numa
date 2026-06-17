---
api_name: Cin7 Omni
api_slug: cin7-omni
base_url: https://api.cin7.com/api
path_version_segment: /v1/ all entities, /v2/ BomMasters only — part of the path, not a label
id_format: integer
field_casing: PascalCase in bodies
call_surface: HTTP via `numa integrations request` (relative url + method)
doc_role: on-demand reference — entity catalog, fields, relationships, state machines
confidence: every fact live-API-confirmed 2026-05-22 unless tagged [SPEC] (BETA OpenAPI 3.0 spec) or [UNVERIFIED] (inferred). NOT yet validated through the Numa connector path.
---

# Cin7 Omni — Domain Model Reference

## ID semantics

- All entity IDs are integers assigned by Cin7 (`Id`).
- Human keys alongside: `Reference` (orders — unique, auto-generated if blank), `StyleCode` (products), `ProductOptionCode` (variant SKU), `Barcode`.
- Dates UTC `yyyy-MM-ddTHH:mm:ssZ`.

## Entity catalogue (44 paths)

| Entity                 | Description                          | list | /{id} | POST | PUT | DELETE |
| ---------------------- | ------------------------------------ | ---- | ----- | ---- | --- | ------ |
| Products               | Inventory items with variants        | ✓    | ✓     | ✓    | ✓   | —      |
| ProductOptions         | Variants/SKUs (prices, stock)        | ✓    | ✓     | ✓    | ✓   | —      |
| ProductCategories      | Categories                           | ✓    | ✓     | ✓    | ✓   | —      |
| ProductImages          | Image upload                         | —    | —     | ✓    | —   | —      |
| SizeRanges             | Size grids (apparel/footwear)        | ✓    | ✓     | —    | —   | —      |
| SalesOrders            | Customer orders                      | ✓    | ✓     | ✓    | ✓   | —      |
| SalesOrdersWithCartons | Orders incl. carton detail           | ✓    | ✓     | —    | —   | —      |
| Cartons                | Packing cartons for a sales order    | —    | ✓     | —    | ✓   | —      |
| Quotes                 | Pre-order quotes                     | ✓    | ✓     | ✓    | ✓   | —      |
| PurchaseOrders         | Supplier orders                      | ✓    | ✓     | ✓    | ✓   | —      |
| Contacts               | Customers AND suppliers (one entity) | ✓    | ✓     | ✓    | ✓   | ✓      |
| CreditNotes            | Credit notes                         | ✓    | ✓     | ✓    | ✓   | —      |
| Payments               | Payments against orders              | ✓    | ✓     | ✓    | ✓   | ✓      |
| PaymentFeesAndPayouts  | Cin7 Pay fees + payouts              | ✓    | —     | —    | —   | —      |
| Adjustments            | Stock adjustments                    | ✓    | ✓     | ✓    | ✓   | —      |
| Branches               | Warehouses/locations                 | ✓    | ✓     | ✓    | ✓   | —      |
| BranchTransfers        | Inter-branch stock movements         | ✓    | ✓     | ✓    | ✓   | —      |
| BomMasters (v1+v2)     | Bills of Materials                   | ✓    | ✓     | —    | —   | —      |
| ProductionJobs         | Manufacturing jobs                   | ✓    | ✓     | ✓    | ✓   | —      |
| Stock                  | Stock units by branch/SKU/barcode    | ✓    | —     | —    | —   | —      |
| SerialNumbers          | Serial tracking                      | ✓    | ✓     | —    | —   | —      |
| Voucher                | Gift vouchers / promo codes          | ✓    | —     | —    | —   | —      |
| Users                  | Cin7 user accounts                   | ✓    | ✓     | —    | —   | —      |

**Only Contacts and Payments support DELETE.** Everything else is voided/deactivated via PUT (`IsVoid`, `IsActive`, `Status:"Disabled"`).

## Key entities

### Product

Parent style; sellable SKUs live in `ProductOptions` underneath.
| Field | Type | Notes |
| --- | --- | --- |
| `Id` | int | read-only |
| `Status` | enum | `Inactive`,`Public`,`ShowInB2B`,`Internal` |
| `StyleCode` | string | unique; duplicate on POST → 400 whole batch |
| `Name` | string(250) | **required on POST** |
| `Description`,`Brand`,`Category`,`SubCategory`,`Tags` | string | `Tags` comma-delimited |
| `CategoryIdArray` | int[] | assigned category IDs |
| `SupplierId` | int | links a Contact of Type Supplier |
| `Weight`/`Height`/`Width`/`Length`/`Volume` | number | 0–999 |
| `StockControl` | enum | `Undefined`,`Batch`,`Machine`,`Serial`,`Labour`,`FIFO` |
| `OrderType` | string | Order, Kit, Limited Stock, Buy To Order, Pre-order, Gift Voucher |
| `OptionLabel1..3` | string | variant-axis labels (Color/Size/Fabric) |
| `SalesAccount`,`PurchasesAccount` | string | GL account codes |
| `ProductOptions` | array | **required on POST** — ≥1 variant |
| `Images[].Link`,`PdfUpload`,`CustomFields` | — | media + custom fields |
| `CreatedDate`,`ModifiedDate` | datetime | read-only; `ModifiedDate` = polling watermark |

(Spec also lists: `PdfDescription`,`Channels`,`ProductType`,`ProductSubtype`,`ProjectName`,`ImportCustomsDuty`,`SizeRangeId`. [SPEC])

### ProductOption (variant / SKU)

| Field                                                    | Type       | Notes                                                                           |
| -------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------- |
| `Id`,`ProductId`                                         | int        |                                                                                 |
| `Status`                                                 | enum       | `Primary`,`Active`,`Disabled`                                                   |
| `ProductOptionCode`                                      | string(20) | the SKU. Unique; duplicate on POST → 400. (`Code` is OBSOLETE — don't write it) |
| `ProductOptionBarcode`                                   | string(13) | (`Barcode` is OBSOLETE)                                                         |
| `ProductOptionSizeCode`/`ProductOptionSizeBarcode`       | string     | size-grid variants                                                              |
| `Option1`/`Option2`/`Option3`                            | string(50) | variant values (Red / XL / Cotton)                                              |
| `SupplierCode`                                           | string(20) |                                                                                 |
| `RetailPrice`,`WholesalePrice`,`VIPPrice`,`SpecialPrice` | number     | + `PriceColumns` array for custom tiers                                         |
| `SpecialsStartDate`,`SpecialDays`                        | —          | special-pricing window                                                          |
| `StockAvailable`,`StockOnHand`                           | number     | read-only convenience copies                                                    |
| `UomOptions`                                             | array      | UOM packs (`Code`,`Quantity`,`Barcode`,`PriceColumns`)                          |
| `Image.Link`                                             | string     |                                                                                 |

### SalesOrder

Shares its base shape with PurchaseOrders, Quotes, CreditNotes (one "transaction" model).
| Group | Fields / notes |
| --- | --- |
| Identity | `Id` (RO), `Reference` (string30, unique — blank to auto-generate), `CreatedDate`/`ModifiedDate` (RO), `CreatedBy`/`ProcessedBy` (user IDs), `Source` (RO) |
| Customer link | `MemberId` (Contact Id) OR `MemberEmail` — set one to link the customer; plus free-text `FirstName`,`LastName`,`Company`,`Email`,`Phone`,`Mobile` order-contact snapshot |
| Workflow | `Status` enum `Draft`/`Approved`/`Void` (**RO**), `IsApproved` (default true), `Stage` (New, Awaiting Payment, Declined, Dispatched, Processing, On Hold; default New), `IsVoid` (true to void — **irreversible**), `DispatchedDate` (set to mark dispatched, drives `QtyShipped`), `InvoiceDate`, `InvoiceNumber` (RO, set when InvoiceDate set), `EstimatedDeliveryDate`, `CancellationDate` (RO) |
| Addresses | `DeliveryFirstName/…/DeliveryCountry`, `BillingFirstName/…/BillingCountry` (string250 each) |
| Logistics | `BranchId` (defaults Main Branch; **not updatable once dispatched**), `DistributionBranchId`, `TrackingCode`, `LogisticsCarrier`, `LogisticsStatus`, `FreightTotal`, `FreightDescription`, `DeliveryInstructions` (2000), `EdiStatus` |
| Money | `ProductTotal`, `DiscountTotal`, `Surcharge`, `Total` (incl. everything), `CurrencyCode` (ISO, omit→account default), `CurrencyRate` (omit→Cin7 looks up), `TaxStatus` enum `Undefined`/`Incl`/`Excl`/`Exempt`, `TaxRate` |
| Misc | `CustomerOrderNo`, `PaymentTerms`, `InternalComments`, `SalesPersonId`, `VoucherCode` (30), `ProjectName`, `CustomFields`, `AccountingAttributes.AccountingImportStatus` enum `NotImported`/`Imported`/`DoNotImport`/`Error` |

**LineItem** (shared by orders/quotes/credit notes): `Id`, `TransactionId` (parent), `ProductId` (RO), `ProductOptionId` OR `Code` (SKU) to link the product, `Name`, `StyleCode`, `Barcode`, `Option1..3`, `Qty`, `QtyShipped` (RO — derived from `DispatchedDate`), `UnitPrice`, `UnitCost`, `Discount`, `LineComments`, `AccountCode` (alt GL), `Sort`, `StockControl`, `StockMovements[]` (RO: Batch/Serial/Quantity), UOM fields (`UomPrice`,`UomQtyOrdered`,`UomSize` RO), `SizeCodes` (RO; `Qty|Size|Code|Barcode` packed string), `HoldingQty` (RO), `IntegrationRef`. If the SKU exists in Cin7, only quantity is required on the line.

### PurchaseOrder

Same transaction base as SalesOrder, plus: `SupplierInvoiceReference`, `SupplierAcceptanceDate`, `Port` (indent orders), `EstimatedArrivalDate`, `FullyReceivedDate`. The "member" is the **supplier** Contact. `loadboms` query param on POST/PUT.

### Quote

Transaction base plus: `Probability` (of winning), `ExpectedOrderDate`, `AcceptanceDate`. No documented quote→order conversion endpoint — create a SalesOrder from the quote's data [UNVERIFIED].

### CreditNote

Transaction base plus: `CreditNoteNumber` (RO), `CreditNoteDate`, `SalesReference` (links originating sales order), `CustomerReport` (notes/reason), `CompletedDate`.

### Contact

One entity for customers AND suppliers.
| Field | Notes |
| --- | --- |
| `Type` | **required on POST** — enum `Customer`,`Supplier` (also `Internal`) |
| `Id`,`CreatedDate`,`ModifiedDate` | RO |
| `IsActive`,`OnHold` | bool |
| `Company`(250),`FirstName`/`LastName`(250),`JobTitle`,`Email` (**unique**),`Phone`/`Mobile`/`Fax`(50),`Website` | identity |
| `Address1/2`,`City`,`State`,`PostCode`,`Country`(50 each) | physical address |
| `PostalAddress1/2`,`PostalCity`,`PostalState`,`PostalPostCode`,`PostalCountry` | billing/postal address |
| `AccountNumber`(10),`BillingId`/`BillingCompany` (parent),`BillingEmail`,`AccountsFirstName`/`AccountsLastName`/`AccountsPhone` | accounts contact |
| `PriceColumn` (tier name — valid names from ProductOptions),`PercentageOff`,`PaymentTerms`,`TaxStatus`,`TaxNumber`,`CreditLimit`,`BalanceOwing`,`CostCenter` | commercial terms |
| `Group`,`SubGroup`,`Stages`,`SalesPersonId`,`Notes`(250),`IntegrationRef`,`CustomFields` | CRM extras |
| `AccountingIntegrationId` | RO — Xero/QuickBooksOnline/QuickBooksDesktop IDs |
| `SecondaryContacts[]` | Id, Company, First/LastName, JobTitle, Email, Phone, Mobile |

### Stock (read-only)

One row per product-option per branch: `ProductId`,`ProductOptionId`,`StyleCode`,`Code` (SKU),`Barcode`,`ProductName`,`Option1..3`,`Size`,`BranchId`,`BranchName`,`ModifiedDate` (last transaction date), and quantities — `Available` (=StockOnHand−OpenSales),`StockOnHand`,`OpenSales`,`Incoming` (inbound POs),`Virtual` (kit products),`Holding`. (Exact `Available` formula [UNVERIFIED].)
Example row: `{"productId":1,"productOptionId":0,"modifiedDate":"2026-06-10T05:28:32Z","styleCode":"StyleCode123","code":"ABC123","barcode":"123456789012","branchId":1,"branchName":"Main Branch","productName":"T-Shirt","option1":"Red","option2":null,"option3":null,"size":"XXL","available":2.0,"stockOnHand":9.0,"openSales":7.0,"incoming":8.0,"virtual":0.0,"holding":0.0}`

### Payment

`Id`, `OrderId` (sales OR purchase order), `OrderRef` (RO), `PaymentDate`, `Amount`, `Method`, `IsAuthorized`, `TransactionRef` (gateway ref), `BatchReference` (RO), `ReconcileDate`, `BranchId`, `Comments`, `OrderType` enum (19 values — see Enums).

### Others (brief)

- **Adjustment:** `Reference`,`BranchId`,`AdjustmentReason`,`CompletedDate`,`AdjustInAccountingSystem` (date),`AlternativeAccountCode`,`LineItems[]` (lines use `QtyAdjusted` delta),`IsApproved`.
- **Branch:** Contact-shaped (it IS a contact subtype) + `BranchType`,`StockControlOptions`,`TaxStatus`,`BranchLocations[]`.
- **BranchTransfer:** `SourceBranchId`,`DestinationBranchId`,`Stage`,`ApprovalDate`,`DispatchedDate`,`ReceivedDate`,`LineItems[]`.
- **ProductionJob:** `Reference`,`BranchId`,`DueDate`,`CompletedDate`,`ProductionNotes`,`TotalCost`,`Products[]`.
- **BomMaster component:** `Id`,`ProductId`,`ProductOptionId`,`Type` enum `Undefined`/`Make`/`Use`/`Addon`,`Code`,`Name`,`Option1..3`,`Qty` (**required**),`UnitCost`,`Sort`,`Notes`.
- **SerialNumber:** `Serialnumber`,`ProductId`,`ProductOptionId`,`LineItemId`,`BranchId`,`Available`,`HoldingGroup`.
- **Voucher:** `Code`,`Type`,`Status` (Active=has balance, Inactive=fully redeemed/expired),`Amount`,`RedeemedAmount`,`RedeemedCount`/`RedeemedCountLimit`,`ExpiryDate`,`CustomerID`/`CustomerEmail`.
- **User:** `Id`,`IsActive`,`FirstName`,`LastName`,`JobTitle`,`Email`. New users take up to 2h to appear.

## Entity relationships

```
Contacts(Type=Customer) 1 ──< SalesOrders / Quotes / CreditNotes   (via MemberId/MemberEmail)
Contacts(Type=Supplier) 1 ──< PurchaseOrders                       (via MemberId)
Contacts(Type=Supplier) 1 ──< Products                             (via SupplierId)
Products 1 ──< ProductOptions (variants/SKUs)
Products 1 ──< ProductImages;   Products >──< ProductCategories (CategoryIdArray)
Products 1 ── BomMasters 1 ──< BomMaster components (Type=Make/Use/Addon)
SalesOrders 1 ──< LineItems >── ProductOptions (ProductOptionId/Code)
SalesOrders 1 ──< Payments (OrderId + OrderType);  1 ──< Cartons
Branches 1 ──< Stock rows;   BranchTransfers: SourceBranchId → DestinationBranchId
ProductionJobs ──< Products[];  SerialNumbers >── ProductOptions + LineItems
Voucher >── Contacts (CustomerID);  Users ── CreatedBy/ProcessedBy/SalesPersonId on transactions
```

## State machines

### Order lifecycle (SalesOrders / PurchaseOrders / Quotes / CreditNotes)

```
create ──(IsApproved=false)──► Status: Draft
create ──(IsApproved=true, default)──► Status: Approved ──(IsVoid=true, IRREVERSIBLE)──► Status: Void
```

- `Status` is **read-only** — reflects `IsApproved`/`IsVoid`.
- Operational progress = `Stage`: `New → Processing → Dispatched` (or `Awaiting Payment`, `Declined`, `On Hold`). Allowed transitions are account-configured [UNVERIFIED].
- Dispatch is driven by setting `DispatchedDate` (populates `QtyShipped` on lines).

### ProductOption status

`Primary / Active ⇄ Disabled` (one Primary per product [UNVERIFIED]).

### Voucher status

`Active (has balance) ──► Inactive (fully redeemed or expired)`.

## Business rules

| Rule                                                                                                                        |        |
| --------------------------------------------------------------------------------------------------------------------------- | ------ |
| `StyleCode`/`ProductOptionCode` must be unique; a duplicate in a POST batch rejects the ENTIRE batch with 400               |        |
| PUT: `null` (or omit) = leave unchanged, `""` = clear                                                                       |        |
| POST/PUT bodies are arrays; max 250 records/batch                                                                           | [SPEC] |
| `Reference` blank on insert → auto-generated; must be unique otherwise                                                      | [SPEC] |
| `MemberId`/`MemberEmail`: provide one to link a customer; `ProductOptionId`/`Code`: provide one to link a product to a line | [SPEC] |
| `BranchId` not updatable after SO dispatched / PO received                                                                  | [SPEC] |
| `IsVoid:true` irreversible; `loadboms=true` BOM expansion cannot be undone                                                  | [SPEC] |
| Contact `Email` must be unique                                                                                              | [SPEC] |
| New Users take up to 2h to appear via API                                                                                   |        |
| Omit `CurrencyCode`/`CurrencyRate`/`TaxStatus` to inherit account defaults                                                  | [SPEC] |

## Field formats

| Format                    | Value                      | Notes                                                                                                                 |
| ------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Date/time                 | `yyyy-MM-ddTHH:mm:ssZ` UTC | e.g. `2026-06-09T13:45:00Z`                                                                                           |
| IDs                       | integer                    | all entities                                                                                                          |
| Currency                  | ISO 4217 (`NZD`)           | omit → account default [SPEC]                                                                                         |
| SKU (`ProductOptionCode`) | string, max 20             | [SPEC]                                                                                                                |
| Barcode                   | string, max 13             | [SPEC]                                                                                                                |
| `Reference`               | string, max 30, unique     | [SPEC]                                                                                                                |
| Tags / Channels           | comma-delimited string     | [SPEC]                                                                                                                |
| Field casing              | PascalCase in payloads     | `where`/`fields`/`order` accept lowercase in vendor examples (`modifieddate`) — appears case-insensitive [UNVERIFIED] |

## Enums [SPEC]

| Field                    | Values                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product.Status           | `Inactive`,`Public`,`ShowInB2B`,`Internal`                                                                                                                                                                                                                                                              |
| ProductOption.Status     | `Primary`,`Active`,`Disabled`                                                                                                                                                                                                                                                                           |
| StockControl             | `Undefined`,`Batch`,`Machine`,`Serial`,`Labour`,`FIFO`                                                                                                                                                                                                                                                  |
| Order Status (RO)        | `Draft`,`Approved`,`Void`                                                                                                                                                                                                                                                                               |
| Order Stage              | `New`,`Awaiting Payment`,`Declined`,`Dispatched`,`Processing`,`On Hold`                                                                                                                                                                                                                                 |
| TaxStatus                | `Undefined`,`Incl`,`Excl`,`Exempt`                                                                                                                                                                                                                                                                      |
| Contact.Type             | `Internal`,`Customer`,`Supplier`                                                                                                                                                                                                                                                                        |
| Payment.OrderType        | `Undefined`,`GenericOrder`,`SalesOrder`,`PreOrder`,`ProductionJob`,`PurchaseOrder`,`PurchaseQuote`,`Quote`,`Adjustment`,`BatchOrSplitInvoice`,`BinLocationTransfer`,`BranchTransfer`,`SupplierConsignment`,`Consignment`,`CreditNote`,`SupplierCreditNote`,`Layby`,`BomMaster`,`SalesOrdersWithCartons` |
| BomMaster component Type | `Undefined`,`Make`,`Use`,`Addon`                                                                                                                                                                                                                                                                        |
| AccountingImportStatus   | `NotImported`,`Imported`,`DoNotImport`,`Error`                                                                                                                                                                                                                                                          |
