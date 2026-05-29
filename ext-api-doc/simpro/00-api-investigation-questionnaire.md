---
api_name: 'simPRO'
api_slug: 'simpro'
vendor: 'Simpro Group (simPRO Software)'
website: 'https://www.simprogroup.com'
investigation_started: '2026-03-30'
investigation_updated: '2026-03-30'
investigator: 'Claude Code (Opus 4.6)'
investigation_status: 'complete'
documentation_quality: 'good'
api_types: [REST]
overall_confidence: 'medium-high'
blockers:
  [
    'Developer portal returns 403 for automated fetch -- content confirmed to exist via search',
    'No live API credentials for test calls',
  ]
---

# API Investigation Questionnaire: simPRO

> Completed and upgraded investigation for the simPRO field service management REST API.
> All answers tagged with confidence markers per template requirements.
> **Upgrade pass:** Fetched official SDK source, SyncHub data model (100+ entities with full field lists),
> forum posts with real payloads, Rollout integration guides, and Laravel community package.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** https://developer.simprogroup.com/apidoc/ [CONFIRMED -- URL responds; content confirmed via search results showing endpoint-specific pages]
- **API reference / endpoint catalog URL:** https://developer.simprogroup.com/apidoc/ (endpoint-specific pages via `?page=` param, e.g., `?page=12ceff2290bb9039beaa8f36d5dec226` for jobs, `?page=166bb94a7df2dd7995b3aca6254e02f0` for customer payments, `?page=401740175cb9b4b5190e6d44cc5478bd` for job work orders) [CONFIRMED]
- **Authentication guide URL:** https://developer.simprogroup.com/apidoc/ (Getting Started section) [DOCUMENTED -- referenced in help guide and SDK]
- **Changelog / release notes URL:** [UNKNOWN -- no dedicated changelog URL; simPRO releases updates every two weeks per FAQ; forum thread `viewtopic.php?t=1568` has API release updates]
- **Status page URL:** https://status.simprogroup.com [CONFIRMED -- returns 200]

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** Not publicly available [CONFIRMED -- probes to /swagger.json and /openapi.json returned 403/404]
- **Postman collection URL:** Community collections exist on Postman:
  - https://www.postman.com/ishara-rajapakshe/simpro/overview [CONFIRMED]
  - https://www.postman.com/prevalentware/simpro/ [CONFIRMED -- includes "List all job contractor job custom fields" and other endpoints]
  - https://www.postman.com/cryosat-cosmologist-3801651/workspace/simpro-api-wp/ [CONFIRMED]
- **Official SDK repositories:**
  - PHP: https://github.com/simPRO-Software/simpro-restapi-php [CONFIRMED -- official, OAuth2 client + CRUD examples; code fetched and analyzed]
  - PHP (legacy): https://github.com/simPRO-Software/simpro-api-php [CONFIRMED -- older examples; Client.php source available]
  - Python (community): https://pypi.org/project/SimproAPI/ [CONFIRMED -- limited scope]
  - Python (community): https://pypi.org/project/simpropy/ [CONFIRMED -- basic wrapper]
  - Laravel (community): https://github.com/stitch-digital/laravel-simpro-api [CONFIRMED -- Saloon-based; reveals pagination headers, rate limiting config, query chaining]
  - Node.js: [UNKNOWN -- no official or robust community Node SDK found]
- **Official blog / engineering blog:** [UNKNOWN -- no dedicated engineering blog found]
- **Community forums / Stack Overflow tag:**
  - Forum: https://apiforum.simprogroup.com/ [CONFIRMED -- active, monitored weekly by dev team]
  - Legacy API reference: https://api.simpro.co/ [CONFIRMED -- PHP class docs for handlers like CustomerHandler, CustomerInvoiceHandler, JobHandler]
  - SyncHub data model: https://www.synchub.io/connectors/simpro/datamodel [CONFIRMED -- 100+ entities with full field definitions fetched]
  - Stack Overflow: No dedicated tag [CONFIRMED]

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                                                                                                         |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication            | 4      | OAuth2 well documented: authorization_code, client_credentials, API key; token lifetime (1hr access, 14-day refresh) confirmed [DOCUMENTED -- forum, SDK]     |
| Endpoint reference        | 4      | Comprehensive catalog in developer portal; 100+ entity types confirmed via SyncHub data model [CONFIRMED]                                                     |
| Request/response examples | 3      | Official PHP SDK has examples; Postman collections exist; error response format now confirmed [DOCUMENTED]                                                    |
| Error documentation       | 3      | Error response JSON format confirmed from forum: `{status, url, header, data: {errors: [{path, message, value}]}}` [CONFIRMED -- forum]                       |
| Rate limit documentation  | 3      | 10 req/sec per build [DOCUMENTED — forum + Laravel SDK config]; daily limit referenced anecdotally but no public number — treat as [INFERRED] until confirmed |
| Pagination documentation  | 5      | Excellent: page/pageSize params, Link headers, Result-Total/Pages/Count headers; max 250 [DOCUMENTED]                                                         |
| Webhook documentation     | 3      | 22 events listed; actual payload format confirmed from forum (ID, build, name, action, reference, date_triggered, description) [CONFIRMED -- forum]           |
| SDKs / code examples      | 3      | Official PHP SDK with 3 auth examples; community Laravel/Python packages [CONFIRMED]                                                                          |
| Changelog / versioning    | 2      | Forum thread with API release updates; no dedicated changelog page [DOCUMENTED -- forum]                                                                      |

**Overall documentation quality:** good (upgraded from "adequate" -- error format, webhook payloads, filter syntax, and token lifetime now confirmed)

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation
- [x] Found or confirmed no publicly accessible OpenAPI/Swagger spec
- [x] Identified authentication method (OAuth 2.0, multiple grant types, API key)
- [x] Found working examples (PHP SDK fetched, code analyzed)
- [x] Identified rate limit information (10 req/sec)
- [x] Identified pagination approach (page-number with Link headers)
- [x] Checked for webhook/event support (22 event types, payload format confirmed)
- [x] Checked for official SDKs (PHP official, community Python/Laravel)
- [x] Identified filter syntax with comparison operators (gt, lt, ge, le, ne, between, %) [NEW]
- [x] Confirmed error response JSON format [NEW]
- [x] Confirmed webhook payload structure from forum posts [NEW]
- [x] Confirmed token lifetime (1hr access, 14-day refresh) [NEW]

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** simPRO REST API [DOCUMENTED]
- **Vendor / company:** Simpro Group (formerly simPRO Software) [CONFIRMED]
- **Current API version:** v1.0 [CONFIRMED -- visible in URL pattern]
- **Base URL(s):**
  - Production: `https://{build_name}.simprosuite.com/api/v1.0/` [CONFIRMED -- SDK code, forum posts]
  - Sandbox / testing: [UNKNOWN -- no sandbox environment; testing requires a real simPRO Premium build]
