---
api_name: MYOB Greentree
api_slug: greentree
doc: domain-model reference (entity catalog, identifiers, modules, lifecycle/status, business rules) — companion to 01-llm-api-rules.md (on-demand)
path_rule: /{company}/{entity}[/{identifier}] — company code first; identifier is the human key, NOT OidString
field_casing: PascalCase
call_surface: HTTP via connectors(name="request", connector="greentree")
confidence: docs-derived (MYOB Greentree official per-entity docs); NOT live-validated. Field lists are selected key fields (full Jade DTOs are larger). Treat all as [DOCS] unless tagged [UNVERIFIED]; verify routes/fields/version-gated modifiers against the customer's instance.
---

# MYOB Greentree — Domain Model Reference

## URL shape

Every call: `/{company}/{entity}[/{identifier}]`. Segment order is mandatory. A GET with no `{identifier}` returns a paged, 100-capped list.

| Segment        | Meaning                                             | Example                        |
| -------------- | --------------------------------------------------- | ------------------------------ |
| `{company}`    | Greentree company code — required, part of the path | `01`                           |
| `{entity}`     | Jade class name (PascalCase)                        | `SOPackingSlip`, `GLAccount`   |
| `{identifier}` | record's human key — optional (omit = list)         | `24333.01`, `CUST1234`, `1000` |

**Route vs Jade class:** AR Customer = class `ARCustomer`, route `/Customer`; AP Supplier = `APSupplier`, route `/Supplier`. GL/SO/PO/JC use prefixed class names as the route (`GLAccount`, `SOSalesOrder`, `POPurchaseOrder`, `JCJob`). When unsure, check the entity's docs page for the exact route token.

## ID semantics — human keys + OidString

- **Path identifier = the entity's natural human key**, not an internal id: `AccountNo` (GL), customer/supplier `Code`, `Reference` (AR/AP invoices, SO/PO docs), part `Code` (stock), job `Code`.
- Most entities ALSO carry **`OidString`** (internal object id, e.g. `3456.768`) + **`Edition`** (row version). Returned in responses and in Attachment/Sticky-Note/Approval sub-objects, but NOT the route key.
- **On create you generally cannot specify the identifier** — Greentree allocates it (documented exceptions per entity). Capture it from the POST response.
- References can be dotted (`24333.01`); treat as opaque strings, don't parse/construct.
- For "find X named Y", resolve via a list GET with the right modifier (`?customer=`, `?emailAddress=`, `?globalSearch=`) before hitting an identifier route.

## Module map (entity catalog from the docs index)

Module prefix = Jade class prefix; route = class name unless noted. Entity availability is **version-gated** — older instances expose fewer; confirm against the customer's version.

