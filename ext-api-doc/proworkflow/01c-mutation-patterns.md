---
api_name: 'ProWorkflow'
api_slug: 'proworkflow'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-06-10'
update_source: 'official API docs + live API testing (trial account "ArcanumAI", Advanced plan)'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# ProWorkflow -- Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. Contains all write operation patterns including
> create, update, delete, state transitions, line items, timers, and API custom fields.
> Facts marked [CONFIRMED -- live API test 2026-06-10] were verified against a live trial account.

> **Auth note:** Examples show bare relative paths and JSON bodies. The Numa backend injects
> both auth mechanisms (Basic auth + `apikey` header) and sets `Content-Type: application/json`
> automatically when the workspace agent calls
> `connectors(name="request", params={connector: "proworkflow", url: "/...", method: "POST|PUT|DELETE", body: {...}})`.
> Never set Authorization or apikey headers yourself.

---

## Write Capabilities Summary

| Operation         | Supported | Method | Notes                                                                          |
| ----------------- | --------- | ------ | ------------------------------------------------------------------------------ |
| Create            | Yes       | POST   | 201 + `details` array (always an array, even for one item) [CONFIRMED]         |
| Full replace      | No        | --     | PUT is always partial                                                          |
| Partial update    | Yes       | PUT    | Only send changed fields. **An empty value CLEARS the field** -- see below      |
| Delete            | Yes       | DELETE | Single item; several deletes cascade (project delete removes its tasks etc.)   |
| Soft delete       | No        | --     | Deletes are hard; "complete" status is the reversible alternative              |
| Bulk create       | Limited   | POST   | Companies, contacts, tasks, and invoice/quote lines accept an ARRAY body       |
| Bulk update       | No        | --     | One PUT per item                                                               |
| Bulk delete       | Limited   | PUT    | `PUT /tasks/delete` with `taskid` list (same project only) -- note: PUT!       |
| State transitions | Yes       | PUT    | `complete`, `reactivate`, `approve`, `decline`, `markaspaid`, timers, ...      |
| File upload       | Partial   | POST   | `/files` metadata via API; content transfer goes through signed app links      |

---

## The Three Success Shapes [CONFIRMED -- live API test 2026-06-10]

```json
// POST  -> HTTP 201
{ "message": "Project/s Added", "status": "Success", "details": [ { "id": 6, "number": "P-0103", "title": "..." } ] }

// PUT   -> HTTP 200
{ "message": "Contact Updated", "status": "Success", "details": [ { "id": 393 } ] }

// DELETE -> HTTP 200
{ "message": "Contact Deleted", "status": "Success", "details": [ { "id": 393 } ] }
```

`details` is **ALWAYS an array** on success -- read `details[0].id` for single-item calls.
Multi-item POSTs return one `details` entry per created item, in input order.

---

## !!! PUT Semantics: Empty Value CLEARS the Field !!!

ProWorkflow PUTs are partial updates -- omitted fields keep their values. **BUT any field you
include with an empty value (`""`) is WIPED.** There is no "send the whole object back"
safety net here: if you GET an item, tweak one field, and PUT the entire object back, every
field that happened to be empty-string stays empty -- and any field you blanked gets cleared
in ProWorkflow.

**Rules for the agent:**

1. Send ONLY the fields you intend to change. Never echo back a full GET payload.
2. Never send `""` unless the user explicitly wants that field cleared.
3. Treat "clear the X" requests as deliberate: confirm, then send `{"x": ""}`.

```http
PUT /contacts/393

{ "mobilephone": "01234567890", "workphone": "" }
```

Result: mobilephone updated, **workphone erased**. The second half of that body is only
correct if erasing was the goal.

---

## Common Patterns

### Pattern 1: Create -- Single Item

**Project (minimal confirmed body):** [CONFIRMED -- live API test 2026-06-10]

```http
POST /projects

{ "title": "Website Refresh", "companyid": 8, "managerid": "me", "startdate": "+0d", "duedate": "+2w" }
```

**Response (201):**

```json
{ "message": "Project/s Added", "status": "Success", "details": [ { "id": 6, "number": "P-0103", "title": "Website Refresh" } ] }
```

- Required: `title` + `companyid` (external) -- or `internalclientcontactid` (+
  `internalclientgroupid` if that contact is in >1 group) for internal projects (Advanced).