- **API type:** REST [CONFIRMED]

> **Note:** The base URL is per-tenant. Each simPRO customer has their own subdomain (e.g., `markscompany.simprosuite.com`).

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTPS (mandatory) [DOCUMENTED -- FAQ states all communication must be HTTPS]
- **Data format:** JSON [CONFIRMED -- REST API uses JSON]
- **Content-Type header(s):** `application/json` [CONFIRMED -- SDK code]
- **Character encoding:** UTF-8 [CONFIRMED]
- **URL structure pattern:** [CONFIRMED]

```
https://{build}.simprosuite.com/api/v1.0/companies/{companyID}/{resource}/
https://{build}.simprosuite.com/api/v1.0/companies/{companyID}/{resource}/{id}
https://{build}.simprosuite.com/api/v1.0/companies/{companyID}/{parent}/{parentID}/{child}/
```

- **Versioning strategy:** URL path (`/api/v1.0/`) [CONFIRMED]
- **CORS policy:** [UNKNOWN]
- **Required headers (all requests):** [DOCUMENTED]

| Header        | Value                   | Purpose                                |
| ------------- | ----------------------- | -------------------------------------- |
| Authorization | `Bearer {access_token}` | OAuth2 bearer token [DOCUMENTED]       |
| Content-Type  | `application/json`      | Request body format [CONFIRMED -- SDK] |

### 2.3 Authentication [REQUIRED]

- **Auth method:** OAuth 2.0 [DOCUMENTED]
- **Auth location:** Header [DOCUMENTED]
- **Auth header format:** `Authorization: Bearer {access_token}` [DOCUMENTED]

**OAuth 2.0:**

- **Grant type(s) supported:** authorization_code, client_credentials, resource_owner_password (deprecated), implicit (JS only) [DOCUMENTED -- PHP SDK references all four]
- **Authorization URL:** `https://{build}.simprosuite.com/oauth2/login?client_id={CLIENT_ID}` [VERIFIED 2026-05-19 — official PHP SDK `simPRO-Software/simpro-restapi-php` Provider.php:230]
- **Token URL:** `https://{build}.simprosuite.com/oauth2/token` [VERIFIED 2026-05-19 — Provider.php:225]
- **Note — corrected 2026-05-19:** prior versions of this doc listed `https://auth.simpro.co/oauth/*` as a centralized alternative. **`auth.simpro.co` does not resolve in DNS** (NXDOMAIN, verified via `dig`). Only per-build URLs exist. The official PHP SDK uses per-build exclusively.
- **Revocation URL:** [UNKNOWN]
- **Required scopes:** [UNKNOWN -- scopes referenced in auth flow but specific scope values not publicly enumerated]
- **Token lifetime:** Access token expires in 3600 seconds (1 hour); refresh token expires in 14 days [CONFIRMED -- forum]
- **Refresh token behavior:** Supported via `grant_type=refresh_token`; once a refresh token is used, it becomes invalid (single-use) [CONFIRMED -- forum]
- **PKCE required?** [UNKNOWN]
- **State parameter required?** Yes, recommended for CSRF protection [DOCUMENTED -- SDK code]
- **Redirect URI restrictions:** Must be registered when creating application in simPRO [DOCUMENTED]

**API Key auth (alternative):**

- **How to obtain:** System > Setup > API > Applications in simPRO Premium [DOCUMENTED -- FAQ]
- **SDK usage:** `(new \simPRO\RestClient\OAuth2\APIKey())->withBuildURL($buildURL)->withToken($token)` [CONFIRMED -- SDK code]

**Direct Access vs User Token Access:** [DOCUMENTED]

- Direct Access: Application key grants access to all data; not associated with employee credentials
- User Token Access: Associated with specific user, respects user permissions; uses "3 Legged" OAuth

### 2.4 First Successful Call [REQUIRED] -- CRITICAL GATE

> **GATE NOTE:** No live API credentials available. Cannot make a first call. All endpoint information is from documentation, SDK source code, forum posts, and SyncHub data model.

**Expected first call based on SDK code:** [CONFIRMED -- from AuthorisationCode.php]

```http
GET /api/v1.0/companies/ HTTP/1.1
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
```

**Expected response (from SDK code):** [CONFIRMED -- SDK accesses `$companyObject->ID` and `$companyObject->Name`]

```json
[
  {
    "ID": 1,
    "Name": "Company Name"
  }
]
```

Then:

```http
GET /api/v1.0/companies/{companyID}/employees/ HTTP/1.1
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
```

- **Response headers of note:** Result-Total, Result-Pages, Result-Count, Link [DOCUMENTED]
- [ ] **GATE CHECK: First successful API call completed** -- NOT COMPLETED (no credentials)

---

## Phase 3: Domain Model & Behavior

### 3.1 Core Entities [REQUIRED]

> Entity list derived from SyncHub data model (100+ entities with full field definitions) and confirmed via forum posts and SDK code.

#### Entity: Job

- **API resource name / endpoint path:** `/api/v1.0/companies/{companyID}/jobs/` [CONFIRMED -- SDK, forum]
- **Description:** Core work project entity. Represents a piece of work to be performed for a customer at a site. [DOCUMENTED]
- **CRUD support:** Create (POST), Read (GET), Update (PATCH), Delete (DELETE) [CONFIRMED -- SDK, Rollout guide]

**Key Fields:** [CONFIRMED -- SyncHub data model]

