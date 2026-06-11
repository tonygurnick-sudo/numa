---
api_name: 'ProWorkflow'
api_slug: 'proworkflow'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-06-10'
update_source: 'live API testing (trial account, Advanced plan)'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# ProWorkflow -- Domain Model Reference

> Companion to `01-llm-api-rules.md`. Contains the full entity catalog, relationships,
> state machines, and business rules that the workspace agent references when working
> with ProWorkflow data.

---

## ID Semantics

- Every item has an integer `id` -- immutable, unique per entity type, used in all URLs (`/projects/6`, `/tasks/14`).
- **Projects (and quotes/invoices) additionally carry a display `number`** (e.g. `"P-0103"`, `"Q-0042"`, `"INV-0007"`). The number is what users see in the ProWorkflow UI and can be auto-generated (`"number": "auto"`) or custom. **Never put the number in a URL -- URLs take the integer `id` only.** [CONFIRMED -- live API test 2026-06-10: POST /projects returned both `"id": 6` and `"number": "P-0103"`]
- When a user says "project P-0103", resolve it first: `GET /projects?searchnumber=P-0103&status=all` → take `id` from the result.
- `me` is accepted in place of a contact id in most `contacts`/`contactid`/`managerid` parameters.
- Lists always include `id` regardless of the `fields` parameter.

---

## Entity Catalog

### Company

**Resource path:** `/companies`, `/companies/{companyid}`, shortcuts `/companies/client|contractor|staff`
**Description:** Organisations in the account -- the staff company (your own org), client companies, contractors, others. Projects, invoices, and quotes hang off a company.
**CRUD:** Create (bulk supported), Read, Update, Delete (optionally deletes contacts)

| Field        | Type    | Required   | Writable | Description                                | Example          |
| ------------ | ------- | ---------- | -------- | ------------------------------------------ | ---------------- |
| id           | integer | --         | no       | Unique identifier                          | `8`              |
| name         | string  | create     | yes      | Company name                               | `"Astra Legal"`  |
| type         | string  | create     | yes      | `client` / `contractor` / `staff` / `other`| `"client"`       |
| code         | string  | no         | yes      | Short code                                 | `"STAFF"`        |
| address1..3, city, state, zipcode, country | string | no | yes | Address block                  |                  |
| phone, fax, email, website | string | no | yes  | Contact details                            |                  |
| contacts     | array   | no         | no       | Contacts (via fields=contacts)             |                  |
| tags         | array   | no         | yes      | Tag objects (manage IDs via settings)      |                  |
| apifields    | array   | no         | yes      | API-only custom field values `[{id,value}]`|                  |
| lastmodified | string  | --         | no       | ISO8601, no timezone                       | `"2026-06-10T13:37:51"` |

Default list fields: `code,name,type`. [CONFIRMED -- live API test 2026-06-10]

**Relationships:**

| Related Entity | Type | Expression                                  | Notes                              |
| -------------- | ---- | ------------------------------------------- | ---------------------------------- |
| Contact        | 1:N  | `companyid` on contact; `/companies/{id}/contacts` |                              |
| Project        | 1:N  | `companyid` filter; `/companies/{id}/projects` | External projects only          |
| Invoice/Quote  | 1:N  | `/companies/{id}/invoices`, `/quotes`       |                                    |
| Note           | 1:N  | `/companies/{id}/notes`                      | `content` required on create [CONFIRMED] |
| Time           | 1:N  | `/companies/{id}/time`                       | Aggregated through projects/tasks  |

---

### Contact

**Resource path:** `/contacts`, `/contacts/{contactid}`, `/me`, shortcuts `/contacts/client|contractor|staff`
**Description:** People. `type` mirrors their company role: staff (your team -- can be assigned work and track time), client, contractor, other. A contact may have login access (`allowlogin`).
**CRUD:** Create (bulk supported), Read, Update, Delete. `/me` = GET/PUT the requesting user.

| Field        | Type    | Required | Writable | Description                                  | Example                |
| ------------ | ------- | -------- | -------- | -------------------------------------------- | ---------------------- |
| id           | integer | --       | no       | Unique identifier (this is the "contact id" used everywhere) | `1`     |
| firstname / lastname | string | create | yes | Name                                         | `"tony"` / `"gurnick"` |
| companyid    | integer | create   | yes      | Owning company                               | `1`                    |
| companyname  | string  | --       | no       | Denormalised company name                    | `"Arcanum AI"`         |
| type         | string  | create   | yes      | `staff` / `client` / `contractor` / `other`  | `"staff"`              |
| email        | string  | no       | yes      | Email (also usable as Basic-auth username)   |                        |
| title, workphone, mobilephone, address fields | string | no | yes | Detail fields              |                        |
| allowlogin   | boolean | no       | yes      | Has app login                                | `false`                |
| divisionid   | integer | --       | no       | Division (Advanced plan)                     | `1`                    |
| plan         | string  | --       | no       | On `/me` only: account plan                  | `"Advanced"`           |
| groups, teams, roles, tags, notes, apifields | array | no | varies | Sub-collections             |                        |

