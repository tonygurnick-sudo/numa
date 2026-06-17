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
companions: 01=api-rules, 01a=domain-model, 01b=query-patterns, 01d=events+errors
confidence: every fact live-API-confirmed 2026-04-04 unless tagged [INFERRED] or [VERIFIED <date>]
---

# Fergus — Mutation Patterns

All write operations: create, update, delete, state transitions, nested records. Paths are FLAT (`/jobs`); connector injects `/api/partner`. All writes single-record (no bulk).

## Write Capabilities

| Operation                 | Supported | Method | Notes                                                               |
| ------------------------- | --------- | ------ | ------------------------------------------------------------------- |
| Create                    | Yes       | POST   | jobs, customers, sites, enquiries, calendar events, contacts, notes |
| Full replace              | Yes       | PUT    | draft jobs, customers                                               |
| Partial update            | Yes       | PATCH  | sites (siteAddress always required!), users, notes                  |
| Delete                    | Limited   | DELETE | customers, calendar events only. **NO Content-Type header.**        |
| Soft delete               | Yes       | POST   | sites (archive/restore)                                             |
| Bulk create/update/delete | No        | —      | all writes single-record                                            |
| State transitions         | Yes       | POST   | job hold/resume, quote lifecycle                                    |
| File upload               | No        | —      | no file endpoints                                                   |

## Pattern 1: Create a Job

Non-draft (immediately → "To Price"):
`POST /jobs` body `{"jobType":"Quote","title":"Kitchen renovation","description":"Full kitchen refit including plumbing and electrical","customerId":9778208,"siteId":8169663}`
→ 201: `{"result":"success","data":{"id":20909314,"description":"Full kitchen refit...","jobType":"Quote","status":"Draft","customer":{"id":9778208,"customerFullName":"Smith Ltd"},"siteAddress":{"id":8169663,"name":"Main Office"},"links":[{"href":"/jobs/20909314","rel":"self","type":"GET"},{"href":"/jobs/20909314","rel":"edit","type":"PUT"},{"href":"/jobs/20909314/finalise","rel":"finalise","type":"POST"}]}}`

- Status transient: `"Draft"` on create, `"To Price"` on subsequent GET (Quote jobs).
- jobType ONLY `"Quote"`/`"Estimate"`/`"Charge Up"`; "Service"/"Project" invalid. Err: `"The jobType must be one of 'Quote', 'Estimate', or 'Charge Up'"`.
- Required (non-draft): `jobType`, `title`, `description`, `customerId`, `siteId`. Required (draft): `jobType`, `title`, `isDraft:true`.
- Draft: `POST /jobs` body `{"isDraft":true,"jobType":"Estimate","title":"Initial assessment"}`.
- Server-generated: `id`, `createdAt`, `lastModified`, `status`. No idempotency — each POST creates a new job.

## Pattern 2: Update (Full Replace, PUT)

Draft jobs and customers. ALL required fields must be provided.
Draft job: `PUT /jobs/{jobId}` body `{"jobType":"Quote","title":"Updated title","description":"Updated description","customerId":9778208,"siteId":8169663}` → 201. Only works on draft jobs (error for finalized). All required fields must be included.
Customer (full replace): `PUT /customers/{customerId}` body `{"customerFullName":"Smith Plumbing Ltd (Updated)","mainContact":{"firstName":"Jane","lastName":"Smith-Jones","contactItems":[{"contactType":"email","contactValue":"jane@smith.co.nz"},{"contactType":"mobile","contactValue":"+64 21 555 9876"}]},"physicalAddress":{"address1":"789 New Street","addressCity":"Wellington","addressCountry":"New Zealand"}}`. Required: `customerFullName`, `mainContact` (with `firstName`).

## Pattern 3: Update (Partial, PATCH)

