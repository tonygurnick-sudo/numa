---
api_name: 'Fergus'
api_slug: 'fergus'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-03-30'
updated_date: '2026-04-04'
update_source: 'live API testing'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# Fergus -- Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. Contains all write operation patterns including
> create, update, delete, state transitions, and nested record operations.
> **Updated 2026-04-04 with corrections from live API testing.**

---

## Write Capabilities Summary

| Operation         | Supported | Method | Notes                                                                   |
| ----------------- | --------- | ------ | ----------------------------------------------------------------------- |
| Create            | Yes       | POST   | Jobs, customers, sites, enquiries, calendar events, contacts, notes     |
| Full replace      | Yes       | PUT    | Draft jobs, customers                                                   |
| Partial update    | Yes       | PATCH  | Sites (siteAddress always required!), users, notes                      |
| Delete            | Limited   | DELETE | Customers, calendar events only. **Must NOT send Content-Type header.** |
| Soft delete       | Yes       | POST   | Sites (archive/restore)                                                 |
| Bulk create       | No        | --     | All writes are single-record                                            |
| Bulk update       | No        | --     |                                                                         |
| Bulk delete       | No        | --     |                                                                         |
| State transitions | Yes       | POST   | Job hold/resume, quote lifecycle                                        |
| File upload       | No        | --     | No file endpoints                                                       |

---

## Common Patterns

### Pattern 1: Create a Job [CONFIRMED -- live API test 2026-04-04]

**Non-draft job (immediately transitions to "To Price"):**

```http
POST /jobs
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "jobType": "Quote",
  "title": "Kitchen renovation",
  "description": "Full kitchen refit including plumbing and electrical",
  "customerId": 9778208,
  "siteId": 8169663
}
```

**Response (201 Created):** [CONFIRMED -- live API test 2026-04-04]

```json
{
  "result": "success",
  "data": {
    "id": 20909314,
    "description": "Full kitchen refit...",
    "jobType": "Quote",
    "status": "Draft",
    "customer": { "id": 9778208, "customerFullName": "Smith Ltd" },
    "siteAddress": { "id": 8169663, "name": "Main Office" },
    "links": [
      { "href": "/jobs/20909314", "rel": "self", "type": "GET" },
      { "href": "/jobs/20909314", "rel": "edit", "type": "PUT" },
      { "href": "/jobs/20909314/finalise", "rel": "finalise", "type": "POST" }
    ]
  }
}
```

**IMPORTANT -- Job status is transient:** Response shows `"status": "Draft"` but subsequent GET returns `"status": "To Price"` for Quote-type jobs. Draft is immediately transitional. [CONFIRMED -- live API test 2026-04-04]

**IMPORTANT -- Valid jobType values:** ONLY `"Quote"`, `"Estimate"`, `"Charge Up"`. "Service" and "Project" do NOT exist. Error: `"The jobType must be one of 'Quote', 'Estimate', or 'Charge Up'"`. [CONFIRMED -- live API test 2026-04-04]

**Required fields (non-draft):** `jobType`, `title`, `description`, `customerId`, `siteId`
**Required fields (draft):** `jobType`, `title`, `isDraft: true`

**Draft job:**

```http
POST /jobs
Content-Type: application/json

{
  "isDraft": true,
  "jobType": "Estimate",
  "title": "Initial assessment"
}
```

**Server-generated fields:** `id`, `createdAt`, `lastModified`, `status`
**Idempotency:** None -- each POST creates a new job

---

### Pattern 2: Update (Full Replace with PUT)

Used for draft jobs and customers. **All required fields must be provided.**

**Update draft job:**

```http
PUT /jobs/{jobId}
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "jobType": "Quote",
  "title": "Updated title",
  "description": "Updated description",
  "customerId": 9778208,
  "siteId": 8169663
}
```

**Response (201):**

```json
{
  "result": "success",
  "data": {
    "id": 20909314,
    "description": "Updated description",
    "status": "Draft"
  }
}
```

**Behavior:**

- Only works on draft jobs. Returns error for finalized jobs.
- All required fields must be included.

**Update customer (full replace):** [CONFIRMED -- live API test 2026-04-04]