**Relationships:** Company N:1 (`companyid`); Projects N:M via assignment (`/contacts/{id}/projects`, filter `contacts=`); Tasks N:M (`/contacts/{id}/tasks`); Time 1:N (`timetrackedby`, `contactid`); permissions/roles/groups sub-resources.

---

### Project

**Resource path:** `/projects`, `/projects/{projectid}` + action/sub-resource paths
**Description:** The core container of work. Has a manager, an owning client company (external) or internal client (Advanced), assigned staff/clients/contractors, tasks, files, messages, time, quotes, invoices, expenses.
**CRUD:** Create, Read, Update (PUT partial), Delete (**cascades to tasks** [CONFIRMED -- live API test 2026-06-10]); actions: complete, reactivate, adjustdates.

| Field          | Type    | Required | Writable | Description                                   | Example                 |
| -------------- | ------- | -------- | -------- | --------------------------------------------- | ----------------------- |
| id             | integer | --       | no       | Unique identifier (use in URLs)               | `6`                     |
| number         | string  | no       | create   | Display number; `"auto"` for autonumbering    | `"P-0103"`              |
| title          | string  | create   | yes      | Title                                         | `"Website Refresh"`     |
| description    | string  | no       | yes      | Description                                   |                         |
| companyid      | integer | create*  | yes      | Client company (*or internalclientcontactid on Advanced) | `8`         |
| managerid      | integer/`me` | no  | yes      | Project manager contact (default `me`)        | `"me"`                  |
| staff / clients / contractors | string | no | yes | **Comma-string of contact IDs**             | `"2,3,5"`               |
| status         | string  | --       | via actions | `active` / `complete`                      | `"active"`              |
| customstatusid | integer | no       | yes      | Custom status (Advanced plan)                 | `1`                     |
| priority       | integer | no       | yes      | 1-5 = Very High → Very Low                    | `2`                     |
| startdate / duedate / completedate | date | no | yes | yyyy-mm-dd or relative (`+1w`)          | `"2026-06-24"`          |
| categoryid     | integer | no       | yes      | Project category (settings/projects/categories) | `1`                  |
| timeallocated  | integer | no       | yes      | Budgeted MINUTES                              | `300`                   |
| timetracked    | integer | --       | no       | Tracked minutes (computed)                    |                         |
| percentcomplete| integer | --       | no       | % of tasks completed (headings excluded)      | `0`                     |
| quotetotal / invoicetotal | number/`"auto"` | no | yes | Quoted/invoiced value; `"auto"` = sum of quotes/invoices | `1000.00` |
| invoiced / paid / accountedfor | boolean | no | yes | Financial flags                       | `false`                 |
| purchaseordernumber, privatenotes | string | no | yes | privatenotes = staff-only            |                         |
| clientaccess / emailalerts | boolean | no | yes | Visibility + notification toggles            | `true`                  |
| tags, customfields, apifields, tasklists, contacts | array | no | varies | Sub-data (via fields=) |                         |

Default list fields: `title,number,company,startdate,duedate`. List filter `status` defaults to **`active`**. [CONFIRMED -- live API test 2026-06-10]

**Relationships:**

| Related Entity | Type | Expression                                      | Notes                                  |
| -------------- | ---- | ------------------------------------------------ | -------------------------------------- |
| Company        | N:1  | `companyid`                                      | Or internal client team/group (Advanced) |
| Contact        | N:M  | `staff`/`clients`/`contractors` comma-strings; `/projects/{id}/contacts`; per-contact access `/projects/{id}/access/{contactid}` | |
| Task           | 1:N  | `/projects/{id}/tasks` or `/tasks?projectid=`    | Deleted with project                   |
| Time           | 1:N  | `/projects/{id}/time` or `/time?projectid=`      | Via tasks                              |
| File           | 1:N  | `/projects/{id}/files`, `/files?projectid=`      |                                        |
| Message        | 1:N  | `/projects/{id}/messages`                        | Discussions                            |
| SharedNote     | 1:N  | `/projects/{id}/sharednotes`                     |                                        |
| Expense        | 1:N  | `/projects/{id}/expenses`                        |                                        |
| Quote/Invoice  | 1:N  | `/projects/{id}/quotes`, `/invoices`             | Linked via `projectid`                 |
| Bookmark       | 1:N  | `/projects/{id}/bookmarks`                       | URL bookmarks                          |

