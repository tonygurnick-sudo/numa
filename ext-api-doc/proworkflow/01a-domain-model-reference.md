---
api_name: ProWorkflow
api_slug: proworkflow
base_url: https://api.proworkflow.net
call_surface: HTTP via connectors(name="request", ...) — flat relative paths; no version segment
field_casing: all-lowercase, no separators
id_format: integer in URLs; projects/quotes/invoices also have display `number` (P-/Q-/INV-xxxx) — never in a URL
doc: domain model — entity catalog, relationships, state machines, business rules (companion to 01)
confidence: every fact live-API-confirmed 2026-06-10 unless tagged [INFERRED]/[DOCS]
---

# ProWorkflow — Domain Model

## ID Semantics

- Every item has an integer `id` — immutable, unique per entity type, used in all URLs (`/projects/6`, `/tasks/14`). Always returned regardless of `fields`.
- Projects (and quotes/invoices) also carry a display `number` (`"P-0103"`, `"Q-0042"`, `"INV-0007"`) — what users see in the UI; auto-generated (`"number":"auto"`) or custom. **URLs take the integer `id` only, never the number.** (POST /projects returns both `"id":6` and `"number":"P-0103"`.)
- Resolve "project P-0103" first: `GET /projects?searchnumber=P-0103&status=all` → take `id`.
- `me` substitutes a contact id in most `contacts`/`contactid`/`managerid` params.

## Entity Catalog

### Company

Paths: `/companies`, `/companies/{id}`, shortcuts `/companies/client|contractor|staff`. Organisations: the staff company (your org), clients, contractors, others. Projects/invoices/quotes hang off a company. CRUD: Create (bulk), Read, Update, Delete (optionally deletes contacts).

| Field                                      | Type   | Required | Writable | Notes                                 |
| ------------------------------------------ | ------ | -------- | -------- | ------------------------------------- |
| id                                         | int    | —        | no       | `8`                                   |
| name                                       | string | create   | yes      | `"Astra Legal"`                       |
| type                                       | string | create   | yes      | `client`/`contractor`/`staff`/`other` |
| code                                       | string | no       | yes      | short code                            |
| address1..3, city, state, zipcode, country | string | no       | yes      | address block                         |
| phone, fax, email, website                 | string | no       | yes      |                                       |
| contacts                                   | array  | no       | no       | via `fields=contacts`                 |
| tags                                       | array  | no       | yes      | manage IDs via settings               |
| apifields                                  | array  | no       | yes      | API-only custom values `[{id,value}]` |
| lastmodified                               | string | —        | no       | ISO8601, no TZ                        |

Default list fields: `code,name,type`.
Relationships: Contact 1:N (`companyid`; `/companies/{id}/contacts`) · Project 1:N (`companyid`; `/companies/{id}/projects`, external only) · Invoice/Quote 1:N (`/companies/{id}/invoices`,`/quotes`) · Note 1:N (`/companies/{id}/notes`, `content` required on create) · Time 1:N (`/companies/{id}/time`, aggregated via projects/tasks).

### Contact

Paths: `/contacts`, `/contacts/{id}`, `/me`, shortcuts `/contacts/client|contractor|staff`. People; `type` mirrors company role. Staff can be assigned work + track time. May have login (`allowlogin`). CRUD: Create (bulk), Read, Update, Delete; `/me` = GET/PUT the requesting user.

| Field                                         | Type    | Required | Writable | Notes                                 |
| --------------------------------------------- | ------- | -------- | -------- | ------------------------------------- |
| id                                            | int     | —        | no       | the "contact id" used everywhere; `1` |
| firstname / lastname                          | string  | create   | yes      |                                       |
| companyid                                     | int     | create   | yes      | owning company                        |
| companyname                                   | string  | —        | no       | denormalised                          |
| type                                          | string  | create   | yes      | `staff`/`client`/`contractor`/`other` |
| email                                         | string  | no       | yes      | also usable as Basic-auth username    |
| title, workphone, mobilephone, address fields | string  | no       | yes      |                                       |
| allowlogin                                    | boolean | no       | yes      | app login                             |
| divisionid                                    | int     | —        | no       | Advanced plan                         |
| plan                                          | string  | —        | no       | `/me` only: account plan              |
| groups, teams, roles, tags, notes, apifields  | array   | no       | varies   | sub-collections                       |

