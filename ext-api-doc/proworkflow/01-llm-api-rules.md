---
api_name: ProWorkflow
api_slug: proworkflow
base_url: https://api.proworkflow.net
path_construction: pass FLAT relative path (e.g. /projects); backend expands against base_url
path_version_segment: none (API is unversioned — no version in path, header, or label)
call_surface: HTTP via connectors(name="request", params={connector:"proworkflow", url, method, body})
auth: dual, BOTH injected by backend — apikey header (account) + Basic auth (per-user email:password). NEVER set them.
field_casing: all-lowercase, no separators (companyid, startdate, lastmodified)
id_format: integer in all URLs; projects/quotes/invoices ALSO carry a display `number` (e.g. "P-0103") — never put `number` in a URL
rate_limit: 500 req / 30s per account API key (shared by all users on the tenant)
confidence: every fact live-API-confirmed 2026-06-10 unless tagged [INFERRED]/[DOCS]/[VERIFIED <date>]
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# ProWorkflow — API Rules

## Call (read first)

```
connectors(name="request", params={
  "connector":"proworkflow", "url":"/projects?status=all&pagesize=20&pagenumber=1", "method":"GET"})
```

- `url` is a FLAT relative path; backend expands against `https://api.proworkflow.net`. NO version segment (`/v1/...` does not exist).
- POST/PUT: pass JSON in `body`. Backend sets `Content-Type: application/json`.
- Backend injects BOTH auth mechanisms: `apikey` header (account, from company config) + `Authorization: Basic` (per-user email:password, from user vault). NEVER set `Authorization` or `apikey` yourself; you never see the secrets.
- HTTP only — there is no file-browse surface for this connector; all file ops go through `request`.

## Auth behavior

- Per-user permissions enforced by ProWorkflow ("View Work" rules) — same query returns different results per user.
- **403** = user lacks permission in ProWorkflow itself (not a Numa problem) → tell user to check their ProWorkflow access; do not retry.
- **401** = bad apikey OR bad password (indistinguishable). Body is EMPTY (no JSON). User re-enters ProWorkflow login.

## CAN

List/search/view: companies, contacts, projects, tasks, time, quotes, invoices, expenses, messages, notes, shared notes, events, files (metadata), project requests, workload/availability. Create: projects, tasks (single or bulk array), time, quotes, invoices, expenses, messages (discussions+replies), events, notes, shared notes, companies, contacts, project requests, files (base64). Update via PUT (partial). Delete most entities. Lifecycle: complete/reactivate projects+tasks, approve/decline/markaspending quotes, approve/decline project requests, markaspaid/markasunpaid invoices, start/stop task timers. Subtotals/totals (`subtotals=`) for time/invoices/quotes. Cheap change-polling: ETags (`If-None-Match`→304) + `lastmodifiedfrom=15n`. API-only custom fields (`settings/apifields`).

## CANNOT

Download file CONTENT via REST — file objects return a signed `link` to `app.proworkflow.com/...getfilesattached.cfm?...sec_key=...`; fetch that URL directly (REST `?content=true` works only ≤1 MB). See items the user can't see in-app (server-side permission filter). Add/edit/delete across Divisions (Advanced; cross-division is read-only). Return >5,000 records/request (silent hard cap; keep ≤500). Receive webhooks into Numa (`settings/webhooks` exists but no Numa receiver — poll with `lastmodifiedfrom`). Bulk update (one PUT per item). Bulk create except companies/contacts/tasks/quote+invoice lines.

## Gotchas

