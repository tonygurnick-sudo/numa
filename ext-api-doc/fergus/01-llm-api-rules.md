---
api_name: Fergus
api_slug: fergus
base_url: https://api.fergus.com
route_prefix_injected_by_connector: /api/partner
path_version_segment: none
auth: Bearer {token}
field_casing: camelCase
id_format: integer
rate_limit: 100/min per company, shared across all tokens and endpoints
integration_path: hybrid (Data Connector + Direct API)
confidence: every fact is live-API-confirmed 2026-04-04 unless tagged [INFERRED] or [VERIFIED <date>]
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# Fergus — API Rules

## Paths (read first)

- Pass FLAT resource paths: `/jobs`, `/customers/{id}`. The connector injects `/api/partner` → server route is `/api/partner/jobs`.
- NO version segment. "v1" is a label only; it never appears in a path. `/v1/...` → 404.
- Do NOT prepend `/api/partner` yourself; the connector adds it. Do NOT add `/v1/`.
- Full-URL form is equivalent: `https://api.fergus.com/jobs`.

## Auth

`Authorization: Bearer {token}` + `Content-Type: application/json`.

- DELETE: omit `Content-Type` (or send body `{}`). Otherwise: `"Body cannot be empty when content-type is set to 'application/json'"`.
- Token: PAT (long-lived, from Fergus account settings) or OAuth2. OAuth2 refresh: `POST https://auth.fergus.com/oauth2/token`.

## CAN

List/search/view: jobs, customers, sites, invoices, time entries, calendar events, enquiries, notes, pricebooks, favourites. Create: jobs, customers, sites, enquiries, calendar events, notes, contacts. Update: draft jobs, customers (PUT=full replace), sites (PATCH), users (limited), notes. Quote lifecycle via `/jobs/quotes/{quoteId}/{action}`: publish, mark-sent, accept, decline, void. Job hold/resume. View financial summaries, quote totals, company info, pricing tiers. Search pricebook (min 3 chars).

## CANNOT

Create/modify time entries (read-only). Create/modify invoices (read-only). Upload/download files (no file endpoints). Create users (read+update only). DELETE anything except `customers` and `stockOnHand`. Modify pricebooks/pricing tiers (read-only). Webhooks (none — poll only). Bulk/batch writes (single-record only).

## Gotchas

