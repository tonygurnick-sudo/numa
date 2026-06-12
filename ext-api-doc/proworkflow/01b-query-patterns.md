---
api_name: 'ProWorkflow'
api_slug: 'proworkflow'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-06-10'
update_source: 'official API docs + live API testing (trial account "ArcanumAI", Advanced plan)'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# ProWorkflow -- Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Contains all read operation patterns including
> filtering, searching, sorting, pagination, subtotals, and caching.
> Facts marked [CONFIRMED -- live API test 2026-06-10] were verified against a live trial account.

> **Auth note:** Examples below show bare relative paths. The Numa backend automatically injects
> BOTH required auth mechanisms (`Authorization: Basic ...` from the user's vault and the
> `apikey` header from connector config) when the workspace agent calls
> `connectors(name="request", params={connector: "proworkflow", url: "/...", method: "GET"})`.
> Never set Authorization or apikey headers yourself. Relative URLs expand against
> `https://api.proworkflow.net`.

---

## Query Capabilities Summary

| Capability                 | Supported    | Syntax                                          | Notes                                                            |
| -------------------------- | ------------ | ----------------------------------------------- | ---------------------------------------------------------------- |
| Filter by field value      | Yes          | `?status=active`, `?companyid=1,2`              | Per-call filter params; most accept comma-separated ID lists     |
| Filter by date range       | Yes          | `?duedatefrom=2026-06-01&duedateto=+1m`         | `*from`/`*to` pairs; absolute or relative dates                  |
| Full-text search           | Yes          | `?search=website`, `?searchname=warren`         | Substring, case-insensitive; `!` prefix negates                  |
| Sort by field              | Yes          | `?sortby=duedate`                               | Allowed fields vary per endpoint                                 |
| Sort direction             | Yes          | `?sortorder=asc` or `desc`                      | Default: `asc`                                                   |
| Field selection            | Yes          | `?fields=email,type`                            | `id` ALWAYS returned regardless [CONFIRMED]                      |
| Include related records    | Limited      | Single-item flags e.g. `?tasks=true`            | Only on some get-by-ID calls (notably `/projects/{id}`)          |
| Aggregation / count        | Yes          | `?subtotals=company` (time, invoices, quotes)   | Plus `count`/`totalcount` on every list response                 |
| Logical operators (AND/OR) | Implicit AND | Multiple params                                 | Within one ID-list param, values are OR; `*mode=any/all` toggles |
| Comparison operators       | Yes          | `gte300`, `lte300`, `gte30%`, `over`, `under`   | On numeric filters (invoicetotal, quotetotal, timetracked...)    |
| Null checks                | No           | --                                              | Not supported                                                    |
| Exclusion (NOT)            | Yes          | `!` prefix: `?categoryid=!1,2`, `?search=!demo` | Available on most ID-list and search filters                     |

---

## Response Envelope [CONFIRMED -- live API test 2026-06-10]

**List call** -- collection key matches the URL tail:

```json
{
  "count": 20,
  "totalcount": 137,
  "status": "Success",
  "projects": [ { "id": 6, "number": "P-0103", "title": "..." }, ... ]
}
```

- `count` = records in this response; `totalcount` = records matching the filters overall.
- Some calls (notably `time`, `invoices`, `quotes`) also return a `total` field with the
  summed value of the matched items.
- A list call ALWAYS returns an array, even for a single result.

**Single-item call** -- singular key, object (not array):

```json
{ "contact": { "id": 504, "firstname": "Warren", "...": "all fields" }, "count": 1, "status": "Success" }
```

Single-item GETs return ALL available fields; the `fields` parameter applies to list calls.

---

## Common Patterns

### Pattern 1: List & Filter

```http
GET /projects?status=active&companyid=8&duedateto=+2w&sortby=duedate&sortorder=asc
```

**Conventions:**

- ID filters accept lists: `?companyid=1,2,3` (matches ANY listed ID).
- `!` prefix negates: `?categoryid=!1,2` = NOT in categories 1 or 2.
- Most list calls have **default filters** -- e.g. `/projects` and `/tasks` default to
  `status=active`. Pass `status=all` to include completed items.
- `me` substitutes the requesting user's contact ID in contact-typed filters:
  `?contacts=me`, `?managerid=me`. [CONFIRMED -- live API test 2026-06-10]
