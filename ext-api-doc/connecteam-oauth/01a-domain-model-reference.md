---
api_name: 'Connecteam API (OAuth)'
api_slug: 'connecteam-oauth'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior']
data_sources:
  [
    'developer.connecteam.com reference pages',
    'Time Clock / Scheduler / Forms overview docs',
    'help.connecteam.com API articles',
  ]
---

# Connecteam (OAuth) -- Domain Model Reference

> Companion to `01-llm-api-rules.md`. Full entity catalog, relationships, state machines, and
> business rules the workspace agent references when working with Connecteam data.
>
> **Shared API:** Identical to the `connecteam-api` (API-key) connector — only auth differs.
> Field schemas are largely **[DOCUMENTED]** from overview pages but exact slugs/types are often
> **[INFERRED]** because per-endpoint response schemas sit behind the portal's interactive "Try It"
> widget. No live calls were possible — treat field tables as a strong starting point, not gospel.

---

## Entity Catalog

### User (Employee)

**Resource path:** `/users/v1/users` [DOCUMENTED]
**Description:** A Connecteam team member (employee / manager / admin). Identity is phone-led.
**CRUD:** Create (POST, batch ≤ 25), Read (list + by id), Update (PUT), Archive/Unarchive, Delete [DOCUMENTED]

| Field        | Type              | Required     | Writable | Description                              | Example                  |
| ------------ | ----------------- | ------------ | -------- | ---------------------------------------- | ------------------------ |
| userId       | integer           | -            | no       | Unique user identifier                   | `4815162`                |
| firstName    | string            | yes (create) | yes      | Given name                               | `"Jane"`                 |
| lastName     | string            | yes (create) | yes      | Family name                              | `"Doe"`                  |
| phoneNumber  | string (E.164)    | yes (create) | yes      | Login identity (Connecteam is phone-led) | `"+14155550101"`         |
| email        | string            | no           | yes      | Email address                            | `"jane@acme.com"`        |
| userType     | string/enum       | no           | yes      | `user` / `manager` / `admin`             | `"user"`                 |
| userStatus   | enum              | no           | no       | `active` / `archived`                    | `"active"`               |
| customFields | array<object>     | no           | yes      | Tenant-defined custom fields             | `[{"id":1,"value":"…"}]` |
| createdAt    | integer (epoch s) | -            | no       | Creation timestamp                       | `1716950400`             |
| modifiedAt   | integer (epoch s) | -            | no       | Last-modified timestamp                  | `1716950400`             |

> **Confidence:** path/CRUD/batch-cap [DOCUMENTED]; field types [INFERRED] where the schema is not shown.

---

### Time Clock

**Resource path:** `/time-clock/v1/time-clocks` [DOCUMENTED]
**Description:** A configured time-tracking instrument. Container for time activities; holds no work records itself.
**CRUD:** Read (list) [DOCUMENTED]

| Field       | Type    | Required | Writable | Description          | Example        |
| ----------- | ------- | -------- | -------- | -------------------- | -------------- |
| timeClockId | integer | -        | no       | Unique time-clock id | `12345`        |
| name        | string  | -        | no       | Time-clock name      | `"Field crew"` |

---

### Time Activity (Shift / Break / Time-off)

**Resource path:** `/time-clock/v1/time-clocks/{timeClockId}/time-activities` [DOCUMENTED]
**Description:** A work record under a time clock. Three categories: **shift** (clock-in/out work period),
**break** (manual, paid or unpaid), **timeoff** (approved PTO shown on the timesheet).
**CRUD:** Read (GET), Create (POST), Update (PUT). Real-time `clock-in`/`clock-out` are separate POSTs. [DOCUMENTED]

