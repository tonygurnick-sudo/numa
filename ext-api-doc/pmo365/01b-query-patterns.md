---
api_name: PMO365 (Microsoft Dataverse)
api_slug: pmo365
companion_to: 01-llm-api-rules.md
base_url: '{environment_url}/api/data/v9.2/'
call_surface: 'HTTP via connect_request (not file-browse)'
covers: 'OData v4 reads — $select/$filter/$orderby/$top/$expand/$count/$apply, lookup expansion, formatted-value annotations, server-driven paging via @odata.nextLink'
schema_confidence: 'All pmo_* names are ILLUSTRATIVE [INFERRED] placeholders — resolve EntitySetName/LogicalName/column names via discovery (01 / 01a) before querying. Platform query behaviour is [DOCUMENTED].'
---

# PMO365 — Query Patterns Reference

## Query Capabilities Summary

| Capability            | Supported    | Syntax / Where                                | Notes                                                                      |
| --------------------- | ------------ | --------------------------------------------- | -------------------------------------------------------------------------- |
| Filter by field value | yes          | `?$filter=pmo_status eq 'Active'`             | comparisons within the same table                                          |
| Filter by date range  | yes          | `?$filter=modifiedon ge 2026-05-01T00:00:00Z` | ISO-8601 UTC; no quotes around datetimes                                   |
| Full-text search      | no (here)    | use `$filter=contains(field,'x')`             | `$search` is a SEPARATE Dataverse search API, NOT the Web API query option |
| Sort by field         | yes          | `?$orderby=pmo_name`                          | option names case-sensitive                                                |
| Sort direction        | yes          | `?$orderby=modifiedon desc`                   | `asc` (default) / `desc`; multi-field comma-separated                      |
| Field selection       | yes (always) | `?$select=pmo_name,statuscode`                | omit ⇒ all columns; always set it                                          |
| Include related       | yes          | `?$expand=pmo_OwnerId($select=...)`           | expand the nav property, not `_..._value`                                  |
| Aggregation / count   | yes          | `?$count=true` ; `?$apply=aggregate(...)`     | `$apply` capped at 50,000 evaluated rows                                   |
| Logical operators     | yes          | `and` `or` `not`, grouped `( )`               | parenthesise mixed and/or                                                  |
| Comparison operators  | yes          | `eq ne gt ge lt le`                           | plus `contains`/`startswith`/`endswith`                                    |
| Null checks           | yes          | `?$filter=_pmo_owner_value eq null`           | `eq null` / `ne null`                                                      |
| Regex / pattern       | no           | only `contains`/`startswith`/`endswith`       | no regex; substring functions only                                         |

## Patterns

### 1. List & Filter

GET the table's plural EntitySet (from discovery). Always `$select`; filter server-side.

```
GET /api/data/v9.2/pmo_projects?$select=pmo_name,pmo_status,modifiedon&$orderby=modifiedon desc
Prefer: odata.maxpagesize=200
```

`$filter` toolbox: `eq ne gt ge lt le` (comparison); `and or not` (logical, group with `( )`); `contains(field,'x')` substring; `startswith(field,'x')` prefix; `endswith(field,'x')` suffix; `field eq null` / `field ne null`.

Combined: `GET /api/data/v9.2/pmo_projects?$select=pmo_name,pmo_status&$filter=(pmo_status eq 'Active' or pmo_status eq 'AtRisk') and modifiedon ge 2026-01-01T00:00:00Z`

- Join conditions with explicit `and`/`or`; parenthesise mixed precedence.
- Cross-table column comparisons are **not** supported — both sides must be columns of the same table.

### 2. Search

**No `$search`** on the Web API query path — that belongs to Dataverse's separate relevance-search API, not surfaced here. Use `$filter` substring functions:

- Substring: `GET /api/data/v9.2/pmo_projects?$select=pmo_name,pmo_status&$filter=contains(pmo_name,'Aurora')`
- Prefix (cheaper, index-friendly): `GET /api/data/v9.2/pmo_risks?$select=pmo_title,pmo_severity&$filter=startswith(pmo_title,'SEC-')`
- **Case:** Dataverse string filters are generally case-insensitive — but don't rely on it for picklist/choice values; those are **integers**, filter on the integer, not the label.
- **Fuzzy:** none. `contains`/`startswith`/`endswith` only. No minimum length, but `contains` on a large table is a scan — prefer `startswith` or a more selective `$filter`.

### 3. Get by ID

