---
api_name: 'PMO365'
api_slug: 'pmo365'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# PMO365 -- Query Patterns Reference

> Read operations against Microsoft Dataverse Web API (OData v4): `$select`, `$filter`,
> `$orderby`, `$top`, `$expand`, `$count`, `$apply`, lookup expansion, formatted-value
> annotations, and server-driven pagination via `@odata.nextLink`.
> Companion to `01-llm-api-rules.md`.

> **Discovery first.** PMO365 has no public API — its tables are custom Dataverse tables
> bundled in a solution under a publisher prefix (illustrated here as `pmo_`, **[INFERRED] —
> confirm at runtime**). You do NOT know the real `EntitySetName`, `LogicalName`, or column
> names until you run the discovery queries (see 01a / 01-llm-api-rules.md). Every query in
> this file uses **illustrative** names like `pmo_projects` / `pmo_project` — treat them as
> placeholders you resolve before querying, never as confirmed facts.

---

## Query Capabilities Summary

| Capability                 | Supported    | Syntax / Where                                     | Notes                                                                       |
| -------------------------- | ------------ | -------------------------------------------------- | --------------------------------------------------------------------------- |
| Filter by field value      | yes          | `?$filter=pmo_status eq 'Active'`                  | Column comparisons must be in the same table                                |
| Filter by date range       | yes          | `?$filter=modifiedon ge 2026-05-01T00:00:00Z`      | Dates ISO-8601 UTC; no quotes around datetimes                              |
| Full-text search           | no (here)    | use `$filter=contains(field,'x')`                  | `$search` is a SEPARATE Dataverse search API — NOT the Web API query option |
| Sort by field              | yes          | `?$orderby=pmo_name`                               | Option names are case-sensitive                                             |
| Sort direction             | yes          | `?$orderby=modifiedon desc`                        | `asc` (default) / `desc`; multi-field comma-separated                       |
| Field selection            | yes (always) | `?$select=pmo_name,statuscode`                     | Omit ⇒ all columns; always set it to keep payloads small                    |
| Include related records    | yes          | `?$expand=pmo_OwnerId($select=...)` / nav property | Expand the navigation property, not the `_..._value` column                 |
| Aggregation / count        | yes          | `?$count=true` ; `?$apply=aggregate(...)`          | `$apply` capped at 50,000 evaluated rows                                    |
| Logical operators (AND/OR) | yes          | `and`, `or`, `not`, grouped with `( )`             | Standard OData precedence; parenthesise to be safe                          |
| Comparison operators       | yes          | `eq ne gt ge lt le`                                | Plus `contains` / `startswith` / `endswith` functions                       |
| Null checks                | yes          | `?$filter=_pmo_owner_value eq null`                | Use `eq null` / `ne null`                                                   |
| Regex / pattern            | no           | only `contains` / `startswith` / `endswith`        | No regex; substring functions only                                          |

---

## Common Patterns

### Pattern 1: List & Filter

Send a `GET` to the table's **EntitySet** (plural collection name from discovery). Always
`$select` to control payload size; filter server-side with `$filter`.

**Base list (always set page size with the Prefer header):**

```http
GET /api/data/v9.2/pmo_projects?$select=pmo_name,pmo_status,modifiedon&$orderby=modifiedon desc
OData-MaxVersion: 4.0
OData-Version: 4.0
Accept: application/json
Prefer: odata.maxpagesize=200
```

**Filter operators (in `$filter`):**

```
eq  ne  gt  ge  lt  le        comparison
and  or  not                  logical (group with parentheses)
contains(field,'x')           substring match
startswith(field,'x')         prefix match
endswith(field,'x')           suffix match
field eq null / field ne null null checks
```

**Combining filters:**

```http
GET /api/data/v9.2/pmo_projects?$select=pmo_name,pmo_status&$filter=(pmo_status eq 'Active' or pmo_status eq 'AtRisk') and modifiedon ge 2026-01-01T00:00:00Z
```

- Conditions are joined with explicit `and` / `or` keywords.
- Parenthesise mixed `and`/`or` — OData precedence is real but readers (and the agent) shouldn't have to reason about it.
- Cross-table column comparisons are **not** supported in `$filter`; both sides must be columns of the same table.

---

### Pattern 2: Search

There is **no `$search`** on the Web API query path — `$search` belongs to Dataverse's
separate relevance-search API, which this connector does not surface. For text matching, use
`$filter` substring functions.

**Substring (the practical "search"):**

```http
GET /api/data/v9.2/pmo_projects?$select=pmo_name,pmo_status&$filter=contains(pmo_name,'Aurora')
```