---

### Task

**Resource path:** `/tasks`, `/tasks/{taskid}` + action paths; project-scoped `/projects/{id}/tasks`
**Description:** Unit of work inside a project (or a "General Task" under a category, with no project). Ordered (1, 1.1, 1.1.1 -- supports sub-tasks), assignable to multiple contacts, time-trackable, billable/taxable.
**CRUD:** Create (bulk -- array body, same project), Read, Update, Delete (cascades files/messages/time); actions: complete, reactivate, adjustdates, starttimer, stoptimer; bulk delete `PUT /tasks/delete`.

| Field         | Type    | Required | Writable | Description                                       | Example          |
| ------------- | ------- | -------- | -------- | ------------------------------------------------- | ---------------- |
| id            | integer | --       | no       | Unique identifier                                 | `14`             |
| name          | string  | create   | yes      | Task name                                         | `"Draft homepage copy"` |
| projectid     | integer | create*  | no       | Parent project (*or `categoryid` for General Task)| `6`              |
| categoryid    | integer | create*  | yes      | Category for General Tasks (settings/tasks/categories) | `1`         |
| contacts      | string  | no (default `me`) | yes | **COMMA-STRING**: `"me"`, `"1,2"`, `"all"`, `"allstaff"`, `"none"` -- NOT an array [CONFIRMED] | `"me"` |
| description   | string  | no       | yes      | Description                                       |                  |
| status        | string  | --       | via actions | `active` / `complete`                          | `"active"`       |
| type          | string  | no       | yes      | `normal` / `bold` / `heading`                     | `"normal"`       |
| order / orderlevel | string | no    | create   | `auto`, `after{taskid}`, `before{taskid}`, or explicit `1.1`; level `normal`/`sub`/`subsub` | `"auto"` |
| priority      | integer | no (default 3) | yes | 1-5 = Very High → Very Low                       | `2`              |
| startdate / duedate / completedate | date | no | yes | yyyy-mm-dd or relative                      | `"+1w"`          |
| timeallocated | integer | no (default 0) | yes | Budgeted MINUTES                                 | `120`            |
| billable / taxable | boolean | no (default true) | yes | Billing flags                            | `true`           |
| prerequisites | string  | no       | yes      | Comma-string of task IDs (or `newX` refs in bulk add); `none` clears | `"1,2,new2"` |
| servicename / servicedescription / servicerate | string/number | no | yes | Service-billing fields    | `150.00`         |
| tagid, tasklistid, apifields | --  | no       | yes      | Taxonomy / list / custom values                   |                  |

List filter `status` defaults to **`active`**; sort default `id asc`.

**Relationships:** Project N:1; Contacts N:M (`/tasks/{id}/contacts` to manage); Time 1:N (`/tasks/{id}/time`); Files 1:N (`/tasks/{id}/files`); Messages 1:N (`/tasks/{id}/messages`); Prerequisite tasks N:M within the same project.

---

### Time Record

**Resource path:** `/time`, `/time/{timerecordid}`, `/time/activetimers`, task-scoped `/tasks/{taskid}/time`
**Description:** Minutes tracked by a contact against a task. `/time` doubles as a reporting endpoint (totals + `subtotals=` grouping). **List collection key is `timerecords`.** [CONFIRMED -- live API test 2026-06-10]
**CRUD:** Create, Read, Update, Delete; running-timer stop via `/time/{id}/stoptimer`.

| Field       | Type    | Required | Writable | Description                                              | Example              |
| ----------- | ------- | -------- | -------- | -------------------------------------------------------- | -------------------- |
| id          | integer | --       | no       | Unique identifier                                        | `21`                 |
| taskid      | integer | create (on /time) | no | Task the time belongs to (implicit on /tasks/{id}/time) | `14`             |
| contactid   | integer/`me` | no (default `me`) | yes | Who tracked the time                          | `"me"`               |
| timetracked | integer | see combos | yes    | **MINUTES** -- `timeminutes` does NOT exist [CONFIRMED]   | `30`                 |
| starttime / endtime | datetime/`now` | see combos | yes | ISO8601 `yyyy-mm-ddThh:mm` or `now`           | `"2026-06-10T13:00"` |
| notes       | string  | no       | yes      | Free-text notes                                          | `"Drafted copy"`     |
| billable    | boolean | --       | via task | Inherited from task billable flag                        |                      |
| approvalstatus | string | --      | no       | If time approval is enabled                              |                      |
| apifields   | array   | no       | yes      | API field values                                         |                      |

