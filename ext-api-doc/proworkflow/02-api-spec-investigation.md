---
api_name: 'ProWorkflow'
api_slug: 'proworkflow'
base_url: 'https://api.proworkflow.net'
version: 'unversioned'
spec_format: 'none' # HTML docs only — no OpenAPI/Swagger
spec_url: ''
docs_url: 'https://api.proworkflow.net'
date_researched: '2026-06-10'
generated_date: '2026-06-10'
---

# ProWorkflow — API Specification & Investigation

> Clean developer reference for the ProWorkflow REST API — the condensed output of
> `00-api-investigation-questionnaire.md`. Compiled from the official per-call documentation
> (full reference dump, all 164 paths) and **live testing against a real trial account**
> (account "ArcanumAI", Advanced plan, 2026-06-10).
>
> Confidence tags: `[CONFIRMED — live API test 2026-06-10]` = verified against the live API.
> `[DOCS]` = official documentation, not independently re-verified. `[INFERRED]` = deduced from doc parse.

---

## Overview

- **Vendor:** ProActive Software Ltd (ProWorkflow)
- **API version:** Unversioned — no version segment, header, or changelog
- **Base URL:** `https://api.proworkflow.net` (single shared host for ALL accounts; tenant selected by credentials) [CONFIRMED — live API test 2026-06-10]
- **Sandbox URL:** None — use a free trial account (trials get full API access)
- **API type:** REST
- **Data format:** JSON only (responses and POST/PUT bodies); HTTPS mandatory
- **Documentation:** https://api.proworkflow.net (HTML; the API host doubles as the docs site)
- **OpenAPI spec:** Not available
- **Status page:** Not available
- **Scale:** 164 documented paths / 283 operations [INFERRED — parsed from the official per-call reference]

**Summary:** ProWorkflow is project-management SaaS (projects, tasks, time tracking, invoicing, quoting) used by agencies and professional-services firms. The API exposes full CRUD over the whole domain plus webhooks, ETags, API-only custom fields, and per-user permission enforcement.

**Numa integration model:** Native data connector (NOT Pipedream). The workspace agent calls
`connectors(name="request", params={connector: "proworkflow", url: "/projects?pagesize=20&pagenumber=1", method: "GET", body: {...}})`.
The Numa backend expands relative URLs against the stored base URL and **automatically injects both auth headers** — the agent never sets `Authorization` or `apikey` and never sees the secrets.

---

## Authentication

### Method: Dual — account API key + per-user HTTP Basic auth (BOTH mandatory on every request)

[CONFIRMED — live API test 2026-06-10]

1. **Account API key** — identifies the tenant. Send as `apikey: <key>` header (recommended) or `?apikey=` URL/body parameter.
2. **HTTP Basic auth** — identifies the user. Username **or email** + password. The user's main-app permissions ("View Work" rules, login revocation) are enforced server-side on every call.

**Header format:**

```
apikey: XXXX-XXXX-XXXX-XXXX-XXXXXXX-XXXXXXXX
Authorization: Basic base64(email:password)
Content-Type: application/json        (POST/PUT with body)
```

**Bootstrap / key discovery** [CONFIRMED — live API test 2026-06-10]:

- `GET /login?url=<accounturl-slug>` — works with **Basic auth only** (no apikey). Returns account details including `apikey`, `accounturl`, `plan`, `permissions`, `currency`, and the caller's id/email. The slug is the path segment of the account's app URL (`https://app.proworkflow.com/ArcanumAI` → `url=arcanumai`, case-insensitive). The owner can disable apikey visibility via this call.
- `GET /settings/account/looknfeel` — the only call requiring ONLY the apikey (pre-login theming) [DOCS].

**Failure behavior** [CONFIRMED — live API test 2026-06-10]:

- Wrong API key OR wrong password → **401 with an EMPTY body** (no JSON). The two failure causes are indistinguishable from the response.
- Permission denial → 403. Permissions can change mid-session; handle 401/403 on any call.

**Credential lifetime:** Static (no tokens, no expiry, no refresh). Key rotation is an account-owner action in the main app.

**Numa secret placement:**

| Credential          | Where stored                                  | Who supplies it                      |
| ------------------- | --------------------------------------------- | ------------------------------------ |
| Account API key     | `connector-config-proworkflow` company secret | Admin, via the connector wizard      |
| User email+password | User's personal vault                         | Each user, prompted in chat on first use |

ProWorkflow enforces each user's own permissions, so a shared account key cannot escalate privileges.

---

## Endpoint Catalog

> All paths relative to `https://api.proworkflow.net`. Methods listed are the documented operations per path
> [DOCS; key flows CONFIRMED live]. "Paged" = supports `pagesize`+`pagenumber`. All endpoints require dual auth
> except `/login` (Basic only) and `/settings/account/looknfeel` (apikey only).

