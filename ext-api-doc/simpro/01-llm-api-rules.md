---
api_name: simPRO
api_slug: simpro
base_url: https://{build}.simprosuite.com/api/v1.0/
path_version_segment: /api/v1.0 — REAL path segment, already in base_url; do NOT add or strip it
route_prefix_injected_by_connector: scheme + {build}.simprosuite.com + /api/v1.0 (you pass the resource path only)
company_scope: /companies/{companyID}/ — REAL path segment, mandatory on every resource path
auth: Bearer {access_token} (OAuth2) OR Bearer {api_key} (Direct Access); + Content-Type: application/json on POST/PATCH/PUT
field_casing: PascalCase (Type, CompanyName, SiteID, DateIssued)
id_format: integer (file-attachment IDs are strings; recurring-job/folder IDs are long)
rate_limit: 10 req/sec per build, shared across ALL consumers/tokens; no rate-limit headers; HTTP 429 when exceeded
call_surface: HTTP via `numa integrations request` (NOT file-browse, NOT MCP)
integration_path: hybrid (Data Connector + Direct API)
confidence: facts confirmed (forum / official PHP SDK / SyncHub data model) unless tagged [INFERRED]/[UNKNOWN]/[VERIFIED <date>]
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# simPRO — API Rules

## Call surface

HTTP only — invoke via `numa integrations request`. simPRO is NOT a file-store connector and NOT MCP.

## Paths (read first)

- Base URL already ends in `/api/v1.0/`. `/api/v1.0` is a REAL path segment — it stays. There is no `/v1/`.
- Pass the resource path scoped under a company: `/companies/{companyID}/jobs/`, `/companies/{companyID}/jobs/{id}`.
- Top-level (no company): `/companies/`, `/webhooks/`.
- Trailing slash on collection endpoints (`/jobs/`); no trailing slash on item endpoints (`/jobs/{id}`).
- `companyID` is mandatory in every resource path. Do NOT hardcode `0` — it is a legacy single-build folklore shortcut that only works on some builds. Canonical: `GET /companies/` → use a real `ID`. (`0` may appear in defaults/examples but discover the real id when unsure.)

## Auth

`Authorization: Bearer {token}` + `Content-Type: application/json` (POST/PATCH/PUT). Token = OAuth2 access token (1hr) or Direct Access api_key (long-lived). Refresh: `POST https://{build}.simprosuite.com/oauth2/token`, `grant_type=refresh_token` (per-build; `auth.simpro.co` is NXDOMAIN). Refresh tokens are single-use — persist the new one every refresh.

## CAN

List/get/create/update: jobs, quotes, leads, customers (company+individual), contacts, sites, contractors, catalogs, vendors, purchaseOrders, assets, schedules. Read+update: employees, customerInvoices. Delete: jobs (DELETE; prefer Archive). Filter by field-value with operators `gt() lt() ge() le() ne() between()` + `%` wildcard. Nested-field filter via dot notation (`?CustomFields.CustomField.ID=35`). `?columns=` field selection; `?orderby=` sort (`-` prefix = desc, comma = multi). `If-Modified-Since` header for change detection. Job cost-center breakdowns via sub-resources. Manage webhooks (22 event types).

## CANNOT

Bulk/batch create/update/delete (single-record only — 100 jobs = 100 PATCHes). Full-text search (no search endpoint; use field filters + wildcards). OR logical operator (multiple params are AND-only). Modify system config (status codes, custom fields, security groups). Upload/download file attachments (entities exist, upload API undocumented). Cross-company access without an explicit companyID.

## Gotchas

1. **PATCH returns 204 even on silent rejection.** Status changes violating priority return 204 but do nothing. ALWAYS verify with a GET after PATCH. Quote-status PATCH that is silently rejected even fires a webhook despite no change. [known bug — forum]
2. Status codes are hierarchical: cannot set a lower-priority status unless "Ignore status priority" is enabled.
3. Default `pageSize=30`; max `250`. Always set `pageSize=250` for large pulls.
4. `orderby` + `If-Modified-Since` + certain columns (e.g. `AssignedTo`) → HTTP 500. Avoid combining all three.
5. Filter field names matter: use `CompanyName` (not `Name`) for company customers. The `ID` column is not searchable on some endpoints.
6. `Type` enum: `Service`, `Project`, `Prepaid` ONLY.
7. Custom fields may be ignored on job-create POST — apply them in a separate PATCH after create.
8. Build the job hierarchy top-down: Job → Section → CostCenter → (Labor|Materials|Schedule). Each parent must exist before its child.
9. FK fields are plain integer IDs (`CompanyCustomerID:45`, `SiteID:1`), not nested objects.
10. Pagination metadata is in response HEADERS, not body. Body is a bare JSON array.

## Defaults (override only if the user specifies)

`companyID=0` (single-company fallback — discover real id when unsure), `pageSize=250`, `columns`=omit (API returns default fields).

## Operations

