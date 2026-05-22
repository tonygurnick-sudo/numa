---
api_name: 'Fergus'
api_slug: 'fergus'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-03-30'
updated_date: '2026-04-04'
update_source: 'live API testing'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# Fergus -- Domain Model Reference

> Companion to `01-llm-api-rules.md`. Contains the full entity catalog, relationships,
> state machines, and business rules that the workspace agent references when working
> with Fergus data.
> **Updated 2026-04-04 with corrections from live API testing.**

---

## Entity Catalog

### Job

**Resource path:** `/jobs`, `/jobs/{jobId}`
**Description:** Core work unit -- a piece of work for a customer at a site. Contains phases, quotes, and financial data.
**CRUD:** Create, Read, Update (draft only), Hold, Resume

| Field           | Type    | Required | Writable    | Description                          | Example                                                      |
| --------------- | ------- | -------- | ----------- | ------------------------------------ | ------------------------------------------------------------ |
| id              | integer | yes      | no          | Unique identifier                    | `20909314`                                                   |
| jobNo           | string  | yes      | no          | Human-readable number                | `"J-0042"`                                                   |
| description     | string  | yes      | create      | Short description                    | `"Fix leaking pipe"`                                         |
| longDescription | string  | yes      | create      | Detailed description                 | `"Kitchen sink..."`                                          |
| createdAt       | string  | yes      | no          | ISO 8601 timestamp                   | `"2025-01-15T09:00:00Z"`                                     |
| lastModified    | string  | yes      | no          | ISO 8601 timestamp                   | `"2025-01-16T14:30:00Z"`                                     |
| jobType         | string  | yes      | create      | **ONLY: Quote, Estimate, Charge Up** | `"Quote"`                                                    |
| status          | string  | yes      | no          | Current status                       | `"To Price"`                                                 |
| assignedGroups  | array   | yes      | no          | Default group(s)                     | `[{"id": 1}]`                                                |
| customer        | object  | yes      | create (ID) | Embedded JobCustomer                 | `{"id": 9778208, "customerFullName": "Smith Ltd"}`           |
| siteAddress     | object  | yes      | create (ID) | Embedded JobSiteAddress              | `{"id": 8169663, "name": "Main Office"}`                     |
| mainContact     | object  | yes      | no          | Primary contact                      | `{"firstName": "John"}`                                      |
| activeQuote     | object  | yes      | no          | Currently active quote               | `null`                                                       |
| onHold          | boolean | yes      | no          | On-hold state                        | `false`                                                      |
| archived        | boolean | yes      | no          | Archived state                       | `false`                                                      |
| links           | array   | yes      | no          | HATEOAS links                        | `[{"href": "/jobs/20909314", "rel": "self", "type": "GET"}]` |

**IMPORTANT -- jobType:** Only `"Quote"`, `"Estimate"`, `"Charge Up"` are valid. "Service" and "Project" do NOT exist. [CONFIRMED -- live API test 2026-04-04]

**IMPORTANT -- Status after creation:** POST returns `"status": "Draft"` (transient). GET immediately returns `"To Price"` for Quote-type jobs. [CONFIRMED -- live API test 2026-04-04]

**HATEOAS links in response:** [CONFIRMED -- live API test 2026-04-04]

```json
"links": [
  {"href": "/jobs/20909314", "rel": "self", "type": "GET"},
  {"href": "/jobs/20909314", "rel": "edit", "type": "PUT"},
  {"href": "/jobs/20909314/finalise", "rel": "finalise", "type": "POST"}
]
```

**NOTE:** The HATEOAS link claims `"type": "POST"` but that's a server-side bug. The OpenAPI spec defines this path with `put` only — use **PUT /jobs/{id}/finalise**. [VERIFIED 2026-05-19 against https://api.fergus.com/docs/json]

**Relationships:**

