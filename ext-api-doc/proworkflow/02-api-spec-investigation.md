---
api_name: ProWorkflow
api_slug: proworkflow
base_url: https://api.proworkflow.net
path_version_segment: none (API is unversioned — no version segment in path, no version header, no changelog; "unversioned" is a fact, NOT a path label)
path_construction: flat relative paths (e.g. /projects); single shared host for ALL accounts, tenant selected by credentials
call_surface: HTTP via connectors(name="request", params={connector:"proworkflow", url, method, body}) — Numa native data connector, NOT Pipedream
spec_format: none (HTML docs only — no OpenAPI/Swagger/SDK/Postman)
docs_url: https://api.proworkflow.net
auth: dual — account apikey header + per-user HTTP Basic (BOTH mandatory every request)
scale: 164 paths / 283 operations
confidence: [CONFIRMED] = live-API-verified 2026-06-10 (trial "ArcanumAI", Advanced plan); [DOCS] = official docs, not re-verified; [INFERRED] = deduced from doc parse
---

# ProWorkflow — API Specification & Investigation

## Overview

- Vendor: ProActive Software Ltd (ProWorkflow). Project-management SaaS (projects, tasks, time tracking, invoicing, quoting) for agencies and professional-services firms.
- Base URL: `https://api.proworkflow.net` — single shared host for ALL accounts; tenant selected by credentials [CONFIRMED].
- API: REST, unversioned (no version segment/header/changelog). JSON only (responses + POST/PUT bodies); HTTPS mandatory.
- Sandbox: none — use a free trial (trials get full API access). OpenAPI/status page: none.
- Docs: https://api.proworkflow.net (the API host doubles as the HTML docs site).
- Scale: 164 documented paths / 283 operations [INFERRED — parsed from the official per-call reference].
- Surface: full CRUD over the whole domain + webhooks, ETags, API-only custom fields, per-user permission enforcement.

**Numa integration:** native data connector (NOT Pipedream). The agent calls `connectors(name="request", params={connector:"proworkflow", url:"/projects?pagesize=20&pagenumber=1", method:"GET", body:{...}})`. The backend expands relative URLs against the stored base URL and **injects both auth headers** — the agent never sets `Authorization` or `apikey` and never sees the secrets.

## Authentication

Dual — account API key + per-user HTTP Basic auth (BOTH mandatory every request) [CONFIRMED]:

1. **Account API key** — identifies the tenant. `apikey: <key>` header (recommended) or `?apikey=` URL/body param.
2. **HTTP Basic auth** — identifies the user. Username **or email** + password. The user's main-app permissions ("View Work" rules, login revocation) enforced server-side on every call.

```
apikey: XXXX-XXXX-XXXX-XXXX-XXXXXXX-XXXXXXXX
Authorization: Basic base64(email:password)
Content-Type: application/json        (POST/PUT with body)
```

**Bootstrap / key discovery** [CONFIRMED]:

- `GET /login?url=<accounturl-slug>` — works with **Basic auth only** (no apikey). Returns account details: `apikey`, `accounturl`, `plan`, `permissions`, `currency`, and the caller's id/email. Slug = the path segment of the account's app URL (`https://app.proworkflow.com/ArcanumAI` → `url=arcanumai`, case-insensitive). The owner can disable apikey visibility via this call.
- `GET /settings/account/looknfeel` — the only call requiring ONLY the apikey (pre-login theming) [DOCS].

**Failure** [CONFIRMED]: wrong API key OR wrong password → **401 with EMPTY body** (no JSON) — indistinguishable. Permission denial → 403; permissions can change mid-session — handle 401/403 on any call.
**Lifetime:** static (no tokens/expiry/refresh). Key rotation is an account-owner action in the main app.

**Numa secret placement:**
| Credential | Where stored | Who supplies it |
| --- | --- | --- |
| Account API key | `connector-config-proworkflow` company secret | Admin, via the connector wizard |
| User email+password | User's personal vault | Each user, prompted in chat on first use |

ProWorkflow enforces each user's own permissions, so a shared account key cannot escalate privileges.

## Endpoint Catalog

> Paths relative to `https://api.proworkflow.net` [DOCS; key flows CONFIRMED]. Dual auth required except `/login` (Basic only) and `/settings/account/looknfeel` (apikey only).

### Companies (15 paths)

