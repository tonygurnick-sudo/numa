---
api_name: simPRO
api_slug: simpro
doc: domain-model-reference (companion to 01-llm-api-rules.md)
base_url: https://{build}.simprosuite.com/api/v1.0/ (/api/v1.0 is a real path segment)
company_scope: every resource path is /companies/{companyID}/{resource}/
field_casing: PascalCase
data_sources: SyncHub data model (100+ entities), official PHP SDK, forum, rollout guides
confidence: field names/types/relationships confirmed from SyncHub data model + SDK + forum unless tagged [INFERRED]/[UNKNOWN]/[DOCUMENTED]
---

# simPRO — Domain Model Reference

Entity catalog, relationships, state machines, business rules. Resource path = `/companies/{companyID}/{resource}/`.

## Entities

### Job — `/jobs/` — CRUD: Create/Read/Update/Delete

Core work entity: work performed for a customer at a site.
| Field | Type | Required | Writable | Notes |
| --- | --- | --- | --- | --- |
| ID | int | - | no | |
| Name | string | no | yes | |
| Description | string | no | yes | |
| Type | string | yes (create) | yes | `Service`, `Project`, or `Prepaid` |
| IndividualCustomerID | int | conditional | yes | FK IndividualCustomer |
| CompanyCustomerID | int | conditional | yes | FK CompanyCustomer |
| CustomerContactID | int | no | yes | FK Contact |
| SiteID | int | yes (create) | yes | FK Site |
| SiteContactID | int | no | yes | FK Contact (site) |
| OrderNo | string | no | yes | |
| Notes | string | no | yes | |
| DateIssued | datetime | no | yes | |
| DueDate | datetime | no | yes | |
| DueTime | string | no | yes | |
| SalesPersonEmployeeID | int | no | yes | FK Employee |
| ProjectManagerEmployeeID | int | no | yes | FK Employee |
| Stage | string | no | no | Pending/Progress/Complete/Invoiced/Archived |
| StatusID | int | no | yes | FK ProjectStatusCode |
| ResponseTimeID | int | no | yes | |
| IsVariation | boolean | no | yes | |
| ConvertedFromQuoteID | int | no | no | FK Quote |
| ConvertedFromRecurringJobID | long | no | no | FK CompanyRecurringJob |
| AutoAdjustStatus | boolean | no | yes | |
| IsRetentionEnabled | boolean | no | yes | |
| CompletedDate | datetime | no | no | |
| Totals (sub-fields) | decimals | no | no | Computed |
| Materials/Resources/Markup cost fields | decimals | no | no | Cost breakdowns |

Relationships: CompanyCustomer N:1 (CompanyCustomerID); IndividualCustomer N:1 (IndividualCustomerID); Site N:1 (SiteID); Contact N:1 (CustomerContactID, SiteContactID); Employee N:1 (SalesPersonEmployeeID, ProjectManagerEmployeeID); JobSection 1:N (`/jobs/{id}/sections/`); JobSectionCostCenter 1:N (nested via JobSection); JobCard 1:N (sub-resource); JobAttachmentFile/Folder 1:N (sub-resource, file ID = string); JobLog 1:N (sub-resource); Invoice 1:N (on invoicing); Quote N:1 (ConvertedFromQuoteID).

### Quote — `/quotes/` — CRUD: Create/Read/Update

Customer proposal/estimate; convertible to a Job.
| Field | Type | Required | Writable | Notes |
| --- | --- | --- | --- | --- |
| ID | int | - | no | |
| Name | string | no | yes | |
| Description | string | no | yes | |
| IndividualCustomerID | int | conditional | yes | FK IndividualCustomer |
| CompanyCustomerID | int | conditional | yes | FK CompanyCustomer |
| CustomerContactID | int | no | yes | FK Contact |
| SiteID | int | yes (create) | yes | FK Site |
| SiteContactID | int | no | yes | FK Contact |
| SalesPersonEmployeeID | int | no | yes | FK Employee |
| ProjectManagerEmployeeID | int | no | yes | FK Employee |
| StatusID | int | no | yes | FK ProjectStatusCode |
| DateIssued | datetime | no | yes | |
| DueDate | datetime | no | yes | |
| ValidityDays | decimal | no | yes | |
| OrderNo | string | no | yes | |
| RequestNo | string | no | yes | |
| Stage | string | no | no | |
| IsClosed | boolean | no | no | |
| ConvertedFromLeadID | int | no | no | FK Lead |
| Totals (sub-fields) | decimals | no | no | Computed |