Relationships: Company N:1 (`companyid`) · Projects N:M via assignment (`/contacts/{id}/projects`, filter `contacts=`) · Tasks N:M (`/contacts/{id}/tasks`) · Time 1:N (`timetrackedby`,`contactid`) · permissions/roles/groups sub-resources.

### Project

Paths: `/projects`, `/projects/{id}` + action/sub-resource paths. The core work container: manager, owning client company (external) or internal client (Advanced), assigned staff/clients/contractors, tasks, files, messages, time, quotes, invoices, expenses. CRUD: Create, Read, Update (PUT partial), Delete (**cascades to tasks**); actions: complete, reactivate, adjustdates.

| Field                                              | Type            | Required | Writable    | Notes                                                     |
| -------------------------------------------------- | --------------- | -------- | ----------- | --------------------------------------------------------- |
| id                                                 | int             | —        | no          | use in URLs; `6`                                          |
| number                                             | string          | no       | create      | display number; `"auto"`; `"P-0103"`                      |
| title                                              | string          | create   | yes         |                                                           |
| description                                        | string          | no       | yes         |                                                           |
| companyid                                          | int             | create\* | yes         | client company (\*or internalclientcontactid on Advanced) |
| managerid                                          | int/`me`        | no       | yes         | PM contact (default `me`)                                 |
| staff / clients / contractors                      | string          | no       | yes         | **comma-string of contact IDs** `"2,3,5"`                 |
| status                                             | string          | —        | via actions | `active`/`complete`                                       |
| customstatusid                                     | int             | no       | yes         | Advanced                                                  |
| priority                                           | int             | no       | yes         | 1-5 = Very High → Very Low                                |
| startdate / duedate / completedate                 | date            | no       | yes         | yyyy-mm-dd or relative (`+1w`)                            |
| categoryid                                         | int             | no       | yes         | settings/projects/categories                              |
| timeallocated                                      | int             | no       | yes         | budgeted MINUTES                                          |
| timetracked                                        | int             | —        | no          | tracked minutes (computed)                                |
| percentcomplete                                    | int             | —        | no          | % tasks complete (headings excluded)                      |
| quotetotal / invoicetotal                          | number/`"auto"` | no       | yes         | `"auto"` = sum of quotes/invoices                         |
| invoiced / paid / accountedfor                     | boolean         | no       | yes         | financial flags                                           |
| purchaseordernumber, privatenotes                  | string          | no       | yes         | privatenotes = staff-only                                 |
| clientaccess / emailalerts                         | boolean         | no       | yes         | visibility + notification                                 |
| tags, customfields, apifields, tasklists, contacts | array           | no       | varies      | sub-data (via fields=)                                    |

Default list fields: `title,number,company,startdate,duedate`. List filter `status` defaults to `active`.
Relationships: Company N:1 (`companyid`, or internal client team/group on Advanced) · Contact N:M (`staff`/`clients`/`contractors` comma-strings; `/projects/{id}/contacts`; per-contact access `/projects/{id}/access/{contactid}`) · Task 1:N (`/projects/{id}/tasks` or `/tasks?projectid=`, deleted with project) · Time 1:N (`/projects/{id}/time` via tasks) · File 1:N (`/projects/{id}/files`) · Message 1:N (`/projects/{id}/messages`) · SharedNote 1:N · Expense 1:N · Quote/Invoice 1:N (linked via `projectid`) · Bookmark 1:N (URL bookmarks).

### Task

Paths: `/tasks`, `/tasks/{id}` + action paths; project-scoped `/projects/{id}/tasks`. Unit of work inside a project (or a "General Task" under a category, no project). Ordered (1, 1.1, 1.1.1 — supports sub-tasks), multi-assignee, time-trackable, billable/taxable. CRUD: Create (bulk array, same project), Read, Update, Delete (cascades files/messages/time); actions: complete, reactivate, adjustdates, starttimer, stoptimer; bulk delete `PUT /tasks/delete`.

