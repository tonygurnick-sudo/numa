---
api_name: 'MYOB Greentree'
api_slug: 'greentree'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-06-11'
update_source: 'MYOB Greentree official docs (api-overview + per-entity api-documentation pages) — NO live testing'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# MYOB Greentree -- Domain Model Reference

> ⚠️ **Docs-derived — NOT yet live-validated through the Numa connector path.** Field lists come
> from MYOB Greentree's official per-entity documentation pages [DOCS]; anything inferred is
> [UNVERIFIED]. Companion to `01-llm-api-rules.md`. Contains the entity catalog, identifier
> semantics, module map, lifecycle/status fields, and business rules the workspace agent
> references when working with Greentree data.

---

## The URL Shape Drives Everything

Every call is `/{company}/{entity}[/{identifier}]` [DOCS]:

| Segment        | Meaning                                                | Example                       |
| -------------- | ------------------------------------------------------ | ----------------------------- |
| `{company}`    | Greentree company code — **required**, part of the path | `01`                          |
| `{entity}`     | The Greentree Jade class name (PascalCase)              | `SOPackingSlip`, `GLAccount`  |
| `{identifier}` | The record's human key — **optional** (omit = list)    | `24333.01`, `CUST1234`, `1000`|

Order matters: the three segments MUST appear in this sequence. A GET with no `{identifier}` returns a (paged, 100-capped) list of that entity. [DOCS]

> **Route name vs Jade class.** Some routes differ from the conceptual module name: AR Customer is the Jade class `ARCustomer` but the **route is `/Customer`**; AP Supplier is `APSupplier` but the **route is `/Supplier`**. GL/SO/PO/JC entities use their prefixed class names directly as the route (`GLAccount`, `SOSalesOrder`, `POPurchaseOrder`, `JCJob`). When in doubt, check the entity's docs page for the exact route token. [DOCS]

---

## ID Semantics — Human Keys + OidString

- The **path identifier is the entity's natural human key**, not an internal id: `AccountNo` (GL account), customer/supplier `Code`, `Reference` (AR/AP invoices, SO/PO documents), part `Code` (stock item), job `Code`. [DOCS]
- Most entities ALSO carry an **`OidString`** — Greentree's internal object identifier (e.g. `3456.768`), plus an **`Edition`** (row version). These appear in responses (and in Attachment/Sticky-Note/Approval sub-objects) but are NOT the route key. [DOCS]
- **On create you generally cannot specify the identifier** — Greentree allocates it (e.g. a new customer `Code`, a new invoice `Reference`). The docs note documented exceptions per entity. Capture the allocated key from the POST response. [DOCS]
- **References can carry sub-parts** — the overview's example packing-slip reference is `24333.01` (a dotted reference). Treat identifiers as opaque strings; don't parse or construct them. [DOCS]
- Humans use the human key; resolve "find X named Y" via a list GET with the right modifier (`?customer=`, `?emailAddress=`, `?globalSearch=`) before hitting an identifier route. [DOCS]

---

## Module Map (entity catalog from the docs index) [DOCS]

The `/api-documentation` index lists these entity families. Module prefix = the Jade class prefix; the **route** is the class name unless noted.

