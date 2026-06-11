---
api_name: 'ProWorkflow'
api_slug: 'proworkflow'
vendor: 'ProActive Software Ltd (ProWorkflow)'
website: 'https://www.proworkflow.com'
investigation_started: '2026-06-10'
investigator: 'Claude Code (with live trial account "ArcanumAI", Advanced plan)'
investigation_status: 'complete'
documentation_quality: 'good'
api_types: [REST]
overall_confidence: 'high'
blockers: []
generated_date: '2026-06-10'
---

# API Investigation Questionnaire: ProWorkflow

> **Source:** Official ProWorkflow API documentation (https://api.proworkflow.net — overview + full per-call reference)
> plus **live testing against a real trial account** (account "ArcanumAI", Advanced plan, 2026-06-10).
> **Confidence markers:** `[CONFIRMED — live API test 2026-06-10]` = verified against the live API.
> `[DOCS]` = stated in official documentation, not independently re-verified. `[INFERRED]` = deduced from doc parse.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** https://api.proworkflow.net (the API host doubles as the documentation site) [DOCS]
- **API reference / endpoint catalog URL:** Same site — per-call reference covering every path, parameter, filter, and sample payload [DOCS]
- **Authentication guide URL:** Introduction → Authentication section of the same docs [DOCS]
- **Changelog / release notes URL:** None published. The API is unversioned; changes are additive [INFERRED]
- **Status page URL:** None found [INFERRED]

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** **None.** Documentation is HTML-only; no machine-readable spec exists [DOCS]
- **Postman collection URL:** None official (docs recommend Postman as a testing tool but ship no collection) [DOCS]
- **Official SDK repositories:** **None.** Docs link generic REST clients (jQuery, Ruby RestClient, Jersey, C# RestSharp, PHP cURL) — no first-party SDKs [DOCS]
- **Community forums / Stack Overflow tag:** Negligible community footprint; rely on official docs + live testing

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                                                 |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| Authentication            | 4      | Dual-auth model clearly explained with curl examples                                                  |
| Endpoint reference        | 5      | Every call documented: required/field/optional/filter/sort-page params, defaults, sample bodies       |
| Request/response examples | 4      | Good GET/POST/PUT/DELETE worked examples; some write calls only show happy path                       |
| Error documentation       | 2      | Status-code list only; actual error body shapes undocumented (discovered via live testing — see §8.2) |
| Rate limit documentation  | 5      | Exact limit, window, headers, and 429 behavior documented and live-confirmed                          |
| Pagination documentation  | 4      | pagesize/pagenumber documented; the "both or neither" rule only surfaces as a 400 at runtime          |
| Webhook documentation     | 4      | Full event list, payload, retry/removal policy; **no signature/verification mechanism exists**        |
| SDKs / code examples      | 2      | curl + generic library links only                                                                     |
| Changelog / versioning    | 1      | None                                                                                                  |

**Overall documentation quality:** good

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation
- [x] Confirmed no OpenAPI/Swagger spec
- [x] Identified authentication method (dual: apikey header + Basic auth)
- [x] Found working examples — extensive live testing performed [CONFIRMED — live API test 2026-06-10]
- [x] Identified rate limit information (500 req / 30 s, live-confirmed headers)
- [x] Identified pagination approach (pagesize + pagenumber, both required together)
- [x] Checked webhook/event support (yes — `/settings/webhooks`)
- [x] Checked for official SDKs (none)

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** ProWorkflow API
- **Vendor / company:** ProActive Software Ltd (ProWorkflow) — project management / time tracking / invoicing SaaS
- **Current API version:** Unversioned (no version segment in URLs, no version header) [DOCS]
- **Base URL(s):**
  - Production: `https://api.proworkflow.net` — single shared host for ALL accounts; the apikey + Basic auth pair selects the tenant [CONFIRMED — live API test 2026-06-10]
  - Sandbox / testing: None. Use a free trial account (trials get full API access) [CONFIRMED — live API test 2026-06-10]
- **API type:** REST

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTPS mandatory — plain HTTP rejected [DOCS]. Served over HTTP/2 behind Cloudflare [CONFIRMED — live API test 2026-06-10]
- **Data format:** JSON for all responses and all POST/PUT bodies [DOCS]
- **Content-Type header(s):** Responses `application/json;charset=utf-8` [CONFIRMED — live API test 2026-06-10]. Requests with a body MUST set `Content-Type: application/json` or they fail [DOCS]
- **Character encoding:** UTF-8
- **URL structure pattern:**

```
https://api.proworkflow.net/{resource}                       (list / add)
https://api.proworkflow.net/{resource}/{id}                  (view / edit / delete)
https://api.proworkflow.net/{resource}/{id}/{subresource}    (nested, e.g. /projects/1/tasks)
https://api.proworkflow.net/{resource}/{id}/{action}         (verb endpoints, e.g. /tasks/5/complete)
```

- **Versioning strategy:** None
- **CORS policy:** Full CORS support for GET/POST/PUT/DELETE from any domain [DOCS]; permissive `Access-Control-*` headers observed [CONFIRMED — live API test 2026-06-10]. JSONP also supported (GET only, discouraged) [DOCS]
- **Required headers (all requests):**

| Header          | Value                            | Purpose                                                          |
| --------------- | -------------------------------- | ---------------------------------------------------------------- |
| `apikey`        | account API key                  | Tenant/account authentication (also accepted as URL/body param)  |
| `Authorization` | `Basic base64(user:password)`    | Per-user authentication (username OR email + password)           |
| `Content-Type`  | `application/json`               | Required on POST/PUT with body                                   |
| `If-None-Match` | previous ETag value              | Optional — conditional GET, returns 304 when unchanged           |

### 2.3 Authentication [REQUIRED]

- **Auth method:** **TWO mandatory mechanisms on EVERY request** [CONFIRMED — live API test 2026-06-10]:
  1. Account **API key** — `apikey: <key>` header (recommended) or `?apikey=` URL/body parameter
  2. **HTTP Basic auth** — the calling user's ProWorkflow username-or-email + password
- **Auth location:** Headers (both)
- **Auth header format:**

```
apikey: XXXX-XXXX-XXXX-XXXX-XXXXXXX-XXXXXXXX
Authorization: Basic base64(email:password)
```

**Key discovery / bootstrap call** [CONFIRMED — live API test 2026-06-10]:

- `GET /login?url=<accounturl-slug>` works with **Basic auth only** (no apikey needed) and returns account details including the `apikey`, `accounturl`, `plan`, `permissions`, `currency`, and the user's id/email.
- The slug is the path segment of the account's app URL (e.g. `https://app.proworkflow.com/ArcanumAI` → `url=arcanumai`), case-insensitive.
- If the account owner has disabled API-key visibility this call won't return the key [DOCS].
- `GET /settings/account/looknfeel` is the only call requiring ONLY the apikey (lets an app theme itself before user login) [DOCS].

**Failure modes** [CONFIRMED — live API test 2026-06-10]:

- Bad API key OR bad password → **401 with EMPTY body** (no JSON). Handle the no-body case explicitly.

**Permissions model** [DOCS, partially CONFIRMED]:

- An API user has exactly the permissions they have in the main ProWorkflow application; "View Work" visibility rules apply, enforced server-side.
- Advanced plan: users can VIEW other Divisions (with permission) but the API does not support add/edit/delete in another Division.
- Permissions can change or login access can be revoked mid-session — expect 401/403 at any time.

**For API Key auth:**

- **How to obtain:** Account owner finds it in the main app (Settings) or via the `/login` call above
- **Key format / pattern:** Grouped uppercase alphanumeric segments separated by dashes (e.g. `XXXX-XXXX-XXXX-XXXX-XXXXXXX-XXXXXXXX`) [CONFIRMED — live API test 2026-06-10]
- **Rate limits per key:** 500 requests / 30 s (see §8.1)
- **Key rotation procedure:** Account-owner action in the main app; no API rotation endpoint [INFERRED]

**Token lifetime / refresh:** Not applicable — credentials are static (API key + user password). No tokens, no expiry, no refresh flow.

### 2.4 First Successful Call [REQUIRED] — CRITICAL GATE

**Endpoint used for first call** [CONFIRMED — live API test 2026-06-10]:

```http
GET /me?fields=firstname,lastname,type HTTP/2
Host: api.proworkflow.net
apikey: {APIKEY}
Authorization: Basic {base64 email:password}
```

**Response received (200, abridged):**

```json
{
  "contact": {
    "id": 1,
    "firstname": "tony",
    "lastname": "gurnick",
    "type": "staff",
    "companyid": 1,
    "companyname": "Arcanum AI",
    "plan": "Advanced",
    "divisionid": 1
  },
  "count": 1,
  "status": "Success"
}
```

- **HTTP status code:** 200
- **Response headers of note:** `x-ratelimit-limit: 500`, `x-ratelimit-remaining`, `x-ratelimit-reset: 30`, `content-type: application/json;charset=utf-8`
- **Time to first successful call:** Minutes — dual auth is simple once both headers are present
- **Gotchas encountered during setup:** A missing/incorrect apikey OR password gives an identical empty-body 401, so you cannot distinguish which of the two credentials is wrong from the response alone

- [x] **GATE CHECK: First successful API call completed and documented above**

---

## Phase 3: Domain Model & Behavior

### 3.1 Core Entities [REQUIRED]

ProWorkflow is a project-management domain: Companies employ Contacts; Projects belong to a client Company and contain Tasks; Time, Files, Messages, Expenses, Invoices and Quotes hang off Projects/Tasks. All IDs are plain integers, returned on every list call, used in URLs [DOCS, CONFIRMED].

#### Entity: Contact

- **API resource name / endpoint path:** `/contacts` (plus `/contacts/staff|client|contractor` pre-filtered lists, `/me` for the caller)
- **Description:** A person — staff member, client contact, or contractor. Staff contacts can have login access, roles, teams/groups.
- **CRUD support:** Create / Read / Update / Delete (all)

**Fields (key — default list fields in bold):**

| Field          | Type    | Required? | Writable? | Description                              | Example Value           |
| -------------- | ------- | --------- | --------- | ---------------------------------------- | ----------------------- |
| id             | int     | —         | no        | Unique ID, always returned               | `504`                   |
| **firstname**  | string  | yes (add) | yes       | First name                               | `"Amy"`                 |
| **lastname**   | string  | yes (add) | yes       | Last name                                | `"West"`                |
| **type**       | enum    | yes (add) | yes       | `staff` / `client` / `contractor`        | `"client"`              |
| **companyid**  | int     | yes (add) | yes       | Owning company                           | `29`                    |
| **companyname**| string  | —         | no        | Denormalized company name                | `"ABC Media"`           |
| email          | string  | no        | yes       | Email (also usable as Basic-auth login)  | `"amy@abcmedia.com"`    |
| username       | string  | no        | yes       | Login username                           |                         |
| allowlogin     | bool    | no        | yes       | Whether contact can log in               | `false`                 |
| mobilephone / workphone | string | no | yes     | Phone numbers                            |                         |
| address1-3 / city / state / zipcode / country | string | no | yes | Postal address          |                         |
| divisionid     | int     | no        | yes       | Division (Advanced plan)                 | `1`                     |
| lastmodified   | datetime| —         | no        | ISO8601, no TZ                           | `"2014-05-04T16:50:36"` |
| tags / teams / groups / notes / apifields | array | no | partial | Related collections          | `[]`                    |

**Relationships:**

| Related Entity | Relationship Type | How Expressed                       | Notes                              |
| -------------- | ----------------- | ----------------------------------- | ---------------------------------- |
| Company        | N:1               | `companyid` on contact              |                                    |
| Project        | N:M               | `/contacts/{id}/projects`, project `staff`/`clients`/`contractors` CSV |  |
| Task           | N:M               | `/tasks/{id}/contacts`              | Assignment list                    |
| Time Record    | 1:N               | `contactid` on time record          | `"me"` alias supported             |

#### Entity: Company

- **API resource name / endpoint path:** `/companies` (plus `/companies/staff|client|contractor`)
- **Description:** An organization — your own (staff), a client, or a contractor company.
- **CRUD support:** Create / Read / Update / Delete (all). Deleting a Company may optionally delete its Contacts [DOCS].
- **Key fields:** `id`, `name`, `code`, `type` (staff/client/contractor), `address`, `phone`, `email`, `website`, `tags`, `lastmodified`, `apifields`. Default list fields: `code,name,type` [DOCS].
- **Sub-resources:** `/companies/{id}/contacts|projects|invoices|quotes|tasks|time|notes|tags|summary` [DOCS].

#### Entity: Project

- **API resource name / endpoint path:** `/projects` (plus `/projects/overdue`, `/projects/overtime`)
- **Description:** The central work container. Has a client company (or internal client on Advanced plan), a manager, assigned staff/clients/contractors, dates, budget, custom fields/statuses (Advanced).
- **CRUD support:** Create / Read / Update / Delete, plus verb actions: `complete`, `reactivate`, `adjustdates`.

**Fields (key):**

| Field        | Type     | Required?   | Writable? | Description                                            | Example          |
| ------------ | -------- | ----------- | --------- | ------------------------------------------------------ | ---------------- |
| id           | int      | —           | no        | Numeric ID (used in URLs)                              | `6`              |
| number       | string   | no (`auto`) | yes       | Display number — **distinct from id**                  | `"P-0103"`       |
| title        | string   | **yes**     | yes       | Project title                                          |                  |
| companyid    | int      | **yes**\*   | yes       | Client company (\*or `internalclientcontactid` on Advanced) | `8`         |
| managerid    | int/`me` | no          | yes       | Project manager                                        | `"me"`           |
| staff / clients / contractors | CSV string | no | yes | Assigned contact IDs as comma-separated STRING  | `"2,3,5"`        |
| startdate / duedate / completedate | date | no   | yes       | `yyyy-mm-dd` or relative (`+1w`)                       | `"2026-06-24"`   |
| status       | enum     | —           | via verbs | `active` / `complete` (custom statuses on Advanced)    |                  |
| priority     | int      | no          | yes       |                                                        | `2`              |
| budget / burn / timeallocated / timetracked | number | — | no | Financial/time rollups (request via `fields`) |                  |
| customfields / apifields | array | no          | yes       | `[{id, value}]`                                        |                  |

[CONFIRMED — live API test 2026-06-10]: minimal create body `{"title": "...", "companyid": 8}` → 201 returning `{"number": "P-0103", "id": 6, "title": ...}`.

**Relationships:** 1:N Tasks, Files, Messages, Expenses, Invoices, Quotes, Bookmarks, SharedNotes (all as `/projects/{id}/<sub>`); N:1 Company; N:M Contacts.

#### Entity: Task

- **API resource name / endpoint path:** `/tasks` (plus `/tasks/overdue`, `/tasks/overtime`, `/tasks/delete` bulk)
- **Description:** Work item, either inside a Project (`projectid`) or a General Task (`categoryid`). Supports ordering, dependencies, billable flag, service rates, timers.
- **CRUD support:** Create (single or batch) / Read / Update / Delete (single via DELETE, bulk via `PUT /tasks/delete`), plus verbs: `complete`, `reactivate`, `adjustdates`, `starttimer`, `stoptimer`.
- **Key create fields:** `name` (required), exactly one of `projectid` | `categoryid`, `contacts` (**comma-separated STRING** — `"me"`, `"1,2"`, `"allstaff"`, `"all"`, `"none"`; default `me`), `startdate`/`duedate`, `priority`, `billable` (default true), `order`, `templateid`.
- [CONFIRMED — live API test 2026-06-10]: sending `contacts` as an array of objects (`[{"id": "me"}]`) → **HTTP 500** with `details` as a bare string. It must be a CSV string.
- [CONFIRMED — live API test 2026-06-10]: `PUT /tasks/{id}/complete` with empty JSON body `{}` → 200 `"Task Completed"`.

#### Entity: Time Record

- **API resource name / endpoint path:** `/time` (plus `/tasks/{id}/time`, `/time/activetimers`, `/time/{id}/stoptimer`)
- **Description:** Time tracked against a Task by a Contact. Supports running timers.
- **CRUD support:** Create / Read / Update / Delete.
- **Duration model** [CONFIRMED — live API test 2026-06-10]: duration field is `timetracked` (**minutes**). Valid combinations (per live 400 error text): `starttime`+`endtime`, `starttime`+`timetracked`, `endtime`+`timetracked`, or `timetracked` alone. `timeminutes` is NOT a field. Example 201 body: `{"contactid": "me", "date": "2026-06-10", "timetracked": 30, "notes": "..."}`.

#### Entity: File

- **API resource name / endpoint path:** `/files`, `/files/{fileid}`, `/files/folders`, plus `/projects/{id}/files`, `/tasks/{id}/files`
- **Description:** File attached to exactly one of Project / Task / custom Folder.
- **CRUD support:** Create (base64 upload) / Read / Delete. No edit.
- **Upload:** `POST /files` with `{projectid|taskid|folderid, name, content}` where `content` is **base64** [DOCS].
- **Download:** `GET /files/{fileid}?content=true` returns base64 — **only for files ≤ 1 MB** [DOCS]. For larger files use the `link` field: a signed `app.proworkflow.com/...getfilesattached.cfm?...sec_key=...` URL — file content is fetched through that signed link, not a REST endpoint [CONFIRMED — live API test 2026-06-10].

#### Other entities (summary)

| Entity          | Path                      | CRUD                  | Notes                                                              |
| --------------- | ------------------------- | --------------------- | ------------------------------------------------------------------ |
| Invoice         | `/invoices` (+lines)      | CRUD + markaspaid/unpaid | Line items as sub-resource; `total` field in list responses     |
| Quote           | `/quotes` (+lines)        | CRUD + approve/decline/markaspending | Mirrors invoices                                    |
| Message         | `/messages`               | CRUD                  | Requires `title` (NOT `subject`) and `contacts` [CONFIRMED — live API test 2026-06-10] |
| Note            | `/notes`, per-entity `/notes` | CRUD              | `content` required, `title` optional [CONFIRMED — live API test 2026-06-10] |
| Shared Note     | `/sharednotes`            | CRUD                  | Project-level shared notes                                          |
| Event           | `/events`                 | CRUD                  | Calendar events                                                     |
| Expense         | `/expenses`               | CRUD                  | Project expenses                                                    |
| Project Request | `/projectrequests`        | CRUD + approve/decline | Inbound work requests                                              |
| Workload        | `/workload`               | Read-only             | Per-staff per-day minutes; `datefrom` must be today or later [CONFIRMED — live API test 2026-06-10] |
| Settings        | `/settings/...` (55 paths)| Mostly read; CRUD for categories/tags/teams/webhooks/apifields | Reference data |

### 3.2 Entity Relationships [IMPORTANT]

```
┌──────────┐ 1:N  ┌──────────┐ N:M (staff/clients/contractors)
│ Company  │─────>│ Contact  │<───────────────┐
└──────────┘      └──────────┘                │
     │ 1:N (client of)   │ 1:N (tracked by)   │
     ▼                   ▼                    │
┌──────────┐ 1:N  ┌──────────┐ 1:N  ┌─────────┴──┐
│ Project  │─────>│  Task    │─────>│ Time Record│
└──────────┘      └──────────┘      └────────────┘
  │ 1:N each                │ 1:N each
  ▼                         ▼
Files, Messages,         Files, Messages
Expenses, Invoices,
Quotes, Bookmarks,
SharedNotes
```

### 3.3 State Machines [IMPORTANT]

#### Project / Task

```
[active] --PUT .../complete--> [complete] --PUT .../reactivate--> [active]
```

| From State | Action/Trigger          | To State | Reversible? | Side Effects                                  |
| ---------- | ----------------------- | -------- | ----------- | --------------------------------------------- |
| active     | `PUT /{res}/{id}/complete` | complete | Yes (reactivate) | `completedate` set; list calls default to active-only |
| complete   | `PUT /{res}/{id}/reactivate` | active | Yes        |                                               |

#### Quote

```
[pending] --approve--> [approved]
[pending] --decline--> [declined]
[approved/declined] --markaspending--> [pending]
```

#### Invoice

```
[unpaid] --markaspaid--> [paid] --markasunpaid--> [unpaid]
```

#### Project Request

```
[pending] --approve--> [approved (becomes Project)]
[pending] --decline--> [declined]
```

**Per-state capabilities:** Completed projects/tasks are excluded from default list filters (`status=active`); pass `status=all` or `status=complete` to see them [DOCS].

### 3.4 Business Rules [IMPORTANT]

**Ordering / dependency rules:**

- A Project requires an existing client `companyid` (or `internalclientcontactid` on Advanced) [DOCS]
- A Task requires exactly one of `projectid` (project task) or `categoryid` (general task) [DOCS]
- A Time Record requires an existing `taskid` (when added via `/time`) [DOCS]
- A File must target exactly one of `projectid` / `taskid` / `folderid` [DOCS]

**Field-level rules:**

- **PUT semantics:** only send fields you want to change; **an empty value CLEARS the field** — never echo back empty strings [DOCS]
- Assignment lists (`contacts`, `staff`, `clients`, `contractors`) are **comma-separated strings**, not arrays [CONFIRMED — live API test 2026-06-10]
- `"me"` substitutes for the requesting user's contact ID in many calls (task contacts, time `contactid`, `managerid`, workload `contacts`) [CONFIRMED — live API test 2026-06-10]
- `/workload` `datefrom` must be today or later — past dates → 400 [CONFIRMED — live API test 2026-06-10]
- Adding multiple Tasks in one POST: all must share the same `projectid`/`categoryid` and order option [DOCS]

**Cascading effects:**

- **Deleting a Project deletes ALL its Tasks** [DOCS, CONFIRMED — live API test 2026-06-10: `DELETE /projects/{id}` → 200, tasks gone]
- Deleting a Company may **optionally** delete associated Contacts [DOCS]
- Webhook on a 4xx response or exhausted retries → the webhook subscription is **deleted** [DOCS]

**Computed / read-only fields:**

- `id` always read-only and always returned regardless of `fields` selection [CONFIRMED — live API test 2026-06-10]
- `percentcomplete`, `burn`, `timetracked`, `invoicetotal`, `expensestotal` etc. are computed rollups requested via `fields` [DOCS]
- Project `number` is server-assigned when `"auto"` (autonumbering) [DOCS]

### 3.5 Field Format Reference [IMPORTANT]

| Format      | Pattern                                | Example                 | Notes                                                                  |
| ----------- | -------------------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| Date        | `yyyy-mm-dd`                           | `2026-06-10`            | Accepted where "date" is required                                      |
| DateTime    | ISO8601 **without timezone**           | `2026-06-24T00:00:00`   | Returned in the requesting user's app-local rendering [CONFIRMED]      |
| Relative date | `+/-X` + suffix `n/h/d/w/m/y`        | `+1w`, `-2d`, `15n`     | **`n` = minutes!** Works in filters AND date fields [CONFIRMED]        |
| Currency    | plain number                           | `100`                   | Account currency from `/login`                                         |
| ID format   | positive integer                       | `504`                   | `"me"` alias accepted in many contact-ID positions                     |
| Duration    | integer minutes (`timetracked`)        | `30`                    | [CONFIRMED — live API test 2026-06-10]                                 |
| File content| base64 string                          | `"U29tZSB0ZXh0"`        | Upload always; download only ≤ 1 MB                                    |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

| Entity  | Field         | Allowed Values                                       | Default  | Notes                          |
| ------- | ------------- | ---------------------------------------------------- | -------- | ------------------------------ |
| Contact | type          | `staff`, `client`, `contractor`                      | —        |                                |
| Company | type          | `staff`, `client`, `contractor`                      | —        |                                |
| Project | status (filter) | `active`, `complete`, `all`                        | `active` | Custom statuses on Advanced    |
| Task    | contacts      | CSV IDs, `me`, `all`, `allstaff`, `none`             | `me`     | String, not array              |
| Webhook | event (filter)| `all`,`company`,`contact`,`file`,`invoice`,`message`,`project`,`projectrequest`,`quote`,`sharednote`,`task`,`time`,`timer` | `all` | |
| Workload| mode          | `workload`, `availability`                           | `workload` |                              |
| Sort    | sortorder     | `asc`, `desc`                                        | `asc`    | All paginated lists            |

---

## Phase 4: Endpoint Catalog

> Full inventory (164 paths / 283 operations [INFERRED — parsed from official per-call reference dump]) lives in
> `02-api-spec-investigation.md`. The critical endpoints below are live-tested worked examples.

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /projects

- **Purpose:** List projects (defaults to ACTIVE only)
- **Authentication required:** yes (dual)
- **Idempotent:** yes

**Query parameters (selection):**

| Parameter        | Type   | Required | Default                                   | Description                                  |
| ---------------- | ------ | -------- | ----------------------------------------- | -------------------------------------------- |
| fields           | CSV    | no       | `title,number,company,startdate,duedate`  | Field selection; `id` always included        |
| status           | enum   | no       | `active`                                  | `active` / `complete` / `all`                |
| companyid        | CSV    | no       | —                                         | Filter by client company                     |
| managerid        | CSV/`me` | no     | —                                         | Filter by manager                            |
| lastmodifiedfrom | date/rel | no     | —                                         | Incremental sync filter                      |
| pagesize + pagenumber | int | no (pair) | —                                       | Both or neither [CONFIRMED]                  |
| sortby / sortorder | enum | no       | `number` / `asc`                          | `id,title,number,startdate,duedate,completedate` |

**Success response (200):**

```json
{
  "projects": [
    { "id": 6, "number": "P-0103", "title": "Sample", "companyname": "Arcanum AI",
      "startdate": "2026-06-10T00:00:00", "duedate": "2026-06-24T00:00:00" }
  ],
  "count": 1,
  "totalcount": 1,
  "status": "Success"
}
```

> [CONFIRMED — live API test 2026-06-10] Gotcha: a fresh trial showed `totalcount: 0` even with `status=all`
> while sample Files referenced project `P-0101` — deleted/sample seed projects may not appear in lists.

#### Endpoint: POST /projects

- **Purpose:** Create a project. **Idempotent:** no.

**Request body (minimal, live-tested):**

```json
{ "title": "Numa integration test", "companyid": 8, "managerid": "me", "duedate": "+1w" }
```

**Success response (201)** [CONFIRMED — live API test 2026-06-10]:

```json
{ "details": [ { "id": 6, "number": "P-0103", "title": "Numa integration test" } ],
  "message": "Project Added", "status": "Success" }
```

Note: `number` (`P-0103`) and numeric `id` (`6`) are distinct; URLs use `id`.

#### Endpoint: POST /tasks

- **Purpose:** Create task(s) — single object or array. **Idempotent:** no.

**Request body (single, live-tested):**

```json
{ "name": "Review docs", "projectid": 6, "contacts": "me", "duedate": "+2d" }
```

**Error trap** [CONFIRMED — live API test 2026-06-10]: `"contacts": [{"id": "me"}]` (array form) →
HTTP 500 `{"status":"Error","details":"An unidentified error occurred, please contact development@proworkflow.com for assistance."}` — note `details` is a **bare string** here, not an array.

#### Endpoint: PUT /tasks/{taskid}/complete

- **Purpose:** Complete a task. Body: `{}` (empty JSON). → 200 `"Task Completed"` [CONFIRMED — live API test 2026-06-10]. Effectively idempotent.

#### Endpoint: POST /time

- **Purpose:** Add a time record to a task. **Idempotent:** no.

**Request body (live-tested):**

```json
{ "taskid": 9, "contactid": "me", "date": "2026-06-10", "timetracked": 30, "notes": "API test" }
```

→ 201. `timetracked` is minutes; valid combos: `starttime`+`endtime`, `starttime`+`timetracked`, `endtime`+`timetracked`, or `timetracked` alone [CONFIRMED — live API test 2026-06-10].

#### Endpoint: GET /contacts

- **Purpose:** List contacts. Default fields `companyid,companyname,firstname,lastname,type` + `id`. Filters: `searchname`, `type`, `companyid`, `lastmodifiedfrom`, etc. [DOCS, envelope CONFIRMED]

#### Endpoint: GET /login?url={accounturl}

- **Purpose:** Bootstrap — Basic auth only; returns account details incl. `apikey` (if owner allows), `plan`, `permissions`, `currency` [CONFIRMED — live API test 2026-06-10].

#### Endpoint: POST /settings/webhooks

- **Purpose:** Register a webhook. Body `{"event": "newtask", "url": "https://..."}` → 201 with hook id [DOCS]. See Phase 7.

#### Endpoint: POST /files / GET /files/{fileid}

- **Purpose:** Upload (base64 `content`, target exactly one of `projectid`/`taskid`/`folderid`) / fetch metadata.
- `GET /files/{id}?content=true` returns base64 only for files ≤ 1 MB [DOCS]; otherwise use the signed `link` URL [CONFIRMED — live API test 2026-06-10].

**Common error responses (all endpoints):**

| Status | Error Code | Meaning                                | Recovery                                     |
| ------ | ---------- | -------------------------------------- | -------------------------------------------- |
| 400    | —          | Bad request; `details` explains        | Fix parameters (message is usually specific) |
| 401    | —          | Bad apikey or user credentials — empty body | Re-check both credentials               |
| 403    | —          | User permissions deny this             | Not retryable; needs permission change       |
| 404    | —          | Item doesn't exist (JSON) or unknown path (**HTML page**) | Verify ID / path            |
| 429    | —          | Rate limited                           | Wait for `x-ratelimit-reset`                 |
| 500    | —          | Server error; `details` may be a bare string | Report / retry cautiously              |

### 4.2 Full Endpoint Index [IMPORTANT]

See `02-api-spec-investigation.md` §Endpoint Catalog — all 164 paths grouped by resource family with methods.

### 4.3 Non-REST Endpoints [NICE-TO-HAVE]

None. Pure REST/JSON.

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                          | Supported? | Syntax                                             | Notes                                            |
| ----------------------------------- | ---------- | -------------------------------------------------- | ------------------------------------------------ |
| Filter by field value               | Yes        | flat query params, e.g. `?companyid=1,2`           | Per-call documented filter list                  |
| Filter by date range                | Yes        | `*from` / `*to` pairs (`duedatefrom`, `trackedto`) | Absolute or relative dates                       |
| Full-text search                    | Partial    | `searchname=` (contacts), `search=` (files), etc.  | Substring, case-insensitive; per-call            |
| Sort by field                       | Yes        | `sortby=duedate`                                   | Per-call whitelist of sort fields                |
| Sort direction (asc/desc)           | Yes        | `sortorder=desc`                                   | Default `asc`                                    |
| Field selection / sparse fields     | Yes        | `fields=email,type`                                | `id` always returned [CONFIRMED]                 |
| Include related records             | Yes        | via `fields` (e.g. `contacts`, `tasklists`)        | Expands nested data                              |
| Aggregate / count                   | Partial    | `subtotals=` on invoice/quote/time calls           | e.g. `?subtotals=company` returns subtotal rows  |
| Logical operators (AND/OR)          | Implicit   | multiple params = AND; CSV values = OR             | `apifieldsmode=any|all` for API-field matching   |
| Comparison operators (gt, lt, etc.) | Partial    | `idfrom`/`idto`, `gte30%`/`lte30%` (timetracked)   | No generic operator syntax                       |
| Negation                            | Partial    | `!` prefix (e.g. `categoryid=!1,2`, `search=!layout`) | Where documented per call                     |
| Null checks / regex                 | No         | —                                                  |                                                  |

### 5.2 Filter Syntax [REQUIRED]

**General pattern — flat query parameters:**

```
GET /tasks?projectid=1&status=active&duedateto=+1w&fields=name,duedate,contacts
```

- CSV values are OR within one parameter: `?companyid=1,2,3`
- Multiple parameters combine as AND
- `!` prefix negates where supported: `?categoryid=!1,2`
- API custom fields: `?apifields=2,Europe||3,Industrial` (`id,string` pairs joined by `||`; `apifieldsmode=any|all`)
- No nesting / no generic operator grammar

### 5.3 Sort Syntax [IMPORTANT]

```
GET /projects?sortby=duedate&sortorder=desc
```

Per-call sort-field whitelists (e.g. projects: `id,title,number,startdate,duedate,completedate`; files: `id,name,size,date,projectid,taskid,folderid`) [DOCS].

### 5.4 Field Selection [NICE-TO-HAVE]

```
GET /contacts?fields=email,type        → returns id + email + type only   [CONFIRMED]
GET /projects?fields=apifields          → include all API custom fields
GET /projects?fields=apifield3          → include API field ID 3 only
```

### 5.5 Search Capabilities [IMPORTANT]

- **Global search endpoint:** None — per-resource only
- **Per-resource search:** `?searchname=` (contacts/companies), `?search=` (files name contains), title/name filters on other calls
- **Fuzzy matching:** No — substring "like" match, case-insensitive [DOCS]

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1: Incremental sync / "what changed recently"** [CONFIRMED — live API test 2026-06-10]

```http
GET /contacts?lastmodifiedfrom=15n        (changed in the last 15 MINUTES — n = minutes)
```

**Pattern 2: My open tasks due this week**

```http
GET /tasks?contactid=me&status=active&duedateto=+1w&fields=name,project,duedate
```

**Pattern 3: Time tracked per company for a month (subtotals)**

```http
GET /time?trackedfrom=2026-05-01&trackedto=2026-05-31&subtotals=company
```

**Pattern 4: Paged project list, newest first**

```http
GET /projects?status=all&pagesize=50&pagenumber=1&sortby=id&sortorder=desc
```

**Pattern 5: Staff workload for the next two weeks**

```http
GET /workload?contacts=all&datefrom=+0d&dateto=+2w&mode=availability
```

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** page-number (`pagesize` + `pagenumber`)
- **Default page size:** None — without paging params, ALL records return (up to the 5,000 cap)
- **Maximum page size:** Not enforced explicitly; the API caps any response at **5,000 records** and the vendor asks for ≤ 1,000 (ideally ≤ 500) per request [DOCS]
- **Total count available:** yes — `count` (records in this response) and `totalcount` (total matching) on list envelopes [CONFIRMED — live API test 2026-06-10]

**Request parameters:**

| Parameter  | Type | Default | Description                                          |
| ---------- | ---- | ------- | ---------------------------------------------------- |
| pagesize   | int  | —       | Page size — **must be paired with pagenumber**       |
| pagenumber | int  | —       | 1-based page — **must be paired with pagesize**      |

> [CONFIRMED — live API test 2026-06-10] Supplying one without the other → 400
> `"pagesize and pagenumber must both be provided in order to use paging"`.

**Response structure:**

```json
{ "count": 50, "totalcount": 1234, "status": "Success", "projects": [ ... ] }
```

**How to detect last page:** `pagenumber * pagesize >= totalcount` (or returned array shorter than `pagesize`).

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /contacts?pagesize=50&pagenumber=1   → count: 50, totalcount: 120
Page 2: GET /contacts?pagesize=50&pagenumber=2   → count: 50
Page 3: GET /contacts?pagesize=50&pagenumber=3   → count: 20  (last: 3*50 >= 120)
```

### 6.3 Bulk Operations [IMPORTANT]

| Operation             | Endpoint                          | Max Batch Size | Notes                                          |
| --------------------- | --------------------------------- | -------------- | ---------------------------------------------- |
| Bulk create           | `POST /companies`, `/contacts`, `/tasks`, invoice/quote `/lines` | undocumented | Send a JSON ARRAY instead of an object [DOCS] |
| Bulk delete (tasks)   | `PUT /tasks/delete`               | undocumented   | Note: PUT, not DELETE                          |
| Bulk update           | Not supported                     | —              | PUT is single-item only                        |
| Bulk read / batch get | `?id=1,2,3,4` filter on list calls| 5,000 cap      | CSV ID filter                                  |

**Partial failure handling:** Undocumented; `details` array returns one entry per created item on success. Treat batch writes as all-or-nothing until proven otherwise [INFERRED].

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

No export endpoints. Page through list calls; respect the 5,000-record cap and rate limit.

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported? | Notes                                            |
| ------------------------ | ---------- | ------------------------------------------------ |
| Webhooks                 | **Yes**    | `/settings/webhooks` — full lifecycle via API    |
| WebSocket / SSE          | No         | —                                                |
| Long polling             | No         | —                                                |
| Change feeds / streams   | No         | Use `lastmodifiedfrom` polling                   |

### 7.2 Webhooks [IMPORTANT]

**Setup:**

- **Registration method:** API (`POST /settings/webhooks` with `{event, url}`) [DOCS]
- **Management:** `GET /settings/webhooks` (list — live-confirmed envelope `{count, totalcount, webhooks[], status}`), `GET/PUT/DELETE /settings/webhooks/{id}` (the `event` cannot be changed — delete and recreate), `GET /settings/webhooks/requests` (delivery debugging, 7-day retention) [DOCS]
- **Webhook URL requirements:** Must respond within **10 seconds**; any 4xx response → hook is deleted immediately [DOCS]

**Event Catalog** [DOCS — full list]:

contacts: `newcontact`, `newpendingcontact`, `editcontact`, `editcontactlocation`, `deletecontact` · companies: `newcompany`, `newpendingcompany`, `editcompany`, `deletecompany` · files: `newfile`, `deletefile` · invoices: `newinvoice`, `editinvoice`, `deleteinvoice` · messages: `newmessage`, `editmessage`, `deletemessage` · projects: `newproject`, `editproject`, `deleteproject`, `completeproject`, `reactivateproject` · project requests: `newprojectrequest`, `editprojectrequest`, `deleteprojectrequest`, `approveprojectrequest`, `declineprojectrequest` · quotes: `newquote`, `editquote`, `deletequote` · shared notes: `newsharednote`, `editsharednote`, `deletesharednote` · tasks: `newtask`, `edittask`, `deletetask`, `completetask`, `reactivatetask` · time: `newtime`, `edittime`, `deletetime` · timers: `starttimer`, `stoptimer`

> One action can fire multiple events (stopping a timer fires `stoptimer` AND `newtime`) — de-duplicate downstream [DOCS].

**Payload format** (POST to your URL; thin payload — fetch details via the provided URL):

```json
{ "id": 395, "url": "https://api.proworkflow.net/contacts/395" }
```

(`url` omitted for delete events.)

**Verification / security:**

- **Signature header:** **NONE.** No HMAC, no shared secret, no IP allowlist documented [DOCS]. Receivers must treat payloads as untrusted hints: take only the `id` and re-fetch the object via the authenticated API.

**Reliability:**

- **Retry policy:** The overview doc says 3 retries at 1/15/60-minute delays; the `/settings/webhooks/requests` reference says 1 retry after 1 min, then 4 at 15-min intervals, then 4 at hourly intervals — the docs disagree internally [DOCS — discrepancy noted]. Either way: after exhaustion the request AND the webhook subscription are deleted, and the creator is emailed.
- **Dead letter:** `GET /settings/webhooks/requests?status=pending|complete|all` for the last 7 days [DOCS]
- **Ordering / duplicates:** No ordering guarantee; duplicates possible via multi-event actions
- **Rate limit interaction:** Webhook deliveries do NOT count against your API rate limit [DOCS]

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended polling endpoint(s):** any list call with `lastmodifiedfrom` (relative dates shine here: `lastmodifiedfrom=15n`) [CONFIRMED — live API test 2026-06-10]
- **Change detection field(s):** `lastmodified` field + ETags (`If-None-Match` → 304 empty body when unchanged) [CONFIRMED — live API test 2026-06-10]
- **Rate limit implications:** 500 req/30 s is generous for polling; ETag 304s still count as requests

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope          | Limit | Window | Notes                                          |
| -------------- | ----- | ------ | ---------------------------------------------- |
| Per API key    | 500   | 30 s   | Global per account key, all users combined     |

- **Rate limit headers** [CONFIRMED — live API test 2026-06-10, lowercase over HTTP/2]:

| Header                  | Meaning                       | Example Value |
| ----------------------- | ----------------------------- | ------------- |
| `x-ratelimit-limit`     | Requests allowed per window   | `500`         |
| `x-ratelimit-remaining` | Requests left in window       | `493`         |
| `x-ratelimit-reset`     | Seconds until window reset    | `30`          |

- **Rate limit exceeded response:** 429 [DOCS — not deliberately triggered live]
- **Retry-After header:** Not documented; use `x-ratelimit-reset`
- **Backoff strategy:** Sleep `x-ratelimit-reset` seconds on 429; proactively throttle when `remaining` nears 0. Record cap: design for ≤ 500 records per request.

### 8.2 Error Handling [REQUIRED]

**Standard error response format** [CONFIRMED — live API test 2026-06-10]:

```json
{ "status": "Error", "details": ["'content' is a required field"] }
```

**BUT — parse defensively. All three deviations are live-confirmed:**

1. On some 500s `details` is a **bare string**, not an array: `{"status":"Error","details":"An unidentified error occurred, please contact development@proworkflow.com for assistance."}`
2. Some error strings contain **embedded HTML** (`<ul><li>...`)
3. **401 returns an EMPTY body** (no JSON at all)
4. **Unknown paths return an HTML 404 page**, not JSON

**Error codes reference:**

| HTTP Status | Meaning                                        | Retryable? | Recovery Action                          |
| ----------- | ---------------------------------------------- | ---------- | ---------------------------------------- |
| 200         | Success (view/edit/delete)                     | —          |                                          |
| 201         | Success (add) — new ID(s) in `details`         | —          |                                          |
| 304         | Not modified (If-None-Match), empty body       | —          | Use cached copy                          |
| 400         | Bad request — `details` explains               | No         | Fix request (messages are specific)      |
| 401         | apikey or user credentials invalid — empty body| No         | Re-check BOTH credentials                |
| 403         | User permissions deny the operation            | No         | Surface to user; permission change needed|
| 404         | Item not found (JSON) / unknown path (HTML)    | No         | Verify ID / endpoint                     |
| 429         | Rate limit exceeded                            | Yes        | Wait `x-ratelimit-reset` seconds         |
| 500         | Server error (`details` may be bare string)    | Cautiously | Report; retry idempotent GETs only       |

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** No
- GET: yes · PUT: mostly (partial update; re-send safe — but remember empty values clear fields) · DELETE: yes (second call → 404) · POST: no — retried POSTs create duplicates. Verb PUTs (`complete`, `markaspaid`, etc.) are effectively idempotent.

### 8.4 Async Operations [IMPORTANT]

None. All operations are synchronous.

### 8.5 File Handling [IMPORTANT]

- **Upload:** `POST /files` with JSON body — `content` is base64; target exactly one of `projectid`/`taskid`/`folderid` [DOCS]. Max size undocumented; base64-in-JSON makes large uploads impractical.
- **Download:** `GET /files/{fileid}?content=true` → base64, **files ≤ 1 MB only** [DOCS]. Larger files: GET the `link` field's signed `app.proworkflow.com/...getfilesattached.cfm?...sec_key=...` URL [CONFIRMED — live API test 2026-06-10] — note this fetch goes to the app host, NOT the API host, and does not use the API auth headers.

### 8.6 Concurrency & Consistency [NICE-TO-HAVE]

- **Optimistic locking:** None — last write wins. ETags are read-side caching only (no If-Match write support documented).
- **ETags** [CONFIRMED — live API test 2026-06-10]: every list GET returns `etag: <hex>` (unquoted, e.g. `10f7b92898aa74de`); `If-None-Match: <value>` → 304 with empty body when unchanged.

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | When to Use                                            | Fits?   | Notes                                                       |
| -------------------------- | ------------------------------------------------------ | ------- | ----------------------------------------------------------- |
| **Data Connector**         | API has file-like content to browse/search/download    | Partial | Files exist but >1 MB content bypasses the REST API         |
| **Data Connector (Files)** | API is primarily a file storage/document system        | No      | Files are an attachment side-feature                        |
| **Direct API Only**        | API is action-oriented (no browsable content)          | **Yes** | Projects/tasks/time/invoicing actions are the value         |
| **Hybrid**                 | Browsable content AND actions                          | Partial |                                                             |

**Selected integration path:** **Direct API via Numa native data connector** (`request` operation) — NOT Pipedream.

**Justification:** ProWorkflow is action-oriented project management. The Numa workspace agent calls
`connectors(name="request", params={connector: "proworkflow", url: "/projects?pagesize=20&pagenumber=1", method: "GET", body: {...}})`.

**Auth wiring (Numa-specific):**

- The Numa backend **automatically injects BOTH auth mechanisms**: `Authorization: Basic <user's stored username:password>` from the **user's personal vault** and `apikey: <account key>` from the **connector-config company secret** (`connector-config-proworkflow`).
- The agent must **NEVER** set `Authorization` or `apikey` headers itself and never sees the secrets.
- Relative URLs are expanded against the stored `base_url` (`https://api.proworkflow.net`); `Content-Type: application/json` is added by the backend for POST/PUT with a body.
- **Admin setup:** ProWorkflow wizard stores the account API key (admin-entered). **Per-user:** each user is prompted in chat for their own ProWorkflow email + password on first use (stored in their personal vault); ProWorkflow then enforces that user's own permissions server-side — no privilege escalation through a shared account.

### 9.2 Connector Requirements [IMPORTANT]

Not a file connector; the `request` operation covers everything. If file browsing is ever wanted: `list_files` → `GET /files` (+filters), `get_file_metadata` → `GET /files/{id}`, `download_file` → `?content=true` (≤ 1 MB) or signed `link` (any size, app-host fetch), `upload_file` → `POST /files` (base64).

**Auth type for connector:** dual (account API key [company vault] + per-user Basic auth [user vault])
**Connector category:** project-management
**Caching appropriate:** yes for reference data (companies, contacts, settings) — ETag/304 support makes this cheap

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Browse/search projects, tasks, contacts, companies, time, invoices, quotes, messages, notes, expenses, events, workload
2. Create/update projects and tasks; assign people (`contacts` as CSV string); complete/reactivate work
3. Log and edit time records; start/stop timers
4. Add notes, messages, files (small, base64); read invoice/quote financials and subtotals
5. Incremental "what changed" queries via `lastmodifiedfrom` relative dates

**CANNOT do (out of scope or dangerous):**

1. Delete projects (cascades to ALL tasks), delete companies/contacts — destructive deletes should require explicit human confirmation
2. Manage webhooks pointed at arbitrary URLs (no signature mechanism = exfiltration risk)
3. Modify account settings, divisions, permissions, or other-user passwords
4. Act in another Division (API limitation on Advanced plan)

**Default parameters:**

| Parameter             | Default                        | Reason                                                  |
| --------------------- | ------------------------------ | ------------------------------------------------------- |
| `pagesize&pagenumber` | `pagesize=20&pagenumber=1`     | Both required together; keeps responses small           |
| `status`              | leave default (`active`)       | Matches user expectation; use `all` when asked for history |
| `fields`              | explicit minimal list          | Avoid heavy rollup fields unless needed                 |
| contact references    | `"me"`                         | Resolves to the calling user automatically              |

### 9.4 SDK Assessment [NICE-TO-HAVE]

No official SDKs. Plain HTTPS via the Numa connector `request` op is the right approach.

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed
- [x] Phase 2 complete: auth working, first call documented (live trial account)
- [x] Phase 3 complete: core entities with fields documented
- [x] Phase 4 complete: 8+ critical endpoints documented with live request/response
- [x] Phase 5 complete: query and filter patterns documented
- [x] Phase 6 complete: pagination model documented with worked example
- [x] Phase 7 complete: webhooks fully assessed (incl. missing signature mechanism)
- [x] Phase 8 complete: rate limits and error format documented (incl. live-discovered deviations)
- [x] Phase 9 complete: integration path selected (Direct API via Numa native connector)

**Overall investigation confidence:** **high** — official docs are thorough AND the critical paths were live-verified on a real trial account.

**Known gaps that will reduce output quality:**

1. Batch-write partial-failure semantics undocumented and untested
2. 429 response body never observed (limit not deliberately breached)
3. Webhook retry schedule documented inconsistently in two places (see §7.2)
4. Max upload file size undocumented
5. Trial sample-data quirk: pre-seeded/deleted projects may not appear in `/projects` lists even with `status=all`

### 10.2 Generation Prompts [REQUIRED]

Standard output set per `_templates/`: 01-llm-api-rules, 01a-domain-model-reference, 01b-query-patterns, 01c-mutation-patterns, 01d-event-and-error-handling (sources: phases as templated), 02-api-spec-investigation (done — see companion file). 03-connector-setup: generate only the Direct-API/request-op variant (no file-connector mapping).

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence | Gaps                                          |
| ---------------------------- | ------------- | ---------- | --------------------------------------------- |
| 01-llm-api-rules             | Yes           | High       | —                                             |
| 01a-domain-model-reference   | Yes           | High       | Some entity field lists doc-derived only      |
| 01b-query-patterns           | Yes           | High       | —                                             |
| 01c-mutation-patterns        | Yes           | High       | Batch partial-failure unknown                 |
| 01d-event-and-error-handling | Yes           | High       | Webhook retry-schedule discrepancy            |
| 02-api-spec-investigation    | Yes (done)    | High       | —                                             |
| 03-connector-setup           | Yes           | High       | Direct-API variant only                       |

---

_Investigated 2026-06-10 against ProWorkflow trial account "ArcanumAI" (Advanced plan). Credentials sanitized._
