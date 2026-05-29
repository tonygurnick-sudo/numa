---
api_name: 'Connecteam (API Key)'
api_slug: 'connecteam-api'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior']
data_sources:
  [
    'developer.connecteam.com reference + llms.txt',
    'Time Clock / Scheduler / Forms / Jobs overview docs',
    'help.connecteam.com API articles',
  ]
---

# Connecteam (API Key) -- Domain Model Reference

> Companion to `01-llm-api-rules.md`. Full entity catalog, relationships, state machines, and
> business rules the workspace agent references when working with Connecteam data.
>
> **Shared API:** Identical to the `connecteam-oauth` connector — **only auth differs** (this connector
> sends `X-API-KEY`; OAuth sends a bearer token). Every entity, field, relationship, and rule below is
> the same for both. Keep them in sync.
>
> **Confidence:** field schemas are largely **[DOCUMENTED]** from the reference + overview pages, but a
> few exact slugs/types are **[INFERRED]** because per-endpoint response schemas sit behind the portal's
> interactive "Try It" widget. No live calls were possible — treat the field tables as a strong starting
> point, not gospel.

---

## ⚠️ Mixed ID Types (read first)

Connecteam does **not** use one id format. Never coerce — pass ids back exactly as received. [DOCUMENTED]

| Entity                                                 | ID type                | Example                                  |
| ------------------------------------------------------ | ---------------------- | ---------------------------------------- |
| User, Time Clock, Scheduler, Smart Group, Custom Field | **integer**            | `7031021`                                |
| Job (and sub-jobs)                                     | **UUID string**        | `"9fdebf1f-0c69-4914-89d2-8f86c3e5f47d"` |
| Scheduler Shift                                        | **24-char hex string** | `"6784dacb3c07733b0a849f49"`             |

---

## Entity Catalog

### User (Employee)

**Resource path:** `/users/v1/users`, `/users/v1/users/{userId}` [DOCUMENTED]
**Description:** A Connecteam team member (owner / admin / manager / user). Identity is phone-led (E.164).
**CRUD:** Create (POST, batch ≤ 25), Read (list + by id), Update (PUT), Archive (`DELETE /users/v1/users`), Delete (`DELETE /users/v1/users/{userId}`). Also: promote to admin, notes, payslips, assignments, performance. [DOCUMENTED]

| Field          | Type              | Required     | Writable | Description                            | Example              |
| -------------- | ----------------- | ------------ | -------- | -------------------------------------- | -------------------- |
| userId         | integer           | —            | no       | Unique identifier                      | `7031021`            |
| firstName      | string            | yes (create) | yes      | Given name                             | `"Omer"`             |
| lastName       | string            | yes (create) | yes      | Family name                            | `"Vered"`            |
| phoneNumber    | string (E.164)    | yes (create) | yes      | Login identity                         | `"+9720548888888"`   |
| email          | string            | no           | yes      | Email address                          | `"user@example.com"` |
| userType       | enum              | no           | no       | `owner` / `admin` / `manager` / `user` | `"owner"`            |
| isArchived     | boolean           | —            | no       | Archived state                         | `false`              |
| smartGroupsIds | array<int>        | no           | yes      | Smart-group memberships                | `[2359154, 2359155]` |
| customFields   | array<object>     | no           | yes      | Custom field values                    | see below            |
| createdAt      | integer (epoch s) | —            | no       | Creation timestamp                     | `1712573537`         |
| modifiedAt     | integer (epoch s) | —            | no       | Last-modified timestamp                | `1723640035`         |
| lastLogin      | integer (epoch s) | —            | no       | Last login                             | `1723640035`         |

**Custom field shape:** `{ "customFieldId": 6208755, "name": "Title", "type": "str", "value": "Solution Engineer" }` [DOCUMENTED]

> **Confidence:** path/CRUD/batch-cap [DOCUMENTED]; some field types [INFERRED] where the schema is not shown.

---

### Time Clock

**Resource path:** `/time_clock/v1/time_clocks` [DOCUMENTED]
**Description:** A configured time-tracking instrument employees punch into. Container for time activities, geofences, breaks, timesheet totals.
**CRUD:** Read (list). Sub-resources: time_activities (R/W), geofences (CRUD), manual_breaks (R), shift_attachments (R), timesheet (R), lock_days (W). [DOCUMENTED]