Rows are keyed by the table's `PrimaryIdAttribute` GUID. Address with the GUID in parens:
`GET /api/data/v9.2/pmo_projects(3a5e9c10-7b21-ee11-8179-000d3a9933c9)?$select=pmo_name,pmo_status,pmo_startdate`
A single-row GET returns the entity object **directly** (not wrapped in a `value` array) — unlike collection queries.

### 4. Get Related Records (lookup expansion)

A lookup is exposed two ways on the parent row: `_{navname}_value` (raw GUID, good for `$filter`) and `{navname}` (the navigation property you `$expand`).

- Expand single-valued lookup: `GET /api/data/v9.2/pmo_projects(3a5e9c10-...)?$select=pmo_name&$expand=pmo_ProgramId($select=pmo_name)`
- Expand collection-valued: `GET /api/data/v9.2/pmo_projects(3a5e9c10-...)?$select=pmo_name&$expand=pmo_project_pmo_risks($select=pmo_title,pmo_severity;$top=50)`
- Filter by parent without expanding (cheaper): `GET /api/data/v9.2/pmo_risks?$select=pmo_title,pmo_severity&$filter=_pmo_projectid_value eq 3a5e9c10-7b21-ee11-8179-000d3a9933c9`
- `$expand` only joins relationships defined in the data model — no arbitrary join. **Nested `$expand` is not allowed across N:N.** For readable labels add `Prefer: odata.include-annotations="*"` (or scope to `OData.Community.Display.V1.FormattedValue`) — see Pattern 6.

### 5. Date Range Query

`GET /api/data/v9.2/pmo_projects?$select=pmo_name,modifiedon&$filter=modifiedon ge 2026-05-01T00:00:00Z and modifiedon lt 2026-06-01T00:00:00Z&$orderby=modifiedon desc`

- ISO-8601 UTC (`2026-05-29T13:00:00Z`). DateTime literals are **not** quoted in `$filter` (unlike strings). Use a half-open range (`ge … lt …`) to avoid boundary double-counting.
- Common date fields: `createdon`, `modifiedon` (every table), plus solution dates like `pmo_startdate`/`pmo_enddate` (confirm via `$metadata`/`EntityDefinitions`).

### 6. Aggregation / Count

Inline count (`@odata.count` on the page): `GET /api/data/v9.2/pmo_projects?$select=pmo_name&$filter=pmo_status eq 'Active'&$count=true`
→ `{"@odata.context":"{environment_url}/api/data/v9.2/$metadata#pmo_projects(pmo_name)","@odata.count":42,"value":[{"pmo_name":"Aurora Rollout","pmo_projectid":"3a5e9c10-…"}]}`

Group-by + aggregate via `$apply` (count per status): `GET /api/data/v9.2/pmo_projects?$apply=groupby((statuscode),aggregate($count as count))` + `Prefer: odata.include-annotations="OData.Community.Display.V1.FormattedValue"`
→ `{"@odata.context":"…#pmo_projects","value":[{"statuscode@OData.Community.Display.V1.FormattedValue":"Active","statuscode":1,"count":8},{"statuscode@OData.Community.Display.V1.FormattedValue":"On Hold","statuscode":2,"count":3}]}`

Sum/avg/min/max use `... with <op> as <alias>`:

- `GET /api/data/v9.2/pmo_projects?$apply=groupby((statuscode),aggregate(pmo_budget with sum as totalbudget))`
- `GET /api/data/v9.2/pmo_projects?$apply=aggregate(modifiedon with max as lastChange)`

`$apply` supports `sum`, `average`, `min`, `max`, `countdistinct`, `$count`. **Hard limits:** evaluates at most **50,000 rows** (else `0x8004E023` "AggregateQueryRecordLimit exceeded"); `groupby` on datetime values unsupported; cannot `$orderby` an aggregate alias. Filter first (`$apply=filter(...)/groupby(...)`) to stay under the limit.

## Pagination

- **Type:** server-driven via `@odata.nextLink` (opaque `$skiptoken` cursor). NOT offset/page-number.
- **Default page size:** up to **5,000** rows if you don't ask for fewer. **Max:** 5,000 (`Prefer: odata.maxpagesize=N`; >5000 silently clamped).
- **Total count:** partial. `?$count=true` ⇒ `@odata.count`, but **capped at 5,000** for standard tables (500 elastic) regardless of page size — beyond that it is NOT the true total. Detect truncation via the `Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded` annotation (paired with `totalrecordcount`); for an exact uncapped total use `RetrieveTotalRecordCount` or the `/$count` path segment.

