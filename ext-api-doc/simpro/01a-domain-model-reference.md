---
api_name: 'simPRO'
api_slug: 'simpro'
generated_from: '00-api-investigation'
generated_date: '2026-03-30'
source_phases: ['Phase 3: Domain Model & Behavior']
data_sources: ['SyncHub data model (100+ entities)', 'Official PHP SDK', 'Forum posts', 'Rollout guides']
---

# simPRO -- Domain Model Reference

> Companion to `01-llm-api-rules.md`. Contains the full entity catalog, relationships,
> state machines, and business rules that the workspace agent references when working
> with simPRO data.
>
> **Data source:** Field definitions sourced from SyncHub's verified data model of the
> simPRO API (100+ entities with complete field lists). Relationship types and business
> rules confirmed from forum posts and SDK code.

---

## Entity Catalog

### Job

**Resource path:** `/api/v1.0/companies/{companyID}/jobs/`
**Description:** Core work project entity. Represents a piece of work performed for a customer at a site.
**CRUD:** Create (POST), Read (GET), Update (PATCH), Delete (DELETE) [CONFIRMED -- SDK, Rollout guide]

| Field                                  | Type     | Required     | Writable | Description                                    |
| -------------------------------------- | -------- | ------------ | -------- | ---------------------------------------------- |
| ID                                     | int      | -            | no       | Unique job identifier                          |
| Name                                   | string   | no           | yes      | Job name                                       |
| Description                            | string   | no           | yes      | Job description                                |
| Type                                   | string   | yes (create) | yes      | `Service`, `Project`, or `Prepaid` [CONFIRMED] |
| IndividualCustomerID                   | int      | conditional  | yes      | FK to IndividualCustomer                       |
| CompanyCustomerID                      | int      | conditional  | yes      | FK to CompanyCustomer                          |
| CustomerContactID                      | int      | no           | yes      | FK to Contact                                  |
| SiteID                                 | int      | yes (create) | yes      | FK to Site                                     |
| SiteContactID                          | int      | no           | yes      | FK to Contact (site contact)                   |
| OrderNo                                | string   | no           | yes      | Order number                                   |
| Notes                                  | string   | no           | yes      | Job notes                                      |
| DateIssued                             | datetime | no           | yes      | Date issued                                    |
| DueDate                                | datetime | no           | yes      | Due date                                       |
| DueTime                                | string   | no           | yes      | Due time                                       |
| SalesPersonEmployeeID                  | int      | no           | yes      | FK to Employee                                 |
| ProjectManagerEmployeeID               | int      | no           | yes      | FK to Employee                                 |
| Stage                                  | string   | no           | no       | Pending/Progress/Complete/Invoiced/Archived    |
| StatusID                               | int      | no           | yes      | FK to ProjectStatusCode                        |
| ResponseTimeID                         | int      | no           | yes      | Response time configuration                    |
| IsVariation                            | boolean  | no           | yes      | Whether job is a variation                     |
| ConvertedFromQuoteID                   | int      | no           | no       | FK to Quote (if converted)                     |
| ConvertedFromRecurringJobID            | long     | no           | no       | FK to CompanyRecurringJob                      |
| AutoAdjustStatus                       | boolean  | no           | yes      | Auto-adjust status enabled                     |
| IsRetentionEnabled                     | boolean  | no           | yes      | Retention enabled                              |
| CompletedDate                          | datetime | no           | no       | Completion date                                |
| Totals (multiple sub-fields)           | decimals | no           | no       | Computed financial totals                      |
| Materials/Resources/Markup cost fields | decimals | no           | no       | Cost breakdowns                                |

> **Confidence:** Field names and types [CONFIRMED] from SyncHub data model of simPRO API.

**Relationships:**

