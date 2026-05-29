---
api_name: 'Wrike'
api_slug: 'wrike'
version: 'v4'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
line_count_target: '< 300 lines'
---

# Wrike -- Workspace Agent API Rules

> Loaded into the workspace agent's context when the Wrike integration is active.
> Companion files (01a–01d) carry the detailed reference. Keep this one ≤300 lines.
> Confidence: DOCUMENTED against developers.wrike.com — NOT yet verified by a live call.

## Context

- **API:** Wrike API v4 (REST, JSON responses; write bodies are form-encoded).
- **Base URL (region-resolved at RUNTIME):** `https://<host>/api/v4` where `<host>` is the `host` field from the OAuth token response (e.g. `www.wrike.com` for US, `app-eu.wrike.com` for EU). **NEVER hardcode `www.wrike.com`.** The backend stores the host at connect time; you call relative paths (`/tasks`, `/folders/{id}/tasks`) via `connect_request`.
- **Auth host (global, all regions):** `login.wrike.com` — only the API host is region-pinned, not the OAuth endpoints.
- **Integration path:** Direct API Only — every interaction goes through `connect_request`. No Files > Remote surface.
- **Rate limit:** 400 requests/min per access token (per user); 5000/min per IP. No reliable rate-limit headers — you learn the limit by getting a 429.

## Auth Structure

OAuth 2.0 (authorization_code + refresh_token), bearer header.

```
Authorization: bearer {access_token}
```

Standard `bearer` scheme (lowercase or `Bearer` both accepted). The backend injects this — you don't build it.

**Token lifecycle:**

- Access token lives 1 hour (`expires_in: 3600`). Backend refreshes automatically via `login.wrike.com/oauth2/token`.
- **Refresh tokens ROTATE.** Every refresh returns a NEW access_token AND a NEW refresh_token, invalidating the previous pair. The backend persists the new one. (You don't manage this, but it's why a stale/duplicated connection breaks — if calls 401 repeatedly after a refresh, the user must reconnect.)
- On `401 not_authorized`: backend refreshes and retries once. Second 401 → fail the tool call, tell the user to reconnect.

## Capabilities

### CAN

1. List / search / get **tasks**, **folders/projects**, **comments**, **timelogs**, **contacts**, **spaces** (read — works under the current `wsReadOnly` scope).
2. Filter tasks by status / importance / assignee / date-range and sort; paginate with `pageSize` + `nextPageToken`.
3. Resolve "me" via `GET /contacts?me=true`, then answer "my tasks" with `?responsibles=["<myId>"]`.
4. Read folder/project tree (`GET /folders`), drill into a project's tasks (`GET /folders/{id}/tasks`).
5. Discover valid workflow custom statuses via `GET /workflows` before ever setting a `customStatusId`.
6. **(only after scope is widened to `Default,wsReadWrite`)** Create tasks under a folder, update task title/status/dates/assignees, post comments, log time. See "Scope gate" below.

### CANNOT

1. **Write anything under the current `wsReadOnly` scope.** Every create/update/delete/comment/timelog returns `403 not_allowed` until an admin re-registers the OAuth app with `Default,wsReadWrite` and the user reconnects. Treat Wrike as READ-ONLY unless you have confirmation the scope was widened.
2. Upload / download attachments — `connect_request` sends/receives JSON, not binary streams. Ask the user to do it in the Wrike UI.
3. Bulk create / update / delete — **there is no batch-write endpoint.** Loop one entity per request and respect 400 req/min. Bulk _read_ by comma-separated IDs is fine.
4. Register webhooks on the user's behalf — needs a Numa-hosted public receiver + `X-Hook-Secret` handshake we don't expose from chat. Use polling instead.
5. Full-text search of task bodies / comments — only `title` substring match is exposed.

## Critical Gotchas

> Things that will cause errors if you get them wrong.