| Field                                          | Type          | Required          | Writable    | Notes                                                                                       |
| ---------------------------------------------- | ------------- | ----------------- | ----------- | ------------------------------------------------------------------------------------------- |
| id                                             | int           | —                 | no          | `14`                                                                                        |
| name                                           | string        | create            | yes         |                                                                                             |
| projectid                                      | int           | create\*          | no          | parent project (\*or `categoryid` for General Task)                                         |
| categoryid                                     | int           | create\*          | yes         | settings/tasks/categories                                                                   |
| contacts                                       | string        | no (default `me`) | yes         | **COMMA-STRING**: `"me"`,`"1,2"`,`"all"`,`"allstaff"`,`"none"` — NOT an array               |
| description                                    | string        | no                | yes         |                                                                                             |
| status                                         | string        | —                 | via actions | `active`/`complete`                                                                         |
| type                                           | string        | no                | yes         | `normal`/`bold`/`heading`                                                                   |
| order / orderlevel                             | string        | no                | create      | `auto`, `after{taskid}`, `before{taskid}`, or explicit `1.1`; level `normal`/`sub`/`subsub` |
| priority                                       | int           | no (default 3)    | yes         | 1-5 = Very High → Very Low                                                                  |
| startdate / duedate / completedate             | date          | no                | yes         | yyyy-mm-dd or relative                                                                      |
| timeallocated                                  | int           | no (default 0)    | yes         | budgeted MINUTES                                                                            |
| billable / taxable                             | boolean       | no (default true) | yes         |                                                                                             |
| prerequisites                                  | string        | no                | yes         | comma-string of task IDs (or `newX` refs in bulk add); `none` clears                        |
| servicename / servicedescription / servicerate | string/number | no                | yes         | service-billing                                                                             |
| tagid, tasklistid, apifields                   | —             | no                | yes         | taxonomy/list/custom                                                                        |

List filter `status` defaults to `active`; sort default `id asc`.
Relationships: Project N:1 · Contacts N:M (`/tasks/{id}/contacts`) · Time 1:N (`/tasks/{id}/time`) · Files 1:N · Messages 1:N · Prerequisite tasks N:M within the same project.

### Time Record

Paths: `/time`, `/time/{id}`, `/time/activetimers`, task-scoped `/tasks/{id}/time`. Minutes tracked by a contact against a task. `/time` doubles as a reporting endpoint (totals + `subtotals=`). **List collection key is `timerecords`.** CRUD: Create, Read, Update, Delete; running-timer stop via `/time/{id}/stoptimer`.

| Field               | Type           | Required          | Writable | Notes                                      |
| ------------------- | -------------- | ----------------- | -------- | ------------------------------------------ |
| id                  | int            | —                 | no       | `21`                                       |
| taskid              | int            | create (on /time) | no       | implicit on /tasks/{id}/time               |
| contactid           | int/`me`       | no (default `me`) | yes      | who tracked                                |
| timetracked         | int            | see combos        | yes      | **MINUTES** — `timeminutes` does NOT exist |
| starttime / endtime | datetime/`now` | see combos        | yes      | ISO8601 `yyyy-mm-ddThh:mm` or `now`        |
| notes               | string         | no                | yes      |                                            |
| billable            | boolean        | —                 | via task | inherited from task                        |
| approvalstatus      | string         | —                 | no       | if time approval enabled                   |
| apifields           | array          | no                | yes      |                                            |

Valid create combos: `starttime`+`endtime` | `starttime`+`timetracked` | `endtime`+`timetracked` | `timetracked` alone (end=now). GET `/time` defaults `trackedfrom=-6d`, `trackedto=+0d` — pass explicit dates for history. Supports `subtotals=` (company, project, task, contact, day/week/month...) → `subtotals[]` + `total`.

### File

