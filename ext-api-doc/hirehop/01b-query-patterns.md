---
api_name: 'HireHop'
api_slug: 'hirehop'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# HireHop -- Query Patterns Reference

> Companion to `01-llm-api-rules.md`. All read patterns: filtering, search, sorting,
> pagination, and bulk reads.
>
> **Confidence: MEDIUM-LOW for query specifics.** HireHop has **no uniform filter grammar** —
> each `.php` endpoint defines its own named params. Tags: `[DOCUMENTED]`, `[INFERRED]`, `[UNKNOWN]`.

---

## Query Capabilities Summary

| Capability                 | Supported        | Syntax                               | Notes                                                                |
| -------------------------- | ---------------- | ------------------------------------ | -------------------------------------------------------------------- |
| Filter by field value      | Partial          | endpoint-specific params             | No uniform `?filter[x]=`; each endpoint defines its own [DOCUMENTED] |
| Filter by date range       | Yes (some)       | `date` + `date_range` (availability) | e.g. `availability_list.php` [DOCUMENTED]                            |
| Full-text search           | Partial          | search params on `get_contacts.php`  | Not uniform [INFERRED]                                               |
| Sort by field              | Partial          | endpoint-specific                    | Not consistently documented [INFERRED]                               |
| Field selection            | No               | —                                    | Not supported [INFERRED]                                             |
| Include related records    | No               | —                                    | Jobs don't embed line items; separate calls needed [DOCUMENTED]      |
| Aggregation / count        | Yes (some)       | `jobs_totals.php`, `job_margins.php` | Computed totals/margins [DOCUMENTED]                                 |
| Logical operators (AND/OR) | No               | —                                    | Implicit AND of params at best [INFERRED]                            |
| Comparison operators       | No               | —                                    | Only explicit date-range params [INFERRED]                           |
| Null checks                | No               | —                                    | Not supported [INFERRED]                                             |
| Raw SQL                    | Yes (deprecated) | `/api/sql_execute.php`               | **Do NOT use** — deprecated, unsafe [DOCUMENTED]                     |

---

## Common Patterns

### Pattern 1: Get a single job by ID

> Retrieve a job's metadata. Token shown in header form (preferred).

```http
GET /api/job_data.php?job=52 HTTP/1.1
Host: myhirehop.com
X-TOKEN: dqwejk5...=-7hmn
```

`/php_functions/job_refresh.php?job=52` is an equivalent UI alias. **Both return metadata ONLY — no line items.** [DOCUMENTED]

---

### Pattern 2: List & Filter (no uniform grammar)

> Each endpoint defines its own params. The general access pattern is:

```http
GET /php_functions/{action}.php?{param}={value}&{param2}={value2} HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
```

- There is **no** `?filter[...]` syntax, no OR operator, no nesting.
- Multiple params at best combine as implicit AND. [INFERRED]

---

### Pattern 3: Search (per-resource only)

> No global search endpoint. [DOCUMENTED]

**Contacts:**

```http
GET /php_functions/get_contacts.php?page=1&rows=50 HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
```

- `get_contacts.php` accepts paging and (per docs) filter/search params; exact param names are **not fully documented — discovery needed.** [DOCUMENTED / INFERRED]
- Product availability endpoints accept product identifiers / barcodes. [DOCUMENTED]
- Fuzzy matching: not documented. [UNKNOWN]

---

### Pattern 4: Get related / aggregate data

**Depots (then map `DEPOT_ID` → name):**

```http
GET /php_functions/get_depots.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
```

**Totals across multiple jobs (≤50):**

```http
GET /php_functions/jobs_totals.php?jobs[]=51&jobs[]=52&jobs[]=53 HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
```

`jobs` is an array of job IDs. **Exact array encoding (`jobs[]=` vs `jobs=51,52,53`) is unverified — confirm on the live instance.** [INFERRED]

**Margins / costings for one job:**

```http
GET /php_functions/job_margins.php?job_id=52 HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
```

Accepts `job_id` OR `project_id`. [DOCUMENTED]

---

### Pattern 5: Date-range availability query

> Core for "is product X available between these dates?".

```http
POST /php_functions/availability_get_available.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
Content-Type: application/json

{ "depot": 1, "rows": [123, 124], "local": 1, "tz": "Europe/London" }
```

- Params per docs: `depot`, `rows` (array of product IDs / picklist rows), `local`, `tz`. [DOCUMENTED]
- The exact date params for this endpoint are **not fully documented** — `availability_list.php` exposes `date` + `date_range` for a window; confirm the date-scoping mechanism on the live instance. [INFERRED]

**Products availability list:**

```http
GET /php_functions/availability_list.php?head=0&cats=&date=2026-06-10&date_range=5&depots=1 HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
```