1. **Host comes from the token, not a constant.** All paths resolve against `https://<host>/api/v4`. The backend handles this when you pass relative paths — never write an absolute `www.wrike.com` URL into a request.
2. **IDs are opaque alphanumeric strings, NOT numbers.** e.g. `"IEAAALZ4KQAAAAAK"` (tasks/folders), `"KUAAAAAA"` (contacts). Never coerce to int; never assume ordering.
3. **A "Project" is a Folder with a `project` sub-object** — same `/folders` endpoint family. To list only projects: `GET /folders?project=true`.
4. **A Task's `parentIds` is N:M** — one task can live in multiple folders. Removing its last parent moves it to the Recycle Bin (a task must live somewhere).
5. **Array query/body params are JSON arrays of quoted strings:** `responsibles=["KUAAAAAA"]`, `parents=["IEAAALZ4I4AAAAB"]`. Bare `[KUAAAAAA]` (unquoted) is rejected as `invalid_parameter`.
6. **Date-range filters are URL-encoded JSON objects:** `updatedDate={"start":"2026-05-01T00:00:00Z","end":"2026-05-31T23:59:59Z"}`. The `dates` write param is also a JSON object: `dates={"due":"2026-06-01"}`.
7. **`fields` is opt-in, not trimming.** `?fields=["description","subTaskIds"]` ADDS expensive optional fields. Default responses omit them. Only request what you need.
8. **Updates use add/remove DELTAS for array fields**, not replacement: `addParents`/`removeParents`, `addResponsibles`/`removeResponsibles`, `addFollowers`/`removeFollowers`. Sending `responsibles=[...]` on PUT is for create-style replacement only on some fields — prefer the deltas.
9. **`customStatusId` ≠ the high-level `status` enum.** To move a task into a specific workflow column, set `customStatusId` (discover valid IDs via `/workflows`). The high-level `status` (`Active`/`Completed`/…) follows the custom status's group.
10. **Account-level `GET /comments` caps `createdDate` range at ≤7 days.** Wider ranges return `invalid_parameter`. Scope to a task/folder instead for older comments.
11. **POST create is NOT idempotent.** A retried create makes a duplicate task/comment/timelog. Before re-POSTing after an ambiguous failure, search by `title` (tasks) to check it didn't already land.

## Default Parameters

Use these defaults unless the user specifies otherwise:

| Parameter               | Default                | Reason                                                     |
| ----------------------- | ---------------------- | ---------------------------------------------------------- |
| `pageSize`              | `1000` (tasks/folders) | API max — minimise round-trips against the 400/min budget. |
| `sortField`/`sortOrder` | `UpdatedDate` / `Desc` | Freshest-first matches user expectation.                   |
| `plainText` (comments)  | `true`                 | LLM wants plain text, not Wrike's HTML.                    |
| `fields`                | omit                   | Extra fields are expensive opt-ins; add only when needed.  |
| scope                   | from token `host`      | Build base URL from token host; NEVER hardcode.            |

## Working Examples

### Example 1: Identity smoke test (first call after connect)

```http
GET /api/v4/contacts?me=true
```

```json
{
  "kind": "contacts",
  "data": [
    {
      "id": "KUAAAAAA",
      "firstName": "Jane",
      "lastName": "Smith",
      "type": "Person",
      "profiles": [{ "accountId": "IEAAAAAA", "email": "jane@example.com", "role": "User", "admin": true }],
      "timezone": "Pacific/Auckland",
      "me": true,
      "primaryEmail": "jane@example.com"
    }
  ]
}
```

Cache `data[0].id` — it's the `<myId>` for "my tasks" queries.

### Example 2: My active tasks, freshest first

```http
GET /api/v4/tasks?status=Active&responsibles=["KUAAAAAA"]&sortField=UpdatedDate&sortOrder=Desc&pageSize=1000
```

```json
{
  "kind": "tasks",
  "responseSize": 12,
  "data": [
    {
      "id": "IEAAALZ4KQAAAAAK",
      "accountId": "IEAAALZ4",
      "title": "Write the spec",
      "status": "Active",
      "importance": "Normal",
      "createdDate": "2026-05-29T01:00:00Z",
      "updatedDate": "2026-05-29T02:00:00Z",
      "dates": { "type": "Planned", "due": "2026-06-01" },
      "customStatusId": "IEAAALZ4JMAAAAA",
      "permalink": "https://www.wrike.com/open.htm?id=1234567",
      "responsibleIds": ["KUAAAAAA"],
      "parentIds": ["IEAAALZ4I4AAAAB"]
    }
  ]
}
```