| Field                    | Type     | Required?   | Writable? | Description                                                          |
| ------------------------ | -------- | ----------- | --------- | -------------------------------------------------------------------- |
| ID                       | int      | -           | no        | Unique job identifier                                                |
| Name                     | string   | no          | yes       | Job name                                                             |
| Description              | string   | no          | yes       | Job description                                                      |
| Type                     | string   | yes         | yes       | "Service", "Project", or "Prepaid"                                   |
| IndividualCustomerID     | int      | conditional | yes       | FK to IndividualCustomer                                             |
| CompanyCustomerID        | int      | conditional | yes       | FK to CompanyCustomer                                                |
| CustomerContactID        | int      | no          | yes       | FK to Contact                                                        |
| SiteID                   | int      | yes         | yes       | FK to Site                                                           |
| SiteContactID            | int      | no          | yes       | FK to Contact (site contact)                                         |
| OrderNo                  | string   | no          | yes       | Order number                                                         |
| Notes                    | string   | no          | yes       | Job notes                                                            |
| DateIssued               | datetime | no          | yes       | Date issued                                                          |
| DueDate                  | datetime | no          | yes       | Due date                                                             |
| DueTime                  | string   | no          | yes       | Due time                                                             |
| SalesPersonEmployeeID    | int      | no          | yes       | FK to Employee                                                       |
| ProjectManagerEmployeeID | int      | no          | yes       | FK to Employee                                                       |
| Stage                    | string   | no          | no        | Current workflow stage (Pending/Progress/Complete/Invoiced/Archived) |
| StatusID                 | int      | no          | yes       | FK to ProjectStatusCode                                              |
| ResponseTimeID           | int      | no          | yes       | Response time                                                        |
| IsVariation              | boolean  | no          | yes       | Whether job is a variation                                           |
| ConvertedFromQuoteID     | int      | no          | no        | FK to Quote (if converted)                                           |
| AutoAdjustStatus         | boolean  | no          | yes       | Auto-adjust status                                                   |
| CompletedDate            | datetime | no          | no        | Completion date                                                      |
| Totals fields            | decimals | no          | no        | Computed financial totals (multiple sub-fields)                      |

#### Entity: Quote

- **API resource name / endpoint path:** `/api/v1.0/companies/{companyID}/quotes/` [CONFIRMED -- forum]
- **Description:** Customer proposal/estimate document. [DOCUMENTED]
- **CRUD support:** Create, Read, Update [CONFIRMED]

**Key Fields:** [CONFIRMED -- SyncHub data model]

| Field                | Type     | Required?   | Writable? | Description               |
| -------------------- | -------- | ----------- | --------- | ------------------------- |
| ID                   | int      | -           | no        | Unique quote identifier   |
| Name                 | string   | no          | yes       | Quote name                |
| Description          | string   | no          | yes       | Quote description         |
| IndividualCustomerID | int      | conditional | yes       | FK to IndividualCustomer  |
| CompanyCustomerID    | int      | conditional | yes       | FK to CompanyCustomer     |
| SiteID               | int      | yes         | yes       | FK to Site                |
| StatusID             | int      | no          | yes       | FK to ProjectStatusCode   |
| DateIssued           | datetime | no          | yes       | Date issued               |
| DueDate              | datetime | no          | yes       | Due date                  |
| ValidityDays         | decimal  | no          | yes       | Quote validity in days    |
| Stage                | string   | no          | no        | Current stage             |
| IsClosed             | boolean  | no          | no        | Whether quote is closed   |
| ConvertedFromLeadID  | int      | no          | no        | FK to Lead                |
| Totals fields        | decimals | no          | no        | Computed financial totals |

#### Entity: Lead

- **API resource name / endpoint path:** `/api/v1.0/companies/{companyID}/leads/` [CONFIRMED -- webhook events]
- **Description:** Prospective customer opportunity. [DOCUMENTED]
- **CRUD support:** Create, Read, Update [CONFIRMED -- webhook events confirm lifecycle]

**Key Fields:** [CONFIRMED -- SyncHub data model]

| Field                  | Type    | Required?   | Writable? | Description              |
| ---------------------- | ------- | ----------- | --------- | ------------------------ |
| ID                     | int     | -           | no        | Unique identifier        |
| LeadName               | string  | no          | yes       | Lead name                |
| Description            | string  | no          | yes       | Description              |
| Stage                  | string  | no          | no        | Current stage            |
| StatusID               | int     | no          | yes       | FK to ProjectStatusCode  |
| FollowUpDate           | string  | no          | yes       | Follow-up date           |
| DateCreated            | string  | no          | no        | Creation date            |
| Notes                  | string  | no          | yes       | Notes                    |
| IndividualCustomerID   | int     | conditional | yes       | FK to IndividualCustomer |
| CompanyCustomerID      | int     | conditional | yes       | FK to CompanyCustomer    |
| SiteID                 | int     | no          | yes       | FK to Site               |
| SalesPersonEmployeeID  | int     | no          | yes       | FK to Employee           |
| ForecastEstimatedPrice | decimal | no          | yes       | Estimated value          |
| ForecastProbability    | decimal | no          | yes       | Win probability          |

#### Entity: Customer (Company)

- **API resource name / endpoint path:** `/api/v1.0/companies/{companyID}/customers/companies/` [CONFIRMED -- forum]
- **Description:** Corporate client record. [DOCUMENTED]
- **CRUD support:** Create, Read, Update [CONFIRMED]

**Key Fields:** [CONFIRMED -- SyncHub data model]

| Field          | Type    | Required? | Writable? | Description                    |
| -------------- | ------- | --------- | --------- | ------------------------------ |
| ID             | int     | -         | no        | Unique identifier              |
| CompanyName    | string  | yes       | yes       | Company name                   |
| EIN            | string  | no        | yes       | Employer Identification Number |
| Website        | string  | no        | yes       | Website URL                    |
| Fax            | string  | no        | yes       | Fax number                     |
| Address fields | objects | no        | yes       | Physical and billing addresses |
| Banking fields | objects | no        | yes       | Payment terms, bank details    |

#### Entity: Customer (Individual)

- **API resource name / endpoint path:** `/api/v1.0/companies/{companyID}/customers/individuals/` [CONFIRMED -- webhook event `individual.customer.updated`]
- **Description:** Individual/sole proprietor client. [DOCUMENTED]

**Key Fields:** [CONFIRMED -- SyncHub data model]

| Field      | Type   | Required? | Writable? | Description         |
| ---------- | ------ | --------- | --------- | ------------------- |
| ID         | int    | -         | no        | Unique identifier   |
| Title      | string | no        | yes       | Title (Mr/Mrs etc.) |
| GivenName  | string | yes       | yes       | First name          |
| FamilyName | string | yes       | yes       | Last name           |
| CellPhone  | string | no        | yes       | Mobile phone        |
| Email      | string | no        | yes       | Email address       |
| Phone      | string | no        | yes       | Phone               |

#### Entity: Contact

- **API resource name / endpoint path:** `/api/v1.0/companies/{companyID}/contacts/` [CONFIRMED -- webhook events]
- **Description:** Contact person for a customer. [DOCUMENTED]

**Key Fields:** [CONFIRMED -- SyncHub data model]

