---
api_name: WorkflowMax (by Xero)
api_slug: workflowmax
generation: WorkflowMax 2 (OAuth2 tier — NOT the retired api.xero.com/Xero-tenant-id flow)
base_url: https://api.workflowmax2.com (the connect_request proxy base URL is authority; do not hardcode a host)
path_version_segment: none on legacy {resource}.api/{action} paths; modern v2 write paths carry a literal /v2/ (e.g. POST /v2/jobs)
path_rule: pass the FLAT path (e.g. /job.api/current, /job/{UUID}, /v2/jobs/{UUID}); proxy prepends host; never add /v3.0/ or api.xero.com
auth: OAuth2 Bearer {token} + MANDATORY account_id header (Org UUID, decoded from JWT) on EVERY call
field_casing: PascalCase (UUID, Name, ClientUUID, WhenModified)
id_format: dual — UUID (link key, never the human ID) + human ID (J000123 / INV-001234, display only)
rate_limit: unpublished; ~1000/hr + ~10/s cited for legacy only [INFERRED]; poll ≥15min, backoff on error
call_surface: HTTP via `numa integrations request` (Direct-API). NOT a file store — no list-files/download-file. No MCP.
confidence: NO live call made; every fact [INFERRED] unless tagged [DOCUMENTED]/[CONFIRMED]. Verify on first live response.
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# WorkflowMax (by Xero) — API Rules

## Call surface (read first)

- HTTP only, via `numa integrations request` (connector="workflowmax"). Proxy injects `Authorization: Bearer {token}` + `account_id` header + base host. You supply path + params; you never handle tokens.
- This is a query/action API, NOT a file store — there is no list-files/download-file/search-files surface.

## Paths

- Two coexisting shapes on the WorkflowMax 2 tier — both work:
  - Legacy: `/{resource}.api/{action}` e.g. `GET /job.api/list`, `GET /job.api/current`. NO version segment.
  - Modern v2: `/{resource}/{UUID}` reads e.g. `GET /job/{UUID}`; writes carry literal `/v2/` e.g. `POST /v2/jobs`, `PUT /v2/jobs/{UUID}` [DOCUMENTED from portal].
- Pass the flat path; the proxy prepends the host. Do NOT prepend a host, do NOT add `/3.0/`, do NOT use `api.xero.com`/`identity.xero.com`/`Xero-tenant-id` — those are the RETIRED generation.
- Base host `api.workflowmax2.com` is [INFERRED]; legacy `api.workflowmax.com` may also serve the same paths. A host-level 404 → try the other host before assuming the resource is wrong (Gotcha 1). The proxy base URL is the authority.

## Auth

- `Authorization: Bearer {token}` (short-lived JWT ~12-30min) + `account_id: {org_uuid}` (REQUIRED every call) + `Accept: application/json` (legacy default is XML — always send this).
- `account_id` is the Org UUID, NOT a job/client id. Missing it → 401/403. Proxy injects it.
- Agent does not manage tokens. On 401, treat as "token expired / reconnect required" — do NOT blind-retry.
- ⚠️ Registry scope omits `offline_access` → no refresh token issued → connection dies every ~12-30min needing full re-consent. Connector-owner fix, not an agent-time fix.
- Connecting staff member must have "Authorise 3rd Party Full Access" on their WorkflowMax staff record or calls 403. [DOCUMENTED]

## CAN

List/read: jobs, clients, contacts, invoices, time entries, staff, quotes, purchase orders, suppliers, leads, costs, categories. Reporting (WIP, overdue jobs, hours per staff/job in a date range, outstanding invoices). Create/update low-risk records on explicit intent: create job, log time, add/update client or contact. Filter by date range (`from`/`to`, compact `YYYYMMDD`); use dedicated `current` endpoints for active-only jobs/invoices/leads.

## CANNOT

Delete/archive clients/jobs without explicit confirmation (`client.api/delete` + `client.api/archive` are destructive). Issue/finalise/modify invoices/billing without human-in-the-loop confirmation. Bulk anything (no bulk endpoints — single-record only, do not hammer). Webhooks (none — poll only).

## Critical Gotchas

1. **Base host unconfirmed.** Host-level 404 → try the other host (`api.workflowmax2.com` ↔ `api.workflowmax.com`) before concluding the resource/UUID is wrong.
2. **`account_id` mandatory on EVERY call** — Org UUID, not a record id. Missing → 401/403. First suspect on any auth error (after expired token).
3. **HTTP 200 can still be an error.** Legacy endpoints return `200` with body `{"Status":"Error",...}` (XML: `<Status>Error</Status>`) for business/validation failures. ALWAYS check the body `Status` field, not just the HTTP code. [DOCUMENTED for legacy XML]
4. **`detailed` toggle, not field selection.** `detailed=false` (default) = summaries; `detailed=true` embeds child collections (Tasks/Costs). No per-field selection. Fetch summaries first; fetch detail per-UUID only when needed.
5. **Use `UUID` for relationships, `ID` for humans.** Every entity carries both a stable `UUID` (link key) and a human number `ID` (`J000123`). Never pass the human `ID` where a `UUID` is expected.

## Defaults (override only if the user specifies)

`pagesize=100`, `detailed=false`, `Accept=application/json`, date filters `from`/`to`=`YYYYMMDD`. Active jobs: use `/job.api/current`, not a status filter.

## Operations

> Legacy `{resource}.api/{action}` shown (OAuth2 tier reuses them). Modern equivalent in Notes. Full catalog + fields in 01a/01b/01c.