### Companies (15 paths)

| Method        | Path                                  | Purpose                                            |
| ------------- | ------------------------------------- | -------------------------------------------------- |
| GET, POST     | `/companies`                          | List (paged, filterable) / add company-or-companies (array = batch) |
| GET, PUT, DELETE | `/companies/{companyid}`           | View / edit / delete (delete may optionally remove contacts) |
| GET, POST     | `/companies/{companyid}/contacts`     | List / add contacts for a company                  |
| GET           | `/companies/{companyid}/invoices`     | Invoices for a company                             |
| GET, POST     | `/companies/{companyid}/notes`        | List / add notes                                   |
| GET, DELETE   | `/companies/{companyid}/notes/{noteid}` | View / delete a note                             |
| GET, POST     | `/companies/{companyid}/projects`     | List / add projects for a company                  |
| GET           | `/companies/{companyid}/quotes`       | Quotes for a company                               |
| GET           | `/companies/{companyid}/summary`      | Aggregated summary                                 |
| GET, PUT      | `/companies/{companyid}/tags`         | View / set tags                                    |
| GET           | `/companies/{companyid}/tasks`        | Tasks for a company                                |
| GET           | `/companies/{companyid}/time`         | Time tracked for a company                         |
| GET           | `/companies/client` · `/companies/contractor` · `/companies/staff` | Pre-filtered lists by type |

[CONFIRMED — live API test 2026-06-10]: `POST /companies/{id}/notes` requires `content` (400 `"'content' is a required field"`); `title` optional; 201 → `details: [{id}]`.

### Contacts (20 paths)

| Method        | Path                                       | Purpose                                          |
| ------------- | ------------------------------------------ | ------------------------------------------------ |
| GET, POST     | `/contacts`                                | List (paged; `searchname` filter) / add (array = batch) |
| GET, PUT, DELETE | `/contacts/{contactid}`                 | View (all fields) / edit / delete                |
| GET, PUT      | `/contacts/{contactid}/groups`             | View / set teams+groups (staff)                  |
| GET, PUT      | `/contacts/{contactid}/location`           | View / update location                           |
| GET, POST     | `/contacts/{contactid}/notes`              | List / add notes                                 |
| GET, DELETE   | `/contacts/{contactid}/notes/{noteid}`     | View / delete a note                             |
| GET           | `/contacts/{contactid}/permissions`        | All permissions for a contact                    |
| GET           | `/contacts/{contactid}/permissions/{permissionid}` | Check one permission                     |
| GET, POST     | `/contacts/{contactid}/projects`           | Projects for / add project for a contact         |
| GET, PUT      | `/contacts/{contactid}/roles`              | View / set roles (staff)                         |
| GET           | `/contacts/{contactid}/summary`            | Contact summary                                  |
| GET, PUT      | `/contacts/{contactid}/tags`               | View / set tags                                  |
| GET           | `/contacts/{contactid}/tasks`              | Tasks for a contact                              |
| GET           | `/contacts/{contactid}/time`               | Time tracked by a contact                        |
| GET           | `/contacts/client` · `/contacts/contractor` · `/contacts/staff` | Pre-filtered lists          |
| GET           | `/contacts/forgotpassword`                 | Trigger a password reset                         |
| GET           | `/contacts/location`                       | All contact locations                            |
| POST          | `/contacts/requestaccess`                  | Request access to ProWorkflow                    |

### Login & Me (2 paths)

| Method   | Path     | Purpose                                                                       |
| -------- | -------- | ------------------------------------------------------------------------------ |
| GET      | `/login` | Account + caller details; `?url=<slug>` returns the apikey (Basic auth only) [CONFIRMED] |
| GET, PUT | `/me`    | View / edit the contact making the request [CONFIRMED — singular envelope `{"contact": {...}}`] |

### Projects (20 paths)