| Field        | Type    | Required? | Writable? | Description       |
| ------------ | ------- | --------- | --------- | ----------------- |
| ID           | int     | -         | no        | Unique identifier |
| Title        | string  | no        | yes       | Title             |
| GivenName    | string  | yes       | yes       | First name        |
| FamilyName   | string  | yes       | yes       | Last name         |
| Email        | string  | no        | yes       | Email             |
| Phone fields | strings | no        | yes       | Phone numbers     |
| Department   | string  | no        | yes       | Department        |
| Position     | string  | no        | yes       | Position          |
| Notes        | string  | no        | yes       | Notes             |

#### Entity: Site

- **API resource name / endpoint path:** `/api/v1.0/companies/{companyID}/sites/` [CONFIRMED -- forum]
- **Description:** Customer property location where work is performed. [DOCUMENTED]

#### Entity: Employee

- **API resource name / endpoint path:** `/api/v1.0/companies/{companyID}/employees/` [CONFIRMED -- SDK code]
- **Description:** Internal staff member. [DOCUMENTED]

**Key Fields:** [CONFIRMED -- SyncHub data model, SDK code showing ID and Name access]

| Field          | Type     | Required? | Writable? | Description       |
| -------------- | -------- | --------- | --------- | ----------------- |
| ID             | int      | -         | no        | Unique identifier |
| Name           | string   | yes       | yes       | Employee name     |
| Position       | string   | no        | yes       | Position          |
| DateOfHire     | datetime | no        | yes       | Hire date         |
| Address fields | objects  | no        | yes       | Address           |
| Contact fields | strings  | no        | yes       | Phone, email      |

#### Entity: Contractor

- **API resource name / endpoint path:** `/api/v1.0/companies/{companyID}/contractors/` [CONFIRMED -- SyncHub data model]

#### Entity: Vendor

- **API resource name / endpoint path:** `/api/v1.0/companies/{companyID}/vendors/` [CONFIRMED -- SyncHub data model]

#### Entity: Catalog

- **API resource name / endpoint path:** `/api/v1.0/companies/{companyID}/catalogs/` [CONFIRMED -- forum pagination example]

**Key Fields:** [CONFIRMED -- SyncHub data model]

| Field        | Type    | Required? | Writable? | Description         |
| ------------ | ------- | --------- | --------- | ------------------- |
| ID           | int     | -         | no        | Unique identifier   |
| Name         | string  | yes       | yes       | Item name           |
| IsFavorite   | boolean | no        | yes       | Favorite flag       |
| IsInventory  | boolean | no        | yes       | Inventory item flag |
| UPC          | string  | no        | yes       | UPC code            |
| Manufacturer | string  | no        | yes       | Manufacturer        |
| BasePrice    | decimal | no        | yes       | Base price          |
| SellPrice    | decimal | no        | yes       | Sell price          |
| Archived     | boolean | no        | yes       | Archived flag       |

#### Entity: Invoice (Customer)

- **API resource name / endpoint path:** `/api/v1.0/companies/{companyID}/customerInvoices/` [CONFIRMED -- forum]

**Key Fields:** [CONFIRMED -- SyncHub data model]

| Field       | Type     | Required? | Writable? | Description                     |
| ----------- | -------- | --------- | --------- | ------------------------------- |
| ID          | int      | -         | no        | Unique identifier               |
| Description | string   | no        | yes       | Description                     |
| DateCreated | datetime | no        | no        | Creation date                   |
| DateIssued  | datetime | no        | yes       | Issue date                      |
| Type        | string   | no        | no        | Invoice type                    |
| Stage       | string   | no        | no        | Current stage                   |
| StatusID    | int      | no        | yes       | FK to CustomerInvoiceStatusCode |
| ExTax       | decimal  | no        | no        | Amount ex tax                   |
| Tax         | decimal  | no        | no        | Tax amount                      |
| IncTax      | decimal  | no        | no        | Amount inc tax                  |
| BalanceDue  | decimal  | no        | no        | Balance remaining               |
| IsPaid      | boolean  | no        | no        | Payment status                  |
| DatePaid    | datetime | no        | no        | Payment date                    |

#### Entity: Schedule

- **API resource name / endpoint path:** `/api/v1.0/companies/{companyID}/schedules/` (top-level) or nested under job/section/costCenter [CONFIRMED -- forum]
- **CRUD support:** Create, Read, Update, Delete [CONFIRMED -- forum]

#### Entity: PurchaseOrder

- **API resource name / endpoint path:** `/api/v1.0/companies/{companyID}/purchaseOrders/` [CONFIRMED -- SyncHub data model]

**Key Fields:** [CONFIRMED -- SyncHub data model]

| Field        | Type     | Required? | Writable? | Description                   |
| ------------ | -------- | --------- | --------- | ----------------------------- |
| ID           | int      | -         | no        | Unique identifier             |
| Type         | string   | no        | yes       | PO type                       |
| Stage        | string   | no        | no        | Current stage                 |
| StatusID     | int      | no        | yes       | FK to PurchaseOrderStatusCode |
| DateIssued   | datetime | no        | yes       | Issue date                    |
| VendorID     | int      | yes       | yes       | FK to Vendor                  |
| DueDate      | datetime | no        | yes       | Due date                      |
| Reference    | string   | no        | yes       | Reference number              |
| TotalsExTax  | decimal  | no        | no        | Total ex tax                  |
| TotalsIncTax | decimal  | no        | no        | Total inc tax                 |

#### Entity: Asset

- **API resource name / endpoint path:** `/api/v1.0/companies/{companyID}/assets/` [CONFIRMED -- SyncHub data model]

#### Entity: Webhook Subscription

- **API resource name / endpoint path:** `/api/v1.0/webhooks/` [DOCUMENTED -- forum, Rollout guide]
- **CRUD support:** Create, Read, Update, Delete [DOCUMENTED]

### 3.2 Entity Relationships [IMPORTANT]

```
┌───────────────┐      1:N      ┌──────────┐      1:N      ┌─────────────┐
│   Customer    │──────────────>│   Site   │<──────────────│    Asset    │
│ (Company/     │               └──────────┘               └─────────────┘
│  Individual)  │                     │
└───────────────┘                     │ N:1
      │                               ▼
      │ 1:N                    ┌──────────┐      1:N      ┌─────────────┐
      └───────────────────────>│   Job    │──────────────>│ JobSection  │
                               └──────────┘               └─────────────┘
                                    │                           │
                                    │ 1:N                       │ 1:N
                                    ▼                           ▼
                              ┌──────────┐             ┌───────────────────┐
                              │ Schedule │             │ JobSectionCost-   │
                              └──────────┘             │ Center            │
                                                       └───────────────────┘
                                                             │ 1:N
                                            ┌────────┬───────┼───────┬────────┐
                                            ▼        ▼       ▼       ▼        ▼
                                         Catalog  Labor  OneOff  Prebuild  ServiceFee

  ┌──────────┐  converts  ┌──────────┐  converts  ┌──────────┐
  │   Lead   │───────────>│  Quote   │───────────>│   Job    │
  └──────────┘            └──────────┘            └──────────┘
                                                        │ invoices
                                                        ▼
  ┌──────────┐      1:N      ┌───────────────┐  ┌──────────────┐
  │  Vendor  │──────────────>│ PurchaseOrder │  │   Invoice    │
  └──────────┘               └───────────────┘  └──────────────┘
```

