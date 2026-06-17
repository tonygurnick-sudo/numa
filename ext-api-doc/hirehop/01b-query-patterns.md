---
api_name: HireHop
api_slug: hirehop
doc: query-patterns (companion to 01-llm-api-rules.md — on-demand)
call_surface: HTTP via `numa integrations request`; path = {base_url}{path} incl. .php script; X-TOKEN header
confidence: MEDIUM-LOW for query specifics — NO uniform filter grammar (each .php endpoint defines its own named params). Documented, NOT live-tested. Tags [INFERRED]/[UNKNOWN] where below default
---

# HireHop — Query Patterns Reference

All read patterns: filtering, search, sorting, pagination, bulk reads.

## Query Capabilities Summary

| Capability                 | Supported        | Syntax / Notes                                                 |
| -------------------------- | ---------------- | -------------------------------------------------------------- |
| Filter by field value      | Partial          | Endpoint-specific params; NO uniform `?filter[x]=`             |
| Filter by date range       | Yes (some)       | `date`+`date_range` on availability endpoints                  |
| Full-text search           | Partial          | Search params on `get_contacts.php`; not uniform [INFERRED]    |
| Sort by field              | Partial          | Endpoint-specific; not consistently documented [INFERRED]      |
| Field selection            | No               | Not supported [INFERRED]                                       |
| Include related records    | No               | Jobs don't embed line items — separate calls                   |
| Aggregation / count        | Yes (some)       | `jobs_totals.php`, `job_margins.php` (computed totals/margins) |
| Logical operators (AND/OR) | No               | Implicit AND of params at best [INFERRED]                      |
| Comparison operators       | No               | Only explicit date-range params [INFERRED]                     |
| Null checks                | No               | Not supported [INFERRED]                                       |
| Raw SQL                    | Yes (deprecated) | `/api/sql_execute.php` — **Do NOT use**, unsafe                |

## Common Patterns

### 1. Get a single job by ID

`GET /api/job_data.php?job=52` (X-TOKEN header). `/php_functions/job_refresh.php?job=52` is an equivalent UI alias. **Both return metadata ONLY — no line items.**

### 2. List & filter (no uniform grammar)

General form: `GET /php_functions/{action}.php?{param}={value}&{param2}={value2}`. No `?filter[...]` syntax, no OR operator, no nesting. Multiple params at best combine as implicit AND [INFERRED].

### 3. Search (per-resource only)

No global search endpoint.

- Contacts: `GET /php_functions/get_contacts.php?page=1&rows=50`. Accepts paging and (per docs) filter/search params; exact param names not fully documented — discovery needed [INFERRED].
- Product availability endpoints accept product identifiers / barcodes.
- Fuzzy matching: not documented [UNKNOWN].

### 4. Get related / aggregate data

- Depots (then map `DEPOT_ID`→name): `GET /php_functions/get_depots.php`.
- Totals across multiple jobs (≤50): `GET /php_functions/jobs_totals.php?jobs[]=51&jobs[]=52&jobs[]=53`. `jobs` is an array of job IDs. Array encoding (`jobs[]=` vs `jobs=51,52,53`) unverified — confirm on live instance [INFERRED].
- Margins/costings for one job: `GET /php_functions/job_margins.php?job_id=52`. Accepts `job_id` OR `project_id`.

### 5. Date-range availability query

Core for "is product X available between these dates?".
`POST /php_functions/availability_get_available.php` (Content-Type: application/json):
`{"depot":1,"rows":[123,124],"local":1,"tz":"Europe/London"}`
Params: `depot`, `rows` (array of product IDs / picklist rows), `local`, `tz`. Exact date params not fully documented — `availability_list.php` exposes `date`+`date_range` for a window; confirm date-scoping on live instance [INFERRED].

- Products availability list: `GET /php_functions/availability_list.php?head=0&cats=&date=2026-06-10&date_range=5&depots=1`. Params: `head`, `cats`, `date`, `date_range`, `depots`.
- Jobs using a product within a year: `GET /php_functions/availability_jobs_list.php?product=123`. Param name `product` inferred — confirm on live [INFERRED].

## Pagination

Page-number: `page` (1-based) + `rows` (page size). Default size varies per endpoint (not uniformly documented). Max varies: `rows` commonly 20–500; `jobs_totals.php` caps at 50 jobs. Total-count field may exist but is not consistently documented — needs discovery [INFERRED].

| Parameter | Type    | Description                          |
| --------- | ------- | ------------------------------------ |
| page      | integer | 1-based page number                  |
| rows      | integer | Page size (endpoint-specific limits) |

**Loop:** `?page=1&rows=50` → `?page=2&rows=50` → … Last page when returned array length < requested `rows` (no explicit "last page"/total flag documented) [INFERRED].

## Worked Examples

### Example 1: Read a job and resolve its depot name

`GET /api/job_data.php?job=52` →
`{"ID":52,"JOB_NAME":"Summer Festival Main Stage","STATUS":2,"DEPOT_ID":1,"OUT_DATE":"2026-06-10 08:00:00","RETURN_DATE":"2026-06-15 17:00:00","LOCKED":0}`
Then `GET /php_functions/get_depots.php` →
`[{"ID":1,"DEPOT":"Main Depot"},{"ID":2,"DEPOT":"London Hub"}]`

- `job_data` gives `DEPOT_ID`; human name comes from `get_depots`. Cache depots (slow-changing, ~5 min TTL).
- Response is UPPER_SNAKE_CASE; request used `job` (lower).
- No line items here — separate (unverified) call.

### Example 2: Pull margins for a job

`GET /php_functions/job_margins.php?job_id=52` →
`{"REVENUE":1850.0,"COST":720.0,"MARGIN":1130.0,"MARGIN_PCT":61.08}` (shape illustrative — confirm field names on live [INFERRED structure])

- Use `job_id` (not `job`) here — param naming is inconsistent across endpoints.
- Do NOT cache financial totals (change with edits).

### Example 3: Check availability before booking

`POST /php_functions/availability_get_available.php` (Content-Type: application/json):
`{"depot":1,"rows":[123,124],"local":1,"tz":"Europe/London"}` →
`{"123":{"available":12,"shortfall":0},"124":{"available":4,"shortfall":2}}` (shape illustrative — confirm on live [INFERRED structure])

- Availability is time-sensitive — **never cache it.**
- A non-zero shortfall means the booking would over-commit stock.

## Gotchas

1. Param name for the job ID differs per endpoint: `job` (job_data, status_save), `job_id` (job_margins), `id` (job_duplicate), `jobs` (jobs_totals). No consistent ID param.
2. Contacts endpoint is `get_contacts.php`, not `list_contacts.php`. Trust the vendor names.
3. `job_data` excludes line items — a job read does NOT give the supplying list.
4. No "modified since" filter anywhere — change detection is coarse; rely on webhooks for status, poll on demand otherwise [INFERRED].
5. `X-RateLimit-Available` is a Unix timestamp (when the next request is allowed), not a remaining count. Pace reads with it.
6. Array params (`jobs`, `rows`) encoding unverified — try `name[]=` form first; confirm on live [INFERRED].