| Field      | Type    | Required | Writable | Description    | Example                    |
| ---------- | ------- | -------- | -------- | -------------- | -------------------------- |
| id         | integer | —        | no       | Time-clock id  | `12345`                    |
| name       | string  | —        | no       | Display name   | `"Main Office Time Clock"` |
| isArchived | boolean | —        | no       | Archived state | `false`                    |

> **NOTE:** Archived time clocks **ARE** returned by the list endpoint. Historical data is readable, but new entries cannot be created against an archived clock. [DOCUMENTED]

---

### Time Activity (Shift / Manual Break / Time-off)

**Resource path:** `/time_clock/v1/time_clocks/{timeClockId}/time_activities` [DOCUMENTED]
**Description:** A recorded work segment, manual break, or time-off block tied to a user on a given clock.
Three categories via `activityTypes`: **shift**, **manual_break**, **time_off**.
**CRUD:** Read (GET), Create (POST), Update (PUT). No delete via API documented. Real-time `clock_in`/`clock_out` are separate POSTs. [DOCUMENTED]

**Activity items are grouped per user under a `shifts[]` array:** [DOCUMENTED]

| Field          | Type              | Required | Writable     | Description                              | Example          |
| -------------- | ----------------- | -------- | ------------ | ---------------------------------------- | ---------------- |
| id             | string            | —        | no           | Activity / shift identifier              | `"shift-abc123"` |
| userId         | integer           | yes      | yes (create) | Employee                                 | `9170357`        |
| start          | object            | yes      | yes          | `{ timestamp, timezone, locationData? }` | see below        |
| end            | object            | yes      | yes          | `{ timestamp, timezone, locationData? }` | see below        |
| jobId          | string            | no       | yes          | Associated job (UUID)                    | `"job-123"`      |
| subJobId       | string            | no       | yes          | Associated sub-job                       | `"subjob-456"`   |
| employeeNote   | string            | no       | yes          | Employee note                            | `"Imported"`     |
| managerNote    | string            | no       | yes          | Manager note                             | `""`             |
| isAutoClockOut | boolean           | no       | no           | Was auto-clocked-out                     | `false`          |
| createdAt      | integer (epoch s) | —        | no           | Creation timestamp                       | `1704110400`     |

**start/end object:** `{ "timestamp": 1704110400, "timezone": "America/New_York", "locationData": {…} }` — `timestamp` is **Unix epoch seconds**. [DOCUMENTED]

> **Range constraint:** time-activity queries are limited to a **92-day (3-month)** window via `startDate`/`endDate` (`YYYY-MM-DD`). [DOCUMENTED]

---

### Timesheet

**Resource path:** `/time_clock/v1/time_clocks/{timeClockId}/timesheet` [DOCUMENTED]
**Description:** Aggregated payroll summary for a time clock over a date range (total hours, breaks, etc.).
**CRUD:** Read (GET) [DOCUMENTED]

---

### Scheduler

**Resource path:** `/scheduler/v1/schedulers` [DOCUMENTED]
**Description:** A schedule board that owns shifts. **Two API versions:** V1 and V2 — both exist concurrently; V2 is the newer surface. Default to **V2** for new work, keep V1 available. [DOCUMENTED — migration default INFERRED]
**CRUD:** Read (list). Sub-resources: shift_layers, custom_fields, unavailabilities, shifts, shifts_auto_assign. [DOCUMENTED]

| Field | Type    | Required | Writable | Description    | Example      |
| ----- | ------- | -------- | -------- | -------------- | ------------ |
| id    | integer | —        | no       | Scheduler id   | `6833518`    |
| name  | string  | —        | no       | Scheduler name | `"Auckland"` |

---

### Shift

**Resource path:** `/scheduler/{v1|v2}/schedulers/{schedulerId}/shifts[/{shiftId}]` [DOCUMENTED]
**Description:** A scheduled work slot on a scheduler. Shift ids are **hex strings** in both V1 and V2.
**CRUD:** Read (list + by id), Create (POST, batch ≤ 500), Update (PUT bulk), Delete (bulk ≤ 20, or single). [DOCUMENTED]

