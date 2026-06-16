---
api_name: Wrike
api_slug: wrike
base_url: https://{host}/api/v4 ({host} from OAuth token response; never hardcode www.wrike.com)
path_version_segment: /api/v4 (real path segment — v4 is path-versioned)
call_surface: HTTP via `numa integrations request` (connector wrike). NOT file-browse, NOT MCP.
id_format: opaque alphanumeric string — never numeric, never ordered
companion_of: 01-llm-api-rules.md
doc: domain model — entities, relationships, state machines, business rules
confidence: DOCUMENTED (developers.wrike.com), not live-verified. Custom statuses + custom fields are tenant-specific — discover via GET /api/v4/workflows and GET /api/v4/customfields at runtime.
---

# Wrike — Domain Model Reference

## Hierarchy

`Account → Spaces → Folders/Projects → Tasks → (Comments, Timelogs, Attachments)`.
A **Project is a Folder carrying a `project` sub-object** — same `/api/v4/folders` endpoints, distinguished by the presence of `project`. A **Task can belong to many Folders** (`parentIds` is N:M). IDs everywhere are opaque alphanumeric strings.

## Entity Catalog

### Folder / Project

Paths: `/api/v4/folders`, `/folders/{id}`, `/folders/{id}/folders`, `/spaces/{spaceId}/folders`. Container in the work tree; a Project when it carries a `project` object. CRUD: Create (under a parent folder/space) / Read / Update / Delete (→ Recycle Bin).

| Field          | Type          | Req | Writable | Description                                   | Example                                 |
| -------------- | ------------- | --- | -------- | --------------------------------------------- | --------------------------------------- |
| `id`           | string        | —   | no       | Opaque ID                                     | `"IEAAALZ4I4AAAAB"`                     |
| `title`        | string        | yes | yes      | Folder/project name                           | `"Q3 Launch"`                           |
| `childIds`     | array<string> | —   | no       | Child folder IDs (derived)                    | `["IEAA...","IEAB..."]`                 |
| `scope`        | enum          | —   | no       | `WsRoot`/`WsFolder`/`RbRoot`/`RbFolder`       | `"WsFolder"`                            |
| `project`      | object        | no  | yes      | Present iff this folder is a Project          | `{"status":"Green"}`                    |
| `customFields` | array<object> | no  | yes      | `[{id,value}]`                                | `[{"id":"IEAB...","value":"X"}]`        |
| `permalink`    | string(url)   | —   | no       | Web UI deep-link                              | `"https://www.wrike.com/open.htm?id=…"` |
| `description`  | string        | no  | yes      | Request via `fields`                          | `"<p>…</p>"`                            |
| `sharedIds`    | array<string> | —   | no       | Contacts the folder is shared with            | `["KUAAAAAA"]`                          |
| `space`        | bool          | —   | no       | Whether folder is a space root (via `fields`) | `true`                                  |

`project` sub-object: `authorId`, `ownerIds[]`, `status` (enum), `customStatusId`, `startDate`, `endDate`, `createdDate`, `completedDate`, `contractType`.

Relationships: Folder→Folder child 1:N (`childIds[]`, tree); Folder→Task 1:N (`/folders/{id}/tasks`, `task.parentIds` — a task can live in many folders); Space→Folder N:1 (`/spaces/{id}/folders`); Folder↔Contact N:M (`sharedIds[]`, sharing).

### Task

Paths: `/api/v4/tasks`, `/tasks/{id}`, `/folders/{id}/tasks` (create + scoped list). Primary work unit; nestable (subtasks via `superTaskIds`/`subTaskIds`), can have dependencies, spans multiple folders. CRUD: Create / Read / Update / Delete (→ Recycle Bin).

| Field            | Type          | Req | Writable | Description                               | Example                  |
| ---------------- | ------------- | --- | -------- | ----------------------------------------- | ------------------------ |
| `id`             | string        | —   | no       | Opaque task ID                            | `"IEAAALZ4KQAAAAAK"`     |
| `title`          | string        | yes | yes      | Task name                                 | `"Write spec"`           |
| `description`    | string(HTML)  | no  | yes      | HTML body; plain on `?plainText=true`     | `"<p>…</p>"`             |
| `status`         | enum          | no  | yes      | High-level state (see state machine)      | `"Active"`               |
| `importance`     | enum          | no  | yes      | `High`/`Normal`/`Low`                     | `"Normal"`               |
| `customStatusId` | string        | no  | yes      | Workflow status (drives `status` mapping) | `"IEAAALZ4JMAAAAA"`      |
| `dates`          | object        | no  | yes      | `{type,start,due,duration}`               | `{"due":"2026-06-01"}`   |
| `scheduledDate`  | date          | no  | yes      | via `fields`                              | `"2026-06-01"`           |
| `completedDate`  | datetime      | —   | no       | Server-set when completed                 | `"2026-05-29T03:00:00Z"` |
| `createdDate`    | datetime      | —   | no       | Server-set                                | `"2026-05-29T01:00:00Z"` |
| `updatedDate`    | datetime      | —   | no       | Server-set — the change-detection field   | `"2026-05-29T02:00:00Z"` |
| `parentIds`      | array<string> | no  | yes\*    | Folders the task belongs to (N:M)         | `["IEAAALZ4I4AAAAB"]`    |
| `superTaskIds`   | array<string> | no  | yes\*    | Parent tasks (this is a subtask of)       | `["IEAAALZ4KAAAAAA"]`    |
| `subTaskIds`     | array<string> | —   | no       | Child tasks (via `fields`)                | `["IEAAALZ4KBAAAAA"]`    |
| `responsibleIds` | array<string> | no  | yes\*    | Assignee contact IDs                      | `["KUAAAAAA"]`           |
| `authorIds`      | array<string> | —   | no       | Creator contact IDs                       | `["KUAAAAAA"]`           |
| `followerIds`    | array<string> | no  | yes\*    | Watchers                                  | `["KUAAAAAB"]`           |
| `permalink`      | string(url)   | —   | no       | Web UI deep-link                          |                          |
| `customFields`   | array<object> | no  | yes      | `[{id,value}]`                            |                          |
| `dependencyIds`  | array<string> | —   | no       | via `fields` — Gantt dependencies         |                          |