Valid creation combos: `starttime`+`endtime` | `starttime`+`timetracked` | `endtime`+`timetracked` | `timetracked` alone (end = now). [CONFIRMED -- live API test 2026-06-10]
GET `/time` defaults: `trackedfrom=-6d`, `trackedto=+0d` -- pass explicit dates for history. Supports `subtotals=` (company, project, task, contact, day/week/month...) returning `subtotals[]` + `total`.

---

### File

**Resource path:** `/files`, `/files/{fileid}`, `/files/folders`; scoped `/projects/{id}/files`, `/tasks/{id}/files`
**Description:** File metadata attached to a project, task, or folder. **Content download is NOT via REST** -- each file has a `link` to a signed `app.proworkflow.com/...getfilesattached.cfm?...sec_key=...` URL; fetch that link for bytes. [CONFIRMED -- live API test 2026-06-10]
**CRUD:** Create (base64 upload), Read (metadata), Delete.

| Field    | Type    | Required | Writable | Description                                          | Example          |
| -------- | ------- | -------- | -------- | ---------------------------------------------------- | ---------------- |
| id       | integer | --       | no       | Unique identifier                                    | `15`             |
| name     | string  | create   | no       | File name                                            | `"brief.pdf"`    |
| content  | string  | create   | no       | Base64-encoded content (upload only, never returned) | `"U29tZSB0ZXh0"` |
| projectid / taskid / folderid | integer | exactly one on create | no | Attachment target (projectid also accepts a Project Request ID) | `6` |
| size     | integer | --       | no       | Bytes                                                |                  |
| date     | string  | --       | no       | Upload date                                          |                  |
| link     | string  | --       | no       | Signed download URL (app.proworkflow.com)            |                  |
| contacts | mixed   | --       | no       | `"all"` if public, else array of allowed contacts    |                  |
| folder   | object  | --       | no       | `{id, name}` when in a folder                        |                  |

Default list fields: `name,project,task,date,size,link`. List `projectstatus` filter defaults to `active`.

---

### Message

**Resource path:** `/messages`, `/messages/{messageid}`; scoped `/projects/{id}/messages`, `/tasks/{id}/messages`
**Description:** Discussion threads on a project or task. A root message starts a discussion; replies reference `originalmessageid`. Can attach already-uploaded files.
**CRUD:** Create, Read, Update, Delete.

| Field             | Type    | Required        | Writable | Description                                      | Example          |
| ----------------- | ------- | --------------- | -------- | ------------------------------------------------ | ---------------- |
| id                | integer | --              | no       | Unique identifier                                | `30`             |
| title             | string  | create (new discussion) | yes | **`title`, NOT `subject`** [CONFIRMED]      | `"Kickoff"`      |
| content           | string  | create          | yes      | Message body                                     |                  |
| contacts          | string  | create (new discussion) | yes | Comma-string of contact IDs / `me` / `all` | `"1,2"`          |
| projectid / taskid| integer | one, for new discussion | no | Discussion target                          | `6`              |
| originalmessageid | integer | for replies     | no       | Root message of the thread                       | `30`             |
| files             | string  | no              | yes      | Comma-string of file IDs (same project)          | `"15"`           |
| public            | boolean | no (default true) | yes    | Public vs private discussion                     | `true`           |
| notifications     | boolean | no (default true) | yes    | Email notifications on/off                       | `true`           |

---

### Note (general) and Entity Notes

**Resource paths:** general `/notes`, `/notes/{noteid}`; entity-scoped `/companies/{id}/notes`, `/contacts/{id}/notes`
**Description:** Two flavours. **General notes** live under a note category and are assigned to contacts. **Entity notes** hang directly off a company or contact.
**CRUD:** Create, Read, Update, Delete (both flavours).

| Flavour       | Required on create                        | Optional         | Notes                                         |
| ------------- | ----------------------------------------- | ---------------- | --------------------------------------------- |
| General note  | `title`, `content`, `categoryid`          | `contacts` (default `all`) | Categories from `/settings/notes/categories` |
| Company/contact note | `content`                          | `title`          | 400 `"'content' is a required field"` without content [CONFIRMED -- live API test 2026-06-10] |

### Shared Note

**Resource path:** `/sharednotes`, `/sharednotes/{noteid}`; scoped `/projects/{id}/sharednotes`
**Description:** Project-level notes visible to everyone on the project (subject to permissions).
**CRUD:** Create, Read, Update, Delete. Required on create: `projectid`, `title`; `content` optional.

---

### Quote

