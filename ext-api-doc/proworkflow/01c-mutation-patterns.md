---
api_name: ProWorkflow
api_slug: proworkflow
base_url: https://api.proworkflow.net
call_surface: HTTP via connectors(name="request", params={connector:"proworkflow", url, method:"POST|PUT|DELETE", body:{...}}) — flat relative path, no version segment; backend injects apikey + Basic auth + Content-Type (never set them)
doc: mutation patterns — create, update, delete, state transitions, lines, timers, API custom fields (companion to 01)
confidence: every fact live-API-confirmed 2026-06-10 unless tagged [INFERRED]/[DOCS]
---

# ProWorkflow — Mutation Patterns

> Examples show bare relative paths + JSON bodies. `POST /x {body}` ⇒ `connectors(name="request", params={connector:"proworkflow", url:"/x", method:"POST", body:{...}})`.

## Write Capabilities

| Operation         | Supported | Method | Notes                                                                                |
| ----------------- | --------- | ------ | ------------------------------------------------------------------------------------ |
| Create            | Yes       | POST   | 201 + `details` array (always an array, even one item)                               |
| Full replace      | No        | —      | PUT is always partial                                                                |
| Partial update    | Yes       | PUT    | only send changed fields. **An empty value CLEARS the field**                        |
| Delete            | Yes       | DELETE | single item; several cascade (project delete removes its tasks etc.)                 |
| Soft delete       | No        | —      | deletes are hard; "complete" status is the reversible alternative                    |
| Bulk create       | Limited   | POST   | companies, contacts, tasks, invoice/quote lines accept an ARRAY body                 |
| Bulk update       | No        | —      | one PUT per item                                                                     |
| Bulk delete       | Limited   | PUT    | `PUT /tasks/delete` with `taskid` list (same project only) — note PUT!               |
| State transitions | Yes       | PUT    | `complete`, `reactivate`, `approve`, `decline`, `markaspaid`, timers, ...            |
| File upload       | Partial   | POST   | `/files` metadata via API; content via signed app links (REST `?content=true` ≤1 MB) |

## Three Success Shapes

```
POST  → 201  {"message":"Project/s Added","status":"Success","details":[{"id":6,"number":"P-0103","title":"..."}]}
PUT   → 200  {"message":"Contact Updated","status":"Success","details":[{"id":393}]}
DELETE→ 200  {"message":"Contact Deleted","status":"Success","details":[{"id":393}]}
```

`details` is ALWAYS an array on success — read `details[0].id` for single-item calls. Multi-item POSTs return one `details` entry per created item, in input order.

## PUT Semantics: Empty Value CLEARS the Field

PUTs are partial — omitted fields keep their values. **BUT any field included with an empty value (`""`) is WIPED.** No "send the whole object back" safety net: if you GET, tweak one field, and PUT the whole object back, every empty-string field stays empty and any field you blanked gets cleared.
Rules: (1) send ONLY fields you intend to change — never echo a full GET payload; (2) never send `""` unless erasing; (3) treat "clear the X" as deliberate — confirm, then send `{"x":""}`.
`PUT /contacts/393 {"mobilephone":"01234567890","workphone":""}` → mobilephone updated, **workphone erased** (only correct if erasing was the goal).

## Patterns

### 1. Create — Single Item

**Project (minimal confirmed body):**
`POST /projects {"title":"Website Refresh","companyid":8,"managerid":"me","startdate":"+0d","duedate":"+2w"}`
→ 201 `{"message":"Project/s Added","status":"Success","details":[{"id":6,"number":"P-0103","title":"Website Refresh"}]}`

- Required: `title` + `companyid` (external) — or `internalclientcontactid` (+ `internalclientgroupid` if that contact is in >1 group) for internal projects (Advanced).
- Project NUMBER (`P-0103`) and numeric `id` (6) are distinct — all API calls use the numeric `id`; the number is the human label.
- Optionals: `description`, `managerid` (default `me`), `staff`/`clients`/`contractors` (comma ID strings), `priority` (1-5), `number` (default `auto`), `categoryid`, `tagid`, `timeallocated` (minutes), `templateid` (Advanced), `customfields`/`apifields` (arrays of `{id,value}`). Setting `completedate` on create adds the project already-Completed (no alerts).

**Task (note the contacts format):**
`POST /tasks {"name":"Draft homepage copy","projectid":6,"contacts":"me","duedate":"+3d"}`
→ 201 `{"message":"Task/s Added","status":"Success","details":[{"id":12,"name":"Draft homepage copy"}]}`

