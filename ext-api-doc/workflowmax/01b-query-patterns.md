---
api_name: 'WorkflowMax (by Xero)'
api_slug: 'workflowmax'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# WorkflowMax (by Xero) -- Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Read-operation patterns: filtering, search, sorting,
> pagination, and bulk reads. WorkflowMax is **not** a query language — it is a small set of
> `list`/`current`/`get` endpoints with a few resource-specific params. Plan accordingly:
> fetch summaries, page through, and do most filtering/sorting **client-side**.
>
> Endpoint paths shown in the legacy `{resource}.api/{action}` form the OAuth2 tier reuses.
> All calls go through the connector's `connect_request` proxy (token + `account_id` injected).
> Response field names [INFERRED] until confirmed live.

---

## Query Capabilities Summary

| Capability                 | Supported       | Syntax                              | Notes                                           |
| -------------------------- | --------------- | ----------------------------------- | ----------------------------------------------- |
| Filter by field value      | Limited         | resource-specific params            | No general query language [INFERRED]            |
| Filter by date range       | **Yes**         | `from`/`to` (`YYYYMMDD`)            | On list endpoints [DOCUMENTED]                  |
| Active-only filter         | **Yes**         | dedicated `/{resource}.api/current` | Use instead of a status filter [DOCUMENTED]     |
| Full-text search           | No / [UNKNOWN]  | —                                   | No general search endpoint found                |
| Sort by field              | [UNKNOWN]       | —                                   | Not documented → sort client-side               |
| Sort direction (asc/desc)  | [UNKNOWN]       | —                                   | —                                               |
| Field selection            | Partial         | `detailed=true/false`               | Coarse summary-vs-detail toggle only [INFERRED] |
| Include related records    | Partial         | `detailed=true`                     | Detail mode embeds tasks/costs [INFERRED]       |
| Aggregation / count        | [UNKNOWN]       | —                                   | Possibly a `totalrecords` count on lists        |
| Logical operators (AND/OR) | No              | —                                   | Each param narrows (implicit AND) [INFERRED]    |
| Comparison operators       | Date range only | `from`/`to`                         | No `gt`/`lt` on arbitrary fields [INFERRED]     |
| Null checks                | No              | —                                   | [INFERRED]                                      |
| Pattern / regex matching   | No              | —                                   | [INFERRED]                                      |

---

## Common Patterns

### Pattern 1: List & Filter

> Get a paged, optionally date-filtered list of a resource.

```http
GET /job.api/list?from=20260101&to=20261231&page=1&pagesize=100
Accept: application/json
```

- **Combining filters:** multiple params narrow with implicit **AND** only. No `OR`, no nesting. [INFERRED]
- **Dates:** `from`/`to` are **compact `YYYYMMDD`** (NOT `YYYY-MM-DD`). They filter on created/modified date. [DOCUMENTED via Node SDK]

### Pattern 2: Active-only (instead of a status filter)

> WorkflowMax exposes dedicated `current` endpoints rather than a `State=Active` filter.

```http
GET /job.api/current?detailed=true
Accept: application/json
```

Also available: `/invoice.api/current`, `/lead.api/current`. For anything else, fetch and filter client-side.

### Pattern 3: Get by ID (UUID)

```http
# Legacy: uuid as a query param
GET /job.api/get?uuid=e3b0c442-98fc-1c14-9afb-f4c8996fb1a2&detailed=true
Accept: application/json

# Modern equivalent: uuid as a path segment
GET /job/e3b0c442-98fc-1c14-9afb-f4c8996fb1a2
Accept: application/json
```

Pass the **`UUID`**, never the human `ID` (e.g. `J000123`).

### Pattern 4: Get Related Records

> Children come back **inside the parent** when `detailed=true`. There is no generic
> `/job/{id}/tasks` sub-resource path on the legacy tier.

```http
GET /job.api/get?uuid={job_uuid}&detailed=true
# → response embeds Tasks[] and Costs[]
```

To get a job's time entries, filter the time list by date and match `Job`/`JobUUID` client-side:

```http
GET /time.api/list?from=20260501&to=20260531
# → filter results where time.Job == "J000123" (or JobUUID == "{uuid}")
```

### Pattern 5: Date Range Query

```http
GET /time.api/list?from=20260525&to=20260531
Accept: application/json
```

- **Filter date format:** `YYYYMMDD` (compact). [DOCUMENTED]
- **Common date-filterable lists:** `job.api/list`, `time.api/list`, `lead.api/list`, `invoice.api/list` (confirm each live). [INFERRED]

### Pattern 6: Count / Aggregation

> No dedicated count endpoint. If the list response includes a `totalrecords`/count attribute,
> read it; otherwise count returned items or paginate to the end. [INFERRED]

```http
GET /job.api/list?page=1&pagesize=1
# → if a totalrecords attribute is present, that's the count without pulling all rows
```

---

## Pagination Handling

### Model

- **Type:** page-number (`page` + `pagesize`). [DOCUMENTED]
- **Default page size:** server default (commonly 100). **Max:** [UNKNOWN] — confirm live.
- **Total count available:** likely via a `totalrecords`/count attribute on the collection (legacy XML exposes counts). [INFERRED]

### Request Parameters

| Parameter  | Type | Default | Description        |
| ---------- | ---- | ------- | ------------------ |
| `page`     | int  | 1       | 1-based page index |
| `pagesize` | int  | server  | Records per page   |

### Response Structure (JSON, [INFERRED])