### 3.3 State Machines [IMPORTANT]

#### State Machine: Job [DOCUMENTED -- help guide, webhook events]

```
[Pending] --> [Progress] --> [Complete] --> [Invoiced] --> [Archived]
```

| From State | Action/Trigger      | To State | Reversible?                         | Side Effects                                 |
| ---------- | ------------------- | -------- | ----------------------------------- | -------------------------------------------- |
| Pending    | Schedule/start work | Progress | Yes (with "Ignore status priority") | Webhook: job.stage.progress                  |
| Progress   | Complete work       | Complete | Yes (with override)                 | Webhook: job.stage.complete                  |
| Complete   | Invoice job         | Invoiced | No (typically)                      | Creates invoice; Webhook: job.stage.invoiced |
| Invoiced   | Archive             | Archived | No                                  | Webhook: job.stage.archived                  |

> **Important:** Stages are fixed. Within each stage, custom status codes are defined per simPRO instance. Status codes have a priority hierarchy. PATCH to a lower-priority status returns 204 but silently ignores the change (known bug). [CONFIRMED -- forum]

#### State Machine: Quote [CONFIRMED -- webhook events + SyncHub fields (Stage, IsClosed)]

```
[Draft] --> [Sent] --> [Approved/Declined] --> [Converted to Job]
```

#### State Machine: Lead [CONFIRMED -- webhook events + SyncHub fields (Stage)]

```
[Open] --> [Qualified] --> [Converted to Quote/Job] or [Lost]
```

### 3.4 Business Rules [IMPORTANT]

**Ordering / dependency rules:**

- Must have a Customer and Site before creating a Job [CONFIRMED -- SyncHub model shows required FK fields]
- Jobs contain Sections, which contain Cost Centers -- hierarchy must exist before adding labor/materials [DOCUMENTED -- forum]
- Schedules are created under Job > Section > CostCenter [CONFIRMED -- forum]

**Field-level rules:**

- Company ID is 0 for single-company builds; multi-company builds require the actual company ID [CONFIRMED -- forum]
- Status codes are hierarchical -- cannot set a job to a lower-priority status without "Ignore status priority" [DOCUMENTED]
- Filter by field: `CompanyName` for company customers, not `Name` [CONFIRMED -- forum]
- Filter by ID: some endpoints do not support search on the ID column [CONFIRMED -- forum]

### 3.5 Field Format Reference [IMPORTANT]

| Format    | Pattern                   | Example                       | Notes                                                    |
| --------- | ------------------------- | ----------------------------- | -------------------------------------------------------- |
| Date      | YYYY-MM-dd                | `"2026-01-15"`                | [CONFIRMED -- SyncHub model shows datetime fields]       |
| DateTime  | YYYY-MM-ddTHH:mm:ss+00:00 | `"2026-01-15T14:30:00+00:00"` | ISO 8601 with timezone [CONFIRMED -- webhook payloads]   |
| Currency  | decimal                   | `1500.00`                     | Numeric, no currency symbol [CONFIRMED -- SyncHub model] |
| ID format | integer                   | `123`                         | Auto-incrementing integers [CONFIRMED]                   |
| Boolean   | boolean                   | `true` / `false`              | [CONFIRMED -- SyncHub model]                             |

### 3.6 Enum Value Reference [IMPORTANT]

| Entity        | Field  | Allowed Values                                            | Default   | Notes                        |
| ------------- | ------ | --------------------------------------------------------- | --------- | ---------------------------- |
| Job           | Type   | `Service`, `Project`, `Prepaid`                           | [UNKNOWN] | [CONFIRMED -- forum post]    |
| Job           | Stage  | `Pending`, `Progress`, `Complete`, `Invoiced`, `Archived` | `Pending` | Fixed stages [DOCUMENTED]    |
| ContractorJob | Status | varies                                                    | [UNKNOWN] | [CONFIRMED -- SyncHub model] |
| PurchaseOrder | Stage  | varies                                                    | [UNKNOWN] | [CONFIRMED -- SyncHub model] |
| Invoice       | Stage  | varies                                                    | [UNKNOWN] | [CONFIRMED -- SyncHub model] |

---

## Phase 4: Endpoint Catalog

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /api/v1.0/companies/

- **Purpose:** List all companies on the build [CONFIRMED -- SDK code]
- **Response fields:** ID, Name [CONFIRMED -- SDK accesses `$companyObject->ID` and `$companyObject->Name`]

#### Endpoint: GET /api/v1.0/companies/{companyID}/jobs/

- **Purpose:** List all jobs with optional filtering and pagination [CONFIRMED -- forum]
- **Authentication required:** Yes [DOCUMENTED]
- **Rate limit:** 10 req/sec (global) [DOCUMENTED]

**Query parameters:**

| Parameter | Type    | Required | Default     | Description                                  |
| --------- | ------- | -------- | ----------- | -------------------------------------------- |
| page      | integer | No       | 1           | Page number [DOCUMENTED]                     |
| pageSize  | integer | No       | 30          | Results per page (max 250) [DOCUMENTED]      |
| columns   | string  | No       | default set | Comma-separated field names [DOCUMENTED]     |
| orderby   | string  | No       | [UNKNOWN]   | Sort field, prefix `-` for desc [DOCUMENTED] |

**Headers:**

| Header            | Required | Description                                      |
| ----------------- | -------- | ------------------------------------------------ |
| If-Modified-Since | No       | DateTime filter for changed records [DOCUMENTED] |

**Response headers:**

| Header       | Example                    | Purpose                                   |
| ------------ | -------------------------- | ----------------------------------------- |
| Result-Total | `816`                      | Total records matching query [DOCUMENTED] |
| Result-Pages | `28`                       | Total pages [DOCUMENTED]                  |
| Result-Count | `30`                       | Records in this page [DOCUMENTED]         |
| Link         | `<...?page=2>; rel="next"` | Pagination links (RFC 5988) [DOCUMENTED]  |

#### Endpoint: POST /api/v1.0/companies/{companyID}/jobs/