| Related Entity  | Type | Expression                                             | Notes                                   |
| --------------- | ---- | ------------------------------------------------------ | --------------------------------------- |
| Customer        | N:1  | `customerId` on create; nested `customer` in response  | [CONFIRMED]                             |
| Site            | N:1  | `siteId` on create; nested `siteAddress` in response   | [CONFIRMED]                             |
| Quote           | 1:N  | Sub-resource `/jobs/{jobId}/quotes`                    | NOT /quotes (404)                       |
| JobPhase        | 1:N  | Sub-resource `/jobs/{jobId}/phases`                    | [CONFIRMED -- live API test 2026-04-04] |
| CalendarEvent   | 1:N  | `filterJobId` on `/calendarEvents`                     |                                         |
| CustomerInvoice | 1:N  | `jobId` filter on `/customerInvoices`                  |                                         |
| Note            | 1:N  | `filterEntityName=JOB&filterEntityId={id}` on `/notes` |                                         |

---

### Customer

**Resource path:** `/customers`, `/customers/{customerId}`
**Description:** Person or company that commissions work.
**CRUD:** Create (201), Read, Update (PUT, full replace), Delete

| Field            | Type           | Required | Writable | Description                | Example                        |
| ---------------- | -------------- | -------- | -------- | -------------------------- | ------------------------------ |
| id               | integer        | yes      | no       | Unique identifier          | `9778208`                      |
| companyId        | integer        | yes      | no       | Owning Fergus company      | `12345`                        |
| customerFullName | string         | yes      | yes      | Full display name          | `"Smith Plumbing Ltd"`         |
| createdAt        | string         | yes      | no       | ISO timestamp              | `"2025-01-10T08:00:00Z"`       |
| mainContact      | PersonContact  | yes      | yes      | Primary contact person     |                                |
| physicalAddress  | AddressContact | yes      | yes      | Physical address           |                                |
| postalAddress    | AddressContact | yes      | yes      | Postal address (nullable)  |                                |
| billingContact   | PersonContact  | yes      | no       | Billing contact            |                                |
| pricingTier      | object         | yes      | no       | Auto-assigned pricing tier | `{"id": 1, "name": "Default"}` |
| customerSource   | string         | yes      | no       | Lead source                | `"Website"`                    |
| links            | array          | yes      | no       | HATEOAS links              |                                |

**Create required:** `customerFullName`, `mainContact` (with `firstName`). Response: 201 with auto-assigned `id`, `companyId`, default `pricingTier`. [CONFIRMED -- live API test 2026-04-04]

**Update:** PUT /customers/{id} -- full replace. Required: `customerFullName`, `mainContact`. [CONFIRMED -- live API test 2026-04-04]

**Relationships:**

| Related Entity  | Type | Expression                                                  | Notes |
| --------------- | ---- | ----------------------------------------------------------- | ----- |
| Job             | 1:N  | `filterCustomerId` on `/jobs`                               |       |
| Contact         | 1:N  | `filterCustomerId` on `/contacts`                           |       |
| CustomerInvoice | 1:N  | `customerId` on `/customerInvoices`                         |       |
| Note            | 1:N  | `filterEntityName=CUSTOMER&filterEntityId={id}` on `/notes` |       |

---

### Site

**Resource path:** `/sites`, `/sites/{siteId}`
**Description:** Physical location where work is performed.
**CRUD:** Create (201), Read, Update (PATCH), Archive, Restore