| Parameter / Header                  | Type   | Default | Description                                                                                                 |
| ----------------------------------- | ------ | ------- | ----------------------------------------------------------------------------------------------------------- |
| `Prefer: odata.maxpagesize=N`       | header | 5000    | rows per page; set explicitly (e.g. 200) to bound payloads. **Reuse the SAME value on every page request.** |
| `$top=N`                            | query  | —       | caps **total** rows. **Do NOT combine with paging** — if `odata.maxpagesize` is set, `$top` is ignored.     |
| `$count=true`                       | query  | false   | adds `@odata.count` (capped, see above)                                                                     |
| `$orderby=...`                      | query  | PK      | **order on a unique column** (PK GUID) for stable paging — non-unique orders can repeat/skip rows           |
| `$skiptoken` (in `@odata.nextLink`) | query  | —       | server-issued opaque cursor. **Never construct, modify, or re-encode it** — follow the nextLink verbatim    |

Response shape: `{"@odata.context":"…#pmo_projects(pmo_name)","value":[{"@odata.etag":"W/\"112430907\"","pmo_name":"Aurora Rollout","pmo_projectid":"3a5e9c10-…"}],"@odata.nextLink":"{environment_url}/api/data/v9.2/pmo_projects?$select=pmo_name&$skiptoken=%3Ccookie%20pagenumber=%222%22%20…%3E"}`

**Last page = `@odata.nextLink` absent.** Its presence means "more rows — follow it." No `more_records` boolean, no "page N of M".

Loop:

```
Req 1: GET /api/data/v9.2/pmo_projects?$select=pmo_name&$orderby=pmo_projectid   Prefer: odata.maxpagesize=200
Res 1: { "value":[…200…], "@odata.nextLink":"…$skiptoken=…%222%22…" }
Req 2: GET {the @odata.nextLink URL, verbatim}   Prefer: odata.maxpagesize=200   ← same page size
Res 2: { "value":[…200…], "@odata.nextLink":"…$skiptoken=…%223%22…" }
…
Last:  GET {previous @odata.nextLink, verbatim}   Prefer: odata.maxpagesize=200
Res:   { "value":[…<200…] }   ← NO @odata.nextLink ⇒ done
```

Rules: (1) no hand-rolled `$skip` — unsupported. (2) Don't append/edit query options on the `@odata.nextLink` URL; pass it through unchanged except re-expansion against `{environment_url}`. (3) Same `odata.maxpagesize` every page. (4) Paging is forward-only and dynamic — re-fetching an earlier page can return a different row set if data changed.

## Worked Examples

### 1. Active projects modified this month, newest first, readable status

`GET /api/data/v9.2/pmo_projects?$select=pmo_name,statuscode,_pmo_programid_value,modifiedon&$filter=statuscode eq 1 and modifiedon ge 2026-05-01T00:00:00Z&$orderby=modifiedon desc` + `Prefer: odata.maxpagesize=100, odata.include-annotations="OData.Community.Display.V1.FormattedValue"`
→ `{"@odata.context":"…#pmo_projects(pmo_name,statuscode,_pmo_programid_value,modifiedon)","value":[{"@odata.etag":"W/\"112430907\"","pmo_name":"Aurora Rollout","statuscode@OData.Community.Display.V1.FormattedValue":"Active","statuscode":1,"_pmo_programid_value@OData.Community.Display.V1.FormattedValue":"Digital Transformation","_pmo_programid_value@Microsoft.Dynamics.CRM.lookuplogicalname":"pmo_program","_pmo_programid_value":"b71f2a90-3c44-ee11-be37-000d3a1b1f2c","modifiedon@OData.Community.Display.V1.FormattedValue":"5/28/2026 2:14 PM","modifiedon":"2026-05-28T02:14:11Z","pmo_projectid":"3a5e9c10-7b21-ee11-8179-000d3a9933c9"}]}`

- `statuscode` is an **integer** choice (`1`); the readable label arrives in the `…@OData.Community.Display.V1.FormattedValue` sibling only because of the `Prefer` annotation header.
- Filter on the `_pmo_programid_value` GUID, not the nav property.
- `_pmo_programid_value@Microsoft.Dynamics.CRM.lookuplogicalname` gives the target table (`pmo_program`).
- Two `Prefer` values comma-joined in one header.

### 2. One project with its program and child risks (expand)