No `nextPageToken` field → this is the last (only) page.

### Example 3: List projects with their status

```http
GET /api/v4/folders?project=true
```

```json
{
  "kind": "folders",
  "data": [
    {
      "id": "IEAAALZ4I4AAAAB",
      "title": "Q3 Launch",
      "childIds": ["IEAAALZ4I5AAAAC"],
      "scope": "WsFolder",
      "project": { "ownerIds": ["KUAAAAAA"], "status": "Green", "startDate": "2026-06-01", "endDate": "2026-08-31" },
      "permalink": "https://www.wrike.com/open.htm?id=2345678"
    }
  ]
}
```

### Example 4: Create a task (requires `wsReadWrite`)

```http
POST /api/v4/folders/IEAAALZ4I4AAAAB/tasks
Content-Type: application/x-www-form-urlencoded

title=Write the spec&description=<p>Draft v1</p>&importance=Normal&responsibles=["KUAAAAAA"]&dates={"due":"2026-06-01"}
```

```json
{ "kind": "tasks", "data": [{ "id": "IEAAALZ4KQAAAAAK", "title": "Write the spec", "status": "Active" }] }
```

> Under `wsReadOnly` this returns `403 not_allowed` — do NOT attempt writes until the scope is widened.

### Example 5: Complete a task (update by id, requires `wsReadWrite`)

```http
PUT /api/v4/tasks/IEAAALZ4KQAAAAAK
Content-Type: application/x-www-form-urlencoded

status=Completed
```

```json
{
  "kind": "tasks",
  "data": [{ "id": "IEAAALZ4KQAAAAAK", "status": "Completed", "completedDate": "2026-05-29T03:00:00Z" }]
}
```

## Proxy API Operations

| Operation           | Method | Path                          | Key params                                                                                          | Notes                              |
| ------------------- | ------ | ----------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Current user        | GET    | `/api/v4/contacts?me=true`    | —                                                                                                   | Identity smoke test                |
| List contacts       | GET    | `/api/v4/contacts`            | `me`, ids in path                                                                                   | Users & groups                     |
| List spaces         | GET    | `/api/v4/spaces`              | —                                                                                                   | Top-level homes                    |
| Folder/project tree | GET    | `/api/v4/folders`             | `project`, `descendants`, `permalink`, `deleted`                                                    | Tree vs filtered mode              |
| Tasks in a folder   | GET    | `/api/v4/folders/{id}/tasks`  | same filters as `/tasks`                                                                            | Preferred when scoped to a project |
| Search tasks        | GET    | `/api/v4/tasks`               | `status`, `importance`, `responsibles`, `*Date`, `fields`, `pageSize`, `nextPageToken`, `sortField` | Account-wide                       |
| Get task(s) by id   | GET    | `/api/v4/tasks/{id1,id2}`     | `fields`                                                                                            | CSV ids = bulk read                |
| Create task         | POST   | `/api/v4/folders/{id}/tasks`  | `title`(req), `dates`, `responsibles`, `importance`                                                 | form-encoded; needs `wsReadWrite`  |
| Update task         | PUT    | `/api/v4/tasks/{id}`          | `status`, `customStatusId`, `add/removeParents`, etc.                                               | add/remove deltas                  |
| Delete task         | DELETE | `/api/v4/tasks/{id}`          | —                                                                                                   | Soft delete → Recycle Bin          |
| Comments on a task  | GET    | `/api/v4/tasks/{id}/comments` | `plainText`                                                                                         | `?plainText=true`                  |
| Add comment         | POST   | `/api/v4/tasks/{id}/comments` | `text`(req), `plainText`                                                                            | needs `wsReadWrite`                |
| Timelogs on a task  | GET    | `/api/v4/tasks/{id}/timelogs` | —                                                                                                   |                                    |
| Log time            | POST   | `/api/v4/tasks/{id}/timelogs` | `hours`(req), `trackedDate`(req), `comment`                                                         | needs `wsReadWrite`                |
| List workflows      | GET    | `/api/v4/workflows`           | —                                                                                                   | Discover `customStatusId` values   |
| List custom fields  | GET    | `/api/v4/customfields`        | —                                                                                                   | Discover custom field IDs          |