| Operation                     | Method         | Path                                                                     | Key params / notes                              |
| ----------------------------- | -------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| List companies                | GET            | /companies/                                                              | discover companyID; returns `{ID,Name}[]`       |
| List jobs                     | GET            | /companies/{cid}/jobs/                                                   | page, pageSize, columns, orderby, field filters |
| Get job                       | GET            | /companies/{cid}/jobs/{id}                                               | columns                                         |
| Create job                    | POST           | /companies/{cid}/jobs/                                                   | Type + (Company/IndividualCustomerID) + SiteID  |
| Update job                    | PATCH          | /companies/{cid}/jobs/{id}                                               | returns 204 — verify with GET                   |
| Replace job                   | PUT            | /companies/{cid}/jobs/{id}                                               | full update                                     |
| Delete job                    | DELETE         | /companies/{cid}/jobs/{id}                                               | prefer Archive                                  |
| List/get/create/update quotes | GET/POST/PATCH | /companies/{cid}/quotes/[{id}]                                           | —                                               |
| List/create/update leads      | GET/POST/PATCH | /companies/{cid}/leads/[{id}]                                            | —                                               |
| Company customers             | GET/POST/PATCH | /companies/{cid}/customers/companies/[{id}]                              | filter `CompanyName` not `Name`                 |
| Individual customers          | GET/POST/PATCH | /companies/{cid}/customers/individuals/[{id}]                            | GivenName/FamilyName req on create              |
| List contacts                 | GET            | /companies/{cid}/contacts/                                               | —                                               |
| List sites                    | GET            | /companies/{cid}/sites/                                                  | —                                               |
| List employees                | GET            | /companies/{cid}/employees/                                              | read+update only                                |
| List contractors              | GET            | /companies/{cid}/contractors/                                            | —                                               |
| List catalog                  | GET            | /companies/{cid}/catalogs/                                               | —                                               |
| List vendors                  | GET            | /companies/{cid}/vendors/                                                | —                                               |
| List invoices                 | GET            | /companies/{cid}/customerInvoices/                                       | read+update only                                |
| List POs                      | GET            | /companies/{cid}/purchaseOrders/                                         | —                                               |
| List assets                   | GET            | /companies/{cid}/assets/                                                 | —                                               |
| List schedules                | GET            | /companies/{cid}/schedules/                                              | —                                               |
| Job sections                  | GET/POST       | /companies/{cid}/jobs/{jid}/sections/                                    | —                                               |
| Cost centers                  | GET/POST       | /companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/                  | —                                               |
| Schedules (nested)            | GET/POST       | /companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/{ccid}/schedules/ | —                                               |
| List/create webhooks          | GET/POST       | /webhooks/                                                               | Body: url, events                               |
| Delete webhook                | DELETE         | /webhooks/{id}                                                           | —                                               |

## Pagination

Page-number based. Body = bare JSON array. Metadata in HEADERS: `Result-Total`, `Result-Pages`, `Result-Count`, `Link` (`rel="next"/"last"/"first"/"prev"`). Params: `?page=1&pageSize=250` (1-indexed; pageSize 1–250). Last page = no `rel="next"` in `Link`, OR `page >= Result-Pages`, OR array length < pageSize.

## Errors

Format: `{"status":"error","url":"...","header":{},"data":{"errors":[{"path":<field|null>,"message":"...","value":<val|null>}]}}`. Multiple validation errors can return in one `data.errors` array. `header` echoes your request headers.
Recovery: 400/422 fix params per `data.errors[].message` · 401 refresh token then retry once · 403 access-type/permission or wrong companyID — do NOT loop refresh · 404 verify id + companyID · 405 wrong method · 409 re-fetch then retry · 429 wait ≥1s, exponential backoff (cap 8 req/sec) · 5xx backoff (≤3); 503 check status.simprogroup.com.

## Examples

1. List newest jobs (key fields):
   `GET /companies/0/jobs/?columns=ID,Type,Status,DateIssued,Customer,Site&orderby=-DateIssued&pageSize=250&page=1`
   → headers `Result-Total:816 Result-Pages:4 Result-Count:250`, `Link:<...?page=2>; rel="next", <...?page=4>; rel="last"`; body `[{"ID":1,"Type":"Service",...},{"ID":2,"Type":"Project",...}]`

2. Filter invoices by date range:
   `GET /companies/0/customerInvoices/?DateIssued=between(2026-01-01,2026-03-31)&pageSize=250`

3. Wildcard name search:
   `GET /companies/0/customers/individuals/?GivenName=Rose%&FamilyName=A%&pageSize=100` (AND-combined; `%`=any chars)

4. Create a job (`POST /companies/0/jobs/`):
   `{"Type":"Service","CompanyCustomerID":45,"SiteID":1}` → returns created job with auto `ID`. Customer + Site must exist first. Custom fields need a separate PATCH after create.

5. Update job status + verify:
   `PATCH /companies/0/jobs/123` `{"StatusID":10}` → 204. Then `GET /companies/0/jobs/123?columns=ID,StatusID,Stage` to confirm (204 may be a silent rejection).

6. Create webhook (`POST /webhooks/`):
   `{"url":"https://your-endpoint.com/webhook","events":["job.created","job.updated","job.stage.complete"]}`