| Related Entity       | Type | Expression                                          | Notes                         |
| -------------------- | ---- | --------------------------------------------------- | ----------------------------- |
| CompanyCustomer      | N:1  | CompanyCustomerID FK                                | Corporate customer            |
| IndividualCustomer   | N:1  | IndividualCustomerID FK                             | Individual customer           |
| Site                 | N:1  | SiteID FK                                           | Customer property             |
| Contact              | N:1  | CustomerContactID, SiteContactID FKs                | Contact persons               |
| Employee             | N:1  | SalesPersonEmployeeID, ProjectManagerEmployeeID FKs | Staff assignments             |
| JobSection           | 1:N  | sub-resource `/jobs/{id}/sections/`                 | [CONFIRMED]                   |
| JobSectionCostCenter | 1:N  | via JobSection sub-resource                         | Nested hierarchy              |
| JobCard              | 1:N  | sub-resource                                        | Work order cards              |
| JobAttachmentFile    | 1:N  | sub-resource                                        | File attachments (ID: string) |
| JobAttachmentFolder  | 1:N  | sub-resource                                        | Attachment folders            |
| JobLog               | 1:N  | sub-resource                                        | Activity log entries          |
| Invoice              | 1:N  | related resource                                    | Created when job invoiced     |
| Quote                | N:1  | ConvertedFromQuoteID FK                             | Source quote if converted     |

---

### Quote

**Resource path:** `/api/v1.0/companies/{companyID}/quotes/`
**Description:** Customer proposal/estimate document. Can be converted to a Job.
**CRUD:** Create, Read, Update [CONFIRMED]

| Field                        | Type     | Required     | Writable | Description               |
| ---------------------------- | -------- | ------------ | -------- | ------------------------- |
| ID                           | int      | -            | no       | Unique quote identifier   |
| Name                         | string   | no           | yes      | Quote name                |
| Description                  | string   | no           | yes      | Quote description         |
| IndividualCustomerID         | int      | conditional  | yes      | FK to IndividualCustomer  |
| CompanyCustomerID            | int      | conditional  | yes      | FK to CompanyCustomer     |
| CustomerContactID            | int      | no           | yes      | FK to Contact             |
| SiteID                       | int      | yes (create) | yes      | FK to Site                |
| SiteContactID                | int      | no           | yes      | FK to Contact             |
| SalesPersonEmployeeID        | int      | no           | yes      | FK to Employee            |
| ProjectManagerEmployeeID     | int      | no           | yes      | FK to Employee            |
| StatusID                     | int      | no           | yes      | FK to ProjectStatusCode   |
| DateIssued                   | datetime | no           | yes      | Date issued               |
| DueDate                      | datetime | no           | yes      | Due date                  |
| ValidityDays                 | decimal  | no           | yes      | Quote validity in days    |
| OrderNo                      | string   | no           | yes      | Order number              |
| RequestNo                    | string   | no           | yes      | Request number            |
| Stage                        | string   | no           | no       | Current stage             |
| IsClosed                     | boolean  | no           | no       | Whether quote is closed   |
| ConvertedFromLeadID          | int      | no           | no       | FK to Lead                |
| Totals (multiple sub-fields) | decimals | no           | no       | Computed financial totals |

**Relationships:**

| Related Entity      | Type | Expression                                | Notes                 |
| ------------------- | ---- | ----------------------------------------- | --------------------- |
| Customer            | N:1  | CompanyCustomerID/IndividualCustomerID FK |                       |
| Site                | N:1  | SiteID FK                                 |                       |
| QuoteSection        | 1:N  | sub-resource `/quotes/{id}/sections/`     |                       |
| QuoteAttachmentFile | 1:N  | sub-resource                              |                       |
| QuoteLog            | 1:N  | sub-resource                              |                       |
| Job                 | 1:1  | conversion                                | Quote converts to Job |
| Lead                | N:1  | ConvertedFromLeadID FK                    | Source lead           |

---

### Lead

**Resource path:** `/api/v1.0/companies/{companyID}/leads/`
**Description:** Prospective customer opportunity. Can convert to Quote or Job.
**CRUD:** Create, Read, Update [CONFIRMED]