Paths: `/files`, `/files/{id}`, `/files/folders`; scoped `/projects/{id}/files`, `/tasks/{id}/files`. Metadata attached to a project, task, or folder. **Content download is NOT via REST** (except `?content=true` ≤1 MB) — each file has a `link` to a signed `app.proworkflow.com/...getfilesattached.cfm?...sec_key=...` URL; fetch that for bytes. CRUD: Create (base64 upload), Read (metadata), Delete.

| Field                         | Type   | Required              | Writable | Notes                                                |
| ----------------------------- | ------ | --------------------- | -------- | ---------------------------------------------------- |
| id                            | int    | —                     | no       | `15`                                                 |
| name                          | string | create                | no       | `"brief.pdf"`                                        |
| content                       | string | create                | no       | base64 (upload only, never returned)                 |
| projectid / taskid / folderid | int    | exactly one on create | no       | target (projectid also accepts a Project Request id) |
| size                          | int    | —                     | no       | bytes                                                |
| date                          | string | —                     | no       | upload date                                          |
| link                          | string | —                     | no       | signed download URL (app.proworkflow.com)            |
| contacts                      | mixed  | —                     | no       | `"all"` if public, else array of allowed contacts    |
| folder                        | object | —                     | no       | `{id,name}` when in a folder                         |

Default list fields: `name,project,task,date,size,link`. List `projectstatus` filter defaults to `active`.

### Message

Paths: `/messages`, `/messages/{id}`; scoped `/projects/{id}/messages`, `/tasks/{id}/messages`. Discussion threads on a project or task. Root message starts a discussion; replies reference `originalmessageid`. Can attach already-uploaded files. CRUD: Create, Read, Update, Delete.

| Field              | Type    | Required                | Writable | Notes                                   |
| ------------------ | ------- | ----------------------- | -------- | --------------------------------------- |
| id                 | int     | —                       | no       | `30`                                    |
| title              | string  | create (new discussion) | yes      | **`title`, NOT `subject`**              |
| content            | string  | create                  | yes      | body                                    |
| contacts           | string  | create (new discussion) | yes      | comma-string of IDs / `me` / `all`      |
| projectid / taskid | int     | one, for new discussion | no       | target                                  |
| originalmessageid  | int     | for replies             | no       | root message of thread                  |
| files              | string  | no                      | yes      | comma-string of file IDs (same project) |
| public             | boolean | no (default true)       | yes      | public vs private                       |
| notifications      | boolean | no (default true)       | yes      | email notifications                     |

### Note (general) and Entity Notes

Paths: general `/notes`, `/notes/{id}`; entity-scoped `/companies/{id}/notes`, `/contacts/{id}/notes`. **General notes** live under a note category, assigned to contacts. **Entity notes** hang off a company or contact. CRUD: Create, Read, Update, Delete (both).

| Flavour              | Required on create               | Optional                   | Notes                                                 |
| -------------------- | -------------------------------- | -------------------------- | ----------------------------------------------------- |
| General note         | `title`, `content`, `categoryid` | `contacts` (default `all`) | categories from `/settings/notes/categories`          |
| Company/contact note | `content`                        | `title`                    | 400 `"'content' is a required field"` without content |

### Shared Note

Paths: `/sharednotes`, `/sharednotes/{id}`; scoped `/projects/{id}/sharednotes`. Project-level notes visible to everyone on the project (subject to permissions). CRUD: full. Required on create: `projectid`, `title`; `content` optional.

### Quote

Paths: `/quotes`, `/quotes/{id}` + `/approve`,`/decline`,`/markaspending`; lines `/quotes/{id}/lines[/{lineid}]`, cross-quote `/quotes/lines`; scoped `/projects/{id}/quotes`, `/companies/{id}/quotes`. A quote/estimate for a client contact, optionally attached to a project. Built from typed lines. Reporting supports totals/`subtotals=`. CRUD: full; lifecycle approve/decline/markaspending; line CRUD.