**Resource path:** `/quotes`, `/quotes/{quoteid}` + `/approve`, `/decline`, `/markaspending`; lines `/quotes/{id}/lines`, `/quotes/{id}/lines/{lineid}`, cross-quote `/quotes/lines`; scoped `/projects/{id}/quotes`, `/companies/{id}/quotes`
**Description:** A quote or estimate for a client contact, optionally attached to a project. Built from typed lines. Reporting endpoint supports totals/`subtotals=`.
**CRUD:** Create, Read, Update, Delete; lifecycle approve / decline / markaspending; line CRUD.

| Field       | Type    | Required | Writable | Description                                      | Example       |
| ----------- | ------- | -------- | -------- | ------------------------------------------------ | ------------- |
| id          | integer | --       | no       | Unique identifier                                | `9`           |
| number      | string  | no       | create   | Display number; `"auto"` supported               | `"Q-0042"`    |
| title       | string  | create   | yes      | Title                                            |               |
| contactid   | integer | create   | yes      | Client contact                                   | `20`          |
| projectid   | integer | no       | yes      | Linked project (also settable at approve time)   | `6`           |
| lines       | array   | create   | yes      | Typed lines, see below                           |               |
| status      | string  | --       | via actions | `pending` / `approved` / `declined`           | `"pending"`   |
| type        | string  | no       | yes      | `quote` / `estimate`                             | `"quote"`     |
| quoteddate / approveddate / validtodate | date | no | yes | Lifecycle dates                       |               |
| description, address1..3, city, state, zipcode, country | string | no | yes | Header/address     |               |
| taxable / taxrate | boolean/number | no | yes | Tax handling                                  |               |
| totals      | object  | --       | no       | sub/tax/grand totals (computed)                  |               |

**Line types** (each line needs `type`): `heading` (name) · `lineitem` (name or description + `quantity` + `rate`) · `taskrate` (name + `time` minutes + `rate`) · `staffrate` (name + `time` + `rate`). Optional `taxable` per line.
List filter `status` defaults to **`pending`** (`active` = pending+approved; `all` for everything).

### Invoice

**Resource path:** `/invoices`, `/invoices/{invoiceid}` + `/markaspaid`, `/markasunpaid`; lines `/invoices/{id}/lines[/{lineid}]`; `/invoices/overdue`; scoped `/projects/{id}/invoices`, `/companies/{id}/invoices`
**Description:** Same line-based structure as quotes, billed to a company + contact. Paid/unpaid state machine. Reporting endpoint supports totals/`subtotals=`.
**CRUD:** Create, Read, Update, Delete; markaspaid / markasunpaid; line CRUD.

Key fields mirror Quote plus: `companyid` (REQUIRED on create, alongside `contactid` and `lines`), `invoiceddate`, `duedate`, `paiddate`, `status` (`paid` / `unpaid`). List filter `status` defaults to **`unpaid`**.

---

### Expense

**Resource path:** `/expenses`, `/expenses/{expenseid}`; scoped `/projects/{id}/expenses`
**Description:** A cost recorded against a project.
**CRUD:** Create, Read, Update, Delete.

| Field     | Type    | Required | Writable | Description              | Example      |
| --------- | ------- | -------- | -------- | ------------------------ | ------------ |
| id        | integer | --       | no       | Unique identifier        | `4`          |
| projectid | integer | create   | no       | Parent project           | `6`          |
| name      | string  | create   | yes      | Expense name             | `"Stock photos"` |
| cost      | number  | create   | yes      | Cost                     | `100.00`     |
| date      | date    | no       | yes      | yyyy-mm-dd or relative   | `"2026-06-10"` |
| description | string | no      | yes      |                          |              |
| invoiced  | boolean | no (default false) | yes | Billed on yet?    | `false`      |
| taxable   | boolean | no (default true)  | yes |                   | `true`       |

### Event

**Resource path:** `/events`, `/events/{eventid}`
**Description:** Calendar events for staff contacts (meetings, leave, etc.). Not linked to projects.
**CRUD:** Create, Read, Update, Delete. Required on create: `title`, `starttime`, `endtime` (ISO8601 `yyyy-mm-ddThh:mm` or `now`); `contacts` comma-string defaults to `me`; `description` optional.

---

### Project Request

**Resource path:** `/projectrequests`, `/projectrequests/{id}` + `/approve`, `/decline`
**Description:** An inbound request for a new project (typically raised by clients). Approving converts it into a Project; files can be attached by POSTing to `/files` with `projectid` = the REQUEST id.
**CRUD:** Create, Read, Update, Delete; approve / decline.

