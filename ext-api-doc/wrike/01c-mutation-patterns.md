---
api_name: Wrike
api_slug: wrike
base_url: https://{host}/api/v4 ({host} from OAuth token response; never hardcode www.wrike.com)
path_version_segment: /api/v4 (real path segment — v4 is path-versioned)
call_surface: HTTP POST/PUT/DELETE via `numa integrations request` (connector wrike). NOT file-browse, NOT MCP.
write_body_encoding: application/x-www-form-urlencoded (responses JSON); composite values (dates, project, arrays, customFields) are URL-encoded JSON INSIDE form params
companion_of: 01-llm-api-rules.md
doc: create / update / delete for tasks, folders/projects, comments, timelogs
confidence: DOCUMENTED (developers.wrike.com), not live-verified
scope_gate: connector is registered `wsReadOnly`. EVERY write here returns `403 not_allowed` until an admin re-registers the OAuth app with `Default,wsReadWrite` AND the user reconnects. Do not attempt a write unless confirmed widened — otherwise it's a guaranteed-403 wasted turn.
---

# Wrike — Mutation Patterns Reference

All writes are gated behind `wsReadWrite` (see `scope_gate` in frontmatter).

## Write Capabilities

| Operation               | Method     | Endpoint                         | Notes (all batch=1; all gated by wsReadWrite) |
| ----------------------- | ---------- | -------------------------------- | --------------------------------------------- |
| Create task             | POST       | `/api/v4/folders/{id}/tasks`     | form-encoded; `title` required                |
| Create subtask          | POST       | `/api/v4/folders/{id}/tasks`     | pass `superTasks=["…"]`                       |
| Update task             | PUT        | `/api/v4/tasks/{id}`             | partial; add/remove array deltas              |
| Delete task             | DELETE     | `/api/v4/tasks/{id}`             | soft delete → Recycle Bin                     |
| Create folder/project   | POST       | `/api/v4/folders/{id}/folders`   | `project={…}` makes it a project              |
| Update folder/project   | PUT        | `/api/v4/folders/{id}`           | partial                                       |
| Delete folder           | DELETE     | `/api/v4/folders/{id}`           | soft delete → Recycle Bin                     |
| Add comment             | POST       | `/api/v4/tasks/{id}/comments`    | `text` required; `plainText`                  |
| Update / delete comment | PUT/DELETE | `/api/v4/comments/{id}`          |                                               |
| Log time                | POST       | `/api/v4/tasks/{id}/timelogs`    | `hours`+`trackedDate` required                |
| Update / delete timelog | PUT/DELETE | `/api/v4/timelogs/{id}`          |                                               |
| State transition        | PUT        | update `status`/`customStatusId` | no dedicated transition endpoint              |
| **Bulk write**          | —          | —                                | **no batch endpoint — loop, one each**        |
| Attachment up/download  | —          | binary endpoints                 | `connect_request` is JSON-only                |

## Content-Type

Write bodies are `application/x-www-form-urlencoded`, NOT JSON (responses always JSON). Backend sets the header; you provide params. Composite values (`dates`, `project`, custom field values, arrays) are URL-encoded JSON inside form params. A JSON request body to a write endpoint fails.

## Pattern 1: Create a Task

```http
POST /api/v4/folders/IEAAALZ4I4AAAAB/tasks
Content-Type: application/x-www-form-urlencoded

title=Write the spec&description=<p>Draft v1</p>&importance=Normal&responsibles=["KUAAAAAA"]&followers=["KUAAAAAB"]&dates={"due":"2026-06-01"}
```

→ `{"kind":"tasks","data":[{"id":"IEAAALZ4KQAAAAAK","title":"Write the spec","status":"Active","importance":"Normal","responsibleIds":["KUAAAAAA"],"parentIds":["IEAAALZ4I4AAAAB"],"dates":{"type":"Planned","due":"2026-06-01"},"permalink":"https://www.wrike.com/open.htm?id=1234567"}]}`