| Operation        | Method | Path                 | Key params / notes                                               |
| ---------------- | ------ | -------------------- | ---------------------------------------------------------------- |
| List jobs        | GET    | /job.api/list        | page,pagesize,detailed,from,to · modern `GET /job`               |
| List active jobs | GET    | /job.api/current     | detailed · active only, no status filter                         |
| Get job          | GET    | /job.api/get         | uuid · modern `GET /job/{uuid}`                                  |
| Create job       | POST   | /job.api/add         | body; needs existing `ClientUUID` (01c) · modern `POST /v2/jobs` |
| Update job       | PUT    | /job.api/update      | body w/ `UUID` (01c) · modern `PUT /v2/jobs/{uuid}`              |
| List clients     | GET    | /client.api/list     | page,pagesize · modern `GET /client`                             |
| Get client       | GET    | /client.api/get      | uuid                                                             |
| Create client    | POST   | /client.api/add      | body                                                             |
| Update client    | PUT    | /client.api/update   | body w/ `UUID`                                                   |
| Archive client   | POST   | /client.api/archive  | uuid · **destructive — confirm**                                 |
| Delete client    | DELETE | /client.api/delete   | uuid · **destructive — confirm**                                 |
| List invoices    | GET    | /invoice.api/list    | page,pagesize · `/invoice.api/current` for outstanding           |
| List time        | GET    | /time.api/list       | from,to · modern `GET /time`                                     |
| Log time         | POST   | /time.api/add        | body; needs `Job`+`Staff`(+`Task`) (01c)                         |
| List staff       | GET    | /staff.api/list      | — · best connectivity check                                      |
| List quotes      | GET    | /quote.api/list      | page,pagesize [INFERRED]                                         |
| List suppliers   | GET    | /supplier.api/list   | page,pagesize [INFERRED]                                         |
| List leads       | GET    | /lead.api/list       | from,to · also `/lead.api/current`, `/lead.api/categories`       |
| List costs       | GET    | /cost.api/list       | page,pagesize [INFERRED]                                         |
| List categories  | GET    | /categories.api/list | — · reference data, cacheable                                    |

## Pagination

Page-number (`page` 1-based + `pagesize`). Default size = server (commonly 100); max [UNKNOWN]. JSON likely carries a count (`PageInfo.TotalRecords` / `totalrecords`); legacy XML exposes it as a collection attribute. Loop `page=1,2,3…`; stop when a page returns **fewer than `pagesize`** items, or `page*pagesize >= TotalRecords`. No cursor → page-number paging over a changing dataset can skip/repeat; de-dupe on `UUID`.

## Errors

Format (legacy envelope, likely on reused endpoints): `{"Status":"Error","ErrorDescription":"..."}` (XML: `<Response><Status>Error</Status><ErrorDescription>...</ErrorDescription></Response>`). Modern v2 may use HTTP 4xx + `{"message":"..."}` [INFERRED].

Recovery by status:
| Status | Meaning | Action |
| --- | --- | --- |
| 200 + `Status:"Error"` | business/validation error in body | read `ErrorDescription`; do NOT retry |
| 400 | bad request | fix params; no retry |
| 401 | expired/invalid token | surface "reconnect required"; do NOT blind-retry |
| 403 | missing `account_id` OR no 3rd-party access | header issue / user must enable access |
| 404 | unknown UUID/resource OR wrong base host | verify UUID; try the other host once |
| 429 (assumed) | rate limited | exponential backoff + jitter, retry ≤3 |
| 5xx | server error | exponential backoff, retry ≤3 |

## Examples

> Shown as JSON (`Accept: application/json`). Legacy XML wraps the same field names in `<Response><Status>OK</Status>…`.

1. Connectivity check — list staff (lowest-risk first call):
   `GET /staff.api/list` → `{"Status":"OK","StaffList":[{"UUID":"0d6d8234-1a2b-4c3d-9e8f-9f1a55667788","Name":"Jane Smith","Email":"jane@acme.co.nz"},{"UUID":"1e7f9345-2b3c-5d4e-af90-a02b66778899","Name":"Raj Patel","Email":"raj@acme.co.nz"}]}`

2. List active jobs (summary):
   `GET /job.api/current?page=1&pagesize=100` → `{"Status":"OK","Jobs":[{"ID":"J000123","UUID":"e3b0c442-98fc-1c14-9afb-f4c8996fb1a2","Name":"Website Redesign","State":"In Progress","Client":{"UUID":"a1b2c3d4-0000-1111-2222-333344445555","Name":"Acme Ltd"},"StartDate":"2026-05-01","DueDate":"2026-06-30"}]}`

3. This week's time entries (reporting):
   `GET /time.api/list?from=20260525&to=20260531` → `{"Status":"OK","Times":[{"UUID":"7a8b9c0d-...-ff11","Job":"J000123","Staff":"0d6d8234-...-9f1a","Task":"Discovery","Date":"2026-05-27","Minutes":90,"Billable":"Yes","Note":"Stakeholder workshop"}]}`

4. Get one job with full detail (tasks + costs):
   `GET /job.api/get?uuid=e3b0c442-98fc-1c14-9afb-f4c8996fb1a2&detailed=true` → `{"Status":"OK","Job":{"ID":"J000123","UUID":"e3b0c442-...-fb1a2","Name":"Website Redesign","State":"In Progress","Budget":"12000.00","Client":{"UUID":"a1b2c3d4-...-5555","Name":"Acme Ltd"},"Tasks":[{"UUID":"...","Name":"Discovery","EstimatedMinutes":600}],"Costs":[{"UUID":"...","Description":"Stock photos","Amount":"120.00"}]}}`