- The project **NUMBER (`P-0103`) and numeric `id` (6) are distinct** -- all API calls use the
  numeric `id`; the number is the human-facing label. [CONFIRMED -- live API test 2026-06-10]
- Useful optionals: `description`, `managerid` (default `me`), `staff`/`clients`/`contractors`
  (comma ID strings), `priority` (1-5 = Very High..Very Low), `number` (default `auto`),
  `categoryid`, `tagid`, `timeallocated` (minutes), `templateid` (Advanced),
  `customfields`/`apifields` (arrays of `{id, value}`).
- Setting `completedate` on create adds the project already-Completed (no alerts sent).

**Task (confirmed body -- note the contacts format):** [CONFIRMED -- live API test 2026-06-10]

```http
POST /tasks

{ "name": "Draft homepage copy", "projectid": 6, "contacts": "me", "duedate": "+3d" }
```

**Response (201):** `{ "message": "Task/s Added", "status": "Success", "details": [ { "id": 12, "name": "Draft homepage copy" } ] }`

- **`contacts` is a COMMA-SEPARATED STRING** -- `"me"`, `"1,2"`, `"allstaff"`, `"all"`, or
  `"none"`. Sending an array of objects like `[{"id": "me"}]` causes an **HTTP 500** with a
  bare-string `details` ("An unidentified error occurred..."). [CONFIRMED -- live API test 2026-06-10]
- Provide `projectid` (project task) or `categoryid` (general task), or `templateid` to
  instantiate a task template.
- Optionals: `description`, `priority` (default 3), `startdate`, `duedate`, `billable`
  (default true), `taxable` (default true), `timeallocated` (minutes, default 0),
  `order`/`orderlevel` (placement), `prerequisites` (task IDs, supports `newX` refs),
  `type` (`normal`/`bold`/`heading`), `tasklistid`, `tagid`.

**Time record (confirmed combos):** [CONFIRMED -- live API test 2026-06-10]

```http
POST /time

{ "taskid": 12, "contactid": "me", "timetracked": 30, "notes": "Initial draft" }
```

**Response (201):** `{ "message": "Time Added", "status": "Success", "details": [ { "id": 44 } ] }`

- The duration field is **`timetracked` (minutes)**. There is NO `timeminutes` field.
- Valid field combinations (anything else -> 400 listing these):
  - `starttime` & `endtime` (tracked time computed)
  - `starttime` & `timetracked` (end computed)
  - `endtime` & `timetracked` (start computed)
  - `timetracked` alone (end = now, start computed)
- `starttime`/`endtime` take ISO8601 `yyyy-mm-ddThh:mm` or the literal `now`.
- `contactid` defaults to `me`. A `date` field with `timetracked` also worked live:
  `{"contactid":"me","date":"2026-06-10","timetracked":30,"notes":"..."}` -> 201.

**Message (confirmed: `title`, NOT `subject`):** [CONFIRMED -- live API test 2026-06-10]

```http
POST /messages

{ "projectid": 6, "title": "Kickoff notes", "content": "Agenda attached.", "contacts": "me" }
```

- New discussions require `title` + `contacts` (+ `projectid` or `taskid`); replies use
  `originalmessageid` instead. Attach files with `files` (IDs from the same project).
- Optionals: `notifications` (default true), `public` (default true).

**Note on a company (confirmed: `content` required):** [CONFIRMED -- live API test 2026-06-10]

```http
POST /companies/8/notes

{ "title": "Renewal context", "content": "Contract renews in October; flag pricing early." }
```

- Missing `content` -> 400 `"'content' is a required field"`. `title` is optional.
- Same shape for `/contacts/{id}/notes` and the top-level `/notes` call.

---

### Pattern 2: Create -- Multiple Items (array body)

Supported for **companies, contacts, tasks**, and for **lines** added to an invoice or quote.
Send a JSON array instead of an object:

```http
POST /contacts

[
  { "companyid": 29, "firstname": "Adam", "lastname": "West", "email": "adam@abcmedia.com", "type": "client" },
  { "companyid": 29, "firstname": "Amy",  "lastname": "West", "email": "amy@abcmedia.com",  "type": "client" }
]
```

**Response (201):**

```json
{ "message": "Contact/s Added", "status": "Success", "details": [ { "id": 393, "name": "Adam West" }, { "id": 394, "name": "Amy West" } ] }
```

**Multi-task constraint:** all tasks in one batch must share the same `projectid` (or
`categoryid`) and the same `order` option (or explicit order numbers). With
`auto`/`after`/`before` ordering they are inserted in array order.

