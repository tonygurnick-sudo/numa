---
api_name: Connecteam (API Key)
api_slug: connecteam-api
base_url: https://api.connecteam.com
call_surface: HTTP via `numa integrations request`
auth: X-API-KEY header
field_casing: camelCase
companions: 01=api-rules, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
shared_api: domain model identical to connecteam-oauth — only auth header differs; keep in sync
confidence: paths/CRUD/batch-caps [DOCUMENTED] from reference+overview pages; some field types/slugs [INFERRED] (per-endpoint schemas sit behind the portal "Try It" widget); NO live call made — treat field tables as strong starting point, not gospel. Non-default markers tagged inline.
source: developer.connecteam.com reference + llms.txt; Time Clock/Scheduler/Forms/Jobs overview docs; help.connecteam.com
---

# Connecteam (API Key) — Domain Model Reference

Entity catalog, relationships, state machines, business rules. Companion to `01-llm-api-rules.md`.

## ⚠️ Mixed ID Types (read first)

Never coerce — pass ids back exactly as received.

| Entity                                                 | ID type                | Example                                  |
| ------------------------------------------------------ | ---------------------- | ---------------------------------------- |
| User, Time Clock, Scheduler, Smart Group, Custom Field | **integer**            | `7031021`                                |
| Job (and sub-jobs)                                     | **UUID string**        | `"9fdebf1f-0c69-4914-89d2-8f86c3e5f47d"` |
| Scheduler Shift                                        | **24-char hex string** | `"6784dacb3c07733b0a849f49"`             |

## Entity Catalog

### User (Employee)

Paths: `/users/v1/users`, `/users/v1/users/{userId}`. Team member (owner/admin/manager/user); phone-led identity (E.164).
CRUD: Create (POST, batch ≤25), Read (list + by id), Update (PUT), Archive (`DELETE /users/v1/users`), Delete (`DELETE /users/v1/users/{userId}`). Also: promote to admin, notes, payslips, assignments, performance.

| Field          | Type              | Required     | Writable | Description                      | Example              |
| -------------- | ----------------- | ------------ | -------- | -------------------------------- | -------------------- |
| userId         | integer           | —            | no       | Unique id                        | `7031021`            |
| firstName      | string            | yes (create) | yes      | Given name                       | `"Omer"`             |
| lastName       | string            | yes (create) | yes      | Family name                      | `"Vered"`            |
| phoneNumber    | string (E.164)    | yes (create) | yes      | Login identity                   | `"+9720548888888"`   |
| email          | string            | no           | yes      | Email                            | `"user@example.com"` |
| userType       | enum              | no           | no       | `owner`/`admin`/`manager`/`user` | `"owner"`            |
| isArchived     | boolean           | —            | no       | Archived state                   | `false`              |
| smartGroupsIds | array<int>        | no           | yes      | Smart-group memberships          | `[2359154,2359155]`  |
| customFields   | array<object>     | no           | yes      | Custom field values              | see below            |
| createdAt      | integer (epoch s) | —            | no       | Creation ts                      | `1712573537`         |
| modifiedAt     | integer (epoch s) | —            | no       | Last-modified ts                 | `1723640035`         |
| lastLogin      | integer (epoch s) | —            | no       | Last login                       | `1723640035`         |

Custom field shape: `{"customFieldId":6208755,"name":"Title","type":"str","value":"Solution Engineer"}`

### Time Clock

Path: `/time_clock/v1/time_clocks`. A configured time-tracking instrument; container for time activities, geofences, breaks, timesheet totals. Ids are **integers**.
CRUD: Read (list). Sub-resources: time_activities (R/W), geofences (CRUD), manual_breaks (R), shift_attachments (R), timesheet (R), lock_days (W).

| Field      | Type    | Writable | Description    | Example                    |
| ---------- | ------- | -------- | -------------- | -------------------------- |
| id         | integer | no       | Time-clock id  | `12345`                    |
| name       | string  | no       | Display name   | `"Main Office Time Clock"` |
| isArchived | boolean | no       | Archived state | `false`                    |