| Field           | Type           | Required | Writable | Description                              | Example                 |
| --------------- | -------------- | -------- | -------- | ---------------------------------------- | ----------------------- |
| id              | integer        | yes      | no       | Unique identifier                        | `8169663`               |
| companyId       | integer        | yes      | no       | Owning company                           | `12345`                 |
| name            | string         | no       | yes      | Site name                                | `"Auckland CBD Office"` |
| createdAt       | string         | yes      | no       | ISO timestamp                            |                         |
| defaultContact  | PersonContact  | **yes**  | yes      | **REQUIRED on create**                   |                         |
| billingContact  | PersonContact  | yes      | no       | Billing person                           |                         |
| physicalAddress | AddressContact | yes      | yes      | Physical address (siteAddress on create) |                         |
| postalAddress   | AddressContact | yes      | yes      | Postal address                           |                         |
| isArchived      | boolean        | yes      | no       | Whether archived                         | `false`                 |
| deletedAt       | string         | yes      | no       | Deletion timestamp (null if active)      | `null`                  |
| links           | array          | yes      | no       | HATEOAS links                            |                         |

**IMPORTANT -- Create requires `defaultContact`:** Must include `defaultContact` with `firstName` and `lastName`. Also requires `siteAddress`. Error if missing: `"Validation Failed: [<body>: must have required property 'defaultContact']"`. [CONFIRMED -- live API test 2026-04-04]

**IMPORTANT -- PATCH requires `siteAddress`:** Even for partial updates, `siteAddress` is always required. Error if missing: `"Validation Failed: [<body>: must have required property 'siteAddress']"`. [CONFIRMED -- live API test 2026-04-04]

---

### Quote

**Resource path:** `/jobs/{jobId}/quotes`, `/jobs/quotes`
**Description:** Price estimate for work on a job. Contains sections with line items.
**CRUD:** Create, Read, Update (draft only), Publish, Accept, Decline, Void

**NOTE:** The standalone `/quotes` endpoint does NOT exist (404). Use `/jobs/quotes` for cross-job listings or `/jobs/{jobId}/quotes` for job-scoped. [CONFIRMED -- live API test 2026-04-04]

| Field         | Type        | Required | Writable | Description               | Example           |
| ------------- | ----------- | -------- | -------- | ------------------------- | ----------------- |
| id            | integer     | yes      | no       | Unique identifier         | `500`             |
| versionNumber | number      | yes      | no       | Quote version within job  | `1`               |
| jobId         | integer     | yes      | no       | Parent job ID             | `20909314`        |
| guid          | string      | yes      | no       | Globally unique ID        | `"a1b2c3..."`     |
| title         | string      | yes      | yes      | Quote title               | `"Initial Quote"` |
| description   | string      | yes      | yes      | Description               |                   |
| footerText    | string      | no       | no       | Footer text               |                   |
| quoteDate     | string      | yes      | no       | Date created              |                   |
| isSent        | boolean     | yes      | no       | Has been sent             | `false`           |
| isAccepted    | boolean     | yes      | no       | Customer accepted         | `false`           |
| isSuperseded  | boolean     | yes      | no       | Replaced by newer version | `false`           |
| isLocked      | boolean     | yes      | no       | Locked for editing        | `false`           |
| createdAt     | string      | yes      | no       | ISO timestamp             |                   |
| lastModified  | string      | yes      | no       | ISO timestamp             |                   |
| publishedAt   | string      | yes      | no       | When published (nullable) |                   |
| dueDate       | string      | yes      | no       | Expiry date               |                   |
| declinedAt    | string      | yes      | no       | When declined (nullable)  |                   |
| voidedAt      | string      | yes      | no       | When voided (nullable)    |                   |
| dueDays       | number      | yes      | yes      | Days until due            | `30`              |
| sections      | array       | no       | yes      | QuoteSection array        |                   |
| deposit       | object      | no       | no       | Deposit info              |                   |
| quoteConfig   | QuoteConfig | no       | no       | Display configuration     |                   |

---

### JobPhase

**Resource path:** `/jobs/{jobId}/phases`, `/jobs/{jobId}/phases/{jobPhaseId}`
**Description:** A phase/stage within a job.
**CRUD:** Create, Read, Update, Void