| Field                                                   | Type           | Required | Writable    | Notes                                     |
| ------------------------------------------------------- | -------------- | -------- | ----------- | ----------------------------------------- |
| id                                                      | int            | —        | no          | `9`                                       |
| number                                                  | string         | no       | create      | display number; `"auto"`; `"Q-0042"`      |
| title                                                   | string         | create   | yes         |                                           |
| contactid                                               | int            | create   | yes         | client contact                            |
| projectid                                               | int            | no       | yes         | linked project (also settable at approve) |
| lines                                                   | array          | create   | yes         | typed lines, see below                    |
| status                                                  | string         | —        | via actions | `pending`/`approved`/`declined`           |
| type                                                    | string         | no       | yes         | `quote`/`estimate`                        |
| quoteddate / approveddate / validtodate                 | date           | no       | yes         |                                           |
| description, address1..3, city, state, zipcode, country | string         | no       | yes         | header/address                            |
| taxable / taxrate                                       | boolean/number | no       | yes         |                                           |
| totals                                                  | object         | —        | no          | sub/tax/grand (computed)                  |

Line types (each needs `type`): `heading` (name) · `lineitem` (name or description + `quantity` + `rate`) · `taskrate` (name + `time` minutes + `rate`) · `staffrate` (name + `time` + `rate`). Optional `taxable` per line.
List filter `status` defaults to `pending` (`active`=pending+approved; `all` for everything).

### Invoice

Paths: `/invoices`, `/invoices/{id}` + `/markaspaid`,`/markasunpaid`; lines `/invoices/{id}/lines[/{lineid}]`; `/invoices/overdue`; scoped `/projects/{id}/invoices`, `/companies/{id}/invoices`. Same line-based structure as quotes, billed to a company + contact. Paid/unpaid state machine. Reporting supports totals/`subtotals=`. CRUD: full; markaspaid/markasunpaid; line CRUD.
Fields mirror Quote plus: `companyid` (REQUIRED on create, with `contactid` + `lines`), `invoiceddate`, `duedate`, `paiddate`, `status` (`paid`/`unpaid`). List filter `status` defaults to `unpaid`. Invoice-only line type: `expense` (name, quantity, rate).

### Expense

Paths: `/expenses`, `/expenses/{id}`; scoped `/projects/{id}/expenses`. A cost recorded against a project. CRUD: full.

| Field       | Type    | Required           | Writable | Notes                  |
| ----------- | ------- | ------------------ | -------- | ---------------------- |
| id          | int     | —                  | no       | `4`                    |
| projectid   | int     | create             | no       | parent project         |
| name        | string  | create             | yes      | `"Stock photos"`       |
| cost        | number  | create             | yes      | `100.00`               |
| date        | date    | no                 | yes      | yyyy-mm-dd or relative |
| description | string  | no                 | yes      |                        |
| invoiced    | boolean | no (default false) | yes      |                        |
| taxable     | boolean | no (default true)  | yes      |                        |

### Event

Paths: `/events`, `/events/{id}`. Calendar events for staff contacts (meetings, leave). Not linked to projects. CRUD: full. Required on create: `title`, `starttime`, `endtime` (ISO8601 `yyyy-mm-ddThh:mm` or `now`); `contacts` comma-string defaults to `me`; `description` optional.

### Project Request

Paths: `/projectrequests`, `/projectrequests/{id}` + `/approve`,`/decline`. Inbound request for a new project (typically from clients). Approving converts it to a Project; attach files by POSTing `/files` with `projectid` = the REQUEST id. CRUD: full; approve/decline.

| Field                            | Type   | Required      | Writable    | Notes                       |
| -------------------------------- | ------ | ------------- | ----------- | --------------------------- |
| id                               | int    | —             | no          | `3`                         |
| title                            | string | create        | yes         | only required field         |
| description                      | string | no            | yes         |                             |
| budget                           | number | no            | yes         | `5000.00`                   |
| contactid / divisionid / groupid | int    | no (Advanced) | yes         | who it's submitted to       |
| startdate / duedate              | date   | no            | yes         | requested dates             |
| templateid                       | int    | no            | create      | project template (Advanced) |
| customfields / apifields         | array  | no            | yes         |                             |
| status                           | string | —             | via actions | pending/approved/declined   |

On approve: Solo/Professional plans assign the approver as PM; Advanced assigns the contact the request was submitted to. Optional approve params: `number` (default `auto`), `clientaccess`, `emailalerts`, `autonumberid`.