Params: `head`, `cats`, `date`, `date_range`, `depots`. [DOCUMENTED]

**Jobs using a product within a year:**

```http
GET /php_functions/availability_jobs_list.php?product=123 HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
```

Param name `product` is **inferred** — confirm on live instance. [INFERRED]

---

## Pagination Handling

### Model

- **Type:** page-number — `page` (1-based) + `rows` (page size). [DOCUMENTED]
- **Default page size:** varies per endpoint; not uniformly documented.
- **Max page size:** varies per endpoint. `rows` limits commonly 20–500; `jobs_totals.php` caps at 50 jobs. [DOCUMENTED]
- **Total count available:** not consistently documented — a `rows`/total field may exist in list responses; **needs discovery.** [INFERRED]

### Request Parameters

| Parameter | Type    | Description                          |
| --------- | ------- | ------------------------------------ |
| page      | integer | 1-based page number                  |
| rows      | integer | Page size (endpoint-specific limits) |

### Full Pagination Loop

```
Page 1: GET /php_functions/get_contacts.php?page=1&rows=50
Page 2: GET /php_functions/get_contacts.php?page=2&rows=50
...
Last:   returned rows < requested rows  (no explicit "last page" flag documented)
```

### Last-Page Detection

When the returned array length < requested `rows`, you have reached the last page. An explicit total/has-more field is not documented — **needs discovery.** [INFERRED]

---

## Worked Examples

### Example 1: Read a job and resolve its depot name

> Get job 52, then look up the depot name from `DEPOT_ID`.

```http
GET /api/job_data.php?job=52 HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
```

```json
{
  "ID": 52,
  "JOB_NAME": "Summer Festival Main Stage",
  "STATUS": 2,
  "DEPOT_ID": 1,
  "OUT_DATE": "2026-06-10 08:00:00",
  "RETURN_DATE": "2026-06-15 17:00:00",
  "LOCKED": 0
}
```

Then:

```http
GET /php_functions/get_depots.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
```

```json
[
  { "ID": 1, "DEPOT": "Main Depot" },
  { "ID": 2, "DEPOT": "London Hub" }
]
```

**Key points:**

- `job_data` gives `DEPOT_ID` but the human name comes from `get_depots`. Cache depots (slow-changing, ~5 min TTL).
- Response is UPPER_SNAKE_CASE; the request used `job` (lower).
- No line items here — that is a separate (unverified) call.

---

### Example 2: Pull margins for a job

> Get costings / profit for job 52.

```http
GET /php_functions/job_margins.php?job_id=52 HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
```

```json
{ "REVENUE": 1850.0, "COST": 720.0, "MARGIN": 1130.0, "MARGIN_PCT": 61.08 }
```

> Response shape illustrative — confirm field names on the live instance. [INFERRED structure]

**Key points:**

- Use `job_id` (not `job`) here — param naming is inconsistent across endpoints.
- Do NOT cache financial totals (they change with edits).

---

### Example 3: Check availability before booking

> Confirm products 123 and 124 are available at depot 1 for the hire window.

```http
POST /php_functions/availability_get_available.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
Content-Type: application/json

{ "depot": 1, "rows": [123, 124], "local": 1, "tz": "Europe/London" }
```

```json
{
  "123": { "available": 12, "shortfall": 0 },
  "124": { "available": 4, "shortfall": 2 }
}
```

> Response shape illustrative — confirm on live instance. [INFERRED structure]

**Key points:**

- Availability is time-sensitive — **never cache it.**
- A non-zero shortfall means the booking would over-commit stock.

---

## Gotchas & Counter-Exceptions

1. **Param names differ per endpoint:** `job` (job_data, status_save), `job_id` (job_margins), `id` (job_duplicate), `jobs` (jobs_totals). There is no consistent ID param name. Read the per-endpoint params in `01-llm-api-rules.md`. [DOCUMENTED]
2. **Contacts endpoint is `get_contacts.php`,** not `list_contacts.php`. Several earlier-inferred names were wrong; trust the vendor names. [DOCUMENTED]
3. **`job_data` excludes line items.** Do not assume a job read gives you the supplying list — it does not. [DOCUMENTED]
4. **No "modified since" filter anywhere.** Change detection is coarse — rely on webhooks for status, poll on demand otherwise. [INFERRED]
5. **`X-RateLimit-Available` is a Unix timestamp** (when the next request is allowed), not a remaining count. Pace reads with it. [DOCUMENTED]
6. **Array params (e.g. `jobs`, `rows`) encoding is unverified** — try `name[]=` form first; confirm on the live instance. [INFERRED]

---

_Generated from the investigation questionnaire (Phases 5-6) + official HireHop docs. NOT live-tested._