| Field          | Type    | Required | Writable | Description       | Example                   |
| -------------- | ------- | -------- | -------- | ----------------- | ------------------------- |
| id             | integer | yes      | no       | Unique identifier | `1`                       |
| jobId          | integer | yes      | no       | Parent job        | `20909314`                |
| title          | string  | yes      | yes      | Phase title       | `"Plumbing"`              |
| description    | string  | yes      | yes      | Phase description | `"Kitchen plumbing work"` |
| status         | string  | yes      | no       | Phase status      | `"Active"`                |
| createdAt      | string  | yes      | no       | ISO timestamp     |                           |
| assignedGroups | array   | yes      | no       | Assigned groups   |                           |

---

### User

**Resource path:** `/users`, `/users/{userId}`
**Description:** Team members / employees.
**CRUD:** Read, Update (limited fields)

| Field         | Type           | Required | Writable | Description             | Example              |
| ------------- | -------------- | -------- | -------- | ----------------------- | -------------------- |
| id            | integer        | yes      | no       | Unique identifier       | `173187`             |
| firstName     | string         | yes      | yes      | First name              | `"Mike"`             |
| lastName      | string         | yes      | yes      | Last name               | `"Johnson"`          |
| email         | string         | yes      | no       | Email (read-only)       | `"mike@example.com"` |
| userType      | string         | yes      | no       | Role type               | `"tradesman"`        |
| status        | string         | yes      | no       | active/disabled/invited | `"active"`           |
| payRate       | number         | yes      | yes      | Hourly pay rate         | `35.00`              |
| chargeOutRate | number         | yes      | yes      | Hourly charge-out       | `85.00`              |
| address       | AddressContact | yes      | yes      | Address                 |                      |
| contactItems  | array          | no       | yes      | Phone, mobile, etc.     |                      |
| createdAt     | string         | yes      | no       | ISO timestamp           |                      |
| modifiedAt    | string         | yes      | no       | ISO timestamp           |                      |

---

### TimeEntry

**Resource path:** `/timeEntries`
**Description:** Employee time tracking records. Read-only via API.
**CRUD:** Read only [CONFIRMED -- live API test 2026-04-04]

| Field           | Type    | Required | Writable | Description                      | Example              |
| --------------- | ------- | -------- | -------- | -------------------------------- | -------------------- |
| timeEntryId     | integer | yes      | no       | Unique identifier                | `300`                |
| userId          | integer | yes      | no       | Worker ID                        | `173187`             |
| user            | string  | yes      | no       | Display name                     | `"Mike Johnson"`     |
| dateEntered     | string  | yes      | no       | Entry date                       | `"2025-01-15"`       |
| startTime       | string  | yes      | no       | Start (YYYY-MM-DD HH:MM, 15-min) | `"2025-01-15 07:00"` |
| endTime         | string  | yes      | no       | End time                         | `"2025-01-15 17:00"` |
| isLocked        | boolean | yes      | no       | Locked for payroll               | `false`              |
| payRate         | number  | yes      | no       | Pay rate/hr                      | `35.00`              |
| chargeOutRate   | number  | yes      | no       | Charge rate/hr                   | `85.00`              |
| paidDuration    | number  | yes      | no       | Hours paid                       | `8.0`                |
| workDescription | string  | yes      | no       | Work performed                   | `"Fixed pipe"`       |
| jobId           | integer | yes      | no       | Related job (nullable)           | `20909314`           |
| jobNo           | string  | yes      | no       | Job number (nullable)            | `"J-0042"`           |
| jobPhaseId      | integer | yes      | no       | Phase (nullable)                 | `1`                  |

---

### Enquiry

**Resource path:** `/enquiries`, `/enquiries/{enquiryId}`
**Description:** Incoming customer enquiries / leads.
**CRUD:** Create, Read [CONFIRMED -- live API test 2026-04-04]