**Prefix match (cheaper than `contains`, index-friendly):**

```http
GET /api/data/v9.2/pmo_risks?$select=pmo_title,pmo_severity&$filter=startswith(pmo_title,'SEC-')
```

- **Case sensitivity:** Dataverse string filters are generally case-insensitive, but don't rely on it for picklist/choice values — those are **integers**, not strings (filter on the integer option value, not the label).
- **Fuzzy matching:** none. `contains` / `startswith` / `endswith` are your only fuzzy-ish tools.
- **Minimum query length:** none enforced, but `contains` on a large table is a table scan — prefer `startswith` or a more selective `$filter`.

---

### Pattern 3: Get by ID

Dataverse rows are keyed by a GUID (the table's `PrimaryIdAttribute`, e.g.
`pmo_projectid`). Address a single row with the GUID in parentheses.

```http
GET /api/data/v9.2/pmo_projects(3a5e9c10-7b21-ee11-8179-000d3a9933c9)
```

**Select columns on a single row:**

```http
GET /api/data/v9.2/pmo_projects(3a5e9c10-7b21-ee11-8179-000d3a9933c9)?$select=pmo_name,pmo_status,pmo_startdate
```

A single-row GET returns the entity object directly (not wrapped in a `value` array) —
unlike collection queries.

---

### Pattern 4: Get Related Records (lookup expansion)

A lookup column is exposed two ways on the parent row:

- `_{navname}_value` — the raw GUID of the related row (good for `$filter`).
- `{navname}` — the **navigation property** you `$expand` to pull the related row inline.

**Expand a single-valued lookup (parent → related row):**

```http
GET /api/data/v9.2/pmo_projects(3a5e9c10-7b21-ee11-8179-000d3a9933c9)?$select=pmo_name&$expand=pmo_ProgramId($select=pmo_name)
```

**Expand a collection-valued relationship (parent → child rows):**

```http
GET /api/data/v9.2/pmo_projects(3a5e9c10-7b21-ee11-8179-000d3a9933c9)?$select=pmo_name&$expand=pmo_project_pmo_risks($select=pmo_title,pmo_severity;$top=50)
```

**Filter by parent without expanding (cheaper) — filter the `_..._value` GUID column:**

```http
GET /api/data/v9.2/pmo_risks?$select=pmo_title,pmo_severity&$filter=_pmo_projectid_value eq 3a5e9c10-7b21-ee11-8179-000d3a9933c9
```

- `$expand` only joins along relationships defined in the data model — there is no arbitrary join.
- **Nested `$expand` is not allowed across N:N relationships.**
- To get readable labels for lookups and choices, add `Prefer: odata.include-annotations="*"` (or scope to `OData.Community.Display.V1.FormattedValue`). See Pattern 6 for the annotation shape.

---

### Pattern 5: Date Range Query

```http
GET /api/data/v9.2/pmo_projects?$select=pmo_name,modifiedon&$filter=modifiedon ge 2026-05-01T00:00:00Z and modifiedon lt 2026-06-01T00:00:00Z&$orderby=modifiedon desc
```

**Date format:** ISO-8601 UTC, e.g. `2026-05-29T13:00:00Z`. DateTime literals are **not**
quoted in `$filter` (unlike string values). Use a half-open range (`ge … lt …`) to avoid
boundary double-counting.

**Common date fields:** `createdon`, `modifiedon` (every Dataverse table), plus
solution-specific dates like `pmo_startdate` / `pmo_enddate` (**[INFERRED] — confirm via
`$metadata` / `EntityDefinitions`**).

---

### Pattern 6: Aggregation / Count

**Inline count of matching rows** (`@odata.count` returned alongside the page):

```http
GET /api/data/v9.2/pmo_projects?$select=pmo_name&$filter=pmo_status eq 'Active'&$count=true
```

```json
{
  "@odata.context": "{environment_url}/api/data/v9.2/$metadata#pmo_projects(pmo_name)",
  "@odata.count": 42,
  "value": [{ "pmo_name": "Aurora Rollout", "pmo_projectid": "3a5e9c10-…" }]
}
```

**Group-by + aggregate via `$apply`** (count projects per status):

```http
GET /api/data/v9.2/pmo_projects?$apply=groupby((statuscode),aggregate($count as count))
OData-MaxVersion: 4.0
OData-Version: 4.0
Accept: application/json
Prefer: odata.include-annotations="OData.Community.Display.V1.FormattedValue"
```