| Field     | Type    | Required | Writable | Description                                       | Example   |
| --------- | ------- | -------- | -------- | -------------------------------------------------- | --------- |
| id        | integer | --       | no       | Unique identifier                                  | `3`       |
| title     | string  | create   | yes      | Request title (only required field)                |           |
| description | string | no      | yes      |                                                    |           |
| budget    | number  | no       | yes      | Requested budget                                   | `5000.00` |
| contactid / divisionid / groupid | integer | no (Advanced) | yes | Who the request is submitted to |     |
| startdate / duedate | date | no  | yes      | Requested dates                                    |           |
| templateid | integer | no      | create   | Project template to apply (Advanced)               |           |
| customfields / apifields | array | no | yes  | Custom values                                      |           |
| status    | string  | --       | via actions | pending / approved / declined                   |           |

On approve: Solo/Professional plans assign the approver as Project Manager; Advanced assigns the contact the request was submitted to. Optional approve params: `number` (default `auto`), `clientaccess`, `emailalerts`, `autonumberid`.

---

### Tags, Categories, Custom Statuses, Custom/API Fields (taxonomy & settings)

**Resource paths:** under `/settings/...` -- read these to resolve IDs before filtering or creating:

| Taxonomy            | Path                                        | Used by                                  |
| ------------------- | ------------------------------------------- | ---------------------------------------- |
| Project categories  | `/settings/projects/categories[/{id}]`      | `categoryid` on projects                 |
| Task categories     | `/settings/tasks/categories[/{id}]`         | `categoryid` on General Tasks            |
| Note categories     | `/settings/notes/categories[/{id}]`         | `categoryid` on general notes (REQUIRED) |
| Project/task/contact tags | `/settings/projects/tags`, `/settings/tasks/tags`, `/settings/contacts/tags` | `tagid` filters/params |
| Custom statuses     | `/settings/projects/customstatuses[/{id}]`  | `customstatusid` (Advanced plan)         |
| Custom fields       | `/settings/projects/customfields`           | `customfields: [{id, value}]` (Advanced) |
| API fields          | `/settings/apifields[/{fieldid}]`           | API-only fields on company/contact/invoice/project/quote/task/time; set via `apifields: [{id, value}]`, filter via `apifields=ID,string` |
| Templates           | `/settings/projects/templates`, `/settings/tasks/templates` | `templateid` on create   |
| Rates               | `/settings/servicerates`, `/settings/staffrates`, `/settings/{invoices,quotes}/{hourlyrates,staffrates}` | Pricing lookups |
| Teams/groups/divisions | `/settings/contacts/teams`, `/groups`, `/divisions` | Advanced-plan org structure     |
| Webhooks            | `/settings/webhooks[/{id}]`, `/settings/webhooks/requests` | Event subscriptions (no Numa receiver) |

Custom fields vs API fields: **custom fields** (Advanced) appear in the ProWorkflow UI; **API fields** are invisible in the UI and exist only through the API.

### Workload (computed view)

**Resource path:** `/workload` (GET only)
**Description:** Minutes of scheduled task work (or availability with `mode=availability`, `availableminutes` default 480) per staff contact per day, weekends excluded from calculation. `datefrom`/`dateto` (defaults `+0d`/`+2w`) **must be today or later** [CONFIRMED -- live API test 2026-06-10]. Overdue tasks are NOT counted.

---

## Entity Relationship Diagram

```
┌──────────┐ 1:N ┌──────────┐ 1:N  ┌──────────┐ 1:N ┌─────────────┐
│ Company  │────>│ Contact  │      │ Project  │────>│    Task     │
└──────────┘     └──────────┘      └──────────┘     └─────────────┘
     │ 1:N            │ N:M (staff/  ▲   │ 1:N           │ 1:N
     │                │  clients/    │   ├─> File        ├─> Time Record
     ▼                ▼  contractors)│   ├─> Message     ├─> File
┌──────────┐     assignments ───────┘   ├─> SharedNote  ├─> Message
│ Project  │                            ├─> Expense     └─> (prereq Tasks)
└──────────┘                            ├─> Quote ──> Quote Lines
┌─────────────────┐  approve            └─> Invoice ──> Invoice Lines
│ Project Request │────────> Project
└─────────────────┘                 ┌────────────────────────────────┐
┌──────────┐                        │ settings/: categories, tags,   │
│  Event   │ (staff calendar,       │ custom statuses, custom fields,│
└──────────┘  no project link)      │ api fields, templates, rates   │
                                    └────────────────────────────────┘
```

---

## State Machines

### Project Lifecycle

```
[active] ──PUT /projects/{id}/complete──> [complete]
   ▲                                          │
   └──────PUT /projects/{id}/reactivate───────┘
```

