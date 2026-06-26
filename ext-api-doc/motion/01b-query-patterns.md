---
api_name: Motion
api_slug: motion
base_url: https://api.usemotion.com/v1
call_surface: HTTP via `numa integrations request`
auth: X-API-Key header
companions: 01=api-rules, 01a=domain-model, 01c=mutation-patterns, 01d=events+errors
confidence: [DOCUMENTED] from docs.usemotion.com unless tagged [INFERRED]/[UNKNOWN]; NO live call made
---

# Motion — Query Patterns Reference

Read patterns: filtering, sorting, pagination, scoping. Companion to `01-llm-api-rules.md`.

> **Before any query loop, re-read the rate-limit section in `01`.** Motion allows only **12 req/min (individual) / 120 (team)** with **no `Retry-After`**. Every list page is one request against that budget — filter hard, paginate only as far as the user needs, serialize calls.

## Query Capabilities

| Capability               | Supported            | Syntax                                           | Notes                                            |
| ------------------------ | -------------------- | ------------------------------------------------ | ------------------------------------------------ |
| Scope by workspace       | Yes (most endpoints) | `?workspaceId=ws_123`                            | Required for statuses/recurring/users-list       |
| Filter tasks by assignee | Yes                  | `?assigneeId=user_456`                           | tasks only                                       |
| Filter tasks by project  | Yes                  | `?projectId=proj_xyz789`                         | tasks only                                       |
| Filter tasks by status   | Yes                  | `?status=To%20Do` (array — repeat for multiple)  | mutually exclusive with `includeAllStatuses`     |
| Include all statuses     | Yes                  | `?includeAllStatuses=true`                       | mutually exclusive with `status`                 |
| Filter tasks by label    | Yes                  | `?label=urgent`                                  | tasks only                                       |
| Filter tasks by name     | Yes (contains)       | `?name=proposal`                                 | **case-insensitive substring** match             |
| Filter comments by task  | Yes (required)       | `?taskId=task_789`                               | `taskId` is mandatory on `/comments`             |
| Filter workspaces by id  | Yes                  | `?ids=ws_1&ids=ws_2`                             | array param                                      |
| Filter users by team     | Yes                  | `?teamId=team_456`                               | users list                                       |
| Full-text search         | Partial              | task `name` substring only                       | no global search endpoint                        |
| Sort by field            | No                   | —                                                | no documented `sort`/`order` param [INFERRED]    |
| Field selection / sparse | No                   | —                                                | endpoints return full schema [INFERRED]          |
| Include related records  | Partial              | read responses embed `assignees`, `status`, etc. | no `include` param                               |
| Aggregate / count        | No                   | —                                                | no total count; `meta.pageSize` = this page only |
| Pagination               | Cursor               | `?cursor={meta.nextCursor}`                      | no offset/page numbers                           |

## Scoping rule (the most important read habit)

**List `/workspaces` first**, then scope everything by the resulting `workspaceId`:

```http
GET /workspaces                       # discover ws ids + embedded labels/statuses
GET /tasks?workspaceId=ws_123         # then scope
GET /statuses?workspaceId=ws_123      # required — statuses are per workspace
GET /recurring-tasks?workspaceId=ws_123   # required
GET /users?workspaceId=ws_123         # workspace members
```

`GET /tasks` without `workspaceId` returns tasks across **all** workspaces the user belongs to — usually too broad and a waste of the request budget. Always scope unless the user explicitly wants a cross-workspace view.

## Filter Syntax

Whitelisted query-string params per endpoint. Multiple distinct filters combine with implicit AND.

```http
GET /tasks?workspaceId=ws_123&assigneeId=user_456&status=To%20Do
GET /tasks?workspaceId=ws_123&projectId=proj_xyz789&name=proposal
GET /tasks?workspaceId=ws_123&includeAllStatuses=true
GET /comments?taskId=task_789
```

### Tasks list — full filter set

| Parameter          | Type          | Required | Description                                                           |
| ------------------ | ------------- | -------- | --------------------------------------------------------------------- |
| workspaceId        | string        | no¹      | Tasks from this workspace; omit → all workspaces the user is in       |
| assigneeId         | string        | no       | Limit to a specific assignee                                          |
| projectId          | string        | no       | Limit to a given project                                              |
| status             | array<string> | no       | Limit by status name(s); **cannot** combine with `includeAllStatuses` |
| includeAllStatuses | boolean       | no       | Include tasks of every status; **cannot** combine with `status`       |
| label              | string        | no       | Limit by label on the task                                            |
| name               | string        | no       | Substring match on task name (**case-insensitive**)                   |
| cursor             | string        | no       | Pagination cursor from a previous `meta.nextCursor`                   |

¹ Strongly recommended in practice — omitting it over-fetches and burns the rate budget.

### Other list filter sets