Relationships: Customer N:1 (Company/IndividualCustomerID); Site N:1 (SiteID); QuoteSection 1:N (`/quotes/{id}/sections/`); QuoteAttachmentFile 1:N; QuoteLog 1:N; Job 1:1 (conversion); Lead N:1 (ConvertedFromLeadID).

### Lead — `/leads/` — CRUD: Create/Read/Update

Prospective opportunity; converts to Quote or Job.
| Field | Type | Required | Writable | Notes |
| --- | --- | --- | --- | --- |
| ID | int | - | no | |
| LeadName | string | no | yes | |
| Description | string | no | yes | |
| Stage | string | no | no | |
| StatusID | int | no | yes | FK ProjectStatusCode |
| FollowUpDate | string | no | yes | |
| DateCreated | string | no | no | |
| Notes | string | no | yes | |
| IndividualCustomerID | int | conditional | yes | FK IndividualCustomer |
| CompanyCustomerID | int | conditional | yes | FK CompanyCustomer |
| SiteID | int | no | yes | FK Site |
| CostCenterID | int | no | yes | FK CostCenter |
| SalesPersonEmployeeID | int | no | yes | FK Employee |
| SalesPersonContractorID | int | no | yes | FK Contractor |
| ProjectManagerEmployeeID | int | no | yes | FK Employee |
| ForecastEstimatedPrice | decimal | no | yes | |
| ForecastProbability | decimal | no | yes | |
| ForecastExpectedYear | decimal | no | yes | |
| ForecastExpectedMonth | decimal | no | yes | |
| AutoAdjustStatus | boolean | no | yes | |

### Customer (Company) — `/customers/companies/` — CRUD: Create/Read/Update

| Field                 | Type    | Required | Writable | Notes                                 |
| --------------------- | ------- | -------- | -------- | ------------------------------------- |
| ID                    | int     | -        | no       |                                       |
| CompanyName           | string  | yes      | yes      | filter with `CompanyName`, NOT `Name` |
| EIN                   | string  | no       | yes      | Employer ID Number                    |
| Website               | string  | no       | yes      |                                       |
| Fax                   | string  | no       | yes      |                                       |
| Address fields        | objects | no       | yes      | Physical address                      |
| BillingAddress fields | objects | no       | yes      |                                       |
| Banking fields        | objects | no       | yes      | Payment terms                         |

### Customer (Individual) — `/customers/individuals/` — CRUD: Create/Read/Update

| Field                 | Type    | Required | Writable | Notes       |
| --------------------- | ------- | -------- | -------- | ----------- |
| ID                    | int     | -        | no       |             |
| Title                 | string  | no       | yes      | Mr/Mrs etc. |
| GivenName             | string  | yes      | yes      | First name  |
| FamilyName            | string  | yes      | yes      | Last name   |
| CellPhone             | string  | no       | yes      |             |
| Email                 | string  | no       | yes      |             |
| Phone                 | string  | no       | yes      |             |
| Address fields        | objects | no       | yes      |             |
| BillingAddress fields | objects | no       | yes      |             |
| Banking fields        | objects | no       | yes      |             |

### Contact — `/contacts/` — CRUD: Create/Read/Update

| Field        | Type    | Required | Writable | Notes |
| ------------ | ------- | -------- | -------- | ----- |
| ID           | int     | -        | no       |       |
| Title        | string  | no       | yes      |       |
| GivenName    | string  | yes      | yes      |       |
| FamilyName   | string  | yes      | yes      |       |
| Email        | string  | no       | yes      |       |
| Phone fields | strings | no       | yes      |       |
| Department   | string  | no       | yes      |       |
| Position     | string  | no       | yes      |       |
| Notes        | string  | no       | yes      |       |

### Site — `/sites/` — CRUD: Create/Read/Update

Customer property location where work is performed.

### Employee — `/employees/` — CRUD: Read/Update

| Field            | Type     | Required | Writable | Notes        |
| ---------------- | -------- | -------- | -------- | ------------ |
| ID               | int      | -        | no       |              |
| Name             | string   | yes      | yes      |              |
| Position         | string   | no       | yes      |              |
| DateOfHire       | datetime | no       | yes      |              |
| DateOfBirth      | datetime | no       | yes      |              |
| Address fields   | objects  | no       | yes      |              |
| Contact fields   | strings  | no       | yes      | phone, email |
| DefaultZoneID    | int      | no       | yes      | FK Zone      |
| DefaultCompanyID | int      | no       | yes      | FK Company   |

### Contractor — `/contractors/` — CRUD: Create/Read/Update