- Multi-contact filters take a companion `*mode` param: `?contacts=1,2&contactsmode=all`
  (default `any`).

**Combining filters:** different parameters AND together; values inside one ID-list
parameter OR together (AND via `*mode=all` where offered). No nested conditions -- use
multiple requests for true OR across fields.

---

### Pattern 2: The `fields` Parameter

Every list call has a documented per-call default field set (e.g. `/projects` defaults to
`title,number,company,startdate,duedate`; `/companies` to `code,name,type`; `/tasks` to
`name,type,order,status,project,startdate,duedate`). Request only what you need:

```http
GET /contacts?fields=email,type
```

```json
{ "contacts": [ { "email": "amy@abcmedia.com", "id": 504, "type": "client" } ], "count": 1, "status": "Success" }
```

**Key facts:**

- `id` is ALWAYS returned, whether or not you ask for it. [CONFIRMED -- live API test 2026-06-10]
- Special field values: `apifields` returns all API custom fields; `apifieldX` returns API
  Field ID X only (repeat per field).
- Composite fields expand: on `/projects`, `dates` returns start/due/complete, `contacts`
  returns clients/contractors/manager/staff, `burn` returns budget/burn/totalburn.
- On `/time`, `fields=none` returns only the Total/Subtotals (no individual records).

---

### Pattern 3: Search

No global search endpoint -- search is per-resource via `search*` filter parameters.
Matching is **case-insensitive substring**.

```http
GET /contacts?searchname=warren
GET /projects?search=website
GET /projects?searchdescription=rebrand
```

**Search parameters by resource (most common):**

| Resource    | Parameters                                                                 |
| ----------- | -------------------------------------------------------------------------- |
| `/contacts` | `search` (name or email), `searchname`, `searchemail`                      |
| `/companies`| `searchname`, `searchcode`                                                 |
| `/projects` | `search` (number or title), `searchtitle`, `searchnumber`, `searchdescription`, `searchcustomform` (Advanced) |
| `/tasks`    | `search` (name), `searchname`, `searchdescription`                         |

- **Negation:** `?search=!layout` returns items NOT containing "layout".
- **Fuzzy matching:** No -- plain substring only ("art" matches "cart" and "article").
  No ranking: results follow `sortby`/`sortorder`, not relevance.

---

### Pattern 4: Get by ID

```http
GET /contacts/504        (same shape for /projects/6, /tasks/12, ...)
```

Returns the full field set in a **singular-key object** (`contact`, `project`, `task`...).

**Embedded related data (single project only):** `/projects/{id}` accepts boolean expanders --

```http
GET /projects/6?tasks=true&quotes=true&invoices=true&files=true&messages=true&timerecords=true
```

