---
api_name: 'ProWorkflow'
api_slug: 'proworkflow'
version: 'current (unversioned REST API)'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-06-10'
update_source: 'live API testing (trial account, Advanced plan)'
line_count_target: '< 300 lines'
---

# ProWorkflow -- Workspace Agent API Rules

> **This file is loaded into the workspace agent's context when the ProWorkflow integration is active.**
> It must stay under 300 lines. Be precise, not verbose.
> Companion file `01a-domain-model-reference.md` contains the entity catalog, relationships, and state machines.

## Context

- **API:** ProWorkflow REST API (project/task/time management)
- **Base URL:** `https://api.proworkflow.net` (HTTPS mandatory)
- **Auth:** Dual mechanism -- Basic auth + `apikey` header. **Both injected automatically by Numa. Never set them.**
- **Integration path:** Data Connector -- call via the `connectors` MCP tool, `request` operation
- **Rate limits:** 500 requests / 30s per API key. `x-ratelimit-limit/-remaining/-reset` headers on every response; 429 on breach [CONFIRMED -- live API test 2026-06-10]
- **Field casing:** all-lowercase, no separators (`companyid`, `startdate`, `lastmodified`)
- **ID format:** integer. Projects ALSO have a display `number` (e.g. `"P-0103"`) distinct from `id` [CONFIRMED -- live API test 2026-06-10]

## How to Call

```
connectors(name="request", params={
  "connector": "proworkflow",
  "url": "/projects?status=all&pagesize=20&pagenumber=1",
  "method": "GET"
})
```