External service provider / subcontractor.
| Field | Type | Required | Writable | Notes |
| --- | --- | --- | --- | --- |
| ID | int | - | no | |
| Name | string | yes | yes | |
| Position | string | no | yes | |
| Address fields | objects | no | yes | |
| Contact fields | strings | no | yes | phone, email |
| BankingAccount fields | objects | no | yes | |

### Catalog — `/catalogs/` — CRUD: Create/Read/Update

Inventory items and materials.
| Field | Type | Required | Writable | Notes |
| --- | --- | --- | --- | --- |
| ID | int | - | no | |
| Name | string | yes | yes | |
| IsFavorite | boolean | no | yes | |
| IsInventory | boolean | no | yes | |
| UPC | string | no | yes | |
| Manufacturer | string | no | yes | |
| BasePrice | decimal | no | yes | |
| SellPrice | decimal | no | yes | |
| GroupID | int | no | yes | FK CatalogGroup |
| Archived | boolean | no | yes | |

### Vendor — `/vendors/` — CRUD: Create/Read/Update

### Invoice (Customer) — `/customerInvoices/` — CRUD: Read/Update (created via job workflow)

| Field            | Type     | Required | Writable | Notes                        |
| ---------------- | -------- | -------- | -------- | ---------------------------- |
| ID               | int      | -        | no       |                              |
| Description      | string   | no       | yes      |                              |
| DateCreated      | datetime | no       | no       |                              |
| DateIssued       | datetime | no       | yes      |                              |
| Type             | string   | no       | no       |                              |
| Stage            | string   | no       | no       |                              |
| StatusID         | int      | no       | yes      | FK CustomerInvoiceStatusCode |
| ExTax            | decimal  | no       | no       | excl. tax                    |
| Tax              | decimal  | no       | no       |                              |
| IncTax           | decimal  | no       | no       | incl. tax                    |
| AmountApplied    | decimal  | no       | no       |                              |
| BalanceDue       | decimal  | no       | no       |                              |
| IsPaid           | boolean  | no       | no       |                              |
| DatePaid         | datetime | no       | no       |                              |
| PaymentTermsDays | decimal  | no       | yes      |                              |
| AutoAdjustStatus | boolean  | no       | yes      |                              |
| Notes            | string   | no       | yes      |                              |

### PurchaseOrder — `/purchaseOrders/` — CRUD: Create/Read/Update

| Field        | Type     | Required | Writable | Notes                      |
| ------------ | -------- | -------- | -------- | -------------------------- |
| ID           | int      | -        | no       |                            |
| Type         | string   | no       | yes      |                            |
| Stage        | string   | no       | no       |                            |
| StatusID     | int      | no       | yes      | FK PurchaseOrderStatusCode |
| DateIssued   | datetime | no       | yes      |                            |
| VendorID     | int      | yes      | yes      | FK Vendor                  |
| DueDate      | datetime | no       | yes      |                            |
| Reference    | string   | no       | yes      |                            |
| QuoteNo      | string   | no       | yes      | vendor quote number        |
| TotalsExTax  | decimal  | no       | no       |                            |
| TotalsIncTax | decimal  | no       | no       |                            |
| Archived     | boolean  | no       | yes      |                            |

### Schedule — `/schedules/` (top-level) or nested under job cost centers — CRUD: Create/Read/Update/Delete

### Asset — `/assets/` — CRUD: Create/Read/Update

Equipment/property item linked to a customer site.
| Field | Type | Required | Writable | Notes |
| --- | --- | --- | --- | --- |
| ID | int | - | no | |
| SiteID | int | yes | yes | FK Site |
| AssetTypeID | int | yes | yes | FK AssetType |
| Archived | boolean | no | yes | |
| StartDate | datetime | no | yes | |
| LastTestDate | datetime | no | no | |
| LastTestResult | string | no | no | |

### Webhook Subscription — `/webhooks/` (top-level, no company scope) — CRUD: Create/Read/Update/Delete [DOCUMENTED]

### Additional entities (100+ total, SyncHub-confirmed)