- **`contacts` is a COMMA-STRING** — `"me"`, `"1,2"`, `"allstaff"`, `"all"`, `"none"`. An array of objects like `[{"id":"me"}]` → HTTP **500** with bare-string `details` ("An unidentified error occurred...").
- Provide `projectid` (project task) or `categoryid` (general task), or `templateid` to instantiate a task template.
- Optionals: `description`, `priority` (default 3), `startdate`, `duedate`, `billable` (default true), `taxable` (default true), `timeallocated` (minutes, default 0), `order`/`orderlevel`, `prerequisites` (task IDs, supports `newX` refs), `type` (`normal`/`bold`/`heading`), `tasklistid`, `tagid`.

**Time record (confirmed combos):**
`POST /time {"taskid":12,"contactid":"me","timetracked":30,"notes":"Initial draft"}`
→ 201 `{"message":"Time Added","status":"Success","details":[{"id":44}]}`

- Duration is **`timetracked` (minutes)**. There is NO `timeminutes` field.
- Valid combos (anything else → 400 listing these): `starttime`&`endtime` | `starttime`&`timetracked` | `endtime`&`timetracked` | `timetracked` alone (end=now, start computed).
- `starttime`/`endtime` take ISO8601 `yyyy-mm-ddThh:mm` or literal `now`. `contactid` defaults to `me`. A `date` field with `timetracked` also works: `{"contactid":"me","date":"2026-06-10","timetracked":30,"notes":"..."}` → 201.

**Message (`title`, NOT `subject`):**
`POST /messages {"projectid":6,"title":"Kickoff notes","content":"Agenda attached.","contacts":"me"}`

- New discussions require `title` + `contacts` (+ `projectid` or `taskid`); replies use `originalmessageid` instead. Attach files with `files` (IDs from the same project). Optionals: `notifications` (default true), `public` (default true).

**Note on a company (`content` required):**
`POST /companies/8/notes {"title":"Renewal context","content":"Contract renews in October; flag pricing early."}`

- Missing `content` → 400 `"'content' is a required field"`. `title` optional. Same shape for `/contacts/{id}/notes` and top-level `/notes`.

### 2. Create — Multiple Items (array body)

Supported for **companies, contacts, tasks**, and for **lines** on an invoice/quote. Send a JSON array instead of an object:
`POST /contacts [{"companyid":29,"firstname":"Adam","lastname":"West","email":"adam@abcmedia.com","type":"client"},{"companyid":29,"firstname":"Amy","lastname":"West","email":"amy@abcmedia.com","type":"client"}]`
→ 201 `{"message":"Contact/s Added","status":"Success","details":[{"id":393,"name":"Adam West"},{"id":394,"name":"Amy West"}]}`

- Multi-task constraint: all tasks in one batch share the same `projectid` (or `categoryid`) and the same `order` option (or explicit order numbers). With `auto`/`after`/`before` ordering they insert in array order.

### 3. Update (PUT, partial)

`PUT /contacts/393 {"mobilephone":"01234567890","workphone":"09876543210"}`
→ 200 `{"message":"Contact Updated","status":"Success","details":[{"id":393}]}`

- Only included fields change; omitted keep values. **Empty value (`""`) clears the field** (see warning above).
- Time edits support the same `starttime`/`endtime`/`timetracked` combos as create, plus single-field variants (e.g. `timetracked` alone recomputes end from the existing start).
- Immutable on edit: a message's `title`/`content` (only contacts/notifications/public editable); a webhook's `event`; an API Field's `type`.
- Editing a company's `type` also converts all its contacts (only possible when none are assigned to projects/tasks).

### 4. Delete (and cascades)

`DELETE /contacts/393` → 200 `{"message":"Contact Deleted","status":"Success","details":[{"id":393}]}`