| Method           | Path                                           | Purpose                                                                                                                           |
| ---------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| GET, POST        | `/companies`                                   | list (paged, filterable) / add (array = batch)                                                                                    |
| GET, PUT, DELETE | `/companies/{companyid}`                       | view / edit / delete (may optionally remove contacts)                                                                             |
| GET, POST        | `/companies/{companyid}/contacts`              | list / add contacts                                                                                                               |
| GET              | `/companies/{companyid}/invoices`              | invoices                                                                                                                          |
| GET, POST        | `/companies/{companyid}/notes`                 | list / add notes (`content` required → 400 `"'content' is a required field"`; `title` optional; 201→`details:[{id}]`) [CONFIRMED] |
| GET, DELETE      | `/companies/{companyid}/notes/{noteid}`        | view / delete a note                                                                                                              |
| GET, POST        | `/companies/{companyid}/projects`              | list / add projects                                                                                                               |
| GET              | `/companies/{companyid}/quotes`                | quotes                                                                                                                            |
| GET              | `/companies/{companyid}/summary`               | aggregated summary                                                                                                                |
| GET, PUT         | `/companies/{companyid}/tags`                  | view / set tags                                                                                                                   |
| GET              | `/companies/{companyid}/tasks`                 | tasks                                                                                                                             |
| GET              | `/companies/{companyid}/time`                  | time tracked                                                                                                                      |
| GET              | `/companies/client` · `/contractor` · `/staff` | pre-filtered lists by type                                                                                                        |

### Contacts (20 paths)

| Method           | Path                                               | Purpose                                          |
| ---------------- | -------------------------------------------------- | ------------------------------------------------ |
| GET, POST        | `/contacts`                                        | list (paged; `searchname`) / add (array = batch) |
| GET, PUT, DELETE | `/contacts/{contactid}`                            | view (all fields) / edit / delete                |
| GET, PUT         | `/contacts/{contactid}/groups`                     | view / set teams+groups (staff)                  |
| GET, PUT         | `/contacts/{contactid}/location`                   | view / update location                           |
| GET, POST        | `/contacts/{contactid}/notes`                      | list / add notes                                 |
| GET, DELETE      | `/contacts/{contactid}/notes/{noteid}`             | view / delete a note                             |
| GET              | `/contacts/{contactid}/permissions`                | all permissions for a contact                    |
| GET              | `/contacts/{contactid}/permissions/{permissionid}` | check one                                        |
| GET, POST        | `/contacts/{contactid}/projects`                   | projects for / add project for a contact         |
| GET, PUT         | `/contacts/{contactid}/roles`                      | view / set roles (staff)                         |
| GET              | `/contacts/{contactid}/summary`                    | contact summary                                  |
| GET, PUT         | `/contacts/{contactid}/tags`                       | view / set tags                                  |
| GET              | `/contacts/{contactid}/tasks`                      | tasks for a contact                              |
| GET              | `/contacts/{contactid}/time`                       | time tracked by a contact                        |
| GET              | `/contacts/client` · `/contractor` · `/staff`      | pre-filtered lists                               |
| GET              | `/contacts/forgotpassword`                         | trigger a password reset                         |
| GET              | `/contacts/location`                               | all contact locations                            |
| POST             | `/contacts/requestaccess`                          | request access to ProWorkflow                    |

### Login & Me (2 paths)

| Method   | Path     | Purpose                                                                                  |
| -------- | -------- | ---------------------------------------------------------------------------------------- |
| GET      | `/login` | account + caller details; `?url=<slug>` returns the apikey (Basic auth only) [CONFIRMED] |
| GET, PUT | `/me`    | view / edit the requesting contact [CONFIRMED — singular envelope `{"contact":{...}}`]   |

### Projects (20 paths)

