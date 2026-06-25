---
api_name: Motion
api_slug: motion
base_url: https://api.usemotion.com/v1
call_surface: HTTP via `numa integrations request`
auth: X-API-Key header
field_casing: camelCase
companions: 01=api-rules, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
confidence: paths/CRUD [DOCUMENTED] from docs.usemotion.com; some field schemas [INFERRED] (per-endpoint pages show partial field sets); NO live call made — treat field tables as a strong starting point, not gospel. Non-default markers tagged inline.
source: docs.usemotion.com — api-reference (tasks/projects/workspaces/schedules/recurring-tasks/comments/statuses/custom-fields/users) + getting-started + rate-limits cookbooks
---

# Motion — Domain Model Reference

Entity catalog, relationships, and business rules. Companion to `01-llm-api-rules.md`.

## ⚠️ ID & format conventions (read first)

- **All ids are opaque strings** — `task_789`, `proj_xyz789`, `ws_123`, `team_456`, `user_456`. Never coerce to int, never parse structure; pass back exactly as received.
- **Timestamps are ISO-8601 datetime strings** (`2024-01-15T17:00:00Z`), not epoch seconds.
- **Field casing is camelCase** (`workspaceId`, `dueDate`, `createdTime`, `assigneeId`, `isDefaultStatus`).
- **`status` is asymmetric:** a plain **string** on write (`"In Progress"`), a **`{name,isDefaultStatus,isResolvedStatus}` object** on read.

## Entity Catalog

### Task

Paths: `/tasks` (list), `/tasks/{id}` (get/update/delete), `/tasks/{id}/move`, `/tasks/{id}/unassign`. The core unit of work. Can be auto-scheduled by Motion's planner.
CRUD: Create (POST), Read (list + by id), Update (PATCH), Delete (DELETE). Plus Move (change workspace) and Unassign.

| Field         | Type                                         | Required (create) | Writable | Description                                     | Example                              |
| ------------- | -------------------------------------------- | ----------------- | -------- | ----------------------------------------------- | ------------------------------------ |
| id            | string                                       | —                 | no       | Opaque task id                                  | `"task_789"`                         |
| name          | string                                       | yes               | yes      | Task title                                      | `"Complete project proposal"`        |
| workspaceId   | string                                       | yes               | yes      | Owning workspace (also required on update)      | `"ws_123"`                           |
| description   | string                                       | no                | yes      | **GFM markdown on input, HTML on output**       | `"# Report"` → `"<h1>Report</h1>"`   |
| priority      | enum                                         | no                | yes      | `ASAP`/`HIGH`/`MEDIUM`/`LOW`                    | `"HIGH"`                             |
| status        | string (write) / object (read)               | no                | yes      | Send a name string; read a status object        | `"To Do"` / `{...}`                  |
| dueDate       | string (ISO-8601)                            | no¹               | yes      | Due date; **required for scheduled tasks**      | `"2024-01-15T17:00:00Z"`             |
| duration      | string \| integer                            | no                | yes      | `"NONE"`, `"REMINDER"`, or minutes (int > 0)    | `120`                                |
| autoScheduled | object \| null                               | no                | yes      | Enables Motion auto-scheduling; `null` disables | see below                            |
| projectId     | string                                       | no                | yes      | Associated project                              | `"proj_xyz789"`                      |
| labels        | array<string> (write) / array<object> (read) | no                | yes      | Send label **names**; read `[{name}]`           | `["urgent"]` / `[{"name":"urgent"}]` |
| assigneeId    | string                                       | no                | yes      | User the task is assigned to (write field)      | `"user_456"`                         |
| assignees     | array<object>                                | —                 | no       | Resolved assignees on read: `{id,name,email}`   | see below                            |
| completed     | boolean                                      | —                 | no       | Completion flag                                 | `false`                              |
| createdTime   | string (ISO-8601)                            | —                 | no       | Creation timestamp                              | `"2024-01-10T10:30:00Z"`             |
| updatedTime   | string (ISO-8601)                            | —                 | no       | Last-modified timestamp                         | `"2024-01-12T15:30:00Z"`             |

