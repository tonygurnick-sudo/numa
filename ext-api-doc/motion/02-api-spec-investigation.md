---
api_name: Motion
api_slug: motion
base_url: https://api.usemotion.com/v1
path_version_segment: GLOBAL /v1 in base_url for the core API; Custom Fields on a separate /beta path
path_style: hyphens for multi-word resources (recurring-tasks, custom-fields)
call_surface: HTTP via `numa integrations request` (connect_request proxy); NOT a Files connector
auth: X-API-Key header (static per-user key; NOT Authorization: Bearer)
field_casing: camelCase
spec_format: no public OpenAPI download located; docs.usemotion.com api-reference is the reference
docs_url: https://docs.usemotion.com
date_researched: 2026-06-26
confidence: [DOCUMENTED] from docs.usemotion.com, [INFERRED], [UNKNOWN]. NO live call made — the live GET /users/me gate is NOT passed; treat response envelopes/error bodies as [DOCUMENTED-shape]/[INFERRED].
---

# Motion — API Specification & Investigation

Condensed developer reference for the Motion REST API.

## Overview

- **Vendor:** Motion (usemotion.com) — AI calendar / task & project management for individuals and teams; auto-schedules tasks into the calendar.
- **API version:** Core API is `v1`, baked into the base URL. Custom Fields are on a separate **`/beta`** host path.
- **Base URL:** `https://api.usemotion.com/v1` (single shared host — no per-tenant instance URL).
- **API type:** REST (JSON over HTTPS). `Accept: application/json`, `Content-Type: application/json` on bodies. **Field casing:** camelCase.
- **Plan gate:** none for API access per se; **rate-limit tier scales with plan** (individual 12/min vs team 120/min). Some surfaces (Custom Fields) are **beta**.
- **Sandbox / status page / OpenAPI download:** none located [UNKNOWN]. The interactive reference at `docs.usemotion.com/api-reference` is the authoritative source.