| Field             | Type    | Required | Writable     | Description       | Example           |
| ----------------- | ------- | -------- | ------------ | ----------------- | ----------------- |
| id                | integer | yes      | no           | Unique identifier |                   |
| name              | string  | yes      | yes (create) | Enquiry name      | `"Bathroom reno"` |
| contactName       | string  | yes      | no           | Contact name      | `"John Smith"`    |
| description       | string  | yes      | yes (create) | Description       |                   |
| createdAt         | string  | yes      | no           | ISO timestamp     |                   |
| source            | string  | yes      | yes (create) | Lead source       | `"Website"`       |
| status            | string  | yes      | no           | Status            | `"New"`           |
| address1..Country | string  | yes      | yes (create) | Address fields    |                   |

---

### CalendarEvent

**Resource path:** `/calendarEvents`, `/calendarEvents/{calendarEventId}`
**Description:** Scheduled events, appointments, job bookings.
**CRUD:** Create, Read, Update (POST), Delete [CONFIRMED -- live API test 2026-04-04]

| Field       | Type    | Required | Writable | Description                    | Example                      |
| ----------- | ------- | -------- | -------- | ------------------------------ | ---------------------------- |
| id          | integer | yes      | no       | Unique identifier              |                              |
| userId      | integer | yes      | yes      | Assigned user                  | `173187`                     |
| title       | string  | yes      | yes      | Event title                    | `"Site visit"`               |
| eventType   | string  | yes      | yes      | JOB_PHASE/QUOTE/ESTIMATE/OTHER | `"JOB_PHASE"`                |
| startTime   | string  | yes      | yes      | ISO 8601 UTC, 15-min intervals | `"2025-01-15T07:00:00.000Z"` |
| endTime     | string  | yes      | yes      | ISO 8601 UTC                   | `"2025-01-15T17:00:00.000Z"` |
| jobId       | integer | yes      | yes      | Linked job (nullable)          | `20909314`                   |
| jobPhaseId  | integer | yes      | yes      | Linked phase (nullable)        | `1`                          |
| isActive    | boolean | yes      | no       | Active state                   | `true`                       |
| isRecurring | boolean | yes      | no       | Has recurrence                 | `false`                      |

---

### CustomerInvoice

**Resource path:** `/customerInvoices`, `/customerInvoices/{invoiceId}`
**Description:** Invoices to customers. Read-only via API.
**CRUD:** Read only [CONFIRMED -- live API test 2026-04-04]

| Field         | Type    | Required | Writable | Description             | Example     |
| ------------- | ------- | -------- | -------- | ----------------------- | ----------- |
| id            | integer | yes      | no       | Unique identifier       |             |
| jobId         | integer | yes      | no       | Related job             |             |
| customerId    | integer | yes      | no       | Customer                |             |
| title         | string  | yes      | no       | Invoice title           |             |
| invoiceNumber | string  | yes      | no       | Invoice number          | `"INV-001"` |
| subtotal      | number  | yes      | no       | Pre-tax total           | `500.00`    |
| taxValue      | number  | yes      | no       | Tax amount              | `75.00`     |
| taxRate       | number  | yes      | no       | Tax percentage          | `15.0`      |
| status        | string  | yes      | no       | Invoice status          |             |
| isSent        | boolean | yes      | no       | Has been sent           | `false`     |
| isFinal       | boolean | yes      | no       | Finalised               | `false`     |
| dueDate       | string  | yes      | no       | Due date                |             |
| paidAt        | string  | yes      | no       | Payment date (nullable) |             |

---

### Contact

**Resource path:** `/contacts`, `/contacts/{contactId}`
**Description:** Contact records linked to customers or sites.
**CRUD:** Create, Read, Update

Required on create: `firstName`, `email`, plus `customerId` or `siteId`.

---

### Note

**Resource path:** `/notes`, `/notes/{noteId}`
**Description:** Notes/comments attached to any entity (jobs, customers, quotes, sites, etc.)
**CRUD:** Create, Read, Update [CONFIRMED -- live API test 2026-04-04]

