---
api_name: 'Wrike'
api_slug: 'wrike'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# Wrike -- Domain Model Reference

> Companion to `01-llm-api-rules.md`. Entity catalogue, relationships, state machines,
> and business rules for the Wrike work hierarchy. Custom statuses and custom fields are
> tenant-specific — discover via `GET /workflows` and `GET /customfields` at runtime.
> Confidence: DOCUMENTED (developers.wrike.com), not yet live-verified.

---

## The Hierarchy in One Line

`Account → Spaces → Folders/Projects → Tasks → (Comments, Timelogs, Attachments)`.
A **Project is a Folder carrying a `project` sub-object** — same `/folders` endpoints, distinguished by the presence of `project`. A **Task can belong to many Folders** (`parentIds` is N:M). IDs everywhere are **opaque alphanumeric strings**, never integers.

---

## Entity Catalog

### Folder / Project

**Resource path:** `/api/v4/folders`, `/api/v4/folders/{id}`, `/api/v4/folders/{id}/folders`, `/api/v4/spaces/{spaceId}/folders`
**Description:** A container in the work tree. Becomes a Project when it carries a `project` object (status, owners, dates).
**CRUD:** Create (under a parent folder/space) / Read / Update / Delete (→ Recycle Bin)

| Field          | Type          | Required | Writable | Description                                   | Example                                 |
| -------------- | ------------- | -------- | -------- | --------------------------------------------- | --------------------------------------- |
| `id`           | string        | —        | no       | Opaque ID                                     | `"IEAAALZ4I4AAAAB"`                     |
| `title`        | string        | yes      | yes      | Folder/project name                           | `"Q3 Launch"`                           |
| `childIds`     | array<string> | —        | no       | Child folder IDs (hierarchy, derived)         | `["IEAA...","IEAB..."]`                 |
| `scope`        | enum          | —        | no       | `WsRoot`/`WsFolder`/`RbRoot`/`RbFolder`       | `"WsFolder"`                            |
| `project`      | object        | no       | yes      | Present iff this folder is a Project          | `{ "status": "Green" }`                 |
| `customFields` | array<object> | no       | yes      | `[{id, value}]`                               | `[{"id":"IEAB...","value":"X"}]`        |
| `permalink`    | string(url)   | —        | no       | Web UI deep-link                              | `"https://www.wrike.com/open.htm?id=…"` |
| `description`  | string        | no       | yes      | Optional — request via `fields`               | `"<p>…</p>"`                            |
| `sharedIds`    | array<string> | —        | no       | Contacts the folder is shared with            | `["KUAAAAAA"]`                          |
| `space`        | bool          | —        | no       | Whether folder is a space root (via `fields`) | `true`                                  |

**`project` sub-object:** `authorId`, `ownerIds[]`, `status` (enum), `customStatusId`, `startDate`, `endDate`, `createdDate`, `completedDate`, `contractType`.

**Relationships:**

| Related Entity | Type | Expression                            | Notes                           |
| -------------- | ---- | ------------------------------------- | ------------------------------- |
| Folder (child) | 1:N  | `childIds[]`                          | Tree hierarchy                  |
| Task           | 1:N  | `/folders/{id}/tasks`, task.parentIds | A task can live in many folders |
| Space          | N:1  | `/spaces/{id}/folders`                | Spaces are top-level homes      |
| Contact        | N:M  | `sharedIds[]`                         | Sharing                         |

---

### Task

**Resource path:** `/api/v4/tasks`, `/api/v4/tasks/{id}`, `/api/v4/folders/{id}/tasks` (create + scoped list)
**Description:** The primary unit of work. Nestable (subtasks via `superTaskIds`/`subTaskIds`), can have dependencies, and spans multiple folders.
**CRUD:** Create / Read / Update / Delete (→ Recycle Bin)