| Module | Entities (Jade class / route)                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **GL** | GLAccount, GLAccountSegmentDefinition, GLBudget, GLControl, GLDocument, GLPeriodSummary, GLBankIn (cash receipts), GLBankOut (cash payments) |
| **AR** | Customer (class ARCustomer), ARInvoice, ARReceipt, ARCreditNote, ARSalesPerson, ARControl                                       |
| **AP** | Supplier (class APSupplier), APInvoice, APInvoiceOnCharge, APPayment, APCreditNote, APControl                                    |
| **IN** | StockItem, INTransaction, INTransactionType, INStorageProfile, INStockTake, INStockTakeItem, INSerialLot, INLocation, INForecast, INControl, INBudget, INBinType, INBinTransaction, INAnalysisCode, INUnitOfMeasure, plus Advanced Pricing entities |
| **PO** | POPurchaseOrder, POReceipt, POShipments, POStatusDefinition                                                                     |
| **SO** | SOSalesOrder, SOPackingSlip, SOCarrier, SOStatusDefinition                                                                      |
| **JC** | JCJob, JCJobType, JCActivity, JCDisbursement, JCEstimate, JCEmployee, JCTimesheet, JCPlantCharge, JCWorkCentre, JCWorkCentrePlan, JCStatus, JCControl |
| **HR** | HRPerson, HRApplicant, HRPosition, HREmploymentType, HRLeaveRequest, HRIncident (+ Type/Status/EventType), HRInjury (Type/Severity), HRTrainingType, HRSkillType, HRMedicalRole, HRCertificationType, HR CV* (Training/Skill/Medical/Employment/Education/Certification), HREducationType, HRAwardClass |
| **CRM**| CRMContact, CRMOrganisation, CRMLead, CRMQuote, CRMTask, CRMServiceRequest, CRM SV Request (Type/Status), CRM SV Contract (+Cost), CRM SV Asset (+Type/Class/Usage), CRMCommunication (+Priority), CRMMessage, CRMDocumentRule, CRMWebTimesheet |
| **FA** | FAMaster, FAControl, FAPurchase, FADisposal, FATransfer, FARevaluation, FADepreciation, FAAdjustment, FABalanceAdjustment, FAWriteOffs |
| **FO** | FOFactoryOrder, FOFactoryOrderReceipts (manufacturing)                                                                          |
| **BOM**| BOMBillOfMaterials                                                                                                              |
| **SCM**| SCMRequisitions                                                                                                                 |
| **UT** | UTTaxCode, UTPaymentTerm, UTCurrencyCode, UTCountry (utility/reference)                                                         |
| **EC** | ECWebUser (e-commerce)                                                                                                          |
| **System** | Company, Branch, ProfitCentre, Tree, User, UserSecuritySnapshot, UserDefinedFieldDefinitions, BrowserTimesheets, Ping, AHFormDefinition, GlobalSearch |

> This list is the docs index as of the page snapshot. Entity availability is **version-gated** — older instances expose fewer; confirm against the customer's Greentree version. [DOCS]

---

## Entity Catalog (core verticals)

Field lists are **selected key fields** from each entity's docs page — the full Jade DTOs are larger. All field data [DOCS] unless noted. Property names are PascalCase.

### GLAccount (General Ledger account)

**Route:** `/GLAccount` (list), `/GLAccount/{AccountNo}` (single). **Verbs:** GET. [DOCS]
**Description:** Chart-of-accounts entry.

| Field             | Type    | Description                                          | Example     |
| ----------------- | ------- | ---------------------------------------------------- | ----------- |
| AccountNo         | string  | Account number — the route identifier                | `"1000"`    |
| Description       | string  | Account name                                         |             |
| AccountType       | string  | Income / Expense / Asset / Liability … [values vary] | `"Income"`  |
| AccountSign       | string  | Debit/credit normal sign                             |             |
| Status            | string  | Account status                                       |             |
| CurrencyCode      | string  | Account currency                                     | `"AUD"`     |
| IsPosting         | boolean | Whether the account is postable (vs heading)         | `true`      |
| IsQuantityAccount | boolean | Tracks quantity as well as value                     |             |
| ShortCode / Unit / SecurityLevel / AssignedTeam | string | Classification/security |             |
| Trees / UserDefinedFields | array | Tree memberships; UDFs                       |             |

**Modifiers:** `accountType`, `treeName`+`treeBranch`, `modifiedSince`, `includeTransactionTrees`, `includeOpeningBalance={fiscalYear}`, `respectAdvancedSecurityForUser`. [DOCS]

### Customer (AR — Jade class ARCustomer)

**Route:** `/Customer` (list), `/Customer/{Code}` (single). **Verbs:** GET, POST (create/update), DELETE. [DOCS]
**Description:** AR customer master — identity, address, credit, defaults, balances.

