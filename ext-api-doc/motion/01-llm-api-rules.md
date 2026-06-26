---
api_name: Motion
api_slug: motion
base_url: https://api.usemotion.com/v1
path_construction: pass the path AFTER the version, e.g. /tasks, /tasks/{id}, /workspaces; baseUrl already ends in /v1 so do NOT repeat /v1
path_version_segment: GLOBAL /v1 baked into base_url for the core API. EXCEPTION — Custom Fields live under a separate /beta host path (/beta/workspaces/{workspaceId}/custom-fields), NOT /v1.
path_style: hyphens for multi-word resources (recurring-tasks, custom-fields); core ids are opaque strings
auth: X-API-Key header (per-user static key; NOT Authorization: Bearer)
field_casing: camelCase
id_format: opaque strings everywhere (task/project/workspace/user/comment ids) — never coerce, never parse
timestamps: ISO-8601 datetime strings (e.g. 2024-01-15T17:00:00Z) — NOT epoch seconds
rate_limit: per ACCOUNT — 12 req/min individual, up to 120 req/min team. NO documented Retry-After. THE #1 GOTCHA — serialize + pace every call, back off hard on 429.
call_surface: HTTP via `numa integrations request` through connect_request proxy (NOT a Files connector — no list/download)
connection_test: GET /users/me
confidence: facts are [DOCUMENTED] from docs.usemotion.com unless tagged [INFERRED]/[UNKNOWN]; NO live call made
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# Motion — API Rules

## Paths (read first)

- Base URL is `https://api.usemotion.com/v1` — the `/v1` is **already in the base URL**. Pass the path that comes **after** it: `/tasks`, `/tasks/{id}`, `/projects`, `/workspaces`, `/users/me`. **Do NOT** write `/v1/tasks` (that resolves to `…/v1/v1/tasks`).
- Multi-word resources use **hyphens**: `/recurring-tasks`, `/custom-fields`. Never underscores.
- **Custom Fields are the one exception** — they sit on a separate **`/beta`** host path, not `/v1`: `/beta/workspaces/{workspaceId}/custom-fields`. For those, pass an **absolute URL** (`https://api.usemotion.com/beta/workspaces/{workspaceId}/custom-fields`) so the `/v1` base isn't prepended. See 01c.
- `/users/me` is the identity/health-check path.

## Call surface

HTTP via `numa integrations request`. NOT a Files connector — no `list-files`/`download-file`/`search-files`.

## Auth

```
X-API-Key: {api_token}
Accept: application/json
Content-Type: application/json   (POST/PATCH bodies only)
```

- **Per-user** static key, minted in **Motion → Settings → API** ("create an API key" — **shown only once**, copy immediately). No refresh, no `expires_in`. `connect_request` injects it; the agent never sees the raw key — never log/echo it.
- Header name is **`X-API-Key`** (case as written). **NOT** `Authorization: Bearer …` — Motion rejects Bearer.

## ⚠️ RATE LIMITS — THE #1 GOTCHA (read before any loop)

Motion's limit is brutally low and **per account**:

| Account type | Limit                   |
| ------------ | ----------------------- |
| Individual   | **12 req / min**        |
| Team         | up to **120 req / min** |
| Enterprise   | higher (contact Motion) |

- **There is NO documented `Retry-After` header.** You cannot read a precise wait off the response.
- **Serialize everything.** Never fire requests in parallel. One call at a time.
- **Pace proactively.** On an individual key, 12/min ≈ **one call every ~5 seconds**. Budget accordingly — a 5-page paginate is already 5 calls. Do not burn the budget on speculative reads.
- **On HTTP 429: stop, wait, back off.** With no `Retry-After`, use exponential backoff with jitter (start ~5 s on individual / ~1 s on team, cap ~60 s, ≤5 retries). Do **not** hammer.
- **Cache list reads** (workspaces, statuses, schedules) within a conversation — they rarely change and each one costs a request.
- Prefer **one well-filtered call** over many. Always scope with `workspaceId` (see CANNOT) to avoid over-fetching.

## CAN

