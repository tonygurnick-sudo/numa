---
api_name: Wrike
api_slug: wrike
base_url: https://{host}/api/v4
path_version_segment: /api/v4 (REAL path segment — v4 is path-versioned; ALWAYS in the path)
host_resolution: '{host} = the `host` field from the OAuth token response (e.g. www.wrike.com US, app-eu.wrike.com EU). Region-pinned. NEVER hardcode www.wrike.com. Backend stores it; you pass relative paths.'
call_surface: HTTP via `numa integrations request` (connector wrike; method, url=relative path, body). Backend handler connect_request injects auth + host. NOT a file-browse connector (no list-files/search-files/download-file). NOT MCP.
auth: OAuth2 (authorization_code + rotating refresh_token); `Authorization: Bearer {token}` injected by backend — never build it
write_body_encoding: application/x-www-form-urlencoded (responses are JSON); composite values (dates, project, arrays, customFields) are URL-encoded JSON INSIDE form params
field_casing: camelCase
id_format: opaque alphanumeric string (e.g. IEAAALZ4KQAAAAAK tasks/folders, KUAAAAAA contacts) — NOT numeric, never coerce to int, never assume ordering
scope: wsReadOnly (read-only) — every write 403s `not_allowed` until widened to `Default,wsReadWrite` + user reconnects
rate_limit: 400 req/min per access token (per user); 5000 req/min per IP. No reliable rate-limit headers — learn the limit via 429
line_count_target: '< 300 lines (this file is loaded into live agent context)'
confidence: DOCUMENTED against developers.wrike.com; NOT yet live-verified
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# Wrike — API Rules

## Paths (read first)

- Pass paths WITH the `/api/v4` prefix: `/api/v4/tasks`, `/api/v4/folders/{id}/tasks`. **`/api/v4` is a real path segment — v4 is path-versioned, always present.** (Inverse of connectors where the version is only a label.)
- Host resolves at runtime from the token's `host` field → `https://{host}/api/v4/...`. Pass relative paths; the backend prepends `https://{host}`. NEVER write an absolute `www.wrike.com` URL.
- Call via `numa integrations request` (connector `wrike`). NOT a file connector.

## Auth

- `Authorization: Bearer {access_token}` injected by backend (`bearer`/`Bearer` both accepted). You never build it.
- Access token 1h. Backend refreshes via `login.wrike.com/oauth2/token` (global host, all regions).
- **Refresh tokens ROTATE:** each refresh returns a NEW access_token + NEW refresh_token, invalidating the prior pair. Backend persists it. On `401 not_authorized`: backend refreshes + retries once; a second 401 → fail, tell user to reconnect.

## CAN

Read (works under `wsReadOnly`): list/search/get tasks, folders/projects, comments, timelogs, contacts, spaces. Filter tasks by status/importance/assignee/date-range + sort; paginate `pageSize`+`nextPageToken`. Resolve "me" via `GET /api/v4/contacts?me=true` then `?responsibles=["<myId>"]`. Read folder tree (`GET /api/v4/folders`), drill into a project (`GET /api/v4/folders/{id}/tasks`). Discover workflow statuses via `GET /api/v4/workflows` before setting `customStatus`. **Only after scope widened to `Default,wsReadWrite`:** create tasks, update title/status/dates/assignees, post comments, log time.

## CANNOT

- **Write anything under `wsReadOnly`** — every create/update/delete/comment/timelog returns `403 not_allowed` until admin re-registers the OAuth app with `Default,wsReadWrite` and the user reconnects. Treat as READ-ONLY unless confirmed widened.
- Upload/download attachments — request path is JSON, not binary. Ask the user to do it in the Wrike UI.
- Bulk create/update/delete — no batch-write endpoint. Loop one entity per request, respect 400/min. (Bulk READ by comma-separated IDs is fine.)
- Register webhooks — needs a Numa-hosted receiver + `X-Hook-Secret` handshake not exposed from chat. Poll instead.
- Full-text search of bodies/comments — only `title` substring match exposed.

## Gotchas