```json
{
  "@odata.context": "{environment_url}/api/data/v9.2/$metadata#pmo_projects",
  "value": [
    { "statuscode@OData.Community.Display.V1.FormattedValue": "Active", "statuscode": 1, "count": 8 },
    { "statuscode@OData.Community.Display.V1.FormattedValue": "On Hold", "statuscode": 2, "count": 3 }
  ]
}
```

**Sum / average / min / max** use the `... with <op> as <alias>` form:

```http
GET /api/data/v9.2/pmo_projects?$apply=groupby((statuscode),aggregate(pmo_budget with sum as totalbudget))
GET /api/data/v9.2/pmo_projects?$apply=aggregate(modifiedon with max as lastChange)
```

`$apply` supports `sum`, `average`, `min`, `max`, `countdistinct`, and `$count`. **Hard
limits:** an aggregate query evaluates at most **50,000 rows** (else error `0x8004E023`
"AggregateQueryRecordLimit exceeded"), `groupby` on datetime values is unsupported, and you
cannot `$orderby` an aggregate alias. Filter first (`$apply=filter(...)/groupby(...)`) to stay
under the limit.

---

## Pagination Handling

### Model

- **Type:** **server-driven** via `@odata.nextLink` (an opaque `$skiptoken` cursor). NOT offset/page-number.
- **Default page size:** up to **5,000** rows if you don't ask for fewer.
- **Max page size:** **5,000** (`Prefer: odata.maxpagesize=N`; values >5000 are silently clamped to 5000).
- **Total count available:** partial. `?$count=true` ⇒ `@odata.count` on the page, but it is **capped at 5,000** for standard tables (500 for elastic) regardless of page size — beyond that it is NOT the true total. To detect truncation, request the `Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded` annotation (paired with `totalrecordcount`); for an exact uncapped total use the `RetrieveTotalRecordCount` function or the `/$count` path segment.

### Request Parameters / Headers

| Parameter / Header                  | Type   | Default | Description                                                                                                   |
| ----------------------------------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------- |
| `Prefer: odata.maxpagesize=N`       | header | 5000    | Rows per page. Set explicitly (e.g. 200) to bound payloads. **Reuse the SAME value on every page request.**   |
| `$top=N`                            | query  | —       | Caps **total** rows. **Do NOT combine with paging** — if `odata.maxpagesize` is set, `$top` is ignored.       |
| `$count=true`                       | query  | false   | Adds `@odata.count` (total matches) to the page.                                                              |
| `$orderby=...`                      | query  | PK      | **Order on a unique column** (the PK GUID) for stable paging — non-unique orders can repeat/skip rows.        |
| `$skiptoken` (in `@odata.nextLink`) | query  | —       | Server-issued opaque cursor. **Never construct, modify, or re-encode it** — follow the nextLink URL verbatim. |

### Response Structure

```json
{
  "@odata.context": "{environment_url}/api/data/v9.2/$metadata#pmo_projects(pmo_name)",
  "value": [
    { "@odata.etag": "W/\"112430907\"", "pmo_name": "Aurora Rollout", "pmo_projectid": "3a5e9c10-…" },
    { "@odata.etag": "W/\"112430952\"", "pmo_name": "Borealis Migration", "pmo_projectid": "5c1f7a44-…" }
  ],
  "@odata.nextLink": "{environment_url}/api/data/v9.2/pmo_projects?$select=pmo_name&$skiptoken=%3Ccookie%20pagenumber=%222%22%20…%3E"
}
```

### Last Page Detection

When `@odata.nextLink` is **absent** from the response, you've reached the last page. Its
presence means "more rows exist — follow it." There is no `more_records` boolean and no
"page N of M".

### Full Pagination Loop

```
Request 1: GET /api/data/v9.2/pmo_projects?$select=pmo_name&$orderby=pmo_projectid
           Prefer: odata.maxpagesize=200
Response 1: { "value": [ …200 rows… ], "@odata.nextLink": "{environment_url}/…?$skiptoken=…%222%22…" }

Request 2: GET {the @odata.nextLink URL, verbatim}
           Prefer: odata.maxpagesize=200          ← same page size as request 1
Response 2: { "value": [ …200 rows… ], "@odata.nextLink": "{environment_url}/…?$skiptoken=…%223%22…" }

…

Last Page: GET {the previous @odata.nextLink URL, verbatim}
           Prefer: odata.maxpagesize=200
Response:  { "value": [ …fewer than 200 rows… ] }
           ← NO @odata.nextLink ⇒ done
```

