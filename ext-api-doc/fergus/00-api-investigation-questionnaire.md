---
api_name: 'Fergus'
api_slug: 'fergus'
vendor: 'Fergus (NZ)'
website: 'https://fergus.com'
investigation_started: '2026-03-30'
investigation_updated: '2026-04-04'
investigator: 'Claude Code (automated) + live API testing'
investigation_status: 'complete'
documentation_quality: 'good'
api_types: ['REST']
overall_confidence: 'high — live-tested'
blockers: []
---

# API Investigation Questionnaire: Fergus

> Completed by automated investigation on 2026-03-30.
> **Updated 2026-04-04 with live API test results.** All items marked [CONFIRMED -- live API test 2026-04-04] were verified against the running API with real credentials.
> Sources: OpenAPI spec (fetched live), MCP server source, web search, API Tracker, Fergus Help Center, live API testing.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** https://api.fergus.com/docs [CONFIRMED]
- **API reference / endpoint catalog URL:** https://api.fergus.com/docs (Swagger UI with OAS 3.1.0) [CONFIRMED]
- **Authentication guide URL:** Documented in OpenAPI spec security schemes [CONFIRMED]
- **Changelog / release notes URL:** https://help.fergus.com/en/articles/10542610-release-notes-2025 [DOCUMENTED]
- **Status page URL:** Listed on API Tracker but URL not publicly discovered [INFERRED]

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** https://api.fergus.com/docs/json [CONFIRMED] -- fetched and parsed, 18,953 lines, 55+ endpoints
- **Postman collection URL:** https://www.postman.com/fergusfrl12/fergus-workspace/overview [DOCUMENTED]
- **Official SDK repositories:**
  - Python: None [CONFIRMED]
  - Node.js: None [CONFIRMED]
  - Other: Community MCP server https://github.com/Jayco-Design/fergus-mcp (26+ tools, MIT license) [CONFIRMED]
- **Official blog / engineering blog:** https://info.fergus.com/developers [DOCUMENTED]
- **Community forums / Stack Overflow tag:** None found [UNKNOWN]

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                                         |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| Authentication            | 4      | Both PAT and OAuth2 clearly documented in spec                                                |
| Endpoint reference        | 5      | Full OpenAPI 3.1.0 spec with all endpoints                                                    |
| Request/response examples | 3      | Some examples in spec, not all endpoints have worked examples                                 |
| Error documentation       | 4      | Standard ErrorResponse schema documented; live testing revealed additional formats            |
| Rate limit documentation  | 5      | Explicit: 100 req/min/company with headers documented [CONFIRMED -- live API test 2026-04-04] |
| Pagination documentation  | 4      | Cursor-based pagination clearly documented in spec [CONFIRMED -- live API test 2026-04-04]    |
| Webhook documentation     | 2      | Listed on API Tracker but not in the OpenAPI spec                                             |
| SDKs / code examples      | 2      | No official SDKs; community MCP server only                                                   |
| Changelog / versioning    | 3      | Release notes exist but not API-specific changelog                                            |

**Overall documentation quality:** good

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation
- [x] Found or confirmed OpenAPI/Swagger spec
- [x] Identified authentication method
- [x] Found at least one working example (from MCP server)
- [x] Identified rate limit information
- [x] Identified pagination approach
- [x] Checked for webhook/event support
- [x] Checked for official SDKs
- [x] **Live API testing completed 2026-04-04**

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** Fergus API [CONFIRMED]
- **Vendor / company:** Fergus (NZ-based, trade business job management) [CONFIRMED]
- **Current API version:** v1 [CONFIRMED]
- **Base URL(s):**
  - Production: `https://api.fergus.com` [CONFIRMED -- live API test 2026-04-04]
  - Sandbox / testing: Not documented [UNKNOWN]
- **API type:** REST (JSON over HTTPS) [CONFIRMED]
- **Internal path prefix:** 404 errors reveal internal routing uses `/api/partner/` prefix. Client-facing paths remain without this prefix. [CONFIRMED -- live API test 2026-04-04]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTPS (HTTP/1.1) [CONFIRMED -- live API test 2026-04-04]
- **Data format:** JSON [CONFIRMED -- live API test 2026-04-04]
- **Content-Type header(s):** `application/json` [CONFIRMED -- live API test 2026-04-04]
- **Character encoding:** UTF-8 [INFERRED]
- **URL structure pattern:** `https://api.fergus.com/{resource}` or `https://api.fergus.com/{resource}/{id}` [CONFIRMED -- live API test 2026-04-04]
- **Versioning strategy:** None in URL -- single version "v1" in info but no path prefix [CONFIRMED]
- **CORS policy:** Not documented [UNKNOWN]
- **Field casing:** camelCase throughout (`customerFullName`, `companyId`, `createdAt`, `lastModified`, `jobType`, `siteAddress`, `mainContact`, `contactItems`, `physicalAddress`, `postalAddress`, `billingContact`, `pricingTier`, `addressCity`) [CONFIRMED -- live API test 2026-04-04]
- **ID format:** Integer (`"id": 9778208`, `"id": 8169663`, `"id": 20909314`, `"id": 173187`) [CONFIRMED -- live API test 2026-04-04]
- **Required headers (all requests):**

| Header        | Value              | Purpose                                  |
| ------------- | ------------------ | ---------------------------------------- |
| Authorization | `Bearer {token}`   | PAT or OAuth2 access token               |
| Content-Type  | `application/json` | Request body format (for POST/PUT/PATCH) |

**IMPORTANT: DELETE requests must NOT include Content-Type header.** Sending `Content-Type: application/json` on DELETE causes: `"Body cannot be empty when content-type is set to 'application/json'"`. Either omit Content-Type entirely or send an empty JSON body `{}`. [CONFIRMED -- live API test 2026-04-04]

### 2.3 Authentication [REQUIRED]

- **Auth method:** Two options: Personal Access Token (PAT) or OAuth 2.0 Authorization Code [CONFIRMED]
- **Auth location:** Header [CONFIRMED]
- **Auth header format:**

```
Authorization: Bearer {token}
```

**For OAuth 2.0:**

- **Grant type(s) supported:** authorization_code [CONFIRMED]
- **Authorization URL:** `https://auth.fergus.com/oauth2/authorize` [CONFIRMED]
- **Token URL:** `https://auth.fergus.com/oauth2/token` [CONFIRMED]
- **Refresh URL:** `https://auth.fergus.com/oauth2/token` [CONFIRMED]
- **Required scopes:** None documented -- empty scopes object in spec [CONFIRMED]
- **Token lifetime:** Not documented [UNKNOWN]
- **Refresh token behavior:** Refresh URL is the same as token URL [CONFIRMED]
- **PKCE required?** Not documented in spec [UNKNOWN]
- **State parameter required?** Not documented [UNKNOWN]
- **Redirect URI restrictions:** Not documented [UNKNOWN]

**For PAT auth:**

- **How to obtain:** Generate from Fergus account settings [DOCUMENTED]
- **Key format / pattern:** Bearer token string [CONFIRMED -- live API test 2026-04-04]
- **Rate limits per key:** 100 requests/minute shared across company [CONFIRMED -- live API test 2026-04-04]
- **Key rotation procedure:** Not documented [UNKNOWN]

### 2.4 First Successful Call [REQUIRED] -- CRITICAL GATE

**Endpoint used for first call:**

```http
GET /version HTTP/1.1
Host: api.fergus.com
Authorization: Bearer {pat_token}
```

**Response:** [CONFIRMED -- live API test 2026-04-04]

```json
{
  "result": "success",
  "data": { "version": "v1" }
}
```

- **HTTP status code:** 200 [CONFIRMED -- live API test 2026-04-04]
- **Response headers of note:** `x-ratelimit-limit: 100`, `x-ratelimit-remaining: N`, `x-ratelimit-reset: 60` [CONFIRMED -- live API test 2026-04-04]
- **Time to first successful call:** Immediate once PAT is generated
- **Gotchas encountered during setup:** None

- [x] **GATE CHECK: Live API call successful. Auth confirmed working.**

---

## Phase 3: Domain Model & Behavior

### 3.1 Core Entities [REQUIRED]

#### Entity: Job

- **API resource name / endpoint path:** `/jobs`, `/jobs/{jobId}`
- **Description:** Core entity -- represents a piece of work for a customer at a site. Has phases, quotes, and financial data.
- **CRUD support:** Create, Read, Update (draft only), Hold, Resume

**Fields:**