Sites, users, notes.
Site — **`siteAddress` REQUIRED even on PATCH**. Err: `"Validation Failed: [<body>: must have required property 'siteAddress']"`. `PATCH /sites/{siteId}` body `{"name":"New Site Name","siteAddress":{"address1":"456 Updated St","addressCity":"Auckland","addressCountry":"New Zealand"}}` → 200 (or 303 if update creates a duplicate).
User (partial): `PATCH /users/{userId}` body `{"firstName":"Michael","payRate":40.00,"chargeOutRate":95.00}`. Required: ≥1 field (`minProperties:1`). Only included fields modified; omitted untouched; avoid sending `null` (undocumented).
Note: `PATCH /notes/{noteId}` body `{"text":"Updated note text","isPinned":true}`.

## Pattern 4: Delete

**DELETE must NOT include Content-Type header.** Sending `Content-Type: application/json` causes `"Body cannot be empty when content-type is set to 'application/json'"`. Omit Content-Type, or send empty body `{}`.
Customer: `DELETE /customers/{customerId}` → 204. May fail if customer has associated jobs. Hard delete, no undo.
Calendar event: `DELETE /calendarEvents/{calendarEventId}`. Body required to specify recurring behavior: `{"deleteAllRecurring":false}` (or `true`); must omit Content-Type or include body.

## Pattern 5: State Transitions

Finalise draft job: `PUT /jobs/{jobId}/finalise`. Verb is **PUT, not POST** — the HATEOAS link's `"type":"POST"` is a server bug; OpenAPI spec at `https://api.fergus.com/docs/json` defines `put` only, and the `fergus-mcp` SDK calls `client.put('/jobs/${jobId}/finalise')`. POST → 404. Response schema `JobResponse`. [VERIFIED 2026-05-19]
Hold: `POST /jobs/{jobId}/hold` body `{"holdUntil":"2025-04-15","notes":"Waiting for customer approval"}` → 204. Required: both `holdUntil` (date) + `notes` (string).
Resume: `POST /jobs/{jobId}/resume` → 204.
Quote lifecycle (all `POST /jobs/quotes/{quoteId}/{action}`, Content-Type: application/json):

- `publish` → `isLocked=true`
- `markAsSent` → `isSent=true`
- `accept` → `isAccepted=true`; response may include `depositPaymentUrl` if deposit configured
- `decline` → `declinedAt` set
- `void` → `voidedAt` set; irreversible
  Void job phase: `POST /jobs/{jobId}/phases/{jobPhaseId}/void` → 204. **Irreversible.**
  Archive/restore site: `POST /sites/{siteId}/archive`, `POST /sites/{siteId}/restore`.

## Pattern 6: Create Nested / Related Records

Quote with sections/line items: `POST /jobs/{jobId}/quotes` body `{"title":"Bathroom Renovation Quote","dueDays":30,"sections":[{"name":"Labour","description":"All labour costs","lineItems":[{"description":"Plumber - day rate","quantity":3,"unitPrice":680.00},{"description":"Electrician - half day","quantity":1,"unitPrice":340.00}]},{"name":"Materials","lineItems":[{"description":"Bathroom fixtures","quantity":1,"unitPrice":2500.00},{"description":"Plumbing supplies","quantity":1,"unitPrice":450.00}]}]}`
Note on a job: `POST /notes` body `{"text":"Customer called to confirm start date of Monday","entityName":"JOB","entityId":20909314,"isPinned":false}`
Contact for a customer: `POST /contacts` body `{"firstName":"Bob","lastName":"Builder","customerId":9778208,"contactItems":[{"contactType":"email","contactValue":"bob@smith.co.nz"},{"contactType":"mobile","contactValue":"+64 21 555 4321"}]}`. Required: `firstName`, `email` contactItem, plus `customerId` or `siteId`.
Calendar event: `POST /calendarEvents` body `{"eventTitle":"Site inspection - Smith residence","eventType":"JOB_PHASE","startTime":"2025-04-01T09:00:00.000Z","endTime":"2025-04-01T11:00:00.000Z","userId":173187,"jobId":20909314,"jobPhaseId":1,"description":"Initial inspection before plumbing work begins"}`. Required: `startTime`, `endTime`, `eventTitle`, `eventType`. Times ISO 8601 UTC, 15-min intervals.
Enquiry: `POST /enquiries` body `{"name":"Bathroom renovation enquiry","email":"john@example.com","phoneNumber":"+64 9 555 1111","description":"Looking for a quote on bathroom renovation","source":"Website","address1":"123 Main St","addressCity":"Auckland","addressCountry":"New Zealand"}`. Required: `name`, `email`, `phoneNumber`, `description`, `source`, `address1`.
Site: `POST /sites` body `{"name":"New Office Site","defaultContact":{"firstName":"Tom","lastName":"Builder"},"siteAddress":{"address1":"42 Willis St","addressCity":"Wellington","addressCountry":"NZ"}}`. **`defaultContact` REQUIRED** (with `firstName`+`lastName`); `siteAddress` REQUIRED. Err: `"Validation Failed: [<body>: must have required property 'defaultContact']"`. Response 201: `{"result":"success","data":{"id":8169663,"name":"New Office Site",...}}`.

