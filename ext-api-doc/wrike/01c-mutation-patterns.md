---
api_name: 'Wrike'
api_slug: 'wrike'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# Wrike -- Mutation Patterns Reference

> Create / update / delete for tasks, folders/projects, comments, timelogs.
> Companion to `01-llm-api-rules.md`. Confidence: DOCUMENTED, not yet live-verified.
>
> ⚠️ **SCOPE GATE:** the connector is currently registered with `wsReadOnly`. **Every write
> in this file returns `403 not_allowed` until an admin re-registers the OAuth app with
> `Default,wsReadWrite` and the user reconnects.** Do not attempt a write unless you have
> confirmation the scope was widened — otherwise you'll burn a turn on a guaranteed 403.

---

## Write Capabilities Summary

| Operation               | Supported | Method  | Endpoint                           | Max batch | Notes                                  |
| ----------------------- | --------- | ------- | ---------------------------------- | --------- | -------------------------------------- |
| Create task             | yes\*     | POST    | `/api/v4/folders/{id}/tasks`       | 1         | form-encoded; `title` required         |
| Create subtask          | yes\*     | POST    | `/api/v4/folders/{id}/tasks`       | 1         | pass `superTasks=["…"]`                |
| Update task             | yes\*     | PUT     | `/api/v4/tasks/{id}`               | 1         | partial; add/remove array deltas       |
| Delete task             | yes\*     | DELETE  | `/api/v4/tasks/{id}`               | 1         | soft delete → Recycle Bin              |
| Create folder/project   | yes\*     | POST    | `/api/v4/folders/{id}/folders`     | 1         | `project={…}` makes it a project       |
| Update folder/project   | yes\*     | PUT     | `/api/v4/folders/{id}`             | 1         | partial                                |
| Delete folder           | yes\*     | DELETE  | `/api/v4/folders/{id}`             | 1         | soft delete → Recycle Bin              |
| Add comment             | yes\*     | POST    | `/api/v4/tasks/{id}/comments`      | 1         | `text` required; `plainText`           |
| Update / delete comment | yes\*     | PUT/DEL | `/api/v4/comments/{id}`            | 1         |                                        |
| Log time                | yes\*     | POST    | `/api/v4/tasks/{id}/timelogs`      | 1         | `hours` + `trackedDate` required       |
| Update / delete timelog | yes\*     | PUT/DEL | `/api/v4/timelogs/{id}`            | 1         |                                        |
| State transition        | implicit  | PUT     | update `status` / `customStatusId` | 1         | no dedicated transition endpoint       |
| **Bulk write**          | **no**    | —       | —                                  | —         | **no batch endpoint — loop, one each** |
| Attachment up/download  | no (chat) | —       | binary endpoints                   | —         | `connect_request` is JSON-only         |

\* Gated behind `wsReadWrite` — see the SCOPE GATE banner above.

---

## Content-Type

Write bodies are **`application/x-www-form-urlencoded`**, NOT JSON. Responses are always JSON. The backend sets the header; you provide the params. Composite values (`dates`, `project`, custom field values, arrays) are passed as **URL-encoded JSON** inside form params.

---

## Common Patterns

### Pattern 1: Create a Task

```http
POST /api/v4/folders/IEAAALZ4I4AAAAB/tasks
Content-Type: application/x-www-form-urlencoded

title=Write the spec&description=<p>Draft v1</p>&importance=Normal&responsibles=["KUAAAAAA"]&followers=["KUAAAAAB"]&dates={"due":"2026-06-01"}
```

**Response (200):**

```json
{
  "kind": "tasks",
  "data": [
    {
      "id": "IEAAALZ4KQAAAAAK",
      "title": "Write the spec",
      "status": "Active",
      "importance": "Normal",
      "responsibleIds": ["KUAAAAAA"],
      "parentIds": ["IEAAALZ4I4AAAAB"],
      "dates": { "type": "Planned", "due": "2026-06-01" },
      "permalink": "https://www.wrike.com/open.htm?id=1234567"
    }
  ]
}
```

**Create-task params (subset):**