¹ `dueDate` is optional in general but **required when the task is scheduled** (`autoScheduled` set).
`assignees` read shape: `[{"id":"user_456","name":"Jane Doe","email":"jane@acme.com"}]`
`autoScheduled` write shape (fields [INFERRED]): `{"startDate":"…","deadlineType":"…","schedule":"…"}` — verify against live before relying on sub-fields.

### Project

Paths: `/projects` (list), `/projects/{id}` (get), `/projects` (create). A container that groups tasks within a workspace.
CRUD: Create (POST), Read (list + by id). **No update or delete endpoint documented.**

| Field             | Type              | Required (create) | Writable     | Description                               | Example                           |
| ----------------- | ----------------- | ----------------- | ------------ | ----------------------------------------- | --------------------------------- |
| id                | string            | —                 | no           | Opaque project id                         | `"proj_xyz789"`                   |
| name              | string            | yes               | yes (create) | Project name                              | `"Q1 Campaign Launch"`            |
| workspaceId       | string            | yes               | yes (create) | Owning workspace                          | `"ws_abc123"`                     |
| description       | string            | no                | yes (create) | **HTML accepted on input**                | `"<p>Marketing campaign</p>"`     |
| dueDate           | string (ISO-8601) | no                | yes (create) | Due date                                  | `"2024-03-31T17:00:00.000-06:00"` |
| priority          | enum              | no (def `MEDIUM`) | yes (create) | `ASAP`/`HIGH`/`MEDIUM`/`LOW`              | `"HIGH"`                          |
| labels            | array<string>     | no                | yes (create) | Label names                               | `["marketing","urgent"]`          |
| status            | object            | —                 | no           | Read-only status object                   | `{"name":"Not Started",…}`        |
| createdTime       | string (ISO-8601) | —                 | no           | Creation timestamp                        | —                                 |
| updatedTime       | string (ISO-8601) | —                 | no           | Last-modified timestamp                   | —                                 |
| customFieldValues | object            | —                 | no           | Map of custom-field values, keyed by name | `{}`                              |

### Workspace

Path: `/workspaces` (list). The top-level container — **everything else is scoped by `workspaceId`**, so list workspaces first to discover ids, labels, and statuses.
CRUD: Read (list only).

| Field    | Type          | Writable | Description                            | Example                                         |
| -------- | ------------- | -------- | -------------------------------------- | ----------------------------------------------- |
| id       | string        | no       | Opaque workspace id                    | `"ws_123"`                                      |
| name     | string        | no       | Workspace display name                 | `"Engineering"`                                 |
| teamId   | string        | no       | Owning team id                         | `"team_456"`                                    |
| type     | enum          | no       | `team` or `individual`                 | `"team"`                                        |
| labels   | array<object> | no       | Available labels: `[{name}]`           | `[{"name":"bug"},{"name":"feature"}]`           |
| statuses | array<object> | no       | Available statuses (see Status entity) | `[{"name":"Backlog","isDefaultStatus":true,…}]` |

### Status

Path: `/statuses?workspaceId=…` (get). Workspace-scoped task/project state. **Not a top-level entity** — fetched per workspace.
CRUD: Read only.

| Field            | Type    | Description                                    | Example   |
| ---------------- | ------- | ---------------------------------------------- | --------- |
| name             | string  | Status name (this is what you send on a write) | `"To Do"` |
| isDefaultStatus  | boolean | The workspace's default status for new items   | `true`    |
| isResolvedStatus | boolean | A terminal/resolved status (e.g. Done)         | `false`   |

> Statuses are also embedded inline in each Workspace's `statuses[]` — you can read them there without a second call.

### Schedule

Path: `/schedules` (get). The caller's working-hours definition; used by Motion's auto-scheduler.
CRUD: Read only. Returns an **array** (top-level, no `meta` wrapper).

| Field             | Type    | Description                                       | Example              |
| ----------------- | ------- | ------------------------------------------------- | -------------------- |
| name              | string  | Schedule name                                     | `"Work Hours"`       |
| isDefaultTimezone | boolean | Whether this uses the default timezone            | `true`               |
| timezone          | string  | IANA timezone name                                | `"America/New_York"` |
| schedule          | object  | Per-weekday array of `{start,end}` (HH:MM) blocks | see below            |

