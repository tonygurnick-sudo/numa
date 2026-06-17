---
api_name: ProWorkflow
api_slug: proworkflow
base_url: https://api.proworkflow.net
call_surface: HTTP via connectors(name="request", params={connector:"proworkflow", url, method:"GET"}) — flat relative path, no version segment; backend injects apikey + Basic auth (never set them)
doc: query patterns — filter, search, sort, paginate, subtotals, caching (companion to 01)
confidence: every fact live-API-confirmed 2026-06-10 unless tagged [INFERRED]/[DOCS]
---

# ProWorkflow — Query Patterns

> Examples show bare relative paths (the `url` value). `GET /x` ⇒ `connectors(name="request", params={connector:"proworkflow", url:"/x", method:"GET"})`.

## Query Capabilities

| Capability        | Supported    | Syntax                                          | Notes                                                       |
| ----------------- | ------------ | ----------------------------------------------- | ----------------------------------------------------------- | ------------- |
| Filter by field   | Yes          | `?status=active`, `?companyid=1,2`              | per-call params; most accept comma ID lists                 |
| Date range        | Yes          | `?duedatefrom=2026-06-01&duedateto=+1m`         | `*from`/`*to` pairs; absolute or relative                   |
| Full-text search  | Yes          | `?search=website`, `?searchname=warren`         | substring, case-insensitive; `!` negates                    |
| Sort by field     | Yes          | `?sortby=duedate`                               | allowed fields vary per endpoint                            |
| Sort direction    | Yes          | `?sortorder=asc`                                | `desc`                                                      | default `asc` |
| Field selection   | Yes          | `?fields=email,type`                            | `id` ALWAYS returned                                        |
| Include related   | Limited      | single-item flags e.g. `?tasks=true`            | only some get-by-ID calls (notably `/projects/{id}`)        |
| Aggregation/count | Yes          | `?subtotals=company` (time, invoices, quotes)   | plus `count`/`totalcount` on every list                     |
| Logical AND/OR    | Implicit AND | multiple params                                 | within one ID-list param values OR; `*mode=any/all` toggles |
| Comparison        | Yes          | `gte300`, `lte300`, `gte30%`, `over`, `under`   | numeric filters (invoicetotal, quotetotal, timetracked...)  |
| Null checks       | No           | —                                               | not supported                                               |
| Exclusion (NOT)   | Yes          | `!` prefix: `?categoryid=!1,2`, `?search=!demo` | most ID-list and search filters                             |

## Response Envelope

**List** — collection key matches URL tail:
`{"count":20,"totalcount":137,"status":"Success","projects":[{"id":6,"number":"P-0103","title":"..."}, ...]}`

- `count` = records in this response; `totalcount` = records matching the filters overall. Always an array, even for one result.
- `time`/`invoices`/`quotes` also return a `total` (summed value).

**Single-item** — singular key, object:
`{"contact":{"id":504,"firstname":"Warren","...":"all fields"},"count":1,"status":"Success"}`

- Single-item GETs return ALL fields; `fields` applies to list calls only.

## Patterns

### 1. List & Filter

`GET /projects?status=active&companyid=8&duedateto=+2w&sortby=duedate&sortorder=asc`

- ID filters accept lists: `?companyid=1,2,3` (matches ANY listed ID).
- `!` negates: `?categoryid=!1,2` = NOT in categories 1 or 2.
- Most lists have default filters — `/projects` and `/tasks` default to `status=active`. Pass `status=all` to include completed.
- `me` substitutes the requesting user's contact ID in contact filters: `?contacts=me`, `?managerid=me`.
- Multi-contact filters take a companion `*mode`: `?contacts=1,2&contactsmode=all` (default `any`).
- Different params AND together; values inside one ID-list param OR (AND via `*mode=all` where offered). No nested conditions — use multiple requests for true OR across fields.

### 2. The `fields` Parameter

Every list call has a per-call default field set (`/projects`→`title,number,company,startdate,duedate`; `/companies`→`code,name,type`; `/tasks`→`name,type,order,status,project,startdate,duedate`). Request only what you need:
`GET /contacts?fields=email,type` → `{"contacts":[{"email":"amy@abcmedia.com","id":504,"type":"client"}],"count":1,"status":"Success"}`