| Param          | Format                        | Notes                                                   |
| -------------- | ----------------------------- | ------------------------------------------------------- |
| `title`        | string                        | **required**                                            |
| `description`  | string (HTML or plain)        | HTML by default                                         |
| `status`       | enum                          | `Active`/`Completed`/`Deferred`/`Cancelled`             |
| `importance`   | enum                          | `High`/`Normal`/`Low`                                   |
| `customStatus` | string (customStatusId)       | Discover via `/workflows` first                         |
| `dates`        | JSON object                   | `{"start":"…","due":"…","duration":N,"type":"Planned"}` |
| `responsibles` | JSON array of quoted IDs      | `["KUAAAAAA"]`                                          |
| `followers`    | JSON array of quoted IDs      | watchers                                                |
| `superTasks`   | JSON array of quoted task IDs | makes the new task a SUBTASK of those                   |
| `customFields` | JSON array                    | `[{"id":"IEAB…","value":"X"}]`                          |

**Server-set fields:** `id`, `createdDate`, `updatedDate`, `authorIds`, `permalink`, and `parentIds` (the creating folder is added automatically).

**Idempotency:** POST is NOT idempotent — retrying creates a DUPLICATE task (no title-uniqueness). Before re-POSTing after an ambiguous failure, `GET /api/v4/folders/{id}/tasks?title=<the title>` to check it didn't already land.

---

### Pattern 2: Update a Task (partial + add/remove deltas)

Only the fields you send change. **Scalar fields** are replaced directly; **array fields** use add/remove DELTAS, not wholesale replacement.

**Change status + reassign + add a watcher:**

```http
PUT /api/v4/tasks/IEAAALZ4KQAAAAAK
Content-Type: application/x-www-form-urlencoded

status=Completed&addResponsibles=["KUAAAAAB"]&removeResponsibles=["KUAAAAAA"]&addFollowers=["KUAAAAAC"]
```

**Move a task between folders (N:M parents):**

```http
PUT /api/v4/tasks/IEAAALZ4KQAAAAAK
Content-Type: application/x-www-form-urlencoded

addParents=["IEAAALZ4I5AAAAC"]&removeParents=["IEAAALZ4I4AAAAB"]
```

**Add/remove delta params:**

| Field        | Add               | Remove               |
| ------------ | ----------------- | -------------------- |
| Parents      | `addParents`      | `removeParents`      |
| Responsibles | `addResponsibles` | `removeResponsibles` |
| Followers    | `addFollowers`    | `removeFollowers`    |
| Super tasks  | `addSuperTasks`   | `removeSuperTasks`   |
| Shareds      | `addShareds`      | `removeShareds`      |

Each takes a JSON array of quoted IDs. Scalar updates (`title`, `status`, `importance`, `customStatus`, `dates`, `description`) are passed directly and replace the prior value.

**Response (200):** same `{ "kind": "tasks", "data": [ { …updated task… } ] }` shape. Setting `status=Completed` sets `completedDate` server-side.

**Idempotency:** PUT-by-id IS idempotent for scalar fields (re-applying the same body yields the same state). Add/remove deltas are also safe to re-apply — adding an existing parent / removing an absent one is a no-op.

---

### Pattern 3: State Transition (no dedicated endpoint)

Wrike has no "transition" endpoint — state lives in `status` / `customStatusId`, which you PUT.

**High-level complete:**

```http
PUT /api/v4/tasks/IEAAALZ4KQAAAAAK
Content-Type: application/x-www-form-urlencoded

status=Completed
```

**Move into a specific workflow column (discover the ID first):**

```http
GET  /api/v4/workflows
→ workflows[0].customStatuses = [ { "id":"IEAAALZ4JMAAAAA","name":"In Review","group":"Active" }, … ]

PUT /api/v4/tasks/IEAAALZ4KQAAAAAK
Content-Type: application/x-www-form-urlencoded

customStatus=IEAAALZ4JMAAAAA
```

Setting `customStatus` to a status whose `group` is `Completed` completes the task; the high-level `status` follows the group. Never guess a `customStatusId` — always discover via `/workflows`.

---

### Pattern 4: Create a Folder / Project

A folder becomes a **project** by attaching a `project` object.

**Plain folder:**

```http
POST /api/v4/folders/IEAAALZ4I4AAAAB/folders
Content-Type: application/x-www-form-urlencoded

title=Sub-workstream&description=<p>…</p>
```

**Project (folder + project object):**

```http
POST /api/v4/folders/IEAAALZ4I4AAAAB/folders
Content-Type: application/x-www-form-urlencoded

title=Q4 Launch&project={"ownerIds":["KUAAAAAA"],"startDate":"2026-10-01","endDate":"2026-12-31","status":"Green"}&shareds=["KUAAAAAB"]
```

**Response (200):**

```json
{
  "kind": "folders",
  "data": [
    {
      "id": "IEAAALZ4I6AAAAD",
      "title": "Q4 Launch",
      "scope": "WsFolder",
      "project": { "status": "Green", "ownerIds": ["KUAAAAAA"] }
    }
  ]
}
```