1. **Host comes from the token, not a constant.** Paths resolve against `https://{host}/api/v4`. Never write an absolute `www.wrike.com` URL.
2. **IDs are opaque alphanumeric strings, not numbers** (`"IEAAALZ4KQAAAAAK"`, `"KUAAAAAA"`). Never coerce to int; never assume order.
3. **A "Project" is a Folder with a `project` sub-object** — same `/api/v4/folders` family. List only projects: `GET /api/v4/folders?project=true`.
4. **A task's `parentIds` is N:M** — one task can live in many folders. Removing its last parent moves it to the Recycle Bin (a task must live somewhere).
5. **Array query/body params are JSON arrays of QUOTED strings:** `responsibles=["KUAAAAAA"]`, `parents=["IEAAALZ4I4AAAAB"]`. Bare/unquoted `[KUAAAAAA]` → `invalid_parameter`.
6. **Date-range filters are URL-encoded JSON objects:** `updatedDate={"start":"2026-05-01T00:00:00Z","end":"2026-05-31T23:59:59Z"}`. The write `dates` param is also JSON: `dates={"due":"2026-06-01"}`.
7. **`fields` is opt-in ADD, not trim.** `?fields=["description","subTaskIds"]` adds expensive optional fields; defaults omit them. Request only what you need.
8. **Array updates use add/remove DELTAS, not replacement:** `addParents`/`removeParents`, `addResponsibles`/`removeResponsibles`, `addFollowers`/`removeFollowers`. Prefer the deltas on PUT.
9. **`customStatus` (write param) / `customStatusId` (read field) ≠ the high-level `status` enum.** To move a task into a workflow column, set `customStatus=<id>` (discover via `/api/v4/workflows`); the high-level `status` follows the status's group.
10. **Account-level `GET /api/v4/comments` caps `createdDate` range at ≤7 days.** Wider → `invalid_parameter`. Scope to a task/folder for older comments.
11. **POST create is NOT idempotent** (no title-uniqueness). A retried create makes a duplicate. Before re-POSTing after an ambiguous failure, search by `title` to check it didn't already land.

## Defaults (override only if the user specifies)

| Param                   | Default                | Reason                                         |
| ----------------------- | ---------------------- | ---------------------------------------------- |
| `pageSize`              | `1000` (tasks/folders) | API max — fewest round-trips vs 400/min budget |
| `sortField`/`sortOrder` | `UpdatedDate`/`Desc`   | Freshest-first                                 |
| `plainText` (comments)  | `true`                 | LLM wants plain text, not HTML                 |
| `fields`                | omit                   | Extra fields are expensive opt-ins             |
| base URL                | from token `host`      | Build from token host; NEVER hardcode          |

## Operations

| Operation           | Method | Path                        | Key params / notes                                                                                  |
| ------------------- | ------ | --------------------------- | --------------------------------------------------------------------------------------------------- |
| Current user        | GET    | /api/v4/contacts?me=true    | identity smoke test; cache `data[0].id` as `<myId>`                                                 |
| List contacts       | GET    | /api/v4/contacts            | `me`; CSV ids in path = bulk read                                                                   |
| List spaces         | GET    | /api/v4/spaces              | top-level homes                                                                                     |
| Folder/project tree | GET    | /api/v4/folders             | `project`, `descendants`, `permalink`, `deleted`                                                    |
| Tasks in a folder   | GET    | /api/v4/folders/{id}/tasks  | same filters as /tasks; preferred when scoped                                                       |
| Search tasks        | GET    | /api/v4/tasks               | `status`, `importance`, `responsibles`, `*Date`, `fields`, `pageSize`, `nextPageToken`, `sortField` |
| Get task(s) by id   | GET    | /api/v4/tasks/{id1,id2}     | `fields`; CSV ids = bulk read (~100 max)                                                            |
| Create task         | POST   | /api/v4/folders/{id}/tasks  | `title`(req), `dates`, `responsibles`, `importance`; form-encoded; needs `wsReadWrite`              |
| Update task         | PUT    | /api/v4/tasks/{id}          | `status`, `customStatus`, add/remove deltas                                                         |
| Delete task         | DELETE | /api/v4/tasks/{id}          | soft delete → Recycle Bin                                                                           |
| Comments on a task  | GET    | /api/v4/tasks/{id}/comments | `?plainText=true`                                                                                   |
| Add comment         | POST   | /api/v4/tasks/{id}/comments | `text`(req), `plainText`; needs `wsReadWrite`                                                       |
| Timelogs on a task  | GET    | /api/v4/tasks/{id}/timelogs | —                                                                                                   |
| Log time            | POST   | /api/v4/tasks/{id}/timelogs | `hours`+`trackedDate`(req), `comment`; needs `wsReadWrite`                                          |
| List workflows      | GET    | /api/v4/workflows           | discover `customStatusId` values                                                                    |
| List custom fields  | GET    | /api/v4/customfields        | discover custom field IDs                                                                           |

## Pagination

- Cursor: `pageSize` + `nextPageToken`, BOTH in the JSON response BODY. Max `pageSize=1000`. Default unbounded for small lists; supply `pageSize` to opt into paging on `/tasks` and `/folders`.
- Re-send the SAME filter params on EVERY page plus the token — the cursor does NOT encode the query; dropping filters on page 2 changes the result set.
- Last page: `nextPageToken` absent. **Belt-and-braces (Wrike quirk):** a `nextPageToken` can appear even when `data` is `[]` — also stop if `data` is empty or the token didn't change.
- `responseSize` = total matching count (includes hidden items), present on `/tasks`. Don't use it for last-page detection.

