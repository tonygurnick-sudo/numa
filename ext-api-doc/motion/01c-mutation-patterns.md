---
api_name: Motion
api_slug: motion
base_url: https://api.usemotion.com/v1
call_surface: HTTP via `numa integrations request`
auth: X-API-Key header
companions: 01=api-rules, 01a=domain-model, 01b=query-patterns, 01d=events+errors
permissions: per-user API key = that user's own access. No scope model; the only gate is the user's Motion permissions (a 403 = no access to that workspace/resource). Guard destructive ops with explicit user confirmation, not scopes.
confidence: [DOCUMENTED] from docs.usemotion.com unless tagged [INFERRED]/[UNKNOWN]; NO live call made
---

# Motion — Mutation Patterns Reference

Write patterns: create, update, delete, move, unassign. Companion to `01-llm-api-rules.md`.

> **Writes count against the same tiny rate budget** (12/min individual, 120 team, **no `Retry-After`**). Confirm the change with the user, send **one** request, then verify with a single GET — don't retry blindly into a 429.

## Write Capabilities

| Operation             | Method | Path                                                | Notes                                                                     |
| --------------------- | ------ | --------------------------------------------------- | ------------------------------------------------------------------------- |
| Create task           | POST   | `/tasks`                                            | `name` + `workspaceId` required                                           |
| Update task           | PATCH  | `/tasks/{id}`                                       | `name` + `workspaceId` required even on update                            |
| Move task             | POST   | `/tasks/{id}/move`                                  | body `{workspaceId, assigneeId?}` (POST per index; PATCH on one doc page) |
| Unassign task         | POST   | `/tasks/{id}/unassign`                              | no body documented                                                        |
| Delete task           | DELETE | `/tasks/{id}`                                       | destructive                                                               |
| Create project        | POST   | `/projects`                                         | `name` + `workspaceId` required                                           |
| Create recurring task | POST   | `/recurring-tasks`                                  | `name`/`workspaceId`/`assigneeId`/`frequency` [partly INFERRED]           |
| Delete recurring task | DELETE | `/recurring-tasks/{id}`                             | destructive                                                               |
| Create comment        | POST   | `/comments`                                         | body `{taskId, content}` — `content` is HTML                              |
| Create custom field   | POST   | `/beta/workspaces/{workspaceId}/custom-fields`      | **`/beta`, not `/v1`** — absolute URL                                     |
| Delete custom field   | DELETE | `/beta/workspaces/{workspaceId}/custom-fields/{id}` | **`/beta`** (sub-path [INFERRED])                                         |
| Update project        | —      | —                                                   | **Not supported** — no PATCH/PUT documented                               |
| Update recurring task | —      | —                                                   | **Not supported** — list/create/delete only                               |
| Update/delete comment | —      | —                                                   | **Not supported** — create/list only                                      |
| Idempotency keys      | —      | —                                                   | **None documented** — guard non-idempotent POSTs                          |

## Patterns

All write requests send `X-API-Key: {api_token}` + `Content-Type: application/json`.

### Pattern 1: Create a task

```http
POST /tasks
{
  "name": "Complete project proposal",
  "workspaceId": "ws_123",
  "dueDate": "2024-01-15T17:00:00Z",
  "priority": "HIGH",
  "duration": 120,
  "description": "Draft and review proposal",
  "labels": ["urgent"],
  "assigneeId": "user_456"
}
```