---

### Pattern 5: Add a Comment

```http
POST /api/v4/tasks/IEAAALZ4KQAAAAAK/comments
Content-Type: application/x-www-form-urlencoded

text=Looks good — shipping it.&plainText=true
```

**Response (200):**

```json
{
  "kind": "comments",
  "data": [
    {
      "id": "IEAAALZ4JEAAAAA",
      "authorId": "KUAAAAAA",
      "text": "Looks good — shipping it.",
      "taskId": "IEAAALZ4KQAAAAAK",
      "createdDate": "2026-05-29T04:00:00Z"
    }
  ]
}
```

- `plainText=true` posts the text as plain (otherwise `text` is treated as HTML).
- Comments can also be posted on folders: `POST /api/v4/folders/{id}/comments`.
- Not idempotent — a retried POST creates a second comment.

---

### Pattern 6: Log Time (Timelog)

```http
POST /api/v4/tasks/IEAAALZ4KQAAAAAK/timelogs
Content-Type: application/x-www-form-urlencoded

hours=1.5&trackedDate=2026-05-29&comment=Spec drafting&categoryId=IEAAALZ4JFAAAAA
```

**Response (200):**

```json
{
  "kind": "timelogs",
  "data": [
    {
      "id": "IEAAALZ4JGAAAAA",
      "taskId": "IEAAALZ4KQAAAAAK",
      "userId": "KUAAAAAA",
      "hours": 1.5,
      "trackedDate": "2026-05-29",
      "comment": "Spec drafting"
    }
  ]
}
```

- `hours` (decimal) and `trackedDate` (`YYYY-MM-DD`) are **required**.
- `categoryId` is optional and tenant-defined.
- Not idempotent — a retried POST double-logs the time.

---

### Pattern 7: Delete (soft, → Recycle Bin)

```http
DELETE /api/v4/tasks/IEAAALZ4KQAAAAAK
DELETE /api/v4/folders/IEAAALZ4I4AAAAB
DELETE /api/v4/comments/IEAAALZ4JEAAAAA
DELETE /api/v4/timelogs/IEAAALZ4JGAAAAA
```

- Deletes are **soft** — entities go to the Recycle Bin and can be restored from the Wrike UI.
- Deleting a folder moves it (and tasks living only in it) to the Recycle Bin.
- DELETE-by-id is idempotent — a second delete is a no-op / `resource_not_found`.
- **Still destructive — confirm with the user before deleting** (see Dangerous Operations).

---

## Field Validation Rules

| Entity  | Field          | Rule                                            | Error if violated                          |
| ------- | -------------- | ----------------------------------------------- | ------------------------------------------ |
| Task    | `title`        | required, non-empty (on create)                 | `parameter_required`                       |
| Task    | `status`       | one of the 4 high-level enum values             | `invalid_parameter`                        |
| Task    | `importance`   | `High`/`Normal`/`Low`                           | `invalid_parameter`                        |
| Task    | `customStatus` | must be a valid `customStatusId` (`/workflows`) | `invalid_parameter`                        |
| Task    | `dates`        | valid JSON object; dates `YYYY-MM-DD`           | `invalid_parameter`                        |
| Folder  | `title`        | required on create                              | `parameter_required`                       |
| Comment | `text`         | required, non-empty                             | `parameter_required`                       |
| Timelog | `hours`        | required; decimal number                        | `parameter_required` / `invalid_parameter` |
| Timelog | `trackedDate`  | required; `YYYY-MM-DD`                          | `parameter_required` / `invalid_parameter` |
| any     | array param    | JSON array of quoted strings                    | `invalid_parameter`                        |
| any     | ID             | valid opaque string for the account             | `resource_not_found`                       |

Wrike returns a **flat** `{error, errorDescription}` — there is no per-field `details` array. The `errorDescription` names the offending parameter. Show it to the user verbatim.

---

## Server-Side Defaults

| Entity  | Field           | Default                                      | When applied      |
| ------- | --------------- | -------------------------------------------- | ----------------- |
| any     | `id`            | auto-generated opaque string                 | create            |
| any     | `createdDate`   | current UTC timestamp                        | create            |
| any     | `updatedDate`   | current UTC timestamp                        | create, update    |
| any     | `authorIds`     | creating user                                | create            |
| Task    | `status`        | `Active`                                     | create (if unset) |
| Task    | `importance`    | `Normal`                                     | create (if unset) |
| Task    | `parentIds`     | the creating folder                          | create            |
| Task    | `completedDate` | set when status→Completed; cleared on reopen | transition        |
| Project | `status`        | `Green`                                      | create (if unset) |