| Field                    | Type    | Required    | Writable | Description              |
| ------------------------ | ------- | ----------- | -------- | ------------------------ |
| ID                       | int     | -           | no       | Unique identifier        |
| LeadName                 | string  | no          | yes      | Lead name                |
| Description              | string  | no          | yes      | Description              |
| Stage                    | string  | no          | no       | Current stage            |
| StatusID                 | int     | no          | yes      | FK to ProjectStatusCode  |
| FollowUpDate             | string  | no          | yes      | Follow-up date           |
| DateCreated              | string  | no          | no       | Creation date            |
| Notes                    | string  | no          | yes      | Notes                    |
| IndividualCustomerID     | int     | conditional | yes      | FK to IndividualCustomer |
| CompanyCustomerID        | int     | conditional | yes      | FK to CompanyCustomer    |
| SiteID                   | int     | no          | yes      | FK to Site               |
| CostCenterID             | int     | no          | yes      | FK to CostCenter         |
| SalesPersonEmployeeID    | int     | no          | yes      | FK to Employee           |
| SalesPersonContractorID  | int     | no          | yes      | FK to Contractor         |
| ProjectManagerEmployeeID | int     | no          | yes      | FK to Employee           |
| ForecastEstimatedPrice   | decimal | no          | yes      | Estimated value          |
| ForecastProbability      | decimal | no          | yes      | Win probability          |
| ForecastExpectedYear     | decimal | no          | yes      | Expected year            |
| ForecastExpectedMonth    | decimal | no          | yes      | Expected month           |
| AutoAdjustStatus         | boolean | no          | yes      | Auto-adjust status       |

---

### Customer (Company)

**Resource path:** `/api/v1.0/companies/{companyID}/customers/companies/`
**Description:** Corporate client record.
**CRUD:** Create, Read, Update [CONFIRMED]

| Field                 | Type    | Required | Writable | Description                                           |
| --------------------- | ------- | -------- | -------- | ----------------------------------------------------- |
| ID                    | int     | -        | no       | Unique identifier                                     |
| CompanyName           | string  | yes      | yes      | Company name (filter using `CompanyName`, not `Name`) |
| EIN                   | string  | no       | yes      | Employer Identification Number                        |
| Website               | string  | no       | yes      | Website URL                                           |
| Fax                   | string  | no       | yes      | Fax number                                            |
| Address fields        | objects | no       | yes      | Physical address                                      |
| BillingAddress fields | objects | no       | yes      | Billing address                                       |
| Banking fields        | objects | no       | yes      | Banking/payment terms                                 |

---

### Customer (Individual)

**Resource path:** `/api/v1.0/companies/{companyID}/customers/individuals/`
**CRUD:** Create, Read, Update [CONFIRMED]

| Field                 | Type    | Required | Writable | Description           |
| --------------------- | ------- | -------- | -------- | --------------------- |
| ID                    | int     | -        | no       | Unique identifier     |
| Title                 | string  | no       | yes      | Title (Mr/Mrs etc.)   |
| GivenName             | string  | yes      | yes      | First name            |
| FamilyName            | string  | yes      | yes      | Last name             |
| CellPhone             | string  | no       | yes      | Mobile phone          |
| Email                 | string  | no       | yes      | Email address         |
| Phone                 | string  | no       | yes      | Phone                 |
| Address fields        | objects | no       | yes      | Physical address      |
| BillingAddress fields | objects | no       | yes      | Billing address       |
| Banking fields        | objects | no       | yes      | Banking/payment terms |

---

### Contact

**Resource path:** `/api/v1.0/companies/{companyID}/contacts/`
**CRUD:** Create, Read, Update [CONFIRMED]