| Field             | Type    | Description                                       | Example       |
| ----------------- | ------- | ------------------------------------------------- | ------------- |
| Code              | string  | Customer code — route identifier (allocated on create) | `"CUST1234"` |
| Alpha / Name      | string  | Search alpha / full name                          |               |
| Status            | string  | Customer status                                   | `"Active"`    |
| Address           | object  | Contact, Address1-3, Suburb, Postcode, State, Country, Phone(BH/AH), Fax, Email, Web, Mobile | |
| BankAccount       | object  | AccountNo, Branch, BranchNo, Name, Suffix         |               |
| CreditLimit / CreditLimitOverdue1Plus..4Plus | number | Credit control                  | `10000`       |
| IsCheckingCredit / IsCreditAllowed / IsChild | boolean | Credit + hierarchy flags        |               |
| Currency / TaxCode / TaxMethod / BalanceType | string | Financial config                |               |
| DefaultPaymentTerm / DefaultPriceLevel / DefaultINInvoiceType / DefaultINCreditNoteType | string | Posting defaults | |
| SalesPerson / Branch / Calendar / CBAnalysis | string | Attribution                     |               |
| InvoiceDeliveryMethod / StatementDeliveryMethod / ReceiptDeliveryMethod | string | Delivery prefs    |     |
| DeliveryAddresses / WebUsers / UserDefinedFields / Trees / Balances / SalesOrderTotal | array/object | Child collections | |

**Modifiers:** `modifiedSince`, `isActive`, `emailAddress`, `treeName`+`treeBranch`, `includeWebUsers` (post-2018.3), `respectAdvancedSecurityForUser` (2020.3). [DOCS]

### Supplier (AP — Jade class APSupplier)

**Route:** `/Supplier` (list), `/Supplier/{Code}` (single). **Verbs:** GET, POST (create/update). [DOCS]
**Description:** AP supplier master.

| Field             | Type    | Description                                | Example     |
| ----------------- | ------- | ------------------------------------------ | ----------- |
| Code              | string  | Supplier code — route identifier            | `"SUPP01"`  |
| Name / Alpha      | string  | Name / search alpha                         |             |
| Status / IsActive | string/bool | Status                                  |             |
| TaxReference      | string  | ABN / tax id                                |             |
| PaymentMethod / PaymentTerm | string | AP payment config                  |             |
| Currency / TaxCode / TaxType | string | Financial config                  | `"AUD"`     |
| BankAccount / Address / PayeeAddress | object | Banking + addresses             |             |
| DiscountRate / DiscountType | number/string | Settlement discount             |             |
| AnalysisCode / Branch / DeliveryMethod / InvoiceForm | string | Defaults             |             |
| PurchaseOrders / UserDefinedFields / Trees | array | Child collections            |             |

**Modifiers:** `modifiedSince`, `isActive`, `taxReference`, `status`, `treeName`+`treeBranch`, `respectAdvancedSecurityForUser` (2020.3). [DOCS]

### ARInvoice (AR invoice)

**Route:** `/ARInvoice` (list), `/ARInvoice/{Reference}` (single). **Verbs:** GET; POST to create; POST to `/{Reference}` for **actions only** (e.g. `setIsPrinted`, 2021.1+) — not free-form update. [DOCS]
**Description:** AR sales invoice with GL line items.

| Field             | Type    | Description                              | Example       |
| ----------------- | ------- | ---------------------------------------- | ------------- |
| Reference         | string  | Invoice reference — route identifier      | `"100023"`    |
| Customer          | string  | Customer code                             | `"CUST1234"`  |
| DocumentDate / PostingDate / PaymentDate | datetime | Key dates             |               |
| NetAmount / TaxAmount / HoldAmount / Discount | number | Money                         |               |
| CurrencyRate / Currency | number/string | FX                              |               |
| Branch / SalesPerson / PaymentTerm / HoldCode | string | Attribution + hold        |               |
| OrderNumber / BatchNumber | string | References                       |               |
| IsPrinted         | boolean | Printed flag (`action=setIsPrinted` flips it) |          |
| EntryUser / EntryTimeStamp / ModifiedUser / ModifiedTimeStamp | string/datetime | Audit fields | |
| LineItems         | array   | GLLineItem rows + TransactionAnalysis trees (Contract/Site/Salesperson dims) | |