| Method        | Path                                       | Purpose                                                  |
| ------------- | ------------------------------------------ | --------------------------------------------------------- |
| GET, POST     | `/projects`                                | List (paged; **defaults to ACTIVE**) / create [CONFIRMED] |
| GET, PUT, DELETE | `/projects/{projectid}`                 | View / edit / **delete (cascades to ALL its tasks)** [CONFIRMED] |
| GET           | `/projects/{projectid}/access/{contactid}` | Check a contact's access                                  |
| PUT           | `/projects/{projectid}/adjustdates`        | Shift project and/or task dates                           |
| GET, POST     | `/projects/{projectid}/bookmarks`          | List / add bookmarks                                      |
| GET, PUT, DELETE | `/projects/{projectid}/bookmarks/{bookmarkid}` | View / edit / delete bookmark                      |
| PUT           | `/projects/{projectid}/complete`           | Complete project                                          |
| GET, PUT      | `/projects/{projectid}/contacts`           | View / set assigned contacts                              |
| GET, POST     | `/projects/{projectid}/expenses`           | List / add expenses                                       |
| GET, POST     | `/projects/{projectid}/files`              | List / add files                                          |
| GET, POST     | `/projects/{projectid}/invoices`           | List / add invoices                                       |
| GET, POST     | `/projects/{projectid}/messages`           | List / add messages                                       |
| GET, POST     | `/projects/{projectid}/quotes`             | List / add quotes                                         |
| PUT           | `/projects/{projectid}/reactivate`         | Reactivate completed project                              |
| GET, PUT      | `/projects/{projectid}/settings`           | View / edit project settings                              |
| GET, POST     | `/projects/{projectid}/sharednotes`        | List / add shared notes                                   |
| GET, POST     | `/projects/{projectid}/tasks`              | List / add tasks                                          |
| GET           | `/projects/{projectid}/time`               | Time for a project                                        |
| GET           | `/projects/overdue` · `/projects/overtime` | Overdue / over-allocated-time projects                    |

### Tasks (14 paths)

| Method        | Path                              | Purpose                                                              |
| ------------- | --------------------------------- | --------------------------------------------------------------------- |
| GET, POST     | `/tasks`                          | List (paged) / add task(s) — array = batch, same project/category [CONFIRMED single create] |
| GET, PUT, DELETE | `/tasks/{taskid}`              | View / edit / delete                                                  |
| PUT           | `/tasks/{taskid}/adjustdates`     | Shift task dates                                                      |
| PUT           | `/tasks/{taskid}/complete`        | Complete — empty body `{}` → 200 "Task Completed" [CONFIRMED]        |
| GET, PUT      | `/tasks/{taskid}/contacts`        | View / set assigned contacts (CSV string)                             |
| GET, POST     | `/tasks/{taskid}/files`           | List / add files                                                      |
| GET, POST     | `/tasks/{taskid}/messages`        | List / add messages                                                   |
| PUT           | `/tasks/{taskid}/reactivate`      | Reactivate completed task                                             |
| PUT           | `/tasks/{taskid}/starttimer` · `/tasks/{taskid}/stoptimer` | Timer control                               |
| GET, POST     | `/tasks/{taskid}/time`            | List / add time for a task                                            |
| PUT           | `/tasks/delete`                   | **Bulk delete tasks (note: PUT, not DELETE)**                         |
| GET           | `/tasks/overdue` · `/tasks/overtime` | Overdue / over-time tasks                                          |

### Time (4 paths)

| Method        | Path                                | Purpose                                                            |
| ------------- | ----------------------------------- | ------------------------------------------------------------------ |
| GET, POST     | `/time`                             | List (paged; `subtotals=` support) / add a time record [CONFIRMED] |
| GET, PUT, DELETE | `/time/{timerecordid}`           | View / edit / delete                                               |
| PUT           | `/time/{timerecordid}/stoptimer`    | Stop a running timer                                               |
| GET           | `/time/activetimers`                | List active timers                                                 |

### Files (4 paths)

| Method        | Path                         | Purpose                                                                |
| ------------- | ---------------------------- | ----------------------------------------------------------------------- |
| GET, POST     | `/files`                     | List (paged; `search`, `projectid`, `taskid`, `folderid` filters) / upload (base64 `content`; exactly one of project/task/folder) |
| GET, DELETE   | `/files/{fileid}`            | Metadata (+`?content=true` base64, **≤ 1 MB only**) / delete            |
| GET, POST     | `/files/folders`             | List / add custom folders                                               |
| GET           | `/files/folders/{folderid}`  | View a custom folder                                                    |

[CONFIRMED — live API test 2026-06-10]: file objects carry a `link` to `app.proworkflow.com/...getfilesattached.cfm` with a `sec_key` — content for larger files downloads through that signed link, NOT a REST endpoint (and not with API auth headers).

### Invoices (7 paths)

| Method        | Path                                       | Purpose                                  |
| ------------- | ------------------------------------------ | ----------------------------------------- |
| GET, POST     | `/invoices`                                | List (paged; `total` in response) / add  |
| GET, PUT, DELETE | `/invoices/{invoiceid}`                 | View / edit / delete                      |
| GET, POST     | `/invoices/{invoiceid}/lines`              | List / add line items (array = batch)     |
| GET, PUT, DELETE | `/invoices/{invoiceid}/lines/{lineid}`  | View / edit / delete a line               |
| PUT           | `/invoices/{invoiceid}/markaspaid` · `.../markasunpaid` | Payment status verbs        |
| GET           | `/invoices/overdue`                        | Overdue invoices                          |