| Field            | Type          | Required | Writable | Description                               | Example                  |
| ---------------- | ------------- | -------- | -------- | ----------------------------------------- | ------------------------ |
| `id`             | string        | —        | no       | Opaque task ID                            | `"IEAAALZ4KQAAAAAK"`     |
| `title`          | string        | yes      | yes      | Task name                                 | `"Write spec"`           |
| `description`    | string(HTML)  | no       | yes      | HTML body; plain text on request          | `"<p>…</p>"`             |
| `status`         | enum          | no       | yes      | High-level state — see state machine      | `"Active"`               |
| `importance`     | enum          | no       | yes      | `High`/`Normal`/`Low`                     | `"Normal"`               |
| `customStatusId` | string        | no       | yes      | Workflow status (drives `status` mapping) | `"IEAAALZ4JMAAAAA"`      |
| `dates`          | object        | no       | yes      | `{type, start, due, duration}`            | `{"due":"2026-06-01"}`   |
| `scheduledDate`  | date          | no       | yes      | via `fields`                              | `"2026-06-01"`           |
| `completedDate`  | datetime      | —        | no       | Server-set when completed                 | `"2026-05-29T03:00:00Z"` |
| `createdDate`    | datetime      | —        | no       | Server-set                                | `"2026-05-29T01:00:00Z"` |
| `updatedDate`    | datetime      | —        | no       | Server-set — the change-detection field   | `"2026-05-29T02:00:00Z"` |
| `parentIds`      | array<string> | no       | yes\*    | Folders the task belongs to (N:M)         | `["IEAAALZ4I4AAAAB"]`    |
| `superTaskIds`   | array<string> | no       | yes\*    | Parent tasks (this is a subtask of)       | `["IEAAALZ4KAAAAAA"]`    |
| `subTaskIds`     | array<string> | —        | no       | Child tasks (via `fields`)                | `["IEAAALZ4KBAAAAA"]`    |
| `responsibleIds` | array<string> | no       | yes\*    | Assignee contact IDs                      | `["KUAAAAAA"]`           |
| `authorIds`      | array<string> | —        | no       | Creator contact IDs                       | `["KUAAAAAA"]`           |
| `followerIds`    | array<string> | no       | yes\*    | Watchers                                  | `["KUAAAAAB"]`           |
| `permalink`      | string(url)   | —        | no       | Web UI deep-link                          |                          |
| `customFields`   | array<object> | no       | yes      | `[{id, value}]`                           |                          |
| `dependencyIds`  | array<string> | —        | no       | via `fields` — Gantt dependencies         |                          |

\* On **create**, supply array fields directly (`responsibles=["…"]`). On **update**, use add/remove deltas (`addResponsibles`/`removeResponsibles`) — see `01c`.

**Relationships:**

| Related Entity | Type | Expression                                 | Notes                             |
| -------------- | ---- | ------------------------------------------ | --------------------------------- |
| Folder/Project | N:M  | `parentIds[]`                              | A task can be in multiple folders |
| Task (sub)     | tree | `superTaskIds`/`subTaskIds`                | Subtask nesting                   |
| Contact        | N:M  | `responsibleIds`,`authorIds`,`followerIds` | Assignment / authorship / watch   |
| Comment        | 1:N  | `/tasks/{id}/comments`                     | Discussion                        |
| Timelog        | 1:N  | `/tasks/{id}/timelogs`                     | Time tracking                     |

---

### Comment

**Resource path:** `/api/v4/comments`, `/api/v4/tasks/{id}/comments`, `/api/v4/folders/{id}/comments`, `/api/v4/comments/{id}`
**Description:** A discussion entry on a task or folder.
**CRUD:** Create (on a task/folder) / Read / Update / Delete

| Field         | Type     | Required | Writable | Notes                                        |
| ------------- | -------- | -------- | -------- | -------------------------------------------- |
| `id`          | string   | —        | no       | Opaque comment ID                            |
| `authorId`    | string   | —        | no       | Contact ID of author                         |
| `text`        | string   | yes      | yes      | HTML by default; `?plainText=true` for plain |
| `createdDate` | datetime | —        | no       |                                              |
| `updatedDate` | datetime | —        | no       | via `fields`                                 |
| `taskId`      | string   | —        | no       | Set if the comment is on a task              |
| `folderId`    | string   | —        | no       | Set if the comment is on a folder            |
| `type`        | enum     | —        | no       | `Regular`/`Email` (via `fields`)             |

> Account-level `GET /comments` accepts a `createdDate` range of **≤ 7 days**. For older comments, scope to a task/folder.

---

### Timelog

**Resource path:** `/api/v4/timelogs`, `/api/v4/tasks/{id}/timelogs`, `/api/v4/timelogs/{id}`, `/api/v4/contacts/{id}/timelogs`
**Description:** A time-tracking record against a task.
**CRUD:** Create (on a task) / Read / Update / Delete