| Method           | Path                                           | Purpose                                                          |
| ---------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| GET, POST        | `/projects`                                    | list (paged; **defaults to ACTIVE**) / create [CONFIRMED]        |
| GET, PUT, DELETE | `/projects/{projectid}`                        | view / edit / **delete (cascades to ALL its tasks)** [CONFIRMED] |
| GET              | `/projects/{projectid}/access/{contactid}`     | check a contact's access                                         |
| PUT              | `/projects/{projectid}/adjustdates`            | shift project and/or task dates                                  |
| GET, POST        | `/projects/{projectid}/bookmarks`              | list / add bookmarks                                             |
| GET, PUT, DELETE | `/projects/{projectid}/bookmarks/{bookmarkid}` | view / edit / delete bookmark                                    |
| PUT              | `/projects/{projectid}/complete`               | complete project                                                 |
| GET, PUT         | `/projects/{projectid}/contacts`               | view / set assigned contacts                                     |
| GET, POST        | `/projects/{projectid}/expenses`               | list / add expenses                                              |
| GET, POST        | `/projects/{projectid}/files`                  | list / add files                                                 |
| GET, POST        | `/projects/{projectid}/invoices`               | list / add invoices                                              |
| GET, POST        | `/projects/{projectid}/messages`               | list / add messages                                              |
| GET, POST        | `/projects/{projectid}/quotes`                 | list / add quotes                                                |
| PUT              | `/projects/{projectid}/reactivate`             | reactivate completed project                                     |
| GET, PUT         | `/projects/{projectid}/settings`               | view / edit project settings                                     |
| GET, POST        | `/projects/{projectid}/sharednotes`            | list / add shared notes                                          |
| GET, POST        | `/projects/{projectid}/tasks`                  | list / add tasks                                                 |
| GET              | `/projects/{projectid}/time`                   | time for a project                                               |
| GET              | `/projects/overdue` · `/projects/overtime`     | overdue / over-allocated-time projects                           |

### Tasks (14 paths)

| Method           | Path                                        | Purpose                                                                                     |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| GET, POST        | `/tasks`                                    | list (paged) / add task(s) — array = batch, same project/category [CONFIRMED single create] |
| GET, PUT, DELETE | `/tasks/{taskid}`                           | view / edit / delete                                                                        |
| PUT              | `/tasks/{taskid}/adjustdates`               | shift task dates                                                                            |
| PUT              | `/tasks/{taskid}/complete`                  | complete — empty body `{}` → 200 "Task Completed" [CONFIRMED]                               |
| GET, PUT         | `/tasks/{taskid}/contacts`                  | view / set assigned contacts (CSV string)                                                   |
| GET, POST        | `/tasks/{taskid}/files`                     | list / add files                                                                            |
| GET, POST        | `/tasks/{taskid}/messages`                  | list / add messages                                                                         |
| PUT              | `/tasks/{taskid}/reactivate`                | reactivate completed task                                                                   |
| PUT              | `/tasks/{taskid}/starttimer` · `/stoptimer` | timer control                                                                               |
| GET, POST        | `/tasks/{taskid}/time`                      | list / add time for a task                                                                  |
| PUT              | `/tasks/delete`                             | **bulk delete tasks (note: PUT, not DELETE)**                                               |
| GET              | `/tasks/overdue` · `/tasks/overtime`        | overdue / over-time tasks                                                                   |

### Time (4 paths)

| Method           | Path                             | Purpose                                                    |
| ---------------- | -------------------------------- | ---------------------------------------------------------- |
| GET, POST        | `/time`                          | list (paged; `subtotals=`) / add a time record [CONFIRMED] |
| GET, PUT, DELETE | `/time/{timerecordid}`           | view / edit / delete                                       |
| PUT              | `/time/{timerecordid}/stoptimer` | stop a running timer                                       |
| GET              | `/time/activetimers`             | list active timers                                         |

### Files (4 paths)

| Method      | Path                        | Purpose                                                                                                                |
| ----------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| GET, POST   | `/files`                    | list (paged; `search`,`projectid`,`taskid`,`folderid`) / upload (base64 `content`; exactly one of project/task/folder) |
| GET, DELETE | `/files/{fileid}`           | metadata (+`?content=true` base64, **≤ 1 MB only**) / delete                                                           |
| GET, POST   | `/files/folders`            | list / add custom folders                                                                                              |
| GET         | `/files/folders/{folderid}` | view a custom folder                                                                                                   |

[CONFIRMED] File objects carry a `link` to `app.proworkflow.com/...getfilesattached.cfm` with a `sec_key` — content for larger files downloads through that signed link, NOT a REST endpoint (and not with API auth headers).

### Invoices (7 paths)

| Method           | Path                                                 | Purpose                                 |
| ---------------- | ---------------------------------------------------- | --------------------------------------- |
| GET, POST        | `/invoices`                                          | list (paged; `total` in response) / add |
| GET, PUT, DELETE | `/invoices/{invoiceid}`                              | view / edit / delete                    |
| GET, POST        | `/invoices/{invoiceid}/lines`                        | list / add line items (array = batch)   |
| GET, PUT, DELETE | `/invoices/{invoiceid}/lines/{lineid}`               | view / edit / delete a line             |
| PUT              | `/invoices/{invoiceid}/markaspaid` · `/markasunpaid` | payment status verbs                    |
| GET              | `/invoices/overdue`                                  | overdue invoices                        |