| Field       | Type    | Required | Writable | Description                                    | Example                                 |
| ----------- | ------- | -------- | -------- | ---------------------------------------------- | --------------------------------------- |
| id          | integer | yes      | no       | Unique identifier                              |                                         |
| text        | string  | yes      | yes      | Note body text                                 | `"Called customer, confirmed schedule"` |
| entityName  | string  | yes      | create   | Entity type (JOB, CUSTOMER, QUOTE, SITE, etc.) | `"JOB"`                                 |
| entityId    | integer | yes      | create   | Entity ID                                      | `20909314`                              |
| isPinned    | boolean | yes      | yes      | Pinned status                                  | `false`                                 |
| parentId    | integer | no       | create   | Parent note ID (for replies)                   | `null`                                  |
| createdById | integer | yes      | no       | Author user ID                                 | `173187`                                |
| createdAt   | string  | yes      | no       | ISO timestamp                                  |                                         |

**NOTE:** Sort field uses snake_case: `sortField=created_at`. This is the only known endpoint with this exception. [CONFIRMED -- live API test 2026-04-04]

---

### StockOnHand

**Resource path:** `/phases/{jobPhaseId}/stockOnHand`
**Description:** Materials/stock allocated to a job phase.
**CRUD:** Create, Read, Update, Delete

**NOTE:** The standalone `/stockOnHand` endpoint does NOT exist (404). Use `/phases/{jobPhaseId}/stockOnHand`. [CONFIRMED -- live API test 2026-04-04]

Key fields: `itemDescription`, `itemCost`, `itemPrice`, `itemQuantity`, `jobPhaseId`.

---

### Pricebook / PricebookItem

**Resource path:** `/pricebooks`, `/pricebooks/{id}/pricebookItems`, `/pricebooks/search`
**Description:** Supplier pricebooks with products, costs, and retail prices.
**CRUD:** Read, Search (no write)

Key fields: `supplierName`, `name`, `productCode`, `costPrice`, `retailPrice`, `unitType`.

---

### Company

**Resource path:** `/company`
**Description:** Authenticated company profile and settings.
**CRUD:** Read only [CONFIRMED -- live API test 2026-04-04]

Key fields: `guid`, `prefix`, `name`, `active`, `contact`, `settings` (array of key-value pairs), `tax` (rate and type).

**Tax:** `{"rate": 15, "type": "GST"}` (NZ GST) [CONFIRMED -- live API test 2026-04-04]
**Settings include:** timezone, currency, date format, prefix [CONFIRMED -- live API test 2026-04-04]

---

### Favourites

**Resource path:** `/favourites`, `/favourites/{sectionId}`
**Description:** Template sections with line items for quick-adding to quotes.
**CRUD:** Read only [CONFIRMED -- live API test 2026-04-04]

---

## Shared Sub-Models

### PersonContact

`id`, `firstName`, `lastName`, `position`, `company`, `contactItems[]`

### AddressContact

`id`, `address1`, `address2`, `addressSuburb`, `addressCity`, `addressRegion`, `addressPostcode`, `addressCountry`

### ContactItem

`id`, `contactType` (email/phone/mobile/other/fax/website), `contactValue`

### QuoteSection

`sectionId`, `name`, `sortOrder`, `parentSectionId`, `description`, `selectionMode` (Fixed/Optional/Multiple Choice), `lineItems[]`, `sections[]` (nested)

---

## Entity Relationship Diagram

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
                               │                        │
      ┌──────────┐             │ 1:N                    │ 1:N
      │   Site   │<──N:1──     ▼                        ▼
      └──────────┘        ┌──────────────┐         ┌──────────┐
            │             │CalendarEvent │         │ LineItem │
            │             └──────────────┘         └──────────┘
            │ 1:N
            ▼              ┌──────────────┐
      ┌──────────┐         │ TimeEntry    │ (read-only)
      │ Contact  │         └──────────────┘
      └──────────┘
                           ┌──────────────┐
                           │ Cust.Invoice │ (read-only)
                           └──────────────┘

      ┌──────────┐  1:N   ┌──────────────┐  N:M  ┌─────────────┐
      │Pricebook │───────>│PricebookItem │<─────>│ PricingTier │
      └──────────┘        └──────────────┘       └─────────────┘