`schedule` shape: `{"monday":[{"start":"09:00","end":"17:00"}],"saturday":[],"sunday":[]}` — empty array = non-working day. Times are `HH:MM` strings.

### Recurring Task

Paths: `/recurring-tasks` (list/create), `/recurring-tasks/{id}` (delete). A template that spawns recurring task instances.
CRUD: Create (POST), Read (list only — **no get-by-id**), Delete (DELETE). **No update.**

| Field       | Type     | Required (create) | Description                         | Example      |
| ----------- | -------- | ----------------- | ----------------------------------- | ------------ |
| id          | string   | —                 | Opaque recurring-task id            | —            |
| name        | string   | yes               | Task name                           | —            |
| workspaceId | string   | yes               | Owning workspace                    | `"ws_123"`   |
| assigneeId  | string   | yes [INFERRED]    | Assigned user                       | `"user_456"` |
| frequency   | (varies) | yes [INFERRED]    | Recurrence pattern                  | —            |
| creator     | object   | —                 | Read-only creator on list           | —            |
| assignee    | object   | —                 | Read-only resolved assignee on list | —            |
| project     | object   | —                 | Read-only project on list           | —            |
| status      | object   | —                 | Read-only status on list            | —            |
| priority    | enum     | —                 | `ASAP`/`HIGH`/`MEDIUM`/`LOW`        | —            |
| labels      | array    | —                 | Labels on list                      | —            |
| workspace   | object   | —                 | Read-only workspace on list         | —            |

> [INFERRED] Create body (`name`/`workspaceId`/`assigneeId`/`frequency`) is deduced from the list response shape and partial docs — the exact `frequency` schema is **not** published. Verify against a live call before relying on it.

### Comment

Paths: `/comments?taskId=…` (list), `/comments` (create). A comment attached to a task.
CRUD: Create (POST), Read (list only). **No update or delete.**

| Field     | Type              | Required (create) | Description                     | Example               |
| --------- | ----------------- | ----------------- | ------------------------------- | --------------------- |
| id        | string            | —                 | Opaque comment id               | —                     |
| taskId    | string            | yes               | Parent task                     | `"task_789"`          |
| content   | string            | yes               | **HTML content** of the comment | `"<p>Looks good</p>"` |
| createdAt | string (ISO-8601) | —                 | Creation timestamp              | —                     |
| creator   | object            | —                 | `{id,name,email}` of the author | —                     |

### Custom Field (beta)

Paths: **`/beta/workspaces/{workspaceId}/custom-fields`** (list/create), `/beta/workspaces/{workspaceId}/custom-fields/{id}` (delete). Plus association endpoints to set/clear a field's value on a project or task.
CRUD: Create (POST), Read (list), Delete (DELETE). **On a separate `/beta` host path — NOT `/v1`.**

| Field    | Type   | Required (create) | Description                                                                                                                                             |
| -------- | ------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id       | string | —                 | Opaque custom-field id                                                                                                                                  |
| name     | string | yes               | Field name                                                                                                                                              |
| type     | enum   | yes               | `text`/`url`/`date`/`person`/`multiPerson`/`phone`/`select`/`multiSelect`/`number`/`email`/`checkbox`/`relatedTo`                                       |
| metadata | object | no                | Config for advanced types — `options[]` (select/multiSelect: `{id,value,color}`), `format` (number: `plain`/`formatted`/`percent`), `toggle` (checkbox) |

> Some docs label the read field `field` and others `type`; treat them as the same attribute. Association endpoints (add/remove a value on a project/task) exist but their exact sub-paths are **[INFERRED]/[UNKNOWN]** — verify in discovery before use.

### User

Paths: `/users/me` (the caller), `/users?workspaceId=…` (list members).
CRUD: Read only.

| Field | Type   | Description    | Example           |
| ----- | ------ | -------------- | ----------------- |
| id    | string | Opaque user id | `"user_456"`      |
| name  | string | Display name   | `"Jane Doe"`      |
| email | string | Email address  | `"jane@acme.com"` |

