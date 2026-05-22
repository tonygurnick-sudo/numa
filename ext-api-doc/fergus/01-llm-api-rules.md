---
api_name: 'Fergus'
api_slug: 'fergus'
version: 'v1'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-03-30'
updated_date: '2026-04-04'
update_source: 'live API testing'
line_count_target: '< 300 lines'
---

# Fergus -- Workspace Agent API Rules

> **This file is loaded into the workspace agent's context when the Fergus integration is active.**
> It must stay under 300 lines. Be precise, not verbose.
> Companion files (01a-01d) contain the detailed reference material.
> **Updated 2026-04-04 with corrections from live API testing.**

## Context

- **API:** Fergus API v1
- **Base URL:** `https://api.fergus.com`
- **Auth:** Bearer token (PAT or OAuth2 access token)
- **Integration path:** Hybrid (Data Connector + Direct API)
- **Rate limits:** 100 requests/minute per company, shared across all tokens and endpoints [CONFIRMED -- live API test 2026-04-04]
- **Field casing:** camelCase throughout [CONFIRMED -- live API test 2026-04-04]
- **ID format:** Integer (e.g., `9778208`, `20909314`) [CONFIRMED -- live API test 2026-04-04]

## Auth Structure

Bearer token authentication via Authorization header.

```
Authorization: Bearer {token}
Content-Type: application/json
```

**IMPORTANT: DELETE requests must NOT include Content-Type header.** Sending `Content-Type: application/json` on DELETE causes: `"Body cannot be empty when content-type is set to 'application/json'"`. Either omit Content-Type entirely or send an empty JSON body `{}`. [CONFIRMED -- live API test 2026-04-04]

**Token lifecycle:**

- PAT tokens: long-lived, generated from Fergus account settings
- OAuth2 tokens: use refresh URL `https://auth.fergus.com/oauth2/token` when expired

## Capabilities

### CAN

1. List, search, and view: jobs, customers, sites, invoices, time entries, calendar events, enquiries, notes, pricebooks, favourites [CONFIRMED -- live API test 2026-04-04]
2. Create: jobs, customers, sites, enquiries, calendar events, notes, contacts
3. Update: draft jobs, customers (PUT), sites (PATCH, siteAddress always required), users (limited), notes
4. Manage quote lifecycle via `/jobs/quotes` paths: publish, mark as sent, accept, decline, void
5. Put jobs on hold / resume
6. View financial summaries, quote totals, company info, pricing tiers [CONFIRMED -- live API test 2026-04-04]
7. Search pricebook items across suppliers (min 3 chars)

### CANNOT

1. Create or modify time entries (read-only in API) [CONFIRMED -- live API test 2026-04-04]
2. Create or modify invoices (read-only in API) [CONFIRMED -- live API test 2026-04-04]
3. Upload or download files (no file endpoints)
4. Create users (read/update only)
5. Delete most resources (only customers and stock-on-hand support DELETE)
6. Modify pricebooks or pricing tiers (read-only)
7. Use `/quotes` standalone endpoint (returns 404) [CONFIRMED -- live API test 2026-04-04]
8. Use `/stockOnHand` standalone endpoint (returns 404) [CONFIRMED -- live API test 2026-04-04]

## Critical Gotchas