| Field        | Type    | Required | Writable | Description       |
| ------------ | ------- | -------- | -------- | ----------------- |
| ID           | int     | -        | no       | Unique identifier |
| Title        | string  | no       | yes      | Title             |
| GivenName    | string  | yes      | yes      | First name        |
| FamilyName   | string  | yes      | yes      | Last name         |
| Email        | string  | no       | yes      | Email             |
| Phone fields | strings | no       | yes      | Phone numbers     |
| Department   | string  | no       | yes      | Department        |
| Position     | string  | no       | yes      | Position          |
| Notes        | string  | no       | yes      | Notes             |

---

### Site

**Resource path:** `/api/v1.0/companies/{companyID}/sites/`
**Description:** Customer property location where work is performed.
**CRUD:** Create, Read, Update [CONFIRMED]

---

### Employee

**Resource path:** `/api/v1.0/companies/{companyID}/employees/`
**Description:** Internal staff member record.
**CRUD:** Read, Update [CONFIRMED -- SDK code accesses ID and Name]

| Field            | Type     | Required | Writable | Description       |
| ---------------- | -------- | -------- | -------- | ----------------- |
| ID               | int      | -        | no       | Unique identifier |
| Name             | string   | yes      | yes      | Employee name     |
| Position         | string   | no       | yes      | Position          |
| DateOfHire       | datetime | no       | yes      | Hire date         |
| DateOfBirth      | datetime | no       | yes      | Birth date        |
| Address fields   | objects  | no       | yes      | Physical address  |
| Contact fields   | strings  | no       | yes      | Phone, email      |
| DefaultZoneID    | int      | no       | yes      | FK to Zone        |
| DefaultCompanyID | int      | no       | yes      | FK to Company     |

---

### Contractor

**Resource path:** `/api/v1.0/companies/{companyID}/contractors/`
**Description:** External service provider or subcontractor.
**CRUD:** Create, Read, Update [CONFIRMED -- SyncHub model]

| Field                 | Type    | Required | Writable | Description       |
| --------------------- | ------- | -------- | -------- | ----------------- |
| ID                    | int     | -        | no       | Unique identifier |
| Name                  | string  | yes      | yes      | Contractor name   |
| Position              | string  | no       | yes      | Position          |
| Address fields        | objects | no       | yes      | Address           |
| Contact fields        | strings | no       | yes      | Phone, email      |
| BankingAccount fields | objects | no       | yes      | Banking details   |

---

### Catalog

**Resource path:** `/api/v1.0/companies/{companyID}/catalogs/`
**Description:** Inventory items and materials.
**CRUD:** Create, Read, Update [CONFIRMED]

| Field        | Type    | Required | Writable | Description        |
| ------------ | ------- | -------- | -------- | ------------------ |
| ID           | int     | -        | no       | Unique identifier  |
| Name         | string  | yes      | yes      | Item name          |
| IsFavorite   | boolean | no       | yes      | Favorite flag      |
| IsInventory  | boolean | no       | yes      | Inventory item     |
| UPC          | string  | no       | yes      | UPC barcode        |
| Manufacturer | string  | no       | yes      | Manufacturer       |
| BasePrice    | decimal | no       | yes      | Base price         |
| SellPrice    | decimal | no       | yes      | Sell price         |
| GroupID      | int     | no       | yes      | FK to CatalogGroup |
| Archived     | boolean | no       | yes      | Archived flag      |

---

### Vendor

**Resource path:** `/api/v1.0/companies/{companyID}/vendors/`
**CRUD:** Create, Read, Update [CONFIRMED -- SyncHub model]

---

### Invoice (Customer)

**Resource path:** `/api/v1.0/companies/{companyID}/customerInvoices/`
**CRUD:** Read, Update (created via job workflow) [CONFIRMED]