| Call                              | Cascades                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DELETE /projects/{id}`           | deletes ALL the project's Tasks, Files, Messages & Time Records                                                                                            |
| `DELETE /companies/{id}`          | `deletecontacts` defaults **true** — contacts deleted too. Pass `deletecontacts=false` to keep them (then reassign them to a company or they're unusable)  |
| `PUT /tasks/delete`               | bulk task delete (body `{"taskid":"1,2,3"}`, same project only) — deletes the tasks' Files, Messages & Time Records. **Method is PUT, path /tasks/delete** |
| `DELETE /messages/{id}`           | deleting the FIRST message of a discussion deletes the entire thread; only your own messages can be deleted                                                |
| `DELETE /settings/apifields/{id}` | removes the field everywhere; recovery requires ProWorkflow support                                                                                        |

All deletes are hard — no undo via the API.

### 5. State Transitions (action endpoints — all PUT)

ProWorkflow uses **PUT** (not POST) for action endpoints. Most accept an empty body `{}`.

**Complete / reactivate a task:** `PUT /tasks/12/complete {}` → 200 "Task Completed". Optional `{"completedate":"2026-06-09"}` (defaults now). Reverse: `PUT /tasks/12/reactivate`.
**Complete / reactivate a project:** `PUT /projects/6/complete {"completedate":"+0d"}` — also completes ALL active tasks. Reverse: `PUT /projects/6/reactivate`.
**Invoice paid status:** `PUT /invoices/55/markaspaid {"paiddate":"2026-06-10"}` (paiddate optional, defaults now); `PUT /invoices/55/markasunpaid {}`.
**Quote lifecycle:** `PUT /quotes/9/approve {"approveddate":"2026-06-10","projectid":6}` (both optional; projectid attaches the quote to a project); `PUT /quotes/9/decline {}`; `PUT /quotes/9/markaspending {}` (reverts an approved/declined quote). Approve/decline are done by a staff user on behalf of the client.
**Project request triage:** `PUT /projectrequests/3/approve {"number":"auto","clientaccess":true}` (optionals; creates the project); `PUT /projectrequests/3/decline {}`. Solo/Professional: approver becomes PM; Advanced: goes to the contact the request was submitted to.
**Adjust dates (NOT idempotent):**
`PUT /projects/6/adjustdates {"adjustment":"+1w","dates":"all","tasks":"active","taskdates":"all"}`
`PUT /tasks/12/adjustdates {"adjustment":"-3d","dates":"due"}`

- `adjustment` is `+/-Xd/w/m/y`: positive defers, negative advances. Project variant: `dates` (project's own: `all`/`start`/`due`, omit to leave alone), `tasks` (`all`/`active`/`complete`), `taskdates` (`all`/`start`/`due`).
- **NOT idempotent** — running twice shifts dates twice; docs warn about accidental re-runs. Never retry on timeout without checking state first.
  **Timers:** `PUT /tasks/12/starttimer {"notes":"Working on copy"}` (STOPS any other running timer); `PUT /tasks/12/stoptimer {"notes":"Done for now"}`; `PUT /time/44/stoptimer {}` (stop by time-record id).
- `GET /time/activetimers` lists running timers (`timetrackedseconds` + whole-minute `timetracked`). Stopping a timer fires BOTH `stoptimer` AND `newtime` webhook events — de-duplicate if you subscribe to both.
  **Assign / unassign task contacts:** `PUT /tasks/12/contacts {"contacts":"1,2"}` (add); `PUT /tasks/12/contacts {"contacts":"1,2","remove":true}` (remove). Project tasks can only be assigned contacts already on the project; general tasks accept staff only.

### 6. Quotes & Invoices with Line Items

`POST /quotes {"title":"Website Refresh Quote","number":"auto","contactid":504,"projectid":6,"lines":[{"type":"heading","name":"Design"},{"type":"lineitem","name":"Homepage design","quantity":1,"rate":1200.00,"taxable":true},{"type":"taskrate","name":"Development","time":480,"rate":150.00,"taxable":true},{"type":"staffrate","name":"Amy West","time":120,"rate":100.00,"taxable":false}]}`

Line type rules (quotes AND invoices):
| `type` | Required | Notes |
| --- | --- | --- |
| `heading` | `name` | section header, no amount |
| `lineitem` | `name` or `description`, `quantity`, `rate` | quantity × rate |
| `taskrate` | `name`, `time`, `rate` | `rate` = cost per HOUR, `time` = MINUTES |
| `staffrate` | `name`, `time`, `rate` | `rate` = cost per HOUR, `time` = MINUTES |
| `expense` | `name`, `quantity`, `rate` | invoices only |

**Hour/minute split is a classic mistake:** `rate` is per hour, `time` is minutes. A 2-hour task at $150/hr is `{"time":120,"rate":150.00}` → $300.
**Invoice create** is the same shape via `POST /invoices` with required `companyid`, `contactid`, `lines` (plus optional `title`, `number:"auto"`, `description`, `projectid`).
Add/edit/delete lines after creation: `POST /quotes/9/lines` (single object or array; `displayorder`: auto|afterN|beforeN|number); `PUT /quotes/9/lines/101 {"rate":110.00,"taxable":false}`; `DELETE /quotes/9/lines/101`. Identical sub-resources at `/invoices/{id}/lines[/{lineid}]`.

### 7. API Custom Fields (settings/apifields)

Extra fields bolted onto core types — **visible ONLY via the API, never in the ProWorkflow app UI**. Types: `company`, `contact`, `invoice`, `project` (covers project requests too), `quote`, `task`, `time`.

1. Create (once per account): `POST /settings/apifields {"name":"crm_sync_id","type":"project","private":true}` → 201 `{"message":"Field Added","status":"Success","details":[{"id":3,"name":"crm_sync_id"}]}`. Names unique per type. `private:true` hides values from non-staff. **Use the returned `id` in all subsequent requests, never the name.** `type` immutable; `PUT /settings/apifields/3` can rename or change `private`. List: `GET /settings/apifields?type=project`.
2. Set a value (via the item's PUT/POST, `apifields` array): `PUT /projects/6 {"apifields":[{"id":3,"value":"CRM-88231"}]}`.
3. Read/filter: `GET /projects?fields=number,title,apifield3` · `GET /projects?apifields=3,CRM-88231`.
   This is the supported way to stamp Numa/external IDs onto records for cross-system reconciliation without polluting the customer's UI.

## Field Validation Rules

| Entity             | Field                               | Rule                                                  | Error if violated                                                                                                                                          |
| ------------------ | ----------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task               | `contacts`                          | comma-separated STRING, not array of objects          | HTTP **500**, `details` = bare string "An unidentified error occurred..."                                                                                  |
| Time               | `starttime`/`endtime`/`timetracked` | one of the four valid combinations                    | 400 "You must provide one of the following combinations: 'starttime' & 'endtime', 'starttime' & 'timetracked', 'endtime' & 'timetracked' or 'timetracked'" |
| Time               | duration field name                 | `timetracked` (minutes); `timeminutes` does not exist | 400                                                                                                                                                        |
| Note               | `content`                           | required                                              | 400 "'content' is a required field"                                                                                                                        |
| Message            | `title`                             | required for new discussions (NOT `subject`)          | 400                                                                                                                                                        |
| Message            | `contacts`                          | required for new discussions                          | 400                                                                                                                                                        |
| Project            | `title`, `companyid`                | required (external projects)                          | 400                                                                                                                                                        |
| Quote/Invoice line | per-`type` fields                   | see line type table                                   | 400                                                                                                                                                        |
| Paging             | `pagesize`/`pagenumber`             | both or neither                                       | 400 "pagesize and pagenumber must both be provided in order to use paging"                                                                                 |
| API Field          | `name` + `type`                     | unique name per type; `type` immutable                | 400                                                                                                                                                        |
| Webhook            | `event`                             | immutable after create (delete + recreate)            | —                                                                                                                                                          |

## Server-Side Defaults

| Entity        | Field                    | Default                                       | When         |
| ------------- | ------------------------ | --------------------------------------------- | ------------ |
| All           | `id`                     | auto integer                                  | create       |
| All           | `lastmodified`           | current timestamp                             | create, edit |
| Project       | `number`                 | `auto` (e.g. P-0103)                          | create       |
| Project       | `managerid`              | `me`                                          | create       |
| Project       | status                   | active (Completed if `completedate` supplied) | create       |
| Task          | `contacts`               | `me`                                          | create       |
| Task          | `priority`               | 3 (Normal)                                    | create       |
| Task          | `billable`/`taxable`     | true / true                                   | create       |
| Task          | `timeallocated`          | 0                                             | create       |
| Task          | `order`/`type`           | `auto` (last in project) / `normal`           | create       |
| Time          | `contactid`              | `me`                                          | create       |
| Time          | `endtime`                | now (when only `timetracked` sent)            | create       |
| Quote/Invoice | `number`                 | `auto`                                        | create       |
| Line          | `taxable`                | true                                          | create       |
| Line          | `displayorder`           | `auto` (appended last)                        | create       |
| Message       | `notifications`/`public` | true / true                                   | create       |
| API Field     | `private`                | false                                         | create       |

## Worked Examples

### 1. Project → task → tracked time → complete (all confirmed live)

`POST /projects {"title":"Website Refresh","companyid":8,"managerid":"me","duedate":"+2w"}` → 201 `details:[{"id":6,"number":"P-0103","title":"Website Refresh"}]`
`POST /tasks {"name":"Draft homepage copy","projectid":6,"contacts":"me","duedate":"+3d"}` → 201 `details:[{"id":12,...}]`
`POST /time {"taskid":12,"contactid":"me","timetracked":30,"notes":"Initial draft"}` → 201 `details:[{"id":44}]`
`PUT /tasks/12/complete {}` → 200 `{"message":"Task Completed","status":"Success","details":[{"id":12}]}`

- `contacts:"me"` (string) — array form is a 500. `timetracked` minutes; 30 = half hour. Action endpoints are PUT with `{}`.

### 2. Quote a project, then approve it

`POST /quotes {"title":"Refresh Quote","number":"auto","contactid":504,"projectid":6,"lines":[{"type":"heading","name":"Build"},{"type":"taskrate","name":"Development","time":600,"rate":150.00,"taxable":true},{"type":"lineitem","name":"Stock photography","quantity":5,"rate":40.00,"taxable":true}]}` → 201 `details:[{"id":9,...}]` — 600 min @ $150/hr = $1,500 + $200 = $1,700 pre-tax.
`PUT /quotes/9/approve {"approveddate":"+0d","projectid":6}`

- `time` minutes / `rate` per hour on `taskrate`/`staffrate`. `markaspending` reverts an approve/decline.

### 3. Clear a field deliberately (and only deliberately)

User: "Remove the PO number from project 6." → `PUT /projects/6 {"purchaseordernumber":""}` → 200 `details:[{"id":6}]`

- The empty string is the clear mechanism — exactly why you never echo whole objects back on PUT. One stray `""` silently erases data.

## Gotchas

1. Empty value on PUT clears the field — the single most dangerous behavior. Send only fields you mean to change; `""` only to wipe.
2. Task `contacts` is a comma string, not an array. `[{"id":"me"}]` → HTTP 500 with bare-string `details`. Use `"me"`/`"1,2"`/`"allstaff"`.
3. Action endpoints are PUT, not POST (`/complete`, `/approve`, `/markaspaid`, `/starttimer`, `/adjustdates`, ...). Bulk task delete is `PUT /tasks/delete`, not DELETE.
4. Time duration is `timetracked` in minutes with exactly four legal field combos — `timeminutes` doesn't exist.
5. Messages use `title`, not `subject`; a message's title/content are immutable after posting (only contacts/notifications/public editable).
6. `adjustdates` is not idempotent — re-running shifts dates again. Never blind-retry.
7. Company delete kills its contacts by default (`deletecontacts` defaults true). Pass `false` to keep them — then reassign them to another company or they become unusable.
8. Starting a timer stops any other running timer for that user — side effect, not error.
9. Stopping a timer fires two webhook events (`stoptimer` + `newtime`) — act on one.
10. Project number != project id. Creates return both (`"number":"P-0103"`, `"id":6`); every API call wants the numeric id.
11. API Fields are API-only — values set via `apifields` never appear in the UI; use them for sync metadata, not customer-visible data.
12. Some creates with a `completedate` skip notifications (projects/tasks added as Completed send no alerts) — useful for backfilling history quietly.

## Dangerous Operations (confirm with user first)

| Operation                            | Why dangerous                                        | Safeguard                                                            |
| ------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------- |
| `DELETE /projects/{id}`              | cascades: deletes ALL tasks, files, messages, time   | confirm; state the cascade explicitly                                |
| `DELETE /companies/{id}`             | deletes the company AND its contacts by default      | confirm; ask whether to pass `deletecontacts=false`                  |
| `PUT /tasks/delete`                  | bulk-deletes tasks + their files/messages/time       | confirm the exact task list; docs say "use with caution"             |
| `PUT /.../adjustdates`               | not idempotent — repeats compound                    | never auto-retry; read dates back after                              |
| any PUT containing `""` values       | silently erases fields                               | only include `""` when the user explicitly asked to clear that field |
| `DELETE /messages/{first-in-thread}` | deletes the entire discussion                        | check whether the message started the thread before deleting         |
| `DELETE /settings/apifields/{id}`    | field + values gone; recovery needs vendor support   | confirm; prefer renaming/abandoning the field                        |
| `PUT /quotes/{id}/approve`           | business-state change done "on behalf of the client" | confirm user has authority; `markaspending` is the undo              |
| `PUT /invoices/{id}/markaspaid`      | financial state change                               | confirm; `markasunpaid` is the undo                                  |