### Quotes (8 paths)

| Method        | Path                                  | Purpose                                  |
| ------------- | ------------------------------------- | ----------------------------------------- |
| GET, POST     | `/quotes`                             | List (paged; `total` in response) / add  |
| GET, PUT, DELETE | `/quotes/{quoteid}`                | View / edit / delete                      |
| PUT           | `/quotes/{quoteid}/approve` · `.../decline` · `.../markaspending` | Status verbs   |
| GET, POST     | `/quotes/{quoteid}/lines`             | List / add lines (array = batch)          |
| GET, PUT, DELETE | `/quotes/{quoteid}/lines/{lineid}` | View / edit / delete a line               |
| GET           | `/quotes/lines`                       | Lines across all quotes                   |

### Messages, Notes, Shared Notes, Events, Expenses, Project Requests (14 paths)

| Method        | Path                                          | Purpose                                                     |
| ------------- | --------------------------------------------- | ------------------------------------------------------------ |
| GET, POST     | `/messages`                                   | List / add — **requires `title` (NOT `subject`) + `contacts`** [CONFIRMED] |
| GET, PUT, DELETE | `/messages/{messageid}`                    | View / edit / delete                                         |
| GET, POST     | `/notes`                                      | List / add (`content` required) [CONFIRMED]                  |
| GET, PUT, DELETE | `/notes/{noteid}`                          | View / edit / delete                                         |
| GET, POST     | `/sharednotes`                                | List / add project shared notes                              |
| GET, PUT, DELETE | `/sharednotes/{noteid}`                    | View / edit / delete                                         |
| GET, POST     | `/events`                                     | List / add calendar events                                   |
| GET, PUT, DELETE | `/events/{eventid}`                        | View / edit / delete                                         |
| GET, POST     | `/expenses`                                   | List / add expenses                                          |
| GET, PUT, DELETE | `/expenses/{expenseid}`                    | View / edit / delete                                         |
| GET, POST     | `/projectrequests`                            | List / add project requests                                  |
| GET, PUT, DELETE | `/projectrequests/{projectrequestid}`      | View / edit / delete                                         |
| PUT           | `/projectrequests/{projectrequestid}/approve` · `.../decline` | Approve (→ becomes a Project) / decline      |

### Workload (1 path)

| Method | Path        | Purpose                                                                                          |
| ------ | ----------- | -------------------------------------------------------------------------------------------------|
| GET    | `/workload` | Per-staff per-day workload/availability in minutes. `datefrom`/`dateto` (defaults `+0d`/`+2w`) **must be today or later** — past dates → 400 [CONFIRMED]. `contacts=me|all|ids`, `mode=workload|availability`, `availableminutes` (default 480). Weekends excluded from calc; overdue tasks excluded. |

### Settings (55 paths)

Reference/config data. Pattern: collection `GET` (+`POST` where addable), item `GET/PUT/DELETE` where editable.

| Group              | Paths                                                                                                   | Methods                              |
| ------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Account            | `/settings/account`, `.../license`, `.../looknfeel` (apikey-only), `.../plan`                            | GET only [plan envelope CONFIRMED: `{"settings": {...}}`] |
| API fields         | `/settings/apifields`, `/settings/apifields/{fieldid}`                                                   | GET, POST / GET, PUT, DELETE         |
| Contacts config    | `/settings/contacts/divisions(+/{id})`, `groups(+/{id})`, `permissions`, `roles(+/{id})`, `tags(+/{id})`, `teams(+/{id})` | List GET(+POST for groups/tags/teams); item GET,PUT,DELETE (roles/permissions read-only) |
| Fixed cost items   | `/settings/fixedcostitems`                                                                               | GET, POST                            |
| Invoices config    | `/settings/invoices/autonumbering`, `hourlyrates`, `staffrates`, `templates(+/{id})`                     | GET only                             |
| Notes config       | `/settings/notes/categories(+/{id})`                                                                     | GET, POST / GET, PUT, DELETE         |
| Projects config    | `/settings/projects`, `autonumbering`, `categories(+/{id})`, `customfields`, `customstatuses(+/{id})`, `tags(+/{id})`, `templates(+/{id})` | Mostly GET; categories/customstatuses/tags support POST + item PUT/DELETE |
| Quotes config      | `/settings/quotes`, `autonumbering`, `hourlyrates`, `staffrates`, `templates(+/{id})`                    | GET only                             |
| Rates              | `/settings/servicerates`, `/settings/staffrates`                                                         | GET only                             |
| Tasks config       | `/settings/tasks/categories(+/{id})`, `tags(+/{id})`, `templates(+/{tasktemplateid})`, `templates/{id}/tasks(+/{taskid})` | GET, POST / GET, PUT, DELETE |
| Webhooks           | `/settings/webhooks`, `/settings/webhooks/{webhookid}`, `/settings/webhooks/requests`                    | GET, POST / GET, PUT, DELETE / GET [list envelope CONFIRMED] |