## Field Validation Rules

| Entity           | Field                    | Rule                                | Error if Violated                                                       |
| ---------------- | ------------------------ | ----------------------------------- | ----------------------------------------------------------------------- |
| Customer         | customerFullName         | non-empty, min 1 char, pattern `\S` | "The customerFullName must be at least 1 character long"                |
| Customer         | mainContact.firstName    | required                            | validation error                                                        |
| Site             | defaultContact           | **REQUIRED on create**              | `"must have required property 'defaultContact'"`                        |
| Site             | defaultContact.firstName | required                            | validation error                                                        |
| Site             | defaultContact.lastName  | required                            | validation error                                                        |
| Site             | siteAddress              | **REQUIRED on create AND PATCH**    | `"must have required property 'siteAddress'"`                           |
| Job              | jobType                  | `Quote`/`Estimate`/`Charge Up`      | `"The jobType must be one of 'Quote', 'Estimate', or 'Charge Up'"`      |
| Job (non-draft)  | customerId               | required                            | validation error                                                        |
| Job (non-draft)  | siteId                   | required                            | validation error                                                        |
| CalendarEvent    | startTime/endTime        | ISO 8601 UTC                        | "Must be a valid ISO 8601 date format in UTC"                           |
| CalendarEvent    | eventType                | JOB_PHASE/QUOTE/ESTIMATE/OTHER      | "Must be one of..."                                                     |
| User             | (update)                 | ≥1 field                            | "At least one field must be provided"                                   |
| User             | payRate                  | >= 0                                | "Must be greater than 0"                                                |
| User             | chargeOutRate            | >= 0                                | "Must be greater than 0"                                                |
| Pricebook search | search                   | min 3 chars                         | validation error                                                        |
| DELETE           | Content-Type             | must NOT be set                     | `"Body cannot be empty when content-type is set to 'application/json'"` |

## Server-Side Defaults

| Entity        | Field         | Default                                    | When           |
| ------------- | ------------- | ------------------------------------------ | -------------- |
| All           | id            | auto-generated (integer)                   | create         |
| All           | createdAt     | current timestamp                          | create         |
| All           | lastModified  | current timestamp                          | create, update |
| Customer      | companyId     | auto-assigned                              | create         |
| Customer      | pricingTier   | auto-assigned (Default tier)               | create         |
| Job           | status        | "Draft" (transient → "To Price" for Quote) | create         |
| Job           | onHold        | false                                      | create         |
| Job           | archived      | false                                      | create         |
| CalendarEvent | frequency     | "NEVER"                                    | create         |
| CalendarEvent | repeatEndType | "NEVER"                                    | create         |
| Note          | isPinned      | false                                      | create         |
| Quote         | isSent        | false                                      | create         |
| Quote         | isAccepted    | false                                      | create         |
| Quote         | isLocked      | false                                      | create         |

## Worked Examples

### Ex1: Full job creation workflow (customer → site → job)