**Modifiers:** `customer`, `holdCode`, `outstandingOnly`, `modifiedSince`, `postingDate` (2021.1+), `sortBy1`/`sortDesc1` (2021.1+ — ARInvoice was the FIRST sortable entity). [DOCS]

### StockItem (Inventory item)

**Route:** `/StockItem` (list), `/StockItem/{Code}` (single). **Verbs:** GET; POST to update (standard); POST to create (2021.3+). [DOCS]
**Description:** Product/SKU master — stock, pricing, locations, components.

| Field             | Type    | Description                                  | Example          |
| ----------------- | ------- | -------------------------------------------- | ---------------- |
| Code              | string  | Part code — route identifier                  | `"00AOPEN17MONITOR"` |
| Description       | string  | Item description                              |                  |
| Status / IsActive | string/bool | Item status                              |                  |
| StockType / ActivityCode / AnalysisCode | string | Classification             |                  |
| SellingUOM / StockingUOM / PurchasingUOM | string | Units of measure            | `"EACH"`         |
| QuantityOnHand / QuantityAvailable / QuantityCommitted | number | Stock positions   | `193`            |
| AverageCostNet    | number  | Average net cost                              |                  |
| TaxCode / DutyCode | string | Tax config                                    |                  |
| StockLocations / SellingPrices / UnitConversions / SerialLots / Aliases | array | Child collections (per-location SOH, price levels) | |
| CompanionItems / SubstituteItems / ComponentDefinitions | array | Related/kit items            |                  |

**Modifiers:** `modifiedSince`, `isActive`, `analysisCode`, `stockingLocation`, `listOnly` (code+description only), `includeBarcodes`, `includeSerialLots`, `includeAliases`. Price calc: `action=sellingPrice` + `customer`/`priceLevel`/`currency`/`date`/`quantity`/`location`/`taxInclusive`/`unitOfMeasure`/`taxCode`/`tracePriceSteps`. [DOCS]

### POPurchaseOrder (Purchase order)

**Route:** `/POPurchaseOrder` (list), `/POPurchaseOrder/{Reference}` (single). **Verbs:** GET, POST (create/update). [DOCS]
**Description:** AP purchase document with line items.

| Field             | Type    | Description                          | Example     |
| ----------------- | ------- | ------------------------------------ | ----------- |
| Reference         | string  | PO number — route identifier          | `"100000"`  |
| Supplier / SupplierName | string | Supplier code + name            |             |
| Status            | string  | PO status                            |             |
| DocumentDate      | datetime| Order date                           |             |
| CurrencyCode      | string  | FX currency                          |             |
| NetAmount / TaxAmount / DiscountAmount | number | Totals               |             |
| Branch / Location / Address / PaymentTerm | string/object | Routing       |             |
| LineItems         | array   | Order lines (pricing, tax, qty tracking) |         |

**Modifiers:** `supplier`, `status` (pipe-separated list 2021.1+), `branch` (2017.1+), `modifiedSince`, `canBeApprovedByUser` (2019.1+). **Action:** `action=cancel` (2021.3+). [DOCS]

### SOSalesOrder (Sales order)

**Route:** `/SOSalesOrder` (list), `/SOSalesOrder/{Reference}` (single). **Verbs:** GET, POST (create/update). [DOCS]
**Description:** SO order document with line items + delivery/payment.

| Field             | Type    | Description                          | Example     |
| ----------------- | ------- | ------------------------------------ | ----------- |
| Reference         | string  | Order reference — route identifier    | `"SO100001"`|
| Customer          | string  | Customer code                        |             |
| Status            | string  | Order status (e.g. `"Entered"`)      | `"Entered"` |
| DocumentDate / DeliveryDate | datetime | Key dates                |             |
| NetAmount / TaxAmount / DiscountAmount | number | Totals               |             |
| SalesPerson / Branch / CurrencyCode | string | Attribution + FX        |             |
| LineItems         | array   | Order lines (+ delivery address, payment) |        |