```http
PUT /customers/{customerId}
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "customerFullName": "Smith Plumbing Ltd (Updated)",
  "mainContact": {
    "firstName": "Jane",
    "lastName": "Smith-Jones",
    "contactItems": [
      {"contactType": "email", "contactValue": "jane@smith.co.nz"},
      {"contactType": "mobile", "contactValue": "+64 21 555 9876"}
    ]
  },
  "physicalAddress": {
    "address1": "789 New Street",
    "addressCity": "Wellington",
    "addressCountry": "New Zealand"
  }
}
```

**Required:** `customerFullName`, `mainContact` (with `firstName`) [CONFIRMED -- live API test 2026-04-04]

---

### Pattern 3: Update (Partial with PATCH)

Used for sites, users, notes.

**Update site:** [CONFIRMED -- live API test 2026-04-04]

**IMPORTANT: `siteAddress` is REQUIRED even on PATCH.** Error if missing: `"Validation Failed: [<body>: must have required property 'siteAddress']"`. [CONFIRMED -- live API test 2026-04-04]

```http
PATCH /sites/{siteId}
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "New Site Name",
  "siteAddress": {
    "address1": "456 Updated St",
    "addressCity": "Auckland",
    "addressCountry": "New Zealand"
  }
}
```

**Response (200):** Returns updated site. May return 303 if the update creates a duplicate.

**Update user (partial):**

```http
PATCH /users/{userId}
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "firstName": "Michael",
  "payRate": 40.00,
  "chargeOutRate": 95.00
}
```

**Required:** At least one field must be provided (enforced by `minProperties: 1`).

**Behavior:**

- Only included fields are modified; omitted fields are untouched.
- Sending `null` for a field: behavior not documented; avoid.

**Update note:**

```http
PATCH /notes/{noteId}
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "text": "Updated note text",
  "isPinned": true
}
```

---

### Pattern 4: Delete

**IMPORTANT: DELETE requests must NOT include Content-Type header.** Sending `Content-Type: application/json` on DELETE causes: `"Body cannot be empty when content-type is set to 'application/json'"`. Either omit Content-Type entirely or send an empty JSON body `{}`. [CONFIRMED -- live API test 2026-04-04]

**Delete customer:**

```http
DELETE /customers/{customerId}
Host: api.fergus.com
Authorization: Bearer {token}
```

**Response:** 204 No Content

**Delete calendar event:**

```http
DELETE /calendarEvents/{calendarEventId}
Host: api.fergus.com
Authorization: Bearer {token}
```

With body (if recurring -- must omit Content-Type or include body):

```json
{
  "deleteAllRecurring": false
}
```

**Note:** Request body may be required for calendar event deletion to specify whether to delete all recurring instances.

**Behavior:**

- Hard deletes -- no undo
- Customer deletion: may fail if customer has associated jobs
- Calendar event: must specify `deleteAllRecurring` for recurring events
- **No Content-Type header on DELETE requests** [CONFIRMED -- live API test 2026-04-04]

---

### Pattern 5: State Transitions

#### Finalise Draft Job [NEEDS VERIFICATION]

```http
POST /jobs/{jobId}/finalise
Host: api.fergus.com
Authorization: Bearer {token}
```

**NOTE:** The HATEOAS link for finalise IS returned in job create responses (`{"href": "/jobs/20909314/finalise", "rel": "finalise", "type": "POST"}`), but calling this endpoint returns 404. This may be a different path or not yet implemented for the partner API. [NEEDS VERIFICATION -- live API test 2026-04-04]

#### Put Job on Hold

```http
POST /jobs/{jobId}/hold
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "holdUntil": "2025-04-15",
  "notes": "Waiting for customer approval"
}
```

**Response:** 204 No Content
**Required:** Both `holdUntil` (date) and `notes` (string)

#### Resume Job

```http
POST /jobs/{jobId}/resume
Host: api.fergus.com
Authorization: Bearer {token}
```

**Response:** 204 No Content

#### Quote Lifecycle Transitions

**Publish:**

```http
POST /jobs/quotes/{quoteId}/publish
Authorization: Bearer {token}
Content-Type: application/json
```

Side effect: `isLocked` becomes true.

**Mark as Sent:**

```http
POST /jobs/quotes/{quoteId}/markAsSent
Authorization: Bearer {token}
Content-Type: application/json
```