Step 1 — `POST /customers` body `{"customerFullName":"Wellington Builders Ltd","mainContact":{"firstName":"Tom","contactItems":[{"contactType":"email","contactValue":"tom@wb.co.nz"}]}}` → 201 `{"result":"success","data":{"id":9778212,"customerFullName":"Wellington Builders Ltd","companyId":12345,"pricingTier":{"id":1,"name":"Default"}}}`
Step 2 — `POST /sites` body `{"name":"42 Willis St","defaultContact":{"firstName":"Tom","lastName":"Builder"},"siteAddress":{"address1":"42 Willis St","addressCity":"Wellington","addressCountry":"NZ"}}` → 201 `{"result":"success","data":{"id":8169663,"name":"42 Willis St"}}`
Step 3 — `POST /jobs` body `{"jobType":"Quote","title":"Office fitout","description":"Complete office renovation","customerId":9778212,"siteId":8169663}` → 201 `{"result":"success","data":{"id":20909314,"status":"Draft","links":[{"href":"/jobs/20909314","rel":"self","type":"GET"},{"href":"/jobs/20909314/finalise","rel":"finalise","type":"POST"}]}}`. Status "Draft" on create, "To Price" on GET.

### Ex2: Update quote sections (full replace)

`PUT /jobs/20909314/quotes/600` body `{"title":"Revised Office Fitout Quote","sections":[{"name":"Labour","lineItems":[{"description":"Carpenter","quantity":6,"unitPrice":700},{"description":"Electrician","quantity":2,"unitPrice":750}]},{"name":"Materials","lineItems":[{"description":"Timber & supplies","quantity":1,"unitPrice":3500}]}]}`. Replaces ALL sections (omitted sections removed). Only while quote in Draft (before publish).

### Ex3: Recurring calendar event (weekly Monday meeting)

`POST /calendarEvents` body `{"eventTitle":"Weekly site meeting - Smith project","eventType":"JOB_PHASE","startTime":"2025-04-07T08:00:00.000Z","endTime":"2025-04-07T09:00:00.000Z","userId":173187,"jobId":20909314,"jobPhaseId":1,"frequency":"WEEKLY","interval":1,"repeatEndType":"ON_DATE","repeatEndDate":"2025-06-30"}`

## Gotchas

1. Calendar event UPDATE uses POST, not PUT/PATCH: `POST /calendarEvents/{id}` with full body (non-standard REST).
2. Calendar event DELETE requires a body: `{"deleteAllRecurring":false}` even for non-recurring events.
3. Quote update (PUT) replaces ALL sections — no partial section update.
4. Customer/site create may return 303 (redirect to existing resource if duplicate). Handle 201 and 303.
5. Job update only on drafts. Once status leaves Draft, jobs are immutable via API (no PATCH for active jobs).
6. User email is read-only.
7. Site create requires `defaultContact` (`firstName`+`lastName`), not just `name`+`siteAddress`.
8. PATCH /sites requires `siteAddress` even for partial updates.
9. DELETE must NOT send Content-Type header (→ `"Body cannot be empty when content-type is set to 'application/json'"`).
10. jobType only Quote/Estimate/Charge Up; "Service"/"Project" invalid.
11. Use PUT, not POST, for `/jobs/{id}/finalise` (HATEOAS link claims POST; spec is `put`; POST → 404). [VERIFIED 2026-05-19]

## Dangerous Operations (confirm with user before executing)

| Operation                             | Why                                        | Safeguard                                                       |
| ------------------------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| DELETE /customers/{id}                | permanent delete                           | confirm; check for associated jobs first; **omit Content-Type** |
| POST /jobs/{id}/phases/{phaseId}/void | irreversibly voids phase                   | confirm                                                         |
| POST /jobs/quotes/{id}/void           | irreversibly voids quote                   | confirm                                                         |
| POST /jobs/quotes/{id}/accept         | accepts quote, may trigger invoice/deposit | confirm                                                         |
| POST /disconnect                      | revokes ALL API tokens for the connection  | confirm                                                         |