- Core: Activity, ActivitySchedule, CostCenter, Zone, SecurityGroup
- Catalog/Pricing: CatalogGroup, LaborRate, LaborRateOverHead, PlantAndEquipment, PlantType, TaxCode, PreBuildGroup
- Job sub-resources: JobSection, JobSectionCostCenter, JobSectionCostCenterCatalog/Labor/OneOff/Prebuild/ServiceFee/Stock/Asset/ContractorJob, JobCard
- Quote sub-resources: QuoteSection, QuoteSectionCostCenter, + child entities matching the Job pattern
- Financial: CreditNote, RecurringInvoice, CustomerPayment, ContractorInvoice, PurchaseOrderReceipt, PurchaseOrderReceiptCatalog, PurchaseOrderReceiptCredit
- Contractor: ContractorJob, ContractorTimesheet, ContractorJobLog
- Commission: BasicCommission, AdvancedCommission
- Recurring: CompanyRecurringJob
- Logs: JobLog, QuoteLog, InvoiceLog, CustomerLog, ContactLog, PurchaseOrderLog, MobileStatusLog
- Attachments: JobAttachmentFile/Folder, QuoteAttachmentFile/Folder, AssetAttachmentFile/Folder
- Tags: CustomerTag, ProjectTag
- Accounting: ChartOfAccounts, BusinessGroup, CustomField
- Employees: EmployeeLicence
- Status codes: ProjectStatusCode, CustomerInvoiceStatusCode, PurchaseOrderStatusCode

## Relationships (ERD)

```
Company {companyID} scopes ALL resources
 ├─ Customer (Company|Individual) ─1:N→ Site ─1:N→ Asset
 ├─ Employee ─assigned to→ Schedule
 └─ Vendor ─1:N→ PurchaseOrder
Schedule ←via CostCenter← JobSection ←belongs to← CostCenter
Lead ─converts→ Quote ─creates→ Job ─invoices→ Invoice
```

## State machines

Job lifecycle [DOCUMENTED]: `Pending —schedule→ Progress —complete→ Complete —invoice→ Invoiced —archive→ Archived`
| From | Action | To | Reversible | Side effects |
| --- | --- | --- | --- | --- |
| Pending | schedule/start | Progress | yes (override) | webhook job.stage.progress |
| Progress | mark complete | Complete | yes (override) | webhook job.stage.complete |
| Complete | create invoice | Invoiced | no (typically) | creates CustomerInvoice; webhook job.stage.invoiced |
| Invoiced | archive | Archived | no | webhook job.stage.archived |
| Any | status-code change | Any (higher priority) | only if "Ignore status priority" enabled | webhook job.status |

Stages are fixed; custom status codes exist within each stage. PATCH to a lower-priority status silently fails with 204.

Quote lifecycle [from Stage/IsClosed/StatusID]: `Draft —send→ Sent —approve→ Approved —convert→ Converted to Job`; `Sent —decline→ Declined`.
Lead lifecycle [from Stage/StatusID]: `Open —qualify→ Qualified —convert→ Converted to Quote/Job`; `Qualified —lose→ Lost/Archived`.

## Business rules

- Create Customer before Job/Quote; create Site (linked to Customer) before Job.
- Job hierarchy top-down: Job > Section > CostCenter > (Labor/Materials/Schedule). Schedules are nested under Job > Section > CostCenter.
- `companyID=0` works only for single-company builds.
- Status-code changes obey the priority hierarchy.
- Filter company customers with `CompanyName`, not `Name`. `ID` column not searchable on some endpoints.
- `?columns=` names generally match the simPRO web-UI field names. Sub-resource columns (e.g. nested site address) CANNOT be selected via `columns`.
- Computed/read-only: `Totals` (from cost-center line items), `Stage` (derived from status code), `CompletedDate`/`DateCreated` (server-set). `Result-Total`/`Result-Pages`/`Result-Count` are pagination headers.

## Field formats

| Format   | Pattern                        | Example                       |
| -------- | ------------------------------ | ----------------------------- |
| Date     | YYYY-MM-dd                     | `"2026-01-15"`                |
| DateTime | ISO 8601                       | `"2026-01-15T14:30:00+00:00"` |
| Currency | decimal, no symbol             | `1500.00`                     |
| ID       | int                            | `123`                         |
| Long ID  | long (recurring jobs, folders) | `12345678`                    |
| File ID  | string (attachments)           | `"abc-def-123"`               |
| Boolean  | boolean                        | `true`/`false`                |

## Enums

| Entity        | Field | Values                                                | Default                  |
| ------------- | ----- | ----------------------------------------------------- | ------------------------ |
| Job           | Type  | `Service`, `Project`, `Prepaid`                       | [UNKNOWN]                |
| Job           | Stage | `Pending`,`Progress`,`Complete`,`Invoiced`,`Archived` | `Pending` (fixed stages) |
| Invoice       | Type  | varies per instance                                   | [UNKNOWN]                |
| PurchaseOrder | Type  | varies per instance                                   | [UNKNOWN]                |

Most enum/picklist values (status codes, custom-field values, tags) are customizable per build; the API returns whatever that build has configured.