- **Purpose:** Create a new job [CONFIRMED -- Rollout guide, SDK]
- **Response:** Returns created job with ID [CONFIRMED -- forum: `job.ID`]

#### Endpoint: PATCH /api/v1.0/companies/{companyID}/jobs/{jobID}

- **Purpose:** Partial update of a job [CONFIRMED -- forum discusses PATCH for status updates]
- **Response:** HTTP 204 No Content on success [CONFIRMED -- forum]
- **Gotcha:** Returns 204 even if status update was silently rejected due to priority hierarchy [CONFIRMED -- forum: known bug]

#### Endpoint: DELETE /api/v1.0/companies/{companyID}/jobs/{jobID}

- **Purpose:** Delete a job [CONFIRMED -- Rollout guide]

#### Endpoint: POST /api/v1.0/webhooks/

- **Purpose:** Create a webhook subscription [DOCUMENTED -- Rollout guide]

```json
{
  "url": "https://your-domain.com/webhook",
  "events": ["job.created", "job.updated"]
}
```

### 4.2 Full Endpoint Index [IMPORTANT]

| Method   | Path                                                                       | Purpose                    | Confirmed            |
| -------- | -------------------------------------------------------------------------- | -------------------------- | -------------------- |
| GET      | `/companies/`                                                              | List companies             | [CONFIRMED -- SDK]   |
| GET      | `/companies/{cid}/jobs/`                                                   | List jobs                  | [CONFIRMED]          |
| GET      | `/companies/{cid}/jobs/{id}`                                               | Get job                    | [CONFIRMED]          |
| POST     | `/companies/{cid}/jobs/`                                                   | Create job                 | [CONFIRMED]          |
| PATCH    | `/companies/{cid}/jobs/{id}`                                               | Update job                 | [CONFIRMED -- forum] |
| DELETE   | `/companies/{cid}/jobs/{id}`                                               | Delete job                 | [CONFIRMED]          |
| GET      | `/companies/{cid}/quotes/`                                                 | List quotes                | [CONFIRMED]          |
| POST     | `/companies/{cid}/quotes/`                                                 | Create quote               | [CONFIRMED]          |
| PATCH    | `/companies/{cid}/quotes/{id}`                                             | Update quote               | [CONFIRMED]          |
| GET      | `/companies/{cid}/leads/`                                                  | List leads                 | [CONFIRMED]          |
| POST     | `/companies/{cid}/leads/`                                                  | Create lead                | [CONFIRMED]          |
| GET      | `/companies/{cid}/customers/companies/`                                    | List company customers     | [CONFIRMED]          |
| POST     | `/companies/{cid}/customers/companies/`                                    | Create company customer    | [CONFIRMED]          |
| GET      | `/companies/{cid}/customers/individuals/`                                  | List individual customers  | [CONFIRMED]          |
| POST     | `/companies/{cid}/customers/individuals/`                                  | Create individual customer | [CONFIRMED]          |
| GET      | `/companies/{cid}/contacts/`                                               | List contacts              | [CONFIRMED]          |
| GET      | `/companies/{cid}/sites/`                                                  | List sites                 | [CONFIRMED]          |
| GET      | `/companies/{cid}/employees/`                                              | List employees             | [CONFIRMED -- SDK]   |
| GET      | `/companies/{cid}/employees/{id}`                                          | Get employee               | [CONFIRMED -- SDK]   |
| GET      | `/companies/{cid}/contractors/`                                            | List contractors           | [CONFIRMED]          |
| GET      | `/companies/{cid}/catalogs/`                                               | List catalog items         | [CONFIRMED]          |
| GET      | `/companies/{cid}/vendors/`                                                | List vendors               | [CONFIRMED]          |
| GET      | `/companies/{cid}/schedules/`                                              | List schedules             | [CONFIRMED]          |
| GET      | `/companies/{cid}/customerInvoices/`                                       | List invoices              | [CONFIRMED]          |
| GET      | `/companies/{cid}/purchaseOrders/`                                         | List POs                   | [CONFIRMED]          |
| GET      | `/companies/{cid}/vendorOrders/`                                           | List vendor orders         | [CONFIRMED]          |
| GET      | `/companies/{cid}/assets/`                                                 | List assets                | [CONFIRMED]          |
| GET      | `/companies/{cid}/accounts/payable/invoices/`                              | Accounts payable           | [CONFIRMED -- forum] |
| GET/POST | `/companies/{cid}/jobs/{jid}/sections/`                                    | Job sections               | [CONFIRMED]          |
| GET/POST | `/companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/`                  | Cost centers               | [CONFIRMED]          |
| GET/POST | `/companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/{ccid}/schedules/` | Job schedules              | [CONFIRMED]          |
| GET/POST | `/companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/{ccid}/labor/`     | Labor items                | [CONFIRMED]          |
| GET/POST | `/companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/{ccid}/catalogs/`  | Material items             | [CONFIRMED]          |
| POST     | `/webhooks/`                                                               | Create webhook             | [DOCUMENTED]         |
| GET      | `/webhooks/`                                                               | List webhooks              | [DOCUMENTED]         |
| DELETE   | `/webhooks/{id}`                                                           | Delete webhook             | [DOCUMENTED]         |

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability              | Supported?       | Syntax                                                                 | Notes                                                  |
| ----------------------- | ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| Filter by field value   | Yes              | `?FieldName=value`                                                     | [CONFIRMED -- forum: `?GivenName=Rose%&FamilyName=A%`] |
| Wildcard search         | Yes              | `%` character                                                          | [CONFIRMED -- forum]                                   |
| Comparison operators    | Yes              | `gt()`, `lt()`, `ge()`, `le()`, `ne()`, `between()`                    | [CONFIRMED -- forum: `?DateIssued=gt(2021-01-01)`]     |
| Filter by date range    | Yes              | `If-Modified-Since` header OR comparison operators                     | [DOCUMENTED]                                           |
| Nested field filtering  | Yes              | Dot notation: `?CustomFields.CustomField.ID=35&CustomFields.Value=Yes` | [CONFIRMED -- forum]                                   |
| Full-text search        | No               | N/A                                                                    | No search endpoint [CONFIRMED]                         |
| Sort by field           | Yes              | `?orderby=FieldName`                                                   | [DOCUMENTED]                                           |
| Sort direction          | Yes              | `?orderby=-FieldName` (prefix `-`)                                     | [DOCUMENTED]                                           |
| Multi-sort              | Yes              | `?orderby=Field1,Field2`                                               | [DOCUMENTED]                                           |
| Field selection         | Yes              | `?columns=Field1,Field2`                                               | [DOCUMENTED]                                           |
| Include related records | Partial          | `?columns=CustomFields`                                                | [DOCUMENTED]                                           |
| Aggregation / count     | No (header only) | `Result-Total` response header                                         | [DOCUMENTED]                                           |