1. **jobType values are ONLY `"Quote"`, `"Estimate"`, `"Charge Up"`.** The values "Service" and "Project" do NOT exist. Error: `"The jobType must be one of 'Quote', 'Estimate', or 'Charge Up'"`. [CONFIRMED -- live API test 2026-04-04]
2. **Job status is transient after creation:** POST returns `"status": "Draft"` but GET immediately returns `"To Price"` for Quote-type jobs. [CONFIRMED -- live API test 2026-04-04]
3. **Site create requires `defaultContact`:** Must include `defaultContact` with `firstName` and `lastName`. `siteAddress` is also required. Error: `"must have required property 'defaultContact'"`. [CONFIRMED -- live API test 2026-04-04]
4. **PATCH /sites always requires `siteAddress`:** Even for partial updates. Error: `"must have required property 'siteAddress'"`. [CONFIRMED -- live API test 2026-04-04]
5. **DELETE must NOT send Content-Type header.** Causes `"Body cannot be empty when content-type is set to 'application/json'"`. [CONFIRMED -- live API test 2026-04-04]
6. **Rate limit is per-company, not per-token:** All API tokens for the same Fergus company share a 100 req/min budget. [CONFIRMED -- live API test 2026-04-04]
7. **Customer/site create returns 303 on duplicates:** POST returns HTTP 303 with a `location` header if the record already exists. Follow the redirect to get the existing resource.
8. **Draft vs finalized jobs:** Only draft jobs (created with `isDraft: true`) can be updated via PUT. Non-draft creates require customerId and siteId.
9. **Calendar events use POST for updates:** PUT is NOT used. Updates use `POST /calendarEvents/{id}`.
10. **Pagination cursor is an integer:** The `pageCursor` parameter is 0-based. Default page size is 10. [CONFIRMED -- live API test 2026-04-04]
11. **Notes sort field uses snake_case:** `sortField=created_at` not `createdAt`. Only known endpoint with this exception. [CONFIRMED -- live API test 2026-04-04]
12. **Use PUT for /jobs/{id}/finalise, not POST.** The HATEOAS link's `"type": "POST"` is a server bug — the OpenAPI spec defines the path with `put` only. POST returns 404. [VERIFIED 2026-05-19 against OpenAPI spec]

## Default Parameters

Use these defaults unless the user specifies otherwise:

| Parameter          | Default   | Reason                                    |
| ------------------ | --------- | ----------------------------------------- |
| pageSize           | 20        | Good balance of data vs rate limit budget |
| sortOrder          | desc      | Most recent first is usually desired      |
| sortField          | createdAt | Chronological ordering                    |
| filterShowArchived | false     | Hide archived jobs by default             |
| filterShowOnHold   | true      | Include on-hold jobs in listings          |

## Working Examples

### Example 1: List active jobs for a customer

```http
GET /jobs?filterCustomerId=9778208&filterJobStatus=Active&sortField=lastModified&sortOrder=desc&pageSize=20
Host: api.fergus.com
Authorization: Bearer {token}
```

```json
{
  "result": "success",
  "data": [
    {
      "id": 20909314,
      "jobNo": "J-0042",
      "description": "Kitchen renovation",
      "jobType": "Quote",
      "status": "Active",
      "customer": { "id": 9778208, "customerFullName": "Smith Ltd" },
      "siteAddress": { "id": 8169663, "name": "Main Office" },
      "onHold": false,
      "archived": false,
      "links": [{ "href": "/jobs/20909314", "rel": "self", "type": "GET" }]
    }
  ],
  "paging": { "perPage": 20, "pageCount": 1, "links": { "self": "...", "previous": null, "next": null } }
}
```

### Example 2: Create a new customer [CONFIRMED -- live API test 2026-04-04]

```http
POST /customers
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "customerFullName": "ABC Electrical Ltd",
  "mainContact": {
    "firstName": "Jane",
    "lastName": "Doe",
    "contactItems": [
      {"contactType": "email", "contactValue": "jane@abc.co.nz"},
      {"contactType": "phone", "contactValue": "+64 9 555 1234"}
    ]
  },
  "physicalAddress": {
    "address1": "456 Queen St",
    "addressCity": "Auckland",
    "addressCountry": "New Zealand"
  }
}
```

```json
{
  "result": "success",
  "data": {
    "id": 9778208,
    "customerFullName": "ABC Electrical Ltd",
    "companyId": 12345,
    "mainContact": { "id": 50, "firstName": "Jane" },
    "pricingTier": { "id": 1, "name": "Default" }
  }
}
```

### Example 3: Create a job [CONFIRMED -- live API test 2026-04-04]