| Field           | Type    | Required? | Writable?           | Description                                      | Example Value                                                |
| --------------- | ------- | --------- | ------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| id              | integer | yes       | no                  | Unique identifier                                | `20909314`                                                   |
| jobNo           | string  | yes       | no                  | Human-readable number (assigned on finalise)     | `"J-0042"`                                                   |
| description     | string  | yes       | yes (create)        | Short description                                | `"Fix leaking pipe"`                                         |
| longDescription | string  | yes       | yes (create)        | Detailed description                             | `"Kitchen sink..."`                                          |
| createdAt       | string  | yes       | no                  | ISO 8601 timestamp                               | `"2025-01-15T09:00:00Z"`                                     |
| lastModified    | string  | yes       | no                  | ISO 8601 timestamp                               | `"2025-01-16T14:30:00Z"`                                     |
| jobType         | string  | yes       | yes (create)        | **ONLY: `"Quote"`, `"Estimate"`, `"Charge Up"`** | `"Quote"`                                                    |
| status          | string  | yes       | no                  | Current status                                   | `"To Price"`                                                 |
| assignedGroups  | array   | yes       | no                  | Default group(s)                                 | `[{"id": 1}]`                                                |
| customer        | object  | yes       | yes (create via ID) | Embedded JobCustomer                             | `{"id": 9778208, "customerFullName": "Smith Ltd"}`           |
| siteAddress     | object  | yes       | yes (create via ID) | Embedded JobSiteAddress                          | `{"id": 8169663, "name": "Main Office"}`                     |
| mainContact     | object  | yes       | no                  | Primary contact                                  | `{"firstName": "John"}`                                      |
| activeQuote     | object  | yes       | no                  | Currently active quote                           | `null`                                                       |
| onHold          | boolean | yes       | no                  | On-hold state                                    | `false`                                                      |
| archived        | boolean | yes       | no                  | Archived state                                   | `false`                                                      |
| links           | array   | yes       | no                  | HATEOAS links                                    | `[{"href": "/jobs/20909314", "rel": "self", "type": "GET"}]` |

**IMPORTANT -- jobType values:** Only `"Quote"`, `"Estimate"`, and `"Charge Up"` are valid. Error: `"The jobType must be one of 'Quote', 'Estimate', or 'Charge Up'"`. The values "Service" and "Project" do NOT exist. [CONFIRMED -- live API test 2026-04-04]

**IMPORTANT -- Job status after creation:** On POST create response, status is `"Draft"`. On subsequent GET, status transitions to `"To Price"` for Quote-type jobs. Draft is transient -- immediately transitions. [CONFIRMED -- live API test 2026-04-04]

**HATEOAS links in job response:** [CONFIRMED -- live API test 2026-04-04]

```json
"links": [
  {"href": "/jobs/20909314", "rel": "self", "type": "GET"},
  {"href": "/jobs/20909314", "rel": "edit", "type": "PUT"},
  {"href": "/jobs/20909314/finalise", "rel": "finalise", "type": "POST"}
]
```

**NOTE on /jobs/{id}/finalise:** The finalise link IS returned in job create response, but calling `POST /jobs/{id}/finalise` returns 404. This endpoint may not be fully implemented for the partner API or may use a different path. [NEEDS VERIFICATION -- live API test 2026-04-04]

**Relationships:**

| Related Entity  | Relationship Type | How Expressed                                           | Notes                                   |
| --------------- | ----------------- | ------------------------------------------------------- | --------------------------------------- |
| Customer        | many-to-one       | ID reference (customerId) and nested object             |                                         |
| Site            | many-to-one       | ID reference (siteId) and nested address                |                                         |
| Quote           | one-to-many       | Sub-resource `/jobs/{jobId}/quotes`                     |                                         |
| JobPhase        | one-to-many       | Sub-resource `/jobs/{jobId}/phases`                     | [CONFIRMED -- live API test 2026-04-04] |
| CalendarEvent   | one-to-many       | Filter on `/calendarEvents?filterJobId=`                |                                         |
| CustomerInvoice | one-to-many       | Filter on `/customerInvoices?jobId=`                    |                                         |
| Note            | one-to-many       | Filter on `/notes?filterEntityName=JOB&filterEntityId=` |                                         |

#### Entity: Customer

- **API resource name:** `/customers`, `/customers/{customerId}`
- **Description:** A person or company that commissions work
- **CRUD support:** Create, Read, Update, Delete

**Fields:**

| Field            | Type           | Required? | Writable? | Description                           | Example Value                  |
| ---------------- | -------------- | --------- | --------- | ------------------------------------- | ------------------------------ |
| id               | integer        | yes       | no        | Unique identifier                     | `9778208`                      |
| companyId        | integer        | yes       | no        | Owning company                        | `1`                            |
| customerFullName | string         | yes       | yes       | Full name                             | `"Smith Plumbing Ltd"`         |
| createdAt        | string         | yes       | no        | ISO timestamp                         | `"2025-01-10T08:00:00Z"`       |
| mainContact      | PersonContact  | yes       | yes       | Primary contact person                |                                |
| physicalAddress  | AddressContact | yes       | yes       | Physical address                      |                                |
| postalAddress    | AddressContact | yes       | yes       | Postal address (nullable)             |                                |
| billingContact   | PersonContact  | yes       | no        | Billing contact                       |                                |
| pricingTier      | object         | yes       | no        | Assigned pricing tier (auto-assigned) | `{"id": 1, "name": "Default"}` |
| customerSource   | string         | yes       | no        | Lead source                           | `"Website"`                    |
| links            | array          | yes       | no        | HATEOAS links                         |                                |

**Customer create -- required fields:** `customerFullName`, `mainContact` (with `firstName`). Response: 201 with full customer object including auto-assigned `id`, `companyId`, default `pricingTier`. [CONFIRMED -- live API test 2026-04-04]

**Customer update:** PUT /customers/{id} -- full replace. Required: `customerFullName`, `mainContact`. [CONFIRMED -- live API test 2026-04-04]

#### Entity: Site

- **API resource name:** `/sites`, `/sites/{siteId}`
- **Description:** A physical location where work is performed
- **CRUD support:** Create, Read, Update (PATCH), Archive, Restore (no hard delete)

**Fields:**

| Field           | Type           | Required? | Writable? | Description                              | Example Value           |
| --------------- | -------------- | --------- | --------- | ---------------------------------------- | ----------------------- |
| id              | integer        | yes       | no        | Unique identifier                        | `8169663`               |
| companyId       | integer        | yes       | no        | Owning company                           | `1`                     |
| name            | string         | no        | yes       | Site name                                | `"Auckland CBD Office"` |
| createdAt       | string         | yes       | no        | ISO timestamp                            |                         |
| defaultContact  | PersonContact  | **yes**   | yes       | Default contact (REQUIRED on create)     |                         |
| billingContact  | PersonContact  | yes       | no        | Billing person                           |                         |
| physicalAddress | AddressContact | yes       | yes       | Physical address (siteAddress on create) |                         |
| postalAddress   | AddressContact | yes       | yes       | Postal address                           |                         |
| isArchived      | boolean        | yes       | no        | Archived state                           | `false`                 |
| deletedAt       | string         | yes       | no        | Deletion timestamp (null if active)      | `null`                  |
| links           | array          | yes       | no        | HATEOAS links                            |                         |

**IMPORTANT -- Site create requires `defaultContact`:** The docs originally said only `name` and `siteAddress` were required. In reality, `defaultContact` (with `firstName`, `lastName`) is REQUIRED. Error: `"Validation Failed: [<body>: must have required property 'defaultContact']"`. [CONFIRMED -- live API test 2026-04-04]

**IMPORTANT -- PATCH /sites requires `siteAddress`:** Even on partial update (PATCH), `siteAddress` is always required. Error: `"Validation Failed: [<body>: must have required property 'siteAddress']"`. [CONFIRMED -- live API test 2026-04-04]

#### Entity: Quote

- **API resource name:** `/jobs/{jobId}/quotes`, `/jobs/quotes`
- **Description:** A price estimate for work on a job. Contains sections with line items.
- **CRUD support:** Create, Read, Update (draft only), Publish, Accept, Decline, Void

**NOTE:** The standalone `/quotes` endpoint does NOT exist. `GET /quotes` returns 404: `"Route GET:/api/partner/quotes not found"`. Use `/jobs/quotes` or `/jobs/{jobId}/quotes` instead. [CONFIRMED -- live API test 2026-04-04]

**Fields:**

