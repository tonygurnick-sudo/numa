---
api_name: Fergus
api_slug: fergus
base_url: https://api.fergus.com
route_prefix_injected_by_connector: /api/partner
path_version_segment: none (API is labelled "v1" but NO /v1/ in any path; /v1/... → 404)
api_version_label: v1
spec_format: OpenAPI 3.1.0
spec_url: https://api.fergus.com/docs/json
docs_url: https://api.fergus.com/docs
auth: Bearer {token}
field_casing: camelCase
id_format: integer
call_surface: HTTP via `numa integrations request` (NOT a file-store connector)
confidence: every fact live-API-confirmed 2026-04-04 unless tagged [INFERRED] or [VERIFIED <date>]
---

# Fergus — API Specification & Investigation

Developer reference: everything needed to integrate. Paths are FLAT (`/jobs`, `/customers/{id}`); connector injects `/api/partner`. "v1" is a label only — never a path segment.

## Overview

- Vendor: Fergus (New Zealand). API type: REST (JSON). Data format: JSON.
- Base URL: `https://api.fergus.com` (single shared host). Sandbox: not publicly documented.
- Field casing: camelCase. ID format: integer (`9778208`, `20909314`, `173187`).
- Internal path prefix: 404 errors reveal `/api/partner/` routing prefix; client-facing paths drop it.
- Docs/Swagger UI: https://api.fergus.com/docs · OpenAPI spec (OAS 3.1.0): https://api.fergus.com/docs/json.
- Status page: listed on API Tracker, URL not discovered. Contact: integrations@fergus.com, https://info.fergus.com/developers.
- Domain: job management for trade businesses (electricians, plumbers, HVAC) in NZ/AU/UK. CRUD over jobs, customers, sites, quotes, invoices, time entries, calendar events, enquiries, notes, pricebooks, company settings.

## Authentication

PAT: generate from Fergus account settings; long-lived bearer token. `Authorization: Bearer {pat_token}`.
OAuth 2.0 Authorization Code: grant `authorization_code`; Authorize `https://auth.fergus.com/oauth2/authorize`; Token + Refresh `https://auth.fergus.com/oauth2/token`; token lifetime not documented; PKCE not documented; scopes empty `{}` in spec. `Authorization: Bearer {oauth2_access_token}`.

## Response Envelope

Success: `{"result":"success","data":{...}|[...],"paging":{"perPage":10,"pageCount":5,"links":{"self":"/jobs?pageCursor=0&pageSize=10","previous":null,"next":"/jobs?pageCursor=10&pageSize=10"}}}`. `data` is object for single, array for list. `paging` present on list responses; `links.previous`/`links.next` null when N/A.
HATEOAS `links` in every resource: `[{"href":"/customers/9778208","rel":"self","type":"GET"},{"href":"/jobs/20909314","rel":"edit","type":"PUT"},{"href":"/jobs/20909314/finalise","rel":"finalise","type":"POST"}]`.

## Endpoint Catalog

### Confirmed Working

| Method | Path                | Purpose                 | Status | Notes                                                                         |
| ------ | ------------------- | ----------------------- | ------ | ----------------------------------------------------------------------------- |
| GET    | `/version`          | API version             | 200    | health check; response `{"message":"<version-string>"}` [VERIFIED 2026-05-19] |
| GET    | `/company`          | company info & settings | 200    | Tax `{"rate":15,"type":"GST"}`                                                |
| GET    | `/customers`        | list customers          | 200    | paginated                                                                     |
| GET    | `/customers/{id}`   | get customer            | 200    |                                                                               |
| POST   | `/customers`        | create customer         | 201    | req `customerFullName`, `mainContact`                                         |
| PUT    | `/customers/{id}`   | update customer         | 200    | full replace                                                                  |
| GET    | `/sites`            | list sites              | 200    | paginated                                                                     |
| POST   | `/sites`            | create site             | 201    | req `defaultContact`, `siteAddress`                                           |
| PATCH  | `/sites/{id}`       | update site             | 200    | `siteAddress` always required                                                 |
| GET    | `/jobs`             | list jobs               | 200    | many filters, paginated                                                       |
| GET    | `/jobs/{id}`        | get job                 | 200    |                                                                               |
| POST   | `/jobs`             | create job              | 201    | jobType Quote/Estimate/Charge Up ONLY                                         |
| GET    | `/jobs/{id}/phases` | list phases             | 200    |                                                                               |
| GET    | `/users`            | list users              | 200    | paginated                                                                     |
| GET    | `/timeEntries`      | list time entries       | 200    | read-only, paginated                                                          |
| GET    | `/customerInvoices` | list invoices           | 200    | read-only, paginated                                                          |
| GET    | `/calendarEvents`   | list events             | 200    | date range model                                                              |
| GET    | `/enquiries`        | list enquiries          | 200    | paginated                                                                     |
| GET    | `/pricingTiers`     | list pricing tiers      | 200    | paginated                                                                     |
| GET    | `/favourites`       | list favourites         | 200    | paginated                                                                     |
| GET    | `/notes`            | list notes              | 200    | sortField=created_at (snake_case!)                                            |