\* On **create** supply array fields directly (`responsibles=["…"]`). On **update** use add/remove deltas (`addResponsibles`/`removeResponsibles`) — see 01c.

Relationships: Task↔Folder/Project N:M (`parentIds[]`); Task↔Task tree (`superTaskIds`/`subTaskIds`); Task↔Contact N:M (`responsibleIds`,`authorIds`,`followerIds`); Task→Comment 1:N (`/tasks/{id}/comments`); Task→Timelog 1:N (`/tasks/{id}/timelogs`).

### Comment

Paths: `/api/v4/comments`, `/tasks/{id}/comments`, `/folders/{id}/comments`, `/comments/{id}`. A discussion entry on a task or folder. CRUD: Create (on a task/folder) / Read / Update / Delete.

| Field         | Type     | Req | Writable | Notes                                        |
| ------------- | -------- | --- | -------- | -------------------------------------------- |
| `id`          | string   | —   | no       | Opaque comment ID                            |
| `authorId`    | string   | —   | no       | Contact ID of author                         |
| `text`        | string   | yes | yes      | HTML by default; `?plainText=true` for plain |
| `createdDate` | datetime | —   | no       |                                              |
| `updatedDate` | datetime | —   | no       | via `fields`                                 |
| `taskId`      | string   | —   | no       | Set if the comment is on a task              |
| `folderId`    | string   | —   | no       | Set if the comment is on a folder            |
| `type`        | enum     | —   | no       | `Regular`/`Email` (via `fields`)             |

Account-level `GET /api/v4/comments` accepts a `createdDate` range of **≤7 days**. For older comments, scope to a task/folder.

### Timelog

Paths: `/api/v4/timelogs`, `/tasks/{id}/timelogs`, `/timelogs/{id}`, `/contacts/{id}/timelogs`. A time-tracking record against a task. CRUD: Create (on a task) / Read / Update / Delete.

| Field            | Type     | Req | Writable | Notes                                   |
| ---------------- | -------- | --- | -------- | --------------------------------------- |
| `id`             | string   | —   | no       | Opaque timelog ID                       |
| `taskId`         | string   | —   | no       | Owning task                             |
| `userId`         | string   | —   | no       | Contact who logged the time             |
| `categoryId`     | string   | no  | yes      | Timelog category                        |
| `hours`          | number   | yes | yes      | Decimal hours (e.g. `1.5`)              |
| `trackedDate`    | date     | yes | yes      | Day the work happened (`YYYY-MM-DD`)    |
| `createdDate`    | datetime | —   | no       |                                         |
| `updatedDate`    | datetime | —   | no       |                                         |
| `comment`        | string   | no  | yes      | Free-text note                          |
| `billingType`    | enum     | no  | yes      | via `fields` — `Billable`/`NonBillable` |
| `approvalStatus` | enum     | —   | no       | via `fields`                            |

### Contact (User / Group)

Paths: `/api/v4/contacts`, `/contacts/{id}`. A user, group, or other actor. Read-mostly: Read; limited Update via `PUT /contacts/{id}` (own profile, group membership). No create/delete via the API.

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

`type:"Group"` contacts are user groups, not people. When resolving assignees prefer `type:"Person"`.

## Entity Relationship Diagram

```
Account 1:N → Space 1:N → Folder/Project (= Folder + a project object)
                              │ childIds 1:N (tree); parentIds N:M
                              ▼
                            Task ◄── superTaskIds (subtask tree)
                              ├─ 1:N → Comment
                              ├─ 1:N → Timelog
                              └─ 1:N → Attachment (out of scope for chat)
Contact (Person/Group) ↔ Folder N:M (sharedIds); ↔ Task (responsible/author/follower)
```

Two non-obvious shapes: (1) a Task's `parentIds` is N:M — the same task can appear in several folders/projects at once; (2) a "Project" is NOT a distinct entity — it's a Folder with a `project` sub-object (filter with `GET /api/v4/folders?project=true`).