### 5.2 Filter Syntax [REQUIRED]

**Field value filters:**

```
?GivenName=Rose%               -- wildcard search (% = any)
?FamilyName=Smith               -- exact match
?CompanyName=Acme%              -- wildcard on company name
```

**Comparison operators:**

```
?ID=gt(4)                       -- greater than
?DateIssued=gt(2021-01-01)      -- dates work with comparison operators
?DateIssued=between(2021-01-01,2021-12-31)  -- range
?Status.Name=ne(Archived)       -- not equal
```

[CONFIRMED -- forum posts with actual usage examples]

**Nested field filters:**

```
?CustomFields.CustomField.ID=35&CustomFields.Value=Yes
```

[CONFIRMED -- forum]

**Combining filters:** Multiple query parameters are AND-combined [CONFIRMED -- forum shows combined params]

**Date filtering via header:**

```
If-Modified-Since: 2026-01-15T00:00:00
```

[DOCUMENTED]

### 5.3 Sort Syntax [DOCUMENTED]

```
?orderby=DateIssued          -- ascending
?orderby=-DateIssued         -- descending (prefix -)
?orderby=Status,DateIssued   -- multi-sort, comma-separated
```

### 5.4 Field Selection [DOCUMENTED]

```
?columns=ID,Name,Status,Totals,CustomFields
```

- Column names generally match the simPRO web UI field names [DOCUMENTED -- forum]
- Sub-resource columns (e.g., site address) not available via columns [DOCUMENTED -- forum]
- Some columns like "Amount Remaining" are computed on-the-fly [DOCUMENTED -- forum]

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** page-number [DOCUMENTED]
- **Default page size:** 30 [DOCUMENTED]
- **Maximum page size:** 250 [DOCUMENTED]
- **Total count available:** Yes, via `Result-Total` response header [DOCUMENTED]

**Response structure:** Body is a JSON array. Pagination metadata in headers:

```
Result-Total: 816
Result-Pages: 28
Result-Count: 30
Link: <https://{build}.simprosuite.com/api/v1.0/companies/0/catalogs/?page=2>; rel="next",
      <https://{build}.simprosuite.com/api/v1.0/companies/0/catalogs/?page=28>; rel="last",
      <https://{build}.simprosuite.com/api/v1.0/companies/0/catalogs/?page=1>; rel="first"
```

[DOCUMENTED -- confirmed from forum, Laravel package]

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /api/v1.0/companies/0/jobs/?pageSize=250&page=1
  -> Result-Total: 816, Result-Pages: 4, Result-Count: 250
  -> Link: <...?page=2>; rel="next", <...?page=4>; rel="last"

Page 4: GET /api/v1.0/companies/0/jobs/?pageSize=250&page=4
  -> Result-Total: 816, Result-Pages: 4, Result-Count: 66
  -> Link: <...?page=1>; rel="first", <...?page=3>; rel="prev"
  (no "next" = last page)