`GET /api/data/v9.2/pmo_projects(3a5e9c10-7b21-ee11-8179-000d3a9933c9)?$select=pmo_name,pmo_status&$expand=pmo_ProgramId($select=pmo_name),pmo_project_pmo_risks($select=pmo_title,pmo_severity;$top=50;$orderby=pmo_severity desc)`
→ `{"@odata.context":"…#pmo_projects(pmo_name,pmo_status,pmo_ProgramId(pmo_name),pmo_project_pmo_risks(pmo_title,pmo_severity))/$entity","@odata.etag":"W/\"112430907\"","pmo_name":"Aurora Rollout","pmo_status":"Active","pmo_projectid":"3a5e9c10-7b21-ee11-8179-000d3a9933c9","pmo_ProgramId":{"pmo_name":"Digital Transformation","pmo_programid":"b71f2a90-3c44-ee11-be37-000d3a1b1f2c"},"pmo_project_pmo_risks":[{"pmo_title":"Vendor contract slip","pmo_severity":3,"pmo_riskid":"9d2c4e71-aa55-ee11-…"},{"pmo_title":"Resource shortfall Q3","pmo_severity":2,"pmo_riskid":"1f8b3a02-bb66-ee11-…"}]}`

- Single-valued lookup expands to an **object** (`pmo_ProgramId`); collection-valued to an **array** (`pmo_project_pmo_risks`).
- Inside `$expand` you can nest `$select`/`$top`/`$orderby` (separated by `;`) — but not a further `$expand` across N:N.
- Nav names come from `$metadata` — resolve the real names before querying.

### 3. Total budget per status (groupby aggregate)

`GET /api/data/v9.2/pmo_projects?$apply=filter(statecode eq 0)/groupby((statuscode),aggregate(pmo_budget with sum as totalbudget))` + `Prefer: odata.include-annotations="OData.Community.Display.V1.FormattedValue"`
→ `{"@odata.context":"…#pmo_projects","value":[{"statuscode@OData.Community.Display.V1.FormattedValue":"Active","statuscode":1,"totalbudget@OData.Community.Display.V1.FormattedValue":"$1,240,000.00","totalbudget":1240000.0},{"statuscode@OData.Community.Display.V1.FormattedValue":"On Hold","statuscode":2,"totalbudget@OData.Community.Display.V1.FormattedValue":"$310,000.00","totalbudget":310000.0}]}`

- `filter(...)/groupby(...)` chains transformations with `/` — filter first to stay under the 50,000-row aggregate ceiling.
- Numeric `totalbudget` is the value to compute with; the `@OData.Community.Display.V1.FormattedValue` sibling is the currency-formatted display string.
- Can't `$orderby=totalbudget` — sorting on an aggregate alias errors. Sort client-side.

## Gotchas

1. **No `$skip`, no `$search`, no `$format`.** Page with `@odata.nextLink`; "search" with `$filter contains()` (relevance-search `$search` is a different API).
2. **`$top` and paging don't mix.** If `Prefer: odata.maxpagesize` is present, `$top` is ignored. Use `$top` only for a one-shot capped fetch with no paging.
3. **EntitySetName ≠ table LogicalName.** Query the **plural EntitySet** (`pmo_projects`), but `$filter`/`$select` use **column LogicalNames** (`pmo_name`). Resolve both via `EntityDefinitions`/`$metadata` first — guessing the plural 404s.
4. **Choice/option-set columns are integers.** Filter `statuscode eq 1`, never `statuscode eq 'Active'`. Get the label via `Prefer: odata.include-annotations` + the `…@OData.Community.Display.V1.FormattedValue` sibling.
5. **`statecode`/`statuscode` are a state machine.** Valid `statuscode` depends on the current `statecode` — not a flat list.
6. **Lookups: filter the `_x_value` column, expand the nav property.** `$filter=_pmo_projectid_value eq <guid>` works; `$filter=pmo_ProjectId eq <guid>` does not. You cannot `$select` a navigation property — `$select` the `_x_value` column.
7. **DateTimes are unquoted and UTC.** `modifiedon ge 2026-05-01T00:00:00Z` — no surrounding quotes (strings get quotes, datetimes don't). Normalise to `Z`.
8. **Aggregate ceiling is 50,000 rows.** `$apply` errors with `0x8004E023` if the post-`filter` set exceeds 50k. Add a `filter(...)` and stitch client-side.
9. **Forward-only paging.** Re-requesting an earlier `@odata.nextLink` after data changed can return a different row set. For consistency `$orderby` a unique column (PK GUID); don't go backwards.
10. **Service-protection 429s.** Tight paging loops trip the per-user 5-min limits (6,000 requests / 1,200,000 ms exec / 52 concurrent — see 01d). On 429 honour `Retry-After` (seconds); don't retry immediately or fan out parallel calls.
11. **`@odata.nextLink` is opaque — pass it through unchanged.** Don't decode, edit, or append query options; re-expand against `{environment_url}` and re-send with the same `odata.maxpagesize`.