**Modifiers:** `customer`, `status`, `salesPerson`, `branch`, `customerOrderNumber`, `modifiedSince`, plus receipt options (`generateReceipt`, `autoApplyReceipt`, `generateAdvanceReceipt`), `allowLongDeliveryAddressName`. **Actions:** `action=cancel` (needs `CancelStatus`), `action=putOnHold` (needs `HoldStatus`), `action=takeOffHold` (optional `OffHoldStatus`). [DOCS]

### SOPackingSlip (the overview's worked example)

**Route:** `/SOPackingSlip/{Reference}` (e.g. `24333.01`). GET = read the slip, POST = update, DELETE = delete. The canonical example in the API overview. [DOCS]

### JCJob (Job Costing job)

**Route:** `/JCJob` (list), `/JCJob/{Code}` (single). **Verbs:** GET, POST (create/update). [DOCS]
**Description:** Job Costing header — the cost-tracking container for project work.

| Field             | Type    | Description                            | Example           |
| ----------------- | ------- | -------------------------------------- | ----------------- |
| Code              | string  | Job code — route identifier             | `"5000"`          |
| Name              | string  | Job name                               | `"System for Kangan"` |
| Customer / CustomerName | string | Owning customer                  |                   |
| ClientReference / OrderNumber | string | External references          |                   |
| Status            | string  | Job status                             |                   |
| IsActive / IsClosed / IsFinalised | boolean | Lifecycle flags          |                   |
| Value             | number  | Job value                              |                   |
| StartDate / ExpectedEndDate / CreateDate | datetime | Dates             |                   |
| JobType / ProfitCentre / ChargeType / PriceCode | string | Classification     |                   |
| AccountManager / JobManager | string | Ownership                        |                   |
| SiteAddress / DeliveryAddress / UserDefinedFields / Trees | object/array | Child collections | |

**Modifiers:** `customer`, `accountManager`, `jobManager`, `parentJob`, `jobType`, `profitCentre`, `template`, `modifiedSince`, `treeName`+`treeBranch`, plus flags `isRecursive`, `includeSubJobs`, `excludeClosed`, `excludeFinalised`, `isOpen`, `isPlantOnly`, `workCentreAssignedEmployee`. [DOCS]

### Shared cross-cutting sub-objects (on most entities) [DOCS]

| Sub-object    | Shape / key fields                                                                 | How to access                                                          |
| ------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Attachment    | Name, FileName, FileSize, Type, OidString, Edition, ModifiedTimeStamp, FileBinary  | GET `?includeAttachments=true`; download `?action=attachment&name=`; upload `?action=attachment` (multipart) |
| StickyNote    | Type, Note, IsActive, SortDate, OidString, Edition                                 | GET `?includeStickyNotes=true` (`stickyNoteType=` to filter); POST same structure to create/update (2020.1) |
| Approval      | Code, Status, Reason, Approvers[]{Status, ToBeApprovedBy, ApprovedBy, ApprovedTimeStamp} | GET `?includeApprovals=true`; act via `?action=approve|reject|clearApproval` |
| PlugInProperties | OID, OID_AuditTrailNumber, bookmarkText, dynamic property values                | GET `?includePluginProperties=true` (2020)                            |
| LinkedObjects | generic object-to-object links                                                     | GET `?includeLinkedObjects=true` (2020)                               |
| UserDefinedFields | name/value UDFs declared in UserDefinedFieldDefinitions                         | embedded in the entity DTO                                             |
| Trees         | tree/branch memberships (org structures)                                           | embedded; filter lists by `treeName`+`treeBranch`                     |

> **Confidential/inactive Sticky Notes are NOT retrievable via the API.** [DOCS]

---

## Entity Relationship Diagram