**Totals: 164 paths / 283 operations** [INFERRED — parsed from the official reference dump].

---

## Response Envelope

[CONFIRMED — live API test 2026-06-10]

**List GET:** `{"count": N, "totalcount": M, "status": "Success", "<collection>": [...]}` — the collection key matches the URL tail (`contacts`, `projects`, `files`, `webhooks`...). Invoice/quote/time calls add a `total` (value) field. ALWAYS an array, even for one item.

**Single-item GET:** `{"<singular>": {...}, "count": 1, "status": "Success"}` — e.g. `/me` and `/contacts/{id}` return a `contact` object. Note `/settings/account/plan` uses key `settings`.

**Write success:** POST → **201** `{"message": "X Added", "status": "Success", "details": [{"id": N, ...}]}`; PUT/DELETE → **200** same shape. `details` is **ALWAYS an array** on success (one entry per item for batch adds).

**Error:** `{"status": "Error", "details": [...strings...]}` — but see Error Handling: `details` can be a bare string, and some responses aren't JSON at all.

---

## Data Models

> Field lists from official per-call docs + live responses. `id` is always present and read-only.
> Dates are ISO8601 **without timezone**; durations are integer minutes.

### Contact

| Field        | Type     | Required (add) | Writable | Description                                  |
| ------------ | -------- | -------------- | -------- | --------------------------------------------- |
| id           | int      | —              | no       | Unique ID                                     |
| firstname / lastname | string | yes      | yes      | Name                                          |
| type         | enum     | yes            | yes      | `staff` / `client` / `contractor`             |
| companyid    | int      | yes            | yes      | Owning company (`companyname` denormalized)   |
| email / username | string | no           | yes      | Email doubles as Basic-auth login             |
| allowlogin   | bool     | no             | yes      | Login access                                  |
| mobilephone / workphone / address1-3 / city / state / zipcode / country | string | no | yes | Contact details |
| divisionid   | int      | no             | yes      | Advanced plan                                 |
| lastmodified | datetime | —              | no       | For incremental sync                          |
| tags / teams / groups / notes / apifields | array | no | partial | Related collections             |

### Project

| Field        | Type       | Required (add) | Writable  | Description                                              |
| ------------ | ---------- | -------------- | --------- | --------------------------------------------------------- |
| id           | int        | —              | no        | Numeric ID (URLs)                                          |
| number       | string     | no (`"auto"`)  | yes       | Display number, e.g. `"P-0103"` — **distinct from id** [CONFIRMED] |
| title        | string     | **yes**        | yes       |                                                            |
| companyid    | int        | **yes**\*      | yes       | \*Advanced: or `internalclientcontactid` (+`internalclientgroupid`) |
| managerid    | int / `me` | no             | yes       | Advanced: `groupid` needed if manager in >1 group          |
| staff / clients / contractors | CSV string | no | yes  | Assigned contact IDs — **string, not array**               |
| startdate / duedate / completedate | date | no    | yes       | `yyyy-mm-dd` or relative; `completedate` on add ⇒ created completed |
| status       | enum       | —              | via verbs | `active` / `complete` (+custom statuses, Advanced)         |
| priority     | int        | no             | yes       |                                                            |
| categoryid / tags / customfields / apifields | various | no | yes | Classification; custom fields `[{id, value}]`  |
| budget, burn, timeallocated, timetracked, invoicetotal, expensestotal, percentcomplete | number | — | no | Computed rollups via `fields=` |
| lastmodified | datetime   | —              | no        |                                                            |

### Task

| Field      | Type       | Required (add)      | Writable  | Description                                                        |
| ---------- | ---------- | ------------------- | --------- | ------------------------------------------------------------------- |
| id         | int        | —                   | no        |                                                                      |
| name       | string     | **yes**             | yes       |                                                                      |
| projectid / categoryid | int | one of, exactly | at add    | Project task vs General task                                         |
| contacts   | CSV string | no (default `me`)   | yes       | `"1,2"`, `"me"`, `"all"`, `"allstaff"`, `"none"` — **array form → 500** [CONFIRMED] |
| startdate / duedate / completedate | date | no  | yes       |                                                                      |
| status     | enum       | —                   | via verbs | active / complete                                                    |
| order      | int/`auto/after/before` | no     | yes       | Position within project (Smart Ordering aware)                       |
| billable   | bool       | no (default true)   | yes       |                                                                      |
| priority / description / tags / apifields | various | no | yes |                                                              |
| templateid | int        | alt to name         | at add    | Instantiate a task template                                          |
| timeallocated / timetracked / burn | number | — | no        | Rollups via `fields=`                                                |