| Module     | Entities (Jade class / route)                                                                                                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GL**     | GLAccount, GLAccountSegmentDefinition, GLBudget, GLControl, GLDocument, GLPeriodSummary, GLBankIn (cash receipts), GLBankOut (cash payments)                                                                                                                                                            |
| **AR**     | Customer (class ARCustomer), ARInvoice, ARReceipt, ARCreditNote, ARSalesPerson, ARControl                                                                                                                                                                                                               |
| **AP**     | Supplier (class APSupplier), APInvoice, APInvoiceOnCharge, APPayment, APCreditNote, APControl                                                                                                                                                                                                           |
| **IN**     | StockItem, INTransaction, INTransactionType, INStorageProfile, INStockTake, INStockTakeItem, INSerialLot, INLocation, INForecast, INControl, INBudget, INBinType, INBinTransaction, INAnalysisCode, INUnitOfMeasure, + Advanced Pricing entities                                                        |
| **PO**     | POPurchaseOrder, POReceipt, POShipments, POStatusDefinition                                                                                                                                                                                                                                             |
| **SO**     | SOSalesOrder, SOPackingSlip, SOCarrier, SOStatusDefinition                                                                                                                                                                                                                                              |
| **JC**     | JCJob, JCJobType, JCActivity, JCDisbursement, JCEstimate, JCEmployee, JCTimesheet, JCPlantCharge, JCWorkCentre, JCWorkCentrePlan, JCStatus, JCControl                                                                                                                                                   |
| **HR**     | HRPerson, HRApplicant, HRPosition, HREmploymentType, HRLeaveRequest, HRIncident (+Type/Status/EventType), HRInjury (Type/Severity), HRTrainingType, HRSkillType, HRMedicalRole, HRCertificationType, HR CV\* (Training/Skill/Medical/Employment/Education/Certification), HREducationType, HRAwardClass |
| **CRM**    | CRMContact, CRMOrganisation, CRMLead, CRMQuote, CRMTask, CRMServiceRequest, CRM SV Request (Type/Status), CRM SV Contract (+Cost), CRM SV Asset (+Type/Class/Usage), CRMCommunication (+Priority), CRMMessage, CRMDocumentRule, CRMWebTimesheet                                                         |
| **FA**     | FAMaster, FAControl, FAPurchase, FADisposal, FATransfer, FARevaluation, FADepreciation, FAAdjustment, FABalanceAdjustment, FAWriteOffs                                                                                                                                                                  |
| **FO**     | FOFactoryOrder, FOFactoryOrderReceipts (manufacturing)                                                                                                                                                                                                                                                  |
| **BOM**    | BOMBillOfMaterials                                                                                                                                                                                                                                                                                      |
| **SCM**    | SCMRequisitions                                                                                                                                                                                                                                                                                         |
| **UT**     | UTTaxCode, UTPaymentTerm, UTCurrencyCode, UTCountry (utility/reference)                                                                                                                                                                                                                                 |
| **EC**     | ECWebUser (e-commerce)                                                                                                                                                                                                                                                                                  |
| **System** | Company, Branch, ProfitCentre, Tree, User, UserSecuritySnapshot, UserDefinedFieldDefinitions, BrowserTimesheets, Ping, AHFormDefinition, GlobalSearch                                                                                                                                                   |

## Entity catalog (core verticals) — selected key fields (route identifier **bold**; PascalCase; types: str=string, n=number, b=boolean, o=object, a=array, dt=datetime)

### GLAccount — `/GLAccount[/{AccountNo}]`. GET only. Chart-of-accounts entry.

Fields: **AccountNo** (str, `"1000"`), Description (name), AccountType (`"Income"`/Expense/Asset/Liability, values vary), AccountSign (debit/credit normal sign), Status, CurrencyCode (`"AUD"`), IsPosting (b — postable vs heading, `true`), IsQuantityAccount (b), ShortCode/Unit/SecurityLevel/AssignedTeam (classification/security), Trees/UserDefinedFields (a).
Modifiers: `accountType`, `treeName`+`treeBranch`, `modifiedSince`, `includeTransactionTrees`, `includeOpeningBalance={fiscalYear}`, `respectAdvancedSecurityForUser`.

### Customer (class ARCustomer) — `/Customer[/{Code}]`. GET, POST (create/update), DELETE. AR customer master.

Fields: **Code** (str, allocated on create, `"CUST1234"`), Alpha/Name (search alpha/full name), Status (`"Active"`), Address (o: Contact, Address1-3, Suburb, Postcode, State, Country, Phone(BH/AH), Fax, Email, Web, Mobile), BankAccount (o: AccountNo, Branch, BranchNo, Name, Suffix), CreditLimit + CreditLimitOverdue1Plus..4Plus (n, `10000`), IsCheckingCredit/IsCreditAllowed/IsChild (b — credit+hierarchy), Currency/TaxCode/TaxMethod/BalanceType, DefaultPaymentTerm/DefaultPriceLevel/DefaultINInvoiceType/DefaultINCreditNoteType (posting defaults), SalesPerson/Branch/Calendar/CBAnalysis (attribution), InvoiceDeliveryMethod/StatementDeliveryMethod/ReceiptDeliveryMethod, DeliveryAddresses/WebUsers/UserDefinedFields/Trees/Balances/SalesOrderTotal (child collections).
Modifiers: `modifiedSince`, `isActive`, `emailAddress`, `treeName`+`treeBranch`, `includeWebUsers` (post-2018.3), `respectAdvancedSecurityForUser` (2020.3).

### Supplier (class APSupplier) — `/Supplier[/{Code}]`. GET, POST (create/update). AP supplier master.