Create-task params (subset):
| Param | Format | Notes |
| --- | --- | --- |
| `title` | string | **required** |
| `description` | string (HTML or plain) | HTML by default |
| `status` | enum | `Active`/`Completed`/`Deferred`/`Cancelled` |
| `importance` | enum | `High`/`Normal`/`Low` |
| `customStatus` | string (customStatusId) | discover via `/workflows` first |
| `dates` | JSON object | `{"start":"…","due":"…","duration":N,"type":"Planned"}` |
| `responsibles` | JSON array of quoted IDs | `["KUAAAAAA"]` |
| `followers` | JSON array of quoted IDs | watchers |
| `superTasks` | JSON array of quoted task IDs | makes the new task a SUBTASK of those |
| `customFields` | JSON array | `[{"id":"IEAB…","value":"X"}]` |

Server-set: `id`, `createdDate`, `updatedDate`, `authorIds`, `permalink`, and `parentIds` (the creating folder is added automatically).
**Idempotency:** POST is NOT idempotent — retrying creates a DUPLICATE (no title-uniqueness). Before re-POSTing after an ambiguous failure, `GET /api/v4/folders/{id}/tasks?title=<the title>` to check it didn't already land.

## Pattern 2: Update a Task (partial + add/remove deltas)

Only fields you send change. **Scalar fields** replace directly; **array fields** use add/remove DELTAS, not wholesale replacement.

```http
PUT /api/v4/tasks/IEAAALZ4KQAAAAAK
Content-Type: application/x-www-form-urlencoded

status=Completed&addResponsibles=["KUAAAAAB"]&removeResponsibles=["KUAAAAAA"]&addFollowers=["KUAAAAAC"]
```

Move a task between folders (N:M parents):

```http
PUT /api/v4/tasks/IEAAALZ4KQAAAAAK
Content-Type: application/x-www-form-urlencoded

addParents=["IEAAALZ4I5AAAAC"]&removeParents=["IEAAALZ4I4AAAAB"]
```

Add/remove delta params (each takes a JSON array of quoted IDs): Parents `addParents`/`removeParents`; Responsibles `addResponsibles`/`removeResponsibles`; Followers `addFollowers`/`removeFollowers`; Super tasks `addSuperTasks`/`removeSuperTasks`; Shareds `addShareds`/`removeShareds`. Scalar updates (`title`, `status`, `importance`, `customStatus`, `dates`, `description`) pass directly and replace the prior value.

Response: same `{"kind":"tasks","data":[{…updated task…}]}` shape. Setting `status=Completed` sets `completedDate` server-side.
**Idempotency:** PUT-by-id is idempotent for scalars; add/remove deltas are also safe to re-apply (adding an existing parent / removing an absent one is a no-op).

## Pattern 3: State Transition (no dedicated endpoint)

State lives in `status` / `customStatus` — PUT it.

```http
PUT /api/v4/tasks/IEAAALZ4KQAAAAAK
Content-Type: application/x-www-form-urlencoded

status=Completed
```

Move into a specific workflow column (discover the ID first):

```http
GET /api/v4/workflows
→ workflows[0].customStatuses = [{"id":"IEAAALZ4JMAAAAA","name":"In Review","group":"Active"}, …]

PUT /api/v4/tasks/IEAAALZ4KQAAAAAK
Content-Type: application/x-www-form-urlencoded

customStatus=IEAAALZ4JMAAAAA
```

Setting `customStatus` to a status whose `group` is `Completed` completes the task; the high-level `status` follows the group. Never guess a `customStatusId` — always discover via `/workflows`.

## Pattern 4: Create a Folder / Project

A folder becomes a **project** by attaching a `project` object.

```http
POST /api/v4/folders/IEAAALZ4I4AAAAB/folders          # plain folder
Content-Type: application/x-www-form-urlencoded

title=Sub-workstream&description=<p>…</p>
```