### Time Record

| Field       | Type       | Required (add)       | Writable | Description                                                       |
| ----------- | ---------- | -------------------- | -------- | ------------------------------------------------------------------ |
| id          | int        | —                    | no       |                                                                     |
| taskid      | int        | yes (via `/time`)    | at add   | Owning task                                                         |
| contactid   | int / `me` | no (default `me`)    | yes      | Who tracked it                                                      |
| timetracked | int        | see combos           | yes      | **Minutes.** Valid combos: `starttime`+`endtime`, `starttime`+`timetracked`, `endtime`+`timetracked`, `timetracked` alone [CONFIRMED]. `timeminutes` is NOT a field. |
| starttime / endtime | datetime / `now` | see combos | yes | ISO8601 minute precision                                            |
| date        | date       | no                   | yes      | [CONFIRMED in create]                                               |
| notes       | string     | no                   | yes      |                                                                     |
| billable    | bool       | no                   | yes      |                                                                     |

### Company

| Field        | Type   | Required (add) | Writable | Description                          |
| ------------ | ------ | -------------- | -------- | ------------------------------------- |
| id           | int    | —              | no       |                                       |
| name         | string | yes            | yes      |                                       |
| type         | enum   | yes            | yes      | `staff` / `client` / `contractor`     |
| code         | string | no             | yes      | Short code (default list field)       |
| address / phone / fax / email / website | string | no | yes |                          |
| tags / contacts / apifields | array | no | partial |                                  |
| lastmodified | datetime | —            | no       |                                       |

### File

| Field    | Type   | Writable | Description                                                                |
| -------- | ------ | -------- | --------------------------------------------------------------------------- |
| id       | int    | no       |                                                                              |
| name     | string | at add   | Filename                                                                     |
| project / task / folder | object | at add (exactly one) | Owner (id+name/number/title)                     |
| date     | datetime | no     | Added date                                                                   |
| size     | int    | no       | Bytes                                                                        |
| link     | string | no       | **Signed `app.proworkflow.com` download URL (`sec_key`)** — content path for >1 MB files [CONFIRMED] |
| content  | base64 | at add / on GET `?content=true` | Download form available only ≤ 1 MB [DOCS]            |
| contacts | array/`'all'` | no | `'all'` if public, contact array if private                              |

**Relationships:** Company 1:N Contact · Company 1:N Project (client) · Project 1:N Task · Task 1:N TimeRecord · Project/Task 1:N Files/Messages · Project 1:N Expenses/Invoices/Quotes/Bookmarks/SharedNotes · Invoice/Quote 1:N Lines · Contacts N:M Projects/Tasks (CSV assignment strings).

---

## Pagination

- **Type:** page-number — `pagesize` + `pagenumber` (1-based)
- **Default page size:** none (omit both → all records up to cap)
- **Max:** hard response cap **5,000 records**; vendor guidance ≤ 1,000, ideally ≤ 500 [DOCS]
- **Total count:** `totalcount` on list envelopes [CONFIRMED — live API test 2026-06-10]

| Parameter  | Type | Default | Description                                |
| ---------- | ---- | ------- | ------------------------------------------ |
| pagesize   | int  | —       | **Must be paired with `pagenumber`**       |
| pagenumber | int  | —       | **Must be paired with `pagesize`** (1-based) |

> [CONFIRMED — live API test 2026-06-10] One without the other → 400
> `"pagesize and pagenumber must both be provided in order to use paging"`.

**Response structure:**

```json
{ "count": 50, "totalcount": 1234, "status": "Success", "tasks": [ ... ] }
```

**Last page detection:** `pagenumber * pagesize >= totalcount`.

---

## Filtering, Sorting & Field Selection