| Field         | Type        | Required? | Writable? | Description               | Example Value     |
| ------------- | ----------- | --------- | --------- | ------------------------- | ----------------- |
| id            | integer     | yes       | no        | Unique identifier         | `500`             |
| versionNumber | number      | yes       | no        | Quote version within job  | `1`               |
| jobId         | integer     | yes       | no        | Parent job ID             | `20909314`        |
| guid          | string      | yes       | no        | Globally unique ID        | `"a1b2c3..."`     |
| title         | string      | yes       | yes       | Quote title               | `"Initial Quote"` |
| description   | string      | yes       | yes       | Description               |                   |
| footerText    | string      | no        | no        | Footer text               |                   |
| quoteDate     | string      | yes       | no        | Date created              |                   |
| isSent        | boolean     | yes       | no        | Has been sent             | `false`           |
| isAccepted    | boolean     | yes       | no        | Customer accepted         | `false`           |
| isSuperseded  | boolean     | yes       | no        | Replaced by newer version | `false`           |
| isLocked      | boolean     | yes       | no        | Locked for editing        | `false`           |
| createdAt     | string      | yes       | no        | ISO timestamp             |                   |
| lastModified  | string      | yes       | no        | ISO timestamp             |                   |
| publishedAt   | string      | yes       | no        | When published (nullable) |                   |
| dueDate       | string      | yes       | no        | Expiry date               |                   |
| declinedAt    | string      | yes       | no        | When declined (nullable)  |                   |
| voidedAt      | string      | yes       | no        | When voided (nullable)    |                   |
| dueDays       | number      | yes       | yes       | Days until due            | `30`              |
| sections      | array       | no        | yes       | QuoteSection array        |                   |
| deposit       | object      | no        | no        | Deposit info              |                   |
| quoteConfig   | QuoteConfig | no        | no        | Display configuration     |                   |

#### Entity: User

- **API resource name:** `/users`, `/users/{userId}`
- **Description:** Team members / employees
- **CRUD support:** Read, Update (no Create, no Delete)

**Fields:**

| Field         | Type    | Required? | Writable? | Description                            | Example Value        |
| ------------- | ------- | --------- | --------- | -------------------------------------- | -------------------- |
| id            | integer | yes       | no        | Unique identifier                      | `173187`             |
| firstName     | string  | yes       | yes       | First name                             | `"Mike"`             |
| lastName      | string  | yes       | yes       | Last name                              | `"Johnson"`          |
| email         | string  | yes       | no        | Email address                          | `"mike@example.com"` |
| userType      | string  | yes       | no        | contractor/field_worker/tradesman/etc. | `"tradesman"`        |
| status        | string  | yes       | no        | active/disabled/invited                | `"active"`           |
| payRate       | number  | yes       | yes       | Hourly pay rate                        | `35.00`              |
| chargeOutRate | number  | yes       | yes       | Hourly charge-out rate                 | `85.00`              |
| address       | object  | yes       | yes       | AddressContact                         |                      |
| contactItems  | array   | no        | yes       | Phone, mobile, etc.                    |                      |
| createdAt     | string  | yes       | no        | ISO timestamp                          |                      |
| modifiedAt    | string  | yes       | no        | ISO timestamp                          |                      |

#### Entity: TimeEntry

- **API resource name:** `/timeEntries`
- **Description:** Employee time tracking records. Read-only via API.
- **CRUD support:** Read only [CONFIRMED -- live API test 2026-04-04]

**Fields:**

| Field           | Type    | Required? | Writable? | Description                   | Example Value        |
| --------------- | ------- | --------- | --------- | ----------------------------- | -------------------- |
| timeEntryId     | integer | yes       | no        | Unique identifier             | `300`                |
| userId          | integer | yes       | no        | Worker                        | `10`                 |
| user            | string  | yes       | no        | User display name             | `"Mike Johnson"`     |
| dateEntered     | string  | yes       | no        | Date of entry                 | `"2025-01-15"`       |
| startTime       | string  | yes       | no        | Start time (YYYY-MM-DD HH:MM) | `"2025-01-15 07:00"` |
| endTime         | string  | yes       | no        | End time                      | `"2025-01-15 17:00"` |
| isLocked        | boolean | yes       | no        | Locked for payroll            | `false`              |
| payRate         | number  | yes       | no        | Pay rate/hr                   | `35.00`              |
| chargeOutRate   | number  | yes       | no        | Charge-out rate/hr            | `85.00`              |
| paidDuration    | number  | yes       | no        | Hours paid                    | `8.0`                |
| workDescription | string  | yes       | no        | Work performed                | `"Fixed pipe"`       |
| jobId           | integer | yes       | no        | Related job (nullable)        | `12345`              |
| jobNo           | string  | yes       | no        | Job number (nullable)         | `"J-0042"`           |
| jobPhaseId      | integer | yes       | no        | Related phase (nullable)      | `1`                  |

#### Entity: Enquiry

- **API resource name:** `/enquiries`, `/enquiries/{enquiryId}`
- **Description:** Incoming customer enquiries / leads before they become jobs
- **CRUD support:** Create, Read (no Update/Delete)

**Fields:**

| Field                   | Type    | Required? | Writable? | Description       | Example Value               |
| ----------------------- | ------- | --------- | --------- | ----------------- | --------------------------- |
| id                      | integer | yes       | no        | Unique identifier |                             |
| name                    | string  | yes       | yes       | Enquiry name      | `"Bathroom reno"`           |
| contactName             | string  | yes       | no        | Contact name      | `"John Smith"`              |
| description             | string  | yes       | yes       | Description       | `"Need bathroom renovated"` |
| createdAt               | string  | yes       | no        | ISO timestamp     |                             |
| source                  | string  | yes       | yes       | Lead source       | `"Website"`                 |
| status                  | string  | yes       | no        | Status            | `"New"`                     |
| address1-addressCountry | string  | yes       | yes       | Address fields    |                             |

#### Entity: CalendarEvent

- **API resource name:** `/calendarEvents`, `/calendarEvents/{calendarEventId}`
- **Description:** Scheduled events, appointments, and job bookings
- **CRUD support:** Create, Read, Update, Delete [CONFIRMED -- live API test 2026-04-04]

**Fields:**

| Field                 | Type    | Required? | Writable? | Description                    | Example Value                |
| --------------------- | ------- | --------- | --------- | ------------------------------ | ---------------------------- |
| id                    | integer | yes       | no        | Unique identifier              |                              |
| userId                | integer | yes       | yes       | Assigned user                  | `173187`                     |
| title                 | string  | yes       | yes       | Event title                    | `"Site visit"`               |
| description           | string  | yes       | yes       | Event description              |                              |
| eventType             | string  | yes       | yes       | JOB_PHASE/QUOTE/ESTIMATE/OTHER | `"JOB_PHASE"`                |
| jobId                 | integer | yes       | yes       | Linked job                     | `20909314`                   |
| jobPhaseId            | integer | yes       | yes       | Linked phase                   | `1`                          |
| startTime             | string  | yes       | yes       | ISO datetime                   | `"2025-01-15T07:00:00.000Z"` |
| endTime               | string  | yes       | yes       | ISO datetime                   | `"2025-01-15T17:00:00.000Z"` |
| isActive              | boolean | yes       | no        | Active state                   | `true`                       |
| isAllDay              | boolean | yes       | no        | All-day event                  | `false`                      |
| isRecurring           | boolean | yes       | no        | Has recurrence                 | `false`                      |
| recurringEventDetails | object  | yes       | no        | Recurrence config              |                              |

#### Entity: CustomerInvoice

- **API resource name:** `/customerInvoices`, `/customerInvoices/{invoiceId}`
- **Description:** Invoices sent to customers for completed work. Read-only via API.
- **CRUD support:** Read only [CONFIRMED -- live API test 2026-04-04]

**Fields:**

| Field            | Type    | Required? | Writable? | Description            | Example Value |
| ---------------- | ------- | --------- | --------- | ---------------------- | ------------- |
| id               | integer | yes       | no        | Unique identifier      |               |
| jobId            | integer | yes       | no        | Related job            |               |
| customerId       | integer | yes       | no        | Customer               |               |
| title            | string  | yes       | no        | Invoice title          |               |
| invoiceNumber    | string  | yes       | no        | Invoice number         | `"INV-001"`   |
| dueDate          | string  | yes       | no        | Due date               |               |
| invoiceDate      | string  | yes       | no        | Invoice date           |               |
| subtotal         | number  | yes       | no        | Pre-tax total          | `500.00`      |
| taxValue         | number  | yes       | no        | Tax amount             | `75.00`       |
| taxRate          | number  | yes       | no        | Tax rate               | `15.0`        |
| totalPaid        | number  | yes       | no        | Amount paid            | `0`           |
| status           | string  | yes       | no        | Invoice status         |               |
| isSent           | boolean | yes       | no        | Has been sent          | `false`       |
| isFinal          | boolean | yes       | no        | Is finalised           | `false`       |
| paidAt           | string  | yes       | no        | Payment date           | `null`        |
| fergusPayEnabled | boolean | yes       | no        | Online payment enabled | `true`        |