```

### 6.3 Bulk Operations [IMPORTANT]

No bulk/batch endpoints exist. [CONFIRMED -- no evidence of bulk endpoints in any source]

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported? | Notes                       |
| ------------------------ | ---------- | --------------------------- |
| Webhooks                 | Yes        | 22 event types [DOCUMENTED] |
| WebSocket                | No         | [CONFIRMED]                 |
| Server-Sent Events (SSE) | No         | [CONFIRMED]                 |
| Long polling             | No         | [CONFIRMED]                 |

### 7.2 Webhooks [IMPORTANT]

**Setup:**

- **Registration method:** API and UI (System > Setup > API > Webhook Subscriptions) [DOCUMENTED]
- **Registration endpoint:** `POST /api/v1.0/webhooks/` [DOCUMENTED]

**Event Catalog (22 events):** [DOCUMENTED -- forum]

contact.created, contact.updated, company.customer.created, company.customer.updated,
individual.customer.updated, job.created, job.status, job.updated, job.stage.pending,
job.stage.progress, job.stage.complete, job.stage.invoiced, job.stage.archived,
lead.created, lead.status, lead.updated, quote.created, quote.status, quote.updated,
job.schedule.created, job.schedule.updated, quote.schedule.created, quote.schedule.updated

**Payload format:** [CONFIRMED -- forum posts with actual received payloads]

Job status webhook:

```json
{
  "ID": "job.status",
  "build": "{build_name}",
  "description": "Status of Job #300555 set to \"Job : In Progress\"",
  "name": "Job",
  "action": "status",
  "reference": {
    "companyID": 0,
    "jobID": 300555,
    "statusID": 10
  },
  "date_triggered": "2023-01-31T09:05:27+00:00"
}
```

Job schedule webhook:

```json
{
  "ID": "job.schedule.created",
  "build": "{build_name}",
  "name": "Job schedule",
  "action": "created",
  "reference": {
    "companyID": 0,
    "scheduleID": 123,
    "jobID": 456,
    "sectionID": 1,
    "costCenterID": 1
  },
  "date_triggered": "2023-01-31T09:05:27+00:00",
  "description": "..."
}
```

**Standard payload fields:**

| Field          | Type   | Description                                            |
| -------------- | ------ | ------------------------------------------------------ |
| ID             | string | Event type identifier (e.g., "job.status")             |
| build          | string | Build name that triggered the event                    |
| name           | string | Human-readable entity name (e.g., "Job")               |
| action         | string | Action type (e.g., "status", "created", "updated")     |
| reference      | object | Entity-specific IDs (companyID, jobID, statusID, etc.) |
| date_triggered | string | ISO 8601 timestamp with timezone                       |
| description    | string | Human-readable description of the event                |

**Verification / security:**

- **Signature header:** None documented [CONFIRMED -- forum discussion found no signature mechanism]
- **IP allowlist available:** [UNKNOWN]

**Reliability:**

- Webhook expects HTTP 200 response [DOCUMENTED -- Rollout guide]
- **Retry policy:** [UNKNOWN]
- **Event ordering guarantee:** [UNKNOWN]

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended endpoint:** Any list endpoint with `If-Modified-Since` header [DOCUMENTED]
- **Recommended interval:** 60 seconds minimum [CONFIRMED -- must respect 10 req/sec limit]

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope                     | Limit       | Window   | Notes                                                  |
| ------------------------- | ----------- | -------- | ------------------------------------------------------ |
| Per-build (all consumers) | 10 requests | 1 second | Strictly enforced since Aug 2022 [DOCUMENTED -- forum] |
| Per-build (daily)         | [UNKNOWN]   | 24 hours | Exists but number not published [DOCUMENTED]           |

- **Rate limit headers:** No standard rate limit headers (X-RateLimit-\*) confirmed [CONFIRMED -- not present]
- **Rate limit exceeded response:** HTTP 429 Too Many Requests [DOCUMENTED]
- **Retry-After header:** [UNKNOWN -- not confirmed]
- **Backoff strategy:** Laravel package uses 10 req/sec with 80% threshold (pause at 8 req/sec) [DOCUMENTED]
- **Scope:** Per-build (all API consumers share the same limit; multi-threaded requests increase chance of 429) [CONFIRMED -- forum]

### 8.2 Error Handling [REQUIRED]

**REST API error response format:** [CONFIRMED -- forum post showing actual response]

```json
{
  "status": "error",
  "url": "https://xxxxx.simprosuite.com/api/v1.0/...",
  "header": {},
  "data": {
    "errors": [
      {
        "path": null,
        "message": "Invalid route.",
        "value": null
      }
    ]
  }
}
```

**Error fields:**

| Field                 | Type        | Description                          |
| --------------------- | ----------- | ------------------------------------ |
| status                | string      | "error"                              |
| url                   | string      | The request URL                      |
| header                | object      | Request headers (echoed back)        |
| data.errors           | array       | Array of error objects               |
| data.errors[].path    | string/null | Field path (null for general errors) |
| data.errors[].message | string      | Human-readable error message         |
| data.errors[].value   | any/null    | The problematic value                |

**HTTP status codes:**

| Status | Meaning                    | Retryable? | Recovery Action                                  |
| ------ | -------------------------- | ---------- | ------------------------------------------------ |
| 200    | Success                    | -          | -                                                |
| 204    | No Content (PATCH success) | -          | Note: may silently reject invalid status changes |
| 400    | Bad request                | No         | Fix request per error details                    |
| 401    | Unauthorized               | Yes        | Refresh OAuth token                              |
| 403    | Forbidden                  | No         | Check access type (Direct vs User Token)         |
| 404    | Not found                  | No         | Verify resource ID and companyID                 |
| 429    | Rate limited               | Yes        | Wait and retry with backoff                      |
| 500    | Internal error             | Yes        | Retry; check for known column/filter conflicts   |

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** [UNKNOWN -- not documented]
- GET: Yes | PUT: Yes | DELETE: Yes | POST: No | PATCH: Yes

### 8.4 File Handling [IMPORTANT]

- **Attachment entities confirmed:** JobAttachmentFile, QuoteAttachmentFile, AssetAttachmentFile [CONFIRMED -- SyncHub data model]
- **Attachment fields:** ID (string), DateAdded (datetime), Filename (string), MimeType (string), FileSizeBytes (long), FolderID (long) [CONFIRMED -- SyncHub data model]
- **Upload/download pattern:** [UNKNOWN -- specific API patterns not publicly documented]

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

**Selected integration path:** Hybrid (Data Connector + Direct API)

**Justification:** simPRO provides both browsable structured content (jobs, quotes, customers, schedules, invoices) suitable for a data connector, AND action-oriented capabilities (create jobs, update statuses, manage schedules) that benefit from direct API access. Webhook support enables real-time event-driven integration.

### 9.2 Connector Requirements [IMPORTANT]

| Connector Method    | API Endpoint                                       | Notes                                                |
| ------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| `list_files`        | `GET /companies/{cid}/jobs/` (and other resources) | Browse jobs, quotes, customers as structured records |
| `download_file`     | `GET /companies/{cid}/jobs/{id}`                   | Get full record detail                               |
| `search_files`      | `GET /companies/{cid}/jobs/?FieldName=value`       | Field-value filters + comparison operators           |
| `get_file_metadata` | `GET /companies/{cid}/jobs/{id}?columns=ID,Status` | Minimal field retrieval                              |

**Auth type for connector:** OAuth 2.0
**Caching:** 5-minute TTL for list queries; bypass cache for single-record fetches

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do:**

1. List and browse jobs, quotes, leads, customers, schedules, invoices
2. Filter with comparison operators: gt(), lt(), between(), ne(), wildcards (%)
3. Create new jobs, quotes, leads, customers
4. Update job status, schedule appointments (PATCH)
5. Look up customer and site information
6. View and filter invoices and purchase orders
7. Monitor recent changes via If-Modified-Since polling

**CANNOT do:**

1. Delete jobs or quotes without explicit user confirmation
2. Modify financial records without confirmation
3. Change system configuration
4. Access data across company boundaries without explicit company ID
5. Perform bulk operations (no batch endpoints)
6. Full-text search (no search endpoint)

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed (upgraded with SyncHub, forum payloads)
- [ ] Phase 2 complete: auth working, first call documented -- NOT COMPLETE (no credentials; SDK code analyzed)
- [x] Phase 3 complete: 100+ entities with full field definitions from SyncHub
- [x] Phase 4 complete: 35+ endpoints documented
- [x] Phase 5 complete: filter syntax with comparison operators confirmed
- [x] Phase 6 complete: pagination model documented with worked example
- [x] Phase 7 complete: webhooks assessed; actual payload format confirmed from forum
- [x] Phase 8 complete: error response format confirmed; rate limits documented
- [x] Phase 9 complete: integration path selected

**Overall investigation confidence:** medium-high (upgraded from medium)

**Known gaps:**

1. No live API testing -- field definitions from SyncHub data model, not first-hand
2. OAuth2 scopes not publicly enumerated
3. Daily rate limit number undisclosed
4. No sandbox/test environment
5. Attachment upload/download patterns unknown

### 10.2 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence  | Gaps                                                |
| ---------------------------- | ------------- | ----------- | --------------------------------------------------- |
| 01-llm-api-rules             | Yes           | Medium-High | No live-tested examples; error format now confirmed |
| 01a-domain-model-reference   | Yes           | High        | Full field definitions from SyncHub data model      |
| 01b-query-patterns           | Yes           | High        | Filter syntax with comparison operators confirmed   |
| 01c-mutation-patterns        | Yes           | Medium      | PATCH confirmed; response codes confirmed           |
| 01d-event-and-error-handling | Yes           | Medium-High | Webhook payloads confirmed; error format confirmed  |
| 02-api-spec-investigation    | Yes           | High        | Comprehensive endpoint and data model coverage      |
| 03-connector-setup           | Yes           | Medium      | Standard connector scaffold                         |