- **Filters:** flat per-call query params (each call documents its own list). CSV values = OR within a param; multiple params = AND; `!` prefix = negation where supported (`categoryid=!1,2`, `search=!layout`).
- **Date filters:** `*from`/`*to` pairs taking `yyyy-mm-dd`, ISO8601, or **relative dates** `+/-X` with suffix `n/h/d/w/m/y` — **`n` = minutes** (`lastmodifiedfrom=15n` = last 15 minutes) [CONFIRMED — live API test 2026-06-10].
- **`me` alias:** substitutes the requesting user's contact ID in many params (`contacts`, `contactid`, `managerid`, `timetrackedby`) [CONFIRMED].
- **Sorting:** `sortby=<field>&sortorder=asc|desc`; per-call sort-field whitelists (projects default `number`, files default `name`).
- **Field selection:** `fields=email,type` — `id` always returned regardless [CONFIRMED]. Special members: `apifields` (all API custom fields), `apifieldX` (one field), rollups like `burn`, `contacts`, `dates`.
- **Subtotals:** invoice/quote/time calls accept `subtotals=` (e.g. `company`) returning `{subtotals: [...], total: N}` aggregate rows [DOCS].
- **API custom fields filter:** `apifields=2,Europe||3,Industrial` (id,string pairs joined with `||`) + `apifieldsmode=any|all` [DOCS].
- **Defaults matter:** most lists are pre-filtered — `/projects` defaults to `status=active`, `/files` to `projectstatus=active`. Pass `status=all` for complete coverage.

---

## Rate Limits

| Scope       | Limit | Window |
| ----------- | ----- | ------ |
| Per API key | 500   | 30 s   |

**Headers (on every response)** [CONFIRMED — live API test 2026-06-10, lowercase over HTTP/2]:

| Header                  | Meaning                     |
| ----------------------- | --------------------------- |
| `x-ratelimit-limit`     | 500                         |
| `x-ratelimit-remaining` | Requests left in window     |
| `x-ratelimit-reset`     | Seconds until reset (≤ 30)  |

**When exceeded:** 429 [DOCS]. No documented `Retry-After`; sleep `x-ratelimit-reset` seconds.

**Recommended strategy:** throttle proactively when `remaining` approaches 0; keep individual requests ≤ 500 records; webhook deliveries do not count against the limit [DOCS].

---

## Error Handling

**Standard error format** [CONFIRMED — live API test 2026-06-10]:

```json
{ "status": "Error", "details": ["'content' is a required field"] }
```

**Parse defensively — all live-confirmed deviations:**

1. Some 500s return `details` as a **bare string**: `{"status":"Error","details":"An unidentified error occurred, please contact development@proworkflow.com for assistance."}`
2. Some error strings contain **embedded HTML** (`<ul><li>...`)
3. **401 → EMPTY body** (no JSON) — bad apikey and bad password are indistinguishable
4. **Unknown path → HTML 404 page**, not JSON

**Status codes:**

| Status | Meaning                                              | Retryable | Recovery                                  |
| ------ | ---------------------------------------------------- | --------- | ------------------------------------------ |
| 200    | Success (view/edit/delete)                           | —         |                                            |
| 201    | Success (add) — new ID(s) in `details` array         | —         |                                            |
| 304    | Not modified (If-None-Match), empty body             | —         | Serve cached copy                          |
| 400    | Bad request — `details` is specific                  | No        | Fix params (e.g. paging-pair, time combos) |
| 401    | apikey or credentials invalid — **empty body**       | No        | Re-verify BOTH credentials                 |
| 403    | User's permissions deny the request                  | No        | Surface to user                            |
| 404    | Item not found (JSON) / unknown path (**HTML**)      | No        | Verify ID / endpoint                       |
| 429    | Rate limit exceeded                                  | Yes       | Wait `x-ratelimit-reset` s                 |
| 500    | Server error — `details` may be bare string          | Cautiously| Often a malformed-body symptom (e.g. array `contacts`); fix payload before retrying |

**Idempotency:** no idempotency keys. GET/DELETE idempotent; PUT re-send safe (but empty values CLEAR fields); POST retries create duplicates; verb PUTs (`complete`, `markaspaid`...) effectively idempotent.

---

## Caching: ETags

[CONFIRMED — live API test 2026-06-10]

- Every successful GET returns `etag: <hex>` (unquoted, e.g. `10f7b92898aa74de`).
- Send `If-None-Match: <value>` on the next identical request → **304 with empty body** when unchanged.
- Read-side only — no `If-Match` optimistic-locking support. For change detection prefer `lastmodifiedfrom` (server-side filter) over ETag-diffing large lists.

---

## Webhooks / Events

**Registration:** `POST /settings/webhooks` with `{"event": "newtask", "url": "https://..."}` → 201 `{details: [{id}]}` [DOCS; list envelope CONFIRMED]. Manage via `GET/PUT/DELETE /settings/webhooks/{id}` (the `event` is immutable — delete + recreate to change it). Debug deliveries via `GET /settings/webhooks/requests` (7-day retention; `status=pending|complete|all`).

