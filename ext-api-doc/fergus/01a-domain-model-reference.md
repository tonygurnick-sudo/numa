---
api_name: Fergus
api_slug: fergus
base_url: https://api.fergus.com
route_prefix_injected_by_connector: /api/partner
path_version_segment: none ("v1" is a label, never a path segment; /v1/... → 404)
auth: Bearer {token}
field_casing: camelCase
id_format: integer
call_surface: HTTP via `numa integrations request` (NOT a file-store connector)
companions: 01=api-rules, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
confidence: every fact live-API-confirmed 2026-04-04 unless tagged [INFERRED] or [VERIFIED <date>]
---

# Fergus — Domain Model Reference

Full entity catalog, relationships, state machines, business rules. Paths are FLAT (`/jobs`, `/customers/{id}`); connector injects `/api/partner`.

## Entity Catalog

### Job — `/jobs`, `/jobs/{jobId}`

Core work unit for a customer at a site. Holds phases, quotes, financials. CRUD: Create, Read, Update (draft only), Hold, Resume.

| Field           | Type    | Req | Writable    | Notes                             | Example                                         |
| --------------- | ------- | --- | ----------- | --------------------------------- | ----------------------------------------------- |
| id              | integer | yes | no          |                                   | `20909314`                                      |
| jobNo           | string  | yes | no          | human-readable                    | `"J-0042"`                                      |
| description     | string  | yes | create      |                                   | `"Fix leaking pipe"`                            |
| longDescription | string  | yes | create      |                                   | `"Kitchen sink..."`                             |
| createdAt       | string  | yes | no          | ISO 8601                          | `"2025-01-15T09:00:00Z"`                        |
| lastModified    | string  | yes | no          | ISO 8601                          | `"2025-01-16T14:30:00Z"`                        |
| jobType         | string  | yes | create      | **ONLY Quote/Estimate/Charge Up** | `"Quote"`                                       |
| status          | string  | yes | no          |                                   | `"To Price"`                                    |
| assignedGroups  | array   | yes | no          | default group(s)                  | `[{"id":1}]`                                    |
| customer        | object  | yes | create (ID) | embedded JobCustomer              | `{"id":9778208,"customerFullName":"Smith Ltd"}` |
| siteAddress     | object  | yes | create (ID) | embedded JobSiteAddress           | `{"id":8169663,"name":"Main Office"}`           |
| mainContact     | object  | yes | no          |                                   | `{"firstName":"John"}`                          |
| activeQuote     | object  | yes | no          |                                   | `null`                                          |
| onHold          | boolean | yes | no          |                                   | `false`                                         |
| archived        | boolean | yes | no          |                                   | `false`                                         |
| links           | array   | yes | no          | HATEOAS                           | see below                                       |