### Taxonomy & Settings (tags, categories, custom statuses, custom/API fields)

Read these under `/settings/...` to resolve IDs before filtering or creating:

| Taxonomy               | Path                                                                                                     | Used by                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Project categories     | `/settings/projects/categories[/{id}]`                                                                   | `categoryid` on projects                                                                                                               |
| Task categories        | `/settings/tasks/categories[/{id}]`                                                                      | `categoryid` on General Tasks                                                                                                          |
| Note categories        | `/settings/notes/categories[/{id}]`                                                                      | `categoryid` on general notes (REQUIRED)                                                                                               |
| Tags                   | `/settings/projects/tags`, `/settings/tasks/tags`, `/settings/contacts/tags`                             | `tagid` filters/params                                                                                                                 |
| Custom statuses        | `/settings/projects/customstatuses[/{id}]`                                                               | `customstatusid` (Advanced)                                                                                                            |
| Custom fields          | `/settings/projects/customfields`                                                                        | `customfields:[{id,value}]` (Advanced)                                                                                                 |
| API fields             | `/settings/apifields[/{fieldid}]`                                                                        | API-only fields on company/contact/invoice/project/quote/task/time; set via `apifields:[{id,value}]`, filter via `apifields=ID,string` |
| Templates              | `/settings/projects/templates`, `/settings/tasks/templates`                                              | `templateid` on create                                                                                                                 |
| Rates                  | `/settings/servicerates`, `/settings/staffrates`, `/settings/{invoices,quotes}/{hourlyrates,staffrates}` | pricing lookups                                                                                                                        |
| Teams/groups/divisions | `/settings/contacts/teams`, `/groups`, `/divisions`                                                      | Advanced org structure                                                                                                                 |
| Webhooks               | `/settings/webhooks[/{id}]`, `/settings/webhooks/requests`                                               | event subscriptions (no Numa receiver)                                                                                                 |

Custom fields (Advanced) appear in the ProWorkflow UI; API fields are invisible in the UI and exist only through the API.

### Workload (computed)

Path: `/workload` (GET only). Minutes of scheduled task work (or availability with `mode=availability`, `availableminutes` default 480) per staff contact per day, weekends excluded. `datefrom`/`dateto` (defaults `+0d`/`+2w`) **must be today or later**. Overdue tasks NOT counted.

## Entity Relationship Diagram

```
Company 1:N Contact          Project 1:N Task
Company 1:N Project(client)  Project 1:N File / Message / SharedNote / Expense
Contact N:M Project/Task     Project 1:N Quote(1:N QuoteLines) / Invoice(1:N InvoiceLines)
(staff/clients/contractors   Task 1:N TimeRecord / File / Message / (prereq Tasks)
 CSV assignment strings)     ProjectRequest --approve--> Project
Event = staff calendar (no project link)
settings/: categories, tags, custom statuses, custom fields, api fields, templates, rates
```

## State Machines

### Project

`[active] --PUT /projects/{id}/complete--> [complete]`; reverse `--PUT /projects/{id}/reactivate-->`.

| From     | Action                        | To       | Reversible | Side effects                                            |
| -------- | ----------------------------- | -------- | ---------- | ------------------------------------------------------- |
| active   | PUT /projects/{id}/complete   | complete | Yes        | **completes all active tasks**; optional `completedate` |
| complete | PUT /projects/{id}/reactivate | active   | Yes        | does NOT reactivate tasks — reactivate each separately  |
| (create) | POST with `completedate` set  | complete | Yes        | added directly as completed; no alerts                  |
| any      | DELETE /projects/{id}         | (gone)   | No         | **deletes all associated tasks**                        |

### Task

`[active] --PUT /tasks/{id}/complete--> [complete]`; reverse `/reactivate`; `starttimer`/`stoptimer` add time records.