**Events (full catalog)** [DOCS]:
`newcontact`, `newpendingcontact`, `editcontact`, `editcontactlocation`, `deletecontact`, `newcompany`, `newpendingcompany`, `editcompany`, `deletecompany`, `newfile`, `deletefile`, `newinvoice`, `editinvoice`, `deleteinvoice`, `newmessage`, `editmessage`, `deletemessage`, `newproject`, `editproject`, `deleteproject`, `completeproject`, `reactivateproject`, `newprojectrequest`, `editprojectrequest`, `deleteprojectrequest`, `approveprojectrequest`, `declineprojectrequest`, `newquote`, `editquote`, `deletequote`, `newsharednote`, `editsharednote`, `deletesharednote`, `newtask`, `edittask`, `deletetask`, `completetask`, `reactivatetask`, `newtime`, `edittime`, `deletetime`, `starttimer`, `stoptimer`

**Payload** (thin — re-fetch via the URL):

```json
{ "id": 395, "url": "https://api.proworkflow.net/contacts/395" }
```

(`url` omitted for delete events.)

**Verification:** **NONE** — no signature header, no HMAC, no IP allowlist [DOCS]. Treat inbound payloads as untrusted hints; use only the `id` and re-fetch through the authenticated API.

**Reliability** [DOCS]:

- Receiver must respond within **10 seconds**; a 4xx response deletes the hook immediately.
- Retry schedule is documented inconsistently: overview says 3 retries at 1/15/60-min delays; the `/settings/webhooks/requests` reference says 1 min, then 4×15 min, then 4×hourly. After exhaustion the request AND the subscription are deleted and the creator is emailed.
- One action can fire multiple events (`stoptimer` + `newtime`) — de-duplicate.
- Webhook traffic does not count against the API rate limit.

**Polling fallback:** list calls + `lastmodifiedfrom` (relative dates, e.g. `15n`) + ETags [CONFIRMED].

---

## Known Limitations

1. **5,000-record hard cap** per response; results silently truncated beyond it — always page [DOCS]
2. **No OpenAPI spec, no SDKs, no changelog/versioning** — HTML docs only
3. **No webhook signatures** — receivers cannot authenticate deliveries; ID-and-refetch is mandatory
4. **401 has an empty body** and conflates bad apikey vs bad password [CONFIRMED]
5. **Inconsistent error shapes** — `details` array vs bare string vs HTML 404 pages [CONFIRMED]
6. **Assignment lists are CSV strings**, not arrays — array form causes a 500 [CONFIRMED]
7. **File content via REST limited to 1 MB**; bigger files only through the signed app-host `link` [DOCS/CONFIRMED]
8. **PUT empty-value-clears-field** semantics make naive echo-back updates destructive [DOCS]
9. **Deleting a Project deletes all its Tasks**; deleting a Company can delete its Contacts [CONFIRMED/DOCS]
10. No add/edit/delete across Divisions (Advanced plan) [DOCS]
11. `/workload` rejects past `datefrom` [CONFIRMED]; trial/sample seed projects may not appear in `/projects` even with `status=all` [CONFIRMED]
12. Batch-write partial-failure behavior undocumented — treat batches as all-or-nothing [INFERRED]

---

## SDKs & Tooling

| SDK  | Language | Repository | Quality | Notes                                  |
| ---- | -------- | ---------- | ------- | -------------------------------------- |
| None | —        | —          | —       | Docs link only generic REST clients    |

**Postman collection:** Not available
**OpenAPI spec:** Not available

---

## Integration Path Assessment

**Recommended path:** **Direct API via Numa native data connector** (`request` operation) — NOT Pipedream.

**Justification:** Action-oriented project-management API; no OAuth (so Pipedream adds nothing); the dual-secret model maps cleanly onto Numa's vaults — account apikey in the company connector-config secret (admin-entered via wizard), per-user Basic credentials in each user's personal vault (captured in chat on first use). The backend injects both headers on every proxied request; the agent never handles secrets. ProWorkflow's own per-user permission enforcement means the shared account key cannot escalate privileges.

**Connector compatibility (if file browsing is ever added):**

| Connector Method  | API Endpoint                                  | Feasibility |
| ----------------- | --------------------------------------------- | ----------- |
| list_files        | `GET /files` (+project/task/folder filters)   | good        |
| download_file     | `GET /files/{id}?content=true` (≤ 1 MB) / signed `link` (any size, app host) | partial |
| search_files      | `GET /files?search=<term>`                    | good        |
| get_file_metadata | `GET /files/{fileid}`                         | good        |
| upload_file       | `POST /files` (base64)                        | partial     |

**Recommended test-connection sequence (wizard / first use):**

1. `GET /settings/account/plan` — validates the apikey + user credentials pair and returns the plan
2. `GET /me?fields=firstname,lastname,type` — confirms the user identity that will be acting

---

_Researched 2026-06-10 against the official ProWorkflow API documentation (full 164-path reference) and live trial account "ArcanumAI" (Advanced plan). Source: `00-api-investigation-questionnaire.md`. Credentials sanitized._
