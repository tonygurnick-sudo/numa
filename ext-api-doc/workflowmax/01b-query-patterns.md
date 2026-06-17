---
api_name: WorkflowMax (by Xero)
api_slug: workflowmax
doc: query patterns reference (companion to 01-llm-api-rules.md)
call_surface: HTTP via `numa integrations request`; proxy injects token + account_id
key_constraint: NOT a query language — a small set of list/current/get endpoints + a few resource-specific params. Fetch summaries, page through, do most filtering/sorting CLIENT-SIDE.
field_casing: PascalCase; response field names [INFERRED] until confirmed live
confidence: [INFERRED] unless tagged [DOCUMENTED]
---

# WorkflowMax — Query Patterns Reference

## Query Capabilities

| Capability                 | Supported       | Syntax                              | Notes                                       |
| -------------------------- | --------------- | ----------------------------------- | ------------------------------------------- |
| Filter by field value      | Limited         | resource-specific params            | no general query language                   |
| Filter by date range       | **Yes**         | `from`/`to` (`YYYYMMDD`)            | on list endpoints [DOCUMENTED]              |
| Active-only                | **Yes**         | dedicated `/{resource}.api/current` | use instead of a status filter [DOCUMENTED] |
| Full-text search           | No / [UNKNOWN]  | —                                   | no general search endpoint found            |
| Sort by field / direction  | [UNKNOWN]       | —                                   | sort client-side                            |
| Field selection            | Partial         | `detailed=true/false`               | coarse summary-vs-detail toggle only        |
| Include related records    | Partial         | `detailed=true`                     | detail mode embeds Tasks/Costs              |
| Aggregation / count        | [UNKNOWN]       | —                                   | possibly a `totalrecords` count on lists    |
| Logical operators (AND/OR) | No              | —                                   | each param narrows (implicit AND)           |
| Comparison operators       | date range only | `from`/`to`                         | no `gt`/`lt` on arbitrary fields            |
| Null checks / regex        | No              | —                                   | —                                           |

## Common Patterns

**1. List & filter** — `GET /job.api/list?from=20260101&to=20261231&page=1&pagesize=100`. Multiple params narrow with implicit AND only (no OR, no nesting). `from`/`to` are compact `YYYYMMDD` (NOT `YYYY-MM-DD`), filtering on created/modified date. [DOCUMENTED via Node SDK]

**2. Active-only (instead of a status filter)** — `GET /job.api/current?detailed=true`. Also `/invoice.api/current`, `/lead.api/current`. Anything else → fetch and filter client-side.

**3. Get by UUID** — legacy query param `GET /job.api/get?uuid=e3b0c442-...&detailed=true`; modern path segment `GET /job/e3b0c442-...`. Pass the `UUID`, never the human `ID`.

**4. Get related records** — children come back inside the parent when `detailed=true`; there is no generic `/job/{id}/tasks` sub-resource on the legacy tier. `GET /job.api/get?uuid={job_uuid}&detailed=true` → embeds `Tasks[]` + `Costs[]`. For a job's time entries: `GET /time.api/list?from=...&to=...` then filter client-side where `time.Job == "J000123"` (or `JobUUID == "{uuid}"`).

**5. Date range** — `GET /time.api/list?from=20260525&to=20260531`. Filter format `YYYYMMDD`. Common date-filterable lists: `job.api/list`, `time.api/list`, `lead.api/list`, `invoice.api/list` (confirm each live).

**6. Count / aggregation** — no dedicated count endpoint. `GET /job.api/list?page=1&pagesize=1` → if a `totalrecords` attribute is present, that's the count without pulling all rows; otherwise count returned items or paginate to the end.

## Pagination

Page-number (`page` 1-based, default 1 + `pagesize`, default = server commonly 100; max [UNKNOWN]). Total likely via a `totalrecords`/count attribute (legacy XML exposes it).