```http
POST /api/v4/folders/IEAAALZ4I4AAAAB/folders          # project (folder + project object)
Content-Type: application/x-www-form-urlencoded

title=Q4 Launch&project={"ownerIds":["KUAAAAAA"],"startDate":"2026-10-01","endDate":"2026-12-31","status":"Green"}&shareds=["KUAAAAAB"]
```

→ `{"kind":"folders","data":[{"id":"IEAAALZ4I6AAAAD","title":"Q4 Launch","scope":"WsFolder","project":{"status":"Green","ownerIds":["KUAAAAAA"]}}]}`

## Pattern 5: Add a Comment

```http
POST /api/v4/tasks/IEAAALZ4KQAAAAAK/comments
Content-Type: application/x-www-form-urlencoded

text=Looks good — shipping it.&plainText=true
```

→ `{"kind":"comments","data":[{"id":"IEAAALZ4JEAAAAA","authorId":"KUAAAAAA","text":"Looks good — shipping it.","taskId":"IEAAALZ4KQAAAAAK","createdDate":"2026-05-29T04:00:00Z"}]}`
`plainText=true` posts as plain (else `text` is treated as HTML). Also postable on folders: `POST /api/v4/folders/{id}/comments`. Not idempotent — a retry creates a second comment.

## Pattern 6: Log Time (Timelog)

```http
POST /api/v4/tasks/IEAAALZ4KQAAAAAK/timelogs
Content-Type: application/x-www-form-urlencoded

hours=1.5&trackedDate=2026-05-29&comment=Spec drafting&categoryId=IEAAALZ4JFAAAAA
```

→ `{"kind":"timelogs","data":[{"id":"IEAAALZ4JGAAAAA","taskId":"IEAAALZ4KQAAAAAK","userId":"KUAAAAAA","hours":1.5,"trackedDate":"2026-05-29","comment":"Spec drafting"}]}`
`hours` (decimal) + `trackedDate` (`YYYY-MM-DD`) **required**; `categoryId` optional/tenant-defined. Not idempotent — a retry double-logs.

## Pattern 7: Delete (soft, → Recycle Bin)

```http
DELETE /api/v4/tasks/IEAAALZ4KQAAAAAK
DELETE /api/v4/folders/IEAAALZ4I4AAAAB
DELETE /api/v4/comments/IEAAALZ4JEAAAAA
DELETE /api/v4/timelogs/IEAAALZ4JGAAAAA
```

Soft — entities go to the Recycle Bin, restorable in the Wrike UI. Deleting a folder moves it (and tasks living only in it) to the Recycle Bin. DELETE-by-id is idempotent (second delete → no-op / `resource_not_found`). Still destructive — confirm with the user (see Dangerous Operations).

## Field Validation Rules

| Entity  | Field          | Rule                                  | Error if violated                          |
| ------- | -------------- | ------------------------------------- | ------------------------------------------ |
| Task    | `title`        | required, non-empty (on create)       | `parameter_required`                       |
| Task    | `status`       | one of the 4 high-level enum values   | `invalid_parameter`                        |
| Task    | `importance`   | `High`/`Normal`/`Low`                 | `invalid_parameter`                        |
| Task    | `customStatus` | valid `customStatusId` (`/workflows`) | `invalid_parameter`                        |
| Task    | `dates`        | valid JSON object; dates `YYYY-MM-DD` | `invalid_parameter`                        |
| Folder  | `title`        | required on create                    | `parameter_required`                       |
| Comment | `text`         | required, non-empty                   | `parameter_required`                       |
| Timelog | `hours`        | required; decimal number              | `parameter_required` / `invalid_parameter` |
| Timelog | `trackedDate`  | required; `YYYY-MM-DD`                | `parameter_required` / `invalid_parameter` |
| any     | array param    | JSON array of quoted strings          | `invalid_parameter`                        |
| any     | ID             | valid opaque string for the account   | `resource_not_found`                       |

