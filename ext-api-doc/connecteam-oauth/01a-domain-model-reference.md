---
api_name: Connecteam API (OAuth)
api_slug: connecteam-oauth
base_url: https://api.connecteam.com
path_version_segment: per-module (/users/v1, /time-clock/v1, …); NO global /v1
field_casing: camelCase
id_format: integer
timestamps: Unix epoch SECONDS
call_surface: HTTP via `numa integrations request`
confidence: paths/CRUD/caps [DOCUMENTED]; field types/slugs [INFERRED] (per-endpoint schemas sit behind the portal "Try It" widget; no live calls). Treat field tables as a strong starting point.
shared_api: identical to connecteam-api (API-key); only auth differs
companion_to: 01-llm-api-rules.md
---

# Connecteam (OAuth) — Domain Model Reference

Entity catalog, relationships, state machines, business rules.

## Entity Catalog

### User (Employee)

Path `/users/v1/users`. Phone-led team member (user/manager/admin). CRUD: Create (POST, batch ≤25), Read (list + by id), Update (PUT), Archive/Unarchive, Delete.

| Field        | Type              | Required     | Writable | Description              | Example                  |
| ------------ | ----------------- | ------------ | -------- | ------------------------ | ------------------------ |
| userId       | integer           | —            | no       | Unique id                | `4815162`                |
| firstName    | string            | yes (create) | yes      | Given name               | `"Jane"`                 |
| lastName     | string            | yes (create) | yes      | Family name              | `"Doe"`                  |
| phoneNumber  | string (E.164)    | yes (create) | yes      | Login identity           | `"+14155550101"`         |
| email        | string            | no           | yes      | Email                    | `"jane@acme.com"`        |
| userType     | enum              | no           | yes      | `user`/`manager`/`admin` | `"user"`                 |
| userStatus   | enum              | no           | no       | `active`/`archived`      | `"active"`               |
| customFields | array<object>     | no           | yes      | Tenant-defined           | `[{"id":1,"value":"…"}]` |
| createdAt    | integer (epoch s) | —            | no       | Creation ts              | `1716950400`             |
| modifiedAt   | integer (epoch s) | —            | no       | Last-modified ts         | `1716950400`             |

### Time Clock

Path `/time-clock/v1/time-clocks`. Container for time activities; holds no records itself. CRUD: Read (list).

| Field       | Type    | Writable | Description | Example        |
| ----------- | ------- | -------- | ----------- | -------------- |
| timeClockId | integer | no       | Unique id   | `12345`        |
| name        | string  | no       | Name        | `"Field crew"` |

### Time Activity (Shift / Break / Time-off)

Path `/time-clock/v1/time-clocks/{timeClockId}/time-activities`. Work record under a clock: **shift** (clock-in/out work period), **break** (manual, paid/unpaid), **timeoff** (approved PTO on timesheet). CRUD: Read (GET), Create (POST), Update (PUT); real-time `clock-in`/`clock-out` are separate POSTs. **Query window capped at 92 days.**

| Field       | Type              | Required   | Writable | Description               | Example      |
| ----------- | ----------------- | ---------- | -------- | ------------------------- | ------------ |
| timeClockId | integer           | yes (path) | no       | Parent clock              | `12345`      |
| userId      | integer           | yes        | yes      | Employee                  | `4815162`    |
| start       | integer (epoch s) | yes        | yes      | Start                     | `1716969600` |
| end         | integer (epoch s) | no         | yes      | End; absent if open       | `1716998400` |
| type        | enum              | yes        | yes      | `shift`/`break`/`timeoff` | `"shift"`    |

### Timesheet

Path `/time-clock/v1/time-clocks/{timeClockId}/timesheet`. Aggregated payroll summary over a date range (total hours, breaks). CRUD: Read (GET).

### Scheduler

Path `/scheduler/v1/schedulers`. Schedule board that owns shifts. CRUD: Read (list).

| Field       | Type    | Writable | Description | Example      |
| ----------- | ------- | -------- | ----------- | ------------ |
| schedulerId | integer | no       | Unique id   | `321`        |
| name        | string  | no       | Name        | `"Auckland"` |