Side effect: `isSent` becomes true.

**Accept:**

```http
POST /jobs/quotes/{quoteId}/accept
Authorization: Bearer {token}
Content-Type: application/json
```

Side effects: `isAccepted` becomes true. Response may include `depositPaymentUrl` if deposit is configured.

**Decline:**

```http
POST /jobs/quotes/{quoteId}/decline
Authorization: Bearer {token}
Content-Type: application/json
```

Side effect: `declinedAt` set.

**Void:**

```http
POST /jobs/quotes/{quoteId}/void
Authorization: Bearer {token}
Content-Type: application/json
```

Side effect: `voidedAt` set. Irreversible.

#### Void Job Phase

```http
POST /jobs/{jobId}/phases/{jobPhaseId}/void
Host: api.fergus.com
Authorization: Bearer {token}
```

**Response:** 204 No Content. **Irreversible.**

#### Archive / Restore Site

```http
POST /sites/{siteId}/archive
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json
```

```http
POST /sites/{siteId}/restore
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json
```

---

### Pattern 6: Create Nested / Related Records

**Create quote with sections and line items:**

```http
POST /jobs/{jobId}/quotes
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "title": "Bathroom Renovation Quote",
  "dueDays": 30,
  "sections": [
    {
      "name": "Labour",
      "description": "All labour costs",
      "lineItems": [
        {"description": "Plumber - day rate", "quantity": 3, "unitPrice": 680.00},
        {"description": "Electrician - half day", "quantity": 1, "unitPrice": 340.00}
      ]
    },
    {
      "name": "Materials",
      "lineItems": [
        {"description": "Bathroom fixtures", "quantity": 1, "unitPrice": 2500.00},
        {"description": "Plumbing supplies", "quantity": 1, "unitPrice": 450.00}
      ]
    }
  ]
}
```

**Create note on a job:**

```http
POST /notes
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "text": "Customer called to confirm start date of Monday",
  "entityName": "JOB",
  "entityId": 20909314,
  "isPinned": false
}
```

**Create contact for a customer:**

```http
POST /contacts
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "firstName": "Bob",
  "lastName": "Builder",
  "customerId": 9778208,
  "contactItems": [
    {"contactType": "email", "contactValue": "bob@smith.co.nz"},
    {"contactType": "mobile", "contactValue": "+64 21 555 4321"}
  ]
}
```

Required: `firstName`, `email` contactItem, plus either `customerId` or `siteId`.

**Create calendar event:**

```http
POST /calendarEvents
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "eventTitle": "Site inspection - Smith residence",
  "eventType": "JOB_PHASE",
  "startTime": "2025-04-01T09:00:00.000Z",
  "endTime": "2025-04-01T11:00:00.000Z",
  "userId": 173187,
  "jobId": 20909314,
  "jobPhaseId": 1,
  "description": "Initial inspection before plumbing work begins"
}
```

Required: `startTime`, `endTime`, `eventTitle`, `eventType`. Times must be ISO 8601 UTC in 15-min intervals.

**Create enquiry:**

```http
POST /enquiries
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "Bathroom renovation enquiry",
  "email": "john@example.com",
  "phoneNumber": "+64 9 555 1111",
  "description": "Looking for a quote on bathroom renovation",
  "source": "Website",
  "address1": "123 Main St",
  "addressCity": "Auckland",
  "addressCountry": "New Zealand"
}
```

Required: `name`, `email`, `phoneNumber`, `description`, `source`, `address1`.

**Create site:** [CONFIRMED -- live API test 2026-04-04]

```http
POST /sites
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "New Office Site",
  "defaultContact": {
    "firstName": "Tom",
    "lastName": "Builder"
  },
  "siteAddress": {
    "address1": "42 Willis St",
    "addressCity": "Wellington",
    "addressCountry": "NZ"
  }
}
```

**IMPORTANT: `defaultContact` is REQUIRED** (with `firstName`, `lastName`). `siteAddress` is also REQUIRED. Error if missing: `"Validation Failed: [<body>: must have required property 'defaultContact']"`. [CONFIRMED -- live API test 2026-04-04]

Response (201): `{"result": "success", "data": {"id": 8169663, "name": "New Office Site", ...}}`

---