```http
POST /jobs
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{"jobType": "Quote", "title": "Pipe repair", "description": "Fix leaking kitchen pipe", "customerId": 9778208, "siteId": 8169663}
```

Response (201): Status is `"Draft"` on create, transitions to `"To Price"` on GET. Includes HATEOAS links:

```json
{
  "result": "success",
  "data": {
    "id": 20909314,
    "status": "Draft",
    "links": [
      { "href": "/jobs/20909314", "rel": "self", "type": "GET" },
      { "href": "/jobs/20909314", "rel": "edit", "type": "PUT" },
      { "href": "/jobs/20909314/finalise", "rel": "finalise", "type": "POST" }
    ]
  }
}
```

## Proxy API Operations

| Operation          | Method | Path                           | Key Parameters                                                | Notes                                          |
| ------------------ | ------ | ------------------------------ | ------------------------------------------------------------- | ---------------------------------------------- |
| List jobs          | GET    | /jobs                          | filterJobStatus, filterCustomerId, filterSearchText           | Many filters available [CONFIRMED]             |
| Get job            | GET    | /jobs/{jobId}                  | jobId                                                         | [CONFIRMED]                                    |
| Create job         | POST   | /jobs                          | jobType (Quote/Estimate/Charge Up), title, customerId, siteId | isDraft=true for draft [CONFIRMED]             |
| Job phases         | GET    | /jobs/{jobId}/phases           | jobId                                                         | [CONFIRMED]                                    |
| Hold/resume        | POST   | /jobs/{jobId}/hold or /resume  | holdUntil, notes                                              |                                                |
| List customers     | GET    | /customers                     | filterSearchText                                              | Search name, contact, email [CONFIRMED]        |
| Create customer    | POST   | /customers                     | customerFullName, mainContact                                 | 303 if duplicate [CONFIRMED]                   |
| Update customer    | PUT    | /customers/{id}                | customerFullName, mainContact                                 | Full replace [CONFIRMED]                       |
| List sites         | GET    | /sites                         | filterSearchText, filterSiteName                              | [CONFIRMED]                                    |
| Create site        | POST   | /sites                         | defaultContact (REQUIRED), siteAddress (REQUIRED)             | 303 if duplicate [CONFIRMED]                   |
| Update site        | PATCH  | /sites/{id}                    | siteAddress (REQUIRED even on PATCH)                          | [CONFIRMED]                                    |
| List quotes        | GET    | /jobs/quotes                   | filterStatus, createdAfter                                    | Cross-job listing. NOT /quotes                 |
| Create quote       | POST   | /jobs/{jobId}/quotes           | title, dueDays, sections                                      |                                                |
| Publish quote      | POST   | /jobs/quotes/{quoteId}/publish | quoteId                                                       | Locks the quote                                |
| Accept quote       | POST   | /jobs/quotes/{quoteId}/accept  | quoteId                                                       |                                                |
| List invoices      | GET    | /customerInvoices              | customerId, jobId, dueBefore                                  | Read-only [CONFIRMED]                          |
| List time entries  | GET    | /timeEntries                   | filterDateFrom, filterUserId                                  | Read-only [CONFIRMED]                          |
| List calendar      | GET    | /calendarEvents                | filterDateFrom, filterCalendarRange                           | [CONFIRMED]                                    |
| Create event       | POST   | /calendarEvents                | startTime, endTime, eventType, eventTitle                     |                                                |
| List users         | GET    | /users                         | filterUserType, filterStatus                                  | [CONFIRMED]                                    |
| Search pricebook   | POST   | /pricebooks/search             | search (min 3 chars)                                          |                                                |
| List notes         | GET    | /notes                         | filterEntityName, filterEntityId                              | sortField=created_at (snake_case!) [CONFIRMED] |
| Create note        | POST   | /notes                         | text, entityName, entityId                                    |                                                |
| Get company        | GET    | /company                       |                                                               | Settings, tax info [CONFIRMED]                 |
| List favourites    | GET    | /favourites                    |                                                               | Template sections [CONFIRMED]                  |
| List pricing tiers | GET    | /pricingTiers                  |                                                               | [CONFIRMED]                                    |
| List enquiries     | GET    | /enquiries                     |                                                               | [CONFIRMED]                                    |