- Relative `url` expands against `https://api.proworkflow.net`.
- POST/PUT: pass the JSON payload in `body`. `Content-Type: application/json` is handled by the backend.
- **NEVER set `Authorization` or `apikey` headers.** The Numa backend injects Basic auth (user's vaulted ProWorkflow email+password) and the account `apikey` (company config) on every request. You never see credentials.

## Auth Structure

Two mandatory mechanisms per request, both injected by Numa -- show requests WITHOUT auth headers.

- **Per-user permissions are enforced by ProWorkflow.** A user has exactly the permissions they have in the main app ("View Work" permissions). The same query returns different results for different users.
- **403** = the user lacks permission in ProWorkflow itself -- not a Numa problem. Tell the user to check their ProWorkflow access.
- **401** = credentials invalid (bad password or API key). Body is EMPTY -- no JSON to parse [CONFIRMED -- live API test 2026-06-10]. The user should re-enter their ProWorkflow login.

## Capabilities

### CAN

1. List/search/view: companies, contacts, projects, tasks, time records, quotes, invoices, expenses, messages, notes, shared notes, events, files (metadata), project requests, workload/availability
2. Create: projects, tasks (single or bulk), time records, quotes, invoices, expenses, messages (discussions + replies), events, notes, shared notes, companies, contacts, project requests, files (base64 upload)
3. Update via PUT (partial -- only fields you send change), delete most entities
4. Lifecycle actions: complete/reactivate projects and tasks, approve/decline/re-pend quotes, approve/decline project requests, mark invoices paid/unpaid, start/stop task timers
5. Subtotals/totals for time, invoices, quotes (`subtotals=` parameter)
6. Cheap change-polling: ETags (`If-None-Match` → 304) and `lastmodifiedfrom=15n` relative filters [CONFIRMED -- live API test 2026-06-10]
7. API-only custom fields (`settings/apifields`) + Advanced-plan custom fields on projects

### CANNOT

1. Download file CONTENT via the REST API -- file objects return a signed `link` to `app.proworkflow.com` (getfilesattached.cfm with `sec_key`); fetch that URL directly [CONFIRMED -- live API test 2026-06-10]
2. See items the user can't see in the ProWorkflow app (server-side permission filtering)
3. Add/edit/delete items in another Division (Advanced plan -- API is read-only cross-division)
4. Return more than 5,000 records per request (hard cap; keep requests ≤500)
5. Receive webhooks into Numa -- `settings/webhooks` exists but there is no Numa receiver; poll with `lastmodifiedfrom` instead

## Critical Gotchas

1. **`pagesize` and `pagenumber` MUST be used together.** One without the other → 400 `"pagesize and pagenumber must both be provided in order to use paging"`. [CONFIRMED -- live API test 2026-06-10]
2. **Task `contacts` is a COMMA-SEPARATED STRING, not an array.** Use `"me"`, `"1,2"`, `"allstaff"`. Sending `[{"id": "me"}]` → HTTP 500 with bare-string details. Same string convention for `staff`/`clients`/`contractors` on projects. [CONFIRMED -- live API test 2026-06-10]
3. **Time duration field is `timetracked` (MINUTES).** `timeminutes` does not exist. Valid combos: `starttime`+`endtime`, `starttime`+`timetracked`, `endtime`+`timetracked`, or `timetracked` alone (ends now). [CONFIRMED -- live API test 2026-06-10]
4. **Complete a task = `PUT /tasks/{id}/complete` with body `{}`** (optional `completedate`). There is no status field to PUT. Same pattern: `/projects/{id}/complete`, `/reactivate`, `/quotes/{id}/approve`, `/invoices/{id}/markaspaid`. [CONFIRMED -- live API test 2026-06-10]
5. **Message create requires `title` (NOT `subject`) and `contacts`** plus `projectid` or `taskid` (new discussion) or `originalmessageid` (reply). [CONFIRMED -- live API test 2026-06-10]
6. **Relative dates work everywhere dates are accepted:** `+1w`, `-2d`, `+1m`, and `15n` for lastmodified filters -- **`n` = minutes, NOT months** (suffixes n/h/d/w/m/y). [CONFIRMED -- live API test 2026-06-10]
7. **`me` substitutes for the requesting user's contact id** in `contacts`/`contactid`/`managerid` params -- use it for "my tasks", adding time, assigning work. [CONFIRMED -- live API test 2026-06-10]
8. **Error `details` is usually an array of strings but can be a BARE STRING on 500s** ("An unidentified error occurred..."). Some error strings contain embedded HTML (`<ul><li>...`). Parse defensively. [CONFIRMED -- live API test 2026-06-10]
9. **Unknown paths return an HTML 404 page, NOT JSON.** If the response doesn't parse as JSON, you hit a non-existent endpoint. [CONFIRMED -- live API test 2026-06-10]
10. **List envelope is keyed by collection name** -- `{"count": N, "totalcount": M, "status": "Success", "<collection>": [...]}`. The key matches the URL tail, EXCEPT `/time` which returns `"timerecords"`. time/invoices/quotes also add a `total` field. [CONFIRMED -- live API test 2026-06-10]
11. **Writes return `details` as an ALWAYS-an-array:** POST → 201 `{"message": "X Added", "status": "Success", "details": [{"id": N}]}`; PUT/DELETE → 200, same shape. New-item IDs come from `details`. [CONFIRMED -- live API test 2026-06-10]
12. **Lists default to ACTIVE/open records only:** projects & tasks default `status=active`, quotes default `status=pending`, invoices default `status=unpaid`, `/time` defaults `trackedfrom=-6d`. Pass `status=all` (or explicit dates) when searching history. [CONFIRMED -- live API test 2026-06-10]
13. **PUT is a partial update, but an empty value CLEARS the field.** Omit fields you don't want to change; never send `""` unless you mean to erase.
14. **`/workload` `datefrom` must be today or later** -- past dates → 400. [CONFIRMED -- live API test 2026-06-10]
15. **Deletes cascade:** DELETE a project deletes all its tasks; deleting a task (or bulk `PUT /tasks/delete`) deletes its files, messages, and time records. Confirm with the user before deleting. [CONFIRMED -- live API test 2026-06-10]
16. **Notes on companies/contacts require `content`** (`title` optional): `POST /companies/{id}/notes` → 400 `"'content' is a required field"` without it. Standalone `/notes` (general notes) instead require `title`, `content`, `categoryid`. [CONFIRMED -- live API test 2026-06-10]

## Default Parameters

Use these defaults unless the user specifies otherwise:

| Parameter           | Default                  | Reason                                                  |
| ------------------- | ------------------------ | ------------------------------------------------------- |
| pagesize&pagenumber | `pagesize=20&pagenumber=1` | Always page; the two params are mandatory together     |
| status              | `all` when searching     | Lists default to active/pending/unpaid only (gotcha 12) |
| fields              | (omit)                   | Default field sets are sensible; add `fields=` to trim  |
| sortby / sortorder  | endpoint default, `desc` for recency questions | e.g. `sortby=duedate&sortorder=asc` for "what's due" |
| contacts / contactid| `me`                     | Most "my work" questions scope to the requesting user   |

## Working Examples

### Example 1: List a company's active projects [CONFIRMED -- live API test 2026-06-10]

```
connectors(name="request", params={"connector": "proworkflow", "method": "GET",
  "url": "/projects?companyid=8&status=active&fields=title,number,company,startdate,duedate,percentcomplete&pagesize=20&pagenumber=1"})
```

```json
{
  "count": 1, "totalcount": 1, "status": "Success",
  "projects": [
    { "id": 6, "number": "P-0103", "title": "Website Refresh", "companyid": 8,
      "companyname": "Astra Legal", "startdate": "2026-06-10T00:00:00",
      "duedate": "2026-06-24T00:00:00", "percentcomplete": 0 }
  ]
}
```

### Example 2: Create a task assigned to the current user [CONFIRMED -- live API test 2026-06-10]

```
connectors(name="request", params={"connector": "proworkflow", "method": "POST", "url": "/tasks",
  "body": {"projectid": 6, "name": "Draft homepage copy", "contacts": "me",
           "startdate": "+0d", "duedate": "+1w", "priority": 2}})
```

```json
{ "message": "Task/s Added", "status": "Success", "details": [{ "id": 14, "name": "Draft homepage copy" }] }
```

Note: `contacts` is a comma-string (`"me"`, `"1,2"`, `"allstaff"`). An array here → 500.

### Example 3: Log 30 minutes against a task, then complete it [CONFIRMED -- live API test 2026-06-10]

```
connectors(name="request", params={"connector": "proworkflow", "method": "POST", "url": "/tasks/14/time",
  "body": {"contactid": "me", "timetracked": 30, "notes": "Drafted copy"}})
```

```json
{ "message": "Time Record Added", "status": "Success", "details": [{ "id": 21 }] }
```

```
connectors(name="request", params={"connector": "proworkflow", "method": "PUT",
  "url": "/tasks/14/complete", "body": {}})
```

```json
{ "message": "Task Completed", "status": "Success", "details": [{ "id": 14 }] }
```

## Proxy API Operations

| Operation                | Method | Path                                  | Key Parameters                                        | Notes                                       |
| ------------------------ | ------ | ------------------------------------- | ----------------------------------------------------- | ------------------------------------------- |
| List companies           | GET    | /companies                            | search, type (client/contractor/staff/other)          | Also /companies/client etc. shortcuts        |
| Company sub-data         | GET    | /companies/{id}/projects, /tasks, /time, /invoices, /quotes, /contacts, /notes, /summary | same filters as top-level | Scoped convenience views |
| Create company           | POST   | /companies                            | name, type (REQUIRED)                                 | Accepts array for bulk                       |
| List contacts            | GET    | /contacts                             | searchname, type, companyid                           | `me` not valid here; use /me                 |
| Current user             | GET    | /me                                   | --                                                    | id, type, plan, company [CONFIRMED]          |
| List projects            | GET    | /projects                             | status (active default), companyid, managerid, contacts, search, duedatefrom/to, lastmodifiedfrom | Rich filters [CONFIRMED] |
| Get/edit/delete project  | GET/PUT/DELETE | /projects/{id}                | --                                                    | DELETE cascades to tasks [CONFIRMED]         |
| Create project           | POST   | /projects                             | title + companyid (REQUIRED); managerid ("me"), startdate, duedate | Returns id AND number "P-xxxx" [CONFIRMED] |
| Complete / reactivate    | PUT    | /projects/{id}/complete, /reactivate  | completedate optional                                 | Complete also completes active tasks         |
| List tasks               | GET    | /tasks                                | status, projectid, contacts ("me"), duedatefrom/to, type | Defaults to active [CONFIRMED]            |
| Create task/s            | POST   | /tasks                                | name + projectid (or categoryid); contacts comma-string | Array body for bulk; same projectid        |
| Complete / reactivate    | PUT    | /tasks/{id}/complete, /reactivate     | completedate optional, body {} OK                     | [CONFIRMED]                                  |
| Task timers              | PUT    | /tasks/{id}/starttimer, /stoptimer    | notes optional                                        | Start stops any other running timer          |
| Bulk delete tasks        | PUT    | /tasks/delete                         | taskid: "1,2,3" (same project)                        | Cascades files/messages/time -- confirm first|
| Time records / totals    | GET    | /time                                 | trackedfrom (default -6d), trackedto, contacts, projectid, subtotals | Collection key = "timerecords" [CONFIRMED] |
| Add time record          | POST   | /time or /tasks/{id}/time             | taskid (on /time), timetracked (minutes), contactid "me" | See gotcha 3 combos [CONFIRMED]           |
| Active timers            | GET    | /time/activetimers                    | --                                                    |                                              |
| List/create quotes       | GET/POST | /quotes                             | status (pending default), type; create: title, contactid, lines[] | Line types: heading/lineitem/taskrate/staffrate |
| Quote lifecycle          | PUT    | /quotes/{id}/approve, /decline, /markaspending | approveddate, projectid optional             | markaspending reverts                        |
| List/create invoices     | GET/POST | /invoices                           | status (unpaid default); create: title, companyid, contactid, lines[] | /invoices/overdue shortcut          |
| Invoice paid state       | PUT    | /invoices/{id}/markaspaid, /markasunpaid | paiddate optional                                  |                                              |
| List/create expenses     | GET/POST | /expenses                           | create: projectid, name, cost (REQUIRED)              |                                              |
| List/create events       | GET/POST | /events                             | create: title, starttime, endtime; contacts "me"      | ISO8601 yyyy-mm-ddThh:mm                     |
| List/create messages     | GET/POST | /messages                           | create: title, contacts + projectid/taskid; reply: originalmessageid | files=fileid/s to attach      |
| General notes            | GET/POST | /notes                              | create: title, content, categoryid (settings/notes/categories) |                                     |
| Entity notes             | POST   | /companies/{id}/notes, /contacts/{id}/notes | content (REQUIRED), title optional              | [CONFIRMED]                                  |
| Shared notes             | GET/POST | /sharednotes                        | create: projectid, title                              | Project-visible notes                        |
| List files / metadata    | GET    | /files, /files/{id}                   | projectid, search, datefrom                           | Content via signed `link` only [CONFIRMED]   |
| Upload file              | POST   | /files                                | name, content (base64), + exactly one of projectid/taskid/folderid |                                  |
| Project requests         | GET/POST | /projectrequests                    | create: title (REQUIRED)                              |                                              |
| Approve/decline request  | PUT    | /projectrequests/{id}/approve, /decline | number, clientaccess optional                       | Approve creates a project                    |
| Workload / availability  | GET    | /workload                             | datefrom (TODAY+), dateto, contacts, mode=availability | Minutes/day per contact [CONFIRMED]         |
| Settings & taxonomies    | GET    | /settings/projects/categories, /settings/tasks/categories, /settings/notes/categories, /settings/projects/customstatuses, /settings/*/tags, /settings/apifields | -- | IDs for categoryid/tagid/customstatusid |

## Pagination [CONFIRMED -- live API test 2026-06-10]

- **Type:** page-number based -- `pagesize` + `pagenumber` (1-based), BOTH required together
- **Default:** no paging (returns up to 5,000-record cap) -- always pass both
- **Recommended page size:** 20-100; never design for >500 records per request

```
GET /tasks?status=all&pagesize=20&pagenumber=2   (records 21-40)
```

- **Last page detection:** compare `count` (returned) and `pagesize * pagenumber` against `totalcount`
- **Cache hint:** every GET returns an `etag` header; resend as `If-None-Match` → 304 with empty body when unchanged

## Error Handling

**Standard error format** (when JSON is returned at all):

```json
{ "status": "Error", "details": ["pagesize and pagenumber must both be provided in order to use paging"] }
```

`details` is an array of strings on 400s, but a BARE STRING on most 500s; strings may embed HTML. 401 returns an EMPTY body. Unknown paths return an HTML 404 page. [CONFIRMED -- live API test 2026-06-10]

**Recovery by status:**

| Status | Meaning                              | Action                                                          |
| ------ | ------------------------------------ | --------------------------------------------------------------- |
| 400    | Bad request / validation             | Read `details`; fix params (paging pair, required fields, date ranges) |
| 401    | API key or username/password invalid | EMPTY body. User must re-enter ProWorkflow credentials           |
| 403    | ProWorkflow permissions deny it      | Tell user to check their access in ProWorkflow; do not retry     |
| 404    | Item doesn't exist (JSON) / endpoint doesn't exist (HTML) | Verify ID; if HTML came back, fix the path  |
| 429    | Rate limit (500 req/30s)             | Wait `x-ratelimit-reset` seconds, retry                          |
| 500    | Server error                         | `details` may be a bare string. Usually a malformed body (e.g. array where comma-string expected) -- fix shape before retrying |

## Known Limitations

1. No REST file-content download -- only the signed `app.proworkflow.com` link returned in file objects
2. 5,000-record hard cap per request; 500 req/30s rate limit per API key (shared by all Numa users on the account key)
3. No webhook receiver in Numa -- poll with `lastmodifiedfrom` (+ ETags) for change detection
4. Bulk POST only for companies, contacts, tasks, and quote/invoice lines; everything else is single-record
5. Advanced-plan-only features (divisions, teams/groups, custom fields/statuses, internal projects) 404/400 on lower plans
6. Trial/sample data quirks: deleted sample projects may be referenced by files but absent from `/projects?status=all` [CONFIRMED -- live API test 2026-06-10]

---

_Generated from investigation questionnaire + live API testing 2026-06-10. See companion file:_

- _01a-domain-model-reference.md -- Entity catalog, relationships, state machines_