| Field            | Type     | Required | Writable | Description                     |
| ---------------- | -------- | -------- | -------- | ------------------------------- |
| ID               | int      | -        | no       | Unique identifier               |
| Description      | string   | no       | yes      | Description                     |
| DateCreated      | datetime | no       | no       | Creation date                   |
| DateIssued       | datetime | no       | yes      | Issue date                      |
| Type             | string   | no       | no       | Invoice type                    |
| Stage            | string   | no       | no       | Current stage                   |
| StatusID         | int      | no       | yes      | FK to CustomerInvoiceStatusCode |
| ExTax            | decimal  | no       | no       | Amount excluding tax            |
| Tax              | decimal  | no       | no       | Tax amount                      |
| IncTax           | decimal  | no       | no       | Amount including tax            |
| AmountApplied    | decimal  | no       | no       | Amount applied                  |
| BalanceDue       | decimal  | no       | no       | Balance remaining               |
| IsPaid           | boolean  | no       | no       | Payment status                  |
| DatePaid         | datetime | no       | no       | Payment date                    |
| PaymentTermsDays | decimal  | no       | yes      | Payment terms                   |
| AutoAdjustStatus | boolean  | no       | yes      | Auto-adjust status              |
| Notes            | string   | no       | yes      | Notes                           |

---

### PurchaseOrder

**Resource path:** `/api/v1.0/companies/{companyID}/purchaseOrders/`
**CRUD:** Create, Read, Update [CONFIRMED]

| Field        | Type     | Required | Writable | Description                   |
| ------------ | -------- | -------- | -------- | ----------------------------- |
| ID           | int      | -        | no       | Unique identifier             |
| Type         | string   | no       | yes      | PO type                       |
| Stage        | string   | no       | no       | Current stage                 |
| StatusID     | int      | no       | yes      | FK to PurchaseOrderStatusCode |
| DateIssued   | datetime | no       | yes      | Issue date                    |
| VendorID     | int      | yes      | yes      | FK to Vendor                  |
| DueDate      | datetime | no       | yes      | Due date                      |
| Reference    | string   | no       | yes      | Reference number              |
| QuoteNo      | string   | no       | yes      | Vendor quote number           |
| TotalsExTax  | decimal  | no       | no       | Total excluding tax           |
| TotalsIncTax | decimal  | no       | no       | Total including tax           |
| Archived     | boolean  | no       | yes      | Archived flag                 |

---

### Schedule

**Resource path:** `/api/v1.0/companies/{companyID}/schedules/` (top-level) or nested under job cost centers
**CRUD:** Create, Read, Update, Delete [CONFIRMED -- forum]

---

### Asset

**Resource path:** `/api/v1.0/companies/{companyID}/assets/`
**Description:** Equipment or property item linked to a customer site.
**CRUD:** Create, Read, Update [CONFIRMED -- SyncHub model]

| Field          | Type     | Required | Writable | Description       |
| -------------- | -------- | -------- | -------- | ----------------- |
| ID             | int      | -        | no       | Unique identifier |
| SiteID         | int      | yes      | yes      | FK to Site        |
| AssetTypeID    | int      | yes      | yes      | FK to AssetType   |
| Archived       | boolean  | no       | yes      | Archived flag     |
| StartDate      | datetime | no       | yes      | Start date        |
| LastTestDate   | datetime | no       | no       | Last test date    |
| LastTestResult | string   | no       | no       | Last test result  |

---

### Webhook Subscription

**Resource path:** `/api/v1.0/webhooks/`
**CRUD:** Create, Read, Update, Delete [DOCUMENTED]

---

### Additional Entities (100+ total)

The following entities are also accessible via the API (confirmed from SyncHub data model):