```json
{
  "Status": "OK",
  "Jobs": [{ "ID": "J000123", "UUID": "e3b0c442-...", "Name": "Website Redesign" }],
  "PageInfo": { "Page": 1, "PageSize": 100, "TotalRecords": 237 }
}
```

> The legacy XML equivalent often carries `page`/`pagesize`/`totalrecords` as **attributes** on
> the collection element (`<Jobs page="1" pagesize="100" totalrecords="237">`). The JSON shape and
> exact key names are UNCONFIRMED — read them off the first live response.

### Last Page Detection

Stop when **either**:

- the returned collection has **fewer than `pagesize`** items, **or**
- `page * pagesize >= TotalRecords` (when a total is provided).

### Full Pagination Loop

```
Request 1: GET /job.api/list?page=1&pagesize=100   → 100 items
Request 2: GET /job.api/list?page=2&pagesize=100   → 100 items
Request 3: GET /job.api/list?page=3&pagesize=100   → 37 items  ← < pagesize, stop
```

---

## Query Pattern Library (natural language → call)

### Jobs

**"List currently active jobs"**

```http
GET /job.api/current?detailed=false&page=1&pagesize=100
```

**"List all jobs created/modified this year"**

```http
GET /job.api/list?from=20260101&to=20261231&page=1&pagesize=100
```

**"Show me job J000123 with its tasks and costs"**

```http
GET /job.api/get?uuid={job_uuid}&detailed=true
```

**"Which jobs are overdue?"** — no server filter for this. Fetch active jobs, then filter client-side where `DueDate < today` and `State` is not Completed/Invoiced/Cancelled.

```http
GET /job.api/current?detailed=false
# → client-side: keep where DueDate < 2026-05-29 and State in {Planned, In Progress}
```

### Clients & Contacts

**"List all clients"**

```http
GET /client.api/list?page=1&pagesize=100
```

**"Get one client"**

```http
GET /client.api/get?uuid={client_uuid}
```

**"Find a client by name"** — no search endpoint. Page the client list and match `Name` client-side (case-insensitive contains).

### Time

**"This week's time entries"**

```http
GET /time.api/list?from=20260525&to=20260531
```

**"How many hours did Jane log on job J000123 in May?"**

```http
GET /time.api/list?from=20260501&to=20260531
# → client-side: filter where Staff == {jane_uuid} and Job == "J000123"; sum Minutes / 60
```

### Invoices

**"List outstanding / current invoices"**

```http
GET /invoice.api/current?page=1&pagesize=100
```

**"List invoices for the year"**

```http
GET /invoice.api/list?from=20260101&to=20261231&page=1&pagesize=100
```

### Staff / Reference data

**"List staff"** (connectivity check)

```http
GET /staff.api/list
```

**"List categories"** (cacheable reference data)

```http
GET /categories.api/list
```

### Leads

**"List current leads"**

```http
GET /lead.api/current
```

**"List leads in a date range"**

```http
GET /lead.api/list?from=20260101&to=20260531
```

---

## Worked Examples (end-to-end)

### Example 1: Full job export for reporting

> Pull every job (summaries) for downstream analysis.

```http
GET /job.api/list?page=1&pagesize=100
# → repeat with page=2,3,... until a page returns < 100 jobs
```

**Key points:**

- Use `detailed=false` (default) for the export; fetch detail per-UUID only for jobs you actually drill into.
- Track `WhenModified` per job so a later run can do incremental work via a `from` date.

### Example 2: WIP / outstanding-invoices snapshot

```http
# Step 1 — active jobs (work in progress)
GET /job.api/current?detailed=false

# Step 2 — outstanding invoices
GET /invoice.api/current

# Step 3 — client-side: cross-reference invoices to jobs/clients, sum Amount - AmountPaid
```

**Key points:**

- There is no single "WIP report" endpoint — assemble it from `job.api/current` + `time.api/list` + `invoice.api/current`.
- `Amount`/`AmountPaid` are computed server-side; trust them, don't recompute from lines unless asked.

### Example 3: Staff timesheet for a date range

```http
# Step 1 — staff list to resolve names → UUIDs
GET /staff.api/list

# Step 2 — time entries for the period
GET /time.api/list?from=20260525&to=20260531

# Step 3 — client-side: group by Staff, sum Minutes, join names from Step 1
```

**Key points:**

- Time entries reference staff/job by id, not by name — resolve names via the staff list once and cache.
- `Billable` lets you split billable vs non-billable hours client-side.

---

## Gotchas & Counter-Exceptions

1. **`from`/`to` use `YYYYMMDD`, not ISO dates.** `from=2026-01-01` will be rejected or ignored; use `from=20260101`. [DOCUMENTED]
2. **Most "filters" are client-side.** Only date range + `current` are server-side. "Find by name", "overdue", "over $X", and all sorting must be done after fetching. Page through fully before claiming a result is complete.
3. **`detailed=false` omits child collections.** If tasks/costs/lines are missing from a response, you forgot `detailed=true` (or are looking at a list, which never embeds them). Re-fetch the single record with detail.
4. **200 ≠ success.** A `Status: "Error"` body can come back with HTTP 200 — check `Status` before trusting the data (see 01d).
5. **No cursor — duplicates/skips possible mid-write.** Page-number pagination over a changing dataset can skip or repeat rows if records are added between pages. For exports, prefer a quiet period or de-dupe on `UUID`.

---

_Generated from the investigation questionnaire, Phases 5-6._