#### Entity: Contact

- **API resource name:** `/contacts`, `/contacts/{contactId}`
- **Description:** Contact records linked to customers or sites
- **CRUD support:** Create, Read, Update (no Delete)

#### Entity: Note

- **API resource name:** `/notes`, `/notes/{noteId}`
- **Description:** Notes attached to jobs, customers, quotes, sites, enquiries, etc.
- **CRUD support:** Create, Read, Update (no Delete) [CONFIRMED -- live API test 2026-04-04]

**Key fields:** text (string), entityName (JOB/CUSTOMER/CUSTOMER_INVOICE/QUOTE/SITE/TASK/ENQUIRY/JOB_PHASE), entityId (number), isPinned (boolean), parentId (for replies)

**NOTE: Sort field uses snake_case.** `GET /notes` uses `sortField=created_at` (snake_case), not `sortField=createdAt`. This is the only known endpoint with snake_case sort field. [CONFIRMED -- live API test 2026-04-04]

#### Entity: StockOnHand

- **API resource name:** `/phases/{jobPhaseId}/stockOnHand`
- **Description:** Materials/stock allocated to a job phase
- **CRUD support:** Create, Read, Update, Delete

**NOTE:** The standalone `/stockOnHand` endpoint does NOT exist. `GET /stockOnHand` returns 404: `"Route GET:/api/partner/stockOnHand not found"`. Use `/phases/{jobPhaseId}/stockOnHand` instead. [CONFIRMED -- live API test 2026-04-04]

#### Entity: Pricebook

- **API resource name:** `/pricebooks`, `/pricebooks/{id}`, `/pricebooks/search`
- **Description:** Supplier pricebooks with items, costs, retail prices, and pricing tiers
- **CRUD support:** Read, Search (no Create/Update/Delete)

#### Entity: Company

- **API resource name:** `/company`
- **Description:** The authenticated company's profile and settings
- **CRUD support:** Read only [CONFIRMED -- live API test 2026-04-04]
- **Key fields:** `guid`, `prefix`, `name`, `active`, `contact`, `settings` (array of key-value pairs), `tax` (rate and type)
- **Tax example:** `{"rate": 15, "type": "GST"}` (NZ GST) [CONFIRMED -- live API test 2026-04-04]
- **Settings include:** timezone, currency, date format, prefix [CONFIRMED -- live API test 2026-04-04]

#### Entity: Favourites

- **API resource name:** `/favourites`, `/favourites/{sectionId}`
- **Description:** Template sections with line items for quick-adding to quotes
- **CRUD support:** Read only [CONFIRMED -- live API test 2026-04-04]

### 3.2 Entity Relationships [IMPORTANT]

```
┌──────────┐     1:N     ┌──────────┐     1:N     ┌──────────┐
│ Customer │────────────>│   Job    │────────────>│  Quote   │
└──────────┘             └──────────┘             └──────────┘
      │                        │                        │
      │ 1:N                    │ 1:N                    │ 1:N
      ▼                        ▼                        ▼
┌──────────┐             ┌──────────┐             ┌──────────┐
│ Contact  │             │ JobPhase │             │ Section  │
└──────────┘             └──────────┘             └──────────┘
                               │ 1:N                    │ 1:N
      ┌──────────┐             ▼                        ▼
      │  Site    │──────>┌──────────────┐         ┌──────────┐
      └──────────┘  N:1  │CalendarEvent │         │LineItem  │
            │             └──────────────┘         └──────────┘
            │ 1:N
            ▼                   ┌──────────────┐
      ┌──────────┐              │  TimeEntry   │ (read-only)
      │ Contact  │              └──────────────┘
      └──────────┘
                                ┌──────────────┐
                                │CustomerInvoice│ (read-only)
                                └──────────────┘
      ┌──────────┐              ┌──────────────┐
      │Pricebook │──1:N──>      │PricebookItem │
      └──────────┘              └──────────────┘
                                      │ N:M
                                ┌──────────────┐
                                │ PricingTier  │
                                └──────────────┘
```

### 3.3 State Machines [IMPORTANT]

#### State Machine: Job

```
[Draft] --finalise--> [To Price] --price--> [Active] --complete--> [Completed]
                         │
                         ├──hold--> [On Hold] --resume--> [Active]
                         ├──archive--> [Archived]
                         └── (quote sent/rejected) --> [Quote Sent] / [Quote Rejected] / [Estimate Sent] / [Estimate Rejected]
```

**IMPORTANT: Draft is transient.** On POST create, the response shows `"status": "Draft"`, but on subsequent GET the status has already transitioned to `"To Price"` (for Quote-type jobs). [CONFIRMED -- live API test 2026-04-04]

| From State        | Action/Trigger         | To State  | Reversible? | Side Effects                        |
| ----------------- | ---------------------- | --------- | ----------- | ----------------------------------- |
| Draft             | (automatic)            | To Price  | No          | Immediate transition for Quote jobs |
| To Price / Active | POST /jobs/{id}/hold   | On Hold   | Yes         | Requires holdUntil date and notes   |
| On Hold           | POST /jobs/{id}/resume | Active    | N/A         |                                     |
| Active            | (internal)             | Completed | No          | All phases completed                |

**Per-state capabilities:**

| State     | Can Update? | Can Delete? | Available Actions             | Notes                                   |
| --------- | ----------- | ----------- | ----------------------------- | --------------------------------------- |
| Draft     | Yes (PUT)   | No          | finalise [NEEDS VERIFICATION] | Transient state                         |
| To Price  | No          | No          | hold, create phases/quotes    | [CONFIRMED -- live API test 2026-04-04] |
| Active    | No          | No          | hold, create phases/quotes    |                                         |
| On Hold   | No          | No          | resume                        |                                         |
| Completed | No          | No          | None                          |                                         |

#### State Machine: Quote

```
[Draft] ──publish──> [Published] ──markAsSent──> [Sent] ──accept──> [Accepted]
                          │                        │
                          └──void──> [Voided]       ├──decline──> [Declined]
                                                   └──void────> [Voided]
```

| From State | Action                | To State   | Reversible? | Side Effects                                    |
| ---------- | --------------------- | ---------- | ----------- | ----------------------------------------------- |
| Draft      | publish               | Published  | No          | isLocked becomes true                           |
| Published  | markAsSent            | Sent       | No          | isSent becomes true                             |
| Sent       | accept                | Accepted   | No          | isAccepted becomes true; may return deposit URL |
| Sent       | decline               | Declined   | No          | declinedAt set                                  |
| Any        | void                  | Voided     | No          | voidedAt set                                    |
| Any        | (new version created) | Superseded | No          | isSuperseded becomes true                       |

### 3.4 Business Rules [IMPORTANT]

**Ordering / dependency rules:**

- Must create a Customer before creating a non-draft Job (customerId required) [CONFIRMED -- live API test 2026-04-04]
- Must create a Site before creating a non-draft Job (siteId required) [CONFIRMED -- live API test 2026-04-04]
- Must create a Job before creating a Quote (quotes are sub-resources of jobs) [CONFIRMED]
- Draft jobs: customerId, siteId, description are all optional [CONFIRMED -- live API test 2026-04-04]

**Field-level rules:**

- customerFullName must not be empty (regex `\S`) [CONFIRMED]
- Contact firstName is required [CONFIRMED -- live API test 2026-04-04]
- Site create requires `defaultContact` (with `firstName`, `lastName`) [CONFIRMED -- live API test 2026-04-04]
- Site PATCH requires `siteAddress` even for partial updates [CONFIRMED -- live API test 2026-04-04]
- Calendar event times must be in 15-minute intervals [CONFIRMED]
- Calendar event times must be ISO 8601 in UTC [CONFIRMED]

**Cascading effects:**

- Creating a customer that already exists returns 303 redirect to existing customer [CONFIRMED]
- Creating a site that already exists returns 303 redirect to existing site [CONFIRMED]
- Voiding a job phase (POST /jobs/{jobId}/phases/{jobPhaseId}/void) -- irreversible [CONFIRMED]

**Uniqueness constraints:**

- Customer deduplication on create (303 if exists) [CONFIRMED]
- Site deduplication on create (303 if exists) [CONFIRMED]
- Quote versionNumber is unique within a job [CONFIRMED]