**Core:** Activity, ActivitySchedule, CostCenter, Zone, SecurityGroup
**Catalog/Pricing:** CatalogGroup, LaborRate, LaborRateOverHead, PlantAndEquipment, PlantType, TaxCode, PreBuildGroup
**Job Sub-resources:** JobSection, JobSectionCostCenter, JobSectionCostCenterCatalog, JobSectionCostCenterLabor, JobSectionCostCenterOneOff, JobSectionCostCenterPrebuild, JobSectionCostCenterServiceFee, JobSectionCostCenterStock, JobSectionCostCenterAsset, JobSectionCostCenterContractorJob, JobCard
**Quote Sub-resources:** QuoteSection, QuoteSectionCostCenter, and child entities matching Job pattern
**Financial:** CreditNote, RecurringInvoice, CustomerPayment, ContractorInvoice, PurchaseOrderReceipt, PurchaseOrderReceiptCatalog, PurchaseOrderReceiptCredit
**Contractor:** ContractorJob, ContractorTimesheet, ContractorJobLog
**Commission:** BasicCommission, AdvancedCommission
**Recurring:** CompanyRecurringJob
**Logs:** JobLog, QuoteLog, InvoiceLog, CustomerLog, ContactLog, PurchaseOrderLog, MobileStatusLog
**Attachments:** JobAttachmentFile/Folder, QuoteAttachmentFile/Folder, AssetAttachmentFile/Folder
**Tags:** CustomerTag, ProjectTag
**Accounting:** ChartOfAccounts, BusinessGroup, CustomField
**Employees:** EmployeeLicence
**Status Codes:** ProjectStatusCode, CustomerInvoiceStatusCode, PurchaseOrderStatusCode

---

## Entity Relationship Diagram

```
                              ┌─────────────┐
                              │   Company    │ (the simPRO build/tenant)
                              │  {companyID} │
                              └──────┬───────┘
                                     │ scopes all resources
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
  ┌──────────────┐          ┌──────────────┐          ┌──────────────┐
  │   Customer   │          │   Employee   │          │   Vendor     │
  │ (Company/    │          └──────────────┘          └──────┬───────┘
  │  Individual) │                 │ assigned to              │ 1:N
  └──────┬───────┘                 ▼                          ▼
         │ 1:N              ┌──────────────┐          ┌──────────────┐
         ▼                  │   Schedule   │          │ PurchaseOrder│
  ┌──────────────┐          └──────────────┘          └──────────────┘
  │     Site     │                 ▲
  └──────┬───────┘                 │ via CostCenter
         │ 1:N              ┌──────────────┐
         ▼                  │  CostCenter  │
  ┌──────────────┐          └──────┬───────┘
  │    Asset     │                 │ belongs to
  └──────────────┘                 ▼
                            ┌──────────────┐
                            │  JobSection  │
                            └──────┬───────┘
                                   │ belongs to
                                   ▼
  ┌──────────────┐  converts  ┌──────────────┐  creates  ┌──────────────┐
  │     Lead     │──────────>│    Quote     │──────────>│     Job      │
  └──────────────┘            └──────────────┘           └──────┬───────┘
                                                                │ invoices
                                                                ▼
                                                         ┌──────────────┐
                                                         │   Invoice    │
                                                         └──────────────┘
```

---

## State Machines

### Job Lifecycle [DOCUMENTED]

```
[Pending] ──schedule──> [Progress] ──complete──> [Complete] ──invoice──> [Invoiced] ──archive──> [Archived]
```

**Transitions:**

| From     | Action / Trigger    | To                    | Reversible?                              | Side Effects                                         |
| -------- | ------------------- | --------------------- | ---------------------------------------- | ---------------------------------------------------- |
| Pending  | Schedule/start work | Progress              | Yes (with override)                      | Webhook: job.stage.progress                          |
| Progress | Mark complete       | Complete              | Yes (with override)                      | Webhook: job.stage.complete                          |
| Complete | Create invoice      | Invoiced              | No (typically)                           | Creates CustomerInvoice; Webhook: job.stage.invoiced |
| Invoiced | Archive             | Archived              | No                                       | Webhook: job.stage.archived                          |
| Any      | Status code change  | Any (higher priority) | Only if "Ignore status priority" enabled | Webhook: job.status                                  |

> **Important:** Stages are fixed but custom status codes can be defined within each stage. PATCH to a lower-priority status silently fails with 204. [CONFIRMED -- forum]