- **`name` and `workspaceId` are required.**
- `dueDate` is ISO-8601; **required when the task is scheduled** (`autoScheduled` set).
- `duration` = `"NONE"`, `"REMINDER"`, or minutes (int > 0).
- `priority` ∈ `ASAP`/`HIGH`/`MEDIUM`/`LOW`.
- `status` is a **string** name (must exist in the workspace's statuses; omit → workspace default).
- `description` is **GFM markdown** in (returned as HTML).
- `labels` are label **names** (strings).
- Non-idempotent — re-running creates a duplicate task.

Response (status returned as an **object**):

```json
{
  "id": "task_789",
  "name": "Complete project proposal",
  "description": "<p>Draft and review proposal</p>",
  "priority": "HIGH",
  "dueDate": "2024-01-15T17:00:00Z",
  "duration": 120,
  "status": { "name": "To Do", "isDefaultStatus": true, "isResolvedStatus": false },
  "completed": false,
  "createdTime": "2024-01-10T10:30:00Z",
  "assignees": [{ "id": "user_456", "email": "user@example.com" }],
  "labels": [{ "name": "urgent" }],
  "workspace": { "id": "ws_123", "name": "My Workspace" }
}
```

### Pattern 2: Update a task (PATCH — partial)

```http
PATCH /tasks/task_789
{
  "name": "Complete project report",
  "workspaceId": "ws_123",
  "status": "In Progress",
  "priority": "HIGH"
}
```

- **`name` and `workspaceId` are required even on update** — include them every time, not just the fields you're changing.
- All other fields optional; send only what you want changed (plus the two required keys).
- Set `autoScheduled` to an object to enable Motion scheduling, or `null` to disable it.

### Pattern 3: Move a task to another workspace

```http
POST /tasks/task_789/move
{ "workspaceId": "ws_999", "assigneeId": "user_456" }
```

- `workspaceId` (the destination) is required; `assigneeId` optional.
- The API index lists this as **POST**; one doc page shows **PATCH**. Use **POST**; if it returns `405 Method Not Allowed`, retry as PATCH.

### Pattern 4: Unassign a task

```http
POST /tasks/task_789/unassign
```

No request body documented. Removes the current assignee.

### Pattern 5: Delete a task (destructive)

```http
DELETE /tasks/task_789
```

> **Destructive — confirm with the user first.** No soft-delete/restore documented.

### Pattern 6: Create a project

```http
POST /projects
{
  "name": "Q1 Campaign Launch",
  "workspaceId": "ws_abc123",
  "description": "<p>Marketing campaign for Q1</p>",
  "dueDate": "2024-03-31T17:00:00.000-06:00",
  "priority": "HIGH",
  "labels": ["marketing", "urgent"]
}
```

- `name` + `workspaceId` required; `priority` defaults to `MEDIUM`.
- `description` accepts **HTML**.
- **There is no project update or delete endpoint** — create is the only mutation.

Response:

```json
{
  "id": "proj_xyz789",
  "name": "Q1 Campaign Launch",
  "description": "<p>Marketing campaign for Q1</p>",
  "workspaceId": "ws_abc123",
  "status": { "name": "Not Started", "isDefaultStatus": true, "isResolvedStatus": false }
}
```

### Pattern 7: Create a comment on a task

```http
POST /comments
{ "taskId": "task_789", "content": "<p>Looks good — shipping today.</p>" }
```

- `taskId` + `content` required; **`content` is HTML.**
- Create-only — comments cannot be edited or deleted via the API.

### Pattern 8: Create / delete a recurring task

```http
POST /recurring-tasks
{ "name": "Weekly standup notes", "workspaceId": "ws_123", "assigneeId": "user_456", "frequency": "..." }
```

```http
DELETE /recurring-tasks/recurring_123
```

> Create body (esp. the `frequency` schema) is **[INFERRED]** from the list response — the exact recurrence format isn't published. Verify against a live call before relying on it. Delete is **destructive** — confirm first.

### Pattern 9: Create a custom field (beta — off-version path)

```http
POST https://api.usemotion.com/beta/workspaces/ws_123/custom-fields
{
  "name": "Priority Level",
  "type": "select",
  "metadata": { "options": [ { "id": "opt1", "value": "High", "color": "#FF0000" } ] }
}
```

- **Absolute `/beta` URL** — do **not** let the `/v1` base prepend.
- `name` + `type` required; `type` ∈ `text`/`url`/`date`/`person`/`multiPerson`/`phone`/`select`/`multiSelect`/`number`/`email`/`checkbox`/`relatedTo`.
- `metadata`: `options[]` (select/multiSelect: `{id,value,color}`), `format` (number: `plain`/`formatted`/`percent`), `toggle` (checkbox).
- Delete: `DELETE /beta/workspaces/{workspaceId}/custom-fields/{id}` (sub-path [INFERRED]). Association endpoints (set/clear a value on a project/task) exist but their exact paths are [UNKNOWN] — verify in discovery.

## Field Validation Rules

| Entity       | Field             | Rule                                                      | Source       |
| ------------ | ----------------- | --------------------------------------------------------- | ------------ |
| Task         | name              | Required on create **and** update                         | [DOCUMENTED] |
| Task         | workspaceId       | Required on create **and** update                         | [DOCUMENTED] |
| Task         | priority          | One of `ASAP`/`HIGH`/`MEDIUM`/`LOW`                       | [DOCUMENTED] |
| Task         | duration          | `"NONE"` / `"REMINDER"` / integer minutes (>0)            | [DOCUMENTED] |
| Task         | dueDate           | ISO-8601; **required if scheduled** (`autoScheduled` set) | [DOCUMENTED] |
| Task         | status            | Send a name string valid for the workspace                | [DOCUMENTED] |
| Task move    | workspaceId       | Required (destination)                                    | [DOCUMENTED] |
| Project      | name, workspaceId | Required on create                                        | [DOCUMENTED] |
| Project      | priority          | Defaults to `MEDIUM`                                      | [DOCUMENTED] |
| Comment      | taskId, content   | Both required; `content` is HTML                          | [DOCUMENTED] |
| Custom field | name, type        | Required; `type` from the enum list                       | [DOCUMENTED] |
| (any)        | idempotency key   | None documented — guard double-submit yourself            | [UNKNOWN]    |

## Server-Side Defaults

| Entity  | Field       | Default                           | When Applied        |
| ------- | ----------- | --------------------------------- | ------------------- |
| Task    | id          | auto-generated opaque string      | create              |
| Task    | status      | workspace default status          | create (if omitted) |
| Task    | createdTime | current time (ISO-8601)           | create              |
| Task    | completed   | `false`                           | create [INFERRED]   |
| Project | priority    | `MEDIUM`                          | create (if omitted) |
| Project | status      | workspace default ("Not Started") | create              |

## Dangerous Operations — workspace agent MUST confirm with the user first

| Operation             | Why Dangerous                                               | Safeguard                                   |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| DELETE task           | Removes the task; no soft-delete/restore documented         | Confirm exact id; never auto-delete         |
| DELETE recurring task | Stops all future instances of that recurrence               | Confirm before removing                     |
| Move task             | Re-homes the task to another workspace (loses project link) | Confirm destination workspace               |
| Unassign task         | Removes the assignee                                        | Confirm intent                              |
| Update task           | Overwrites fields (and must resend name/workspaceId)        | Echo the change before sending              |
| Create task/project   | Non-idempotent — re-run creates duplicates                  | Verify with a single GET, don't blind-retry |
| DELETE custom field   | Removes the field (and its values) workspace-wide           | Confirm before removing                     |

## Gotchas

1. **Update requires `name` + `workspaceId`** every time — a PATCH that omits them fails even though you're only changing one field.
2. **No idempotency keys** — create endpoints are non-idempotent. On a 429/5xx, verify with a GET before resending (don't duplicate).
3. **`status` is a string on write, an object on read** — send `"In Progress"`, receive `{"name":"In Progress",…}`.
4. **No project update/delete, no recurring-task update, no comment edit/delete** — those operations don't exist; don't attempt them.
5. **Custom fields are on `/beta/workspaces/{id}/custom-fields`** — pass an absolute URL so `/v1` isn't prepended.
6. **`description` casing differs by resource:** tasks take GFM markdown, projects/comments take HTML.
7. **Move is POST** per the index (PATCH on one page) — POST first, fall back to PATCH on 405.
8. **Every write counts against 12/min (individual)** — confirm, send once, verify; never hammer into a 429.