```

---

## State Machines

### Job Lifecycle

```
[Draft] ──(automatic)──> [To Price] ──price──> [Active] ──complete──> [Completed]
                              │
                              ├──hold──> [On Hold] ──resume──> [Active]
                              └──archive──> [Archived]
```

**IMPORTANT: Draft is transient.** POST create returns `"status": "Draft"` but GET immediately returns `"To Price"` for Quote-type jobs. [CONFIRMED -- live API test 2026-04-04]

**Transitions:**

| From            | Action / Trigger       | To        | Reversible? | Side Effects                         |
| --------------- | ---------------------- | --------- | ----------- | ------------------------------------ |
| Draft           | (automatic)            | To Price  | No          | Immediate for Quote jobs [CONFIRMED] |
| To Price/Active | POST /jobs/{id}/hold   | On Hold   | Yes         | Requires holdUntil + notes           |
| On Hold         | POST /jobs/{id}/resume | Active    | N/A         |                                      |
| Active          | (all phases completed) | Completed | No          |                                      |

**Per-State Capabilities:**

| State     | Can Update? | Can Delete? | Available Actions          | Notes                   |
| --------- | ----------- | ----------- | -------------------------- | ----------------------- |
| Draft     | Yes (PUT)   | No          | (transient)                | Immediately transitions |
| To Price  | No          | No          | hold, create phases/quotes | [CONFIRMED]             |
| Active    | No          | No          | hold, create phases/quotes |                         |
| On Hold   | No          | No          | resume                     |                         |
| Completed | No          | No          | None                       |                         |

### Quote Lifecycle

```
[Draft] ──publish──> [Published] ──markAsSent──> [Sent] ──accept──> [Accepted]
                          │                        │
                          └──void──> [Voided]       ├──decline──> [Declined]
                                                   └──void────> [Voided]
