---
api_name: 'simPRO'
api_slug: 'simpro'
base_url: 'https://{build}.simprosuite.com/api/v1.0/'
version: 'v1.0'
spec_format: 'none publicly available'
spec_url: ''
docs_url: 'https://developer.simprogroup.com/apidoc/'
date_researched: '2026-03-30'
---

# simPRO -- API Specification & Investigation

> Clean developer reference for the simPRO REST API. This document is the condensed
> output of the investigation questionnaire -- everything a developer needs to integrate
> with this API, in one place.

---

## Overview

- **Vendor:** Simpro Group (formerly simPRO Software)
- **API version:** v1.0
- **Base URL:** `https://{build}.simprosuite.com/api/v1.0/` (per-tenant subdomain)
- **Sandbox URL:** Not available [CONFIRMED]
- **API type:** REST
- **Data format:** JSON
- **Documentation:** [developer.simprogroup.com/apidoc/](https://developer.simprogroup.com/apidoc/)
- **Developer center:** [developer.simprogroup.com](https://developer.simprogroup.com/)
- **Code examples:** [developer.simprogroup.com/code-examples/](https://developer.simprogroup.com/code-examples/)
- **API forum:** [apiforum.simprogroup.com](https://apiforum.simprogroup.com/)
- **OpenAPI spec:** Not publicly available [CONFIRMED -- probes returned 403/404]
- **Status page:** [status.simprogroup.com](https://status.simprogroup.com)
- **Data model reference:** [synchub.io/connectors/simpro/datamodel](https://www.synchub.io/connectors/simpro/datamodel) (100+ entities)

**Summary:** simPRO is a cloud-based field service management platform for trade businesses (electricians, plumbers, HVAC, construction). The REST API provides CRUD access to jobs, quotes, leads, customers, schedules, invoices, catalogs, and 100+ other entities. Each customer has an isolated tenant with their own subdomain.

---

## Authentication

### Method: OAuth 2.0

simPRO uses OAuth 2.0 with support for multiple grant types. API applications are created in simPRO under System > Setup > API > Applications. Two access types exist: Direct Access (unfettered, not tied to a user) and User Token Access (scoped to user permissions). [DOCUMENTED]

**Header format:**

```
Authorization: Bearer {access_token}
Content-Type: application/json
```

**OAuth 2.0 Configuration:**

| Parameter              | Value                                                                                                                      | Source                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Grant types            | authorization_code, client_credentials, resource_owner (**deprecated**), implicit (**deprecated by OAuth 2.1 / RFC 9700**) | [DOCUMENTED -- PHP SDK]                  |
| Authorization URL      | `https://{build}.simprosuite.com/oauth2/login?client_id={CLIENT_ID}`                                                       | [VERIFIED 2026-05-19 — Provider.php:230] |
| Token URL              | `https://{build}.simprosuite.com/oauth2/token`                                                                             | [VERIFIED 2026-05-19 — Provider.php:225] |
| ~~Centralized URL~~    | ~~`https://auth.simpro.co/...`~~ — **does NOT exist (NXDOMAIN). Removed 2026-05-19.** Only per-build URLs work.            | DNS lookup, no A record                  |
| Access token lifetime  | 3600 seconds (1 hour)                                                                                                      | [CONFIRMED -- forum]                     |
| Refresh token lifetime | 14 days (single-use: invalidated after use)                                                                                | [CONFIRMED -- forum]                     |
| Refresh mechanism      | `grant_type=refresh_token` with client_id, client_secret, refresh_token                                                    | [DOCUMENTED]                             |
| Revocation URL         | [UNKNOWN]                                                                                                                  |                                          |
| PKCE required          | [UNKNOWN]                                                                                                                  |                                          |
| Scopes                 | [UNKNOWN -- exist but not publicly enumerated]                                                                             |                                          |

**API Key auth (alternative):**

| Parameter     | Value                                        | Source              |
| ------------- | -------------------------------------------- | ------------------- |
| How to obtain | System > Setup > API > Applications          | [DOCUMENTED -- FAQ] |
| SDK usage     | `withBuildURL($buildURL)->withToken($token)` | [CONFIRMED -- SDK]  |

**Authorization Code Flow:** [CONFIRMED -- SDK code]

```
1. Redirect user to: https://{build}.simprosuite.com/oauth2/login?
     client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&response_type=code&state={RANDOM_STATE}

2. User logs in and authorizes. Redirected to: {REDIRECT_URI}?code={AUTH_CODE}&state={STATE}
   (error case: ?error={error}&error_description={message})

3. Exchange code for token:
   POST https://{build}.simprosuite.com/oauth2/token
   Content-Type: application/x-www-form-urlencoded
   grant_type=authorization_code&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}&
   code={AUTH_CODE}&redirect_uri={REDIRECT_URI}

4. Response: { "access_token": "...", "refresh_token": "...", "expires_in": 3600 }

5. Use: Authorization: Bearer {access_token}
```

---

## Endpoint Catalog

### Companies

| Method | Path          | Purpose                     | Auth | Paginated | Idempotent |
| ------ | ------------- | --------------------------- | ---- | --------- | ---------- |
| GET    | `/companies/` | List companies on the build | Yes  | Yes       | Yes        |

> Returns array of `{ID, Name}` objects. Use to discover companyID. [CONFIRMED -- SDK code]

### Jobs

| Method | Path                         | Purpose            | Auth | Paginated | Idempotent |
| ------ | ---------------------------- | ------------------ | ---- | --------- | ---------- |
| GET    | `/companies/{cid}/jobs/`     | List jobs          | Yes  | Yes       | Yes        |
| GET    | `/companies/{cid}/jobs/{id}` | Get single job     | Yes  | No        | Yes        |
| POST   | `/companies/{cid}/jobs/`     | Create job         | Yes  | No        | No         |
| PATCH  | `/companies/{cid}/jobs/{id}` | Partial update job | Yes  | No        | Yes        |
| PUT    | `/companies/{cid}/jobs/{id}` | Full update job    | Yes  | No        | Yes        |
| DELETE | `/companies/{cid}/jobs/{id}` | Delete job         | Yes  | No        | Yes        |

### Quotes

| Method | Path                           | Purpose          | Auth | Paginated | Idempotent |
| ------ | ------------------------------ | ---------------- | ---- | --------- | ---------- |
| GET    | `/companies/{cid}/quotes/`     | List quotes      | Yes  | Yes       | Yes        |
| GET    | `/companies/{cid}/quotes/{id}` | Get single quote | Yes  | No        | Yes        |
| POST   | `/companies/{cid}/quotes/`     | Create quote     | Yes  | No        | No         |
| PATCH  | `/companies/{cid}/quotes/{id}` | Update quote     | Yes  | No        | Yes        |

### Leads

| Method | Path                          | Purpose     | Auth | Paginated | Idempotent |
| ------ | ----------------------------- | ----------- | ---- | --------- | ---------- |
| GET    | `/companies/{cid}/leads/`     | List leads  | Yes  | Yes       | Yes        |
| POST   | `/companies/{cid}/leads/`     | Create lead | Yes  | No        | No         |
| PATCH  | `/companies/{cid}/leads/{id}` | Update lead | Yes  | No        | Yes        |

### Customers

| Method | Path                                          | Purpose                    | Auth | Paginated | Idempotent |
| ------ | --------------------------------------------- | -------------------------- | ---- | --------- | ---------- |
| GET    | `/companies/{cid}/customers/companies/`       | List company customers     | Yes  | Yes       | Yes        |
| GET    | `/companies/{cid}/customers/companies/{id}`   | Get company customer       | Yes  | No        | Yes        |
| POST   | `/companies/{cid}/customers/companies/`       | Create company customer    | Yes  | No        | No         |
| PATCH  | `/companies/{cid}/customers/companies/{id}`   | Update company customer    | Yes  | No        | Yes        |
| GET    | `/companies/{cid}/customers/individuals/`     | List individual customers  | Yes  | Yes       | Yes        |
| POST   | `/companies/{cid}/customers/individuals/`     | Create individual customer | Yes  | No        | No         |
| PATCH  | `/companies/{cid}/customers/individuals/{id}` | Update individual customer | Yes  | No        | Yes        |

### Other Core Resources

| Method | Path                                          | Purpose                | Auth | Paginated |
| ------ | --------------------------------------------- | ---------------------- | ---- | --------- |
| GET    | `/companies/{cid}/contacts/`                  | List contacts          | Yes  | Yes       |
| GET    | `/companies/{cid}/sites/`                     | List sites             | Yes  | Yes       |
| GET    | `/companies/{cid}/employees/`                 | List employees         | Yes  | Yes       |
| GET    | `/companies/{cid}/employees/{id}`             | Get employee detail    | Yes  | No        |
| GET    | `/companies/{cid}/contractors/`               | List contractors       | Yes  | Yes       |
| GET    | `/companies/{cid}/catalogs/`                  | List catalog items     | Yes  | Yes       |
| GET    | `/companies/{cid}/vendors/`                   | List vendors           | Yes  | Yes       |
| GET    | `/companies/{cid}/schedules/`                 | List schedules         | Yes  | Yes       |
| GET    | `/companies/{cid}/customerInvoices/`          | List customer invoices | Yes  | Yes       |
| GET    | `/companies/{cid}/purchaseOrders/`            | List purchase orders   | Yes  | Yes       |
| GET    | `/companies/{cid}/vendorOrders/`              | List vendor orders     | Yes  | Yes       |
| GET    | `/companies/{cid}/assets/`                    | List assets            | Yes  | Yes       |
| GET    | `/companies/{cid}/accounts/payable/invoices/` | Accounts payable       | Yes  | Yes       |

### Sub-Resources (Job Hierarchy)

| Method   | Path                                                                       | Purpose        |
| -------- | -------------------------------------------------------------------------- | -------------- |
| GET/POST | `/companies/{cid}/jobs/{jid}/sections/`                                    | Job sections   |
| GET/POST | `/companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/`                  | Cost centers   |
| GET/POST | `/companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/{ccid}/schedules/` | Schedules      |
| GET/POST | `/companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/{ccid}/labor/`     | Labor items    |
| GET/POST | `/companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/{ccid}/catalogs/`  | Material items |

### Webhooks

| Method | Path             | Purpose                     |
| ------ | ---------------- | --------------------------- |
| GET    | `/webhooks/`     | List webhook subscriptions  |
| POST   | `/webhooks/`     | Create webhook subscription |
| DELETE | `/webhooks/{id}` | Delete webhook subscription |

### Full Entity Index

> simPRO exposes 100+ entity types. Confirmed via SyncHub data model at
> https://www.synchub.io/connectors/simpro/datamodel. Key entity groups:
>
> **Core:** Activity, Asset, AssetType, Catalog, CatalogGroup, ChartOfAccounts, Company, Contact, ContactLog, Contractor, CostCenter, CreditNote, CustomField, Zone
> **Customers:** CompanyCustomer, IndividualCustomer, CustomerPayment, CustomerTag
> **Jobs:** Job, JobSection, JobSectionCostCenter, JobCard, JobLog, JobAttachmentFile/Folder
> **Quotes:** Quote, QuoteSection, QuoteSectionCostCenter, QuoteLog, QuoteAttachmentFile/Folder
> **Leads:** Lead
> **Financials:** Invoice, CreditNote, RecurringInvoice, InvoiceLog
> **Procurement:** PurchaseOrder, PurchaseOrderReceipt, PurchaseOrderReceiptCatalog, PurchaseOrderReceiptCredit, Vendor
> **Contractors:** ContractorJob, ContractorInvoice, ContractorTimesheet
> **Employees:** Employee, EmployeeLicence
> **Scheduling:** Schedule, ActivitySchedule, MobileStatusLog
> **Pricing:** LaborRate, PlantAndEquipment, PlantType, TaxCode, PreBuildGroup
> **Commissions:** BasicCommission, AdvancedCommission
> **Recurring:** CompanyRecurringJob
> **Status Codes:** ProjectStatusCode, CustomerInvoiceStatusCode, PurchaseOrderStatusCode

---

## Data Models

### Job [CONFIRMED -- SyncHub data model]

| Field                    | Type     | Required    | Writable | Description                                 |
| ------------------------ | -------- | ----------- | -------- | ------------------------------------------- |
| ID                       | int      | -           | no       | Unique identifier                           |
| Name                     | string   | no          | yes      | Job name                                    |
| Description              | string   | no          | yes      | Job description                             |
| Type                     | string   | yes         | yes      | `Service`, `Project`, or `Prepaid`          |
| CompanyCustomerID        | int      | conditional | yes      | FK to CompanyCustomer                       |
| IndividualCustomerID     | int      | conditional | yes      | FK to IndividualCustomer                    |
| SiteID                   | int      | yes         | yes      | FK to Site                                  |
| CustomerContactID        | int      | no          | yes      | FK to Contact                               |
| SiteContactID            | int      | no          | yes      | FK to Contact                               |
| OrderNo                  | string   | no          | yes      | Order number                                |
| Notes                    | string   | no          | yes      | Notes                                       |
| DateIssued               | datetime | no          | yes      | Date issued                                 |
| DueDate                  | datetime | no          | yes      | Due date                                    |
| DueTime                  | string   | no          | yes      | Due time                                    |
| Stage                    | string   | no          | no       | Pending/Progress/Complete/Invoiced/Archived |
| StatusID                 | int      | no          | yes      | FK to ProjectStatusCode                     |
| SalesPersonEmployeeID    | int      | no          | yes      | FK to Employee                              |
| ProjectManagerEmployeeID | int      | no          | yes      | FK to Employee                              |
| AutoAdjustStatus         | boolean  | no          | yes      | Auto-adjust status                          |
| IsVariation              | boolean  | no          | yes      | Variation flag                              |
| CompletedDate            | datetime | no          | no       | Completion date                             |
| Totals (sub-fields)      | decimals | no          | no       | Computed financial totals                   |

### Customer (Company) [CONFIRMED -- SyncHub data model]

| Field                 | Type    | Required | Writable | Description                 |
| --------------------- | ------- | -------- | -------- | --------------------------- |
| ID                    | int     | -        | no       | Unique identifier           |
| CompanyName           | string  | yes      | yes      | Company name                |
| EIN                   | string  | no       | yes      | Employer ID Number          |
| Website               | string  | no       | yes      | Website URL                 |
| Address fields        | objects | no       | yes      | Physical address            |
| BillingAddress fields | objects | no       | yes      | Billing address             |
| Banking fields        | objects | no       | yes      | Payment terms, bank details |

### Customer (Individual) [CONFIRMED -- SyncHub data model]

| Field      | Type   | Required | Writable | Description       |
| ---------- | ------ | -------- | -------- | ----------------- |
| ID         | int    | -        | no       | Unique identifier |
| Title      | string | no       | yes      | Title             |
| GivenName  | string | yes      | yes      | First name        |
| FamilyName | string | yes      | yes      | Last name         |
| CellPhone  | string | no       | yes      | Mobile            |
| Email      | string | no       | yes      | Email             |
| Phone      | string | no       | yes      | Phone             |

### Employee [CONFIRMED -- SDK code, SyncHub model]

| Field          | Type     | Required | Writable | Description       |
| -------------- | -------- | -------- | -------- | ----------------- |
| ID             | int      | -        | no       | Unique identifier |
| Name           | string   | yes      | yes      | Full name         |
| Position       | string   | no       | yes      | Job position      |
| DateOfHire     | datetime | no       | yes      | Hire date         |
| Contact fields | strings  | no       | yes      | Phone, email      |

### Invoice [CONFIRMED -- SyncHub data model]

| Field       | Type     | Required | Writable | Description       |
| ----------- | -------- | -------- | -------- | ----------------- |
| ID          | int      | -        | no       | Unique identifier |
| Description | string   | no       | yes      | Description       |
| DateIssued  | datetime | no       | yes      | Issue date        |
| Type        | string   | no       | no       | Invoice type      |
| Stage       | string   | no       | no       | Current stage     |
| StatusID    | int      | no       | yes      | FK to status code |
| ExTax       | decimal  | no       | no       | Amount ex tax     |
| IncTax      | decimal  | no       | no       | Amount inc tax    |
| BalanceDue  | decimal  | no       | no       | Balance remaining |
| IsPaid      | boolean  | no       | no       | Payment status    |

---

## Query Parameters

| Parameter   | Type    | Default | Description                                                                                                   |
| ----------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| page        | integer | 1       | Page number (1-indexed) [DOCUMENTED]                                                                          |
| pageSize    | integer | 30      | Records per page (1-250) [DOCUMENTED]                                                                         |
| columns     | string  | default | Comma-separated field names [DOCUMENTED]                                                                      |
| orderby     | string  | default | Sort field(s), prefix `-` for descending [DOCUMENTED]                                                         |
| {FieldName} | string  | -       | Filter by field value; supports `gt()`, `lt()`, `ge()`, `le()`, `ne()`, `between()`, `%` wildcard [CONFIRMED] |

**Header-based filters:**

| Header            | Format              | Description                               |
| ----------------- | ------------------- | ----------------------------------------- |
| If-Modified-Since | YYYY-MM-ddTHH:mm:ss | Return only modified records [DOCUMENTED] |

---

## Pagination

- **Type:** Page-number based [DOCUMENTED]
- **Default page size:** 30 [DOCUMENTED]
- **Max page size:** 250 [DOCUMENTED]
- **Total count:** Available via `Result-Total` response header [DOCUMENTED]

**Response structure:**

```
HTTP/1.1 200 OK
Result-Total: 816
Result-Pages: 28
Result-Count: 30
Link: <...?page=2>; rel="next", <...?page=28>; rel="last", <...?page=1>; rel="first"

[
  {"ID": 1, "Type": "Service", ...},
  {"ID": 2, "Type": "Project", ...}
]
```

**Last page detection:** No `rel="next"` in Link header, or `page >= Result-Pages`.

---

## Rate Limits

| Scope                     | Limit       | Window   | Source                                           |
| ------------------------- | ----------- | -------- | ------------------------------------------------ |
| Per-build (all consumers) | 10 requests | 1 second | [DOCUMENTED -- strictly enforced since Aug 2022] |
| Per-build (daily)         | [UNKNOWN]   | 24 hours | [DOCUMENTED -- exists but unpublished]           |

**Headers:** No standard rate limit headers returned. [CONFIRMED]
**When exceeded:** HTTP 429 Too Many Requests [DOCUMENTED]
**Recommended strategy:** 80% threshold (8 req/sec); exponential backoff on 429 [DOCUMENTED -- Laravel package]

---

## Error Handling

**Error response format:** [CONFIRMED -- forum]

```json
{
  "status": "error",
  "url": "https://build.simprosuite.com/api/v1.0/...",
  "header": {},
  "data": {
    "errors": [{ "path": null, "message": "Invalid route.", "value": null }]
  }
}
```

**Status codes:**

| Status | Meaning            | Retryable | Recovery                                  |
| ------ | ------------------ | --------- | ----------------------------------------- |
| 200    | Success            | -         | -                                         |
| 204    | No Content (PATCH) | -         | Verify with GET (may be silent rejection) |
| 400    | Bad request        | No        | Fix per `data.errors`                     |
| 401    | Unauthorized       | Yes       | Refresh token                             |
| 403    | Forbidden          | No        | Check access type                         |
| 404    | Not found          | No        | Verify ID and companyID                   |
| 429    | Rate limited       | Yes       | Wait 1s+ and retry                        |
| 500    | Server error       | Yes       | Retry; check column/filter conflicts      |

---

## Webhooks / Events

**Registration:** `POST /api/v1.0/webhooks/` with `{"url": "...", "events": [...]}` [DOCUMENTED]

**Events (22 confirmed):**

| Event                                                         | Trigger                     |
| ------------------------------------------------------------- | --------------------------- |
| job.created / updated / status                                | Job lifecycle               |
| job.stage.pending / progress / complete / invoiced / archived | Job stage transitions       |
| quote.created / updated / status                              | Quote lifecycle             |
| lead.created / updated / status                               | Lead lifecycle              |
| contact.created / updated                                     | Contact changes             |
| company.customer.created / updated                            | Company customer changes    |
| individual.customer.updated                                   | Individual customer changes |
| job.schedule.created / updated                                | Job scheduling              |
| quote.schedule.created / updated                              | Quote scheduling            |

**Payload format:** [CONFIRMED -- forum posts with actual received payloads]

```json
{
  "ID": "job.status",
  "build": "{build}",
  "name": "Job",
  "action": "status",
  "reference": { "companyID": 0, "jobID": 300555, "statusID": 10 },
  "date_triggered": "2023-01-31T09:05:27+00:00",
  "description": "Status of Job #300555 set to \"Job : In Progress\""
}
```

**Verification:** No signature mechanism [CONFIRMED]
**Retry policy:** [UNKNOWN]

---

## SDKs & Tooling

| SDK                | Language    | Repository                                                                                             | Quality | Notes                                                                   |
| ------------------ | ----------- | ------------------------------------------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------- |
| simpro-restapi-php | PHP         | [github.com/simPRO-Software/simpro-restapi-php](https://github.com/simPRO-Software/simpro-restapi-php) | Good    | Official; OAuth2 + CRUD examples; code analyzed [CONFIRMED]             |
| simpro-api-php     | PHP         | [github.com/simPRO-Software/simpro-api-php](https://github.com/simPRO-Software/simpro-api-php)         | Fair    | Official; older examples [CONFIRMED]                                    |
| laravel-simpro-api | PHP/Laravel | [github.com/stitch-digital/laravel-simpro-api](https://github.com/stitch-digital/laravel-simpro-api)   | Good    | Community; Saloon-based, pagination, rate limiting built in [CONFIRMED] |
| SimproAPI          | Python      | [pypi.org/project/SimproAPI/](https://pypi.org/project/SimproAPI/)                                     | Poor    | Community; limited to Plants & Equipment [CONFIRMED]                    |
| simpropy           | Python      | [pypi.org/project/simpropy/](https://pypi.org/project/simpropy/)                                       | Fair    | Community; basic wrapper [CONFIRMED]                                    |

**Postman collections:**

- https://www.postman.com/ishara-rajapakshe/simpro/overview [CONFIRMED]
- https://www.postman.com/prevalentware/simpro/ [CONFIRMED]
- https://www.postman.com/cryosat-cosmologist-3801651/workspace/simpro-api-wp/ [CONFIRMED]

**OpenAPI spec:** Not publicly available [CONFIRMED]

---

## Integration Path Assessment

**Recommended path:** Hybrid (Data Connector + Direct API)

**Justification:** simPRO provides both browsable structured content (jobs, quotes, customers, schedules, invoices) suitable for a data connector and action-oriented capabilities (create jobs, update statuses, manage schedules) that benefit from direct API access. Webhook support enables real-time event-driven integration for sync scenarios.

**Connector compatibility:**

| Connector Method  | API Endpoint                                       | Feasibility                                             |
| ----------------- | -------------------------------------------------- | ------------------------------------------------------- |
| list_files        | `GET /companies/{cid}/jobs/` (and other resources) | Good -- paginated list with field selection and filters |
| download_file     | `GET /companies/{cid}/jobs/{id}`                   | Good -- single record retrieval                         |
| search_files      | `GET /companies/{cid}/jobs/?FieldName=value`       | Good -- field filters, comparison operators, wildcards  |
| get_file_metadata | `GET /companies/{cid}/jobs/{id}?columns=ID,Status` | Good -- minimal field retrieval                         |

---

_Researched on 2026-03-30. Sources: Official PHP SDK (code analyzed), SyncHub data model (100+ entities), API forum posts (actual payloads), Rollout integration guides, Laravel community package, simPRO Help Guide FAQ._