Fields: **Code** (str, `"SUPP01"`), Name/Alpha, Status/IsActive, TaxReference (ABN/tax id), PaymentMethod/PaymentTerm, Currency/TaxCode/TaxType (`"AUD"`), BankAccount/Address/PayeeAddress (o), DiscountRate/DiscountType (settlement discount), AnalysisCode/Branch/DeliveryMethod/InvoiceForm (defaults), PurchaseOrders/UserDefinedFields/Trees (a).
Modifiers: `modifiedSince`, `isActive`, `taxReference`, `status`, `treeName`+`treeBranch`, `respectAdvancedSecurityForUser` (2020.3).

### ARInvoice — `/ARInvoice[/{Reference}]`. GET; POST to create; POST to `/{Reference}` = **actions only** (e.g. `setIsPrinted`, 2021.1+), NOT free-form update. AR sales invoice with GL line items.

Fields: **Reference** (str, `"100023"`), Customer (code, `"CUST1234"`), DocumentDate/PostingDate/PaymentDate (dt), NetAmount/TaxAmount/HoldAmount/Discount (n), CurrencyRate/Currency (FX), Branch/SalesPerson/PaymentTerm/HoldCode, OrderNumber/BatchNumber, IsPrinted (b — `action=setIsPrinted` flips it), EntryUser/EntryTimeStamp/ModifiedUser/ModifiedTimeStamp (audit), LineItems (a — GLLineItem rows + TransactionAnalysis trees: Contract/Site/Salesperson dims).
Modifiers: `customer`, `holdCode`, `outstandingOnly`, `modifiedSince`, `postingDate` (2021.1+), `sortBy1`/`sortDesc1` (2021.1+ — ARInvoice was the FIRST sortable entity).

### StockItem — `/StockItem[/{Code}]`. GET; POST to update (standard); POST to create (2021.3+). Product/SKU master.

Fields: **Code** (str, `"00AOPEN17MONITOR"`), Description, Status/IsActive, StockType/ActivityCode/AnalysisCode (classification), SellingUOM/StockingUOM/PurchasingUOM (`"EACH"`), QuantityOnHand/QuantityAvailable/QuantityCommitted (n, `193`), AverageCostNet (n), TaxCode/DutyCode, StockLocations/SellingPrices/UnitConversions/SerialLots/Aliases (a — per-location SOH, price levels), CompanionItems/SubstituteItems/ComponentDefinitions (a — related/kit items).
Modifiers: `modifiedSince`, `isActive`, `analysisCode`, `stockingLocation`, `listOnly` (code+description only), `includeBarcodes`, `includeSerialLots`, `includeAliases`. Price calc: `action=sellingPrice` + `customer`/`priceLevel`/`currency`/`date`/`quantity`/`location`/`taxInclusive`/`unitOfMeasure`/`taxCode`/`tracePriceSteps`.

### POPurchaseOrder — `/POPurchaseOrder[/{Reference}]`. GET, POST (create/update). AP purchase document with line items.

Fields: **Reference** (str, `"100000"`), Supplier/SupplierName (code+name), Status, DocumentDate (dt), CurrencyCode (FX), NetAmount/TaxAmount/DiscountAmount (n), Branch/Location/Address/PaymentTerm (routing), LineItems (a — pricing, tax, qty tracking).
Modifiers: `supplier`, `status` (pipe-separated list 2021.1+), `branch` (2017.1+), `modifiedSince`, `canBeApprovedByUser` (2019.1+). Action: `action=cancel` (2021.3+).

### SOSalesOrder — `/SOSalesOrder[/{Reference}]`. GET, POST (create/update). SO order document with line items + delivery/payment.

Fields: **Reference** (str, `"SO100001"`), Customer (code), Status (`"Entered"`), DocumentDate/DeliveryDate (dt), NetAmount/TaxAmount/DiscountAmount (n), SalesPerson/Branch/CurrencyCode, LineItems (a — + delivery address, payment).
Modifiers: `customer`, `status`, `salesPerson`, `branch`, `customerOrderNumber`, `modifiedSince`, receipt options (`generateReceipt`, `autoApplyReceipt`, `generateAdvanceReceipt`), `allowLongDeliveryAddressName`. Actions: `action=cancel` (needs `CancelStatus`), `action=putOnHold` (needs `HoldStatus`), `action=takeOffHold` (optional `OffHoldStatus`).