Wrike returns a flat `{error, errorDescription}` — no per-field `details` array. `errorDescription` names the offending parameter; show it verbatim.

## Server-Side Defaults

| Entity  | Field           | Default                                      | When              |
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

## Worked Examples

1. Minimum-viable create (only `title` required):
   `POST /api/v4/folders/IEAAALZ4I4AAAAB/tasks` body `title=Follow up with vendor`
   → `{"kind":"tasks","data":[{"id":"IEAAALZ4KTAAAAAN","title":"Follow up with vendor","status":"Active","importance":"Normal","parentIds":["IEAAALZ4I4AAAAB"]}]}`
   `status`/`importance`/`parentIds` default server-side; no assignee → unassigned.

2. Reassign and complete in one PUT:
   `PUT /api/v4/tasks/IEAAALZ4KQAAAAAK` body `status=Completed&addResponsibles=["KUAAAAAB"]&removeResponsibles=["KUAAAAAA"]`
   → `{"kind":"tasks","data":[{"id":"IEAAALZ4KQAAAAAK","status":"Completed","completedDate":"2026-05-29T05:00:00Z","responsibleIds":["KUAAAAAB"]}]}`
   Array fields use add/remove deltas; scalar `status` replaces directly; `completedDate` is server-set on completion.

3. Create a subtask under an existing task:
   `POST /api/v4/folders/IEAAALZ4I4AAAAB/tasks` body `title=Draft section 2&superTasks=["IEAAALZ4KQAAAAAK"]&responsibles=["KUAAAAAA"]`
   → `{"kind":"tasks","data":[{"id":"IEAAALZ4KUAAAAAO","title":"Draft section 2","status":"Active","superTaskIds":["IEAAALZ4KQAAAAAK"],"parentIds":["IEAAALZ4I4AAAAB"]}]}`
   `superTasks` makes it a subtask; it still needs a folder context in the path and still gets that folder as a `parentId`.

## Gotchas

1. **Read-only by default.** Under `wsReadOnly` every write 403s as `not_allowed` — the most likely cause of a write failure. Check the scope before blaming the body.
2. **Form-encoded, not JSON.** Outer body is `application/x-www-form-urlencoded`; composite values (`dates`, `project`, arrays, `customFields`) are URL-encoded JSON INSIDE form params. A JSON request body fails.
3. **Array params are quoted JSON arrays.** `responsibles=["KUAAAAAA"]`. Unquoted/bare-string forms 400.
4. **Updates use add/remove deltas for arrays.** Don't "set" `responsibleIds` wholesale on PUT — use `addResponsibles`/`removeResponsibles`. (`responsibles` on PUT may behave as replace on some fields, but the deltas are the documented, predictable path.)
5. **No bulk write.** No batch/composite endpoint. Loop one entity per request; respect 400 req/min; never spin a tight create loop.
6. **POST creates are NOT idempotent and titles aren't unique.** A retry duplicates. Search-by-title before re-POSTing.
7. **`customStatus` (write param) vs `customStatusId` (read field).** SET `customStatus=<id>` on writes; READ `customStatusId` on responses. Discover valid IDs via `/workflows`.
8. **Delete is soft but still destructive.** Confirm with the user; offer "mark Completed/Cancelled" as a non-destructive alternative.

## Dangerous Operations (confirm with the user before executing)

| Operation                         | Why dangerous                                                      | Safeguard                                                    |
| --------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| Delete task / folder              | Soft-delete to Recycle Bin; folder delete sweeps its tasks too     | Confirm; show what's removed; suggest Cancelled/Completed    |
| Remove a task's last parent       | Can move the task to the Recycle Bin (a task must live somewhere)  | `addParents` before `removeParents`; never strip all parents |
| Bulk-ish loops                    | No batch endpoint → many single writes can blow the 400/min budget | Cap the loop; warn the user; never unbounded                 |
| Reassign / status change at scale | Fires Wrike notifications/webhooks per task                        | Confirm the count before iterating                           |