Each defaults to `false`. `timerecords` is staff-only; `messagescontacts` defaults to `me`
(set `messagescontacts=all` to embed everyone's messages).

---

### Pattern 5: Get Related Records (sub-resource URLs)

ProWorkflow exposes child collections as sub-resources rather than foreign-key filters:

```http
GET /companies/{companyid}/contacts      (also .../projects, /invoices, /quotes, /tasks, /time, /notes)
GET /contacts/{contactid}/tasks          (also .../projects, /time, /notes)
GET /projects/{projectid}/tasks          (also .../time, /files, /messages, /quotes, /invoices, /expenses, /sharednotes)
GET /tasks/{taskid}/time                 (also .../messages, /files, /contacts)
```

These accept the same filter/sort/page parameters as their top-level equivalents. Some
top-level lists also accept parent-ID filters (e.g. `/projects?companyid=8`,
`/tasks?projectid=6`) -- either route works; sub-resources read more naturally for one parent,
filters are better for several parents at once (`/tasks?projectid=1,2,3`).

Convenience views also exist: `/projects/overdue`, `/projects/overtime`, `/tasks/overdue`,
`/tasks/overtime`, `/invoices/overdue`, `/companies/client`, `/contacts/staff`, etc.

---

### Pattern 6: Date Range Query

Date filters come in `from`/`to` pairs and accept three formats: plain date (`2026-06-18`),
date & time (`2026-06-18T13:20`, ISO8601 without timezone -- used by `lastmodified*`), and
relative (`+3w`, `-2d`, `+1m`).

```http
GET /projects?duedatefrom=+0d&duedateto=+2w&status=active
GET /time?trackedfrom=-1w&trackedto=+0d&contacts=me
GET /projects?completedatefrom=-1m
```

**Relative date syntax -- two variants. Do not mix them up:**

1. **Date filters/fields:** `+/-X` followed by `d/w/m/y` (days/weeks/months/years).
   `-3w` = 3 weeks ago, `+1m` = 1 month ahead. [CONFIRMED -- live API test 2026-06-10]
2. **`lastmodified*` filters:** bare `X` followed by `n/h/d/w/m` meaning X
   minutes/hours/days/weeks/months **ago** -- **`n` is MINUTES, not anything else.**
   `lastmodifiedfrom=15n` = modified in the last 15 minutes. [CONFIRMED -- live API test 2026-06-10]

**Last-modified filters (the polling workhorses):**

```http
GET /contacts?lastmodifiedfrom=15n
GET /projects?lastmodifiedutcfrom=2026-06-10T02:00
```

Each resource with `lastmodifiedfrom`/`lastmodifiedto` also has UTC variants
`lastmodifiedutcfrom`/`lastmodifiedutcto`. Returned timestamps are ISO8601 **without timezone**,
rendered in the requesting user's account time -- use the UTC variants if you store UTC
high-water marks.

---

### Pattern 7: Numeric Comparison Filters

Money/time filters on `/projects` (and similar elsewhere) support rich comparison syntax:

```http
GET /projects?invoicetotal=gte300        # invoice total >= 300
GET /projects?timetracked=gte30%         # time tracked >= 30% of allocated
GET /projects?invoicetotal=over          # invoiced more than quoted
```

- Bare `number` = exact match; `gteN` / `lteN` = >= / <=; `gteN%` / `lteN%` = percentage of
  the comparison total; `over` / `under` = against the quote/allocated total.
- All time quantities are in **minutes**.
- `idfrom` / `idto` give ID-range filtering on most lists (note the docs describe them
  inconsistently; treat them as "from this ID" / "to this ID" range bounds and verify with a
  small page if exact bounds matter). `id=1,2,3` fetches an explicit ID list.

---

### Pattern 8: Subtotals (time, invoices, quotes)

Request aggregated subtotals instead of (or alongside) individual records:

```http
GET /time?trackedfrom=2026-06-01&trackedto=2026-06-30&subtotals=company&fields=none
```

```json
{ "status": "Success", "subtotals": [ { "companyid": 393, "companyname": "0800 Flowers", "subtotal": 200 }, { "companyid": 1, "companyname": "Advanced Agency", "subtotal": 80 } ], "total": 380 }
```

- `subtotals` accepts an **ordered** comma list: `billable`, `category`, `company`, `contact`,
  `project`, `task`, `day`, `week`, `month`, `year` (plus `group`/`team`/`internalclient*` on
  Advanced). E.g. `subtotals=contact,company` = one subtotal per contact+company combination.
- Only **non-zero** subtotals are returned.
- With `week`, the `trackedfrom` date is used as the first day of the week.
- Time subtotals are minutes; invoice/quote subtotals are currency values.
- `/time` requires `trackedfrom`/`trackedto` (defaults: `-6d` / `+0d` -- i.e. **the last 7
  days only** unless you widen it).

---

### Pattern 9: API Custom Field Filters

If API Fields are defined (see `01c-mutation-patterns.md`), filter on them with
`apifields=<fieldid>,<substring>` pairs joined by `||`:

```http
GET /contacts?apifields=3,may
GET /projects?apifields=2,Europe||3,Industrial&apifieldsmode=all
```

- Use the field **ID**, not its name.
- `apifieldsmode=any` (default) ORs the pairs; `all` ANDs them. The same field ID can repeat
  with different values when mode is `any`.

---

## Pagination Handling

### Model

- **Type:** page-number (`pagenumber` is 1-based)
- **Default:** no paging -- the API returns everything up to the record cap
- **Record cap:** 5,000 records per request; keep requests <= 500 for performance
- **Total count available:** Yes -- `totalcount` on every list response

### Request Parameters

| Parameter    | Type    | Default | Description                                              |
| ------------ | ------- | ------- | --------------------------------------------------------- |
| `pagesize`   | integer | --      | Items per page. **Must be sent together with pagenumber** |
| `pagenumber` | integer | --      | 1-based page index. **Must be sent together with pagesize** |
| `sortby`     | string  | varies  | Sort field (per-call list; `/projects` default `number`)  |
| `sortorder`  | string  | `asc`   | `asc` or `desc`                                           |

**CRITICAL:** `pagesize` and `pagenumber` MUST be provided together. Sending one without the
other returns 400 `"pagesize and pagenumber must both be provided in order to use paging"`.
[CONFIRMED -- live API test 2026-06-10]

### Last Page Detection

There is no next-page token. Use `totalcount`:

- done when `pagenumber * pagesize >= totalcount`, or
- when a page comes back with `count < pagesize` (or `count == 0`).

### Full Pagination Loop

```
Request 1: GET /projects?status=all&pagesize=100&pagenumber=1
Response 1: { "count": 100, "totalcount": 245, "projects": [...] }
Request 2: GET /projects?status=all&pagesize=100&pagenumber=2
Response 2: { "count": 100, "totalcount": 245, "projects": [...] }
Request 3: GET /projects?status=all&pagesize=100&pagenumber=3
Response 3: { "count": 45, "totalcount": 245, "projects": [...] }
           <- count < pagesize: done (3 * 100 >= 245)
```

Keep `sortby`/`sortorder` constant across pages or ordering (and therefore page contents)
may shift between requests.

### Sorting

```http
GET /contacts?sortby=firstname&sortorder=desc&pagesize=5&pagenumber=1
```

**Allowed sort fields (per endpoint, from the official call docs):**

| Endpoint    | Sort fields                                                                              | Default     |
| ----------- | ----------------------------------------------------------------------------------------- | ----------- |
| `/projects` | `id`, `title`, `number`, `startdate`, `duedate`, `completedate`, `categoryname`, `companyname`, `priority` | `number`    |
| `/tasks`    | `id`, `order`, `name`, `startdate`, `duedate`, `completedate`, `priority`, `projectid`, `projectnumber`, ... | `id`        |
| `/contacts` | `id`, `firstname`, `lastname`                                                              | `firstname` |

Other list calls follow the same pattern -- check the SORT/PAGE section of the specific call
if a sort field is rejected.

---

## Caching: ETags & If-None-Match [CONFIRMED -- live API test 2026-06-10]

Every successful GET returns an `etag` header (unquoted hex, e.g. `10f7b92898aa74de`).
Echo it back in `If-None-Match` on the next identical request; if nothing changed you get
**304 Not Modified with an empty body** -- re-use your cached copy.

```
Response header:  etag: 10f7b92898aa74de
Request header:   If-None-Match: 10f7b92898aa74de
```

A 304 still costs a request against the rate limit and the server still builds the list to
compare, so for large datasets prefer `lastmodifiedfrom` polling (below) over ETag-spamming.

## Polling with lastmodifiedfrom

The recommended cheap change-detection loop (webhooks are better still -- see
`01d-event-and-error-handling.md`):

```
1. GET /contacts?lastmodifiedfrom=15n      <- 15n = 15 MINUTES (n = minutes)
2. Process returned items (only those added/updated in the window)
3. Wait one poll interval; repeat
```

Make the relative window slightly larger than the poll interval to avoid missing edits at the
boundary, and de-duplicate by `id`. Use `lastmodifiedutcfrom` with stored UTC timestamps if
you need exact high-water marks instead of relative windows.

---

## Worked Examples

### Example 1: Active projects for a company, due soonest first

```http
GET /projects?companyid=8&status=active&fields=number,title,duedate,manager&sortby=duedate&sortorder=asc&pagesize=20&pagenumber=1
```

```json
{
  "count": 2,
  "totalcount": 2,
  "status": "Success",
  "projects": [
    { "id": 6, "number": "P-0103", "title": "Website Refresh", "duedate": "2026-06-24T00:00:00", "managerid": 1, "managername": "Tony Gurnick" },
    { "id": 7, "number": "P-0104", "title": "Brand Guidelines", "duedate": "2026-07-02T00:00:00", "managerid": 1, "managername": "Tony Gurnick" }
  ]
}
```

**Key points:**

- `status=active` is the default anyway -- shown for clarity; use `status=all` to include
  completed projects.
- Dates come back as ISO8601 **without timezone**. [CONFIRMED -- live API test 2026-06-10]
- `id` appears even though it was not in `fields`.

---

### Example 2: My open tasks due this week

```http
GET /tasks?contacts=me&status=active&duedateto=+1w&fields=name,project,duedate,priority&sortby=duedate&sortorder=asc
```

```json
{ "count": 3, "totalcount": 3, "status": "Success", "tasks": [ { "id": 12, "name": "Draft homepage copy", "projectid": 6, "projectnumber": "P-0103", "projecttitle": "Website Refresh", "duedate": "2026-06-12T00:00:00", "priority": 2 } ] }
```

**Key points:**

- `contacts=me` resolves to the authenticated user's contact ID. [CONFIRMED -- live API test 2026-06-10]
- `duedateto=+1w` is a relative date (1 week ahead).
- Results are permission-trimmed server-side: users only see what their ProWorkflow
  "View Work" permissions allow.

---

### Example 3: Time tracked per person this month (no individual records)

```http
GET /time?trackedfrom=2026-06-01&trackedto=2026-06-30&subtotals=contact&fields=none
```

```json
{ "status": "Success", "subtotals": [ { "contactid": 1, "contactname": "Tony Gurnick", "subtotal": 510 }, { "contactid": 2, "contactname": "Amy West", "subtotal": 240 } ], "total": 750 }
```

**Key points:**

- Subtotal values are **minutes** (750 = 12.5 hours).
- Without explicit `trackedfrom`/`trackedto` you silently get only the last 7 days
  (defaults `-6d`/`+0d`).
- `fields=none` suppresses individual time records -- fastest option for totals.

---

## Gotchas & Counter-Exceptions

1. **`pagesize` and `pagenumber` are all-or-nothing.** One without the other -> 400
   `"pagesize and pagenumber must both be provided in order to use paging"`.
   [CONFIRMED -- live API test 2026-06-10]

2. **Default filters hide data.** `/projects` and `/tasks` default to `status=active`;
   `/time` defaults to the last 7 days (`trackedfrom=-6d`). "Why is totalcount 0?" is almost
   always a default-filter problem -- pass `status=all` / explicit date ranges.
   [CONFIRMED -- live API test 2026-06-10: fresh trial showed `totalcount: 0` on /projects
   until status and dates were widened; sample/deleted projects may never appear at all.]

3. **`n` means minutes.** In `lastmodifiedfrom=15n` the `n` suffix is minutes. Elsewhere
   relative dates use `+/-Xd/w/m/y`. The two syntaxes are not interchangeable.

4. **No timezone on returned dates.** ISO8601 without offset, rendered in the account/user's
   local convention. Use the `lastmodifiedutc*` filter variants for UTC-anchored polling.

5. **`id` always comes back** even with a restrictive `fields` list. [CONFIRMED -- live API test 2026-06-10]

6. **The 5,000-record cap is silent.** Requests matching more than 5,000 records return only
   the first 5,000 with no error. Always page (<= 500/page recommended) and check `totalcount`.

7. **Unknown paths return an HTML 404 page, not JSON.** A typo'd URL (e.g. `/project/6`)
   yields HTML -- parse responses defensively. [CONFIRMED -- live API test 2026-06-10]

8. **File content is not on the REST API.** `/files` responses include a `link` to
   `app.proworkflow.com/...getfilesattached.cfm?...sec_key=...` -- downloads go through that
   signed link, not a REST endpoint. [CONFIRMED -- live API test 2026-06-10]

9. **`/workload` rejects past dates.** `datefrom` must be today or later; past dates -> 400.
   [CONFIRMED -- live API test 2026-06-10] Defaults `+0d`/`+2w`; values are minutes/day,
   weekends excluded, overdue tasks NOT counted.

10. **List vs single-item shape differs.** Lists -> plural array key + `count`/`totalcount`;
    single item -> singular object key + `count: 1`. Don't write one parser for both.

---

_Generated from the official ProWorkflow API documentation and live API testing, Phases 5-6._