- `id` is ALWAYS returned, whether asked for or not.
- Special values: `apifields` returns all API custom fields; `apifieldX` returns API Field ID X only (repeat per field).
- Composite fields expand: on `/projects`, `dates`→start/due/complete, `contacts`→clients/contractors/manager/staff, `burn`→budget/burn/totalburn.
- On `/time`, `fields=none` returns only Total/Subtotals (no individual records).

### 3. Search

No global search endpoint — search is per-resource via `search*` params. Matching is case-insensitive substring.
`GET /contacts?searchname=warren` · `GET /projects?search=website` · `GET /projects?searchdescription=rebrand`

| Resource     | Search parameters                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `/contacts`  | `search` (name or email), `searchname`, `searchemail`                                                         |
| `/companies` | `searchname`, `searchcode`                                                                                    |
| `/projects`  | `search` (number or title), `searchtitle`, `searchnumber`, `searchdescription`, `searchcustomform` (Advanced) |
| `/tasks`     | `search` (name), `searchname`, `searchdescription`                                                            |

- Negation: `?search=!layout` returns items NOT containing "layout".
- No fuzzy matching — plain substring ("art" matches "cart" and "article"). No ranking; results follow `sortby`/`sortorder`, not relevance.

### 4. Get by ID

`GET /contacts/504` (same shape for `/projects/6`, `/tasks/12`, ...) → full field set in a singular-key object (`contact`, `project`, `task`...).
**Embedded related data (single project only):** `/projects/{id}` accepts boolean expanders:
`GET /projects/6?tasks=true&quotes=true&invoices=true&files=true&messages=true&timerecords=true`
Each defaults `false`. `timerecords` is staff-only; `messagescontacts` defaults to `me` (set `messagescontacts=all` to embed everyone's).

### 5. Get Related Records (sub-resource URLs)

Child collections are sub-resources rather than foreign-key filters:
`GET /companies/{id}/contacts` (also .../projects, /invoices, /quotes, /tasks, /time, /notes)
`GET /contacts/{id}/tasks` (also .../projects, /time, /notes)
`GET /projects/{id}/tasks` (also .../time, /files, /messages, /quotes, /invoices, /expenses, /sharednotes)
`GET /tasks/{id}/time` (also .../messages, /files, /contacts)
These accept the same filter/sort/page params as top-level. Some top-level lists also accept parent-ID filters (`/projects?companyid=8`, `/tasks?projectid=6`) — either works; sub-resources read more naturally for one parent, filters better for several (`/tasks?projectid=1,2,3`).
Convenience views: `/projects/overdue`, `/projects/overtime`, `/tasks/overdue`, `/tasks/overtime`, `/invoices/overdue`, `/companies/client`, `/contacts/staff`, etc.

### 6. Date Range Query

Date filters come in `from`/`to` pairs, three formats: plain date (`2026-06-18`), date & time (`2026-06-18T13:20`, ISO8601 no timezone — used by `lastmodified*`), relative (`+3w`, `-2d`, `+1m`).
`GET /projects?duedatefrom=+0d&duedateto=+2w&status=active`
`GET /time?trackedfrom=-1w&trackedto=+0d&contacts=me`
`GET /projects?completedatefrom=-1m`

**Relative date syntax — two variants, do not mix:**

1. Date filters/fields: `+/-X` + `d/w/m/y` (days/weeks/months/years). `-3w`=3 weeks ago, `+1m`=1 month ahead.
2. `lastmodified*` filters: bare `X` + `n/h/d/w/m` = X minutes/hours/days/weeks/months **ago** — **`n` is MINUTES**. `lastmodifiedfrom=15n` = modified in the last 15 minutes.

Last-modified filters (the polling workhorses): `GET /contacts?lastmodifiedfrom=15n` · `GET /projects?lastmodifiedutcfrom=2026-06-10T02:00`. Each resource with `lastmodifiedfrom`/`lastmodifiedto` also has UTC variants `lastmodifiedutcfrom`/`lastmodifiedutcto`. Returned timestamps are ISO8601 without timezone, in the user's account time — use the UTC variants if you store UTC high-water marks.

### 7. Numeric Comparison Filters

Money/time filters on `/projects` (and similar elsewhere):
`GET /projects?invoicetotal=gte300` (>= 300) · `GET /projects?timetracked=gte30%` (>= 30% of allocated) · `GET /projects?invoicetotal=over` (invoiced more than quoted)

- Bare `number` = exact; `gteN`/`lteN` = >= / <=; `gteN%`/`lteN%` = percentage of the comparison total; `over`/`under` = against the quote/allocated total. All time quantities in MINUTES.
- `idfrom`/`idto` = ID-range bounds (docs describe them inconsistently — verify with a small page if exact bounds matter). `id=1,2,3` fetches an explicit ID list.

### 8. Subtotals (time, invoices, quotes)

`GET /time?trackedfrom=2026-06-01&trackedto=2026-06-30&subtotals=company&fields=none`
→ `{"status":"Success","subtotals":[{"companyid":393,"companyname":"0800 Flowers","subtotal":200},{"companyid":1,"companyname":"Advanced Agency","subtotal":80}],"total":380}`

- `subtotals` is an ORDERED comma list: `billable`, `category`, `company`, `contact`, `project`, `task`, `day`, `week`, `month`, `year` (plus `group`/`team`/`internalclient*` on Advanced). E.g. `subtotals=contact,company` = one subtotal per contact+company.
- Only non-zero subtotals returned. With `week`, `trackedfrom` is the first day of the week. Time subtotals are minutes; invoice/quote subtotals are currency.
- `/time` requires `trackedfrom`/`trackedto` (defaults `-6d`/`+0d` — i.e. last 7 days only unless widened).

### 9. API Custom Field Filters

If API Fields are defined (see 01c), filter with `apifields=<fieldid>,<substring>` pairs joined by `||`:
`GET /contacts?apifields=3,may` · `GET /projects?apifields=2,Europe||3,Industrial&apifieldsmode=all`

- Use the field ID, not its name. `apifieldsmode=any` (default) ORs pairs; `all` ANDs them. Same field ID can repeat with different values when mode is `any`.

## Pagination

- Type: page-number, 1-based. Default: no paging — returns everything up to the 5,000-record cap (silent truncation beyond). Keep requests ≤500/page. `totalcount` on every list response.

| Param        | Type   | Default | Notes                                       |
| ------------ | ------ | ------- | ------------------------------------------- |
| `pagesize`   | int    | —       | items/page. **Must pair with pagenumber**   |
| `pagenumber` | int    | —       | 1-based. **Must pair with pagesize**        |
| `sortby`     | string | varies  | per-call list; `/projects` default `number` |
| `sortorder`  | string | `asc`   | `asc`/`desc`                                |

**`pagesize` and `pagenumber` are all-or-nothing.** One without the other → 400 `"pagesize and pagenumber must both be provided in order to use paging"`.
**Last page:** `pagenumber*pagesize >= totalcount`, or a page with `count < pagesize` (or `count == 0`).

Loop example:

```
GET /projects?status=all&pagesize=100&pagenumber=1 → {"count":100,"totalcount":245,...}
GET /projects?status=all&pagesize=100&pagenumber=2 → {"count":100,"totalcount":245,...}
GET /projects?status=all&pagesize=100&pagenumber=3 → {"count":45,"totalcount":245,...}  ← count<pagesize: done (3*100>=245)
```

Keep `sortby`/`sortorder` constant across pages or page contents may shift.

Allowed sort fields (per endpoint):
| Endpoint | Sort fields | Default |
| --- | --- | --- |
| `/projects` | `id`,`title`,`number`,`startdate`,`duedate`,`completedate`,`categoryname`,`companyname`,`priority` | `number` |
| `/tasks` | `id`,`order`,`name`,`startdate`,`duedate`,`completedate`,`priority`,`projectid`,`projectnumber`,... | `id` |
| `/contacts` | `id`,`firstname`,`lastname` | `firstname` |
Other lists follow the same pattern — check the call's SORT/PAGE section if a sort field is rejected.

## Caching: ETags & If-None-Match

Every successful GET returns an `etag` header (unquoted hex, e.g. `10f7b92898aa74de`). Echo it in `If-None-Match` on the next identical request; if unchanged → **304 Not Modified with empty body** — reuse your cached copy.

```
Response: etag: 10f7b92898aa74de
Request:  If-None-Match: 10f7b92898aa74de
```

A 304 still costs a request against the rate limit and the server still builds the list to compare, so for large datasets prefer `lastmodifiedfrom` polling over ETag-spamming.

## Polling with lastmodifiedfrom

Cheap change-detection loop (webhooks better still — see 01d):

```
1. GET /contacts?lastmodifiedfrom=15n   ← 15n = 15 MINUTES (n = minutes)
2. Process returned items (only those added/updated in the window)
3. Wait one interval; repeat
```

Make the relative window slightly larger than the poll interval to avoid missing boundary edits; de-duplicate by `id`. Use `lastmodifiedutcfrom` with stored UTC timestamps for exact high-water marks. Deletes do NOT appear in modified-window polls — use `delete*` webhooks or periodic ID-list reconciliation.

## Worked Examples

### 1. Active projects for a company, due soonest first

`GET /projects?companyid=8&status=active&fields=number,title,duedate,manager&sortby=duedate&sortorder=asc&pagesize=20&pagenumber=1`
→ `{"count":2,"totalcount":2,"status":"Success","projects":[{"id":6,"number":"P-0103","title":"Website Refresh","duedate":"2026-06-24T00:00:00","managerid":1,"managername":"Tony Gurnick"},{"id":7,"number":"P-0104","title":"Brand Guidelines","duedate":"2026-07-02T00:00:00","managerid":1,"managername":"Tony Gurnick"}]}`

- `status=active` is the default; use `status=all` for completed. Dates are ISO8601 without timezone. `id` appears though not in `fields`.

### 2. My open tasks due this week

`GET /tasks?contacts=me&status=active&duedateto=+1w&fields=name,project,duedate,priority&sortby=duedate&sortorder=asc`
→ `{"count":3,"totalcount":3,"status":"Success","tasks":[{"id":12,"name":"Draft homepage copy","projectid":6,"projectnumber":"P-0103","projecttitle":"Website Refresh","duedate":"2026-06-12T00:00:00","priority":2}]}`

- `contacts=me` resolves to the authenticated user's contact ID. `duedateto=+1w` = 1 week ahead. Results are permission-trimmed server-side ("View Work" permissions).

### 3. Time tracked per person this month (no individual records)

`GET /time?trackedfrom=2026-06-01&trackedto=2026-06-30&subtotals=contact&fields=none`
→ `{"status":"Success","subtotals":[{"contactid":1,"contactname":"Tony Gurnick","subtotal":510},{"contactid":2,"contactname":"Amy West","subtotal":240}],"total":750}`

- Values are minutes (750 = 12.5h). Without explicit `trackedfrom`/`trackedto` you silently get only the last 7 days. `fields=none` suppresses individual records — fastest for totals.

## Gotchas

1. `pagesize` and `pagenumber` are all-or-nothing → 400 `"pagesize and pagenumber must both be provided in order to use paging"`.
2. Default filters hide data: `/projects` and `/tasks` default `status=active`; `/time` defaults last 7 days (`trackedfrom=-6d`). "Why is totalcount 0?" is almost always this — pass `status=all` / explicit date ranges. (Fresh trial showed `totalcount:0` on /projects until status+dates widened; sample/deleted projects may never appear at all.)
3. `n` means minutes. In `lastmodifiedfrom=15n` the `n` is minutes. Elsewhere relative dates use `+/-Xd/w/m/y`. Not interchangeable.
4. No timezone on returned dates — ISO8601, no offset, in the user's local convention. Use `lastmodifiedutc*` variants for UTC-anchored polling.
5. `id` always comes back even with a restrictive `fields` list.
6. The 5,000-record cap is silent — requests matching >5,000 return only the first 5,000 with no error. Always page (≤500/page) and check `totalcount`.
7. Unknown paths return an HTML 404 page, not JSON (e.g. `/project/6`) — parse defensively.
8. File content is not on the REST API (except `?content=true` ≤1 MB). `/files` responses carry a `link` to `app.proworkflow.com/...getfilesattached.cfm?...sec_key=...` — downloads go through that signed link.
9. `/workload` rejects past dates — `datefrom` must be today or later (past → 400). Defaults `+0d`/`+2w`; values are minutes/day, weekends excluded, overdue tasks NOT counted.
10. List vs single-item shape differs: lists → plural array key + `count`/`totalcount`; single → singular object key + `count:1`. Don't write one parser for both.