| Field       | Type              | Required   | Writable | Description                       | Example      |
| ----------- | ----------------- | ---------- | -------- | --------------------------------- | ------------ |
| timeClockId | integer           | yes (path) | no       | Parent time-clock id (path param) | `12345`      |
| userId      | integer           | yes        | yes      | Employee the activity belongs to  | `4815162`    |
| start       | integer (epoch s) | yes        | yes      | Activity start (Unix seconds)     | `1716969600` |
| end         | integer (epoch s) | no         | yes      | Activity end; absent if open      | `1716998400` |
| type        | enum              | yes        | yes      | `shift` / `break` / `timeoff`     | `"shift"`    |

> **Range constraint:** time-activity queries are limited to a **92-day (3-month)** window. [DOCUMENTED]

---

### Timesheet

**Resource path:** `/time-clock/v1/time-clocks/{timeClockId}/timesheet` [DOCUMENTED]
**Description:** Aggregated payroll summary for a time clock over a date range (total hours, breaks, etc.).
**CRUD:** Read (GET) [DOCUMENTED]

---

### Scheduler

**Resource path:** `/scheduler/v1/schedulers` [DOCUMENTED]
**Description:** A schedule board that owns shifts.
**CRUD:** Read (list) [DOCUMENTED]

| Field       | Type    | Required | Writable | Description         | Example      |
| ----------- | ------- | -------- | -------- | ------------------- | ------------ |
| schedulerId | integer | -        | no       | Unique scheduler id | `321`        |
| name        | string  | -        | no       | Scheduler name      | `"Auckland"` |

---

### Shift

**Resource path:** `/scheduler/v1/schedulers/{schedulerId}/shifts` [DOCUMENTED]
**Description:** A scheduled work slot on a scheduler.
**CRUD:** Read (list + by id), Create (POST ≤ 500), Update (PUT bulk), Delete (bulk ≤ 20, or single) [DOCUMENTED]

| Field        | Type              | Required   | Writable | Description                                | Example       |
| ------------ | ----------------- | ---------- | -------- | ------------------------------------------ | ------------- |
| shiftId      | integer/string    | -          | no       | Unique shift id                            | `987654`      |
| schedulerId  | integer           | yes (path) | no       | Parent scheduler (path param)              | `321`         |
| type         | enum              | no         | yes      | `regular` / `open` / `draft` / `group`     | `"regular"`   |
| assignees    | array<integer>    | no         | yes      | userIds assigned to the shift              | `[4815162]`   |
| startTime    | integer (epoch s) | yes        | yes      | Shift start                                | `1716969600`  |
| endTime      | integer (epoch s) | yes        | yes      | Shift end                                  | `1716998400`  |
| status       | enum              | no         | yes      | `published` / `draft` (derived from state) | `"published"` |
| shiftLayers  | array/object      | no         | yes      | Layer values (jobs/locations/notes)        | `[…]`         |
| customFields | array/object      | no         | yes      | Tenant-defined custom fields               | `[…]`         |

> **Unsupported scheduler features (NOT available via API):** data layers, shift tasks, repeating shifts,
> and group shifts (`type: group`). Do not attempt to create/edit these. [DOCUMENTED]

---

### User Unavailability

**Resource paths:** [DOCUMENTED]

- `GET /scheduler/v1/schedulers/user-unavailability` — combined view (unavailabilities + approved time-off + assigned shifts)
- `POST /scheduler/v1/schedulers/{schedulerId}/unavailability` — add
- `DELETE /scheduler/v1/schedulers/{schedulerId}/unavailability/{unavailabilityId}` — remove

**Description:** Per-user availability windows, used by the scheduler when assigning shifts.

---

### Form

**Resource paths:** `/forms/v1/forms` (list), `/forms/v1/forms/{formId}` (get) [DOCUMENTED]
**Description:** A form template defined in Connecteam.
**CRUD:** Read [DOCUMENTED]

| Field  | Type    | Required | Writable | Description    | Example           |
| ------ | ------- | -------- | -------- | -------------- | ----------------- |
| formId | integer | -        | no       | Unique form id | `555`             |
| name   | string  | -        | no       | Form title     | `"Vehicle check"` |

---

### Form Submission