```

**Transitions:**

| From      | Action        | To         | Reversible? | Side Effects                            |
| --------- | ------------- | ---------- | ----------- | --------------------------------------- |
| Draft     | publish       | Published  | No          | isLocked=true                           |
| Published | markAsSent    | Sent       | No          | isSent=true                             |
| Sent      | accept        | Accepted   | No          | isAccepted=true; may return deposit URL |
| Sent      | decline       | Declined   | No          | declinedAt set                          |
| Any       | void          | Voided     | No          | voidedAt set                            |
| Any       | (new version) | Superseded | No          | isSuperseded=true                       |

---

## Business Rules

### Ordering / Dependency Rules

- Must create Customer before non-draft Job (customerId required) [CONFIRMED -- live API test 2026-04-04]
- Must create Site before non-draft Job (siteId required) [CONFIRMED -- live API test 2026-04-04]
- Must create Job before Quote (quotes are sub-resources)
- Draft jobs do NOT require customerId or siteId [CONFIRMED -- live API test 2026-04-04]

### Field-Level Rules

- `customerFullName` must be non-empty (pattern `\S`)
- `firstName` required on PersonContact/PersonPayload [CONFIRMED -- live API test 2026-04-04]
- Site create requires `defaultContact` with `firstName` and `lastName` [CONFIRMED -- live API test 2026-04-04]
- Site PATCH requires `siteAddress` even for partial updates [CONFIRMED -- live API test 2026-04-04]
- Calendar event times must be ISO 8601 UTC in 15-minute intervals
- Pricebook search requires minimum 3 characters
- `jobType` must be `"Quote"`, `"Estimate"`, or `"Charge Up"` -- no other values accepted [CONFIRMED -- live API test 2026-04-04]

### Cascading Effects

- POST /customers returns 303 redirect if duplicate customer exists
- POST /sites returns 303 redirect if duplicate site exists
- Voiding a job phase is irreversible
- Accepting a quote may generate a deposit invoice with payment URL

### Computed / Read-Only Fields

- `createdAt`, `lastModified` server-set [CONFIRMED -- live API test 2026-04-04]
- `companyId` auto-assigned on create [CONFIRMED -- live API test 2026-04-04]
- `pricingTier` auto-assigned on customer create [CONFIRMED -- live API test 2026-04-04]
- Quote totals computed from sections/line items
- Financial summaries are server-computed aggregates

---

## Field Format Reference

| Format          | Pattern            | Example                    | Notes                                       |
| --------------- | ------------------ | -------------------------- | ------------------------------------------- |
| Date            | `YYYY-MM-DD`       | `2025-01-15`               | Filters, dateEntered                        |
| DateTime        | ISO 8601           | `2025-01-15T09:00:00.000Z` | createdAt, calendar events                  |
| Time Entry Time | `YYYY-MM-DD HH:MM` | `2025-01-15 07:00`         | 15-min intervals                            |
| Currency        | number             | `85.50`                    | No symbol; company settings define currency |
| ID              | integer            | `9778208`                  | All IDs are integers [CONFIRMED]            |
| Cursor          | integer            | `0`                        | 0-based integer for pagination [CONFIRMED]  |

---

## Enum Value Reference

| Entity        | Field               | Allowed Values                                                                                                      | Default | Notes                                |
| ------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------ |
| Job           | jobType             | `Quote`, `Estimate`, `Charge Up`                                                                                    | --      | **ONLY these 3.** [CONFIRMED]        |
| Job           | filterJobStatus     | `Active`, `Completed`, `Estimate Rejected`, `Estimate Sent`, `Inactive`, `Quote Sent`, `Quote Rejected`, `To Price` | --      |                                      |
| Job           | status (observed)   | `Draft` (transient), `To Price`                                                                                     | --      | [CONFIRMED]                          |
| User          | userType            | `contractor`, `time_sheet_only`, `field_worker`, `apprentice`, `tradesman`, `advisor`, `full_user`                  | --      |                                      |
| User          | status              | `active`, `disabled`, `invited`                                                                                     | --      |                                      |
| Quote         | filterStatus        | `draft`, `accepted`, `voided`, `superseded`, `declined`, `published`, `emailSent`, `emailNotSent`                   | --      |                                      |
| CalendarEvent | eventType           | `JOB_PHASE`, `QUOTE`, `ESTIMATE`, `OTHER`                                                                           | --      | Required                             |
| CalendarEvent | frequency           | `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`, `NEVER`                                                                     | `NEVER` |                                      |
| CalendarEvent | repeatEndType       | `NEVER`, `ON_DATE`, `AFTER`                                                                                         | `NEVER` |                                      |
| CalendarEvent | filterCalendarRange | `DAY`, `THREE_DAY`, `WEEK`, `FORTNIGHT`, `MONTH`                                                                    | --      |                                      |
| ContactItem   | contactType         | `email`, `phone`, `mobile`, `other`, `fax`, `website`                                                               | --      |                                      |
| Note          | entityName          | `JOB`, `CUSTOMER`, `CUSTOMER_INVOICE`, `QUOTE`, `SITE`, `TASK`, `ENQUIRY`, `JOB_PHASE`                              | --      |                                      |
| Note          | sortField           | `created_at`                                                                                                        | --      | **snake_case exception** [CONFIRMED] |
| QuoteSection  | selectionMode       | `Fixed`, `Optional`, `Multiple Choice`                                                                              | --      |                                      |
| Sort          | sortOrder           | `asc`, `desc`                                                                                                       | `asc`   |                                      |

---

_Generated from the investigation questionnaire, Phase 3. Updated 2026-04-04 with live API test corrections._