### Shift

Path `/scheduler/v1/schedulers/{schedulerId}/shifts`. Scheduled work slot. CRUD: Read (list + by id), Create (POST ≤500), Update (PUT bulk), Delete (bulk ≤20, or single).

| Field        | Type              | Required   | Writable | Description                         | Example       |
| ------------ | ----------------- | ---------- | -------- | ----------------------------------- | ------------- |
| shiftId      | integer/string    | —          | no       | Unique id                           | `987654`      |
| schedulerId  | integer           | yes (path) | no       | Parent scheduler                    | `321`         |
| type         | enum              | no         | yes      | `regular`/`open`/`draft`/`group`    | `"regular"`   |
| assignees    | array<integer>    | no         | yes      | userIds assigned                    | `[4815162]`   |
| startTime    | integer (epoch s) | yes        | yes      | Start                               | `1716969600`  |
| endTime      | integer (epoch s) | yes        | yes      | End                                 | `1716998400`  |
| status       | enum              | no         | yes      | `published`/`draft` (derived)       | `"published"` |
| shiftLayers  | array/object      | no         | yes      | Layer values (jobs/locations/notes) | `[…]`         |
| customFields | array/object      | no         | yes      | Tenant-defined                      | `[…]`         |

**Unsupported scheduler features (NOT writable via API):** data layers, shift tasks, repeating shifts, group shifts (`type: group`). Do not attempt to create/edit these.

### User Unavailability

- `GET /scheduler/v1/schedulers/user-unavailability` — combined view (unavailabilities + approved time-off + assigned shifts)
- `POST /scheduler/v1/schedulers/{schedulerId}/unavailability` — add
- `DELETE /scheduler/v1/schedulers/{schedulerId}/unavailability/{unavailabilityId}` — remove

Per-user availability windows used when assigning shifts.

### Form

Paths `/forms/v1/forms` (list), `/forms/v1/forms/{formId}` (get). Form template. CRUD: Read.

| Field  | Type    | Writable | Description | Example           |
| ------ | ------- | -------- | ----------- | ----------------- |
| formId | integer | no       | Unique id   | `555`             |
| name   | string  | no       | Title       | `"Vehicle check"` |

### Form Submission

Paths `/forms/v1/forms/{formId}/form-submissions` (list); get-single + manager-field update also documented. A completed submission. **Manager fields** (person/status/note/date) are updatable; answer entries are read-only. CRUD: Read (list + single), Update (manager fields only).

| Field         | Type              | Writable | Description                                 |
| ------------- | ----------------- | -------- | ------------------------------------------- |
| submissionId  | integer/string    | no       | Unique id                                   |
| formId        | integer           | no       | Parent form                                 |
| userId        | integer           | no       | Submitting user                             |
| submittedAt   | integer (epoch s) | no       | Submission ts                               |
| entries       | array<object>     | no       | Question/answer pairs                       |
| managerFields | object            | partial  | `person`/`status`/`note`/`date` (updatable) |

> Submission response schema [INFERRED]. **Attachments / PDF export:** referenced in the dev forum, retrieval pattern undocumented [INFERRED — discovery needed].

### Job (Job Scheduler / Sub-jobs)

Path `/jobs/v1/...` (sub-jobs at `/docs/sub-jobs`) [module DOCUMENTED; exact paths INFERRED]. Jobs/sub-jobs to tag/categorise time activities and shifts. CRUD: Create + manage, with sub-job support.

### Attachment

Path `/attachments/v1/...` [INFERRED — module exists; `attachments.write` scope in the registry]. Uploaded files referenced by other resources (e.g. form submissions). CRUD: Upload (write) [scope DOCUMENTED; paths INFERRED].

### Webhook Subscription

Path `/settings/v1/webhooks`. Registered HTTPS endpoint receiving event callbacks for a feature. CRUD: Create (POST) [DOCUMENTED]; list/delete [INFERRED].