## Field Validation Rules [CONFIRMED -- live API test 2026-04-04]

| Entity           | Field                    | Rule                                        | Error if Violated                                                                   |
| ---------------- | ------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Customer         | customerFullName         | Non-empty, min 1 char, pattern `\S`         | "The customerFullName must be at least 1 character long"                            |
| Customer         | mainContact.firstName    | Required                                    | Validation error                                                                    |
| Site             | defaultContact           | **REQUIRED on create**                      | `"must have required property 'defaultContact'"` [CONFIRMED]                        |
| Site             | defaultContact.firstName | Required                                    | Validation error                                                                    |
| Site             | defaultContact.lastName  | Required                                    | Validation error                                                                    |
| Site             | siteAddress              | **REQUIRED on create AND PATCH**            | `"must have required property 'siteAddress'"` [CONFIRMED]                           |
| Job              | jobType                  | Must be `Quote`, `Estimate`, or `Charge Up` | `"The jobType must be one of 'Quote', 'Estimate', or 'Charge Up'"` [CONFIRMED]      |
| Job (non-draft)  | customerId               | Required                                    | Validation error                                                                    |
| Job (non-draft)  | siteId                   | Required                                    | Validation error                                                                    |
| CalendarEvent    | startTime/endTime        | ISO 8601 UTC                                | "Must be a valid ISO 8601 date format in UTC"                                       |
| CalendarEvent    | eventType                | Must be JOB_PHASE/QUOTE/ESTIMATE/OTHER      | "Must be one of..."                                                                 |
| User             | (update)                 | At least one field                          | "At least one field must be provided"                                               |
| User             | payRate                  | >= 0                                        | "Must be greater than 0"                                                            |
| User             | chargeOutRate            | >= 0                                        | "Must be greater than 0"                                                            |
| Pricebook search | search                   | Min 3 characters                            | Validation error                                                                    |
| DELETE           | Content-Type             | Must NOT be set                             | `"Body cannot be empty when content-type is set to 'application/json'"` [CONFIRMED] |

---

## Server-Side Defaults [CONFIRMED -- live API test 2026-04-04]

| Entity        | Field         | Default Value                                     | When Applied   |
| ------------- | ------------- | ------------------------------------------------- | -------------- |
| All           | id            | auto-generated (integer)                          | create         |
| All           | createdAt     | current timestamp                                 | create         |
| All           | lastModified  | current timestamp                                 | create, update |
| Customer      | companyId     | auto-assigned                                     | create         |
| Customer      | pricingTier   | auto-assigned (Default tier)                      | create         |
| Job           | status        | "Draft" (transient, becomes "To Price" for Quote) | create         |
| Job           | onHold        | false                                             | create         |
| Job           | archived      | false                                             | create         |
| CalendarEvent | frequency     | "NEVER"                                           | create         |
| CalendarEvent | repeatEndType | "NEVER"                                           | create         |
| Note          | isPinned      | false                                             | create         |
| Quote         | isSent        | false                                             | create         |
| Quote         | isAccepted    | false                                             | create         |
| Quote         | isLocked      | false                                             | create         |

---

## Worked Examples

### Example 1: Full job creation workflow [CONFIRMED -- live API test 2026-04-04]

> Create a customer, create a site, create a job.

**Step 1: Create customer**

```http
POST /customers
Content-Type: application/json

{"customerFullName": "Wellington Builders Ltd", "mainContact": {"firstName": "Tom", "contactItems": [{"contactType": "email", "contactValue": "tom@wb.co.nz"}]}}
```

Response (201): `{"result": "success", "data": {"id": 9778212, "customerFullName": "Wellington Builders Ltd", "companyId": 12345, "pricingTier": {"id": 1, "name": "Default"}}}`

**Step 2: Create site**

```http
POST /sites
Content-Type: application/json

{"name": "42 Willis St", "defaultContact": {"firstName": "Tom", "lastName": "Builder"}, "siteAddress": {"address1": "42 Willis St", "addressCity": "Wellington", "addressCountry": "NZ"}}
```

Response (201): `{"result": "success", "data": {"id": 8169663, "name": "42 Willis St"}}`

**Step 3: Create job**