| From     | Action                                  | To       | Reversible | Side effects                                     |
| -------- | --------------------------------------- | -------- | ---------- | ------------------------------------------------ |
| active   | PUT /tasks/{id}/complete `{}`           | complete | Yes        | optional `completedate`; 200 "Task Completed"    |
| complete | PUT /tasks/{id}/reactivate              | active   | Yes        |                                                  |
| active   | PUT /tasks/{id}/starttimer              | active   | —          | stops any other running timer for the user       |
| active   | PUT /tasks/{id}/stoptimer               | active   | —          | creates a time record from the timer             |
| any      | DELETE /tasks/{id} or PUT /tasks/delete | (gone)   | No         | deletes the task's files, messages, time records |

### Quote

`[pending] --/approve--> [approved]`; `[pending] --/decline--> [declined]`; `--/markaspending-->` reverts approved/declined to pending.

| From              | Action                         | To       | Reversible          | Side effects                                   |
| ----------------- | ------------------------------ | -------- | ------------------- | ---------------------------------------------- |
| pending           | PUT /quotes/{id}/approve       | approved | Yes (markaspending) | optional `approveddate`, `projectid` to attach |
| pending           | PUT /quotes/{id}/decline       | declined | Yes (markaspending) | staff acts on behalf of client                 |
| approved/declined | PUT /quotes/{id}/markaspending | pending  | —                   | reverts the decision                           |

### Invoice

`[unpaid] --/markaspaid--> [paid]`; reverse `/markasunpaid`. Optional `paiddate` on markaspaid. `/invoices/overdue` lists unpaid past `duedate`.

### Project Request

`[pending] --/approve--> [approved]` (a Project is created); `--/decline--> [declined]`. Approve creates the project (optional `number`, `clientaccess`, `emailalerts`); manager assignment depends on plan (see entity). Not reversible via API.

## Business Rules

### Ordering / Dependencies

- Company before Contact (`companyid` required on contact create); Company (or internal client, Advanced) before Project; Project before Task/Quote-attachment/Expense/Message/SharedNote/File.
- Tasks need `projectid` OR `categoryid` (General Task) — exactly one.
- Bulk task creation: all tasks in one POST share the same `projectid`/`categoryid`; `prerequisites` can reference sibling new tasks as `new1`, `new2`...
- Files attach to exactly one of `projectid`/`taskid`/`folderid`; message file attachments must already be uploaded to the same project.
- Time records require an existing task (`taskid`).
- Resolve taxonomy IDs (`categoryid`, `tagid`, `customstatusid`, apifield ids) from `/settings/...` before writing.

### Field-Level

- Comma-string convention: `contacts`, `staff`, `clients`, `contractors`, `prerequisites`, `taskid` (bulk delete), `files` are comma-separated ID strings — never JSON arrays.
- `timetracked`/`timeallocated`/line `time` are integer MINUTES; line `rate` is per HOUR.
- `priority` 1-5 (1=Very High, 5=Very Low; task default 3).
- Quote/invoice lines must carry a valid `type` with that type's required fields.
- `/workload` dates must be today or later.
- Search params are case-insensitive substring matches; `!` prefix negates most search/ID filters (`search=!layout`, `categoryid=!1,2`).

### Cascading

- DELETE project → deletes all tasks/files/messages/time; DELETE task / PUT /tasks/delete → deletes its files/messages/time.
- DELETE company → may optionally delete associated contacts (`deletecontacts` default true).
- Complete project → completes its active tasks; reactivate project → does NOT reactivate tasks.
- Starting a timer stops any other running timer for that user.

### Computed / Read-Only

- `id`, `lastmodified` server-set; `id` always returned regardless of `fields`.
- `percentcomplete`, `timetracked`, `burn`, quote/invoice `totals`, `/workload` numbers are computed.
- `quotetotal`/`invoicetotal` on projects accept literal `"auto"` to track the sum of attached quotes/invoices.
- PUT: omitted fields keep their values; an explicitly EMPTY value clears the field.

## Field Formats