1. `pagesize` and `pagenumber` MUST be sent together. One alone → 400 `"pagesize and pagenumber must both be provided in order to use paging"`.
2. Task `contacts` is a COMMA-STRING, not an array: `"me"`, `"1,2"`, `"all"`, `"allstaff"`, `"none"`. Array (e.g. `[{"id":"me"}]`) → HTTP **500** with bare-string `details`. Same string convention for `staff`/`clients`/`contractors`/`prerequisites`/`files`/`taskid` (bulk delete).
3. Time duration field is `timetracked` (MINUTES). `timeminutes` does NOT exist. Valid combos: `starttime`+`endtime` | `starttime`+`timetracked` | `endtime`+`timetracked` | `timetracked` alone (ends now).
4. Action endpoints are **PUT** with body `{}` (optional date): `/tasks/{id}/complete`, `/reactivate`, `/projects/{id}/complete`, `/quotes/{id}/approve`, `/invoices/{id}/markaspaid`, timers. Bulk task delete is `PUT /tasks/delete` (not DELETE).
5. Message create requires `title` (NOT `subject`) + `contacts` + (`projectid` or `taskid`) for a new discussion, or `originalmessageid` for a reply.
6. Relative dates everywhere: `+1w`, `-2d`, `+1m`, and `15n` for lastmodified — **`n` = minutes, NOT months** (suffixes n/h/d/w/m/y).
7. `me` substitutes the requesting user's contact id in `contacts`/`contactid`/`managerid`.
8. Error `details` is usually an array of strings but can be a BARE STRING on 500s; strings may embed HTML (`<ul><li>...`). Parse defensively.
9. Unknown paths return an HTML 404 page, NOT JSON. If a response won't parse as JSON, you hit a non-existent endpoint.
10. List envelope keyed by collection name: `{"count":N,"totalcount":M,"status":"Success","<collection>":[...]}` — key matches the URL tail EXCEPT `/time` → `"timerecords"`. time/invoices/quotes also add a `total` field.
11. Writes return `details` ALWAYS an array: POST→201 `{"message":"X Added","status":"Success","details":[{"id":N}]}`; PUT/DELETE→200 same shape. New IDs come from `details`.
12. Lists default to OPEN records only: projects/tasks default `status=active`, quotes `status=pending`, invoices `status=unpaid`, `/time` `trackedfrom=-6d`. Pass `status=all` / explicit dates to search history.
13. PUT is partial, but an EMPTY value (`""`) CLEARS the field. Send only fields you change; never echo a full GET back; never send `""` unless erasing.
14. `/workload` `datefrom` must be today or later — past dates → 400.
15. Deletes cascade: DELETE project → deletes all its tasks/files/messages/time; DELETE task (or `PUT /tasks/delete`) → deletes its files/messages/time; DELETE company → deletes its contacts by default (`deletecontacts=false` to keep). Confirm with user before deleting.
16. Notes: company/contact notes (`/companies/{id}/notes`, `/contacts/{id}/notes`) require `content` (`title` optional) → 400 `"'content' is a required field"` without it. General `/notes` require `title`, `content`, `categoryid`.

## Defaults (override only if user specifies)

`pagesize=20&pagenumber=1` (always page; mandatory pair), `status=all` when searching history (gotcha 12), `fields` omitted (defaults are sensible; add `fields=` to trim), `sortorder=desc` for recency questions, `contacts`/`contactid=me` for "my work".

## Operations

| Operation                   | Method         | Path                                                                                                                                                             | Key params / notes                                                                                      |
| --------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| List companies              | GET            | /companies                                                                                                                                                       | search, type (client/contractor/staff/other); also /companies/client etc.                               |
| Company sub-data            | GET            | /companies/{id}/projects, /tasks, /time, /invoices, /quotes, /contacts, /notes, /summary                                                                         | scoped views                                                                                            |
| Create company              | POST           | /companies                                                                                                                                                       | name, type (REQUIRED); array=bulk                                                                       |
| List contacts               | GET            | /contacts                                                                                                                                                        | searchname, type, companyid; `me` invalid here — use /me                                                |
| Current user                | GET            | /me                                                                                                                                                              | id, type, plan, company                                                                                 |
| List projects               | GET            | /projects                                                                                                                                                        | status (active default), companyid, managerid, contacts, search, duedatefrom/to, lastmodifiedfrom       |
| Get/edit/delete project     | GET/PUT/DELETE | /projects/{id}                                                                                                                                                   | DELETE cascades to tasks                                                                                |
| Create project              | POST           | /projects                                                                                                                                                        | title + companyid (REQUIRED); managerid("me"), startdate, duedate; returns id AND number "P-xxxx"       |
| Complete/reactivate project | PUT            | /projects/{id}/complete, /reactivate                                                                                                                             | completedate optional; complete also completes active tasks                                             |
| List tasks                  | GET            | /tasks                                                                                                                                                           | status (active default), projectid, contacts("me"), duedatefrom/to, type                                |
| Create task(s)              | POST           | /tasks                                                                                                                                                           | name + projectid (or categoryid); contacts comma-string; array=bulk same project                        |
| Complete/reactivate task    | PUT            | /tasks/{id}/complete, /reactivate                                                                                                                                | completedate optional, body {} OK                                                                       |
| Task timers                 | PUT            | /tasks/{id}/starttimer, /stoptimer                                                                                                                               | notes optional; start stops any other running timer                                                     |
| Bulk delete tasks           | PUT            | /tasks/delete                                                                                                                                                    | taskid:"1,2,3" (same project); cascades — confirm first                                                 |
| Time / totals               | GET            | /time                                                                                                                                                            | trackedfrom (-6d default), trackedto, contacts, projectid, subtotals; collection key="timerecords"      |
| Add time                    | POST           | /time or /tasks/{id}/time                                                                                                                                        | taskid (on /time), timetracked (minutes), contactid "me"; combos in gotcha 3                            |
| Active timers               | GET            | /time/activetimers                                                                                                                                               | —                                                                                                       |
| List/create quotes          | GET/POST       | /quotes                                                                                                                                                          | status (pending default), type; create: title, contactid, lines[] (heading/lineitem/taskrate/staffrate) |
| Quote lifecycle             | PUT            | /quotes/{id}/approve, /decline, /markaspending                                                                                                                   | approveddate, projectid optional; markaspending reverts                                                 |
| List/create invoices        | GET/POST       | /invoices                                                                                                                                                        | status (unpaid default); create: title, companyid, contactid, lines[]; /invoices/overdue shortcut       |
| Invoice paid state          | PUT            | /invoices/{id}/markaspaid, /markasunpaid                                                                                                                         | paiddate optional                                                                                       |
| List/create expenses        | GET/POST       | /expenses                                                                                                                                                        | create: projectid, name, cost (REQUIRED)                                                                |
| List/create events          | GET/POST       | /events                                                                                                                                                          | create: title, starttime, endtime; contacts "me"; ISO8601 yyyy-mm-ddThh:mm                              |
| List/create messages        | GET/POST       | /messages                                                                                                                                                        | create: title, contacts + projectid/taskid; reply: originalmessageid; files=fileid/s to attach          |
| General notes               | GET/POST       | /notes                                                                                                                                                           | create: title, content, categoryid                                                                      |
| Entity notes                | POST           | /companies/{id}/notes, /contacts/{id}/notes                                                                                                                      | content REQUIRED, title optional                                                                        |
| Shared notes                | GET/POST       | /sharednotes                                                                                                                                                     | create: projectid, title                                                                                |
| List files / metadata       | GET            | /files, /files/{id}                                                                                                                                              | projectid, search, datefrom; content via signed `link` (REST ?content=true ≤1 MB)                       |
| Upload file                 | POST           | /files                                                                                                                                                           | name, content (base64), + exactly one of projectid/taskid/folderid                                      |
| Project requests            | GET/POST       | /projectrequests                                                                                                                                                 | create: title (REQUIRED)                                                                                |
| Approve/decline request     | PUT            | /projectrequests/{id}/approve, /decline                                                                                                                          | number, clientaccess optional; approve creates a project                                                |
| Workload / availability     | GET            | /workload                                                                                                                                                        | datefrom (TODAY+), dateto, contacts, mode=availability; minutes/day per contact                         |
| Settings & taxonomies       | GET            | /settings/projects/categories, /settings/tasks/categories, /settings/notes/categories, /settings/projects/customstatuses, /settings/\*/tags, /settings/apifields | IDs for categoryid/tagid/customstatusid                                                                 |