```http
GET /api/v4/tasks?status=Active&pageSize=1000               → body nextPageToken:"eyJ...A"
GET /api/v4/tasks?status=Active&pageSize=1000&nextPageToken=eyJ...A  → nextPageToken:"eyJ...B" (filters MUST repeat)
GET /api/v4/tasks?status=Active&pageSize=1000&nextPageToken=eyJ...B  → no nextPageToken → STOP
```

## Webhooks / Events

Wrike HAS a Webhooks API (HMAC-signed, `X-Hook-Secret` handshake) but **Numa does NOT expose a receiver** — real-time is not wired. Poll instead:

```http
GET /api/v4/tasks?updatedDate={"start":"<last_poll_iso>"}&sortField=UpdatedDate&sortOrder=Desc&pageSize=1000
```

Interval 5–15 min (never sub-minute on a busy account — 400/min budget). Change-detection field: `updatedDate`.

## Errors

Flat shape (no per-field `details` array, unlike Zoho): `{"error":"invalid_parameter","errorDescription":"Request parameter name or value is invalid"}`. Show `errorDescription` verbatim — it names the offending parameter.

| Status | Error code(s)                                                  | Action                                                                                                      |
| ------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 400    | `invalid_parameter` / `parameter_required` / `invalid_request` | Fix per `errorDescription` (bad array literal, bad date JSON, missing required)                             |
| 401    | `not_authorized`                                               | Backend refreshes once; if re-raised → user reconnects (rotated token lost)                                 |
| 403    | `not_allowed` (license/scope) / `access_forbidden` (sharing)   | `not_allowed` on a write = scope is `wsReadOnly`; widen + reconnect. `access_forbidden` = entity not shared |
| 404    | `resource_not_found` / `method_not_found`                      | Verify the opaque ID (string!) or the path                                                                  |
| 409    | (rare; concurrent edit)                                        | Re-fetch, compare `updatedDate`, re-apply — last-write-wins                                                 |
| 429    | `rate_limit_exceeded` / `too_many_requests`                    | Honour `Retry-After` if present; else exp. backoff base 2s cap 60s (≤3)                                     |
| 5xx    | `server_error` / gateway 502/503                               | Retry exp. backoff + jitter (≤3)                                                                            |

## Examples

1. Identity smoke test (first call after connect):
   `GET /api/v4/contacts?me=true`
   → `{"kind":"contacts","data":[{"id":"KUAAAAAA","firstName":"Jane","lastName":"Smith","type":"Person","profiles":[{"accountId":"IEAAAAAA","email":"jane@example.com","role":"User","admin":true}],"timezone":"Pacific/Auckland","me":true,"primaryEmail":"jane@example.com"}]}`
   Cache `data[0].id` — the `<myId>` for "my tasks".

2. My active tasks, freshest first:
   `GET /api/v4/tasks?status=Active&responsibles=["KUAAAAAA"]&sortField=UpdatedDate&sortOrder=Desc&pageSize=1000`
   → `{"kind":"tasks","responseSize":12,"data":[{"id":"IEAAALZ4KQAAAAAK","accountId":"IEAAALZ4","title":"Write the spec","status":"Active","importance":"Normal","createdDate":"2026-05-29T01:00:00Z","updatedDate":"2026-05-29T02:00:00Z","dates":{"type":"Planned","due":"2026-06-01"},"customStatusId":"IEAAALZ4JMAAAAA","permalink":"https://www.wrike.com/open.htm?id=1234567","responsibleIds":["KUAAAAAA"],"parentIds":["IEAAALZ4I4AAAAB"]}]}`
   No `nextPageToken` → last/only page.

3. List projects with status:
   `GET /api/v4/folders?project=true`
   → `{"kind":"folders","data":[{"id":"IEAAALZ4I4AAAAB","title":"Q3 Launch","childIds":["IEAAALZ4I5AAAAC"],"scope":"WsFolder","project":{"ownerIds":["KUAAAAAA"],"status":"Green","startDate":"2026-06-01","endDate":"2026-08-31"},"permalink":"https://www.wrike.com/open.htm?id=2345678"}]}`

4. Create a task (requires `wsReadWrite`; form-encoded body):
   `POST /api/v4/folders/IEAAALZ4I4AAAAB/tasks` body `title=Write the spec&description=<p>Draft v1</p>&importance=Normal&responsibles=["KUAAAAAA"]&dates={"due":"2026-06-01"}`
   → `{"kind":"tasks","data":[{"id":"IEAAALZ4KQAAAAAK","title":"Write the spec","status":"Active"}]}`
   Under `wsReadOnly` → `403 not_allowed`; do NOT attempt writes until scope widened.

5. Complete a task (requires `wsReadWrite`):
   `PUT /api/v4/tasks/IEAAALZ4KQAAAAAK` body `status=Completed`
   → `{"kind":"tasks","data":[{"id":"IEAAALZ4KQAAAAAK","status":"Completed","completedDate":"2026-05-29T03:00:00Z"}]}`