## State Machines

### Task: high-level `status` + workflow `customStatusId`

Two layers: a fixed high-level `status` enum, and an account-configurable `customStatusId` (workflow status) that maps to one high-level value. To move a task into a specific column set `customStatus`; the high-level `status` follows its group.

| From      | Trigger              | To        | Reversible | Side effects                       |
| --------- | -------------------- | --------- | ---------- | ---------------------------------- |
| Active    | set status=Completed | Completed | yes        | `completedDate` set; webhook fires |
| Active    | set status=Deferred  | Deferred  | yes        | —                                  |
| Active    | set status=Cancelled | Cancelled | yes        | —                                  |
| Completed | set status=Active    | Active    | yes        | `completedDate` cleared            |

All four states stay editable and deletable; `Cancelled` is a soft-cancel, not a delete. Discover valid custom statuses with `GET /api/v4/workflows` — each workflow lists `customStatuses[]` `{id,name,group}` where `group ∈ Active/Completed/Deferred/Cancelled`. Setting `customStatus` to a status whose group is `Completed` completes the task.

### Project: `project.status`

Enum: `Green`, `Yellow`, `Red`, `Completed`, `OnHold`, `Cancelled`, `Deferred`. Free transitions — no enforcement.

## Business Rules

- A Task must be created under a parent — `POST /folders/{folderId}/tasks` (or as a subtask via `superTasks`). No free-floating account-root task via the public API.
- A Timelog must be created on a Task — `POST /tasks/{taskId}/timelogs`.
- A Comment must be created on a Task or Folder — no account-level comment create.
- Required on create: `title` (task/folder); `hours`+`trackedDate` (timelog); `text` (comment).
- Dates: `YYYY-MM-DD` (date) or ISO 8601 `YYYY-MM-DDThh:mm:ssZ` (datetime); Wrike emits `Z` (UTC).
- `description` / `comment.text` are HTML by default; pass `plainText=true` to read plain.
- Array params on writes are JSON arrays of quoted strings: `responsibles=["KUAAAAAA"]`.
- **Cascading:** deleting a Folder moves it (and exclusively-contained tasks) to the Recycle Bin (soft delete). Deleting a Task soft-deletes (Recycle Bin); subtasks follow [INFERRED]. Removing a task's last `parentId` can move it to the Recycle Bin — a task must live somewhere [INFERRED].
- **No title-uniqueness** — duplicate folder/task titles allowed [INFERRED]; this is why retried creates produce duplicates.
- **Computed / read-only (server-set):** `id`, `createdDate`, `updatedDate`, `authorIds`, `permalink`, `completedDate`; `childIds` (folder), `subTaskIds`/`authorIds` (task) derived from hierarchy/authorship, not writable.

## Field Format Reference

| Format     | Pattern                      | Example                   | Notes                                  |
| ---------- | ---------------------------- | ------------------------- | -------------------------------------- |
| Date       | `YYYY-MM-DD`                 | `2026-06-01`              | timelog `trackedDate`, project dates   |
| DateTime   | ISO 8601 UTC                 | `2026-05-29T01:00:00Z`    | `createdDate`/`updatedDate`; emits `Z` |
| Date range | `{"start":…,"end":…}`        | `{"start":"…","end":"…"}` | URL-encoded JSON; comments ≤7 days     |
| Record ID  | opaque alphanumeric string   | `"IEAAALZ4I4AAAAB"`       | NOT numeric                            |
| Contact ID | opaque alphanumeric string   | `"KUAAAAAA"`              | Person/Group IDs                       |
| Hours      | decimal number               | `1.5`                     | timelog `hours`                        |
| Array      | JSON array of quoted strings | `["KUAAAAAA"]`            | `responsibles`, `parents`, `shareds`   |
| Enum       | exact case (below)           | `"Active"`                | case-sensitive                         |

## Enum Value Reference

| Entity  | Field         | Allowed Values                                                     | Default   | Notes                        |
| ------- | ------------- | ------------------------------------------------------------------ | --------- | ---------------------------- |
| Task    | `status`      | `Active`,`Completed`,`Deferred`,`Cancelled`                        | `Active`  | high-level; not customisable |
| Task    | `importance`  | `High`,`Normal`,`Low`                                              | `Normal`  |                              |
| Project | `status`      | `Green`,`Yellow`,`Red`,`Completed`,`OnHold`,`Cancelled`,`Deferred` | `Green`   |                              |
| Contact | `type`        | `Person`,`Group`,`Asset`,`Robot`                                   | —         |                              |
| Comment | `type`        | `Regular`,`Email`                                                  | `Regular` |                              |
| Timelog | `billingType` | `Billable`,`NonBillable`                                           | —         | via `fields`                 |
| Folder  | `scope`       | `WsRoot`,`WsFolder`,`RbRoot`,`RbFolder`                            | —         | Ws=workspace, Rb=recycle bin |

Custom-status values (`customStatusId`) are tenant-defined — discover via `GET /api/v4/workflows`. Custom-field IDs are tenant-defined — discover via `GET /api/v4/customfields`.