**Resource paths:** `/forms/v1/forms/{formId}/form-submissions` (list); get-single + manager-field update also documented [DOCUMENTED]
**Description:** A completed submission of a form by a user. **Manager fields** (person, status, note, date) are updatable; the answer entries are read-only.
**CRUD:** Read (list + single), Update (manager fields only) [DOCUMENTED]

| Field         | Type              | Required | Writable | Description                                       |
| ------------- | ----------------- | -------- | -------- | ------------------------------------------------- |
| submissionId  | integer/string    | -        | no       | Unique submission id                              |
| formId        | integer           | -        | no       | Parent form                                       |
| userId        | integer           | -        | no       | Submitting user                                   |
| submittedAt   | integer (epoch s) | -        | no       | Submission timestamp                              |
| entries       | array<object>     | -        | no       | Question/answer pairs                             |
| managerFields | object            | -        | partial  | `person` / `status` / `note` / `date` (updatable) |

> **[INFERRED]** — submission response schema is not exposed on the reference page; verify against a live call.
> **Attachments / PDF export:** referenced in the developer forum but the retrieval pattern is undocumented. [INFERRED — discovery needed]

---

### Job (Job Scheduler / Sub-jobs)

**Resource path:** `/jobs/v1/...` (sub-jobs documented at `/docs/sub-jobs`) [DOCUMENTED — module]; exact paths [INFERRED]
**Description:** Jobs and sub-jobs used to tag/categorise time activities and shifts.
**CRUD:** Create + manage, with sub-job support [DOCUMENTED]

---

### Attachment

**Resource path:** `/attachments/v1/...` [INFERRED — module exists; `attachments.write` scope is in the registry]
**Description:** Uploaded files referenced by other resources (e.g. form submissions).
**CRUD:** Upload (write) [DOCUMENTED — scope]; paths [INFERRED]

---

### Webhook Subscription

**Resource path:** `/settings/v1/webhooks` [DOCUMENTED]
**Description:** A registered HTTPS endpoint that receives event callbacks for a feature.
**CRUD:** Create (POST) [DOCUMENTED]; list/delete [INFERRED]

| Field      | Type           | Required | Writable | Description                                               |
| ---------- | -------------- | -------- | -------- | --------------------------------------------------------- |
| name       | string         | yes      | yes      | Subscription label                                        |
| url        | string (HTTPS) | yes      | yes      | Delivery endpoint                                         |
| feature    | enum           | yes      | yes      | `users`/`time_activity`/`shift_scheduler`/`forms`/`tasks` |
| events     | array<string>  | yes      | yes      | Event names within the feature                            |
| secretKey  | string         | no       | yes      | Signature-verification secret                             |
| retryLimit | integer        | no       | yes      | Delivery retry count (3)                                  |

---

## Entity Relationship Diagram

```
┌──────────┐        assigned to        ┌──────────────┐
│   User   │<──────────────────────────│    Shift     │
└──────────┘   (assignees array)       └──────┬───────┘
     │  1:N                                    │ N:1
     │                                         ▼
     ▼                                  ┌──────────────┐
┌───────────────┐   under   ┌──────────┐│  Scheduler   │
│ Time Activity │──────────>│Time Clock│└──────────────┘
└───────────────┘           └────┬─────┘
     │ N:1 (userId)               │ aggregated by
     ▼                            ▼
┌──────────┐   submits   ┌──────────────────┐   of   ┌──────────┐
│   User   │────────────>│ Form Submission  │───────>│   Form   │
└──────────┘             └──────────────────┘        └──────────┘
     │
     │ tagged by
     ▼
┌──────────┐
│   Job    │ (+ sub-jobs) ── referenced by Shifts / Time Activities (shiftLayers)
└──────────┘
```

[INFERRED — relationships deduced from path nesting and field names; no published ERD.]

---

## State Machines

### Time Activity (Shift) [INFERRED — from clock-in/out semantics]

```
(none) ──POST clock-in / create with start only──> [open]
[open] ──POST clock-out / PUT end──> [closed]
```