| Endpoint           | Params                                 |
| ------------------ | -------------------------------------- |
| `/workspaces`      | `ids` (array), `cursor`                |
| `/projects`        | `workspaceId`, `cursor`                |
| `/statuses`        | `workspaceId` (**required**)           |
| `/recurring-tasks` | `workspaceId` (**required**), `cursor` |
| `/comments`        | `taskId` (**required**), `cursor`      |
| `/users`           | `workspaceId`, `teamId`, `cursor`      |
| `/schedules`       | none (caller-scoped)                   |

### Gotchas

- **`status` and `includeAllStatuses` are mutually exclusive** — sending both is a `400`.
- **`name` is a case-insensitive substring filter, not exact match** — `?name=prop` matches "Proposal".
- **`taskId` is mandatory on `/comments`** and **`workspaceId` is mandatory on `/statuses` and `/recurring-tasks`** — omitting them errors.
- **No sorting params documented** — assume server-default ordering; don't promise "newest first".
- **Status values are workspace-specific** — fetch valid names from the workspace's `statuses[]` (or `GET /statuses`) before filtering by `status`.

## Search Capabilities

- **No global search endpoint** — the closest thing is the task `name` substring filter (`GET /tasks?workspaceId=…&name=…`).
- **Per-resource lookups** are by id (`GET /tasks/{id}`, `GET /projects/{id}`) or by the whitelisted filters above.
- **No fuzzy/wildcard matching** beyond the case-insensitive `name` substring [INFERRED].

## Field Selection

Not supported — endpoints return their full documented schema. No `fields`/`columns`/`include` param [INFERRED].

## Common Patterns

```http
# Pattern 1: Discover workspaces (always first)
GET /workspaces

# Pattern 2: Open tasks for one person in one workspace
GET /tasks?workspaceId=ws_123&assigneeId=user_456&status=To%20Do

# Pattern 3: Every task in a project, all statuses
GET /tasks?workspaceId=ws_123&projectId=proj_xyz789&includeAllStatuses=true

# Pattern 4: Find a task by name fragment (case-insensitive)
GET /tasks?workspaceId=ws_123&name=proposal

# Pattern 5: A task's comments
GET /comments?taskId=task_789

# Pattern 6: Valid statuses for a workspace (before setting one)
GET /statuses?workspaceId=ws_123

# Pattern 7: The caller's own user record (health check)
GET /users/me

# Pattern 8: Members of a workspace
GET /users?workspaceId=ws_123
```

All calls send `X-API-Key: {api_token}` + `Accept: application/json`.

## Pagination Handling

- **Type:** cursor. No offset, no page numbers.
- Each list response wraps results in `{ "meta": { "nextCursor": …, "pageSize": N }, "<resource>": [ … ] }`.
- **`meta.nextCursor` non-null → more pages.** Repeat the identical query with `?cursor={nextCursor}` appended. **Null/absent → last page, stop.**
- **`meta.pageSize`** is the count in _this_ page, **not** a grand total — there is no total-count field.
- **Schedules and statuses are bare arrays** (no `meta` wrapper) — they're not paginated.

```
Page 1: GET /tasks?workspaceId=ws_123              -> meta.nextCursor="c1" (continue)
Page 2: GET /tasks?workspaceId=ws_123&cursor=c1    -> meta.nextCursor="c2" (continue)
Page 3: GET /tasks?workspaceId=ws_123&cursor=c2    -> meta.nextCursor=null (LAST PAGE, stop)
```

| Parameter | Type   | Description                                       |
| --------- | ------ | ------------------------------------------------- |
| cursor    | string | Opaque cursor from the previous `meta.nextCursor` |

> **Rate-budget warning:** on an individual key (12/min) a 12-page paginate exhausts the entire minute. Deep-paginate only when the user actually needs the full set; otherwise stop early and tell the user there's more.

## Bulk Reads & Large Datasets

- **No async export / bulk endpoint** documented.
- **Budget the rate limit:** at 12/min individual, a full multi-workspace task export is slow by design. Scope each call by `workspaceId`, filter aggressively, cache `/workspaces`+`/statuses` for the conversation, and pace pages so you don't trip 429.

## Gotchas (quick scan)

1. Rate limit 12/min individual, no `Retry-After` — every page costs a request; filter and pace.
2. `workspaceId` required on `/statuses` and `/recurring-tasks`; `taskId` required on `/comments`.
3. `status` ⊕ `includeAllStatuses` are mutually exclusive.
4. `name` filter is a case-insensitive substring, not exact match.
5. Cursor pagination only — no offset/page; `meta.nextCursor=null` = last page; no total count.
6. Schedules/statuses are bare arrays (not `meta`-wrapped, not paginated).
7. No sort params — don't assume an order.
8. All ids opaque strings; timestamps ISO-8601 (not epoch).