> Archived time clocks **ARE** returned by the list endpoint. Historical data readable, but new entries cannot be created against an archived clock.

### Time Activity (Shift / Manual Break / Time-off)

Path: `/time_clock/v1/time_clocks/{timeClockId}/time_activities`. A recorded work segment, manual break, or time-off block tied to a user on a clock. Three categories via `activityTypes`: **shift**, **manual_break**, **time_off**. Items grouped per user under a `shifts[]` array.
CRUD: Read (GET), Create (POST), Update (PUT). No delete via API documented. Real-time `clock_in`/`clock_out` are separate POSTs.

| Field          | Type              | Required | Writable     | Description                          | Example          |
| -------------- | ----------------- | -------- | ------------ | ------------------------------------ | ---------------- |
| id             | string            | —        | no           | Activity/shift id                    | `"shift-abc123"` |
| userId         | integer           | yes      | yes (create) | Employee                             | `9170357`        |
| start          | object            | yes      | yes          | `{timestamp,timezone,locationData?}` | see below        |
| end            | object            | yes      | yes          | `{timestamp,timezone,locationData?}` | see below        |
| jobId          | string (UUID)     | no       | yes          | Associated job                       | `"job-123"`      |
| subJobId       | string            | no       | yes          | Associated sub-job                   | `"subjob-456"`   |
| employeeNote   | string            | no       | yes          | Employee note                        | `"Imported"`     |
| managerNote    | string            | no       | yes          | Manager note                         | `""`             |
| isAutoClockOut | boolean           | no       | no           | Was auto-clocked-out                 | `false`          |
| createdAt      | integer (epoch s) | —        | no           | Creation ts                          | `1704110400`     |

start/end object: `{"timestamp":1704110400,"timezone":"America/New_York","locationData":{…}}` — `timestamp` is **Unix epoch seconds**.
Range constraint: queries limited to a **92-day** window via `startDate`/`endDate` (`YYYY-MM-DD`).

### Timesheet

Path: `/time_clock/v1/time_clocks/{timeClockId}/timesheet`. Aggregated payroll summary (total hours, breaks) over a date range. Read (GET) only.

### Scheduler

Path: `/scheduler/v1/schedulers`. A schedule board that owns shifts. Ids are **integers**. **Two API versions concurrent — V1 and V2** (V2 newer; default to V2 for new work [INFERRED migration default], keep V1 available).
CRUD: Read (list). Sub-resources: shift_layers, custom_fields, unavailabilities, shifts, shifts_auto_assign.

| Field | Type    | Writable | Description    | Example      |
| ----- | ------- | -------- | -------------- | ------------ |
| id    | integer | no       | Scheduler id   | `6833518`    |
| name  | string  | no       | Scheduler name | `"Auckland"` |

### Shift

Path: `/scheduler/{v1|v2}/schedulers/{schedulerId}/shifts[/{shiftId}]`. A scheduled work slot. Ids are **hex strings** in both V1 and V2.
CRUD: Read (list + by id), Create (POST, batch ≤500), Update (PUT bulk), Delete (bulk ≤20, or single).