| Field           | Type              | Required | Writable | Description            | Example                                  |
| --------------- | ----------------- | -------- | -------- | ---------------------- | ---------------------------------------- |
| id              | string (hex)      | —        | no       | Shift identifier       | `"6784dacb3c07733b0a849f49"`             |
| title           | string            | no       | yes      | Shift name             | `"Morning Shift"`                        |
| assignedUserIds | array<int>        | no       | yes      | Assigned employee ids  | `[9170357]`                              |
| startTime       | integer (epoch s) | yes      | yes      | Shift start            | `1736924400`                             |
| endTime         | integer (epoch s) | yes      | yes      | Shift end              | `1736953200`                             |
| jobId           | string (UUID)     | no       | yes      | Associated job         | `"d4ad7232-576f-2ff6-c57d-8240f1089b00"` |
| isPublished     | boolean           | —        | yes      | Visible to employees   | `true`                                   |
| isOpenShift     | boolean           | —        | yes      | Claimable / unassigned | `false`                                  |
| color           | string (#RRGGBB)  | no       | yes      | Hex colour             | `"#4B7AC5"`                              |

> **Unsupported scheduler features (NOT available via API):** data layers, shift tasks, repeating shifts,
> and group shifts. Do not attempt to create/edit these. [DOCUMENTED]

---

### User Unavailability

**Resource paths:** [DOCUMENTED]

- `GET /scheduler/{v1|v2}/schedulers/user_unavailability` — combined view (unavailabilities + approved time-off + assigned shifts)
- `POST /scheduler/v1/schedulers/{schedulerId}/unavailability` — add
- `DELETE /scheduler/v1/schedulers/{schedulerId}/unavailability/{unavailabilityId}` — remove

**Description:** Per-user availability windows, used by the scheduler when assigning shifts.

---

### Job (resource / cost-code)

**Resource path:** `/jobs/v1/jobs`, `/jobs/v1/jobs/{jobId}` [DOCUMENTED]
**Description:** A job/task/cost-code that time activities and shifts can be attributed to. Supports sub-jobs (hierarchy via `parentId`). **Job ids are UUID strings.**
**CRUD:** Create, Read, Update, Delete (soft, via `isDeleted`). Also `/jobs/v1/custom_fields`. [DOCUMENTED]

| Field        | Type          | Required     | Writable | Description                        | Example                                  |
| ------------ | ------------- | ------------ | -------- | ---------------------------------- | ---------------------------------------- |
| jobId        | string (UUID) | —            | no       | Unique identifier                  | `"9fdebf1f-0c69-4914-89d2-8f86c3e5f47d"` |
| title        | string        | yes (create) | yes      | Job name                           | `"Delivery Driver"`                      |
| code         | string        | no           | yes      | Job code                           | `"DD-001"`                               |
| color        | string        | no           | yes      | Hex colour                         | `"#3968BB"`                              |
| description  | string        | no           | yes      | Description                        | `"Delivery operations"`                  |
| gps          | object        | no           | yes      | `{ address, longitude, latitude }` | see below                                |
| isDeleted    | boolean       | —            | no       | Soft-deleted state                 | `false`                                  |
| assign       | object        | no           | yes      | `{ type, userIds[], groupIds[] }`  | `{"type":"both","userIds":[7031021]}`    |
| instanceIds  | array<int>    | no           | yes      | Scheduler/time-clock ids job is on | `[6833518]`                              |
| parentId     | string (UUID) | no           | yes      | Parent job (for sub-jobs)          | —                                        |
| subJobs      | array         | no           | no       | Child jobs                         | —                                        |
| customFields | array         | no           | yes      | Resource custom fields             | `[]`                                     |

**gps object:** `{ "address": "123 Main St", "longitude": -73.93, "latitude": 40.71 }` [DOCUMENTED]

---

### Form

**Resource paths:** `/forms/v1/forms` (list), `/forms/v1/forms/{formId}` (get) [DOCUMENTED]
**Description:** A form template. **Forms API is Enterprise-plan only.**
**CRUD:** Read [DOCUMENTED]

| Field      | Type    | Required | Writable | Description | Example           |
| ---------- | ------- | -------- | -------- | ----------- | ----------------- |
| formId     | integer | —        | no       | Form id     | `555`             |
| name       | string  | —        | no       | Form title  | `"Vehicle check"` |
| isArchived | boolean | —        | no       | Archived    | `false`           |

---

### Form Submission

**Resource paths:** `/forms/v1/forms/{formId}/form_submissions` (list), `.../{formSubmissionId}` (get + manager-field update). Dropdown question options have full CRUD under `.../questions/{questionId}`. [DOCUMENTED]
**Description:** A completed submission of a form by a user. **Manager fields** are updatable; the answer entries are read-only.
**CRUD:** Read (list + single), Update (manager fields only) [DOCUMENTED]

| Field             | Type              | Required | Writable | Description                                       |
| ----------------- | ----------------- | -------- | -------- | ------------------------------------------------- |
| formSubmissionId  | integer/string    | —        | no       | Unique submission id                              |
| formId            | integer           | —        | no       | Parent form                                       |
| userId            | integer           | —        | no       | Submitting user                                   |
| submissionTime    | integer (epoch s) | —        | no       | Submission timestamp                              |
| answers/questions | array<object>     | —        | no       | Question/answer pairs                             |
| status            | string            | —        | no       | Submission status                                 |
| managerFields     | object            | —        | partial  | `person` / `status` / `note` / `date` (updatable) |

> **[INFERRED]** — full submission response schema is not exposed on the reference page; verify against a live call.

---

### Other Entities (catalogued, not deep-dived)

From `/llms.txt` (~110 endpoints total). Fields not individually documented; paths [DOCUMENTED].

- **Smart Groups / Segments** — `/users/v1/smart_groups`, `/users/v1/smart_group_segments`
- **Custom Fields (users)** — `/users/v1/custom_fields` (+ categories, options) — full CRUD
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

---

### Webhook Subscription

**Resource path:** `/settings/v1/webhooks` [DOCUMENTED]
**Description:** A registered HTTPS endpoint that receives event callbacks for a feature.
**CRUD:** Create (POST); list/get/update/delete also exist. [DOCUMENTED]

| Field       | Type           | Required    | Writable | Description                                                       |
| ----------- | -------------- | ----------- | -------- | ----------------------------------------------------------------- |
| name        | string         | yes         | yes      | Subscription label                                                |
| url         | string (HTTPS) | yes         | yes      | Delivery endpoint                                                 |
| featureType | enum           | yes         | yes      | `users` / `forms` / `time_activity` / `shift_scheduler` / `tasks` |
| eventTypes  | array<string>  | yes         | yes      | Event names within the feature                                    |
| objectId    | integer        | conditional | yes      | Required for all featureTypes **except `users`**                  |
| secretKey   | string         | no          | yes      | Signature-verification secret                                     |
| isDisabled  | boolean        | no          | yes      | Pause delivery                                                    |
| retryLimit  | integer        | —           | no       | Fixed at 3                                                        |

---

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

[INFERRED — relationships deduced from path nesting and field names; no published ERD.]

---

## State Machines

### Time Activity / Real-time clocking [DOCUMENTED endpoints; INFERRED transitions]

```
[clocked_out] --POST clock_in--> [clocked_in] --POST clock_out--> [clocked_out]
                                       │
                                       └── auto clock-out (server rule) --> [clocked_out] (isAutoClockOut=true)
```

| From        | Action / Trigger             | To          | Reversible? | Side Effects                          |
| ----------- | ---------------------------- | ----------- | ----------- | ------------------------------------- |
| clocked_out | POST `.../clock_in`          | clocked_in  | yes         | Opens an active time activity         |
| clocked_in  | POST `.../clock_out`         | clocked_out | yes         | Closes the activity; records duration |
| clocked_in  | auto clock-out (server rule) | clocked_out | no          | `isAutoClockOut: true`                |

### Shift [INFERRED from field semantics]

```
[draft / unpublished] --publish (isPublished=true)--> [published]
[assigned] <--> [open] (isOpenShift toggles; open shifts are claimable)
```

| State       | Can Update? | Can Delete? | Notes                                       |
| ----------- | ----------- | ----------- | ------------------------------------------- |
| unpublished | yes         | yes         | `isPublished:false` — not visible to staff  |
| published   | yes         | yes         | Visible to assigned employees               |
| open        | yes         | yes         | `isOpenShift:true` — unassigned / claimable |

---

## Business Rules

- **Plan gating:** API requires **Expert plan or higher**; **Forms API is Enterprise-only**. A valid key on a lower tier is rejected/limited. [DOCUMENTED]
- **Owner-only keys:** only account owners can create/manage API keys. [DOCUMENTED]
- **Keys do not expire:** static, account-level secret (contrast OAuth's 24h token). [DOCUMENTED]
- **Phone-led identity:** users are keyed on E.164 phone numbers; create generally requires a valid `phoneNumber`. [INFERRED]
- **Time-activity window:** queries capped at **92 days**. [DOCUMENTED]
- **Schedule shifts require a window:** GET shifts needs `startTime`+`endTime`; shifts that **overlap** the range are returned. [DOCUMENTED]
- **Batch caps:** users ≤ 25; shift create ≤ 500; bulk shift delete ≤ 20. [DOCUMENTED]
- **Unsupported scheduler features:** data layers / shift tasks / repeating / group shifts. [DOCUMENTED]
- **Manager fields are the only writable part of a submission;** answer entries are immutable. [DOCUMENTED]
- **Forward-compatible schemas:** new fields may be added to responses — parse leniently, don't fail on unknown fields. [DOCUMENTED]
- **Archived/deleted visibility:** archived time clocks are listed; jobs use `isDeleted` soft-delete with an `includeDeleted` filter. [DOCUMENTED]
- **Mixed id types:** never coerce (int users/clocks/schedulers; UUID jobs; hex shifts). [DOCUMENTED]

---

## Field Format Reference

| Format        | Pattern                | Example                    | Notes                                                      |
| ------------- | ---------------------- | -------------------------- | ---------------------------------------------------------- |
| Timestamp     | Unix epoch **seconds** | `1712573537`               | Almost all time fields + rate-limit resets [DOCUMENTED]    |
| Date filter   | `YYYY-MM-DD`           | `2025-01-15`               | time_activities `startDate`/`endDate` [DOCUMENTED]         |
| Integer ID    | integer                | `7031021`                  | users, time clocks, schedulers, custom fields [DOCUMENTED] |
| UUID ID       | RFC4122 string         | `9fdebf1f-0c69-4914-…`     | jobs [DOCUMENTED]                                          |
| Hex/string ID | 24-char hex string     | `6784dacb3c07733b0a849f49` | scheduler shifts [DOCUMENTED]                              |
| Phone         | E.164                  | `+9720548888888`           | user login identity [DOCUMENTED]                           |
| Colour        | `#RRGGBB`              | `#4B7AC5`                  | shifts, jobs [DOCUMENTED]                                  |
| Timezone      | IANA tz name           | `"America/New_York"`       | start/end objects [DOCUMENTED]                             |

> **Watch-out:** Connecteam uses **Unix seconds**, not milliseconds and not ISO-8601, for activity/shift
> times. Mixing these up is the single most likely integration bug. [DOCUMENTED]

---

## Enum Value Reference

| Entity        | Field         | Allowed Values                                                | Default  | Notes                                   |
| ------------- | ------------- | ------------------------------------------------------------- | -------- | --------------------------------------- |
| User          | userType      | `owner`, `admin`, `manager`, `user`                           | —        | `owner` seen in docs; others [INFERRED] |
| Users list    | userStatus    | `active`, `archived`, (likely `all`)                          | `active` | query filter [DOCUMENTED/INFERRED]      |
| Users list    | order         | `asc`, `desc`                                                 | `asc`    | [DOCUMENTED]                            |
| Users list    | sort          | `created_at`                                                  | —        | only documented sort key [DOCUMENTED]   |
| Time Activity | activityTypes | `shift`, `manual_break`, `time_off`                           | —        | [DOCUMENTED]                            |
| Job           | assign.type   | `both`, `users`, `groups`                                     | —        | `both` seen; rest [INFERRED]            |
| Webhook       | featureType   | `users`, `forms`, `time_activity`, `shift_scheduler`, `tasks` | —        | [DOCUMENTED]                            |

> Most enum values come from the docs; defaults are mostly [INFERRED]/[UNKNOWN] without live calls.

---

_Generated from the investigation questionnaire, Phase 3. Domain model shared verbatim with the
`connecteam-oauth` connector — only the auth header differs._