**Rules:** (1) Do NOT hand-roll `$skip` — Dataverse does not support it. (2) Do NOT append or
edit query options on the `@odata.nextLink` URL; pass it through `connect_request` unchanged
except for re-expansion against `{environment_url}`. (3) Keep the same `odata.maxpagesize` on
every page. (4) Paging is forward-only and dynamic — re-fetching an earlier page can return a
different row set if data changed.

---

## Worked Examples

### Example 1: Active projects modified this month, newest first, with readable status

> List the open project portfolio, fetch only the columns we need, and ask Dataverse for the
> human-readable choice/lookup labels.

```http
GET /api/data/v9.2/pmo_projects?$select=pmo_name,statuscode,_pmo_programid_value,modifiedon&$filter=statuscode eq 1 and modifiedon ge 2026-05-01T00:00:00Z&$orderby=modifiedon desc
OData-MaxVersion: 4.0
OData-Version: 4.0
Accept: application/json
Prefer: odata.maxpagesize=100, odata.include-annotations="OData.Community.Display.V1.FormattedValue"
```

```json
{
  "@odata.context": "{environment_url}/api/data/v9.2/$metadata#pmo_projects(pmo_name,statuscode,_pmo_programid_value,modifiedon)",
  "value": [
    {
      "@odata.etag": "W/\"112430907\"",
      "pmo_name": "Aurora Rollout",
      "statuscode@OData.Community.Display.V1.FormattedValue": "Active",
      "statuscode": 1,
      "_pmo_programid_value@OData.Community.Display.V1.FormattedValue": "Digital Transformation",
      "_pmo_programid_value@Microsoft.Dynamics.CRM.lookuplogicalname": "pmo_program",
      "_pmo_programid_value": "b71f2a90-3c44-ee11-be37-000d3a1b1f2c",
      "modifiedon@OData.Community.Display.V1.FormattedValue": "5/28/2026 2:14 PM",
      "modifiedon": "2026-05-28T02:14:11Z",
      "pmo_projectid": "3a5e9c10-7b21-ee11-8179-000d3a9933c9"
    }
  ]
}
```

**Key points:**

- `statuscode` is an **integer** choice value (`1`); the readable label arrives in the sibling `…@OData.Community.Display.V1.FormattedValue` property only because of the `Prefer` annotation header.
- Filter on the lookup's `_pmo_programid_value` GUID column, not on the nav property.
- `_pmo_programid_value@Microsoft.Dynamics.CRM.lookuplogicalname` tells you the target table (`pmo_program`) — useful when you need to follow the lookup.
- Two `Prefer` values are comma-joined in one header: page size + annotations.

### Example 2: One project with its program and its child risks (expand)

> Fetch a single project, inline its parent program's name, and pull up to 50 of its risks —
> one round-trip instead of three.

```http
GET /api/data/v9.2/pmo_projects(3a5e9c10-7b21-ee11-8179-000d3a9933c9)?$select=pmo_name,pmo_status&$expand=pmo_ProgramId($select=pmo_name),pmo_project_pmo_risks($select=pmo_title,pmo_severity;$top=50;$orderby=pmo_severity desc)
OData-MaxVersion: 4.0
OData-Version: 4.0
Accept: application/json
```

```json
{
  "@odata.context": "{environment_url}/api/data/v9.2/$metadata#pmo_projects(pmo_name,pmo_status,pmo_ProgramId(pmo_name),pmo_project_pmo_risks(pmo_title,pmo_severity))/$entity",
  "@odata.etag": "W/\"112430907\"",
  "pmo_name": "Aurora Rollout",
  "pmo_status": "Active",
  "pmo_projectid": "3a5e9c10-7b21-ee11-8179-000d3a9933c9",
  "pmo_ProgramId": {
    "pmo_name": "Digital Transformation",
    "pmo_programid": "b71f2a90-3c44-ee11-be37-000d3a1b1f2c"
  },
  "pmo_project_pmo_risks": [
    { "pmo_title": "Vendor contract slip", "pmo_severity": 3, "pmo_riskid": "9d2c4e71-aa55-ee11-…" },
    { "pmo_title": "Resource shortfall Q3", "pmo_severity": 2, "pmo_riskid": "1f8b3a02-bb66-ee11-…" }
  ]
}
```

**Key points:**

- Single-valued lookup expands to an **object** (`pmo_ProgramId`); collection-valued relationship expands to an **array** (`pmo_project_pmo_risks`).
- Inside `$expand` you can nest `$select`, `$top`, and `$orderby` (separated by `;`) — but you cannot nest a further `$expand` across an N:N relationship.
- The relationship/navigation names (`pmo_ProgramId`, `pmo_project_pmo_risks`) come from `$metadata` — **[INFERRED] placeholders; resolve the real names before querying.**