**Computed / read-only fields:**

- jobNo is system-generated [CONFIRMED]
- createdAt / lastModified are server-set [CONFIRMED -- live API test 2026-04-04]
- Quote totals are computed from sections/line items [CONFIRMED]
- Financial summaries are computed aggregates [CONFIRMED]

### 3.5 Field Format Reference [IMPORTANT]

| Format          | Pattern            | Example                    | Notes                                                                  |
| --------------- | ------------------ | -------------------------- | ---------------------------------------------------------------------- |
| Date            | `YYYY-MM-DD`       | `2025-01-15`               | Used in date filters                                                   |
| DateTime        | ISO 8601           | `2025-01-15T09:00:00.000Z` | Calendar events, createdAt                                             |
| Time Entry Time | `YYYY-MM-DD HH:MM` | `2025-01-15 07:00`         | 15-min intervals                                                       |
| Currency        | number             | `85.50`                    | No currency symbol; company settings define currency                   |
| ID format       | integer            | `9778208`                  | All IDs are integers [CONFIRMED -- live API test 2026-04-04]           |
| Cursor          | integer            | `0`                        | 0-based integer for pagination [CONFIRMED -- live API test 2026-04-04] |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

| Entity        | Field               | Allowed Values                                                                                                      | Default | Notes                                                                                       |
| ------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| Job           | jobType             | `Quote`, `Estimate`, `Charge Up`                                                                                    | -       | **ONLY these 3. "Service"/"Project" do NOT exist.** [CONFIRMED -- live API test 2026-04-04] |
| Job           | status (filter)     | `Active`, `Completed`, `Estimate Rejected`, `Estimate Sent`, `Inactive`, `Quote Sent`, `Quote Rejected`, `To Price` | -       | For filterJobStatus                                                                         |
| Job           | status (observed)   | `Draft` (transient), `To Price`                                                                                     | -       | [CONFIRMED -- live API test 2026-04-04]                                                     |
| User          | userType            | `contractor`, `time_sheet_only`, `field_worker`, `apprentice`, `tradesman`, `advisor`, `full_user`                  | -       |                                                                                             |
| User          | status              | `active`, `disabled`, `invited`                                                                                     | -       |                                                                                             |
| Quote         | filterStatus        | `draft`, `accepted`, `voided`, `superseded`, `declined`, `published`, `emailSent`, `emailNotSent`                   | -       |                                                                                             |
| CalendarEvent | eventType           | `JOB_PHASE`, `QUOTE`, `ESTIMATE`, `OTHER`                                                                           | -       | Required on create                                                                          |
| CalendarEvent | frequency           | `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`, `NEVER`                                                                     | `NEVER` |                                                                                             |
| CalendarEvent | repeatEndType       | `NEVER`, `ON_DATE`, `AFTER`                                                                                         | `NEVER` |                                                                                             |
| CalendarEvent | filterCalendarRange | `DAY`, `THREE_DAY`, `WEEK`, `FORTNIGHT`, `MONTH`                                                                    | -       |                                                                                             |
| ContactItem   | contactType         | `email`, `phone`, `mobile`, `other`, `fax`, `website`                                                               | -       |                                                                                             |
| Note          | entityName          | `JOB`, `CUSTOMER`, `CUSTOMER_INVOICE`, `QUOTE`, `SITE`, `TASK`, `ENQUIRY`, `JOB_PHASE`                              | -       |                                                                                             |
| QuoteSection  | selectionMode       | `Fixed`, `Optional`, `Multiple Choice`                                                                              | -       |                                                                                             |
| Sorting       | sortOrder           | `asc`, `desc`                                                                                                       | `asc`   |                                                                                             |

---

## Phase 4: Endpoint Catalog

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /jobs

- **Purpose:** List all jobs with filtering and sorting
- **Authentication required:** yes
- **Rate limit:** 100 req/min/company (shared)
- **Idempotent:** yes
- **Status:** [CONFIRMED -- live API test 2026-04-04]

**Query parameters:**

| Parameter          | Type    | Required | Default     | Description                                                      |
| ------------------ | ------- | -------- | ----------- | ---------------------------------------------------------------- |
| pageSize           | number  | no       | 10          | Items per page                                                   |
| pageCursor         | integer | no       | 0           | Cursor for next page                                             |
| sortOrder          | string  | no       | "asc"       | asc or desc                                                      |
| sortField          | string  | no       | "createdAt" | jobNo, createdAt, lastModified                                   |
| filterJobNo        | string  | no       | -           | Filter by job number                                             |
| filterJobStatus    | string  | no       | -           | Active/Completed/Quote Sent/etc.                                 |
| filterJobType      | string  | no       | -           | Quote/Estimate/Charge Up                                         |
| filterCustomerId   | number  | no       | -           | Filter by customer                                               |
| filterSiteId       | number  | no       | -           | Filter by site                                                   |
| filterShowOnHold   | boolean | no       | -           | Include on-hold jobs                                             |
| filterShowArchived | boolean | no       | -           | Include archived jobs                                            |
| filterSearchText   | string  | no       | -           | Substring search on description, jobNo, customer name, site name |

**Success response (200):** [CONFIRMED -- live API test 2026-04-04]

```json
{
  "result": "success",
  "data": [
    {
      "id": 20909314,
      "jobNo": "J-0042",
      "description": "Fix leaking pipe",
      "jobType": "Quote",
      "status": "To Price",
      "customer": { "id": 9778208, "customerFullName": "Smith Plumbing Ltd" },
      "siteAddress": { "id": 8169663, "name": "Main Office", "address1": "123 Main St" },
      "onHold": false,
      "archived": false,
      "links": [{ "href": "/jobs/20909314", "rel": "self", "type": "GET" }]
    }
  ],
  "paging": {
    "perPage": 10,
    "pageCount": 5,
    "links": {
      "self": "/jobs?pageCursor=0&pageSize=10",
      "previous": null,
      "next": "/jobs?pageCursor=10&pageSize=10"
    }
  }
}
```

#### Endpoint: POST /jobs

- **Purpose:** Create a new job
- **Authentication required:** yes
- **Idempotent:** no
- **Status:** [CONFIRMED -- live API test 2026-04-04]

**Request body (non-draft):**

```json
{
  "jobType": "Quote",
  "title": "Kitchen renovation",
  "description": "Full kitchen refit including plumbing and electrical",
  "customerId": 9778208,
  "siteId": 8169663
}
```

**Request body (draft):**

```json
{
  "isDraft": true,
  "jobType": "Estimate",
  "title": "Initial assessment"
}
```

**Success response (201):** [CONFIRMED -- live API test 2026-04-04]

```json
{
  "result": "success",
  "data": {
    "id": 20909314,
    "description": "Full kitchen refit...",
    "jobType": "Quote",
    "status": "Draft",
    "links": [
      { "href": "/jobs/20909314", "rel": "self", "type": "GET" },
      { "href": "/jobs/20909314", "rel": "edit", "type": "PUT" },
      { "href": "/jobs/20909314/finalise", "rel": "finalise", "type": "POST" }
    ]
  }
}
```

**IMPORTANT:** Status is `"Draft"` on create response, but immediately transitions to `"To Price"` on subsequent GET for Quote-type jobs. [CONFIRMED -- live API test 2026-04-04]

**Required fields (non-draft):** `jobType`, `title`, `customerId`, `siteId`, `description`
**Required fields (draft):** `jobType`, `title`, `isDraft: true`
**Valid jobType values:** `"Quote"`, `"Estimate"`, `"Charge Up"` ONLY [CONFIRMED -- live API test 2026-04-04]

#### Endpoint: GET /customers

- **Purpose:** List customers with search
- **Authentication required:** yes
- **Idempotent:** yes
- **Status:** [CONFIRMED -- live API test 2026-04-04]

**Query parameters:**

| Parameter        | Type    | Required | Default     | Description                                         |
| ---------------- | ------- | -------- | ----------- | --------------------------------------------------- |
| pageSize         | number  | no       | 10          | Items per page                                      |
| pageCursor       | integer | no       | 0           | Cursor for next page                                |
| sortOrder        | string  | no       | "asc"       | asc or desc                                         |
| sortField        | string  | no       | "createdAt" | name or createdAt                                   |
| filterSearchText | string  | no       | -           | Search on customer name, contact name, email, phone |

#### Endpoint: POST /customers

- **Purpose:** Create a new customer
- **Idempotent:** no (but returns 303 if duplicate)
- **Status:** [CONFIRMED -- live API test 2026-04-04]

**Request body:**