## Pagination

Page-number, 1-based. `pagesize`+`pagenumber` MUST be sent together. No default (omitting both returns up to the 5,000 cap). Recommend 20-100/page, never >500. Last page when `pagenumber*pagesize >= totalcount` or `count < pagesize`. Keep `sortby`/`sortorder` constant across pages. Every GET returns an `etag` header — resend as `If-None-Match` → 304 (empty body) when unchanged.

## Errors

Body shapes (parse defensively): 4xx → `{"status":"Error","details":["..."]}` (array of strings); some 500s → `details` is a BARE STRING ("An unidentified error occurred..."); 401 → EMPTY body; unknown path → HTML 404 page. Strings may embed HTML — strip tags before showing.
Recovery: 400 fix params per `details` (paging pair, required fields, time combos, date ranges) · 401 surface "credentials invalid", user re-enters (no retry) · 403 user's ProWorkflow permissions deny — tell user (no retry) · 404 verify numeric id (not P-xxxx); if HTML, fix the path · 429 wait `x-ratelimit-reset` s then retry (≤3) · 500 if malformed body (e.g. array `contacts`) FIX request — retry useless; else backoff (≤2). Never blind-retry non-idempotent writes (POST creates, `adjustdates`) on timeout — check whether it landed first.

## Examples

1. A company's active projects:
   `GET /projects?companyid=8&status=active&fields=title,number,company,startdate,duedate,percentcomplete&pagesize=20&pagenumber=1`
   → `{"count":1,"totalcount":1,"status":"Success","projects":[{"id":6,"number":"P-0103","title":"Website Refresh","companyid":8,"companyname":"Astra Legal","startdate":"2026-06-10T00:00:00","duedate":"2026-06-24T00:00:00","percentcomplete":0}]}`

2. Create a task for the current user (`POST /tasks`):
   `{"projectid":6,"name":"Draft homepage copy","contacts":"me","startdate":"+0d","duedate":"+1w","priority":2}`
   → `{"message":"Task/s Added","status":"Success","details":[{"id":14,"name":"Draft homepage copy"}]}`. `contacts` is a comma-string — an array → 500.

3. Log 30 min against a task then complete it:
   `POST /tasks/14/time` `{"contactid":"me","timetracked":30,"notes":"Drafted copy"}`
   → `{"message":"Time Record Added","status":"Success","details":[{"id":21}]}`
   `PUT /tasks/14/complete` `{}`
   → `{"message":"Task Completed","status":"Success","details":[{"id":14}]}`