| From   | Action / Trigger           | To     | Reversible? | Side Effects                        |
| ------ | -------------------------- | ------ | ----------- | ----------------------------------- |
| (none) | POST clock-in / create     | open   | n/a         | `start` captured server-side        |
| open   | POST clock-out / PUT `end` | closed | via edit    | `end` captured; counts on timesheet |

### Shift [INFERRED — from `type`: regular / open / draft]

```
[draft] ──publish──> [published / regular]
(open = unassigned slot awaiting an assignee)
```

| From  | Action / Trigger | To        | Reversible? | Side Effects                      |
| ----- | ---------------- | --------- | ----------- | --------------------------------- |
| draft | publish          | published | yes (edit)  | Becomes visible to assigned users |
| open  | assign           | regular   | yes         | `assignees` populated             |

---

## Business Rules

- **Enterprise-only:** the public API is unavailable below the Enterprise plan. [DOCUMENTED]
- **Phone-led identity:** users are keyed on E.164 phone numbers; create generally requires a valid `phoneNumber`. [INFERRED]
- **Batch caps:** users batch ≤ 25; shift create ≤ 500; bulk shift delete ≤ 20. [DOCUMENTED]
- **Time-activity window:** queries limited to 92 days. [DOCUMENTED]
- **Immutable OAuth scopes:** cannot change scopes post-app-creation — create a new app instead. [DOCUMENTED]
- **Unsupported scheduler features:** data layers / shift tasks / repeating / group shifts. [DOCUMENTED]
- **Data residency:** AU tenants must call `api-au.connecteam.com`. [DOCUMENTED]
- **Manager fields are the only writable part of a submission;** answer entries are immutable. [DOCUMENTED]

---

## Field Format Reference

| Format    | Pattern                | Example          | Notes                                                                                      |
| --------- | ---------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| Timestamp | Unix epoch **seconds** | `1716969600`     | ALL `start`/`end`/`startTime`/`endTime`/`createdAt`/`modifiedAt`/`*Timestamp` [DOCUMENTED] |
| Date      | `YYYY-MM-DD`           | `"2026-05-29"`   | Date-only fields (e.g. timesheet ranges) [DOCUMENTED]                                      |
| Phone     | E.164                  | `"+14155550101"` | Login identity [INFERRED]                                                                  |
| ID        | integer                | `4815162`        | Numeric IDs across modules [INFERRED]                                                      |
| Boolean   | boolean                | `true` / `false` | e.g. `sendActivation` [DOCUMENTED]                                                         |

> **Watch-out:** Connecteam uses **Unix seconds**, not milliseconds and not ISO-8601, for activity/shift
> times. Mixing these up is the single most likely integration bug. [DOCUMENTED]

---

## Enum Value Reference

| Entity        | Field      | Allowed Values                                                | Default   | Notes                                     |
| ------------- | ---------- | ------------------------------------------------------------- | --------- | ----------------------------------------- |
| Time Activity | type       | `shift`, `break`, `timeoff`                                   | [UNKNOWN] | [DOCUMENTED]                              |
| Shift         | type       | `regular`, `open`, `draft`, `group`                           | [UNKNOWN] | `group` is NOT API-supported [DOCUMENTED] |
| Users list    | userStatus | `active`, `archived`, `all`                                   | `active`  | query filter [DOCUMENTED]                 |
| Users list    | order      | `asc`, `desc`                                                 | `asc`     | [DOCUMENTED]                              |
| Users list    | sort       | `created_at`                                                  | [UNKNOWN] | only documented sort key [DOCUMENTED]     |
| Webhook       | feature    | `users`, `time_activity`, `shift_scheduler`, `forms`, `tasks` | —         | [DOCUMENTED]                              |

> Most enum values come from the docs; defaults are mostly [UNKNOWN] without live calls.

---

_Generated from the investigation questionnaire, Phase 3. Shared verbatim with the `connecteam-api` connector._