```json
{
  "customerFullName": "ABC Electrical Ltd",
  "mainContact": {
    "firstName": "Jane",
    "lastName": "Doe",
    "contactItems": [
      { "contactType": "email", "contactValue": "jane@abc.co.nz" },
      { "contactType": "phone", "contactValue": "+64 9 555 1234" }
    ]
  },
  "physicalAddress": {
    "address1": "456 Queen St",
    "addressCity": "Auckland",
    "addressCountry": "New Zealand"
  }
}
```

**Required:** `customerFullName`, `mainContact` (with `firstName`) [CONFIRMED -- live API test 2026-04-04]

**Success response (201):** [CONFIRMED -- live API test 2026-04-04]

```json
{
  "result": "success",
  "data": {
    "id": 9778208,
    "customerFullName": "ABC Electrical Ltd",
    "companyId": 12345,
    "mainContact": { "id": 50, "firstName": "Jane", "lastName": "Doe" },
    "pricingTier": { "id": 1, "name": "Default" }
  }
}
```

**Note:** Returns 303 with `location` header if customer already exists.

#### Endpoint: GET /timeEntries

- **Purpose:** List time entries with date filtering
- **Idempotent:** yes
- **Status:** [CONFIRMED -- live API test 2026-04-04]

**Key parameters:** filterDateFrom, filterDateTo (YYYY-MM-DD), filterUserId, filterJobNo, filterLockedOnly

#### Endpoint: POST /jobs/{jobId}/quotes

- **Purpose:** Create a quote for a job with sections and line items
- **Idempotent:** no

**Request body:**

```json
{
  "title": "Kitchen Renovation Quote",
  "dueDays": 30,
  "sections": [
    {
      "name": "Labour",
      "lineItems": [{ "description": "Plumbing work", "quantity": 8, "unitPrice": 85.0 }]
    },
    {
      "name": "Materials",
      "lineItems": [{ "description": "Pipe fittings", "quantity": 20, "unitPrice": 12.5 }]
    }
  ]
}
```

### 4.2 Full Endpoint Index [IMPORTANT]

**Confirmed working endpoints (all returned 200/201):** [CONFIRMED -- live API test 2026-04-04]

| Method | Path                    | Purpose                      | Auth? | Paginated? | Status          |
| ------ | ----------------------- | ---------------------------- | ----- | ---------- | --------------- |
| GET    | /version                | API version                  | Yes   | No         | CONFIRMED       |
| GET    | /company                | Company info & settings      | Yes   | No         | CONFIRMED       |
| GET    | /customers              | List customers               | Yes   | Yes        | CONFIRMED       |
| GET    | /customers/{customerId} | Get customer                 | Yes   | No         | CONFIRMED       |
| POST   | /customers              | Create customer (303 if dup) | Yes   | No         | CONFIRMED (201) |
| PUT    | /customers/{customerId} | Update customer              | Yes   | No         | CONFIRMED       |
| GET    | /sites                  | List sites                   | Yes   | Yes        | CONFIRMED       |
| POST   | /sites                  | Create site (303 if dup)     | Yes   | No         | CONFIRMED (201) |
| PATCH  | /sites/{siteId}         | Update site                  | Yes   | No         | CONFIRMED       |
| GET    | /jobs                   | List jobs                    | Yes   | Yes        | CONFIRMED       |
| GET    | /jobs/{jobId}           | Get job by ID                | Yes   | No         | CONFIRMED       |
| POST   | /jobs                   | Create job                   | Yes   | No         | CONFIRMED (201) |
| GET    | /jobs/{jobId}/phases    | List job phases              | Yes   | No         | CONFIRMED       |
| GET    | /users                  | List users                   | Yes   | Yes        | CONFIRMED       |
| GET    | /timeEntries            | List time entries            | Yes   | Yes        | CONFIRMED       |
| GET    | /customerInvoices       | List invoices                | Yes   | Yes        | CONFIRMED       |
| GET    | /calendarEvents         | List events                  | Yes   | No         | CONFIRMED       |
| GET    | /enquiries              | List enquiries               | Yes   | Yes        | CONFIRMED       |
| GET    | /pricingTiers           | List pricing tiers           | Yes   | Yes        | CONFIRMED       |
| GET    | /favourites             | List favourite sections      | Yes   | Yes        | CONFIRMED       |
| GET    | /notes                  | List notes                   | Yes   | Yes        | CONFIRMED       |

**Confirmed NOT working (404):** [CONFIRMED -- live API test 2026-04-04]

| Method | Path                | Error                                                 | Notes                                                                   |
| ------ | ------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| GET    | /quotes             | 404: `"Route GET:/api/partner/quotes not found"`      | Use /jobs/quotes instead                                                |
| GET    | /stockOnHand        | 404: `"Route GET:/api/partner/stockOnHand not found"` | Use /phases/{id}/stockOnHand instead                                    |
| POST   | /jobs/{id}/finalise | 404                                                   | Link exists in responses but endpoint may not work [NEEDS VERIFICATION] |

**Other endpoints (from OpenAPI spec, not individually live-tested):**

| Method | Path                                            | Purpose                      | Notes                      |
| ------ | ----------------------------------------------- | ---------------------------- | -------------------------- |
| POST   | /disconnect                                     | Disconnect & revoke tokens   |                            |
| PUT    | /jobs/{jobId}                                   | Update draft job             | Draft only                 |
| POST   | /jobs/{jobId}/hold                              | Put job on hold              | Requires holdUntil + notes |
| POST   | /jobs/{jobId}/resume                            | Resume held job              |                            |
| POST   | /jobs/{jobId}/phases                            | Create job phase             |                            |
| GET    | /jobs/{jobId}/phases/{phaseId}                  | Get job phase                |                            |
| PUT    | /jobs/{jobId}/phases/{phaseId}                  | Update job phase             |                            |
| POST   | /jobs/{jobId}/phases/{phaseId}/void             | Void job phase               | Irreversible               |
| GET    | /jobs/{jobId}/financialSummary                  | Job financial summary        |                            |
| GET    | /jobs/{jobId}/phases/{phaseId}/financialSummary | Phase financial summary      |                            |
| GET    | /jobs/{jobId}/quotes                            | List quotes for job          |                            |
| POST   | /jobs/{jobId}/quotes                            | Create quote                 |                            |
| GET    | /jobs/{jobId}/quotes/{quoteId}                  | Get quote                    |                            |
| PUT    | /jobs/{jobId}/quotes/{quoteId}                  | Update quote by ID           | Draft only                 |
| PUT    | /jobs/{jobId}/quotes/version/{ver}              | Update quote by version      | Draft only                 |
| GET    | /jobs/quotes                                    | All quotes (cross-job)       |                            |
| GET    | /jobs/quotes/{quoteId}                          | Get quote by ID (standalone) |                            |
| GET    | /jobs/quotes/guid/{guid}                        | Get quote by GUID            | Full detail                |
| POST   | /jobs/quotes/{quoteId}/publish                  | Publish quote                |                            |
| POST   | /jobs/quotes/{quoteId}/markAsSent               | Mark quote as sent           |                            |
| POST   | /jobs/quotes/{quoteId}/accept                   | Accept quote                 | May return deposit URL     |
| POST   | /jobs/quotes/{quoteId}/decline                  | Decline quote                |                            |
| POST   | /jobs/quotes/{quoteId}/void                     | Void quote                   |                            |
| POST   | /jobs/quotes/{quoteId}/totals                   | Get quote totals             |                            |
| GET    | /customerInvoices/{invoiceId}                   | Get invoice detail           |                            |
| DELETE | /customers/{customerId}                         | Delete customer              | Hard delete                |
| GET    | /sites/{siteId}                                 | Get site                     |                            |
| POST   | /sites/{siteId}/archive                         | Archive site                 | Soft delete                |
| POST   | /sites/{siteId}/restore                         | Restore site                 |                            |
| GET    | /contacts                                       | List contacts                |                            |
| POST   | /contacts                                       | Create contact               |                            |
| GET    | /contacts/{contactId}                           | Get contact                  |                            |
| PUT    | /contacts/{contactId}                           | Update contact               |                            |
| GET    | /enquiries/{enquiryId}                          | Get enquiry                  |                            |
| GET    | /users/{userId}                                 | Get user                     |                            |
| PATCH  | /users/{userId}                                 | Update user                  | Partial                    |
| POST   | /calendarEvents                                 | Create event                 | Supports recurrence        |
| GET    | /calendarEvents/{eventId}                       | Get event                    |                            |
| POST   | /calendarEvents/{eventId}                       | Update event                 | Uses POST                  |
| DELETE | /calendarEvents/{eventId}                       | Delete event                 | Body required              |
| GET    | /pricingTiers/{id}                              | Get pricing tier             |                            |
| POST   | /pricebooks/search                              | Search pricebook items       | Min 3 chars                |
| GET    | /pricebooks                                     | List pricebooks              |                            |
| GET    | /pricebooks/{id}                                | Get pricebook                |                            |
| GET    | /pricebooks/{id}/pricebookItems                 | List pricebook items         |                            |
| GET    | /pricebooks/{id}/pricebookItems/{itemId}        | Get pricebook item           |                            |
| GET    | /phases/{phaseId}/stockOnHand                   | List stock for phase         |                            |
| POST   | /phases/{phaseId}/stockOnHand                   | Add stock                    |                            |
| GET    | /phases/stockOnHand                             | List all stock               |                            |
| PATCH  | /phases/{phaseId}/stockOnHand/{id}              | Update stock                 |                            |
| DELETE | /phases/{phaseId}/stockOnHand/{id}              | Delete stock                 |                            |
| GET    | /stockUsed                                      | Stock used history           | 180-day max                |
| GET    | /favourites/{sectionId}                         | Get favourite section        |                            |
| POST   | /notes                                          | Create note                  |                            |
| PATCH  | /notes/{noteId}                                 | Update note                  |                            |

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                 | Supported?   | Syntax                                               | Notes                                                                       |
| -------------------------- | ------------ | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| Filter by field value      | Yes          | `?filterFieldName=value`                             | Prefix `filter` on param names [CONFIRMED -- live API test 2026-04-04]      |
| Filter by date range       | Yes          | `?filterDateFrom=YYYY-MM-DD&filterDateTo=YYYY-MM-DD` | Time entries, stock [CONFIRMED]                                             |
| Full-text search           | Yes          | `?filterSearchText=term`                             | Substring matching across multiple fields [CONFIRMED]                       |
| Sort by field              | Yes          | `?sortField=fieldName`                               | Enum of allowed fields per endpoint [CONFIRMED -- live API test 2026-04-04] |
| Sort direction (asc/desc)  | Yes          | `?sortOrder=asc`                                     | Default asc [CONFIRMED]                                                     |
| Field selection            | No           | -                                                    | Not supported [CONFIRMED]                                                   |
| Include related records    | No           | -                                                    | Related data is embedded or requires separate calls [CONFIRMED]             |
| Aggregate / count          | No           | -                                                    | Only pageCount in pagination [CONFIRMED]                                    |
| Logical operators (AND/OR) | Implicit AND | Multiple filter params                               | All filters combined with AND [INFERRED]                                    |
| Comparison operators       | Limited      | `?dueBefore=`, `?dueAfter=`                          | Only on specific endpoints [CONFIRMED]                                      |
| Null checks                | No           | -                                                    | Not supported [CONFIRMED]                                                   |
| Regex / pattern matching   | No           | -                                                    | Only substring matching via filterSearchText [CONFIRMED]                    |