```http
POST /jobs
Content-Type: application/json

{"jobType": "Quote", "title": "Office fitout", "description": "Complete office renovation", "customerId": 9778212, "siteId": 8169663}
```

Response (201): `{"result": "success", "data": {"id": 20909314, "status": "Draft", "links": [{"href": "/jobs/20909314", "rel": "self", "type": "GET"}, {"href": "/jobs/20909314/finalise", "rel": "finalise", "type": "POST"}]}}`

**Note:** Status is "Draft" in create response, becomes "To Price" on GET. [CONFIRMED]

---

### Example 2: Update quote sections (full replace)

> Update a draft quote by replacing all sections.

```http
PUT /jobs/20909314/quotes/600
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "title": "Revised Office Fitout Quote",
  "sections": [
    {"name": "Labour", "lineItems": [{"description": "Carpenter", "quantity": 6, "unitPrice": 700}, {"description": "Electrician", "quantity": 2, "unitPrice": 750}]},
    {"name": "Materials", "lineItems": [{"description": "Timber & supplies", "quantity": 1, "unitPrice": 3500}]}
  ]
}
```

**Notes:**

- This replaces ALL sections. Omitted sections are removed.
- Only works while quote is in Draft state (before publish).

---

### Example 3: Schedule a recurring calendar event

> Create a weekly Monday morning site meeting.

```http
POST /calendarEvents
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "eventTitle": "Weekly site meeting - Smith project",
  "eventType": "JOB_PHASE",
  "startTime": "2025-04-07T08:00:00.000Z",
  "endTime": "2025-04-07T09:00:00.000Z",
  "userId": 173187,
  "jobId": 20909314,
  "jobPhaseId": 1,
  "frequency": "WEEKLY",
  "interval": 1,
  "repeatEndType": "ON_DATE",
  "repeatEndDate": "2025-06-30"
}
```

---

## Gotchas & Counter-Exceptions

1. **Calendar event update uses POST, not PUT/PATCH:** `POST /calendarEvents/{id}` with full body. This is non-standard REST.
2. **Calendar event delete requires a body:** Must include `{"deleteAllRecurring": false}` even for non-recurring events.
3. **Quote update replaces all sections:** PUT on a quote is a full replacement of sections. There is no partial section update.
4. **Customer/site create may return 303:** If a duplicate is detected, you get a redirect to the existing resource instead of a 201. Handle both status codes.
5. **Job update only works on drafts:** Once the status transitions from Draft, jobs are immutable via the API. There is no PATCH endpoint for active jobs.
6. **User email is read-only:** Cannot change a user's email via the API.
7. **Site create requires `defaultContact`:** Not just `name` and `siteAddress`. Must include `defaultContact` with `firstName` and `lastName`. [CONFIRMED -- live API test 2026-04-04]
8. **PATCH /sites requires `siteAddress`:** Even for partial updates. [CONFIRMED -- live API test 2026-04-04]
9. **DELETE must NOT send Content-Type header:** Causes `"Body cannot be empty when content-type is set to 'application/json'"`. [CONFIRMED -- live API test 2026-04-04]
10. **jobType only accepts Quote/Estimate/Charge Up.** "Service" and "Project" are NOT valid. [CONFIRMED -- live API test 2026-04-04]
11. **POST /jobs/{id}/finalise returns 404.** Despite being in HATEOAS links. [NEEDS VERIFICATION]

---

## Dangerous Operations

> Operations that are destructive, irreversible, or have significant side effects.
> The workspace agent should confirm with the user before executing these.

| Operation                             | Why Dangerous                              | Safeguard                                                                         |
| ------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| DELETE /customers/{id}                | Permanently deletes customer               | Confirm with user; check for associated jobs first. **Omit Content-Type header.** |
| POST /jobs/{id}/phases/{phaseId}/void | Irreversibly voids a job phase             | Confirm with user                                                                 |
| POST /jobs/quotes/{id}/void           | Irreversibly voids a quote                 | Confirm with user                                                                 |
| POST /jobs/quotes/{id}/accept         | Accepts quote, may trigger invoice/deposit | Confirm with user                                                                 |
| POST /disconnect                      | Revokes all API tokens for the connection  | Confirm with user                                                                 |

---

_Generated from the investigation questionnaire, Phases 3-4. Updated 2026-04-04 with live API test corrections._