Read **tasks** (list with filters / get one), **projects** (list / get one), **workspaces** (list — needed to get the `workspaceId` everything else is scoped by), **schedules** (get the user's working hours), **recurring tasks** (list), **comments** (list per task), **statuses** (get per workspace), **users** (`/users/me`, list per workspace/team). Writes (confirm with user first): create/update/delete tasks, move a task to another workspace, unassign a task, create projects, create/delete recurring tasks, create comments, create/delete custom fields (beta).

## CANNOT

Update a project (no PATCH /projects documented — create only). Update or get a single recurring task (list + create + delete only). Edit a comment (create only; no update/delete). Filter by arbitrary fields (only the documented query params per endpoint). Use offset/page numbers (cursor-only pagination — see Pagination). Coerce ids to integers (all ids are opaque strings). Beat the rate limit (12/120 per min — no exceptions, no burst allowance documented).

## Critical Gotchas

1. **Rate limit 12/min individual, no `Retry-After`.** See the section above — this is the #1 integration failure. Serialize, pace, back off.
2. **Everything is scoped by `workspaceId`.** Statuses, recurring-tasks, users-list, and reliable task/project queries need a `workspaceId`. **Always `GET /workspaces` first** to discover ids, then scope. (Tasks-list without `workspaceId` returns tasks across _all_ workspaces — usually too broad and wasteful.)
3. **`/v1` is already in the base URL.** Pass `/tasks`, not `/v1/tasks`.
4. **Custom Fields are on `/beta/workspaces/{workspaceId}/custom-fields`, not `/v1`.** Different host path. Pass an absolute URL for those.
5. **Timestamps are ISO-8601 strings** (`2024-01-15T17:00:00Z`), NOT epoch seconds. `dueDate`, `createdTime`, `updatedTime`, comment `createdAt`.
6. **Ids are opaque strings.** `task_789`, `ws_123`, etc. — never parse, never coerce to int, pass back exactly as received.
7. **`status` is a string on write, an object on read.** You **send** `"status": "In Progress"`; the response **returns** `"status": {"name":"In Progress","isDefaultStatus":false,"isResolvedStatus":false}`.
8. **`duration` is a union:** the string `"NONE"`, the string `"REMINDER"`, or a positive integer (minutes). Not free-form.
9. **`description` is GitHub-Flavored Markdown on input, HTML on output.** Send `"# Report"`, read back `"<h1>Report</h1>"`.
10. **Move task uses `POST /tasks/{id}/move`** (index lists POST; one doc page shows PATCH — prefer **POST**, fall back to PATCH on 405). Body requires `workspaceId`.

## Defaults (override only if user specifies)

Always resolve `workspaceId` first via `GET /workspaces`. For task lists, scope by `workspaceId`; add `status`/`assigneeId`/`projectId`/`name` filters to keep result sets (and request counts) small. Paginate only as far as the user needs — each page is a request against a tiny budget.

## Operations

(D) DOCUMENTED, (I) INFERRED. Full catalog in 01a/02. All paths are **relative to `…/v1`** unless marked `/beta`.

| Operation               | Method | Path                                                | Key params / notes                                                                        |
| ----------------------- | ------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Identity / health check | GET    | `/users/me`                                         | — connection test (D)                                                                     |
| List users              | GET    | `/users`                                            | workspaceId, teamId, cursor (D)                                                           |
| List workspaces         | GET    | `/workspaces`                                       | ids[], cursor (D)                                                                         |
| Get statuses            | GET    | `/statuses`                                         | workspaceId (req) (D)                                                                     |
| Get schedules           | GET    | `/schedules`                                        | — returns the caller's schedules (D)                                                      |
| List tasks              | GET    | `/tasks`                                            | workspaceId, assigneeId, projectId, status[], label, name, includeAllStatuses, cursor (D) |
| Get task                | GET    | `/tasks/{id}`                                       | (D)                                                                                       |
| Create task             | POST   | `/tasks`                                            | body — name+workspaceId req (D)                                                           |
| Update task             | PATCH  | `/tasks/{id}`                                       | body — name+workspaceId req (D)                                                           |
| Move task               | POST   | `/tasks/{id}/move`                                  | body `{workspaceId, assigneeId?}` — POST per index (PATCH on one page) (D)                |
| Unassign task           | POST   | `/tasks/{id}/unassign`                              | no body documented (D)                                                                    |
| Delete task             | DELETE | `/tasks/{id}`                                       | destructive (D)                                                                           |
| List projects           | GET    | `/projects`                                         | workspaceId, cursor (D)                                                                   |
| Get project             | GET    | `/projects/{id}`                                    | (D)                                                                                       |
| Create project          | POST   | `/projects`                                         | body — name+workspaceId req (D)                                                           |
| List recurring tasks    | GET    | `/recurring-tasks`                                  | workspaceId (req), cursor (D)                                                             |
| Create recurring task   | POST   | `/recurring-tasks`                                  | body — name, workspaceId, assigneeId, frequency (D; body fields partly [INFERRED])        |
| Delete recurring task   | DELETE | `/recurring-tasks/{id}`                             | destructive (D)                                                                           |
| List comments           | GET    | `/comments`                                         | taskId (req), cursor (D)                                                                  |
| Create comment          | POST   | `/comments`                                         | body `{taskId, content}` (content = HTML) (D)                                             |
| List custom fields      | GET    | `/beta/workspaces/{workspaceId}/custom-fields`      | **`/beta`, not `/v1`** — absolute URL (D)                                                 |
| Create custom field     | POST   | `/beta/workspaces/{workspaceId}/custom-fields`      | body `{name, type, metadata?}` — **`/beta`** (D)                                          |
| Delete custom field     | DELETE | `/beta/workspaces/{workspaceId}/custom-fields/{id}` | **`/beta`** (D; sub-path [INFERRED])                                                      |

## Pagination

**Cursor-based.** No offset/page numbers. Each list response carries a `meta` object:

```json
{ "meta": { "nextCursor": "abc123xyz", "pageSize": 15 }, "tasks": [ … ] }
```

- `meta.nextCursor` present and non-null → more pages. Repeat the **same** query, adding `?cursor={nextCursor}`.
- `meta.nextCursor` absent/null → **last page**, stop.
- `meta.pageSize` = items in this page (not a grand total — there is no total count).
- The result array is keyed by resource name: `tasks`, `projects`, `workspaces`, `users`, `comments`.

```http
GET /tasks?workspaceId=ws_123              -> meta.nextCursor="c1"  (more)
GET /tasks?workspaceId=ws_123&cursor=c1    -> meta.nextCursor="c2"  (more)
GET /tasks?workspaceId=ws_123&cursor=c2    -> meta.nextCursor=null  (LAST PAGE)
```

> **Watch the rate budget while paging.** On an individual key (12/min) each page is one of only 12 calls — don't deep-paginate unless the user needs it.

## Webhooks / Events

**No webhooks or event subscriptions are documented in the public API.** Detect changes by **polling** a scoped list endpoint (e.g. `GET /tasks?workspaceId=…&status=…`) on a generous interval that respects the 12/120-per-minute budget. See 01d.

## Errors

JSON error bodies. Exact shape not fully published — confirm against live calls.

| Status | Meaning      | Action                                                                                                                      |
| ------ | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 400    | Bad request  | Fix params/body (e.g. invalid `priority`, malformed `dueDate`, both `status` and `includeAllStatuses`)                      |
| 401    | Unauthorized | `X-API-Key` missing/invalid/revoked — verify the stored key (re-mint in Settings → API). NOT retryable, no token to refresh |
| 403    | Forbidden    | Key lacks access to that workspace/resource (per-user permissions)                                                          |
| 404    | Not found    | Verify the id (opaque string) and that `/v1` isn't doubled in the path                                                      |
| 429    | Rate limited | **No `Retry-After`** — exponential backoff + jitter; serialize and slow down (12/min individual)                            |
| 5xx    | Server error | Exponential backoff + jitter (≤3)                                                                                           |

## Examples

1. **Health check** — `GET /users/me` (with `X-API-Key`) confirms the key:
   → `200 {"id":"user_456","name":"Jane Doe","email":"jane@acme.com"}`

2. **Discover workspaces (do this first):**
   `GET /workspaces`
   → `{"meta":{"nextCursor":null,"pageSize":1},"workspaces":[{"id":"ws_123","name":"Engineering","teamId":"team_456","type":"team","labels":[{"name":"bug"}],"statuses":[{"name":"Backlog","isDefaultStatus":true,"isResolvedStatus":false},{"name":"Done","isDefaultStatus":false,"isResolvedStatus":true}]}]}`

3. **List open tasks in a workspace, scoped + filtered:**
   `GET /tasks?workspaceId=ws_123&status=To%20Do&assigneeId=user_456`
   → `{"meta":{"nextCursor":null,"pageSize":2},"tasks":[{"id":"task_789","name":"Complete project proposal","priority":"HIGH","status":{"name":"To Do","isDefaultStatus":true,"isResolvedStatus":false},"completed":false,"dueDate":"2024-01-15T17:00:00Z","assignees":[{"id":"user_456","name":"Jane Doe","email":"jane@acme.com"}],"projectId":"proj_xyz789","createdTime":"2024-01-10T10:30:00Z"}]}`

4. **Get statuses for a workspace** (needed before setting a task status):
   `GET /statuses?workspaceId=ws_123`
   → `[{"name":"To Do","isDefaultStatus":true,"isResolvedStatus":false},{"name":"Done","isDefaultStatus":false,"isResolvedStatus":true}]`

5. **Get the user's working hours:**
   `GET /schedules`
   → `[{"name":"Work Hours","isDefaultTimezone":true,"timezone":"America/New_York","schedule":{"monday":[{"start":"09:00","end":"17:00"}],"saturday":[],"sunday":[]}}]`