**Docs links [DOCUMENTED]:** portal [docs.usemotion.com](https://docs.usemotion.com) · [api-reference](https://docs.usemotion.com/api-reference) · [getting-started](https://docs.usemotion.com/cookbooks/getting-started/) · [rate-limits](https://docs.usemotion.com/cookbooks/rate-limits/).

## Authentication

### Method: API Key (`X-API-Key` header)

Numa's registry: `authType: 'api-key'`, single credential field `api_token`, `credentialHeaderMap: { 'X-API-Key': 'api_token' }`. All calls flow through the `connect_request` proxy, which injects the stored key as `X-API-Key` — the agent never sees the raw key, no token exchange.

```
X-API-Key: {api_token}
Accept: application/json
Content-Type: application/json     ← POST/PATCH bodies only
```

> ⚠️ **NOT** `Authorization: Bearer …`. Motion authenticates **only** with `X-API-Key`.

| Property          | Value                                                                        | Source       |
| ----------------- | ---------------------------------------------------------------------------- | ------------ |
| Auth location     | HTTP **header** — `X-API-Key: {key}`                                         | [DOCUMENTED] |
| How to obtain     | Motion → **Settings → API** → create an API key (**shown only once** — copy) | [DOCUMENTED] |
| Scope             | **Per user** — the key carries that user's own permissions                   | [DOCUMENTED] |
| Key format        | Opaque secret string; treat as a password — never log/echo                   | [DOCUMENTED] |
| Token lifetime    | **Does not expire** — static, indefinite                                     | [INFERRED]   |
| Refresh mechanism | **None** — no exchange, no refresh, no `expires_in`                          | [DOCUMENTED] |
| Rotation          | Manual — create a new key in Settings → API, delete the old                  | [INFERRED]   |
| Rate limits       | Per **account**: individual 12/min, team 120/min (no per-key budget)         | [DOCUMENTED] |

**Health check / smoke test:** `GET /users/me` (with `X-API-Key`).

## Rate Limits ⚠️ (the defining constraint)

| Account type | Per minute | Notes                                              |
| ------------ | ---------- | -------------------------------------------------- |
| Individual   | **12**     | Base tier — ~1 call / 5 s                          |
| Team         | **120**    | "Teams can request up to 120 requests per minute." |
| Enterprise   | higher     | "sign up for our enterprise tier"                  |

- Exceeding → **HTTP 429**. **No documented `Retry-After` header.**
- No documented burst allowance. **Serialize, pace, and back off with exponential + jitter.** This is the #1 integration concern — see `01d`.

## Endpoint Catalog

Paths below are **relative to `https://api.usemotion.com/v1`** unless marked `/beta`. (Base already ends in `/v1` — don't repeat it.)

### Identity / Users (ids are opaque strings)

| Method | Path        | Purpose                        | Paginated    | Idempotent |
| ------ | ----------- | ------------------------------ | ------------ | ---------- |
| GET    | `/users/me` | Caller identity / health check | No           | Yes        |
| GET    | `/users`    | List members (workspace/team)  | Yes (cursor) | Yes        |

### Workspaces

| Method | Path          | Purpose                       | Paginated    | Idempotent |
| ------ | ------------- | ----------------------------- | ------------ | ---------- |
| GET    | `/workspaces` | List workspaces (ids, cursor) | Yes (cursor) | Yes        |

> Top-level scoping entity — fetch first; embeds `labels[]` and `statuses[]`.

### Statuses & Schedules

| Method | Path         | Purpose                                      | Paginated  | Idempotent |
| ------ | ------------ | -------------------------------------------- | ---------- | ---------- |
| GET    | `/statuses`  | Statuses for a workspace (req `workspaceId`) | No (array) | Yes        |
| GET    | `/schedules` | Caller's working-hours schedules             | No (array) | Yes        |

### Tasks

| Method | Path                   | Purpose                          | Paginated    | Idempotent |
| ------ | ---------------------- | -------------------------------- | ------------ | ---------- |
| GET    | `/tasks`               | List tasks (filters)             | Yes (cursor) | Yes        |
| GET    | `/tasks/{id}`          | Get one task                     | No           | Yes        |
| POST   | `/tasks`               | Create a task (name+workspaceId) | No           | No         |
| PATCH  | `/tasks/{id}`          | Update a task (name+workspaceId) | No           | Yes        |
| POST   | `/tasks/{id}/move`     | Move to another workspace        | No           | Yes        |
| POST   | `/tasks/{id}/unassign` | Remove the assignee              | No           | Yes        |
| DELETE | `/tasks/{id}`          | Delete a task (destructive)      | No           | Yes        |

> `move` is POST per the api-reference index; one detail page shows PATCH — POST first, fall back to PATCH on 405.

### Projects

| Method | Path             | Purpose                             | Paginated    | Idempotent |
| ------ | ---------------- | ----------------------------------- | ------------ | ---------- |
| GET    | `/projects`      | List projects (req `workspaceId`)   | Yes (cursor) | Yes        |
| GET    | `/projects/{id}` | Get one project                     | No           | Yes        |
| POST   | `/projects`      | Create a project (name+workspaceId) | No           | No         |

> **No update or delete** for projects.

### Recurring Tasks

| Method | Path                    | Purpose                                      | Paginated    | Idempotent |
| ------ | ----------------------- | -------------------------------------------- | ------------ | ---------- |
| GET    | `/recurring-tasks`      | List (req `workspaceId`)                     | Yes (cursor) | Yes        |
| POST   | `/recurring-tasks`      | Create (name/workspaceId/assignee/frequency) | No           | No         |
| DELETE | `/recurring-tasks/{id}` | Delete (destructive)                         | No           | Yes        |

> No get-by-id, no update. Create body partly [INFERRED] — `frequency` schema not published.

### Comments

| Method | Path        | Purpose                          | Paginated    | Idempotent |
| ------ | ----------- | -------------------------------- | ------------ | ---------- |
| GET    | `/comments` | List for a task (req `taskId`)   | Yes (cursor) | Yes        |
| POST   | `/comments` | Create (`taskId`,`content` HTML) | No           | No         |

> No update or delete.

### Custom Fields (BETA — `/beta`, not `/v1`)

| Method      | Path                                                | Purpose                                             |
| ----------- | --------------------------------------------------- | --------------------------------------------------- |
| GET         | `/beta/workspaces/{workspaceId}/custom-fields`      | List custom fields                                  |
| POST        | `/beta/workspaces/{workspaceId}/custom-fields`      | Create a custom field                               |
| DELETE      | `/beta/workspaces/{workspaceId}/custom-fields/{id}` | Delete a custom field [sub-path INFERRED]           |
| POST/DELETE | (project/task association sub-paths)                | Set/clear a value on a project/task [paths UNKNOWN] |

> The api-reference index loosely lists `/custom-fields` and `/custom-fields/{project-id}` etc.; the detail pages resolve to the `/beta/workspaces/{workspaceId}/custom-fields` form. Treat the index shorthand as descriptive, the `/beta` form as the real path.

## Data Models (summary)

Full field tables in `01a-domain-model-reference.md`.

- **Task** — `id`, `name`, `workspaceId`, `description` (GFM in / HTML out), `priority` (ASAP/HIGH/MEDIUM/LOW), `status` (string write / object read), `dueDate` (ISO-8601), `duration` (`NONE`/`REMINDER`/int min), `autoScheduled`, `projectId`, `labels` (names write / objects read), `assigneeId`/`assignees`, `completed`, `createdTime`, `updatedTime`.
- **Project** — `id`, `name`, `workspaceId`, `description` (HTML), `status` (object), `dueDate`, `priority`, `labels`, `createdTime`, `updatedTime`, `customFieldValues`.
- **Workspace** — `id`, `name`, `teamId`, `type` (`team`/`individual`), `labels[]`, `statuses[]`.
- **Status** — `name`, `isDefaultStatus`, `isResolvedStatus`.
- **Schedule** — `name`, `isDefaultTimezone`, `timezone`, `schedule` (per-weekday `[{start,end}]` HH:MM).
- **Recurring Task** — `id`, `name`, `workspace`, `assignee`, `project`, `status`, `priority`, `labels` (+ create body `frequency` [INFERRED]).
- **Comment** — `id`, `taskId`, `content` (HTML), `createdAt`, `creator{id,name,email}`.
- **Custom Field** — `id`, `name`, `type` (text/url/date/person/multiPerson/phone/select/multiSelect/number/email/checkbox/relatedTo), `metadata{options,format,toggle}`.
- **User** — `id`, `name`, `email`.

## Pagination

Cursor-based. List responses: `{ "meta": { "nextCursor": string|null, "pageSize": number }, "<resource>": [...] }`. `nextCursor` non-null → repeat with `?cursor=…`; null → last page. No total count. **`/statuses` and `/schedules` return bare arrays** (not paginated).

## Errors

JSON error bodies (exact shape [UNKNOWN] — assume a `message` field). Status codes: 400 (bad params, incl. `status`+`includeAllStatuses` together), 401 (bad/revoked key), 403 (no access — per-user perms), 404 (bad id / doubled `/v1`), 405 (move verb mismatch), 429 (**rate limit — no `Retry-After`**), 5xx. Full playbook in `01d`.

## Open Questions / To Verify Live

- [ ] **CRITICAL GATE: live `GET /users/me`** with a real key (not yet performed).
- [ ] Exact error body shape (`message` only vs structured `code`/`details`).
- [ ] `autoScheduled` object sub-fields (`startDate`/`deadlineType`/`schedule`).
- [ ] Recurring-task create body, especially `frequency` schema.
- [ ] Custom-field **association** sub-paths (set/clear value on project/task).
- [ ] Whether `move` is canonically POST or PATCH (index says POST; one page PATCH).
- [ ] Whether keys ever expire / any documented rotation endpoint.