| Field            | Type     | Required | Writable | Notes                                    |
| ---------------- | -------- | -------- | -------- | ---------------------------------------- |
| `id`             | string   | —        | no       | Opaque timelog ID                        |
| `taskId`         | string   | —        | no       | Owning task                              |
| `userId`         | string   | —        | no       | Contact who logged the time              |
| `categoryId`     | string   | no       | yes      | Timelog category                         |
| `hours`          | number   | yes      | yes      | Decimal hours (e.g. `1.5`)               |
| `trackedDate`    | date     | yes      | yes      | The day the work happened (`YYYY-MM-DD`) |
| `createdDate`    | datetime | —        | no       |                                          |
| `updatedDate`    | datetime | —        | no       |                                          |
| `comment`        | string   | no       | yes      | Free-text note                           |
| `billingType`    | enum     | no       | yes      | via `fields` — `Billable`/`NonBillable`  |
| `approvalStatus` | enum     | —        | no       | via `fields`                             |

---

### Contact (User / Group)

**Resource path:** `/api/v4/contacts`, `/api/v4/contacts/{id}`
**Description:** A user, user group, or other actor in the account. Read-mostly.
**CRUD:** Read; limited Update via `PUT /contacts/{id}` (own profile, group membership). No create/delete via API.

| Field          | Type          | Writable | Notes                                            |
| -------------- | ------------- | -------- | ------------------------------------------------ |
| `id`           | string        | no       | Opaque contact ID                                |
| `firstName`    | string        | partial  |                                                  |
| `lastName`     | string        | partial  |                                                  |
| `type`         | enum          | no       | `Person`/`Group`/`Asset`/`Robot`                 |
| `profiles`     | array<object> | no       | Per-account `{accountId,email,role,admin,owner}` |
| `primaryEmail` | string        | no       |                                                  |
| `avatarUrl`    | string        | no       |                                                  |
| `timezone`     | string        | no       | IANA tz                                          |
| `locale`       | string        | no       |                                                  |
| `deleted`      | bool          | no       |                                                  |
| `me`           | bool          | no       | True on the requesting user's own contact        |

> `type: "Group"` contacts are user groups, not people. When resolving assignees, prefer `type: "Person"`.

---

## Entity Relationship Diagram

```
                ┌──────────┐
                │  Account │
                └────┬─────┘
                     │ 1:N
                     ▼
                ┌──────────┐        ┌───────────┐
                │  Space   │        │  Contact  │ (Person / Group)
                └────┬─────┘        └─────┬─────┘
                     │ 1:N                │  shared / assigned / author / follower
                     ▼                    │
            ┌──────────────────┐          │
            │ Folder / Project │◄─────────┘ N:M (sharedIds)
            │ (= Folder + a    │
            │   project object)│
            └────────┬─────────┘
        childIds 1:N │  parentIds N:M
                     ▼
                ┌──────────┐   superTaskIds (subtask tree)
                │   Task   │◄──────────┐
                └────┬─────┘           │
          ┌──────────┼──────────┐──────┘
          ▼          ▼          ▼
     ┌─────────┐ ┌────────┐ ┌──────────┐
     │ Comment │ │Timelog │ │Attachment│ (out of scope for chat)
     └─────────┘ └────────┘ └──────────┘
```

**Two non-obvious shapes to internalise:**

1. A Task's `parentIds` is **N:M** — the same task can appear in several folders/projects at once.
2. A "Project" is **not a distinct entity** — it's a Folder with a `project` sub-object. Filter projects with `GET /folders?project=true`.

---

## State Machines

### Task: high-level `status` + workflow `customStatusId`

Wrike has TWO status layers. A fixed high-level `status` enum, and an account-configurable `customStatusId` (workflow status) that **maps to** one of the high-level values. To move a task into a specific column, set `customStatusId`; the high-level `status` follows its group.

```
[Active] ──set status/customStatus──► [Completed]
   │  ▲                                    │
   │  └────────── reopen ─────────────────┘
   ▼
[Deferred]            [Cancelled]
```

| From      | Trigger              | To        | Reversible? | Side effects                       |
| --------- | -------------------- | --------- | ----------- | ---------------------------------- |
| Active    | set status=Completed | Completed | yes         | `completedDate` set; webhook fires |
| Active    | set status=Deferred  | Deferred  | yes         | —                                  |
| Active    | set status=Cancelled | Cancelled | yes         | —                                  |
| Completed | set status=Active    | Active    | yes         | `completedDate` cleared            |

**Per-state capabilities:** all four states are still editable and deletable. `Cancelled` is a soft-cancel (not a delete).

> Discover valid custom statuses with `GET /api/v4/workflows`. Each workflow lists `customStatuses[]` with `{id, name, group}` where `group` ∈ `Active/Completed/Deferred/Cancelled`. Setting `customStatusId` to a status whose group is `Completed` completes the task.