## Entity Relationship Diagram

```
┌──────────────┐  1:N   ┌──────────────┐  1:N   ┌──────────────┐
│  Workspace   │───────>│   Project    │───────>│    Task      │
│  (ws_…)      │        │  (proj_…)    │        │  (task_…)    │
└──────────────┘        └──────────────┘        └──────────────┘
   │   │   │                                        │   │   │
   │   │   └── statuses[] (embedded)                │   │   └── comments (1:N, /comments?taskId)
   │   └────── labels[]  (embedded)                 │   └────── assignees[] ──> User (user_…)
   │                                                └────────── customFieldValues (beta)
   ├── Status     (/statuses?workspaceId)
   ├── User       (/users?workspaceId)  ── /users/me = caller
   ├── RecurringTask (/recurring-tasks?workspaceId)
   └── CustomField   (/beta/workspaces/{id}/custom-fields)

  Schedule (/schedules) — caller-scoped working hours, not workspace-nested
```

[INFERRED — relationships deduced from path nesting + the `workspaceId`/`projectId`/`taskId` foreign keys; no published ERD.]

## Business Rules

- **Workspace-first:** statuses, recurring-tasks, users-list, and well-scoped task/project reads all need a `workspaceId`. List `/workspaces` once, cache, reuse.
- **Per-user key, per-user visibility:** the key is a single user's. List/get only return what that user can see; a `403` means the user lacks access, not a bad key.
- **`status` strings must be valid for the workspace:** send a `name` that exists in that workspace's `statuses[]` (or omit to take the default). Get them from the workspace object or `GET /statuses`.
- **Scheduled tasks need a `dueDate`:** if `autoScheduled` is set, `dueDate` is required.
- **`duration` is a constrained union:** `"NONE"`, `"REMINDER"`, or a positive integer of minutes.
- **No project update/delete, no recurring-task update/get, no comment update/delete** — those operations simply don't exist in the API; don't attempt them.
- **Custom Fields are beta and off-version** (`/beta/…`) — treat as less stable than the `/v1` core.
- **Forward-compatible schemas:** new response fields may appear — parse leniently, don't fail on unknown keys.

## Field Format Reference

| Format        | Pattern                                                 | Example                      | Notes                                        |
| ------------- | ------------------------------------------------------- | ---------------------------- | -------------------------------------------- |
| Timestamp     | ISO-8601 datetime                                       | `2024-01-15T17:00:00Z`       | dueDate, createdTime, updatedTime, createdAt |
| Opaque ID     | string (no structure)                                   | `task_789`, `ws_123`         | all ids; never coerce                        |
| Priority      | enum                                                    | `ASAP`/`HIGH`/`MEDIUM`/`LOW` | tasks + projects (project default `MEDIUM`)  |
| Duration      | `"NONE"`/`"REMINDER"`/int                               | `120`                        | minutes when integer                         |
| Description   | GFM in / HTML out (tasks) · HTML in (projects/comments) | `"# H"` → `"<h1>H</h1>"`     | comment `content` is HTML                    |
| Schedule time | `HH:MM` string                                          | `"09:00"`                    | schedule day blocks                          |
| Timezone      | IANA tz name                                            | `"America/New_York"`         | schedule timezone                            |

## Enum Value Reference

| Entity       | Field           | Allowed Values                                                                                                    | Default            | Notes              |
| ------------ | --------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------ |
| Task/Project | priority        | `ASAP`, `HIGH`, `MEDIUM`, `LOW`                                                                                   | `MEDIUM` (project) | uppercase          |
| Task         | duration        | `"NONE"`, `"REMINDER"`, integer minutes (>0)                                                                      | —                  | union type         |
| Workspace    | type            | `team`, `individual`                                                                                              | —                  |                    |
| Custom Field | type            | `text`,`url`,`date`,`person`,`multiPerson`,`phone`,`select`,`multiSelect`,`number`,`email`,`checkbox`,`relatedTo` | —                  | beta               |
| Custom Field | metadata.format | `plain`, `formatted`, `percent`                                                                                   | —                  | number fields only |