| From     | Action / Trigger                  | To       | Reversible? | Side Effects                                              |
| -------- | --------------------------------- | -------- | ----------- | ---------------------------------------------------------- |
| active   | PUT /projects/{id}/complete       | complete | Yes         | **Completes all active tasks in the project**; optional `completedate` |
| complete | PUT /projects/{id}/reactivate     | active   | Yes         | Does NOT reactivate tasks -- reactivate each task separately |
| (create) | POST with `completedate` set      | complete | Yes         | Added directly as completed; no alerts sent                 |
| any      | DELETE /projects/{id}             | (gone)   | No          | **Deletes all associated tasks** [CONFIRMED]                |

### Task Lifecycle

```
[active] ──PUT /tasks/{id}/complete──> [complete]
   ▲  │                                    │
   │  └─ starttimer/stoptimer (running timer adds time records)
   └──────PUT /tasks/{id}/reactivate───────┘
```

| From     | Action                          | To       | Reversible? | Side Effects                                          |
| -------- | ------------------------------- | -------- | ----------- | ------------------------------------------------------ |
| active   | PUT /tasks/{id}/complete `{}`   | complete | Yes         | Optional `completedate`; 200 "Task Completed" [CONFIRMED] |
| complete | PUT /tasks/{id}/reactivate      | active   | Yes         |                                                        |
| active   | PUT /tasks/{id}/starttimer      | active   | --          | Stops any other running timer for the user             |
| active   | PUT /tasks/{id}/stoptimer       | active   | --          | Creates a time record from the timer                   |
| any      | DELETE /tasks/{id} or PUT /tasks/delete | (gone) | No    | Deletes the task's files, messages, time records       |

### Quote Lifecycle

```
[pending] ──/approve──> [approved]
    │  ▲                    │
    │  └──/markaspending────┤   (also from declined)
    └──/decline──> [declined]
```

| From              | Action                          | To       | Reversible?            | Side Effects                                  |
| ----------------- | ------------------------------- | -------- | ---------------------- | ---------------------------------------------- |
| pending           | PUT /quotes/{id}/approve        | approved | Yes (markaspending)    | Optional `approveddate`, `projectid` to attach |
| pending           | PUT /quotes/{id}/decline        | declined | Yes (markaspending)    | Staff acts on behalf of client                 |
| approved/declined | PUT /quotes/{id}/markaspending  | pending  | --                     | Reverts the decision                           |

### Invoice Lifecycle

```
[unpaid] ──/markaspaid──> [paid]
    ▲                        │
    └─────/markasunpaid──────┘
```

Optional `paiddate` on markaspaid. `/invoices/overdue` lists unpaid invoices past `duedate`.

### Project Request Lifecycle

```
[pending] ──/approve──> [approved] (a Project is created)
    └──────/decline──> [declined]
```

Approve creates the project (optional `number`, `clientaccess`, `emailalerts`); manager assignment depends on plan (see entity section). Not reversible via API.

---

## Business Rules

### Ordering / Dependency Rules

- Company before Contact (`companyid` required on contact create); Company (or internal client, Advanced) before Project; Project before Task/Quote-attachment/Expense/Message/SharedNote/File.
- Tasks need `projectid` OR `categoryid` (General Task) -- exactly one.
- Bulk task creation: all tasks in one POST must share the same `projectid`/`categoryid`; `prerequisites` can reference sibling new tasks as `new1`, `new2`...
- Files attach to exactly one of `projectid` / `taskid` / `folderid`; message file attachments must already be uploaded to the same project.
- Time records require an existing task (`taskid`).
- Resolve taxonomy IDs (`categoryid`, `tagid`, `customstatusid`, apifield ids) from `/settings/...` before writing.

### Field-Level Rules

- Comma-string convention: `contacts`, `staff`, `clients`, `contractors`, `prerequisites`, `taskid` (bulk delete), `files` are comma-separated ID strings -- never JSON arrays [CONFIRMED -- live API test 2026-06-10].
- `timetracked`/`timeallocated` are integer MINUTES.
- `priority` is 1-5 (1 = Very High, 5 = Very Low; task default 3).
- Quote/invoice lines must carry a valid `type` with that type's required fields.
- `/workload` dates must be today or later.
- Search params are case-insensitive substring matches; prefix `!` negates most search/ID filters (`search=!layout`, `categoryid=!1,2`).

### Cascading Effects

- DELETE project → deletes all its tasks [CONFIRMED]; DELETE task / PUT /tasks/delete → deletes its files, messages, time records.
- DELETE company → may optionally delete associated contacts.
- Complete project → completes its active tasks; reactivate project → does NOT reactivate tasks.
- Starting a timer stops any other running timer for that user.