### Quotes (8 paths)

| Method           | Path                                                        | Purpose                                 |
| ---------------- | ----------------------------------------------------------- | --------------------------------------- |
| GET, POST        | `/quotes`                                                   | list (paged; `total` in response) / add |
| GET, PUT, DELETE | `/quotes/{quoteid}`                                         | view / edit / delete                    |
| PUT              | `/quotes/{quoteid}/approve` · `/decline` · `/markaspending` | status verbs                            |
| GET, POST        | `/quotes/{quoteid}/lines`                                   | list / add lines (array = batch)        |
| GET, PUT, DELETE | `/quotes/{quoteid}/lines/{lineid}`                          | view / edit / delete a line             |
| GET              | `/quotes/lines`                                             | lines across all quotes                 |

### Messages, Notes, Shared Notes, Events, Expenses, Project Requests (14 paths)

| Method           | Path                                                       | Purpose                                                                    |
| ---------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| GET, POST        | `/messages`                                                | list / add — **requires `title` (NOT `subject`) + `contacts`** [CONFIRMED] |
| GET, PUT, DELETE | `/messages/{messageid}`                                    | view / edit / delete                                                       |
| GET, POST        | `/notes`                                                   | list / add (`content` required) [CONFIRMED]                                |
| GET, PUT, DELETE | `/notes/{noteid}`                                          | view / edit / delete                                                       |
| GET, POST        | `/sharednotes`                                             | list / add project shared notes                                            |
| GET, PUT, DELETE | `/sharednotes/{noteid}`                                    | view / edit / delete                                                       |
| GET, POST        | `/events`                                                  | list / add calendar events                                                 |
| GET, PUT, DELETE | `/events/{eventid}`                                        | view / edit / delete                                                       |
| GET, POST        | `/expenses`                                                | list / add expenses                                                        |
| GET, PUT, DELETE | `/expenses/{expenseid}`                                    | view / edit / delete                                                       |
| GET, POST        | `/projectrequests`                                         | list / add project requests                                                |
| GET, PUT, DELETE | `/projectrequests/{projectrequestid}`                      | view / edit / delete                                                       |
| PUT              | `/projectrequests/{projectrequestid}/approve` · `/decline` | approve (→ becomes a Project) / decline                                    |

### Workload (1 path)