### SOPackingSlip — `/SOPackingSlip/{Reference}` (e.g. `24333.01`). GET=read, POST=update, DELETE=delete. The canonical API-overview example.

### JCJob — `/JCJob[/{Code}]`. GET, POST (create/update). Job Costing header.

Fields: **Code** (str, `"5000"`), Name (`"System for Kangan"`), Customer/CustomerName, ClientReference/OrderNumber (external refs), Status, IsActive/IsClosed/IsFinalised (b — lifecycle), Value (n), StartDate/ExpectedEndDate/CreateDate (dt), JobType/ProfitCentre/ChargeType/PriceCode (classification), AccountManager/JobManager (ownership), SiteAddress/DeliveryAddress/UserDefinedFields/Trees (child collections).
Modifiers: `customer`, `accountManager`, `jobManager`, `parentJob`, `jobType`, `profitCentre`, `template`, `modifiedSince`, `treeName`+`treeBranch`, flags `isRecursive`, `includeSubJobs`, `excludeClosed`, `excludeFinalised`, `isOpen`, `isPlantOnly`, `workCentreAssignedEmployee`.

### Shared cross-cutting sub-objects (on most entities)

| Sub-object        | Shape / key fields                                                                       | How to access                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Attachment        | Name, FileName, FileSize, Type, OidString, Edition, ModifiedTimeStamp, FileBinary        | GET `?includeAttachments=true`; download `?action=attachment&name=`; upload `?action=attachment` (multipart) |
| StickyNote        | Type, Note, IsActive, SortDate, OidString, Edition                                       | GET `?includeStickyNotes=true` (`stickyNoteType=` to filter); POST same structure to create/update (2020.1)  |
| Approval          | Code, Status, Reason, Approvers[]{Status, ToBeApprovedBy, ApprovedBy, ApprovedTimeStamp} | GET `?includeApprovals=true`; act via `?action=approve\|reject\|clearApproval`                               |
| PlugInProperties  | OID, OID_AuditTrailNumber, bookmarkText, dynamic property values                         | GET `?includePluginProperties=true` (2020)                                                                   |
| LinkedObjects     | generic object-to-object links                                                           | GET `?includeLinkedObjects=true` (2020)                                                                      |
| UserDefinedFields | name/value UDFs declared in UserDefinedFieldDefinitions                                  | embedded in the entity DTO                                                                                   |
| Trees             | tree/branch memberships (org structures)                                                 | embedded; filter lists by `treeName`+`treeBranch`                                                            |

> **Confidential/inactive Sticky Notes are NOT retrievable via the API.**

## Entity relationships

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

(Relationships inferred from module structure + entity fields; line-item ↔ master link field naming is [UNVERIFIED].)

## Lifecycle & status fields

Status vocabularies are **per-entity and per-customer-config** — Greentree ships configurable status definitions (`SOStatusDefinition`, `POStatusDefinition`, `JCStatus`). Concrete values below are [UNVERIFIED] unless tagged. Discover by listing `/{company}/SOStatusDefinition` etc., or inspecting distinct `Status` values in a small list.