Response shape (JSON, [INFERRED]; exact keys UNCONFIRMED — read off first live response): `{"Status":"OK","Jobs":[{"ID":"J000123","UUID":"e3b0c442-...","Name":"Website Redesign"}],"PageInfo":{"Page":1,"PageSize":100,"TotalRecords":237}}`. Legacy XML carries `page`/`pagesize`/`totalrecords` as attributes on the collection element (`<Jobs page="1" pagesize="100" totalrecords="237">`).

Last-page detection: stop when the returned collection has **fewer than `pagesize`** items, OR `page*pagesize >= TotalRecords`. Loop: `page=1` (100) → `page=2` (100) → `page=3` (37, <pagesize, stop).

## Query Library (natural language → call)

**Jobs**

- "currently active jobs" → `GET /job.api/current?detailed=false&page=1&pagesize=100`
- "all jobs created/modified this year" → `GET /job.api/list?from=20260101&to=20261231&page=1&pagesize=100`
- "job J000123 with tasks and costs" → `GET /job.api/get?uuid={job_uuid}&detailed=true`
- "which jobs are overdue?" — no server filter. `GET /job.api/current?detailed=false` then client-side keep where `DueDate < today` and `State in {Planned, In Progress}` (not Completed/Invoiced/Cancelled).

**Clients & contacts**

- "all clients" → `GET /client.api/list?page=1&pagesize=100`
- "one client" → `GET /client.api/get?uuid={client_uuid}`
- "find a client by name" — no search endpoint. Page the client list and match `Name` client-side (case-insensitive contains).

**Time**

- "this week's time entries" → `GET /time.api/list?from=20260525&to=20260531`
- "hours Jane logged on J000123 in May?" → `GET /time.api/list?from=20260501&to=20260531` then client-side filter `Staff=={jane_uuid}` and `Job=="J000123"`; sum `Minutes`/60.

**Invoices**

- "outstanding/current invoices" → `GET /invoice.api/current?page=1&pagesize=100`
- "invoices for the year" → `GET /invoice.api/list?from=20260101&to=20261231&page=1&pagesize=100`

**Staff / reference**

- "list staff" (connectivity check) → `GET /staff.api/list`
- "list categories" (cacheable) → `GET /categories.api/list`

**Leads**

- "current leads" → `GET /lead.api/current`
- "leads in a date range" → `GET /lead.api/list?from=20260101&to=20260531`

## Worked Examples (end-to-end)

**1. Full job export for reporting** — `GET /job.api/list?page=1&pagesize=100`, repeat `page=2,3,...` until a page returns <100. Use `detailed=false` for the export; fetch detail per-UUID only for jobs you drill into. Track `WhenModified` per job so a later run can do incremental work via a `from` date.

**2. WIP / outstanding-invoices snapshot** — no single "WIP report" endpoint; assemble it: (1) `GET /job.api/current?detailed=false` (work in progress); (2) `GET /invoice.api/current` (outstanding); (3) client-side cross-reference invoices to jobs/clients, sum `Amount - AmountPaid`. `Amount`/`AmountPaid` are computed server-side — trust them, don't recompute from lines unless asked.

**3. Staff timesheet for a date range** — (1) `GET /staff.api/list` to resolve names → UUIDs (cache); (2) `GET /time.api/list?from=20260525&to=20260531`; (3) client-side group by `Staff`, sum `Minutes`, join names from step 1. `Billable` splits billable vs non-billable hours. Time entries reference staff/job by id, not name.

## Gotchas

1. **`from`/`to` use `YYYYMMDD`, not ISO.** `from=2026-01-01` is rejected/ignored; use `from=20260101`. [DOCUMENTED]
2. **Most "filters" are client-side.** Only date range + `current` are server-side. Find-by-name, overdue, over-$X, and all sorting happen after fetching. Page through fully before claiming a result is complete.
3. **`detailed=false` omits child collections.** Missing tasks/costs/lines → you forgot `detailed=true` (or are looking at a list, which never embeds them). Re-fetch the single record with detail.
4. **200 ≠ success.** A `Status:"Error"` body can come back with HTTP 200 — check `Status` first (see 01d).
5. **No cursor — duplicates/skips possible mid-write.** Page-number paging over a changing dataset can skip/repeat rows. For exports, prefer a quiet period or de-dupe on `UUID`.