| Method | Path        | Purpose                                                                                                                                                          |
| ------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | -------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/workload` | per-staff per-day workload/availability in minutes. `datefrom`/`dateto` (defaults `+0d`/`+2w`) **must be today or later** — past → 400 [CONFIRMED]. `contacts=me | all | ids`, `mode=workload | availability`, `availableminutes` (default 480). Weekends + overdue tasks excluded from calc |

### Settings (55 paths)

Reference/config data. Pattern: collection `GET` (+`POST` where addable), item `GET/PUT/DELETE` where editable.
| Group | Paths | Methods |
| --- | --- | --- |
| Account | `/settings/account`, `/license`, `/looknfeel` (apikey-only), `/plan` | GET only [plan envelope CONFIRMED: `{"settings":{...}}`] |
| API fields | `/settings/apifields`, `/{fieldid}` | GET, POST / GET, PUT, DELETE |
| Contacts config | `/settings/contacts/divisions(+/{id})`, `groups(+/{id})`, `permissions`, `roles(+/{id})`, `tags(+/{id})`, `teams(+/{id})` | list GET(+POST for groups/tags/teams); item GET,PUT,DELETE (roles/permissions read-only) |
| Fixed cost items | `/settings/fixedcostitems` | GET, POST |
| Invoices config | `/settings/invoices/autonumbering`, `hourlyrates`, `staffrates`, `templates(+/{id})` | GET only |
| Notes config | `/settings/notes/categories(+/{id})` | GET, POST / GET, PUT, DELETE |
| Projects config | `/settings/projects`, `autonumbering`, `categories(+/{id})`, `customfields`, `customstatuses(+/{id})`, `tags(+/{id})`, `templates(+/{id})` | mostly GET; categories/customstatuses/tags support POST + item PUT/DELETE |
| Quotes config | `/settings/quotes`, `autonumbering`, `hourlyrates`, `staffrates`, `templates(+/{id})` | GET only |
| Rates | `/settings/servicerates`, `/settings/staffrates` | GET only |
| Tasks config | `/settings/tasks/categories(+/{id})`, `tags(+/{id})`, `templates(+/{tasktemplateid})`, `templates/{id}/tasks(+/{taskid})` | GET, POST / GET, PUT, DELETE |
| Webhooks | `/settings/webhooks`, `/{webhookid}`, `/requests` | GET, POST / GET, PUT, DELETE / GET [list envelope CONFIRMED] |

**Totals: 164 paths / 283 operations** [INFERRED — parsed from the official reference dump].

## Response Envelope [CONFIRMED]

- **List GET:** `{"count":N,"totalcount":M,"status":"Success","<collection>":[...]}` — collection key matches the URL tail (`contacts`, `projects`, `files`, `webhooks`...). Invoice/quote/time add a `total` (value) field. Always an array, even for one item.
- **Single-item GET:** `{"<singular>":{...},"count":1,"status":"Success"}` — `/me` and `/contacts/{id}` return a `contact` object. `/settings/account/plan` uses key `settings`.
- **Write success:** POST → 201 `{"message":"X Added","status":"Success","details":[{"id":N,...}]}`; PUT/DELETE → 200 same shape. `details` ALWAYS an array (one entry per item for batch adds).
- **Error:** `{"status":"Error","details":[...strings...]}` — but `details` can be a bare string and some responses aren't JSON at all (see Error Handling).

## Data Models

> Field lists from official per-call docs + live responses. `id` always present, read-only. Dates ISO8601 without timezone; durations integer minutes.

### Contact

| Field                                                                   | Type     | Required (add) | Writable | Notes                                       |
| ----------------------------------------------------------------------- | -------- | -------------- | -------- | ------------------------------------------- |
| id                                                                      | int      | —              | no       |                                             |
| firstname / lastname                                                    | string   | yes            | yes      |                                             |
| type                                                                    | enum     | yes            | yes      | `staff`/`client`/`contractor`               |
| companyid                                                               | int      | yes            | yes      | owning company (`companyname` denormalized) |
| email / username                                                        | string   | no             | yes      | email doubles as Basic-auth login           |
| allowlogin                                                              | bool     | no             | yes      |                                             |
| mobilephone / workphone / address1-3 / city / state / zipcode / country | string   | no             | yes      |                                             |
| divisionid                                                              | int      | no             | yes      | Advanced                                    |
| lastmodified                                                            | datetime | —              | no       | incremental sync                            |
| tags / teams / groups / notes / apifields                               | array    | no             | partial  | related collections                         |

### Project

| Field                                                                                  | Type       | Required (add) | Writable  | Notes                                                               |
| -------------------------------------------------------------------------------------- | ---------- | -------------- | --------- | ------------------------------------------------------------------- |
| id                                                                                     | int        | —              | no        | numeric ID (URLs)                                                   |
| number                                                                                 | string     | no (`"auto"`)  | yes       | display number, e.g. `"P-0103"` — **distinct from id** [CONFIRMED]  |
| title                                                                                  | string     | **yes**        | yes       |                                                                     |
| companyid                                                                              | int        | **yes**\*      | yes       | \*Advanced: or `internalclientcontactid` (+`internalclientgroupid`) |
| managerid                                                                              | int/`me`   | no             | yes       | Advanced: `groupid` needed if manager in >1 group                   |
| staff / clients / contractors                                                          | CSV string | no             | yes       | assigned contact IDs — **string, not array**                        |
| startdate / duedate / completedate                                                     | date       | no             | yes       | `yyyy-mm-dd` or relative; `completedate` on add ⇒ created completed |
| status                                                                                 | enum       | —              | via verbs | `active`/`complete` (+custom statuses, Advanced)                    |
| priority                                                                               | int        | no             | yes       |                                                                     |
| categoryid / tags / customfields / apifields                                           | various    | no             | yes       | custom fields `[{id,value}]`                                        |
| budget, burn, timeallocated, timetracked, invoicetotal, expensestotal, percentcomplete | number     | —              | no        | computed rollups via `fields=`                                      |
| lastmodified                                                                           | datetime   | —              | no        |                                                                     |

### Task

| Field                                     | Type                    | Required (add)    | Writable  | Notes                                                                           |
| ----------------------------------------- | ----------------------- | ----------------- | --------- | ------------------------------------------------------------------------------- |
| id                                        | int                     | —                 | no        |                                                                                 |
| name                                      | string                  | **yes**           | yes       |                                                                                 |
| projectid / categoryid                    | int                     | one of, exactly   | at add    | project task vs general task                                                    |
| contacts                                  | CSV string              | no (default `me`) | yes       | `"1,2"`,`"me"`,`"all"`,`"allstaff"`,`"none"` — **array form → 500** [CONFIRMED] |
| startdate / duedate / completedate        | date                    | no                | yes       |                                                                                 |
| status                                    | enum                    | —                 | via verbs | active / complete                                                               |
| order                                     | int/`auto/after/before` | no                | yes       | position within project (Smart Ordering aware)                                  |
| billable                                  | bool                    | no (default true) | yes       |                                                                                 |
| priority / description / tags / apifields | various                 | no                | yes       |                                                                                 |
| templateid                                | int                     | alt to name       | at add    | instantiate a task template                                                     |
| timeallocated / timetracked / burn        | number                  | —                 | no        | rollups via `fields=`                                                           |

### Time Record

| Field               | Type           | Required (add)    | Writable | Notes                                                                                                                                                         |
| ------------------- | -------------- | ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                  | int            | —                 | no       |                                                                                                                                                               |
| taskid              | int            | yes (via `/time`) | at add   | owning task                                                                                                                                                   |
| contactid           | int/`me`       | no (default `me`) | yes      | who tracked it                                                                                                                                                |
| timetracked         | int            | see combos        | yes      | **Minutes.** Combos: `starttime`+`endtime`, `starttime`+`timetracked`, `endtime`+`timetracked`, `timetracked` alone [CONFIRMED]. `timeminutes` is NOT a field |
| starttime / endtime | datetime/`now` | see combos        | yes      | ISO8601 minute precision                                                                                                                                      |
| date                | date           | no                | yes      | [CONFIRMED in create]                                                                                                                                         |
| notes               | string         | no                | yes      |                                                                                                                                                               |
| billable            | bool           | no                | yes      |                                                                                                                                                               |

### Company

| Field                                   | Type     | Required (add) | Writable | Notes                           |
| --------------------------------------- | -------- | -------------- | -------- | ------------------------------- |
| id                                      | int      | —              | no       |                                 |
| name                                    | string   | yes            | yes      |                                 |
| type                                    | enum     | yes            | yes      | `staff`/`client`/`contractor`   |
| code                                    | string   | no             | yes      | short code (default list field) |
| address / phone / fax / email / website | string   | no             | yes      |                                 |
| tags / contacts / apifields             | array    | no             | partial  |                                 |
| lastmodified                            | datetime | —              | no       |                                 |

### File

| Field                   | Type          | Writable                        | Notes                                                                                                |
| ----------------------- | ------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| id                      | int           | no                              |                                                                                                      |
| name                    | string        | at add                          | filename                                                                                             |
| project / task / folder | object        | at add (exactly one)            | owner (id+name/number/title)                                                                         |
| date                    | datetime      | no                              | added date                                                                                           |
| size                    | int           | no                              | bytes                                                                                                |
| link                    | string        | no                              | **signed `app.proworkflow.com` download URL (`sec_key`)** — content path for >1 MB files [CONFIRMED] |
| content                 | base64        | at add / on GET `?content=true` | download form available only ≤ 1 MB [DOCS]                                                           |
| contacts                | array/`'all'` | no                              | `'all'` if public, contact array if private                                                          |

**Relationships:** Company 1:N Contact · Company 1:N Project (client) · Project 1:N Task · Task 1:N TimeRecord · Project/Task 1:N Files/Messages · Project 1:N Expenses/Invoices/Quotes/Bookmarks/SharedNotes · Invoice/Quote 1:N Lines · Contacts N:M Projects/Tasks (CSV assignment strings).

## Pagination

- Type: page-number — `pagesize` + `pagenumber` (1-based). Default page size: none (omit both → all records up to cap). Max: hard response cap **5,000 records** (silent truncation); vendor guidance ≤1,000, ideally ≤500 [DOCS]. `totalcount` on list envelopes [CONFIRMED].
- **`pagesize` and `pagenumber` must both be sent** [CONFIRMED] — one alone → 400 `"pagesize and pagenumber must both be provided in order to use paging"`.
- Response: `{"count":50,"totalcount":1234,"status":"Success","tasks":[...]}`. Last page: `pagenumber*pagesize >= totalcount`.

## Filtering, Sorting & Field Selection

- Filters: flat per-call query params (each call documents its own list). CSV values = OR within a param; multiple params = AND; `!` prefix = negation where supported (`categoryid=!1,2`, `search=!layout`).
- Date filters: `*from`/`*to` pairs taking `yyyy-mm-dd`, ISO8601, or relative `+/-X` with suffix `n/h/d/w/m/y` — **`n` = minutes** (`lastmodifiedfrom=15n` = last 15 minutes) [CONFIRMED].
- `me` alias: substitutes the requesting user's contact ID in many params (`contacts`, `contactid`, `managerid`, `timetrackedby`) [CONFIRMED].
- Sorting: `sortby=<field>&sortorder=asc|desc`; per-call sort-field whitelists (projects default `number`, files default `name`).
- Field selection: `fields=email,type` — `id` always returned regardless [CONFIRMED]. Special members: `apifields` (all API custom fields), `apifieldX` (one field), rollups like `burn`, `contacts`, `dates`.
- Subtotals: invoice/quote/time accept `subtotals=` (e.g. `company`) → `{subtotals:[...],total:N}` [DOCS].
- API custom field filter: `apifields=2,Europe||3,Industrial` (id,string pairs joined with `||`) + `apifieldsmode=any|all` [DOCS].
- Defaults matter: most lists are pre-filtered — `/projects` defaults `status=active`, `/files` `projectstatus=active`. Pass `status=all` for complete coverage.

## Rate Limits

500 requests / 30s per API key. Headers on every response [CONFIRMED, lowercase over HTTP/2]: `x-ratelimit-limit` (500), `x-ratelimit-remaining`, `x-ratelimit-reset` (seconds until reset, ≤30). Exceeded → 429 [DOCS]; no documented `Retry-After` — sleep `x-ratelimit-reset` seconds. Throttle proactively when `remaining` approaches 0; keep requests ≤500 records; webhook deliveries don't count [DOCS].

## Error Handling

Standard: `{"status":"Error","details":["'content' is a required field"]}` [CONFIRMED]. Parse defensively — all live-confirmed deviations:

1. Some 500s: `details` a **bare string** — `{"status":"Error","details":"An unidentified error occurred, please contact development@proworkflow.com for assistance."}`
2. Some error strings contain **embedded HTML** (`<ul><li>...`)
3. **401 → EMPTY body** (no JSON) — bad apikey and bad password indistinguishable
4. **Unknown path → HTML 404 page**, not JSON

| Status | Meaning                                         | Retryable  | Recovery                                                                            |
| ------ | ----------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| 200    | Success (view/edit/delete)                      | —          |                                                                                     |
| 201    | Success (add) — new ID(s) in `details`          | —          |                                                                                     |
| 304    | Not modified (If-None-Match), empty body        | —          | serve cached copy                                                                   |
| 400    | Bad request — `details` is specific             | No         | fix params (paging-pair, time combos)                                               |
| 401    | apikey or credentials invalid — **empty body**  | No         | re-verify BOTH credentials                                                          |
| 403    | User's permissions deny                         | No         | surface to user                                                                     |
| 404    | item not found (JSON) / unknown path (**HTML**) | No         | verify ID / endpoint                                                                |
| 429    | rate limit exceeded                             | Yes        | wait `x-ratelimit-reset` s                                                          |
| 500    | server error — `details` may be bare string     | Cautiously | often a malformed-body symptom (e.g. array `contacts`); fix payload before retrying |

**Idempotency:** no idempotency keys. GET/DELETE idempotent; PUT re-send safe (but empty values CLEAR fields); POST retries create duplicates; verb PUTs (`complete`, `markaspaid`...) effectively idempotent.

## Caching: ETags [CONFIRMED]

Every successful GET returns `etag: <hex>` (unquoted, e.g. `10f7b92898aa74de`). Send `If-None-Match: <value>` on the next identical request → **304 with empty body** when unchanged. Read-side only — no `If-Match` optimistic-locking. For change detection prefer `lastmodifiedfrom` (server-side filter) over ETag-diffing large lists.

## Webhooks / Events

Registration: `POST /settings/webhooks {"event":"newtask","url":"https://..."}` → 201 `{details:[{id}]}` [DOCS; list envelope CONFIRMED]. Manage via `GET/PUT/DELETE /settings/webhooks/{id}` (the `event` is immutable — delete + recreate). Debug deliveries via `GET /settings/webhooks/requests` (7-day retention; `status=pending|complete|all`).
Events (full catalog) [DOCS]: `newcontact`, `newpendingcontact`, `editcontact`, `editcontactlocation`, `deletecontact`, `newcompany`, `newpendingcompany`, `editcompany`, `deletecompany`, `newfile`, `deletefile`, `newinvoice`, `editinvoice`, `deleteinvoice`, `newmessage`, `editmessage`, `deletemessage`, `newproject`, `editproject`, `deleteproject`, `completeproject`, `reactivateproject`, `newprojectrequest`, `editprojectrequest`, `deleteprojectrequest`, `approveprojectrequest`, `declineprojectrequest`, `newquote`, `editquote`, `deletequote`, `newsharednote`, `editsharednote`, `deletesharednote`, `newtask`, `edittask`, `deletetask`, `completetask`, `reactivatetask`, `newtime`, `edittime`, `deletetime`, `starttimer`, `stoptimer`.
Payload (thin — re-fetch via the URL): `{"id":395,"url":"https://api.proworkflow.net/contacts/395"}` (`url` omitted for delete events).
Verification: **NONE** — no signature header, HMAC, or IP allowlist [DOCS]. Treat inbound payloads as untrusted hints; use only the `id` and re-fetch through the authenticated API.
Reliability [DOCS]: receiver must respond within 10s; a 4xx response deletes the hook immediately. Retry schedule documented inconsistently — overview says 3 retries at 1/15/60-min delays; the `/settings/webhooks/requests` reference says 1 min, then 4×15 min, then 4×hourly. After exhaustion the request AND subscription are deleted and the creator is emailed. One action can fire multiple events (`stoptimer` + `newtime`) — de-duplicate. Webhook traffic doesn't count against the rate limit.
Polling fallback: list calls + `lastmodifiedfrom` (relative dates, e.g. `15n`) + ETags [CONFIRMED].

## Known Limitations

1. **5,000-record hard cap** per response; silent truncation beyond — always page [DOCS].
2. No OpenAPI spec, no SDKs, no changelog/versioning — HTML docs only.
3. No webhook signatures — receivers can't authenticate deliveries; ID-and-refetch mandatory.
4. **401 has an empty body** and conflates bad apikey vs bad password [CONFIRMED].
5. Inconsistent error shapes — `details` array vs bare string vs HTML 404 pages [CONFIRMED].
6. Assignment lists are CSV strings, not arrays — array form causes a 500 [CONFIRMED].
7. File content via REST limited to 1 MB; bigger files only through the signed app-host `link` [DOCS/CONFIRMED].
8. PUT empty-value-clears-field semantics make naive echo-back updates destructive [DOCS].
9. Deleting a Project deletes all its Tasks; deleting a Company can delete its Contacts [CONFIRMED/DOCS].
10. No add/edit/delete across Divisions (Advanced plan) [DOCS].
11. `/workload` rejects past `datefrom` [CONFIRMED]; trial/sample seed projects may not appear in `/projects` even with `status=all` [CONFIRMED].
12. Batch-write partial-failure behavior undocumented — treat batches as all-or-nothing [INFERRED].

## SDKs & Tooling

None. No SDK, no Postman collection, no OpenAPI spec — docs link only generic REST clients.

## Integration Path Assessment

**Recommended: Direct API via Numa native data connector** (`request` operation) — NOT Pipedream.
Justification: action-oriented PM API; no OAuth (so Pipedream adds nothing); the dual-secret model maps cleanly onto Numa's vaults — account apikey in the `connector-config-proworkflow` company secret (admin-entered via wizard), per-user Basic credentials in each user's personal vault (captured in chat on first use). The backend injects both headers on every proxied request; the agent never handles secrets. ProWorkflow's own per-user permission enforcement means the shared account key cannot escalate privileges.

Connector compatibility (if file browsing is ever added):
| Connector method | API endpoint | Feasibility |
| --- | --- | --- |
| list_files | `GET /files` (+project/task/folder filters) | good |
| download_file | `GET /files/{id}?content=true` (≤1 MB) / signed `link` (any size, app host) | partial |
| search_files | `GET /files?search=<term>` | good |
| get_file_metadata | `GET /files/{fileid}` | good |
| upload_file | `POST /files` (base64) | partial |

Recommended test-connection sequence (wizard / first use):

1. `GET /settings/account/plan` — validates the apikey + user credentials pair and returns the plan.
2. `GET /me?fields=firstname,lastname,type` — confirms the acting user identity.