| Field      | Type           | Required | Description                                               |
| ---------- | -------------- | -------- | --------------------------------------------------------- |
| name       | string         | yes      | Subscription label                                        |
| url        | string (HTTPS) | yes      | Delivery endpoint                                         |
| feature    | enum           | yes      | `users`/`time_activity`/`shift_scheduler`/`forms`/`tasks` |
| events     | array<string>  | yes      | Event names within the feature                            |
| secretKey  | string         | no       | Signature-verification secret                             |
| retryLimit | integer        | no       | Delivery retry count (3)                                  |

## Entity Relationships

[INFERRED from path nesting + field names; no published ERD]

- User 1:N Shift (via `assignees` array); Shift N:1 Scheduler.
- Time Activity N:1 Time Clock (path); Time Activity N:1 User (`userId`); Time Clock aggregated by Timesheet.
- User submits Form Submission; Form Submission of Form.
- Job (+sub-jobs) tags/referenced by Shifts and Time Activities (via `shiftLayers`).

## State Machines [INFERRED]

**Time Activity (Shift):** create-with-start-only / clock-in → `open`; clock-out / PUT `end` → `closed`.
| From | Action | To | Reversible? | Side effects |
| --- | --- | --- | --- | --- |
| (none) | POST clock-in / create | open | n/a | `start` captured server-side |
| open | POST clock-out / PUT `end` | closed | via edit | `end` captured; counts on timesheet |

**Shift:** `draft` → publish → `published/regular`; `open` = unassigned slot awaiting an assignee.
| From | Action | To | Reversible? | Side effects |
| --- | --- | --- | --- | --- |
| draft | publish | published | yes (edit) | visible to assigned users |
| open | assign | regular | yes | `assignees` populated |

## Business Rules

- **Enterprise-only:** public API unavailable below Enterprise.
- **Phone-led identity:** users keyed on E.164 phone; create generally requires a valid `phoneNumber` [INFERRED].
- **Batch caps:** users ≤25; shift create ≤500; bulk shift delete ≤20.
- **Time-activity window:** queries ≤92 days.
- **Immutable OAuth scopes:** change = create a new app.
- **Unsupported scheduler features:** data layers / shift tasks / repeating / group shifts.
- **Data residency:** AU tenants must call `api-au.connecteam.com`.
- **Manager fields are the only writable part of a submission;** answer entries are immutable.

## Field Format Reference

| Format    | Pattern                | Example          | Notes                                                                         |
| --------- | ---------------------- | ---------------- | ----------------------------------------------------------------------------- |
| Timestamp | Unix epoch **seconds** | `1716969600`     | ALL `start`/`end`/`startTime`/`endTime`/`createdAt`/`modifiedAt`/`*Timestamp` |
| Date      | `YYYY-MM-DD`           | `"2026-05-29"`   | Date-only fields (e.g. timesheet ranges)                                      |
| Phone     | E.164                  | `"+14155550101"` | Login identity [INFERRED]                                                     |
| ID        | integer                | `4815162`        | Numeric IDs across modules [INFERRED]                                         |
| Boolean   | boolean                | `true`/`false`   | e.g. `sendActivation`                                                         |

> **#1 integration bug:** Unix **seconds**, not milliseconds, not ISO-8601, for all activity/shift times.

## Enum Value Reference

| Entity        | Field      | Allowed Values                                                | Default   | Notes                     |
| ------------- | ---------- | ------------------------------------------------------------- | --------- | ------------------------- |
| Time Activity | type       | `shift`, `break`, `timeoff`                                   | [UNKNOWN] | —                         |
| Shift         | type       | `regular`, `open`, `draft`, `group`                           | [UNKNOWN] | `group` NOT API-supported |
| Users list    | userStatus | `active`, `archived`, `all`                                   | `active`  | query filter              |
| Users list    | order      | `asc`, `desc`                                                 | `asc`     | —                         |
| Users list    | sort       | `created_at`                                                  | [UNKNOWN] | only documented sort key  |
| Webhook       | feature    | `users`, `time_activity`, `shift_scheduler`, `forms`, `tasks` | —         | —                         |

> Defaults are mostly [UNKNOWN] without live calls.