```
ORDER-TO-CASH                                  PROCURE-TO-PAY
┌──────────┐ 1:N ┌──────────────┐             ┌──────────┐ 1:N ┌────────────────┐
│ Customer │────>│ SOSalesOrder │             │ Supplier │────>│ POPurchaseOrder│
│(ARCustomer)│   └──────┬───────┘             │(APSupplier)│   └───────┬────────┘
└────┬─────┘ 1:N        │ LineItems                 │ 1:N           │ LineItems
     │                  ▼ N:1 StockItem             │               ▼
     │ 1:N        ┌──────────────┐                  │          ┌──────────┐
     │───────────>│  ARInvoice   │                  │─────────>│ APInvoice│
     │            └──────────────┘                  │          └──────────┘
     │ 1:N  SOPackingSlip (fulfilment)          POReceipt (goods receipt)
     ▼
  ARReceipt / ARCreditNote                     APPayment / APCreditNote

JOB COSTING                          GENERAL LEDGER (posting target for all of the above)
┌────────┐ 1:N ┌─────────────┐       ┌───────────┐   GL postings flow from AR/AP/IN/SO/PO docs
│ JCJob  │────>│ JCTimesheet │       │ GLAccount │<──(IsPosting accounts; GLDocument batches;
└───┬────┘     │ JCEstimate  │       └───────────┘    GLPeriodSummary period balances)
    │ N:1      │ JCDisbursement│
 Customer      │ JCPlantCharge │
```

(Relationships inferred from module structure + entity fields; line-item ↔ master links are [UNVERIFIED] in exact field naming.) [DOCS / UNVERIFIED]

---

## Lifecycle & Status Fields

> ⚠️ Status vocabularies are **per-entity and per-customer-config** — Greentree ships
> configurable status definitions (`SOStatusDefinition`, `POStatusDefinition`, `JCStatus`).
> Concrete values below are [UNVERIFIED] unless tagged. Discover them by listing
> `/{company}/SOStatusDefinition` etc., or by inspecting distinct `Status` values in a small list.

### Sales order (SOSalesOrder)

```
[Entered] ──edit (POST /{ref})──> [updated] ──action=putOnHold──> [on hold] ──action=takeOffHold──> [active]
    │                                                                   │
    └── action=cancel (needs CancelStatus) ──> [cancelled]             └── fulfil via SOPackingSlip
```

- Status string examples seen in docs: `"Entered"` [DOCS]. Hold/cancel transitions are **actions**, each carrying a required status field in the POST body (`HoldStatus`, `CancelStatus`, optional `OffHoldStatus`). [DOCS]
- Receipt generation can be triggered at create time (`generateReceipt`, `autoApplyReceipt`, `generateAdvanceReceipt`). [DOCS]

### Purchase order (POPurchaseOrder)

```
[created/POST] ──update (POST /{ref})──> [updated] ──(approval workflow)──> [approved] ──> POReceipt ──> APInvoice
       └── action=cancel (2021.3+) ──> [cancelled]
```

- `status` filter accepts a pipe-separated list (2021.1+). `canBeApprovedByUser` (2019.1+) finds POs awaiting a given approver. Approval via the generic `action=approve`/`reject`/`clearApproval`. [DOCS]

### AR invoice (ARInvoice)

```
[created/POST] ──> [posted] ──action=setIsPrinted (2021.1+)──> [printed]
```

- POST to `/ARInvoice/{Reference}` runs **actions only** (e.g. `setIsPrinted`), not arbitrary field updates — unlike Customer/Supplier where POST-to-identifier updates fields. Confirm per entity. [DOCS]
- `IsPrinted`, `HoldCode`, `PaymentDate` track post-creation state. [DOCS]

### Job (JCJob)

```
[active: IsActive=true] ──work posted (JCTimesheet/JCDisbursement/JCPlantCharge)──> [closed: IsClosed] ──> [finalised: IsFinalised]
```

- Three boolean lifecycle flags: `IsActive`, `IsClosed`, `IsFinalised`. List filters `excludeClosed`/`excludeFinalised`/`isOpen` key off them. [DOCS]

### Approvals (any entity)

```
[unapproved] ──action=approve──> [approved] ──action=clearApproval──> [unapproved]
            └──action=reject──> [rejected]
```

- Approval state is read via `?includeApprovals=true` (`Approval.Status`, per-`Approver` status). Multi-level approver chains. [DOCS]

---

## Business Rules

### Ordering / dependency rules