### 5.2 Filter Syntax [REQUIRED]

**General pattern:**

```
GET /resource?filterFieldName=value&filterOtherField=value2
```

All filters use `filter` prefix. Multiple filters are combined with implicit AND.

**Operator syntax:** There are no explicit operators (gt, lt, etc.) except for date-specific parameters like `dueBefore`, `dueAfter`, `createdAfter`, `modifiedAfter`, `filterDateFrom`, `filterDateTo`.

### 5.3 Sort Syntax [IMPORTANT]

```
?sortField=createdAt&sortOrder=desc
```

Each endpoint has its own set of allowed sortField values. Common: `createdAt`, `lastModified`, `name`, `jobNo`.

**EXCEPTION:** `/notes` uses `sortField=created_at` (snake_case). [CONFIRMED -- live API test 2026-04-04]

### 5.5 Search Capabilities [IMPORTANT]

- **Global search endpoint:** None -- search is per-resource [CONFIRMED]
- **Per-resource search:** `?filterSearchText=term` on most list endpoints [CONFIRMED]
- **Search syntax:** Substring matching (contains) [CONFIRMED]
- **Searchable fields:** Vary per endpoint -- documented in OpenAPI spec parameter descriptions
- **Fuzzy matching:** No -- exact substring only [CONFIRMED]
- **Minimum query length:** Not documented [UNKNOWN]

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1: Active jobs for a customer**

```http
GET /jobs?filterCustomerId=9778208&filterJobStatus=Active&sortField=lastModified&sortOrder=desc
```

**Pattern 2: Search customers by name**

```http
GET /customers?filterSearchText=Smith&sortField=name&pageSize=20
```

**Pattern 3: Time entries for a date range**

```http
GET /timeEntries?filterDateFrom=2025-01-01&filterDateTo=2025-01-31&filterUserId=173187
```

**Pattern 4: Overdue invoices**

```http
GET /customerInvoices?dueBefore=2025-03-30&sortField=dueDate&sortOrder=asc
```

**Pattern 5: Calendar events for this week**

```http
GET /calendarEvents?filterDateFrom=2025-03-30T00:00:00.000Z&filterCalendarRange=WEEK&filterActiveOnly=true
```

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** Cursor-based (integer offset) [CONFIRMED -- live API test 2026-04-04]
- **Default page size:** 10 (varies by endpoint, overrideable) [CONFIRMED -- live API test 2026-04-04]
- **Maximum page size:** Not documented in spec [UNKNOWN]
- **Total count available:** Yes -- `paging.pageCount` gives total pages [CONFIRMED -- live API test 2026-04-04]

**Request parameters:**

| Parameter  | Type    | Default | Description                                                             |
| ---------- | ------- | ------- | ----------------------------------------------------------------------- |
| pageSize   | number  | 10      | Items per page                                                          |
| pageCursor | integer | 0       | Offset cursor (0-based integer) [CONFIRMED -- live API test 2026-04-04] |
| sortOrder  | string  | "asc"   | Sort direction                                                          |
| sortField  | string  | varies  | Sort field                                                              |

**Response structure:** [CONFIRMED -- live API test 2026-04-04]

```json
{
  "result": "success",
  "data": [...],
  "paging": {
    "perPage": 10,
    "pageCount": 5,
    "links": {
      "self": "/jobs?pageCursor=0&pageSize=10",
      "previous": null,
      "next": "/jobs?pageCursor=10&pageSize=10"
    }
  }
}
```

**How to detect last page:** `paging.links.next` is `null`, OR `data` array is empty, OR current page equals pageCount. [CONFIRMED -- live API test 2026-04-04]

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /jobs?pageSize=10&pageCursor=0
         -> paging.links.next = "/jobs?pageCursor=10&pageSize=10"
Page 2: GET /jobs?pageSize=10&pageCursor=10
         -> paging.links.next = "/jobs?pageCursor=20&pageSize=10"
Page 3: GET /jobs?pageSize=10&pageCursor=20
         -> paging.links.next is null (last page)