---

## Worked Examples

### Example 1: Create a task with the minimum viable body

```http
POST /api/v4/folders/IEAAALZ4I4AAAAB/tasks
Content-Type: application/x-www-form-urlencoded

title=Follow up with vendor
```

```json
{
  "kind": "tasks",
  "data": [
    {
      "id": "IEAAALZ4KTAAAAAN",
      "title": "Follow up with vendor",
      "status": "Active",
      "importance": "Normal",
      "parentIds": ["IEAAALZ4I4AAAAB"]
    }
  ]
}
```

**Notes:** only `title` is required; `status`/`importance`/`parentIds` default server-side. No assignee → unassigned.

### Example 2: Reassign and complete a task in one PUT

```http
PUT /api/v4/tasks/IEAAALZ4KQAAAAAK
Content-Type: application/x-www-form-urlencoded

status=Completed&addResponsibles=["KUAAAAAB"]&removeResponsibles=["KUAAAAAA"]
```

```json
{
  "kind": "tasks",
  "data": [
    {
      "id": "IEAAALZ4KQAAAAAK",
      "status": "Completed",
      "completedDate": "2026-05-29T05:00:00Z",
      "responsibleIds": ["KUAAAAAB"]
    }
  ]
}
```

**Notes:** array fields use add/remove deltas; scalar `status` replaces directly; `completedDate` is server-set on completion.

### Example 3: Create a subtask under an existing task

```http
POST /api/v4/folders/IEAAALZ4I4AAAAB/tasks
Content-Type: application/x-www-form-urlencoded

title=Draft section 2&superTasks=["IEAAALZ4KQAAAAAK"]&responsibles=["KUAAAAAA"]
```

```json
{
  "kind": "tasks",
  "data": [
    {
      "id": "IEAAALZ4KUAAAAAO",
      "title": "Draft section 2",
      "status": "Active",
      "superTaskIds": ["IEAAALZ4KQAAAAAK"],
      "parentIds": ["IEAAALZ4I4AAAAB"]
    }
  ]
}
```

**Notes:** `superTasks` makes the new task a subtask. It still needs a folder context in the path, and still gets that folder as a `parentId`.

---

## Gotchas & Counter-Exceptions

1. **Read-only by default.** Under `wsReadOnly` every write 403s as `not_allowed`. This is the most likely cause of a write failure — check the scope before blaming the body.
2. **Form-encoded, not JSON.** The outer body is `application/x-www-form-urlencoded`. Composite values (`dates`, `project`, arrays, `customFields`) are URL-encoded JSON INSIDE form params. Sending a JSON request body fails.
3. **Array params are quoted JSON arrays.** `responsibles=["KUAAAAAA"]`. Unquoted or bare-string forms 400.
4. **Updates use add/remove deltas for arrays.** Don't try to "set" `responsibleIds` wholesale on PUT — use `addResponsibles`/`removeResponsibles`. (`responsibles` on PUT may behave as replace on some fields, but the deltas are the documented, predictable path.)
5. **No bulk write.** There is no batch/composite endpoint. Loop one entity per request; respect 400 req/min; never spin a tight create loop.
6. **POST creates are NOT idempotent and titles aren't unique.** A retried create duplicates. Search-by-title before re-POSTing.
7. **`customStatus` (create/update param) vs `customStatusId` (read field).** You SET `customStatus=<id>` on writes; you READ `customStatusId` on responses. Discover valid IDs via `/workflows`.
8. **Delete is soft but still destructive.** Confirm with the user; offer "mark Completed/Cancelled" as a non-destructive alternative.

---

## Dangerous Operations

> Confirm with the user before executing.

| Operation                         | Why dangerous                                                      | Safeguard                                                        |
| --------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Delete task / folder              | Soft-delete to Recycle Bin; folder delete sweeps its tasks too     | Confirm; show what will be removed; suggest Cancelled/Completed  |
| Remove a task's last parent       | Can move the task to the Recycle Bin (a task must live somewhere)  | Use `addParents` before `removeParents`; never strip all parents |
| Bulk-ish loops                    | No batch endpoint → many single writes can blow the 400/min budget | Cap the loop; warn the user; never unbounded                     |
| Reassign / status change at scale | Fires Wrike notifications/webhooks for each task                   | Confirm the count before iterating                               |

---

_Generated from `00-api-investigation-questionnaire.md` Phases 3 and 4._