### Example 3: Total budget per status across the portfolio (groupby aggregate)

> A portfolio rollup: sum of project budget grouped by status, with readable status labels.

```http
GET /api/data/v9.2/pmo_projects?$apply=filter(statecode eq 0)/groupby((statuscode),aggregate(pmo_budget with sum as totalbudget))
OData-MaxVersion: 4.0
OData-Version: 4.0
Accept: application/json
Prefer: odata.include-annotations="OData.Community.Display.V1.FormattedValue"
```

```json
{
  "@odata.context": "{environment_url}/api/data/v9.2/$metadata#pmo_projects",
  "value": [
    {
      "statuscode@OData.Community.Display.V1.FormattedValue": "Active",
      "statuscode": 1,
      "totalbudget@OData.Community.Display.V1.FormattedValue": "$1,240,000.00",
      "totalbudget": 1240000.0
    },
    {
      "statuscode@OData.Community.Display.V1.FormattedValue": "On Hold",
      "statuscode": 2,
      "totalbudget@OData.Community.Display.V1.FormattedValue": "$310,000.00",
      "totalbudget": 310000.0
    }
  ]
}
```

**Key points:**

- `filter(...)/groupby(...)` chains transformations with `/` — filter first to stay under the 50,000-row aggregate ceiling.
- The numeric `totalbudget` is the value to compute with; the `@OData.Community.Display.V1.FormattedValue` sibling is the currency-formatted display string.
- You can't `$orderby=totalbudget` — sorting on an aggregate alias errors. Sort client-side after the response.

---

## Gotchas & Counter-Exceptions

1. **No `$skip`, no `$search`, no `$format`.** Dataverse drops these OData options. Page with `@odata.nextLink` (not `$skip`), and "search" with `$filter contains()` (the relevance-search `$search` is a different API this connector doesn't expose).
2. **`$top` and paging don't mix.** If `Prefer: odata.maxpagesize` is present, `$top` is ignored. Use `$top` only for a one-shot capped fetch with no paging.
3. **EntitySetName ≠ table LogicalName.** Query the **plural EntitySet** (e.g. `pmo_projects`), but `$filter`/`$select` use **column LogicalNames** (e.g. `pmo_name`). Resolve both via `EntityDefinitions` / `$metadata` first — guessing the plural form 404s.
4. **Choice/option-set columns are integers.** Filter `statuscode eq 1`, never `statuscode eq 'Active'`. Get the label via `Prefer: odata.include-annotations` and the `…@OData.Community.Display.V1.FormattedValue` sibling.
5. **`statecode`/`statuscode` are a state machine.** Valid `statuscode` values depend on the current `statecode` — don't assume a flat list of statuses.
6. **Lookups: filter the `_x_value` column, expand the nav property.** `$filter=_pmo_projectid_value eq <guid>` works; `$filter=pmo_ProjectId eq <guid>` does not. And you cannot `$select` a navigation property — `$select` the `_x_value` column instead.
7. **DateTimes are unquoted and UTC.** `modifiedon ge 2026-05-01T00:00:00Z` — no surrounding quotes (strings get quotes, datetimes don't). Always normalise to `Z`/UTC.
8. **Aggregate ceiling is 50,000 rows.** `$apply` errors with `0x8004E023` if the (pre-aggregation, post-`filter`) set exceeds 50k. Add a `filter(...)` (e.g. a date range) and stitch results client-side.
9. **Forward-only paging.** Re-requesting an earlier `@odata.nextLink` after data changed can return a different row set. For consistent paging, `$orderby` a unique column (the PK GUID), and don't rely on going backwards.
10. **Service-protection 429s.** Tight paging loops can trip the per-user, sliding 5-minute limit, which has three distinct facets: ~6,000 requests / 5 min, ~20 minutes (1,200,000 ms) of combined request-execution time / 5 min, and a concurrency cap of ~52 concurrent requests (52 = concurrent requests, NOT seconds of execution). On 429, honour the `Retry-After` header (seconds) — do not retry immediately.
11. **`@odata.nextLink` is opaque — pass it through unchanged.** The `$skiptoken` inside is server-encoded paging state. Don't decode, edit, or append query options; just re-expand it against `{environment_url}` and re-send with the same `odata.maxpagesize`.

---

_Generated from `00-api-investigation-questionnaire.md` Phases 5–6. Table/column names shown
(`pmo_\*`) are ILLUSTRATIVE [INFERRED] placeholders — PMO365's real schema is proprietary and
resolved at runtime via the discovery queries.\_