- A `Customer` must exist before an `SOSalesOrder`/`ARInvoice`; a `Supplier` before a `POPurchaseOrder`/`APInvoice`; a `StockItem`/`GLAccount` before referencing it on lines. Resolve the human key via a list GET first. [DOCS / UNVERIFIED exact validation]
- `GLAccount.IsPosting=true` is required for an account to receive postings (heading accounts can't). [DOCS]
- Most documents post to the GL on completion; reversing is via Greentree business logic, not a simple DELETE. [UNVERIFIED]

### Write semantics

- **Create** = POST to `/{entity}` (no identifier); Greentree allocates the key. **Update** = POST to `/{entity}/{identifier}` with a partial body (Customer/Supplier/SO/PO/StockItem/Job). For `ARInvoice`, POST-to-identifier is **action-only**. [DOCS]
- Whether an omitted field is left untouched vs cleared on update is **[UNVERIFIED]** — send only fields you intend to change; test merge behavior on a scratch record.
- **The user's Greentree permissions apply to writes too** — a write the user can't perform in Greentree will be refused. [DOCS]

### Computed / read-only fields

- Audit fields (`EntryUser`, `EntryTimeStamp`, `ModifiedUser`, `ModifiedTimeStamp`), `OidString`, `Edition`, document totals (`NetAmount`/`TaxAmount` recomputed from lines), and stock positions (`QuantityOnHand`/`Available`/`Committed`) are server-maintained. [DOCS / UNVERIFIED which totals are writable]

---

## Field Format Reference

| Format        | Pattern                              | Example                         | Notes                                                  |
| ------------- | ------------------------------------ | -------------------------------- | ------------------------------------------------------ |
| Human key     | string (per entity)                  | `CUST1234`, `1000`, `100023`     | Route identifier; allocated by Greentree on create     |
| Reference     | string, may be dotted                | `24333.01`, `SO100001`           | Treat as opaque; don't parse                            |
| OidString     | dotted numeric string                | `3456.768`                       | Internal object id; NOT the route key                   |
| Edition       | integer                              | `3`                              | Row version on entities/sub-objects                     |
| DateTime      | ISO8601, no timezone offset          | `2013-02-28T16:45:00`            | Server-local time; used by `modifiedSince` [UNVERIFIED tz] |
| Money         | plain number                         | `612.47`                         | Local currency; `CurrencyCode`/`CurrencyRate` for FX    |
| Quantity      | number                               | `193`                            | Respect the item's UOM                                  |
| Boolean       | JSON boolean                         | `true`                           | `IsActive`, `IsPosting`, `IsPrinted`, `IsClosed`…       |
| Status        | string (per-entity, configurable)    | `"Entered"`, `"Active"`          | Validate against the entity's StatusDefinition          |

---

## Status / Enum Value Reference

> The docs declare **no universal enum sets** — status/type vocabularies are configurable per
> customer and exposed via dedicated definition entities. Discover them empirically.

| Entity           | Field         | How to discover valid values                                   |
| ---------------- | ------------- | --------------------------------------------------------------- |
| SOSalesOrder     | Status        | List `/{company}/SOStatusDefinition`; `"Entered"` seen [DOCS]    |
| POPurchaseOrder  | Status        | List `/{company}/POStatusDefinition`; `status` filter = pipe-list (2021.1+) |
| JCJob            | Status / flags| `/{company}/JCStatus`; plus `IsActive`/`IsClosed`/`IsFinalised`  |
| Customer/Supplier| Status        | Distinct `Status` values via a small list GET                   |
| GLAccount        | AccountType   | `Income`/`Expense`/… — confirm the customer's chart [UNVERIFIED] |
| StockItem        | Status / StockType | Distinct values via a `listOnly` scan                      |
| Approval         | Status        | `Approved`/`Rejected`/… per `?includeApprovals=true` [DOCS]      |

---

_Generated 2026-06-11 from MYOB Greentree's official API documentation (overview + per-entity pages)._
_NOT live-tested — verify entity routes, fields, and version-gated modifiers against the customer's instance before first use._