## Pagination

- **Type:** cursor — `pageSize` + `nextPageToken`, BOTH returned **in the JSON response body**.
- **Default page size:** unbounded for small lists; supply `pageSize` to opt into paging on `/tasks` and `/folders`.
- **Max page size:** `1000`.
- **How to paginate:** re-send the SAME filter params on every page plus the token.

```http
GET /api/v4/tasks?status=Active&pageSize=1000
→ body has "nextPageToken":"eyJ...A"

GET /api/v4/tasks?status=Active&pageSize=1000&nextPageToken=eyJ...A
→ body has "nextPageToken":"eyJ...B"   (filters MUST be repeated)

GET /api/v4/tasks?status=Active&pageSize=1000&nextPageToken=eyJ...B
→ no nextPageToken → stop
```

- **Last page detection:** `nextPageToken` absent. **Belt-and-braces:** a known Wrike quirk can return a `nextPageToken` even when `data` is `[]` — also stop if `data` is empty or the token didn't change.
- `responseSize` = total item count (includes hidden items), present on `/tasks`.

## Webhooks / Events

Wrike HAS a Webhooks API (HMAC-signed, with an `X-Hook-Secret` handshake), but **Numa does not expose a webhook receiver for this connector.** Real-time is not wired — use polling:

```http
GET /api/v4/tasks?updatedDate={"start":"<last_poll_iso>"}&sortField=UpdatedDate&sortOrder=Desc&pageSize=1000
```

Recommended interval: 5–15 minutes (never sub-minute on a busy account — 400 req/min budget). Change-detection field: `updatedDate`.

## Error Handling

**Standard error format (flat — no per-field `details` array, unlike Zoho):**

```json
{ "error": "invalid_parameter", "errorDescription": "Request parameter name or value is invalid" }
```

Show the user the `errorDescription` verbatim — it names the offending parameter.

**Recovery by status:**

| Status | Meaning                                                        | Action                                                              |
| ------ | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| 400    | `invalid_parameter` / `parameter_required` / `invalid_request` | Fix per `errorDescription` (bad array literal, bad date JSON)       |
| 401    | `not_authorized`                                               | Backend refreshes once; if re-raised, user must reconnect           |
| 403    | `not_allowed` (license/scope) / `access_forbidden` (sharing)   | `not_allowed` on a write = scope is `wsReadOnly`; widen + reconnect |
| 404    | `resource_not_found` / `method_not_found`                      | Verify the opaque ID (string!) or the path                          |
| 409    | (rare; concurrent edit)                                        | Re-fetch, compare `updatedDate`, re-apply — last-write-wins         |
| 429    | `rate_limit_exceeded` / `too_many_requests`                    | Honour `Retry-After` if present; else exp. backoff base 2s cap 60s  |
| 5xx    | `server_error` / gateway                                       | Retry with exponential backoff + jitter                             |

## Known Limitations

1. **Read-only until scope widened.** Current registry scope is `wsReadOnly`. All write capabilities are documented but gated behind `Default,wsReadWrite`.
2. No bulk write — single-entity creates/updates/deletes only; loop with rate-limit awareness.
3. No attachment up/download from chat (JSON-only request path).
4. No full-text search — `title` substring only.
5. No reliable rate-limit headers — discover the limit via 429, back off, retry.
6. Refresh tokens rotate — a stuck connection after refresh means reconnect, not retry.

---

_Companions:_

- _01a-domain-model-reference.md — Folder/Project, Task, Comment, Timelog, Contact + the N:M task↔folder relationship, state machines_
- _01b-query-patterns.md — filters, date-range JSON params, `fields`, `pageSize`/`nextPageToken` pagination_
- _01c-mutation-patterns.md — create task / update task (add/remove deltas) / comment / timelog; `wsReadWrite` gate_
- _01d-event-and-error-handling.md — Webhooks (handshake + HMAC + suspension), polling, error model, rate limits, backoff_
