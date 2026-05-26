---
api_name: 'Fergus'
api_slug: 'fergus'
base_url: 'https://api.fergus.com'
version: 'v1'
spec_format: 'OpenAPI 3.1.0'
spec_url: 'https://api.fergus.com/docs/json'
docs_url: 'https://api.fergus.com/docs'
date_researched: '2026-03-30'
date_live_tested: '2026-04-04'
---

# Fergus -- API Specification & Investigation

> Clean developer reference for the Fergus API. This document is the condensed
> output of the investigation questionnaire -- everything a developer needs to integrate
> with this API, in one place.
> **Updated 2026-04-04 with corrections from live API testing.**

---

## Overview

- **Vendor:** Fergus (New Zealand)
- **API version:** v1
- **Base URL:** `https://api.fergus.com` [CONFIRMED -- live API test 2026-04-04]
- **Sandbox URL:** Not publicly documented
- **API type:** REST (JSON)
- **Data format:** JSON
- **Field casing:** camelCase throughout [CONFIRMED -- live API test 2026-04-04]
- **ID format:** Integer (e.g., `9778208`, `20909314`, `173187`) [CONFIRMED -- live API test 2026-04-04]
- **Internal path prefix:** 404 errors reveal `/api/partner/` routing prefix [CONFIRMED -- live API test 2026-04-04]
- **Documentation:** [https://api.fergus.com/docs](https://api.fergus.com/docs)
- **API reference:** [https://api.fergus.com/docs](https://api.fergus.com/docs) (Swagger UI)
- **OpenAPI spec:** [https://api.fergus.com/docs/json](https://api.fergus.com/docs/json) (OAS 3.1.0)
- **Status page:** Listed on API Tracker but URL not discovered
- **Contact:** integrations@fergus.com, https://info.fergus.com/developers

**Summary:** Fergus is a job management platform for trade businesses (electricians, plumbers, HVAC) in NZ/AU/UK. The API provides CRUD access to jobs, customers, sites, quotes, invoices, time entries, calendar events, enquiries, notes, pricebooks, and company settings.

---

## Authentication

### Method 1: Personal Access Token (PAT)

Generate from Fergus account settings. Long-lived bearer token. [CONFIRMED -- live API test 2026-04-04]

```
Authorization: Bearer {pat_token}
```

### Method 2: OAuth 2.0 Authorization Code Flow

| Parameter         | Value                                      |
| ----------------- | ------------------------------------------ |
| Grant type        | authorization_code                         |
| Authorization URL | `https://auth.fergus.com/oauth2/authorize` |
| Token URL         | `https://auth.fergus.com/oauth2/token`     |
| Refresh URL       | `https://auth.fergus.com/oauth2/token`     |
| Token lifetime    | Not documented                             |
| Refresh mechanism | Use refresh URL with refresh_token grant   |
| PKCE required     | Not documented                             |

```
Authorization: Bearer {oauth2_access_token}
```

**Required scopes:** None documented (empty scopes object in spec).

---

## Response Envelope [CONFIRMED -- live API test 2026-04-04]

All successful responses use this envelope:

```json
{
  "result": "success",
  "data": { ... } or [ ... ],
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

- `data` is an object for single-resource responses, an array for list responses
- `paging` is present on list responses
- `paging.links.previous` and `paging.links.next` are `null` when not applicable

**HATEOAS links in every resource:** [CONFIRMED -- live API test 2026-04-04]

```json
"links": [
  {"href": "/customers/9778208", "rel": "self", "type": "GET"},
  {"href": "/jobs/20909314", "rel": "edit", "type": "PUT"},
  {"href": "/jobs/20909314/finalise", "rel": "finalise", "type": "POST"}
]
```

---

## Endpoint Catalog

### Confirmed Working Endpoints [CONFIRMED -- live API test 2026-04-04]

| Method | Path                | Purpose                 | HTTP Status | Notes                                       |
| ------ | ------------------- | ----------------------- | ----------- | ------------------------------------------- |
| GET    | `/version`          | API version             | 200         | Health check                                |
| GET    | `/company`          | Company info & settings | 200         | Tax: `{"rate": 15, "type": "GST"}`          |
| GET    | `/customers`        | List customers          | 200         | Paginated                                   |
| GET    | `/customers/{id}`   | Get customer            | 200         |                                             |
| POST   | `/customers`        | Create customer         | 201         | Required: `customerFullName`, `mainContact` |
| PUT    | `/customers/{id}`   | Update customer         | 200         | Full replace                                |
| GET    | `/sites`            | List sites              | 200         | Paginated                                   |
| POST   | `/sites`            | Create site             | 201         | Required: `defaultContact`, `siteAddress`   |
| PATCH  | `/sites/{id}`       | Update site             | 200         | `siteAddress` always required               |
| GET    | `/jobs`             | List jobs               | 200         | Many filters, paginated                     |
| GET    | `/jobs/{id}`        | Get job                 | 200         |                                             |
| POST   | `/jobs`             | Create job              | 201         | jobType: Quote/Estimate/Charge Up ONLY      |
| GET    | `/jobs/{id}/phases` | List phases             | 200         |                                             |
| GET    | `/users`            | List users              | 200         | Paginated                                   |
| GET    | `/timeEntries`      | List time entries       | 200         | Read-only, paginated                        |
| GET    | `/customerInvoices` | List invoices           | 200         | Read-only, paginated                        |
| GET    | `/calendarEvents`   | List events             | 200         | Date range model                            |
| GET    | `/enquiries`        | List enquiries          | 200         | Paginated                                   |
| GET    | `/pricingTiers`     | List pricing tiers      | 200         | Paginated                                   |
| GET    | `/favourites`       | List favourites         | 200         | Paginated                                   |
| GET    | `/notes`            | List notes              | 200         | sortField=created_at (snake_case!)          |

### Confirmed NOT Working [CONFIRMED -- live API test 2026-04-04]

| Method | Path                  | Error                                                 | Use Instead                                                                                              |
| ------ | --------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET    | `/quotes`             | 404: `"Route GET:/api/partner/quotes not found"`      | `/jobs/quotes`                                                                                           |
| GET    | `/stockOnHand`        | 404: `"Route GET:/api/partner/stockOnHand not found"` | `/phases/{id}/stockOnHand`                                                                               |
| POST   | `/jobs/{id}/finalise` | 404 — wrong verb                                      | Use `PUT /jobs/{jobId}/finalise` (HATEOAS link claims POST but spec is `put` only) [VERIFIED 2026-05-19] |

### Jobs

| Method | Path                             | Purpose           | Auth | Paginated | Idempotent |
| ------ | -------------------------------- | ----------------- | ---- | --------- | ---------- |
| GET    | `/jobs`                          | List jobs         | Yes  | Yes       | Yes        |
| POST   | `/jobs`                          | Create job        | Yes  | No        | No         |
| GET    | `/jobs/{jobId}`                  | Get job by ID     | Yes  | No        | Yes        |
| PUT    | `/jobs/{jobId}`                  | Update draft job  | Yes  | No        | Yes        |
| POST   | `/jobs/{jobId}/hold`             | Put on hold       | Yes  | No        | No         |
| POST   | `/jobs/{jobId}/resume`           | Resume from hold  | Yes  | No        | No         |
| GET    | `/jobs/{jobId}/financialSummary` | Financial summary | Yes  | No        | Yes        |

Add `PUT /jobs/{jobId}/finalise` to the table above — it IS in the OpenAPI spec; the prior 404s were because the HATEOAS link incorrectly claims `"type": "POST"`. Use PUT. Response schema is `JobResponse`. [VERIFIED 2026-05-19 against https://api.fergus.com/docs/json]

### Job Phases

| Method | Path                                              | Purpose                   | Auth | Paginated | Idempotent |
| ------ | ------------------------------------------------- | ------------------------- | ---- | --------- | ---------- |
| GET    | `/jobs/{jobId}/phases`                            | List phases               | Yes  | No        | Yes        |
| POST   | `/jobs/{jobId}/phases`                            | Create phase              | Yes  | No        | No         |
| GET    | `/jobs/{jobId}/phases/{phaseId}`                  | Get phase                 | Yes  | No        | Yes        |
| PUT    | `/jobs/{jobId}/phases/{phaseId}`                  | Update phase              | Yes  | No        | Yes        |
| POST   | `/jobs/{jobId}/phases/{phaseId}/void`             | Void phase (irreversible) | Yes  | No        | No         |
| GET    | `/jobs/{jobId}/phases/{phaseId}/financialSummary` | Phase financials          | Yes  | No        | Yes        |

### Quotes (Job-scoped)

| Method | Path                                 | Purpose                 | Auth | Paginated | Idempotent |
| ------ | ------------------------------------ | ----------------------- | ---- | --------- | ---------- |
| GET    | `/jobs/{jobId}/quotes`               | List quotes for job     | Yes  | Yes       | Yes        |
| POST   | `/jobs/{jobId}/quotes`               | Create quote            | Yes  | No        | No         |
| GET    | `/jobs/{jobId}/quotes/{quoteId}`     | Get quote               | Yes  | No        | Yes        |
| PUT    | `/jobs/{jobId}/quotes/{quoteId}`     | Update quote by ID      | Yes  | No        | Yes        |
| PUT    | `/jobs/{jobId}/quotes/version/{ver}` | Update quote by version | Yes  | No        | Yes        |

### Quotes (Cross-Job)

**NOTE:** Use `/jobs/quotes`, NOT `/quotes`. The standalone `/quotes` endpoint returns 404. [CONFIRMED -- live API test 2026-04-04]

| Method | Path                                | Purpose           | Auth | Paginated | Idempotent |
| ------ | ----------------------------------- | ----------------- | ---- | --------- | ---------- |
| GET    | `/jobs/quotes`                      | List all quotes   | Yes  | Yes       | Yes        |
| GET    | `/jobs/quotes/{quoteId}`            | Get quote by ID   | Yes  | No        | Yes        |
| GET    | `/jobs/quotes/guid/{guid}`          | Get quote by GUID | Yes  | No        | Yes        |
| POST   | `/jobs/quotes/{quoteId}/publish`    | Publish           | Yes  | No        | No         |
| POST   | `/jobs/quotes/{quoteId}/markAsSent` | Mark as sent      | Yes  | No        | No         |
| POST   | `/jobs/quotes/{quoteId}/accept`     | Accept            | Yes  | No        | No         |
| POST   | `/jobs/quotes/{quoteId}/decline`    | Decline           | Yes  | No        | No         |
| POST   | `/jobs/quotes/{quoteId}/void`       | Void              | Yes  | No        | No         |
| POST   | `/jobs/quotes/{quoteId}/totals`     | Get totals        | Yes  | No        | Yes        |

### Customers

| Method | Path                      | Purpose                      | Auth | Paginated | Idempotent |
| ------ | ------------------------- | ---------------------------- | ---- | --------- | ---------- |
| GET    | `/customers`              | List customers               | Yes  | Yes       | Yes        |
| POST   | `/customers`              | Create customer (303 if dup) | Yes  | No        | No         |
| GET    | `/customers/{customerId}` | Get customer                 | Yes  | No        | Yes        |
| PUT    | `/customers/{customerId}` | Update customer              | Yes  | No        | Yes        |
| DELETE | `/customers/{customerId}` | Delete customer              | Yes  | No        | Yes        |

**Create required:** `customerFullName`, `mainContact` (with `firstName`) [CONFIRMED -- live API test 2026-04-04]
**Update required:** `customerFullName`, `mainContact` (full replace) [CONFIRMED -- live API test 2026-04-04]

### Sites

| Method | Path                      | Purpose                  | Auth | Paginated | Idempotent |
| ------ | ------------------------- | ------------------------ | ---- | --------- | ---------- |
| GET    | `/sites`                  | List sites               | Yes  | Yes       | Yes        |
| POST   | `/sites`                  | Create site (303 if dup) | Yes  | No        | No         |
| GET    | `/sites/{siteId}`         | Get site                 | Yes  | No        | Yes        |
| PATCH  | `/sites/{siteId}`         | Update site              | Yes  | No        | No         |
| POST   | `/sites/{siteId}/archive` | Archive (soft delete)    | Yes  | No        | No         |
| POST   | `/sites/{siteId}/restore` | Restore                  | Yes  | No        | No         |

**Create required:** `defaultContact` (with `firstName`, `lastName`), `siteAddress` [CONFIRMED -- live API test 2026-04-04]
**PATCH required:** `siteAddress` (always, even for partial updates) [CONFIRMED -- live API test 2026-04-04]

### Contacts

| Method | Path                    | Purpose        | Auth | Paginated | Idempotent |
| ------ | ----------------------- | -------------- | ---- | --------- | ---------- |
| GET    | `/contacts`             | List contacts  | Yes  | Yes       | Yes        |
| POST   | `/contacts`             | Create contact | Yes  | No        | No         |
| GET    | `/contacts/{contactId}` | Get contact    | Yes  | No        | Yes        |
| PUT    | `/contacts/{contactId}` | Update contact | Yes  | No        | Yes        |

### Enquiries

| Method | Path                     | Purpose        | Auth | Paginated | Idempotent |
| ------ | ------------------------ | -------------- | ---- | --------- | ---------- |
| GET    | `/enquiries`             | List enquiries | Yes  | Yes       | Yes        |
| POST   | `/enquiries`             | Create enquiry | Yes  | No        | No         |
| GET    | `/enquiries/{enquiryId}` | Get enquiry    | Yes  | No        | Yes        |

### Customer Invoices (read-only)

| Method | Path                            | Purpose            | Auth | Paginated | Idempotent |
| ------ | ------------------------------- | ------------------ | ---- | --------- | ---------- |
| GET    | `/customerInvoices`             | List invoices      | Yes  | Yes       | Yes        |
| GET    | `/customerInvoices/{invoiceId}` | Get invoice detail | Yes  | No        | Yes        |

### Users

| Method | Path              | Purpose               | Auth | Paginated | Idempotent |
| ------ | ----------------- | --------------------- | ---- | --------- | ---------- |
| GET    | `/users`          | List users            | Yes  | Yes       | Yes        |
| GET    | `/users/{userId}` | Get user              | Yes  | No        | Yes        |
| PATCH  | `/users/{userId}` | Update user (partial) | Yes  | No        | No         |

### Time Entries (read-only)

| Method | Path           | Purpose           | Auth | Paginated | Idempotent |
| ------ | -------------- | ----------------- | ---- | --------- | ---------- |
| GET    | `/timeEntries` | List time entries | Yes  | Yes       | Yes        |

### Calendar Events

| Method | Path                        | Purpose                         | Auth | Paginated | Idempotent |
| ------ | --------------------------- | ------------------------------- | ---- | --------- | ---------- |
| GET    | `/calendarEvents`           | List events (date range)        | Yes  | No        | Yes        |
| POST   | `/calendarEvents`           | Create event                    | Yes  | No        | No         |
| GET    | `/calendarEvents/{eventId}` | Get event                       | Yes  | No        | Yes        |
| POST   | `/calendarEvents/{eventId}` | Update event (POST!)            | Yes  | No        | No         |
| DELETE | `/calendarEvents/{eventId}` | Delete event (NO Content-Type!) | Yes  | No        | Yes        |

### Stock On Hand

**NOTE:** `/stockOnHand` standalone endpoint returns 404. Use `/phases/{phaseId}/stockOnHand`. [CONFIRMED -- live API test 2026-04-04]

| Method | Path                                 | Purpose              | Auth | Paginated | Idempotent |
| ------ | ------------------------------------ | -------------------- | ---- | --------- | ---------- |
| GET    | `/phases/{phaseId}/stockOnHand`      | List stock for phase | Yes  | Yes       | Yes        |
| POST   | `/phases/{phaseId}/stockOnHand`      | Add stock            | Yes  | No        | No         |
| GET    | `/phases/stockOnHand`                | List all stock       | Yes  | Yes       | Yes        |
| PATCH  | `/phases/{phaseId}/stockOnHand/{id}` | Update stock         | Yes  | No        | No         |
| DELETE | `/phases/{phaseId}/stockOnHand/{id}` | Delete stock         | Yes  | No        | Yes        |

### Stock Used (read-only)

| Method | Path         | Purpose               | Auth | Paginated | Idempotent |
| ------ | ------------ | --------------------- | ---- | --------- | ---------- |
| GET    | `/stockUsed` | Historical stock used | Yes  | Yes       | Yes        |

### Pricebooks & Pricing (read-only)

| Method | Path                                       | Purpose                | Auth | Paginated | Idempotent |
| ------ | ------------------------------------------ | ---------------------- | ---- | --------- | ---------- |
| GET    | `/pricingTiers`                            | List pricing tiers     | Yes  | Yes       | Yes        |
| GET    | `/pricingTiers/{id}`                       | Get pricing tier       | Yes  | No        | Yes        |
| POST   | `/pricebooks/search`                       | Search pricebook items | Yes  | Yes       | Yes        |
| GET    | `/pricebooks`                              | List pricebooks        | Yes  | Yes       | Yes        |
| GET    | `/pricebooks/{id}`                         | Get pricebook          | Yes  | No        | Yes        |
| GET    | `/pricebooks/{id}/pricebookItems`          | List items             | Yes  | Yes       | Yes        |
| GET    | `/pricebooks/{id}/pricebookItems/{itemId}` | Get item               | Yes  | No        | Yes        |

### Favourites (read-only)

| Method | Path                      | Purpose                 | Auth | Paginated | Idempotent |
| ------ | ------------------------- | ----------------------- | ---- | --------- | ---------- |
| GET    | `/favourites`             | List favourite sections | Yes  | Yes       | Yes        |
| GET    | `/favourites/{sectionId}` | Get section             | Yes  | No        | Yes        |

### Notes

| Method | Path              | Purpose     | Auth | Paginated | Idempotent |
| ------ | ----------------- | ----------- | ---- | --------- | ---------- |
| GET    | `/notes`          | List notes  | Yes  | Yes       | Yes        |
| POST   | `/notes`          | Create note | Yes  | No        | No         |
| PATCH  | `/notes/{noteId}` | Update note | Yes  | No        | No         |

**NOTE:** Sort field uses snake_case: `sortField=created_at`. [CONFIRMED -- live API test 2026-04-04]

### Server / Utility

| Method | Path          | Purpose                  | Auth | Paginated | Idempotent |
| ------ | ------------- | ------------------------ | ---- | --------- | ---------- |
| GET    | `/version`    | API version              | Yes  | No        | Yes        |
| POST   | `/disconnect` | Disconnect/revoke tokens | Yes  | No        | No         |
| GET    | `/company`    | Company info & settings  | Yes  | No        | Yes        |

---

## Data Models

Key models are documented in `01a-domain-model-reference.md`. Summary:

- **Job:** id (integer), description, jobType (Quote/Estimate/Charge Up ONLY), status (Draft transient -> To Price), customer, siteAddress, links
- **Customer:** id (integer), customerFullName, mainContact, physicalAddress, pricingTier (auto-assigned)
- **Site:** id (integer), name, defaultContact (REQUIRED), siteAddress (REQUIRED always), isArchived
- **Quote:** id, versionNumber, jobId, title, sections[], isSent, isAccepted, isLocked (use /jobs/quotes NOT /quotes)
- **JobPhase:** id, jobId, title, description, status
- **User:** id (integer), firstName, lastName, email, userType, status, payRate, chargeOutRate
- **TimeEntry:** timeEntryId, userId, startTime, endTime, paidDuration, jobId (read-only)
- **CalendarEvent:** id, userId, title, eventType, startTime, endTime, isRecurring
- **CustomerInvoice:** id, jobId, customerId, invoiceNumber, subtotal, taxValue, status (read-only)
- **Note:** id, text, entityName, entityId, isPinned, parentId (sortField=created_at snake_case)
- **Contact:** linked to Customer or Site, has firstName, contactItems[]
- **Enquiry:** id, name, email, description, source, status
- **Pricebook:** id, supplierName, itemCount
- **PricebookItem:** id, name, productCode, costPrice, retailPrice
- **Company:** guid, name, contact, settings[], tax (rate: 15, type: "GST")

---

## Pagination [CONFIRMED -- live API test 2026-04-04]

- **Type:** Cursor-based (integer offset, 0-based)
- **Default page size:** 10 (varies by endpoint)
- **Max page size:** Not documented
- **Total count:** `paging.pageCount` (total pages)

**Parameters:**

| Parameter  | Type    | Default | Description             |
| ---------- | ------- | ------- | ----------------------- |
| pageSize   | number  | 10      | Items per page          |
| pageCursor | integer | 0       | Offset cursor (0-based) |
| sortOrder  | string  | "asc"   | asc or desc             |
| sortField  | string  | varies  | Sort field              |

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

**Last page detection:** `paging.links.next` is `null`.

**Exception:** Calendar events use date-range model, not cursor pagination.

---

## Rate Limits [CONFIRMED -- live API test 2026-04-04]

| Scope                    | Limit        | Window   |
| ------------------------ | ------------ | -------- |
| Per company (all tokens) | 100 requests | 1 minute |

**Headers:** [CONFIRMED -- live API test 2026-04-04]

| Header                  | Meaning                      |
| ----------------------- | ---------------------------- |
| `x-ratelimit-limit`     | Max requests in window (100) |
| `x-ratelimit-remaining` | Remaining requests           |
| `x-ratelimit-reset`     | Seconds until reset (60)     |
| `retry-after`           | Seconds to wait (429 only)   |

**When exceeded:** 429 Too Many Requests with retry-after header.

**Recommended strategy:** Honor retry-after; exponential backoff from 2s; max 60s; monitor x-ratelimit-remaining proactively.

---

## Error Handling [CONFIRMED -- live API test 2026-04-04]

**Error formats vary by status code:**

**400 Validation:**

```json
{
  "error": "Bad Request",
  "message": "Validation Failed: [<body>: must have required property 'defaultContact'].",
  "statusCode": 400
}
```

**403 Forbidden (minimal format):**

```json
{ "message": "Forbidden" }
```

**404 Not Found (reveals internal path):**

```json
{ "message": "Route GET:/api/partner/quotes?pageSize=3 not found", "error": "Not Found", "statusCode": 404 }
```

**415 Wrong Content-Type:**

```json
{ "error": "FastifyError", "message": "Unsupported Media Type: ...", "statusCode": 415 }
```

**Status codes:**

| Status | Meaning                  | Retryable | Recovery                                                      |
| ------ | ------------------------ | --------- | ------------------------------------------------------------- |
| 303    | Duplicate (redirect)     | No        | Follow location header                                        |
| 400    | Bad request / validation | No        | Fix request                                                   |
| 401    | Unauthorized             | Yes       | Refresh token                                                 |
| 403    | Forbidden                | No        | Check permissions (response: just `{"message": "Forbidden"}`) |
| 404    | Not found                | No        | Verify ID. Some endpoints don't exist (/quotes, /stockOnHand) |
| 409    | Conflict                 | Maybe     | Re-read and retry                                             |
| 415    | Wrong Content-Type       | No        | Fix headers. DELETE: omit Content-Type.                       |
| 422    | Validation error         | No        | Fix fields                                                    |
| 429    | Rate limited             | Yes       | Wait + retry                                                  |
| 5xx    | Server error             | Yes       | Retry with backoff                                            |

---

## Webhooks / Events

Webhooks are listed as a Fergus API feature on API Tracker, but no webhook endpoints appear in the v1 OpenAPI specification. Webhook details are not documented in the public spec.

**Polling fallback:** Use `modifiedAfter` parameter on `/jobs/quotes` (NOT `/quotes`) for quote changes. Sort by `lastModified desc` on `/jobs` for job changes.

---

## Known Limitations [CONFIRMED -- live API test 2026-04-04]

1. No file upload/download endpoints
2. Time entries and invoices are read-only
3. No bulk/batch operations
4. Rate limit is 100 req/min shared across entire company (all tokens)
5. Calendar events are not paginated (date-range model only)
6. Stock used has 180-day lookback maximum
7. No webhook endpoints in public API spec
8. No field selection / sparse fields support
9. **`/quotes` standalone endpoint does NOT exist (404)** -- use `/jobs/quotes` [CONFIRMED]
10. **`/stockOnHand` standalone endpoint does NOT exist (404)** -- use `/phases/{id}/stockOnHand` [CONFIRMED]
11. **/jobs/{id}/finalise is PUT, not POST** — the HATEOAS link's `"type": "POST"` is a server-side bug [VERIFIED 2026-05-19]
12. **jobType only accepts `"Quote"`, `"Estimate"`, `"Charge Up"`** -- "Service"/"Project" are NOT valid [CONFIRMED]
13. **DELETE must NOT include Content-Type header** [CONFIRMED]
14. **PATCH /sites always requires `siteAddress`** even for partial updates [CONFIRMED]
15. **Site create requires `defaultContact`** with `firstName` and `lastName` [CONFIRMED]
16. **Notes sort field is snake_case** (`created_at` not `createdAt`) [CONFIRMED]

---

## SDKs & Tooling

| SDK               | Language   | Repository                                 | Quality | Notes                       |
| ----------------- | ---------- | ------------------------------------------ | ------- | --------------------------- |
| Fergus MCP Server | TypeScript | https://github.com/Jayco-Design/fergus-mcp | Good    | Community, 26+ tools, MIT   |
| (no official SDK) | --         | --                                         | --      | No official Python/Node SDK |

**Postman collection:** https://www.postman.com/fergusfrl12/fergus-workspace/overview
**OpenAPI spec:** https://api.fergus.com/docs/json (OAS 3.1.0)

---

## Integration Path Assessment

**Recommended path:** Hybrid (Data Connector + Direct API)

**Justification:** Fergus has rich browsable structured content (jobs, customers, sites, quotes, invoices, time entries) for a Data Connector, plus significant write capabilities (create jobs, customers, quotes, calendar events) that benefit from Direct API in workspace agent.

**Connector compatibility:**

| Connector Method  | API Endpoint                    | Feasibility                  |
| ----------------- | ------------------------------- | ---------------------------- |
| list_files        | GET /jobs, /customers, /sites   | Good -- top-level navigation |
| download_file     | GET /jobs/{id}, /customers/{id} | Good -- JSON representation  |
| search_files      | GET /jobs?filterSearchText=     | Good -- substring search     |
| get_file_metadata | GET /jobs/{id}                  | Good -- entity metadata      |

---

_Researched on 2026-03-30. Live-tested on 2026-04-04._
_Source: OpenAPI spec (api.fergus.com/docs/json), MCP server (github.com/Jayco-Design/fergus-mcp), live API testing._