1. `jobType` ∈ {`Quote`,`Estimate`,`Charge Up`} ONLY ("Service"/"Project" don't exist). Err: `"The jobType must be one of 'Quote', 'Estimate', or 'Charge Up'"`.
2. Job status is transient: POST returns `status:"Draft"`; an immediate GET returns `"To Price"` for Quote jobs.
3. POST `/sites` requires BOTH `defaultContact` (with `firstName`+`lastName`) and `siteAddress`. Err: `"must have required property 'defaultContact'"`.
4. PATCH `/sites/{id}` requires `siteAddress` even on partial updates. Err: `"must have required property 'siteAddress'"`.
5. Customer/site POST returns 303 + `location` header on duplicate → follow the redirect to get the existing resource.
6. Only draft jobs (`isDraft:true`) are PUT-updatable; non-draft create requires `customerId`+`siteId`.
7. Calendar-event update = `POST /calendarEvents/{id}` (PUT not used).
8. `pageCursor` is a 0-based integer; default page size 10.
9. Notes sort uses snake_case: `sortField=created_at` (the only endpoint with this).
10. Job finalise = `PUT /jobs/{id}/finalise` (POST→404; HATEOAS `type:"POST"` is a server bug, spec defines `put` only) [VERIFIED 2026-05-19].

## Defaults (override only if the user specifies)

`pageSize=20` (balances data vs rate budget), `sortOrder=desc`, `sortField=createdAt`, `filterShowArchived=false`, `filterShowOnHold=true`.

## Operations

| Operation          | Method | Path                           | Key params / notes                                                 |
| ------------------ | ------ | ------------------------------ | ------------------------------------------------------------------ |
| List jobs          | GET    | /jobs                          | filterJobStatus, filterCustomerId, filterSearchText (many filters) |
| Get job            | GET    | /jobs/{jobId}                  | —                                                                  |
| Create job         | POST   | /jobs                          | jobType, title, customerId, siteId; `isDraft=true` for draft       |
| Job phases         | GET    | /jobs/{jobId}/phases           | —                                                                  |
| Hold / resume      | POST   | /jobs/{jobId}/hold \| /resume  | holdUntil, notes                                                   |
| List customers     | GET    | /customers                     | filterSearchText (name/contact/email)                              |
| Create customer    | POST   | /customers                     | customerFullName, mainContact; 303 if duplicate                    |
| Update customer    | PUT    | /customers/{id}                | full replace                                                       |
| List sites         | GET    | /sites                         | filterSearchText, filterSiteName                                   |
| Create site        | POST   | /sites                         | defaultContact (req), siteAddress (req); 303 if duplicate          |
| Update site        | PATCH  | /sites/{id}                    | siteAddress req even on PATCH                                      |
| List quotes        | GET    | /jobs/quotes                   | filterStatus, createdAfter (cross-job; NOT /quotes)                |
| Create quote       | POST   | /jobs/{jobId}/quotes           | title, dueDays, sections                                           |
| Publish quote      | POST   | /jobs/quotes/{quoteId}/publish | locks the quote                                                    |
| Accept quote       | POST   | /jobs/quotes/{quoteId}/accept  | —                                                                  |
| List invoices      | GET    | /customerInvoices              | customerId, jobId, dueBefore (read-only)                           |
| List time entries  | GET    | /timeEntries                   | filterDateFrom, filterUserId (read-only)                           |
| List calendar      | GET    | /calendarEvents                | filterDateFrom, filterCalendarRange                                |
| Create event       | POST   | /calendarEvents                | startTime, endTime, eventType, eventTitle                          |
| List users         | GET    | /users                         | filterUserType, filterStatus                                       |
| Search pricebook   | POST   | /pricebooks/search             | search (min 3 chars)                                               |
| List notes         | GET    | /notes                         | filterEntityName, filterEntityId; sortField=created_at             |
| Create note        | POST   | /notes                         | text, entityName, entityId                                         |
| Get company        | GET    | /company                       | settings, tax info                                                 |
| List favourites    | GET    | /favourites                    | template sections                                                  |
| List pricing tiers | GET    | /pricingTiers                  | —                                                                  |
| List enquiries     | GET    | /enquiries                     | —                                                                  |

## Unavailable (404)

- `/quotes` → use `/jobs/quotes`. Err: `"Route GET:/api/partner/quotes not found"`.
- `/stockOnHand` → use `/phases/{id}/stockOnHand`. Err: `"Route GET:/api/partner/stockOnHand not found"`.
- POST `/jobs/{id}/finalise` → use PUT (gotcha 10).

## Pagination

Cursor-based, 0-based integer offset. Default size 10 (endpoint-varies); use 20–50. `?pageSize=20&pageCursor=0` then `&pageCursor=20`… taking the cursor from `paging.links.next`. Last page when `paging.links.next == null`. Shape: `paging:{perPage,pageCount,links:{self,previous,next}}`.

## Errors

Formats: 400/404/415 → `{error,message,statusCode}`; 403 → `{message:"Forbidden"}` only.
Recovery: 400/422 fix params per `message` · 401 refresh token then retry · 403 check permissions · 404 verify id/endpoint exists · 409 re-read then retry · 415 fix headers (DELETE: drop Content-Type) · 429 wait `retry-after` then retry · 5xx exponential backoff (≤3).

## Examples

1. List a customer's active jobs:
   `GET /jobs?filterCustomerId=9778208&filterJobStatus=Active&sortField=lastModified&sortOrder=desc&pageSize=20`
   → `{"result":"success","data":[{"id":20909314,"jobNo":"J-0042","description":"Kitchen renovation","jobType":"Quote","status":"Active","customer":{"id":9778208,"customerFullName":"Smith Ltd"},"siteAddress":{"id":8169663,"name":"Main Office"},"onHold":false,"archived":false,"links":[{"href":"/jobs/20909314","rel":"self","type":"GET"}]}],"paging":{"perPage":20,"pageCount":1,"links":{"self":"...","previous":null,"next":null}}}`

2. Create a customer (`POST /customers`):
   `{"customerFullName":"ABC Electrical Ltd","mainContact":{"firstName":"Jane","lastName":"Doe","contactItems":[{"contactType":"email","contactValue":"jane@abc.co.nz"},{"contactType":"phone","contactValue":"+64 9 555 1234"}]},"physicalAddress":{"address1":"456 Queen St","addressCity":"Auckland","addressCountry":"New Zealand"}}`
   → `{"result":"success","data":{"id":9778208,"customerFullName":"ABC Electrical Ltd","companyId":12345,"mainContact":{"id":50,"firstName":"Jane"},"pricingTier":{"id":1,"name":"Default"}}}`

3. Create a job (`POST /jobs`):
   `{"jobType":"Quote","title":"Pipe repair","description":"Fix leaking kitchen pipe","customerId":9778208,"siteId":8169663}`
   → 201; `status:"Draft"` on create, `"To Price"` on GET. Response `data.links` carry HATEOAS: `self`(GET), `edit`(PUT), `finalise`(POST — but USE PUT, gotcha 10).