### Project: `project.status`

```
[Green] ⇄ [Yellow] ⇄ [Red]      [OnHold]
   └──────────┴──────────┴──► [Completed] / [Cancelled] / [Deferred]
```

Default project status enum: `Green`, `Yellow`, `Red`, `Completed`, `OnHold`, `Cancelled`, `Deferred`. Free transitions — no enforcement.

---

## Business Rules

### Ordering / dependency rules

- A Task must be created under a parent — `POST /folders/{folderId}/tasks` (or as a subtask via `superTasks`). No free-floating account-root task via the public API.
- A Timelog must be created on a Task — `POST /tasks/{taskId}/timelogs`.
- A Comment must be created on a Task or Folder — no account-level comment create.

### Field-level rules

- `title` required on task/folder create.
- `hours` and `trackedDate` required on timelog create.
- Dates: `YYYY-MM-DD` (date) or ISO 8601 (`YYYY-MM-DDThh:mm:ssZ`) for datetimes; Wrike emits `Z` (UTC).
- `description` and `comment.text` are HTML by default; pass `plainText=true` to read plain text.
- Array params on writes are JSON arrays of quoted strings: `responsibles=["KUAAAAAA"]`.

### Cascading effects

- Deleting a Folder moves it (and exclusively-contained tasks) to the Recycle Bin (soft delete).
- Deleting a Task soft-deletes (Recycle Bin); subtasks follow. [INFERRED]
- Removing a task's last `parentId` can move it to the Recycle Bin — a task must live somewhere. [INFERRED]

### Uniqueness constraints

- No title-uniqueness — duplicate folder/task titles are allowed. [INFERRED] This is why retried creates produce duplicates.

### Computed / read-only fields

- `id`, `createdDate`, `updatedDate`, `authorIds`, `permalink`, `completedDate` — server-set.
- `childIds` (folder) and `subTaskIds`/`authorIds` (task) — derived from the hierarchy/authorship, not directly writable.

---

## Field Format Reference

| Format     | Pattern                      | Example                   | Notes                                  |
| ---------- | ---------------------------- | ------------------------- | -------------------------------------- |
| Date       | `YYYY-MM-DD`                 | `2026-06-01`              | Timelog `trackedDate`, project dates   |
| DateTime   | ISO 8601 UTC                 | `2026-05-29T01:00:00Z`    | `createdDate`/`updatedDate`; emits `Z` |
| Date range | `{"start":...,"end":...}`    | `{"start":"…","end":"…"}` | URL-encoded JSON; comments ≤ 7 days    |
| Record ID  | opaque alphanumeric string   | `"IEAAALZ4I4AAAAB"`       | NOT numeric — treat as opaque string   |
| Contact ID | opaque alphanumeric string   | `"KUAAAAAA"`              | Person/Group IDs                       |
| Hours      | decimal number               | `1.5`                     | Timelog `hours`                        |
| Array      | JSON array of quoted strings | `["KUAAAAAA"]`            | `responsibles`, `parents`, `shareds`   |
| Enum       | exact case (see below)       | `"Active"`                | Case-sensitive                         |

---

## Enum Value Reference

| Entity  | Field         | Allowed Values                                                           | Default   | Notes                        |
| ------- | ------------- | ------------------------------------------------------------------------ | --------- | ---------------------------- |
| Task    | `status`      | `Active`, `Completed`, `Deferred`, `Cancelled`                           | `Active`  | High-level; not customisable |
| Task    | `importance`  | `High`, `Normal`, `Low`                                                  | `Normal`  |                              |
| Project | `status`      | `Green`, `Yellow`, `Red`, `Completed`, `OnHold`, `Cancelled`, `Deferred` | `Green`   |                              |
| Contact | `type`        | `Person`, `Group`, `Asset`, `Robot`                                      | —         |                              |
| Comment | `type`        | `Regular`, `Email`                                                       | `Regular` |                              |
| Timelog | `billingType` | `Billable`, `NonBillable`                                                | —         | via `fields`                 |
| Folder  | `scope`       | `WsRoot`, `WsFolder`, `RbRoot`, `RbFolder`                               | —         | Ws=workspace, Rb=recycle bin |

Custom-status values (`customStatusId`) are tenant-defined — discover via `GET /api/v4/workflows`. Custom-field IDs are tenant-defined — discover via `GET /api/v4/customfields`.

---

_Generated from `00-api-investigation-questionnaire.md` Phase 3._