| Format         | Pattern                | Example             | Notes                                                           |
| -------------- | ---------------------- | ------------------- | --------------------------------------------------------------- |
| Date           | `YYYY-MM-DD`           | `2026-06-24`        | all date params/filters                                         |
| DateTime       | ISO8601, NO timezone   | `2026-06-10T13:00`  | starttime/endtime, lastmodified; user's local time              |
| Relative date  | `+/-X` + `n/h/d/w/m/y` | `+1w`, `-2d`, `15n` | **`n`=minutes, `m`=months**; valid in filters AND date fields   |
| Currency       | plain number           | `1000.00`           | no symbol; account currency from `/login` / `/settings/account` |
| ID             | integer                | `6`                 | all URL ids; `me` substitutes a contact id in params            |
| Display number | string                 | `P-0103`            | projects/quotes/invoices; `"auto"` on create                    |
| File content   | base64 string          | `U29tZSB0ZXh0`      | upload only; download via signed `link`                         |
| List strings   | comma-separated        | `"1,2,3"`, `"me"`   | contacts/IDs in bodies and filters                              |

## Enums

| Entity        | Field           | Allowed                                                                                                                                                                                                                                                                                         | Default        | Notes                                      |
| ------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------ |
| Company       | type            | `client`,`contractor`,`staff`,`other`                                                                                                                                                                                                                                                           | —              | `staff` = your own org                     |
| Contact       | type            | `staff`,`client`,`contractor`,`other`                                                                                                                                                                                                                                                           | —              | only staff appear in `/workload`           |
| Project       | status (filter) | `active`,`complete`,`all`                                                                                                                                                                                                                                                                       | `active`       |                                            |
| Project       | priority        | `1`-`5` (Very High → Very Low)                                                                                                                                                                                                                                                                  | —              |                                            |
| Project       | sortby          | `id`,`title`,`number`,`startdate`,`duedate`,`completedate`,`categoryname`,`companyname`,`priority`                                                                                                                                                                                              | `number`       |                                            |
| Task          | status (filter) | `active`,`complete`,`all`                                                                                                                                                                                                                                                                       | `active`       |                                            |
| Task          | type            | `normal`,`bold`,`heading` (filter adds `nonheading`,`all`)                                                                                                                                                                                                                                      | `normal`       | headings excluded from percentcomplete     |
| Task          | contacts        | comma IDs, `me`, `all`, `allstaff`, `none`                                                                                                                                                                                                                                                      | `me`           | STRING, not array                          |
| Task          | order           | `auto`, `after{taskid}`, `before{taskid}`, explicit `1.1`                                                                                                                                                                                                                                       | `auto`         | after/before need Smart Ordering           |
| Task          | orderlevel      | `normal`,`sub`,`subsub`                                                                                                                                                                                                                                                                         | `normal`       |                                            |
| Quote         | status (filter) | `pending`,`approved`,`active`(pend+appr),`declined`,`all`                                                                                                                                                                                                                                       | `pending`      |                                            |
| Quote         | type            | `quote`,`estimate` (filter adds `all`)                                                                                                                                                                                                                                                          | `all` (filter) |                                            |
| Quote/Invoice | lines[].type    | `heading`,`lineitem`,`taskrate`,`staffrate` (invoices also `expense`)                                                                                                                                                                                                                           | —              | each type has own required fields          |
| Invoice       | status (filter) | `paid`,`unpaid`,`all`                                                                                                                                                                                                                                                                           | `unpaid`       |                                            |
| Time          | trackedfrom/to  | dates/relative                                                                                                                                                                                                                                                                                  | `-6d`/`+0d`    | reporting window                           |
| Time          | timebillable    | `all`,`billable`,`nonbillable`                                                                                                                                                                                                                                                                  | `all`          | filter on projects/tasks/time              |
| Workload      | mode            | `workload`,`availability`                                                                                                                                                                                                                                                                       | `workload`     | availability = availableminutes − workload |
| Sort (global) | sortorder       | `asc`,`desc`                                                                                                                                                                                                                                                                                    | `asc`          |                                            |
| Webhook       | event           | `new/edit/delete` × contact, company, file, invoice, message, project, projectrequest, quote, sharednote, task, time; plus `completeproject`, `reactivateproject`, `completetask`, `reactivatetask`, `approveprojectrequest`, `declineprojectrequest`, `newpendingcontact`, `newpendingcompany` | —              | `/settings/webhooks`; no Numa receiver     |