| Field           | Type              | Required | Writable | Description            | Example                                  |
| --------------- | ----------------- | -------- | -------- | ---------------------- | ---------------------------------------- |
| id              | string (hex)      | —        | no       | Shift id               | `"6784dacb3c07733b0a849f49"`             |
| title           | string            | no       | yes      | Shift name             | `"Morning Shift"`                        |
| assignedUserIds | array<int>        | no       | yes      | Assigned employee ids  | `[9170357]`                              |
| startTime       | integer (epoch s) | yes      | yes      | Shift start            | `1736924400`                             |
| endTime         | integer (epoch s) | yes      | yes      | Shift end              | `1736953200`                             |
| jobId           | string (UUID)     | no       | yes      | Associated job         | `"d4ad7232-576f-2ff6-c57d-8240f1089b00"` |
| isPublished     | boolean           | —        | yes      | Visible to employees   | `true`                                   |
| isOpenShift     | boolean           | —        | yes      | Claimable / unassigned | `false`                                  |
| color           | string (#RRGGBB)  | no       | yes      | Hex colour             | `"#4B7AC5"`                              |

> **Unsupported via API:** data layers, shift tasks, repeating shifts, group shifts. Do not attempt to create/edit these.

### User Unavailability

Per-user availability windows, used by the scheduler when assigning shifts.

- `GET /scheduler/{v1|v2}/schedulers/user_unavailability` — combined view (unavailabilities + approved time-off + assigned shifts)
- `POST /scheduler/v1/schedulers/{schedulerId}/unavailability` — add
- `DELETE /scheduler/v1/schedulers/{schedulerId}/unavailability/{unavailabilityId}` — remove

### Job (resource / cost-code)

Paths: `/jobs/v1/jobs`, `/jobs/v1/jobs/{jobId}`. A job/task/cost-code that time activities and shifts attribute to. Sub-jobs via `parentId` hierarchy. **Job ids are UUID strings.**
CRUD: Create, Read, Update, Delete (soft, via `isDeleted`). Also `/jobs/v1/custom_fields`.

| Field        | Type          | Required     | Writable | Description                        | Example                                  |
| ------------ | ------------- | ------------ | -------- | ---------------------------------- | ---------------------------------------- |
| jobId        | string (UUID) | —            | no       | Unique id                          | `"9fdebf1f-0c69-4914-89d2-8f86c3e5f47d"` |
| title        | string        | yes (create) | yes      | Job name                           | `"Delivery Driver"`                      |
| code         | string        | no           | yes      | Job code                           | `"DD-001"`                               |
| color        | string        | no           | yes      | Hex colour                         | `"#3968BB"`                              |
| description  | string        | no           | yes      | Description                        | `"Delivery operations"`                  |
| gps          | object        | no           | yes      | `{address,longitude,latitude}`     | see below                                |
| isDeleted    | boolean       | —            | no       | Soft-deleted state                 | `false`                                  |
| assign       | object        | no           | yes      | `{type,userIds[],groupIds[]}`      | `{"type":"both","userIds":[7031021]}`    |
| instanceIds  | array<int>    | no           | yes      | Scheduler/time-clock ids job is on | `[6833518]`                              |
| parentId     | string (UUID) | no           | yes      | Parent job (sub-jobs)              | —                                        |
| subJobs      | array         | no           | no       | Child jobs                         | —                                        |
| customFields | array         | no           | yes      | Resource custom fields             | `[]`                                     |

gps object: `{"address":"123 Main St","longitude":-73.93,"latitude":40.71}`

### Form

Paths: `/forms/v1/forms` (list), `/forms/v1/forms/{formId}` (get). A form template. **Forms API Enterprise-plan only.** Read only.

| Field      | Type    | Writable | Description | Example           |
| ---------- | ------- | -------- | ----------- | ----------------- |
| formId     | integer | no       | Form id     | `555`             |
| name       | string  | no       | Form title  | `"Vehicle check"` |
| isArchived | boolean | no       | Archived    | `false`           |

### Form Submission

Paths: `/forms/v1/forms/{formId}/form_submissions` (list), `.../{formSubmissionId}` (get + manager-field update). Dropdown question options have full CRUD under `.../questions/{questionId}`. A user's completed submission; **manager fields** updatable, answer entries read-only. Read (list + single) + Update (manager fields only).

| Field             | Type              | Writable | Description                                 |
| ----------------- | ----------------- | -------- | ------------------------------------------- |
| formSubmissionId  | integer/string    | no       | Unique submission id                        |
| formId            | integer           | no       | Parent form                                 |
| userId            | integer           | no       | Submitting user                             |
| submissionTime    | integer (epoch s) | no       | Submission ts                               |
| answers/questions | array<object>     | no       | Question/answer pairs                       |
| status            | string            | no       | Submission status                           |
| managerFields     | object            | partial  | `person`/`status`/`note`/`date` (updatable) |

> [INFERRED] full submission response schema not exposed on the reference page; verify against a live call.

### Webhook Subscription

Path: `/settings/v1/webhooks`. A registered HTTPS endpoint receiving event callbacks for a feature. Create (POST); list/get/update/delete also exist.

| Field       | Type           | Required    | Writable | Description                                               |
| ----------- | -------------- | ----------- | -------- | --------------------------------------------------------- |
| name        | string         | yes         | yes      | Subscription label                                        |
| url         | string (HTTPS) | yes         | yes      | Delivery endpoint                                         |
| featureType | enum           | yes         | yes      | `users`/`forms`/`time_activity`/`shift_scheduler`/`tasks` |
| eventTypes  | array<string>  | yes         | yes      | Event names within the feature                            |
| objectId    | integer        | conditional | yes      | Required for all featureTypes **except `users`**          |
| secretKey   | string         | no          | yes      | Signature-verification secret                             |
| isDisabled  | boolean        | no          | yes      | Pause delivery                                            |
| retryLimit  | integer        | —           | no       | Fixed at 3                                                |

### Other Entities (catalogued, not deep-dived)

From `/llms.txt` (~110 endpoints). Paths [DOCUMENTED]; fields not documented.

- **Smart Groups / Segments** — `/users/v1/smart_groups`, `/users/v1/smart_group_segments`
- **Custom Fields (users)** — `/users/v1/custom_fields` (+categories, options) — full CRUD
- **Tasks / Task Boards / Sub-tasks / Labels** — `/tasks/v1/taskboards/...` — CRUD
- **Time Off** — policy types, balances, assignments, requests (`/time_off/v1/...`)
- **Pay Rates** — `/pay_rates/v1/pay_rates` (R/W/Delete)
- **Company / Pay Rule Policies** — `/company_policies/v1/...`
- **Sales Data** — locations, transactions, daily sales (`/sales/v1/...`)
- **Onboarding** — packs + assignments (`/onboarding/v1/...`)
- **Chat / Messaging / Publishers** — `/chat/v1/...`, `/publishers/v1/...`
- **Assets** — `/assets/v1/asset/{assetId}` (R)
- **Attachments / Files** — two-step pre-signed flow (`/attachments/v1/files/...`)
- **Webhooks / Settings** — `/settings/v1/webhooks` — CRUD

## Entity Relationship Diagram

```
┌──────────┐   N:M (assign)   ┌──────────┐
│   User   │<────────────────>│   Job    │ (UUID id; sub-jobs via parentId)
└──────────┘                  └──────────┘
     │  1:N                         ▲
     │                              │ jobId on activities/shifts
     ▼                              │
┌──────────────┐   on     ┌──────────────┐        ┌──────────────┐
│ TimeActivity │─────────>│  TimeClock   │        │  Scheduler   │
│ (shift/break)│  clock   │ (integer id) │        │ (integer id) │
└──────────────┘          └──────────────┘        └──────────────┘
     │ userId                                            │ 1:N
     ▼                                                   ▼
┌──────────┐        ┌──────────────┐            ┌──────────────┐
│   User   │        │ SmartGroup   │<──members──│    Shift     │ (hex string id)
└──────────┘        └──────────────┘            └──────────────┘

┌──────────┐  1:N  ┌──────────────────┐
│   Form   │──────>│ FormSubmission   │──userId──> User
└──────────┘       └──────────────────┘
```

[INFERRED — relationships deduced from path nesting + field names; no published ERD.]

## State Machines

### Time Activity / Real-time clocking [DOCUMENTED endpoints; INFERRED transitions]

```
[clocked_out] --POST clock_in--> [clocked_in] --POST clock_out--> [clocked_out]
                                       └── auto clock-out (server rule) --> [clocked_out] (isAutoClockOut=true)
```

| From        | Action                       | To          | Reversible? | Side Effects                          |
| ----------- | ---------------------------- | ----------- | ----------- | ------------------------------------- |
| clocked_out | POST `.../clock_in`          | clocked_in  | yes         | Opens an active time activity         |
| clocked_in  | POST `.../clock_out`         | clocked_out | yes         | Closes the activity; records duration |
| clocked_in  | auto clock-out (server rule) | clocked_out | no          | `isAutoClockOut: true`                |

### Shift [INFERRED from field semantics]

```
[unpublished] --publish (isPublished=true)--> [published]
[assigned] <--> [open] (isOpenShift toggles; open shifts are claimable)
```

| State       | Update? | Delete? | Notes                                       |
| ----------- | ------- | ------- | ------------------------------------------- |
| unpublished | yes     | yes     | `isPublished:false` — not visible to staff  |
| published   | yes     | yes     | Visible to assigned employees               |
| open        | yes     | yes     | `isOpenShift:true` — unassigned / claimable |

## Business Rules

- **Plan gating:** API needs **Expert+**; **Forms API Enterprise-only**. A valid key on a lower tier is rejected/limited.
- **Owner-only keys:** only account owners can create/manage API keys.
- **Keys never expire:** static account-level secret (contrast OAuth's 24h token).
- **Phone-led identity:** users keyed on E.164 phone; create generally requires a valid `phoneNumber` [INFERRED].
- **Time-activity window:** queries capped at **92 days**.
- **Schedule shifts require a window:** GET shifts needs `startTime`+`endTime`; **overlapping** shifts returned.
- **Batch caps:** users ≤25; shift create ≤500; bulk shift delete ≤20.
- **Unsupported scheduler features:** data layers / shift tasks / repeating / group shifts.
- **Manager fields the only writable part of a submission;** answer entries immutable.
- **Forward-compatible schemas:** new response fields may appear — parse leniently, don't fail on unknown fields.
- **Archived/deleted visibility:** archived time clocks listed; jobs use `isDeleted` soft-delete with an `includeDeleted` filter.
- **Mixed id types:** never coerce (int users/clocks/schedulers; UUID jobs; hex shifts).

## Field Format Reference

| Format        | Pattern                | Example                    | Notes                                         |
| ------------- | ---------------------- | -------------------------- | --------------------------------------------- |
| Timestamp     | Unix epoch **seconds** | `1712573537`               | Almost all time fields + rate-limit resets    |
| Date filter   | `YYYY-MM-DD`           | `2025-01-15`               | time_activities `startDate`/`endDate`         |
| Integer ID    | integer                | `7031021`                  | users, time clocks, schedulers, custom fields |
| UUID ID       | RFC4122 string         | `9fdebf1f-0c69-4914-…`     | jobs                                          |
| Hex/string ID | 24-char hex string     | `6784dacb3c07733b0a849f49` | scheduler shifts                              |
| Phone         | E.164                  | `+9720548888888`           | user login identity                           |
| Colour        | `#RRGGBB`              | `#4B7AC5`                  | shifts, jobs                                  |
| Timezone      | IANA tz name           | `"America/New_York"`       | start/end objects                             |

> **#1 integration bug:** Connecteam uses **Unix seconds**, not ms and not ISO-8601, for activity/shift times.

## Enum Value Reference

| Entity        | Field         | Allowed Values                                                | Default  | Notes                                   |
| ------------- | ------------- | ------------------------------------------------------------- | -------- | --------------------------------------- |
| User          | userType      | `owner`, `admin`, `manager`, `user`                           | —        | `owner` seen in docs; others [INFERRED] |
| Users list    | userStatus    | `active`, `archived`, (likely `all`)                          | `active` | query filter                            |
| Users list    | order         | `asc`, `desc`                                                 | `asc`    |                                         |
| Users list    | sort          | `created_at`                                                  | —        | only documented sort key                |
| Time Activity | activityTypes | `shift`, `manual_break`, `time_off`                           | —        |                                         |
| Job           | assign.type   | `both`, `users`, `groups`                                     | —        | `both` seen; rest [INFERRED]            |
| Webhook       | featureType   | `users`, `forms`, `time_activity`, `shift_scheduler`, `tasks` | —        |                                         |