**NOT AVAILABLE (confirmed 404):**

| Endpoint                 | Error                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| GET /quotes              | `"Route GET:/api/partner/quotes not found"` -- use /jobs/quotes                                            |
| GET /stockOnHand         | `"Route GET:/api/partner/stockOnHand not found"` -- use /phases/{id}/stockOnHand                           |
| POST /jobs/{id}/finalise | 404 — wrong verb. **Use PUT** (the HATEOAS link's `"type": "POST"` is a server bug). [VERIFIED 2026-05-19] |

## Pagination [CONFIRMED -- live API test 2026-04-04]

- **Type:** Cursor-based (integer offset, 0-based)
- **Default page size:** 10 (varies by endpoint)
- **Max page size:** Not documented; use 20-50 conservatively
- **How to paginate:**

```http
GET /jobs?pageSize=20&pageCursor=0     (page 1)
GET /jobs?pageSize=20&pageCursor=20    (page 2, from paging.links.next)
GET /jobs?pageSize=20&pageCursor=40    (page 3)
```

- **Last page detection:** `paging.links.next` is `null`
- **Response format:** `"paging": {"perPage": N, "pageCount": N, "links": {"self": "...", "previous": null, "next": null}}`

## Error Handling [CONFIRMED -- live API test 2026-04-04]

**Error formats vary by status code:**

| Status | Format  | Example                                                                                                                   |
| ------ | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| 400    | Full    | `{"error": "Bad Request", "message": "Validation Failed: [<body>: must have required property 'X'].", "statusCode": 400}` |
| 403    | Minimal | `{"message": "Forbidden"}` (no error/statusCode fields)                                                                   |
| 404    | Full    | `{"message": "Route GET:/api/partner/{path} not found", "error": "Not Found", "statusCode": 404}`                         |
| 415    | Full    | `{"error": "FastifyError", "message": "Unsupported Media Type: ...", "statusCode": 415}`                                  |

**Recovery by status:**

| Status | Meaning                  | Action                                                     |
| ------ | ------------------------ | ---------------------------------------------------------- |
| 400    | Bad request / validation | Fix request parameters per error message                   |
| 401    | Unauthorized             | Refresh token and retry                                    |
| 403    | Forbidden                | Check permissions                                          |
| 404    | Not found                | Verify resource ID exists. Check if endpoint is available. |
| 409    | Conflict                 | Re-read resource and retry                                 |
| 415    | Wrong Content-Type       | Fix headers (especially on DELETE: omit Content-Type)      |
| 422    | Validation error         | Check field-level errors in message                        |
| 429    | Rate limited             | Wait per retry-after header, then retry                    |
| 5xx    | Server error             | Retry with exponential backoff (max 3 retries)             |

## Known Limitations

1. No file upload/download support -- documents and photos are managed in Fergus UI only
2. Time entries and invoices are read-only -- cannot be created or modified via API
3. No webhook endpoints in public API spec -- polling is the only change detection method
4. Rate limit of 100 req/min is shared company-wide; budget carefully with multiple integrations
5. No bulk/batch operations -- all writes are single-record
6. `/quotes` and `/stockOnHand` standalone endpoints do not exist (404)
7. /jobs/{id}/finalise requires PUT (HATEOAS link's `"type": "POST"` is a server bug; spec defines `put` only) [VERIFIED 2026-05-19]
8. DELETE requires no Content-Type header

---

_Generated from investigation questionnaire. Updated 2026-04-04 with live API test corrections._
_See companion files for detailed reference:_

- _01a-domain-model-reference.md -- Entity catalog, relationships, state machines_
- _01b-query-patterns.md -- Filtering, search, pagination examples_
- _01c-mutation-patterns.md -- Create, update, delete patterns_
- _01d-event-and-error-handling.md -- Events, webhooks, error recovery_