### Computed / Read-Only Fields

- `id`, `lastmodified` are server-set; `id` always returned regardless of `fields`.
- `percentcomplete`, `timetracked`, `burn`, quote/invoice `totals`, `/workload` numbers are computed.
- `quotetotal`/`invoicetotal` on projects accept the literal `"auto"` to track the sum of attached quotes/invoices.
- **PUT semantics:** omitted fields keep their values; an explicitly EMPTY value clears the field.

---

## Field Format Reference

| Format        | Pattern                 | Example                 | Notes                                                       |
| ------------- | ----------------------- | ----------------------- | ------------------------------------------------------------ |
| Date          | `YYYY-MM-DD`            | `2026-06-24`            | All date params/filters                                       |
| DateTime      | ISO8601, NO timezone    | `2026-06-10T13:00`      | starttime/endtime, lastmodified; rendered in the user's local time |
| Relative date | `+/-X` + `n/h/d/w/m/y`  | `+1w`, `-2d`, `15n`     | **`n` = minutes, `m` = months** [CONFIRMED]; valid in filters AND date fields |
| Currency      | plain number            | `1000.00`               | No symbol; account currency from `/login` / `/settings/account` |
| ID            | integer                 | `6`                     | All URL ids; `me` substitutes a contact id in params          |
| Display number| string                  | `P-0103`                | Projects/quotes/invoices; `"auto"` on create [CONFIRMED]      |
| File content  | base64 string           | `U29tZSB0ZXh0`          | Upload only; download via signed `link`                       |
| List strings  | comma-separated         | `"1,2,3"`, `"me"`       | Contacts/IDs in bodies and filters                            |

---

## Enum Value Reference

| Entity         | Field            | Allowed Values                                              | Default    | Notes                                          |
| -------------- | ---------------- | ------------------------------------------------------------ | ---------- | ----------------------------------------------- |
| Company        | type             | `client`, `contractor`, `staff`, `other`                     | --         | `staff` is your own org (usually one)           |
| Contact        | type             | `staff`, `client`, `contractor`, `other`                     | --         | Only staff appear in `/workload`                |
| Project        | status (filter)  | `active`, `complete`, `all`                                  | `active`   | [CONFIRMED -- live API test 2026-06-10]         |
| Project        | priority         | `1`-`5` (Very High → Very Low)                               | --         |                                                 |
| Project        | sortby           | `id`, `title`, `number`, `startdate`, `duedate`, `completedate`, `categoryname`, `companyname`, `priority` | `number` | |
| Task           | status (filter)  | `active`, `complete`, `all`                                  | `active`   |                                                 |
| Task           | type             | `normal`, `bold`, `heading` (filter adds `nonheading`, `all`)| `normal`   | Headings excluded from percentcomplete          |
| Task           | contacts         | comma IDs, `me`, `all`, `allstaff`, `none`                   | `me`       | STRING, not array [CONFIRMED]                   |
| Task           | order            | `auto`, `after{taskid}`, `before{taskid}`, explicit `1.1`    | `auto`     | after/before need Smart Ordering enabled        |
| Task           | orderlevel       | `normal`, `sub`, `subsub`                                    | `normal`   |                                                 |
| Quote          | status (filter)  | `pending`, `approved`, `active` (pend+appr), `declined`, `all` | `pending` |                                                |
| Quote          | type             | `quote`, `estimate` (filter adds `all`)                      | `all` (filter) |                                             |
| Quote/Invoice  | lines[].type     | `heading`, `lineitem`, `taskrate`, `staffrate`               | --         | Each type has its own required fields           |
| Invoice        | status (filter)  | `paid`, `unpaid`, `all`                                      | `unpaid`   |                                                 |
| Time           | trackedfrom/to   | dates/relative                                               | `-6d`/`+0d`| Reporting window default                        |
| Time/billable  | timebillable     | `all`, `billable`, `nonbillable`                             | `all`      | Filter on projects/tasks/time                   |
| Workload       | mode             | `workload`, `availability`                                   | `workload` | availability = availableminutes - workload      |
| Sort (global)  | sortorder        | `asc`, `desc`                                                | `asc`      |                                                 |
| Webhook        | event            | `new/edit/delete` × contact, company, file, invoice, message, project, projectrequest, quote, sharednote, task, time; plus `completeproject`, `reactivateproject`, `completetask`, `reactivatetask`, `approveprojectrequest`, `declineprojectrequest`, `newpendingcontact`, `newpendingcompany` | -- | `/settings/webhooks`; no Numa receiver |

---

_Generated from the investigation questionnaire (Phase 3) + live API testing 2026-06-10._