### Confirmed NOT Working

| Method | Path                  | Error                                                 | Use Instead                                                                                  |
| ------ | --------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/quotes`             | 404: `"Route GET:/api/partner/quotes not found"`      | `/jobs/quotes`                                                                               |
| GET    | `/stockOnHand`        | 404: `"Route GET:/api/partner/stockOnHand not found"` | `/phases/{id}/stockOnHand`                                                                   |
| POST   | `/jobs/{id}/finalise` | 404 — wrong verb                                      | `PUT /jobs/{jobId}/finalise` (HATEOAS claims POST; spec is `put` only) [VERIFIED 2026-05-19] |

### Jobs

| Method | Path                             | Purpose                                                                                                                | Paginated | Idempotent |
| ------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| GET    | `/jobs`                          | list jobs                                                                                                              | Yes       | Yes        |
| POST   | `/jobs`                          | create job                                                                                                             | No        | No         |
| GET    | `/jobs/{jobId}`                  | get job by ID                                                                                                          | No        | Yes        |
| PUT    | `/jobs/{jobId}`                  | update draft job                                                                                                       | No        | Yes        |
| PUT    | `/jobs/{jobId}/finalise`         | finalise draft (PUT, not POST — HATEOAS link wrongly claims POST; response schema `JobResponse`) [VERIFIED 2026-05-19] | No        | Yes        |
| POST   | `/jobs/{jobId}/hold`             | put on hold                                                                                                            | No        | No         |
| POST   | `/jobs/{jobId}/resume`           | resume from hold                                                                                                       | No        | No         |
| GET    | `/jobs/{jobId}/financialSummary` | financial summary                                                                                                      | No        | Yes        |

All endpoints require auth.

### Job Phases

| Method | Path                                              | Purpose                   | Paginated | Idempotent |
| ------ | ------------------------------------------------- | ------------------------- | --------- | ---------- |
| GET    | `/jobs/{jobId}/phases`                            | list phases               | No        | Yes        |
| POST   | `/jobs/{jobId}/phases`                            | create phase              | No        | No         |
| GET    | `/jobs/{jobId}/phases/{phaseId}`                  | get phase                 | No        | Yes        |
| PUT    | `/jobs/{jobId}/phases/{phaseId}`                  | update phase              | No        | Yes        |
| POST   | `/jobs/{jobId}/phases/{phaseId}/void`             | void phase (irreversible) | No        | No         |
| GET    | `/jobs/{jobId}/phases/{phaseId}/financialSummary` | phase financials          | No        | Yes        |

### Quotes (Job-scoped)

| Method | Path                                 | Purpose                 | Paginated | Idempotent |
| ------ | ------------------------------------ | ----------------------- | --------- | ---------- |
| GET    | `/jobs/{jobId}/quotes`               | list quotes for job     | Yes       | Yes        |
| POST   | `/jobs/{jobId}/quotes`               | create quote            | No        | No         |
| GET    | `/jobs/{jobId}/quotes/{quoteId}`     | get quote               | No        | Yes        |
| PUT    | `/jobs/{jobId}/quotes/{quoteId}`     | update quote by ID      | No        | Yes        |
| PUT    | `/jobs/{jobId}/quotes/version/{ver}` | update quote by version | No        | Yes        |

### Quotes (Cross-Job) — use `/jobs/quotes`, NOT `/quotes` (404)

| Method | Path                                | Purpose           | Paginated | Idempotent |
| ------ | ----------------------------------- | ----------------- | --------- | ---------- |
| GET    | `/jobs/quotes`                      | list all quotes   | Yes       | Yes        |
| GET    | `/jobs/quotes/{quoteId}`            | get quote by ID   | No        | Yes        |
| GET    | `/jobs/quotes/guid/{guid}`          | get quote by GUID | No        | Yes        |
| POST   | `/jobs/quotes/{quoteId}/publish`    | publish           | No        | No         |
| POST   | `/jobs/quotes/{quoteId}/markAsSent` | mark as sent      | No        | No         |
| POST   | `/jobs/quotes/{quoteId}/accept`     | accept            | No        | No         |
| POST   | `/jobs/quotes/{quoteId}/decline`    | decline           | No        | No         |
| POST   | `/jobs/quotes/{quoteId}/void`       | void              | No        | No         |
| POST   | `/jobs/quotes/{quoteId}/totals`     | get totals        | No        | Yes        |

### Customers

| Method | Path                      | Purpose                      | Paginated | Idempotent |
| ------ | ------------------------- | ---------------------------- | --------- | ---------- |
| GET    | `/customers`              | list customers               | Yes       | Yes        |
| POST   | `/customers`              | create customer (303 if dup) | No        | No         |
| GET    | `/customers/{customerId}` | get customer                 | No        | Yes        |
| PUT    | `/customers/{customerId}` | update customer              | No        | Yes        |
| DELETE | `/customers/{customerId}` | delete customer              | No        | Yes        |

Create required: `customerFullName`, `mainContact` (with `firstName`). Update required: `customerFullName`, `mainContact` (full replace).

### Sites

| Method | Path                      | Purpose                  | Paginated | Idempotent |
| ------ | ------------------------- | ------------------------ | --------- | ---------- |
| GET    | `/sites`                  | list sites               | Yes       | Yes        |
| POST   | `/sites`                  | create site (303 if dup) | No        | No         |
| GET    | `/sites/{siteId}`         | get site                 | No        | Yes        |
| PATCH  | `/sites/{siteId}`         | update site              | No        | No         |
| POST   | `/sites/{siteId}/archive` | archive (soft delete)    | No        | No         |
| POST   | `/sites/{siteId}/restore` | restore                  | No        | No         |

Create required: `defaultContact` (with `firstName`, `lastName`), `siteAddress`. PATCH required: `siteAddress` (always, even for partial updates).

### Contacts

| Method | Path                    | Purpose        | Paginated | Idempotent |
| ------ | ----------------------- | -------------- | --------- | ---------- |
| GET    | `/contacts`             | list contacts  | Yes       | Yes        |
| POST   | `/contacts`             | create contact | No        | No         |
| GET    | `/contacts/{contactId}` | get contact    | No        | Yes        |
| PUT    | `/contacts/{contactId}` | update contact | No        | Yes        |

### Enquiries

| Method | Path                     | Purpose        | Paginated | Idempotent |
| ------ | ------------------------ | -------------- | --------- | ---------- |
| GET    | `/enquiries`             | list enquiries | Yes       | Yes        |
| POST   | `/enquiries`             | create enquiry | No        | No         |
| GET    | `/enquiries/{enquiryId}` | get enquiry    | No        | Yes        |

### Customer Invoices (read-only)

| Method | Path                            | Purpose            | Paginated | Idempotent |
| ------ | ------------------------------- | ------------------ | --------- | ---------- |
| GET    | `/customerInvoices`             | list invoices      | Yes       | Yes        |
| GET    | `/customerInvoices/{invoiceId}` | get invoice detail | No        | Yes        |

### Users

| Method | Path              | Purpose               | Paginated | Idempotent |
| ------ | ----------------- | --------------------- | --------- | ---------- |
| GET    | `/users`          | list users            | Yes       | Yes        |
| GET    | `/users/{userId}` | get user              | No        | Yes        |
| PATCH  | `/users/{userId}` | update user (partial) | No        | No         |

### Time Entries (read-only)

| Method | Path           | Purpose           | Paginated | Idempotent |
| ------ | -------------- | ----------------- | --------- | ---------- |
| GET    | `/timeEntries` | list time entries | Yes       | Yes        |

### Calendar Events

| Method | Path                        | Purpose                         | Paginated | Idempotent |
| ------ | --------------------------- | ------------------------------- | --------- | ---------- |
| GET    | `/calendarEvents`           | list events (date range)        | No        | Yes        |
| POST   | `/calendarEvents`           | create event                    | No        | No         |
| GET    | `/calendarEvents/{eventId}` | get event                       | No        | Yes        |
| POST   | `/calendarEvents/{eventId}` | update event (POST!)            | No        | No         |
| DELETE | `/calendarEvents/{eventId}` | delete event (NO Content-Type!) | No        | Yes        |

### Stock On Hand — `/stockOnHand` standalone returns 404; use `/phases/{phaseId}/stockOnHand`

| Method | Path                                 | Purpose              | Paginated | Idempotent |
| ------ | ------------------------------------ | -------------------- | --------- | ---------- |
| GET    | `/phases/{phaseId}/stockOnHand`      | list stock for phase | Yes       | Yes        |
| POST   | `/phases/{phaseId}/stockOnHand`      | add stock            | No        | No         |
| GET    | `/phases/stockOnHand`                | list all stock       | Yes       | Yes        |
| PATCH  | `/phases/{phaseId}/stockOnHand/{id}` | update stock         | No        | No         |
| DELETE | `/phases/{phaseId}/stockOnHand/{id}` | delete stock         | No        | Yes        |

### Stock Used (read-only)

| Method | Path         | Purpose               | Paginated | Idempotent |
| ------ | ------------ | --------------------- | --------- | ---------- |
| GET    | `/stockUsed` | historical stock used | Yes       | Yes        |

### Pricebooks & Pricing (read-only)

| Method | Path                                       | Purpose                | Paginated | Idempotent |
| ------ | ------------------------------------------ | ---------------------- | --------- | ---------- |
| GET    | `/pricingTiers`                            | list pricing tiers     | Yes       | Yes        |
| GET    | `/pricingTiers/{id}`                       | get pricing tier       | No        | Yes        |
| POST   | `/pricebooks/search`                       | search pricebook items | Yes       | Yes        |
| GET    | `/pricebooks`                              | list pricebooks        | Yes       | Yes        |
| GET    | `/pricebooks/{id}`                         | get pricebook          | No        | Yes        |
| GET    | `/pricebooks/{id}/pricebookItems`          | list items             | Yes       | Yes        |
| GET    | `/pricebooks/{id}/pricebookItems/{itemId}` | get item               | No        | Yes        |

### Favourites (read-only)

| Method | Path                      | Purpose                 | Paginated | Idempotent |
| ------ | ------------------------- | ----------------------- | --------- | ---------- |
| GET    | `/favourites`             | list favourite sections | Yes       | Yes        |
| GET    | `/favourites/{sectionId}` | get section             | No        | Yes        |

### Notes — sortField=created_at (snake_case!)

| Method | Path              | Purpose     | Paginated | Idempotent |
| ------ | ----------------- | ----------- | --------- | ---------- |
| GET    | `/notes`          | list notes  | Yes       | Yes        |
| POST   | `/notes`          | create note | No        | No         |
| PATCH  | `/notes/{noteId}` | update note | No        | No         |

### Server / Utility

| Method | Path          | Purpose                  | Paginated | Idempotent |
| ------ | ------------- | ------------------------ | --------- | ---------- |
| GET    | `/version`    | API version              | No        | Yes        |
| POST   | `/disconnect` | disconnect/revoke tokens | No        | No         |
| GET    | `/company`    | company info & settings  | No        | Yes        |

## Data Models

Full detail in `01a-domain-model-reference.md`. Summary:

- **Job:** id (int), description, jobType (Quote/Estimate/Charge Up ONLY), status (Draft transient → To Price), customer, siteAddress, links.
- **Customer:** id (int), customerFullName, mainContact, physicalAddress, pricingTier (auto-assigned).
- **Site:** id (int), name, defaultContact (REQUIRED), siteAddress (REQUIRED always), isArchived.
- **Quote:** id, versionNumber, jobId, title, sections[], isSent, isAccepted, isLocked (use /jobs/quotes NOT /quotes).
- **JobPhase:** id, jobId, title, description, status.
- **User:** id (int), firstName, lastName, email, userType, status, payRate, chargeOutRate.
- **TimeEntry:** timeEntryId, userId, startTime, endTime, paidDuration, jobId (read-only).
- **CalendarEvent:** id, userId, title, eventType, startTime, endTime, isRecurring.
- **CustomerInvoice:** id, jobId, customerId, invoiceNumber, subtotal, taxValue, status (read-only).
- **Note:** id, text, entityName, entityId, isPinned, parentId (sortField=created_at snake_case).
- **Contact:** linked to Customer or Site; firstName, contactItems[].
- **Enquiry:** id, name, email, description, source, status.
- **Pricebook:** id, supplierName, itemCount. **PricebookItem:** id, name, productCode, costPrice, retailPrice.
- **Company:** guid, name, contact, settings[], tax (rate 15, type "GST").

## Pagination

Cursor-based (integer offset, 0-based). Default page size 10 (varies by endpoint). Max not documented. Total via `paging.pageCount` (total pages).
Params: `pageSize` (number, default 10) · `pageCursor` (integer, default 0) · `sortOrder` (string, default "asc", asc/desc) · `sortField` (string, default varies).
Response: `{"result":"success","data":[...],"paging":{"perPage":10,"pageCount":5,"links":{"self":"/jobs?pageCursor=0&pageSize=10","previous":null,"next":"/jobs?pageCursor=10&pageSize=10"}}}`. Last page: `paging.links.next` is `null`. Exception: calendar events use date-range model, not cursor pagination.

## Rate Limits

Per company (all tokens): 100 requests / 1 minute. Headers: `x-ratelimit-limit` (100), `x-ratelimit-remaining`, `x-ratelimit-reset` (60), `retry-after` (429 only). When exceeded: 429 with `retry-after`. Strategy: honor `retry-after`; exponential backoff from 2s; max 60s; monitor `x-ratelimit-remaining` proactively.

## Error Handling

Formats vary by status code:

- 400 Validation: `{"error":"Bad Request","message":"Validation Failed: [<body>: must have required property 'defaultContact'].","statusCode":400}`
- 403 Forbidden (minimal): `{"message":"Forbidden"}`
- 404 Not Found (reveals internal path): `{"message":"Route GET:/api/partner/quotes?pageSize=3 not found","error":"Not Found","statusCode":404}`
- 415 Wrong Content-Type: `{"error":"FastifyError","message":"Unsupported Media Type: ...","statusCode":415}`

| Status | Meaning                  | Retryable | Recovery                                                          |
| ------ | ------------------------ | --------- | ----------------------------------------------------------------- |
| 303    | duplicate (redirect)     | No        | follow `location` header                                          |
| 400    | bad request / validation | No        | fix request                                                       |
| 401    | unauthorized             | Yes       | refresh token                                                     |
| 403    | forbidden                | No        | check permissions (response: `{"message":"Forbidden"}`)           |
| 404    | not found                | No        | verify ID; some endpoints don't exist (`/quotes`, `/stockOnHand`) |
| 409    | conflict                 | Maybe     | re-read and retry                                                 |
| 415    | wrong Content-Type       | No        | fix headers; DELETE: omit Content-Type                            |
| 422    | validation error         | No        | fix fields                                                        |
| 429    | rate limited             | Yes       | wait + retry                                                      |
| 5xx    | server error             | Yes       | retry with backoff                                                |

## Webhooks / Events

Listed as a Fergus feature on API Tracker, but NO webhook endpoints in the OpenAPI spec; details not documented. Polling fallback: `modifiedAfter` on `/jobs/quotes` (NOT `/quotes`, 404) for quote changes; sort `/jobs` by `lastModified desc` for job changes.

## Known Limitations

1. No file upload/download endpoints.
2. Time entries and invoices read-only.
3. No bulk/batch operations.
4. Rate limit 100 req/min shared across entire company (all tokens).
5. Calendar events not paginated (date-range model only).
6. Stock used has 180-day lookback maximum.
7. No webhook endpoints in public API spec.
8. No field selection / sparse fields.
9. `/quotes` standalone → 404; use `/jobs/quotes`.
10. `/stockOnHand` standalone → 404; use `/phases/{id}/stockOnHand`.
11. `/jobs/{id}/finalise` is PUT, not POST (HATEOAS `"type":"POST"` is a server bug). [VERIFIED 2026-05-19]
12. jobType only `Quote`/`Estimate`/`Charge Up`; "Service"/"Project" invalid.
13. DELETE must NOT include Content-Type header.
14. PATCH /sites always requires `siteAddress` even for partial updates.
15. Site create requires `defaultContact` with `firstName`+`lastName`.
16. Notes sort field is snake_case (`created_at`, not `createdAt`).

## SDKs & Tooling

| SDK               | Language   | Repository                                 | Quality | Notes                       |
| ----------------- | ---------- | ------------------------------------------ | ------- | --------------------------- |
| Fergus MCP Server | TypeScript | https://github.com/Jayco-Design/fergus-mcp | Good    | community, 26+ tools, MIT   |
| (no official SDK) | —          | —                                          | —       | no official Python/Node SDK |

Postman: https://www.postman.com/fergusfrl12/fergus-workspace/overview · OpenAPI spec: https://api.fergus.com/docs/json (OAS 3.1.0).

## Integration Path Assessment

Recommended: Hybrid (Data Connector + Direct API). Justification: rich browsable structured content (jobs, customers, sites, quotes, invoices, time entries) for a Data Connector, plus significant write capabilities (create jobs, customers, quotes, calendar events) via Direct API in the workspace agent.
Connector compatibility: list_files → GET /jobs, /customers, /sites (top-level nav) · download_file → GET /jobs/{id}, /customers/{id} (JSON) · search_files → GET /jobs?filterSearchText= (substring) · get_file_metadata → GET /jobs/{id} (entity metadata). All feasibility: Good.

_Source: OpenAPI spec (api.fergus.com/docs/json), MCP server (github.com/Jayco-Design/fergus-mcp), live API testing._