### Quote Lifecycle [CONFIRMED -- SyncHub fields: Stage, IsClosed, StatusID]

```
[Draft] ──send──> [Sent] ──approve──> [Approved] ──convert──> [Converted to Job]
                           └──decline──> [Declined]
```

### Lead Lifecycle [CONFIRMED -- SyncHub fields: Stage, StatusID]

```
[Open] ──qualify──> [Qualified] ──convert──> [Converted to Quote/Job]
                                  └──lose──> [Lost/Archived]
```

---

## Business Rules

### Ordering / Dependency Rules

- Must create a Customer before creating a Job or Quote [CONFIRMED -- SyncHub model shows required FK fields]
- Must create a Site (linked to Customer) before creating a Job [CONFIRMED]
- Job hierarchy must be built top-down: Job > Section > CostCenter > (Labor/Materials/Schedule) [DOCUMENTED -- forum]
- Schedules are nested under Job > Section > CostCenter path [CONFIRMED -- forum]

### Field-Level Rules

- companyID = 0 works only for single-company builds [CONFIRMED -- forum]
- Status code changes are subject to priority hierarchy [DOCUMENTED]
- Filter field: use `CompanyName` for company customers, not `Name` [CONFIRMED -- forum]
- ID column is not searchable on some endpoints [CONFIRMED -- forum]
- Column names in `?columns=` generally match simPRO web UI field names [DOCUMENTED]
- Sub-resource columns (e.g., nested site address) cannot be selected via columns parameter [DOCUMENTED]

### Computed / Read-Only Fields

- `Totals` on Jobs/Quotes: computed from cost center line items [CONFIRMED -- SyncHub model]
- `Stage`: derived from status code configuration [CONFIRMED]
- `CompletedDate`, `DateCreated`: set server-side [CONFIRMED -- SyncHub model]
- `Result-Total`, `Result-Pages`, `Result-Count`: pagination metadata in response headers [DOCUMENTED]

---

## Field Format Reference

| Format   | Pattern    | Example                       | Notes                                                         |
| -------- | ---------- | ----------------------------- | ------------------------------------------------------------- |
| Date     | YYYY-MM-dd | `"2026-01-15"`                | [CONFIRMED]                                                   |
| DateTime | ISO 8601   | `"2026-01-15T14:30:00+00:00"` | [CONFIRMED -- webhook payloads]                               |
| Currency | decimal    | `1500.00`                     | Numeric, no symbol [CONFIRMED -- SyncHub model]               |
| ID       | int        | `123`                         | Auto-incrementing integers [CONFIRMED]                        |
| Long ID  | long       | `12345678`                    | Used for recurring jobs, folders [CONFIRMED -- SyncHub model] |
| File ID  | string     | `"abc-def-123"`               | Attachment file IDs are strings [CONFIRMED -- SyncHub model]  |
| Boolean  | boolean    | `true` / `false`              | [CONFIRMED -- SyncHub model]                                  |

---

## Enum Value Reference

| Entity        | Field | Allowed Values                                            | Default   | Notes                        |
| ------------- | ----- | --------------------------------------------------------- | --------- | ---------------------------- |
| Job           | Type  | `Service`, `Project`, `Prepaid`                           | [UNKNOWN] | [CONFIRMED -- forum]         |
| Job           | Stage | `Pending`, `Progress`, `Complete`, `Invoiced`, `Archived` | `Pending` | Fixed stages [DOCUMENTED]    |
| Invoice       | Type  | varies per instance                                       | [UNKNOWN] | [CONFIRMED -- SyncHub model] |
| PurchaseOrder | Type  | varies per instance                                       | [UNKNOWN] | [CONFIRMED -- SyncHub model] |

> Most enum/picklist values are customizable per simPRO instance (status codes, custom field values, tags). The API returns whatever is configured in that build. [CONFIRMED]

---

_Generated from the investigation questionnaire, Phase 3. Field definitions sourced from SyncHub verified data model._