- **SOSalesOrder:** `[Entered]` → edit (POST `/{ref}`) → `[updated]` → `action=putOnHold` → `[on hold]` → `action=takeOffHold` → `[active]`; `action=cancel` (needs `CancelStatus`) → `[cancelled]`; fulfil via SOPackingSlip. Status seen in docs: `"Entered"`. Hold/cancel are **actions**, each carrying a required status field in the body (`HoldStatus`, `CancelStatus`, optional `OffHoldStatus`). Receipt generation triggerable at create (`generateReceipt`, `autoApplyReceipt`, `generateAdvanceReceipt`).
- **POPurchaseOrder:** `[created/POST]` → update (POST `/{ref}`) → `[updated]` → (approval workflow) → `[approved]` → POReceipt → APInvoice; `action=cancel` (2021.3+) → `[cancelled]`. `status` filter accepts a pipe-list (2021.1+); `canBeApprovedByUser` (2019.1+) finds POs awaiting an approver. Approval via generic `action=approve`/`reject`/`clearApproval`.
- **ARInvoice:** `[created/POST]` → `[posted]` → `action=setIsPrinted` (2021.1+) → `[printed]`. POST to `/ARInvoice/{Reference}` runs **actions only**, not arbitrary field updates (unlike Customer/Supplier). `IsPrinted`,`HoldCode`,`PaymentDate` track post-creation state.
- **JCJob:** `[active: IsActive=true]` → work posted (JCTimesheet/JCDisbursement/JCPlantCharge) → `[closed: IsClosed]` → `[finalised: IsFinalised]`. Three boolean lifecycle flags; list filters `excludeClosed`/`excludeFinalised`/`isOpen` key off them.
- **Approvals (any entity):** `[unapproved]` → `action=approve` → `[approved]` → `action=clearApproval` → `[unapproved]`; `action=reject` → `[rejected]`. State read via `?includeApprovals=true` (`Approval.Status`, per-`Approver` status). Multi-level approver chains.

## Business rules

- **Ordering/dependency:** a `Customer` must exist before an `SOSalesOrder`/`ARInvoice`; a `Supplier` before a `POPurchaseOrder`/`APInvoice`; a `StockItem`/`GLAccount` before referencing it on lines. Resolve the human key via a list GET first [UNVERIFIED exact validation].
- `GLAccount.IsPosting=true` is required for an account to receive postings (heading accounts can't).
- Most documents post to the GL on completion; reversing is via Greentree business logic, not a simple DELETE [UNVERIFIED].
- **Write semantics:** Create = POST `/{entity}` (no identifier; Greentree allocates the key). Update = POST `/{entity}/{identifier}` with a partial body (Customer/Supplier/SO/PO/StockItem/Job). For `ARInvoice`, POST-to-identifier is **action-only**. Whether an omitted field is left untouched vs cleared on update is **[UNVERIFIED]** — send only fields you intend to change; test merge on a scratch record. The user's Greentree permissions apply to writes too — a write the user can't perform is refused.
- **Computed/read-only fields:** Audit fields (`EntryUser`,`EntryTimeStamp`,`ModifiedUser`,`ModifiedTimeStamp`), `OidString`, `Edition`, document totals (`NetAmount`/`TaxAmount` recomputed from lines), stock positions (`QuantityOnHand`/`Available`/`Committed`) are server-maintained [UNVERIFIED which totals are writable].

## Field formats

- Human key: per-entity string (`CUST1234`,`1000`,`100023`) — route identifier, allocated on create.
- Reference: string, may be dotted (`24333.01`,`SO100001`) — opaque, don't parse.
- OidString: dotted numeric (`3456.768`) — internal object id, NOT the route key. Edition: integer (`3`) — row version on entities/sub-objects.
- DateTime: ISO8601, no timezone offset (`2013-02-28T16:45:00`) — server-local; used by `modifiedSince` [UNVERIFIED tz].
- Money: plain number (`612.47`) — local currency; `CurrencyCode`/`CurrencyRate` for FX. Quantity: number (`193`), respect the item's UOM.
- Boolean: JSON `true`/`false` (`IsActive`,`IsPosting`,`IsPrinted`,`IsClosed`…). Status: per-entity configurable string (`"Entered"`,`"Active"`) — validate against the entity's StatusDefinition.

## Status / enum discovery (no universal enum sets — configurable per customer)

- SOSalesOrder.Status → list `/{company}/SOStatusDefinition`; `"Entered"` seen.
- POPurchaseOrder.Status → list `/{company}/POStatusDefinition`; `status` filter = pipe-list (2021.1+).
- JCJob.Status/flags → `/{company}/JCStatus`; plus `IsActive`/`IsClosed`/`IsFinalised`.
- Customer/Supplier.Status → distinct values via a small list GET. StockItem.Status/StockType → distinct values via a `listOnly` scan.
- GLAccount.AccountType → `Income`/`Expense`/… confirm the customer's chart [UNVERIFIED]. Approval.Status → `Approved`/`Rejected`/… per `?includeApprovals=true`.