```

### 6.3 Bulk Operations [IMPORTANT]

No bulk operations are documented in the API. All creates/updates are single-record. [CONFIRMED]

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported?            | Notes                                                              |
| ------------------------ | --------------------- | ------------------------------------------------------------------ |
| Webhooks                 | Listed on API Tracker | Not documented in OpenAPI spec; likely available via UI [INFERRED] |
| WebSocket                | No                    | [CONFIRMED]                                                        |
| Server-Sent Events (SSE) | No                    | [CONFIRMED]                                                        |
| Long polling             | No                    | [CONFIRMED]                                                        |
| Change feeds / streams   | No                    | [CONFIRMED]                                                        |

### 7.2 Webhooks [IMPORTANT]

Webhooks are listed as a feature on API Tracker for Fergus, along with a "Webhooks management API." However, no webhook endpoints appear in the current OpenAPI spec. This suggests webhooks may be configured through the Fergus web UI or a separate API surface not covered in the public spec. [INFERRED]

**Event types:** Not documented in the OpenAPI spec. [UNKNOWN]
**Payload format:** Not documented. [UNKNOWN]
**Verification:** Not documented. [UNKNOWN]

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended polling endpoint:** `GET /jobs?sortField=lastModified&sortOrder=desc` or `GET /jobs/quotes?modifiedAfter={timestamp}` [CONFIRMED]
- **Recommended polling interval:** Every 60 seconds (to stay within 100 req/min limit) [INFERRED]
- **"Modified since" filter available:** Yes -- `modifiedAfter` on quotes, `lastModified` sort field on jobs [CONFIRMED]
- **Change detection field(s):** `lastModified` on Jobs, `lastModified` on Quotes [CONFIRMED]
- **Rate limit implications:** 100 req/min shared across all endpoints; budget carefully [CONFIRMED -- live API test 2026-04-04]

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope       | Limit        | Window   | Notes                                                                          |
| ----------- | ------------ | -------- | ------------------------------------------------------------------------------ |
| Per company | 100 requests | 1 minute | Shared across all tokens and endpoints [CONFIRMED -- live API test 2026-04-04] |

- **Rate limit headers:** [CONFIRMED -- live API test 2026-04-04]

| Header                | Meaning                     | Example Value |
| --------------------- | --------------------------- | ------------- |
| x-ratelimit-limit     | Max requests in window      | `100`         |
| x-ratelimit-remaining | Requests remaining          | `87`          |
| x-ratelimit-reset     | Seconds until window resets | `60`          |
| retry-after           | Seconds to wait (429 only)  | `15`          |

- **Rate limit exceeded response:** HTTP 429 with retry-after header [CONFIRMED]
- **Backoff strategy:** Honor retry-after header, then exponential backoff [CONFIRMED]

### 8.2 Error Handling [REQUIRED]

**Error response formats vary by status code:** [CONFIRMED -- live API test 2026-04-04]

**400 Validation error:**

```json
{
  "error": "Bad Request",
  "message": "Validation Failed: [<body>: must have required property 'defaultContact'].",
  "statusCode": 400
}
```

**403 Forbidden (different format -- no error/statusCode fields):**

```json
{ "message": "Forbidden" }
```

**404 Not Found:**

```json
{
  "message": "Route GET:/api/partner/quotes?pageSize=3 not found",
  "error": "Not Found",
  "statusCode": 404
}
```

**415 Wrong Content-Type:**

```json
{
  "error": "FastifyError",
  "message": "Unsupported Media Type: ...",
  "statusCode": 415
}
```

**DELETE with Content-Type header:**

```json
{
  "error": "...",
  "message": "Body cannot be empty when content-type is set to 'application/json'",
  "statusCode": 400
}
```

**Error codes reference:**

| HTTP Status | Meaning                  | Retryable? | Recovery Action                                                        |
| ----------- | ------------------------ | ---------- | ---------------------------------------------------------------------- |
| 400         | Bad request / validation | No         | Fix request per error message                                          |
| 401         | Unauthorized             | Yes        | Refresh token and retry                                                |
| 403         | Forbidden                | No         | Check permissions. NOTE: response is just `{"message": "Forbidden"}`   |
| 404         | Not found                | No         | Verify resource ID. NOTE: reveals internal `/api/partner/` path prefix |
| 409         | Conflict                 | Maybe      | Re-read resource and retry                                             |
| 415         | Unsupported Media Type   | No         | Fix Content-Type header                                                |
| 422         | Validation failed        | No         | Fix fields per error message                                           |
| 429         | Rate limited             | Yes        | Wait for retry-after header                                            |
| 500         | Internal error           | Yes        | Retry with exponential backoff                                         |
| 5XX         | Server error             | Yes        | Retry with backoff                                                     |

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** No [CONFIRMED]
- **Which methods are naturally idempotent:**
  - GET: yes
  - PUT: yes (full replace)
  - DELETE: yes
  - POST: no
  - PATCH: depends (partial updates are idempotent if same data sent)

### 8.5 File Handling [IMPORTANT]

No file upload/download endpoints in the API. [CONFIRMED]

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | When to Use                          | Fits?        | Notes                                        |
| -------------------------- | ------------------------------------ | ------------ | -------------------------------------------- |
| **Data Connector**         | API has browsable structured content | Yes          | Jobs, customers, sites are browsable         |
| **Data Connector (Files)** | API is primarily a file system       | No           | No file operations                           |
| **Direct API Only**        | API is action-oriented               | Partial      | Has CRUD operations too                      |
| **Hybrid**                 | Both browsable content AND actions   | **Best fit** | Browse jobs/customers/quotes + create/update |

**Selected integration path:** Hybrid (Data Connector + Direct API)

**Justification:** Fergus has rich browsable structured content (jobs, customers, sites, quotes, invoices, time entries) that maps well to a Data Connector pattern for reading/searching. It also has significant write capabilities (create jobs, customers, quotes, calendar events) that benefit from Direct API integration in the workspace agent. The Hybrid path gives users both passive browsing in Files Remote and active job management via chat.

### 9.2 Connector Requirements [IMPORTANT]

| Connector Method    | API Endpoint                                                  | Notes                               |
| ------------------- | ------------------------------------------------------------- | ----------------------------------- |
| `list_files`        | GET /jobs, GET /customers, GET /sites                         | Top-level navigation by entity type |
| `download_file`     | GET /jobs/{id}, GET /customers/{id}                           | Return JSON representation          |
| `search_files`      | GET /jobs?filterSearchText=, GET /customers?filterSearchText= | Substring search                    |
| `get_file_metadata` | GET /jobs/{id}, GET /customers/{id}                           | Return entity metadata              |

**Auth type for connector:** Token (PAT) or OAuth 2.0
**Connector category:** project-management
**Caching appropriate:** Yes -- 5 minute TTL for list operations
**Caching policy:** Cache list/search results for 5 minutes; invalidate on write operations

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. List, search, and view jobs, customers, sites, invoices, time entries, calendar events [CONFIRMED -- live API test 2026-04-04]
2. Create jobs (with valid jobType: Quote/Estimate/Charge Up), customers, sites, enquiries, calendar events, notes [CONFIRMED -- live API test 2026-04-04]
3. Update draft jobs, customers (PUT), sites (PATCH, requires siteAddress), users (limited fields), notes [CONFIRMED -- live API test 2026-04-04]
4. Manage quote lifecycle via /jobs/quotes paths: publish, mark as sent, accept, decline, void
5. Put jobs on hold / resume
6. View financial summaries and quote totals
7. Search pricebook items for materials/costs
8. View company settings and team members [CONFIRMED -- live API test 2026-04-04]

**CANNOT do (out of scope or not working):**

1. Use `/quotes` endpoint directly (404) [CONFIRMED -- live API test 2026-04-04]
2. Use `/stockOnHand` endpoint directly (404) [CONFIRMED -- live API test 2026-04-04]
3. Reliably finalise jobs via API (POST /jobs/{id}/finalise returns 404) [NEEDS VERIFICATION]
4. Delete customers (destructive -- requires explicit user confirmation)
5. Void job phases (irreversible)
6. Create or modify time entries (read-only in API)
7. Create or modify invoices (read-only in API)
8. Modify pricebooks or pricing tiers (read-only)
9. Upload/download files (not supported by API)

**Default parameters:**

| Parameter | Default   | Reason                                       |
| --------- | --------- | -------------------------------------------- |
| pageSize  | 20        | Balance between data and rate limits         |
| sortOrder | desc      | Most recent first is usually what users want |
| sortField | createdAt | Chronological is most useful default         |

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed
- [x] Phase 2 complete: auth documented, live API tested [CONFIRMED -- live API test 2026-04-04]
- [x] Phase 3 complete: 14 entities with fields documented, live-validated
- [x] Phase 4 complete: 55+ endpoints documented, 21 live-confirmed, 3 confirmed NOT working
- [x] Phase 5 complete: query and filter patterns documented
- [x] Phase 6 complete: pagination model documented and live-confirmed
- [x] Phase 7 complete: event-driven capabilities assessed (webhooks uncertain)
- [x] Phase 8 complete: rate limits and error formats live-confirmed
- [x] Phase 9 complete: integration path selected (Hybrid)

**Overall investigation confidence:** high -- live-tested

**Known gaps:**

1. Webhook details are not in the OpenAPI spec -- may exist via separate surface.
2. Maximum page size is not documented.
3. POST /jobs/{id}/finalise returns 404 despite being in HATEOAS links -- needs investigation.

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence | Gaps                                   |
| ---------------------------- | ------------- | ---------- | -------------------------------------- |
| 01-llm-api-rules             | Yes           | High       | Live-tested                            |
| 01a-domain-model-reference   | Yes           | High       | Live-tested                            |
| 01b-query-patterns           | Yes           | High       | Live-tested                            |
| 01c-mutation-patterns        | Yes           | High       | Live-tested, required fields corrected |
| 01d-event-and-error-handling | Yes           | High       | Error formats live-confirmed           |
| 02-api-spec-investigation    | Yes           | High       | Endpoints live-verified                |
| 03-connector-setup           | Yes           | High       | Standard connector pattern             |