jobType: ONLY `"Quote"`, `"Estimate"`, `"Charge Up"`. "Service"/"Project" do NOT exist.
Status after create: POST returns `"status":"Draft"` (transient); GET immediately returns `"To Price"` for Quote jobs.
HATEOAS links: `[{"href":"/jobs/20909314","rel":"self","type":"GET"},{"href":"/jobs/20909314","rel":"edit","type":"PUT"},{"href":"/jobs/20909314/finalise","rel":"finalise","type":"POST"}]` — the finalise `"type":"POST"` is a server bug; spec defines `put` only → use **PUT /jobs/{id}/finalise** [VERIFIED 2026-05-19 against https://api.fergus.com/docs/json].

Relationships: Customer N:1 (`customerId` on create, nested `customer` in response) · Site N:1 (`siteId` on create, nested `siteAddress`) · Quote 1:N sub-resource `/jobs/{jobId}/quotes` (NOT `/quotes`, 404) · JobPhase 1:N `/jobs/{jobId}/phases` · CalendarEvent 1:N `filterJobId` on `/calendarEvents` · CustomerInvoice 1:N `jobId` on `/customerInvoices` · Note 1:N `filterEntityName=JOB&filterEntityId={id}` on `/notes`.

### Customer — `/customers`, `/customers/{customerId}`

Person/company commissioning work. CRUD: Create (201), Read, Update (PUT full replace), Delete.

| Field            | Type           | Req | Writable | Notes                 | Example                     |
| ---------------- | -------------- | --- | -------- | --------------------- | --------------------------- |
| id               | integer        | yes | no       |                       | `9778208`                   |
| companyId        | integer        | yes | no       | owning Fergus company | `12345`                     |
| customerFullName | string         | yes | yes      |                       | `"Smith Plumbing Ltd"`      |
| createdAt        | string         | yes | no       | ISO                   | `"2025-01-10T08:00:00Z"`    |
| mainContact      | PersonContact  | yes | yes      | primary contact       |                             |
| physicalAddress  | AddressContact | yes | yes      |                       |                             |
| postalAddress    | AddressContact | yes | yes      | nullable              |                             |
| billingContact   | PersonContact  | yes | no       |                       |                             |
| pricingTier      | object         | yes | no       | auto-assigned         | `{"id":1,"name":"Default"}` |
| customerSource   | string         | yes | no       | lead source           | `"Website"`                 |
| links            | array          | yes | no       | HATEOAS               |                             |

Create required: `customerFullName`, `mainContact` (with `firstName`) → 201 with auto `id`, `companyId`, default `pricingTier`. Update (PUT, full replace) required: `customerFullName`, `mainContact`.
Relationships: Job 1:N `filterCustomerId` on `/jobs` · Contact 1:N `filterCustomerId` on `/contacts` · CustomerInvoice 1:N `customerId` on `/customerInvoices` · Note 1:N `filterEntityName=CUSTOMER&filterEntityId={id}` on `/notes`.

### Site — `/sites`, `/sites/{siteId}`

Physical work location. CRUD: Create (201), Read, Update (PATCH), Archive, Restore.

| Field           | Type           | Req     | Writable | Notes                   | Example                 |
| --------------- | -------------- | ------- | -------- | ----------------------- | ----------------------- |
| id              | integer        | yes     | no       |                         | `8169663`               |
| companyId       | integer        | yes     | no       |                         | `12345`                 |
| name            | string         | no      | yes      |                         | `"Auckland CBD Office"` |
| createdAt       | string         | yes     | no       | ISO                     |                         |
| defaultContact  | PersonContact  | **yes** | yes      | **REQUIRED on create**  |                         |
| billingContact  | PersonContact  | yes     | no       |                         |                         |
| physicalAddress | AddressContact | yes     | yes      | `siteAddress` on create |                         |
| postalAddress   | AddressContact | yes     | yes      |                         |                         |
| isArchived      | boolean        | yes     | no       |                         | `false`                 |
| deletedAt       | string         | yes     | no       | null if active          | `null`                  |
| links           | array          | yes     | no       | HATEOAS                 |                         |

Create requires `defaultContact` (with `firstName`+`lastName`) AND `siteAddress`. Err: `"Validation Failed: [<body>: must have required property 'defaultContact']"`.
PATCH requires `siteAddress` even on partial updates. Err: `"Validation Failed: [<body>: must have required property 'siteAddress']"`.

### Quote — `/jobs/{jobId}/quotes`, `/jobs/quotes`

Price estimate for a job; sections with line items. CRUD: Create, Read, Update (draft only), Publish, Accept, Decline, Void.
Standalone `/quotes` does NOT exist (404). Use `/jobs/quotes` (cross-job) or `/jobs/{jobId}/quotes` (job-scoped).

| Field         | Type        | Req | Writable | Notes              | Example           |
| ------------- | ----------- | --- | -------- | ------------------ | ----------------- |
| id            | integer     | yes | no       |                    | `500`             |
| versionNumber | number      | yes | no       | version within job | `1`               |
| jobId         | integer     | yes | no       |                    | `20909314`        |
| guid          | string      | yes | no       | global ID          | `"a1b2c3..."`     |
| title         | string      | yes | yes      |                    | `"Initial Quote"` |
| description   | string      | yes | yes      |                    |                   |
| footerText    | string      | no  | no       |                    |                   |
| quoteDate     | string      | yes | no       |                    |                   |
| isSent        | boolean     | yes | no       |                    | `false`           |
| isAccepted    | boolean     | yes | no       |                    | `false`           |
| isSuperseded  | boolean     | yes | no       |                    | `false`           |
| isLocked      | boolean     | yes | no       |                    | `false`           |
| createdAt     | string      | yes | no       | ISO                |                   |
| lastModified  | string      | yes | no       | ISO                |                   |
| publishedAt   | string      | yes | no       | nullable           |                   |
| dueDate       | string      | yes | no       | expiry             |                   |
| declinedAt    | string      | yes | no       | nullable           |                   |
| voidedAt      | string      | yes | no       | nullable           |                   |
| dueDays       | number      | yes | yes      | days until due     | `30`              |
| sections      | array       | no  | yes      | QuoteSection[]     |                   |
| deposit       | object      | no  | no       |                    |                   |
| quoteConfig   | QuoteConfig | no  | no       | display config     |                   |

### JobPhase — `/jobs/{jobId}/phases`, `/jobs/{jobId}/phases/{jobPhaseId}`

Phase/stage within a job. CRUD: Create, Read, Update, Void.
Fields: `id` (int), `jobId` (int), `title` (str, writable, e.g. `"Plumbing"`), `description` (str, writable), `status` (str, e.g. `"Active"`), `createdAt` (ISO), `assignedGroups` (array).

### User — `/users`, `/users/{userId}`

Team members. CRUD: Read, Update (limited fields).

| Field         | Type           | Req | Writable | Notes     | Example              |
| ------------- | -------------- | --- | -------- | --------- | -------------------- |
| id            | integer        | yes | no       |           | `173187`             |
| firstName     | string         | yes | yes      |           | `"Mike"`             |
| lastName      | string         | yes | yes      |           | `"Johnson"`          |
| email         | string         | yes | no       | read-only | `"mike@example.com"` |
| userType      | string         | yes | no       | role      | `"tradesman"`        |
| status        | string         | yes | no       |           | `"active"`           |
| payRate       | number         | yes | yes      | hourly    | `35.00`              |
| chargeOutRate | number         | yes | yes      | hourly    | `85.00`              |
| address       | AddressContact | yes | yes      |           |                      |
| contactItems  | array          | no  | yes      |           |                      |
| createdAt     | string         | yes | no       | ISO       |                      |
| modifiedAt    | string         | yes | no       | ISO       |                      |

### TimeEntry — `/timeEntries`

Time tracking. CRUD: Read only.

| Field           | Type    | Notes                      | Example              |
| --------------- | ------- | -------------------------- | -------------------- |
| timeEntryId     | integer |                            | `300`                |
| userId          | integer | worker                     | `173187`             |
| user            | string  | display name               | `"Mike Johnson"`     |
| dateEntered     | string  |                            | `"2025-01-15"`       |
| startTime       | string  | `YYYY-MM-DD HH:MM`, 15-min | `"2025-01-15 07:00"` |
| endTime         | string  |                            | `"2025-01-15 17:00"` |
| isLocked        | boolean | locked for payroll         | `false`              |
| payRate         | number  | /hr                        | `35.00`              |
| chargeOutRate   | number  | /hr                        | `85.00`              |
| paidDuration    | number  | hours paid                 | `8.0`                |
| workDescription | string  |                            | `"Fixed pipe"`       |
| jobId           | integer | nullable                   | `20909314`           |
| jobNo           | string  | nullable                   | `"J-0042"`           |
| jobPhaseId      | integer | nullable                   | `1`                  |

All fields read-only.

### Enquiry — `/enquiries`, `/enquiries/{enquiryId}`

Incoming leads. CRUD: Create, Read.
Fields: `id` (int), `name` (str, writable on create, `"Bathroom reno"`), `contactName` (str, `"John Smith"`), `description` (writable on create), `createdAt` (ISO), `source` (writable on create, `"Website"`), `status` (`"New"`), `address1..addressCountry` (writable on create).

### CalendarEvent — `/calendarEvents`, `/calendarEvents/{calendarEventId}`

Scheduled events/appointments. CRUD: Create, Read, Update (POST!), Delete.

| Field       | Type    | Req | Writable | Notes                          | Example                      |
| ----------- | ------- | --- | -------- | ------------------------------ | ---------------------------- |
| id          | integer | yes | no       |                                |                              |
| userId      | integer | yes | yes      | assigned user                  | `173187`                     |
| title       | string  | yes | yes      |                                | `"Site visit"`               |
| eventType   | string  | yes | yes      | JOB_PHASE/QUOTE/ESTIMATE/OTHER | `"JOB_PHASE"`                |
| startTime   | string  | yes | yes      | ISO 8601 UTC, 15-min           | `"2025-01-15T07:00:00.000Z"` |
| endTime     | string  | yes | yes      | ISO 8601 UTC                   | `"2025-01-15T17:00:00.000Z"` |
| jobId       | integer | yes | yes      | nullable                       | `20909314`                   |
| jobPhaseId  | integer | yes | yes      | nullable                       | `1`                          |
| isActive    | boolean | yes | no       |                                | `true`                       |
| isRecurring | boolean | yes | no       |                                | `false`                      |

### CustomerInvoice — `/customerInvoices`, `/customerInvoices/{invoiceId}`

Invoices to customers. CRUD: Read only.
Fields (all read-only): `id`, `jobId`, `customerId`, `title`, `invoiceNumber` (`"INV-001"`), `subtotal` (pre-tax, `500.00`), `taxValue` (`75.00`), `taxRate` (`15.0`), `status`, `isSent` (`false`), `isFinal` (`false`), `dueDate`, `paidAt` (nullable).

### Contact — `/contacts`, `/contacts/{contactId}`

Contacts linked to customers/sites. CRUD: Create, Read, Update. Create requires `firstName`, `email`, plus `customerId` or `siteId`.

### Note — `/notes`, `/notes/{noteId}`

Notes attached to any entity. CRUD: Create, Read, Update.

| Field       | Type    | Req | Writable | Notes                        | Example                                 |
| ----------- | ------- | --- | -------- | ---------------------------- | --------------------------------------- |
| id          | integer | yes | no       |                              |                                         |
| text        | string  | yes | yes      |                              | `"Called customer, confirmed schedule"` |
| entityName  | string  | yes | create   | JOB/CUSTOMER/QUOTE/SITE/etc. | `"JOB"`                                 |
| entityId    | integer | yes | create   |                              | `20909314`                              |
| isPinned    | boolean | yes | yes      |                              | `false`                                 |
| parentId    | integer | no  | create   | reply parent                 | `null`                                  |
| createdById | integer | yes | no       | author                       | `173187`                                |
| createdAt   | string  | yes | no       | ISO                          |                                         |

Sort uses snake_case: `sortField=created_at`. Only known endpoint with this exception.

### StockOnHand — `/phases/{jobPhaseId}/stockOnHand`

Stock allocated to a phase. CRUD: Create, Read, Update, Delete.
Standalone `/stockOnHand` does NOT exist (404). Key fields: `itemDescription`, `itemCost`, `itemPrice`, `itemQuantity`, `jobPhaseId`.

### Pricebook / PricebookItem — `/pricebooks`, `/pricebooks/{id}/pricebookItems`, `/pricebooks/search`

Supplier pricebooks. CRUD: Read, Search (no write). Key fields: `supplierName`, `name`, `productCode`, `costPrice`, `retailPrice`, `unitType`.

### Company — `/company`

Authenticated company profile. CRUD: Read only. Key fields: `guid`, `prefix`, `name`, `active`, `contact`, `settings` (key-value array: timezone, currency, date format, prefix), `tax`: `{"rate":15,"type":"GST"}` (NZ GST).

### Favourites — `/favourites`, `/favourites/{sectionId}`

Template sections (line items) for quick-adding to quotes. CRUD: Read only.

## Shared Sub-Models

- **PersonContact:** `id`, `firstName`, `lastName`, `position`, `company`, `contactItems[]`
- **AddressContact:** `id`, `address1`, `address2`, `addressSuburb`, `addressCity`, `addressRegion`, `addressPostcode`, `addressCountry`
- **ContactItem:** `id`, `contactType` (email/phone/mobile/other/fax/website), `contactValue`
- **QuoteSection:** `sectionId`, `name`, `sortOrder`, `parentSectionId`, `description`, `selectionMode` (Fixed/Optional/Multiple Choice), `lineItems[]`, `sections[]` (nested)

## Entity Relationships

Customer 1:N Job 1:N Quote 1:N QuoteSection 1:N LineItem. Customer 1:N Contact. Job 1:N JobPhase 1:N CalendarEvent. Site N:1 Job; Site 1:N Contact. Job (read-only): TimeEntry, CustomerInvoice. Pricebook 1:N PricebookItem N:M PricingTier.

## State Machines

### Job Lifecycle

`Draft → (automatic) → To Price → price → Active → complete → Completed`. From To Price/Active: `hold → On Hold → resume → Active`; `archive → Archived`.
Draft is transient: POST returns `"Draft"`, GET returns `"To Price"` for Quote jobs.

| From            | Action                 | To        | Reversible | Side effects               |
| --------------- | ---------------------- | --------- | ---------- | -------------------------- |
| Draft           | (automatic)            | To Price  | No         | immediate for Quote jobs   |
| To Price/Active | POST /jobs/{id}/hold   | On Hold   | Yes        | requires holdUntil + notes |
| On Hold         | POST /jobs/{id}/resume | Active    | —          |                            |
| Active          | all phases completed   | Completed | No         |                            |

Per-state: Draft → PUT-updatable, no delete (transient). To Price/Active → no update/delete; can hold, create phases/quotes. On Hold → resume only. Completed → none.

### Quote Lifecycle

`Draft → publish → Published → markAsSent → Sent → accept → Accepted`. From Sent: `decline → Declined`. From any: `void → Voided`; new version → Superseded.

| From      | Action      | To         | Side effects                            |
| --------- | ----------- | ---------- | --------------------------------------- |
| Draft     | publish     | Published  | isLocked=true                           |
| Published | markAsSent  | Sent       | isSent=true                             |
| Sent      | accept      | Accepted   | isAccepted=true; may return deposit URL |
| Sent      | decline     | Declined   | declinedAt set                          |
| Any       | void        | Voided     | voidedAt set                            |
| Any       | new version | Superseded | isSuperseded=true                       |

All quote transitions irreversible.

## Business Rules

- Must create Customer before non-draft Job (`customerId` required); must create Site before non-draft Job (`siteId` required); must create Job before Quote (sub-resource). Draft jobs do NOT require `customerId`/`siteId`.
- `customerFullName` non-empty (pattern `\S`). `firstName` required on PersonContact. Site create requires `defaultContact` (`firstName`+`lastName`); Site PATCH requires `siteAddress`. Calendar event times: ISO 8601 UTC, 15-min intervals. Pricebook search: min 3 chars. `jobType` ∈ {Quote, Estimate, Charge Up} only.
- POST /customers and POST /sites return 303 if duplicate exists. Voiding a job phase is irreversible. Accepting a quote may generate a deposit invoice + payment URL.
- Server-set/read-only: `createdAt`, `lastModified`, `companyId` (on create), `pricingTier` (on customer create), quote totals (computed from sections/line items), financial summaries (server-computed aggregates).

## Field Format Reference

| Format          | Pattern            | Example                    | Notes                                       |
| --------------- | ------------------ | -------------------------- | ------------------------------------------- |
| Date            | `YYYY-MM-DD`       | `2025-01-15`               | filters, dateEntered                        |
| DateTime        | ISO 8601           | `2025-01-15T09:00:00.000Z` | createdAt, calendar events                  |
| Time Entry Time | `YYYY-MM-DD HH:MM` | `2025-01-15 07:00`         | 15-min intervals                            |
| Currency        | number             | `85.50`                    | no symbol; company settings define currency |
| ID              | integer            | `9778208`                  | all IDs integer                             |
| Cursor          | integer            | `0`                        | 0-based, pagination                         |

## Enum Value Reference

| Entity        | Field               | Allowed Values                                                                                                      | Default | Notes                    |
| ------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------ |
| Job           | jobType             | `Quote`, `Estimate`, `Charge Up`                                                                                    | —       | **ONLY these 3**         |
| Job           | filterJobStatus     | `Active`, `Completed`, `Estimate Rejected`, `Estimate Sent`, `Inactive`, `Quote Sent`, `Quote Rejected`, `To Price` | —       |                          |
| Job           | status (observed)   | `Draft` (transient), `To Price`                                                                                     | —       |                          |
| User          | userType            | `contractor`, `time_sheet_only`, `field_worker`, `apprentice`, `tradesman`, `advisor`, `full_user`                  | —       |                          |
| User          | status              | `active`, `disabled`, `invited`                                                                                     | —       |                          |
| Quote         | filterStatus        | `draft`, `accepted`, `voided`, `superseded`, `declined`, `published`, `emailSent`, `emailNotSent`                   | —       |                          |
| CalendarEvent | eventType           | `JOB_PHASE`, `QUOTE`, `ESTIMATE`, `OTHER`                                                                           | —       | required                 |
| CalendarEvent | frequency           | `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`, `NEVER`                                                                     | `NEVER` |                          |
| CalendarEvent | repeatEndType       | `NEVER`, `ON_DATE`, `AFTER`                                                                                         | `NEVER` |                          |
| CalendarEvent | filterCalendarRange | `DAY`, `THREE_DAY`, `WEEK`, `FORTNIGHT`, `MONTH`                                                                    | —       |                          |
| ContactItem   | contactType         | `email`, `phone`, `mobile`, `other`, `fax`, `website`                                                               | —       |                          |
| Note          | entityName          | `JOB`, `CUSTOMER`, `CUSTOMER_INVOICE`, `QUOTE`, `SITE`, `TASK`, `ENQUIRY`, `JOB_PHASE`                              | —       |                          |
| Note          | sortField           | `created_at`                                                                                                        | —       | **snake_case exception** |
| QuoteSection  | selectionMode       | `Fixed`, `Optional`, `Multiple Choice`                                                                              | —       |                          |
| Sort          | sortOrder           | `asc`, `desc`                                                                                                       | `asc`   |                          |