---

### Pattern 3: Update (PUT, partial)

```http
PUT /contacts/393

{ "mobilephone": "01234567890", "workphone": "09876543210" }
```

**Response (200):** `{ "message": "Contact Updated", "status": "Success", "details": [ { "id": 393 } ] }`

**Behavior:**

- Only included fields change; omitted fields keep their values.
- **Empty value (`""`) clears the field** -- see the warning section above.
- Time record edits support the same `starttime`/`endtime`/`timetracked` combinations as
  create, plus single-field variants (e.g. `timetracked` alone recomputes the end time from
  the existing start).
- Some fields are immutable on edit: a message's `title`/`content` cannot be changed (only
  its contacts/notifications/public flags); a webhook's `event` cannot be changed; an API
  Field's `type` cannot be changed.
- Editing a company's `type` also converts all of its contacts (only possible when none are
  assigned to projects/tasks).

---

### Pattern 4: Delete (and its cascades)

```http
DELETE /contacts/393
```

**Response (200):** `{ "message": "Contact Deleted", "status": "Success", "details": [ { "id": 393 } ] }`

**Cascade matrix -- know what else dies:**

| Call                          | Cascades                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `DELETE /projects/{id}`       | Deletes ALL the project's Tasks, Files, Messages & Time Records [CONFIRMED -- live API test 2026-06-10] |
| `DELETE /companies/{id}`      | `deletecontacts` defaults to **true** -- contacts deleted too. Pass `deletecontacts=false` to keep them (then reassign them to a company or they're unusable) |
| `PUT /tasks/delete`           | Bulk task delete (body `{"taskid": "1,2,3"}`, same project only) -- deletes the tasks' Files, Messages & Time Records. **Note: method is PUT, path is /tasks/delete** |
| `DELETE /messages/{id}`       | Deleting the FIRST message of a discussion deletes the entire thread; only your own messages can be deleted |
| `DELETE /settings/apifields/{id}` | Removes the field everywhere; recovery requires ProWorkflow support                          |

All deletes are **hard** -- there is no undo via the API.

---

### Pattern 5: State Transitions (dedicated action endpoints -- all PUT)

ProWorkflow uses **PUT** (not POST) for action endpoints. Most accept an empty JSON body `{}`.

**Complete / reactivate a task:** [CONFIRMED -- live API test 2026-06-10]

```http
PUT /tasks/12/complete
{}
```

Response (200): `"Task Completed"`. Optional body: `{"completedate": "2026-06-09"}` (defaults
to now). Reverse with `PUT /tasks/12/reactivate`.

**Complete / reactivate a project:**

```http
PUT /projects/6/complete
{ "completedate": "+0d" }
```

Completing a project also completes ALL of its active tasks. Reverse with
`PUT /projects/6/reactivate`.

**Invoice paid status:**

```http
PUT /invoices/55/markaspaid
{ "paiddate": "2026-06-10" }          # paiddate optional, defaults to now
PUT /invoices/55/markasunpaid
{}
```

**Quote lifecycle:**

```http
PUT /quotes/9/approve
{ "approveddate": "2026-06-10", "projectid": 6 }   # both optional; projectid attaches quote to a project
PUT /quotes/9/decline
{}
PUT /quotes/9/markaspending
{}                                                  # reverts an approved/declined quote
```

Approve/decline are performed by a staff user on behalf of the client.

**Project request triage:**

```http
PUT /projectrequests/3/approve
{ "number": "auto", "clientaccess": true }   # optionals; creates the project
PUT /projectrequests/3/decline
{}
```

On Solo/Professional plans the approving contact becomes project manager; on Advanced the
project goes to the contact the request was submitted to.

**Adjust dates (DANGEROUS if repeated):**

```http
PUT /projects/6/adjustdates
{ "adjustment": "+1w", "dates": "all", "tasks": "active", "taskdates": "all" }

PUT /tasks/12/adjustdates
{ "adjustment": "-3d", "dates": "due" }
```

- `adjustment` is `+/-Xd/w/m/y`: **positive defers, negative advances.**
- Project variant: `dates` (project's own dates: `all`/`start`/`due`, omit to leave project
  dates alone), `tasks` (`all`/`active`/`complete`), `taskdates` (`all`/`start`/`due`).
- **NOT idempotent** -- running it twice shifts dates twice. The official docs explicitly warn
  about accidental re-runs. Never retry this call on timeout without checking state first.

**Timers:**

```http
PUT /tasks/12/starttimer
{ "notes": "Working on copy" }        # starting a timer STOPS any other running timer

PUT /tasks/12/stoptimer
{ "notes": "Done for now" }

PUT /time/44/stoptimer                 # stop by time-record ID
{}
```

- `GET /time/activetimers` lists running timers (`timetrackedseconds` + whole-minute
  `timetracked`).
- Stopping a timer fires BOTH `stoptimer` and `newtime` webhook events -- de-duplicate if you
  subscribe to both.

**Assign / unassign task contacts:**

```http
PUT /tasks/12/contacts
{ "contacts": "1,2" }                  # add
PUT /tasks/12/contacts
{ "contacts": "1,2", "remove": true }  # remove
```

Project tasks can only be assigned contacts already on the project; general tasks accept
staff only.

---

### Pattern 6: Quotes & Invoices with Line Items

**Create a quote (lines inline):**

```http
POST /quotes

{
  "title": "Website Refresh Quote",
  "number": "auto",
  "contactid": 504,
  "projectid": 6,
  "lines": [
    { "type": "heading",  "name": "Design" },
    { "type": "lineitem", "name": "Homepage design", "quantity": 1, "rate": 1200.00, "taxable": true },
    { "type": "taskrate", "name": "Development",     "time": 480,   "rate": 150.00,  "taxable": true },
    { "type": "staffrate","name": "Amy West",        "time": 120,   "rate": 100.00,  "taxable": false }
  ]
}
```

**Line type rules (quotes AND invoices):**

| `type`      | Required fields                              | Notes                                  |
| ----------- | --------------------------------------------- | --------------------------------------- |
| `heading`   | `name`                                        | Section header, no amount               |
| `lineitem`  | `name` or `description`, `quantity`, `rate`   | quantity x rate                         |
| `taskrate`  | `name`, `time`, `rate`                        | `rate` = cost per HOUR, `time` = MINUTES |
| `staffrate` | `name`, `time`, `rate`                        | `rate` = cost per HOUR, `time` = MINUTES |
| `expense`   | `name`, `quantity`, `rate`                    | Invoices only                           |

**The hour/minute split is a classic mistake:** `rate` is per hour, `time` is in minutes.
A 2-hour task at $150/hr is `{"time": 120, "rate": 150.00}` -> $300.

**Invoice create** is the same shape via `POST /invoices` with required `companyid`,
`contactid`, `lines` (plus optional `title`, `number: "auto"`, `description`, `projectid`).

**Add / edit / delete lines after creation:**

```http
POST /quotes/9/lines            # single object or array of lines; displayorder: auto | afterN | beforeN | number
PUT  /quotes/9/lines/101        # partial edit: { "rate": 110.00, "taxable": false }
DELETE /quotes/9/lines/101
```

Identical sub-resources exist at `/invoices/{invoiceid}/lines[/{lineid}]`.

---

### Pattern 7: API Custom Fields (settings/apifields)

API Fields are extra fields you bolt onto core types -- **visible ONLY via the API, never in
the ProWorkflow app UI**. Supported types: `company`, `contact`, `invoice`, `project`
(covers project requests too), `quote`, `task`, `time`.

**1. Create the field (once per account):**

```http
POST /settings/apifields

{ "name": "crm_sync_id", "type": "project", "private": true }
```

Response (201): `{ "message": "Field Added", "status": "Success", "details": [ { "id": 3, "name": "crm_sync_id" } ] }`

- Field names must be unique per type. `private: true` hides values from non-staff contacts.
- **Use the returned `id` in all subsequent requests, never the name.**
- `type` is immutable after creation; `PUT /settings/apifields/3` can rename or change
  `private`. List fields with `GET /settings/apifields?type=project`.

**2. Set a value on an item (via the item's PUT/POST, `apifields` array):**

```http
PUT /projects/6

{ "apifields": [ { "id": 3, "value": "CRM-88231" } ] }
```

**3. Read it back / filter on it:**

```http
GET /projects?fields=number,title,apifield3
GET /projects?apifields=3,CRM-88231
```

This is the supported way to stamp Numa/external system IDs onto ProWorkflow records for
cross-system reconciliation without polluting the customer's UI.

---

## Field Validation Rules

| Entity   | Field                         | Rule                                                       | Error if violated                                                              |
| -------- | ----------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Task     | `contacts`                    | Comma-separated STRING, not array of objects                | HTTP **500**, `details` = bare string "An unidentified error occurred..." [CONFIRMED] |
| Time     | `starttime`/`endtime`/`timetracked` | Must be one of the four valid combinations            | 400 listing valid combos: "'starttime' & 'endtime', 'starttime' & 'timetracked', ..." [CONFIRMED] |
| Time     | duration field name           | `timetracked` (minutes); `timeminutes` does not exist       | 400 [CONFIRMED]                                                                  |
| Note     | `content`                     | Required                                                    | 400 "'content' is a required field" [CONFIRMED]                                  |
| Message  | `title`                       | Required for new discussions (NOT `subject`)                | 400 [CONFIRMED]                                                                  |
| Message  | `contacts`                    | Required for new discussions                                | 400 [CONFIRMED]                                                                  |
| Project  | `title`, `companyid`          | Required (external projects)                                | 400                                                                              |
| Quote/Invoice line | per-`type` fields   | See line type table above                                   | 400                                                                              |
| Paging   | `pagesize`/`pagenumber`       | Both or neither                                             | 400 "pagesize and pagenumber must both be provided..." [CONFIRMED]               |
| API Field| `name` + `type`               | Unique name per type; `type` immutable                      | 400                                                                              |
| Webhook  | `event`                       | Immutable after create (delete + recreate to change)        | --                                                                               |

---

## Server-Side Defaults

| Entity      | Field          | Default                         | When applied |
| ----------- | -------------- | -------------------------------- | ------------ |
| All         | `id`           | auto-generated integer           | create       |
| All         | `lastmodified` | current timestamp                | create, edit |
| Project     | `number`       | `auto` (autonumbering, e.g. P-0103) | create    |
| Project     | `managerid`    | `me` (requesting user)           | create       |
| Project     | status         | active                           | create (Completed if `completedate` supplied) |
| Task        | `contacts`     | `me`                             | create       |
| Task        | `priority`     | 3 (Normal)                       | create       |
| Task        | `billable` / `taxable` | true / true              | create       |
| Task        | `timeallocated`| 0                                | create       |
| Task        | `order` / `type` | `auto` (last in project) / `normal` | create  |
| Time        | `contactid`    | `me`                             | create       |
| Time        | `endtime`      | now (when only `timetracked` sent) | create     |
| Quote/Invoice | `number`     | `auto`                           | create       |
| Line        | `taxable`      | true                             | create       |
| Line        | `displayorder` | `auto` (appended last)           | create       |
| Message     | `notifications` / `public` | true / true          | create       |
| API Field   | `private`      | false                            | create       |

---

## Worked Examples

### Example 1: Project -> task -> tracked time -> complete (all confirmed live)

> The full happy path exercised against the trial account on 2026-06-10.

```http
POST /projects
{ "title": "Website Refresh", "companyid": 8, "managerid": "me", "duedate": "+2w" }
```

Response (201): `{ "message": "Project/s Added", "status": "Success", "details": [ { "id": 6, "number": "P-0103", "title": "Website Refresh" } ] }`

```http
POST /tasks
{ "name": "Draft homepage copy", "projectid": 6, "contacts": "me", "duedate": "+3d" }
```

Response (201): `details: [ { "id": 12, ... } ]`

```http
POST /time
{ "taskid": 12, "contactid": "me", "timetracked": 30, "notes": "Initial draft" }
```

Response (201): `details: [ { "id": 44 } ]`

```http
PUT /tasks/12/complete
{}
```

Response (200): `{ "message": "Task Completed", "status": "Success", "details": [ { "id": 12 } ] }`

**Notes:**

- `contacts: "me"` (string) on the task -- the array form is a 500. [CONFIRMED]
- `timetracked` is minutes; 30 = half an hour. [CONFIRMED]
- Action endpoints are PUT with `{}`. [CONFIRMED]

---

### Example 2: Quote a project, then approve it

```http
POST /quotes
{
  "title": "Refresh Quote", "number": "auto", "contactid": 504, "projectid": 6,
  "lines": [
    { "type": "heading",  "name": "Build" },
    { "type": "taskrate", "name": "Development", "time": 600, "rate": 150.00, "taxable": true },
    { "type": "lineitem", "name": "Stock photography", "quantity": 5, "rate": 40.00, "taxable": true }
  ]
}
```

Response (201): `details: [ { "id": 9, ... } ]` -- 600 min @ $150/hr = $1,500 + $200 = $1,700 pre-tax.

```http
PUT /quotes/9/approve
{ "approveddate": "+0d", "projectid": 6 }
```

**Notes:**

- `time` minutes / `rate` per hour on `taskrate`/`staffrate` lines.
- `markaspending` reverts an approve/decline if the user changes their mind.

---

### Example 3: Clear a field deliberately (and only deliberately)

> User: "Remove the PO number from project 6."

```http
PUT /projects/6
{ "purchaseordernumber": "" }
```

Response (200): `details: [ { "id": 6 } ]`

**Notes:**

- The empty string is the clear mechanism -- this is exactly why you must never echo whole
  objects back on PUT. One stray `""` silently erases data.

---

## Gotchas & Counter-Exceptions

1. **Empty value on PUT clears the field.** The single most dangerous behavior in this API.
   Send only fields you mean to change; `""` only to wipe.
2. **Task `contacts` is a comma string, not an array.** `[{"id":"me"}]` -> HTTP 500 with a
   bare-string `details`. Use `"me"` / `"1,2"` / `"allstaff"`. [CONFIRMED -- live API test 2026-06-10]
3. **Action endpoints are PUT, not POST** (`/complete`, `/approve`, `/markaspaid`,
   `/starttimer`, `/adjustdates`, ...). And **bulk task delete is `PUT /tasks/delete`**, not
   a DELETE verb.
4. **Time duration is `timetracked` in minutes** with exactly four legal field combos --
   `timeminutes` doesn't exist. [CONFIRMED -- live API test 2026-06-10]
5. **Messages use `title`, not `subject`**, and a message's title/content are immutable after
   posting (only contacts/notifications/public can be edited). [CONFIRMED -- live API test 2026-06-10]
6. **`adjustdates` is not idempotent.** Re-running shifts dates again. Never blind-retry.
7. **Company delete kills its contacts by default** (`deletecontacts` defaults to `true`).
   Pass `false` to keep them -- but then reassign them to another company or they become
   unusable in the app.
8. **Starting a timer stops any other running timer** for that user -- side effect, not error.
9. **Stopping a timer fires two webhook events** (`stoptimer` + `newtime`) -- act on one.
10. **Project number != project id.** Creates return both (`"number": "P-0103"`, `"id": 6`);
    every API call wants the numeric id. [CONFIRMED -- live API test 2026-06-10]
11. **API Fields are API-only.** Values set via `apifields` never appear in the ProWorkflow
    UI -- don't use them for data the customer needs to see; do use them for sync metadata.
12. **Some creates with a `completedate` skip notifications** (projects/tasks added as
    Completed send no alerts) -- useful for backfilling history quietly.

---

## Dangerous Operations

> Destructive, irreversible, or side-effect-heavy calls. The workspace agent should confirm
> with the user before executing these.

| Operation                            | Why dangerous                                                            | Safeguard                                                                |
| ------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `DELETE /projects/{id}`              | Cascades: deletes ALL tasks, files, messages, time records [CONFIRMED]    | Confirm with user; state the cascade explicitly                          |
| `DELETE /companies/{id}`             | Deletes the company AND its contacts by default                           | Confirm; ask whether to pass `deletecontacts=false`                       |
| `PUT /tasks/delete`                  | Bulk-deletes tasks + their files/messages/time                            | Confirm the exact task list; docs say "use with caution"                  |
| `PUT /.../adjustdates`               | Not idempotent -- repeats compound                                        | Never auto-retry; read dates back after the call                          |
| Any PUT containing `""` values       | Silently erases fields                                                    | Only include `""` when the user explicitly asked to clear that field      |
| `DELETE /messages/{first-in-thread}` | Deletes the entire discussion                                             | Check whether the message started the thread before deleting              |
| `DELETE /settings/apifields/{id}`    | Field + values gone; recovery requires vendor support                     | Confirm; prefer renaming/abandoning the field                             |
| `PUT /quotes/{id}/approve`           | Business-state change done "on behalf of the client"                      | Confirm user has authority; `markaspending` is the undo                   |
| `PUT /invoices/{id}/markaspaid`      | Financial state change                                                    | Confirm; `markasunpaid` is the undo                                       |

---

_Generated from the official ProWorkflow API documentation and live API testing, Phases 3-4._
